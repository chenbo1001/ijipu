/**
 * 品牌文案库 —— 所有面向用户的品牌文字集中于此，便于统一修改。
 */
import { brand } from './tokens'

/** 关于本软件（“关于我们”）
 *  adj419：原「脚本兼容说明 / 致谢 / 谱师 / 命令行工作流」四段移到**操作手册**
 *  （docs/USER-GUIDE.md §九）——关于对话框只留品牌介绍、署名与协议，避免越长越像文档。 */
export const aboutCopy = {
  title: `${brand.nameZh}（${brand.name}）`,
  tagline: brand.taglineMain,
  /** 品牌介绍正文 */
  body: [
    `${brand.nameZh}（英文名：${brand.name}）—— 优秀高效的代码式简谱制谱引擎。`,
    '我们致力于将编程语言的严谨逻辑，注入中国传统简谱的创作之中。通过一套极简的 .jps 标记语言，让音乐人像写代码一样编排音符，让程序员像调参一样调整音高。码即成，谱自现，让简谱创作从此进入“脚本时代”。',
  ].join('\n'),
  /** 作者署名（adj373） */
  author: `作者：${brand.author}`,
  /** 作者联系方式（邮箱留空时为空串 → 关于对话框不渲染该行） */
  contact: brand.authorEmail ? `联系：${brand.authorEmail}` : '',
  /** 底部情怀 */
  footer: brand.taglineFooter,
  /** 开源协议说明（捐赠入口未配置时显示在关于对话框底部；
   *  adj422：原来的「致敬」短句已移到操作手册 §九，关于对话框不再重复） */
  license: '本项目基于 GNU Affero General Public License v3.0（AGPL-3.0）发布，欢迎学习、修改与再分发。',
} as const

/** 捐赠/支持作者（Q-10）。donateImage 为微信赞赏码图片路径（public/ 下）；为空则不显示捐赠入口。
 *  按钮文案见 donate.label；「关于」对话框点击后打开模态框展示赞赏码。 */
export const donate = {
  /** 微信赞赏码图片路径（adj417 起图片统一放 public/icons/ 下，如 '/icons/good.png'）——留空 = 不显示捐赠入口 */
  image: '/icons/good.png',
  /** 捐赠按钮文案 */
  label: '支持作者 ❤',
  /** 显示在赞赏码下方的说明 */
  tip: '算力烧得火热，五音不全也要接着奏乐、接着谱——赏点 Token，让我继续摇摆～（自愿捐赠，无任何商业回报）',
} as const

/** 界面内文案 */
export const uiCopy = {
  appName: brand.shortName,
  windowTitle: `${brand.nameZh} ${brand.name} — ${brand.taglineMain}`,
  newFile: '新建乐谱',
  openFile: '打开乐谱',
  saveFile: '保存乐谱',
  exportMenu: '导出',
  exportPdf: '导出 PDF',
  exportJpg: '导出 JPG 图片',
  exportSvg: '导出 SVG 图片',
  exportPng: '导出 PNG 图片',
  // adj422：菜单与对话框统一叫「设置」（原「页面设置」——里面早就不只是页面了：
  // 全局/主题/音色库/谱面/字体五个标签）
  pageConfig: '设置',
  play: '试听播放',
  about: `关于 ${brand.name}`,
  currentFile: '当前乐谱',
  defaultFileName: '未命名',
  unsaved: '未保存',
  viewCode: '编码',
  viewSplit: '拆分',
  viewPreview: '预览',
  statusReady: '就绪',
  /**
   * adj628（用户报"Ctrl+N 新建后状态栏还是上一个文件名，会不会覆盖原文件"）：
   * 新建与"恢复上次文件"两种情况都要**明说**，用户才分得清"这是新谱"还是"还绑在老文件上"。
   *   · `newDocDone`：确认新建真的生效，并点明"未关联文件 ⇒ 保存会走另存为"；
   *   · `restoredFile`：新窗口/新标签（含浏览器自己开的窗口）会恢复上次草稿与文件绑定——
   *     明确告诉用户"保存会写回它"，别把它当成新建出来的空谱。
   */
  newDocDone: '已新建空谱（未与任何文件关联，保存会提示另存为）',
  restoredFile: (name: string): string =>
    `已恢复上次打开的「${name}」：这份草稿仍与它关联，保存会写回它（要另起一份请用「新建」）`,
  // ---- 保存反馈（toast）----
  saveOk: '已保存',
  // adj365：慢保存的即时反馈（超过 150ms 仍未完成才提示，避免快保存闪烁）
  saving: '保存中…',
  saveFailed: '保存失败：文件句柄可能失效或文件被占用，请用「文件 → 另存为」重新保存',
  saveAsFailed: '另存为失败，请检查文件位置是否可写',
  // adj363：保存失败按原因给出可操作提示（此前统一静默或笼统提示，用户以为已保存）
  saveGone: '保存失败：原文件已被移动或删除，请用「文件 → 另存为」另选位置',
  saveBusy: '保存失败：文件正被其它程序占用或只读，请关闭占用程序后重试，或用「文件 → 另存为」',
  saveVerifyFailed: '保存未生效：写入后校验内容不一致，请用「文件 → 另存为」另选位置重试',
  saveAsNoGesture: '另存为失败：未获得用户操作授权，请直接再点一次「另存为」或按 Ctrl+S',
  // adj369：保存慢在「提交文件」（浏览器把临时文件替换成目标文件）时的可操作提示——
  // 该步由浏览器 + 操作系统完成，应用代码不参与；adj372 按实测补充"换浏览器"这条（Edge 正常、
  // Chrome/PWA 窗口慢，属浏览器环境差异）
  saveSlowCommitHint: '保存慢在文件替换（浏览器/系统行为）：可试试换用其它浏览器或非 PWA 窗口，或把文件移出云同步/杀软监控目录',
  saveUnsupported: '当前环境不支持保存到磁盘（File System Access API 仅 Chromium 安全上下文支持，手机端通常没有）；请用「文件 → 导出」下载 .jps 保存',
  // adj379：PWA 部署新版后的更新提示（新 SW 已接管、页面仍跑旧 bundle，点击刷新即换新代码）
  updateReady: '发现新版本，点击刷新',
  // adj281：非安全上下文（http:// 或 file://）或非 Chromium 内核下无 Web File System Access API，
  // 降级用 <input type=file> 载入 .jps 文本——已载入但无法写回磁盘，提示改用「导出」保存
  openFallbackNotice: '已载入文件；此环境无法写回磁盘，请用「文件 → 导出」保存成果',
  // adj370：打开文件必须给出反馈（此前失败静默 return false，用户无法判断是否打开成功）
  openOkPrefix: '已打开：',
  openFailedPrefix: '打开失败：',
  // adj401：手机端「打开」里找不到 .jps 时的可操作指引——用户实测：文件在网盘/微信里还没落到本机，
  // 而系统选择器只列本机文件；加上国产浏览器/网盘 SAF 会按类型隐藏未知扩展，
  // 于是「能看到 .md 却看不到 .jps」。这三条覆盖所有情况（落地 / 换目录 / 改扩展名）。
  openPickHint:
    '列表里找不到 .jps？① 先把文件「保存到手机／下载到本地」（网盘、微信里的文件不在本机列表里）；② 再从「下载」目录选；③ 把扩展名改成 .md/.txt 也能打开（按文本读入）；④ 或用「文件 → 粘贴源码导入」（adj406：把源码粘进来即可，不经过文件选择器）',
  // adj405：移动端文件选择器根本没弹出来（个别外壳/PWA 会静默失败，点了像"没反应"）
  openPickerSilent: '文件选择器没有弹出来（个别手机浏览器/PWA 会这样）：请改用浏览器打开本站，或用「文件 → 粘贴源码导入」把源码贴进来',
  // adj428：临时叠加段上下层纵向间距可调（设置 → 谱面 → 临时段）
  segmentRowGapGroup: '临时段',
  segmentRowGapBzLabel: 'bz 段上下间距',
  segmentRowGapDsbLabel: 'dsb 段上下间距',
  // adj629e：替谱行与其**下方歌词行**的间距
  segmentRowGapTpLabel: '替谱行与下方歌词间距',
  segmentRowGapHint:
    '临时叠加段的纵向间距（px）。`bz`/`dsb` 是段层与主旋律的间距；`tp`（替谱段 `{tp … }`）= **替谱行与其下方那条歌词行的间距**——拖它上下移动的是替谱层本身（下方歌词行不动）；歌词行 1 的虚线管「歌词区↔曲部」，歌词行 2 及以后的虚线管「歌词行之间」。默认：bz/dsb 22、tp 14。',
  // adj479：多声部块内「声部行间距」——此前只有预览虚线可拖（设置里没有输入框，用户报"无法调整"）
  shengbuGapLabel: '声部间距',
} as const

/**
 * adj406：「粘贴源码导入」文案——不依赖文件选择器的兜底入口
 * （手机端网盘/微信里的 .jps 常看不到：系统选择器只列本机文件，未知扩展还可能被按类型隐藏）
 */
export const pasteImportCopy = {
  menuLabel: '粘贴源码导入(&V)…',
  title: '粘贴源码导入',
  /**
   * adj579（用户要求）：这条长说明从"常驻正文"改成编辑器上方那个 `?` 的提示
   * （常驻会占掉两行，粘贴框就矮了）；正文位置只留一个短标签 `label`。
   * adj585（用户要求）：`?` 改成**点一下展开**（PC 仍可悬浮）——触屏没有 hover，
   * 旧版只能让这条常驻，手机上白占高度（见 `ui/HelpBadge.tsx`）。
   */
  desc: '把谱面源码粘贴到下面（微信/网盘里复制的文本、笔记里的 ```jps 代码块都可以），点「导入」即替换当前内容。不会写入磁盘，保存请用「导出」。',
  /** adj579（用户要求）：编辑器上方的标签——adj581：去掉冒号，并统一成"谱面页标签"样式（当作标题用） */
  label: '粘贴源码',
  placeholder: '在这里粘贴 .jps 源码……',
  fromClipboard: '从剪贴板粘贴',
  clipboardFailed: '读不到剪贴板内容：请长按输入框手动粘贴',
  clipboardEmpty: '剪贴板里没有文本内容',
  importBtn: '导入',
  cancelBtn: '取消',
  empty: '还没有内容——先粘贴源码再点「导入」',
  ok: (chars: number): string => `已导入粘贴的源码（${chars} 字符）；保存请用「文件 → 导出」`,
  name: '粘贴导入',
} as const

/**
 * adj540：「工作区」文案（Android/移动端"选一个文件夹当工作区"）
 *
 * 解决的是手机上的真实痛点：系统文件选择器对 `.jps` 这种自定义扩展名态度不一致
 * （按 MIME 隐藏、只能看到已下载的文件），保存用的 `showSaveFilePicker` 在移动端还出现过
 * "点了没反应"（adj405）。工作区把打开/保存变成"在同一个文件夹里挑文件/写文件"，
 * 一次授权、之后都在这个文件夹里操作（含**子目录**）。
 */
export const workspaceCopy = {
  menuLabel: '工作区(&W)…',
  /** adj540：系统文件选择器的独立入口（「打开…」在工作区就绪后会改开工作区面板） */
  openSystemLabel: '打开（系统文件选择器）(&F)…',
  title: '工作区',
  desc: '选一个文件夹当工作区：之后打开 / 保存都在这个文件夹里（支持子目录）。手机上都走这条路，不用每次翻系统文件选择器。',
  pick: '选择文件夹当工作区',
  /**
   * adj586（用户要求"继续访问 按钮不需要，通过点击当前工作区项可以切回文件列表"）：
   * 清单里**当前那一项**的悬浮提示——点它 = 补授权 + 回文件列表（原来那个独立按钮已取消，
   * 所以 `grant: '继续访问（需授权）'` 这条文案随之删除）。
   */
  grantTapTitle: '点它即可重新授权访问，并回到文件列表',
  /** adj540：授权前**必须让用户看清是哪个目录**（用户要求）。
   *  adj586：授权前的目录框（`.ws-grant-dir`）按用户要求取消——清单里那行带「当前」标记的
   *  就是正在用的工作区，本字段暂留（另有展示完整路径的需求时再用）。 */
  grantTitle: '需要重新授权访问这个文件夹',
  /**
   * 授权区里那条"为什么看不到完整路径"的说明。
   * File System Access 出于隐私**只暴露文件夹名**（句柄的 `name`），**不提供完整磁盘路径**
   * （`resolve()` 也只能在工作区内算相对路径）⇒ 这里如实说明，别让用户以为是显示不全。
   */
  grantPathHint: '浏览器出于隐私不提供完整磁盘路径，清单里显示的是文件夹名（桌面版有完整路径）',
  /**
   * adj568（用户反馈"下载目录没法当工作区"，追问"为什么不让带系统文件的目录当工作区"）：
   * 这条限制**不在 iJipu 里**，而是浏览器内核（Chromium / WebView2）的**敏感目录黑名单**——
   * 它按"目录在系统里扮演什么角色"判定，**与目录里有什么文件（有没有 .jps）完全无关**：
   * 「下载 / 桌面 / 文档 / 用户主目录」这几个目录**自身**不能授予网页，但**其中的子文件夹可以**
   * （`chrome_file_system_access_permission_context.cc` 的 `GenerateBlockPaths()`，
   * BlockType = `kDontBlockChildren`）。
   * 更麻烦的是：被拦时内核弹框的说法是"包含系统文件"（对干净的下载目录而言并不准确），
   * 且抛出的错误是 `AbortError`——**与"用户取消"完全同一个错误**，应用侧既绕不过、也没法区分，
   * 只能在**选之前**把规矩讲清楚（见 E-2026-271）。桌面版走原生选择器，不受这条 Web 策略约束。
   */
  blockedHint:
    '提示：浏览器不允许把「下载 / 桌面 / 文档 / 用户主目录」这几个目录本身当工作区（内核安全策略，与目录里有没有 .jps 无关）。在它们里面新建一个子文件夹再选即可；桌面版不受此限制，可直接选这些目录。',
  /**
   * adj585（用户要求）：右栏「新工作区」按钮**下方**常驻的短提示——只说"内核要求"这一句；
   * 上面那条长说明（哪些目录被拦、怎么办）收进「选择工作区」标题后的 `?`，点一下才展开。
   */
  chromiumOnly: '仅支持 Chromium 内核浏览器',
  grantWhy: '刷新或重新打开页面后，浏览器会把目录权限重置为"待确认"，需要在点击后重新授予一次。',
  /**
   * adj568：**桌面端**（路径后端）没有"浏览器授权"这回事 ⇒ 这个界面只剩一种成因：
   * 目录被外部删掉/改名/移走了（应用记住的是绝对路径）。用网页版那套"重新授权"文案会误导。
   */
  dirMissingTitle: '工作区目录已不在（可能被移动、改名或删除）',
  dirMissingWhy: '桌面版记住的是目录的完整路径；路径失效后无法继续读写。请重新选一个文件夹。',
  switchDir: '换一个文件夹',
  /** adj540（用户第二轮反馈）：左侧的"切换工作区"按钮改用图标 + 通用悬浮提示
      ——把"切换工作区"这个动作从路径面包屑里彻底分离出去，根目录名恢复成普通的面包屑段（点击=回工作区根）。
      adj569：图标由 `工作区.png` 换成专用的 `切换工作区.png`（页签那处仍是 `工作区.png`） */
  workspaceBtnTitle: '切换工作区目录',
  up: '上级目录',
  emptyDir: '这个文件夹里没有 .jps 文件',
  rootLabel: '工作区',
  onlyListed: '只列出文件夹与 .jps 文件',
  unsupported: '当前浏览器不支持选择文件夹（需要 Chrome / Edge 等 Chromium 内核浏览器）；请改用「文件 → 导出」保存',
  noWorkspace: '还没有设工作区：请先在「文件 → 工作区…」里选一个文件夹',
  /**
   * adj724b：嵌入版（Obsidian）里**没有"选文件夹"这一步**——文库就是工作区。
   * 用户实测：原来的「新工作区」按钮会弹
   * `SecurityError: … Cross origin sub frames aren't allowed to show a file picker.`
   * （浏览器禁止跨源子框架弹文件选择器）⇒ 整块换成这句说明。
   */
  embeddedUsesVault: '当前工作区为 Obsidian 文库（嵌入版无需选择文件夹）',
  picked: (name: string): string => `工作区已设为「${name}」`,
  loadFailed: (reason: string): string => `读工作区失败：${reason}`,
  opened: (p: string): string => `已从工作区打开 ${p}`,
  openFailed: (p: string, reason: string): string => `打开 ${p} 失败：${reason}`,
  saved: (p: string): string => `已保存到工作区：${p}`,
  saveFailed: (p: string, reason: string): string => `保存到工作区失败（${p}）：${reason}`,
  saveHere: '存到此处',
  saveNameLabel: '文件名',
  namePlaceholder: '例如 小星星',
  saveBtn: '保存',
  closeBtn: '关闭',
  // ---- adj540 续：文件操作（新建/改名/移动/删除；破坏性操作必须二次确认） ----
  // 文案从简（用户要求"能指明指示为宜"）：右侧按钮列窄（96px），短标签更好读、也更少换行。
  // 「改名/移动」而不写"重命名/移动到…"，「新建」在本面板里只有"新建文件夹"一种含义，
  // 「存到此处」= 把当前谱写进当前目录（与全局「保存 Ctrl+S」区分开）。
  // adj558（用户反馈"新建夹太口语化"）：「新建夹」→「新建目录」；行为也改——创建完成后
  // **自动进入**该新目录（与文件管理器一致），不再停在父目录让用户再点一次进去。
  /** 行尾「更多操作」按钮（打开/改名/移动/删除） */
  moreActions: '更多操作',
  /** adj540：多选时的选中条数 */
  selectedCount: (n: number): string => `已选 ${n} 项`,
  actOpen: '打开',
  /** adj540：写回当前谱绑定的工作区文件；未绑定时等同于「另存」（不出现"按了没反应"的死路） */
  actSave: '保存',
  /** adj540：把当前谱**写进当前目录**（可改文件名） */
  actSaveAs: '另存',
  /** adj540：在当前目录新建一份空谱（用「新建」模板内容）并打开 */
  actNewScore: '新建',
  actRename: '改名',
  actMove: '移动',
  actDelete: '删除',
  /** adj558（v0.28.2，用户要求）：「新建夹」→「新建目录」——"夹"字偏口语，目录更准确 */
  actNewFolder: '新建目录',
  /** adj540：分组下拉的第三组——作用在选中项上的操作（改名/移动/删除） */
  actOps: '操作',
  newScorePlaceholder: '新谱名（不用写 .jps）',
  folderNamePlaceholder: '文件夹名',
  renamePlaceholder: '新名字（不用写 .jps）',
  confirmBtn: '确定',
  cancelBtn2: '取消',
  /** 移动模式：进入目标目录后再点它 */
  moveHere: '移到此处',
  moveCancel: '取消',
  /** 永久删除的二次确认（FSA 没有回收站） */
  deleteFileConfirm: (n: string): string => `永久删除「${n}」？删了就找不回来了（浏览器文件 API 没有回收站）`,
  deleteDirConfirm: (n: string): string => `永久删除空文件夹「${n}」？`,
  dirNotEmpty: (n: string): string => `「${n}」里还有东西，本轮只删空文件夹（避免连带删掉里面其它文件）`,
  exists: (n: string): string => `已存在同名「${n}」，换个名字`,
  invalidName: '名字不能为空，也不能包含 / \\ 或 ..',
  /** adj558：「已新建文件夹」→「已新建目录」——与新文案一致 */
  dirCreated: (n: string): string => `已新建目录「${n}」`,
  /** adj540：新建谱（写进工作区当前目录） */
  created: (n: string): string => `已新建「${n}」`,
  renamed: (a: string, b: string): string => `已把「${a}」重命名为「${b}」`,
  moved: (n: string, dir: string): string => `已把「${n}」移动到「${dir || '根目录'}」`,
  /** adj540：多选批量移动/删除的汇总文案 */
  movedMany: (n: number, dir: string): string => `已移动 ${n} 个到「${dir || '根目录'}」`,
  deletedMany: (n: number): string => `已删除 ${n} 项`,
  /** 部分成功：如实报出成功数与第一个失败原因（不假装全成功） */
  opPartial: (ok: number, fail: number, reason: string): string => `${ok} 项成功、${fail} 项失败（${reason}）`,
  /** 多选时删除确认里的条数提示 */
  deleteManyConfirm: (n: number): string => `永久删除选中的 ${n} 项？删了就找不回来了`,
  /** adj540：过滤框（用户要求）——过滤时列出符合条件的 .jps（平坦列表，便于快速打开）
   *  adj545：右栏固定宽度很窄，占位符只留最短提示（完整规则在 `filterHint` 悬浮提示里）
   *  adj580（用户反馈）：**过滤范围 = 当前目录及其下级**（不再是整个工作区）——用户在某层目录里
   *  过滤时想的就是"在这个目录里找"；人在根目录时行为不变（= 整个工作区）。 */
  filterPlaceholder: '过滤 .jps…',
  filterClear: '清空过滤',
  /** adj540（用户要求）：过滤框旁的一键按钮——填入 `*` 即列出全部 .jps（再点一下清空） */
  filterAll: '*',
  filterAllTitle: '列出当前目录（含子目录）全部 .jps',
  /** 通配符说明（输入框 title）——adj580：连范围一起说清 */
  filterHint: '在当前目录及其子目录里过滤；不含 * ? 时按子串匹配，含 * ? 时按通配符整体匹配（如 小星*、*练习*、第?课）',
  searchEmpty: '当前目录里没有匹配的 .jps',
  /** adj543：首次过滤要建立索引（走一次目录树）——给个等待提示，别让用户以为"什么都没有" */
  searchIndexing: '正在读取当前目录…',
  /**
   * adj546（用户实测 5550 文件/117 目录的工作区要 27 秒）：扫描期间显示进度——
   * `边扫边出结果` + 计数，用户能看到在动，也能马上打开已找到的谱。
   */
  scanning: (scanned: number, found: number, ms: number): string =>
    `正在扫描…已查 ${scanned} 项 / 找到 ${found} 个 / ${(ms / 1000).toFixed(1)}s`,
  /**
   * adj590（用户要求"工作区在索引操作时，应该有提示消息"）：建索引是**几十秒级**的长操作，
   * 而且现在会在"打开面板/切工作区"之后**空闲时自己跑起来**——不说一声用户只会觉得"卡住了/没反应"。
   * 这句放在列表**最上方**（与其它进行中提示同款：转圈 + 文案，滚动也看得见）。
   */
  indexing: (scanned: number, found: number): string => `正在建立索引：已扫描 ${scanned} 项 / 找到 ${found} 个谱`,
  /** adj590：索引建好后的**收尾提示**（用户要求"应该有提示消息"）——告诉它成了、有几个谱、花了多久 */
  indexReady: (found: number, sec: string): string => `索引完成：${found} 个谱（用时 ${sec}s）`,
  /** adj590：索引没建成时也要说（否则用户以为"就是没有这些谱"） */
  indexFailed: '建立索引失败（可稍后在「操作 ▾ → 重新扫描工作区」重试）',
  /**
   * adj607（E-2026-296）：**没授权时不许建索引**——未授权的目录句柄读取一律 `NotAllowedError`，
   * 扫出来会是一份"0 命中"的空索引，装上之后过滤会一直短路（用户现象：`*` 什么都不出）。
   * 这句只在"面板还停在授权界面、用户却触发了建索引"时出现。
   */
  indexNeedGrant: '还没授权访问这个文件夹，暂时不能建立索引',
  /**
   * adj607：**整棵树都没读到**（根目录被拒 / 目录被删 / 授权被撤）——
   * 必须与"工作区里确实没有 .jps"区分开，否则用户会以为自己的谱不见了。
   */
  indexUnreadable: '没能读取工作区目录，索引未建立（确认文件夹还在、并重新授权后会自动重试）',
  /** adj546：命中太多时不全部渲染（手机上一次画几千行要几百毫秒），如实说明并引导缩小范围 */
  searchCapped: (total: number, shown: number): string => `共 ${total} 个，只显示前 ${shown} 个（输入关键词可缩小范围）`,
  /**
   * adj547（用户反馈）：点目录/文件后到内容出来之间是"黑的"——用户分不清是"不能点""没响应"还是"在忙"。
   * 所有会等的动作都必须在界面上**立刻**显示"进行中"的提示（转圈 + 说清在做什么）。
   */
  enteringDir: (name: string): string => `正在进入「${name}」…`,
  openingFile: (name: string): string => `正在打开「${name}」…`,
  loadingWorkspace: '正在读取工作区…',
  refreshing: '正在刷新…',
  readingTarget: '正在读取目标目录…',
  /** adj548：上次所在的目录已不存在（被外部删/移动）⇒ 回到仍存在的最外层并说明 */
  dirGone: (was: string, now: string): string => `上次所在的「${was}」已不在，已回到「${now || '工作区根目录'}」`,
  /** adj540（用户报告 `*` 仍看不到文件）：读不动的目录也主动说出来——"没搜到"与"没搜完/搜到一半"是两件事 */
  searchBlockedDirs: (dirs: string[]): string =>
    `有 ${dirs.length} 个子目录读不动（可能在里面），已跳过：${dirs.slice(0, 3).join('、')}${dirs.length > 3 ? '…' : ''}`,
  /** 命中数被上限截断时如实告知（否则用户以为"文件不见了"） */
  searchTruncated: (n: number): string => `匹配项很多，先显示前 ${n} 个（输入更具体的关键词可缩小范围）`,
  /** 过滤结果条数（侧栏标签用） */
  searchResults: (n: number): string => `匹配 ${n} 个`,
  /** 过滤模式下的说明（点击结果=直接打开） */
  searchHint: '点一条直接打开',
  /** 只有一个下拉按钮（用户要求）：点它弹出操作菜单 */
  menuBtn: '操作',
  /** 过滤模式下不能改名/移动/删除（没有勾选项） */
  opNeedsSelection: '先清空过滤，在目录里勾选文件',
  /** 重命名只支持单个 */
  renameSingleOnly: '重命名一次只能改一个',
  /** 多选里含目录时不能移动 */
  moveDirUnsupported: '选中的里有文件夹，移动只支持 .jps 文件',
  deleted: (n: string): string => `已删除「${n}」`,
  deletedOpenFile: (n: string): string => `「${n}」已被删除——内容仍在编辑器里，可用「保存当前谱到此处」重新存一份`,
  /**
   * adj544（E-2026-251）：绑定的谱属于**另一个工作区** ⇒ 保存**拒绝写盘**。
   * 必须说清"东西在哪、为什么没写、接下来怎么办"——静默写错文件不可接受。
   */
  boundToOtherWorkspace: (boundWs: string, currentWs: string, path: string): string =>
    `这份谱绑定在工作区「${boundWs}」的 ${path}，当前工作区是「${currentWs}」——为避免写错文件，本次未保存。请切回「${boundWs}」再保存，或用「操作 → 另存」存到当前工作区`,
  /** adj544：绑定的原文件已不在（被外部移动/删除）⇒ 提示并转另存，不静默重建同名文件 */
  sourceMissing: (path: string): string => `原文件 ${path} 已不在工作区里（可能被移动或删除）——请用「操作 → 另存」确认保存位置`,
  /** adj544：重启后恢复了来源绑定，需重新授权才能写回原文件 */
  bindingRestored: (wsName: string, path: string): string =>
    `这份谱来自工作区「${wsName}」的 ${path}：重新授权该工作区后，「保存」即可写回原文件`,
  /** adj544：最近工作区列表标题（面板可一键切回） */
  recentWorkspaces: '最近的工作区',
  /** adj546：手动重新扫描工作区（外部新增文件 / 索引过期时用；平时靠落盘索引秒开） */
  rescan: '重新扫描工作区',
  /** adj544：从"最近工作区"切回失败（目录被删/移动、授权被拒） */
  activateFailed: (n: string): string => `无法打开工作区「${n}」（目录可能已被移动/删除，或授权被拒绝）`,
  verifyFailed: (n: string): string => `「${n}」写入后校验不一致，已保留原文件（请重试）`,
  opFailed: (n: string, reason: string): string => `「${n}」操作失败：${reason}`,
  /** 目录暂不支持重命名/移动（递归搬运风险大，本轮只做文件） */
  dirOpUnsupported: '文件夹暂不支持重命名/移动（本轮只对 .jps 文件做）',
  /** 点了"选择文件夹"但系统没弹选择器（静默失败）时的可操作指引 —— 见 ERRORS-LOG E-2026-241 */
  pickerNoResponse:
    '系统没有弹出文件夹选择器。如果你是从桌面图标（已安装的应用）打开的，请改用 Chrome 浏览器打开本站再试一次——数据不会丢。',

  // ---- adj575（用户要求）：**工作区选择界面** ----
  // 用户口径（adj575）："先显示界面，有一个清单列出之前已打开过的工作区以供选择，每个工作区后面有个叉用于遗忘该项，
  // 有一个「打开其它目录」按钮用于打开选择目录的对话框"——即**不要**一按就直接弹系统对话框，
  // 先把清单摆出来（并把原先"待授权/目录已不在"那一屏的信息并进来）。
  // adj577（用户要求）：改成**左右分栏**（左=清单、右=操作按钮），按钮改名「**新工作区**」，
  // **取消**「返回文件列表」——改为**点当前工作区那一项**即回到文件列表；
  // 当前工作区**不给 ✕**（它必须一直留在清单里 ⇒ "已打开的工作区才能成为当前工作区"）。
  chooseTitle: '选择工作区',
  chooseHint: '点清单里的工作区直接打开；「新工作区」可选一个没打开过的文件夹。',
  /** 每项后面的 ✕ —— 语义要说清：只动这份清单，不动磁盘、也不动当前正在用的工作区 */
  forgetTitle: '从这份清单里移除（不会删除磁盘上的文件夹）',
  forgotten: (n: string): string => `已从最近列表移除「${n}」`,
  /** adj577：按钮文案由「打开其它目录」改为「**新工作区**」，并移到右侧操作区 */
  openOther: '新工作区',
  /** adj577：当前工作区**没有 ✕**——点它即回到文件列表（因此不再需要「返回文件列表」按钮） */
  backToFilesTitle: '点它回到文件列表',
  /** adj577：新选的目录本来就是清单里那个（同一个目录只能有一个工作区）⇒ 直接切过去 */
  reused: (n: string): string => `这个文件夹已经是工作区「${n}」了，已直接切过去`,
  chooseEmpty: '还没有打开过的工作区',
  /** 清单里标出"正在用的那个" */
  currentTag: '当前',
} as const

/**
 * adj394：编辑区「问题提示条」文案（脚本不符合语法时在编辑区内显式可见，
 * 此前只有行号栏着色 + 悬停 tooltip，用户看不出哪里不对）
 */
export const problemCopy = {
  /** 无问题时的状态文字（状态栏小圆点 tooltip） */
  clean: '语法检查通过',
  /** 有错误时的状态文字 */
  hasErrors: '有语法错误',
  /** 仅有警告时的状态文字 */
  hasWarnings: '有语法告警',
  /** 分级标签（与 summarizeProblems 的 label 一致） */
  error: '错误',
  warning: '警告',
  /** 提示条标题：N 个问题（X 错误 / Y 警告） */
  title: (total: number, errors: number, warnings: number): string => {
    const parts: string[] = []
    if (errors > 0) parts.push(`${errors} 个错误`)
    if (warnings > 0) parts.push(`${warnings} 个告警`)
    return `${total} 个问题（${parts.join(' / ')}）`
  },
  /** 行尾提示：点击跳到该位置 */
  jumpHint: '点击跳转到该位置',
  expand: '展开',
  collapse: '收起',
  /** adj394：问题条里「正确写法」的前缀（hint 由引擎给出） */
  correctPrefix: '正确写法：',
  /** 打开内置「语法速查」对话框 */
  syntaxHelp: '语法速查',
  /** adj462：每条问题行首的「正确写法」展开/收起（默认收起，按需展开） */
  expandHint: '展开正确写法',
  collapseHint: '收起正确写法',
} as const

/**
 * adj462：底部 dock 文案（告警 / 试听 / 导出 / 设置 共用一个 dock，互斥切换）
 */
export const dockCopy = {
  /** 面板标签 */
  tabProblems: '告警',
  tabTryout: '试听',
  tabExport: '导出',
  /**
   * adj603（用户要求）：原「设置」页签**拆成两个**——「全局」（视图/主题/音色库，本机偏好）
   * 与「谱面」（布局/字体，随谱保存）。
   */
  tabSettings: '全局',
  /** adj492：「关于」从弹窗迁入 dock */
  tabAbout: '关于',
  /** adj540：工作区（选文件夹当工作区；移动端的打开/保存主路径） */
  tabWorkspace: '工作区',
  /** adj603（用户要求）：底栏「谱面」页签（谱面设置：布局 / 字体）——紧跟在「全局」之后 */
  tabScore: '谱面',
  /** adj562：导入（粘贴源码导入）——排在工作区之后（用户要求） */
  tabImport: '导入',
  /**
   * adj641（用户要求）：**查找替换**页签——用户口径："编辑区只有 Ctrl+F 搜索操作，还缺少一个替换操作……
   * 在底栏 dock 里增加一个查找替换页签，将查找和替换进行整合"。排在「导入」之后（同属"改内容"的动作）。
   */
  tabFind: '查找替换',
  /** 标题栏 × 按钮 */
  closeTitle: '关闭底栏',
  /** adj541：底栏展开/收起（编辑区左下角悬浮按钮 + 页签栏里的收起按钮） */
  expandTitle: '展开底栏',
  /**
   * adj591（用户要求"脚本有告警时，打开底栏先切到告警窗口，否则不切换"）：
   * 有告警时「展开底栏」按钮的 tooltip——点开会**先切到告警页签**，先说清楚再去。
   */
  expandWithProblems: (n: number): string => `展开底栏（先看告警：${n} 条）`,
  collapseTitle: '收起底栏',
  /** 顶部抓手（拖拽调整 dock 高度） */
  resizeTitle: '拖动调整底栏高度',
  /**
   * adj556（用户要求"页签始终显示图标，靠左右滚动查看视界外的页签"）：当页签多到放不下、
   * `.tool-dock-tabstrip` 横向溢出时，左右两端各出现一个**翻页箭头**按钮（只在"该方向还有
   * 内容"时才显示；滚到尽头就消失）。文案与输入条 adj553 那对保持一致语义。
   */
  tabsLeftTitle: '向左翻看页签',
  tabsRightTitle: '向右翻看页签',
  /** 无告警时告警面板的占位文字 */
  noProblems: '语法检查通过，没有问题。',
  /** 导出进行中（状态栏动态指示），clickHint 提示可点击查看 */
  exportRunning: (label: string): string => `导出中：${label}`,
  exportRunningHint: '点击查看导出面板',
  /**
   * adj520：dock 高度档位切换按钮（位于关闭按钮左侧）—— 单按钮 4 相位循环
   * `建议 → 最大 → 建议 → 最小 → 建议`，图标（`上.png` / `下.png`）方向按"点一下会往哪走"切换。
   */
  sizeGroupTitle: '底栏高度档位',
  /** 三个档位的中文名（用于按钮 title / aria-label 的拼装） */
  sizeName: { max: '最大', suggested: '建议', min: '最小' } as const,
  /** 按钮提示：当前档 + 点一下会到哪一档 */
  sizeTitle: (cur: string, next: string): string => `底栏高度：${cur}（点击 → ${next}）`,
} as const

/**
 * adj641（用户要求）：**查找替换面板**（底栏「查找替换」页签）的文案。
 *
 * 用户口径："页签里有查找内容框、替换内容框，有查找统计，还有查找按钮、替换按钮。"
 * 匹配与替换的**算法**在 `editor/findReplace.ts`（纯函数、smoke 断言），这里只有文案。
 */
export const findCopy = {
  /** 两个输入框的行标签 */
  findLabel: '查找',
  replaceLabel: '替换',
  findPlaceholder: '要查找的内容（支持 # $ [ ] 等语法字符，按字面匹配）',
  replacePlaceholder: '替换为（留空 = 删除匹配到的内容）',
  /** 查找按钮（上一个 / 下一个） */
  prev: '上一个',
  next: '下一个',
  prevTitle: '查找上一个（Shift+Enter）',
  nextTitle: '查找下一个（Enter）',
  /** 替换按钮（当前项 / 全部） */
  replaceOne: '替换',
  replaceOneTitle: '替换当前一处，并继续找下一处',
  replaceAll: '全部替换',
  replaceAllTitle: '一次替换全部匹配（可一步撤销）',
  /** 区分大小写开关（默认开：`.jps` 里 `Q:` 与 `b` 这类大小写有语义） */
  caseSensitive: '区分大小写',
  caseSensitiveTitle: '区分大小写（默认开：谱面源码里大小写有意义）',
  /** 查找统计 */
  statIdle: '输入要查找的内容',
  statNone: '无匹配',
  statTotal: (n: number): string => `共 ${n} 处`,
  statCurrent: (i: number, n: number): string => `第 ${i}/${n} 处`,
  /** 一次性提示（较长的说明放在「说明」行，常驻可见） */
  hint: '查找为字面匹配（不解析正则）；「替换」改当前一处并自动续到下一处，「全部替换」一次改完、可一步撤销。',
  /** 替换结果提示（短暂显示在统计行，避免额外弹 toast 打断输入） */
  replaced: (n: number): string => `已替换 ${n} 处`,
} as const

/**
 * adj526：数值调节文案（设置里的 px 框、顶栏预览比率、编辑器字号共用一套操作）
 *
 * 由来（用户报，手机端）：数字输入框在手机上不显示原生上下小按钮，而部分字段又限定范围，
 * 配合"输入即钳制"导致数字改不动。现统一为三类操作：**点一下用键盘输入**、
 * **`−`/`+` 步进（可按住连续）**、**按住数值上下拖**（触屏先长按）。
 */
export const numCopy = {
  /** `−`/`+` 步进钮（桌面靠原生 spinner，故只在触屏显示，见 CSS） */
  decrease: '减小（可按住连续调节）',
  increase: '增大（可按住连续调节）',
  /** 数值本身的提示：说明"按住上下拖"这条路径（输入框：还能直接打字） */
  scrubHint: '按住上下拖动可调节数值（左右拖动快速调节）；点一下可直接输入',
  /** adj529：顶栏预览比率的提示——**双击**即按预览区宽度适配 */
  zoomScrubHint: '按住上下拖动调节预览比例；双击按预览区宽度适配',
  /** 顶栏编辑器字号的提示（该处是显示值，旁边另有 `A−`/`A+` 按钮） */
  fontSizeScrubHint: '按住上下拖动调节字号（两侧 A−/A+ 也可调节）',
} as const

/**
 * adj462：导出面板（底栏 dock 内，流式布局）文案——从 ExportDialog 的字面量收敛到此处
 */
export const exportCopy = {
  svgLabel: 'SVG 矢量图',
  pngLabel: 'PNG 高清图片',
  jpgLabel: 'JPG 图片（白底）',
  // adj626（用户要求）：PDF 改走**系统打印 → 另存为 PDF**（矢量、放大不糊），
  // 不再默认用"SVG 栅格化内嵌"的位图 PDF；位图那份保留为二级入口（无需对话框、一键出文件）。
  pdfLabel: 'PDF 文档（打印·矢量）',
  pdfImageLabel: 'PDF 图片（位图）',
  pdfPrintHint:
    'PDF：调用系统打印对话框 → 目标选「另存为 PDF」。矢量输出、放大不糊，且不开新窗口（无弹窗拦截）；' +
    '默认文件名取谱面第一个 B:（标题）。需要不经对话框直接拿文件时，用「PDF 图片」按上面的清晰度导出。',
  midiLabel: 'MIDI 音频（分轨）',
  wavLabel: 'WAV 音频（高保真）',
  mp3Label: 'MP3 音频（体积小）',
  jpsLabel: 'iJipu 源文件',
  scaleLabel: '图片清晰度',
  scaleHint: '适用于 PNG / JPG / PDF 图片',
  busy: '导出中…',
  /** 有语法错误时图片/PDF 导出的拦截提示 */
  blockedByError: '存在语法错误，无法导出。请先修正脚本。',
  errorHint: '当前脚本存在语法错误，图片/PDF 导出需先修正。',
} as const

/**
 * adj509：试听音色选择对话框（设置 → 音色库 → 「指定音色」按钮触发）文案
 */
export const voicePickerCopy = {
  /** 对话框标题 */
  title: '指定试听音色',
  /** 搜索框 placeholder */
  searchPlaceholder: '按名称搜索',
  /** 顶部统计行 */
  summary: (selected: number, total: number): string =>
    `已选 ${selected} / ${total} 种 GM 音色（仅勾选项进入「试听」面板的音色下拉）。`,
  /** 快捷按钮 */
  selectAll: '全选',
  clearAll: '全消',
  invert: '反选',
  selectGroup: '选本组',
  clearGroup: '消本组',
  /** 底部按钮 */
  done: '完成',
} as const

/** adj369：保存阶段中文名（保存慢时的提示与控制台明细用） */
export const savePhaseCopy = {
  open: '打开写入流',
  write: '写入数据',
  commit: '提交文件',
  perm: '权限申请',
  store: '写入草稿名',
  ui: '更新界面状态',
} as const

/** 试听播放文案（adj344：固定 SpessaSynth 高保真——仅保留「音色」下拉相关文案） */
export const playbackCopy = {
  /** 音色下拉 label（固定高保真，只列启用收藏音色） */
  synthLabel: '音色',
  /** adj366：音色下拉的「自动」项——跟随谱面（@乐器 / 声部名）路由，非固定音色 */
  voiceAuto: '自动（跟随谱面声部/乐器）',
  /** adj448：选了具体音色时的提示——按设计它会覆盖谱面的 `Y:` 乐器（用户曾因此以为「多声部 Y: 不生效」）
   *  adj455：改为「全篇统一音色」（含 `{bz}`/`{dsb}` 伴奏声部与曲内 `@乐器名@` 切换），文案同步 */
  voiceOverrideHint: '已指定音色：全篇（所有声部，含 `{bz}`/`{dsb}` 伴奏与曲内 `@乐器名@` 切换）都用它演奏；要按谱面音色演奏请选「自动」。',
  /** adj455：选了具体音色、且谱面里确有 `@乐器名@` 切换时的补充提示（`{n}` = 处数） */
  voiceOverrideAtHint: (n: number) =>
    `谱面里有 ${n} 处 \`@乐器名@\` 显式音色切换，已被上面的试听音色统一覆盖（听不到切换是正常的；要按谱面演奏请选「自动」）。`,
  /** 音源加载状态 */
  loading: '加载中…',
  loaded: '已加载',
  failedFallback: '加载失败',
  /** adj416：桌面端随安装包内置音源（安装目录 generaluser_gs.sf2）→ 直接读取，无需下载 */
  builtinBankHint: '✓ 使用随应用内置音源（安装目录 generaluser_gs.sf2），无需下载、离线可用。',
} as const

/**
 * adj538：**外部打开**（双击 `.jps` / 文件关联 / 右键"打开方式"）相关文案。
 * 链路：NSIS 注册关联 → 双击时以 `"ijipu.exe" "%1"` 启动 → 已有窗口由单实例插件接管 →
 * 前端拉取队列并载入；此后 Ctrl+S 直接写回**原文件**（不再要求"另存为"）。
 */
export const externalOpenCopy = {
  /** 从系统打开成功（给用户一个"文件确实换了"的确认，尤其是窗口被置前时） */
  opened: (name: string) => `已打开 ${name}.jps`,
  /** 一次打开多个：载入第一个，并告知还有几个没打开 */
  openedWithExtra: (name: string, extra: number) => `已打开 ${name}.jps（另有 ${extra} 个文件未打开）`,
  /** 读取失败（路径没权限/文件被删/不是文本）——如实报错，不静默 */
  openFailed: (name: string, reason: string) => `打不开 ${name}.jps：${reason}`,
  /** 写回原文件成功 */
  savedToSource: (name: string) => `已保存到 ${name}.jps`,
  /** 写回失败（Rust 侧回读校验不过/无权限/文件被移走）——提示另存为，绝不谎报已保存 */
  saveToSourceFailed: (name: string, reason: string) => `保存到 ${name}.jps 失败：${reason}（可改用「另存为」）`,
} as const
