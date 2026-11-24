#!/usr/bin/env python3
"""Validate a user-submitted outline before any prose is written (v2.2.0, P0).
Stdlib only. Usage:
  python3 scripts/validate_submission.py <book_dir>
  python3 scripts/validate_submission.py <user_outline.yaml>

Blocking checks (exit 1 on any failure):
  - user_outline.yaml exists and parses (restricted YAML subset, see
    scripts/user_outline.py); book title/language/mode present, mode is
    user-driven, language is zh or en
  - chapter numbers start at 1, are consecutive with no duplicates or gaps
  - every chapter has a non-empty title, a hook >= 10 chars, >= 1 must_happen
    beat, and every beat has non-empty text plus >= 1 keyword
  - desire is one of the 8 core desires (or auto); payoff_size is auto|small|big
  - every chapter lists 2-4 characters, none a placeholder name, all defined
    in user_characters.yaml (when that file exists)
  - every foreshadowing id in planted/paid exists in user_foreshadowing.yaml
    (when that file exists); planted payoff_due is an int after its chapter;
    a paid id must have been planted in an earlier-or-equal chapter
  - frozen arcs (when present) name chapter ranges inside the outline
Warnings (do not fail):
  - no user_characters.yaml / user_foreshadowing.yaml supplied (checks that
    need them are skipped, not failed)
  - a chapter lists only 1 character (solo-monologue risk from chapter 2 on)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import user_outline as uo  # noqa: E402
import beat_budget  # noqa: E402


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def validate_book(book_dir):
    failures, warnings = [], []
    sub = uo.load_submission(book_dir)
    if sub["outline"] is None:
        # No submission in this book (full-auto / author-gated) — nothing
        # to validate. This is a skip, not a failure.
        return ([], ["no user_outline.yaml — validation skipped "
                     "(only applies in user-driven mode)"])
    outline = sub["outline"]
    book = outline.get("book") or {}
    if not isinstance(book, dict):
        failures.append("user_outline.yaml: `book` must be a mapping")
        book = {}
    if not book.get("title"):
        failures.append("book.title is missing/empty")
    if book.get("language") not in ("zh", "en"):
        failures.append(f"book.language must be zh or en, got {book.get('language')!r}")
    if book.get("mode") != "user-driven":
        failures.append(f"book.mode must be user-driven, got {book.get('mode')!r}")
    if sub["characters"] is None:
        warnings.append("no user_characters.yaml supplied — character checks "
                        "against the roster are skipped")
    if sub["threads"] is None:
        warnings.append("no user_foreshadowing.yaml supplied — foreshadowing "
                        "cross-checks are skipped")
    known_names, _aliases = uo.character_names(sub["characters"])
    threads = uo.thread_map(sub["threads"])
    planted_chapter = {}
    for tid, t in threads.items():
        if not _is_int(t.get("planted")) or not _is_int(t.get("payoff_due")):
            failures.append(f"{tid}: planted and payoff_due must be ints")
        elif t["payoff_due"] <= t["planted"]:
            failures.append(f"{tid}: payoff_due {t['payoff_due']} must be after "
                            f"planted {t['planted']}")
        if t.get("status") not in ("open", "progressing", "paid", "deferred",
                                   "archived", None):
            failures.append(f"{tid}: unknown status {t.get('status')!r}")
        planted_chapter[tid] = t.get("planted")
    try:
        chapters = uo.outline_chapters(outline)
    except ValueError as e:
        return [f"user_outline.yaml: {e}"], warnings
    numbers = []
    for ch in chapters:
        if not isinstance(ch, dict):
            failures.append(f"chapter entry is not a mapping: {ch!r}")
            continue
        num = ch.get("chapter")
        if not _is_int(num):
            failures.append(f"chapter entry missing int `chapter`: {ch!r}")
            continue
        numbers.append(num)
        label = f"chapter {num}"
        if not (ch.get("title") or "").strip():
            failures.append(f"{label}: missing/empty `title` (source: user, locked)")
        hook = (ch.get("hook") or "").strip()
        if len(hook) < 10:
            failures.append(f"{label}: missing or too-short `hook` (need >=10 chars)")
        desire = ch.get("desire", "auto")
        if desire not in uo.DESIRES and desire not in uo.DESIRE_ZH:
            failures.append(f"{label}: unknown desire {desire!r}")
        if ch.get("payoff_size", "auto") not in ("auto", "small", "big"):
            failures.append(f"{label}: payoff_size must be auto|small|big")
        beats = ch.get("must_happen") or []
        if not isinstance(beats, list) or not beats:
            failures.append(f"{label}: missing `must_happen` beats (need >=1)")
        else:
            for beat in beats:
                if not isinstance(beat, dict) or not (beat.get("beat") or "").strip():
                    failures.append(f"{label}: must_happen beat missing text: {beat!r}")
                    continue
                kws = beat.get("keywords") or []
                if not isinstance(kws, list) or not kws:
                    failures.append(f"{label}: beat {beat.get('beat')!r} needs "
                                    ">=1 keyword for check_fidelity.py")
        chars = ch.get("characters") or []
        if not isinstance(chars, list) or not chars:
            failures.append(f"{label}: missing `characters` (need 2-4 named)")
        else:
            if len(chars) == 1 and num >= 2:
                warnings.append(f"{label}: only 1 character listed — "
                                "solo-monologue risk")
            if len(chars) > 4:
                warnings.append(f"{label}: {len(chars)} characters listed — "
                                "contract recommends 2-4")
            for name in chars:
                if name in uo.PLACEHOLDER_NAMES:
                    failures.append(f"{label}: placeholder character {name!r} "
                                    "is forbidden — use a named character")
                elif known_names and name not in known_names:
                    failures.append(f"{label}: character {name!r} is not in "
                                    "user_characters.yaml")
        for key in ("foreshadowing_planted", "foreshadowing_paid"):
            for tid in ch.get(key) or []:
                if threads and tid not in threads:
                    failures.append(f"{label}: {key} references unknown "
                                    f"thread {tid}")
                if key == "foreshadowing_paid" and tid in planted_chapter:
                    if planted_chapter[tid] is not None and planted_chapter[tid] > num:
                        failures.append(f"{label}: pays off {tid} in chapter "
                                        f"{num} but it is planted in chapter "
                                        f"{planted_chapter[tid]}")
    language = book.get("language") if isinstance(book.get("language"), str) else "zh"
    target = beat_budget.chapter_target(book, language)
    for ch in chapters:
        if not isinstance(ch, dict):
            continue
        bf, bw = beat_budget.check_budgets(ch, language, target)
        failures.extend(bf)
        warnings.extend(bw)
    if numbers:
        if sorted(numbers) != list(range(1, len(numbers) + 1)):
            failures.append(f"chapter numbers must start at 1 and be consecutive "
                            f"with no duplicates or gaps, got {sorted(numbers)}")
        if len(numbers) != len(set(numbers)):
            failures.append("duplicate chapter numbers")
    for arc in outline.get("arcs") or []:
        if not isinstance(arc, dict):
            continue
        rng = str(arc.get("range") or "")
        m = __import__("re").match(r"^(\d+)-(\d+)$", rng)
        if not m:
            failures.append(f"arc {arc.get('name')!r}: range must be `N-M`, got {rng!r}")
        elif numbers and (int(m.group(1)) < 1 or int(m.group(2)) > max(numbers)):
            failures.append(f"arc {arc.get('name')!r}: range {rng} is outside "
                            f"the outline (1-{max(numbers)})")
    return failures, warnings


def main():
    if len(sys.argv) != 2:
        print("usage: validate_submission.py <book_dir|user_outline.yaml>",
              file=sys.stderr)
        sys.exit(2)
    target = sys.argv[1]
    if os.path.isdir(target):
        failures, warnings = validate_book(target)
    elif os.path.isfile(target):
        parent = os.path.dirname(os.path.abspath(target))
        book_dir = (os.path.dirname(parent)
                    if os.path.basename(parent) in ("user_submission", "outline")
                    else parent)
        failures, warnings = validate_book(book_dir)
    else:
        failures = [f"no such file or directory: {target}"]
        warnings = []
    for w in warnings:
        print(f"WARN: {w}")
    for f in failures:
        print(f"FAIL: {f}")
    if failures:
        print(f"validate_submission: FAIL ({len(failures)} blocking, "
              f"{len(warnings)} warnings)")
        sys.exit(1)
    print(f"validate_submission: PASS ({len(warnings)} warnings)")
    sys.exit(0)


if __name__ == "__main__":
    main()
