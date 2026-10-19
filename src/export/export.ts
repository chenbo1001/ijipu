/**
 * export/export.ts — 导出模块（纯前端，零第三方依赖）
 *
 *  - SVG：多页分别下载
 *  - PNG / JPG：SVG → canvas（白底、可选分辨率）→ 下载
 *  - PDF：SVG → canvas（JPEG）→ 自建 PDF 字节流 → 直接下载（adj411，零依赖，见 export/pdf.ts）
 */
import { buildPdf, type PdfImagePage } from './pdf'

/** 触发浏览器下载 */
function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  a.click()
}

/** 触发浏览器下载（Blob 版） */
function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** 下载 SVG 文本 */
export function exportSvg(svg: string, fileName: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * SVG → canvas（scale 倍分辨率，默认 2x）。
 *
 * adj1002（用户 2026-10-19）：`bg` 为 `null` 时**不填底色** ⇒ 画布保持透明（PNG 用）；
 * 传颜色字符串则先铺满该色（JPG / PDF 必须，因为它们没有透明通道）。
 */
export function svgToCanvas(svg: string, scale = 2, bg: string | null = '#ffffff'): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('canvas 2d 上下文不可用')
        if (bg !== null) {
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        resolve(canvas)
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG 图片加载失败'))
    }
    img.src = url
  })
}

/**
 * 导出 PNG（逐页下载，文件名带页码）。
 *
 * adj1002：**默认透明底**（`bg = null`，用户 2026-10-19 指定）——贴进文档不留白边；
 * 需要白底/纸色时由调用方传色值。
 */
export async function exportPng(pages: string[], baseName: string, scale = 2, bg: string | null = null): Promise<void> {
  for (let i = 0; i < pages.length; i++) {
    const canvas = await svgToCanvas(pages[i], scale, bg)
    const suffix = pages.length > 1 ? `-${i + 1}` : ''
    downloadDataUrl(canvas.toDataURL('image/png'), `${baseName}${suffix}.png`)
  }
}

/** 导出 JPG（逐页下载，文件名带页码；**JPG 无透明通道 ⇒ 底色默认白**，adj1002） */
export async function exportJpg(
  pages: string[],
  baseName: string,
  scale = 2,
  bg: string | null = '#ffffff',
): Promise<void> {
  for (let i = 0; i < pages.length; i++) {
    const canvas = await svgToCanvas(pages[i], scale, bg ?? '#ffffff')
    const suffix = pages.length > 1 ? `-${i + 1}` : ''
    downloadDataUrl(canvas.toDataURL('image/jpeg', 0.92), `${baseName}${suffix}.jpg`)
  }
}

/**
 * 导出 PDF：**直接生成 .pdf 并下载**（adj411）。
 *
 * 做法：每页 SVG → canvas（`pdfScale` 倍分辨率）→ JPEG 字节 → 自建 PDF 字节流
 * （`export/pdf.ts`，JPEG 以 `/DCTDecode` 原样内嵌）→ Blob 下载。
 * **不再开新窗口**，因此不存在"浏览器拦截了新窗口"的弹窗拦截问题。
 *
 * 清晰度（adj412）：由调用方（导出对话框的「图片清晰度」）传入，与 PNG/JPG 同档位——
 *  2x ≈ 144 DPI、4x ≈ 288 DPI、6x ≈ 432 DPI（A4）。默认 2 与对话框默认档一致。
 * 取舍：PDF 内是**位图**（文字不可选中）；矢量方案需引入 jspdf + svg2pdf 并另解中文字体嵌入，见回报说明。
 */
export async function exportPdf(
  pages: string[],
  title: string,
  pdfScale = 2,
  bg: string | null = '#ffffff',
): Promise<void> {
  if (pages.length === 0) throw new Error('没有可导出的页面')
  const imgs: PdfImagePage[] = []
  for (const svg of pages) {
    // adj1002：PDF 内是 JPEG 位图，没有透明通道 ⇒ 底色为空时落白
    const canvas = await svgToCanvas(svg, pdfScale, bg ?? '#ffffff')
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) throw new Error('页面栅格化失败（canvas 无法编码 JPEG）')
    imgs.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height })
  }
  const bytes = buildPdf(imgs)
  // 用 Uint8Array 直接建 Blob（不经过 base64，避免大文件多一次膨胀拷贝）
  downloadBlob(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), `${title}.pdf`)
}
