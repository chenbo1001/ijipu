/**
 * dialogs/SoundBankPanel.tsx — 音色库管理面板（adj331/332/342；adj384 从独立对话框移入「设置」标签）
 *
 * SpessaSynth 高保真为默认音源（桌面随安装包内置在安装目录，直接读取；Web 首次打开自动下载并缓存，离线可用）：
 *  - 库行：展开查看库内全部 GM 音色（128 种）+「全选/全消」+「内置」标识（无需下载/删除）
 *  - 音色勾选进入试听列表（playbackHqEnabled）
 *  - 「导入/导出音色文件」（SF2/SF3 本体，供不便联网用户导入/分享）+「导入/导出收藏配置」（JSON）
 *  - adj416：桌面端音源随安装包内置在**安装目录**（`generaluser_gs.sf2`）——直接读文件，不显示下载提示
 *
 * 属**本机用户偏好（L1）**：不随谱保存（分层见 docs/SETTINGS-AUDIT.md）。
 */
import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { playbackCopy } from '../brand/copy'
import { HQ_LIBRARIES, GM_VOICE_OPTIONS, getHqLibrary, hasBuiltinBank } from '../playback/spessaSynthBackend'
import { createHqCache, prefetchHqLibraryProgress, resolveHqBank } from '../playback/spessaCache'

const HIGHLIGHT = 'var(--jp-text-muted)'
const BTN = { padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' as const, background: 'var(--jp-bg-app)', border: '1px solid var(--jp-border)', color: 'var(--jp-text-primary)', borderRadius: '6px' }

export function SoundBankPanel() {
  const hqCache = useRef(createHqCache())
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ [HQ_LIBRARIES[0]?.id ?? 'generaluser_gs']: true }))
  // adj347/348：打开音色库管理即自动后台下载音源（初次体验）；仅文字提示，不阻塞其它交互
  // adj416：桌面端随安装包内置（安装目录 generaluser_gs.sf2）→ 直接可用，显示「已内置」而非下载提示
  const [hqDl, setHqDl] = useState<'idle' | 'loading' | 'done' | 'builtin' | 'error'>('idle')
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

  // adj347/349：打开音色库管理自动下载音源——延迟到 UI 渲染后再触发，不干扰打开/交互
  // adj416：先探测桌面安装目录内置音源（极快）——有就直接用，不显示「正在下载」提示
  useEffect(() => {
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const lib = getHqLibrary()
          if (await hasBuiltinBank(lib)) {
            setHqDl('builtin')
            return
          }
          setHqDl('loading')
          await prefetchHqLibraryProgress(lib, hqCache.current)
          setHqDl('done')
        } catch {
          setHqDl('error')
        }
      })()
    }, 60)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      // adj416：缓存 → 安装目录内置 SF2 → 联网（内置音源也能直接导出，不再报「未缓存」）
      const { bank: ab } = await resolveHqBank(currentHqLib, hqCache.current)
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
          // adj418：列表高度收到「约 10 条音色」（约 10×19px 行高 + 表头）——整个面板不撑高，
          // 设置对话框不用滚动就能看到底部按钮；更多音色在列表内滚动查看。
          <div className="soundbank-voices" style={{ marginLeft: 20, maxHeight: 212, overflow: 'auto', borderLeft: '1px solid var(--jp-border)', paddingLeft: 8, marginBottom: 6 }}>
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
    /* adj387：面板宽度收到 2/3（.soundbank-panel）——与其它标签（Row 表单）的视觉宽度对齐 */
    <div className="soundbank-panel" style={{ fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
          SpessaSynth 高保真为默认音源：桌面端随安装包内置（安装目录 generaluser_gs.sf2，离线直接读取）；Web 端首次联网下载并缓存到本地，之后直接用。
        </div>
        {/* adj347/348：自动下载——后台进行，仅提示，不阻塞其它操作 */}
        {hqDl === 'loading' && (
          <div style={{ color: 'var(--jp-warning)', fontSize: 11 }}>
            ⏳ 正在后台下载音色库（约30MB，仅首次）…下载期间可正常操作。
          </div>
        )}
        {/* adj416：桌面端随安装包内置音源（安装目录 generaluser_gs.sf2）→ 直接读取，无需下载 */}
        {hqDl === 'builtin' && (
          <div style={{ color: 'var(--jp-accent)', fontSize: 11 }}>{playbackCopy.builtinBankHint}</div>
        )}
        {hqDl === 'error' && (
          <div style={{ color: 'var(--jp-danger)', fontSize: 11 }}>
            ✗ 音色库下载失败——请检查网络，或点击「导入音色文件」手动导入 SF2。
          </div>
        )}
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>SpessaSynth 高保真（SF2/SF3，多力度层，GM 全集）</div>
          {HQ_LIBRARIES.map((l) => bankRow(l.id, l.name, l.sizeBytes, '高保真'))}
        </div>
        {notice && <div style={{ color: notice.startsWith('✓') ? 'var(--jp-text-primary)' : 'var(--jp-danger)', fontSize: 11 }}>{notice}</div>}
        <div style={{ color: HIGHLIGHT, fontSize: 11 }}>音色库与试听音色属本机偏好，不随谱保存。</div>
    </div>
  )
}
