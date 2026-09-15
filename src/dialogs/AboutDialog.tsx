/**
 * dialogs/AboutDialog.tsx — 关于本软件（品牌介绍）
 *
 * adj419：脚本兼容说明 / 致谢 / 谱师 / 命令行工作流四段移到「操作手册」（docs/USER-GUIDE.md §九），
 * 关于对话框只留品牌介绍、署名、版本与协议。
 */
import { Modal } from '../ui/Modal'
import { aboutCopy, uiCopy, donate } from '../brand/copy'
import { palette } from '../brand/tokens'
import { APP_VERSION_FULL } from '../brand/version'
import { useUiStore } from '../store/uiStore'

export function AboutDialog() {
  const openModal = useUiStore((s) => s.openModal)

  return (
    <Modal title={uiCopy.about}>
      <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
        <img
          src="/icons/Jianpu.png"
          alt="爱记谱 iJipu Logo"
          width={64}
          height={64}
          style={{
            display: 'block',
            margin: '0 auto 12px',
            borderRadius: 14,
            border: `1px solid ${palette.deepSpaceBlueBorder}`,
            boxShadow: `0 0 16px rgba(0,240,255,0.35)`,
            background: 'var(--jp-bg-panel)',
          }}
        />
        <div style={{ fontSize: 18, fontWeight: 700 }}>{aboutCopy.title}</div>
        <div style={{ color: 'var(--jp-accent)', fontSize: 13, marginTop: 4 }}>
          {aboutCopy.tagline}
        </div>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--jp-text-secondary)' }}>
        {aboutCopy.body.split('\n').map((p, i) => (
          <p key={i} style={{ margin: '0 0 8px' }}>
            {p}
          </p>
        ))}
        {/* adj419：作者署名（+ 可选联系方式，邮箱留空则不显示） */}
        <p style={{ margin: '8px 0' }}>
          <strong>{aboutCopy.author}</strong>
          {aboutCopy.contact && <span style={{ marginLeft: 10 }}>{aboutCopy.contact}</span>}
        </p>
        <div
          style={{
            marginTop: 12,
            textAlign: 'center',
            color: 'var(--jp-text-muted)',
            fontSize: 12,
          }}
        >
          {APP_VERSION_FULL}
        </div>
        <p
          style={{
            marginTop: 10,
            textAlign: 'center',
            color: 'var(--jp-text-muted)',
            fontStyle: 'italic',
          }}
        >
          {aboutCopy.footer}
        </p>
        <p style={{ marginTop: 6, textAlign: 'center', color: 'var(--jp-text-muted)', fontSize: 12 }}>
          {aboutCopy.acknowledgement}
        </p>
        <div style={{ marginTop: 10, textAlign: 'center' }}>
          {donate.image ? (
            <button
              type="button"
              onClick={() => openModal('donate')}
              style={{
                display: 'inline-block',
                padding: '8px 20px',
                borderRadius: 8,
                color: '#fff',
                fontWeight: 700,
                fontSize: 13,
                border: 'none',
                cursor: 'pointer',
                background: `linear-gradient(135deg, ${palette.deepSpaceBlue}, ${palette.neonCyan})`,
                boxShadow: `0 0 10px rgba(0,240,255,0.3)`,
              }}
            >
              {donate.label}
            </button>
          ) : (
            <span style={{ color: 'var(--jp-text-muted)', fontSize: 12 }}>{aboutCopy.license}</span>
          )}
        </div>
      </div>
    </Modal>
  )
}
