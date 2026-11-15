---
name: long-novel-workflow
description: Write long serialised fiction chapter by chapter without losing continuity. Use when the user wants a novel of any length (a 120-180 chapter serial, a short-story probe, or an existing manuscript continued), in Chinese or English: first lock a bible, outline and chapter contract, then draft one chapter at a time, audit it, and only then commit its facts to the state files. File-as-truth, a foreshadowing ledger, per-character knows lists and a blocking hook/desire audit keep chapters consistent. Do not use for a one-off short story with no continuity need, or for video scripts (use universal-story-workflow for those).
license: MIT
compatibility: Works with any agent that can read SKILL.md and edit files (Claude Code, Codex, Muse, OpenCode, OpenClaw, WorkBuddy). Scripts need Python 3.9+ and use only the standard library; no network, no model account, no extra install.
metadata:
  version: 2.0.0
  author: zilintea
  language: zh, en
---

# Long Novel Workflow · SKILL (v2.0.0)

**Positioning:** traffic-type serialised fiction, Chinese first, English second phase.
A novel is a state machine, not a chat. Earlier chapters fall out of context, so
state lives in files, never in chat memory. The skill is a **Skill + light scripts**,
not an app: a small kernel plus pluggable skills. The skill repo and a book project
are different things — see `docs/CONTINUITY.md`.

**Author control & Full-Auto Execution (v2.0.0):** the author is the director,
while full-auto authoring is supported end-to-end without forcing manual form-filling.
When running in author-gated mode, suggestions enter canon after approval (proposal-inbox model);
when running in full-auto mode, the workflow still builds bible/outline, chapter contract,
bounded 8-dimension audit, and atomic `CHAPTER_COMMIT` automatically. A chapter is never
"written" until its facts are committed; uncommitted drafts do not exist in canon.

## Parameters (user says it, otherwise the default)

| Parameter | Symbol | Default (v2.0.0) |
|---|---|---|
| Target language | LANG | Chinese first (`zh`); English (`en`) is phase 2. Read `data/languages/<LANG>.yaml`. |
| Book length | N | 120–180 chapters for a serial (scalable to any length, not capped at 1–3 chapters); a short-story probe is 1–3 chapters. |
| Chapter length | L | zh: 2000–4000 characters/chapter (hard range 800–4000); en: 1500–2500 words/chapter. Probe/excerpt chapters may be shorter — say so in the contract. |
| Genre formula (pilot) | — | Rebirth-revenge + identity-suspense + strong-relationship. Other genres live in `data/genres/`, never hard-coded here. |
| Platform (primary) | — | zh: Fanqie / Qimao; en: Royal Road. See `docs/TRAFFIC.md`. |
| Desire payoff | — | Every chapter pays off ≥1 of the **8 desires** (or `auto` for AI selection); `payoff_size` defaults to `auto` (AI executes small every ~3 chapters, big every 10). See `docs/HOOKS_AND_DESIRE.md`. |

**Hard rules (v2.0.0):**
1. **Bible/outline first.** No prose before canon + outline + voice exist (Gate 1 — author-approved or generated in full-auto Step 1).
2. **Golden 3 first.** Write and diagnose chapters 1–3 before bulk serialising (Gate 2). Do not bulk-generate unvalidated chapters, while allowing multi-chapter serial progression up to N chapters cleanly.
3. **Chapter contract before prose.** Every chapter has a contract (`templates/chapter_contract.md`):
   goal, must-happen beats, forbidden moves, characters present (2–4 named characters recommended),
   hook (end >=10 chars), `desire`/`payoff_size` (`auto` or concrete), and `transition`. No contract, no prose.
   Chapter titles automatically carry the canonical `第N章` / `Chapter N` prefix.
4. **Hook + desire payoff is a blocking audit.** A chapter with no end hook or no
   `desire_payoff` does not pass, however well written.
5. **Only redo the wrong segment.** Local patch + recheck, never a whole-chapter or
   whole-book rewrite for one failed check. Bounded re-audit: one revise → re-audit,
   then flag to the author. **State rollback:** if a chapter is revised, the facts
   it committed are rolled back first — including newly registered characters and threads.
6. **Hard constraints first.** `hard_constraints` are rendered first and restated
   immediately before writing. A scene may not break a rule to make itself work.
7. **Knows lists.** A character may guess, suspect or misread — never *know* what
   they were never told. To give them information, the prose must show how they got it.
8. **Foreshadowing ledger & anti-phantom rule.** Every planted thread has a planted
   chapter, a `payoff_due` chapter, and a status (`open | progressing | paid | deferred`).
   Overdue threads must be pulled into the next chapter (`progressing`/`paid`) or explicitly
   rescheduled (`deferred` + `target_chapter`). Open threads unpaid after 30 chapters fail audit.
   **Never invent phantom threads** (paying or advancing an `Fxx` ID not already in the ledger
   unless explicitly planted in that chapter).
9. **File-as-truth.** `bible/`, `outline/`, `state/`, `chapters/` on disk are the only
   truth. Summaries and indexes are derived projections — never hand-edited.
10. **Rolling horizon, not a 500-chapter outline.** Only the next arc is planned in
    detail; the far future keeps a direction (compass) + the foreshadowing ledger.
11. **Hook handoff (blocking).** The next chapter's contract must state how its
    opening resolves the previous chapter's end hook (paid off, carried, or
    explicitly deferred with a payoff chapter). A cut transition does not excuse
    dropping the previous hook.
12. **Dynamic cast, rolling forging & canon lock (v2.0.0).** Total cast size is
    unbounded: Step 1 seeds 3–5 core roles instead of pre-writing every future character,
    while mid-story forging (`人物锻造`) inherits world rules/culture anchors/voice and
    attaches a `speech_style` + `debut_plan` for natural story cut-in. Un-appeared profiles
    stay freely editable; once a character appears in prose, their canonical profile locks
    immutable while ongoing evolution updates `state/character_state.md` and `knows.md`.
    Serial chapters must never collapse into solo-protagonist monologues or generic
    placeholders (`黑衣人`, `神秘人`, `路人`, `店小二`, `stranger`); `CHAPTER_COMMIT`
    atomically registers `new_characters` and `rollbackChapter` cleans them up.

## Book project layout (created by `init`, see below)

```
my-book/
  bible/     canon.md, characters.md, world.md, rules.md, voice.md   (hard facts, read every chapter)
  outline/   overview.md, volumes/, chapters.yaml                   (3 levels)
  state/     summary.md, character_state.md, foreshadowing.md, knows.md, progress.md, timeline.md
  chapters/  001.md, 002.md, ...                                     (one file per chapter)
```

Only the slices a chapter needs are loaded: hard facts + last 1–3 full chapters +
rolling summaries + the related chapters the contract names (foreshadowing /
character / status-change / relationship). Never dump the whole book into context.

## Workflow (6 steps)

### Step 0 — Market scan (launch skill: 扫榜)
Load the scan skill. Find what is actually being read on the target platform
(`docs/TRAFFIC.md`, `data/genres/`), pick a genre + hook + title direction, and
record the evidence. The pilot's title and character names are decided **after**
the scan — never hard-code fixed character names across books.

### Step 1 — Bible + outline (Gate 1)
Build `bible/` (world, characters, rules, voice, hard constraints, culture anchors:
clothing / food / objects / landscape / colour — one concrete line each) and
`outline/` (compass + first arc in detail). Author approves or full-auto commits before prose.

### Step 2 — Golden 3 chapters (Gate 2)
Write chapters 1–3 by the chapter-contract loop (Step 3), read them as a reader,
diagnose, fix the contract — not the prose alone — then continue the serial.

### Step 3 — Chapter loop (repeat; Gate 3 per chapter)
1. **Contract:** fill `templates/chapter_contract.md` (with `第N章` title prefix, `desire: auto` or explicit 8-desire key, `payoff_size: auto|small|big`, overdue foreshadowing resolution plan, `transition`, and `hook_handoff`).
2. **Draft:** one writer owns all prose (voice consistency). Load only the contract
   + hard facts + needed slices. Ensure supporting cast interacts meaningfully (no nameless NPCs).
3. **Sub-review:** a separate reviewer pass runs the checks (`scripts/check_chapter.py`,
   `check_continuity.py`, `check_hooks.py`) + the 8-dimension audit in `checklists/chapter_audit.md`.
   Evidence must cite the chapter text. Blocking vs non-blocking, as in the checklist.
4. **Revise (bounded):** local patch only, one re-audit, then flag.
5. **Commit:** `CHAPTER_COMMIT` writes new facts to `state/`
   (summary, character state, foreshadowing ledger, knows lists, timeline, and any `new_characters`).
   Then regenerate the projections. A commit is atomic: prose + state together, or neither.

### Step 4 — Arc review (every arc / every 30 chapters)
Re-plan the next arc from summaries + ledger + character snapshots. Fork the plan
every 30 chapters. Retire, escalate (`progressing`), reschedule (`deferred`), or pay off stale threads; never silently drop one.

### Step 5 — Import an existing manuscript (launch skill: 简版旧稿导入)
Reverse-engineer existing chapters into bible/outline/state (like Oh Story's
`/story-import`), then continue at the next chapter. The import reconstructs canon
before any new chapter is written.

## Pluggable skills (v2.0.0 launch set: 5)
| # | Skill | Slot |
|---|---|---|
| 1 | 扫榜 market scan / deconstruction | Step 0 |
| 2 | 包装 packaging / cover brief | before Gate 2 (title, cover, blurb, keywords) |
| 3 | 人物锻造 character forging | Step 1 & ongoing Step 3 cast growth (`new_characters`, arcs, knows lists) |
| 4 | 双语去AI味 bilingual de-slop | Step 3 review (zh + en slop lists in `data/slop/`) |
| 5 | 简版旧稿导入 simple manuscript import | Step 5 |

Worldbuilding stays lightweight by default (a thin world card in `bible/world.md`).
A slot skill must obey three iron rules: (a) it reads/writes only through the chapter contract
and state files, never breaking `bible/rules.md`; (b) its output enters canon only via Gate approval
or `CHAPTER_COMMIT`; (c) it declares its language(s) and its genre/platform scope.

## Audit (8 dimensions, blocking vs non-blocking)
See `checklists/chapter_audit.md` and `docs/EVALUATION.md`: canon, character
state + voice + cast presence, timeline/causality, knowledge scope (knows),
foreshadowing payoff (no phantom threads, overdue resolution), hook + desire payoff
(**blocking**), pacing, prose (de-slop + up to 4000 zh chars). Every failing item
must cite chapter text. Scores are a floor, not a verdict — the author is the
final reader.

## Cost governance
Per-chapter token budget is a circuit breaker (default: stop and ask if a chapter
exceeds its budget — see `data/languages/<LANG>.yaml`). Stable material (rules,
bible) goes first for prefix-cache reuse; dynamic plot/state follows.

## Install
```bash
python3 scripts/install_skill.py --target muse --dry-run
python3 scripts/install_skill.py --target claude --dry-run
python3 scripts/install_skill.py --target codex --dry-run
python3 scripts/install_skill.py --target opencode --dry-run
python3 scripts/install_skill.py --target workbuddy --dry-run
python3 scripts/install_skill.py --target gpt --out ./gpt_instructions.md
```
See `docs/MODEL_ADAPTER.md`. No host-specific hook is required; hooks are optional.

## Prohibitions
No prose before Gate 1; no bulk chapters before Gate 2; no chapter without a
contract; no hook/desire_payoff-free chapter passing audit; no character knowing what
they were never told; no rule broken to save a scene; no foreshadowing planted
without a payoff date; no phantom foreshadowing paid without planting; no nameless
placeholder characters (`黑衣人`/`神秘人`/`路人`/`stranger`); no hard-coded reusable
character names across projects; no state edit without a CHAPTER_COMMIT; no whole-book
rewrite for one failed check; no AGPL/GPL code copied into this repo —
ideas only, original text and code.
