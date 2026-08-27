/**
 * 品牌文案库 —— 所有面向用户的品牌文字集中于此，便于统一修改。
 */
import { brand } from './tokens'

/** 关于本软件（“关于我们”） */
export const aboutCopy = {
  title: `${brand.name}（${brand.nameZh}）`,
  tagline: brand.taglineMain,
  /** 品牌介绍正文 */
  body: [
    `${brand.name}（中文名：${brand.nameZh}）—— 下一代代码式简谱制谱引擎。`,
    '我们致力于将编程语言的严谨逻辑，注入中国传统简谱的创作之中。通过一套极简的 .jps 标记语言，让音乐人像写代码一样编排音符，让程序员像调参一样调整音高。敲码即谱，让简谱创作从此进入“脚本时代”。',
  ].join('\n'),
  /** 用户身份 */
  userIdentity: `用${brand.name}写简谱的人，我们称为「${brand.userTitle}」（${brand.userTitleEn}）。`,
  /** 命令行概念 */
  cli: `命令行工作流：${brand.cli.compile} 编译乐谱，${brand.cli.run} 试听播放。`,
  /** 底部情怀 */
  footer: brand.taglineFooter,
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
  saveFailed: '保存失败：文件句柄可能失效或文件被占用，请用「文件 → 另存为」重新保存',
  saveAsFailed: '另存为失败，请检查文件位置是否可写',
  saveUnsupported: '当前环境不支持保存到磁盘，请使用「文件 → 另存为」或导出',
  // adj281：非安全上下文（http:// 或 file://）或非 Chromium 内核下无 Web File System Access API，
  // 降级用 <input type=file> 载入 .jps 文本——已载入但无法写回磁盘，提示改用「导出」保存
  openFallbackNotice: '已载入文件；此环境无法写回磁盘，请用「文件 → 导出」保存成果',
} as const
