# 第三方组件与许可（THIRD-PARTY）

iJipu（爱记谱）本体以 **GNU Affero General Public License v3.0（AGPL-3.0）** 发布，
全文随安装目录放在 `LICENSE`。本文件列出**随安装包一起分发**的第三方内容，
以及我们遵守它们许可的方式（**署名与许可是分发第三方作品的义务，不是可选项**）。

安装目录里与本文件相关的文件：

| 文件 | 是什么 |
|---|---|
| `LICENSE` | iJipu 本体的 AGPL-3.0 全文 |
| `THIRD-PARTY.md` | 本文件 |
| `soundfonts/generaluser_gs.sf2` | 内置音色库（第三方作品） |
| `soundfonts/LICENSE-GeneralUserGS.txt` | 该音色库的许可**原文**（逐字保留） |
| `soundfonts/README.md` | 该音色库的来源、署名与一处须如实说明的保留 |
| `docs/iJipu-CLI-手册.md` | 命令行使用手册（本体文档） |

---

## 一、内置音色库：GeneralUser GS（第三方作品，随包分发）

| 项 | 内容 |
|---|---|
| 名称 | **GeneralUser GS** v1.471 |
| 作者 | **S. Christian Collins**（s_chriscollins@hotmail.com） |
| 主页 | <http://www.schristiancollins.com> |
| 许可 | **GeneralUser GS License v2.0** |
| 许可原文 | 安装目录 `soundfonts/LICENSE-GeneralUserGS.txt`（与本文件同一次分发） |

许可是**明确允许**用在软件项目里的（原文："Please feel free to use it in your software
projects, and to modify the SoundFont bank or its packaging to suit your needs."）；
并要求**不要直链作者自己的下载文件** —— 我们随安装包分发一份**本地副本**，正是这条要求的做法。

⚠ 一处须如实说明的保留：原作者在许可里自己声明，该 bank 里大部分采样是原创的，
但也有一些取自网络上免费（且合法）的 SoundFont，他**无法 100% 确认每个采样的来源**；
Debian 因此在收录它时标记为 "unclean license"。iJipu 是**免费开源**项目、
不靠这个音色库盈利，风险远低于商业软件；若你要把它用于**商业闭源产品**，这条不确定性请自行评估。
完整说明见 `soundfonts/README.md`。

---

## 二、Microsoft Edge WebView2 Runtime

Windows 版 iJipu 用 **WebView2**（Microsoft Edge WebView2 Runtime）承载界面。
它**不是**本项目的代码，而是微软提供的运行时：安装包会检测并按需安装
（随包带的是微软官方的 **Evergreen Bootstrapper / Standalone Installer**，原样分发、未做改动）。

- 提供方：**Microsoft Corporation**
- 适用条款：**Microsoft Software License Terms**（随 WebView2 Runtime 一同提供）

> 另有一个 GNU 工具链相关的说明（不是第三方组件、是构建产物）：
> 本项目在 Windows 上用 GNU 工具链构建，`WebView2Loader.dll` 是 `webview2-com-sys` 的
> **运行期动态依赖**，因此它随安装包一起分发（见 `docs/ERRORS-LOG.md` 的 `E-2026-134`）。

---

## 三、主要开源组件

### 3.1 打包进 `ijipu.exe`（桌面壳）

| 组件 | 版本（本轮） | 许可 | 说明 |
|---|---|---|---|
| **Tauri**（`tauri` / `tauri-build` / `wry` / `tao`） | 2.x | MIT 或 Apache-2.0（双许可） | 桌面壳本体：窗口、IPC、打包 |
| **tauri-plugin-single-instance / -dialog / -opener** | 2.x | MIT 或 Apache-2.0 | 单实例、原生目录选择、外部链接交给系统浏览器 |
| **QuickJS**（经 `rquickjs` 内嵌） | QuickJS 2024 系列 ／ `rquickjs` 0.14 | **MIT**（`rquickjs` 与 QuickJS 均为 MIT） | **随 exe 内嵌**：命令行那段 JS（引擎 + CLI 逻辑）由它执行 ⇒ 用户不必装 Node |
| **serde / serde_json** | 1.x | MIT 或 Apache-2.0 | 前后端数据交换 |
| **windows-sys** | 0.61 | MIT 或 Apache-2.0 | 注册表 / 命名管道 / 控制台 / 消息广播 |
| Rust 标准生态其余传递依赖 | 见 `src-tauri/Cargo.lock` | 绝大多数 MIT 或 Apache-2.0 | 完整清单以 `Cargo.lock` 为准 |

### 3.2 打进前端产物（`dist/`，随安装包内的应用资源分发）

| 组件 | 版本（本轮） | 许可 | 用在哪 |
|---|---|---|---|
| **React** / **React DOM** | 19.2.8 | MIT | 界面 |
| **Zustand** | 5.0.x | MIT | 状态管理 |
| **spessasynth_core** / **spessasynth_lib** | 4.3.x | Apache-2.0 | 高质量音色库（SoundFont）合成与播放 |
| **@breezystack/lamejs** | 1.2.7 | **LGPL-3.0** | MP3 编码（lamejs 的打包分支） |
| **Vite** / **TypeScript** / **oxlint** / **@vitejs/plugin-react** | 见 `package.json` | MIT | 仅构建期，**不进产品产物** |

> LGPL-3.0 的 `@breezystack/lamejs` 以**未修改的库形式**被打进前端产物、并与 AGPL-3.0 的
> iJipu 一同以源码可得的形态分发 —— AGPL-3.0 与本项目的"源码公开"做法满足其要求。

---

## 四、字体

应用**不自带**任何字体文件：谱面默认字体栈是系统字体
（微软雅黑 / 苹方 / 思源黑体等，见引擎 `engine/fonts.ts`），
字体许可由**操作系统**随其字体一并提供，本项目不重新分发字体。

---

## 五、如何取得源码

- iJipu 本体源码：<https://github.com/snailhome/ijipu>（AGPL-3.0）
- 各组件的源码：见上表的项目主页 / 仓库，以及 `src-tauri/Cargo.lock`、`package-lock.json` 里的版本号

发现署名或许可有遗漏，欢迎在仓库提 issue 指出。
