/**
 * dialogs/PlaybackDialog.tsx — 试听播放（引擎实现迭代中）
 * 显示曲目信息与播放参数占位；播放引擎（synth + sampler 双后端）见后续迭代。
 */
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'

export function PlaybackDialog() {
  const parseResult = useDocStore((s) => s.parseResult)
  const header = parseResult.header

  return (
    <Modal title="试听播放">
      <div style={{ fontSize: 13, lineHeight: 1.9 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{header.titles[0] ?? '未命名'}</div>
        {header.authors.length > 0 && (
          <div style={{ color: 'var(--jp-text-secondary)' }}>{header.authors.join('；')}</div>
        )}
        <div style={{ color: 'var(--jp-text-muted)', fontSize: 12 }}>
          调式 {header.key ?? '—'} · 拍号 {header.meter ?? '—'} · 节拍 {header.tempo ?? '—'}
        </div>
        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            border: '1px dashed var(--jp-border)',
            borderRadius: 8,
            color: 'var(--jp-text-secondary)',
          }}
        >
          🎧 播放引擎开发中 —— 将支持：速度调节 · 自动滚屏 · 反复记号识别 · 点击音符跳转
          <br />
          <span style={{ color: 'var(--jp-text-muted)', fontSize: 12 }}>
            音色：Web Audio 合成（默认）+ 钢琴采样（可切换）
          </span>
        </div>
      </div>
    </Modal>
  )
}
