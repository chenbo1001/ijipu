/**
 * export/video/cliWorker.ts — 命令行导出视频的**隐藏窗口侧**（adj1084）
 *
 * 调用链（为什么长这样）：
 *   `ijipu cli render -t mp4 …`（内嵌 CLI，跑在 QuickJS 里，没有 WebCodecs）
 *     → Rust 宿主起一个**隐藏窗口**的子进程（`src-tauri/src/cli_video.rs`）
 *     → 本文件在 WebView2 里跑：取任务 → 与应用**同一份** `exportDynamicVideo` 出片
 *     → 分块把 MP4 写回 Rust（大文件不走一行一条 JSON 的管道）→ 回报结果 → 进程退出。
 *
 * 为什么任务从 Rust 读、而不是从命令行参数读：`.jps` 源码可能有几万行，
 * 走命令行会撞 Windows 的 32K 参数上限；写成临时文件再让窗口读，稳。
 */
import type { PageConfig } from '@ijipu/engine'
import { tauriCore } from '../../brand/env'
import { exportDynamicVideo } from './exportDynamic'
import { cardStyleById } from './cardTemplates'
import type { DynamicSession } from './renderer'
import { renderToAudioBuffer } from '../audio'
import { createHqCache, resolveHqBank } from '../../playback/spessaCache'
import { resolveActiveLibrary } from '../../playback/spessaSynthBackend'
import { useUiStore } from '../../store/uiStore'
import { hostBankUrl } from '../../store/hostBridge'

/** Rust 侧写的任务文件形状（与 `cli.ts` 的 `io.encodeVideo` 请求一一对应） */
export interface CliVideoJob {
  source: string
  pageConfig: PageConfig
  startId: string | null
  endId: string | null
  pass: number | null
  output: string
  aspect: '9x16' | '1x1' | '16x9'
  mode: 'full' | '3min'
  /** 片头/片尾模板（CLI 已校验过，只会是这四个之一） */
  cardStyleId: 'brand' | 'paper' | 'ink' | 'minimal'
}

/**
 * 音轨：与界面预览/导出**同一套** HQ 音源（`resolveActiveLibrary` 选库 → `resolveHqBank` 取包 →
 * `renderToAudioBuffer` 离线渲染）。取不到就抛，由 `exportDynamicVideo` 退成无声片。
 */
async function makeAudio(session: DynamicSession): Promise<AudioBuffer> {
  const lib = resolveActiveLibrary(useUiStore.getState().playbackHqLibrary).lib
  const { bank } = await resolveHqBank(lib, createHqCache(), hostBankUrl(lib.id))
  return renderToAudioBuffer(session.events, bank, { bpm: session.bpm })
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * 调 Rust 命令（**不引 `@tauri-apps/api`**：本仓一直只经 `window.__TAURI__.core`，
 * 那是 `withGlobalTauri: true` 注入的；新增一个 npm 依赖要走 AGENTS 的"先询问"）。
 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = tauriCore()?.invoke
  if (fn === undefined) throw new Error('当前环境没有 Tauri 通道（不是桌面壳）')
  return (await fn(cmd, args)) as T
}

/** 分块 base64（4 MB 一段；一次性 `btoa` 几百 MB 会先把字符串堆爆） */
function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : B64[b2 & 63]
  }
  return out
}

/** 写盘分块（4 MB 原始字节 → 约 5.3 MB 的 base64 串） */
const WRITE_CHUNK = 4 * 1024 * 1024

/**
 * 跑一次命令行视频任务。
 *
 * @returns `true` = 本进程**就是**命令行起的出片窗口（跑完会自己退出）；
 *          `false` = 正常启动（不是命令行的窗口，调用方照常渲染界面）。
 */
export async function runCliVideoJob(raw: string | null = null): Promise<boolean> {
  const jobText = raw ?? (await invoke<string | null>('cli_video_job'))
  if (jobText === null || jobText === '') return false
  /**
   * 第一件事就报个到（`p = -1`）：父进程据此知道"出片窗口的 JS 真的跑起来了"。
   * 没有这一步的话，页面没加载/动态 import 失败时父进程只能干等到超时，且看不出卡在哪。
   */
  await invoke('cli_video_progress', { p: -1, phase: '出片窗口已就绪' })
  let job: CliVideoJob
  try {
    job = JSON.parse(jobText) as CliVideoJob
  } catch (e) {
    await invoke('cli_video_result', { ok: false, bytes: 0, audio: false, message: `任务文件不是合法 JSON：${String(e)}` })
    return true
  }
  try {
    /**
     * 进度转给父进程（终端里逐行显示）。**按 1% / 阶段变化**节流：
     * 30fps 编码时 `encodeMp4` 会回调上千次，每次都跨 IPC 会拖慢编码本身。
     */
    let lastPct = -1
    let lastPhase = ''
    const onProgress = (p: number, phase: string): void => {
      const pct = Math.floor(p * 100)
      if (pct === lastPct && phase === lastPhase) return
      lastPct = pct
      lastPhase = phase
      void invoke('cli_video_progress', { p, phase }).catch(() => {
        /* 进度丢一条不影响出片 */
      })
    }
    const res = await exportDynamicVideo({
      code: job.source,
      pageConfig: job.pageConfig,
      aspect: job.aspect,
      mode: job.mode,
      cardStyle: cardStyleById(job.cardStyleId),
      // adj1089：命令行出片跟随**本机**的平移方式（只读偏好，不写配置；与预览/界面导出同一份）
      panMode: useUiStore.getState().panMode,
      // adj1094：行末提前平移量同样跟随本机偏好
      rowLeadBeats: useUiStore.getState().rowLeadBeats,
      range:
        job.startId === null || job.endId === null
          ? null
          : // pass 为 null 时不要写这个字段（`undefined` = 解析器默认候选）
            { startId: job.startId, endId: job.endId, ...(job.pass === null ? {} : { pass: job.pass }) },
      makeAudio,
      onProgress,
    })
    const bytes = new Uint8Array(await res.blob.arrayBuffer())
    for (let off = 0; off < bytes.length; off += WRITE_CHUNK) {
      const chunk = bytes.subarray(off, Math.min(off + WRITE_CHUNK, bytes.length))
      await invoke('cli_video_write', {
        path: job.output,
        b64: toBase64(chunk),
        // 第一段覆盖、后续追加（避免"先清空再写"时中途失败留下 0 字节文件）
        append: off > 0,
      })
    }
    await invoke('cli_video_result', { ok: true, bytes: bytes.length, audio: res.audio, message: '' })
  } catch (e) {
    await invoke('cli_video_result', {
      ok: false,
      bytes: 0,
      audio: false,
      message: e instanceof Error ? e.message : String(e),
    })
  }
  return true
}
