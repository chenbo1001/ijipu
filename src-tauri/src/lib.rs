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
 *  - adj568：**桌面端工作区**——原生"选文件夹" + 按**磁盘路径**读写 `.jps`（绕开 Chromium
 *    对「下载/桌面/文档」整个目录的敏感目录黑名单，见下方 `ws_*` 命令段的说明）。
 */
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// adj875：命令行（`@ijipu/cli`）的**能力宿主**模块（Windows 命名管道；默认不开启）。
mod cli_host;

/// adj944（用户需求「全局设置里加注册 iJipu CLI 的按钮」）：把**安装目录注册进当前用户 PATH** ——
/// 读写注册表 / 写前备份 / 回读校验 / 广播 `WM_SETTINGCHANGE` 都在这里；
/// **字符串口径与编排在 TS**（`packages/ijipu-cli/src/envPath.ts`），应用界面与命令行共用那一份 ✓。
mod cli_path;

/// adj942：**内嵌 CLI** —— `ijipu.exe cli …` 时用它跑编进 exe 的那段 JS（QuickJS），
/// **先于窗口**分流（见 `main.rs`）。只挂在 Windows 下：本轮交付物就是 `ijipu.exe` ✓。
#[cfg(windows)]
pub mod cli_embed;

/// adj945（用户需求「设置里加一个『查看 CLI 手册』按钮」）：用**系统默认程序**打开安装目录里的
/// 那份命令行手册 —— 走 Rust 侧调 opener（不经 ACL，路径由 `resource_dir()` 算），见该文件头说明。
mod cli_manual;

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

/// adj416：内置音源候选文件（按优先级）——安装目录根的 `<lib_id>.sf2` 优先，其次
/// `soundfonts/<lib_id>.sf2` 子目录。
/// Windows 下 resource_dir() == exe 所在目录，故“安装目录”与“exe 旁”是同一处。
///
/// adj894（用户要求「把内置的 generaluser_gs.sf2 也放在 soundfonts 里，和 LICENSE 放一起」）：
/// **随包布局改为 `soundfonts/`**（见 `tauri.conf.json` 的 `bundle.resources`），于是它与
/// `LICENSE-GeneralUserGS.txt` / `README.md` 同目录、一眼能看出是哪来的。
/// 两个候选都保留 ⇒ ① 旧的便携版布局照常可用；② 用户仍可把自备 sf2 放**安装目录根**来**覆盖**内置那份
/// （根目录**优先**于 soundfonts/，这正是把"可替换"这条路留在这里的原因）。
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

// ============================================================================
// adj568：桌面端「工作区」——原生选文件夹 + 按路径读写
//
// 为什么桌面端要另起一套（而不是继续用网页版的 File System Access）：
// Chromium 把「下载 / 桌面 / 文档 / 用户主目录」**整个目录**列进了敏感目录黑名单
// （`chrome_file_system_access_permission_context.cc` 的 `GenerateBlockPaths()`，
// BlockType = kDontBlockChildren ⇒ **只有该目录自身被封，子文件夹放行**），
// 于是"把「下载」直接设为工作区"必然被拒。更麻烦的是：
//   ① 该拦截**没有 API 可绕过**，网页层无法覆盖；
//   ② 抛出的错误是 **AbortError —— 与"用户点了取消"完全同一个错误**，
//      前端因此无法区分、只能静默（用户只看到浏览器弹框，App 一声不响）。
// 桌面壳里我们本就不受这条 **Web** 安全策略约束（用户在自己的电脑上显式选自己的目录），
// 所以直接用原生选择器拿**磁盘路径**，读写交给 Rust 侧的 `std::fs`。
// 附带好处：桌面端不再有"重开应用要重新授权目录"这一步。
//
// 安全口径不变：**所有相对段都在 Rust 侧再校验一次**（`check_ws_seg`），
// 前端 `normalizeRelPath` 不是唯一防线；写入同样**回读校验**（与 FSA 分支、`write_external_file` 一致）。
//
// ⚠ 这些命令一律写成 `#[tauri::command(async)]`：Tauri 的**同步命令跑在主线程上**，
// 而"列目录"在一次工作区扫描里会被调用几百次（还带并发）⇒ 同步实现会把整个窗口卡住、
// 并发也退化成串行。标 `async` 后 Tauri 把它们丢进线程池执行（函数体里是阻塞的 `std::fs`，正合适）。
// ============================================================================

/// 工作区目录里的一项（前端 `DirEntry` 的镜像；`mtime` 供"新的在上"排序用）
#[derive(serde::Serialize)]
struct WsEntry {
    name: String,
    /// 是否目录（`dir` 而非 `is_dir`：与前端 `DirEntry.kind` 的分流更直观）
    dir: bool,
    /// 修改时间（Unix 毫秒；取不到时为 0）
    mtime: u64,
}

/// 校验一段相对路径：非空、不是 `.` / `..`、不含路径分隔符与控制字符。
///
/// 前端 `normalizeRelPath()` 已经规整过一次，这里**必须再挡一次**——Rust 这侧拿到的是
/// 普通字符串，拼接前不校验的话一个 `..` 就能越出工作区；前端那道防线不该是唯一一道。
fn check_ws_seg(seg: &str) -> Result<(), String> {
    let bad = seg.is_empty()
        || seg == "."
        || seg == ".."
        || seg.contains('/')
        || seg.contains('\\')
        || seg.contains('\0');
    if bad {
        return Err(format!("非法路径段：{}", seg));
    }
    Ok(())
}

/// 工作区根 + 相对段 ⇒ 绝对路径（逐段校验，防路径穿越）
fn ws_path(root: &str, segs: &[String]) -> Result<PathBuf, String> {
    let mut p = PathBuf::from(root);
    for s in segs {
        check_ws_seg(s)?;
        p.push(s);
    }
    Ok(p)
}

/// 列目录——**刻意不过滤**（隐藏项 / 扩展名的口径留给前端，与 FSA 分支完全一致，
/// 免得两套后端对"什么该显示"出现分歧）。单条读元数据失败就跳过该条，不让整个列表失败。
#[tauri::command(async)]
fn ws_list_dir(root: String, segs: Vec<String>) -> Result<Vec<WsEntry>, String> {
    let dir = ws_path(&root, &segs)?;
    let rd = std::fs::read_dir(&dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    let mut out: Vec<WsEntry> = Vec::new();
    for item in rd.flatten() {
        let Ok(meta) = item.metadata() else { continue };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(WsEntry {
            name: item.file_name().to_string_lossy().to_string(),
            dir: meta.is_dir(),
            mtime,
        });
    }
    Ok(out)
}

/// 目录是否存在——工作区根被外部删掉/改名时，前端据此提示"目录已不在"而不是空列表
#[tauri::command(async)]
fn ws_dir_exists(root: String, segs: Vec<String>) -> bool {
    ws_path(&root, &segs).map(|p| p.is_dir()).unwrap_or(false)
}

/// 目录是否**完全为空**（判"空目录"必须列全部条目，不能只看 `.jps`——与 FSA 分支同口径）
#[tauri::command(async)]
fn ws_is_dir_empty(root: String, segs: Vec<String>) -> Result<bool, String> {
    let dir = ws_path(&root, &segs)?;
    let mut rd = std::fs::read_dir(&dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    Ok(rd.next().is_none())
}

/// 读一个文件的文本
#[tauri::command(async)]
fn ws_read_text(root: String, segs: Vec<String>) -> Result<String, String> {
    let p = ws_path(&root, &segs)?;
    std::fs::read_to_string(&p).map_err(|e| format!("{}: {}", p.display(), e))
}

/// 写一个文件并**回读校验**——与 FSA 分支、`write_external_file` 同一口径：
/// 宁可如实报失败，也绝不谎报"已保存"。
#[tauri::command(async)]
fn ws_write_text(root: String, segs: Vec<String>, text: String) -> Result<(), String> {
    let p = ws_path(&root, &segs)?;
    // 与 FSA 分支同口径：FSA 那条路 `getFileHandle(..., {create:true})` 会**顺带建出缺失的父目录**，
    // 桌面这条若只 `fs::write` 就会在"另存到子目录"时直接失败 ⇒ 这里显式补上，保持两套后端行为一致。
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
    }
    std::fs::write(&p, &text).map_err(|e| format!("{}: {}", p.display(), e))?;
    let back = std::fs::read_to_string(&p).map_err(|e| format!("回读失败 {}: {}", p.display(), e))?;
    if back != text {
        return Err("写入后回读内容与预期不一致".to_string());
    }
    Ok(())
}

/// 新建目录（同名已存在 ⇒ 返回 `EXISTS` 交给前端提示，不静默复用）
#[tauri::command(async)]
fn ws_create_dir(root: String, segs: Vec<String>) -> Result<(), String> {
    let p = ws_path(&root, &segs)?;
    if p.exists() {
        return Err("EXISTS".to_string());
    }
    std::fs::create_dir(&p).map_err(|e| format!("{}: {}", p.display(), e))
}

/// 删除一个文件
#[tauri::command(async)]
fn ws_remove_file(root: String, segs: Vec<String>) -> Result<(), String> {
    let p = ws_path(&root, &segs)?;
    std::fs::remove_file(&p).map_err(|e| format!("{}: {}", p.display(), e))
}

/// 删除一个**空**目录（非空 ⇒ 返回 `NOT_EMPTY`）
///
/// 为什么不做递归删除（与 FSA 分支同一理由）：工作区是用户自己的文件夹，
/// 里面可能混着照片/文档等**非 `.jps`** 的东西，`remove_dir_all` 会一起抹掉，**且没有回收站**。
#[tauri::command(async)]
fn ws_remove_empty_dir(root: String, segs: Vec<String>) -> Result<(), String> {
    let p = ws_path(&root, &segs)?;
    let mut rd = std::fs::read_dir(&p).map_err(|e| format!("{}: {}", p.display(), e))?;
    if rd.next().is_some() {
        return Err("NOT_EMPTY".to_string());
    }
    std::fs::remove_dir(&p).map_err(|e| format!("{}: {}", p.display(), e))
}

/// 原生「选文件夹」（adj568）——返回绝对路径；用户取消 ⇒ `None`。
///
/// 必须放在 `spawn_blocking` 里等：`blocking_pick_folder()` 是**阻塞**调用，
/// 直接在命令线程（主线程）上等会让窗口假死。
#[tauri::command]
async fn ws_pick_dir(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("选择工作区文件夹")
            .blocking_pick_folder()
    })
    .await
    .ok()
    .flatten()
    .and_then(|fp| fp.as_path().map(|p| p.to_string_lossy().into_owned()))
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
        // adj568：原生文件夹选择器（工作区）。同单实例插件：**只作 Rust 依赖**，
        // 我们用自己的 command 调它，故不需要 npm 包，也不需要补 ACL 权限。
        .plugin(tauri_plugin_dialog::init())
        // adj652：外部链接（预览里点了 `a.jp-link`）→ 交给系统默认浏览器。
        // 前端用 `core.invoke('plugin:opener|open_url', { url })` 调它（见 src/preview/openUrl.ts）。
        .plugin(tauri_plugin_opener::init())
        .manage(PendingOpen::default())
        .setup(|app| {
            // 冷启动：双击 `.jps` 时路径就在本进程的命令行参数里（NSIS 写的是 `"ijipu.exe" "%1"`）。
            // v2 的 `Env` 默认已 manage（内容即 `std::env::args_os()`），用它避免非 UTF-8 参数 panic。
            queue_open_paths(app.handle(), jps_paths_from_os_args(app.env().args_os.clone()));
            // adj875：命令行能力宿主（命名管道）。**默认不开** —— 只有显式给了
            // `IJIPU_CLI_HOST=1` 或内部开关 `--cli-host` 才起 ⇒ 双击打开的现状行为一字不变 ✓。
            cli_host::start_if_enabled(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sf_cache_read,
            sf_cache_write,
            sf_cache_remove,
            sf_soundfont_builtin_path,
            sf_soundfont_resource_read,
            take_pending_open_files,
            write_external_file,
            // adj568：桌面端工作区（原生选目录 + 按路径读写）
            ws_pick_dir,
            ws_list_dir,
            ws_dir_exists,
            ws_is_dir_empty,
            ws_read_text,
            ws_write_text,
            ws_create_dir,
            ws_remove_file,
            ws_remove_empty_dir,
            // adj944：注册/解除 iJipu CLI（把安装目录写进/摘出当前用户 PATH）
            cli_path::cli_path_status,
            cli_path::cli_path_register,
            cli_path::cli_path_unregister,
            // adj945：用系统默认程序打开安装目录里的 CLI 使用手册
            cli_manual::cli_manual_open,
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
