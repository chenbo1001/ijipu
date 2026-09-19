/**
 * iJipu 桌面端入口（Tauri v2 壳）
 * 前端为纯 Web 构建产物（vite build → ../dist），此处仅启动 WebView2 窗口。
 * 后端能力：
 *  - 采样音色库离线缓存读写（adj323）——soundfont 文本落在应用数据目录
 *    soundfonts/<lib_id>.js，前端通过 window.__TAURI__.core.invoke 调用。
 *  - 内置高质量音源（SF2）读取（adj346/adj416）——发布程序随包把 generaluser_gs.sf2
 *    放在安装目录，运行时直接读该文件（离线、无需联网下载）。
 *  - adj538：**外部打开**（双击 `.jps` / 文件关联）——路径经命令行参数进来，入队后通知前端；
 *    并提供"写回原文件"（保存时回读校验）。关联的注册/注销由 NSIS 钩子负责，见 `nsis/hooks.nsh`。
 */
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// adj538：待打开的 `.jps` 路径队列（去重前的原始路径，前端取走即清空）。
///
/// 为什么用队列 + 拉取，而不是直接把内容 emit 给前端：**冷启动存在竞态**——
/// `setup()` 阶段 emit 可能早于前端注册监听器，事件就丢了。所以路径先入队，
/// 前端在 mount 时（以及每次收到 `ijipu://open-files` 时）调 `take_pending_open_files` 拉取，
/// 拉取是幂等的"取走即清空"，重复调用不会重复打开。
#[derive(Default)]
struct PendingOpen(Mutex<Vec<String>>);

/// 是否是我们要接的文件参数：`.jps` 结尾且不是开关（`-`/`--`）。
/// 刻意**不按位置过滤**（不 `skip(1)`）：不同来源的 argv 是否含 argv[0]（exe 自身）并不一致
/// —— 单实例插件回传的参数含 exe 路径，而 exe 不会以 `.jps` 结尾，故"按后缀筛选"对两种口径都成立。
fn is_jps_arg(arg: &str) -> bool {
    !arg.starts_with('-') && arg.to_ascii_lowercase().ends_with(".jps")
}

/// 从 `OsString` 参数列表里挑出 `.jps` 路径（非 UTF-8 参数直接跳过，不 panic）。
fn jps_paths_from_os_args<I: IntoIterator<Item = OsString>>(args: I) -> Vec<String> {
    args.into_iter()
        .filter_map(|a| a.into_string().ok())
        .filter(|a| is_jps_arg(a))
        .collect()
}

/// 从 `String` 参数列表里挑出 `.jps` 路径（单实例插件回传的是 `Vec<String>`）。
fn jps_paths_from_string_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter().filter(|a| is_jps_arg(a)).collect()
}

/// 交给前端的一个外部文件：读失败时 `error` 有值（前端据此提示，而不是静默打不开）。
#[derive(serde::Serialize)]
struct ExternalFile {
    path: String,
    /// 文件名（去扩展名）——与前端 `fileBaseName` 同口径
    name: String,
    code: String,
    error: Option<String>,
}

fn read_external_file(path: &str) -> ExternalFile {
    let p = Path::new(path);
    let name = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "未命名".to_string());
    match std::fs::read_to_string(p) {
        Ok(code) => ExternalFile {
            path: path.to_string(),
            name,
            code,
            error: None,
        },
        Err(e) => ExternalFile {
            path: path.to_string(),
            name,
            code: String::new(),
            error: Some(e.to_string()),
        },
    }
}

/// adj538：取走待打开队列（前端 mount 时 / 收到 `ijipu://open-files` 后调用）。
#[tauri::command]
fn take_pending_open_files(state: tauri::State<'_, PendingOpen>) -> Vec<ExternalFile> {
    let paths = std::mem::take(&mut *state.0.lock().unwrap());
    paths.iter().map(|p| read_external_file(p)).collect()
}

/// adj538：写回外部文件（双击打开后 Ctrl+S 存回原文件）。
/// 与前端 FSA 路径**同口径**：写完**回读校验**，不一致就报错——宁可提示失败，也绝不谎报已保存
/// （对应 `src/store/saveSupport.ts` 的 `SaveVerifyError` 语义）。
#[tauri::command]
fn write_external_file(path: String, text: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("文件不存在或不是普通文件：{}", path));
    }
    std::fs::write(&p, &text).map_err(|e| format!("{}: {}", path, e))?;
    let back = std::fs::read_to_string(&p).map_err(|e| format!("回读失败 {}: {}", path, e))?;
    if back != text {
        return Err("写入后回读内容与预期不一致".to_string());
    }
    Ok(())
}

/// 把路径入队并通知前端（冷启动由 `setup()` 调用；热启动由单实例回调调用）。
fn queue_open_paths(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<PendingOpen>() {
        state.0.lock().unwrap().extend(paths.clone());
    }
    let _ = app.emit("ijipu://open-files", paths);
}

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

/// adj539：桌面端**不使用** Service Worker（前端资源随二进制内嵌，见 `src/main.tsx` 的 adj443 决定）。
///
/// 但**历史版本注册过的 SW 会跨版本存活在 WebView2 用户数据目录里**（实测：`com.ijipu.app\EBWebView\
/// Default\Service Worker\CacheStorage` 下堆了十几份 index.html，最早可追到 2026-09-13）。它会：
///   ① 在 SW 上下文里 fetch Tauri 自定义协议（拿不到，浏览器还会报
///      "cross-world service worker resource mismatch"）→ 回退到**缓存的旧 index.html**；
///   ② 旧 index.html 引用的 `/assets/<旧 hash>.js` 在新安装里已不存在 → Tauri 资源协议对未知路径
///      回 index.html（HTTP 200 + `text/html`）→ 模块脚本 MIME 校验失败 ⇒ **整个前端加载失败 = 白屏**。
/// 致命之处：`main.tsx` 里"卸载旧 SW + 清缓存"的补救代码**就在页面 JS 里**，而页面 JS 恰恰被这个 SW
/// 挡住 ⇒ 自我修复永远跑不到（死锁）。因此必须在 **webview 启动之前**从进程外清掉它的存储。
///
/// 只删 `Service Worker`（纯缓存），**不动** `Local Storage` / `IndexedDB` —— 用户设置、草稿、
/// 音色库缓存都在后者里，删了等于把用户数据清了。
fn purge_stale_service_worker(app_local_dir: &Path) {
    let sw = app_local_dir
        .join("EBWebView")
        .join("Default")
        .join("Service Worker");
    if !sw.is_dir() {
        return;
    }
    match std::fs::remove_dir_all(&sw) {
        Ok(()) => println!("[iJipu] 已清理遗留的 Service Worker 存储：{}", sw.display()),
        // 失败不致命：下次启动再试（例如目录被另一个实例占用）
        Err(e) => eprintln!("[iJipu] 清理 Service Worker 存储失败（忽略）：{}", e),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // adj539：必须在 webview 起来之前清（否则旧 SW 已经抢先把页面喂成白屏）——见函数注释。
    // WebView2 的用户数据目录 = `%LOCALAPPDATA%\<identifier>\EBWebView`（identifier 取自配置，不写死）。
    // 上下文只构造一次：既用来取 identifier，也交给下面的 `.build()`；
    // 显式标注运行时类型——`Context<R>::config()` 需要 `R: Runtime`，不给标注时 rustc 无法推断（E0283）。
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    #[cfg(target_os = "windows")]
    {
        let identifier = context.config().identifier.clone();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            purge_stale_service_worker(&PathBuf::from(local).join(identifier));
        }
    }
    tauri::Builder::default()
        // adj538：单实例插件**必须第一个注册**（插件按注册顺序执行；官方 README 要求）。
        // 作用：应用已在运行时再次双击 `.jps`，不再启动第二个进程，而是走这个回调——
        // 把窗口置前，并把文件路径入队通知前端打开。不做这一步就会出现"两个窗口、两份编辑状态"。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
            queue_open_paths(app, jps_paths_from_string_args(argv));
        }))
        .manage(PendingOpen::default())
        .setup(|app| {
            // 冷启动：双击 `.jps` 时路径就在本进程的命令行参数里（NSIS 写的是 `"ijipu.exe" "%1"`）。
            // v2 的 `Env` 默认已 manage（内容即 `std::env::args_os()`），用它避免非 UTF-8 参数 panic。
            queue_open_paths(app.handle(), jps_paths_from_os_args(app.env().args_os.clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sf_cache_read,
            sf_cache_write,
            sf_cache_remove,
            sf_soundfont_builtin_path,
            sf_soundfont_resource_read,
            take_pending_open_files,
            write_external_file
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS/iOS 不用命令行参数传"要打开的文件"，而是这个事件（该变体在 Windows/Linux 上不存在，
            // 故必须 cfg 门控——直接写会编译不过）。
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            {
                if let tauri::RunEvent::Opened { urls } = event {
                    let paths: Vec<String> = urls
                        .iter()
                        .filter_map(|u| u.to_file_path().ok())
                        .map(|p| p.display().to_string())
                        .collect();
                    queue_open_paths(app, paths);
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            {
                let _ = (app, event);
            }
        });
}
