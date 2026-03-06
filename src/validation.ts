import { execSync } from 'child_process';

const LOCALE_PATTERN = /^[a-z]{2,3}(_[a-zA-Z0-9]{2,})?$/;

export function validateLocales(locales: string[]): void {
  const invalid = locales.filter(loc => !LOCALE_PATTERN.test(loc));

  if (invalid.length > 0) {
    for (const loc of invalid) {
      console.error(`Error: Invalid locale format: '${loc}'`);
      console.error("       WordPress locales use underscores (e.g., 'nl_NL'), not hyphens.");
    }
    console.error(`Aborting. ${invalid.length} invalid locale(s) found. No files were modified.`);
    process.exit(1);
  }
}

export function checkDependencies(): void {
  for (const cmd of ['wp']) {
    try {
      execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    } catch {
      console.error(`Error: ${cmd} is required.`);
      process.exit(1);
    }
  }
}
