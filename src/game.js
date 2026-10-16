import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

const $ = (id) => document.getElementById(id);
const ui = {
  loading: $('loading'), loadText: $('loadText'), loadBar: $('loadBar'), drive: $('driveBtn'),
  hud: $('hud'), touch: $('touch'), region: $('region'), timeWeather: $('timeWeather'), speed: $('speed'),
  fuel: $('fuel'), tyre: $('tyre'), fuelBar: $('fuelBar'), tyreBar: $('tyreBar'), interaction: $('interaction'),
  toast: $('toast'), pause: $('pause'), journal: $('journal'), journalEntries: $('journalEntries'),
  jDistance: $('jDistance'), jPeople: $('jPeople'), jIncidents: $('jIncidents'),
};

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const rng01 = (n) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9eb5be);
scene.fog = new THREE.FogExp2(0x9eb5be, 0.00125);

const camera = new THREE.PerspectiveCamera(66, innerWidth / innerHeight, 0.08, 3500);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.45));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0xddeeff, 0x52604b, 2.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe8ca, 3.0);
sun.position.set(-120, 180, -80);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -130;
sun.shadow.camera.right = 130;
sun.shadow.camera.top = 130;
sun.shadow.camera.bottom = -130;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 450;
scene.add(sun);

const worldRoot = new THREE.Group();
scene.add(worldRoot);
const playerRoot = new THREE.Group();
scene.add(playerRoot);

const noise = new ImprovedNoise();
const SEED = 41.73;
const ROAD_HALF = 6.3;
const SHOULDER_HALF = 8.5;
const CHUNK = 320;
const TERRAIN_WIDTH = 1050;
const TERRAIN_COLS = 42;
const TERRAIN_ROWS = 28;

function noise2(x, z, scale = 1) {
  return noise.noise(x * scale + SEED, 0.27 + SEED, z * scale - SEED);
}
function roadX(z) {
  return Math.sin(z * 0.00135) * 92 + Math.sin(z * 0.0038 + 0.9) * 24 + noise2(0, z, 0.0007) * 24;
}
function roadY(z) {
  return 5 + Math.sin(z * 0.00075) * 10 + Math.sin(z * 0.0026 + 1.3) * 2.2 + noise2(17, z, 0.00055) * 7;
}
function rawTerrain(x, z) {
  const broad = noise2(x, z, 0.00115) * 17;
  const hills = noise2(x + 220, z - 510, 0.0032) * 6;
  const detail = noise2(x - 90, z + 130, 0.009) * 1.7;
  const ridges = Math.pow(Math.abs(noise2(x + 800, z, 0.00062)), 2.2) * 34;
  return broad + hills + detail + ridges - 4;
}
function terrainHeight(x, z) {
  const rx = roadX(z);
  const d = Math.abs(x - rx);
  const base = rawTerrain(x, z);
  const road = roadY(z);
  const roadBlend = 1 - smoothstep(10, 44, d);
  return lerp(base, road - 0.2, roadBlend);
}
function roadHeading(z) {
  const dz = 2;
  return Math.atan2(roadX(z + dz) - roadX(z - dz), dz * 2);
}
function roadSlope(z) {
  return Math.atan2(roadY(z + 2) - roadY(z - 2), 4);
}
function biomeAt(z) {
  const band = ((Math.floor(z / 6500) % 4) + 4) % 4;
  return [
    { name: 'COASTAL FOOTHILLS', grass: 0x66805a, tree: 0x2c5540, tree2: 0x3a6549, density: 0.58, fog: 0x9eb5be },
    { name: 'REDWOOD COUNTRY', grass: 0x4c6846, tree: 0x163b2b, tree2: 0x27523a, density: 1.0, fog: 0x8fa6a5 },
    { name: 'GOLDEN VALLEY', grass: 0x8b8858, tree: 0x425b36, tree2: 0x58683d, density: 0.34, fog: 0xb3b09a },
    { name: 'HIGH COUNTRY', grass: 0x66705b, tree: 0x263f32, tree2: 0x3d5444, density: 0.63, fog: 0xa7afb0 },
  ][band];
}

const mats = {
  road: new THREE.MeshStandardMaterial({ color: 0x34383a, roughness: 0.96, metalness: 0 }),
  shoulder: new THREE.MeshStandardMaterial({ color: 0x6d6552, roughness: 1 }),
  line: new THREE.MeshBasicMaterial({ color: 0xf0ead7 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x77766f, roughness: 1 }),
};

let playerVisual = null;
let trafficPrototypes = [];
let realPlayerLoaded = false;
let realTrafficLoaded = false;

function setLoad(text, pct) {
  ui.loadText.textContent = text;
  ui.loadBar.style.width = `${pct}%`;
}

function textureURLModifier(folder) {
  return (url) => {
    const clean = decodeURIComponent(url.split('?')[0]);
    const base = clean.split('/').pop().split('\\').pop();
    if (!base || base.startsWith('blob:') || base.startsWith('data:')) return url;
    const ext = base.toLowerCase().split('.').pop();
    if (!['png','jpg','jpeg','webp','bmp','gif','tga'].includes(ext)) return url;
    return `${folder}/${encodeURIComponent(base)}`;
  };
}

function normalizeModel(object, targetLength = 4.25) {
  object.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(object);
  let size = box.getSize(new THREE.Vector3());
  if (size.x > size.z * 1.18) {
    object.rotation.y += Math.PI / 2;
    object.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(object);
    size = box.getSize(new THREE.Vector3());
  }
  const length = Math.max(size.z, size.x, 0.001);
  const scale = targetLength / length;
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= minY;
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      const all = Array.isArray(o.material) ? o.material : [o.material];
      all.forEach((m) => {
        if (!m) return;
        m.side = THREE.FrontSide;
        if ('roughness' in m) m.roughness = Math.max(m.roughness ?? 0.55, 0.35);
      });
    }
  });
  return object;
}

function makeFallbackCar(color = 0x46627d) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2b35, roughness: 0.18, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.62, 4.25), bodyMat);
  body.position.y = 0.67; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.66, 2.0), glass);
  cabin.position.set(0, 1.29, -0.18); cabin.castShadow = true; g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.39, 0.39, 0.28, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151719, roughness: 0.9 });
  for (const x of [-1.04, 1.04]) for (const z of [-1.35, 1.35]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat); w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z); w.castShadow = true; g.add(w);
  }
  return g;
}

function loadFBX(url, textureFolder) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(textureURLModifier(textureFolder));
    const loader = new FBXLoader(manager);
    loader.load(url, resolve, undefined, reject);
  });
}

async function loadPlayerAsset() {
  try {
    setLoad('Loading your hatchback…', 18);
    const model = await loadFBX('./assets/player/HatchBackLowPoly.fbx', './assets/player/Textures');
    model.name = 'Uploaded player hatchback';
    normalizeModel(model, 4.25);
    realPlayerLoaded = true;
    return model;
  } catch (err) {
    console.error('Player FBX failed:', err);
    showToast('Player model could not load — using emergency fallback.');
    return makeFallbackCar();
  }
}

function extractTrafficCars(packRoot) {
  packRoot.updateMatrixWorld(true);
  const names = ['Compact', 'Coupe', 'Hatchback', 'Minivan', 'Offroad', 'Pickup', 'Sedan', 'Sport', 'SUV', 'Wagon'];
  const results = [];
  for (const label of names) {
    let body = null;
    packRoot.traverse((o) => {
      if (!body && o.isMesh && o.name.toLowerCase().includes(label.toLowerCase()) && o.name.toLowerCase().includes('body')) body = o;
    });
    if (!body) continue;
    const bodyBox = new THREE.Box3().setFromObject(body);
    const center = bodyBox.getCenter(new THREE.Vector3());
    const bodySize = bodyBox.getSize(new THREE.Vector3());
    const radius = Math.max(bodySize.x, bodySize.y, bodySize.z) * 1.55;
    const group = new THREE.Group();
    packRoot.traverse((o) => {
      if (!o.isMesh) return;
      const b = new THREE.Box3().setFromObject(o);
      const c = b.getCenter(new THREE.Vector3());
      if (c.distanceTo(center) > radius) return;
      const clone = o.clone(false);
      clone.geometry = o.geometry;
      clone.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material?.clone();
      clone.applyMatrix4(o.matrixWorld);
      group.add(clone);
    });
    if (!group.children.length) group.add(body.clone());
    group.updateMatrixWorld(true);
    const groupBox = new THREE.Box3().setFromObject(group);
    const gc = groupBox.getCenter(new THREE.Vector3());
    group.children.forEach((c) => c.position.sub(gc));
    normalizeModel(group, label === 'Pickup' || label === 'SUV' || label === 'Minivan' ? 4.8 : 4.35);
    group.name = label;
    const palette = [0x254867, 0x812f2b, 0x6c745e, 0xd0c9ba, 0x4c4d53, 0xb28d42, 0x33523e];
    group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name.toLowerCase().includes('body')) {
        o.material = new THREE.MeshStandardMaterial({ color: palette[results.length % palette.length], roughness: 0.45, metalness: 0.18 });
      }
      o.castShadow = true; o.receiveShadow = true;
    });
    results.push(group);
  }
  return results;
}

async function loadTrafficAssets() {
  try {
    setLoad('Loading the traffic pack…', 48);
    const pack = await loadFBX('./assets/traffic/fab.fbx', './assets/traffic/textures');
    trafficPrototypes = extractTrafficCars(pack);
    if (!trafficPrototypes.length) throw new Error('No named passenger cars found in pack.');
    realTrafficLoaded = true;
  } catch (err) {
    console.error('Traffic pack failed:', err);
    trafficPrototypes = [makeFallbackCar(0x7a3d38), makeFallbackCar(0xb8b5aa), makeFallbackCar(0x3c5c45)];
  }
}

const state = {
  x: roadX(0) + 2.5, z: 0, y: roadY(0), yaw: roadHeading(0), speed: 0, steer: 0,
  fuel: 100, tyre: 100, distance: 0, camera: 0, mode: 'drive', paused: false,
  started: false, time: 7.3, weather: 'CLEAR', incidents: 0, people: 0,
  realistic: false, quality: 1, lastSave: 0,
};
const walk = { x: state.x + 2.3, z: state.z, yaw: state.yaw, speed: 0 };
const input = { throttle: false, brake: false, left: false, right: false, interact: false };
const journal = [];

function saveGame() {
  try {
    localStorage.setItem('tdb-save-v5', JSON.stringify({
      x: state.x, z: state.z, yaw: state.yaw, fuel: state.fuel, tyre: state.tyre,
      distance: state.distance, time: state.time, journal: journal.slice(-80), people: state.people, incidents: state.incidents,
    }));
  } catch {}
}
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem('tdb-save-v5') || 'null');
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) return;
    Object.assign(state, s, { speed: 0, steer: 0, mode: 'drive', paused: false, started: false });
    if (Array.isArray(s.journal)) journal.push(...s.journal);
  } catch {}
}
loadSave();

const placeholder = makeFallbackCar(0x46627d);
playerRoot.add(placeholder);

const chunks = new Map();
const treeGeo = new THREE.ConeGeometry(3.0, 13, 7);
const trunkGeo = new THREE.CylinderGeometry(0.4, 0.55, 5, 7);
const rockGeo = new THREE.DodecahedronGeometry(1.8, 0);

function makeRoadStrip(z0, z1, halfWidth, material, yLift = 0) {
  const step = 8;
  const samples = Math.ceil((z1 - z0) / step) + 1;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < samples; i++) {
    const z = lerp(z0, z1, i / (samples - 1));
    const x = roadX(z), y = roadY(z) + yLift;
    const h = roadHeading(z);
    const nx = Math.cos(h), nz = -Math.sin(h);
    pos.push(x - nx * halfWidth, y, z - nz * halfWidth, x + nx * halfWidth, y, z + nz * halfWidth);
    uv.push(0, i, 1, i);
    if (i < samples - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material); mesh.receiveShadow = true;
  return mesh;
}

function makeLineGeometry(z0, z1, offset, width = 0.12, dashed = false) {
  const group = new THREE.Group();
  const interval = dashed ? 12 : 6;
  for (let z = z0; z < z1; z += interval) {
    if (dashed && Math.floor((z - z0) / interval) % 2) continue;
    const len = dashed ? 5.2 : Math.min(interval + 0.3, z1 - z);
    const mid = z + len / 2;
    const h = roadHeading(mid);
    const x = roadX(mid) + Math.cos(h) * offset;
    const y = roadY(mid) + 0.075;
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, 0.018, len), mats.line);
    box.position.set(x, y, mid); box.rotation.y = h; group.add(box);
  }
  return group;
}

function createServiceStop(stopZ, side = 1) {
  const g = new THREE.Group();
  const h = roadHeading(stopZ), rx = roadX(stopZ), y = roadY(stopZ);
  const nx = Math.cos(h), nz = -Math.sin(h);
  const cx = rx + nx * side * 22, cz = stopZ + nz * side * 22;
  g.position.set(cx, y, cz); g.rotation.y = h;
  const wall = new THREE.MeshStandardMaterial({ color: 0xe3ddd0, roughness: 0.82 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x26333a, roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xa94735, roughness: 0.65 });
  const shop = new THREE.Mesh(new THREE.BoxGeometry(12, 4.2, 7), wall); shop.position.set(8, 2.1, 0); shop.castShadow = shop.receiveShadow = true; g.add(shop);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(13, 0.45, 8), roof); canopy.position.set(-6, 4.5, 0); canopy.castShadow = true; g.add(canopy);
  for (const zz of [-2.3, 2.3]) {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.7), red); pump.position.set(-6, 0.9, zz); pump.castShadow = true; g.add(pump);
  }
  const gib = new THREE.Group();
  const c = new THREE.MeshStandardMaterial({ color: 0x6883a0, roughness: 0.65 });
  const black = new THREE.MeshBasicMaterial({ color: 0x08090a });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), c); body.scale.y = 1.12; body.position.y = 0.72; gib.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), c); head.position.y = 1.72; gib.add(head);
  for (const ex of [-0.14, 0.14]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), black); eye.position.set(ex, 1.75, 0.38); gib.add(eye); }
  gib.position.set(6, 0, 4); gib.userData.gibling = true; g.add(gib);
  g.userData.stop = { z: stopZ, x: cx, side, gibling: gib };
  return g;
}

function createChunk(index) {
  const z0 = index * CHUNK, z1 = z0 + CHUNK, mid = (z0 + z1) / 2;
  const biome = biomeAt(mid);
  const group = new THREE.Group(); group.userData.index = index;

  const terrainMat = new THREE.MeshStandardMaterial({ color: biome.grass, roughness: 1, metalness: 0 });
  const geo = new THREE.PlaneGeometry(TERRAIN_WIDTH, CHUNK, TERRAIN_COLS, TERRAIN_ROWS);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const centerX = roadX(mid);
  for (let i = 0; i < p.count; i++) {
    const gx = centerX + p.getX(i), gz = mid + p.getZ(i);
    p.setX(i, gx); p.setY(i, terrainHeight(gx, gz)); p.setZ(i, gz);
  }
  p.needsUpdate = true; geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, terrainMat); terrain.receiveShadow = true; group.add(terrain);

  group.add(makeRoadStrip(z0 - 5, z1 + 5, SHOULDER_HALF, mats.shoulder, 0.015));
  group.add(makeRoadStrip(z0 - 5, z1 + 5, ROAD_HALF, mats.road, 0.055));
  group.add(makeLineGeometry(z0, z1, 0, 0.11, true));
  group.add(makeLineGeometry(z0, z1, -5.65, 0.08, false));
  group.add(makeLineGeometry(z0, z1, 5.65, 0.08, false));

  const count = Math.floor(115 * biome.density);
  const canopyMat = new THREE.MeshStandardMaterial({ color: biome.tree, roughness: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4938, roughness: 1 });
  const canopies = new THREE.InstancedMesh(treeGeo, canopyMat, count);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const r1 = rng01(index * 1000 + i * 7.1), r2 = rng01(index * 700 + i * 13.7);
    const z = z0 + r1 * CHUNK;
    const side = r2 < 0.5 ? -1 : 1;
    const dist = 24 + rng01(index * 91 + i * 31) * 430;
    const x = roadX(z) + side * dist;
    const y = terrainHeight(x, z);
    const scale = 0.72 + rng01(index * 37 + i * 19) * 1.45;
    dummy.position.set(x, y + 6.5 * scale, z); dummy.scale.set(scale, scale, scale); dummy.rotation.y = r1 * Math.PI * 2; dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + 2.5 * scale, z); dummy.scale.set(scale, scale, scale); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
  }
  canopies.castShadow = trunks.castShadow = true;
  group.add(canopies, trunks);

  const rockCount = 28;
  const rocks = new THREE.InstancedMesh(rockGeo, mats.rock, rockCount);
  for (let i = 0; i < rockCount; i++) {
    const z = z0 + rng01(index * 311 + i * 22) * CHUNK;
    const side = rng01(index * 177 + i * 51) < 0.5 ? -1 : 1;
    const x = roadX(z) + side * (18 + rng01(index * 503 + i) * 360);
    const y = terrainHeight(x, z), sc = 0.4 + rng01(i + index * 2) * 1.8;
    dummy.position.set(x, y + sc * 0.4, z); dummy.scale.set(sc, sc * 0.65, sc); dummy.rotation.set(rng01(i)*0.4, rng01(i+2)*6, rng01(i+4)*0.4); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.castShadow = rocks.receiveShadow = true; group.add(rocks);

  const firstStop = Math.ceil(z0 / 4800) * 4800 + 1150;
  if (firstStop >= z0 && firstStop < z1) group.add(createServiceStop(firstStop, 1));

  worldRoot.add(group); chunks.set(index, group);
}

function updateChunks() {
  if (!Number.isFinite(state.z)) { state.z = 0; state.x = roadX(0) + 2.5; }
  const center = Math.floor(state.z / CHUNK);
  const radius = state.quality === 0 ? 3 : 5;
  for (let i = center - 2; i <= center + radius; i++) if (!chunks.has(i)) createChunk(i);
  for (const [i, g] of chunks) {
    if (i < center - 3 || i > center + radius + 1) {
      worldRoot.remove(g);
      g.traverse((o) => { if (o.geometry && ![treeGeo, trunkGeo, rockGeo].includes(o.geometry)) o.geometry.dispose?.(); });
      chunks.delete(i);
    }
  }
}

const traffic = [];
const trafficGroup = new THREE.Group(); worldRoot.add(trafficGroup);

function cloneTrafficPrototype(i) {
  const proto = trafficPrototypes.length ? trafficPrototypes[i % trafficPrototypes.length] : makeFallbackCar();
  const c = proto.clone(true);
  c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return c;
}
function respawnTraffic(car, slot) {
  const forward = slot % 4 !== 0;
  car.dir = forward ? 1 : -1;
  car.z = state.z + (forward ? 120 : 180) + slot * 92 + rng01(slot + state.z) * 180;
  if (!forward) car.z = state.z + 260 + slot * 80;
  car.lane = forward ? 2.55 : -2.55;
  car.targetLane = car.lane;
  car.speed = forward ? 16 + rng01(slot * 4.1) * 14 : 18 + rng01(slot * 3.3) * 13;
  car.desired = (forward ? 20 : 22) + rng01(slot * 11.4) * 17;
  car.aggression = rng01(slot * 18.2);
  car.politeness = rng01(slot * 7.9);
  car.skill = 0.45 + rng01(slot * 14.2) * 0.55;
  car.frustration = 0;
  car.overtaking = false;
  car.crashed = false;
  car.crashYaw = 0;
}
function spawnTraffic() {
  for (const c of traffic) trafficGroup.remove(c.mesh);
  traffic.length = 0;
  const count = state.quality === 0 ? 12 : 20;
  for (let i = 0; i < count; i++) {
    const car = { mesh: cloneTrafficPrototype(i) };
    trafficGroup.add(car.mesh); respawnTraffic(car, i); traffic.push(car);
  }
}
function nearestLeader(car) {
  let best = null, gap = Infinity;
  for (const other of traffic) {
    if (other === car || other.crashed || other.dir !== car.dir) continue;
    if (Math.abs(other.targetLane - car.targetLane) > 2) continue;
    const dz = (other.z - car.z) * car.dir;
    if (dz > 0 && dz < gap) { gap = dz; best = other; }
  }
  return { car: best, gap };
}
function oncomingGapAt(z) {
  let gap = Infinity;
  for (const o of traffic) if (o.dir < 0 && !o.crashed) gap = Math.min(gap, Math.abs(o.z - z));
  return gap;
}
function updateTraffic(dt) {
  for (let i = 0; i < traffic.length; i++) {
    const c = traffic[i];
    if (c.crashed) {
      c.speed = Math.max(0, c.speed - 12 * dt);
      c.crashYaw += dt * (0.3 + c.aggression);
    } else {
      const lead = nearestLeader(c);
      const v = c.speed, v0 = c.desired, aMax = 2.0 + c.skill * 1.3, b = 2.0 + c.skill * 2.0;
      let accel = aMax * (1 - Math.pow(v / Math.max(v0, 1), 4));
      if (lead.car && lead.gap < 100) {
        const dv = v - lead.car.speed;
        const T = lerp(2.1, 0.72, c.aggression);
        const s0 = lerp(5.5, 2.0, c.aggression);
        const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(aMax * b)));
        accel -= aMax * Math.pow(sStar / Math.max(lead.gap - 4.5, 1), 2);
        c.frustration = clamp(c.frustration + dt * (lead.gap < 28 ? 0.2 + c.aggression * 0.55 : -0.25), 0, 1);
        if (c.dir > 0 && !c.overtaking && c.frustration > lerp(0.92, 0.35, c.aggression)) {
          const oncoming = oncomingGapAt(c.z + 60);
          const safe = lerp(150, 68, c.aggression) * lerp(1.1, 0.75, c.skill);
          if (oncoming > safe) { c.overtaking = true; c.targetLane = -2.4; c.desired *= 1.08; }
          else if (c.aggression > 0.86 && rng01(c.z * 0.03 + i) > 0.8) { c.overtaking = true; c.targetLane = -2.4; }
        }
        if (c.overtaking && (c.z - lead.car.z) > 18) { c.overtaking = false; c.targetLane = 2.55; c.frustration *= 0.25; }
      } else c.frustration = Math.max(0, c.frustration - dt * 0.2);
      c.speed = clamp(c.speed + accel * dt, 2, 44);
      c.lane = damp(c.lane, c.targetLane, 1.4 + c.skill * 1.4, dt);
      c.z += c.speed * c.dir * dt;
    }

    if (Math.abs(c.z - state.z) > 1350) respawnTraffic(c, i + Math.floor(state.z / 100));
    const z = c.z, h = roadHeading(z), x = roadX(z) + Math.cos(h) * c.lane;
    c.mesh.position.set(x, roadY(z) + 0.04, z);
    c.mesh.rotation.set(roadSlope(z), h + (c.dir < 0 ? Math.PI : 0) + c.crashYaw, 0);
  }
  for (let i = 0; i < traffic.length; i++) for (let j = i + 1; j < traffic.length; j++) {
    const a = traffic[i], b = traffic[j]; if (a.crashed && b.crashed) continue;
    if (Math.abs(a.z - b.z) < 3.8) {
      const ax = roadX(a.z) + Math.cos(roadHeading(a.z)) * a.lane;
      const bx = roadX(b.z) + Math.cos(roadHeading(b.z)) * b.lane;
      if (Math.abs(ax - bx) < 2.0) {
        a.crashed = b.crashed = true; a.crashYaw = -0.4; b.crashYaw = 0.5;
        if (Math.abs(a.z - state.z) < 120) { state.incidents++; addJournal('Traffic crash', 'Two drivers misjudged the same piece of road.'); showToast('Traffic crash ahead.'); }
      }
    }
  }
}

const stops = [];
function refreshStops() {
  stops.length = 0;
  for (const g of chunks.values()) g.traverse((o) => { if (o.userData.stop) stops.push(o.userData.stop); });
}
function nearestStop() {
  let best = null, d = Infinity;
  for (const s of stops) {
    const dd = Math.hypot(state.x - s.x, state.z - s.z);
    if (dd < d) { d = dd; best = s; }
  }
  return { stop: best, dist: d };
}
function showToast(text, seconds = 2.4) {
  if (!ui.toast) return;
  ui.toast.textContent = text; ui.toast.classList.add('show');
  clearTimeout(showToast._t); showToast._t = setTimeout(() => ui.toast.classList.remove('show'), seconds * 1000);
}
function addJournal(title, text) {
  journal.push({ title, text, time: `${Math.floor(state.time).toString().padStart(2, '0')}:${Math.floor((state.time % 1) * 60).toString().padStart(2, '0')}` });
  if (journal.length > 100) journal.shift();
}
function updateInteraction() {
  refreshStops();
  const ns = nearestStop();
  let label = '';
  if (state.mode === 'drive') {
    if (Math.abs(state.speed) < 0.8) label = 'E · GET OUT';
    if (ns.stop && ns.dist < 16 && Math.abs(state.speed) < 1) label = 'E · REFUEL / STOP';
  } else {
    const dCar = Math.hypot(walk.x - state.x, walk.z - state.z);
    if (dCar < 3.2) label = 'E · GET IN';
    if (ns.stop && Math.hypot(walk.x - ns.stop.x, walk.z - ns.stop.z) < 10) label = 'E · TALK / REFUEL';
  }
  ui.interaction.textContent = label;
  ui.interaction.classList.toggle('hidden', !label);
  $('touchInteract').classList.toggle('hidden', !label);
}
function interact() {
  const ns = nearestStop();
  if (state.mode === 'drive') {
    if (ns.stop && ns.dist < 16 && Math.abs(state.speed) < 1) {
      state.fuel = 100; state.tyre = Math.max(state.tyre, 92); state.people++;
      addJournal('Roadside stop', 'Refuelled and met a traveller beside the road.'); showToast('Tank full. A Gibling waves from the forecourt.'); return;
    }
    if (Math.abs(state.speed) < 0.8) {
      state.mode = 'walk'; walk.x = state.x + Math.cos(state.yaw) * 2.6; walk.z = state.z - Math.sin(state.yaw) * 2.6; walk.yaw = state.yaw; showToast('Out of the car.');
    }
  } else {
    const dCar = Math.hypot(walk.x - state.x, walk.z - state.z);
    if (dCar < 3.2) { state.mode = 'drive'; showToast('Back in the car.'); return; }
    if (ns.stop && Math.hypot(walk.x - ns.stop.x, walk.z - ns.stop.z) < 10) {
      state.fuel = 100; state.people++; addJournal('Traveller met', 'A roadside Gibling was heading toward the next region.'); showToast('“Road is clear past the ridge. Mostly.”');
    }
  }
}

const keyMap = {
  w: 'throttle', arrowup: 'throttle', s: 'brake', arrowdown: 'brake',
  a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
};
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (keyMap[k]) { input[keyMap[k]] = true; e.preventDefault(); }
  if (k === 'c') state.camera = (state.camera + 1) % 3;
  if (k === 'e') interact();
  if (k === 'j') openJournal();
  if (k === 'r') recover();
  if (e.key === 'Escape') togglePause();
});
addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (keyMap[k]) input[keyMap[k]] = false; });
for (const b of document.querySelectorAll('[data-hold]')) {
  const k = b.dataset.hold;
  const down = (e) => { e.preventDefault(); input[k] = true; try { b.setPointerCapture(e.pointerId); } catch {} };
  const up = () => { input[k] = false; };
  b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
}
$('touchCamera').onclick = () => state.camera = (state.camera + 1) % 3;
$('touchInteract').onclick = interact;

function recover() {
  state.x = roadX(state.z) + Math.cos(roadHeading(state.z)) * 2.5;
  state.yaw = roadHeading(state.z); state.speed = 0; state.steer = 0; state.mode = 'drive'; showToast('Recovered to the road.');
}
function updateDrive(dt) {
  const throttle = input.throttle ? 1 : 0, brake = input.brake ? 1 : 0;
  const steerInput = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  state.steer = damp(state.steer, steerInput, state.realistic ? 5.5 : 8.5, dt);
  const h = roadHeading(state.z), roadCenter = roadX(state.z);
  const lateral = Math.abs((state.x - roadCenter) * Math.cos(h));
  const onRoad = lateral < ROAD_HALF + 1.5;
  const maxSpeed = state.realistic ? 54 : 48;
  const engine = throttle * (state.speed < 28 ? 7.2 : 4.2);
  const brakeForce = brake * (state.speed > 0.5 ? 17 : 0);
  const drag = 0.24 + state.speed * 0.012 + (!onRoad ? 2.8 : 0);
  state.speed = clamp(state.speed + (engine - brakeForce - drag) * dt, 0, maxSpeed);
  if (state.fuel <= 0) state.speed = Math.max(0, state.speed - 4 * dt);
  const steerAuthority = state.realistic ? 0.78 : 0.92;
  state.yaw += state.steer * steerAuthority * (state.speed / (5.5 + state.speed * 0.18)) * dt;
  const dx = Math.sin(state.yaw) * state.speed * dt, dz = Math.cos(state.yaw) * state.speed * dt;
  state.x += dx; state.z += dz; state.distance += Math.hypot(dx, dz);
  state.fuel = Math.max(0, state.fuel - (0.00028 + throttle * 0.00034) * state.speed * dt);
  if (!onRoad && state.speed > 22) state.tyre = Math.max(0, state.tyre - (state.speed - 22) * 0.00035 * dt);

  for (const c of traffic) {
    if (Math.abs(c.z - state.z) > 4.0) continue;
    const cx = roadX(c.z) + Math.cos(roadHeading(c.z)) * c.lane;
    if (Math.abs(cx - state.x) < 2.0) {
      state.speed *= 0.38; state.tyre = Math.max(0, state.tyre - 9); c.crashed = true; c.crashYaw = c.aggression > 0.5 ? 0.45 : -0.45;
      state.incidents++; addJournal('Collision', 'A traffic encounter ended with bent metal and a damaged tyre.'); showToast('Impact. Tyre condition reduced.');
    }
  }
}
function updateWalk(dt) {
  const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  walk.yaw += turn * 1.75 * dt;
  const move = (input.throttle ? 1 : 0) - (input.brake ? 0.55 : 0);
  walk.x += Math.sin(walk.yaw) * move * 4.0 * dt;
  walk.z += Math.cos(walk.yaw) * move * 4.0 * dt;
}

function togglePause() { state.paused = !state.paused; ui.pause.classList.toggle('hidden', !state.paused); }
$('pauseBtn').onclick = togglePause; $('resumeBtn').onclick = togglePause;
$('recoverBtn').onclick = () => { recover(); if (state.paused) togglePause(); };
$('handlingBtn').onclick = () => { state.realistic = !state.realistic; $('handlingBtn').textContent = state.realistic ? 'REALISTIC' : 'ACCESSIBLE'; };
$('graphicsBtn').onclick = () => {
  state.quality = (state.quality + 1) % 3;
  const names = ['LOW', 'BALANCED', 'HIGH']; $('graphicsBtn').textContent = names[state.quality];
  renderer.setPixelRatio(state.quality === 0 ? 1 : Math.min(devicePixelRatio, state.quality === 1 ? 1.45 : 1.8));
};
$('journalBtn').onclick = () => { togglePause(); openJournal(); };
$('closeJournal').onclick = () => ui.journal.classList.add('hidden');
function openJournal() {
  ui.jDistance.textContent = (state.distance / 1000).toFixed(1); ui.jPeople.textContent = state.people; ui.jIncidents.textContent = state.incidents;
  ui.journalEntries.innerHTML = journal.length ? journal.slice().reverse().map(e => `<div class="entry"><b>${e.title}</b><span>${e.time} · ${e.text}</span></div>`).join('') : '<div class="empty">The road is still unwritten.</div>';
  ui.journal.classList.remove('hidden');
}

const cameraPos = new THREE.Vector3(), cameraAim = new THREE.Vector3();
function updatePlayerVisual(dt) {
  const y = terrainHeight(state.x, state.z);
  state.y = y;
  const forwardH = terrainHeight(state.x + Math.sin(state.yaw) * 2.0, state.z + Math.cos(state.yaw) * 2.0);
  const backH = terrainHeight(state.x - Math.sin(state.yaw) * 2.0, state.z - Math.cos(state.yaw) * 2.0);
  const rightH = terrainHeight(state.x + Math.cos(state.yaw) * 1.0, state.z - Math.sin(state.yaw) * 1.0);
  const leftH = terrainHeight(state.x - Math.cos(state.yaw) * 1.0, state.z + Math.sin(state.yaw) * 1.0);
  const pitch = Math.atan2(forwardH - backH, 4.0);
  const roll = -Math.atan2(rightH - leftH, 2.0) - state.steer * clamp(state.speed / 45, 0, 1) * 0.08;
  playerRoot.position.set(0, 0.08, 0);
  playerRoot.rotation.set(pitch, state.yaw, roll, 'YXZ');
}
function updateCamera(dt) {
  if (state.mode === 'walk') {
    const y = terrainHeight(walk.x, walk.z) + 1.65;
    worldRoot.position.set(-walk.x, -y, -walk.z);
    camera.position.set(0, 0, 0); camera.rotation.set(0, walk.yaw, 0, 'YXZ');
    playerRoot.position.set(state.x - walk.x, state.y - y + 0.08, state.z - walk.z);
    return;
  }
  worldRoot.position.set(-state.x, -state.y, -state.z);
  const fwd = new THREE.Vector3(Math.sin(state.yaw), 0, Math.cos(state.yaw));
  if (state.camera === 0) {
    cameraPos.set(-fwd.x * 10.5, 4.8, -fwd.z * 10.5);
    cameraAim.set(fwd.x * 8, 1.15, fwd.z * 8);
  } else if (state.camera === 1) {
    cameraPos.set(fwd.x * 1.15, 1.45, fwd.z * 1.15);
    cameraAim.set(fwd.x * 28, 1.2, fwd.z * 28);
  } else {
    cameraPos.set(-fwd.x * 18 + Math.cos(state.yaw) * 7, 8.8, -fwd.z * 18 - Math.sin(state.yaw) * 7);
    cameraAim.set(fwd.x * 5, 1.0, fwd.z * 5);
  }
  camera.position.lerp(cameraPos, 1 - Math.exp(-7 * dt)); camera.lookAt(cameraAim);
}
function updateSky(dt) {
  state.time = (state.time + dt * 0.012) % 24;
  const day = clamp(Math.sin((state.time - 6) / 12 * Math.PI), 0.08, 1);
  const biome = biomeAt(state.z);
  const sky = new THREE.Color(biome.fog).lerp(new THREE.Color(0x7088a2), 1 - day);
  scene.background.copy(sky); scene.fog.color.copy(sky);
  sun.intensity = 0.5 + day * 2.8; hemi.intensity = 0.8 + day * 1.3;
  sun.position.set(-120, 60 + day * 130, -80);
  ui.region.textContent = biome.name;
  const hh = Math.floor(state.time).toString().padStart(2, '0'), mm = Math.floor((state.time % 1) * 60).toString().padStart(2, '0');
  ui.timeWeather.textContent = `${hh}:${mm} · ${state.weather}`;
}
function updateHUD() {
  ui.speed.textContent = state.mode === 'drive' ? Math.round(state.speed * 3.6) : 'WALK';
  ui.fuel.textContent = Math.round(state.fuel); ui.tyre.textContent = Math.round(state.tyre);
  ui.fuelBar.style.width = `${state.fuel}%`; ui.tyreBar.style.width = `${state.tyre}%`;
}

async function boot() {
  setLoad('Preparing the road…', 5);
  updateChunks();
  setLoad('Loading your hatchback…', 12);
  const p = await loadPlayerAsset();
  placeholder.removeFromParent(); playerVisual = p; playerRoot.add(playerVisual);
  setLoad('Loading traffic cars…', 48);
  await loadTrafficAssets();
  setLoad('Populating the road…', 82);
  spawnTraffic();
  setLoad('Ready to drive.', 100);
  ui.drive.disabled = false;
  const note = $('protocolNote');
  note.textContent = `${realPlayerLoaded ? 'uploaded hatchback' : 'fallback hatchback'} · ${realTrafficLoaded ? trafficPrototypes.length + ' traffic models from your pack' : 'fallback traffic'} · streamed procedural terrain`;
}
ui.drive.onclick = () => {
  state.started = true; state.paused = false; state.mode = 'drive'; recover();
  ui.loading.classList.add('hidden'); ui.hud.classList.remove('hidden'); ui.touch.classList.remove('hidden');
  addJournal('Journey started', `Set out in ${biomeAt(state.z).name.toLowerCase()}.`);
};

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  if (state.started && !state.paused) {
    if (state.mode === 'drive') updateDrive(dt); else updateWalk(dt);
    updateChunks(); updateTraffic(dt); updatePlayerVisual(dt); updateInteraction(); updateSky(dt); updateHUD();
    if (now - state.lastSave > 12000) { state.lastSave = now; saveGame(); }
  }
  updateCamera(dt);
  renderer.render(scene, camera);
}

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
addEventListener('pagehide', saveGame);
boot().catch((err) => { console.error(err); ui.loadText.textContent = 'Could not prepare the game.'; $('protocolNote').textContent = String(err?.message || err); });
requestAnimationFrame(frame);
