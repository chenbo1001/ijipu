/**
 * preview/fontMeta.ts — 宿主字体实测（adj199 / adj629v / adj638 / adj647）
 *
 * 引擎零 DOM、拿不到字形度量，凡是"按字体实际宽度摆放/占宽"的量都得由宿主用 canvas 实测后传进去：
 *  · **渲染侧**（`RenderFontMeta`）：`1 = ` 宽、♯ 占宽与墨迹右缘、`1 ` 与 `♩` 宽
 *    —— 描述头角标间距（adj638）与 D 行/J 行 `=` 对齐（adj629v）；
 *  · **布局侧**（`LayoutFontMeta`）：变音角标 `#`/`b`/`♮` 的**墨迹宽与左偏**（adj647）
 *    —— 布局要用它算角标占宽，所以**必须在 `layoutScore` 之前**测好。
 *
 * 为什么集中在这里：此前只有预览页传实测值，**导出/打印走估算** ⇒ 同一份谱在预览里与导出的
 * PDF/SVG 里版面不一致（例如描述头 `D: C#` 的角标间距差 2px）。现在预览 / 导出 / 打印
 * 全部调 `measureFontMeta()` 拿同一份实测值。
 *
 * Node（无 `document`，如冒烟脚本）下全部返回 `undefined`，引擎各自回退到内置估算/常量表。
 */
import { noteFontFamily } from '@ijipu/engine/index.ts'
import type { AccidentalGlyphInk, LayoutFontMeta, PageConfig, RenderFontMeta } from '@ijipu/engine/index.ts'

/** 建一个 2D 上下文（失败/无 DOM 返回 null） */
function ctx2d(): CanvasRenderingContext2D | null {
  try {
    if (typeof document === 'undefined') return null
    return document.createElement('canvas').getContext('2d')
  } catch {
    return null
  }
}

/** 实测指定字体/字号下文本的**占宽**（advance） */
export function measureFont(text: string, fontSize: number, fontFamily: string): number | undefined {
  if (!fontFamily || !(fontSize > 0)) return undefined
  const ctx = ctx2d()
  if (!ctx) return undefined
  try {
    ctx.font = `${fontSize}px ${fontFamily}`
    const w = ctx.measureText(text).width
    return Number.isFinite(w) ? w : undefined
  } catch {
    return undefined
  }
}

/**
 * adj638：实测**墨迹右缘**（相对笔位）。
 *
 * ♯/♭ 在简谱字体栈里常是**全角字形**——占宽 1em 里只有 0.62em 有墨、**右侧留白**会把视觉间距撑开；
 * 内联排版时把这段留白实测出来交给引擎**补偿掉** ⇒ 墨迹净距严格 = 0.2px（见 `drawKeyName`）。
 */
export function measureInkRight(text: string, fontSize: number, fontFamily: string): number | undefined {
  if (!fontFamily || !(fontSize > 0)) return undefined
  const ctx = ctx2d()
  if (!ctx) return undefined
  try {
    ctx.font = `${fontSize}px ${fontFamily}`
    const right = ctx.measureText(text).actualBoundingBoxRight
    return Number.isFinite(right) ? right : undefined
  } catch {
    return undefined
  }
}

/**
 * adj647：实测单个字形的**墨迹宽与左偏**，返回**相对字号的比值**（与字号解耦，引擎再乘角标字号）。
 *
 * canvas 约定：`actualBoundingBoxLeft` 是"对齐点到墨迹左缘的距离、向左为正" ⇒
 * `lsb = −left`、`inkW = right + left`。
 *
 * ⚠ **必须用大基准字号量**：角标实际只有 8.67px（13px 音符字号 × 12/18），在这个尺寸上浏览器会把
 * 墨迹包围盒**量化到整像素**（实测 `#` 的 inkW 比值 0.605 → **0.808**、lsb 0.015 → **−0.115**，
 * 偏大 ~33%）⇒ 占宽会跟着涨，反而不如常量表。所以统一在 `ACC_INK_REF_SIZE`（100px）上量、只取比值。
 */
const ACC_INK_REF_SIZE = 100

export function measureGlyphInk(text: string, fontFamily: string): AccidentalGlyphInk | undefined {
  if (!fontFamily) return undefined
  const ctx = ctx2d()
  if (!ctx) return undefined
  try {
    ctx.font = `${ACC_INK_REF_SIZE}px ${fontFamily}`
    const m = ctx.measureText(text)
    const left = m.actualBoundingBoxLeft
    const right = m.actualBoundingBoxRight
    if (!Number.isFinite(left) || !Number.isFinite(right)) return undefined
    const inkW = (right + left) / ACC_INK_REF_SIZE
    const lsb = -left / ACC_INK_REF_SIZE
    return Number.isFinite(inkW) && Number.isFinite(lsb) ? { inkW, lsb } : undefined
  } catch {
    return undefined
  }
}

/**
 * 一次量出**布局侧 + 渲染侧**要用的全部实测值（同一份 ⇒ 预览/导出/打印版面一致）。
 *
 * 量不到的部分为 `undefined`，引擎按各自的内置估算/常量表回退（不会因为量不到而报错）。
 */
export function measureFontMeta(cfg: PageConfig): { layout: LayoutFontMeta; render: RenderFontMeta } {
  const mSize = cfg.miaoshu_size
  const mFont = cfg.miaoshu_font
  const symSize = mSize * (3 / 4) // 调号角标字号 = 字母 3/4
  const nFont = noteFontFamily(cfg.shuzi_font) // 与渲染用同一串 font-family（角标字号由引擎按比值换算）
  return {
    layout: {
      accidentalInk: {
        '#': measureGlyphInk('#', nFont),
        b: measureGlyphInk('b', nFont),
        '♮': measureGlyphInk('♮', nFont),
      },
    },
    render: {
      w1eq: measureFont('1 = ', mSize, mFont),
      wAcc: measureFont('♯', symSize, mFont),
      accInkRight: measureInkRight('♯', symSize, mFont),
      w1sp: measureFont('1 ', mSize, mFont),
      wTempo: measureFont('♩', mSize, mFont),
    },
  }
}
