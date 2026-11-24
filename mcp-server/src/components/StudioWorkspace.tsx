import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  GitCommitHorizontal,
  PenLine,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Square,
  UserPlus,
  Wrench,
} from 'lucide-react';
import type {
  AuditReport,
  BookProject,
  ChapterContract,
  ChapterItem,
  ChapterKind,
  CharacterProfile,
  CommitProposal,
  ContractDesireSetting,
  DesireKey,
  PayoffSize,
} from '../shared/types.ts';
import { DESIRE_SPECS, formatChapterTitle, LANGUAGE_SPECS } from '../shared/skillSpecs.ts';
import { countProseSize, runDeterministicAudit } from '../shared/auditEngine.ts';
import { bigCadenceFor, effectiveTolerance, getPhaseInfo } from '../shared/phase.ts';
import {
  arcReviewApi,
  autoChapterBundleApi,
  boundedReviseApi,
  commitChapterApi,
  downloadSequelSeedApi,
  draftContractApi,
  getBookApi,
  prepareCommitApi,
  rollbackChapterApi,
  streamWriteChapterApi,
  subReviewApi,
} from '../lib/api.ts';

type ChapterLoopStep = 'contract' | 'prose' | 'audit' | 'commit';

interface StudioWorkspaceProps {
  book: BookProject;
  slopZh: string[];
  slopEn: string[];
  onSaveBook: (updated: BookProject) => Promise<void>;
  onOpenBible: () => void;
  onMoveChapterToTrash?: (chapter: ChapterItem) => Promise<void>;
}

const DIMENSION_LABELS: Record<string, string> = {
  canon: '正史一致性',
  character_voice: '人物状态与语调',
  timeline: '时间线与因果',
  knows: 'Knows 信息边界',
  foreshadowing: '伏笔埋设与兑现',
  hook_desire: '钩子与欲望兑现',
  pacing: '节奏与戏剧化',
  prose_deslop: '行文去 AI 味',
  length: '篇幅区间',
  contract: '章节合同完整度',
};

function pickInitialChapterCharacters(targetBook: BookProject, nextNum: number): string[] {
  const roster = targetBook.bible.characters;
  if (roster.length === 0) return [];
  const lead = roster[0];
  const prevChapters = targetBook.chapters
    .filter((c) => c.chapter < nextNum)
    .sort((a, b) => a.chapter - b.chapter);

  const othersScored = roster.slice(1).map((c) => {
    let lastCh = 0;
    for (const ch of prevChapters) {
      if (ch.contract.characters.includes(c.name) || (ch.prose && ch.prose.includes(c.name))) {
        lastCh = ch.chapter;
      }
    }
    return { name: c.name, lastCh };
  });

  // Prioritize registered supporting cast who haven't appeared recently so they don't fade out
  othersScored.sort((a, b) => a.lastCh - b.lastCh);
  return [lead.name, ...othersScored.slice(0, 2).map((o) => o.name)];
}

function mergeNewCharactersIntoBook(
  targetBook: BookProject,
  newCharacters: Omit<CharacterProfile, 'id'>[] | undefined,
  chapterNum: number
): BookProject {
  if (!newCharacters || newCharacters.length === 0) return targetBook;
  const existingNames = new Set(targetBook.bible.characters.map((c) => c.name.trim()));
  const nextChars = [...targetBook.bible.characters];
  const nextStates = [...targetBook.state.characterStates];
  let added = false;

  newCharacters.forEach((nc, idx) => {
    const cleanName = nc.name.trim();
    if (!cleanName || existingNames.has(cleanName)) return;
    existingNames.add(cleanName);
    added = true;
    nextChars.push({
      ...nc,
      id: `char-auto-${chapterNum}-${Date.now()}-${idx}`,
      name: cleanName,
      introducedChapter: nc.introducedChapter ?? chapterNum,
    });
    if (!nextStates.some((cs) => cs.characterName === cleanName)) {
      nextStates.push({
        characterName: cleanName,
        currentState: `${nc.role || '配角'}（第 ${chapterNum} 章登场），目标：${nc.want || '待展开'}`,
      });
    }
  });

  if (!added) return targetBook;
  return {
    ...targetBook,
    bible: {
      ...targetBook.bible,
      characters: nextChars,
    },
    state: {
      ...targetBook.state,
      characterStates: nextStates,
    },
  };
}

export const StudioWorkspace: React.FC<StudioWorkspaceProps> = ({
  book,
  slopZh,
  slopEn,
  onSaveBook,
  onOpenBible,
  onMoveChapterToTrash,
}) => {
  const sortedChapters = useMemo(
    () => [...book.chapters].sort((a, b) => a.chapter - b.chapter),
    [book.chapters]
  );

  // 终局状态（手册 §五.2 / §七）：主线已提交章、主线字数、未结主线伏笔、下章阶段。
  const maxCommittedMain = useMemo(
    () =>
      Math.max(
        0,
        ...book.chapters
          .filter(
            (c) => c.status === 'committed' && (c.contract.chapterKind ?? 'main') === 'main'
          )
          .map((c) => c.chapter)
      ),
    [book.chapters]
  );
  const mainWords = useMemo(
    () =>
      book.chapters
        .filter((c) => (c.contract.chapterKind ?? 'main') === 'main' && c.prose)
        .reduce((sum, c) => sum + countProseSize(c.prose, book.language), 0),
    [book.chapters, book.language]
  );
  const unclosedMainThreads = useMemo(
    () =>
      book.state.foreshadowing.filter(
        (f) => (f.status === 'open' || f.status === 'progressing') && (f.scope ?? 'series') !== 'episode'
      ),
    [book.state.foreshadowing]
  );
  const isCompleted = book.bookStatus === 'completed';
  const nextPhaseInfo = useMemo(() => {
    const t = book.outline.compass.targetChapters;
    if (t == null) return null;
    return getPhaseInfo(maxCommittedMain + 1, 1, t, book.outline.compass.tolerance);
  }, [book.outline.compass.targetChapters, book.outline.compass.tolerance, maxCommittedMain]);
  // Gate 3 入口：已进收官窗口（不自动完结，作者点开审核）。
  const showGate3Entry = !isCompleted && nextPhaseInfo != null && nextPhaseInfo.phase === 'finale';

  const [saveQuota, setSaveQuota] = useState<boolean>(() => {
    try {
      return localStorage.getItem('longnovel-save-quota') === '1';
    } catch {
      return false;
    }
  });
  const [gate3Open, setGate3Open] = useState(false);
  const [gate3Actions, setGate3Actions] = useState<Record<string, 'archive' | 'sequel'>>({});

  const [selectedChapterNum, setSelectedChapterNum] = useState<number>(() => {
    return sortedChapters[sortedChapters.length - 1]?.chapter || 1;
  });
  const [loopStep, setLoopStep] = useState<ChapterLoopStep>('contract');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [autoBatchTarget, setAutoBatchTarget] = useState<number>(3);
  const stopAutoRef = useRef<boolean>(false);

  const [contractNote, setContractNote] = useState('');
  const [proseGuidance, setProseGuidance] = useState('');
  const [aiAuditResult, setAiAuditResult] = useState<{
    chapter: number;
    aiSummary: string;
    issues: AuditReport['issues'];
  } | null>(null);
  const [reviseNotes, setReviseNotes] = useState('');
  const [commitProposal, setCommitProposal] = useState<CommitProposal | null>(null);
  const [quickCharName, setQuickCharName] = useState('');
  const [quickCharRole, setQuickCharRole] = useState('');

  useEffect(() => {
    if (!sortedChapters.some((c) => c.chapter === selectedChapterNum)) {
      setSelectedChapterNum(sortedChapters[sortedChapters.length - 1]?.chapter || 1);
    }
  }, [book.id, sortedChapters, selectedChapterNum]);

  const activeChapter: ChapterItem | undefined = useMemo(
    () => sortedChapters.find((c) => c.chapter === selectedChapterNum),
    [sortedChapters, selectedChapterNum]
  );

  const [draftContract, setDraftContract] = useState<ChapterContract | null>(
    activeChapter ? activeChapter.contract : null
  );
  const [draftProse, setDraftProse] = useState<string>(activeChapter?.prose || '');

  useEffect(() => {
    if (activeChapter) {
      setDraftContract(activeChapter.contract);
      setDraftProse(activeChapter.prose);
      setAiAuditResult(null);
      setCommitProposal(null);
      if (busyAction === null) {
        setErrorMsg(null);
        setStatusNotice(null);
      }
    }
  }, [activeChapter?.chapter, book.id]);

  const langSpec = LANGUAGE_SPECS[book.language];

  const currentChapterItemForAudit: ChapterItem | null = useMemo(() => {
    if (!activeChapter || !draftContract) return null;
    return {
      ...activeChapter,
      contract: draftContract,
      prose: draftProse,
    };
  }, [activeChapter, draftContract, draftProse]);

  const deterministicReport = useMemo(() => {
    if (!currentChapterItemForAudit) return null;
    return runDeterministicAudit(book, currentChapterItemForAudit, slopZh, slopEn);
  }, [book, currentChapterItemForAudit, slopZh, slopEn]);

  const mergedAuditIssues = useMemo(() => {
    const det = deterministicReport?.issues || [];
    const ai =
      aiAuditResult && aiAuditResult.chapter === selectedChapterNum ? aiAuditResult.issues : [];
    return [...det, ...ai];
  }, [deterministicReport, aiAuditResult, selectedChapterNum]);

  const liveSize = useMemo(() => countProseSize(draftProse, book.language), [draftProse, book.language]);

  const liveSlopHits = useMemo(() => {
    const pool = [
      ...(book.language === 'zh' ? slopZh : slopEn),
      ...(book.bible.voice.customBanned || []),
    ];
    const target = book.language === 'en' ? draftProse.toLowerCase() : draftProse;
    return pool.filter((p) => {
      const clean = p.trim();
      if (!clean) return false;
      return book.language === 'en' ? target.includes(clean.toLowerCase()) : target.includes(clean);
    });
  }, [draftProse, book.language, book.bible.voice.customBanned, slopZh, slopEn]);

  const persistActiveChapterChanges = async (
    nextContract: ChapterContract,
    nextProse: string,
    notice?: string
  ) => {
    const updatedChapters = book.chapters.map((c) =>
      c.chapter === nextContract.chapter
        ? {
            ...c,
            contract: nextContract,
            prose: nextProse,
            updatedAt: new Date().toISOString(),
          }
        : c
    );
    await onSaveBook({
      ...book,
      chapters: updatedChapters,
    });
    if (notice) setStatusNotice(notice);
  };

  useEffect(() => {
    if (!activeChapter || !draftContract) return;
    if (draftContract.chapter !== activeChapter.chapter) return;
    if (busyAction !== null) return;

    const isDirty =
      draftProse !== activeChapter.prose ||
      JSON.stringify(draftContract) !== JSON.stringify(activeChapter.contract);
    if (!isDirty) return;

    const timer = window.setTimeout(() => {
      void persistActiveChapterChanges(draftContract, draftProse);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [draftContract, draftProse, activeChapter, busyAction]);

  const handleCreateNextChapter = async (kind: ChapterKind = 'main') => {
    setErrorMsg(null);
    const maxCh = sortedChapters.length > 0 ? sortedChapters[sortedChapters.length - 1].chapter : 0;
    const nextNum = maxCh + 1;

    const prevCh = sortedChapters.find((c) => c.chapter === nextNum - 1);
    const roadmapRow = book.outline.roadmap.find((r) => r.chapter === nextNum);
    const shortGoalTitle = roadmapRow?.goal
      ? roadmapRow.goal.split(/[，。；：]/)[0].slice(0, 16)
      : '';
    const dueThreads = book.state.foreshadowing.filter(
      (f) =>
        (f.status === 'open' || f.status === 'progressing') &&
        (f.targetChapter === nextNum || nextNum >= f.payoffDue)
    );
    const dueHint =
      dueThreads.length > 0
        ? `【待引入/逾期伏笔】${dueThreads.map((f) => `${f.id}(${f.thread})`).join('；')}`
        : '';
    const kindGoal =
      kind === 'epilogue'
        ? '后记：收束全书余韵，交代主要人物归宿，不开新主线冲突'
        : kind === 'extra'
          ? '番外：独立小场景，不影响正史时间线'
          : roadmapRow?.goal || '';
    const kindTitle =
      kind === 'epilogue' ? '后记' : kind === 'extra' ? '番外' : shortGoalTitle;
    const cadence = bigCadenceFor(book.outline.compass.targetChapters);

    const newChapter: ChapterItem = {
      chapter: nextNum,
      status: 'draft',
      updatedAt: new Date().toISOString(),
      contract: {
        chapter: nextNum,
        title: formatChapterTitle(nextNum, kindTitle, book.language),
        language: book.language,
        desire: 'auto',
        desirePayoff: kindGoal,
        payoffSize:
          kind === 'main' && cadence != null && nextNum % cadence === 0 ? 'big' : 'auto',
        hook: roadmapRow?.hook || '',
        transition: prevCh ? `承接上一章：${prevCh.contract.transition}` : '开篇第一幕',
        mustHappen: [kindGoal, kind === 'main' ? dueHint : ''].filter(Boolean).join('；'),
        mustNot: '不可违背故事圣经硬约束；不可泄露角色未知信息；严禁虚构前文不存在的旧伏笔',
        characters: pickInitialChapterCharacters(book, nextNum),
        foreshadowingPlanted: [],
        foreshadowingPaid: [],
        chapterKind: kind,
        isProbe: false,
      },
      prose: '',
    };

    const updatedBook: BookProject = {
      ...book,
      chapters: [...book.chapters, newChapter],
    };
    await onSaveBook(updatedBook);
    setSelectedChapterNum(nextNum);
    setLoopStep('contract');
    setStatusNotice(
      dueThreads.length > 0
        ? `已创建 ${newChapter.contract.title}（已自动带入 ${dueThreads.length} 条逾期/待引入伏笔提醒）`
        : `已创建 ${newChapter.contract.title}（欲望与兑现级别默认由 AI 自动判断与执行），可直接点击「AI 按合同写正文」或「一键全自动完成本章」`
    );
  };

  const handleQuickAddCharacter = async () => {
    if (!draftContract) return;
    const cleanName = quickCharName.trim();
    if (!cleanName) {
      setErrorMsg('请输入新配角姓名后再添加');
      return;
    }
    if (book.bible.characters.some((c) => c.name === cleanName)) {
      if (!draftContract.characters.includes(cleanName)) {
        const nextContract = {
          ...draftContract,
          characters: [...draftContract.characters, cleanName],
        };
        setDraftContract(nextContract);
        await persistActiveChapterChanges(nextContract, draftProse, `已将已有角色「${cleanName}」加入本章出场阵容`);
      }
      setQuickCharName('');
      setQuickCharRole('');
      return;
    }
    setErrorMsg(null);
    const cleanRole = quickCharRole.trim() || '新出场配角';
    const nextBook = mergeNewCharactersIntoBook(
      book,
      [
        {
          name: cleanName,
          age: '待定',
          role: cleanRole,
          dna: '外形、衣着与随身信物待进一步丰富',
          want: '在本场事件中保全或争取自身诉求',
          need: '在冲突中被推动成长或暴露立场',
          flaw: '待补充',
          arc: `第 ${draftContract.chapter} 章登场`,
          introducedChapter: draftContract.chapter,
        },
      ],
      draftContract.chapter
    );
    const nextContract: ChapterContract = {
      ...draftContract,
      characters: [...draftContract.characters, cleanName],
    };
    setDraftContract(nextContract);
    await onSaveBook({
      ...nextBook,
      chapters: nextBook.chapters.map((c) =>
        c.chapter === nextContract.chapter
          ? { ...c, contract: nextContract, prose: draftProse, updatedAt: new Date().toISOString() }
          : c
      ),
    });
    setQuickCharName('');
    setQuickCharRole('');
    setStatusNotice(`已登记新角色「${cleanName}（${cleanRole}）」并加入本章出场名单`);
  };

  const handleAiDraftContract = async () => {
    if (!draftContract) return;
    setErrorMsg(null);
    setStatusNotice(null);
    setBusyAction('draft-contract');
    try {
      const res = await draftContractApi(book, draftContract.chapter, contractNote, draftContract);
      const generated = res.contract;
      setDraftContract(generated);
      const bookWithChars = mergeNewCharactersIntoBook(book, res.newCharacters, generated.chapter);
      await onSaveBook({
        ...bookWithChars,
        chapters: bookWithChars.chapters.map((c) =>
          c.chapter === generated.chapter
            ? {
                ...c,
                contract: generated,
                prose: draftProse,
                updatedAt: new Date().toISOString(),
              }
            : c
        ),
      });
      const addedNames = res.newCharacters.map((nc) => nc.name);
      setStatusNotice(
        addedNames.length > 0
          ? `AI 已自动判断欲望与兑现级别并生成合同，同时登记新配角：${addedNames.join('、')}`
          : 'AI 已根据圣经、Knows 边界与上一章交接生成合同（并自动决策欲望与兑现级别）'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleAiStreamProse = async () => {
    if (!draftContract) return;

    setErrorMsg(null);
    setStatusNotice(null);
    setBusyAction('write-prose');

    try {
      let workingBook = book;
      let contractToUse = draftContract;
      // Full-auto contract completion if desire/payoffSize is 'auto' or payoff/hook is incomplete
      if (
        contractToUse.desire === 'auto' ||
        contractToUse.payoffSize === 'auto' ||
        !contractToUse.desirePayoff.trim() ||
        contractToUse.hook.trim().length < 10
      ) {
        setStatusNotice(`正在由 AI 自动决策第 ${contractToUse.chapter} 章欲望、兑现级别并补全合同...`);
        const res = await draftContractApi(
          workingBook,
          contractToUse.chapter,
          contractNote,
          contractToUse
        );
        contractToUse = res.contract;
        setDraftContract(contractToUse);
        workingBook = mergeNewCharactersIntoBook(workingBook, res.newCharacters, contractToUse.chapter);
        workingBook = {
          ...workingBook,
          chapters: workingBook.chapters.map((c) =>
            c.chapter === contractToUse.chapter
              ? {
                  ...c,
                  contract: contractToUse,
                  prose: draftProse,
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
        };
        await onSaveBook(workingBook);
      }

      let accumulated = '';
      setDraftProse('');
      setStatusNotice(`正在流式创作第 ${contractToUse.chapter} 章《${contractToUse.title}》...`);

      await streamWriteChapterApi(workingBook, contractToUse, proseGuidance, (chunk) => {
        accumulated += chunk;
        setDraftProse(accumulated);
      });
      await onSaveBook({
        ...workingBook,
        chapters: workingBook.chapters.map((c) =>
          c.chapter === contractToUse.chapter
            ? {
                ...c,
                contract: contractToUse,
                prose: accumulated,
                updatedAt: new Date().toISOString(),
              }
            : c
        ),
      });
      setStatusNotice('正文流式创作完成并已自动保存草稿');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  // Full-auto single or multi-chapter pipeline: Contract -> Prose -> Deterministic Audit (+ Auto Revise) -> Atomic Commit
  const runAutoSerialize = async (count: number, startFromCurrentDraft: boolean) => {
    setErrorMsg(null);
    stopAutoRef.current = false;
    setBusyAction('auto-serialize');

    let workingBook = book;
    // 连写启动时记下 outlineRevision；期间作者改了目标/结局/卷纲则停下（手册 §九）。
    const startRevision = workingBook.outlineRevision ?? 1;

    try {
      for (let i = 0; i < count; i++) {
        if (stopAutoRef.current) {
          setStatusNotice('已手动停止全自动连写，当前已保存章节均已保留。');
          break;
        }

        // ① 迟到淘汰：台账页的罗盘已改过（服务端 outlineRevision 变了），本轮连写作废。
        try {
          const fresh = await getBookApi(workingBook.id);
          if ((fresh.outlineRevision ?? 1) !== startRevision) {
            setStatusNotice(
              '连写期间目标/结局/卷纲已被修改，本轮连写已停下（旧设定作废），请按新设定重新开始连写。'
            );
            break;
          }
        } catch {
          // 读不到最新版本不阻断连写（离线/本地模式），继续用当前书。
        }

        // ② 终章前停下：已进收官窗口且主线伏笔收束 → 停并建议 Gate 3；
        //    已超出收官窗口 → 停并让作者选收官或扩纲（手册 §七.3）。
        const targetCh = workingBook.outline.compass.targetChapters;
        if (targetCh != null) {
          const committedMain = Math.max(
            0,
            ...workingBook.chapters
              .filter(
                (c) =>
                  c.status === 'committed' && (c.contract.chapterKind ?? 'main') === 'main'
              )
              .map((c) => c.chapter)
          );
          const nextMainNum = committedMain + 1;
          const phase = getPhaseInfo(
            nextMainNum,
            1,
            targetCh,
            workingBook.outline.compass.tolerance
          );
          if (phase == null) break;
          if (phase.beyondBy > 0) {
            setStatusNotice(
              `已超出预定收官窗口 ${phase.beyondBy} 章（目标 ${targetCh} 章 ±${phase.tolerance}）。连写已停下：请到台账页确认收官（Gate 3）或调整目标章数扩纲。`
            );
            break;
          }
          if (phase.phase === 'finale') {
            const unclosed = workingBook.state.foreshadowing.filter(
              (f) =>
                (f.status === 'open' || f.status === 'progressing') &&
                (f.scope ?? 'series') !== 'episode'
            );
            if (unclosed.length === 0) {
              setStatusNotice(
                '已进入收官窗口且主线伏笔已收束。连写已停下，建议申请完结审核（Gate 3）确认终章。'
              );
              break;
            }
          }
        }

        // Determine target chapter
        let targetChapterObj: ChapterItem | undefined;
        if (i === 0 && startFromCurrentDraft && activeChapter && activeChapter.status === 'draft') {
          targetChapterObj = {
            ...activeChapter,
            contract: draftContract || activeChapter.contract,
            prose: draftProse,
          };
        } else {
          const sorted = [...workingBook.chapters].sort((a, b) => a.chapter - b.chapter);
          const existingDraft = sorted.find((c) => c.status === 'draft');
          if (existingDraft) {
            targetChapterObj = existingDraft;
          } else {
            const maxCh = sorted.length > 0 ? sorted[sorted.length - 1].chapter : 0;
            const nextNum = maxCh + 1;

            // Step 4 Arc Review automatically at 30-chapter milestones if roadmap runs out
            if (
              nextNum > 10 &&
              !workingBook.outline.roadmap.some((r) => r.chapter === nextNum)
            ) {
              setStatusNotice(`正在执行 Step 4 阶段复盘，为第 ${nextNum} 章起规划后续卷纲...`);
              const arc = await arcReviewApi(workingBook);
              const existingMap = new Map(workingBook.outline.roadmap.map((r) => [r.chapter, r]));
              for (const row of arc.nextChaptersPlan) {
                if (!existingMap.has(row.chapter)) {
                  existingMap.set(row.chapter, {
                    chapter: row.chapter,
                    goal: row.goal,
                    desire: (row.desire in DESIRE_SPECS ? row.desire : 'curiosity') as DesireKey,
                    hook: row.hook,
                    status: 'planned',
                  });
                }
              }
              workingBook = {
                ...workingBook,
                outline: {
                  ...workingBook.outline,
                  currentArc: {
                    ...workingBook.outline.currentArc,
                    goal: arc.nextArcGoal,
                    beats: arc.nextArcBeats,
                  },
                  roadmap: Array.from(existingMap.values()).sort((a, b) => a.chapter - b.chapter),
                },
              };
              await onSaveBook(workingBook);
            }

            const prevCh = sorted.find((c) => c.chapter === nextNum - 1);
            const roadmapRow = workingBook.outline.roadmap.find((r) => r.chapter === nextNum);
            const shortGoalTitle = roadmapRow?.goal
              ? roadmapRow.goal.split(/[，。；：]/)[0].slice(0, 16)
              : '';
            const dueThreads = workingBook.state.foreshadowing.filter(
              (f) =>
                (f.status === 'open' || f.status === 'progressing') &&
                (f.targetChapter === nextNum || nextNum >= f.payoffDue)
            );
            const dueHint =
              dueThreads.length > 0
                ? `【待引入/逾期伏笔】${dueThreads.map((f) => `${f.id}(${f.thread})`).join('；')}`
                : '';
            const cadence = bigCadenceFor(workingBook.outline.compass.targetChapters);
            targetChapterObj = {
              chapter: nextNum,
              status: 'draft',
              updatedAt: new Date().toISOString(),
              contract: {
                chapter: nextNum,
                title: formatChapterTitle(nextNum, shortGoalTitle, workingBook.language),
                language: workingBook.language,
                desire: 'auto',
                desirePayoff: roadmapRow?.goal || '',
                payoffSize:
                  cadence != null && nextNum % cadence === 0 ? 'big' : 'auto',
                hook: roadmapRow?.hook || '',
                transition: prevCh ? `承接上一章：${prevCh.contract.transition}` : '开篇第一幕',
                mustHappen: [roadmapRow?.goal || '', dueHint].filter(Boolean).join('；'),
                mustNot: '不可违背故事圣经硬约束；不可泄露角色未知信息；严禁虚构前文不存在的旧伏笔',
                characters: pickInitialChapterCharacters(workingBook, nextNum),
                foreshadowingPlanted: [],
                foreshadowingPaid: [],
                isProbe: false,
              },
              prose: '',
            };
            workingBook = {
              ...workingBook,
              chapters: [...workingBook.chapters, targetChapterObj],
            };
            await onSaveBook(workingBook);
          }
        }

        const chNum = targetChapterObj.chapter;
        setSelectedChapterNum(chNum);
        setLoopStep('prose');

        let contract = targetChapterObj.contract;
        let prose = targetChapterObj.prose;
        let proposal: CommitProposal | null = null;

        if (!prose.trim()) {
          if (saveQuota) {
            // 省配额单次合并路径（用户显式勾选）：合同+正文一次请求，
            // 提示词明令不得外露结尾细节（手册 §四.4）。
            setStatusNotice(`[全自动 ${i + 1}/${count}] 正在一并生成第 ${chNum} 章合同、正文与正史状态（省配额模式）...`);
            const bundled = await autoChapterBundleApi({
              book: workingBook,
              chapterNum: chNum,
              existingContract: contract,
              authorGuidance: [contractNote, proseGuidance].filter(Boolean).join('；'),
              singleRequest: true,
            });
            contract = bundled.contract;
            prose = bundled.prose;
            proposal = bundled.proposal;
            workingBook = mergeNewCharactersIntoBook(workingBook, proposal.newCharacters, chNum);
            setDraftContract(contract);
            setDraftProse(prose);
          } else {
            // 默认两步隔离（手册 §四）：合同步可看 endingSummary → 正文步盲写，
            // 正文提示词里看不到 plannedEnding 与 endingSummary。
            setStatusNotice(`[全自动 ${i + 1}/${count}] 正在起草第 ${chNum} 章合同...`);
            const res = await draftContractApi(workingBook, chNum, contractNote, contract);
            contract = res.contract;
            workingBook = mergeNewCharactersIntoBook(workingBook, res.newCharacters, chNum);
            setDraftContract(contract);
            setStatusNotice(`[全自动 ${i + 1}/${count}] 正在按合同写第 ${chNum} 章正文（盲写，不见结局）...`);
            let accumulated = '';
            await streamWriteChapterApi(workingBook, contract, proseGuidance, (chunk) => {
              accumulated += chunk;
              setDraftProse(accumulated);
            });
            prose = accumulated;
          }
        } else {
          if (
            contract.desire === 'auto' ||
            contract.payoffSize === 'auto' ||
            !contract.desirePayoff.trim() ||
            contract.hook.trim().length < 10 ||
            !contract.mustHappen.trim()
          ) {
            setStatusNotice(`[全自动 ${i + 1}/${count}] 正在自动决策并补全第 ${chNum} 章合同...`);
            const res = await draftContractApi(workingBook, chNum, contractNote, contract);
            contract = res.contract;
            workingBook = mergeNewCharactersIntoBook(workingBook, res.newCharacters, chNum);
            setDraftContract(contract);
          }
        }

        if (stopAutoRef.current) break;

        // Deterministic Audit + Auto Bounded Revise only if blocking slop/canon issues appear
        let candidateItem: ChapterItem = {
          ...targetChapterObj,
          contract,
          prose,
        };
        const report = runDeterministicAudit(workingBook, candidateItem, slopZh, slopEn);
        // 跨章重复不是局部能修的：复述前章整段只能重写，不能打补丁；更不能入库。
        // 停在这里，该章草稿不入库，下次重新生成时再写。
        const dupIssue = report.issues.find((iss) => iss.id.startsWith('canon-repeat-prev-'));
        if (dupIssue) {
          setErrorMsg(`${dupIssue.message} 已停止全自动连写；该章草稿未入库，重新生成后再继续。`);
          break;
        }
        if (!report.passed) {
          const blockingText = report.issues
            .filter((iss) => iss.severity === 'blocking')
            .map((iss) => `${iss.message}${iss.citation ? ` (${iss.citation})` : ''}`)
            .join('\n');
          setStatusNotice(`[全自动 ${i + 1}/${count}] 第 ${chNum} 章触发去 AI 味/合规修补，正在局部修订...`);
          const revised = await boundedReviseApi(workingBook, candidateItem, blockingText);
          prose = revised;
          setDraftProse(revised);
          candidateItem = { ...candidateItem, prose };
        }

        workingBook = {
          ...workingBook,
          chapters: workingBook.chapters.map((c) =>
            c.chapter === chNum ? { ...c, contract, prose, updatedAt: new Date().toISOString() } : c
          ),
        };
        await onSaveBook(workingBook);

        if (stopAutoRef.current) break;

        if (!proposal) {
          setStatusNotice(`[全自动 ${i + 1}/${count}] 正在提取第 ${chNum} 章状态变更并原子入库...`);
          proposal = await prepareCommitApi(workingBook, candidateItem);
        } else {
          setStatusNotice(`[全自动 ${i + 1}/${count}] 正在执行第 ${chNum} 章 CHAPTER_COMMIT 原子入库...`);
        }

        const committedBook = await commitChapterApi(workingBook, proposal, startRevision);
        workingBook = committedBook;
        await onSaveBook(committedBook);

        setStatusNotice(`第 ${chNum} 章《${contract.title}》已全自动创作并原子提交入库（已完成 ${i + 1}/${count} 章）`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      stopAutoRef.current = false;
      setBusyAction(null);
    }
  };

  const handleAiSubReview = async () => {
    if (!currentChapterItemForAudit) return;
    if (!draftProse.trim()) {
      setErrorMsg('正文为空，请先撰写或生成正文再执行 8 维子审。');
      return;
    }
    setErrorMsg(null);
    setStatusNotice(null);
    setBusyAction('sub-review');
    try {
      const result = await subReviewApi(book, currentChapterItemForAudit);
      setAiAuditResult({
        chapter: currentChapterItemForAudit.chapter,
        aiSummary: result.aiSummary,
        issues: result.issues,
      });
      setStatusNotice('已完成 8 维独立子审');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleBoundedRevise = async () => {
    if (!currentChapterItemForAudit) return;
    const blockingSummary = mergedAuditIssues
      .filter((i) => i.dimension !== 'length' || i.severity === 'blocking')
      .map((i) => `[${i.severity}] ${i.message}${i.citation ? ` (原文: ${i.citation})` : ''}`)
      .join('\n');
    const finalIssuesText = [reviseNotes.trim(), blockingSummary].filter(Boolean).join('\n');
    if (!finalIssuesText) {
      setErrorMsg('请先运行审计或输入需要局部修订的具体问题。');
      return;
    }

    setErrorMsg(null);
    setStatusNotice(null);
    setBusyAction('bounded-revise');
    try {
      const revised = await boundedReviseApi(book, currentChapterItemForAudit, finalIssuesText);
      setDraftProse(revised);
      await persistActiveChapterChanges(
        currentChapterItemForAudit.contract,
        revised,
        '已完成有界局部修订并保存，建议重新运行审计确认'
      );
      setLoopStep('prose');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handlePrepareCommit = async () => {
    if (!currentChapterItemForAudit) return;
    if (deterministicReport && !deterministicReport.passed) {
      setErrorMsg('阻断项未通过：请先在「阻断审计」中解决所有红色阻断项后再准备 CHAPTER_COMMIT。');
      return;
    }
    setErrorMsg(null);
    setStatusNotice(null);
    setBusyAction('prepare-commit');
    try {
      const proposal = await prepareCommitApi(book, currentChapterItemForAudit);
      setCommitProposal(proposal);
      setStatusNotice('已提取正史状态变更提案，请核对后执行原子提交');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleExecuteCommit = async () => {
    if (!commitProposal || !draftContract) return;
    setErrorMsg(null);
    setBusyAction('commit');
    try {
      const updatedDraftBook: BookProject = {
        ...book,
        chapters: book.chapters.map((c) =>
          c.chapter === draftContract.chapter
            ? {
                ...c,
                contract: draftContract,
                prose: draftProse,
                updatedAt: new Date().toISOString(),
              }
            : c
        ),
      };
      await onSaveBook(updatedDraftBook);
      const updated = await commitChapterApi(updatedDraftBook, commitProposal, book.outlineRevision ?? 1);
      await onSaveBook(updated);
      setCommitProposal(null);
      setStatusNotice(`第 ${commitProposal.chapter} 章已完成 CHAPTER_COMMIT 原子提交，正史与台账已同步更新`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleRollbackChapter = async () => {
    if (!activeChapter) return;
    setErrorMsg(null);
    setBusyAction('rollback');
    try {
      const updated = await rollbackChapterApi(book, activeChapter.chapter);
      await onSaveBook(updated);
      setStatusNotice(`已将第 ${activeChapter.chapter} 章回滚为草稿，其提交的摘要、时间线与 Knows 增量已撤回`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleApproveGate2 = async () => {
    await onSaveBook({ ...book, gate2Approved: true });
    setStatusNotice('Gate 2（黄金三章诊断）已确认通过，现可进入连载创作循环');
  };

  // Gate 3 完结审核（手册 §七）：作者确认后才完结；现场可把剩余 open 线
  // 归档（本卷收束）或留给续作（导出种子时带走）。完结后只收起主线入口，
  // 后记/番外仍可写，删终章回退由服务端 trashChapter 处理。
  const handleConfirmComplete = async () => {
    setErrorMsg(null);
    setBusyAction('gate3-complete');
    try {
      const nextThreads = book.state.foreshadowing.map((f) => {
        const action = gate3Actions[f.id];
        if (!action) return f;
        return action === 'archive' ? { ...f, status: 'archived' as const } : f;
      });
      await onSaveBook({
        ...book,
        bookStatus: 'completed',
        completedAtChapter: maxCommittedMain,
        state: { ...book.state, foreshadowing: nextThreads },
      });
      setGate3Open(false);
      setStatusNotice(
        `《${book.title}》已完结于第 ${maxCommittedMain} 章（正篇 ${mainWords.toLocaleString()} 字）。可写后记/番外，或导出续作种子开新卷。`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleReopenBook = async () => {
    setErrorMsg(null);
    setBusyAction('gate3-reopen');
    try {
      await onSaveBook({ ...book, bookStatus: 'ongoing', completedAtChapter: undefined });
      setStatusNotice('已重新开卷，主线入口恢复。');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportSequelSeed = async () => {
    setErrorMsg(null);
    setBusyAction('export-seed');
    try {
      await downloadSequelSeedApi(book);
      setStatusNotice('续作种子 JSON 已下载，可在建书时用「续作种子导入」开新卷。');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteDraftChapter = async () => {
    if (!activeChapter || activeChapter.status !== 'draft' || sortedChapters.length <= 1) return;
    const snapshot: ChapterItem = {
      ...activeChapter,
      contract: draftContract || activeChapter.contract,
      prose: draftProse,
      updatedAt: new Date().toISOString(),
    };
    const remaining = book.chapters.filter((c) => c.chapter !== activeChapter.chapter);
    const nextFallback = [...remaining].sort((a, b) => a.chapter - b.chapter)[remaining.length - 1];
    await onSaveBook({
      ...book,
      chapters: remaining,
    });
    if (onMoveChapterToTrash) {
      await onMoveChapterToTrash(snapshot);
    }
    if (nextFallback) {
      setSelectedChapterNum(nextFallback.chapter);
    }
    setStatusNotice(`已将第 ${activeChapter.chapter} 章草稿移入回收站，可在顶部「回收站」恢复`);
  };

  const toggleCharacterInContract = (name: string) => {
    if (!draftContract) return;
    const exists = draftContract.characters.includes(name);
    const nextChars = exists
      ? draftContract.characters.filter((c) => c !== name)
      : [...draftContract.characters, name];
    setDraftContract({ ...draftContract, characters: nextChars });
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8 items-start">
      {/* Left Rail: Chapter List */}
      <aside className="bg-white border border-zinc-200 rounded-xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-zinc-100">
          <h2 className="text-sm font-semibold text-zinc-900">章节目录</h2>
          <span className="text-xs text-zinc-500 font-mono tabular-nums">
            {book.state.committedChapters.length} 已提交 / {sortedChapters.length} 总章
          </span>
        </div>

        <div className="flex flex-col gap-1 max-h-[520px] overflow-y-auto pr-1">
          {sortedChapters.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4 text-center">尚无章节，点击下方规划第 1 章</p>
          ) : (
            sortedChapters.map((ch) => {
              const isSelected = ch.chapter === selectedChapterNum;
              const desireLabel =
                ch.contract.desire === 'auto'
                  ? 'AI 自动判断欲望'
                  : DESIRE_SPECS[ch.contract.desire]?.labelZh || ch.contract.desire;
              const payoffLabel =
                ch.contract.payoffSize === 'big'
                  ? ' · 大兑现'
                  : ch.contract.payoffSize === 'auto'
                  ? ' · AI 兑现'
                  : '';
              return (
                <button
                  key={ch.chapter}
                  type="button"
                  onClick={() => setSelectedChapterNum(ch.chapter)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    isSelected
                      ? 'bg-blue-50/80 border border-blue-200 text-zinc-900'
                      : 'border border-transparent hover:bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold tabular-nums text-zinc-500">
                      CH {String(ch.chapter).padStart(3, '0')}
                    </span>
                    <span
                      className={`text-xs font-medium ${
                        ch.status === 'committed' ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {ch.status === 'committed' ? '已提交' : '草稿'}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-zinc-900 truncate mt-0.5">
                    {ch.contract.title || '未命名章节'}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 truncate">
                    {desireLabel}
                    {payoffLabel}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-zinc-100">
          {isCompleted ? (
            <>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-950">
                本书已完结于第 {book.completedAtChapter ?? maxCommittedMain} 章。主线入口已收起，
                后记/番外仍按顺序递增章号，不计入主线进度。
              </div>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => handleCreateNextChapter('epilogue')}
                className="w-full py-2 px-3 flex items-center justify-center gap-1.5 text-sm font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>写后记（第 {(sortedChapters[sortedChapters.length - 1]?.chapter || 0) + 1} 章）</span>
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => handleCreateNextChapter('extra')}
                className="w-full py-2 px-3 flex items-center justify-center gap-1.5 text-sm font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>写番外（第 {(sortedChapters[sortedChapters.length - 1]?.chapter || 0) + 1} 章）</span>
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleReopenBook}
                className="w-full py-2 px-3 flex items-center justify-center gap-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                <span>重新开卷（恢复主线）</span>
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleExportSequelSeed}
                className="w-full py-2 px-3 flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <span>{busyAction === 'export-seed' ? '导出中...' : '导出续作种子（JSON）'}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={() => handleCreateNextChapter()}
                className="w-full py-2 px-3 flex items-center justify-center gap-1.5 text-sm font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>新建第 {(sortedChapters[sortedChapters.length - 1]?.chapter || 0) + 1} 章</span>
              </button>

              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-blue-950">全自动长篇连写</span>
                  <select
                    value={autoBatchTarget}
                    onChange={(e) => setAutoBatchTarget(Number(e.target.value))}
                    disabled={busyAction !== null}
                    className="px-2 py-1 text-xs bg-white border border-blue-200 rounded font-mono"
                    aria-label="自动连写章数"
                  >
                    <option value={1}>连写 1 章</option>
                    <option value={3}>连写 3 章</option>
                    <option value={5}>连写 5 章</option>
                    <option value={10}>连写 10 章</option>
                  </select>
                </div>
                <label className="flex items-start gap-1.5 text-[11px] text-blue-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveQuota}
                    onChange={(e) => {
                      setSaveQuota(e.target.checked);
                      try {
                        localStorage.setItem('longnovel-save-quota', e.target.checked ? '1' : '0');
                      } catch {
                        // 忽略本地存储失败
                      }
                    }}
                    disabled={busyAction !== null}
                    className="mt-0.5"
                  />
                  <span>
                    省配额单次合并请求（合同+正文一次调用；默认关，两步隔离更防泄底）
                  </span>
                </label>
                {busyAction === 'auto-serialize' ? (
                  <button
                    type="button"
                    onClick={() => {
                      stopAutoRef.current = true;
                    }}
                    className="w-full py-2 px-3 flex items-center justify-center gap-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>停止连写（保留已写章节）</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => runAutoSerialize(autoBatchTarget, false)}
                    className="w-full py-2 px-3 flex items-center justify-center gap-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>自动连写 {autoBatchTarget} 章（含合同与入库）</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </aside>

      {/* Main Writing & Audit Workspace */}
      <section className="flex flex-col gap-5 min-w-0">
        {/* Optional Non-Blocking Review Hints */}
        {!book.gate1Approved && (
          <div className="bg-zinc-100 border border-zinc-200 rounded-xl px-5 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-zinc-700">
              <strong className="font-semibold text-zinc-900">提示：</strong>
              您可随时在「故事圣经」微调设定与硬约束，系统不会限制您直接开始创作。
            </div>
            <button
              type="button"
              onClick={onOpenBible}
              className="px-3 py-1 text-xs font-medium bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              查看故事圣经
            </button>
          </div>
        )}

        {!book.gate2Approved && book.state.committedChapters.length >= 3 && (
          <div className="bg-blue-50/70 border border-blue-200 rounded-xl px-5 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-blue-950">
              <strong className="font-semibold">黄金三章里程碑：</strong>
              已完成前三章正史提交，可继续向第 4–100+ 章连载，或点击确认标记完成前三章抽检。
            </div>
            <button
              type="button"
              onClick={handleApproveGate2}
              className="px-3 py-1 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              标记抽检完成
            </button>
          </div>
        )}

        {/* Gate 3 完结审核入口（手册 §七）：进收官窗口才出现，不自动完结 */}
        {showGate3Entry && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-amber-950">
              <strong className="font-semibold">已进入终局收官窗口：</strong>
              主线已写 {maxCommittedMain} 章（目标 {book.outline.compass.targetChapters} 章 ±
              {nextPhaseInfo!.tolerance}，{nextPhaseInfo!.winStart}–{nextPhaseInfo!.winEnd}{' '}
              章收官），未结主线伏笔 {unclosedMainThreads.length} 条。可开完结审核，确认终章后完结。
            </div>
            <button
              type="button"
              onClick={() => setGate3Open(true)}
              className="px-3 py-1 text-xs font-medium bg-amber-700 hover:bg-amber-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              申请完结审核（Gate 3）
            </button>
          </div>
        )}

        {/* Error & Status Feedback */}
        {errorMsg && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-900 rounded-xl px-4 py-3 text-sm flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {statusNotice && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-4 py-3 text-sm flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusNotice}</span>
          </div>
        )}

        {!activeChapter || !draftContract ? (
          <div className="bg-white border border-zinc-200 rounded-xl p-12 text-center">
            <p className="text-zinc-600 text-sm mb-4">当前尚无章节，请先创建第 1 章。</p>
            <button
              type="button"
              onClick={() => handleCreateNextChapter()}
              className="px-4 py-2 text-sm font-medium bg-blue-700 text-white rounded-lg hover:bg-blue-800 cursor-pointer"
            >
              创建第 1 章
            </button>
          </div>
        ) : (
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            {/* Chapter Workspace Header & Segmented 4-Step Tabs */}
            <div className="px-6 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="font-mono font-semibold tabular-nums">
                    第 {draftContract.chapter} 章
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{activeChapter.status === 'committed' ? '已提交正史' : '草稿状态'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {liveSize} {langSpec.unitLabel}
                  </span>
                </div>
                <h1 className="font-display text-xl font-semibold text-zinc-900 mt-0.5">
                  {draftContract.title || '未命名章节'}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {activeChapter.status === 'draft' && (
                  <>
                    {sortedChapters.length > 1 && (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={handleDeleteDraftChapter}
                        title="将本章草稿移入回收站（可随时恢复）"
                        className="px-2.5 py-1.5 text-xs text-zinc-600 hover:text-red-700 border border-zinc-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        移入回收站
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => runAutoSerialize(1, true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {busyAction === 'auto-serialize' ? '全自动执行中...' : '一键全自动完成本章'}
                      </span>
                    </button>
                  </>
                )}

                <div className="flex items-center gap-1 p-1 bg-zinc-100 rounded-lg overflow-x-auto">
                  {(
                    [
                      { id: 'contract', label: '1. 章节合同' },
                      { id: 'prose', label: '2. 正文创作' },
                      { id: 'audit', label: `3. 阻断审计 (${mergedAuditIssues.filter((i) => i.severity === 'blocking').length})` },
                      { id: 'commit', label: '4. 原子提交' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setLoopStep(tab.id)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        loopStep === tab.id
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Committed Read-only / Rollback Banner */}
            {activeChapter.status === 'committed' && (
              <div className="px-6 py-3 bg-zinc-50 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-zinc-600">
                  本章已通过 <code className="font-mono text-zinc-800">CHAPTER_COMMIT</code> 写入正史。如需大幅改稿，请先执行状态回滚。
                </span>
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={handleRollbackChapter}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 hover:bg-zinc-100 rounded-md whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{busyAction === 'rollback' ? '回滚中...' : '回滚至草稿 (State Rollback)'}</span>
                </button>
              </div>
            )}

            {/* STEP 1: CHAPTER CONTRACT */}
            {loopStep === 'contract' && (
              <div className="p-6 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-8">
                <div className="flex flex-col gap-5">
                  {/* AI Draft Contract Bar */}
                  <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                    <input
                      type="text"
                      value={contractNote}
                      onChange={(e) => setContractNote(e.target.value)}
                      placeholder="可选：给 AI 的本章剧情方向提示（例如：今晚潜入码头核对账本）"
                      className="flex-1 px-3 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={handleAiDraftContract}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>{busyAction === 'draft-contract' ? 'AI 起草中...' : 'AI 起草本章节合同'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                        章节标题 (title)
                      </label>
                      <input
                        type="text"
                        value={draftContract.title}
                        onChange={(e) =>
                          setDraftContract({ ...draftContract, title: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                        兑现级别 (payoff_size · 默认交由 AI 自动执行)
                      </label>
                      <select
                        value={draftContract.payoffSize}
                        onChange={(e) =>
                          setDraftContract({
                            ...draftContract,
                            payoffSize: e.target.value as PayoffSize,
                          })
                        }
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        <option value="auto">AI 自动判断并执行（推荐默认）</option>
                        <option value="small">small（小兑现 / 常规推进）</option>
                        <option value="big">big（大高潮 / 10章节点）</option>
                        <option value="none">none（纯铺垫，限非3倍数章）</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                        主导欲望 (8 种核心欲望 · 默认由 AI 自动选择)
                      </label>
                      <select
                        value={draftContract.desire}
                        onChange={(e) =>
                          setDraftContract({
                            ...draftContract,
                            desire: e.target.value as ContractDesireSetting,
                          })
                        }
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        <option value="auto">AI 自动判断选择（推荐默认）</option>
                        {Object.values(DESIRE_SPECS).map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.labelZh} ({d.key})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="inline-flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(draftContract.isProbe)}
                          onChange={(e) =>
                            setDraftContract({ ...draftContract, isProbe: e.target.checked })
                          }
                          className="rounded border-zinc-300 text-blue-700 focus:ring-blue-600"
                        />
                        <span>标记为探针/样章（允许 {langSpec.probeMinSize}+ {langSpec.unitLabel}）</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                      欲望兑现承诺 (desire_payoff — 一句话写明本章实际交付了什么)
                    </label>
                    <input
                      type="text"
                      value={draftContract.desirePayoff}
                      onChange={(e) =>
                        setDraftContract({ ...draftContract, desirePayoff: e.target.value })
                      }
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                      章末钩子 (hook — 必须不少于 10 字符，驱动读者点开下一章)
                    </label>
                    <input
                      type="text"
                      value={draftContract.hook}
                      onChange={(e) =>
                        setDraftContract({ ...draftContract, hook: e.target.value })
                      }
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                      交接字段 (transition — 写明下一章承接的地点、时间与状态)
                    </label>
                    <textarea
                      rows={2}
                      value={draftContract.transition}
                      onChange={(e) =>
                        setDraftContract({ ...draftContract, transition: e.target.value })
                      }
                      className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                        必须发生 (must_happen，按序)
                      </label>
                      <textarea
                        rows={3}
                        value={draftContract.mustHappen}
                        onChange={(e) =>
                          setDraftContract({ ...draftContract, mustHappen: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                        绝对禁止 (must_not)
                      </label>
                      <textarea
                        rows={3}
                        value={draftContract.mustNot}
                        onChange={(e) =>
                          setDraftContract({ ...draftContract, mustNot: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 mb-2">
                      出场人物 (已登记角色 · AI 起草或全自动写作时也可自动锻造新配角入库)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {book.bible.characters.map((c) => {
                        const active = draftContract.characters.includes(c.name);
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleCharacterInContract(c.name)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                              active
                                ? 'bg-blue-700 text-white border-blue-700'
                                : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
                            }`}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={quickCharName}
                        onChange={(e) => setQuickCharName(e.target.value)}
                        placeholder="快速登记新配角姓名"
                        className="px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg bg-white w-40"
                      />
                      <input
                        type="text"
                        value={quickCharRole}
                        onChange={(e) => setQuickCharRole(e.target.value)}
                        placeholder="定位（如：线人 / 巡捕 / 宿敌）"
                        className="px-2.5 py-1.5 text-xs border border-zinc-300 rounded-lg bg-white w-48"
                      />
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={handleQuickAddCharacter}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>加入人物档案并出场</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                        本章埋设伏笔 ID（逗号分隔，如 F04）
                      </label>
                      <input
                        type="text"
                        value={draftContract.foreshadowingPlanted.join(', ')}
                        onChange={(e) =>
                          setDraftContract({
                            ...draftContract,
                            foreshadowingPlanted: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                        本章兑现伏笔 ID（逗号分隔，须已存在于台账）
                      </label>
                      <input
                        type="text"
                        value={draftContract.foreshadowingPaid.join(', ')}
                        onChange={(e) =>
                          setDraftContract({
                            ...draftContract,
                            foreshadowingPaid: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        className="w-full px-3 py-2 text-sm font-mono border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        persistActiveChapterChanges(draftContract, draftProse, '章节合同已保存')
                      }
                      className="px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg cursor-pointer"
                    >
                      保存合同
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await persistActiveChapterChanges(draftContract, draftProse);
                        setLoopStep('prose');
                      }}
                      className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
                    >
                      保存并进入正文创作
                    </button>
                  </div>
                </div>

                {/* Right Reference: Hard Constraints & Knows */}
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-5 flex flex-col gap-5">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-900 mb-2">
                      硬约束复述（写前必读）
                    </h3>
                    <ol className="text-xs text-zinc-700 space-y-2 list-decimal list-inside leading-relaxed">
                      {book.bible.hardConstraints.map((rule, idx) => (
                        <li key={idx}>{rule}</li>
                      ))}
                    </ol>
                  </div>

                  <div className="pt-4 border-t border-zinc-200">
                    <h3 className="text-xs font-semibold text-zinc-900 mb-2">
                      出场人物 Knows 边界
                    </h3>
                    <ul className="text-xs text-zinc-600 space-y-1.5 leading-relaxed">
                      {book.state.knows
                        .filter((k) => draftContract.characters.includes(k.characterName))
                        .slice(0, 8)
                        .map((k) => (
                          <li key={k.id}>
                            <span className="font-medium text-zinc-800">{k.characterName}</span>{' '}
                            <span className={k.knows ? 'text-emerald-700' : 'text-red-700'}>
                              [{k.knows ? '已知' : '未知'}]
                            </span>
                            ：{k.fact}
                          </li>
                        ))}
                    </ul>
                  </div>

                  <div className="pt-4 border-t border-zinc-200">
                    <h3 className="text-xs font-semibold text-zinc-900 mb-2">
                      未结伏笔台账提醒
                    </h3>
                    <ul className="text-xs text-zinc-600 space-y-2.5">
                      {book.state.foreshadowing
                        .filter((f) => f.status === 'open' || f.status === 'progressing')
                        .map((f) => {
                          const isOverdue = draftContract.chapter >= f.payoffDue;
                          const isTargeted = f.targetChapter === draftContract.chapter;
                          const alreadyPaidInContract = draftContract.foreshadowingPaid.includes(f.id);
                          return (
                            <li
                              key={f.id}
                              className={`p-2 rounded-lg border ${
                                isOverdue || isTargeted
                                  ? 'bg-amber-50/70 border-amber-200'
                                  : 'bg-white border-zinc-200'
                              }`}
                            >
                              <div>
                                <span className="font-mono font-semibold text-zinc-900">{f.id}</span>
                                {' · '}
                                <span
                                  className={`font-mono ${
                                    isOverdue ? 'text-red-700 font-semibold' : ''
                                  }`}
                                >
                                  due Ch{f.payoffDue}
                                  {isOverdue ? ' (已逾期)' : ''}
                                </span>
                                {isTargeted && (
                                  <span className="text-blue-700 font-medium"> · 指定本章引入</span>
                                )}
                              </div>
                              <div className="text-zinc-700 mt-0.5 leading-relaxed">{f.thread}</div>
                              {activeChapter.status === 'draft' && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const mention = `引入推进伏笔 ${f.id}（${f.thread}）`;
                                      const nextMust = draftContract.mustHappen.includes(f.id)
                                        ? draftContract.mustHappen
                                        : [draftContract.mustHappen.trim(), mention]
                                            .filter(Boolean)
                                            .join('；');
                                      setDraftContract({ ...draftContract, mustHappen: nextMust });
                                    }}
                                    className="px-2 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer"
                                  >
                                    写入本章剧情
                                  </button>
                                  {!alreadyPaidInContract && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const mention = `本章兑现伏笔 ${f.id}（${f.thread}）`;
                                        const nextMust = draftContract.mustHappen.includes(f.id)
                                          ? draftContract.mustHappen
                                          : [draftContract.mustHappen.trim(), mention]
                                              .filter(Boolean)
                                              .join('；');
                                        setDraftContract({
                                          ...draftContract,
                                          mustHappen: nextMust,
                                          foreshadowingPaid: [...draftContract.foreshadowingPaid, f.id],
                                        });
                                      }}
                                      className="px-2 py-0.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded cursor-pointer"
                                    >
                                      本章彻底兑现
                                    </button>
                                  )}
                                  {isOverdue && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const nextF = book.state.foreshadowing.map((it) =>
                                          it.id === f.id
                                            ? {
                                                ...it,
                                                payoffDue:
                                                  Math.max(it.payoffDue, draftContract.chapter) + 5,
                                                targetChapter: undefined,
                                                deferReason: `在第 ${draftContract.chapter} 章顺延 5 章`,
                                              }
                                            : it
                                        );
                                        await onSaveBook({
                                          ...book,
                                          state: { ...book.state, foreshadowing: nextF },
                                        });
                                        setStatusNotice(`伏笔 ${f.id} 兑现期已顺延 5 章`);
                                      }}
                                      className="px-2 py-0.5 text-[11px] text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded cursor-pointer"
                                    >
                                      顺延 +5章
                                    </button>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: PROSE DRAFTING & READING */}
            {loopStep === 'prose' && (
              <div className="p-6 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-zinc-50 border border-zinc-200 rounded-lg p-3.5">
                  <input
                    type="text"
                    value={proseGuidance}
                    onChange={(e) => setProseGuidance(e.target.value)}
                    placeholder="可选：执笔细节指令（例如：对白再冷硬一些，多写雨夜码头的器物声响）"
                    className="flex-1 px-3 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={handleAiStreamProse}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <PenLine className="w-4 h-4" />
                      <span>{busyAction === 'write-prose' ? 'AI 实时流式创作中...' : 'AI 按合同写正文'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        persistActiveChapterChanges(draftContract, draftProse, '正文草稿已保存')
                      }
                      className="px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      保存草稿
                    </button>
                  </div>
                </div>

                {/* Live De-Slop & Length Strip */}
                <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-600 px-1">
                  <div className="flex items-center gap-3">
                    <span>
                      当前篇幅：
                      <strong className="font-mono tabular-nums text-zinc-900">
                        {liveSize} {langSpec.unitLabel}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      目标区间：
                      <span className="font-mono tabular-nums">
                        {draftContract.isProbe ? `${langSpec.probeMinSize}+` : `${langSpec.minSize}–${langSpec.maxSize}`}
                      </span>
                    </span>
                  </div>

                  {liveSlopHits.length > 0 ? (
                    <span className="text-red-700 font-medium">
                      检测到禁用 AI 套话：{liveSlopHits.join('、')}
                    </span>
                  ) : (
                    <span className="text-emerald-700">去 AI 味词表检查：未命中禁用陈词</span>
                  )}
                </div>

                <textarea
                  rows={22}
                  value={draftProse}
                  onChange={(e) => setDraftProse(e.target.value)}
                  placeholder="在此撰写正文，或点击上方「AI 按合同写正文」流式生成..."
                  className="w-full p-6 font-prose text-[16px] leading-[1.85] text-zinc-900 bg-white border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
                />

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-zinc-500">
                    约定钩子：{draftContract.hook || '未设置'}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await persistActiveChapterChanges(draftContract, draftProse);
                      setLoopStep('audit');
                    }}
                    className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
                  >
                    进入第 3 步：阻断审计
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: AUDIT & BOUNDED REVISE */}
            {loopStep === 'audit' && (
              <div className="p-6 flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-200">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">
                      双层阻断审计（脚本规则校验 + AI 8 维子审）
                    </h2>
                    <p className="text-xs text-zinc-500 mt-1">
                      任何一条阻断项（blocking）不通过，章节不得进入 CHAPTER_COMMIT。
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={handleAiSubReview}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    <span>{busyAction === 'sub-review' ? 'AI 8维审查中...' : '运行 AI 8维子审'}</span>
                  </button>
                </div>

                {/* Deterministic & AI Summary Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 border border-zinc-200 rounded-lg">
                    <div className="text-xs text-zinc-500">阻断项 (Blocking)</div>
                    <div
                      className={`text-2xl font-mono font-semibold tabular-nums mt-1 ${
                        mergedAuditIssues.filter((i) => i.severity === 'blocking').length > 0
                          ? 'text-red-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {mergedAuditIssues.filter((i) => i.severity === 'blocking').length}
                    </div>
                  </div>
                  <div className="p-4 border border-zinc-200 rounded-lg">
                    <div className="text-xs text-zinc-500">警告项 (Warning)</div>
                    <div className="text-2xl font-mono font-semibold tabular-nums mt-1 text-amber-700">
                      {mergedAuditIssues.filter((i) => i.severity === 'warning').length}
                    </div>
                  </div>
                  <div className="p-4 border border-zinc-200 rounded-lg">
                    <div className="text-xs text-zinc-500">本章体量</div>
                    <div className="text-2xl font-mono font-semibold tabular-nums mt-1 text-zinc-900">
                      {liveSize} <span className="text-xs font-sans font-normal text-zinc-500">{langSpec.unitLabel}</span>
                    </div>
                  </div>
                </div>

                {aiAuditResult && aiAuditResult.chapter === selectedChapterNum && (
                  <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg text-sm text-zinc-800">
                    <strong className="font-semibold">AI 子审总评：</strong>
                    {aiAuditResult.aiSummary}
                  </div>
                )}

                {/* Issues Table */}
                {mergedAuditIssues.length === 0 ? (
                  <div className="p-8 border border-emerald-200 bg-emerald-50/50 rounded-xl text-center text-sm text-emerald-900">
                    确定性脚本检查全项通过。建议同时运行「AI 8维子审」核查人物 Knows 边界与语调一致性。
                  </div>
                ) : (
                  <div className="border border-zinc-200 rounded-xl divide-y divide-zinc-200">
                    {mergedAuditIssues.map((issue) => (
                      <div key={issue.id} className="p-4 flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span
                            className={`font-semibold ${
                              issue.severity === 'blocking' ? 'text-red-700' : 'text-amber-700'
                            }`}
                          >
                            {issue.severity === 'blocking' ? '[阻断 FAIL]' : '[警告 WARN]'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-zinc-800">
                            {DIMENSION_LABELS[issue.dimension] || issue.dimension}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-zinc-500">
                            {issue.source === 'deterministic' ? '脚本引擎' : 'AI 8维审稿'}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-900">{issue.message}</p>
                        {issue.citation && (
                          <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded px-2.5 py-1.5 font-prose">
                            引文：{issue.citation}
                          </p>
                        )}
                        {issue.suggestion && (
                          <p className="text-xs text-blue-800">建议：{issue.suggestion}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Bounded Revise Box */}
                <div className="p-5 bg-zinc-50 border border-zinc-200 rounded-xl flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                    <Wrench className="w-4 h-4 text-zinc-700" />
                    <span>Step 3.4 有界局部修订 (Bounded Revise)</span>
                  </div>
                  <p className="text-xs text-zinc-600">
                    仅针对上述审计问题做局部外科手术式修补，禁止整章重写导致声音漂移。
                  </p>
                  <textarea
                    rows={2}
                    value={reviseNotes}
                    onChange={(e) => setReviseNotes(e.target.value)}
                    placeholder="可选：补充你想让 AI 局部修改的指令（会自动附带上方所有审计问题）"
                    className="w-full px-3 py-2 text-sm bg-white border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <div className="flex items-center justify-between gap-4">
                    <button
                      type="button"
                      disabled={busyAction !== null || !draftProse.trim()}
                      onClick={handleBoundedRevise}
                      className="px-4 py-2 text-sm font-medium bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      {busyAction === 'bounded-revise' ? '局部修订中...' : '执行有界局部修订'}
                    </button>

                    <button
                      type="button"
                      disabled={deterministicReport ? !deterministicReport.passed : false}
                      onClick={() => setLoopStep('commit')}
                      className="px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg cursor-pointer disabled:opacity-40"
                    >
                      进入第 4 步：原子提交
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: ATOMIC CHAPTER_COMMIT */}
            {loopStep === 'commit' && (
              <div className="p-6 flex flex-col gap-6">
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-200">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-900">
                      Step 3.5 原子提交 (CHAPTER_COMMIT)
                    </h2>
                    <p className="text-xs text-zinc-500 mt-1">
                      只有提交了的章节，其事实才进正史与台账；正文与 state/ 必须同步落盘。
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction !== null || (deterministicReport ? !deterministicReport.passed : false)}
                    onClick={handlePrepareCommit}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-700 hover:bg-blue-800 text-white rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <FileCheck2 className="w-4 h-4" />
                    <span>{busyAction === 'prepare-commit' ? '提取状态变更中...' : 'AI 提取状态变更提案'}</span>
                  </button>
                </div>

                {deterministicReport && !deterministicReport.passed && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-900">
                    当前章节仍有 {deterministicReport.blockingCount} 条阻断项未解决，请先返回「3. 阻断审计」修复。
                  </div>
                )}

                {!commitProposal ? (
                  <div className="p-8 border border-dashed border-zinc-300 rounded-xl text-center text-sm text-zinc-600">
                    点击右上角「AI 提取状态变更提案」，系统将从本章正文自动抽取摘要、人物状态更新、Knows 新增事实与伏笔变更供您核对。
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                          一句话章节摘要 (state/summary.md)
                        </label>
                        <input
                          type="text"
                          value={commitProposal.summaryLine}
                          onChange={(e) =>
                            setCommitProposal({ ...commitProposal, summaryLine: e.target.value })
                          }
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                          时间线标签 (Day / Time)
                        </label>
                        <input
                          type="text"
                          value={commitProposal.timelineDayLabel}
                          onChange={(e) =>
                            setCommitProposal({
                              ...commitProposal,
                              timelineDayLabel: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                        时间线事件记录 (state/timeline.md)
                      </label>
                      <input
                        type="text"
                        value={commitProposal.timelineEvent}
                        onChange={(e) =>
                          setCommitProposal({ ...commitProposal, timelineEvent: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                      />
                    </div>

                    <div>
                      <h3 className="text-xs font-semibold text-zinc-800 mb-2">
                        人物状态增量 (state/character_state.md)
                      </h3>
                      <div className="space-y-2">
                        {commitProposal.characterStateUpdates.map((cs, idx) => (
                          <div key={idx} className="flex items-center gap-3">
                            <span className="w-24 text-xs font-medium text-zinc-800 shrink-0">
                              {cs.characterName}
                            </span>
                            <input
                              type="text"
                              value={cs.currentState}
                              onChange={(e) => {
                                const next = [...commitProposal.characterStateUpdates];
                                next[idx] = { ...cs, currentState: e.target.value };
                                setCommitProposal({
                                  ...commitProposal,
                                  characterStateUpdates: next,
                                });
                              }}
                              className="flex-1 px-3 py-1.5 text-sm border border-zinc-300 rounded-lg"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {(commitProposal.newCharacters || []).length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-800 mb-2">
                          本章新登场并自动登记入圣经的角色 ({commitProposal.newCharacters!.length})
                        </h3>
                        <ul className="space-y-2 text-xs">
                          {commitProposal.newCharacters!.map((nc, idx) => (
                            <li
                              key={`${nc.name}-${idx}`}
                              className="p-2.5 bg-blue-50/60 border border-blue-200 rounded-lg text-zinc-800"
                            >
                              <span className="font-semibold text-zinc-900">{nc.name}</span>
                              {' · '}
                              <span>{nc.role}</span>
                              {nc.want ? `（诉求：${nc.want}）` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-800 mb-2">
                          新增 Knows 信息事实 ({commitProposal.newKnowsEntries.length})
                        </h3>
                        {commitProposal.newKnowsEntries.length === 0 ? (
                          <p className="text-xs text-zinc-500">本章无新增角色信息边界变动</p>
                        ) : (
                          <ul className="space-y-2 text-xs">
                            {commitProposal.newKnowsEntries.map((k, idx) => (
                              <li
                                key={idx}
                                className="p-2.5 bg-zinc-50 border border-zinc-200 rounded-lg"
                              >
                                <span className="font-semibold">{k.characterName}</span> ·{' '}
                                <span>{k.knows ? '得知' : '仍不知'}</span>：{k.fact}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div>
                        <h3 className="text-xs font-semibold text-zinc-800 mb-2">
                          伏笔台账变更（新埋 {commitProposal.newForeshadowing.length} / 推进顺延{' '}
                          {(commitProposal.updatedForeshadowing || []).length} / 兑现{' '}
                          {commitProposal.paidForeshadowingIds.length}）
                        </h3>
                        <ul className="space-y-2 text-xs">
                          {commitProposal.newForeshadowing.map((f, idx) => (
                            <li
                              key={idx}
                              className="p-2.5 bg-blue-50/60 border border-blue-200 rounded-lg"
                            >
                              新埋 <span className="font-mono font-semibold">{f.id}</span>（约定 Ch
                              {f.payoffDue} 兑现）：{f.thread}
                            </li>
                          ))}
                          {(commitProposal.updatedForeshadowing || []).map((u) => (
                            <li
                              key={u.id}
                              className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg"
                            >
                              {u.status === 'deferred' ? '批准延期' : '推进顺延'}{' '}
                              <span className="font-mono font-semibold">{u.id}</span> → 新兑现 Ch
                              {u.newPayoffDue}
                              {u.note ? `（${u.note}）` : ''}
                            </li>
                          ))}
                          {commitProposal.paidForeshadowingIds.map((id) => (
                            <li
                              key={id}
                              className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg"
                            >
                              标记已兑现 (paid)：<span className="font-mono font-semibold">{id}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-zinc-200 flex justify-end">
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={handleExecuteCommit}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
                      >
                        <GitCommitHorizontal className="w-4 h-4" />
                        <span>
                          {busyAction === 'commit'
                            ? '原子提交中...'
                            : `确认 CHAPTER_COMMIT（第 ${commitProposal.chapter} 章入库正史）`}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Gate 3 完结审核弹窗（手册 §七.2） */}
      {gate3Open && (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl p-6 flex flex-col gap-4">
            <h3 className="font-display text-lg font-semibold text-zinc-900">
              完结审核（Gate 3）—《{book.title}》
            </h3>
            <div className="text-sm text-zinc-700 space-y-1">
              <div>终章：第 {maxCommittedMain} 章（正篇主线）</div>
              <div>
                统计：正篇 {maxCommittedMain} 章 · {mainWords.toLocaleString()} 字 · 后记/番外{' '}
                {book.chapters.filter(
                  (c) => (c.contract.chapterKind ?? 'main') !== 'main'
                ).length}{' '}
                篇
              </div>
              {book.outline.compass.endingSummary && (
                <div>一句话结局：{book.outline.compass.endingSummary}</div>
              )}
            </div>
            <div>
              <div className="text-xs font-semibold text-zinc-800 mb-2">
                剩余未结伏笔（{unclosedMainThreads.length} 条）— 可现场归档或留给续作
              </div>
              {unclosedMainThreads.length === 0 ? (
                <p className="text-xs text-zinc-600">主线伏笔已全部收束，可以完结。</p>
              ) : (
                <ul className="space-y-2">
                  {unclosedMainThreads.map((f) => (
                    <li
                      key={f.id}
                      className="p-2.5 border border-zinc-200 rounded-lg flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="text-xs text-zinc-800">
                        {f.id}（{f.thread}）· 约定第 {f.payoffDue} 章
                      </span>
                      <select
                        value={gate3Actions[f.id] ?? ''}
                        onChange={(e) =>
                          setGate3Actions((prev) => ({
                            ...prev,
                            [f.id]: e.target.value as 'archive' | 'sequel',
                          }))
                        }
                        className="px-2 py-1 text-xs border border-zinc-300 rounded bg-white"
                      >
                        <option value="">不处理（留在台账）</option>
                        <option value="archive">归档（本卷收束，不再追）</option>
                        <option value="sequel">留给续作（进续作种子）</option>
                      </select>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={handleConfirmComplete}
                className="px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg cursor-pointer disabled:opacity-50"
              >
                {busyAction === 'gate3-complete' ? '完结中...' : '确认全书完结'}
              </button>
              <button
                type="button"
                onClick={() => setGate3Open(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-700 border border-zinc-300 rounded-lg cursor-pointer"
              >
                暂不完结
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
