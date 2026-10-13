/**
 * cli_manual.rs — 「查看 CLI 手册」：用系统默认程序打开安装目录里那份手册（adj945）
 *
 * 用户需求（2026-10 原话）：「全局设置那个「命令行」子页签里，再加一个「查看 CLI 手册」按钮
 * ⇒ 用系统默认程序打开安装目录里那份 MD」「路径取不到时给明确提示，别静默失败」。
 *
 * ## 为什么在 Rust 侧做（而不是前端直接调 `plugin:opener|open_path`）
 * opener 插件的能力是**两层**：`allow-open-path`（允许调用命令）+ **路径 scope**（路径要落在允许范围）。
 * 默认能力包 `opener:default` 只覆盖 URL，**不含 `open_path`** ⇒ 前端直接调会因"命令允许但 scope 为空"
 * 被拒，而前端那层是静默兜底 ⇒ 用户看到的就是"点了没反应"
 * （`adj894` 的官网链接就是这么藏了一整个版本，见 `src/preview/openUrl.ts` 的说明）。
 * 从 Rust 调 `app.opener().open_path(...)` **不经 ACL**（ACL 只约束 webview 发来的 IPC），
 * 且路径是我们自己按 `resource_dir()` 算出来的 ⇒ 不需要给整个文件系统开 scope ✓。
 *
 * ## 路径口径（**与打包配置必须一致**）
 * 手册是随包资源（`tauri.conf.json` 的 `bundle.resources`），落点是
 * **`<安装目录>/docs/iJipu-CLI-手册.md`**（Windows 下 `resource_dir()` == exe 所在目录，
 * 见 `lib.rs` 的 `builtin_soundfont_candidates` 注释）。
 * 这条相对路径在**三个地方**各写了一遍（TS 前端不参与，只有：本文件 + `tauri.conf.json` 的映射目标
 * + 安装清单），跨语言没法共用常量 ⇒ 一致性由机器闸门守着：
 * `scripts/check-installer.mjs`（安装清单里必须有 `File /oname=docs\iJipu-CLI-手册.md`）
 * 与 `scripts/smoke.mts`（本文件的常量与 conf 的映射目标**逐字**比对）✓。
 *
 * 文件不在（开发态直接 `npm run dev`、或安装包漏打）⇒ **如实报错并回上"找过的完整路径"**，
 * 界面把原因显示出来（**不静默失败** ✗）—— 与 `write_external_file` / `ws_write_text`
 * 的"宁可如实报失败，绝不谎报成功"同一口径。
 */
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

/// 手册在安装目录里的相对路径（**与 `tauri.conf.json` 的 `bundle.resources` 目标逐字一致**）
pub const CLI_MANUAL_REL: &str = "docs/iJipu-CLI-手册.md";

/**
 * 打开安装目录里的 CLI 使用手册（成功时返回被打开的**绝对路径**，界面可以显示出来）。
 *
 * 返回 `Err(原因)` 的两种情况都是"用户能照着做点什么"的**可读原因**：
 *  ① 文件不在 ⇒ 回上找过的完整路径（并提示也可以看仓库里的 `docs/CLI-手册.md`）；
 *  ② 系统打不开（`.md` 没有关联程序等）⇒ 回上原因**和**文件路径，让用户自己能打开。
 */
#[tauri::command]
pub fn cli_manual_open(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("取安装目录失败：{e}"))?;
    let path = dir.join(CLI_MANUAL_REL);
    if !path.exists() {
        return Err(format!(
            "没找到 CLI 手册：{}（安装包里可能漏了这份文件；也可以直接看仓库里的 docs/CLI-手册.md）",
            path.display()
        ));
    }
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|e| {
            format!(
                "打开失败：{e}（文件在这里，可以用编辑器自己打开：{}）",
                path.display()
            )
        })?;
    Ok(path.display().to_string())
}
