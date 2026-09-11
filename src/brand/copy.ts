/**
 * 品牌文案库 —— 所有面向用户的品牌文字集中于此，便于统一修改。
 */
import { brand } from './tokens'

/** 关于本软件（“关于我们”） */
export const aboutCopy = {
  title: `${brand.nameZh}（${brand.name}）`,
  tagline: brand.taglineMain,
  /** 品牌介绍正文 */
  body: [
    `${brand.nameZh}（英文名：${brand.name}）—— 优秀高效的代码式简谱制谱引擎。`,
    '我们致力于将编程语言的严谨逻辑，注入中国传统简谱的创作之中。通过一套极简的 .jps 标记语言，让音乐人像写代码一样编排音符，让程序员像调参一样调整音高。码即成，谱自现，让简谱创作从此进入“脚本时代”。',
    '本脚本规则高度兼容「番茄简谱」脚本——复刻自原 doc.lezhi99.com/zhipu 在线编辑器的脚本规范，原网站导出的谱子可直接复制进来使用，`.jps` 后缀与原版一致。',
    '特别致谢「番茄简谱」原作者与社区——本项目在脚本语法、谱面解析、UI 交互等方面大量参考了原站实现，谨以此向原项目致敬。',
  ].join('\n'),
  /** 用户身份 */
  userIdentity: `用${brand.nameZh}写简谱的人，我们称为「${brand.userTitle}」（${brand.userTitleEn}）。`,
  /** 作者署名（adj373） */
  author: `作者：${brand.author}`,
  /** 作者联系方式（邮箱留空时为空串 → 关于对话框不渲染该行） */
  contact: brand.authorEmail ? `联系：${brand.authorEmail}` : '',
  /** 命令行概念 */
  cli: `命令行工作流：${brand.cli.compile} 编译乐谱，${brand.cli.run} 试听播放。`,
  /** 底部情怀 */
  footer: brand.taglineFooter,
  /** 致敬说明（较短一句，显示在 footer 下方） */
  acknowledgement: '本项目以 AGPL-3.0 协议开源，向「番茄简谱」社区致敬。',
  /** 开源协议说明 */
  license: '本项目基于 GNU Affero General Public License v3.0（AGPL-3.0）发布，欢迎学习、修改与再分发。',
} as const

/** 捐赠/支持作者（Q-10）。donateImage 为微信赞赏码图片路径（public/ 下）；为空则不显示捐赠入口。
 *  按钮文案见 donate.label；「关于」对话框点击后打开模态框展示赞赏码。 */
export const donate = {
  /** 微信赞赏码图片路径（public 下，如 '/good.png'）——留空 = 不显示捐赠入口 */
  image: '/good.png',
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
  pageConfig: '页面设置',
  play: '试听播放',
  about: `关于 ${brand.name}`,
  currentFile: '当前乐谱',
  defaultFileName: '未命名',
  unsaved: '未保存',
  viewCode: '编码',
  viewSplit: '拆分',
  viewPreview: '预览',
  statusReady: '就绪',
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
  // adj281：非安全上下文（http:// 或 file://）或非 Chromium 内核下无 Web File System Access API，
  // 降级用 <input type=file> 载入 .jps 文本——已载入但无法写回磁盘，提示改用「导出」保存
  openFallbackNotice: '已载入文件；此环境无法写回磁盘，请用「文件 → 导出」保存成果',
  // adj370：打开文件必须给出反馈（此前失败静默 return false，用户无法判断是否打开成功）
  openOkPrefix: '已打开：',
  openFailedPrefix: '打开失败：',
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
  /** 音源加载状态 */
  loading: '加载中…',
  loaded: '已加载',
  failedFallback: '加载失败',
} as const
