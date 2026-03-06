# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A CLI tool that translates WordPress plugin `.po` files using the DeepL API. It replaces a monolithic bash prototype (`prototype/wp-translate.sh`) with a structured TypeScript project that bundles into a single executable script.

## Build & Check Commands

- `npm run build` — Bundle to `dist/wp-translate.mjs` (single executable with node shebang)
- `npm run typecheck` — Type-check without emitting
- Deploy: copy `dist/wp-translate.mjs` to `/usr/local/bin/wp-translate`

## Architecture

The CLI flow is sequential: load config → validate → find/create POT → for each locale: sync PO, parse, translate via DeepL, write PO → compile all .mo files.

**Module dependency graph:**

```
index.ts (entry point, orchestration)
├── config.ts        — loads DEEPL_AUTH_KEY from ~/.config/deepl.env
├── validation.ts    — locale format regex, checks `wp` is in PATH
├── pot.ts           — finds .pot in languages/, generates via wp-cli if missing
├── po-parser.ts     — stateful line-by-line PO parser, preserves raw lines
├── deepl.ts         — HTTPS calls to api-free.deepl.com/v2/translate
└── wp-cli.ts        — execSync wrappers for `wp i18n make-pot/update-po/make-mo`
```

`po-parser.ts` is the most complex module — it tracks parser state (`CTX`/`ID`/`STR`) across multiline PO entries while preserving the original raw lines for lossless round-tripping.

`deepl.ts` uses two strategies: batch (50 strings/request) for standard entries, and individual requests for entries with `msgctxt` (so DeepL can use the context).

## Runtime Dependencies

- **Node.js 20+** (build target)
- **wp-cli** (`wp` command) — used for POT generation, PO syncing, MO compilation
- **DeepL API key** in `~/.config/deepl.env` as `DEEPL_AUTH_KEY=...`

## Build System

`build.ts` uses esbuild to bundle all TypeScript into a single ESM file with `#!/usr/bin/env node` shebang and executable permissions. No runtime npm dependencies — everything is bundled.

## Conventions

- ESM throughout (`"type": "module"` in package.json, `.mjs` output)
- No runtime dependencies — only devDependencies (esbuild, typescript, @types/node)
- WordPress locale format: underscore-separated (e.g., `en_GB`), not hyphens
- PO file naming: `{domain}-{locale}.po` where domain comes from the `.pot` filename
