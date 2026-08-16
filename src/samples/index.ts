/**
 * src/samples/index.ts — 内置示例谱（?raw 导入，保持 .jps 原文）
 */
import paipaizuo from '../../samples/paipaizuo.jps?raw'
import xiaoxingxing from '../../samples/xiaoxingxing.jps?raw'
import liangzhilaohu from '../../samples/liangzhilaohu.jps?raw'
import ershenbu from '../../samples/ershenbu.jps?raw'
import fanfuTiaofangzi from '../../samples/fanfu-tiaofangzi.jps?raw'
import lianyinxianZhuangshi from '../../samples/lianyinxian-zhuangshi.jps?raw'
import yufaQuangai from '../../samples/yufa-quangai.jps?raw'
import yinyunZhuangshi from '../../samples/yinyun-zhuangshi.jps?raw'

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
  {
    id: 'ershenbu',
    name: '二声部练习',
    description: '多声部渲染：声部括弧与名称、各声部歌词',
    code: ershenbu,
  },
  {
    id: 'fanfu-tiaofangzi',
    name: '反复与跳房子',
    description: '|: :| 两遍反复、跳房子第一遍/第二遍',
    code: fanfuTiaofangzi,
  },
  {
    id: 'lianyinxian-zhuangshi',
    name: '连音线与装饰',
    description: '连音线、&tr 颤音、&mp 力度、渐强渐弱',
    code: lianyinxianZhuangshi,
  },
  {
    id: 'yufa-quangai',
    name: '语法全覆盖',
    description: '高低音点、休止符、附点、减时线、变音、全音符',
    code: yufaQuangai,
  },
  {
    id: 'yinyun-zhuangshi',
    name: '倚音与虚音符',
    description: '前倚音 [65]、后倚音 [h56]、虚音符 (1)、后置变音',
    code: yinyunZhuangshi,
  },
]

/** 默认打开第一首示例 */
export function defaultSample(): SampleScore {
  return SAMPLES[0]
}
