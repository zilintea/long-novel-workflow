import React, { useEffect, useState } from 'react';
import { Compass, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { BookProject, ForeshadowingStatus } from '../shared/types.ts';
import { allocateNextForeshadowingId, DESIRE_SPECS } from '../shared/skillSpecs.ts';
import { arcReviewApi } from '../lib/api.ts';

interface LedgerOutlineViewProps {
  book: BookProject;
  onSaveBook: (updated: BookProject) => Promise<void>;
}

export const LedgerOutlineView: React.FC<LedgerOutlineViewProps> = ({ book, onSaveBook }) => {
  const [newFid, setNewFid] = useState(
    allocateNextForeshadowingId(book.state.foreshadowing.map((f) => f.id))
  );
  const [newPlanted, setNewPlanted] = useState(book.state.nextChapter);
  const [newDue, setNewDue] = useState(book.state.nextChapter + 5);
  const [newThread, setNewThread] = useState('');
  const [ledgerNotice, setLedgerNotice] = useState<string | null>(null);
  const [confirmDeleteFid, setConfirmDeleteFid] = useState<string | null>(null);

  const [endDirection, setEndDirection] = useState(book.outline.compass.endDirection);
  const [centralQuestion, setCentralQuestion] = useState(book.outline.compass.centralQuestion);
  const [whatBookIsNot, setWhatBookIsNot] = useState(book.outline.compass.whatBookIsNot);
  const [currentArcGoal, setCurrentArcGoal] = useState(book.outline.currentArc.goal);
  const [compassNotice, setCompassNotice] = useState<string | null>(null);

  const [arcReviewLoading, setArcReviewLoading] = useState(false);
  const [arcResult, setArcResult] = useState<{
    diagnosis: string;
    staleThreadAdvice: string[];
    nextArcGoal: string;
    nextArcBeats: string[];
    nextChaptersPlan: { chapter: number; goal: string; desire: string; hook: string }[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setNewFid(allocateNextForeshadowingId(book.state.foreshadowing.map((f) => f.id)));
    setNewPlanted(book.state.nextChapter);
    setNewDue(book.state.nextChapter + 5);
    setEndDirection(book.outline.compass.endDirection);
    setCentralQuestion(book.outline.compass.centralQuestion);
    setWhatBookIsNot(book.outline.compass.whatBookIsNot);
    setCurrentArcGoal(book.outline.currentArc.goal);
    setArcResult(null);
    setErrorMsg(null);
    setCompassNotice(null);
    setLedgerNotice(null);
    setConfirmDeleteFid(null);
  }, [book.id]);

  const maxChapter = Math.max(
    book.state.nextChapter - 1,
    ...book.chapters.map((c) => c.chapter),
    0
  );

  const nextDraftOrChapterNum =
    book.chapters.find((c) => c.status === 'draft')?.chapter || book.state.nextChapter;

  const overdueThreads = book.state.foreshadowing.filter(
    (f) => (f.status === 'open' || f.status === 'progressing') && maxChapter >= f.payoffDue
  );

  const handleAddForeshadowing = async () => {
    if (!newFid.trim() || !newThread.trim()) return;
    const cleanId = newFid.trim();
    const exists = book.state.foreshadowing.some(
      (f) => f.id.trim().toUpperCase() === cleanId.toUpperCase()
    );
    const finalId = exists
      ? allocateNextForeshadowingId(book.state.foreshadowing.map((f) => f.id))
      : cleanId;
    const next = [
      ...book.state.foreshadowing,
      {
        id: finalId,
        planted: Number(newPlanted) || 1,
        payoffDue: Number(newDue) || 5,
        status: 'open' as const,
        thread: newThread.trim(),
      },
    ];
    await onSaveBook({
      ...book,
      state: { ...book.state, foreshadowing: next },
    });
    setNewFid(allocateNextForeshadowingId(next.map((f) => f.id)));
    setNewThread('');
  };

  const handleStatusChange = async (id: string, status: ForeshadowingStatus) => {
    const next = book.state.foreshadowing.map((f) =>
      f.id === id
        ? {
            ...f,
            status,
            targetChapter: status === 'paid' ? undefined : f.targetChapter,
          }
        : f
    );
    await onSaveBook({
      ...book,
      state: { ...book.state, foreshadowing: next },
    });
  };

  const handleScheduleForNextChapter = async (id: string) => {
    const targetCh = nextDraftOrChapterNum;
    const targetThread = book.state.foreshadowing.find((f) => f.id === id);
    if (!targetThread) return;

    const nextForeshadowing = book.state.foreshadowing.map((f) =>
      f.id === id
        ? {
            ...f,
            status: 'progressing' as const,
            targetChapter: targetCh,
            payoffDue: Math.max(f.payoffDue, targetCh),
            deferReason: `已排入第 ${targetCh} 章引入/推进`,
          }
        : f
    );

    // If a draft chapter for targetCh already exists, inject into its mustHappen cleanly
    const nextChapters = book.chapters.map((c) => {
      if (c.chapter === targetCh && c.status === 'draft') {
        const mention = `引入伏笔 ${targetThread.id}（${targetThread.thread}）`;
        const alreadyHas =
          c.contract.mustHappen.includes(targetThread.id) ||
          c.contract.foreshadowingPaid.includes(targetThread.id);
        return {
          ...c,
          contract: {
            ...c.contract,
            mustHappen: alreadyHas
              ? c.contract.mustHappen
              : [c.contract.mustHappen.trim(), mention].filter(Boolean).join('；'),
          },
          updatedAt: new Date().toISOString(),
        };
      }
      return c;
    });

    await onSaveBook({
      ...book,
      chapters: nextChapters,
      state: { ...book.state, foreshadowing: nextForeshadowing },
    });
    setLedgerNotice(`已将伏笔 ${id} 排入第 ${targetCh} 章引入/推进，创作或起草第 ${targetCh} 章合同时将自动衔接`);
    setTimeout(() => setLedgerNotice(null), 4000);
  };

  const handleExtendDue = async (id: string) => {
    const nextForeshadowing = book.state.foreshadowing.map((f) =>
      f.id === id
        ? {
            ...f,
            status: 'open' as const,
            payoffDue: Math.max(f.payoffDue, maxChapter) + 5,
            targetChapter: undefined,
            deferReason: '顺延 5 章兑现',
          }
        : f
    );
    await onSaveBook({
      ...book,
      state: { ...book.state, foreshadowing: nextForeshadowing },
    });
    setLedgerNotice(`伏笔 ${id} 已顺延 5 章兑现期`);
    setTimeout(() => setLedgerNotice(null), 3000);
  };

  const handleDeleteForeshadowing = async (id: string) => {
    const nextForeshadowing = book.state.foreshadowing.filter((f) => f.id !== id);
    await onSaveBook({
      ...book,
      state: { ...book.state, foreshadowing: nextForeshadowing },
    });
    setConfirmDeleteFid(null);
    setNewFid(allocateNextForeshadowingId(nextForeshadowing.map((f) => f.id)));
    setLedgerNotice(`已从台账移除伏笔 ${id}`);
    setTimeout(() => setLedgerNotice(null), 3000);
  };

  const handleRunArcReview = async () => {
    setErrorMsg(null);
    setArcReviewLoading(true);
    try {
      const res = await arcReviewApi(book);
      setArcResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setArcReviewLoading(false);
    }
  };

  const handleApplyArcPlan = async () => {
    if (!arcResult) return;
    const existingMap = new Map(book.outline.roadmap.map((r) => [r.chapter, r]));
    for (const row of arcResult.nextChaptersPlan) {
      if (!existingMap.has(row.chapter)) {
        existingMap.set(row.chapter, {
          chapter: row.chapter,
          goal: row.goal,
          desire: (row.desire in DESIRE_SPECS ? row.desire : 'curiosity') as keyof typeof DESIRE_SPECS,
          hook: row.hook,
          status: 'planned',
        });
      }
    }
    await onSaveBook({
      ...book,
      outline: {
        ...book.outline,
        currentArc: {
          ...book.outline.currentArc,
          goal: arcResult.nextArcGoal,
          beats: arcResult.nextArcBeats,
        },
        roadmap: Array.from(existingMap.values()).sort((a, b) => a.chapter - b.chapter),
      },
    });
    setCurrentArcGoal(arcResult.nextArcGoal);
    setArcResult(null);
  };

  const handleSaveCompass = async () => {
    await onSaveBook({
      ...book,
      outline: {
        ...book.outline,
        compass: {
          ...book.outline.compass,
          endDirection,
          centralQuestion,
          whatBookIsNot,
        },
        currentArc: {
          ...book.outline.currentArc,
          goal: currentArcGoal,
        },
      },
    });
    setCompassNotice('全书罗盘与当前卷目标已保存');
    setTimeout(() => setCompassNotice(null), 2500);
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 flex flex-col gap-8">
      {/* Foreshadowing Ledger */}
      <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-zinc-900">
              伏笔台账与滚动画卷大纲
            </h1>
            <p className="text-xs text-zinc-500 mt-1">
              每条伏笔必须设定兑现章号（payoff_due）；悬空超过 30 章未处理会被脚本阻断。
            </p>
          </div>
          <button
            type="button"
            disabled={arcReviewLoading}
            onClick={handleRunArcReview}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${arcReviewLoading ? 'animate-spin' : ''}`} />
            <span>{arcReviewLoading ? '复盘规划中...' : 'Step 4 阶段 / 30章复盘'}</span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-900 rounded-lg text-sm">
            {errorMsg}
          </div>
        )}

        {arcResult && (
          <div className="p-5 bg-blue-50/60 border border-blue-200 rounded-xl flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold text-blue-950">
                AI 阶段复盘与下一阶段规划提案
              </h3>
              <button
                type="button"
                onClick={handleApplyArcPlan}
                className="px-3.5 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer"
              >
                采纳并写入章节路线图
              </button>
            </div>
            <p className="text-sm text-zinc-800">{arcResult.diagnosis}</p>
            {arcResult.staleThreadAdvice.length > 0 && (
              <div className="text-xs text-amber-900">
                <strong>伏笔回收建议：</strong>
                {arcResult.staleThreadAdvice.join('；')}
              </div>
            )}
            <div className="text-xs text-zinc-700">
              <strong>新卷目标：</strong>
              {arcResult.nextArcGoal}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
              {arcResult.nextChaptersPlan.map((p) => (
                <div key={p.chapter} className="p-3 bg-white border border-blue-100 rounded-lg text-xs">
                  <div className="font-mono font-semibold text-blue-800">
                    Ch {p.chapter} · {p.desire}
                  </div>
                  <div className="text-zinc-900 font-medium mt-0.5">{p.goal}</div>
                  <div className="text-zinc-500 mt-0.5">钩子：{p.hook}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {overdueThreads.length > 0 && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
            <span>
              当前有 <strong>{overdueThreads.length}</strong> 条已逾期伏笔（
              {overdueThreads.map((f) => f.id).join('、')}
              ）：可直接点击下方「下一章引入」排入第 {nextDraftOrChapterNum} 章，或创作下一章时由 AI 自动衔接处理。
            </span>
          </div>
        )}

        {ledgerNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg text-xs">
            {ledgerNotice}
          </div>
        )}

        <div className="overflow-x-auto border border-zinc-200 rounded-xl">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-xs text-zinc-600">
              <tr>
                <th className="py-2.5 px-4 font-medium">编号</th>
                <th className="py-2.5 px-4 font-medium">埋设章</th>
                <th className="py-2.5 px-4 font-medium">约定兑现</th>
                <th className="py-2.5 px-4 font-medium">伏笔内容 (thread)</th>
                <th className="py-2.5 px-4 font-medium">状态</th>
                <th className="py-2.5 px-4 font-medium text-right">快捷处置</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {book.state.foreshadowing.map((f) => {
                const isOverdue =
                  (f.status === 'open' || f.status === 'progressing') && maxChapter >= f.payoffDue;
                const isActive = f.status === 'open' || f.status === 'progressing';
                return (
                  <tr key={f.id} className="hover:bg-zinc-50/70">
                    <td className="py-2.5 px-4 font-mono text-xs font-semibold text-zinc-900">
                      {f.id}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-zinc-600">
                      Ch {f.planted}
                    </td>
                    <td
                      className={`py-2.5 px-4 font-mono text-xs tabular-nums ${
                        isOverdue ? 'text-red-700 font-semibold' : 'text-zinc-600'
                      }`}
                    >
                      Ch {f.payoffDue} {isOverdue ? '(已逾期)' : ''}
                      {f.targetChapter ? (
                        <div className="text-[11px] font-sans text-blue-700">
                          已排入 Ch {f.targetChapter} 引入
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-4 text-zinc-800">
                      <div>{f.thread}</div>
                      {f.deferReason && (
                        <div className="text-[11px] text-zinc-500 mt-0.5">{f.deferReason}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <select
                        value={f.status}
                        onChange={(e) =>
                          handleStatusChange(f.id, e.target.value as ForeshadowingStatus)
                        }
                        className="px-2 py-1 text-xs border border-zinc-300 rounded bg-white"
                      >
                        <option value="open">open (未收)</option>
                        <option value="progressing">progressing (推进中)</option>
                        <option value="paid">paid (已兑现)</option>
                        <option value="deferred">deferred (经批准延期)</option>
                      </select>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {isActive && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleScheduleForNextChapter(f.id)}
                              title={`标记为第 ${nextDraftOrChapterNum} 章引入推进`}
                              className="px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              第{nextDraftOrChapterNum}章引入
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExtendDue(f.id)}
                              title="约定兑现章号顺延 5 章"
                              className="px-2 py-1 text-xs text-zinc-600 border border-zinc-200 hover:bg-zinc-100 rounded whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              +5章
                            </button>
                          </>
                        )}
                        {confirmDeleteFid !== f.id ? (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteFid(f.id)}
                            title="移除误产生或废弃的伏笔条目"
                            className="p-1 text-zinc-400 hover:text-red-700 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteForeshadowing(f.id)}
                              className="px-2 py-1 text-xs bg-red-600 text-white rounded cursor-pointer"
                            >
                              删
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteFid(null)}
                              className="px-1.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 rounded cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Add new thread row */}
        <div className="grid grid-cols-1 sm:grid-cols-[90px_90px_90px_1fr_auto] gap-2.5 items-center">
          <input
            type="text"
            value={newFid}
            onChange={(e) => setNewFid(e.target.value)}
            placeholder="F04"
            className="px-3 py-2 text-xs font-mono border border-zinc-300 rounded-lg"
          />
          <input
            type="number"
            value={newPlanted}
            onChange={(e) => setNewPlanted(Number(e.target.value))}
            placeholder="埋设章"
            className="px-3 py-2 text-xs font-mono border border-zinc-300 rounded-lg"
          />
          <input
            type="number"
            value={newDue}
            onChange={(e) => setNewDue(Number(e.target.value))}
            placeholder="兑现章"
            className="px-3 py-2 text-xs font-mono border border-zinc-300 rounded-lg"
          />
          <input
            type="text"
            value={newThread}
            onChange={(e) => setNewThread(e.target.value)}
            placeholder="新伏笔内容描述..."
            className="px-3 py-2 text-xs border border-zinc-300 rounded-lg"
          />
          <button
            type="button"
            onClick={handleAddForeshadowing}
            className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>登记伏笔</span>
          </button>
        </div>
      </section>

      {/* Rolling Outline & Summaries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Compass className="w-5 h-5 text-blue-700" />
              <h2 className="font-display text-lg font-semibold text-zinc-900">
                全书罗盘与当前卷规划 (Rolling Horizon)
              </h2>
            </div>
            <button
              type="button"
              onClick={handleSaveCompass}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              保存罗盘规划
            </button>
          </div>

          {compassNotice && (
            <div className="px-3 py-1.5 text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg">
              {compassNotice}
            </div>
          )}

          <div className="text-xs space-y-3 border-b border-zinc-200 pb-4">
            <div>
              <label className="block text-zinc-500 mb-1">终局方向</label>
              <input
                type="text"
                value={endDirection}
                onChange={(e) => setEndDirection(e.target.value)}
                className="w-full px-3 py-1.5 text-sm text-zinc-900 border border-zinc-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-zinc-500 mb-1">核心悬念问题</label>
              <input
                type="text"
                value={centralQuestion}
                onChange={(e) => setCentralQuestion(e.target.value)}
                className="w-full px-3 py-1.5 text-sm text-zinc-900 border border-zinc-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-zinc-500 mb-1">这本书不是什么 (What it is NOT)</label>
              <input
                type="text"
                value={whatBookIsNot}
                onChange={(e) => setWhatBookIsNot(e.target.value)}
                className="w-full px-3 py-1.5 text-sm text-zinc-700 border border-zinc-300 rounded-lg"
              />
            </div>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block text-xs font-semibold text-zinc-800 mb-1">
                {book.outline.currentArc.rangeLabel} · 当前卷目标
              </label>
              <input
                type="text"
                value={currentArcGoal}
                onChange={(e) => setCurrentArcGoal(e.target.value)}
                className="w-full px-3 py-1.5 text-xs text-zinc-900 border border-zinc-300 rounded-lg"
              />
            </div>
            <ul className="list-disc list-inside text-xs text-zinc-700 space-y-1">
              {book.outline.currentArc.beats.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
            <div className="text-xs text-blue-800 pt-1">
              阶段高潮：{book.outline.currentArc.payoff}
            </div>
          </div>

          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                <tr>
                  <th className="py-2 px-3">章</th>
                  <th className="py-2 px-3">目标与钩子</th>
                  <th className="py-2 px-3">欲望</th>
                  <th className="py-2 px-3">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {book.outline.roadmap.map((r) => (
                  <tr key={r.chapter}>
                    <td className="py-2 px-3 font-mono tabular-nums">{r.chapter}</td>
                    <td className="py-2 px-3">
                      <div className="font-medium text-zinc-900">{r.goal}</div>
                      <div className="text-zinc-500">{r.hook}</div>
                    </td>
                    <td className="py-2 px-3 text-zinc-600 whitespace-nowrap">
                      {DESIRE_SPECS[r.desire]?.labelZh || r.desire}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={
                          r.status === 'committed'
                            ? 'text-emerald-700 font-medium'
                            : 'text-zinc-500'
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Chronicle Summaries & Timeline */}
        <section className="bg-white border border-zinc-200 rounded-xl p-6 flex flex-col gap-5">
          <h2 className="font-display text-lg font-semibold text-zinc-900">
            正史摘要与时间线 (Derived after CHAPTER_COMMIT)
          </h2>

          <div>
            <h3 className="text-xs font-semibold text-zinc-700 mb-2">
              已提交章节摘要 (state/summary.md)
            </h3>
            {book.state.summaries.length === 0 ? (
              <p className="text-xs text-zinc-500">尚无已提交章节摘要</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {book.state.summaries.map((s) => (
                  <li key={s.chapter} className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                    <span className="font-mono font-semibold text-zinc-900 mr-2">
                      Ch {String(s.chapter).padStart(3, '0')}
                    </span>
                    <span className="text-zinc-800">{s.summary}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="pt-4 border-t border-zinc-200">
            <h3 className="text-xs font-semibold text-zinc-700 mb-2">
              事件时间线 (state/timeline.md)
            </h3>
            {book.state.timeline.length === 0 ? (
              <p className="text-xs text-zinc-500">尚无时间线记录</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {book.state.timeline.map((t) => (
                  <li key={t.chapter} className="flex items-start gap-3">
                    <span className="font-mono text-zinc-500 shrink-0 tabular-nums">
                      {t.dayLabel} (Ch {t.chapter})
                    </span>
                    <span className="text-zinc-800">{t.event}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
