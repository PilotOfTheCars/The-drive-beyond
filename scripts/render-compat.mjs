import fs from 'node:fs/promises';
import { build } from 'esbuild';

let source = await fs.readFile('.build/final-game.js', 'utf8');

function must(label, pattern, replacement) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`render-compat failed: ${label}`);
  source = next;
}

// iPadOS browsers are WebKit. The WebGPU wrapper/fallback path has produced black sky,
// missing vertex colour output, and inconsistent canvas composition there. Use Three.js'
// mature WebGL renderer on production targets; it is still the same open-source engine.
source = source.replace("import { WebGPURenderer } from 'three/webgpu';\n", '');

must(
  'WebGL renderer',
  /const renderer = new WebGPURenderer\(\{ antialias: true \}\);[\s\S]*?\$\('game'\)\.appendChild\(renderer\.domElement\);\s*await renderer\.init\(\);/,
`const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0xa6bec8, 1);
$('game').appendChild(renderer.domElement);`
);

// Rapier's nrows/ncols are the dimensions of the height matrix itself, not the number
// of subdivisions. The matrix produced by sampleHeightGrid(PHYS_RES) contains
// PHYS_RES * PHYS_RES values, so passing PHYS_RES - 1 describes the wrong shape.
must(
  'Rapier heightfield dimensions',
  'RAPIER.ColliderDesc.heightfield(PHYS_RES - 1, PHYS_RES - 1, heightfieldData, { x: WORLD_SIZE, y: MAX_HEIGHT, z: WORLD_SIZE })',
  'RAPIER.ColliderDesc.heightfield(PHYS_RES, PHYS_RES, heightfieldData, { x: WORLD_SIZE, y: MAX_HEIGHT, z: WORLD_SIZE })'
);

// Make the scene background explicit on the WebGL path as well as through scene.background.
source = source.replace(
  'scene.background = new THREE.Color(0xa6bec8); scene.fog = new THREE.FogExp2(0xa6bec8, 0.00062);',
  'scene.background = new THREE.Color(0xa6bec8); renderer.setClearColor(scene.background, 1); scene.fog = new THREE.FogExp2(0xa6bec8, 0.00062);'
);

// Old saves made while collision was broken can reopen below the surface. Verify the
// chassis before the first frame instead of letting the camera begin underground.
source = source.replace(
  "ui.drive.onclick=()=>{state.started=true;ui.loading.classList.add('hidden');ui.hud.classList.remove('hidden');ui.touch.classList.remove('hidden');toast('No destination. Just drive.');};",
  "ui.drive.onclick=()=>{const p=chassis.translation(),ground=worldHeight(origin.x+p.x,origin.z+p.z);if(!Number.isFinite(p.y)||p.y<ground+0.35)recover();state.started=true;ui.loading.classList.add('hidden');ui.hud.classList.remove('hidden');ui.touch.classList.remove('hidden');toast('No destination. Just drive.');};"
);

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

console.log('render-compat: WebGL renderer + correct Rapier heightfield dimensions + boot ground guard');
