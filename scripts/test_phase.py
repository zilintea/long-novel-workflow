#!/usr/bin/env python3
"""phase.py 的表驱动单测（手册 §十二.1 交叉验证的 Python 一半）。

与 TS 端 tools/test-phase.ts 同源：手册校验表逐字一致 + T=1..300 连续性扫描
（零空档/零重叠/零倒序）+ 自定义 tol 极端值 + round_half_up 用例。
用法：python3 scripts/test_phase.py
JS/Python 交叉一致性另见 tools/test-phase.ts（同一组 T 值逐项比对）。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from phase import (  # noqa: E402
    big_cadence_for,
    default_tolerance,
    effective_tolerance,
    get_phase_info,
    round_half_up,
)

failures = 0


def check(name, cond, detail=""):
    global failures
    if cond:
        print(f"PASS  {name}")
    else:
        failures += 1
        print(f"FAIL  {name}{(' — ' + detail) if detail else ''}")


# 手册校验表（T, tol, cadence, 立局/中盘/收敛/收官区间）——与 TS 端 tools/test-phase.ts
# 的 15 行表逐字一致（区间含端点）。
TABLE = [
    (1, 1, None, None, None, None, (1, 2)),
    (3, 1, None, (1, 1), None, (2, 2), (3, 4)),
    (5, 1, None, (1, 1), (2, 3), (4, 4), (5, 6)),
    (10, 1, None, (1, 3), (4, 7), (8, 8), (9, 11)),
    (20, 2, None, (1, 5), (6, 14), (15, 17), (18, 22)),
    (30, 3, 5, (1, 8), (9, 22), (23, 26), (27, 33)),
    (40, 4, 5, (1, 10), (11, 14), (15, 35), (36, 44)),
    (45, 5, 5, (1, 11), (12, 19), (20, 39), (40, 50)),
    (49, 5, 5, (1, 12), (13, 23), (24, 43), (44, 54)),
    (50, 10, 5, (1, 13), (14, 24), (25, 39), (40, 60)),
    (80, 10, 8, (1, 20), (21, 54), (55, 69), (70, 90)),
    (100, 10, 10, (1, 25), (26, 69), (70, 89), (90, 110)),
    (150, 10, 15, (1, 30), (31, 109), (110, 139), (140, 160)),
    (200, 10, 20, (1, 30), (31, 159), (160, 189), (190, 210)),
    (300, 10, 20, (1, 30), (31, 259), (260, 289), (290, 310)),
]
PHASE_OF = {"setup": 0, "middle": 1, "convergence": 2, "finale": 3}

for t, tol, cad, r_setup, r_mid, r_conv, r_fin in TABLE:
    check(f"T={t} tol", default_tolerance(t) == tol, f"got {default_tolerance(t)}")
    check(f"T={t} cadence", big_cadence_for(t) == cad, f"got {big_cadence_for(t)}")
    first = get_phase_info(1, 1, t)
    if r_setup is not None:
        check(f"T={t} L1", first["l1"] == r_setup[1], f"got {first['l1']}")
    if r_conv is not None:
        check(f"T={t} L2", first["l2"] == r_conv[0], f"got {first['l2']}")
    check(f"T={t} winStart", first["win_start"] == r_fin[0], f"got {first['win_start']}")
    check(f"T={t} winEnd", first["win_end"] == r_fin[1], f"got {first['win_end']}")
    for rng, want in [
        (r_setup, "setup"), (r_mid, "middle"), (r_conv, "convergence"), (r_fin, "finale"),
    ]:
        if rng is None:
            continue
        for ch in (rng[0], rng[1]):
            got = get_phase_info(ch, 1, t)["phase"]
            check(f"T={t} ch{ch} -> {want}", got == want, f"got {got}")

# T=1..300 连续性扫描：每章恰好属于一个阶段，相邻章不倒序，区间无空档。
bad = 0
for t in range(1, 301):
    prev_rank = -1
    for ch in range(1, t + effective_tolerance(t) + 2):
        rank = PHASE_OF[get_phase_info(ch, 1, t)["phase"]]
        if rank < prev_rank:
            bad += 1
            print(f" 倒序：T={t} ch={ch}")
            break
        prev_rank = rank
check("T=1..300 连续性（零倒序）", bad == 0, f"{bad} 处倒序")

# 自定义 tol 极端值。
check("tol clamp: T=100 custom 200 -> 96", effective_tolerance(100, 200) == 96)
check("tol clamp: T=100 custom 0 -> 0", effective_tolerance(100, 0) == 0)
check("tol T=3 custom 5 -> 5", effective_tolerance(3, 5) == 5)
check("tol T=4 custom 99 -> 1", effective_tolerance(4, 99) == 1)

# round_half_up：Python 裸 round(12.5)==12 是错的，必须是 13。
check("round_half_up 12.5", round_half_up(12.5) == 13)
check("round_half_up 2.5", round_half_up(2.5) == 3)
check("round_half_up 0.5", round_half_up(0.5) == 1)

# 参数顺序防呆（与 TS 端同名用例）：第 2 参是卷起始章，不是目标章数。
gate3 = get_phase_info(95, 1, 100, 10)
check(
    "arg order: ch95 T=100 -> finale, win 90-110",
    gate3["phase"] == "finale" and gate3["win_start"] == 90 and gate3["win_end"] == 110,
)
early = get_phase_info(6, 1, 100, 10)
check("arg order: ch6 T=100 -> setup, L1=25", early["phase"] == "setup" and early["l1"] == 25)

# T 为空退化。
check("no target -> None", get_phase_info(5, 1, None) is None)
check("bigCadence empty -> 10", big_cadence_for(None) == 10)
check("bigCadence T=29 -> None", big_cadence_for(29) is None)
check("bigCadence T=30 -> 5", big_cadence_for(30) == 5)

if failures > 0:
    print(f"\n{failures} FAILURES")
    sys.exit(1)
print("\nAll phase tests passed.")
