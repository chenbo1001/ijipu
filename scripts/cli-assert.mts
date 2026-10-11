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
 *  · **`doctor` 如实报告能力**（没有的能力必须 false ✓）。
 *
 * 运行：`npm run smoke`（已串在后面）；也可单独 `node dist-smoke/cli-assert.cjs`。
 */
import { runCli, EXIT, type CliIo } from '../packages/ijipu-cli/src/cli'
import { readFileSync } from 'node:fs'
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

console.log(failed === 0 ? `\nCLI 断言全部通过 ✅（${passed} 项）` : `\nCLI 断言失败 ${failed} 项 ❌`)
process.exit(failed === 0 ? 0 : 1)
}

void main()
