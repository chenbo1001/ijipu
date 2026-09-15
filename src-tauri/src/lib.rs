/**
 * iJipu 桌面端入口（Tauri v2 壳）
 * 前端为纯 Web 构建产物（vite build → ../dist），此处仅启动 WebView2 窗口。
 * 后端能力：
 *  - 采样音色库离线缓存读写（adj323）——soundfont 文本落在应用数据目录
 *    soundfonts/<lib_id>.js，前端通过 window.__TAURI__.core.invoke 调用。
 *  - 内置高质量音源（SF2）读取（adj346/adj416）——发布程序随包把 generaluser_gs.sf2
 *    放在安装目录，运行时直接读该文件（离线、无需联网下载）。
 */
use std::path::PathBuf;
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

/// adj416：内置音源候选文件（按优先级）——安装目录根的 `<lib_id>.sf2` 优先（发布程序把
/// generaluser_gs.sf2 直接放在安装目录，用户看得见、可自行替换），其次兼容旧的
/// `soundfonts/<lib_id>.sf2` 子目录布局（便携版/旧发布）。
/// Windows 下 resource_dir() == exe 所在目录，故“安装目录”与“exe 旁”是同一处。
fn builtin_soundfont_candidates(app: &tauri::AppHandle, lib_id: &str) -> Result<Vec<PathBuf>, String> {
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let file = format!("{}.sf2", lib_id);
    Ok(vec![dir.join(&file), dir.join("soundfonts").join(&file)])
}

/// adj416：探测内置音源是否存在——命中时返回其绝对路径，未随包提供返回 None。
/// 前端用它**在下载前**决定是否显示「正在下载音色库」提示：安装目录已有该文件就直接用。
#[tauri::command]
fn sf_soundfont_builtin_path(app: tauri::AppHandle, lib_id: String) -> Result<Option<String>, String> {
    for path in builtin_soundfont_candidates(&app, &lib_id)? {
        if path.exists() {
            return Ok(Some(path.display().to_string()));
        }
    }
    Ok(None)
}

/// 读内置高质量音源资源（打包进桌面的 SF2/SF3，来自 bundle.resources，adj346/adj416）。
/// 返回**原始字节**：`tauri::ipc::Response` 走 raw body（大响应走 fetch 通道），
/// 前端拿到 ArrayBuffer——30MB 若按 JSON 数组序列化会膨胀数倍且极慢（E-2026-146）。
/// 未随包提供时返回 Err（前端回退联网下载）。
#[tauri::command]
fn sf_soundfont_resource_read(
    app: tauri::AppHandle,
    lib_id: String,
) -> Result<tauri::ipc::Response, String> {
    for path in builtin_soundfont_candidates(&app, &lib_id)? {
        if path.exists() {
            let bytes = std::fs::read(&path).map_err(|e| format!("{}: {}", path.display(), e))?;
            return Ok(tauri::ipc::Response::new(bytes));
        }
    }
    Err(format!("内置音源资源缺失: {}.sf2（未随包提供）", lib_id))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            sf_cache_read,
            sf_cache_write,
            sf_cache_remove,
            sf_soundfont_builtin_path,
            sf_soundfont_resource_read
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
