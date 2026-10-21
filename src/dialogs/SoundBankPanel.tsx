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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '../store/uiStore'
import { hostBankUrl, hostBridge, isHostEmbedded } from '../store/hostBridge'
import { playbackCopy } from '../brand/copy'
import { GM_VOICE_OPTIONS, resolveActiveLibrary, hasBuiltinBank, hqBankFailureText } from '../playback/spessaSynthBackend'
import { createHqCache, prefetchHqLibraryProgress, resolveHqBank } from '../playback/spessaCache'
// adj1010：导入 = 读懂"这是哪个库"→ 存字节（banks）+ 登记元数据（libs）
import { createBankRegistry, readBankFile } from '../playback/bankRegistry'

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
  /** adj1010：库元数据注册表（IndexedDB 的 `libs` 表；字节仍在 `banks` 表） */
  const registry = useRef(createBankRegistry())
  const [notice, setNotice] = useState<string | null>(null)
  // adj347/348：打开音色库管理即自动后台下载音源（初次体验）；仅文字提示，不阻塞其它交互
  // adj416：桌面端随安装包内置（安装目录 generaluser_gs.sf2）→ 直接可用，显示「已内置」而非下载提示
  // adj953：`'preparing'` = 正在**问宿主/查缓存/探测内置**（都很快）——这段不能再谎报"正在下载 30MB"；
  //        只有真的走联网那一步才切到 `'downloading'`（用户实报的假提示就是这一点）
  const [hqDl, setHqDl] = useState<'idle' | 'preparing' | 'downloading' | 'done' | 'builtin' | 'error'>('idle')
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
  /**
   * adj1011：面板上显示的必须是**当前选中的库**（原来写死 `HQ_LIBRARIES[0]` ⇒ 切了库还显示 GeneralUser）。
   * 用 `resolveActiveLibrary` 的同一个判据：库被删/查不到时回退默认库并标 `fallback`。
   */
  const active = useMemo(() => resolveActiveLibrary(hqLibrary), [hqLibrary])
  const currentHqLib = active.lib

  // adj347/349：打开音色库管理自动下载音源——延迟到 UI 渲染后再触发，不干扰打开/交互
  // adj416：先探测桌面安装目录内置音源（极快）——有就直接用，不显示「正在下载」提示
  // adj953：**再问一次宿主（插件目录）**——嵌入版里那份就是"随文库一起走"的权威副本，
  //        有它就不联网；只有真的落回联网下载时才显示「正在后台下载…」（用户实报的假提示就是它）
  useEffect(() => {
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          // adj1011：探测/预取的永远是**当前库**（切库后这个 effect 会重跑，见末尾依赖）
          const lib = active.lib
          setHqDl('preparing')
          if (await hasBuiltinBank(lib)) {
            setHqDl('builtin')
            return
          }
          const source = await prefetchHqLibraryProgress(
            lib,
            hqCache.current,
            // adj953：`onProgress` 只在预取**收尾**回调一次 ⇒ 收尾时若还停在 `'downloading'`，说明这轮下完了
            () => setHqDl((s) => (s === 'downloading' ? 'done' : s)),
            hostBankUrl(lib.id),
            // adj953：**真的落回联网那一步**才切成下载提示（宿主/缓存/内置命中时一句话都不说）
            { onRemote: () => setHqDl('downloading') },
          )
          if (source === 'builtin') setHqDl('builtin')
          else setHqDl('done')
        } catch (e) {
          // adj724b：把原因留下来，提示里要说清"是地址不可达、可以手动导入"
          setHqDlError(e)
          setHqDl('error')
        }
      })()
    }, 60)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hqLibrary])

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
  /**
   * adj1010：导入**不再写死默认库的键**。
   *
   * 旧实现把字节存进 `currentHqLib.id`（= generaluser_gs）⇒ 用户导入 FluidR3 后，
   * 字节存在 GeneralUser 的名下，界面名字/音色列表却还是 GeneralUser（用户实报的 bug）。
   * 现在：先按文件内容（INAM）认出"这是哪个库"，再写 `banks/<认出来的 id>` + `libs/<同 id>`。
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
    setHqDl('done')
    setNotice(
      `✓ 已导入音色库「${record.name}」：${record.presets.length} 个音色 · ${(record.sizeBytes / 1_000_000).toFixed(1)} MB` +
        (existed ? '（已替换原文件）' : ''),
    )
  }
  /**
   * adj729（用户要求）：**嵌入版里由插件来导入**，文件直接写进**插件目录**
   * （`<配置目录>/plugins/<插件 id>/soundfonts/<id>.sf2`）⇒ 随文库一起走。
   *
   * 走宿主而不是这里读文件再发过去：SF2 有 32 MB，`postMessage` 传要 base64（≈43 MB），
   * 慢且吃内存；插件在 Obsidian 窗口里自己弹选择器、自己写盘，一个字节都不用跨窗口搬。
   */
  const importViaHost = async (): Promise<void> => {
    const bridge = hostBridge()
    if (!bridge) return
    setNotice('请在系统文件选择器里选 .sf2 文件…')
    try {
      const r = await bridge.importSoundbank(currentHqLib.id)
      if (r.canceled) {
        setNotice('已取消导入')
        return
      }
      if (!r.ok) {
        setNotice(`导入失败：${r.error ?? '未知原因'}`)
        return
      }
      setHqDl('done')
      setNotice(`✓ 已导入音色数据 → ${currentHqLib.name}（已存到插件目录，随文库一起走）`)
    } catch (e) {
      setNotice(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const exportDataFile = async () => {
    try {
      // adj416：缓存 → 安装目录内置 SF2 → 联网（内置音源也能直接导出，不再报「未缓存」）
      // adj729：嵌入版里优先取**插件目录**那份（`resolveHqBank` 的第一个参数就是宿主地址）
      const { bank: ab } = await resolveHqBank(currentHqLib, hqCache.current, hostBankUrl(currentHqLib.id))
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
        {/* adj1011：选中的库查不到（被删/换机器）⇒ 如实说一句，别让用户以为"还是在用我选的那个" */}
        {active.fallback && (
          <div style={{ color: 'var(--jp-warning)', fontSize: 11, marginTop: 4 }}>
            你选的音色库不在了（可能被删或换了机器），已临时用「{currentHqLib.name}」。
          </div>
        )}
        {hqDl === 'builtin' && (
          <div style={{ color: 'var(--jp-accent)', fontSize: 11, marginTop: 4 }}>{playbackCopy.builtinBankHint(`${currentHqLib.id}.sf2`)}</div>
        )}
        {/* adj953：**先问宿主/查缓存/探测内置**——这几步都很快，别说成"正在下载 30MB" */}
        {hqDl === 'preparing' && (
          <div style={{ color: HIGHLIGHT, fontSize: 11, marginTop: 4 }}>{playbackCopy.loading}</div>
        )}
        {/* adj347/348：自动下载——后台进行，仅提示，不阻塞其它操作
            adj953：**只有真要走联网那一步**（宿主/缓存/内置都没接住）才显示这句 */}
        {hqDl === 'downloading' && (
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
            {hqBankFailureText(currentHqLib, hqDlError instanceof Error ? hqDlError.message : String(hqDlError ?? "") )}
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
          {/* adj728（用户要求）：**自动下载失败时的唯一出路** —— 自己下、再导入。
              所以这里除了「导入音色文件」还必须有「打开下载页」，并把三步写清楚（见下面的引导块）。 */}
          {currentHqLib.downloadPage && (
            <button
              className="btn"
              style={BTN}
              title={currentHqLib.downloadPage}
              onClick={() => window.open(currentHqLib.downloadPage, '_blank', 'noopener,noreferrer')}
            >
              打开下载页
            </button>
          )}
          <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => { if (isHostEmbedded()) void importViaHost(); else fileSf2Ref.current?.click() }}>导入音色文件</button>
          <button className="btn" style={{ ...BTN, color: 'var(--jp-accent)' }} onClick={() => void exportDataFile()}>导出音色文件</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importConfig(f); e.target.value = '' }} />
          <input ref={fileSf2Ref} type="file" accept=".sf2,.sf3" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importDataFile(f); e.target.value = '' }} />
        </div>
        {/* adj728（用户要求）：**手动下载 + 导入的引导说明**。
            为什么必须写在这里：自动下载在部分网络下必然失败（见 hqBankFailureText 的说明），
            此时用户需要的是"去哪儿拿文件、拿到后点哪个按钮"，而不是一句"请检查网络"。 */}
        {currentHqLib.downloadPage && (
          <div style={{ color: HIGHLIGHT, fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
            自动下载失败（常见于该地址在你所在网络不可达）时，可以**手动装一次**，之后一直用本地缓存、不再联网：
            <br />① 点「打开下载页」在浏览器里下载 <code>{`${currentHqLib.id}.sf2`}</code>
            {' '}（约 {(currentHqLib.sizeBytes / 1_000_000).toFixed(1)} MB）；
            <br />② 回到这里点「导入音色文件」，选刚下载的那个文件；
            <br />③ 提示「✓ 已导入音色数据」即可试听（下次打开也不用再导入）。
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
        音色库与试听音色属本机偏好，不随谱保存。
      </div>
    </div>
  )
}