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
import { formatJps, parseJps, splitParseIssues, layoutScore, renderScoreToSvg, buildPlaySequence, eventsToMidi, defaultPageConfig, mergeJpsConfig, extractJpsConfig, OPTIONAL_CONFIG_FIELDS, rangeBox, applyRangeToSvg, readViewBoxOf, normalizeRangePad, inkBoxesOfLayout, type PageConfig, type ScoreLayout, type RangeBox, type ExportRange } from '@ijipu/engine'

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
  /** 文本或**二进制**（MIDI 等；adj802 起支持 `Uint8Array`） */
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  exists(path: string): Promise<boolean>
  /** 列目录里的文件（`batch` 用；只返回文件名，不含路径） */
  listDir(dir: string): Promise<string[]>
  /**
   * adj803（A·P3）**可选能力**：把 SVG 页栅格化成 png/jpg/pdf。
   *
   * 为什么是"可选能力"而不是实现细节：位图渲染需要 **canvas/字体/分页**（应用侧已有 ✓），
   * 纯 Node 环境下**不可能**凭空给出 ✗ ⇒ 由**宿主**（桌面端 exe 的隐藏窗口渲染通道）注入 ✓。
   * 未注入时 CLI **明确报错**（退出码 4）而不是假装成功 ✓。
   */
  rasterize?: (req: { svgs: string[]; type: 'png' | 'jpg' | 'pdf'; scale: number; title: string }) => Promise<Uint8Array[]>
  /**
   * adj803（A·P3）**可选能力**：MIDI → WAV（需要 AudioContext + 音色库 ⇒ 同理由宿主注入）。
   */
  synthesize?: (midi: Uint8Array) => Promise<Uint8Array>
  /**
   * adj814（A·P4 尾项）**可选能力**：监视文件变化（`--watch` 用）。
   * 与 `rasterize`/`synthesize` 同一口径：**宿主注入** ✓（node 入口用 `fs.watch` ✓；测试注入假实现 ✓）；
   * 未注入时 `--watch` **明确报错**（退出码 1）而不是"静默不监视" ✗。
   * @returns 取消监视的函数
   */
  watchFile?: (path: string, onChange: () => void) => () => void
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

命令（P1–P3 已实现）：
  format   -i <文件|-> [-o <文件|->] [--check] [--in-place] [--diff]   按应用规范规范化源码
  lint     -i <文件|-> [--format text|json|gh]                          语法检查（有错 ⇒ 退出码 3）
  info     -i <文件|-> [-t text|json]                                   谱面概况（行数/分组/问题数）
  render   -i <文件|-> -t svg|midi|png|jpg|pdf -o <输出>                渲染/导出（位图需桌面端通道）
           [--crop page|score] [--pad N] [--ink x,y,w,h]               画布范围（缺省 page = 整页）
  play     -i <文件|-> -t midi|wav -o <输出>                            导出音频（WAV 需桌面端通道）
  batch    --in <目录> -o <目录> [-t svg|midi|fmt]                      目录批量转换

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
  /** adj814：`--watch`（监视文件变化后重跑检查 ✓） */
  watch: boolean
  format: 'text' | 'json' | 'gh' | null
  sets: string[]
  configPath: string | null
  unknown: string[]
  /**
   * adj873（T-3 补落点）：`render` 的画布范围。`null` = 用户没写 ⇒ **按现状（整页）** ✓
   * （缺省绝不静默改成"谱面" ✗）。取值在 `render` 里校验：只认 `page` / `score`。
   */
  crop: string | null
  /** adj873：`--crop score` 的每边留白（px；缺省 2，钳制 0–64，由引擎 `normalizeRangePad` 统一） */
  pad: string | null
  /** adj873：`--ink x,y,w,h` 显式墨迹盒（覆盖布局级估算；有 DOM 的宿主量到后可喂进来） */
  ink: string | null
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
    watch: false,
    format: null,
    sets: [],
    configPath: null,
    unknown: [],
    crop: null,
    pad: null,
    ink: null,
  }
  const takesValue = new Set(['-i', '--input', '-o', '--output', '-t', '--type', '-s', '--set', '--config', '--format', '--crop', '--pad', '--ink'])
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
    else if (a === '--watch') p.watch = true
    else if (a === '-i' || a === '--input' || a === '--in') {
      /**
       * adj806：`--in` 是 `-i` 的别名 —— `docs/CLI.md` 里 `batch` 一直写的是 `--in <目录>`，
       * 但第一版解析器没认它 ✗（断言当场抓出来 ✓）。别名与文档保持一致。
       */
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
    } else if (a === '--crop') {
      const v = next()
      if (v !== '') p.crop = v
    } else if (a === '--pad') {
      const v = next()
      if (v !== '') p.pad = v
    } else if (a === '--ink') {
      const v = next()
      if (v !== '') p.ink = v
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
 * adj873（T-3 补落点）：解析 `render --crop`。
 * **缺省 = `page`（整页）** —— 与本次改动前的行为逐字节一致 ✓（不静默改成"谱面" ✗）。
 * @returns `null` = 取值非法（调用方报用法错误）
 */
function normalizeCrop(v: string | null): ExportRange | null {
  if (v === null) return 'page'
  const s = v.toLowerCase()
  return s === 'page' || s === 'score' ? s : null
}

/** adj873：解析 `--ink x,y,w,h`（显式实测墨迹盒）；格式不对 ⇒ `null` */
function parseInkArg(v: string | null): RangeBox | null {
  if (v === null) return null
  const parts = v.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [x, y, w, h] = parts
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

/**
 * adj873：按 `--crop` 把渲染产物的画布口径裁到所选范围。
 *
 * · `page` ⇒ **原样返回**（一个字都不动 ⇒ 与改动前逐字节一致 ✓）；
 * · `score` ⇒ 墨迹盒 + 每边 `pad` px。墨迹按优先级取：
 *   ① `--ink x,y,w,h`（宿主实测值）；② 引擎 `inkBoxOfLayout()` 的**布局级估算**（Node 无 DOM）。
 *   **两道可信度闸（退化 / 近整页）由引擎 `rangeBox()` 判**；不过 ⇒ 返回 `error`，
 *   由调用方**明确报错退出**（退出码 4），**绝不静默退回整页** ✗。
 *
 * 几何只有一份：这里只传参 + 消费引擎结论（`rangeBox` 算盒、`applyRangeToSvg` 改外框）✓。
 */
function cropSvgs(
  svgs: string[],
  layout: ScoreLayout,
  crop: ExportRange,
  pad: number | undefined,
  inkArg: RangeBox | null,
): { svgs: string[]; error?: string } {
  if (crop === 'page') return { svgs }
  const inks = inkBoxesOfLayout(layout)
  const out: string[] = []
  for (let i = 0; i < svgs.length; i += 1) {
    const page = layout.pages[i]
    const vb = readViewBoxOf(svgs[i])
    const pageW = vb?.[2] ?? page?.width ?? 0
    const pageH = vb?.[3] ?? page?.height ?? 0
    const r = rangeBox({ range: 'score', pageW, pageH, ink: inkArg ?? inks[i] ?? null, pad })
    if (!r.ok) {
      return {
        svgs,
        error:
          `--crop score 量不到可信的墨迹盒（第 ${i + 1} 页）：${r.reason ?? '未知原因'}\n` +
          `  · 有 DOM 的宿主可把实测盒喂进来：--ink x,y,w,h（如 --ink 50,80,495,600）；\n` +
          `  · 或改用 --crop page（整页，与不加 --crop 一致）。`,
      }
    }
    out.push(applyRangeToSvg(svgs[i], r.box))
  }
  return { svgs: out }
}

/**
 * 跑一次 CLI。**纯函数**：所有 IO 走 `io`，返回值即退出码。
 * @param argv 不含 `node` 与脚本路径（即 `process.argv.slice(2)`）
 */
export async function runCli(argv: string[], io: CliIo, meta?: { version?: string }): Promise<CliResult> {
  const p = parseArgs(argv)
  const version = meta?.version ?? '0.0.0'
  /**
   * ⚠ 提前声明：`doctor` / `settings` / `config` 等命令在**读输入之前**就要用它 ✗
   * （第一版把它放在读输入之后 ⇒ `ReferenceError: Cannot access 'wantJson' before initialization`）。
   */
  const wantJson = p.json || p.format === 'json'

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
  if (p.sets.length > 0 && p.command !== 'info' && p.command !== 'settings' && p.command !== 'config' && p.command !== 'render' && p.command !== 'play' && p.command !== 'batch') {
    io.err('-s 目前接受于 info / settings / config / render / play / batch（写回谱面属后续）')
    return { code: EXIT.config }
  }

  /**
   * adj802（A·P2）：已实现命令集合。
   * `render`：源码 → SVG（每页一段）或 MIDI；`batch`：目录批量转换。
   * ⚠ SVG 走引擎**估算**角标墨迹（Node 里没有 canvas 实测 ⇒ 与应用的实测版会有亚像素差异，
   *    这是"CLI 无 DOM"的必然取舍，已在 docs/CLI.md 写明口径）。
   */
  const known = new Set(['format', 'lint', 'info', 'render', 'play', 'batch', 'settings', 'config', 'doctor', 'completions'])
  if (!known.has(p.command)) {
    io.err(`命令 “${p.command}” 尚未实现（用 --help 看已实现命令）`)
    return { code: EXIT.usage }
  }

  // ── completions（P4）：输出补全脚本（纯静态文本，零依赖）────
  if (p.command === 'completions') {
    const shell = (p.inputs[0] ?? p.type ?? 'bash').toLowerCase()
    const COMMANDS = 'format lint info render play batch settings config doctor completions'
    const scripts: Record<string, string> = {
      bash: `# iJipu bash 补全：source <(ijipu completions bash)\n_ijipu() {\n  local cur="\${COMP_WORDS[COMP_CWORD]}"\n  if [ "\$COMP_CWORD" -eq 1 ]; then COMPREPLY=( \$(compgen -W "${COMMANDS}" -- "\$cur") ); return; fi\n  COMPREPLY=( \$(compgen -f -- "\$cur") )\n}\ncomplete -F _ijipu ijipu\n`,
      zsh: `# iJipu zsh 补全：ijipu completions zsh > "\${fpath[1]}/_ijipu"\n#compdef ijipu\n_ijipu() { _arguments '1:command:(${COMMANDS})' '*:file:_files' }\n_ijipu "\$@"\n`,
      powershell: `# iJipu PowerShell 补全：ijipu completions powershell | Out-String | Invoke-Expression\nRegister-ArgumentCompleter -Native -CommandName ijipu -ScriptBlock {\n  param(\$wordToComplete, \$commandAst, \$cursorPosition)\n  @('${COMMANDS.split(' ').join("','")}') | Where-Object { \$_ -like "\$wordToComplete*" } | ForEach-Object {\n    [System.Management.Automation.CompletionResult]::new(\$_, \$_, 'ParameterValue', \$_)\n  }\n}\n`,
    }
    const text = scripts[shell]
    if (text === undefined) {
      io.err(`completions 支持 bash | zsh | powershell（收到 “${shell}”）`)
      return { code: EXIT.usage }
    }
    line(io, text)
    return { code: EXIT.ok, json: { schema: 1, shell } }
  }

  // ── doctor（P4）：环境自检（**如实报告能力有无**，不粉饰）────
  if (p.command === 'doctor') {
    const caps = {
      svg: true,
      midi: true,
      raster: io.rasterize !== undefined,
      audio: io.synthesize !== undefined,
    }
    const report = {
      schema: 1,
      generator: `ijipu ${version}`,
      engine: 'ijipu-engine',
      configKeys: Object.keys(defaultPageConfig).length + OPTIONAL_CONFIG_FIELDS.length,
      capabilities: caps,
      platform: 'cli',
    }
    if (wantJson) line(io, JSON.stringify(report, null, 2))
    else {
      line(io, `iJipu CLI doctor`)
      line(io, `  可设置项：${report.configKeys} 个（含可选字段 ${OPTIONAL_CONFIG_FIELDS.length} 个）`)
      line(io, `  能力：svg ✓｜midi ✓｜位图(png/jpg/pdf) ${caps.raster ? '✓（桌面端通道已就绪）' : '✗（需桌面端隐藏窗口渲染）'}｜音频(wav) ${caps.audio ? '✓' : '✗（需音色库合成）'}`)
      line(io, `  提示：位图/音频在桌面端 exe 内可用；独立 Node 环境只能用 svg/midi ✓`)
    }
    return { code: EXIT.ok, json: report }
  }

  // ── play（P3）：源码 → 音频（MIDI 任意环境；WAV 需宿主合成）────
  if (p.command === 'play') {
    let src = ''
    try {
      src = (await readInput(p.inputs[0], io)).text
    } catch (e) {
      io.err(`读输入失败：${String(e)}`)
      return { code: EXIT.noInput }
    }
    const type = (p.type ?? (p.output?.toLowerCase().endsWith('.wav') ? 'wav' : 'midi')).toLowerCase()
    const { errors } = splitParseIssues(parseJps(src))
    if (errors.length > 0) {
      io.err(`源码有 ${errors.length} 个错误，先修好再导出（用 lint 看细节）`)
      return { code: EXIT.syntax }
    }
    const parsed = parseJps(src)
    const layout = layoutScore(parsed, mergeJpsConfig(src, defaultPageConfig))
    const title = (parsed.header as unknown as Record<string, unknown>)['title']
    const bytes = eventsToMidi(buildPlaySequence(parsed, layout, 60).events, {
      bpm: 60,
      title: typeof title === 'string' ? title : 'iJipu',
    })
    if (type === 'midi') {
      if (p.output === null || p.output === '-') {
        io.err('MIDI 是二进制，必须用 -o 指定文件（不能用 stdout）')
        return { code: EXIT.usage }
      }
      await io.writeFile(p.output, bytes)
      if (!p.quiet) line(io, `已写入 ${p.output}（MIDI，${bytes.length} 字节）`)
      return { code: EXIT.ok, json: { schema: 1, type: 'midi', output: p.output, bytes: bytes.length } }
    }
    if (type === 'wav') {
      /**
       * adj803（A·P3）：WAV 需要"采样合成"（AudioContext + 音色库 ⇒ 应用侧已有 ✓）；
       * 由宿主注入 `synthesize`（桌面端隐藏窗口/后台合成）✓；无此能力 ⇒ 明确报错 ✓。
       */
      if (io.synthesize === undefined) {
        io.err(
          'WAV 需要采样合成（音色库 + AudioContext），当前环境没有该能力。\n' +
            '  可用：-t midi（任意环境）｜或改用桌面端：ijipu play -i <谱> -t wav -o <输出.wav>',
        )
        return { code: EXIT.render }
      }
      if (p.output === null || p.output === '-') {
        io.err('WAV 是二进制，必须用 -o 指定文件（不能用 stdout）')
        return { code: EXIT.usage }
      }
      const wav = await io.synthesize(bytes)
      await io.writeFile(p.output, wav)
      if (!p.quiet) line(io, `已写入 ${p.output}（WAV，${wav.length} 字节）`)
      return { code: EXIT.ok, json: { schema: 1, type: 'wav', output: p.output, bytes: wav.length } }
    }
    io.err(`play 的 -t 支持 midi | wav（收到 “${type}”）`)
    return { code: EXIT.usage }
  }

  // ── settings / config（P4）：设置分层可解释 ──────────────
  if (p.command === 'settings' || p.command === 'config') {
    let src = ''
    if (p.inputs.length > 0 && p.inputs[0] !== '-') {
      try {
        src = await io.readFile(p.inputs[0])
      } catch (e) {
        io.err(`读输入失败：${String(e)}`)
        return { code: EXIT.noInput }
      }
    }
    /** 三层来源（当前 CLI 支持的两层 + 命令行覆盖） */
    const srcCfg = (extractJpsConfig(src) ?? {}) as Record<string, unknown>
    const merged = mergeJpsConfig(src, defaultPageConfig) as unknown as Record<string, unknown>
    const overrides: Record<string, string> = {}
    for (const kv of p.sets) {
      const i = kv.indexOf('=')
      if (i <= 0) {
        io.err(`-s 需要 k=v 形式（收到 “${kv}”）`)
        return { code: EXIT.config }
      }
      overrides[kv.slice(0, i)] = kv.slice(i + 1)
    }
    const keys = [...Object.keys(defaultPageConfig), ...OPTIONAL_CONFIG_FIELDS]
    const where = (k: string): string => {
      if (k in overrides) return '命令行 -s'
      if (k in srcCfg) return '源内 # jps-config'
      return '代码默认'
    }
    const valueOf = (k: string): unknown => (k in overrides ? overrides[k] : merged[k])
    const wantList = p.command === 'config' || p.inPlace /* --print-effective 走 -t effective 亦可 */
    if (p.type === 'effective' || wantList) {
      const rows = keys.map((k) => ({ key: k, value: valueOf(k), source: where(k) }))
      if (wantJson) line(io, JSON.stringify({ schema: 1, rows }, null, 2))
      else {
        line(io, `生效设置（来源：命令行 > 源内 # jps-config > 代码默认）`)
        for (const r of rows) {
          if (r.source === '代码默认' && p.quiet) continue
          line(io, `  ${r.key} = ${JSON.stringify(r.value)}   [${r.source}]`)
        }
      }
      return { code: EXIT.ok, json: { schema: 1, rows } }
    }
    const key = p.inputs[1] ?? p.inputs[0]
    if (key === undefined || !keys.includes(key)) {
      io.err(
        `settings 需要键名（位置参数），例如：settings -i <谱> margin_right\n` +
          `  可用键 ${keys.length} 个：settings -i <谱> -t effective 可全量列出；` +
          `可选字段：${OPTIONAL_CONFIG_FIELDS.join('、')}`,
      )
      return { code: EXIT.usage }
    }
    const payload = { schema: 1, key, value: valueOf(key), source: where(key) }
    if (wantJson) line(io, JSON.stringify(payload, null, 2))
    else line(io, `${key} = ${JSON.stringify(payload.value)}   [来自：${payload.source}]`)
    return { code: EXIT.ok, json: payload }
  }

  if (p.command === 'render') {
    let src = ''
    try {
      src = (await readInput(p.inputs[0], io)).text
    } catch (e) {
      io.err(`读输入失败：${String(e)}`)
      return { code: EXIT.noInput }
    }
    const type = inferType(p)
    const { errors } = splitParseIssues(parseJps(src))
    if (errors.length > 0) {
      io.err(`源码有 ${errors.length} 个错误，先修好再渲染（用 lint 看细节）`)
      return { code: EXIT.syntax }
    }
    const cfg: PageConfig = mergeJpsConfig(src, defaultPageConfig)
    const parsed = parseJps(src)
    /**
     * adj873（T-3 补落点）：`--crop page|score [--pad N] [--ink x,y,w,h]` 的参数校验。
     * **缺省 `page`**（= 改动前的整页行为，逐字节一致）✓；非法值一律报用法错误（不猜、不静默 ✗）。
     */
    const crop = normalizeCrop(p.crop)
    if (crop === null) {
      io.err(`--crop 支持 page | score（收到 “${String(p.crop)}”）`)
      return { code: EXIT.usage }
    }
    let pad: number | undefined
    if (p.pad !== null) {
      const n = Number(p.pad)
      if (!Number.isFinite(n)) {
        io.err(`--pad 需要数字（每边留白 px，0–64；收到 “${p.pad}”）`)
        return { code: EXIT.usage }
      }
      pad = normalizeRangePad(n)
    }
    const inkArg = parseInkArg(p.ink)
    if (p.ink !== null && inkArg === null) {
      io.err(`--ink 需要 x,y,w,h 四个正数（如 --ink 50,80,495,600；收到 “${p.ink}”）`)
      return { code: EXIT.usage }
    }
    if (type === 'midi') {
      const layout = layoutScore(parsed, cfg)
      const seq = buildPlaySequence(parsed, layout, typeof cfg === 'object' ? 60 : 60)
      const bytes = eventsToMidi(seq.events, { bpm: 60, title: 'iJipu' })
      const target = p.output
      if (target === null || target === '-') {
        io.err('MIDI 是二进制，必须用 -o 指定文件（不能用 stdout）')
        return { code: EXIT.usage }
      }
      await io.writeFile(target, bytes)
      if (!p.quiet) line(io, `已写入 ${target}（MIDI，${bytes.length} 字节）`)
      return { code: EXIT.ok, json: { schema: 1, type: 'midi', output: target, bytes: bytes.length } }
    }
    if (type !== 'svg' && type !== 'text' && type !== 'png' && type !== 'jpg' && type !== 'pdf') {
      io.err(`render 的 -t 支持 svg | midi | png | jpg | pdf（收到 “${type}”；wav 请用 play -t wav）`)
      return { code: EXIT.usage }
    }
    if (type === 'png' || type === 'jpg' || type === 'pdf') {
      /**
       * adj803（A·P3）：位图/PDF 需要 canvas/字体/分页 ⇒ 由**宿主**注入 `rasterize`
       * （桌面端 = 隐藏窗口渲染，决策②；复用应用 `src/export/*` ⇒ 与 GUI 导出像素级一致 ✓）。
       * 独立 Node 环境下**明确报错**（退出码 4 = 渲染失败），不产出半成品 ✗。
       */
      if (io.rasterize === undefined) {
        io.err(
          `-t ${type} 需要"隐藏窗口渲染"通道（桌面端 exe 内置）；当前环境没有该能力。\n` +
            `  可用：-t svg（矢量，任意环境）｜或改用桌面端：ijipu render -i <谱> -t ${type} -o <输出>`,
        )
        return { code: EXIT.render }
      }
      const layoutP = layoutScore(parsed, cfg)
      // adj873：位图/PDF 与矢量走**同一套**范围口径（同一份墨迹盒、同一个 `applyRangeToSvg`）
      const croppedP = cropSvgs(renderScoreToSvg(layoutP), layoutP, crop, pad, inkArg)
      if (croppedP.error !== undefined) {
        io.err(croppedP.error)
        return { code: EXIT.render }
      }
      const svgsP = croppedP.svgs
      const title = (parsed.header as unknown as Record<string, unknown>)['title']
      const files = await io.rasterize({
        svgs: svgsP,
        type,
        scale: 2,
        title: typeof title === 'string' ? title : 'iJipu',
      })
      if (p.output === null || p.output === '-') {
        io.err(`${type.toUpperCase()} 是二进制，必须用 -o 指定文件（不能用 stdout）`)
        return { code: EXIT.usage }
      }
      const base = p.output.replace(new RegExp(`\\.${type}$`, 'i'), '')
      const made: string[] = []
      for (let i = 0; i < files.length; i += 1) {
        const path = files.length > 1 ? `${base}-${i + 1}.${type}` : `${base}.${type}`
        await io.writeFile(path, files[i])
        made.push(path)
      }
      if (!p.quiet) line(io, `已写入 ${made.join('、')}`)
      return { code: EXIT.ok, json: { schema: 1, type, pages: files.length, outputs: made } }
    }
    const layout = layoutScore(parsed, cfg)
    // adj873：`--crop score` 在这里落地（`page` 原样返回 ⇒ 与改动前逐字节一致）
    const cropped = cropSvgs(renderScoreToSvg(layout), layout, crop, pad, inkArg)
    if (cropped.error !== undefined) {
      io.err(cropped.error)
      return { code: EXIT.render }
    }
    const svgs = cropped.svgs
    if (p.output === null || p.output === '-') {
      line(io, svgs.join('\n<!-- 分页 -->\n'))
      return { code: EXIT.ok, json: { schema: 1, type: 'svg', pages: svgs.length, crop } }
    }
    const base = p.output.replace(/\.svg$/i, '')
    const made: string[] = []
    for (let i = 0; i < svgs.length; i += 1) {
      const path = svgs.length > 1 ? `${base}-${i + 1}.svg` : `${base}.svg`
      await io.writeFile(path, svgs[i])
      made.push(path)
    }
    if (!p.quiet) line(io, `已写入 ${made.join('、')}`)
    return { code: EXIT.ok, json: { schema: 1, type: 'svg', pages: svgs.length, outputs: made, crop } }
  }

  // ── batch（P2）：目录批量转换 ────────────────────────────
  if (p.command === 'batch') {
    const inDir = p.inputs[0]
    const outDir = p.output
    if (inDir === undefined || inDir === '-') {
      io.err('batch 需要 --in <目录>（stdin 不适用）')
      return { code: EXIT.usage }
    }
    if (outDir === null || outDir === '-') {
      io.err('batch 需要 -o <目录>')
      return { code: EXIT.usage }
    }
    let names: string[]
    try {
      names = (await io.listDir(inDir)).filter((n) => n.toLowerCase().endsWith('.jps'))
    } catch (e) {
      io.err(`读目录失败：${String(e)}`)
      return { code: EXIT.noInput }
    }
    const to = (p.type ?? 'svg').toLowerCase()
    let okCount = 0
    const failed: string[] = []
    for (const name of names) {
      const stem = name.replace(/\.jps$/i, '')
      try {
        const src = await io.readFile(`${inDir}/${name}`)
        const { errors } = splitParseIssues(parseJps(src))
        if (errors.length > 0) {
          failed.push(`${name}（${errors.length} 个语法错误）`)
          continue
        }
        if (to === 'midi') {
          const parsed = parseJps(src)
          const layout = layoutScore(parsed, mergeJpsConfig(src, defaultPageConfig))
          const bytes = eventsToMidi(buildPlaySequence(parsed, layout, 60).events, { bpm: 60, title: stem })
          await io.writeFile(`${outDir}/${stem}.mid`, bytes)
        } else if (to === 'fmt' || to === 'format' || to === 'jps') {
          await io.writeFile(`${outDir}/${stem}.jps`, formatJps(src))
        } else {
          const parsed = parseJps(src)
          const layout = layoutScore(parsed, mergeJpsConfig(src, defaultPageConfig))
          const svgs = renderScoreToSvg(layout)
          for (let i = 0; i < svgs.length; i += 1) {
            const path = svgs.length > 1 ? `${outDir}/${stem}-${i + 1}.svg` : `${outDir}/${stem}.svg`
            await io.writeFile(path, svgs[i])
          }
        }
        okCount += 1
      } catch (e) {
        failed.push(`${name}（${String(e)}）`)
      }
    }
    line(io, `批处理完成：成功 ${okCount} 个、失败 ${failed.length} 个（输出到 ${outDir}，类型 ${to}）`)
    for (const f of failed) line(io, `  ✗ ${f}`)
    return {
      code: failed.length === 0 ? EXIT.ok : EXIT.syntax,
      json: { schema: 1, ok: okCount, failed },
    }
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

  // ── lint（P1；adj814 起支持 --watch）──────────────────────
  if (p.command === 'lint') {
    /** 单次检查 → 文本 + 结论（watch 复用同一份逻辑，避免两份口径 ✗） */
    const runOnce = (): { errors: ParseIssue[]; warnings: ParseIssue[]; ok: boolean } => {
      const parsed = parseJps(source)
      const { errors, warnings } = splitParseIssues(parsed)
      return { errors, warnings, ok: errors.length === 0 }
    }
    if (p.watch) {
      /**
       * adj814：`--watch` —— 文件变化就重跑一次检查（CI/写谱时的即时反馈 ✓）。
       * 能力由宿主注入；没有该能力就明确报错 ✓。**永不静默不监视** ✗。
       */
      if (io.watchFile === undefined) {
        io.err('--watch 需要宿主的文件监视能力（node 入口提供；独立环境不可用）')
        return { code: EXIT.usage }
      }
      if (fromStdin) {
        io.err('--watch 不能用于 stdin（要监视具体文件）')
        return { code: EXIT.usage }
      }
      const target = String(p.inputs[0])
      let first = true
      const pass = (): void => {
        const r = runOnce()
        line(io, `${first ? '首次' : '变更后'}检查：错误 ${r.errors.length} 个、告警 ${r.warnings.length} 个${r.ok ? ' ✓' : ''}`)
        for (const e of r.errors.slice(0, 5)) line(io, issueLine(e as { line?: number; message?: string; text?: string }, false).replace('%FILE%', target))
        first = false
      }
      pass()
      await new Promise<void>((resolve) => {
        const stop = io.watchFile?.(target, () => {
          // 重新读盘（外部可能已改过文件 ✓）
          void io
            .readFile(target)
            .then((t) => {
              source = t
              pass()
            })
            .catch((e) => io.err(`读文件失败：${String(e)}`))
        })
        // 宿主没给 stop（异常情况）⇒ 立刻结束，不留悬挂 Promise ✓
        if (stop === undefined) resolve()
      })
      return { code: EXIT.ok, json: { schema: 1, watched: target } }
    }
    const { errors, warnings } = runOnce()
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
