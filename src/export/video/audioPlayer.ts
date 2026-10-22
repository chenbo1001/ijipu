/**
 * export/video/audioPlayer.ts — 动态谱**预览**的声音播放器（adj1063）
 *
 * 为什么单独抽一个类：预览的 rAF 不能用墙钟推进（会和声音漂移），
 * 必须以 `AudioContext.currentTime` 为母钟——画面每一帧问它"现在到哪了"，
 * 音频和画面就是同一条时间轴。出片仍是离线编码，不用这个类。
 *
 * 只做三件事：装 AudioBuffer、从某一毫秒开始放、报告当前毫秒。
 * AudioContext 在**第一次 play**（用户点击）时才创建/恢复，满足浏览器自动播放策略。
 */

export class DynamicAudioPlayer {
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  /** 音频源计划开始播放的 AudioContext 时间 */
  private startAt = 0
  /** 开始播放时对应的"曲子毫秒" */
  private startCursor = 0
  private playing = false

  /** 换谱/重新载入时换掉音轨；传 null 表示暂时没有声音 */
  setBuffer(buffer: AudioBuffer | null): void {
    this.stop()
    this.buffer = buffer
  }

  get hasBuffer(): boolean {
    return this.buffer !== null
  }

  get durationMs(): number {
    return this.buffer ? this.buffer.duration * 1000 : 0
  }

  /**
   * 在**用户点击的同步栈**里先把 AudioContext 建出来/恢复。
   *
   * 为什么单独有这一步：首次播放要先 `await` 音色库 + 离线渲染（可能几秒），
   * 等完再 `new AudioContext()` 时浏览器可能已经不算"用户手势" ⇒ 上下文 suspended、没声。
   * 点击当刻先 unlock，后面 `play()` 只负责接线。
   */
  unlock(): void {
    const ctx = (this.ctx ??= new AudioContext())
    void ctx.resume().catch(() => {})
  }

  /**
   * 从 `fromMs` 开始放。
   * @returns 是否真的开始放了（没音轨、或已经超过音轨长度 ⇒ false，画面静音继续）
   */
  async play(fromMs: number): Promise<boolean> {
    if (!this.buffer) return false
    const ctx = (this.ctx ??= new AudioContext())
    await ctx.resume()
    this.stopSource()
    const durationMs = this.buffer.duration * 1000
    const from = Math.max(0, fromMs)
    if (from >= durationMs - 1) {
      this.playing = false
      return false
    }
    const source = ctx.createBufferSource()
    source.buffer = this.buffer
    source.connect(ctx.destination)
    /**
     * 留 50ms 启动余量：`startAt` 之前 `currentMs()` 会停在起点，
     * 否则 `currentTime` 已经越过 0，第一帧会往前跳一点点。
     */
    this.startAt = ctx.currentTime + 0.05
    this.startCursor = from
    source.start(this.startAt, from / 1000)
    this.source = source
    this.playing = true
    return true
  }

  /** 当前播放到哪一毫秒；没在放（或没声音）返回 null，让调用方退回墙钟 */
  currentMs(): number | null {
    if (!this.playing || !this.ctx) return null
    return this.startCursor + Math.max(0, this.ctx.currentTime - this.startAt) * 1000
  }

  pause(): void {
    this.stopSource()
    this.playing = false
  }

  stop(): void {
    this.stopSource()
    this.playing = false
  }

  destroy(): void {
    this.stop()
    this.buffer = null
    if (this.ctx) {
      void this.ctx.close().catch(() => {})
      this.ctx = null
    }
  }

  private stopSource(): void {
    const src = this.source
    this.source = null
    if (!src) return
    try {
      src.stop()
    } catch {
      // 已经自然结束的源再 stop 会抛；忽略
    }
    src.disconnect()
  }
}
