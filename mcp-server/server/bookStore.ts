import fs from 'node:fs';
import path from 'node:path';
import type { BookProject, CommitProposal, RestructureSnapshot, RetargetInput, TrashItem } from '../src/shared/types.ts';
import { createSampleEchoesBook } from '../src/shared/skillSpecs.ts';
import { formatBookAsMarkdownFiles } from '../src/shared/markdownFormat.ts';
import { bigCadenceFor, effectiveTolerance } from '../src/shared/phase.ts';

export { formatBookAsMarkdownFiles };

const BOOKS_ROOT = path.resolve(process.cwd(), 'workspace_books');
const TRASH_ROOT = path.join(BOOKS_ROOT, '_trash');

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeBookToDisk(book: BookProject) {
  ensureDir(BOOKS_ROOT);
  const bookDir = path.join(BOOKS_ROOT, book.id);
  ensureDir(bookDir);
  fs.writeFileSync(path.join(bookDir, 'project.json'), JSON.stringify(book, null, 2), 'utf-8');

  const mdFiles = formatBookAsMarkdownFiles(book);
  for (const [relPath, content] of Object.entries(mdFiles)) {
    const fullPath = path.join(bookDir, relPath);
    ensureDir(path.dirname(fullPath));
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
}

export function initBookStore() {
  ensureDir(BOOKS_ROOT);
  const sampleDir = path.join(BOOKS_ROOT, 'sample-echoes', 'project.json');
  if (!fs.existsSync(sampleDir)) {
    const sample = createSampleEchoesBook();
    writeBookToDisk(sample);
  }
}

export function listBooks(): BookProject[] {
  initBookStore();
  const entries = fs.readdirSync(BOOKS_ROOT, { withFileTypes: true });
  const books: BookProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const p = path.join(BOOKS_ROOT, entry.name, 'project.json');
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        books.push(JSON.parse(raw) as BookProject);
      } catch {
        // skip corrupted folder
      }
    }
  }
  return books.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getBook(id: string): BookProject | null {
  initBookStore();
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  const p = path.join(BOOKS_ROOT, safeId, 'project.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as BookProject;
}

export function saveBook(book: BookProject): BookProject {
  // 乐观锁：罗盘目标/容差/结局/卷配置一旦变化，outlineRevision 自动 +1（服务端为准）。
  // 客户端传来的版本号不直接采信；正文提交、回滚等不碰罗盘的保存不会 bump。
  const old = book.id ? getBook(book.id) : null;
  let outlineRevision = book.outlineRevision ?? old?.outlineRevision ?? 1;
  if (old) {
    const changed =
      JSON.stringify(old.outline.compass.targetChapters) !==
        JSON.stringify(book.outline.compass.targetChapters) ||
      JSON.stringify(old.outline.compass.tolerance) !==
        JSON.stringify(book.outline.compass.tolerance) ||
      old.outline.compass.plannedEnding !== book.outline.compass.plannedEnding ||
      old.outline.compass.endingSummary !== book.outline.compass.endingSummary ||
      JSON.stringify(old.volumes ?? null) !== JSON.stringify(book.volumes ?? null);
    if (changed) outlineRevision = (old.outlineRevision ?? 1) + 1;
  }
  const updated: BookProject = {
    ...book,
    outlineRevision,
    updatedAt: new Date().toISOString(),
  };
  writeBookToDisk(updated);
  return updated;
}

export function deleteBook(id: string): boolean {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId || safeId === 'sample-echoes') return false;
  const bookDir = path.join(BOOKS_ROOT, safeId);
  if (fs.existsSync(bookDir)) {
    fs.rmSync(bookDir, { recursive: true, force: true });
  }
  return true;
}

export function listTrashOnDisk(): TrashItem[] {
  ensureDir(TRASH_ROOT);
  const files = fs.readdirSync(TRASH_ROOT);
  const items: TrashItem[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(TRASH_ROOT, file), 'utf-8');
      items.push(JSON.parse(raw) as TrashItem);
    } catch {
      // skip corrupted trash entry
    }
  }
  return items.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
}

export function saveTrashOnDisk(item: TrashItem): TrashItem {
  ensureDir(TRASH_ROOT);
  const safeId = item.trashId.replace(/[^a-zA-Z0-9_-]/g, '');
  fs.writeFileSync(path.join(TRASH_ROOT, `${safeId}.json`), JSON.stringify(item, null, 2), 'utf-8');
  return item;
}

export function deleteTrashOnDisk(trashId: string): boolean {
  const safeId = trashId.replace(/[^a-zA-Z0-9_-]/g, '');
  const target = path.join(TRASH_ROOT, `${safeId}.json`);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { force: true });
  }
  return true;
}

export function clearTrashOnDisk(): void {
  if (fs.existsSync(TRASH_ROOT)) {
    fs.rmSync(TRASH_ROOT, { recursive: true, force: true });
  }
  ensureDir(TRASH_ROOT);
}

export function applyAtomicChapterCommit(book: BookProject, proposal: CommitProposal): BookProject {
  const chNum = proposal.chapter;
  // 提交时记录当时的动态大节奏快照（手册 §六.1）：以后缩纲改目标也不会
  // 让已提交章被新节奏回溯判错；无快照的已提交章豁免。
  const cadenceSnapshot = bigCadenceFor(book.outline.compass.targetChapters);
  const updatedChapters = book.chapters.map((ch) =>
    ch.chapter === chNum
      ? {
          ...ch,
          status: 'committed' as const,
          contract: {
            ...ch.contract,
            ...(cadenceSnapshot != null ? { bigCadenceSnapshot: cadenceSnapshot } : {}),
          },
          updatedAt: new Date().toISOString(),
        }
      : ch
  );

  const committedSet = new Set(book.state.committedChapters);
  committedSet.add(chNum);
  const committedSorted = Array.from(committedSet).sort((a, b) => a - b);

  // Summaries
  const filteredSummaries = book.state.summaries.filter((s) => s.chapter !== chNum);
  filteredSummaries.push({ chapter: chNum, summary: proposal.summaryLine });
  filteredSummaries.sort((a, b) => a.chapter - b.chapter);

  // Timeline
  const filteredTimeline = book.state.timeline.filter((t) => t.chapter !== chNum);
  filteredTimeline.push({
    chapter: chNum,
    dayLabel: proposal.timelineDayLabel,
    event: proposal.timelineEvent,
  });
  filteredTimeline.sort((a, b) => a.chapter - b.chapter);

  // Auto-register any new named characters discovered/introduced in this chapter
  const existingBibleChars = [...book.bible.characters];
  const existingNameSet = new Set(existingBibleChars.map((c) => c.name.trim()));
  const charStateMap = new Map(book.state.characterStates.map((c) => [c.characterName, c.currentState]));

  for (let idx = 0; idx < (proposal.newCharacters || []).length; idx++) {
    const nc = proposal.newCharacters![idx];
    const cleanName = (nc.name || '').trim();
    if (!cleanName || existingNameSet.has(cleanName)) continue;
    existingNameSet.add(cleanName);
    existingBibleChars.push({
      id: `char-${chNum}-${Date.now()}-${idx}`,
      name: cleanName,
      age: nc.age || '成年',
      role: nc.role || '具名配角',
      dna: nc.dna || '有辨识度的外形或随身物件',
      want: nc.want || '保全自身立场并谋求利益',
      need: nc.need || '看清当前局势真相',
      flaw: nc.flaw || '各有算计、不轻信外人',
      arc: nc.arc || '随主线卷入核心冲突',
      ...(nc.speechStyle ? { speechStyle: nc.speechStyle } : {}),
      ...(nc.debutPlan ? { debutPlan: nc.debutPlan } : {}),
      introducedChapter: chNum,
    });
    if (!charStateMap.has(cleanName)) {
      charStateMap.set(cleanName, `${nc.role || '具名配角'}，第 ${chNum} 章登场：${nc.want || '待定'}`);
    }
  }

  // Character states
  for (const upd of proposal.characterStateUpdates) {
    charStateMap.set(upd.characterName, upd.currentState);
  }
  const characterStates = Array.from(charStateMap.entries()).map(([characterName, currentState]) => ({
    characterName,
    currentState,
  }));

  // Knows
  const existingKnows = book.state.knows.filter((k) => k.learnedChapter !== chNum);
  const newKnows = proposal.newKnowsEntries.map((k, idx) => ({
    ...k,
    id: `k-${chNum}-${Date.now()}-${idx}`,
  }));

  // Foreshadowing (prevent overwriting earlier planted threads & handle updates/payoffs cleanly)
  const ledgerMap = new Map(book.state.foreshadowing.map((f) => [f.id.trim(), { ...f }]));
  for (const nf of proposal.newForeshadowing) {
    const cleanId = (nf.id || '').trim();
    if (!cleanId) continue;
    const existing = ledgerMap.get(cleanId);
    if (existing && existing.planted !== chNum) {
      // Never allow a newly committed chapter to overwrite an earlier chapter's planted thread
      continue;
    }
    // 新伏笔默认 scope 'series' / kind 'other'（提交提取时 AI 自动标定）。
    ledgerMap.set(cleanId, { ...nf, id: cleanId, planted: chNum, scope: nf.scope ?? 'series', kind: nf.kind ?? 'other' });
  }
  for (const upd of proposal.updatedForeshadowing || []) {
    const cleanId = (upd.id || '').trim();
    const existing = ledgerMap.get(cleanId);
    if (existing && existing.status !== 'paid') {
      existing.status = upd.status;
      if (upd.newPayoffDue && upd.newPayoffDue > chNum) {
        existing.payoffDue = upd.newPayoffDue;
      }
      if (upd.note) {
        existing.deferReason = upd.note;
      }
      delete existing.targetChapter;
      ledgerMap.set(cleanId, existing);
    }
  }
  for (const paidId of proposal.paidForeshadowingIds) {
    const cleanId = (paidId || '').trim();
    const existing = ledgerMap.get(cleanId);
    if (existing) {
      existing.status = 'paid';
      existing.paidChapter = chNum;
      delete existing.targetChapter;
      ledgerMap.set(cleanId, existing);
    }
  }

  // Roadmap status sync
  const targetChapterObj = updatedChapters.find((c) => c.chapter === chNum);
  const resolvedDesire =
    targetChapterObj?.contract.desire && targetChapterObj.contract.desire !== 'auto'
      ? targetChapterObj.contract.desire
      : 'curiosity';
  const roadmapExists = book.outline.roadmap.some((r) => r.chapter === chNum);
  const roadmap = roadmapExists
    ? book.outline.roadmap.map((r) =>
        r.chapter === chNum
          ? {
              ...r,
              desire:
                targetChapterObj?.contract.desire && targetChapterObj.contract.desire !== 'auto'
                  ? targetChapterObj.contract.desire
                  : r.desire,
              hook: targetChapterObj?.contract.hook || r.hook,
              status: 'committed' as const,
            }
          : r
      )
    : [
        ...book.outline.roadmap,
        {
          chapter: chNum,
          goal: targetChapterObj?.contract.title || `第${chNum}章`,
          desire: resolvedDesire,
          hook: targetChapterObj?.contract.hook || '',
          status: 'committed' as const,
        },
      ].sort((a, b) => a.chapter - b.chapter);

  const maxCommitted = committedSorted.length > 0 ? committedSorted[committedSorted.length - 1] : 0;

  return saveBook({
    ...book,
    gate2Approved: committedSorted.length >= 3 ? true : book.gate2Approved,
    bible: {
      ...book.bible,
      characters: existingBibleChars,
    },
    chapters: updatedChapters,
    outline: {
      ...book.outline,
      roadmap,
    },
    state: {
      committedChapters: committedSorted,
      nextChapter: maxCommitted + 1,
      summaries: filteredSummaries,
      characterStates,
      foreshadowing: Array.from(ledgerMap.values()),
      knows: [...existingKnows, ...newKnows],
      timeline: filteredTimeline,
    },
  });
}

export function rollbackChapterCommit(book: BookProject, chNum: number): BookProject {
  const updatedChapters = book.chapters.map((ch) =>
    ch.chapter === chNum
      ? {
          ...ch,
          status: 'draft' as const,
          updatedAt: new Date().toISOString(),
        }
      : ch
  );

  const committedSorted = book.state.committedChapters.filter((c) => c !== chNum);
  const summaries = book.state.summaries.filter((s) => s.chapter !== chNum);
  const timeline = book.state.timeline.filter((t) => t.chapter !== chNum);
  const knows = book.state.knows.filter((k) => k.learnedChapter !== chNum);
  const foreshadowing = book.state.foreshadowing
    .filter((f) => f.planted !== chNum)
    .map((f) =>
      f.paidChapter === chNum
        ? { ...f, status: 'open' as const, paidChapter: undefined }
        : f
    );
  const remainingCharacters = book.bible.characters.filter(
    (c) => c.introducedChapter !== chNum
  );
  const roadmap = book.outline.roadmap.map((r) =>
    r.chapter === chNum ? { ...r, status: 'draft' as const } : r
  );

  return saveBook({
    ...book,
    bible: {
      ...book.bible,
      characters: remainingCharacters,
    },
    chapters: updatedChapters,
    outline: { ...book.outline, roadmap },
    state: {
      ...book.state,
      committedChapters: committedSorted,
      nextChapter: chNum,
      summaries,
      timeline,
      knows,
      foreshadowing,
    },
  });
}

// ------------------------------------------------------------------ retarget
// 调整卷纲（手册 §五.2.4）：改目标章数/容差/结局，先校验超窗伏笔必须有去处
// （压缩进窗内或归档），保存时记 restructureLog 快照，可恢复。

function snapshotOf(book: BookProject): RestructureSnapshot {
  return {
    targetChapters: book.outline.compass.targetChapters,
    tolerance: book.outline.compass.tolerance,
    plannedEnding: book.outline.compass.plannedEnding,
    endingSummary: book.outline.compass.endingSummary,
    threads: book.state.foreshadowing.map((f) => ({
      id: f.id,
      payoffDue: f.payoffDue,
      status: f.status,
    })),
  };
}

function maxCommittedMainChapter(book: BookProject): number {
  const mains = book.state.committedChapters.filter((n) => {
    const ch = book.chapters.find((c) => c.chapter === n);
    return (ch?.contract.chapterKind ?? 'main') === 'main';
  });
  return mains.length > 0 ? Math.max(...mains) : 0;
}

export function applyRetarget(bookId: string, input: RetargetInput): BookProject {
  const book = getBook(bookId);
  if (!book) throw new Error('未找到指定小说工程');
  const newTol = effectiveTolerance(input.targetChapters, input.tolerance);
  const maxCommitted = maxCommittedMainChapter(book);
  if (input.targetChapters + newTol < maxCommitted) {
    throw new Error(
      `新目标 ${input.targetChapters} 章（±${newTol}，最晚第 ${input.targetChapters + newTol} 章）小于已提交的最大主线章号 ${maxCommitted}，无法收回已写章节；建议改为“在当前章 +N 章收尾”（如目标 ${maxCommitted + 10} 章）。`
    );
  }
  // 冲突校验：所有未结（open/progressing/deferred）且 payoffDue 超窗的伏笔，
  // 必须有一条处理意见（压缩到窗内，或归档）；否则拒绝保存。
  const winEnd = input.targetChapters + newTol;
  const resolutionMap = new Map(input.threadResolutions.map((r) => [r.id.trim(), r]));
  const overWindow = book.state.foreshadowing.filter(
    (f) =>
      f.status !== 'paid' &&
      f.status !== 'archived' &&
      f.payoffDue > winEnd
  );
  for (const thread of overWindow) {
    const res = resolutionMap.get(thread.id.trim());
    if (!res) {
      throw new Error(`伏笔 ${thread.id}（${thread.thread}）兑现期第 ${thread.payoffDue} 章超出新完结窗口（最晚第 ${winEnd} 章），请先选择压缩或归档。`);
    }
    if (res.action === 'compress') {
      if (res.newPayoffDue == null || res.newPayoffDue > winEnd || res.newPayoffDue <= thread.planted) {
        throw new Error(`伏笔 ${thread.id} 的压缩兑现期须在第 ${thread.planted + 1}–${winEnd} 章之间。`);
      }
    }
    if (res.action === 'keep') {
      throw new Error(`伏笔 ${thread.id} 兑现期第 ${thread.payoffDue} 章超出新完结窗口，不能选“保留原样”，请选择压缩或归档。`);
    }
  }

  const before = snapshotOf(book);
  const foreshadowing = book.state.foreshadowing.map((f) => {
    const res = resolutionMap.get(f.id.trim());
    if (!res) return f;
    if (res.action === 'compress') {
      return { ...f, payoffDue: res.newPayoffDue!, status: f.status };
    }
    if (res.action === 'archive') {
      return { ...f, status: 'archived' as const };
    }
    return f;
  });
  const changed: BookProject = {
    ...book,
    outline: {
      ...book.outline,
      compass: {
        ...book.outline.compass,
        targetChapters: input.targetChapters,
        tolerance: input.tolerance,
        ...(input.plannedEnding !== undefined ? { plannedEnding: input.plannedEnding } : {}),
        ...(input.endingSummary !== undefined ? { endingSummary: input.endingSummary } : {}),
      },
    },
    state: { ...book.state, foreshadowing },
  };
  const updated: BookProject = {
    ...changed,
    restructureLog: [
      ...(book.restructureLog ?? []),
      {
        at: new Date().toISOString(),
        kind: 'retarget' as const,
        before,
        after: snapshotOf(changed),
        note: input.note,
      },
    ],
  };
  return saveBook(updated);
}

export function restoreRestructure(bookId: string, logIndex: number): BookProject {
  const book = getBook(bookId);
  if (!book) throw new Error('未找到指定小说工程');
  const entry = (book.restructureLog ?? [])[logIndex];
  if (!entry) throw new Error('找不到对应的调整卷纲快照');
  const target = entry.before;
  if (target.targetChapters != null) {
    const tol = effectiveTolerance(target.targetChapters, target.tolerance);
    const maxCommitted = maxCommittedMainChapter(book);
    if (target.targetChapters + tol < maxCommitted) {
      throw new Error(
        `该快照的目标 ${target.targetChapters} 章（±${tol}）小于当前已提交的最大主线章号 ${maxCommitted}，无法恢复（已写章节无法收回）。`
      );
    }
  }
  const before = snapshotOf(book);
  const threadMap = new Map(target.threads.map((t) => [t.id, t]));
  const foreshadowing = book.state.foreshadowing.map((f) => {
    const snap = threadMap.get(f.id);
    if (!snap) return f;
    return { ...f, payoffDue: snap.payoffDue, status: snap.status };
  });
  const updated: BookProject = {
    ...book,
    outline: {
      ...book.outline,
      compass: {
        ...book.outline.compass,
        targetChapters: target.targetChapters,
        tolerance: target.tolerance,
        plannedEnding: target.plannedEnding,
        endingSummary: target.endingSummary,
      },
    },
    state: { ...book.state, foreshadowing },
    restructureLog: [
      ...(book.restructureLog ?? []),
      {
        at: new Date().toISOString(),
        kind: 'restore' as const,
        before,
        after: target,
        note: `恢复 ${entry.at} 的调整快照`,
      },
    ],
  };
  return saveBook(updated);
}
