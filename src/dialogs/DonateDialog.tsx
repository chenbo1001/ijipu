/**
 * dialogs/DonateDialog.tsx — 支持作者（微信赞赏码）
 * 点击「支持作者」后打开，展示 public/good.png 微信赞赏码供用户扫码。
 */
import { Modal } from '../ui/Modal'
import { donate } from '../brand/copy'

export function DonateDialog() {
  return (
    <Modal title="支持作者">
      <div style={{ textAlign: 'center', padding: '4px 8px 12px' }}>
        <div
          style={{
            marginBottom: 14,
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--jp-text-primary)',
          }}
        >
          爱记谱 iJipu
        </div>
        <img
          src={donate.image}
          alt="微信赞赏码"
          width={260}
          height={260}
          style={{
            display: 'block',
            margin: '0 auto',
            borderRadius: 12,
            border: '1px solid var(--jp-border)',
            background: '#fff',
          }}
        />
        <p
          style={{
            marginTop: 14,
            marginBottom: 0,
            fontSize: 12,
            lineHeight: 1.7,
            color: 'var(--jp-text-muted)',
          }}
        >
          {donate.tip}
        </p>
      </div>
    </Modal>
  )
}
