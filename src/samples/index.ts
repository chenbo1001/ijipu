/**
 * src/samples/index.ts — 内置示例谱
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
 * `defaultSample()` 仍返回内置「新建」模板（编辑器初始默认谱，与示例谱无关）。
 */
import { JPS_CONFIG_PREFIX } from '@ijipu/engine'

export interface SampleScore {
  id: string
  name: string
  description: string
  code: string
}

/**
 * 「新建」模板（adj：作为编辑器初始默认谱，替代原示例谱）
 *
 * adj413：
 *  ① 两条分隔注释规范为**恰好 30 个字符**（原「#====…以下为描述头定义…====#」为 62 字符，过长）；
 *  ② 主体之后**5 个空行**，再给出「页面设置」区块：一条分隔注释 + 真正的 `# jps-config:` 设置行
 *     （用户要求：`#========== 以下为页面设置，请勿手动修改 ==========` 紧跟 `# jps-config:…`）。
 *
 * 关于那条设置行：`{}` 表示"全部使用默认值"（`extractJpsConfig` 解析为空对象 → 不覆盖任何设置，
 * 与旧的"没有设置行"等价）。用户改动任一项页面设置后，程序会**原地**把字段写进这一行；
 * 若全部改回默认（差量写空），程序会删除该行、**保留上方那条分隔注释**——这是 `settings.ts` 的既有语义
 * （设置行是差量产物）。前缀用 `JPS_CONFIG_PREFIX` 常量拼而非手抄，避免两处各写一份而漂移。
 */
const NEW_FILE_TEMPLATE = [
  '#=========== 描述头定义 ===========',
  'V: 1.0',
  'B: 未命名',
  'Z: 佚名 词曲',
  'D: C',
  'P: 4/4',
  // adj254：本乐谱使用「爱记谱」编制——谱尾署名/广告说明
  'S: 本乐谱使用「爱记谱」编制',
  '#========== 以下为简谱主体 ==========',
  'Q: 1 2 3 4 |',
  'C: 这是歌词',
  // adj413：与主体间隔 5 个空行（下面 5 个空串）
  '',
  '',
  '',
  '',
  '',
  // adj413：页面设置区块——分隔注释 + 空设置行（`{}` = 全部默认）
  '#====== 以下为页面设置，请勿手动修改 =======',
  `${JPS_CONFIG_PREFIX}{}`,
  '',
].join('\n')

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

/** 默认（新建）谱 —— 返回内置新建模板，不依赖 SAMPLES[0] */
export function defaultSample(): SampleScore {
  return { id: 'new', name: '未命名', description: '', code: NEW_FILE_TEMPLATE }
}
