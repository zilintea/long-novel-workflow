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
remove its summary lines, its ledger updates, its knows additions and its
timeline entries, then re-commit the revised chapter. The ledger must never
carry facts from a version of a chapter that no longer exists.

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
