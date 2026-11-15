# CHANGELOG

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
