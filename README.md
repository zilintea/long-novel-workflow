# Long Novel Workflow

Write a long serialised novel chapter by chapter — without losing the plot,
the characters, or the foreshadowing — in Chinese or English.

- **What it is:** an Agent Skills open-standard skill (a `SKILL.md` + light
  Python scripts, no app, no server, no model account). One prompt starts a
  novel of any length: bible and outline first, golden 3 chapters first, then
  one chapter at a time.
- **The problem it solves:** a novel is a state machine. Earlier chapters fall
  out of context, so characters drift, rules get broken to save a scene, and
  foreshadowing is planted and never paid off. This skill keeps state in files,
  not in chat memory.
- **How:** file-as-truth (`bible/outline/state/chapters/`), a chapter contract
  with a `transition` handoff field, a foreshadowing ledger with payoff dates,
  per-character `knows` lists, hard-constraints-first prompting, and a blocking
  hook + desire audit per chapter. Only the wrong segment is redone, and a
  revision rolls its committed state back first.
- **Current version:** v2.0.0 (2026-11-15). MIT license.

> 中文版：[`README.zh-CN.md`](README.zh-CN.md)

---

## 30 seconds to start

### Step 1 — Install (once)

```bash
python3 scripts/install_skill.py --target muse        # Muse
python3 scripts/install_skill.py --target claude      # Claude Code
python3 scripts/install_skill.py --target codex       # Codex
python3 scripts/install_skill.py --target opencode    # OpenCode
python3 scripts/install_skill.py --target workbuddy   # WorkBuddy
python3 scripts/install_skill.py --target gpt --out ./gpt_instructions.md
```

Add `--dry-run` to print the destination without copying anything.
No host-specific hook is required.

### Step 2 — Say one sentence

```
Write a novel: rebirth revenge, identity suspense, strong relationship, Chinese, Fanqie
Continue my manuscript from chapter 21
Import my old draft and continue it
```

### Step 3 — Author-gated or Full-Auto per chapter

1. **Bible + outline** — world, characters, rules, voice (Gate 1).
2. **Golden 3 chapters** — chapters 1–3, read and diagnosed before bulk serialising (Gate 2).
3. **Each chapter** — contract → draft → sub-review → bounded revise → `CHAPTER_COMMIT`.
   Only a committed chapter's facts enter canon; newly introduced supporting characters
   (`new_characters`) are registered atomically into `bible/characters.md` and `state/knows.md`.

Supports both **Author-Gated** approval and **Full-Auto** chapter execution (without forcing
manual contract forms). Every chapter still passes the blocking audit before canon commit.

---

## Defaults (v2.0.0)

| Item | Default |
|---|---|
| Language | Chinese first; English is phase 2 (`data/languages/zh.yaml`, `en.yaml`) |
| Length | 120–180 chapter serial (unbounded long-form); 1–3 chapter short-story probe |
| Chapter length | zh 2000–4000 characters (hard range 800–4000); en 1500–2500 words |
| Pilot formula | Rebirth-revenge + identity-suspense + strong-relationship (title/names after market scan) |
| Primary platform | zh: Fanqie / Qimao; en: Royal Road (see `docs/TRAFFIC.md`) |
| Desire payoff | Every chapter pays off ≥1 of **8 desires** (`auto` supported); `payoff_size` defaults to `auto` (AI executes small ~3 / big ~10) |
| Cast & Continuity | Anti-nameless-NPC check, dynamic character registration, `open\|progressing\|paid\|deferred` foreshadowing, `第N章` title prefix |

The 8 desires: curiosity, identification-upgrade, revenge-compensation,
being-loved, escape-comfort, survival-breakout, power-scheme, bond-resonance.
See `docs/HOOKS_AND_DESIRE.md`.

## Launch skills (5, v2.0.0)

1. Market scan / deconstruction — what is actually being read, and why.
2. Packaging — title, cover brief, blurb, keywords.
3. Character forging — dossiers, arcs, knows lists, plus ongoing supporting cast growth.
4. Bilingual de-slop — Chinese + English AI-flavour lists (`data/slop/`).
5. Simple manuscript import — reverse-engineer an old draft into bible/outline/state.

Worldbuilding is a thin card by default, keeping focus on story momentum.

## Checks (run them — they are real, not stubs)

```bash
python3 scripts/check_chapter.py examples/sample-book
python3 scripts/check_continuity.py examples/sample-book
python3 scripts/check_hooks.py examples/sample-book
```

Each script prints PASS/FAIL per check with evidence, and exits non-zero on
any blocking failure. See `docs/EVALUATION.md` for the golden-3 gate and the
30-chapter continuity test, and how continuity-error rate is measured.

## Repository structure

```
SKILL.md                  # entry point (Agent Skills frontmatter, name = folder)
skill.yaml                # skill metadata
README.md / README.zh-CN.md
CHANGELOG.md  LICENSE     # MIT
scripts/                  # install_skill.py, check_chapter.py, check_continuity.py, check_hooks.py
templates/                # chapter contract, bible, outline, ledger, chapter
docs/                     # CONTINUITY, HOOKS_AND_DESIRE, BILINGUAL, TRAFFIC, EVALUATION, MODEL_ADAPTER
references/               # genre notes, desire-payoff examples
data/languages/           # zh.yaml, en.yaml
data/genres/              # fanqie_urban, fanqie_rebirth_revenge, royalroad_litrpg
data/slop/                # zh.yaml, en.yaml (de-slop lists)
checklists/               # chapter_audit.md, continuity_audit.md
examples/sample-book/     # complete small original sample project (bible/outline/state/chapters 001-003)
mcp-server/               # MCP server (stdio + streamable HTTP) — see mcp-server/README.md
```

The skill repo and a book project are separate: the skill lives in one folder,
each book is its own `bible/outline/state/chapters/` project. See `docs/CONTINUITY.md`.

## MCP server (WorkBuddy / Doubao)

`mcp-server/` is an MCP server for this skill (Node.js, no model calls):
it exposes the book state machine as 14 tools — list/get books and chapters,
draft contracts (with the blocking hook-handoff rule), save drafts, run the
deterministic audit, atomic commit / rollback, and the foreshadowing ledger —
over stdio (WorkBuddy, Claude, Cursor) and streamable HTTP
(Doubao desktop, `http://127.0.0.1:8765/mcp`). Books stay on your own
machine. One-line install:

```bash
cd mcp-server && npm install && npm test
```

See [`mcp-server/README.md`](mcp-server/README.md) for the exact client
configs and the host usage rules.

## Acknowledgements

Synthesised from public research (2026-11-13) on long-form writing systems —
file-as-truth, chapter contracts, foreshadowing ledgers, knows lists, bounded
audits — and from the gates of
[universal-story-workflow](https://github.com/zilintea/universal-story-workflow)
v3.10, translated from video to text. No code or text was copied from any
surveyed repository (several are AGPL/GPL); ideas only, original implementation.
