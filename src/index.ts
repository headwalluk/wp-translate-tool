import { existsSync, copyFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { loadConfig } from './config.js';
import { validateLocales, checkDependencies } from './validation.js';
import { findOrCreatePot, detectLocales } from './pot.js';
import { parsePo, injectLanguageHeader, applyTranslations, writePo, getUntranslated } from './po-parser.js';
import { translateBatch, translateContextual } from './deepl.js';
import { updatePo, makeMo } from './wp-cli.js';

const DEFAULT_LOCALES = 'en_GB,fr_FR,de_DE,es_ES,nl_NL,it_IT,pl_PL,el_GR';

function parseArgs(): { pluginPath: string; locales: string[] } {
  const pluginPath = process.argv[2] ? resolve(process.argv[2]) : '';
  let localesInput = process.argv[3];

  if (!pluginPath) {
    console.error(`Usage: ${basename(process.argv[1])} <plugin-path> [locales]`);
    console.error(`Example: ${basename(process.argv[1])} . en_GB,fr_FR,de_DE`);
    process.exit(1);
  }

  // Auto-detect locales from existing .po files if not provided
  if (!localesInput) {
    const detected = detectLocales(pluginPath);
    if (detected) {
      localesInput = detected.join(',');
    } else {
      localesInput = DEFAULT_LOCALES;
    }
  }

  const locales = localesInput.split(',').map(l => l.trim());
  return { pluginPath, locales };
}

async function processLocale(
  poFile: string,
  locale: string,
  authKey: string,
): Promise<void> {
  const entries = parsePo(poFile);
  injectLanguageHeader(entries, locale);

  const { standard, contextual } = getUntranslated(entries);

  if (standard.length === 0 && contextual.length === 0) {
    console.log(`   ${locale}: Nothing new to translate.`);
    writePo(poFile, entries);
    return;
  }

  console.log(`   ${locale}: Found ${standard.length} standard and ${contextual.length} contextual strings.`);

  if (standard.length > 0) await translateBatch(standard, locale, authKey);
  if (contextual.length > 0) await translateContextual(contextual, locale, authKey);

  const count = applyTranslations(entries);
  writePo(poFile, entries);
  console.log(`   ${locale}: Updated ${count} strings.`);
}

async function main() {
  const { deeplAuthKey } = loadConfig();
  const { pluginPath, locales } = parseArgs();

  checkDependencies();
  validateLocales(locales);

  console.log(`Plugin path : ${pluginPath}`);
  console.log(`Locales     : ${locales.join(',')}`);

  const potFile = findOrCreatePot(pluginPath);
  console.log(`>> Source POT: ${potFile}`);

  const domain = basename(potFile, '.pot');

  for (const locale of locales) {
    const poFile = join(pluginPath, 'languages', `${domain}-${locale}.po`);

    if (existsSync(poFile)) {
      console.log(`>> Syncing ${locale} (keeping existing)...`);
      updatePo(potFile, poFile);
    } else {
      console.log(`>> Creating ${locale} (fresh)...`);
      copyFileSync(potFile, poFile);
    }

    await processLocale(poFile, locale, deeplAuthKey);
  }

  console.log('>> Compiling .mo files...');
  makeMo(join(pluginPath, 'languages/'));

  console.log('>> Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
