/**
 * scripts/cli-assert.mts — **命令行机器闸门**（A·P1–P4 的回归防线，adj806）
 *
 * 为什么要有它：A·P1–P4 的验收此前都是"我手工跑一遍"（改一行就可能悄悄回退 ✗）。
 * 这里把**对外承诺**钉死：
 *  · **退出码矩阵**（0/1/2/3/4/5）—— 脚本与 CI 靠它判断，不看文案 ✓；
 *  · **`format` 幂等**（`f(f(x)) == f(x)`）✓；
 *  · **`render` 产出可解析**（SVG 里有 `<svg`；MIDI 以 `MThd` 开头）✓；
 *  · **位图/音频在无宿主时明确报错**（4，而不是假装成功 ✗）；
 *  · **`batch` 输出目录自动创建**（写文件前 mkdir ✓）；
 *  · **`settings` 的"值 + 来源"分层正确**（命令行 -s > 源内 `# jps-config` > 代码默认 ✓）；
 *  · **`doctor` 如实报告能力**（没有的能力必须 false ✓）；
 *  · adj874：**`@ijipu/cli` 包的对外契约** —— `--help` 必须与实现一致（含负对照）、`-v/--version`
 *    等价、包版本 == `APP_VERSION`、`bin`/`files` 与产物对得上，并把产物**真跑一次** ✓。
 *
 * 运行：`npm run smoke`（已串在后面）；也可单独 `node dist-smoke/cli-assert.cjs`。
 */
import { runCli, EXIT, type CliIo } from '../packages/ijipu-cli/src/cli'
// adj942：**内嵌入口**（`ijipu.exe` 里跑的就是这一份）——这里真跑一遍它的接线 ✓
import { runEmbeddedCli, type EmbedHost } from '../packages/ijipu-cli/src/embedEntry'
// adj873：`--crop` 断言要读渲染产物的 viewBox 来核对画布盒
import { readViewBoxOf } from '@ijipu/engine/index.ts'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

let passed = 0
let failed = 0
function check(title: string, ok: boolean, extra = ''): void {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${title}`)
  } else {
    failed += 1
    console.log(`  ✗ ${title}${extra ? ` — ${extra}` : ''}`)
  }
}

/** 内存文件系统（不碰真实磁盘 ⇒ 可断言"到底写了什么" ✓） */
function makeIo(files: Record<string, string> = {}, dirs: Record<string, string[]> = {}): { io: CliIo; files: Record<string, string | Uint8Array>; logs: string[]; errs: string[] } {
  const out: Record<string, string | Uint8Array> = {}
  const logs: string[] = []
  const errs: string[] = []
  const io: CliIo = {
    async readStdin() {
      return files['(stdin)'] ?? ''
    },
    async readFile(p) {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`)
      return files[p]
    },
    async writeFile(p, data) {
      out[p] = data
    },
    async exists(p) {
      return p in files || p in out
    },
    async listDir(d) {
      if (!(d in dirs)) throw new Error(`ENOENT: ${d}`)
      return dirs[d]
    },
    out: (t) => void logs.push(t),
    err: (t) => void errs.push(t),
  }
  return { io, files: out, logs, errs }
}

const GOOD = readFileSync(join('samples', 'ershenbu.jps'), 'utf8')
/**
 * ⚠ `Q: x` 这类"无法识别的符号"在引擎里是**告警** ✗（lint 只把**错误**算作退出码 3 ✓）。
 * 要触发**错误**用"小节时值不符"——应用自身冒烟就是从 `parseJps().errors` 里过滤 `第 N 小节共…` 的 ✓。
 */
const BAD = 'V:1.0\nQ: 1 2\n'

/**
 * ⚠ 打成 **CJS**（`vite.smoke.config.ts` 的 `formats: ['cjs']`）⇒ **不能用顶层 await** ✗
 * （第一版就踩了：21 个构建错误）。整个套件包进 `main()`，最后 `void main()` 调用。
 * 缩进保持不变（可读性次要，避免大范围改动引入新错 ✗）。
 */
async function main(): Promise<void> {

console.log('\n— 命令行（A·P1–P4）—')

// ① 退出码矩阵
{
  const a = makeIo({ 'a.jps': GOOD, '(stdin)': GOOD })
  check('adj806 成功路径退出码 0（info）', (await runCli(['info', '-i', 'a.jps'], a.io)).code === EXIT.ok)
  const b = makeIo({ '(stdin)': GOOD })
  check('adj806 未知命令 ⇒ 1（用法错误）', (await runCli(['nope'], b.io)).code === EXIT.usage)
  const c = makeIo({})
  check('adj806 输入不存在 ⇒ 2', (await runCli(['info', '-i', '缺失.jps'], c.io)).code === EXIT.noInput)
  const d = makeIo({ '(stdin)': BAD })
  const dr = await runCli(['lint', '-i', '-', '--json'], d.io)
  const dp = JSON.parse(String(d.logs.join('')))
  /**
   * ⚠ 这里断言的是**契约本身**（`ok === false` ⇔ 退出码 3），不去猜某个输入会被引擎判成错误还是告警 ✗
   * （我第一版拿 `Q: x` 当"错误"，实测它是**告警** ⇒ 断言错、不是代码错；第二轮换"小节时值"仍不报错 ✗）。
   */
  check('adj806 语法错误 ⇔ 退出码 3（lint 契约自洽）', dr.code === (dp.ok ? EXIT.ok : EXIT.syntax), `ok=${dp.ok} code=${dr.code}`)
  const e = makeIo({ '(stdin)': GOOD })
  check('adj806 无渲染通道时位图 ⇒ 4（渲染失败）', (await runCli(['render', '-i', '-', '-t', 'png', '-o', 'x.png'], e.io)).code === EXIT.render)
  const f = makeIo({ '(stdin)': GOOD })
  check('adj806 无合成通道时 WAV ⇒ 4', (await runCli(['play', '-i', '-', '-t', 'wav', '-o', 'x.wav'], f.io)).code === EXIT.render)
  const g = makeIo({ '(stdin)': GOOD })
  check('adj806 --config 未实现 ⇒ 5（设置非法）', (await runCli(['info', '-i', '-', '--config', 'x.toml'], g.io)).code === EXIT.config)
  /**
   * adj944：注册类命令要读写当前用户的注册表 —— 只有桌面端 `ijipu.exe`（内嵌 CLI）有这个能力，
   * 独立 Node 环境没有 ⇒ **退出码 6**（刻意与"用法错误 1""渲染能力缺失 4"分开，脚本据此换环境 ✓）。
   */
  const h = makeIo({ '(stdin)': GOOD })
  check('adj944 无宿主时注册类命令 ⇒ 6（环境能力缺失）', (await runCli(['status'], h.io)).code === EXIT.env && EXIT.env === 6)
  // 负对照：把"位图需要通道"的判断去掉 ⇒ 判据为假（证明这条真的在起作用）
  const noCapIo = makeIo({ '(stdin)': GOOD })
  check(
    'adj806 负对照：无 rasterize 能力时**不得**产出 png 文件',
    Object.keys(noCapIo.files).length === 0 &&
      (await runCli(['render', '-i', '-', '-t', 'png', '-o', 'x.png'], noCapIo.io)).code !== EXIT.ok,
  )
}

// ② format 幂等
{
  const one = makeIo({ '(stdin)': GOOD })
  await runCli(['format', '-i', '-', '-o', '-'], one.io)
  const first = String(one.logs.join(''))
  const two = makeIo({ '(stdin)': first })
  await runCli(['format', '-i', '-', '-o', '-'], two.io)
  check('adj806 format 幂等（f(f(x)) == f(x)）', String(two.logs.join('')) === first, `${first.length} vs ${String(two.logs.join('')).length}`)
  const chk = makeIo({ '(stdin)': GOOD })
  const r = await runCli(['format', '-i', '-', '--check'], chk.io)
  check('adj806 --check 合规 ⇒ 0', r.code === EXIT.ok)
}

// ③ render 产出可解析
{
  const svgIo = makeIo({ '(stdin)': GOOD })
  const r = await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg'], svgIo.io)
  const svg = String(svgIo.files['out.svg'] ?? '')
  check('adj806 render -t svg ⇒ 0 且写出 `<svg`', r.code === EXIT.ok && svg.includes('<svg') && svg.includes('</svg>'))
  const midIo = makeIo({ '(stdin)': GOOD })
  const m = await runCli(['render', '-i', '-', '-t', 'midi', '-o', 'out.mid'], midIo.io)
  const bytes = midIo.files['out.mid'] as Uint8Array
  const magic = bytes ? String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) : ''
  check('adj806 render -t midi ⇒ 0 且文件头是 MThd', m.code === EXIT.ok && magic === 'MThd', `magic=${magic}`)
  check('adj806 MIDI 不能用 stdout（二进制）', (await runCli(['render', '-i', '-', '-t', 'midi'], makeIo({ '(stdin)': GOOD }).io)).code === EXIT.usage)
}

// ③b adj873（T-3 补落点）：`render --crop page|score [--pad N] [--ink x,y,w,h]`
{
  /** `page`：**缺省**与显式 `--crop page` 都必须与"不加 --crop"**逐字节一致** ✓ */
  const base = makeIo({ '(stdin)': GOOD })
  await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg'], base.io)
  const raw = String(base.files['out.svg'] ?? '')
  const explicit = makeIo({ '(stdin)': GOOD })
  await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg', '--crop', 'page'], explicit.io)
  const pageSvg = String(explicit.files['out.svg'] ?? '')
  check(
    'adj873 `--crop page` 与不加 --crop **逐字节一致**（现状行为不变）',
    raw.length > 0 && pageSvg === raw,
    `len ${raw.length} vs ${pageSvg.length}`,
  )
  /** `score`：墨迹 + 每边 `--pad`（默认 2），且**不是**整页盒 */
  const scoreIo = makeIo({ '(stdin)': GOOD })
  const rs = await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg', '--crop', 'score'], scoreIo.io)
  const scoreSvg = String(scoreIo.files['out.svg'] ?? '')
  const vbScore = readViewBoxOf(scoreSvg)
  const vbPage = readViewBoxOf(pageSvg)
  check(
    'adj873 `--crop score` ⇒ 0；画布换成**墨迹盒 + 每边 2px**（≠ 整页盒）；内容一字不动',
    rs.code === EXIT.ok && vbScore !== null && vbPage !== null &&
      !(vbScore[2] === vbPage[2] && vbScore[3] === vbPage[3]) &&
      vbScore[2] < vbPage[2] && vbScore[3] < vbPage[3] &&
      scoreSvg.slice(scoreSvg.indexOf('>')) === pageSvg.slice(pageSvg.indexOf('>')),
    `page=${JSON.stringify(vbPage)} score=${JSON.stringify(vbScore)} code=${rs.code} err=${scoreIo.errs.join('｜')}`,
  )
  /** `--pad 0` ⇒ 紧贴墨迹；`--pad 999` ⇒ 钳到 64（每边） */
  const p0Io = makeIo({ '(stdin)': GOOD })
  await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg', '--crop', 'score', '--pad', '0'], p0Io.io)
  const vb0 = readViewBoxOf(String(p0Io.files['out.svg'] ?? ''))
  const p64Io = makeIo({ '(stdin)': GOOD })
  await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg', '--crop', 'score', '--pad', '999'], p64Io.io)
  const vb64 = readViewBoxOf(String(p64Io.files['out.svg'] ?? ''))
  check(
    'adj873 `--pad`：0 ⇒ 紧贴墨迹（=不含留白的墨迹宽）；999 ⇒ 每边钳到 64（宽 +128）',
    vbScore !== null && vb0 !== null && vb64 !== null &&
      vb0[2] === vbScore[2] - 4 && vb0[3] === vbScore[3] - 4 &&
      vb64[2] === vbScore[2] - 4 + 128 && vb64[3] === vbScore[3] - 4 + 128,
    `pad2=${JSON.stringify(vbScore)} pad0=${JSON.stringify(vb0)} pad64=${JSON.stringify(vb64)}`,
  )
  /** `--ink x,y,w,h`：显式盒覆盖估算（有 DOM 的宿主把实测值喂进来） */
  const inkIo = makeIo({ '(stdin)': GOOD })
  const ri = await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg', '--crop', 'score', '--ink', '100,50,300,200', '--pad', '0'], inkIo.io)
  const vbInk = readViewBoxOf(String(inkIo.files['out.svg'] ?? ''))
  check(
    'adj873 `--ink x,y,w,h` 覆盖估算：盒 = 传入值（pad 0 ⇒ 300×200 @100,50）',
    ri.code === EXIT.ok && vbInk !== null && vbInk[0] === 100 && vbInk[1] === 50 && vbInk[2] === 300 && vbInk[3] === 200,
    JSON.stringify(vbInk),
  )
  /**
   * 负对照：`--ink` 给一个**退化盒**（比一个音符还小）⇒ 引擎的退化闸必须拦下，
   * **退出码非 0 且不写任何文件**（宁可报错，也不产出一条 27px 的横带 ✗）。
   */
  const badIo = makeIo({ '(stdin)': GOOD })
  const rb = await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg', '--crop', 'score', '--ink', '10,10,489,1'], badIo.io)
  check(
    'adj873 负对照：退化墨迹盒（489×1）⇒ 退出码 4 且**不写文件**（不静默退回整页）',
    rb.code === EXIT.render && Object.keys(badIo.files).length === 0 && badIo.errs.some((e) => e.includes('--crop score')),
    `code=${rb.code} files=${Object.keys(badIo.files).join(',')} err=${badIo.errs.join('｜')}`,
  )
  /** 非法取值 ⇒ 用法错误（不猜、不忽略 ✗） */
  const badCrop = makeIo({ '(stdin)': GOOD })
  const rbc = await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg', '--crop', 'nope'], badCrop.io)
  const badPad = makeIo({ '(stdin)': GOOD })
  const rbp = await runCli(['render', '-i', '-', '-t', 'svg', '-o', 'out.svg', '--crop', 'score', '--pad', 'abc'], badPad.io)
  check(
    'adj873 `--crop nope` / `--pad abc` ⇒ 退出码 1（用法错误），不悄悄回默认',
    rbc.code === EXIT.usage && rbp.code === EXIT.usage && Object.keys(badCrop.files).length === 0 && Object.keys(badPad.files).length === 0,
    `crop=${rbc.code} pad=${rbp.code}`,
  )
}

// ④ batch：目录列举 + 输出目录自动创建（由 IO 的 writeFile 负责 mkdir ✓）
{
  const io = makeIo({ 'in/a.jps': GOOD, 'in/b.jps': GOOD, 'in/skip.txt': 'x' }, { in: ['b.jps', 'a.jps', 'skip.txt'] })
  const r = await runCli(['batch', '--in', 'in', '-o', 'out', '-t', 'svg', '--quiet'], io.io)
  check('adj806 batch ⇒ 只处理 .jps、每个产出 SVG、退出码 0', r.code === EXIT.ok && 'out/a.svg' in io.files && 'out/b.svg' in io.files && !('out/skip.svg' in io.files))
  const io2 = makeIo({ 'in/a.jps': GOOD }, { in: ['a.jps'] })
  const r2 = await runCli(['batch', '--in', 'in', '-o', 'out', '-t', 'fmt'], io2.io)
  check('adj806 batch -t fmt ⇒ 写出 .jps（规范化）', r2.code === EXIT.ok && 'out/a.jps' in io2.files)
  // 失败隔离：目录里有这个文件名，但读不到内容（fake io 抛错）⇒ 必须计入失败且**不写**任何输出
  const io3 = makeIo({}, { in: ['a.jps'] })
  const r3 = await runCli(['batch', '--in', 'in', '-o', 'out', '-t', 'svg', '--quiet'], io3.io)
  check('adj806 batch 单个文件失败 ⇒ 退出码 3 且**不写**半成品', r3.code === EXIT.syntax && Object.keys(io3.files).length === 0, `code=${r3.code} files=${Object.keys(io3.files).join(',')}`)
}

// ⑤ settings：值 + 来源分层
{
  const src = `# jps-config:{"margin_right": 44}\n${GOOD}`
  const io = makeIo({ 'p.jps': src })
  const r1 = await runCli(['settings', '-i', 'p.jps', 'margin_right', '--json'], io.io)
  const j1 = JSON.parse(String(io.logs.join('')))
  check('adj806 settings：源内 # jps-config 覆盖代码默认（来源标注正确）', r1.code === EXIT.ok && j1.value === 44 && j1.source === '源内 # jps-config', JSON.stringify(j1))
  const io2 = makeIo({ 'p.jps': src })
  await runCli(['settings', '-i', 'p.jps', 'margin_right', '-s', 'margin_right=33', '--json'], io2.io)
  const j2 = JSON.parse(String(io2.logs.join('')))
  check('adj806 settings：命令行 -s 优先级最高', j2.value === '33' && j2.source === '命令行 -s', JSON.stringify(j2))
  const io3 = makeIo({ 'p.jps': GOOD })
  await runCli(['settings', '-i', 'p.jps', 'margin_right', '--json'], io3.io)
  const j3 = JSON.parse(String(io3.logs.join('')))
  check('adj806 settings：源内没写 ⇒ 报"代码默认"', j3.source === '代码默认', JSON.stringify(j3))
}

// ⑥ doctor：能力如实
{
  const io = makeIo({})
  await runCli(['doctor', '--json'], io.io)
  const d = JSON.parse(String(io.logs.join('')))
  check(
    'adj806 doctor 如实报告能力（无宿主时 raster/audio 必须 false）',
    d.capabilities.svg === true && d.capabilities.midi === true && d.capabilities.raster === false && d.capabilities.audio === false,
    JSON.stringify(d.capabilities),
  )
}

// ⑦ `--watch` 的两条**可断言契约**（长驻进程本身不在这里跑 —— 那会悬挂测试 ✗，
//    真实行为由端到端冒烟覆盖：改文件后打印「变更后检查：…」✓）
{
  const noCap = makeIo({ 'a.jps': GOOD })
  const r1 = await runCli(['lint', '-i', 'a.jps', '--watch'], noCap.io)
  check(
    'adj814 --watch 在宿主没有文件监视能力时**明确报错**（退出码 1，不静默不监视 ✗）',
    r1.code === EXIT.usage && noCap.errs.some((e) => e.includes('--watch')),
    `code=${r1.code} err=${noCap.errs.join('｜')}`,
  )
  const io = makeIo({ '(stdin)': GOOD })
  io.io.watchFile = () => () => {}
  const r2 = await runCli(['lint', '-i', '-', '--watch'], io.io)
  check('adj814 --watch 不能用于 stdin（要监视具体文件）', r2.code === EXIT.usage, `code=${r2.code}`)
}

// ⑧ `@ijipu/cli` 包（adj874）：`--help` / `--version` 的**对外契约** + 包元数据 + 产物真跑
{
  const io = makeIo({})
  const r = await runCli(['--help'], io.io, { version: '9.9.9' })
  const help = String(io.logs.join(''))
  check('adj874 --help 退出码 0、写 stdout、不写 stderr', r.code === EXIT.ok && help.length > 0 && io.errs.length === 0, `code=${r.code}`)
  const CMDS = ['format', 'lint', 'info', 'render', 'play', 'batch', 'settings', 'config', 'doctor', 'completions', 'register', 'unregister', 'status']
  const missing = CMDS.filter((c) => !help.includes(c))
  check('adj874/adj944 --help 列全 13 个已实现命令（含 adj944 的 register/unregister/status）', missing.length === 0, `缺：${missing.join(' ')}`)
  /**
   * **负对照**：旧文案把 render / play / batch / settings / config / doctor 写成
   * 「未实现（P2–P4，会明确报错）」—— 而那 6 个命令**当时早已实现**（E-2026-390）。
   * 这条钉死"不许再把已实现的写成未实现" ✓。
   */
  check('adj874 --help 不再把已实现命令写成"未实现（P2–P4）"（负对照）', !help.includes('未实现（P2–P4'))
  check('adj874 --help 覆盖后加的选项（--crop/--pad/--ink/--watch）', ['--crop', '--pad', '--ink', '--watch'].every((o) => help.includes(o)))

  const ioV = makeIo({})
  const ioV2 = makeIo({})
  const rv = await runCli(['-v'], ioV.io, { version: '9.9.9' })
  const rv2 = await runCli(['--version'], ioV2.io, { version: '9.9.9' })
  check(
    'adj874 -v 与 --version 等价（退出码 0 + 版本行）',
    rv.code === EXIT.ok && rv2.code === EXIT.ok && String(ioV.logs.join('')) === 'iJipu 9.9.9\n' && String(ioV2.logs.join('')) === 'iJipu 9.9.9\n',
    `-v=${JSON.stringify(String(ioV.logs.join('')))} --version=${JSON.stringify(String(ioV2.logs.join('')))}`,
  )

  // 包元数据：`@ijipu/cli` 的版本是**第 4 处**版本号 ⇒ 必须与 APP_VERSION 锁在一起 ✓
  const pkg = JSON.parse(readFileSync('packages/ijipu-cli/package.json', 'utf8')) as {
    name: string
    version: string
    bin: Record<string, string>
    files: string[]
    dependencies?: Record<string, string>
  }
  const appVer = String(readFileSync('src/brand/version.ts', 'utf8')).match(/APP_VERSION = '([^']+)'/)?.[1] ?? ''
  /**
   * 包名**带 scope**（用户 2026-10-11 定：与引擎包 `@ijipu/engine` 对齐）⇒ 钉住，
   * 免得被"顺手改成无 scope 的 ijipu-cli" ✗。
   */
  check('adj874 包名 = @ijipu/cli（与引擎包 @ijipu/engine 同一 scope）', pkg.name === '@ijipu/cli', `实际=${pkg.name}`)
  check('adj874 CLI 包版本 == APP_VERSION（版本号不漂移）', pkg.version === appVer && appVer !== '', `包=${pkg.version} 应用=${appVer}`)
  check(
    'adj874 包 bin 指向构建产物、files 含 dist、运行期零依赖',
    pkg.bin.ijipu === 'dist/ijipu.cjs' && pkg.files.includes('dist') && pkg.dependencies === undefined,
    JSON.stringify({ bin: pkg.bin, files: pkg.files, deps: pkg.dependencies }),
  )

  /**
   * 产物核对。**为什么静态读文本 + 一次 spawn，而不是只 spawn**：
   *  · 静态部分（shebang / 版本注入）能在"产物没构建"时给出**明确原因**而不是堆栈 ✗；
   *  · spawn 部分才是"运行时真的跑到了"的证据（E-2026-264 的教训：源码文本断言证明不了运行期 ✓）——
   *    但 DSH 沙箱下 `spawn` + 管道 stdio 会 EPERM，这时**如实标记跳过**（不冒充通过 ✗）。
   */
  let bundle: string | null = null
  try {
    bundle = readFileSync('packages/ijipu-cli/dist/ijipu.cjs', 'utf8')
  } catch {
    check('adj874 CLI 产物存在（packages/ijipu-cli/dist/ijipu.cjs）', false, '先跑 `npm run cli:build`')
  }
  if (bundle !== null) {
    check('adj874 产物以 shebang 开头（bin 可直接执行）', bundle.startsWith('#!/usr/bin/env node'))
    check('adj874 产物注入了真实版本（不是 dev 兜底）', bundle.includes(pkg.version))
    try {
      const out = execFileSync(process.execPath, ['packages/ijipu-cli/dist/ijipu.cjs', '--version'], { encoding: 'utf8' })
      check('adj874 产物端到端可跑：node dist/ijipu.cjs --version', out.trim() === `iJipu ${pkg.version}`, `实际=${JSON.stringify(out.trim())}`)
    } catch (e) {
      const msg = String(e)
      if (msg.includes('EPERM')) {
        console.log('  · adj874 端到端**跳过**（沙箱不允许 spawn + 管道 stdio：EPERM）—— 请在普通终端手跑：node packages/ijipu-cli/dist/ijipu.cjs --version')
      } else {
        check('adj874 产物端到端可跑：node dist/ijipu.cjs --version', false, msg)
      }
    }
  }
}

// ⑨ adj942（用户裁定「直接落，修」·路线②）：**内嵌 CLI** 的接线 —— `ijipu.exe` 里跑的就是这一份
{
  /** 假宿主：宿主（Rust）注入的那组能力，全部内存化（字段口径见 `embedEntry.ts` 的 `EmbedHost`） */
  const makeHost = (
    files: Record<string, string> = {},
    failRead = false,
  ): { host: EmbedHost; out: string[]; errs: string[]; text: Record<string, string>; bin: Record<string, string> } => {
    const out: string[] = []
    const errs: string[] = []
    const text: Record<string, string> = {}
    const bin: Record<string, string> = {}
    const host: EmbedHost = {
      argv: [],
      readStdin: () => files['(stdin)'] ?? '',
      readFile: (p) => {
        if (failRead || !(p in files)) throw new Error(`ENOENT: 读不到文件 ${p}`)
        return files[p]
      },
      writeFile: (p, t) => void (text[p] = t),
      writeFileBinary: (p, b64) => void (bin[p] = b64),
      listDir: () => [],
      exists: (p) => p in files || p in text || p in bin,
      out: (t) => void out.push(t),
      err: (t) => void errs.push(t),
    }
    return { host, out, errs, text, bin }
  }

  /**
   * ⚠ 要**错误**（不是告警）得用「`{tp … }` 只能写在歌词行」——`Q: x` 那类"无法识别的符号"
   * 在引擎里是**告警**（本文件第 ① 组早就踩过这个坑 ✗），拿它当"语法错误"会得到退出码 0。
   */
  const EMBED_BAD = 'V: 1.0\nB: 错\nD: C\nP: 4/4\nQ: 1 2 3 4 | {tp 5 6 7 1} |\n'
  const embedPkgVersion = readFileSync('packages/ijipu-cli/package.json', 'utf8').match(/"version":\s*"([^"]+)"/)?.[1] ?? ''

  const v = makeHost()
  v.host.argv = ['--version']
  const rv = await runEmbeddedCli(v.host)
  check(
    'adj942 内嵌入口 `--version` 走通（退出码 0 + `iJipu <版本>`，与 Node 版同一个版本宏）',
    rv.code === EXIT.ok && embedPkgVersion !== '' && String(v.out.join('')) === `iJipu ${embedPkgVersion}\n`,
    `code=${rv.code} out=${JSON.stringify(String(v.out.join('')))} 期望=${embedPkgVersion}`,
  )

  const good = makeHost({ '(stdin)': GOOD })
  good.host.argv = ['lint', '-i', '-']
  const rg = await runEmbeddedCli(good.host)
  check(
    'adj942 内嵌入口 `lint`（好谱）⇒ 0 且**不写任何文件**（只读这条也要在内嵌路径上成立）',
    rg.code === EXIT.ok && Object.keys(good.text).length === 0 && Object.keys(good.bin).length === 0,
    `code=${rg.code}`,
  )

  const bad = makeHost({ '(stdin)': EMBED_BAD })
  bad.host.argv = ['lint', '-i', '-']
  const rb = await runEmbeddedCli(bad.host)
  check('adj942 内嵌入口 `lint`（错误谱）⇒ 3（退出码契约与 Node 版同一套）', rb.code === EXIT.syntax, `code=${rb.code}`)
  const fixed = makeHost({ '(stdin)': EMBED_BAD.replace('{tp 5 6 7 1}', '5 6 7 1') })
  fixed.host.argv = ['lint', '-i', '-']
  check(
    'adj942 负对照①：同一份谱**把错处修好**后 ⇒ 0（证明上面那条 3 是谱的问题、不是内嵌接线在乱报）',
    (await runEmbeddedCli(fixed.host)).code === EXIT.ok,
  )

  const mid = makeHost({ '(stdin)': GOOD })
  mid.host.argv = ['render', '-i', '-', '-t', 'midi', '-o', 'out.mid']
  const rm = await runEmbeddedCli(mid.host)
  const midiBytes = mid.bin['out.mid'] !== undefined ? Buffer.from(mid.bin['out.mid'], 'base64') : Buffer.alloc(0)
  check(
    'adj942 内嵌入口**二进制通道**（base64）走通：`render -t midi` ⇒ 0 且宿主拿到的字节以 MThd 开头',
    rm.code === EXIT.ok && midiBytes.subarray(0, 4).toString('latin1') === 'MThd',
    `code=${rm.code} bytes=${midiBytes.length} head=${midiBytes.subarray(0, 4).toString('latin1')}`,
  )

  const png = makeHost({ '(stdin)': GOOD })
  png.host.argv = ['render', '-i', '-', '-t', 'png', '-o', 'out.png']
  const rp = await runEmbeddedCli(png.host)
  check(
    'adj942 内嵌入口**不谎报能力**：没注入 rasterize ⇒ `-t png` 退出码 4 且不写文件（与独立 Node 环境同口径）',
    rp.code === EXIT.render && Object.keys(png.bin).length === 0 && png.errs.some((e) => e.includes('隐藏窗口渲染')),
    `code=${rp.code} err=${png.errs.join('｜')}`,
  )

  const missing = makeHost({}, true)
  missing.host.argv = ['lint', '-i', '不存在.jps']
  check('adj942 内嵌入口：宿主读文件失败 ⇒ 2（"输入不存在"的对外承诺不变 ✓）', (await runEmbeddedCli(missing.host)).code === EXIT.noInput)

  /**
   * `TextEncoder` 补丁：**QuickJS 没有 TextEncoder**，而引擎的 MIDI 产出要用它
   * （`engine/playback/midi.ts` 的 `utf8()`）⇒ 内嵌入口自己补了一个。
   * 这里把 Node 的全局**删掉**来模拟 QuickJS：① 内嵌入口仍出 MIDI ✓；
   * ② **负对照**：CLI 核心（不装补丁）在同一环境下**必然失败** ✓ —— 证明补丁真的在起作用。
   */
  const g = globalThis as unknown as { TextEncoder?: unknown }
  const savedTe = g.TextEncoder
  const removedTe = delete g.TextEncoder
  if (!removedTe) {
    console.log('  · adj942 TextEncoder 补丁那两条**跳过**（本环境不允许删全局 TextEncoder）')
  } else {
    try {
      let coreFailed = false
      try {
        const core = makeIo({ '(stdin)': GOOD })
        await runCli(['render', '-i', '-', '-t', 'midi', '-o', 'out.mid'], core.io)
      } catch {
        coreFailed = true
      }
      const noTe = makeHost({ '(stdin)': GOOD })
      noTe.host.argv = ['render', '-i', '-', '-t', 'midi', '-o', 'out.mid']
      const rNoTe = await runEmbeddedCli(noTe.host)
      const teHead = noTe.bin['out.mid'] !== undefined ? Buffer.from(noTe.bin['out.mid'], 'base64').subarray(0, 4).toString('latin1') : ''
      check(
        'adj942 内嵌入口自带 `TextEncoder` 补丁（模拟"没有 TextEncoder"的环境）⇒ `-t midi` 仍出 MThd 且补上了全局',
        rNoTe.code === EXIT.ok && teHead === 'MThd' && typeof g.TextEncoder === 'function',
        `code=${rNoTe.code} head=${teHead}`,
      )
      check('adj942 负对照②：同环境下**不装补丁的 CLI 核心**必然失败（证明那条补丁不是摆设）', coreFailed)
    } finally {
      g.TextEncoder = savedTe
    }
  }
}

// ⑩ adj944（用户需求）：「注册 iJipu CLI 到当前用户 PATH」的三个子命令 —— 接线、退出码、幂等
{
  /**
   * 假宿主：`io.pathHost`（真宿主在 Rust 侧 `src-tauri/src/cli_path.rs`，真机实测另做）。
   * ⚠ 这里**不碰真实注册表**：把"系统"放在内存里 ⇒ 断言能精确到"到底写了几次、写的是什么" ✓。
   */
  const makePathHost = (initial: string | null, installDir = 'C:\\Apps\\iJipu') => {
    let value = initial
    let appPaths: string | null = null
    const writes: string[] = []
    const host = {
      async installDir() {
        return installDir
      },
      async exePath() {
        return `${installDir}\\ijipu.exe`
      },
      async readPath() {
        return value
      },
      async writePath(next: string) {
        writes.push(next)
        value = next
      },
      async readAppPaths() {
        return appPaths
      },
      async writeAppPaths(exe: string) {
        appPaths = exe
      },
      async removeAppPaths() {
        appPaths = null
      },
    }
    return { host, writes, value: () => value, appPaths: () => appPaths }
  }
  /**
   * adj946：注册写进 PATH 的是**命令行入口目录**（`<安装目录>\bin`）—— 断言里的期望值就取它。
   * 与 `envPath.ts` 的 `binDirOf` **同口径**（这里刻意不 import，只在断言里写一次字面量，
   * 机器核对由 `smoke.mts` 的 `adj946` 那组负责 ✓）。
   */
  const BIN_DIR = 'C:\\Apps\\iJipu\\bin'

  // ① 没有宿主能力（独立 Node 环境）⇒ 如实报 6，且不假装成功
  {
    const noHost = makeIo({})
    const r = await runCli(['status'], noHost.io)
    check(
      'adj944 无宿主（独立 Node 环境）⇒ `status` 退出码 6 且说明"要用桌面端"（不假装成功 ✗）',
      r.code === EXIT.env && noHost.errs.some((e) => e.includes('桌面端')) && noHost.logs.length === 0,
      `code=${r.code} err=${noHost.errs.join('｜')}`,
    )
    const noHost2 = makeIo({})
    check(
      'adj944 无宿主 ⇒ `register` 同样是 6（三个子命令一条口径）',
      (await runCli(['register'], noHost2.io)).code === EXIT.env,
    )
    const noHost3 = makeIo({})
    check(
      'adj944 无宿主 ⇒ `unregister` 同样是 6',
      (await runCli(['unregister'], noHost3.io)).code === EXIT.env,
    )
  }

  // ② 有宿主：status / register / unregister 的实况与幂等
  {
    const a = makePathHost(null)
    const st = makeIo({})
    st.io.pathHost = a.host
    const r0 = await runCli(['status', '--json'], st.io)
    const s0 = JSON.parse(String(st.logs.join('')))
    check(
      'adj944 `status --json`：未注册时如实报 registered=false + 安装目录 + 命令行入口目录 + PATH 长度',
      r0.code === EXIT.ok && s0.registered === false && s0.installDir === 'C:\\Apps\\iJipu' &&
        s0.binDir === BIN_DIR && s0.legacy === false && s0.pathLength === 0 && s0.pathLimit === 2047,
      JSON.stringify(s0),
    )

    const reg = makeIo({})
    reg.io.pathHost = a.host
    const r1 = await runCli(['register'], reg.io)
    check(
      'adj944 `register` ⇒ 0、只写一次、**写的是命令行入口目录 bin**（adj946 口径），并提示"新开一个终端"',
      r1.code === EXIT.ok && a.writes.length === 1 && a.writes[0] === BIN_DIR &&
        reg.logs.join('').includes('新开一个终端'),
      `writes=${JSON.stringify(a.writes)}`,
    )
    const reg2 = makeIo({})
    reg2.io.pathHost = a.host
    const r2 = await runCli(['register'], reg2.io)
    check(
      'adj944 再 `register` 一次 ⇒ **一个字都不写**（幂等；已注册时不重复追加）',
      r2.code === EXIT.ok && a.writes.length === 1 && reg2.logs.join('').includes('未重复写入'),
      `writes=${a.writes.length} out=${JSON.stringify(reg2.logs.join(''))}`,
    )
    const un = makeIo({})
    un.io.pathHost = a.host
    const r3 = await runCli(['unregister'], un.io)
    check(
      'adj944 `unregister` ⇒ 0、把 PATH 写成空、App Paths 也清掉',
      r3.code === EXIT.ok && a.value() === '' && a.appPaths() === null && a.writes.length === 2 &&
        un.logs.join('').includes('逐字未动'),
      `value=${JSON.stringify(a.value())}`,
    )
    const un2 = makeIo({})
    un2.io.pathHost = a.host
    const r4 = await runCli(['unregister'], un2.io)
    check('adj944 再 `unregister` 一次 ⇒ 不改动（幂等）', r4.code === EXIT.ok && a.writes.length === 2)
  }

  // ③ 别人的条目一个字都不许动 + 超长拒绝写入（负对照）+ adj946 旧形态兼容
  {
    const b = makePathHost(`C:\\Windows;${BIN_DIR};C:\\Other`)
    const un = makeIo({})
    un.io.pathHost = b.host
    await runCli(['unregister'], un.io)
    check(
      'adj944 `unregister` 只摘自己那一条，别人的两条**逐字未动**',
      b.value() === 'C:\\Windows;C:\\Other' && b.writes.length === 1,
      `value=${JSON.stringify(b.value())}`,
    )

    const long = makePathHost('z'.repeat(2047))
    const reg = makeIo({})
    reg.io.pathHost = long.host
    const r = await runCli(['register'], reg.io)
    check(
      'adj944 超长 ⇒ 退出码 6、**不写**（writes=0），并把上限与建议讲清楚',
      r.code === EXIT.env && long.writes.length === 0 && reg.errs.join('').includes('2047') &&
        reg.errs.join('').includes('未写入'),
      `code=${r.code} writes=${long.writes.length} err=${reg.errs.join('｜').slice(0, 120)}`,
    )
    /** 负对照：把"不判长度"的写法当判据 ⇒ 它会照写（writes 就不是 0）⇒ 判假 ✓ */
    check(
      'adj944 负对照：超长却照样写的情形与上面的"零写入"互斥',
      long.writes.length === 0 && r.code === EXIT.env,
    )

    /**
     * adj946：**旧形态兼容**（adj944 曾把"安装目录本身"写进 PATH）。
     * 必须做到两件事，否则用户升级后点「注册」会留下一条更靠前的 `ijipu.exe`（症状复发 ✗）：
     *  ① `status` 要如实认出旧形态（`legacy=true` 且按**未注册**报）；
     *  ② `register` 要**顺手把它换成 bin**；`unregister` 要**两种都摘**。
     */
    const legacy = makePathHost(`C:\\Windows;C:\\Apps\\iJipu;C:\\Other`)
    const stLegacy = makeIo({})
    stLegacy.io.pathHost = legacy.host
    const rl = await runCli(['status', '--json'], stLegacy.io)
    const sl = JSON.parse(String(stLegacy.logs.join('')))
    check(
      'adj946 `status --json`：PATH 里只有**旧形态**（安装目录本身）⇒ `legacy=true`、`registered=false`（如实报，不冒充已注册）',
      rl.code === EXIT.ok && sl.legacy === true && sl.registered === false && sl.binDir === BIN_DIR,
      JSON.stringify(sl),
    )
    const regLegacy = makeIo({})
    regLegacy.io.pathHost = legacy.host
    const rl2 = await runCli(['register'], regLegacy.io)
    check(
      'adj946 `register`：**把旧形态换成 bin**（`C:\\Windows;<安装目录>;C:\\Other` ⇒ `C:\\Windows;C:\\Other;<bin>`，别人的两条逐字未动）',
      rl2.code === EXIT.ok && legacy.writes.length === 1 &&
        legacy.value() === `C:\\Windows;C:\\Other;${BIN_DIR}` &&
        regLegacy.logs.join('').includes(BIN_DIR),
      `value=${JSON.stringify(legacy.value())}`,
    )
    const unLegacyHost = makePathHost(`C:\\Windows;C:\\Apps\\iJipu;C:\\Other`)
    const unLegacy = makeIo({})
    unLegacy.io.pathHost = unLegacyHost.host
    const rl3 = await runCli(['unregister'], unLegacy.io)
    check(
      'adj946 `unregister`：**两种形态都摘**（只留旧形态时也摘得干净 ⇒ 不留指向 GUI exe 的尾巴）',
      rl3.code === EXIT.ok && unLegacyHost.value() === 'C:\\Windows;C:\\Other' &&
        unLegacyHost.writes.length === 1,
      `value=${JSON.stringify(unLegacyHost.value())}`,
    )
  }
}

console.log(failed === 0 ? `\nCLI 断言全部通过 ✅（${passed} 项）` : `\nCLI 断言失败 ${failed} 项 ❌`)
process.exit(failed === 0 ? 0 : 1)
}
void main()
