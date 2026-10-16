import * as THREE from 'three';
const $=id=>document.getElementById(id);
const loading=$('loading'), hud=$('hud'),touch=$('touch'), drive=$('driveBtn'),status=$('loadText');

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x9ab9c8);
scene.fog=new THREE.FogExp2(0x9ab9c8,.00125);

const camera=new THREE.PerspectiveCamera(68,innerWidth/innerHeight,.1,3200);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
$('game').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xeaf3ff,0x526044,2.35));
const sun=new THREE.DirectionalLight(0xffe8c8,2.15);sun.position.set(-90,150,-110);scene.add(sun);

const worldRoot=new THREE.Group();scene.add(worldRoot);
const mat=(c)=>new THREE.MeshLambertMaterial({color:c,side:THREE.DoubleSide});
const grass=mat(0x506f49),roadMat=mat(0x34393a),lineMat=mat(0xf1ead7);
const geoBox=new THREE.BoxGeometry(1,1,1);
const state={z:0,x:0,speed:0,heading:0,dist:0,fuel:100,tyre:100,camera:0,started:false,last:performance.now(),seed:5130,paused:false};

const save=()=>{try{localStorage.setItem('tdb-mini-save-v3',JSON.stringify({z:state.z,x:state.x,dist:state.dist,fuel:state.fuel,tyre:state.tyre}));}catch{}};
try{const s=JSON.parse(localStorage.getItem('tdb-mini-save-v3')||'null');if(s&&Number.isFinite(s.z)&&Number.isFinite(s.x))Object.assign(state,s)}catch{}

const roadX=z=>Math.sin(z*.0017)*62+Math.sin(z*.004)*18;
const roadY=z=>Math.sin(z*.0008)*6+Math.sin(z*.003)*1.8;
const terrain=(x,z)=>roadY(z)+Math.max(0,Math.abs(x-roadX(z))-19)*(.04*Math.sin(z*.0006+x*.001)+.048)+Math.sin(x*.003+z*.001)*2.8+Math.sin(x*.009-z*.007)*1.0;
function cube(parent,w,h,d,color,x=0,y=0,z=0){const m=new THREE.Mesh(geoBox,mat(color));m.scale.set(w,h,d);m.position.set(x,y,z);parent.add(m);return m}

const car=new THREE.Group();
cube(car,2.1,.62,4.3,0x405e7b,0,.78,0);
cube(car,1.7,.65,2.15,0x304352,0,1.39,-.25);
for(const x of [-1.03,1.03])for(const z of [-1.35,1.35]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.41,.41,.26,12),mat(0x202324));wheel.rotation.z=Math.PI/2;wheel.position.set(x,.44,z);car.add(wheel)}
for(const x of [-.7,.7])cube(car,.38,.18,.06,0xb9312b,x,.8,2.17);
scene.add(car);

const safetyGround=new THREE.Mesh(new THREE.PlaneGeometry(1800,4200),mat(0x506f49));
safetyGround.rotation.x=-Math.PI/2;safetyGround.position.set(0,-1.4,950);scene.add(safetyGround);

const roadSegments=[],landSegments=[];
const roadGeo=new THREE.PlaneGeometry(1,1,1,1);
function makeRoad(start){
  const group=new THREE.Group(),n=32,step=13;
  for(let i=0;i<n;i++){
    const z=start+i*step,z2=z+step,x=roadX(z),x2=roadX(z2),y=roadY(z),y2=roadY(z2),len=Math.hypot(x2-x,step);
    const a=new THREE.Mesh(roadGeo,roadMat);
    a.rotation.x=-Math.PI/2;a.rotation.z=Math.atan2(x2-x,step);a.scale.set(13,len,1);a.position.set((x+x2)/2,(y+y2)/2+.12,(z+z2)/2);group.add(a);
    for(const edge of [-5.8,0,5.8]){
      if(edge===0&&i%3!==0)continue;
      const b=new THREE.Mesh(roadGeo,lineMat);b.rotation.x=-Math.PI/2;b.rotation.z=a.rotation.z;b.scale.set(edge===0?.18:.13,edge===0?4:len,1);b.position.set((x+x2)/2+edge,(y+y2)/2+.17,(z+z2)/2);group.add(b);
    }
  }
  group.userData.start=start;worldRoot.add(group);return group;
}
function makeLand(start){
  const group=new THREE.Group(),rows=18,cols=24,depth=416,width=1000;
  const g=new THREE.PlaneGeometry(width,depth,cols,rows);g.rotateX(-Math.PI/2);
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),localZ=p.getZ(i),z=start+depth/2+localZ;
    p.setY(i,terrain(x,z)-.22);p.setZ(i,z);
  }
  p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();group.add(new THREE.Mesh(g,grass));
  const coneGeo=new THREE.ConeGeometry(3.6,15,6),treeMat=mat(0x294b34),tree2=mat(0x3d603f);
  for(let k=0;k<105;k++){
    const hash=Math.abs(Math.sin((start+k*29)*12.9898)*43758.5453)%1;
    const z=start+hash*416,x=(Math.sin((start+k*17)*.171)*.5+.5)*820-410;
    if(Math.abs(x-roadX(z))<27)continue;
    const t=new THREE.Mesh(coneGeo,k%2?treeMat:tree2);t.position.set(x,terrain(x,z)+7,z);t.scale.setScalar(.6+(k%6)*.15);group.add(t);
  }
  group.userData.start=start;worldRoot.add(group);return group;
}
function updateWorld(){
  if(!Number.isFinite(state.z)||!Number.isFinite(state.x))return;
  const base=Math.floor(state.z/416)*416;
  for(let i=-2;i<=5;i++){
    const s=base+i*416;
    if(!roadSegments.some(g=>g.userData.start===s))roadSegments.push(makeRoad(s));
    if(!landSegments.some(g=>g.userData.start===s))landSegments.push(makeLand(s));
  }
  for(const arr of [roadSegments,landSegments])for(let i=arr.length-1;i>=0;i--){
    if(Math.abs(arr[i].userData.start-base)>1900){worldRoot.remove(arr[i]);arr[i].traverse(o=>o.geometry?.dispose());arr.splice(i,1)}
  }
}

const traffic=[];
function addTraffic(i){
  const g=new THREE.Group(),colors=[0x8d3434,0xd9d5c8,0x47664e,0x666777,0xcaa35d];
  cube(g,2,.65,4.1,colors[i%5],0,.8,0);cube(g,1.7,.62,2.1,0x35424b,0,1.4,-.3);worldRoot.add(g);
  traffic.push({g,z:state.z+120+i*90,lane:i%3===0?-1:1,v:12+i%6*4,aggression:(i*7%10)/10});
}
for(let i=0;i<16;i++)addTraffic(i);

const keys={left:false,right:false,throttle:false,brake:false,w:false,a:false,s:false,d:false,arrowleft:false,arrowright:false,arrowup:false,arrowdown:false};
window.addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true;if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))e.preventDefault();if(e.key.toLowerCase()==='c')state.camera=(state.camera+1)%3;if(e.key.toLowerCase()==='r'){state.x=roadX(state.z);state.speed=0;state.heading=0}if(e.key.toLowerCase()==='j')openJournal();if(e.key==='Escape')togglePause()});
window.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
for(const b of document.querySelectorAll('[data-hold]')){const k=b.dataset.hold;b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys[k]=true});for(const name of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(name,()=>keys[k]=false)}
function openJournal(){const j=$('journal');j.classList.remove('hidden');$('jDistance').textContent=(state.dist/1000).toFixed(1);$('jPeople').textContent='0';$('jIncidents').textContent='0';$('journalEntries').textContent='Your journey is just beginning.'}
function togglePause(){const p=$('pause');p.classList.toggle('hidden');state.paused=!p.classList.contains('hidden')}
$('pauseBtn').onclick=togglePause;$('resumeBtn').onclick=togglePause;$('journalBtn').onclick=()=>{togglePause();openJournal()};$('closeJournal').onclick=()=>$('journal').classList.add('hidden');
$('touchCamera').onclick=()=>state.camera=(state.camera+1)%3;
$('recoverBtn').onclick=()=>{state.x=roadX(state.z);state.speed=0;state.heading=0;togglePause()};
$('handlingBtn').onclick=()=>{state.realistic=!state.realistic;$('handlingBtn').textContent=state.realistic?'REALISTIC':'ACCESSIBLE'};
$('graphicsBtn').onclick=()=>{state.low=!state.low;renderer.setPixelRatio(state.low?1:Math.min(devicePixelRatio,1.5));$('graphicsBtn').textContent=state.low?'LOW':'BALANCED'};
$('touchInteract').onclick=()=>{};

function recoverFiniteState(){
  if(!Number.isFinite(state.z))state.z=0;
  if(!Number.isFinite(state.x))state.x=roadX(state.z);
  if(!Number.isFinite(state.heading))state.heading=0;
  if(!Number.isFinite(state.speed))state.speed=0;
  if(!Number.isFinite(state.dist))state.dist=0;
}

function frame(t){
  requestAnimationFrame(frame);
  const dt=Math.min((t-state.last)/1000,.06);state.last=t;
  recoverFiniteState();
  if(state.started&&!state.paused){
    const accel=!!(keys.w||keys.arrowup||keys.throttle),brake=!!(keys.s||keys.arrowdown||keys.brake),left=!!(keys.a||keys.arrowleft||keys.left),right=!!(keys.d||keys.arrowright||keys.right);
    const onRoad=Math.abs(state.x-roadX(state.z))<7;
    state.speed=Math.max(0,Math.min(57,state.speed+((accel?8:0)-(brake?23:0)-1.1-state.speed*.012)*dt));
    if(!onRoad)state.speed*=Math.pow(.988,dt*60);
    state.heading+=((right?1:0)-(left?1:0))*(state.realistic?.65:.9)*dt*Math.min(1,state.speed/12);
    state.heading*=Math.pow(.993,dt*60);
    const dz=state.speed*dt*Math.cos(state.heading),dx=state.speed*dt*Math.sin(state.heading);
    state.z+=dz;state.x+=dx;state.dist+=Math.hypot(dx,dz);
    recoverFiniteState();
    state.fuel=Math.max(0,state.fuel-dt*state.speed*.0005);if(!state.fuel)state.speed*=.97;
    for(const a of traffic){
      a.z+=a.v*dt;const gap=a.z-state.z;
      if(gap < -130||gap>1200){a.z=state.z+300+Math.random()*700;a.lane=Math.random()<.2?-1:1}
      const x=roadX(a.z)+a.lane*3.2;a.g.position.set(x,roadY(a.z)+.13,a.z);a.g.rotation.y=Math.atan2(roadX(a.z+5)-roadX(a.z-5),10);
      if(Math.abs(gap)<4&&Math.abs(state.x-x)<2.3){state.speed*=.6;state.tyre=Math.max(0,state.tyre-.05)}
    }
    $('speed').textContent=Math.round(state.speed*3.6);$('fuel').textContent=Math.round(state.fuel);$('tyre').textContent=Math.round(state.tyre);$('fuelBar').style.width=state.fuel+'%';$('tyreBar').style.width=state.tyre+'%';
    $('region').textContent=['COASTAL FOOTHILLS','REDWOOD COUNTRY','HIGH VALLEY','MOUNTAIN ROAD'][Math.floor(Math.abs(state.z)/8000)%4];
    if(Math.floor(t/8000)!==Math.floor((t-dt*1000)/8000))save();
  }
  updateWorld();
  const playerY=roadY(state.z);
  worldRoot.position.set(-state.x,-playerY,-state.z);
  safetyGround.position.set(0,-1.35,950);
  car.position.set(0,.15,0);car.rotation.y=state.heading;
  const behind=state.camera===0?15:state.camera===1?2.6:25;
  const up=state.camera===0?7.2:state.camera===1?2.4:14;
  const camX=-Math.sin(state.heading)*behind,camZ=-Math.cos(state.heading)*behind;
  camera.position.set(camX,up,camZ);
  camera.lookAt(Math.sin(state.heading)*22,1.8,Math.cos(state.heading)*22);
  renderer.render(scene,camera);
}

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
recoverFiniteState();state.x=roadX(state.z);updateWorld();
status.textContent='Road ready';drive.disabled=false;$('protocolNote').textContent='3D world ready';
drive.onclick=()=>{recoverFiniteState();state.x=roadX(state.z);state.heading=0;state.speed=0;state.started=true;loading.classList.add('hidden');hud.classList.remove('hidden');touch.classList.remove('hidden')};
requestAnimationFrame(frame);
