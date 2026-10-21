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
import { GM_GROUPS, ETHNIC_ALIASES, ethnicLabel, ethnicGmLabel } from '@ijipu/engine'

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
  /**
   * adj1028（用户 2026-10-21）：页签 —— 默认页签是**原音色清单**，
   * 新页签「民族乐器（拟）」是**同样可勾选**的一组名字；勾了才在脚本里生效。
   */
  const [tab, setTab] = useState<'lib' | 'ethnic'>('lib')
  const ethnicEnabled = useUiStore((s) => s.ethnicVoicesEnabled)
  const setEthnicEnabled = useUiStore((s) => s.setEthnicVoicesEnabled)
  const ethnicSet = useMemo(() => new Set(ethnicEnabled), [ethnicEnabled])
  const toggleEthnic = (name: string): void => {
    setEthnicEnabled(ethnicSet.has(name) ? ethnicEnabled.filter((n) => n !== name) : [...ethnicEnabled, name])
  }
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
  /**
   * adj1017：**只有"音色表真的解析过"才算本库的音色**。
   *
   * 原来判的是 `record` 有没有（`bank0.length > 0`），于是"扫描登记过、但音色表还没解析"的库
   * 会静默回退成 GM 标准 128 个中文名——看上去和 GeneralUser 一模一样，用户会以为"换库没换音色"。
   */
  const presetsKnown = !!record && record.presetsKnown === true
  const rows = useMemo<PickerRow[]>(() => {
    if (record && record.presetsKnown === true) {
      return record.presets
        .filter((p) => p.bank === 0)
        .map((p) => ({ program: p.program, zh: zhNameOf(p.program), libName: p.name }))
        .sort((a, b) => a.program - b.program)
    }
    return GM_VOICE_OPTIONS.map((v) => ({ program: v.program, zh: zhNameOf(v.program) }))
  }, [record])
  /** 本库确实没有 bank 0（只有变体/鼓组）——这时**不能**拿 GM 128 个来冒充 */
  const noBank0 = presetsKnown && rows.length === 0

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
        {/* adj1028（用户 2026-10-21）：两个页签 —— 原音色清单 / 民族乐器（拟） */}
        <div role="tablist" style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--jp-border)', paddingBottom: 6 }}>
          {([
            ['lib', '音色清单'],
            ['ethnic', `${voicePickerCopy.ethnicTitle}（${ETHNIC_ALIASES.length}）`],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className="btn"
              style={{
                ...btnStyle,
                borderColor: tab === k ? 'var(--jp-accent)' : 'var(--jp-border)',
                color: tab === k ? 'var(--jp-accent)' : 'var(--jp-text-primary)',
              }}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
        {/* 默认页签：原来的音色清单（内容保持原样，只在外层按页签显隐） */}
        <div style={{ display: tab === 'lib' ? 'contents' : 'none' }}>
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
          {/* 回退到 GM 标准名时不带库名（否则会让人以为"本库就叫这些名字"） */}
          {voicePickerCopy.summary(enabled.length, rows.length, presetsKnown ? lib.name : undefined)}
        </div>
        {/* adj1017：判定改成"**音色表是否真的解析过**"——只判 `record` 有没有会让
            "扫描登记过但没解析"的库静默回退、而提示不出现（用户以为换库没换音色） */}
        {!presetsKnown && (
          <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>{voicePickerCopy.fallbackHint(lib.name)}</div>
        )}
        {noBank0 && <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>{voicePickerCopy.noBank0Hint}</div>}

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
        </div>

        {/* 民族乐器（拟）页签：与默认页签一样"可勾选"，勾了才能在脚本里用 */}
        <div
          role="tabpanel"
          style={{ display: tab === 'ethnic' ? 'flex' : 'none', flexDirection: 'column', gap: 8, minHeight: 0 }}
        >
          <div style={{ fontSize: 11, color: HIGHLIGHT, lineHeight: 1.7 }}>{voicePickerCopy.ethnicHint}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" style={btnStyle} onClick={() => setEthnicEnabled(ETHNIC_ALIASES.map((a) => a.name))}>
              {voicePickerCopy.selectAll}
            </button>
            <button className="btn" style={btnStyle} onClick={() => setEthnicEnabled([])}>
              {voicePickerCopy.clearAll}
            </button>
            <span style={{ fontSize: 11, color: 'var(--jp-warning)' }}>
              已勾选 {ethnicEnabled.length} / {ETHNIC_ALIASES.length}
              {ethnicEnabled.length === 0 ? '（没勾的名字在脚本里不生效）' : ''}
            </span>
          </div>
          <div
            style={{
              maxHeight: 'min(420px, 60vh)',
              overflow: 'auto',
              border: '1px solid var(--jp-border)',
              borderRadius: 6,
              padding: '4px 8px',
            }}
          >
            {ETHNIC_ALIASES.map((a) => (
              <label
                key={a.name}
                style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, lineHeight: 1.9, cursor: 'pointer' }}
              >
                <input type="checkbox" checked={ethnicSet.has(a.name)} onChange={() => toggleEthnic(a.name)} />
                <span style={{ color: 'var(--jp-text-primary)', fontWeight: 600 }}>{ethnicLabel(a)}</span>
                <span style={{ color: HIGHLIGHT }}>→ {ethnicGmLabel(a)}</span>
                {a.note && <span style={{ color: HIGHLIGHT, fontSize: 11 }}>· {a.note}</span>}
              </label>
            ))}
          </div>
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
