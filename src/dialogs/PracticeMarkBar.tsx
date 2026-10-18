/**
 * dialogs/PracticeMarkBar.tsx — 试听对话框里的「练习段」按钮组（adj987，用户 2026-10-18 需求）
 *
 * ## 用户口径（逐条）
 *
 * 「添加个按钮组，分别是选择标记段下拉列表，起始、停止、添加、删除、循环图标按钮，分别用于
 *   选择标记段、标记起始音符、标记停止音符、添加标记段到标记段列表、删除当前列表项、循环播放开关按钮」
 * 「标记段针对做标记的 jps 文件/jps 代码块有效，缓存级保存」
 * 「选择标记段下拉列表默认（第一个）为无，默认为演奏全曲，不可删除，其它用户标记段可删除」
 * 「可以对这个标记段组的左上角再加一个收起/显示整个段组的小按钮」（追加）
 *
 * ## 交互
 *
 * ① 在预览里点一个音符（`docStore.activeNoteId` 变成它）→ 按「起始」/「停止」登记端点；
 * ② 两端都登记后按「添加」⇒ 生成 `段 N` 并自动选中；
 * ③ 「循环」是开关，「收起」只折起本组（不改变任何标记）。
 *
 * ## 遍次（用户追问的歧义）
 *
 * 起止都在公共段、中间被跳跃分开时，同一对 id 在展开序列里会有**多个候选**；
 * 这里在「候选 > 1」时才显示第二个下拉（第 1 遍 / 第 2 遍 …，含跳越的标 `(含跳越)`），
 * 选过之后写回标记的 `pass`（持久化）。
 */
import { useEffect, useMemo } from 'react'
import { buildPlaySequence, extendRangeEndToSlurEnd, layoutScore, noteIdStringOf, resolvePracticeRange, slicePlaySequenceByRange } from '@ijipu/engine'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { docKeyOf, loadMarks, saveMarks } from '../store/practiceMarks'
import { playbackCopy } from '../brand/copy'

/** 音符 id → `g组#序号`（读数里显示用；解析不出来给 `?`） */
function noteLabelOf(id: string): string {
  const m = /^(\d+)_(\d+)_(\d+)_(\d+)$/.exec(id)
  return m ? `g${m[3]}#${m[4]}` : '?'
}

export function PracticeMarkBar(): React.JSX.Element {
  const marks = useUiStore((s) => s.practiceMarks)
  const markId = useUiStore((s) => s.practiceMarkId)
  const loop = useUiStore((s) => s.practiceLoop)
  const collapsed = useUiStore((s) => s.practiceCollapsed)
  const selStart = useUiStore((s) => s.practiceSelStart)
  const selStop = useUiStore((s) => s.practiceSelStop)
  const setMarks = useUiStore((s) => s.setPracticeMarks)
  const setMarkId = useUiStore((s) => s.setPracticeMarkId)
  const setPass = useUiStore((s) => s.setPracticeMarkPass)
  const setSel = useUiStore((s) => s.setPracticeSel)
  const addMark = useUiStore((s) => s.addPracticeMark)
  const deleteMark = useUiStore((s) => s.deletePracticeMark)
  const setLoop = useUiStore((s) => s.setPracticeLoop)
  const toggleCollapsed = useUiStore((s) => s.togglePracticeCollapsed)
  const showNotice = useUiStore((s) => s.showNotice)

  const activeNoteId = useDocStore((s) => s.activeNoteId)
  const fileName = useDocStore((s) => s.fileName)
  const binding = useDocStore((s) => s.binding)
  const nativePath = useDocStore((s) => s.nativePath)
  const parseResult = useDocStore((s) => s.parseResult)
  const pageConfig = useDocStore((s) => s.pageConfig)

  /** 文档身份（换文档 ⇒ 换一批标记）；对话框打开时从缓存载入 */
  const docKey = useMemo(() => docKeyOf({ fileName, binding, nativePath }), [fileName, binding, nativePath])
  useEffect(() => {
    setMarks(loadMarks(docKey))
  }, [docKey, setMarks])
  /** 标记一变就落盘（缓存级保存；空列表会删键） */
  useEffect(() => {
    saveMarks(docKey, marks)
  }, [docKey, marks])

  const setPracticeRangeIds = useUiStore((s) => s.setPracticeRangeIds)
  const cur = marks.find((m) => m.id === markId)

  /**
   * 候选遍次 + **这一段实际演奏到的音符 id**（adj987k）。
   *
   * 后者给预览层画线用：跨 `:|` 回跳/跳房子时线要**跟着演奏顺序**走
   * （用户口径 #5：「允许起始在停止后，且要跟着演奏顺序画线」）。
   */
  const resolved = useMemo(() => {
    const empty = { candidates: [], ids: [] as string[], rangeMs: 0, lastNote: '' }
    if (!cur) return empty
    const seq = buildPlaySequence(parseResult, layoutScore(parseResult, pageConfig), 90)
    const res = resolvePracticeRange(seq, cur.startId, cur.endId)
    if (res.candidates.length === 0) return empty
    const idx = Math.min(Math.max(cur.pass ?? res.pick, 0), res.candidates.length - 1)
    const c = res.candidates[idx]
    // adj987n：画线也要用"延长到连音线末尾"之后的范围，否则线比实际演奏短一截
    const i1ext = extendRangeEndToSlurEnd(seq, c.i1, parseResult.slurPairs, parseResult)
    const sliced = slicePlaySequenceByRange(seq, c.i0, i1ext)
    const evs = sliced?.events ?? []
    const lastEv = evs.length > 0 ? evs[evs.length - 1] : null
    return {
      candidates: res.candidates,
      ids: evs.map((e) => noteIdStringOf(e.placed.id)),
      rangeMs: sliced?.rangeMs ?? 0,
      /**
       * adj987t（用户实报「少了停止位的那个音」）：**这一段最后一个音**的 `g组#序号`。
       * 与标记的终点（同一格式）一比对，就能看出是不是"少了一个音"。
       */
      lastNote: lastEv ? `g${lastEv.placed.id.group}#${lastEv.placed.id.index}` : '',
    }
  }, [cur, parseResult, pageConfig])
  const candidates = resolved.candidates
  useEffect(() => {
    setPracticeRangeIds(resolved.ids)
  }, [resolved, setPracticeRangeIds])

  /**
   * adj987m：**只读自检**（与 `window.__ijipuPlayhead()` 同一套路）。
   *
   * 用户实报"添加了标记段但不按段播放"时，光看界面分不清是"标记 id 对不上"还是"切片没生效"；
   * 把这份状态挂到 window 上，贴回来就能定位（不参与渲染）。
   */
  useEffect(() => {
    interface Probe {
      markId: string
      startId: string | null
      endId: string | null
      marks: number
      candidates: number
      rangeIds: number
      rangeMs: number
    }
    const fn = (): Probe => ({
      markId,
      startId: cur?.startId ?? null,
      endId: cur?.endId ?? null,
      marks: marks.length,
      candidates: candidates.length,
      rangeIds: resolved.ids.length,
      rangeMs: Math.round(resolved.rangeMs),
    })
    const w = window as unknown as { __ijipuPracticeMark?: () => Probe }
    w.__ijipuPracticeMark = fn
    return () => {
      delete w.__ijipuPracticeMark
    }
  }, [markId, cur, marks, candidates, resolved])

  const canAdd = !!selStart && !!selStop
  /**
   * adj987e（**用户 2026-10-18 口径**）：**收起时整组不占地方** —— 这里直接不渲染，
   * 改由歌名前的 `PracticeMarkExpandButton` 提供"展开"入口（否则这一行光放一个按钮太浪费）。
   */
  if (collapsed) return <></>
  return (
    <div className="practice-bar">
      {/* 左上角的收起小按钮（用户追加要求；展开入口在歌名前，见 `PracticeMarkExpandButton`） */}
      <button
        className="practice-collapse"
        onClick={toggleCollapsed}
        title={playbackCopy.practiceCollapse}
        aria-expanded={true}
        aria-label={playbackCopy.practiceCollapse}
      >
        ▾
      </button>
      {(
        <>
          <span className="practice-title">{playbackCopy.practiceTitle}</span>
          <select
            className="dock-select practice-select"
            value={markId}
            onChange={(e) => setMarkId(e.target.value)}
            title={playbackCopy.practiceSelectTitle}
          >
            {/* 第一项恒为「无」＝演奏全曲，不可删除 */}
            <option value="">{playbackCopy.practiceNone}</option>
            {marks.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            className={`btn practice-btn${selStart ? ' is-on' : ''}`}
            onClick={() => setSel('start', activeNoteId)}
            disabled={!activeNoteId}
            title={playbackCopy.practiceStartHint}
            aria-label={playbackCopy.practiceStart}
          >
            <span aria-hidden="true">⇤</span>
          </button>
          <button
            className={`btn practice-btn${selStop ? ' is-on' : ''}`}
            onClick={() => {
              /**
               * adj987j（用户口径 #2）：「停止音符如果有**连音线**，应该播放到覆盖该音符的连音线完为止」。
               *
               * ⚠ adj987m（**用户 2026-10-18 实报「又出现添加了标记段不按段播放」**）：
               * 这里原先**当场把端点改成连音线终点再存**，但 `slurPairs` 的序号与音符 id 的序号
               * 在有多声部/段层时**未必一致** ⇒ 存进去的 id 可能对不上任何音符 ⇒ 播放时解析失败、
               * 退回"全曲" ✗。现在**只记用户点的那个音**，延长交给播放时算（见 PlaybackDialog 的注释）。
               */
              setSel('stop', activeNoteId)
            }}
            disabled={!activeNoteId}
            title={playbackCopy.practiceStopHint}
            aria-label={playbackCopy.practiceStop}
          >
            <span aria-hidden="true">⇥</span>
          </button>
          <button
            className="btn practice-btn"
            onClick={() => {
              const m = addMark()
              if (!m) showNotice(playbackCopy.practiceNeedBoth, 'warn')
            }}
            disabled={!canAdd}
            title={playbackCopy.practiceAddHint}
            aria-label={playbackCopy.practiceAdd}
          >
            <span aria-hidden="true">＋</span>
          </button>
          <button
            className="btn practice-btn"
            onClick={() => deleteMark(markId)}
            disabled={markId === ''}
            title={playbackCopy.practiceDeleteHint}
            aria-label={playbackCopy.practiceDelete}
          >
            <span aria-hidden="true">－</span>
          </button>
          <button
            className={`btn practice-btn${loop ? ' is-on' : ''}`}
            onClick={() => setLoop(!loop)}
            title={playbackCopy.practiceLoopHint}
            aria-label={playbackCopy.practiceLoop}
            aria-pressed={loop}
          >
            <span aria-hidden="true">⟲</span>
          </button>
          {candidates.length > 1 && cur && (
            <select
              className="dock-select practice-pass"
              value={String(cur.pass ?? 0)}
              onChange={(e) => setPass(cur.id, Number(e.target.value))}
              title={playbackCopy.practicePassTitle}
            >
              {candidates.map((c, i) => (
                <option key={i} value={String(i)}>
                  {`第 ${c.startOccurrence} 遍${c.containsJump ? '（含跳越）' : ''}`}
                </option>
              ))}
            </select>
          )}
          {/* adj987s（用户实报"停止音没播放"）：把**解析结果**直接摆出来。
              用户在界面上就能看到"这段被算成了几个音、多长"——不用开开发者工具也能判断
              是"段算短了"还是"段对但播放没吃到"。 */}
          {cur && (
            <span className="practice-readout" title={playbackCopy.practiceSelectTitle}>
              {resolved.ids.length > 0
                ? playbackCopy.practiceResolved(
                    resolved.ids.length,
                    (resolved.rangeMs / 1000).toFixed(1) + ' 秒',
                    resolved.lastNote,
                    noteLabelOf(cur.endId),
                  )
                : playbackCopy.practiceResolvedMissing}
            </span>
          )}
        </>
      )}
    </div>
  )
}

/**
 * adj987e（**用户 2026-10-18 口径**）：**收起状态下的"展开"入口** —— 放在**歌名前**，
 * 这样收起时标记段组**不占任何行**（用户原话：「不然还要占一行的位置」）。
 *
 * 展开状态下它自己返回空（组本身已经在试听区下方显示了 ▾ 收起按钮）。
 */
export function PracticeMarkExpandButton(): React.JSX.Element {
  const collapsed = useUiStore((s) => s.practiceCollapsed)
  const toggleCollapsed = useUiStore((s) => s.togglePracticeCollapsed)
  if (!collapsed) return <></>
  return (
    <button
      className="practice-collapse practice-expand-inline"
      onClick={toggleCollapsed}
      title={playbackCopy.practiceExpand}
      aria-expanded={false}
      aria-label={playbackCopy.practiceExpand}
    >
      ▸
    </button>
  )
}
