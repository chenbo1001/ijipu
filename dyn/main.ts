/**
 * dyn/main.ts — 动态谱**调试页**（临时）
 *
 * 目的：在接进应用之前，先在浏览器里把"滚动 + 高亮 + 反复展开"看一遍。
 * 用的就是已提交的三个引擎函数（`buildRectTrack` → `buildFlowView` → `frameAt`），
 * 所以这里看到的效果 = 将来视频里的效果（差异只在配色与转场）。
 *
 * ⚠ **不进构建产物**：`vite.config.ts` 的 `rollupOptions.input` 里没有它，
 *   只在 `npm run dev` 时由 Vite 直接按路径提供。接进应用后本目录整份删除。
 *
 * 打开：`npm run dev` 后访问 <http://localhost:5173/dyn/>
 */
import {
  parseJps,
  layoutScore,
  renderScoreToSvg,
  buildPlaySequence,
  buildRectTrack,
  buildFlowView,
  frameAt,
  dynamicPageConfig,
  type DynamicPresetId,
  type FlowView,
  type RectTrack,
} from '@ijipu/engine'

/** 素材：带一次反复、够长到**超过一屏**（这样才能看到真正的逐行滚动，而不是整页不动） */
const DEMO = [
  'V: 1.0',
  'B: 小星星',
  'D: C',
  'P: 4/4',
  'Q: |: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |:|',
  'Q: 5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |',
  'Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |',
  'Q: 5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |',
  'Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |',
  'Q: 5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |',
  'Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |',
  'Q: 5 5 4 4 | 3 3 2 - | 4 4 3 3 | 2 2 1 - |',
  'Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |',
  'Q: 5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |',
  'Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |',
  'Q: 5 5 4 4 | 3 3 2 - | 4 4 3 3 | 2 2 1 - |',
  '',
].join('\n')

const BPM = 100

const canvas = document.getElementById('view') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const playBtn = document.getElementById('play') as HTMLButtonElement
const seek = document.getElementById('seek') as HTMLInputElement
const meta = document.getElementById('meta') as HTMLElement
const presetSel = document.getElementById('preset') as HTMLSelectElement
const hint = document.getElementById('hint') as HTMLElement

let view: FlowView | null = null
let track: RectTrack | null = null
let pageCanvases: HTMLCanvasElement[] = []
let totalMs = 0
let cursor = 0
let playing = false
let lastTick = 0

/** SVG 字符串 → 已解码的位图 */
function svgToImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  const img = new Image()
  img.src = url
  return img
    .decode()
    .then(() => {
      URL.revokeObjectURL(url)
      return img
    })
    .catch((e) => {
      URL.revokeObjectURL(url)
      throw e
    })
}

/** 每一页光栅化成一张画布（与出片管线一致：按页光栅，不拼大图） */
async function rasterizePages(svgs: string[], w: number, h: number): Promise<HTMLCanvasElement[]> {
  const out: HTMLCanvasElement[] = []
  for (const svg of svgs) {
    const img = await svgToImage(svg)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const cx = c.getContext('2d')!
    cx.fillStyle = '#ffffff'
    cx.fillRect(0, 0, w, h)
    cx.drawImage(img, 0, 0, w, h)
    out.push(c)
  }
  return out
}

async function rebuild(presetId: DynamicPresetId): Promise<void> {
  const cfg = dynamicPageConfig(presetId)
  const parsed = parseJps(DEMO)
  const layout = layoutScore(parsed, cfg)
  const seq = buildPlaySequence(parsed, layout, BPM)
  track = buildRectTrack(seq, { noteSize: cfg.note_size })
  view = buildFlowView(layout, track, cfg)
  totalMs = track.endMs

  await document.fonts.ready
  const svgs = renderScoreToSvg(layout)
  pageCanvases = await rasterizePages(svgs, view.viewW, view.viewH)

  canvas.width = view.viewW
  canvas.height = view.viewH
  seek.max = String(Math.round(totalMs))
  // 便于截图/定位：`/dyn/?t=8.5` = 打开即停在 8.5 秒
  const tParam = Number(new URLSearchParams(location.search).get('t'))
  cursor = Number.isFinite(tParam) && tParam > 0 ? Math.min(totalMs, tParam * 1000) : 0
  hint.textContent = `页 ${layout.pages.length} · 条带行 ${view.rows.length} · 条带高 ${Math.round(view.stripHeight)}px`
  draw()
}

function draw(): void {
  if (!view || !track) return
  const { viewW: W, viewH: H } = view
  const f = frameAt(view, track, cursor)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // 可见的高亮块 → 反推需要哪些行（顺带把"行"画出来）
  for (const row of view.rows) {
    const h = row.srcBottom - row.srcTop
    const y = row.stripY - f.scrollY
    if (y + h < 0 || y > H) continue
    ctx.drawImage(pageCanvases[row.pageIndex], 0, row.srcTop, W, h, 0, y, W, h)
  }

  // 高亮：半透明色块 + 描边（正式视频里颜色按声部/音色走，这里先用品牌青红配色占位）
  for (const r of f.rects) {
    const y = r.y - f.scrollY
    ctx.beginPath()
    ctx.roundRect(r.x - 4, y - 3, r.w + 8, r.h + 6, 8)
    ctx.fillStyle = 'rgba(255, 93, 108, 0.20)'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255, 93, 108, 0.85)'
    ctx.stroke()
  }

  meta.textContent = `${(cursor / 1000).toFixed(1)}s / ${(totalMs / 1000).toFixed(1)}s · 行 ${f.row + 1}/${view.rows.length}`
  seek.value = String(Math.round(cursor))
}

function tick(now: number): void {
  if (!playing) return
  const dt = lastTick > 0 ? now - lastTick : 0
  lastTick = now
  cursor = Math.min(totalMs, cursor + dt)
  if (cursor >= totalMs) {
    playing = false
    playBtn.textContent = '播放'
  }
  draw()
  if (playing) requestAnimationFrame(tick)
}

playBtn.addEventListener('click', () => {
  if (playing) {
    playing = false
    playBtn.textContent = '播放'
    return
  }
  if (cursor >= totalMs) cursor = 0
  playing = true
  lastTick = 0
  playBtn.textContent = '暂停'
  requestAnimationFrame(tick)
})

seek.addEventListener('input', () => {
  cursor = Number(seek.value)
  draw()
})

presetSel.addEventListener('change', () => {
  playing = false
  playBtn.textContent = '播放'
  void rebuild(presetSel.value as DynamicPresetId)
})

void rebuild(presetSel.value as DynamicPresetId).catch((e) => {
  hint.textContent = `出错了：${String(e)}`
  console.error(e)
})
