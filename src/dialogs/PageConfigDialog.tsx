/**
 * dialogs/PageConfigDialog.tsx — 页面设置（谱面：纸张/边距/布局/间距/连音线 + 字体 + 全局）
 *
 * adj282：各分组改为标签页（tab）形式切换，节省纵向空间、便于放入更多设置。
 * adj315：新增「全局」标签页（应用级 uiStore；不写入谱面 # jps-config）。
 *         页面级设置改为「即刻预览 + 保存持久化 + X 恢复」：调整时临时应用到 store
 *         （setPageConfig(next,false) 预览非持久化），保存才写入 .jps，关闭未保存则恢复快照。
 * adj418：①「页面 / 音符布局 / 间距 / 连音线」四个标签页**合并为「谱面」**一个（分小节标题）；
 *         ②标签页**等分对话框宽度**、面板内容铺满页签宽度（不留右侧空白、不横向溢出）；
 *         ③底部三个按钮**固定在对话框底部**（只有中间的页签内容区滚动），永远不用滚动去找。
 *
 * 标签页顺序：全局 → 主题 → 音色库 → 谱面 → 字体。
 */
import { useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { useDocStore } from '../store/docStore'
import { useUiStore } from '../store/uiStore'
import { clampEditorFontSize, defaultPageConfig, EDITOR_FONT_OPTIONS, SCORE_FONT_OPTIONS, SEGMENT_ROW_GAP_DEFAULT } from '@ijipu/engine'
import { THEMES, type ThemeMode } from '../brand/themes'
import { uiCopy } from '../brand/copy'
import { SoundBankPanel } from './SoundBankPanel'
import type { PageConfig } from '@ijipu/engine'
// adj426：主题按钮用 ToolIcon（与顶栏三状态按钮共用图标：自动主题/浅色主题/深色主题）
import { ToolIcon } from '../ui/ToolIcon'

type TabId = 'global' | 'theme' | 'soundbank' | 'score' | 'font'

const TABS: { id: TabId; label: string }[] = [
  { id: 'global', label: '全局' },
  // adj383：主题组从顶栏菜单移入设置，紧跟在「全局」之后
  { id: 'theme', label: '主题' },
  // adj384：音色库从顶栏按钮移入设置，紧跟「主题」之后
  { id: 'soundbank', label: '音色库' },
  // adj418：原「页面 / 音符布局 / 间距 / 连音线」四个标签合并为「谱面」（都是"这份谱长什么样"）
  { id: 'score', label: '谱面' },
  { id: 'font', label: '字体' },
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
  // adj383：主题（中国色主题 + 浅深模式）——从顶栏菜单移入设置「主题」标签（本机界面偏好，不随谱保存）
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const themeMode = useUiStore((s) => s.themeMode)
  const setThemeMode = useUiStore((s) => s.setThemeMode)
  // adj-font：字体覆盖（L1 用户个性；跨机缺字体时用我的字体，不改谱面文件）
  const fontOverride = useUiStore((s) => s.fontOverride)
  const setFontOverride = useUiStore((s) => s.setFontOverride)
  // adj-font：把当前生效设置**全量**固化进谱面（差量写入下与默认相同的项不落盘）
  const persistFullConfig = useDocStore((s) => s.persistFullConfig)

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
              <NumInput label="" value={editorFontSize} onChange={(v) => setEditorFontSize(clampEditorFontSize(Number.isFinite(v) ? v : 14))} />
            </Row>
            <Row label="编辑器字体">
              <select value={editorFont} onChange={(e) => setEditorFont(e.target.value)}>
                {EDITOR_FONT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Row>
            {/* adj-font：L1 用户个性——跨机缺字体时的兜底：用我的字体覆盖谱面六项字体（默认关，不改写谱面） */}
            <Row label="字体覆盖">
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  checked={fontOverride.enabled}
                  onChange={(e) => setFontOverride({ ...fontOverride, enabled: e.target.checked })}
                />
                <span style={{ fontSize: 12 }}>用我的字体覆盖谱面字体（跨机缺字体时勾选）</span>
              </label>
            </Row>
            {fontOverride.enabled && (
              <Row label="覆盖为">
                <FontSelect value={fontOverride.font} onChange={(v) => setFontOverride({ ...fontOverride, font: v })} />
              </Row>
            )}
            <div style={{ color: 'var(--jp-text-muted)', fontSize: 12, marginTop: 2 }}>
              以上为**本机偏好**（L1），不随谱保存；谱面字体在「字体」标签里设置（随谱走）。
            </div>
          </>
        )
      case 'theme':
        // adj383：主题组（原顶栏菜单「主题」）——浅深模式 + 中国色主题；本机界面偏好，即时生效、不随谱保存
        return (
          <>
            <div className="ijipu-form-label">浅深模式</div>
            <div className="theme-mode-row" style={{ padding: 0 }}>
              {/* adj426：设置面板三个按钮改用 ToolIcon（自动主题/浅色主题/深色主题），
                  与顶栏新加的浅深模式三状态按钮视觉一致；点击直接选中该档（不走循环） */}
              {(
                [
                  { key: 'auto' as ThemeMode, label: '跟随系统', icon: 'themeAuto' as const },
                  { key: 'light' as ThemeMode, label: '浅色', icon: 'themeLight' as const },
                  { key: 'dark' as ThemeMode, label: '深色', icon: 'themeDark' as const },
                ]
              ).map((m) => (
                <button
                  key={m.key}
                  className={`theme-mode-btn${themeMode === m.key ? ' active' : ''}`}
                  onClick={() => setThemeMode(m.key)}
                  title={m.label}
                  aria-label={m.label}
                >
                  <ToolIcon name={m.icon} />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
            <div className="ijipu-form-hint">
              {themeMode === 'auto'
                ? '自动跟随系统浅深色设置'
                : themeMode === 'light'
                  ? '固定使用浅色配色'
                  : '固定使用深色配色'}
            </div>

            <div className="ijipu-form-label">主题配色</div>
            <div className="theme-list">
              {THEMES.map((t) => (
                <div key={t.id} className="theme-entry" onClick={() => setTheme(t.id)} title={t.desc}>
                  {theme === t.id ? (
                    <span
                      className="theme-swatch"
                      style={{
                        background: themeMode === 'light' ? t.accentLight : t.accent,
                        borderColor: themeMode === 'light' ? t.accentLight : t.accent,
                      }}
                    >
                      ✓
                    </span>
                  ) : (
                    <span
                      className="theme-swatch"
                      style={{
                        background: themeMode === 'light' ? t.bgLight : t.bg,
                        borderColor: themeMode === 'light' ? t.accentLight : t.accent,
                      }}
                    />
                  )}
                  <span className="theme-name">{t.name}</span>
                  <span className="theme-desc" style={{ color: themeMode === 'light' ? t.accentLight : t.accent }}>
                    {t.desc}
                  </span>
                </div>
              ))}
            </div>
            <div className="ijipu-form-hint" style={{ marginTop: 8 }}>
              主题属本机界面偏好，不随谱保存。
            </div>
          </>
        )
      case 'soundbank':
        // adj384：音色库管理（原顶栏「音色库」按钮 + 独立对话框）——本机偏好，不随谱保存
        return (
          <>
            <SoundBankPanel />
            <div className="ijipu-form-hint">
              音源库/试听音色属本机偏好（L1），不随谱保存；试听对话框只列这里勾选的音色。
            </div>
          </>
        )
      case 'score':
        // adj418：合并原「页面 / 音符布局 / 间距 / 连音线」四个标签——都是"这份谱长什么样"，
        // 分组用小节标题体现；间距类设置两列排布（省纵向空间，且铺满页签宽度）。
        return (
          <>
            <div className="pcfg-group-title">纸张与边距</div>
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

            <div className="pcfg-group-title">间距(px)</div>
            {/* adj105：间距项两列排列，节省纵向空间；adj418：铺满页签宽度（不再右侧留白） */}
            <div className="pcfg-grid2">
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

            {/* adj428：临时叠加段（{bz … } / {dsb … }）上下两行纵向间距——谱面级设置，
                跟随 .jps 走（与「间距」同一类，挨着放在它后面）。显示缺省回退 SEGMENT_ROW_GAP_DEFAULT。 */}
            <div className="pcfg-group-title">{uiCopy.segmentRowGapGroup}</div>
            <div className="pcfg-grid2">
              <Row label={uiCopy.segmentRowGapBzLabel}>
                <NumInput
                  label=""
                  value={draft.segmentRowGap?.bz ?? SEGMENT_ROW_GAP_DEFAULT.bz}
                  onChange={(v) => updateDraft({ segmentRowGap: { ...draft.segmentRowGap, bz: clampGap(v) } })}
                />
              </Row>
              <Row label={uiCopy.segmentRowGapDsbLabel}>
                <NumInput
                  label=""
                  value={draft.segmentRowGap?.dsb ?? SEGMENT_ROW_GAP_DEFAULT.dsb}
                  onChange={(v) => updateDraft({ segmentRowGap: { ...draft.segmentRowGap, dsb: clampGap(v) } })}
                />
              </Row>
            </div>
            <div style={{ color: 'var(--jp-text-muted)', fontSize: 12, marginTop: 2 }}>
              {uiCopy.segmentRowGapHint}
            </div>

            {/* adj419：音符布局组挪到「间距」下面（用户要求：先看纸张/边距，再调间距，最后是排布方式） */}
            <div className="pcfg-group-title">音符布局</div>
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
            <Row label="连音线样式">
              <select
                value={draft.lianyinxian_type}
                onChange={(e) => updateDraft({ lianyinxian_type: Number(e.target.value) as 0 | 1 | 2 })}
              >
                <option value={0}>自动</option>
                <option value={1}>圆弧</option>
                <option value={2}>平顶</option>
              </select>
            </Row>
          </>
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
    }
  }

  return (
    // adj418：fill —— 对话框内容撑满高度（页签与面板放中间滚动区，底部按钮固定可见）；
    // width 用 min(700px, 100%) 固定成"桌面满宽上限 / 窄屏铺满"——此前没给宽度，
    // 弹窗宽度由内容撑开，切页签时**弹窗宽度会跟着跳**（各页签内容宽度不同），页签与面板也就对不齐。
    // adj422：标题与菜单统一为「设置」（里面包含 全局/主题/音色库/谱面/字体 五个标签）
    <Modal title="设置" fill width="min(700px, 100%)" onClose={onCancelReset}>
      <div className="pcfg-root">
        {/* 中间滚动区：页签 + 面板（只有这里滚动，底部按钮永远可见） */}
        <div className="pcfg-scroll">
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

        <div className="modal-foot pcfg-foot">
          <button
            className="btn"
            onClick={() => {
              updateDraft({ ...defaultPageConfig })
            }}
          >
            恢复默认
          </button>
          <button
            className="btn"
            title="把当前生效的全部设置写成全量 # jps-config（与默认相同的项也会写入）——要把这份谱发给别人、保证任何机器上都长一样时用"
            onClick={() => {
              // adj-font（D1）：差量写入是默认；这里显式"固化全部"（全量写入），供分享/存档
              committedRef.current = true
              setPageConfig(snapRef.current, false) // 丢弃预览改动，按当前生效配置固化
              persistFullConfig()
              closeModal()
            }}
          >
            固化全部到谱面
          </button>
          <button
            className="btn primary"
            onClick={() => {
              // adj83：保存设置时持久化到源码 # jps-config 注释（每首谱用自己的设置）
              // adj-font（D1）：默认**差量写入**（只写与默认不同的字段；全部为默认时删除设置行）
              // adj454：传入打开时的快照 snapRef 作为基线——只固化**用户本次真正改动**的字段，
              // 本机公共设置（localStorage 缓存）里带来的值不会被写进这首谱
              committedRef.current = true
              setPageConfig(draft, true, snapRef.current)
              closeModal()
            }}
          >
            保存设置
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * 谱面字体候选（adj-font：改由引擎 `SCORE_FONT_OPTIONS` 统一提供——每项都是**含通用族的完整栈**，
 * 避免旧版"裸字体名"换机器掉到浏览器默认字体；跨机可用/适合简谱/保证有 fallback 三原则）。
 */
const FONT_OPTIONS: { label: string; value: string }[] = SCORE_FONT_OPTIONS

// adj428：临时段间距范围——bz 段至少要大于一行音符高（≈ 13 + 减时线 + 间距 ≈ 18），
// 上限取 80（再大就跟上一行曲部挤到一起，反而比"上间距"还大，破坏排版层级）。
const SEGMENT_ROW_GAP_MIN = 10
const SEGMENT_ROW_GAP_MAX = 80
const clampGap = (v: number): number => Math.max(SEGMENT_ROW_GAP_MIN, Math.min(SEGMENT_ROW_GAP_MAX, Math.round(v)))

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
    // adj418：标签列给足宽度且不换行（「两端对齐最小小节数」这类长标签不再折成两行），
    // 右侧控件按 flexWrap 自动换行，窄屏也不会横向溢出。
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ minWidth: 96, color: 'var(--jp-text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>{children}</div>
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
        // adj413：设置与间距里的 px 一律整数——输入即四舍五入（step=1 + 取整双保险）
        step={1}
        value={props.value}
        onChange={(e) => {
          const n = Number(e.target.value)
          // 输入中途（空串 / 单独一个负号）会得到 NaN：此时不动配置，避免把 NaN 写进设置
          if (Number.isFinite(n)) props.onChange(Math.round(n))
        }}
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
