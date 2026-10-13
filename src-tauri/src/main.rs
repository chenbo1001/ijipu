#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/**
 * iJipu 桌面端入口（Tauri v2 壳）
 *
 * adj942（用户裁定「直接落，修」·路线②）：**启动 Tauri 之前先做命令行分流** ——
 * `ijipu.exe cli <命令> …` 走**内嵌 CLI**（用编进 exe 的 QuickJS 跑那段 JS，**不开窗口**、
 * 按退出码退出 ✓）；其它一切参数（**双击关联来的 `.jps` 路径**、`--cli-host`、无参数）
 * 照旧进 GUI ✓ —— 判据与单测都在 `ijipu_lib::cli_embed::split_cli_args`（口径见 `docs/CLI.md` §一）。
 */
fn main() {
    #[cfg(windows)]
    if let Some(code) = ijipu_lib::cli_embed::try_run_from_env() {
        std::process::exit(code);
    }
    ijipu_lib::run()
}
