/**
 * export/video/capability.ts — 动态谱视频的整体能力闸门（adj1077 / adj1078）
 *
 * 用户口径（2026-10-23）：
 *  - 考虑到性能与浏览器限制，**动态谱视频整块先只放桌面壳**；网站（纯 Web）和 Obsidian 插件
 *    **连相机位预览也不显示**（不只是禁用“生成视频”）；
 *  - 桌面壳里生成视频还必须支持 WebCodecs（`VideoEncoder` + `AudioEncoder`），
 *    否则只保留预览、禁用生成。
 *
 * 两档能力：
 *  - `canUseDynamicVideo`：Tauri 桌面壳（或测试注入）→ 显示入口/相机位；
 *  - `canGenerateVideo`：在 `canUseDynamicVideo` 之上再加 WebCodecs 检查。
 *
 * `__IJIPU_FORCE_DESKTOP__` 只给 `verify:app-ui` 在 Chrome 里模拟桌面壳用；真实网站/插件不会注入。
 */
import { isTauriShell } from '../../brand/env'

export interface DynamicVideoCapability {
  /** 是否 Tauri 桌面壳（网站、Obsidian 插件 iframe 都是 false） */
  tauri: boolean
  /** 仅测试注入：在 Chrome 里模拟桌面壳 */
  force?: boolean
}

export interface VideoCapability extends DynamicVideoCapability {
  videoEncoder: boolean
  audioEncoder: boolean
}

function testForce(): boolean {
  if (typeof window === 'undefined') return false
  return (window as unknown as { __IJIPU_FORCE_DESKTOP__?: boolean }).__IJIPU_FORCE_DESKTOP__ === true
}

export function canUseDynamicVideo(
  cap: DynamicVideoCapability = { tauri: isTauriShell(), force: testForce() },
): boolean {
  return cap.tauri || cap.force === true
}

export function detectVideoCapability(): VideoCapability {
  return {
    tauri: isTauriShell(),
    force: testForce(),
    videoEncoder: typeof VideoEncoder !== 'undefined',
    audioEncoder: typeof AudioEncoder !== 'undefined',
  }
}

export function canGenerateVideo(cap: VideoCapability = detectVideoCapability()): boolean {
  return canUseDynamicVideo(cap) && cap.videoEncoder && cap.audioEncoder
}
