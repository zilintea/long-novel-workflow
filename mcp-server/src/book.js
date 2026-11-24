// Book-project file IO for long-novel-workflow.
// Layout (see SKILL.md): bible/, outline/, state/, chapters/.
// Canon invariant (enforced by scripts/check_continuity.py): every file in
// chapters/ is committed, and progress.md lists exactly those chapters.
// Drafts therefore live in drafts/ and only move into chapters/ as part of
// an atomic CHAPTER_COMMIT. Contracts live in outline/chapters/ (per
// templates/chapter_contract.md).
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function assertBookId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) {
    throw new Error(
      `invalid book id: ${JSON.stringify(id)} — use a plain directory name (no slashes, no "..")`,
    );
  }
  return id;
}

export function assertChapter(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > 9999) {
    throw new Error(`invalid chapter number: ${JSON.stringify(n)} (want an integer 1-9999)`);
  }
  return num;
}

export const chapterFile = (n) => String(n).padStart(3, '0') + '.md';

export const bookDir = (booksRoot, id) => path.join(booksRoot, assertBookId(id));

// ---------------------------------------------------------------- frontmatter

const FM_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

// Parse a chapter/contract file. The repo's check scripts parse frontmatter
// as naive `key: value` lines, so values must stay single-line; serialize
// below enforces that.
export function parseFrontmatterFile(text) {
  const m = text.match(FM_RE);
  if (!m) return { fields: {}, body: text, hasFrontmatter: false };
  const fields = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { fields, body: m[2], hasFrontmatter: true };
}

const FIELD_ORDER = [
  'chapter',
  'title',
  'language',
  'desire',
  'desire_payoff',
  'payoff_size',
  'hook',
  'hook_handoff',
  'transition',
  'must_happen',
  'must_not',
  'characters',
  'foreshadowing_planted',
  'foreshadowing_paid',
  'chapter_kind',
  'big_cadence_snapshot',
  'is_probe',
];

export function serializeFrontmatterFile(fields, body) {
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== '' && String(v).includes('\n')) {
      throw new Error(
        `field "${k}" contains a newline — frontmatter values must stay single-line ` +
          `(the repo check scripts parse them as naive "key: value" lines)`,
      );
    }
  }
  const lines = ['---'];
  for (const k of FIELD_ORDER) {
    if (fields[k] !== undefined && fields[k] !== '') lines.push(`${k}: ${fields[k]}`);
  }
  for (const [k, v] of Object.entries(fields)) {
    if (!FIELD_ORDER.includes(k) && v !== undefined && v !== '') lines.push(`${k}: ${v}`);
  }
  lines.push('---', '');
  return lines.join('\n') + (body || '');
}

// ------------------------------------------------------------------- chapters

export async function listBookDirs(booksRoot) {
  const entries = await fs.readdir(booksRoot, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(booksRoot, e.name);
    if ((await exists(path.join(dir, 'bible'))) || (await exists(path.join(dir, 'chapters')))) {
      out.push(e.name);
    }
  }
  return out.sort();
}

function chapterNumbersIn(dir) {
  return fs
    .readdir(dir)
    .catch(() => [])
    .then((files) =>
      files
        .filter((f) => /^\d{3}\.md$/.test(f))
        .map((f) => Number(f.slice(0, 3)))
        .sort((a, b) => a - b),
    );
}

// Load one chapter: committed (chapters/) wins, then draft (drafts/), then
// contract-only (outline/chapters/). Status is explicit — a draft is never
// presented as canon.
export async function loadChapter(root, id, n) {
  const dir = bookDir(root, id);
  const fname = chapterFile(n);
  for (const [where, status] of [
    ['chapters', 'committed'],
    ['drafts', 'draft'],
  ]) {
    const p = path.join(dir, where, fname);
    if (await exists(p)) {
      const { fields, body } = parseFrontmatterFile(await fs.readFile(p, 'utf8'));
      return { status, fields, prose: body, source: `${where}/${fname}` };
    }
  }
  const contractPath = path.join(dir, 'outline', 'chapters', fname);
  if (await exists(contractPath)) {
    const { fields, body } = parseFrontmatterFile(await fs.readFile(contractPath, 'utf8'));
    return { status: 'contract-only', fields, prose: '', source: `outline/chapters/${fname}`, contractBody: body };
  }
  return { status: 'missing', fields: {}, prose: '', source: null };
}

export async function listChapters(root, id) {
  const dir = bookDir(root, id);
  const committed = await chapterNumbersIn(path.join(dir, 'chapters'));
  const drafts = await chapterNumbersIn(path.join(dir, 'drafts'));
  const contracts = await chapterNumbersIn(path.join(dir, 'outline', 'chapters'));
  const nums = [...new Set([...committed, ...drafts, ...contracts])].sort((a, b) => a - b);
  const out = [];
  for (const n of nums) {
    const status = committed.includes(n) ? 'committed' : drafts.includes(n) ? 'draft' : 'contract-only';
    let title = '';
    try {
      const { fields } = await loadChapter(root, id, n);
      title = fields.title || '';
    } catch {
      // title stays empty
    }
    out.push({ chapter: n, status, title });
  }
  return out;
}

// Ledger line format (see templates/foreshadowing_ledger.md):
// `- F01 | planted: 1 | payoff_due: 5 | status: open | scope: series | kind: reveal | thread: ...`
// scope/kind are optional on read (old lines lack them) and default to series/other.
// The regex below only anchors the fixed prefix; scope/kind/target_chapter are
// searched in the remainder so field order after status stays tolerant.
const LEDGER_PREFIX_RE =
  /^-\s*(F\d+)\s*\|\s*planted:\s*(\d+)\s*\|\s*payoff_due:\s*(\d+|—|-)?\s*\|\s*status:\s*(\w+)\s*(?:\|(.*))?$/;

function parseLedgerLine(line) {
  const m = line.match(LEDGER_PREFIX_RE);
  if (!m) return null;
  const rest = m[5] || '';
  const scopeM = rest.match(/scope:\s*(series|volume|episode)/);
  const kindM = rest.match(/kind:\s*(reveal|conflict|relationship|other)/);
  const targetM = rest.match(/target_chapter:\s*(\d+)/);
  const threadM = rest.match(/thread:\s*(.*?)\s*$/);
  return {
    id: m[1],
    planted: Number(m[2]),
    payoffDue: m[3] && /^\d+$/.test(m[3]) ? Number(m[3]) : null,
    status: m[4],
    scope: scopeM ? scopeM[1] : 'series',
    kind: kindM ? kindM[1] : 'other',
    targetChapter: targetM ? Number(targetM[1]) : null,
    thread: threadM ? threadM[1].trim() : '',
  };
}

export function parseLedger(text) {
  const threads = [];
  for (const line of text.split('\n')) {
    const t = parseLedgerLine(line);
    if (t) threads.push(t);
  }
  return threads;
}

export function ledgerLine(t) {
  const targetPart = t.targetChapter ? ` | target_chapter: ${t.targetChapter}` : '';
  const scopePart = t.scope ? ` | scope: ${t.scope}` : '';
  const kindPart = t.kind ? ` | kind: ${t.kind}` : '';
  return `- ${t.id} | planted: ${t.planted} | payoff_due: ${t.payoffDue ?? '—'} | status: ${t.status}${scopePart}${kindPart}${targetPart} | thread: ${t.thread}`;
}

// Apply ledger edits to the file text, preserving header/comments and line order.
// edits: { markPaid: [ids], archive: [ids], plant: [{id, planted, payoffDue, thread, scope?, kind?}],
//          extend: [{id, payoffDue}], retarget: [{id, payoffDue}], reopen: [ids],
//          removePlantedByChapter: chapterNumber }
// `extend` defers (status open -> deferred); `retarget` only moves the payoff
// date (used when compressing a thread into a shorter book's end window).
export function applyLedgerEdits(text, edits) {
  const lines = text.split('\n');
  const out = [];
  const plantedIds = new Set((edits.plant || []).map((t) => t.id));
  for (const line of lines) {
    const t = parseLedgerLine(line);
    if (!t) {
      out.push(line);
      continue;
    }
    if (edits.removePlantedByChapter !== undefined && t.planted === edits.removePlantedByChapter) {
      continue; // thread was planted by the rolled-back chapter: drop the line
    }
    if ((edits.markPaid || []).includes(t.id)) t.status = 'paid';
    if ((edits.archive || []).includes(t.id)) t.status = 'archived';
    if ((edits.reopen || []).includes(t.id)) t.status = 'open';
    const ext = (edits.extend || []).find((e) => e.id === t.id);
    if (ext) {
      t.payoffDue = ext.payoffDue;
      if (t.status === 'open') t.status = 'deferred';
      t.targetChapter = ext.payoffDue;
    }
    const ret = (edits.retarget || []).find((e) => e.id === t.id);
    if (ret) t.payoffDue = ret.payoffDue;
    out.push(ledgerLine(t));
  }
  for (const p of edits.plant || []) {
    if (plantedIds.has(p.id) && !out.some((l) => l.startsWith(`- ${p.id} `))) {
      out.push(ledgerLine({ id: p.id, planted: p.planted, payoffDue: p.payoffDue, status: 'open', scope: p.scope || 'series', kind: p.kind || 'other', thread: p.thread }));
    }
  }
  return out.join('\n');
}

// --------------------------------------------------------------------- compass
// Read the ending-plan compass from outline/overview.md. Missing keys -> null
// (old book, legacy fallback). Ending summary is one sentence; the full
// planned ending lives in the `## Planned ending (director-only)` section and
// is NEVER returned by getBook — see redactPlannedEnding().
export function parseCompass(text) {
  const getInt = (key) => {
    const m = text.match(new RegExp(`^- ${key}:\\s*(\\d+)\\s*$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const getStr = (key) => {
    const m = text.match(new RegExp(`^- ${key}:\\s*(.+?)\\s*$`, 'm'));
    return m ? m[1].trim() : null;
  };
  return {
    targetChapters: getInt('Target chapters'),
    targetWords: getInt('Target words'),
    tolerance: getInt('Tolerance'),
    bookStatus: getStr('Book status') || 'ongoing',
    endingSummary: getStr('Ending summary'),
  };
}

// Remove the `## Planned ending (director-only)` section from overview text
// (up to the next `## ` heading or EOF). Blind-writing rule (manual §四):
// prose prompts must never see the full ending; only the explicit
// getEndingPlan tool returns it, for bible drafting / arc review / Gate 3.
export function redactPlannedEnding(text) {
  // Line-based (a regex with `\s*$` in multiline mode stops at the first line
  // end, so a lazy section match returns empty — do not go back to regex).
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## Planned ending (director-only)'));
  if (start === -1) return text;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const kept = [...lines.slice(0, start), ...(end === -1 ? [] : lines.slice(end))];
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// Replace or insert a `- Key: value` line inside the `## Compass` section of
// outline/overview.md (insertion goes right after the `## Compass` heading
// block when the key is absent). value null removes the line.
export function setCompassLine(text, key, value) {
  const lines = text.split('\n');
  const compassIdx = lines.findIndex((l) => /^## Compass/.test(l));
  const nextSection = lines.findIndex((l, i) => i > compassIdx && /^## /.test(l));
  const end = nextSection === -1 ? lines.length : nextSection;
  const re = new RegExp(`^- ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`);
  for (let i = compassIdx + 1; i < end; i++) {
    if (re.test(lines[i])) {
      if (value === null || value === undefined || value === '') lines.splice(i, 1);
      else lines[i] = `- ${key}: ${value}`;
      return lines.join('\n');
    }
  }
  if (value === null || value === undefined || value === '') return text;
  // Insert after the last non-empty line of the Compass section so the new
  // key stays inside the section and the blank line before the next section
  // is preserved.
  let insertAt = end;
  for (let i = end - 1; i > compassIdx; i--) {
    if (lines[i].trim() !== '') {
      insertAt = i + 1;
      break;
    }
  }
  lines.splice(insertAt, 0, `- ${key}: ${value}`);
  return lines.join('\n');
}

// Replace the `## Planned ending (director-only)` section (or append it when
// absent). plannedEnding empty removes the section.
export function setPlannedEndingSection(text, plannedEnding) {
  const stripped = redactPlannedEnding(text);
  if (!plannedEnding || !plannedEnding.trim()) return stripped;
  const section = `## Planned ending (director-only)\n\n${plannedEnding.trim()}\n`;
  return stripped.replace(/\s+$/, '') + `\n\n${section}`;
}

export function extractPlannedEnding(text) {
  // Line-based — see redactPlannedEnding for why regex does not work here.
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('## Planned ending (director-only)'));
  if (start === -1) return '';
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
}

// -------------------------------------------------------------------- progress

export function parseProgress(text) {
  const committed = [...text.matchAll(/committed:\s*(\d+)/g)].map((m) => Number(m[1]));
  const next = text.match(/Next chapter to write:\s*(\d+)/);
  return { committed: [...new Set(committed)].sort((a, b) => a - b), next: next ? Number(next[1]) : null };
}

export function updateProgress(text, { addCommitted, next }) {
  let lines = text.split('\n');
  if (addCommitted !== undefined) {
    const have = new Set(parseProgress(text).committed);
    if (!have.has(addCommitted)) {
      const idx = lines.findIndex((l) => /Next chapter to write:/.test(l));
      const entry = `- committed: ${addCommitted}`;
      if (idx >= 0) lines.splice(idx, 0, entry);
      else lines.push(entry);
    }
  }
  if (next !== undefined) {
    const re = /^(-\s*Next chapter to write:\s*)\d+\s*$/;
    if (lines.some((l) => re.test(l))) {
      lines = lines.map((l) => (re.test(l) ? l.replace(re, `$1${next}`) : l));
    } else {
      lines.push(`- Next chapter to write: ${next}`);
    }
  }
  return lines.join('\n');
}

export function removeProgressEntry(text, chapter, next) {
  let lines = text.split('\n').filter((l) => !new RegExp(`^-\\s*committed:\\s*${chapter}\\s*$`).test(l));
  const re = /^(-\s*Next chapter to write:\s*)\d+\s*$/;
  if (next !== undefined) {
    lines = lines.some((l) => re.test(l))
      ? lines.map((l) => (re.test(l) ? l.replace(re, `$1${next}`) : l))
      : [...lines, `- Next chapter to write: ${next}`];
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------------ knows

export async function bibleCharacters(bookDirPath) {
  const text = await fs.readFile(path.join(bookDirPath, 'bible', 'characters.md'), 'utf8').catch(() => '');
  return [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
}

export function appendBibleCharacters(text, newChars, chapter) {
  let out = text;
  const existing = new Set([...out.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()));
  for (const c of newChars || []) {
    const name = String(c.name || '').trim();
    if (!name || existing.has(name)) continue;
    existing.add(name);
    if (!out.endsWith('\n')) out += '\n';
    out += `\n## ${name}\n<!-- added-in-chapter: ${chapter} -->\n`;
    if (c.role) out += `- Role: ${c.role}\n`;
    if (c.dna) out += `- DNA: ${c.dna}\n`;
    if (c.want) out += `- Want: ${c.want}\n`;
    if (c.flaw) out += `- Flaw: ${c.flaw}\n`;
  }
  return out;
}

export function removeBibleCharactersForChapter(text, chapter) {
  const marker = `<!-- added-in-chapter: ${chapter} -->`;
  if (!text.includes(marker)) return text;
  const parts = text.split(/\n(?=##\s+)/);
  return parts
    .filter((section) => !section.includes(marker))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// Append `- entry` lines under each character's `## <name>` section.
// Throws if a character has no section in bible/characters.md.
export function appendKnows(text, entries, characters, chapter = null) {
  let out = text;
  for (const { character, entry } of entries) {
    if (!characters.includes(character)) {
      throw new Error(
        `knows entry for character "${character}" — no "## ${character}" section in bible/characters.md`,
      );
    }
    const heading = `## ${character}`;
    const idx = out.indexOf(heading);
    if (idx === -1) {
      if (!out.endsWith('\n')) out += '\n';
      const marker = chapter ? `<!-- added-in-chapter: ${chapter} -->\n` : '';
      out += `\n${heading}\n${marker}\n- ${entry}\n`;
      continue;
    }
    const after = out.indexOf('\n## ', idx + heading.length);
    const insertAt = after === -1 ? out.length : after;
    const chunk = out.slice(0, insertAt);
    const sep = chunk.endsWith('\n') ? '' : '\n';
    out = chunk + sep + `- ${entry}\n` + out.slice(insertAt);
  }
  return out;
}

// Remove knows lines learned in a given chapter: lines containing "(chapter N"
// as well as sections created purely for characters introduced in that chapter.
export function removeKnowsForChapter(text, chapter) {
  const marker = `<!-- added-in-chapter: ${chapter} -->`;
  const parts = text.split(/\n(?=##\s+)/).filter((section) => !section.includes(marker));
  const re = new RegExp(`\\(chapter ${chapter}[\\s—]`);
  return parts
    .join('\n')
    .split('\n')
    .filter((l) => !re.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// ------------------------------------------------------------------ atomic write

// Write several files atomically-ish: every file is written to a temp file in
// the same directory first, then all are renamed into place. If anything
// fails, already-renamed files are restored from memory and temp files are
// removed. Best-effort rollback for a local single-writer server — documented
// in the README.
export async function writeFilesAtomic(ops) {
  const backups = [];
  const temps = [];
  try {
    for (const op of ops) {
      const orig = await fs.readFile(op.path, 'utf8').catch(() => null);
      backups.push({ path: op.path, orig });
      const tmp = `${op.path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
      await fs.mkdir(path.dirname(op.path), { recursive: true });
      await fs.writeFile(tmp, op.content, 'utf8');
      temps.push(tmp);
    }
    for (let i = 0; i < ops.length; i++) await fs.rename(temps[i], ops[i].path);
  } catch (err) {
    for (const b of backups) {
      try {
        if (b.orig !== null) await fs.writeFile(b.path, b.orig, 'utf8');
        else await fs.unlink(b.path).catch(() => {});
      } catch {
        // best effort
      }
    }
    for (const t of temps) await fs.unlink(t).catch(() => {});
    throw err;
  }
}

export async function copyBookToTemp(bookDirPath) {
  const tmp = await fs.mkdtemp(path.join((await import('node:os')).tmpdir(), 'long-novel-audit-'));
  await fs.cp(bookDirPath, tmp, { recursive: true });
  return tmp;
}

export async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// Title: first 《...》 in state/summary.md, else bible/canon.md, else the dir name.
export async function deriveTitle(bookDirPath, fallback) {
  for (const rel of ['state/summary.md', 'bible/canon.md', 'outline/overview.md']) {
    const text = await fs.readFile(path.join(bookDirPath, rel), 'utf8').catch(() => '');
    const m = text.match(/《([^》]{1,60})》/);
    if (m) return m[1];
  }
  return fallback;
}

export async function readFileIfExists(p) {
  return fs.readFile(p, 'utf8').catch(() => null);
}
