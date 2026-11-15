import React, { useState } from 'react';
import { BookOpen, FileText, RotateCcw, Trash2, X } from 'lucide-react';
import type { TrashItem } from '../shared/types.ts';

interface TrashModalProps {
  isOpen: boolean;
  items: TrashItem[];
  onRestore: (item: TrashItem) => Promise<void>;
  onPermanentDelete: (trashId: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  onClose: () => void;
}

export const TrashModal: React.FC<TrashModalProps> = ({
  isOpen,
  items,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  onClose,
}) => {
  const [filter, setFilter] = useState<'all' | 'book' | 'chapter'>('all');
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const filtered = items.filter((it) => (filter === 'all' ? true : it.kind === filter));

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const handleRestoreClick = async (item: TrashItem) => {
    setErrorMsg(null);
    setFeedback(null);
    setBusyId(item.trashId);
    try {
      await onRestore(item);
      setFeedback(
        item.kind === 'book'
          ? `已恢复小说工程《${item.book.title}》`
          : `已恢复《${item.bookTitle}》第 ${item.chapter.chapter} 章草稿`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteClick = async (trashId: string) => {
    setErrorMsg(null);
    setFeedback(null);
    setBusyId(trashId);
    try {
      await onPermanentDelete(trashId);
      setConfirmDeleteId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleClearAllClick = async () => {
    setErrorMsg(null);
    setFeedback(null);
    setBusyId('__all__');
    try {
      await onEmptyTrash();
      setConfirmClearAll(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trash-modal-title"
    >
      <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-3xl max-h-[84vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="trash-modal-title" className="font-display text-lg font-semibold text-zinc-900">
              文章与小说回收站 ({items.length})
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              已删除的整本小说与单章草稿均保存在本地回收站，可随时一键恢复或彻底清除。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {items.length > 0 && (
              <>
                {!confirmClearAll ? (
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => setConfirmClearAll(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>清空回收站</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busyId !== null}
                      onClick={handleClearAllClick}
                      className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      确认彻底清空
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(false)}
                      className="px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                )}
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭回收站"
              className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="px-6 py-2.5 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-zinc-200/70 rounded-lg">
            {(
              [
                { id: 'all', label: `全部 (${items.length})` },
                { id: 'book', label: `整本小说 (${items.filter((i) => i.kind === 'book').length})` },
                { id: 'chapter', label: `章节草稿 (${items.filter((i) => i.kind === 'chapter').length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === tab.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {(feedback || errorMsg) && (
          <div
            className={`px-6 py-2.5 text-xs border-b ${
              errorMsg
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            {errorMsg || feedback}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto p-6">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-zinc-500">
              当前回收站为空。删除的小说工程或章节草稿会先暂存于此，不会直接丢失。
            </div>
          ) : (
            <div className="divide-y divide-zinc-200 border border-zinc-200 rounded-xl overflow-hidden">
              {filtered.map((item) => {
                const isBusy = busyId === item.trashId;
                const isConfirmingDel = confirmDeleteId === item.trashId;
                const charCount =
                  item.kind === 'chapter'
                    ? item.chapter.prose.replace(/\s+/g, '').length
                    : item.book.chapters.reduce(
                        (sum, c) => sum + c.prose.replace(/\s+/g, '').length,
                        0
                      );

                return (
                  <div
                    key={item.trashId}
                    className="p-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        {item.kind === 'book' ? (
                          <BookOpen className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                        )}
                        <span className="font-medium text-zinc-700">
                          {item.kind === 'book' ? '整本小说工程' : '章节草稿'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>删除于 {formatTime(item.deletedAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{charCount} 字</span>
                      </div>

                      <div className="text-sm font-semibold text-zinc-900 truncate">
                        {item.kind === 'book'
                          ? `《${item.book.title}》`
                          : `《${item.bookTitle}》· 第 ${item.chapter.chapter} 章：${item.chapter.contract.title || '未命名章节'}`}
                      </div>

                      <p className="text-xs text-zinc-600 line-clamp-2 leading-relaxed">
                        {item.kind === 'book'
                          ? `${item.book.chapters.length} 章 · ${item.book.bible.premise}`
                          : item.chapter.prose.trim()
                          ? item.chapter.prose.trim().slice(0, 140)
                          : `章节合同：${item.chapter.contract.desirePayoff || '暂无正文内容'}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyId !== null}
                        onClick={() => handleRestoreClick(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{isBusy ? '恢复中...' : '恢复'}</span>
                      </button>

                      {!isConfirmingDel ? (
                        <button
                          type="button"
                          disabled={busyId !== null}
                          onClick={() => setConfirmDeleteId(item.trashId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-600 hover:text-red-700 border border-zinc-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>彻底删除</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => handleDeleteClick(item.trashId)}
                            className="px-2.5 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            确认
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
