/**
 * landing/playground.ts — 首页「看看它长什么样」区块（adj877 建、adj882 改）
 *
 * ## 为什么从"自己改一段"改成"切示例"
 *
 * 用户口径：首页放一个能编辑的输入框**没有意义** —— 真想改代码，直接进应用不更直接？
 * 首页要的是**直观感受**：给几个例子，切「脚本 / 预览」看这段代码长什么样。
 * 所以这里不再有 textarea，只有一排示例按钮 + 一个 ` ```jps ` 块。
 *
 * ## 渲染交给共用模块
 *
 * 「脚本 / 预览」的结构、引擎按需加载、`m=` / `z=` 裁切缩放，全部在 `help/jpsPreview.ts` 里
 * —— 与**文档页里的每个 ` ```jps ` 块**是同一份实现（用户要求文档页的示例也变成这种可切换的块）。
 * 这个文件只负责"切示例"这一件事。
 */
import { BRAND_SAMPLES } from './samples'
import { mountJpsBlocks, previewJpsBlock } from '../help/jpsPreview'

export function mountPlayground(): void {
  const root = document.getElementById('playground')
  const block = document.getElementById('pg-block')
  const codeEl = block?.querySelector<HTMLElement>('.jps-block-code code')
  if (!root || !block || !codeEl) return

  // 挂上「脚本 / 预览」（与文档页同一套挂载逻辑）
  mountJpsBlocks(root)

  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-pg-sample]')]

  /**
   * 换示例。
   * `jumpToPreview`：点了示例按钮就直接给看效果（用户点示例的意图就是"想看这段长什么样"）；
   * 首屏初始化时传 `false`——那时还停在「脚本」标签，不该为它去加载引擎。
   * ⚠ 用 `textContent` 写源码（不是 innerHTML）：源码里的 `<`、`&` 会自动转义，不怕注入。
   */
  const select = (idx: number, jumpToPreview: boolean): void => {
    const sample = BRAND_SAMPLES[idx]
    if (!sample) return
    codeEl.textContent = sample.src
    if (jumpToPreview) previewJpsBlock(block)
  }

  for (const b of buttons) {
    b.addEventListener('click', () => {
      buttons.forEach((x) => {
        const on = x === b
        x.classList.toggle('active', on)
        x.setAttribute('aria-selected', on ? 'true' : 'false')
      })
      select(Number(b.dataset.pgSample), true)
    })
  }

  // 首屏：第一个示例 + 停在「脚本」（预览要按需下引擎，不该在首屏发生）
  select(0, false)
}
