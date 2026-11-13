# long-novel-mcp — MCP server for the long-novel-workflow skill

An MCP server that turns the
[long-novel-workflow](../SKILL.md) skill into a state machine any MCP host
can drive: WorkBuddy, Doubao, Claude, Cursor, or anything else that speaks
MCP. The host model writes the prose; this server manages the book state and
runs the skill's deterministic checks. It never calls a model API, never
invents book data, and never hard-codes a book, character, or genre name —
everything is data-driven from the book files on disk.

## What it does

- **File-as-truth state:** books live in `bible/`, `outline/`, `state/`,
  `chapters/` (+ `drafts/` for uncommitted prose), exactly the skill layout.
- **Chapter contracts:** `draftContract` enforces the contract rules,
  including hard rule 11 (Hook handoff, blocking) — a chapter whose previous
  chapter ends on a hook must state how its opening resolves that hook.
- **Deterministic audit:** `auditChapter` shells out to the repo's Python
  checks (`scripts/check_chapter.py`, `check_continuity.py`,
  `check_hooks.py`) against a staged temp copy, so canon is never touched.
  With the commit inputs supplied it is an exact dry run of the commit.
- **Atomic commit:** `commitChapter` runs the audit first and REFUSES when
  it fails; on success the draft moves `drafts/` → `chapters/` and its facts
  enter `state/` (progress, summary, timeline, foreshadowing ledger, knows)
  in the same step, or nothing changes. `rollbackChapter` undoes one commit.
- **Foreshadowing ledger:** list / mark paid / extend / schedule a payoff,
  with overdue, due-soon and stale-30 computed from the current chapter.
- **Market scan:** returns the newest weekly-report scan file from the scans
  directory — or says honestly that none exists. It never fabricates numbers.

## Requirements

- **Node.js 18+** (the server itself; tested on Node 24).
- **Python 3.9+** as `python3` — only for the deterministic audit. If Python
  is missing, `auditChapter` / `commitChapter` fail with a clear error
  instead of a silent pass. Everything else still works.
- Books on the same machine as the MCP client (see below).

## Install

### 一键安装（Windows 小白版）

下载 `install-windows.bat` 和 `install-windows.ps1` 放到同一个文件夹，双击
`.bat` 就行：它会检查 Node/Python、下载代码、装依赖、建书库文件夹、自动写
好 WorkBuddy 配置、在桌面放一个豆包启动器，并写一份安装说明。装完只需再做
两步手动操作（WorkBuddy 里点“信任”，豆包里加连接器），说明里都写清楚了。
重跑一次就是更新，书不会被删。

```bash
git clone https://github.com/zilintea/long-novel-workflow.git
cd long-novel-workflow/mcp-server
npm install
```

No build step — plain JavaScript (ESM), runs straight from source.
`npm test` runs the smoke test (26 checks over stdio + HTTP, against a
clearly-marked fixture book, never a real book).

## Run

```bash
# stdio (default) — WorkBuddy / Claude / Cursor
node server.js --books /path/to/your/novels

# streamable HTTP — Doubao desktop
node server.js --transport http --port 8765 --books /path/to/your/novels
# → http://127.0.0.1:8765/mcp  (binds 127.0.0.1 only by default)
```

Options: `--transport stdio|http`, `--port` (default 8765), `--host`
(default `127.0.0.1` — do not expose publicly), `--books` (default
`./books`, relative to the working directory), `--scans` (default
`./scans`), `--python` (default `python3`), `--skill-root` (default: the
repo root above `mcp-server/`). Env overrides: `LONG_NOVEL_TRANSPORT`,
`LONG_NOVEL_PORT`, `LONG_NOVEL_HOST`, `LONG_NOVEL_BOOKS`,
`LONG_NOVEL_SCANS`, `LONG_NOVEL_PYTHON`. `node server.js --help` prints
all of this.

**Books stay on your own machine.** The server must run on the same
computer as the MCP client (stdio, or `127.0.0.1` HTTP). If your books live
on another machine, sync them there first — Git is the cleanest way
(clone this repo, keep your books in a separate repo or folder).

## Client config

Replace the paths with your own. On Windows use forward slashes
(`C:/Users/you/novels`) — Node accepts them.

### WorkBuddy (desktop) — stdio via npx

WorkBuddy → 专家 · 技能 · 连接器 → 连接器 → 自定义连接器 → Add MCP,
paste this JSON (stdio). This package is not published on npm, so npx
points at the local folder:

```json
{
  "mcpServers": {
    "long-novel": {
      "command": "npx",
      "args": [
        "-y",
        "C:/path/to/long-novel-workflow/mcp-server",
        "--books",
        "C:/path/to/your/novels",
        "--scans",
        "C:/path/to/your/novels/scans"
      ]
    }
  }
}
```

Direct-node form (same thing, no npx):

```json
{
  "mcpServers": {
    "long-novel": {
      "command": "node",
      "args": [
        "C:/path/to/long-novel-workflow/mcp-server/server.js",
        "--books",
        "C:/path/to/your/novels",
        "--scans",
        "C:/path/to/your/novels/scans"
      ]
    }
  }
}
```

After adding, click **信任**. Then have WorkBuddy install the skill itself:
ask it to read this repo's `SKILL.md` and install it as a skill
(a skill name alone is not enough — paste the full prompt or the skill
file path).

### Doubao (desktop) — streamable HTTP

Start the server first (it must keep running while Doubao uses it):

```bash
node server.js --transport http --port 8765 --books C:/path/to/your/novels
```

Doubao → 技能 · 连接器 · 伙伴 → 新建 → 新建自定义连接器, transport
HTTP, server URL:

```
http://127.0.0.1:8765/mcp
```

No token, no headers — it only listens on localhost. The connector only
works on the computer where it is configured; it does not sync to your
phone.

### Claude / Cursor / generic MCP client — stdio

Same stdio config as WorkBuddy above (Claude Code `mcpServers` /
Cursor `mcp.json`), with the `node` form if your client does not run npx
against a local folder.

## Tools (14)

| Tool | What it does |
|---|---|
| `listBooks` | Every book under the books root: id, title, committed chapters, next chapter. |
| `getBook` | One book: bible + outline + state file contents + chapter list with status. |
| `getChapter` | One chapter: contract fields, prose, status (`committed` / `draft` / `contract-only` / `missing`), and the previous chapter's end hook. |
| `draftContract` | Create/update a chapter contract. Enforces rule 11 (hook handoff). Fields not supplied keep their previous value. |
| `saveChapterDraft` | Save prose as a draft (`drafts/`). Never commits. Prose length / AI-flavour phrases are warnings, not refusals. |
| `auditChapter` | Deterministic audit (the 3 Python checks, staged temp copy) + the 8-dimension audit criteria for the host's judgment pass. With commit inputs it is an exact dry run of the commit. |
| `commitChapter` | Atomic commit: audit first (REFUSES on failure), then draft → `chapters/` + state update. Needs `summary` + `timeline` from the host — the server never invents them. |
| `rollbackChapter` | Undo one commit: chapter back to draft, its facts removed from state, threads it paid reopened, threads it planted removed. |
| `listForeshadowing` | Ledger with computed overdue / due-soon / stale-30 per thread. |
| `markForeshadowingPaid` | Mark a thread paid (remediation when a payoff was written but the ledger was never updated). |
| `extendForeshadowing` | Move a thread's `payoffDue` to a later chapter (needs author approval first). |
| `scheduleForeshadowingPayoff` | Declare a thread paid off by a future chapter — writes it into that chapter's contract. |
| `marketScan` | Newest weekly-report scan file from the scans dir, or an honest "none found" + how to add one. |
| `getWorkflow` | The skill rules: hard rules, 6 steps, gates, 8-dimension criteria, full `SKILL.md` text. |

All tools take `book` (the book id = its directory name under the books
root) plus their own fields. Errors are plain messages — no invented data.

## Book layout (what the server expects)

```
<books root>/
  <book-id>/                  # e.g. my-novel
    bible/                    # canon.md, characters.md, world.md, rules.md, voice.md
    outline/                  # overview.md, chapters/NNN.md (contracts)
    state/                    # summary.md, foreshadowing.md, knows.md, progress.md, timeline.md
    chapters/                 # NNN.md — committed chapters only (canon)
    drafts/                   # NNN.md — uncommitted drafts
```

Create a book from the skill's `templates/` (see the skill `SKILL.md`),
or let the host model scaffold one and then run the checks. A directory
counts as a book when it has `bible/` + `chapters/`.

## How the host model should use it (proposal-inbox model)

1. **Load the rules first:** `getWorkflow` (or install `SKILL.md` as a
   skill) — the server enforces state and audits, not taste.
2. **Contract before prose:** `draftContract` for chapter N, then
   `saveChapterDraft`. No contract, no prose (hard rule 3).
3. **Audit before commit:** `auditChapter` with the same summary /
   timeline / knows / foreshadowing inputs the commit will use.
4. **Author approval before commit:** the server enforces the audit, not
   the approval. Show the chapter to the author; only call
   `commitChapter` after they approve. A draft that is not committed does
   not exist in canon.
5. **Revise by rolling back:** to fix a committed chapter, `rollbackChapter`
   first, then revise the draft and commit again (hard rule 5).

## Market scans

Drop a weekly-report deconstruction (e.g. a Fanqie novel weekly report)
as a `.md` / `.txt` / `.json` file into the scans directory
(`--scans`, default `./scans`); `marketScan` returns the newest one.
`marketScan` takes an optional `platform` filter (e.g. `fanqie`).
The server never invents chart numbers — if the directory is empty it
says so.

## Caveats

- **No listing / publishing needed.** Custom MCP connectors are designed
  for unlisted use; listing is only optional distribution for strangers.
- **No paid hosting needed.** The server runs on your own PC
  (localhost). GitHub public repos and npm public packages are free; a
  remote server is only needed if you want to reach it from a phone or
  host it for others.
- **Doubao HTTP is stateless JSON** (no SSE stream, no session). Each
  request gets a fresh server; all state lives in the book files.
- **Python audit caveat:** the 3 check scripts only inspect `chapters/`
  (canon). A draft is staged into a temp copy for the audit; without the
  commit inputs, three states are expected pre-commit and reported as
  notes, not failures: the chapter not yet in `progress.md`, a thread it
  pays still showing `open`, a thread it plants still missing from the
  ledger.
- **Version:** the server is v1.0.0, matching skill v1.0.0. The skill
  version was not bumped for this addition.
