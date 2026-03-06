import https from 'https';
import { PoEntry, sanitize } from './po-parser.js';

const BATCH_SIZE = 50;

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

function apiRequest(authKey: string, body: object): Promise<DeepLResponse> {
  const postData = JSON.stringify(body);
  const options: https.RequestOptions = {
    hostname: 'api-free.deepl.com',
    path: '/v2/translate',
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${authKey}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
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
    req.write(postData);
    req.end();
  });
}

export async function translateBatch(
  entries: PoEntry[],
  targetLang: string,
  authKey: string,
): Promise<void> {
  const deepLLang = mapLocale(targetLang);

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const texts = batch.map(e => e.msgid!);
    const result = await apiRequest(authKey, { text: texts, target_lang: deepLLang });
    result.translations.forEach((t, index) => {
      batch[index].newTranslation = `msgstr "${sanitize(t.text)}"`;
    });
  }
}

export async function translateContextual(
  entries: PoEntry[],
  targetLang: string,
  authKey: string,
): Promise<void> {
  const deepLLang = mapLocale(targetLang);

  for (const item of entries) {
    const result = await apiRequest(authKey, {
      text: [item.msgid],
      target_lang: deepLLang,
      context: item.msgctxt,
    });
    if (result.translations.length > 0) {
      item.newTranslation = `msgstr "${sanitize(result.translations[0].text)}"`;
    }
  }
}
