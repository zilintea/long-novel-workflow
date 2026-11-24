# CHANGELOG

## 2026-11-24 — v2.4.0: user-driven mode P2 (beat budgets, submission levels, MCP parity) — pushed 2026-11-24
- Per-beat word budgets: `scripts/beat_budget.py` gives every must_happen
  beat a target length (explicit `budget:` in user_outline.yaml, or the
  chapter target — zh 3000 chars / en 2000 words, overridable per book —
  split evenly). `validate_submission.py` fails a beat below 200 chars
  (en 100 words) and warns when the budgets sum outside the chapter
  length range. `generate_contracts.py` writes the budgets into the
  contract as `beat_budgets:` (aligned with must_happen), so a chapter
  that cannot fill its length is caught before drafting.
- Submission completeness levels: `scripts/submission_level.py` classifies
  L0 nothing submitted, L1 one-liner (brief only), L2 rough outline
  (chapters missing title/hook/beats/characters), L3 detailed outline,
  L4 chapter drafts (L3 + drafts/ files) — each with its own opening
  procedure (Hard rule 17). It is a classifier, exit 0, not an audit.
- MCP parity: the server exposes submitUserOutline (structured JSON in,
  restricted YAML out via src/userSubmission.js), validateSubmission,
  checkFidelity, checkContract and getSubmissionLevel — all run the same
  repo Python scripts (one source of truth). The audit/commit path
  (audit.js) now also runs check_contract.py + check_fidelity.py, which
  skip gracefully on books without contracts or submissions. Smoke test
  grows to 49 checks, including a submit/validate/fidelity/contract
  round-trip on the mini-book fixture and a too-short-hook negative.
- Also fixed: check_contract.py now accepts the older whole-file `---`
  frontmatter contract shape (MCP mini-book fixture) as well as ```yaml
  blocks, accepts a `hook_handoff:` field as the hook handoff, and
  recognises Chinese-numeral chapter references (第一章).

## 2026-11-24 — v2.3.0: user-driven mode P1 (restatement, versioning, contract check) — pushed 2026-11-24
- Step 1.5 restatement gate: after validation passes, the AI restates the
  outline back to the author (`templates/user_submission/restatement.md`) and
  the author confirms before any prose. `scripts/submission_gaps.py` lists
  the machine-detectable gaps and contradictions, sorted into MUST-ASK
  (thin chapter, main character with no want/flaw, off-schedule payoff,
  alias/arc contradictions — the AI may not guess) and AI-MAY-FILL
  (transition, desire_payoff, blank tone/POV), plus INFO to confirm.
- Outline versioning: `scripts/snapshot_submission.py` snapshots the current
  submission into user_submission/versions/<version>/ (untouched, never
  overwritten without --force); `scripts/outline_diff.py` diffs a snapshot
  against the live outline and prints an impact list (contracts to regenerate
  including the next chapter's hook handoff, threads moved, characters
  added/removed) plus DECISION NEEDED lines (committed prose affected —
  never auto-changed; frozen arcs changed — explicit confirmation only).
- `scripts/check_contract.py` machine-checks Hard rules 3 and 11: prose
  without a contract fails; contract vs prose frontmatter must agree (title,
  desire, payoff_size, hook, characters, foreshadowing, must_happen); a
  contract whose transition/desire_payoff is still TODO fails once prose
  exists (warns before that); chapter N >= 2 needs a "Hook 交接" referencing
  chapter N-1. Books with no contracts at all skip gracefully (legacy).
- Also fixed: generate_contracts.py now writes "第N章" without spaces in the
  hook-handoff note, so check_contract.py matches it.
- P2 from docs/EVAL-user-driven-mode.md (MCP parity, beat word budgets) is
  NOT in this release.

## 2026-11-24 — v2.2.0: user-driven mode (user submission) — pushed 2026-11-24
- New third mode: user-driven. The author submits brief + outline + chapter
  data (`user_submission/user_outline.yaml`, plus `user_characters.yaml` and
  `user_foreshadowing.yaml`) and the AI creates the book following the author's
  plan. Step 0 picks the mode; user-driven skips the market scan.
- New templates: `templates/user_submission/` — `user_brief.md`,
  `user_outline.yaml`, `user_characters.yaml`, `user_foreshadowing.yaml`,
  `README.md` (four completeness levels: one-liner / rough outline /
  detailed outline / chapter drafts).
- New scripts (stdlib only, no PyYAML — a restricted-YAML parser lives in
  `scripts/user_outline.py`): `validate_submission.py` (chapter numbers
  consecutive, hook >= 10 chars, must_happen beats with keywords, characters
  2-4 and defined, foreshadowing registered before use, frozen arc ranges),
  `generate_contracts.py` (contracts derived from the outline, locked fields
  copied verbatim, AI-fillable fields as TODOs marked source: ai-filled,
  never overwrites existing prose), `check_fidelity.py` (title, hook, desire,
  characters, foreshadowing, must_happen keywords in prose, no invented
  chapters, no early payoff). All three skip gracefully (PASS + note) on books
  without a submission, so full-auto / author-gated books are unaffected.
- New hard rule 15 (user-driven lock): user-supplied fields (source: user)
  are locked; frozen arcs are not replanned; no prose before validation passes,
  no commit before fidelity passes. New doc: `docs/USER_DRIVEN.md`.
- P1/P2 from docs/EVAL-user-driven-mode.md (understanding restatement,
  must-ask vs ai-may-fill, outline versioning + impact list, check_contract.py,
  MCP parity) are NOT in this release.

## 2026-11-16 — v2.1.0: ending planning (target + blind writing + Gate 3) — pushed 2026-11-24
- Compass gains a target (default 100 chapters, presets 50/80/100/150/250/custom/blank,
  tolerance ±10 when T >= 50 else max(1, round_half_up(0.1T))), a one-sentence
  `ending_summary`, and a director-only 3-beat `planned_ending` (climax, character
  fates, central-question answer) in `outline/overview.md` under
  `## Planned ending (director-only)`. Short books use a target-words goal
  (5000/10000/20000/custom); T <= 3 uses the discrete phase table.
- Blind-writing layers: bible drafting and arc review may read the full ending;
  contracts see at most the one-sentence summary + phase info; prose sees neither —
  only the contract + a one-line phase instruction. Save-quota single-request
  merging is an explicit opt-in. Phases (setup/middle/convergence/finale window)
  come from `scripts/phase.py` (ported 1:1 from the studio's `src/shared/phase.ts`;
  round_half_up = floor(x + 0.5) everywhere — JS and Python disagree on bare round(.5)).
- Audit (same rules in the TS audit engine and the Python check scripts):
  dynamic bigCadence = clamp(round_half_up(0.1T), 5, 20), T < 30 skips it,
  no-target books keep the legacy %10; committed chapters check against their
  `big_cadence_snapshot`; %3 small-payoff only for drafts, relaxed when T < 10 or
  short mode. Word floors: zh main 2100 (probe 800, short-word mode 1500),
  en main 1500 (probe 600); over-max is a warning, never blocking.
  Foreshadowing: `payoff_due` past T + tolerance is blocking; late plants
  (payoff_due past T-5, T >= 20) and near-end unclosed series/volume threads
  warn only; new `archived` status and `scope`/`kind` fields (`episode` threads
  skip the end-of-book warning). Epilogue/extra chapters (`chapter_kind`) are
  exempt from phase/payoff/cadence/size checks.
- Gate 3 (completion audit): nothing auto-completes. Entering the finale window
  opens the review (final-chapter overview, counts, remaining threads to archive
  or leave for a sequel); only the author's confirmation flips `book_status` to
  `completed`. After completion: main-line entries close, epilogue/extra may still
  be written, the book can be re-opened, and a sequel seed JSON can be exported.
  Retargeting a shorter book lists over-window threads first, triages each
  (compress into the window or archive), previews, snapshots, then saves.
- Fixed during this sync: two studio calls passed the target as the 2nd argument
  of `getPhaseInfo` (volumeStartChapter), silently computing the wrong book —
  Gate 3 entry and the auto-serialise end-window stop never fired. Fixed + a
  regression guard in `tools/test-phase.ts`.
- Verified: TS tsc 0 errors, studio regression (a)–(m) 33/33, phase table
  T=1..300; Python `scripts/test_phase.py` all pass; JS↔Python cross-check
  ALL MATCH (863 chapter rows at T=1,2,3,10,39,40,45,49,50,100,150,300 +
  extreme tolerances); check_hooks/check_continuity/check_chapter exercised
  end-to-end on synthetic new-style (T=50) and old-style (no target) books.

## 2026-11-16 — regenerate-middle-chapter fix (after v2.0.0, main only, not pushed yet)
- Bug: regenerating a middle chapter (“AI 按合同写正文” on a chapter with
  later chapters already written) left the story disconnected from the
  chapters around it. Root cause: the write prompts are backward-only —
  they feed the previous 2 chapters' full prose and the last 6 summaries,
  but nothing about the NEXT chapter. A regenerated middle chapter could
  end anywhere and change facts the next chapter already relies on.
- Fix: both write prompts (write-chapter + auto-chapter-bundle, studio
  museService.ts and MCP geminiService.ts) now carry a “后章衔接” block
  whenever a next chapter exists: the next chapter's transition, mustHappen,
  summary, and the first 600 characters of its (fixed) prose, plus the rule
  that the new ending must land on the next chapter's opening — same time,
  place, people and state — without changing anything the next chapter
  already fixed or writing its scenes early. The deterministic audit's
  cross-chapter check now also compares against the next chapter, so a
  regenerated middle chapter that replays the next chapter's prose is
  blocked the same way a replay of a previous chapter is.
- Verified in the studio: tsc 0 errors, regression 15/15 (incl. 3 new
  cases: forward block present for a middle chapter, absent for the latest
  chapter, replay of the next chapter blocked). Skill rules unchanged;
  version stays 2.0.0.

## 2026-11-16 — anti-repeat fix (after v2.0.0, main only, not pushed yet)
- Bug: two adjacent chapters occasionally repeated large amounts of content.
  Root cause: both write prompts fed the full prose of the previous 2 chapters
  as “参考原文” with no instruction on how to use it, so the model sometimes
  re-played the previous chapter's scenes instead of continuing after them
  (same failure seen 2026-11-13: ch2 repeated ch1's dialogue verbatim).
  The deterministic audit had no cross-chapter check, so a replay passed
  audit and was committed into canon.
- Fix (three layers): (1) a “防重写铁律” guard in both write prompts
  (write-chapter + auto-chapter-bundle, in the studio's museService.ts and
  the MCP server's geminiService.ts): reference prose is for continuity
  only — the new chapter must start after the previous chapter's ending,
  no scene/dialogue may be copied or paraphrased, at most a one-or-two
  sentence look-back; (2) a deterministic audit check
  (`canon-repeat-prev-`, dimension canon): sentence-level verbatim overlap
  with either of the previous 2 chapters — ≥ 15% of long sentences blocks,
  8%–15% warns (short sentences and one-sentence callbacks don't count);
  (3) the studio's auto-serialize loop stops on a duplication block instead
  of revising or committing it, and auto-created contracts now carry
  “不得重复前章已写过的场景与对白” in mustNot.
- Verified in the studio: tsc 0 errors, regression 12/12 (incl. 3 new
  cases: replay blocked, callback not blocked). Skill rules unchanged;
  version stays 2.0.0.

## 2026-11-16 — packaging fix (after v2.0.0, main only)
- `mcp-server/package.json`: esbuild `^0.25.0` → `^0.28.0`. vite 8 requires
  esbuild `^0.27 || ^0.28`; the old range made `npm install` fail with
  ERESOLVE, so the v2.0.0 tree could not be installed at all (the one-click
  installer, which pulls `main`, failed at step 4). Same fix the local studio
  already carried since 2026-11-13.
- Added `mcp-server/package-lock.json` (lockfileVersion 3, 330 packages,
  esbuild 0.28.2, vite 8.3.8), generated from the fixed `package.json`.
  Verified with a clean `npm install` (241 packages) + `tsc --noEmit`
  (0 errors) + smoke test 26/26. Skill rules unchanged; version stays 2.0.0.

## v2.0.0 (2026-11-15) — 8 Desires, AI Auto Execution, Dynamic Cast & Continuity Hardening
- **Expanded core desires (5 → 8) + `auto` default:** added `survival-breakout` (求生破局), `power-scheme` (博弈掌权), and `bond-resonance` (羁绊共鸣) across `scripts/check_chapter.py`, `scripts/check_hooks.py`, `docs/HOOKS_AND_DESIRE.md`, templates, and MCP server. Chapter `desire` and `payoff_size` now support `auto` so AI dynamically picks and executes the right desire and payoff rhythm without forcing manual form-filling.
- **Chinese chapter cap raised to 4000 characters:** updated `data/languages/zh.yaml` and `scripts/check_chapter.py` (`zh` hard range `800–4000` chars, serial target `2000–4000`, token budget `14000`) and synced `mcp-server` prose warnings (`800–4000`).
- **Dynamic cast growth & anti-nameless-NPC audit:** `scripts/check_continuity.py` now blocks generic placeholder characters (`黑衣人`, `神秘人`, `路人`, `店小二`, `stranger`, etc.) and warns on single-character chapters (`>= 2`). `mcp-server` `commitChapter` supports `newCharacters` (auto-registering into `bible/characters.md` and `state/knows.md`) with clean cleanup on `rollbackChapter`.
- **Foreshadowing ledger lifecycle (`open|progressing|paid|deferred`):** `scripts/check_continuity.py` and `templates/foreshadowing_ledger.md` support `progressing` and `deferred` + `target_chapter`, enforce resolving overdue threads in the next chapter, and block phantom foreshadowing IDs paid without planting.
- **Full-auto authoring & `第N章` title convention:** documented full-auto contract → draft → bounded audit → atomic commit flow alongside author-gated mode; `scripts/check_chapter.py` checks for canonical `第N章` / `Chapter N` title prefixes.

## v1.0.0 (2026-11-13) — First release
- Locked v3 proposal: traffic-type serialised fiction, Chinese first, English
  second phase; 120–180 chapter serial + short-story probe; pilot formula
  rebirth-revenge + identity-suspense + strong-relationship (title and names
  decided after market scan).
- Kernel: file-as-truth (`bible/outline/state/chapters/`), chapter contract
  with `transition` handoff, foreshadowing ledger with payoff dates,
  per-character knows lists, hard-constraints-first, only-redo-wrong-segment
  + state rollback, bounded re-audit, rolling-horizon planning.
- Gates: bible/outline approval, golden 3 chapters, per-chapter commit.
  Hook + desire payoff (5 desires) is a per-chapter **blocking** audit.
- Launch skills (5): market scan, packaging, character forging, bilingual
  de-slop, simple manuscript import. Worldbuilding downgraded for v1.0.
- Scripts (stdlib only): `install_skill.py` (muse/claude/codex/opencode/
  workbuddy/gpt, `--dry-run`), `check_chapter.py`, `check_continuity.py`,
  `check_hooks.py` — all run against `examples/sample-book/`.
- Bilingual from day one: `data/languages/zh.yaml` + `en.yaml`,
  `data/slop/zh.yaml` + `en.yaml`, genre packs for Fanqie and Royal Road.
- Agent Skills open-standard compliant SKILL.md (frontmatter, name matches
  folder). MIT license.
