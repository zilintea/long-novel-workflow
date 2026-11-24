// User submission I/O for the MCP server (v2.4.0, P2).
// The MCP tools accept structured JSON and write the same restricted YAML
// subset the Python scripts parse (scripts/user_outline.py) — one source of
// truth, no second implementation of the validation rules. The Python
// scripts do the checking; this module only serialises and writes files.
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Quote a string scalar when the restricted YAML subset would misread it:
// contains ": " or " #", starts with a structural character, has leading /
// trailing space, is empty, or would parse as a number / boolean / null.
function yamlScalar(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = String(value ?? '');
  if (s === '' || /^\s|\s$/.test(s) || s.startsWith('-') || s.startsWith('[') || s.startsWith('{') ||
      s.startsWith('*') || s.startsWith('&') || s.startsWith('!') || s.startsWith('|') ||
      s.startsWith('>') || s.startsWith('%') || s.startsWith('@') || s.startsWith('`') ||
      s.startsWith('#') || s.includes(': ') || s.includes(' #') || s.endsWith(':') ||
      /^-?\d+$/.test(s) || /^(true|false|null|~)$/i.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function yamlList(items) {
  if (!items || !items.length) return '[]';
  return `[${items.map(yamlScalar).join(', ')}]`;
}

function indent(lines, spaces) {
  const pad = ' '.repeat(spaces);
  return lines.map((l) => (l ? pad + l : l)).join('\n');
}

export function serializeUserOutline(input) {
  const book = input.book || {};
  const lines = [
    '# user_outline.yaml — user submission (source: user, locked). Written by submitUserOutline.',
    'book:',
    `  title: ${yamlScalar(book.title ?? '')}`,
    `  language: ${yamlScalar(book.language ?? 'zh')}`,
    '  mode: user-driven',
  ];
  if (book.targetChapters !== undefined) lines.push(`  target_chapters: ${book.targetChapters}`);
  if (book.chapterTargetChars !== undefined) lines.push(`  chapter_target_chars: ${book.chapterTargetChars}`);
  if (book.chapterTargetWords !== undefined) lines.push(`  chapter_target_words: ${book.chapterTargetWords}`);
  if (input.arcs && input.arcs.length) {
    lines.push('arcs:');
    for (const arc of input.arcs) {
      lines.push(`  - name: ${yamlScalar(arc.name)}`);
      lines.push(`    range: ${yamlScalar(arc.range)}`);
      if (arc.frozen !== undefined) lines.push(`    frozen: ${arc.frozen ? 'true' : 'false'}`);
    }
  }
  const chapters = input.chapters || [];
  lines.push('chapters:');
  for (const ch of chapters) {
    lines.push(`  - chapter: ${ch.chapter}`);
    lines.push(`    title: ${yamlScalar(ch.title ?? '')}`);
    if (ch.desire !== undefined) lines.push(`    desire: ${yamlScalar(ch.desire)}`);
    if (ch.payoffSize !== undefined) lines.push(`    payoff_size: ${yamlScalar(ch.payoffSize)}`);
    lines.push(`    hook: ${yamlScalar(ch.hook ?? '')}`);
    lines.push(`    characters: ${yamlList(ch.characters)}`);
    lines.push(`    foreshadowing_planted: ${yamlList(ch.foreshadowingPlanted)}`);
    lines.push(`    foreshadowing_paid: ${yamlList(ch.foreshadowingPaid)}`);
    lines.push('    must_happen:');
    for (const beat of ch.mustHappen || []) {
      lines.push(`      - beat: ${yamlScalar(beat.beat ?? '')}`);
      lines.push(`        keywords: ${yamlList(beat.keywords)}`);
      if (beat.budget !== undefined) lines.push(`        budget: ${beat.budget}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function serializeUserCharacters(characters) {
  const lines = ['# user_characters.yaml — user submission (source: user, locked). Written by submitUserOutline.', 'characters:'];
  for (const c of characters || []) {
    lines.push(`  - name: ${yamlScalar(c.name)}`);
    if (c.age !== undefined) lines.push(`    age: ${c.age}`);
    if (c.role !== undefined) lines.push(`    role: ${yamlScalar(c.role)}`);
    if (c.want !== undefined) lines.push(`    want: ${yamlScalar(c.want)}`);
    if (c.flaw !== undefined) lines.push(`    flaw: ${yamlScalar(c.flaw)}`);
    if (c.aliases !== undefined) lines.push(`    aliases: ${yamlList(c.aliases)}`);
  }
  return lines.join('\n') + '\n';
}

export function serializeUserThreads(threads) {
  const lines = ['# user_foreshadowing.yaml — user submission (source: user, locked). Written by submitUserOutline.', 'threads:'];
  for (const t of threads || []) {
    lines.push(`  - id: ${yamlScalar(t.id)}`);
    lines.push(`    planted: ${t.planted}`);
    lines.push(`    payoff_due: ${t.payoffDue}`);
    if (t.status !== undefined) lines.push(`    status: ${yamlScalar(t.status)}`);
    if (t.thread !== undefined) lines.push(`    thread: ${yamlScalar(t.thread)}`);
  }
  return lines.join('\n') + '\n';
}

// Write a submission into <bookDir>/user_submission/ (untouched by the
// server afterwards — the files are the author's originals). Returns the
// list of written file paths (relative to the book dir).
export async function writeSubmission(bookDir, input) {
  const dir = path.join(bookDir, 'user_submission');
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  if (input.brief !== undefined && input.brief !== null && String(input.brief).trim() !== '') {
    const brief = String(input.brief);
    const text = brief.startsWith('#') ? brief : `# User Brief — user submission (source: user, locked)\n\n${brief}\n`;
    await fs.writeFile(path.join(dir, 'user_brief.md'), text, 'utf8');
    written.push('user_submission/user_brief.md');
  }
  await fs.writeFile(path.join(dir, 'user_outline.yaml'), serializeUserOutline(input), 'utf8');
  written.push('user_submission/user_outline.yaml');
  if (input.characters && input.characters.length) {
    await fs.writeFile(path.join(dir, 'user_characters.yaml'), serializeUserCharacters(input.characters), 'utf8');
    written.push('user_submission/user_characters.yaml');
  }
  if (input.threads && input.threads.length) {
    await fs.writeFile(path.join(dir, 'user_foreshadowing.yaml'), serializeUserThreads(input.threads), 'utf8');
    written.push('user_submission/user_foreshadowing.yaml');
  }
  return written;
}
