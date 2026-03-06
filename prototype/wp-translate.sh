#!/bin/bash

##
# Example:
# ./wp-translate.sh my-plugin/ en_GB,fr_FR,de_DE,es_ES,nl_NL,it_IT,pl_PL,el_GR
#

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
DEEPL_ENV="${HOME}/.config/deepl.env"

if [[ ! -f "${DEEPL_ENV}" ]]; then
  echo "Error: DeepL config file missing at: ${DEEPL_ENV}" >&2
  exit 1
fi

source "${DEEPL_ENV}"

if [[ -z "${DEEPL_AUTH_KEY}" ]]; then
  echo "Error: DEEPL_AUTH_KEY environment variable is not set in ${DEEPL_ENV}." >&2
  echo "Get a free key at https://www.deepl.com/pro-api" >&2
  exit 1
fi

PLUGIN_PATH="${1}"
LOCALES_INPUT="${2}"
POT_FILE=""

if [ -n "${PLUGIN_PATH}" ] && [ -d "${PLUGIN_PATH}/languages" ] && [ -z "${LOCALES_INPUT}" ]; then
  LOCALES_INPUT="$(ls -1 "${PLUGIN_PATH}"/languages | grep -oE '[a-z]{2}_[A-Z]{2}\.po$' | cut -d'.' -f1 | sort -u | paste -sd, -)"
fi

if [ -z "${LOCALES_INPUT}" ]; then
  LOCALES_INPUT='en_GB,fr_FR,de_DE,es_ES,nl_NL,it_IT,pl_PL,el_GR'
fi

if [ -z "${PLUGIN_PATH}" ] || [ -z "${LOCALES_INPUT}" ]; then
  echo "Usage: $(basename "${0}") <plugin-path> <locales>" >&2
  echo "Example: $(basename "${0}") . en_GB,fr_FR,de_DE" >&2
  exit 1
fi

echo "Plugin path : ${PLUGIN_PATH}"
echo "Locales     : ${LOCALES_INPUT}"

# exit 1

# -----------------------------------------------------------------------------
# Validation: Check Format of All Locales
# -----------------------------------------------------------------------------
IFS=',' read -ra VALIDATE_ADDR <<< "${LOCALES_INPUT}"
INVALID_COUNT=0

for LOC in "${VALIDATE_ADDR[@]}"; do
  LOC=$(echo "${LOC}" | xargs)
  if [[ ! "${LOC}" =~ ^[a-z]{2,3}(_[a-zA-Z0-9]{2,})?$ ]]; then
    echo "Error: Invalid locale format detected: '${LOC}'" >&2
    echo "       WordPress locales use underscores (e.g., 'nl_NL'), not hyphens." >&2
    ((INVALID_COUNT++))
  fi
done

if ((INVALID_COUNT > 0)); then
  echo "Aborting operation. ${INVALID_COUNT} invalid locale(s) found. No files were modified." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# Dependency Checks
# -----------------------------------------------------------------------------
command -v wp > /dev/null 2>&1 || {
  echo "Error: wp-cli is required." >&2
  exit 1
}
command -v node > /dev/null 2>&1 || {
  echo "Error: node is required." >&2
  exit 1
}

# -----------------------------------------------------------------------------
# Locate or Generate POT
# -----------------------------------------------------------------------------
POT_FILE=$(find "${PLUGIN_PATH}/languages" -name "*.pot" | head -n 1)

if [[ -z "${POT_FILE}" ]]; then
  echo "No .pot file found in ${PLUGIN_PATH}/languages/. Generating one..."
  wp i18n make-pot "${PLUGIN_PATH}" "${PLUGIN_PATH}/languages/$(basename "${PLUGIN_PATH}").pot"
  POT_FILE=$(find "${PLUGIN_PATH}/languages" -name "*.pot" | head -n 1)
fi

echo ">> Source POT: ${POT_FILE}"

# -----------------------------------------------------------------------------
# EMBEDDED NODEJS WORKER SCRIPT
# -----------------------------------------------------------------------------
WORKER_SCRIPT=$(mktemp)
cat << 'EOF' > "${WORKER_SCRIPT}"
const fs = require('fs');
const https = require('https');
const path = require('path');

const [,, poFile, targetLang, authKey] = process.argv;

function mapLocale(wpLocale) {
    const parts = wpLocale.replace('_', '-').split('-');
    const lang = parts[0].toUpperCase();
    if (lang === 'EN' && parts[1]) return `EN-${parts[1].toUpperCase()}`;
    if (lang === 'PT' && parts[1]) return `PT-${parts[1].toUpperCase()}`;
    return lang;
}

const deepLLang = mapLocale(targetLang);

// 1. Parse PO File
const content = fs.readFileSync(poFile, 'utf8');
const lines = content.split('\n');

let entries = [];
let currentEntry = { raw: [], msgctxt: null, msgid: null, msgstr: null, msgstrIndex: -1, newTranslation: null };
let state = 'NONE';

function pushEntry() {
    if (currentEntry.raw.length > 0) {
        // Strip trailing empty lines
        while(currentEntry.raw.length > 0 && currentEntry.raw[currentEntry.raw.length - 1].trim() === '') {
            currentEntry.raw.pop();
        }
        if (currentEntry.raw.length > 0) entries.push(currentEntry);
    }
    currentEntry = { raw: [], msgctxt: null, msgid: null, msgstr: null, msgstrIndex: -1, newTranslation: null };
}

lines.forEach(line => {
    // Blank line indicates end of block
    if (line.trim() === '' && state !== 'NONE') {
        pushEntry();
        state = 'NONE';
        return;
    }

    // Capture msgctxt (Context)
    if (line.startsWith('msgctxt ')) {
        const match = line.match(/^msgctxt "(.*)"/);
        if (match) {
            currentEntry.msgctxt = match[1];
            state = 'CTX';
        }
    }
    else if (line.startsWith('"') && state === 'CTX') {
         const match = line.match(/^"(.*)"/);
         if (match && currentEntry.msgctxt !== null) currentEntry.msgctxt += match[1];
    }

    // Capture msgid
    if (line.startsWith('msgid ')) {
        const match = line.match(/^msgid "(.*)"/);
        if (match) {
            currentEntry.msgid = match[1];
            state = 'ID';
        }
    }
    else if (line.startsWith('"') && state === 'ID') {
        const match = line.match(/^"(.*)"/);
        if (match && currentEntry.msgid !== null) currentEntry.msgid += match[1];
    }

    // Capture msgstr
    if (line.startsWith('msgstr ')) {
        const match = line.match(/^msgstr "(.*)"/);
        if (match) {
            currentEntry.msgstr = match[1];
            currentEntry.msgstrIndex = currentEntry.raw.length; 
            state = 'STR';
        }
    }
    else if (line.startsWith('"') && state === 'STR') {
        const match = line.match(/^"(.*)"/);
        if (match && currentEntry.msgstr !== null) currentEntry.msgstr += match[1];
    }

    currentEntry.raw.push(line);
});
pushEntry(); 

// 2. HEADER FIX: Inject "Language" header if missing
if (entries.length > 0 && entries[0].msgid === "") {
    const headerEntry = entries[0];
    const headerContent = headerEntry.raw.join('\n');
    if (!headerContent.includes('"Language:')) {
        const strIndex = headerEntry.msgstrIndex;
        if (strIndex > -1) {
            const newHeader = `"Language: ${targetLang}\\n"`;
            headerEntry.raw.splice(strIndex + 1, 0, newHeader);
        }
    }
}

// 3. Identify strings needing translation
const toTranslate = entries.filter(e => 
    e.msgid && 
    e.msgid !== "" && 
    e.msgstr === ""
);

if (toTranslate.length === 0) {
    console.log(`   ${targetLang}: Nothing new to translate.`);
    // Still write file to ensure Headers are fixed
    const output = entries.map(e => e.raw.join('\n')).join('\n\n');
    fs.writeFileSync(poFile, output);
    process.exit(0);
}

// 4. Split workloads: Batched (No Context) vs Individual (Context)
const standardItems = toTranslate.filter(e => !e.msgctxt);
const contextItems = toTranslate.filter(e => e.msgctxt);

console.log(`   ${targetLang}: Found ${standardItems.length} standard and ${contextItems.length} contextual strings.`);

// Helper: Sanitize string for PO
function sanitize(text) {
    let cleanText = text.replace(/\\/g, '\\\\');
    cleanText = cleanText.replace(/"/g, '\\"');
    cleanText = cleanText.replace(/\n/g, '\\n');
    cleanText = cleanText.replace(/\r/g, '');
    cleanText = cleanText.replace(/\t/g, '\\t');
    return cleanText;
}

// A. Process Standard Batches
async function processStandardBatches() {
    const BATCH_SIZE = 50;
    const batches = [];
    for (let i = 0; i < standardItems.length; i += BATCH_SIZE) {
        batches.push(standardItems.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
        const texts = batch.map(e => e.msgid);
        const postData = JSON.stringify({
            text: texts,
            target_lang: deepLLang
        });

        const options = {
            hostname: 'api-free.deepl.com',
            path: '/v2/translate',
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${authKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        console.error(`Error (Batch): API returned ${res.statusCode}`, data);
                        process.exit(1);
                    }
                    const result = JSON.parse(data);
                    result.translations.forEach((t, index) => {
                        batch[index].newTranslation = `msgstr "${sanitize(t.text)}"`;
                    });
                    resolve();
                });
            });
            req.on('error', (e) => reject(e));
            req.write(postData);
            req.end();
        });
    }
}

// B. Process Contextual Items (Individually)
async function processContextItems() {
    for (const item of contextItems) {
        const postData = JSON.stringify({
            text: [item.msgid],
            target_lang: deepLLang,
            context: item.msgctxt // PASSING CONTEXT HERE
        });

        const options = {
            hostname: 'api-free.deepl.com',
            path: '/v2/translate',
            method: 'POST',
            headers: {
                'Authorization': `DeepL-Auth-Key ${authKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        console.error(`Error (Context): API returned ${res.statusCode}`, data);
                        process.exit(1);
                    }
                    const result = JSON.parse(data);
                    // result.translations is an array, take the first
                    if (result.translations && result.translations.length > 0) {
                        item.newTranslation = `msgstr "${sanitize(result.translations[0].text)}"`;
                    }
                    resolve();
                });
            });
            req.on('error', (e) => reject(e));
            req.write(postData);
            req.end();
        });
    }
}

// Main Execution
async function run() {
    if (standardItems.length > 0) await processStandardBatches();
    if (contextItems.length > 0) await processContextItems();

    let updateCount = 0;
    entries.forEach(entry => {
        if (entry.newTranslation && entry.msgstrIndex > -1) {
            entry.raw[entry.msgstrIndex] = entry.newTranslation;
            updateCount++;
        }
    });

    const output = entries.map(e => e.raw.join('\n')).join('\n\n');
    fs.writeFileSync(poFile, output);
    console.log(`   ${targetLang}: Updated ${updateCount} strings.`);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
EOF
# -----------------------------------------------------------------------------
# END NODE SCRIPT
# -----------------------------------------------------------------------------

# Loop through locales
IFS=',' read -ra ADDR <<< "${LOCALES_INPUT}"
for LOCALE in "${ADDR[@]}"; do
  LOCALE=$(echo "${LOCALE}" | xargs)
  DOMAIN=$(basename "${POT_FILE}" .pot)
  PO_FILE="${PLUGIN_PATH}/languages/${DOMAIN}-${LOCALE}.po"

  if [[ -f "${PO_FILE}" ]]; then
    echo ">> Syncing ${LOCALE} (keeping existing)..."
    wp i18n update-po "${POT_FILE}" "${PO_FILE}" > /dev/null 2>&1
  else
    echo ">> Creating ${LOCALE} (fresh)..."
    cp "${POT_FILE}" "${PO_FILE}"
  fi

  node "${WORKER_SCRIPT}" "${PO_FILE}" "${LOCALE}" "${DEEPL_AUTH_KEY}"
done

rm "${WORKER_SCRIPT}"

echo ">> Compiling .mo files..."
wp i18n make-mo "${PLUGIN_PATH}/languages/"

echo ">> Done."
