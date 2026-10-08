/**
 * dialogs/SoundBankPanel.tsx — 音色库管理面板（adj331/332/342；adj384 从独立对话框移入「设置」标签）
 *
 * SpessaSynth 高保真为默认音源（桌面随安装包内置在安装目录，直接读取；Web 首次打开自动下载并缓存，离线可用）：
 *  - **音源库行**：名称 + 类型 + 体积 + 「内置」标识 + 「全选 / 指定音色 / 全消」三个按钮；
 *  - 「指定音色」按钮弹独立对话框（VoicePickerDialog）选要启用的 GM 音色（128 种）——不再在面板
 *    内展开列表；
 *  - 「全选 / 全消」是「指定音色」对话框里的两个**快捷操作**在面板上的**平级按钮**；
 *  - 「导入/导出音色文件」（SF2/SF3 本体，供不便联网用户导入/分享）+「导入/导出收藏配置」（JSON）；
 *  - adj416：桌面端音源随安装包内置在**安装目录**（`generaluser_gs.sf2`）——直接读文件，不显示下载提示；
 *
 * 属**本机用户偏好（L1）**：不随谱保存（分层见 docs/SETTINGS-AUDIT.md）。
 *
 * adj509：内容**重新梳理排版**——按"音源状态 / 音色启用 / 数据导入导出 / 说明"四块分组，
 * 每块以小节标题明确边界；分组之间留 12px 间距，与「设置 → 谱面」一致。
 */
import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { playbackCopy } from '../brand/copy'
import { HQ_LIBRARIES, GM_VOICE_OPTIONS, getHqLibrary, hasBuiltinBank, hqBankFailureText } from '../playback/spessaSynthBackend'
import { createHqCache, prefetchHqLibraryProgress, resolveHqBank } from '../playback/spessaCache'

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

export function SoundBankPanel() {
  const hqCache = useRef(createHqCache())
  const [notice, setNotice] = useState<string | null>(null)
  // adj347/348：打开音色库管理即自动后台下载音源（初次体验）；仅文字提示，不阻塞其它交互
  // adj416：桌面端随安装包内置（安装目录 generaluser_gs.sf2）→ 直接可用，显示「已内置」而非下载提示
  const [hqDl, setHqDl] = useState<'idle' | 'loading' | 'done' | 'builtin' | 'error'>('idle')
  /** adj724b：失败原因（用于给用户"该怎么做"的提示，而不是笼统的"请检查网络"） */
  const [hqDlError, setHqDlError] = useState<unknown>(null)
  const enabled = useUiStore((s) => s.playbackHqEnabled)
  const hqLibrary = useUiStore((s) => s.playbackHqLibrary)
  const hqVoice = useUiStore((s) => s.playbackHqVoice)
  const setPlaybackHqLibrary = useUiStore((s) => s.setPlaybackHqLibrary)
  const setPlaybackHqVoice = useUiStore((s) => s.setPlaybackHqVoice)
  const setPlaybackHqEnabled = useUiStore((s) => s.setPlaybackHqEnabled)
  const openModal = useUiStore((s) => s.openModal)
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
        } catch (e) {
          // adj724b：把原因留下来，提示里要说清"是地址不可达、可以手动导入"
          setHqDlError(e)
          setHqDl('error')
        }
      })()
    }, 60)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // adj342：全选 / 全消 改为面板直连的**快捷按钮**（adj509：从「指定音色」对话框里的复选框抽出）——
  // 不再需要展开库行查看全部音色后再勾选。
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

  return (
    /* adj387：面板宽度收到 2/3（.soundbank-panel）——与其它标签（Row 表单）的视觉宽度对齐 */
    <div className="soundbank-panel" style={{ fontSize: 12, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* —— 1. 音源状态 —— */}
      <section>
        {/* adj581（用户要求）：底栏内容标题统一成"行标题"样式（与设置→谱面里「纸张与边距」一致） */}
        <div className="pcfg-group-title">音源</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            border: '1px solid var(--jp-border)',
            borderRadius: 6,
            background: 'var(--jp-bg-app)',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{currentHqLib.name}</span>
          <span style={{ color: HIGHLIGHT, fontSize: 11, flexShrink: 0 }}>高保真 SF2</span>
          <span style={{ color: HIGHLIGHT, fontSize: 11, flexShrink: 0 }}>{(currentHqLib.sizeBytes / 1_000_000).toFixed(1)} MB · 内置</span>
        </div>
        {/* adj416：桌面端随安装包内置音源（安装目录 generaluser_gs.sf2）→ 直接读取，无需下载 */}
        {hqDl === 'builtin' && (
          <div style={{ color: 'var(--jp-accent)', fontSize: 11, marginTop: 4 }}>{playbackCopy.builtinBankHint}</div>
        )}
        {/* adj347/348：自动下载——后台进行，仅提示，不阻塞其它操作 */}
        {hqDl === 'loading' && (
          <div style={{ color: 'var(--jp-warning)', fontSize: 11, marginTop: 4 }}>
            ⏳ 正在后台下载音色库（约 30MB，仅首次）…下载期间可正常操作。
          </div>
        )}
        {hqDl === 'error' && (
          /**
           * adj724b：失败提示改成**能照着做**的（见 `hqBankFailureText`）。
           * 旧的"请检查网络"会让人一直以为是自己网络差，而实测最常见的失败是
           * **该下载地址在用户所在网络不可达**（raw.githubusercontent.com 连不上、
           * jsDelivr 又因 32.3 MB 超过其 20 MB 单文件上限而直接 403）。
           */
          <div style={{ color: 'var(--jp-danger)', fontSize: 11, marginTop: 4, whiteSpace: 'pre-wrap' }}>
            {hqBankFailureText(currentHqLib, hqDlError)}
          </div>
        )}
      </section>

      {/* —— 2. 音色启用 —— */}
      <section>
        {/* adj581（用户要求）：同上——统一成行标题样式 */}
        <div className="pcfg-group-title">
          音色启用
          <span style={{ color: HIGHLIGHT, marginLeft: 6, fontSize: 11 }}>
            （仅已勾选项进入「试听」面板的音色下拉）
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '6px 8px',
            border: '1px solid var(--jp-border)',
            borderRadius: 6,
            background: 'var(--jp-bg-app)',
          }}
        >
          <button className="btn" style={BTN} onClick={selectAll}>全选</button>
          {/* adj509：「指定音色」按钮——点击弹独立对话框（VoicePickerDialog）选要启用的 GM 音色，
                  含搜索 / 反选 / 按组选本组等快捷操作；列表从面板移除后这里更紧凑。 */}
          <button
            className="btn"
            style={{ ...BTN, color: 'var(--jp-accent)' }}
            onClick={() => openModal('voicePicker')}
            title="从 128 种 GM 音色里勾选要启用的音色"
          >
            指定音色…
          </button>
          <button className="btn" style={BTN} onClick={clearAll}>全消</button>
          <span style={{ color: HIGHLIGHT, fontSize: 11, marginLeft: 'auto' }}>
            已选 <strong style={{ color: 'var(--jp-text-primary)' }}>{enabled.length}</strong> / {GM_VOICE_OPTIONS.length}
          </span>
        </div>
      </section>

      {/* —— 3. 数据导入导出 —— */}
      <section>
        <div className="ijipu-form-label">
          收藏与音色文件
          <span style={{ color: HIGHLIGHT, marginLeft: 6, fontSize: 11 }}>
            （收藏=启用音色 + 音源配置；音色文件=SF2/SF3 本体）
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" style={BTN} onClick={exportConfig}>导出收藏</button>
          <button className="btn" style={BTN} onClick={() => fileRef.current?.click()}>导入收藏</button>
          <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => fileSf2Ref.current?.click()}>导入音色文件</button>
          <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => void exportDataFile()}>导出音色文件</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importConfig(f); e.target.value = '' }} />
          <input ref={fileSf2Ref} type="file" accept=".sf2,.sf3" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importDataFile(f); e.target.value = '' }} />
        </div>
      </section>

      {/* —— 4. 操作结果提示 —— */}
      {notice && (
        <div style={{ color: notice.startsWith('✓') ? 'var(--jp-text-primary)' : 'var(--jp-danger)', fontSize: 11 }}>{notice}</div>
      )}

      {/* —— 5. 说明 —— */}
      <div style={{ color: HIGHLIGHT, fontSize: 11 }}>
        音色库与试听音色属本机偏好，不随谱保存。
      </div>
    </div>
  )
}