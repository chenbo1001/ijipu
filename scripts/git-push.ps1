<#
.SYNOPSIS
  ijipu 应用仓库的 GitHub 推送 / 打 tag 一键脚本（PowerShell，中文友好）。

.DESCRIPTION
  自动 commit 当前改动 → push main → 打 tag → 推送 tag（如配 CI 可触发 Release）。

.PARAMETER RemoteUrl
  GitHub 远程 URL（默认：git@github.com:snailhome/ijipu.git）。

.PARAMETER Token
  HTTPS 推送用的 GitHub PAT（SSH 推送不需要）。

.PARAMETER Branch
  推送的分支（默认 main）。

.PARAMETER Tag
  要创建并推送的 tag（如 0.8.0）。不传则只 push main。

.PARAMETER SkipMain
  跳过 push main（只推 tag）。

.PARAMETER CommitMsg
  commit 信息（默认 chore: release {Tag}）。

.EXAMPLE
  pwsh scripts/git-push.ps1
  pwsh scripts/git-push.ps1 -Tag 0.8.0
  pwsh scripts/git-push.ps1 -Tag 0.8.0 -SkipMain
  pwsh scripts/git-push.ps1 -RemoteUrl https://github.com/snailhome/ijipu.git -Token ghp_xxx
#>
[CmdletBinding()]
param(
  [string]$RemoteUrl = 'git@github.com:snailhome/ijipu.git',
  [string]$Token = '',
  [string]$Branch = 'main',
  [string]$Tag = '',
  [switch]$SkipMain,
  [string]$CommitMsg = ''
)

$ErrorActionPreference = 'Stop'

# 切到脚本所在仓库根（脚本在 scripts/，向上退一级）
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "== 仓库：$RepoRoot ==" -ForegroundColor Cyan
git remote -v

# 1) 当前状态
Write-Host "`n== git status ==" -ForegroundColor Cyan
git status --short

# 2) 暂存 + 提交（如有改动）
if (git status --short) {
  if (-not $CommitMsg) {
    if ($Tag) { $CommitMsg = "chore: release $Tag" } else { $CommitMsg = "chore: update" }
  }
  Write-Host "`n== commit: $CommitMsg ==" -ForegroundColor Cyan
  git add -A
  git commit -m "$CommitMsg" 2>&1 | Select-Object -Last 3
} else {
  Write-Host "`n== 无改动可提交，跳过 commit ==" -ForegroundColor DarkGray
}

# 3) 推 main（可选）
if (-not $SkipMain) {
  Write-Host "`n== push origin $Branch ==" -ForegroundColor Cyan
  if ($Token -and $RemoteUrl.StartsWith('https://')) {
    $repoPath = ($RemoteUrl -replace '^https://github.com/','') -replace '\.git$',''
    git push "https://${Token}@github.com/${repoPath}.git" $Branch
  } else {
    git push origin $Branch
  }
} else {
  Write-Host "`n== 跳过 push main (-SkipMain) ==" -ForegroundColor DarkGray
}

# 4) 打 tag 并推送（如指定 Tag）
if ($Tag) {
  Write-Host "`n== tag $Tag ==" -ForegroundColor Cyan
  # 删除本地已存在同名 tag
  git tag -d $Tag 2>$null | Out-Null
  # 删除远程同名 tag（如存在）
  git push origin ":refs/tags/$Tag" 2>$null | Out-Null
  git tag $Tag
  if ($Token -and $RemoteUrl.StartsWith('https://')) {
    $repoPath = ($RemoteUrl -replace '^https://github.com/','') -replace '\.git$',''
    git push "https://${Token}@github.com/${repoPath}.git" $Tag
  } else {
    git push origin $Tag
  }
} else {
  Write-Host "`n== 未指定 -Tag，跳过打 tag ==" -ForegroundColor DarkGray
}

Write-Host "`n== 完成 == " -ForegroundColor Green
Write-Host "仓库地址:  https://github.com/snailhome/ijipu"
