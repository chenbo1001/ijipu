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
import { resolvePendingBinding, useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { workspaceCopy } from '../../brand/copy'
import { fileBaseName } from '../../store/saveSupport'
import type { WorkspaceRecord } from '../../store/fileHandleDb'
import { ToolIcon } from '../ToolIcon'
import {
  activateWorkspace,
  flushWorkspacePath,
  getWorkspace,
  isWorkspaceSupported,
  joinPath,
  listWorkspaces,
  makeWorkspaceRecord,
  compileQuery,
  parentPath,
  pickWorkspaceDir,
  queryWorkspacePermission,
  readDirEntries,
  rememberWorkspacePath,
  requestWorkspacePermission,
  resolveExistingDir,
  searchWorkspaceJps,
  setWorkspace,
  stripJpsExt,
  type DirEntry,
  type SearchHit,
  type SearchResult,
} from '../../store/workspace'
import { loadWorkspaceIndex, saveWorkspaceIndex } from '../../store/fileHandleDb'

/** 「选择文件夹」静默失败的判定时间（超过它还没弹选择框就提示，而不是让用户干等） */
const PICKER_NO_RESPONSE_MS = 5000

/**
 * adj546：过滤结果**最多渲染多少行**（索引仍是全量）。
 * 手机上一次渲染 5499 行要 ~600ms（实测），而用户不可能靠滚动翻 5000 行——
 * 封顶后 `*`/过滤都是"秒出"，余量让他用关键词缩小范围（列表底部有提示）。
 */
const RESULT_RENDER_MAX = 300

/**
 * adj546：落盘索引的**保鲜期**——过期才在后台重扫。
 * 为什么不是"每次打开面板都重扫"：手机上扫一遍 5550 文件要几十秒（用户实测 27s），
 * 每次进面板都跑一遍是灾难。10 分钟内直接用落盘索引（秒开），过期或用户手动「重新扫描」才重扫。
 */
const INDEX_STALE_MS = 10 * 60 * 1000

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
   * adj547（用户反馈）：**进行中的提示文案**——点目录/文件、重新读取列表这些"要等"的动作，
   * 必须**立刻**在界面上显示"在做什么"（转圈 + 文案），否则用户分不清是"不能点/没响应/在忙"。
   * `busy` 负责禁用控件，`busyLabel` 负责把原因说出来。
   */
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
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
  /** 当前路径的 ref（供 effect 读取，避免把 `path` 加进依赖导致 effect 反复重跑） */
  const pathRef = useRef<string[]>([])
  pathRef.current = path
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
   * adj543：**整个工作区 `.jps` 的索引**（首次过滤时走一次树建好，之后输入只在内存里 filter）。
   * 写操作后作废（`invalidateCache` 一并清掉）。
   */
  const indexRef = useRef<SearchHit[] | null>(null)
  const idxMetaRef = useRef<{ truncated: boolean; blocked: string[] }>({ truncated: false, blocked: [] })
  /** adj546：后台重扫是否在进行（避免重复起扫）＋ 扫描进度（让 UI 边扫边显示，不再干等） */
  const refreshingRef = useRef(false)
  const [scanInfo, setScanInfo] = useState<{ scanned: number; found: number; ms: number } | null>(null)
  /** 索引版本号：索引内容变化（载入缓存/扫描进度/重扫完成）就 +1，驱动过滤重新计算 */
  const [indexVersion, setIndexVersion] = useState(0)

  /**
   * adj546（用户实测 27 秒）：**后台重扫**——一边扫一边把已找到的写进 `indexRef` 并让 UI 刷新，
   * 扫完落盘（下次直接秒开）。扫描期间界面上会显示"已扫描 N 项 / 找到 M 个"。
   */
  const refreshIndex = useCallback(async (handle: FileSystemDirectoryHandle, wsId: string) => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    const t0 = Date.now()
    setScanInfo({ scanned: 0, found: indexRef.current?.length ?? 0, ms: 0 })
    /**
     * adj546（关键）：进度回调**节流到 500ms，且只更新计数**——不复制数组、不触发过滤重算。
     * 之前 150ms 一跳 + 每跳 `[...partial]` + 重新过滤 ⇒ 扫描过程被 UI 自己拖慢（手机上尤其明显）。
     * 结果按"扫到一半"渐进显示交给下面的 `lastShown` 慢节流（1.2s 一次），足够"看着有动静"。
     */
    let lastShown = 0
    try {
      const r = await searchWorkspaceJps(handle, '', {
        maxHits: 20000,
        maxEntries: 200000,
        onProgress: (scanned, partial) => {
          setScanInfo({ scanned, found: partial.length, ms: Date.now() - t0 })
          const now = Date.now()
          if (now - lastShown < 1200) return
          lastShown = now
          indexRef.current = partial // 引用即可（不改动它），慢节流地让用户看到部分结果
          setIndexVersion((v) => v + 1)
        },
      })
      indexRef.current = r.hits
      idxMetaRef.current = { truncated: r.truncated, blocked: r.blocked }
      const ms = Date.now() - t0
      await saveWorkspaceIndex({ wsId, at: Date.now(), relPaths: r.hits.map((h) => h.relPath) })
      // adj546：把"扫了多少、花了多久、每条多少钱"打出来——真机排查速度问题要靠这个数
      console.info(
        `[iJipu] 工作区索引完成：扫描 ${r.scanned} 项 / 命中 ${r.hits.length} 个 / ${ms}ms` +
          `（${r.scanned > 0 ? (ms / r.scanned).toFixed(2) : '0'}ms 每项）`,
      )
      setIndexVersion((v) => v + 1)
    } catch {
      /* 重扫失败：保留已有索引（可能是落盘的旧索引），不打断用户 */
    } finally {
      refreshingRef.current = false
      setScanInfo(null)
    }
  }, [])

  /**
   * adj543/adj546：**确保有索引可用**——
   * ① 内存里已有 ⇒ 直接用；② 否则先读**落盘的索引**（秒出，可能略旧）并同时启动后台重扫；
   * ③ 都没有 ⇒ 全量扫一次（期间有进度与部分结果）。
   * `useCallback([])` 保证引用稳定（E-2026-249：进依赖的必须是稳定引用）。
   */
  const buildIndex = useCallback(
    async (handle: FileSystemDirectoryHandle, wsId: string, force = false): Promise<SearchResult> => {
      if (indexRef.current && !force) return { hits: indexRef.current, ...idxMetaRef.current, scanned: 0 }
      const cached = force ? null : await loadWorkspaceIndex(wsId)
      if (cached && cached.relPaths.length > 0) {
        const hits = cached.relPaths.map((relPath) => {
          const segs = relPath.split('/')
          return { name: segs[segs.length - 1], relPath, dirSegs: segs.slice(0, -1) }
        })
        indexRef.current = hits
        idxMetaRef.current = { truncated: false, blocked: [] }
        setIndexVersion((v) => v + 1)
        // adj546：**只在索引过期时才后台重扫**——此前每次打开面板都无条件重扫，
        // 在手机上等于每次都跑一遍几十秒的枚举（用户实测 27s）。落盘的索引够新鲜就直接用。
        const stale = Date.now() - (cached.at ?? 0) > INDEX_STALE_MS
        if (stale) void refreshIndex(handle, wsId)
        return { hits, truncated: false, blocked: [], scanned: 0 }
      }
      const r = await searchWorkspaceJps(handle, '', { maxHits: 20000, maxEntries: 200000 })
      indexRef.current = r.hits
      idxMetaRef.current = { truncated: r.truncated, blocked: r.blocked }
      void saveWorkspaceIndex({ wsId, at: Date.now(), relPaths: r.hits.map((h) => h.relPath) })
      return r
    },
    [refreshIndex],
  )
  /**
   * adj540（用户要求）：右侧**只留一个下拉按钮**「操作」——点它**弹出菜单**再选具体操作。
   * 为什么必须用 portal：dock 容器是 `overflow: hidden`，就地展开的浮层会被裁掉
   * （内联展开又会挤占列表行数），所以菜单渲染到 `document.body` 并 `position: fixed` 锚在按钮上方。
   */
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number; width: number } | null>(null)
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  /** adj544：**最近工作区**（一键切回；重启后不用重新选目录） */
  const [recent, setRecent] = useState<WorkspaceRecord[]>([])
  /** adj544：正常视图里点「最近的工作区…」就地展开列表（不用切到形同虚设的空态视图） */
  const [showRecent, setShowRecent] = useState(false)
  /** adj544：待校验绑定（随草稿恢复，需要重新授权才能写回原文件）——只用于提示 */
  const pending = useDocStore((s) => s.pendingBinding)

  const selectedEntries = entries.filter((e) => selected.includes(e.name))
  const selectedFiles = selectedEntries.filter((e) => e.kind === 'file')
  const selCount = selectedEntries.length
  const hasDirSelected = selectedEntries.some((e) => e.kind === 'dir')
  const toggleSelect = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))

  /**
   * adj543（用户反馈"过滤筛选的速度很慢"）：**先建一次索引，之后每次输入只在内存里过滤**。
   *
   * 之前每次输入（debounce 200ms）都把整个工作区**递归重走一遍**（每层目录都是一次 FSA 调用），
   * 大工作区下每敲一个字都要等一轮遍历 ⇒ 明显卡顿。
   * 现在：首次过滤时整棵走一次（带更大的上限，因为只走一次），把全部 `.jps` 存进 `indexRef`；
   * 之后同一面板会话内的每次输入都只是 `Array.filter(matchesQuery)`（纯字符串比较，微秒级）。
   * 索引在**任何写操作**（改名/新建/另存/移动/删除）后作废（见 `invalidateCache`），下次过滤重建。
   */
  useEffect(() => {
    if (!ws || perm !== 'granted' || !searching) {
      setHits(null)
      return
    }
    let alive = true
    /** 有索引 ⇒ 同步过滤（零等待）；没索引 ⇒ 走一次整树建索引，再过滤 */
    const filterFromIndex = (): boolean => {
      const idx = indexRef.current
      if (!idx) return false
      // adj546：查询只编译一次（5000+ 条时别再每条 new RegExp）
      const match = compileQuery(query)
      setHits(idx.filter((h) => match(h.name, h.relPath)))
      setHitsTruncated(idxMetaRef.current.truncated)
      setBlockedDirs(idxMetaRef.current.blocked)
      return true
    }
    if (filterFromIndex()) return
    void buildIndex(ws.handle, ws.id)
      .then((r) => {
        if (!alive) return
        filterFromIndex()
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
    return () => {
      alive = false
    }
  }, [ws, perm, query, searching, showNotice, buildIndex, indexVersion])
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
  /**
   * 写操作后**整张列表缓存都过期**——统一清空比按路径精确失效简单且足够（写不频繁）。
   *
   * ⚠️ **必须 `useCallback([])` 固定引用**（E-2026-249）：它进了 `refresh` 的依赖数组，
   * 而 `refresh` 又在"面板激活"effect 的依赖里——普通函数每次渲染都换新引用，
   * 会让 `refresh` 每次渲染都变 ⇒ effect 每渲染重跑 ⇒ `setState` ⇒ 再渲染……
   * **无限刷新循环**（表现为面板内容一直闪、点目录/文件没反应）。
   */
  const invalidateCache = useCallback(() => {
    entriesCacheRef.current.clear()
    indexRef.current = null // adj543：写操作后过滤索引也作废，下次过滤重建
  }, [])
  /** 列目录（带缓存——同一路径再次访问直接走缓存，避免每次都打 IndexedDB / FSA） */
  const refresh = useCallback(
    async (rec: WorkspaceRecord, next: string[], label?: string) => {
      setBusy(true)
      setBusyLabel(label ?? workspaceCopy.refreshing) // adj547：立刻给出"在忙什么"
      const key = joinPath(next)
      const cached = entriesCacheRef.current.get(key)
      if (cached) {
        setEntries(cached)
        setPath(next)
        setSelected([])
        setEdit(null)
        setConfirmDel(null)
        setBusy(false)
        setBusyLabel(null)
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
        // adj548（用户反馈）：**进入目录就记住位置**——不能在关闭时才记：底栏收起/切页签时
        // 面板是直接卸载的，关闭分支跑不到，重开就永远回到根目录。
        void rememberWorkspacePath(next)
      } catch (e) {
        const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        showNotice(workspaceCopy.loadFailed(reason), 'error')
        setEntries([])
      } finally {
        setBusy(false)
        setBusyLabel(null)
      }
    },
    [showNotice],
  )
  /**
   * adj550（用户要求，**一条规则**）：**进入工作区 ⇒ 定位到该工作区的最新位置**。
   *
   * 「授权」只是前置条件，不是另一条规则：
   *  · 未授权 ⇒ 先显示授权视图，**授权成功后**调用本函数；
   *  · 已授权 ⇒ 切页签回来 / 切到某个工作区 / 打开面板时**直接**调用本函数。
   * 位置已被外部删/移动 ⇒ 收敛到**仍存在的最外层**并提示（不会给空列表让人以为文件没了）。
   * 三条入口（激活 / 授权后 / 切工作区）都走这里，保证行为一致。
   *
   * 定义位置在 `refresh` 之后、激活 effect **之前**，并用 `useCallback` 固定引用——
   * 否则它进 effect 依赖会让激活 effect 每次渲染都重跑（E-2026-249 的无限刷新）。
   */
  const enterAtLatestPos = useCallback(
    async (rec: WorkspaceRecord, label: string) => {
      const want = rec.path ?? []
      const dir = await resolveExistingDir(rec.handle, want)
      if (joinPath(dir) !== joinPath(want)) {
        showNotice(workspaceCopy.dirGone(joinPath(want) || '根目录', joinPath(dir)), 'warn')
      }
      await refresh(rec, dir, label)
    },
    [refresh, showNotice],
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
      // adj540：路径记忆写在**关闭面板时**（打开时已经在 IDB 里读到了 ws.path），写一次就够。
      // 经 ref 读当前路径——不把 `path` 放进依赖数组（那样每次导航都会重跑本 effect）。
      void rememberWorkspacePath(pathRef.current).catch(() => {})
      return
    }
    let alive = true
    void (async () => {
      const rec = await getWorkspace()
      if (!alive) return
      setWs(rec)
      // adj543：每次打开面板都让过滤索引作废——期间用户可能在别的 App 里增删过文件
      indexRef.current = null
      // adj544：读最近工作区列表（供"一键切回"），并尝试恢复绑定（权限已授予时）
      setRecent(await listWorkspaces())
      await resolvePendingBinding()
      // adj540：手机端「保存/另存」带过来的意图 ⇒ 直接把"另存"输入框展开（消费掉，不做持久化）
      if (rec && useUiStore.getState().workspaceSaveIntent) {
        setEdit({ kind: 'saveAs', value: fileBaseName(useDocStore.getState().fileName) })
        useUiStore.getState().clearWorkspaceSaveIntent()
      }
      if (!rec) return
      const q = await queryWorkspacePermission(rec.handle)
      if (!alive) return
      setPerm(q)
      if (q === 'granted') {
        // adj550：**已授权 ⇒ 进入工作区直接定位到最新位置**（与"授权后"走同一个函数）
        await enterAtLatestPos(rec, workspaceCopy.loadingWorkspace)
      } else setBusy(false)
    })()
    return () => {
      alive = false
      // adj550：面板卸载时把"待写的目录位置"立刻落盘（刚进完目录就收起底栏/关页面也不丢）
      flushWorkspacePath()
    }
  }, [active, refresh, showNotice, enterAtLatestPos])

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
      // adj544：工作区记录带**身份 id**（保存校验要用它判断"这份谱属于哪个工作区"）
      const rec: WorkspaceRecord = makeWorkspaceRecord(dir)
      await setWorkspace(rec)
      setWs(rec)
      setPerm('granted')
      await refresh(rec, [])
      setRecent(await listWorkspaces())
      showNotice(workspaceCopy.picked(dir.name), 'ok')
    } catch (e) {
      const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      showNotice(workspaceCopy.loadFailed(reason), 'error')
    } finally {
      window.clearTimeout(timer)
      setBusy(false)
    }
  }

  /** 补授权（用户点了按钮 ⇒ 手势成立）；adj544：授权成功后顺便尝试"恢复绑定到原文件" */

  /** 补授权（用户点了按钮 ⇒ 手势成立）；授权成功 = 满足前置条件 ⇒ 走同一条"定位到最新位置" */
  const onGrant = async () => {
    if (!ws) return
    setBusy(true)
    setBusyLabel(workspaceCopy.loadingWorkspace)
    try {
      const r = await requestWorkspacePermission(ws.handle)
      setPerm(r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : 'unknown')
      if (r === 'granted') {
        await enterAtLatestPos(ws, workspaceCopy.loadingWorkspace)
        await resolvePendingBinding()
      }
    } finally {
      setBusy(false)
      setBusyLabel(null)
    }
  }

  /**
   * adj544（用户要求 C）：从"最近工作区"切回某个工作区。
   * 句柄可能已失效（目录被删/移动）⇒ 申请权限失败时如实提示，不静默失败。
   */
  const onActivate = async (rec: WorkspaceRecord) => {
    setBusy(true)
    try {
      const next = await activateWorkspace(rec.id)
      if (!next) {
        showNotice(workspaceCopy.activateFailed(rec.name), 'error')
        return
      }
      setWs(next)
      const r = await requestWorkspacePermission(next.handle)
      if (r !== 'granted') {
        setPerm(r === 'denied' ? 'denied' : 'unknown')
        showNotice(workspaceCopy.activateFailed(next.name), 'warn')
        return
      }
      setPerm('granted')
      // adj550：切换到某个工作区 = 又一条"进入工作区"的入口 ⇒ 同一条规则：定位到它的最新位置
      await enterAtLatestPos(next, workspaceCopy.loadingWorkspace)
      await resolvePendingBinding()
      showNotice(workspaceCopy.picked(next.name), 'ok')
    } catch (e) {
      const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      showNotice(workspaceCopy.loadFailed(reason), 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 打开某一项（目录 ⇒ 进入；文件 ⇒ 打开并收起底栏）——**点行就是这件事**，不需先选中
   * adj540（用户反馈）：列表里点击文件名就能打开/进入，所以右侧独立的「打开」按钮意义不大——删除掉。
   * adj547（用户反馈）：目录**先进去**（面包屑立刻变、列表显示"正在进入…"），再去读里面的 `.jps`——
   * 点完马上有反馈，不会让人以为"点不动"；读失败则回滚路径。 */
  const openEntry = async (entry: DirEntry) => {
    if (!ws) return
    if (entry.kind === 'dir') {
      const next = [...path, entry.name]
      const prev = path
      setBusy(true)
      setBusyLabel(workspaceCopy.enteringDir(entry.name)) // 立刻反馈
      setPath(next) // 乐观更新面包屑：先"进目录"
      setSelected([])
      setEdit(null)
      setConfirmDel(null)
      try {
        await refresh(ws, next, workspaceCopy.enteringDir(entry.name))
      } catch {
        setPath(prev) // 读失败回滚
      } finally {
        setBusy(false)
        setBusyLabel(null)
      }
      return
    }
    setBusy(true)
    setBusyLabel(workspaceCopy.openingFile(entry.name))
    try {
      const ok = await openWorkspaceFile([...path, entry.name])
      if (ok) closeDock()
    } finally {
      setBusy(false)
      setBusyLabel(null)
    }
  }

  /** 移动模式下切换目标目录（不动已定的搬运清单） */
  const refreshMovingTarget = async (next: string[]) => {
    if (!ws) return
    setBusy(true)
    setBusyLabel(workspaceCopy.readingTarget) // adj547
    try {
      const list = await readDirEntries(ws.handle, next)
      setEntries(list)
      setPath(next)
      void rememberWorkspacePath(next) // adj548：移动模式下选目标也记住
    } catch (e) {
      const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      showNotice(workspaceCopy.loadFailed(reason), 'error')
    } finally {
      setBusy(false)
      setBusyLabel(null)
    }
  }

  /** 提交输入区：改名 / 新建夹 / 另存 / 新建谱（四者共用一个输入框，故集中在这里分派） */
  const submitEdit = async () => {
    if (!ws || !edit) return
    const value = edit.value.trim()
    if (!value) return
    invalidateCache() // adj540：写操作 ⇒ 列表缓存先作废（否则刷新时吃到旧列表）
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
    // adj544：绑定属于**当前**工作区 ⇒ 写回原文件；属于别的工作区 ⇒ 先讲清原因（否则用户只看到
    // "保存怎么变成另存了"），再展开另存输入框让他决定存到哪儿（绝不静默写进当前工作区）
    const bind = useDocStore.getState().binding
    if (bind && bind.wsId === ws.id) {
      await saveFile()
      await refresh(ws, path)
      return
    }
    if (bind && bind.wsId !== ws.id) {
      showNotice(workspaceCopy.boundToOtherWorkspace(bind.wsName || '另一个工作区', ws.name, joinPath(bind.segs)), 'warn')
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
    invalidateCache() // adj540：移动会改动源目录与目标目录两处列表
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
      invalidateCache() // adj540：删除后列表缓存作废
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

  /**
   * adj544（用户要求 C）：**最近工作区**列表——一键切回上次那个（重启后尤其有用：
   * 重新选同一个文件夹会因为 FSA 不给稳定路径而变成"新工作区"，从列表点回去就不用重选）。
   */
  const recentList = (
    <div className="ws-recent">
      <div className="ws-recent-title">{workspaceCopy.recentWorkspaces}</div>
      {recent.map((r) => (
        <button
          key={r.id}
          type="button"
          className={`btn ws-recent-item${ws?.id === r.id ? ' is-current' : ''}`}
          onClick={() => void onActivate(r)}
          disabled={busy}
          title={r.name}
        >
          <span className="ws-icon">📁</span>
          <span className="ws-recent-name">{r.name}</span>
        </button>
      ))}
    </div>
  )

  // ---- 未设工作区：只有一个大按钮，先把前提做掉 ----
  if (!ws) {
    return (
      <div className="ws-panel ws-panel-gate">
        <div className="ws-desc">{workspaceCopy.desc}</div>
        <button type="button" className="btn primary ws-big" onClick={() => void onPick()} disabled={busy}>
          {workspaceCopy.pick}
        </button>
        {recent.length > 0 && recentList}
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
        {/* adj544：待校验绑定 ⇒ 说明"重新授权后就能写回原文件"，把这一步的意义讲清楚 */}
        {pending && <div className="ws-binding-hint">{workspaceCopy.bindingRestored(pending.wsName || ws.name, joinPath(pending.segs))}</div>}
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
      {/* adj549（用户要求）：**面包屑独占一整行**（切换工作区按钮 + 路径 + 移动提示），
          下面才分左右：左=目录/文件列表，右=过滤 / `*` / 消除过滤 / 操作▾。
          这样路径能拿到整个面板宽度（此前被右栏挤掉一百多像素，深目录看不全）。 */}
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

          {/* adj544（用户要求 C）：正常视图里也能"切回最近的工作区"——点「操作 → 最近的工作区…」就地展开 */}
          {showRecent && recent.length > 0 && (
            <div className="ws-recent ws-recent-inline">
              <div className="ws-recent-title">{workspaceCopy.recentWorkspaces}</div>
              <div className="ws-recent-row">
                {recent.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`btn ws-recent-item${ws?.id === r.id ? ' is-current' : ''}`}
                    onClick={() => {
                      setShowRecent(false)
                      void onActivate(r)
                    }}
                    disabled={busy}
                    title={r.name}
                  >
                    <span className="ws-icon">📁</span>
                    <span className="ws-recent-name">{r.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

      {/* adj549：下面分左右两栏——**左栏只有列表**，右栏是过滤 / `*` / 消除过滤 / 操作▾（固定宽度）。 */}
      <div className="ws-body">
        <div className="ws-left">
          <div className={`ws-list${busyLabel ? ' is-busy' : ''}`} title={workspaceCopy.onlyListed}>
            {/* adj547（用户反馈）：**进行中的提示**放在列表最上方**立刻**出现（转圈 + 文案），
                同时把旧内容变淡——用户一眼能分清"在忙"而不是"点不动/不能点"。 */}
            {busyLabel && (
              <div className="ws-loading" role="status" aria-live="polite">
                <span className="ws-spin" aria-hidden="true" />
                <span className="ws-loading-text">{busyLabel}</span>
              </div>
            )}
          {/* 过滤模式：**平坦结果**（跨子目录），点一条直接打开 —— 不提供勾选（改名/移动/删除要先清空过滤） */}
          {searching
            ? (hits ?? []).slice(0, RESULT_RENDER_MAX).map((h) => (
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
          {/* adj546：命中数超过渲染上限 ⇒ 如实说明（索引是全量的，只是没全画出来） */}
          {searching && (hits?.length ?? 0) > RESULT_RENDER_MAX && (
            <div className="ws-none">{workspaceCopy.searchCapped(hits?.length ?? 0, RESULT_RENDER_MAX)}</div>
          )}
          {/* adj546：正在后台重扫/首次扫描 ⇒ 显示进度（用户不必对着空白等半分钟） */}
          {scanInfo && <div className="ws-none">{workspaceCopy.scanning(scanInfo.scanned, scanInfo.found, scanInfo.ms)}</div>}
          </div>
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
                  // adj546（用户要求）：没勾选时**不显示任何文字**（原来那句"勾选后可操作"去掉）
                  null
                ) : selCount === 1 ? (
                  <span className="ws-side-name">{selectedEntries[0].name}</span>
                ) : (
                  <span className="ws-side-name">{workspaceCopy.selectedCount(selCount)}</span>
                )}
              </div>

              {/* adj545（用户要求）：**过滤三件套搬到右栏**（固定宽度那一列）——
                  过滤框 / `*` 所有 / 消除过滤。默认层级列表；一过滤就把整个工作区符合条件的
                  `.jps` 收成平坦列表（`*` 在过滤口径里是"任意串"⇒ 等价于"不过滤但走平坦列表"）。 */}
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
              <div className="ws-filter-row">
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
                {/* 消除过滤：常驻（无过滤时禁用）——位置固定，不因是否有过滤而跳动 */}
                <button
                  type="button"
                  className="btn ws-filter-clear"
                  onClick={() => setQuery('')}
                  disabled={!searching}
                  title={workspaceCopy.filterClear}
                  aria-label={workspaceCopy.filterClear}
                >
                  ✕
                </button>
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
                {/* adj548（用户反馈）：文本后的下三角**用 `下.png` 图标**（原来的 ▾ 字符太小看不清）；
                    展开时翻成 `上.png`，与顶栏视图下拉同一套观感。 */}
                <span className="ws-caret">
                  <ToolIcon name={menuOpen ? 'up' : 'down'} size={12} />
                </span>
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
            {/* adj546：手动**重新扫描**（外部新增了文件、或索引过期时用；否则靠落盘索引秒开） */}
            <button
              type="button"
              className="ws-menu-item"
              role="menuitem"
              disabled={!ws || busy}
              onClick={() => {
                setMenuOpen(false)
                if (!ws) return
                indexRef.current = null
                void buildIndex(ws.handle, ws.id, true).then(() => setIndexVersion((v) => v + 1))
              }}
            >
              {workspaceCopy.rescan}
            </button>
            {/* adj544：切回最近工作区（重启后 / 换过工作区后都用得着） */}
            {recent.length > 0 && (
              <button
                type="button"
                className="ws-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  // adj544：展开前重读列表——刚切换过工作区时，面板激活时拿到的那份已经旧了
                  void listWorkspaces().then(setRecent)
                  setShowRecent((v) => !v)
                }}
              >
                {workspaceCopy.recentWorkspaces}…
              </button>
            )}
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
