# User Submission — 用户供稿模板（v2.2.0，P0）

这是“用户供稿模式”的入口。用户把自己整理的目录、大纲、章节数据交到这里，
AI 按这份数据创作，不自由发挥。三个文件缺一不可的是 `user_outline.yaml`；
`user_brief.md`、`user_characters.yaml`、`user_foreshadowing.yaml` 有就交，
没有就留空，AI 不替用户编。

## 交到哪里

一本书的供稿放在书目下的 `user_submission/`，原样保存，AI 不改原文：

```
my-book/
  user_submission/
    user_brief.md
    user_outline.yaml        # 必交：目录大纲，机器可读
    user_characters.yaml     # 选交：人物表
    user_foreshadowing.yaml  # 选交：伏笔表
  bible/ outline/ state/ chapters/ ...
```

## 四档完整度（交多少，就按多少开工）

| 档 | 用户交什么 | AI 怎么做 |
|----|-----------|-----------|
| 1 一句话 | 只有 `user_brief.md` | 按全自动 / 作者把关走，不进供稿模式 |
| 2 粗纲 | brief + 每章只有标题和一句话目标 | 进供稿模式，但每章缺 must_happen / hook 的，标 `must-ask`，先问用户补齐再开工 |
| 3 细纲 | brief + 完整 `user_outline.yaml`（每章有 must_happen、hook、人物、伏笔） | 正常供稿模式：校验 → 生成合同 → 写正文 → 保真审计 |
| 4 章节草稿 | 细纲 + 部分章节已有草稿正文 | 草稿进 `drafts/`，不直接进正史；AI 按大纲续写未写的章，已有草稿只审不改 |

## 字段规则（锁定的含义）

- 标 `source: user` 的字段是锁定的：章名、章序、必须发生、钩子、人物名、
  伏笔兑现章。AI 不能改，改了 `check_fidelity.py` 会 FAIL。
- 标 `source: ai-filled` 的字段是 AI 补的：transition、desire_payoff、
  以及用户留空的次要细节。补的须经用户点头才进正史，审稿时要标出来。
- 伏笔编号先登记后使用：`foreshadowing_planted` / `foreshadowing_paid`
  里的每个 `Fxx`，必须在 `user_foreshadowing.yaml` 里有登记，或由本章新埋
  （新埋的要在同一提交里登记）。
- 人物名全书一致：大纲、人物表、合同、正文里同一个人物必须用同一个名字，
  不能一会儿叫全名一会儿叫小名（小名要写进人物表的 `aliases` 里才可用）。

## 流程（供稿模式）

```
交稿 → validate_submission.py（校验不过列清单打回）
    → 理解复述（AI 复述大纲、列缺口与矛盾，用户确认后开工）
    → generate_contracts.py（合同从大纲派生，不自由起草）
    → 写正文 → check_fidelity.py + 三旧脚本 → 人工 8 维审计 → CHAPTER_COMMIT
```

`validate_submission.py` 不通过，不写正文。`check_fidelity.py` 不通过，
不提交。用户中途改大纲走版本：原稿保留 v1、v2，改动输出影响清单。

## v2.3.0 补充（P1）

- 理解复述（Step 1.5）：校验通过后，`submission_gaps.py` 列出机器能检出的
  缺口与矛盾，AI 按 `restatement.md` 复述大纲，用户确认后才开工。
- 缺口分两级：MUST-ASK（章太薄、主角没 want/flaw、伏笔提前兑现、矛盾——
  缺了不能写，必须用户定）；AI-MAY-FILL（transition、desire_payoff、
  空着的基调/视角——AI 先补，审稿时标出来）。
- 大纲版本：改前先 `snapshot_submission.py` 快照（`versions/v1/` 原样保存），
  改后 `outline_diff.py` 出影响清单；已提交正文受影响的由用户定保留 /
  重写 / 回滚，绝不自动改。
- 合同检查：`check_contract.py` 机器化硬规则 3 和 11（合同↔正文一致 +
  钩子交接）。

## v2.4.0 补充（P2）

- 供稿完整度分级：`submission_level.py` 先定级再开工——L0 什么都没交、
  L1 只有一句话、L2 粗纲（缺标题/钩子/节拍/人物，先问 MUST-ASK 不写正文）、
  L3 细纲（正常流程）、L4 章节草稿（逐篇对照大纲审，草稿只经 CHAPTER_COMMIT
  进正史）。
- 节拍字数预算：每条节拍可加 `budget:`（目标字数）；不写按章目标均分
  （中文默认 3000 字，`book.chapter_target_chars` 可改）。单条低于 200 字
  校验不通过；合同里 `beat_budgets:` 与节拍一一对应，写之前先看预算。
- MCP 对齐：服务器上有 submitUserOutline / validateSubmission /
  checkFidelity / checkContract / getSubmissionLevel 五个工具，跑的是同一套
  Python 脚本，规则只有一份。
