/**
 * dialogs/CardStyleDialog.tsx — 自定义片头/片尾卡片（adj1074）
 *
 * 用户口径：卡片风格先放 L1（本机偏好，不写进 .jps）；做自定义；先有再优化。
 * 这里只编辑一份可序列化的 `CardStyle`，保存后交给 store，相机位/导出共用同一条渲染路径。
 *
 * 背景图片：读成 data URL 存进 `CardStyle.backgroundImage`（≤2.5MB）；
 * 渲染器会 cover 裁切并压一层主题色，保证标题/副标题在任意图上仍可读。
 */
import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { cardStyleCopy } from '../brand/copy'
import {
  CARD_TEMPLATES,
  cardStyleById,
  type CardStyle,
} from '../export/video/cardTemplates'
import { createCardTemplateZip, readCardTemplateZip } from '../export/video/cardTemplateZip'
import { useUiStore, type DynamicCardStyleId } from '../store/uiStore'

const MAX_IMAGE_BYTES = 2_500_000

/**
 * 系统“另存为”对话框的最小类型（File System Access API）。
 * 非 Chromium 内核 / 不支持该 API 的 WebView 会没有这个函数，走浏览器下载兜底。
 */
interface CardSaveHandle {
  name: string
  createWritable: () => Promise<{
    write: (data: ArrayBuffer) => Promise<void>
    close: () => Promise<void>
  }>
}
interface CardSavePickerOptions {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}
type CardSavePicker = (opts: CardSavePickerOptions) => Promise<CardSaveHandle>

const CARD_ZIP_NAME = 'ijipu-card.zip'

function cloneStyle(style: CardStyle): CardStyle {
  return {
    ...style,
    bg: [...style.bg],
    glow: [...style.glow],
    staff: { ...style.staff },
    watermark: { ...style.watermark },
    bracket: { ...style.bracket },
    title: { ...style.title },
    seal: style.seal ? { ...style.seal } : null,
  }
}

/** `#rgb` / `#rrggbb` / `rgb()` / `rgba()` → 颜色选择器要的 hex + 原 alpha */
function splitColor(value: string): { hex: string; alpha: number } {
  const rgba = /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?\s*\)$/i.exec(value.trim())
  if (rgba) {
    const hex = `#${[rgba[1], rgba[2], rgba[3]]
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')}`
    return { hex, alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) }
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return { hex: value, alpha: 1 }
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return {
      hex: `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`,
      alpha: 1,
    }
  }
  return { hex: '#000000', alpha: 1 }
}

function withAlpha(hex: string, alpha: number): string {
  if (alpha >= 1) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function ColorField({
  label,
  value,
  onChange,
  keepAlpha = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  keepAlpha?: boolean
}) {
  const { hex, alpha } = splitColor(value)
  return (
    <label className="card-style-color">
      <span>{label}</span>
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(keepAlpha ? withAlpha(e.target.value, alpha) : e.target.value)}
      />
    </label>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label className="card-style-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <em>{value.toFixed(2)}</em>
    </label>
  )
}

export function CardStyleDialog() {
  const current = useUiStore((s) => s.dynamicCardStyle)
  const custom = useUiStore((s) => s.dynamicCardStyleCustom)
  const setCustom = useUiStore((s) => s.setDynamicCardStyleCustom)
  const resetCustom = useUiStore((s) => s.resetDynamicCardStyleCustom)
  const closeModal = useUiStore((s) => s.closeModal)
  const [draft, setDraft] = useState<CardStyle>(() => cloneStyle(custom ?? cardStyleById(current)))
  const [base, setBase] = useState<DynamicCardStyleId>(current === 'custom' ? 'brand' : current)
  const [imageError, setImageError] = useState('')
  const [zipMsg, setZipMsg] = useState('')
  const [zipError, setZipError] = useState(false)

  const patch = (p: Partial<CardStyle>) => setDraft((d) => ({ ...d, ...p }))

  const applyBase = (id: DynamicCardStyleId) => {
    setBase(id)
    setImageError('')
    setDraft(cloneStyle(cardStyleById(id)))
  }

  const onPickImage = (file: File | null) => {
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(cardStyleCopy.imageTooLarge)
      return
    }
    setImageError('')
    const reader = new FileReader()
    reader.onload = () => {
      setDraft((d) => ({ ...d, backgroundImage: String(reader.result) }))
    }
    reader.readAsDataURL(file)
  }

  const exportZip = async () => {
    try {
      const bytes = createCardTemplateZip(draft)
      // TS 6 的 BlobPart 只认 ArrayBuffer；这里复制一份，避开 Uint8Array<ArrayBufferLike> 的类型冲突
      const buffer = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(buffer).set(bytes)

      // 优先系统“另存为”：让用户选目录和文件名，默认名已填好
      const picker = (window as unknown as { showSaveFilePicker?: CardSavePicker })
        .showSaveFilePicker
      if (typeof picker === 'function') {
        try {
          const handle = await picker({
            suggestedName: CARD_ZIP_NAME,
            types: [{ description: 'iJipu 卡片模板', accept: { 'application/zip': ['.zip'] } }],
          })
          const writable = await handle.createWritable()
          await writable.write(buffer)
          await writable.close()
          setZipError(false)
          setZipMsg(`${cardStyleCopy.exported}：${handle.name}`)
          return
        } catch (e) {
          if ((e as { name?: string } | null)?.name === 'AbortError') {
            setZipError(false)
            setZipMsg(cardStyleCopy.cancelled)
            return
          }
          // 权限/不支持该 API → 退回浏览器下载（不能再谎报“已保存”）
        }
      }

      const blob = new Blob([buffer], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = CARD_ZIP_NAME
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setZipError(false)
      setZipMsg(cardStyleCopy.exported)
    } catch (e) {
      setZipError(true)
      setZipMsg(e instanceof Error ? e.message : String(e))
    }
  }

  const onPickZip = async (file: File | null) => {
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const style = readCardTemplateZip(bytes)
      setDraft({ ...style, id: 'custom', name: '自定义', description: '用户自定义卡片' })
      setZipError(false)
      setZipMsg(cardStyleCopy.imported)
    } catch (e) {
      setZipError(true)
      setZipMsg(e instanceof Error ? e.message : String(e))
    }
  }

  const save = () => {
    setCustom({ ...draft, id: 'custom', name: '自定义', description: '用户自定义卡片' })
    closeModal()
  }

  return (
    <Modal title={cardStyleCopy.title} fill width={620}>
      <div className="card-style-form">
        <div className="card-style-scroll">
        <p className="card-style-intro">{cardStyleCopy.intro}</p>

        <section className="card-style-section">
          <div className="card-style-grid">
            <label className="card-style-field">
              <span>{cardStyleCopy.base}</span>
              <select
                value={base}
                onChange={(e) => applyBase(e.target.value as DynamicCardStyleId)}
              >
                {CARD_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="card-style-field">
              <span>{cardStyleCopy.font}</span>
              <select
                value={draft.title.font}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    title: { ...d.title, font: e.target.value as CardStyle['title']['font'] },
                  }))
                }
              >
                <option value="score">{cardStyleCopy.fontScore}</option>
                <option value="serif">{cardStyleCopy.fontSerif}</option>
                <option value="sans">{cardStyleCopy.fontSans}</option>
              </select>
            </label>
          </div>
        </section>

        <section className="card-style-section">
          <h3>{cardStyleCopy.background}</h3>
          <div className="card-style-grid">
            <ColorField
              label={cardStyleCopy.bgTop}
              value={draft.bg[0]}
              onChange={(v) => patch({ bg: [v, draft.bg[1], draft.bg[2]] })}
            />
            <ColorField
              label={cardStyleCopy.bgMid}
              value={draft.bg[1]}
              onChange={(v) => patch({ bg: [draft.bg[0], v, draft.bg[2]] })}
            />
            <ColorField
              label={cardStyleCopy.bgBottom}
              value={draft.bg[2]}
              onChange={(v) => patch({ bg: [draft.bg[0], draft.bg[1], v] })}
            />
            <ColorField
              label={cardStyleCopy.accent}
              value={draft.accent}
              onChange={(v) => patch({ accent: v })}
            />
          </div>
        </section>

        <section className="card-style-section">
          <h3>{cardStyleCopy.textColors}</h3>
          <div className="card-style-grid">
            <ColorField
              label={cardStyleCopy.titleFrom}
              value={draft.title.from}
              onChange={(v) => setDraft((d) => ({ ...d, title: { ...d.title, from: v } }))}
            />
            <ColorField
              label={cardStyleCopy.titleTo}
              value={draft.title.to}
              onChange={(v) => setDraft((d) => ({ ...d, title: { ...d.title, to: v } }))}
            />
            <ColorField
              label={cardStyleCopy.subtitle}
              value={draft.subtitle}
              keepAlpha
              onChange={(v) => patch({ subtitle: v })}
            />
            <ColorField
              label={cardStyleCopy.author}
              value={draft.author}
              keepAlpha
              onChange={(v) => patch({ author: v })}
            />
            <ColorField
              label={cardStyleCopy.info}
              value={draft.info}
              keepAlpha
              onChange={(v) => patch({ info: v })}
            />
            <ColorField
              label={cardStyleCopy.brand}
              value={draft.brand}
              keepAlpha
              onChange={(v) => patch({ brand: v })}
            />
            <ColorField
              label={cardStyleCopy.url}
              value={draft.url}
              keepAlpha
              onChange={(v) => patch({ url: v })}
            />
          </div>
        </section>

        <section className="card-style-section">
          <h3>{cardStyleCopy.watermark}</h3>
          <div className="card-style-grid">
            <label className="card-style-field">
              <span>{cardStyleCopy.watermarkIntro}</span>
              <input
                type="text"
                maxLength={2}
                value={draft.watermark.intro}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    watermark: { ...d.watermark, intro: e.target.value },
                  }))
                }
              />
            </label>
            <label className="card-style-field">
              <span>{cardStyleCopy.watermarkEnd}</span>
              <input
                type="text"
                maxLength={2}
                value={draft.watermark.end}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, watermark: { ...d.watermark, end: e.target.value } }))
                }
              />
            </label>
            <ColorField
              label={cardStyleCopy.watermarkColor}
              value={draft.watermark.color}
              onChange={(v) =>
                setDraft((d) => ({ ...d, watermark: { ...d.watermark, color: v } }))
              }
            />
          </div>
          <div className="card-style-row">
            <RangeField
              label={cardStyleCopy.watermarkAlpha}
              value={draft.watermark.alpha}
              min={0}
              max={0.2}
              step={0.005}
              onChange={(v) =>
                setDraft((d) => ({ ...d, watermark: { ...d.watermark, alpha: v } }))
              }
            />
            <RangeField
              label={cardStyleCopy.watermarkScale}
              value={draft.watermark.scale}
              min={0.2}
              max={0.9}
              step={0.01}
              onChange={(v) =>
                setDraft((d) => ({ ...d, watermark: { ...d.watermark, scale: v } }))
              }
            />
          </div>
        </section>

        <section className="card-style-section">
          <h3>{cardStyleCopy.effects}</h3>
          <div className="card-style-row">
            <label className="card-style-check">
              <input
                type="checkbox"
                checked={draft.particles}
                onChange={(e) => patch({ particles: e.target.checked })}
              />
              <span>{cardStyleCopy.particles}</span>
            </label>
            <label className="card-style-check">
              <input
                type="checkbox"
                checked={draft.sweep}
                onChange={(e) => patch({ sweep: e.target.checked })}
              />
              <span>{cardStyleCopy.sweep}</span>
            </label>
            <label className="card-style-check">
              <input
                type="checkbox"
                checked={draft.motion}
                onChange={(e) => patch({ motion: e.target.checked })}
              />
              <span>{cardStyleCopy.motion}</span>
            </label>
          </div>
          <div className="card-style-row">
            <RangeField
              label={cardStyleCopy.staffAlpha}
              value={draft.staff.alpha}
              min={0}
              max={0.12}
              step={0.005}
              onChange={(v) => setDraft((d) => ({ ...d, staff: { ...d.staff, alpha: v } }))}
            />
            <RangeField
              label={cardStyleCopy.vignette}
              value={draft.vignette}
              min={0}
              max={0.8}
              step={0.02}
              onChange={(v) => patch({ vignette: v })}
            />
          </div>
        </section>

        <section className="card-style-section">
          <h3>{cardStyleCopy.seal}</h3>
          <div className="card-style-row">
            <label className="card-style-check">
              <input
                type="checkbox"
                checked={!!draft.seal}
                onChange={(e) =>
                  patch({
                    seal: e.target.checked
                      ? { text: draft.seal?.text || '谱', color: draft.seal?.color || draft.accent }
                      : null,
                  })
                }
              />
              <span>{cardStyleCopy.seal}</span>
            </label>
            {draft.seal && (
              <>
                <label className="card-style-field">
                  <span>{cardStyleCopy.sealText}</span>
                  <input
                    type="text"
                    maxLength={2}
                    value={draft.seal.text}
                    onChange={(e) =>
                      patch({ seal: { ...draft.seal!, text: e.target.value } })
                    }
                  />
                </label>
                <ColorField
                  label={cardStyleCopy.sealColor}
                  value={draft.seal.color}
                  onChange={(v) => patch({ seal: { ...draft.seal!, color: v } })}
                />
              </>
            )}
          </div>
        </section>

        <section className="card-style-section">
          <h3>{cardStyleCopy.backgroundImage}</h3>
          <div className="card-style-image">
            {draft.backgroundImage ? (
              <img src={draft.backgroundImage} alt={cardStyleCopy.backgroundImage} />
            ) : (
              <span>{cardStyleCopy.imageHint}</span>
            )}
          </div>
          <div className="card-style-row">
            <label className="btn card-style-file">
              {cardStyleCopy.chooseImage}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
              />
            </label>
            {draft.backgroundImage && (
              <button
                type="button"
                className="btn"
                onClick={() => patch({ backgroundImage: null })}
              >
                {cardStyleCopy.clearImage}
              </button>
            )}
          </div>
          {imageError && <p className="card-style-error">{imageError}</p>}
        </section>

        <section className="card-style-section">
          <h3>{cardStyleCopy.migrate}</h3>
          <div className="card-style-row">
            <button type="button" className="btn" onClick={exportZip}>
              {cardStyleCopy.exportZip}
            </button>
            <label className="btn card-style-file">
              {cardStyleCopy.importZip}
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => void onPickZip(e.target.files?.[0] ?? null)}
              />
            </label>
            {zipMsg && (
              <span className={zipError ? 'card-style-error' : 'card-style-ok'}>{zipMsg}</span>
            )}
          </div>
          <p className="card-style-intro">{cardStyleCopy.migrateHint}</p>
        </section>
        </div>

        <div className="card-style-footer">
          <button type="button" className="btn" onClick={() => applyBase(base)}>
            {cardStyleCopy.reset}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              resetCustom()
              closeModal()
            }}
          >
            {cardStyleCopy.resetAll}
          </button>
          <button type="button" className="btn" onClick={closeModal}>
            {cardStyleCopy.cancel}
          </button>
          <button type="button" className="btn card-style-save" onClick={save}>
            {cardStyleCopy.save}
          </button>
        </div>
      </div>
    </Modal>
  )
}
