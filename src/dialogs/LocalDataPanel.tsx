/**
 * dialogs/LocalDataPanel.tsx — 设置「本机配置」子页签（adj1085 / P1）
 *
 * 用户口径：桌面壳的配置应在个人目录里、可自己找到；换机器能带走。
 * 这里提供三件事：
 *  · 显示配置落点（桌面 = `%APPDATA%\iJipu`；网页 = 浏览器缓存）；
 *  · 「打开配置目录」（仅桌面）；
 *  · 「导出设置」「导入设置」zip（三端都可用，包内是 settings.json + 卡片图附件）。
 */
import { useEffect, useRef, useState } from 'react'
import { isTauriShell } from '../brand/env'
import { desktopPrefsPath, flushPrefsNow, openPrefsDir } from '../store/prefs'
import { downloadSettingsZip, exportSettingsZip, importSettingsZip } from '../store/settingsArchive'

export function LocalDataPanel() {
  const desktop = isTauriShell()
  const [path, setPath] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!desktop) return
    let alive = true
    void desktopPrefsPath().then((p) => {
      if (alive) setPath(p)
    })
    return () => {
      alive = false
    }
  }, [desktop])

  const say = (text: string, bad = false): void => {
    setMsg(text)
    setErr(bad)
  }

  const exportZip = async (): Promise<void> => {
    setBusy(true)
    try {
      const bytes = await exportSettingsZip()
      downloadSettingsZip(bytes)
      say(`已导出设置备份（${(bytes.byteLength / 1024).toFixed(0)} KB）`)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
    } finally {
      setBusy(false)
    }
  }

  const importZip = async (file: File | null): Promise<void> => {
    if (!file) return
    if (
      !window.confirm(
        '导入会合并同名设置（不删除本机独有的项），并在完成后重新加载界面。\n\n继续导入吗？',
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const r = await importSettingsZip(bytes)
      await flushPrefsNow()
      say(
        `已导入 ${r.keys} 项设置、${r.files} 个附件` +
          (r.droppedImage ? '（有一张卡片背景图缺失，已清空该引用）' : '') +
          '，正在重新加载…',
      )
      setTimeout(() => window.location.reload(), 800)
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), true)
      setBusy(false)
    }
  }

  return (
    <>
      <p className="pcfg-note">
        本机配置是「这个人怎么用」的偏好（主题、缩放、卡片、草稿…），不随谱保存；
        谱面自己的设置仍跟着 `.jps` 走。
      </p>
      <div className="pcfg-row">
        <span className="pcfg-row-label">保存位置</span>
        <div className="pcfg-row-ctl">
          {desktop ? (
            <code>{path ?? '（正在读取…）'}</code>
          ) : (
            <span>浏览器本地存储（网站/PWA）；插件由宿主保存在插件目录</span>
          )}
        </div>
      </div>
      <div className="pcfg-row">
        <span className="pcfg-row-label">配置文件</span>
        <div className="pcfg-row-ctl" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {desktop && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                void openPrefsDir().catch((e: unknown) => say(e instanceof Error ? e.message : String(e), true))
              }}
            >
              打开配置目录
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => void exportZip()}>
            导出设置…
          </button>
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            导入设置…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              e.target.value = ''
              void importZip(f)
            }}
          />
        </div>
      </div>
      {desktop && (
        <p className="pcfg-note">
          桌面壳把配置写在个人目录的 <code>iJipu\settings.json</code>（备份 <code>settings.bak.json</code>，
          卡片图在 <code>files\</code>）；卸载时默认保留，选「完全卸载」才会一并删除。
        </p>
      )}
      {msg !== '' && (
        <p className="pcfg-note" style={{ color: err ? 'var(--jp-danger, #d64545)' : undefined }}>
          {msg}
        </p>
      )}
    </>
  )
}
