# User-Driven Mode — 用户供稿模式（v2.2.0，P0）

第三种模式，和全自动、作者把关并列。用户先交自己整理的目录、大纲、
章节数据，AI 按用户的思路创作，不自由发挥。

## 什么时候用

| 模式 | 谁定情节 | 适用 |
|------|---------|------|
| full-auto | AI | 用户只有一句话主题，想让 AI 全包 |
| author-gated | AI 提议、用户批准 | 用户想审 AI 的方案再定 |
| user-driven | 用户 | 用户已有目录 / 大纲 / 章节数据，AI 只负责写成正文 |

## 交什么

放在书目的 `user_submission/` 里，AI 不改原文：

- `user_brief.md`（一句话、基调、视角、绝对不能写的事）
- `user_outline.yaml`（必交：目录大纲，机器可读）
- `user_characters.yaml`（选交：人物表）
- `user_foreshadowing.yaml`（选交：伏笔表）

模板在 `templates/user_submission/`。供稿分四档完整度：一句话 / 粗纲 /
细纲 / 章节草稿，见 `templates/user_submission/README.md`。

## 流程

```
0. 定级 → scripts/submission_level.py（L0–L4，见下）
1. 交稿 → user_submission/（原样保存）
2. 校验 → scripts/validate_submission.py（必须 PASS，不通过列清单打回，不写正文；
   含节拍字数预算，见下）
3. 理解复述（Step 1.5）→ scripts/submission_gaps.py 列出机器能检出的缺口与矛盾，
   AI 按 templates/user_submission/restatement.md 复述大纲，用户确认后才开工
4. 派生合同 → scripts/generate_contracts.py（合同从大纲派生，不自由起草；
   已有正文的章不覆盖，已有合同不用 --force 不覆盖；合同带 beat_budgets）
5. 写正文 → 按合同写，transition / desire_payoff 由 AI 补，标 source: ai-filled
6. 审稿 → check_contract.py（合同↔正文）+ check_fidelity.py（保真）
   + check_chapter.py + check_hooks.py + check_continuity.py
   + 人工 8 维审计，全部过才 CHAPTER_COMMIT
```

## 供稿完整度分级（v2.4.0，P2）

`scripts/submission_level.py` 是分类器（恒退出 0），不是审计：

| 级别 | 含义 | 开工程序 |
|------|------|----------|
| L0 | 什么都没交 | 先给一句话 premise（full-auto / author-gated），或交 brief |
| L1 | 只有一句话 / brief | 供稿模式需要大纲；没大纲之前走 full-auto / author-gated |
| L2 | 粗纲（有章缺标题 / 钩子 / 节拍 / 人物） | 跑 submission_gaps.py，问 MUST-ASK，不写正文；用户补齐后重校验 |
| L3 | 细纲（每章齐全） | 正常供稿流程：校验 → 复述 → 派生合同 → 写正文 |
| L4 | 章节草稿（L3 + drafts/ 有草稿） | 逐篇对照大纲审草稿；草稿只经 CHAPTER_COMMIT 进正史，不直接入库 |

## 节拍字数预算（v2.4.0，P2）

`scripts/beat_budget.py`：每条 must_happen 节拍一个目标字数，写之前先知道
这一章够不够写。`budget:` 写在节拍上（中文按字、英文按词）；不写则按章目标
均分（中文默认 3000 字，可用 `book.chapter_target_chars` 改；英文 2000 词，
`book.chapter_target_words`）。单条低于 200 字（英文 100 词）校验不通过——
撑不起一场戏，须先扩写节拍或并节拍再动笔；预算总和低于章下限或高于章上限
只警告。`generate_contracts.py` 把预算写进合同 `beat_budgets:`，与 must_happen
节拍一一对应。

## 理解复述与缺口分级（v2.3.0，P1）

`scripts/submission_gaps.py` 输出四类：

- **MUST-ASK（必须你定）**：只有一条节拍的章、主角没写 want/flaw、伏笔在兑现章
  之外兑现、别名撞名、两卷重叠。这些缺了不能写，AI 不许猜。
- **AI-MAY-FILL（我可以先补）**：transition、desire_payoff、brief 里空着的基调 /
  视角。AI 先补，审稿时标出来。
- **CONTRADICTION（矛盾）**：两处用户说法互相打架，必须用户先定哪处为准。
- **INFO（请确认）**：大纲只交了前几章、某人物还没出场、某伏笔种在还没交的章里。

复述模板见 `templates/user_submission/restatement.md`，最后是作者决定栏：
通过 / 补齐后通过 / 修改大纲。

## 大纲版本与影响清单（v2.3.0，P1）

用户中途改大纲的流程：

```
改之前 → scripts/snapshot_submission.py <book_dir> v1（快照进 versions/v1/，原样保存）
改完之后 → scripts/outline_diff.py <book_dir> v1（对照现版大纲出影响清单）
```

影响清单包括：哪几章合同要重生成（含下一章的钩子交接）、哪几条伏笔兑现章挪了、
哪几个人物增删、冻结弧是否动了。已提交正文受影响的，只标 DECISION NEEDED，
由用户定保留 / 重写 / 回滚，绝不自动改。

## 合同检查（v2.3.0，P1）

`scripts/check_contract.py` 机器化了硬规则 3 和 11：

- 有正文没合同 FAIL；合同缺必填字段 FAIL；合同 transition / desire_payoff
  还是 TODO 但正文已存在 FAIL（没正文时只警告）；
- 第 N 章（N≥2）合同里没有“Hook 交接”且没提第 N−1 章 FAIL；
- 合同与正文 frontmatter 不一致 FAIL：标题、欲望、payoff_size、钩子、人物、
  伏笔、must_happen。

没有合同的旧书（比如 examples/sample-book）会 PASS + 提示跳过，不阻塞旧流程。

## 锁定规则（Hard rule 15）

- `source: user` 锁定：章名、章序、must_happen 节拍、钩子、人物名、
  伏笔兑现章。AI 不能改。
- `source: ai-filled` 可补：transition、desire_payoff、用户留空的次要细节。
  补的须经用户点头才进正史，审稿时要标出来。
- 冻结弧：`user_outline.yaml` 里 `frozen: true` 的弧，Step 4 不得重规划。
  用户要改冻结的弧，走大纲修订：原稿保留版本，脚本输出影响清单
  （哪几章合同要重生成、哪几条伏笔要挪、哪几章已提交正文受影响），
  受影响的已提交章是否回滚由用户定。

## 保真审计怎么工作

`scripts/check_fidelity.py` 逐章对照用户大纲核对：

- 章号必须在用户大纲里（凭空多出来的章 FAIL）
- 标题须包含用户定的章名
- 钩子须与用户定的钩子完全一致（锁定）
- desire、人物、出场伏笔须与大纲一致
- must_happen 每条节拍的 keywords 须全部出现在正文里（缺一条即 FAIL）
- 不得提前兑现用户定在后面的伏笔

关键词核对是底线，不是 verdict：它只证明节拍里 distinctive 的
人名、物名、动作词写进了正文；节拍在语义上是不是真的发生了，
由人工 8 维审计判断。

## 缺口怎么处理

校验发现缺关键信息或自相矛盾时，AI 必须先报出来，不硬写：

- `must-ask`：章序、必须发生、人物生死、伏笔兑现章——缺了不能写；
- `ai-may-fill`：过渡、景物、次要对话——可先写，审稿时标出来。

## 脚本（全部标准库，不依赖 PyYAML）

| 脚本 | 作用 |
|------|------|
| `scripts/user_outline.py` | 共享模块：受限 YAML 子集解析 + 供稿加载 |
| `scripts/validate_submission.py <book_dir>` | 校验供稿（章号连续、钩子、节拍关键词、人物、伏笔、节拍预算） |
| `scripts/generate_contracts.py <book_dir> [--force]` | 从大纲派生合同（含 beat_budgets） |
| `scripts/check_fidelity.py <book_dir>` | 保真审计 |
| `scripts/submission_gaps.py <book_dir>` | 理解复述的缺口清单（MUST-ASK / AI-MAY-FILL / CONTRADICTION / INFO） |
| `scripts/snapshot_submission.py <book_dir> <version>` | 快照当前供稿进 versions/ |
| `scripts/outline_diff.py <book_dir> <old_version> [<new_version>]` | 大纲版本影响清单 |
| `scripts/check_contract.py <book_dir>` | 合同↔正文一致 + 钩子交接 |
| `scripts/beat_budget.py` | 节拍字数预算（共享模块，供校验与派生合同用） |
| `scripts/submission_level.py <book_dir>` | 供稿完整度分级 L0–L4（分类器，恒退出 0） |

## MCP 对齐（v2.4.0，P2）

MCP 服务器（`mcp-server/`）暴露同一套供稿能力，工具与 Python 脚本一一对应，
规则只有一份（脚本是唯一真相来源，服务器只做序列化与调用）：

| MCP 工具 | 对应的 Python 脚本 |
|----------|-------------------|
| `submitUserOutline` | 写 `user_submission/`（结构化 JSON → 受限 YAML 子集，`src/userSubmission.js`），随后跑 validate + level |
| `validateSubmission` | `scripts/validate_submission.py` |
| `checkFidelity` | `scripts/check_fidelity.py` |
| `checkContract` | `scripts/check_contract.py` |
| `getSubmissionLevel` | `scripts/submission_level.py` |

审计 / 提交路径（`auditChapter`、`commitChapter`）也跑 `check_contract.py` +
`check_fidelity.py`：没合同、没供稿的旧书 PASS + 提示跳过，不阻塞旧流程。

没有供稿的书（全自动 / 作者把关），`validate_submission.py` 和
`check_fidelity.py` 会以 PASS + 提示跳过，不阻塞旧流程。
