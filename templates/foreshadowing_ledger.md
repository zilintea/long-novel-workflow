# Foreshadowing Ledger

One line per thread. Format is machine-readable — `scripts/check_continuity.py`
parses it. Keep this exact format:

`- F01 | planted: 1 | payoff_due: 5 | status: open | thread: <what was planted>`

- `status`: `open` | `progressing` | `paid` | `deferred` (deferred needs a new
  payoff_due and author approval — never silently drop a thread).
- Every planted thread needs a payoff chapter. Open threads unpaid after
  30 chapters are flagged by the checker.
- When a chapter pays a thread off, set status to `paid` in the same
  CHAPTER_COMMIT that commits the chapter — never in a separate edit.

## Threads

- F01 | planted: 1 | payoff_due: 5 | status: open | thread: <example: the locked drawer in the study>
