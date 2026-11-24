# Chapter Contract — Chapter NNN

Fill this in **before** writing any prose. No contract, no prose.
Copy this file to `outline/chapters/NNN.md` for the chapter, then write the
chapter file `chapters/NNN.md` with the same frontmatter fields.

```yaml
chapter: NNN
title: 第NNN章 <chapter title>
language: zh            # zh | en
desire: auto            # auto (AI picks best) | curiosity | identification-upgrade |
                        #   revenge-compensation | being-loved | escape-comfort |
                        #   survival-breakout | power-scheme | bond-resonance
desire_payoff: <what this chapter actually delivers for that desire, in one sentence>
payoff_size: auto       # auto | small | big — draft chapters at multiples of 3 resolve to small|big;
                        # chapters at multiples of the dynamic big cadence must be big
                        # (bigCadence = clamp(round_half_up(0.1T), 5, 20), T < 30 skips it;
                        # committed chapters are checked against big_cadence_snapshot)
hook: <the end hook, in one sentence — the reason to read the next chapter>
transition: <how this chapter hands off to the next: what state, place, time and
             knowledge the next chapter starts from. Continuous = next chapter
             starts exactly where this one ends; cut = new subject/place/shot,
             already in motion, and at least one of subject/place/scale must change>
must_happen: <beats that must happen, in order>
must_not: <forbidden moves for this chapter>
characters: <2-4 named characters present — avoid solo monologue or nameless placeholders;
             new named supporting roles are auto-registered in bible/characters.md on commit>
foreshadowing_planted: <F-ids planted here, or ->
foreshadowing_paid: <F-ids paid off here, or ->
chapter_kind: main      # main | epilogue | extra (epilogue/extra skip phase/payoff/cadence checks)
big_cadence_snapshot:   # filled at commit time; leave blank in drafts
is_probe: false         # true for probe/excerpt chapters (probe floor: zh 800 chars / en 600 words)
```

## Notes for the writer

- Load only: this contract + hard facts + the slices it names (last 1–3 full
  chapters, rolling summaries, related chapters by foreshadowing / character /
  status-change / relationship) + full cast roster for continuity recall.
- If the previous chapter ended on a hook, this contract must state how this
  chapter's opening resolves it. A `transition: cut` does not excuse dropping
  the previous hook — see SKILL.md hard rule 11.
- Hard constraints are restated here before writing (copy them from
  `bible/rules.md` — do not paraphrase them away).
- A character may guess, suspect or misread — never *know* what they were
  never told (see `state/knows.md`). To give them information, show how they
  got it in the prose.
- Chapter length: zh 2100–4000 characters (probe floor 800; short-word mode 1500);
  en 1500–2500 words (probe floor 600). Above the max is a warning, never blocking.
  Probe/excerpt chapters may be shorter — set `is_probe: true` in the contract.
