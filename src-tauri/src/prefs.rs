/**
 * prefs.rs — **桌面壳的本机配置**（adj1085）
 *
 * 为什么需要它（用户 2026-10-23 拍板）：
 *   WebView2 的 `localStorage` 落在 `%LOCALAPPDATA%\<identifier>\EBWebView\...`，
 *   那是**浏览器缓存目录**：重装、修复、profile 损坏、系统清理都可能让它没。
 *   桌面壳的「这个人怎么用」（主题、缩放、卡片模板、音色库选择、草稿…）不该寄在那里。
 *
 * 三端分工（同一个 `ijipu.*` 键空间，落点不同）：
 *   · 桌面壳：`%APPDATA%\iJipu\settings.json`（Roaming；卸载**不删**）
 *   · 网站/PWA：浏览器 `localStorage`（现状不变）
 *   · Obsidian 插件：插件目录 `data.json`（`main.ts` 的 `embedKv`，早已如此）
 *
 * 文件口径：
 *   `settings.json`      当前配置（人可读、可手改；`schema`/`app`/`updatedAt` + `values`）
 *   `settings.bak.json`  上一份（主文件坏掉时回退；每次保存前覆盖）
 *   `settings.json.tmp`  原子写的临时文件（写完 rename，读的人不会看到半截）
 *
 * 注意：**L2 谱面配置不在这里**（页边距/字号/背景图跟着 `.jps` 走），这里只放 L1 本机偏好。
 */
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 读盘结果（前端据此决定要不要做"从 WebView2 localStorage 迁移一次"）
#[derive(serde::Serialize)]
pub struct PrefsLoaded {
    /// 磁盘上有没有这份配置（`false` = 首次运行 ⇒ 前端把 localStorage 里现有的 `ijipu.*` 搬进来）
    pub exists: bool,
    /// 主文件坏了、用了备份（前端提示"配置已回退到上一份"）
    pub recovered: bool,
    /// 键值（**只收字符串**：与 `localStorage` 同语义）
    pub values: BTreeMap<String, String>,
}

/// 配置目录：`<config_dir>/iJipu`（Windows = `%APPDATA%\iJipu`）
pub fn prefs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .config_dir()
        .map_err(|e| format!("取系统配置目录失败：{e}"))?;
    Ok(base.join("iJipu"))
}

fn main_file(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

fn bak_file(dir: &Path) -> PathBuf {
    dir.join("settings.bak.json")
}

fn tmp_file(dir: &Path) -> PathBuf {
    dir.join("settings.json.tmp")
}

/// 把文件内容解析成"只有字符串值的表"。
/// 读不出 / 不是对象 ⇒ `None`（由调用方决定回退备份还是空表，不在这里猜）。
fn parse_values(text: &str) -> Option<BTreeMap<String, String>> {
    let root: serde_json::Value = serde_json::from_str(text).ok()?;
    let obj = root.as_object()?;
    // 新格式是 `{schema, app, updatedAt, values}`；也兼容"整份就是键值表"的旧/手写文件
    let values = match obj.get("values").and_then(|v| v.as_object()) {
        Some(v) => v,
        None => obj,
    };
    let mut out = BTreeMap::new();
    for (k, v) in values {
        if let Some(s) = v.as_str() {
            out.insert(k.clone(), s.to_string());
        }
    }
    Some(out)
}

fn read_values(path: &Path) -> Option<BTreeMap<String, String>> {
    let text = std::fs::read_to_string(path).ok()?;
    parse_values(&text)
}

/// 读配置：主文件 → 备份 → 空表（并如实标 `recovered`）
fn load_from(dir: &Path) -> PrefsLoaded {
    let main = main_file(dir);
    if let Some(values) = read_values(&main) {
        return PrefsLoaded {
            exists: true,
            recovered: false,
            values,
        };
    }
    if main.exists() {
        // 主文件在、但读不出来（半截/手改坏）：用备份，别把用户的设置悄悄清成默认
        if let Some(values) = read_values(&bak_file(dir)) {
            return PrefsLoaded {
                exists: true,
                recovered: true,
                values,
            };
        }
        return PrefsLoaded {
            exists: true,
            recovered: true,
            values: BTreeMap::new(),
        };
    }
    // 主文件不在、备份在：说明上次替换的中间态被打断，仍按"有配置"处理（避免二次迁移）
    if let Some(values) = read_values(&bak_file(dir)) {
        return PrefsLoaded {
            exists: true,
            recovered: true,
            values,
        };
    }
    PrefsLoaded {
        exists: false,
        recovered: false,
        values: BTreeMap::new(),
    }
}

/// 原子替换：Windows 用 `MoveFileExW(REPLACE_EXISTING)`，其它平台 `rename` 本身就是原子的。
#[cfg(windows)]
fn replace_file(tmp: &Path, dest: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
    let t: Vec<u16> = tmp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let d: Vec<u16> = dest.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let ok = unsafe { MoveFileExW(t.as_ptr(), d.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
    if ok == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(tmp: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::rename(tmp, dest)
}

/// 写配置：建目录 → 写 tmp（fsync）→ 备份旧文件 → 原子替换。
///
/// 为什么不是"每个键一次写"：`localStorage` 的调用点有 80+ 处，逐键写会把磁盘打碎；
/// 前端防抖后一次交全表，这里一次写完整份，语义反而更稳（不会出现"一半新一半旧"）。
fn save_to(dir: &Path, values: &BTreeMap<String, String>) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("建配置目录失败 {}：{e}", dir.display()))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let body = serde_json::json!({
        "schema": 1,
        "app": "iJipu",
        "updatedAt": now,
        "values": values,
    });
    let text = serde_json::to_string_pretty(&body).map_err(|e| format!("序列化配置失败：{e}"))?;
    let tmp = tmp_file(dir);
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("写临时文件失败 {}：{e}", tmp.display()))?;
        f.write_all(text.as_bytes())
            .map_err(|e| format!("写临时文件失败 {}：{e}", tmp.display()))?;
        // 落盘后再替换：断电时要么是旧文件、要么是新文件，不会是空文件
        f.sync_all().map_err(|e| format!("刷盘失败 {}：{e}", tmp.display()))?;
    }
    let main = main_file(dir);
    if main.exists() {
        // 备份失败不阻断保存（最坏只是这次没有上一份可回退）
        let _ = std::fs::copy(&main, bak_file(dir));
    }
    if let Err(e) = replace_file(&tmp, &main) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("替换配置失败 {}：{e}", main.display()));
    }
    Ok(())
}

/// 读配置（前端启动时**先于 store 求值**调用）
#[tauri::command]
pub fn prefs_load(app: AppHandle) -> Result<PrefsLoaded, String> {
    Ok(load_from(&prefs_dir(&app)?))
}

/// 写配置（前端防抖后交全表；`valuesJson` 是 `Record<string,string>` 的 JSON）
#[tauri::command]
pub fn prefs_save(app: AppHandle, values_json: String) -> Result<(), String> {
    let root: serde_json::Value =
        serde_json::from_str(&values_json).map_err(|e| format!("配置不是合法 JSON：{e}"))?;
    let obj = root.as_object().ok_or_else(|| "配置必须是键值对象".to_string())?;
    let mut values = BTreeMap::new();
    for (k, v) in obj {
        let s = v.as_str().ok_or_else(|| format!("配置值必须是字符串：{k}"))?;
        values.insert(k.clone(), s.to_string());
    }
    save_to(&prefs_dir(&app)?, &values)
}

/// 配置目录（给"打开配置目录"或排错用）
#[tauri::command]
pub fn prefs_path(app: AppHandle) -> Result<String, String> {
    Ok(prefs_dir(&app)?.display().to_string())
}

/// 大文件目录：`<config_dir>/iJipu/files`（卡片背景图等；settings.json 里只存 `ijipu-blob:<名>`）
fn files_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(prefs_dir(app)?.join("files"))
}

/**
 * 文件名校验：**只接受前端生成的 `<hex>.<图片扩展名>`**。
 *
 * 为什么卡这么死：这些命令会按名字写/删文件；名字如果来自 zip 条目或手改的 JSON，
 * 就可能是 `..\..\某文件`。白名单比"过滤 `..`"更稳（不用去想 Windows 的短名/设备名/UNC）。
 */
fn safe_blob_name(name: &str) -> bool {
    let Some((stem, ext)) = name.split_once('.') else {
        return false;
    };
    let hex = !stem.is_empty() && stem.len() <= 40 && stem.bytes().all(|b| b.is_ascii_hexdigit());
    let ext_ok = matches!(ext.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif");
    hex && ext_ok
}

/// 写一个附件（base64 进；已存在则覆盖 —— 同名即同内容，按内容哈希命名）
#[tauri::command]
pub fn prefs_blob_write(app: AppHandle, name: String, b64: String) -> Result<(), String> {
    if !safe_blob_name(&name) {
        return Err(format!("附件名不合法：{name}"));
    }
    let dir = files_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("建附件目录失败 {}：{e}", dir.display()))?;
    let bytes = crate::b64::decode(&b64).ok_or_else(|| "附件不是合法 base64".to_string())?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("附件超过 20 MB（卡片背景图请压到 2.5 MB 以内）".to_string());
    }
    let path = dir.join(&name);
    let tmp = dir.join(format!("{name}.tmp"));
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("写附件失败 {}：{e}", tmp.display()))?;
        f.write_all(&bytes).map_err(|e| format!("写附件失败 {}：{e}", tmp.display()))?;
        f.sync_all().map_err(|e| format!("刷盘失败 {}：{e}", tmp.display()))?;
    }
    replace_file(&tmp, &path).map_err(|e| format!("保存附件失败 {}：{e}", path.display()))?;
    Ok(())
}

/// 读一个附件（base64 回；不存在 ⇒ 明确报错）
#[tauri::command]
pub fn prefs_blob_read(app: AppHandle, name: String) -> Result<String, String> {
    if !safe_blob_name(&name) {
        return Err(format!("附件名不合法：{name}"));
    }
    let path = files_dir(&app)?.join(&name);
    let bytes = std::fs::read(&path).map_err(|e| format!("读附件失败 {}：{e}", path.display()))?;
    Ok(crate::b64::encode(&bytes))
}

/// 删一个附件（不存在视为成功；清理旧卡片图时不该因为"已经没了"报错）
#[tauri::command]
pub fn prefs_blob_delete(app: AppHandle, name: String) -> Result<(), String> {
    if !safe_blob_name(&name) {
        return Err(format!("附件名不合法：{name}"));
    }
    let path = files_dir(&app)?.join(&name);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删附件失败 {}：{e}", path.display())),
    }
}

/// 在资源管理器里打开配置目录（设置页按钮）
#[tauri::command]
pub fn prefs_open_dir(app: AppHandle) -> Result<(), String> {
    let dir = prefs_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("建配置目录失败 {}：{e}", dir.display()))?;
    #[cfg(windows)]
    let spawned = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(&dir).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(&dir).spawn();
    spawned.map(|_| ()).map_err(|e| format!("打开配置目录失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例一个独立临时目录（并行测试互不影响）
    fn temp_dir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("ijipu-prefs-test-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    fn sample() -> BTreeMap<String, String> {
        let mut m = BTreeMap::new();
        m.insert("ijipu.theme".to_string(), "ink".to_string());
        m.insert("ijipu.previewZoom".to_string(), "125".to_string());
        m
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = temp_dir("roundtrip");
        assert!(!load_from(&dir).exists, "没写过就不该说存在");
        save_to(&dir, &sample()).unwrap();
        let got = load_from(&dir);
        assert!(got.exists && !got.recovered);
        assert_eq!(got.values.get("ijipu.theme").map(String::as_str), Some("ink"));
        assert_eq!(got.values.get("ijipu.previewZoom").map(String::as_str), Some("125"));
        // 人可读：文件里有 schema/app，值是字符串
        let text = std::fs::read_to_string(main_file(&dir)).unwrap();
        assert!(text.contains("\"schema\": 1"));
        assert!(text.contains("\"app\": \"iJipu\""));
    }

    #[test]
    fn save_backs_up_previous_and_corrupt_main_recovers() {
        let dir = temp_dir("recover");
        save_to(&dir, &sample()).unwrap();
        let mut second = sample();
        second.insert("ijipu.theme".to_string(), "paper".to_string());
        save_to(&dir, &second).unwrap();
        assert!(bak_file(&dir).exists(), "第二次保存应留下上一份备份");
        // 把主文件写坏：加载必须回退到备份，而不是清成默认
        std::fs::write(main_file(&dir), "{ 半截").unwrap();
        let got = load_from(&dir);
        assert!(got.exists && got.recovered);
        assert_eq!(got.values.get("ijipu.theme").map(String::as_str), Some("ink"));
    }

    #[test]
    fn legacy_flat_object_is_readable() {
        let dir = temp_dir("legacy");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(main_file(&dir), r#"{"ijipu.theme":"minimal"}"#).unwrap();
        assert_eq!(load_from(&dir).values.get("ijipu.theme").map(String::as_str), Some("minimal"));
    }

    #[test]
    fn non_string_values_are_ignored_not_fatal() {
        let dir = temp_dir("nonstring");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(main_file(&dir), r#"{"values":{"a":"1","b":2,"c":{"x":1}}}"#).unwrap();
        let got = load_from(&dir);
        assert_eq!(got.values.len(), 1);
        assert_eq!(got.values.get("a").map(String::as_str), Some("1"));
    }

    #[test]
    fn blob_name_whitelist_blocks_traversal() {
        assert!(safe_blob_name("abcd0123.png"));
        assert!(safe_blob_name("AABB.jpg"));
        assert!(!safe_blob_name("../evil.png"));
        assert!(!safe_blob_name("abcd0123.exe"));
        assert!(!safe_blob_name("abcd0123"));
        assert!(!safe_blob_name("abcd/0123.png"));
    }
}
