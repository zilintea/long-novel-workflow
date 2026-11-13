---
name: long-novel-workflow
description: Write long serialised fiction chapter by chapter without losing continuity. Use when the user wants a novel of any length (a 120-180 chapter serial, a short-story probe, or an existing manuscript continued), in Chinese or English: first lock a bible, outline and chapter contract, then draft one chapter at a time, audit it, and only then commit its facts to the state files. File-as-truth, a foreshadowing ledger, per-character knows lists and a blocking hook/desire audit keep chapters consistent. Do not use for a one-off short story with no continuity need, or for video scripts (use universal-story-workflow for those).
license: MIT
compatibility: Works with any agent that can read SKILL.md and edit files (Claude Code, Codex, Muse, OpenCode, OpenClaw, WorkBuddy). Scripts need Python 3.9+ and use only the standard library; no network, no model account, no extra install.
metadata:
  version: 1.0.0
  author: zilintea
  language: zh, en
---

# Long Novel Workflow · SKILL (v1.0.0)

**Positioning:** traffic-type serialised fiction, Chinese first, English second phase.
A novel is a state machine, not a chat. Earlier chapters fall out of context, so
state lives in files, never in chat memory. The skill is a **Skill + light scripts**,
not an app: a small kernel plus pluggable skills. The skill repo and a book project
are different things — see `docs/CONTINUITY.md`.

**Author control (hard rule):** the author is the director. No suggestion, draft or
state change enters canon without author approval (proposal-inbox model). A chapter
is not "written" until its facts are committed; a draft that is not committed does
not exist in canon.

## Parameters (user says it, otherwise the default)

| Parameter | Symbol | Default (v1.0.0 locked) |
|---|---|---|
| Target language | LANG | Chinese first (`zh`); English (`en`) is phase 2. Read `data/languages/<LANG>.yaml`. |
| Book length | N | 120–180 chapters for a serial; a short-story probe is 1–3 chapters. N is a parameter, not a promise. |
| Chapter length | L | zh: 2000–3000 characters/chapter; en: 1500–2500 words/chapter. Probe/excerpt chapters may be shorter — say so in the contract. |
| Genre formula (pilot) | — | Rebirth-revenge + identity-suspense + strong-relationship. Other genres live in `data/genres/`, never hard-coded here. |
| Platform (primary) | — | zh: Fanqie / Qimao; en: Royal Road. See `docs/TRAFFIC.md`. |
| Desire payoff | — | Every chapter pays off ≥1 of the 5 desires; small payoff every 3 chapters, big payoff every 10. See `docs/HOOKS_AND_DESIRE.md`. |

**Hard rules (v1.0.0):**
1. **Bible/outline first.** No prose before canon + outline + voice are approved (Gate 1).
2. **Golden 3 first.** Write chapters 1–3, read them, diagnose, then commit to the serial (Gate 2). Do not bulk-generate unvalidated chapters.
3. **Chapter contract before prose.** Every chapter has a contract (`templates/chapter_contract.md`):
   goal, must-happen beats, forbidden moves, characters present, hook (end),
   `transition` = how this chapter hands off to the next. No contract, no prose.
4. **Hook + desire payoff is a blocking audit.** A chapter with no end hook or no
   desire payoff does not pass, however well written.
5. **Only redo the wrong segment.** Local patch + recheck, never a whole-chapter or
   whole-book rewrite for one failed check. Bounded re-audit: one revise → re-audit,
   then flag to the author. **State rollback:** if a chapter is revised, the facts
   it committed are rolled back first — the ledger must never carry wrong facts.
6. **Hard constraints first.** `hard_constraints` are rendered first and restated
   immediately before writing. A scene may not break a rule to make itself work.
7. **Knows lists.** A character may guess, suspect or misread — never *know* what
   they were never told. To give them information, the prose must show how they got it.
8. **Foreshadowing ledger.** Every planted thread has a planted chapter, a payoff
   chapter and a status. Open threads unpaid after 30 chapters are flagged.
9. **File-as-truth.** `bible/`, `outline/`, `state/`, `chapters/` on disk are the only
   truth. Summaries and indexes are derived projections — never hand-edited.
10. **Rolling horizon, not a 500-chapter outline.** Only the next arc is planned in
    detail; the far future keeps a direction (compass) + the foreshadowing ledger.

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
the scan — never invent a "real" book before it.

### Step 1 — Bible + outline (Gate 1: author approves)
Build `bible/` (world, characters, rules, voice, hard constraints, culture anchors:
clothing / food / objects / landscape / colour — one concrete line each) and
`outline/` (compass + first arc in detail). Author approves before any prose.

### Step 2 — Golden 3 chapters (Gate 2: author reads)
Write chapters 1–3 by the chapter-contract loop (Step 3), read them as a reader,
diagnose, fix the contract — not the prose alone — then decide whether to continue.

### Step 3 — Chapter loop (repeat; Gate 3 per chapter)
1. **Contract:** fill `templates/chapter_contract.md` (incl. `transition` to the next chapter).
2. **Draft:** one writer owns all prose (voice consistency). Load only the contract
   + hard facts + needed slices.
3. **Sub-review:** a separate reviewer pass runs the checks (`scripts/check_chapter.py`,
   `check_continuity.py`, `check_hooks.py`) + the audit in `checklists/chapter_audit.md`.
   Evidence must cite the chapter text. Blocking vs non-blocking, as in the checklist.
4. **Revise (bounded):** local patch only, one re-audit, then flag.
5. **Commit:** only an accepted `CHAPTER_COMMIT` writes new facts to `state/`
   (summary, character state, foreshadowing ledger, knows lists, timeline).
   Then regenerate the projections. A commit is atomic: prose + state together, or neither.

### Step 4 — Arc review (every arc / every 30 chapters)
Re-plan the next arc from summaries + ledger + character snapshots. Fork the plan
every 30 chapters. Retire or pay off stale threads; never silently drop one.

### Step 5 — Import an existing manuscript (launch skill: 简版旧稿导入)
Reverse-engineer existing chapters into bible/outline/state (like Oh Story's
`/story-import`), then continue at the next chapter. The import is a proposal —
the author approves the reconstructed canon before any new chapter is written.

## Pluggable skills (v1.0.0 launch set: 5)
| # | Skill | Slot |
|---|---|---|
| 1 | 扫榜 market scan / deconstruction | Step 0 |
| 2 | 包装 packaging / cover brief | before Gate 2 (title, cover, blurb, keywords) |
| 3 | 人物锻造 character forging | Step 1 (dossiers, arcs, knows lists) |
| 4 | 双语去AI味 bilingual de-slop | Step 3 review (zh + en slop lists in `data/slop/`) |
| 5 | 简版旧稿导入 simple manuscript import | Step 5 |

Worldbuilding is **downgraded for v1.0** (a thin world card, not a full system).
Later slots (v1.1+): worldbuilding, dialogue doctor, reader panel, audio adaptation,
bilingual adaptation. A slot skill must obey three iron rules: (a) it reads/writes
only through the chapter contract and state files, never directly into canon;
(b) its output is a proposal until the author approves it; (c) it declares its
language(s) and its genre/platform scope.

## Audit (8 dimensions, blocking vs non-blocking)
See `checklists/chapter_audit.md` and `docs/EVALUATION.md`: canon, character
state + voice, timeline/causality, knowledge scope (knows), foreshadowing payoff,
hook + desire payoff (**blocking**), pacing, prose (de-slop). Every failing item
must cite chapter text. Scores are a floor, not a verdict — the author is the
final reader.

## Cost governance
Per-chapter token budget is a circuit breaker (default: stop and ask if a chapter
exceeds its budget — see `data/languages/<LANG>.yaml`). Stable material (rules,
bible) goes first for prefix-cache reuse; dynamic plot/state follows. Report cost
before bulk writing; never bulk-write unvalidated chapters.

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
contract; no hook/desire-free chapter passing audit; no character knowing what
they were never told; no rule broken to save a scene; no foreshadowing planted
without a payoff date; no state edit without a CHAPTER_COMMIT; no whole-book
rewrite for one failed check; no copying an existing novel, character or plot;
no brand style words in prompts; no AGPL/GPL code copied into this repo —
ideas only, original text and code.
