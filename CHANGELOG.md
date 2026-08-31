# Changelog

All notable changes to this project will be documented in this file.

## [1.9.0] - 2026-08-31

### Added

- **Plural (`_n()`) string support.** Entries carrying `msgid_plural` were previously parsed but never selected, never counted, never sent to DeepL and never written back — the run reported success and left `msgstr[0] ""` untouched indefinitely. They are now translated end to end
- A `Plural-Forms` header matching the target locale is written to each `.po` before syncing, so wp-cli generates the correct number of `msgstr[n]` slots. Without it, consumers fall back to the two-form Germanic rule, which is wrong for French (0 is singular), Polish and Russian (three forms), Japanese (one) and Arabic (six). Rules for 89 languages (plus locale-specific overrides such as `pt_BR`) live in `src/plurals.ts`, cross-checked against ~400 real-world `.po` files
- Locales with more forms than DeepL can supply have their remaining slots **left empty for a translator**, and the count is reported in the run summary. A wrong plural that looks finished is worse than an obvious gap
- Unknown locales warn before falling back to the Germanic default, and a `.po` whose existing `Plural-Forms` header disagrees with the expected rule is reported but never overwritten
- English locales fill both plural forms from the source strings with no API call, spelling-converted for `en_GB` and family

### Fixed

- **Parser state-machine bug affecting multi-line plural entries.** Neither `msgid_plural` nor `msgstr[n]` changed the parser's state, so on an entry whose forms spanned several lines the plural form — and any existing translation — were appended to the end of `msgid`. This was previously harmless only because such entries were never selected for translation; it would have corrupted the text sent to DeepL as soon as they were

### Changed

- A locale's `.po` is now passed through `wp i18n update-po` when it is first created, where previously a fresh locale was only copied from the `.pot`. This is what allows plural slots to be generated correctly on the first run rather than the second
- The per-locale summary now counts plural strings separately (`Found N standard, M contextual and P plural strings`), replacing the `plural entries skipped (not yet supported)` notice added in 1.8.1

## [1.8.1] - 2026-08-31

### Fixed

- Written `.po` files now end with a trailing newline. Previously the final line was written without one, which gettext's own tools always emit and which showed up as `\ No newline at end of file` in the diff of every plugin repo consuming these files. The next run of each plugin will produce a one-line whitespace-only diff per `.po` as a result

### Added

- `_n()` plural entries are now reported in the per-locale summary
  (`N plural entries skipped (not yet supported)`). Plural support is not
  implemented yet — an entry carrying `msgid_plural` is still parsed but never
  translated — so this makes a previously silent gap visible rather than fixing
  it. Full write-up and planned fix: `dev-notes/plural-strings-untranslated.md`
- A test harness (`npm test`): a bash runner over `.po` fixtures checking that
  the parser's output matches recorded golden files and that parse → write
  round-trips byte for byte. No new dependencies

## [1.8.0] - 2026-06-19

### Added

- Rate-limit handling for DeepL calls. A small pause is now inserted between consecutive translate requests, and rate-limited (`429`) or transient server errors (`5xx`) plus connection errors are retried automatically with exponential backoff, honouring the server's `Retry-After` header. Two environment variables tune the behaviour: `WP_TRANSLATE_API_DELAY_MS` (inter-request pause, default `500`, `0` to disable) and `WP_TRANSLATE_MAX_RETRIES` (retry attempts, default `5`, `0` to disable). Non-retryable responses (e.g. `403`) still fail fast

## [1.7.0] - 2026-06-19

### Added

- The synced agent-instructions block now advises against adding month and day-of-week names (full or abbreviated) as translatable strings — DeepL frequently mistranslates short forms like `Mon`, `Tue`, `Jan` even with context hints — and points to WordPress's locale-aware `$wp_locale` helpers (`get_month`, `get_month_abbrev`, `get_weekday`, `get_weekday_abbrev`) plus `wp_date()` / `date_i18n()`. The block version is bumped to `1.1.0`, so `--check-instructions` reports already-synced plugins as stale until re-synced

## [1.6.1] - 2026-06-18

### Added

- `grayscale` → `greyscale` (and `grayscales`) to the American→British conversion map for English targets

## [1.6.0] - 2026-06-18

### Added

- `/* translators: */` comments are now used as DeepL context. The parser reads gettext `#. translators:` extracted comments and, for strings without an `_x()` `msgctxt`, sends the note as DeepL's `context` parameter to disambiguate. This fixes context-free mistranslations of polysemous words (e.g. with a `translators:` note, `Folder` → `Ordner` instead of `Broschüre`, `Sent` → `Gesendet` instead of `Spät` in German). `msgctxt` still takes precedence when both are present

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
