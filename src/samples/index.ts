/**
 * src/samples/index.ts — 内置示例谱
 *
 * adj：示例/模板谱当前清空——老板娘对这些示例不满意，暂不内置。
 * 保留 SampleScore 接口 + 空 SAMPLES（为将来引入高质量示例预留结构），
 * defaultSample() 改为返回内置「新建」模板，作为编辑器初始默认谱。
 */

export interface SampleScore {
  id: string
  name: string
  description: string
  code: string
}

/** 「新建」模板（adj：作为编辑器初始默认谱，替代原示例谱） */
const NEW_FILE_TEMPLATE = [
  '#============================以下为描述头定义==========================',
  'V: 1.0',
  'B: 未命名',
  'Z: 佚名 词曲',
  'D: C',
  'P: 4/4',
  // adj254：本乐谱使用「爱记谱」编制——谱尾署名/广告说明
  'S: 本乐谱使用「爱记谱」编制',
  '#============================以下开始简谱主体==========================',
  'Q: 1 2 3 4 |',
  'C: 这是歌词',
  '',
].join('\n')

/** 示例谱列表 —— 当前清空（老板娘暂不满意，不入内置示例） */
export const SAMPLES: SampleScore[] = []

/** 默认（新建）谱 —— 返回内置新建模板，不依赖 SAMPLES[0] */
export function defaultSample(): SampleScore {
  return { id: 'new', name: '未命名', description: '', code: NEW_FILE_TEMPLATE }
}
