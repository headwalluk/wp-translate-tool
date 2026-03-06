import { build } from 'esbuild';
import { chmodSync, readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

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
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  minify: false,
});

chmodSync('dist/wp-translate.mjs', 0o755);
console.log('Built: dist/wp-translate.mjs');
