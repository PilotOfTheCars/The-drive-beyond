import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { TerrainLOD } from '@interverse/three-terrain-lod';
import Dexie from 'dexie';
import { createNoise2D } from 'simplex-noise';
import { createActor, createMachine } from 'xstate';
import * as YUKA from 'yuka';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { joinRoom } from 'trystero';

// The Drive Beyond - open-source integration build.
// Game-specific glue/identity is ours; rendering, terrain LOD, physics, AI,
// state orchestration, persistence, spatial acceleration and P2P are mature OSS.

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

const $ = (id) => document.getElementById(id);
const ui = {
  loading: $('loading'), loadText: $('loadText'), loadBar: $('loadBar'), drive: $('driveBtn'),
  protocol: $('protocolNote'), hud: $('hud'), touch: $('touch'), region: $('region'),
  timeWeather: $('timeWeather'), speed: $('speed'), fuel: $('fuel'), tyre: $('tyre'),
  fuelBar: $('fuelBar'), tyreBar: $('tyreBar'), interaction: $('interaction'), toast: $('toast'),
  pause: $('pause'), journal: $('journal'), journalEntries: $('journalEntries'),
  jDistance: $('jDistance'), jPeople: $('jPeople'), jIncidents: $('jIncidents'),
};
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const smooth = (a, b, x) => { const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1); return t * t * (3 - 2 * t); };
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function setLoad(text, pct) {
  if (ui.loadText) ui.loadText.textContent = text;
  if (ui.loadBar) ui.loadBar.style.width = `${pct}%`;
}
function toast(text, seconds = 2.5) {
  if (!ui.toast) return;
  ui.toast.textContent = text; ui.toast.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => ui.toast.classList.remove('show'), seconds * 1000);
}

// Deterministic xorshift RNG used only to seed simplex-noise and repeatable placement.
function seededRandom(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
const terrainNoise = createNoise2D(seededRandom(0x54444231));
const roadNoise = createNoise2D(seededRandom(0x54444232));
const detailNoise = createNoise2D(seededRandom(0x54444233));
const placementNoise = createNoise2D(seededRandom(0x54444234));

const WORLD_SIZE = 4096;
const MAX_HEIGHT = 240;
const HEIGHT_RES = 257;
const PHYS_RES = 129;
const ROAD_HALF = 3.65;
const SHOULDER_HALF = 5.25;
const LANE_OFFSET = 1.85;
const RECENTER_DISTANCE = 720;
const FIXED_DT = 1 / 60;

function biomeAt(gz) {
  const i = ((Math.floor(gz / 7000) % 4) + 4) % 4;
  return [
    { name: 'COASTAL FOOTHILLS', relief: 62, base: 36, fog: 0x9fb7c1, density: 0.55 },
    { name: 'REDWOOD COUNTRY', relief: 86, base: 42, fog: 0x91a7a6, density: 1.00 },
    { name: 'GOLDEN VALLEY', relief: 45, base: 31, fog: 0xb4b09a, density: 0.32 },
    { name: 'HIGH COUNTRY', relief: 135, base: 50, fog: 0xa8b0b2, density: 0.67 },
  ][i];
}
function roadCenterX(gz) {
  return roadNoise(gz * 0.00034, 4.5) * 230 + roadNoise(gz * 0.00095, 14.2) * 62;
}
function roadElevation(gz) {
  const b = biomeAt(gz);
  const broad = roadNoise(gz * 0.00022, 30.1) * Math.min(b.relief * 0.35, 34);
  const wave = roadNoise(gz * 0.0008, 52.7) * 5.5;
  return clamp(b.base + 42 + broad + wave, 13, MAX_HEIGHT - 32);
}
function roadHeading(gz) {
  const d = 3;
  return Math.atan2(roadCenterX(gz + d) - roadCenterX(gz - d), d * 2);
}
function rawTerrain(gx, gz) {
  const b = biomeAt(gz);
  const continental = terrainNoise(gx * 0.00042, gz * 0.00042) * b.relief * 0.62;
  const hills = terrainNoise((gx + 1900) * 0.00125, (gz - 700) * 0.00125) * b.relief * 0.28;
  const ridgedSample = 1 - Math.abs(terrainNoise((gx - 800) * 0.00068, (gz + 1200) * 0.00068));
  const ridges = Math.pow(ridgedSample, 3.0) * b.relief * 0.78;
  const detail = detailNoise(gx * 0.006, gz * 0.006) * 2.5;
  return clamp(b.base + 38 + continental + hills + ridges + detail, 4, MAX_HEIGHT - 4);
}
function worldHeight(gx, gz) {
  const rx = roadCenterX(gz);
  const d = Math.abs(gx - rx);
  const road = roadElevation(gz);
  const raw = rawTerrain(gx, gz);
  if (d <= ROAD_HALF) return road - 0.18;
  if (d <= SHOULDER_HALF) return lerp(road - 0.18, road - 0.42, smooth(ROAD_HALF, SHOULDER_HALF, d));
  if (d < 30) {
    const t = smooth(SHOULDER_HALF, 30, d);
    const ditch = road - 0.42 - Math.sin(t * Math.PI) * 1.15;
    return lerp(ditch, raw, t);
  }
  return raw;
}

// ---- Renderer -------------------------------------------------------------
setLoad('Starting the open-source renderer…', 3);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(67, innerWidth / innerHeight, 0.08, 5000);
const renderer = new WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);
await renderer.init();

const hemi = new THREE.HemisphereLight(0xe7f2ff, 0x465241, 1.7); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe5bd, 3.0); sun.position.set(-120, 180, -80); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -130; sun.shadow.camera.right = 130; sun.shadow.camera.top = 130; sun.shadow.camera.bottom = -130; sun.shadow.camera.near = 1; sun.shadow.camera.far = 430; scene.add(sun);
scene.background = new THREE.Color(0xa6bec8); scene.fog = new THREE.FogExp2(0xa6bec8, 0.00062);

const worldVisual = new THREE.Group(); scene.add(worldVisual);
const roadVisual = new THREE.Group(); worldVisual.add(roadVisual);
const sceneryVisual = new THREE.Group(); worldVisual.add(sceneryVisual);
const trafficVisual = new THREE.Group(); worldVisual.add(trafficVisual);
const stopVisual = new THREE.Group(); worldVisual.add(stopVisual);
const playerVisualRoot = new THREE.Group(); scene.add(playerVisualRoot);

// ---- Persistent state: Dexie ---------------------------------------------
const db = new Dexie('TheDriveBeyond');
db.version(1).stores({ saves: 'id,updated', journal: '++id,time,type', people: 'id,lastMet' });
let saved = null;
try { saved = await db.saves.get('main'); } catch (e) { console.warn('Dexie unavailable, continuing without persistence', e); }
const journal = [];
async function addJournal(type, title, text) {
  const entry = { type, title, text, time: Date.now() }; journal.push(entry);
  try { await db.journal.add(entry); } catch {}
}

// ---- XState: interaction mode --------------------------------------------
const modeMachine = createMachine({
  id: 'playerMode', initial: 'driving',
  states: {
    driving: { on: { EXIT: 'walking' } },
    walking: { on: { ENTER: 'driving' } },
  }
});
const modeActor = createActor(modeMachine); modeActor.start();
const isWalking = () => modeActor.getSnapshot().value === 'walking';

// ---- Rapier physics -------------------------------------------------------
setLoad('Starting Rapier vehicle physics…', 10);
await RAPIER.init();
const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
physics.integrationParameters.dt = FIXED_DT;
let terrainCollider = null;
let heightfieldData = null;

const origin = {
  x: saved?.originX ?? 0,
  z: saved?.originZ ?? 0,
};

function sampleHeightGrid(resolution) {
  const n = resolution;
  const arr = new Float32Array(n * n);
  for (let row = 0; row < n; row++) {
    const lz = -WORLD_SIZE / 2 + (row / (n - 1)) * WORLD_SIZE;
    for (let col = 0; col < n; col++) {
      const lx = -WORLD_SIZE / 2 + (col / (n - 1)) * WORLD_SIZE;
      arr[col * n + row] = clamp(worldHeight(origin.x + lx, origin.z + lz) / MAX_HEIGHT, 0, 1);
    }
  }
  return arr;
}
function makeHeightCanvas() {
  const canvas = document.createElement('canvas'); canvas.width = HEIGHT_RES; canvas.height = HEIGHT_RES;
  const ctx = canvas.getContext('2d', { willReadFrequently: false }); const img = ctx.createImageData(HEIGHT_RES, HEIGHT_RES);
  const d = img.data;
  for (let y = 0; y < HEIGHT_RES; y++) {
    const lz = -WORLD_SIZE / 2 + (y / (HEIGHT_RES - 1)) * WORLD_SIZE;
    for (let x = 0; x < HEIGHT_RES; x++) {
      const lx = -WORLD_SIZE / 2 + (x / (HEIGHT_RES - 1)) * WORLD_SIZE;
      const h = Math.round(clamp(worldHeight(origin.x + lx, origin.z + lz) / MAX_HEIGHT, 0, 1) * 255);
      const i = (y * HEIGHT_RES + x) * 4; d[i] = d[i + 1] = d[i + 2] = h; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0); return canvas;
}
function rebuildPhysicsTerrain() {
  if (terrainCollider) physics.removeCollider(terrainCollider, true);
  heightfieldData = sampleHeightGrid(PHYS_RES);
  const desc = RAPIER.ColliderDesc.heightfield(PHYS_RES - 1, PHYS_RES - 1, heightfieldData, { x: WORLD_SIZE, y: MAX_HEIGHT, z: WORLD_SIZE });
  desc.setFriction(1.1); terrainCollider = physics.createCollider(desc);
}

// ---- Open-source TerrainLOD ----------------------------------------------
let terrainLOD = null;
async function rebuildTerrainLOD() {
  setLoad('Building quadtree terrain LOD…', 20);
  const canvas = makeHeightCanvas();
  if (terrainLOD) { worldVisual.remove(terrainLOD); terrainLOD.dispose?.(); }
  terrainLOD = new TerrainLOD({
    heightMapUrl: canvas.toDataURL('image/png'),
    worldSize: WORLD_SIZE,
    maxHeight: MAX_HEIGHT,
    levels: 6,
    resolution: 48,
    maxChunks: 1400,
    lodDistanceRatio: 1.75,
    lodHysteresis: 1.22,
    skirtDepth: 2.4,
    heightSmoothing: 0.18,
    heightSmoothingSpread: 1.25,
  });
  await terrainLOD.init();
  worldVisual.add(terrainLOD);
  rebuildPhysicsTerrain();
}

// ---- Road geometry (Three BufferGeometry + BVH) --------------------------
const roadMat = new THREE.MeshStandardMaterial({ color: 0x303436, roughness: 0.94, metalness: 0.01 });
const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x756c58, roughness: 1 });
const lineMat = new THREE.MeshBasicMaterial({ color: 0xf0ecdc });
function roadPoint(localZ, lateral = 0, lift = 0.12) {
  const gz = origin.z + localZ; const rx = roadCenterX(gz) - origin.x; const h = roadHeading(gz);
  return new THREE.Vector3(rx + Math.cos(h) * lateral, roadElevation(gz) + lift, localZ - Math.sin(h) * lateral);
}
function ribbon(z0, z1, half, material, lift) {
  const step = 5, rows = Math.ceil((z1 - z0) / step) + 1, pos = [], uv = [], idx = [];
  for (let i = 0; i < rows; i++) {
    const z = lerp(z0, z1, i / (rows - 1));
    for (const side of [-half, half]) { const p = roadPoint(z, side, lift); pos.push(p.x, p.y, p.z); uv.push(side < 0 ? 0 : 1, z / 7); }
    if (i < rows - 1) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  g.computeBoundsTree(); const m = new THREE.Mesh(g, material); m.receiveShadow = true; return m;
}
function rebuildRoad() {
  if (roadCollider) { physics.removeCollider(roadCollider, true); roadCollider = null; }
  for (const child of roadVisual.children) { child.geometry?.disposeBoundsTree?.(); child.geometry?.dispose(); }
  roadVisual.clear();
  roadVisual.add(ribbon(-1900, 1900, SHOULDER_HALF, shoulderMat, 0.03));
  const drivingSurface = ribbon(-1900, 1900, ROAD_HALF, roadMat, 0.09);
  roadVisual.add(drivingSurface);
  // Match the visual asphalt with an exact static Rapier triangle mesh.
  // A coarse heightfield alone cannot resolve a 7.3-metre-wide road.
  const geometry = drivingSurface.geometry;
  const verts = new Float32Array(geometry.attributes.position.array);
  const faces = new Uint32Array(geometry.index.array);
  roadCollider = physics.createCollider(RAPIER.ColliderDesc.trimesh(verts, faces).setFriction(1.2));
  roadVisual.add(ribbon(-1900, 1900, 0.065, lineMat, 0.125));
  roadVisual.add(ribbon(-1900, 1900, ROAD_HALF - 0.24, lineMat, 0.125));
  roadVisual.add(ribbon(-1900, 1900, -(ROAD_HALF - 0.24), lineMat, 0.125));
}

// ---- Vehicle assets -------------------------------------------------------
function textureURLModifier(folder) {
  return (url) => {
    const base = decodeURIComponent(url.split('?')[0]).split('/').pop().split('\\').pop();
    if (!base || /^(blob:|data:)/.test(base)) return url;
    return `${folder}/${encodeURIComponent(base)}`;
  };
}
function loadFBX(url, textureFolder) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager(); manager.setURLModifier(textureURLModifier(textureFolder));
    new FBXLoader(manager).load(url, resolve, undefined, reject);
  });
}
function normalizeModel(obj, targetLength = 4.25) {
  obj.updateMatrixWorld(true); let box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  if (size.x > size.z * 1.12) { obj.rotation.y += Math.PI / 2; obj.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(obj); size = box.getSize(new THREE.Vector3()); }
  obj.scale.multiplyScalar(targetLength / Math.max(size.z, size.x, 0.001)); obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj); const center = box.getCenter(new THREE.Vector3()); obj.position.x -= center.x; obj.position.z -= center.z; obj.position.y -= box.min.y;
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if ('roughness' in m) m.roughness = Math.max(m.roughness ?? 0.35, 0.28); }); } } });
  return obj;
}
function fallbackCar(color = 0x45627e) {
  const g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.62, 4.1), new THREE.MeshStandardMaterial({ color, roughness: 0.55 })); body.position.y = 0.65; body.castShadow = true; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.65, 2.0), new THREE.MeshStandardMaterial({ color: 0x25343d, roughness: 0.25 })); cab.position.set(0, 1.25, -0.15); g.add(cab); return g;
}
let playerModel = null; const trafficPrototypes = [];
async function loadVehicleAssets() {
  setLoad('Loading your hatchback…', 42);
  try { playerModel = normalizeModel(await loadFBX('./assets/player/HatchBackLowPoly.fbx', './assets/player/Textures'), 4.25); }
  catch (e) { console.warn(e); playerModel = fallbackCar(); }
  playerVisualRoot.add(playerModel);
  setLoad('Loading the CC-licensed traffic pack…', 52);
  try {
    const pack = await loadFBX('./assets/traffic/fab.fbx', './assets/traffic/textures'); pack.updateMatrixWorld(true);
    const names = ['Compact','Coupe','Hatchback','Minivan','Offroad','Pickup','Sedan','Sport','SUV','Wagon'];
    for (const label of names) {
      let match = null; pack.traverse(o => { if (!match && (o.isGroup || o.isMesh) && o.name?.toLowerCase().includes(label.toLowerCase())) match = o; });
      if (match) trafficPrototypes.push(normalizeModel(match.clone(true), /SUV|Pickup|Minivan/.test(label) ? 4.8 : 4.3));
    }
  } catch (e) { console.warn('traffic asset pack failed', e); }
  if (!trafficPrototypes.length) trafficPrototypes.push(fallbackCar(0x8b3c38), fallbackCar(0xc5c0b4), fallbackCar(0x3e604a));
}

// ---- CC0 Quaternius nature assets ----------------------------------------
const gltfLoader = new GLTFLoader(); let treeProto = null, rockProto = null;
async function loadNatureAssets() {
  setLoad('Loading CC0 countryside assets…', 60);
  try { treeProto = (await gltfLoader.loadAsync('./assets/open/nature/BirchTree_1.gltf')).scene; }
  catch (e) { console.warn('CC0 tree missing', e); }
  try { rockProto = (await gltfLoader.loadAsync('./assets/open/nature/Rock_Medium_1.gltf')).scene; }
  catch (e) { console.warn('CC0 rock missing', e); }
}
function scatterScenery() {
  sceneryVisual.clear(); const b = biomeAt(origin.z); const treeCount = Math.round(78 * b.density + 34); const rockCount = 34;
  for (let i = 0; i < treeCount; i++) {
    const rz = placementNoise(i * 1.73, origin.z * 0.00013), rx = placementNoise(i * 2.91 + 50, origin.z * 0.00019);
    const lz = rz * 3300, side = rx < 0 ? -1 : 1, gz = origin.z + lz, roadXLocal = roadCenterX(gz) - origin.x;
    const dist = 26 + Math.abs(rx) * 620, lx = roadXLocal + side * dist; if (Math.abs(lx) > 1750) continue;
    const obj = treeProto ? treeProto.clone(true) : null; if (!obj) continue; const gy = worldHeight(origin.x + lx, gz); obj.position.set(lx, gy, lz); obj.scale.setScalar(1.0 + Math.abs(rz) * 1.25); obj.rotation.y = Math.abs(rx) * Math.PI * 2; obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); sceneryVisual.add(obj);
  }
  for (let i = 0; i < rockCount; i++) {
    const rz = placementNoise(i * 3.2 + 100, origin.z * 0.00016), rx = placementNoise(i * 4.7 + 20, origin.z * 0.00021);
    const lz = rz * 3200, gz = origin.z + lz, side = rx < 0 ? -1 : 1, lx = roadCenterX(gz) - origin.x + side * (18 + Math.abs(rx) * 500);
    if (!rockProto || Math.abs(lx) > 1700) continue; const obj = rockProto.clone(true); obj.position.set(lx, worldHeight(origin.x + lx, gz), lz); obj.scale.setScalar(0.65 + Math.abs(rz) * 1.8); obj.rotation.y = Math.abs(rx) * 6.28; sceneryVisual.add(obj);
  }
}

// ---- Service stop + Giblings ---------------------------------------------
const stops = [];
function gibling(color = 0x6d87a0) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color, roughness: 0.72 }), eye = new THREE.MeshBasicMaterial({ color: 0x050607 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), mat); body.scale.y = 1.12; body.position.y = 0.72; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), mat); head.position.y = 1.75; g.add(head);
  for (const x of [-0.14, 0.14]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), eye); e.position.set(x, 1.78, 0.38); g.add(e); }
  return g;
}
const yukaManager = new YUKA.EntityManager(); const travellers = [];
function rebuildStops() {
  stopVisual.clear(); stops.length = 0; travellers.length = 0; yukaManager.clear?.();
  const nearest = Math.round(origin.z / 4200) * 4200;
  for (const gz of [nearest - 4200, nearest, nearest + 4200]) {
    const lz = gz - origin.z; if (Math.abs(lz) > 1850) continue; const h = roadHeading(gz), side = ((Math.floor(gz / 4200) & 1) ? -1 : 1), x = roadCenterX(gz) - origin.x + Math.cos(h) * side * 20, y = roadElevation(gz);
    const g = new THREE.Group(); g.position.set(x, y, lz); g.rotation.y = h;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(30, 0.18, 22), new THREE.MeshStandardMaterial({ color: 0x79715e, roughness: 1 })); g.add(slab);
    const shop = new THREE.Mesh(new THREE.BoxGeometry(11, 4.2, 7), new THREE.MeshStandardMaterial({ color: 0xe1dbce, roughness: 0.82 })); shop.position.set(side * 7, 2.1, 3); shop.castShadow = true; g.add(shop);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(13, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x26333a, roughness: 0.7 })); canopy.position.set(-side * 5, 4.4, -1); g.add(canopy);
    for (const pz of [-2.5, 2.5]) { const pump = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.7), new THREE.MeshStandardMaterial({ color: 0xa64837 })); pump.position.set(-side * 5, 0.9, pz); g.add(pump); }
    const gib = gibling(); gib.position.set(side * 5, 0.1, -5); g.add(gib); stopVisual.add(g); const st = { gx: origin.x + x, gz, localX: x, localZ: lz, mesh: g, gib }; stops.push(st);
    const agent = new YUKA.Vehicle(); agent.position.set(x + side * 5, y, lz - 5); agent.maxSpeed = 0.35; const wander = new YUKA.WanderBehavior(); wander.weight = 0.2; agent.steering.add(wander); yukaManager.add(agent); travellers.push({ agent, mesh: gib, base: new THREE.Vector3(x + side * 5, y, lz - 5) });
  }
}

// ---- Player chassis / Rapier ray-cast vehicle ----------------------------
let chassis, vehicle;
function createVehicle() {
  const startGZ = saved?.globalZ ?? origin.z;
  const startLX = roadCenterX(startGZ) - origin.x + LANE_OFFSET;
  const startLZ = startGZ - origin.z;
  const startY = roadElevation(startGZ) + 1.45;
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roadHeading(startGZ));
  chassis = physics.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(startLX, startY, startLZ).setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }).setLinearDamping(0.15).setAngularDamping(0.65).setCanSleep(false));
  physics.createCollider(RAPIER.ColliderDesc.cuboid(0.88, 0.34, 1.92).setTranslation(0, 0.38, 0).setDensity(250).setFriction(0.8), chassis);
  vehicle = physics.createVehicleController(chassis); vehicle.indexUpAxis = 1; vehicle.indexForwardAxis = 2;
  const positions = [
    { x: -0.82, y: 0.18, z: 1.28 }, { x: 0.82, y: 0.18, z: 1.28 },
    { x: -0.82, y: 0.18, z: -1.28 }, { x: 0.82, y: 0.18, z: -1.28 },
  ];
  for (const p of positions) vehicle.addWheel(p, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.34, 0.36);
  for (let i = 0; i < 4; i++) { vehicle.setWheelSuspensionStiffness(i, 32); vehicle.setWheelSuspensionCompression(i, 4.4); vehicle.setWheelSuspensionRelaxation(i, 5.4); vehicle.setWheelFrictionSlip(i, 3.0); vehicle.setWheelSideFrictionStiffness(i, 1.15); vehicle.setWheelMaxSuspensionTravel(i, 0.32); vehicle.setWheelMaxSuspensionForce(i, 6000); }
}

// ---- Traffic: IDM core adapted from SaintPepsi/traffic-microsim (MIT) ----
// Source: https://github.com/SaintPepsi/traffic-microsim
const DRIVER_PROFILES = {
  calm:       { comply: .96, T: 1.8, a: 1.1, b: 2.0, s0: 2.5, politeness: .65, threshold: .35 },
  normal:     { comply: 1.02, T: 1.35, a: 1.5, b: 2.4, s0: 2.0, politeness: .45, threshold: .22 },
  impatient:  { comply: 1.16, T: .92, a: 2.0, b: 3.1, s0: 1.6, politeness: .15, threshold: .10 },
  lunatic:    { comply: 1.34, T: .60, a: 2.5, b: 3.7, s0: 1.15, politeness: .03, threshold: .04 },
};
function desiredGap(p, v, dv) { const dynamic = v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)); return p.s0 + Math.max(0, dynamic); }
function idmAccel(p, v, gap, dv, v0) { const free = 1 - Math.pow(v / Math.max(v0, 1), 4); const interaction = Math.pow(desiredGap(p, v, dv) / Math.max(gap, 0.1), 2); return p.a * (free - interaction); }
const traffic = [];
function trafficMesh(i) { return trafficPrototypes[i % trafficPrototypes.length].clone(true); }
function spawnTraffic() {
  trafficVisual.clear(); traffic.length = 0; const keys = Object.keys(DRIVER_PROFILES);
  const playerGZ = origin.z + chassis.translation().z;
  for (let i = 0; i < 22; i++) {
    const profileName = keys[(i * 7 + 2) % keys.length], profile = DRIVER_PROFILES[profileName], oncoming = i % 5 === 0;
    const car = { mesh: trafficMesh(i), gz: playerGZ + 90 + i * 105, lane: oncoming ? -LANE_OFFSET : LANE_OFFSET, targetLane: oncoming ? -LANE_OFFSET : LANE_OFFSET, dir: oncoming ? -1 : 1, speed: 13 + (i % 7) * 2.1, v0: (22 + (i % 8) * 1.3) * profile.comply, profile, frustration: 0, perception: 0.86 + ((i * 17) % 27) / 100, overtaking: false, crashed: false, crashYaw: 0 };
    traffic.push(car); trafficVisual.add(car.mesh);
  }
}
function findLead(car) {
  let lead = null, gap = Infinity;
  for (const o of traffic) {
    if (o === car || o.crashed || o.dir !== car.dir || Math.abs(o.lane - car.lane) > 0.8) continue;
    const d = (o.gz - car.gz) * car.dir; if (d > 0 && d < gap) { gap = d; lead = o; }
  }
  return { car: lead, gap: gap - 4.4 };
}
function nearestOncomingAhead(car) {
  let best = Infinity;
  for (const o of traffic) if (o.dir !== car.dir && !o.crashed) { const d = (o.gz - car.gz) * car.dir; if (d > 0) best = Math.min(best, d); }
  return best;
}
function updateTraffic(dt) {
  const pgz = origin.z + chassis.translation().z;
  for (let i = 0; i < traffic.length; i++) {
    const c = traffic[i];
    if (Math.abs(c.gz - pgz) > 1500) { c.gz = pgz + 350 + (i * 97 % 900); c.crashed = false; c.overtaking = false; c.dir = i % 5 === 0 ? -1 : 1; c.lane = c.dir < 0 ? -LANE_OFFSET : LANE_OFFSET; c.targetLane = c.lane; c.speed = 15 + (i % 7) * 1.7; }
    if (!c.crashed) {
      const lead = findLead(c); const dv = lead.car ? c.speed - lead.car.speed : 0; let a = idmAccel(c.profile, c.speed, lead.gap, dv, c.v0);
      if (lead.car && lead.gap < 38) c.frustration = clamp(c.frustration + dt * (0.12 + (1 - c.profile.politeness) * 0.35), 0, 1); else c.frustration = Math.max(0, c.frustration - dt * 0.14);
      if (c.dir > 0 && lead.car && !c.overtaking && c.frustration > 0.35 + c.profile.politeness * 0.4) {
        const oncoming = nearestOncomingAhead(c); const believed = oncoming / c.perception;
        if (believed > 115 - c.frustration * 55) { c.overtaking = true; c.targetLane = -LANE_OFFSET; }
      }
      if (c.overtaking) {
        const danger = nearestOncomingAhead(c); if (danger < 55 && c.perception > 0.9) c.targetLane = LANE_OFFSET;
        if (!lead.car || (lead.car.gz - c.gz) * c.dir < -14) { c.overtaking = false; c.targetLane = LANE_OFFSET; c.frustration *= 0.25; }
      }
      c.speed = clamp(c.speed + a * dt, 0, 48); c.lane = damp(c.lane, c.targetLane, 1.6, dt); c.gz += c.speed * c.dir * dt;
    }
    const lz = c.gz - origin.z, gx = roadCenterX(c.gz) + Math.cos(roadHeading(c.gz)) * c.lane, lx = gx - origin.x, gy = roadElevation(c.gz) + 0.08;
    c.mesh.position.set(lx, gy, lz); c.mesh.rotation.set(0, roadHeading(c.gz) + (c.dir < 0 ? Math.PI : 0) + c.crashYaw, 0);
  }
  for (let i = 0; i < traffic.length; i++) for (let j = i + 1; j < traffic.length; j++) {
    const a = traffic[i], b = traffic[j]; if (a.crashed && b.crashed) continue;
    if (Math.abs(a.gz - b.gz) < 3.7 && Math.abs(a.lane - b.lane) < 1.65) { a.crashed = b.crashed = true; a.speed = b.speed = 0; a.crashYaw = -0.45; b.crashYaw = 0.52; if (Math.abs(a.gz - pgz) < 150) { state.incidents++; addJournal('incident', 'Traffic crash', 'Two drivers made incompatible decisions.'); toast('Traffic crash ahead.'); } }
  }
}

// ---- Input / state --------------------------------------------------------
const input = { throttle: false, brake: false, left: false, right: false };
const state = { fuel: saved?.fuel ?? 100, tyre: saved?.tyre ?? 100, distance: saved?.distance ?? 0, incidents: saved?.incidents ?? 0, people: saved?.people ?? 0, camera: 0, started: false, paused: false, realistic: false, quality: 1, time: saved?.time ?? 7.4 };
const keyMap = { w: 'throttle', arrowup: 'throttle', s: 'brake', arrowdown: 'brake', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
addEventListener('keydown', e => { const k = e.key.toLowerCase(); if (keyMap[k]) { input[keyMap[k]] = true; e.preventDefault(); } if (k === 'c') state.camera = (state.camera + 1) % 3; if (k === 'e') interact(); if (k === 'j') openJournal(); if (k === 'r') recover(); if (e.key === 'Escape') togglePause(); });
addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (keyMap[k]) input[keyMap[k]] = false; });
for (const b of document.querySelectorAll('[data-hold]')) { const k = b.dataset.hold, up = () => input[k] = false; b.addEventListener('pointerdown', e => { e.preventDefault(); input[k] = true; try { b.setPointerCapture(e.pointerId); } catch {} }); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up); }
$('touchCamera').onclick = () => state.camera = (state.camera + 1) % 3; $('touchInteract').onclick = () => interact();

const walk = { x: 0, z: 0, yaw: 0 };
function playerGlobal() { const p = chassis.translation(); return { x: origin.x + p.x, y: p.y, z: origin.z + p.z }; }
function nearestStop(walking = false) {
  const p = walking ? { x: origin.x + walk.x, z: origin.z + walk.z } : playerGlobal(); let best = null, dist = Infinity;
  for (const s of stops) { const d = Math.hypot(p.x - s.gx, p.z - s.gz); if (d < dist) { dist = d; best = s; } } return { stop: best, dist };
}
function interact() {
  if (!state.started) return;
  if (!isWalking()) {
    const speed = Math.abs(vehicle.currentVehicleSpeed()); const ns = nearestStop(false);
    if (ns.stop && ns.dist < 18 && speed < 1) { state.fuel = 100; state.tyre = Math.max(state.tyre, 94); state.people++; addJournal('stop', 'Roadside stop', 'Refuelled and met a Gibling traveller.'); toast('Tank full. A Gibling nods from the forecourt.'); return; }
    if (speed < 0.7) { const p = chassis.translation(); walk.x = p.x + 2.3; walk.z = p.z; walk.yaw = roadHeading(origin.z + p.z); modeActor.send({ type: 'EXIT' }); toast('Out of the car.'); }
  } else {
    const p = chassis.translation(); if (Math.hypot(walk.x - p.x, walk.z - p.z) < 3.2) { modeActor.send({ type: 'ENTER' }); toast('Back in the car.'); return; }
    const ns = nearestStop(true); if (ns.stop && ns.dist < 11) { state.people++; addJournal('person', 'Traveller met', 'A Gibling was heading toward the next region.'); toast('“The road gets interesting after the ridge.”'); }
  }
}
function recover() {
  const p = chassis.translation(), gz = origin.z + p.z, lx = roadCenterX(gz) - origin.x + LANE_OFFSET, y = roadElevation(gz) + 1.6, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), roadHeading(gz));
  chassis.setTranslation({ x: lx, y, z: p.z }, true); chassis.setRotation({ x:q.x,y:q.y,z:q.z,w:q.w }, true); chassis.setLinvel({x:0,y:0,z:0}, true); chassis.setAngvel({x:0,y:0,z:0}, true); modeActor.send({ type: 'ENTER' }); toast('Recovered to the road.');
}

// ---- Multiplayer: Trystero P2P ------------------------------------------
let room = null, sendPose = null;
window.TDB = window.TDB || {};
window.TDB.joinFriendSession = (code) => {
  if (room) return room;
  room = joinRoom({ appId: 'the-drive-beyond-v1' }, String(code || 'road'));
  const [send, get] = room.makeAction('pose'); sendPose = send;
  get((pose, peerId) => window.dispatchEvent(new CustomEvent('tdb-peer-pose', { detail: { pose, peerId } })));
  toast(`Friend session ${code} joined.`); return room;
};
window.TDB.leaveFriendSession = () => { room?.leave?.(); room = null; sendPose = null; };

// ---- World rebuild --------------------------------------------------------
async function rebuildWorld() {
  await rebuildTerrainLOD(); rebuildRoad(); scatterScenery(); rebuildStops();
}
async function maybeRecenter() {
  if (isWalking()) return;
  const p = chassis.translation(); if (Math.hypot(p.x, p.z) < RECENTER_DISTANCE) return;
  origin.x += p.x; origin.z += p.z; chassis.setTranslation({ x: 0, y: p.y, z: 0 }, true);
  setLoad('Streaming the next landscape…', 92); await rebuildWorld(); spawnTraffic();
}

// ---- UI ------------------------------------------------------------------
function togglePause() { state.paused = !state.paused; ui.pause.classList.toggle('hidden', !state.paused); }
$('pauseBtn').onclick = togglePause; $('resumeBtn').onclick = togglePause; $('recoverBtn').onclick = () => { recover(); if (state.paused) togglePause(); };
$('handlingBtn').onclick = () => { state.realistic = !state.realistic; $('handlingBtn').textContent = state.realistic ? 'REALISTIC' : 'ACCESSIBLE'; };
$('graphicsBtn').onclick = () => { state.quality = (state.quality + 1) % 3; const names = ['LOW','BALANCED','HIGH']; $('graphicsBtn').textContent = names[state.quality]; renderer.setPixelRatio(state.quality === 0 ? 0.9 : Math.min(devicePixelRatio, state.quality === 1 ? 1.25 : 1.6)); renderer.shadowMap.enabled = state.quality > 0; };
$('journalBtn').onclick = () => { togglePause(); openJournal(); }; $('closeJournal').onclick = () => ui.journal.classList.add('hidden');
async function openJournal() {
  ui.jDistance.textContent = (state.distance / 1000).toFixed(1); ui.jPeople.textContent = state.people; ui.jIncidents.textContent = state.incidents;
  let entries = journal; try { entries = await db.journal.orderBy('id').reverse().limit(30).toArray(); } catch {}
  ui.journalEntries.innerHTML = entries.length ? entries.map(e => `<div class="entry"><b>${e.title}</b><span>${new Date(e.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · ${e.text}</span></div>`).join('') : '<div class="empty">The road is still unwritten.</div>';
  ui.journal.classList.remove('hidden');
}
function updateInteraction() {
  let label = ''; if (!isWalking()) { const ns = nearestStop(false), speed = Math.abs(vehicle.currentVehicleSpeed()); if (speed < .7) label = 'E · GET OUT'; if (ns.stop && ns.dist < 18 && speed < 1) label = 'E · REFUEL / STOP'; }
  else { const p = chassis.translation(); if (Math.hypot(walk.x-p.x,walk.z-p.z)<3.2) label='E · GET IN'; const ns=nearestStop(true); if(ns.stop&&ns.dist<11) label='E · TALK / REFUEL'; }
  ui.interaction.textContent = label; ui.interaction.classList.toggle('hidden', !label); $('touchInteract').classList.toggle('hidden', !label);
}

// ---- Main fixed-step simulation ------------------------------------------
const cameraTarget = new THREE.Vector3(), cameraWanted = new THREE.Vector3(); let accumulator = 0, last = performance.now(), saveClock = 0, recentering = false;
function physicsStep(dt) {
  const throttle = input.throttle ? 1 : 0, brake = input.brake ? 1 : 0, steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  if (!isWalking()) {
    const speed = Math.abs(vehicle.currentVehicleSpeed()); const steerMax = lerp(0.52, 0.20, clamp(speed / 42, 0, 1)); const steering = steerIn * steerMax;
    const engine = throttle * (state.realistic ? 1950 : 2300); const brakeForce = brake * 70;
    for (let i = 0; i < 4; i++) { vehicle.setWheelEngineForce(i, engine); vehicle.setWheelBrake(i, brakeForce); }
    vehicle.setWheelSteering(0, steering); vehicle.setWheelSteering(1, steering);
    vehicle.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC); physics.step();
    // Never allow a transient physics/terrain mismatch to bury the car.
    // Recovery preserves the uploaded 3D model and restores wheel contact.
    const cp = chassis.translation();
    const expectedGround = worldHeight(origin.x + cp.x, origin.z + cp.z);
    if (!Number.isFinite(cp.y) || cp.y < expectedGround - 1.1) {
      recover();
      toast('Vehicle recovered after ground collision loss.');
    }
    const kmh = speed * 3.6; state.fuel = Math.max(0, state.fuel - (0.00005 + throttle * 0.00011) * speed); state.distance += speed * dt;
    if (state.fuel <= 0) for (let i=0;i<4;i++) vehicle.setWheelEngineForce(i,0);
    const pg = playerGlobal(); const offroad = Math.abs(pg.x - roadCenterX(pg.z)) > SHOULDER_HALF + 1.5; if (offroad && kmh > 75) state.tyre = Math.max(0, state.tyre - (kmh - 75) * 0.00006);
  } else {
    const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0); walk.yaw += turn * 1.75 * dt; const move = (input.throttle ? 1 : 0) - (input.brake ? 0.55 : 0); walk.x += Math.sin(walk.yaw) * move * 4.1 * dt; walk.z += Math.cos(walk.yaw) * move * 4.1 * dt;
  }
}
function syncVisuals(dt) {
  const p = chassis.translation(), q = chassis.rotation();
  if (!isWalking()) { playerVisualRoot.visible = true; playerVisualRoot.position.set(p.x, p.y - 0.44, p.z); playerVisualRoot.quaternion.set(q.x,q.y,q.z,q.w); }
  else playerVisualRoot.position.set(p.x, p.y - 0.44, p.z);
  yukaManager.update(dt); for (const t of travellers) { t.mesh.position.x += (t.agent.position.x - t.mesh.getWorldPosition(new THREE.Vector3()).x) * 0.0; }
  updateTraffic(dt); updateInteraction();
  const focus = isWalking() ? new THREE.Vector3(walk.x, worldHeight(origin.x+walk.x, origin.z+walk.z)+1.65, walk.z) : new THREE.Vector3(p.x,p.y+0.65,p.z);
  if (isWalking()) { cameraWanted.copy(focus); cameraWanted.y += 0.05; camera.position.lerp(cameraWanted, .35); cameraTarget.set(focus.x+Math.sin(walk.yaw)*20,focus.y-0.15,focus.z+Math.cos(walk.yaw)*20); camera.lookAt(cameraTarget); }
  else {
    const quat = new THREE.Quaternion(q.x,q.y,q.z,q.w), fwd = new THREE.Vector3(0,0,1).applyQuaternion(quat), right = new THREE.Vector3(1,0,0).applyQuaternion(quat);
    if (state.camera===0) cameraWanted.copy(focus).addScaledVector(fwd,-9.5).add(new THREE.Vector3(0,3.8,0));
    else if(state.camera===1) cameraWanted.copy(focus).addScaledVector(fwd,1.4).add(new THREE.Vector3(0,0.55,0));
    else cameraWanted.copy(focus).addScaledVector(fwd,-16).addScaledVector(right,6).add(new THREE.Vector3(0,7.5,0));
    camera.position.lerp(cameraWanted,1-Math.exp(-7*dt)); cameraTarget.copy(focus).addScaledVector(fwd,14); camera.lookAt(cameraTarget);
  }
  terrainLOD?.update(camera); sun.position.set(focus.x-120,focus.y+180,focus.z-80);
}
async function persist() {
  const pg = playerGlobal(); try { await db.saves.put({ id:'main', updated:Date.now(), originX:origin.x, originZ:origin.z, globalZ:pg.z, fuel:state.fuel, tyre:state.tyre, distance:state.distance, incidents:state.incidents, people:state.people, time:state.time }); } catch {}
}
function updateHUD() {
  const pg = playerGlobal(), speed = isWalking() ? 0 : Math.abs(vehicle.currentVehicleSpeed())*3.6, b=biomeAt(pg.z); ui.region.textContent=b.name; ui.speed.textContent=isWalking()?'WALK':Math.round(speed); ui.fuel.textContent=Math.round(state.fuel);ui.tyre.textContent=Math.round(state.tyre);ui.fuelBar.style.width=`${state.fuel}%`;ui.tyreBar.style.width=`${state.tyre}%`;
  state.time=(state.time+0.0002)%24;const hh=Math.floor(state.time).toString().padStart(2,'0'),mm=Math.floor((state.time%1)*60).toString().padStart(2,'0');ui.timeWeather.textContent=`${hh}:${mm} · CLEAR`; scene.fog.color.setHex(b.fog); scene.background.setHex(b.fog);
}
function loop(now) {
  const dt = Math.min((now-last)/1000,0.08);last=now;if(state.started&&!state.paused){accumulator+=dt;while(accumulator>=FIXED_DT){physicsStep(FIXED_DT);accumulator-=FIXED_DT;}syncVisuals(dt);updateHUD();saveClock+=dt;if(saveClock>8){saveClock=0;persist();}const p=chassis.translation();if(!recentering&&Math.hypot(p.x,p.z)>RECENTER_DISTANCE){recentering=true;maybeRecenter().finally(()=>recentering=false);}if(sendPose&&now%120<17){const pg=playerGlobal();sendPose({x:pg.x,y:pg.y,z:pg.z});}}renderer.render(scene,camera);requestAnimationFrame(loop);
}

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

// ---- Boot ----------------------------------------------------------------
try {
  await rebuildWorld();
  await loadVehicleAssets();
  await loadNatureAssets(); scatterScenery();
  createVehicle(); spawnTraffic();
  setLoad('Open-source systems online · road ready', 100);
  ui.protocol.textContent='Three.js + TerrainLOD + Rapier + IDM/MOBIL base + Yuka + XState + Dexie';
  ui.drive.disabled=false;
  ui.drive.onclick=()=>{state.started=true;ui.loading.classList.add('hidden');ui.hud.classList.remove('hidden');ui.touch.classList.remove('hidden');toast('No destination. Just drive.');};
} catch (err) {
  console.error(err); setLoad('Could not start the game.',100); ui.protocol.textContent=String(err?.stack||err?.message||err);
}
requestAnimationFrame(loop);
