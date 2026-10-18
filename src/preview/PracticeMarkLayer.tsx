/**
 * preview/PracticeMarkLayer.tsx — 试听「标记段」在谱面上的**标记线**（adj987h，用户 2026-10-18 需求）
 *
 * ## 用户口径
 *
 * · 「点击音符，点击起始按钮，在标记的音符**下**添加起始音符标记」；停止同理；
 * · 「起止音符都标记后，这段音符下显示一个不同底色/底线的标记块/线，颜色与当前焦点音符（红）
 *    和试听色块颜色区分开」；
 * · 后续追加：「**建议用线，不抢眼**」⇒ 本层只画**一条细线**（每行一段）+ 两端小竖头，
 *    不铺底色块（底色会抢播放色块的视觉）；
 * · 「点击开启循环开关按钮后标记块/线**两端显示循环标识**」⇒ 两端各画一个 ⟲；
 * · **允许跨行**：「每行一段」由 `markBandsOf` 按行切好。
 *
 * ## 为什么单独一个层（而不是画进 SVG）
 *
 * 与 `PlayheadLayer` 同理由：SVG 是 `dangerouslySetInnerHTML` 注进去的静态串，逐帧/随状态重画要重建整页；
 * 覆盖层用绝对定位 div，**只重画自己**，且不参与点击（`pointerEvents: none`）不抢音符的点击。
 */
import { markBandsOf } from '../store/practiceMarks'
import { useUiStore } from '../store/uiStore'

export function PracticeMarkLayer({ page, noteSize }: { page: ScorePageLike; noteSize: number }) {
  const marks = useUiStore((s) => s.practiceMarks)
  const markId = useUiStore((s) => s.practiceMarkId)
  const loop = useUiStore((s) => s.practiceLoop)
  const selStart = useUiStore((s) => s.practiceSelStart)
  const selStop = useUiStore((s) => s.practiceSelStop)
  /** adj987k：这一段**实际演奏到的音符 id**（跨反复/跳跃时按播放顺序给） */
  const rangeIds = useUiStore((s) => s.practiceRangeIds)
  /** adj987o：开始 / 循环重来前的倒数（3/2/1；null = 不显示） */
  const countdown = useUiStore((s) => s.practiceCountdown)
  /** adj987l（用户口径 #4）：标记段线**只在试听面板打开时**显示（底栏的「试听」页签） */
  const showInDialog = useUiStore((s) => s.dockOpen && s.dockPanel === 'tryout')
  const cur = marks.find((m) => m.id === markId) ?? null
  /** 画哪一段：优先"已选中的标记"，其次"正在标的两端"；只有一个端点时只画那个小竖头 */
  const startId = cur?.startId ?? selStart ?? null
  const endId = cur?.endId ?? selStop ?? null
  if (!showInDialog) return null
  if (!startId && !endId) return null
  /**
   * 画法优先级：
   *  ① 有"实际演奏到的音符 id"（选中了标记时由按钮组算好）⇒ **按它画**——
   *     跨 `:|` 回跳、跳房子时线跟着演奏顺序走（用户口径 #5：起在止之后也能画对）；
   *  ② 否则退回"起止之间按序号取区间"（用于还没添加、只在标两端的时候）。
   */
  const bands =
    rangeIds.length > 0
      ? bandsFromIds(page, rangeIds)
      : startId && endId
        ? markBandsOf(
            // `rightX` 在类型上是可选的（跨行/段层音符可能没有）⇒ 兜底成 `x + 1`，只影响线的右端点
            page.notes.map((n) => ({ id: n.id, x: n.x, y: n.y, rightX: n.rightX ?? n.x + 1 })),
            startId,
            endId,
          )
        : []
  const pct = (v: number) => `${((v / page.width) * 100).toFixed(3)}%`
  const pctY = (v: number) => `${((v / page.height) * 100).toFixed(3)}%`
  /** 线画在音符**下方**（数字基线 + 1.15 倍字号 ≈ 减时线之下、歌词之上） */
  const lineY = (baseline: number) => baseline + noteSize * 1.15
  const lineH = Math.max(1.5, noteSize * 0.12)
  const tickH = noteSize * 0.55
  const first = bands[0]
  const last = bands[bands.length - 1]
  return (
    <>
      {bands.map((b, i) => (
        <div
          key={`pm-line-${i}`}
          className="practice-mark-line"
          style={{
            left: pct(b.x0),
            top: pctY(lineY(b.y)),
            width: pct(Math.max(1, b.x1 - b.x0)),
            height: `${lineH}px`,
          }}
        />
      ))}
      {/* 两端的"起 / 止"小竖头（只画真正的两端，不画行间断点） */}
      {first && (
        <div
          className="practice-mark-tick practice-mark-tick-start"
          style={{ left: pct(first.x0), top: pctY(lineY(first.y) - tickH / 2), height: `${tickH}px` }}
        />
      )}
      {last && (
        <div
          className="practice-mark-tick practice-mark-tick-stop"
          style={{ left: pct(last.x1), top: pctY(lineY(last.y) - tickH / 2), height: `${tickH}px` }}
        />
      )}
      {/* adj987o（用户口径）：开始 / 循环重来前的 **3-2-1 倒数**，画在**起始音**正上方 */}
      {countdown !== null && first && (
        <span
          className="practice-countdown"
          style={{ left: pct(first.x0), top: pctY(lineY(first.y) - tickH - noteSize * 1.6) }}
        >
          {countdown}
        </span>
      )}      {/* 循环开启 ⇒ 两端各一个 ⟲（用户口径：开启后两端显示循环标识） */}
      {loop && first && (
        <span className="practice-mark-loop" style={{ left: pct(first.x0), top: pctY(lineY(first.y) + tickH / 2 + 2) }}>
          ⟲
        </span>
      )}
      {loop && last && (
        <span className="practice-mark-loop" style={{ left: pct(last.x1), top: pctY(lineY(last.y) + tickH / 2 + 2) }}>
          ⟲
        </span>
      )}
      {/* 只标了单端（还没按另一个）时，也给它一个竖头，让用户看到"这个音记下了" */}
      {!endId && startId && bands.length === 0 && <SingleTick page={page} id={startId} noteSize={noteSize} kind="start" />}
      {!startId && endId && bands.length === 0 && <SingleTick page={page} id={endId} noteSize={noteSize} kind="stop" />}
    </>
  )
}

/** 单端竖头（起止只标了一个时用；位置从该页音符里查） */
function SingleTick({
  page,
  id,
  noteSize,
  kind,
}: {
  page: ScorePageLike
  id: string
  noteSize: number
  kind: 'start' | 'stop'
}) {
  const m = /^(\d+)_(\d+)_(\d+)_(\d+)$/.exec(id)
  const idx = m ? Number(m[4]) : -1
  const n = page.notes.find((x) => x.id.index === idx)
  if (!n) return null
  const pct = (v: number) => `${((v / page.width) * 100).toFixed(3)}%`
  const pctY = (v: number) => `${((v / page.height) * 100).toFixed(3)}%`
  const y = n.y + noteSize * 1.15
  const h = noteSize * 0.55
  return (
    <div
      className={`practice-mark-tick practice-mark-tick-${kind}`}
      style={{ left: pct(kind === 'start' ? n.x : (n.rightX ?? n.x + 1)), top: pctY(y - h / 2), height: `${h}px` }}
    />
  )
}

/** 本层用到的页面形状（只取需要的字段，避免把 engine 的整套类型拖进来） */
export interface ScorePageLike {
  width: number
  height: number
  notes: readonly { id: { index: number; page?: number; voice?: number; group?: number }; x: number; y: number; rightX?: number }[]
}

/**
 * adj987k：按"**实际演奏到的音符 id 列表**"算出这一页上的线（按行切段）。
 *
 * 为什么不用"起止序号区间"：跨 `:|` 回跳/跳房子时，演奏顺序与源码顺序不一致
 * （用户口径 #5：「起始在停止后」也允许），按 id 列表画才能**跟着演奏走**。
 */
function bandsFromIds(page: ScorePageLike, ids: readonly string[]): { row: number; x0: number; x1: number; y: number }[] {
  const exact = new Set(ids)
  /** 宽松匹配的"组号+序号"尾巴（与引擎 `resolvePracticeRange` 同一口径：页号/声部号可能不一致） */
  const tails = new Set(
    ids.map((id) => {
      const m = /^(\d+)_(\d+)_(\d+)_(\d+)$/.exec(id)
      return m ? `_${m[3]}_${m[4]}` : id
    }),
  )
  const picked = page.notes.filter(
    (n) => exact.has(noteIdOf(n)) || tails.has(`_${(n.id as { group?: number }).group ?? 0}_${n.id.index}`),
  )
  if (picked.length === 0) return []
  const byRow = new Map<number, { x0: number; x1: number; y: number }>()
  for (const n of picked) {
    const y = n.y
    const cur = byRow.get(y)
    const right = n.rightX ?? n.x + 1
    if (!cur) byRow.set(y, { x0: n.x, x1: right, y })
    else {
      cur.x0 = Math.min(cur.x0, n.x)
      cur.x1 = Math.max(cur.x1, right)
    }
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([y, b], i) => ({ row: i, x0: b.x0, x1: b.x1, y }))
}

/** 音符 id 串（与引擎 `noteIdStringOf` 同形；这里只在本页里比对用） */
function noteIdOf(n: { id: { page?: number; voice?: number; group?: number; index: number } }): string {
  return `${n.id.page ?? 0}_${n.id.voice ?? 0}_${n.id.group ?? 0}_${n.id.index}`
}
