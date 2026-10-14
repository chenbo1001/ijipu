/**
 * nodeEntry.ts — iJipu 命令行的 **Node 可执行入口**（`@ijipu/cli` 的 bin 来源）
 *
 * 职责边界：**只做接线**，不含任何命令逻辑 ✗ —— 把 node 的 argv / 文件 IO / stdout / stderr
 * 接给 `cli.ts` 的 `runCli(argv, io)`（命令逻辑与退出码全在那里 ✓）。
 *
 * 宿主能力（位图 `rasterize` / 音频 `synthesize`）：由**桌面端能力通道**注入（见 `hostIo.ts`）；
 * 本入口不注入 ⇒ 用到时 CLI **明确报错（退出码 4）**，不假装成功 ✓。
 *
 * 构建：`npm run cli:build` ⇒ `packages/ijipu-cli/dist/ijipu.cjs`
 *   —— 自包含（引擎已打进包内）、**零运行期依赖**、带 shebang，可直接全局安装 ✓。
 *
 * ⚠ 不要 `import process from 'node:process'` ✗ —— 打成 CJS 时未列入 `external` 的 `node:*`
 *   会被换成浏览器外部包 stub ⇒ 运行期 `process` 是 undefined（第一版就踩过：
 *   `TypeError: Cannot read properties of undefined (reading 'IJIPU_CLI_VERSION')`）。
 *   用 node 的**全局 `process`**（类型来自 @types/node ✓）。
 */
import { readFile, writeFile, readdir, access, mkdir } from 'node:fs/promises'
import { watch } from 'node:fs'
import { dirname } from 'node:path'
import { runCli, type CliIo } from './cli'

declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  stdin: AsyncIterable<Uint8Array>
  stdout: { write(text: string): void }
  stderr: { write(text: string): void }
  exitCode: number | undefined
}

/**
 * 构建期由 vite `define` 注入的版本（值 = 本包 `package.json` 的 `version`）。
 * 未注入时（例如直接用其它打包器跑源码）`typeof` 判定为 `'undefined'` ⇒ 回退 `'dev'`，不抛错 ✓。
 * 与 `src/brand/version.ts` 的 `APP_VERSION` 是否一致，由 `cli-assert` 的闸门守住 ✓。
 */
declare const __IJIPU_CLI_VERSION__: string | undefined
const BUILD_VERSION = typeof __IJIPU_CLI_VERSION__ === 'string' ? __IJIPU_CLI_VERSION__ : 'dev'

/** node 侧 IO：stdin 一次性读完（CLI 的用例都是"读完整输入再算"，不需要流式 ✗） */
const io: CliIo = {
  async readStdin() {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
  },
  readFile: (p) => readFile(p, 'utf8'),
  /**
   * 文本或二进制：`Uint8Array` 直接落盘（MIDI/PNG 等）。
   * adj803：写之前**补齐父目录** —— `batch`/`render -o 子目录/x.svg` 在目录不存在时
   * 原来会直接 ENOENT 失败 ✗（实测踩到），这里统一 mkdir -p（父目录为空则跳过）。
   */
  writeFile: async (p, data) => {
    const dir = dirname(p)
    if (dir !== '' && dir !== '.' && dir !== p) await mkdir(dir, { recursive: true })
    if (typeof data === 'string') await writeFile(p, data, 'utf8')
    else await writeFile(p, data)
  },
  async listDir(dir) {
    /**
     * adj956：回 `{ name, dir }[]`（不再是纯文件名）。
     * `-r` 递归要靠 `dir` 分目录；只回一层、按名字排序（顺序可复现 ⇒ 输出能逐字节比对 ✓）。
     */
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .map((e) => ({ name: e.name, dir: e.isDirectory() }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  },
  exists: async (p) => {
    try {
      await access(p)
      return true
    } catch {
      return false
    }
  },
  /**
   * adj814（A·P4 尾项）：`--watch` 的文件监视能力（宿主注入 ✓）——
   * 用 `fs.watch` 监听目标文件；返回取消函数 ✓。目录不存在等异常如实抛出 ✓。
   */
  watchFile: (path, onChange) => {
    const watcher = watch(path, () => onChange())
    return () => watcher.close()
  },
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(`${text}\n`),
}

/** 版本优先级：环境变量（CI/测试可覆盖）> 构建期注入 > `dev` */
const version = process.env.IJIPU_CLI_VERSION ?? BUILD_VERSION

/**
 * ⚠ 产物是 **CJS**（`vite.config.ts` 的 `formats: ['cjs']`）⇒ **不能用顶层 await** ✗
 * （第一版就踩过：构建报错、产物不产出 ✓）。用异步 IIFE 包起来。
 */
void (async () => {
  const { code } = await runCli(process.argv.slice(2), io, { version })
  process.exitCode = code
})()
