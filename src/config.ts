import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface Config {
  deeplAuthKey: string;
}

export function loadConfig(): Config {
  const envPath = join(process.env.HOME ?? '', '.config', 'deepl.env');

  if (!existsSync(envPath)) {
    console.error(`Error: DeepL config file missing at: ${envPath}`);
    process.exit(1);
  }

  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim().replace(/^export\s+/, '');
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }

  const deeplAuthKey = process.env.DEEPL_AUTH_KEY;
  if (!deeplAuthKey) {
    console.error(`Error: DEEPL_AUTH_KEY is not set in ${envPath}.`);
    console.error('Get a free key at https://www.deepl.com/pro-api');
    process.exit(1);
  }

  return { deeplAuthKey };
}
