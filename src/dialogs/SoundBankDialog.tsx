/**
 * dialogs/SoundBankDialog.tsx — 音色库管理（adj331/332/342）
 *
 * SpessaSynth 高保真为默认音源（SF2 内置本地，随应用提供，离线可用）：
 *  - 库行：展开查看库内全部 GM 音色（128 种）+「全选/全消」+「内置」标识（无需下载/删除）
 *  - 音色勾选进入试听列表（playbackHqEnabled）
 *  - 「导入/导出音色文件」（SF2/SF3 本体，供不便联网用户导入/分享）+「导入/导出收藏配置」（JSON）
 */
import { useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useUiStore } from '../store/uiStore'
import { HQ_LIBRARIES, GM_VOICE_OPTIONS } from '../playback/spessaSynthBackend'
import { createHqCache } from '../playback/spessaCache'

const HIGHLIGHT = 'var(--jp-text-muted)'
const BTN = { padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' as const, background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: '6px' }

export function SoundBankDialog() {
  const hqCache = useRef(createHqCache())
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ [HQ_LIBRARIES[0]?.id ?? 'generaluser_gs']: true }))
  const enabled = useUiStore((s) => s.playbackHqEnabled)
  const toggle = useUiStore((s) => s.togglePlaybackHqVoice)
  const hqLibrary = useUiStore((s) => s.playbackHqLibrary)
  const hqVoice = useUiStore((s) => s.playbackHqVoice)
  const setPlaybackHqLibrary = useUiStore((s) => s.setPlaybackHqLibrary)
  const setPlaybackHqVoice = useUiStore((s) => s.setPlaybackHqVoice)
  const setPlaybackHqEnabled = useUiStore((s) => s.setPlaybackHqEnabled)
  const fileRef = useRef<HTMLInputElement>(null)
  const fileSf2Ref = useRef<HTMLInputElement>(null)
  const currentHqLib = HQ_LIBRARIES[0]

  // adj342：全选/全消（SpessaSynth GM 全集）
  const selectAll = () => setPlaybackHqEnabled(GM_VOICE_OPTIONS.map((v) => v.program))
  const clearAll = () => setPlaybackHqEnabled([])

  // 导入/导出「音色收藏配置」（JSON）
  const exportConfig = () => {
    const data = { version: 1, hqEnabled: enabled, hqLibrary, hqVoice }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ijipu-soundbanks.json'
    a.click()
    URL.revokeObjectURL(url)
    setNotice('✓ 已导出音色配置')
  }
  const importConfig = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const j = JSON.parse(String(reader.result))
        if (Array.isArray(j.hqEnabled)) setPlaybackHqEnabled(j.hqEnabled)
        if (typeof j.hqLibrary === 'string') setPlaybackHqLibrary(j.hqLibrary)
        if (j.hqVoice === null || typeof j.hqVoice === 'number') setPlaybackHqVoice(j.hqVoice ?? null)
        setNotice('✓ 已导入音色配置')
      } catch {
        setNotice('导入文件格式无效')
      }
    }
    reader.readAsText(file)
  }
  // 导入/导出「音色数据文件」（SF2/SF3 本体）——给不便联网用户导入/分享
  const importDataFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        await hqCache.current.save(currentHqLib.id, reader.result as ArrayBuffer)
        setNotice(`✓ 已导入音色数据 → ${currentHqLib.name}`)
      } catch {
        setNotice('音色数据文件读取失败')
      }
    }
    reader.readAsArrayBuffer(file)
  }
  const exportDataFile = async () => {
    try {
      const ab = await hqCache.current.load(currentHqLib.id)
      if (!ab) {
        setNotice('该音色库未缓存，无法导出')
        return
      }
      const blob = new Blob([ab], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${currentHqLib.id}.sf2`
      a.click()
      URL.revokeObjectURL(url)
      setNotice(`✓ 已导出音色数据：${currentHqLib.name}`)
    } catch {
      setNotice('音色数据导出失败')
    }
  }

  /** 库行：展开 + 名称 + 类型 + 体积 + 内置 + 全选/全消 + 展开音色列表 */
  const bankRow = (id: string, name: string, size: number, typeLabel: string) => {
    const isOpen = !!open[id]
    return (
      <div key={id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--jp-border)' }}>
          <button className="btn" style={{ ...BTN, padding: '2px 4px' }} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
            {isOpen ? '▾' : '▸'}
          </button>
          <span style={{ flex: 1, minWidth: 0 }}>{name}</span>
          <span style={{ color: HIGHLIGHT, fontSize: 11, flexShrink: 0 }}>{typeLabel}</span>
          <span style={{ color: HIGHLIGHT, fontSize: 11, flexShrink: 0 }}>{(size / 1_000_000).toFixed(1)}MB · 内置</span>
          <button className="btn" style={BTN} onClick={selectAll}>全选</button>
          <button className="btn" style={BTN} onClick={clearAll}>全消</button>
        </div>
        {isOpen && (
          <div style={{ marginLeft: 20, maxHeight: 300, overflow: 'auto', borderLeft: '1px solid var(--jp-border)', paddingLeft: 8, marginBottom: 6 }}>
            <div style={{ color: HIGHLIGHT, fontSize: 11, marginBottom: 2 }}>库内音色（{GM_VOICE_OPTIONS.length} 种）· 勾选进入试听列表（已选 {enabled.length}）</div>
            {GM_VOICE_OPTIONS.map((v) => (
              <label key={v.program} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, lineHeight: 1.7, color: 'var(--jp-text-primary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={enabled.includes(v.program)} onChange={() => toggle(v.program)} />
                {v.label}
              </label>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Modal title="音色库管理" maskDim={0.35} closeOnMaskClick compact>
      <div style={{ fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" style={BTN} onClick={exportConfig}>导出收藏</button>
          <button className="btn" style={BTN} onClick={() => fileRef.current?.click()}>导入收藏</button>
          <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => fileSf2Ref.current?.click()}>导入音色文件</button>
          <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => void exportDataFile()}>导出音色文件</button>
          <span style={{ color: HIGHLIGHT, fontSize: 11 }}>收藏=启用音色+音源/音色配置；音色文件=SF2/SF3 本体（供不便联网用户导入/分享）。</span>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importConfig(f); e.target.value = '' }} />
          <input ref={fileSf2Ref} type="file" accept=".sf2,.sf3" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importDataFile(f); e.target.value = '' }} />
        </div>
        <div style={{ color: HIGHLIGHT, fontSize: 11 }}>
          SpessaSynth 高保真为默认音源（SF2 内置本地、离线可用）；音色已随应用提供，无需联网下载。
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>SpessaSynth 高保真（SF2/SF3，多力度层，GM 全集）</div>
          {HQ_LIBRARIES.map((l) => bankRow(l.id, l.name, l.sizeBytes, '高保真'))}
        </div>
        {notice && <div style={{ color: notice.startsWith('✓') ? 'var(--jp-text-primary)' : 'var(--jp-danger)', fontSize: 11 }}>{notice}</div>}
      </div>
    </Modal>
  )
}
