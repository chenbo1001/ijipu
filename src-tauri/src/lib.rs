/**
 * iJipu 桌面端入口（Tauri v2 壳）
 * 前端为纯 Web 构建产物（vite build → ../dist），此处仅启动 WebView2 窗口。
 * 后端能力：采样音色库离线缓存读写（adj323）——soundfont 文本落在应用数据目录
 * soundfonts/<lib_id>.js，前端通过 window.__TAURI__.core.invoke 调用。
 */
use tauri::Manager;

/// 读采样音色库缓存文件（app_data_dir/soundfonts/<lib_id>.js）；不存在返回 None。
#[tauri::command]
fn sf_cache_read(app: tauri::AppHandle, lib_id: String) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("soundfonts");
    let path = dir.join(format!("{}.js", lib_id));
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

/// 写采样音色库缓存文件（自动创建目录）。
#[tauri::command]
fn sf_cache_write(app: tauri::AppHandle, lib_id: String, text: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("soundfonts");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{}.js", lib_id)), text).map_err(|e| e.to_string())
}

/// 删除采样音色库缓存文件。
#[tauri::command]
fn sf_cache_remove(app: tauri::AppHandle, lib_id: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("soundfonts");
    let path = dir.join(format!("{}.js", lib_id));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![sf_cache_read, sf_cache_write, sf_cache_remove])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
