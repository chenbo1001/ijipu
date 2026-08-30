/**
 * editor/EditorPane.tsx — 代码编辑器（textarea + 语法高亮层 + 行号栏 + IDE 化体验）
 *
 * M2 能力：
 *  - 行号栏（与编辑区同步滚动；错误行红标 + 悬停显示错误消息）
 *  - 行首命令快捷键（光标在行首按 Q/C/B/Z/D/P/J/V/H 插入命令头）
 *  - 自动格式化（防抖 + 光标公共前缀保持）
 *  - 语法高亮（含错误行红底）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { highlightCodeWrapped } from './highlight'
import type { BlockMarks } from './highlight'
import { formatLine, codePosToNoteId, INSTRUMENT_LIB_NAMES } from '@ijipu/engine'
import { insertLineHeader, isLineHeaderKey, lineColOf } from './shortcuts'
import { isBarlineModifierContext, filterModifierHints } from './completions'
import { ScriptToolbar } from './ScriptToolbar'

/** adj165：自动提示浮层状态（null = 不显示）
 *  adj314：保留 & 修饰符（modifier）与 Y/@ 乐器（instrument）两类——
 *  描述头（header）、跳房子（volta）已由嵌入式输入工具条整段覆盖，弹列表取消 */
interface Completion {
  /** 提示类型：修饰符（& 编码）、Y 行乐器（@ 后，adj302） */
  kind: 'modifier' | 'instrument'
  /** 候选列表（cursorAt = 插入后光标停靠位置，用于带声部名模板） */
  items: { code: string; label: string; cursorAt?: number }[]
  /** 当前高亮索引 */
  index: number
  /** 光标触发位置（相对 textarea 内容区，浮层定位用） */
  x: number
  y: number
}

/** 判断光标前是否在输入 & 编码（返回已输入的前缀；只收字母 + 可选 +，adj220 与 tokenizer 一致） */
function modifierPrefix(lineBefore: string): string | null {
  const m = /&([a-zA-Z+]*)$/.exec(lineBefore)
  return m ? m[1] : null
}

export function EditorPane() {
  const code = useDocStore((s) => s.code)
  const setCode = useDocStore((s) => s.setCode)
  const setCursor = useDocStore((s) => s.setCursor)
  const setSelection = useDocStore((s) => s.setSelection)
  const autoFormat = useDocStore((s) => s.autoFormat)
  const parseResult = useDocStore((s) => s.parseResult)
  // adj281：editor-head 顶栏已迁出到 EditorFootBar；编辑器主体仍需字号/字体 CSS 变量
  const editorFontSize = useUiStore((s) => s.editorFontSize)
  // adj160：编辑器字体
  const editorFont = useUiStore((s) => s.editorFont)
  // adj233/adj235/adj311：自动折行开关（折叠点计算与 textarea wrap=soft/off 联动）
  const autoWrap = useUiStore((s) => s.autoWrap)
  // adj314：嵌入式简谱输入工具条显示开关
  const showScriptPad = useUiStore((s) => s.showScriptPad)
  // adj221：编辑器字体/字号随谱保存（# jps-config）——谱面有值时优先，
  // 无则回退 uiStore 全局默认；写入在 EditorFootBar 处理
  const pageConfig = useDocStore((s) => s.pageConfig)
  const effectiveFontSize = pageConfig.editorFontSize ?? editorFontSize
  const effectiveFont = pageConfig.editorFont ?? editorFont

  // adj165：行高取整为整数（textarea 原生行盒与高亮层 CSS 行盒完全一致）
  const editorLineH = Math.round(effectiveFontSize * 1.7)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  // adj167：显示层（高亮层/行号栏）内部滚动容器——用 transform 平移跟随 textarea 滚动位置，
  // 避免 scrollTop 同步被各自 scrollHeight 钳制（滚动到底时显示层停住、textarea 继续滚）
  const hlInnerRef = useRef<HTMLDivElement>(null)
  const gutterInnerRef = useRef<HTMLDivElement>(null)
  const formatTimer = useRef<number | null>(null)
  // adj110：最近编辑行（光标所在行）；光标离开该行时格式化它，避免输入时抢光标
  const editingLineRef = useRef<number>(-1)
  // adj165：自动提示浮层
  const [completion, setCompletion] = useState<Completion | null>(null)
  const completionRef = useRef<Completion | null>(null)
  completionRef.current = completion
  // adj296b：回车换行标记——onChange 后横向滚动回新行行首光标
  //（长行末回车时视口停在右侧，不滚回行首会看不到新行输入）
  const enterKeyRef = useRef(false)
  // adj314：系统软键盘当前是否显示——「⌨」按钮高亮态由 focus/blur 事件驱动
  const [kbActive, setKbActive] = useState(false)

  // 光标联动（M3）：光标移动 → 计算 notepos id → 预览高亮
  const setActiveNoteId = useDocStore((s) => s.setActiveNoteId)
  const noteIndexToPage = useDocStore((s) => s.noteIndexToPage)
  const cursorJump = useDocStore((s) => s.cursorJump)
  // adj292：折行点 ref——光标跳转滚动时精确到「光标所在视觉行」（源码行顶 + 折行偏移）
  const wrapPointsRef = useRef<number[][]>([])
  const undo = useDocStore((s) => s.undo)
  const redo = useDocStore((s) => s.redo)
  // adj165：当前光标行/列（1-based 行、0-based 列），供高亮当前行与当前区块
  const cursor = useDocStore((s) => s.cursor)
  const jumpCursor = useDocStore((s) => s.jumpCursor)
  const onSelectRef = useRef<() => void>(() => {})

  // 消费"点击谱面音符 / 撤销重做" → 跳转编辑器光标（含选区）请求
  useEffect(() => {
    if (!cursorJump) return
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    ta.selectionStart = Math.min(cursorJump.start, ta.value.length)
    ta.selectionEnd = Math.min(cursorJump.end, ta.value.length)
    // 滚动到光标所在行（行高 = 整数 --jp-editor-lh，adj165：与 CSS 取整一致）；adj63 wrap=off 需同步横向
    // adj223：折行后按视觉行滚动（visualTopRef 读取最新视觉行前缀和，不加入依赖——
    // 否则每次输入重跑 effect、光标被拉回跳转位置）
    // adj236：居中滚动——目标音符块尽量处于编辑器视口水平/垂直中心，
    // 避免跳到边角不好查找；超界由浏览器自动钳制到最大滚动
    const pos = lineColOf(ta.value, cursorJump.start)
    // adj292：折行内精确到光标所在视觉行——源码行顶 + 折行偏移×行高，保证音符块居中
    const wp = wrapPointsRef.current[pos.line - 1] ?? []
    const vIdx = wp.filter((p) => p < pos.col).length
    // visualTopRef 存「视觉行数」，需 ×行高转 px；（源码行前视觉行数 + 行内折行偏移）× 行高
    const targetTop = ((visualTopRef.current[pos.line - 1] ?? 0) + vIdx) * editorLineH
    ta.scrollTop = Math.max(0, targetTop - (ta.clientHeight - editorLineH) / 2)
    const targetLeft = pos.col * effectiveFontSize * 0.6
    // 折行（autoWrap）时内容宽度=视口，无横向滚动条——scrollLeft 置 0，
    // 避免残留的横向偏移让高亮层/内容错位、左侧看不到；wrap=off（长行横向滚动）再定位到目标列居中
    ta.scrollLeft = autoWrap ? 0 : Math.max(0, targetLeft - ta.clientWidth / 2 + effectiveFontSize * 0.3)
    onScroll()
    onSelectRef.current()
  }, [cursorJump, effectiveFontSize])

  // 行号 + 错误行信息
  const lineCount = useMemo(() => code.split('\n').length, [code])
  const errByLine = useMemo(() => {
    const map = new Map<number, { col: number; msg: string; severity: string }[]>()
    for (const e of parseResult.errors) {
      if (e.line <= 0) continue
      const arr = map.get(e.line) ?? []
      arr.push({
        col: e.col,
        severity: e.severity,
        msg: `${e.severity === 'error' ? '错误' : '警告'}[第${e.line}行 第${e.col}列] ${e.message}`,
      })
      map.set(e.line, arr)
    }
    return map
  }, [parseResult])

  // adj165：双击错误行号 → 跳到该行第一个错误位置
  const onGutterDoubleClick = (line: number) => {
    const errs = errByLine.get(line)
    if (!errs || errs.length === 0) return
    const first = [...errs].sort((a, b) => a.col - b.col)[0]
    // 行首偏移 + 列偏移（0-based 列 → 直接加）
    const lines = code.split('\n')
    let offset = 0
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1
    jumpCursor(offset + first.col)
  }

  // 滚动同步（adj167：显示层内部容器用 transform 平移跟随 textarea 的滚动位置，
  // 不受显示层自身 scrollHeight 限制——滚动到底也不会停住/错层）
  const onScroll = () => {
    const ta = taRef.current
    if (!ta) return
    const hlInner = hlInnerRef.current
    const gutterInner = gutterInnerRef.current
    if (hlInner) hlInner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`
    if (gutterInner) gutterInner.style.transform = `translateY(${-ta.scrollTop}px)`
    setCompletion(null) // adj165：滚动时关闭提示（位置不再准确）
  }

  // adj296b：回车换行后把横向滚动回滚到行首——textarea 原生不处理此场景：
  // 关闭自动折行（wrap=off）时在长行末尾回车，新行行首在左侧但视口仍停在右侧，
  // 用户看不到输入位置；其余场景（方向键/输入）由浏览器原生保证光标可见，
  // 不做额外滚动（避免逐键检查造成多余操作）
  const scrollToLineStartAfterEnter = () => {
    const ta = taRef.current
    if (!ta) return
    if (enterKeyRef.current) {
      enterKeyRef.current = false
      ta.scrollLeft = 0 // 新行行首 col=0 → 滚回最左
    }
  }

  // adj195：每源码行的视觉行数（软折行下可能 >1）——行号栏按视觉行高渲染，
  // 折行不产生新行号、并用延续标记区分新行与折行
  const [contentW, setContentW] = useState(0)
  // adj224：textarea 内容区宽（含 padding，clientWidth 已扣除滚动条宽）——
  // 同步给高亮层（--jp-editor-content-w），恢复竖向滚动条后两侧折行点一致
  const [taClientW, setTaClientW] = useState(0)
  // adj225：高亮层宽度由 ResizeObserver 直接写 DOM（inline width）——拖动窗体时
  // textarea 与高亮层**同帧**重排；若只走 React state（CSS 变量）会滞后一帧，
  // 拖动过程中高亮层仍是旧宽度、折行点不同，折行后的行文本错位
  const innerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const parent = taRef.current?.parentElement ?? null
    if (!parent) return
    const update = () => {
      const ta = taRef.current
      if (ta) {
        // 直接写 DOM：与浏览器 reflow 同帧生效（React state 只用于视觉行探测等非对齐计算）
        if (innerRef.current) innerRef.current.style.width = `${ta.clientWidth}px`
        // adj228：flushSync 同步渲染——快速拖动窗体时 React 并发调度可能跨帧提交，
        // wrapPoints（高亮层手动折行点）与 textarea 实际折行错位；同步渲染保证
        // 拖动过程中的每一帧内高亮层切分都与 textarea 一致
        flushSync(() => {
          setTaClientW(ta.clientWidth) // 含 padding，不含滚动条
          setContentW(ta.clientWidth - 28) // 内容区宽（去左右 padding 14×2）
        })
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(parent)
    // adj224：滚动条出现/消失会改变 textarea 内容宽（父宽不变）——需直接观察 textarea
    if (taRef.current) ro.observe(taRef.current)
    return () => ro.disconnect()
  }, [])
  // adj227：以实际层（textarea）的真实折行点为准——克隆同款 textarea 逐行测量
  // 折行点（wrapPoints），显示层按此手动分行，彻底消除 span 断行差异导致的错位；
  // adj309：用 mirror div + Range API 测字符 X 坐标替代 scrollHeight + Math.round——
  // scrollHeight 取整在 sub-pixel 边界处 ±1 字符误差，Range 直接给像素位置无误差；
  // mirror div 用 word-break:keep-all 与 textarea 折行行为一致（仅空格处折行）。
  const wrapPoints = useMemo(() => {
    const lines = code.split('\n')
    // adj233：关闭自动折行时不测量（wrap=off 无折行，长行横向滚动对位正确）
    if (!autoWrap) return lines.map(() => [])
    // adj225 延伸：用 taRef.current.clientWidth（实时，与 textarea reflow 同帧）——
    // 不读 taClientW state（state 滞后一帧，拖动/缩放窗体时镜像用旧宽 → 折行点错位）。
    // taClientW 仅作 deps 触发 useMemo 重算；测量时一律用 ref 的实时宽。
    const ta = taRef.current
    const w = ta ? ta.clientWidth : 0
    if (w <= 0) return lines.map(() => [])
    // mirror div：与 textarea 同款样式，width 直接用实时 clientWidth（与 textarea 一致）。
    // box-sizing: border-box 让内容 = w - 28（去 padding 14×2），与 textarea（box-sizing:border-box）完全一致。
    const mirror = document.createElement('div')
    mirror.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;width:${w}px;padding:10px 14px;box-sizing:border-box;font-family:${effectiveFont},monospace;font-size:${effectiveFontSize}px;line-height:${editorLineH}px;white-space:pre-wrap;overflow-wrap:normal;tab-size:4;font-variant-ligatures:none;direction:ltr`
    document.body.appendChild(mirror)
    // adj：去掉「短行跳过」优化（line.length*charW <= cw return []）——
    // charW = fontSize*0.6 是估算（`=` advance ~8.4 但 0.6×14=8.4 是近似，sub-pixel 临界时会
    // 让 mirror 误判「装得下不折」、而 textarea 实际整数像素 layout 装不下折了 → 一层折一层没折 → 错位。
    // 所有行都用 Range 测真实字符 X 坐标，精确无误差；短行 Range 也只测几十字符，性能可接受）
    const res = lines.map((line) => {
      mirror.textContent = line
      void mirror.offsetHeight // 强制 reflow
      const node = mirror.firstChild
      if (!node || node.nodeType !== 3) return []
      // 测每字符 X 坐标：top 突然变大 = 新行起点 → 折行点
      const rects: { left: number; right: number; top: number }[] = []
      for (let i = 0; i < line.length; i++) {
        const range = document.createRange()
        try {
          range.setStart(node, i)
          range.setEnd(node, i + 1)
        } catch {
          break
        }
        const r = range.getBoundingClientRect()
        rects.push({ left: r.left, right: r.right, top: r.top })
        range.detach?.()
      }
      const pts: number[] = []
      for (let i = 1; i < rects.length; i++) {
        const cur = rects[i]
        const prev = rects[i - 1]
        // 新行起点：top 显著大于 prev 且 left 显著小于 prev
        if (cur.top > prev.top + 0.5 && cur.left < prev.left - 1) {
          pts.push(i)
        }
      }
      return pts
    })
    document.body.removeChild(mirror)
    return res
  }, [code, contentW, taClientW, effectiveFontSize, editorLineH, effectiveFont, autoWrap])

  const visualLines = useMemo(
    () => wrapPoints.map((pts) => pts.length + 1),
    [wrapPoints],
  )
  // adj292：折行点经 ref 供光标跳转滚动读取（不加入 effect 依赖，避免输入重跑）
  wrapPointsRef.current = wrapPoints

  // adj201：视觉行起点偏移（每源码行前的累计视觉行数 × 行高）——折行后当前行
  // 背景/提示定位等按视觉行计算，不再按源码行（此前折行时光标行背景错位）
  const visualTopOfLine = useMemo(() => {
    const tops: number[] = []
    let acc = 0
    for (const v of visualLines) {
      tops.push(acc)
      acc += v
    }
    return tops
  }, [visualLines])
  // adj223：视觉行前缀和经 ref 供光标跳转滚动读取（避免加入 effect 依赖）
  const visualTopRef = useRef(visualTopOfLine)
  visualTopRef.current = visualTopOfLine

  // 光标写入 store + 谱面联动（M3）
  const onSelect = () => {
    const ta = taRef.current
    if (!ta) return
    const { line, col } = lineColOf(ta.value, ta.selectionStart)
    // adj196：光标移动离开上一行（鼠标点击/方向键/谱面跳转）→ 格式化该行。
    // 注意：此函数内部 setCode 会触发 onChange，但 onChange 中 editingLineRef 已更新
    // 为当前行，不会重复格式化。
    formatLeftLine(ta.value, line)
    setCursor(line, col)
    setSelection(ta.selectionStart, ta.selectionEnd)
    // adj291：传布局后的 index→页映射，使音符 id.page 与预览物理页一致（自动分页）
    const id = codePosToNoteId(ta.value, ta.selectionStart, noteIndexToPage ?? undefined)
    setActiveNoteId(id)
  }
  onSelectRef.current = onSelect

  // adj194：窗口/容器宽度变化（软折行重排）后强制同步 transform——
  // 否则动态 resize 过程中显示层与实际层折行位置短暂错位
  const onScrollRef = useRef(onScroll)
  onScrollRef.current = onScroll
  useEffect(() => {
    const onResize = () => onScrollRef.current()
    window.addEventListener('resize', onResize)
    // 拆分窗格拖动也会改变编辑器宽度（ResizeObserver 兜底）
    const ro = new ResizeObserver(onResize)
    if (taRef.current?.parentElement) ro.observe(taRef.current.parentElement)
    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
    }
  }, [])

  // adj314：系统软键盘显示态 —— 跟随 textarea focus/blur，给「⌨」按钮高亮
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    const onF = () => setKbActive(true)
    const onB = () => setKbActive(false)
    ta.addEventListener('focus', onF)
    ta.addEventListener('blur', onB)
    return () => {
      ta.removeEventListener('focus', onF)
      ta.removeEventListener('blur', onB)
    }
  }, [])

  // adj314：工具条插入 —— 与 applyCompletion 同范式：读 textarea → 拼接 → setCode → 光标定位。
  // cursorOffset 相对 insert 起点（默认末尾），用于带模板插入（如带声部名的描述头光标停在引号内）。
  // 注意：受控 textarea 无法 execCommand，必须 setCode 后 RAF 回位光标并联动 onSelect/updateCompletion。
  const insertAtCursor = (text: string, cursorOffset?: number) => {
    const ta = taRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const next = ta.value.slice(0, pos) + text + ta.value.slice(ta.selectionEnd)
    setCode(next)
    const newPos = pos + (cursorOffset ?? text.length)
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.selectionStart = taRef.current.selectionEnd = newPos
        onScroll()
        onSelect()
        updateCompletion()
      }
    })
  }

  // adj314：「⌨」软键盘开关 —— blur 收起（可靠）；focus 在用户手势下通常能唤起 iOS/Android 软键盘，
  // 个别平台 focus 失效时用户仍可点编辑区唤回，不影响其它输入。
  const toggleSystemKb = () => {
    const ta = taRef.current
    if (!ta) return
    if (ta.matches(':focus')) {
      ta.blur()
    } else {
      ta.focus()
    }
  }

  // adj165：分析光标前文本，触发自动提示（& 修饰符 / [ 跳房子 / 描述头行首 Tab）
  const updateCompletion = () => {
    const ta = taRef.current
    if (!ta) return
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1)
    // adj201：浮层 y 按视觉行（折行后光标行下有折行占位）；adj223：行数 × 行高转像素
    const compPos = (line: number, col: number) => ({
      x: col * effectiveFontSize * 0.6,
      y: ((visualTopOfLine[line - 1] ?? 0) + 1) * editorLineH,
    })
    // adj314：描述头（行首 Tab 补全）已由嵌入式输入工具条「描述头」组整段覆盖，取消弹列表；
    // 行首命令快捷键（Q/C/B/...）等行为保留在 onKeyDown。
    // adj302：Y 行乐器补全——光标在 Y: 行、已按空格或输入 @（进入填乐器阶段）时弹音色库列表
    if (/^Y\s*:/.test(lineBefore) && /\s/.test(lineBefore.slice(lineBefore.indexOf(':')))) {
      const after = lineBefore.replace(/^Y\s*:\s*@?/, '') // 已输入前缀（含可选 @ 剥离）
      const items = Object.values(INSTRUMENT_LIB_NAMES)
        .filter((n) => n.startsWith(after))
        .map((n) => ({ code: n, label: '乐器' }))
      if (items.length > 0) {
        const { line, col } = lineColOf(ta.value, pos)
        setCompletion({ kind: 'instrument', items, index: 0, ...compPos(line, col) })
      } else {
        setCompletion(null)
      }
      return
    }
    // 仅 Q 行（曲行）内提示
    if (!/^Q(\d*(?:"[^"]*")?\s*:)/.test(lineBefore) && !/^\s*Q/.test(lineBefore)) {
      setCompletion(null)
      return
    }
    // adj302b：曲行内 @ 乐器补全——输入 @（或 @ + 前缀）时弹音色库乐器列表
    const instM = /@([^@\s]*)$/.exec(lineBefore)
    if (instM) {
      const after = instM[1] // @ 后已输入前缀（剥离 @）
      const items = Object.values(INSTRUMENT_LIB_NAMES)
        .filter((n) => n.startsWith(after))
        .map((n) => ({ code: '@' + n, label: '乐器' }))
      if (items.length > 0) {
        const { line, col } = lineColOf(ta.value, pos)
        setCompletion({ kind: 'instrument', items, index: 0, ...compPos(line, col) })
      } else {
        setCompletion(null)
      }
      return
    }
    const mod = modifierPrefix(lineBefore)
    if (mod !== null) {
      // adj203：小节线后（| &、:| &）提示小节线修饰符（&fine/&dc/&ds/&ty/&hs），
      // 音符后提示音符修饰符——按光标上下文切换候选池
      const items = filterModifierHints(mod, isBarlineModifierContext(lineBefore))
      if (items.length === 0) {
        setCompletion(null)
        return
      }
      const { line, col } = lineColOf(ta.value, pos)
      // adj177：浮层定位在光标字符下方
      setCompletion({ kind: 'modifier', items, index: 0, ...compPos(line, col) })
      return
    }
    setCompletion(null)
  }

  // 补全候选（插入文本）
  const applyCompletion = (c: Completion) => {
    const ta = taRef.current
    if (!ta) return
    const item = c.items[c.index]
    if (!item) return
    const pos = ta.selectionStart
    const before = ta.value.slice(0, pos)
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1)
    let insert = item.code
    let replaceLen = 0
    let cursorAt: number | null = null
    if (c.kind === 'modifier') {
      // adj177：用户已输入 &（lineBefore 以 & 结尾），只补全其后的字母——
      // 不再拼接第二个 &（此前 replaceLen 仅替换字母、insert 又含 &，会变成 &&tr）
      const m = /&([a-zA-Z+]*)$/.exec(lineBefore)
      if (m) replaceLen = m[1].length
      insert = item.code + ' '
      cursorAt = insert.length
    } else if (c.kind === 'instrument') {
      // adj302/302b：Y 行乐器补全（替换 Y: 后内容）或曲行 @ 乐器补全（替换 @ + 前缀）
      if (/^Q/.test(lineBefore)) {
        const m = /@([^@\s]*)$/.exec(lineBefore)
        if (m) replaceLen = 1 + m[1].length // @ + 已输入前缀
      } else {
        const m = /^(Y\s*:\s*)(@?)(.*)$/.exec(lineBefore)
        if (m) replaceLen = m[2].length + m[3].length // @ + 已输入前缀
      }
      insert = item.code
      cursorAt = insert.length
    }
    const next = ta.value.slice(0, pos - replaceLen) + insert + ta.value.slice(pos)
    setCode(next)
    const newPos = pos - replaceLen + (cursorAt ?? insert.length)
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.selectionStart = taRef.current.selectionEnd = newPos
        onScroll()
        onSelect()
        setCompletion(null)
      }
    })
  }

  // 行首命令快捷键：光标在行首时按 Q/C/B/Z/D/P/J/V/H 插入命令头
  // 限制：歌词行（C 行）只允许插入 C；曲行（Q 行）只允许 Q/C；IME 合成事件排除
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = taRef.current
    if (!ta) return
    if (e.nativeEvent.isComposing) return // 输入法合成中不触发
    // adj165：自动提示导航（↑↓ 选择 / Enter Tab 补全 / Esc 关闭）
    const comp = completionRef.current
    if (comp) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCompletion({ ...comp, index: (comp.index + 1) % comp.items.length })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCompletion({ ...comp, index: (comp.index - 1 + comp.items.length) % comp.items.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyCompletion(comp)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setCompletion(null)
        return
      }
    }
    // adj111：撤销/重做在编辑器内直接处理（受控 textarea 浏览器原生撤销无效；
    // stopPropagation 防止与 App 全局快捷键双重触发）
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      e.stopPropagation()
      undo()
      return
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      e.stopPropagation()
      redo()
      return
    }
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    // adj296b：回车换行（无补全时）→ 标记，onChange 后横向滚回新行行首光标；
    // 其余场景横向滚动仍由用户手动控制
    if (e.key === 'Enter') {
      enterKeyRef.current = true
      return
    }
    const key = e.key
    if (key.length !== 1 || !isLineHeaderKey(key.toUpperCase())) return
    const keyUp = key.toUpperCase() as Parameters<typeof insertLineHeader>[2]
    // 当前行类型（光标前内容）
    const before = ta.value.slice(0, ta.selectionStart)
    const lineText = before.slice(before.lastIndexOf('\n') + 1)
    const isMusicLine = /^Q\d*(?:"[^"]*")?\s*:/.test(lineText)
    const isLyricLine = /^C\d*\s*:/.test(lineText)
    if (isLyricLine && keyUp !== 'C') return // 编辑歌词时避免误触其他命令
    if (isMusicLine && keyUp !== 'Q' && keyUp !== 'C') return
    const insert = insertLineHeader(ta.value, ta.selectionStart, keyUp)
    if (!insert) return
    e.preventDefault()
    setCode(insert.text)
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.selectionStart = taRef.current.selectionEnd = insert.pos
        onSelect()
      }
    })
  }

  // adj196：光标离开上一行时格式化该行（仅 Q 行）。输入（onChange）与光标移动
  // （onSelect：鼠标点击/方向键/谱面跳转）都触发——此前只有 onChange 处理，
  // 鼠标点击离开行不会格式化。
  // 返回是否已执行格式化（调用方据此跳过后续处理）。
  const formatLeftLine = (text: string, newLine: number): boolean => {
    if (!autoFormat) return false
    const prev = editingLineRef.current
    if (prev < 0 || prev === newLine) return false
    const li = prev - 1 // adj111：1-based 行 → 0-based 索引
    const lines = text.split('\n')
    const oldText = lines[li] ?? ''
    const formatted = formatLine(oldText)
    if (formatted === oldText) {
      editingLineRef.current = newLine
      return false
    }
    const delta = formatted.length - oldText.length
    lines[li] = formatted
    const replaced = lines.join('\n')
    const ta = taRef.current
    const off = ta ? Math.max(0, Math.min(ta.selectionStart + delta, replaced.length)) : 0
    setCode(replaced)
    requestAnimationFrame(() => {
      if (taRef.current) {
        taRef.current.selectionStart = taRef.current.selectionEnd = off
        onScroll()
        onSelect()
      }
    })
    editingLineRef.current = newLine
    return true
  }

  const onChange = () => {
    const ta = taRef.current
    if (!ta) return
    const next = ta.value
    const { line } = lineColOf(next, ta.selectionStart)
    // adj110：光标离开上一行时才格式化该行（仅 Q 行，formatLine 逐行处理），
    // 输入中不格式化 → 不抢光标；格式化行在光标上方，偏移量同步光标
    if (formatLeftLine(next, line)) return
    editingLineRef.current = line
    setCode(next)
    // adj165：输入后更新自动提示；adj296b：回车换行后横向滚回行首（仅此场景干预，
    // 其余光标可见性由浏览器原生保证）
    requestAnimationFrame(() => {
      updateCompletion()
      scrollToLineStartAfterEnter()
    })
  }

  useEffect(() => {
    return () => {
      if (formatTimer.current) window.clearTimeout(formatTimer.current)
    }
  }, [])

  // adj243：行内错误/告警块标记（col 相对该行内容）——命中块加红/橙单线外框
  const blockMarks = useMemo(() => {
    const m = new Map<number, BlockMarks>()
    for (const [line, arr] of errByLine) {
      const err: number[] = []
      const warn: number[] = []
      for (const e of arr) {
        if (e.severity === 'error') err.push(e.col)
        else if (e.severity === 'warning') warn.push(e.col)
      }
      if (err.length || warn.length) m.set(line, { err, warn })
    }
    return m
  }, [errByLine])

  // adj227：按实际层折行点分视觉行高亮（每视觉行一个 .hl-line，white-space: pre）
  const html = highlightCodeWrapped(code, new Set(errByLine.keys()), cursor, wrapPoints, blockMarks)
  const gutterLines = Array.from({ length: lineCount }, (_, i) => i + 1)
  // adj242：行号字号跟随脚本字号后，按行号位数自适应栏宽（避免大字号/多位数被裁切）
  const gutterNumW = Math.max(46, String(lineCount).length * effectiveFontSize * 0.62 + 16)

  // 编辑器字号 → CSS 变量（--jp-editor-fs / --jp-editor-lh），驱动 textarea/高亮层/行号栏
  // adj163：字体值保留 monospace 回退——避免所选字体缺失时退化为非等宽默认字体导致
  // 高亮层加粗 span 与 textarea 逐字符错位
  // adj165：行高取整为整数——非整数行高（如 14×1.7=23.8px）在 textarea 原生行盒与
  // 高亮层 CSS 行盒中按各自方式取整，多行后累积错位（选中行高亮到另一行）
  const editorStyle = {
    '--jp-editor-fs': `${effectiveFontSize}px`,
    '--jp-editor-lh': `${editorLineH}px`,
    '--jp-editor-font': `${effectiveFont}, monospace`,
    // adj224：高亮层宽度跟随 textarea 内容区（滚动条占宽后两侧折行一致）
    '--jp-editor-content-w': taClientW > 0 ? `${taClientW}px` : '100%',
  } as React.CSSProperties

  return (
    <div className="editor-pane">
      {/* adj281：editor-head 已迁出到 EditorFootBar；编辑器主体直接铺满 */}
      <div className="editor-body" style={editorStyle}>
        <div className="editor-gutter" ref={gutterRef} aria-hidden="true" style={{ width: gutterNumW }}>
          <div className="editor-gutter-inner" ref={gutterInnerRef}>
            {gutterLines.map((n) => {
              const errs = errByLine.get(n)
              const vis = visualLines[n - 1] ?? 1
              return (
                <div
                  key={n}
                  className={errs ? 'gutter-line gutter-err' : 'gutter-line'}
                  style={{ height: vis * editorLineH }}
                  title={errs?.map((e) => e.msg).join('\n')}
                  onDoubleClick={() => onGutterDoubleClick(n)}
                >
                  <span className="gutter-num">{n}</span>
                  {/* adj195：折行延续标记（不占新行号，区分新行与折行） */}
                  {vis > 1 &&
                    Array.from({ length: vis - 1 }, (_, k) => (
                      <span key={k} className="gutter-wrap-mark" />
                    ))}
                </div>
              )
            })}
          </div>
        </div>
        <div className="editor-main">
          <textarea
            ref={taRef}
            value={code}
            spellCheck={false}
            wrap={autoWrap ? 'soft' : 'off'}
            // adj233：关闭自动折行时 white-space 改 pre——wrap=off 仅属性不足，
            // CSS pre-wrap 仍会软折行；pre 保证长行横向滚动、不折行对位正确；
            // adj235：选中自动折行时 overflow-x hidden——normal 下无空格长串溢出，
            // 取消横向滚动条（长串与高亮层同被裁剪，对位一致）
            style={{
              whiteSpace: autoWrap ? 'pre-wrap' : 'pre',
              overflowX: autoWrap ? 'hidden' : 'auto',
            }}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={onChange}
            onKeyDown={onKeyDown}
            onScroll={onScroll}
            onSelect={onSelect}
            onKeyUp={onSelect}
            onMouseUp={onSelect}
          />
          <div ref={hlRef} className="highlight-layer" aria-hidden="true">
            {/* adj225：innerRef 供 ResizeObserver 同帧同步宽度（拖动窗体不滞后） */}
            <div className="highlight-inner" ref={(el) => {
              innerRef.current = el
              hlInnerRef.current = el
            }}>
              {/* adj：去掉整行铺满背景 — 折行时整行 accent 8% 底色跨多视觉行过重；
                  当前块/选中由 .hl-current-block 背景（accent 18%）文字级高亮承担，参考排版按钮选中风格 */}
              <div
                className="highlight-content"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          </div>
          {/* adj165：自动提示浮层（& 修饰符 / Y/@ 乐器）；adj177：定位含内容层 padding（上 10 左 14）；
              adj192：靠下输入时浮层改为在光标上方弹出（否则列表超出窗口底部无法选择） */}
          {completion && (
            <CompletionPopover
              completion={completion}
              containerRef={taRef.current?.parentElement ?? null}
              lineH={editorLineH}
              onPick={(c) => applyCompletion(c)}
            />
          )}
        </div>
      </div>
      {/* adj314：嵌入式简谱输入工具条——编辑器底部常驻（编辑区与预览/分页之间），
          单行横向滑动，主键/二级键共用一条工具条 */}
      {showScriptPad && (
        <ScriptToolbar onInsert={insertAtCursor} onToggleKb={toggleSystemKb} kbActive={kbActive} />
      )}
    </div>
  )
}

/** adj192：自动提示浮层——靠下时翻转到光标上方显示，避免列表超出窗口底部 */
function CompletionPopover({
  completion,
  containerRef,
  lineH,
  onPick,
}: {
  completion: Completion
  containerRef: HTMLElement | null
  lineH: number
  onPick: (c: Completion) => void
}) {
  const { x, y, items } = completion
  // 估算浮层尺寸：每项约 24px + 上下 padding + 估算宽
  const estH = items.length * 24 + 8
  const estW = 240
  const containerW = containerRef?.clientWidth ?? 800
  const containerH = containerRef?.clientHeight ?? 600
  // 内容区 left padding=14；浮层左缘默认在光标右侧；超出右边界翻转到左侧
  const baseLeft = x + 14
  const flipH = baseLeft + estW > containerW
  const left = flipH ? Math.max(4, baseLeft - estW) : baseLeft
  // 默认在光标下方；超出底部翻转到上方，并钳制不超容器下沿
  const below = y + 10
  const flipV = below + estH > containerH
  const top = flipV
    ? Math.max(4, y - lineH - estH + 10)
    : Math.min(below, containerH - estH - 4)
  return (
    <div className="editor-completion" style={{ left, top }}>
      {items.map((it, i) => (
        <div
          key={it.code}
          className={`completion-item${i === completion.index ? ' active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault() // 防止 textarea 失焦
            onPick({ ...completion, index: i })
          }}
        >
          <span className="completion-code">{it.code}</span>
          <span className="completion-label">{it.label}</span>
        </div>
      ))}
    </div>
  )
}
