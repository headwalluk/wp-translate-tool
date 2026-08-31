import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { createInterface } from 'readline';
import { loadConfig } from './config.js';
import { validateLocales, checkDependencies } from './validation.js';
import { findOrCreatePot, detectLocales } from './pot.js';
import { parsePo, injectLanguageHeader, applyTranslations, writePo, getUntranslated, setIdentityTranslation, sanitize, unsanitize } from './po-parser.js';
import { translateBatch, translateContextual, checkUsage } from './deepl.js';
import { englishTarget, toBritish } from './english.js';
import { isProtectedAcronym } from './acronyms.js';
import { updatePo, makeMo } from './wp-cli.js';
import { checkForUpdate, getVersion } from './update.js';
import { findAgentFiles, detectDomain, blockStatus, applyBlock, BlockStatus } from './instructions.js';

const DEFAULT_LOCALES = 'en_GB,fr_FR,de_DE,es_ES,nl_NL,it_IT,pl_PL,el_GR';

function printHelp(): void {
  const bin = basename(process.argv[1]);
  console.log(`wp-translate-tool v${getVersion()}`);
  console.log(`Translate WordPress plugin .po files using the DeepL API.\n`);
  console.log(`Usage:`);
  console.log(`  ${bin} <plugin-path> [locales]    Translate a plugin`);
  console.log(`  ${bin} <plugin-path> --dry-run     Show what would be translated`);
  console.log(`  ${bin} <plugin-path> --check-instructions   Check agent-instructions block`);
  console.log(`  ${bin} <plugin-path> --sync-instructions    Inject/update agent-instructions block`);
  console.log(`  ${bin} --usage                     Show DeepL API quota`);
  console.log(`  ${bin} --check-update              Check for a newer release`);
  console.log(`  ${bin} --version, -v               Print version`);
  console.log(`  ${bin} --help, -h                  Show this help\n`);
  console.log(`Options:`);
  console.log(`  --yes, -y     Skip the confirmation prompt for --sync-instructions\n`);
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

  // _n() plurals are not yet translatable. Report them rather than leaving the
  // gap silent — an untranslated plural is otherwise invisible in the summary.
  const pluralCount = entries.filter(e => e.isPlural).length;
  if (pluralCount > 0) {
    const noun = pluralCount === 1 ? 'entry' : 'entries';
    console.log(`   ${locale}: ${pluralCount} plural ${noun} skipped (not yet supported).`);
  }

  if (total === 0) {
    console.log(`   ${locale}: Nothing new to translate.`);
    if (!dryRun) writePo(poFile, entries);
    return 0;
  }

  // English targets never go to DeepL (en->en is a no-op there). en/en_US pass
  // through verbatim; en_GB/en_AU/... get local American->British conversion.
  const mode = englishTarget(locale);

  if (mode !== 'none') {
    const all = [...standard, ...contextual];
    let converted = 0;
    if (mode === 'gb-convert') {
      for (const e of all) {
        const brit = toBritish(unsanitize(e.msgid!));
        if (brit !== unsanitize(e.msgid!)) {
          e.newTranslation = `msgstr "${sanitize(brit)}"`;
          converted++;
        } else {
          setIdentityTranslation(e);
        }
      }
      console.log(`   ${locale}: ${all.length - converted} passed through, ${converted} localised to British spelling (no API call).`);
    } else {
      for (const e of all) setIdentityTranslation(e);
      console.log(`   ${locale}: ${all.length} string(s) — passthrough (English source dialect, no API call).`);
    }

    if (dryRun) return total;

    const count = applyTranslations(entries);
    writePo(poFile, entries);
    console.log(`   ${locale}: Updated ${count} strings.`);
    return count;
  }

  // Keep protected acronyms verbatim instead of letting DeepL mangle them.
  const all = [...standard, ...contextual];
  const acronyms = new Set(all.filter(e => isProtectedAcronym(unsanitize(e.msgid!))));
  const apiStandard = standard.filter(e => !acronyms.has(e));
  const apiContextual = contextual.filter(e => !acronyms.has(e));

  console.log(
    `   ${locale}: Found ${standard.length} standard and ${contextual.length} contextual strings.` +
    (acronyms.size > 0 ? ` (${acronyms.size} acronym(s) kept verbatim)` : ''),
  );

  if (dryRun) return total;

  for (const e of acronyms) setIdentityTranslation(e);
  if (apiStandard.length > 0) await translateBatch(apiStandard, locale, authKey);
  if (apiContextual.length > 0) await translateContextual(apiContextual, locale, authKey);

  const count = applyTranslations(entries);
  writePo(poFile, entries);
  console.log(`   ${locale}: Updated ${count} strings.`);
  return count;
}

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, ans => {
    rl.close();
    res(/^y(es)?$/i.test(ans.trim()));
  }));
}

// Handle --check-instructions / --sync-instructions. Returns the process exit code.
async function runInstructions(pluginPath: string, opts: { sync: boolean; assumeYes: boolean }): Promise<number> {
  const { sync, assumeYes } = opts;

  if (!existsSync(pluginPath)) {
    console.error(`Error: plugin path not found: ${pluginPath}`);
    return 1;
  }

  const looked = 'AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, GEMINI.md';
  const { target, others } = findAgentFiles(pluginPath);

  if (!target) {
    console.log(`No agent-instructions file found (looked for: ${looked}).`);
    console.log(`Nothing to update — wp-translate only updates existing files.`);
    return 0;
  }

  const domain = detectDomain(pluginPath);
  const filePath = join(pluginPath, target);
  const content = readFileSync(filePath, 'utf8');
  const status = blockStatus(content, domain);

  if (others.length > 0) {
    console.log(`Note: also present, left untouched: ${others.join(', ')}`);
  }

  const labels: Record<BlockStatus, string> = {
    'current': 'up to date',
    'stale': 'out of date',
    'missing-block': 'no wp-translate block',
    'drift': 'block was hand-edited',
    'newer': 'block is newer than this tool',
  };
  console.log(`${target} (text domain: ${domain}): ${labels[status]}.`);

  if (!sync) {
    // check mode: exit 2 if --sync would change something, else 0.
    const actionable = status === 'stale' || status === 'missing-block' || status === 'drift';
    return actionable ? 2 : 0;
  }

  if (status === 'current') {
    console.log(`Already current — no change.`);
    return 0;
  }
  if (status === 'newer') {
    console.log(`Leaving as-is. Upgrade wp-translate to manage this block.`);
    return 0;
  }
  if (status === 'drift') {
    console.log(`Warning: the block was hand-edited; --sync will overwrite it.`);
  }

  if (process.stdout.isTTY && !assumeYes) {
    const verb = status === 'missing-block' ? 'Add' : 'Update';
    const ok = await confirm(`${verb} the wp-translate block in ${target}? [y/N] `);
    if (!ok) {
      console.log(`Aborted. No changes made.`);
      return 0;
    }
  }

  writeFileSync(filePath, applyBlock(content, domain));
  console.log(`${status === 'missing-block' ? 'Added' : 'Updated'} wp-translate block in ${target}.`);
  return 0;
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

  if (args.includes('--check-instructions') || args.includes('--sync-instructions')) {
    const sync = args.includes('--sync-instructions');
    const assumeYes = args.includes('--yes') || args.includes('-y');
    const positional = args.filter(a => !a.startsWith('-'));
    const pluginPath = positional[0] ? resolve(positional[0]) : '';
    if (!pluginPath) {
      console.error('Error: a plugin path is required for instruction sync.');
      process.exit(1);
    }
    process.exit(await runInstructions(pluginPath, { sync, assumeYes }));
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

    const poExists = existsSync(poFile);

    if (!dryRun) {
      if (poExists) {
        console.log(`>> Syncing ${locale} (keeping existing)...`);
        updatePo(potFile, poFile);
      } else {
        console.log(`>> Creating ${locale} (fresh)...`);
        copyFileSync(potFile, poFile);
      }
    } else if (!poExists) {
      console.log(`>> Would create ${locale} (fresh)...`);
    }

    // In dry-run a fresh locale's .po is not created, so read the POT as the
    // basis for what would be translated. Outside dry-run the .po always exists
    // here (just created/synced above) and must be the file we read and write.
    const sourceFile = dryRun && !poExists ? potFile : poFile;
    const count = await processLocale(sourceFile, locale, deeplAuthKey, dryRun);
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
