/**
 * landing/playground.ts — 首页「现场试一段」区块（adj877）
 *
 * 用户在首页改一段 `.jps`，点「预览」立刻出谱。用的是**应用自己的引擎**
 * （`@ijipu/engine`），所以首页看到的效果与应用里逐像素一致。
 *
 * ## 为什么引擎必须**按需加载**
 *
 * 引擎 chunk 约 190KB（gzip 约 68KB），而首页原先只有几 KB JS（刻意保持"介绍页够轻"）。
 * 若在入口静态 `import`，每个只想看看介绍的人都要先下这 68KB。
 * 所以：**点「预览」时才 `import('@ijipu/engine')`** —— 不交互的用户一分钱不花；
 * 交互过的用户第二次点就是内存里现成的。动态 import 也让 Vite 把它拆成独立 chunk，
 * 应用页与首页**共用同一份**引擎产物。
 *
 * ## 渲染出来的 SVG 是自包含的
 *
 * 引擎产出的每一页 SVG 自带 `<rect data-page-bg fill="#ffffff">` 白底、元素颜色写死 `#1b1b1b`
 * ⇒ 直接 `innerHTML` 插进深色首页就是"白纸黑字"的谱面，不需要任何主题变量适配。
 * （这也是嵌入版（Obsidian）那条路线的做法：只调引擎、不碰 DOM 之外的样式。）
 */
import { BRAND_SAMPLES } from './samples'

type EngineModule = typeof import('@ijipu/engine')

/** 引擎模块只在第一次需要时加载，之后复用 */
let enginePromise: Promise<EngineModule> | null = null
function loadEngine(): Promise<EngineModule> {
  enginePromise ??= import('@ijipu/engine')
  return enginePromise
}

/** 一次渲染的结果：`svgs` 每页一个；`problems` 是可以直接显示给用户的问题行 */
interface RenderResult {
  svgs: string[]
  problems: string[]
}

/** 把引擎的诊断行整理成"第 N 行：消息（正确写法…）" */
function formatProblems(rows: readonly { line: number; message: string; hint?: string }[], max: number): string[] {
  return rows.slice(0, max).map((r) => {
    const where = r.line > 0 ? `第 ${r.line} 行：` : ''
    return `${where}${r.message}${r.hint ? `（正确写法：${r.hint}）` : ''}`
  })
}

/**
 * 渲染一段 `.jps`。
 * 有**错误级**问题就**不渲染**（与应用一致：错误阻断渲染，告警只提示）；
 * 告警仍然渲染，但把告警行一并返回，让用户知道"能看，但这里可能不是你要的"。
 */
async function renderJps(src: string): Promise<RenderResult> {
  const e = await loadEngine()
  const parsed = e.parseJps(src)
  const { errors, warnings } = e.splitParseIssues(parsed)
  if (errors.length > 0) return { svgs: [], problems: formatProblems(errors, 3) }
  const cfg = e.mergeJpsConfig(src, e.defaultPageConfig)
  const svgs = e.renderScoreToSvg(e.layoutScore(parsed, cfg))
  return { svgs, problems: formatProblems(warnings, 2) }
}

/** 区块的 DOM 引用 */
interface PlaygroundDom {
  root: HTMLElement
  source: HTMLTextAreaElement
  out: HTMLElement
  msg: HTMLElement
  tabs: HTMLButtonElement[]
  panes: HTMLElement[]
}

function queryDom(): PlaygroundDom | null {
  const root = document.getElementById('playground')
  const source = document.getElementById('pg-src')
  const out = document.getElementById('pg-out')
  const msg = document.getElementById('pg-msg')
  if (!root || !(source instanceof HTMLTextAreaElement) || !out || !msg) return null
  return {
    root,
    source,
    out,
    msg,
    tabs: [...root.querySelectorAll<HTMLButtonElement>('[data-pg-tab]')],
    panes: [...root.querySelectorAll<HTMLElement>('[data-pg-pane]')],
  }
}

/** 挂载首页的 playground（HTML 里已经写好骨架，这里只接行为） */
export function mountPlayground(): void {
  const dom = queryDom()
  if (!dom) return
  const { root, source, out, msg, tabs, panes } = dom

  let renderedFor = ''
  let busy = false

  /** 切标签：`code` 显示可编辑源码，`preview` 显示渲染结果 */
  const showTab = (tab: string) => {
    for (const b of tabs) {
      const on = b.dataset.pgTab === tab
      b.classList.toggle('active', on)
      b.setAttribute('aria-selected', on ? 'true' : 'false')
    }
    for (const p of panes) p.hidden = p.dataset.pgPane !== tab
    if (tab === 'preview') void refresh()
  }

  /** 渲染当前源码（同一份源码不重复渲染；切来切去不会反复跑引擎） */
  const refresh = async (force = false) => {
    const src = source.value
    if (!force && src === renderedFor) return
    if (busy) return
    /**
     * 空脚本要**明确提示**，不能交给引擎渲染：
     * 引擎对空源码会产出一张**空白页**（合法但没用），用户看到白纸只会以为坏了
     * （本轮实测：这就是"提示为空"那条断言红灯的真正原因）。
     */
    if (src.trim() === '') {
      out.innerHTML = ''
      renderedFor = src
      msg.textContent = "还没有内容——在上面写一行谱吧，比如：Q: 1 2 3 4 | 5 6 7 1' |"
      msg.dataset.kind = 'info'
      return
    }
    busy = true
    msg.textContent = '正在渲染…'
    msg.dataset.kind = 'info'
    try {
      const { svgs, problems } = await renderJps(src)
      out.innerHTML = svgs.join('\n')
      renderedFor = src
      if (problems.length > 0) {
        msg.textContent = `⚠ ${problems.join('　')}`
        msg.dataset.kind = 'warn'
      } else if (svgs.length === 0) {
        msg.textContent = '这段脚本没有可渲染的内容。'
        msg.dataset.kind = 'warn'
      } else {
        msg.textContent = ''
        msg.dataset.kind = 'ok'
      }
    } catch (err) {
      // 引擎加载失败（离线且没缓存、或产物缺失）——如实说明，不要假装渲染成功
      msg.textContent = `渲染不出来：${err instanceof Error ? err.message : String(err)}`
      msg.dataset.kind = 'warn'
      out.innerHTML = ''
    } finally {
      busy = false
    }
  }

  for (const b of tabs) b.addEventListener('click', () => showTab(b.dataset.pgTab ?? 'code'))

  // 示例：点一下直接进预览（用户想看的是效果，不是再点一次标签）
  root.querySelectorAll<HTMLButtonElement>('[data-pg-sample]').forEach((b) => {
    b.addEventListener('click', () => {
      const idx = Number(b.dataset.pgSample)
      const sample = BRAND_SAMPLES[idx]
      if (!sample) return
      source.value = sample.src
      showTab('preview')
    })
  })

  root.querySelector<HTMLButtonElement>('#pg-rerender')?.addEventListener('click', () => void refresh(true))

  // 默认停在「脚本」标签：预览要下引擎，不该在首屏就发生（见文件头说明）
  showTab('code')
}
