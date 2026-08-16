/**
 * editor/EditorPane.tsx — 代码编辑器（textarea + 语法高亮层 + 行号栏 + IDE 化体验）
 *
 * M2 能力：
 *  - 行号栏（与编辑区同步滚动；错误行红标 + 悬停显示错误消息）
 *  - 行首命令快捷键（光标在行首按 Q/C/B/Z/D/P/J/V/H 插入命令头）
 *  - 自动格式化（防抖 + 光标公共前缀保持）
 *  - 语法高亮（含错误行红底）
 */
import { useEffect, useMemo, useRef } from 'react'
import { useDocStore } from '../store/docStore'
import { highlightCode } from './highlight'
import { formatJps, codePosToNoteId } from '../engine'
import { insertLineHeader, isLineHeaderKey, lineColOf } from './shortcuts'

export function EditorPane() {
  const code = useDocStore((s) => s.code)
  const setCode = useDocStore((s) => s.setCode)
  const setCursor = useDocStore((s) => s.setCursor)
  const autoFormat = useDocStore((s) => s.autoFormat)
  const parseResult = useDocStore((s) => s.parseResult)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const formatTimer = useRef<number | null>(null)

  // 光标联动（M3）：光标移动 → 计算 notepos id → 预览高亮
  const setActiveNoteId = useDocStore((s) => s.setActiveNoteId)
  const cursorJump = useDocStore((s) => s.cursorJump)
  const onSelectRef = useRef<() => void>(() => {})

  // 消费"点击谱面音符 → 跳转编辑器光标"请求
  useEffect(() => {
    if (!cursorJump) return
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    ta.selectionStart = ta.selectionEnd = cursorJump.pos
    // 滚动到光标所在行（行高 23.8px = 14px × 1.7，与 CSS --jp-editor-lh 一致）
    const { line } = lineColOf(ta.value, cursorJump.pos)
    ta.scrollTop = Math.max(0, (line - 1) * 23.8 - 40)
    onScroll()
    onSelectRef.current()
  }, [cursorJump])

  const errorCount = parseResult.errors.filter((e) => e.severity === 'error').length

  // 行号 + 错误行信息
  const lineCount = useMemo(() => code.split('\n').length, [code])
  const errByLine = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const e of parseResult.errors) {
      if (e.line <= 0) continue
      const arr = map.get(e.line) ?? []
      arr.push(`${e.severity === 'error' ? '错误' : '警告'}[第${e.line}行 第${e.col}列] ${e.message}`)
      map.set(e.line, arr)
    }
    return map
  }, [parseResult])

  // 滚动同步（高亮层 + 行号栏）
  const onScroll = () => {
    if (hlRef.current && taRef.current && gutterRef.current) {
      hlRef.current.scrollTop = taRef.current.scrollTop
      hlRef.current.scrollLeft = taRef.current.scrollLeft
      gutterRef.current.scrollTop = taRef.current.scrollTop
    }
  }

  // 光标写入 store + 谱面联动（M3）
  const onSelect = () => {
    const ta = taRef.current
    if (!ta) return
    const { line, col } = lineColOf(ta.value, ta.selectionStart)
    setCursor(line, col)
    const id = codePosToNoteId(ta.value, ta.selectionStart)
    setActiveNoteId(id)
  }
  onSelectRef.current = onSelect

  // 行首命令快捷键：光标在行首时按 Q/C/B/Z/D/P/J/V/H 插入命令头
  // 限制：歌词行（C 行）只允许插入 C；曲行（Q 行）只允许 Q/C；IME 合成事件排除
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = taRef.current
    if (!ta) return
    if (e.nativeEvent.isComposing) return // 输入法合成中不触发
    const key = e.key
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
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
    setCode(next)
    if (autoFormat) {
      // 防抖格式化，尽量保持光标位置（公共前缀匹配）
      if (formatTimer.current) window.clearTimeout(formatTimer.current)
      const startPos = ta.selectionStart
      formatTimer.current = window.setTimeout(() => {
        const current = taRef.current?.value ?? next
        const formatted = formatJps(current)
        if (formatted !== current && taRef.current) {
          const common = commonPrefixLen(current, formatted)
          const target = Math.max(0, Math.min(startPos, common))
          setCode(formatted)
          requestAnimationFrame(() => {
            if (taRef.current) {
              taRef.current.selectionStart = taRef.current.selectionEnd = target
              onScroll()
              onSelect()
            }
          })
        }
      }, 900)
    }
  }

  useEffect(() => {
    return () => {
      if (formatTimer.current) window.clearTimeout(formatTimer.current)
    }
  }, [])

  const html = highlightCode(code, new Set(errByLine.keys()))
  const gutterLines = Array.from({ length: lineCount }, (_, i) => i + 1)

  return (
    <div className="editor-pane">
      <div className="editor-head">
        <span className="file-tag">.jps</span>
        <span>脚本编辑器</span>
        <span className={errorCount > 0 ? 'err-count has-error' : 'err-count'}>
          {errorCount > 0 ? `${errorCount} 个语法错误` : '语法正确'}
        </span>
      </div>
      <div className="editor-body">
        <div className="editor-gutter" ref={gutterRef} aria-hidden="true">
          {gutterLines.map((n) => {
            const errs = errByLine.get(n)
            return (
              <div
                key={n}
                className={errs ? 'gutter-line gutter-err' : 'gutter-line'}
                title={errs?.join('\n')}
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
        </div>
      </div>
    </div>
  )
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0
  const n = Math.min(a.length, b.length)
  while (i < n && a[i] === b[i]) i++
  return i
}
