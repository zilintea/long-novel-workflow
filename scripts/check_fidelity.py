#!/usr/bin/env python3
"""Check committed chapters against the user-submitted outline (v2.2.0, P0).
Stdlib only. Usage: python3 scripts/check_fidelity.py <book_dir>

This is the fidelity audit — it asks "did this chapter write what the user
asked for?", while check_chapter.py / check_hooks.py / check_continuity.py
only ask "is this chapter internally consistent?". Run all four.

Blocking checks (exit 1 on any failure), per main chapter:
  - the chapter number exists in user_outline.yaml (an invented chapter fails)
  - frontmatter title contains the user outline title (after stripping the
    canonical 第N章 / Chapter N prefix)
  - frontmatter hook equals the user outline hook (user-locked, exact after strip)
  - frontmatter desire equals the outline desire (unless the outline says auto)
  - frontmatter characters equal the outline characters (set equality)
  - frontmatter foreshadowing_planted/paid equal the outline lists
  - every must_happen beat's keywords all appear in the prose (substring
    match on whitespace-stripped prose). A missing keyword fails the beat.
  - no thread is paid in a chapter earlier than its outline payoff_due
Epilogue/extra chapters (chapter_kind != main) skip the beat/title checks.
Books without a user_outline.yaml pass with a note — fidelity only applies
in user-driven mode.
Keyword matching is a floor, not the verdict: it proves the beat's distinctive
names/objects/actions are on the page; the 8-dimension human audit still
judges whether the beat actually happened semantically.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import user_outline as uo  # noqa: E402


def _strip_title_prefix(title, num):
    title = (title or "").strip()
    title = re.sub(rf"^第\s*{num}\s*章\s*", "", title)
    title = re.sub(rf"^第\s*[一二三四五六七八九十百千]+\s*章\s*", "", title)
    title = re.sub(rf"^Chapter\s+{num}\b\s*", "", title, flags=re.I)
    return title.strip()


def check_book(book_dir):
    failures, warnings = [], []
    sub = uo.load_submission(book_dir)
    if sub["outline"] is None:
        return [], ["no user_outline.yaml — fidelity check skipped "
                    "(only applies in user-driven mode)"]
    outline = sub["outline"]
    by_num = {}
    for ch in uo.outline_chapters(outline):
        if isinstance(ch, dict) and isinstance(ch.get("chapter"), int):
            by_num[ch["chapter"]] = ch
    threads = uo.thread_map(sub["threads"])
    ch_dir = os.path.join(book_dir, "chapters")
    if not os.path.isdir(ch_dir):
        return ["missing chapters/ directory"], []
    files = sorted(f for f in os.listdir(ch_dir) if re.match(r"^\d{3}\.md$", f))
    if not files:
        return [], ["no chapters/NNN.md files found — nothing to check"]
    for fname in files:
        num = int(fname[:3])
        label = fname
        text = open(os.path.join(ch_dir, fname), encoding="utf-8").read()
        fields, prose = uo.parse_frontmatter(text)
        if fields is None:
            failures.append(f"{label}: missing YAML frontmatter block")
            continue
        if (fields.get("chapter_kind", "main") or "main") != "main":
            continue
        want = by_num.get(num)
        if want is None:
            failures.append(f"{label}: chapter {num} is not in "
                            "user_outline.yaml — invented chapter (source: user "
                            "outline is the only chapter list in user-driven mode)")
            continue
        outline_title = (want.get("title") or "").strip()
        got_title = _strip_title_prefix(fields.get("title", ""), num)
        if outline_title and outline_title not in got_title:
            failures.append(f"{label}: title {got_title!r} does not contain "
                            f"user outline title {outline_title!r}")
        outline_hook = (want.get("hook") or "").strip()
        got_hook = (fields.get("hook") or "").strip()
        if outline_hook and got_hook != outline_hook:
            failures.append(f"{label}: hook differs from user outline hook "
                            f"(user-locked): got {got_hook!r}, want {outline_hook!r}")
        outline_desire = want.get("desire", "auto")
        got_desire = fields.get("desire", "")
        if outline_desire != "auto" and got_desire not in ("auto", outline_desire):
            failures.append(f"{label}: desire {got_desire!r} != user outline "
                            f"desire {outline_desire!r}")
        want_chars = set(want.get("characters") or [])
        got_chars = set(uo.split_list_field(fields.get("characters", "")))
        if want_chars and got_chars != want_chars:
            failures.append(f"{label}: characters {sorted(got_chars)} != user "
                            f"outline characters {sorted(want_chars)}")
        for key in ("foreshadowing_planted", "foreshadowing_paid"):
            want_ids = set(want.get(key) or [])
            got_ids = set(uo.split_list_field(fields.get(key, "")))
            if want_ids != got_ids:
                failures.append(f"{label}: {key} {sorted(got_ids)} != user "
                                f"outline {key} {sorted(want_ids)}")
        for tid in uo.split_list_field(fields.get("foreshadowing_paid", "")):
            due = (threads.get(tid) or {}).get("payoff_due")
            if isinstance(due, int) and num < due:
                failures.append(f"{label}: pays off {tid} in chapter {num} "
                                f"but user outline payoff_due is {due}")
        body = re.sub(r"\s+", "", prose)
        for beat in want.get("must_happen") or []:
            if not isinstance(beat, dict):
                continue
            for kw in beat.get("keywords") or []:
                kw_flat = re.sub(r"\s+", "", str(kw))
                if kw_flat and kw_flat not in body:
                    failures.append(f"{label}: must_happen beat "
                                    f"{str(beat.get('beat'))!r} missing keyword "
                                    f"{kw!r} in prose")
    return failures, warnings


def main():
    if len(sys.argv) != 2:
        print("usage: check_fidelity.py <book_dir>", file=sys.stderr)
        sys.exit(2)
    failures, warnings = check_book(sys.argv[1])
    for w in warnings:
        print(f"WARN: {w}")
    for f in failures:
        print(f"FAIL: {f}")
    if failures:
        print(f"check_fidelity: FAIL ({len(failures)} blocking, "
              f"{len(warnings)} warnings)")
        sys.exit(1)
    print(f"check_fidelity: PASS ({len(warnings)} warnings)")
    sys.exit(0)


if __name__ == "__main__":
    main()
