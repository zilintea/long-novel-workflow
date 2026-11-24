#!/usr/bin/env python3
"""List the gaps and contradictions in a user submission (v2.3.0, P1).
Stdlib only. Usage: python3 scripts/submission_gaps.py <book_dir>

This feeds the "understanding restatement" step (Step 1.5): after
validate_submission.py passes, the agent restates the outline back to the
author with this machine-detectable list attached. It is a question list,
not an audit — exit code is always 0 when the submission parses (1 only
when there is no submission or it does not parse).

Gap classes:
  MUST-ASK   — a missing decision the AI may not guess: a chapter with a
               single thin beat, a main character with no want/flaw, a
               foreshadowing thread paid in a different chapter than its
               payoff_due, an alias colliding with another character's name,
               two arcs claiming the same chapters.
  AI-MAY-FILL — the AI may fill it now and flag it at review: transition and
               desire_payoff (AI-fillable by design), a missing tone/POV in
               the brief, a minor character with no want/flaw.
  CONTRADICTION — two user statements that cannot both be true.
  INFO       — not a problem, but the author should confirm: the outline
               covers only the first N of T target chapters (rolling
               submission), a thread planted in a chapter not yet submitted,
               a roster character who appears in no chapter yet.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import user_outline as uo  # noqa: E402


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def collect(book_dir):
    must_ask, may_fill, contradictions, info = [], [], [], []
    sub = uo.load_submission(book_dir)
    if sub["outline"] is None:
        return None, (must_ask, may_fill, contradictions, info)
    outline = sub["outline"]
    chapters = uo.outline_chapters(outline)
    book = outline.get("book") or {}
    target = book.get("target_chapters")
    nums = [c.get("chapter") for c in chapters if isinstance(c, dict)]
    if _is_int(target) and nums and max(nums) < target:
        info.append(f"outline covers chapters 1-{max(nums)} of target "
                    f"{target} — rolling submission; the rest is not yet "
                    "submitted (confirm this is intended)")
    brief_path = os.path.join(book_dir, "user_submission", "user_brief.md")
    if os.path.exists(brief_path):
        brief = open(brief_path, encoding="utf-8").read()
        for field in ("基调", "视角"):
            if field in brief and brief.split(field, 1)[1].split("\n", 1)[0].strip("：: \n") == "":
                may_fill.append(f"user_brief.md: {field} is blank — the AI "
                                "will follow bible/voice.md and flag it at review")
    else:
        may_fill.append("no user_brief.md — tone/POV will follow bible/voice.md "
                        "and be flagged at review")
    chars_doc = sub["characters"]
    names, aliases = uo.character_names(chars_doc)
    roster = {}
    for c in (chars_doc or {}).get("characters") or []:
        if isinstance(c, dict) and c.get("name"):
            roster[c["name"]] = c
    alias_owners = {}
    for c in (chars_doc or {}).get("characters") or []:
        if isinstance(c, dict) and c.get("name"):
            for a in c.get("aliases") or []:
                alias_owners.setdefault(a, []).append(c["name"])
    for alias, owners in sorted(alias_owners.items()):
        if alias in names:
            contradictions.append(f"alias {alias!r} of {', '.join(owners)} "
                                  f"collides with character {alias!r} — one "
                                  "of them must be renamed")
        if len(owners) > 1:
            contradictions.append(f"alias {alias!r} is claimed by "
                                  f"{', '.join(owners)} — one of them must "
                                  "give it up")
    used = {}
    for ch in chapters:
        if not isinstance(ch, dict):
            continue
        num = ch.get("chapter")
        beats = ch.get("must_happen") or []
        if len(beats) == 1:
            must_ask.append(f"chapter {num} has only 1 must_happen beat — "
                            "is this chapter intentionally thin, or is a "
                            "beat missing?")
        for name in ch.get("characters") or []:
            used[name] = used.get(name, 0) + 1
    for name, count in sorted(used.items()):
        profile = roster.get(name)
        if profile is None:
            continue
        if not (profile.get("want") or "").strip() or not (profile.get("flaw") or "").strip():
            if count >= 3:
                must_ask.append(f"character {name} appears in {count} chapters "
                                "but has no want/flaw in user_characters.yaml — "
                                "a main character needs both")
            else:
                may_fill.append(f"character {name} has no want/flaw — the AI "
                                "may draft one and flag it at review")
    for name in sorted(names - set(used)):
        info.append(f"roster character {name} appears in no submitted chapter "
                    "yet — keep on the roster, or cut?")
    threads = uo.thread_map(sub["threads"])
    for tid, t in threads.items():
        planted = t.get("planted")
        if _is_int(planted) and nums and planted not in nums:
            info.append(f"thread {tid} is planted in chapter {planted}, which "
                        "is not in the submitted outline yet")
        if _is_int(t.get("payoff_due")) and _is_int(planted) and t["payoff_due"] <= planted:
            contradictions.append(f"thread {tid}: payoff_due {t['payoff_due']} "
                                  f"is not after planted {planted}")
    for ch in chapters:
        if not isinstance(ch, dict):
            continue
        num = ch.get("chapter")
        for tid in ch.get("foreshadowing_paid") or []:
            due = (threads.get(tid) or {}).get("payoff_due")
            if _is_int(due) and due != num:
                must_ask.append(f"chapter {num} pays off {tid}, but its "
                                f"payoff_due is {due} — pay it here (and move "
                                "the due date) or move the payoff?")
    ranges = []
    for arc in outline.get("arcs") or []:
        if not isinstance(arc, dict):
            continue
        rng = str(arc.get("range") or "")
        parts = rng.split("-")
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            ranges.append((int(parts[0]), int(parts[1]), arc.get("name")))
    for i in range(len(ranges)):
        for j in range(i + 1, len(ranges)):
            a, b = ranges[i], ranges[j]
            if a[0] <= b[1] and b[0] <= a[1]:
                contradictions.append(f"arcs {a[2]!r} ({a[0]}-{a[1]}) and "
                                      f"{b[2]!r} ({b[0]}-{b[1]}) overlap — "
                                      "chapters cannot belong to two arcs")
    return sub, (must_ask, may_fill, contradictions, info)


def main():
    if len(sys.argv) != 2:
        print("usage: submission_gaps.py <book_dir>", file=sys.stderr)
        sys.exit(2)
    sub, (must_ask, may_fill, contradictions, info) = collect(sys.argv[1])
    if sub is None:
        print("submission_gaps: no user_outline.yaml — skipped "
              "(only applies in user-driven mode)")
        sys.exit(1)
    for line in contradictions:
        print(f"CONTRADICTION: {line}")
    for line in must_ask:
        print(f"MUST-ASK: {line}")
    for line in may_fill:
        print(f"AI-MAY-FILL: {line}")
    for line in info:
        print(f"INFO: {line}")
    print(f"submission_gaps: {len(contradictions)} contradictions, "
          f"{len(must_ask)} must-ask, {len(may_fill)} ai-may-fill, "
          f"{len(info)} info")
    sys.exit(0)


if __name__ == "__main__":
    main()
