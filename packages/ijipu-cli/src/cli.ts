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
import { formatJps, parseJps, splitParseIssues, layoutScore, renderScoreToSvg, buildPlaySequence, eventsToMidi, defaultPageConfig, mergeJpsConfig, extractJpsConfig, OPTIONAL_CONFIG_FIELDS, rangeBox, applyRangeToSvg, readViewBoxOf, normalizeRangePad, inkBoxesOfLayout, type PageConfig, type ScoreLayout, type RangeBox, type ExportRange, type ProblemRow } from '@ijipu/engine'
// adj944：注册/解除 PATH 的**纯逻辑与编排**（与全局设置里那个按钮**共用同一份** ✓）
import {
  cliPathRegister,
  cliPathStatus,
  cliPathUnregister,
  PATH_MAX_CHARS,
  type PathHostIo,
} from './envPath'

/** 退出码：**对外承诺**，只增不改（脚本/CI 依赖它） */
export const EXIT = {
  ok: 0,
  usage: 1,
  noInput: 2,
  syntax: 3,
  render: 4,
  config: 5,
  /**
   * adj944：**环境能力缺失** —— 例如"注册/解除 PATH"要读写当前用户的注册表，
   * 这个能力只有桌面端 `ijipu.exe`（内嵌 CLI）有；独立 Node 环境没有 ⇒ 如实报 6，
   * 与"用法错误(1)""渲染能力缺失(4)"都分开（脚本据此就能判断"换个环境再跑"✓）。
   */
  env: 6,
} as const

/**
 * 目录里的一项（adj956）。
 *
 * 为什么不是"只回文件名"了：`batch` / `lint -i <目录>` 要能**递归子目录**（`-r`），
 * 而"名字"本身分不出哪个是目录 ✗。用一次 `readdir(withFileTypes)` 就拿到，不必额外 stat。
 */
export type DirEntry = {
  /** 条目名（不含路径） */
  name: string
  /** 是不是目录（递归时据此下钻） */
  dir: boolean
}

/** 注入式 IO（便于测试与"同 exe 子命令"复用） */
export type CliIo = {
  readStdin(): Promise<string>
  readFile(path: string): Promise<string>
  /** 文本或**二进制**（MIDI 等；adj802 起支持 `Uint8Array`） */
  writeFile(path: string, data: string | Uint8Array): Promise<void>
  exists(path: string): Promise<boolean>
  /**
   * 列目录里**一层**的条目（`batch` / `lint -i <目录>` 用）。
   *
   * adj956：返回值从 `string[]` 改成 `DirEntry[]` —— 只有名字分不出目录，递归无从下手。
   * 约定：**按名字排序**（顺序可复现 ⇒ 输出能逐字节比对 ✓）、**只回一层**（递归由 CLI 自己下钻，
   * 免得把"要不要跟符号链接"这类平台细节塞进每个宿主）。
   */
  listDir(dir: string): Promise<DirEntry[]>
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
  /**
   * adj944（用户需求「只有注册后，打开终端就能 `ijipu cli`」）**可选能力**：注入本机
   * "注册/解除 PATH"所需的 IO（安装目录 / 读写 `HKCU\Environment\Path` / App Paths）。
   *
   * 与 `rasterize`/`synthesize`/`watchFile` **同一口径**：由宿主注入 ✓ ——
   * 桌面端 exe（内嵌 CLI）注入 Rust 实现；独立 Node 入口**不注入** ⇒
   * `register`/`unregister`/`status` **明确报错（退出码 6）**，不假装成功 ✗。
   * 逻辑本身（字符串口径 + 编排）在 `envPath.ts`，与全局设置里那个按钮**共用一份** ✓。
   */
  pathHost?: PathHostIo
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

用法：ijipu cli [全局选项] <命令> [命令选项]

⚠ 第一个参数必须**恰好**是 cli：命令行与图形界面是同一个 exe，靠它分流。
  不带 cli 时（例如 ijipu 我的谱.jps、ijipu --help）会照旧**打开图形界面**，不执行命令。
  注册 PATH 之后终端里的 ijipu 是控制台垫片 bin\\ijipu.cmd：它**原样转交**参数、不替你补 cli。

命令：
  format        -i <文件|-> [-o <文件|->] [--check] [--in-place] [--diff]     按应用规范规范化源码
  lint          -i <文件|目录|-> [--format text|json|gh] [--watch]            语法检查（有错 ⇒ 退出码 3）
                [-r] [--filter <通配>]                                      输入给**目录**时批量检查
  info          -i <文件|-> [-t text|json]                                    谱面概况（行数/分组/问题数）
  render        -i <文件|-> -t svg|midi|png|jpg|pdf -o <输出>                 渲染/导出
                [--crop page|score] [--pad N] [--ink x,y,w,h]                画布范围（缺省 page = 整页）
  play          -i <文件|-> -t midi|wav -o <输出>                             导出音频
  batch         --in <目录> [-o <目录>] [-t lint,svg,midi,fmt]                目录批量操作
                [-r] [--filter <通配>]                                      任务可逗号组合；只有 -t lint 能省 -o
  settings      -i <谱> <键名> [-s k=v]                                       看某个设置项的值与来源
  config        -i <谱> [-t effective] [--quiet]                              打印生效设置全表 + 每项来源
  doctor        [--json]                                                      环境自检（如实报告能力有无）
  completions   bash|zsh|powershell                                           输出 shell 补全脚本
  register      [--json]                                                      把命令行入口目录（<安装目录>\\bin）注册进当前用户 PATH
  unregister    [--json]                                                      从当前用户 PATH 里解除注册
  status        [--json]                                                      看是否已注册（**读系统实况**）

目录类选项（lint -i <目录> 与 batch 都是这一套）：
  -r, --recursive           输入是目录时**连子目录一起**（缺省只看当前一层）
  --filter <通配符>          只处理**文件名**匹配的（支持 * 与 ?，如 --filter "春*"）；
                            输入是单个文件时它不生效（点名要那个文件，就没有再筛掉的道理）

全局选项：
  -i, --input <文件|目录|-> 输入（- = stdin；省略时也读 stdin）；--in 是别名
  -o, --output <文件|->     输出文件（- 或省略 = stdout）；batch 里是**输出目录**
  -t, --type <类型>         输出类型（省略时按 -o 后缀推断；batch 里可逗号组合）
  --json                    机器可读输出（带 schema 版本）
  --quiet                   不输出非必要信息
  --deterministic           输出不含时间戳（CI 逐字节比对用）
  -s <k=v>                  临时设置（可重复；优先级最高，**不落盘**）
                            接受于 settings / config / render / play / batch；键名写错 ⇒ 退出码 5
  --config <文件>           CLI 配置文件（**尚未实现**；给了 ⇒ 退出码 5）
  -h, --help                帮助
  -v, --version             版本

需要桌面端能力的两类输出：render -t png|jpg|pdf（canvas/字体/分页）、play -t wav（AudioContext + 音色库）。
  有宿主能力 ⇒ 正常产出；没有（独立 Node 环境）⇒ **退出码 4 + 原因** 并给出替代（-t svg / -t midi），
  不产出半成品、不假装成功。

注册类命令（register / unregister / status）**只在内嵌版可用**（ijipu.exe cli register）：
  它要读写当前用户的 PATH / App Paths，这个能力由桌面端注入；独立 Node 环境 ⇒ 退出码 6 + 原因。
  注册写进 PATH 的是**命令行入口目录 <安装目录>\\bin**（里面有控制台垫片 ijipu.cmd）——
  ijipu.exe 是 GUI 子系统程序，cmd 不等它（提示符会夹在输出中间、退出码也拿不到）；
  cmd **会等批处理文件** ⇒ 垫片把输出顺序/退出码/重定向一次性修好，而双击 .jps 照旧不闪黑框。
  注册后**要新开一个终端**才生效（已开着的终端看不到新 PATH）；只对**当前用户**生效、不需要管理员。

退出码：0 成功 ｜ 1 用法错误 ｜ 2 输入不存在 ｜ 3 语法错误 ｜ 4 渲染失败 ｜ 5 设置非法 ｜ 6 环境能力缺失
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
  /**
   * adj956：`-r` / `--recursive` —— 目录输入要不要**下钻子目录**。
   *
   * 缺省是**不递归**：一次手滑就会扫出用户没预期的一大批文件（"我只想查这一层"是更常见的意图）。
   */
  recursive: boolean
  /**
   * adj956：`--filter <通配符>` —— 按**文件名**筛（支持 `*` 与 `?`，如 `--filter "春*"`）。
   *
   * 为什么按文件名而不是整条路径：这个 CLI 的批量操作都是"一个目录里的谱"，
   * 让用户去写路径通配更容易写错；真要按目录挑，多敲一次 `-i <子目录>` 更直观。
   */
  filter: string | null
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
    recursive: false,
    filter: null,
  }
  const takesValue = new Set(['-i', '--input', '-o', '--output', '-t', '--type', '-s', '--set', '--config', '--format', '--crop', '--pad', '--ink', '--filter'])
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
    else if (a === '-r' || a === '--recursive') p.recursive = true
    else if (a === '--filter') {
      const v = next()
      if (v !== '') p.filter = v
    }
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

/**
 * 拼路径（统一用 `/`：CLI 只把路径字符串交给宿主，平台分隔符由宿主自己认）。
 *
 * adj960：`-i .`（用户实报那次的写法）走出来的路径会带 `./` 前缀 ⇒ 归一化掉，
 * 免得逐行输出长成 `./samples/x.jps 第 3 行：…`、与"直接给目录名"的形态不一致。
 */
function joinPath(dir: string, name: string): string {
  const d = dir.replace(/[\\/]+$/, '')
  if (d === '' || d === '.') return name
  return `${d}/${name}`
}

/**
 * adj956：把 `--filter` 的 `*` / `?` 通配符转成正则（大小写不敏感；只匹配**文件名**）。
 *
 * 刻意不引入 glob 依赖（`AGENTS §一`：新增依赖必须先询问）——`*` 与 `?` 两条就够用了，
 * 而且**只按文件名**匹配，写法越简单越不容易出错。
 */
function filterToRe(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${esc}$`, 'i')
}

/**
 * adj956：把输入展开成"要处理的 `.jps` 列表"（`lint -i <目录>` 与 `batch` **共用这一份口径**）。
 *
 * · **目录** ⇒ 列一层（`recursive` 时下钻子目录），按 `.jps` 后缀 + `--filter` 筛；
 * · **文件** ⇒ 原样一条（`--filter` **对它不生效**：用户点名要这个文件，没有再筛掉的道理）。
 *
 * 目录/文件的判据是**试一次 `listDir`**：宿主能力里目前只有它能区分二者（`exists` 只给"在不在"）。
 * 这样不必为了"这是文件还是目录"再给三处宿主接线加一个 `statKind`；而在文件上 `listDir`
 * 必然失败 ⇒ 落到"当文件读"，与从前行为一致 ✓。
 */
async function expandInputs(
  target: string,
  io: CliIo,
  recursive: boolean,
  filter: string | null,
): Promise<{ files: string[]; isDir: boolean }> {
  const re = filter === null ? null : filterToRe(filter)
  const hit = (name: string): boolean =>
    name.toLowerCase().endsWith('.jps') && (re === null || re.test(name))
  /**
   * ⚠ **只对顶层这一次 `listDir` 的失败做降级**（"不是目录 ⇒ 当单文件"）。
   *
   * 子目录读失败**必须抛出去**：第一版把整个 `walk` 包在同一个 try 里 ⇒ 递归时某个子目录
   * 权限不足/被删，异常会被那个 catch 吞掉、降级成"把目录当文件读"，最终报的是
   * "输入不存在"——**根因被藏起来了**（这正是本项目反复记的"静默失败"那一类 ✗）。
   */
  let top: DirEntry[]
  try {
    top = await io.listDir(target)
  } catch {
    return { files: [target], isDir: false }
  }
  const out: string[] = []
  const walk = async (dir: string, entries: DirEntry[]): Promise<void> => {
    for (const e of entries) {
      if (e.dir) {
        if (recursive) {
          const child = joinPath(dir, e.name)
          await walk(child, await io.listDir(child))
        }
        continue
      }
      if (hit(e.name)) out.push(joinPath(dir, e.name))
    }
  }
  await walk(target, top)
  // 排序：宿主各自排过一层，但递归把多层拼起来后要靠这里统一（输出必须可复现 ✓）
  return { files: out.sort(), isDir: true }
}

/**
 * adj956（**修一个真 bug**）：把 `-s k=v` 解析成覆盖对象。
 *
 * 由来：`-s` 原先只在 `settings` / `config` 里被真正消费，但 [守卫](cli.ts) 同时放行了
 * `render` / `play` / `batch` —— 那三个命令**从头到尾没读过 `p.sets`** ⇒ 用户写
 * `batch --in 谱 -o 出 -t svg -s margin_right=10` 会"被接受、然后静默忽略"，
 * 是最坏的一种错：不报错、结果却不是他要的。现在**统一在这里解析、由调用方套用**。
 *
 * 值按需粗转：能当数字就当数字（`margin_right=33` 要变成 `33` 而不是 `"33"`），
 * 其余保留字符串（`page=A4`）；`true`/`false` 也认。
 */
function parseOverrides(sets: readonly string[]): { overrides: Record<string, unknown>; error?: string } {
  const overrides: Record<string, unknown> = {}
  for (const kv of sets) {
    const i = kv.indexOf('=')
    if (i <= 0) return { overrides, error: `-s 需要 k=v 形式（收到 “${kv}”）` }
    const key = kv.slice(0, i)
    const raw = kv.slice(i + 1)
    overrides[key] =
      raw === 'true' ? true : raw === 'false' ? false : raw.trim() !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw
  }
  return { overrides }
}

/**
 * adj956：生效配置 = 代码默认 ← 谱面 `# jps-config` ← **命令行 `-s`（最高）**。
 *
 * `-s` 必须**最后**展开：`mergeJpsConfig` 内部是"源码盖过 fallback"，把覆盖值塞进 fallback
 * 会被谱面里的值反过来盖掉 ⇒ 与 `--help` 承诺的"优先级最高"不符 ✗。
 */
function effectiveConfig(src: string, overrides: Record<string, unknown>): PageConfig {
  return { ...mergeJpsConfig(src, defaultPageConfig), ...overrides } as PageConfig
}

/**
 * 问题清单 → 一行文字（`--format gh` 用 GitHub Actions 注解格式）。
 *
 * ## adj960（**用户实报**）：批量输入必须**指明是哪个文件**
 *
 * 用户拿 `ijipu cli -i . -r lint` 查 54 个文件，输出里只有一片 `第 20 行：倚音内不支持的符号`
 * —— **对不上号**（哪个文件？）。用户给的判据很清楚：
 * **"输出的信息是单一文件独有、还是共同信息"** ⇒ **独有的必须带文件名，共同的（那句汇总）不带**。
 *
 * 于是这个函数收一个可选的 `file`，并成为**唯一一处**格式出处（此前 `batch` 里另写了一份
 * `<文件> 第 N 行：…`，而 `lint` 那份漏了文件名 —— 同一件事两处实现，必然漂 ✗）：
 *  · `gh`：`::error file=<文件>,line=N::<消息>`（GitHub 靠这个 file 把问题标到对应的 diff 上）
 *  · 文本：`<文件> 第 N 行：<消息>`
 *
 * ⚠ 单文件输入（`lint -i a.jps`）**也带**文件名 —— 与目录输入同一口径（用户那条判据不区分两者）；
 *   stdin 没有文件名，用 `(stdin)` 顶上。
 */
function issueLine(
  issue: { line?: number; message?: string; text?: string },
  gh: boolean,
  file: string,
): string {
  const ln = issue.line ?? 0
  const msg = String(issue.message ?? issue.text ?? '').trim()
  return gh ? `::error file=${file},line=${ln}::${msg}` : `${file} 第 ${ln} 行：${msg}`
}

/** 输入的文件名（stdin 用 `(stdin)`）——**逐项输出**统一用它做归属 */
function fileLabelOf(spec: string | undefined, fromStdin: boolean): string {
  return fromStdin || spec === undefined || spec === '-' ? '(stdin)' : spec
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
  /**
   * adj956：**可设置项名单**（只此一处）——`settings` / `config` / `-s` 的键校验共用。
   * 顺序与 `docs/CLI.md` 的"生效设置全表"一致（默认字段在前、可选字段在后）。
   */
  const CONFIG_KEYS: string[] = [...Object.keys(defaultPageConfig), ...OPTIONAL_CONFIG_FIELDS]

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
  /**
   * adj956：`-s` 的**接受范围收敛到"真的会用它"的命令**。
   *
   * 原先这里放行了 `info` / `render` / `play` / `batch`，但**只有 `settings` / `config` 真的读了它**
   * ⇒ 另外那几条是"接受了、然后静默忽略"（最坏的一种错：不报错、结果却不是用户要的）。
   * 现在：`info` 从名单里去掉（它不看谱面设置），其余三条**本轮真的接上了**（见 `effectiveConfig`）。
   */
  if (p.sets.length > 0 && !['settings', 'config', 'render', 'play', 'batch'].includes(p.command)) {
    io.err('-s 只对 settings / config / render / play / batch 有意义（其它命令不看谱面设置；写回谱面属后续）')
    return { code: EXIT.config }
  }
  /** `-s k=v` 的解析**只在这里做一次**（格式错就统一报退出码 5，各命令不必各写一遍） */
  const parsedSets = parseOverrides(p.sets)
  if (parsedSets.error !== undefined) {
    io.err(parsedSets.error)
    return { code: EXIT.config }
  }
  const overrides = parsedSets.overrides
  /**
   * adj956：覆盖键必须是**真的设置项**。
   *
   * 为什么非查不可：`-s margn_right=10` 这种拼错，如果原样塞进配置对象，引擎**不认识这个键**
   * ⇒ 排版结果一个字不变、退出码还是 0 —— 又是一个"静默忽略"。宁可当用法错误拦下来。
   */
  const badKeys = Object.keys(overrides).filter((k) => !CONFIG_KEYS.includes(k))
  if (badKeys.length > 0) {
    io.err(
      `-s 里有未知设置项：${badKeys.join('、')}\n` +
        `  可用键 ${CONFIG_KEYS.length} 个（config -i <谱> -t effective 可全量列出；可选字段：${OPTIONAL_CONFIG_FIELDS.join('、')}）`,
    )
    return { code: EXIT.config }
  }

  /**
   * adj802（A·P2）：已实现命令集合。
   * `render`：源码 → SVG（每页一段）或 MIDI；`batch`：目录批量转换。
   * ⚠ SVG 走引擎**估算**角标墨迹（Node 里没有 canvas 实测 ⇒ 与应用的实测版会有亚像素差异，
   *    这是"CLI 无 DOM"的必然取舍，已在 docs/CLI.md 写明口径）。
   */
  const known = new Set(['format', 'lint', 'info', 'render', 'play', 'batch', 'settings', 'config', 'doctor', 'completions', 'register', 'unregister', 'status'])
  if (!known.has(p.command)) {
    io.err(`命令 “${p.command}” 尚未实现（用 --help 看已实现命令）`)
    return { code: EXIT.usage }
  }

  // ── completions（P4）：输出补全脚本（纯静态文本，零依赖）────
  if (p.command === 'completions') {
    const shell = (p.inputs[0] ?? p.type ?? 'bash').toLowerCase()
    const COMMANDS = 'format lint info render play batch settings config doctor completions register unregister status'
    /**
     * adj947（用户实报：`--help` 的用法行漏了 `cli`）：这三行**注释提示本身就是"怎么敲"**，
     * 同样必须带 `cli` —— 否则用户照抄 `ijipu completions powershell` 会走进图形界面 ✗。
     * ⚠ 这里**只改提示文案、不动补全逻辑**：脚本里的命令补全位次（bash 的 `COMP_CWORD -eq 1`、
     * zsh 的 `'1:command:…'`）是按 **Node 包形态**（`ijipu <命令>`）写的，
     * 与桌面端形态（`ijipu cli <命令>`）差一个参数位 —— 改它是**行为变更**，
     * 已在报告里列出待用户裁定，本轮不动 ✗（改了会让 Node 包那边的补全反过来坏掉）。
     */
    const scripts: Record<string, string> = {
      bash: `# iJipu bash 补全（桌面端）：source <(ijipu cli completions bash)\n_ijipu() {\n  local cur="\${COMP_WORDS[COMP_CWORD]}"\n  if [ "\$COMP_CWORD" -eq 1 ]; then COMPREPLY=( \$(compgen -W "${COMMANDS}" -- "\$cur") ); return; fi\n  COMPREPLY=( \$(compgen -f -- "\$cur") )\n}\ncomplete -F _ijipu ijipu\n`,
      zsh: `# iJipu zsh 补全（桌面端）：ijipu cli completions zsh > "\${fpath[1]}/_ijipu"\n#compdef ijipu\n_ijipu() { _arguments '1:command:(${COMMANDS})' '*:file:_files' }\n_ijipu "\$@"\n`,
      powershell: `# iJipu PowerShell 补全（桌面端）：ijipu cli completions powershell | Out-String | Invoke-Expression\nRegister-ArgumentCompleter -Native -CommandName ijipu -ScriptBlock {\n  param(\$wordToComplete, \$commandAst, \$cursorPosition)\n  @('${COMMANDS.split(' ').join("','")}') | Where-Object { \$_ -like "\$wordToComplete*" } | ForEach-Object {\n    [System.Management.Automation.CompletionResult]::new(\$_, \$_, 'ParameterValue', \$_)\n  }\n}\n`,
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

  /**
   * ── register / unregister / status（adj944）：把 iJipu 注册进**当前用户 PATH** ──────
   *
   * 用户需求：「只有注册后，才能在打开终端时就能 `ijipu cli`」。
   * 口令全部复用 `envPath.ts`（**与应用界面那个按钮同一份实现** ✓），这里只做"接线 + 文案 + 退出码"。
   *
   * ⚠ 读写 PATH/App Paths 的能力由**宿主注入**（`io.pathHost`）：内嵌版 `ijipu.exe cli …` 有 ✓，
   *   独立 Node 环境没有 ⇒ **如实报退出码 6**（不假装成功 ✗）。
   */
  if (p.command === 'register' || p.command === 'unregister' || p.command === 'status') {
    const host = io.pathHost
    if (host === undefined) {
      io.err(
        `“${p.command}”需要读写当前用户的 PATH/注册表，这个能力由**桌面端**注入（内嵌 CLI）。\n` +
          `  请改用：ijipu.exe cli ${p.command}（独立 Node 环境没有该能力 ⇒ 退出码 6）`,
      )
      return { code: EXIT.env }
    }
    if (p.command === 'status') {
      const st = await cliPathStatus(host)
      const payload = {
        schema: 1,
        registered: st.registered,
        installDir: st.installDir,
        binDir: st.binDir,
        legacy: st.legacy,
        pathLength: st.pathLength,
        pathLimit: PATH_MAX_CHARS,
        pathValue: st.pathValue,
        appPaths: st.appPaths,
      }
      if (wantJson) line(io, JSON.stringify(payload, null, 2))
      else {
        line(io, `iJipu CLI 注册状态：${st.registered ? '已注册 ✓（终端里可以直接敲 ijipu）' : '未注册 ✗（终端里还敲不了 ijipu）'}`)
        line(io, `  安装目录：${st.installDir}`)
        line(io, `  命令行入口目录（写进 PATH 的就是它）：${st.binDir}`)
        if (st.legacy) {
          line(
            io,
            '  ⚠ PATH 里还有**旧的注册形态**（安装目录本身，adj944 的口径）—— 它会跟垫片抢 ijipu，' +
              '跑一次 `ijipu cli register` 会自动把它换成命令行入口目录 ✓',
          )
        }
        line(io, `  当前用户 PATH：${st.pathLength} / ${PATH_MAX_CHARS} 字符`)
        line(io, `  App Paths：${st.appPaths ?? '（未注册）'}`)
        if (!st.registered) {
          line(io, '  注册：ijipu cli register（注册后**新开一个终端**才生效；只对当前用户生效、不需要管理员）')
        }
      }
      return { code: EXIT.ok, json: payload }
    }
    const action = p.command === 'register' ? await cliPathRegister(host) : await cliPathUnregister(host)
    if (!action.ok) {
      if (action.error.kind === 'too-long') {
        io.err(
          `注册后当前用户 PATH 会有 ${action.error.length} 字符，超过上限 ${action.error.limit} ⇒ **未写入**（PATH 一个字都没改）。\n` +
            '  建议：① 先在「系统属性 → 环境变量」里删掉 PATH 中已经不存在的目录（反复装卸的软件常留一堆）；\n' +
            '        ② 或把 iJipu 装到更短的路径（例如 C:\\iJipu）后再注册；\n' +
            '        ③ 也可以不动 PATH，直接用完整路径调用：<安装目录>\\bin\\ijipu.cmd cli lint 我的谱.jps\n' +
            '           （或 <安装目录>\\ijipu.exe cli lint 我的谱.jps —— 后者是 GUI 子系统程序，输出顺序/退出码/重定向都不如垫片）',
        )
      } else {
        io.err(
          `“${p.command}”失败：${action.error.detail}\n` +
            '  可能原因：注册表写入被安全软件拦截，或当前用户无权写 HKCU\\Environment。',
        )
      }
      return { code: EXIT.env }
    }
    const st = action.status
    const payload = {
      schema: 1,
      changed: action.changed,
      registered: st.registered,
      installDir: st.installDir,
      binDir: st.binDir,
      legacy: st.legacy,
      pathLength: st.pathLength,
      pathValue: st.pathValue,
      appPaths: st.appPaths,
    }
    if (wantJson) line(io, JSON.stringify(payload, null, 2))
    else if (p.command === 'register') {
      line(
        io,
        `${action.changed ? '已注册 ✓ 命令行入口目录已加入当前用户 PATH' : '已是注册状态 ✓（PATH 里本来就有这一条，未重复写入）'}：${st.binDir}`,
      )
      line(io, '  · 请**新开一个终端**，之后就能直接敲：ijipu cli lint 我的谱.jps')
      line(io, '  · 只对当前用户生效，不需要管理员权限')
      line(
        io,
        '  · 这一条是**命令行入口目录**（里面有控制台垫片 ijipu.cmd）：输出顺序、退出码、重定向都正常 ✓，' +
          '双击 .jps 照旧打开界面、不闪黑框',
      )
    } else {
      line(
        io,
        `${action.changed ? '已解除 ✓ 已从当前用户 PATH 里摘掉' : '本就未注册 ✓（PATH 里没有这一条，未改动 PATH）'}：${st.binDir}`,
      )
      line(io, '  · 其余 PATH 条目**逐字未动**；新开的终端里就不再能直接敲 ijipu 了')
      if (st.legacy) {
        line(io, `  · 旧形态（安装目录本身）也一并摘掉了：${st.installDir}`)
      }
    }
    return { code: EXIT.ok, json: payload }
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
    // adj956：`-s` 真的生效（此前 play 接受了 -s 却从不读它 ⇒ 静默忽略）
    const layout = layoutScore(parsed, effectiveConfig(src, overrides))
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
            '  可用：-t midi（任意环境）｜或改用桌面端：ijipu cli play -i <谱> -t wav -o <输出.wav>',
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
    /** 三层来源（代码默认 ← 源内 # jps-config ← 命令行 -s）；`overrides` 已在上面统一解析并校验过 */
    const srcCfg = (extractJpsConfig(src) ?? {}) as Record<string, unknown>
    const merged = mergeJpsConfig(src, defaultPageConfig) as unknown as Record<string, unknown>
    const keys = CONFIG_KEYS
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
    const cfg: PageConfig = effectiveConfig(src, overrides)
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
            `  可用：-t svg（矢量，任意环境）｜或改用桌面端：ijipu cli render -i <谱> -t ${type} -o <输出>`,
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

  /**
   * ── batch（P2）：目录批量操作 ────────────────────────────
   *
   * adj956（用户需求：**组合式批量**）：一次遍历目录，把多种任务一起做掉。
   *  · `-t` 支持**逗号组合**：`-t lint,fmt,svg`（原来一次只能一种，想组合就得跑几遍、目录遍历几遍）；
   *  · `-t lint` 时 `-o` **可以不写**（lint 不产出文件；原来 `-o` 是硬性必填，于是"只想查一遍"
   *    也得先编一个输出目录）；
   *  · `-r` 递归子目录、`--filter` 按文件名筛、`-s` 真的生效。
   *
   * `-t lint` 让"对整个目录做语法检查"不必再写 bat 循环（用户点名的那个用法）。
   */
  if (p.command === 'batch') {
    const inDir = p.inputs[0]
    if (inDir === undefined || inDir === '-') {
      io.err('batch 需要 --in <目录>（stdin 不适用）')
      return { code: EXIT.usage }
    }
    /** 任务名归一：同义词都收进来，免得用户为"fmt 还是 format"试两次 */
    const normTask = (t: string): string | null => {
      if (t === 'lint') return 'lint'
      if (t === 'svg') return 'svg'
      if (t === 'midi') return 'midi'
      if (t === 'fmt' || t === 'format' || t === 'jps') return 'fmt'
      return null
    }
    const tasks = (p.type ?? 'svg')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
    const kinds = tasks.map(normTask).filter((k): k is string => k !== null)
    const badTasks = tasks.filter((t) => normTask(t) === null)
    if (tasks.length === 0 || badTasks.length > 0) {
      io.err(
        `batch 的 -t 支持 lint | svg | midi | fmt（可逗号组合，如 -t lint,fmt,svg）；收到 “${badTasks.join(' ') || String(p.type ?? '')}”`,
      )
      return { code: EXIT.usage }
    }
    const outDir = p.output
    /** 只有 lint 不产出文件 ⇒ 只有"纯 lint"才允许省掉 `-o` */
    const writesFiles = kinds.some((k) => k !== 'lint')
    if (writesFiles && (outDir === null || outDir === '-')) {
      io.err(
        'batch 的 svg / midi / fmt 任务要写文件 ⇒ 必须给 -o <目录>（只有 -t lint 可以省略）\n' +
          '  · 只想看语法检查结果：ijipu cli batch --in <目录> -t lint',
      )
      return { code: EXIT.usage }
    }
    let expanded: { files: string[]; isDir: boolean }
    try {
      expanded = await expandInputs(inDir, io, p.recursive, p.filter)
    } catch (e) {
      io.err(`读目录失败：${String(e)}`)
      return { code: EXIT.noInput }
    }
    if (!expanded.isDir) {
      io.err(`batch 需要 --in <目录>（“${inDir}” 不是目录；单文件请用 lint / format / render）`)
      return { code: EXIT.usage }
    }
    const files = expanded.files
    let okCount = 0
    const failed: string[] = []
    type LintRow = { input: string; ok: boolean; errors: { line: number; message: string }[] }
    const lintRows: LintRow[] = []
    const gh = p.format === 'gh'
    for (const file of files) {
      const name = file.split('/').pop() ?? file
      const stem = name.replace(/\.jps$/i, '')
      /** 输出目录（纯 lint 时为空串）——⚠ 是**目录**，不是"目录 + 文件名"：
       *  第一版这里写成 `joinPath(outDir, stem)` 再拼文件名 ⇒ 产出 `out/a/a.svg` ✗（断言当场抓出来） */
      const outBase = outDir === null || outDir === '-' ? '' : outDir
      try {
        const src = await io.readFile(file)
        const { errors } = splitParseIssues(parseJps(src))
        if (errors.length > 0) {
          failed.push(`${file}（${errors.length} 个语法错误）`)
          if (kinds.includes('lint')) {
            lintRows.push({
              input: file,
              ok: false,
              errors: errors.map((e) => ({ line: e.line ?? 0, message: String(e.message ?? e.text ?? '') })),
            })
            if (gh) for (const e of errors) line(io, issueLine(e as { line?: number; message?: string }, true, file))
          }
          continue
        }
        if (kinds.includes('lint')) lintRows.push({ input: file, ok: true, errors: [] })
        // adj956：`-s` 真的生效（此前 batch 接受了 -s 却从不读它 ⇒ 静默忽略）
        const cfg = effectiveConfig(src, overrides)
        if (kinds.includes('midi')) {
          const parsed = parseJps(src)
          const layout = layoutScore(parsed, cfg)
          const bytes = eventsToMidi(buildPlaySequence(parsed, layout, 60).events, { bpm: 60, title: stem })
          await io.writeFile(joinPath(outBase, `${stem}.mid`), bytes)
        }
        if (kinds.includes('fmt')) {
          await io.writeFile(joinPath(outBase, `${stem}.jps`), formatJps(src))
        }
        if (kinds.includes('svg')) {
          const parsed = parseJps(src)
          const layout = layoutScore(parsed, cfg)
          const svgs = renderScoreToSvg(layout)
          for (let i = 0; i < svgs.length; i += 1) {
            const fileName = svgs.length > 1 ? `${stem}-${i + 1}.svg` : `${stem}.svg`
            await io.writeFile(joinPath(outBase, fileName), svgs[i])
          }
        }
        okCount += 1
      } catch (e) {
        failed.push(`${file}（${String(e)}）`)
      }
    }
    const lintErrors = lintRows.reduce((n, r) => n + r.errors.length, 0)
    const payload = {
      schema: 1,
      tasks: kinds,
      inputs: files.length,
      ok: okCount,
      failed,
      ...(kinds.includes('lint') ? { lint: lintRows, lintErrors } : {}),
    }
    /**
     * adj956：`--json` 要**真的写 JSON 到 stdout**。
     *
     * 原实现无论有没有 `--json` 都只打那句中文汇总，`json` 只存在返回值里 ⇒ 拿这个 CLI 当
     * 机器接口用的人（脚本/CI）在 `--json` 下拿到的仍然是人话，与 `lint`/`info`/`config`
     * 的口径不一致 ✗（`--help` 明写"机器可读输出"）。
     */
    if (wantJson) line(io, JSON.stringify(payload, null, 2))
    else {
      line(
        io,
        `批处理完成：成功 ${okCount} 个、失败 ${failed.length} 个（任务 ${kinds.join(',')}；` +
          `输入 ${files.length} 个文件${outDir === null || outDir === '-' ? '' : `，输出到 ${outDir}`}）`,
      )
      if (kinds.includes('lint') && !gh && !p.quiet) {
        for (const r of lintRows) {
          // adj960：与 `lint -i <目录>` **同一份格式**（含文件名；此前这里另写了一份）
          for (const e of r.errors) line(io, issueLine({ line: e.line, message: e.message }, false, r.input))
        }
      }
      for (const f of failed) line(io, `  ✗ ${f}`)
    }
    return { code: failed.length === 0 ? EXIT.ok : EXIT.syntax, json: payload }
  }

  /**
   * ── lint（adj956）：输入可以是**目录** ─────────────────────────
   *
   * 用户需求原话：「如果我要获取指定目录下的所有 jps 文件的 lint 情况，是需要借助 bat 文件来实现
   * 还是 batch 参数就可以实现？」—— 改之前**两条路都走不通**（`batch` 没有 lint；`lint` 只吃单文件），
   * 只能在 bat 里写 `for %%f in (*.jps) do ...`。现在一条命令：
   *   `ijipu cli lint -i 乐谱目录 -r --filter "春*"`
   *
   * ⚠ 目录分支必须放在**读输入之前**：`readFile(目录)` 会失败，而"这是目录"只有 `listDir` 判得出来
   *   （见 `expandInputs` 的说明）。单文件 / stdin 的老路径一个字不动，继续往下走。
   */
  if (p.command === 'lint' && p.inputs[0] !== undefined && p.inputs[0] !== '-') {
    let expanded: { files: string[]; isDir: boolean }
    try {
      expanded = await expandInputs(p.inputs[0], io, p.recursive, p.filter)
    } catch (e) {
      io.err(`读目录失败：${String(e)}`)
      return { code: EXIT.noInput }
    }
    if (expanded.isDir) {
      if (p.watch) {
        io.err('--watch 只支持单个文件（要对整个目录做即时检查，请用脚本循环逐文件调用）')
        return { code: EXIT.usage }
      }
      if (expanded.files.length === 0) {
        io.err(
          `目录里没有 .jps：${p.inputs[0]}${p.recursive ? '' : '（子目录里的谱要加 -r 才会被扫到）'}`,
        )
        return { code: EXIT.noInput }
      }
      const gh = p.format === 'gh'
      type Row = {
        input: string
        ok: boolean
        errors: { line: number; message: string }[]
        warnings: { line: number; message: string }[]
      }
      const rows: Row[] = []
      let errCount = 0
      let warnCount = 0
      for (const file of expanded.files) {
        let src = ''
        try {
          src = await io.readFile(file)
        } catch (e) {
          io.err(`读文件失败：${file}：${String(e)}`)
          return { code: EXIT.noInput }
        }
        const { errors, warnings } = splitParseIssues(parseJps(src))
        errCount += errors.length
        warnCount += warnings.length
        const pick = (x: { line?: number; message?: string; text?: string }): { line: number; message: string } => ({
          line: x.line ?? 0,
          message: String(x.message ?? x.text ?? ''),
        })
        rows.push({ input: file, ok: errors.length === 0, errors: errors.map(pick), warnings: warnings.map(pick) })
        if (!wantJson && !p.quiet) {
          // adj960：目录输入 —— 每条问题都带文件名（**用户实报的那条**）
          for (const e of errors) line(io, issueLine(e as { line?: number; message?: string }, gh, file))
          for (const w of warnings) line(io, issueLine(w as { line?: number; message?: string }, gh, file))
        }
      }
      const payload = {
        schema: 1,
        generator: `ijipu ${version}`,
        files: rows,
        ok: errCount === 0,
        errors: errCount,
        warnings: warnCount,
      }
      if (wantJson) line(io, JSON.stringify(payload, null, 2))
      else if (!p.quiet) {
        const badCount = rows.filter((r) => !r.ok).length
        line(
          io,
          `检查 ${rows.length} 个文件：${rows.length - badCount} 个通过、${badCount} 个有错` +
            `（错误 ${errCount} 个、告警 ${warnCount} 个）`,
        )
      }
      return { code: errCount === 0 ? EXIT.ok : EXIT.syntax, json: payload }
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
    const runOnce = (): { errors: ProblemRow[]; warnings: ProblemRow[]; ok: boolean } => {
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
        for (const e of r.errors.slice(0, 5)) line(io, issueLine(e as { line?: number; message?: string; text?: string }, false, target))
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
    // adj960：逐项输出的"文件归属"只有这一处口径（stdin ⇒ `(stdin)`）
    const file = fileLabelOf(p.inputs[0], fromStdin)
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
      // adj960：单文件**也带**文件名 —— 与目录输入同一口径（用户那条判据不区分两者）；
      //   stdin 时 `file` 就是 `(stdin)`（见上面 `fileLabelOf`）
      for (const e of errors) line(io, issueLine(e as { line?: number; message?: string; text?: string }, gh, file))
      for (const w of warnings) line(io, issueLine(w as { line?: number; message?: string; text?: string }, gh, file))
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
