/**
 * store/syncStore.ts — 「对拍」的**内存状态**（sidecar 的副本 + 当前伴奏 AudioBuffer）
 *
 * 为什么单独一个 store 而不是塞进 `uiStore`：
 *  · `uiStore` 是"界面偏好"（模态、缩放、主题…），对拍是**一份文档级数据**（跟 `.jps` 走）；
 *  · 这里还握着几十 MB 的 `AudioBuffer`（不能进 localStorage、不能进 React 状态树）；
 *  · 相机位（读）与对拍台（写）都要订阅同一份，**以 `rev` 作为"变了没"的信号**。
 *
 * 持久化分层（用户 2026-10-24 定）：
 *  · 正式落点是**同目录 sidecar** `赤伶.jps.sync.json`（写盘要 Rust 命令，下一步接）；
 *  · 在 Rust 接上之前，先用 L1（`ijipu.mvSync.last`）兜住"关掉重开还能接着调"，
 *    并在键里带 `fileName`——换一份谱就不会错用别的谱的锚点；
 *  · 伴奏本身**不持久化**（同目录文件，重开时按名字找；找不到就提示重选）。
 */
import { create } from 'zustand'
import type { SyncAnchor, SyncTrim } from '@ijipu/engine'
import { fitSync, bpmOfFit } from '@ijipu/engine'
import {
  DEFAULT_SYNC_MIX,
  makeSyncDoc,
  parseSyncDoc,
  serializeSyncDoc,
  type SyncDoc,
  type SyncMix,
} from '../export/video/syncDoc'

/** L1 兜底键（Rust sidecar 读写接上后仍保留：先把"临时状态"救回来用） */
export const SYNC_L1_KEY = 'ijipu.mvSync.last'

/** 重算 `tempo`/`segments`（不改 codeHash/时间戳——那是"保存"才做的事） */
function recompute(doc: SyncDoc): SyncDoc {
  const fit = fitSync(doc.anchors)
  return {
    ...doc,
    tempo: fit === null ? null : { beatMs: fit.beatMs, offsetMs: fit.offsetMs, bpm: bpmOfFit(fit) },
    segments: fit?.segments ?? [],
  }
}

interface SyncState {
  /** 当前谱的对拍文档（`null` = 还没建过） */
  doc: SyncDoc | null
  /** 解码好的伴奏（内存；`null` = 还没选/重开未选） */
  audio: AudioBuffer | null
  /** 变化计数（相机位据此重建会话/作废音轨） */
  rev: number
  /** 打开对拍台时调用：先恢复 L1 里同名谱的副本（伴奏仍需重选）；没有就新建一份空的 */
  ensureFor: (fileName: string, code: string) => void
  /**
   * adj1128：用**磁盘上的 sidecar** 整个替换内存副本。
   * 打开台面时会先读同目录的 `.jps.sync.json`（比 L1 兜底更权威）。
   */
  replaceDoc: (doc: SyncDoc) => void
  setAudio: (name: string, buf: AudioBuffer | null) => void
  addAnchor: (a: SyncAnchor) => void
  updateAnchor: (i: number, patch: Partial<SyncAnchor>) => void
  removeAnchor: (i: number) => void
  setTrim: (t: SyncTrim) => void
  setMix: (m: Partial<SyncMix>) => void
  setKey: (k: string) => void
  setAudioName: (n: string) => void
  /** 保存：刷新 codeHash/时间戳 → 写 L1（sidecar 写盘下一步接） */
  save: (code: string, fileName: string) => void
  clear: () => void
}

export const useSyncStore = create<SyncState>((set, get) => ({
  doc: null,
  audio: null,
  rev: 0,

  ensureFor: (fileName, code) => {
    // 同一份谱已经在编辑：不要覆盖（否则关掉台面再打开会丢掉未保存的改动）
    if (get().doc !== null) return
    try {
      const raw = localStorage.getItem(SYNC_L1_KEY)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as { fileName?: unknown; doc?: unknown }
        if (typeof parsed.fileName === 'string' && parsed.fileName === fileName) {
          const r = parseSyncDoc(JSON.stringify(parsed.doc))
          if (r.doc !== null) {
            set({ doc: recompute(r.doc), rev: get().rev + 1 })
            return
          }
        }
      }
    } catch {
      /* L1 坏了就当没有（不阻塞打开台面） */
    }
    set({
      doc: makeSyncDoc({ audio: '', audioDurationMs: 0, anchors: [], code }),
      rev: get().rev + 1,
    })
  },

  replaceDoc: (doc) => {
    set({ doc: recompute(doc), rev: get().rev + 1 })
  },

  setAudio: (name, buf) => {
    const cur = get().doc
    if (cur === null) return
    const next: SyncDoc = {
      ...cur,
      audio: name,
      audioDurationMs: buf ? Math.round(buf.duration * 1000) : cur.audioDurationMs,
      // 换了伴奏：原来的裁剪区间按新长度夹紧（不改锚点——锚点是文件绝对时刻，用户自己调）
      trim: buf
        ? { startMs: Math.min(cur.trim.startMs, Math.round(buf.duration * 1000)), endMs: Math.round(buf.duration * 1000) }
        : cur.trim,
    }
    set({ doc: recompute(next), audio: buf, rev: get().rev + 1 })
  },

  addAnchor: (a) => {
    const cur = get().doc
    if (cur === null) return
    const sorted = [...cur.anchors, a].sort((x, y) => x.beat - y.beat)
    set({ doc: recompute({ ...cur, anchors: sorted }), rev: get().rev + 1 })
  },

  updateAnchor: (i, patch) => {
    const cur = get().doc
    if (cur === null) return
    const anchors = cur.anchors.map((a, k) => (k === i ? { ...a, ...patch } : a))
    set({ doc: recompute({ ...cur, anchors }), rev: get().rev + 1 })
  },

  removeAnchor: (i) => {
    const cur = get().doc
    if (cur === null) return
    set({
      doc: recompute({ ...cur, anchors: cur.anchors.filter((_, k) => k !== i) }),
      rev: get().rev + 1,
    })
  },

  setTrim: (t) => {
    const cur = get().doc
    if (cur === null) return
    const end = cur.audioDurationMs > 0 ? Math.min(t.endMs, cur.audioDurationMs) : t.endMs
    const start = Math.max(0, Math.min(t.startMs, end))
    set({ doc: { ...cur, trim: { startMs: start, endMs: end } }, rev: get().rev + 1 })
  },

  setMix: (m) => {
    const cur = get().doc
    if (cur === null) return
    set({ doc: { ...cur, mix: { ...cur.mix, ...m } }, rev: get().rev + 1 })
  },

  setKey: (k) => {
    const cur = get().doc
    if (cur === null) return
    set({ doc: { ...cur, key: k.trim() === '' ? undefined : k.trim() }, rev: get().rev + 1 })
  },

  setAudioName: (n) => {
    const cur = get().doc
    if (cur === null) return
    set({ doc: { ...cur, audio: n }, rev: get().rev + 1 })
  },

  save: (code, fileName) => {
    const cur = get().doc
    if (cur === null) return
    const doc = makeSyncDoc({
      audio: cur.audio,
      audioDurationMs: cur.audioDurationMs,
      trim: cur.trim,
      anchors: cur.anchors,
      ...(cur.key !== undefined ? { key: cur.key } : {}),
      mix: cur.mix,
      code,
    })
    set({ doc, rev: get().rev + 1 })
    try {
      localStorage.setItem(SYNC_L1_KEY, JSON.stringify({ fileName, doc: JSON.parse(serializeSyncDoc(doc)) }))
    } catch {
      /* 配额满/隐私模式：保存失败不影响本次对拍 */
    }
  },

  clear: () => {
    set({ doc: null, audio: null, rev: get().rev + 1 })
    try {
      localStorage.removeItem(SYNC_L1_KEY)
    } catch {
      /* 忽略 */
    }
  },
}))

/**
 * 相机位/导出用的"有效拍速"：有可用的 sidecar 才返回，否则 `null`（用谱面 `J:`） */
export function effectiveSyncBpm(doc: SyncDoc | null): number | null {
  if (doc === null || doc.tempo === null || doc.audio === '') return null
  return 60000 / doc.tempo.beatMs
}

export { DEFAULT_SYNC_MIX }
