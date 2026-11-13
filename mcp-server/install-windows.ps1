# 长篇小说 MCP 一键安装（Windows 小白版）
# 用法：把 install-windows.bat 和本文件放在同一个文件夹，双击 install-windows.bat。
# 它会：检查 Node/Python → 下载代码 → 装依赖 → 建书库文件夹 → 写 WorkBuddy 配置 →
# 在桌面放一个“启动小说MCP服务器” → 写一份安装说明。装完只需再做两步手动操作
# （WorkBuddy 里点“信任”，豆包里加连接器），说明里都写清楚了。
# 重跑一次就是更新，书不会被删。

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:GIT_TERMINAL_PROMPT = '0'

$RepoUrl = 'https://github.com/zilintea/long-novel-workflow'
$ZipUrl = 'https://github.com/zilintea/long-novel-workflow/archive/refs/heads/main.zip'
$InstallDir = Join-Path $env:USERPROFILE 'long-novel-workflow'
$ServerDir = Join-Path $InstallDir 'mcp-server'
$ServerJs = Join-Path $ServerDir 'server.js'
$DocsDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'LongNovel'
$BooksDir = Join-Path $DocsDir 'novels'
$ScansDir = Join-Path $DocsDir 'scans'
$Desktop = [Environment]::GetFolderPath('Desktop')
$Launcher = Join-Path $Desktop '启动小说MCP服务器.bat'
$GuideTxt = Join-Path $Desktop '长篇小说MCP安装说明.txt'
$WbDir = Join-Path $env:USERPROFILE '.workbuddy-ai'
$WbConfig = Join-Path $WbDir 'mcp.json'
$HttpPort = 8765

function Step($n, $msg) { Write-Host ""; Write-Host " $msg" -ForegroundColor Cyan}
function Ok($msg) { Write-Host " ✓ $msg" -ForegroundColor Green}
function Warn($msg) { Write-Host "! $msg" -ForegroundColor Yellow}
function Fail($msg) { Write-Host ""; Write-Host " ✗ $msg" -ForegroundColor Red}

function Write-Utf8NoBom($path, $text) {
[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))
}

function Write-Utf8Bom($path, $text) {
[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $true))
}

try {
Write-Host "=============================================="
Write-Host " 长篇小说 MCP 一键安装"
Write-Host " 装完之后，WorkBuddy 和豆包就能接着写你的小说了"
Write-Host "=============================================="

# 1. Node（必须）
Step 1 '检查 Node.js（必须，服务器靠它跑）'
try {
$nodeVer = (node --version).Trim()
$v = [version]($nodeVer.TrimStart('v'))
if ($v -ge [version]'18.0.0') { Ok "Node.js $nodeVer，符合要求"}
else {
Fail "Node.js 版本太旧：$nodeVer，需要 18 或更新。请先到 https://nodejs.org 装最新版，装完重跑我一次。"
exit 1
}
} catch {
Fail "没找到 Node.js。请先到 https://nodejs.org 装最新版（装完关掉重开我），再重新运行我。"
exit 1
}

# 2. Python（可选，只影响审计）
Step 2 '检查 Python（可选，只影响章节审计）'
$pythonOk = $false
foreach ($py in @('python', 'py')) {
try {
$out = & $py --version 2>&1
if ($LASTEXITCODE -eq 0 -and "$out" -match 'Python (\d+)\.(\d+)') {
$major = [int]$Matches[1]; $minor = [int]$Matches[2]
if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 9)) { $pythonOk = $true; Ok "Python $out，审计可用"; break}
}
} catch {}
}
if (-not $pythonOk) {
Warn "没找到 Python 3.9+。不影响安装和大部分功能，但“审计/提交”会明确报错不可用。"
Warn "想用审计的话，到 https://www.python.org/downloads/ 装 3.9 或更新版（安装时勾选 Add Python to PATH），装完重跑我一次就行。"
}

# 3. 取代码
Step 3 '取代码（第一次下载，以后重跑就是更新）'
$gitAvailable = $false
try { git --version 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $gitAvailable = $true}} catch {}
if (Test-Path (Join-Path $InstallDir '.git')) {
Ok "已是 git 仓库，拉取更新..."
Set-Location $InstallDir
git pull --ff-only 2>$null
if ($LASTEXITCODE -ne 0) { Warn "git pull 没成功（可能没联网），用现有代码继续装。"}
else { Ok "代码已是最新。"}
} elseif (Test-Path $ServerJs) {
Ok "代码已在 $InstallDir，跳过下载。"
} else {
if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force}
if ($gitAvailable) {
Ok "用 git 克隆仓库..."
git clone $RepoUrl $InstallDir
if ($LASTEXITCODE -ne 0) { throw "git clone 失败，请检查网络后重跑。"}
} else {
Ok "没装 git，改用下载 ZIP（不用装 git 也行）..."
$zipPath = Join-Path $env:TEMP 'long-novel-workflow.zip'
$tmpDir = Join-Path $env:TEMP 'long-novel-workflow-dl'
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force}
Invoke-WebRequest -Uri $ZipUrl -OutFile $zipPath -UseBasicParsing
Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force
$extracted = Join-Path $tmpDir 'long-novel-workflow-main'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Get-ChildItem -Force $extracted | Move-Item -Destination $InstallDir -Force
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not (Test-Path $ServerJs)) { throw "代码取回来了，但没找到 mcp-server/server.js，安装包可能有问题。"}
Ok "代码已就位：$InstallDir"
}

# 4. 装依赖
Step 4 '装服务器依赖（npm install，一次就行）'
Set-Location $ServerDir
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install 失败。请检查网络后重跑我一次。"}
Ok "依赖装好了。"

# 5. 建书库文件夹
Step 5 '建书库文件夹（你的书放这里，不会被更新删掉）'
New-Item -ItemType Directory -Force -Path $BooksDir | Out-Null
New-Item -ItemType Directory -Force -Path $ScansDir | Out-Null
Ok "书库：$BooksDir"
Ok "扫榜存档：$ScansDir"

# 6. 自检：服务器能不能跑
Step 6 '自检：服务器能不能跑起来'
$initJson = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"install-check","version":"1.0"}}}'
$probe = $null
try {
$probe = $initJson | node server.js --books "$BooksDir" 2>$null
} catch {}
if ($probe -match 'long-novel-mcp') { Ok "服务器自检通过（能正常握手）。"}
else { Warn "自检没拿到预期回音。先继续装，装完在 WorkBuddy 里看工具列表能不能出来；不行就按安装说明里的办法处理。"}

# 7. 写 WorkBuddy 配置（失败也不中断安装，改手动粘贴）
Step 7 '写 WorkBuddy 配置（自动加好，你只需在 WorkBuddy 里点一下“信任”）'
$wbJson = $null
try {
New-Item -ItemType Directory -Force -Path $WbDir | Out-Null
$cfg = $null
if (Test-Path $WbConfig) {
try {
$raw = [System.IO.File]::ReadAllText($WbConfig)
if ($raw.Trim().Length -gt 0) { $cfg = $raw | ConvertFrom-Json}
} catch {
$bak = "$WbConfig.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
Copy-Item $WbConfig $bak -Force
Warn "原来的 mcp.json 读不懂，已备份到 $bak，重新写一份。"
$cfg = $null
}
}
if ($null -eq $cfg) { $cfg = [pscustomobject]@{}}
if ($null -eq $cfg.mcpServers) { $cfg | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([pscustomobject]@{}) -Force}
$entry = @{ type = 'stdio'; command = 'node'; args = @($ServerJs, '--books', $BooksDir, '--scans', $ScansDir)}
$cfg.mcpServers | Add-Member -NotePropertyName 'long-novel' -NotePropertyValue $entry -Force
$wbJson = $cfg | ConvertTo-Json -Depth 10
Write-Utf8NoBom $WbConfig $wbJson
$check = ([System.IO.File]::ReadAllText($WbConfig) | ConvertFrom-Json).mcpServers.'long-novel'
if ($null -eq $check) { throw "回读验证失败"}
Ok "已写入：$WbConfig"
Ok "WorkBuddy 里将会出现一个叫 long-novel 的连接器。"
} catch {
Warn "自动写 WorkBuddy 配置没成功（$($_.Exception.Message)）。没关系，装完按安装说明手动粘贴下面这段就行："
if ($null -eq $wbJson) {
$wbJson = ([pscustomobject]@{ mcpServers = ([pscustomobject]@{ 'long-novel' = @{ type = 'stdio'; command = 'node'; args = @($ServerJs, '--books', $BooksDir, '--scans', $ScansDir)}})} | ConvertTo-Json -Depth 10)
}
Write-Host $wbJson
}

# 8. 豆包启动器 + 安装说明
Step 8 '给豆包做一个桌面启动器，再写一份安装说明'
$launcherContent = @"
@echo off
title Long Novel MCP Server (for Doubao)
cd /d "$ServerDir"
echo Long Novel MCP server is running on http://127.0.0.1:$HttpPort/mcp
echo Keep this window open while using Doubao. Close it to stop the server.
node server.js --transport http --port $HttpPort --books "$BooksDir" --scans "$ScansDir"
echo.
echo Server stopped. Press any key to close...
pause >nul
"@
Write-Utf8NoBom $Launcher $launcherContent
Ok "桌面启动器：$Launcher（用豆包前双击它，窗口开着别关）"

$skillPrompt = "请安装 long-novel-workflow 小说技能：仓库 $RepoUrl ，按其中 SKILL.md 的工作流执行（先定圣经大纲、章节合同先行、钩子交接、8 维审计、作者点头才提交入正史）。MCP 工具 long-novel 已接好，书在 $BooksDir，先用 listBooks 列出书再动手。"
$guide = @"
长篇小说 MCP 安装说明（装完看这份就行）
==================================================

装好的东西
- 代码：$InstallDir
- 服务器：$ServerJs
- 你的书库：$BooksDir（书放这里；扫榜存档在 $ScansDir）
- WorkBuddy 配置：$WbConfig（已自动加好 long-novel）
- 豆包启动器：$Launcher（在桌面上）

还差两步手动操作（没法替你点，只能你自己点一下）
--------------------------------------------------
1）WorkBuddy：打开桌面版 → 左侧“专家 · 技能 · 连接器”→“连接器”→“自定义连接器”
→ 找到 long-novel → 点“信任”，等圆点变绿、显示 14 个工具。
然后再把下面“装技能的话”贴给 WorkBuddy，让它装技能。
2）豆包：先双击桌面的“启动小说MCP服务器”（黑窗口开着别关），
再打开豆包桌面版 → 左侧“技能 · 连接器 · 伙伴”→ 右上角“新建”→“新建自定义连接器”
→ 传输类型选 HTTP → 服务器 URL 填 http://127.0.0.1:$HttpPort/mcp → 保存并启用。
然后再把下面“装技能的话”贴给豆包。

装技能的话（复制整段，贴给 WorkBuddy 或豆包）
--------------------------------------------------
$skillPrompt

书怎么放进来
--------------------------------------------------
- 新书：在 WorkBuddy/豆包里让 AI 新建，书会自动存进 $BooksDir。
- 旧书：把一本书的文件夹（bible、outline、state、chapters 四个子文件夹）整个拷进 $BooksDir。
- 想在几台电脑之间同步：把 $BooksDir 做成 git 仓库推上 GitHub，或用网盘同步这个文件夹。

常见问题
--------------------------------------------------
- WorkBuddy 里找不到 long-novel：先确认改的是桌面版（网页版没有自定义连接器）；再看 $WbConfig 里有没有 long-novel 这一项；没有就把下面这段 JSON 整个贴进“自定义连接器”的编辑器里保存：
$wbJson
- 豆包连不上：先确认桌面的启动器在运行（黑窗口开着，里面写着 listening on http://127.0.0.1:$HttpPort/mcp）；再确认 URL 一字不差。
- 提示审计不可用：没装 Python 3.9+。到 https://www.python.org/downloads/ 装一个（安装时勾选 Add Python to PATH），装完重跑一次安装脚本。
- 端口被占（启动器一闪就关）：改启动器里的 --port $HttpPort 换个端口（比如 8766），豆包里的 URL 端口也要跟着改。
- 想更新：重跑一次安装脚本就行，书不会被删。
"@
Write-Utf8Bom $GuideTxt $guide
Ok "安装说明：$GuideTxt"

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host " 装好了！"
Write-Host " 接下来只做两件事："
Write-Host " 1. WorkBuddy：打开 → 自定义连接器 → 找到 long-novel → 点“信任”"
Write-Host " 2. 豆包：双击桌面“启动小说MCP服务器”，再去豆包里加连接器"
Write-Host " 详细步骤和“装技能的话”都在桌面那份《长篇小说MCP安装说明.txt》里。"
Write-Host "==============================================" -ForegroundColor Green
} catch {
Fail "安装中途出错：$($_.Exception.Message)"
Write-Host " 把上面这行字发给我，我来修。重跑一次本脚本会接着装，不会弄坏已有的东西。"
exit 1
}

Read-Host '按回车键退出安装程序'
