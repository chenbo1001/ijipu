/**
 * editor/history.ts — 撤销/重做历史（纯函数，无 React 依赖，可单测）
 *
 * 模型：每步保存一个「编辑前快照」{ code, selStart, selEnd }。
 *  - undoStack：已发生的编辑（栈顶 = 最近一步，undo 时弹出并恢复）；
 *  - redoStack：被撤销的编辑（redo 时弹回）；
 *  - 合并策略：HISTORY_MERGE_MS（1.2s）内的连续输入合并为一步，
 *    避免 50 步被逐字符输入耗尽——一次连续输入 = 一步，符合普通编辑器直觉；
 *  - 新编辑会清空 redoStack（标准行为）；
 *  - 撤销/重做后 lastEditAt 重置，下一次输入必定新开一步。
 */

export interface HistoryEntry {
  /** 编辑前的完整文本 */
  code: string
  /** 编辑前选区起点（0-based） */
  selStart: number
  /** 编辑前选区终点（0-based） */
  selEnd: number
}

export interface HistoryState {
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  /** 最近一次编辑的时间戳（合并窗口判定用） */
  lastEditAt: number
}

/** 默认历史步数上限（50 步） */
export const DEFAULT_HISTORY_LIMIT = 50
/** 连续输入合并窗口（毫秒）：窗口内的多次编辑合并为一步 */
export const HISTORY_MERGE_MS = 1200

export function createHistoryState(): HistoryState {
  return { undoStack: [], redoStack: [], lastEditAt: 0 }
}

export interface RecordResult {
  /** 记录后的历史状态 */
  next: HistoryState
  /** true = 本次编辑已并入上一步（未新增条目） */
  merged: boolean
}

/**
 * 记录一次编辑：current 为「编辑前状态」。
 * 距上一步在合并窗口内 → 合并（不新增条目）；
 * 否则压入 undoStack（超限丢弃最旧），并清空 redoStack。
 */
export function recordEdit(
  history: HistoryState,
  current: HistoryEntry,
  now: number,
  limit: number = DEFAULT_HISTORY_LIMIT,
): RecordResult {
  if (history.undoStack.length > 0 && now - history.lastEditAt <= HISTORY_MERGE_MS) {
    return { next: { ...history, lastEditAt: now }, merged: true }
  }
  const undoStack = [...history.undoStack, current]
  if (undoStack.length > limit) undoStack.splice(0, undoStack.length - limit)
  return { next: { undoStack, redoStack: [], lastEditAt: now }, merged: false }
}

export interface RestoreResult {
  next: HistoryState
  /** 恢复的目标快照；无可恢复时返回 null */
  restored: HistoryEntry | null
}

/** 撤销：弹出 undoStack 栈顶恢复；当前状态压入 redoStack。 */
export function undoHistory(history: HistoryState, current: HistoryEntry): RestoreResult {
  const top = history.undoStack[history.undoStack.length - 1]
  if (top === undefined) return { next: history, restored: null }
  return {
    next: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, current],
      // 重置合并时间戳：撤销后的下一次输入必须新开一步
      lastEditAt: 0,
    },
    restored: top,
  }
}

/** 重做：弹出 redoStack 栈顶恢复；当前状态压回 undoStack。 */
export function redoHistory(history: HistoryState, current: HistoryEntry): RestoreResult {
  const top = history.redoStack[history.redoStack.length - 1]
  if (top === undefined) return { next: history, restored: null }
  return {
    next: {
      undoStack: [...history.undoStack, current],
      redoStack: history.redoStack.slice(0, -1),
      lastEditAt: 0,
    },
    restored: top,
  }
}
