# Changelog

All notable changes to this project will be documented in this file.

## [1.5.0] - 2026-06-18

### Added

- `--check-instructions` and `--sync-instructions` subcommands. wp-translate can maintain a versioned, marker-delimited block of translation conventions (how to write `_x()` context, use placeholders, run the tool) in a plugin's AI-agent instructions file:
  - Updates an existing `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, or `GEMINI.md` (in that precedence order); never creates a file
  - The plugin's real text domain is substituted into the block's examples
  - `--check-instructions` exits `2` when a sync would change the file (missing, stale, or hand-edited block), `0` when up to date
  - `--sync-instructions` prompts before writing on a TTY; `--yes` / non-interactive applies without prompting. A hand-edited block is reported before being overwritten. Content outside the markers is never touched

## [1.4.0] - 2026-06-18

### Added

- Acronym guard for non-English locales. Common technical acronyms (`TLS`, `API`, `TOTP`, `SMTP`, `URL`, `ID`, `UTC`, etc.) whose entire `msgid` is exactly the acronym are now kept verbatim instead of being sent to DeepL, which would otherwise mangle them (e.g. `TOTP` → "Une vraie plaie"). Matching is exact and case-sensitive; compound strings like `Enable TLS` still go to DeepL, where surrounding words provide context

## [1.3.0] - 2026-06-18

### Added

- English target locales are now handled locally, with no DeepL calls (machine-translating en→en is a no-op that only corrupted short strings like `TLS` into "The latest security standards"):
  - `en` / `en_US` pass through unchanged
  - `en_GB`, `en_AU`, `en_NZ`, etc. have American spellings converted to British-style English (the `-ize`/`-yze` morphology, plus a curated word list such as `color` → `colour`, `center` → `centre`); everything else passes through unchanged

### Fixed

- `--dry-run` no longer crashes for a locale that has no existing `.po` file (it now reads the `.pot` as the basis for what would be translated)

## [1.2.2] - 2026-05-22

### Fixed

- Unescape PO format sequences (`\"`, `\\`, `\n`, `\t`, `\r`) before sending strings to DeepL, so embedded quotes no longer round-trip as `\"Host\"` in the rendered output

## [1.2.1] - 2026-03-06

### Changed

- `--check-update` now exits with code 2 when an update is available, making it scriptable

## [1.2.0] - 2026-03-06

### Added

- `--help` / `-h` flag with full usage documentation
- `--dry-run` flag to preview what would be translated without calling the API or modifying files
- `--usage` flag to check DeepL API character quota
- Progress indicators during batch and contextual translation
- End-of-run summary showing total locales and strings translated

## [1.1.0] - 2026-03-06

### Added

- `--check-update` flag to check for newer releases on GitHub
- `--version` / `-v` flag to display the installed version
- Version is embedded at build time from `package.json`

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
