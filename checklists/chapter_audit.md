# Chapter Audit (per chapter, blocking vs non-blocking)

Run `scripts/check_chapter.py`, `check_continuity.py` and `check_hooks.py`
first — this checklist is the human read on top of them. Every failing item
must cite chapter text.

## Blocking (any one fails the chapter)

- [ ] Canon: no fact contradicts `bible/` (age, place, rule, object, death).
- [ ] Character state + voice + named cast: the hero acts in character; dialogue
      voices do not collapse into each other; no generic placeholder characters
      (`黑衣人`, `神秘人`, `路人`, `店小二`, `stranger`) are used — new roles
      must be forged with real names and registered via `new_characters`.
- [ ] Timeline / causality: dates and cause-effect add up; cause never
      follows effect.
- [ ] Knowledge scope: no character acts on information they were never
      told (see `state/knows.md`). Guessing / suspecting / misreading is
      allowed; knowing is not.
- [ ] Foreshadowing: every thread planted or paid in this chapter is in
      `state/foreshadowing.md` with a payoff date; no phantom thread is paid off
      without being planted; overdue threads are either resolved (`progressing`/`paid`)
      or explicitly rescheduled (`deferred` + `target_chapter`).
- [ ] Hook + desire: the chapter pays off ≥1 of the 8 desires (or `auto`) with
      a concrete `desire_payoff` and ends on a hook `>= 10` chars (`scripts/check_hooks.py`).
- [ ] Prose: no banned AI-flavour phrase (`data/slop/<lang>.yaml`).

## Non-blocking (fix if cheap, otherwise flag to the author)

- [ ] Pacing & cast richness: the chapter dramatises its beats instead of
      summarising them; chapters `>= 2` involve 2–4 named characters instead of
      a solo monologue.
- [ ] Chapter length inside the language range (`zh: 800–4000 chars`,
      `en: 600–3000 words`, see `data/languages/`).
- [ ] Title formatting: title carries canonical `第N章` / `Chapter N` prefix.
- [ ] The `transition` to the next chapter is concrete (place, time, state),
      not "and then something happened".
