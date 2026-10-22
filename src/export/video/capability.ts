/**
 * export/video/capability.ts — 视频生成能力闸门（adj1077）
 *
 * 用户口径（2026-10-23）：考虑到性能与浏览器限制，**生成视频先只放桌面壳端**，
 * 网站（纯 Web）和 Obsidian 插件先不开放；预览相机位仍保留。
 *
 * 两个条件必须同时满足：
 *  1. 运行在 Tauri 桌面壳（`isTauriShell()`；网站/插件都是 false）；
 *  2. 当前 WebView 支持 WebCodecs 的 `VideoEncoder` + `AudioEncoder`
 *     （MP4 编码走 mediabunny → WebCodecs；只判断桌面壳不够，老 WebView 也会失败）。
 *
 * `canGenerateVideo` 接收能力对象，纯函数，smoke 可直接断言；
 * 运行时通过 `detectVideoCapability()` 探测。
 */
import { isTauriShell } from '../../brand/env'

export interface VideoCapability {
  /** 是否 Tauri 桌面壳（网站、Obsidian 插件 iframe 都是 false） */
  tauri: boolean
  videoEncoder: boolean
  audioEncoder: boolean
}

export function detectVideoCapability(): VideoCapability {
  return {
    tauri: isTauriShell(),
    videoEncoder: typeof VideoEncoder !== 'undefined',
    audioEncoder: typeof AudioEncoder !== 'undefined',
  }
}

export function canGenerateVideo(cap: VideoCapability = detectVideoCapability()): boolean {
  return cap.tauri && cap.videoEncoder && cap.audioEncoder
}
