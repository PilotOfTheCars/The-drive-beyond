const DB_NAME = 'tdb-private-assets-v1';
const STORE = 'files';
const DB_VERSION = 1;
const urls = new Map();
let dbPromise = null;

function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}

function normalize(path){
  let p=String(path||'').replaceAll('\\','/').replace(/^\.\//,'').replace(/^\//,'');
  const i=p.toLowerCase().indexOf('assets/');
  if(i>=0) p=p.slice(i);
  return p;
}

function mimeFor(path){
  const p=path.toLowerCase();
  if(p.endsWith('.png')) return 'image/png';
  if(p.endsWith('.jpg')||p.endsWith('.jpeg')) return 'image/jpeg';
  if(p.endsWith('.webp')) return 'image/webp';
  if(p.endsWith('.fbx')) return 'application/octet-stream';
  return 'application/octet-stream';
}

async function txDone(tx){
  return new Promise((resolve,reject)=>{ tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error||new Error('Asset storage aborted')); });
}

export async function cachedAssetCount(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,'readonly').objectStore(STORE).count();
    req.onsuccess=()=>resolve(req.result||0); req.onerror=()=>reject(req.error);
  });
}

export async function hydrateAssetUrls(){
  for(const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
  const db=await openDB();
  const tx=db.transaction(STORE,'readonly');
  const store=tx.objectStore(STORE);
  const [keys,vals]=await Promise.all([
    new Promise((resolve,reject)=>{const r=store.getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)}),
    new Promise((resolve,reject)=>{const r=store.getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
  ]);
  for(let i=0;i<keys.length;i++){
    const blob=vals[i] instanceof Blob?vals[i]:new Blob([vals[i]],{type:mimeFor(keys[i])});
    urls.set(normalize(keys[i]),URL.createObjectURL(blob));
  }
  return urls.size;
}

export function assetUrl(path){
  const n=normalize(path);
  return urls.get(n) || path;
}

export function hasCoreAssets(){
  return urls.has('assets/player/HatchBackLowPoly.fbx') && urls.has('assets/traffic/fab.fbx');
}

export async function clearAssetVault(){
  const db=await openDB();
  const tx=db.transaction(STORE,'readwrite');
  tx.objectStore(STORE).clear();
  await txDone(tx);
  await hydrateAssetUrls();
}

export async function importAssetBundle(file,onProgress=()=>{}){
  if(!file) throw new Error('Choose the Drive Beyond asset ZIP first.');
  if(!file.name.toLowerCase().endsWith('.zip')) throw new Error('Please choose the .zip asset bundle.');
  onProgress('Opening asset bundle…',0.06);
  const { unzipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm');
  const data=new Uint8Array(await file.arrayBuffer());
  onProgress('Unpacking your private car assets…',0.18);
  const archive=unzipSync(data);
  const entries=[];
  for(const [rawName,bytes] of Object.entries(archive)){
    const path=normalize(rawName);
    if(!path.startsWith('assets/') || rawName.endsWith('/')) continue;
    entries.push([path,bytes]);
  }
  if(!entries.some(([p])=>p==='assets/player/HatchBackLowPoly.fbx') || !entries.some(([p])=>p==='assets/traffic/fab.fbx')){
    throw new Error('That ZIP does not contain the expected Drive Beyond car assets. Pick the asset bundle I gave you.');
  }
  const db=await openDB();
  const tx=db.transaction(STORE,'readwrite');
  const store=tx.objectStore(STORE);
  for(let i=0;i<entries.length;i++){
    const [path,bytes]=entries[i];
    store.put(new Blob([bytes],{type:mimeFor(path)}),path);
    if(i%8===0) onProgress(`Saving private assets… ${i+1}/${entries.length}`,0.20+0.70*(i/entries.length));
  }
  await txDone(tx);
  await hydrateAssetUrls();
  onProgress('Assets ready.',1);
  return entries.length;
}
