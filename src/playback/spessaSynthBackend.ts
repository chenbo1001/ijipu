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
import { pitchToMidiNote, instrumentToProgram, matchInstrument } from '@ijipu/engine'
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

/** GM 音色全集（program 0-127，中文名）——SpessaSynth 模式可全局指定音色（adj330/adj332） */
export const GM_VOICE_OPTIONS: { program: number; label: string }[] = [
  // 0-7 钢琴
  { program: 0, label: '0 大钢琴' }, { program: 1, label: '1 亮音钢琴' }, { program: 2, label: '2 电钢琴' }, { program: 3, label: '3 酒吧钢琴' },
  { program: 4, label: '4 电钢琴1' }, { program: 5, label: '5 电钢琴2' }, { program: 6, label: '6 拨弦古钢琴' }, { program: 7, label: '7 击弦古钢琴' },
  // 8-15 色彩打击
  { program: 8, label: '8 钟琴' }, { program: 9, label: '9 钢片琴' }, { program: 10, label: '10 八音盒' }, { program: 11, label: '11 颤音琴' },
  { program: 12, label: '12 马林巴' }, { program: 13, label: '13 木琴' }, { program: 14, label: '14 管钟' }, { program: 15, label: '15 杜西玛琴' },
  // 16-23 风琴
  { program: 16, label: '16 拉杆风琴' }, { program: 17, label: '17 打击风琴' }, { program: 18, label: '18 摇滚风琴' }, { program: 19, label: '19 教堂风琴' },
  { program: 20, label: '20 簧风琴' }, { program: 21, label: '21 手风琴' }, { program: 22, label: '22 口琴' }, { program: 23, label: '23 探戈手风琴' },
  // 24-31 吉他
  { program: 24, label: '24 民谣吉他' }, { program: 25, label: '25 电吉他(清音)' }, { program: 26, label: '26 电吉他(闷音)' }, { program: 27, label: '27 电吉他(过载)' },
  { program: 28, label: '28 电吉他(失真)' }, { program: 29, label: '29 电吉他(泛音)' }, { program: 30, label: '30 中音吉他' }, { program: 31, label: '31 爵士吉他' },
  // 32-39 贝斯
  { program: 32, label: '32 声学贝斯' }, { program: 33, label: '33 电贝斯(指弹)' }, { program: 34, label: '34 电贝斯(拨片)' }, { program: 35, label: '35 无品贝斯' },
  { program: 36, label: '36 击弦倍低音' }, { program: 37, label: '37 闷音电贝斯' }, { program: 38, label: '38 电贝斯1' }, { program: 39, label: '39 电贝斯2' },
  // 40-47 弦乐
  { program: 40, label: '40 小提琴' }, { program: 41, label: '41 中提琴' }, { program: 42, label: '42 大提琴' }, { program: 43, label: '43 低音提琴' },
  { program: 44, label: '44 拨奏弦乐' }, { program: 45, label: '45 竖琴' }, { program: 46, label: '46 定音鼓' }, { program: 47, label: '47 弦乐合奏' },
  // 48-55 合奏/合唱
  { program: 48, label: '48 弦乐合奏1' }, { program: 49, label: '49 弦乐合奏2' }, { program: 50, label: '50 合成弦乐1' }, { program: 51, label: '51 合成弦乐2' },
  { program: 52, label: '52 合唱啊音' }, { program: 53, label: '53 人声"哦"音' }, { program: 54, label: '54 合成人声' }, { program: 55, label: '55 管弦打击' },
  // 56-63 铜管
  { program: 56, label: '56 小号' }, { program: 57, label: '57 长号' }, { program: 58, label: '58 大号' }, { program: 59, label: '59 闷音小号' },
  { program: 60, label: '60 法国号' }, { program: 61, label: '61 铜管组' }, { program: 62, label: '62 合成铜管1' }, { program: 63, label: '63 合成铜管2' },
  // 64-71 簧片
  { program: 64, label: '64 高音萨克斯' }, { program: 65, label: '65 中音萨克斯' }, { program: 66, label: '66 次中音萨克斯' }, { program: 67, label: '67 上低音萨克斯' },
  { program: 68, label: '68 双簧管' }, { program: 69, label: '69 英国号' }, { program: 70, label: '70 巴松管' }, { program: 71, label: '71 单簧管' },
  // 72-79 管乐
  { program: 72, label: '72 短笛' }, { program: 73, label: '73 长笛' }, { program: 74, label: '74 泛音笛' }, { program: 75, label: '75 竖笛' },
  { program: 76, label: '76 巴乌笛' }, { program: 77, label: '77 尺八' }, { program: 78, label: '78 民族笛' }, { program: 79, label: '79 哨笛' },
  // 80-87 合成主音
  { program: 80, label: '80 排箫' }, { program: 81, label: '81 吹瓶声' }, { program: 82, label: '82 口哨' }, { program: 83, label: '83 民族排箫' },
  { program: 84, label: '84 尺八(合成)' }, { program: 85, label: '85 合成主音1' }, { program: 86, label: '86 合成主音2' }, { program: 87, label: '87 合成主音3' },
  // 88-95 合成垫音
  { program: 88, label: '88 合成垫音1' }, { program: 89, label: '89 合成垫音2' }, { program: 90, label: '90 合成垫音3' }, { program: 91, label: '91 合成垫音4' },
  { program: 92, label: '92 合成垫音5' }, { program: 93, label: '93 合成垫音6' }, { program: 94, label: '94 合成垫音7' }, { program: 95, label: '95 合成垫音8' },
  // 96-103 合成效果
  { program: 96, label: '96 合成雨声' }, { program: 97, label: '97 合成音轨' }, { program: 98, label: '98 合成水晶音' }, { program: 99, label: '99 合成氛围声' },
  { program: 100, label: '100 合成明亮音' }, { program: 101, label: '101 合成妖精声' }, { program: 102, label: '102 合成回声' }, { program: 103, label: '103 合成科幻声' },
  // 104-111 民族乐器
  { program: 104, label: '104 西塔尔琴' }, { program: 105, label: '105 班卓琴' }, { program: 106, label: '106 三味线' }, { program: 107, label: '107 十三弦琴' },
  { program: 108, label: '108 卡林巴' }, { program: 109, label: '109 风笛' }, { program: 110, label: '110 民族琴' }, { program: 111, label: '111 印尼锣' },
  // 112-119 打击乐器
  { program: 112, label: '112 锡塔尔' }, { program: 113, label: '113 钢鼓' }, { program: 114, label: '114 木鱼' }, { program: 115, label: '115 陶鼓' },
  { program: 116, label: '116 民族鼓' }, { program: 117, label: '117 合成鼓' }, { program: 118, label: '118 合成镲' }, { program: 119, label: '119 民族打击' },
  // 120-127 音效
  { program: 120, label: '120 吉他滑音' }, { program: 121, label: '121 呼吸声' }, { program: 122, label: '122 海浪声' }, { program: 123, label: '123 鸟鸣声' },
  { program: 124, label: '124 电话铃' }, { program: 125, label: '125 直升机' }, { program: 126, label: '126 拍手声' }, { program: 127, label: '127 枪声' },
]

/** 是否运行在 Tauri 桌面环境（window.__TAURI__ 由 withGlobalTauri 注入） */
export function detectTauri(): boolean {
  try {
    return typeof (window as unknown as { __TAURI__?: { core?: { invoke?: unknown } } }).__TAURI__?.core?.invoke === 'function'
  } catch {
    return false
  }
}

/** 通过 Rust command 读内置音源资源（打包进桌面的 SF2，离线可用）为 ArrayBuffer */
async function invokeResource(libId: string): Promise<ArrayBuffer> {
  const inv = (window as unknown as { __TAURI__?: { core?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__?.core?.invoke
  if (typeof inv !== 'function') throw new Error('Tauri invoke 不可用')
  const buf = (await inv('sf_soundfont_resource_read', { libId })) as ArrayBuffer | Uint8Array | number[]
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return new Uint8Array(buf).buffer
}

/** 下载音源库（SF2/SF3/DLS）为 ArrayBuffer（adj346）：桌面（Tauri）读内置打包资源（离线）；
 *  Web 从远端 source 下载；失败回退 fallbackSource。 */
export async function loadHqBank(lib: HqSampleLibrary): Promise<ArrayBuffer> {
  // 桌面（Tauri）离线优先：读 bundle.resources 打包的 SF2；异常（未打包/dev）回退联网
  if (detectTauri()) {
    try {
      return await invokeResource(lib.id)
    } catch {
      /* 资源缺失/非打包环境 → 走远端下载 */
    }
  }
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

/** 乐器 id → MIDI channel（0-15）：多声部同时演奏时避免 program 冲突 */
const CHANNEL_OF: Record<string, number> = {
  piano: 0, organ: 1, strings: 2, flute: 3, brass: 4, musicbox: 5,
}
const channelOf = (instrument?: string) => CHANNEL_OF[matchInstrument(instrument)] ?? 0

export class SpessaSynthBackend implements AudioBackend {
  readonly kind = 'sampler' as const
  /** adj328：特征标记——UI 用其区分于 midi-js 采样后端（kind 相同，需额外标志） */
  readonly hq = true
  state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
  /** adj330：全局乐器覆盖（GM program；null=按声部名自动路由） */
  private voiceOverride: number | null = null
  private ctx: AudioContext | null = null
  private synth: WorkletSynthesizer | null = null
  /** 已设 program 的 channel（避免重复 programChange） */
  private programSet = new Set<number>()
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
  play(pitch: string | null, atMs: number, durationMs: number, gain: number, instrument?: string): void {
    const synth = this.synth
    if (!pitch || !synth || this.state !== 'ready') {
      if (!synth) console.warn('[SpessaSynth] play before ready (ignored)')
      return
    }
    const note = pitchToMidiNote(pitch)
    const ch = channelOf(instrument)
    // adj330：用户选定的全局音色覆盖优先，否则按声部名自动路由
    const program = this.voiceOverride ?? instrumentToProgram(instrument)
    const key = ch * 128 + program
    const velocity = Math.max(1, Math.min(127, Math.round(127 * gain)))
    const delay = Math.max(0, atMs)
    const onFn = () => {
      if (!this.programSet.has(key)) {
        synth.programChange(ch, program)
        this.programSet.add(key)
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
    this.programSet.clear()
  }

  dispose(): void {
    this.stop()
    this.synth?.disconnect()
    this.synth = null
    if (this.ctx) {
      void this.ctx.close().catch(() => {})
      this.ctx = null
    }
  }
}
