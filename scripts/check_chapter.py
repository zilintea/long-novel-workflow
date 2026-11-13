#!/usr/bin/env python3
"""Check one book project's chapters against their contracts.
Stdlib only. Usage: python3 scripts/check_chapter.py <book_dir>

Blocking checks (exit 1 on any failure):
  - every chapters/NNN.md has YAML frontmatter with all required fields
  - filename number matches the `chapter:` field
  - `desire` is one of the 5 locked desires (en key or zh name)
  - `hook`, `transition`, `must_happen`, `characters` are non-empty
  - prose length is inside the language range (zh: 800-3500 chars, en: 600-3000 words)
  - no banned AI-flavour phrase from data/slop/<lang>.yaml appears in the prose
Warnings (do not fail): chapter shorter than the serial target
(zh <2000 chars, en <1500 words) — probes/excerpts are allowed, say so in the contract.
"""
import os
import re
import sys

DESIRES = {
    "curiosity": "好奇", "identification-upgrade": "代入升级",
    "revenge-compensation": "复仇补偿", "being-loved": "被爱拉扯",
    "escape-comfort": "逃逸安慰",
}
DESIRE_ZH = {v: k for k, v in DESIRES.items()}
REQUIRED = ["chapter", "title", "language", "desire", "hook",
            "transition", "must_happen", "characters"]
RANGES = {"zh": (800, 3500, 2000, "chars"), "en": (600, 3000, 1500, "words")}


def parse_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return None, text
    fields = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fields[k.strip()] = v.strip()
    return fields, m.group(2)


def load_slop(lang, script_dir):
    path = os.path.join(script_dir, "..", "data", "slop", f"{lang}.yaml")
    phrases = []
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line.startswith("- "):
                phrases.append(line[2:].strip().strip('"').strip("'"))
    return phrases


def check_book(book):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ch_dir = os.path.join(book, "chapters")
    failures, warnings = [], []
    if not os.path.isdir(ch_dir):
        return [f"missing chapters/ directory in {book}"], []
    files = sorted(f for f in os.listdir(ch_dir) if re.match(r"^\d{3}\.md$", f))
    if not files:
        return ["no chapters/NNN.md files found"], []
    for fname in files:
        path = os.path.join(ch_dir, fname)
        text = open(path, encoding="utf-8").read()
        fields, prose = parse_frontmatter(text)
        label = fname
        if fields is None:
            failures.append(f"{label}: missing YAML frontmatter block")
            continue
        for req in REQUIRED:
            if not fields.get(req):
                failures.append(f"{label}: missing/empty required field `{req}`")
        num = fname[:3]
        if fields.get("chapter") and fields["chapter"].lstrip("0") != num.lstrip("0"):
            failures.append(f"{label}: chapter field {fields['chapter']} != filename {num}")
        lang = fields.get("language", "zh")
        if lang not in RANGES:
            failures.append(f"{label}: unknown language `{lang}` (want zh or en)")
            continue
        desire = fields.get("desire", "")
        if desire not in DESIRES and desire not in DESIRE_ZH:
            failures.append(f"{label}: unknown desire `{desire}` (want one of {sorted(DESIRES)})")
        lo, hi, target, unit = RANGES[lang]
        if lang == "zh":
            body = re.sub(r"\s+", "", prose)
            size = len(body)
        else:
            size = len(re.findall(r"[A-Za-z']+", prose))
        if size < lo or size > hi:
            failures.append(f"{label}: prose {size} {unit} outside range {lo}-{hi}")
        elif size < target:
            warnings.append(f"{label}: prose {size} {unit} below serial target {target} "
                            f"(ok for a probe/excerpt — say so in the contract)")
        for phrase in load_slop(lang, script_dir):
            if phrase and phrase in prose:
                failures.append(f"{label}: banned AI-flavour phrase found: {phrase!r}")
    return failures, warnings


def main():
    if len(sys.argv) != 2:
        print("usage: check_chapter.py <book_dir>", file=sys.stderr)
        sys.exit(2)
    failures, warnings = check_book(sys.argv[1])
    for w in warnings:
        print(f"WARN: {w}")
    for f in failures:
        print(f"FAIL: {f}")
    if failures:
        print(f"check_chapter: FAIL ({len(failures)} blocking, {len(warnings)} warnings)")
        sys.exit(1)
    print(f"check_chapter: PASS ({len(warnings)} warnings)")
    sys.exit(0)


if __name__ == "__main__":
    main()
