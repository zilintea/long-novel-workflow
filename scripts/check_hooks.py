#!/usr/bin/env python3
"""Check hook + desire payoff per chapter (BLOCKING audit, v2.1.0).
Stdlib only. Usage: python3 scripts/check_hooks.py <book_dir>

Blocking checks (exit 1 on any failure):
  - every chapter contract has a non-empty `hook` (>=10 characters) and a
    `desire` from the 8 core desires (or `auto` with warning), plus a non-empty
    `desire_payoff` (what the chapter actually delivers for that desire)
  - every chapter has a non-empty `transition` (how it hands off to the next)
  - payoff cadence (dynamic bigCadence, manual §六.1; old books without a
    target fall back to the legacy %10): a main chapter whose number is a
    multiple of the big cadence must declare payoff_size big (or `auto`);
    every-3-chapters small payoff is required only for draft chapters
    (no big_cadence_snapshot yet) and is relaxed when T < 10 or short mode.
    Epilogue/extra chapters (`chapter_kind`) skip cadence entirely.
  - the chapter's last paragraph must not be empty (a chapter ends on its hook,
    not on a dangling setup line)
Warnings: hook shorter than 20 characters (weak hook), or unresolved `auto`.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from phase import big_cadence_for  # noqa: E402

DESIRES = {
    "curiosity",
    "identification-upgrade",
    "revenge-compensation",
    "being-loved",
    "escape-comfort",
    "survival-breakout",
    "power-scheme",
    "bond-resonance",
}
DESIRE_ZH = {
    "好奇",
    "代入升级",
    "复仇补偿",
    "被爱拉扯",
    "逃逸安慰",
    "求生破局",
    "博弈掌权",
    "羁绊共鸣",
}


def chapter_fields(text):
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    fields, prose = {}, text
    if m:
        prose = m.group(2)
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                fields[k.strip()] = v.strip()
    return fields, prose


def parse_compass(book):
    """Read Target chapters / Tolerance / Target words from outline/overview.md.
    Missing keys -> None (old book, legacy fallback)."""
    text = ""
    path = os.path.join(book, "outline", "overview.md")
    if os.path.exists(path):
        text = open(path, encoding="utf-8").read()
    def _int(key):
        m = re.search(rf"^- {key}:\s*(\d+)\s*$", text, re.M)
        return int(m.group(1)) if m else None
    return {
        "target_chapters": _int("Target chapters"),
        "tolerance": _int("Tolerance"),
        "target_words": _int("Target words"),
    }


def check_book(book):
    failures, warnings = [], []
    ch_dir = os.path.join(book, "chapters")
    if not os.path.isdir(ch_dir):
        return ["missing chapters/ directory"], []
    files = sorted(f for f in os.listdir(ch_dir) if re.match(r"^\d{3}\.md$", f))
    if not files:
        return ["no chapters/NNN.md files found"], []
    compass = parse_compass(book)
    target = compass["target_chapters"]
    cadence = big_cadence_for(target)
    # %3 强兑现只对草稿章、且 T < 10 或短篇模式（targetWords 启用）时放宽（手册 §六.1，与审计引擎一致）。
    relax_3 = (target is not None and target < 10) or compass["target_words"] is not None
    for fname in files:
        num = int(fname[:3])
        text = open(os.path.join(ch_dir, fname), encoding="utf-8").read()
        fields, prose = chapter_fields(text)
        label = fname
        desire = fields.get("desire", "")
        if desire == "auto":
            warnings.append(f"{label}: desire is `auto` (recommend resolving to concrete desire)")
        elif desire not in DESIRES and desire not in DESIRE_ZH:
            failures.append(f"{label}: unknown desire `{desire}`")
        if len(fields.get("hook", "")) < 10:
            failures.append(f"{label}: missing or too-short `hook` (need >=10 chars) — "
                            f"hook is a blocking audit")
        elif len(fields.get("hook", "")) < 20:
            warnings.append(f"{label}: hook is short (<20 chars) — weak hook")
        if not fields.get("desire_payoff"):
            failures.append(f"{label}: missing `desire_payoff` — say what this chapter "
                            f"actually delivers for its desire")
        if not fields.get("transition"):
            failures.append(f"{label}: missing `transition` — how does this chapter hand off "
                            f"to the next?")
        size = fields.get("payoff_size", "")
        kind = fields.get("chapter_kind", "main")
        if size == "auto":
            warnings.append(f"{label}: payoff_size is `auto` (AI-managed execution)")
        elif kind == "main":
            # 已提交章按提交时快照核对；草稿章（无快照）按当前动态 cadence 核对；
            # T < 30 时 cadence 为 None，跳过。
            snapshot = fields.get("big_cadence_snapshot", "")
            effective_cadence = int(snapshot) if snapshot.isdigit() else cadence
            if effective_cadence is not None and num % effective_cadence == 0 and size != "big":
                failures.append(
                    f"{label}: chapter {num} is a big-payoff chapter "
                    f"(multiple of {effective_cadence}) — payoff_size must be big"
                )
            if not snapshot and not relax_3 and num % 3 == 0 and size not in ("small", "big"):
                failures.append(f"{label}: chapter {num} is a payoff chapter (multiple of 3) — "
                                f"declare payoff_size small|big")
        paras = [p.strip() for p in prose.strip().split("\n\n") if p.strip()]
        if not paras:
            failures.append(f"{label}: no prose paragraphs found")
    return failures, warnings


def main():
    if len(sys.argv) != 2:
        print("usage: check_hooks.py <book_dir>", file=sys.stderr)
        sys.exit(2)
    failures, warnings = check_book(sys.argv[1])
    for w in warnings:
        print(f"WARN: {w}")
    for f in failures:
        print(f"FAIL: {f}")
    if failures:
        print(f"check_hooks: FAIL ({len(failures)} blocking, {len(warnings)} warnings)")
        sys.exit(1)
    print(f"check_hooks: PASS ({len(warnings)} warnings)")
    sys.exit(0)


if __name__ == "__main__":
    main()
