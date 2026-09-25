// Unit driver: dumps plural-sample decisions as stable, diffable text.
//
// Compared against tests/expected/units.txt by tests/run-tests.sh.

import { getPluralForms } from '../src/plurals.js';
import { sampleNumbers, findCountPlaceholder, planSampleTexts, restorePlaceholder, resolveSampleTranslations } from '../src/plural-samples.js';

console.log('== SAMPLE NUMBERS ==');
for (const locale of ['de_DE', 'fr_FR', 'pl_PL', 'ru_RU', 'cs_CZ', 'lt_LT', 'lv_LV', 'ro_RO', 'sl_SI', 'cy_GB', 'ga_IE', 'ar', 'ja']) {
  console.log(`${locale.padEnd(6)} : ${JSON.stringify(sampleNumbers(getPluralForms(locale).forms))}`);
}

console.log('== COUNT PLACEHOLDER ==');
const PLACEHOLDER_CASES: [string, string][] = [
  ['%d file', '%d files'],
  ['One file', '%d files'],
  ['%s file', '%s files'],
  ['%1$s has %2$d file', '%1$s has %2$d files'],
  ['%s of %d', '%s of %d'],
  ['%s and %s', '%s and %s'],
  ['100%% of %d file', '100%% of %d files'],
  ['No placeholder', 'Still none'],
];
for (const [singular, plural] of PLACEHOLDER_CASES) {
  console.log(`${JSON.stringify(plural).padEnd(24)} : ${JSON.stringify(findCountPlaceholder(singular, plural))}`);
}

console.log('== PLAN ==');
const POLISH_SAMPLES = sampleNumbers(getPluralForms('pl_PL').forms);
const PLAN_CASES: [string, string, number[] | null, number][] = [
  ['%d file deleted.', '%d files deleted.', POLISH_SAMPLES, 3],
  ['One file deleted.', '%d files deleted.', POLISH_SAMPLES, 3],
  ['%d file in 2 folders', '%d files in 2 folders', POLISH_SAMPLES, 3],
  ['%d file deleted.', '%d files deleted.', POLISH_SAMPLES, 2],
];
for (const [singular, plural, samples, slotCount] of PLAN_CASES) {
  console.log(`${JSON.stringify(plural)} slots=${slotCount}`);
  console.log(`  ${JSON.stringify(planSampleTexts(singular, plural, samples, slotCount))}`);
}

console.log('== RESTORE ==');
const RESTORE_CASES: [string, string, number][] = [
  ['Usunięto 5 plików.', '%d', 5],
  ['Usunięto 15 plików.', '%d', 5],
  ['Usunięto 5 plików z 5.', '%d', 5],
  ['Usunięto pięć plików.', '%d', 5],
  ['Il reste 1 minute.', '%1$d', 1],
];
for (const [translation, placeholder, sample] of RESTORE_CASES) {
  console.log(`${JSON.stringify(translation).padEnd(28)} -> ${JSON.stringify(restorePlaceholder(translation, placeholder, sample))}`);
}

console.log('== RESOLVE ==');
const plan = planSampleTexts('%d file deleted.', '%d files deleted.', POLISH_SAMPLES, 3)!;
console.log(JSON.stringify(resolveSampleTranslations(
  plan,
  ['Usunięto 1 plik.', 'Usunięto dwa pliki.', 'Usunięto 5 plików.'],
  ['PLAIN-SINGULAR %d', 'PLAIN-PLURAL %d'],
)));
