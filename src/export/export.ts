/**
 * export/export.ts — 导出模块（纯前端，零第三方依赖）
 *
 *  - SVG：多页分别下载
 *  - PNG / JPG：SVG → canvas（白底、可选分辨率）→ 下载
 *  - PDF：浏览器打印（A4 页面化新窗口，打印对话框另存为 PDF）
 */

/** 触发浏览器下载 */
function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  a.click()
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

/** SVG → canvas（白底，scale 倍分辨率，默认 2x） */
export function svgToCanvas(svg: string, scale = 2): Promise<HTMLCanvasElement> {
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
        ctx.fillStyle = '#ffffff' // JPG 无透明，必须白底
        ctx.fillRect(0, 0, canvas.width, canvas.height)
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

/** 导出 PNG（逐页下载，文件名带页码） */
export async function exportPng(pages: string[], baseName: string, scale = 2): Promise<void> {
  for (let i = 0; i < pages.length; i++) {
    const canvas = await svgToCanvas(pages[i], scale)
    const suffix = pages.length > 1 ? `-${i + 1}` : ''
    downloadDataUrl(canvas.toDataURL('image/png'), `${baseName}${suffix}.png`)
  }
}

/** 导出 JPG（逐页下载，文件名带页码） */
export async function exportJpg(pages: string[], baseName: string, scale = 2): Promise<void> {
  for (let i = 0; i < pages.length; i++) {
    const canvas = await svgToCanvas(pages[i], scale)
    const suffix = pages.length > 1 ? `-${i + 1}` : ''
    downloadDataUrl(canvas.toDataURL('image/jpeg', 0.92), `${baseName}${suffix}.jpg`)
  }
}

/**
 * 导出 PDF：在新窗口按 A4 排版全部页面并触发浏览器打印（可另存为 PDF）。
 * 依赖浏览器打印能力，零第三方库。
 */
export function exportPdf(pages: string[], title: string) {
  const w = window.open('', '_blank')
  if (!w) {
    throw new Error('浏览器拦截了新窗口，请允许弹窗后重试')
  }
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  .page {
    width: 210mm; height: 297mm;
    display: flex; align-items: center; justify-content: center;
    page-break-after: always;
  }
  .page:last-child { page-break-after: auto; }
  .page svg { width: 100%; height: 100%; }
</style>
</head>
<body>
${pages.map((s) => `<div class="page">${s}</div>`).join('\n')}
<script>window.onload = function () { setTimeout(function () { window.print(); }, 400); };</script>
</body>
</html>`
  w.document.open()
  w.document.write(html)
  w.document.close()
}
