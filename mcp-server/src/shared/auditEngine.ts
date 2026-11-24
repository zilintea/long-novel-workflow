import type { AuditIssue, AuditReport, BookProject, ChapterItem } from './types.ts';
import { DEFAULT_SLOP_LIST, DESIRE_SPECS, LANGUAGE_SPECS } from './skillSpecs.ts';
import {
  bigCadenceFor,
  effectiveTolerance,
  isShortWordMode,
  nearEndWarningThreshold,
} from './phase.ts';

// v2 规则：无名占位角色名（与 skill 提示词层的 GENERIC_PLACEHOLDER_NAME_RE 同源）。
// 确定性审计在此处阻断：合同出场人物不得使用黑衣人/神秘人/路人/店小二/stranger 等无名代称。
const GENERIC_PLACEHOLDER_NAME_RE =
  /^(黑衣人|神秘人|陌生人|路人|过路人|行人|群众|围观者|侍卫|护卫|士兵|家丁|管家|掌柜|店小二|小二|老板|老者|老头|老妇|少女|少年|男子|女子|男人|女人|杀手|刺客|打手|保镖|医生|大夫|护士|秘书|助理|司机|主角|反派|男主|女主|配角|龙套|甲|乙|丙|丁|某人|无名|unknown|stranger|guard|assassin|passerby|protagonist|waiter|doctor)[0-9一二三四五六七八九十甲乙丙丁]*$/i;

export function isPlaceholderCharacterName(rawName: string): boolean {
  const clean = rawName.trim();
  if (!clean) return true;
  if (GENERIC_PLACEHOLDER_NAME_RE.test(clean)) return true;
  if (/^(某|第[一二三四五六七八九十\d]+号|未知)/.test(clean)) return true;
  return false;
}

// v2 规则：章节标题须带规范前缀「第N章」/「Chapter N」（check_chapter.py 同款）。
function hasCanonicalChapterTitlePrefix(title: string, num: number): boolean {
  const clean = title.trim();
  if (!clean) return false;
  return (
    new RegExp(`^第\\s*${num}\\s*章`).test(clean) ||
    new RegExp(`^Chapter\\s*${num}\\b`, 'i').test(clean)
  );
}

export function countProseSize(prose: string, language: 'zh' | 'en'): number {
  const trimmed = prose.trim();
  if (!trimmed) return 0;
  if (language === 'zh') {
    return trimmed.replace(/\s+/g, '').length;
  }
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/**
 * 单章正文字数下限（手册 §六.2）：中文长篇 2100 字（skillSpecs.zh.minSize），
 * 短篇字数模式（targetWords 启用且 T <= 20）为 1500 字；英文沿用 langSpec.minSize。
 */
export function effectiveMinSize(book: BookProject): number {
  const langSpec = LANGUAGE_SPECS[book.language];
  if (
    book.language === 'zh' &&
    isShortWordMode(book.outline.compass.targetChapters, book.outline.compass.targetWords)
  ) {
    return 1500;
  }
  return langSpec.minSize;
}

// 跨章重复比对：本章长句（去空白与标点后 ≥ 12 字）逐字出现在前章原文中的占比。
// 短句与通用语不计，避免误伤正常的一两句前情回调；换词改写不在此查，只由写章提示词层的
// 防重写铁律约束（本检查只拦逐字/近逐字复述，即“重写前章”最常见的形态）。
function repeatedSentenceRatio(
  candidate: string,
  reference: string
): { ratio: number; sample: string } {
  const strip = (s: string) =>
    s.replace(/[\s，。、！？；：""''（）《》〈〉,.!?;:'"()[\]{}<>|/\\\-_~@#%^&*+=]/g, '');
  const cand = candidate.trim();
  const ref = strip(reference);
  if (!cand || !ref) return { ratio: 0, sample: '' };
  const sentences = cand
    .split(/[。！？.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => strip(s).length >= 12);
  if (sentences.length === 0) return { ratio: 0, sample: '' };
  let dupChars = 0;
  let totalChars = 0;
  let sample = '';
  for (const s of sentences) {
    const n = strip(s);
    totalChars += n.length;
    if (n && ref.includes(n)) {
      dupChars += n.length;
      if (!sample) sample = s.length > 60 ? `${s.slice(0, 60)}……` : s;
    }
  }
  return { ratio: totalChars === 0 ? 0 : dupChars / totalChars, sample };
}

export function runDeterministicAudit(
  book: BookProject,
  chapterItem: ChapterItem,
  customSlopZh: string[] = DEFAULT_SLOP_LIST.zh,
  customSlopEn: string[] = DEFAULT_SLOP_LIST.en
): AuditReport {
  const issues: AuditIssue[] = [];
  const { contract, prose } = chapterItem;
  const num = contract.chapter;
  const langSpec = LANGUAGE_SPECS[book.language];
  const proseSize = countProseSize(prose, book.language);

  // 1. Contract completeness & Hook + Desire checks (check_hooks.py parity)
  if (!contract.title.trim()) {
    issues.push({
      id: `contract-title-${num}`,
      dimension: 'contract',
      severity: 'blocking',
      source: 'deterministic',
      message: '章节合同缺少标题 (title)。',
    });
  } else if (!hasCanonicalChapterTitlePrefix(contract.title, num)) {
    issues.push({
      id: `contract-title-prefix-${num}`,
      dimension: 'contract',
      severity: 'warning',
      source: 'deterministic',
      message: `章节标题建议使用规范前缀「第 ${num} 章」/「Chapter ${num}」（当前标题：${contract.title.trim()}）。`,
    });
  }

  if (contract.desire === 'auto') {
    if (prose.trim().length > 0) {
      issues.push({
        id: `hook-desire-auto-${num}`,
        dimension: 'hook_desire',
        severity: 'warning',
        source: 'deterministic',
        message: '主导欲望当前为「AI 自动判断」，请点击「AI 起草本章节合同」或「一键全自动」完成定型。',
      });
    }
  } else if (!DESIRE_SPECS[contract.desire]) {
    issues.push({
      id: `hook-desire-type-${num}`,
      dimension: 'hook_desire',
      severity: 'blocking',
      source: 'deterministic',
      message: `欲望类型不在支持列表内：${contract.desire}`,
    });
  }

  if (!contract.desirePayoff.trim()) {
    issues.push({
      id: `hook-desire-payoff-${num}`,
      dimension: 'hook_desire',
      severity: 'blocking',
      source: 'deterministic',
      message: '缺少 desire_payoff：必须一句话说明本章实际兑现了什么欲望。',
    });
  }

  const hookLen = contract.hook.trim().length;
  if (hookLen < 10) {
    issues.push({
      id: `hook-missing-${num}`,
      dimension: 'hook_desire',
      severity: 'blocking',
      source: 'deterministic',
      message: `章末钩子 (hook) 不足 10 字符（当前 ${hookLen} 字符）——阻断项。`,
    });
  } else if (hookLen < 20) {
    issues.push({
      id: `hook-weak-${num}`,
      dimension: 'hook_desire',
      severity: 'warning',
      source: 'deterministic',
      message: `章末钩子偏短（${hookLen} 字符，建议 >=20 字符以确保张力）。`,
    });
  }

  if (!contract.transition.trim()) {
    issues.push({
      id: `contract-transition-${num}`,
      dimension: 'contract',
      severity: 'blocking',
      source: 'deterministic',
      message: '缺少交接字段 (transition)：必须写明下一章承接的地点、时间与状态。',
    });
  }

  const chapterKind = contract.chapterKind ?? 'main';
  const isMainChapter = chapterKind === 'main';
  const targetChapters = book.outline.compass.targetChapters;
  const isCommitted = chapterItem.status === 'committed';

  if (contract.payoffSize === 'auto') {
    if (prose.trim().length > 0) {
      issues.push({
        id: `cadence-auto-${num}`,
        dimension: 'hook_desire',
        severity: 'warning',
        source: 'deterministic',
        message: '兑现级别当前为「AI 自动执行」，建议由 AI 自动定型为 small 或 big 后再提交。',
      });
    }
  } else if (isMainChapter) {
    // 动态 bigCadence（手册 §六.1）：取消写死的 %10，改读 targetChapters。
    // 已提交章按 bigCadenceSnapshot 核对（缩纲不溯及既往）；无快照的已提交老章豁免；
    // 草稿章按当前动态 bigCadence。T < 30 跳过（bigCadence 为 null）。
    const currentCadence = bigCadenceFor(targetChapters);
    const effectiveCadence = isCommitted ? (contract.bigCadenceSnapshot ?? null) : currentCadence;
    if (effectiveCadence != null && num % effectiveCadence === 0 && contract.payoffSize !== 'big') {
      issues.push({
        id: `cadence-big-${num}`,
        dimension: 'hook_desire',
        severity: 'blocking',
        source: 'deterministic',
        message: `第 ${num} 章为大节点章（bigCadence=${effectiveCadence}），payoff_size 必须为 big。`,
      });
    }

    // %3 强兑现：T < 10 或短篇模式（targetWords 启用）放宽；已提交章不溯及既往。
    const relaxPercent3 =
      (targetChapters != null && targetChapters < 10) ||
      book.outline.compass.targetWords != null;
    if (!relaxPercent3 && !isCommitted) {
      if (num % 3 === 0 && contract.payoffSize !== 'small' && contract.payoffSize !== 'big') {
        issues.push({
          id: `cadence-3-${num}`,
          dimension: 'hook_desire',
          severity: 'blocking',
          source: 'deterministic',
          message: `第 ${num} 章为 3 的倍数节点章，必须声明 payoff_size 为 small 或 big。`,
        });
      }
    }
  }

  if (num >= 2 && contract.characters.length <= 1) {
    issues.push({
      id: `cast-thin-${num}`,
      dimension: 'character_voice',
      severity: 'warning',
      source: 'deterministic',
      message: `当前章节仅登记了 ${contract.characters.length} 位出场人物，易演变成主角单人独角戏。建议补充 1–2 位具名对手/盟友/关键见证人参与互动。`,
    });
  }

  // 2. Prose presence & length check (check_chapter.py parity)
  const paragraphs = prose
    .trim()
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    issues.push({
      id: `prose-empty-${num}`,
      dimension: 'length',
      severity: 'blocking',
      source: 'deterministic',
      message: '正文为空，尚无任何段落内容。',
    });
  } else if (isMainChapter) {
    // 后记/番外豁免字数上下限检查（空正文仍在上面阻断）。
    const minLimit = contract.isProbe ? langSpec.probeMinSize : effectiveMinSize(book);
    if (proseSize < langSpec.probeMinSize) {
      issues.push({
        id: `length-too-short-${num}`,
        dimension: 'length',
        severity: 'blocking',
        source: 'deterministic',
        message: `正文过短（${proseSize} ${langSpec.unitLabel}），低于探针底线 ${langSpec.probeMinSize}。`,
      });
    } else if (proseSize < minLimit) {
      issues.push({
        id: `length-below-serial-${num}`,
        dimension: 'length',
        severity: 'warning',
        source: 'deterministic',
        message: `正文为 ${proseSize} ${langSpec.unitLabel}，低于连载标准下限 ${minLimit}（如为探针/节选可勾选“探针章”）。`,
      });
    } else if (proseSize > langSpec.maxSize) {
      issues.push({
        id: `length-too-long-${num}`,
        dimension: 'length',
        severity: 'warning',
        source: 'deterministic',
        message: `正文为 ${proseSize} ${langSpec.unitLabel}，超出建议上限 ${langSpec.maxSize}，建议精简或拆分。`,
      });
    }
  }

  // 3. De-slop banned AI-flavour phrase scan (data/slop/<lang>.yaml + bible.voice.customBanned)
  const slopPool = new Set<string>([
    ...(book.language === 'zh' ? customSlopZh : customSlopEn),
    ...(book.bible.voice.customBanned || []),
  ]);

  const lowerProse = book.language === 'en' ? prose.toLowerCase() : prose;
  for (const phrase of slopPool) {
    const clean = phrase.trim();
    if (!clean) continue;
    const needle = book.language === 'en' ? clean.toLowerCase() : clean;
    const idx = lowerProse.indexOf(needle);
    if (idx !== -1) {
      const start = Math.max(0, idx - 18);
      const end = Math.min(prose.length, idx + clean.length + 22);
      const excerpt = prose.slice(start, end).replace(/\n+/g, ' ');
      issues.push({
        id: `slop-${clean}-${num}`,
        dimension: 'prose_deslop',
        severity: 'blocking',
        source: 'deterministic',
        message: `命中去 AI 味禁用词：「${clean}」`,
        citation: `……${excerpt}……`,
        suggestion: '请用具体动作、对话或感官细节替换该 AI 套话或全知剧透句式。',
      });
    }
  }

  // 4. Continuity checks (check_continuity.py parity)
  const knownCharNames = new Set(book.bible.characters.map((c) => c.name.trim()));
  for (const charName of contract.characters) {
    if (charName.trim() && !knownCharNames.has(charName.trim())) {
      issues.push({
        id: `canon-unknown-char-${charName}-${num}`,
        dimension: 'canon',
        severity: 'blocking',
        source: 'deterministic',
        message: `合同出场人物「${charName}」未登记在故事圣经 (bible/characters) 中。`,
      });
    }
    if (charName.trim() && isPlaceholderCharacterName(charName)) {
      issues.push({
        id: `canon-placeholder-char-${charName}-${num}`,
        dimension: 'character_voice',
        severity: 'blocking',
        source: 'deterministic',
        message: `合同出场人物「${charName}」是无名占位代称（黑衣人/神秘人/路人/店小二/stranger 等），必须锻造具体姓名与动机后登记入圣经。`,
      });
    }
  }

  const ledgerMap = new Map(book.state.foreshadowing.map((f) => [f.id.trim(), f]));

  // Prevent planted ID collisions with existing earlier-chapter threads
  for (const fid of contract.foreshadowingPlanted) {
    const clean = fid.trim();
    if (!clean) continue;
    const existing = ledgerMap.get(clean);
    if (existing && existing.planted !== num) {
      issues.push({
        id: `foreshadow-id-collision-${clean}-${num}`,
        dimension: 'foreshadowing',
        severity: 'blocking',
        source: 'deterministic',
        message: `合同声明新埋伏笔「${clean}」，但该编号已在第 ${existing.planted} 章登记（${existing.thread}），请使用新编号以免覆盖原伏笔。`,
        suggestion: '请顺延使用未占用的新编号（如 F04、F05），或在台账中核对。',
      });
    }
  }

  for (const fid of contract.foreshadowingPaid) {
    const clean = fid.trim();
    if (!clean) continue;
    const existing = ledgerMap.get(clean);
    if (!existing) {
      issues.push({
        id: `foreshadow-unplanted-${clean}-${num}`,
        dimension: 'foreshadowing',
        severity: 'blocking',
        source: 'deterministic',
        message: `合同声明兑现伏笔「${clean}」，但伏笔台账中从未埋设该条目（禁止凭空产生前文不存在的伏笔）。`,
      });
    } else if (existing.status === 'paid' && existing.paidChapter !== num) {
      issues.push({
        id: `foreshadow-already-paid-${clean}-${num}`,
        dimension: 'foreshadowing',
        severity: 'warning',
        source: 'deterministic',
        message: `伏笔「${clean}」此前已标记为 paid（已兑现），无需重复兑现。`,
      });
    }
  }

  const paidSet = new Set(contract.foreshadowingPaid.map((s) => s.trim()));
  const contractMentionText = `${contract.title} ${contract.mustHappen} ${contract.desirePayoff} ${contract.hook}`;

  // Check overdue or >= 30 chapter stale open/progressing threads
  // （后记/番外不参与主线伏笔 pacing 检查；archived 线天然不在 open/progressing 之列。）
  const pacingThreads = isMainChapter ? book.state.foreshadowing : [];
  for (const thread of pacingThreads) {
    if (thread.status === 'open' || thread.status === 'progressing') {
      const addressedInContract =
        paidSet.has(thread.id.trim()) ||
        contractMentionText.includes(thread.id.trim()) ||
        (thread.thread.length >= 4 && contractMentionText.includes(thread.thread.slice(0, 6)));

      if (thread.targetChapter === num && !addressedInContract) {
        issues.push({
          id: `foreshadow-targeted-${thread.id}`,
          dimension: 'foreshadowing',
          severity: 'warning',
          source: 'deterministic',
          message: `伏笔 ${thread.id}（${thread.thread}）已标记为第 ${num} 章引入，但当前合同尚未体现该伏笔。`,
          suggestion: '建议在「1. 章节合同」右侧台账点击「纳入本章」，或重新让 AI 起草合同。',
        });
      } else if (num >= thread.payoffDue && !addressedInContract) {
        issues.push({
          id: `foreshadow-overdue-${thread.id}`,
          dimension: 'foreshadowing',
          severity: 'warning',
          source: 'deterministic',
          message: `已逾期伏笔 ${thread.id}（${thread.thread}）约定在第 ${thread.payoffDue} 章兑现，现已到第 ${num} 章仍未纳入本章合同处理。`,
          suggestion: '建议在本章合同引入推进/兑现，或在「台账大纲」将其顺延/标记延期。',
        });
      } else if (thread.payoffDue > num && thread.payoffDue - num <= 2 && !addressedInContract) {
        issues.push({
          id: `foreshadow-approaching-${thread.id}`,
          dimension: 'foreshadowing',
          severity: 'warning',
          source: 'deterministic',
          message: `伏笔 ${thread.id} 临近兑现期（约定第 ${thread.payoffDue} 章）。`,
        });
      }

      if (num - thread.planted >= 30) {
        issues.push({
          id: `foreshadow-stale30-${thread.id}`,
          dimension: 'foreshadowing',
          severity: 'blocking',
          source: 'deterministic',
          message: `伏笔 ${thread.id} 自第 ${thread.planted} 章埋下已悬空 >= 30 章，必须在本章兑现处理或在台账中顺延/延期（deferred）。`,
        });
      }
    }
  }

  // 6. 终局收敛审计（手册 §六.3）：仅 main 章、targetChapters 非空时检查。
  if (isMainChapter && targetChapters != null) {
    const tol = effectiveTolerance(targetChapters, book.outline.compass.tolerance);
    // (a) 非 paid/archived 伏笔的 payoffDue 超出完结窗口 → 阻断。
    for (const thread of book.state.foreshadowing) {
      if (thread.status === 'paid' || thread.status === 'archived') continue;
      if (thread.payoffDue > targetChapters + tol) {
        issues.push({
          id: `foreshadow-payoff-beyond-end-${thread.id}`,
          dimension: 'foreshadowing',
          severity: 'blocking',
          source: 'deterministic',
          message: `伏笔 ${thread.id}（${thread.thread}）约定第 ${thread.payoffDue} 章兑现，已超出全书完结窗口（目标 ${targetChapters} 章 ±${tol}，最晚第 ${targetChapters + tol} 章），请在台账中压缩兑现期、并线或归档。`,
        });
      }
    }
    // (b) 本章新埋伏笔 payoffDue > T-5 → 警告（仅 T>=20；以台账 planted 章为准）。
    if (targetChapters >= 20) {
      for (const thread of book.state.foreshadowing) {
        if (
          thread.planted === num &&
          (thread.status === 'open' || thread.status === 'progressing') &&
          thread.payoffDue > targetChapters - 5
        ) {
          issues.push({
            id: `foreshadow-late-plant-${thread.id}`,
            dimension: 'foreshadowing',
            severity: 'warning',
            source: 'deterministic',
            message: `本章新埋伏笔 ${thread.id} 约定第 ${thread.payoffDue} 章兑现，晚于建议的最晚新埋线（第 ${targetChapters - 5} 章），临近完结还在开长线新坑，建议提前兑现或改短线。`,
          });
        }
      }
    }
    // (c) 距终点 <= 阈值时仍有未结主线/卷级伏笔 → 警告（永不阻断）。
    const nearThreshold = nearEndWarningThreshold(
      targetChapters,
      book.outline.compass.targetWords
    );
    if (targetChapters - num <= nearThreshold) {
      const unclosed = book.state.foreshadowing.filter(
        (f) =>
          (f.status === 'open' || f.status === 'progressing') &&
          (f.scope ?? 'series') !== 'episode'
      );
      if (unclosed.length > 0) {
        issues.push({
          id: 'foreshadow-unclosed-near-end',
          dimension: 'foreshadowing',
          severity: 'warning',
          source: 'deterministic',
          message: `距目标完结（第 ${targetChapters} 章）仅剩 ${targetChapters - num} 章，仍有 ${unclosed.length} 条未结主线/卷级伏笔（${unclosed
            .slice(0, 5)
            .map((f) => f.id)
            .join('、')}${unclosed.length > 5 ? '…' : ''}），建议收拢、并线或归档，勿留到终章。`,
        });
      }
    }
  }

  // 5. 跨章重复：本章正文不得大段复述前后章（防“重写前章”与“抢写后章”）。
  //    比最近两章 + 后一章（重生成中间章节时，后章已写定，新章抢写后章内容同样是脱节）；
  //    ≥ 15% 长句逐字重复即阻断，8%–15% 只警告（可能只是一段较长的前情回调）。
  const compareChapters = book.chapters
    .filter(
      (c) => (c.chapter < num && c.chapter >= num - 2) || c.chapter === num + 1
    )
    .sort((a, b) => a.chapter - b.chapter);
  for (const other of compareChapters) {
    const { ratio, sample } = repeatedSentenceRatio(prose, other.prose);
    const isNext = other.chapter > num;
    if (ratio >= 0.15) {
      issues.push({
        id: `canon-repeat-prev-${num}`,
        dimension: 'canon',
        severity: 'blocking',
        source: 'deterministic',
        message: isNext
          ? `第 ${num} 章与后一章第 ${other.chapter} 章内容大量重复（约 ${Math.round(ratio * 100)}% 的长句逐字出现在后章），新写的本章抢写了后章已经写定的内容，请重新生成本章，不要提交。`
          : `第 ${num} 章与第 ${other.chapter} 章内容大量重复（约 ${Math.round(ratio * 100)}% 的长句逐字出现在前章），疑似重写前章而非续写新剧情，请重新生成本章，不要提交。`,
        citation: sample ? `重复句示例：${sample}` : undefined,
      });
      break;
    }
    if (ratio >= 0.08) {
      issues.push({
        id: `canon-repeat-prev-${num}`,
        dimension: 'canon',
        severity: 'warning',
        source: 'deterministic',
        message: isNext
          ? `第 ${num} 章与后一章第 ${other.chapter} 章有部分句子重复（约 ${Math.round(ratio * 100)}%），请检查是否抢写了后章内容。`
          : `第 ${num} 章与第 ${other.chapter} 章有部分句子重复（约 ${Math.round(ratio * 100)}%），请检查是否在复述前章内容。`,
        citation: sample ? `重复句示例：${sample}` : undefined,
      });
      break;
    }
  }

  const blockingCount = issues.filter((i) => i.severity === 'blocking').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;

  return {
    chapter: num,
    passed: blockingCount === 0,
    blockingCount,
    warningCount,
    proseSize,
    sizeUnit: langSpec.unit,
    issues,
    checkedAt: new Date().toISOString(),
  };
}
