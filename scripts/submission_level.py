#!/usr/bin/env python3
"""Classify how complete a user submission is (v2.4.0, P2).
Stdlib only. Usage: python3 scripts/submission_level.py <book_dir>

Levels — each has a different opening procedure, not one-size-fits-all:
  L0 nothing submitted — no user_submission/ at all. Next: start with a
     one-line premise (full-auto / author-gated) or submit a brief.
  L1 one-liner — a brief exists but no user_outline.yaml. Next: user-driven
     mode needs an outline; until then the book runs full-auto/author-gated.
  L2 rough outline — an outline exists but at least one chapter is
     incomplete (missing title, hook, must_happen beats, or characters).
     Next: run submission_gaps.py, ask the MUST-ASK gaps, do NOT write
     prose; the user fills the gaps and the submission is re-validated.
  L3 detailed outline — every chapter is complete (title, hook >= 10 chars,
     >= 1 beat with keywords, 2-4 characters). Next: the normal user-driven
     flow — validate -> restate -> generate contracts -> draft.
  L4 chapter drafts — L3 plus at least one chapter draft in drafts/.
     Next: review each draft against the outline (check_fidelity on a staged
     copy); drafts enter canon only via CHAPTER_COMMIT, never directly.
This is a classifier, not an audit: exit 0 always, unless the outline file
exists but does not parse (exit 1).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import user_outline as uo  # noqa: E402

LEVEL_NEXT = {
    0: "start with a one-line premise (full-auto / author-gated), or submit a brief",
    1: "user-driven mode needs an outline — submit user_outline.yaml, or run full-auto / author-gated until then",
    2: "run submission_gaps.py, ask the MUST-ASK gaps, do NOT write prose; re-validate after the user fills the gaps",
    3: "normal user-driven flow: validate_submission.py -> restatement (Step 1.5) -> generate_contracts.py -> draft",
    4: "review each draft against the outline (check_fidelity on a staged copy); drafts enter canon only via CHAPTER_COMMIT",
}


def classify(book_dir):
    sub_dir = os.path.join(book_dir, "user_submission")
    if not os.path.isdir(sub_dir):
        return 0, []
    outline_path = uo.find_user_outline(book_dir)
    if outline_path is None:
        return 1, []
    try:
        outline = uo.load_yaml_file(outline_path)
    except ValueError as e:
        return -1, [f"{outline_path}: {e}"]
    missing = []
    chapters = outline.get("chapters") or []
    if not isinstance(chapters, list) or not chapters:
        missing.append("outline has no chapters")
    else:
        for ch in chapters:
            if not isinstance(ch, dict):
                missing.append(f"chapter entry is not a mapping: {ch!r}")
                continue
            num = ch.get("chapter")
            if not (ch.get("title") or "").strip():
                missing.append(f"chapter {num}: missing title")
            if len((ch.get("hook") or "").strip()) < 10:
                missing.append(f"chapter {num}: missing or too-short hook")
            beats = ch.get("must_happen") or []
            if not isinstance(beats, list) or not beats:
                missing.append(f"chapter {num}: missing must_happen beats")
            else:
                for beat in beats:
                    if isinstance(beat, dict) and not (beat.get("keywords") or []):
                        missing.append(f"chapter {num}: beat "
                                       f"{str(beat.get('beat'))[:20]!r} has no keywords")
            if not (ch.get("characters") or []):
                missing.append(f"chapter {num}: missing characters")
    if missing:
        return 2, missing
    drafts_dir = os.path.join(book_dir, "drafts")
    drafts = []
    if os.path.isdir(drafts_dir):
        drafts = [f for f in os.listdir(drafts_dir) if f.endswith(".md")]
    if drafts:
        return 4, []
    return 3, []


def main():
    if len(sys.argv) != 2:
        print("usage: submission_level.py <book_dir>", file=sys.stderr)
        sys.exit(2)
    level, missing = classify(sys.argv[1])
    if level == -1:
        for m in missing:
            print(f"FAIL: {m}")
        print("submission_level: FAIL (outline does not parse)")
        sys.exit(1)
    names = {0: "nothing submitted", 1: "one-liner", 2: "rough outline",
             3: "detailed outline", 4: "chapter drafts"}
    print(f"LEVEL: {level} ({names[level]})")
    print(f"NEXT: {LEVEL_NEXT[level]}")
    for m in missing:
        print(f"MISSING: {m}")
    sys.exit(0)


if __name__ == "__main__":
    main()
