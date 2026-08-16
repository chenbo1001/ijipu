/**
 * engine/playback/index.ts — 播放引擎（契约先行，实现见后续迭代）
 *
 * 输入：排版结果；输出：有序播放事件序列（含反复记号展开：
 * |: :| 反复、跳房子 [ ]、以及后续 D.C./Fine 支持）。
 * 音频输出支持两种后端（可切换）：
 *  - synth：Web Audio 合成音色（内置振荡器包络，零依赖）
 *  - sampler：采样音源（钢琴采样，按需加载）
 */
import type { PlacedToken, ScoreLayout } from '../types'

/** 一次播放事件 */
export interface PlayEvent {
  /** 音符索引（用于高亮与进度定位） */
  placed: PlacedToken
  /** 距开始的延迟（ms） */
  atMs: number
  /** 时值（ms） */
  durationMs: number
}

/** 播放序列构建结果 */
export interface PlaySequence {
  events: PlayEvent[]
  /** 总时长（ms） */
  totalMs: number
  /** 拍速（每分钟拍数），从描述头 J 或页面配置推断 */
  bpm: number
}

/** 音频后端接口：合成与采样共同实现 */
export interface AudioBackend {
  readonly kind: 'synth' | 'sampler'
  /** 播放一个音（简谱音名如 C5；null 表示休止/不发声） */
  play(pitch: string | null, atMs: number, durationMs: number, gain: number): void
  stop(): void
  /** 释放资源 */
  dispose(): void
}

/**
 * 构建播放序列（展开反复记号）。
 * TODO(engine): 实现序列构建与反复逻辑。
 */
export function buildPlaySequence(layout: ScoreLayout, bpm: number): PlaySequence {
  void layout
  return { events: [], totalMs: 0, bpm }
}
