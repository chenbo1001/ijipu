/**
 * export/video/cardTemplateZip.ts — 卡片模板的 zip 打包/解包（adj1075）
 *
 * 用户要求：模板能另存为 zip 整体打包，也能导入，方便迁移/交流。
 * 约束：**不新增第三方依赖**。ZIP 读写器已抽到 `src/export/zip.ts`（本应用配置导出也用它）。
 *
 * 包内容：
 *   card.json       —— `CardStyle`（backgroundImage 置 null，图片单独放）
 *   background.*    —— 可选，扩展名跟 data URL 的 MIME 走
 *   README.txt      —— 应用/导入说明，方便别人打开 zip 时看得懂
 */
import { normalizeCardStyle, type CardStyle } from './cardTemplates'
import { base64ToBytes, bytesToBase64, readZip, writeZip, type ZipEntry } from '../zip'

const ENC = new TextEncoder()
const DEC = new TextDecoder()

interface ParsedDataUrl {
  mime: string
  ext: string
  bytes: Uint8Array
}

function parseDataUrl(url: string): ParsedDataUrl | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url)
  if (!m) return null
  const mime = m[1] || 'image/png'
  const ext = mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] || 'png').toLowerCase()
  return {
    mime,
    ext,
    bytes: m[2] ? base64ToBytes(m[3]) : ENC.encode(decodeURIComponent(m[3])),
  }
}

/** 把一份卡片样式打成 zip（背景图单独存 background.*） */
export function createCardTemplateZip(style: CardStyle): Uint8Array {
  const files: ZipEntry[] = []
  const { backgroundImage, ...rest } = style
  files.push({
    name: 'card.json',
    data: ENC.encode(JSON.stringify({ ...rest, backgroundImage: null }, null, 2)),
  })
  const image = backgroundImage ? parseDataUrl(backgroundImage) : null
  if (image) files.push({ name: `background.${image.ext}`, data: image.bytes })
  files.push({
    name: 'README.txt',
    data: ENC.encode(
      [
        `爱记谱 iJipu 动态谱卡片模板：${style.name || '自定义'}`,
        '导入：应用 → 动态谱视频相机位 → 卡片「自定义…」→「导入模板 zip」。',
        'card.json 是样式，background.* 是背景图，可直接改 JSON 后重新打包。',
      ].join('\n'),
    ),
  })
  return writeZip(files)
}

/** 读 zip → 卡片样式；背景图还原成 data URL */
export function readCardTemplateZip(zip: Uint8Array): CardStyle {
  const entries = readZip(zip)
  const card = entries.get('card.json')
  if (!card) throw new Error('zip 里没有 card.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(DEC.decode(card))
  } catch {
    throw new Error('card.json 不是有效 JSON')
  }
  const style = normalizeCardStyle(parsed as Partial<CardStyle>)
  const imageName = [...entries.keys()].find((n) => /^background\.(png|jpe?g|webp|gif)$/i.test(n))
  if (imageName) {
    const ext = (imageName.split('.').pop() || 'png').toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
    style.backgroundImage = `data:${mime};base64,${bytesToBase64(entries.get(imageName)!)}`
  }
  return style
}
