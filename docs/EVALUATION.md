# EVALUATION — how to know the skill works

Scores are a floor, not a verdict. The author is the final reader. These
gates are the minimum evidence before claiming a book — or the skill — works.

## Gate 1 — Bible / outline

Author reads the bible and outline and approves. Fail if: the premise cannot
be said in one sentence; a main character has no want/flaw/arc; a hard
constraint is vague ("be consistent"); culture anchors are generic
("Chinese elements" with no concrete object).

## Gate 2 — Golden 3 chapters (the pilot gate)

Write chapters 1–3, then **read them as a reader** (do not audit them as an
editor first). Pass requires all of:

- Chapter 1 hooks in the first 500 words (zh) / 300 words (en) — conflict,
  reversal or a question the reader must answer, not worldbuilding.
- Each chapter pays off ≥1 desire and ends on a hook (scripts pass).
- A stranger can say who the hero is, what they want, and what will happen
  if they fail — after chapter 3.
- No continuity error in 3 chapters (scripts pass, checklist pass).

If Gate 2 fails, fix the **contract** (premise, desire, hook design) — not
just the prose — and re-run the 3 chapters.

## Gate 3 — 30-chapter continuity test

Write (or import) to chapter 30, then run all three scripts plus the
checklists. Measure:

- **Continuity-error rate** = (continuity errors found by audit) / (chapters
  checked). Count an error once per broken fact: a contradicted fact, a
  character knowing what they were never told, a timeline slip, an unpaid
  thread past its payoff date, a rule broken to save a scene.
- Report it as a number with the chapter range and the audit date, e.g.
  "2 errors / 30 chapters (2026-11-13)". Never report a rate without the
  range and the date. No published system in the 2026-11-13 research reports
  a measured rate on a long book — this skill does not invent one either.
- Pass bar for claiming "the skill holds continuity": 0 blocking errors in
  the 30-chapter test, and every open thread either paid or re-dated with
  author approval.

## Regression fixtures

`examples/sample-book/` is the permanent fixture: the three check scripts
must pass on it after every change to the skill. If a skill change breaks
the fixture, the change is wrong until the fixture (or the change) is fixed
deliberately and the CHANGELOG says so.

## What is NOT solved

No rubric score correlates strongly with real reader behaviour (one surveyed
study: under 2% of variance explained). "500 chapters" and "2M characters"
are architectural claims in other systems, not demonstrated outputs. This
skill claims only what its gates measure: the golden 3, the 30-chapter test,
and the author's own reading.
