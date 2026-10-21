/**
 * dialogs/SoundBankPanel.tsx — 音色库管理面板（adj331/332/342；adj384 移入设置；adj1012 多库；**adj1016 四层重排**）
 *
 * ## 页面按"每层只回答一个问题"排（见 docs/SOUNDBANK-PAGE-PLAN.md §六）
 *
 * 【0】当前使用：一条摘要，任何层都能一眼看到"现在用哪个"
 * 【1】音色库：**扫描本机**（安装目录 / 我的音色库目录 / 缓存）+ 已登记的库 + 推荐下载
 * 【2】管理：当前库的文件在哪、多大、导出 / 删除本地副本 + "扫描过的地方各有什么"
 * 【3】选音色：当前库可选多少、已选多少（长列表在 VoicePickerDialog）
 * 【4】使用：**只读说明**（试听/导出/`Y:` 都是它的下游，这里不再放按钮，避免两处入口）
 *
 * ## 为什么要"扫描"而不是只列 `HQ_LIBRARIES`
 *
 * 用户口径（2026-10-21）：「不预设用哪个音色库 —— 保证有一个基础库，其余靠发现本机文件 +
 * 推荐下载 + 手动导入」。只列清单的话，把 `abc.sf2` 放进 `soundfonts/` 永远看不见。
 *
 * 属**本机用户偏好（L1）**：不随谱保存（分层见 docs/SETTINGS-AUDIT.md）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore, enabledVoicesOf } from '../store/uiStore'
import { hostBankUrl, hostBridge, isHostEmbedded } from '../store/hostBridge'
import { playbackCopy } from '../brand/copy'
import {
  GM_VOICE_OPTIONS,
  RECOMMENDED_BANKS,
  resolveActiveLibrary,
  hasBuiltinBank,
  hqBankFailureText,
} from '../playback/spessaSynthBackend'
import { createHqCache, prefetchHqLibraryProgress, resolveHqBank } from '../playback/spessaCache'
import {
  buildBankRows,
  createBankRegistry,
  missingBankRows,
  presetCountOf,
  readBankFile,
  type BankRecord,
  type BankRow,
} from '../playback/bankRegistry'
import { scanAndRegister, openUserSoundfontDir, type DiscoveryCounts, type DiscoveryProblem } from '../playback/bankDiscovery'
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
const SMALL = { color: HIGHLIGHT, fontSize: 11 } as const

/** 位置 → 人话（用户要能照着去找文件） */
const LOCATION_LABEL: Record<string, string> = {
  install: '随包（安装目录，只读）',
  appdata: '我的音色库目录（%APPDATA%\\…\\soundfonts）',
  plugin: '插件目录',
  cache: '本机缓存',
}

export function SoundBankPanel() {
  const hqCache = useRef(createHqCache())
  /** adj1010：库元数据注册表（IndexedDB 的 `libs` 表；字节仍在 `banks` 表） */
  const registry = useRef(createBankRegistry())
  const [notice, setNotice] = useState<string | null>(null)
  // adj953：`'preparing'` = 正在问宿主/查缓存/探测内置（都很快）；只有真走联网才切 `'downloading'`
  const [hqDl, setHqDl] = useState<'idle' | 'preparing' | 'downloading' | 'done' | 'builtin' | 'error'>('idle')
  const [hqDlError, setHqDlError] = useState<unknown>(null)
  /** adj1012：所有库的元数据（`libs` 表） */
  const [records, setRecords] = useState<BankRecord[]>([])
  /** adj1012：正在处理的库 id（按钮防连点 + 显示"处理中…"） */
  const [busy, setBusy] = useState<string | null>(null)
  /** adj1016：扫描状态与"上次扫描"结果（三个位置各扫到几个 + 跳过了哪些文件） */
  const [scanning, setScanning] = useState(false)
  const [scanInfo, setScanInfo] = useState<{ counts: DiscoveryCounts; problems: DiscoveryProblem[]; at: number } | null>(
    null,
  )
  const [showProblems, setShowProblems] = useState(false)
  /** adj1016：推荐区默认折叠；**一个库都没有时自动展开**（空状态的主要出路就是它） */
  const [showRecommended, setShowRecommended] = useState(false)
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
  /**
   * adj1018（用户口径）：**已安装列表只放"真的有文件"的库**。
   * 没下载/没导入的已知库（如 FluidR3）**不出现**在这里——它们只属于下面的「推荐」区。
   */
  const rows = useMemo(() => buildBankRows(records), [records])
  /** 曾装过、现在文件不在了（记录保留，放回去再扫就恢复） */
  const missing = useMemo(() => missingBankRows(records), [records])
  const activeRow = useMemo(
    () =>
      rows.find((r) => r.lib.id === currentHqLib.id) ??
      missing.find((r) => r.lib.id === currentHqLib.id) ?? {
        lib: currentHqLib,
        record: records.find((r) => r.id === currentHqLib.id) ?? null,
        known: true,
      },
    [rows, missing, records, currentHqLib],
  )
  const activeRecord = activeRow.record
  /** "至少装了一个"——没有就进空状态（基础库都没装 ⇒ 没声音） */
  const hasUsable = rows.length > 0
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
  const presetSummary = useMemo(
    () => (activeRecord ? summarizeSf2Presets(activeRecord.presets) : null),
    [activeRecord],
  )

  const reload = async (): Promise<void> => {
    setRecords(await registry.current.list())
  }

  /**
   * adj1016：补登记"字节已经就位、但没有预设表"的库（老用户/首次安装都会碰到）。
   * 只在**没有解析过**时才读一次全量（32–141 MB），解析后持久化，之后不再读。
   */
  const ensureRecord = async (lib: HqSampleLibrary): Promise<void> => {
    const existing = await registry.current.get(lib.id)
    if (existing && existing.presetsKnown === true) return
    try {
      const { bank } = await resolveHqBank(lib, hqCache.current, hostBankUrl(lib.id))
      const parsed = readBankFile(bank, existing?.fileName ?? `${lib.id}.sf2`)
      if (!parsed.ok) return
      // 内容认出来的 id 与已知库不同（罕见）⇒ 字节另存一份，别覆盖错的键
      if (parsed.record.id !== lib.id) await hqCache.current.save(parsed.record.id, bank)
      const rec: BankRecord = existing
        ? {
            ...existing,
            name: parsed.record.name,
            fileName: existing.fileName || parsed.record.fileName,
            sizeBytes: parsed.record.sizeBytes,
            presets: parsed.record.presets,
            presetsKnown: true,
            present: true,
          }
        : { ...parsed.record, presetsKnown: true, location: 'cache', present: true }
      await registry.current.put(rec)
      await reload()
    } catch {
      /* 取不到（未下载/未导入/只能手动下载）⇒ 保持"还没读到音色表"，不打断面板 */
    }
  }

  // adj347/349 + adj1016：打开面板 → **先扫描登记**（快）→ 再准备当前库（可能读一次全量）
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      // ① 扫描：安装目录 / 我的音色库目录 / 缓存（桌面端走 Tauri；网页端只有缓存）
      setScanning(true)
      try {
        const r = await scanAndRegister()
        if (cancelled) return
        setRecords(r.records)
        setScanInfo({ counts: r.counts, problems: r.problems, at: Date.now() })
      } catch (e) {
        if (!cancelled) setNotice(`扫描音色库失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (!cancelled) setScanning(false)
      }
      if (cancelled) return
      // ② 当前库：探测内置 → 预取 → 补预设表
      const lib = active.lib
      try {
        setHqDl('preparing')
        if (lib.autoDownload === false || lib.source.trim() === '') {
          // 只能手动下载的库（如 FluidR3）：不假装在下载，直接尝试用本地那份
          setHqDl('idle')
          await ensureRecord(lib)
          if (!cancelled) await reload()
          return
        }
        if (await hasBuiltinBank(lib)) setHqDl('builtin')
        else {
          const source = await prefetchHqLibraryProgress(
            lib,
            hqCache.current,
            () => setHqDl((s) => (s === 'downloading' ? 'done' : s)),
            hostBankUrl(lib.id),
            { onRemote: () => setHqDl('downloading') },
          )
          setHqDl(source === 'builtin' ? 'builtin' : 'done')
        }
        await ensureRecord(lib)
        if (!cancelled) await reload()
      } catch (e) {
        if (!cancelled) {
          setHqDlError(e)
          setHqDl('error')
        }
      }
    }
    const t = window.setTimeout(() => void run(), 60)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hqLibrary])

  /** adj1020：打开"我的音色库目录"——去掉随包后，这是"自己放文件"的最短路径 */
  const openBankDir = async (): Promise<void> => {
    try {
      const p = await openUserSoundfontDir()
      if (p === null) {
        setNotice('网页版没有"音色库目录"：请用「添加音色库…」导入文件（会存进本机缓存）。')
        return
      }
      setNotice(`✓ 已打开音色库目录：${p}（把 .sf2 放进去，再点「重新扫描」）`)
    } catch (e) {
      setNotice(`打开目录失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** adj1016：用户点「重新扫描」——与打开面板同一条编排，但不切当前库 */
  const rescan = async (): Promise<void> => {
    setScanning(true)
    try {
      const r = await scanAndRegister()
      setRecords(r.records)
      setScanInfo({ counts: r.counts, problems: r.problems, at: Date.now() })
      setNotice(
        `✓ 扫描完成：找到 ${r.banks.length} 个库` +
          (r.registered > 0 ? `，新登记 ${r.registered} 个` : '') +
          (r.problems.length > 0 ? `；跳过 ${r.problems.length} 个文件` : ''),
      )
    } catch (e) {
      setNotice(`扫描失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setScanning(false)
    }
  }

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
          hqEnabled?: unknown
          hqEnabledByLib?: unknown
          hqLibrary?: unknown
          hqVoice?: unknown
        }
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
   * adj1010/adj1016：**添加音色库**（选本地 .sf2/.sf3）。
   *
   * 先按文件内容（INAM）认出"这是哪个库"，再写 `banks/<id>` + `libs/<id>`；
   * 不写死默认库的键（旧实现把 FluidR3 存到 generaluser_gs 名下，用户实报的 bug）。
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
      await registry.current.put({ ...record, presetsKnown: true, present: true, location: 'cache' })
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
      await registry.current.put({ ...parsed.record, presetsKnown: true, present: true, location: 'cache' })
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
      if (lib.id === currentHqLib.id) setPlaybackHqLibrary('')
      await reload()
      setNotice(`✓ 已删除 ${what}`)
    } catch (e) {
      setNotice(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  /** 一行里"来源"怎么说（不夸大：文件不在就写"文件不在了"） */
  const sourceLabel = (row: BankRow): string => {
    const rec = row.record
    if (!rec) return row.known ? '未加载' : '缺文件'
    if (rec.present === false) return '文件不在了'
    if (rec.location === 'install') return '随包'
    if (rec.location === 'appdata') return '本机'
    if (rec.location === 'plugin') return '插件目录'
    if (rec.location === 'cache') return '缓存'
    return rec.origin === 'imported' ? '已导入' : '已下载'
  }

  const scanTime = scanInfo ? new Date(scanInfo.at).toLocaleTimeString('zh-CN', { hour12: false }) : ''

  return (
    <div className="soundbank-panel" style={{ fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* —— 0. 当前使用（一条摘要）—— */}
      <div style={{ ...ROW_BOX, alignItems: 'center', borderColor: 'var(--jp-accent)' }}>
        <span style={{ color: HIGHLIGHT, fontSize: 11 }}>当前使用</span>
        <strong style={{ fontWeight: 600 }}>{hasUsable ? currentHqLib.name : '（还没有安装音色库）'}</strong>
        {hasUsable && activeRecord?.presetsKnown === true ? (
          <span style={SMALL}>{presetSummary?.bank0 ?? 0} 个可选音色</span>
        ) : hasUsable ? (
          // adj1017：音色表没解析时，**不能**拿 GM 回退的 128 个当"本库音色数"（会和别的库看起来一样）
          <span style={{ color: 'var(--jp-warning)', fontSize: 11 }}>本库音色表未读取</span>
        ) : (
          <span style={{ color: 'var(--jp-warning)', fontSize: 11 }}>装好基础音色库后才能试听</span>
        )}
        {activeRecord?.present === false && (
          <span style={{ color: 'var(--jp-warning)', fontSize: 11 }}>· 本地文件不在了</span>
        )}
        <span style={{ ...SMALL, marginLeft: 'auto' }}>试听与导出都用这个库</span>
      </div>

      {/* —— 1. 音色库：扫描结果 + 列表 + 推荐 —— */}
      <section>
        <div className="pcfg-group-title">
          音色库
          <span style={{ color: HIGHLIGHT, marginLeft: 6, fontSize: 11 }}>
            （自动扫描本机；「使用」切到哪个库，试听与导出就用哪个库的声音）
          </span>
        </div>

        {/* 1a. 扫描状态：三个位置各扫到几个 —— 这是"为什么没找到"的唯一线索 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
          <button className="btn" style={BTN} disabled={scanning} onClick={() => void rescan()}>
            {scanning ? '扫描中…' : '重新扫描'}
          </button>
          <button className="btn" style={BTN} onClick={() => void openBankDir()} title="打开 %APPDATA%\\…\\soundfonts">
            打开音色库目录
          </button>
          {scanInfo ? (
            <span style={SMALL}>
              上次扫描 {scanTime} · 安装目录 {scanInfo.counts.install} · 我的目录 {scanInfo.counts.appdata}
              {scanInfo.counts.plugin > 0 ? ` · 插件目录 ${scanInfo.counts.plugin}` : ''} · 缓存 {scanInfo.counts.cache}
            </span>
          ) : (
            <span style={SMALL}>{scanning ? '正在扫描…' : '还没扫描'}</span>
          )}
        </div>

        {/* 1b. 空状态：一个能用的库都没有 ⇒ 三条出路 + 三个位置的结果 */}
        {!hasUsable && (
          <div
            style={{
              border: '1px solid var(--jp-warning)',
              borderRadius: 6,
              padding: '8px 10px',
              marginBottom: 8,
              background: 'var(--jp-bg-app)',
            }}
          >
            <div style={{ color: 'var(--jp-warning)', fontWeight: 600 }}>还没有安装任何音色库</div>
            <div style={SMALL}>
              **基础音色库需要先下载（或导入），否则试听/导出没有声音**；其它库都是可选的，装不装都行。
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
              <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => setShowRecommended(true)}>
                下载推荐音色库
              </button>
              <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => fileSf2Ref.current?.click()}>
                导入本地文件…
              </button>
              <button className="btn" style={BTN} disabled={scanning} onClick={() => void rescan()}>
                重新扫描
              </button>
            </div>
            <div style={SMALL}>
              扫描过的地方：
              <br />· 安装目录\soundfonts\ —— {scanInfo ? (scanInfo.counts.install > 0 ? `${scanInfo.counts.install} 个文件` : '不存在或为空') : '未扫描'}
              <br />· 我的音色库目录 —— {scanInfo ? (scanInfo.counts.appdata > 0 ? `${scanInfo.counts.appdata} 个文件` : '不存在或为空') : '未扫描'}
              <br />· 本机缓存 —— {scanInfo ? (scanInfo.counts.cache > 0 ? `${scanInfo.counts.cache} 个库` : '空') : '未扫描'}
            </div>
          </div>
        )}

        {/* 1c. 已安装的库（**只放真的有文件的**；推荐/未下载的库不在这里） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.length === 0 && (
            <div style={{ ...SMALL, padding: '4px 2px' }}>
              目前没有任何已安装的音色库。装好之后它才会出现在这里。
            </div>
          )}
          {rows.map((row) => {
            const { lib, record } = row
            const using = lib.id === currentHqLib.id
            const count = presetCountOf(row)
            const working = busy === lib.id
            return (
              <div
                key={lib.id}
                style={{
                  ...ROW_BOX,
                  borderColor: using ? 'var(--jp-accent)' : 'var(--jp-border)',
                }}
              >
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontWeight: 600 }}>{lib.name}</strong>
                    {using && <span style={{ color: 'var(--jp-accent)', fontSize: 11 }}>✓ 当前</span>}
                    {!row.known && <span style={{ ...SMALL }}>（已导入）</span>}
                  </div>
                  <div style={SMALL}>
                    {sourceLabel(row)} · {MB(record?.sizeBytes ?? lib.sizeBytes)} MB ·{' '}
                    {count === null ? '音色数未知（选中后读取）' : `${count} 音色`}
                    {lib.license ? ` · ${lib.license}` : ''}
                  </div>
                  {record && (
                    <div style={{ ...SMALL, wordBreak: 'break-all' }}>
                      {record.fileName}
                      {record.location ? ` · ${LOCATION_LABEL[record.location] ?? record.location}` : ''}
                      {presetCountOf(row) !== null && record.presets.some((p) => p.bank !== 0)
                        ? `（另有 ${record.presets.filter((p) => p.bank !== 0).length} 个变体/鼓组，暂不可选）`
                        : ''}
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
                  {isHostEmbedded() && row.known && (
                    <button className="btn" style={BTN} disabled={working} onClick={() => void importViaHost(lib)}>
                      从插件目录导入
                    </button>
                  )}
                  <button className="btn" style={BTN} disabled={working} onClick={() => void exportDataFile(lib)}>
                    导出
                  </button>
                  <button
                    className="btn"
                    style={{ ...BTN, color: 'var(--jp-danger)' }}
                    disabled={working}
                    onClick={() => void removeBank(row)}
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* 1c-2. 曾经装过、现在文件不在了（记录保留，放回去再扫就恢复） */}
        {missing.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>
              有 {missing.length} 个库的文件不在了（记录与音色表已保留，把文件放回去再点「重新扫描」即可恢复）：
            </div>
            {/* 缺失的库也走同一套行渲染，只是不参与"使用" */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {missing.map((row) => (
                <div key={`miss-${row.lib.id}`} style={{ ...ROW_BOX, opacity: 0.7 }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <strong style={{ fontWeight: 600 }}>{row.lib.name}</strong>
                    <span style={{ ...SMALL, marginLeft: 6 }}>文件不在了</span>
                    <div style={SMALL}>
                      {row.record?.fileName} · {MB(row.record?.sizeBytes ?? row.lib.sizeBytes)} MB
                      {row.record ? ` · ${row.record.presets.length} 音色（已缓存）` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="btn" style={BTN} disabled={scanning} onClick={() => void rescan()}>
                      重新扫描
                    </button>
                    <button
                      className="btn"
                      style={{ ...BTN, color: 'var(--jp-danger)' }}
                      disabled={busy === row.lib.id}
                      onClick={() => void removeBank(row)}
                    >
                      删除记录
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 1d. 添加本地文件 + 扫描诊断 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => fileSf2Ref.current?.click()}>
            添加音色库…
          </button>
          <span style={SMALL}>选 .sf2 / .sf3；会自动读出库名与音色表（同一个库再导入 = 换文件）。</span>
        </div>
        {scanInfo && scanInfo.problems.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>
              有 {scanInfo.problems.length} 个文件被跳过（不影响其它库）：
              <button
                className="btn"
                style={{ ...BTN, fontSize: 10, padding: '1px 6px', marginLeft: 6 }}
                onClick={() => setShowProblems((v) => !v)}
              >
                {showProblems ? '收起' : '看原因'}
              </button>
            </div>
            {showProblems && (
              <div style={SMALL}>
                {scanInfo.problems.map((p, i) => (
                  <div key={`${p.file}-${i}`}>
                    · {p.file}：{p.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 1e. 推荐（一个库都没有时自动展开） */}
        <div style={{ marginTop: 10 }}>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setShowRecommended((v) => !v)}
          >
            <span style={{ width: 12 }}>{showRecommended || !hasUsable ? '▾' : '▸'}</span>
            <span style={{ color: 'var(--jp-text-secondary)', fontWeight: 600 }}>可选 / 推荐音色库</span>
            <span style={SMALL}>（还没装的库只在这里介绍；给出体积/许可/音色数与推荐理由，下不下你定）</span>
          </div>
          {(showRecommended || !hasUsable) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {RECOMMENDED_BANKS.map((lib) => {
                const rec = records.find((r) => r.id === lib.id)
                const ready = rec && rec.present !== false
                const working = busy === lib.id
                const canDownload = lib.autoDownload !== false && lib.source.trim() !== ''
                return (
                  <div key={`rec-${lib.id}`} style={ROW_BOX}>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong style={{ fontWeight: 600 }}>{lib.name}</strong>
                        {ready && <span style={{ color: 'var(--jp-accent)', fontSize: 11 }}>已有</span>}
                      </div>
                      <div style={SMALL}>
                        {MB(lib.sizeBytes)} MB · {lib.presetCount ?? '?'} 音色
                        {lib.license ? ` · ${lib.license}` : ''}
                      </div>
                      {lib.reason && <div style={{ fontSize: 11, color: 'var(--jp-text-secondary)' }}>{lib.reason}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {canDownload && (
                        <button
                          className="btn"
                          style={{ ...BTN, color: 'var(--jp-accent)' }}
                          disabled={working}
                          onClick={() => void downloadAndRegister(lib)}
                        >
                          {working ? '处理中…' : ready ? '重新获取' : '下载并导入'}
                        </button>
                      )}
                      {lib.downloadPage && (
                        <button
                          className="btn"
                          style={BTN}
                          title={lib.downloadPage}
                          onClick={() => window.open(lib.downloadPage, '_blank', 'noopener,noreferrer')}
                        >
                          打开下载页
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              <div style={SMALL}>
                需要更多库？把任意 .sf2 放进「我的音色库目录」再点「重新扫描」，或用「导入本地文件…」。
              </div>
            </div>
          )}
        </div>

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
        {hqDl === 'preparing' && <div style={{ ...SMALL, marginTop: 4 }}>{playbackCopy.loading}</div>}
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

      {/* —— 2. 管理（当前库）—— */}
      <section>
        <div className="pcfg-group-title">管理（当前库）</div>
        <div style={ROW_BOX}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <div>
              文件：{activeRecord?.fileName ?? '（还没有本地文件）'}
              {activeRecord ? ` · ${MB(activeRecord.sizeBytes)} MB` : ''}
            </div>
            <div style={SMALL}>
              位置：{activeRecord?.location ? LOCATION_LABEL[activeRecord.location] ?? activeRecord.location : '未知'}
              {activeRecord?.present === false ? ' · 文件不在了' : ''}
            </div>
            <div style={SMALL}>
              扫描过的地方：安装目录 {scanInfo?.counts.install ?? 0} · 我的目录 {scanInfo?.counts.appdata ?? 0} · 缓存{' '}
              {scanInfo?.counts.cache ?? 0}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn" style={BTN} disabled={busy === currentHqLib.id} onClick={() => void exportDataFile(currentHqLib)}>
              导出音色文件
            </button>
            <button
              className="btn"
              style={{ ...BTN, color: 'var(--jp-danger)' }}
              disabled={!activeRecord || busy === currentHqLib.id}
              onClick={() => void removeBank(activeRow)}
            >
              删除本地副本
            </button>
          </div>
        </div>
      </section>

      {/* —— 3. 选音色（当前库）—— */}
      <section>
        <div className="pcfg-group-title">
          选音色
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
          <span style={{ ...SMALL, marginLeft: 'auto' }}>
            已选 <strong style={{ color: 'var(--jp-text-primary)' }}>{enabled.length}</strong> / {voiceTotal}
            {activeRecord?.presetsKnown === true ? '（本库）' : '（GM 标准名，本库音色表还没读到）'}
          </span>
        </div>
        {presetSummary && presetSummary.other > 0 && (
          <div style={{ ...SMALL, marginTop: 4 }}>
            本库共 {presetSummary.total} 个预设：bank 0 的 {presetSummary.bank0} 个可选；另有 {presetSummary.other}{' '}
            个变体/鼓组（要 bank select，暂不开放）。
          </div>
        )}
        {activeRecord?.presetsKnown !== true && (
          <div style={{ ...SMALL, marginTop: 4 }}>
            还没读到这个库的音色表——先在上面把它下载/导入好；在那之前音色按 GM 标准 128 个来选。
          </div>
        )}
      </section>

      {/* —— 4. 使用（只读说明）—— */}
      <section>
        <div className="pcfg-group-title">使用</div>
        <div style={{ ...SMALL, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>· 试听：音色下拉只列本库已勾选的音色（「自动」时按谱面 `Y:` / 声部名路由）。</span>
          <span>· 导出音频 / MIDI：用本库的声音。</span>
          <span>· 谱面里 `Y:` 写的是**中文音色名**，换库不会改谱面内容，也不会改排版。</span>
          <span>
            · 民族乐器名（二胡/琵琶/古筝…）按**「拟」**映射到最接近的 GM 音色——不是真实采样，
            要真民乐请用外部音源（可先导出 MIDI）。
          </span>
        </div>
      </section>

      {/* —— 5. 收藏导入导出 —— */}
      <section>
        <div className="ijipu-form-label">
          收藏
          <span style={{ color: HIGHLIGHT, marginLeft: 6, fontSize: 11 }}>
            （导出=当前库 + 每个库各自的收藏；音色文件请在上面按库操作）
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
          <div style={{ ...SMALL, marginTop: 6, lineHeight: 1.6 }}>
            这个库不能应用内自动下载时，可以**手动装一次**：点它那一行的「下载页」自己下一个，
            再回来点「导入本地文件…」选它。装好之后一直用本地那份、不再联网。
            <br />
            下载页：<span style={{ userSelect: 'text' }}>{currentHqLib.downloadPage}</span>
          </div>
        )}
      </section>

      {/* —— 6. 操作结果提示 —— */}
      {notice && (
        <div style={{ color: notice.startsWith('✓') ? 'var(--jp-text-primary)' : 'var(--jp-danger)', fontSize: 11 }}>
          {notice}
        </div>
      )}

      {/* —— 7. 说明 —— */}
      <div style={SMALL}>
        音色库与试听音色属本机偏好，不随谱保存。一个谱同一时刻只用一个音色库。
      </div>
    </div>
  )
}
