# HOOKS AND DESIRE — the 5 desires

Readers do not finish a chapter because the prose is beautiful. They finish
it because a desire was promised and then — partly — paid off, and a new
promise was made at the end. Every chapter must do both.

## The 5 desires (locked v1.0.0)

| # | Desire | What the reader wants | zh |
|---|---|---|---|
| 1 | curiosity | to know what happens / what is true | 好奇 |
| 2 | identification-upgrade | to become stronger, richer, freer with the hero | 代入升级 |
| 3 | revenge-compensation | to see the wrong righted, the humiliation repaid | 复仇补偿 |
| 4 | being-loved | to be chosen, wanted, protected — tension included | 被爱拉扯 |
| 5 | escape-comfort | to rest somewhere safe and warm for a while | 逃逸安慰 |

A chapter may serve more than one, but its contract names **one primary**
desire and says in one sentence what the chapter actually delivers for it
(`desire_payoff`). A promise with no delivery in the chapter is a broken
promise; the reader notices by chapter 3.

## Payoff cadence (locked)

- **Every chapter:** pays off ≥1 desire, at least partly.
- **Every 3 chapters:** a small payoff (a secret revealed, a rival humbled,
  a skill levelled up, a kiss almost happened). Contract field
  `payoff_size: small`.
- **Every 10 chapters:** a big payoff (an identity revealed, a revenge
  completed, a relationship turning point). Contract field `payoff_size: big`.
- **Every chapter ends on a hook.** The hook is a blocking audit:
  `scripts/check_hooks.py` fails a chapter with no hook, no desire payoff,
  or no `transition`. A chapter that ends flat has no reason to be read next.

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

The 5 desires are language- and genre-independent. A LitRPG chapter pays
identification-upgrade with a level-up; a romance chapter pays being-loved
with a near-confession; a revenge chapter pays revenge-compensation with a
public humiliation repaid. The genre pack (`data/genres/`) says *how* a
desire is paid on its platform; the desire itself never changes.
