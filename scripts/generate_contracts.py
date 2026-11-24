#!/usr/bin/env python3
"""Generate chapter contracts from a user-submitted outline (v2.2.0, P0).
Stdlib only. Usage:
  python3 scripts/generate_contracts.py <book_dir> [--force]

Reads <book_dir>/user_submission/user_outline.yaml (validated first by
validate_submission.py — run that before this script) and writes one
contract per chapter to <book_dir>/outline/chapters/NNN.md.

Locked fields (source: user) are copied verbatim from the outline:
title, hook, desire, payoff_size, characters, foreshadowing_planted/paid,
must_happen beats. AI-fillable fields are left as explicit TODOs marked
source: ai-filled (transition, desire_payoff) — they must be filled before
prose, and the fill must be approved by the author.

Safety: never overwrites a contract whose chapter prose already exists in
chapters/NNN.md; never overwrites an existing contract unless --force is
given. Exit 0 on success, 1 when validation fails or nothing was generated.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import user_outline as uo  # noqa: E402
import beat_budget  # noqa: E402
from validate_submission import validate_book  # noqa: E402


def _yaml_str(value):
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        if not value:
            return "-"
        return "[" + ", ".join(str(v) for v in value) + "]"
    return str(value)


def contract_text(ch, prev_hook, language, target=None):
    num = ch["chapter"]
    beats = ch.get("must_happen") or []
    # One line, source: user, locked — matches the hand-written contracts'
    # `must_happen: ...` single-line style and keeps the yaml block valid.
    must_happen = "；".join(str(b.get("beat")) for b in beats) or "TODO (ai-filled)"
    budgets = beat_budget.compute_budgets(ch, language, target)
    beat_budgets = "[" + ", ".join(str(b) for b in budgets) + "]" if budgets else "-"
    hook_handoff = ""
    if prev_hook:
        hook_handoff = (
            f"\n- Hook 交接：第{num - 1}章钩子为“{prev_hook}”，本章开头须交代"
            "（兑现 / 延续 / 明确延期 + 兑现章）。transition 为切分不免除交接。"
        )
    return f"""# Chapter Contract — Chapter {num:03d}

```yaml
chapter: {num}
title: 第{num}章 {ch.get('title')}
language: {language}
desire: {ch.get('desire', 'auto')}
desire_payoff: TODO (ai-filled: what this chapter actually delivers for that desire, in one sentence)
payoff_size: {ch.get('payoff_size', 'auto')}
hook: {ch.get('hook')}
transition: TODO (ai-filled: how this chapter hands off to the next: state, place, time, knowledge)
must_happen: {must_happen}
beat_budgets: {beat_budgets}
must_not: 按 bible/rules.md；不改用户锁定字段；不提前兑现用户定在后面的伏笔
characters: {', '.join(ch.get('characters') or [])}
foreshadowing_planted: {_yaml_str(ch.get('foreshadowing_planted'))}
foreshadowing_paid: {_yaml_str(ch.get('foreshadowing_paid'))}
chapter_kind: main
big_cadence_snapshot:
is_probe: false
source: user
```

## Notes for the writer

- 来源：本章 title / hook / desire / payoff_size / characters /
  foreshadowing_planted / foreshadowing_paid / must_happen 均来自
  user_submission/user_outline.yaml（source: user，锁定），不得改动；
  transition / desire_payoff 为 source: ai-filled，须作者点头才进正史。
- 节拍预算：beat_budgets 与 must_happen 节拍一一对应（每条节拍的目标字数，
  未指定的节拍按章目标均分）。写之前先看预算：单条低于 200 字（英文 100 词）
  的节拍撑不起一场戏，须先扩写节拍再动笔。
- Hard constraints（bible/rules.md）先读再写。{hook_handoff}
"""


def main():
    args = sys.argv[1:]
    force = "--force" in args
    args = [a for a in args if a != "--force"]
    if len(args) != 1:
        print("usage: generate_contracts.py <book_dir> [--force]",
              file=sys.stderr)
        sys.exit(2)
    book_dir = args[0]
    failures, warnings = validate_book(book_dir)
    for w in warnings:
        print(f"WARN: {w}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        print("generate_contracts: REFUSED — validate_submission failed; "
              "fix the submission first")
        sys.exit(1)
    sub = uo.load_submission(book_dir)
    outline = sub["outline"]
    language = (outline.get("book") or {}).get("language", "zh")
    target = beat_budget.chapter_target(outline.get("book") or {}, language)
    chapters = uo.outline_chapters(outline)
    out_dir = os.path.join(book_dir, "outline", "chapters")
    os.makedirs(out_dir, exist_ok=True)
    generated, skipped = [], []
    prev_hook = None
    for ch in chapters:
        num = ch["chapter"]
        dest = os.path.join(out_dir, f"{num:03d}.md")
        prose = os.path.join(book_dir, "chapters", f"{num:03d}.md")
        if os.path.exists(prose):
            skipped.append(f"{num:03d} (prose already exists — never overwrite)")
        elif os.path.exists(dest) and not force:
            skipped.append(f"{num:03d} (contract exists — use --force to regenerate)")
        else:
            with open(dest, "w", encoding="utf-8") as f:
                f.write(contract_text(ch, prev_hook, language, target))
            generated.append(f"{num:03d}")
        prev_hook = (ch.get("hook") or "").strip()
    for g in generated:
        print(f"generated: outline/chapters/{g}.md")
    for s in skipped:
        print(f"skipped: {s}")
    if not generated and skipped:
        print("generate_contracts: nothing generated (all skipped)")
        sys.exit(0)
    print(f"generate_contracts: OK ({len(generated)} generated, "
          f"{len(skipped)} skipped)")
    sys.exit(0)


if __name__ == "__main__":
    main()
