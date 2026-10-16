
import * as THREE from 'three';
const $=id=>document.getElementById(id);
const loading=$('loading'), hud=$('hud'),touch=$('touch'), drive=$('driveBtn'),status=$('loadText');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x9ab9c8);scene.fog=new THREE.FogExp2(0x9ab9c8,.00145);
const camera=new THREE.PerspectiveCamera(69,innerWidth/innerHeight,.1,2800);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
$('game').appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xeaf3ff,0x5a684b,2));
const sun=new THREE.DirectionalLight(0xffe7bf,2.1);sun.position.set(-80,140,-100);scene.add(sun);
const mat=(c)=>new THREE.MeshLambertMaterial({color:c});
const grass=mat(0x54704a),roadMat=mat(0x353a3a),lineMat=mat(0xf5e9ce),trunkMat=mat(0x65503a);
const geoBox=new THREE.BoxGeometry(1,1,1);
const state={z:0,x:0,speed:0,heading:0,dist:0,fuel:100,tyre:100,camera:0,started:false,last:performance.now(),seed:5130};
const save=()=>{try{localStorage.setItem('tdb-mini-save',JSON.stringify({z:state.z,x:state.x,dist:state.dist,fuel:state.fuel,tyre:state.tyre}));}catch{}};
try{const s=JSON.parse(localStorage.getItem('tdb-mini-save')||'null');if(s)Object.assign(state,s)}catch{}
const roadX=z=>Math.sin(z*.0017)*62+Math.sin(z*.004)*18;
const roadY=z=>Math.sin(z*.0008)*6+Math.sin(z*.003)*1.8;
const terrain=(x,z)=>roadY(z)+Math.max(0,Math.abs(x-roadX(z))-19)*(.045*Math.sin(z*.0006+x*.001)+.045)+Math.sin(x*.003+z*.001)*3+Math.sin(x*.009-z*.007)*1.2;
const car=new THREE.Group();
function cube(parent,w,h,d,color,x=0,y=0,z=0){const m=new THREE.Mesh(geoBox,mat(color));m.scale.set(w,h,d);m.position.set(x,y,z);parent.add(m);return m}
cube(car,2.1,.62,4.3,0x405e7b,0,.78,0);cube(car,1.7,.65,2.15,0x304352,0,1.39,-.25);
for(const x of [-1.03,1.03])for(const z of [-1.35,1.35]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.41,.41,.26,12),mat(0x202324));wheel.rotation.z=Math.PI/2;wheel.position.set(x,.44,z);car.add(wheel)}
for(const x of [-.7,.7])cube(car,.38,.18,.06,0xb9312b,x,.8,2.17);
scene.add(car);
const roadSegments=[],landSegments=[];
const roadGeo=new THREE.PlaneGeometry(1,1,1,1);
function makeRoad(start){
 const group=new THREE.Group(),n=32,step=13;
 for(let i=0;i<n;i++){let z=start+i*step,z2=z+step,x=roadX(z),x2=roadX(z2),y=roadY(z),y2=roadY(z2),len=Math.hypot(x2-x,step);
 const a=new THREE.Mesh(roadGeo,roadMat);a.rotation.x=-Math.PI/2;a.rotation.z=Math.atan2(x2-x,step);a.scale.set(13,len,1);a.position.set((x+x2)/2,(y+y2)/2+.15,(z+z2)/2);group.add(a);
 for(const edge of [-5.8,0,5.8]){if(edge===0&&i%3!==0)continue;const b=new THREE.Mesh(roadGeo,lineMat);b.rotation.x=-Math.PI/2;b.rotation.z=a.rotation.z;b.scale.set(edge===0?.18:.13,edge===0?4:len,1);b.position.set((x+x2)/2+edge,(y+y2)/2+.18,(z+z2)/2);group.add(b)}
 }
 group.userData.start=start;scene.add(group);return group
}
function makeLand(start){
 const group=new THREE.Group(),rows=16,cols=20,depth=416,width=900;
 const vertices=[],indices=[];
 for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const z=start+j*depth/rows,x=-width/2+i*width/cols;vertices.push(x,terrain(x,z)-.18,z)}
 for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){let a=j*(cols+1)+i,b=a+cols+1;indices.push(a,b,a+1,b,b+1,a+1)}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();group.add(new THREE.Mesh(g,grass));
 const coneGeo=new THREE.ConeGeometry(3.7,15,6),treeMat=mat(0x284a34),tree2=mat(0x37593a);
 for(let k=0;k<115;k++){let hash=Math.abs(Math.sin((start+k*29)*12.9898)*43758.5453)%1,z=start+hash*416,x=(Math.sin((start+k*17)*.171)*.5+.5)*750-375;
 if(Math.abs(x-roadX(z))<27)continue;const t=new THREE.Mesh(coneGeo,k%2?treeMat:tree2);t.position.set(x,terrain(x,z)+7,z);t.scale.setScalar(.6+(k%6)*.17);group.add(t)}
 group.userData.start=start;scene.add(group);return group
}
function updateWorld(){let base=Math.floor(state.z/416)*416;for(let i=-2;i<=4;i++){let s=base+i*416;if(!roadSegments.some(g=>g.userData.start===s))roadSegments.push(makeRoad(s));if(!landSegments.some(g=>g.userData.start===s))landSegments.push(makeLand(s))}
 for(const arr of [roadSegments,landSegments])for(let i=arr.length-1;i>=0;i--)if(Math.abs(arr[i].userData.start-base)>1800){scene.remove(arr[i]);arr[i].traverse(o=>o.geometry?.dispose());arr.splice(i,1)}}
const traffic=[];
function addTraffic(i){const g=new THREE.Group(),colors=[0x8d3434,0xd9d5c8,0x47664e,0x666777,0xcaa35d];cube(g,2,.65,4.1,colors[i%5],0,.8,0);cube(g,1.7,.62,2.1,0x35424b,0,1.4,-.3);scene.add(g);traffic.push({g,z:state.z+120+i*90,lane:i%3===0?-1:1,v:12+i%6*4,aggression:(i*7%10)/10})}
for(let i=0;i<16;i++)addTraffic(i);
const keys={};window.addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true;if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))e.preventDefault();if(e.key.toLowerCase()==='c')state.camera=(state.camera+1)%3;if(e.key.toLowerCase()==='r'){state.x=roadX(state.z);state.speed=0}if(e.key.toLowerCase()==='j')openJournal();if(e.key==='Escape')togglePause()});
window.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
for(const b of document.querySelectorAll('[data-hold]')){const k=b.dataset.hold;b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys[k]=true});for(const name of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(name,()=>keys[k]=false)}
function openJournal(){const j=$('journal');j.classList.remove('hidden');$('jDistance').textContent=(state.dist/1000).toFixed(1);$('jPeople').textContent='0';$('jIncidents').textContent='0';$('journalEntries').textContent='Your journey is just beginning.'}
function togglePause(){const p=$('pause');p.classList.toggle('hidden');state.paused=!p.classList.contains('hidden')}
$('pauseBtn').onclick=togglePause;$('resumeBtn').onclick=togglePause;$('journalBtn').onclick=()=>{togglePause();openJournal()};$('closeJournal').onclick=()=>$('journal').classList.add('hidden');
$('touchCamera').onclick=()=>state.camera=(state.camera+1)%3;$('recoverBtn').onclick=()=>{state.x=roadX(state.z);state.speed=0;togglePause()};
$('handlingBtn').onclick=()=>{state.realistic=!state.realistic;$('handlingBtn').textContent=state.realistic?'REALISTIC':'ACCESSIBLE'};
$('graphicsBtn').onclick=()=>{state.low=!state.low;renderer.setPixelRatio(state.low?1:Math.min(devicePixelRatio,1.6));$('graphicsBtn').textContent=state.low?'LOW':'BALANCED'};
$('touchInteract').onclick=()=>{};
function frame(t){requestAnimationFrame(frame);const dt=Math.min((t-state.last)/1000,.06);state.last=t;
if(state.started&&!state.paused){const accel=keys.w||keys.arrowup||keys.throttle,brake=keys.s||keys.arrowdown||keys.brake,left=keys.a||keys.arrowleft||keys.left,right=keys.d||keys.arrowright||keys.right;
const onRoad=Math.abs(state.x-roadX(state.z))<7;state.speed=Math.max(0,Math.min(57,state.speed+((accel?8:0)-(brake?23:0)-1.1-state.speed*.012)*dt));if(!onRoad)state.speed*=Math.pow(.988,dt*60);
state.heading+=(Number(right)-Number(left))*(state.realistic?.65:.9)*dt*Math.min(1,state.speed/12);state.heading*=Math.pow(.993,dt*60);
const dz=state.speed*dt*Math.cos(state.heading),dx=state.speed*dt*Math.sin(state.heading);state.z+=dz;state.x+=dx;state.dist+=Math.hypot(dx,dz);state.fuel=Math.max(0,state.fuel-dt*state.speed*.0005);if(!state.fuel)state.speed*=.97;
car.position.set(state.x,roadY(state.z)+.15,state.z);car.rotation.y=state.heading;
for(const a of traffic){a.z+=a.v*dt;const gap=a.z-state.z;if(gap < -130||gap>1200){a.z=state.z+300+Math.random()*700;a.lane=Math.random()<.2?-1:1}const lane=a.lane*3.2;const x=roadX(a.z)+lane;a.g.position.set(x,roadY(a.z)+.13,a.z);a.g.rotation.y=Math.atan2(roadX(a.z+5)-roadX(a.z-5),10);if(Math.abs(gap)<4&&Math.abs(state.x-x)<2.3){state.speed*=.6;state.tyre=Math.max(0,state.tyre-.05);}}
$('speed').textContent=Math.round(state.speed*3.6);$('fuel').textContent=Math.round(state.fuel);$('tyre').textContent=Math.round(state.tyre);$('fuelBar').style.width=state.fuel+'%';$('tyreBar').style.width=state.tyre+'%';
$('region').textContent=['COASTAL FOOTHILLS','REDWOOD COUNTRY','HIGH VALLEY','MOUNTAIN ROAD'][Math.floor(Math.abs(state.z)/8000)%4];
if(Math.floor(t/8000)!==Math.floor((t-dt*1000)/8000))save();
}
updateWorld();
const behind=state.camera===0?15:state.camera===1?2:25,up=state.camera===0?7:state.camera===1?2.3:14;
const desired=new THREE.Vector3(state.x-Math.sin(state.heading)*behind,roadY(state.z)+up,state.z-Math.cos(state.heading)*behind);
camera.position.lerp(desired,.12);camera.lookAt(state.x+Math.sin(state.heading)*20,roadY(state.z)+1.8,state.z+Math.cos(state.heading)*20);
renderer.render(scene,camera)}
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
state.x=state.x||roadX(state.z);updateWorld();status.textContent='Road ready';drive.disabled=false;$('protocolNote').textContent='3D fallback build · no compressed bundle required';
drive.onclick=()=>{state.started=true;loading.classList.add('hidden');hud.classList.remove('hidden');touch.classList.remove('hidden')};
requestAnimationFrame(frame);
