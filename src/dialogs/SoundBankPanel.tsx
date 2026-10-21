/**
 * dialogs/SoundBankPanel.tsx — 音色库管理面板（adj331/332/342；adj384 移入「设置」；adj1012 改成**多库**）
 *
 * ## adj1012 的结构（三块）
 *
 * 1. **音色库列表**：一行一个库 —— 显示名 / 来源 / 体积 / 音色数 / 许可 / ✓当前，
 *    行内有 `[使用] [下载并导入*] [下载页*] [从插件目录导入*] [导出] [删除*]`（`*` = 看情况出现）。
 *    底部 `[添加音色库…]`：选本地 `.sf2/.sf3`，**按文件内容认库**（见 `bankRegistry.readBankFile`）。
 * 2. **当前库的音色**：已选/本库可选数的摘要 + `[全选本库][指定音色…][全消本库]`，
 *    并如实写"本库共 N 个预设，其中 M 个变体/鼓组暂不可选"。
 *    长列表在 `VoicePickerDialog` 里（搜索/分组/反选），不再在面板里展开。
 * 3. **收藏与音色文件**：导出/导入收藏（JSON v2，带"每库一套"）。
 *
 * 属**本机用户偏好（L1）**：不随谱保存（分层见 docs/SETTINGS-AUDIT.md）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore, enabledVoicesOf } from '../store/uiStore'
import { hostBankUrl, hostBridge, isHostEmbedded } from '../store/hostBridge'
import { playbackCopy } from '../brand/copy'
import { GM_VOICE_OPTIONS, resolveActiveLibrary, hasBuiltinBank, hqBankFailureText } from '../playback/spessaSynthBackend'
import { createHqCache, prefetchHqLibraryProgress, resolveHqBank } from '../playback/spessaCache'
import {
  buildBankRows,
  createBankRegistry,
  presetCountOf,
  readBankFile,
  type BankRecord,
  type BankRow,
} from '../playback/bankRegistry'
import { summarizeSf2Presets } from '@ijipu/engine'
import type { HqSampleLibrary } from '../playback/spessaSynthBackend'

const HIGHLIGHT = 'var(--jp-text-muted)'
const BTN = {
  padding: '4px 10px',
  fontSize: 12,
  whiteSpace: 'nowrap' as const,
  background: 'var(--jp-bg-app)',
  border: '1px solid var(--jp-border)',
  color: 'var(--jp-text-primary)',
  borderRadius: '6px',
}
const ROW_BOX = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '6px 8px',
  border: '1px solid var(--jp-border)',
  borderRadius: 6,
  background: 'var(--jp-bg-app)',
  flexWrap: 'wrap' as const,
}
const MB = (n: number): string => (n / 1_000_000).toFixed(1)

export function SoundBankPanel() {
  const hqCache = useRef(createHqCache())
  /** adj1010：库元数据注册表（IndexedDB 的 `libs` 表；字节仍在 `banks` 表） */
  const registry = useRef(createBankRegistry())
  const [notice, setNotice] = useState<string | null>(null)
  // adj953：`'preparing'` = 正在**问宿主/查缓存/探测内置**（都很快）；只有真走联网才切 `'downloading'`
  const [hqDl, setHqDl] = useState<'idle' | 'preparing' | 'downloading' | 'done' | 'builtin' | 'error'>('idle')
  /** adj724b：失败原因（用于给用户"该怎么做"的提示，而不是笼统的"请检查网络"） */
  const [hqDlError, setHqDlError] = useState<unknown>(null)
  /** adj1012：所有库的元数据（`libs` 表）—— 列表与"当前库音色数"都读它 */
  const [records, setRecords] = useState<BankRecord[]>([])
  /** adj1012：正在处理的库 id（按钮防连点 + 显示"处理中…"） */
  const [busy, setBusy] = useState<string | null>(null)
  const enabled = useUiStore(enabledVoicesOf)
  const hqLibrary = useUiStore((s) => s.playbackHqLibrary)
  const hqVoice = useUiStore((s) => s.playbackHqVoice)
  const setPlaybackHqLibrary = useUiStore((s) => s.setPlaybackHqLibrary)
  const setPlaybackHqVoice = useUiStore((s) => s.setPlaybackHqVoice)
  const setPlaybackHqEnabled = useUiStore((s) => s.setPlaybackHqEnabled)
  const replaceEnabledByLib = useUiStore((s) => s.replacePlaybackHqEnabledByLib)
  const openModal = useUiStore((s) => s.openModal)
  const fileRef = useRef<HTMLInputElement>(null)
  const fileSf2Ref = useRef<HTMLInputElement>(null)
  /** adj1011：当前选中的库（库被删/查不到时回退默认库并标 `fallback`） */
  const active = useMemo(() => resolveActiveLibrary(hqLibrary), [hqLibrary])
  const currentHqLib = active.lib
  /** adj1012：列表行——已知库必出现（默认库永远第一行），用户导入的库追加在后 */
  const rows = useMemo(() => buildBankRows(records), [records])
  const activeRow = useMemo(
    () => rows.find((r) => r.lib.id === currentHqLib.id) ?? { lib: currentHqLib, record: null, known: true },
    [rows, currentHqLib],
  )
  const activeRecord = activeRow.record
  /** 当前库**可勾选**的音色（只 bank 0 —— 变体/鼓组要 bank select，暂不开放） */
  const activePresets = useMemo(
    () => (activeRecord?.presets ?? []).filter((p) => p.bank === 0),
    [activeRecord],
  )
  const voiceTotal = activePresets.length > 0 ? activePresets.length : GM_VOICE_OPTIONS.length
  const voicePrograms = useMemo(
    () => (activePresets.length > 0 ? activePresets.map((p) => p.program) : GM_VOICE_OPTIONS.map((v) => v.program)),
    [activePresets],
  )
  /** 本库预设统计（"另有 N 个变体/鼓组"要如实写，别假装全都能选） */
  const presetSummary = useMemo(
    () => (activeRecord ? summarizeSf2Presets(activeRecord.presets) : null),
    [activeRecord],
  )

  const reload = async (): Promise<void> => {
    setRecords(await registry.current.list())
  }
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * adj1012：把"字节已经就位、但没有元数据"的库补登记一次。
   *
   * 为什么需要：老用户/首次安装的用户，`banks` 里可能已有 GeneralUser 的字节（内置或历史上导入过），
   * 但 `libs` 里没有它的预设表 ⇒ 界面上"本库音色数"是空的、音色也选不了。
   * 只在取不到记录时才读一次字节（32 MB 一次，随后持久化）。
   */
  const ensureRecord = async (lib: HqSampleLibrary): Promise<void> => {
    if (await registry.current.get(lib.id)) return
    try {
      const { bank } = await resolveHqBank(lib, hqCache.current, hostBankUrl(lib.id))
      const parsed = readBankFile(bank, `${lib.id}.sf2`)
      if (!parsed.ok) return
      if (parsed.record.id !== lib.id) await hqCache.current.save(parsed.record.id, bank)
      await registry.current.put(parsed.record)
      await reload()
    } catch {
      /* 取不到（未下载/未导入）⇒ 保持"还没读到音色表"，不打断面板 */
    }
  }

  // adj347/349：打开面板自动把**当前库**准备好；adj953：先问宿主/缓存/内置，最后才联网
  useEffect(() => {
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const lib = active.lib
          setHqDl('preparing')
          if (await hasBuiltinBank(lib)) {
            setHqDl('builtin')
            await ensureRecord(lib)
            return
          }
          const source = await prefetchHqLibraryProgress(
            lib,
            hqCache.current,
            // adj953：`onProgress` 只在预取收尾回调一次 ⇒ 收尾时若还停在 `downloading`，说明这轮下完了
            () => setHqDl((s) => (s === 'downloading' ? 'done' : s)),
            hostBankUrl(lib.id),
            { onRemote: () => setHqDl('downloading') },
          )
          if (source === 'builtin') setHqDl('builtin')
          else setHqDl('done')
          await ensureRecord(lib)
        } catch (e) {
          setHqDlError(e)
          setHqDl('error')
        }
      })()
    }, 60)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hqLibrary])

  // adj342/adj1012：全选 / 全消 —— **只作用于当前库**
  const selectAll = () => setPlaybackHqEnabled(voicePrograms)
  const clearAll = () => setPlaybackHqEnabled([])

  // 导出/导入「音色收藏配置」（JSON v2：带"每库一套"；仍能读 v1 的旧文件）
  const exportConfig = () => {
    const data = {
      version: 2,
      hqLibrary,
      hqEnabledByLib: useUiStore.getState().playbackHqEnabledByLib,
      hqEnabled: enabled, // v1 兼容字段（旧版应用还能读）
      hqVoice,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ijipu-soundbanks.json'
    a.click()
    URL.revokeObjectURL(url)
    setNotice('✓ 已导出音色配置（含每个库各自的收藏）')
  }
  const importConfig = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const j = JSON.parse(String(reader.result)) as {
          version?: number
          hqEnabled?: unknown
          hqEnabledByLib?: unknown
          hqLibrary?: unknown
          hqVoice?: unknown
        }
        // v2：整份替换"每库收藏"；v1：只有一个数组 ⇒ 落到**当前库**
        if (j.hqEnabledByLib && typeof j.hqEnabledByLib === 'object' && !Array.isArray(j.hqEnabledByLib)) {
          replaceEnabledByLib(j.hqEnabledByLib as Record<string, number[]>)
        } else if (Array.isArray(j.hqEnabled)) {
          setPlaybackHqEnabled(j.hqEnabled.filter((n): n is number => Number.isInteger(n)))
        }
        if (typeof j.hqLibrary === 'string') setPlaybackHqLibrary(j.hqLibrary)
        if (j.hqVoice === null || typeof j.hqVoice === 'number') setPlaybackHqVoice(j.hqVoice ?? null)
        setNotice('✓ 已导入音色配置')
      } catch {
        setNotice('导入文件格式无效')
      }
    }
    reader.readAsText(file)
  }

  /**
   * adj1010/adj1012：**添加音色库**（选本地 .sf2/.sf3）。
   *
   * 关键：先按文件内容（INAM）认出"这是哪个库"，再写 `banks/<id>` + `libs/<id>`；
   * 不再写死默认库的键（旧实现把 FluidR3 存到 generaluser_gs 名下，用户实报的 bug）。
   */
  const importDataFile = async (file: File): Promise<void> => {
    setNotice('正在读取音色文件…')
    let bytes: ArrayBuffer
    try {
      bytes = await file.arrayBuffer()
    } catch (e) {
      setNotice(`音色数据文件读取失败：${e instanceof Error ? e.message : String(e)}`)
      return
    }
    const res = readBankFile(bytes, file.name)
    if (!res.ok) {
      // 三种拒绝各有明确原因：Git LFS 指针 / 不是 SF2 / 读不出音色表
      setNotice(res.error)
      return
    }
    const { record } = res
    const existed = await registry.current.get(record.id)
    if (existed && !window.confirm(`已经有「${existed.name}」（${existed.fileName}）。用这份新文件替换它吗？`)) {
      setNotice('已取消导入')
      return
    }
    try {
      // 先写字节（可能因配额失败），再登记元数据——顺序反了会留下"有条目没文件"的假库
      await hqCache.current.save(record.id, bytes)
    } catch (e) {
      setNotice(
        `音色数据写不进本地缓存（多半是空间不足）：${e instanceof Error ? e.message : String(e)}。本次导入未生效。`,
      )
      return
    }
    try {
      await registry.current.put(record)
    } catch (e) {
      setNotice(`音色库登记失败：${e instanceof Error ? e.message : String(e)}（文件已写入，重试一次即可）`)
      return
    }
    await reload()
    setHqDl('done')
    setNotice(
      `✓ 已添加音色库「${record.name}」：${record.presets.length} 个音色 · ${MB(record.sizeBytes)} MB` +
        (existed ? '（已替换原文件）' : '') +
        '。点它那一行的「使用」即可切到它。',
    )
  }

  /** adj1012：已知库的「下载并导入」——取字节 → 解析 → 登记（GeneralUser 未内置时就走这条） */
  const downloadAndRegister = async (lib: HqSampleLibrary): Promise<void> => {
    setBusy(lib.id)
    setNotice(`正在获取「${lib.name}」（约 ${MB(lib.sizeBytes)} MB）…`)
    try {
      const { bank } = await resolveHqBank(lib, hqCache.current, hostBankUrl(lib.id))
      const parsed = readBankFile(bank, `${lib.id}.sf2`)
      if (!parsed.ok) {
        setNotice(parsed.error)
        return
      }
      if (parsed.record.id !== lib.id) await hqCache.current.save(parsed.record.id, bank)
      await registry.current.put(parsed.record)
      await reload()
      setNotice(`✓ 「${lib.name}」已就绪：${parsed.record.presets.length} 个音色 · ${MB(parsed.record.sizeBytes)} MB`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  /**
   * adj729：嵌入版里由**插件**弹选择器并直接写进**插件目录**（随文库一起走）。
   * 只对**已知库**提供（宿主要按库 id 定文件名；新库 id 要先读文件内容才知道）。
   */
  const importViaHost = async (lib: HqSampleLibrary): Promise<void> => {
    const bridge = hostBridge()
    if (!bridge) return
    setBusy(lib.id)
    setNotice('请在系统文件选择器里选 .sf2 文件…')
    try {
      const r = await bridge.importSoundbank(lib.id)
      if (r.canceled) {
        setNotice('已取消导入')
        return
      }
      if (!r.ok) {
        setNotice(`导入失败：${r.error ?? '未知原因'}`)
        return
      }
      setHqDl('done')
      await ensureRecord(lib)
      setNotice(`✓ 已导入「${lib.name}」的音色数据（已存到插件目录，随文库一起走）`)
    } catch (e) {
      setNotice(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  /** adj1012：导出某个库的音色文件（缓存 → 内置 → 宿主 → 联网，顺序由 `resolveHqBank` 定） */
  const exportDataFile = async (lib: HqSampleLibrary): Promise<void> => {
    setBusy(lib.id)
    try {
      const { bank: ab } = await resolveHqBank(lib, hqCache.current, hostBankUrl(lib.id))
      const blob = new Blob([ab], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${lib.id}.sf2`
      a.click()
      URL.revokeObjectURL(url)
      setNotice(`✓ 已导出音色数据：${lib.name}`)
    } catch (e) {
      setNotice(`音色数据导出失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  /** adj1012：删除本地副本（字节 + 元数据）。已知库删完这一行还在（可以重新下载/导入）。 */
  const removeBank = async (row: BankRow): Promise<void> => {
    const { lib, record } = row
    const what = record ? `「${lib.name}」（${record.fileName}，${MB(record.sizeBytes)} MB）` : `「${lib.name}」的本地文件`
    if (!window.confirm(`删除 ${what}？\n\n删掉后需要用时会重新下载或重新导入。`)) return
    setBusy(lib.id)
    try {
      await hqCache.current.remove(lib.id)
      if (record && record.id !== lib.id) await hqCache.current.remove(record.id)
      if (record) await registry.current.remove(record.id)
      // 删的正是当前库 ⇒ 回到默认库（否则会停在"选了但没文件"的状态）
      if (lib.id === currentHqLib.id) setPlaybackHqLibrary('')
      await reload()
      setNotice(`✓ 已删除 ${what}`)
    } catch (e) {
      setNotice(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  /** 一行里"来源"怎么说（不夸大：没文件就写"未加载"） */
  const sourceLabel = (row: BankRow): string => {
    if (!row.record) return row.known ? '未加载' : '缺文件'
    if (row.record.origin === 'imported') return '已导入'
    if (row.record.origin === 'downloaded') return '已下载'
    if (row.record.origin === 'bundled') return '随包内置'
    return '宿主提供'
  }

  return (
    <div className="soundbank-panel" style={{ fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* —— 1. 音色库列表 —— */}
      <section>
        <div className="pcfg-group-title">
          音色库
          <span style={{ color: HIGHLIGHT, marginLeft: 6, fontSize: 11 }}>
            （「使用」切到哪个库，试听与导出就用哪个库的声音）
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((row) => {
            const { lib, record } = row
            const using = lib.id === currentHqLib.id
            const count = presetCountOf(row)
            const canDownload = lib.autoDownload !== false && lib.source.trim() !== ''
            const working = busy === lib.id
            return (
              <div key={lib.id} style={{ ...ROW_BOX, borderColor: using ? 'var(--jp-accent)' : 'var(--jp-border)' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontWeight: 600 }}>{lib.name}</strong>
                    {using && <span style={{ color: 'var(--jp-accent)', fontSize: 11 }}>✓ 当前</span>}
                    {!row.known && <span style={{ color: HIGHLIGHT, fontSize: 11 }}>（已导入）</span>}
                  </div>
                  <div style={{ color: HIGHLIGHT, fontSize: 11 }}>
                    {sourceLabel(row)} · {(record?.sizeBytes ?? lib.sizeBytes) ? `${MB(record?.sizeBytes ?? lib.sizeBytes)} MB` : ''} ·{' '}
                    {count === null ? '音色数未知' : `${count} 音色`}
                    {lib.license ? ` · ${lib.license}` : ''}
                  </div>
                  {record && (
                    <div style={{ color: HIGHLIGHT, fontSize: 11, wordBreak: 'break-all' }}>
                      {record.fileName}
                      {presetCountOf(row) !== null && record.presets.some((p) => p.bank !== 0)
                        ? `（另有 ${record.presets.filter((p) => p.bank !== 0).length} 个变体/鼓组，暂不可选）`
                        : ''}
                    </div>
                  )}
                  {!record && row.known && (
                    <div style={{ color: HIGHLIGHT, fontSize: 11 }}>
                      还没有本地文件；{canDownload ? '点「下载并导入」或' : ''}用「添加音色库…」选本地 .sf2。
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    className="btn"
                    style={{ ...BTN, color: using ? 'var(--jp-text-muted)' : 'var(--jp-accent)' }}
                    disabled={using || working}
                    onClick={() => {
                      setPlaybackHqLibrary(lib.id)
                      setNotice(`✓ 已切到「${lib.name}」（下次试听/导出用它）`)
                    }}
                  >
                    使用
                  </button>
                  {canDownload && (
                    <button className="btn" style={BTN} disabled={working} onClick={() => void downloadAndRegister(lib)}>
                      {working ? '处理中…' : record ? '重新获取' : '下载并导入'}
                    </button>
                  )}
                  {lib.downloadPage && (
                    <button
                      className="btn"
                      style={BTN}
                      title={lib.downloadPage}
                      onClick={() => window.open(lib.downloadPage, '_blank', 'noopener,noreferrer')}
                    >
                      下载页
                    </button>
                  )}
                  {row.known && isHostEmbedded() && (
                    <button className="btn" style={BTN} disabled={working} onClick={() => void importViaHost(lib)}>
                      从插件目录导入
                    </button>
                  )}
                  {(record || row.known) && (
                    <button className="btn" style={BTN} disabled={working} onClick={() => void exportDataFile(lib)}>
                      导出
                    </button>
                  )}
                  {record && (
                    <button className="btn" style={{ ...BTN, color: 'var(--jp-danger)' }} disabled={working} onClick={() => void removeBank(row)}>
                      删除
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => fileSf2Ref.current?.click()}>
            添加音色库…
          </button>
          <span style={{ color: HIGHLIGHT, fontSize: 11 }}>
            选本地的 .sf2 / .sf3；会自动读出库名与音色表（同一个库再导入 = 换文件）。
          </span>
        </div>
        {/* adj724b：当前库的加载状态——只在**真的**联网那一步说"正在下载" */}
        {active.fallback && (
          <div style={{ color: 'var(--jp-warning)', fontSize: 11, marginTop: 4 }}>
            你选的音色库不在了（可能被删或换了机器），已临时用「{currentHqLib.name}」。
          </div>
        )}
        {hqDl === 'builtin' && (
          <div style={{ color: 'var(--jp-accent)', fontSize: 11, marginTop: 4 }}>
            {playbackCopy.builtinBankHint(`${currentHqLib.id}.sf2`)}
          </div>
        )}
        {hqDl === 'preparing' && (
          <div style={{ color: HIGHLIGHT, fontSize: 11, marginTop: 4 }}>{playbackCopy.loading}</div>
        )}
        {hqDl === 'downloading' && (
          <div style={{ color: 'var(--jp-warning)', fontSize: 11, marginTop: 4 }}>
            ⏳ 正在后台下载当前音色库（约 {MB(currentHqLib.sizeBytes)} MB，仅首次）…下载期间可正常操作。
          </div>
        )}
        {hqDl === 'error' && (
          <div style={{ color: 'var(--jp-danger)', fontSize: 11, marginTop: 4, whiteSpace: 'pre-wrap' }}>
            {hqBankFailureText(currentHqLib, hqDlError instanceof Error ? hqDlError.message : String(hqDlError ?? ''))}
          </div>
        )}
      </section>

      {/* —— 2. 当前库的音色 —— */}
      <section>
        <div className="pcfg-group-title">
          当前库的音色
          <span style={{ color: HIGHLIGHT, marginLeft: 6, fontSize: 11 }}>
            （{currentHqLib.name}；仅已勾选项进入「试听」面板的音色下拉）
          </span>
        </div>
        <div style={{ ...ROW_BOX, alignItems: 'center' }}>
          <button className="btn" style={BTN} onClick={selectAll}>全选本库</button>
          <button
            className="btn"
            style={{ ...BTN, color: 'var(--jp-accent)' }}
            onClick={() => openModal('voicePicker')}
            title="从本库的音色里勾选要启用的（搜索 / 分组 / 反选）"
          >
            指定音色…
          </button>
          <button className="btn" style={BTN} onClick={clearAll}>全消本库</button>
          <span style={{ color: HIGHLIGHT, fontSize: 11, marginLeft: 'auto' }}>
            已选 <strong style={{ color: 'var(--jp-text-primary)' }}>{enabled.length}</strong> / {voiceTotal}
            {activeRecord ? '（本库）' : '（GM 标准名，本库音色表还没读到）'}
          </span>
        </div>
        {presetSummary && presetSummary.other > 0 && (
          <div style={{ color: HIGHLIGHT, fontSize: 11, marginTop: 4 }}>
            本库共 {presetSummary.total} 个预设：bank 0 的 {presetSummary.bank0} 个可选；另有{' '}
            {presetSummary.other} 个变体/鼓组（要 bank select，暂不开放）。
          </div>
        )}
        {!activeRecord && (
          <div style={{ color: HIGHLIGHT, fontSize: 11, marginTop: 4 }}>
            还没读到这个库的音色表——先在上面把它下载/导入好；在那之前音色按 GM 标准 128 个来选。
          </div>
        )}
      </section>

      {/* —— 3. 收藏与音色文件 —— */}
      <section>
        <div className="ijipu-form-label">
          收藏
          <span style={{ color: HIGHLIGHT, marginLeft: 6, fontSize: 11 }}>
            （导出=当前库 + 每库收藏；音色文件请在上面按库操作）
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" style={BTN} onClick={exportConfig}>导出收藏</button>
          <button className="btn" style={BTN} onClick={() => fileRef.current?.click()}>导入收藏</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importConfig(f)
              e.target.value = ''
            }}
          />
          <input
            ref={fileSf2Ref}
            type="file"
            accept=".sf2,.sf3"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importDataFile(f)
              e.target.value = ''
            }}
          />
        </div>
        {currentHqLib.downloadPage && (
          <div style={{ color: HIGHLIGHT, fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
            这个库不能应用内自动下载时，可以**手动装一次**：点它那一行的「下载页」自己下一个，
            再回来点「添加音色库…」选它。装好之后一直用本地那份、不再联网。
            <br />
            下载页：<span style={{ userSelect: 'text' }}>{currentHqLib.downloadPage}</span>
          </div>
        )}
      </section>

      {/* —— 4. 操作结果提示 —— */}
      {notice && (
        <div style={{ color: notice.startsWith('✓') ? 'var(--jp-text-primary)' : 'var(--jp-danger)', fontSize: 11 }}>{notice}</div>
      )}

      {/* —— 5. 说明 —— */}
      <div style={{ color: HIGHLIGHT, fontSize: 11 }}>
        音色库与试听音色属本机偏好，不随谱保存。一个谱同一时刻只用一个音色库。
      </div>
    </div>
  )
}
