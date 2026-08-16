/**
 * engine/playback/types.ts — 播放模块共享类型（避免模块间循环依赖）
 */

/** 音频后端接口：合成与采样共同实现 */
export interface AudioBackend {
  readonly kind: 'synth' | 'sampler'
  /** 播放一个音（简谱音名如 C5；null 表示休止/不发声） */
  play(pitch: string | null, atMs: number, durationMs: number, gain: number): void
  stop(): void
  /** 释放资源 */
  dispose(): void
}

export type BackendKind = 'synth' | 'sampler'
