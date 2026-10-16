const status = document.getElementById('loadText');

try {
  if (!('DecompressionStream' in window)) {
    throw new Error('This browser is missing gzip decompression support. Update Safari/iPadOS.');
  }

  if (status) status.textContent = 'Starting The Drive Beyond…';

  const url = new URL('./game.js.gz', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Game bundle failed to load (${response.status}).`);

  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  let source = await new Response(stream).text();

  // The original alpha used a manual private-asset importer. Both vehicle packs
  // are now redistribution-permitted Creative Commons assets, so Pages installs
  // them automatically from the repository on first launch and caches them in
  // the existing IndexedDB asset vault.
  const publicAssetInstaller = String.raw`
waitForAssets = async function(){
  setLoading('Checking vehicle assets…', 6);
  try { await hydrateAssetUrls(); } catch (err) { console.warn('Asset cache unavailable', err); }

  if (hasCoreAssets()) {
    ui.protocolNote.textContent = 'Creative Commons vehicle assets loaded from this device cache.';
    return true;
  }

  const packs = [
    ['./tdb-player-assets.zip', 'player hatchback'],
    ['./tdb-traffic-assets.zip', 'traffic pack']
  ];

  try {
    const { unzipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm');

    for (let packIndex = 0; packIndex < packs.length; packIndex++) {
      const [packUrl, label] = packs[packIndex];
      setLoading('Downloading ' + label + '…', 10 + packIndex * 12);

      const packResponse = await fetch(packUrl, { cache: 'force-cache' });
      if (!packResponse.ok) throw new Error(label + ' is missing (' + packResponse.status + ').');

      const bytes = new Uint8Array(await packResponse.arrayBuffer());
      setLoading('Installing ' + label + '…', 15 + packIndex * 12);
      const archive = unzipSync(bytes);

      const entries = [];
      for (const [rawName, fileBytes] of Object.entries(archive)) {
        const path = normalize(rawName);
        if (!path.startsWith('assets/') || rawName.endsWith('/')) continue;
        entries.push([path, fileBytes]);
      }

      const db = await openDB();
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (let i = 0; i < entries.length; i++) {
        const [path, fileBytes] = entries[i];
        store.put(new Blob([fileBytes], { type: mimeFor(path) }), path);
        if (i % 8 === 0) {
          const pct = 16 + packIndex * 12 + Math.round((i / Math.max(entries.length, 1)) * 9);
          setLoading('Installing ' + label + '… ' + (i + 1) + '/' + entries.length, pct);
        }
      }
      await txDone(tx);
    }

    await hydrateAssetUrls();
    if (!hasCoreAssets()) throw new Error('Vehicle packs installed but the expected FBX files were not found.');

    ui.protocolNote.textContent = 'Creative Commons vehicle assets installed. Credits are in THIRD_PARTY_NOTICES.md.';
    return true;
  } catch (err) {
    console.warn('Bundled vehicle install failed; fallback cars enabled.', err);
    allowPlaceholderCars = true;
    ui.protocolNote.textContent = 'Vehicle assets could not load: ' + (err?.message || err) + ' Fallback cars will be used.';
    return false;
  }
};
`;

  source = source.replace(
    "ui.protocolNote.textContent = 'Your car models stay private on this device. First launch can import the asset bundle from Files; Safari stores it locally for later sessions.';",
    "ui.protocolNote.textContent = 'Creative Commons vehicle assets load automatically and are cached on this device.';"
  );

  const bootMarker = 'async function boot(){';
  if (!source.includes(bootMarker)) throw new Error('Game bootstrap marker was not found.');
  source = source.replace(bootMarker, `${publicAssetInstaller}\n${bootMarker}`);

  const moduleURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(moduleURL);
  } finally {
    setTimeout(() => URL.revokeObjectURL(moduleURL), 1000);
  }
} catch (error) {
  console.error(error);
  if (status) status.textContent = 'Could not start the game.';
  const note = document.getElementById('protocolNote');
  if (note) note.textContent = String(error?.message || error);
}
