import fs from 'node:fs/promises';
import { build } from 'esbuild';

let source = await fs.readFile('src/final-game.js', 'utf8');

function patch(label, pattern, replacement) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Production patch failed: ${label}`);
  source = next;
}

// The Drive Beyond production policy:
// - prefer mature open-source systems, but remove an integration if it is unstable on target devices;
// - real uploaded vehicle assets are required; never silently replace them with primitive box cars;
// - keep one production source/bundle, not a parade of throwaway demos.

// The TerrainLOD/TSL path was visually unstable on the target iPad/WebKit build. Three.js itself is
// the mature OSS renderer, so production uses a single deterministic displaced PlaneGeometry whose
// vertices come from the exact same worldHeight() function used by the road and Rapier heightfield.
patch('remove TerrainLOD import', "import { TerrainLOD } from '@interverse/three-terrain-lod';\n", '');
patch(
  'add stable terrain visual group',
  "const worldVisual = new THREE.Group(); scene.add(worldVisual);\nconst roadVisual = new THREE.Group(); worldVisual.add(roadVisual);",
  "const worldVisual = new THREE.Group(); scene.add(worldVisual);\nconst terrainVisual = new THREE.Group(); worldVisual.add(terrainVisual);\nconst roadVisual = new THREE.Group(); worldVisual.add(roadVisual);"
);

// The source-level road collision fix introduced a roadCollider reference. Make it an explicit
// production variable next to the terrain collider so the generated browser bundle cannot boot with
// an undeclared identifier.
patch(
  'declare Rapier road collider',
  'let terrainCollider = null;\nlet heightfieldData = null;',
  'let terrainCollider = null;\nlet roadCollider = null;\nlet heightfieldData = null;'
);

patch(
  'remove heightmap canvas path',
  /function makeHeightCanvas\(\) \{[\s\S]*?\n\}\nfunction rebuildPhysicsTerrain\(\) \{/,
  'function rebuildPhysicsTerrain() {'
);
patch(
  'replace unstable TerrainLOD renderer',
  /\/\/ ---- Open-source TerrainLOD ----------------------------------------------[\s\S]*?\/\/ ---- Road geometry \(Three BufferGeometry \+ BVH\) --------------------------/,
`// ---- Stable Three.js terrain --------------------------------------------
let terrainMesh = null;
const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.98,
  metalness: 0,
});
const terrainRock = new THREE.Color(0x777970);
const terrainSnow = new THREE.Color(0xc4c8c3);
function terrainBaseColor(gz) {
  const name = biomeAt(gz).name;
  if (name === 'REDWOOD COUNTRY') return 0x3f5b3f;
  if (name === 'GOLDEN VALLEY') return 0x777548;
  if (name === 'HIGH COUNTRY') return 0x596257;
  return 0x52684e;
}
function disposeTerrainMesh() {
  if (!terrainMesh) return;
  terrainVisual.remove(terrainMesh);
  terrainMesh.geometry.dispose();
  terrainMesh = null;
}
function rebuildTerrain() {
  setLoad('Building stable open-source terrain…', 20);
  disposeTerrainMesh();

  // 192 x 192 is detailed enough for the 4 km local world while remaining dramatically simpler
  // than thousands of dynamically reconfigured LOD instances on mobile Safari/WebKit.
  const segments = 192;
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    const lx = position.getX(i);
    const lz = position.getZ(i);
    const gx = origin.x + lx;
    const gz = origin.z + lz;
    const h = worldHeight(gx, gz);
    position.setY(i, h);

    const b = biomeAt(gz);
    const high = clamp((h - (b.base + 70)) / Math.max(45, b.relief), 0, 1);
    color.setHex(terrainBaseColor(gz)).lerp(terrainRock, high * 0.72);
    if (b.name === 'HIGH COUNTRY') color.lerp(terrainSnow, clamp((h - 165) / 55, 0, 0.55));
    const shade = detailNoise(gx * 0.0017, gz * 0.0017) * 0.045;
    color.offsetHSL(0, 0, shade);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  position.needsUpdate = true;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.frustumCulled = true;
  terrainVisual.add(terrainMesh);
  rebuildPhysicsTerrain();
}

// ---- Road geometry (Three BufferGeometry + BVH) --------------------------`
);

// Fix the two accidental road-edge ribbons while retaining the road center line.
source = source
  .replace("  roadVisual.add(ribbon(-1900, 1900, ROAD_HALF - 0.24, lineMat, 0.125));\n", '')
  .replace("  roadVisual.add(ribbon(-1900, 1900, -(ROAD_HALF - 0.24), lineMat, 0.125));\n", '');

// Make FBX texture problems visible in the console while allowing the FBX geometry itself to load.
patch(
  'FBX loader diagnostics',
  "    const manager = new THREE.LoadingManager(); manager.setURLModifier(textureURLModifier(textureFolder));\n    new FBXLoader(manager).load(url, resolve, undefined, reject);",
  "    const manager = new THREE.LoadingManager();\n    manager.setURLModifier(textureURLModifier(textureFolder));\n    manager.onError = (assetUrl) => console.error('Missing FBX dependency:', assetUrl);\n    new FBXLoader(manager).load(url, resolve, undefined, reject);"
);

// No more box-car escape hatch. The uploaded hatchback must load or the boot screen reports the real error.
patch(
  'strict uploaded vehicle assets',
  /function fallbackCar\([\s\S]*?\n\}\nlet playerModel = null; const trafficPrototypes = \[\];\nasync function loadVehicleAssets\(\) \{[\s\S]*?\n\}\n\n\/\/ ---- CC0 Quaternius nature assets/,
`let playerModel = null; const trafficPrototypes = [];
function countMeshes(root) {
  let count = 0;
  root?.traverse?.(o => { if (o.isMesh) count++; });
  return count;
}
function vehicleRootForLabel(pack, label) {
  let found = null;
  pack.traverse(o => {
    if (!found && (o.isGroup || o.isMesh) && o.name?.toLowerCase().includes(label.toLowerCase())) found = o;
  });
  if (!found) return null;
  // Packs commonly name a child mesh "Sedan Body" etc. Prefer its immediate parent when that
  // parent represents the whole car rather than throwing away wheels/details.
  if (found.parent && found.parent !== pack && countMeshes(found.parent) > countMeshes(found)) return found.parent;
  return found;
}
async function loadVehicleAssets() {
  setLoad('Loading your uploaded hatchback model…', 42);
  playerModel = normalizeModel(await loadFBX('./assets/player/HatchBackLowPoly.fbx', './assets/player/Textures'), 4.25);
  if (!playerModel || countMeshes(playerModel) === 0) throw new Error('HatchBackLowPoly.fbx loaded without renderable meshes. Refusing to substitute a box car.');
  playerVisualRoot.add(playerModel);
  console.info('Player model online:', countMeshes(playerModel), 'meshes');

  setLoad('Loading your uploaded traffic model pack…', 52);
  try {
    const pack = await loadFBX('./assets/traffic/fab.fbx', './assets/traffic/textures');
    pack.updateMatrixWorld(true);
    const names = ['Compact','Coupe','Hatchback','Minivan','Offroad','Pickup','Sedan','Sport','SUV','Wagon'];
    const usedRoots = new Set();
    for (const label of names) {
      const match = vehicleRootForLabel(pack, label);
      if (!match || usedRoots.has(match.uuid)) continue;
      usedRoots.add(match.uuid);
      const clone = normalizeModel(match.clone(true), /SUV|Pickup|Minivan/.test(label) ? 4.8 : 4.3);
      if (countMeshes(clone)) trafficPrototypes.push(clone);
    }
    console.info('Traffic models online:', trafficPrototypes.length);
  } catch (e) {
    console.error('Uploaded traffic model pack failed. Traffic is disabled; no primitive substitutes will be spawned.', e);
    trafficPrototypes.length = 0;
  }
  if (!trafficPrototypes.length) console.warn('No renderable traffic models were found. Continuing without traffic rather than showing fake cars.');
}

// ---- CC0 Quaternius nature assets`
);

// Use the actual established Giblings one-ball-arms proportions from the user's Giblings project,
// instead of the unrelated two-sphere placeholder that slipped into this build.
patch(
  'Giblings one-ball-arms model',
  /function gibling\(color = 0x6d87a0\) \{[\s\S]*?\n\}/,
`function gibling(color = 0x6d87a0) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
  const eye = new THREE.MeshBasicMaterial({ color: 0x050607 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.56, 20, 14), mat);
  body.position.y = 0.58; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 14), mat);
  head.position.y = 1.62; g.add(head);
  const leftArm = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), mat);
  leftArm.position.set(0.68, 1.05, 0); g.add(leftArm);
  const rightArm = leftArm.clone(); rightArm.position.x = -0.68; g.add(rightArm);
  for (const x of [-0.11, 0.11]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), eye);
    e.scale.set(1, 1.25, 0.82); e.position.set(x, 1.66, 0.31); g.add(e);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}`
);

// If traffic assets are absent/broken, don't call modulo-by-zero or invent replacement geometry.
patch(
  'traffic mesh guard',
  "function trafficMesh(i) { return trafficPrototypes[i % trafficPrototypes.length].clone(true); }\nfunction spawnTraffic() {\n  trafficVisual.clear(); traffic.length = 0; const keys = Object.keys(DRIVER_PROFILES);",
  "function trafficMesh(i) { return trafficPrototypes.length ? trafficPrototypes[i % trafficPrototypes.length].clone(true) : null; }\nfunction spawnTraffic() {\n  trafficVisual.clear(); traffic.length = 0;\n  if (!trafficPrototypes.length) return;\n  const keys = Object.keys(DRIVER_PROFILES);"
);

// Rapier 0.21 exposes its oddly named forward-axis setter as a JS property setter.
patch('Rapier vehicle forward axis', 'vehicle.indexForwardAxis = 2;', 'vehicle.setIndexForwardAxis = 2;');

patch(
  'world rebuild uses stable terrain',
  'async function rebuildWorld() {\n  await rebuildTerrainLOD(); rebuildRoad(); scatterScenery(); rebuildStops();\n}',
  'async function rebuildWorld() {\n  rebuildTerrain(); rebuildRoad(); scatterScenery(); rebuildStops();\n}'
);
patch(
  'remove per-frame TerrainLOD update',
  '  terrainLOD?.update(camera); sun.position.set(focus.x-120,focus.y+180,focus.z-80);',
  '  sun.position.set(focus.x-120,focus.y+180,focus.z-80);'
);
patch(
  'boot protocol label',
  "  ui.protocol.textContent='Three.js + TerrainLOD + Rapier + IDM/MOBIL base + Yuka + XState + Dexie';",
  "  ui.protocol.textContent='Three.js stable terrain + uploaded FBX models + Rapier + IDM/MOBIL + Yuka + XState + Dexie';"
);

await fs.mkdir('.build', { recursive: true });
await fs.writeFile('.build/final-game.js', source);

await build({
  entryPoints: ['.build/final-game.js'],
  outfile: 'src/final.bundle.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  sourcemap: true,
  legalComments: 'linked',
  treeShaking: true,
  define: { 'process.env.NODE_ENV': '\"production\"' },
});
