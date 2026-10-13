/**
 * embedEntry.ts — iJipu 命令行的**内嵌入口**（adj942，用户裁定「直接落，修」·路线②）
 *
 * 和 `nodeEntry.ts` 的分工（**同一份命令逻辑，两套接线**）：
 *   · `nodeEntry.ts` → Node 用户/CI 的 `ijipu`（`dist/ijipu.cjs`，自带 `node:fs` 等）；
 *   · 本文件 → **`ijipu.exe` 内嵌的那份**（`dist/ijipu-embed.js`，由 Rust 侧的 QuickJS 跑）。
 *
 * ⚠ 关键口径：**IO 全部由宿主（Rust）提供**，这里只做**接线** ——
 *   不在 QuickJS 里硬造 `node:fs` / `node:path` 模块 ✗（能少造就少造；宿主本来就能读写文件）。
 *   宿主接口 `EmbedHost` 全是**同步 + 字符串**（唯一的二进制走 base64）——
 *   这样 Rust 侧只需注入普通函数，不必处理 Promise/类型化数组的跨语言细节 ✓。
 *
 * 异步怎么落地：`runCli()` 是 `async`（Node 侧也是同一个函数），而宿主函数是同步的 ⇒
 *   每次 `await` 只会挂起一个**已 resolved 的微任务**。Rust 侧 `__ijipuCliMain()` 之后
 *   循环 `ctx.execute_pending_job()` 把微任务队列跑干，再读 `__ijipuCliState`（见 `cli_embed.rs`）✓。
 *
 * 构建：`npm run cli:embed` ⇒ `packages/ijipu-cli/dist/ijipu-embed.js`
 *   （**不动** `dist/ijipu.cjs` —— 它还要继续给 Node 用户与 `cli-assert` 用 ✓）
 *   `src-tauri/src/cli_embed.rs` 用 `include_bytes!` 把它编进 `ijipu.exe`。
 */
import { runCli, type CliIo, type CliResult } from './cli'

/**
 * 宿主（Rust）注入的能力。**全部同步**：本进程就是一个短命 CLI，没有并发可图 ✓。
 */
export type EmbedHost = {
  /** 已剥掉 `cli` 前缀的命令行参数（等价于 Node 的 `process.argv.slice(2)`） */
  argv: string[]
  /** 读 stdin（`-i -` 或省略 `-i` 时用；没有重定向 ⇒ 空串） */
  readStdin(): string
  /** 读文本文件（失败应当**抛异常**，CLI 会映射成退出码 2） */
  readFile(path: string): string
  /** 写文本文件（宿主负责补齐父目录，与 Node 入口的 `mkdir -p` 同口径） */
  writeFile(path: string, text: string): void
  /** 写二进制文件（MIDI/PNG…；base64 —— 跨语言只传字符串最稳） */
  writeFileBinary(path: string, base64: string): void
  /** 列目录（只回文件名，`batch` 用） */
  listDir(dir: string): string[]
  /** 文件/目录是否存在 */
  exists(path: string): boolean
  /**
   * adj944（用户需求「只有注册后，打开终端就能 `ijipu cli`」）：**注册/解除 PATH** 的宿主能力。
   *
   * 为什么由宿主提供：它要读写 `HKCU\Environment\Path`（还有 App Paths）—— 那是 **Rust 侧**的事
   * （`src-tauri/src/cli_path.rs`：写前备份 + 写入 + **回读校验** + 广播 `WM_SETTINGCHANGE`）；
   * 字符串口径与编排在 `envPath.ts`（与应用界面那个按钮**共用一份** ✓）。
   * 旧宿主（没注入这个对象）⇒ CLI 如实报错（退出码 6），不假装成功 ✗。
   *
   * ⚠ 全部**同步 + 字符串进出**（与本类型其它成员同口径）；`write` 用返回值而不是抛异常报错
   *   —— 失败原因要一路传到用户眼前，抛异常会被包成"接线异常（70）"，那是另一回事 ✗。
   */
  cliPath?: {
    /** `ijipu.exe` 所在目录（写进 PATH 的条目） */
    installDir(): string
    /** `ijipu.exe` 完整路径（App Paths 用） */
    exePath(): string
    /** 读 `HKCU\Environment\Path`（没有该值 ⇒ null） */
    readPath(): string | null
    /** 写 PATH（宿主负责备份 / 回读校验 / 广播）；失败用 `ok:false` 回，**不抛** ✓ */
    writePath(value: string): { ok: boolean; error: string | null }
    /** 读 App Paths 的默认值（没有 ⇒ null） */
    readAppPaths(): string | null
    /** 写 App Paths 指向我们的 exe */
    writeAppPaths(exePath: string): void
    /** 删我们自己写的 App Paths 条目（不是我们写的不动 ✓） */
    removeAppPaths(): void
  }
  /** 写 stdout（原样，不补换行 —— CLI 自己补，见 `cli.ts` 的 `line()`） */
  out(text: string): void
  /** 写 stderr（CLI 传进来时已带换行；宿主**不要**再补） */
  err(text: string): void
}

/**
 * 构建期由 vite `define` 注入（值 = 本包 `package.json` 的 `version`）。
 * 与 `nodeEntry.ts` 同口径：未注入时回退 `'dev'`，不抛错 ✓。
 * 版本号与 `APP_VERSION` 的一致性由 `cli-assert` 的闸门守着（版本号不漂移 ✓）。
 */
declare const __IJIPU_CLI_VERSION__: string | undefined
const BUILD_VERSION = typeof __IJIPU_CLI_VERSION__ === 'string' ? __IJIPU_CLI_VERSION__ : 'dev'

/**
 * 宿主返回的对象（Rust 侧在 `__ijipuCliMain()` 之后读它）：
 * `done` = 跑完了（无论成功/失败）；`code` = `runCli` 给的退出码；
 * `error` = 接线层抛的异常（**不是** CLI 的正常失败 ⇒ 宿主按"内部错误"处理并原样打印）。
 */
export type EmbedState = {
  done: boolean
  code: number
  error: string | null
}

/** base64（QuickJS 里**没有** `btoa` ⇒ 自己写，只覆盖二进制导出这一处） */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += BASE64_CHARS[b0 >> 2]
    out += BASE64_CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : BASE64_CHARS[b2 & 63]
  }
  return out
}

/**
 * `TextEncoder` 补丁（**只为 `-t midi` 必需**）。
 *
 * 为什么补：引擎的 MIDI 产出用 `new TextEncoder().encode(...)` 写文本块
 * （`engine/playback/midi.ts`），而 QuickJS 是**纯 ECMAScript 引擎**、不自带 Web 的
 * `TextEncoder` ⇒ 不补就 `ReferenceError`。按 ECMAScript 口径处理代理对（落单的代理
 * 编码成 U+FFFD，与浏览器一致 ✓）。**只在缺失时安装**，不覆盖宿主已有实现 ✓。
 */
function installTextEncoderPolyfill(): void {
  const g = globalThis as unknown as { TextEncoder?: unknown }
  if (typeof g.TextEncoder !== 'undefined') return
  class IjipuTextEncoder {
    readonly encoding = 'utf-8'
    encode(input = ''): Uint8Array {
      const s = String(input)
      const out: number[] = []
      for (let i = 0; i < s.length; i += 1) {
        let cp = s.charCodeAt(i)
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
          const lo = s.charCodeAt(i + 1)
          if (lo >= 0xdc00 && lo <= 0xdfff) {
            cp = ((cp - 0xd800) << 10) + (lo - 0xdc00) + 0x10000
            i += 1
          }
        }
        // 落单的代理（0xD800–0xDFFF 未被配对）⇒ U+FFFD（= EF BF BD）
        if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd
        if (cp < 0x80) out.push(cp)
        else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63))
        else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
        else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
      }
      return new Uint8Array(out)
    }
  }
  g.TextEncoder = IjipuTextEncoder
}

/** 把宿主能力接成 `runCli` 要的 `CliIo`（**唯一一处**接线，测试与宿主共用 ✓） */
function ioOf(host: EmbedHost): CliIo {
  const cliPath = host.cliPath
  return {
    async readStdin() {
      return host.readStdin()
    },
    async readFile(path) {
      return host.readFile(path)
    },
    async writeFile(path, data) {
      // 文本/二进制分流与 `nodeEntry.ts` 同口径 ✓（宿主负责建父目录）
      if (typeof data === 'string') host.writeFile(path, data)
      else host.writeFileBinary(path, toBase64(data))
    },
    async exists(path) {
      return host.exists(path)
    },
    async listDir(dir) {
      return host.listDir(dir)
    },
    /**
     * adj944：注册/解除 PATH 的宿主能力（**有才接** —— 旧宿主没有这个对象时，
     * `register`/`unregister`/`status` 会如实报"环境能力缺失"，退出码 6 ✓）。
     * 这里只做**同步↔异步**的桥接：字符串口径与编排全在 `envPath.ts`（与应用界面共用一份 ✓）。
     */
    pathHost:
      cliPath === undefined
        ? undefined
        : {
            async installDir() {
              return cliPath.installDir()
            },
            async exePath() {
              return cliPath.exePath()
            },
            async readPath() {
              return cliPath.readPath()
            },
            async writePath(value) {
              const r = cliPath.writePath(value)
              // 宿主用 `{ok:false,error}` 回失败原因 ⇒ 在这里变成异常，由 `envPath.ts` 统一收成 `{kind:'io'}`
              if (!r.ok) throw new Error(r.error ?? '写注册表失败（宿主没有给出原因）')
            },
            async readAppPaths() {
              return cliPath.readAppPaths()
            },
            async writeAppPaths(exePath) {
              cliPath.writeAppPaths(exePath)
            },
            async removeAppPaths() {
              cliPath.removeAppPaths()
            },
          },
    /**
     * ⚠ `rasterize` / `synthesize` / `watchFile` **刻意不注入** ✗ ——
     * 位图/音频要应用当能力宿主（命名管道，`docs/CLI.md` §七之三），`--watch` 要长驻监视；
     * 这三样现在都没有 ⇒ 用到时 CLI **如实报错**（退出码 4 / 1），**不假装成功** ✓。
     */
    out: (text) => host.out(text),
    err: (text) => host.err(text),
  }
}

/**
 * 跑一次内嵌 CLI。**测试与宿主共用这一份接线** ✓。
 * @returns `runCli` 的结果（退出码 + `--json` 时给的结构化事实）
 */
export async function runEmbeddedCli(host: EmbedHost): Promise<CliResult> {
  installTextEncoderPolyfill()
  return runCli(host.argv, ioOf(host), { version: BUILD_VERSION })
}

/**
 * 宿主（Rust）调用的入口：**同步返回**，把结果写进 `globalThis.__ijipuCliState`。
 *
 * 为什么不 `await` 后再交给宿主：JS 里的 `await` 要宿主驱动微任务队列，
 * 而宿主拿不到"什么时候跑干"的返回值 ⇒ 用"状态对象 + 宿主跑干队列后读"这个握手最稳 ✓。
 */
function main(): void {
  const g = globalThis as unknown as { __ijipuHost?: EmbedHost; __ijipuCliState?: EmbedState }
  const host = g.__ijipuHost
  const state: EmbedState = { done: false, code: 70, error: null }
  g.__ijipuCliState = state
  if (host === undefined) {
    state.error = '宿主没有注入 __ijipuHost（内嵌 CLI 接线缺失）'
    state.done = true
    return
  }
  void runEmbeddedCli(host).then(
    (r) => {
      state.code = r.code
      state.done = true
    },
    (e: unknown) => {
      const err = e as { name?: string; message?: string; stack?: string }
      state.error = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(e)
      state.done = true
    },
  )
}

// 挂到全局：Rust 侧 eval 完这个产物后调 `__ijipuCliMain()`
;(globalThis as unknown as { __ijipuCliMain?: () => void }).__ijipuCliMain = main
