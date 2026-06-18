// Acronym / short-token identity guard.
//
// Short, context-free technical acronyms are the worst case for DeepL's
// contextless batch path: with nothing to anchor them it expands or invents
// meanings (`TLS` -> "The latest security standards", `TOTP` -> "Une vraie
// plaie"). For non-English targets we keep these verbatim instead of sending
// them to DeepL.
//
// Matching is whole-msgid, exact, and CASE-SENSITIVE. Acronyms are canonically
// upper-case, and case-sensitivity avoids passing through a real lower-case word
// that happens to share the letters (e.g. the word "rest" vs the acronym
// "REST", or "id" vs "ID"). Only an entry whose entire msgid is exactly a listed
// token is protected — compound strings like "Enable TLS" still go to DeepL,
// where the surrounding words give it enough context.
//
// English locales don't need this: they're handled locally (see english.ts) and
// acronyms already pass through there unchanged.

const ACRONYMS = new Set([
  // Auth / 2FA / security
  'TLS', 'SSL', 'TOTP', 'HOTP', 'OTP', '2FA', 'MFA', 'SSO', 'JWT', 'PIN',
  // Web / API / formats
  'API', 'SDK', 'URL', 'URI', 'HTML', 'CSS', 'JS', 'JSON', 'XML', 'CSV', 'TSV',
  'HTTP', 'HTTPS', 'FTP', 'SFTP', 'SSH', 'DNS', 'IP', 'CDN', 'REST', 'AJAX',
  'RSS', 'UUID', 'GUID',
  // Media / image
  'SVG', 'PNG', 'JPG', 'JPEG', 'GIF', 'PDF', 'QR', 'RGB', 'RGBA', 'HEX',
  // Mail
  'SMTP', 'IMAP', 'POP3', 'MIME', 'DKIM', 'SPF', 'DMARC',
  // WordPress / data / misc
  'SQL', 'DB', 'PHP', 'WP', 'CMS', 'SEO', 'SKU', 'CPT', 'ID', 'UTC', 'GMT',
  // Sizes / units
  'KB', 'MB', 'GB', 'TB', 'Hz', 'DPI', 'PPI',
]);

// True if the whole string is a protected acronym (exact, case-sensitive).
export function isProtectedAcronym(text: string): boolean {
  return ACRONYMS.has(text);
}
