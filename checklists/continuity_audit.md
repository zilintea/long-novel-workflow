# Continuity Audit (arc review / every 30 chapters)

Run `scripts/check_continuity.py` first — this checklist is the human read
on top of it.

- [ ] Every open foreshadowing thread has a `payoff_due` chapter, or is actively
      `progressing` / explicitly `deferred` with `target_chapter`. No thread is silently dropped.
- [ ] Open threads unpaid after 30 chapters are flagged and decided: pay,
      re-date (`deferred` + `target_chapter`), or cut with author approval.
- [ ] No phantom foreshadowing IDs appear in `foreshadowing_paid` without prior planting.
- [ ] Every character's knows list matches what the chapters actually showed
      them learning (see `state/knows.md`), including newly forged supporting cast.
- [ ] Cast richness: chapters `>= 2` do not collapse into solo protagonist
      monologues or nameless placeholders (`黑衣人`, `神秘人`, `路人`, `stranger`).
- [ ] Character arcs move in one direction per arc — growth does not reset
      between arcs without a reason written in the prose.
- [ ] Timeline: re-check dates, seasons, ages and travel times across the arc.
- [ ] World rules: no rule was broken to save a scene. If a scene needed a
      broken rule, the rule (not the scene) was changed, in `bible/rules.md`,
      with author approval.
- [ ] Rolling summaries match the chapters they summarise. If a summary
      disagrees with a chapter, regenerate the summary — never edit the
      chapter to match a summary.
- [ ] Next arc re-planned from summaries + ledger + character snapshots
      (rolling horizon — see `docs/CONTINUITY.md`).
