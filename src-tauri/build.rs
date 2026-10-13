/**
 * build.rs — 编译期的两件事（adj942 起多了第 ① 件）
 *
 * ① **保证"内嵌 CLI 的 JS 产物"一定存在**。
 *    `src/cli_embed.rs` 用 `include_bytes!("../../packages/ijipu-cli/dist/ijipu-embed.js")`
 *    把它编进 `ijipu.exe`，而 `include_bytes!` 要求**编译那一刻文件已存在** ✗。
 *    正常路径：`tauri build` 的 `beforeBuildCommand`（= `npm run build`）里串了 `npm run cli:embed` ✓；
 *    但**裸 `cargo build` / `cargo test`**（干净克隆、没跑过任何 npm 脚本）也会走到这里 ⇒
 *    兜一个**占位产物**：能编译、能跑，但一跑就**明确报"产物缺失"**（绝不假装成功 ✗），
 *    同时打 `cargo:warning` 让人看见（口径见 `docs/CLI.md` §一之二）。
 * ② 其余照旧交给 `tauri_build::build()`。
 */
use std::path::Path;

/** 与 `cli_embed.rs` 的 `include_bytes!` **同一个文件**（改一处要一起改） */
const EMBED_JS: &str = "../packages/ijipu-cli/dist/ijipu-embed.js";

/**
 * 占位产物：`__ijipuCliMain` 一调就回"缺失"状态 ⇒ `cli_embed::run` 打成退出码 70 + 原因。
 * 比"编不过"更容易看懂，也比"静默跑出一份空结果"安全 ✓。
 */
const PLACEHOLDER: &str = "globalThis.__ijipuCliMain=function(){globalThis.__ijipuCliState={done:true,code:70,error:'内嵌 CLI 产物缺失（packages/ijipu-cli/dist/ijipu-embed.js）—— 请先跑 `npm run cli:embed`（或照常 `npx tauri build`）'} };\n";

fn main() {
    let embed = Path::new(EMBED_JS);
    if !embed.exists() {
        if let Some(dir) = embed.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match std::fs::write(embed, PLACEHOLDER) {
            Ok(()) => println!(
                "cargo:warning=内嵌 CLI 产物不存在，已写入**占位文件**（`ijipu.exe cli …` 会明确报错）；请跑 `npm run cli:embed`"
            ),
            Err(e) => println!("cargo:warning=内嵌 CLI 产物不存在，且写占位文件失败：{e}"),
        }
    }
    // 产物一变就重编（`include_bytes!` 自带依赖，这里再显式声明一次，双保险）
    println!("cargo:rerun-if-changed={EMBED_JS}");
    tauri_build::build()
}
