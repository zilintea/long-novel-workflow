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

// ---------------------------------------------------------------------- ledger

const LEDGER_RE =
  /^-\s*(F\d+)\s*\|\s*planted:\s*(\d+)\s*\|\s*payoff_due:\s*(\d+|—|-)?\s*\|\s*status:\s*(\w+)\s*\|\s*thread:\s*(.*)$/;

export function parseLedger(text) {
  const threads = [];
  for (const line of text.split('\n')) {
    const m = line.match(LEDGER_RE);
    if (m) {
      threads.push({
        id: m[1],
        planted: Number(m[2]),
        payoffDue: m[3] && /^\d+$/.test(m[3]) ? Number(m[3]) : null,
        status: m[4],
        thread: m[5].trim(),
      });
    }
  }
  return threads;
}

export function ledgerLine(t) {
  return `- ${t.id} | planted: ${t.planted} | payoff_due: ${t.payoffDue ?? '—'} | status: ${t.status} | thread: ${t.thread}`;
}

// Apply ledger edits to the file text, preserving header/comments and line order.
// edits: { markPaid: [ids], plant: [{id, planted, payoffDue, thread}], extend: [{id, payoffDue}],
//          reopen: [ids], removePlantedByChapter: chapterNumber }
export function applyLedgerEdits(text, edits) {
  const lines = text.split('\n');
  const out = [];
  const plantedIds = new Set((edits.plant || []).map((t) => t.id));
  for (const line of lines) {
    const m = line.match(LEDGER_RE);
    if (!m) {
      out.push(line);
      continue;
    }
    const t = {
      id: m[1],
      planted: Number(m[2]),
      payoffDue: m[3] && /^\d+$/.test(m[3]) ? Number(m[3]) : null,
      status: m[4],
      thread: m[5].trim(),
    };
    if (edits.removePlantedByChapter !== undefined && t.planted === edits.removePlantedByChapter) {
      continue; // thread was planted by the rolled-back chapter: drop the line
    }
    if ((edits.markPaid || []).includes(t.id)) t.status = 'paid';
    if ((edits.reopen || []).includes(t.id)) t.status = 'open';
    const ext = (edits.extend || []).find((e) => e.id === t.id);
    if (ext) t.payoffDue = ext.payoffDue;
    out.push(ledgerLine(t));
  }
  for (const p of edits.plant || []) {
    if (plantedIds.has(p.id) && !out.some((l) => l.startsWith(`- ${p.id} `))) {
      out.push(ledgerLine({ id: p.id, planted: p.planted, payoffDue: p.payoffDue, status: 'open', thread: p.thread }));
    }
  }
  return out.join('\n');
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

// Append `- entry` lines under each character's `## <name>` section.
// Throws if a character has no section in bible/characters.md.
export function appendKnows(text, entries, characters) {
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
      out += `\n${heading}\n\n- ${entry}\n`;
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

// Remove knows lines learned in a given chapter: lines containing "(chapter N".
export function removeKnowsForChapter(text, chapter) {
  const re = new RegExp(`\\(chapter ${chapter}[\\s—]`);
  return text
    .split('\n')
    .filter((l) => !re.test(l))
    .join('\n');
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
