import type { AuditIssue, AuditReport, BookProject, ChapterItem } from './types.ts';
import { DEFAULT_SLOP_LIST, DESIRE_SPECS, LANGUAGE_SPECS } from './skillSpecs.ts';

export function countProseSize(prose: string, language: 'zh' | 'en'): number {
  const trimmed = prose.trim();
  if (!trimmed) return 0;
  if (language === 'zh') {
    return trimmed.replace(/\s+/g, '').length;
  }
  return trimmed.split(/\s+/).filter(Boolean).length;
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
  } else {
    if (num % 3 === 0 && contract.payoffSize !== 'small' && contract.payoffSize !== 'big') {
      issues.push({
        id: `cadence-3-${num}`,
        dimension: 'hook_desire',
        severity: 'blocking',
        source: 'deterministic',
        message: `第 ${num} 章为 3 的倍数节点章，必须声明 payoff_size 为 small 或 big。`,
      });
    }

    if (num % 10 === 0 && contract.payoffSize !== 'big') {
      issues.push({
        id: `cadence-10-${num}`,
        dimension: 'hook_desire',
        severity: 'blocking',
        source: 'deterministic',
        message: `第 ${num} 章为 10 的倍数大节点章，payoff_size 必须为 big。`,
      });
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
  } else {
    const minLimit = contract.isProbe ? langSpec.probeMinSize : langSpec.minSize;
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
  for (const thread of book.state.foreshadowing) {
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
