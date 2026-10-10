/**
 * ui/problems.ts — 编辑区「问题提示」的**转发层**（实现已下沉引擎）
 *
 * adj759（用户要求：「错误信息显示提示等共性的功能都可以独立到引擎层面」，且"应用端也应同样处理"）：
 * 分级/排序/计数/展示行/行列→偏移 全部搬到引擎 `engine/diagnostics/problems.ts`
 * —— Obsidian 插件用同一份（此前两端措辞还不同：应用 `错误[第3行 第5列] …`、插件 `第3行 第5列 …`）。
 *
 * 本文件只负责**把应用的品牌文案（`brand/copy.ts` 的 `problemCopy`）传进去**，
 * 其余导出保持原样 ⇒ 组件调用点一行都不用改。
 */
import { problemCopy } from '../brand/copy'
import {
  DEFAULT_PROBLEM_LABELS,
  summarizeProblems as summarize,
  offsetOf,
  type ProblemLabels,
  type ProblemRow,
  type ProblemSummary,
} from '@ijipu/engine'

export type { ProblemRow, ProblemSummary }

/** 应用自己的分级标签（与 `problemCopy` 同源，避免两处措辞分叉） */
export const APP_PROBLEM_LABELS: ProblemLabels = {
  error: problemCopy.error,
  warning: problemCopy.warning,
  correctPrefix: problemCopy.correctPrefix,
}

/**
 * 汇总解析问题（错误在前、同类按行列出，附各级数量与最严重级别）。
 * `max` 可限制返回行数；统计数字始终是**全部**问题的。
 */
export function summarizeProblems(errors: Parameters<typeof summarize>[0], max?: number): ProblemSummary {
  return summarize(errors, { max, labels: APP_PROBLEM_LABELS })
}

export { offsetOf, DEFAULT_PROBLEM_LABELS }
