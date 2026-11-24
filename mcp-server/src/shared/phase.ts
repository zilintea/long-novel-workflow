// 终局规划共享阶段函数（手册 v1.1 §三、§四）。
//
// 全端同源：TS 前端/后端、Python 脚本（check_hooks.py / check_continuity.py）、
// MCP 镜像必须用同一套算法。关键点：
// 1. 禁止裸 round()：JS Math.round(12.5) === 13，Python round(12.5) === 12，
//    一律用 roundHalfUp = floor(x + 0.5)。
// 2. 阶段按“本卷内章序”算：local = currentChapter - volumeStartChapter + 1。
//    v1 固定 volumeStartChapter = 1；v2 多卷后传各卷起始章。
// 3. T 为空（老书）时返回 null，调用方静默退化回旧版逻辑。

export type PhaseId = 'setup' | 'middle' | 'convergence' | 'finale';

export const PHASE_LABEL_ZH: Record<PhaseId, string> = {
  setup: '开篇立局期',
  middle: '中盘博弈期',
  convergence: '收敛并轨期',
  finale: '终局收官窗口',
};

export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 默认容差：T >= 50 为 10；T < 50 为 max(1, roundHalfUp(0.1 * T))。 */
export function defaultTolerance(targetChapters: number | undefined): number | undefined {
  if (targetChapters == null || targetChapters < 1) return undefined;
  const T = targetChapters;
  return T >= 50 ? 10 : Math.max(1, roundHalfUp(0.1 * T));
}

/**
 * 有效容差（防止自定义过大 tolerance 造成区间倒挂）。
 * T <= 3：max(0, custom ?? default)；T >= 4：clamp(custom ?? default, 0, max(1, T - 4))。
 */
export function effectiveTolerance(
  targetChapters: number,
  customTolerance?: number
): number {
  const T = targetChapters;
  const def = defaultTolerance(T) ?? 0;
  const c = customTolerance ?? def;
  if (T <= 3) return Math.max(0, c);
  return clamp(c, 0, Math.max(1, T - 4));
}

/**
 * 大高潮节奏 bigCadence。
 * T 为空（老书退化）：10；T < 30：null（跳过）；T >= 30：clamp(roundHalfUp(0.1 * T), 5, 20)。
 */
export function bigCadenceFor(targetChapters: number | undefined): number | null {
  if (targetChapters == null) return 10;
  const T = targetChapters;
  if (T < 30) return null;
  return clamp(roundHalfUp(0.1 * T), 5, 20);
}

export interface PhaseInfo {
  phase: PhaseId;
  phaseLabelZh: string;
  /** 本卷内章序（最小为 1）。 */
  localChapter: number;
  targetChapters: number;
  tolerance: number;
  /** 收官窗口起点。 */
  winStart: number;
  /** 收官窗口终点 = T + tol。 */
  winEnd: number;
  /** 立局终点 L1（开篇立局期为 1..L1）。 */
  L1: number;
  /** 收敛起点 L2（收敛并轨期为 L2..winStart-1）。 */
  L2: number;
  /** 当前进度百分比（local / T）。 */
  progressPct: number;
  /** 距收官窗口终点剩余章数（超出时为负，绝对值即超出章数）。 */
  remainingToWinEnd: number;
  /** 超出预定收官窗口的章数（窗口内为 0）。 */
  beyondBy: number;
  bigCadence: number | null;
  /** T < 40 为短中篇分支。 */
  isShortBranch: boolean;
  /** 喂给正文写手的单行阶段指令（不含任何结局内容）。 */
  phaseLine: string;
  /** 起草合同时须并入 mustNot 的阶段约束。 */
  phaseMustNot: string;
}

function phaseLineFor(
  phase: PhaseId,
  progressPct: number,
  remainingToWinEnd: number,
  beyondBy: number
): string {
  const pct = roundHalfUp(progressPct * 100);
  switch (phase) {
    case 'setup':
      return `[当前阶段：开篇立局期（约 ${pct}%）— 立住主角困境与核心悬念，严禁提前泄底结局]`;
    case 'middle':
      return `[当前阶段：中盘博弈期（约 ${pct}%）— 围绕当前矛盾升级冲突并兑现阶段小高潮]`;
    case 'convergence':
      return `[当前阶段：收敛并轨期（约 ${pct}%）— 停止新开无关副本与新常驻角色，收拢现有线索]`;
    case 'finale':
      if (beyondBy > 0) {
        return `[当前阶段：终局收官窗口（已超出预定收官窗口 ${beyondBy} 章）— 聚焦终局决战与核心伏笔最终兑现]`;
      }
      return `[当前阶段：终局收官窗口（倒计时剩余 ${remainingToWinEnd} 章）— 聚焦终局决战与核心伏笔最终兑现]`;
  }
}

function phaseMustNotFor(phase: PhaseId, targetChapters: number): string {
  switch (phase) {
    case 'setup':
      return '本章处于开篇立局期：集中立住主角困境与核心悬念，严禁提前泄底结局。';
    case 'middle':
      return targetChapters >= 20
        ? `本章处于中盘博弈期：新埋伏笔的 payoffDue 不得晚于第 ${targetChapters - 5} 章。`
        : '本章处于中盘博弈期：围绕当前矛盾升级冲突并兑现阶段小高潮。';
    case 'convergence':
      return '本章处于收敛并轨期：禁止新开无关副本与新常驻角色；优先收拢既有矛盾与未结伏笔。';
    case 'finale':
      return '本章处于终局收官窗口：严禁再新增长期未解伏笔；hook 须推向总决战或最终揭晓。';
  }
}

export function getPhaseInfo(
  currentChapter: number,
  volumeStartChapter = 1,
  volumeTargetChapters?: number,
  customTolerance?: number
): PhaseInfo | null {
  const T = volumeTargetChapters;
  if (T == null || T < 1) return null;
  const local = Math.max(1, currentChapter - volumeStartChapter + 1);
  const tol = effectiveTolerance(T, customTolerance);
  const winEnd = T + tol;
  const bigCadence = bigCadenceFor(T);
  const progressPct = local / T;
  const beyondBy = Math.max(0, local - winEnd);
  const remainingToWinEnd = winEnd - local;

  let phase: PhaseId;
  let L1: number;
  let L2: number;
  let winStart: number;

  if (T <= 3) {
    // 极短篇离散查表。
    if (T === 1) {
      L1 = 0;
      L2 = 0;
      winStart = 1;
      phase = 'finale';
    } else if (T === 2) {
      L1 = 1;
      L2 = 2;
      winStart = 2;
      phase = local <= 1 ? 'setup' : 'finale';
    } else {
      L1 = 1;
      L2 = 2;
      winStart = 3;
      phase = local <= 1 ? 'setup' : local === 2 ? 'convergence' : 'finale';
    }
  } else if (T < 40) {
    // 短中篇分支（4 <= T < 40）。
    winStart = T < 10 ? T : T - tol;
    L1 = clamp(roundHalfUp(0.25 * T), 1, Math.max(1, winStart - 2));
    L2 = clamp(roundHalfUp(0.75 * T), L1 + 1, Math.max(L1 + 1, winStart - 1));
    phase =
      local <= L1
        ? 'setup'
        : local < L2
          ? 'middle'
          : local < winStart
            ? 'convergence'
            : 'finale';
  } else {
    // 标准长篇分支（T >= 40）。
    winStart = T - tol;
    L1 = clamp(roundHalfUp(0.25 * T), 10, 30);
    const rawL2 = Math.max(T - 40, Math.min(roundHalfUp(0.7 * T), T - 25));
    L2 = clamp(rawL2, L1 + 1, winStart - 1);
    phase =
      local <= L1
        ? 'setup'
        : local < L2
          ? 'middle'
          : local < winStart
            ? 'convergence'
            : 'finale';
  }

  // 超出收官窗口：阶段保持终局收官窗口（+K 章），永不锁死。
  if (local > winEnd) phase = 'finale';

  return {
    phase,
    phaseLabelZh: PHASE_LABEL_ZH[phase],
    localChapter: local,
    targetChapters: T,
    tolerance: tol,
    winStart,
    winEnd,
    L1,
    L2,
    progressPct,
    remainingToWinEnd,
    beyondBy,
    bigCadence,
    isShortBranch: T < 40,
    phaseLine: phaseLineFor(phase, progressPct, remainingToWinEnd, beyondBy),
    phaseMustNot: phaseMustNotFor(phase, T),
  };
}

/** 短篇完整模式：启用 targetWords，或 T < 40。 */
export function isShortMode(targetChapters?: number, targetWords?: number): boolean {
  return targetWords != null || (targetChapters != null && targetChapters < 40);
}

/**
 * 短篇字数下限模式（手册 §六.2）：targetWords 启用且 T <= 20（T 为空也算短）。
 * 仅中文生效（英文 minSize 本来就是 1500）。
 */
export function isShortWordMode(targetChapters?: number, targetWords?: number): boolean {
  return targetWords != null && (targetChapters == null || targetChapters <= 20);
}

/** 距终点预警阈值：长篇 15 章；短篇 max(2, roundHalfUp(0.2T))。 */
export function nearEndWarningThreshold(
  targetChapters: number | undefined,
  targetWords?: number
): number {
  if (targetChapters == null) return 15;
  if (isShortMode(targetChapters, targetWords)) {
    return Math.max(2, roundHalfUp(0.2 * targetChapters));
  }
  return 15;
}
