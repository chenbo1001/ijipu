/**
 * src/samples/index.ts — 内置示例谱（?raw 导入，保持 .jps 原文）
 */
import paipaizuo from '../../samples/paipaizuo.jps?raw'
import xiaoxingxing from '../../samples/xiaoxingxing.jps?raw'
import liangzhilaohu from '../../samples/liangzhilaohu.jps?raw'

export interface SampleScore {
  id: string
  name: string
  description: string
  code: string
}

export const SAMPLES: SampleScore[] = [
  {
    id: 'paipaizuo',
    name: '排排坐（极简示例）',
    description: '复刻原站极简示例，引擎冒烟测试',
    code: paipaizuo,
  },
  {
    id: 'xiaoxingxing',
    name: '小星星',
    description: '歌词对齐、增时线、标点自动跳过',
    code: xiaoxingxing,
  },
  {
    id: 'liangzhilaohu',
    name: '两只老虎',
    description: '反复记号 |: :|、弹性小节',
    code: liangzhilaohu,
  },
]

/** 默认打开第一首示例 */
export function defaultSample(): SampleScore {
  return SAMPLES[0]
}
