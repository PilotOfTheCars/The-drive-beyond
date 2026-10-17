import fs from 'node:fs/promises';
import { build } from 'esbuild';

let source = await fs.readFile('src/final-game.js', 'utf8');

// Small production-source normalizations while the integration branch settles.
// 1. Remove two accidental full-width edge-line ribbons.
// 2. Rapier exposes the forward-axis property as the setIndexForwardAxis setter.
source = source
  .replace("  roadVisual.add(ribbon(-1900, 1900, ROAD_HALF - 0.24, lineMat, 0.125));\n", '')
  .replace("  roadVisual.add(ribbon(-1900, 1900, -(ROAD_HALF - 0.24), lineMat, 0.125));\n", '')
  .replace('vehicle.indexForwardAxis = 2;', 'vehicle.setIndexForwardAxis = 2;');

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
