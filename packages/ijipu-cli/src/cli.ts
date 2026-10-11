/**
 * cli.ts — iJipu 命令行**核心**（方案 A / A·P1）
 *
 * 设计口径见 `docs/CLI.md` 与 `docs/CLI-AND-COMMAND-PLAN.md`：
 *  · **纯逻辑**：`runCli(argv, io)` 不碰 `process`/`console`（IO 由调用方注入）⇒ 可被
 *    ① 打包成 node 可执行（`npm run cli`）、② 桌面端 exe 的子命令（决策①）、③ 冒烟测试直接调用；
 *  · **不重写引擎**：解析/格式化一律调 `@ijipu/engine`（"数值口径同源"，AGENTS §六之二·4）；
 *  · **退出码稳定**（见 `EXIT`）：脚本与 CI 靠它判断，不看文案 ✗；
 *  · **stdin/stdout 友好**：`-i -` 读 stdin、`-o -` 写 stdout（缺省也是 stdout）。
 *
 * 本阶段（P1）实现：`format` / `lint` / `info` + 全局选项 + `--json`。
 * `render` / `play` / `batch` / `settings` / `config` / `doctor` 属 P2–P4，**未实现时明确报错**（不假装成功 ✗）。
 */
import { formatJps, parseJps, splitParseIssues } from '@ijipu/engine'

/** 退出码：**对外承诺**，只增不改（脚本/CI 依赖它） */
export const EXIT = {
  ok: 0,
  usage: 1,
  noInput: 2,
  syntax: 3,
  render: 4,
  config: 5,
} as const

/** 注入式 IO（便于测试与"同 exe 子命令"复用） */
export type CliIo = {
  readStdin(): Promise<string>
  readFile(path: string): Promise<string>
  writeFile(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  out(text: string): void
  err(text: string): void
}

/** 命令结果（供测试断言与 `--json` 输出复用同一份事实） */
export type CliResult = {
  code: number
  /** `--json` 时写 stdout 的对象（`--json` 关闭时为 undefined） */
  json?: unknown
}

/**
 * 人类可读输出统一补换行：`io.out` 是"写一段文本"的语义（要拼接时也不吃亏），
 * 而 CLI 的每一行都是**独立**消息 ⇒ 这里集中补 `\n`（否则多行会挤成一行 ✗）。
 */
const line = (io: CliIo, text: string): void => {
  const NL = String.fromCharCode(10)
  // ⚠ 这里必须调用**原始**的 `io.out` —— 本轮我用全局替换把 `io.out(` 全换成了 `line(io, `，
  //   连助手自己也换了 ⇒ 无限递归（Maximum call stack size exceeded ✗）。教训：替换要排除定义处。
  io.out(text.endsWith(NL) ? text : text + NL)
}

const HELP = `iJipu 命令行（爱记谱）

用法：ijipu [全局选项] <命令> [命令选项]

命令（P1 已实现）：
  format   -i <文件|-> [-o <文件|->] [--check] [--in-place] [--diff]   按应用规范规范化源码
  lint     -i <文件|-> [--format text|json|gh]                          语法检查（有错 ⇒ 退出码 3）
  info     -i <文件|-> [-t text|json]                                   谱面概况（行数/分组/问题数）

全局选项：
  --json            机器可读输出（带 schema 版本）
  --quiet           不输出非必要信息
  --deterministic   输出不含时间戳（便于 CI 逐字节比对）
  -s <k=v>          临时设置（可重复；优先级最高，**不落盘**）
  --config <文件>   CLI 配置文件（P4；现在给了会提示未实现）
  -h, --help        帮助
  -v, --version     版本

未实现（P2–P4，会明确报错而不是假装成功）：
  render / play / batch / settings / config / doctor

退出码：0 成功 ｜ 1 用法错误 ｜ 2 输入不存在 ｜ 3 语法错误 ｜ 4 渲染失败 ｜ 5 设置非法
`

type Parsed = {
  command: string
  inputs: string[]
  output: string | null
  type: string | null
  json: boolean
  quiet: boolean
  deterministic: boolean
  help: boolean
  version: boolean
  check: boolean
  inPlace: boolean
  diff: boolean
  format: 'text' | 'json' | 'gh' | null
  sets: string[]
  configPath: string | null
  unknown: string[]
}

/** 手写参数解析（**不引依赖** —— AGENTS §一"新增依赖必须先询问"，这里完全用不着） */
function parseArgs(argv: string[]): Parsed {
  const p: Parsed = {
    command: '',
    inputs: [],
    output: null,
    type: null,
    json: false,
    quiet: false,
    deterministic: false,
    help: false,
    version: false,
    check: false,
    inPlace: false,
    diff: false,
    format: null,
    sets: [],
    configPath: null,
    unknown: [],
  }
  const takesValue = new Set(['-i', '--input', '-o', '--output', '-t', '--type', '-s', '--set', '--config', '--format'])
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = (): string => {
      const v = argv[i + 1]
      if (v === undefined) {
        p.unknown.push(a)
        return ''
      }
      i += 1
      return v
    }
    if (a === '-h' || a === '--help') p.help = true
    else if (a === '-v' || a === '--version') p.version = true
    else if (a === '--json') p.json = true
    else if (a === '--quiet') p.quiet = true
    else if (a === '--deterministic') p.deterministic = true
    else if (a === '--check') p.check = true
    else if (a === '--in-place') p.inPlace = true
    else if (a === '--diff') p.diff = true
    else if (a === '-i' || a === '--input') {
      const v = next()
      if (v !== '') p.inputs.push(v)
    } else if (a === '-o' || a === '--output') {
      const v = next()
      if (v !== '') p.output = v
    } else if (a === '-t' || a === '--type') {
      const v = next()
      if (v !== '') p.type = v
    } else if (a === '-s' || a === '--set') {
      const v = next()
      if (v !== '') p.sets.push(v)
    } else if (a === '--config') {
      const v = next()
      if (v !== '') p.configPath = v
    } else if (a === '--format') {
      const v = next()
      if (v === 'text' || v === 'json' || v === 'gh') p.format = v
      else p.unknown.push(a)
    } else if (a.startsWith('-') && !p.command) p.unknown.push(a)
    else if (a.startsWith('-')) p.unknown.push(a)
    else if (p.command === '') p.command = a
    else p.inputs.push(a)
    // 满足 TS：takesValue 目前只用于文档性说明（保留以便后续扩展）
    void takesValue
  }
  return p
}

/** 读输入：`-` = stdin；否则读文件（不存在 ⇒ 抛 `ENOENT` 由调用方映射为退出码 2） */
async function readInput(spec: string | undefined, io: CliIo): Promise<{ text: string; fromStdin: boolean }> {
  if (spec === undefined || spec === '-') return { text: await io.readStdin(), fromStdin: true }
  return { text: await io.readFile(spec), fromStdin: false }
}

/** 输出：`-o -` 或 `-o` 省略 = stdout；`-o 文件` = 写文件 */
async function writeOutput(spec: string | null, text: string, io: CliIo): Promise<string> {
  if (spec === null || spec === '-') {
    line(io, text.endsWith('\n') ? text : `${text}\n`)
    return '(stdout)'
  }
  await io.writeFile(spec, text)
  return spec
}

/** 由 `-o` 后缀/`-t` 推断输出类型（P1 只有文本类；P2 起 svg/midi 等） */
function inferType(p: Parsed): string {
  if (p.type !== null) return p.type.toLowerCase()
  const o = p.output
  if (o !== null && o.includes('.')) {
    const ext = o.slice(o.lastIndexOf('.') + 1).toLowerCase()
    if (ext !== '') return ext
  }
  return 'text'
}

/** 问题清单 → 一行文字（`--format gh` 用 GitHub Actions 注解格式） */
function issueLine(issue: { line?: number; message?: string; text?: string }, gh: boolean): string {
  const ln = issue.line ?? 0
  const msg = String(issue.message ?? issue.text ?? '').trim()
  return gh ? `::error file=%FILE%,line=${ln}::${msg}` : `第 ${ln} 行：${msg}`
}

/**
 * 跑一次 CLI。**纯函数**：所有 IO 走 `io`，返回值即退出码。
 * @param argv 不含 `node` 与脚本路径（即 `process.argv.slice(2)`）
 */
export async function runCli(argv: string[], io: CliIo, meta?: { version?: string }): Promise<CliResult> {
  const p = parseArgs(argv)
  const version = meta?.version ?? '0.0.0'

  if (p.help) {
    line(io, HELP)
    return { code: EXIT.ok }
  }
  if (p.version) {
    line(io, `iJipu ${version}`)
    return { code: EXIT.ok }
  }
  if (p.unknown.length > 0) {
    io.err(`未知选项：${p.unknown.join(' ')}（用 --help 看用法）`)
    return { code: EXIT.usage }
  }
  if (p.command === '') {
    io.err('缺少命令（用 --help 看用法）')
    return { code: EXIT.usage }
  }
  if (p.configPath !== null) {
    io.err('--config 属 P4，尚未实现（当前只支持命令行 -s）')
    return { code: EXIT.config }
  }
  if (p.sets.length > 0 && p.command !== 'info') {
    io.err('-s 目前仅 info 接受（设置写入谱面属 P4）')
    return { code: EXIT.config }
  }

  const known = new Set(['format', 'lint', 'info'])
  if (!known.has(p.command)) {
    io.err(
      `命令 “${p.command}” 属于 P2–P4，尚未实现（用 --help 看已实现命令）。` +
        `已实现：format / lint / info`,
    )
    return { code: EXIT.usage }
  }

  // 读输入（`-` = stdin）
  let source: string
  let fromStdin = false
  try {
    const r = await readInput(p.inputs[0], io)
    source = r.text
    fromStdin = r.fromStdin
  } catch (e) {
    io.err(`读输入失败：${String(e)}`)
    return { code: EXIT.noInput }
  }
  /** 输入是否是"真的给了"（用于 format 的默认行为判断） */
  const inputGiven = p.inputs.length > 0

  const wantJson = p.json || p.format === 'json'

  // ── info ────────────────────────────────────────────────
  if (p.command === 'info') {
    const parsed = parseJps(source)
    const { errors, warnings } = splitParseIssues(parsed)
    const header = parsed.header as unknown as Record<string, unknown>
    const pick = (k: string): string | null => (typeof header[k] === 'string' ? (header[k] as string) : null)
    const info = {
      schema: 1,
      generator: `ijipu ${version}`,
      input: fromStdin ? '(stdin)' : String(p.inputs[0]),
      title: pick('title'),
      key: pick('key'),
      lines: parsed.lines.length,
      groups: parsed.groups.length,
      errors: errors.length,
      warnings: warnings.length,
      bytes: source.length,
    }
    if (wantJson) {
      line(io, JSON.stringify(info, null, 2))
      return { code: EXIT.ok, json: info }
    }
    if (!p.quiet) {
      line(io, `文件：${info.input}`)
      if (info.title !== null) line(io, `标题：${info.title}`)
      if (info.key !== null) line(io, `调号：${info.key}`)
      line(io, `源码行：${info.lines}｜曲词分组：${info.groups}｜字符：${info.bytes}`)
      line(io, `问题：错误 ${info.errors} 个、告警 ${info.warnings} 个`)
    }
    return { code: EXIT.ok, json: info }
  }

  // ── lint ────────────────────────────────────────────────
  if (p.command === 'lint') {
    const parsed = parseJps(source)
    const { errors, warnings } = splitParseIssues(parsed)
    const gh = p.format === 'gh'
    const file = fromStdin ? '(stdin)' : String(p.inputs[0])
    const payload = {
      schema: 1,
      generator: `ijipu ${version}`,
      input: file,
      ok: errors.length === 0,
      errors: errors.map((e) => ({ line: e.line ?? 0, message: String(e.message ?? e.text ?? '') })),
      warnings: warnings.map((w) => ({ line: w.line ?? 0, message: String(w.message ?? w.text ?? '') })),
    }
    if (wantJson) line(io, JSON.stringify(payload, null, 2))
    else if (!p.quiet) {
      for (const e of errors) line(io, issueLine(e as { line?: number; message?: string; text?: string }, gh).replace('%FILE%', file))
      for (const w of warnings) line(io, issueLine(w as { line?: number; message?: string; text?: string }, gh).replace('%FILE%', file))
      if (errors.length === 0 && warnings.length === 0) line(io, '没有发现问题 ✓')
    }
    return { code: errors.length === 0 ? EXIT.ok : EXIT.syntax, json: payload }
  }

  // ── format ──────────────────────────────────────────────
  const fixed = formatJps(source)
  const changed = fixed !== source
  if (p.check) {
    if (!p.quiet) line(io, changed ? '需要格式化 ✗' : '已符合规范 ✓')
    return { code: changed ? EXIT.syntax : EXIT.ok, json: { schema: 1, changed } }
  }
  if (p.diff) {
    const a = source.split('\n')
    const b = fixed.split('\n')
    const lines: string[] = []
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i += 1) {
      if (a[i] === b[i]) continue
      if (a[i] !== undefined) lines.push(`- ${a[i]}`)
      if (b[i] !== undefined) lines.push(`+ ${b[i]}`)
    }
    line(io, lines.join('\n'))
    return { code: changed ? EXIT.ok : EXIT.ok, json: { schema: 1, changed, diffLines: lines.length } }
  }
  if (p.inPlace) {
    if (fromStdin || !inputGiven || p.inputs[0] === '-') {
      io.err('--in-place 需要文件输入（不能对 stdin 原地写）')
      return { code: EXIT.usage }
    }
    if (changed) await io.writeFile(String(p.inputs[0]), fixed)
    if (!p.quiet) line(io, changed ? `已原地格式化：${p.inputs[0]}` : '已符合规范，未改动 ✓')
    return { code: EXIT.ok, json: { schema: 1, changed } }
  }
  const target = await writeOutput(p.output, fixed, io)
  if (!p.quiet && target !== '(stdout)') line(io, `已写入 ${target}${changed ? '' : '（内容未变）'}`)
  return { code: EXIT.ok, json: { schema: 1, changed, output: target } }
}
