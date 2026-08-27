/**
 * dialogs/PageConfigDialog.tsx — 页面设置（纸张/边距/音符布局/间距/字体/连音线样式）
 *
 * adj282：各分组改为标签页（tab）形式切换，节省纵向空间、便于放入更多设置。
 * 标签页顺序：页面 → 音符布局 → 间距 → 字体 → 连音线。
 * 字体设置：描述头/标题/副标题/音符/歌词 各一行（先字体下拉框，再字号框）。
 * 排版辅助开关已移至预览上方工具栏图标按钮，不在此对话框内。
 */
import { useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { defaultPageConfig } from '../engine'
import type { PageConfig } from '../engine'

type TabId = 'page' | 'noteLayout' | 'spacing' | 'font' | 'slur'

const TABS: { id: TabId; label: string }[] = [
  { id: 'page', label: '页面' },
  { id: 'noteLayout', label: '音符布局' },
  { id: 'spacing', label: '间距' },
  { id: 'font', label: '字体' },
  { id: 'slur', label: '连音线' },
]

export function PageConfigDialog() {
  const pageConfig = useDocStore((s) => s.pageConfig)
  const setPageConfig = useDocStore((s) => s.setPageConfig)
  const closeModal = useUiStore((s) => s.closeModal)

  const [draft, setDraft] = useState<PageConfig>({ ...pageConfig })
  const [tab, setTab] = useState<TabId>('page')

  /** 当前标签页面板内容（各组原字段，去掉 fieldset 边框——标签已表达分组边界） */
  const renderPanel = () => {
    switch (tab) {
      case 'page':
        return (
          <>
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
          </>
        )
      case 'noteLayout':
        return (
          <Row label="布局模式">
            <select
              value={draft.noteSpaceLayout}
              onChange={(e) => setDraft({ ...draft, noteSpaceLayout: e.target.value as PageConfig['noteSpaceLayout'] })}
            >
              <option value="duration">时值优先</option>
              {/* adj281：'space' 空间优先型布局预留，后续实现后再开放选项 */}
            </select>
          </Row>
        )
      case 'spacing':
        return (
          // adj105：间距项两列排列，节省纵向空间
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 18px' }}>
            <Row label="描述头高">
              <NumInput label="" value={draft.descAreaH} onChange={(v) => setDraft({ ...draft, descAreaH: v })} />
            </Row>
            <Row label="首行至描述头间距">
              <NumInput label="" value={draft.body_margin_top} onChange={(v) => setDraft({ ...draft, body_margin_top: v })} />
            </Row>
            <Row label="曲部与曲部间距">
              <NumInput label="" value={draft.height_ciqu} onChange={(v) => setDraft({ ...draft, height_ciqu: v })} />
            </Row>
            <Row label="曲部与词部间距">
              <NumInput label="" value={draft.height_quci} onChange={(v) => setDraft({ ...draft, height_quci: v })} />
            </Row>
            <Row label="词部与词部间距">
              <NumInput label="" value={draft.height_cici} onChange={(v) => setDraft({ ...draft, height_cici: v })} />
            </Row>
            <Row label="曲部与上词部间距">
              <NumInput label="" value={draft.height_ciqu_lyric} onChange={(v) => setDraft({ ...draft, height_ciqu_lyric: v })} />
            </Row>
            {/* adj297：两端对齐最小小节数——行小节数小于该值自然对齐（行尾留白），≥ 该值撑满两端对齐 */}
            <Row label="两端对齐最小小节数">
              <NumInput label="" value={draft.align_min_bars} onChange={(v) => setDraft({ ...draft, align_min_bars: v })} />
            </Row>
          </div>
        )
      case 'font':
        return (
          <>
            <Row label="描述头">
              <FontSelect value={draft.miaoshu_font} onChange={(v) => setDraft({ ...draft, miaoshu_font: v })} />
              <NumInput label="字号" value={draft.miaoshu_size} onChange={(v) => setDraft({ ...draft, miaoshu_size: v })} />
            </Row>
            <Row label="标题">
              <FontSelect value={draft.biaoti_font} onChange={(v) => setDraft({ ...draft, biaoti_font: v })} />
              <NumInput label="字号" value={draft.biaoti_size} onChange={(v) => setDraft({ ...draft, biaoti_size: v })} />
            </Row>
            <Row label="副标题">
              <FontSelect value={draft.fubiaoti_font} onChange={(v) => setDraft({ ...draft, fubiaoti_font: v })} />
              <NumInput label="字号" value={draft.fubiaoti_size} onChange={(v) => setDraft({ ...draft, fubiaoti_size: v })} />
            </Row>
            <Row label="音符">
              <FontSelect value={draft.shuzi_font} onChange={(v) => setDraft({ ...draft, shuzi_font: v })} />
              <NumInput label="字号" value={draft.note_size} onChange={(v) => setDraft({ ...draft, note_size: v })} />
            </Row>
            {/* adj303：显示乐器名——@乐器名 / @@ 切换后的下一个音符正上方标注乐器名（默认不显示） */}
            <Row label="乐器显示">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={draft.showInstrument === true}
                  onChange={(e) => setDraft({ ...draft, showInstrument: e.target.checked })}
                />
                显示乐器名（@切换处音符上方标注）
              </label>
            </Row>
            <Row label="歌词">
              <FontSelect value={draft.geci_font} onChange={(v) => setDraft({ ...draft, geci_font: v })} />
              <NumInput label="字号" value={draft.geci_size} onChange={(v) => setDraft({ ...draft, geci_size: v })} />
            </Row>
            {/* adj292：歌词宽度不足时压缩字宽（默认不压缩允许重叠，选中才压缩） */}
            <Row label="歌词压缩">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={draft.lyricShrink === true}
                  onChange={(e) => setDraft({ ...draft, lyricShrink: e.target.checked })}
                />
                宽度不足时压缩文字宽度
              </label>
            </Row>
            {/* adj154：说明（S 行）字体独立于描述头 */}
            <Row label="说明">
              <FontSelect value={draft.notes_font ?? draft.miaoshu_font} onChange={(v) => setDraft({ ...draft, notes_font: v })} />
              <NumInput label="字号" value={draft.notes_size ?? draft.miaoshu_size} onChange={(v) => setDraft({ ...draft, notes_size: v })} />
            </Row>
          </>
        )
      case 'slur':
        return (
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
        )
    }
  }

  return (
    <Modal title="页面设置">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
        <div className="jp-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`jp-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {renderPanel()}
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
            // adj83：保存设置时持久化到源码 # jps-config 注释（每首谱用自己的设置）
            setPageConfig(draft, true)
            closeModal()
          }}
        >
          保存设置
        </button>
      </div>
    </Modal>
  )
}

/** 字体选项（adj105：名称显示中文，value 存字体名供 SVG/渲染使用） */
const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: '微软雅黑', value: 'Microsoft YaHei' },
  { label: '黑体', value: 'SimHei' },
  { label: '宋体', value: 'SimSun' },
  { label: '楷体', value: 'KaiTi' },
  { label: '华文楷体', value: 'STKaiti' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Segoe UI', value: 'Segoe UI' },
  { label: '无衬线', value: 'sans-serif' },
  { label: '衬线', value: 'serif' },
]

function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = value && !FONT_OPTIONS.some((o) => o.value === value) ? [{ label: value, value }, ...FONT_OPTIONS] : FONT_OPTIONS
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ maxWidth: 160 }}
    >
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ width: 88, color: 'var(--jp-text-secondary)', fontSize: 12 }}>{label}</span>
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
