/**
 * scripts/gen-modifier-glyphs.mjs — 生成引擎侧的**矢量修饰符常量**（adj458）
 *
 * 用法：`node scripts/gen-modifier-glyphs.mjs`
 *      （需要本机有 Chrome——用来量每个图形的**紧包围盒** `getBBox()`；可用 `CHROME_PATH` 指定）
 *
 * 产出 `packages/ijipu-engine/src/engine/render/modifierGlyphs.ts`：
 * 6 枚波音/滑音 SVG（`public/icons/*.svg`）的**路径标记 + 紧包围盒**。
 *
 * ## 为什么是"内联矢量"而不是位图 / 资源文件
 *  · engine 是**纯 TS 零依赖**模块（`src/AGENTS.md`），不做资源加载；被 obsidian-ijipu **逐字节 vendor**
 *    成 `vendor/engine/`，若改成 `import x from './x.svg'` 就要两个宿主各自配资源插件、vendor 还得多带文件；
 *  · 把路径标记内联成常量后 `renderScoreToSvg` 产出的 SVG **自包含**，预览 / SVG·PNG·JPG·PDF 导出 /
 *    Obsidian 内嵌三条路径都不需要额外资源解析；
 *  · 相比位图（PNG 内嵌）：导出 SVG 仍是**无损矢量**，放大印刷不糊。
 *
 * ## 为什么要量包围盒
 * 源图是 iconfont 导出的 `viewBox="0 0 1024 1024"`，**画面在 viewBox 里有大量留白且各不相同**
 * （如「上波音」墨迹只占 `x 36..988`、`y 327..677`）。只有按**紧包围盒**换算，图形才会精确落在
 * 目标位置、且 6 个符号大小口径一致（否则各自留白不同 → 有的偏大有的偏小、还有偏移）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const ICON_DIR = path.join(repo, 'public', 'icons')
const TMP_DIR = path.join(repo, 'dist-smoke')
const OUT = path.join(repo, 'packages', 'ijipu-engine', 'src', 'engine', 'render', 'modifierGlyphs.ts')

/** 符号编码 → 图标文件名（与 `docs/SYNTAX.md` 的权威定义一致） */
const GLYPHS = [
  { key: 'sby', name: '上波音', desc: '上波音（2.5 齿）' },
  { key: 'xby', name: '下波音', desc: '下波音（2.5 齿，中带竖线）' },
  { key: 'sby+', name: '复上波音', desc: '复上波音（3.5 齿）' },
  { key: 'xby+', name: '复下波音', desc: '复下波音（3.5 齿，中带竖线）' },
  { key: 'shy', name: '上滑音', desc: '上滑音（弧线 + 箭头）' },
  { key: 'xhy', name: '下滑音', desc: '下滑音（弧线 + 箭头）' },
  { key: 'yc', name: '延长记号', desc: '延长记号（点 + 半圆弧）' },
]

/** 找 Chrome（量 getBBox 用）；CHROME_PATH 优先 */
function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)
  for (const c of cands) if (existsSync(c)) return c
  throw new Error('找不到 Chrome/Edge——量 SVG 紧包围盒需要它。可用环境变量 CHROME_PATH 指定可执行文件路径。')
}

/** 读一个 SVG：取出 viewBox 与内部标记（去掉 XML 声明 / DOCTYPE / 外层 <svg> / iconfont 元数据 / 写死颜色） */
function readSvg(name) {
  const src = readFileSync(path.join(ICON_DIR, `${name}.svg`), 'utf8')
  const viewBox = /viewBox="([^"]+)"/.exec(src)?.[1]
  if (!viewBox) throw new Error(`${name}.svg 缺少 viewBox`)
  const inner = src
    .replace(/^[\s\S]*?<svg[^>]*>/, '') // 去掉声明/DOCTYPE/外层 svg 开始标签
    .replace(/<\/svg>[\s\S]*$/, '') // 去掉外层 svg 结束标签及其后内容
    .replace(/\s+p-id="[^"]*"/g, '') // iconfont 的 p-id 纯元数据，去掉
    .replace(/\s+t="[^"]*"/g, '')
    .replace(/\s+class="[^"]*"/g, '')
    // 写死的填充色一律去掉，颜色交渲染时的外层 <g fill>（否则「延长记号」自带的灰色 #686868
    // 会盖住统一墨色、深色模式反相后也跟别处不一致）。`fill="none"` 是描边图形的语义，必须保留。
    .replace(/\s+fill="(?!none")[^"]*"/g, '')
    .trim()
  return { viewBox, inner }
}

/** 用无头 Chrome 量每个图形的紧包围盒（viewBox 单位）——一次性量完，返回 { 名字: {x,y,w,h} } */
function measureBBoxes(list) {
  mkdirSync(TMP_DIR, { recursive: true })
  const blocks = list
    .map((g) => {
      const { viewBox, inner } = readSvg(g.name)
      return `<div><svg id="g${g.key}" viewBox="${viewBox}" width="200" height="200" xmlns="http://www.w3.org/2000/svg">${inner}</svg></div>`
    })
    .join('\n')
  const keys = JSON.stringify(list.map((g) => [g.key, g.name]))
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>${blocks}
<pre id="out">pending</pre>
<script>
const keys = ${keys};
const res = {};
for (const [key, name] of keys) {
  const b = document.getElementById('g' + key).getBBox();
  res[name] = { x: b.x, y: b.y, w: b.width, h: b.height };
}
document.getElementById('out').textContent = 'RESULT:' + JSON.stringify(res);
</script></body></html>`
  const page = path.join(TMP_DIR, '_measure-modifiers.html')
  writeFileSync(page, html, 'utf8')
  const dom = execFileSync(
    findChrome(),
    ['--headless=new', '--disable-gpu', '--virtual-time-budget=5000', '--dump-dom', `file:///${page.replace(/\\/g, '/')}`],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const json = /RESULT:(\{.*?\})<\/pre>/s.exec(dom)?.[1]
  if (!json) throw new Error('量包围盒失败：Chrome 未返回结果')
  return JSON.parse(json)
}

const bboxes = measureBBoxes(GLYPHS)
const r2 = (v) => Math.round(v * 100) / 100
const entries = GLYPHS.map((g) => {
  const { viewBox, inner } = readSvg(g.name)
  const b = bboxes[g.name]
  if (!b || !(b.w > 0) || !(b.h > 0)) throw new Error(`${g.name} 的包围盒无效：${JSON.stringify(b)}`)
  return { ...g, viewBox, inner, bbox: b }
})

const body = entries
  .map(
    (e) =>
      `  // ${e.desc}　紧包围盒 ${r2(e.bbox.w)}×${r2(e.bbox.h)}（宽高比 ${r2(e.bbox.w / e.bbox.h)}，源 viewBox ${e.viewBox}）\n` +
      `  '${e.key}': {\n` +
      `    name: '${e.name}',\n` +
      `    box: { x: ${r2(e.bbox.x)}, y: ${r2(e.bbox.y)}, w: ${r2(e.bbox.w)}, h: ${r2(e.bbox.h)} },\n` +
      `    path: ${JSON.stringify(e.inner)},\n` +
      `  },`,
  )
  .join('\n')

const out = `/**
 * render/modifierGlyphs.ts — 波音 / 滑音的**矢量修饰符**（adj458）
 *
 * ⚠ **本文件由 \`scripts/gen-modifier-glyphs.mjs\` 自动生成，请勿手改。**
 *    换图后重跑：\`node scripts/gen-modifier-glyphs.mjs\`（需要本机有 Chrome，用来量紧包围盒）
 *
 * ## 为什么把路径内联成常量
 * 用户提供了一整套简谱修饰符图（\`ijipu/public/icons/*.svg\`，iconfont 导出的填充路径），
 * 要求谱面里的波音/滑音直接用这套图，取代引擎此前手绘的矢量近似。
 * engine 是**纯 TS 零依赖**模块、且被 obsidian-ijipu **逐字节 vendor**，所以不能走
 * "资源文件 + 打包器插件"那条路（两个宿主都得配、vendor 还得多带文件）。
 * 内联成常量后 \`renderScoreToSvg\` 产出的 SVG **自包含**——预览、SVG/PNG/JPG/PDF 导出、
 * Obsidian 内嵌三条路径都不需要额外资源解析，而且导出仍是**无损矢量**（放大印刷不糊）。
 *
 * ## \`box\` 为什么必要
 * 源图是 iconfont 的 \`viewBox="0 0 1024 1024"\`，**画面在 viewBox 里留白很大且各不相同**
 * （如「上波音」墨迹只占 \`x 36..988 / y 327..677\`）。只有按**紧包围盒**换算，图形才会精确落在
 * 目标位置、且 6 个符号大小口径一致；否则各自留白不同 → 有的偏大有的偏小、还有偏移。
 *
 * ## 上色
 * 渲染时把 \`fill\` 统一设成谱面墨色（源路径本身不带 \`fill\`，故会被继承），
 * 与其它矢量元素同色，深色模式的整页反相（adj425）也一视同仁。
 */

/** 位图修饰符的符号编码（与 \`docs/SYNTAX.md\` 一致：sby 上波音 / xby 下波音 / shy 上滑音 / xhy 下滑音 / yc 延长记号） */
export type ModifierGlyphKey = 'sby' | 'xby' | 'sby+' | 'xby+' | 'shy' | 'xhy' | 'yc'

export type ModifierGlyph = {
  /** 源文件名：\`public/icons/<name>.svg\` 的 \`<name>\` */
  name: string
  /** 图形在**源 viewBox 坐标**里的紧包围盒（由 Chrome \`getBBox()\` 量得） */
  box: { x: number; y: number; w: number; h: number }
  /** 源 SVG 的内部标记（\`<path .../>\`，原样保留，不带 \`fill\`，颜色由外层 \`<g>\` 决定） */
  path: string
}

/** 目标矩形（SVG 用户单位）：**墨迹**要落进的框 */
export type GlyphBox = { x: number; y: number; w: number; h: number }

export const MODIFIER_GLYPHS: Record<ModifierGlyphKey, ModifierGlyph> = {
${body}
}

/** 该符号墨迹的宽高比 */
export function glyphInkAspect(g: ModifierGlyph): number {
  return g.box.w / g.box.h
}

/**
 * 生成把该修饰符贴到目标位置的 \`<g>\` 标记（**等比**缩放，绝不拉伸）。
 *
 * @param g   矢量修饰符
 * @param box 目标矩形。各模式用到的字段：
 *            · \`'width'\`：用 \`x/w\` 定横向、\`y\` 当**垂直中心**（\`h\` 可传 0）
 *            · \`'height'\`：用 \`y/h\` 定纵向、\`x\` 当**左缘**（\`w\` 可传 0）——右侧依附的符号贴在音符右边
 *            · \`'contain'\`：\`x/y/w/h\` 全用，等比缩到框内并居中
 * @param fit \`'width'\`  = 按宽度贴合、高度随图比例（**波音**用它：横向占位是逐轮调好的）
 *            \`'height'\` = 按高度贴合、宽度随图比例（**滑音**用它：图形近似正方，按"扁框"内缩会明显偏小）
 *            \`'contain'\`= 等比缩到框内
 * @param ink  谱面墨色（源路径不带 fill，故由此处统一上色）
 */
export function glyphMarkup(g: ModifierGlyph, box: GlyphBox, fit: 'width' | 'height' | 'contain', ink: string): string {
  const aspect = glyphInkAspect(g)
  let w = box.w
  let h = box.w / aspect
  if (fit === 'contain' && box.w / box.h > aspect) {
    h = box.h
    w = box.h * aspect
  } else if (fit === 'height') {
    h = box.h
    w = box.h * aspect
  }
  const s = w / g.box.w // 等比缩放（w、h 由同一 aspect 导出，故同一个 s 同时满足两者）
  const x = fit === 'height' ? box.x : box.x + (box.w - w) / 2
  const y = box.y + (box.h - h) / 2
  // 把源 viewBox 坐标平移到目标位置：先按紧包围盒左上角对齐，再整体平移
  const tx = x - g.box.x * s
  const ty = y - g.box.y * s
  const n2 = (v: number) => Math.round(v * 100) / 100
  const n6 = (v: number) => Math.round(v * 1e6) / 1e6
  return \`<g transform="translate(\${n2(tx)} \${n2(ty)}) scale(\${n6(s)})" fill="\${ink}">\${g.path}</g>\`
}
`

writeFileSync(OUT, out, 'utf8')
console.log(`[gen-modifier-glyphs] ${entries.length} 枚矢量修饰符 → ${path.relative(repo, OUT)}`)
for (const e of entries) {
  const b = e.bbox
  console.log(`  ${e.key.padEnd(5)} ${e.name.padEnd(5)} 包围盒 ${r2(b.w)}×${r2(b.h)} 宽高比 ${r2(b.w / b.h)}  路径 ${e.inner.length} 字节`)
}
