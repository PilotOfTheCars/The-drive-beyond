const status = document.getElementById('loadText');
try {
  if (!('DecompressionStream' in window)) throw new Error('This browser is missing gzip decompression support. Update Safari/iPadOS.');
  if (status) status.textContent = 'Starting The Drive Beyond…';
  const url = new URL('./game.js.gz', import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Game bundle failed to load (${response.status}).`);
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
  const source = await new Response(stream).text();
  const moduleURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try { await import(moduleURL); }
  finally { setTimeout(() => URL.revokeObjectURL(moduleURL), 1000); }
} catch (error) {
  console.error(error);
  if (status) status.textContent = 'Could not start the game.';
  const note = document.getElementById('protocolNote');
  if (note) note.textContent = String(error?.message || error);
}
