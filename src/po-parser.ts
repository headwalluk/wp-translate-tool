import { readFileSync, writeFileSync } from 'fs';
import { PluralForms, formatPluralForms } from './plurals.js';
import { matchPluginHeaderComment } from './plugin-headers.js';

export interface PoEntry {
  raw: string[];
  msgctxt: string | null;
  extractedComments: string | null;
  // Set when this entry is a field of the plugin/theme file header (e.g.
  // 'Plugin Name', 'Author'), naming the field. Never translated.
  pluginHeaderField: string | null;
  msgid: string | null;
  msgstr: string | null;
  msgstrIndex: number;
  // True for _n() entries (those carrying msgid_plural).
  isPlural: boolean;
  msgidPlural: string | null;
  // Plural entries carry one msgstr[n] slot per form. These are indexed by slot
  // number: msgstrIndexes[n] is the raw-line index of `msgstr[n]`, and
  // msgstrValues[n] is its parsed value. Both stay empty for ordinary entries,
  // which use msgstr / msgstrIndex instead.
  msgstrIndexes: number[];
  msgstrValues: string[];
  newTranslation: string | null;
  // One replacement line per plural slot, or null for a slot deliberately left
  // empty (see setPluralTranslations).
  newPluralTranslations: (string | null)[] | null;
}

function createEntry(): PoEntry {
  return {
    raw: [], msgctxt: null, extractedComments: null, pluginHeaderField: null, msgid: null,
    msgstr: null, msgstrIndex: -1,
    isPlural: false, msgidPlural: null, msgstrIndexes: [], msgstrValues: [],
    newTranslation: null, newPluralTranslations: null,
  };
}

export function parsePo(filePath: string): PoEntry[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const entries: PoEntry[] = [];
  let current = createEntry();
  let state: 'NONE' | 'CTX' | 'ID' | 'IDP' | 'STR' | 'STRN' = 'NONE';
  // Which msgstr[n] slot continuation lines belong to, while state is 'STRN'.
  let currentSlot = -1;

  function pushEntry() {
    if (current.raw.length > 0) {
      while (current.raw.length > 0 && current.raw[current.raw.length - 1].trim() === '') {
        current.raw.pop();
      }
      if (current.raw.length > 0) entries.push(current);
    }
    current = createEntry();
    currentSlot = -1;
  }

  for (const line of lines) {
    if (line.trim() === '' && state !== 'NONE') {
      pushEntry();
      state = 'NONE';
      continue;
    }

    // Translator comments (#. translators: ...) from `/* translators: */` in
    // source — used as DeepL context. The other `#.` comment that matters is
    // wp-cli's plugin/theme header marker ("Plugin Name of the plugin"), which
    // flags the entry as never-translate. Any remaining `#.` comment is ignored.
    if (line.startsWith('#.')) {
      const match = line.match(/^#\.\s*translators:\s*(.+)$/i);
      if (match) {
        const note = match[1].trim();
        current.extractedComments = current.extractedComments
          ? `${current.extractedComments} ${note}`
          : note;
      } else {
        const headerField = matchPluginHeaderComment(line);
        if (headerField) current.pluginHeaderField = headerField;
      }
    }

    // msgctxt
    if (line.startsWith('msgctxt ')) {
      const match = line.match(/^msgctxt "(.*)"/);
      if (match) {
        current.msgctxt = match[1];
        state = 'CTX';
      }
    } else if (line.startsWith('"') && state === 'CTX') {
      const match = line.match(/^"(.*)"/);
      if (match && current.msgctxt !== null) current.msgctxt += match[1];
    }

    // msgid
    if (line.startsWith('msgid ')) {
      const match = line.match(/^msgid "(.*)"/);
      if (match) {
        current.msgid = match[1];
        state = 'ID';
      }
    } else if (line.startsWith('"') && state === 'ID') {
      const match = line.match(/^"(.*)"/);
      if (match && current.msgid !== null) current.msgid += match[1];
    }

    // msgid_plural — its own state, so the continuation lines that follow are
    // appended here rather than welded onto the end of msgid.
    if (line.startsWith('msgid_plural ')) {
      const match = line.match(/^msgid_plural "(.*)"/);
      if (match) {
        current.isPlural = true;
        current.msgidPlural = match[1];
        state = 'IDP';
      }
    } else if (line.startsWith('"') && state === 'IDP') {
      const match = line.match(/^"(.*)"/);
      if (match && current.msgidPlural !== null) current.msgidPlural += match[1];
    }

    // msgstr
    if (line.startsWith('msgstr ')) {
      const match = line.match(/^msgstr "(.*)"/);
      if (match) {
        current.msgstr = match[1];
        current.msgstrIndex = current.raw.length;
        state = 'STR';
      }
    } else if (line.startsWith('"') && state === 'STR') {
      const match = line.match(/^"(.*)"/);
      if (match && current.msgstr !== null) current.msgstr += match[1];
    }

    // msgstr[n] — plural slots. Like msgid_plural, this needs its own state:
    // without one, everything after it lands in msgid.
    const slotMatch = line.match(/^msgstr\[(\d+)\] "(.*)"/);
    if (slotMatch) {
      currentSlot = Number(slotMatch[1]);
      current.msgstrIndexes[currentSlot] = current.raw.length;
      current.msgstrValues[currentSlot] = slotMatch[2];
      state = 'STRN';
    } else if (line.startsWith('"') && state === 'STRN' && currentSlot > -1) {
      const match = line.match(/^"(.*)"/);
      if (match) current.msgstrValues[currentSlot] += match[1];
    }

    current.raw.push(line);
  }
  pushEntry();

  return entries;
}

export interface HeaderInjection {
  addedLanguage: boolean;
  addedPluralForms: boolean;
  // Set when the file already carried a Plural-Forms header declaring a
  // different number of forms than the table expects. Never overwritten — a
  // translator may have set it deliberately, and clobbering it would discard
  // that judgement. Surfaced so the caller can warn instead.
  conflictingPluralForms: string | null;
}

// Insert the Language and Plural-Forms headers, if absent.
//
// This must run BEFORE `wp i18n update-po`: msgmerge decides how many msgstr[n]
// slots each plural entry gets from the Plural-Forms header it finds in the
// file it is merging into. Injecting afterwards means the slots are already
// wrong, and a re-run is needed before they come right.
export function injectHeaders(
  entries: PoEntry[],
  locale: string,
  pluralForms: PluralForms,
): HeaderInjection {
  const result: HeaderInjection = {
    addedLanguage: false,
    addedPluralForms: false,
    conflictingPluralForms: null,
  };

  if (entries.length === 0 || entries[0].msgid !== '') return result;
  const header = entries[0];
  if (header.msgstrIndex < 0) return result;

  const headerContent = header.raw.join('\n');

  if (!headerContent.includes('"Language:')) {
    header.raw.splice(header.msgstrIndex + 1, 0, `"Language: ${locale}\\n"`);
    result.addedLanguage = true;
  }

  const existing = headerContent.match(/"Plural-Forms:\s*([^"]*?)\\n"/);
  if (!existing) {
    header.raw.splice(header.msgstrIndex + 1, 0, `"Plural-Forms: ${formatPluralForms(pluralForms)}\\n"`);
    result.addedPluralForms = true;
  } else {
    const declared = existing[1].match(/nplurals\s*=\s*(\d+)/);
    const declaredCount = declared ? Number(declared[1]) : -1;
    if (declaredCount !== pluralForms.nplurals) {
      result.conflictingPluralForms = existing[1].trim();
    }
  }

  return result;
}

export function applyTranslations(entries: PoEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.newPluralTranslations) {
      // Slots are pre-generated by msgmerge, so every write is a line
      // replacement at a known index — no insertion, so no index shifting.
      let wroteSlot = false;
      for (let slot = 0; slot < entry.newPluralTranslations.length; slot++) {
        const replacement = entry.newPluralTranslations[slot];
        const rawIndex = entry.msgstrIndexes[slot];
        if (replacement === null || rawIndex === undefined || rawIndex < 0) continue;
        entry.raw[rawIndex] = replacement;
        wroteSlot = true;
      }
      if (wroteSlot) count++;
    } else if (entry.newTranslation && entry.msgstrIndex > -1) {
      entry.raw[entry.msgstrIndex] = entry.newTranslation;
      count++;
    }
  }
  return count;
}

export function writePo(filePath: string, entries: PoEntry[]): void {
  // Trailing newline: gettext's own tools emit one, and without it every written
  // .po shows up as "\ No newline at end of file" in the consuming repo's diff.
  const output = entries.map(e => e.raw.join('\n')).join('\n\n') + '\n';
  writeFileSync(filePath, output);
}

export function sanitize(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '')
    .replace(/\t/g, '\\t');
}

export function unsanitize(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else out += next;
      i++;
    } else {
      out += text[i];
    }
  }
  return out;
}

// Set an entry's translation to its own source string (identity passthrough).
// msgid is already in escaped PO form, so it can be reused verbatim as msgstr.
export function setIdentityTranslation(entry: PoEntry): void {
  if (entry.isPlural) {
    setPluralTranslations(entry, [entry.msgid, entry.msgidPlural]);
  } else if (entry.msgid !== null) {
    entry.newTranslation = `msgstr "${entry.msgid}"`;
  }
}

// Fill plural slots from already-escaped PO strings, one per form.
//
// Slots beyond the supplied forms are left untouched — for languages with more
// than two forms (Polish's one/few/many, Arabic's six) there is no third string
// to fill them with, and a plausible-but-wrong form that looks finished is
// worse than an obvious gap a translator can find and complete.
export function setPluralTranslations(entry: PoEntry, forms: (string | null)[]): void {
  const lines: (string | null)[] = [];
  for (let slot = 0; slot < entry.msgstrIndexes.length; slot++) {
    const form = forms[slot] ?? null;
    lines[slot] = form === null ? null : `msgstr[${slot}] "${form}"`;
  }
  entry.newPluralTranslations = lines;
}

// How many slots this entry has that setPluralTranslations would leave empty.
export function countUnfilledSlots(entry: PoEntry, filledForms: number): number {
  const slots = entry.msgstrIndexes.length;
  return slots > filledForms ? slots - filledForms : 0;
}

export interface UntranslatedBuckets {
  standard: PoEntry[];
  contextual: PoEntry[];
  plural: PoEntry[];
  // Plugin/theme header fields with an empty msgstr. These never reach DeepL —
  // they are filled from their own source string (see setIdentityTranslation)
  // so that they settle, rather than being re-offered on every run.
  pluginHeaders: PoEntry[];
}

// A plural entry counts as untranslated only when EVERY slot is empty. A
// partially filled entry is left alone: the missing slot is usually the third
// form we deliberately declined to guess, and re-translating would overwrite
// whatever a human put in the others.
function isUntranslatedPlural(entry: PoEntry): boolean {
  const slots = entry.msgstrIndexes.length;
  if (slots === 0) return false;
  let allEmpty = true;
  for (let slot = 0; slot < slots; slot++) {
    if (entry.msgstrValues[slot] !== '') {
      allEmpty = false;
      break;
    }
  }
  return allEmpty;
}

export function getUntranslated(entries: PoEntry[]): UntranslatedBuckets {
  const named = entries.filter(e => e.msgid && e.msgid !== '');
  // Header fields are split off before anything else, so no later bucket can
  // pick one up and send it for translation.
  const headerFields = named.filter(e => e.pluginHeaderField !== null);
  const body = named.filter(e => e.pluginHeaderField === null);
  const needs = body.filter(e => !e.isPlural && e.msgstr === '');
  // Contextual = anything that carries disambiguating context for DeepL: a
  // msgctxt (_x()) or an extracted translator comment (#.).
  return {
    standard: needs.filter(e => !e.msgctxt && !e.extractedComments),
    contextual: needs.filter(e => e.msgctxt || e.extractedComments),
    plural: body.filter(e => e.isPlural && isUntranslatedPlural(e)),
    pluginHeaders: headerFields.filter(e => e.msgstr === ''),
  };
}

export interface AlteredPluginHeader {
  field: string;
  source: string;
  translation: string;
}

// Header fields already carrying a translation that differs from the source —
// typically written by a run of this tool from before header fields were
// skipped, but possibly a deliberate human choice.
//
// These are reported and never rewritten. Nothing in the file distinguishes a
// machine translation that should not have been made from a localisation
// someone chose on purpose, and silently reverting the latter is the worse
// error of the two. Clearing the msgstr by hand puts the entry back in the
// pluginHeaders bucket, where the next run fills it from source.
export function findAlteredPluginHeaders(entries: PoEntry[]): AlteredPluginHeader[] {
  return entries
    .filter(e => e.pluginHeaderField !== null && e.msgid && e.msgstr && e.msgstr !== e.msgid)
    .map(e => ({
      field: e.pluginHeaderField!,
      source: unsanitize(e.msgid!),
      translation: unsanitize(e.msgstr!),
    }));
}
