// Agent-instruction sync.
//
// Injects/updates a versioned, marker-delimited block in a plugin's AI-agent
// instructions file (AGENTS.md / CLAUDE.md / ...) teaching the coding agent how
// to write translatable strings (_x() context) and how to run wp-translate.
//
// This is a *nudge*, not a fix: it writes guidance for whoever next runs a
// coding agent on the plugin. It never creates a file (existing files only) and
// never touches anything outside its own markers.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { createHash } from 'crypto';

// The block body's own version, independent of the tool version. Bump when the
// canonical guidance below changes so synced plugins can detect a stale block.
export const BLOCK_VERSION = '1.0.0';

const BEGIN_PREFIX = '<!-- wp-translate:begin ';
const END_MARKER = '<!-- wp-translate:end -->';

// `__TEXTDOMAIN__` is replaced with the plugin's real text domain on injection,
// so the literal placeholder never reaches the examples (or the .po/.mo files).
const BODY_TEMPLATE = `## Translating this plugin (wp-translate conventions)

This plugin's \`.po\`/\`.mo\` files are generated from source by
[wp-translate](https://github.com/headwalluk/wp-translate-tool), which
machine-translates strings with DeepL. Machine translation is only as good as
the strings you give it — follow these conventions when adding or editing
user-facing text.

### 1. Disambiguate short or ambiguous strings with \`_x()\`

DeepL handles full sentences well but guesses badly on short, context-free
labels. Give it context with \`_x()\` (or \`esc_html_x()\`, \`_ex()\`):

\`\`\`php
// Ambiguous out of context — DeepL may read "Sent" as "late", "Folder" as "leaflet"
__( 'Sent', '__TEXTDOMAIN__' );

// Disambiguated — the context is passed to the translator and to DeepL
_x( 'Sent', 'email delivery status', '__TEXTDOMAIN__' );
_x( 'Folder', 'IMAP mailbox', '__TEXTDOMAIN__' );
_x( 'Open', 'verb; button label', '__TEXTDOMAIN__' );
\`\`\`

The context (2nd argument) is never shown to users. Use it whenever a string is a
single word, a short label, or has more than one plausible meaning.

### 2. Use placeholders, never concatenation

Build dynamic text with \`printf\`/\`sprintf\` so the whole sentence translates as a
unit, and add a \`translators:\` comment to explain each placeholder:

\`\`\`php
/* translators: %s is the user's display name */
printf( esc_html__( 'Welcome back, %s', '__TEXTDOMAIN__' ), $name );
\`\`\`

Never split a sentence across multiple translation calls — word order differs
between languages.

### 3. Acronyms and technical tokens

wp-translate keeps common acronyms (\`TLS\`, \`API\`, \`SMTP\`, \`URL\`, \`ID\`, \`UTC\`, …)
verbatim automatically. If you introduce an unusual acronym or product name that
must not be translated, keep it as its own standalone string so it is recognised,
or ask the maintainer to add it to the tool's acronym list.

### 4. English source dialect

Write source strings in standard English. wp-translate handles English targets
locally (no DeepL): \`en\`/\`en_US\` use the source as-is, and \`en_GB\`/\`en_AU\`/… get
American spellings converted to British automatically (\`color\` → \`colour\`).

### Running wp-translate

After changing strings, regenerate translations:

\`\`\`bash
wp-translate /path/to/this-plugin              # auto-detect locales from languages/
wp-translate /path/to/this-plugin en_GB,fr_FR  # explicit locales
wp-translate /path/to/this-plugin --dry-run    # preview; no API calls, no writes
\`\`\`

Requires WP-CLI (\`wp\`) and a DeepL API key at \`~/.config/deepl.env\`. The tool
regenerates the \`.pot\` from source, translates new/changed strings for each
locale, and compiles the \`.mo\` files.`;

// Recognised agent-instruction files, highest precedence first.
const AGENT_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
  'GEMINI.md',
];

export type BlockStatus = 'current' | 'stale' | 'newer' | 'missing-block' | 'drift';

export interface AgentFiles {
  target: string | null;   // highest-precedence existing file (relative name)
  others: string[];        // other existing files, left untouched
}

// Find existing agent-instruction files (existing only — never created).
export function findAgentFiles(pluginDir: string): AgentFiles {
  const present = AGENT_FILES.filter(rel => existsSync(join(pluginDir, rel)));
  return { target: present[0] ?? null, others: present.slice(1) };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Derive the plugin text domain without invoking wp-cli: existing .pot, else the
// main plugin file's "Text Domain" header, else the directory slug.
export function detectDomain(pluginDir: string): string {
  const langDir = join(pluginDir, 'languages');
  if (existsSync(langDir)) {
    const pot = readdirSync(langDir).find(f => f.endsWith('.pot'));
    if (pot) return basename(pot, '.pot');
  }
  if (existsSync(pluginDir)) {
    for (const f of readdirSync(pluginDir)) {
      if (!f.endsWith('.php')) continue;
      const head = readFileSync(join(pluginDir, f), 'utf8').slice(0, 8192);
      if (/Plugin Name:/i.test(head)) {
        const m = head.match(/Text Domain:\s*(\S+)/i);
        if (m) return m[1];
      }
    }
  }
  return basename(pluginDir);
}

export function renderBody(domain: string): string {
  return BODY_TEMPLATE.split('__TEXTDOMAIN__').join(domain);
}

interface ParsedBlock {
  version: string | null;
  hash: string | null;
  body: string;
  start: number;  // index of begin marker
  end: number;    // index just past end marker
}

function findBlock(content: string): ParsedBlock | null {
  const start = content.indexOf(BEGIN_PREFIX);
  if (start === -1) return null;
  const beginLineEnd = content.indexOf('\n', start);
  const endIdx = content.indexOf(END_MARKER, beginLineEnd === -1 ? start : beginLineEnd);
  if (beginLineEnd === -1 || endIdx === -1) return null;
  const beginLine = content.slice(start, beginLineEnd);
  const m = beginLine.match(/v=([0-9.]+)\s+hash=([0-9a-f]+)/);
  const body = content.slice(beginLineEnd + 1, endIdx).replace(/\n$/, '');
  return {
    version: m?.[1] ?? null,
    hash: m?.[2] ?? null,
    body,
    start,
    end: endIdx + END_MARKER.length,
  };
}

// Numeric semver compare (x.y.z). Returns -1, 0, or 1.
export function semverCompare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Classify an agent file's block against the current canonical body for `domain`.
export function blockStatus(content: string, domain: string): BlockStatus {
  const block = findBlock(content);
  if (!block || !block.version || !block.hash) return 'missing-block';
  const cmp = semverCompare(block.version, BLOCK_VERSION);
  if (cmp > 0) return 'newer';
  if (cmp < 0) return 'stale';
  // Same version: integrity first, then currency (e.g. domain changed).
  if (sha256(block.body) !== block.hash) return 'drift';
  return block.hash === sha256(renderBody(domain)) ? 'current' : 'stale';
}

// Build the full marker-wrapped block for `domain`.
function buildBlock(domain: string): string {
  const body = renderBody(domain);
  return `${BEGIN_PREFIX}v=${BLOCK_VERSION} hash=${sha256(body)} -->\n${body}\n${END_MARKER}`;
}

// Inject (if absent) or replace (if present) the block, leaving everything
// outside the markers byte-for-byte intact. Returns the new file content.
export function applyBlock(content: string, domain: string): string {
  const block = buildBlock(domain);
  const existing = findBlock(content);
  if (existing) {
    return content.slice(0, existing.start) + block + content.slice(existing.end);
  }
  const sep = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  return content + sep + block + '\n';
}
