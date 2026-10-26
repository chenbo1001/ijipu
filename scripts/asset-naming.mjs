/**
 * scripts/asset-naming.mjs — 资源安装包命名规则的**唯一出处**（2026-10-26 用户口径）
 *
 * 用户要求：音色库/工具等资源文件较大，**每个资源文件单独一个安装包**；
 * 安装包名必须能看出「资源类型 + 资源名称」，方便按需下载与区分。
 *
 * 固定格式（ASCII，下载链接/命令行友好）：
 *
 *   iJipu-<Type>-<ResourceId>_<Version>_<Arch>-setup.exe
 *
 *  · `Type`：`SoundFont`（音色库）/ `Tool`（工具）
 *  · `ResourceId`：稳定 ASCII 标识（大写字母开头，只含字母数字），如 `GeneralUserGS` / `FluidR3GM` / `FFmpeg`
 *  · `Version`：**资源自身版本**（不是 iJipu 应用版本；资源不改就不升版本、不重打包）
 *  · `Arch`：`x64`（当前桌面安装包）
 *
 * 例：
 *   iJipu-SoundFont-GeneralUserGS_1.471.0_x64-setup.exe
 *   iJipu-SoundFont-FluidR3GM_1.0.0_x64-setup.exe
 *   iJipu-Tool-FFmpeg_1.0.0_x64-setup.exe
 *
 * 这条规则同时被 `build-assets-installer.mjs`、`check-assets-installer.mjs` 与冒烟断言使用；
 * 改格式只改这里，三处自动一致。
 */

/** 资源类型 → 安装器 UI 里的中文名 */
export const RESOURCE_TYPE_CN = {
  SoundFont: '音色库',
  Tool: '工具',
}

/** 合法资源类型 */
export const RESOURCE_TYPES = Object.keys(RESOURCE_TYPE_CN)

/** 资源 id：**大写字母**开头，只含 ASCII 字母/数字（不跟中文名，避免 URL/文件名编码问题） */
export const RESOURCE_ID_RE = /^[A-Z][A-Za-z0-9]*$/

/** 资源自身版本：三段数字（例 1.471.0 / 1.0.0）；**不是应用版本** */
export const RESOURCE_VERSION_RE = /^\d+\.\d+\.\d+$/

/** 校验一个资源描述；返回错误数组（空 = 合法） */
export function validateResourceDescriptor(r) {
  const errors = []
  if (!r || typeof r !== 'object') return ['资源描述不是对象']
  if (!RESOURCE_TYPES.includes(r.type)) errors.push(`type 必须是 ${RESOURCE_TYPES.join(' / ')}`)
  if (typeof r.id !== 'string' || !RESOURCE_ID_RE.test(r.id)) {
    errors.push('id 必须大写字母开头、只含 ASCII 字母/数字（例：GeneralUserGS）')
  }
  if (typeof r.name !== 'string' || r.name.trim() === '') errors.push('name 不能为空')
  if (typeof r.version !== 'string' || !RESOURCE_VERSION_RE.test(r.version)) {
    errors.push('version 必须是资源自身版本（三段数字，例 1.471.0；不是应用版本）')
  }
  if (typeof r.source !== 'string' || r.source.trim() === '') errors.push('source 不能为空')
  // 第三方音色库必须随附许可（分发义务；Tool 可选）
  if (r.type === 'SoundFont' && (typeof r.license !== 'string' || r.license.trim() === '')) {
    errors.push('SoundFont 必须提供 license（第三方许可文件路径）')
  }
  if (r.license !== undefined && (typeof r.license !== 'string' || r.license.trim() === '')) {
    errors.push('license 若提供，必须是非空路径')
  }
  if (typeof r.dir !== 'string' || r.dir.trim() === '' || r.dir.includes('..') || /^[\\/]/.test(r.dir)) {
    errors.push('dir 必须是安装目录下的相对子目录（不能为空、不能 ..、不能绝对路径）')
  }
  if (typeof r.file !== 'string' || r.file.trim() === '' || /[\\/]/.test(r.file) || r.file.includes('..')) {
    errors.push('file 只能是文件名（不能含路径分隔符 / ..）')
  }
  return errors
}

/** 安装包文件名（规则唯一出处） */
export function resourceInstallerName(type, id, version, arch = 'x64') {
  return `iJipu-${type}-${id}_${version}_${arch}-setup.exe`
}
