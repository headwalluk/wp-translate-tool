import { readFileSync, writeFileSync } from 'fs';

export interface PoEntry {
  raw: string[];
  msgctxt: string | null;
  msgid: string | null;
  msgstr: string | null;
  msgstrIndex: number;
  newTranslation: string | null;
}

function createEntry(): PoEntry {
  return { raw: [], msgctxt: null, msgid: null, msgstr: null, msgstrIndex: -1, newTranslation: null };
}

export function parsePo(filePath: string): PoEntry[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const entries: PoEntry[] = [];
  let current = createEntry();
  let state: 'NONE' | 'CTX' | 'ID' | 'STR' = 'NONE';

  function pushEntry() {
    if (current.raw.length > 0) {
      while (current.raw.length > 0 && current.raw[current.raw.length - 1].trim() === '') {
        current.raw.pop();
      }
      if (current.raw.length > 0) entries.push(current);
    }
    current = createEntry();
  }

  for (const line of lines) {
    if (line.trim() === '' && state !== 'NONE') {
      pushEntry();
      state = 'NONE';
      continue;
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

    current.raw.push(line);
  }
  pushEntry();

  return entries;
}

export function injectLanguageHeader(entries: PoEntry[], locale: string): void {
  if (entries.length === 0 || entries[0].msgid !== '') return;
  const header = entries[0];
  const headerContent = header.raw.join('\n');
  if (!headerContent.includes('"Language:')) {
    if (header.msgstrIndex > -1) {
      header.raw.splice(header.msgstrIndex + 1, 0, `"Language: ${locale}\\n"`);
    }
  }
}

export function applyTranslations(entries: PoEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.newTranslation && entry.msgstrIndex > -1) {
      entry.raw[entry.msgstrIndex] = entry.newTranslation;
      count++;
    }
  }
  return count;
}

export function writePo(filePath: string, entries: PoEntry[]): void {
  const output = entries.map(e => e.raw.join('\n')).join('\n\n');
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

export function getUntranslated(entries: PoEntry[]): { standard: PoEntry[]; contextual: PoEntry[] } {
  const needs = entries.filter(e => e.msgid && e.msgid !== '' && e.msgstr === '');
  return {
    standard: needs.filter(e => !e.msgctxt),
    contextual: needs.filter(e => e.msgctxt),
  };
}
