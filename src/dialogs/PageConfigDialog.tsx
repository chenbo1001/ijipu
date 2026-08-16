/**
 * dialogs/PageConfigDialog.tsx — 页面设置（纸张/边距/字体/行距/连音线样式）
 */
import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { defaultPageConfig } from '../engine'
import type { PageConfig } from '../engine'

export function PageConfigDialog() {
  const pageConfig = useDocStore((s) => s.pageConfig)
  const setPageConfig = useDocStore((s) => s.setPageConfig)
  const closeModal = useUiStoreClose()

  const [draft, setDraft] = useState<PageConfig>({ ...pageConfig })

  return (
    <Modal title="页面设置">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
        <fieldset style={{ border: '1px solid var(--jp-border)', borderRadius: 8, padding: 10 }}>
          <legend style={{ padding: '0 6px', color: 'var(--jp-text-secondary)' }}>页面大小、边距</legend>
          <Row label="纸张">
            <select
              value={draft.page}
              onChange={(e) => setDraft({ ...draft, page: e.target.value as PageConfig['page'] })}
            >
              <option value="A4">A4</option>
              <option value="A5">A5</option>
              <option value="A4_horizontal">横版 A4</option>
              <option value="A5_horizontal">横版 A5</option>
            </select>
          </Row>
          <Row label="边距(px)">
            <NumInput label="上" value={draft.margin_top} onChange={(v) => setDraft({ ...draft, margin_top: v })} />
            <NumInput label="下" value={draft.margin_bottom} onChange={(v) => setDraft({ ...draft, margin_bottom: v })} />
            <NumInput label="左" value={draft.margin_left} onChange={(v) => setDraft({ ...draft, margin_left: v })} />
            <NumInput label="右" value={draft.margin_right} onChange={(v) => setDraft({ ...draft, margin_right: v })} />
          </Row>
        </fieldset>

        <fieldset style={{ border: '1px solid var(--jp-border)', borderRadius: 8, padding: 10 }}>
          <legend style={{ padding: '0 6px', color: 'var(--jp-text-secondary)' }}>字体设置</legend>
          <Row label="标题字号">
            <NumInput label="主" value={draft.biaoti_size} onChange={(v) => setDraft({ ...draft, biaoti_size: v })} />
            <NumInput label="副" value={draft.fubiaoti_size} onChange={(v) => setDraft({ ...draft, fubiaoti_size: v })} />
          </Row>
          <Row label="歌词字号">
            <NumInput label="" value={draft.geci_size} onChange={(v) => setDraft({ ...draft, geci_size: v })} />
          </Row>
          <Row label="音符字形">
            <select value={draft.shuzi_font} onChange={(e) => setDraft({ ...draft, shuzi_font: e.target.value as PageConfig['shuzi_font'] })}>
              <option value="a">样式 1</option>
              <option value="b">样式 2</option>
              <option value="c">样式 3</option>
            </select>
          </Row>
        </fieldset>

        <fieldset style={{ border: '1px solid var(--jp-border)', borderRadius: 8, padding: 10 }}>
          <legend style={{ padding: '0 6px', color: 'var(--jp-text-secondary)' }}>行间距</legend>
          <Row label="曲下间距">
            <NumInput label="" value={draft.height_quci} onChange={(v) => setDraft({ ...draft, height_quci: v })} />
          </Row>
          <Row label="词下间距">
            <NumInput label="" value={draft.height_cici} onChange={(v) => setDraft({ ...draft, height_cici: v })} />
          </Row>
          <Row label="曲上间距">
            <NumInput label="" value={draft.height_ciqu} onChange={(v) => setDraft({ ...draft, height_ciqu: v })} />
          </Row>
        </fieldset>

        <fieldset style={{ border: '1px solid var(--jp-border)', borderRadius: 8, padding: 10 }}>
          <legend style={{ padding: '0 6px', color: 'var(--jp-text-secondary)' }}>连音线样式</legend>
          <Row label="样式">
            <select
              value={draft.lianyinxian_type}
              onChange={(e) => setDraft({ ...draft, lianyinxian_type: Number(e.target.value) as 0 | 1 | 2 })}
            >
              <option value={0}>自动</option>
              <option value={1}>圆弧</option>
              <option value={2}>平顶</option>
            </select>
          </Row>
        </fieldset>
      </div>

      <div className="modal-foot" style={{ padding: '12px 0 0', marginTop: 4 }}>
        <button
          className="btn"
          onClick={() => {
            setDraft({ ...defaultPageConfig })
          }}
        >
          恢复默认
        </button>
        <button
          className="btn primary"
          onClick={() => {
            setPageConfig(draft)
            closeModal()
          }}
        >
          保存设置
        </button>
      </div>
    </Modal>
  )
}

function useUiStoreClose() {
  return useUiStore((s) => s.closeModal)
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ width: 76, color: 'var(--jp-text-secondary)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

function NumInput(props: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {props.label && (
        <span style={{ color: 'var(--jp-text-muted)', fontSize: 12 }}>{props.label}</span>
      )}
      <input
        type="number"
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        style={{
          width: 52,
          padding: '3px 6px',
          background: 'var(--jp-bg-app)',
          border: '1px solid var(--jp-border)',
          borderRadius: 6,
          color: 'var(--jp-text-primary)',
          fontFamily: 'var(--jp-font-mono)',
        }}
      />
    </label>
  )
}
