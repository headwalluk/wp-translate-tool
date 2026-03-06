import { build } from 'esbuild';
import { chmodSync } from 'fs';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/wp-translate.mjs',
  banner: {
    js: '#!/usr/bin/env node',
  },
  minify: false,
});

chmodSync('dist/wp-translate.mjs', 0o755);
console.log('Built: dist/wp-translate.mjs');
