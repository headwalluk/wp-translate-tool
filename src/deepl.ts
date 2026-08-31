import https from 'https';
import { PoEntry, sanitize, unsanitize, setPluralTranslations } from './po-parser.js';

const BATCH_SIZE = 50;
const API_HOST = 'api-free.deepl.com';

// Small pause between consecutive translate requests to stay under DeepL's rate
// limit (HTTP 429). Override with WP_TRANSLATE_API_DELAY_MS (set 0 to disable).
const REQUEST_DELAY_MS = (() => {
  const raw = process.env.WP_TRANSLATE_API_DELAY_MS;
  if (raw === undefined) return 500;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 500;
})();

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Retry on rate limits (429) and transient server errors. Override the attempt
// count with WP_TRANSLATE_MAX_RETRIES (set 0 to disable retrying).
const MAX_RETRIES = (() => {
  const raw = process.env.WP_TRANSLATE_MAX_RETRIES;
  if (raw === undefined) return 5;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 5;
})();

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 60000;

// Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds.
// Returns null when absent or unparseable.
function parseRetryAfter(value: string | undefined): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(value);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

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

interface HttpResult {
  status: number;
  retryAfter: string | undefined;
  data: string;
}

// A single HTTP attempt. Resolves with status/headers/body for any response;
// only rejects on a transport-level error (no connection, socket reset, …).
function httpAttempt(authKey: string, path: string, postData?: string): Promise<HttpResult> {
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
        const retryAfter = res.headers['retry-after'];
        resolve({
          status: res.statusCode ?? 0,
          retryAfter: Array.isArray(retryAfter) ? retryAfter[0] : retryAfter,
          data,
        });
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function apiRequest(authKey: string, path: string, body?: object): Promise<any> {
  const postData = body ? JSON.stringify(body) : undefined;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: HttpResult | null = null;
    try {
      res = await httpAttempt(authKey, path, postData);
    } catch (err) {
      // Transport error — treat as retryable.
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (res) {
      if (res.status === 200) return JSON.parse(res.data);
      if (!RETRYABLE_STATUS.has(res.status)) {
        throw new Error(`DeepL API returned ${res.status}: ${res.data}`);
      }
      lastError = new Error(`DeepL API returned ${res.status}: ${res.data}`);
    }

    if (attempt === MAX_RETRIES) break;

    // Prefer the server's Retry-After; otherwise exponential backoff with cap.
    const hinted = res ? parseRetryAfter(res.retryAfter) : null;
    const backoff = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
    const waitMs = hinted ?? backoff;
    const reason = res ? `HTTP ${res.status}` : 'connection error';
    process.stderr.write(
      `\n   DeepL ${reason}; retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})...\n`,
    );
    await sleep(waitMs);
  }

  throw lastError ?? new Error('DeepL API request failed');
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
    if (i > 0 && REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
    const batch = entries.slice(i, i + BATCH_SIZE);
    const texts = batch.map(e => unsanitize(e.msgid!));
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
    if (i > 0 && REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
    // msgctxt (_x()) takes precedence over an extracted translator comment (#.).
    const context = item.msgctxt ?? item.extractedComments;
    const body: Record<string, unknown> = {
      text: [unsanitize(item.msgid!)],
      target_lang: deepLLang,
    };
    if (context) body.context = unsanitize(context);
    const result: DeepLResponse = await apiRequest(authKey, '/v2/translate', body);
    if (result.translations.length > 0) {
      item.newTranslation = `msgstr "${sanitize(result.translations[0].text)}"`;
    }
  }
  if (entries.length > 1) {
    process.stdout.write(''.padEnd(40) + '\r');
  }
}

// Plural (_n()) entries: singular and plural form together in one request.
//
// This rides the per-entry path rather than the 50-string batch for two
// reasons. DeepL's `context` is one string per request, so a plural carrying a
// msgctxt or a translator comment cannot share a batch anyway; and the batch
// path maps one array slot to one entry, which a two-form entry breaks.
//
// Pairing the forms buys fewer requests and a slot mapping that stays local —
// NOT consistency between the two forms. DeepL translates array elements
// independently and guarantees nothing across them.
export async function translatePlurals(
  entries: PoEntry[],
  targetLang: string,
  authKey: string,
): Promise<void> {
  const deepLLang = mapLocale(targetLang);

  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    if (entries.length > 1) {
      process.stdout.write(`   Translating plural ${i + 1}/${entries.length}...\r`);
    }
    if (i > 0 && REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);

    const texts = [unsanitize(item.msgid!)];
    if (item.msgidPlural !== null) texts.push(unsanitize(item.msgidPlural));

    const body: Record<string, unknown> = {
      text: texts,
      target_lang: deepLLang,
    };
    const context = item.msgctxt ?? item.extractedComments;
    if (context) body.context = unsanitize(context);

    const result: DeepLResponse = await apiRequest(authKey, '/v2/translate', body);
    setPluralTranslations(item, result.translations.map(t => sanitize(t.text)));
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
