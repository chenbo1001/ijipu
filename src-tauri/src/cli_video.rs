/**
 * cli_video.rs — 命令行导出视频的**宿主侧**（adj1084）
 *
 * ## 为什么要"另起一个隐藏窗口"
 *
 * 成片要用 **WebCodecs**（`VideoEncoder` + `AudioEncoder`）、画布、字体、音色库 ——
 * 这些只在 WebView2 里有。而 `ijipu cli …` 走的是内嵌 QuickJS（`cli_embed.rs`），
 * 那里面连 DOM 都没有。两条路各走各的：
 *
 *   `ijipu.exe cli render -t mp4 …`（QuickJS）
 *     → 本模块 `export_blocking`：把请求写成临时 JSON，起一个
 *       `ijipu.exe --cli-video-job <任务文件>` 子进程
 *     → 子进程是正常的 Tauri 应用，只是窗口**隐藏**、前端一启动就看到任务
 *       （`src/main.tsx` → `export/video/cliWorker.ts`），用与应用完全同一份
 *       `createDynamicSession` + `encodeMp4` 出片
 *     → 前端分块把字节写回（`cli_video_write`），回报结果（`cli_video_result`）后退出
 *     → 父进程读结果文件，把 `{ok, bytes, audio}` 交回 QuickJS，CLI 按退出码收场
 *
 * ## 为什么任务走文件，不走命令行参数 / 管道
 *
 * · `.jps` 源码动辄几万行，Windows 命令行上限 32K 字符 ⇒ 参数传不下；
 * · MP4 可能是几十上百 MB，一行一条 JSON 的管道会被撑爆 ⇒ 只传**路径**，字节在子进程里落盘。
 *
 * ## 安全
 *
 * 任务文件在系统临时目录、名字带进程号与时间戳；`--cli-video-job` 只由本模块自己拼出来。
 * 前端那三条命令都要求"当前进程确实是出片窗口"（`is_worker()`），普通窗口调不动。
 */
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 当前进程是不是"出片窗口"（由 `--cli-video-job` 判定；`None` = 普通启动）
static JOB_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

/// 出片窗口的**最长**等待：20 分钟。超时说明前端卡死/崩了 —— 父进程不能陪它一起挂。
const WORKER_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// 从命令行参数里取 `--cli-video-job <路径>`（内部开关，不对外宣传）
pub fn job_arg() -> Option<PathBuf> {
    let mut it = std::env::args_os();
    while let Some(a) = it.next() {
        if a == "--cli-video-job" {
            return it.next().map(PathBuf::from);
        }
    }
    None
}

/// 启动时登记任务文件（`run()` 最开始调用；普通启动是 no-op）
pub fn init_from_args() {
    if let Some(p) = job_arg() {
        if let Ok(mut slot) = JOB_FILE.lock() {
            *slot = Some(p);
        }
    }
}

/// 本进程是不是出片窗口
pub fn is_worker() -> bool {
    JOB_FILE.lock().map(|s| s.is_some()).unwrap_or(false)
}

/// 出片窗口读任务：**原样回文件内容**（JSON 解析在前端做，Rust 不必懂谱面配置）
pub fn job_json() -> Option<String> {
    let p = JOB_FILE.lock().ok().and_then(|s| s.clone())?;
    std::fs::read_to_string(p).ok()
}

/// 结果文件与任务文件同目录、同名加 `.result`
fn result_path(job: &std::path::Path) -> PathBuf {
    let mut s = job.as_os_str().to_os_string();
    s.push(".result");
    PathBuf::from(s)
}

/// 出片窗口写进度：父进程在等待循环里读它，转成终端上的一行行进度。
///
/// 为什么走文件而不是 stdout 管道：子进程是 GUI 程序、不共享父进程的 stdout；
/// 一个几字节的小文件是两边都能碰到的**唯一**低耦合通道。
pub fn write_progress(p: f64, phase: &str) {
    let Some(job) = JOB_FILE.lock().ok().and_then(|s| s.clone()) else {
        return;
    };
    let mut path = job.as_os_str().to_os_string();
    path.push(".progress");
    let body = serde_json::json!({ "p": p.clamp(0.0, 1.0), "phase": phase });
    let _ = std::fs::write(PathBuf::from(path), body.to_string());
}

/// 父进程读进度（文件不存在 / 半截 JSON ⇒ `None`，不打断等待）
fn read_progress(job: &std::path::Path) -> Option<(f64, String)> {
    let mut path = job.as_os_str().to_os_string();
    path.push(".progress");
    let text = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some((
        v.get("p").and_then(|p| p.as_f64()).unwrap_or(0.0),
        v.get("phase").and_then(|s| s.as_str()).unwrap_or("").to_string(),
    ))
}

/// 出片窗口回报结果（写盘后由调用方退出进程）
pub fn write_result(ok: bool, bytes: u64, audio: bool, message: &str) {    let Some(job) = JOB_FILE.lock().ok().and_then(|s| s.clone()) else {
        return;
    };
    let body = serde_json::json!({
        "ok": ok,
        "bytes": bytes,
        "audio": audio,
        "message": message,
    });
    let _ = std::fs::write(result_path(&job), body.to_string());
}

/// 出片窗口写 MP4 分块：第一块覆盖、其余追加
pub fn write_chunk(path: &str, b64: &str, append: bool) -> Result<(), String> {
    if !is_worker() {
        return Err("cli_video_write 只允许出片窗口调用".to_string());
    }
    let data = base64_decode(b64).ok_or_else(|| "视频数据不是合法 base64".to_string())?;
    let p = PathBuf::from(path);
    if let Some(dir) = p.parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir).map_err(|e| format!("建目录失败 {}：{e}", dir.display()))?;
        }
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true);
    if append {
        opts.append(true);
    } else {
        opts.truncate(true);
    }
    use std::io::Write;
    let mut f = opts.open(&p).map_err(|e| format!("打开失败 {}：{e}", p.display()))?;
    f.write_all(&data).map_err(|e| format!("写入失败 {}：{e}", p.display()))?;
    Ok(())
}

/// 父进程（CLI）用：写任务 → 起子进程 → 等结果 → 清理。
///
/// 回包是**一行 JSON**（`{ok, error?, bytes?, audio?}`），由 `cli_embed` 原样交给 QuickJS：
/// 这里不抛异常，是因为"出片失败"是正常结果（CLI 要按退出码 4 报，并带上原因）。
pub fn export_blocking(req_json: &str) -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let job = std::env::temp_dir().join(format!("ijipu-video-{}-{}.json", std::process::id(), stamp));
    if let Err(e) = std::fs::write(&job, req_json) {
        return fail(&format!("写任务文件失败：{e}"));
    }
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return fail(&format!("找不到本程序路径：{e}")),
    };
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("--cli-video-job").arg(&job);
    // 调试版带控制台：不要为子进程再弹一个黑窗
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return fail(&format!("起出片窗口失败：{e}")),
    };
    let deadline = Instant::now() + WORKER_TIMEOUT;
    /*
     * 首次响应看门狗：90 秒内连"出片窗口已就绪"都没收到 ⇒ 页面没加载起来
     * （WebView2 用户数据目录被占、dist 资源坏了…）。这时**立刻报错**比干等 20 分钟有用得多。
     */
    let first_deadline = Instant::now() + Duration::from_secs(90);
    let mut last_progress = String::new();
    let mut seen_any = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) => {
                // 进度转给终端（只在变化时打，避免刷屏）
                if let Some((p, phase)) = read_progress(&job) {
                    seen_any = true;
                    let line = if p < 0.0 {
                        phase.clone()
                    } else {
                        format!("{:>3}%  {phase}", (p * 100.0).round() as u32)
                    };
                    if line != last_progress {
                        last_progress = line.clone();
                        crate::cli_embed::progress_line(&format!("  视频：{line}"));
                    }
                }
                if !seen_any && Instant::now() > first_deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = std::fs::remove_file(&job);
                    let _ = std::fs::remove_file(result_path(&job));
                    return fail(
                        "出片窗口 90 秒没有响应（页面可能没加载起来：WebView2 用户数据目录被占用，或安装损坏）。\n  \
                         可先关掉其它 iJipu 窗口再试；仍不行请重装应用。",
                    );
                }
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => {
                let _ = child.kill();
                return fail(&format!("等待出片窗口失败：{e}"));
            }
        }
    };
    let res = std::fs::read_to_string(result_path(&job)).ok();
    let _ = std::fs::remove_file(&job);
    let _ = std::fs::remove_file(result_path(&job));
    let mut progress_path = job.as_os_str().to_os_string();
    progress_path.push(".progress");
    let _ = std::fs::remove_file(PathBuf::from(progress_path));
    let Some(text) = res else {
        return fail(match status {
            None => "出片窗口超过 20 分钟没有结束，已终止（请缩短段落或检查是否卡在音源下载）".to_string(),
            Some(s) => format!("出片窗口没有留下结果（退出码 {:?}）", s.code()),
        });
    };
    let v: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => return fail(&format!("结果文件不是合法 JSON：{e}")),
    };
    if v.get("ok").and_then(|b| b.as_bool()) != Some(true) {
        return fail(v.get("message").and_then(|m| m.as_str()).unwrap_or("出片窗口报告失败（没有给出原因）"));
    }
    serde_json::json!({
        "ok": true,
        "bytes": v.get("bytes").and_then(|b| b.as_u64()).unwrap_or(0),
        "audio": v.get("audio").and_then(|b| b.as_bool()).unwrap_or(false),
    })
    .to_string()
}

fn fail(msg: impl AsRef<str>) -> String {
    serde_json::json!({ "ok": false, "error": msg.as_ref() }).to_string()
}

/// base64 解码（只为本模块的写盘分块；`cli_embed` 里那份是私有的，不跨模块借）
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let bytes = s.as_bytes();
    if bytes.len() % 4 != 0 {
        return None;
    }
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        })
    };
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().filter(|c| **c == b'=').count();
        if pad > 2 {
            return None;
        }
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            let v = if c == b'=' { 0 } else { val(c)? };
            n |= v << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_roundtrip() {
        assert_eq!(base64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(base64_decode("").unwrap(), Vec::<u8>::new());
        assert!(base64_decode("不是base64").is_none());
    }

    #[test]
    fn result_path_appends_suffix() {
        let p = result_path(std::path::Path::new(r"C:\Temp\job.json"));
        assert_eq!(p, std::path::PathBuf::from(r"C:\Temp\job.json.result"));
    }
}
