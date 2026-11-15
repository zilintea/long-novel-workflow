#!/usr/bin/env python3
"""Check a book project's continuity state files (v2.0.0).
Stdlib only. Usage: python3 scripts/check_continuity.py <book_dir>

Blocking checks (exit 1 on any failure):
  - state/foreshadowing.md exists; every thread has planted/payoff_due/status
  - every foreshadowing id planted/paid in a chapter contract exists in the ledger
  - a thread paid in a chapter is marked paid (or progressing) in the ledger
  - no `open` or un-rescheduled `deferred` thread is past its payoff_due chapter
    (stale = FAIL; due within the next 3 chapters = warning). Open threads unpaid
    after 30 chapters are always FAIL (the 30-chapter flag rule).
  - state/knows.md exists and lists every character named in bible/characters.md
  - every character named in a chapter contract appears in bible/characters.md
    and is NOT a nameless placeholder (e.g. 黑衣人, 神秘人, 路人, 店小二, stranger)
  - state/summary.md, state/timeline.md, state/progress.md exist; progress.md
    lists exactly the committed chapters present in chapters/
Warnings:
  - ledger thread with no payoff_due
  - chapter >= 2 with <= 1 named character (cast-thin / solo monologue risk)
"""
import os
import re
import sys

PLACEHOLDER_NAMES = {
    "黑衣人", "神秘人", "陌生人", "路人", "过路人", "行人", "群众", "围观者",
    "侍卫", "护卫", "士兵", "家丁", "管家", "掌柜", "店小二", "小二", "老板",
    "老者", "老头", "老妇", "少女", "少年", "男子", "女子", "男人", "女人",
    "杀手", "刺客", "打手", "保镖", "医生", "大夫", "护士", "秘书", "助理",
    "司机", "主角", "反派", "男主", "女主", "配角", "龙套", "某人", "无名",
    "unknown", "stranger", "guard", "assassin", "passerby", "protagonist",
    "waiter", "doctor",
}


def read(path):
    return open(path, encoding="utf-8").read() if os.path.exists(path) else ""


def parse_ledger(text):
    threads = {}
    for line in text.splitlines():
        m = re.match(r"-\s*(F\d+)\s*\|\s*planted:\s*(\d+)\s*\|\s*payoff_due:\s*(\d+|—|-)?"
                     r"\s*\|\s*status:\s*(\w+)", line)
        if m:
            target_m = re.search(r"target_chapter:\s*(\d+)", line)
            threads[m.group(1)] = {
                "planted": int(m.group(2)),
                "payoff_due": int(m.group(3)) if m.group(3) and m.group(3).isdigit() else None,
                "status": m.group(4),
                "target_chapter": int(target_m.group(1)) if target_m else None,
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
                        "(want `- F01 | planted: N | payoff_due: N | status: open|progressing|paid|deferred`)")
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
        char_names = [c.strip() for c in fields.get("characters", "").split(",") if c.strip()]
        if num >= 2 and len(char_names) <= 1:
            warnings.append(f"{fname}: only {len(char_names)} character(s) listed — "
                            f"avoid solo protagonist monologue; bring in named supporting cast")
        for name in char_names:
            if name.lower() in PLACEHOLDER_NAMES or re.match(r"^(某|第[一二三四五六七八九十\d]+号|未知)", name):
                failures.append(f"{fname}: placeholder character name `{name}` is forbidden — "
                                f"forge a named character and register in bible/characters.md")
            elif name and name not in bible_chars:
                failures.append(f"{fname}: character `{name}` not in bible/characters.md")
    for tid, t in ledger.items():
        due = t["payoff_due"]
        if due is None:
            warnings.append(f"{tid}: no payoff_due set (every thread needs a payoff date)")
            continue
        if t["status"] in ("open", "progressing", "deferred"):
            effective_due = max(due, t["target_chapter"] or 0)
            if max_ch >= effective_due:
                failures.append(f"{tid}: {t['status']} past payoff_due chapter {effective_due} "
                                f"(current chapter {max_ch}) — stale thread")
            elif t["status"] == "open" and due - max_ch <= 3:
                warnings.append(f"{tid}: payoff due in chapter {due}, current {max_ch}")
            if t["status"] == "open" and max_ch - t["planted"] >= 30:
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
