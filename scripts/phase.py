#!/usr/bin/env python3
"""终局规划共享阶段函数（手册 v1.1 §三、§四）—— src/shared/phase.ts 的逐行移植。

全端同源：TS 前端/后端、本脚本、MCP 镜像必须用同一套算法。关键点：
1. 禁止裸 round()：JS Math.round(12.5) === 13，Python round(12.5) === 12，
   一律用 round_half_up = floor(x + 0.5)。
2. 阶段按“本卷内章序”算：local = current_chapter - volume_start_chapter + 1。
   v1 固定 volume_start_chapter = 1；v2 多卷后传各卷起始章。
3. T 为空（老书）时返回 None，调用方静默退化回旧版逻辑。

参数顺序注意（2026-11-16 实修）：get_phase_info(current_chapter,
volume_start_chapter=1, volume_target_chapters=None, custom_tolerance=None)。
第 2 参是卷起始章，绝不是目标章数——曾有调用把 T 传进第 2 参，
结果 local 被算成 1、T 被当成容差，Gate 3 入口与连写收官停机全部静默失效。
"""

import math

PHASE_LABEL_ZH = {
    "setup": "开篇立局期",
    "middle": "中盘博弈期",
    "convergence": "收敛并轨期",
    "finale": "终局收官窗口",
}


def round_half_up(x):
    return math.floor(x + 0.5)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def default_tolerance(target_chapters):
    """默认容差：T >= 50 为 10；T < 50 为 max(1, round_half_up(0.1 * T))。"""
    if target_chapters is None or target_chapters < 1:
        return None
    t = target_chapters
    return 10 if t >= 50 else max(1, round_half_up(0.1 * t))


def effective_tolerance(target_chapters, custom_tolerance=None):
    """有效容差（防止自定义过大 tolerance 造成区间倒挂）。
    T <= 3：max(0, custom ?? default)；T >= 4：clamp(custom ?? default, 0, max(1, T - 4))。
    """
    t = target_chapters
    default = default_tolerance(t) or 0
    c = custom_tolerance if custom_tolerance is not None else default
    if t <= 3:
        return max(0, c)
    return clamp(c, 0, max(1, t - 4))


def big_cadence_for(target_chapters):
    """大高潮节奏 bigCadence。
    T 为空（老书退化）：10；T < 30：None（跳过）；T >= 30：clamp(round_half_up(0.1 * T), 5, 20)。
    """
    if target_chapters is None:
        return 10
    t = target_chapters
    if t < 30:
        return None
    return clamp(round_half_up(0.1 * t), 5, 20)


def _phase_line_for(phase, progress_pct, remaining_to_win_end, beyond_by):
    pct = round_half_up(progress_pct * 100)
    if phase == "setup":
        return f"[当前阶段：开篇立局期（约 {pct}%）— 立住主角困境与核心悬念，严禁提前泄底结局]"
    if phase == "middle":
        return f"[当前阶段：中盘博弈期（约 {pct}%）— 围绕当前矛盾升级冲突并兑现阶段小高潮]"
    if phase == "convergence":
        return f"[当前阶段：收敛并轨期（约 {pct}%）— 停止新开无关副本与新常驻角色，收拢现有线索]"
    if beyond_by > 0:
        return f"[当前阶段：终局收官窗口（已超出预定收官窗口 {beyond_by} 章）— 聚焦终局决战与核心伏笔最终兑现]"
    return f"[当前阶段：终局收官窗口（倒计时剩余 {remaining_to_win_end} 章）— 聚焦终局决战与核心伏笔最终兑现]"


def _phase_must_not_for(phase, target_chapters):
    if phase == "setup":
        return "本章处于开篇立局期：集中立住主角困境与核心悬念，严禁提前泄底结局。"
    if phase == "middle":
        if target_chapters >= 20:
            return f"本章处于中盘博弈期：新埋伏笔的 payoffDue 不得晚于第 {target_chapters - 5} 章。"
        return "本章处于中盘博弈期：围绕当前矛盾升级冲突并兑现阶段小高潮。"
    if phase == "convergence":
        return "本章处于收敛并轨期：禁止新开无关副本与新常驻角色；优先收拢既有矛盾与未结伏笔。"
    return "本章处于终局收官窗口：严禁再新增长期未解伏笔；hook 须推向总决战或最终揭晓。"


def get_phase_info(current_chapter, volume_start_chapter=1,
                   volume_target_chapters=None, custom_tolerance=None):
    """返回阶段信息 dict；T 为空时返回 None（老书退化）。"""
    t = volume_target_chapters
    if t is None or t < 1:
        return None
    local = max(1, current_chapter - volume_start_chapter + 1)
    tol = effective_tolerance(t, custom_tolerance)
    win_end = t + tol
    big_cadence = big_cadence_for(t)
    progress_pct = local / t
    beyond_by = max(0, local - win_end)
    remaining_to_win_end = win_end - local

    if t <= 3:
        # 极短篇离散查表。
        if t == 1:
            l1, l2, win_start = 0, 0, 1
            phase = "finale"
        elif t == 2:
            l1, l2, win_start = 1, 2, 2
            phase = "setup" if local <= 1 else "finale"
        else:
            l1, l2, win_start = 1, 2, 3
            phase = "setup" if local <= 1 else ("convergence" if local == 2 else "finale")
    elif t < 40:
        # 短中篇分支（4 <= T < 40）。
        win_start = t if t < 10 else t - tol
        l1 = clamp(round_half_up(0.25 * t), 1, max(1, win_start - 2))
        l2 = clamp(round_half_up(0.75 * t), l1 + 1, max(l1 + 1, win_start - 1))
        if local <= l1:
            phase = "setup"
        elif local < l2:
            phase = "middle"
        elif local < win_start:
            phase = "convergence"
        else:
            phase = "finale"
    else:
        # 标准长篇分支（T >= 40）。
        win_start = t - tol
        l1 = clamp(round_half_up(0.25 * t), 10, 30)
        raw_l2 = max(t - 40, min(round_half_up(0.7 * t), t - 25))
        l2 = clamp(raw_l2, l1 + 1, win_start - 1)
        if local <= l1:
            phase = "setup"
        elif local < l2:
            phase = "middle"
        elif local < win_start:
            phase = "convergence"
        else:
            phase = "finale"

    # 超出收官窗口：阶段保持终局收官窗口（+K 章），永不锁死。
    if local > win_end:
        phase = "finale"

    return {
        "phase": phase,
        "phase_label_zh": PHASE_LABEL_ZH[phase],
        "local_chapter": local,
        "target_chapters": t,
        "tolerance": tol,
        "win_start": win_start,
        "win_end": win_end,
        "l1": l1,
        "l2": l2,
        "progress_pct": progress_pct,
        "remaining_to_win_end": remaining_to_win_end,
        "beyond_by": beyond_by,
        "big_cadence": big_cadence,
        "is_short_branch": t < 40,
        "phase_line": _phase_line_for(phase, progress_pct, remaining_to_win_end, beyond_by),
        "phase_must_not": _phase_must_not_for(phase, t),
    }


def is_short_mode(target_chapters=None, target_words=None):
    """短篇完整模式：启用 targetWords，或 T < 40。"""
    return target_words is not None or (target_chapters is not None and target_chapters < 40)


def is_short_word_mode(target_chapters=None, target_words=None):
    """短篇字数下限模式（手册 §六.2）：targetWords 启用且 T <= 20（T 为空也算短）。"""
    return target_words is not None and (target_chapters is None or target_chapters <= 20)


def near_end_warning_threshold(target_chapters=None, target_words=None):
    """距终点预警阈值：长篇 15 章；短篇 max(2, round_half_up(0.2T))。"""
    if target_chapters is None:
        return 15
    if is_short_mode(target_chapters, target_words):
        return max(2, round_half_up(0.2 * target_chapters))
    return 15
