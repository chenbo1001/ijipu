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
 *     `crop`（adj863：范围）必须是四个有限数、且宽高为正 ✓；
 *  4. **诚实降级**：做不到的能力回 `-32601`/`-32000` 并写清原因，**不假装成功** ✗；
 *  5. **不写盘、不下载**：只把结果**回传**给插件（是否落盘由插件决定 ✓）。
 */
import { applyRangeToSvg, type RangeBox } from '@ijipu/engine'
import { svgToCanvas } from '../export/export'

/** 与插件侧 `APP_METHODS` 对应的**可实现子集**（做不到的先不列，避免"列了却返回未实现" ✗） */
export const APP_BRIDGE_METHODS = ['render.svg', 'render.png', 'export.midi'] as const

/**
 * adj863（T-3 定稿）：解析宿主传来的**范围盒** `params.crop`（`{x,y,w,h}`）。
 *
 * 为什么"盒"由宿主算好再传：墨迹只能用真实 DOM 的 `getBBox()` 量（`obsidian-ijipu` 的面板里量过 ✓），
 * 而**规则**（±每边 N px、退化/近整页判失败）只有引擎那一份 ✓ ⇒ 这里**只做校验与应用**，不重算几何 ✗。
 * 返回 `null` = 没传或非法（非法**必须报错**，不能静默当整页 ✓）；返回 `undefined` = 没传（合法地不裁剪）。
 */
function parseCrop(raw: unknown): RangeBox | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const nums = [o.x, o.y, o.w, o.h]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const [x, y, w, h] = nums as number[]
  if (w <= 0 || h <= 0 || w > 100_000 || h > 100_000) return null
  if (Math.abs(x) > 100_000 || Math.abs(y) > 100_000) return null
  return { x, y, w, h }
}

/**
 * adj965j：解析宿主传来的**图片资源** `params.assets`（`{wm?:{href,w,h}, bg?:{href,w,h}}`）。
 *
 * 为什么由宿主解析：应用在 iframe 里**读不到 vault**（拿不到字节、也量不到宽高）⇒
 * "相对本谱的路径"与"`[[]]` 双链"这两类取值只有宿主能解析（插件侧 `src/overlayAssets.ts`）。
 * 这里**只做校验与转交**，不重算任何几何 ✓。返回 `null` = 传了但非法（**如实报错**，不静默当没有 ✓）。
 */
function parseAssets(raw: unknown): Record<string, unknown> | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of ['wm', 'bg'] as const) {
    const v = o[k]
    if (v === undefined || v === null) continue
    if (typeof v !== 'object') return null
    const e = v as Record<string, unknown>
    if (typeof e.href !== 'string' || !e.href.startsWith('data:image/')) return null
    if (typeof e.w !== 'number' || typeof e.h !== 'number' || !(e.w > 0) || !(e.h > 0)) return null
    out[k] = { href: e.href, w: e.w, h: e.h }
  }
  return out
}

type Request = { __ijipuAppRequest: 1; id: number; method: string; params?: Record<string, unknown> }/**
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
  /**
   * adj965j（用户 2026-10-15 实报后修正）：**多一个 `assets`**。
   *
   * 用户报"代码块里背景用 `[[]]` 双链时预览正常、导出 PNG 没背景"。第一次修法是"宿主把图内联成
   * `data:` URI 写进临时源码"，**没用** —— 因为引擎渲染图片**只认 `assets` 里那份 `{href,w,h}`**，
   * 它不会自己去解析源码里的路径/`data:`（设计如此：引擎零 DOM，量不到宽高、也读不到字节）。
   * ⇒ 正确做法是宿主解析好后**把 `assets` 递过来**，这里转交给 `renderScoreToSvg` 的 `RenderOpts` ✓。
   */
  renderSvg: (
    source: string,
    pageConfig?: Record<string, unknown>,
    assets?: Record<string, unknown>,
  ) => { ok: boolean; svgs: string[]; error?: string }
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
        /**
         * adj965k：上限**收回 500000 字符**（adj965j 曾放宽到 8 000 000，那是为"把水印/背景图内联成
         * `data:` URI 写进这份源码"服务的）。
         *
         * 为什么收回：那条内联做法**被用户实测证伪**（引擎渲染图片只认 `params.assets` 那份
         * `{href,w,h}`，源码里写路径没用）⇒ 源码再也不会因为图片而变长，旧上限失去了存在理由 ✗。
         * 留着一个"因为废掉的做法而放宽"的上限，只会把真正的异常（超大源码）放过去 —— 收回即收紧 ✓。
         * 图片字节仍然**照旧经 `params.assets` 递过来**（走的是另一条长度口径，不受这里影响）。
         */
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
        const r = deps.renderSvg(source, pageConfig, parseAssets(params.assets) ?? undefined)
        if (!r.ok) {
          fail(CODE.internal, r.error ?? '渲染失败')
          return
        }
        // adj863：**范围**（`params.crop`）—— 宿主量好墨迹盒后按引擎口径传盒，这里只校验 + 应用
        const crop = parseCrop(params.crop)
        if (crop === null) {
          fail(CODE.invalidParams, 'params.crop 必须是 {x,y,w,h} 四个有限数，且 w/h > 0')
          return
        }
        const svgs = crop === undefined ? r.svgs : r.svgs.map((s) => applyRangeToSvg(s, crop))
        if (method === 'render.svg') {
          reply({ ok: true, result: { svgs } })
          return
        }
        // render.png：逐页转 dataURL（与 GUI 导出**同一套** `svgToCanvas` ✓）
        const scaleRaw = params.scale
        const scale = typeof scaleRaw === 'number' && scaleRaw >= 1 && scaleRaw <= 4 ? scaleRaw : 2
        const pngs: string[] = []
        for (const svg of svgs) pngs.push(await svgToPngDataUrl(svg, scale))
        reply({ ok: true, result: { pngs, pages: pngs.length } })
      } catch (e) {
        // ④ 诚实降级：回错误码 + 原因，绝不假装成功 ✗
        fail(CODE.unsupported, `嵌入版处理失败：${String(e)}`)
      }
    })()
  }

  window.addEventListener('message', onMessage)
  /**
   * adj850（用户实测已排除"产物没更新/窗口选错/开关没开" ✓，只剩"桥是否执行到安装"✗）：
   * **装好就向父窗口报到一次** ✓ —— 跨源也能发 ✓，父窗口（插件）收到后记进诊断 ✓。
   * 这一行让"桥到底有没有运行"从"靠推断"变成"看得见" ✓。
   */
  try {
    window.parent?.postMessage({ __ijipuAppHello: 1, href: location.href }, '*')
  } catch {
    /* 报不到也不影响安装本身 ✓ */
  }
  return () => window.removeEventListener('message', onMessage)
}
