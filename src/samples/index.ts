/**
 * src/samples/index.ts — 内置示例谱 + 「新建」模板
 *
 * adj423（用户要求）：示例谱改为**目录驱动**——`public/samples/*.jps` 下的每个 `.jps` 文件
 * 都是一份示例谱，用 Vite 的 `import.meta.glob` 在**构建期**自动发现并读入（`?raw`）。
 * 于是：**往 `public/samples/` 里加/改 .jps 文件即可，不需要改代码**（重跑构建即生效）。
 *
 * 每份示例的元信息也来自文件本身，避免"再维护一份清单"：
 *  - 名称：首个 `B:` 标题（没有就用文件名）
 *  - 说明：首个 `S:` 说明行（没有就留空）
 *  - id：文件名（去扩展名）
 *
 * adj481（用户要求）：「新建」模板同样**文件驱动**——模板就是 `src/samples/未命名.jps`，
 * 想改"新建出来的空白谱长什么样"，直接编辑那个文件即可（重跑构建生效），代码里不再内嵌模板。
 * 放在源码目录（而非 `public/`）是有意的：模板只在**构建期**被内联进产物，不需要作为静态资源发布
 * （`public/` 下的文件会随构建出现在 `dist/`，Web 端还能按 URL 直接下载到）。
 */
import { JPS_CONFIG_PREFIX } from '@ijipu/engine'

export interface SampleScore {
  id: string
  name: string
  description: string
  code: string
}

/**
 * adj481：「新建」模板 = `src/samples/未命名.jps`（**唯一来源**，改它即可改新建内容）。
 *
 * 为什么改成文件驱动：内嵌在代码里的模板每次调整都要改代码 + 重新构建，而模板本身是"用户可以随意
 * 塑形"的谱面文本（分隔注释、默认拍号、署名行、页面设置区块…），放在文件里直接编辑最省事。
 *
 * 兜底：文件被删/读不到时用下面这份**最小可解析**内容，避免新建出空文档（不是模板的"第二份副本"，
 * 只是故障兜底；要改模板请改 `src/samples/未命名.jps`）。
 */
const TEMPLATE_FALLBACK = [
  'V: 1.0',
  'B: 未命名',
  'D: C',
  'P: 4/4',
  'Q: 1 2 3 4 |',
  `${JPS_CONFIG_PREFIX}{}`,
  '',
].join('\n')

/** 构建期读入模板文件（单文件 glob，直接取值以避开 glob 键的路径写法差异） */
const TEMPLATE_FILES = import.meta.glob('./未命名.jps', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const NEW_FILE_TEMPLATE = Object.values(TEMPLATE_FILES)[0] ?? TEMPLATE_FALLBACK

/** 从示例源码里取首个 `B:` 标题（没有则空串） */
function firstTitleOf(code: string): string {
  for (const line of code.split(/\r?\n/)) {
    const m = /^\s*B\s*:\s*(.+?)\s*$/.exec(line)
    if (m) return m[1]
  }
  return ''
}

/** 从示例源码里取首个 `S:` 说明（没有则空串；`\n` 占位换行换成空格便于列表展示） */
function firstNoteOf(code: string): string {
  for (const line of code.split(/\r?\n/)) {
    const m = /^\s*S\s*:\s*(.+?)\s*$/.exec(line)
    if (m) return m[1].replace(/\\n/g, ' ')
  }
  return ''
}

/**
 * 示例谱列表——由 `public/samples/*.jps` **构建期自动发现**（按文件名排序，中文按拼音/码位稳定排序）。
 * 加/改示例只需动那个目录里的文件，不用回来改这里。
 */
export const SAMPLES: SampleScore[] = Object.entries(
  import.meta.glob('/public/samples/*.jps', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)
  .map(([path, code]) => {
    const file = path.split('/').pop() ?? path
    const id = file.replace(/\.jps$/i, '')
    return {
      id,
      name: firstTitleOf(code) || id,
      description: firstNoteOf(code),
      code,
    }
  })
  .sort((a, b) => a.id.localeCompare(b.id, 'zh-Hans-CN'))

/** 默认（新建）谱 —— 返回「新建」模板（adj481：内容来自 `public/未命名.jps`，不依赖 SAMPLES[0]） */
export function defaultSample(): SampleScore {
  return { id: 'new', name: '未命名', description: '', code: NEW_FILE_TEMPLATE }
}
