# wp-translate-tool — Project Tracker

**Version:** 1.6.0 (unreleased — M1–M4 verified, pending final release)
**Last Updated:** 18 June 2026
**Current Phase:** All milestones (1–4) complete & verified; ready for final release
**Overall Progress:** 100% of planned milestones (pending commit/tag/release)

---

## Overview

A CLI tool that translates WordPress plugin `.po` files using the DeepL API:
load config → regenerate `.pot` from source → for each locale sync/create the
`.po`, translate untranslated strings via DeepL, write back → compile all `.mo`
files. TypeScript, bundled to a single executable `.mjs` via esbuild, no runtime
npm dependencies. `wp-cli` is a runtime requirement.

This roadmap addresses a class of **short-string mistranslations** discovered
while polishing the `heads-up-mailer` plugin (see
`docs/short-string-mistranslations.md`). Short, context-free UI strings (`Sent`,
`Folder`, `TLS`, `ID`) are systematically mistranslated by DeepL — the same
errors in every locale, including en-GB. The strategy is **two-pronged**:

1. **Fix at the source** — make the plugin's own code carry the disambiguation
   (`_x()` context), driven by per-plugin AI-agent instructions this tool can
   inject and keep in sync (Milestone 3). This is the durable fix for the
   polysemy class and survives `.pot` regeneration.
2. **Deterministic tool-side guards** — for the error classes no source-side
   change can address: `en_*` locales (Milestone 1) and technical acronyms
   (Milestone 2). These are the backstop; they don't depend on any agent acting.

**Design decisions already locked** (from planning discussion):
- Instruction-sync is a **separate subcommand** (`--sync-instructions` /
  `--check-instructions`), never an interruption of the translate path, which
  stays pure and scriptable.
- Instruction-sync **only updates existing** recognised agent files — it never
  creates one in a repo that didn't already invite agent instructions.

---

## Active TODO Items

- [x] **Acronym denylist contents + matching semantics** (Milestone 2) —
  RESOLVED: whole-`msgid` exact, case-sensitive; curated list in `src/acronyms.ts`
  (extend as needed).
- [x] **Sign off the canonical instruction-block wording** (Milestone 3) —
  RESOLVED 18 June 2026: approved with text-domain templating; canonical body now
  lives in `src/instructions.ts`.
- [ ] **Decide the `_x()` retrofit pass for `heads-up-mailer`** — the in-place
  `.po`/`.mo` hand-fixes will be overwritten on next regen until the source
  carries `_x()` context (tracked separately in the plugin repo, but the trigger
  lives here).

---

## Milestones

### Milestone 1: English Local Handling (`en_*`) ✅

**Status:** Complete — pending commit/tag/push
**Priority:** High
**Target:** v1.3.0
**Started:** 17 June 2026
**Completed:** 18 June 2026

**Goal:** Stop the en→en garbage (`TLS → "The latest security standards"`) and
fix American spellings for British-family targets — all locally, with no DeepL
calls for English.

**KEY FINDING (18 June 2026): DeepL cannot localise en→en-GB.** Live testing
proved that DeepL with `target_lang=EN-GB` returns English source text unchanged
(`Color scheme` → `Color scheme`), even with `source_lang=EN` forced. It only
applies British spelling when translating *from another language* (`Farbschema`
de → `Colour scheme`). This invalidated the original "route American-looking
strings to DeepL" plan — that path was a no-op that burned quota. The deterministic
local-substitution alternative (previously deferred) became the only option that
actually works, and was adopted.

**Approach (final):** English targets never call DeepL.
- **`en` / `en_US`** → every untranslated string passes through as identity.
- **`en_GB` / `en_AU` / `en_NZ` / …** → `toBritish(msgid)` converts American
  spellings locally; unchanged strings fall back to identity passthrough.

**`toBritish()` design (`src/english.ts`):**
- **`-ize`/`-yze` suffix swap** (algorithmic) covers the open set
  (`organize`→`organise`, `authorize`→`authorise`, `organization`→`organisation`).
  Guarded by `IZE_EXCEPTIONS` (`size`/`prize`/`maize` families) so it can't
  produce `sise`.
- **`AMERICAN_TO_BRITISH` map** for everything the suffix rule can't derive
  (`color`→`colour`, `center`→`centre`, `defense`→`defence`, `catalog`→`catalogue`,
  `canceled`→`cancelled`, `gray`→`grey`, …).
- **Whole-word matching** via `/[A-Za-z]+/g` replacement — the substring trap
  (`meter` in `parameter`) cannot fire, and spacing/punctuation/placeholders
  (`%s`, `%d`) are preserved untouched.
- **Case preserved** (`matchCase`): `COLOR`→`COLOUR`, `Color`→`Colour`,
  `color`→`colour`. Lower-casing is for lookup only.
- Ambiguous words deliberately omitted (bare `meter` = gas meter; `tire` = to weary).

**Note on acronyms:** M1 only covers English, where acronyms pass through
naturally (`toBritish('TLS')` = `TLS`). The acronym-mangling problem is a
**non-English** issue — live test showed `TOTP` → `Une vraie plaie` (fr). That
is exactly what Milestone 2 addresses.

#### Implementation Checklist

- [x] `englishTarget(locale)` classifier → `none` | `us-passthrough` | `gb-convert`
- [x] `toBritish(msgid)` — `-ize`/`-yze` suffix swap + `AMERICAN_TO_BRITISH` map,
      whole-word, case-preserving; `IZE_EXCEPTIONS` guard
- [x] `setIdentityTranslation()` helper in `po-parser.ts` (reused by M2 later)
- [x] `processLocale()`: English locales handled locally (no DeepL); non-English
      path unchanged
- [x] Placeholders/escaped strings preserved (`%s`/`%d` untouched; `\"Host\"` round-trips)
- [x] Per-locale summary log (`N passed through, M localised … (no API call)`)
- [x] Update README + CHANGELOG, bump to v1.3.0, build
- [x] **Live test on `quick-2fa` en_GB** — verified (see below)
- [ ] Commit, tag `v1.3.0`, push main + tag — *user-triggered*

**Also fixed (bug found during live test):** `--dry-run` crashed for a locale
with no existing `.po` (it tried to `parsePo` a file the dry-run path never
creates). Now reads the `.pot` as the dry-run basis. Added to v1.3.0 CHANGELOG.

**Verification (18 June 2026):**
- Unit (`toBritish`): conversions (`Color scheme`→`Colour scheme`, `Analyze`→
  `Analyse`, `Center the dialog box`→`Centre the dialogue box`, `Canceled %d items`
  →`Cancelled %d items`, case variants) and traps that must NOT change (`Size`,
  `Resize`, `Prize`, `Maize`, `Parameter`, `Gas meter`, `TLS`, `TOTP`, placeholders)
  — all pass.
- Live (`quick-2fa` en_GB, fresh `.po`): 115 passed through, 3 localised
  (`Colour scheme`/`Organise your devices`/`Authorise this device`), **0 DeepL
  characters consumed** (usage flat). `.mo` compiled.
- Regression (`quick-2fa` fr_FR): DeepL path intact (`Color scheme`→`Palette de
  couleurs`). Confirmed `TOTP`→`Une vraie plaie` mangle → motivates M2.

---

### Milestone 2: Acronym & Short-String Identity Guard ✅

**Status:** Complete — pending commit/tag/push
**Priority:** High
**Target:** v1.4.0
**Started:** 18 June 2026
**Completed:** 18 June 2026

**Goal:** Keep known technical acronyms verbatim across all locales instead of
letting DeepL "helpfully" expand them (`TLS → "The latest security standards"`,
`ID → "Identification number"`).

**Rationale:**
- Acronyms are the worst case for the contextless batch path in `src/deepl.ts`.
- A tool-side identity list is more reliable and universal than hoping every
  acronym gets an `_x()` in every plugin; it covers all plugins at once.
- More robust than the doc's heuristic suggestion ("all-caps ≤5 chars"), which
  would misfire on legitimate short words — an explicit denylist has no guesswork.

**Approach (final):** A built-in denylist of identity-passthrough tokens
(`src/acronyms.ts`). In the **non-English** path, partition entries whose whole
`msgid` exactly matches a listed acronym and emit them verbatim; everything else
goes to DeepL as before. English locales don't reach this path — M1 already keeps
acronyms verbatim there.

**Decisions made (resolved the Active TODO):**
- **Matching: whole-`msgid`, exact, CASE-SENSITIVE.** Case-sensitivity prevents
  passing a real lower-case word through (the word `rest` vs acronym `REST`, `id`
  vs `ID`). Compound strings (`Enable TLS`) still go to DeepL, where context
  protects the acronym — confirmed live (`Enable TLS` → `Activer TLS`).
- **Denylist** (curated, easily extended): auth/2FA (`TLS SSL TOTP HOTP OTP 2FA
  MFA SSO JWT PIN`), web/API (`API SDK URL URI HTML CSS JS JSON XML CSV TSV HTTP
  HTTPS FTP SFTP SSH DNS IP CDN REST AJAX RSS UUID GUID`), media (`SVG PNG JPG
  JPEG GIF PDF QR RGB RGBA HEX`), mail (`SMTP IMAP POP3 MIME DKIM SPF DMARC`),
  wp/data (`SQL DB PHP WP CMS SEO SKU CPT ID UTC GMT`), units (`KB MB GB TB Hz
  DPI PPI`).

#### Implementation Checklist

- [x] `src/acronyms.ts` with the denylist + `isProtectedAcronym()` (exact, case-sensitive)
- [x] Partition acronyms out of `standard`/`contextual` in the non-English branch
- [x] Emit acronyms verbatim via `setIdentityTranslation()`
- [x] Log summary (`(N acronym(s) kept verbatim)`)
- [x] Composes with M1 (English handled earlier and returns before this branch)
- [x] Live test: acronyms unchanged in fr_FR; compound + ordinary strings still translated
- [x] CHANGELOG + README + bump to v1.4.0 + build
- [ ] Commit, tag `v1.4.0`, push main + tag — *user-triggered*

**Verification (18 June 2026):**
- Unit (`isProtectedAcronym`): `TLS TOTP API ID 2FA SMTP URL UTC QR JSON` → true;
  `tls Id id rest "Color scheme" "Enable TLS" "TLS settings" ""` → false.
- Live (`quick-2fa` fr_FR, fresh): `TOTP`/`ID`/`TLS` kept verbatim (TOTP was
  `Une vraie plaie` pre-M2); `Enable TLS` → `Activer TLS`; `Color scheme` →
  `Palette de couleurs`. Log: `(3 acronym(s) kept verbatim)`.
- Regression (en_GB on same copy): M1 intact — `TOTP`/`TLS` pass through,
  `Color scheme` → `Colour scheme`, no API call.

---

### Milestone 3: Agent-Instruction Sync Subcommand ✅

**Status:** Complete — pending commit/tag/push
**Priority:** Medium
**Target:** v1.5.0
**Started:** 18 June 2026
**Completed:** 18 June 2026

**Goal:** When invoked against a plugin directory, detect a recognised AI-agent
instructions file and offer to inject / update a versioned block that teaches the
plugin's coding agent (a) how to write translatable strings with proper `_x()`
context, and (b) how to invoke `wp-translate`. This moves the polysemy fix to
where strings are *authored* and makes the guidance self-propagating across all
plugins.

**Rationale:**
- The `_x()` context must be written by whoever writes the string; planting
  guidance in the file the authoring agent already reads is the most direct way
  to make that happen, and it survives `.pot` regeneration.
- The tool already routes any entry with a `msgctxt` (what `_x()` produces) down
  `translateContextual`, which passes DeepL's `context` parameter — so `_x()`
  fixes flow through end-to-end **today**, with no further tool change.
- A *versioned* managed block (not a one-time snippet) is the real value-add:
  the tool can detect missing / stale / current and re-sync N plugins as the
  guidance evolves.

**Caveat (be clear-eyed):** this is a *nudge*, not a fix — it writes
instructions; it does not run the agent. The `_x()` calls only appear when a
human later runs their coding agent. Milestones 1 & 2 remain the deterministic
backstop.

**Locked decisions:**
- Separate subcommand; translate path untouched and stays scriptable.
- Update **existing** files only; never create a new agent file.

**File precedence (existing only):** `AGENTS.md` → `CLAUDE.md` →
`.github/copilot-instructions.md` → `GEMINI.md`. Update the highest-precedence
existing file only; note any others left untouched. If none exist: no-op, print a
clear message.

**Block format (surgical, never touches anything outside the markers):**
```
<!-- wp-translate:begin v=1.0.0 hash=<sha256-of-body> -->
## wp-translate: translation authoring conventions
…
<!-- wp-translate:end -->
```

**Exit codes (mirror the `--check-update` convention, exit 2):**
- `--check-instructions`: `0` = block present and current; `2` = missing or stale
- `--sync-instructions`: applies the change (TTY confirm; `--yes`/non-TTY applies silently)

**Decisions (signed off 18 June 2026):**
- **Text-domain templating** — the canonical body uses `__TEXTDOMAIN__`, replaced
  with the plugin's real domain on injection (avoids the literal leaking into
  `.po`/`.mo`; the stored hash covers the rendered body so drift detection still works).
- **Clean heading** — version lives only in the marker (`v=1.0.0`); not duplicated
  in the human heading.
- **No M4 forward-reference** — block describes current behaviour only.
- **Exit-code semantics**: `--check` exits `2` when a sync would change the file
  (`stale` / `missing-block` / `drift`), else `0`. A missing *agent file* is not
  actionable (we don't create files) → exit `0`. `newer` block → `0`, left alone.
- **Domain detection without wp-cli**: existing `.pot` → main-file `Text Domain`
  header → directory slug (so `--check-instructions` needs neither wp-cli nor a key).

#### Implementation Checklist

- [x] Canonical body + `BLOCK_VERSION = '1.0.0'` in `src/instructions.ts`
      (signed-off wording; draft was `dev-notes/m3-instruction-block-draft.md`)
- [x] `findAgentFiles()` precedence (AGENTS → CLAUDE → copilot → GEMINI), returns
      target + others
- [x] Marker parser + `sha256` + `semverCompare` + `blockStatus()`
      (`current`|`stale`|`newer`|`missing-block`|`drift`)
- [x] `applyBlock()` — surgical inject/replace; nothing outside markers touched
- [x] `detectDomain()` (no wp-cli)
- [x] CLI: `--check-instructions` / `--sync-instructions` / `--yes` / `-y`, TTY
      confirm, exit codes; handled before config/wp-cli so they need neither
- [x] `printHelp()` + README + CHANGELOG + bump to v1.5.0 + build
- [ ] Commit, tag `v1.5.0`, push main + tag — *user-triggered*

**Verification (18 June 2026, all pass):**
- No agent file → message, exit 0 (check & sync).
- Existing file, no block → check exit 2; sync injects (exit 0); re-check exit 0.
- Domain substitution: real domain present, zero literal `__TEXTDOMAIN__`; PRE/POST
  sentinels around the block preserved byte-for-byte through inject and replace.
- Stale (`v=0.9.0`) → check exit 2; sync updates to 1.0.0.
- Drift (hand-edited body) → check exit 2; sync warns then overwrites.
- Newer (`v=2.0.0`) → check exit 0; sync leaves as-is.
- Precedence: AGENTS.md updated, CLAUDE.md noted & untouched.
- Real plugin copy (`quick-2fa`): domain `quick-2fa` via `.pot`, CLAUDE.md target,
  `.github/copilot-instructions.md` noted; idempotent re-check.

---

### Milestone 4: Translator-Comment (`#.`) as DeepL Context ✅

**Status:** Complete — pending commit/tag/push
**Priority:** Low
**Target:** v1.6.0
**Started:** 18 June 2026
**Completed:** 18 June 2026

**Goal:** Teach the parser to read gettext extracted comments (`#.`, produced by
`/* translators: … */` in source) and feed them to DeepL's `context` parameter
for entries that lack a `msgctxt`. This makes plain translator comments — which
authors write anyway for human translators — also improve machine output, and is
a higher-quality context source than the doc's option C (file-path references).

**Rationale:**
- Currently the parser only captures `msgctxt`; `#.` and `#:` lines survive only
  as opaque `raw` lines (`src/po-parser.ts`). So translator comments help humans
  but never reach DeepL.
- Bridges the two source-side mechanisms: `_x()` (msgctxt, Milestone 3) and
  `/* translators: */` (extracted comments, this milestone).

**Design note:** only `#. translators:` comments are captured as context.
Auto-generated header `#.` comments ("Plugin Name of the plugin", etc.) are
ignored, so plugin-header strings aren't needlessly pushed onto the slower
per-entry contextual path.

#### Implementation Checklist

- [x] `extractedComments` field on `PoEntry`; parse `#. translators:` in `po-parser.ts`
      (strips the `translators:` label; other `#.` comments ignored)
- [x] `getUntranslated()` routes entries with extracted comments through contextual
- [x] `translateContextual()` uses `msgctxt ?? extractedComments` (msgctxt precedence)
- [x] Lossless round-trip verified (`#.`/`#:` lines preserved in output `.po`)
- [x] CHANGELOG + README + bump to v1.6.0 + build
- [ ] Commit, tag `v1.6.0`, push main + tag — *user-triggered*

**Verification (18 June 2026):**
- DeepL probe confirmed context flips output (de): `Folder` → `Broschüre`→`Ordner`,
  `Sent` → `Spät`→`Gesendet`.
- End-to-end (`quick-2fa` de_DE): `/* translators: */`-annotated `Folder`→`Ordner`,
  `Sent`→`Gesendet`; un-annotated `Account`→`Konto`. Contextual count reflects
  only real translator comments (14, not the 19 that included header `#.` lines).
- Round-trip lossless; `.mo` compiled.

---

## Technical Debt

1. **`heads-up-mailer` in-place fixes are fragile** — the hand-corrected
   `.po`/`.mo` files will be overwritten on the next regen until the plugin
   source carries `_x()` context (Milestones 1–3 are the durable fix).
2. **No automated tests** — the project is verified manually. As CLI surface
   grows (Milestone 3 adds parsing/marker/semver logic), consider a lightweight
   test harness for `instructions.ts` and `po-parser.ts` at minimum.

---

## Deferred / Rejected Approaches

From `docs/short-string-mistranslations.md`, considered and **not** taken
(recorded so they aren't re-litigated):

- **Post-hoc glossary file (doc option A)** — superseded by the source-side
  `_x()` approach (Milestone 3). Revisit only if `_x()` adoption proves
  impractical across plugins.
- **DeepL glossary API (doc option B)** — same coverage as a local glossary but
  adds per-language-pair upload state to manage. Not worth the API surface now.
- **File-path references as DeepL context (doc option C)** — weak signal
  (`class-admin.php` tells DeepL nothing). Milestone 4 uses `#.` translator
  comments instead, which are purpose-written context.

---

## Notes for Development

- **DeepL cannot localise en→en** (verified 18 June 2026): `target_lang=EN-GB`
  returns English source unchanged, even with `source_lang=EN`. British spelling
  is only applied when translating from another language. Hence English locales
  are handled locally in `src/english.ts`, never via DeepL.
- ESM throughout; `.mjs` output; no runtime npm dependencies (everything bundled).
- WordPress locale format is underscore-separated (`en_GB`, not `en-GB`).
  `mapLocale()` in `src/deepl.ts` converts to DeepL's hyphenated codes.
- Translate flow stays **pure and scriptable** — instruction-sync is a separate
  verb, and `--check-*` flags use exit code `2` for "action needed" (matches the
  existing `--check-update` convention).
- `_x()` → `msgctxt` → already routed through `translateContextual` (the DeepL
  `context` path). That end-to-end route is the linchpin of the source-side fix.
- Release workflow: bump `package.json` + CHANGELOG, README only on user-visible
  change, `npm run build`, commit, tag `vX.Y.Z`, push main + tag (Actions
  publishes the release with `wp-translate.mjs` attached).
