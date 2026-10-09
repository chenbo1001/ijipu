/**
 * dialogs/DonateDialog.tsx — 支持作者（微信赞赏码）
 * 点击「支持作者」后打开，展示 public/icons/good.png 微信赞赏码供用户扫码（图片路径见 brand/copy.ts）。
 */
import { Modal } from '../ui/Modal'
import { donate } from '../brand/copy'

/**
 * adj731（用户报「插件里『支持』里的微信赞赏码不见了」，附破图截图）：
 * `donate.image` 是**根绝对路径** `/icons/good.png` —— 在**嵌入版**里会解析成
 * `http://127.0.0.1:<port>/icons/good.png`（**没有 `<token>` 段**），而插件的本地服务对
 * token 不匹配的请求一律 404 ⇒ 赞赏码变成破图（alt 文字还显示，看着像"图不见了"）。
 *
 * 同类问题 adj724b 已在 AboutDialog / TopBar 的 logo 上修过（那两处改成 `${BASE_URL}…`），
 * **这张图当时漏了**。这里统一按同一口径拼：`BASE_URL`（网页版 `'/'`、嵌入版 `'./'`）
 * + 去掉 `donate.image` 开头的斜杠（避免拼出 `//icons/...`）。
 */
function donateImageSrc(): string {
  return `${import.meta.env.BASE_URL}${donate.image.replace(/^\/+/, '')}`
}

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
          src={donateImageSrc()}
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
