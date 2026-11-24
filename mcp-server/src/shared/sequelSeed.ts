// 续作种子 JSON（手册 §八.4）：完结时把未结的线 + 结局笔记导出成下一本书的种子，
// 也可反向导入建书。结构化 JSON，不只是文本，供以后导入读取。
import type { BookProject, SequelSeed } from './types.ts';

export function buildSequelSeed(book: BookProject): SequelSeed {
  const mainCommitted = book.state.committedChapters.filter((n) => {
    const ch = book.chapters.find((c) => c.chapter === n);
    return (ch?.contract.chapterKind ?? 'main') === 'main';
  });
  const maxMain = mainCommitted.length > 0 ? Math.max(...mainCommitted) : undefined;
  const stateMap = new Map(book.state.characterStates.map((c) => [c.characterName, c.currentState]));
  return {
    seedVersion: 1,
    sourceBookId: book.id,
    sourceBookTitle: book.title,
    language: book.language,
    genreId: book.genreId,
    completedAtChapter: book.completedAtChapter ?? maxMain,
    endingSummary: book.outline.compass.endingSummary,
    worldRules: book.bible.worldRules,
    hardConstraints: book.bible.hardConstraints,
    survivingCharacters: book.bible.characters.map((c) => ({
      name: c.name,
      role: c.role,
      dna: c.dna,
      lastState: stateMap.get(c.name) ?? '',
    })),
    unresolvedThreads: book.state.foreshadowing
      .filter((f) => f.status === 'open' || f.status === 'progressing')
      .map((f) => ({
        id: f.id,
        thread: f.thread,
        scope: f.scope ?? 'series',
        kind: f.kind,
      })),
  };
}

export function validateSequelSeed(doc: unknown): { ok: true; seed: SequelSeed } | { ok: false; error: string } {
  if (doc == null || typeof doc !== 'object') return { ok: false, error: '续作种子不是有效的 JSON 对象' };
  const d = doc as Record<string, unknown>;
  if (d.seedVersion !== 1) return { ok: false, error: '不支持的续作种子版本（需要 seedVersion: 1）' };
  if (typeof d.sourceBookId !== 'string' || typeof d.sourceBookTitle !== 'string') {
    return { ok: false, error: '续作种子缺少 sourceBookId / sourceBookTitle' };
  }
  if (d.language !== 'zh' && d.language !== 'en') {
    return { ok: false, error: '续作种子 language 须为 zh 或 en' };
  }
  if (!Array.isArray(d.survivingCharacters) || !Array.isArray(d.unresolvedThreads)) {
    return { ok: false, error: '续作种子缺少 survivingCharacters / unresolvedThreads 数组' };
  }
  return { ok: true, seed: d as unknown as SequelSeed };
}

/** 从续作种子建书（骨架）：人物与未结线带过来，目标章数留空由作者补填。 */
export function createBookFromSequelSeed(seed: SequelSeed, title: string): BookProject {
  const now = new Date().toISOString();
  return {
    id: `book-${Date.now()}`,
    title: title.trim() || `《${seed.sourceBookTitle}》续作`,
    language: seed.language,
    platform: seed.language === 'zh' ? '番茄小说 (Fanqie)' : 'Royal Road',
    genreId: seed.genreId,
    formula: 'sequel-from-seed',
    gate1Approved: true,
    gate2Approved: true,
    bookStatus: 'ongoing',
    outlineRevision: 1,
    bible: {
      premise: `续作：承接《${seed.sourceBookTitle}》的结局。${seed.endingSummary ?? '未结的线继续展开。'}`,
      era: '承接前作',
      setting: '承接前作世界',
      worldRules: seed.worldRules ?? '承接前作世界规则',
      locations: ['主舞台地点 1'],
      hardConstraints: seed.hardConstraints?.length
        ? seed.hardConstraints
        : ['死去的人不复活；任何角色不得提前知道未告知的信息。'],
      cultureAnchors: {
        clothing: '承接前作',
        food: '承接前作',
        objects: '承接前作',
        landscape: '承接前作',
        colour: '承接前作',
      },
      voice: {
        narrator: '克制写实，多写动作与对白',
        dialogueDistinctness: '为每位主要角色设计不同句长与口癖',
        customBanned: [],
      },
      characters: seed.survivingCharacters.map((c, idx) => ({
        id: `char-seed-${idx}`,
        name: c.name,
        age: '承接前作',
        role: c.role,
        dna: c.dna,
        want: '承接前作',
        need: '承接前作',
        flaw: '承接前作',
        arc: `续作弧线（前作终态：${c.lastState || '待补充'}）`,
      })),
    },
    outline: {
      compass: {
        endDirection: seed.endingSummary ?? '待补充终局方向',
        activeLongThreads: seed.unresolvedThreads.map((t) => t.id).join('、') || '待补充',
        scaleEstimate: '待补充目标章数',
        centralQuestion: '待补充核心悬念',
        whatBookIsNot: '不写与核心前提冲突的水字桥段',
      },
      currentArc: {
        rangeLabel: '第 1–30 章',
        goal: '承接前作未结线，开新卷',
        beats: ['第 1 章承接前作终态'],
        payoff: '第 3 章小兑现',
        newElementsNote: '每卷至多新增 1 处核心新地点',
      },
      roadmap: [
        { chapter: 1, goal: '承接前作未结线开篇', desire: 'curiosity', hook: '待填写章末钩子', status: 'draft' },
      ],
    },
    state: {
      committedChapters: [],
      nextChapter: 1,
      summaries: [],
      characterStates: seed.survivingCharacters.map((c) => ({
        characterName: c.name,
        currentState: c.lastState || '承接前作终态',
      })),
      foreshadowing: seed.unresolvedThreads.map((t) => ({
        id: t.id,
        planted: 1,
        payoffDue: 30,
        status: 'open' as const,
        thread: t.thread,
        scope: t.scope,
        kind: t.kind,
      })),
      knows: [],
      timeline: [],
    },
    chapters: [
      {
        chapter: 1,
        status: 'draft',
        updatedAt: now,
        contract: {
          chapter: 1,
          title: seed.language === 'zh' ? '第 1 章 承接' : 'Chapter 1',
          language: seed.language,
          desire: 'auto',
          desirePayoff: '承接前作未结线',
          payoffSize: 'auto',
          hook: '待填写章末钩子',
          transition: '开篇第一幕',
          mustHappen: '承接前作未结线',
          mustNot: '不可违背圣经硬约束',
          characters: seed.survivingCharacters.slice(0, 3).map((c) => c.name),
          foreshadowingPlanted: [],
          foreshadowingPaid: [],
          isProbe: false,
        },
        prose: '',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
