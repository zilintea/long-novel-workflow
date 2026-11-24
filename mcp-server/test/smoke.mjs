// Smoke test for the long-novel MCP server (v1 prototype).
//
// Exercises both transports against a COPY of the test fixture book
// (mcp-server/test/fixtures/mini-book, clearly marked test data — never a
// real user book) and verifies a full commit/rollback round-trip.
//
// Usage:  npm test        (or: node test/smoke.mjs)
// Exits 0 when every check passes, 1 otherwise.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, '..', 'server.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'mini-book');
const PYTHON = process.env.PYTHON || 'python3';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const failures = () => results.filter((r) => !r.ok);

// ---- helpers -----------------------------------------------------------

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

// Minimal JSON-RPC client over a child process's stdio.
class StdioClient {
  constructor(proc) {
    this.proc = proc;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    proc.stderr.on('data', (d) => { this.stderr += String(d); });
    proc.stdout.on('data', (d) => {
      this.buf += String(d);
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 20000);
      this.pending.set(id, { resolve, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  // Call a tool; returns { isError, data } where data is the parsed JSON payload.
  async callTool(name, args) {
    const msg = await this.request('tools/call', { name, arguments: args });
    if (msg.error) throw new Error(`tools/call ${name} returned RPC error: ${JSON.stringify(msg.error)}`);
    const content = msg.result.content || [];
    const text = content.map((c) => c.text || '').join('');
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!msg.result.isError, data, raw: text };
  }
}

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function httpRpc(port, body, expectStatus = 200) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, ok: res.status === expectStatus, body: text ? JSON.parse(text) : null };
}

// ---- main --------------------------------------------------------------

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'long-novel-smoke-'));
  const booksRoot = path.join(tmpRoot, 'books');
  const scansRoot = path.join(tmpRoot, 'scans');
  await fs.mkdir(scansRoot, { recursive: true });
  await copyDir(FIXTURE, path.join(booksRoot, 'mini-book'));
  const fixtureBook = path.join(booksRoot, 'mini-book');

  const cleanup = [];
  const kill = (proc) => { if (proc && !proc.killed) proc.kill('SIGTERM'); };
  process.on('exit', () => { cleanup.forEach(kill); });

  try {
    // 0. The fixture itself passes the deterministic checks (direct run).
    const { execFile } = await import('node:child_process');
    const runCheck = (script) => new Promise((resolve) => {
      execFile(PYTHON, [path.join(__dirname, '..', '..', 'scripts', script), fixtureBook], (err, stdout) => {
        resolve({ pass: !err, stdout: String(stdout || '') });
      });
    });
    for (const s of ['check_chapter.py', 'check_continuity.py', 'check_hooks.py']) {
      const r = await runCheck(s);
      check(`fixture passes ${s}`, r.pass, r.stdout.trim().split('\n').pop());
    }

    // 1. Stdio transport -------------------------------------------------
    const proc = spawn(process.execPath, [SERVER, '--books', booksRoot, '--scans', scansRoot, '--python', PYTHON], { stdio: ['pipe', 'pipe', 'pipe'] });
    cleanup.push(proc);
    const client = new StdioClient(proc);
    await new Promise((resolve, reject) => {
      proc.on('error', reject);
      setTimeout(resolve, 500);
    });

    const init = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '1.0.0' },
    });
    check('stdio initialize', init.result && init.result.serverInfo && init.result.serverInfo.name === 'long-novel-mcp',
      `serverInfo: ${JSON.stringify(init.result && init.result.serverInfo)}`);
    client.notify('notifications/initialized');

    const list = await client.request('tools/list', {});
    const toolNames = (list.result.tools || []).map((t) => t.name);
    const expected = ['listBooks', 'getBook', 'getChapter', 'draftContract', 'saveChapterDraft', 'auditChapter',
      'commitChapter', 'rollbackChapter', 'submitUserOutline', 'validateSubmission', 'checkFidelity', 'checkContract',
      'getSubmissionLevel', 'listForeshadowing', 'markForeshadowingPaid', 'extendForeshadowing',
      'scheduleForeshadowingPayoff', 'getPhase', 'getEndingPlan', 'saveEndingPlan', 'retargetBook',
      'exportSequelSeed', 'importSequelSeed', 'completeBook', 'reopenBook', 'marketScan', 'getWorkflow'];
    check('tools/list returns 27 tools', toolNames.length === 27 && expected.every((n) => toolNames.includes(n)),
      `got: ${toolNames.join(', ')}`);

    const books = await client.callTool('listBooks', {});
    check('listBooks finds mini-book', !books.isError && books.data.books.some((b) => b.id === 'mini-book' && b.title === '迷你测试'),
      JSON.stringify(books.data.books));

    const book = await client.callTool('getBook', { book: 'mini-book' });
    check('getBook returns bible + state', !book.isError && book.data.bible['canon.md'].includes('回到三年前') && book.data.state['progress.md'].includes('committed: 1'),
      `title: ${book.data.title}, state files: ${Object.keys(book.data.state || {}).join(', ')}`);

    const ch2draft = await client.callTool('getChapter', { book: 'mini-book', chapter: 2 });
    check('getChapter 2 returns draft prose', !ch2draft.isError && ch2draft.data.status === 'draft' && ch2draft.data.prose.includes('信封是白色的'),
      `status: ${ch2draft.data.status}, chars: ${ch2draft.data.prose && ch2draft.data.prose.length}`);

    // Rule 11: contract for chapter 3 without hook_handoff must be refused.
    // Rule 11: a contract that is otherwise valid but lacks hookHandoff must
    // be refused (chapter 1 ends on a hook: the broken key).
    const noHandoff = await client.callTool('draftContract', {
      book: 'mini-book', chapter: 3, title: '旧书店', language: 'zh', desire: 'curiosity',
      desirePayoff: '阿测走进旧书店，确认店里还剩什么',
      payoffSize: 'small', hook: '店门后传来一声很轻的咳嗽', transition: '第三章从旧书店开始',
      mustHappen: '阿测去旧书店看一看', mustNot: '阿测不能一次查清所有事', characters: '阿测',
    });
    check('rule 11: draftContract ch3 without hookHandoff is refused', noHandoff.isError && /hook_handoff|Hook handoff/i.test(noHandoff.raw),
      noHandoff.raw.slice(0, 160));

    const withHandoff = await client.callTool('draftContract', {
      book: 'mini-book', chapter: 3, title: '旧书店', language: 'zh', desire: 'curiosity',
      desirePayoff: '阿测走进旧书店，确认店里还剩什么',
      payoffSize: 'small', hook: '店门后传来一声很轻的咳嗽', transition: '第三章从旧书店开始',
      mustHappen: '阿测去旧书店看一看', mustNot: '阿测不能一次查清所有事', characters: '阿测',
      hookHandoff: '接上第二章结尾：阿测握住书房门把手，听到门外脚步声——门外是阿验，他带来了旧书店的钥匙',
    });
    check('draftContract ch3 with hookHandoff succeeds', !withHandoff.isError && withHandoff.data.status === 'contract' && withHandoff.data.fields.chapter === '3',
      JSON.stringify(withHandoff.data));

    const auditPlain = await client.callTool('auditChapter', { book: 'mini-book', chapter: 2 });
    check('auditChapter 2 (no commit inputs) passes with pre-commit notes', !auditPlain.isError && auditPlain.data.pass === true,
      `notes: ${JSON.stringify(auditPlain.data.notes)}`);

    const auditDry = await client.callTool('auditChapter', {
      book: 'mini-book', chapter: 2,
      summary: '阿测在书房找到一封没有落款的信，信纸上有旧书店的水印。',
      timeline: 'Day 2 (chapter 2): 阿测在书房找到没有落款的信。',
      foreshadowingPlanted: [{ id: 'F02', payoffDue: 6, thread: '没有落款的信，信纸有旧书店水印' }],
    });
    check('auditChapter 2 dry-run with commit inputs passes', !auditDry.isError && auditDry.data.pass === true && auditDry.data.dryRun === true,
      `checks: ${JSON.stringify(auditDry.data.checks.map((r) => r.script + ':' + r.pass))}`);

    const commit = await client.callTool('commitChapter', {
      book: 'mini-book', chapter: 2,
      summary: '阿测在书房找到一封没有落款的信，信纸上有旧书店的水印。',
      timeline: 'Day 2 (chapter 2): 阿测在书房找到没有落款的信。',
      knows: [{ character: '阿测', entry: 'Knows the unsigned letter exists (chapter 2 — she found it in the study).' }],
      foreshadowingPlanted: [{ id: 'F02', payoffDue: 6, thread: '没有落款的信，信纸有旧书店水印' }],
    });
    check('commitChapter 2 succeeds', !commit.isError && commit.data.committed === true,
      JSON.stringify(commit.data));

    // Verify the commit landed on disk.
    const afterCommit = {
      ch2: await fs.access(path.join(fixtureBook, 'chapters', '002.md')).then(() => true).catch(() => false),
      draftGone: await fs.access(path.join(fixtureBook, 'drafts', '002.md')).then(() => false).catch(() => true),
      progress: await fs.readFile(path.join(fixtureBook, 'state', 'progress.md'), 'utf8'),
      summary: await fs.readFile(path.join(fixtureBook, 'state', 'summary.md'), 'utf8'),
      timeline: await fs.readFile(path.join(fixtureBook, 'state', 'timeline.md'), 'utf8'),
      knows: await fs.readFile(path.join(fixtureBook, 'state', 'knows.md'), 'utf8'),
      ledger: await fs.readFile(path.join(fixtureBook, 'state', 'foreshadowing.md'), 'utf8'),
    };
    check('commit on disk: ch2 in chapters/, draft removed, progress lists 1 + 2, next 3',
      afterCommit.ch2 && afterCommit.draftGone && afterCommit.progress.includes('- committed: 2') && afterCommit.progress.includes('Next chapter to write: 3'),
      `progress: ${JSON.stringify(afterCommit.progress)}`);
    check('commit on disk: summary/timeline/knows/ledger updated',
      afterCommit.summary.includes('Chapter 2:') && afterCommit.timeline.includes('Day 2 (chapter 2)') &&
      afterCommit.knows.includes('unsigned letter exists') && afterCommit.ledger.includes('F02 | planted: 2 | payoff_due: 6'),
      '');

    const ch2committed = await client.callTool('getChapter', { book: 'mini-book', chapter: 2 });
    check('getChapter 2 now reports committed', !ch2committed.isError && ch2committed.data.status === 'committed',
      `status: ${ch2committed.data.status}`);

    const ledger = await client.callTool('listForeshadowing', { book: 'mini-book' });
    const openThreads = (ledger.data.threads || []).filter((t) => t.status === 'open');
    check('listForeshadowing shows F01 + F02 open, none overdue',
      !ledger.isError && openThreads.length === 2 && (ledger.data.threads || []).filter((t) => t.overdue).length === 0,
      `open: ${openThreads.map((f) => f.id).join(',')}`);

    const rollback = await client.callTool('rollbackChapter', { book: 'mini-book', chapter: 2 });
    check('rollbackChapter 2 succeeds', !rollback.isError && rollback.data.status === 'draft',
      JSON.stringify(rollback.data));
    const afterRollback = {
      ch2Gone: await fs.access(path.join(fixtureBook, 'chapters', '002.md')).then(() => false).catch(() => true),
      draftBack: await fs.access(path.join(fixtureBook, 'drafts', '002.md')).then(() => true).catch(() => false),
      progress: await fs.readFile(path.join(fixtureBook, 'state', 'progress.md'), 'utf8'),
      summary: await fs.readFile(path.join(fixtureBook, 'state', 'summary.md'), 'utf8'),
      ledger: await fs.readFile(path.join(fixtureBook, 'state', 'foreshadowing.md'), 'utf8'),
      knows: await fs.readFile(path.join(fixtureBook, 'state', 'knows.md'), 'utf8'),
    };
    check('rollback on disk: ch2 back in drafts/, progress back to [1] next 2, F02 + ch2 facts removed',
      afterRollback.ch2Gone && afterRollback.draftBack && !afterRollback.progress.includes('- committed: 2') &&
      afterRollback.progress.includes('Next chapter to write: 2') && !afterRollback.ledger.includes('F02') &&
      !afterRollback.summary.includes('Chapter 2:') && !afterRollback.knows.includes('unsigned letter exists'),
      `progress: ${JSON.stringify(afterRollback.progress)}`);

    const scan = await client.callTool('marketScan', {});
    check('marketScan with no scan files says so honestly', !scan.isError && scan.data.found === false && /add one/i.test(scan.data.message),
      JSON.stringify(scan.data).slice(0, 200));

    const workflow = await client.callTool('getWorkflow', {});
    check('getWorkflow returns skill text + hard rules', !workflow.isError && workflow.data.skillText.includes('Hook handoff') && workflow.data.hardRules.length >= 10,
      `hardRules: ${workflow.data.hardRules.length}`);

    // ---- v2.2.0–v2.4.0 user-driven tools --------------------------------
    // The outline below matches the mini-book fixture's committed chapter 1
    // exactly (title, hook, desire, characters, F01, beat keywords in the
    // prose), so fidelity + contract checks pass on it.
    const goodOutline = {
      book: { title: '迷你测试', language: 'zh', targetChapters: 2 },
      arcs: [{ name: '卷一', range: '1-2', frozen: false }],
      chapters: [
        {
          chapter: 1, title: '钥匙断了', desire: 'curiosity', payoffSize: 'small',
          hook: '钥匙断了，而上一世，它明明一直在门后的钉子上',
          characters: ['阿测', '阿验'], foreshadowingPlanted: ['F01'], foreshadowingPaid: [],
          mustHappen: [
            // Keywords must appear in the chapter BODY (check_fidelity strips
            // the frontmatter first) — 老宅 only appears in the contract
            // frontmatter, so it cannot be a keyword here.
            { beat: '阿测回到三年前，回到老宅', keywords: ['梧桐树', '闹钟'] },
            { beat: '她去书房看抽屉，发现抽屉上了锁、钥匙断了', keywords: ['书房', '抽屉'] },
          ],
        },
        {
          chapter: 2, title: '没有落款的信', desire: 'curiosity', payoffSize: 'small',
          hook: '信纸的水印属于一家三年前就关门的旧书店，而店主死后店就一直锁着',
          characters: ['阿测'], foreshadowingPlanted: ['F02'], foreshadowingPaid: [],
          mustHappen: [
            { beat: '阿测在书房找到一封没有落款的信', keywords: ['书房', '信'] },
          ],
        },
      ],
      characters: [
        { name: '阿测', age: 23, role: '主角', want: '弄清楚抽屉里的东西是谁的', flaw: '太急于求证' },
        { name: '阿验', age: 26, role: '兄长', want: '护住妹妹', flaw: '话太少' },
      ],
      threads: [
        { id: 'F01', planted: 1, payoffDue: 5, status: 'open', thread: '书房抽屉上锁，钥匙断了' },
        { id: 'F02', planted: 2, payoffDue: 6, status: 'open', thread: '没有落款的信，信纸有旧书店水印' },
      ],
    };
    const level0 = await client.callTool('getSubmissionLevel', { book: 'mini-book' });
    check('getSubmissionLevel before submit is L0', !level0.isError && level0.data.level.some((l) => l.startsWith('LEVEL: 0')),
      JSON.stringify(level0.data.level));
    const submitted = await client.callTool('submitUserOutline', { book: 'mini-book', outline: goodOutline, characters: goodOutline.characters, threads: goodOutline.threads });
    check('submitUserOutline writes files + validation passes', !submitted.isError && submitted.data.validation.pass === true,
      JSON.stringify(submitted.data.validation));
    const levelAfter = await client.callTool('getSubmissionLevel', { book: 'mini-book' });
    check('getSubmissionLevel after submit is L4 (drafts/ has ch2)', !levelAfter.isError && levelAfter.data.level.some((l) => l.startsWith('LEVEL: 4')),
      JSON.stringify(levelAfter.data.level));
    const validated = await client.callTool('validateSubmission', { book: 'mini-book' });
    check('validateSubmission passes on the submitted outline', !validated.isError && validated.data.pass === true,
      JSON.stringify(validated.data));
    const fidelity = await client.callTool('checkFidelity', { book: 'mini-book' });
    check('checkFidelity passes (ch1 matches the outline)', !fidelity.isError && fidelity.data.pass === true,
      JSON.stringify(fidelity.data));
    const contractCheck = await client.callTool('checkContract', { book: 'mini-book' });
    check('checkContract passes (contracts match prose)', !contractCheck.isError && contractCheck.data.pass === true,
      JSON.stringify(contractCheck.data));
    const outlineOnDisk = await fs.readFile(path.join(fixtureBook, 'user_submission', 'user_outline.yaml'), 'utf8');
    check('submitUserOutline wrote user_outline.yaml on disk', outlineOnDisk.includes('钥匙断了') && outlineOnDisk.includes('mode: user-driven'),
      outlineOnDisk.slice(0, 120));
    const badOutline = JSON.parse(JSON.stringify(goodOutline));
    badOutline.chapters[0].hook = '太短了';
    const badSubmit = await client.callTool('submitUserOutline', { book: 'mini-book', outline: badOutline, characters: goodOutline.characters, threads: goodOutline.threads });
    check('submitUserOutline with a too-short hook reports validation failure', !badSubmit.isError && badSubmit.data.validation.pass === false,
      JSON.stringify(badSubmit.data.validation));
    const restored = await client.callTool('submitUserOutline', { book: 'mini-book', outline: goodOutline, characters: goodOutline.characters, threads: goodOutline.threads });
    check('re-submit restores a passing outline', !restored.isError && restored.data.validation.pass === true,
      JSON.stringify(restored.data.validation));

    // ---- v2.1.0 ending-plan tools --------------------------------------
    const phaseNoTarget = await client.callTool('getPhase', { book: 'mini-book', chapter: 2 });
    check('getPhase with no target reports targetSet false (legacy fallback)',
      !phaseNoTarget.isError && phaseNoTarget.data.targetSet === false,
      JSON.stringify(phaseNoTarget.data));

    const savedEnding = await client.callTool('saveEndingPlan', {
      book: 'mini-book',
      endingSummary: 'SMOKE-ENDING-SUMMARY 阿测烧掉旧信放下执念',
      plannedEnding: 'SMOKE-PLANNED-ENDING 终局高潮在祠堂对质；主角归宿是离开小城；核心问题答案是信出自亡母之手',
    });
    check('saveEndingPlan stores the ending plan', !savedEnding.isError && savedEnding.data.saved.endingSummary === true,
      JSON.stringify(savedEnding.data));
    const endingPlan = await client.callTool('getEndingPlan', { book: 'mini-book' });
    check('getEndingPlan returns the full ending (director-only)',
      !endingPlan.isError && endingPlan.data.plannedEnding.includes('SMOKE-PLANNED-ENDING') && endingPlan.data.endingSummary.includes('SMOKE-ENDING-SUMMARY'),
      JSON.stringify(endingPlan.data).slice(0, 160));
    const bookRedacted = await client.callTool('getBook', { book: 'mini-book' });
    check('getBook redacts the planned ending but keeps the one-sentence summary',
      !bookRedacted.isError && !bookRedacted.data.outline['overview.md'].includes('SMOKE-PLANNED-ENDING') && bookRedacted.data.outline['overview.md'].includes('SMOKE-ENDING-SUMMARY'),
      '');

    const retarget5 = await client.callTool('retargetBook', { book: 'mini-book', targetChapters: 5 });
    check('retargetBook to T=5 succeeds (F01 payoff 5 inside window 6)',
      !retarget5.isError && retarget5.data.status === 'retargeted' && retarget5.data.winEnd === 6,
      JSON.stringify(retarget5.data));
    const phaseT5 = await client.callTool('getPhase', { book: 'mini-book', chapter: 2 });
    check('getPhase ch2 at T=5 is middle with the phase line',
      !phaseT5.isError && phaseT5.data.phase === 'middle' && phaseT5.data.phaseLine.includes('中盘博弈期'),
      JSON.stringify(phaseT5.data).slice(0, 200));
    const retarget3triage = await client.callTool('retargetBook', { book: 'mini-book', targetChapters: 3 });
    check('retargetBook to T=3 needs triage (F01 payoff 5 past window 4)',
      !retarget3triage.isError && retarget3triage.data.status === 'needs-triage' && retarget3triage.data.overWindow.some((t) => t.id === 'F01'),
      JSON.stringify(retarget3triage.data));
    const retarget3 = await client.callTool('retargetBook', {
      book: 'mini-book', targetChapters: 3, resolutions: [{ id: 'F01', action: 'archive' }],
    });
    check('retargetBook to T=3 with archive resolution succeeds',
      !retarget3.isError && retarget3.data.status === 'retargeted' && retarget3.data.archived.includes('F01'),
      JSON.stringify(retarget3.data));
    const ledgerAfter = await client.callTool('listForeshadowing', { book: 'mini-book' });
    check('F01 is archived after retarget',
      !ledgerAfter.isError && ledgerAfter.data.threads.find((t) => t.id === 'F01').status === 'archived',
      JSON.stringify(ledgerAfter.data.threads));

    const seed = await client.callTool('exportSequelSeed', { book: 'mini-book' });
    check('exportSequelSeed returns a v1 seed',
      !seed.isError && seed.data.seed.seedVersion === 1 && seed.data.seed.sourceBookId === 'mini-book' && seed.data.seed.completedAtChapter === 1,
      JSON.stringify(seed.data.seed).slice(0, 200));

    const gate3review = await client.callTool('completeBook', { book: 'mini-book' });
    check('completeBook review (no confirm) reports final chapter + no unclosed threads',
      !gate3review.isError && gate3review.data.status === 'review' && gate3review.data.finalChapter === 1 && gate3review.data.unclosedThreads.length === 0,
      JSON.stringify(gate3review.data));
    const gate3done = await client.callTool('completeBook', { book: 'mini-book', confirm: true });
    check('completeBook with confirm flips the book to completed',
      !gate3done.isError && gate3done.data.status === 'completed' && gate3done.data.completedAtChapter === 1,
      JSON.stringify(gate3done.data));
    const bookCompleted = await client.callTool('getBook', { book: 'mini-book' });
    check('getBook compass shows completed status',
      !bookCompleted.isError && bookCompleted.data.compass.bookStatus === 'completed',
      JSON.stringify(bookCompleted.data.compass));
    const reopened = await client.callTool('reopenBook', { book: 'mini-book' });
    check('reopenBook flips the book back to ongoing',
      !reopened.isError && reopened.data.status === 'ongoing',
      JSON.stringify(reopened.data));

    const badBook = await client.callTool('getBook', { book: 'does-not-exist' });
    check('getBook on unknown book returns an error, not invented data', badBook.isError && /not found/i.test(badBook.raw),
      badBook.raw.slice(0, 120));

    kill(proc);

    // 2. Streamable HTTP transport --------------------------------------
    const port = await freePort();
    const httpProc = spawn(process.execPath, [SERVER, '--transport', 'http', '--port', String(port), '--books', booksRoot, '--scans', scansRoot, '--python', PYTHON], { stdio: ['ignore', 'pipe', 'pipe'] });
    cleanup.push(httpProc);
    let httpUp = false;
    for (let i = 0; i < 40 && !httpUp; i++) {
      try {
        const r = await httpRpc(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke-test', version: '1.0.0' } } });
        httpUp = r.status === 200 && r.body && r.body.result;
      } catch { /* not up yet */ }
      if (!httpUp) await new Promise((r) => setTimeout(r, 250));
    }
    check('HTTP transport answers initialize on 127.0.0.1', httpUp, `port ${port}`);

    const httpList = await httpRpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'listBooks', arguments: {} } });
    const httpBooks = httpList.body && httpList.body.result && JSON.parse(httpList.body.result.content[0].text);
    check('HTTP tools/call listBooks works', httpList.status === 200 && httpBooks && httpBooks.books.some((b) => b.id === 'mini-book'),
      JSON.stringify(httpBooks && httpBooks.books));

    const httpAudit = await httpRpc(port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'auditChapter', arguments: { book: 'mini-book', chapter: 1 } } });
    const httpAuditData = httpAudit.body && httpAudit.body.result && JSON.parse(httpAudit.body.result.content[0].text);
    check('HTTP tools/call auditChapter 1 passes', httpAudit.status === 200 && httpAuditData && httpAuditData.pass === true,
      JSON.stringify(httpAuditData && httpAuditData.checks && httpAuditData.checks.map((r) => r.script + ':' + r.pass)));

    const get405 = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' });
    check('HTTP GET /mcp returns 405 (POST only)', get405.status === 405, `status ${get405.status}`);

    kill(httpProc);
  } finally {
    cleanup.forEach(kill);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  const bad = failures();
  console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
  if (bad.length > 0) {
    console.log('Failed checks:');
    for (const f of bad) console.log(`  - ${f.name}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
