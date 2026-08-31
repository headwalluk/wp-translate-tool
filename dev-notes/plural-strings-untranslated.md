# `_n()` plurals are never translated

**Filed:** 2026-08-31
**Found while:** regenerating the language bundles for a plugin, after adding a
single `_n()` string to an admin warning.
**Status:** ✅ RESOLVED in v1.9.0 (31 August 2026). Both gaps and the latent
parser bug are fixed; see Milestone 5 in `00-project-tracker.md` for what shipped
and how it was verified. This document is kept as the diagnosis that drove it —
the line references below describe the v1.8.0 code, before the fix.

One caveat carried forward: for locales with three or more forms, slot 1 is the
"few" form and DeepL returns a generic nominative plural. The mapping is the best
available fit, not a verified-correct one. Slots beyond the second are left empty
for a translator by design.
**Verified against source:** 31 August 2026 (v1.8.0). Line references below were
re-checked, and the parser behaviour reproduced against a local fixture.

## Summary

**The tool does not see plural entries at all.** A `.po` entry with `msgid_plural`
is parsed, but never selected for translation, never counted in the run summary,
never sent to DeepL, and never written back. It is silent: the run reports success
and the entry stays `msgstr[0] ""` / `msgstr[1] ""` forever.

It is systematic, not sporadic. Across the two plugins in the estate where this
was found that use plurals, **72 of 72 plural entries are untranslated — a 100%
miss rate**:

| Plugin | `.po` files | Plural entries | Empty `msgstr[0]` |
|---|---:|---:|---:|
| Plugin A | 8 | 40 | **40** |
| Plugin B | 8 | 32 | **32** |

In Plugin A that is five distinct strings across eight locales, and **four of the
five are public-facing**, not admin screens. The shapes matter more than the
wording, because they cover the awkward cases:

| Shape | Example form |
|---|---|
| Bare noun plural | `Review` / `Reviews` |
| Plural with a trailing `%s` | `Review on %s` / `Reviews on %s` |
| Plural with positional args | `%1$s result for “%2$s”` / `%1$s results for “%2$s”` |
| Count-led plural | `%s review` / `%s reviews` |
| Admin-only `%d` plural | `%d profile was left unsaved…` |

All five fall back to English in `de_DE`, `el_GR`, `es_ES`, `fr_FR`, `it_IT`,
`nl_NL` and `pl_PL` — and in `en_GB`, where the fallback happens to be right.

There are **two independent gaps** here. Fixing the first without the second gets
Polish wrong.

---

## Gap 1 — the parser never registers a plural's `msgstr`

Three facts in `src/po-parser.ts`, in sequence:

1. **The `msgstr` matcher requires a trailing space** — `line.startsWith('msgstr ')`
   at `src/po-parser.ts:79`. A plural entry's lines are `msgstr[0] ""`, which
   starts `msgstr[`. No match.
2. **So `msgstr` stays `null` and `msgstrIndex` stays `-1`** — the initial values
   from `createEntry()` (`src/po-parser.ts:14`).
3. **`getUntranslated()` selects on `e.msgstr === ''`** (`src/po-parser.ts:160`).
   `null === ''` is false, so plural entries are filtered out before the standard
   / contextual split. They never reach `translateBatch()` or
   `translateContextual()`, and `applyTranslations()` skips them anyway because it
   guards on `msgstrIndex > -1` (`src/po-parser.ts:112`).

This is why the run summary reads "Found 1 standard and 1 contextual strings" on a
regen that added a plural — the plural simply is not in the count, so there is no
number that looks wrong.

### Verified, not inferred

`src/po-parser.ts` bundled standalone with esbuild and run against a fixture
containing one single-line plural, one multi-line plural, and one ordinary string:

```
---
  msgid       : "%d profile"        <- single-line plural
  msgstr      : null
  msgstrIndex : -1
---
  msgid       : "SINGULAR-FIRST-HALF singular-second-halfPLURAL-FIRST-HALF plural-second-half…"
  msgstr      : null
  msgstrIndex : -1
---
  msgid       : "Last run outcome"  <- ordinary string
  msgstr      : ""
  msgstrIndex : 2

selected for translation: 1 standard, 0 contextual
  -> [ 'Last run outcome' ]
```

### ⚠️ A latent parser bug the fixture exposed

Look at the second entry above. On a **multi-line** plural:

```po
msgid ""
"SINGULAR-FIRST-HALF "
"singular-second-half"
msgid_plural ""
"PLURAL-FIRST-HALF "
"plural-second-half"
msgstr[0] ""
"TRANSLATED-SLOT0-FIRST "
"translated-slot0-second"
```

`msgid_plural ""` matches none of the parser's branches, so it falls through to
`current.raw.push(line)` — **but it does not change `state`, which is still `'ID'`**.
The continuation lines that follow therefore hit the `line.startsWith('"') && state === 'ID'`
branch at `src/po-parser.ts:73-75` and are appended to `msgid`, welding the plural
form onto the end of the singular.

**`msgstr[0]` has exactly the same problem, and it compounds.** It matches no
branch either, so `state` is *still* `'ID'` for the rest of the entry — meaning on
a partially-translated multi-line plural, the existing translation's continuation
lines are welded on as well. Reproduced against the fixture above; the resulting
`msgid` is:

```
"SINGULAR-FIRST-HALF singular-second-halfPLURAL-FIRST-HALF plural-second-halfTRANSLATED-SLOT0-FIRST translated-slot0-second"
```

So the state machine needs a transition on **both** `msgid_plural` and `msgstr[`,
not just the first. Fixing only `msgid_plural` leaves the trap live.

**Harmless today, purely by luck.** The entry is never selected (gap 1), and
`writePo()` reassembles from `raw`, so the round-trip is byte-identical — confirmed
against the fixture. But it is a live trap for whoever implements plural support:
the moment plural entries become selectable, that corrupted `msgid` is what would
be sent to DeepL. Fix the state machine in the same change, not after.

---

## Gap 2 — the `.po` files carry no plural metadata

Even with gap 1 fixed, Polish would still be wrong.

- **No `Plural-Forms` header in any generated `.po`.** Checked across `de_DE`,
  `fr_FR` and `pl_PL`: zero occurrences. It is absent from the `.pot` too —
  WP-CLI 2.12.0's `make-pot` does not emit one, and `update-po` propagates the
  header it finds.
- **Only two `msgstr[n]` slots are generated, in every locale.** `pl_PL` has zero
  `msgstr[2]` lines. Polish needs **three** forms (one / few / many).

For contrast, a community-translated `pl_PL` in the same WordPress install —
Advanced Custom Fields — carries 29 `msgstr[2]` entries. That is what a correct
Polish `.po` looks like.

Consumers fall back to the Germanic `nplurals=2; plural=(n != 1)` when no
`Plural-Forms` header is present, so a Polish string filled into two slots would
be grammatically wrong for most numbers rather than merely untranslated. **Gap 2
is the more important half of the fix** — it decides how many slots to fill and
which rule selects them.

### ⚠️ Where the header gets injected matters

The obvious hook is `injectLanguageHeader()` (`src/po-parser.ts:98`), which
inserts `"Language: xx_XX\n"` into the header entry. **Injecting `Plural-Forms`
there does not produce a third `msgstr[2]` slot on the run that matters**, because
of ordering in `src/index.ts`:

- **Fresh locale** — the `.po` is a `copyFileSync()` of the `.pot`
  (`src/index.ts:282`). msgmerge never runs, so the slot count is whatever
  `make-pot` emitted: two.
- **Existing locale** — `updatePo()` runs at `src/index.ts:279`, *before*
  `processLocale()` calls `injectLanguageHeader()`. msgmerge decides how many
  `msgstr[n]` slots to emit from the `Plural-Forms` header in the file it is
  merging into — which does not have one yet. A third slot would only appear on
  the *second* run.

**The `.pot` is not the place to put it.** `findOrCreatePot()` runs once
(`src/index.ts:263`) and the same `.pot` is reused for every locale in the loop, so
a locale-specific `Plural-Forms` written there would leak one language's rule into
every other locale's fresh `.po`. `Plural-Forms` is per-locale; a `.pot` is
locale-agnostic by definition.

**Correct fix: inject per locale, into the `.po`, before `update-po` runs.**
Restructure the per-locale sequence to: ensure the `.po` exists (copy from the
`.pot` if missing) → inject `Language:` and `Plural-Forms:` → `updatePo()` →
parse. msgmerge then reads the header and emits the right number of slots itself.
This unifies the fresh and existing paths; the only side effect is that fresh
locales now get `update-po` run over them where today they are only a copy.

Verified against WP-CLI 2.12.0 (31 August 2026):

| Case | Setup | Result |
|---|---|---|
| A | fresh copy of `.pot` + `nplurals=3` injected | **3 slots** |
| B | existing 2-slot `.po` *with translations* + `nplurals=3` injected | **3 slots, existing translations preserved** |
| C | control — same file, no header injected | 2 slots |

The alternative — splicing slots into each entry by hand — breaks the current
apply model. `applyTranslations()` replaces a single raw line at a fixed
`msgstrIndex` (`src/po-parser.ts:112-114`); *inserting* a line shifts every later
index within that entry. That route needs back-to-front application, or a rebuild
of `raw`.

Either way, the per-locale rule itself is a static table — the eight locales in
regular use need eight rows, and the expression is a documented constant per
language, not something to derive.

---

## Suggested shape of a fix

Roughly ascending effort; 1 and 2 are the minimum viable pair.

1. **Per-locale `Plural-Forms` table + header injection.** A `plurals.ts` mapping
   locale → `{ nplurals, expression }`, injected into the `.pot` after
   `makePot()` (see the ordering note above — *not* only in
   `injectLanguageHeader()`). Also tells the rest of the code how many slots an
   entry needs.
2. **Teach the parser plurals.** Add `msgidPlural: string | null` and
   `msgstrIndexes: number[]` to `PoEntry`; match `msgstr[` as well as `msgstr `;
   set `state` on **both** `msgid_plural` and `msgstr[` so their continuation
   lines stop landing in `msgid` (the latent bug above); make `getUntranslated()`
   treat "every slot empty" as untranslated.
3. **Send both forms to DeepL and fill every slot.** Translate `msgid` and
   `msgid_plural` as a pair, down the per-entry contextual path:
   `text: [singular, plural]`, with `context` set when the entry carries a
   `msgctxt` or a `#. translators:` comment. Note that pairing does **not** buy
   consistency between the two forms — DeepL translates array elements
   independently and guarantees nothing across them. The real benefits are fewer
   requests and a slot mapping that stays local (`translations[0]` → `msgstr[0]`).
   Do not implement against a promise the API does not make.

   For `nplurals > 2`, DeepL cannot supply the third form. **Fill slots 0 and 1
   and leave the rest empty for a human** — untranslated beats wrongly-translated.
   An empty slot is obvious in poedit and trivially greppable; a plausible-but-
   wrong form flagged `#, fuzzy` hides in plain sight, and since the tool keys off
   empty `msgstr` only, it would never be revisited. This also keeps backlog item
   2 (fuzzy handling) out of scope.
4. **Make the miss visible in the meantime.** Even before any of the above, one
   line in the summary — `"N plural entries skipped (not yet supported)"` — turns
   a silent gap into a known one. This is cheap and worth doing first if the rest
   waits.
5. **English locales need this too.** `en_GB`'s identity/British-spelling path in
   `src/english.ts` goes through the same `getUntranslated()` selection, so
   plurals are skipped there as well — where the correct output is trivially known
   (the source strings, spelling-converted). This is the cheapest win, since two
   Germanic slots need no `Plural-Forms` table to be correct. It is **not** step 2
   alone, though: `setIdentityTranslation()` writes a single-form `msgstr "…"`
   (`src/po-parser.ts:156`), and so does the `toBritish` branch
   (`src/index.ts:96`). Both need plural-aware variants that fill `msgstr[0]` from
   `msgid` and `msgstr[1]` from `msgid_plural`.

## Why nothing was patched plugin-side

The obvious workaround — drop `_n()` and use a single `%d`-carrying string that
gets translated — is a bad trade. It swaps a correct English sentence for a
grammatically wrong one in every language, and Polish's three forms cannot be
expressed at all without `_n()`. The source strings are right; the tool is what
needs to change.

Filed on the consuming side as an item in that plugin's own snagging list.

## To verify a fix

```bash
wp-translate /path/to/plugin
grep -A3 msgid_plural languages/<domain>-fr_FR.po   # msgstr[0] and [1] filled
grep -c 'msgstr\[2\]' languages/<domain>-pl_PL.po   # 5, not 0
grep Plural-Forms languages/<domain>-pl_PL.po       # nplurals=3
```

The plugin this was found in is a good regression fixture: five plural strings,
eight locales, one of them `en_GB` (identity path) and one `pl_PL` (three forms) —
every branch of the problem in a single plugin.
