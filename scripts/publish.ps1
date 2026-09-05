<#
.SYNOPSIS  iJipu 一键自动发布：自动递增版本 → 更新 CHANGELOG → 提交 → 打 tag → 推送
.DESCRIPTION
  触发词「更新提交」的自动化版。检测工作区改动 → 判定版本递增（默认 PATCH；-Minor/-Major 调整）
  → 同步 version.ts / package.json / src-tauri/tauri.conf.json / package-lock.json 四处版本
  → 更新 CHANGELOG.md（基于上一个 tag 起的提交生成条目）→（可选）准备桌面音色库独立附件
  → git add / commit（Conventional 消息）→ git tag → 推送分支 + 标签。
  在已有的 scripts/git-push.ps1 逻辑之上扩展了「版本递增 + CHANGELOG 自动更新」。

.PARAMETER Msg      本次发布描述（用于 commit 消息与概述）；不传则用最近提交标题。
.PARAMETER Minor    递增次版本（默认补丁版 +1）。
.PARAMETER Major    递增主版本（破坏性/里程碑）。
.PARAMETER SkipPush 只提交 + 打本地 tag，不推送（预检/本地发布）。
.PARAMETER DryRun   只打印计划（读版本、计算新版本、生成 CHANGELOG 条目），不改文件、不提交。
.PARAMETER PrepareTauri   发布后运行 scripts/prepare-tauri-soundfont.mjs（把音色库复制为桌面独立附件）。
.EXAMPLE
  . .\scripts\publish.ps1 -Msg "试听固定高保真"            # 补丁版
  . .\scripts\publish.ps1 -Minor -Msg "功能新增"           # 次版本
  . .\scripts\publish.ps1 -SkipPush -DryRun                # 只预检，展示将做内容
#>
[CmdletBinding()]
param(
  [string]$RemoteUrl = "git@github.com:snailhome/ijipu.git",
  [string]$Branch = "main",
  [string]$Msg = "",
  [switch]$Minor,
  [switch]$Major,
  [switch]$SkipPush,
  [switch]$DryRun,
  [switch]$PrepareTauri
)
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoRoot
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
Write-Host "== 仓库：$RepoRoot ==" -ForegroundColor Cyan

# — 1) 当前版本（读 package.json 最稳；用 ReadAllText 保证 UTF-8 正确解析中文） —
$pkg = [System.IO.File]::ReadAllText((Join-Path $RepoRoot "package.json")) | ConvertFrom-Json
if ($pkg.version -notmatch '^\d+\.\d+\.\d+$') { Write-Host "!! 无法解析版本：$($pkg.version)" -ForegroundColor Red; exit 1 }
$v = [int[]]($pkg.version -split '\.')
$curVer = "$($v[0]).$($v[1]).$($v[2])"
if ($Major) { $newVer = "$($v[0]+1).0.0" }
elseif ($Minor) { $newVer = "$($v[0]).$($v[1]+1).0" }
else { $newVer = "$($v[0]).$($v[1]).$($v[2]+1)" }
$kind = 'patch'; if ($Major) { $kind = 'major' } elseif ($Minor) { $kind = 'minor' }
Write-Host "== 当前版本：$curVer → 新版本：$newVer（$kind）==" -ForegroundColor Green

# — 2) 工作区改动检查 —
$status = git status --short
if (-not $status) {
  Write-Host "== 工作区干净，无改动可发布 ==" -ForegroundColor DarkYellow
  if ($DryRun) { exit 0 }
  Write-Host "（提示：先改好代码/文档再用本脚本发布）" ; exit 0
}
Write-Host "`n== 待发布改动 ==" -ForegroundColor Cyan
Write-Host $status

# — 3) 收集发布概述（上一个 tag 起的提交标题，用于 CHANGELOG / commit 消息） —
$lastTag = (git describe --tags --abbrev=0 2>$null)
if ($lastTag) { $log = @(git log "$lastTag..HEAD" --format="%s") }
else { $log = @(git log --format="%s" | Select-Object -First 10) }
if ($log.Count -eq 0) { $log = @("自动发布 $newVer") }
$logJoined = ($log | ForEach-Object { "- $_" }) -join "`n"
$titleDesc = $Msg; if (-not $titleDesc) { $titleDesc = $log[0] }
$commitMsg = "release: 版本升至 $newVer（$titleDesc）"

# — 4) CHANGELOG 条目 —
$today = Get-Date -Format 'yyyy-MM-dd'
$entry = "`n## [$newVer] — $today`n`n$logJoined`n`n---`n"

if ($DryRun) {
  Write-Host "`n[DRYRUN] 将执行以下操作（不实际修改）：" -ForegroundColor Yellow
  Write-Host "  · 递增版本：$curVer → $newVer（4 处）"
  Write-Host "  · CHANGELOG.md 顶部插入：`n$entry"
  Write-Host "  · commit：$commitMsg"
  Write-Host "  · git tag：v$newVer"
  if ($SkipPush) { Write-Host "  · 推送：跳过（-SkipPush）" } else { Write-Host "  · 推送：origin $Branch + v$newVer" }
  exit 0
}

# — 5) 递增版本（4 处，String 替换，保留原编码风格） —
function Replace-File([string]$path, [string]$old, [string]$new) {
  $t = [System.IO.File]::ReadAllText((Join-Path $RepoRoot $path))
  $t = $t.Replace($old, $new)
  [System.IO.File]::WriteAllText((Join-Path $RepoRoot $path), $t, $utf8NoBom)
}
$qOld = "`"version`": `"$curVer`""; $qNew = "`"version`": `"$newVer`""
Replace-File "package.json" $qOld $qNew
Replace-File "src-tauri/tauri.conf.json" $qOld $qNew
Replace-File "package-lock.json" $qOld $qNew
Replace-File "src/brand/version.ts" "APP_VERSION = '$curVer'" "APP_VERSION = '$newVer'"
Write-Host "`n== 已递增版本 → $newVer（package.json / package-lock / tauri.conf / version.ts）==" -ForegroundColor Green

# — 6) 更新 CHANGELOG.md（标题行后插入） —
$changelog = [System.IO.File]::ReadAllText((Join-Path $RepoRoot "CHANGELOG.md"))
$changelog = $changelog.Replace("`r`n", "`n")
$nl = $changelog.IndexOf("`n")
if ($nl -lt 0) { $changelog = $changelog + $entry } else { $changelog = $changelog.Substring(0, $nl) + $entry + $changelog.Substring($nl) }
[System.IO.File]::WriteAllText((Join-Path $RepoRoot "CHANGELOG.md"), $changelog, $utf8NoBom)
Write-Host "== 已更新 CHANGELOG.md ==" -ForegroundColor Green

# — 7) 可选：准备桌面音色库独立附件 —
if ($PrepareTauri) {
  Write-Host "`n== 准备桌面音色库独立附件 ==" -ForegroundColor Cyan
  node scripts/prepare-tauri-soundfont.mjs
}

# — 8) git add / commit / tag / push —
Write-Host "`n== git add -A / commit ==" -ForegroundColor Cyan
git add -A
git commit -m "$commitMsg" 2>&1 | Select-Object -Last 3

Write-Host "`n== git tag v$newVer ==" -ForegroundColor Cyan
git tag -d "v$newVer" 2>$null | Out-Null
git push origin ":refs/tags/v$newVer" 2>$null | Out-Null
git tag "v$newVer"

if ($SkipPush) {
  Write-Host "`n== 已跳过推送（-SkipPush）——本地已提交 + 打 tag v$newVer ==" -ForegroundColor DarkYellow
} else {
  Write-Host "`n== push origin $Branch ==" -ForegroundColor Cyan
  git push origin $Branch 2>&1 | Select-Object -Last 5
  if ($LASTEXITCODE -ne 0) { Write-Host "!! push 分支失败" -ForegroundColor Red; exit 1 }
  Write-Host "`n== push tag v$newVer ==" -ForegroundColor Cyan
  git push origin "v$newVer" 2>&1 | Select-Object -Last 5
  if ($LASTEXITCODE -ne 0) { Write-Host "!! push 标签失败" -ForegroundColor Red; exit 1 }
}
Write-Host "`n== 发布完成：v$newVer ==" -ForegroundColor Green
Write-Host "Repo: https://github.com/snailhome/ijipu"
