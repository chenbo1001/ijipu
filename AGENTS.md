# AGENTS.md 项目AI协作全局规范（精简版）

> DSH 自动加载；src 分层职责见 `src/AGENTS.md`。完整版备份见 `AGENTS1.md`。

## 一、项目事实速查
- iJipu（爱记谱）：Tauri v2 + Vite 8 + React 19 + TS 6(strict) + Zustand；`.jps` 语法兼容原「番茄简谱」
- `src/engine` 纯 TS，零 React/DOM 依赖；数据流单向 `source→parse→layout→render/playback`，禁反向依赖
- 版本 SemVer：唯一手动维护 `src/brand/version.ts` 的 `APP_VERSION`；发布时与 `package.json`、`src-tauri/tauri.conf.json` **三处一致**
- 允许依赖：react / react-dom / zustand；**新增依赖必须先询问**

## 二、命令速查
| 场景 | 命令 |
|---|---|
| 开发 | `npm run dev`（http://localhost:5173，纯 Web 即可验证） |
| 构建 | `npm run build`（= gen:info + tsc -b + vite build） |
| 引擎测试 | `npm run smoke`（断言在 scripts/smoke.mts，先写断言再实现） |
| 渲染检查 | `npm run preview:render` → `dist-preview/` |
| 桌面打包 | `. .\scripts\tauri-env.ps1` 后 `npx tauri build` → `src-tauri/target/release/bundle/nsis/*-setup.exe` |
| 安装包自检 | `npm run check:installer`（核对安装清单含 `WebView2Loader.dll`——GNU 工具链下是运行期动态依赖，漏了装完启动报错，见 E-2026-134；**打包后必跑**） |
| 沙箱注意 | npm/npx 必须带 `--cache "D:/Coding/JianpuScript/.npm-cache"`；**禁用 tsx/esbuild**（spawn 受限，临时脚本用 vite lib 打包 CJS 后 node 跑）；cargo/tauri 需完整权限 |

## 三、代码规范（强制）
1. 命名：变量/函数 camelCase、组件/类型 PascalCase、常量 UPPER_SNAKE；2 空格、无分号、单引号；`import type` 分离
2. 中文注释：文件头说明 + 导出函数/组件 JSDoc；注释只写「为什么」；**布局/UI 调整标 `adjNN` 编号**（取 git log 最新号 +1），写入注释与 commit
3. 函数单职责 ≤50 行；禁硬编码（文案→`brand/copy.ts`、主题→`brand/themes.ts`、默认配置→`defaultPageConfig`、存储键→store 顶部常量）
4. 不主动重构成熟代码；不删校验/异常捕获；不用废弃 API；全部沟通、注释用简体中文

## 四、目录与约束
- src 分层见 `src/AGENTS.md`；`samples/*.jps` + `src/samples/index.ts` 两处同步登记；`src-tauri/gen`、`target/`、`dist*` 禁止手改/提交
- 技能统一放 `.dsh/skills/<技能名>/SKILL.md`（frontmatter 必须含 `name`+`description`）

## 五、业务关键约定
1. `.jps` 语法以 `docs/SYNTAX.md`（应用内「脚本语法说明」，**唯一对外口径**）为准：**parser/tokenizer 语法改动必须同步该文档**（走「语法规范同步」技能）。`docs/JPS-SPEC.md` 与 `public/doc/jps-spec.html` 已在 adj422 合并进该文档，不要再往那里写规则
2. 光标联动：元素带 `data-notepos`/`data-cipos`，改动同步两端（`engine/cursorMap.ts`）
3. 排版虚线收敛在 `engine/layout/guides.ts` 纯函数；**quci 虚线钳制曲部下沿~歌词上沿、cici 不越歌词下沿**（adj53）；预览层只消费不重算
4. **修饰符间距常量统一在 `engine/layout/spacing.ts`**（adj60：层级间距 LAYER_GAP=2、层内 INNER_GAP=1；**adj64：水平元素最小间距 0.5px，非时值元素（&zkh/&ykh 括号等）占位 BRACKET_PAD 先扣除、剩余宽按比例分摊给带时值元素**）；改间距只改该文件
5. localStorage 键统一 `ijipu.` 前缀、集中定义在 store 顶部；损坏回退默认值；写入范围钳制
6. 每次功能/修复后：排错必记 `docs/ERRORS-LOG.md`（`E-年份-序号`，现象/根因/解决/预防）
7. 版本发布顺序：**改码 → 同步文档 → 判定版本递增（按内容大小）→ 递增版本号（多处同步）→ git 提交（Conventional + adjNN）→ 打 git tag → 打包**。完整规则见 `docs/VERSIONING.md`「发布操作流程」，**可执行分解见技能 `.dsh/skills/版本发布/SKILL.md`（原子操作 OP-01~16 + 两条流程链 + 检查清单 + 踩坑）**。**版本号策略**：`ijipu` 与 `obsidian-ijipu` 只有引擎（`vendor/engine`）共用，两库版本号**各自独立、不强制对齐**，各按自身代码更新量递增；涉及引擎更新时同步 `obsidian-ijipu/vendor/engine` 并按其自身更新量升版本、补 RELEASE-NOTES、单独提交 + 打 tag。（触发词：用户说「**更新提交**」即按此整串执行，**先加载「版本发布」技能**。）
8. **Release 正文只含当版**：`npm run release:body` 生成 `release-body.md`（从 `CHANGELOG.md` 截取**当前版本**那一节）；**禁把整份累积 CHANGELOG 贴进 GitHub Release**（插件仓库已由工作流自动截取）。

## 六、临时验证脚本
- 命名 `scripts/_tmp_*.mts`，用后**必删**、禁提交 git；引擎验证优先并入 smoke
- 只读 samples/、docs/ 真实文件；产物只写 `dist-smoke/`、`dist-preview/`，验证后清理

## 七、设置分层原则（新增/调整任何设置项必须先定层）

> 完整清单与逐项归属见 `docs/SETTINGS-AUDIT.md`。**新增属性或调整属性时，先按下表定层、再写代码**；
> 跨层放错是本项目多次踩坑的根源（编辑器偏好被写进谱面、全量写入把旧默认钉死等）。

| 层 | 含义 | 存储位置 | 判定要点 |
|---|---|---|---|
| **L0 代码默认** | `defaultPageConfig`、引擎/品牌常量 | 源码 | 只作兜底，用户不可改 |
| **L1 用户个性** | 与"这个人怎么用"有关，与具体谱无关 | 本机缓存（`ijipu.*`）/ 插件设置 / IndexedDB 缓存 | 换机器可以不一样；丢失会让用户烦 |
| **L1.5 笔记级** | 仅 Obsidian：一个笔记内多份谱的统一覆盖 | 笔记 frontmatter `ijipu_*` | 可选层，优先级低于源内 |
| **L2 谱面级** | 决定这份谱长什么样，必须跟着 .jps 走 | 源码 `# jps-config` | 换机器/换人打开应当一样 |
| **L3 会话级** | 打开期间的临时状态 | 内存 | 重开即重建；**必须每实例独立** |

优先级：**L0 < L1 < L1.5 < L2**（L3 不参与合并）。

判定三问：
1. 改它会不会改变**谱面外观/排版结果**？会 → L2。
2. 换台机器/换个人打开同一份 .jps，**期望看到一样吗**？一样 → L2；可以不一样 → L1。
3. 丢掉它用户**会不会烦**（要重设）？会 → L1（需持久化）；不会 → L3。

硬性约束：
1. **编辑器/界面偏好永属 L1**，绝不写入 `# jps-config`（`PageConfig` 里不得再出现 `editorFont/editorFontSize` 之类字段）。
2. **L2 写入用差量**（`writeJpsConfig` 默认 `mode:'diff'`：只写与 `defaultPageConfig` 不同的字段，无差量则删除该行）；需要"到哪都一样"时用 `mode:'full'`（界面上是「固化全部到谱面」）。
3. **可选字段**（不在 `defaultPageConfig` 上）若属 L2，必须同时登记到 `engine/settings.ts` 的 `OPTIONAL_CONFIG_FIELDS`（有编译期断言兜底）。
4. **字体一律用完整栈**（末尾必须落到 `sans-serif/serif/monospace`）：候选集中在 `engine/fonts.ts`，读取旧值经 `normalizeFontStack` 自动补 fallback。
5. L1 的新键：集中定义在 `src/store/editorPrefs.ts` 或 store 顶部常量，`ijipu.` 前缀、损坏回退默认、越界钳制。
