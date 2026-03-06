import { readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { makePot } from './wp-cli.js';

export function findOrCreatePot(pluginPath: string): string {
  const langDir = join(pluginPath, 'languages');

  if (existsSync(langDir)) {
    const potFiles = readdirSync(langDir).filter(f => f.endsWith('.pot'));
    if (potFiles.length > 0) {
      return join(langDir, potFiles[0]);
    }
  }

  console.log(`No .pot file found in ${langDir}/. Generating one...`);
  const outputPath = join(langDir, `${basename(pluginPath)}.pot`);
  makePot(pluginPath, outputPath);

  if (existsSync(langDir)) {
    const potFiles = readdirSync(langDir).filter(f => f.endsWith('.pot'));
    if (potFiles.length > 0) {
      return join(langDir, potFiles[0]);
    }
  }

  console.error('Error: Failed to generate .pot file.');
  process.exit(1);
}

export function detectLocales(pluginPath: string): string[] | null {
  const langDir = join(pluginPath, 'languages');
  if (!existsSync(langDir)) return null;

  const files = readdirSync(langDir);
  const locales = files
    .filter(f => f.endsWith('.po'))
    .map(f => f.match(/([a-z]{2}_[A-Z]{2})\.po$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => m[1]);

  const unique = [...new Set(locales)].sort();
  return unique.length > 0 ? unique : null;
}
