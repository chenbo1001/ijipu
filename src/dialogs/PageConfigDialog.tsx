/**
 * dialogs/PageConfigDialog.tsx — 页面设置（纸张/边距/音符布局/间距/字体/连音线 + 全局设置）
 *
 * adj282：各分组改为标签页（tab）形式切换，节省纵向空间、便于放入更多设置。
 * adj315：新增「全局」标签页（应用级 uiStore；不写入谱面 # jps-config）。
 *         页面级设置改为「即刻预览 + 保存持久化 + X 恢复」：调整时临时应用到 store
 *         （setPageConfig(next,false) 预览非持久化），保存才写入 .jps，关闭未保存则恢复快照。
 *
 * 标签页顺序：全局 → 页面 → 音符布局 → 间距 → 字体 → 连音线。
 */
import { useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { defaultPageConfig } from '@ijipu/engine'
import type { PageConfig } from '@ijipu/engine'

type TabId = 'global' | 'page' | 'noteLayout' | 'spacing' | 'font' | 'slur'

const TABS: { id: TabId; label: string }[] = [
  { id: 'global', label: '全局' },
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
  // adj315：全局标签页是应用级偏好（uiStore，全局生效），不写入谱面 pageConfig
  const splitHDir = useUiStore((s) => s.splitHDir)
  const setSplitHDir = useUiStore((s) => s.setSplitHDir)
  const showScriptPad = useUiStore((s) => s.showScriptPad)
  const setShowScriptPad = useUiStore((s) => s.setShowScriptPad)
  const autoWrap = useUiStore((s) => s.autoWrap)
  const setAutoWrap = useUiStore((s) => s.setAutoWrap)
  const showGuides = useUiStore((s) => s.showGuides)
  const setShowGuides = useUiStore((s) => s.setShowGuides)
  const editorFontSize = useUiStore((s) => s.editorFontSize)
  const setEditorFontSize = useUiStore((s) => s.setEditorFontSize)
  const editorFont = useUiStore((s) => s.editorFont)
  const setEditorFont = useUiStore((s) => s.setEditorFont)

  const [draft, setDraft] = useState<PageConfig>({ ...pageConfig })
  const [tab, setTab] = useState<TabId>('global')
  // adj315：页面设置"即刻预览 + 保存持久化 + X 恢复"——
  // 打开时快照原值，调整时临时应用（预览非持久化），保存才写 .jps；关闭未保存则恢复快照。
  const snapRef = useRef<PageConfig>({ ...pageConfig })
  const committedRef = useRef(false)

  const updateDraft = (patch: Partial<PageConfig>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setPageConfig(next, false) // 预览（临时应用，不持久化）；保存才持久化
  }

  // adj315：取消（X/遮罩/Esc）未保存 → 恢复快照到 store（预览层），丢弃 draft
  const onCancelReset = () => {
    if (!committedRef.current) setPageConfig(snapRef.current, false)
  }

  /** 当前标签页面板内容（各组原字段，去掉 fieldset 边框——标签已表达分组边界） */
  const renderPanel = () => {
    switch (tab) {
      case 'global':
        // adj315：应用级全局设置（uiStore，全局生效；不写入谱面 # jps-config）
        return (
          <>
            <Row label="左右排列">
              <select
                value={splitHDir}
                onChange={(e) => setSplitHDir(e.target.value as 'previewLeft' | 'editorLeft')}
              >
                <option value="previewLeft">左预览 / 右编辑</option>
                <option value="editorLeft">左编辑 / 右预览</option>
              </select>
            </Row>
            <Row label="输入条">
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={showScriptPad} onChange={(e) => setShowScriptPad(e.target.checked)} />
                <span style={{ fontSize: 12 }}>显示简谱输入工具条（移动端默认开）</span>
              </label>
            </Row>
            <Row label="折行">
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={autoWrap} onChange={(e) => setAutoWrap(e.target.checked)} />
                <span style={{ fontSize: 12 }}>编辑器自动折行（长行软折行）</span>
              </label>
            </Row>
            <Row label="排版">
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
                <span style={{ fontSize: 12 }}>预览排版辅助虚线</span>
              </label>
            </Row>
            <Row label="编辑器字号">
              <NumInput label="" value={editorFontSize} onChange={(v) => setEditorFontSize(Math.min(26, Math.max(10, Number.isFinite(v) ? v : 14)))} />
            </Row>
            <Row label="编辑器字体">
              <select value={editorFont} onChange={(e) => setEditorFont(e.target.value)}>
                {EDITOR_FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Row>
            <div style={{ color: 'var(--jp-text-muted)', fontSize: 12, marginTop: 2 }}>
              全局设置不随谱保存；默认视图由顶栏视图组记住，重启恢复最后一次。
            </div>
          </>
        )
      case 'page':
        return (
          <>
            <Row label="纸张">
              <select
                value={draft.page}
                onChange={(e) => updateDraft({ page: e.target.value as PageConfig['page'] })}
              >
                <option value="A4">A4</option>
                <option value="A5">A5</option>
                <option value="A4_horizontal">横版 A4</option>
                <option value="A5_horizontal">横版 A5</option>
              </select>
            </Row>
            <Row label="边距(px)">
              <NumInput label="上" value={draft.margin_top} onChange={(v) => updateDraft({ margin_top: v })} />
              <NumInput label="下" value={draft.margin_bottom} onChange={(v) => updateDraft({ margin_bottom: v })} />
              <NumInput label="左" value={draft.margin_left} onChange={(v) => updateDraft({ margin_left: v })} />
              <NumInput label="右" value={draft.margin_right} onChange={(v) => updateDraft({ margin_right: v })} />
            </Row>
          </>
        )
      case 'noteLayout':
        return (
          <Row label="布局模式">
            <select
              value={draft.noteSpaceLayout}
              onChange={(e) => updateDraft({ noteSpaceLayout: e.target.value as PageConfig['noteSpaceLayout'] })}
            >
              {/* adj289：空间优先设为默认并置于首位；时值优先保留可选 */}
              <option value="space">空间优先</option>
              <option value="duration">时值优先</option>
            </select>
          </Row>
        )
      case 'spacing':
        return (
          // adj105：间距项两列排列，节省纵向空间
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 18px' }}>
            <Row label="描述头高">
              <NumInput label="" value={draft.descAreaH} onChange={(v) => updateDraft({ descAreaH: v })} />
            </Row>
            <Row label="首行至描述头间距">
              <NumInput label="" value={draft.body_margin_top} onChange={(v) => updateDraft({ body_margin_top: v })} />
            </Row>
            <Row label="曲部与曲部间距">
              <NumInput label="" value={draft.height_ciqu} onChange={(v) => updateDraft({ height_ciqu: v })} />
            </Row>
            <Row label="曲部与词部间距">
              <NumInput label="" value={draft.height_quci} onChange={(v) => updateDraft({ height_quci: v })} />
            </Row>
            <Row label="词部与词部间距">
              <NumInput label="" value={draft.height_cici} onChange={(v) => updateDraft({ height_cici: v })} />
            </Row>
            <Row label="曲部与上词部间距">
              <NumInput label="" value={draft.height_ciqu_lyric} onChange={(v) => updateDraft({ height_ciqu_lyric: v })} />
            </Row>
            {/* adj297：两端对齐最小小节数——行小节数小于该值自然对齐（行尾留白），≥ 该值撑满两端对齐 */}
            <Row label="两端对齐最小小节数">
              <NumInput label="" value={draft.align_min_bars} onChange={(v) => updateDraft({ align_min_bars: v })} />
            </Row>
          </div>
        )
      case 'font':
        return (
          <>
            <Row label="描述头">
              <FontSelect value={draft.miaoshu_font} onChange={(v) => updateDraft({ miaoshu_font: v })} />
              <NumInput label="字号" value={draft.miaoshu_size} onChange={(v) => updateDraft({ miaoshu_size: v })} />
            </Row>
            <Row label="标题">
              <FontSelect value={draft.biaoti_font} onChange={(v) => updateDraft({ biaoti_font: v })} />
              <NumInput label="字号" value={draft.biaoti_size} onChange={(v) => updateDraft({ biaoti_size: v })} />
            </Row>
            <Row label="副标题">
              <FontSelect value={draft.fubiaoti_font} onChange={(v) => updateDraft({ fubiaoti_font: v })} />
              <NumInput label="字号" value={draft.fubiaoti_size} onChange={(v) => updateDraft({ fubiaoti_size: v })} />
            </Row>
            <Row label="音符">
              <FontSelect value={draft.shuzi_font} onChange={(v) => updateDraft({ shuzi_font: v })} />
              <NumInput label="字号" value={draft.note_size} onChange={(v) => updateDraft({ note_size: v })} />
            </Row>
            {/* adj303：显示乐器名——@乐器名 / @@ 切换后的下一个音符正上方标注乐器名（默认不显示） */}
            <Row label="乐器显示">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={draft.showInstrument === true}
                  onChange={(e) => updateDraft({ showInstrument: e.target.checked })}
                />
                显示乐器名（@切换处音符上方标注）
              </label>
            </Row>
            <Row label="歌词">
              <FontSelect value={draft.geci_font} onChange={(v) => updateDraft({ geci_font: v })} />
              <NumInput label="字号" value={draft.geci_size} onChange={(v) => updateDraft({ geci_size: v })} />
            </Row>
            {/* adj292：歌词宽度不足时压缩字宽（默认不压缩允许重叠，选中才压缩） */}
            <Row label="歌词压缩">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={draft.lyricShrink === true}
                  onChange={(e) => updateDraft({ lyricShrink: e.target.checked })}
                />
                宽度不足时压缩文字宽度
              </label>
            </Row>
            {/* adj154：说明（S 行）字体独立于描述头 */}
            <Row label="说明">
              <FontSelect value={draft.notes_font ?? draft.miaoshu_font} onChange={(v) => updateDraft({ notes_font: v })} />
              <NumInput label="字号" value={draft.notes_size ?? draft.miaoshu_size} onChange={(v) => updateDraft({ notes_size: v })} />
            </Row>
          </>
        )
      case 'slur':
        return (
          <Row label="样式">
            <select
              value={draft.lianyinxian_type}
              onChange={(e) => updateDraft({ lianyinxian_type: Number(e.target.value) as 0 | 1 | 2 })}
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
    <Modal title="页面设置" onClose={onCancelReset}>
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
            updateDraft({ ...defaultPageConfig })
          }}
        >
          恢复默认
        </button>
        <button
          className="btn primary"
          onClick={() => {
            // adj83：保存设置时持久化到源码 # jps-config 注释（每首谱用自己的设置）
            committedRef.current = true
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

/** adj315：编辑器字体选项（全局设置——编辑器 textarea 等宽字体） */
const EDITOR_FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Consolas', value: 'Consolas' },
  { label: 'Courier New', value: 'Courier New' },
  { label: '等宽（系统默认）', value: 'monospace' },
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
