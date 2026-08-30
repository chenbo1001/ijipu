/**
 * iJipu 桌面端入口（Tauri v2 壳）
 * 前端为纯 Web 构建产物（vite build → ../dist），此处仅启动 WebView2 窗口。
 * 后端能力（本地文件读写等）在后续迭代通过 Tauri commands 暴露。
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
