/**
 * dialogs/VoicePickerDialog.tsx — 试听音色选择对话框（adj509 拆出；adj1012 改为**按当前库**列音色）
 *
 * ## adj1012 改了什么
 *
 * 旧版列的是引擎里那张**写死的 GM 128 条中文名**，与"当前用哪个库"无关 ⇒ 切了库，名字还是老库的。
 * 现在数据源是**当前库的预设表**（`libs` 表里的 `presets`，只取 bank 0）：
 *  · 每行显示 `GM 中文名 · 本库原始名`（`073 长笛 · Flute`）——中文名是**谱面能写的名字**，
 *    原始名是**这个库里实际叫什么**，两者都要能看到；
 *  · 本库没有的 program ⇒ 不出现（不是灰掉：灰 128 行里的大半反而更难找）；
 *  · 库里音色表还没读到（未下载/未导入）⇒ 回退 GM 标准 128 个，并在顶部如实说明。
 *
 * 勾选仍然存 **program**（语义层，跨库稳定，`Y:` 的解析不受影响）；存哪一份由 store 的
 * `enabledVoicesOf` 决定 —— **每个库一套**。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useUiStore, enabledVoicesOf } from '../store/uiStore'
import { voicePickerCopy } from '../brand/copy'
import { GM_VOICE_OPTIONS, resolveActiveLibrary } from '../playback/spessaSynthBackend'
import { createBankRegistry, type BankRecord } from '../playback/bankRegistry'
import { GM_GROUPS } from '@ijipu/engine'

const HIGHLIGHT = 'var(--jp-text-muted)'

/** 一行可选音色 */
interface PickerRow {
  program: number
  /** GM 中文名（谱面 `Y:` 能写的那个名字） */
  zh: string
  /** 本库原始名（可能没有：音色表没读到时） */
  libName?: string
}

/** program → 中文名（去掉显示编号，如 `73 长笛` → `长笛`） */
function zhNameOf(program: number): string {
  const v = GM_VOICE_OPTIONS.find((x) => x.program === program)
  return v ? v.label.replace(/^\d+\s+/, '') : `音色 ${program}`
}

export function VoicePickerDialog() {
  const enabled = useUiStore(enabledVoicesOf)
  const hqLibrary = useUiStore((s) => s.playbackHqLibrary)
  const toggle = useUiStore((s) => s.togglePlaybackHqVoice)
  const setPlaybackHqEnabled = useUiStore((s) => s.setPlaybackHqEnabled)
  const closeModal = useUiStore((s) => s.closeModal)
  const [keyword, setKeyword] = useState('')
  /** 折叠/展开状态：默认全展开 */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const searchRef = useRef<HTMLInputElement | null>(null)
  /** adj1012：当前库的元数据（含预设表）；null = 还没读到 */
  const [record, setRecord] = useState<BankRecord | null>(null)
  const active = useMemo(() => resolveActiveLibrary(hqLibrary), [hqLibrary])
  const lib = active.lib
  const registry = useRef(createBankRegistry())

  useEffect(() => {
    let alive = true
    void registry.current.get(lib.id).then((r) => {
      if (alive) setRecord(r)
    })
    return () => {
      alive = false
    }
  }, [lib.id])

  /** 本库可选音色：有预设表就用它（只 bank 0），否则回退 GM 标准 128 个 */
  const rows = useMemo<PickerRow[]>(() => {
    const bank0 = record ? record.presets.filter((p) => p.bank === 0) : []
    if (bank0.length > 0) {
      return bank0
        .map((p) => ({ program: p.program, zh: zhNameOf(p.program), libName: p.name }))
        .sort((a, b) => a.program - b.program)
    }
    return GM_VOICE_OPTIONS.map((v) => ({ program: v.program, zh: zhNameOf(v.program) }))
  }, [record])

  /** 按关键词过滤（中文名或本库原名，大小写不敏感） */
  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return rows
    return rows.filter((r) => r.zh.toLowerCase().includes(k) || (r.libName ?? '').toLowerCase().includes(k))
  }, [rows, keyword])

  /** 顶部三个快捷操作——**只作用于本库可选的 program**（不能把库里没有的勾进来） */
  const selectAll = () => setPlaybackHqEnabled(rows.map((r) => r.program))
  const clearAll = () => setPlaybackHqEnabled([])
  const invert = () => {
    const set = new Set(enabled)
    setPlaybackHqEnabled(rows.map((r) => r.program).filter((p) => !set.has(p)))
  }

  /** 单组「选本组 / 消本组」——按当前行集和 GM 分组区间算 */
  const groupRows = (range: [number, number]): PickerRow[] =>
    rows.filter((r) => r.program >= range[0] && r.program <= range[1])
  const selectGroup = (range: [number, number]) => {
    const set = new Set(enabled)
    setPlaybackHqEnabled([...enabled, ...groupRows(range).map((r) => r.program).filter((p) => !set.has(p))])
  }
  const clearGroup = (range: [number, number]) => {
    setPlaybackHqEnabled(enabled.filter((p) => p < range[0] || p > range[1]))
  }

  /** 渲染单条音色复选项（双行：中文名 + 本库原始名） */
  const row = (v: PickerRow) => (
    <label
      key={v.program}
      style={{
        display: 'flex',
        alignItems: 'baseline',
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
      <span>{v.zh}</span>
      {v.libName && (
        <span style={{ color: HIGHLIGHT, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          · {v.libName}
        </span>
      )}
    </label>
  )

  return (
    <Modal title={voicePickerCopy.title} width="min(560px, 100%)" onClose={() => closeModal()}>
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
          {voicePickerCopy.summary(enabled.length, rows.length, lib.name)}
        </div>
        {/* adj1012：本库音色表还没读到 ⇒ 如实说明下面是 GM 标准名（而不是假装这就是本库的音色） */}
        {!record && <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>{voicePickerCopy.fallbackHint}</div>}

        {/* 主体：分组列表（无关键词时）或平铺列表（有过滤时） */}
        <div style={{ maxHeight: 'min(420px, 60vh)', overflow: 'auto', border: '1px solid var(--jp-border)', borderRadius: 6, padding: '4px 6px' }}>
          {keyword.trim() ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px' }}>{filtered.map(row)}</div>
          ) : (
            GM_GROUPS.map((g) => {
              const groupVoices = groupRows(g.range)
              // 本库缺这个音色组时整组不显示（空组只是噪音）
              if (groupVoices.length === 0) return null
              const isCollapsed = !!collapsed[g.title]
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
