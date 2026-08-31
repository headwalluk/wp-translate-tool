// Test driver: dumps parser results as stable, diffable text.
//
// Assertions live in the golden files under tests/expected/. This file only
// prints; tests/run-tests.sh does the comparing. Keep the output format stable
// — changing it invalidates every golden file at once.

import { parsePo, getUntranslated, writePo } from '../src/po-parser.js';

const FIXTURE_PATH = process.argv[2];
const ROUNDTRIP_PATH = process.argv[3];

if (!FIXTURE_PATH) {
  console.error('usage: driver.mjs <fixture.po> [roundtrip-output.po]');
  process.exit(1);
}

const entries = parsePo(FIXTURE_PATH);

console.log('== ENTRIES ==');
entries.forEach((entry, index) => {
  console.log(`[${index}]`);
  console.log(`  msgctxt     : ${JSON.stringify(entry.msgctxt)}`);
  console.log(`  comments    : ${JSON.stringify(entry.extractedComments)}`);
  console.log(`  msgid       : ${JSON.stringify(entry.msgid)}`);
  console.log(`  msgstr      : ${JSON.stringify(entry.msgstr)}`);
  console.log(`  msgstrIndex : ${entry.msgstrIndex}`);
  console.log(`  isPlural    : ${entry.isPlural}`);
  console.log(`  rawLines    : ${entry.raw.length}`);
});

const { standard, contextual } = getUntranslated(entries);

console.log('== SELECTION ==');
console.log(`standard   : ${standard.length}`);
for (const entry of standard) console.log(`  ${JSON.stringify(entry.msgid)}`);
console.log(`contextual : ${contextual.length}`);
for (const entry of contextual) console.log(`  ${JSON.stringify(entry.msgid)}`);

if (ROUNDTRIP_PATH) writePo(ROUNDTRIP_PATH, entries);
