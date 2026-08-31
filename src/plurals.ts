// Per-locale gettext plural rules.
//
// `Plural-Forms` decides two things: how many `msgstr[n]` slots an entry has,
// and which slot a given number selects. Neither is derivable — each is a
// documented linguistic constant, so this is a static table.
//
// It matters because WP-CLI's `make-pot` does not emit a `Plural-Forms` header
// at all. Without one, consumers fall back to the Germanic `nplurals=2;
// plural=(n != 1)`, which is wrong for French (which puts 0 in the singular),
// wrong for Polish and Russian (three forms), and wrong for Japanese (one).
// A translation filled into the wrong number of slots is grammatically broken
// rather than merely missing — worse than no translation at all.
//
// Rules below were cross-checked against ~400 real-world `.po`/`.pot` files.
// Where the corpus disagreed with itself (it contains, for instance, both the
// correct three-form Polish rule and a bogus two-form one) the linguistically
// correct form is used.

export interface PluralForms {
  nplurals: number;
  // The `plural=` expression, without the trailing semicolon.
  expression: string;
}

const GERMANIC: PluralForms = { nplurals: 2, expression: '(n != 1)' };
const ROMANCE: PluralForms = { nplurals: 2, expression: '(n > 1)' };
const NO_PLURAL: PluralForms = { nplurals: 1, expression: '0' };
const SLAVIC_THREE: PluralForms = {
  nplurals: 3,
  expression: '(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2)',
};

// Keyed by ISO language code — the region rarely changes the rule.
const BY_LANGUAGE: Record<string, PluralForms> = {
  // Two forms, singular for exactly 1 (the large majority).
  af: GERMANIC, an: GERMANIC, as: GERMANIC, az: GERMANIC, bg: GERMANIC,
  bn: GERMANIC, ca: GERMANIC, da: GERMANIC, de: GERMANIC, el: GERMANIC,
  en: GERMANIC, eo: GERMANIC, es: GERMANIC, et: GERMANIC, eu: GERMANIC,
  fi: GERMANIC, fo: GERMANIC, fy: GERMANIC, gl: GERMANIC, gu: GERMANIC,
  he: GERMANIC, hi: GERMANIC, hu: GERMANIC, hy: GERMANIC, it: GERMANIC,
  ku: GERMANIC, mn: GERMANIC, mr: GERMANIC, nb: GERMANIC, ne: GERMANIC,
  nl: GERMANIC, nn: GERMANIC, no: GERMANIC, or: GERMANIC, pa: GERMANIC,
  pap: GERMANIC, ps: GERMANIC, pt: GERMANIC, si: GERMANIC, so: GERMANIC,
  sq: GERMANIC, sv: GERMANIC, sw: GERMANIC, ta: GERMANIC, te: GERMANIC,
  tg: GERMANIC, tk: GERMANIC, ur: GERMANIC, uz: GERMANIC,

  // Two forms, singular for 0 and 1.
  fr: ROMANCE, br: ROMANCE, mg: ROMANCE, oc: ROMANCE, tl: ROMANCE,
  tr: ROMANCE, fa: ROMANCE,

  // One form — no singular/plural distinction.
  ja: NO_PLURAL, ka: NO_PLURAL, kk: NO_PLURAL, km: NO_PLURAL, kn: NO_PLURAL,
  ko: NO_PLURAL, ky: NO_PLURAL, lo: NO_PLURAL, ms: NO_PLURAL, my: NO_PLURAL,
  th: NO_PLURAL, ug: NO_PLURAL, vi: NO_PLURAL, zh: NO_PLURAL, id: NO_PLURAL,

  // Three or more forms.
  ru: SLAVIC_THREE, uk: SLAVIC_THREE, sr: SLAVIC_THREE, hr: SLAVIC_THREE,
  bs: SLAVIC_THREE,
  pl: {
    nplurals: 3,
    expression: '(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2)',
  },
  cs: { nplurals: 3, expression: '(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2' },
  sk: { nplurals: 3, expression: '(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2' },
  lt: {
    nplurals: 3,
    expression: '(n%10==1 && n%100!=11 ? 0 : n%10>=2 && (n%100<10 || n%100>=20) ? 1 : 2)',
  },
  lv: { nplurals: 3, expression: '(n%10==1 && n%100!=11 ? 0 : n != 0 ? 1 : 2)' },
  ro: { nplurals: 3, expression: '(n==1 ? 0 : (((n%100>19) || ((n%100==0) && (n!=0))) ? 2 : 1))' },
  mk: { nplurals: 2, expression: '(n % 10 == 1 && n % 100 != 11) ? 0 : 1' },
  is: { nplurals: 2, expression: '(n % 10 != 1 || n % 100 == 11)' },
  sl: {
    nplurals: 4,
    expression: '(n%100==1 ? 0 : n%100==2 ? 1 : n%100==3 || n%100==4 ? 2 : 3)',
  },
  be: {
    nplurals: 4,
    expression: '(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : n%10==0 || (n%10>=5 && n%10<=9) || (n%100>=11 && n%100<=14) ? 2 : 3)',
  },
  cy: { nplurals: 4, expression: '(n==1) ? 0 : (n==2) ? 1 : (n != 8 && n != 11) ? 2 : 3' },
  ga: { nplurals: 5, expression: '(n==1 ? 0 : n==2 ? 1 : n<7 ? 2 : n<11 ? 3 : 4)' },
  gd: {
    nplurals: 4,
    expression: '(n==1 || n==11) ? 0 : (n==2 || n==12) ? 1 : (n > 2 && n < 20) ? 2 : 3',
  },
  ar: {
    nplurals: 6,
    expression: '(n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 && n%100<=99 ? 4 : 5)',
  },
};

// Locales whose rule differs from their language's default.
const BY_LOCALE: Record<string, PluralForms> = {
  pt_BR: ROMANCE,
};

export interface PluralLookup {
  forms: PluralForms;
  // False when the locale is not in the table and the Germanic default was
  // assumed. Callers must surface this — a silent wrong guess is the failure
  // mode this table exists to prevent.
  known: boolean;
}

export function getPluralForms(locale: string): PluralLookup {
  const normalised = locale.replace('-', '_');
  const byLocale = BY_LOCALE[normalised];
  if (byLocale) return { forms: byLocale, known: true };

  const language = normalised.split('_')[0].toLowerCase();
  const byLanguage = BY_LANGUAGE[language];
  if (byLanguage) return { forms: byLanguage, known: true };

  return { forms: GERMANIC, known: false };
}

// Render as the value of a PO `Plural-Forms:` header.
export function formatPluralForms(forms: PluralForms): string {
  return `nplurals=${forms.nplurals}; plural=${forms.expression};`;
}
