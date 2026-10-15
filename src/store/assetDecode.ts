/**
 * store/assetDecode.ts — 浏览器侧的图片解码器（adj965，方案 `docs/OVERLAY-PLAN.md`「OVL」优化 1）
 *
 * 输入字节（或本来就是 `data:` 的字符串）⇒ 输出**引擎要的画法**：`{ href: data URI, w, h }`。
 *
 * ## 为什么必须在这里降采样 + 重编码（方案优化 1，用户已采纳）
 *
 * 每页 SVG 都会**各自内嵌一份**图片的 base64（多页是多个独立 SVG 字符串），PDF 又是把每页栅格化后
 * 以内嵌 JPEG 存（`src/export/pdf.ts`）。一张手机照片（3MB 原图 ≈ 4MB base64）在 10 页谱里
 * 就是 **40MB 字符串** —— 内存、导出、打印都会炸。所以：
 *
 *  · 长边超过 `MAX_EDGE` 就按比例缩到 `MAX_EDGE`（A4 在 150dpi 下约 1754px ⇒ 2000px 足够清晰）；
 *  · 缩小过、或原图本身就大（> `RE_ENCODE_BYTES`）时，**统一重编码成 WebP q=0.85**
 *    （WebP 支持透明通道，比 JPEG 更适合"带透明的 logo/水印"；`toDataURL` 在引擎不支持时会自动退回 PNG）；
 *  · 小图（图标类）**原样直通**，不做无意义的重编码（免得把清晰的矢量感符号弄糊）。
 *
 * ## 边界
 *
 *  · 本文件是**唯一**碰 `Image` / `canvas` / `Blob` 的地方（`assetSource.ts` 保持零 DOM，便于冒烟在 Node 断言）；
 *  · 用 `URL.createObjectURL` + `img.decode()`（比 `onload` 稳，失败会 reject 成可捕获的错误）；
 *  · 无论成功失败都 `revokeObjectURL`（不然每换一次图就漏一个 blob）。
 */

/** 长边上限（px）——超过就按比例缩 */
export const MAX_EDGE = 2000
/** 超过这个字节数就重编码（小图标不值得重编码，免得弄糊） */
export const RE_ENCODE_BYTES = 256 * 1024
/** 重编码质量（WebP） */
export const RE_ENCODE_QUALITY = 0.85

/** 把 `Blob`/data URI 读成可画的图（失败时抛错，由 `assetSource` 转成给用户看的中文提示） */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.decoding = 'sync'
  img.src = src
  // `decode()` 在图片坏掉/不是图片时 reject（比 onload/onerror 双保险更好写）
  await img.decode()
  return img
}

/**
 * 解码（并视情况降采样/重编码）。
 *
 * @param input `{ bytes, mime }` = 平台通道读到的字节；`{ dataUri }` = 配置里本来就是内嵌的
 */
export async function decodeAsset(
  input: { bytes: Uint8Array; mime: string } | { dataUri: string },
): Promise<{ href: string; w: number; h: number }> {
  const isData = 'dataUri' in input
  const blobUrl = isData ? null : URL.createObjectURL(new Blob([input.bytes as unknown as BlobPart], { type: input.mime }))
  const src = isData ? input.dataUri : (blobUrl as string)
  try {
    const img = await loadImage(src)
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    if (!(nw > 0 && nh > 0)) throw new Error('量不到图片尺寸')
    const long = Math.max(nw, nh)
    const scale = long > MAX_EDGE ? MAX_EDGE / long : 1
    const needResize = scale < 1
    const bytes = isData ? input.dataUri.length : input.bytes.byteLength
    // 小图且不需要缩 ⇒ 原样直通（`data:` 输入直接回它自己，字节输入才需要转 data URI）
    if (!needResize && bytes <= RE_ENCODE_BYTES) {
      return { href: isData ? src : await blobToDataUri(input.bytes, input.mime), w: nw, h: nh }
    }
    const w = Math.max(1, Math.round(nw * scale))
    const h = Math.max(1, Math.round(nh * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('拿不到 2D 画布上下文')
    ctx.drawImage(img, 0, 0, w, h)
    // WebP 支持透明；引擎/浏览器不支持该类型时 `toDataURL` 会按规范退回 PNG ✓
    const href = canvas.toDataURL('image/webp', RE_ENCODE_QUALITY)
    if (!href.startsWith('data:image/')) throw new Error('重编码失败')
    return { href, w, h }
  } finally {
    if (blobUrl !== null) URL.revokeObjectURL(blobUrl)
  }
}

/** 字节 → data URI（小图直通用；`FileReader` 只在浏览器里有） */
function blobToDataUri(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(new Error('读取图片数据失败'))
    fr.onload = () => resolve(String(fr.result ?? ''))
    fr.readAsDataURL(new Blob([bytes as unknown as BlobPart], { type: mime }))
  })
}
