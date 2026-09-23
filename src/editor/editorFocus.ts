/**
 * editor/editorFocus.ts — 把焦点交回**编辑区文本域**（adj609）
 *
 * 用户口径（原话）："ESC 最小化底栏 dock 后，焦点归入编辑区，通常最小化 dock 就是 dock 碍事
 * 不方便编辑才会最小化。"
 *
 * 为什么要单独一个模块：编辑区的 `<textarea>` 没有 id/class（它在 `.editor-main` 里，是
 * `EditorPane` 的私有 ref），而"请求把焦点还给编辑区"这件事会有多个调用方（底栏的 ESC 最小化
 * 是第一个）。把**选择器留在编辑层**——将来改 DOM 结构只需要动这一个文件，调用方不必知道
 * 编辑区的 DOM 长什么样（与 `engine/layout/guides.ts` 那种"几何只在一处算"同一个思路）。
 *
 * 特性：**只挪焦点，不动光标、不滚动**——浏览器会记住 textarea 上次失焦时的选区，
 * 聚焦后光标回到原处，用户可以接着打字（这与"跳转到指定位置"的 `docStore.cursorJump`
 * 是两件事，别混用：那条会重新设置选区并把光标居中滚动）。
 */

/** 编辑区文本域的选择器（唯一一处；`EditorPane` 里 `.editor-main > textarea`） */
const EDITOR_TEXTAREA_SELECTOR = '.editor-main textarea'

/**
 * 把焦点交给编辑区文本域。
 * @returns 是否真的交出去了——**预览视图**（编辑区不在 DOM 里）等情况返回 `false`，
 *          由调用方决定兜底（例如只把焦点从"已被收起来的内容区"里挪开）。
 */
export function focusEditorTextarea(): boolean {
  const ta = document.querySelector<HTMLTextAreaElement>(EDITOR_TEXTAREA_SELECTOR)
  if (!ta) return false
  ta.focus()
  return document.activeElement === ta
}
