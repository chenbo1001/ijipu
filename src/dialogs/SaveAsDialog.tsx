/**
 * dialogs/SaveAsDialog.tsx — 「保存到工作区」专用对话框（adj963，**用户要求**）
 *
 * ## 为什么要有它（而不是继续用工作区面板）
 *
 * 插件（Obsidian 嵌入版）里点「保存」，原来走 `TopBar.runSaveSmart` 的 `isHostEmbedded()` 分支：
 * 把用户送到**工作区面板**并展开"另存"输入框。但嵌入版的工作区页签是**隐藏**的
 * （`ToolDock` 的 `visibleTabs`，口径"嵌入版文件操作交给 Obsidian"）——
 * 面板虽然还能被渲染出来（内容区按 `everActive` 渲染），页签条里却没有它、切走就回不来。
 * 于是"保存"这条路上用户看到的是一块**没有页签的面板**，说不清自己到了哪。
 *
 * 用户的要求（原话）：插件模式下保存应显示一个**保存对话框**：一个下拉列表显示当前工作区
 * 子目录的文件列表、一个编辑框输入文件名、名称默认用**描述头第一个 `B:`** 的内容填充。
 *
 * ## 三条实现口径（全部沿用既有实现，不另起一套）
 *
 * 1. **写盘与绑定一律走 `docStore.saveToWorkspace(segs)`** —— 它内部已经带了
 *    重名保护（目标已有同名文件、且不是本文档当前绑定的那个 ⇒ **拒绝并提示**，不静默覆盖别人的谱）、
 *    写入回读、基准刷新（`setBaseline`）、绑定与草稿来源、以及"保存中…"提示。
 *    ⚠ 绝不在这里自己拼 `writeWorkspaceText`：那会把上面这几件事漏掉。
 * 2. **默认文件名取 `parseResult.header.titles[0]`** —— 与 `docStore.saveFileAs` 里
 *    "未命名时用描述头第一个 B: 标题"是**同一句口径**（那边是给系统对话框当 `suggestedName`）。
 * 3. **目录按需一层层列**（`readDirEntries` 只列当前层）：文库大时拉整棵树既慢又吵，
 *    而"存到哪儿"通常看当前这层就能决定。已存在的 `.jps` 一并列出来当参照，点它把名字填进输入框。
 *
 * 权限：网页版（FSA）刷新后首次使用是 `prompt`，而**申请必须在用户手势内**
 * （挂载时静默申请会被浏览器拒，见 `docs/DESKTOP-ASSOC-AND-ANDROID.md` §3.1）
 * ⇒ 这里给一个明确的「继续访问」按钮，点了才申请。嵌入版（vault 工作区）走宿主桥，无需授权。
 */
import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'
import { saveAsCopy } from '../brand/copy'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import type { WorkspaceRecord } from '../store/fileHandleDb'
import {
  getWorkspace,
  joinPath,
  queryWorkspacePermission,
  readDirEntries,
  requestWorkspacePermission,
  stripJpsExt,
  type DirEntry,
} from '../store/workspace'

/** 文件名里不允许的字符（Windows 内核限制；Obsidian 文库同样不吃）——写盘前就拦下 */
const BAD_NAME_RE = /[\\/:*?"<>|]/

export function SaveAsDialog() {
  const closeModal = useUiStore((s) => s.closeModal)
  const showNotice = useUiStore((s) => s.showNotice)
  const saveToWorkspace = useDocStore((s) => s.saveToWorkspace)
  const titles = useDocStore((s) => s.parseResult.header.titles)
  const fileName = useDocStore((s) => s.fileName)

  const [ws, setWs] = useState<WorkspaceRecord | null>(null)
  const [segs, setSegs] = useState<string[]>([])
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [name, setName] = useState('')
  const [needGrant, setNeedGrant] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /**
   * 默认文件名：**描述头第一个 `B:`** 优先（与 `docStore.saveFileAs` 同一口径）；
   * 没有标题就退到当前文件名（已是"未命名"就留空，让占位符说话）。
   */
  useEffect(() => {
    const t = (titles[0] ?? '').trim()
    const fn = stripJpsExt(String(fileName ?? ''))
    setName(t !== '' && t !== '未命名' ? t : fn === '未命名' ? '' : fn)
  }, [titles, fileName])

  /** 取工作区 + 定位起始目录 + 列第一层（只在挂载时做一次；之后目录由用户点着走） */
  useEffect(() => {
    let alive = true
    const run = async (): Promise<void> => {
      const rec = await getWorkspace()
      if (!alive) return
      setWs(rec)
      if (!rec) {
        setErr(saveAsCopy.noWorkspace)
        return
      }
      // 起始目录：本文档已绑定在**同一个**工作区 ⇒ 它所在目录（"再存一份到旁边"最常见）；
      // 否则用工作区记录里"上次所在的子目录"。
      // ⚠ 绑定属于**别的**工作区时不能拿它的 segs 去新根上定位（那就是 E-2026-251 那类静默写错文件）。
      const bind = useDocStore.getState().binding
      const start = bind && bind.wsId === rec.id ? bind.segs.slice(0, -1) : rec.path
      setSegs(start)
      setBusy(true)
      try {
        const q = await queryWorkspacePermission(rec)
        if (!alive) return
        if (q !== 'granted') {
          setNeedGrant(true)
          return
        }
        const list = await readDirEntries(rec, start)
        if (alive) setEntries(list)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setBusy(false)
      }
    }
    void run()
    return () => {
      alive = false
    }
    // 挂载时取一次即可：目录切换由 goto() 负责，不跟着 store 重跑（绑定/工作区都用 getState 现取）
  }, [])

  /** 进入某个目录并列出它（点目录 / 点「上一层」） */
  const goto = async (next: string[]): Promise<void> => {
    if (!ws) return
    setSegs(next)
    setBusy(true)
    setErr(null)
    try {
      setEntries(await readDirEntries(ws, next))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setEntries([])
    } finally {
      setBusy(false)
    }
  }

  /** 「继续访问」：授权**必须**在用户手势里发起（见文件头） */
  const grant = async (): Promise<void> => {
    if (!ws) return
    setBusy(true)
    try {
      const q = await requestWorkspacePermission(ws)
      if (q !== 'granted') {
        setErr(saveAsCopy.needGrant)
        return
      }
      setNeedGrant(false)
      setErr(null)
      setEntries(await readDirEntries(ws, segs))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doSave = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed === '') {
      showNotice(saveAsCopy.emptyName, 'warn')
      return
    }
    if (BAD_NAME_RE.test(trimmed)) {
      showNotice(saveAsCopy.badName, 'warn')
      return
    }
    // 写盘/绑定/重名保护全在 saveToWorkspace 里（见文件头口径 1）
    const ok = await saveToWorkspace([...segs, `${stripJpsExt(trimmed)}.jps`])
    if (ok) closeModal()
  }

  const dirs = entries.filter((e) => e.kind === 'dir')
  const files = entries.filter((e) => e.kind === 'file')

  return (
    <Modal title={saveAsCopy.title} width={560}>
      <div className="save-as">
        <div className="save-as-field">
          <label className="save-as-label" htmlFor="save-as-name">
            {saveAsCopy.nameLabel}
          </label>
          <input
            id="save-as-name"
            className="save-as-input"
            value={name}
            placeholder={saveAsCopy.namePlaceholder}
            spellCheck={false}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doSave()
            }}
          />
        </div>
        {/* 位置：当前目录（面包屑）；根目录时说明是文库根（FSA 拿不到完整磁盘路径，见 workspaceCopy.grantPathHint） */}
        <div className="save-as-where" title={joinPath(segs)}>
          <span className="save-as-label">{saveAsCopy.dirLabel}</span>
          <span className="save-as-path">{segs.length === 0 ? saveAsCopy.rootLabel : joinPath(segs)}</span>
        </div>
        <div className="save-as-hint">{saveAsCopy.dirHint}</div>
        {needGrant ? (
          <div className="save-as-grant">
            <div className="save-as-hint">{saveAsCopy.needGrant}</div>
            <button type="button" className="btn" disabled={busy} onClick={() => void grant()}>
              {saveAsCopy.grantBtn}
            </button>
          </div>
        ) : (
          <div className="save-as-list" role="listbox" aria-label={saveAsCopy.dirLabel}>
            {segs.length > 0 && (
              <button type="button" className="save-as-item is-up" onClick={() => void goto(segs.slice(0, -1))}>
                ↑ {saveAsCopy.upLabel}
              </button>
            )}
            {busy && <div className="save-as-empty">{saveAsCopy.loading}</div>}
            {!busy &&
              dirs.map((d) => (
                <button key={`d:${d.name}`} type="button" className="save-as-item" onClick={() => void goto([...segs, d.name])}>
                  📁 {d.name}
                </button>
              ))}
            {!busy && files.length > 0 && (
              <div className="save-as-files">
                {files.map((f) => (
                  <button
                    key={`f:${f.name}`}
                    type="button"
                    className="save-as-file"
                    title={saveAsCopy.existsTip}
                    onClick={() => setName(stripJpsExt(f.name))}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            {!busy && dirs.length === 0 && files.length === 0 && <div className="save-as-empty">{saveAsCopy.emptyDir}</div>}
          </div>
        )}
        {err !== null && <div className="save-as-err">{err}</div>}
        <div className="save-as-actions">
          <button type="button" className="btn" onClick={closeModal}>
            {saveAsCopy.cancelBtn}
          </button>
          <button type="button" className="btn primary" disabled={busy || needGrant} onClick={() => void doSave()}>
            {saveAsCopy.saveBtn}
          </button>
        </div>
      </div>
    </Modal>
  )
}
