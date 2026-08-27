/**
 * dialogs/AboutDialog.tsx — 关于本软件（品牌介绍）
 */
import { Modal } from '../ui/Modal'
import { aboutCopy, uiCopy } from '../brand/copy'
import { palette } from '../brand/tokens'
import { APP_VERSION_FULL } from '../brand/version'

export function AboutDialog() {
  return (
    <Modal title={uiCopy.about}>
      <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
        <div
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 12px',
            borderRadius: 14,
            background: `linear-gradient(135deg, ${palette.deepSpaceBlue} 0%, #0f2a6e 100%)`,
            border: `1px solid ${palette.neonCyan}`,
            boxShadow: `0 0 16px rgba(0,240,255,0.4)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            color: palette.neonCyan,
          }}
        >
          记
        </div>
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
        <p style={{ margin: '8px 0' }}>{aboutCopy.userIdentity}</p>
        <p style={{ margin: '8px 0' }}>{aboutCopy.cli}</p>
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
      </div>
    </Modal>
  )
}
