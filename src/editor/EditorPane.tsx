/**
 * editor/EditorPane.tsx — 代码编辑器（textarea + 语法高亮层 + 行号栏 + IDE 化体验）
 *
 * M2 能力：
 *  - 行号栏（与编辑区同步滚动；错误行红标 + 悬停显示错误消息）
 *  - 行首命令快捷键（光标在行首按 Q/C/B/Z/D/P/J/V/H 插入命令头）
 *  - 自动格式化（防抖 + 光标公共前缀保持）
 *  - 语法高亮（含错误行红底）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { highlightCode } from './highlight'
import { formatLine, codePosToNoteId } from '../engine'
import { insertLineHeader, isLineHeaderKey, lineColOf } from './shortcuts'
import { NOTE_MODIFIER_HINTS, VOLTA_HINTS, HEADER_HINTS } from './completions'

/** adj160：编辑器字体选项；adj163：仅等宽字体——textarea 与高亮层需逐字符对齐，
 *  非等宽字体下加粗 span（小节线/行头等）宽度变化会从该字符开始逐字累积错位；
 *  adj173：取消带编程连字（ligatures）的字体（Cascadia Code/JetBrains Mono/Fira Code），
 *  防止 |:、|| 等被渲染成连字字形导致显示层与实际层列错位 */
const EDITOR_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Consolas', value: 'Consolas' },
  { label: 'Courier New', value: 'Courier New' },
  { label: '等宽（系统默认）', value: 'monospace' },
]

/** adj165：自动提示浮层状态（null = 不显示） */
interface Completion {
  /** 提示类型：修饰符（& 编码）、跳房子（[ 后）、描述头（行首 Tab） */
  kind: 'modifier' | 'volta' | 'header'
  /** 候选列表（cursorAt = 插入后光标停靠位置，用于带声部名模板） */
  items: { code: string; label: string; cursorAt?: number }[]
  /** 当前高亮索引 */
  index: number
  /** 光标触发位置（相对 textarea 内容区，浮层定位用） */
  x: number
  y: number
}

/** 判断光标前是否在输入 & 编码（返回已输入的前缀） */
function modifierPrefix(lineBefore: string): string | null {
  const m = /&([a-zA-Z0-9]*)$/.exec(lineBefore)
  return m ? m[1] : null
}

/** 判断光标前是否在小节线块内输入 [（返回已输入内容；仅小节线后触发跳房子提示） */
function voltaPrefix(lineBefore: string): string | null {
  // 最近的 [ 之前必须是小节线（| 或 :| 等），且 [ 之后可跟部分修饰
  const b = lineBefore.lastIndexOf('[')
  if (b < 0) return null
  const after = lineBefore.slice(b + 1)
  // 若 [ 后已输入 ] 或音符等 → 不提示
  if (/[\]0-9|]/.test(after)) return null
  const before = lineBefore.slice(0, b)
  if (!/[|:]/.test(before)) return null
  // 前面最近非空白字符需是小节线
  const prev = before.trimEnd()
  if (prev === '' || !/[|:]/.test(prev[prev.length - 1])) return null
  return after
}

export function EditorPane() {
  const code = useDocStore((s) => s.code)
  const setCode = useDocStore((s) => s.setCode)
  const fileName = useDocStore((s) => s.fileName)
  const dirty = useDocStore((s) => s.dirty)
  const setCursor = useDocStore((s) => s.setCursor)
  const setSelection = useDocStore((s) => s.setSelection)
  const autoFormat = useDocStore((s) => s.autoFormat)
  const parseResult = useDocStore((s) => s.parseResult)
  // 编辑器字号（adj46：状态栏 +/- 按钮调整）
  const editorFontSize = useUiStore((s) => s.editorFontSize)
  const setEditorFontSize = useUiStore((s) => s.setEditorFontSize)
  // adj160：编辑器字体下拉框（与字号按钮同排）
  const editorFont = useUiStore((s) => s.editorFont)
  const setEditorFont = useUiStore((s) => s.setEditorFont)

  // adj165：行高取整为整数（textarea 原生行盒与高亮层 CSS 行盒完全一致）
  const editorLineH = Math.round(editorFontSize * 1.7)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  // adj167：显示层（高亮层/行号栏）内部滚动容器——用 transform 平移跟随 textarea 滚动位置，
  // 避免 scrollTop 同步被各自 scrollHeight 钳制（滚动到底时显示层停住、textarea 继续滚）
  const hlInnerRef = useRef<HTMLDivElement>(null)
  const gutterInnerRef = useRef<HTMLDivElement>(null)
  const formatTimer = useRef<number | null>(null)
  // adj110：最近编辑行（光标所在行）；光标离开该行时格式化它，避免输入时抢光标
  const editingLineRef = useRef<number>(-1)
  // adj165：自动提示浮层
  const [completion, setCompletion] = useState<Completion | null>(null)
  const completionRef = useRef<Completion | null>(null)
  completionRef.current = completion

  // 光标联动（M3）：光标移动 → 计算 notepos id → 预览高亮
  const setActiveNoteId = useDocStore((s) => s.setActiveNoteId)
  const cursorJump = useDocStore((s) => s.cursorJump)
  const undo = useDocStore((s) => s.undo)
  const redo = useDocStore((s) => s.redo)
  // adj165：当前光标行/列（1-based 行、0-based 列），供高亮当前行与当前区块
  const cursor = useDocStore((s) => s.cursor)
  const jumpCursor = useDocStore((s) => s.jumpCursor)
  const onSelectRef = useRef<() => void>(() => {})

  // 消费"点击谱面音符 / 撤销重做" → 跳转编辑器光标（含选区）请求
  useEffect(() => {
    if (!cursorJump) return
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    ta.selectionStart = Math.min(cursorJump.start, ta.value.length)
    ta.selectionEnd = Math.min(cursorJump.end, ta.value.length)
    // 滚动到光标所在行（行高 = 整数 --jp-editor-lh，adj165：与 CSS 取整一致）；adj63 wrap=off 需同步横向
    const pos = lineColOf(ta.value, cursorJump.start)
    ta.scrollTop = Math.max(0, (pos.line - 1) * Math.round(editorFontSize * 1.7) - 40)
    ta.scrollLeft = Math.max(0, pos.col * editorFontSize * 0.6 - 40)
    onScroll()
    onSelectRef.current()
  }, [cursorJump, editorFontSize])

  const errorCount = parseResult.errors.filter((e) => e.severity === 'error').length

  // 行号 + 错误行信息
  const lineCount = useMemo(() => code.split('\n').length, [code])
  const errByLine = useMemo(() => {
    const map = new Map<number, { col: number; msg: string; severity: string }[]>()
    for (const e of parseResult.errors) {
      if (e.line <= 0) continue
      const arr = map.get(e.line) ?? []
      arr.push({
        col: e.col,
        severity: e.severity,
        msg: `${e.severity === 'error' ? '错误' : '警告'}[第${e.line}行 第${e.col}列] ${e.message}`,
      })
      map.set(e.line, arr)
    }
    return map
  }, [parseResult])

  // adj165：双击错误行号 → 跳到该行第一个错误位置
  const onGutterDoubleClick = (line: number) => {
    const errs = errByLine.get(line)
    if (!errs || errs.length === 0) return
    const first = [...errs].sort((a, b) => a.col - b.col)[0]
    // 行首偏移 + 列偏移（0-based 列 → 直接加）
    const lines = code.split('\n')
    let offset = 0
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1
    jumpCursor(offset + first.col)
  }

  // 滚动同步（adj167：显示层内部容器用 transform 平移跟随 textarea 的滚动位置，
  // 不受显示层自身 scrollHeight 限制——滚动到底也不会停住/错层）
  const onScroll = () => {
    const ta = taRef.current
    if (!ta) return
    const hlInner = hlInnerRef.current
    const gutterInner = gutterInnerRef.current
    if (hlInner) hlInner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`
    if (gutterInner) gutterInner.style.transform = `translateY(${-ta.scrollTop}px)`
    setCompletion(null) // adj165：滚动时关闭提示（位置不再准确）
  }

  // adj195：每源码行的视觉行数（软折行下可能 >1）——行号栏按视觉行高渲染，
  // 折行不产生新行号、并用延续标记区分新行与折行
  const [contentW, setContentW] = useState(0)
  useEffect(() => {
    const parent = taRef.current?.parentElement ?? null
    if (!parent) return
    const update = () => {
      const ta = taRef.current
      if (ta) setContentW(ta.clientWidth - 28) // 内容区宽（去左右 padding 14×2）
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])
  const visualLines = useMemo(() => {
    const lines = code.split('\n')
    if (contentW <= 0) return lines.map(() => 1)
    // 估算字符宽（等宽 0.6×fs）：若行内容宽必然超内容区才需要精确折行数
    const charW = editorFontSize * 0.6
    const probe = document.createElement('div')
    probe.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;white-space:pre-wrap;width:${contentW}px;font-size:${editorFontSize}px;line-height:${editorLineH}px;font-family:${editorFont},monospace;padding:0`
    document.body.appendChild(probe)
    const res = lines.map((l) => {
      if (l.length * charW <= contentW) return 1 // 必不折行
      probe.textContent = l
      return Math.max(1, Math.round(probe.clientHeight / editorLineH))
    })
    document.body.removeChild(probe)
    return res
  }, [code, contentW, editorFontSize, editorLineH, editorFont])

  // 光标写入 store + 谱面联动（M3）
  const onSelect = () => {
    const ta = taRef.current
    if (!ta) return
    const { line, col } = lineColOf(ta.value, ta.selectionStart)
    // adj196：光标移动离开上一行（鼠标点击/方向键/谱面跳转）→ 格式化该行。
    // 注意：此函数内部 setCode 会触发 onChange，但 onChange 中 editingLineRef 已更新
    // 为当前行，不会重复格式化。
    formatLeftLine(ta.value, line)
    setCursor(line, col)
    setSelection(ta.selectionStart, ta.selectionEnd)
    const id = codePosToNoteId(ta.value, ta.selectionStart)
    setActiveNoteId(id)
  }
  onSelectRef.current = onSelect

  // adj194：窗口/容器宽度变化（软折行重排）后强制同步 transform——
  // 否则动态 resize 过程中显示层与实际层折行位置短暂错位
  const onScrollRef = useRef(onScroll)
  onScrollRef.current = onScroll
  useEffect(() => {
    const onResize = () => onScrollRef.current()
    window.addEventListener('resize', onResize)
    // 拆分窗格拖动也会改变编辑器宽度（ResizeObserver 兜底）
    const ro = new ResizeObserver(onResize)
    if (taRef.current?.parentElement) ro.observe(taRef.current.parentElement)
    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
    }
  }, [])

  // adj165：分析光标前文本，触发自动提示（& 修饰符 / [ 跳房子 / 描述头行首 Tab）
  const updateCompletion = () => {
    const ta = taRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1)
    // adj186：描述头区域行首 Tab → 列出所有描述头（行首 = 光标前仅空白）
    if (/^\s*$/.test(lineBefore)) {
      const { line, col } = lineColOf(ta.value, pos)
      setCompletion({
        kind: 'header',
        items: HEADER_HINTS,
        index: 0,
        x: col * editorFontSize * 0.6,
        y: (line - 1) * Math.round(editorFontSize * 1.7) + Math.round(editorFontSize * 1.7),
      })
      return
    }
    // 仅 Q 行（曲行）内提示
    if (!/^Q(\d*(?:"[^"]*")?\s*:)/.test(lineBefore) && !/^\s*Q/.test(lineBefore)) {
      setCompletion(null)
      return
    }
    const mod = modifierPrefix(lineBefore)
    if (mod !== null) {
      const items = NOTE_MODIFIER_HINTS.filter((h) => h.code.startsWith(mod) || mod === '')
      if (items.length === 0) {
        setCompletion(null)
        return
      }
      const { line, col } = lineColOf(ta.value, pos)
      // adj177：浮层定位在光标字符下方——x = 列 × 等宽字符宽（0.6×fs），y = 行顶 + 行高
      setCompletion({
        kind: 'modifier',
        items,
        index: 0,
        x: col * editorFontSize * 0.6,
        y: (line - 1) * Math.round(editorFontSize * 1.7) + Math.round(editorFontSize * 1.7),
      })
      return
    }
    const volta = voltaPrefix(lineBefore)
    if (volta !== null) {
      const items = VOLTA_HINTS.filter((h) => h.code.startsWith(volta))
      if (items.length === 0) {
        setCompletion(null)
        return
      }
      const { line, col } = lineColOf(ta.value, pos)
      // adj177：与修饰符提示一致，定位在光标字符下方
      setCompletion({
        kind: 'volta',
        items,
        index: 0,
        x: col * editorFontSize * 0.6,
        y: (line - 1) * Math.round(editorFontSize * 1.7) + Math.round(editorFontSize * 1.7),
      })
      return
    }
    setCompletion(null)
  }

  // 补全候选（插入文本）
  const applyCompletion = (c: Completion) => {
    const ta = taRef.current
    if (!ta) return
    const item = c.items[c.index]
    if (!item) return
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1)
    let insert = item.code
    let replaceLen = 0
    let cursorAt: number | null = null
    if (c.kind === 'header') {
      // adj186：描述头行首补全；adj192：带声部名模板（cursorAt）光标停在引号内待输入
      insert = item.code + ' '
      cursorAt = item.cursorAt ?? insert.length
    } else if (c.kind === 'modifier') {
      // adj177：用户已输入 &（lineBefore 以 & 结尾），只补全其后的字母——
      // 不再拼接第二个 &（此前 replaceLen 仅替换字母、insert 又含 &，会变成 &&tr）
      const m = /&([a-zA-Z0-9]*)$/.exec(lineBefore)
      if (m) replaceLen = m[1].length
      insert = item.code + ' '
      cursorAt = insert.length
    } else {
      // 替换 [ 后已输入内容；插入 [ 本身 + 候选 + ]（无 ] 的候选不加）
      const b = lineBefore.lastIndexOf('[')
      const after = lineBefore.slice(b + 1)
      replaceLen = after.length
      insert = item.code
      if (!insert.includes(']')) insert += ' '
      if (insert.startsWith('"') && !insert.endsWith('"')) insert += ' '
      cursorAt = insert.length
    }
    const next = ta.value.slice(0, pos - replaceLen) + insert + ta.value.slice(pos)
    setCode(next)
    const newPos = pos - replaceLen + (cursorAt ?? insert.length)
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.selectionStart = taRef.current.selectionEnd = newPos
        onScroll()
        onSelect()
        setCompletion(null)
      }
    })
  }

  // 行首命令快捷键：光标在行首时按 Q/C/B/Z/D/P/J/V/H 插入命令头
  // 限制：歌词行（C 行）只允许插入 C；曲行（Q 行）只允许 Q/C；IME 合成事件排除
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = taRef.current
    if (!ta) return
    if (e.nativeEvent.isComposing) return // 输入法合成中不触发
    // adj165：自动提示导航（↑↓ 选择 / Enter Tab 补全 / Esc 关闭）
    const comp = completionRef.current
    if (comp) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCompletion({ ...comp, index: (comp.index + 1) % comp.items.length })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCompletion({ ...comp, index: (comp.index - 1 + comp.items.length) % comp.items.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyCompletion(comp)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setCompletion(null)
        return
      }
    }
    // adj111：撤销/重做在编辑器内直接处理（受控 textarea 浏览器原生撤销无效；
    // stopPropagation 防止与 App 全局快捷键双重触发）
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      e.stopPropagation()
      undo()
      return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      e.stopPropagation()
      redo()
      return
    }
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    const key = e.key
    if (key.length !== 1 || !isLineHeaderKey(key.toUpperCase())) return
    const keyUp = key.toUpperCase() as Parameters<typeof insertLineHeader>[2]
    // 当前行类型（光标前内容）
    const before = ta.value.slice(0, ta.selectionStart)
    const lineText = before.slice(before.lastIndexOf('\n') + 1)
    const isMusicLine = /^Q\d*(?:"[^"]*")?\s*:/.test(lineText)
    const isLyricLine = /^C\d*\s*:/.test(lineText)
    if (isLyricLine && keyUp !== 'C') return // 编辑歌词时避免误触其他命令
    if (isMusicLine && keyUp !== 'Q' && keyUp !== 'C') return
    const insert = insertLineHeader(ta.value, ta.selectionStart, keyUp)
    if (!insert) return
    e.preventDefault()
    setCode(insert.text)
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.selectionStart = taRef.current.selectionEnd = insert.pos
        onSelect()
      }
    })
  }

  // adj196：光标离开上一行时格式化该行（仅 Q 行）。输入（onChange）与光标移动
  // （onSelect：鼠标点击/方向键/谱面跳转）都触发——此前只有 onChange 处理，
  // 鼠标点击离开行不会格式化。
  // 返回是否已执行格式化（调用方据此跳过后续处理）。
  const formatLeftLine = (text: string, newLine: number): boolean => {
    if (!autoFormat) return false
    const prev = editingLineRef.current
    if (prev < 0 || prev === newLine) return false
    const li = prev - 1 // adj111：1-based 行 → 0-based 索引
    const lines = text.split('\n')
    const oldText = lines[li] ?? ''
    const formatted = formatLine(oldText)
    if (formatted === oldText) {
      editingLineRef.current = newLine
      return false
    }
    const delta = formatted.length - oldText.length
    lines[li] = formatted
    const replaced = lines.join('\n')
    const ta = taRef.current
    const off = ta ? Math.max(0, Math.min(ta.selectionStart + delta, replaced.length)) : 0
    setCode(replaced)
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.selectionStart = taRef.current.selectionEnd = off
        onScroll()
        onSelect()
      }
    })
    editingLineRef.current = newLine
    return true
  }

  const onChange = () => {
    const ta = taRef.current
    if (!ta) return
    const next = ta.value
    const { line } = lineColOf(next, ta.selectionStart)
    // adj110：光标离开上一行时才格式化该行（仅 Q 行，formatLine 逐行处理），
    // 输入中不格式化 → 不抢光标；格式化行在光标上方，偏移量同步光标
    if (formatLeftLine(next, line)) return
    editingLineRef.current = line
    setCode(next)
    // adj165：输入后更新自动提示
    requestAnimationFrame(updateCompletion)
  }

  useEffect(() => {
    return () => {
      if (formatTimer.current) window.clearTimeout(formatTimer.current)
    }
  }, [])

  const html = highlightCode(code, new Set(errByLine.keys()), cursor)
  const gutterLines = Array.from({ length: lineCount }, (_, i) => i + 1)

  // 编辑器字号 → CSS 变量（--jp-editor-fs / --jp-editor-lh），驱动 textarea/高亮层/行号栏
  // adj163：字体值保留 monospace 回退——避免所选字体缺失时退化为非等宽默认字体导致
  // 高亮层加粗 span 与 textarea 逐字符错位
  // adj165：行高取整为整数——非整数行高（如 14×1.7=23.8px）在 textarea 原生行盒与
  // 高亮层 CSS 行盒中按各自方式取整，多行后累积错位（选中行高亮到另一行）
  const editorStyle = {
    '--jp-editor-fs': `${editorFontSize}px`,
    '--jp-editor-lh': `${editorLineH}px`,
    '--jp-editor-font': `${editorFont}, monospace`,
  } as React.CSSProperties

  return (
    <div className="editor-pane">
      <div className="editor-head">
        {/* adj63：文件名从菜单栏右侧移至此（.jps 标签处） */}
        <span className="file-tag">
          {(fileName || '未命名') + '.jps'}
          {dirty && <span className="dirty-dot" title="有未保存的修改" />}
        </span>
        <span className={errorCount > 0 ? 'err-count has-error' : 'err-count'}>
          {errorCount > 0 ? `${errorCount} 个语法错误` : '语法正确'}
        </span>
        {/* adj160：编辑器字体下拉框（字号按钮左侧） */}
        <span className="editor-font-select">
          <select
            value={editorFont}
            onChange={(e) => setEditorFont(e.target.value)}
            title="编辑器字体"
            style={{ fontFamily: `'${editorFont}', monospace` }}
          >
            {EDITOR_FONT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </span>
        <span className="editor-font-control">
          <button
            className="font-btn"
            title="减小字号"
            onClick={() => setEditorFontSize(editorFontSize - 1)}
          >
            A−
          </button>
          <span className="font-size-val">{editorFontSize}px</span>
          <button
            className="font-btn"
            title="增大字号"
            onClick={() => setEditorFontSize(editorFontSize + 1)}
          >
            A+
          </button>
        </span>
      </div>
      <div className="editor-body" style={editorStyle}>
        <div className="editor-gutter" ref={gutterRef} aria-hidden="true">
          <div className="editor-gutter-inner" ref={gutterInnerRef}>
            {gutterLines.map((n) => {
              const errs = errByLine.get(n)
              const vis = visualLines[n - 1] ?? 1
              return (
                <div
                  key={n}
                  className={errs ? 'gutter-line gutter-err' : 'gutter-line'}
                  style={{ height: vis * editorLineH }}
                  title={errs?.map((e) => e.msg).join('\n')}
                  onDoubleClick={() => onGutterDoubleClick(n)}
                >
                  <span className="gutter-num">{n}</span>
                  {/* adj195：折行延续标记（不占新行号，区分新行与折行） */}
                  {vis > 1 &&
                    Array.from({ length: vis - 1 }, (_, k) => (
                      <span key={k} className="gutter-wrap-mark" />
                    ))}
                </div>
              )
            })}
          </div>
        </div>
        <div className="editor-main">
          <textarea
            ref={taRef}
            value={code}
            spellCheck={false}
            wrap="soft"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={onChange}
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            onSelect={onSelect}
            onKeyUp={onSelect}
            onMouseUp={onSelect}
          />
          <div ref={hlRef} className="highlight-layer" aria-hidden="true">
            <div className="highlight-inner" ref={hlInnerRef}>
              {/* adj171：当前行整行背景铺满层（随 inner transform 一起平移；宽度铺满编辑区）
                  adj172：top 含内容层 padding-top 10px（否则背景整体偏上 10px） */}
              {cursor && (
                <div
                  className="editor-current-line-bg"
                  style={{ top: 10 + (cursor.line - 1) * editorLineH }}
                />
              )}
              <div
                className="highlight-content"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
          {/* adj165：自动提示浮层（& 修饰符 / 跳房子 / 描述头）；adj177：定位含内容层 padding（上 10 左 14）；
              adj192：靠下输入时浮层改为在光标上方弹出（否则列表超出窗口底部无法选择） */}
          {completion && (
            <CompletionPopover
              completion={completion}
              containerRef={taRef.current?.parentElement ?? null}
              lineH={editorLineH}
              onPick={(c) => applyCompletion(c)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** adj192：自动提示浮层——靠下时翻转到光标上方显示，避免列表超出窗口底部 */
function CompletionPopover({
  completion,
  containerRef,
  lineH,
  onPick,
}: {
  completion: Completion
  containerRef: HTMLElement | null
  lineH: number
  onPick: (c: Completion) => void
}) {
  const { x, y, items } = completion
  // 估算浮层高：每项约 24px + 上下 padding
  const estH = items.length * 24 + 8
  const containerH = containerRef?.clientHeight ?? 600
  // 默认显示在光标下方（y 已含行高）；若超出容器底部则翻转到光标上方
  const below = y + 10
  const flip = below + estH > containerH
  const top = flip ? Math.max(4, y - lineH - estH + 10) : below
  return (
    <div className="editor-completion" style={{ left: x + 14, top }}>
      {items.map((it, i) => (
        <div
          key={it.code}
          className={`completion-item${i === completion.index ? ' active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault() // 防止 textarea 失焦
            onPick({ ...completion, index: i })
          }}
        >
          <span className="completion-code">{it.code}</span>
          <span className="completion-label">{it.label}</span>
        </div>
      ))}
    </div>
  )
}
