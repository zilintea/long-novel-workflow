#!/usr/bin/env python3
"""Shared loader for user-submitted outlines (v2.2.0, P0).

Stdlib only — deliberately no PyYAML: the skill promises scripts run on
Python 3.9+ with no extra install, on hosts that may not have PyYAML.
Parses only the restricted YAML subset used by
templates/user_submission/*.yaml:

  - `key: scalar` mappings (2-space indent)
  - `- key: value` / `- scalar` list items
  - `[a, b]` inline lists, quoted strings, ints, booleans
  - `#` comments (outside quotes) and blank lines

Anything outside that subset is a parse error — fail loud, never guess.
"""
import os
import re

PLACEHOLDER_NAMES = {
    "黑衣人", "神秘人", "陌生人", "路人", "过路人", "行人", "群众", "围观者",
    "侍卫", "护卫", "士兵", "家丁", "管家", "掌柜", "店小二", "小二", "老板",
    "老者", "老头", "老妇", "少女", "少年", "男子", "女子", "男人", "女人",
    "杀手", "刺客", "打手", "保镖", "医生", "大夫", "护士", "秘书", "助理",
    "司机", "主角", "反派", "男主", "女主", "配角", "龙套", "某人", "无名",
    "unknown", "stranger", "guard", "assassin", "passerby", "protagonist",
    "waiter", "doctor",
}

DESIRES = {
    "curiosity", "identification-upgrade", "revenge-compensation",
    "being-loved", "escape-comfort", "survival-breakout",
    "power-scheme", "bond-resonance", "auto",
}
DESIRE_ZH = {
    "好奇", "代入升级", "复仇补偿", "被爱拉扯",
    "逃逸安慰", "求生破局", "博弈掌权", "羁绊共鸣",
}


def _strip_comment(line):
    in_single = in_double = False
    for i, ch in enumerate(line):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            if i == 0 or line[i - 1] in " \t":
                return line[:i].rstrip()
    return line.rstrip()


def _split_top_commas(text):
    parts, cur, in_single, in_double, depth = [], "", False, False, 0
    for ch in text:
        if ch == "'" and not in_double:
            in_single = not in_single
            cur += ch
        elif ch == '"' and not in_single:
            in_double = not in_double
            cur += ch
        elif ch in "[{" and not in_single and not in_double:
            depth += 1
            cur += ch
        elif ch in "]}" and not in_single and not in_double:
            depth -= 1
            cur += ch
        elif ch == "," and not in_single and not in_double and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    return parts


def parse_scalar(text):
    text = text.strip()
    if text == "":
        return None
    if text.startswith("[") and text.endswith("]"):
        inner = text[1:-1].strip()
        if not inner:
            return []
        return [parse_scalar(p) for p in _split_top_commas(inner)]
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    if re.match(r"^-?\d+$", text):
        return int(text)
    if text in ("true", "True"):
        return True
    if text in ("false", "False"):
        return False
    if text in ("~", "null", "Null"):
        return None
    return text


def _parse_block(lines, i, indent):
    """Parse a mapping or list block starting at lines[i] with given indent.
    Returns (value, next_index)."""
    if i >= len(lines):
        return None, i
    line_indent, content = lines[i]
    if line_indent < indent:
        return None, i
    if content.startswith("- ") or content == "-":
        items = []
        while i < len(lines):
            ind, cont = lines[i]
            if ind != indent or not (cont.startswith("- ") or cont == "-"):
                break
            after = cont[2:].strip()
            if after == "":
                value, i = _parse_block(lines, i + 1, indent + 2)
                items.append(value)
            elif re.match(r"^[^:\s][^:]*:(\s|$)", after):
                # Inline mapping start: `- key: value`, rest at indent+2.
                key, _, rest = after.partition(":")
                item = {key.strip(): parse_scalar(rest)}
                i += 1
                while i < len(lines) and lines[i][0] > indent:
                    sub_ind, sub = lines[i]
                    if re.match(r"^[^:\s][^:]*:(\s|$)", sub):
                        k, _, v = sub.partition(":")
                        v = v.strip()
                        if v == "":
                            nested, i = _parse_block(lines, i + 1, sub_ind + 2)
                            item[k.strip()] = nested
                        else:
                            item[k.strip()] = parse_scalar(v)
                            i += 1
                    else:
                        raise ValueError(f"line {i + 1}: unexpected content {sub!r}")
                items.append(item)
            else:
                items.append(parse_scalar(after))
                i += 1
        return items, i
    mapping = {}
    while i < len(lines):
        ind, cont = lines[i]
        if ind < indent or cont.startswith("- "):
            break
        if ind != indent:
            raise ValueError(f"line {i + 1}: bad indent {ind} (want {indent}): {cont!r}")
        if ":" not in cont:
            raise ValueError(f"line {i + 1}: expected `key: value`: {cont!r}")
        key, _, rest = cont.partition(":")
        key, rest = key.strip(), rest.strip()
        if rest == "":
            value, i = _parse_block(lines, i + 1, indent + 2)
            mapping[key] = value
        else:
            mapping[key] = parse_scalar(rest)
            i += 1
    return mapping, i


def parse_yaml_subset(text, source="<string>"):
    lines = []
    for raw in text.splitlines():
        stripped = _strip_comment(raw)
        if not stripped.strip():
            continue
        indent = len(stripped) - len(stripped.lstrip(" "))
        if "\t" in stripped[:indent]:
            raise ValueError(f"{source}: tabs are not allowed for indent")
        lines.append((indent, stripped.strip()))
    if not lines:
        return {}
    value, _ = _parse_block(lines, 0, lines[0][0])
    return value if value is not None else {}


def load_yaml_file(path):
    with open(path, encoding="utf-8") as f:
        return parse_yaml_subset(f.read(), source=path)


def find_user_outline(book_dir):
    """Return the user outline path, or None if this book has no submission."""
    for cand in (
        os.path.join(book_dir, "user_submission", "user_outline.yaml"),
        os.path.join(book_dir, "outline", "user_outline.yaml"),
    ):
        if os.path.exists(cand):
            return cand
    return None


def load_submission(book_dir):
    """Load all user-submission files for a book. Returns dict with keys
    outline / characters / threads (each None when its file is absent),
    plus the outline path (None when absent)."""
    out = {"outline_path": None, "outline": None, "characters": None,
           "threads": None}
    outline_path = find_user_outline(book_dir)
    if outline_path:
        out["outline_path"] = outline_path
        out["outline"] = load_yaml_file(outline_path)
    for key, fname in (
        ("characters", "user_characters.yaml"),
        ("threads", "user_foreshadowing.yaml"),
    ):
        for base in (os.path.join(book_dir, "user_submission"),
                     os.path.join(book_dir, "outline")):
            path = os.path.join(base, fname)
            if os.path.exists(path):
                out[key] = load_yaml_file(path)
                break
    return out


def outline_chapters(outline):
    chapters = (outline or {}).get("chapters") or []
    if not isinstance(chapters, list):
        raise ValueError("user_outline.yaml: `chapters` must be a list")
    return chapters


def thread_map(threads_doc):
    threads = (threads_doc or {}).get("threads") or []
    return {t.get("id"): t for t in threads if isinstance(t, dict)}


def character_names(characters_doc):
    chars = (characters_doc or {}).get("characters") or []
    names = set()
    aliases = {}
    for c in chars:
        if isinstance(c, dict) and c.get("name"):
            names.add(c["name"])
            for a in c.get("aliases") or []:
                aliases[a] = c["name"]
    return names, aliases


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


def split_list_field(value):
    """Parse a frontmatter list field: `[a, b]` or `a, b` or `-`."""
    value = (value or "").strip()
    if value in ("", "-", "[]"):
        return []
    if value.startswith("[") and value.endswith("]"):
        return [p.strip().strip("\"'") for p in _split_top_commas(value[1:-1])
                if p.strip()]
    return [p.strip() for p in value.split(",") if p.strip()]
