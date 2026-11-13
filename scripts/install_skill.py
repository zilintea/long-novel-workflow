#!/usr/bin/env python3
"""Install long-novel-workflow into different agents: copy the skill folder
or generate GPT Instructions. Stdlib only, no network.
Usage:
  python3 scripts/install_skill.py --target muse [--dry-run]
  python3 scripts/install_skill.py --target claude [--dry-run]
  python3 scripts/install_skill.py --target codex [--dry-run]
  python3 scripts/install_skill.py --target opencode [--dry-run]
  python3 scripts/install_skill.py --target workbuddy [--dry-run]
  python3 scripts/install_skill.py --target gpt --out ./gpt_instructions.md
"""
import argparse
import os
import shutil

TARGETS = {
    "muse": os.path.expanduser("~/workspace/custom-skills/long-novel-workflow"),
    "claude": os.path.expanduser("~/.claude/skills/long-novel-workflow"),
    "codex": os.path.expanduser("~/.codex/skills/long-novel-workflow"),
    "opencode": os.path.expanduser("~/.config/opencode/skills/long-novel-workflow"),
    "workbuddy": os.path.expanduser("~/workspace/custom-skills/long-novel-workflow"),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True,
                    choices=["muse", "claude", "codex", "opencode", "workbuddy", "gpt"])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default="./gpt_instructions.md")
    ap.add_argument("--src", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    args = ap.parse_args()
    if args.target == "gpt":
        skill = open(os.path.join(args.src, "SKILL.md"), encoding="utf-8").read()
        note = ("\n\n## GPT adaptation notes\n"
                "- This platform has no local script environment: scripts/*.py cannot run here. "
                "Use checklists/chapter_audit.md and checklists/continuity_audit.md as manual "
                "self-checks instead of script output.\n"
                "- Gates are unchanged: bible/outline approval, golden 3 chapters, per-chapter "
                "CHAPTER_COMMIT. Nothing enters canon without author approval.\n"
                "- Keep state in files (bible/outline/state/chapters/), never in chat memory.\n")
        out = "# Long Novel Workflow (GPT Instructions)\n\n" + skill + note
        if args.dry_run:
            print(f"GPT instructions would be written to {args.out} ({len(out)} chars)")
        else:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(out)
            print(f"Wrote {args.out} ({len(out)} chars)")
        return
    dest = TARGETS[args.target]
    if args.dry_run:
        print(f"Dry run: copy {args.src} -> {dest}")
        return
    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.copytree(args.src, dest,
                    ignore=shutil.ignore_patterns(".git", "__pycache__", "*.zip"))
    print(f"Installed to {dest}")


if __name__ == "__main__":
    main()
