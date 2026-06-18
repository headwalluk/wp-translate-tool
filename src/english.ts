// English-target handling (deterministic, no API).
//
// Machine translation can't do this: DeepL translating en->en (e.g. target
// EN-GB) is a no-op — it returns the source unchanged and would only corrupt
// short strings if it did anything. So English locales never go to DeepL.
// Instead:
//   en / en_US      -> source passes through verbatim (already the right dialect).
//   en_GB/en_AU/... -> apply American->British spelling conversion locally
//                      (color -> colour, organize -> organise); anything not
//                      recognised passes through unchanged.

export type EnglishMode = 'none' | 'us-passthrough' | 'gb-convert';

// Classify the target locale. en_CA is treated as gb-convert: Canadian spelling
// is genuinely mixed (colour but organize), so neither rule fits perfectly;
// British-family is the closer default.
export function englishTarget(locale: string): EnglishMode {
  const [lang, region] = locale.toLowerCase().split(/[_-]/);
  if (lang !== 'en') return 'none';
  if (!region || region === 'us') return 'us-passthrough';
  return 'gb-convert';
}

// American -ize / -yze morphology (British prefers -ise / -yse). Handled by an
// algorithmic suffix swap rather than a word list, so it covers the open set
// (organize, customize, authorize, prioritize, ...). Tested against whole
// lower-cased word tokens, so anchoring is exact.
const AMERICAN_SUFFIX =
  /^[a-z]+(?:ize|izes|ized|izing|izer|izers|ization|izations|yze|yzes|yzed|yzing)$/;

// Words ending in -ize that are identical in British English — the suffix swap
// must skip these (size -> NOT sise).
const IZE_EXCEPTIONS = new Set([
  'size', 'sizes', 'sized', 'sizing', 'sizer', 'sizers',
  'resize', 'resizes', 'resized', 'resizing',
  'oversize', 'oversized', 'downsize', 'downsized', 'downsizing',
  'upsize', 'upsized', 'midsize', 'capsize', 'capsized', 'capsizing',
  'prize', 'prizes', 'prized', 'prizing', 'maize',
]);

// Whole-word American->British conversions the suffix rule doesn't cover.
// Keyed by lower-cased word, matched against whole tokens so the substring trap
// (e.g. "meter" inside "parameter") cannot fire. Ambiguous words whose
// American/British forms can both be correct in context (bare "meter" for a gas
// meter, "tire" meaning to weary) are deliberately omitted. Extend as needed.
const AMERICAN_TO_BRITISH = new Map<string, string>([
  // -or vs -our
  ['color', 'colour'], ['colors', 'colours'], ['colored', 'coloured'],
  ['coloring', 'colouring'], ['colorful', 'colourful'],
  ['neighbor', 'neighbour'], ['neighbors', 'neighbours'],
  ['neighborhood', 'neighbourhood'], ['neighboring', 'neighbouring'],
  ['favor', 'favour'], ['favors', 'favours'], ['favored', 'favoured'],
  ['favorite', 'favourite'], ['favorites', 'favourites'],
  ['honor', 'honour'], ['honors', 'honours'], ['honored', 'honoured'],
  ['honorable', 'honourable'],
  ['labor', 'labour'], ['labors', 'labours'], ['labored', 'laboured'],
  ['flavor', 'flavour'], ['flavors', 'flavours'], ['flavored', 'flavoured'],
  ['behavior', 'behaviour'], ['behaviors', 'behaviours'],
  ['behavioral', 'behavioural'],
  ['harbor', 'harbour'], ['harbors', 'harbours'],
  ['rumor', 'rumour'], ['rumors', 'rumours'],
  ['humor', 'humour'], ['humored', 'humoured'],
  ['odor', 'odour'], ['odors', 'odours'],
  ['vapor', 'vapour'], ['vapors', 'vapours'],
  ['savior', 'saviour'], ['saviors', 'saviours'],
  ['armor', 'armour'], ['armored', 'armoured'],
  ['parlor', 'parlour'], ['valor', 'valour'], ['vigor', 'vigour'],
  // -er vs -re (length units only; bare "meter"/"meters" omitted as ambiguous)
  ['center', 'centre'], ['centers', 'centres'], ['centered', 'centred'],
  ['centering', 'centring'],
  ['theater', 'theatre'], ['theaters', 'theatres'],
  ['liter', 'litre'], ['liters', 'litres'],
  ['fiber', 'fibre'], ['fibers', 'fibres'],
  ['caliber', 'calibre'], ['calibers', 'calibres'],
  ['kilometer', 'kilometre'], ['kilometers', 'kilometres'],
  ['centimeter', 'centimetre'], ['centimeters', 'centimetres'],
  ['millimeter', 'millimetre'], ['millimeters', 'millimetres'],
  // -se vs -ce (noun forms)
  ['defense', 'defence'], ['defenses', 'defences'],
  ['offense', 'offence'], ['offenses', 'offences'],
  ['license', 'licence'], ['licenses', 'licences'],
  // -og vs -ogue
  ['catalog', 'catalogue'], ['catalogs', 'catalogues'],
  ['dialog', 'dialogue'], ['dialogs', 'dialogues'], ['analog', 'analogue'],
  // single-l before suffix (British doubles the l)
  ['traveler', 'traveller'], ['travelers', 'travellers'],
  ['traveled', 'travelled'], ['traveling', 'travelling'],
  ['canceled', 'cancelled'], ['canceling', 'cancelling'],
  ['cancelation', 'cancellation'],
  ['labeled', 'labelled'], ['labeling', 'labelling'],
  ['modeled', 'modelled'], ['modeling', 'modelling'],
  ['fueled', 'fuelled'], ['fueling', 'fuelling'],
  ['signaled', 'signalled'], ['signaling', 'signalling'],
  // -ll vs -l (American doubles, British single)
  ['fulfill', 'fulfil'], ['fulfills', 'fulfils'],
  ['enroll', 'enrol'], ['enrolls', 'enrols'], ['enrollment', 'enrolment'],
  ['installment', 'instalment'],
  // misc
  ['gray', 'grey'], ['grays', 'greys'], ['grayed', 'greyed'],
  ['grayscale', 'greyscale'], ['grayscales', 'greyscales'],
  ['aluminum', 'aluminium'], ['airplane', 'aeroplane'],
  ['mustache', 'moustache'], ['plow', 'plough'], ['plows', 'ploughs'],
  ['pajamas', 'pyjamas'],
]);

// Re-apply the original word's casing to a lower-cased British replacement.
function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// Convert American spellings in `text` to British-style English, leaving every
// other character (spacing, punctuation, placeholders like %s) untouched. Only
// runs of ASCII letters are considered, so the substring trap cannot fire.
export function toBritish(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => {
    const lower = word.toLowerCase();
    const mapped = AMERICAN_TO_BRITISH.get(lower);
    if (mapped) return matchCase(word, mapped);
    if (AMERICAN_SUFFIX.test(lower) && !IZE_EXCEPTIONS.has(lower)) {
      const brit = lower
        .replace(/iz(e|es|ed|ing|er|ers|ation|ations)$/, 'is$1')
        .replace(/yz(e|es|ed|ing)$/, 'ys$1');
      return matchCase(word, brit);
    }
    return word;
  });
}
