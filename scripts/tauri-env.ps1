# scripts/tauri-env.ps1 — Rust/Tauri 环境变量（dot-source 后在当前会话生效）
#
# 用法： . .\scripts\tauri-env.ps1
#
# 为什么需要这个脚本（而不是直接 cargo build）：
#   · DSH 沙箱**只允许写工作区** ⇒ 工具链必须落在工作区内，
#     不能放默认的 ~/.cargo / ~/.rustup（会"拒绝访问"，见 docs/ERRORS-LOG.md）。
#   · 每条 pwsh 命令都是**独立进程** ⇒ 跑 rust/cargo/tauri 前必须先 dot-source 一次。
#
# adj891（开源前修）：原来把 `D:\Coding\JianpuScript\...` **写死**在脚本里 ——
#   别人 clone 到任何别的位置，这个脚本就直接失效（桌面版没法自己打包）。
#   现在改成按**脚本自身位置推导**；推导不出来就**什么都不改**，
#   普通开发者用自己的 rustup/cargo（~/.cargo）即可，完全不受影响。

$repoRoot = Split-Path -Parent $PSScriptRoot            # <...>/ijipu
$workspaceRoot = Split-Path -Parent $repoRoot           # 工作区根（沙箱里工具链放在这里）

$cargoHome = Join-Path $workspaceRoot '.cargo'
$rustupHome = Join-Path $workspaceRoot '.rustup'
$mingwBin = Join-Path $workspaceRoot 'mingw64\bin'

if (Test-Path $cargoHome) {
  $env:CARGO_HOME = $cargoHome
  $env:RUSTUP_HOME = $rustupHome
  $env:PATH = "$cargoHome\bin;$mingwBin;$env:PATH"
  Write-Host "Rust env: 使用工作区工具链 -> $workspaceRoot" -ForegroundColor Cyan
} else {
  Write-Host "Rust env: 未发现工作区工具链，沿用你自己的 rustup/cargo" -ForegroundColor Cyan
}

$rustcV = 'rustc 不可用'
$cargoV = 'cargo 不可用'
try { $rustcV = (& rustc --version 2>&1 | Out-String).Trim() } catch { }
try { $cargoV = (& cargo --version 2>&1 | Out-String).Trim() } catch { }
Write-Host "  $rustcV / $cargoV" -ForegroundColor DarkGray
Write-Host "注意：cargo/tauri 构建需完整权限（沙箱隔离了证书存储与 WebView2 初始化）" -ForegroundColor Yellow
