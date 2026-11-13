// Tool handlers for the long-novel-workflow MCP server.
// The host model does all writing and prose judgment. The server only
// manages state (files) and runs the repo's deterministic Python checks.
// It never calls any model API and never invents book data.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as book from './book.js';
import { auditDraft, runChecks } from './audit.js';

const DESIRES = ['curiosity', 'identification-upgrade', 'revenge-compensation', 'being-loved', 'escape-comfort'];
const DESIRE_ZH = {
  好奇: 'curiosity',
  代入升级: 'identification-upgrade',
  复仇补偿: 'revenge-compensation',
  被爱拉扯: 'being-loved',
  逃逸安慰: 'escape-comfort',
};
const REQUIRED_CONTRACT = ['chapter', 'title', 'language', 'desire', 'hook', 'transition', 'must_happen', 'characters'];

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function fail(message) {
  return { isError: true, content: [{ type: 'text', text: String(message) }] };
}
function wrap(fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err && err.message ? err.message : String(err));
    }
  };
}

async function loadBookDir(booksRoot, id) {
  const dir = book.bookDir(booksRoot, id);
  if (!(await book.exists(dir))) throw new Error(`book not found: "${id}" (looked in ${booksRoot})`);
  return dir;
}

function normalizeIdList(v) {
  if (v === undefined || v === null) return '-';
  const ids = Array.isArray(v) ? v : String(v).split(',');
  const clean = ids.map((s) => String(s).trim()).filter(Boolean);
  for (const id of clean) {
    if (!/^F\d+$/.test(id)) throw new Error(`bad foreshadowing id: ${JSON.stringify(id)} (want F01, F02, ...)`);
  }
  return clean.length ? clean.join(', ') : '-';
}

function parseIdList(v) {
  if (!v || v === '-') return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

// Map camelCase tool input to snake_case frontmatter fields.
function contractInputToFields(input) {
  const f = {};
  const map = {
    chapter: 'chapter',
    title: 'title',
    language: 'language',
    desire: 'desire',
    desirePayoff: 'desire_payoff',
    payoffSize: 'payoff_size',
    hook: 'hook',
    hookHandoff: 'hook_handoff',
    transition: 'transition',
    mustHappen: 'must_happen',
    mustNot: 'must_not',
  };
  for (const [inkey, outkey] of Object.entries(map)) {
    if (input[inkey] !== undefined && input[inkey] !== null && input[inkey] !== '') f[outkey] = String(input[inkey]);
  }
  if (input.characters !== undefined) {
    f.characters = Array.isArray(input.characters) ? input.characters.join(', ') : String(input.characters);
  }
  if (input.foreshadowingPlanted !== undefined) f.foreshadowing_planted = normalizeIdList(input.foreshadowingPlanted);
  if (input.foreshadowingPaid !== undefined) f.foreshadowing_paid = normalizeIdList(input.foreshadowingPaid);
  return f;
}

// Validate contract fields the same way scripts/check_chapter.py and
// scripts/check_hooks.py do (same rules, same messages where possible).
function validateContractFields(f, chapter) {
  const errors = [];
  for (const req of REQUIRED_CONTRACT) {
    if (!f[req] || !String(f[req]).trim()) errors.push(`missing/empty required field \`${req}\``);
  }
  if (f.chapter !== undefined && Number(f.chapter) !== chapter) {
    errors.push(`chapter field ${f.chapter} != ${chapter} (field must match the chapter number)`);
  }
  if (f.language && !['zh', 'en'].includes(f.language)) {
    errors.push(`unknown language \`${f.language}\` (want zh or en)`);
  }
  if (f.desire) {
    const d = DESIRE_ZH[f.desire] || f.desire;
    if (!DESIRES.includes(d)) errors.push(`unknown desire \`${f.desire}\` (want one of ${DESIRES.join(', ')})`);
  }
  if (chapter % 3 === 0 && !['small', 'big'].includes(f.payoff_size)) {
    errors.push(`chapter ${chapter} is a payoff chapter (multiple of 3) — declare payoff_size small|big`);
  }
  if (chapter % 10 === 0 && f.payoff_size !== 'big') {
    errors.push(`chapter ${chapter} is a big-payoff chapter (multiple of 10) — payoff_size must be big`);
  }
  return errors;
}

async function loadSlopPhrases(skillRoot, lang) {
  const text = await fs.readFile(path.join(skillRoot, 'data', 'slop', `${lang}.yaml`), 'utf8').catch(() => '');
  const phrases = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^-\s+"(.*)"$/) || line.trim().match(/^-\s+'(.*)'$/) || line.trim().match(/^-\s+(.+)$/);
    if (m && !line.trim().startsWith('#')) phrases.push(m[1].trim());
  }
  return phrases.filter(Boolean);
}

function proseWarnings(prose, language, slopPhrases) {
  const warnings = [];
  if (language === 'zh') {
    const size = prose.replace(/\s+/g, '').length;
    if (size < 800 || size > 3500) warnings.push(`prose is ${size} chars (serial range is 800-3500) — the audit will fail`);
    else if (size < 2000) warnings.push(`prose is ${size} chars, below the serial target of 2000 (ok for a probe — say so in the contract)`);
  } else {
    const size = (prose.match(/[A-Za-z']+/g) || []).length;
    if (size < 600 || size > 3000) warnings.push(`prose is ${size} words (serial range is 600-3000) — the audit will fail`);
    else if (size < 1500) warnings.push(`prose is ${size} words, below the serial target of 1500 (ok for a probe — say so in the contract)`);
  }
  for (const p of slopPhrases) {
    if (p && prose.includes(p)) warnings.push(`banned AI-flavour phrase in prose: ${JSON.stringify(p)} — the audit will fail`);
  }
  return warnings;
}

async function readDirFiles(dir) {
  const out = {};
  const files = await fs.readdir(dir).catch(() => []);
  for (const f of files.sort()) {
    const p = path.join(dir, f);
    if ((await fs.stat(p)).isFile()) out[f] = await fs.readFile(p, 'utf8');
  }
  return out;
}

// ------------------------------------------------------------------ commit ops
// Compute the state-file updates for one CHAPTER_COMMIT. Reads the current
// state from bookDir, returns [{path, content}] ops. Used both by the staged
// dry-run audit (pointed at a temp copy) and by the real commit, so the audit
// is an exact preview of the commit.

async function computeCommitOps(bookDirPath, chapter, contractFields, inputs) {
  const stateDir = path.join(bookDirPath, 'state');
  const progressText = await book.readFileIfExists(path.join(stateDir, 'progress.md'));
  const summaryText = await book.readFileIfExists(path.join(stateDir, 'summary.md'));
  const timelineText = await book.readFileIfExists(path.join(stateDir, 'timeline.md'));
  const ledgerText = await book.readFileIfExists(path.join(stateDir, 'foreshadowing.md'));
  const knowsText = await book.readFileIfExists(path.join(stateDir, 'knows.md'));
  if (progressText === null || summaryText === null || timelineText === null || ledgerText === null || knowsText === null) {
    throw new Error(
      'book is missing a state file (need state/progress.md, summary.md, timeline.md, foreshadowing.md, knows.md) — create the book from the skill templates first',
    );
  }
  if (!inputs.summary || !String(inputs.summary).trim()) throw new Error('commitChapter needs `summary` (one line for state/summary.md)');
  if (!inputs.timeline || !String(inputs.timeline).trim()) throw new Error('commitChapter needs `timeline` (one line for state/timeline.md)');

  const ops = [];
  const plantedIds = parseIdList(contractFields.foreshadowing_planted);
  const paidIds = inputs.foreshadowingPaid !== undefined ? inputs.foreshadowingPaid : parseIdList(contractFields.foreshadowing_paid);
  const ledger = book.parseLedger(ledgerText);
  const ledgerIds = new Set(ledger.map((t) => t.id));
  for (const id of paidIds) {
    if (!ledgerIds.has(id)) throw new Error(`contract pays off ${id}, but ${id} is not in state/foreshadowing.md — plant it first or fix the contract`);
  }
  const plant = [];
  for (const id of plantedIds) {
    const detail = (inputs.foreshadowingPlanted || []).find((p) => p.id === id);
    if (ledgerIds.has(id)) continue; // already in the ledger (e.g. re-commit after rollback)
    if (!detail || !detail.thread || !detail.payoffDue) {
      throw new Error(
        `contract plants ${id}, but no thread text / payoffDue was supplied — pass foreshadowingPlanted: [{id: "${id}", payoffDue: <chapter>, thread: "<what was planted>"}] (the server never invents thread text)`,
      );
    }
    plant.push({ id, planted: chapter, payoffDue: Number(detail.payoffDue), thread: String(detail.thread) });
  }
  const knowsEntries = inputs.knows || [];
  const characters = await book.bibleCharacters(bookDirPath);
  for (const k of knowsEntries) {
    if (!k.character || !k.entry) throw new Error('each knows entry needs {character, entry}');
    if (!characters.includes(k.character)) {
      throw new Error(`knows entry for character "${k.character}" — no "## ${k.character}" section in bible/characters.md`);
    }
  }

  ops.push({
    path: path.join(stateDir, 'progress.md'),
    content: book.updateProgress(progressText, { addCommitted: chapter, next: chapter + 1 }),
  });
  let summary = summaryText;
  const summaryLineRe = new RegExp(`^- Chapter ${chapter}:.*$`, 'm');
  const summaryLine = `- Chapter ${chapter}: ${String(inputs.summary).trim()}`;
  summary = summaryLineRe.test(summary) ? summary.replace(summaryLineRe, summaryLine) : summary.replace(/\s+$/, '') + `\n${summaryLine}\n`;
  summary = summary.replace(/\(chapters 1–\d+\)/, `(chapters 1–${chapter})`);
  ops.push({ path: path.join(stateDir, 'summary.md'), content: summary });
  let timeline = timelineText;
  const tlRe = new RegExp(`^- .*\\(chapter ${chapter}\\).*$`, 'm');
  const tlLine = `- ${String(inputs.timeline).trim()}`;
  timeline = tlRe.test(timeline) ? timeline.replace(tlRe, tlLine) : timeline.replace(/\s+$/, '') + `\n${tlLine}\n`;
  ops.push({ path: path.join(stateDir, 'timeline.md'), content: timeline });
  ops.push({
    path: path.join(stateDir, 'foreshadowing.md'),
    content: book.applyLedgerEdits(ledgerText, { markPaid: paidIds, plant }),
  });
  if (knowsEntries.length) {
    ops.push({
      path: path.join(stateDir, 'knows.md'),
      content: book.appendKnows(knowsText, knowsEntries, characters),
    });
  }
  return { ops, paidIds, planted: plant.map((p) => p.id) };
}

function describeChanges(chapter, { paidIds, planted }) {
  const changes = [`chapter ${chapter} committed (draft moved drafts/ → chapters/)`, `progress.md: committed ${chapter}, next chapter ${chapter + 1}`];
  if (paidIds.length) changes.push(`foreshadowing.md: ${paidIds.join(', ')} → paid`);
  if (planted.length) changes.push(`foreshadowing.md: planted ${planted.join(', ')}`);
  return changes;
}

// ---------------------------------------------------------------------- tools

const HARD_RULES_SHORT = [
  '1. Bible/outline first — no prose before Gate 1 approval.',
  '2. Golden 3 first — chapters 1-3 read and diagnosed before the serial commits.',
  '3. Chapter contract before prose — no contract, no prose.',
  '4. Hook + desire payoff is a blocking audit.',
  '5. Only redo the wrong segment; a revision rolls its committed state back first.',
  '6. Hard constraints first — a scene may not break a rule to save itself.',
  '7. Knows lists — a character never knows what they were never told.',
  '8. Foreshadowing ledger — every thread has a planted chapter, a payoff chapter and a status.',
  '9. File-as-truth — bible/outline/state/chapters on disk are the only truth.',
  '10. Rolling horizon — only the next arc is planned in detail.',
  '11. Hook handoff (blocking) — the next chapter contract must state how its opening resolves the previous chapter end hook.',
];

export function createNovelServer(config) {
  const { booksRoot, scansDir, python, skillRoot } = config;
  const server = new McpServer({ name: 'long-novel-mcp', version: '1.0.0' });

  server.registerTool(
    'listBooks',
    {
      title: 'List books',
      description:
        'List every book project under the books root. A book is a directory with bible/ + chapters/ (the skill layout). Returns id, title, chapter counts, committed chapters and next chapter. No book names are hard-coded; everything comes from the files.',
      inputSchema: {},
    },
    wrap(async () => {
      const ids = await book.listBookDirs(booksRoot);
      const out = [];
      for (const id of ids) {
        const dir = book.bookDir(booksRoot, id);
        const chapters = await book.listChapters(booksRoot, id);
        const progress = book.parseProgress((await book.readFileIfExists(path.join(dir, 'state', 'progress.md'))) || '');
        out.push({
          id,
          title: await book.deriveTitle(dir, id),
          path: dir,
          chapters: chapters.length,
          committed: progress.committed,
          nextChapter: progress.next ?? (chapters.length ? Math.max(...chapters.map((c) => c.chapter)) + 1 : 1),
          chapterList: chapters,
        });
      }
      return ok({ books: out, booksRoot });
    }),
  );

  server.registerTool(
    'getBook',
    {
      title: 'Get a book',
      description:
        'Read one book project: bible, outline, state files and the chapter list with per-chapter status (committed / draft / contract-only / missing). Returns file contents, so the host model can work from them.',
      inputSchema: { book: z.string().describe('Book id (directory name under the books root)') },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const [bible, outline, state] = await Promise.all([
        readDirFiles(path.join(dir, 'bible')),
        readDirFiles(path.join(dir, 'outline')),
        readDirFiles(path.join(dir, 'state')),
      ]);
      const chapters = await book.listChapters(booksRoot, id);
      return ok({
        id,
        title: await book.deriveTitle(dir, id),
        path: dir,
        bible,
        outline,
        state,
        chapters,
      });
    }),
  );

  server.registerTool(
    'getChapter',
    {
      title: 'Get a chapter',
      description:
        'Read one chapter: contract fields, prose and status. Status is explicit: "committed" (in chapters/, canon), "draft" (in drafts/, not canon), "contract-only" (only a contract exists, no prose yet) or "missing". Also returns the previous chapter end hook, which the next contract must resolve (hard rule 11).',
      inputSchema: {
        book: z.string(),
        chapter: z.number().int().min(1).max(9999),
      },
    },
    wrap(async ({ book: id, chapter }) => {
      const n = book.assertChapter(chapter);
      await loadBookDir(booksRoot, id);
      const loaded = await book.loadChapter(booksRoot, id, n);
      let previousHook = '';
      if (n > 1) {
        const prev = await book.loadChapter(booksRoot, id, n - 1);
        previousHook = prev.fields.hook || '';
      }
      return ok({
        book: id,
        chapter: n,
        status: loaded.status,
        source: loaded.source,
        fields: loaded.fields,
        prose: loaded.prose,
        previousHook,
        nextChapter: n + 1,
      });
    }),
  );

  const contractShape = {
    book: z.string(),
    chapter: z.number().int().min(1).max(9999),
    title: z.string().optional(),
    language: z.enum(['zh', 'en']).optional(),
    desire: z.string().optional(),
    desirePayoff: z.string().optional(),
    payoffSize: z.enum(['small', 'big']).optional(),
    hook: z.string().optional(),
    hookHandoff: z.string().optional(),
    transition: z.string().optional(),
    mustHappen: z.string().optional(),
    mustNot: z.string().optional(),
    characters: z.union([z.string(), z.array(z.string())]).optional(),
    foreshadowingPlanted: z.union([z.string(), z.array(z.string())]).optional(),
    foreshadowingPaid: z.union([z.string(), z.array(z.string())]).optional(),
  };

  server.registerTool(
    'draftContract',
    {
      title: 'Draft a chapter contract',
      description:
        'Create or update a chapter contract (outline/chapters/NNN.md). No contract, no prose (hard rule 3). The contract is validated the same way scripts/check_chapter.py and check_hooks.py validate it. Hard rule 11 (Hook handoff, blocking): if the previous chapter ends on a hook, the contract MUST include hookHandoff — how this chapter opening resolves that hook (paid off, carried, or explicitly deferred with a payoff chapter). A "cut" transition does not excuse dropping the previous hook. Fields not supplied keep their previous value when a contract already exists.',
      inputSchema: contractShape,
    },
    wrap(async (input) => {
      const n = book.assertChapter(input.chapter);
      const dir = await loadBookDir(booksRoot, input.book);
      const contractPath = path.join(dir, 'outline', 'chapters', book.chapterFile(n));
      const existing = (await book.readFileIfExists(contractPath)) || '';
      const fields = { ...book.parseFrontmatterFile(existing).fields, ...contractInputToFields(input) };
      fields.chapter = String(n);
      const errors = validateContractFields(fields, n);
      if (errors.length) throw new Error(`contract invalid:\n- ${errors.join('\n- ')}`);
      if (n > 1) {
        const prev = await book.loadChapter(booksRoot, input.book, n - 1);
        if (prev.fields.hook && !fields.hook_handoff) {
          throw new Error(
            `hard rule 11 (Hook handoff, blocking): chapter ${n - 1} ends on the hook "${prev.fields.hook}". ` +
              `This contract must state hookHandoff — how chapter ${n} opening resolves it (paid off, carried, or explicitly deferred with a payoff chapter). A "cut" transition does not excuse dropping it.`,
          );
        }
      }
      await book.writeFilesAtomic([
        { path: contractPath, content: book.serializeFrontmatterFile(fields, '') },
      ]);
      return ok({ book: input.book, chapter: n, status: 'contract', path: contractPath, fields });
    }),
  );

  server.registerTool(
    'saveChapterDraft',
    {
      title: 'Save a chapter draft',
      description:
        'Save chapter prose as a DRAFT (drafts/NNN.md). A draft is never canon: it does not enter chapters/ or state/ until commitChapter, and the deterministic audit will not pass on it until then. A contract must exist first (draftContract) or be supplied with this call. Prose quality (length, AI-flavour phrases) is reported as warnings here — the audit is the gate, not the save. Never invents or edits canon.',
      inputSchema: { ...contractShape, prose: z.string() },
    },
    wrap(async (input) => {
      const n = book.assertChapter(input.chapter);
      const dir = await loadBookDir(booksRoot, input.book);
      const contractPath = path.join(dir, 'outline', 'chapters', book.chapterFile(n));
      const stored = book.parseFrontmatterFile((await book.readFileIfExists(contractPath)) || '').fields;
      const fields = { ...stored, ...contractInputToFields(input) };
      fields.chapter = String(n);
      const errors = validateContractFields(fields, n);
      if (errors.length) throw new Error(`contract invalid (create it with draftContract first):\n- ${errors.join('\n- ')}`);
      if (n > 1 && !fields.hook_handoff) {
        const prev = await book.loadChapter(booksRoot, input.book, n - 1);
        if (prev.fields.hook) {
          throw new Error(
            `hard rule 11 (Hook handoff, blocking): chapter ${n - 1} ends on the hook "${prev.fields.hook}". ` +
              `The contract must state hookHandoff — how this chapter opening resolves it.`,
          );
        }
      }
      const language = fields.language || 'zh';
      const slop = await loadSlopPhrases(skillRoot, language);
      const warnings = proseWarnings(input.prose, language, slop);
      const draftPath = path.join(dir, 'drafts', book.chapterFile(n));
      await book.writeFilesAtomic([
        { path: draftPath, content: book.serializeFrontmatterFile(fields, input.prose) },
        // keep the stored contract in sync with the frontmatter actually used
        { path: contractPath, content: book.serializeFrontmatterFile(fields, '') },
      ]);
      return ok({ book: input.book, chapter: n, status: 'draft', path: draftPath, warnings });
    }),
  );

  const commitInputsShape = {
    summary: z.string().optional(),
    timeline: z.string().optional(),
    knows: z.array(z.object({ character: z.string(), entry: z.string() })).optional(),
    foreshadowingPaid: z.array(z.string()).optional(),
    foreshadowingPlanted: z
      .array(z.object({ id: z.string(), payoffDue: z.number().int(), thread: z.string() }))
      .optional(),
  };

  server.registerTool(
    'auditChapter',
    {
      title: 'Audit a chapter (deterministic)',
      description:
        'Run the repo deterministic checks (scripts/check_chapter.py, check_continuity.py, check_hooks.py) against one chapter. The draft is staged into a temp copy, so canon is never touched. Pass the same summary/timeline/knows/foreshadowing inputs you intend to commit with, and the audit becomes an exact dry run of commitChapter. Without them, the three known pre-commit states (chapter not yet in progress.md; a thread it pays still showing open in the ledger; a thread it plants still missing from the ledger) are reported as notes, not failures. Also returns the 8-dimension audit criteria (checklists/chapter_audit.md) so the host model can do the judgment pass on top — the scripts are the floor, not the verdict.',
      inputSchema: { book: z.string(), chapter: z.number().int().min(1).max(9999), ...commitInputsShape },
    },
    wrap(async (input) => {
      const n = book.assertChapter(input.chapter);
      const dir = await loadBookDir(booksRoot, input.book);
      const loaded = await book.loadChapter(booksRoot, input.book, n);
      if (loaded.status === 'missing' || loaded.status === 'contract-only') {
        throw new Error(`chapter ${n} has no prose yet (status: ${loaded.status}) — save a draft first`);
      }
      const hasCommitInputs = input.summary !== undefined || input.timeline !== undefined;
      const applyCommitState = hasCommitInputs
        ? async (tmpDir) => {
            const { ops } = await computeCommitOps(tmpDir, n, loaded.fields, input);
            await book.writeFilesAtomic(ops);
          }
        : undefined;
      const audit = await auditDraft({
        python,
        skillRoot,
        bookDir: dir,
        chapter: n,
        applyCommitState,
      });
      const criteria = await book.readFileIfExists(path.join(skillRoot, 'checklists', 'chapter_audit.md'));
      return ok({
        book: input.book,
        chapter: n,
        status: loaded.status,
        dryRun: hasCommitInputs,
        pass: audit.pass,
        checks: audit.results,
        notes: audit.notes,
        auditCriteria8Dimensions: criteria || '(checklists/chapter_audit.md not found)',
      });
    }),
  );

  server.registerTool(
    'commitChapter',
    {
      title: 'Commit a chapter (atomic, blocking audit)',
      description:
        'Atomically commit a draft chapter (CHAPTER_COMMIT): the draft moves drafts/ → chapters/ and its facts enter state/ (progress, summary, timeline, foreshadowing ledger, knows) in the same step, or nothing changes. The deterministic audit runs first as a dry run — if it fails, the commit is REFUSED with the failures listed. The author must have approved the chapter (proposal-inbox model); the server enforces the audit, not the approval. summary and timeline are required (one line each, written by the host — the server never invents them). Threads the contract plants need foreshadowingPlanted entries with thread text and payoffDue; threads it pays off are marked paid.',
      inputSchema: {
        book: z.string(),
        chapter: z.number().int().min(1).max(9999),
        summary: z.string(),
        timeline: z.string(),
        knows: commitInputsShape.knows,
        foreshadowingPaid: commitInputsShape.foreshadowingPaid,
        foreshadowingPlanted: commitInputsShape.foreshadowingPlanted,
      },
    },
    wrap(async (input) => {
      const n = book.assertChapter(input.chapter);
      const dir = await loadBookDir(booksRoot, input.book);
      const loaded = await book.loadChapter(booksRoot, input.book, n);
      if (loaded.status === 'committed') throw new Error(`chapter ${n} is already committed — roll it back first if it needs revision`);
      if (loaded.status !== 'draft') throw new Error(`chapter ${n} has no draft prose (status: ${loaded.status}) — save a draft first`);
      const draftPath = path.join(dir, 'drafts', book.chapterFile(n));
      const draftText = await fs.readFile(draftPath, 'utf8');
      const applyCommitState = async (tmpDir) => {
        const { ops } = await computeCommitOps(tmpDir, n, loaded.fields, input);
        await book.writeFilesAtomic(ops);
      };
      const audit = await auditDraft({ python, skillRoot, bookDir: dir, chapter: n, applyCommitState });
      if (!audit.pass) {
        const failures = audit.results.flatMap((r) => r.failures.map((f) => `${r.script}: ${f}`));
        throw new Error(`commit REFUSED — deterministic audit failed:\n- ${failures.join('\n- ')}`);
      }
      const { ops, paidIds, planted } = await computeCommitOps(dir, n, loaded.fields, input);
      ops.push({ path: path.join(dir, 'chapters', book.chapterFile(n)), content: draftText });
      await book.writeFilesAtomic(ops);
      await fs.unlink(draftPath).catch(() => {});
      return ok({
        book: input.book,
        chapter: n,
        committed: true,
        changes: describeChanges(n, { paidIds, planted }),
        auditNotes: audit.notes,
      });
    }),
  );

  server.registerTool(
    'rollbackChapter',
    {
      title: 'Roll back a committed chapter',
      description:
        'Remove one chapter committed facts and return it to draft: the chapter file moves chapters/ → drafts/, its progress/summary/timeline entries are removed, threads it paid off return to open, threads it planted are removed from the ledger, and knows lines learned in that chapter are removed. Used before revising a committed chapter (hard rule 5: the ledger must never carry wrong facts). Reports exactly what was removed.',
      inputSchema: { book: z.string(), chapter: z.number().int().min(1).max(9999) },
    },
    wrap(async ({ book: id, chapter }) => {
      const n = book.assertChapter(chapter);
      const dir = await loadBookDir(booksRoot, id);
      const loaded = await book.loadChapter(booksRoot, id, n);
      if (loaded.status !== 'committed') throw new Error(`chapter ${n} is not committed (status: ${loaded.status}) — nothing to roll back`);
      const chapterPath = path.join(dir, 'chapters', book.chapterFile(n));
      const chapterText = await fs.readFile(chapterPath, 'utf8');
      const stateDir = path.join(dir, 'state');
      const ops = [];
      const removed = [];
      const progressText = await book.readFileIfExists(path.join(stateDir, 'progress.md'));
      if (progressText !== null) {
        const updated = book.removeProgressEntry(progressText, n, n);
        if (updated !== progressText) {
          ops.push({ path: path.join(stateDir, 'progress.md'), content: updated });
          removed.push(`progress.md: removed committed ${n}, next chapter set back to ${n}`);
        }
      }
      const summaryText = await book.readFileIfExists(path.join(stateDir, 'summary.md'));
      if (summaryText !== null) {
        const updated = summaryText
          .split('\n')
          .filter((l) => !new RegExp(`^- Chapter ${n}:`).test(l))
          .join('\n');
        if (updated !== summaryText) {
          ops.push({ path: path.join(stateDir, 'summary.md'), content: updated });
          removed.push(`summary.md: removed Chapter ${n} line`);
        }
      }
      const timelineText = await book.readFileIfExists(path.join(stateDir, 'timeline.md'));
      if (timelineText !== null) {
        const updated = timelineText
          .split('\n')
          .filter((l) => !l.includes(`(chapter ${n})`))
          .join('\n');
        if (updated !== timelineText) {
          ops.push({ path: path.join(stateDir, 'timeline.md'), content: updated });
          removed.push(`timeline.md: removed chapter ${n} entries`);
        }
      }
      const ledgerText = await book.readFileIfExists(path.join(stateDir, 'foreshadowing.md'));
      if (ledgerText !== null) {
        const paidIds = parseIdList(loaded.fields.foreshadowing_paid);
        const updated = book.applyLedgerEdits(ledgerText, { reopen: paidIds, removePlantedByChapter: n });
        if (updated !== ledgerText) {
          ops.push({ path: path.join(stateDir, 'foreshadowing.md'), content: updated });
          if (paidIds.length) removed.push(`foreshadowing.md: ${paidIds.join(', ')} reopened`);
          removed.push('foreshadowing.md: threads planted by this chapter removed');
        }
      }
      const knowsText = await book.readFileIfExists(path.join(stateDir, 'knows.md'));
      if (knowsText !== null) {
        const updated = book.removeKnowsForChapter(knowsText, n);
        if (updated !== knowsText) {
          ops.push({ path: path.join(stateDir, 'knows.md'), content: updated });
          removed.push(`knows.md: removed lines learned in chapter ${n}`);
        }
      }
      ops.push({ path: path.join(dir, 'drafts', book.chapterFile(n)), content: chapterText });
      await book.writeFilesAtomic(ops);
      await fs.unlink(chapterPath).catch(() => {});
      return ok({ book: id, chapter: n, status: 'draft', removed });
    }),
  );

  server.registerTool(
    'listForeshadowing',
    {
      title: 'List foreshadowing threads',
      description:
        'List the foreshadowing ledger (state/foreshadowing.md) with a computed state per thread: overdue (open/past payoff chapter), due-soon (payoff within 3 chapters), stale-30 (open for 30+ chapters — the skill hard flag). Current chapter is the highest committed chapter.',
      inputSchema: { book: z.string() },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const ledgerText = (await book.readFileIfExists(path.join(dir, 'state', 'foreshadowing.md'))) || '';
      const threads = book.parseLedger(ledgerText);
      const progress = book.parseProgress((await book.readFileIfExists(path.join(dir, 'state', 'progress.md'))) || '');
      const current = progress.committed.length ? Math.max(...progress.committed) : 0;
      return ok({
        book: id,
        currentChapter: current,
        threads: threads.map((t) => ({
          ...t,
          overdue: (t.status === 'open' || t.status === 'progressing') && t.payoffDue !== null && t.payoffDue <= current,
          dueSoon:
            (t.status === 'open' || t.status === 'progressing') &&
            t.payoffDue !== null &&
            t.payoffDue > current &&
            t.payoffDue - current <= 3,
          stale30: t.status === 'open' && current - t.planted >= 30,
        })),
      });
    }),
  );

  server.registerTool(
    'markForeshadowingPaid',
    {
      title: 'Mark a thread paid',
      description:
        'Remediation path: mark a ledger thread paid (state/foreshadowing.md). Normal payoff goes through commitChapter, which marks the thread paid in the same step; use this when a payoff was written but the ledger was never updated (e.g. an older commit missed it). The chapter that paid it off must exist.',
      inputSchema: { book: z.string(), id: z.string(), chapter: z.number().int().min(1).max(9999) },
    },
    wrap(async ({ book: id, id: threadId, chapter }) => {
      const dir = await loadBookDir(booksRoot, id);
      const loaded = await book.loadChapter(booksRoot, id, book.assertChapter(chapter));
      if (loaded.status === 'missing') throw new Error(`chapter ${chapter} does not exist`);
      const ledgerPath = path.join(dir, 'state', 'foreshadowing.md');
      const ledgerText = await book.readFileIfExists(ledgerPath);
      if (ledgerText === null) throw new Error('state/foreshadowing.md not found');
      if (!book.parseLedger(ledgerText).some((t) => t.id === threadId)) {
        throw new Error(`thread ${threadId} is not in the ledger`);
      }
      await book.writeFilesAtomic([{ path: ledgerPath, content: book.applyLedgerEdits(ledgerText, { markPaid: [threadId] }) }]);
      return ok({ book: id, thread: threadId, status: 'paid', paidInChapter: chapter });
    }),
  );

  server.registerTool(
    'extendForeshadowing',
    {
      title: 'Extend a thread payoff date',
      description:
        'Remediation path: move a ledger thread payoff_due to a later chapter. Per the skill template, deferring a thread needs author approval — the host must have it before calling this; the server only records the new date.',
      inputSchema: { book: z.string(), id: z.string(), payoffDue: z.number().int().min(1).max(9999) },
    },
    wrap(async ({ book: id, id: threadId, payoffDue }) => {
      const dir = await loadBookDir(booksRoot, id);
      const ledgerPath = path.join(dir, 'state', 'foreshadowing.md');
      const ledgerText = await book.readFileIfExists(ledgerPath);
      if (ledgerText === null) throw new Error('state/foreshadowing.md not found');
      const thread = book.parseLedger(ledgerText).find((t) => t.id === threadId);
      if (!thread) throw new Error(`thread ${threadId} is not in the ledger`);
      await book.writeFilesAtomic([
        { path: ledgerPath, content: book.applyLedgerEdits(ledgerText, { extend: [{ id: threadId, payoffDue }] }) },
      ]);
      return ok({ book: id, thread: threadId, payoffDueWas: thread.payoffDue, payoffDue });
    }),
  );

  server.registerTool(
    'scheduleForeshadowingPayoff',
    {
      title: 'Schedule a thread payoff into a chapter',
      description:
        'Remediation path: declare a ledger thread as paid off by a future chapter — writes it into that chapter contract (outline/chapters/NNN.md, creating a stub contract if none exists). The host must still fill the contract (draftContract) and write the chapter; the payoff only becomes real when that chapter is committed.',
      inputSchema: { book: z.string(), id: z.string(), chapter: z.number().int().min(1).max(9999) },
    },
    wrap(async ({ book: id, id: threadId, chapter }) => {
      const n = book.assertChapter(chapter);
      const dir = await loadBookDir(booksRoot, id);
      const ledgerText = (await book.readFileIfExists(path.join(dir, 'state', 'foreshadowing.md'))) || '';
      const thread = book.parseLedger(ledgerText).find((t) => t.id === threadId);
      if (!thread) throw new Error(`thread ${threadId} is not in the ledger`);
      if (thread.status === 'paid') throw new Error(`thread ${threadId} is already paid`);
      const contractPath = path.join(dir, 'outline', 'chapters', book.chapterFile(n));
      const existing = book.parseFrontmatterFile((await book.readFileIfExists(contractPath)) || '').fields;
      const paid = [...new Set([...parseIdList(existing.foreshadowing_paid), threadId])];
      const fields = { ...existing, chapter: String(n), foreshadowing_paid: paid.join(', ') };
      if (!existing.language) fields.language = 'zh';
      const body = existing && Object.keys(existing).length ? '' : 'STUB — created by scheduleForeshadowingPayoff. Fill the remaining contract fields with draftContract before drafting prose.\n';
      await book.writeFilesAtomic([{ path: contractPath, content: book.serializeFrontmatterFile(fields, body) }]);
      return ok({ book: id, thread: threadId, scheduledInChapter: n, contract: contractPath });
    }),
  );

  server.registerTool(
    'marketScan',
    {
      title: 'Latest market scan (weekly report)',
      description:
        'Return the latest market-scan file from the scans directory (newest first; a weekly-report deconstruction, e.g. a Fanqie novel weekly report). If no scan file exists, says so honestly and explains how to add one — the server never fabricates chart numbers. Scan files are plain text the host (or the user) drops into the scans directory.',
      inputSchema: { platform: z.string().optional() },
    },
    wrap(async ({ platform }) => {
      await fs.mkdir(scansDir, { recursive: true });
      const files = (await fs.readdir(scansDir)).filter((f) => /\.(md|txt|json)$/i.test(f));
      const withTime = [];
      for (const f of files) {
        const st = await fs.stat(path.join(scansDir, f));
        withTime.push({ file: f, mtime: st.mtime.toISOString() });
      }
      withTime.sort((a, b) => b.mtime.localeCompare(a.mtime));
      const filtered = platform ? withTime.filter((f) => f.file.toLowerCase().includes(platform.toLowerCase())) : withTime;
      if (!filtered.length) {
        return ok({
          found: false,
          scansDir,
          available: withTime.map((f) => f.file),
          message:
            'No market-scan file found' +
            (platform ? ` for platform "${platform}"` : '') +
            `. Add one by saving a weekly-report deconstruction (e.g. the Fanqie novel weekly report) as a .md/.txt/.json file in ${scansDir} — the host model can fetch the latest weekly report and save it there. The server never invents chart numbers.`,
        });
      }
      const newest = filtered[0];
      const content = await fs.readFile(path.join(scansDir, newest.file), 'utf8');
      const capped = content.length > 20000 ? content.slice(0, 20000) + `\n\n[... truncated: ${content.length - 20000} more characters in the file]` : content;
      return ok({ found: true, file: newest.file, updatedAt: newest.mtime, content: capped, available: withTime.map((f) => f.file) });
    }),
  );

  server.registerTool(
    'getWorkflow',
    {
      title: 'Get the workflow rules',
      description:
        'Return the long-novel-workflow rules the host model must follow: hard rules, the 6-step workflow, gates, the 8-dimension audit criteria, and the full SKILL.md text. Load this first when a host has not installed the skill.',
      inputSchema: {},
    },
    wrap(async () => {
      const skillText = await fs.readFile(path.join(skillRoot, 'SKILL.md'), 'utf8').catch(() => '');
      const auditCriteria = await book.readFileIfExists(path.join(skillRoot, 'checklists', 'chapter_audit.md'));
      return ok({
        name: 'long-novel-workflow',
        version: '1.0.0',
        bookLayout: 'bible/ (canon, characters, world, rules, voice), outline/ (overview, chapters/NNN.md contracts), state/ (summary, character_state, foreshadowing, knows, progress, timeline), chapters/ (NNN.md, committed only), drafts/ (NNN.md, uncommitted drafts)',
        gates: ['Gate 1: bible + outline approved before any prose', 'Gate 2: golden 3 chapters read before the serial commits', 'Gate 3 per chapter: contract → draft → audit → bounded revise → CHAPTER_COMMIT (author approval)'],
        hardRules: HARD_RULES_SHORT,
        steps: ['Step 0 market scan', 'Step 1 bible + outline', 'Step 2 golden 3 chapters', 'Step 3 chapter loop (contract → draft → sub-review → bounded revise → commit)', 'Step 4 arc review every 30 chapters', 'Step 5 import an existing manuscript'],
        auditCriteria8Dimensions: auditCriteria || '(checklists/chapter_audit.md not found)',
        skillText,
      });
    }),
  );

  return server;
}
