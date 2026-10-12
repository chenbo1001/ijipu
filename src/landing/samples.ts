/**
 * landing/samples.ts — 首页 playground 的示例谱（adj877）
 *
 * 直接用仓库里**已有的示例谱**（`public/samples/*.jps` —— 就是应用「文件 → 打开示例」那一批）。
 * 为什么不用自己临时编的例子：那两份谱本来就有 smoke 断言守着（"文档示例零错误零告警"同族），
 * 拿它们当首页示例，**不会出现"示例自己就写错了"**这种事。
 * 代价是这两份原文会进首页的 JS 包（各约 1KB，可接受）。
 */
import moly from '../../public/samples/茉莉花.jps?raw'
import songbie from '../../public/samples/送别.jps?raw'

/**
 * 顺序即首页示例按钮的顺序，**第 0 个要与 `index.html` 里 textarea 的默认值一致**
 * （用户第一眼看到的、和点「最小示例」得到的，应当是同一段）。
 */
export const BRAND_SAMPLES: readonly { label: string; src: string }[] = [
  { label: '最小示例', src: "Q: 1 2 3 4 | 5 6 7 1' |\n" },
  { label: '茉莉花', src: moly },
  { label: '送别（双行歌词）', src: songbie },
] as const
