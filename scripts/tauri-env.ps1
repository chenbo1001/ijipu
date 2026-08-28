# scripts/tauri-env.ps1 - Rust/Tauri env vars (DSH sandbox adapter)
# Usage: . .\scripts\tauri-env.ps1  (dot-source to apply in current session)
# CARGO_HOME/RUSTUP_HOME in workspace (sandbox only allows workspace writes);
# each pwsh command is a separate process, must dot-source this before rust/cargo/tauri.
# adj306: path fixed - project migrated from JPCoder to JianpuScript (E-2026-055)

$env:CARGO_HOME = "D:\Coding\JianpuScript\.cargo"
$env:RUSTUP_HOME = "D:\Coding\JianpuScript\.rustup"
$env:PATH = "D:\Coding\JianpuScript\.cargo\bin;D:\Coding\JianpuScript\mingw64\bin;$env:PATH"

Write-Host "Rust env ready: $(rustc --version) / $(cargo --version)" -ForegroundColor Cyan
Write-Host "Note: cargo/tauri build needs danger-full-access (sandbox isolates cert store & WebView2)" -ForegroundColor Yellow
