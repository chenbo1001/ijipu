/**
 * store/assetSource.ts — 把「水印 / 背景图的路径」解析成引擎能画的 **data URI**（adj965，方案 `docs/OVERLAY-PLAN.md`「OVL」§四）
 *
 * ## 为什么必须在这一层做（而不是引擎里）
 *
 * 引擎零 DOM（机器闸门 `adj770` 禁 `document`/`createElement`/`Image`）⇒ 它**读不到字节、也量不到宽高**，
 * 只能收"已经解析好的 `{ href, w, h }`"（`RenderAssets`）。这与既有的"宿主实测字体宽度、引擎消费"
 * （`RenderFontMeta`）是同一条设计线。
 *
 * 而且 `href` **必须是 data URI**：PNG/JPG/PDF 三条导出都是把 SVG 交给 `new Image()` 栅格化
 * （`src/export/export.ts` 的 `svgToCanvas`），而**以图片方式加载的 SVG 不允许引用外部资源**。
 *
 * ## 三类取值（用户的字段里都可能出现）
 *
 * | 写法 | 谁能用 | 怎么解析 |
 * |---|---|---|
 * | `data:image/png;base64,…` | 全端 | 直通（仍需解码量宽高） |
 * | `[[图片.png]]`（Obsidian 双链） | **只有插件**（要 vault 的链接解析） | 宿主先解成 vault 相对路径，这里只负责**去掉 `[[ ]]` 包裹** |
 * | `图.png` / `img/图.png`（相对这份 `.jps`） | 桌面端 / 工作区内 / 插件 | 各端一条通道（见 §四.1 的缺口表） |
 *
 * ## 设计：通道与解码都可注入
 *
 * 解析逻辑（路径归一、白名单、大小上限、缓存）与平台无关，所以放在这里；
 * 真正"读字节"与"解码 + 量宽高 + 降采样"分别由 `AssetReader` / `AssetDecoder` 注入
 * ⇒ ① 各端只实现自己那条通道；② 冒烟里能注入假实现，把纯逻辑**在 Node 里断言**。
 *
 * ## 安全（方案 §八.10）
 *
 * `.jps` 是纯文本、可能来自别人 ⇒ **只接受图片扩展名**（`png/jpg/jpeg/webp/gif/bmp`），
 * **拒绝 `svg`**（SVG 可以内嵌脚本），并有单文件大小上限。否则一句路径就能读走任意文件。
 */
import type { WorkspaceRecord } from './fileHandleDb'

/** 单文件上限：16MB（超过它当背景基本也糊，且会让每页 SVG 巨大） */
export const MAX_ASSET_BYTES = 16 * 1024 * 1024

/**
 * 允许的图片扩展名。**故意不含 `svg`**：SVG 能带 `<script>`/外链，当"图片"塞进产物里
 * 等于把 `.jps` 变成脚本投递通道（见方案 §八.10）。
 */
export const ALLOWED_ASSET_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] as const

/** 解析失败的原因（都带**能照着做**的中文说明；方案优化 7：不许静默降级） */
export interface AssetFailure {
  ok: false
  /** 给用户看的一句话（含"该怎么办"） */
  error: string
}

/** 解析成功：引擎要的三件东西 + 供缓存/提示用的元信息 */
export interface ResolvedAsset {
  ok: true
  href: string
  w: number
  h: number
  /** 解出来的原始字节数（提示/上限用） */
  bytes: number
}

/** 资源的"基准"——相对路径相对谁 */
export type AssetBase =
  /** 桌面端：`.jps` 所在目录（绝对路径，来自 `nativePath`） */
  | { kind: 'native'; dir: string }
  /** 网页版 / 插件：工作区根 + 该 `.jps` 的工作区相对段（`segs` 末段是文件名） */
  | { kind: 'workspace'; rec: WorkspaceRecord; segs: readonly string[] }
  /** 没有基准（新建未保存、粘贴导入等）⇒ 相对路径无从解析，明确报错 */
  | { kind: 'none' }

/** 平台通道：把"基准 + 相对路径"读成字节 */
export type AssetReader = (
  path: string,
  base: AssetBase,
) => Promise<{ bytes: Uint8Array; mime: string; mtime?: number } | null>

/**
 * 解码 + 量宽高 +（可选）降采样。
 *
 * 输入二选一：`{ bytes }`（平台通道读到的字节）或 `{ dataUri }`（配置里本来就是内嵌的）。
 * 实现放在**另一个文件** `assetDecode.ts`（要 `Image`/`canvas`，是 DOM 代码）——
 * 本文件必须保持**零 DOM**，因为冒烟会在 Node 里 import 它并注入假实现来断言纯逻辑。
 */
export type AssetDecoder = (
  input: { bytes: Uint8Array; mime: string } | { dataUri: string },
) => Promise<{ href: string; w: number; h: number }>

let reader: AssetReader | null = null
let decoder: AssetDecoder | null = null

/** 装配平台通道（应用启动时按端注册一处；`null` ⇒ 该端读不到，解析时给明确提示） */
export function setAssetReader(r: AssetReader | null): void {
  reader = r
}

/** 装配解码器（浏览器侧；冒烟里注入假实现以便在 Node 断言） */
export function setAssetDecoder(d: AssetDecoder | null): void {
  decoder = d
}

/** 路径归一：`[[双链]]` 去掉包裹、去首尾空白、`\` 归一成 `/`、去掉开头的 `./` */
export function assetPathOf(raw: string): { path: string; link: boolean; isData: boolean } {
  let s = String(raw ?? '').trim()
  let link = false
  // Obsidian 双链：`[[图片.png]]`（也接受 `[[图片.png|别名]]` —— 取 `|` 前那半）
  const m = /^\[\[([^\]]+)\]\]$/.exec(s)
  if (m !== null) {
    link = true
    s = (m[1] ?? '').split('|')[0]?.trim() ?? ''
  }
  if (/^data:/i.test(s)) return { path: s, link, isData: true }
  return { path: s.replace(/\\/g, '/').replace(/^\.\//, ''), link, isData: false }
}

/** 取扩展名（小写、不含点） */
export function extOf(path: string): string {
  const i = path.lastIndexOf('.')
  return i < 0 ? '' : path.slice(i + 1).toLowerCase()
}

/**
 * 扩展名白名单。
 * ⚠ 只按扩展名判**不是**安全边界（真正的边界是"读哪条通道 + 不解释内容"），
 * 但它能挡住"随手写个路径把系统文件读进来当图"这一大类，且给用户一句能懂的话。
 */
export function isAllowedAssetPath(path: string): boolean {
  return (ALLOWED_ASSET_EXT as readonly string[]).includes(extOf(path))
}

/** mime ← 扩展名（data URI 用；`data:` 直通时用原 mime） */
export function mimeOf(path: string): string {
  switch (extOf(path)) {
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

/**
 * 同一次会话内的解析缓存（键 = **基准 + 路径**）。
 *
 * ⚠ 缓存必须在**读字节之前**命中（第一版把查缓存放在 decode 里 ⇒ 字节已经读完了才发现有缓存，
 * `reads=2`，等于没省 —— 被冒烟的计数断言当场抓出来）。所以 mtime **不参与键**。
 *
 * 代价与对策：文件在会话中途被换掉时可能显示旧图 ⇒ 提供 `clearAssetCache()`，
 * 由"外部改动 / 换工作区 / 重新打开文件"这些路径调用（EP-10 接线）。
 */
const cache = new Map<string, ResolvedAsset>()

/** 清缓存（外部改动、换工作区、冒烟用） */
export function clearAssetCache(): void {
  cache.clear()
}

/** 缓存键：把基准的身份也算进去，避免"同名文件在两个工作区"互相串 */
function cacheKeyOf(path: string, base: AssetBase): string {
  const where =
    base.kind === 'native'
      ? `n:${base.dir}`
      : base.kind === 'workspace'
        ? `w:${base.rec.id}:${base.segs.slice(0, -1).join('/')}`
        : 'x'
  return `${where}|${path}`
}

/**
 * 解析成引擎要的 `{ href, w, h }`。
 *
 * 失败一律返回**带中文说明**的 `AssetFailure`（调用方负责提示，见方案优化 7：**不静默降级**）：
 * 静默少画一层，用户会以为"设置了没用"。
 */
export async function resolveAsset(raw: string, base: AssetBase): Promise<ResolvedAsset | AssetFailure> {
  const { path, link, isData } = assetPathOf(raw)
  if (path === '') return { ok: false, error: '图片路径是空的' }

  if (isData) {
    return decode(`data:${path.length}:${path.slice(0, 64)}`, { dataUri: path })
  }

  // 双链只有"能解链接"的宿主（Obsidian 插件）才认：网页版/桌面端里 `[[…]]` 不是一个合法路径
  if (link && base.kind !== 'workspace') {
    return { ok: false, error: '`[[…]]` 双链只在 Obsidian 插件里可用（这里请写相对这份 .jps 的路径）' }
  }
  if (!isAllowedAssetPath(path)) {
    return {
      ok: false,
      error: `不支持的图片类型（只收 ${ALLOWED_ASSET_EXT.join(' / ')}）：${path}`,
    }
  }
  if (base.kind === 'none') {
    return { ok: false, error: '这份谱还没有保存到文件，无法按相对路径找图：先保存它，或改用 data: 内嵌' }
  }
  if (reader === null) {
    return { ok: false, error: '当前环境没有读取图片的通道（详情见 docs/OVERLAY-PLAN.md §四）' }
  }

  // **先查缓存再读字节**（见 `cache` 的说明：查晚了等于没省）
  const key = cacheKeyOf(path, base)
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let got: Awaited<ReturnType<AssetReader>>
  try {
    got = await reader(path, base)
  } catch (e) {
    return { ok: false, error: `读图片失败：${e instanceof Error ? e.message : String(e)}` }
  }
  if (got === null) return { ok: false, error: `找不到这张图片：${path}` }
  if (got.bytes.byteLength > MAX_ASSET_BYTES) {
    const mb = (MAX_ASSET_BYTES / 1024 / 1024).toFixed(0)
    return { ok: false, error: `图片太大（超过 ${mb}MB）：${path}（先把它压小，或改用分辨率低一些的图）` }
  }
  return decode(key, { bytes: got.bytes, mime: got.mime })
}

/**
 * 解码 + 缓存。`identity` 由调用方给出（**必须含基准 + 路径 + mtime**，见 `cacheKeyOf`）——
 * 否则"同名文件在两个工作区"或"文件被换过"会命中旧结果。
 */
async function decode(
  identity: string,
  input: { bytes: Uint8Array; mime: string } | { dataUri: string },
): Promise<ResolvedAsset | AssetFailure> {
  if (decoder === null) {
    return { ok: false, error: '当前环境没有图片解码器（浏览器里才有；见 docs/OVERLAY-PLAN.md §三.2）' }
  }
  const hit = cache.get(identity)
  if (hit !== undefined) return hit
  try {
    const dec = await decoder(input)
    const bytes = 'bytes' in input ? input.bytes.byteLength : 0
    const out: ResolvedAsset = { ok: true, href: dec.href, w: dec.w, h: dec.h, bytes }
    cache.set(identity, out)
    return out
  } catch (e) {
    return { ok: false, error: `图片解码失败（可能不是有效图片）：${e instanceof Error ? e.message : String(e)}` }
  }
}
