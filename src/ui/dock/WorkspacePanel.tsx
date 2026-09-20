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
 * 现在操作集中到右侧，行数全留给文件列表。
 *
 * 交互模型（用户要求加复选框后定型）：
 *  · **点文件名/图标 = 打开（目录则进入）** —— 一步到位，不需要点两次；
 *  · **点前面的复选框 = 选中**（可多选）—— 右侧「操作」里的 改名/移动/删除 作用在选中项上。
 *    两件事互不打架：想删就勾，想看就点。
 *
 * 右侧按钮用**分组下拉**（用户建议"按钮别铺太多"）：默认 打开 / 保存▾ / 新建▾ / 操作▾ 四个，
 * 同一时刻只展开一组，最多 5 个按钮 ⇒ 窄屏不用滚动，按钮高度也保持与其它按钮一致（不靠压扁）。
 *
 * 文件操作与安全约束（都是用户确认的行为）：
 *  · 打开 / 保存 / 另存 / 新建（空谱）/ 新建夹 / 改名 / 移动 / 删除；
 *  · **改名与移动**：FSA 对用户选中的目录**没有 `move()`**（只对 OPFS 生效）⇒ 实现是
 *    "读出 → 写新位置 → 回读校验一致 → 才删原文件"，中途失败宁可留重复也不丢内容；
 *  · **删除是永久的**（浏览器文件 API 没有回收站）⇒ 必须二次确认；目录**只允许删空的**
 *    （递归删目录会把用户放在里面的照片/文档一起删掉）；
 *  · 列表**每次打开都重读**（用户确认）：手机上刚用系统工具/微信存进来的 `.jps` 能立刻看到。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { workspaceCopy } from '../../brand/copy'
import { fileBaseName } from '../../store/saveSupport'
import type { WorkspaceRecord } from '../../store/fileHandleDb'
import { ToolIcon } from '../ToolIcon'
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
  searchWorkspaceJps,
  setWorkspace,
  stripJpsExt,
  type DirEntry,
  type SearchHit,
} from '../../store/workspace'

/** 「选择文件夹」静默失败的判定时间（超过它还没弹选择框就提示，而不是让用户干等） */
const PICKER_NO_RESPONSE_MS = 5000

/** 正在编辑的输入框：重命名 / 新建夹 / 另存 / 新建谱（四者共用同一个输入区） */
type EditState = { kind: 'rename' | 'newFolder' | 'saveAs' | 'newScore'; value: string; name?: string }

/** 输入区的标题与占位符（四种用途只差这两个字段，避免在 JSX 里堆三元） */
const EDIT_META: Record<EditState['kind'], { label: string; placeholder: string }> = {
  rename: { label: workspaceCopy.actRename, placeholder: workspaceCopy.renamePlaceholder },
  newFolder: { label: workspaceCopy.actNewFolder, placeholder: workspaceCopy.folderNamePlaceholder },
  saveAs: { label: workspaceCopy.actSaveAs, placeholder: workspaceCopy.namePlaceholder },
  newScore: { label: workspaceCopy.actNewScore, placeholder: workspaceCopy.newScorePlaceholder },
}

/** "移动到…"模式：**开跑时就把要搬的路径定下来**（随后可自由进子目录选目标，选中项不再变） */
type MoveState = { list: string[][] }

/** 删除确认：待删条目 + 摘要文案（单个显示名字，多个显示条数） */
type DelState = { items: { segs: string[]; kind: 'file' | 'dir' }[]; label: string }

export function WorkspacePanel() {
  const showNotice = useUiStore((s) => s.showNotice)
  const closeDock = useUiStore((s) => s.closeDock)
  const active = useUiStore((s) => s.dockOpen && s.dockPanel === 'workspace')
  const openWorkspaceFile = useDocStore((s) => s.openWorkspaceFile)
  const saveFile = useDocStore((s) => s.saveFile)
  const saveToWorkspace = useDocStore((s) => s.saveToWorkspace)
  const newWorkspaceScore = useDocStore((s) => s.newWorkspaceScore)
  const createWorkspaceDir = useDocStore((s) => s.createWorkspaceDir)
  const renameWorkspaceFile = useDocStore((s) => s.renameWorkspaceFile)
  const moveWorkspaceFiles = useDocStore((s) => s.moveWorkspaceFiles)
  const deleteWorkspaceEntries = useDocStore((s) => s.deleteWorkspaceEntries)

  const [ws, setWs] = useState<WorkspaceRecord | null>(null)
  const [path, setPath] = useState<string[]>([])
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [perm, setPerm] = useState<'granted' | 'prompt' | 'denied' | 'unknown'>('unknown')
  const [busy, setBusy] = useState(false)
  /**
   * **选中的条目名**（当前目录内，支持多选）。每行前面的复选框控制它；
   * 右侧「操作」里的 改名/移动/删除 作用在这些选中项上（用户要求）。
   */
  const [selected, setSelected] = useState<string[]>([])
  const [edit, setEdit] = useState<EditState | null>(null)
  const [moving, setMoving] = useState<MoveState | null>(null)
  const [confirmDel, setConfirmDel] = useState<DelState | null>(null)
  /**
   * adj540（用户报告"手机上打开进入子目录有点慢"）：**进入子目录的列表缓存**——用过一遍的路径
   * 留着，再次访问时（"上级目录"返回、子目录之间跳转）**直接用缓存**。同时**减少 IndexedDB 写入**：
   * `rememberWorkspacePath` 只在面板打开/关闭时写一次，**不在每次导航时都写**（IndexedDB 写在 Android 上动辄 20-50ms，
   * 是慢的次要来源）。整张缓存只在任何写操作（重命名/删除/新建/移动）后清空——写之后缓存里的列表已过期。
   */
  const entriesCacheRef = useRef<Map<string, DirEntry[]>>(new Map())
  /** adj540（用户报告 `*` 列不出文件）：搜索期间读不动的目录名——**主动告知**而非静默 */
  const [, setBlockedDirs] = useState<string[]>([])
  /**
   * adj540（用户要求）：**过滤框**——默认为层级列表（进目录逐级浏览）；一旦输入过滤词，
   * 就把**整个工作区（含子目录）**里符合条件的 `.jps` 收成**平坦列表**，点一条直接打开。
   * `hits === null` 表示"当前没在过滤"（走层级模式）。
   */
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  /** 命中数被上限截断（"没搜到"与"没搜完"要分开告诉用户，见 E-2026-247） */
  const [hitsTruncated, setHitsTruncated] = useState(false)
  const searching = query.trim().length > 0
  /**
   * adj540（用户要求）：右侧**只留一个下拉按钮**「操作」——点它**弹出菜单**再选具体操作。
   * 为什么必须用 portal：dock 容器是 `overflow: hidden`，就地展开的浮层会被裁掉
   * （内联展开又会挤占列表行数），所以菜单渲染到 `document.body` 并 `position: fixed` 锚在按钮上方。
   */
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number; width: number } | null>(null)
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const selectedEntries = entries.filter((e) => selected.includes(e.name))
  const selectedFiles = selectedEntries.filter((e) => e.kind === 'file')
  const selCount = selectedEntries.length
  const hasDirSelected = selectedEntries.some((e) => e.kind === 'dir')
  const toggleSelect = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))

  /**
   * 过滤（debounce 200ms）：对整个工作区递归找 `.jps`（`searchWorkspaceJps` 自带深度/条数上限）。
   * 清空过滤即回到层级模式（原目录列表仍在，不用重读）。
   */
  useEffect(() => {
    if (!ws || perm !== 'granted' || !searching) {
      setHits(null)
      return
    }
    let alive = true
    const t = window.setTimeout(() => {
      void searchWorkspaceJps(ws.handle, query)
        .then((r) => {
          if (!alive) return
          setHits(r.hits)
          setHitsTruncated(r.truncated)
          setBlockedDirs(r.blocked)
          // 没搜完必须说出来：否则用户会以为"工作区里就没有这些谱"
          if (r.truncated) showNotice(workspaceCopy.searchTruncated(r.hits.length), 'warn')
          // 读不动的目录也说出来：不然 `*` 看不到就是"文件不见了"
          if (r.blocked.length > 0) showNotice(workspaceCopy.searchBlockedDirs(r.blocked), 'warn')
        })
        .catch(() => {
          if (alive) {
            setHits([])
            setHitsTruncated(false)
            setBlockedDirs([])
          }
        })
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [ws, perm, query, searching, showNotice])
  /** 弹出菜单：点外面/按 Esc 关闭（菜单渲染在 portal 里，不在 dock 的裁剪范围内） */
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || menuBtnRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  /** 打开菜单：按按钮位置定位（锚在按钮**上方**，因为 dock 在屏幕底部），并**夹进视口**：
   *  侧栏贴右边缘，若直接用按钮 left 会让菜单溢出屏幕右侧（实测 390px 视口溢出 56px）。 */
  const openMenu = () => {
    const r = menuBtnRef.current?.getBoundingClientRect()
    if (r) {
      const width = Math.max(r.width, 150)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
      setMenuPos({ left, bottom: window.innerHeight - r.top + 6, width })
    }
    setMenuOpen(true)
  }

  /** 写操作后**整张列表缓存都过期**——统一清空比按路径精确失效简单且足够（写不频繁） */
  const invalidateCache = () => {
    entriesCacheRef.current.clear()
  }
  /** 列目录（带缓存——同一路径再次访问直接走缓存，避免每次都打 IndexedDB / FSA） */
  const refresh = useCallback(
    async (rec: WorkspaceRecord, next: string[]) => {
      setBusy(true)
      const key = joinPath(next)
      const cached = entriesCacheRef.current.get(key)
      if (cached) {
        setEntries(cached)
        setPath(next)
        setSelected([])
        setEdit(null)
        setConfirmDel(null)
        setBusy(false)
        return
      }
      try {
        const list = await readDirEntries(rec.handle, next)
        entriesCacheRef.current.set(key, list)
        setEntries(list)
        setPath(next)
        setSelected([])
        setEdit(null)
        setConfirmDel(null)
        // 路径记忆**只在打开/关闭时写一次**（activation effect 里），不在每次导航都写——少写 N 次 IndexedDB
        invalidateCache() // 写操作都 invalidate；这里 refresh 自己是读、不算，但保持语义统一
      } catch (e) {
        const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        showNotice(workspaceCopy.loadFailed(reason), 'error')
        setEntries([])
      } finally {
        setBusy(false)
      }
    },
    [showNotice, invalidateCache],
  )

  /**
   * **每次打开面板都重读**（用户确认）：从 IndexedDB 取最新工作区 → 只查权限（申请必须由用户手势触发）
   * → 有权限就重列目录（手机上刚存进来的 `.jps` 立刻可见）。
   * 收起面板时清掉展开态，避免下次打开还停在上次的重命名/删除确认上。
   */
  useEffect(() => {
    if (!active) {
      setSelected([])
      setEdit(null)
      setMoving(null)
      setConfirmDel(null)
      setMenuOpen(false)
      setQuery('')
      setHits(null)
      // adj540：路径记忆写在**关闭面板时**（打开时已经在 IDB 里读到了 ws.path），写一次就够
      void rememberWorkspacePath(path).catch(() => {})
      return
    }
    let alive = true
    void (async () => {
      const rec = await getWorkspace()
      if (!alive) return
      setWs(rec)
      // adj540：手机端「保存/另存」带过来的意图 ⇒ 直接把"另存"输入框展开（消费掉，不做持久化）
      if (rec && useUiStore.getState().workspaceSaveIntent) {
        setEdit({ kind: 'saveAs', value: fileBaseName(useDocStore.getState().fileName) })
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

  /** 打开某一项（目录 ⇒ 进入；文件 ⇒ 打开并收起底栏）——**点行就是这件事**，不需先选中
   * adj540（用户反馈）：列表里点击文件名就能打开/进入，所以右侧独立的「打开」按钮意义不大——
   * 删除掉（要打开选中项时直接点行）。 */
  const openEntry = async (entry: DirEntry) => {
    if (!ws) return
    if (entry.kind === 'dir') {
      await refresh(ws, [...path, entry.name])
      return
    }
    const ok = await openWorkspaceFile([...path, entry.name])
    if (ok) closeDock()
  }

  /** 移动模式下切换目标目录（不动已定的搬运清单） */
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
  }

  /** 提交输入区：改名 / 新建夹 / 另存 / 新建谱（四者共用一个输入框，故集中在这里分派） */
  const submitEdit = async () => {
    if (!ws || !edit) return
    const value = edit.value.trim()
    if (!value) return
    const segsOf = (raw: string): string[] => [...path, `${stripJpsExt(raw)}.jps`]
    if (edit.kind === 'rename' && edit.name) {
      const ok = await renameWorkspaceFile(path, edit.name, `${stripJpsExt(value)}.jps`)
      if (ok) {
        setEdit(null)
        await refresh(ws, path)
      }
      return
    }
    if (edit.kind === 'newFolder') {
      const ok = await createWorkspaceDir(path, value)
      if (ok) {
        setEdit(null)
        await refresh(ws, path)
      }
      return
    }
    if (edit.kind === 'saveAs') {
      const ok = await saveToWorkspace(segsOf(value))
      if (ok) {
        setEdit(null)
        await refresh(ws, path)
      }
      return
    }
    // newScore：在当前目录写一份空谱（沿用「新建」模板内容），写完直接打开它
    const ok = await newWorkspaceScore(segsOf(value))
    if (ok) {
      setEdit(null)
      await refresh(ws, path)
    }
  }

  /**
   * 「保存」：已绑定工作区文件 ⇒ 直接写回（`saveFile` 内部走工作区分支）；
   * **未绑定** ⇒ 转成「另存」（展开文件名输入）——不让它变成"按了没反应"的死路。
   */
  const onSave = async () => {
    if (!ws) return
    if (useDocStore.getState().workspacePath) {
      await saveFile()
      await refresh(ws, path)
      return
    }
    setEdit({ kind: 'saveAs', value: fileBaseName(useDocStore.getState().fileName) })
  }

  /** 进入"移动到…"模式：把当前选中的**文件**路径定下来（目录不支持移动） */
  const startMove = () => {
    setMenuOpen(false)
    if (selectedFiles.length === 0) {
      showNotice(workspaceCopy.moveDirUnsupported, 'warn')
      return
    }
    setMoving({ list: selectedFiles.map((e) => [...path, e.name]) })
  }

  const submitMove = async () => {
    if (!ws || !moving) return
    const ok = await moveWorkspaceFiles(moving.list, path)
    if (ok) {
      setMoving(null)
      await refresh(ws, path)
    }
  }

  const startDelete = () => {
    setMenuOpen(false)
    if (selCount === 0) return
    setConfirmDel({
      items: selectedEntries.map((e) => ({ segs: [...path, e.name], kind: e.kind as 'file' | 'dir' })),
      label:
        selCount === 1
          ? selectedEntries[0].kind === 'file'
            ? workspaceCopy.deleteFileConfirm(selectedEntries[0].name)
            : workspaceCopy.deleteDirConfirm(selectedEntries[0].name)
          : workspaceCopy.deleteManyConfirm(selCount),
    })
  }

  const doDelete = async () => {
    if (!ws || !confirmDel) return
    setBusy(true)
    try {
      const ok = await deleteWorkspaceEntries(confirmDel.items)
      setConfirmDel(null)
      if (ok) await refresh(ws, path)
    } finally {
      setBusy(false)
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
        {/* adj540（用户第二轮反馈）：左侧放一个"切换工作区"图标按钮（`public/icons/工作区.png`）；
            路径面包屑从**第一个段（根目录名）**开始就是普通段，点击=回到工作区根目录——
            解决了"根目录名点不开"的别扭，把"切换工作区"这个动作彻底从路径里分离出去。 */}
        <button
          type="button"
          className="ws-workspace-btn"
          onClick={() => void (moving ? refreshMovingTarget([]) : onPick())}
          title={workspaceCopy.workspaceBtnTitle}
          aria-label={workspaceCopy.workspaceBtnTitle}
          disabled={busy}
        >
          <ToolIcon name="workspace" />
        </button>
        <div className="ws-crumb" title={wsPathText}>
          {/* 根目录名 = 普通面包屑段（"回到工作区根目录"或"移动模式下选工作区根作目标"） */}
          <button
            type="button"
            className="ws-crumb-seg ws-crumb-root"
            onClick={() => void (moving ? refreshMovingTarget([]) : refresh(ws, []))}
            disabled={busy}
          >
            {ws.handle.name}
          </button>
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
        {/* 「移动到…」模式下头部显示目标提示 */}
        {moving && (
          <span className="ws-move-hint">
            {workspaceCopy.moveHere}·{moving.list.length} → {crumb || ''}
          </span>
        )}
      </div>

      {/* 输入/确认区：改名、新建、另存、删除确认都放这里（不占用列表行） */}
      {edit && (
        <div className="ws-editbar">
          <span className="ws-edit-label">{EDIT_META[edit.kind].label}</span>
          <input
            className="ws-input"
            value={edit.value}
            autoFocus
            placeholder={EDIT_META[edit.kind].placeholder}
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
          <span className="ws-danger-text">{confirmDel.label}</span>
          <button type="button" className="btn ws-danger" onClick={() => void doDelete()} disabled={busy}>
            {workspaceCopy.actDelete}
          </button>
          <button type="button" className="btn" onClick={() => setConfirmDel(null)} disabled={busy}>
            {workspaceCopy.cancelBtn2}
          </button>
        </div>
      )}

      {/* adj540（用户要求）：**过滤框**——默认为层级列表；一过滤就把整个工作区符合条件的 .jps 收成平坦列表 */}
      <div className="ws-filter-row">
        <input
          className="ws-input ws-filter"
          value={query}
          placeholder={workspaceCopy.filterPlaceholder}
          title={workspaceCopy.filterHint}
          onChange={(ev) => {
            setQuery(ev.target.value)
            setEdit(null)
            setConfirmDel(null)
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') setQuery('')
          }}
        />
        {/* adj540（用户要求）：一键 `*` = 列出工作区**全部** .jps（再点一下清空回到层级列表）。
            `*` 在过滤口径里是"任意串"，所以等价于"不过滤但走平坦列表"。 */}
        <button
          type="button"
          className={`btn ws-filter-all${query.trim() === '*' ? ' is-active' : ''}`}
          title={workspaceCopy.filterAllTitle}
          aria-label={workspaceCopy.filterAllTitle}
          aria-pressed={query.trim() === '*'}
          onClick={() => {
            setQuery(query.trim() === '*' ? '' : '*')
            setEdit(null)
            setConfirmDel(null)
          }}
        >
          {workspaceCopy.filterAll}
        </button>
        {searching && (
          <button type="button" className="btn ws-filter-clear" onClick={() => setQuery('')} title={workspaceCopy.filterClear}>
            ✕
          </button>
        )}
      </div>

      {/* 主体：**左列表（带复选框）+ 右操作按钮** */}
      <div className="ws-body">
        <div className="ws-list" title={workspaceCopy.onlyListed}>
          {/* 过滤模式：**平坦结果**（跨子目录），点一条直接打开 —— 不提供勾选（改名/移动/删除要先清空过滤） */}
          {searching
            ? (hits ?? []).map((h) => (
                <div key={h.relPath} className="ws-row">
                  <span className="ws-check" aria-hidden="true" />
                  <button
                    type="button"
                    className="ws-row-open"
                    title={h.relPath}
                    onClick={() => {
                      void (async () => {
                        const ok = await openWorkspaceFile([...h.dirSegs, h.name])
                        if (ok) closeDock()
                      })()
                    }}
                    disabled={busy}
                  >
                    <span className="ws-icon">🎼</span>
                    <span className="ws-name">{h.name}</span>
                    {h.dirSegs.length > 0 && <span className="ws-hit-dir">{joinPath(h.dirSegs)}</span>}
                  </button>
                </div>
              ))
            : (
              <>
                {path.length > 0 && (
                  <div className="ws-row">
                    <span className="ws-check" aria-hidden="true" />
                    <button
                      type="button"
                      className="ws-row-open ws-row-up"
                      onClick={() => {
                        setSelected([])
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
                    <div key={`${e.kind}-${e.name}`} className={`ws-row${selected.includes(e.name) ? ' is-selected' : ''}`}>
                      {/* adj540（用户要求）：文件名前的**复选框** —— 勾选 = 选中（供 改名/移动/删除 用），
                          点名字 = 打开/进入。两者分开，不再需要"点两次才打开" */}
                      {moving ? (
                        <span className="ws-check" aria-hidden="true" />
                      ) : (
                        <input
                          type="checkbox"
                          className="ws-check"
                          checked={selected.includes(e.name)}
                          aria-label={e.name}
                          onChange={() => {
                            setEdit(null)
                            setConfirmDel(null)
                            toggleSelect(e.name)
                          }}
                        />
                      )}
                      <button type="button" className="ws-row-open" onClick={() => void openEntry(e)} disabled={busy}>
                        <span className="ws-icon">{e.kind === 'dir' ? '📁' : '🎼'}</span>
                        <span className="ws-name">{e.name}</span>
                      </button>
                    </div>
                  ))}
                {entries.length === 0 && <div className="ws-none">{workspaceCopy.emptyDir}</div>}
              </>
            )}
          {searching && hits !== null && hits.length === 0 && <div className="ws-none">{workspaceCopy.searchEmpty}</div>}
        </div>

        <div className="ws-side">
          {moving ? (
            <>
              <div className="ws-side-label">
                {workspaceCopy.actMove}·{moving.list.length}
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
              <div className="ws-side-label" title={selectedEntries.map((e) => e.name).join('、')}>
                {searching ? (
                  <span className="ws-side-name">
                    {workspaceCopy.searchResults(hits?.length ?? 0)}
                    {hitsTruncated ? '…' : ''}
                  </span>
                ) : selCount === 0 ? (
                  workspaceCopy.tapToSelect
                ) : selCount === 1 ? (
                  <span className="ws-side-name">{selectedEntries[0].name}</span>
                ) : (
                  <span className="ws-side-name">{workspaceCopy.selectedCount(selCount)}</span>
                )}
              </div>

              {/* adj540（用户反馈）：列表里点文件名就能打开/进入——右侧不再放独立的「打开」按钮（与行点击功能重复）。只剩一个「操作▾」下拉。 */}
              <button
                ref={menuBtnRef}
                type="button"
                className="btn ws-side-btn ws-side-group"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}
                disabled={busy}
              >
                {workspaceCopy.menuBtn}
                <span className="ws-caret">{menuOpen ? '▴' : '▾'}</span>
              </button>
            </>
          )}
        </div>
      </div>
      {/* 操作菜单（portal → body：dock 有 overflow:hidden，就地浮层会被裁掉；
          锚在按钮**上方**，因为底栏就在屏幕底部） */}
      {menuOpen &&
        menuPos &&
        createPortal(
          <div ref={menuRef} className="ws-menu-pop" role="menu" style={{ left: menuPos.left, bottom: menuPos.bottom, width: menuPos.width }}>
            <button type="button" className="ws-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); void onSave() }}>
              {workspaceCopy.actSave}
            </button>
            <button
              type="button"
              className="ws-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                setEdit({ kind: 'saveAs', value: fileBaseName(useDocStore.getState().fileName) })
              }}
            >
              {workspaceCopy.actSaveAs}
            </button>
            <button
              type="button"
              className="ws-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                setEdit({ kind: 'newScore', value: '' })
              }}
            >
              {workspaceCopy.actNewScore}
            </button>
            <button
              type="button"
              className="ws-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                setEdit({ kind: 'newFolder', value: '' })
              }}
            >
              {workspaceCopy.actNewFolder}
            </button>
            <div className="ws-menu-sep" />
            <button
              type="button"
              className="ws-menu-item"
              role="menuitem"
              disabled={selCount !== 1 || selectedEntries[0]?.kind !== 'file'}
              onClick={() => {
                const one = selCount === 1 ? selectedEntries[0] : null
                setMenuOpen(false)
                if (!one || one.kind !== 'file') return
                setEdit({ kind: 'rename', value: stripJpsExt(one.name), name: one.name })
              }}
            >
              {workspaceCopy.actRename}
            </button>
            <button
              type="button"
              className="ws-menu-item"
              role="menuitem"
              disabled={selectedFiles.length === 0 || hasDirSelected}
              title={hasDirSelected ? workspaceCopy.moveDirUnsupported : undefined}
              onClick={startMove}
            >
              {workspaceCopy.actMove}
            </button>
            <button type="button" className="ws-menu-item ws-danger" role="menuitem" disabled={selCount === 0} onClick={startDelete}>
              {workspaceCopy.actDelete}
            </button>
          </div>,
          document.body,
        )}
    </div>
  )
}
