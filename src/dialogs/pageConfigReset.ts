/**
 * pageConfigReset.ts — 设置面板「恢复默认」的草稿语义（纯函数，供 smoke 断言）
 *
 * adj629x（用户复报「点击恢复默认时，还是没有清空 `# jps-config`」）：
 * 应用侧「恢复默认」此前写成 `updateDraft(defaultConfigForReset())`，而 `updateDraft` 是
 * **浅合并** `{ ...draft, ...patch }`。`defaultConfigForReset()` 的定义是"默认值 + **移除可选字段**"
 * ——把一份**根本不含 `metaPos`** 的对象浅合并进草稿，旧草稿里的 `metaPos`（以及 `heights` /
 * `segmentRowGap` / `lyricShrink` / `showInstrument`）会**原样留下**，
 * 于是保存时差量写入又把它写回 `# jps-config`：用户看到的就是"点了恢复默认，设置行还有值"。
 *
 * adj629s 只修了"传给引擎的那份对象"（`defaultConfigForReset`），没修这里的**合并方式**；
 * 引擎层的断言（`writeJpsConfig(code, defaultConfigForReset())`）因此全绿，而真机路径仍坏。
 * 恢复默认的语义是**整份替换**，与上一份草稿无关 ⇒ 必须用本函数，不能走 `updateDraft`。
 */
import { defaultConfigForReset } from '@ijipu/engine'
import type { PageConfig } from '@ijipu/engine'

/**
 * 恢复默认后的草稿值：**整份替换**（不是 `{ ...prev, ...reset }` 浅合并）。
 *
 * @param prev 恢复前的草稿——**刻意不读**：任何来自上一份草稿的可选字段都必须消失，
 *             这正是"浅合并会漏掉可选字段"的根因；保留入参是为了让调用点与断言都表意清楚。
 */
export function draftAfterReset(prev: PageConfig): PageConfig {
  void prev
  return { ...defaultConfigForReset() }
}
