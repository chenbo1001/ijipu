# scripts/tauri-env.ps1 — Rust/Tauri 环境变量统一设置（DSH 沙箱适配）
# 用法：. .\scripts\tauri-env.ps1 （点引用以在当前会话生效）
# 说明：CARGO_HOME/RUSTUP_HOME 置于工作区（沙箱只允许写工作区）；
#       每条 pwsh 命令独立进程，必须在本脚本点引用后再跑 rust/cargo/tauri 命令。

$env:CARGO_HOME = "D:\Coding\JPCoder\.cargo"
$env:RUSTUP_HOME = "D:\Coding\JPCoder\.rustup"
$env:PATH = "D:\Coding\JPCoder\.cargo\bin;D:\Coding\JPCoder\mingw64\bin;$env:PATH"

Write-Host "Rust 环境就绪：$(rustc --version) / $(cargo --version)" -ForegroundColor Cyan
Write-Host "提示：cargo/tauri 构建需在完整权限（danger-full-access）下运行（沙箱隔离证书存储与 WebView2）" -ForegroundColor Yellow
