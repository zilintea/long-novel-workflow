import { useEffect, useState } from 'react';
import { Archive, DatabaseBackup, FolderOutput, Trash2 } from 'lucide-react';
import type { BookProject, ChapterItem, TrashItem } from './shared/types.ts';
import { DEFAULT_SLOP_LIST } from './shared/skillSpecs.ts';
import {
  clearTrashApi,
  createBookApi,
  deleteBookApi,
  deleteTrashApi,
  fetchBooks,
  fetchTrashApi,
  saveBookApi,
  saveTrashApi,
} from './lib/api.ts';
import {
  buildWorkspaceBackupJson,
  clearCachedTrash,
  deleteCachedBook,
  deleteCachedTrashItem,
  getActiveBookIdCache,
  getLastBackupTime,
  loadCachedBooks,
  loadCachedTrash,
  markBackupDone,
  parseWorkspaceBackupJson,
  saveAllCachedBooks,
  saveAllCachedTrash,
  saveCachedBook,
  saveCachedTrashItem,
  setActiveBookIdCache,
} from './lib/localCache.ts';
import { TopBar, type WorkspaceTab } from './components/TopBar.tsx';
import { StudioWorkspace } from './components/StudioWorkspace.tsx';
import { BibleView } from './components/BibleView.tsx';
import { LedgerOutlineView } from './components/LedgerOutlineView.tsx';
import { SkillKernelView } from './components/SkillKernelView.tsx';
import { NewBookModal } from './components/NewBookModal.tsx';
import { ExportModal } from './components/ExportModal.tsx';
import { TrashModal } from './components/TrashModal.tsx';

function mergeBookCollections(
  serverBooks: BookProject[],
  cachedBooks: BookProject[]
): { merged: BookProject[]; needsServerSync: BookProject[] } {
  const map = new Map<string, BookProject>();
  const serverMap = new Map<string, BookProject>();

  for (const sb of serverBooks) {
    map.set(sb.id, sb);
    serverMap.set(sb.id, sb);
  }

  const needsServerSync: BookProject[] = [];

  for (const cb of cachedBooks) {
    const existing = map.get(cb.id);
    if (!existing) {
      map.set(cb.id, cb);
      needsServerSync.push(cb);
      continue;
    }

    const cachedTime = Date.parse(cb.updatedAt || '') || 0;
    const serverTime = Date.parse(existing.updatedAt || '') || 0;
    const cachedRicherSample =
      cb.id === 'sample-echoes' &&
      (cb.chapters.length > existing.chapters.length ||
        cb.state.committedChapters.length > existing.state.committedChapters.length);

    if (cachedTime > serverTime || cachedRicherSample) {
      map.set(cb.id, cb);
      needsServerSync.push(cb);
    }
  }

  const merged = Array.from(map.values()).sort((a, b) =>
    (b.updatedAt || '').localeCompare(a.updatedAt || '')
  );

  return { merged, needsServerSync };
}

function mergeTrashCollections(
  serverTrash: TrashItem[],
  cachedTrash: TrashItem[]
): { merged: TrashItem[]; needsServerSync: TrashItem[] } {
  const map = new Map<string, TrashItem>();
  for (const st of serverTrash) {
    map.set(st.trashId, st);
  }
  const needsServerSync: TrashItem[] = [];
  for (const ct of cachedTrash) {
    if (!map.has(ct.trashId)) {
      map.set(ct.trashId, ct);
      needsServerSync.push(ct);
    }
  }
  const merged = Array.from(map.values()).sort((a, b) =>
    (b.deletedAt || '').localeCompare(a.deletedAt || '')
  );
  return { merged, needsServerSync };
}

export default function App() {
  const [books, setBooks] = useState<BookProject[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [activeBookId, setActiveBookId] = useState<string>(
    () => getActiveBookIdCache() || 'sample-echoes'
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('studio');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newBookOpen, setNewBookOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [trashModalOpen, setTrashModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(() => getLastBackupTime());
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  const [slopZh, setSlopZh] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lnw_slop_zh');
      return saved ? JSON.parse(saved) : DEFAULT_SLOP_LIST.zh;
    } catch {
      return DEFAULT_SLOP_LIST.zh;
    }
  });

  const [slopEn, setSlopEn] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lnw_slop_en');
      return saved ? JSON.parse(saved) : DEFAULT_SLOP_LIST.en;
    } catch {
      return DEFAULT_SLOP_LIST.en;
    }
  });

  useEffect(() => {
    localStorage.setItem('lnw_slop_zh', JSON.stringify(slopZh));
  }, [slopZh]);

  useEffect(() => {
    localStorage.setItem('lnw_slop_en', JSON.stringify(slopEn));
  }, [slopEn]);

  useEffect(() => {
    if (activeBookId) {
      setActiveBookIdCache(activeBookId);
    }
  }, [activeBookId]);

  const loadAllBooks = async (preferredId?: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [cached, cachedTrash] = await Promise.all([loadCachedBooks(), loadCachedTrash()]);
      let serverList: BookProject[] = [];
      let serverTrash: TrashItem[] = [];
      let serverFetchError: unknown = null;

      try {
        serverList = await fetchBooks();
      } catch (err) {
        serverFetchError = err;
      }

      try {
        serverTrash = await fetchTrashApi();
      } catch {
        // Ignore if trash endpoint unavailable
      }

      if (serverList.length === 0 && cached.length === 0 && serverFetchError) {
        throw serverFetchError;
      }

      const { merged, needsServerSync } = mergeBookCollections(serverList, cached);
      setBooks(merged);
      await saveAllCachedBooks(merged);

      const trashMerge = mergeTrashCollections(serverTrash, cachedTrash);
      setTrashItems(trashMerge.merged);
      await saveAllCachedTrash(trashMerge.merged);

      const desiredId = preferredId || getActiveBookIdCache() || activeBookId;
      if (desiredId && merged.some((b) => b.id === desiredId)) {
        setActiveBookId(desiredId);
      } else if (merged.length > 0) {
        setActiveBookId(merged[0].id);
      }

      // Silently rehydrate ephemeral server disk from browser IndexedDB cache
      if (needsServerSync.length > 0) {
        void Promise.allSettled(needsServerSync.map((b) => createBookApi(b)));
      }
      if (trashMerge.needsServerSync.length > 0) {
        void Promise.allSettled(trashMerge.needsServerSync.map((t) => saveTrashApi(t)));
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAllBooks();
  }, []);

  const activeBook = books.find((b) => b.id === activeBookId) || books[0];

  const handleSaveBook = async (updated: BookProject) => {
    const stamped: BookProject = {
      ...updated,
      updatedAt: new Date().toISOString(),
    };

    // Always persist to local IndexedDB first so closing immediately never loses data
    await saveCachedBook(stamped);
    setBooks((prev) => prev.map((b) => (b.id === stamped.id ? stamped : b)));

    try {
      const saved = await saveBookApi(stamped);
      await saveCachedBook(saved);
      setBooks((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
    } catch {
      // Keep local browser cache intact if backend temporarily restarts
    }
  };

  const handleCreatedBook = async (created: BookProject) => {
    await saveCachedBook(created);
    setBooks((prev) => [created, ...prev.filter((b) => b.id !== created.id)]);
    setActiveBookId(created.id);
    setActiveBookIdCache(created.id);
    setActiveTab('studio');
  };

  const handleDeleteCurrentBook = async () => {
    if (!activeBook || activeBook.id === 'sample-echoes') return;
    const deletedTitle = activeBook.title;
    const trashItem: TrashItem = {
      kind: 'book',
      trashId: `trash-book-${activeBook.id}-${Date.now()}`,
      deletedAt: new Date().toISOString(),
      book: activeBook,
    };

    await saveCachedTrashItem(trashItem);
    setTrashItems((prev) => [trashItem, ...prev.filter((t) => t.trashId !== trashItem.trashId)]);
    void saveTrashApi(trashItem).catch(() => {});

    await deleteCachedBook(activeBook.id);
    await deleteBookApi(activeBook.id).catch(() => {});
    setConfirmDelete(false);
    const remaining = books.filter((b) => b.id !== activeBook.id);
    setBooks(remaining);
    if (remaining.length > 0) {
      setActiveBookId(remaining[0].id);
      setActiveBookIdCache(remaining[0].id);
    }
    setBackupNotice(`已将《${deletedTitle}》移入回收站，可随时点击「回收站」恢复`);
    setTimeout(() => setBackupNotice(null), 4500);
  };

  const handleMoveChapterToTrash = async (chapter: ChapterItem) => {
    if (!activeBook) return;
    const trashItem: TrashItem = {
      kind: 'chapter',
      trashId: `trash-ch-${activeBook.id}-${chapter.chapter}-${Date.now()}`,
      deletedAt: new Date().toISOString(),
      bookId: activeBook.id,
      bookTitle: activeBook.title,
      chapter,
    };
    await saveCachedTrashItem(trashItem);
    setTrashItems((prev) => [trashItem, ...prev.filter((t) => t.trashId !== trashItem.trashId)]);
    void saveTrashApi(trashItem).catch(() => {});
    setBackupNotice(`已将《${activeBook.title}》第 ${chapter.chapter} 章草稿移入回收站`);
    setTimeout(() => setBackupNotice(null), 4500);
  };

  const handleRestoreTrashItem = async (item: TrashItem) => {
    if (item.kind === 'book') {
      const idCollision = books.some((b) => b.id === item.book.id);
      const restoredBook: BookProject = {
        ...item.book,
        id: idCollision ? `book-${Date.now()}` : item.book.id,
        title: idCollision ? `${item.book.title}（已恢复）` : item.book.title,
        updatedAt: new Date().toISOString(),
      };
      await saveCachedBook(restoredBook);
      try {
        await createBookApi(restoredBook);
      } catch {
        // Keep browser cache intact
      }
      setBooks((prev) => [restoredBook, ...prev.filter((b) => b.id !== restoredBook.id)]);
      setActiveBookId(restoredBook.id);
      setActiveBookIdCache(restoredBook.id);
    } else {
      const targetBook = books.find((b) => b.id === item.bookId);
      if (!targetBook) {
        const parentInTrash = trashItems.some(
          (t) => t.kind === 'book' && t.book.id === item.bookId
        );
        throw new Error(
          parentInTrash
            ? `所属小说《${item.bookTitle}》目前也在回收站中，请先恢复该小说，再恢复此章节。`
            : `所属小说工程《${item.bookTitle}》已不存在或已被彻底删除，无法单独恢复该章节。`
        );
      }
      const chCollision = targetBook.chapters.some((c) => c.chapter === item.chapter.chapter);
      const nextNum = chCollision
        ? targetBook.chapters.reduce((max, c) => Math.max(max, c.chapter), 0) + 1
        : item.chapter.chapter;
      const restoredChapter: ChapterItem = {
        ...item.chapter,
        chapter: nextNum,
        status: 'draft',
        contract: {
          ...item.chapter.contract,
          chapter: nextNum,
        },
        updatedAt: new Date().toISOString(),
      };
      await handleSaveBook({
        ...targetBook,
        chapters: [...targetBook.chapters, restoredChapter].sort((a, b) => a.chapter - b.chapter),
      });
      setActiveBookId(targetBook.id);
      setActiveBookIdCache(targetBook.id);
    }

    await deleteCachedTrashItem(item.trashId);
    setTrashItems((prev) => prev.filter((t) => t.trashId !== item.trashId));
    void deleteTrashApi(item.trashId).catch(() => {});
  };

  const handlePermanentDeleteTrashItem = async (trashId: string) => {
    await deleteCachedTrashItem(trashId);
    setTrashItems((prev) => prev.filter((t) => t.trashId !== trashId));
    void deleteTrashApi(trashId).catch(() => {});
  };

  const handleEmptyTrash = async () => {
    await clearCachedTrash();
    setTrashItems([]);
    void clearTrashApi().catch(() => {});
  };

  const handleExportFullBackup = () => {
    const json = buildWorkspaceBackupJson(books, slopZh, slopEn, trashItems);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `long-novel-studio-backup-${dateStamp}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const ts = markBackupDone();
    setLastBackupAt(ts);
    setBackupNotice(`已导出完整备份（共 ${books.length} 本工程、${trashItems.length} 条回收站记录与词库配置）`);
    setTimeout(() => setBackupNotice(null), 4000);
  };

  const handleImportBackupFile = async (file: File) => {
    const text = await file.text();
    const payload = parseWorkspaceBackupJson(text);

    if (payload.slopZh.length > 0) setSlopZh(payload.slopZh);
    if (payload.slopEn.length > 0) setSlopEn(payload.slopEn);

    const { merged } = mergeBookCollections(books, payload.books);
    await saveAllCachedBooks(merged);
    setBooks(merged);

    if (payload.trash && payload.trash.length > 0) {
      const mergedTrash = mergeTrashCollections(trashItems, payload.trash).merged;
      await saveAllCachedTrash(mergedTrash);
      setTrashItems(mergedTrash);
      void Promise.allSettled(payload.trash.map((t) => saveTrashApi(t)));
    }

    const firstImported = payload.books.find((b) => b.id !== 'sample-echoes') || payload.books[0];
    if (firstImported) {
      setActiveBookId(firstImported.id);
      setActiveBookIdCache(firstImported.id);
    }

    await Promise.allSettled(payload.books.map((b) => createBookApi(b)));
    setBackupNotice(`已从备份恢复 ${payload.books.length} 本小说工程并同步缓存`);
    setTimeout(() => setBackupNotice(null), 4500);
  };

  const userBookCount = books.filter((b) => b.id !== 'sample-echoes').length;
  const backupStatusText = lastBackupAt
    ? `上次备份 ${new Date(lastBackupAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}`
    : userBookCount > 0
    ? '尚未导出 .json 备份'
    : '本地缓存已开启';

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900">
      <TopBar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        onOpenNewBook={() => setNewBookOpen(true)}
      />

      {/* Workspace Sub-bar */}
      {activeBook && (
        <div className="bg-white border-b border-zinc-200">
          <div className="max-w-[1440px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 min-w-0">
              <div className="flex items-center gap-2">
                <label htmlFor="book-selector" className="text-xs font-medium text-zinc-500">
                  当前工程
                </label>
                <select
                  id="book-selector"
                  value={activeBook.id}
                  onChange={(e) => {
                    setActiveBookId(e.target.value);
                    setConfirmDelete(false);
                  }}
                  className="px-3 py-1.5 text-sm font-medium text-zinc-900 bg-zinc-50 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      《{b.title}》{b.id === 'sample-echoes' ? '（示例样书）' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="hidden md:flex items-center gap-2 text-xs text-zinc-500 truncate">
                <span>{activeBook.language === 'zh' ? '中文' : 'English'}</span>
                <span aria-hidden="true">·</span>
                <span>{activeBook.platform}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  已提交 {activeBook.state.committedChapters.length} 章
                </span>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-700">已自动缓存本地</span>
                <span aria-hidden="true">·</span>
                <span className={!lastBackupAt && userBookCount > 0 ? 'text-amber-700 font-medium' : ''}>
                  {backupStatusText}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleExportFullBackup}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-zinc-50 border border-zinc-300 hover:bg-zinc-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                title="导出所有书籍与配置为 .json 备份文件"
              >
                <DatabaseBackup className="w-3.5 h-3.5" />
                <span>备份全部 (.json)</span>
              </button>

              <button
                type="button"
                onClick={() => setExportModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderOutput className="w-3.5 h-3.5" />
                <span>导出 / 恢复</span>
              </button>

              <button
                type="button"
                onClick={() => setTrashModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                title="查看与恢复已删除的小说或章节"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>回收站 ({trashItems.length})</span>
              </button>

              {activeBook.id !== 'sample-echoes' && (
                <>
                  {!confirmDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-600 hover:text-red-700 border border-zinc-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                      title="将本书工程移入回收站（可随时恢复）"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>移入回收站</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleDeleteCurrentBook}
                        className="px-2.5 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        确认移入
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {backupNotice && (
            <div className="max-w-[1440px] mx-auto px-6 pb-2.5">
              <div className="px-3 py-1.5 text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg">
                {backupNotice}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1">
        {loading ? (
          <div className="max-w-[1440px] mx-auto px-6 py-12 text-sm text-zinc-500">
            正在加载小说工程与本地缓存...
          </div>
        ) : loadError ? (
          <div className="max-w-[1440px] mx-auto px-6 py-12">
            <div className="p-4 bg-red-50 border border-red-200 text-red-900 rounded-xl text-sm">
              加载工程失败：{loadError}
            </div>
          </div>
        ) : !activeBook ? (
          <div className="max-w-[1440px] mx-auto px-6 py-16 text-center">
            <p className="text-sm text-zinc-600 mb-4">当前暂无小说工程</p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setNewBookOpen(true)}
                className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded-lg cursor-pointer"
              >
                新建、导入或恢复小说
              </button>
              {trashItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTrashModalOpen(true)}
                  className="px-4 py-2 text-sm font-medium bg-white text-zinc-700 border border-zinc-300 rounded-lg cursor-pointer"
                >
                  打开回收站 ({trashItems.length})
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'studio' && (
              <StudioWorkspace
                book={activeBook}
                slopZh={slopZh}
                slopEn={slopEn}
                onSaveBook={handleSaveBook}
                onOpenBible={() => setActiveTab('bible')}
                onMoveChapterToTrash={handleMoveChapterToTrash}
              />
            )}
            {activeTab === 'bible' && (
              <BibleView book={activeBook} onSaveBook={handleSaveBook} />
            )}
            {activeTab === 'ledger' && (
              <LedgerOutlineView book={activeBook} onSaveBook={handleSaveBook} />
            )}
            {activeTab === 'skills' && (
              <SkillKernelView
                slopZh={slopZh}
                slopEn={slopEn}
                onUpdateSlopZh={setSlopZh}
                onUpdateSlopEn={setSlopEn}
              />
            )}
          </>
        )}
      </main>

      <NewBookModal
        isOpen={newBookOpen}
        onClose={() => setNewBookOpen(false)}
        onCreated={handleCreatedBook}
        onImportBackupFile={handleImportBackupFile}
      />

      <ExportModal
        book={exportModalOpen && activeBook ? activeBook : null}
        allBooksCount={books.length}
        lastBackupAt={lastBackupAt}
        onExportFullBackup={handleExportFullBackup}
        onImportBackupFile={handleImportBackupFile}
        onClose={() => setExportModalOpen(false)}
      />

      <TrashModal
        isOpen={trashModalOpen}
        items={trashItems}
        onRestore={handleRestoreTrashItem}
        onPermanentDelete={handlePermanentDeleteTrashItem}
        onEmptyTrash={handleEmptyTrash}
        onClose={() => setTrashModalOpen(false)}
      />
    </div>
  );
}
