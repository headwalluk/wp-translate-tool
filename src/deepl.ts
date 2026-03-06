import https from 'https';
import { PoEntry, sanitize } from './po-parser.js';

const BATCH_SIZE = 50;
const API_HOST = 'api-free.deepl.com';

function mapLocale(wpLocale: string): string {
  const parts = wpLocale.replace('_', '-').split('-');
  const lang = parts[0].toUpperCase();
  if (lang === 'EN' && parts[1]) return `EN-${parts[1].toUpperCase()}`;
  if (lang === 'PT' && parts[1]) return `PT-${parts[1].toUpperCase()}`;
  return lang;
}

interface DeepLResponse {
  translations: Array<{ text: string }>;
}

function apiRequest(authKey: string, path: string, body?: object): Promise<any> {
  const postData = body ? JSON.stringify(body) : undefined;
  const method = postData ? 'POST' : 'GET';
  const headers: Record<string, string | number> = {
    'Authorization': `DeepL-Auth-Key ${authKey}`,
  };
  if (postData) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(postData);
  }

  const options: https.RequestOptions = {
    hostname: API_HOST,
    path,
    method,
    headers,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`DeepL API returned ${res.statusCode}: ${data}`));
          return;
        }
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

export async function translateBatch(
  entries: PoEntry[],
  targetLang: string,
  authKey: string,
): Promise<void> {
  const deepLLang = mapLocale(targetLang);
  const totalBatches = Math.ceil(entries.length / BATCH_SIZE);

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    if (totalBatches > 1) {
      process.stdout.write(`   Translating batch ${batchNum}/${totalBatches}...\r`);
    }
    const batch = entries.slice(i, i + BATCH_SIZE);
    const texts = batch.map(e => e.msgid!);
    const result: DeepLResponse = await apiRequest(authKey, '/v2/translate', { text: texts, target_lang: deepLLang });
    result.translations.forEach((t, index) => {
      batch[index].newTranslation = `msgstr "${sanitize(t.text)}"`;
    });
  }
  if (totalBatches > 1) {
    process.stdout.write(''.padEnd(40) + '\r');
  }
}

export async function translateContextual(
  entries: PoEntry[],
  targetLang: string,
  authKey: string,
): Promise<void> {
  const deepLLang = mapLocale(targetLang);

  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    if (entries.length > 1) {
      process.stdout.write(`   Translating contextual ${i + 1}/${entries.length}...\r`);
    }
    const result: DeepLResponse = await apiRequest(authKey, '/v2/translate', {
      text: [item.msgid],
      target_lang: deepLLang,
      context: item.msgctxt,
    });
    if (result.translations.length > 0) {
      item.newTranslation = `msgstr "${sanitize(result.translations[0].text)}"`;
    }
  }
  if (entries.length > 1) {
    process.stdout.write(''.padEnd(40) + '\r');
  }
}

interface UsageResponse {
  character_count: number;
  character_limit: number;
}

export async function checkUsage(authKey: string): Promise<void> {
  const result: UsageResponse = await apiRequest(authKey, '/v2/usage');
  const used = result.character_count;
  const limit = result.character_limit;
  const remaining = limit - used;
  const pct = ((used / limit) * 100).toFixed(1);

  console.log(`DeepL API usage:`);
  console.log(`  Characters used:      ${used.toLocaleString()} / ${limit.toLocaleString()} (${pct}%)`);
  console.log(`  Characters remaining: ${remaining.toLocaleString()}`);
}
