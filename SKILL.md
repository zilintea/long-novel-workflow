---
name: long-novel-workflow
description: Write long serialised fiction chapter by chapter without losing continuity. Use when the user wants a novel of any length (a 120-180 chapter serial, a short-story probe, or an existing manuscript continued), in Chinese or English: first lock a bible, outline and chapter contract, then draft one chapter at a time, audit it, and only then commit its facts to the state files. File-as-truth, a foreshadowing ledger, per-character knows lists and a blocking hook/desire audit keep chapters consistent. Do not use for a one-off short story with no continuity need, or for video scripts (use universal-story-workflow for those).
license: MIT
compatibility: Works with any agent that can read SKILL.md and edit files (Claude Code, Codex, Muse, OpenCode, OpenClaw, WorkBuddy). Scripts need Python 3.9+ and use only the standard library; no network, no model account, no extra install.
metadata:
  version: 2.4.0
  author: zilintea
  language: zh, en
---

# Long Novel Workflow · SKILL (v2.4.0)

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

**User-Driven Mode (v2.2.0):** a third mode, alongside author-gated and full-auto.
The author submits their own organised data — brief, directory outline,
per-chapter data (`user_submission/user_outline.yaml`, plus `user_characters.yaml`
and `user_foreshadowing.yaml` when they have them) — and the AI creates the
book following the author's plan, not its own invention. See `docs/USER_DRIVEN.md`
and `templates/user_submission/README.md`. In this mode the market scan (Step 0)
is optional (the author has already fixed genre and title), the submission is
validated before any prose (`scripts/validate_submission.py`), contracts are
generated from the outline (`scripts/generate_contracts.py`), and every chapter
is checked for fidelity to the outline (`scripts/check_fidelity.py`) on top of
the three existing checks. User-supplied fields are locked (Hard rule 15).
v2.3.0 adds the restatement gate (Step 1.5: the AI restates the outline back,
with machine-detected gaps from `scripts/submission_gaps.py` sorted into
`must-ask` vs `ai-may-fill`, and the author confirms before work starts),
outline versioning (`scripts/snapshot_submission.py` +
`scripts/outline_diff.py` — every revision produces an impact list first),
and the contract check (`scripts/check_contract.py` — contract vs prose
frontmatter, plus the hook handoff, machine-checked; Hard rule 16).
v2.4.0 adds per-beat word budgets (`scripts/beat_budget.py` — every
must_happen beat gets a target length in the contract, so a chapter that
cannot fill its length is caught before drafting; Hard rule 17),
submission completeness levels L0–L4 (`scripts/submission_level.py` —
a one-liner, a rough outline, a detailed outline and chapter drafts each
have a different opening procedure), and MCP parity: the server exposes
submitUserOutline / validateSubmission / checkFidelity / checkContract /
getSubmissionLevel, runs the same Python scripts (one source of truth),
and its audit/commit path now also runs check_contract.py +
check_fidelity.py, which skip gracefully on books without contracts or
submissions.

## Parameters (user says it, otherwise the default)

| Parameter | Symbol | Default (v2.0.0) |
|---|---|---|
| Mode | — | `full-auto` (AI generates everything) or `author-gated` (AI proposes, author approves). `user-driven` (v2.2.0): the author submits brief + outline + chapter data and the AI follows it — see `docs/USER_DRIVEN.md`. Choose the mode in Step 0; user-driven skips the market scan. |
| Target language | LANG | Chinese first (`zh`); English (`en`) is phase 2. Read `data/languages/<LANG>.yaml`. |
| Book length | N | Target chapters, default **100** (presets 50/80/100/150/250/custom, or blank for open-ended serialisation); tolerance ±10 when T >= 50, else max(1, round_half_up(0.1T)). A short-story probe is 1–3 chapters, or a target-words goal (5000/10000/20000/custom). |
| Chapter length | L | zh: 2100–4000 characters/chapter (probe floor 800; short-word mode 1500); en: 1500–2500 words/chapter (probe floor 600). Above the max is a warning, never blocking. Per-beat budgets (v2.4.0): each must_happen beat gets a target length in the contract (`beat_budgets`, `scripts/beat_budget.py`); a beat below 200 chars (en 100 words) fails validation — it cannot carry a scene. |
| Genre formula (pilot) | — | Rebirth-revenge + identity-suspense + strong-relationship. Other genres live in `data/genres/`, never hard-coded here. |
| Platform (primary) | — | zh: Fanqie / Qimao; en: Royal Road. See `docs/TRAFFIC.md`. |
| Desire payoff | — | Every chapter pays off ≥1 of the **8 desires** (or `auto` for AI selection); `payoff_size` defaults to `auto` (AI executes small every ~3 chapters, big at every big-cadence chapter — dynamic: clamp(round_half_up(0.1T), 5, 20), T < 30 skips big cadence; committed chapters are checked against their `big_cadence_snapshot`). See `docs/HOOKS_AND_DESIRE.md`. |
| Ending plan | — | Compass carries `target_chapters` + `ending_summary` (one sentence, optional at start) + `planned_ending` (3 beats: climax, character fates, central-question answer — director-only, never fed to prose). Phases: setup / middle / convergence / finale window [T−tol, T+tol] — see `scripts/phase.py`. |

**Hard rules (v2.4.0):**
1. **Bible/outline first.** No prose before canon + outline + voice exist (Gate 1 — author-approved or generated in full-auto Step 1; in user-driven mode the outline comes from the author's submission, validated first — see rule 15).
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
13. **Ending plan & blind writing (v2.1.0).** The compass sets a target
    (default 100 chapters, floating ±tolerance — never a hard lock) and, when known,
    a one-sentence `ending_summary` + a 3-beat `planned_ending` (climax, character
    fates, central-question answer). The full ending is director-only: bible
    drafting and arc review may read it; chapter contracts see at most the
    one-sentence summary; prose writing sees neither — only the contract plus a
    one-line phase instruction (`scripts/phase.py`: setup / middle / convergence /
    finale window). Phases are computed from the in-volume chapter number, never
    guessed: L1 = clamp(round_half_up(0.25T), 10, 30), L2 = clamp(max(T−40,
    min(round_half_up(0.7T), T−25)), L1+1, winStart−1) for T ≥ 40 (short books
    T < 40 use the short branch; T ≤ 3 uses the discrete table). Rounding is
    always round_half_up = floor(x + 0.5) — never bare `round()` (JS and Python
    disagree on .5). A thread's `payoff_due` past T + tolerance is blocking;
    threads planted in the current chapter with `payoff_due` past T−5 warn
    (T ≥ 20 only); unclosed series/volume threads within 15 chapters of the end
    window warn, never block. `archived` threads are exempt; `episode`-scope
    threads do not count toward the end-of-book warning.
14. **Gate 3 is the completion audit (v2.1.0).** Nothing auto-completes. When the
    book enters its finale window and the core threads converge, the author may
    open the Gate 3 review (final-chapter overview, word/chapter counts, remaining
    open threads — archive in place or leave for a sequel). Only the author's
    explicit confirmation flips `book_status` to `completed`. After completion the
    main-line entries close; epilogue/extra chapters may still be written (they
    take the next disk chapter numbers, are exempt from phase/payoff/cadence
    checks, and do not count toward main progress); the book can be re-opened,
    and a sequel seed (JSON: surviving characters + unresolved threads) can be
    exported to start a new volume. Deleting the completed final chapter returns
    the book to `ongoing`.
15. **User-driven lock (v2.2.0).** In user-driven mode, fields the author supplied
    (`source: user`) are locked: chapter title, chapter order, must_happen beats,
    hook, character names, and foreshadowing payoff chapters. The AI may not
    change them, may not invent chapters or main threads outside the outline,
    and may not replan an arc marked `frozen: true` in `user_outline.yaml`.
    The AI fills only what the author left blank, marked `source: ai-filled`
    (transition, desire_payoff, secondary details), and the fill enters canon
    only after the author approves it. No prose before `validate_submission.py`
    passes; no commit before `check_fidelity.py` passes (see `docs/USER_DRIVEN.md`).
16. **Restatement gate, gap classes, versioning, contract check (v2.3.0).**
    In user-driven mode, after validation passes and before any prose, the AI
    restates the outline back to the author (Step 1.5,
    `templates/user_submission/restatement.md`) with the gaps from
    `scripts/submission_gaps.py`: `must-ask` gaps (a thin chapter, a main
    character with no want/flaw, a thread paid off-schedule, a contradiction)
    must be answered by the author — the AI may not guess them; `ai-may-fill`
    gaps (transition, desire_payoff, a blank tone/POV) the AI may fill and flag
    at review. An outline revision is versioned first
    (`scripts/snapshot_submission.py`) and diffed
    (`scripts/outline_diff.py`) — the impact list comes before any change, and
    affected committed prose is never auto-changed (the author decides keep /
    rewrite / roll back). A chapter's contract and its prose frontmatter must
    agree (`scripts/check_contract.py`): title, desire, payoff_size, hook,
    characters, foreshadowing, must_happen — and the next chapter's contract
    must state its hook handoff (Hard rule 11, machine-checked). No drafting
    from a contract whose transition or desire_payoff is still TODO.
17. **Per-beat word budgets and submission levels (v2.4.0).** Every
    must_happen beat carries a target length (`scripts/beat_budget.py`):
    explicit `budget:` in the outline, or the chapter target split evenly
    across the beats (zh target 3000 chars, en 2000 words; overridable per
    book with `book.chapter_target_chars` / `book.chapter_target_words`).
    A beat below 200 chars (en 100 words) fails validation — expand the
    beat or merge it before drafting. Run `scripts/submission_level.py`
    first: L0 nothing submitted, L1 one-liner (brief only — user-driven
    needs an outline), L2 rough outline (missing title/hook/beats/
    characters — ask the MUST-ASK gaps, do not write prose), L3 detailed
    outline (normal flow), L4 chapter drafts (review drafts against the
    outline; drafts enter canon only via CHAPTER_COMMIT).

## Book project layout (created by `init`, see below)

```
my-book/
  user_submission/  user_brief.md, user_outline.yaml, user_characters.yaml, user_foreshadowing.yaml
                    versions/ v1/, v2/, ... (snapshots of past submissions — never edited)
                    (user-driven mode only — the author's original submission, never edited by AI)
  bible/     canon.md, characters.md, world.md, rules.md, voice.md   (hard facts, read every chapter)
  outline/   overview.md, volumes/, chapters.yaml                   (3 levels)
  state/     summary.md, character_state.md, foreshadowing.md, knows.md, progress.md, timeline.md
  chapters/  001.md, 002.md, ...                                     (one file per chapter)
```

Only the slices a chapter needs are loaded: hard facts + last 1–3 full chapters +
rolling summaries + the related chapters the contract names (foreshadowing /
character / status-change / relationship). Never dump the whole book into context.

## Workflow (7 steps)

### Step 0 — Mode + market scan (launch skill: 扫榜)
Choose the mode first: `full-auto`, `author-gated`, or `user-driven`
(v2.2.0 — see `docs/USER_DRIVEN.md`). In user-driven mode the market scan is
optional and skipped by default: the author has already fixed genre, title and
characters in their submission, and the scan must not rename them.
Otherwise load the scan skill. Find what is actually being read on the target
platform (`docs/TRAFFIC.md`, `data/genres/`), pick a genre + hook + title
direction, and record the evidence. The pilot's title and character names are
decided **after** the scan — never hard-code fixed character names across books.

### Step 1 — Bible + outline (Gate 1)
In user-driven mode, receive the submission first: copy the author's files into
`user_submission/` untouched, run `scripts/submission_level.py` to pick the
opening procedure for the level (L0–L4, Hard rule 17), then run
`scripts/validate_submission.py` (it must PASS before any prose), then go to
Step 1.5 (restatement) before building anything —
`scripts/generate_contracts.py` derives the chapter contracts from
`user_outline.yaml`, it does not draft them freely (Hard rule 15).

### Step 1.5 — Understanding restatement (user-driven only, Gate 1.5)
After validation passes, the AI restates the outline back to the author using
`templates/user_submission/restatement.md`: what the outline says (one paragraph
per arc, one line per chapter), the gaps from `scripts/submission_gaps.py`
sorted into `must-ask` (answer before work starts — the AI may not guess) and
`ai-may-fill` (the AI fills now and flags at review), contradictions (two user
statements that cannot both be true), and info to confirm (rolling submission,
unused roster characters). The author picks one of: through / through after
filling the gaps / revise the outline (which goes through versioning first —
snapshot, then diff, then the impact list). No prose before the author confirms.
Otherwise build `bible/` (world, characters, rules, voice, hard constraints, culture anchors:
clothing / food / objects / landscape / colour — one concrete line each) and
`outline/` (compass + first arc in detail). Set the compass target (default 100
chapters; short books use a target-words goal instead) and, when known, a
one-sentence `ending_summary` + a 3-beat `planned_ending` (director-only,
`outline/overview.md` — never fed to prose). The ending may stay blank at first:
at the end of the setup phase (chapter L1) a gentle reminder appears, and by the
convergence phase (chapter L2) the ending must be set before writing continues.
An "AI draft ending" option can propose the 3 beats for the author to edit.
Author approves or full-auto commits before prose.

### Step 2 — Golden 3 chapters (Gate 2)
Write chapters 1–3 by the chapter-contract loop (Step 3), read them as a reader,
diagnose, fix the contract — not the prose alone — then continue the serial.

### Step 3 — Chapter loop (repeat; chapter audit per chapter)
1. **Contract:** fill `templates/chapter_contract.md` (with `第N章` title prefix, `desire: auto` or explicit 8-desire key, `payoff_size: auto|small|big`, overdue foreshadowing resolution plan, `transition`, and `hook_handoff`). The contract sees at most the one-sentence `ending_summary` plus the phase instruction (`scripts/phase.py`) — never the full `planned_ending`.
2. **Draft:** one writer owns all prose (voice consistency). Load only the contract
   + hard facts + needed slices. The prose prompt carries only the contract + the
   one-line phase instruction — it never sees `ending_summary` or `planned_ending`.
   Ensure supporting cast interacts meaningfully (no nameless NPCs).
3. **Sub-review:** a separate reviewer pass runs the checks (`scripts/check_chapter.py`,
   `check_continuity.py`, `check_hooks.py`, `scripts/check_contract.py`) + the 8-dimension audit in `checklists/chapter_audit.md`.
   In user-driven mode also run `scripts/check_fidelity.py` — it checks the chapter
   against the author's outline (title, hook, desire, characters, foreshadowing,
   must_happen beats by keyword) and blocks the commit on any mismatch.
   Evidence must cite the chapter text. Blocking vs non-blocking, as in the checklist.
4. **Revise (bounded):** local patch only, one re-audit, then flag.
5. **Commit:** `CHAPTER_COMMIT` writes new facts to `state/`
   (summary, character state, foreshadowing ledger, knows lists, timeline, and any `new_characters`).
   Then regenerate the projections. A commit is atomic: prose + state together, or neither.

### Step 4 — Arc review (every arc / every 30 chapters)
Re-plan the next arc from summaries + ledger + character snapshots. Fork the plan
every 30 chapters. Retire, escalate (`progressing`), reschedule (`deferred`), or pay off stale threads; never silently drop one.
In user-driven mode, never replan an arc marked `frozen: true` in
`user_outline.yaml` — only the author may change a frozen arc, by revising the
submission: snapshot the current version first
(`scripts/snapshot_submission.py`), then run `scripts/outline_diff.py` and
show the impact list (contracts to regenerate, committed prose affected,
threads moved) before any change is applied.
Arc review is one of the two steps allowed to read the full `planned_ending` (the
other is bible drafting) — it judges whether the current pace can still land the
ending on time. **Retargeting:** if the author shortens the target (or a short
book grows into a serial), first list every thread whose `payoff_due` falls
outside the new end window, then triage each one — compress into the window or
`archive` it (never silently keep it) — preview the change, save a restructure
snapshot, and only then save. Committed chapters are never rewritten by a retarget;
new chapters audit against the new big cadence from the next chapter on.

### Step 5 — Import an existing manuscript (launch skill: 简版旧稿导入)
Reverse-engineer existing chapters into bible/outline/state (like Oh Story's
`/story-import`), then continue at the next chapter. The import reconstructs canon
before any new chapter is written. Imported books leave the target blank
(open-ended serialisation) and prompt the author to fill it in afterwards.

### Step 6 — Gate 3: completion audit (entering the end window)
When the book enters its finale window [T−tol, T+tol] and the core threads
converge, the author may open the Gate 3 review: final-chapter overview,
word/chapter counts, remaining open threads (archive in place or leave for a
sequel). Only the author's explicit confirmation flips `book_status` to
`completed`. After completion: main-line writing and auto-serialisation close;
epilogue (`chapter_kind: epilogue`) and extra (`chapter_kind: extra`) chapters
may still be written (next disk numbers, exempt from phase/payoff/cadence
checks, not counted toward main progress); the book can be re-opened
(`ongoing`); a sequel seed JSON can be exported (surviving characters +
unresolved threads) to start the next volume. Auto-serialisation stops before
the final chapter and suggests Gate 3 instead of writing past the ending.

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
final reader. Ending-convergence checks (v2.1.0) run in the same audit:
`payoff_due` past T + tolerance is blocking; late plants and near-end unclosed
threads warn; `archived` threads are exempt; epilogue/extra chapters skip the
rhythm and size checks but still pass de-slop, secrecy and cross-chapter
de-duplication.

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
ideas only, original text and code. No `planned_ending` in a contract or prose
prompt — prose is written blind; no book auto-completes without the author's
explicit Gate 3 confirmation. In user-driven mode: no drafting from a contract
whose transition or desire_payoff is still TODO; no outline revision without a
snapshot and an impact list first; no guessing a `must-ask` gap.
