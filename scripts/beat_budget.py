#!/usr/bin/env python3
"""Per-beat word budgets for a chapter (v2.4.0, P2).
Stdlib only. A beat budget answers, before any prose is written, whether a
chapter has enough story to fill its length: each must_happen beat gets a
target length, the budgets sum to the chapter target, and a beat below the
minimum cannot carry a scene.

Defaults follow the chapter-length rule (SKILL.md Parameters): zh chapters
are 2100-4000 characters (target 3000), en chapters 1500-2500 words
(target 2000). A beat may carry an explicit `budget:` in user_outline.yaml;
beats without one split the remainder evenly (round_half_up, remainder to
the earliest beats). The chapter target may be overridden per book with
`book.chapter_target_chars` (zh) / `book.chapter_target_words` (en).
"""
import math

ZH = {"target": 3000, "floor": 2100, "max": 4000, "beat_min": 200}
EN = {"target": 2000, "floor": 1500, "max": 2500, "beat_min": 100}


def round_half_up(x):
    return math.floor(x + 0.5)


def limits(language):
    return EN if language == "en" else ZH


def chapter_target(book, language):
    lim = limits(language)
    key = "chapter_target_words" if language == "en" else "chapter_target_chars"
    target = (book or {}).get(key)
    if isinstance(target, int) and not isinstance(target, bool) and target > 0:
        return target
    return lim["target"]


def compute_budgets(chapter, language="zh", target=None):
    """Return a list of per-beat budgets aligned with chapter.must_happen."""
    beats = chapter.get("must_happen") or []
    if target is None:
        target = limits(language)["target"]
    explicit = [b.get("budget") if isinstance(b, dict) else None for b in beats]
    auto_idx = [i for i, b in enumerate(explicit) if b is None]
    used = sum(b for b in explicit if isinstance(b, int))
    budgets = [0] * len(beats)
    for i, b in enumerate(explicit):
        if isinstance(b, int):
            budgets[i] = b
    if auto_idx:
        remaining = target - used
        share = remaining // len(auto_idx)
        extra = remaining - share * len(auto_idx)
        for j, i in enumerate(auto_idx):
            budgets[i] = share + (1 if j < extra else 0)
    return budgets


def check_budgets(chapter, language="zh", target=None):
    """Return (failures, warnings) for one chapter's beat budgets."""
    lim = limits(language)
    if target is None:
        target = lim["target"]
    failures, warnings = [], []
    beats = chapter.get("must_happen") or []
    label = f"chapter {chapter.get('chapter')}"
    for beat in beats:
        if not isinstance(beat, dict):
            continue
        b = beat.get("budget")
        if b is not None and (not isinstance(b, int) or isinstance(b, bool) or b <= 0):
            failures.append(f"{label}: beat {str(beat.get('beat'))[:20]!r} has "
                            f"a non-positive budget {b!r} (want a positive int)")
    budgets = compute_budgets(chapter, language, target)
    for beat, budget in zip(beats, budgets):
        if budget < lim["beat_min"]:
            failures.append(f"{label}: beat {str(beat.get('beat'))[:20]!r} "
                            f"budget is {budget} — below the {lim['beat_min']} "
                            f"minimum for one scene (write a fuller beat, or "
                            "merge it into another)")
    total = sum(budgets)
    if total < lim["floor"]:
        warnings.append(f"{label}: beat budgets sum to {total}, below the "
                        f"chapter floor {lim['floor']} — the chapter will "
                        "come out short unless beats are expanded")
    if total > lim["max"]:
        warnings.append(f"{label}: beat budgets sum to {total}, above the "
                        f"chapter max {lim['max']} — over-max prose is a "
                        "warning, never blocking, but check the beats are "
                        "not over-planned")
    return failures, warnings
