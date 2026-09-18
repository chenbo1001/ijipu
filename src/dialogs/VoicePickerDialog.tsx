/**
 * dialogs/VoicePickerDialog.tsx — 试听音色选择对话框（adj509：从音色库内联展开拆出）
 *
 * 原 SoundBankPanel 内嵌的「库内音色（128 种）」展开列表被移到这里——
 * · 在音色库面板里点「指定音色」按钮即弹出本对话框（独立浮窗，遮罩 + 标题栏 + ✕）；
 * · 顶部给「全选 / 全消 / 反选 / 搜索」四个快捷操作，主体是 128 种 GM 音色复选框列表
 *   （按 GM 音色类别「钢琴/打击/风琴/吉他/贝斯/弦乐/铜管/簧管/笛/合成」分 10 组展开，每组
 *   单独有「选本组 / 消本组」），底部一行汇总已选数。
 * · 属**本机用户偏好（L1）**：与库行的 playbackHqEnabled 同源，不随谱保存。
 */
import { useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useUiStore } from '../store/uiStore'
import { voicePickerCopy } from '../brand/copy'
import { GM_VOICE_OPTIONS } from '../playback/spessaSynthBackend'
import type { GmVoice } from '@ijipu/engine'

/** GM 音色按 program 0-127 分为 10 大类（沿用 GM 标准 1=钢琴家族，每类 8 段） */
const GM_GROUPS: { title: string; range: [number, number] }[] = [
  { title: '钢琴家族（Piano）', range: [0, 7] },
  { title: '色彩打击乐（Chromatic Percussion）', range: [8, 15] },
  { title: '风琴（Organ）', range: [16, 23] },
  { title: '吉他（Guitar）', range: [24, 31] },
  { title: '贝斯（Bass）', range: [32, 39] },
  { title: '弦乐（Strings）', range: [40, 47] },
  { title: '合奏/合唱（Ensemble）', range: [48, 55] },
  { title: '铜管（Brass）', range: [56, 63] },
  { title: '簧管/双簧管（Reed）', range: [64, 71] },
  { title: '笛管（Pipe）', range: [72, 79] },
  { title: '合成领奏/垫音/效果（Synth）', range: [80, 95] },
  { title: '民族/其它（Ethnic / Others）', range: [96, 111] },
  { title: '打击乐（Percussive）', range: [112, 119] },
  { title: '声音效果（Sound Effects）', range: [120, 127] },
]

const HIGHLIGHT = 'var(--jp-text-muted)'

export function VoicePickerDialog() {
  const enabled = useUiStore((s) => s.playbackHqEnabled)
  const toggle = useUiStore((s) => s.togglePlaybackHqVoice)
  const setPlaybackHqEnabled = useUiStore((s) => s.setPlaybackHqEnabled)
  const closeModal = useUiStore((s) => s.closeModal)
  /** 关键词过滤（按音色中文名包含即留空） */
  const [keyword, setKeyword] = useState('')
  /** 折叠/展开状态：默认全展开 */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const searchRef = useRef<HTMLInputElement | null>(null)

  /** 按关键词过滤后的音色表（不分组；用于平铺视图） */
  const filtered = useMemo(() => {
    const k = keyword.trim()
    if (!k) return GM_VOICE_OPTIONS
    return GM_VOICE_OPTIONS.filter((v) => v.label.includes(k))
  }, [keyword])

  /** 顶部四个快捷操作 */
  const selectAll = () => setPlaybackHqEnabled(GM_VOICE_OPTIONS.map((v) => v.program))
  const clearAll = () => setPlaybackHqEnabled([])
  const invert = () => {
    const set = new Set(enabled)
    setPlaybackHqEnabled(GM_VOICE_OPTIONS.map((v) => v.program).filter((p) => !set.has(p)))
  }

  /** 单组「选本组 / 消本组」——按当前 group.range 内的 program 算 */
  const selectGroup = (range: [number, number]) => {
    const programs = GM_VOICE_OPTIONS.filter((v) => v.program >= range[0] && v.program <= range[1]).map((v) => v.program)
    const set = new Set(enabled)
    setPlaybackHqEnabled([...enabled, ...programs.filter((p) => !set.has(p))])
  }
  const clearGroup = (range: [number, number]) => {
    setPlaybackHqEnabled(enabled.filter((p) => p < range[0] || p > range[1]))
  }

  /** 渲染单条音色复选项 */
  const row = (v: GmVoice) => (
    <label
      key={v.program}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        lineHeight: 1.7,
        color: 'var(--jp-text-primary)',
        cursor: 'pointer',
        padding: '1px 4px',
        borderRadius: 4,
      }}
    >
      <input type="checkbox" checked={enabled.includes(v.program)} onChange={() => toggle(v.program)} />
      <span style={{ color: HIGHLIGHT, fontSize: 10, width: 28, flexShrink: 0, fontFamily: 'var(--jp-font-mono)' }}>
        {String(v.program).padStart(3, '0')}
      </span>
      <span>{v.label}</span>
    </label>
  )

  return (
    <Modal
      title={voicePickerCopy.title}
      width="min(560px, 100%)"
      onClose={() => closeModal()}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        {/* 顶部工具条：快捷操作 + 搜索框 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" style={btnStyle} onClick={selectAll}>{voicePickerCopy.selectAll}</button>
          <button className="btn" style={btnStyle} onClick={clearAll}>{voicePickerCopy.clearAll}</button>
          <button className="btn" style={btnStyle} onClick={invert}>{voicePickerCopy.invert}</button>
          <input
            ref={searchRef}
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={voicePickerCopy.searchPlaceholder}
            style={{
              flex: '1 1 120px',
              minWidth: 120,
              padding: '4px 8px',
              fontSize: 12,
              background: 'var(--jp-bg-app)',
              border: '1px solid var(--jp-border)',
              borderRadius: 6,
              color: 'var(--jp-text-primary)',
              fontFamily: 'inherit',
            }}
          />
        </div>
        <div style={{ color: HIGHLIGHT, fontSize: 11 }}>
          {voicePickerCopy.summary(enabled.length, GM_VOICE_OPTIONS.length)}
        </div>

        {/* 主体：分组列表（无关键词时）或平铺列表（有过滤时） */}
        <div style={{ maxHeight: 'min(420px, 60vh)', overflow: 'auto', border: '1px solid var(--jp-border)', borderRadius: 6, padding: '4px 6px' }}>
          {keyword.trim() ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px' }}>{filtered.map(row)}</div>
          ) : (
            GM_GROUPS.map((g) => {
              const isCollapsed = !!collapsed[g.title]
              const groupVoices = GM_VOICE_OPTIONS.filter((v) => v.program >= g.range[0] && v.program <= g.range[1])
              const selectedInGroup = groupVoices.filter((v) => enabled.includes(v.program)).length
              return (
                <div key={g.title} style={{ marginBottom: 4 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '2px 4px',
                      cursor: 'pointer',
                      userSelect: 'none',
                      color: 'var(--jp-text-secondary)',
                      fontSize: 12,
                    }}
                    onClick={() => setCollapsed((c) => ({ ...c, [g.title]: !c[g.title] }))}
                  >
                    <span style={{ width: 12, flexShrink: 0 }}>{isCollapsed ? '▸' : '▾'}</span>
                    <span style={{ flex: 1 }}>{g.title}</span>
                    <span style={{ color: HIGHLIGHT, fontSize: 11 }}>
                      {selectedInGroup}/{groupVoices.length}
                    </span>
                    {!isCollapsed && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn"
                          style={{ ...btnStyle, fontSize: 10, padding: '1px 6px' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            selectGroup(g.range)
                          }}
                        >
                          {voicePickerCopy.selectGroup}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          style={{ ...btnStyle, fontSize: 10, padding: '1px 6px' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            clearGroup(g.range)
                          }}
                        >
                          {voicePickerCopy.clearGroup}
                        </button>
                      </span>
                    )}
                  </div>
                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', paddingLeft: 18, paddingBottom: 2 }}>
                      {groupVoices.map(row)}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
          <button className="btn primary" style={btnPrimary} onClick={() => closeModal()}>
            {voicePickerCopy.done}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const btnStyle = {
  padding: '4px 10px',
  fontSize: 12,
  whiteSpace: 'nowrap' as const,
  background: 'var(--jp-bg-app)',
  border: '1px solid var(--jp-border)',
  color: 'var(--jp-text-primary)',
  borderRadius: '6px',
}

const btnPrimary = {
  padding: '5px 14px',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap' as const,
  background: 'var(--jp-accent)',
  border: '1px solid var(--jp-accent)',
  color: '#101010',
  borderRadius: '6px',
}