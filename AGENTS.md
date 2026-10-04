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
- src 分层见 `src/AGENTS.md`；示例谱 = `public/samples/*.jps`（构建期自动发现，改/加文件即可，不用改代码）；**「新建」模板 = `src/samples/未命名.jps`**（adj481：改这个文件即改新建出来的空白谱；放源码目录，不随产物发布）；`src-tauri/gen`、`target/`、`dist*` 禁止手改/提交
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
9. **【重要规则】谱面元素原则上不得重叠**（用户多次强调，2026-10 升级为硬规则）：
   - **判据**：任意两个元素的**墨迹盒**（实际画出来的字形/线条所占矩形，**不是**占宽块、不是时值槽、
     不是拍宽）不得相交。→ 区间用**墨迹**算：数字墨迹左缘 = `note.x`、右缘 = `x + min(宽, digitSlotW)`
     （带附点/增时线才用块右端）；**严禁**用"占宽/时值"当边界去判重叠——那会把可用空档算成 0
     （段层大括号压后续音符就是这么做出来的，见 E-2026-351/354）。
   - **唯一例外**：源码里**明确要求重叠**（显式写的重叠记号）；其余一切"看起来重叠"都是缺陷。
   - **冲突时的处理次序**（按代价从小到大，**不许**直接让两个元素压在一起）：
     ① 挪动**附属物**（歌词注释、装饰记号）——在它两端的锚点之间选位，容不下就上/下移到锚点旁；
     ② 为**占宽元素**（临时多声部大括号、替谱括号）在本行内**定向预留**（同时计入 `nonDurPad`，
        行宽守恒，其它拍等比略窄）；
     ③ 撑**行距/行高**（只影响含该元素的行）；
     ④ 仍不行才缩小元素本身（如歌词注释横向压缩），且要在注释里写明"这是四条口径下的必然结果"。
   - **附属物不占主体位**（用户口径）：歌词注释**不占音符位**——不许为了让注释放得下而推开音符或歌词字；
     只能调注释自己的位置/大小。
   - **同一 `C:` 行的歌词字必须同一水平线**（含临时多声部里的歌词）：包络下移等只搬音符、不搬歌词。
   - 每次改动都要有**断言**守住它（smoke 里成对的 `check`），并在 `docs/ERRORS-LOG.md` 记录。

## 六、临时验证脚本
- 命名 `scripts/_tmp_*.mts`，用后**必删**、禁提交 git；引擎验证优先并入 smoke
- 只读 samples/、docs/ 真实文件；产物只写 `dist-smoke/`、`dist-preview/`，验证后清理

## 六之二、【高频复发】五条必须机器化的铁律（adj688）

> 这五条在 `docs/ERRORS-LOG.md` 里已经写过多次却**仍然复发**。原因不是"不认真"，
> 而是 **ERRORS-LOG 的"预防"跨会话无效**（它是给人读的，不会自动进入执行者上下文）。
> 因此这里只放**每次会话都会自动加载**的条目，并把能自动化的做成闸门。

1. **含中文的文件禁止用 shell 读写** —— 只用 `read`/`write`/`edit` 工具。
   本 shell 是 **Windows PowerShell（默认 ANSI/GBK）**，`Get-Content | -replace | Set-Content`
   会**不可逆**地毁掉中文（乱码 + 吞换行 + 加 BOM + 截断）。
   **已在 `layout/index.ts` 上复发两次**（E-2026-159 / E-2026-355），第二次整份改动重做。
   → 闸门：`scripts/check-encoding.mjs`（`npm run smoke` 前置，检测非法 UTF-8 / U+FFFD / BOM）。
2. **单声部与多声部是两套放置代码** —— 任何"新增/调整元素类型、占宽、行高"的改动，
   都要问"**多声部块（`placeVoiceBlock`）里做了吗**"（E-2026-4146 记过，adj668 重做时又漏）。
3. **同一个 bug 修到第三次，换"量法"而不是继续补分支** —— 先打印"估算值 vs 实际值"再改
   （E-2026-1394；本轮"大括号留空"改到第五次才收敛）。
4. **"数值口径"必须同源** —— 同一几何量只允许一处定义（渲染与布局消费同一个纯函数）；
   严禁渲染端按自己的公式现算位置（本项目多次复发：括号宽、连音线 y、歌词注释位置）。
5. **断言必须覆盖两条布局路径**（`noteSpaceLayout: 'space'` 与 `'duration'`）**与两类段型**
   （`bz` / `dsb`）；新增元素时 smokes 里两类路径都要有对的 `check`。
   **禁止用"放宽/改断言"来让红灯变绿**——改断言必须同时说清"新口径是什么、为什么"。

## 六之三、提交节奏与边界（用户 2026-10 指示）

1. **多做 git 提交**：每完成一个 adj 批次（或 `smoke` 变绿、一轮改动收口）就**主动提醒用户提交**；
   连续 **≥2 个工具批次**未提交时**必须**提醒。理由：2026-10 那次事故里"未提交的工作 = 不存在"
   ——`layout/index.ts` 整份本轮改动连同约 240 行内容丢失，只能**全部重做**。
2. **推送 / 打 tag / 发布只在用户明确要求时做**（用户说「更新提交」才走完整发布流程）；
   平时只做本地 `commit`，**不 `push`**。
3. **元规则（比任何单条约束都重要）**：任何"以后要注意的事"**不许只写进 `docs/ERRORS-LOG.md` 就算完**——
   必须落到下面三者之一，否则一律视为**无效约束**：
   ① **自动加载**的位置（本文件）：决定"我每次会话都知道什么"；
   ② **机器闸门**（`npm run smoke` 前置的 `check:encoding` / git `.githooks/pre-commit` / 编译期断言）：
      决定"做错了能不能被拦住"；
   ③ **动作层约束**（如"含中文的文件只用 `read`/`write`/`edit`"）：决定"错误动作本身会不会发生"。
   实证：**只写在 ERRORS-LOG 的"预防"里 = 无效**——E-2026-159（adj427）与 E-2026-355（adj686）
   是同一个坑，中间隔了几百个 adj，文字一字不差却照样复发。

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

> **adj480（用户确认）：`PageConfig` 没有 L1 层。** 版面/外观类设置只有两层——**代码默认 < 谱面自带**
> （应用侧曾把"本机页面设置"缓存在 `localStorage` 并兜底未自带设置的谱面，已删除：那是"换台机器显示不一样"的根源）。
> 目标口径：**谱面自包含 ⇒ 复制源码给别人效果一致**。宿主侧若确有默认层（插件设置 / frontmatter），
> 只对"源内没写"的项生效，且**不随谱走**——用引擎 `configCarryover(code, effective)` 把差异显式化，
> 让用户"复制给他人前先随谱固化"。

判定三问：
1. 改它会不会改变**谱面外观/排版结果**？会 → L2。
2. 换台机器/换个人打开同一份 .jps，**期望看到一样吗**？一样 → L2；可以不一样 → L1。
3. 丢掉它用户**会不会烦**（要重设）？会 → L1（需持久化）；不会 → L3。

硬性约束：
1. **编辑器/界面偏好永属 L1**，绝不写入 `# jps-config`（`PageConfig` 里不得再出现 `editorFont/editorFontSize` 之类字段）。
2. **L2 写入用差量**（`writeJpsConfig` 默认 `mode:'diff'`：只写与 `defaultPageConfig` 不同的字段，无差量则删除该行）——因为 `PageConfig` 只有"默认 ← 谱面"两层，**保存即自包含**（adj480：应用侧不再有 L1 页面设置层，也不再需要单独的「固化到谱面」动作）；宿主侧若另有默认层（插件设置 / frontmatter），用它把差异显式化并让用户"随谱固化"，不要把默认值也写进谱面（`mode:'full'` 仅留给确有需要的存档场景）。
3. **可选字段**（不在 `defaultPageConfig` 上）若属 L2，必须同时登记到 `engine/settings.ts` 的 `OPTIONAL_CONFIG_FIELDS`（有编译期断言兜底）。
4. **字体一律用完整栈**（末尾必须落到 `sans-serif/serif/monospace`）：候选集中在 `engine/fonts.ts`，读取旧值经 `normalizeFontStack` 自动补 fallback。
5. L1 的新键：集中定义在 `src/store/editorPrefs.ts` 或 store 顶部常量，`ijipu.` 前缀、损坏回退默认、越界钳制。
