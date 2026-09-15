# PWA 部署与手机端安装指南

iJipu 已支持 PWA（Progressive Web App，adj155）。
构建产物 `dist/` 包含 `sw.js`（Service Worker）、`manifest.webmanifest`、图标与 `index.html`，
部署到 **HTTPS** 站点后，手机/桌面浏览器可"添加到主屏幕"作为独立应用运行。

---

## 1. 构建产物

```bash
npm run build
# 产出 dist/:
#   index.html, manifest.webmanifest, sw.js
#   assets/index-*.js, assets/index-*.css (带 hash)
#   icons/（图标、Logo、PWA 图标、赞赏码——adj417 起统一放这里，根目录不再散落 png）
```

- **Service Worker 注册**：`src/main.tsx` 已写 `navigator.serviceWorker.register('/sw.js')`，
  仅在 `import.meta.env.PROD` 下注册（dev 与 Vite HMR 冲突，故跳过）。
- **Manifest**：`public/manifest.webmanifest` 已含 `name` / `short_name` / `start_url` / `scope` /
  `display: standalone` / `theme_color` / `background_color` / 图标 192/512 / `purpose: any|maskable`。
- **Apple Touch Icon**：`index.html` 已含 `<link rel="apple-touch-icon">`，iOS Safari 优先使用。

---

## 2. 部署到 HTTPS（PWA 必需）

PWA 安装提示仅在 **HTTPS 域名** 下出现（`localhost` 除外）。
**`http://` 站点 + 浏览器地址栏 ≠ 可安装**。常见 HTTPS 平台（按推荐顺序）：

| 平台 | 操作 | 备注 |
|---|---|---|
| **Cloudflare Pages** | 1. 登录 dash.cloudflare.com → Workers & Pages → Create → Pages<br>2. 关联 GitHub 仓库 iJipu → 选根目录（ijipu/）<br>3. Build command: `npm run build`　Output: `dist` | 免费、自动 HTTPS、自带 CDN。**推荐首选** |
| **Netlify** | 1. app.netlify.com → Add new site → Import from Git<br>2. Build: `npm run build`　Publish: `dist` | 免费、自动 HTTPS、CDN |
| **Vercel** | 1. vercel.com → Add New Project → iJipu<br>2. Framework: Vite　Output: `dist` | 免费、自动 HTTPS、CDN。**注意**：Vercel 部署 Vite 项目时默认 root 设为仓库根，但 iJipu 应用在 `ijipu/` 子目录，需手动设 **Root Directory: `ijipu`** |
| **GitHub Pages** | 1. 仓库 Settings → Pages → Build from branch → gh-pages<br>2. 用 `gh-pages` action 自动 build + 部署 `dist/` | 免费、自动 HTTPS。**注意**：iJipu 在子目录，需设 **Pages → Build from branch → Branch: `gh-pages` / `/(root)`**；或用 `subpath` action；或 monorepo 配置 base path |
| **自建 nginx + Let's Encrypt** | 1. `apt install nginx certbot python3-certbot-nginx`<br>2. `certbot --nginx -d your.domain.com`<br>3. nginx server block: `root /var/www/jps/dist;` + HTTPS config | 需自有域名 + 公网 IP。沙箱外可走，DSH 工作区内不支持长监听 |
| **国内备案 + CDN** | 阿里云 / 腾讯云 / 华为云 OSS + CDN + ICP 备案 | 国内访问快，但需域名 ICP 备案（个人/企业均可，约 7-20 天） |

> **Vercel / GH Pages 部署子目录注意**：iJipu 在 `ijipu/` 子目录，部署时必须设 **Root Directory: `ijipu`**，否则部署的是仓库根目录（无 `dist/`）。

---

## 3. 部署后验证清单

部署到 HTTPS 后，**依次检查**：

> **adj379：更新提示**——部署新构建后，新 SW 会立刻接管页面，但**当前页面仍在跑旧 bundle**。
> 应用会在接管时于右下角提示「**发现新版本，点击刷新**」（首次注册不提示），点击即刷新拿到新代码；
> SPA/PWA 长期不重载时每 30 分钟 + 每次窗口获焦也会主动检查新版。
> 因此部署完新版后若还能看到旧界面：**点一下该提示**（或 Ctrl+Shift+R 强刷；已安装的 PWA 窗口需关掉重开）。

- [ ] 浏览器 DevTools → Application → Manifest：
  - Name、short_name、start_url、scope、display=standalone、icons 均正确
  - **Status** 显示 "Manifest fetched, no errors"
- [ ] DevTools → Application → Service Workers：
  - **Status: activated**（已激活，绿色）
  - Source: `/sw.js`
- [ ] DevTools → Application → Cache Storage：
  - `jps-shell-v3` 缓存存在（sw.js install 时预缓存）
- [ ] DevTools → Lighthouse → PWA 类别：
  - "Installable" 通过
  - "PWA Optimized" 通过
- [ ] 手机 Chrome / Edge 访问 HTTPS URL：
  - 地址栏右侧出现「⊕ 安装」按钮（或「⋮ 菜单 → 安装应用」）
  - 点击后桌面/主屏出现「i记谱」图标
  - 打开后**全屏、无浏览器地址栏**，像原生 App

---

## 4. 手机端"添加到主屏幕"步骤

### Android（Chrome / Edge / Samsung Internet）

1. 打开 HTTPS 站点（如 `https://jps.yourdomain.com`）
2. **方法 A**（推荐）：Chrome 自动弹出底部 install banner → 点「安装」或「添加」
3. **方法 B**（手动）：右上角「⋮」菜单 → **「添加到主屏幕」/「安装应用」**
4. 桌面出现「i记谱」图标，点击启动
5. 首次启动**全屏运行**（无 URL 栏），启动屏为 `background_color: #0F1526` + 「i记谱」图标
6. 离线时**仍可打开**（sw.js cache-first 命中本地缓存）

### iOS（Safari）

> iOS Safari 对 PWA 支持较弱，但**仍可添加到主屏幕**。

1. Safari 打开 HTTPS 站点
2. 点底部「分享」按钮（向上箭头方框）
3. 选「添加到主屏幕」
4. 名称可改（默认「i记谱」），点「添加」
5. 主屏出现「i记谱」图标，启动后**全屏 + 无 Safari UI**
6. **iOS 限制**（PWA 已知）：
   - 7 天无访问 Safari 会清缓存（sw.js 缓存可能失效）
   - 推送通知 / 后台同步 / Web Bluetooth 等部分 API 不支持（**iJipu 不依赖这些，OK**）
   - Web Audio 需用户首次手势触发（`AudioContext.resume()`，项目内已用 `try { await (backend as {ready?: ()=>Promise<void>}).ready?.() }` 等价处理）

---

## 5. 调试常见问题

### 5.1 安装按钮不出现

| 原因 | 解决 |
|---|---|
| **HTTP（非 HTTPS）** | 部署到 HTTPS（或 `localhost` 开发） |
| **Service Worker 未注册** | DevTools → Application → Service Workers 看 status；查 console 有无注册错误 |
| **manifest.json 解析错误** | DevTools → Application → Manifest 看 Status；F12 → Network → manifest.webmanifest 200 + valid JSON |
| **start_url 不在 scope 内** | manifest `start_url: "/"` + `scope: "/"` 必须匹配部署路径 |
| **缺少 192/512 图标** | manifest `icons` 数组必须含 192×192 与 512×512（含 `purpose: any` 或 `maskable`） |
| **无 beforeinstallprompt** | Chrome 在以下情况不触发：用户 7 天内拒绝过 / 已安装过 / 隐私模式 / iframe 内 |

### 5.2 离线不工作

- 第一次访问**必须联网**：sw.js install 时把当前资源缓存到本地
- 之后断网 → sw.js fetch 命中 cache
- 若缓存过期（sw.js 版本号变更），需重新联网

### 5.3 iOS 安装后行为异常

- **iOS 状态栏**挡住顶部：在 manifest 加 `"display_override": ["standalone"]` + 主题色；CSS 加 `env(safe-area-inset-top)`
- **iOS PWA 缓存 7 天失效**：项目 `import { useState } from 'react'` 等可能用 localStorage，缓存失效后 localStorage 也可能清空（按 iOS 策略）。**重要数据请用文件**（编辑器自动保存到 `localStorage` / IndexedDB——iOS 7 天后可能清空，**重要谱面建议手动导出 `.jps`**）
- **iOS 音频不自动播放**：用户首次点击播放按钮 → `AudioContext.resume()` → OK

### 5.4 桌面（Tauri）下 sw.js 静默失败

`main.tsx` 注释：「Tauri（tauri://localhost 自定义协议）下注册会静默失败」。
**桌面端不需要 PWA**（本身就是独立 App），sw.js 注册失败**不影响** Tauri 桌面使用，OK 忽略。

### 5.5 手机端「打开」里找不到 `.jps` 文件

**先分清是"没有这个文件"还是"看到却打不开"**——`.jps` 是自定义扩展，很多环节都不认识它：

| 情况 | 原因 | 怎么办 |
|---|---|---|
| 列表里能看到 `.md`/`.png` 等，就是没有 `.jps` | ① 文件**还在网盘/微信里，没落到本机**（系统选择器只列本机文件）；② 所选提供方（网盘 SAF、部分国产浏览器）**按类型隐藏**未知扩展 | ① 在网盘 App 里「下载到本地／保存到手机」（微信收到的文件要先「保存到手机」）；② 再从选择器的「下载 / Download」目录找；③ 实在不行把扩展名改成 `.md`/`.txt`——App 按**文本内容**读入，扩展名不影响打开（`E-2026-139`） |
| 列表几乎是空的 | 选择器停在「最近」（只列被媒体库索引过的文件） | 从侧栏切到「下载」或设备存储目录 |
| 能看到 `.jps`，选中后提示打开失败 | 文件不是 UTF-8 文本 / 内容不是简谱 | 看提示里的解析告警；确认文件没被云盘占位（0 字节的"在线文件"） |

> **为什么会这样**：系统文件选择器由 Android SAF / iOS 文件 App + 各家网盘提供方实现，
> 未知扩展名没有 MIME 身份，是否显示、是否可选由它们决定。iJipu 侧已做的是
> **移动端不设 `accept` 过滤**（`adj399`），并在用户放弃选择时给出上面这几条出路（`adj401`）。

### 5.6 部署了新版，但手机 / PWA 还是旧界面

- 先确认**服务端**是新版：浏览器直接访问 `https://<域名>/`，看「关于」里的版本号（或比对静态资源的 hash）。
- 手机上的 PWA 窗口若一直开着，页面仍在跑旧 JS。正常情况下部署后会出现「**发现新版本，点击刷新**」；
  点它、或把 PWA 从后台任务里划掉重开即可（`adj379`）。
- 若**从不出现**该提示：说明 `sw.js` 自身没变化——`scripts/stamp-sw.mjs` 会在每次 `npm run build` 时给
  `dist/sw.js` 打上构建指纹（版本+时间+commit），保证 SW 每次都变（`adj400`，见 `E-2026-140`）；
  部署前可用 `tail -1 dist/sw.js` 确认指纹行已更新。

---

## 6. 上架应用商店（可选，PWA 也可）

PWA 上架 Google Play 需用工具打包成 APK / AAB：

| 工具 | 操作 | 备注 |
|---|---|---|
| **PWABuilder** | pwabuilder.com → 输入 URL → 自动生成 → 下载 APK/AAB | 微软出品，最简 |
| **Bubblewrap** | npm i -g @nicejob/bubblewrap；`bubblewrap init` → `bubblewrap build` | Google 出品，需 JDK + Android SDK + chrome |
| **Capacitor** | npx cap add android；`npx cap copy` | Ionic 团队，需配置 |

**简评**：PWA 上架商店**工作量大、价值有限**（很多用户仍用浏览器 PWA）。
**如需上架 → 建议先确认 PWA 体验 OK，再决定走 PWABuilder 一键打包**。

---

## 7. 部署后回归测试

部署新版本后，建议做一次**烟囱测试**：

- [ ] HTTPS 站点首页加载
- [ ] `sw.js` 200 OK
- [ ] `manifest.webmanifest` 200 OK + valid
- [ ] DevTools Lighthouse → PWA 类别通过
- [ ] 手机 Chrome 弹出「安装」提示
- [ ] 安装后图标、启动屏、主题色正确
- [ ] 离线断网后仍能打开应用（基础功能）
- [ ] 编辑器核心流程：新建 → 输入 → 试听 → 导出 → 打开 → 保存
- [ ] localStorage 持久化设置、撤销栈（注意 iOS 7 天缓存）

---

## 8. 相关代码位置

- `src/main.tsx` — Service Worker 注册（adj155）+ 新版本接管提示（adj379：`controllerchange` → `updateReady`；30 分钟/窗口获焦 `reg.update()`）
- `src/pwa/swUpdate.ts` — 「新版本就绪」判定纯逻辑（adj379：`shouldPromptUpdate` 区分首次注册与真更新）
- `src/ui/UpdatePrompt.tsx` — 右下角「发现新版本，点击刷新」按钮（adj379）
- `public/sw.js` — Service Worker 策略（adj155，network-first 导航 / cache-first 静态；adj192 `/fonts/*.otf` 大体积字体 cache-first 命中即回，缓存版本升到 `jps-shell-v3` 以便 activate 清掉旧缓存）
- `public/manifest.webmanifest` — PWA 清单（standalone + theme + 图标）
- `index.html:7-13` — viewport / manifest / theme-color / apple-touch-icon
- `src-tauri/tauri.conf.json` — Tauri 桌面配置（与 PWA 独立；PWA 部署仅需 `dist/`）

---

## 9. 一句话总结

> **跑 `npm run build`，把 `dist/` 部署到任意 HTTPS 静态托管**（推荐 Cloudflare Pages / Netlify），
> **手机 Chrome 打开即可"添加到主屏幕"**——零成本完成移动端 PWA 安装。
