/**
 * ui/dock/FindPanel.tsx — dock 的「查找替换」面板（adj641，用户要求）
 *
 * 用户口径（原话）："编辑区只有 Ctrl+F 搜索操作，还缺少一个替换操作，请补全，我的想法是在底栏 dock 里
 * 增加一个查找替换页签，将查找和替换进行整合，页签里有查找内容框、替换内容框，有查找统计，
 * 还有查找按钮、替换按钮。"
 *
 * ## 职责划分
 *  · 匹配 / 替换 / 前后跳转的**算法**在 `editor/findReplace.ts`（纯函数，smoke 直接断言）；
 *  · 本组件只做三件事：读 `code` 与选区 → 调纯函数 → 把结果写回 store（`setCode` / `jumpCursor`）。
 *
 * ## 为什么"当前项"不自己记一个下标
 * `jumpCursor(pos, end)` 会把编辑器选区设成该命中项，所以**选区本身就是"当前项"的凭据**
 * （`currentMatchIndex`）；用户随手点一下光标又自然回到"光标之后的第一项"。
 * 少一份状态，就不会出现"面板说第 3 处、编辑器停在别处"这类两份真相漂移。
 *
 * ## 键盘
 * 查找框：`Enter` = 下一个、`Shift+Enter` = 上一个；替换框：`Enter` = 替换一处。
 * `Ctrl+F`（App 全局）打开本面板并聚焦查找框：请求走 `uiStore.requestFind()`（nonce），
 * 因为"已经开着这个页签再按一次 Ctrl+F"时 `dockPanel` 没变、靠 effect 收不到信号。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDocStore } from '../../store/docStore'
import { useUiStore } from '../../store/uiStore'
import { findCopy } from '../../brand/copy'
import {
  currentMatchIndex,
  findMatches,
  replaceAllMatches,
  replaceOne,
  replaceTargetIndex,
  targetMatchIndex,
} from '../../editor/findReplace'

export function FindPanel() {
  const code = useDocStore((s) => s.code)
  const sel = useDocStore((s) => s.sel)
  const setCode = useDocStore((s) => s.setCode)
  const setSelection = useDocStore((s) => s.setSelection)
  const jumpCursor = useDocStore((s) => s.jumpCursor)
  /** 只有本面板是"当前页签且底栏开着"时才去抢焦点（面板是常挂载的，隐藏时不能抢） */
  const active = useUiStore((s) => s.dockOpen && s.dockPanel === 'find')
  const findFocus = useUiStore((s) => s.findFocus)

  const query = useUiStore((s) => s.findQuery)
  const setQuery = useUiStore((s) => s.setFindQuery)
  const [replacement, setReplacement] = useState('')
  /**
   * 区分大小写默认开（见 findReplace.ts 文件头：`.jps` 里大小写有语义）。
   * adj642：与查找内容一起**放在 store**——编辑区高亮（`editor/findHighlight.ts`）要读同一份，
   * 两份状态必然漂移。
   */
  const caseSensitive = useUiStore((s) => s.findCaseSensitive)
  const setCaseSensitive = useUiStore((s) => s.setFindCaseSensitive)
  /** 替换结果提示（短暂显示，不额外弹 toast） */
  const [justReplaced, setJustReplaced] = useState(0)

  const findRef = useRef<HTMLInputElement | null>(null)
  const matches = useMemo(() => findMatches(code, query, { caseSensitive }), [code, query, caseSensitive])
  const cur = currentMatchIndex(matches, sel)

  /**
   * Ctrl+F / 点页签进入本面板 ⇒ 聚焦查找框并全选（与浏览器查找条同一手感）。
   * 依赖 `active` 与 `findFocus`：前者覆盖"点页签进来"，后者覆盖"已经在本页签再按 Ctrl+F"。
   *
   * ⚠ adj641 实测记录（挂真 `ToolDock` + 真 store 的无头浏览器验证）：本面板走 `React.lazy`，首次
   * `requestFind()` 时外层 pane 刚从 `hidden` 切到可见、chunk 也才到位，**同步** `focus()` 有被浏览器
   * 忽略的风险（元素此刻可能还不可聚焦）。所以补一帧（`requestAnimationFrame`）重试一次：布局稳定后
   * 再聚焦，幂等、无副作用——实测首次打开后焦点确实落在查找框上（`document.activeElement` = `input.find-input`）。
   */
  useEffect(() => {
    if (!active) return
    const el = findRef.current
    if (!el) return
    const focusNow = () => {
      el.focus()
      el.select()
    }
    focusNow()
    const raf = requestAnimationFrame(focusNow)
    return () => cancelAnimationFrame(raf)
  }, [active, findFocus])

  /**
   * 跳到第 i 项（i < 0 表示没有匹配）。
   *
   * ⚠ 同时写 `setSelection` 与 `jumpCursor`，两者缺一不可：
   *  · `jumpCursor` 是"把编辑器选区挪过去并滚动居中"的请求（由 `EditorPane` 消费）；
   *  · 但 `EditorPane` **只在编辑视图挂载**——预览/预览为主的分屏下没人消费它，
   *    此时 store 里的 `sel` 不会变 ⇒ 面板的"当前项"就永远算作光标之前那一处，
   *    连按「下一个」会一直跳同一处（看起来像没反应）。所以面板自己把选区写回 store：
   *    面板的"当前项"只依赖 `sel`，这条让它在**任何视图**下都自洽。
   */
  const goto = (i: number) => {
    const m = matches[i]
    if (!m) return
    setJustReplaced(0)
    setSelection(m.start, m.end)
    jumpCursor(m.start, m.end)
  }

  const step = (dir: 1 | -1) => {
    const i = targetMatchIndex(matches, sel, dir)
    if (i >= 0) goto(i)
  }

  /** 替换当前一处（选区不是命中项时 = 光标之后的第一处） */
  const replaceCurrent = () => {
    if (matches.length === 0) return
    const i = replaceTargetIndex(matches, sel.start)
    const m = matches[i]
    if (!m) return
    const r = replaceOne(code, m, replacement)
    setCode(r.code)
    setJustReplaced((n) => n + 1)
    // 光标落到替换串末尾 ⇒ 下一处自动成为"光标之后的第一项"（连点即连续替换）
    setSelection(r.caret, r.caret)
    jumpCursor(r.caret)
  }

  const replaceAll = () => {
    if (matches.length === 0) return
    const r = replaceAllMatches(code, matches, replacement)
    if (r.code === code) return
    setCode(r.code)
    setJustReplaced(r.count)
    setSelection(r.firstStart, r.firstStart)
    jumpCursor(r.firstStart)
  }

  /** 统计行：没输入 → 提示；有输入无匹配 → 无匹配；否则"共 N 处 · 第 i/N 处" */
  const stat = !query
    ? { text: findCopy.statIdle, tone: 'idle' as const }
    : matches.length === 0
      ? { text: findCopy.statNone, tone: 'none' as const }
      : {
          text: cur >= 0 ? `${findCopy.statTotal(matches.length)} · ${findCopy.statCurrent(cur + 1, matches.length)}` : findCopy.statTotal(matches.length),
          tone: 'ok' as const,
        }
  const disabled = matches.length === 0

  return (
    <div className="find-panel">
      <div className="find-row">
        <span className="find-label">{findCopy.findLabel}</span>
        <input
          ref={findRef}
          className="find-input"
          type="text"
          value={query}
          placeholder={findCopy.findPlaceholder}
          spellCheck={false}
          autoComplete="off"
          aria-label={findCopy.findLabel}
          onChange={(e) => {
            setQuery(e.target.value)
            setJustReplaced(0)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          }}
        />
        <span className={`find-stats is-${justReplaced > 0 ? 'ok' : stat.tone}`} role="status" aria-live="polite">
          {justReplaced > 0 ? findCopy.replaced(justReplaced) : stat.text}
        </span>
      </div>
      <div className="find-row">
        <span className="find-label">{findCopy.replaceLabel}</span>
        <input
          className="find-input"
          type="text"
          value={replacement}
          placeholder={findCopy.replacePlaceholder}
          spellCheck={false}
          autoComplete="off"
          aria-label={findCopy.replaceLabel}
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (e.shiftKey) replaceAll()
            else replaceCurrent()
          }}
        />
        <label className="find-check" title={findCopy.caseSensitiveTitle}>
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          <span>{findCopy.caseSensitive}</span>
        </label>
      </div>
      <div className="dock-actions find-actions">
        <button type="button" className="find-btn" disabled={disabled} title={findCopy.prevTitle} onClick={() => step(-1)}>
          {findCopy.prev}
        </button>
        <button type="button" className="find-btn" disabled={disabled} title={findCopy.nextTitle} onClick={() => step(1)}>
          {findCopy.next}
        </button>
        <button type="button" className="find-btn" disabled={disabled} title={findCopy.replaceOneTitle} onClick={replaceCurrent}>
          {findCopy.replaceOne}
        </button>
        <button type="button" className="find-btn" disabled={disabled} title={findCopy.replaceAllTitle} onClick={replaceAll}>
          {findCopy.replaceAll}
        </button>
      </div>
      <div className="find-hint">{findCopy.hint}</div>
    </div>
  )
}
