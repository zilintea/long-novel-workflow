#!/usr/bin/env python3
"""Check one book project's chapters against their contracts (v2.1.0).
Stdlib only. Usage: python3 scripts/check_chapter.py <book_dir>

Blocking checks (exit 1 on any failure):
  - every chapters/NNN.md has YAML frontmatter with all required fields
  - filename number matches the `chapter:` field
  - `desire` is one of the 8 core desires (en key or zh name), or `auto` (warning)
  - `hook`, `transition`, `must_happen`, `characters` are non-empty
  - prose length (manual §六.2, same as the TS audit):
      empty prose is blocking for every chapter (including epilogue/extra);
      main chapters below the probe floor (zh 800 chars / en 600 words) are
      blocking; main chapters below the serial floor are a warning only
      (zh 2100 chars, short-word mode 1500, en 1500 words; probe chapters
      use the probe floor); above the max (zh 4000 / en 2500) is a warning,
      never blocking. Epilogue/extra chapters skip the size checks.
  - no banned AI-flavour phrase from data/slop/<lang>.yaml appears in the prose
Warnings (do not fail):
  - chapter below the serial floor (see above)
  - chapter above the suggested max
  - `desire` is still `auto` in a committed chapter
  - chapter title lacks `第N章` / `Chapter N` prefix
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from phase import is_short_word_mode  # noqa: E402

DESIRES = {
    "curiosity": "好奇",
    "identification-upgrade": "代入升级",
    "revenge-compensation": "复仇补偿",
    "being-loved": "被爱拉扯",
    "escape-comfort": "逃逸安慰",
    "survival-breakout": "求生破局",
    "power-scheme": "博弈掌权",
    "bond-resonance": "羁绊共鸣",
}
DESIRE_ZH = {v: k for k, v in DESIRES.items()}
REQUIRED = ["chapter", "title", "language", "desire", "hook",
            "transition", "must_happen", "characters"]
# lang -> (probe floor, serial floor, suggested max, unit)
RANGES = {"zh": (800, 2100, 4000, "chars"), "en": (600, 1500, 2500, "words")}


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


def parse_compass(book):
    """Read Target chapters / Target words from outline/overview.md.
    Missing keys -> None (old book, legacy fallback)."""
    text = ""
    path = os.path.join(book, "outline", "overview.md")
    if os.path.exists(path):
        text = open(path, encoding="utf-8").read()
    def _int(key):
        m = re.search(rf"^- {key}:\s*(\d+)\s*$", text, re.M)
        return int(m.group(1)) if m else None
    return {
        "target_chapters": _int("Target chapters"),
        "target_words": _int("Target words"),
    }


def check_book(book):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    ch_dir = os.path.join(book, "chapters")
    failures, warnings = [], []
    if not os.path.isdir(ch_dir):
        return [f"missing chapters/ directory in {book}"], []
    files = sorted(f for f in os.listdir(ch_dir) if re.match(r"^\d{3}\.md$", f))
    if not files:
        return ["no chapters/NNN.md files found"], []
    compass = parse_compass(book)
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
        ch_num = int(num)
        if fields.get("chapter") and fields["chapter"].lstrip("0") != num.lstrip("0"):
            failures.append(f"{label}: chapter field {fields['chapter']} != filename {num}")
        lang = fields.get("language", "zh")
        if lang not in RANGES:
            failures.append(f"{label}: unknown language `{lang}` (want zh or en)")
            continue
        title = fields.get("title", "")
        if title and not re.match(rf"^(第\s*{ch_num}\s*章|Chapter\s+{ch_num}\b)", title, re.I):
            warnings.append(f"{label}: title {title!r} lacks `第{ch_num}章` / `Chapter {ch_num}` prefix")
        desire = fields.get("desire", "")
        if desire == "auto":
            warnings.append(f"{label}: desire is `auto` — resolve to one of the 8 core desires in commit")
        elif desire not in DESIRES and desire not in DESIRE_ZH:
            failures.append(f"{label}: unknown desire `{desire}` (want one of {sorted(DESIRES)})")
        lo, target, hi, unit = RANGES[lang]
        if lang == "zh":
            body = re.sub(r"\s+", "", prose)
            size = len(body)
        else:
            size = len(re.findall(r"[A-Za-z']+", prose))
        kind = fields.get("chapter_kind", "main")
        is_probe = fields.get("is_probe", "").lower() == "true"
        if size == 0:
            failures.append(f"{label}: no prose paragraphs found")
        elif kind != "main":
            pass  # 后记/番外豁免字数上下限（空正文仍在上面阻断）。
        else:
            # 短篇字数模式仅中文生效：下限 1500（手册 §六.2）。
            min_limit = lo if is_probe else (
                1500 if (lang == "zh" and is_short_word_mode(
                    compass["target_chapters"], compass["target_words"])) else target
            )
            if size < lo:
                failures.append(f"{label}: prose {size} {unit} below probe floor {lo}")
            elif size < min_limit:
                warnings.append(f"{label}: prose {size} {unit} below serial floor {min_limit} "
                                f"(ok for a probe/excerpt — say so in the contract)")
            elif size > hi:
                warnings.append(f"{label}: prose {size} {unit} above suggested max {hi} "
                                f"(consider trimming or splitting)")
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
