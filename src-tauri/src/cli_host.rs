/**
 * cli_host.rs — 命令行（`@ijipu/cli`）的**能力宿主**：Windows 命名管道服务端（adj875）
 *
 * 为什么需要它（决策见 `docs/CLI-AND-COMMAND-PLAN.md` §九「二次裁决」）：
 *   CLI 的文本类命令（format/lint/info/render -t svg|midi …）**完全不碰应用**，直接调引擎 ✓；
 *   但 `render -t png|jpg|pdf`（canvas/字体/分页）与 `play -t wav`（AudioContext + 音色库）
 *   **只在应用里有**。所以应用对外只暴露**能力**（`rasterize` / `synthesize`），不暴露「命令」✗。
 *   两条通道：
 *     ① 应用**在跑** ⇒ **命名管道**（本文件）：CLI 连上来要能力，应用算完把字节回传；
 *     ② 应用**没跑** ⇒ CLI 起**一次性子进程**（下一批：exe 的内部模式 + 隐藏窗口）。
 *
 * 管道名**单一口径**（CLI 侧必须用同一条规则拼，否则会像 Obsidian 那次一样"连不上"，
 * 见其 forum 案例：管道名按显示名/账户名不一致 ⇒ 客户端永远找不到）：
 *     `\\.\pipe\ijipu-cli-<USERNAME>`（环境变量 `USERNAME`；取不到时用 `default`）
 *
 * 协议（**一行一个 JSON**，UTF-8；`id` 原样回传，便于客户端配对）：
 *     请求：`{"id":1,"method":"ping"}`
 *     成功：`{"id":1,"ok":true,"result":{…}}`
 *     失败：`{"id":1,"ok":false,"error":"…"}`   ← **如实报错，绝不假装成功** ✗
 *
 * 安全口径（沿用方案 B 的裁决③）：**默认不开**。要开需显式给 `IJIPU_CLI_HOST=1`
 * 环境变量或 `--cli-host` 内部开关（设置项接入后再补 `command`）。管道用**默认安全描述符**
 * （创建者 + SYSTEM/Administrators）⇒ 只允许**同一用户**连接；
 * 且只认下面这张**方法白名单**，未知方法一律拒绝。
 */
use tauri::AppHandle;

/// 能力宿主**是否被显式开启**（默认关；口径见文件头"安全"一节）
fn enabled_by_env_or_arg() -> bool {
    if std::env::var("IJIPU_CLI_HOST").map(|v| v == "1").unwrap_or(false) {
        return true;
    }
    std::env::args_os().any(|a| a == "--cli-host")
}

/// 管道名（**单一口径**：CLI 侧必须按同一规则拼，见文件头注释）
pub fn pipe_name() -> String {
    let user = std::env::var("USERNAME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "default".to_string());
    format!(r"\\.\pipe\ijipu-cli-{}", user)
}

/// 处理一条请求（**纯函数**：便于单测，也是"方法白名单"的唯一落点）
pub fn handle_line(line: &str) -> String {
    let req: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return reply(&serde_json::Value::Null, None, Some(format!("请求不是合法 JSON：{e}"))),
    };
    let id = req.get("id").cloned().unwrap_or(serde_json::Value::Null);
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    match method {
        // 连通性自检（CLI 用它判断"应用在不在跑"）
        "ping" => reply(&id, Some(serde_json::json!({ "pong": true, "proto": 1 })), None),
        // 能力自检。⚠ 现在**如实报 false**：本批只落了管道本身，把请求转交前端渲染
        // （复用 `src/ipc` 与 `src/export` 那套）是下一批 ⇒ 能力尚未接线，不许谎报 true ✗。
        // （注：这里用 `//` 而非块注释 —— Rust 块注释**可嵌套**，注释里出现路径通配会把后续代码吞掉，
        //   已踩一次：`E-2026-392`。）
        "capabilities" => reply(
            &id,
            Some(serde_json::json!({
                "raster": false,
                "audio": false,
                "reason": "能力通道已建立（管道），但渲染转交前端的接线尚未落地（下一批）"
            })),
            None,
        ),
        // 位图/音频：**明确报"还没接"**，而不是假装成功 ✗
        "rasterize" | "synthesize" => reply(
            &id,
            None,
            Some(format!("{method} 尚未接线：本批只落了管道与协议，渲染转交前端的通道待下一批")),
        ),
        "" => reply(&id, None, Some("缺少 method".to_string())),
        other => reply(&id, None, Some(format!("未知方法：{other}（白名单：ping / capabilities / rasterize / synthesize）"))),
    }
}

/// 回包**统一格式**（成功/失败二选一；`result` 与 `error` 不会同时出现）
fn reply(id: &serde_json::Value, result: Option<serde_json::Value>, error: Option<String>) -> String {
    let mut obj = serde_json::Map::new();
    obj.insert("id".to_string(), id.clone());
    match (result, error) {
        (Some(r), _) => {
            obj.insert("ok".to_string(), serde_json::Value::Bool(true));
            obj.insert("result".to_string(), r);
        }
        (None, Some(e)) => {
            obj.insert("ok".to_string(), serde_json::Value::Bool(false));
            obj.insert("error".to_string(), serde_json::Value::String(e));
        }
        // 两者都没给 = 编程错误：仍然给出**结构完整**的回包（不 panic ✗）
        (None, None) => {
            obj.insert("ok".to_string(), serde_json::Value::Bool(false));
            obj.insert("error".to_string(), serde_json::Value::String("内部错误：回包既无 result 也无 error".to_string()));
        }
    }
    let mut s = serde_json::Value::Object(obj).to_string();
    s.push('\n');
    s
}

/// 启动（幂等由调用点保证；未开启时**什么都不做** —— 现状行为一字不变 ✓）
pub fn start_if_enabled(_app: AppHandle) {
    if !enabled_by_env_or_arg() {
        return;
    }
    let name = pipe_name();
    eprintln!("[cli-host] 能力宿主已开启，管道：{name}");
    std::thread::spawn(move || loop {
        if let Err(e) = serve_once(&name) {
            eprintln!("[cli-host] 连接处理失败：{e}");
        }
    });
}

// ───────────────────────── Windows 实现 ─────────────────────────

#[cfg(windows)]
fn serve_once(name: &str) -> std::io::Result<()> {
    use windows_sys::Win32::Foundation::{GetLastError, INVALID_HANDLE_VALUE, ERROR_PIPE_CONNECTED};
    use windows_sys::Win32::Storage::FileSystem::PIPE_ACCESS_DUPLEX;
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    };

    /// 管道缓冲区（进/出各一份）：CLI 送来的 `.jps` 源码 + 回传的 base64 字节都要过得去
    const BUF: u32 = 64 * 1024;

    /// 句柄的 RAII 包装：任何提前 return 都不会漏句柄（`CloseHandle` 只在 Drop 里做一次 ✓）
    struct Handle(windows_sys::Win32::Foundation::HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
        }
    }

    let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let raw = CreateNamedPipeW(
            wide.as_ptr(),
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            BUF,
            BUF,
            0,
            std::ptr::null(),
        );
        if raw == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error());
        }
        let h = Handle(raw);

        // 等客户端连上。⚠ `ERROR_PIPE_CONNECTED`（535）表示"已经连上了"，同样是成功 ✗ 不能当失败。
        if ConnectNamedPipe(h.0, std::ptr::null_mut()) == 0 && GetLastError() != ERROR_PIPE_CONNECTED {
            return Err(std::io::Error::last_os_error());
        }

        // 一个连接上可以连续发多条请求（CLI 一次调用可能要问好几个方法）⇒ 读到 EOF 为止
        let mut pending: Vec<u8> = Vec::new();
        let mut buf = vec![0u8; BUF as usize];
        loop {
            let mut read: u32 = 0;
            let ok = windows_sys::Win32::Storage::FileSystem::ReadFile(
                h.0,
                buf.as_mut_ptr().cast(),
                BUF,
                &mut read,
                std::ptr::null_mut(),
            );
            if ok == 0 || read == 0 {
                break; // 出错或对端关闭：结束本次连接
            }
            pending.extend_from_slice(&buf[..read as usize]);
            // 逐行处理：协议是"一行一个 JSON" ✓
            while let Some(pos) = pending.iter().position(|b| *b == b'\n') {
                let line: Vec<u8> = pending.drain(..=pos).collect();
                let text = String::from_utf8_lossy(&line[..line.len() - 1]);
                if text.trim().is_empty() {
                    continue;
                }
                let out = handle_line(&text);
                write_all(h.0, out.as_bytes())?;
            }
        }
        // 收尾：先把缓冲刷给对端，再断开（顺序反了客户端会读到不完整的最后一行 ✗）
        let _ = windows_sys::Win32::Storage::FileSystem::FlushFileBuffers(h.0);
        let _ = DisconnectNamedPipe(h.0);
    }
    Ok(())
}

#[cfg(windows)]
fn write_all(handle: windows_sys::Win32::Foundation::HANDLE, mut data: &[u8]) -> std::io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::WriteFile;
    while !data.is_empty() {
        let mut written: u32 = 0;
        let ok = unsafe { WriteFile(handle, data.as_ptr().cast(), data.len() as u32, &mut written, std::ptr::null_mut()) };
        // ⚠ 字节模式管道**允许部分写** ⇒ 必须循环到写完，否则回包会被截断 ✗
        if ok == 0 || written == 0 {
            return Err(std::io::Error::last_os_error());
        }
        data = &data[written as usize..];
    }
    Ok(())
}

/// 非 Windows：**明确不提供**（能力通道只在桌面端成立）
#[cfg(not(windows))]
fn serve_once(_name: &str) -> std::io::Result<()> {
    Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "能力宿主目前只支持 Windows 命名管道"))
}

// ───────────────────────── 单测（真起管道、真连、真收发）─────────────────────────

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};

    /// **端到端**：真建管道 → 真连上 → 发一行 JSON → 读回包。
    /// 为什么值得有：这条通道的失败模式（管道名拼错、忘了 `ERROR_PIPE_CONNECTED`、
    /// 部分写截断）**只有真跑才现形**，纯函数单测一条都抓不到 ✗（E-2026-264 的教训）。
    #[test]
    fn pipe_round_trip() {
        let name = format!(r"\\.\pipe\ijipu-cli-test-{}", std::process::id());
        let server_name = name.clone();
        let server = std::thread::spawn(move || serve_once(&server_name));

        // 服务端建管道要一点时间 ⇒ 重试连接（失败即"管道还没建好"，不是缺陷 ✓）
        let mut client = None;
        for _ in 0..300 {
            match std::fs::OpenOptions::new().read(true).write(true).open(&name) {
                Ok(f) => {
                    client = Some(f);
                    break;
                }
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(20)),
            }
        }
        let mut client = client.expect("连接命名管道失败（300 次重试都没连上）");

        client.write_all(b"{\"id\":7,\"method\":\"ping\"}\n").expect("写请求失败");
        let mut reader = BufReader::new(client);
        let mut line = String::new();
        reader.read_line(&mut line).expect("读回包失败");

        let v: serde_json::Value = serde_json::from_str(line.trim()).expect("回包不是 JSON");
        assert_eq!(v["id"], serde_json::json!(7), "id 必须原样回传：{line}");
        assert_eq!(v["ok"], serde_json::json!(true), "ping 应成功：{line}");
        assert_eq!(v["result"]["pong"], serde_json::json!(true), "应回 pong：{line}");

        // 关掉客户端让服务端读到 EOF 并收尾（否则线程会一直挂着）
        drop(reader);
        server.join().expect("服务端线程 panic").expect("serve_once 返回 Err");
    }

    /// 未知方法：**如实报错**，而且 `id` 仍要回传（否则客户端无法配对 ✗）
    #[test]
    fn unknown_method_fails_but_keeps_id() {
        let v: serde_json::Value = serde_json::from_str(handle_line("{\"id\":\"a1\",\"method\":\"nope\"}").trim()).unwrap();
        assert_eq!(v["id"], serde_json::json!("a1"));
        assert_eq!(v["ok"], serde_json::json!(false));
        assert!(v["error"].as_str().unwrap().contains("未知方法"), "{v}");
    }

    /// 能力**如实**：还没接线就必须是 false（谎报 true 会让 CLI 走一条不通的路 ✗）
    #[test]
    fn capabilities_honest_false_before_wiring() {
        let v: serde_json::Value = serde_json::from_str(handle_line("{\"id\":1,\"method\":\"capabilities\"}").trim()).unwrap();
        assert_eq!(v["result"]["raster"], serde_json::json!(false));
        assert_eq!(v["result"]["audio"], serde_json::json!(false));
        // 只说"false"不够 —— 必须**带上原因**，否则 CLI 只能干瞪眼（口径同 doctor ✓）
        assert!(v["result"]["reason"].as_str().unwrap().contains("尚未"), "{v}");
    }
}
