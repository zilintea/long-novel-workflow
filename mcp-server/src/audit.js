// Deterministic audit: runs the repo's Python check scripts against a book.
// The scripts only inspect chapters/ (canon). A draft lives in drafts/, so
// auditChapter stages the book into a temp copy, places the draft into
// chapters/ there, optionally applies the would-be commit state, and runs
// the checks on the staged copy. Canon is never touched by an audit.
// When the commit inputs are NOT supplied, three failures are known
// pre-commit artifacts of an uncommitted draft and are reported as notes,
// not failures:
//   - progress.md not listing the draft chapter yet (commit adds it),
//   - a thread the draft pays off still showing `open` in the ledger
//     (commit marks it paid in the same CHAPTER_COMMIT), and
//   - a thread the draft plants still missing from the ledger
//     (commit creates its ledger entry in the same CHAPTER_COMMIT).
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chapterFile, copyBookToTemp, parseFrontmatterFile, removeDir } from './book.js';

const SCRIPTS = ['check_chapter.py', 'check_continuity.py', 'check_hooks.py'];

function runOne(python, script, bookDir, timeoutMs) {
  return new Promise((resolve) => {
    execFile(python, [script, bookDir], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const exitCode = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      const spawnFailed = err && typeof err.code !== 'number';
      resolve({
        script: path.basename(script),
        pass: exitCode === 0 && !spawnFailed,
        exitCode,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        spawnError: spawnFailed ? String((err && err.message) || err) : null,
      });
    });
  });
}

export async function runChecks({ python, skillRoot, bookDir, timeoutMs = 30000 }) {
  const results = [];
  for (const s of SCRIPTS) {
    results.push(await runOne(python, path.join(skillRoot, 'scripts', s), bookDir, timeoutMs));
  }
  return results;
}

function splitOutput(result) {
  const failures = [];
  const warnings = [];
  for (const line of (result.stdout + '\n' + result.stderr).split('\n')) {
    if (line.startsWith('FAIL: ')) failures.push(line.slice(6));
    else if (line.startsWith('WARN: ')) warnings.push(line.slice(6));
  }
  return { failures, warnings };
}

// Filter the known pre-commit artifacts for one draft chapter.
// Returns { failures, notes }. `plantedIds` are the threads the audited
// chapter plants — their ledger entries are created by the same
// CHAPTER_COMMIT, so "unknown thread" for them is expected pre-commit.
function filterPreCommitArtifacts(failures, chapter, plantedIds) {
  const kept = [];
  const notes = [];
  const fname = chapterFile(chapter);
  for (const f of failures) {
    const m = f.match(/^state\/progress\.md committed chapters \[([0-9, ]*)\] != chapters on disk \[([0-9, ]*)\]/);
    if (m) {
      const committed = m[1].split(',').map((s) => Number(s.trim())).filter(Boolean);
      const present = m[2].split(',').map((s) => Number(s.trim())).filter(Boolean);
      const extra = present.filter((n) => !committed.includes(n));
      if (extra.length === 1 && extra[0] === chapter) {
        notes.push(
          `expected pre-commit state: chapter ${chapter} is a draft, not yet listed in state/progress.md (commit adds it)`,
        );
        continue;
      }
    }
    if (f.startsWith(`${fname}: pays off `) && f.includes('but ledger status is `open`')) {
      notes.push(
        `expected pre-commit state: ${f} — the ledger is marked paid by the same CHAPTER_COMMIT, not before it`,
      );
      continue;
    }
    const plantMatch = f.match(new RegExp(`^${fname}: foreshadowing_planted references unknown thread (F\\d+)$`));
    if (plantMatch && plantedIds.includes(plantMatch[1])) {
      notes.push(
        `expected pre-commit state: thread ${plantMatch[1]} is planted by this chapter — its ledger entry is created by the same CHAPTER_COMMIT`,
      );
      continue;
    }
    kept.push(f);
  }
  return { failures: kept, notes };
}

// Stage + check one chapter. `applyCommitState` (optional) is an async
// function (tmpDir) => void that applies the would-be commit state updates
// (progress/summary/timeline/ledger/knows) into the staged copy, using the
// same code path commitChapter uses for real. With it, the audit is an
// exact dry run of the commit; without it, pre-commit artifacts are noted.
export async function auditDraft({ python, skillRoot, bookDir, chapter, applyCommitState, timeoutMs = 30000 }) {
  const staged = await copyBookToTemp(bookDir);
  try {
    const fname = chapterFile(chapter);
    const draftPath = path.join(bookDir, 'drafts', fname);
    const stagedChapter = path.join(staged, 'chapters', fname);
    if (await fs.access(draftPath).then(() => true).catch(() => false)) {
      await fs.mkdir(path.join(staged, 'chapters'), { recursive: true });
      await fs.copyFile(draftPath, stagedChapter);
    }
    // Threads this chapter plants (from its contract/frontmatter) — their
    // ledger entries are created by the commit, so "unknown thread" for them
    // is an expected pre-commit state, not a failure.
    const stagedText = await fs.readFile(stagedChapter, 'utf8').catch(() => '');
    const stagedFields = parseFrontmatterFile(stagedText).fields;
    const plantedIds = (stagedFields.foreshadowing_planted || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^F\d+$/.test(s));
    if (applyCommitState) await applyCommitState(staged);
    const results = await runChecks({ python, skillRoot, bookDir: staged, timeoutMs });
    const out = { pass: true, results: [], notes: [] };
    for (const r of results) {
      const { failures, warnings } = splitOutput(r);
      let keptFailures = failures;
      if (!applyCommitState && r.script === 'check_continuity.py') {
        const filtered = filterPreCommitArtifacts(failures, chapter, plantedIds);
        keptFailures = filtered.failures;
        out.notes.push(...filtered.notes);
      }
      if (r.spawnError) {
        out.pass = false;
        out.results.push({ ...r, failures: [`could not run ${r.script}: ${r.spawnError}`], warnings });
      } else {
        if (keptFailures.length > 0) out.pass = false;
        out.results.push({ ...r, failures: keptFailures, warnings });
      }
    }
    return out;
  } finally {
    await removeDir(staged);
  }
}
