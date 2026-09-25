import { PluralForms } from './plurals.js';

// Translating plurals with a real number in place of the count placeholder.
//
// Given "%d files", DeepL has to guess which plural form to use; given "5 files"
// it knows. So each slot is translated from its own sample number (Polish: 1, 2,
// 5) and the number is swapped back for the placeholder afterwards. Test results
// are in CHANGELOG.md, 1.12.0.

// Numbers tried, in order, when choosing each slot's sample. Small familiar
// numbers first, then 0, then a sweep wide enough for every rule in plurals.ts.
const SAMPLE_CANDIDATES = [1, 2, 5, 3, 4, 11, 21, 22, 25, 0, ...Array.from({ length: 195 }, (_, offset) => offset + 6)];

// printf-style placeholders, as PHP's sprintf() reads them. `%%` is stripped first.
const PLACEHOLDER = /%(?:\d+\$)?[-+ 0#']*\d*(?:\.\d+)?[bcdeEfFgGosuxX]/g;

export interface SamplePlan {
  placeholder: string;
  // One per plural slot: the sample number, the text sent to DeepL, and whether
  // the placeholder was replaced in it (a singular may have no placeholder).
  samples: number[];
  texts: string[];
  substituted: boolean[];
}

function compilePluralExpression(expression: string): (count: number) => number {
  // The expression comes from the static table in plurals.ts, never from a file.
  const evaluate = new Function('n', `return Number(${expression});`) as (count: number) => number;
  return evaluate;
}

// Choose one sample number per plural slot, or null if some slot has none.
export function sampleNumbers(forms: PluralForms): number[] | null {
  const pluralIndex = compilePluralExpression(forms.expression);
  const samples: (number | undefined)[] = new Array(forms.nplurals).fill(undefined);
  for (const candidate of SAMPLE_CANDIDATES) {
    const slot = pluralIndex(candidate);
    if (slot >= 0 && slot < forms.nplurals && samples[slot] === undefined) samples[slot] = candidate;
  }
  const complete = samples.every(sample => sample !== undefined);
  return complete ? (samples as number[]) : null;
}

function listPlaceholders(text: string): string[] {
  return text.replace(/%%/g, '').match(PLACEHOLDER) ?? [];
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

// Find the placeholder that carries the count, or null if it cannot be told apart.
//
// The only integer placeholder in the plural wins; failing that, a lone
// placeholder of any type (number_format_i18n() output arrives as %s).
export function findCountPlaceholder(singular: string, plural: string): string | null {
  const pluralPlaceholders = listPlaceholders(plural);
  const integers = [...new Set(pluralPlaceholders.filter(item => item.endsWith('d')))];

  let candidate: string | null = null;
  if (integers.length === 1) {
    candidate = integers[0];
  } else if (integers.length === 0 && pluralPlaceholders.length === 1) {
    candidate = pluralPlaceholders[0];
  }

  const usable = candidate !== null
    && countOccurrences(plural, candidate) === 1
    && countOccurrences(singular, candidate) <= 1;
  return usable ? candidate : null;
}

function numberPattern(sample: number): RegExp {
  return new RegExp(`(?<!\\d)${sample}(?!\\d)`, 'g');
}

// Build one DeepL text per slot, or null when the entry is not suitable.
export function planSampleTexts(
  singular: string,
  plural: string,
  samples: number[] | null,
  slotCount: number,
): SamplePlan | null {
  if (samples === null || samples.length !== slotCount) return null;
  const placeholder = findCountPlaceholder(singular, plural);
  if (placeholder === null) return null;

  const plan: SamplePlan = { placeholder, samples, texts: [], substituted: [] };
  let usable = true;
  for (const sample of samples) {
    const source = sample === 1 ? singular : plural;
    const hasPlaceholder = source.includes(placeholder);
    // A number already in the text could not be told apart from the sample on the way back.
    const clashes = (source.match(numberPattern(sample)) ?? []).length > 0;
    if (clashes || (!hasPlaceholder && sample !== 1)) {
      usable = false;
      break;
    }
    plan.texts.push(hasPlaceholder ? source.replace(placeholder, String(sample)) : source);
    plan.substituted.push(hasPlaceholder);
  }
  return usable ? plan : null;
}

// Swap the sample number back for the placeholder; null unless it appears exactly once.
export function restorePlaceholder(translation: string, placeholder: string, sample: number): string | null {
  const matches = translation.match(numberPattern(sample)) ?? [];
  return matches.length === 1 ? translation.replace(numberPattern(sample), placeholder) : null;
}

// Resolve each slot's text: the sample translation when it restores cleanly, else the fallback.
export function resolveSampleTranslations(
  plan: SamplePlan,
  sampleTranslations: string[],
  fallbacks: (string | null)[],
): (string | null)[] {
  return plan.samples.map((sample, slot) => {
    const translation = sampleTranslations[slot];
    const restored = translation === undefined
      ? null
      : plan.substituted[slot] ? restorePlaceholder(translation, plan.placeholder, sample) : translation;
    return restored ?? fallbacks[slot] ?? null;
  });
}
