import fs from 'node:fs/promises';
import { build } from 'esbuild';

let source = await fs.readFile('.build/final-game.js', 'utf8');

function must(label, pattern, replacement) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`finish-v2 failed: ${label}`);
  source = next;
}

// Physics declarations + higher-detail terrain collision.
source = source.replace(
  /let terrainCollider = null;\s*(?:let roadCollider = null;\s*)?let heightfieldData = null;/,
  'let terrainCollider = null;\nlet roadCollider = null;\nlet heightfieldData = null;'
);
if (!source.includes('let roadCollider = null;')) throw new Error('finish-v2 failed: roadCollider declaration');
source = source.replace('const PHYS_RES = 129;', 'const PHYS_RES = 257;');

// Stable terrain: broad mesh + a dense mesh following the road corridor.
// This avoids forcing a 7.3 m road cut into a 4 km square grid.
must('terrain', /let terrainMesh = null;[\s\S]*?\/\/ ---- Road geometry \(Three BufferGeometry \+ BVH\) --------------------------/, `let terrainMesh = null;
let terrainCorridorMesh = null;
const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 });
const terrainRock = new THREE.Color(0x777970);
const terrainSnow = new THREE.Color(0xc4c8c3);
function terrainBaseColor(gz) {
  const n = biomeAt(gz).name;
  return n === 'REDWOOD COUNTRY' ? 0x3f5b3f : n === 'GOLDEN VALLEY' ? 0x777548 : n === 'HIGH COUNTRY' ? 0x596257 : 0x52684e;
}
function paintTerrain(c, gx, gz, h) {
  const b = biomeAt(gz);
  c.setHex(terrainBaseColor(gz)).lerp(terrainRock, clamp((h - b.base - 70) / Math.max(45, b.relief), 0, 1) * 0.72);
  if (b.name === 'HIGH COUNTRY') c.lerp(terrainSnow, clamp((h - 165) / 55, 0, 0.55));
  c.offsetHSL(0, 0, detailNoise(gx * 0.0017, gz * 0.0017) * 0.045);
}
function disposeTerrainMesh() {
  for (const m of [terrainMesh, terrainCorridorMesh]) if (m) { terrainVisual.remove(m); m.geometry.dispose(); }
  terrainMesh = terrainCorridorMesh = null;
}
function makeFarTerrain() {
  const g = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 128, 128); g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position'), colors = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i=0;i<p.count;i++) {
    const lx=p.getX(i), lz=p.getZ(i), gx=origin.x+lx, gz=origin.z+lz, h=worldHeight(gx,gz);
    p.setY(i,h); paintTerrain(c,gx,gz,h); colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
  }
  p.needsUpdate=true; g.setAttribute('color',new THREE.BufferAttribute(colors,3)); g.computeVertexNormals(); g.computeBoundingSphere();
  const m=new THREE.Mesh(g,terrainMaterial); m.receiveShadow=true; return m;
}
function makeRoadCorridorTerrain() {
  const zMin=-1900,zMax=1900,zStep=8,half=180,latStep=8;
  const rows=Math.floor((zMax-zMin)/zStep)+1, cols=Math.floor((half*2)/latStep)+1;
  const pos=new Float32Array(rows*cols*3), colors=new Float32Array(rows*cols*3), idx=new Uint32Array((rows-1)*(cols-1)*6), c=new THREE.Color();
  let pi=0,ii=0;
  for(let r=0;r<rows;r++){
    const z=zMin+r*zStep, cgz=origin.z+z, h=roadHeading(cgz), nx=Math.cos(h), nz=-Math.sin(h), cx=roadCenterX(cgz)-origin.x;
    for(let k=0;k<cols;k++){
      const lateral=-half+k*latStep, lx=cx+nx*lateral, lz=z+nz*lateral, gx=origin.x+lx, gz=origin.z+lz, y=worldHeight(gx,gz)+0.025;
      pos[pi]=lx;pos[pi+1]=y;pos[pi+2]=lz;paintTerrain(c,gx,gz,y);colors[pi]=c.r;colors[pi+1]=c.g;colors[pi+2]=c.b;pi+=3;
      if(r<rows-1&&k<cols-1){const a=r*cols+k,b=a+1,d=(r+1)*cols+k,e=d+1;idx[ii++]=a;idx[ii++]=d;idx[ii++]=b;idx[ii++]=b;idx[ii++]=d;idx[ii++]=e;}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.setIndex(new THREE.BufferAttribute(idx,1));g.computeVertexNormals();g.computeBoundingSphere();
  const mat=terrainMaterial.clone();mat.polygonOffset=true;mat.polygonOffsetFactor=-1;mat.polygonOffsetUnits=-1;
  const m=new THREE.Mesh(g,mat);m.receiveShadow=true;return m;
}
function rebuildTerrain() {
  setLoad('Building road-following countryside…',20); disposeTerrainMesh();
  terrainMesh=makeFarTerrain(); terrainCorridorMesh=makeRoadCorridorTerrain(); terrainVisual.add(terrainMesh,terrainCorridorMesh); rebuildPhysicsTerrain();
}

// ---- Road geometry (Three BufferGeometry + BVH) --------------------------`);

// Traffic models: preserve FBX ancestor axis transforms when extracting a car from the pack.
must('traffic clone helper', /function vehicleRootForLabel\(pack, label\) \{/, `function cloneWorldNode(node) {
  node.updateWorldMatrix(true,true);
  const clone=node.clone(true),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
  node.matrixWorld.decompose(p,q,s); clone.position.copy(p); clone.quaternion.copy(q); clone.scale.copy(s); clone.updateMatrixWorld(true); return clone;
}
function vehicleRootForLabel(pack, label) {`);
source = source.replace(/normalizeModel\(match\.clone\(true\),\s*\/SUV\|Pickup\|Minivan\/\.test\(label\) \? 4\.8 : 4\.3\)/, 'normalizeModel(cloneWorldNode(match), /SUV|Pickup|Minivan/.test(label) ? 4.8 : 4.3)');

// Last sanity check: a car's Y dimension should never be its longest dimension.
must('vehicle orientation sanity', /obj\.updateMatrixWorld\(true\); let box = new THREE\.Box3\(\)\.setFromObject\(obj\), size = box\.getSize\(new THREE\.Vector3\(\)\);\s*if \(size\.x > size\.z \* 1\.12\)/, `obj.updateMatrixWorld(true); let box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  if (size.y > Math.max(size.x,size.z) * 1.20) {
    obj.rotation.x += Math.PI / 2; obj.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(obj); size = box.getSize(new THREE.Vector3());
  }
  if (size.x > size.z * 1.12)`);

// Rig the actual uploaded hatchback nodes.
must('player rig', /let playerModel = null; const trafficPrototypes = \[\];/, `let playerModel = null; const trafficPrototypes = [];
const playerRig={wheels:[],steeringWheel:null,steeringBase:null,eye:new THREE.Vector3(-0.42,1.18,0.25),frontSign:1};
function capturePlayerRig(root){
  playerRig.wheels.length=0;playerRig.steeringWheel=null;root.updateMatrixWorld(true);const inv=root.matrixWorld.clone().invert();
  root.traverse(n=>{const name=String(n.name||'').toLowerCase();
    if(name.includes('quad_wheel')){const p=new THREE.Vector3();n.getWorldPosition(p);p.applyMatrix4(inv);playerRig.wheels.push({node:n,base:n.quaternion.clone(),local:p,front:false});}
    if(!playerRig.steeringWheel&&(name==='wheelride'||name==='wheelride.001'||name.includes('steering'))){playerRig.steeringWheel=n;playerRig.steeringBase=n.quaternion.clone();}
  });
  if(playerRig.steeringWheel){const p=new THREE.Vector3();playerRig.steeringWheel.getWorldPosition(p);p.applyMatrix4(inv);playerRig.frontSign=p.z>=0?1:-1;playerRig.eye.set(p.x,p.y+0.08,p.z-playerRig.frontSign*0.36);}
  else {const b=new THREE.Box3().setFromObject(root),sz=b.getSize(new THREE.Vector3()),ct=b.getCenter(new THREE.Vector3());playerRig.eye.set(ct.x-sz.x*0.22,b.min.y+sz.y*0.68,ct.z+sz.z*0.08);}
  if(playerRig.wheels.length){const z=playerRig.wheels.map(w=>w.local.z*playerRig.frontSign),split=(Math.min(...z)+Math.max(...z))*0.5;for(const w of playerRig.wheels)w.front=w.local.z*playerRig.frontSign>split;}
}
function animatePlayerRig(){
  const steerQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),state.steerVisual),spinQ=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),state.wheelSpin);
  for(const w of playerRig.wheels){w.node.quaternion.copy(w.base);if(w.front)w.node.quaternion.multiply(steerQ);w.node.quaternion.multiply(spinQ);}
  if(playerRig.steeringWheel&&playerRig.steeringBase){const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-state.steerVisual*2.25);playerRig.steeringWheel.quaternion.copy(playerRig.steeringBase).multiply(q);}
}`);
source = source.replace(/playerVisualRoot\.add\(playerModel\);/, 'playerVisualRoot.add(playerModel); capturePlayerRig(playerModel);');

// Camera cycle includes interior.
source = source.replace(/\(state\.camera \+ 1\) % 3/g, '(state.camera + 1) % 4');

must('visual state', /const state = \{ fuel: saved\?\.fuel \?\? 100,[^\n]+time: saved\?\.time \?\? 7\.4 \};/, m => m.replace('time: saved?.time ?? 7.4', 'time: saved?.time ?? 7.4, steerVisual: 0, wheelSpin: 0'));

must('wheel animation input', /const speed = Math\.abs\(vehicle\.currentVehicleSpeed\(\)\); const steerMax = lerp\(0\.52, 0\.20, clamp\(speed \/ 42, 0, 1\)\); const steering = steerIn \* steerMax;/, `const signedSpeed=vehicle.currentVehicleSpeed();
    const speed=Math.abs(signedSpeed); const steerMax=lerp(0.52,0.20,clamp(speed/42,0,1)); const steering=steerIn*steerMax;
    state.steerVisual=damp(state.steerVisual,steering,12,dt); state.wheelSpin+=signedSpeed*dt/0.34;`);

source = source.replace('updateTraffic(dt); updateInteraction();', 'updateTraffic(dt); updateInteraction(); animatePlayerRig();');

must('interior camera', /if \(state\.camera===0\) cameraWanted\.copy\(focus\)[\s\S]*?camera\.lookAt\(cameraTarget\);/, `if(state.camera===0){camera.near=0.08;cameraWanted.copy(focus).addScaledVector(fwd,-9.5).add(new THREE.Vector3(0,3.8,0));camera.position.lerp(cameraWanted,1-Math.exp(-7*dt));cameraTarget.copy(focus).addScaledVector(fwd,14);}
    else if(state.camera===1){camera.near=0.05;cameraWanted.copy(focus).addScaledVector(fwd,1.4).add(new THREE.Vector3(0,0.55,0));camera.position.lerp(cameraWanted,1-Math.exp(-10*dt));cameraTarget.copy(focus).addScaledVector(fwd,18);}
    else if(state.camera===2){camera.near=0.08;cameraWanted.copy(focus).addScaledVector(fwd,-16).addScaledVector(right,6).add(new THREE.Vector3(0,7.5,0));camera.position.lerp(cameraWanted,1-Math.exp(-7*dt));cameraTarget.copy(focus).addScaledVector(fwd,14);}
    else {camera.near=0.025;cameraWanted.copy(playerRig.eye).applyQuaternion(quat).add(playerVisualRoot.position);camera.position.lerp(cameraWanted,1-Math.exp(-18*dt));cameraTarget.copy(cameraWanted).addScaledVector(fwd,25).add(new THREE.Vector3(0,0.05,0));}
    camera.updateProjectionMatrix();camera.lookAt(cameraTarget);`);

await fs.writeFile('.build/final-game.js',source,'utf8');
await build({entryPoints:['.build/final-game.js'],outfile:'src/final.bundle.js',bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,sourcemap:true,legalComments:'linked',treeShaking:true,define:{'process.env.NODE_ENV':'"production"'}});
console.log('finish-v2: terrain, traffic orientation, animated wheels/steering wheel, interior camera');
