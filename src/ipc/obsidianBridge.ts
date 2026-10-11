/**
 * obsidianBridge.ts — **嵌入版（应用）侧的入站 RPC**（方案 B / B3）
 *
 * 与插件仓库 `obsidian-ijipu/src/embed/rpc.ts` 的 `createAppRequester()` **成对**：
 *  · 方向：**插件 → 应用**（要用 canvas/音色库这类"应用才有的能力" ✓）；
 *  · 信封：请求 `{ __ijipuAppRequest: 1, id, method, params }`、
 *          应答 `{ __ijipuAppResponse: 1, id, ok, result | error }` ✓；
 *  · 只在**被 Obsidian 嵌入**时生效（`window.parent !== window` ✓）—— 独立浏览器里它是空转 ✓。
 *
 * 安全边界（与插件侧**同一口径**，两边都守 ✓）：
 *  1. **来源校验**：只接受 `event.source === window.parent`（嵌入我们的那一层 ✓）；
 *  2. **方法白名单**：`render.png` / `render.svg` / `export.midi`（`playback.*` 待 B3 后段 ✓）；
 *  3. **参数校验**：`svg` 必须是字符串且长度有上限；`scale` 限定 1–4 ✓；
 *  4. **诚实降级**：做不到的能力回 `-32601`/`-32000` 并写清原因，**不假装成功** ✗；
 *  5. **不写盘、不下载**：只把结果**回传**给插件（是否落盘由插件决定 ✓）。
 */
import { svgToCanvas } from '../export/export'

/** 与插件侧 `APP_METHODS` 对应的**可实现子集**（做不到的先不列，避免"列了却返回未实现" ✗） */
export const APP_BRIDGE_METHODS = ['render.svg', 'render.png', 'export.midi'] as const

type Request = { __ijipuAppRequest: 1; id: number; method: string; params?: Record<string, unknown> }
/**
 * ⚠ 回应体单独定义：`Omit<Reply, …>` 作用在**联合类型**上会塌成"公共键" ✗
 * （第一版就这么写，`tsc` 报 `'error' does not exist in type` ✓）⇒ 显式写联合 ✓。
 */
type ReplyBody = { ok: true; result: unknown } | { ok: false; error: { code: number; message: string } }

const CODE = { notFound: -32601, invalidParams: -32602, internal: -32603, unsupported: -32000 } as const

/** SVG → PNG dataURL（复用应用既有 `svgToCanvas`，**不另写一份渲染** ✓） */
async function svgToPngDataUrl(svg: string, scale: number): Promise<string> {
  const canvas = await svgToCanvas(svg, scale)
  return canvas.toDataURL('image/png')
}

/** MIDI 字节 → base64（postMessage 只传可结构化克隆的值 ⇒ 用字符串 ✓） */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/**
 * 安装入站监听（**只装一次**；被嵌入时才真正工作 ✓）。
 * @param renderSvg 复用应用自己的渲染（`renderScoreToSvg` 那条链路 ✓）——注入以避免循环依赖
 * @param exportMidi 复用应用的 MIDI 导出链路 ✓
 */
export function installObsidianBridge(deps: {
  renderSvg: (source: string, pageConfig?: Record<string, unknown>) => { ok: boolean; svgs: string[]; error?: string }
  exportMidi: (source: string) => { ok: boolean; bytes?: Uint8Array; error?: string }
}): () => void {
  const embedded = window.parent !== window && window.parent !== null
  if (!embedded) return () => {} // 独立浏览器：空转 ✓（不是错误，只是没有宿主 ✓）

  const onMessage = (ev: MessageEvent): void => {
    const data = ev.data as Request | null
    if (data === null || typeof data !== 'object' || data.__ijipuAppRequest !== 1) return
    // ① 来源校验：只认"嵌入我们的那一层" ✓
    if (ev.source !== window.parent) return
    const target = ev.source as Window
    const id = data.id
    const reply = (r: ReplyBody): void => {
      target.postMessage({ __ijipuAppResponse: 1, id, ...r }, '*')
    }
    const fail = (code: number, message: string): void => reply({ ok: false, error: { code, message } })
    const method = String(data.method ?? '')
    // ② 白名单
    if (!(APP_BRIDGE_METHODS as readonly string[]).includes(method)) {
      fail(CODE.notFound, `嵌入版不支持该方法：${method}`)
      return
    }
    const params = data.params ?? {}
    void (async () => {
      try {
        // ③ 参数校验
        const source = params.source
        if (typeof source !== 'string' || source.length > 500_000) {
          fail(CODE.invalidParams, 'params.source 必须是字符串（≤500000 字符）')
          return
        }
        const pageConfig =
          params.pageConfig === undefined || params.pageConfig === null
            ? undefined
            : typeof params.pageConfig === 'object'
              ? (params.pageConfig as Record<string, unknown>)
              : null
        if (pageConfig === null) {
          fail(CODE.invalidParams, 'params.pageConfig 必须是对象')
          return
        }
        if (method === 'export.midi') {
          const r = deps.exportMidi(source)
          if (!r.ok || r.bytes === undefined) {
            fail(CODE.internal, r.error ?? 'MIDI 导出失败')
            return
          }
          reply({ ok: true, result: { midiBase64: bytesToBase64(r.bytes), bytes: r.bytes.length } })
          return
        }
        const r = deps.renderSvg(source, pageConfig)
        if (!r.ok) {
          fail(CODE.internal, r.error ?? '渲染失败')
          return
        }
        if (method === 'render.svg') {
          reply({ ok: true, result: { svgs: r.svgs } })
          return
        }
        // render.png：逐页转 dataURL（与 GUI 导出**同一套** `svgToCanvas` ✓）
        const scaleRaw = params.scale
        const scale = typeof scaleRaw === 'number' && scaleRaw >= 1 && scaleRaw <= 4 ? scaleRaw : 2
        const pngs: string[] = []
        for (const svg of r.svgs) pngs.push(await svgToPngDataUrl(svg, scale))
        reply({ ok: true, result: { pngs, pages: pngs.length } })
      } catch (e) {
        // ④ 诚实降级：回错误码 + 原因，绝不假装成功 ✗
        fail(CODE.unsupported, `嵌入版处理失败：${String(e)}`)
      }
    })()
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
