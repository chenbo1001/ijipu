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
 * 布局（adj540 用户要求）：**左侧列表 + 右侧操作按钮**——
 * 此前"每行展开操作菜单 + 底部按钮行"会吃掉列表的行数（手机上尤其明显）；
 * 现在操作集中到右侧竖排按钮，行数全留给文件列表。
 *
 * 交互模型（配合上面的布局）：**点一下 = 选中（右侧按钮随之可用），再点同一行 = 打开/进入**。
 * 之所以不是"点一下直接打开"：右侧那些破坏性按钮（重命名/移动/删除）必须有个明确的**作用对象**，
 * 否则"删除"删的是谁全靠猜。未选中时右侧标签会提示"点一下选中"。
 *
 * 文件操作与安全约束（都是用户确认的行为）：
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
  /**
   * 当前选中项（文件名或目录名）。右侧操作按钮作用在它身上 ⇒ 窄屏不用每行展开操作菜单，
   * 行数就都留给列表本身（用户要求"左列表 + 右操作按钮"）。
   */
  const [selected, setSelected] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [moving, setMoving] = useState<MoveState | null>(null)
  const [confirmDel, setConfirmDel] = useState<{ name: string; kind: 'file' | 'dir' } | null>(null)
  const [saveName, setSaveName] = useState<string | null>(null)

  const selectedEntry = entries.find((e) => e.name === selected) ?? null

  /** 列目录（读不到就提示，不静默——否则用户只看到"空的"） */
  const refresh = useCallback(
    async (rec: WorkspaceRecord, next: string[]) => {
      setBusy(true)
      try {
        const list = await readDirEntries(rec.handle, next)
        setEntries(list)
        setPath(next)
        setSelected(null)
        setEdit(null)
        setConfirmDel(null)
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
      setSelected(null)
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
      // adj540：手机端「另存为 / 保存」带过来的意图 ⇒ 直接把文件名输入框展开（消费掉，不做持久化）
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

  /** 打开当前选中项（目录 ⇒ 进入；文件 ⇒ 打开并收起底栏） */
  const openSelected = async () => {
    if (!ws || !selectedEntry) return
    if (selectedEntry.kind === 'dir') {
      await refresh(ws, [...path, selectedEntry.name])
      return
    }
    const ok = await openWorkspaceFile([...path, selectedEntry.name])
    if (ok) closeDock() // 打开就把底栏收起来，让用户看到谱
  }

  /** 点行：**先选中，再点同一行才打开**（理由见文件头"交互模型"） */
  const onRowTap = (e: DirEntry) => {
    if (moving) {
      // 移动到…模式：点目录 = 进入该目录选目标
      if (e.kind === 'dir' && ws) void refreshMovingTarget([...path, e.name])
      return
    }
    if (selected === e.name) {
      void openSelected()
      return
    }
    setSelected(e.name)
    setEdit(null)
    setConfirmDel(null)
  }

  /** 移动模式下切换目标目录（不动 `selected`，保持"正在移动的那一项"不变） */
  const refreshMovingTarget = async (next: string[]) => {
    if (!ws) return
    setBusy(true)
    try {
      const list = await readDirEntries(ws.handle, next)
      setEntries(list)
      setPath(next)
    } catch (e) {
      const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      showNotice(workspaceCopy.loadFailed(reason), 'error')
    } finally {
      setBusy(false)
    }
    // refresh 会清空 selected，这里不需要（moving 模式下 selected 仅作展示）
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
  /**
   * 工作区目录的**可读路径**：`文件夹名 / 子目录 / …`。
   * ⚠️ FSA 只给文件夹名（`handle.name`），**拿不到完整磁盘路径**（隐私限制，`resolve()` 也只能算区内相对路径）
   * ⇒ 授权提示里就显示这个，并在旁边说明原因（用户要求"授权时要显示要授权的目录"）。
   */
  const wsPathText = ws ? joinPath([ws.handle.name, ...(ws.path ?? [])]) : ''

  // ---- 未设工作区：只有一个大按钮，先把前提做掉 ----
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

  // ---- 授权过期（真机实测：刷新后是 prompt）：**先显示是哪个目录**，再由用户点一下重新授权 ----
  if (perm !== 'granted') {
    return (
      <div className="ws-panel ws-panel-gate">
        <div className="ws-grant">
          <div className="ws-grant-title">{workspaceCopy.grantTitle}</div>
          <div className="ws-grant-dir" title={wsPathText}>
            {wsPathText}
          </div>
          <div className="ws-grant-hint">{workspaceCopy.grantPathHint}</div>
          <div className="ws-grant-hint">{workspaceCopy.grantWhy}</div>
        </div>
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
        <div className="ws-crumb" title={wsPathText}>
          {/* adj540：面包屑**首段用真实文件夹名**（不再写死"工作区"）——用户要能看到当前是哪个目录 */}
          <span className="ws-root" title={wsPathText}>
            {ws.handle.name}
          </span>
          <span className="ws-sep">/</span>
          {path.map((seg, i) => (
            <span key={`${seg}-${i}`}>
              <button
                type="button"
                className="ws-crumb-seg"
                onClick={() => void (moving ? refreshMovingTarget(path.slice(0, i + 1)) : refresh(ws, path.slice(0, i + 1)))}
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

      {/* 输入/确认区：重命名、新建文件夹、删除确认都放这里（不占用列表行） */}
      {edit && (
        <div className="ws-editbar">
          <span className="ws-edit-label">
            {edit.kind === 'rename' ? workspaceCopy.actRename : workspaceCopy.actNewFolder}
          </span>
          <input
            className="ws-input"
            value={edit.value}
            autoFocus
            placeholder={edit.kind === 'rename' ? workspaceCopy.renamePlaceholder : workspaceCopy.folderNamePlaceholder}
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
      {confirmDel && (
        <div className="ws-editbar ws-editbar-danger">
          <span className="ws-danger-text">
            {confirmDel.kind === 'file'
              ? workspaceCopy.deleteFileConfirm(confirmDel.name)
              : workspaceCopy.deleteDirConfirm(confirmDel.name)}
          </span>
          <button type="button" className="btn ws-danger" onClick={() => void doDelete()} disabled={busy}>
            {workspaceCopy.actDelete}
          </button>
          <button type="button" className="btn" onClick={() => setConfirmDel(null)} disabled={busy}>
            {workspaceCopy.cancelBtn2}
          </button>
        </div>
      )}
      {saveName !== null && (
        <div className="ws-editbar">
          <span className="ws-edit-label">{workspaceCopy.saveNameLabel}</span>
          <input
            className="ws-input"
            value={saveName}
            autoFocus
            placeholder={workspaceCopy.namePlaceholder}
            onChange={(ev) => setSaveName(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') void onSaveHere()
              if (ev.key === 'Escape') setSaveName(null)
            }}
          />
          <button type="button" className="btn primary" onClick={() => void onSaveHere()} disabled={busy}>
            {workspaceCopy.saveBtn}
          </button>
          <button type="button" className="btn" onClick={() => setSaveName(null)} disabled={busy}>
            {workspaceCopy.cancelBtn2}
          </button>
        </div>
      )}

      {/* 主体：**左列表 + 右操作按钮**（用户要求：把行数都留给列表） */}
      <div className="ws-body">
        <div className="ws-list" title={workspaceCopy.onlyListed}>
          {path.length > 0 && (
            <div className={`ws-row${selected === '__up__' ? ' is-selected' : ''}`}>
              <button
                type="button"
                className="ws-row-open ws-row-up"
                onClick={() => {
                  setSelected(null)
                  void (moving ? refreshMovingTarget(parentPath(path)) : refresh(ws, parentPath(path)))
                }}
                disabled={busy}
              >
                <span className="ws-icon">↰</span>
                <span className="ws-name">{workspaceCopy.up}</span>
              </button>
            </div>
          )}
          {entries
            .filter((e) => !moving || e.kind === 'dir')
            .map((e) => (
              <div key={`${e.kind}-${e.name}`} className={`ws-row${selected === e.name ? ' is-selected' : ''}`}>
                <button type="button" className="ws-row-open" onClick={() => onRowTap(e)} disabled={busy}>
                  <span className="ws-icon">{e.kind === 'dir' ? '📁' : '🎼'}</span>
                  <span className="ws-name">{e.name}</span>
                </button>
              </div>
            ))}
          {entries.length === 0 && <div className="ws-none">{workspaceCopy.emptyDir}</div>}
        </div>

        <div className="ws-side">
          {moving ? (
            <>
              <div className="ws-side-label" title={moving.name}>
                {workspaceCopy.actMove}
                <br />
                <span className="ws-side-name">{moving.name}</span>
              </div>
              <button type="button" className="btn primary ws-side-btn" onClick={() => void submitMove()} disabled={busy}>
                {workspaceCopy.moveHere}
              </button>
              <button type="button" className="btn ws-side-btn" onClick={() => setMoving(null)} disabled={busy}>
                {workspaceCopy.moveCancel}
              </button>
            </>
          ) : (
            <>
              <div className="ws-side-label" title={selectedEntry?.name ?? ''}>
                {selectedEntry ? <span className="ws-side-name">{selectedEntry.name}</span> : workspaceCopy.tapToSelect}
              </div>
              <button
                type="button"
                className="btn primary ws-side-btn"
                onClick={() => void openSelected()}
                disabled={busy || !selectedEntry}
              >
                {workspaceCopy.actOpen}
              </button>
              <button
                type="button"
                className="btn ws-side-btn"
                onClick={() =>
                  selectedEntry?.kind === 'file' &&
                  setEdit({ kind: 'rename', value: stripJpsExt(selectedEntry.name), name: selectedEntry.name })
                }
                disabled={busy || selectedEntry?.kind !== 'file'}
              >
                {workspaceCopy.actRename}
              </button>
              <button
                type="button"
                className="btn ws-side-btn"
                onClick={() =>
                  selectedEntry?.kind === 'file' &&
                  setMoving({ name: selectedEntry.name, fromSegs: [...path, selectedEntry.name], dir: path })
                }
                disabled={busy || selectedEntry?.kind !== 'file'}
              >
                {workspaceCopy.actMove}
              </button>
              <button
                type="button"
                className="btn ws-danger ws-side-btn"
                onClick={() => selectedEntry && setConfirmDel({ name: selectedEntry.name, kind: selectedEntry.kind })}
                disabled={busy || !selectedEntry}
              >
                {workspaceCopy.actDelete}
              </button>
              <div className="ws-side-gap" />
              <button
                type="button"
                className="btn ws-side-btn"
                onClick={() => setEdit({ kind: 'newFolder', value: '' })}
                disabled={busy}
              >
                {workspaceCopy.actNewFolder}
              </button>
              <button
                type="button"
                className="btn ws-side-btn"
                onClick={() => setSaveName(fileBaseName(currentName))}
                disabled={busy}
              >
                {workspaceCopy.saveHere}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
