/**
 * store/overlayAssets.ts — 当前文档的「水印/背景图」资源状态（adj965，方案 `docs/OVERLAY-PLAN.md`「OVL」EP-10）
 *
 * ## 一条链
 *
 * `# jps-config` 里的路径 →（`assetSource` 读字节 + 白名单/上限）→（`assetDecode` 解码 + 降采样）
 * → `RenderAssets` → **三处渲染点共用同一份**：预览、导出面板、打印。
 *
 * ## 为什么要有这个中间状态（而不是各渲染点各自解析）
 *
 * 1. **口径一处**：预览与导出必须画得一模一样，否则又是"预览有、导出没有"那类漂移
 *    （同 `adj960` 的 `%FILE%`、`adj965` 的两条闸门探针 —— 两处实现必然漂）；
 * 2. **不重复解码**：大图解码一次就够（`assetSource` 里还有一层缓存，这里保证"同一份结果"）；
 * 3. **失败要看得见**：解析失败（图不在/太大/类型不对）必须让用户看到，
 *    **不静默少画一层**（方案优化 7）——所以这里把错误也存下来，由设置面板就地显示。
 *
 * ## 为什么本模块**不 import docStore**
 *
 * `docStore` 也要用 `withOverlay`（打印页渲染在它里面）⇒ 若本模块再 import docStore 就成了**环**。
 * 所以"当前文档是什么"由**调用方**（`App.tsx`）把 `pageConfig` 与 `base` 传进来：
 * 本模块只依赖 `assetSource` 与引擎类型，**零环**。
 */
import type { RenderAssets, RenderFontMeta, RenderOpts } from '@ijipu/engine'
import { resolveAsset, setAssetReader, type AssetBase, type AssetReader } from './assetSource'
import { decodeAsset } from './assetDecode'

/** 给 UI 的快照（**引用稳定**：只有真的变了才换新对象，否则 `useSyncExternalStore` 会死循环） */
export interface OverlaySnapshot {
  assets?: RenderAssets
  /** 解析失败的说明（中文、能照着做）；空数组 = 一切正常 */
  errors: string[]
}

const EMPTY: OverlaySnapshot = { errors: [] }
let snapshot: OverlaySnapshot = EMPTY
const listeners = new Set<() => void>()

/** 读快照（`useSyncExternalStore` 的 `getSnapshot`） */
export function getOverlaySnapshot(): OverlaySnapshot {
  return snapshot
}

/** 订阅变化（返回退订函数） */
export function subscribeOverlayAssets(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function publish(next: OverlaySnapshot): void {
  // 引用稳定性：内容完全一样就不通知（避免每次 sync 都触发一轮重渲染）
  const same =
    snapshot.errors.length === next.errors.length &&
    snapshot.errors.every((e, i) => e === next.errors[i]) &&
    (snapshot.assets === next.assets ||
      (snapshot.assets === undefined && next.assets === undefined) ||
      (snapshot.assets !== undefined &&
        next.assets !== undefined &&
        snapshot.assets.bg === next.assets.bg &&
        snapshot.assets.wm === next.assets.wm))
  if (same) return
  snapshot = next
  for (const fn of listeners) fn()
}

/** 清空（换文档 / 关文件时用；也避免"上一份谱的图"被下一个文档复用） */
export function clearOverlayAssets(): void {
  publish(EMPTY)
}

/**
 * 解析这份谱要画的两张图（幂等，可反复调用）。
 *
 * 只在"真的要用图片"时才去读：文本水印走 `wmText`，根本不需要资源 ⇒ 不做任何 IO。
 */
export async function syncOverlayAssets(
  input: { wmType: 'text' | 'image'; wmImage: string; bgImage: string },
  base: AssetBase,
): Promise<void> {
  const needWm = input.wmType === 'image' && input.wmImage.trim() !== ''
  const needBg = input.bgImage.trim() !== ''
  if (!needWm && !needBg) {
    publish(EMPTY)
    return
  }
  const [wmR, bgR] = await Promise.all([
    needWm ? resolveAsset(input.wmImage, base) : Promise.resolve(null),
    needBg ? resolveAsset(input.bgImage, base) : Promise.resolve(null),
  ])
  const errors: string[] = []
  const next: RenderAssets = {}
  if (wmR !== null) {
    if (wmR.ok) next.wm = { href: wmR.href, w: wmR.w, h: wmR.h }
    else errors.push(`水印图：${wmR.error}`)
  }
  if (bgR !== null) {
    if (bgR.ok) next.bg = { href: bgR.href, w: bgR.w, h: bgR.h }
    else errors.push(`背景图：${bgR.error}`)
  }
  publish({ ...(Object.keys(next).length > 0 ? { assets: next } : {}), errors })
}

/**
 * 把当前资源并入渲染参数 —— **三处渲染点都走它**（预览 / 导出面板 / 打印）。
 * 没有资源时等价于"不加任何东西"，产物与 `adj965` 之前**逐字节相同**（有闸门钉着）。
 *
 * @param opts 宿主实测的字体度量
 * @param assets 资源；**预览显式传**它订阅到的那份（这样 `useMemo` 的依赖是真的、lint 也能看出来），
 *               导出/打印省略 ⇒ 读当前快照（它们不是 React 渲染路径，读当下值正合适）
 */
export function withOverlay(opts?: RenderFontMeta, assets: RenderAssets | undefined = snapshot.assets): RenderOpts {
  return assets === undefined ? { ...(opts ?? {}) } : { ...(opts ?? {}), assets }
}

/**
 * 装配**平台读图通道**（应用启动时调一次）。
 *
 * 各端一条（方案 §四.1 的缺口表）：
 *  · 桌面端：Rust 的 `read_asset_file`（绝对路径，双击打开的谱）/ `ws_read_binary`（工作区相对路径）；
 *  · 插件：宿主桥 `readAsset`（EP-09 接）；
 *  · 网页版：工作区目录句柄（EP-14 接）。
 * 这里只装桌面端那条；其余由各自模块在启动时覆盖（`setAssetReader` 是"后装者生效"）。
 *
 * ⚠ 顺带把**解码器**也装上（唯一碰 Image/canvas 的实现，浏览器里才有）。
 */
export function installAssetReader(reader: AssetReader | null = desktopAssetReader): void {
  setAssetReader(reader)
}

/** 桌面端读图：把"基准 + 相对路径"翻译成两条 Rust 命令之一 */
const desktopAssetReader: AssetReader = async (path, base) => {
  // 动态 import：不在桌面壳里时不必把 `brand/env` 拉进这条链
  const { tauriInvoke } = await import('../brand/env')
  if (base.kind === 'native') {
    const abs = joinNativePath(base.dir, path)
    const buf = await tauriInvoke<ArrayBuffer>('read_asset_file', { path: abs })
    return { bytes: new Uint8Array(buf), mime: mimeOfPath(path) }
  }
  if (base.kind === 'workspace' && base.rec.dir !== undefined) {
    // 工作区基准：`segs` 末段是 `.jps` 自己 ⇒ 换成图片文件的相对段
    const segs = [...base.segs.slice(0, -1), ...path.split('/').filter((s) => s !== '')]
    const buf = await tauriInvoke<ArrayBuffer>('ws_read_binary', { root: base.rec.dir, segs })
    return { bytes: new Uint8Array(buf), mime: mimeOfPath(path) }
  }
  // 不是桌面端能走的两条路（例如网页版的 FSA 工作区）⇒ 交给下一条通道（返回 null 表示"这条读不到"）
  return null
}

/** 拼 Windows 绝对路径（沿用输入里的分隔符风格，同 CLI 的 `joinPath` 口径） */
function joinNativePath(dir: string, rel: string): string {
  const d = dir.replace(/[\\/]+$/, '')
  const sep = d.includes('\\') && !d.includes('/') ? '\\' : '/'
  return `${d}${sep}${rel.replace(/[\\/]/g, sep === '\\' ? '\\' : '/')}`
}

/** 扩展名 → mime（与 `assetSource.mimeOf` 同口径；这里避免把整个模块再 import 一次造成循环阅读负担） */
function mimeOfPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    default:
      return 'application/octet-stream'
  }
}

/** 解码器在这里装配（`assetDecode` 是本工程里唯一碰 `Image`/`canvas` 的地方） */
export function installAssetDecoder(): void {
  // 动态 import：桌面/浏览器里都可用；Node（冒烟）不会走到这里
  void import('./assetSource').then((m) => m.setAssetDecoder(decodeAsset))
}
