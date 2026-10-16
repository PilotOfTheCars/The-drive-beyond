// Load ordinary UTF-8 JavaScript: no gzip, Blob import, or double decoding.
const status = document.getElementById('loadText');
try {
  await import('./game.js?v=df3559f9');
} catch (error) {
  console.error('The Drive Beyond startup failed:', error);
  if (status) status.textContent = 'Could not start the game.';
  const note = document.getElementById('protocolNote');
  if (note) note.textContent = String(error?.stack || error?.message || error);
}
