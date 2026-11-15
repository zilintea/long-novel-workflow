import React, { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, Copy, DatabaseBackup, Download, X } from 'lucide-react';
import type { BookProject } from '../shared/types.ts';
import { formatBookAsMarkdownFiles } from '../shared/markdownFormat.ts';
import { exportBookMarkdownApi } from '../lib/api.ts';

interface ExportModalProps {
  book: BookProject | null;
  allBooksCount: number;
  lastBackupAt: string | null;
  onExportFullBackup: () => void;
  onImportBackupFile: (file: File) => Promise<void>;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  book,
  allBooksCount,
  lastBackupAt,
  onExportFullBackup,
  onImportBackupFile,
  onClose,
}) => {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!book) return;
    setBackupFeedback(null);
    setBackupError(null);
    setLoading(true);

    // Compute live local snapshot immediately as reliable baseline, then optionally refresh from server
    const localFiles = formatBookAsMarkdownFiles(book);
    setFiles(localFiles);
    setSelectedPath((prev) => (prev && localFiles[prev] ? prev : Object.keys(localFiles)[0] || ''));

    exportBookMarkdownApi(book.id)
      .then((res) => {
        if (res && Object.keys(res).length > 0) {
          setFiles(res);
          setSelectedPath((prev) => (prev && res[prev] ? prev : Object.keys(res)[0] || ''));
        }
      })
      .catch(() => {
        // Keep localFiles silently when server container restarted
      })
      .finally(() => setLoading(false));
  }, [book?.id, book?.updatedAt]);

  if (!book) return null;

  const fileList = Object.keys(files);
  const activeContent = files[selectedPath] || '';

  const handleDownloadAll = () => {
    const merged = fileList
      .map(
        (path) =>
          `========================================\nFILE: ${path}\n========================================\n\n${files[path]}`
      )
      .join('\n\n\n');
    const blob = new Blob([merged], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book.title || book.id}-long-novel-workflow.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCurrent = async () => {
    await navigator.clipboard.writeText(activeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleBackupClick = () => {
    setBackupError(null);
    onExportFullBackup();
    setBackupFeedback(`已导出全部 ${allBooksCount} 本小说与词库配置 (.json)`);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupError(null);
    setBackupFeedback(null);
    try {
      await onImportBackupFile(file);
      setBackupFeedback('已成功从备份文件恢复全部小说与配置，并同步至本地缓存与服务端');
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : String(err));
    }
  };

  const formattedLastBackup = lastBackupAt
    ? new Date(lastBackupAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-4xl h-[84vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-zinc-900">
              导出与备份 — 《{book.title}》
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              所有工程已自动保存在本地浏览器缓存；建议定期导出 .json 完整备份以防清理浏览器或跨设备迁移丢失。
              {formattedLastBackup ? `（上次备份：${formattedLastBackup}）` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleBackupClick}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <DatabaseBackup className="w-3.5 h-3.5" />
              <span>导出全库备份 (.json)</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
              <span>从备份恢复 (.json)</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleDownloadAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载本书 Markdown</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭导出窗口"
              className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(backupFeedback || backupError) && (
          <div
            className={`px-6 py-2.5 text-xs border-b ${
              backupError
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            {backupError || backupFeedback}
          </div>
        )}

        <div className="flex-1 grid grid-cols-1 md:grid-cols-[240px_1fr] min-h-0">
          <aside className="border-r border-zinc-200 bg-zinc-50 p-3 overflow-y-auto">
            {loading && fileList.length === 0 ? (
              <div className="text-xs text-zinc-500 p-2">读取工程文件中...</div>
            ) : (
              <ul className="space-y-1">
                {fileList.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(p)}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-mono truncate cursor-pointer ${
                        selectedPath === p
                          ? 'bg-white border border-zinc-300 text-zinc-900 font-semibold'
                          : 'text-zinc-600 hover:bg-zinc-100'
                      }`}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2 border-b border-zinc-200 bg-zinc-50/50 flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-700">{selectedPath}</span>
              <button
                type="button"
                onClick={handleCopyCurrent}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-200 rounded cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copied ? '已复制' : '复制本文件'}</span>
              </button>
            </div>
            <pre className="flex-1 p-5 overflow-auto text-xs font-mono text-zinc-800 whitespace-pre-wrap leading-relaxed">
              {activeContent}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
