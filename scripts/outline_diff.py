#!/usr/bin/env python3
"""Diff two versions of a user outline and list the impact (v2.3.0, P1).
Stdlib only. Usage:
  python3 scripts/outline_diff.py <book_dir> <old_version> [<new_version>]

Compares user_submission/versions/<old_version>/user_outline.yaml against
the live user_submission/user_outline.yaml (or
versions/<new_version>/user_outline.yaml when a second version is given).
Also compares the characters and foreshadowing files when present in both
sides. Prints an impact list — it never changes any file.

Impact it reports:
  - added / removed / changed chapters (which field changed: title, hook,
    desire, payoff_size, characters, foreshadowing, must_happen beats)
  - contracts to regenerate: outline/chapters/NNN.md for every changed or
    added chapter, plus the next chapter (its hook handoff may shift)
  - committed chapters affected: chapters/NNN.md whose outline content
    changed — flagged DECISION NEEDED; the prose is never auto-changed,
    the author decides keep / rewrite / roll back
  - threads whose payoff_due or planted chapter moved, and threads added/removed
  - characters added / removed / renamed (renames break every chapter that
    names the old name — listed explicitly)
  - frozen arcs changed — flagged DECISION NEEDED (a frozen arc may only
    change with the author's explicit confirmation)
Exit 0 always (a diff is a report, not a verdict).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import user_outline as uo  # noqa: E402


def _load_side(book_dir, version):
    """Load one side: a version name (versions/<v>/) or None for live files."""
    if version is None:
        base = os.path.join(book_dir, "user_submission")
    else:
        base = os.path.join(book_dir, "user_submission", "versions", version)
    out = {}
    for key, fname in (("outline", "user_outline.yaml"),
                       ("characters", "user_characters.yaml"),
                       ("threads", "user_foreshadowing.yaml")):
        path = os.path.join(base, fname)
        out[key] = uo.load_yaml_file(path) if os.path.exists(path) else None
    return out


def _beats_text(ch):
    return [str(b.get("beat")) for b in (ch.get("must_happen") or [])
            if isinstance(b, dict)]


def _chapter_fields(ch):
    return {
        "title": ch.get("title"),
        "hook": ch.get("hook"),
        "desire": ch.get("desire"),
        "payoff_size": ch.get("payoff_size"),
        "characters": list(ch.get("characters") or []),
        "foreshadowing_planted": list(ch.get("foreshadowing_planted") or []),
        "foreshadowing_paid": list(ch.get("foreshadowing_paid") or []),
        "must_happen": _beats_text(ch),
    }


def diff(book_dir, old_version, new_version):
    old = _load_side(book_dir, old_version)
    new = _load_side(book_dir, new_version)
    if old["outline"] is None:
        print(f"FAIL: no user_outline.yaml in versions/{old_version}/ — "
              "snapshot the old submission first "
              "(scripts/snapshot_submission.py)")
        sys.exit(1)
    if new["outline"] is None:
        print("FAIL: no live user_outline.yaml to compare against")
        sys.exit(1)
    old_ch = {c["chapter"]: c for c in uo.outline_chapters(old["outline"])
              if isinstance(c, dict)}
    new_ch = {c["chapter"]: c for c in uo.outline_chapters(new["outline"])
              if isinstance(c, dict)}
    impacts, decisions = [], []
    changed = set()
    for num in sorted(set(old_ch) | set(new_ch)):
        if num not in old_ch:
            impacts.append(f"chapter {num} added — generate contract "
                           f"outline/chapters/{num:03d}.md")
            changed.add(num)
        elif num not in new_ch:
            impacts.append(f"chapter {num} removed from the outline")
            decisions.append(f"chapter {num} was removed — prose in "
                             f"chapters/{num:03d}.md (if any) needs a "
                             "decision: keep as extra, or roll back?")
            changed.add(num)
        else:
            diffs = [k for k in _chapter_fields(old_ch[num])
                     if _chapter_fields(old_ch[num])[k] != _chapter_fields(new_ch[num])[k]]
            if diffs:
                impacts.append(f"chapter {num} changed ({', '.join(diffs)}) — "
                               f"regenerate contract outline/chapters/{num:03d}.md")
                changed.add(num)
    for num in sorted(changed):
        nxt = num + 1
        if nxt in new_ch and nxt not in changed:
            impacts.append(f"chapter {nxt} contract should be regenerated too "
                           "— its hook handoff follows the changed chapter "
                           f"{num}")
    prose_dir = os.path.join(book_dir, "chapters")
    if os.path.isdir(prose_dir):
        for num in sorted(changed):
            if os.path.exists(os.path.join(prose_dir, f"{num:03d}.md")):
                decisions.append(f"chapter {num} has committed prose and its "
                                 "outline changed — DECISION NEEDED: keep the "
                                 "prose, rewrite it, or roll it back? "
                                 "(never auto-changed)")
    old_t = uo.thread_map(old["threads"])
    new_t = uo.thread_map(new["threads"])
    for tid in sorted(set(old_t) | set(new_t)):
        if tid not in old_t:
            impacts.append(f"thread {tid} added (planted "
                           f"{(new_t[tid] or {}).get('planted')}, payoff_due "
                           f"{(new_t[tid] or {}).get('payoff_due')})")
        elif tid not in new_t:
            decisions.append(f"thread {tid} was removed — check every chapter "
                             "that plants or pays it")
        else:
            for key in ("planted", "payoff_due", "status"):
                if old_t[tid].get(key) != new_t[tid].get(key):
                    impacts.append(f"thread {tid}: {key} changed "
                                   f"{old_t[tid].get(key)!r} -> "
                                   f"{new_t[tid].get(key)!r}")
    old_names, _ = uo.character_names(old["characters"])
    new_names, _ = uo.character_names(new["characters"])
    for name in sorted(new_names - old_names):
        impacts.append(f"character {name} added to the roster")
    for name in sorted(old_names - new_names):
        decisions.append(f"character {name} was removed from the roster — "
                         "check every chapter that names them")
    old_arcs = {(a.get("name"), str(a.get("range"))) for a in
                (old["outline"].get("arcs") or []) if isinstance(a, dict)}
    new_arcs = {(a.get("name"), str(a.get("range"))) for a in
                (new["outline"].get("arcs") or []) if isinstance(a, dict)}
    for arc in sorted(new_arcs - old_arcs):
        frozen = any(a.get("name") == arc[0] and a.get("frozen")
                     for a in (new["outline"].get("arcs") or [])
                     if isinstance(a, dict))
        if frozen:
            decisions.append(f"frozen arc {arc[0]!r} ({arc[1]}) changed — "
                             "DECISION NEEDED: a frozen arc may only change "
                             "with the author's explicit confirmation")
        else:
            impacts.append(f"arc {arc[0]!r} ({arc[1]}) changed")
    for line in impacts:
        print(f"IMPACT: {line}")
    for line in decisions:
        print(f"DECISION NEEDED: {line}")
    print(f"outline_diff: {len(impacts)} impacts, {len(decisions)} decisions "
          "needed")
    return len(impacts), len(decisions)


def main():
    if len(sys.argv) not in (3, 4):
        print("usage: outline_diff.py <book_dir> <old_version> "
              "[<new_version>]", file=sys.stderr)
        sys.exit(2)
    diff(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None)
    sys.exit(0)


if __name__ == "__main__":
    main()
