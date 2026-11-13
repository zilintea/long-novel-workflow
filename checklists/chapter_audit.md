# Chapter Audit (per chapter, blocking vs non-blocking)

Run `scripts/check_chapter.py`, `check_continuity.py` and `check_hooks.py`
first — this checklist is the human read on top of them. Every failing item
must cite chapter text.

## Blocking (any one fails the chapter)

- [ ] Canon: no fact contradicts `bible/` (age, place, rule, object, death).
- [ ] Character state + voice: the hero acts in character; dialogue voices
      do not collapse into each other; the arc moves, it does not reset.
- [ ] Timeline / causality: dates and cause-effect add up; cause never
      follows effect.
- [ ] Knowledge scope: no character acts on information they were never
      told (see `state/knows.md`). Guessing / suspecting / misreading is
      allowed; knowing is not.
- [ ] Foreshadowing: every thread planted or paid in this chapter is in
      `state/foreshadowing.md` with a payoff date; no thread is paid off
      without being planted.
- [ ] Hook + desire: the chapter pays off ≥1 desire and ends on a hook
      (`scripts/check_hooks.py`).
- [ ] Prose: no banned AI-flavour phrase (`data/slop/<lang>.yaml`).

## Non-blocking (fix if cheap, otherwise flag to the author)

- [ ] Pacing: the chapter dramatises its beats instead of summarising them.
- [ ] Chapter length inside the language range (see `data/languages/`).
- [ ] The `transition` to the next chapter is concrete (place, time, state),
      not "and then something happened".
