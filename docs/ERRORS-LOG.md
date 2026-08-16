# JianpuScript 错误日志与经验教训（Error Log & Lessons）

| 项 | 内容 |
|---|---|
| 文档版本 | v0.1 |
| 状态 | 持续维护 —— **每次出错必须记录**（开发纪律，见文末） |
| 维护 | 开发方（DSH 协作）每次排错后追加；需求方可审阅 |

> 目的：同样的错误不犯第二次。记录 = 现象 + 根因 + 解决 + 预防。
> 编号规则：`E-年份-序号`。高频类别：`沙箱/环境`、`工具链`、`网络抓取`、`代码`、`测试`、`流程`。

---

## 一、沙箱 / 环境类（DSH 限制）

### E-2026-001 npm 写入缓存 EPERM（npm create vite 失败）
- **场景**：初始化项目脚手架
- **现象**：`npm error EPERM ... path: C:\Users\snail\AppData\Local\npm-cache\_cacache\tmp\...`，操作被拒绝
- **根因**：DSH 文件沙箱（workspace-write）只允许写工作区 `D:\Coding\JPCoder` 与平台临时区；npm 默认缓存位于用户目录，写入被拒
- **解决**：npm 缓存重定向到工作区内 `D:\Coding\JPCoder\.npm-cache`
- **预防**：所有 npm 命令统一加 `--cache "D:/Coding/JPCoder/.npm-cache"`

### E-2026-002 项目 .npmrc 的 cache 配置不生效
- **场景**：npm install
- **现象**：项目 `.npmrc` 已写 `cache=D:/Coding/JPCoder/.npm-cache`，但 `npm config get cache` 仍指向用户目录；install 仍 EPERM
- **根因**：DSH 注入环境变量 `npm_config_cache`（优先级高于项目 .npmrc）。npm 配置优先级：命令行 > 环境变量 > 项目 .npmrc > 用户 .npmrc
- **解决**：不依赖 .npmrc，命令行参数 `--cache`（最高优先级）强制生效；`.npmrc` 保留作为无环境变量环境下的兜底
- **预防**：任何 npm 命令都显式带 `--cache "D:/Coding/JPCoder/.npm-cache"`；涉及 npm 配置时先 `npm config list` 查实际生效值

### E-2026-003 Vite build/dev 崩溃：spawn EPERM（`net use` 探测）
- **场景**：`npm run build`（Vite 8 / rolldown）
- **现象**：`Error: spawn EPERM ... at optimizeSafeRealPathSync ... exec("net use", ...)`，构建直接崩溃
- **根因**：Vite 在 Windows 首次加载配置时执行 `exec("net use")` 探测网络盘映射（windowsSafeRealPathSync 优化）；沙箱禁止程序 spawn 子进程并 pipe 捕获输出（文档化边界），spawn 同步抛 EPERM
- **解决**：`scripts/patch-vite.js` 把该 exec 包进 try/catch（沙箱下静默跳过探测，其余环境行为不变）；已配置为 `postinstall` 自动执行、幂等
- **预防**：升级/重装 Vite 后重跑 patch（postinstall 自动）；如 Vite 内部逻辑变化导致 patch 失效，按脚本报错提示手工处理

### E-2026-004 tsx / esbuild 不可用：spawn EPERM
- **场景**：安装 tsx 跑 TS 测试
- **现象**：① esbuild postinstall 脚本 spawn 验证二进制 → EPERM；② 运行时 esbuild spawn 服务进程 → `TransformError: spawn EPERM`
- **根因**：esbuild 架构 = 子进程服务（pipe 通信），沙箱禁止
- **解决**：卸载 tsx；改用**已装好的 Vite（rolldown，无 spawn）** 把测试打包为 CJS 再 `node` 运行（`vite.smoke.config.ts` + `npm run smoke`）；安装 esbuild 类包用 `--ignore-scripts` 规避 postinstall（但运行时仍受限，慎用）
- **预防**：沙箱内优先选无 spawn 工具链（vite/rolldown/node 直跑）；新工具先确认不 spawn 子进程

---

## 二、网络抓取类

### E-2026-005 PowerShell Invoke-WebRequest 访问 https 失败
- **场景**：探测 npm registry / 外网 https
- **现象**：`基础连接已经关闭: 接收时发生错误`，但 `npm ping` 返回 PONG
- **根因**：PowerShell 网络栈（代理/TLS）与 node 不一致；npm（node 栈）实际可通
- **解决**：以 `npm ping` 为准判断网络；https 抓取改用 node fetch 脚本
- **预防**：判断网络可用性用 node/npm，不用 IWR 下结论

### E-2026-006 HttpWebRequest 403 Forbidden
- **场景**：抓取 doc.lezhi99.com 文档页
- **现象**：`(403) Forbidden`
- **根因**：HttpWebRequest 未带 User-Agent 被服务器拒绝
- **解决**：改用 Invoke-WebRequest（自带 UA）；node fetch 显式带 `user-agent: Mozilla/5.0`
- **预防**：抓取网页一律带浏览器 UA

### E-2026-007 文档页乱码（GBK/UTF-8 解码方向错误）
- **场景**：抓取原站语法文档
- **现象**：中文显示为 `鐣寗绠€璋辫剼鏈` 类乱码（UTF-8 字节被按 GBK 解码的典型形态）
- **根因**：页面实际为 UTF-8 编码，误按 GB2312 解码；且沙箱内 `CodePagesEncodingProvider` 不可用（受限模式禁非 core 类型）
- **解决**：确认服务端真实编码（看乱码形态判断是"UTF-8 当 GBK 解"），改用 `new TextDecoder('utf-8')`（node 内置 ICU）；抓取脚本集中管理编码（`_site_probe/fetch-docs.mjs`）
- **预防**：解码前先确认编码；乱码时先判断"字节真实编码 × 当前解码"组合再重试

### E-2026-008 原站示例谱接口需登录（zhipu-getFile 返回 19 字节）
- **场景**：抓取原站示例谱源码
- **现象**：返回"您还未登录或者登录已超时，请重新登录。"
- **根因**：文件接口需要账号登录
- **解决**：不注册第三方服务账号；改用公有领域童谣（排排坐/小星星/两只老虎）自写示例谱
- **预防**：涉及第三方需鉴权资源时，先确认公开性，避免依赖

---

## 三、代码 / 构建类

### E-2026-009 parser.ts 语法错误：标点字符串含裸单引号
- **场景**：实现歌词标点识别
- **现象**：`TS1005: ',' expected`（isPunct 字符串字面量被内部 `''` 截断）
- **根因**：单引号字符串内混入半角单引号字符
- **解决**：改用全角引号字符（“”‘’）替代半角单引号
- **预防**：含引号的字符串用双引号/模板字符串；写中文标点用全角字符

### E-2026-010 TS6133 未使用变量/导出（4 处）
- **场景**：strict + noUnusedLocals 构建
- **现象**：`'num' is declared but its value is never read` 等 4 处
- **根因**：脚手架模板与 strict 配置（主动开启 strict）下的遗留未用代码
- **解决**：逐一删除未使用项；`parser/index.ts` 未导出的函数移出导出表
- **预防**：写完代码立即 `npm run build`（tsc -b）自检；不要留"以后可能用"的悬空代码

### E-2026-011 PageConfigDialog import 语句在文件中间
- **场景**：编写对话框组件
- **现象**：import 出现在文件中部（规范问题，潜在 lint 报错）
- **根因**：批量写文件时顺序失误
- **解决**：import 统一移至文件顶部
- **预防**：ES module import 一律顶部集中；提交前 `npm run lint`（oxlint）

### E-2026-012 冒烟测试失败：独立 `-` 被识别为未知符号
- **场景**：引擎冒烟测试（最有价值的 bug）
- **现象**：`无法识别的符号 "-"` ×6；小星星曲行 token 数错误
- **根因**：原站自动格式化会把 `5-`（增时线紧跟音符）拆成 `5 -`（空格分隔）；tokenizer 只在后缀收集阶段识别 `-`，独立出现的 `-` 落入未知分支
- **解决**：tokenizer 增加规则——独立 `-` 归入前一个 note/rest/rhythm token 的 augmentCount（并拼接 raw）
- **预防**：解析器行为必须以「原站格式化输出」为准（先跑原站格式化再解析）；冒烟测试覆盖"格式化后输入"场景

### E-2026-013 冒烟测试断言错误（8 vs 18）
- **场景**：编写测试断言
- **现象**：`第 1 组曲行含 8 个音符 token got 18`
- **根因**：断言写错——把"一行"误解为"一小节"（实际一行 4 小节：14 音符 + 4 小节线 = 18 tokens）
- **解决**：修正断言为 14 音符 + 4 小节线
- **预防**：断言数值先手工推算验证，再写进测试

---

## 四、流程 / 工具使用类

### E-2026-014 write 工具拒绝覆盖未读文件
- **场景**：覆盖脚手架自带 README.md / App.tsx
- **现象**：`cannot overwrite existing ... without reading it first`
- **根因**：fs-observation-policy 要求先读后写
- **解决**：先 read 目标文件再 write
- **预防**：覆盖既有文件前先 read（工具规范）

### E-2026-015 edit 工具报 "file changed since it was read"
- **场景**：连续修改 package.json
- **现象**：`file changed since it was read — re-read the file, then retry`
- **根因**：文件在读取后被外部修改（含自身前次编辑），编辑前状态过期
- **解决**：重新 read 再 edit
- **预防**：同一文件连续修改时，每次 edit 前确认最新内容；并发后台命令注意对同一文件的写冲突

### E-2026-016 npm install 与 dev server 并发导致 EPERM（tsx 安装失败 exit -4048）
- **场景**：dev server 运行中执行 npm install
- **现象**：`errno: -4048, syscall: 'spawn'`（esbuild postinstall）
- **根因**：混合因素：esbuild postinstall 的 spawn 限制为主；并发操作放大失败面
- **解决**：`--ignore-scripts` 安装（esbuild 平台包自带二进制）；后续卸载
- **预防**：① 安装涉及 spawn 的包用 `--ignore-scripts`；② 构建/安装与 dev server 尽量错开执行

---

### E-2026-017 冒烟测试断言错误（M1a：可见音符数误算 + 小节线相对坐标断言）
- **场景**：M1a 渲染冒烟测试
- **现象**：① `复杂行 7 个可见音符 got 6`——把隐藏休止符 8 也计入可见；② `SVG 含小节线双线 ||` 失败——断言用相对偏移坐标 `x="-4"`，而渲染输出的是绝对坐标
- **根因**：① 断言前未手工推算（一行 `1'- 2,,$ 3// 4. | 0 8 9 ||` 可见 = 6 个，8 隐藏不画）；② 把渲染实现细节（相对偏移）当成了输出契约（绝对坐标）
- **解决**：① 断言修正为 6；② 改为断言输出契约——数 `width="1.5"` 竖线（单线 1 + 双线 2 = 3 条）
- **预防**：测试断言前手工推算数值；断言只针对**输出契约**（绝对坐标/元素数量/属性值），不针对实现内部偏移量；与 E-2026-013 同类（推算不严），已纳入预防清单「断言数值先手工推算」

### E-2026-018 M1c 歌词对齐全空：slotStart 语义混淆
- **场景**：M1c 歌词对齐实现后冒烟测试
- **现象**：`第一行曲 14 个歌词字 got 0`——所有 PlacedLyric 未生成
- **根因**：placeSegment 的 `slotStart`（段起始**全局槽位序号**）误算为「段内槽位数量」（`slots.filter(s => s >= segStart && s < i).length`），导致歌词槽位索引从错误的偏移起步，全部匹配失败
- **解决**：改为 `slots.filter((s) => s < segStart).length`（该段开始前已放置的槽位数，即段首槽位的全局序号）
- **预防**：涉及「全局序号 vs 段内数量」的索引计算，先写最小样例手工推演；冒烟测试应覆盖**跨视觉行**的歌词对齐场景（本次测试未覆盖断行+歌词组合，导致 bug 只体现在全空而非错位）

### E-2026-019 M1c 测试断言再误（歌词总数 32 vs 14）
- **场景**：M1c 冒烟测试
- **现象**：`got 32`（期望 14）——`pages[0].lyrics` 含两行曲的全部歌词（14+18）
- **根因**：断言只算了第一行曲的歌词，未考虑页面聚合全部行（与 E-2026-013/017 同族：断言数值未按实际数据流推算）
- **解决**：断言修正为 32，并补充首/末/跨行歌词内容断言
- **预防**：已纳入预防清单「断言数值先手工推算」；聚合型数据（页面级）断言时先数清全部来源

### E-2026-020 M2 测试断言：光标位置（selectionStart）语义三处误判
- **场景**：行首命令插入函数冒烟测试
- **现象**：3 条断言失败（`insertLineHeader('B: t\n', 4, 'C')` 返回 null 等）
- **根因**：光标 position 表示"位于该字符**之前**"；`'B: t\n'` 的换行符在 index 4，position 4 实际在 't' 与 '\n' 之间（前一字符是 't'，非行首）；行首应为 position 5（'\n' 之后）。第 2、3 处同族（含 `lineColOf` 列数误判）
- **解决**：按"字符索引表"重推各断言的光标位置后修正
- **预防**：涉及字符串索引/光标位置的断言，先画出逐字符索引表再写数值；与 E-2026-013/017/019 同族，强化预防清单条目：「涉及索引/位置的断言先画索引表」

### E-2026-021 M3 测试断言：行起点心算漏算换行符（3 处）
- **场景**：光标映射冒烟测试
- **现象**：`光标在数字 2 后 → 0_1_0_0`（期望 0_1_0_1）、`位置 28`（实际 31）、分页反向定位偏移 1
- **根因**：行起点累计时心算漏算换行符（如 `'D: C\n'` 是 5 字符而非 4；`'P: 4/4\n'` 是 7 而非 6），导致整组位置断言偏移
- **解决**：按逐字符索引表重推全部行起点后修正断言
- **预防**：**测试中涉及行偏移的断言改用 `indexOf` 动态定位行起点**，杜绝心算硬编码；与 E-2026-020 同族，强化预防清单：「涉及索引/位置的断言先画索引表或用 indexOf」

### E-2026-022 音高映射 bug：简谱音级误用均匀半音步进（M1a 埋下，M4 播放测试揪出）
- **场景**：M4 播放序列测试（`[15]`）
- **现象**：`1 2 3 4` 的音高输出 `C4,C#4,D4,D#4`（期望 `C4,D4,E4,F4`）——每个音都低了/错了半音
- **根因**：`pitchToName` 用 `midi + (pitch-1)` 均匀半音步进；而简谱音级对应**大调音阶**（1→根音、2→大二度+2、3→大三度+4、4→纯四度+5、5→+7、6→+9、7→+11）。M1a 测试只断言 `audioPitch !== null`，未验证具体音名，bug 潜伏到 M4
- **解决**：改用 `DEGREE_SEMITONES = [0,2,4,5,7,9,11]` 按级数映射
- **预防**：**涉及音高/音名等"语义值"的断言必须验证具体值**，不能只查非空；音乐领域映射（音阶/拍号）先对照乐理确认

### E-2026-023 M4 实现细节三处：re-export 作用域 / 测试变量重名 / decodeAudioData 类型
- **场景**：M4 播放模块实现与测试
- **现象**：① `export { X } from './y'` 后同一文件 `new X()` 报 `Cannot find name`；② smoke 测试 `[12]`/`[15]` 段 `s1~s4` 变量重名（oxlint no-redeclare）；③ `decodeAudioData(bytes.buffer.slice(...))` 报 SharedArrayBuffer 类型错误
- **根因**：① TS 语义——re-export 不把符号引入当前模块作用域，使用前需显式 import；② 测试分段追加时未检查已有命名；③ `.slice()` 返回 `ArrayBuffer | SharedArrayBuffer`
- **解决**：① 改为显式 `import` + 再 `export`；② 重命名 `ps0~ps4`；③ `as ArrayBuffer` 断言
- **预防**：① 模块内"先 import 再 export"；② 测试新增段前 grep 变量名；③ 浏览器类型 API 注意联合类型返回

## 五、预防清单（Checklist，提交/交付前自检）

- [ ] 所有 npm 命令带 `--cache "D:/Coding/JPCoder/.npm-cache"`
- [ ] 抓取网页带浏览器 UA；解码前确认真实编码
- [ ] 新增/修改代码后：`npm run build`（tsc strict）+ `npm run lint`（oxlint）+ `npm run smoke` 全绿
- [ ] import 全部在文件顶部；无未使用变量（strict 会自动拦）
- [ ] 解析器行为对照 docs/JPS-SPEC.md 与原站格式化输出
- [ ] 测试断言数值先手工推算
- [ ] 新工具链先确认沙箱兼容（无 spawn / 无外部依赖）
- [ ] 覆盖既有文件先 read；并发命令注意写冲突

## 六、开发纪律（制度）

1. **每次排错后 30 分钟内**追加本日志（现象/根因/解决/预防四要素），编号 `E-年份-序号`
2. 高频错误（沙箱类）的预防措施写进 README 与开发脚本注释，让"下一个开发者"（包括未来的我）直接可见
3. 每期里程碑（见 docs/ROADMAP.md）收尾时复核预防清单
4. 根因归类：能归为系统性（沙箱/工具链）的，优先通过脚本/配置固化解决，而非每次手工规避

## 七、变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-08-16 | 建立日志：收录 E-2026-001 ~ 016（M0 阶段全部错误） |
| v0.1 | 2026-08-16 | 追加 E-2026-017（M1a 测试断言两处） |
| v0.1 | 2026-08-16 | 追加 E-2026-018/019（M1c 槽位索引 bug + 断言误算） |
| v0.1 | 2026-08-16 | 追加 E-2026-020（M2 光标位置语义断言三处） |
| v0.1 | 2026-08-16 | 追加 E-2026-021（M3 行起点心算漏换行符，3 处） |
| v0.1 | 2026-08-16 | 追加 E-2026-022/023（M4 音高映射 bug + 实现细节三处） |
