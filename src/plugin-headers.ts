// Plugin/theme file-header identity guard.
//
// `wp i18n make-pot` extracts the metadata from the main plugin file's comment
// header as ordinary translatable strings, tagging each one with an extracted
// comment naming the field it came from:
//
//   #. Plugin Name of the plugin
//   #: my-plugin.php
//   msgid "Tidy Resize Images"
//   msgstr ""
//
// None of these should be machine-translated. A plugin's name and its author's
// name are proper nouns — DeepL rendered "Paul Faulkner" as "Πολ Φόλκνερ" in
// el_GR — and the URI fields are not language-dependent at all. The Description
// is genuine prose and does translate acceptably, but it belongs to the same
// header block and is skipped with the rest so that "the plugin header is not
// translated" stays one rule with no exceptions to remember.
//
// Note that a header msgid is not necessarily *only* a header: `Plugin Name` is
// commonly reused as an admin page title, and gettext gives one msgid one
// translation. Skipping it therefore leaves those UI occurrences in the source
// language too, which is the wanted behaviour for a product name.
//
// Detection keys off wp-cli's own marker comment, so it needs no knowledge of
// which file a string was extracted from. The recognised-name set is the guard
// against a hand-written `/* translators: */` comment that happens to end in
// the same words being taken for a header field: a false positive here would
// silently leave a real UI string untranslated, which is the failure mode most
// likely to go unnoticed.

// Field names wp-cli extracts from a plugin or theme header, lower-cased.
const HEADER_FIELDS = new Set([
  // Plugin
  'plugin name', 'plugin uri', 'description', 'author', 'author uri', 'version',
  // Theme (same marker, "of the theme")
  'theme name', 'theme uri', 'tags',
]);

// wp-cli writes "<Field> of the plugin" (or "of the theme"). Releases before
// 2.2 wrote "of the plugin/theme" for both, so that form is accepted too.
const HEADER_COMMENT = /^#\.\s*(.+?)\s+of the (?:plugin(?:\/theme)?|theme)\s*$/i;

// The header field a `#.` comment line marks, or null if it marks none.
export function matchPluginHeaderComment(line: string): string | null {
  const match = line.match(HEADER_COMMENT);
  let field: string | null = null;
  if (match) {
    const name = match[1].trim();
    if (HEADER_FIELDS.has(name.toLowerCase())) field = name;
  }
  return field;
}
