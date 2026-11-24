# HOOKS AND DESIRE — the 8 desires (v2.0.0)

Readers do not finish a chapter because the prose is beautiful. They finish
it because a desire was promised and then — partly — paid off, and a new
promise was made at the end. Every chapter must do both.

## The 8 desires (v2.0.0)

| # | Desire | What the reader wants | zh |
|---|---|---|---|
| 1 | curiosity | to know what happens / what is true | 好奇 |
| 2 | identification-upgrade | to become stronger, richer, freer with the hero | 代入升级 |
| 3 | revenge-compensation | to see the wrong righted, the humiliation repaid | 复仇补偿 |
| 4 | being-loved | to be chosen, wanted, protected — tension included | 被爱拉扯 |
| 5 | escape-comfort | to rest somewhere safe and warm for a while | 逃逸安慰 |
| 6 | survival-breakout | to break out of a desperate trap, pursuit, or lethal rule | 求生破局 |
| 7 | power-scheme | to outmanoeuvre rivals, flip leverage, and seize authority | 博弈掌权 |
| 8 | bond-resonance | to forge loyalty, shared conviction, or high-stakes rivalry | 羁绊共鸣 |

A chapter may serve more than one, and its contract either names **one primary**
desire or sets `desire: auto` (AI selects the best-fit desire from the 8 based on
the chapter's plot beat and arc rhythm) while stating in one sentence what the
chapter actually delivers (`desire_payoff`). A promise with no delivery in the
chapter is a broken promise; the reader notices by chapter 3.

## Payoff cadence (v2.1.0)

- **Default (`payoff_size: auto`):** AI dynamically chooses and executes the
  payoff intensity according to pacing:
- **Every chapter:** pays off ≥1 desire, at least partly.
- **Every 3 chapters:** a small payoff (a secret revealed, a rival humbled,
  a skill levelled up, a tactical escape). Explicit value: `payoff_size: small`.
  Required only for draft chapters, and relaxed when T < 10 or short-word mode.
- **Every big-cadence chapter:** a big payoff (an identity revealed, a revenge
  completed, a major power shift, a relationship turning point). Explicit value:
  `payoff_size: big`. The cadence is dynamic — `clamp(round_half_up(0.1T), 5, 20)`
  (T = target chapters; T < 30 skips big cadence; books without a target fall
  back to the legacy every-10). Committed chapters are checked against the
  `big_cadence_snapshot` recorded at commit time, so shrinking the target later
  never retroactively fails history.
- **Every chapter ends on a hook.** The hook is a blocking audit:
  `scripts/check_hooks.py` fails a chapter with no hook (`>= 10 chars`), no
  `desire_payoff`, or no `transition`. A chapter that ends flat has no reason to
  be read next.

## Hook types (pick at least one per chapter)

Reversal (what you believed is wrong), countdown (a deadline is now real),
new information (a fact that changes the last 3 chapters), identity (someone
is not who they said they were), choice (two good things, one must be lost),
threat (something the reader cares about is now in danger), arrival (the
thing that was promised is finally here — and it is not what was expected).

## What a hook is not

A hook is not a cliffhanger stapled on after the chapter is written. If the
chapter's last line could be deleted without changing anything, it is not a
hook — the contract's `hook` field must be the chapter's real end, designed
before the prose (see `templates/chapter_contract.md`).

## Desire ≠ genre

The 8 desires are language- and genre-independent. A LitRPG chapter pays
identification-upgrade with a level-up; a thriller pays survival-breakout with a
narrow escape; a court-intrigue chapter pays power-scheme with a faction flip;
a brotherhood or romance arc pays bond-resonance or being-loved. The genre pack
(`data/genres/`) says *how* a desire is paid on its platform; the desires
themselves remain universal.
