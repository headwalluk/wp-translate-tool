# wp-translate-tool — Project Tracker

**Version:** 1.9.0 (built, pending tag/push)
**Last Updated:** 31 August 2026
**Current Phase:** All milestones (1–5) complete
**Overall Progress:** 5 of 5 milestones complete

**Post-release patches:**
- v1.6.1 — added `grayscale` → `greyscale` to the en-GB conversion map (gap found
  while dogfooding `easy-logo-carousel`). Confirmed: manual poedit fixes are never
  overwritten on re-run (only empty `msgstr` entries are filled; `update-po`
  preserves existing translations).
- v1.7.0 — agent-instruction block now advises against adding month/day-of-week
  names as translatable strings (DeepL mis-translates short forms like `Mon`,
  `Jan` even with hints) and points to WordPress's `$wp_locale` helpers
  (`get_month`, `get_month_abbrev`, `get_weekday`, `get_weekday_abbrev`) plus
  `wp_date()` / `date_i18n()`. `BLOCK_VERSION` bumped 1.0.0 → 1.1.0, so
  already-synced plugins report stale until re-synced.
- v1.8.0 — DeepL rate-limit handling. Inter-request pause plus automatic retry
  with exponential backoff on 429/5xx/connection errors, honouring `Retry-After`.
  Tunable via `WP_TRANSLATE_API_DELAY_MS` (default 500, 0 disables) and
  `WP_TRANSLATE_MAX_RETRIES` (default 5, 0 disables). Non-retryable statuses
  (e.g. 403) still fail fast.

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
- [x] Commit, tag `v1.6.0`, push main + tag — released 18 June 2026

**Verification (18 June 2026):**
- DeepL probe confirmed context flips output (de): `Folder` → `Broschüre`→`Ordner`,
  `Sent` → `Spät`→`Gesendet`.
- End-to-end (`quick-2fa` de_DE): `/* translators: */`-annotated `Folder`→`Ordner`,
  `Sent`→`Gesendet`; un-annotated `Account`→`Konto`. Contextual count reflects
  only real translator comments (14, not the 19 that included header `#.` lines).
- Round-trip lossless; `.mo` compiled.

---

### Milestone 5: `_n()` Plural Support ✅

**Status:** Complete — pending commit/tag/push
**Priority:** High
**Target:** v1.9.0 (visibility counter shipped first in v1.8.1)
**Started:** 31 August 2026
**Completed:** 31 August 2026

**Goal:** Make `_n()` plural entries translatable end-to-end. Today an entry with
`msgid_plural` is parsed but never selected, never counted, never sent to DeepL
and never written back — the run reports success and leaves `msgstr[0] ""`
forever. Measured on the estate where it was found: **72 of 72 plural entries
untranslated, a 100% miss rate**, four of five affected strings public-facing.

Full evidence, with verified line references and a reproduced fixture:
`dev-notes/plural-strings-untranslated.md`.

**Rationale:**
- This is the largest remaining *silent* correctness gap. Unlike the M1/M2
  mistranslation classes, nothing in the output looks wrong — the strings simply
  stay English, and the summary count never mentions them.
- Same root-cause family as backlog item 2 (fuzzy): selection keys on
  `msgstr === ''`, and a plural's `msgstr` parses as `null`, so it is filtered out
  before the standard/contextual split.
- No source-side workaround exists. Dropping `_n()` for a single `%d` string
  trades a correct English sentence for a grammatically wrong one in every
  locale, and Polish's three forms cannot be expressed without `_n()` at all.

**KEY FINDING — there are two independent gaps, and fixing one without the other
gets Polish wrong.**

1. **Parser blindness.** `line.startsWith('msgstr ')` (`src/po-parser.ts:79`)
   requires a trailing space, so `msgstr[0] ""` never matches; `msgstr` stays
   `null`, `msgstrIndex` stays `-1`, and `getUntranslated()`
   (`src/po-parser.ts:160`) filters the entry out.
2. **No plural metadata in the generated files.** No `Plural-Forms` header in any
   `.po` or in the `.pot` (WP-CLI 2.12.0 `make-pot` does not emit one), and only
   two `msgstr[n]` slots in every locale. Polish needs three. Consumers fall back
   to Germanic `nplurals=2` when the header is absent, so a Polish translation
   filled into two slots is *grammatically wrong for most numbers* rather than
   merely missing. **Gap 2 is the more important half.**

**Two traps found while investigating — both must be handled in the same change:**

- **Latent `msgid` corruption.** Neither `msgid_plural` nor `msgstr[` matches any
  parser branch, and neither changes `state` — which stays `'ID'` for the whole
  entry. On a multi-line plural, the plural form *and* any existing translation
  are welded onto the end of `msgid`. Harmless today only because the entry is
  never selected and `writePo()` reassembles from `raw` (round-trip confirmed
  byte-identical). The moment plurals become selectable, that corrupted `msgid` is
  what goes to DeepL. Needs a state transition on **both** keywords, not just
  `msgid_plural`.
- **Header-injection ordering.** Injecting `Plural-Forms` in
  `injectLanguageHeader()` (`src/po-parser.ts:98`) does **not** produce a third
  slot on the run that matters. A fresh locale is a `copyFileSync()` of the `.pot`
  (`src/index.ts:282`) so msgmerge never runs; an existing locale runs
  `updatePo()` at `src/index.ts:279` *before* injection, so msgmerge sees no
  header and emits two slots — a third would appear only on the second run.

  **The `.pot` is NOT the place to inject it.** `findOrCreatePot()` runs once
  (`src/index.ts:263`) and the same `.pot` is reused for every locale in the loop,
  so a locale-specific `Plural-Forms` written there would leak Polish's rule into
  every other locale's fresh `.po`. `Plural-Forms` is per-locale; the `.pot` is
  locale-agnostic by definition.

  **Correct sequence — per locale, into the `.po`, before `update-po`:**
  1. ensure the `.po` exists (`copyFileSync()` from the `.pot` if missing)
  2. inject `Language:` **and** `Plural-Forms:` into its header
  3. `updatePo()` — msgmerge reads the header and emits the right slot count
  4. parse → translate → write

  This unifies the fresh and existing paths and moves header injection out of
  `processLocale()` to before `updatePo()`. Side effect to note: fresh locales
  would now get `update-po` run over them too, where today they are only a copy.

  The alternative (splicing slots by hand) breaks the apply model:
  `applyTranslations()` replaces one raw line at a fixed index, so inserting a
  line shifts every later index in the entry.

  **Verified against WP-CLI 2.12.0 (31 August 2026)** — `wp i18n update-po`
  honours the header, and expanding an existing file is non-destructive:

  | Case | Setup | Result |
  |---|---|---|
  | A | fresh copy of `.pot` + `nplurals=3` injected | **3 slots** ✓ |
  | B | existing 2-slot `.po` *with translations* + `nplurals=3` injected | **3 slots, existing translations preserved** ✓ |
  | C | control — same file, no header injected | 2 slots (confirms the default) |

#### Open decisions (to settle before implementation)

- [x] **`nplurals > 2` third slot — RESOLVED 31 August 2026: leave it empty.**
      DeepL cannot supply a distinct Polish "few" form. Untranslated beats
      wrongly-translated: an empty slot is obvious in poedit and trivially
      greppable, whereas a plausible-but-wrong form marked `#, fuzzy` hides in
      plain sight — and the tool keys off empty `msgstr` only, so it would never
      be revisited. **Keeps backlog item 2 (fuzzy) out of this milestone's
      scope.** The run summary must say how many slots were left for a human.
- [x] **Locale table scope — RESOLVED 31 August 2026: ship the fuller table,
      and warn on a miss.** The eight-row version is unsafe even inside the set in
      use today: `fr_FR` is `nplurals=2; plural=(n > 1)` — French puts 0 in the
      singular — so the Germanic default gets "0 résultats" wrong. Outside the
      set it degrades further (`ja` is `nplurals=1`, `ru`/`cs`/`uk` are 3, `ar`
      is 6), each producing exactly the looks-finished-but-wrong output this
      milestone exists to kill. Plural rules are linguistic constants copied from
      the gettext manual — ~50 lines, one-off, no ongoing maintenance. An
      unlisted locale must **warn**, never silently fall back (same principle as
      the empty-slot decision above: visible beats plausible).
- [x] **Ship visibility first — RESOLVED 31 August 2026: yes, as v1.8.1**,
      ahead of the real fix. See Phase 0 below.
- [x] **How plural pairs reach DeepL — RESOLVED 31 August 2026: the per-entry
      contextual path, with plurals counted separately.** Two reasons, neither of
      them batching itself (DeepL's `text` is already an array, so "one request,
      both forms" is available on either path):
      1. `translateBatch()` maps `translations[index] → batch[index]`
         (`src/deepl.ts:148`), assuming one entry per array slot. A plural
         contributes two, so the batch path would need an array-position →
         (entry, slot) map — destabilising the hot path every ordinary string
         uses, for the sake of a handful of plurals.
      2. DeepL's `context` is **one string per request**, which is why
         `translateContextual()` is per-entry at all. A plural carrying `msgctxt`
         or a `#. translators:` comment cannot ride a mixed batch regardless.

      The contextual path handles both cleanly: `text: [singular, plural]`,
      `context` when present, and mapping stays local — `translations[0]` →
      `msgstr[0]`, `[1]` → `msgstr[1]`. Cost is one request + `REQUEST_DELAY_MS`
      (500ms) per plural entry; at ~5 plural strings per plugin that is ~2.5s per
      locale. If a plugin ever carries hundreds, context-free plurals can be
      promoted into the batch later as a pure optimisation.

      **Correction to the write-up's stated rationale:** it justifies pairing as
      making the two forms "come back consistent with each other". That does not
      hold — DeepL translates array elements independently and guarantees no
      cross-item consistency. The real benefits are fewer requests and simpler
      slot mapping. Do not implement against a promise the API does not make.

#### Implementation Checklist

**Phase 0 — visibility only (ships standalone as v1.8.1)**
- [x] Set an `isPlural` flag in `parsePo()` when a line starts with `msgid_plural `
- [x] Report the count in the per-locale summary:
      `"N plural entries skipped (not yet supported)"`
- [x] **Must not touch the state machine, `getUntranslated()` or
      `applyTranslations()`** — detection only, zero behaviour change, so it
      cannot regress anything and needs no plural fixture to prove safe
- [x] CHANGELOG + bump to v1.8.1 + build (released as v1.8.1); commit, tag, push — *user-triggered*

**Phase 1 — metadata (gap 2, the important half)**
- [x] `src/plurals.ts`: locale → `{ nplurals, expression }` table covering the
      common WordPress locales, copied from the gettext manual
- [x] Lookup falls back to Germanic `nplurals=2; plural=(n != 1)` but **warns**
      on an unlisted locale — never silent
- [x] Restructure the per-locale sequence in `src/index.ts`: ensure `.po` exists
      → inject `Language:` + `Plural-Forms:` → `updatePo()` → parse. Header
      injection moves out of `processLocale()` to before the merge
- [x] Confirm the fresh path is unharmed by now running `update-po` over a
      straight `.pot` copy (case A says yes; re-check on a real plugin)
- [x] Regression: a locale whose `.po` already has translations keeps every one
      of them through the slot expansion (case B)

**Phase 2 — parser (gap 1 + the latent trap)**
- [x] `PoEntry`: add `msgidPlural: string | null` and `msgstrIndexes: number[]`
- [x] Match `msgstr[` alongside `msgstr `, recording each slot's raw-line index
- [x] Set `state` on **both** `msgid_plural` and `msgstr[` — closes the
      `msgid`-welding bug
- [x] `getUntranslated()`: treat "every slot empty" as untranslated for plurals
- [x] Round-trip must stay lossless for plural entries (regression: the current
      byte-identical behaviour is the baseline)

**Phase 3 — translation + write-back**
- [x] Route plurals down a dedicated `translatePlurals()`: `text: [singular, plural]`,
      `context` when the entry carries `msgctxt` or a `#. translators:` comment
- [x] Map `translations[0]` → `msgstr[0]`, `translations[1]` → `msgstr[1]`
- [x] `applyTranslations()`: write every slot by index. Slots are pre-generated
      by msgmerge (Phase 1), so this stays line-replacement — no inserts, no
      index shifting
- [x] `nplurals > 2`: fill slots 0 and 1, **leave the rest empty** for a human
- [x] Run summary gains its own plural count, and reports how many slots were
      left empty for manual completion — `standard`/`contextual` counts stay
      meaningful rather than absorbing plurals silently

**Phase 4 — English locales**
- [x] Plural-aware `setIdentityTranslation()` — `msgstr[0]` from `msgid`,
      `msgstr[1]` from `msgid_plural`
- [x] Plural-aware `toBritish` branch (`src/index.ts:96`) — same split, both forms
      spelling-converted
- [x] `en_GB` plurals correct with **zero** DeepL calls (cheapest win: two
      Germanic slots need no `Plural-Forms` table to be right)

**Phase 5 — release**
- [x] CHANGELOG + README (user-visible behaviour change) + bump to v1.9.0 + build
- [ ] Commit, tag `v1.9.0`, push main + tag — *user-triggered*

**Verification (31 August 2026, all pass):**

Test harness (`npm test`, 8 checks over 4 fixtures) — round-trip stayed lossless
through the whole parser rewrite, which is the property that made the state-machine
change safe to attempt. The multi-line plural fixture now parses `msgid` and
`msgidPlural` as separate strings where before they were welded together, and a
partially-translated plural is correctly excluded from selection.

End-to-end against a synthetic plugin (3 plural strings, real `wp i18n make-pot`):

| Case | Result |
|---|---|
| `en_GB` fresh | 3 plurals filled from source, both forms spelling-converted (`%d colorized items` → `%d colorised items`), **zero API calls** |
| `pl_PL` fresh | msgmerge generated **3 slots** from the injected header; slots 0 and 1 filled by DeepL, slot 2 left empty and reported |
| `pl_PL` re-run | "Nothing new to translate" — partially-filled entries not re-translated, existing slots preserved |
| Conflicting header (`nplurals=2` on `pl_PL`) | Warned loudly, left unchanged |
| Unknown locale (`mi_NZ`) | Warned before falling back to the Germanic default |

**Note for whoever revisits this:** for locales with three or more forms, slot 1 is
the "few" form, and what DeepL returns is a generic nominative plural. Mapping it to
slot 1 is the most reasonable available fit, not a verified-correct one. Slot 0
(the singular) is unambiguous. If plural quality in `pl_PL`/`ru_RU` ever comes into
question, that mapping is the thing to look at first.

---

## Future Ideas / Backlog (from dogfooding, post-v1.6.1)

Candidates for a future milestone — none committed, captured so they aren't
rediscovered:

1. **Don't translate plugin-header strings.** The Plugin Name / Description /
   Author / URI header strings are currently machine-translated (`Easy Logo
   Carousel` → `Einfaches Logo-Karussell`, `Quick 2FA` → `Schnelle 2FA`). The
   *Name*, URIs, and author usually shouldn't be translated. These are precisely
   identifiable — they carry auto-generated `#. Plugin Name of the plugin` /
   `#. ... URI of the plugin` extracted comments, which the M4 parser already
   recognises and ignores. A guard could keep them verbatim. Strong candidate
   for the milestone after next.
2. **Fuzzy handling.** The tool keys off empty `msgstr` only, so a `fuzzy`-flagged
   entry (source text changed → `update-po` marks it fuzzy but keeps the old
   translation) is never refreshed. Consider treating fuzzy as translatable
   (carefully) or at least reporting fuzzy counts in the run summary.
   **Coupled to Milestone 5:** if plurals fill `nplurals > 2` slots as `fuzzy`,
   this has to land at the same time, or those entries are never revisited.
3. **Curated lists are living data.** `AMERICAN_TO_BRITISH` (`src/english.ts`) and
   the acronym denylist (`src/acronyms.ts`) are hand-curated; expect to extend
   them as dogfooding surfaces gaps (`grayscale` → `greyscale` was the first,
   shipped in v1.6.1). Low effort, ongoing.

## Technical Debt

1. **`heads-up-mailer` in-place fixes are fragile** — the hand-corrected
   `.po`/`.mo` files will be overwritten on the next regen until the plugin
   source carries `_x()` context (Milestones 1–3 are the durable fix).
2. **Test coverage is partial** — a harness now exists (`npm test`, added
   31 August 2026): a bash runner over `.po` fixtures checking parser output
   against golden files and byte-for-byte round-tripping. It paid for itself
   immediately, catching the missing trailing newline in `writePo()` and making
   the Milestone 5 parser rewrite safe to attempt.

   **Still uncovered:** `instructions.ts` (marker parsing, semver, `blockStatus`)
   and the `index.ts` orchestration — notably the header-injection-then-merge
   sequence added in Milestone 5, which is where a future sequencing bug would
   hide. The synthetic plugin used to verify v1.9.0 end-to-end is not committed;
   promoting it to a fixture would close the orchestration gap, but needs wp-cli
   and a DeepL key available, so it would have to skip gracefully when they are
   not.

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
