/**
 * store/assetReaderVault.ts — **嵌入版（Obsidian 插件）**的读图通道（adj965，方案 `docs/OVERLAY-PLAN.md`「OVL」EP-09）
 *
 * ## 为什么需要它
 *
 * 水印/背景图要按"相对本谱的路径"读字节，而各端的读法不同（方案 §四.1 的缺口表）：
 *   · 桌面端：Rust 的 `read_asset_file` / `ws_read_binary`（`overlayAssets.ts` 里那条）
 *   · 网页版：工作区目录句柄（`assetReaderFsa.ts`）
 *   · **嵌入版：宿主桥的 `readAsset` op（本文件）** —— 应用在 iframe 里是浏览器上下文，
 *     拿不到 vault 的二进制读；而"相对本谱的路径"在插件里就是"vault 里的路径"。
 *
 * ## 两条取值（与 `assetSource.assetPathOf` 的三类对应）
 *
 * | 写法 | 怎么解析 |
 * |---|---|
 * | `图.png` / `img/图.png` | 工作区相对路径：**本谱所在目录** + 图片自己的子目录 |
 * | `[[图片.png]]` | **交给宿主用 Obsidian 的链接解析**（vault 全域、可跨目录）——与相对路径不是一回事 |
 *
 * ## 边界
 *
 *  · 只认 `base.kind === 'workspace'`（桌面端绝对路径那条不归它管 ⇒ 返回 `null`，让上层给提示）；
 *  · 不在嵌入环境（`hostBridge()` 为 `null`）⇒ 返回 `null`（网页版/桌面端各有自己的通道）；
 *  · `..` 这类上跳段直接拒绝（宿主侧还会再归一化一次，两道都留着）。
 */
import type { AssetReader } from './assetSource'
import { splitAssetPath } from '@ijipu/engine'
import { hostBridge } from './hostBridge'

/** 本谱在**文库里的路径**（双链解析的基准；`root` 为空 = 文库根） */
export function vaultSourcePathOf(root: string, noteSegs: readonly string[]): string {
  return [root, ...noteSegs]
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter((s) => s !== '')
    .join('/')
}

/**
 * 纯逻辑（smoke 可断言，不起桥）：把"**已剥壳**的路径 + 是不是双链 + 本谱的工作区段 + 工作区根"
 * 翻译成**宿主请求**的形状。
 *
 * @returns `{ kind:'link' }` = 交给宿主的链接解析；`{ kind:'rel' }` = 工作区相对路径段；`null` = 不合法
 */
export function vaultAssetTarget(
  path: string,
  link: boolean,
  noteSegs: readonly string[],
  root: string,
): { kind: 'link'; link: string; source: string } | { kind: 'rel'; segs: string[] } | null {
  if (path === '') return null
  if (link) return { kind: 'link', link: path, source: vaultSourcePathOf(root, noteSegs) }
  // 只有目录没有文件名（`img/`）⇒ 早一步拒：否则会被当成"名叫 img 的文件"，靠宿主那头才报错
  if (path.endsWith('/')) return null
  // 任何位置的上跳段都拒（`../x.png`、`img/../x.png`、`img/..` —— 最后那种会把 `..` 落到"文件名"位上）
  if (path.split('/').includes('..')) return null
  const { dirs, name } = splitAssetPath(path)
  if (name === '') return null
  // 本谱所在目录 + 图片自己的子目录（与桌面端工作区那条同一算式）
  return { kind: 'rel', segs: [...noteSegs.slice(0, -1), ...dirs, name] }
}

/** 嵌入版读图：走宿主桥的 `readAsset` op */
export const vaultAssetReader: AssetReader = async (path, base, opts = { link: false }) => {
  if (base.kind !== 'workspace') return null
  const br = hostBridge()
  if (br === null) return null
  // ⚠ `path` 已经被 `resolveAsset` 剥过壳 ⇒ "是不是双链"只能靠 `opts.link`（见 `AssetReader` 的说明）
  const target = vaultAssetTarget(path, opts.link, base.segs, br.welcome.root)
  if (target === null) return null
  if (target.kind === 'link') return br.readLinkedAsset(target.link, target.source)
  return br.readAsset(target.segs)
}
