/**
 * src/playback/spessaSynthBackend.ts — 高质量采样后端（spessasynth_lib，adj328）
 *
 * 用 spessasynth_lib 的 WorkletSynthesizer（AudioWorklet 合成器，独立线程）播放
 * SF2/SF3/DLS 音源。拟真度显著高于 midi-js-soundfonts（单层 mp3）：
 *  - 多力度层 / 循环采样 / 释放采样 / 混响（由音源库决定）
 *  - SF2/SF3 为 GM 编曲，一套库覆盖多种乐器（按 GM program 路由，engine.instrumentToProgram）
 *
 * 调度：用 setTimeout 按 atMs 触发 noteOn/noteOff（规避 AudioWorklet 内 { time }
 * 时间基与主线程 ctx.currentTime 不一致导致音符排错/忽略的静音问题），多声部按
 * 乐器分配不同 channel 使不同乐器可同时发声。
 * 说明：本模块属浏览器层（AudioWorklet/WebAudio），不放入零 DOM 的 engine。
 */
import type { AudioBackend } from '@ijipu/engine'
import { pitchToMidiNote, instrumentToProgram, GmChannelAllocator, GM_VOICES, gmVoiceRef } from '@ijipu/engine'
import type { GmVoice } from '@ijipu/engine'
import type { WorkletSynthesizer } from 'spessasynth_lib'

/** worklet processor 文件（已拷贝到 public/spessasynth/，经 BASE_URL 定位） */
const WORKLET_URL = `${import.meta.env.BASE_URL}spessasynth/spessasynth_processor.min.js`

/** 高质量采样音源库（SpessaSynth 用 SF2/SF3/DLS，GM 编曲覆盖多种乐器） */
export interface HqSampleLibrary {
  id: string
  name: string
  source: string
  /** fallbackSource：本地内置缺失时回退的联网直链（可选） */
  fallbackSource?: string
  sizeBytes: number
  format: 'sf2' | 'sf3' | 'dls'
}
/** adj330/341/346：可切换的高质量音源库列表。默认库已内置（桌面打包资源 / Web 远端加载）。
 *  加库只需追加一条元数据。 */
export const HQ_LIBRARIES: HqSampleLibrary[] = [
  {
    id: 'generaluser_gs',
    name: '通用音源（GeneralUser GS）',
    // adj346：SF2 不打包进 Web 产物（规避 Cloudflare Pages 单文件 25MB 限制），改为远端加载：
    //   Web 源用 GitHub raw；有 Cloudflare R2 公开桶时把 `source` 换成 R2 公开 URL（更快更稳）。
    //   桌面（Tauri）离线由 loadHqBank 读内置打包资源，不走此 source。
    source: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2',
    fallbackSource: '',
    sizeBytes: 32_319_396,
    format: 'sf2',
  },
]
/** 按 id 查音源库（找不到回退默认第一个） */
export function getHqLibrary(id?: string | null): HqSampleLibrary {
  if (id) {
    const f = HQ_LIBRARIES.find((l) => l.id === id)
    if (f) return f
  }
  return HQ_LIBRARIES[0]
}

/**
 * GM 音色全集（program 0-127，中文名）——SpessaSynth 模式可全局指定音色（adj330/adj332）。
 *
 * adj447：表已收敛到 engine 的 `GM_VOICES`（**唯一来源**）——同一个表同时供
 * ① 设置里勾选音色 ② 选中音色还原成音色名（`firstEnabledInstrumentRef`）
 * ③ 谱面 `Y:` / `@乐器名@` 的名称解析（`instrumentToProgram`）使用；
 * 此前 app 与 engine 各存一份，用户在列表里看到的名称写进 `Y:` 多半解析不出本音色。
 */
export const GM_VOICE_OPTIONS: GmVoice[] = GM_VOICES

/** Tauri invoke 函数签名（window.__TAURI__.core.invoke） */
type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

/** 取 Tauri invoke（非桌面环境返回 undefined） */
function tauriInvoke(): TauriInvoke | undefined {
  try {
    const inv = (window as unknown as { __TAURI__?: { core?: { invoke?: TauriInvoke } } }).__TAURI__?.core?.invoke
    return typeof inv === 'function' ? inv : undefined
  } catch {
    return undefined
  }
}

/** 是否运行在 Tauri 桌面环境（window.__TAURI__ 由 withGlobalTauri 注入） */
export function detectTauri(): boolean {
  return tauriInvoke() !== undefined
}

/**
 * adj416：内置音源文件路径——发布程序把 `generaluser_gs.sf2` 放在**安装目录**（Rust 侧查找
 * 「安装目录根 → soundfonts/ 子目录」），返回命中的绝对路径；非桌面环境或未随包提供返回 null。
 * 前端据此在下载**之前**判定「已随包内置」→ 直接读文件，不显示下载提示。
 */
export async function builtinBankPath(libId: string): Promise<string | null> {
  const inv = tauriInvoke()
  if (!inv) return null
  try {
    const p = await inv('sf_soundfont_builtin_path', { libId })
    return typeof p === 'string' && p.length > 0 ? p : null
  } catch {
    return null
  }
}

/** adj416：是否随安装包内置音源（安装目录存在该 SF2）→ 直接使用，无需下载 */
export async function hasBuiltinBank(lib: HqSampleLibrary): Promise<boolean> {
  return (await builtinBankPath(lib.id)) !== null
}

/** 通过 Rust command 读内置音源资源（打包进桌面的 SF2，离线可用）为 ArrayBuffer。
 *  adj416：Rust 侧返回 raw body → 前端直接拿到 ArrayBuffer（30MB 不走 JSON 数组）。 */
async function invokeResource(libId: string): Promise<ArrayBuffer> {
  const inv = tauriInvoke()
  if (!inv) throw new Error('Tauri invoke 不可用')
  const buf = (await inv('sf_soundfont_resource_read', { libId })) as ArrayBuffer | Uint8Array | number[]
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return new Uint8Array(buf).buffer
}

/** adj416：读桌面内置音源字节（安装目录随包提供的 SF2）；未随包提供/读失败返回 null。
 *  仅供「内置优先」的解析用——远端下载走 loadHqBank。 */
export async function loadBuiltinBank(lib: HqSampleLibrary): Promise<ArrayBuffer | null> {
  if (!(await hasBuiltinBank(lib))) return null
  try {
    return await invokeResource(lib.id)
  } catch {
    // 文件在但读失败（权限/损坏）→ 同样回退远端，不阻断试听
    return null
  }
}

/** 加载音源库（SF2/SF3/DLS）为 ArrayBuffer（adj346/adj416）：桌面优先读**安装目录内置资源**
 *  （离线、直接使用）；否则 Web/Tauri 均从远端 source 下载，失败回退 fallbackSource。 */
export async function loadHqBank(lib: HqSampleLibrary): Promise<ArrayBuffer> {
  const builtin = await loadBuiltinBank(lib)
  if (builtin) return builtin
  try {
    const res = await fetch(lib.source)
    if (res.ok) return await res.arrayBuffer()
  } catch {
    /* 下载失败 → 走 fallback */
  }
  if (lib.fallbackSource) {
    const res = await fetch(lib.fallbackSource)
    if (res.ok) return await res.arrayBuffer()
  }
  throw new Error(`音源「${lib.name}」加载失败`)
}

/**
 * adj354：@@ 恢复默认音色的「第一音色」——试听/导出音色列表第一个启用音色的 GM 音色名。
 * 由启用集合（playbackHqEnabled，program 列表）取最小 program，经引擎 `gmVoiceRef` 还原成音色名 ref
 * （剥掉显示编号），作为 buildPlaySequence / layoutScore 的 defaultInstrumentRef；
 * 启用集合为空返回 undefined（引擎回退第一音色库第一音色）。
 */
export function firstEnabledInstrumentRef(enabled: number[]): string | undefined {
  if (enabled.length === 0) return undefined
  // adj455：program → 音色名 ref 的逆映射收敛在引擎（gmVoiceRef），此处不再自己拼 label
  return gmVoiceRef(Math.min(...enabled))
}

/**
 * adj446：**一个音色独占一个 MIDI 通道**（原按「乐器族」映射——钢琴族/弦乐族/长笛族…）。
 *
 * 旧实现在同族两个音色（钢琴+电钢琴、小提琴+大提琴、长笛+竖笛…）时会把它们挤到同一通道：
 * MIDI 通道同时只能有一个 program，后设的音色把先前声部一起改掉，且 `programSet` 又让先设过的
 * program 不再补发 ⇒ 多声部实际只响**一种**音色（用户报「多个 Y: 音色只用了第一个」）。
 * 分配逻辑收敛在 engine 的 `GmChannelAllocator`（纯函数、有 smoke 断言）。
 */
export class SpessaSynthBackend implements AudioBackend {
  readonly kind = 'sampler' as const
  /** adj328：特征标记——UI 用其区分于 midi-js 采样后端（kind 相同，需额外标志） */
  readonly hq = true
  state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
  /** adj330：全局乐器覆盖（GM program；null=按声部名自动路由） */
  private voiceOverride: number | null = null
  private ctx: AudioContext | null = null
  private synth: WorkletSynthesizer | null = null
  /** adj446：音色 → 独占通道 分配（见 GmChannelAllocator） */
  private channels = new GmChannelAllocator()
  /** adj446：各通道**当前已设**的 program（键=通道）——按触发时刻维护，避免重复 programChange */
  private channelProgram = new Map<number, number>()
  /** 待触发的调度定时器（setTimeout）——stop 时统一清理 */
  private timers = new Set<number>()

  async ready(): Promise<void> {
    if (!(await this.ensureCtx())) throw new Error('AudioContext 不可用')
  }

  /** adj330：设置全局乐器覆盖（GM program；null=按声部名自动路由） */
  setVoice(program: number | null): void {
    this.voiceOverride = program
  }

  private async ensureCtx(): Promise<AudioContext | null> {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
      } catch {
        return null
      }
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume()
      } catch {
        return null
      }
    }
    return this.ctx
  }

  /** 加载音源：注册 worklet → 加载 SoundBank（SF2/SF3/DLS ArrayBuffer）→ 等 isReady */
  async load(bank?: ArrayBuffer, workletUrl: string = WORKLET_URL): Promise<void> {
    if (this.state === 'ready' || this.state === 'loading') return
    this.state = 'loading'
    try {
      const ctx = await this.ensureCtx()
      if (!ctx) throw new Error('AudioContext 不可用')
      if (!this.synth) {
        // adj349：动态加载 spessasynth_lib（体积较大）——首屏不打包，试听时才按需加载，加快启动
        const { WorkletSynthesizer } = await import('spessasynth_lib')
        await ctx.audioWorklet.addModule(workletUrl)
        const synth = new WorkletSynthesizer(ctx)
        if (bank) {
          await synth.soundBankManager.addSoundBank(bank, 'main')
          console.info('[SpessaSynth] soundbank loaded')
        }
        // adj329：必须把合成器输出连到目标——WorkletSynthesizer 不会自动连 destination，
        // 否则 noteOn 触发但无声（README 示例省略了 connect）
        synth.connect(ctx.destination)
        this.synth = synth
      }
      await (this.synth as unknown as { isReady: Promise<unknown> }).isReady
      this.state = 'ready'
      console.info('[SpessaSynth] ready')
    } catch (e) {
      this.state = 'failed'
      console.error('[SpessaSynth] load failed', e)
      throw e
    }
  }

  /** 播放一个音：setTimeout 调度（规避 worklet {time} 时间语义，更可靠） */
  play(pitch: string | null, atMs: number, durationMs: number, gain: number, instrument?: string, _t0?: number, opts?: { keepInstrument?: boolean }): void {
    const synth = this.synth
    if (!pitch || !synth || this.state !== 'ready') {
      if (!synth) console.warn('[SpessaSynth] play before ready (ignored)')
      return
    }
    const note = pitchToMidiNote(pitch)
    // adj330：用户选定的全局音色覆盖优先，否则按声部名自动路由
    // adj427：**伴奏/第二声部**（`opts.keepInstrument`）保留自己的音色——否则全局覆盖会把
    //   重叠区的两个声部压成同一种音色（用户报「两个声部的音色没有区分」）。
    const program = opts?.keepInstrument ? instrumentToProgram(instrument) : (this.voiceOverride ?? instrumentToProgram(instrument))
    // adj446：按**音色**分配独占通道（不再按乐器族）——同族两个音色各占一个通道，互不覆盖
    const ch = this.channels.channelFor(program)
    const velocity = Math.max(1, Math.min(127, Math.round(127 * gain)))
    const delay = Math.max(0, atMs)
    const onFn = () => {
      // adj446：在**触发时刻**核对「本通道当前音色」——独占通道时只发一次；
      // 通道被复用（同时 >15 种音色）时逐音补发，保证每个音都以自己的音色发声。
      // 原实现用「(通道,音色) 是否发过」的集合判定：通道被同族另一音色占用后，
      // 本音色的 program 永不再补发 ⇒ 整段用错音色。
      if (this.channelProgram.get(ch) !== program) {
        synth.programChange(ch, program)
        this.channelProgram.set(ch, program)
      }
      synth.noteOn(ch, note, velocity)
    }
    const offFn = () => synth.noteOff(ch, note)
    this.timers.add(window.setTimeout(onFn, delay))
    this.timers.add(window.setTimeout(offFn, delay + Math.max(100, durationMs)))
  }

  stop(): void {
    for (const t of this.timers) window.clearTimeout(t)
    this.timers.clear()
    this.synth?.stopAll(true)
    // adj446：`stopAll(true)` 会重置合成器状态 ⇒ 已设 program 的记录必须一起清掉，
    // 否则下次播放会跳过 programChange、以重置后的默认音色（钢琴）演奏。
    this.channelProgram.clear()
  }

  dispose(): void {
    this.stop()
    this.channels.reset()
    this.synth?.disconnect()
    this.synth = null
    if (this.ctx) {
      void this.ctx.close().catch(() => {})
      this.ctx = null
    }
  }
}
