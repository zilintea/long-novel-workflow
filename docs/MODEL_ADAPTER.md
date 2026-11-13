# MODEL ADAPTER — install targets

The workflow, the audit tables and the state files are model-independent.
Only the install location and the call format change per host. No
host-specific hook is required; hooks are optional everywhere.

## Install

```bash
python3 scripts/install_skill.py --target muse --dry-run
python3 scripts/install_skill.py --target claude --dry-run
python3 scripts/install_skill.py --target codex --dry-run
python3 scripts/install_skill.py --target opencode --dry-run
python3 scripts/install_skill.py --target workbuddy --dry-run
python3 scripts/install_skill.py --target gpt --out ./gpt_instructions.md
```

| Target | Destination |
|---|---|
| muse | `~/workspace/custom-skills/long-novel-workflow` |
| claude | `~/.claude/skills/long-novel-workflow` |
| codex | `~/.codex/skills/long-novel-workflow` |
| opencode | `~/.config/opencode/skills/long-novel-workflow` |
| workbuddy | hand the repo to WorkBuddy; it executes SKILL.md itself |
| gpt | a generated Instructions file (`--out`); scripts cannot run there, so the checklists in `checklists/` are used as manual self-checks instead of script output |

## Skill format

`SKILL.md` follows the Agent Skills open standard (agentskills.io):
YAML frontmatter on line 1 with `name` (must match the folder name,
lowercase letters, numbers and hyphens, ≤64 characters), `description`
(≤1024 characters, what the skill does **and** when to use it), plus
`license`, `compatibility` and `metadata`. Only the frontmatter is always
in context; the body loads when the skill triggers, and `docs/`,
`references/`, `scripts/` and `data/` load only when needed (progressive
disclosure). Keep `SKILL.md` lean (<~250 lines); put detail in `docs/`.

## Cost

Scripts use only the Python standard library. No network calls, no model
account, no extra install. The per-chapter token budget (see
`data/languages/<LANG>.yaml`) is a circuit breaker: stop and ask the author
if a chapter exceeds it. Report cost before bulk writing; never bulk-write
unvalidated chapters.
