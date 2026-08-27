/**
 * ui/EditorFootBar.tsx — 底部状态栏（精简版）
 *
 * adj281 之后：原本的「设置组」（折行 / 字体 / 字号）已移到顶栏工具条的「设置组」中，
 * 状态栏只保留「文件名 / 当前行列（行, 列/总行数）」与未保存标记。
 */
import { useMemo } from 'react'
import { useDocStore } from '../store/docStore'

export function EditorFootBar() {
  const code = useDocStore((s) => s.code)
  const fileName = useDocStore((s) => s.fileName)
  const dirty = useDocStore((s) => s.dirty)
  const cursor = useDocStore((s) => s.cursor)

  const totalLines = useMemo(() => code.split('\n').length, [code])

  return (
    <div className="footer">
      <span className="footer-file">
        {(fileName || '未命名') + '.jps'}
        {dirty && <span className="dirty-dot" title="有未保存的修改" />}
      </span>

      <span className="footer-cursor">
        行{cursor.line},列{cursor.col + 1}/共{totalLines}行
      </span>

      <div className="footer-spacer" />
    </div>
  )
}