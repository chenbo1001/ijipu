/**
 * export/video/renderer.ts — 把「相机 + 页面」画成画面（宿主层）
 *
 * 分工：**引擎**算"这一刻相机在哪、多大"（`cameraAt`，纯函数）；
 * **这里**把页面图画出来（SVG → 位图 → 按相机取景）。
 *
 * ## 为什么按"页面"光栅，而不是拼一条大图
 *
 * 3 分钟的谱有 30+ 页；拼整条带会得到几万像素高的画布，WebView 里分配失败。
 * 这里每页一张位图（按 `RASTER_SCALE` 放大，保证推近不糊），逐帧只画当前页的一块。
 *
 * ## 为什么用用户自己的页面配置
 *
 * 相机方案的全部意义就在这：**不重排**。用户看到什么样的 A4 版面，视频里就是什么样，
 * 只是镜头推近/平移。所以这里吃 `pageConfig`（来自文档），不吃"视频预设"——
 * 预设只决定**输出画布多大**。
 */
import {
  parseJps,
  layoutScore,
  renderScoreToSvg,
  buildPlaySequence,
  inferBpm,
  buildRectTrack,
  buildFlowView,
  rectsActiveAt,
  buildCameraTrack,
  cameraAt,
  resolvePracticeRange,
  slicePlaySequenceByRange,
  ballAt,
  beatPhaseOf,
  keySignatureOf,
  BALL_LANDING_TIMING,
  BALL_SQUASH_X,
  BALL_SQUASH_Y,
  DYNAMIC_PRESETS,
  type DynamicPresetId,
  type PageConfig,
  type CameraFrame,
  type CameraTrack,
  type PlayEvent,
} from '@ijipu/engine'
import { svgToCanvas } from '../export'
import { brand, palette } from '../../brand/tokens'

/**
 * 页面位图的放大倍数：4 倍跟拍时，取景框宽 = 1080/4 = 270 页面单位，
 * 而位图按 3 倍存（595×3 = 1786px 宽）⇒ 取 270 宽那段约 810px，再放大到 1080，
 * 略软但可接受；再高会吃内存（每页 ≈ 18MB）。
 */
export const RASTER_SCALE = 3

/** 高亮块配色（占位：正式版按声部/音色走 `playback/playhead.ts` 的调色板） */
export const HIGHLIGHT_FILL = 'rgba(255, 93, 108, 0.20)'
export const HIGHLIGHT_STROKE = 'rgba(255, 93, 108, 0.85)'
/** 跳跳球颜色（同一套强调色，落地那一刻最显眼） */
export const BALL_FILL = 'rgba(255, 93, 108, 0.95)'

/** 2D 上下文（离屏画布与页面画布都行；编码时用 OffscreenCanvas 不占可见画布） */
export type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface DynamicSession {
  camera: CameraTrack
  /** 每页一张已光栅化的画布 */
  pages: HTMLCanvasElement[]
  totalMs: number
  /** 音乐结束（最后一拍结束） */
  musicEndMs: number
  /** 片尾卡开始：预览播到这里就淡出（导出继续到 totalMs，含完整片尾） */
  cardStartMs: number
  width: number
  height: number
  /** 播放事件（给音轨离线渲染用，与画面同一份序列） */
  events: PlayEvent[]
  /** 拍速（音轨渲染要用同一个值，否则音画对不上） */
  bpm: number
  /** 画一帧，返回相机位置与"是否在跟拍"（供界面显示） */
  draw: (ctx: DrawCtx, tMs: number) => { frame: CameraFrame; following: boolean }
}

/**
 * 建一次放映会话。
 *
 * @param code       `.jps` 源码
 * @param presetId   输出画布（只决定宽高与比例）
 * @param pageConfig **用户自己的**页面配置（决定版面，绝不能被预设覆盖）
 * @param bpm        覆盖拍速（缺省按谱面推断）
 */
export async function createDynamicSession(
  code: string,
  presetId: DynamicPresetId,
  pageConfig: PageConfig,
  bpm?: number,
  opts?: {
    followZoom?: number
    /** 只导某个标记段（起止音符 id）；缺省 = 整曲 */
    range?: { startId: string; endId: string } | null
    /** 片头时长（ms，默认 2000；0 = 不要片头）。片头是**前置静音**，音画一起后移 */
    leadInMs?: number
    /** 片尾时长（ms，默认 2500；0 = 不要片尾）。片尾是品牌落版，给个入口要人 */
    endCardMs?: number
    /**
     * **整片时长上限**（ms，含片头/片尾；adj1064）。超出时先把音乐裁短，
     * 保证片头、片尾卡都在上限之内——不能像以前那样在 `encodeMp4` 末尾硬截，
     * 那会把片尾卡截掉（用户实报：「不管 3 分钟、标记段还是整首，都要有片头片尾」）。
     */
    maxMs?: number
    /** 跳跳球（节拍指示，默认开） */
    ball?: boolean
  },
): Promise<DynamicSession> {
  const preset = DYNAMIC_PRESETS[presetId]
  const parsed = parseJps(code)
  const layout = layoutScore(parsed, pageConfig)
  const beat = bpm !== undefined && bpm > 0 ? bpm : inferBpm(parsed)
  let seq = buildPlaySequence(parsed, layout, beat)

  // 标记段：用与试听**完全相同**的口径切出这一段（时间归零），并跳过满宽片头
  let skipIntro = false
  if (opts?.range) {
    const res = resolvePracticeRange(seq, opts.range.startId, opts.range.endId)
    if (res.missing) throw new Error('标记段已失效（起止音符找不到），请重新标记')
    const cand = res.candidates[res.pick] ?? res.candidates[0]
    const sliced = cand ? slicePlaySequenceByRange(seq, cand.i0, cand.i1) : null
    if (!sliced) throw new Error('标记段无效，请重新标记')
    seq = sliced
    skipIntro = true
  }

  // 片头：整条时间轴后移 + 前置静音（音轨用同一份事件，所以天然同步）
  const leadInMs = Math.max(0, opts?.leadInMs ?? 2000)
  if (leadInMs > 0) {
    seq = {
      ...seq,
      events: seq.events.map((e) => ({ ...e, atMs: e.atMs + leadInMs })),
      totalMs: seq.totalMs + leadInMs,
    }
  }

  /**
   * adj1064：整片上限（3 分钟）**先裁音乐、不裁片尾**。
   *
   * 以前 `maxMs` 只在 `encodeMp4` 末尾截帧：整首超过 180s 时，片尾卡在 180s 之后，
   * 直接被切掉。这里按「上限 − 片尾 − 自由落体」反推音乐能用到哪，并优先切在
   * **最后一个完整小节的起点**（避免切进小节中间）；剩余时间给片头/片尾。
   * 音轨用同一份（已裁）事件序列，所以声音也在切点结束，不会在片尾卡里继续唱。
   */
  const endCardMs = Math.max(0, opts?.endCardMs ?? 2500)
  const fallMs = 600
  if (opts?.maxMs && opts.maxMs > 0) {
    const contentCap = opts.maxMs - endCardMs - fallMs
    if (seq.totalMs > contentCap) {
      let cut = Math.max(0, contentCap)
      for (const b of seq.barStartsMs ?? []) {
        const abs = b + leadInMs
        if (abs <= contentCap && abs > 0) cut = abs
      }
      const events = seq.events
        .filter((e) => e.atMs < cut)
        .map((e) => ({
          ...e,
          durationMs: Math.max(1, Math.min(e.durationMs, cut - e.atMs)),
        }))
      seq = {
        ...seq,
        events,
        totalMs: cut,
        // `barStartsMs` 是相对时间（出片时统一 +leadInMs），这里也按相对值过滤
        barStartsMs: (seq.barStartsMs ?? []).filter((b) => b + leadInMs <= cut),
      }
    }
  }

  const track = buildRectTrack(seq, { noteSize: pageConfig.note_size })
  const view = buildFlowView(layout, track, pageConfig)
  if (view.rows.length === 0) throw new Error('这份谱没有可播放的音符')

  const camera = buildCameraTrack(view, track, pageConfig, {
    viewW: preset.width,
    viewH: preset.height,
    // 片头对准描述头（页顶 → margin_top + descAreaH 的中点）
    headerCy: pageConfig.margin_top + pageConfig.descAreaH / 2,
    ...(opts?.followZoom !== undefined ? { followZoom: opts.followZoom } : {}),
    ...(skipIntro ? { skipIntro: true } : {}),
  })
  const ball = opts?.ball !== false
  const musicEndMs = track.endMs
  const cardStartMs = musicEndMs + fallMs
  /**
   * 跳跳球的落点表：只取主声部（多声部各飞一颗会打架）。
   * 球是**抛体**：每拍落下一次，落点 = 那一拍开始时色块上沿的中心。
   */
  const ballAnchors = track.rects
    .filter((r) => r.playVoice === undefined || r.playVoice === 'main')
    .map((r) => ({ t0: r.t0, t1: r.t1, cx: r.x + r.w / 2, top: r.y, x: r.x, w: r.w }))
  const beatMs = 60000 / beat
  /**
   * 小节起点（按小节重置拍网格；片头后移所以要加 `leadIn`）。
   *
   * adj1061（用户 2026-10-22 实报「反复后球落点漂移」）：`seq.barStartsMs` 现在是
   * **展开后逐遍**的小节起点（练习段切片已重基），末尾那条「曲末」不是小节开头，
   * `ballAt` 只把它当"球自由落体"的时刻。
   */
  const ballBars = (seq.barStartsMs ?? []).map((s) => s + leadInMs)
  /** 拍网格相位：只作"没有小节起点"时的兜底（有 `ballBars` 时 `ballAt` 不看它） */
  const beatPhase = ballBars.length > 0 ? 0 : beatPhaseOf(ballAnchors, beatMs)
  /**
   * adj1067（用户 2026-10-22）：片头改成**自制标题卡**，信息直接取第 1 页描述头。
   *
   * 为什么不继续用页面描述头的截图：16:9 取景框比页高矮，页面居中的标题卡会把页顶裁掉；
   * 9:16/1:1/16:9 三种比例看到的“描述头”范围也不一样。自制卡按 `min(W,H)` 排版、
   * 按宽度自动缩字，三种尺寸同一套版式；3 秒卡 + 0.7 秒淡入/推近到第一拍。
   */
  const introMeta = layout.pages[0]?.meta
  const INTRO_PAN_MS = 700

  // 字体没就绪就光栅化 ⇒ 字形回退，第一帧和后面不一样
  await document.fonts.ready
  const svgs = renderScoreToSvg(layout)
  const pages: HTMLCanvasElement[] = []
  for (const svg of svgs) pages.push(await svgToCanvas(svg, RASTER_SCALE, '#ffffff'))

  const draw = (ctx: DrawCtx, tMs: number) => {
    const frame = cameraAt(camera, tMs)
    const W = camera.viewW
    const H = camera.viewH
    const noteSize = pageConfig.note_size
    // 每帧先清空：片头卡与首帧的交叉淡入必须叠在同一张透明画布上，不能叠到上一帧
    ctx.clearRect(0, 0, W, H)

    /** 按给定相机画一帧（alpha<1 用于片头交叉淡入） */
    const paintCamera = (c: CameraFrame, alpha: number, t: number) => {
      const z = c.zoom
      const left = c.cx - W / z / 2
      const top = c.cy - H / z / 2
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)

      const page = pages[c.pageIndex]
      if (page) {
        // 只画"取景框 ∩ 页面"这一块：满宽片头时取景框比页面高，两侧/上下会露白，属正常
        const ix = Math.max(0, left)
        const iy = Math.max(0, top)
        const iw = Math.min(camera.pageW, left + W / z) - ix
        const ih = Math.min(camera.pageH, top + H / z) - iy
        if (iw > 0 && ih > 0) {
          ctx.drawImage(
            page,
            ix * RASTER_SCALE,
            iy * RASTER_SCALE,
            iw * RASTER_SCALE,
            ih * RASTER_SCALE,
            (ix - left) * z,
            (iy - top) * z,
            iw * z,
            ih * z,
          )
        }
      }

      // 高亮：只画当前页上的（跨页时不会把上一页的块贴过来）
      const active = rectsActiveAt(track, t).filter((r) => r.pageIndex === c.pageIndex)
      for (const r of active) {
        const x = (r.x - left) * z
        const y = (r.y - top) * z
        const w = r.w * z
        const h = r.h * z
        ctx.beginPath()
        ctx.roundRect(x - 4, y - 3, w + 8, h + 6, Math.max(4, 8 * (z / 4)))
        ctx.fillStyle = HIGHLIGHT_FILL
        ctx.fill()
        ctx.lineWidth = Math.max(2, 3 * (z / 4))
        ctx.strokeStyle = HIGHLIGHT_STROKE
        ctx.stroke()
      }

      /**
       * 跳跳球：每拍弹一次，落地 = 拍点前的 `lead`，随后压扁保持 `dwell`（adj1062）。
       * 高度用抛物线 `4u(1-u)`；落地后按 `squash` 压成椭圆（球底仍贴色块上沿）。
       */
      if (ball) {
        const bp = ballAt(ballAnchors, t, beatMs, beatPhase, noteSize * 3.2, ballBars, BALL_LANDING_TIMING)
        if (bp && bp.x >= 0 && bp.x <= camera.pageW) {
          const rad = Math.max(4, noteSize * z * 0.28)
          const s = bp.squash ?? 0
          const rx = rad * (1 + BALL_SQUASH_X * s)
          const ry = rad * (1 - BALL_SQUASH_Y * s)
          const bx = (bp.x - left) * z
          // 压扁以**球底**为不动点：中心 = 落点 − 当前纵向半径
          const by = (bp.y - top) * z - ry
          ctx.beginPath()
          ctx.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2)
          ctx.fillStyle = BALL_FILL
          ctx.fill()
          // 白圈：压在浅色谱面上也能看清边界
          ctx.lineWidth = Math.max(1.5, rad * 0.18)
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    /**
     * 自制片头卡（adj1067）：深空蓝底 + 霓虹青强调线 + 描述头信息。
     * 版式只依赖 `min(W,H)`，因此 9:16 / 1:1 / 16:9 看到的是同一张卡，不会出现裁切差异。
     */
    const paintIntroCard = (alpha: number) => {
      const unit = Math.min(W, H)
      const font = '"Microsoft YaHei", "PingFang SC", sans-serif'
      const meta = introMeta
      const title = (meta?.titles[0] ?? '').trim() || '未命名'
      const subtitle = (meta?.titles.slice(1).join(' ') ?? '').trim()
      const authors = (meta?.authors.join(' / ') ?? '').trim()
      const tempo = meta?.tempoNum
        ? `♩=${meta.tempoNum}${meta.tempoText ? ` ${meta.tempoText}` : ''}`
        : (meta?.tempo ?? '')
      const key = keySignatureOf(meta?.key ?? '')
      const rest = [meta?.meter ?? '', tempo].filter((p) => p.length > 0)
      const maxW = W * 0.84
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, palette.deepSpaceBlueDark)
      g.addColorStop(1, palette.deepSpaceBlue)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)

      /** 先按宽度缩字号；`fillText` 再带 maxWidth 兜底，极长标题也不会溢出卡片 */
      const fit = (text: string, base: number, bold = false): number => {
        let size = Math.round(base)
        const min = Math.max(10, Math.round(base * 0.5))
        while (size > min) {
          ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}`
          if (ctx.measureText(text).width <= maxW) break
          size -= 2
        }
        return size
      }

      ctx.textAlign = 'center'
      ctx.fillStyle = palette.neonCyan
      ctx.fillRect(W * 0.41, H * 0.3, W * 0.18, Math.max(2, unit * 0.004))

      const titleSize = fit(title, Math.round(unit * 0.1), true)
      const titleY = H * 0.4
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${titleSize}px ${font}`
      ctx.fillText(title, W / 2, titleY, maxW)

      let y = titleY + titleSize * 0.85
      if (subtitle) {
        const size = fit(subtitle, Math.round(unit * 0.045))
        y += size * 1.2
        ctx.fillStyle = palette.neonCyan
        ctx.font = `${size}px ${font}`
        ctx.fillText(subtitle, W / 2, y, maxW)
      }
      if (authors) {
        const size = fit(authors, Math.round(unit * 0.034))
        y += size * 1.7
        ctx.fillStyle = 'rgba(255,255,255,0.82)'
        ctx.font = `${size}px ${font}`
        ctx.fillText(authors, W / 2, y, maxW)
      }
      if (key.letter || rest.length > 0) {
        const base = Math.round(unit * 0.027)
        /** 量整行宽（调号前缀 + 小角标 + 字母 + 拍号 + 速度），用于居中与缩放 */
        const measureLine = (size: number): number => {
          ctx.font = `${size}px ${font}`
          let w = 0
          if (key.letter) {
            w += ctx.measureText(key.prefix).width
            if (key.accidental) {
              ctx.font = `${Math.round(size * 0.75)}px ${font}`
              w += ctx.measureText(key.accidental).width
              ctx.font = `${size}px ${font}`
            }
            w += ctx.measureText(key.letter).width
          }
          for (const part of rest) {
            if (w > 0) w += ctx.measureText('   ').width
            w += ctx.measureText(part).width
          }
          return w
        }
        let size = base
        const min = Math.max(10, Math.round(base * 0.6))
        while (size > min && measureLine(size) > maxW) size -= 1
        const total = measureLine(size)
        y += size * 1.9
        let x = W / 2 - total / 2
        ctx.textAlign = 'left'
        if (key.letter) {
          ctx.font = `${size}px ${font}`
          const prefixW = ctx.measureText(key.prefix).width
          ctx.fillStyle = 'rgba(255,255,255,0.88)'
          ctx.fillText(key.prefix, x, y)
          x += prefixW
          if (key.accidental) {
            const symSize = Math.round(size * 0.75)
            ctx.font = `${symSize}px ${font}`
            ctx.fillStyle = palette.neonCyan
            ctx.fillText(key.accidental, x, y - size * 0.35)
            x += ctx.measureText(key.accidental).width
            ctx.font = `${size}px ${font}`
          }
          ctx.fillStyle = 'rgba(255,255,255,0.88)'
          ctx.fillText(key.letter, x, y)
          x += ctx.measureText(key.letter).width
        }
        ctx.fillStyle = 'rgba(255,255,255,0.62)'
        const separator = '   '
        let first = !key.letter
        for (const part of rest) {
          if (!first) {
            ctx.fillText(separator, x, y)
            x += ctx.measureText(separator).width
          }
          ctx.fillText(part, x, y)
          x += ctx.measureText(part).width
          first = false
        }
        ctx.textAlign = 'center'
      }
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = `${Math.round(unit * 0.022)}px ${font}`
      ctx.fillText(`${brand.nameZh} ${brand.name}`, W / 2, H * 0.9, maxW)
      ctx.restore()
    }

    /**
     * adj1067：片头卡 3 秒，最后 0.7 秒把画面淡入/推近到第一拍。
     * 不再区分整首/标记段——两者都用同一张自制卡，标记段也不会因为跨页而丢掉片头。
     */
    if (tMs < camera.firstT) {
      const introEnd = Math.max(0, camera.firstT - INTRO_PAN_MS)
      const raw =
        introEnd <= 0 ? 1 : Math.max(0, Math.min(1, (tMs - introEnd) / INTRO_PAN_MS))
      const k = raw * raw * (3 - 2 * raw)
      if (k < 1) paintIntroCard(1 - k)
      if (k > 0) {
        const target = cameraAt(camera, camera.firstT)
        // 0.94→1 的轻微推近，观感是"卡缩进谱面"，不是硬切
        paintCamera({ ...target, zoom: target.zoom * (0.94 + 0.06 * k) }, k, camera.firstT)
      }
      return { frame, following: false }
    }

    /**
     * 片尾：音乐结束后定格最后一帧，淡入品牌落版（推本应用）。
     * 音频不额外补声——视频比音轨长，播放器就是自然静音。
     */
    if (endCardMs > 0 && tMs >= cardStartMs) {
      const lastT = Math.max(0, musicEndMs - 1)
      paintCamera(cameraAt(camera, lastT), 1, lastT)
      const k = Math.min(1, (tMs - cardStartMs) / 300)
      paintEndCard(ctx, k)
      return { frame, following: false }
    }

    paintCamera(frame, 1, tMs)
    return { frame, following: tMs >= camera.firstT }
  }

  /** 品牌落版：深空蓝渐变 + 中英文名 + slogan + 网址 */
  const paintEndCard = (ctx: DrawCtx, alpha: number) => {
    const W = camera.viewW
    const H = camera.viewH
    const font = '"Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, palette.deepSpaceBlueDark)
    g.addColorStop(1, palette.deepSpaceBlue)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    ctx.textAlign = 'center'
    /**
     * adj1066（用户 2026-10-22 实报「16:9 片尾内容重叠」）：
     * 旧写法字号按**宽 W**、纵向位置按**高 H**：16:9 时 W=1920 ⇒ 标题 157px，
     * 而标题到标语只隔 0.07H=76px ⇒ 两行字直接叠在一起。
     * 现在字号按 `min(W,H)` 定（16:9 时 108px），行距按**字号**留足，纵向整体居中。
     */
    const unit = Math.min(W, H)
    const titleSize = Math.round(unit * 0.1)
    const sloganSize = Math.round(unit * 0.045)
    const urlSize = Math.round(unit * 0.032)
    const titleY = H * 0.44
    const sloganY = titleY + Math.round(titleSize * 0.95)
    const urlY = H * 0.78
    const accentY = titleY - titleSize * 1.05

    ctx.fillStyle = palette.neonCyan
    ctx.fillRect(W * 0.42, accentY, W * 0.16, Math.max(2, unit * 0.004))

    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${titleSize}px ${font}`
    ctx.fillText(`${brand.nameZh} ${brand.name}`, W / 2, titleY)

    ctx.fillStyle = palette.neonCyan
    ctx.font = `${sloganSize}px ${font}`
    ctx.fillText(brand.taglineMain, W / 2, sloganY)

    ctx.fillStyle = 'rgba(255,255,255,0.72)'
    ctx.font = `${urlSize}px ${font}`
    ctx.fillText(brand.siteUrl.replace(/^https?:\/\//, ''), W / 2, urlY)
    ctx.restore()
  }

  return {
    camera,
    pages,
    totalMs: cardStartMs + endCardMs,
    musicEndMs,
    cardStartMs,
    width: camera.viewW,
    height: camera.viewH,
    events: seq.events,
    bpm: beat,
    draw,
  }
}
