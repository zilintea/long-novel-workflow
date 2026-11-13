#!/usr/bin/env python3
"""Check hook + desire payoff per chapter (BLOCKING audit).
Stdlib only. Usage: python3 scripts/check_hooks.py <book_dir>

Blocking checks (exit 1 on any failure):
  - every chapter contract has a non-empty `hook` (>=10 characters) and a
    `desire` from the 5 locked desires, plus a non-empty `desire_payoff`
    (what the chapter actually delivers for that desire)
  - every chapter has a non-empty `transition` (how it hands off to the next)
  - payoff cadence: chapter 3, 6, 9, ... must declare payoff_size small|big;
    chapter 10, 20, 30, ... must declare payoff_size big
  - the chapter's last paragraph must not be empty (a chapter ends on its hook,
    not on a dangling setup line)
Warnings: hook shorter than 20 characters (weak hook).
"""
import os
import re
import sys

DESIRES = {"curiosity", "identification-upgrade", "revenge-compensation",
           "being-loved", "escape-comfort"}
DESIRE_ZH = {"好奇", "代入升级", "复仇补偿", "被爱拉扯", "逃逸安慰"}


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


def check_book(book):
    failures, warnings = [], []
    ch_dir = os.path.join(book, "chapters")
    if not os.path.isdir(ch_dir):
        return ["missing chapters/ directory"], []
    files = sorted(f for f in os.listdir(ch_dir) if re.match(r"^\d{3}\.md$", f))
    if not files:
        return ["no chapters/NNN.md files found"], []
    for fname in files:
        num = int(fname[:3])
        text = open(os.path.join(ch_dir, fname), encoding="utf-8").read()
        fields, prose = chapter_fields(text)
        label = fname
        desire = fields.get("desire", "")
        if desire not in DESIRES and desire not in DESIRE_ZH:
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
        if num % 3 == 0 and size not in ("small", "big"):
            failures.append(f"{label}: chapter {num} is a payoff chapter (multiple of 3) — "
                            f"declare payoff_size small|big")
        if num % 10 == 0 and size != "big":
            failures.append(f"{label}: chapter {num} is a big-payoff chapter (multiple of 10) — "
                            f"payoff_size must be big")
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
