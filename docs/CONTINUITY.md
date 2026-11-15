# CONTINUITY — file-as-truth

## The model

A novel is a state machine. The state is the accumulated meaning of every
sentence so far. A language model writes from a sliding context window, so
earlier chapters become invisible and the model averages characters into a
generic impression. A bigger context window does not fix it — the fix is
state on disk, in files the agent re-reads every chapter.

## Two different things

- **The skill repo** (this repository): `SKILL.md`, `scripts/`, `templates/`,
  `docs/`, `data/`, `checklists/`. It contains no specific book.
- **A book project**: one folder per book, with exactly this layout:

```
my-book/
  bible/     canon.md, characters.md, world.md, rules.md, voice.md
  outline/   overview.md, volumes/, chapters.yaml
  state/     summary.md, character_state.md, foreshadowing.md, knows.md, progress.md, timeline.md
  chapters/  001.md, 002.md, ...
```

The skill repo never contains a book's canon; a book project never contains
the skill's code. The sample book in `examples/sample-book/` shows the layout
working end to end.

## What is truth, what is derived

- **Truth (hand-written, author-approved):** `bible/`, `outline/`, `chapters/`,
  and the state files after a CHAPTER_COMMIT.
- **Derived projections (never hand-edited):** summaries, indexes, search
  databases. If a projection disagrees with the truth files, the projection
  is regenerated — the truth is never edited to match a projection.

## The chapter loop (atomic commit)

1. Contract → 2. Draft → 3. Sub-review (scripts + checklist, evidence cited)
   → 4. Bounded revise (local patch, one re-audit, then flag) → 5. CHAPTER_COMMIT.
A commit writes prose + state together, or neither. There is no state where
"the prose is saved but the ledger was not updated", and no state where "the
ledger advanced but the prose was not saved".

## State rollback

If a chapter is revised after committing, roll its committed facts back first:
remove its summary lines, its ledger updates, its knows additions, any characters
first added in that chapter, and its timeline entries, then re-commit the revised
chapter. The ledger must never carry facts from a version of a chapter that no
longer exists.

## Dynamic cast growth & anti-nameless-NPC protocol (v2.0.0)

Long serials atrophy into solo-protagonist monologues when every new scene
defaults to the hero alone or relies on nameless placeholders (`黑衣人`, `神秘人`,
`路人`, `店小二`, `stranger`, `guard`). To prevent cast thinning without bloating
Step 1:

- **No fixed character cap (seed core cast first):** Step 1 establishes **3–5 core
  starting roles** rather than pre-generating dozens of unused background characters.
  Additional cast members are forged on demand as arcs expand.
- **Mid-story character forging & timely debut:** Any character forged mid-serial
  inherits the book's era, world rules, culture anchors, and narrator voice, adds a
  distinct `speech_style` and concrete `debut_plan` (how and around which chapter
  they cut into active threads), and receives initial `state/knows.md` boundaries.
- **Canon locking after debut:** Un-appeared characters remain freely editable (and
  removable) in `bible/characters.md` until they enter prose. Once a character
  appears in committed/drafted chapters, their canonical bio/DNA/origin is locked
  immutable to avoid retroactive retcons; ongoing development updates
  `state/character_state.md` and `state/knows.md` instead.
- Every serial chapter (`>= 2`) should bring in **2–4 named characters** with clear
  stakes, rotating existing cast alongside newly introduced allies/rivals.
- Whenever a chapter needs a witness, antagonist agent, or new ally, **forge a real
  named character** (full name, role, visual/behavioural DNA, want/flaw, and initial
  `knows` entry) via `new_characters` instead of a generic label.
- `CHAPTER_COMMIT` atomically registers `new_characters` into `bible/characters.md`
  and `state/knows.md`; `rollbackChapter` cleans them up if the chapter is rolled back.

## Overdue foreshadowing & anti-phantom-thread rule (v2.0.0)

- Ledger entries support four statuses: `open | progressing | paid | deferred`
  (with optional `target_chapter` when extended/deferred).
- Before drafting chapter N, inspect overdue and due-soon threads: pull them into
  the next chapter contract (`progressing` or `paid`) or explicitly reschedule them
  (`deferred` + `target_chapter`).
- **No phantom threads:** never reference an `Fxx` id in `foreshadowing_paid` unless
  that id already exists in `state/foreshadowing.md` (or is planted by the same chapter).

## What is loaded per chapter

Hard facts (`bible/`) + the chapter contract + the last 1–3 full chapters +
rolling summaries (chapter → arc → volume) + related chapters recommended by
four dimensions: foreshadowing, character appearance, status change,
relationship. Retrieval, not dumping: never load the whole book.

## Rolling horizon

Do not write a 500-chapter outline up front — it goes hollow. Keep a compass
(end direction + active long threads + scale estimate) + the first 2 volumes
in skeleton + the first arc in detail. Later arcs expand on demand from prior
summaries + character snapshots. Re-plan every arc, fork the plan every
30 chapters.
