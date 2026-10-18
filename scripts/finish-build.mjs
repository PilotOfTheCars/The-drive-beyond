import fs from 'node:fs/promises';
import { build } from 'esbuild';

let source = await fs.readFile('.build/final-game.js', 'utf8');

function patch(label, pattern, replacement) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Finish-build patch failed: ${label}`);
  source = next;
}

// Keep physics declarations complete even if the readable source is older than the production patch.
patch(
  'declare road collider',
  'let terrainCollider = null;\nlet heightfieldData = null;',
  'let terrainCollider = null;\nlet roadCollider = null;\nlet heightfieldData = null;'
);

// Rapier heightfields are column-major. Keep the existing ordering but increase local collision detail.
source = source.replace('const PHYS_RES = 129;', 'const PHYS_RES = 257;');

// Replace the coarse single square with a broad landscape plus a dense road-following corridor.
// Both use the same worldHeight() function as road placement and physics.
patch(
  'route-following terrain corridor',
  /let terrainMesh = null;[\s\S]*?\/\/ ---- Road geometry \(Three BufferGeometry \+ BVH\) --------------------------/,
`let terrainMesh = null;
let terrainCorridorMesh = null;
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
function terrainVertexColor(target, gx, gz, h) {
  const b = biomeAt(gz);
  const high = clamp((h - (b.base + 70)) / Math.max(45, b.relief), 0, 1);
  target.setHex(terrainBaseColor(gz)).lerp(terrainRock, high * 0.72);
  if (b.name === 'HIGH COUNTRY') target.lerp(terrainSnow, clamp((h - 165) / 55, 0, 0.55));
  target.offsetHSL(0, 0, detailNoise(gx * 0.0017, gz * 0.0017) * 0.045);
}
function disposeTerrainMesh() {
  for (const mesh of [terrainMesh, terrainCorridorMesh]) {
    if (!mesh) continue;
    terrainVisual.remove(mesh);
    mesh.geometry.dispose();
  }
  terrainMesh = null;
  terrainCorridorMesh = null;
}
function buildFarTerrain() {
  const segments = 128;
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
    terrainVertexColor(color, gx, gz, h);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
  }
  position.needsUpdate = true;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, terrainMaterial);
  mesh.receiveShadow = true;
  return mesh;
}
function buildRoadCorridorTerrain() {
  const zMin = -1900, zMax = 1900, zStep = 8;
  const lateralHalf = 180, lateralStep = 8;
  const rows = Math.floor((zMax - zMin) / zStep) + 1;
  const cols = Math.floor((lateralHalf * 2) / lateralStep) + 1;
  const positions = new Float32Array(rows * cols * 3);
  const colors = new Float32Array(rows * cols * 3);
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6);
  const color = new THREE.Color();
  let pi = 0, ii = 0;
  for (let r = 0; r < rows; r++) {
    const z = zMin + r * zStep;
    const centerGZ = origin.z + z;
    const heading = roadHeading(centerGZ);
    const nx = Math.cos(heading);
    const nz = -Math.sin(heading);
    const centerX = roadCenterX(centerGZ) - origin.x;
    for (let c = 0; c < cols; c++) {
      const lateral = -lateralHalf + c * lateralStep;
      const lx = centerX + nx * lateral;
      const lz = z + nz * lateral;
      const gx = origin.x + lx;
      const gz = origin.z + lz;
      const h = worldHeight(gx, gz) + 0.025;
      positions[pi] = lx; positions[pi + 1] = h; positions[pi + 2] = lz;
      terrainVertexColor(color, gx, gz, h);
      colors[pi] = color.r; colors[pi + 1] = color.g; colors[pi + 2] = color.b;
      pi += 3;
      if (r < rows - 1 && c < cols - 1) {
        const a = r * cols + c, b = a + 1, d = (r + 1) * cols + c, e = d + 1;
        indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
        indices[ii++] = b; indices[ii++] = d; indices[ii++] = e;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = terrainMaterial.clone();
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
function rebuildTerrain() {
  setLoad('Building road-following countryside…', 20);
  disposeTerrainMesh();
  terrainMesh = buildFarTerrain();
  terrainCorridorMesh = buildRoadCorridorTerrain();
  terrainVisual.add(terrainMesh, terrainCorridorMesh);
  rebuildPhysicsTerrain();
}

// ---- Road geometry (Three BufferGeometry + BVH) --------------------------`
);

// Cars selected out of the traffic FBX must keep the top-level FBX axis correction.
// Cloning a deep node without its ancestor transform was what left some cars standing vertically.
patch(
  'traffic world-transform clone helper',
  'function vehicleRootForLabel(pack, label) {',
`function cloneWorldNode(node) {
  node.updateWorldMatrix(true, true);
  const clone = node.clone(true);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  node.matrixWorld.decompose(p, q, s);
  clone.position.copy(p); clone.quaternion.copy(q); clone.scale.copy(s);
  clone.updateMatrixWorld(true);
  return clone;
}
function vehicleRootForLabel(pack, label) {`
);
source = source.replace(
  'const clone = normalizeModel(match.clone(true), /SUV|Pickup|Minivan/.test(label) ? 4.8 : 4.3);',
  'const clone = normalizeModel(cloneWorldNode(match), /SUV|Pickup|Minivan/.test(label) ? 4.8 : 4.3);'
);

// Extra orientation sanity check for any FBX vehicle whose "height" is actually its length.
patch(
  'vehicle vertical sanity',
  "  obj.updateMatrixWorld(true); let box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());\n  if (size.x > size.z * 1.12)",
  `  obj.updateMatrixWorld(true); let box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  if (size.y > Math.max(size.x, size.z) * 1.20) {
    obj.rotation.x += Math.PI / 2;
    obj.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(obj);
    size = box.getSize(new THREE.Vector3());
  }
  if (size.x > size.z * 1.12)`
);

// Discover actual wheel meshes and the steering wheel from the uploaded hatchback FBX.
patch(
  'player rig state',
  'let playerModel = null; const trafficPrototypes = [];',
`let playerModel = null; const trafficPrototypes = [];
const playerRig = { wheels: [], steeringWheel: null, steeringBase: null, eye: new THREE.Vector3(-0.42, 1.18, 0.25), frontSign: 1 };
function capturePlayerRig(root) {
  playerRig.wheels.length = 0;
  playerRig.steeringWheel = null;
  root.updateMatrixWorld(true);

  const rootInverse = root.matrixWorld.clone().invert();
  root.traverse(node => {
    const name = String(node.name || '').toLowerCase();
    if (name.includes('quad_wheel')) {
      const wp = new THREE.Vector3(); node.getWorldPosition(wp); wp.applyMatrix4(rootInverse);
      playerRig.wheels.push({ node, base: node.quaternion.clone(), local: wp, front: false });
    }
    if (!playerRig.steeringWheel && (name === 'wheelride' || name === 'wheelride.001' || name.includes('steering'))) {
      playerRig.steeringWheel = node;
      playerRig.steeringBase = node.quaternion.clone();
    }
  });

  let steeringLocal = null;
  if (playerRig.steeringWheel) {
    steeringLocal = new THREE.Vector3();
    playerRig.steeringWheel.getWorldPosition(steeringLocal);
    steeringLocal.applyMatrix4(rootInverse);
    playerRig.frontSign = steeringLocal.z >= 0 ? 1 : -1;
    playerRig.eye.set(
      steeringLocal.x,
      steeringLocal.y + 0.08,
      steeringLocal.z - playerRig.frontSign * 0.36
    );
  } else {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    playerRig.eye.set(center.x - size.x * 0.22, box.min.y + size.y * 0.68, center.z + size.z * 0.08);
  }

  if (playerRig.wheels.length) {
    const extrema = playerRig.wheels.map(w => w.local.z * playerRig.frontSign);
    const split = (Math.min(...extrema) + Math.max(...extrema)) * 0.5;
    for (const wheel of playerRig.wheels) wheel.front = wheel.local.z * playerRig.frontSign > split;
  }
  console.info('Player rig:', playerRig.wheels.length, 'road wheels; steering wheel:', playerRig.steeringWheel?.name || 'not found');
}
function animatePlayerRig() {
  const steerQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.steerVisual);
  const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), state.wheelSpin);
  for (const wheel of playerRig.wheels) {
    wheel.node.quaternion.copy(wheel.base);
    if (wheel.front) wheel.node.quaternion.multiply(steerQ);
    wheel.node.quaternion.multiply(spinQ);
  }
  if (playerRig.steeringWheel && playerRig.steeringBase) {
    const sw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -state.steerVisual * 2.25);
    playerRig.steeringWheel.quaternion.copy(playerRig.steeringBase).multiply(sw);
  }
}`
);
source = source.replace(
  '  playerVisualRoot.add(playerModel);',
  '  playerVisualRoot.add(playerModel);\n  capturePlayerRig(playerModel);'
);

// Fourth camera = inside the actual uploaded car.
source = source
  .replace("if (k === 'c') state.camera = (state.camera + 1) % 3;", "if (k === 'c') state.camera = (state.camera + 1) % 4;")
  .replace("state.camera = (state.camera + 1) % 3; $('touchInteract')", "state.camera = (state.camera + 1) % 4; $('touchInteract')");

patch(
  'visual steering state',
  'const state = { fuel: saved?.fuel ?? 100, tyre: saved?.tyre ?? 100, distance: saved?.distance ?? 0, incidents: saved?.incidents ?? 0, people: saved?.people ?? 0, camera: 0, started: false, paused: false, realistic: false, quality: 1, time: saved?.time ?? 7.4 };',
  'const state = { fuel: saved?.fuel ?? 100, tyre: saved?.tyre ?? 100, distance: saved?.distance ?? 0, incidents: saved?.incidents ?? 0, people: saved?.people ?? 0, camera: 0, started: false, paused: false, realistic: false, quality: 1, time: saved?.time ?? 7.4, steerVisual: 0, wheelSpin: 0 };'
);

patch(
  'wheel steering animation inputs',
  '    const speed = Math.abs(vehicle.currentVehicleSpeed()); const steerMax = lerp(0.52, 0.20, clamp(speed / 42, 0, 1)); const steering = steerIn * steerMax;',
  `    const signedSpeed = vehicle.currentVehicleSpeed();
    const speed = Math.abs(signedSpeed); const steerMax = lerp(0.52, 0.20, clamp(speed / 42, 0, 1)); const steering = steerIn * steerMax;
    state.steerVisual = damp(state.steerVisual, steering, 12, dt);
    state.wheelSpin += signedSpeed * dt / 0.34;`
);

patch(
  'animate rig before camera',
  '  updateTraffic(dt); updateInteraction();',
  '  updateTraffic(dt); updateInteraction(); animatePlayerRig();'
);

// Replace the camera selection block without touching walking mode.
patch(
  'interior camera',
  `    if (state.camera===0) cameraWanted.copy(focus).addScaledVector(fwd,-9.5).add(new THREE.Vector3(0,3.8,0));
    else if(state.camera===1) cameraWanted.copy(focus).addScaledVector(fwd,1.4).add(new THREE.Vector3(0,0.55,0));
    else cameraWanted.copy(focus).addScaledVector(fwd,-16).addScaledVector(right,6).add(new THREE.Vector3(0,7.5,0));
    camera.position.lerp(cameraWanted,1-Math.exp(-7*dt)); cameraTarget.copy(focus).addScaledVector(fwd,14); camera.lookAt(cameraTarget);`,
  `    if (state.camera===0) {
      camera.near = 0.08;
      cameraWanted.copy(focus).addScaledVector(fwd,-9.5).add(new THREE.Vector3(0,3.8,0));
      camera.position.lerp(cameraWanted,1-Math.exp(-7*dt));
      cameraTarget.copy(focus).addScaledVector(fwd,14);
    } else if(state.camera===1) {
      camera.near = 0.05;
      cameraWanted.copy(focus).addScaledVector(fwd,1.4).add(new THREE.Vector3(0,0.55,0));
      camera.position.lerp(cameraWanted,1-Math.exp(-10*dt));
      cameraTarget.copy(focus).addScaledVector(fwd,18);
    } else if(state.camera===2) {
      camera.near = 0.08;
      cameraWanted.copy(focus).addScaledVector(fwd,-16).addScaledVector(right,6).add(new THREE.Vector3(0,7.5,0));
      camera.position.lerp(cameraWanted,1-Math.exp(-7*dt));
      cameraTarget.copy(focus).addScaledVector(fwd,14);
    } else {
      camera.near = 0.025;
      cameraWanted.copy(playerRig.eye).applyQuaternion(quat).add(playerVisualRoot.position);
      camera.position.lerp(cameraWanted,1-Math.exp(-18*dt));
      cameraTarget.copy(cameraWanted).addScaledVector(fwd,25).add(new THREE.Vector3(0,0.05,0));
    }
    camera.updateProjectionMatrix();
    camera.lookAt(cameraTarget);`
);

// Re-bundle the patched readable production source.
await fs.writeFile('.build/final-game.js', source, 'utf8');
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
  define: { 'process.env.NODE_ENV': '"production"' },
});

console.log('Finish build: terrain corridor, traffic orientation, wheel/steering animation, and interior camera applied.');
