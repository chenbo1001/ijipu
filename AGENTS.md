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
1. `.jps` 语法以 `docs/JPS-SPEC.md` 为准：**parser/tokenizer 语法改动必须同步该文档**（走「语法规范同步」技能）
2. 光标联动：元素带 `data-notepos`/`data-cipos`，改动同步两端（`engine/cursorMap.ts`）
3. 排版虚线收敛在 `engine/layout/guides.ts` 纯函数；**quci 虚线钳制曲部下沿~歌词上沿、cici 不越歌词下沿**（adj53）；预览层只消费不重算
4. **修饰符间距常量统一在 `engine/layout/spacing.ts`**（adj60：层级间距 LAYER_GAP=2、层内 INNER_GAP=1；**adj64：水平元素最小间距 0.5px，非时值元素（&zkh/&ykh 括号等）占位 BRACKET_PAD 先扣除、剩余宽按比例分摊给带时值元素**）；改间距只改该文件
5. localStorage 键统一 `ijipu.` 前缀、集中定义在 store 顶部；损坏回退默认值；写入范围钳制
6. 每次功能/修复后：排错必记 `docs/ERRORS-LOG.md`（`E-年份-序号`，现象/根因/解决/预防）
7. 版本发布顺序：**改码 → 同步文档 → 判定版本递增（按内容大小）→ 递增版本号（多处同步）→ git 提交（Conventional + adjNN）→ 打 git tag → 打包**。完整规则见 `docs/VERSIONING.md`「发布操作流程」；引擎更新需同步 `obsidian-ijipu/vendor/engine` 并单独提交 + 打 tag。（触发词：用户说「**更新提交**」即按此整串执行——ijipu 判版本幅增、双库各自升版本、记录、git 提交 + 打 tag。）

## 六、临时验证脚本
- 命名 `scripts/_tmp_*.mts`，用后**必删**、禁提交 git；引擎验证优先并入 smoke
- 只读 samples/、docs/ 真实文件；产物只写 `dist-smoke/`、`dist-preview/`，验证后清理
