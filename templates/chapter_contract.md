# Chapter Contract — Chapter NNN

Fill this in **before** writing any prose. No contract, no prose.
Copy this file to `outline/chapters/NNN.md` for the chapter, then write the
chapter file `chapters/NNN.md` with the same frontmatter fields.

```yaml
chapter: NNN
title: <chapter title>
language: zh            # zh | en
desire: curiosity       # one of: curiosity / identification-upgrade /
                        #   revenge-compensation / being-loved / escape-comfort
desire_payoff: <what this chapter actually delivers for that desire, in one sentence>
payoff_size: small      # small | big — chapters 3,6,9... must declare; 10,20,30... must be big
hook: <the end hook, in one sentence — the reason to read the next chapter>
transition: <how this chapter hands off to the next: what state, place, time and
             knowledge the next chapter starts from. Continuous = next chapter
             starts exactly where this one ends; cut = new subject/place/shot,
             already in motion, and at least one of subject/place/scale must change>
must_happen: <beats that must happen, in order>
must_not: <forbidden moves for this chapter>
characters: <names present, comma-separated — must all be in bible/characters.md>
foreshadowing_planted: <F-ids planted here, or ->
foreshadowing_paid: <F-ids paid off here, or ->
```

## Notes for the writer

- Load only: this contract + hard facts + the slices it names (last 1–3 full
  chapters, rolling summaries, related chapters by foreshadowing / character /
  status-change / relationship). Never dump the whole book.
- If the previous chapter ended on a hook, this contract must state how this
  chapter's opening resolves it. A `transition: cut` does not excuse dropping
  the previous hook — see SKILL.md hard rule 11.
- Hard constraints are restated here before writing (copy them from
  `bible/rules.md` — do not paraphrase them away).
- A character may guess, suspect or misread — never *know* what they were
  never told (see `state/knows.md`). To give them information, show how they
  got it in the prose.
- Chapter length: zh 2000–3000 characters; en 1500–2500 words.
  Probe/excerpt chapters may be shorter — say so in the contract.
