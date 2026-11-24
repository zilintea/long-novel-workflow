# Foreshadowing Ledger

One line per thread. Format is machine-readable — `scripts/check_continuity.py`
parses it. Keep this exact format:

`- F01 | planted: 1 | payoff_due: 5 | status: open | scope: series | kind: reveal | thread: <what was planted>`

Optional progression fields when scheduling or deferring an overdue thread:
`- F01 | planted: 1 | payoff_due: 9 | status: progressing | target_chapter: 7 | thread: <what was planted>`

- `status`: `open` | `progressing` | `paid` | `deferred` | `archived`.
  `deferred` needs a new `payoff_due` > current chapter — never silently drop a
  thread. `archived` seals a thread (retargeting a shorter book, or a thread
  deliberately left for a sequel): archived threads are exempt from the stale,
  30-chapter and end-window checks.
- `scope`: `series` (whole book) | `volume` (this volume) | `episode`
  (single-episode arc — does not count toward the end-of-book convergence warning).
- `kind`: `reveal` | `conflict` | `relationship` | `other` (the commit step
  auto-labels new threads; `reveal` threads get a separate warning when compressed).
- Every planted thread needs a payoff chapter. Open threads unpaid after
  30 chapters are flagged by the checker.
- A thread's `payoff_due` must not pass the book's end window (target chapters
  + tolerance) — compress it into the window or archive it.
- Never fabricate or retroactively claim unplanted threads in prose or contracts.
- When a chapter pays a thread off, set status to `paid` in the same
  CHAPTER_COMMIT that commits the chapter — never in a separate edit.

## Threads

- F01 | planted: 1 | payoff_due: 5 | status: open | scope: series | kind: reveal | thread: <example: the locked drawer in the study>
