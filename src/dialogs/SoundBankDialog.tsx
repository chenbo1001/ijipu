/**
 * dialogs/SoundBankDialog.tsx — 音色库管理（adj331/adj332）
 *
 * 用层级列表统一管理试听用到的所有音色库：
 *  - SpessaSynth 高保真（HQ_LIBRARIES，SF2/SF3 ArrayBuffer 缓存）——可展开查看库内全部 GM 音色（128 种）
 *  - midi-js 标准采样（SAMPLER_LIBRARIES，文本缓存）——单乐器库
 * 每个库支持联网下载（写入缓存）、删除缓存，展示缓存状态。
 */
import { useEffect, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useUiStore } from '../store/uiStore'
import { SAMPLER_LIBRARIES, getSamplerLibrary } from '@ijipu/engine'
import { HQ_LIBRARIES, getHqLibrary, GM_VOICE_OPTIONS } from '../playback/spessaSynthBackend'
import { createSamplerCache, prefetchLibrary, libraryCached } from '../playback/samplerCache'
import { createHqCache, prefetchHqLibrary, hqLibraryCached } from '../playback/spessaCache'

const HIGHLIGHT = 'var(--jp-text-muted)'
const BTN = { padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' as const, background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: '6px' }

export function SoundBankDialog() {
  const samplerCache = useRef(createSamplerCache())
  const hqCache = useRef(createHqCache())
  const [states, setStates] = useState<Record<string, 'cached' | 'notcached'>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // adj332：已启用音色集合（试听只列这些）与切换
  const enabled = useUiStore((s) => s.playbackHqEnabled)
  const toggle = useUiStore((s) => s.togglePlaybackHqVoice)

  const refresh = async () => {
    const s: Record<string, 'cached' | 'notcached'> = {}
    for (const l of SAMPLER_LIBRARIES) s[l.id] = (await libraryCached(l, samplerCache.current)) ? 'cached' : 'notcached'
    for (const l of HQ_LIBRARIES) s[l.id] = (await hqLibraryCached(l, hqCache.current)) ? 'cached' : 'notcached'
    setStates(s)
  }
  useEffect(() => {
    void refresh()
  }, [])

  const download = async (kind: 'midi' | 'hq', id: string) => {
    setBusy(id)
    setNotice(null)
    try {
      if (kind === 'midi') await prefetchLibrary(getSamplerLibrary(id), samplerCache.current)
      else await prefetchHqLibrary(getHqLibrary(id), hqCache.current)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    }
    setBusy(null)
    void refresh()
  }
  const remove = async (kind: 'midi' | 'hq', id: string) => {
    setBusy(id)
    try {
      if (kind === 'midi') await samplerCache.current.remove(id)
      else await hqCache.current.remove(id)
    } catch {
      /* 忽略 */
    }
    setBusy(null)
    void refresh()
  }

  /** 库行（右侧缓存状态 + 下载/删除/展开） */
  const bankRow = (kind: 'midi' | 'hq', id: string, name: string, size: number, typeLabel: string, expandable: boolean) => {
    const st = states[id] ?? 'notcached'
    const isBusy = busy === id
    return (
      <div key={kind + id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--jp-border)' }}>
          {expandable && (
            <button className="btn" style={{ ...BTN, padding: '2px 4px' }} onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
              {open[id] ? '▾' : '▸'}
            </button>
          )}
          <span style={{ flex: 1, minWidth: 0 }}>{name}</span>
          <span style={{ color: HIGHLIGHT, fontSize: 11, flexShrink: 0 }}>{typeLabel}</span>
          <span style={{ color: HIGHLIGHT, fontSize: 11, width: 52, textAlign: 'right', flexShrink: 0 }}>{(size / 1_000_000).toFixed(1)}MB</span>
          <span style={{ color: st === 'cached' ? 'var(--jp-text-primary)' : HIGHLIGHT, fontSize: 11, width: 52, flexShrink: 0 }}>
            {st === 'cached' ? '✓ 已缓存' : '未缓存'}
          </span>
          <button className="btn" style={BTN} disabled={isBusy} onClick={() => void download(kind, id)}>
            {isBusy ? '…' : st === 'cached' ? '重下' : '下载'}
          </button>
          <button className="btn" style={{ ...BTN, color: 'var(--jp-danger)' }} disabled={isBusy || st !== 'cached'} onClick={() => void remove(kind, id)}>
            删除
          </button>
        </div>
        {expandable && open[id] && (
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
    <Modal title="音色库管理" maskDim={0.35} closeOnMaskClick>
      <div style={{ fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ color: HIGHLIGHT, fontSize: 11 }}>
          联网下载（缓存）后离线可用，可删除释放空间；高保真库可展开查看库内含有的全部音色。
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>SpessaSynth 高保真（SF2/SF3，多力度层，GM 全集）</div>
          {HQ_LIBRARIES.map((l) => bankRow('hq', l.id, l.name, l.sizeBytes, '高保真', true))}
        </div>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>标准采样（midi-js，单层，单乐器）</div>
          {SAMPLER_LIBRARIES.map((l) => bankRow('midi', l.id, l.name, l.sizeBytes, '标准', false))}
        </div>
        {notice && <div style={{ color: 'var(--jp-danger)', fontSize: 11 }}>✗ {notice}</div>}
      </div>
    </Modal>
  )
}
