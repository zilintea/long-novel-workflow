import React, { useEffect, useState } from 'react';
import { Compass, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { BookProject, ForeshadowingStatus, RetargetThreadResolution } from '../shared/types.ts';
import { allocateNextForeshadowingId, DESIRE_SPECS } from '../shared/skillSpecs.ts';
import { countProseSize } from '../shared/auditEngine.ts';
import { effectiveTolerance, getPhaseInfo } from '../shared/phase.ts';
import { arcReviewApi, draftEndingApi, restoreRestructureApi, retargetApi } from '../lib/api.ts';

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
  const [newScope, setNewScope] = useState<'series' | 'volume' | 'episode'>('series');
  const [newKind, setNewKind] = useState<'reveal' | 'conflict' | 'relationship' | 'other'>(
    'other'
  );
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

  // 终局规划（手册 §五.2）：目标/容差/结局可编辑；阶段与进度由 compass 推导。
  const compass = book.outline.compass;
  const targetChapters = compass.targetChapters ?? null;
  const tolerance =
    targetChapters != null ? effectiveTolerance(targetChapters, compass.tolerance) : 0;
  const committedMainChapters = book.chapters.filter(
    (c) => c.status === 'committed' && (c.contract.chapterKind ?? 'main') === 'main'
  );
  const maxCommittedMain =
    committedMainChapters.length > 0 ? Math.max(...committedMainChapters.map((c) => c.chapter)) : 0;
  const epilogueExtraCount = book.chapters.filter(
    (c) => (c.contract.chapterKind ?? 'main') !== 'main'
  ).length;
  const mainWords = book.chapters
    .filter((c) => (c.contract.chapterKind ?? 'main') === 'main' && c.prose)
    .reduce((sum, c) => sum + countProseSize(c.prose, book.language), 0);
  const unclosedMainThreads = book.state.foreshadowing.filter(
    (f) =>
      (f.status === 'open' || f.status === 'progressing') && (f.scope ?? 'series') !== 'episode'
  );
  const phaseInfo =
    targetChapters != null
      ? getPhaseInfo(Math.max(maxCommittedMain, 1), 1, targetChapters, compass.tolerance)
      : null;
  const isCompleted = book.bookStatus === 'completed';
  const derivedScaleEstimate =
    targetChapters == null
      ? compass.scaleEstimate
      : `${targetChapters} 章（±${tolerance}，${targetChapters - tolerance}–${targetChapters + tolerance} 章收官）`;

  const [targetInput, setTargetInput] = useState(targetChapters != null ? String(targetChapters) : '');
  const [toleranceInput, setToleranceInput] = useState(
    compass.tolerance != null ? String(compass.tolerance) : ''
  );
  const [endingSummaryInput, setEndingSummaryInput] = useState(compass.endingSummary ?? '');
  const [plannedEndingInput, setPlannedEndingInput] = useState(compass.plannedEnding ?? '');
  const [scaleEstimateInput, setScaleEstimateInput] = useState(compass.scaleEstimate);
  const [compassSaving, setCompassSaving] = useState(false);
  const [endingPromptDismissed, setEndingPromptDismissed] = useState(false);
  const [retargetModal, setRetargetModal] = useState<{
    newTarget: number;
    newTolerance: number | undefined;
    overWindow: { id: string; thread: string; payoffDue: number }[];
  } | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, RetargetThreadResolution>>({});

  // 25% 缺失结局提示（手册 §五.2.3）：≥L1 温和横幅（可关闭），≥L2 醒目卡片；
  // T<40 且 L2−L1≤4 时两档合并，只在 L2 显示强提示。
  const endingPromptLevel: 'none' | 'gentle' | 'strong' =
    phaseInfo != null && !compass.plannedEnding && !isCompleted
      ? phaseInfo.localChapter >= phaseInfo.L2
        ? 'strong'
        : phaseInfo.localChapter >= phaseInfo.L1 &&
            !(targetChapters != null && targetChapters < 40 && phaseInfo.L2 - phaseInfo.L1 <= 4)
          ? 'gentle'
          : 'none'
      : 'none';
  const effectiveEndingPromptLevel =
    endingPromptLevel === 'gentle' && endingPromptDismissed ? 'none' : endingPromptLevel;

  useEffect(() => {
    setNewFid(allocateNextForeshadowingId(book.state.foreshadowing.map((f) => f.id)));
    setNewPlanted(book.state.nextChapter);
    setNewDue(book.state.nextChapter + 5);
    setEndDirection(book.outline.compass.endDirection);
    setCentralQuestion(book.outline.compass.centralQuestion);
    setWhatBookIsNot(book.outline.compass.whatBookIsNot);
    setCurrentArcGoal(book.outline.currentArc.goal);
    setTargetInput(targetChapters != null ? String(targetChapters) : '');
    setToleranceInput(compass.tolerance != null ? String(compass.tolerance) : '');
    setEndingSummaryInput(compass.endingSummary ?? '');
    setPlannedEndingInput(compass.plannedEnding ?? '');
    setScaleEstimateInput(compass.scaleEstimate);
    setEndingPromptDismissed(false);
    setRetargetModal(null);
    setResolutions({});
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
        scope: newScope,
        kind: newKind,
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
    setErrorMsg(null);
    setCompassSaving(true);
    try {
      const newTarget =
        targetInput.trim() === '' ? undefined : Number(targetInput);
      if (newTarget !== undefined && (!Number.isFinite(newTarget) || newTarget < 1)) {
        setErrorMsg('目标章数须为正整数，留空则为无终点自由连载。');
        return;
      }
      const newTolerance =
        toleranceInput.trim() === '' ? undefined : Number(toleranceInput);
      const endingSummary = endingSummaryInput.trim() || undefined;
      const plannedEnding = plannedEndingInput.trim() || undefined;
      const targetChanged = (newTarget ?? null) !== (targetChapters ?? null);
      const toleranceChanged = (newTolerance ?? null) !== (compass.tolerance ?? null);

      // 目标/容差变了 → 先算超窗伏笔；有冲突开清理弹窗，无冲突走服务端 retarget
      // （校验 + 快照 + outlineRevision）；只改结局/规模 → 普通保存。
      if (targetChanged || toleranceChanged) {
        if (newTarget == null) {
          // 清空目标 = 退化为无终点模式，不再有完结窗口。
          await onSaveBook({
            ...book,
            outline: {
              ...book.outline,
              compass: {
                ...book.outline.compass,
                endDirection,
                centralQuestion,
                whatBookIsNot,
                targetChapters: undefined,
                tolerance: newTolerance,
                endingSummary,
                plannedEnding,
                scaleEstimate: scaleEstimateInput,
              },
              currentArc: { ...book.outline.currentArc, goal: currentArcGoal },
            },
          });
        } else {
          const newTol = effectiveTolerance(newTarget, newTolerance);
          const winEnd = newTarget + newTol;
          const overWindow = book.state.foreshadowing
            .filter(
              (f) =>
                (f.status === 'open' || f.status === 'progressing' || f.status === 'deferred') &&
                f.payoffDue > winEnd
            )
            .map((f) => ({ id: f.id, thread: f.thread, payoffDue: f.payoffDue }));
          if (overWindow.length > 0) {
            setRetargetModal({ newTarget, newTolerance, overWindow });
            setResolutions(
              Object.fromEntries(
                overWindow.map((o) => [
                  o.id,
                  { id: o.id, action: 'archive' as const, newPayoffDue: winEnd },
                ])
              )
            );
            return;
          }
          const updated = await retargetApi(book.id, {
            targetChapters: newTarget,
            tolerance: newTolerance,
            threadResolutions: [],
            plannedEnding,
            endingSummary,
            note: `台账页调整卷纲：${targetChapters ?? '未设'} → ${newTarget} 章`,
          });
          await onSaveBook({
            ...updated,
            outline: {
              ...updated.outline,
              compass: {
                ...updated.outline.compass,
                endDirection,
                centralQuestion,
                whatBookIsNot,
                scaleEstimate:
                  targetChapters == null ? scaleEstimateInput : updated.outline.compass.scaleEstimate,
              },
              currentArc: { ...updated.outline.currentArc, goal: currentArcGoal },
            },
          });
        }
      } else {
        await onSaveBook({
          ...book,
          outline: {
            ...book.outline,
            compass: {
              ...book.outline.compass,
              endDirection,
              centralQuestion,
              whatBookIsNot,
              endingSummary,
              plannedEnding,
              scaleEstimate: targetChapters == null ? scaleEstimateInput : compass.scaleEstimate,
            },
            currentArc: { ...book.outline.currentArc, goal: currentArcGoal },
          },
        });
      }
      setCompassNotice('全书罗盘与当前卷目标已保存');
      setTimeout(() => setCompassNotice(null), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCompassSaving(false);
    }
  };

  const handleConfirmRetarget = async () => {
    if (!retargetModal) return;
    setErrorMsg(null);
    setCompassSaving(true);
    try {
      const updated = await retargetApi(book.id, {
        targetChapters: retargetModal.newTarget,
        tolerance: retargetModal.newTolerance,
        threadResolutions: retargetModal.overWindow.map(
          (o) => resolutions[o.id] ?? { id: o.id, action: 'archive' as const }
        ),
        plannedEnding: plannedEndingInput.trim() || undefined,
        endingSummary: endingSummaryInput.trim() || undefined,
        note: `台账页缩纲清理：${targetChapters ?? '未设'} → ${retargetModal.newTarget} 章`,
      });
      await onSaveBook({
        ...updated,
        outline: {
          ...updated.outline,
          compass: {
            ...updated.outline.compass,
            endDirection,
            centralQuestion,
            whatBookIsNot,
          },
          currentArc: { ...updated.outline.currentArc, goal: currentArcGoal },
        },
      });
      setRetargetModal(null);
      setCompassNotice('卷纲已调整，超窗伏笔已按你的选择处理，快照已存、可恢复');
      setTimeout(() => setCompassNotice(null), 4000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCompassSaving(false);
    }
  };

  const handleDraftEnding = async () => {
    setErrorMsg(null);
    setCompassSaving(true);
    try {
      const draft = await draftEndingApi(book);
      setEndingSummaryInput(draft.endingSummary);
      setPlannedEndingInput(draft.plannedEnding);
      setCompassNotice('AI 已拟定结局草案（可改），点「保存罗盘规划」生效');
      setTimeout(() => setCompassNotice(null), 4000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCompassSaving(false);
    }
  };

  const handleRestoreRestructure = async (logIndex: number) => {
    setErrorMsg(null);
    setCompassSaving(true);
    try {
      const updated = await restoreRestructureApi(book.id, logIndex);
      await onSaveBook(updated);
      setCompassNotice('已恢复到这次调整之前的卷纲');
      setTimeout(() => setCompassNotice(null), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCompassSaving(false);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 flex flex-col gap-8">
      {/* 终局进度栏（手册 §五.2.1） */}
      <section className="bg-white border border-zinc-200 rounded-xl px-6 py-4 flex flex-col gap-2">
        <div className="text-sm text-zinc-900">
          {isCompleted ? (
            <span>
              已完结于第 {book.completedAtChapter ?? maxCommittedMain} 章 · 正篇累计{' '}
              {mainWords.toLocaleString()} 字 · 后记/番外 {epilogueExtraCount} 篇
            </span>
          ) : targetChapters != null && phaseInfo != null ? (
            compass.targetWords != null ? (
              <span>
                正篇已写 {mainWords.toLocaleString()} / {compass.targetWords.toLocaleString()} 字
                （第 {maxCommittedMain} 章） · {phaseInfo.phaseLabelZh} · 未结伏笔{' '}
                {unclosedMainThreads.length} 条
              </span>
            ) : (
              <span>
                第 {maxCommittedMain} / {targetChapters} 章（±{tolerance} 窗口 ·{' '}
                {phaseInfo.winStart}–{phaseInfo.winEnd} 章收官） · {phaseInfo.phaseLabelZh} · 未结主线伏笔{' '}
                {unclosedMainThreads.length} 条
              </span>
            )
          ) : (
            <span>
              第 {maxCommittedMain} 章 · 自由连载中（未设终点） ·{' '}
              <button
                type="button"
                onClick={() => document.getElementById('compass-target-input')?.focus()}
                className="text-blue-700 font-medium underline cursor-pointer"
              >
                补设目标章数
              </button>
            </span>
          )}
        </div>
        {targetChapters != null && phaseInfo != null && !isCompleted && (
          <div className="w-full h-2 bg-zinc-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-700"
              style={{ width: `${Math.min(100, phaseInfo.progressPct * 100)}%` }}
            />
          </div>
        )}
      </section>

      {/* 25% 缺失结局提示（手册 §五.2.3） */}
      {effectiveEndingPromptLevel === 'gentle' && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
          <span>
            已写到立局期末（第 {phaseInfo!.L1} 章），还没设定完整终局蓝图。建议补填或让 AI
            起草草案，收敛期会更难收口。
          </span>
          <span className="inline-flex gap-2">
            <button
              type="button"
              onClick={handleDraftEnding}
              className="px-2.5 py-1 text-xs font-medium bg-amber-700 hover:bg-amber-800 text-white rounded cursor-pointer"
            >
              AI 起草结局草案
            </button>
            <button
              type="button"
              onClick={() => setEndingPromptDismissed(true)}
              className="px-2.5 py-1 text-xs text-zinc-600 border border-zinc-300 rounded cursor-pointer"
            >
              知道了
            </button>
          </span>
        </div>
      )}
      {effectiveEndingPromptLevel === 'strong' && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-950 flex flex-col gap-3">
          <div>
            <strong>已进入收敛并轨期，但还没有完整终局蓝图。</strong>
            没有终点，收敛无从收起。请先定结局（可一键让 AI 起草 3 落点草案再改），再继续写。
          </div>
          <div>
            <button
              type="button"
              onClick={handleDraftEnding}
              className="px-3.5 py-1.5 text-xs font-medium bg-red-700 hover:bg-red-800 text-white rounded-lg cursor-pointer"
            >
              一键 AI 起草 3 落点草案
            </button>
          </div>
        </div>
      )}

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
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        <span className="text-[11px] px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded">
                          {f.scope ?? 'series'}
                        </span>
                        {f.kind && (
                          <span className="text-[11px] px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded">
                            {f.kind}
                          </span>
                        )}
                        {f.status === 'archived' && (
                          <span className="text-[11px] px-1.5 py-0.5 bg-zinc-200 text-zinc-500 rounded">
                            已封存（豁免审计）
                          </span>
                        )}
                      </div>
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
                        <option value="archived">archived (封存，不阻断)</option>
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
        <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600">
          <label className="inline-flex items-center gap-1.5">
            级别
            <select
              value={newScope}
              onChange={(e) =>
                setNewScope(e.target.value as 'series' | 'volume' | 'episode')
              }
              className="px-2 py-1 text-xs border border-zinc-300 rounded bg-white"
            >
              <option value="series">series 全书主线</option>
              <option value="volume">volume 卷级</option>
              <option value="episode">episode 单集线</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5">
            类型
            <select
              value={newKind}
              onChange={(e) =>
                setNewKind(e.target.value as 'reveal' | 'conflict' | 'relationship' | 'other')
              }
              className="px-2 py-1 text-xs border border-zinc-300 rounded bg-white"
            >
              <option value="reveal">reveal 真相揭示</option>
              <option value="conflict">conflict 冲突</option>
              <option value="relationship">relationship 关系</option>
              <option value="other">other 其他</option>
            </select>
          </label>
          <span className="text-zinc-400">单集线不计入全书收官预警；reveal 类线压缩时会有单独提醒。</span>
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
              disabled={compassSaving}
              onClick={handleSaveCompass}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {compassSaving ? '保存中...' : '保存罗盘规划'}
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

          {/* 终局规划编辑（手册 §五.2.2）：目标/容差/结局可改，保存时 outlineRevision 自动 +1 */}
          <div className="space-y-3 border-b border-zinc-200 pb-4">
            <div className="text-xs font-semibold text-zinc-800">
              终局规划（罗盘可编辑 · 保存时 outlineRevision 自动 +1）
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">目标章数（留空=无终点）</label>
                <input
                  id="compass-target-input"
                  type="number"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  placeholder="如 100"
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">容差（留空=自动推导）</label>
                <input
                  type="number"
                  value={toleranceInput}
                  onChange={(e) => setToleranceInput(e.target.value)}
                  placeholder={targetChapters != null ? `自动 ${tolerance}` : '自动'}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">一句话结局（endingSummary）</label>
              <input
                type="text"
                value={endingSummaryInput}
                onChange={(e) => setEndingSummaryInput(e.target.value)}
                placeholder="一句话核心结局（供合同与复盘把关，不进正文）"
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">
                完整终局蓝图（plannedEnding · 3 落点：终局高潮、人物归宿、核心问题答案）
              </label>
              <textarea
                rows={3}
                value={plannedEndingInput}
                onChange={(e) => setPlannedEndingInput(e.target.value)}
                placeholder="留空可开写；立局期末会提醒补填，收敛期前必须定下来。"
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
              />
              <div className="mt-1.5">
                <button
                  type="button"
                  onClick={handleDraftEnding}
                  className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer"
                >
                  AI 拟定结局草案
                </button>
              </div>
            </div>
            {targetChapters == null ? (
              <div>
                <label className="block text-xs text-zinc-500 mb-1">规模估计（无目标时可手改）</label>
                <input
                  type="text"
                  value={scaleEstimateInput}
                  onChange={(e) => setScaleEstimateInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                />
              </div>
            ) : (
              <div className="text-xs text-zinc-500">
                规模估计（自动派生，只读）：{derivedScaleEstimate}
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">
                当前 outlineRevision：{book.outlineRevision ?? 1}
                {targetChapters != null && phaseInfo != null
                  ? ` · 当前阶段：${phaseInfo.phaseLabelZh}`
                  : ''}
              </span>
            </div>
            {(book.restructureLog ?? []).length > 0 && (
              <div className="pt-2">
                <div className="text-xs font-semibold text-zinc-700 mb-1.5">
                  调整卷纲快照（可恢复）
                </div>
                <ul className="space-y-1.5 text-xs">
                  {(book.restructureLog ?? []).map((entry, idx) => (
                    <li
                      key={idx}
                      className="flex flex-wrap items-center justify-between gap-2 p-2 bg-zinc-50 border border-zinc-200 rounded-lg"
                    >
                      <span className="text-zinc-700">
                        {new Date(entry.at).toLocaleString('zh-CN')} ·{' '}
                        {entry.kind === 'retarget' ? '调整卷纲' : '恢复快照'} · 目标{' '}
                        {entry.before.targetChapters ?? '未设'} →{' '}
                        {entry.after.targetChapters ?? '未设'} 章
                        {entry.note ? ` · ${entry.note}` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRestoreRestructure(idx)}
                        className="px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer"
                      >
                        恢复到这次之前
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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

      {/* 缩纲清理弹窗（手册 §五.2.4）：先列冲突、作者逐条定去处，确认后才保存 */}
      {retargetModal && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl p-6 flex flex-col gap-4">
            <h3 className="font-display text-lg font-semibold text-zinc-900">
              缩纲清理：{retargetModal.overWindow.length} 条伏笔超出新完结窗口
            </h3>
            <p className="text-xs text-zinc-600">
              新目标 {retargetModal.newTarget} 章，最晚第{' '}
              {retargetModal.newTarget +
                effectiveTolerance(retargetModal.newTarget, retargetModal.newTolerance)}{' '}
              章收官。已写章节一个字不动；请为每条超窗伏笔选一个去处（reveal 类线压缩会提前兑现，
              请确认不剧透铺垫），确认后才保存，快照已存、可恢复。
            </p>
            <div className="flex flex-col gap-3">
              {retargetModal.overWindow.map((o) => {
                const thread = book.state.foreshadowing.find((f) => f.id === o.id);
                const res = resolutions[o.id] ?? {
                  action: 'archive' as const,
                  newPayoffDue:
                    retargetModal.newTarget +
                    effectiveTolerance(retargetModal.newTarget, retargetModal.newTolerance),
                };
                return (
                  <div
                    key={o.id}
                    className="p-3 border border-zinc-200 rounded-lg flex flex-col gap-2"
                  >
                    <div className="text-sm font-medium text-zinc-900">
                      {o.id}（{o.thread}）· 约定第 {o.payoffDue} 章兑现
                      {thread?.kind === 'reveal' && (
                        <span className="ml-2 text-xs text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                          reveal 线：压缩会提前揭晓，请谨慎
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <select
                        value={res.action}
                        onChange={(e) =>
                          setResolutions((prev) => ({
                            ...prev,
                            [o.id]: {
                              id: o.id,
                              action: e.target.value as 'compress' | 'archive',
                              newPayoffDue: res.newPayoffDue,
                            },
                          }))
                        }
                        className="px-2 py-1.5 text-xs border border-zinc-300 rounded bg-white"
                      >
                        <option value="compress">压缩到新窗口内</option>
                        <option value="archive">标为 archived（封存，不阻断）</option>
                      </select>
                      {res.action === 'compress' && (
                        <label className="inline-flex items-center gap-1.5">
                          兑现到第
                          <input
                            type="number"
                            value={res.newPayoffDue}
                            onChange={(e) =>
                              setResolutions((prev) => ({
                                ...prev,
                                [o.id]: {
                                  id: o.id,
                                  action: 'compress',
                                  newPayoffDue: Number(e.target.value),
                                },
                              }))
                            }
                            className="w-20 px-2 py-1.5 text-xs border border-zinc-300 rounded"
                          />
                          章
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={compassSaving}
                onClick={handleConfirmRetarget}
                className="px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
              >
                {compassSaving ? '保存中...' : '确认调整卷纲'}
              </button>
              <button
                type="button"
                onClick={() => setRetargetModal(null)}
                className="px-4 py-2 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg cursor-pointer"
              >
                取消缩纲
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
