/**
 * export/pdf.ts — 极简 PDF 生成（零第三方依赖，纯函数，可单测）· adj411
 *
 * 背景：此前「导出 PDF」是**开新窗口 + 写 A4 分页 HTML + `window.print()`**，
 * 靠浏览器打印对话框"另存为 PDF"。这在桌面浏览器上会被**弹窗拦截**（用户实测：
 * "浏览器拦截了新窗口，请允许弹窗后重试"），体验也差（多一个窗口 + 手动另存）。
 *
 * 现在改为**直接生成 .pdf 文件并下载**：把每一页 SVG 先栅格化为 JPEG
 * （复用 `export/export.ts` 的 `svgToCanvas`），再按 PDF 规范把 JPEG **原样内嵌**为
 * 图像 XObject（`/Filter /DCTDecode` —— JPEG 数据可直接作为 PDF 图像流，无需重新编码）。
 *
 * 代价（已知取舍，见回报说明）：PDF 里是**位图**而非矢量——文字不可选中、放大会有像素感；
 * 换来的是零依赖、任何浏览器/桌面端都能直接下载，且打印质量由栅格化倍率决定（默认 3×
 * ≈ A4 216 DPI，足够简谱打印）。若日后需要矢量 PDF，需引入 jspdf + svg2pdf 之类依赖（须先征得同意）。
 *
 * 本模块只做"字节拼装"，不碰 DOM/Canvas，因此可在 smoke 里断言结构合法性。
 */

/** 一页位图：JPEG 字节 + 像素尺寸（像素尺寸写进 PDF 的 /Width /Height） */
export interface PdfImagePage {
  jpeg: Uint8Array
  width: number
  height: number
}

/** A4 纵向（pt，1pt = 1/72in）：595.28 × 841.89 */
export const A4_W_PT = 595.28
export const A4_H_PT = 841.89

const enc = new TextEncoder()

/** 把若干字节块拼成一个 Uint8Array（避免字符串拼接破坏二进制 JPEG） */
function concat(chunks: Uint8Array[]): Uint8Array {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Uint8Array(len)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/**
 * 由若干 JPEG 页构建 PDF 字节流（每页整幅铺满一张 A4）。
 *
 * 对象编号：1 = Catalog、2 = Pages，之后每页 3 个对象（Page / Contents / Image）：
 *   第 i 页（0 基）→ page = 3+3i、contents = 4+3i、image = 5+3i。
 * JPEG 作为图像 XObject 内嵌（`/DCTDecode`），内容流用 `cm` 把图像缩放到整页。
 */
export function buildPdf(pages: PdfImagePage[], pageW = A4_W_PT, pageH = A4_H_PT): Uint8Array {
  const chunks: Uint8Array[] = []
  /** 每个对象起始字节偏移（xref 用；下标 = 对象号） */
  const offsets: number[] = []
  let cursor = 0

  const put = (s: string) => {
    const b = enc.encode(s)
    chunks.push(b)
    cursor += b.length
  }
  const putBytes = (b: Uint8Array) => {
    chunks.push(b)
    cursor += b.length
  }
  /** 记下对象起始偏移并写对象头（**非流**对象，正文后补一个换行） */
  const beginObj = (num: number, body: string) => {
    offsets[num] = cursor
    put(`${num} 0 obj\n${body}\n`)
  }
  /**
   * 记下对象起始偏移并写**流对象**头。
   * ⚠️ 结尾必须是 `stream\n` 且**其后紧接字节流**——不能再补换行，
   * 否则流数据会以多余字节开头，而 `/Length` 又按原字节数声明 → 流被整体错位 1 字节
   * （JPEG 会丢掉末尾 EOI，见 E-2026-145）。
   */
  const beginStreamObj = (num: number, dict: string) => {
    offsets[num] = cursor
    put(`${num} 0 obj\n${dict}\nstream\n`)
  }
  const endStreamObj = () => put('\nendstream\n')

  put('%PDF-1.4\n')
  // 二进制注释行：声明本文件含二进制数据（阅读器据此按二进制处理）
  putBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  const n = pages.length
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')

  beginObj(1, `<< /Type /Catalog /Pages 2 0 R >>`)
  beginObj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`)

  const fmt = (v: number) => (Math.round(v * 100) / 100).toString()
  for (let i = 0; i < n; i++) {
    const p = pages[i]
    const pageNum = 3 + i * 3
    const contentNum = pageNum + 1
    const imageNum = pageNum + 2
    // 内容流：把图像缩放到整页（cm 的 a/d = 目标宽高，图像自身 1×1 单位 → 铺满 MediaBox）
    const content = `q ${fmt(pageW)} 0 0 ${fmt(pageH)} 0 0 cm /Im0 Do Q\n`
    const contentBytes = enc.encode(content)

    beginObj(pageNum, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageW)} ${fmt(pageH)}] /Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>`)
    // 内容流：声明 /Length = 实际字节数，数据紧随 `stream\n`（不含多余换行）
    beginStreamObj(contentNum, `<< /Length ${contentBytes.length} >>`)
    putBytes(contentBytes)
    endStreamObj()
    // 图像 XObject：JPEG 以 /DCTDecode 原样内嵌（不重新编码）
    beginStreamObj(imageNum, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`)
    putBytes(p.jpeg)
    endStreamObj()
  }

  // xref：对象 0 是固定表头项；其余按记录的偏移写入（每条**恰好 20 字节**）
  const xrefAt = cursor
  const total = 3 + n * 3
  put(`xref\n0 ${total}\n`)
  put('0000000000 65535 f \n')
  for (let num = 1; num < total; num++) put(`${String(offsets[num] ?? 0).padStart(10, '0')} 00000 n \n`)
  put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)

  return concat(chunks)
}
