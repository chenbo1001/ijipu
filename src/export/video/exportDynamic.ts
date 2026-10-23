/**
 * export/video/exportDynamic.ts — 「动态谱视频」的**出片编排**（adj1084）
 *
 * 为什么单独一层：这段编排原来只活在预览区组件里（`DynamicFrameOverlay.tsx`），
 * 而命令行导出要的是**同一个结果**（同样的片头/片尾、同样的 3 分钟口径、同样的音轨）。
 * 两份实现迟早会漂 ⇒ 抽成纯编排：组件与命令行的隐藏窗口都调这里。
 *
 * 依赖边界：
 *  · 本文件**不碰 React**，也不读 store；音轨怎么来由调用方给（`makeAudio`）——
 *    界面那边用现成的 HQ 音源缓存，命令行那边自己解析音色库；
 *  · 画面与会话仍然走 `createDynamicSession`（引擎 + 宿主层），不另造一份。
 */
import type { DynamicPresetId, PageConfig, PanMode } from '@ijipu/engine'
import { createDynamicSession, INTRO_PAN_MS, type DynamicSession } from './renderer'
import { encodeMp4 } from './mp4'
import type { CardStyle } from './cardTemplates'

/** 单支视频上限（3 分钟；含片头/片尾）——与界面上的「3 分钟」模式同一口径 */
export const EXPORT_MAX_MS = 180_000
/** 片头：描述头静止 3 秒 + 推近 0.7 秒 ⇒ 第一拍在 3.7 秒 */
export const LEAD_IN_MS = 3_700

/**
 * 视频封面取的时刻（`adj1111`）：片头卡**完全显现**的最后一刻。
 *
 * = `LEAD_IN_MS − INTRO_PAN_MS`（3700 − 700 = 3000）。这一帧是"标题 + 曲目信息"最完整的样子，
 * 再往后 0.7 秒卡片就开始淡出、推近到第一拍。与 `mp4.ts` 的 `DEFAULT_COVER_MS` 同值——
 * 这里显式传，改片头节奏时不会忘了改封面。
 */
export const COVER_MS = LEAD_IN_MS - INTRO_PAN_MS

export interface DynamicExportOptions {
  code: string
  pageConfig: PageConfig
  aspect: DynamicPresetId
  /** `full` = 整曲；`3min` = 单支上限 3 分钟 */
  mode: 'full' | '3min'
  /** 只导某个标记段（起止音符 id + 候选遍次，0 起）；`null` = 整曲 */
  range: { startId: string; endId: string; pass?: number } | null
  cardStyle?: CardStyle
  /**
   * adj1089：行中平移方式（`follow` / `beat` / `bar`）。
   * 调用方从 `uiStore.panMode` 取（本文件刻意不读 store，见文件头的依赖边界）；缺省 follow。
   */
  panMode?: PanMode
  /**
   * adj1094：**行末提前平移量**（单位：拍，默认 0.5、最多 2）。三种模式共用；
   * 与 `panMode` 一样由调用方从 `uiStore` 取（本文件不读 store）。
   */
  rowLeadBeats?: number
  /**
   * 音轨工厂。**不传 = 无声**（不是"忘了"）：调用方明确决定要不要声音。
   * 失败由调用方处理（界面那边是"本次导出无声"的提示，命令行是回包里说明）。
   */
  makeAudio?: (session: DynamicSession) => Promise<AudioBuffer | null>
  onProgress?: (progress: number, phase: string) => void
  signal?: AbortSignal
}

export interface DynamicExportResult {
  /** 成片（可直接下载/落盘） */
  blob: Blob
  /** 是否**真的**带上了音轨（`makeAudio` 没给、或它返回 null ⇒ false） */
  audio: boolean
  /** 成片时长（ms，含片头片尾） */
  totalMs: number
}

/**
 * 建会话 → （可选）渲音轨 → 编码 MP4。
 *
 * 注意 `maxMs: undefined`：会话自己已按 `mode` 把音乐裁好（`createDynamicSession` 的
 * `maxMs` 是"先裁音乐、不裁片尾"），这里再截帧就会把片尾卡切掉（adj1064 的老问题）。
 */
export async function exportDynamicVideo(opts: DynamicExportOptions): Promise<DynamicExportResult> {
  opts.onProgress?.(0, '正在准备画面…')
  const session = await createDynamicSession(opts.code, opts.aspect, opts.pageConfig, undefined, {
    range: opts.range,
    leadInMs: LEAD_IN_MS,
    ...(opts.mode === '3min' ? { maxMs: EXPORT_MAX_MS } : {}),
    ...(opts.cardStyle === undefined ? {} : { cardStyle: opts.cardStyle }),
    // adj1089：平移方式透传（与预览/试听同一份 L1 偏好）
    ...(opts.panMode === undefined ? {} : { panMode: opts.panMode }),
    // adj1094：行末提前平移量透传
    ...(opts.rowLeadBeats === undefined ? {} : { rowLeadBeats: opts.rowLeadBeats }),
  })

  let audio: AudioBuffer | null = null
  if (opts.makeAudio !== undefined) {
    opts.onProgress?.(0, '正在渲染音轨…')
    try {
      audio = await opts.makeAudio(session)
    } catch {
      // 音轨失败 ⇒ 出无声片（与界面同一处理：不让"没声音"变成"导不出来"）
      audio = null
    }
  }

  opts.onProgress?.(0, '正在编码画面…')
  const blob = await encodeMp4(session, {
    fps: 30,
    maxMs: undefined,
    audio,
    // adj1111：封面 = 片头卡完整帧（系统缩略图/播放器封面不再是一张空背景）
    coverMs: COVER_MS,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    onProgress: (p) => opts.onProgress?.(p, '正在编码画面…'),
  })
  return { blob, audio: audio !== null, totalMs: session.totalMs }
}
