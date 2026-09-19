/**
 * ui/dock/WorkspacePanel.tsx — 工作区面板（adj540，dock 内）
 *
 * 为什么放在**底栏 dock** 而不是弹窗：与「试听 / 导出 / 设置 / 关于」保持同一套操作行为
 * （面板互斥、可调高度、不遮谱面）——这正是 adj462/adj492 定下的约定（用户要求一致）。
 *
 * 它是移动端的"文件管理器"：手机上没有双击打开这回事，系统文件选择器对 `.jps` 这种自定义扩展名
 * 态度不一致（按 MIME 隐藏、只能看到已下载的文件），保存用的 `showSaveFilePicker` 在移动端还
 * 出现过"点了没反应"（adj405）。工作区一次授权后就都在这个文件夹里操作，**支持子目录**。
 *
 * 文件操作与安全约束（都是本轮用户确认的行为）：
 *  · 打开 / 保存到此处 / 新建文件夹 / 重命名 / 移动到… / 删除；
 *  · **重命名与移动**：FSA 对用户选中的目录**没有 `move()`**（只对 OPFS 生效）⇒ 实现是
 *    "读出 → 写新位置 → 回读校验一致 → 才删原文件"，中途失败宁可留重复也不丢内容；
 *  · **删除是永久的**（浏览器文件 API 没有回收站）⇒ 必须二次确认；目录**只允许删空的**
 *    （递归删目录会把用户放在里面的照片/文档一起删掉）；
 *  · 列表**每次打开都重读**（用户确认）：手机上刚用系统工具/微信存进来的 `.jps` 能立刻看到。
 */
import { useCallback, useEffect, useState } from 'react'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { workspaceCopy } from '../../brand/copy'
import { fileBaseName } from '../../store/saveSupport'
import type { WorkspaceRecord } from '../../store/fileHandleDb'
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
  stripJpsExt,
  type DirEntry,
} from '../../store/workspace'

/** 「选择文件夹」静默失败的判定时间（超过它还没弹选择器就提示，而不是让用户干等） */
const PICKER_NO_RESPONSE_MS = 5000

/** 正在编辑的输入框：重命名（带原文件名）或新建文件夹 */
type EditState = { kind: 'rename' | 'newFolder'; value: string; name?: string }
/** 正在"移动到…"：记住来源，列表切成为"目标目录选择器" */
type MoveState = { name: string; fromSegs: string[]; dir: string[] }

export function WorkspacePanel() {
  const showNotice = useUiStore((s) => s.showNotice)
  const closeDock = useUiStore((s) => s.closeDock)
  const active = useUiStore((s) => s.dockOpen && s.dockPanel === 'workspace')
  const openWorkspaceFile = useDocStore((s) => s.openWorkspaceFile)
  const saveToWorkspace = useDocStore((s) => s.saveToWorkspace)
  const createWorkspaceDir = useDocStore((s) => s.createWorkspaceDir)
  const renameWorkspaceFile = useDocStore((s) => s.renameWorkspaceFile)
  const moveWorkspaceFile = useDocStore((s) => s.moveWorkspaceFile)
  const deleteWorkspaceFile = useDocStore((s) => s.deleteWorkspaceFile)
  const deleteWorkspaceDir = useDocStore((s) => s.deleteWorkspaceDir)
  const currentName = useDocStore((s) => s.fileName)

  const [ws, setWs] = useState<WorkspaceRecord | null>(null)
  const [path, setPath] = useState<string[]>([])
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [perm, setPerm] = useState<'granted' | 'prompt' | 'denied' | 'unknown'>('unknown')
  const [busy, setBusy] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [moving, setMoving] = useState<MoveState | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ name: string; kind: 'file' | 'dir' } | null>(null)
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

  /**
   * **每次打开面板都重读**（用户确认）：从 IndexedDB 取最新工作区 → 只查权限（申请必须由用户手势触发）
   * → 有权限就重列目录（手机上刚存进来的 `.jps` 立刻可见）。
   * 收起面板时清掉展开态，避免下次打开还停在上次的重命名/删除确认上。
   */
  useEffect(() => {
    if (!active) {
      setMenuFor(null)
      setEdit(null)
      setMoving(null)
      setConfirmDel(null)
      setSaveName(null)
      return
    }
    let alive = true
    void (async () => {
      const rec = await getWorkspace()
      if (!alive) return
      setWs(rec)
      // adj540：手机端「另存为」带过来的意图 ⇒ 直接把文件名输入框展开（消费掉，不做持久化）
      if (rec && useUiStore.getState().workspaceSaveIntent) {
        setSaveName(fileBaseName(useDocStore.getState().fileName))
        useUiStore.getState().clearWorkspaceSaveIntent()
      }
      if (!rec) return
      const q = await queryWorkspacePermission(rec.handle)
      if (!alive) return
      setPerm(q)
      if (q === 'granted') await refresh(rec, rec.path)
      else setBusy(false)
    })()
    return () => {
      alive = false
    }
  }, [active, refresh])

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
    if (ok) closeDock() // 打开就把底栏收起来，让用户看到谱
  }

  /** 提交「重命名」/「新建文件夹」（同一个输入框，两处复用） */
  const submitEdit = async () => {
    if (!ws || !edit) return
    const value = edit.value.trim()
    if (!value) return
    if (edit.kind === 'rename' && edit.name) {
      const ok = await renameWorkspaceFile(path, edit.name, `${stripJpsExt(value)}.jps`)
      if (ok) {
        setEdit(null)
        await refresh(ws, path)
      }
      return
    }
    const ok = await createWorkspaceDir(path, value)
    if (ok) {
      setEdit(null)
      await refresh(ws, path)
    }
  }

  /** 「移动到…」确认：把文件搬到当前浏览的目录 */
  const submitMove = async () => {
    if (!ws || !moving) return
    const ok = await moveWorkspaceFile(moving.fromSegs, path)
    if (ok) {
      setMoving(null)
      await refresh(ws, path)
    }
  }

  const doDelete = async () => {
    if (!ws || !confirmDel) return
    const { name, kind } = confirmDel
    setBusy(true)
    try {
      const ok = kind === 'file' ? await deleteWorkspaceFile([...path, name]) : await deleteWorkspaceDir(path, name)
      setConfirmDel(null)
      if (ok) await refresh(ws, path)
    } finally {
      setBusy(false)
    }
  }

  const onSaveHere = async () => {
    if (!ws) return
    const raw = (saveName ?? '').trim()
    if (!raw) return
    const ok = await saveToWorkspace([...path, `${stripJpsExt(raw)}.jps`])
    if (ok) {
      setSaveName(null)
      await refresh(ws, path)
    }
  }

  const crumb = path.length > 0 ? joinPath(path) : (ws?.handle.name ?? '')

  // ---- 未设工作区 / 需要授权：只有一个大按钮，先把前提做掉 ----
  if (!ws) {
    return (
      <div className="ws-panel ws-panel-gate">
        <div className="ws-desc">{workspaceCopy.desc}</div>
        <button type="button" className="btn primary ws-big" onClick={() => void onPick()} disabled={busy}>
          {workspaceCopy.pick}
        </button>
      </div>
    )
  }

  if (perm !== 'granted') {
    return (
      <div className="ws-panel ws-panel-gate">
        <div className="ws-desc">{workspaceCopy.desc}</div>
        <button type="button" className="btn primary ws-big" onClick={() => void onGrant()} disabled={busy}>
          {workspaceCopy.grant}
        </button>
        <button type="button" className="btn" onClick={() => void onPick()} disabled={busy}>
          {workspaceCopy.switchDir}
        </button>
      </div>
    )
  }

  return (
    <div className="ws-panel">
      <div className="ws-head">
        <div className="ws-crumb" title={crumb}>
          <span className="ws-root">{workspaceCopy.rootLabel}</span>
          <span className="ws-sep">/</span>
          {path.map((seg, i) => (
            <span key={`${seg}-${i}`}>
              <button
                type="button"
                className="ws-crumb-seg"
                onClick={() => {
                  setMenuFor(null)
                  void refresh(ws, path.slice(0, i + 1))
                }}
                disabled={busy}
              >
                {seg}
              </button>
              <span className="ws-sep">/</span>
            </span>
          ))}
        </div>
        {moving ? (
          <span className="ws-move-hint">{workspaceCopy.moveHere}：{crumb}</span>
        ) : (
          <button type="button" className="btn" onClick={() => void onPick()} disabled={busy}>
            {workspaceCopy.switchDir}
          </button>
        )}
      </div>

      <div className="ws-list">
        {/* 「移动到…」模式下：只列目录（选目标），并给出取消 */}
        {moving ? (
          <div className="ws-editor">
            <button type="button" className="btn primary" onClick={() => void submitMove()} disabled={busy}>
              {workspaceCopy.moveHere}
            </button>
            <button type="button" className="btn" onClick={() => setMoving(null)} disabled={busy}>
              {workspaceCopy.moveCancel}
            </button>
          </div>
        ) : (
          path.length > 0 && (
            <div className="ws-row">
              <button
                type="button"
                className="ws-row-open ws-row-up"
                onClick={() => {
                  setMenuFor(null)
                  void refresh(ws, parentPath(path))
                }}
                disabled={busy}
              >
                <span className="ws-icon">↰</span>
                <span className="ws-name">{workspaceCopy.up}</span>
              </button>
            </div>
          )
        )}

        {entries
          .filter((e) => !moving || e.kind === 'dir')
          .map((e) => {
            const isMenu = menuFor === e.name
            return (
              <div key={`${e.kind}-${e.name}`}>
                <div className="ws-row">
                  <button
                    type="button"
                    className="ws-row-open"
                    onClick={() => {
                      setMenuFor(null)
                      if (moving) {
                        void refresh(ws, [...path, e.name])
                        return
                      }
                      if (e.kind === 'dir') void refresh(ws, [...path, e.name])
                      else void onOpen(e.name)
                    }}
                    disabled={busy}
                  >
                    <span className="ws-icon">{e.kind === 'dir' ? '📁' : '🎼'}</span>
                    <span className="ws-name">{e.name}</span>
                  </button>
                  {/* 目录暂不支持重命名/移动（递归搬运风险大）⇒ 只给删除 */}
                  {!moving && (
                    <button
                      type="button"
                      className="ws-menu-btn"
                      aria-label={workspaceCopy.moreActions}
                      title={workspaceCopy.moreActions}
                      onClick={() => {
                        setEdit(null)
                        setConfirmDel(null)
                        setMenuFor(isMenu ? null : e.name)
                      }}
                      disabled={busy}
                    >
                      ⋯
                    </button>
                  )}
                </div>

                {isMenu && (
                  <div className="ws-actions">
                    {e.kind === 'file' ? (
                      <>
                        <button type="button" className="btn" onClick={() => void onOpen(e.name)} disabled={busy}>
                          {workspaceCopy.actOpen}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setEdit({ kind: 'rename', value: stripJpsExt(e.name), name: e.name })}
                          disabled={busy}
                        >
                          {workspaceCopy.actRename}
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setMoving({ name: e.name, fromSegs: [...path, e.name], dir: path })
                            setMenuFor(null)
                          }}
                          disabled={busy}
                        >
                          {workspaceCopy.actMove}
                        </button>
                      </>
                    ) : (
                      <span className="ws-hint">{workspaceCopy.dirOpUnsupported}</span>
                    )}
                    <button
                      type="button"
                      className="btn ws-danger"
                      onClick={() => {
                        setConfirmDel({ name: e.name, kind: e.kind })
                        setMenuFor(null)
                      }}
                      disabled={busy}
                    >
                      {workspaceCopy.actDelete}
                    </button>
                  </div>
                )}

                {/* 重命名输入框 */}
                {edit && edit.kind === 'rename' && edit.name === e.name && (
                  <div className="ws-editor">
                    <input
                      className="ws-input"
                      value={edit.value}
                      autoFocus
                      placeholder={workspaceCopy.renamePlaceholder}
                      onChange={(ev) => setEdit({ ...edit, value: ev.target.value })}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter') void submitEdit()
                        if (ev.key === 'Escape') setEdit(null)
                      }}
                    />
                    <button type="button" className="btn primary" onClick={() => void submitEdit()} disabled={busy}>
                      {workspaceCopy.confirmBtn}
                    </button>
                    <button type="button" className="btn" onClick={() => setEdit(null)} disabled={busy}>
                      {workspaceCopy.cancelBtn2}
                    </button>
                  </div>
                )}

                {/* 删除二次确认（永久删除，必须确认） */}
                {confirmDel?.name === e.name && (
                  <div className="ws-editor">
                    <span className="ws-danger-text">
                      {e.kind === 'file'
                        ? workspaceCopy.deleteFileConfirm(e.name)
                        : workspaceCopy.deleteDirConfirm(e.name)}
                    </span>
                    <button type="button" className="btn ws-danger" onClick={() => void doDelete()} disabled={busy}>
                      {workspaceCopy.actDelete}
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmDel(null)} disabled={busy}>
                      {workspaceCopy.cancelBtn2}
                    </button>
                  </div>
                )}
              </div>
            )
          })}

        {entries.length === 0 && <div className="ws-none">{workspaceCopy.emptyDir}</div>}
      </div>

      {/* 新建文件夹输入框 */}
      {edit && edit.kind === 'newFolder' && (
        <div className="ws-editor">
          <input
            className="ws-input"
            value={edit.value}
            autoFocus
            placeholder={workspaceCopy.folderNamePlaceholder}
            onChange={(ev) => setEdit({ ...edit, value: ev.target.value })}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') void submitEdit()
              if (ev.key === 'Escape') setEdit(null)
            }}
          />
          <button type="button" className="btn primary" onClick={() => void submitEdit()} disabled={busy}>
            {workspaceCopy.confirmBtn}
          </button>
          <button type="button" className="btn" onClick={() => setEdit(null)} disabled={busy}>
            {workspaceCopy.cancelBtn2}
          </button>
        </div>
      )}

      {!moving && (
        <div className="ws-foot">
          <span className="ws-hint">{workspaceCopy.onlyListed}</span>
          <span className="ws-save">
            <button
              type="button"
              className="btn"
              onClick={() => setEdit({ kind: 'newFolder', value: '' })}
              disabled={busy}
            >
              {workspaceCopy.actNewFolder}
            </button>
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
              <>
                <input
                  className="ws-input"
                  value={saveName}
                  autoFocus
                  placeholder={workspaceCopy.namePlaceholder}
                  onChange={(ev) => setSaveName(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') void onSaveHere()
                  }}
                />
                <button type="button" className="btn primary" onClick={() => void onSaveHere()} disabled={busy}>
                  {workspaceCopy.saveBtn}
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
