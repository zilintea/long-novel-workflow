# Long Novel Workflow · 写小说技能

一句话开一本长篇小说，写多少章都不丢情节、不丢人物、不丢伏笔。中英文通用。

- **这是什么：** Agent Skills 开放标准技能（一个 `SKILL.md` + 轻量 Python 脚本，
  不是 App、不用服务器、不用模型账号）。先定圣经和大纲，再写黄金 3 章，
  然后一章一章往下写。
- **解决什么问题：** 小说是一台状态机。前面章节一出上下文，人物就走形、
  规则就被改、伏笔就埋了不收。这个技能把状态存在文件里，不存在聊天记忆里。
- **怎么做：** 文件当真相（`bible/outline/state/chapters/`）、章节合同（含
  `transition` 交接字段）、伏笔台账（带兑现日期）、每人物 knows 清单、
  硬约束先行、每章钩子 + 欲望兑现阻断审计。只改错的那一段，改完先回滚状态。
- **当前版本：** v1.0.0（2026-11-13）。MIT 开源协议。

> English: [`README.md`](README.md)

---

## 30 秒上手

### 第 1 步 — 安装（一次就行）

```bash
python3 scripts/install_skill.py --target muse        # Muse
python3 scripts/install_skill.py --target claude      # Claude Code
python3 scripts/install_skill.py --target codex       # Codex
python3 scripts/install_skill.py --target opencode    # OpenCode
python3 scripts/install_skill.py --target workbuddy   # WorkBuddy
python3 scripts/install_skill.py --target gpt --out ./gpt_instructions.md
```

加 `--dry-run` 只打印目标路径，不复制。不需要任何平台专属 hook。

### 第 2 步 — 说一句话

```
写一本小说：重生复仇、身份悬念、强关系，中文，番茄
从第 21 章续写我的稿子
导入我的旧稿继续写
```

### 第 3 步 — 点三次头，拿章节

1. **圣经 + 大纲**——世界、人物、规则、语调。你点头才写正文。
2. **黄金 3 章**——先写 1–3 章，读过、诊断过，才决定继续连载。
3. **每一章**——合同 → 草稿 → 子审 → 有界修改 → `CHAPTER_COMMIT`。
   只有提交了的章节，其事实才进正史；没提交的草稿在正史里不存在。

**全程不会自动往下跑。** 每一关都要你点头。

---

## 默认值（v1.0.0，已锁定）

| 项目 | 默认值 |
|---|---|
| 语言 | 中文先行；英文是第二阶段（`data/languages/zh.yaml`、`en.yaml`） |
| 篇幅 | 120–180 章连载；短篇探针 1–3 章 |
| 章节长度 | 中文 2000–3000 字；英文 1500–2500 词 |
| 试点配方 | 重生复仇 + 身份悬念 + 强关系（书名、人名扫榜后定） |
| 首发平台 | 中文：番茄 / 七猫；英文：Royal Road（见 `docs/TRAFFIC.md`） |
| 欲望兑现 | 每章至少兑现 5 种欲望之一种；3 章一小兑现，10 章一大兑现 |

5 种欲望：好奇、代入升级、复仇补偿、被爱拉扯、逃逸安慰。见 `docs/HOOKS_AND_DESIRE.md`。

## 首发技能（5 个，v1.0.0）

1. 扫榜 / 拆文——现在到底什么在被读、为什么。
2. 包装——书名、封面 brief、简介、关键词。
3. 人物锻造——人物档案、成长弧、knows 清单。
4. 双语去 AI 味——中英文去 AI 味词表（`data/slop/`）。
5. 简版旧稿导入——把旧稿反推成圣经 / 大纲 / 状态。

世界观在 v1.0 只是薄卡片，不是完整系统。后续插槽：完整世界观、
对白医生、读者评审团、有声化、双语改编。

## 检查脚本（真的能跑，不是摆设）

```bash
python3 scripts/check_chapter.py examples/sample-book
python3 scripts/check_continuity.py examples/sample-book
python3 scripts/check_hooks.py examples/sample-book
```

每项检查都打印通过 / 不通过和证据，阻断项不通过即退出码非零。
黄金 3 章关卡、30 章连续性测试、连续性错误率怎么量，见 `docs/EVALUATION.md`。

## 仓库结构

```
SKILL.md                  # 入口（Agent Skills frontmatter，名字 = 文件夹名）
skill.yaml                # 技能元数据
README.md / README.zh-CN.md
CHANGELOG.md  LICENSE     # MIT
scripts/                  # install_skill.py、check_chapter.py、check_continuity.py、check_hooks.py
templates/                # 章节合同、圣经、大纲、台账、章节
docs/                     # CONTINUITY、HOOKS_AND_DESIRE、BILINGUAL、TRAFFIC、EVALUATION、MODEL_ADAPTER
references/               # 类型笔记、欲望兑现示例
data/languages/           # zh.yaml、en.yaml
data/genres/              # fanqie_urban、fanqie_rebirth_revenge、royalroad_litrpg
data/slop/                # zh.yaml、en.yaml（去 AI 味词表）
checklists/               # chapter_audit.md、continuity_audit.md
examples/sample-book/     # 完整小原创样书工程（bible/outline/state/chapters 001–003）
mcp-server/               # MCP 服务器（stdio + streamable HTTP）——见 mcp-server/README.md
```

技能仓库和书工程是分开的：技能在一个文件夹，每本书是自己的一套
`bible/outline/state/chapters/`。见 `docs/CONTINUITY.md`。

## MCP 服务器（WorkBuddy / 豆包）

`mcp-server/` 是这个技能的 MCP 服务器（Node.js，不调任何模型）：
把书的状态机做成 14 个工具——列书 / 读章节、起草合同（含阻断式钩子
交接规则）、存草稿、跑确定性审计、原子提交 / 回滚、伏笔台账——走
stdio（WorkBuddy、Claude、Cursor）和 streamable HTTP（豆包桌面版，
`http://127.0.0.1:8765/mcp`）。书留在你自己的电脑上。一行安装：

```bash
cd mcp-server && npm install && npm test
```

具体客户端配置和宿主使用规则见
[`mcp-server/README.md`](mcp-server/README.md)。
