/**
 * editor/EditorPane.tsx — 代码编辑器（textarea + 语法高亮层 + 自动格式化）
 */
import { useEffect, useRef } from 'react'
import { useDocStore } from '../store/docStore'
import { highlightCode } from './highlight'
import { formatJps } from '../engine'

export function EditorPane() {
  const code = useDocStore((s) => s.code)
  const setCode = useDocStore((s) => s.setCode)
  const setCursor = useDocStore((s) => s.setCursor)
  const autoFormat = useDocStore((s) => s.autoFormat)
  const parseResult = useDocStore((s) => s.parseResult)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const formatTimer = useRef<number | null>(null)

  const errorCount = parseResult.errors.filter((e) => e.severity === 'error').length

  // 滚动同步
  const onScroll = () => {
    if (hlRef.current && taRef.current) {
      hlRef.current.scrollTop = taRef.current.scrollTop
      hlRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }

  // 光标写入 store（供状态栏/预览联动）
  const onSelect = () => {
    const ta = taRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const text = ta.value
    let line = 1
    let col = 0
    for (let i = 0; i < pos; i++) {
      if (text[i] === '\n') {
        line++
        col = 0
      } else {
        col++
      }
    }
    setCursor(line, col)
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
          // 公共前缀长度 ≈ 光标位置映射
          const common = commonPrefixLen(current, formatted)
          const target = Math.max(0, Math.min(startPos, common))
          setCode(formatted)
          requestAnimationFrame(() => {
            if (taRef.current) {
              taRef.current.selectionStart = taRef.current.selectionEnd = target
              onScroll()
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

  const html = highlightCode(code)

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
        <textarea
          ref={taRef}
          value={code}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={onChange}
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
  )
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0
  const n = Math.min(a.length, b.length)
  while (i < n && a[i] === b[i]) i++
  return i
}
