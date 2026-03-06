import { existsSync, copyFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { loadConfig } from './config.js';
import { validateLocales, checkDependencies } from './validation.js';
import { findOrCreatePot, detectLocales } from './pot.js';
import { parsePo, injectLanguageHeader, applyTranslations, writePo, getUntranslated } from './po-parser.js';
import { translateBatch, translateContextual, checkUsage } from './deepl.js';
import { updatePo, makeMo } from './wp-cli.js';
import { checkForUpdate, getVersion } from './update.js';

const DEFAULT_LOCALES = 'en_GB,fr_FR,de_DE,es_ES,nl_NL,it_IT,pl_PL,el_GR';

function printHelp(): void {
  const bin = basename(process.argv[1]);
  console.log(`wp-translate-tool v${getVersion()}`);
  console.log(`Translate WordPress plugin .po files using the DeepL API.\n`);
  console.log(`Usage:`);
  console.log(`  ${bin} <plugin-path> [locales]    Translate a plugin`);
  console.log(`  ${bin} <plugin-path> --dry-run     Show what would be translated`);
  console.log(`  ${bin} --usage                     Show DeepL API quota`);
  console.log(`  ${bin} --check-update              Check for a newer release`);
  console.log(`  ${bin} --version, -v               Print version`);
  console.log(`  ${bin} --help, -h                  Show this help\n`);
  console.log(`Arguments:`);
  console.log(`  plugin-path   Path to the WordPress plugin directory`);
  console.log(`  locales       Comma-separated list (e.g., en_GB,fr_FR,de_DE)`);
  console.log(`                If omitted, auto-detects from existing .po files\n`);
  console.log(`Examples:`);
  console.log(`  ${bin} ./my-plugin/ en_GB,fr_FR,de_DE`);
  console.log(`  ${bin} /var/www/html/wp-content/plugins/my-plugin/`);
}

function parseArgs(): { pluginPath: string; locales: string[] } {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('-'));
  const pluginPath = positional[0] ? resolve(positional[0]) : '';
  let localesInput = positional[1];

  if (!pluginPath) {
    printHelp();
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
  dryRun: boolean,
): Promise<number> {
  const entries = parsePo(poFile);
  injectLanguageHeader(entries, locale);

  const { standard, contextual } = getUntranslated(entries);
  const total = standard.length + contextual.length;

  if (total === 0) {
    console.log(`   ${locale}: Nothing new to translate.`);
    if (!dryRun) writePo(poFile, entries);
    return 0;
  }

  console.log(`   ${locale}: Found ${standard.length} standard and ${contextual.length} contextual strings.`);

  if (dryRun) return total;

  if (standard.length > 0) await translateBatch(standard, locale, authKey);
  if (contextual.length > 0) await translateContextual(contextual, locale, authKey);

  const count = applyTranslations(entries);
  writePo(poFile, entries);
  console.log(`   ${locale}: Updated ${count} strings.`);
  return count;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(getVersion());
    return;
  }

  if (args.includes('--check-update')) {
    await checkForUpdate();
    return;
  }

  if (args.includes('--usage')) {
    const { deeplAuthKey } = loadConfig();
    await checkUsage(deeplAuthKey);
    return;
  }

  const dryRun = args.includes('--dry-run');
  const { deeplAuthKey } = loadConfig();
  const { pluginPath, locales } = parseArgs();

  checkDependencies();
  validateLocales(locales);

  if (dryRun) {
    console.log(`[dry-run] No files will be modified and no API calls will be made.\n`);
  }

  console.log(`Plugin path : ${pluginPath}`);
  console.log(`Locales     : ${locales.join(',')}`);

  const potFile = findOrCreatePot(pluginPath);
  console.log(`>> Source POT: ${potFile}`);

  const domain = basename(potFile, '.pot');
  let totalStrings = 0;
  let localesProcessed = 0;

  for (const locale of locales) {
    const poFile = join(pluginPath, 'languages', `${domain}-${locale}.po`);

    if (!dryRun) {
      if (existsSync(poFile)) {
        console.log(`>> Syncing ${locale} (keeping existing)...`);
        updatePo(potFile, poFile);
      } else {
        console.log(`>> Creating ${locale} (fresh)...`);
        copyFileSync(potFile, poFile);
      }
    }

    const count = await processLocale(poFile, locale, deeplAuthKey, dryRun);
    totalStrings += count;
    if (count > 0) localesProcessed++;
  }

  if (dryRun) {
    console.log(`\n[dry-run] Would translate ${totalStrings} strings across ${localesProcessed} locale(s).`);
    return;
  }

  console.log('>> Compiling .mo files...');
  makeMo(join(pluginPath, 'languages/'));

  console.log(`\n>> Done: ${localesProcessed} locale(s), ${totalStrings} strings translated.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
