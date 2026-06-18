# wp-translate-tool

[![License: GPL v2+](https://img.shields.io/badge/License-GPLv2%2B-blue.svg)](https://www.gnu.org/licenses/gpl-2.0)
[![Node.js: 20+](https://img.shields.io/badge/Node.js-20%2B-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![WordPress i18n](https://img.shields.io/badge/WordPress-i18n-21759B.svg?logo=wordpress&logoColor=white)](https://developer.wordpress.org/plugins/internationalization/)

Automatically translate WordPress plugin `.po` files using the [DeepL API](https://www.deepl.com/pro-api). Handles batch translation, contextual strings (`msgctxt`), and compiles `.mo` files — all in a single command.

## Usage

```bash
wp-translate ./my-plugin/ en_GB,fr_FR,de_DE,es_ES
```

If you omit the locales argument, the tool will auto-detect them from existing `.po` files in the plugin's `languages/` directory, or fall back to a default set.

### What it does

1. Regenerates the `.pot` template from the plugin source (ensuring new strings are always picked up)
2. For each locale, syncs or creates a `.po` file from the template
3. Identifies untranslated strings and sends them to DeepL (batched for efficiency; contextual strings are translated individually so DeepL can use the `msgctxt` metadata)
4. Writes translations back to the `.po` files
5. Compiles all `.po` files into binary `.mo` files

### English locales

English targets are never sent to DeepL — machine-translating en→en is a no-op that only risks corrupting short strings (e.g. `TLS` becoming "The latest security standards"). They are handled locally instead, with no API calls:

- **`en` / `en_US`** — strings pass through unchanged (the source is already the desired dialect).
- **`en_GB`, `en_AU`, `en_NZ`, …** — American spellings are converted to British-style English (`color` → `colour`, `organize` → `organise`); everything else passes through unchanged.

### Technical acronyms

For non-English locales, strings whose entire value is a common technical acronym (`TLS`, `API`, `TOTP`, `SMTP`, `URL`, `ID`, `UTC`, …) are kept verbatim rather than sent to DeepL, which tends to mangle context-free acronyms. Compound strings (e.g. `Enable TLS`) are still translated normally.

### Agent instructions

wp-translate can maintain a short, versioned block of translation conventions in a plugin's AI-agent instructions file — guidance for coding agents on writing `_x()` context, using placeholders, and running the tool. This helps machine translation at the source.

```bash
wp-translate ./my-plugin --check-instructions   # report status (exit 2 if a sync would help)
wp-translate ./my-plugin --sync-instructions    # inject/update the block (--yes to skip the prompt)
```

- **Existing files only** — it updates an existing `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, or `GEMINI.md` (in that precedence order), and never creates one.
- The block is delimited by `wp-translate:begin/end` markers; nothing outside them is touched. It carries a version, so `--check-instructions` can tell you when an update is available, and a hand-edited block is detected and reported before being overwritten.

---

## For Users

### Requirements

- **Node.js 20+**
- **[WP-CLI](https://wp-cli.org/)** — must be installed and available as `wp` in your PATH
- **DeepL API key** — [get a free key here](https://www.deepl.com/pro-api)

### DeepL configuration

Create `~/.config/deepl.env` with your API key:

```bash
export DEEPL_AUTH_KEY='your-api-key-here'
```

### Installation

Download the latest built script and place it in your PATH:

```bash
# System-wide
sudo curl -fsSL -o /usr/local/bin/wp-translate \
  https://github.com/headwalluk/wp-translate-tool/releases/latest/download/wp-translate.mjs
sudo chmod +x /usr/local/bin/wp-translate

# User-local
curl -fsSL -o ~/.local/bin/wp-translate \
  https://github.com/headwalluk/wp-translate-tool/releases/latest/download/wp-translate.mjs
chmod +x ~/.local/bin/wp-translate
```

Or build from source (see below).

### Examples

```bash
# Translate a plugin to specific locales
wp-translate ./my-plugin/ en_GB,fr_FR,de_DE

# Auto-detect locales from existing .po files
wp-translate ./my-plugin/

# Using an absolute path
wp-translate /var/www/html/wp-content/plugins/my-plugin/

# Preview what would be translated (no API calls, no file changes)
wp-translate --dry-run ./my-plugin/

# Check DeepL API character quota
wp-translate --usage

# Check installed version
wp-translate --version

# Check for updates (exit code 0 = up to date, 2 = update available)
wp-translate --check-update

# Full help
wp-translate --help
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success / up to date |
| `1` | Error |
| `2` | Action available (`--check-update`: a release; `--check-instructions`: a sync would change the file) |

This makes `--check-update` scriptable:

```bash
if ! wp-translate --check-update >/dev/null 2>&1; then
  echo "A new version of wp-translate is available"
fi
```

---

## For Contributors

### Setup

```bash
git clone git@github.com:headwalluk/wp-translate-tool.git
cd wp-translate-tool
npm install
```

### Development commands

| Command | Description |
|---|---|
| `npm run build` | Bundle to `dist/wp-translate.mjs` |
| `npm run clean` | Remove `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm start -- <args>` | Run the built script |

### Build from source

```bash
npm install
npm run build
cp dist/wp-translate.mjs ~/.local/bin/wp-translate
```

The build step uses esbuild to bundle all TypeScript source into a single file with a `#!/usr/bin/env node` shebang. The output has no runtime dependencies beyond Node.js itself.

### Project structure

```
src/
  index.ts        CLI entry point and orchestration
  update.ts       Version check against GitHub releases
  config.ts       DeepL API key loading from ~/.config/deepl.env
  validation.ts   Locale format validation and dependency checks
  pot.ts          POT file discovery, generation, and locale detection
  po-parser.ts    PO file parsing and round-trip writing
  deepl.ts        DeepL API client (batch + contextual translation)
  wp-cli.ts       Shell wrappers for wp-cli i18n commands
```
