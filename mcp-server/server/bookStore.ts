import fs from 'node:fs';
import path from 'node:path';
import type { BookProject, CommitProposal, TrashItem } from '../src/shared/types.ts';
import { createSampleEchoesBook } from '../src/shared/skillSpecs.ts';
import { formatBookAsMarkdownFiles } from '../src/shared/markdownFormat.ts';

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
  const updated: BookProject = {
    ...book,
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
  const updatedChapters = book.chapters.map((ch) =>
    ch.chapter === chNum
      ? {
          ...ch,
          status: 'committed' as const,
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
    ledgerMap.set(cleanId, { ...nf, id: cleanId, planted: chNum });
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
