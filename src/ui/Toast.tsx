/**
 * ui/Toast.tsx — 轻量浮动提示（右下角）
 *
 * 消费 uiStore.notice（保存成功/失败等），按 notice.nonce 重置自动隐藏计时：
 *  - ok（绿）：约 1.8s 隐藏；warn/error（黄/红）约 4s 隐藏，便于阅读。
 * 无提示时不渲染任何元素。
 */
import { useEffect } from 'react'
import { useUiStore } from '../store/uiStore'

export function Toast() {
  const notice = useUiStore((s) => s.notice)
  const clearNotice = useUiStore((s) => s.clearNotice)

  // notice 变化（每次 showNotice 都新建对象）时重置隐藏计时；unmount/清空时清理
  useEffect(() => {
    if (!notice) return
    const ms = notice.kind === 'ok' ? 1800 : 4000
    const t = setTimeout(clearNotice, ms)
    return () => clearTimeout(t)
  }, [notice, clearNotice])

  if (!notice) return null
  return <div className={`toast toast-${notice.kind}`}>{notice.text}</div>
}
