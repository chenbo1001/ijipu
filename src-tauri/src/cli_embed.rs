/**
 * cli_embed.rs — **把命令行内嵌进 `ijipu.exe`**（adj942，用户裁定「直接落，修」·路线②）
 *
 * 为什么要这样：命令行（`packages/ijipu-cli`）本来是**独立 Node 包**，用户得先装 Node 才能用 ✗；
 * 而应用本体已经装了、大头（~30MB 音源）也在包里。把那段 JS 逻辑**编进 exe**、用内嵌的
 * QuickJS 跑（`rquickjs`），安装包只多 ~0.5MB 量级，用户**不必装 Node** ✓。
 *
 * ## 三条落地口径
 * 1. **不开窗口**：本模块在 `main()` 里**先于 `tauri::Builder`** 被调用（见 `main.rs`）——
 *    是 CLI 形态就只跑 CLI，`std::process::exit(退出码)`，绝不建窗口 ✓。
 * 2. **不硬造 `node:fs`**：JS 侧只做接线（`packages/ijipu-cli/src/embedEntry.ts`），
 *    文件读写/stdout 全由本模块注入（`__ijipuHost`）⇒ 少造一层假模块 ✓。
 *    adj944 起还多注入一组 `cliPath`（安装目录 / 读写 `HKCU\Environment\Path` / App Paths）——
 *    那是"注册 iJipu CLI"要用的系统能力，逻辑（分号切分、长度上限、幂等）在
 *    `packages/ijipu-cli/src/envPath.ts`，与全局设置里那个按钮**共用一份** ✓。
 * 3. **与"双击 `.jps` 打开 GUI"不冲突**：只认**明确子命令** `cli`（`ijipu.exe cli lint 谱.jps`）。
 *    `.jps` 路径作为第一个参数时**照旧进 GUI** ✓（判据是 `split_cli_args`，有单测钉着）。
 *
 * ## 异步怎么处理（关键实现点）
 * `runCli()` 是 `async`；本模块注入的宿主函数**全是同步的** ⇒ 每次 `await` 只挂起一个
 * "已 resolve 的微任务"。所以：调 `__ijipuCliMain()` → 循环 `execute_pending_job()` 把
 * 微任务队列跑干 → 读 `__ijipuCliState`（done / code / error）。**没有任何真异步** ✓。
 *
 * ## 控制台（`ijipu.exe` 是 GUI 子系统）
 * GUI 子系统进程默认**没有控制台** ⇒ 直接 `println!` 会被丢掉。这里：
 *   ① `AttachConsole(ATTACH_PARENT_PROCESS)`（挂到调用它的那个终端上），失败再 `AllocConsole()`；
 *   ② **只在 std 句柄无效时**才换成 `CONOUT$/CONIN$` —— 重定向到文件/管道时那些句柄是有效的，
 *      覆盖掉就等于把重定向弄丢 ✗；
 *   ③ 输出分流：**控制台句柄**走 `WriteConsoleW`（UTF-16，中文不受代码页影响 ✓）；
 *      **文件/管道**走 `WriteFile`（原始 UTF-8 字节，与 Node 版逐字节同口径 ✓）。
 *
 * ⚠ 已知限制（如实记，见 `docs/CLI.md`）：`rasterize`/`synthesize`/`watchFile` **没有注入** ⇒
 * `render -t png|jpg|pdf`、`play -t wav`、`lint --watch` 会**如实报错**（退出码 4 / 1），
 * 与"独立 Node 环境"完全同一口径 —— 能力通道的接线是另一批（`cli_host.rs` 的文件头有说明）。
 */
use rquickjs::{Array, Context, Ctx, Exception, FromJs, Function, Object, Runtime, Value};
use std::ffi::OsString;
use std::path::Path;

/// 内嵌的 CLI 产物（构建期由 `npm run cli:embed` 产出；`build.rs` 保证文件一定在 ✓）
const EMBED_JS: &[u8] = include_bytes!("../../packages/ijipu-cli/dist/ijipu-embed.js");

/// CLI 形态的**唯一**前缀（用户口径：与"双击 `.jps` 开 GUI"必须分得开）
const CLI_SUBCOMMAND: &str = "cli";

/** 微任务队列最多跑多少步（正常几十~几千步；这个上限只是防"永不停歇的 promise 链"） */
const MAX_JOBS: usize = 1_000_000;

/** 内部错误（接线层/引擎加载失败）的退出码 —— 与 CLI 的 0–5 区分开，见 `docs/CLI.md` */
pub const EXIT_INTERNAL: i32 = 70;

#[cfg(windows)]
mod con {
    //! Windows 控制台接入（口径见文件头 ③）
    use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, ReadFile, WriteFile, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Console::{
        AllocConsole, AttachConsole, GetConsoleMode, GetStdHandle, SetStdHandle, WriteConsoleW,
        ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE, STD_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };

    /// 把 std 流接到一个控制台上（父进程的优先；没有就自己开一个）
    ///
    /// ⚠ **必须先存下原来的句柄**：`AttachConsole` / `AllocConsole` 会**把 std 句柄改成新控制台的**，
    /// 于是 `ijipu.exe cli lint x > out.txt` 这种重定向会被**悄悄丢掉**（实测：文件是空的 ✗）。
    /// 正确口径：① 原来就有有效句柄（重定向到文件/管道）⇒ **原样还原**，那个句柄优先 ✓；
    /// ② 原来没有（纯双击/无终端）⇒ 才挂 `CONOUT$` / `CONIN$` 自己开控制台。
    pub fn attach() {
        unsafe {
            let saved: [HANDLE; 3] = [
                GetStdHandle(STD_INPUT_HANDLE),
                GetStdHandle(STD_OUTPUT_HANDLE),
                GetStdHandle(STD_ERROR_HANDLE),
            ];
            if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
                AllocConsole();
            }
            restore(STD_INPUT_HANDLE, saved[0], "CONIN$");
            restore(STD_OUTPUT_HANDLE, saved[1], "CONOUT$");
            restore(STD_ERROR_HANDLE, saved[2], "CONOUT$");
        }
    }

    /// 有原句柄就还原原句柄；没有才用设备名开一个（口径见 `attach()`）
    unsafe fn restore(which: STD_HANDLE, saved: HANDLE, device: &str) {
        if !saved.is_null() && saved != INVALID_HANDLE_VALUE {
            unsafe { SetStdHandle(which, saved) };
            return;
        }
        let wide: Vec<u16> = device.encode_utf16().chain(std::iter::once(0)).collect();
        let h: HANDLE = unsafe {
            CreateFileW(
                wide.as_ptr(),
                FILE_GENERIC_READ | FILE_GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        if h != INVALID_HANDLE_VALUE {
            unsafe { SetStdHandle(which, h) };
        }
    }

    /// 写一段文本（控制台走 UTF-16，文件/管道走 UTF-8 字节）
    fn write(which: STD_HANDLE, text: &str) {
        unsafe {
            let h = GetStdHandle(which);
            if h.is_null() || h == INVALID_HANDLE_VALUE {
                return;
            }
            let mut mode = 0u32;
            if GetConsoleMode(h, &mut mode) != 0 {
                let wide: Vec<u16> = text.encode_utf16().collect();
                let mut off = 0usize;
                while off < wide.len() {
                    let mut written = 0u32;
                    let ok = WriteConsoleW(
                        h,
                        wide[off..].as_ptr(),
                        (wide.len() - off) as u32,
                        &mut written,
                        std::ptr::null(),
                    );
                    if ok == 0 || written == 0 {
                        break;
                    }
                    off += written as usize;
                }
            } else {
                let bytes = text.as_bytes();
                let mut off = 0usize;
                while off < bytes.len() {
                    let mut written = 0u32;
                    let ok = WriteFile(
                        h,
                        bytes[off..].as_ptr(),
                        (bytes.len() - off) as u32,
                        &mut written,
                        std::ptr::null_mut(),
                    );
                    if ok == 0 || written == 0 {
                        break;
                    }
                    off += written as usize;
                }
            }
        }
    }

    pub fn write_out(text: &str) {
        write(STD_OUTPUT_HANDLE, text)
    }

    pub fn write_err(text: &str) {
        write(STD_ERROR_HANDLE, text)
    }


    /// 读完 stdin（`-i -` / 省略 `-i` 时用）。
    /// 没有重定向（交互式控制台）时也照读 —— 与 Node 版"没输入就等输入"同口径 ✓，
    /// 由用户用 Ctrl+Z / Ctrl+D 结束（不静默当成空串 ✗）。
    pub fn read_stdin_all() -> String {
        unsafe {
            let h = GetStdHandle(STD_INPUT_HANDLE);
            if h.is_null() || h == INVALID_HANDLE_VALUE {
                return String::new();
            }
            let mut buf: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 8192];
            loop {
                let mut read = 0u32;
                let ok = ReadFile(
                    h,
                    chunk.as_mut_ptr(),
                    chunk.len() as u32,
                    &mut read,
                    std::ptr::null_mut(),
                );
                if ok == 0 || read == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..read as usize]);
            }
            String::from_utf8_lossy(&buf).into_owned()
        }
    }
}

/**
 * adj1084：给"命令行导出视频"的父进程打进度行（`cli_video.rs` 在等待循环里调）。
 *
 * 为什么不直接用 `con::write_err`：`con` 是 Windows 专用的私有模块；
 * 这里开一个跨平台的小口子，保证非 Windows 编译也能过（那边只打印到 stderr）。
 */
pub fn progress_line(text: &str) {
    // 自己补换行：`con::write_err` 只写原文（CLI 的 `err` 在 JS 侧已带换行，这里不是同一条路）
    #[cfg(windows)]
    con::write_err(&format!("{text}\n"));
    #[cfg(not(windows))]
    eprintln!("{text}");
}

/**
 * 把进程参数切成"内嵌 CLI 的 argv"。**纯函数**（有单测钉着，见文件末）：
 *  · 第一个参数**恰好**是 `cli` ⇒ 回剩下的参数（`ijipu.exe cli lint a.jps` ⇒ `["lint","a.jps"]`）；
 *  · 其余一律 `None` ⇒ 交给 GUI（**双击 `.jps` / `--cli-host` / 无参数**都走这条路 ✓）。
 */
pub fn split_cli_args<I: IntoIterator<Item = OsString>>(args: I) -> Option<Vec<String>> {
    let mut it = args.into_iter();
    let _exe = it.next(); // argv[0]：exe 自身
    let first = it.next()?;
    if first != std::ffi::OsStr::new(CLI_SUBCOMMAND) {
        return None;
    }
    Some(it.map(|a| a.to_string_lossy().into_owned()).collect())
}

/// 从**本进程**的参数判断并跑内嵌 CLI：是 CLI 形态 ⇒ `Some(退出码)`；否则 `None`（照旧开窗口 ✓）
pub fn try_run_from_env() -> Option<i32> {
    split_cli_args(std::env::args_os()).map(|argv| run(&argv))
}

/// 跑一次内嵌 CLI，返回进程退出码（CLI 的 0–5，或接线失败的 70）
///
/// ⚠ **必须在大栈线程上跑**（本轮实测）：QuickJS 是按 **C 栈深度**判"栈溢出"的
/// （`js_check_stack_overflow`），而"解析 190KB 产物 + 跑引擎初始化"对栈的需求**超过主线程的默认栈**
/// —— 实测在主线程上（QuickJS 上限 8MiB）直接抛 `RangeError: Maximum call stack size exceeded`，
/// 换到 **64MiB 栈**的工作线程后正常（同一份产物、同一套调用）。
/// 所以：起一个 64MiB 栈的工作线程，并把 QuickJS 的上限设到它允许的最大值
/// （16MiB；`JS_SetMaxStackSize` 把 >16MiB 当"不限"，那样真溢出就只有崩溃、没有可读报错 ✗）。
/// 实测：上限 8MiB 与 16MiB **都通过**（本条只影响"栈不够时是报错还是崩溃"）。
pub fn run(argv: &[String]) -> i32 {
    let argv = argv.to_vec();
    let spawned = std::thread::Builder::new()
        .name("ijipu-cli".to_string())
        .stack_size(CLI_THREAD_STACK)
        .spawn(move || run_inner(&argv));
    match spawned {
        Ok(handle) => match handle.join() {
            Ok(Ok(code)) => code,
            Ok(Err(msg)) => report_internal(&msg),
            Err(_) => report_internal("内嵌 CLI 线程 panic（产物或引擎内部异常）"),
        },
        Err(e) => report_internal(&format!("起大栈工作线程失败：{e}")),
    }
}

/// 工作线程栈（够 QuickJS 解析产物 + 引擎排版递归；见 `run()` 的说明）
const CLI_THREAD_STACK: usize = 64 * 1024 * 1024;

/// QuickJS 自己的上限：`JS_SetMaxStackSize` 把 >16MiB 当"不限" ⇒ 取满值（详见 `run()`）
const QUICKJS_STACK_LIMIT: usize = 16 * 1024 * 1024;

fn report_internal(msg: &str) -> i32 {
    #[cfg(windows)]
    con::write_err(&format!("[iJipu 内嵌 CLI] {msg}\n"));
    #[cfg(not(windows))]
    eprintln!("[iJipu 内嵌 CLI] {msg}");
    EXIT_INTERNAL
}

fn run_inner(argv: &[String]) -> Result<i32, String> {
    #[cfg(windows)]
    con::attach();
    let rt = Runtime::new().map_err(|e| format!("初始化内嵌 JS 引擎失败：{e}"))?;
    rt.set_max_stack_size(QUICKJS_STACK_LIMIT);
    rt.set_memory_limit(512 * 1024 * 1024);
    let ctx = Context::full(&rt).map_err(|e| format!("创建内嵌 JS 上下文失败：{e}"))?;
    ctx.with(|ctx| {
        let host = build_host(&ctx, argv).map_err(|e| format!("注入宿主能力失败：{e}"))?;
        ctx.globals()
            .set("__ijipuHost", host)
            .map_err(|e| format!("注入宿主能力失败：{e}"))?;
        ctx.eval::<(), _>(EMBED_JS)
            .map_err(|e| format!("内嵌 CLI 脚本加载失败：{}", describe(&ctx, &e)))?;
        let main: Function = ctx
            .globals()
            .get("__ijipuCliMain")
            .map_err(|e| format!("内嵌 CLI 产物缺少 __ijipuCliMain 入口（请重跑 `npm run cli:embed`）：{e}"))?;
        main.call::<_, ()>(())
            .map_err(|e| format!("内嵌 CLI 入口调用失败：{}", describe(&ctx, &e)))?;
        // 把微任务跑干（宿主函数都是同步的 ⇒ 这里没有真异步，见文件头）
        for _ in 0..MAX_JOBS {
            if !ctx.execute_pending_job() {
                break;
            }
        }
        let state: Object = ctx
            .globals()
            .get("__ijipuCliState")
            .map_err(|e| format!("内嵌 CLI 没有回传状态：{e}"))?;
        let done: bool = state.get("done").unwrap_or(false);
        let code: i32 = state.get("code").unwrap_or(EXIT_INTERNAL);
        let error: Option<String> = state.get("error").unwrap_or(None);
        if let Some(e) = error {
            return Err(format!("内嵌 CLI 执行异常（不是用法错误）：{e}"));
        }
        if !done {
            return Err("内嵌 CLI 没有跑完（微任务队列提前空了）".to_string());
        }
        Ok(code)
    })
}

/// 注入宿主能力（**同步 + 字符串**，二进制走 base64 —— 口径见 `embedEntry.ts` 的文件头）
fn build_host<'js>(ctx: &Ctx<'js>, argv: &[String]) -> rquickjs::Result<Object<'js>> {
    let host = Object::new(ctx.clone())?;
    host.set("argv", argv.to_vec())?;
    host.set(
        "readStdin",
        Function::new(ctx.clone(), || -> String {
            #[cfg(windows)]
            {
                con::read_stdin_all()
            }
            #[cfg(not(windows))]
            {
                String::new()
            }
        }),
    )?;
    host.set(
        "readFile",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'js>, path: String| -> rquickjs::Result<String> {
                std::fs::read_to_string(&path)
                    .map_err(|e| Exception::throw_message(&ctx, &read_failed(&path, &e)))
            },
        ),
    )?;
    host.set(
        "writeFile",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'js>, path: String, text: String| -> rquickjs::Result<()> {
                write_all(&path, text.as_bytes())
                    .map_err(|e| Exception::throw_message(&ctx, &format!("写入失败 {path}：{e}")))
            },
        ),
    )?;
    host.set(
        "writeFileBinary",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'js>, path: String, base64: String| -> rquickjs::Result<()> {
                let bytes = base64_decode(&base64)
                    .ok_or_else(|| Exception::throw_message(&ctx, "二进制数据不是合法 base64"))?;
                write_all(&path, &bytes)
                    .map_err(|e| Exception::throw_message(&ctx, &format!("写入失败 {path}：{e}")))
            },
        ),
    )?;
    host.set(
        "listDir",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'js>, dir: String| -> rquickjs::Result<Array<'js>> {
                let rd = std::fs::read_dir(&dir)
                    .map_err(|e| Exception::throw_message(&ctx, &format!("读目录失败 {dir}：{e}")))?;
                /*
                 * adj956：回 `{ name, dir }[]`（与 node 入口、`EmbedHost` 类型同口径）。
                 *
                 * 为什么不再回纯字符串数组：`batch` / `lint -i <目录>` 的 `-r` 要下钻子目录，
                 * 而"只有名字"分不出哪个是目录 ✗。这里用一次 `read_dir` 的 `file_type()` 就给全，
                 * 不必再额外 `stat`。
                 * `file_type()` 失败（极少见）按"不是目录"处理 —— 那样只会少扫一层，不会崩 ✓。
                 *
                 * ⚠ 用 `/* */` 而不是 `/** */`：Rust 的**文档注释**只能挂在条目上，
                 *   写在语句前面会报 `unused doc comment` 警告（我第一版就是这么写的）。
                 */
                let mut items: Vec<(String, bool)> = rd
                    .flatten()
                    .filter_map(|e| {
                        let name = e.file_name().into_string().ok()?;
                        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                        Some((name, is_dir))
                    })
                    .collect();
                items.sort();
                let arr = Array::new(ctx.clone())?;
                for (i, (name, is_dir)) in items.into_iter().enumerate() {
                    let o = Object::new(ctx.clone())?;
                    o.set("name", name)?;
                    o.set("dir", is_dir)?;
                    arr.set(i, o)?;
                }
                Ok(arr)
            },
        ),
    )?;
    host.set(
        "exists",
        Function::new(ctx.clone(), |path: String| -> bool {
            Path::new(&path).exists()
        }),
    )?;
    // adj944：注册/解除 PATH 的宿主能力（用户需求「只有注册后，打开终端就能 ijipu cli」）。
    // ⚠ 只注入**系统能力**（读写注册表 / 安装目录 / App Paths）；"怎么算新 PATH"（分号切分、
    //   大小写无关比较、长度上限、幂等）在 `packages/ijipu-cli/src/envPath.ts` —— 与应用界面
    //   那个按钮**共用同一份** ✓。**失败不抛异常**：`writePath` 用 `{ok,error}` 回，
    //   否则会被上层当成"接线异常（70）"，而这是"注册表写不进去"这个正常失败 ✓。
    host.set("cliPath", build_cli_path_host(ctx)?)?;
    /*
     * adj1084：动态谱视频（`render -t mp4`）。**同步阻塞**到子进程出片结束 ——
     * CLI 本来就是"一条命令、跑完退出"，没有并发要图；请求/回包都是 JSON 字符串，
     * 与其它宿主函数同口径（见 `embedEntry.ts` 的 `EmbedHost.video`）。
     */
    host.set("video", build_video_host(ctx)?)?;
    host.set(
        "out",
        Function::new(ctx.clone(), |text: String| {
            #[cfg(windows)]
            con::write_out(&text);
            #[cfg(not(windows))]
            print!("{text}");
        }),
    )?;
    host.set(
        "err",
        Function::new(ctx.clone(), |text: String| {
            #[cfg(windows)]
            con::write_err(&text);
            #[cfg(not(windows))]
            eprint!("{text}");
        }),
    )?;
    Ok(host)
}

/// adj1084：把 `src/cli_video.rs` 的出片通道接成 JS 侧的 `__ijipuHost.video`
/// （字段口径见 `packages/ijipu-cli/src/embedEntry.ts` 的 `EmbedHost.video`）
fn build_video_host<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    let obj = Object::new(ctx.clone())?;
    obj.set(
        "export",
        Function::new(ctx.clone(), |req_json: String| -> String {
            crate::cli_video::export_blocking(&req_json)
        }),
    )?;
    Ok(obj)
}

/// adj944：把 `src/cli_path.rs` 的那组函数接成 JS 侧的 `__ijipuHost.cliPath`
/// （字段口径见 `packages/ijipu-cli/src/embedEntry.ts` 的 `EmbedHost.cliPath`）
fn build_cli_path_host<'js>(ctx: &Ctx<'js>) -> rquickjs::Result<Object<'js>> {
    let obj = Object::new(ctx.clone())?;
    obj.set(
        "installDir",
        Function::new(ctx.clone(), |ctx: Ctx<'js>| -> rquickjs::Result<String> {
            crate::cli_path::install_dir_string().map_err(|e| Exception::throw_message(&ctx, &e))
        }),
    )?;
    obj.set(
        "exePath",
        Function::new(ctx.clone(), |ctx: Ctx<'js>| -> rquickjs::Result<String> {
            crate::cli_path::exe_path_string().map_err(|e| Exception::throw_message(&ctx, &e))
        }),
    )?;
    obj.set(
        "readPath",
        Function::new(ctx.clone(), |ctx: Ctx<'js>| -> rquickjs::Result<Option<String>> {
            crate::cli_path::read_env_path().map_err(|e| Exception::throw_message(&ctx, &e))
        }),
    )?;
    // 写：**回结果对象而不是抛异常**（失败原因要原样传到用户眼前，见上面的说明）
    obj.set(
        "writePath",
        Function::new(
            ctx.clone(),
            |ctx: Ctx<'js>, value: String| -> rquickjs::Result<Object<'js>> {
                let out = Object::new(ctx.clone())?;
                match crate::cli_path::write_env_path(&value) {
                    Ok(()) => {
                        out.set("ok", true)?;
                        out.set("error", Option::<String>::None)?;
                    }
                    Err(e) => {
                        out.set("ok", false)?;
                        out.set("error", e)?;
                    }
                }
                Ok(out)
            },
        ),
    )?;
    obj.set(
        "readAppPaths",
        Function::new(ctx.clone(), |ctx: Ctx<'js>| -> rquickjs::Result<Option<String>> {
            crate::cli_path::read_app_paths().map_err(|e| Exception::throw_message(&ctx, &e))
        }),
    )?;
    // App Paths 是**可选便利**：失败只记不报（PATH 才是契约；与 `lib.rs` 的命令同口径 ✓）
    obj.set(
        "writeAppPaths",
        Function::new(ctx.clone(), |exe: String| {
            if let Err(e) = crate::cli_path::write_app_paths(&exe) {
                #[cfg(windows)]
                con::write_err(&format!("[iJipu] 写 App Paths 失败（不影响 PATH 注册）：{e}\n"));
                #[cfg(not(windows))]
                eprintln!("[iJipu] 写 App Paths 失败（不影响 PATH 注册）：{e}");
            }
        }),
    )?;
    obj.set(
        "removeAppPaths",
        Function::new(ctx.clone(), || {
            if let Err(e) = crate::cli_path::remove_app_paths() {
                #[cfg(windows)]
                con::write_err(&format!("[iJipu] 清 App Paths 失败（不影响 PATH 解除）：{e}\n"));
                #[cfg(not(windows))]
                eprintln!("[iJipu] 清 App Paths 失败（不影响 PATH 解除）：{e}");
            }
        }),
    )?;
    Ok(obj)
}

/// 读失败的文案：保留 Node 那句 `ENOENT: …` 的形状（脚本里报错看着一致 ✓）
fn read_failed(path: &str, e: &std::io::Error) -> String {
    format!("ENOENT: 读不到文件 {path}（{e}）")
}

/// 写文件（**先补父目录**，与 node 入口的 `mkdir -p` 同口径；`batch -o 子目录` 靠它 ✓）
fn write_all(path: &str, bytes: &[u8]) -> std::io::Result<()> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(p, bytes)
}

/// base64 解码（只服务"二进制落盘"这一处；不引第三方 crate ✓）
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out: Vec<u8> = Vec::with_capacity(s.len() / 4 * 3 + 3);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for b in s.bytes() {
        let v: u32 = match b {
            b'A'..=b'Z' => (b - b'A') as u32,
            b'a'..=b'z' => (b - b'a') as u32 + 26,
            b'0'..=b'9' => (b - b'0') as u32 + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\n' | b'\r' | b' ' | b'\t' => continue,
            _ => return None,
        };
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}

/// 把 rquickjs 的错误说成人话（异常要取 `message`，否则只剩 "Exception generated by QuickJS"）
fn describe(ctx: &Ctx<'_>, e: &rquickjs::Error) -> String {
    if matches!(e, rquickjs::Error::Exception) {
        let caught: Value = ctx.catch();
        if let Ok(exc) = Exception::from_js(ctx, caught.clone()) {
            let msg = exc.message().unwrap_or_else(|| "(无消息)".to_string());
            // 栈里带"哪一行"——引擎与 QuickJS 不兼容时靠它定位（如实贴出来，不吞 ✗）
            return match exc.stack() {
                Some(s) if !s.is_empty() => format!("{msg}\n{s}"),
                _ => format!("{msg}（{caught:?}）"),
            };
        }
        return format!("{caught:?}");
    }
    format!("{e}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    /** 关键：**双击 `.jps`（路径当第一个参数）绝不能进 CLI**（否则不会开窗口 = 用户看不见谱） */
    #[test]
    fn jps_path_goes_to_gui() {
        assert_eq!(split_cli_args(argv(&["ijipu.exe", r"D:\谱\壁上观.jps"])), None);
    }

    #[test]
    fn bare_and_internal_flags_go_to_gui() {
        assert_eq!(split_cli_args(argv(&["ijipu.exe"])), None);
        assert_eq!(split_cli_args(argv(&["ijipu.exe", "--cli-host"])), None);
        assert_eq!(split_cli_args(argv(&["ijipu.exe", "--help"])), None);
        assert_eq!(split_cli_args(argv(&["ijipu.exe", "cli-host"])), None);
    }

    #[test]
    fn cli_subcommand_strips_prefix() {
        assert_eq!(
            split_cli_args(argv(&["ijipu.exe", "cli", "lint", "-i", "a.jps"])),
            Some(vec!["lint".to_string(), "-i".to_string(), "a.jps".to_string()])
        );
        assert_eq!(split_cli_args(argv(&["ijipu.exe", "cli"])), Some(vec![]));
    }

    #[test]
    fn base64_roundtrip_and_rejects_garbage() {
        assert_eq!(base64_decode("TURoZA==").unwrap(), b"MThd".to_vec());
        assert_eq!(base64_decode("").unwrap(), Vec::<u8>::new());
        assert!(base64_decode("!!!").is_none());
    }
}
