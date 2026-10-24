/**
 * export/video/syncDoc.ts — 「对拍边车文件」的读写与校验（`赤伶.jps.sync.json`）
 *
 * 用户口径（2026-10-24 拍板）：
 *  · `.jps` **自成一体**（显示/打印/播放/出片都靠它）；伴奏对拍只是**附加** ⇒ 存 sidecar，
 *    与 `.jps` 同目录、文件名 = 原名 + `.sync.json`（不造新扩展名）；
 *  · 伴奏只记**文件名**（"伴奏一般随谱文件"）；不在同目录时记绝对路径；
 *  · `anchors` 是用户打的**原始输入**（含 `locked`）；`tempo`/`segments` 是**解算结果**，
 *    每次保存都重算（机读，不要手改）；
 *  · 谱面 `J:` 一个字不改（sidecar 只提供对齐基准）。
 *
 * 为什么这一层要单独抽：对拍台（写）、相机位（读）、`exportDynamicVideo`（读）、
 * 以后的 CLI `--sync`（读）**必须用同一套解析规则**——容错、版本、夹紧都在这里定义一次，
 * 不许各处 `JSON.parse` 一把梭。
 *
 * 纯函数（无 DOM、无 node:path）：路径拼接是手写的字符串运算，因为渲染进程里没有 `node:path`，
 * 而 Windows 的 `\` 与 `/` 都要认。
 */
import { fitSync, bpmOfFit } from '@ijipu/engine'
import type { SyncAnchor, SyncSegmentStat, SyncTrim } from '@ijipu/engine'

/** sidecar 后缀：`赤伶.jps` → `赤伶.jps.sync.json` */
export const SYNC_SUFFIX = '.sync.json'

/** 当前格式版本（读到更高的版本 ⇒ 明确报错，不做"猜着读"） */
export const SYNC_VERSION = 1

/** 声音来源与两条音量（"这首歌用伴奏还是合成音"是**这首歌**的决定 ⇒ 存 sidecar） */
export interface SyncMix {
  source: 'file' | 'synth' | 'mix'
  /** 伴奏音量（0~2，缺省 1） */
  accomp: number
  /** 合成音音量（0~2，缺省 0.5） */
  synth: number
}

export interface SyncDoc {
  version: number
  /** 伴奏文件名（相对 `.jps` 所在目录）或绝对路径 */
  audio: string
  audioDurationMs: number
  /** 掐头去尾（文件绝对毫秒） */
  trim: SyncTrim
  /** 用户打的锚点（原始输入） */
  anchors: SyncAnchor[]
  /** 解算结果（anchors < 2 时为 null） */
  tempo: { beatMs: number; offsetMs: number; bpm: number } | null
  /** 段诊断（相邻两锚点；只显示，不参与时间轴） */
  segments: SyncSegmentStat[]
  /** 手选的伴奏调性（只做提示） */
  key?: string
  mix: SyncMix
  /** 存盘时谱面的 FNV-1a 指纹（改了谱 ⇒ 提示"锚点请复核"） */
  codeHash: string
  updatedAt: string
}

/** 默认声音设置 */
export const DEFAULT_SYNC_MIX: SyncMix = { source: 'file', accomp: 1, synth: 0.5 }

/** `赤伶.jps` → `赤伶.jps.sync.json` */
export function sidecarPathOf(jpsPath: string): string {
  return `${jpsPath}${SYNC_SUFFIX}`
}

/** 这个路径是不是 sidecar（给"打开文件"过滤用） */
export function isSidecarPath(path: string): boolean {
  return path.toLowerCase().endsWith(SYNC_SUFFIX)
}

/** 目录部分（末尾无分隔符；`C:\a\b.jps` → `C:\a`；没有目录 → ''） */
export function dirNameOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return i < 0 ? '' : path.slice(0, i)
}

/** 是否绝对路径（Windows 盘符 / UNC / Unix 根） */
export function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\/.test(path) || path.startsWith('/')
}

/** 拼接（自动识别两边已有的分隔符；`name` 为绝对路径时直接返回它） */
export function joinPath(dir: string, name: string): string {
  if (isAbsolutePath(name)) return name
  if (dir === '') return name
  const sep = dir.includes('\\') ? '\\' : '/'
  const left = dir.endsWith('\\') || dir.endsWith('/') ? dir.slice(0, -1) : dir
  const right = name.startsWith('\\') || name.startsWith('/') ? name.slice(1) : name
  return `${left}${sep}${right}`
}

/** 伴奏的完整路径：绝对路径原样，相对路径拼到 `.jps` 所在目录 */
export function resolveAudioPath(jpsPath: string, audio: string): string {
  return joinPath(dirNameOf(jpsPath), audio)
}

/** FNV-1a 32 位（与 `diff/textDiff` 同一族；这里只给 sidecar 做"谱面改过没"的指纹） */
export function codeFingerprint(code: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const clampGain = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(2, Math.max(0, n))
}

const finiteOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/**
 * 解析 sidecar 文本。
 *
 * **容错原则**：能救的救（缺字段给默认、锚点排序、夹紧裁剪区间），不能救的明确报错
 * （JSON 坏了 / 版本更高 / 没有 `audio` / 锚点不足 2 条只警告不报错——用户可能还没打完）。
 *
 * `tempo`/`segments` **一律重算**（不信文件里的解算结果：手改过 `anchors` 后就该刷新）。
 */
export function parseSyncDoc(text: string): { doc: SyncDoc | null; error?: string; warnings?: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { doc: null, error: '对拍文件不是合法 JSON' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { doc: null, error: '对拍文件的内容不是对象' }
  }
  const o = raw as Record<string, unknown>
  const version = finiteOr(o.version, SYNC_VERSION)
  if (version > SYNC_VERSION) {
    return { doc: null, error: `对拍文件是更新版本（v${version}）生成的，请升级应用` }
  }
  const audio = typeof o.audio === 'string' ? o.audio.trim() : ''
  if (audio === '') return { doc: null, error: '对拍文件里没有记伴奏文件名（audio）' }

  const warnings: string[] = []
  const audioDurationMs = Math.max(0, finiteOr(o.audioDurationMs, 0))
  const trimRaw = (o.trim ?? {}) as Record<string, unknown>
  let startMs = Math.max(0, finiteOr(trimRaw.startMs, 0))
  let endMs = finiteOr(trimRaw.endMs, audioDurationMs > 0 ? audioDurationMs : Number.POSITIVE_INFINITY)
  if (audioDurationMs > 0) endMs = Math.min(endMs, audioDurationMs)
  if (endMs <= startMs) {
    warnings.push('裁剪区间无效（结束不晚于开始），已按"不裁剪"处理')
    startMs = 0
    endMs = audioDurationMs > 0 ? audioDurationMs : Number.POSITIVE_INFINITY
  }
  const trim: SyncTrim = { startMs, endMs }

  const anchorsRaw = Array.isArray(o.anchors) ? o.anchors : []
  const anchors: SyncAnchor[] = []
  for (const a of anchorsRaw) {
    if (a === null || typeof a !== 'object') continue
    const r = a as Record<string, unknown>
    const beat = finiteOr(r.beat, Number.NaN)
    const audioMs = finiteOr(r.audioMs, Number.NaN)
    if (!Number.isFinite(beat) || !Number.isFinite(audioMs)) continue
    anchors.push({ beat, audioMs, ...(r.locked === true ? { locked: true } : {}) })
  }
  anchors.sort((a, b) => a.beat - b.beat)
  // 同拍位重复：保留第一条（后面那条没有意义，也不该让 fitSync 返回 null 把整份文件变成"不可用"）
  const uniq: SyncAnchor[] = []
  for (const a of anchors) {
    if (uniq.length > 0 && Math.abs(a.beat - uniq[uniq.length - 1].beat) < 1e-9) {
      warnings.push(`有两条锚点落在同一拍（${a.beat}），已忽略后一条`)
      continue
    }
    uniq.push(a)
  }
  if (uniq.length < 2) warnings.push('锚点不足 2 条：还没法定速度（只调偏移）')

  const fit = fitSync(uniq)
  const tempo = fit === null ? null : {
    beatMs: fit.beatMs,
    offsetMs: fit.offsetMs,
    bpm: bpmOfFit(fit),
  }

  const mixRaw = (o.mix ?? {}) as Record<string, unknown>
  const source = mixRaw.source === 'synth' || mixRaw.source === 'mix' ? mixRaw.source : 'file'
  const mix: SyncMix = {
    source,
    accomp: clampGain(mixRaw.accomp, DEFAULT_SYNC_MIX.accomp),
    synth: clampGain(mixRaw.synth, DEFAULT_SYNC_MIX.synth),
  }

  const key = typeof o.key === 'string' && o.key.trim() !== '' ? o.key.trim() : undefined
  const doc: SyncDoc = {
    version: SYNC_VERSION,
    audio,
    audioDurationMs,
    trim,
    anchors: uniq,
    tempo,
    segments: fit?.segments ?? [],
    ...(key !== undefined ? { key } : {}),
    mix,
    codeHash: typeof o.codeHash === 'string' ? o.codeHash : '',
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
  }
  return { doc, ...(warnings.length > 0 ? { warnings } : {}) }
}

/** 序列化（2 空格缩进、末尾一个换行；与 `.jps` 同规矩：UTF-8 无 BOM、LF） */
export function serializeSyncDoc(doc: SyncDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** 由"用户输入"生成一份完整 doc（`tempo`/`segments` 现算） */
export function makeSyncDoc(input: {
  audio: string
  audioDurationMs: number
  trim?: SyncTrim
  anchors: SyncAnchor[]
  key?: string
  mix?: SyncMix
  code: string
  now?: string
}): SyncDoc {
  const trim = input.trim ?? {
    startMs: 0,
    endMs: input.audioDurationMs > 0 ? input.audioDurationMs : 0,
  }
  const fit = fitSync(input.anchors)
  return {
    version: SYNC_VERSION,
    audio: input.audio,
    audioDurationMs: input.audioDurationMs,
    trim,
    anchors: [...input.anchors].sort((a, b) => a.beat - b.beat),
    tempo: fit === null ? null : { beatMs: fit.beatMs, offsetMs: fit.offsetMs, bpm: bpmOfFit(fit) },
    segments: fit?.segments ?? [],
    ...(input.key !== undefined && input.key !== '' ? { key: input.key } : {}),
    mix: input.mix ?? DEFAULT_SYNC_MIX,
    codeHash: codeFingerprint(input.code),
    updatedAt: input.now ?? new Date().toISOString(),
  }
}

/** 能不能拿去出片（要有音频 + 至少 2 条锚点解出拍速） */
export function syncDocIsUsable(doc: SyncDoc | null | undefined): doc is SyncDoc & { tempo: { beatMs: number; offsetMs: number; bpm: number } } {
  return doc !== null && doc !== undefined && doc.tempo !== null && doc.audio !== ''
}

/**
 * adj1128：混音三档 → "这次到底放哪几条轨"。
 *
 * 用户 2026-10-24 实报「选合成音还是伴奏、选伴奏+合成也是伴奏」——根因是台面试听
 * **根本没看这个设置**（直接放了伴奏）。抽成纯函数后，台面试听与相机位/出片共用一张表，
 * 且能在 Node 里断言（改坏了立刻红灯）。
 */
export function mixPlanOf(mix: SyncMix): { playAcc: boolean; playSynth: boolean } {
  return {
    playAcc: mix.source !== 'synth',
    playSynth: mix.source !== 'file',
  }
}

/** 谱面改过没有（codeHash 不同 ⇒ 相机位要提示"锚点请复核"） */
export function syncDocStale(doc: SyncDoc | null | undefined, code: string): boolean {
  if (!doc) return false
  if (doc.codeHash === '') return false
  return doc.codeHash !== codeFingerprint(code)
}
