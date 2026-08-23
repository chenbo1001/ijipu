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
import { NOTE_MODIFIER_HINTS, VOLTA_HINTS } from './completions'

/** adj160：编辑器字体选项；adj163：仅等宽字体——textarea 与高亮层需逐字符对齐，
 *  非等宽字体下加粗 span（小节线/行头等）宽度变化会从该字符开始逐字累积错位 */
const EDITOR_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Cascadia Code', value: 'Cascadia Code' },
  { label: 'JetBrains Mono', value: 'JetBrains Mono' },
  { label: 'Consolas', value: 'Consolas' },
  { label: 'Fira Code', value: 'Fira Code' },
  { label: 'Courier New', value: 'Courier New' },
  { label: '等宽（系统默认）', value: 'monospace' },
]

/** adj165：自动提示浮层状态（null = 不显示） */
interface Completion {
  /** 提示类型：修饰符（& 编码）或跳房子（[ 后） */
  kind: 'modifier' | 'volta'
  /** 候选列表 */
  items: { code: string; label: string }[]
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

  const taRef = useRef<HTMLTextAreaElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
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

  // 滚动同步（高亮层 + 行号栏）
  const onScroll = () => {
    if (hlRef.current && taRef.current && gutterRef.current) {
      hlRef.current.scrollTop = taRef.current.scrollTop
      hlRef.current.scrollLeft = taRef.current.scrollLeft
      gutterRef.current.scrollTop = taRef.current.scrollTop
    }
    setCompletion(null) // adj165：滚动时关闭提示（位置不再准确）
  }

  // 光标写入 store + 谱面联动（M3）
  const onSelect = () => {
    const ta = taRef.current
    if (!ta) return
    const { line, col } = lineColOf(ta.value, ta.selectionStart)
    setCursor(line, col)
    setSelection(ta.selectionStart, ta.selectionEnd)
    const id = codePosToNoteId(ta.value, ta.selectionStart)
    setActiveNoteId(id)
  }
  onSelectRef.current = onSelect

  // adj165：分析光标前文本，触发自动提示（& 修饰符 / [ 跳房子）
  const updateCompletion = () => {
    const ta = taRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1)
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
      setCompletion({
        kind: 'modifier',
        items,
        index: 0,
        x: col * 7.5,
        y: (line - 1) * Math.round(editorFontSize * 1.7),
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
      setCompletion({
        kind: 'volta',
        items,
        index: 0,
        x: col * 7.5,
        y: (line - 1) * Math.round(editorFontSize * 1.7),
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
    if (c.kind === 'modifier') {
      // 替换已输入的 & 前缀（保留 &）
      const m = /&([a-zA-Z0-9]*)$/.exec(lineBefore)
      if (m) replaceLen = m[1].length
      insert = '&' + item.code + ' '
    } else {
      // 替换 [ 后已输入内容；插入 [ 本身 + 候选 + ]（无 ] 的候选不加）
      const b = lineBefore.lastIndexOf('[')
      const after = lineBefore.slice(b + 1)
      replaceLen = after.length
      insert = item.code
      if (!insert.includes(']')) insert += ' '
      if (insert.startsWith('"') && !insert.endsWith('"')) insert += ' '
    }
    const next = ta.value.slice(0, pos - replaceLen) + insert + ta.value.slice(pos)
    setCode(next)
    const newPos = pos - replaceLen + insert.length
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

  const onChange = () => {
    const ta = taRef.current
    if (!ta) return
    const next = ta.value
    const { line } = lineColOf(next, ta.selectionStart)
    if (autoFormat) {
      // adj110：光标离开上一行时才格式化该行（仅 Q 行，formatLine 逐行处理），
      // 输入中不格式化 → 不抢光标；格式化行在光标上方，偏移量同步光标
      if (editingLineRef.current >= 0 && editingLineRef.current !== line) {
        // adj111：lineColOf 行号 1-based，数组索引转 0-based（此前错位一行改到下一行）
        const li = editingLineRef.current - 1
        const lines = next.split('\n')
        const oldText = lines[li] ?? ''
        const formatted = formatLine(oldText)
        if (formatted !== oldText) {
          const delta = formatted.length - oldText.length
          lines[li] = formatted
          const replaced = lines.join('\n')
          const off = Math.max(0, Math.min(ta.selectionStart + delta, replaced.length))
          setCode(replaced)
          requestAnimationFrame(() => {
            if (taRef.current) {
              taRef.current.selectionStart = taRef.current.selectionEnd = off
              onScroll()
              onSelect()
            }
          })
          editingLineRef.current = line
          return
        }
      }
    }
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
  const editorLineH = Math.round(editorFontSize * 1.7)
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
        <span>脚本编辑器</span>
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
          {gutterLines.map((n) => {
            const errs = errByLine.get(n)
            return (
              <div
                key={n}
                className={errs ? 'gutter-line gutter-err' : 'gutter-line'}
                title={errs?.map((e) => e.msg).join('\n')}
                onDoubleClick={() => onGutterDoubleClick(n)}
              >
                {n}
              </div>
            )
          })}
        </div>
        <div className="editor-main">
          <textarea
            ref={taRef}
            value={code}
            spellCheck={false}
            wrap="off"
            autoCapitalize="off"
            autoCorrect="off"
            onChange={onChange}
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            onSelect={onSelect}
            onKeyUp={onSelect}
            onMouseUp={onSelect}
          />
          <div
            ref={hlRef}
            className="highlight-layer"
            dangerouslySetInnerHTML={{ __html: html }}
            aria-hidden="true"
          />
          {/* adj165：自动提示浮层（& 修饰符 / 跳房子输入提示） */}
          {completion && (
            <div
              className="editor-completion"
              style={{ left: completion.x + 14, top: completion.y + 14 }}
            >
              {completion.items.map((it, i) => (
                <div
                  key={it.code}
                  className={`completion-item${i === completion.index ? ' active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault() // 防止 textarea 失焦
                    const c = { ...completion, index: i }
                    applyCompletion(c)
                  }}
                >
                  <span className="completion-code">{it.code}</span>
                  <span className="completion-label">{it.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
