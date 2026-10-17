/**
 * brand/version.ts — 版本常量（手动维护）
 *
 * 版本机制详见 docs/VERSIONING.md：
 *   MAJOR.MINOR.PATCH（SemVer）
 *   - PATCH：Bug 修复 / 细节调整 → +1
 *   - MINOR：功能新增（向后兼容）→ +1
 *   - MAJOR：破坏性变更 / 里程碑 → +1
 *
 * 构建日期与 git commit 由 scripts/gen-build-info.mjs 自动注入（npm run gen:info）。
 * 发布时与 package.json version、src-tauri/tauri.conf.json version 三处保持一致。
 */
import { BUILD_DATE, GIT_COMMIT } from '../gen/buildInfo'

/** 当前版本（手动递增） */
export const APP_VERSION = '0.67.0'

/** 完整版本串：v0.2.0 (2026-08-16 @a1b2c3d4) */
export const APP_VERSION_FULL = `v${APP_VERSION} (${BUILD_DATE} @${GIT_COMMIT})`

/**
 * adj975（**用户 2026-10-18 口径**）：「状态栏的版本号将**日期、指纹**也加上呀」。
 *
 * 状态栏那一格要按「版本号 + 构建日期 + commit 指纹」三段显示（`v0.67.0 (2026-10-17 @db3ffd76)`），
 * 而 `BUILD_DATE` / `GIT_COMMIT` 来自生成物 `gen/buildInfo`。组件不该直接去 import 那个生成物
 * （品牌层是版本信息的唯一出处，见本文件头）⇒ 在这里转出两段，供 `ui/EditorFootBar.tsx` 拼。
 */
export const APP_BUILD_DATE = BUILD_DATE
export const APP_COMMIT = GIT_COMMIT

/**
 * adj971（**用户 2026-10-18 口径**）：应用标题统一来源。
 *
 * 旧口径（`adj621`）：`爱记谱 iJipu - v0.36.0 (2026-09-23 @4ed877a3)` —— 把版本塞进标题，
 * 靠 OS 任务栏 / Alt+Tab / 浏览器页签"一眼看到版本"。
 *
 * **新口径**（用户原话：「壳端、PWA 标题、网站页签、插件的嵌入版 ijipu 的标题信息改为
 * "文件名.jps - 爱记谱 iJipu"，而版本信息显示在**状态栏的右侧**、**官网首页的左边**」）：
 *   · 标题 = **文件名 + 应用名**（见 `appTitleOf`）—— 打开多个窗口/页签时靠它区分是哪一份谱；
 *   · 版本 = 挪到应用**状态栏右侧**（`ui/EditorFootBar.tsx`，短版本号 + 悬停看完整串）与
 *     **官网首页左侧**（根 `index.html` 顶栏的品牌名右侧，`data-app-version` 占位）。
 *
 * 前缀 `爱记谱 iJipu` 与 `brand/tokens.ts` 的 brand.nameZh + brand.name 一致；
 * 放在 `version.ts` 而非 `tokens.ts`，是因为它天然跟版本号绑定，需要在版本递增
 * 时跟随（与 brand 名称"基本不变"语义不同）。
 */
export const APP_TITLE_PREFIX = '爱记谱 iJipu'

/**
 * 应用名（转成**正则安全**的形态）：下面要从文件名里把它剥掉，正则里不能塞裸字符串。
 * `APP_TITLE_PREFIX` 目前是「爱记谱 iJipu」（无正则元字符），但这里仍统一转义，改名字时不会静默失效。
 */
const PREFIX_RE_SRC = APP_TITLE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 文件名**前面**重复带着应用名的写法（中间可用 `-` / `—` / `–` 连接） */
const LEADING_PREFIX_RE = new RegExp(`^${PREFIX_RE_SRC}\\s*[-—–]\\s*`)
/** 文件名**后面**重复带着应用名的写法 */
const TRAILING_PREFIX_RE = new RegExp(`\\s*[-—–]\\s*${PREFIX_RE_SRC}$`)
/** **整个名字就是应用名**（`爱记谱 iJipu.jps`）——那就等于"没有名字"，走 `未命名` 兜底 */
const ONLY_PREFIX_RE = new RegExp(`^${PREFIX_RE_SRC}$`)

/**
 * adj976（**用户 2026-10-18 实报，截图**）：标题里应用名**只许出现一次**。
 *
 * 用户截图里的窗口标题是 `爱记谱 iJipu - 望月.jps - 爱记谱 iJipu` —— 应用名重复了两遍。
 * 查下来我们自己的代码只拼一次（`App.tsx` 设 `document.title` / `set_title` 都是这一个函数的返回值），
 * 所以重复来自**文件名本身**就带应用名（如 `爱记谱 iJipu - 望月.jps`，多半是早先某次另存/重命名带进去的）：
 * 于是"文件名 + 应用名"就把它拼了两遍。
 *
 * 口径：先把这个"已经写在文件名里的应用名"剥掉（**两端都剥、可反复剥**），再按
 * `文件名.jps - 爱记谱 iJipu` 拼一次 ⇒ 该函数因此是**幂等**的（传 `望月.jps - 爱记谱 iJipu` 也得同一结果）。
 *
 * ⚠ 只剥"独立成段的应用名"（前面/后面紧挨分隔符 `-` `—` `–` 或整个名字就是它）：
 * 像 `我的爱记谱 iJipu 笔记` 这种**夹在中间**的名字**不动**（那不是重复，是用户的文件名）。
 *
 * @param fileBase 文件名（可带 `.jps`；也允许已经带过应用名 —— 见上面的幂等说明）。
 */
export function appTitleOf(fileBase: string): string {
  let base = String(fileBase ?? '').trim()
  // 反复剥：可能"前后都带"，也可能剥完一段又露出 `.jps`
  for (;;) {
    const next = base
      .replace(LEADING_PREFIX_RE, '')
      .replace(TRAILING_PREFIX_RE, '')
      .replace(ONLY_PREFIX_RE, '')
      .replace(/\.jps$/i, '')
      .trim()
    if (next === base) break
    base = next
  }
  return `${base === '' ? '未命名' : base}.jps - ${APP_TITLE_PREFIX}`
}

