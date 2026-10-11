/**
 * scripts/ijipu-cli.mts — 命令行**可执行入口**（A·P1）
 *
 * 运行：`npm run cli -- format -i samples/xxx.jps`（构建到 `dist-smoke/cli.cjs` 后由 node 跑）
 *
 * 与方案的关系：
 *  · 本文件只做"把 node 的 argv/IO 接给 `runCli`"这一件事 ⇒ **不重复实现任何逻辑** ✓；
 *  · 决策①要求"同一个 exe 带子命令"：桌面端最终由 `src-tauri` 的入口判断"带子命令就不进 GUI"，
 *    再把同一份 `runCli` 接上（P3；届时复用本文件的 IO 实现 ✓，不另写一套 ✗）。
 */
import { readFile, writeFile, readdir, access } from 'node:fs/promises'
const enc = new TextEncoder()
/**
 * ⚠ 不要 `import process from 'node:process'` ✗ —— 本文件以 node target 打成 CJS 时，
 * 未列入 `external` 的 `node:*` 会被换成一个浏览器外部包 stub ⇒ 运行期 `process` 是 undefined ✗
 * （第一次就踩了：`TypeError: Cannot read properties of undefined (reading 'IJIPU_CLI_VERSION')`）。
 * 用 node 的**全局 `process`** 即可（类型来自 `@types/node` ✓）。
 */
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  stdin: AsyncIterable<Uint8Array>
  stdout: { write(text: string): void }
  stderr: { write(text: string): void }
  exitCode: number | undefined
}
import { runCli, type CliIo } from '../packages/ijipu-cli/src/cli'

/** node 侧 IO：stdin 一次性读完（CLI 用例都是"读完整输入再算"，不需要流式 ✗） */
const io: CliIo = {
  async readStdin() {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
  },
  readFile: (p) => readFile(p, 'utf8'),
  /** 文本或二进制：`Uint8Array` 直接落盘（MIDI，adj802） */
  writeFile: (p, data) => (typeof data === 'string' ? writeFile(p, data, 'utf8') : writeFile(p, data)),
  async listDir(dir) {
    // 供 `batch` 用；只回文件名（不含路径），排序保证可复现
    const names = await readdir(dir)
    return names.sort()
  },
  // `enc` 预留给后续"二进制从 stdin 读"的场景（当前 MIDI 只写出，不读入）
  exists: async (p) => {
    void enc
    try {
      await access(p)
      return true
    } catch {
      return false
    }
  },
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(`${text}\n`),
}

const version = process.env.IJIPU_CLI_VERSION ?? 'dev'
/**
 * ⚠ 本文件被打成 **CJS**（`vite.smoke.config.ts` 的 `formats: ['cjs']`）⇒ **不能用顶层 await** ✗
 * （第一次就踩了：构建报错、`dist-smoke/cli.cjs` 不产出 ✓）。用异步 IIFE 包起来。
 */
void (async () => {
  const { code } = await runCli(process.argv.slice(2), io, { version })
  process.exitCode = code
})()
