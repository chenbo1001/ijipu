/**
 * dialogs/WorkspaceDialog.tsx — 工作区（adj540）
 *
 * 为什么要有它：手机上没有"双击 .jps 打开"这回事——系统文件选择器对自定义扩展名态度不一致，
 * 保存用的 `showSaveFilePicker` 在移动端还出现过"点了没反应"（adj405）。工作区把打开/保存变成
 * **在一个文件夹里挑文件/写文件**，一次授权、之后都在这里操作。
 *
 * 真机实证（Chrome 151 / Android 10，见 docs/DESKTOP-ASSOC-AND-ANDROID.md §3）：目录选择器可用、
 * 能写入且回读一致、刷新后句柄仍在（只需一次授权点击）⇒ **纯网页即可，不需要 Android 壳**。
 *
 * 用户要求：**支持子目录**——列表里目录可进入、面包屑可回退，打开/保存都带相对路径。
 *
 * 两个诚实处理的边界：
 *  ① 授权不能静默申请（浏览器要求用户手势）⇒ 挂载时只 `queryPermission`，是 `prompt` 就显示
 *     「继续访问（需授权）」按钮，由用户点一下（真机实测点完即 granted）。
 *  ② 若系统"没弹选择器"（已安装的 PWA 里可能被限制）不能让用户干等 ⇒ 5 秒后给可操作提示，
 *     建议改用 Chrome 浏览器打开本站（见 `workspaceCopy.pickerNoResponse`）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { workspaceCopy } from '../brand/copy'
import { fileBaseName } from '../store/saveSupport'
import type { WorkspaceRecord } from '../store/fileHandleDb'
import {
  getWorkspace,
  isWorkspaceSupported,
  joinPath,
  parentPath,
  pickWorkspaceDir,
  queryWorkspacePermission,
  readDirEntries,
  rememberWorkspacePath,
  requestWorkspacePermission,
  setWorkspace,
  type DirEntry,
} from '../store/workspace'

/** 「选择文件夹」静默失败的判定时间（超过它还没弹选择器就提示，而不是让用户干等） */
const PICKER_NO_RESPONSE_MS = 5000

export function WorkspaceDialog() {
  const closeModal = useUiStore((s) => s.closeModal)
  const showNotice = useUiStore((s) => s.showNotice)
  const openWorkspaceFile = useDocStore((s) => s.openWorkspaceFile)
  const saveToWorkspace = useDocStore((s) => s.saveToWorkspace)
  const currentName = useDocStore((s) => s.fileName)

  const [ws, setWs] = useState<WorkspaceRecord | null>(null)
  const [path, setPath] = useState<string[]>([])
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [perm, setPerm] = useState<'granted' | 'prompt' | 'denied' | 'unknown'>('unknown')
  const [busy, setBusy] = useState(false)
  /** null = 未展开「保存到此处」的输入框；否则为待保存的文件名 */
  const [saveName, setSaveName] = useState<string | null>(null)

  /** 列目录（读不到就提示，不静默——否则用户只看到"空的"） */
  const refresh = useCallback(
    async (rec: WorkspaceRecord, next: string[]) => {
      setBusy(true)
      try {
        const list = await readDirEntries(rec.handle, next)
        setEntries(list)
        setPath(next)
        void rememberWorkspacePath(next)
      } catch (e) {
        const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        showNotice(workspaceCopy.loadFailed(reason), 'error')
        setEntries([])
      } finally {
        setBusy(false)
      }
    },
    [showNotice],
  )

  // 挂载：取工作区 + **只查**权限（不能在这里申请：申请必须在用户手势内）
  useEffect(() => {
    let alive = true
    void (async () => {
      const rec = await getWorkspace()
      if (!alive || !rec) return
      setWs(rec)
      setPath(rec.path)
      const q = await queryWorkspacePermission(rec.handle)
      if (!alive) return
      setPerm(q)
      if (q === 'granted') void refresh(rec, rec.path)
    })()
    return () => {
      alive = false
    }
  }, [refresh])

  const onPick = async () => {
    if (!isWorkspaceSupported()) {
      showNotice(workspaceCopy.unsupported, 'warn')
      return
    }
    setBusy(true)
    // 静默失败兜底：已安装的 PWA 里选择器可能不弹（adj405 的同类现象）
    const timer = window.setTimeout(() => showNotice(workspaceCopy.pickerNoResponse, 'warn'), PICKER_NO_RESPONSE_MS)
    try {
      const dir = await pickWorkspaceDir()
      if (!dir) return // 用户取消
      const rec: WorkspaceRecord = { handle: dir, path: [] }
      await setWorkspace(rec)
      setWs(rec)
      setPerm('granted')
      await refresh(rec, [])
      showNotice(workspaceCopy.picked(dir.name), 'ok')
    } catch (e) {
      const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      showNotice(workspaceCopy.loadFailed(reason), 'error')
    } finally {
      window.clearTimeout(timer)
      setBusy(false)
    }
  }

  /** 补授权（用户点了按钮 ⇒ 手势成立） */
  const onGrant = async () => {
    if (!ws) return
    setBusy(true)
    try {
      const r = await requestWorkspacePermission(ws.handle)
      setPerm(r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : 'unknown')
      if (r === 'granted') await refresh(ws, path)
    } finally {
      setBusy(false)
    }
  }

  const onOpen = async (name: string) => {
    const ok = await openWorkspaceFile([...path, name])
    if (ok) closeModal()
  }

  const onSaveHere = async () => {
    const raw = (saveName ?? '').trim()
    if (!raw) {
      showNotice(workspaceCopy.emptyDir, 'warn')
      return
    }
    const ok = await saveToWorkspace([...path, `${fileBaseName(raw)}.jps`])
    if (ok) closeModal()
  }

  const crumb = path.length > 0 ? joinPath(path) : (ws?.handle.name ?? '')

  return (
    <Modal title={workspaceCopy.title} width={620} fill>
      <div className="ws-dialog">
        <div className="ws-desc">{workspaceCopy.desc}</div>

        {!ws ? (
          <div className="ws-empty">
            <button type="button" className="btn primary ws-big" onClick={() => void onPick()} disabled={busy}>
              {workspaceCopy.pick}
            </button>
          </div>
        ) : (
          <>
            <div className="ws-head">
              <div className="ws-crumb" title={crumb}>
                <span className="ws-root">{workspaceCopy.rootLabel}</span>
                <span className="ws-sep">/</span>
                {path.map((seg, i) => (
                  <span key={`${seg}-${i}`}>
                    <button
                      type="button"
                      className="ws-crumb-seg"
                      onClick={() => void refresh(ws, path.slice(0, i + 1))}
                      disabled={busy}
                    >
                      {seg}
                    </button>
                    <span className="ws-sep">/</span>
                  </span>
                ))}
              </div>
              <button type="button" className="btn" onClick={() => void onPick()} disabled={busy}>
                {workspaceCopy.switchDir}
              </button>
            </div>

            {perm !== 'granted' ? (
              <div className="ws-gate">
                <button type="button" className="btn primary ws-big" onClick={() => void onGrant()} disabled={busy}>
                  {workspaceCopy.grant}
                </button>
              </div>
            ) : (
              <>
                <div className="ws-list">
                  {path.length > 0 && (
                    <button
                      type="button"
                      className="ws-row ws-row-up"
                      onClick={() => void refresh(ws, parentPath(path))}
                      disabled={busy}
                    >
                      <span className="ws-icon">↰</span>
                      <span className="ws-name">{workspaceCopy.up}</span>
                    </button>
                  )}
                  {entries.map((e) => (
                    <button
                      key={`${e.kind}-${e.name}`}
                      type="button"
                      className="ws-row"
                      onClick={() => void (e.kind === 'dir' ? refresh(ws, [...path, e.name]) : onOpen(e.name))}
                      disabled={busy}
                    >
                      <span className="ws-icon">{e.kind === 'dir' ? '📁' : '🎼'}</span>
                      <span className="ws-name">{e.name}</span>
                    </button>
                  ))}
                  {entries.length === 0 && <div className="ws-none">{workspaceCopy.emptyDir}</div>}
                </div>
                <div className="ws-foot">
                  <span className="ws-hint">{workspaceCopy.onlyListed}</span>
                  {saveName === null ? (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => setSaveName(fileBaseName(currentName))}
                      disabled={busy}
                    >
                      {workspaceCopy.saveHere}
                    </button>
                  ) : (
                    <span className="ws-save">
                      <input
                        className="ws-input"
                        value={saveName}
                        autoFocus
                        placeholder={workspaceCopy.namePlaceholder}
                        onChange={(e) => setSaveName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void onSaveHere()
                        }}
                      />
                      <button type="button" className="btn primary" onClick={() => void onSaveHere()} disabled={busy}>
                        {workspaceCopy.saveBtn}
                      </button>
                    </span>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
