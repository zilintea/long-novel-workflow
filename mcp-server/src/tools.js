// Tool handlers for the long-novel-workflow MCP server.
// The host model does all writing and prose judgment. The server only
// manages state (files) and runs the repo's deterministic Python checks.
// It never calls any model API and never invents book data.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as book from './book.js';
import { auditDraft, runChecks, runScript } from './audit.js';
import { writeSubmission } from './userSubmission.js';
import {
  bigCadenceFor,
  effectiveTolerance,
  getPhaseInfo,
  isShortMode,
  isShortWordMode,
  nearEndWarningThreshold,
} from './phase.js';

const DESIRES = [
  'curiosity',
  'identification-upgrade',
  'revenge-compensation',
  'being-loved',
  'escape-comfort',
  'survival-breakout',
  'power-scheme',
  'bond-resonance',
];
const DESIRE_ZH = {
  好奇: 'curiosity',
  代入升级: 'identification-upgrade',
  复仇补偿: 'revenge-compensation',
  被爱拉扯: 'being-loved',
  逃逸安慰: 'escape-comfort',
  求生破局: 'survival-breakout',
  博弈掌权: 'power-scheme',
  羁绊共鸣: 'bond-resonance',
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
    chapterKind: 'chapter_kind',
  };
  for (const [inkey, outkey] of Object.entries(map)) {
    if (input[inkey] !== undefined && input[inkey] !== null && input[inkey] !== '') f[outkey] = String(input[inkey]);
  }
  if (input.isProbe !== undefined) f.is_probe = input.isProbe ? 'true' : 'false';
  if (input.characters !== undefined) {
    f.characters = Array.isArray(input.characters) ? input.characters.join(', ') : String(input.characters);
  }
  if (input.foreshadowingPlanted !== undefined) f.foreshadowing_planted = normalizeIdList(input.foreshadowingPlanted);
  if (input.foreshadowingPaid !== undefined) f.foreshadowing_paid = normalizeIdList(input.foreshadowingPaid);
  return f;
}

// Validate contract fields the same way scripts/check_chapter.py and
// scripts/check_hooks.py do (same rules, same messages where possible).
// Cadence is dynamic (manual §六.1): the big cadence comes from the book's
// target chapters; committed chapters check against their snapshot;
// epilogue/extra chapters skip cadence entirely.
function validateContractFields(f, chapter, compass = {}) {
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
  if (f.desire && f.desire !== 'auto') {
    const d = DESIRE_ZH[f.desire] || f.desire;
    if (!DESIRES.includes(d)) errors.push(`unknown desire \`${f.desire}\` (want auto or one of ${DESIRES.join(', ')})`);
  }
  if (f.chapter_kind && !['main', 'epilogue', 'extra'].includes(f.chapter_kind)) {
    errors.push(`unknown chapter_kind \`${f.chapter_kind}\` (want main | epilogue | extra)`);
  }
  if (f.payoff_size && f.payoff_size !== 'auto' && (f.chapter_kind || 'main') === 'main') {
    const target = compass.targetChapters ?? null;
    const cadence = bigCadenceFor(target);
    const snapshot = f.big_cadence_snapshot && /^\d+$/.test(String(f.big_cadence_snapshot))
      ? Number(f.big_cadence_snapshot)
      : null;
    const effectiveCadence = snapshot ?? cadence;
    if (effectiveCadence !== null && chapter % effectiveCadence === 0 && f.payoff_size !== 'big') {
      errors.push(`chapter ${chapter} is a big-payoff chapter (multiple of ${effectiveCadence}) — payoff_size must be auto or big`);
    }
    const relax3 = (target !== null && target < 10) || compass.targetWords !== null;
    if (!snapshot && !relax3 && chapter % 3 === 0 && !['small', 'big'].includes(f.payoff_size)) {
      errors.push(`chapter ${chapter} is a payoff chapter (multiple of 3) — declare payoff_size auto|small|big`);
    }
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

// Prose size warnings (manual §六.2, same floors as the TS audit and
// check_chapter.py). Below the probe floor the audit will fail; below the
// serial floor is a warning; above the max is a warning, never blocking.
// Epilogue/extra chapters skip the size checks (empty prose still fails).
function proseWarnings(prose, language, slopPhrases, opts = {}) {
  const warnings = [];
  const kind = opts.chapterKind || 'main';
  const isProbe = !!opts.isProbe;
  const shortMode = language === 'zh' && isShortWordMode(opts.targetChapters ?? null, opts.targetWords ?? null);
  if (language === 'zh') {
    const size = prose.replace(/\s+/g, '').length;
    const serialFloor = shortMode ? 1500 : 2100;
    if (size === 0) warnings.push('prose is empty — the audit will fail');
    else if (kind === 'main') {
      if (size < 800) warnings.push(`prose is ${size} chars (below the probe floor of 800) — the audit will fail`);
      else if (size < (isProbe ? 800 : serialFloor)) warnings.push(`prose is ${size} chars, below the serial floor of ${isProbe ? 800 : serialFloor} (ok for a probe — set isProbe)`);
      else if (size > 4000) warnings.push(`prose is ${size} chars, above the suggested max of 4000 (consider trimming or splitting)`);
    }
  } else {
    const size = (prose.match(/[A-Za-z']+/g) || []).length;
    if (size === 0) warnings.push('prose is empty — the audit will fail');
    else if (kind === 'main') {
      if (size < 600) warnings.push(`prose is ${size} words (below the probe floor of 600) — the audit will fail`);
      else if (size < (isProbe ? 600 : 1500)) warnings.push(`prose is ${size} words, below the serial floor of ${isProbe ? 600 : 1500} (ok for a probe — set isProbe)`);
      else if (size > 2500) warnings.push(`prose is ${size} words, above the suggested max of 2500 (consider trimming or splitting)`);
    }
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

// Read the ending-plan compass from outline/overview.md (nulls when absent —
// an old book without a target). Used by cadence validation, phase info,
// retargeting and the sequel seed.
async function loadCompass(dir) {
  const text = (await book.readFileIfExists(path.join(dir, 'outline', 'overview.md'))) || '';
  return { ...book.parseCompass(text), plannedEnding: book.extractPlannedEnding(text) };
}

// Big-cadence snapshot for a chapter committed now (manual §六.1): the current
// dynamic cadence, or '' when the book skips big cadence (T < 30).
function snapshotFor(compass) {
  const cad = bigCadenceFor(compass.targetChapters ?? null);
  return cad === null ? '' : String(cad);
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
    plant.push({ id, planted: chapter, payoffDue: Number(detail.payoffDue), thread: String(detail.thread), scope: detail.scope || 'series', kind: detail.kind || 'other' });
  }
  const newCharacters = Array.isArray(inputs.newCharacters) ? inputs.newCharacters : [];
  const bibleCharPath = path.join(bookDirPath, 'bible', 'characters.md');
  const bibleCharText = (await book.readFileIfExists(bibleCharPath)) || '# Characters\n';
  const existingChars = await book.bibleCharacters(bookDirPath);
  const addedCharNames = [];
  if (newCharacters.length) {
    const updatedCharsText = book.appendBibleCharacters(bibleCharText, newCharacters, chapter);
    if (updatedCharsText !== bibleCharText) {
      ops.push({ path: bibleCharPath, content: updatedCharsText });
    }
    for (const c of newCharacters) {
      const name = String(c.name || '').trim();
      if (name && !existingChars.includes(name)) addedCharNames.push(name);
    }
  }
  const characters = [...new Set([...existingChars, ...addedCharNames])];
  const knowsEntries = [...(inputs.knows || [])];
  for (const c of newCharacters) {
    const name = String(c.name || '').trim();
    if (name && c.initialKnows && !knowsEntries.some((k) => k.character === name)) {
      knowsEntries.push({ character: name, entry: `${c.initialKnows} (chapter ${chapter} — introduced)` });
    } else if (name && addedCharNames.includes(name) && !knowsEntries.some((k) => k.character === name)) {
      knowsEntries.push({ character: name, entry: `Introduced in chapter ${chapter}` });
    }
  }
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
      content: book.appendKnows(knowsText, knowsEntries, characters, chapter),
    });
  }
  return { ops, paidIds, planted: plant.map((p) => p.id), addedCharNames };
}

function describeChanges(chapter, { paidIds, planted, addedCharNames }) {
  const changes = [`chapter ${chapter} committed (draft moved drafts/ → chapters/)`, `progress.md: committed ${chapter}, next chapter ${chapter + 1}`];
  if (paidIds.length) changes.push(`foreshadowing.md: ${paidIds.join(', ')} → paid`);
  if (planted.length) changes.push(`foreshadowing.md: planted ${planted.join(', ')}`);
  if (addedCharNames && addedCharNames.length) changes.push(`bible/characters.md: registered ${addedCharNames.join(', ')}`);
  return changes;
}

// ---------------------------------------------------------------------- tools

const HARD_RULES_SHORT = [
  '1. Bible/outline first — no prose before Gate 1 approval (or full-auto Step 1).',
  '2. Golden 3 first — chapters 1-3 read and diagnosed before bulk serialising.',
  '3. Chapter contract before prose — no contract, no prose.',
  '4. Hook + desire payoff is a blocking audit (8 desires or auto).',
  '5. Only redo the wrong segment; a revision rolls its committed state back first.',
  '6. Hard constraints first — a scene may not break a rule to save itself.',
  '7. Knows lists — a character never knows what they were never told.',
  '8. Foreshadowing ledger — every thread has planted, payoff_due, status (open|progressing|paid|deferred|archived) and scope/kind; payoff_due past the end window (T + tolerance) is blocking.',
  '9. File-as-truth — bible/outline/state/chapters on disk are the only truth.',
  '10. Rolling horizon — only the next arc is planned in detail.',
  '11. Hook handoff (blocking) — the next chapter contract must state how its opening resolves the previous chapter end hook.',
  '12. Dynamic cast — avoid solo-protagonist monologues or nameless placeholders; register new characters atomically.',
  '13. Ending plan & blind writing — the compass sets a target (default 100 chapters, floating ±tolerance) and a director-only 3-beat planned ending; contracts see at most the one-sentence ending summary, prose sees neither (only the contract + one-line phase instruction).',
  '14. Gate 3 is the completion audit — nothing auto-completes; only the author explicit confirmation flips a book to completed.',
  '15. User-driven lock — in user-driven mode, author-supplied fields (source: user) are locked: chapter title/order, must_happen beats, hook, character names, foreshadowing payoff chapters. No prose before validateSubmission passes; no commit before checkFidelity passes.',
  '16. Restatement gate, gap classes, versioning, contract check — after validation the AI restates the outline back (must-ask gaps answered by the author, ai-may-fill filled by the AI and flagged); outline revisions are snapshotted and diffed first (impact list, committed prose never auto-changed); contract and prose frontmatter must agree and the next contract must state its hook handoff.',
];

export function createNovelServer(config) {
  const { booksRoot, scansDir, python, skillRoot } = config;
  const server = new McpServer({ name: 'long-novel-mcp', version: '2.4.0' });

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
        'Read one book project: bible, outline, state files and the chapter list with per-chapter status (committed / draft / contract-only / missing). Returns file contents, so the host model can work from them. Blind-writing rule (manual §四): the full planned ending is NEVER returned here — outline/overview.md is served with the `## Planned ending (director-only)` section removed. Use getEndingPlan only when drafting the bible, running an arc review, or doing the Gate 3 completion audit. Also returns the parsed ending-plan compass (target chapters, tolerance, ending summary, book status) and the phase info for the next chapter.',
      inputSchema: { book: z.string().describe('Book id (directory name under the books root)') },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const [bible, outline, state] = await Promise.all([
        readDirFiles(path.join(dir, 'bible')),
        readDirFiles(path.join(dir, 'outline')),
        readDirFiles(path.join(dir, 'state')),
      ]);
      if (outline['overview.md']) outline['overview.md'] = book.redactPlannedEnding(outline['overview.md']);
      const chapters = await book.listChapters(booksRoot, id);
      const compass = await loadCompass(dir);
      const committedMain = chapters
        .filter((c) => c.status === 'committed')
        .map((c) => c.chapter);
      const nextChapter = committedMain.length ? Math.max(...committedMain) + 1 : 1;
      const phase = getPhaseInfo(nextChapter, 1, compass.targetChapters ?? null, compass.tolerance ?? undefined);
      return ok({
        id,
        title: await book.deriveTitle(dir, id),
        path: dir,
        bible,
        outline,
        state,
        chapters,
        compass: {
          targetChapters: compass.targetChapters,
          targetWords: compass.targetWords,
          tolerance: compass.tolerance,
          bookStatus: compass.bookStatus,
          endingSummary: compass.endingSummary,
        },
        nextChapter,
        phase,
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
    payoffSize: z.enum(['auto', 'small', 'big']).optional(),
    hook: z.string().optional(),
    hookHandoff: z.string().optional(),
    transition: z.string().optional(),
    mustHappen: z.string().optional(),
    mustNot: z.string().optional(),
    characters: z.union([z.string(), z.array(z.string())]).optional(),
    foreshadowingPlanted: z.union([z.string(), z.array(z.string())]).optional(),
    foreshadowingPaid: z.union([z.string(), z.array(z.string())]).optional(),
    chapterKind: z.enum(['main', 'epilogue', 'extra']).optional(),
    isProbe: z.boolean().optional(),
  };

  server.registerTool(
    'draftContract',
    {
      title: 'Draft a chapter contract',
      description:
        'Create or update a chapter contract (outline/chapters/NNN.md). No contract, no prose (hard rule 3). The contract is validated the same way scripts/check_chapter.py and check_hooks.py validate it. Hard rule 11 (Hook handoff, blocking): if the previous chapter ends on a hook, the contract MUST include hookHandoff — how this chapter opening resolves that hook (paid off, carried, or explicitly deferred with a payoff chapter). A "cut" transition does not excuse dropping the previous hook. Fields not supplied keep their previous value when a contract already exists. Blind-writing rule (manual §四): the response carries the one-sentence ending summary and the one-line phase instruction for this chapter — never the full planned ending. chapterKind epilogue/extra skips phase/payoff/cadence checks.',
      inputSchema: contractShape,
    },
    wrap(async (input) => {
      const n = book.assertChapter(input.chapter);
      const dir = await loadBookDir(booksRoot, input.book);
      const contractPath = path.join(dir, 'outline', 'chapters', book.chapterFile(n));
      const existing = (await book.readFileIfExists(contractPath)) || '';
      const fields = { ...book.parseFrontmatterFile(existing).fields, ...contractInputToFields(input) };
      fields.chapter = String(n);
      const compass = await loadCompass(dir);
      const errors = validateContractFields(fields, n, compass);
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
      const phase = getPhaseInfo(n, 1, compass.targetChapters ?? null, compass.tolerance ?? undefined);
      const kind = fields.chapter_kind || 'main';
      return ok({
        book: input.book,
        chapter: n,
        status: 'contract',
        path: contractPath,
        fields,
        // Contract sees at most the one-sentence ending summary + phase info.
        endingSummary: compass.endingSummary || null,
        phase: kind === 'main' ? phase : null,
        phaseLine: kind === 'main' && phase ? phase.phaseLine : null,
        phaseMustNot: kind === 'main' && phase ? phase.phaseMustNot : null,
      });
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
      const compass = await loadCompass(dir);
      const errors = validateContractFields(fields, n, compass);
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
      const warnings = proseWarnings(input.prose, language, slop, {
        chapterKind: fields.chapter_kind || 'main',
        isProbe: fields.is_probe === 'true',
        targetChapters: compass.targetChapters ?? null,
        targetWords: compass.targetWords ?? null,
      });
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
      .array(z.object({ id: z.string(), payoffDue: z.number().int(), thread: z.string(), scope: z.enum(['series', 'volume', 'episode']).optional(), kind: z.enum(['reveal', 'conflict', 'relationship', 'other']).optional() }))
      .optional(),
    newCharacters: z
      .array(
        z.object({
          name: z.string(),
          role: z.string().optional(),
          dna: z.string().optional(),
          want: z.string().optional(),
          flaw: z.string().optional(),
          initialKnows: z.string().optional(),
        }),
      )
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
        newCharacters: commitInputsShape.newCharacters,
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
      const { ops, paidIds, planted, addedCharNames } = await computeCommitOps(dir, n, loaded.fields, input);
      // Stamp the commit-time big-cadence snapshot + chapter kind into the
      // committed chapter file (manual §六.1): later retargets never
      // retroactively fail history.
      const compass = await loadCompass(dir);
      const { fields: draftFields, body: draftBody } = book.parseFrontmatterFile(draftText);
      const stampedFields = {
        ...draftFields,
        chapter_kind: loaded.fields.chapter_kind || draftFields.chapter_kind || 'main',
        big_cadence_snapshot: snapshotFor(compass),
      };
      const stampedText = book.serializeFrontmatterFile(stampedFields, draftBody);
      ops.push({ path: path.join(dir, 'chapters', book.chapterFile(n)), content: stampedText });
      await book.writeFilesAtomic(ops);
      await fs.unlink(draftPath).catch(() => {});
      return ok({
        book: input.book,
        chapter: n,
        committed: true,
        changes: describeChanges(n, { paidIds, planted, addedCharNames }),
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
          removed.push(`knows.md: removed lines/sections added in chapter ${n}`);
        }
      }
      const bibleCharPath = path.join(dir, 'bible', 'characters.md');
      const bibleCharText = await book.readFileIfExists(bibleCharPath);
      if (bibleCharText !== null) {
        const updated = book.removeBibleCharactersForChapter(bibleCharText, n);
        if (updated !== bibleCharText) {
          ops.push({ path: bibleCharPath, content: updated });
          removed.push(`bible/characters.md: removed characters introduced in chapter ${n}`);
        }
      }
      ops.push({ path: path.join(dir, 'drafts', book.chapterFile(n)), content: chapterText });
      await book.writeFilesAtomic(ops);
      await fs.unlink(chapterPath).catch(() => {});
      return ok({ book: id, chapter: n, status: 'draft', removed });
    }),
  );

  // ---- User-driven mode (v2.2.0 P0 + v2.3.0 P1 + v2.4.0 P2) ------------
  // The tools below run the same repo Python scripts the file path runs
  // (scripts/validate_submission.py, check_fidelity.py, check_contract.py,
  // submission_level.py) — one source of truth, no second implementation
  // of the rules. submitUserOutline only serialises structured JSON into
  // the restricted YAML subset those scripts parse.
  const outlineBeatSchema = z.object({
    beat: z.string(),
    keywords: z.array(z.string()).min(1),
    budget: z.number().int().positive().optional(),
  });
  const outlineChapterSchema = z.object({
    chapter: z.number().int().min(1),
    title: z.string(),
    desire: z.string().optional(),
    payoffSize: z.string().optional(),
    hook: z.string(),
    characters: z.array(z.string()).default([]),
    foreshadowingPlanted: z.array(z.string()).default([]),
    foreshadowingPaid: z.array(z.string()).default([]),
    mustHappen: z.array(outlineBeatSchema).min(1),
  });
  const outlineInputSchema = {
    book: z.string(),
    outline: z.object({
      book: z.object({
        title: z.string(),
        language: z.string().optional(),
        targetChapters: z.number().int().positive().optional(),
        chapterTargetChars: z.number().int().positive().optional(),
        chapterTargetWords: z.number().int().positive().optional(),
      }),
      arcs: z.array(z.object({
        name: z.string(), range: z.string(), frozen: z.boolean().optional(),
      })).optional(),
      chapters: z.array(outlineChapterSchema).min(1),
    }),
    characters: z.array(z.object({
      name: z.string(), age: z.number().int().optional(), role: z.string().optional(),
      want: z.string().optional(), flaw: z.string().optional(), aliases: z.array(z.string()).optional(),
    })).optional(),
    threads: z.array(z.object({
      id: z.string(), planted: z.number().int().min(1), payoffDue: z.number().int().min(1),
      status: z.string().optional(), thread: z.string().optional(),
    })).optional(),
    brief: z.string().optional(),
  };

  async function runUserScript(script, dir) {
    const r = await runScript({ python, skillRoot, script, bookDir: dir });
    if (r.spawnError) throw new Error(`could not run ${script}: ${r.spawnError}`);
    return r;
  }

  server.registerTool(
    'submitUserOutline',
    {
      title: 'Submit a user outline (user-driven mode)',
      description:
        'Save the author\'s own brief + outline + chapter data into a book\'s user_submission/ (user_brief.md, user_outline.yaml, user_characters.yaml, user_foreshadowing.yaml) — the author\'s originals, never edited by the server afterwards. Then runs validate_submission.py and submission_level.py and returns their results. A failed validation does NOT delete the files: the author fixes the listed failures and re-submits. Locked fields (source: user) are chapter title/order, must_happen beats, hook, character names and foreshadowing payoff chapters — the AI may not change them afterwards.',
      inputSchema: outlineInputSchema,
    },
    wrap(async (input) => {
      const dir = await loadBookDir(booksRoot, input.book);
      // writeSubmission takes the outline itself — input.book is the book
      // id string, not the outline's book block.
      const written = await writeSubmission(dir, {
        ...input.outline,
        characters: input.characters,
        threads: input.threads,
        brief: input.brief,
      });
      const validation = await runUserScript('validate_submission.py', dir);
      const level = await runUserScript('submission_level.py', dir);
      return ok({
        book: input.book, written,
        validation: { pass: validation.pass, failures: validation.failures, warnings: validation.warnings },
        level: level.report,
      });
    }),
  );

  server.registerTool(
    'validateSubmission',
    {
      title: 'Validate a user submission',
      description:
        'Run scripts/validate_submission.py against a book\'s user_submission/: chapter numbers consecutive from 1, every chapter has a title, a hook >= 10 chars, >= 1 must_happen beat with keywords, 2-4 defined characters, foreshadowing registered before use, and per-beat word budgets (a beat below 200 chars / 100 words fails). Returns pass/failures/warnings. No submission in the book passes with a note.',
      inputSchema: { book: z.string() },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const r = await runUserScript('validate_submission.py', dir);
      return ok({ book: id, pass: r.pass, failures: r.failures, warnings: r.warnings });
    }),
  );

  server.registerTool(
    'checkFidelity',
    {
      title: 'Check chapters against the user outline (fidelity)',
      description:
        'Run scripts/check_fidelity.py: every committed chapter is checked against the author\'s user_outline.yaml — title, hook, desire, characters, foreshadowing, and every must_happen beat\'s keywords present in the prose. An invented chapter (not in the outline) fails, as does paying a thread before its payoff_due. No submission in the book passes with a note.',
      inputSchema: { book: z.string() },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const r = await runUserScript('check_fidelity.py', dir);
      return ok({ book: id, pass: r.pass, failures: r.failures, warnings: r.warnings });
    }),
  );

  server.registerTool(
    'checkContract',
    {
      title: 'Check chapter contracts against prose',
      description:
        'Run scripts/check_contract.py: prose without a contract fails; contract and prose frontmatter must agree (title, desire, payoff_size, hook, characters, foreshadowing, must_happen); a contract whose transition/desire_payoff is still TODO fails once prose exists; chapter N >= 2 needs a hook handoff stating how it resolves chapter N-1\'s end hook. Books with no contracts at all pass with a note.',
      inputSchema: { book: z.string() },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const r = await runUserScript('check_contract.py', dir);
      return ok({ book: id, pass: r.pass, failures: r.failures, warnings: r.warnings });
    }),
  );

  server.registerTool(
    'getSubmissionLevel',
    {
      title: 'Classify how complete a user submission is',
      description:
        'Run scripts/submission_level.py: L0 nothing submitted, L1 one-liner (brief only), L2 rough outline (chapters missing title/hook/beats/characters), L3 detailed outline (complete, ready for the normal user-driven flow), L4 chapter drafts (L3 plus drafts/ files — review drafts against the outline, drafts enter canon only via commitChapter). Returns the level, what happens next, and what is missing.',
      inputSchema: { book: z.string() },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const r = await runUserScript('submission_level.py', dir);
      return ok({ book: id, level: r.report, pass: r.pass });
    }),
  );

  server.registerTool(
    'listForeshadowing',
    {
      title: 'List foreshadowing threads',
      description:
        'List the foreshadowing ledger (state/foreshadowing.md) with a computed state per thread: overdue (open/past payoff chapter), due-soon (payoff within 3 chapters), stale-30 (open for 30+ chapters — the skill hard flag), beyondEnd (payoff_due past the book end window T + tolerance — blocking unless archived). Current chapter is the highest committed chapter. Archived threads are listed with status archived (exempt from stale/30/end-window rules); episode-scope threads do not count toward the end-of-book convergence warning.',
      inputSchema: { book: z.string() },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const ledgerText = (await book.readFileIfExists(path.join(dir, 'state', 'foreshadowing.md'))) || '';
      const threads = book.parseLedger(ledgerText);
      const progress = book.parseProgress((await book.readFileIfExists(path.join(dir, 'state', 'progress.md'))) || '');
      const current = progress.committed.length ? Math.max(...progress.committed) : 0;
      const compass = await loadCompass(dir);
      const winEnd =
        compass.targetChapters !== null
          ? compass.targetChapters + effectiveTolerance(compass.targetChapters, compass.tolerance ?? undefined)
          : null;
      return ok({
        book: id,
        currentChapter: current,
        endWindow:
          winEnd === null
            ? null
            : {
                targetChapters: compass.targetChapters,
                tolerance: effectiveTolerance(compass.targetChapters, compass.tolerance ?? undefined),
                winEnd,
              },
        threads: threads.map((t) => ({
          ...t,
          overdue: (t.status === 'open' || t.status === 'progressing') && t.payoffDue !== null && t.payoffDue <= current,
          dueSoon:
            (t.status === 'open' || t.status === 'progressing') &&
            t.payoffDue !== null &&
            t.payoffDue > current &&
            t.payoffDue - current <= 3,
          stale30: t.status === 'open' && current - t.planted >= 30,
          beyondEnd:
            winEnd !== null && t.status !== 'paid' && t.status !== 'archived' && t.payoffDue !== null && t.payoffDue > winEnd,
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
    'getPhase',
    {
      title: 'Get the ending-plan phase for a chapter',
      description:
        'Compute the ending-plan phase (manual §三) for one chapter number: setup / middle / convergence / finale window, with L1, L2, winStart, winEnd, the one-line phase instruction (phaseLine) and the contract mustNot addition (phaseMustNot). The phase instruction is the only ending-related text a prose prompt may carry — it contains no ending content. Returns {targetSet: false} for books without a target (old books silently fall back to the legacy rules).',
      inputSchema: { book: z.string(), chapter: z.number().int().min(1).max(9999) },
    },
    wrap(async ({ book: id, chapter }) => {
      const n = book.assertChapter(chapter);
      const dir = await loadBookDir(booksRoot, id);
      const compass = await loadCompass(dir);
      const phase = getPhaseInfo(n, 1, compass.targetChapters ?? null, compass.tolerance ?? undefined);
      if (!phase) return ok({ book: id, chapter: n, targetSet: false, message: 'no target chapters set — legacy rules apply (big cadence 10, no end window)' });
      return ok({ book: id, chapter: n, targetSet: true, ...phase });
    }),
  );

  server.registerTool(
    'getEndingPlan',
    {
      title: 'Get the full ending plan (director-only)',
      description:
        'DIRECTOR-ONLY. Return the book full ending plan: the one-sentence ending summary plus the complete 3-beat planned ending (climax, character fates, central-question answer) from outline/overview.md. Call this ONLY when drafting the bible, running an arc review, or doing the Gate 3 completion audit. NEVER paste its output into a chapter-contract or prose prompt, and never quote it in prose — prose is written blind (contract + one-line phase instruction only). getBook deliberately redacts this section.',
      inputSchema: { book: z.string() },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const compass = await loadCompass(dir);
      return ok({
        book: id,
        targetChapters: compass.targetChapters,
        endingSummary: compass.endingSummary,
        plannedEnding: compass.plannedEnding || null,
      });
    }),
  );

  server.registerTool(
    'saveEndingPlan',
    {
      title: 'Save the ending plan',
      description:
        'Save the ending plan into outline/overview.md: endingSummary (one sentence) goes to the Compass, plannedEnding (3 beats: climax, character fates, central-question answer) goes to the `## Planned ending (director-only)` section. Either field may be omitted to leave it unchanged; pass an empty string to clear it. The author (or the host with author approval) decides the ending — the server only stores it.',
      inputSchema: {
        book: z.string(),
        endingSummary: z.string().optional(),
        plannedEnding: z.string().optional(),
      },
    },
    wrap(async ({ book: id, endingSummary, plannedEnding }) => {
      const dir = await loadBookDir(booksRoot, id);
      const overviewPath = path.join(dir, 'outline', 'overview.md');
      let text = (await book.readFileIfExists(overviewPath)) || '# Outline\n\n## Compass\n';
      if (endingSummary !== undefined) text = book.setCompassLine(text, 'Ending summary', endingSummary);
      if (plannedEnding !== undefined) text = book.setPlannedEndingSection(text, plannedEnding);
      await book.writeFilesAtomic([{ path: overviewPath, content: text }]);
      return ok({ book: id, saved: { endingSummary: endingSummary !== undefined, plannedEnding: plannedEnding !== undefined } });
    }),
  );

  server.registerTool(
    'retargetBook',
    {
      title: 'Retarget the book length (adjust the volume outline)',
      description:
        'Change the book target chapters (manual §五.2.4 — adjust the volume outline). Shortening the book first lists every foreshadowing thread whose payoff_due falls outside the new end window (target + tolerance); call again with resolutions for each: {id, action: "compress", newPayoffDue} (move the payoff inside the window) or {id, action: "archive"} (seal the thread — it is exempt from audit afterwards). Action "keep" is rejected. Without resolutions and with over-window threads, returns {status: "needs-triage", overWindow} and writes nothing. Committed chapters are never rewritten; new chapters audit against the new big cadence from the next chapter on. A restructure snapshot is appended to state/restructure.md.',
      inputSchema: {
        book: z.string(),
        targetChapters: z.number().int().min(1).max(9999),
        tolerance: z.number().int().min(0).optional(),
        resolutions: z
          .array(z.object({ id: z.string(), action: z.enum(['compress', 'archive', 'keep']), newPayoffDue: z.number().int().min(1).optional() }))
          .optional(),
      },
    },
    wrap(async ({ book: id, targetChapters, tolerance, resolutions }) => {
      const dir = await loadBookDir(booksRoot, id);
      const compass = await loadCompass(dir);
      const tol = effectiveTolerance(targetChapters, tolerance ?? undefined);
      const winEnd = targetChapters + tol;
      const chapters = await book.listChapters(booksRoot, id);
      let maxCommittedMain = 0;
      for (const c of chapters) {
        if (c.status !== 'committed') continue;
        const loaded = await book.loadChapter(booksRoot, id, c.chapter);
        if ((loaded.fields.chapter_kind || 'main') === 'main') maxCommittedMain = Math.max(maxCommittedMain, c.chapter);
      }
      if (winEnd < maxCommittedMain) {
        throw new Error(
          `new target ${targetChapters} (±${tol}, latest ${winEnd}) is below the highest committed main chapter ${maxCommittedMain} — committed chapters cannot be taken back; end at chapter ${maxCommittedMain + 10} instead`,
        );
      }
      const ledgerText = (await book.readFileIfExists(path.join(dir, 'state', 'foreshadowing.md'))) || '';
      const threads = book.parseLedger(ledgerText);
      const overWindow = threads.filter(
        (t) => t.status !== 'paid' && t.status !== 'archived' && t.payoffDue !== null && t.payoffDue > winEnd,
      );
      if (overWindow.length && (!resolutions || !resolutions.length)) {
        return ok({
          book: id,
          status: 'needs-triage',
          newTarget: targetChapters,
          tolerance: tol,
          winEnd,
          overWindow: overWindow.map((t) => ({ id: t.id, thread: t.thread, payoffDue: t.payoffDue, kind: t.kind })),
          message: 're-call retargetBook with a resolution (compress/archive) for every over-window thread',
        });
      }
      const resMap = new Map((resolutions || []).map((r) => [r.id.trim(), r]));
      for (const t of overWindow) {
        const res = resMap.get(t.id.trim());
        if (!res) throw new Error(`thread ${t.id} (${t.thread}) payoff_due ${t.payoffDue} is past the new end window (${winEnd}) — resolve it (compress or archive) first`);
        if (res.action === 'keep') throw new Error(`thread ${t.id}: "keep" is not allowed for an over-window thread — compress it into the window or archive it`);
        if (res.action === 'compress') {
          if (!res.newPayoffDue || res.newPayoffDue <= t.planted || res.newPayoffDue > winEnd) {
            throw new Error(`thread ${t.id}: compress needs newPayoffDue inside (planted ${t.planted}, window end ${winEnd}]`);
          }
        }
      }
      const retargetEdits = overWindow
        .filter((t) => resMap.get(t.id.trim())?.action === 'compress')
        .map((t) => ({ id: t.id, payoffDue: resMap.get(t.id.trim()).newPayoffDue }));
      const archiveIds = overWindow.filter((t) => resMap.get(t.id.trim())?.action === 'archive').map((t) => t.id);
      const ops = [];
      const overviewPath = path.join(dir, 'outline', 'overview.md');
      let overview = (await book.readFileIfExists(overviewPath)) || '# Outline\n\n## Compass\n';
      overview = book.setCompassLine(overview, 'Target chapters', String(targetChapters));
      if (tolerance !== undefined) overview = book.setCompassLine(overview, 'Tolerance', String(tolerance));
      ops.push({ path: overviewPath, content: overview });
      if (retargetEdits.length || archiveIds.length) {
        ops.push({
          path: path.join(dir, 'state', 'foreshadowing.md'),
          content: book.applyLedgerEdits(ledgerText, { retarget: retargetEdits, archive: archiveIds }),
        });
      }
      const restructurePath = path.join(dir, 'state', 'restructure.md');
      const prevRestructure = (await book.readFileIfExists(restructurePath)) || '# Restructure log\n';
      const entry = `\n## ${new Date().toISOString()} — retarget\n- before: target ${compass.targetChapters ?? 'unset'} → after: target ${targetChapters} (±${tol}, window ends ${winEnd})\n- compressed: ${retargetEdits.map((e) => `${e.id}→${e.payoffDue}`).join(', ') || 'none'}\n- archived: ${archiveIds.join(', ') || 'none'}\n`;
      ops.push({ path: restructurePath, content: prevRestructure.replace(/\s+$/, '') + entry });
      await book.writeFilesAtomic(ops);
      return ok({
        book: id,
        status: 'retargeted',
        newTarget: targetChapters,
        tolerance: tol,
        winEnd,
        compressed: retargetEdits,
        archived: archiveIds,
        newBigCadence: bigCadenceFor(targetChapters),
      });
    }),
  );

  server.registerTool(
    'exportSequelSeed',
    {
      title: 'Export a sequel seed (JSON)',
      description:
        'Export a sequel seed for a completed book (manual §七.4): surviving characters (with their last known state), unresolved threads (open/progressing, with scope/kind), the ending summary, world rules and hard constraints. The host can start the next volume with importSequelSeed. Also saves a copy to outline/sequel-seed.json. Works on any book, but is meant for completed ones.',
      inputSchema: { book: z.string() },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const compass = await loadCompass(dir);
      const chapters = await book.listChapters(booksRoot, id);
      let completedAtChapter = 0;
      for (const c of chapters) {
        if (c.status !== 'committed') continue;
        const loaded = await book.loadChapter(booksRoot, id, c.chapter);
        if ((loaded.fields.chapter_kind || 'main') === 'main') completedAtChapter = Math.max(completedAtChapter, c.chapter);
      }
      const ledgerText = (await book.readFileIfExists(path.join(dir, 'state', 'foreshadowing.md'))) || '';
      const unresolved = book
        .parseLedger(ledgerText)
        .filter((t) => t.status === 'open' || t.status === 'progressing')
        .map((t) => ({ id: t.id, thread: t.thread, scope: t.scope, kind: t.kind }));
      const charState = (await book.readFileIfExists(path.join(dir, 'state', 'character_state.md'))) || '';
      const surviving = (await book.bibleCharacters(dir)).map((name) => {
        const line = charState.split('\n').find((l) => l.includes(name)) || '';
        return { name, role: '', dna: '', lastState: line.trim() };
      });
      const worldRules = (await book.readFileIfExists(path.join(dir, 'bible', 'world.md'))) || '';
      const rulesText = (await book.readFileIfExists(path.join(dir, 'bible', 'rules.md'))) || '';
      const hardConstraints = rulesText.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
      const seed = {
        seedVersion: 1,
        sourceBookId: id,
        sourceBookTitle: await book.deriveTitle(dir, id),
        language: 'zh',
        genreId: '',
        completedAtChapter,
        endingSummary: compass.endingSummary || '',
        worldRules: worldRules.slice(0, 2000),
        hardConstraints,
        survivingCharacters: surviving,
        unresolvedThreads: unresolved,
      };
      await book.writeFilesAtomic([{ path: path.join(dir, 'outline', 'sequel-seed.json'), content: JSON.stringify(seed, null, 2) }]);
      return ok({ book: id, seed, savedTo: 'outline/sequel-seed.json' });
    }),
  );

  server.registerTool(
    'importSequelSeed',
    {
      title: 'Import a sequel seed as a new book',
      description:
        'Create a new book from a sequel seed JSON (see exportSequelSeed): surviving characters carry over, unresolved threads start planted in chapter 1 with payoff_due 30 as placeholders, the target chapters are left blank (set them after the book opens). The new book id must not exist yet.',
      inputSchema: { book: z.string(), seed: z.object({}).passthrough(), title: z.string().optional() },
    },
    wrap(async ({ book: id, seed, title }) => {
      const newId = book.assertBookId(id);
      const dir = book.bookDir(booksRoot, newId);
      if (await book.exists(dir)) throw new Error(`book "${newId}" already exists — pick another id`);
      const s = seed;
      if (!s || s.seedVersion !== 1) throw new Error('invalid sequel seed (want seedVersion 1 from exportSequelSeed)');
      const bookTitle = title || s.sourceBookTitle || newId;
      const chars = Array.isArray(s.survivingCharacters) ? s.survivingCharacters : [];
      const threads = Array.isArray(s.unresolvedThreads) ? s.unresolvedThreads : [];
      const charLines = chars.map((c) => `## ${c.name || 'Unnamed'}\n${c.role ? `- Role: ${c.role}\n` : ''}${c.dna ? `- DNA: ${c.dna}\n` : ''}${c.lastState ? `- Last state: ${c.lastState}\n` : ''}`).join('\n');
      const ledgerLines = threads.map((t) => `- ${t.id} | planted: 1 | payoff_due: 30 | status: open | scope: ${t.scope || 'series'} | kind: ${t.kind || 'other'} | thread: ${t.thread || ''}`).join('\n');
      const overview = [
        `# Outline — 《${bookTitle}》`,
        '',
        '## Compass',
        `- End direction: Sequel to 《${s.sourceBookTitle || s.sourceBookId || ''}》`,
        '- Active long threads: ' + (threads.map((t) => t.id).join(', ') || '—'),
        `- Scale estimate: `,
        '- Central question: ',
        '- What this book is NOT: ',
        '- Book status: ongoing',
        ...(s.endingSummary ? [`- Ending summary: ${s.endingSummary}`] : []),
        '',
        '## Current arc',
        '- Arc goal: ',
        '',
      ].join('\n');
      const ops = [
        { path: path.join(dir, 'bible', 'canon.md'), content: `# Canon — 《${bookTitle}》\n\nSequel to 《${s.sourceBookTitle || s.sourceBookId || ''}》 (completed at chapter ${s.completedAtChapter ?? '—'}).\n` },
        { path: path.join(dir, 'bible', 'characters.md'), content: charLines || '# Characters\n' },
        { path: path.join(dir, 'bible', 'world.md'), content: s.worldRules || '' },
        { path: path.join(dir, 'bible', 'rules.md'), content: (s.hardConstraints || []).map((c) => `- ${c}`).join('\n') + '\n' },
        { path: path.join(dir, 'bible', 'voice.md'), content: '' },
        { path: overview ? path.join(dir, 'outline', 'overview.md') : path.join(dir, 'outline', 'overview.md'), content: overview },
        { path: path.join(dir, 'state', 'foreshadowing.md'), content: `# Foreshadowing Ledger\n\n## Threads\n${ledgerLines}\n` },
        { path: path.join(dir, 'state', 'summary.md'), content: `# Summary — 《${bookTitle}》\n` },
        { path: path.join(dir, 'state', 'character_state.md'), content: chars.map((c) => `- ${c.name || 'Unnamed'}: ${c.lastState || ''}`).join('\n') + '\n' },
        { path: path.join(dir, 'state', 'knows.md'), content: chars.map((c) => `## ${c.name || 'Unnamed'}\n`).join('\n') },
        { path: path.join(dir, 'state', 'progress.md'), content: `- Next chapter to write: 1\n` },
        { path: path.join(dir, 'state', 'timeline.md'), content: '' },
      ];
      await book.writeFilesAtomic(ops);
      return ok({ book: newId, title: bookTitle, characters: chars.length, threads: threads.length, message: 'sequel book created — target chapters left blank, set them with retargetBook or saveEndingPlan after opening' });
    }),
  );

  server.registerTool(
    'completeBook',
    {
      title: 'Gate 3: review and confirm book completion',
      description:
        'Gate 3 completion audit (manual §七). Without confirm: return the review — final main chapter, main-chapter/word counts, epilogue/extra counts, and the remaining unclosed series/volume threads (each may be archived now or left for a sequel). With confirm: true, the author explicitly confirms completion: the book status flips to completed, the listed archiveThreadIds are archived, and main-line writing closes (epilogue/extra chapters may still be written). Nothing auto-completes — confirm must be passed deliberately.',
      inputSchema: {
        book: z.string(),
        confirm: z.boolean().optional(),
        archiveThreadIds: z.array(z.string()).optional(),
      },
    },
    wrap(async ({ book: id, confirm, archiveThreadIds }) => {
      const dir = await loadBookDir(booksRoot, id);
      const compass = await loadCompass(dir);
      const chapters = await book.listChapters(booksRoot, id);
      let maxMain = 0;
      let mainWords = 0;
      let extraCount = 0;
      for (const c of chapters) {
        if (c.status !== 'committed') continue;
        const loaded = await book.loadChapter(booksRoot, id, c.chapter);
        const kind = loaded.fields.chapter_kind || 'main';
        if (kind === 'main') {
          maxMain = Math.max(maxMain, c.chapter);
          mainWords += loaded.prose.replace(/\s+/g, '').length;
        } else extraCount++;
      }
      const ledgerText = (await book.readFileIfExists(path.join(dir, 'state', 'foreshadowing.md'))) || '';
      const unclosed = book
        .parseLedger(ledgerText)
        .filter((t) => (t.status === 'open' || t.status === 'progressing' || t.status === 'deferred') && t.scope !== 'episode');
      if (!confirm) {
        return ok({
          book: id,
          status: 'review',
          bookStatus: compass.bookStatus,
          finalChapter: maxMain,
          mainChapters: chapters.filter((c) => c.status === 'committed').length,
          mainWords,
          epilogueExtra: extraCount,
          endingSummary: compass.endingSummary,
          unclosedThreads: unclosed.map((t) => ({ id: t.id, thread: t.thread, payoffDue: t.payoffDue, kind: t.kind })),
          message: 're-call completeBook with confirm: true (and archiveThreadIds for threads to seal) to finish the book',
        });
      }
      if (compass.bookStatus === 'completed') throw new Error(`book "${id}" is already completed — reopen it first if it needs more main chapters`);
      const toArchive = (archiveThreadIds || []).filter((tid) => unclosed.some((t) => t.id === tid));
      const overviewPath = path.join(dir, 'outline', 'overview.md');
      let overview = (await book.readFileIfExists(overviewPath)) || '# Outline\n\n## Compass\n';
      overview = book.setCompassLine(overview, 'Book status', 'completed');
      overview = book.setCompassLine(overview, 'Completed at chapter', String(maxMain));
      const ops = [{ path: overviewPath, content: overview }];
      if (toArchive.length) {
        ops.push({ path: path.join(dir, 'state', 'foreshadowing.md'), content: book.applyLedgerEdits(ledgerText, { archive: toArchive }) });
      }
      await book.writeFilesAtomic(ops);
      return ok({ book: id, status: 'completed', completedAtChapter: maxMain, mainWords, archived: toArchive, message: 'book completed — main-line entries closed; epilogue/extra may still be written, or export a sequel seed' });
    }),
  );

  server.registerTool(
    'reopenBook',
    {
      title: 'Re-open a completed book',
      description:
        'Return a completed book to ongoing (manual §七.5): the book status flips back, the completed-at marker is removed, and main-line writing re-opens. Use when the ending needs more chapters, or when the completed final chapter was deleted.',
      inputSchema: { book: z.string() },
    },
    wrap(async ({ book: id }) => {
      const dir = await loadBookDir(booksRoot, id);
      const overviewPath = path.join(dir, 'outline', 'overview.md');
      let overview = (await book.readFileIfExists(overviewPath)) || '# Outline\n\n## Compass\n';
      overview = book.setCompassLine(overview, 'Book status', 'ongoing');
      overview = book.setCompassLine(overview, 'Completed at chapter', null);
      await book.writeFilesAtomic([{ path: overviewPath, content: overview }]);
      return ok({ book: id, status: 'ongoing', message: 'book re-opened — main-line writing is available again' });
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
        'Return the long-novel-workflow rules the host model must follow: hard rules, the 7-step workflow, gates, the 8-dimension audit criteria, and the full SKILL.md text. Load this first when a host has not installed the skill.',
      inputSchema: {},
    },
    wrap(async () => {
      const skillText = await fs.readFile(path.join(skillRoot, 'SKILL.md'), 'utf8').catch(() => '');
      const auditCriteria = await book.readFileIfExists(path.join(skillRoot, 'checklists', 'chapter_audit.md'));
      return ok({
        name: 'long-novel-workflow',
        version: '2.4.0',
        bookLayout: 'user_submission/ (user-driven mode only: user_brief, user_outline.yaml, user_characters, user_foreshadowing, versions/), bible/ (canon, characters, world, rules, voice), outline/ (overview, chapters/NNN.md contracts), state/ (summary, character_state, foreshadowing, knows, progress, timeline), chapters/ (NNN.md, committed only), drafts/ (NNN.md, uncommitted drafts)',
        gates: ['Gate 1: bible + outline ready before any prose', 'Gate 1.5 (user-driven only): understanding restatement — the AI restates the outline back, must-ask gaps answered, author confirms before work starts', 'Gate 2: golden 3 chapters diagnosed before bulk serialising', 'Gate 3: completion audit — author confirms the ending, then the book flips to completed (nothing auto-completes)', 'Per-chapter audit: contract → draft → audit (check_chapter, check_continuity, check_hooks, check_contract, check_fidelity in user-driven mode) → bounded revise → CHAPTER_COMMIT (author-gated, full-auto, or user-driven)'],
        hardRules: HARD_RULES_SHORT,
        steps: ['Step 0 mode + market scan (user-driven skips the scan)', 'Step 1 bible + outline (target + ending plan); user-driven: validate the submission first', 'Step 1.5 understanding restatement (user-driven only)', 'Step 2 golden 3 chapters', 'Step 3 chapter loop (contract → draft → sub-review → bounded revise → commit)', 'Step 4 arc review every 30 chapters (frozen arcs are never replanned)', 'Step 5 import an existing manuscript', 'Step 6 Gate 3 completion audit'],
        auditCriteria8Dimensions: auditCriteria || '(checklists/chapter_audit.md not found)',
        skillText,
      });
    }),
  );

  return server;
}
