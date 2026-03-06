# Changelog

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-03-06

### Fixed

- Always regenerate `.pot` from plugin source before translating, ensuring new strings are picked up on subsequent runs
- Handle trailing slashes in plugin paths (e.g., `./my-plugin/`) that caused empty filenames
- Parse `export` prefix in `~/.config/deepl.env` (e.g., `export DEEPL_AUTH_KEY=...`)

## [1.0.0] - 2026-03-06

### Added

- Initial release, rewritten from prototype bash script into TypeScript
- DeepL API integration with batch translation (50 strings per request)
- Contextual translation support — strings with `msgctxt` are translated individually so DeepL can use the context metadata
- Auto-detection of locales from existing `.po` files
- Language header injection for `.po` files missing the `Language:` field
- Single-file build output via esbuild with `#!/usr/bin/env node` shebang
- WP-CLI integration for `.pot` generation, `.po` syncing, and `.mo` compilation
