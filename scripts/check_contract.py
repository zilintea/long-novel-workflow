#!/usr/bin/env python3
"""Check chapter contracts against their prose (v2.3.0, P1).
Stdlib only. Usage: python3 scripts/check_contract.py <book_dir>

This machine-checks Hard rules 3 and 11, which the three older scripts do
not cover: the contract is the single source the prose must match, and the
next chapter's contract must state how it resolves the previous hook.

Blocking checks (exit 1 on any failure):
  - a main chapter with prose in chapters/NNN.md but no contract in
    outline/chapters/NNN.md (no contract, no prose — Hard rule 3)
  - a contract missing a required field (chapter, title, desire, hook,
    transition, must_happen, characters)
  - a contract whose transition or desire_payoff is still TODO/empty
    (a contract with TODOs cannot be drafted from)
  - a contract for chapter N >= 2 with no hook handoff: its text must
    contain "Hook 交接" and reference the previous chapter ("第{N-1}章")
    (Hard rule 11, machine-checked)
  - prose frontmatter disagreeing with its contract, when both are present:
    title (after stripping the 第N章 / Chapter N prefix), desire,
    payoff_size, hook, characters (set), foreshadowing_planted/paid (set),
    must_happen (normalised string equality)
Warnings (do not fail):
  - a contract with no prose yet (not written — normal mid-serial state)
Books with no contracts at all (legacy books, e.g. examples/sample-book)
pass with a note — this check only applies once contracts exist.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import user_outline as uo  # noqa: E402

REQUIRED = ("chapter", "title", "desire", "hook", "transition",
            "must_happen", "characters")


_CN_DIGITS = "零一二三四五六七八九"


def _to_chinese(n):
    """1-99 in Chinese numerals (1 -> 一, 11 -> 十一, 20 -> 二十, 21 -> 二十一)."""
    if not 1 <= n <= 99:
        return str(n)
    if n < 10:
        return _CN_DIGITS[n]
    tens, ones = divmod(n, 10)
    out = ("十" if tens == 1 else _CN_DIGITS[tens] + "十")
    return out + (_CN_DIGITS[ones] if ones else "")


def _prev_chapter_ref(text, num):
    """True when text references chapter num-1, in digits or Chinese numerals."""
    prev = num - 1
    return (re.search(rf"第\s*{prev}\s*章", text) is not None or
            re.search(rf"第\s*{_to_chinese(prev)}\s*章", text) is not None)


def _contract_fields(text):
    """Parse a contract's fields. Contracts exist in two shapes: the current
    template's ```yaml block, and the older whole-file --- frontmatter shape
    (e.g. the MCP mini-book fixture). Accept both."""
    m = re.search(r"```yaml\n(.*?)\n```", text, re.S)
    if not m:
        m = re.search(r"```\n(.*?)\n```", text, re.S)
    if m:
        try:
            fields = uo.parse_yaml_subset(m.group(1))
        except ValueError as e:
            raise ValueError(f"yaml parse error: {e}")
        return fields if isinstance(fields, dict) else None
    fields, _body = uo.parse_frontmatter(text)
    return fields


def _strip_title_prefix(title, num):
    title = (title or "").strip()
    title = re.sub(rf"^第\s*{num}\s*章\s*", "", title)
    title = re.sub(rf"^第\s*[一二三四五六七八九十百千]+\s*章\s*", "", title)
    title = re.sub(rf"^Chapter\s+{num}\b\s*", "", title, flags=re.I)
    return title.strip()


def _norm(text):
    return re.sub(r"\s+", "", str(text or ""))


def check_book(book_dir):
    failures, warnings = [], []
    c_dir = os.path.join(book_dir, "outline", "chapters")
    p_dir = os.path.join(book_dir, "chapters")
    contracts = {}
    if os.path.isdir(c_dir):
        for f in sorted(os.listdir(c_dir)):
            if re.match(r"^\d{3}\.md$", f):
                contracts[int(f[:3])] = os.path.join(c_dir, f)
    if not contracts:
        return [], ["no outline/chapters/ contracts — check skipped "
                    "(legacy book without contracts)"]
    for num in sorted(contracts):
        label = f"contract {num:03d}.md"
        text = open(contracts[num], encoding="utf-8").read()
        try:
            fields = _contract_fields(text)
        except ValueError as e:
            failures.append(f"{label}: {e}")
            continue
        if fields is None:
            failures.append(f"{label}: no yaml block or frontmatter found")
            continue
        for key in REQUIRED:
            if key not in fields or str(fields.get(key) or "").strip() in ("", "-"):
                failures.append(f"{label}: missing required field `{key}`")
        has_prose = os.path.exists(os.path.join(p_dir, f"{num:03d}.md"))
        for key in ("transition", "desire_payoff"):
            if str(fields.get(key) or "").strip().upper().startswith("TODO"):
                if has_prose:
                    failures.append(f"{label}: `{key}` is still TODO but "
                                    "prose already exists — the chapter was "
                                    "drafted from an incomplete contract")
                else:
                    warnings.append(f"{label}: `{key}` is still TODO — fill "
                                    "it before drafting (source: ai-filled)")
        if num >= 2:
            # Two accepted shapes: a `hook_handoff:` field (the MCP
            # draftContract tool's shape), or a "Hook 交接" note in the text.
            # Either must reference the previous chapter (digits or Chinese
            # numerals: 第1章 / 第一章).
            handoff_field = str(fields.get("hook_handoff") or "").strip()
            field_ok = bool(handoff_field) and _prev_chapter_ref(handoff_field, num)
            note_ok = "Hook 交接" in text and _prev_chapter_ref(text, num)
            if not field_ok and not note_ok:
                failures.append(f"{label}: no hook handoff — the contract "
                                f"must state how it resolves chapter {num - 1}'s "
                                "end hook (Hard rule 11)")
        if not os.path.exists(os.path.join(p_dir, f"{num:03d}.md")):
            warnings.append(f"{label}: contract exists but no prose yet")
    if os.path.isdir(p_dir):
        for f in sorted(os.listdir(p_dir)):
            if not re.match(r"^\d{3}\.md$", f):
                continue
            num = int(f[:3])
            label = f
            text = open(os.path.join(p_dir, f), encoding="utf-8").read()
            fields, _prose = uo.parse_frontmatter(text)
            if fields is None:
                continue  # check_chapter.py owns the frontmatter check
            if (fields.get("chapter_kind", "main") or "main") != "main":
                continue
            if num not in contracts:
                failures.append(f"{label}: prose exists but no contract in "
                                "outline/chapters/ (no contract, no prose — "
                                "Hard rule 3)")
                continue
            c_text = open(contracts[num], encoding="utf-8").read()
            try:
                c_fields = _contract_fields(c_text)
            except ValueError:
                continue
            if not isinstance(c_fields, dict):
                continue
            got_title = _strip_title_prefix(fields.get("title", ""), num)
            want_title = _strip_title_prefix(c_fields.get("title", ""), num)
            if want_title and got_title != want_title:
                failures.append(f"{label}: title {got_title!r} != contract "
                                f"title {want_title!r}")
            for key in ("desire", "payoff_size", "hook"):
                got = str(fields.get(key, "") or "").strip()
                want = str(c_fields.get(key, "") or "").strip()
                if want and want.upper() != "TODO" and got != want:
                    failures.append(f"{label}: {key} {got!r} != contract "
                                    f"{key} {want!r}")
            for key in ("characters", "foreshadowing_planted",
                        "foreshadowing_paid"):
                got = set(uo.split_list_field(fields.get(key, "")))
                want = set(uo.split_list_field(str(c_fields.get(key, "") or "")))
                if want and got != want:
                    failures.append(f"{label}: {key} {sorted(got)} != contract "
                                    f"{key} {sorted(want)}")
            got_mh = _norm(fields.get("must_happen", ""))
            want_mh = _norm(c_fields.get("must_happen", ""))
            if got_mh and want_mh and got_mh != want_mh:
                failures.append(f"{label}: must_happen differs from contract — "
                                "the contract is the source; fix the contract "
                                "first, then the prose")
    return failures, warnings


def main():
    if len(sys.argv) != 2:
        print("usage: check_contract.py <book_dir>", file=sys.stderr)
        sys.exit(2)
    failures, warnings = check_book(sys.argv[1])
    for w in warnings:
        print(f"WARN: {w}")
    for f in failures:
        print(f"FAIL: {f}")
    if failures:
        print(f"check_contract: FAIL ({len(failures)} blocking, "
              f"{len(warnings)} warnings)")
        sys.exit(1)
    print(f"check_contract: PASS ({len(warnings)} warnings)")
    sys.exit(0)


if __name__ == "__main__":
    main()
