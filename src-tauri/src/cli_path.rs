/**
 * cli_path.rs — 把 iJipu **注册进 / 解除出当前用户 PATH**（adj944；adj946 改口径）
 *
 * 用户原话：「需要在全局设置里添加一个注册 iJipu CLI 的提示和按钮，未注册时显示「注册」、
 * 已注册时显示「解除」；**只有注册后，才能在打开终端时就能 `ijipu cli`**」。
 *
 * ⚠ **口径（adj946，用户实报 bug 后改）**：注册写进 PATH 的是**安装目录下的 `bin` 目录**
 *   （`<安装目录>\bin`，里面有控制台垫片 `ijipu.cmd`），**不是安装目录本身** ✗。
 *   原因：`ijipu.exe` 是 GUI 子系统程序 ⇒ cmd 不等它（提示符夹在输出中间、退出码拿不到、
 *   PowerShell 的 `>` 写出 0 字节文件）；cmd **会等批处理文件** ⇒ 垫片一次性修好这四条。
 *   **这条目录由 TS 侧 `binDirOf()` 从安装目录推导**（`packages/ijipu-cli/src/envPath.ts`）：
 *   本文件只提供"安装目录"这个事实，**不再自己拼一份** `\bin` ✓
 *   （同一几何/字符串口径只许一处定义，AGENTS §六之二·4；NSIS 卸载钩子里那份是跨语言、
 *    由 `scripts/smoke.mts` 的 `adj946` 闸门逐字核对）。
 *
 * ## 分工（**只有一份实现**，两端共用）
 *  · **字符串口径与编排**在 TS：`packages/ijipu-cli/src/envPath.ts`（`binDirOf` / `addDirToPath` /
 *    `removeDirFromPath` / `pathHasDir` + 三个编排函数）——应用界面（全局设置里的按钮）与
 *    命令行（`ijipu cli register|unregister|status`）调用的**就是同一组函数** ✓；
 *  · **本文件只做"碰系统"**：读写注册表、写前备份、写完**回读校验**、广播 `WM_SETTINGCHANGE`。
 *    为什么口径不在 Rust：本仓库的 Rust 单测在本机跑不起来（`0xC0000139`，见
 *    `docs/ERRORS-LOG.md` E-2026-427）⇒ 放在 Rust 的字符串规则**守不住**；
 *    放 TS 才能被 `npm run smoke` 的成对断言 + 负对照钉住 ✓（用户要求正是这样）。
 *
 * ## 安全口径（照 `nsis/hooks.nsh` 的既有原则：**只动自己写的东西**）
 *  · 注册模式是 **currentUser**（`installer.nsi` 的 `INSTALLMODE "currentUser"`）⇒ **只写 HKCU**、
 *    **不需要也不做提权** ✓；
 *  · 写前把原值**备份**到我们自己的键 `HKCU\Software\iJipu\CliPath`（含原值的类型）；
 *    写完**回读**，不一致 ⇒ **立刻用备份还原**并报错（与 `write_external_file`/`ws_write_text`
 *    的"宁可如实报失败，绝不谎报成功"同一口径 ✓）；
 *  · 值的类型（`REG_SZ` / `REG_EXPAND_SZ`）**跟着原值走**（原来没有 ⇒ 用 `REG_EXPAND_SZ`）——
 *    PATH 里常有 `%USERPROFILE%` 这类变量，写成 `REG_SZ` 会让它们**不再展开** ✗；
 *  · App Paths（可选便利，"运行"对话框／资源管理器地址栏也能敲 `ijipu`）：只写默认值；
 *    删的时候**先确认那个值确实指向我们**，并且键里再没有别的值/子键才删键 ✓。
 */
use std::path::PathBuf;

/**
 * PATH 值的**经典长度上限**（字符 = UTF-16 码元）。
 *
 * ⚠ 与 `packages/ijipu-cli/src/envPath.ts` 的 `PATH_MAX_CHARS` **同值**：那边是"注册前就算好、
 *   超了不写"的主判据，这里是**防御性二次检查**（万一有别的调用方绕过那一层）。
 *   跨语言没法共用常量 ⇒ 一致性由 `scripts/smoke.mts` 的 `adj944` 闸门逐字核对 ✓。
 */
pub const PATH_MAX_CHARS: usize = 2047;

/// 我们自己的备份键（写得进去、卸载时删得掉；**不动任何别人的键** ✓）
const BACKUP_KEY: &str = "Software\\iJipu\\CliPath";
const BACKUP_NAME: &str = "PathBackup";
const BACKUP_KIND: &str = "PathBackupKind";

/// 当前用户环境变量所在的键值（PATH）
const ENV_KEY: &str = "Environment";
const ENV_NAME: &str = "Path";

/// App Paths 的键路径（`ijipu.exe` 那个子键由我们建、也由我们删）
fn app_paths_key() -> String {
    "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\ijipu.exe".to_string()
}

/// 一次状态查询的结果（前端/CLI 用它渲染"已注册 / 未注册 + 实况"）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPathStatus {
    /// 安装目录（= `ijipu.exe` 所在目录；**只用于显示**，PATH 里写的是它下面的 `bin`，见文件头）
    pub install_dir: String,
    /// `ijipu.exe` 的完整路径（App Paths 用）
    pub exe_path: String,
    /// `HKCU\Environment\Path` 的原值（没有这个值 ⇒ None，前端按空串处理）
    pub path_value: Option<String>,
    /// 原值的类型名（`REG_EXPAND_SZ` / `REG_SZ` / 空串 = 值不存在）
    pub path_kind: String,
    /// App Paths 里当前指向的 exe（没建/没写 ⇒ None）
    pub app_paths_value: Option<String>,
    /// 我们备份的原值（诊断用；没备份过 ⇒ None）
    pub backup_value: Option<String>,
}

// ---------------------------------------------------------------------------
// exe / 安装目录
// ---------------------------------------------------------------------------

/// `ijipu.exe` 的完整路径（**App Paths 指向它**；PATH 里那条走的却是 `bin` 里的垫片，见文件头）
pub fn exe_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("取当前程序路径失败：{e}"))
}

/// 安装目录 = exe 所在目录（Windows 下 `resource_dir()` 与它是同一处，见 lib.rs 的说明）
///
/// ⚠ adj946：**它自己不再进 PATH** ✗ —— 进 PATH 的是 `<安装目录>\bin`，那条由 TS 的
/// `binDirOf()` 推导（见文件头"口径"）。
pub fn install_dir() -> Result<PathBuf, String> {
    let exe = exe_path()?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| format!("取安装目录失败：{} 没有父目录", exe.display()))
}

/// 安装目录（字符串版；给前端/CLI 与嵌入宿主用 —— 前端据此推导 `bin` 入口目录）
pub fn install_dir_string() -> Result<String, String> {
    Ok(install_dir()?.to_string_lossy().into_owned())
}

/// exe 完整路径（字符串版）
pub fn exe_path_string() -> Result<String, String> {
    Ok(exe_path()?.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// 对外 API（另有 tauri 命令包装，见文件末）
// ---------------------------------------------------------------------------

/// 读系统实况（**每次都现读注册表**；前端与 CLI 都不许自己记状态 ✗）
pub fn status() -> Result<CliPathStatus, String> {
    imp::status()
}

/// 把 PATH 写成 `next`（**调用方已用 TS 的纯函数算好**）：备份 → 写 → 回读校验 → 广播
pub fn write_env_path(next: &str) -> Result<(), String> {
    // 防御性长度检查：按 **UTF-16 码元**算（与 JS 的 `String.length` 同口径 ✓；
    // 用 `chars().count()` 会把"带 emoji 的路径"算少 ⇒ 与前端判据不一致 ✗）
    let len = next.encode_utf16().count();
    if len > PATH_MAX_CHARS {
        return Err(format!(
            "PATH 值有 {len} 字符，超过上限 {PATH_MAX_CHARS} —— 未写入（一个字都没改）"
        ));
    }
    imp::write_env_path(next)
}

/// 读 `HKCU\Environment\Path`（没有该值 ⇒ None）
pub fn read_env_path() -> Result<Option<String>, String> {
    imp::read_env_path()
}

/// 读 App Paths 的默认值（可选能力）
pub fn read_app_paths() -> Result<Option<String>, String> {
    imp::read_app_paths()
}

/// 写 App Paths（**可选便利**：只写默认值；失败不算注册失败 —— PATH 才是契约 ✓）
pub fn write_app_paths(exe: &str) -> Result<(), String> {
    imp::write_app_paths(exe)
}

/// 删 App Paths 里**我们自己的**那一条（不是我们写的不动 ✓）
pub fn remove_app_paths() -> Result<(), String> {
    imp::remove_app_paths()
}

// ---------------------------------------------------------------------------
// tauri 命令（应用界面走这三条；与 CLI 用的是**同一批** Rust 函数 ✓）
// ---------------------------------------------------------------------------

/// 看当前状态（已注册 / 未注册 + 实况）
#[tauri::command]
pub fn cli_path_status() -> Result<CliPathStatus, String> {
    status()
}

/// 注册：把**调用方算好的**新 PATH 值写进去，并写 App Paths
#[tauri::command]
pub fn cli_path_register(next: String) -> Result<(), String> {
    write_env_path(&next)?;
    // App Paths 是"运行对话框/资源管理器地址栏也能敲 ijipu"的**可选**便利 ⇒ 失败只记不报（PATH 已成立 ✓）
    if let Ok(exe) = exe_path_string() {
        if let Err(e) = write_app_paths(&exe) {
            eprintln!("[iJipu] 写 App Paths 失败（不影响 PATH 注册）：{e}");
        }
    }
    Ok(())
}

/// 解除：把**调用方算好的**新 PATH 值写进去，并删我们自己写的 App Paths
#[tauri::command]
pub fn cli_path_unregister(next: String) -> Result<(), String> {
    write_env_path(&next)?;
    if let Err(e) = remove_app_paths() {
        eprintln!("[iJipu] 清 App Paths 失败（不影响 PATH 解除）：{e}");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Windows 实现
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod imp {
    use super::*;
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, LPARAM};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyW, RegDeleteKeyW, RegDeleteValueW, RegOpenKeyExW, RegQueryInfoKeyW,
        RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE,
        REG_EXPAND_SZ, REG_SZ,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    /// UTF-16 + 结尾 NUL（Win32 的 `PCWSTR` 口径）
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// 把注册表读回的 UTF-16 字节转成字符串（**到第一个 NUL 为止**）
    fn utf16_to_string(buf: &[u8]) -> String {
        let units: Vec<u16> = buf
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
        String::from_utf16_lossy(&units[..end])
    }

    /// 值类型名（诊断/备份用）
    fn kind_name(kind: u32) -> &'static str {
        if kind == REG_EXPAND_SZ {
            "REG_EXPAND_SZ"
        } else if kind == REG_SZ {
            "REG_SZ"
        } else {
            "OTHER"
        }
    }

    /// 打开一个键（只读）；键不存在 ⇒ `Ok(None)`
    fn open_key_read(sub: &str) -> Result<Option<HKEY>, String> {
        let mut hkey: HKEY = std::ptr::null_mut();
        let rc = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                wide(sub).as_ptr(),
                0,
                KEY_QUERY_VALUE,
                &mut hkey,
            )
        };
        if rc == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if rc != ERROR_SUCCESS {
            return Err(format!("打开注册表键失败 HKCU\\{sub}（错误码 {rc}）"));
        }
        Ok(Some(hkey))
    }

    /// 打开一个键（**读+写**，不创建）；键不存在 ⇒ `Ok(None)`
    fn open_key_rw(sub: &str) -> Result<Option<HKEY>, String> {
        let mut hkey: HKEY = std::ptr::null_mut();
        let rc = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                wide(sub).as_ptr(),
                0,
                KEY_QUERY_VALUE | KEY_SET_VALUE,
                &mut hkey,
            )
        };
        if rc == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if rc != ERROR_SUCCESS {
            return Err(format!("打开注册表键（读写）失败 HKCU\\{sub}（错误码 {rc}）"));
        }
        Ok(Some(hkey))
    }

    /// 打开一个键（可写）；不存在就**创建**
    fn open_key_write(sub: &str) -> Result<HKEY, String> {
        let mut hkey: HKEY = std::ptr::null_mut();
        let rc = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, wide(sub).as_ptr(), 0, KEY_SET_VALUE, &mut hkey) };
        if rc == ERROR_SUCCESS {
            return Ok(hkey);
        }
        // 键不存在（或只读权限拿不到）⇒ 建它（我们建的键都在 HKCU 下，继承当前用户权限，无需提权 ✓）
        let rc = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, wide(sub).as_ptr(), &mut hkey) };
        if rc != ERROR_SUCCESS {
            return Err(format!("创建/打开注册表键失败 HKCU\\{sub}（错误码 {rc}）"));
        }
        Ok(hkey)
    }

    /// 读一个字符串值 ⇒ `(值, 类型)`；键或值不存在 ⇒ `Ok(None)`
    fn read_string_value(sub: &str, name: &str) -> Result<Option<(String, u32)>, String> {
        let Some(hkey) = open_key_read(sub)? else {
            return Ok(None);
        };
        let mut kind: u32 = 0;
        let mut size: u32 = 0;
        let rc = unsafe {
            RegQueryValueExW(
                hkey,
                wide(name).as_ptr(),
                std::ptr::null(),
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            )
        };
        if rc == ERROR_FILE_NOT_FOUND {
            unsafe { RegCloseKey(hkey) };
            return Ok(None);
        }
        if rc != ERROR_SUCCESS {
            unsafe { RegCloseKey(hkey) };
            return Err(format!("读注册表值失败 HKCU\\{sub}\\{name}（错误码 {rc}）"));
        }
        // 多给 2 字节：空值（size=0）时也给一个合法可写指针 ✓
        let mut buf = vec![0u8; size as usize + 2];
        let mut cap = buf.len() as u32;
        let rc = unsafe {
            RegQueryValueExW(
                hkey,
                wide(name).as_ptr(),
                std::ptr::null(),
                &mut kind,
                buf.as_mut_ptr(),
                &mut cap,
            )
        };
        unsafe { RegCloseKey(hkey) };
        if rc != ERROR_SUCCESS {
            return Err(format!("读注册表值失败 HKCU\\{sub}\\{name}（错误码 {rc}）"));
        }
        if kind != REG_SZ && kind != REG_EXPAND_SZ {
            return Err(format!(
                "HKCU\\{sub}\\{name} 不是字符串值（类型 {}），不敢按字符串改写",
                kind_name(kind)
            ));
        }
        Ok(Some((utf16_to_string(&buf[..cap as usize]), kind)))
    }

    /// 写一个字符串值（类型跟调用方给的一致）
    fn write_string_value(sub: &str, name: &str, value: &str, kind: u32) -> Result<(), String> {
        let hkey = open_key_write(sub)?;
        let data: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
        let rc = unsafe {
            RegSetValueExW(
                hkey,
                wide(name).as_ptr(),
                0,
                kind,
                data.as_ptr() as *const u8,
                (data.len() * 2) as u32,
            )
        };
        unsafe { RegCloseKey(hkey) };
        if rc != ERROR_SUCCESS {
            return Err(format!("写注册表值失败 HKCU\\{sub}\\{name}（错误码 {rc}）"));
        }
        Ok(())
    }

    /// 删一个值（键或值不存在 ⇒ 当成功，**幂等** ✓；**不创建键** ✓）
    fn delete_string_value(sub: &str, name: &str) -> Result<(), String> {
        let Some(hkey) = open_key_rw(sub)? else {
            return Ok(());
        };
        let rc = unsafe { RegDeleteValueW(hkey, wide(name).as_ptr()) };
        unsafe { RegCloseKey(hkey) };
        if rc != ERROR_SUCCESS && rc != ERROR_FILE_NOT_FOUND {
            return Err(format!("删注册表值失败 HKCU\\{sub}\\{name}（错误码 {rc}）"));
        }
        Ok(())
    }

    /// 键里还有多少值 / 子键（删键前的"确实空了"判据，照 `hooks.nsh` 的既有原则 ✓）
    fn key_counts(sub: &str) -> Result<(u32, u32), String> {
        let Some(hkey) = open_key_read(sub)? else {
            return Ok((0, 0));
        };
        let mut values: u32 = 0;
        let mut subkeys: u32 = 0;
        let rc = unsafe {
            RegQueryInfoKeyW(
                hkey,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
                &mut subkeys,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut values,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        unsafe { RegCloseKey(hkey) };
        if rc != ERROR_SUCCESS {
            return Err(format!("查询注册表键信息失败 HKCU\\{sub}（错误码 {rc}）"));
        }
        Ok((values, subkeys))
    }

    /// 删键（**只在键确实空了**时才删；有子键 ⇒ 系统自己会拒绝）
    fn delete_key_if_empty(sub: &str) -> Result<(), String> {
        let (values, subkeys) = key_counts(sub)?;
        if values > 0 || subkeys > 0 {
            return Ok(());
        }
        let rc = unsafe { RegDeleteKeyW(HKEY_CURRENT_USER, wide(sub).as_ptr()) };
        if rc != ERROR_SUCCESS && rc != ERROR_FILE_NOT_FOUND {
            return Err(format!("删注册表键失败 HKCU\\{sub}（错误码 {rc}）"));
        }
        Ok(())
    }

    /**
     * 广播 `WM_SETTINGCHANGE` + `"Environment"` —— 让**新起的进程**（新的资源管理器、
     * 新的终端）重新读环境块。
     *
     * ⚠ 已知边界（如实记，见 `docs/CLI.md`）：**已经开着的终端不会因此刷新** ——
     * 它们的环境块在进程创建时就固定了。所以界面/命令行都明说"**注册后要新开一个终端**" ✓。
     * `SMTO_ABORTIFHUNG` + 5 秒：某个卡死的顶层窗口不该把注册动作一起拖住。
     */
    pub(super) fn broadcast_environment_change() {
        let param: Vec<u16> = "Environment".encode_utf16().chain(std::iter::once(0)).collect();
        let mut result: usize = 0;
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                param.as_ptr() as LPARAM,
                SMTO_ABORTIFHUNG,
                5000,
                &mut result,
            );
        }
    }

    pub(super) fn status() -> Result<CliPathStatus, String> {
        let path = read_string_value(ENV_KEY, ENV_NAME)?;
        let app_paths = read_string_value(&app_paths_key(), "")?;
        let backup = read_string_value(BACKUP_KEY, BACKUP_NAME)?;
        Ok(CliPathStatus {
            install_dir: install_dir_string()?,
            exe_path: exe_path_string()?,
            path_value: path.as_ref().map(|(v, _)| v.clone()),
            path_kind: path.as_ref().map(|(_, k)| kind_name(*k).to_string()).unwrap_or_default(),
            app_paths_value: app_paths.map(|(v, _)| v),
            backup_value: backup.map(|(v, _)| v),
        })
    }

    pub(super) fn read_env_path() -> Result<Option<String>, String> {
        Ok(read_string_value(ENV_KEY, ENV_NAME)?.map(|(v, _)| v))
    }

    pub(super) fn write_env_path(next: &str) -> Result<(), String> {
        let before = read_string_value(ENV_KEY, ENV_NAME)?;
        // ① 写前备份原值（含类型）——异常时用它还原 ✓
        let (backup_value, backup_kind) = match &before {
            Some((v, k)) => (v.clone(), kind_name(*k).to_string()),
            None => (String::new(), "none".to_string()),
        };
        write_string_value(BACKUP_KEY, BACKUP_NAME, &backup_value, REG_SZ)?;
        write_string_value(BACKUP_KEY, BACKUP_KIND, &backup_kind, REG_SZ)?;
        // ② 写新值：类型**跟着原值走**（原来没有 ⇒ REG_EXPAND_SZ，PATH 里常有 %VAR%）
        let kind = before.as_ref().map(|(_, k)| *k).unwrap_or(REG_EXPAND_SZ);
        write_string_value(ENV_KEY, ENV_NAME, next, kind)?;
        // ③ 回读校验：不一致 ⇒ **还原备份**再报错（宁可如实报失败，绝不谎报成功 ✓）
        let back = read_string_value(ENV_KEY, ENV_NAME)?.map(|(v, _)| v).unwrap_or_default();
        if back != next {
            let restored = match before {
                Some((v, k)) => write_string_value(ENV_KEY, ENV_NAME, &v, k),
                None => delete_string_value(ENV_KEY, ENV_NAME),
            };
            return Err(match restored {
                Ok(()) => format!(
                    "写入后回读与预期不一致（已用备份还原原值；读回 {} 字符，期望 {} 字符）",
                    back.encode_utf16().count(),
                    next.encode_utf16().count()
                ),
                Err(e) => format!("写入后回读不一致，且**还原也失败**：{e}（备份在 HKCU\\{BACKUP_KEY}）"),
            });
        }
        // ④ 让**新进程**看到（正在运行的终端要重开，见 broadcast_environment_change 的说明）
        broadcast_environment_change();
        Ok(())
    }

    pub(super) fn read_app_paths() -> Result<Option<String>, String> {
        Ok(read_string_value(&app_paths_key(), "")?.map(|(v, _)| v))
    }

    pub(super) fn write_app_paths(exe: &str) -> Result<(), String> {
        write_string_value(&app_paths_key(), "", exe, REG_SZ)
    }

    pub(super) fn remove_app_paths() -> Result<(), String> {
        let key = app_paths_key();
        let Some((current, _)) = read_string_value(&key, "")? else {
            return Ok(());
        };
        // **只删我们自己写的**：值不指向我们就一个字都不动 ✓（大小写不敏感比较，Windows 路径口径）
        if !current.eq_ignore_ascii_case(&exe_path_string()?) {
            return Ok(());
        }
        delete_string_value(&key, "")?;
        delete_key_if_empty(&key)
    }
}

// ---------------------------------------------------------------------------
// 非 Windows：如实说"不支持"（桌面端只在 Windows 交付；但本文件要能在任意目标上编过）
// ---------------------------------------------------------------------------

#[cfg(not(windows))]
mod imp {
    use super::*;

    const UNSUPPORTED: &str = "注册 iJipu CLI 到 PATH 目前只在 Windows 上支持";

    pub(super) fn status() -> Result<CliPathStatus, String> {
        Err(UNSUPPORTED.to_string())
    }

    pub(super) fn read_env_path() -> Result<Option<String>, String> {
        Err(UNSUPPORTED.to_string())
    }

    pub(super) fn write_env_path(_next: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }

    pub(super) fn read_app_paths() -> Result<Option<String>, String> {
        Err(UNSUPPORTED.to_string())
    }

    pub(super) fn write_app_paths(_exe: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }

    pub(super) fn remove_app_paths() -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /**
     * 防御性长度检查按 **UTF-16 码元**算（与 TS 的 `String.length` 同口径）。
     *
     * 为什么值得单独钉一条：PATH 里常有中文用户名（`C:\Users\蜗牛\...`）——用 `chars().count()`
     * 在 BMP 字符上与 JS 一致，但遇到**星平面字符**（路径里的 emoji）就会比 JS 少算一半，
     * 于是"前端认为超长、Rust 认为没超"两处判据打架 ✗。这里就用一个星平面字符做负对照。
     */
    #[test]
    fn length_is_counted_in_utf16_units() {
        assert_eq!("abc".encode_utf16().count(), 3);
        assert_eq!("蜗牛".chars().count(), 2);
        assert_eq!("蜗牛".encode_utf16().count(), 2);
        // 🎵（U+1F3B5）在 UTF-16 里是 2 个码元、在 chars() 里只算 1 个 ⇒ 必须按 UTF-16 算
        assert_eq!("🎵".encode_utf16().count(), 2);
        assert_ne!("🎵".encode_utf16().count(), "🎵".chars().count());
        // 上限判据本身：刚好到上限放行、超一个就拒
        let at_limit = "a".repeat(PATH_MAX_CHARS);
        assert_eq!(at_limit.encode_utf16().count(), PATH_MAX_CHARS);
        assert!(over_limit_err(&at_limit).is_none());
        let over = "a".repeat(PATH_MAX_CHARS + 1);
        assert!(over_limit_err(&over).is_some());
    }

    /// 复刻 `write_env_path` 的长度判据（**不碰注册表**，纯判定）⇒ 单测可以无条件跑
    fn over_limit_err(value: &str) -> Option<u32> {
        let n = value.encode_utf16().count();
        if n > PATH_MAX_CHARS {
            Some(n as u32)
        } else {
            None
        }
    }
}
