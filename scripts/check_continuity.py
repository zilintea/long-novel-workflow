#!/usr/bin/env python3
"""Check a book project's continuity state files.
Stdlib only. Usage: python3 scripts/check_continuity.py <book_dir>

Blocking checks (exit 1 on any failure):
  - state/foreshadowing.md exists; every thread has planted/payoff_due/status
  - every foreshadowing id planted/paid in a chapter contract exists in the ledger
  - a thread paid in a chapter is marked paid (or in-progress) in the ledger
  - no open thread is past its payoff_due chapter (stale = FAIL; due within
    the next 3 chapters = warning). Open threads unpaid after 30 chapters are
    always FAIL (the 30-chapter flag rule).
  - state/knows.md exists and lists every character named in bible/characters.md
  - every character named in a chapter contract appears in bible/characters.md
  - state/summary.md, state/timeline.md, state/progress.md exist; progress.md
    lists exactly the committed chapters present in chapters/
Warnings: ledger thread with no payoff_due, knows entry with no "learned in" chapter.
"""
import os
import re
import sys


def read(path):
    return open(path, encoding="utf-8").read() if os.path.exists(path) else ""


def parse_ledger(text):
    threads = {}
    for line in text.splitlines():
        m = re.match(r"-\s*(F\d+)\s*\|\s*planted:\s*(\d+)\s*\|\s*payoff_due:\s*(\d+|—|-)?"
                     r"\s*\|\s*status:\s*(\w+)", line)
        if m:
            threads[m.group(1)] = {
                "planted": int(m.group(2)),
                "payoff_due": int(m.group(3)) if m.group(3) and m.group(3).isdigit() else None,
                "status": m.group(4),
            }
    return threads


def chapter_fields(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    fields = {}
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                fields[k.strip()] = v.strip()
    return fields


def check_book(book):
    failures, warnings = [], []
    state = os.path.join(book, "state")
    ledger_path = os.path.join(state, "foreshadowing.md")
    if not os.path.exists(ledger_path):
        return ["missing state/foreshadowing.md"], []
    ledger = parse_ledger(read(ledger_path))
    if not ledger:
        failures.append("state/foreshadowing.md: no parseable threads "
                        "(want `- F01 | planted: N | payoff_due: N | status: open|paid`)")
    knows = read(os.path.join(state, "knows.md"))
    if not knows.strip():
        failures.append("missing/empty state/knows.md")
    bible_chars = read(os.path.join(book, "bible", "characters.md"))
    for name in re.findall(r"^##\s+(.+)$", bible_chars, re.M):
        if name.strip() not in knows:
            failures.append(f"state/knows.md: no knows entry for character `{name.strip()}`")
    for req in ("summary.md", "timeline.md", "progress.md"):
        if not os.path.exists(os.path.join(state, req)):
            failures.append(f"missing state/{req}")
    ch_dir = os.path.join(book, "chapters")
    files = sorted(f for f in os.listdir(ch_dir) if re.match(r"^\d{3}\.md$", f)) \
        if os.path.isdir(ch_dir) else []
    max_ch = 0
    committed = set()
    for fname in files:
        fields = chapter_fields(read(os.path.join(ch_dir, fname)))
        num = int(fname[:3])
        max_ch = max(max_ch, num)
        for key in ("foreshadowing_planted", "foreshadowing_paid"):
            for tid in re.findall(r"F\d+", fields.get(key, "")):
                if tid not in ledger:
                    failures.append(f"{fname}: {key} references unknown thread {tid}")
                elif key == "foreshadowing_paid" and ledger[tid]["status"] not in ("paid", "progressing"):
                    failures.append(f"{fname}: pays off {tid} but ledger status is "
                                    f"`{ledger[tid]['status']}` (must be paid/progressing)")
        for name in [c.strip() for c in fields.get("characters", "").split(",") if c.strip()]:
            if name and name not in bible_chars:
                failures.append(f"{fname}: character `{name}` not in bible/characters.md")
    for tid, t in ledger.items():
        due = t["payoff_due"]
        if due is None:
            warnings.append(f"{tid}: no payoff_due set (every thread needs a payoff date)")
            continue
        if t["status"] == "open":
            if max_ch >= due:
                failures.append(f"{tid}: open past payoff_due chapter {due} "
                                f"(current chapter {max_ch}) — stale thread")
            elif due - max_ch <= 3:
                warnings.append(f"{tid}: payoff due in chapter {due}, current {max_ch}")
            if max_ch - t["planted"] >= 30:
                failures.append(f"{tid}: open for >=30 chapters since planted "
                                f"(chapter {t['planted']}) — 30-chapter flag")
    progress = read(os.path.join(state, "progress.md"))
    committed = set(int(n) for n in re.findall(r"committed:\s*(\d+)", progress))
    present = set(int(f[:3]) for f in files)
    if committed != present:
        failures.append(f"state/progress.md committed chapters {sorted(committed)} != "
                        f"chapters on disk {sorted(present)} — commit is atomic, fix the mismatch")
    return failures, warnings


def main():
    if len(sys.argv) != 2:
        print("usage: check_continuity.py <book_dir>", file=sys.stderr)
        sys.exit(2)
    failures, warnings = check_book(sys.argv[1])
    for w in warnings:
        print(f"WARN: {w}")
    for f in failures:
        print(f"FAIL: {f}")
    if failures:
        print(f"check_continuity: FAIL ({len(failures)} blocking, {len(warnings)} warnings)")
        sys.exit(1)
    print(f"check_continuity: PASS ({len(warnings)} warnings)")
    sys.exit(0)


if __name__ == "__main__":
    main()
