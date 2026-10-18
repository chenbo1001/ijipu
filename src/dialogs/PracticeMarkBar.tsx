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
import { buildPlaySequence, layoutScore, resolvePracticeRange } from '@ijipu/engine'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { docKeyOf, loadMarks, saveMarks } from '../store/practiceMarks'
import { playbackCopy } from '../brand/copy'

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

  const cur = marks.find((m) => m.id === markId)

  /**
   * 候选遍次：**只在选中了标记时**才算（要 buildPlaySequence，比较贵）。
   * 解析不出来（标记失效）⇒ 空数组，UI 只显示提示，不显示遍次下拉。
   */
  const candidates = useMemo(() => {
    if (!cur) return []
    const seq = buildPlaySequence(parseResult, layoutScore(parseResult, pageConfig), 90)
    return resolvePracticeRange(seq, cur.startId, cur.endId).candidates
  }, [cur, parseResult, pageConfig])

  const canAdd = !!selStart && !!selStop
  return (
    <div className={`practice-bar${collapsed ? ' is-collapsed' : ''}`}>
      {/* 左上角的收起/显示小按钮（用户追加要求） */}
      <button
        className="practice-collapse"
        onClick={toggleCollapsed}
        title={collapsed ? playbackCopy.practiceExpand : playbackCopy.practiceCollapse}
        aria-expanded={!collapsed}
        aria-label={collapsed ? playbackCopy.practiceExpand : playbackCopy.practiceCollapse}
      >
        {collapsed ? '▸' : '▾'}
      </button>
      {!collapsed && (
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
          >
            {playbackCopy.practiceStart}
          </button>
          <button
            className={`btn practice-btn${selStop ? ' is-on' : ''}`}
            onClick={() => setSel('stop', activeNoteId)}
            disabled={!activeNoteId}
            title={playbackCopy.practiceStopHint}
          >
            {playbackCopy.practiceStop}
          </button>
          <button
            className="btn practice-btn"
            onClick={() => {
              const m = addMark()
              if (!m) showNotice(playbackCopy.practiceNeedBoth, 'warn')
            }}
            disabled={!canAdd}
            title={playbackCopy.practiceAddHint}
          >
            {playbackCopy.practiceAdd}
          </button>
          <button
            className="btn practice-btn"
            onClick={() => deleteMark(markId)}
            disabled={markId === ''}
            title={playbackCopy.practiceDeleteHint}
          >
            {playbackCopy.practiceDelete}
          </button>
          <button
            className={`btn practice-btn${loop ? ' is-on' : ''}`}
            onClick={() => setLoop(!loop)}
            title={playbackCopy.practiceLoopHint}
            aria-pressed={loop}
          >
            ⟲ {playbackCopy.practiceLoop}
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
        </>
      )}
    </div>
  )
}
