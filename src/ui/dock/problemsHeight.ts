/**
 * ui/dock/problemsHeight.ts — 告警面板高度算式的**单一来源 + 纯函数**（adj528）
 *
 * ## 为什么要单独一个模块
 * 告警面板的高度被三处用到：**AUTO_FIT 实测**（打开/切档时的"内容自然高"）、
 * **内容 cap**（建议档最多显示 4 行）、**defaultH 兜底**。它们必须用同一组常量，
 * 而"内容自然高"的算法又必须在 smoke 里可断言（纯算术，不依赖真实 DOM）——
 * 所以常量与算式一起收在这里，`ToolDock.tsx` 只做"读 DOM 数值 → 调用本模块"的薄接线。
 *
 * ## 为什么不再用 `pane.scrollHeight` / `list.scrollHeight` 量"总量"
 * 告警那条 pane 是**填满 dock 的弹性列**（`.pane-problems`——列表要拿到受限高度才能滚，
 * 见 `E-2026-225`）。于是**凡是"内容不足以撑满可用高度"的读数都会被充气**：
 * `scrollHeight` 在内容比可用高度小时等于 clientHeight（= 可用高度），
 * 于是"dock 高的时候量出来的内容自然高"会虚高 ⇒ **从"最大"切"建议"得到的建议高度
 * 比从"最小"切过来大**，同一个档位因来路不同而不同（用户连报两次：`E-2026-226` 修了
 * 试听/导出/关于三块，本条修告警这块——它当时的 head+list 分支只覆盖了"有告警且已展开"。
 * 0 条告警（`.dock-empty` 占位）与"面板被收起"两种情况仍会掉回 `pane.scrollHeight`）。
 *
 * 现在的算法**只读"内容尺寸"的局部量**，与 dock 当前多高**完全无关**：
 *   · 行数 ← **数据**（`summarizeProblems().total`，即渲染出的行数），不来自布局；
 *   · 单行高 ← 实测 `.problem-line`（它是 `.problems-list` 里的**行盒子**，内容尺寸；
 *     **不含**展开的「正确写法」——那部分是 `.problem-line` 的兄弟节点）；
 *   · 面板头高 / 占位块高 ← 实测对应元素（都是内容尺寸的弹性项 `flex: 0 1 auto` / `0 0 auto`）。
 */

/** 内容区 `.tool-dock-pane` 的上下内边距（8 + 10） */
export const PANE_PAD_H = 18
/** 告警单行高度兜底（实测约 22px：行内边距 + 12px 文字/18px 图标） */
export const ROW_H = 22
/** 告警"面板头"高度兜底（`problems-head`：标题/折叠/语法速查那一行 ≈ 28px） */
export const PROBLEMS_HEAD_H = 28
/**
 * 建议档最多显示几行告警（超出由列表自身滚动）。
 * adj510：2 行 → adj524：4 行（用户要求，依据是底栏有了高度档位按钮，"默认多给"不再挤占编辑区）。
 */
export const PROBLEMS_MAX_VISIBLE_ROWS = 4

/**
 * 告警"内容自然高"的 **cap**：超过「面板头 + `PROBLEMS_MAX_VISIBLE_ROWS` 行」就记为上限，
 * 超出部分由 `.problems-list` 的 `overflow-y: auto` 在面板内滚动查看。
 * （对下面 `problemsContentHeight` 的结果是**幂等**的，保留它是为了兜住"实测值异常偏大"的输入。）
 */
export function capProblemsContentHeight(h: number): number {
  if (h <= 0) return h
  return Math.min(h, PANE_PAD_H + PROBLEMS_HEAD_H + ROW_H * PROBLEMS_MAX_VISIBLE_ROWS)
}

/**
 * 告警面板的"内容自然高"（含 pane 上下内边距）——**纯算术**，输入全是"与 dock 高度无关"的量。
 *
 * @param problemCount 告警条数（= 渲染出的行数）
 * @param headH 面板头高度（面板未渲染时为 0）
 * @param rowH 单行告警高度（`.problem-line` 的实测高；不含展开的「正确写法」）
 * @param emptyH 无告警占位块 `.dock-empty` 的高度（无该元素时传 0）
 * @param collapsed 面板处于"收起"状态（只剩面板头、没有列表）
 */
export function problemsContentHeight(o: {
  problemCount: number
  headH: number
  rowH: number
  emptyH: number
  collapsed: boolean
}): number {
  const rowH = o.rowH > 0 ? o.rowH : ROW_H
  // 无告警（或懒加载占位）：面板只有一个占位块，没有面板头
  if (o.problemCount <= 0) return PANE_PAD_H + (o.emptyH > 0 ? o.emptyH : rowH)
  // 面板被收起 / 头部还没量到：只有面板头
  if (o.collapsed || o.headH <= 0) return PANE_PAD_H + (o.headH > 0 ? o.headH : PROBLEMS_HEAD_H)
  const rows = Math.min(o.problemCount, PROBLEMS_MAX_VISIBLE_ROWS)
  return PANE_PAD_H + o.headH + rowH * rows
}
