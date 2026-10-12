# 官网改版设计方案（介绍首页 + 文档页 + 应用分层）

> 目标：`https://ijipu.pages.dev/` 从"直接是应用"改成"介绍性首页"，应用挪到子路径，
> 首页提供功能图文介绍 + 一排入口链接（应用 / 手册 / 语法 / 桌面端 / Obsidian 插件 / 赞赏）。
>
> 本文是**方案**，不是已完成的工作。文末「需要拍板」一节列出必须由用户决定的点。

---

## 零、结论速览

| 问题 | 建议 | 理由（详见第二节） |
|---|---|---|
| 应用入口用哪个 URL | **`https://ijipu.pages.dev/app/`** | URL 干净、PWA 语义正确、以后能扩子路径；`ijipu.html` 有后缀美化跳转风险 |
| 首页技术 | 纯 HTML + CSS，加极小 TS（品牌 token / 版本号 / 卡片数据） | 营销页首屏要快，不需要 React |
| 文档页技术 | **不引入 VitePress**，复用 `docs/*.md` + 抽出应用内已有的 Markdown 渲染器 | 零新依赖、文档与页内帮助**同一份来源**、不会漂移 |
| 站点结构 | Vite 多页面（MPA）：`/`、`/app/`、`/manual/`、`/syntax/` | 一个构建链、一个 `dist`、Pages 不用改配置 |
| 必须同步改的"暗耦合" | **6 处**：Tauri 桌面壳、嵌入版（Obsidian）、Service Worker、manifest、下载链接、smoke 断言 | 不改会直接坏掉（见第六节） |

---

## 一、现状盘点（都已实地核对）

### 1.1 部署与产物

- **托管**：Cloudflare Pages，关联 GitHub 仓库 `snailhome/ijipu`，根目录 `ijipu/`，
  构建命令 `npm run build`，输出目录 `dist`（见 `docs/DEPLOY-PWA.md` 第 34 行）。
- **产物结构**（当前 `dist/`）：`index.html` / `manifest.webmanifest` / `sw.js` + `assets` `icons` `samples` `spessasynth`。
- **现状 URL 只有一个**：`/` 就是应用本身。没有首页、没有网页版文档页、没有 404 页、没有 sitemap。

### 1.2 会被"改 index.html"波及的地方（重要）

| 位置 | 现在指向 | 不改会怎样 |
|---|---|---|
| `src-tauri/tauri.conf.json` | `frontendDist: "../dist"`，窗口默认加载 `index.html`；`devUrl: http://localhost:5173` | **桌面端启动后显示介绍首页**（打不开编辑器）✗ |
| `vite.config.embed.mjs` | `rollupOptions.input: ./index.html` | **Obsidian 嵌入版变成介绍首页**（笔记里渲染不出编辑器）✗ |
| `scripts/embed-inline-plugin.mjs` | 硬编码 `dist-embed-app/index.html`（3 处） | 嵌入版单文件产物路径找不到 ✗ |
| `scripts/embed-emit.mjs` | 硬编码 `dist-embed-app/index.html` | 交给插件仓库的 `webappAssets.ts` 读不到 ✗ |
| `scripts/embed-smoke.mjs` | 硬编码 `dist-embed-app/index.html` | 嵌入版冒烟直接红灯 ✗ |
| `public/sw.js` | `PRECACHE` 含 `/`、`/index.html`；**任何导航离线都回退 `/index.html`** | 离线/弱网下打开 `/app/` 会拿到**首页 HTML** → 白屏 ✗ |
| `public/manifest.webmanifest` | `start_url: "/"`、`scope: "/"` | 装到手机主屏后**打开的是介绍页**，不是应用 ✗ |

### 1.3 文档现状（好消息）

- 应用内「帮助 → 操作手册 / 脚本语法说明」是 **`docs/USER-GUIDE.md`（190 行）与 `docs/SYNTAX.md`（约 1080 行）**
  经 `?raw` 导入，用**零依赖的自建 Markdown 渲染器**转 HTML（`src/dialogs/DocDialog.tsx`）。
- 该渲染器已支持：标题 / 多级列表 / 代码块 / **表格** / 引用块 / 行内 code、粗体、链接。
- **但**：`mdToHtml()` 写在 **React 组件文件里且没有导出**（受 oxlint `react/only-export-components` 限制）。
  ⇒ 要复用到网页文档页，**必须先把它抽成独立纯模块**（顺带把一个大文件拆干净）。

### 1.4 品牌与素材

- `src/brand/tokens.ts` 已有：品牌名（iJipu / 爱记谱 / i记谱）、Slogan（**码即成，谱自现** /
  用代码的严谨，谱写指尖的浪漫）、作者（蜗牛🐌）、色板（深空蓝 `#1E2A5E` + 霓虹青 `#00F0FF`）、
  **`siteUrl`**、**`obsidianRepoUrl`**（`https://github.com/snailhome/obsidian-ijipu`）。
- 宣传文案现成：`docs/WECHAT-ARTICLE.md`（公众号文章，五个板块，可直接改造成首页文案）。
- **素材缺口：仓库里没有任何应用界面截图**（只有工具栏小图标 + 一张公众号封面图）。
  首页"图文介绍"的**图需要新做**（见第四节 4.6）。
- 赞赏码现成：`public/icons/good.png`（微信赞赏码，应用内「支持作者」用它）。
- 桌面端下载：GitHub Release 资产名为 `iJipu_<版本>_x64-setup.exe`
  （已用 `gh` 核对：最新 `v0.53.0` 带 `iJipu_0.53.0_x64-setup.exe`）。
- Obsidian 插件已上架社区市场（`manifest.json` 的 `id: "ijipu"`）。

---

## 二、URL 方案：为什么推荐 `/app/`

### 2.1 两个候选对比

| 维度 | **A. `/app/`（推荐）** | B. `/ijipu.html` |
|---|---|---|
| 用户看到的地址 | `ijipu.pages.dev/app/` | `ijipu.pages.dev/ijipu.html` |
| PWA `start_url` | `/app/`（干净、能进 scope） | `/ijipu.html`（能跑但难看） |
| Cloudflare Pages 后缀美化 | 无（目录式请求天然命中 `app/index.html`） | **有风险**：Pages 常把 `/x.html` 308 跳到 `/x`，SW 的缓存键与导航回退容易对不上 |
| 以后扩展（`/app/help`、`/manual/`） | 自然 | 每个页面都要一个 `.html` |
| 改动量 | 中（要动第六节那 6 处） | 中（同样要动那 6 处，一点没省） |
| 老链接 `ijipu.pages.dev/` | 落到**首页**（首页第一个按钮就是「打开应用」） | 同样落到首页 |

**结论：选 A（`/app/`）。** 改动量两者一样，A 的地址更干净、PWA 语义更对、以后不用再搬一次家。

### 2.2 老链接与老用户怎么处理

1. **谱面里的那句链接**（`S: 本乐谱使用「爱记谱 https://ijipu.pages.dev」编制`）**不用改**——
   它指向官网首页，语义仍然正确。
2. **已装 PWA 的手机**：manifest 更新后 `start_url` 变 `/app/`，Chrome 一般会在下次启动/更新时采用；
   个别机型可能先落到首页一次。**首页 Hero 的主按钮就是「打开应用」**，不是死路。
3. **不做自动跳转**（不写"第二次访问自动进应用"这类小聪明）：会造成"我明明想看看介绍却被弹走"。
4. 建议首页顶部给一条**细提示条**（只在 `localStorage` 有 `ijipu.` 前缀的历史键时显示）：
   「你以前用过爱记谱 → 直接进入应用」。**这一条列为可选项**（见第九节拍板项 ③）。

### 2.3 PWA 清单怎么改

```jsonc
// public/manifest.webmanifest
"start_url": "/app/",   // 装到桌面后，点图标直接进应用
"scope": "/",           // 保持整站：PWA 窗口里点「首页 / 手册 / 语法」不会跳出到浏览器
```

> `start_url` 只要在 `scope` 内就合法，所以"启动进应用 + 窗口内能逛全站"两者可以兼得。

---

## 三、站点地图

| URL | 页面 | 入口文件（源码） | 说明 |
|---|---|---|---|
| `/` | **介绍首页** | `index.html` + `src/landing/main.ts` | 图文介绍 + 一排入口链接 |
| `/app/` | **iJipu 应用** | `app/index.html` + `src/main.tsx` | 现在的应用，一行代码不改功能 |
| `/manual/` | **操作手册** | `manual/index.html` + `src/docs/manual.ts` | `docs/USER-GUIDE.md` |
| `/syntax/` | **脚本语法说明** | `syntax/index.html` + `src/docs/syntax.ts` | `docs/SYNTAX.md` |
| `/plugin/` | **插件手册**（adj905x） | `plugin/index.html` + `src/docs/plugin.ts` | `docs/PLUGIN-GUIDE.md`：Obsidian 插件的功能介绍 + 使用手册 |
| （外链） | 桌面端下载 | → `https://github.com/snailhome/ijipu/releases/latest` | 永远拿最新版，不写死版本号 |
| （外链） | Obsidian 插件 | → `https://github.com/snailhome/obsidian-ijipu` | 另附社区市场页 `https://obsidian.md/plugins?id=ijipu` |
| （首页区块） | 支持赞赏 | 首页弹层，展示 `/icons/good.png` | 不放外部收款平台，直接用现成的微信赞赏码 |
| `/404.html` | 404（可选，P1） | `public/404.html` | Pages 认根目录 `404.html` |

> **不需要 `_redirects`**：没有前端路由，每个 URL 都有真实文件；Pages 对 `/app/` → `app/index.html`
> 是内建行为。

---

## 四、首页设计

### 4.1 参考站点观察（用户给的 5 个，我实际抓了 2 个）

- **lertaro.github.io**（实抓）：Hero（大标题 + 一句话定位 + 「立即下载」+ 「快速开始」两个按钮 + Logo 图
  + 「仅信任官方来源」提示条）→ **特性卡片网格 8 张**（emoji + 小标题 + 两行说明）→ 架构分块（3 张并排卡）
  → 兼容性 → **FAQ 手风琴** → 「社区与参与」四张链接卡（仓库 / Issue / 插件指南 / **赞助**）。
- **obsidian.md**：Hero + 多端入口 + 特性分块 + 下载区。
- **u-tools.cn / drissionpage / graphif.dev**：工具站/文档站的共性——**顶栏导航 + 一屏说清"这是什么"+
  卡片化特性 + 明确的一个主 CTA**。

**共性结论**（首页就按这个骨架做）：**Hero → 特性卡网格 → 深度分块（配图）→ 多端入口 → FAQ → 社区/赞赏 → 页脚**。

### 4.2 顶栏（吸顶）

```
[Logo] 爱记谱 iJipu   功能  使用手册  脚本语法  插件手册  下载桌面端  插件  GitHub   [打开应用 →]
```
- 窄屏收成汉堡菜单；「打开应用」按钮**始终可见**（主 CTA）。
- 滚动过 Hero 后顶栏加背景与细边框（不透明，避免内容透出）。

### 4.3 Hero

| 元素 | 内容（草案，可改） |
|---|---|
| 主标题 | **码即成，谱自现** |
| 副标题 | 用 `.jps` 文本写简谱——右边敲代码，左边立刻出谱。实时试听、一键导出，免费开源、无需注册。 |
| 主按钮 | **立即使用（免安装）** → `/app/` |
| 次按钮 | 下载桌面版 → GitHub Releases |
| 下注小字 | 最新版 v0.53.1 · 手机/平板/电脑通用 · 支持 PWA 离线 · AGPL-3.0 |
| 主视觉 | 应用截图（拆分视图：**左谱面 + 右代码**——这是应用的默认方向 `splitHDir: 'previewLeft'`），一张，最醒目位置 |

> `v0.53.1` 从 `src/brand/version.ts` 的 `APP_VERSION` 读，**不写死在 HTML 里**（发版即自动更新）。

### 4.4 「一屏看懂」演示区（卖点核心）

左边一段 `.jps` 源码，右边是渲染出来的谱面：
```
Q: 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |
```
**三种做法，按代价排序：**
1. **静态图**（P0）：左边代码截图 + 右边谱面 SVG，一张图。零成本，效果已经够。
2. **几张图轮播 + CSS 打字动画**（P1）：代码"逐字打出来"，谱面图随之切换 2–3 张。纯 CSS/少量 JS。
3. **真引擎 live demo**（P2，**需拍板**）：首页内嵌 `@ijipu/engine`，用户可以在首页直接改几个音符看谱面变化。
   冲击力最强，但要给首页加约 100KB+ 的引擎 bundle（gzip 后小一些），且要处理字体度量。
   **建议放 P2**，先看首页数据再决定。

### 4.5 特性卡片网格（8 张，emoji + 小标题 + 两行说明）

| # | 卡片 | 文案要点 |
|---|---|---|
| 1 | ⌨️ **文本即乐谱** | 高低音点 `'` `,`、时值线 `-` `/`、附点 `.`、连音线 `( )`——改一个音符就是改一个字符 |
| 2 | 👁️ **实时预览** | 右边写、左边变（默认方向）；三种视图（编码 / 左右拆分 / 预览），光标**双向联动**（点谱面跳代码，反之亦然） |
| 3 | 🔊 **实时试听** | Web Audio 现场合成，128 种 GM 音色、多声部同时出声，反复与跳房子自动跳转 |
| 4 | 🖨️ **一键导出** | PDF（矢量打印 / 位图两路）、PNG、JPG、SVG、MIDI——打印、发微信、进课件 |
| 5 | 🎼 **多声部与临时段** | `{bz}` 临时伴奏、`{dsb}` 临时多声部、`{tp}` 替谱段、跳房子、倚音与装饰记号 |
| 6 | 🔁 **兼容番茄简谱** | 沿用 `.jps` 后缀与脚本语法，原网站导出的谱子粘贴进来就能用 |
| 7 | 📱 **多端可用** | 网页版免安装、支持 PWA 离线；桌面端（Windows）带 `.jps` 文件关联；Obsidian 插件在笔记里渲染 |
| 8 | 🔓 **免费开源** | 无需注册、数据存本地；核心引擎纯 TypeScript，AGPL-3.0 |

### 4.6 深度分块（配图，3 块）

- **块 1「写谱像写代码」**：三视图截图（编码 / 拆分 / 预览）+ 光标联动的动图或两张对比图。
- **块 2「多声部与复杂谱」**：`{bz}` / `{dsb}` / `{tp}` / 跳房子的真实谱面截图 + 试听色块截图。
- **块 3「三端怎么选」**：网页 / 桌面 / Obsidian 三张并排卡，各自一句"什么时候用它" + 对应链接。

**需要的图（清单，全部要新做）**：
| 文件（建议） | 内容 | 尺寸建议 |
|---|---|---|
| `public/site/hero.webp` | 拆分视图全窗口截图（**最重要的图**） | 2880 宽（2x） |
| `public/site/view-code.webp` | 编码视图（语法高亮 + 问题提示条） | 1440 |
| `public/site/view-split.webp` | 拆分视图 + 光标联动指示 | 1440 |
| `public/site/view-preview.webp` | 预览视图（成谱） | 1440 |
| `public/site/playback.webp` | 试听面板（色块 + 音色选择） | 1440 |
| `public/site/export.webp` | 导出对话框 / 成品 PDF 缩略 | 1440 |
| `public/site/voice-multi.webp` | 多声部或临时段谱面 | 1440 |
| `public/site/desktop.webp` | 桌面端窗口 + `.jps` 文件关联图标 | 1440 |
| `public/site/obsidian.webp` | Obsidian 笔记里渲染 `.jps` 代码块 | 1440 |
| `public/site/mobile.webp` | 手机上打开（竖屏） | 800 |
| `public/site/og.png` | 分享卡片（微信/QQ 转发用） | 1200×630 |
| （复用）`public/icons/good.png` | 赞赏码 | 已有 |
| （复用）`public/icons/Jianpu.png` | Logo | 已有 |

> 图放 **`public/site/`**。已核对：嵌入版（Obsidian）走**显式白名单**（`scripts/embed-assets.mjs`），
> 新增目录**不会**被悄悄打进插件 ✓。
> 另外首页大图**不进 SW 预缓存**（`PRECACHE` 不含），首次访问即下、之后走正常 HTTP 缓存即可。

### 4.7 「一排链接」区（用户明确要求 3）

在特性卡之后放一个**资源导航区**（图标 + 标题 + 一句说明），与顶栏互为双保险：

| 入口 | 链接 | 说明 |
|---|---|---|
| 打开应用 | `/app/` | 免安装，浏览器直接写谱 |
| 使用手册 | `/manual/` | 界面、保存、导出、快捷键、常见问题 |
| 脚本语法说明 | `/syntax/` | `.jps` 全部语法与组合示例，可当参考书查 |
| 桌面端下载 | GitHub Releases | Windows 安装包，带 `.jps` 文件关联 |
| Obsidian 插件 | `snailhome/obsidian-ijipu` | 在笔记里写谱、渲染、试听 |
| 支持赞赏 | 首页弹层（微信赞赏码） | 不打赏也能用，纯自愿 |

### 4.8 FAQ（4–6 条）

建议：① 要不要装软件 / 收不收费？② 我的谱存在哪（隐私）？③ 和「番茄简谱」什么关系？
④ 手机能用吗、离线能用吗？⑤ 桌面版和网页版区别？⑥ 插件怎么装？

### 4.9 页脚

Slogan（用代码的严谨，谱写指尖的浪漫）+ 作者蜗牛🐌 + AGPL-3.0 + 官网/仓库链接 +
一行「最近更新：v0.53.1」+ 致谢「番茄简谱」原作者与社区。

### 4.10 SEO / 分享

- 首页与文档页各自 `<title>` / `description`；首页加 `og:title` / `og:description` / `og:image`（`og.png`）。
  **微信转发卡片全靠这几个 meta**，而用户走过公众号渠道——值得做。
- `robots.txt` + `sitemap.xml`（P1，可选）。
- `public/404.html`（P1）：兜底页，给「回首页 / 打开应用」两个按钮。

---

## 五、文档页设计（`/manual/`、`/syntax/`）

### 5.1 布局

```
┌──────────────────────────────────────────────────────────┐
│ 顶栏：[Logo] 爱记谱   [操作手册|脚本语法]   GitHub  [打开应用]│
├───────────────┬──────────────────────────────────────────┤
│ 左侧目录(TOC) │  正文（Markdown 渲染成 HTML）             │
│ 一、界面概览  │                                          │
│ 二、五分钟上手│  ...                                     │
│ ...（滚动高亮）│                              [回到顶部]  │
└───────────────┴──────────────────────────────────────────┘
```
- 窄屏：TOC 收进抽屉（顶部一个「目录」按钮）。
- TOC 顶部放一句「两份文档怎么用」的引导 + 互相切换链接。

### 5.2 关键实现点

1. **抽出渲染器**：把 `src/dialogs/DocDialog.tsx` 里的 `mdToHtml` / `inlineMd` / `esc` 移到
   **`src/help/markdown.ts`**（纯函数、可被 smoke 直接断言）。DocDialog 改为 import 它。
   ⇒ **网页文档页与应用内帮助从此是同一份渲染器、同一份 `.md`**，不会出现"网页改了、应用里没改"。
2. **标题加 id + 生成 TOC**：给 `mdToHtml` 增加一个可选参数（如 `{ headingIds: true }`），
   标题输出 `<h2 id="...">`；同时导出一个 `extractToc(md)` 得到 `[{level,text,id}]`。
   锚点用**中文 slug**（如 `#第一部分-五分钟上手`），可读、可分享。
3. **代码块加「复制」按钮**（P1）：文档里大量可直接粘贴的谱面示例，复制按钮很实用。
4. **「在应用中打开」**（P2，可选）：示例片段旁加一个按钮 → `/app/?code=<base64>`，应用侧读参数填进编辑器。
   体验很好，但要动应用启动逻辑，**列为可选项**。
5. 文档页样式**复用 `docs` 相关的现有 CSS 变量**（`var(--jp-*)`），换主题时两边一起变。
   文档页第一版**只做深色**（与应用一致）还是**跟随系统深浅**？→ 拍板项 ⑤。

### 5.3 文档内容要顺手修的几处

- `docs/USER-GUIDE.md` 第 7、13 行的「配套的脚本语法说明（帮助 → 脚本语法说明）」在网页上没有"帮助菜单"
  ⇒ 需要**按宿主不同给出不同措辞**（或者干脆写成「见『脚本语法说明』」，两边都成立）。
- 两份文档开头都补一行「在线版地址：`https://ijipu.pages.dev/manual/`」。
  这属于**内容改动**，按项目规则要走「语法规范同步」技能（`docs/SYNTAX.md` 是对外唯一口径）。

---

## 六、技术实现

### 6.1 文件清单

**新增**
| 文件 | 作用 |
|---|---|
| `app/index.html` | **应用入口**（把现在 `index.html` 的 head/body 原样搬来） |
| `index.html`（改写） | **首页**，不再是应用 |
| `manual/index.html` | 手册页骨架 |
| `syntax/index.html` | 语法页骨架 |
| `src/landing/main.ts` | 首页脚本：注入品牌 token、渲染卡片与链接、显示版本号、赞赏弹层 |
| `src/brand/landing.ts` | 首页全部文案与链接数据（遵守"文案集中在 brand 层"的规范） |
| `src/help/markdown.ts` | **抽出的** Markdown→HTML 渲染器 + `extractToc()` |
| `src/docs/main.ts` | 文档页脚本（TOC + 正文 + 复制按钮），两份 HTML 共用 |
| `src/docs/docs.css` | 文档页样式（或并入 `src/index.css`，二者择一） |
| `public/site/*` | 截图与 og 图 |
| `public/404.html` | 兜底页（P1） |

**修改**
| 文件 | 改什么 |
|---|---|
| `vite.config.ts` | 加 `build.rollupOptions.input`（4 个 html） |
| `vite.config.embed.mjs` | `input` 从 `./index.html` → `./app/index.html` |
| `scripts/embed-inline-plugin.mjs` | 3 处 `index.html` 路径 → 支持子目录入口（或改指 `app/index.html`） |
| `scripts/embed-emit.mjs` | `HTML_SRC` → `dist-embed-app/app/index.html` |
| `scripts/embed-smoke.mjs` | `HTML` → 同上；相关断言跟着改 |
| `src-tauri/tauri.conf.json` | `devUrl` → `http://localhost:5173/app/`；窗口加 `"url": "app/index.html"` |
| `public/manifest.webmanifest` | `start_url: "/app/"`（`scope` 保持 `/`） |
| `public/sw.js` | `PRECACHE`、导航回退、缓存名（见 6.4） |
| `src/dialogs/DocDialog.tsx` | 改为 import `src/help/markdown.ts` |
| `src/brand/tokens.ts` | 可选：补 `repoUrl`（GitHub 仓库）、`donateImg` 等 |
| `scripts/smoke.mts` | 新增断言（见 6.6） |

**删除**：无。

### 6.2 Vite 多入口配置（示意）

```ts
build: {
  rollupOptions: {
    input: {
      main:    fileURLToPath(new URL('./index.html', import.meta.url)),    // 首页
      app:     fileURLToPath(new URL('./app/index.html', import.meta.url)), // 应用
      manual:  fileURLToPath(new URL('./manual/index.html', import.meta.url)),
      syntax:  fileURLToPath(new URL('./syntax/index.html', import.meta.url)),
    },
  },
},
```
- 产物自动落到 `dist/`、`dist/app/`、`dist/manual/`、`dist/syntax/`；资源引用是绝对路径 `/assets/...`
  ⇒ **桌面壳（`http://tauri.localhost/`）、Pages、PWA 三处都正常**。
- 应用与文档页**共享的 chunk 由 Rollup 自动抽公共块**；`docs/*.md?raw` 只有一个真实来源，
  但要**实测确认**没有被打成两份（见 6.6 断言）。

### 6.3 桌面端（Tauri）改法

```jsonc
"build": { "devUrl": "http://localhost:5173/app/", "frontendDist": "../dist" },
"app": { "windows": [ { "url": "app/index.html", ... } ] }
```
- `frontendDist` **不用改**（资源仍在 `dist/` 根下）。
- 落地时必须**真机验证**：`npm run dev` 与 `npx tauri build` 各跑一次，确认窗口加载的是编辑器而不是首页。
- 验证点：窗口标题、`.jps` 双击关联、SW 自毁逻辑（`IN_DESKTOP_SHELL`）不受影响。

### 6.4 Service Worker 改法（最容易踩的坑）

现在的问题：`fetch` 里**任何导航离线都回退 `/index.html`**。分层后会拿到错的 HTML。

```
改前：catch(() => caches.match('/index.html'))
改后：catch(() => caches.match(fallbackFor(url.pathname)))
       /app/*     → '/app/index.html'
       /manual/*  → '/manual/index.html'
       /syntax/*  → '/syntax/index.html'
       其它        → '/index.html'
```
并且：
- `PRECACHE` 改成 `['/', '/app/index.html', '/manual/index.html', '/syntax/index.html', '/manifest.webmanifest', 图标…]`。
- 写缓存时**按各自的缓存键存**（现在一律 `c.put('/index.html')`，会把 `/app/` 的 HTML 存成首页的键）。
- **缓存名 `jps-shell-v3` 要不要升 v4？** 有一处语义变了（`/index.html` 以前是应用、现在是首页）。
  升 v4 最干净；代价是 **30MB 字体缓存被清掉重下**。
  ⇒ 建议：**升 v4，但在 `install` 时把旧缓存里的 `/fonts/*` 条目迁移进新缓存**（十几行代码），
  既清掉错的 HTML，又不用用户重下字体。**（→ 拍板项 ④）**

### 6.5 首页脚本（`src/landing/main.ts`）

- 从 `brand/tokens.ts` 读色板 → 注入 CSS 变量（保持"色值只有一处定义"）。
- 从 `brand/landing.ts` 读卡片/链接数据 → 渲染 DOM。
- 版本号从 `brand/version.ts` 读。
- 赞赏弹层复用应用的视觉（一个简单的 `<dialog>`，不必引入 React）。
- **零新依赖**。首页 JS 目标 < 10KB。

### 6.6 需要新增的 smoke 断言（防漂移）

| 断言 | 防的是什么 |
|---|---|
| `dist/app/index.html` 存在、且含 `src/main.tsx` 的产物引用 | 应用入口没被首页挤掉 |
| `dist/index.html` **不含** `/assets/main-*.js` | 首页没有偷偷把整个应用打进去 |
| 四份 HTML 的 `<title>` 各不相同 | 复制粘贴改漏 |
| `manifest.start_url === '/app/'` 且 `scope === '/'` | PWA 装到桌面能进应用 |
| `sw.js` 的导航回退函数对 4 类路径返回正确的缓存键（纯函数，直接断言） | 离线白屏 |
| `docs/USER-GUIDE.md`、`docs/SYNTAX.md` 各只被打包一份（两个入口共享同一 chunk） | md 重复进包 |
| `vite.config.embed.mjs` 的 input == 应用入口（与 `app/index.html` 同源） | 嵌入版又变介绍页 |
| `tauri.conf.json` 的 `windows[0].url` 指向 app 入口 | 桌面端又变介绍页 |
| 渲染器抽出的纯函数在 Node 里可跑（`mdToHtml('# 标题')` 产出带 id 的 `<h1>`） | 文档页与应用内帮助同源 |

> 这些断言**必须能证伪**（先造已知错误让它红，再改回让它绿），否则等于没写。

---

## 七、风险与回归清单

| 风险 | 触发条件 | 怎么验 |
|---|---|---|
| 桌面端打开变首页 | 忘了改 `tauri.conf.json` | `npx tauri build` 后装一次，双击 `.jps` 看是否进编辑器 |
| Obsidian 嵌入版变首页 | 忘了改 embed 的 input / 3 个脚本路径 | `npm run build:embed && npm run smoke:embed` |
| 离线打开 `/app/` 白屏 | SW 回退没分类 | 无头 Chrome：注册 SW → 断网 → 访问 `/app/`，看是否出编辑器 |
| 手机主屏图标进介绍页 | `start_url` 没改 | Chrome 安装 PWA，看启动地址 |
| 老 PWA 缓存住旧 `/index.html` | 没升缓存名 | 同上断网测试 |
| 文档页与应用内帮助**内容不一致** | 动了 `.md` 但只重建一处 | 断言"两份入口用同一 md 模块" |
| 首页图片不显示 | 路径写成相对/中文名 | 首页每个 `<img>` 都 `fetch` 一遍看 200 |
| 首页把应用 bundle 一起下了 | 入口配置串了 | 看首页 Network：不应有 `main-*.js` |

**每次改完必须跑的**：`npm run lint` → `npx tsc -b` → `npm run build` → `npm run smoke`，
再按需 `npm run build:embed && npm run smoke:embed`、`npx tauri build && npm run check:installer`。

---

## 八、分期

| 期 | 内容 | 产出 |
|---|---|---|
| **P0** | URL 分层 + 首页（无图先用占位）+ 文档页最小版 + 6 处同步改动 + 断言 | `/` 是首页、`/app/` 是应用、`/manual/`、`/syntax/` 全部可访问 |
| **P1** | 真实截图与 og 图 + FAQ + 404 + robots/sitemap + 代码块复制按钮 + 滚动高亮 | 可以对外宣传的首页 |
| **P2**（可选） | 首页 live demo（真引擎）、`/app/?code=` 从文档跳转带内容、文档站搜索 | 体验加分 |

---

## 九、需要拍板的点

1. **应用入口用 `/app/` 还是 `/ijipu.html`？**（我推荐 `/app/`）
2. **版本号递增幅度**：这次改的是站点结构 + 应用入口地址，用户可见行为有变。
   建议 **MINOR → 0.54.0**（0.x 阶段 BREAKING 也走 MINOR）。是否同意？
3. **首页要不要"你以前用过 → 直接进应用"的细提示条？**（我倾向要，只在有历史记录时显示）
4. **SW 缓存名升 v4 + 迁移字体缓存**，还是**保持 v3 只删错的那条**？（我推荐前者）
5. **文档页是否跟随系统深浅主题**，还是先只做深色（与应用一致）？
6. **首页 demo 做到哪一档**：静态图（P0）/ 图+打字动画（P1）/ 真引擎 live demo（P2）？
7. **截图怎么产出**：我自己用无头 Chrome 从本机 dev 页面截（可控、可复现），还是你提供现成素材
   （比如宣传视频里截帧）？
8. **赞赏入口形式**：首页弹层显示微信赞赏码（推荐）／ 跳独立页 `/donate/` ／ 只放一句"谢谢，暂不收"？
9. **首页文案用哪套**：直接改造 `docs/WECHAT-ARTICLE.md`（公众号那版）／ 我另写一版更简短的官网文案？
10. **要不要顺手加 `/donate/`、`/changelog/`（更新日志）页？**（我建议 P2 再说）

---

## 十、附：P0 落地结果与**与方案的偏差**（adj876，v0.55.0）

P0 已实现并跑通（`lint` 0 错 / `tsc` 0 错 / `build` ✔ / `smoke` 全绿 / `verify:site` 38 条全绿）。
以下是执行中与本文档原方案**不一致**的地方，以代码为准：

| # | 方案里写的 | 实际做成 | 为什么改 |
|---|---|---|---|
| 1 | `src/docs/main.ts` 一个入口 | 拆成 `render.ts`（共用）+ `manual.ts` / `syntax.ts`（各导自己那份 md） | 合并的话 `/manual/` 会把 80KB 的语法说明一起下下来 |
| 2 | 新增 `src/brand/landing.ts` 放首页文案 | **不建**。首页正文写在 `index.html` 里；只新增 `brand/siteVars.ts`（品牌色注入）与 `brand/siteLinks.ts`（外链填充），地址放 `brand/tokens.ts` | SEO（中文场景百度不执行 JS）+ 首屏不闪；代价是首页文案不在 brand 层，已在 `index.html` 头部注释写明取舍 |
| 3 | SW 升 v4 时**迁移 `/fonts/*` 缓存**（担心重下 30MB） | **不需要迁移** | 实测 `/fonts/*.otf` 早在 adj194 就随"改用系统字体栈"移除了，全仓已无引用 —— 那段分支是死代码，本次删掉。**换缓存名因此是零代价的** |
| 4 | 图清单含 `desktop.webp` / `obsidian.webp` / `mobile.webp` / `playback.webp` | 只做 7 张：`hero` / `demo-score` / `view-code` / `view-split` / `view-preview` / `voice-multi` / **`export`** | 前两张需要桌面端与 Obsidian 运行环境（本机没有）；`mobile` 非必需；**`playback` 改 `export`** —— 截图环境离网，点「试听」拍到的是"音源下载失败"提示（见 `E-2026-395`） |
| 5 | 方案未提 favicon | 新增 `public/favicon.ico`（4.8KB，从 Logo 生成） | 浏览器会主动请求根 `/favicon.ico`，不加就有一条 404（首页断言当场抓到） |
| 6 | 文档页页头另放 `h1` + 一句说明 | **页头不放标题**，大标题由正文自己的第一个 `h1` 承担 | 否则同一个文档名出现两遍，目录还要跟着特判 |
| 7 | "必须同步改的 6 处" | 确实是 6 处，全部改完 | —— |
| 8 | 方案里的 smoke 断言清单（9 条） | 实际 **28 条**（另 `verify:site` 38 条） | 写的时候把"真实文档的目录锚点 vs 正文标题 id 逐个相同"等更强的判据也加了进去 —— 正是它抓到了 `extractToc` 不跳代码块这个真缺陷 |

**新增的长期资产**：`npm run verify:site`（`scripts/verify-site.mjs`）—— 改完站点跑一次，
它会起本地服务 + 无头 Chrome 验证四个页面，并重新生成首页素材图。

**P1 / P2 尚未做**：真实多端截图（桌面端、Obsidian、手机）、404 页、`robots.txt` / `sitemap.xml`、
文档页代码块"复制"按钮、以及 P2 的**首页内嵌真引擎 live demo**。

---

## 十一、附：我实际查证过的命令与输出

```
$ git -C ijipu remote -v
origin  git@github.com:snailhome/ijipu.git (fetch/push)
$ git -C obsidian-ijipu remote -v
origin  git@github.com:snailhome/obsidian-ijipu.git
$ git -C ijipu tag --sort=-creatordate | head -1        → v0.53.0
$ ijipu/package.json version                             → 0.53.1
$ gh release view --repo snailhome/ijipu --json assets   → iJipu_0.53.0_x64-setup.exe（tag v0.53.0）
$ ijipu/docs 文件                                        → USER-GUIDE.md 15.9KB / SYNTAX.md 78.9KB / 其余为开发文档
$ ijipu/public 清单                                      → icons/ samples/ spessasynth/ + manifest + sw.js
$ grep -n "index\.html" ijipu/scripts/*.mjs              → embed-inline-plugin.mjs(185,213,222) / embed-emit.mjs(42) / embed-smoke.mjs(25)
$ grep -rn "USER-GUIDE\|SYNTAX\.md" ijipu/src            → 只被 dialogs/DocDialog.tsx 以 ?raw 导入
```
