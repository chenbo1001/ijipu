@echo off
rem One-click desktop dev: cd to this repo, load the workspace Rust toolchain, run tauri dev.
rem Double-click this file (or run it from any directory).
setlocal
cd /d "%~dp0"

if not exist "scripts\tauri-env.ps1" (
  echo [iJipu] scripts\tauri-env.ps1 not found. Run this file inside the ijipu repo.
  pause
  exit /b 1
)

echo [iJipu] starting tauri dev ...
echo [iJipu] cwd: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -Command ". '.\scripts\tauri-env.ps1'; npm run tauri:dev"
set "CODE=%ERRORLEVEL%"
echo.
echo [iJipu] tauri dev exited with code %CODE%.
pause
exit /b %CODE%
