import fs from 'node:fs/promises';
import { build } from 'esbuild';

let source = await fs.readFile('src/final-game.js', 'utf8');
// Build-time cleanup: edge markings will become proper offset ribbons in the next source pass.
// Remove the two accidental full-width white ribbons from the runtime bundle.
source = source
  .replace("  roadVisual.add(ribbon(-1900, 1900, ROAD_HALF - 0.24, lineMat, 0.125));\n", '')
  .replace("  roadVisual.add(ribbon(-1900, 1900, -(ROAD_HALF - 0.24), lineMat, 0.125));\n", '');
await fs.mkdir('.build', { recursive: true });
await fs.writeFile('.build/final-game.js', source);

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
