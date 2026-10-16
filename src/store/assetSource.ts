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
import { overlayCopy as C } from '../brand/copy'

/**
 * adj965（EP-09 起）：**策略部分搬去引擎**，本文件从这里再导出，其余模块的 import 不用动。
 *
 * 为什么必须搬：同一套白名单/上限/路径归一/mime 映射**插件侧也要用**
 * （宿主桥的 `readAsset` op、代码块预览的取图），而插件只同步 `vendor/engine`
 * ⇒ 留在应用侧就等于让两端各写一份（本项目「两端共用的规则一律先落 engine」那条）。
 */
export {
  MAX_ASSET_BYTES,
  ALLOWED_ASSET_EXT,
  assetPathOf,
  extOf,
  isAllowedAssetPath,
  mimeOf,
  splitAssetPath,
} from '@ijipu/engine'
import { MAX_ASSET_BYTES, assetPathOf, isAllowedAssetPath } from '@ijipu/engine'

/** 解析失败的原因（都带**能照着做**的中文说明；方案优化 7：不许静默降级） */
export interface AssetFailure {
  ok: false
  /** 给用户看的一句话（含"该怎么办"） */
  error: string
  /**
   * adj969：这条失败**是因为缺一个"资源目录"授权**（用户实报的那条）⇒ 调用方据此在设置页签里
   * 就地给一个「授权…」按钮（`overlaySnapshot.needsDirAuth`）。
   * 与「图不在」「类型不对」分开：那两条再授权也没用，给了按钮只会让人白点一次。
   */
  needDir?: true
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
  /**
   * adj969（**用户实报**："文件方式"打开的谱里相对路径图找不到）：网页 / PWA 用**文件句柄**
   * 打开的谱，用户**额外授权了它所在的文件夹**（`showDirectoryPicker`）⇒ 这个句柄就是"本谱所在的目录"，
   * 直接当基准（不再像工作区那样还要按 `segs` 下钻）。
   *
   * 为什么必须多这一档：浏览器**不给文件句柄的父目录**（这是 Web 的硬限制，不是我们没写），
   * 于是此前"文件方式打开"的谱一律落到 `{kind:'none'}` ⇒ 相对路径图必然解析失败（E-2026-*）。
   * 句柄的来源与核对见 `store/assetDirAuth.ts`（句柄存 IndexedDB，跨会话复用；每次用之前
   * 都要用"同名 + 同字节数 + 同修改时间"核对一遍，避免把另一个目录里同名的谱当成这一份）。
   */
  | { kind: 'picked'; dir: FileSystemDirectoryHandle; id: string }
  /**
   * adj969：**有文件、但没有它所在的目录**（用户还没授权，或拒绝了）。
   *
   * 与 `{kind:'none'}`（未保存的新谱）分开：两者给用户的**处置完全不同**
   * —— 这一档要说"授权一下那个文件夹就行"（并给按钮），而不是"请先保存本谱"。
   */
  | { kind: 'fileNoDir'; name: string }
  /** 没有基准（新建未保存、粘贴导入等）⇒ 相对路径无从解析，明确报错 */
  | { kind: 'none' }

/**
 * 平台通道：把"基准 + 相对路径"读成字节。
 *
 * `opts.link`（adj965 EP-09 补）＝ 这个路径来自 **Obsidian 双链** `[[图片.png]]`：
 * 它的解析语义是"vault 全域找同名文件"（可跨目录），与"相对本谱的路径"**不是一回事**
 * ⇒ 只有能解链接的宿主（插件）才认；其它端据此返回 `null`（未找到）而不是拿链接原文当路径去试。
 * 为什么要把 `link` 传下来：`resolveAsset` 在调用通道**之前**就把 `[[ ]]` 剥掉了，
 * 通道自己看不出这个区别。
 */
export type AssetReader = (
  path: string,
  base: AssetBase,
  opts: { link: boolean },
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

/** 路径归一、扩展名白名单、mime、单文件上限 —— 定义见引擎 `engine/overlayAsset.ts`（两端共用） */

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
        : base.kind === 'picked'
          ? // adj969：目录句柄**没有可打印的身份**（`name` 只是末级目录名，两个同名目录会撞）
            // ⇒ 由 `assetDirAuth` 在启用那一刻发一个会话内 id（`d1`/`d2`…）当身份。
            // 少了它，用户在 A 目录看过的图会被 B 目录同名路径**静默复用**（假绿）。
            `p:${base.id}`
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
  if (path === '') return { ok: false, error: C.errEmptyPath }

  if (isData) {
    return decode(`data:${path.length}:${path.slice(0, 64)}`, { dataUri: path })
  }

  // 双链只有"能解链接"的宿主（Obsidian 插件）才认：网页版/桌面端里 `[[…]]` 不是一个合法路径
  if (link && base.kind !== 'workspace') {
    return { ok: false, error: C.errLinkNotSupported }
  }
  if (!isAllowedAssetPath(path)) {
    return { ok: false, error: C.errUnsupportedType(path) }
  }
  if (base.kind === 'none') {
    return { ok: false, error: C.errNotSaved }
  }
  // adj969：**有文件、没有它所在的目录**（网页 / PWA 用文件句柄打开的谱）⇒ 说清"授权一下就行"，
  // 并带上 `needDir` 让设置页签就地给按钮（不是"请先保存本谱"那种答非所问的话）
  if (base.kind === 'fileNoDir') {
    return { ok: false, error: C.errNeedDirAuth(base.name), needDir: true }
  }
  if (reader === null) {
    return { ok: false, error: C.errNoChannel }
  }

  // **先查缓存再读字节**（见 `cache` 的说明：查晚了等于没省）
  const key = cacheKeyOf(path, base)
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let got: Awaited<ReturnType<AssetReader>>
  try {
    got = await reader(path, base, { link })
  } catch (e) {
    return { ok: false, error: C.errReadFailed(e instanceof Error ? e.message : String(e)) }
  }
  if (got === null) return { ok: false, error: C.errNotFound(path) }
  if (got.bytes.byteLength > MAX_ASSET_BYTES) {
    return { ok: false, error: C.errTooLarge(Math.round(MAX_ASSET_BYTES / 1024 / 1024), path) }
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
    return { ok: false, error: C.errDecodeFailed(e instanceof Error ? e.message : String(e)) }
  }
}
