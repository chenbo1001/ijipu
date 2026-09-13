/**
 * ui/problems.ts — 编辑区「问题提示」的纯逻辑（adj394）
 *
 * 背景：解析出的错误/告警此前只在**行号栏着色**（`gutter-err`/`gutter-warn`）与悬停 tooltip 里体现，
 * 编辑区内没有可读的文字提示——用户写了不符合语法的内容（如渐强/渐弱缺 `!`、引号未闭合）时
 * 只看到"谱面没变化"，不知道哪里不对。本模块把 ParseError 汇总成可直接渲染的行，
 * 并提供「行列 → 源码偏移」的跳转换算（组件只做渲染与事件）。
 *
 * 纯函数、零 React/DOM 依赖，断言在 scripts/smoke.mts。
 */
import type { ParseError } from '@ijipu/engine/types.ts'

/** 单条问题的展示行 */
export interface ProblemRow {
  severity: 'error' | 'warning'
  /** 中文分级标签（错误/警告） */
  label: string
  line: number
  /** 列（1-based，供展示；源码内为 0-based） */
  col: number
  message: string
  /** adj394：正确语法规则（引擎给出，含最小示例）——端侧在消息下方以「正确写法」呈现 */
  hint?: string
  /** 展示用全文，如「错误[第3行 第5列] 引号注释未闭合」 */
  text: string
}

/** 问题汇总（供提示条与状态栏共用） */
export interface ProblemSummary {
  errorCount: number
  warnCount: number
  total: number
  /** 按（行、列）排序后的展示行 */
  rows: ProblemRow[]
  /** 最严重级别：有 error 则 error，否则（有 warning）warning，否则 null */
  worst: 'error' | 'warning' | null
}

/** 问题分级的中文标签 + 排序权重（error 在前） */
const SEVERITY_LABEL: Record<ParseError['severity'], string> = { error: '错误', warning: '警告' }
const SEVERITY_ORDER: Record<ParseError['severity'], number> = { error: 0, warning: 1 }

/**
 * 汇总解析问题：**错误在前、同类按行列出**，并给出各级数量与最严重级别。
 * `max` 可限制行数（提示条默认只列前几条，其余用「还有 N 条」概括）。
 */
export function summarizeProblems(errors: readonly ParseError[], max?: number): ProblemSummary {
  const sorted = [...errors].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line || a.col - b.col,
  )
  const errorCount = sorted.filter((e) => e.severity === 'error').length
  const warnCount = sorted.length - errorCount
  const rows: ProblemRow[] = sorted.map((e) => ({
    severity: e.severity,
    label: SEVERITY_LABEL[e.severity],
    line: e.line,
    col: e.col + 1,
    message: e.message,
    hint: e.hint,
    text: `${SEVERITY_LABEL[e.severity]}[第${e.line}行 第${e.col + 1}列] ${e.message}`,
  }))
  const shown = typeof max === 'number' && max >= 0 ? rows.slice(0, max) : rows
  return {
    errorCount,
    warnCount,
    total: rows.length,
    rows: shown,
    worst: errorCount > 0 ? 'error' : warnCount > 0 ? 'warning' : null,
  }
}

/**
 * 「行/列」→ 源码字符偏移（供 `jumpCursor` 定位；行/列越界自动钳制）。
 * 行、列均按 1-based 传入（列的 1 表示行首）。
 */
export function offsetOf(code: string, line: number, col: number): number {
  const lines = code.split('\n')
  const li = Math.min(Math.max(1, line), lines.length) - 1
  let offset = 0
  for (let i = 0; i < li; i++) offset += lines[i].length + 1
  const ci = Math.min(Math.max(0, col - 1), lines[li].length)
  return offset + ci
}
