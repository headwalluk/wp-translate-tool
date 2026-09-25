import { PoEntry, unsanitize } from './po-parser.js';

export interface OneWordLabel {
  source: string;
  context: string;
  locale: string;
  translation: string;
}

const ONE_WORD = /^[\p{L}\p{M}'-]+$/u;
const MSGSTR_LINE = /^msgstr "(.*)"$/;

// Collect newly translated one-word entries that carried context (msgctxt or translators: comment).
export function findOneWordLabels(entries: PoEntry[], locale: string): OneWordLabel[] {
  const labels: OneWordLabel[] = [];
  for (const entry of entries) {
    const context = entry.msgctxt ?? entry.extractedComments;
    const translated = entry.newTranslation?.match(MSGSTR_LINE);
    if (entry.msgid === null || context === null || !translated) continue;

    const source = unsanitize(entry.msgid);
    if (!ONE_WORD.test(source)) continue;

    labels.push({ source, context: unsanitize(context), locale, translation: unsanitize(translated[1]) });
  }
  return labels;
}

// Print one-word labels grouped by source and context, one line per locale.
//
// DeepL gives little weight to context on a single word, so these are the
// entries most likely to come back in the wrong part of speech.
export function reportOneWordLabels(labels: OneWordLabel[]): void {
  if (labels.length === 0) return;

  const groups = new Map<string, OneWordLabel[]>();
  for (const label of labels) {
    const key = `${label.source}\u0004${label.context}`;
    const group = groups.get(key) ?? [];
    group.push(label);
    groups.set(key, group);
  }

  console.log(`\n>> One-word labels with context — worth a spot check.`);
  console.log(`   DeepL may return the wrong part of speech (a verb for a heading, a noun for a button).`);
  for (const group of groups.values()) {
    console.log(`   ${group[0].source}  [${group[0].context}]`);
    for (const label of group) {
      console.log(`      ${label.locale.padEnd(6)} ${label.translation}`);
    }
  }
}
