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

### E-2026-024 M5 字符串引号被改坏（TS1002 Unterminated string literal）
- **场景**：render 三套字形改造
- **现象**：`FONT_CN` 行结尾单引号（`sans-serif'`）导致字符串未闭合，tsc 报 TS1002
- **根因**：批量替换字体常量块时，相邻行 `FONT_CN` 的结尾引号在替换中受损（原双引号变单引号）
- **解决**：定位 42 行修复为双引号
- **预防**：多行常量替换后立即 build 自检；涉及引号的替换，替换块边界行逐字核对

### E-2026-025 M6 ExportDialog 未使用变量 closeModal（TS6133）
- **场景**：导出对话框改造
- **现象**：`'closeModal' is declared but its value is never read`
- **根因**：从旧版（模态由 store 关闭）复用时遗留的 store 读取；新版 Modal 组件自管关闭
- **解决**：删除 closeModal 及相关 import
- **预防**：组件改造后 build 自检（unused 由 tsc strict 拦截，已常态化）

### E-2026-026 M7a 混合排版断言误算（15 vs 16）+ totalW 未使用
- **场景**：多声部+单声部混合测试
- **现象**：① `总音符 16 got 15`；② TS6133 `totalW is declared but never read`
- **根因**：① 把末行 `Q: 5 3 1 - |` 的数成 4 音符，实际 `1 -` 是 1 音符+增时线（3 音符）；② 多声部块宽度预计算后未使用（块超宽处理未实现）
- **解决**：① 断言修正 15；② 删除 totalW
- **预防**：与 E-2026-013/019 同族（聚合计数先手工推算）；块宽度处理留待后续（已记 TODO）

### E-2026-027 M7b 番号合并（引号后空格）+ M7d 测试变量重名
- **场景**：跳房子番号、装饰符号测试
- **现象**：① `|"1." [ 3 4 ]` 的番号与 `[` 未合并（引号与 [ 间有空格，落在独立分支）；② smoke `t0` 变量与 [2] 段重名
- **根因**：① tokenizer 的 barline 分支在引号备注处理后未跳过空格继续检查 `[`；② 测试分段追加未查重（E-2026-023 同类）
- **解决**：① 独立 `[` 分支继承前一小节线（含番号）合并 voltaStart；② 改名 dt0/dt1
- **预防**：① 语法边界（备注/标记相邻带空格）用宽容合并策略；② 测试新增段先 grep 变量名

### E-2026-028 M9 跳房子谱解析错误：小节线备注前带空格未消费
- **场景**：`fanfu-tiaofangzi.jps`（`:| "2."` 反复结束后空格再引号）
- **现象**：`无法识别的符号 """` + `引号注释未闭合`；播放序列少 3 音符
- **根因**：tokenizer 的 barline 分支在解析 `:|` 后直接检查引号，未跳过尾随空格，导致 `"2."` 落入未知字符分支（与 E-2026-027 同族：备注/标记相邻带空格）
- **解决**：barline 分支解析后先 `while (content[j]===' '||content[j]==='\t') j++` 再处理引号与 `[ ]`
- **预防**：语法边界（标记+备注+空格任意组合）统一先跳过空白再判后续 token；新增复杂演示谱必须纳入 smoke（本谱就是靠 M9 示例谱测试揪出的）

### E-2026-029 T1 缺 MSVC 链接器 → 切换 GNU 工具链方案
- **场景**：Tauri 环境搭建，cargo 编译 hello world
- **现象**：`error: linker 'link.exe' not found`（msvc targets 需要 Visual Studio Build Tools，本机未装）
- **根因**：rustup stable-msvc 工具链需要 MSVC 链接器；系统无 VS Build Tools（VS Code 不提供）
- **解决**：① `rustup toolchain install stable-x86_64-pc-windows-gnu`（rustc 1.97.1 GNU）；② 下载 winlibs MinGW-w64（gcc 16.2.0，GitHub releases 105MB 7z，tar 解压到工作区）；③ `rustup default stable-x86_64-pc-windows-gnu` + PATH 加 `mingw64\bin`；④ 实测编译通过（cargotest.exe 4.7MB）
- **预防**：Windows 上 Rust 编译先探测链接器（msvc link.exe 或 gnu gcc）；无 VS Build Tools 的机器直接上 GNU 工具链；cargo/rustup 命令必须带 `CARGO_HOME/RUSTUP_HOME`（工作区）+ PATH（rustup 不自改 PATH 时）

### E-2026-030 T1 环境变量不跨 pwsh 进程
- **场景**：rustup 安装后验证 rustc/cargo
- **现象**：`could not create home directory: 'C:\Users\snail\.rustup': 拒绝访问`
- **根因**：每条 pwsh 命令是独立进程，上一条设置的 `CARGO_HOME/RUSTUP_HOME` 不保留；rustup 回退默认用户目录被沙箱拦截
- **解决**：所有 rust/cargo/tauri 命令在同一命令内设置 `$env:CARGO_HOME = "D:\Coding\JPCoder\.cargo"; $env:RUSTUP_HOME = "D:\Coding\JPCoder\.rustup"; $env:PATH += ".cargo\bin;mingw64\bin"`
- **预防**：Rust 相关命令统一前置三件套环境变量；可封装为 `scripts/env-rust.ps1` 或统一命令前缀

### E-2026-031 T1 沙箱隔离证书存储 → Rust/git schannel TLS 全失败（SEC_E_NO_CREDENTIALS）
- **场景**：cargo 拉取 crates.io 依赖索引
- **现象**：`SSL connect error (schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS)`——cargo（crates.io/rsproxy）、git（schannel 后端）全部 TLS 失败；git openssl 后端可连（TLS 通，镜像 git 索引 404 已停）；node fetch 正常
- **根因**：DSH 沙箱（workspace-write）隔离了 Windows 证书存储访问 → schannel AcquireCredentialsHandle 拿不到凭据；node 的 fetch 不受影响
- **解决**：**cargo/tauri 构建命令使用 danger-full-access 权限**（沙箱放宽后证书存储可访问，rsproxy-sparse 镜像下载成功）；`.cargo/config.toml` 配置 rsproxy 镜像 + `git-fetch-with-cli`
- **预防**：① 本机 Rust 相关网络操作一律 danger-full-access；② 沙箱内 Rust/git https 报 SEC_E_NO_CREDENTIALS 先怀疑证书存储隔离（而非网络）；③ node fetch 用于下载工具链（rustup-init/MinGW/winlibs）不受此限

### E-2026-032 T1 沙箱下 WebView2 初始化失败（exe panic 101）
- **场景**：tauri exe 试运行
- **现象**：workspace-write 权限下 exe 启动即退出 code=101（Rust panic）；无 stderr 输出
- **根因**：DSH 沙箱限制 WebView2/COM 初始化（无完整桌面会话权限）；DLL 检查正常（WebView2Loader.dll 随行、GNU 运行时静态链接）
- **解决**：danger-full-access 权限下运行，进程正常存活（GUI 启动）
- **预防**：Tauri GUI 验证/运行一律 danger-full-access；先查 DLL 依赖（objdump -p）再查权限

### E-2026-033 adj1 排版重构：splitBars 尾部空段 + 行首线省略误判
- **场景**：时值等宽/小节均分重构后冒烟测试
- **现象**：多声部块小节数多 1（`块小节线跨声部` 失败）、单小节行尾线被误省略（`小节线数 9 got 8`）、超长行不断行（`rows=1`）
- **根因**：① `splitBars` 末尾总压入空 seg（`bar:null`），多声部 `numBars = max(segs.length)` 多算 1 个空小节；② 行首省略逻辑按 `b === row.start && type==='|'` 判断，把"单小节行的尾线"（notes 非空的 seg）误当行首线省略；③ 断行只按小节自然宽，无小节线的超长行（42 音符一行）无法断行
- **解决**：① 末尾空 cur 不压入 segs；② 省略条件改为「行首**空小节**（notes 为空）的普通 |」；③ 断行增加**超长小节碎片行**（按行拍上限 maxBeats 拆 frag 行，frag 行按时值铺满）
- **预防**：重构排版模型时，先画清「小节/行/音符」边界图再写代码；测试覆盖边界形态（行首 |: 空 seg、单小节行、无小节线长行）

### E-2026-034 adj2 用户反馈四问题修复（小节线/增时线/歌词对齐/快捷键误触）
- **场景**：细节调整批次（用户反馈）
- **现象与根因**：
  ① **小节线画在小节中心**：均分模型下 `x + barW/2` 是节中心，应为小节右边界 `x + barW`；行首空 seg（`|:`）占满节宽把音符推远 → 空 seg 宽 0、线贴行首
  ② **增时线像下划线**：`augY = y - 2` 贴近基线（数字底部），应为数字中部 `y - 8`
  ③ **歌词未对齐音符**：歌词中心对齐"含时值宽的整体中心"（`nx + w/2`），增时线音符歌词偏右 → 改为对齐音符数字（`nx + 6`，数字半宽近似）
  ④ **编辑歌词光标跳**：行首命令快捷键在 C 行行首按 B/Z/D/P 等误插命令头；且 IME 合成事件未排除 → 按行类型限制（C 行仅 C、Q 行仅 Q/C）+ `e.nativeEvent.isComposing` 排除
- **解决**：四项逐一修复（见 adj2 提交）
- **预防**：① 坐标语义（起点/中心/边界）实现后立即画图核对；② 符号绘制先对照简谱规范定位置（增时线居中）；③ 对齐基准（数字 vs 整体）明确后再写；④ 快捷键类交互必须考虑行上下文与输入法

### E-2026-035 adj3 音符密度重叠（窄小节内多音符数字重叠 + 减时线交叉）
- **场景**：音符段内居中实现后冒烟测试
- **现象**：`1/2/3/4/` 的减时线横线交叉（`[84.6,101.1]` 与 `[99.1,115.6]` 重叠）；音符数字重叠
- **根因**：小节自然宽固定按 `拍数 × BPW_NATURAL(14)`，未考虑拍内音符密度——4 个八分（2 拍）时 perBeat=14.5，八分间隔 7.25px < 数字宽 11.16 → 数字/横线重叠
- **解决**：**密度感知的每拍最小宽** `segPerBeatMin = max(BPW_NATURAL, 拍内最大音符数 × MIN_NOTE_W(11.5))`；小节自然宽、断行、最后一行逐小节宽、frag 行与多声部块 perBeat 全部按此计算（数学保证均分行 perBeat ≥ perBeat_min）
- **预防**：排版宽度计算必须考虑「拍内最大音符密度」（十六分/八分混排）；写断言时先手算 perBeat（含密度）再定期望

### E-2026-036 adj4 宽度语义澄清：PlacedToken.width（段宽）与 x（数字左缘）非同一参照
- **场景**：adj4 最后一行规则改动后冒烟测试
- **现象**：`音符不超出右边距 maxX=520.9`、行 2 对齐断言索引错误
- **根因**：① 音符段内居中后，`x` 是数字左缘（段中点-6），`width` 是段宽（dur×perBeat）——`x + width` 不等于段终点（应为 `x + 6 + width/2`）；② 行 2 对齐断言把 `row2Bars[0]` 误与 `row1Bars[1]` 比较
- **解决**：① 边界断言统一用「段终点 = x + 6 + width/2」；② 断言索引修正（row2Bars[i] ↔ row1Bars[i]）
- **预防**：坐标字段语义（起点/中心/左缘）变更后，所有基于坐标的断言/计算需同步复核参照系；新断言先输出实际值核对再写期望

### E-2026-037 预览"挤在左侧"：超拍小节与密度导致的音符溢出重叠
- **场景**：用户反馈预览中所有曲部/词部按节挤在左侧
- **现象**：小节内容超出小节边界，与下一小节音符重叠堆叠（视觉=挤在左侧）
- **根因**：① **超拍小节**（实际拍数 > 拍号，如示例谱连音线谱第 2 小节 6 拍、语法谱第 1 小节 5 拍）perBeat 仍按拍号算 → 音符溢出小节右边界；② frag 行 perBeat 用整个 seg 的密度（应为片内密度）；③ 最后一行对齐（alignW）时高密度小节被密度撑大溢出
- **解决**：① 每小节 perBeat 按 `max(拍号拍数, 小节实际拍数)` 分摊，超拍音符铺满小节不溢出（多声部块同理取块内最大实际拍数）；② frag 行用片内 slice 密度；③ 最后一行对齐前做密度保护（任一小节自然宽超 alignW 则回退均分）
- **预防**：示例谱/用户谱可能存在超拍小节（弹性拍），排版必须按实际拍数容错；写谱时注意拍号匹配；渲染验证增加"相邻音符间距 ≥ 数字宽"断言

### E-2026-038 adj6 增时线坐标浮点未舍入
- **场景**：增时线占一拍实现后的渲染
- **现象**：SVG 输出 `x="268.40000000000003"`，断言字符串匹配失败
- **根因**：render 的增时线 lx/lw 计算未应用 r1n 舍入（其他坐标均舍入）
- **解决**：lx/lw 用 r1n；断言改为数值解析比较（宽容 ±0.5）而非字符串匹配
- **预防**：新增 SVG 元素输出前统一舍入；坐标断言用数值比较而非字符串包含

### E-2026-039 adj12 metaPos 语义变更：绝对坐标 → 描述区左上角相对坐标
- **场景**：描述头拖拽位置与描述区联动
- **现象**：拖拽保存的绝对坐标在描述区调整（margin_top/body_margin_top 变化）后不跟随，元素可能脱离区域
- **根因**：adj9 的 metaPos 存页面绝对坐标；描述区高度/上边距变化时绝对位置不变
- **解决**：metaPos 改为相对描述区左上角（渲染 = 相对 + margin_left/margin_top）；clampMetaPos 改为相对钳制（0..区域宽高）；首次拖拽时元素绝对坐标转相对
- **预防**：可拖拽元素的位置存储优先用「相对锚点」语义，便于容器联动；**旧 localStorage 中的绝对 metaPos 需用户重置（恢复默认或重拖）**

---

## 本批次：连音线/小节线/修饰符/字体/多连音线（E-2026-054 ~ 065）

### E-2026-054 T1 链接失败：MinGW 导出序数过大（export ordinal too large）
- **场景**：Tauri v2 桌面端 cargo 链接（GNU 工具链）
- **现象**：`error: export ordinal too large: 89966`，链接失败
- **根因**：`src-tauri/Cargo.toml` 的 crate-type 含 `cdylib`，MinGW ld 对 cdylib 导出序数有上限；桌面端实际只需 staticlib+rlib
- **解决**：crate-type 由 `["staticlib","cdylib","rlib"]` 改为 `["staticlib","rlib"]`
- **预防**：GNU/MinGW 工具链下避免 cdylib；链接报"导出序数过大"先查 crate-type

### E-2026-055 T1 环境脚本失效：tauri-env.ps1 指向旧路径
- **场景**：tauri dev / cargo 命令
- **现象**：`tauri-env.ps1` 指向已删除的 `D:\Coding\JPCoder`，环境变量未生效
- **根因**：项目从 JPCoder 迁移到 JianpuScript 后脚本未同步；pwsh 每条命令独立进程，`$env` 不保留
- **解决**：每条 rust/cargo/tauri 命令内联设置 `CARGO_HOME/RUSTUP_HOME/PATH`（指向 `D:\Coding\JianpuScript\.cargo/.rustup/mingw64`）
- **预防**：迁移目录后检查环境脚本；rust 命令统一前置三件套环境变量（与 E-2026-030 同族）

### E-2026-056 撤销合并失效：替换操作无"相邻性"
- **场景**：编辑器撤销/重做（Ctrl+Z / Ctrl+Y）
- **现象**：连续替换操作未合并成一条历史（isAdjacentEdit 对替换返回 false）
- **根因**：isAdjacentEdit 按插入位置相邻判断，替换操作没有"相邻"语义
- **解决**：history.ts 改为纯时间窗合并（1200ms 内连续编辑并入一条，上限 50 条）
- **预防**：历史合并规则先确定适用操作类型（插入/删除/替换）；替换类操作单独测

### E-2026-057 拍号分数与 J 速度文本几何错位
- **场景**：渲染拍号（4/4）与 J 速度文本
- **现象**：拍号分数数字间距/基线错位；J 多行（tempoNum/tempoText）布局错误
- **根因**：拍号分数未按"分子/分母独立数字 + 文本中心线"布局（需行=文本中心线、数字间距 2px、J 符号偏移 −12）
- **解决**：splitTempo 拆分 tempoNum/tempoText；拍号行=文本中心线、数字间距 2px、J 偏移 −12
- **预防**：文本渲染先定基线语义；分数式文本逐元素核对

### E-2026-058 歌词音节划分：CJK 每字一音节
- **场景**：歌词对齐
- **现象**：中文歌词按词/整句对齐错位
- **根因**：音节划分未按"每 CJK 字符一音节"（`\p{Script=Han}`）
- **解决**：parser 歌词解析每个汉字独立成音节
- **预防**：歌词对齐规则先定音节划分（汉字单字、空白分隔）

### E-2026-059 小节线分型几何：||、||/、|:、:|、:|:、|/、|*
- **场景**：小节线渲染
- **现象**：多型小节线（双细/粗细/点线组合/占位不显示）几何错位
- **根因**：小节线只有单一竖线实现，未按类型区分（细 1.5/粗 3/点 r1.8/间距 2）
- **解决**：renderBarline 按类型输出几何；空间= max(bar_gap, totalW+8)；钳制 [margin_left, page.width−margin_right]；行首 leadPad=totalW+4；`|/` 不显示不占位、`|*` 占位不显示；高度 基线−16.4..+2.5；点垂直居中 ±4
- **预防**：符号类型矩阵先列全再实现；线宽/间距常量集中定义

### E-2026-060 连音线：FIFO 配对 + 跨行半段 + 自动样式
- **场景**：连音线渲染（自动/弧线/平顶）
- **现象**：① 嵌套配对用 LIFO 与用户预期（先开先配）不符；② 跨行半段形状错；③ 自动样式选择错误
- **根因**：① 栈式配对；② 跨行半段用整弧而非半段 cubic；③ 自动样式未按音符数（≤4 弧线、>4 平顶）
- **解决**：FIFO 队列配对（shift）；跨行半段 cubic（l: 低→高、r: 高→低）、平顶单腿半段；slurStyleOf 按音符数；行末延伸至小节线、行首从边距开始、端点最高；y 基准=基线−19（高点 −26−(hi−1)*7，按行 maxDepth 叠加）；间距基准=实测数字高（顶=基线−14.4）
- **预防**：配对顺序先与用户确认（FIFO）；跨行/嵌套先画坐标草图再写

### E-2026-061 分数拍小节宽度过算 + 拍内偏移漏算（溢出行修复）
- **场景**：用户溢出行 `Q: 1) 6,. 0/ 6,/ ((6/ 5/) | 5/)) 5. 0/~ 2/ 2 1/ | ...`
- **现象**：行宽 517.16 > 页面 515.28，音符溢出
- **根因**：① 分数拍小节 segBarW 把整个尾拍按全拍算（应为 overlap×pb）；② 拍中段起始音符漏算拍内偏移（offInBeat = frac×perBeat）
- **解决**：segBarW = Σ overlap×pb 精确分数；首段 offInBeat = frac×perBeat；JPS_DEBUG 临时日志定位后移除
- **预防**：小数拍/跨拍场景先手算宽度；加临时日志定位；溢出行纳入冒烟回归（[54]）

### E-2026-062 第 2 页起无描述区（bodyTopH）
- **场景**：多页渲染
- **现象**：第 2 页起仍预留描述区高度，正文下移
- **根因**：metrics.bodyTopH 未按页序区分（descArea 只在第 1 页）
- **解决**：页 0 用 margin_top+descArea，页 2+ 用 margin_top+body_margin_top；renderMeta 仅页 0
- **预防**：分页布局按页序分支；多页断言覆盖

### E-2026-063 字体/字号可配置：标题/副标题/歌词/音符
- **场景**：描述头标题/副标题、歌词、音符字体字号
- **现象**：固定字号无法满足排版需求
- **根因**：渲染未接入配置
- **解决**：新增 biaoti_font/fubiaoti_font/geci_font/note_size/geci_size 配置；布局按 note_size 缩放（minNoteW=0.62×noteSize+1、halfDigitW=0.31×noteSize、digitW=0.62×size）；PageConfigDialog 增加对应行
- **预防**：字号配置同时影响布局与渲染，改动需同步冒烟断言

### E-2026-064 三连音/多连音线：(1 2 3) 与 (y1 2 3)
- **场景**：连音线语法 `(1 2 3)` 三连音、`(y1 2 3)` 平均三连音
- **现象**：① `(y...` 未按平均时值分配；② 弧线正中数字标签与弧线重叠
- **根因**：① tupletDur 未设置（各自时值）；② 标签无背景
- **解决**：applyTupletDurations 计算 tupletDur（小节名义 − 其它音符实际）/n 均分；tokenDuration 优先 tupletDur；标签=组内音符数、弧线/平顶正中、白色不透明背景
- **预防**：三连音时值规则先与用户确认（`(` vs `(y`）；标签加不透明背景防重叠

### E-2026-065 调试方法沉淀：读图受限→像素扫描；shell 正则→edit/write
- **场景**：几何调试（连音线间距、小节线高度）
- **现象**：① Edge 无头截图被沙箱拦截（crashpad/OpenProcess）；② 当前模型无法读图；③ PowerShell `-replace` 正则 `\1` 反引号失效/损坏文本
- **根因**：沙箱限制截图进程；模型无图像输入；shell 文本处理不适合源码编辑
- **解决**：像素扫描（System.Drawing Bitmap 实测，YaHei 数字顶=基线−14.4、间距 0.8em）；截图命令一次性 danger-full-access；源码修改一律 edit/write 工具
- **预防**：几何数值以实测像素为准；临时调试日志（JPS_DEBUG）用完即删；HMR 中间态报错以最终文件为准

### E-2026-066 adj42 调式/节拍 = 号对齐：加空格不足以对齐，需按实测字形宽补偿
- **场景**：调式行 `1 = C` 与节拍行 `♩= 80` 的 = 号垂直对齐
- **现象**：仅给两行加空格（`1 = C`、`♩= 80`）后 = 号仍不对齐（差约 4.5px）
- **根因**：`=` 前的文本宽不同——`1 `（数字 7.62 + 空格 3.85 = 11.47px）比 `♩`（7.0px）宽；比例字体无法靠空格精确对齐
- **解决**：GDI 实测 13px YaHei 字形宽（数字 7.62、空格 3.85、♩ 7.0、= 9.64、CJK 13），节拍行 x 偏移 = w("1 ") − w("♩") = 4.47px；仅当节拍行含 `♩=` 前缀时偏移（纯文字节拍不偏移）
- **预防**：跨行符号对齐先测实际字形宽再定偏移，不依赖空格；`tempoLabel` 统一 `♩= N` 格式（= 后空格）

### E-2026-067 页号不在导出内：页号原为预览页外 HTML
- **场景**：多页谱导出 SVG/PNG/JPG
- **现象**：导出图片看不到"第 1/2 页"（预览有、导出无）
- **根因**：页号是 PreviewPane 里 SVG 下方的 HTML 文本，不在 SVG 内；导出走 renderScoreToSvg 自然没有
- **解决**：页号渲染进 SVG（renderPageNum）：多页时每页输出"第 X / N 页"，x=页面水平中心，y=下边距线与页面边沿的中点（基线+字号×0.35）；单页不画；删除预览页外 HTML 页脚避免重复
- **预防**：任何应随导出输出的元素必须渲染进 SVG 而非预览组件 HTML；新增渲染内容补冒烟断言（页号 x/y/单页不画）

### E-2026-068 下边距虚线拖拽方向反了：margin_bottom 需 invert
- **场景**：预览拖拽下边距虚线调节 margin_bottom
- **现象**：线位于 `page.height − margin_bottom`，向下拖时 margin_bottom 增大 → 线反而上移（方向与鼠标相反）
- **根因**：dragDelta 对 `dir:'v'` 直接加增量；下边距线的 y 与 margin_bottom 成反比，与上边距（成正比）相反，需像 margin_right 一样 invert
- **解决**：PreviewPane 与 GUIDE_ITEMS 中 margin_bottom 补 `invert: true`（下拉 = 线跟随鼠标 = margin_bottom 减小）
- **预防**：拖拽方向与字段成反比的项（bottom/right 边距）必须带 invert；实现后手工验证"线跟随鼠标"

### E-2026-069 普通连音线 (…) 误标数字：tupletCount 应仅限 (y 平均组
- **场景**：多连音线标注数字
- **现象**：`(1 2 3)` 普通连音线也画了数字"3"（需求：只有 (y...) 平均连音标数字）
- **根因**：layout 对所有连音线无条件填 `tupletCount: noteCount`，render 以 `tupletCount ≥3` 判定画数字，未区分 ( 与 (y
- **解决**：配对队列携带 tuplet 标志（sQueue/slurPairs 加 `tuplet` 字段），仅 `sp.tuplet` 时填 tupletCount；render 判定改为 `tupletCount ≥2`（(y 组至少 2 音符）
- **预防**：连音符与平均连音组语义不同，标注条件必须以 token 的 tuplet 标志为准，不能只看音符数

### E-2026-070 平均连音数字偏上 2px：基线应对齐线正中
- **场景**：(y...) 平均连音组数字位置
- **现象**：数字偏在线条上方，未居中
- **根因**：文字基线直接取线 y（弧线顶点/平顶横线 y），数字视觉中心在基线上方
- **解决**：数字（rect + text）整体下移 2px（`dy = 2`），使其位于线正中
- **预防**：文字垂直居中不能把基线当中心，需按字形视觉中心补偿偏移

### E-2026-071 跨拍平均连音组音符不等距：数字只按首段居中 + 拍间距按音符起始拍计
- **场景**：`0/ 7/ 7/ 1'/ (y2' 7 6)` 小节，(y...) 组平均分摊 2 拍宽度
- **现象**：三连音音符间距不等（51.4/89.7），中间音符明显左偏
- **根因**：① placeNoteAt 数字中心 = 首段中点 `first.beats*perBeat/2`，跨拍音符首段只有部分时值 → 数字偏左（应居中于整段 `w/2`）；② 拍间距 `Math.floor(notePos)*NOTE_GAP` 按音符起始拍计，组内跨拍音符的尾部与下一音符拍基准错位 4px
- **解决**：① 数字中心分两种：增时线/附点音符锚定首段（- 占后续拍），普通音符（含跨拍连音组）居中于整段 `x + w/2`；② 组内音符统一用组起始拍作拍间距基准（`gapOf` 字段，栈跟踪 (y 开闭），组内无拍间距错位
- **预防**：跨拍音符的数字/间距都要以「整段/整组」为基准，不能按首段/起始拍；测试覆盖跨拍连音组等距断言

### E-2026-072 连音线只查端点高音点：中间音符高八度与线交叉
- **场景**：`(1 2' 3 4)` 中间音符带高八度
- **现象**：线画在基线-19，中间 2' 高音点顶在基线-22，线与点交叉重叠
- **根因**：slurYFor 只用端点 a/b 的 octaveShift（`Math.max(highOf(a), highOf(b))`），未检查连音符覆盖范围内中间音符的高音点
- **解决**：新增 `maxHiInRange(startIdx, endIdx)` 取覆盖范围内所有音符的最大高音点数；跨行左半部取 起始→行末、右半部取 行首→结束
- **预防**：连音线避让逻辑必须扫描整条线下方所有音符，不能只看两端；嵌套抬升只对真正重叠的连音符生效（独立连音符不因同排其他嵌套被抬高）

### E-2026-073 页面设置分组调整：描述头字体独立配置 + 排版辅助移至工具栏图标
- **场景**：页面设置对话框项位置与分组调整
- **现象与需求**：① 分组顺序应为 页面大小/边距 → 间距 → 字体设置 → 连音线样式；② 间距应分 曲上/曲下/词下/小节 四项；③ 字体设置按 描述头/标题/副标题/音符/歌词 各一行（先字体下拉框再字号框）；④ 排版辅助开关从对话框移出，改为预览上方工具栏的纵横线图标按钮
- **根因**：原对话框无「描述头」独立字体（调式/拍号/节拍/作者写死 FONT_CN 13px），且「显示」分组内含排版辅助勾选，与工具栏按钮重复
- **解决**：PageConfig 新增 `miaoshu_font`/`miaoshu_size`（默认 Microsoft YaHei / 13，描述头各行字号随其缩放：作者 = size-1、辅助拍号 = size-3）；renderMeta/renderMeterMeta 改读配置；PageConfigDialog 按新分组顺序重排并删「显示」分组；Toolbar 排版辅助按钮改为纵横线 SVG 图标（横竖参考线 + 虚线）
- **预防**：描述头字号改动会同时影响调式/拍号/节拍/作者，需用冒烟断言验证 font-size 联动（[49] 新增 4 条）；localStorage 旧配置经 `{...defaultPageConfig, ...old}` 合并自动补齐新字段

### E-2026-074 拆分视图不可调窗格高度 + 编辑器字号固定 + 排版辅助按钮非纯图标
- **场景**：拆分模式 / 脚本编辑器 / 工具栏交互调整
- **现象与需求**：① 拆分模式下上下两个窗格高度固定（各 50%），无法拖动调整；② 编辑器字号固定 14px，无快捷调整入口；③ 排版辅助按钮带文字，需求为纯图标（左上角纵横线 + 右下角纵横线的图标样式）
- **根因**：App.tsx 拆分视图直接并列两个 flex:1 窗格，无分隔条与拖拽逻辑；编辑器字号写死 CSS（14px / 行高 23.8px）；工具栏按钮为「图标 + 文字」
- **解决**：① uiStore 新增 `splitPct`（localStorage 持久化，钳制 15%~85%），App.tsx 拆分视图用上窗格 `flex: 0 0 pct%` + 可拖拽 `.split-divider`（mousemove 按主区高度换算百分比）；② uiStore 新增 `editorFontSize`（10~26px 持久化），EditorPane 顶部状态栏加 A−/A+ 按钮与当前值，字号经 CSS 变量 `--jp-editor-fs`/`--jp-editor-lh`（字号×1.7）驱动 textarea/高亮层/行号栏，光标跳转滚动行高同步；③ 工具栏排版辅助按钮改为纯 SVG 图标（左上角 L 形横竖线 + 右下角对角 L 形横竖线，内衬虚线）
- **预防**：可拖拽分隔条用容器 rect 高度换算百分比，勿用全局坐标；字号类配置用 CSS 变量集中驱动，避免 textarea 与高亮层/行号栏不一致；按钮文字与图标需求以用户指定为准

### E-2026-075 跨行跳房子起点：断行在 [ 起点线后 → 起点线移到下一行行首
- **场景**：超宽行（如 `(3/ 2// 3//) 5 ... |[+"1." ... :|]`）断成两行，跳房子起点 `[` 恰在断行处
- **现象**：① 跳房子起点线画在上一行行尾（x≈514.5），番号 "1." 溢出右边距（文本 x=519.5 > 515.28）；② 跳房子线从行尾反向连到下一行行尾（起点 x > 终点 x，跨行反向）
- **根因**：voltaStart 小节线由 splitBars 归属到小节线前一小节；断行发生在该线之后时，线仍留在上一行行尾渲染，未随小节移到下一行行首
- **解决**：placeMusicRow 新增 `leadVoltaBar`（行首检测 `segs[row.start-1].bar.voltaStart`），在行首贴左边距渲染该线；行尾渲染跳过"本行最后一节且还有下一行"的 voltaStart 线（`movesToNextRow`）
- **预防**：小节线归属 + 断行边界组合（跳房子/反复/`|:` 等带修饰线）都要考虑"线随小节走行首"；断行冒烟断言覆盖跨行跳房子（[56] 新增 6 条）

### E-2026-076 颜色方案不随系统浅深色自动切换：新增 浅色/深色/跟随系统 模式
- **场景**：操作系统在浅色/深色间切换时，应用配色不变化；主题菜单无浅色选项
- **现象**：全部 7 个主题只有深色一套变量，浅色模式下界面仍是深底亮字，阅读/对比度不适
- **根因**：theme.css 只有 `:root` 与 `[data-theme=x]` 深色变量，无 `[data-mode='light']` 浅色变体；uiStore 无模式状态，App 只挂 `data-theme` 未挂 `data-mode`
- **解决**：① uiStore 新增 `themeMode: auto|light|dark`（localStorage 持久化）与 `systemLight`（matchMedia prefers-color-scheme 实时监听）；② App 计算 `effectiveMode`（auto 跟随系统）并挂 `data-mode` 属性；③ theme.css 为每个主题补浅色变量组（含编辑器高亮色、滚动条滑块 `--jp-scrollbar`），`[data-mode='light']` 为黛蓝默认浅色、`[data-theme=x][data-mode='light']` 覆盖其余主题；④ MenuBar 主题菜单顶部加 跟随系统/浅色/深色 三段按钮，色块预览随模式切换
- **预防**：新增界面色一律走 CSS 变量，禁止硬编码；浅深色两套必须同 key 定义；系统级外观切换用 matchMedia 监听而非一次性读取

### E-2026-077 连音线/高音点/减时线/低音点间距由 4px 收紧为 2px
- **场景**：乐谱元素垂直间距（连音线下沿、高八度点、音符、减时线、低八度点）
- **现象与需求**：① 连音线下沿 与 高八度点/音符上沿；② 高八度点 与 音符上沿；③ 音符下沿 与 减时线；④ 减时线 与 低八度点——四组间距统一由 4px 收紧为 2px
- **根因**：既有几何常量按 4px 设计（slur 基线-19/有高音点-26、高音点 cy 基线-20、减时线 y+6、低音点 cy y+8/有减时线 y+13.5）
- **解决**：① slur：无高音点 基线-16.4、有高音点 基线-22.4-(hi-1)×7（高音点顶 = 基线-20.4-(hi-1)×7，2px 基准）；② 高音点首点 cy = 基线-18.4（点底距数字顶 2px，沿用 7px 点间距）；③ 减时线 y = 基线+4+(level-1)×3（距音符下沿 2px）；④ 低音点无减时线 cy = 基线+6、有减时线 cy = 基线+9.5+(dc-1)×3（点顶距线底 2px）
- **预防**：几何间距常量集中定义并配冒烟断言（[34]/[35]/[43]/[55] 更新 6 条）；改动间距时同步核对相邻元素链（高音点→线、音符→线、线→低音点）

### E-2026-078 线宽统一：连音线/跳房子线/减时线/小节线细线 1.1、粗线 1.8；小节线增高；跳房子起止 ±2px
- **场景**：乐谱线条类元素线宽与尺寸调整
- **现象与需求**：① 连音线、跳房子线、减时线、小节线细线调为 1.1，小节线粗线调为 1.8；② 小节线与音符字体等高后再上下各延伸 4px（上端 基线-18.4、下端 基线+4.5）；③ 跳房子起点 = 小节线正中右移 2px、终点 = 小节线正中左移 2px
- **根因**：线宽常量分散（slur 1.3、volta 1.4、beam 1.5、barline 细 1.5/粗 3），barlineTotalW 占位与 renderBarline 偏移需同步；小节线高度与跳房子起止偏移为旧值
- **解决**：① slur/volta/beam/barline 细线统一 1.1、barline 粗线 1.8；barlineTotalW 重算（| 1.1、|| 4.9、||/ 4.2、|: 10.5、:|: 19.2、||: 11.8），renderBarline 各类型偏移按新宽度重排（保持 2px 间距、点 r1.8）；② yTopBar/yBottomBar 改 -18.4/+4.5（高 22.9），rowEndBarX 同步 -18.4；③ renderVoltaLine 起止 ±1 → ±2
- **预防**：线宽/间距改动必须同时改「占位宽（barlineTotalW）+ 绘制偏移（renderBarline）+ 冒烟断言」，三处一致；小节线高度变更同步影响跨行连音符行末延伸定位（rowEndBarX）与按行过滤断言（yTop-18.4）

### E-2026-079 预览缩放工具条 + 浅色模式主按钮黑底黑字修复
- **场景**：预览区缩放 / 浅深色主题下的主操作按钮
- **现象与需求**：① 预览窗格上方需 +/- 按钮缩放预览比率；② 浅色模式下「试听」工具栏按钮与试听对话框「播放」按钮为黑色（黑字黑底看不清）
- **根因**：① 预览 SVG 固定 PREVIEW_W=760 显示，无缩放入口；② `.tool-btn.primary`/`.btn.primary` 用 `background: var(--jp-deep-space-blue)`（深蓝）+ `color: var(--jp-text-primary)`——浅色模式下 text-primary 变深色 → 深底深字
- **解决**：① uiStore 新增 `previewZoom`（50%~200% 持久化），PreviewPane 顶部加 sticky 缩放条（− / 百分比 / +），页面包装用 `zoom` 属性缩放（影响布局不重叠），拖拽 scale 含 zoom 换算（`PREVIEW_W/页宽 × zoom/100`）；② 主按钮改 `background: var(--jp-accent)` + `color: #101010`，深浅色均可读（深色霓虹青/浅色青底 + 深字）
- **预防**：主按钮底色用强调色而非固定品牌深色，避免浅色模式下文字随 text-primary 变深；预览缩放用 `zoom` 而非 `transform: scale`（后者不改变布局尺寸会重叠）；任何拖拽换算需同步乘/除缩放因子

### E-2026-080 预览缩放并入顶部工具条 + 移除工具栏撤销/重做按钮
- **场景**：顶部工具栏布局调整
- **现象与需求**：① 预览缩放 −/+ 应放入预览窗格上方的顶部工具条，去掉预览区内的浮动工具条；② 撤销/重做按钮可从工具栏移除（编辑菜单与编辑器右键菜单已有）
- **根因**：上一轮把缩放条做成预览区内的 sticky 浮动条（与编辑器 A−/A+ 同位置语义），未并入全局 Toolbar；工具栏仍保留撤销/重做两个冗余按钮
- **解决**：① Toolbar 在视图切换后插入 `toolbar-zoom` 组（− / 百分比 / +，仅 拆分/预览 视图显示，编码视图隐藏），删除 PreviewPane 内 `.preview-zoombar` 浮动条及其 CSS；② 移除 Toolbar 的 ↶撤销/↷重做 按钮及相关 store 引用（撤销/重做仍可在 编辑(E) 菜单、Ctrl+Z/Y、编辑器右键菜单使用）
- **预防**：工具按钮归属遵循「全局操作进顶部工具条、区域操作进区域头部」，避免同一功能两处入口；删除按钮时同步清理未使用的 store 选择器（tsc/oxlint 会拦截）

### E-2026-081 增时线末端空隙过大：拍间距按音符起点拍计，单音符跨拍段不累计
- **场景**：adj74 增时线垂直居中后，用户反馈 `| 6 - - - |`（单音符 4 拍）最后一根增时线离后面的小节线过大
- **现象**：`6 - - -` 段终点 497.28 vs 小节线 514.7，间隙 17.42px；而 `1 2 3 4`（4 个独立音符）末音符到小节线仅 ~5.4px，两种写法不一致
- **根因**：拍间距 `NOTE_GAP`（4px）按「音符起点拍」`gapOf = Math.floor(notePos)` 加偏移，`6 - - -` 四个拍段同属一个音符、gapOf 全为 0 → 音符内部没有拍间距；而小节线公式按「总拍数 × NOTE_GAP」偏移，末尾凭空多出 3×4=12px 空隙。另：段 x 计算误用 `rs.gapOf`（音符首段）而非当前段 `s.gapOf`，即使 gapOf 已改段级也不生效；多声部块把整音符合成单段（beats=dur），增时线走 render fallback 同样无拍间距，且数字锚定整段中点而非第 1 拍段
- **解决**（adj75，`src/engine/layout/index.ts`）：① bars 行 gapOf 由 `Math.floor(notePos)` 改为段所在拍 `p`（平均连音组内仍统一组首拍，保持均分），段 x 用当前段 `s.gapOf`；② frag 行同改为 `s.p * NOTE_GAP`；③ 多声部块音符按拍拆段（每段 beats=piece、x 随拍递增 `pos*perBeat + floor(pos)*NOTE_GAP`），数字锚定第 1 拍段与单声部一致；④ smoke [27] 断言补拍间距 +4 再推第 2 拍段起点
- **预防**：涉及「每拍一段」的几何改动，先跑 `| 6 - - - |` 与 `| 1 2 3 4 |` 对比段终点到小节线间隙是否一致；多声部块与 bars 行共享同一套「按拍拆段 + 拍间距」语义，勿再退化成单段

### E-2026-082 休止符括号丢失 + 附点段行尾留白（两端不对齐）
- **场景**：用户反馈 ① `0/&zkh` 左括号不出现；② 两行曲部，第一行没两端对齐（末段右 494 vs 第二行 504.7，右边界 515.28）
- **现象**：① 休止符/节奏符（`0/&zkh`、`&zkh 0/`、`0-&ykh`）括号不渲染；② 含附点跨密集拍的行（如 `2. (1// 2//)`）末段右距右边界 21px 留白，另一行仅 10.6px
- **根因**：① `RestToken`/`RhythmToken` 无 `symbols` 字段，tokenizer `collectSuffix` 收集的 `&zkh` 在创建 rest/rhythm token 时被丢弃；render 括号区块条件 `t.kind === 'note'` 也排除休止符。② 附点段 perBeat 用「音符起始拍」（adj36），附点跨到密集拍（`1//`/`2//` 十六分 perBeat=41.5）时，附点 0.5 拍段仍用基础拍（11.04）→ 段宽与拍宽不一致 → 行内容总宽 < 可用宽 → 行尾留白
- **解决**（adj84/85）：① types 加 `symbols`，tokenizer rest/rhythm 保留并支持前置 `&zkh`，render 括号条件放宽为 `t.symbols.length > 0`；② bars/frag 两处附点段 perBeat 改为所在拍 `perBeats[p]`，拍宽 = perBeat×dur 自洽（smoke [43] 旧断言「附点段 = 0.5×前音符宽」同步更新为新语义）
- **预防**：新增符号能力（括号等）时检查所有 token 种类（note/rest/rhythm）而非只实现音符；附点/跨拍段的 perBeat 必须与所在拍一致，否则行尾留白——断言用「末段右贴右边界」兜底

### E-2026-083 反复记号播放：第二遍 atMs 与第一遍重叠（音频重叠/高亮错乱）
- **场景**：adj282 实现预览播放进度跟随色块时发现——`|: 1 2 :| 3 4 |` 试听，第二遍 1 2 与第一遍 1 2 **同时响**（音频重叠），高亮在第二遍全灭
- **现象**：`buildPlaySequence` 反复展开后同一音符 push 两次，但 `atMs` 只由布局时钟 `groupStartMs + barStart + beatPos` 决定，与遍数无关 → 展开事件 atMs 重复；`schedulePlay` 按 atMs 用 AudioContext 调度 → 同 atMs 两遍事件同时触发；`computeActive`（`atMs <= cur < atMs+durationMs`）在第二遍时 cur 已超所有 atMs → 高亮丢失；`doneTimer` 用布局总时长 → 反复谱播放中途被截断
- **根因**：布局时钟不感知反复遍数；反复只影响事件遍历顺序，未推进时间轴
- **解决**（adj282，`src/engine/playback/sequence.ts`）：新增「播放遍时钟」——`passMs`（当前遍偏移）+ `passEndMs`（本遍已播块末，= passMs + 块时长，块时长与音符时值/连音合并无关）；事件 `atMs = passMs + 布局时钟`（同块各声部共享 → 多声部同步保持）；仅在**回跳**（`:|`/`:|:` 第一遍结束、`&dc` 从头反复）时 `passMs = passEndMs` 推进新遍；单向前跳（`&ds`/`&ty`/跳房子第二遍跳过）不推进（跳过段不占时间，语义与原布局时钟一致）；`totalMs = passEndMs`（含反复的展开总时长）。smoke [15]/[17] 新增：反复/跳房子展开 atMs 单调不重叠 + 总时长 = 展开遍数、多声部同拍 atMs 相等 + 各声部内单调
- **预防**：播放序列的任何时间计算必须以「播放顺序」为基准（反复展开后的实际播放），布局时钟只能用于块内相对位置；多声部同步断言必须同时覆盖「同拍相等」与「遍间不重叠」两个维度

### E-2026-084 单声部试听调试两问题：开始播放滚到底 + 第二曲行中途色块/高亮消失
- **场景**：adj285 单声部试听调试（色块改红/高亮恢复红色后实测）
- **现象**：① 点击「播放」瞬间预览窗格直接滚到谱面最后；② 播放到第二曲行（第二个 Q 行）约一半时，色块与音符高亮同时消失
- **根因**：① `schedulePlay` 的 `onNote` 回调在同步循环内对**每个事件**调用 `setActiveNoteId`，React 批处理后只保留最后一次 → activeNoteId = 最后一个事件的音符 → PreviewPane 的 activeNoteId 联动滚动直接滚到底；② adj282 引入的 `passEndMs` 公式漏加 `groupStartMs`（写成 `passMs + blockDurOfGroup`），多块（多曲行）谱时只累计到第一块结束 → `totalMs` 偏小 → `doneTimer`（totalMs+300）在第二行中途触发 → stop() 清空色块/高亮/轨道
- **解决**（adj285）：① 移除 onNote 的同步 setActiveNoteId，高亮与滚动跟随统一由 `computeActive`（interval 50ms 按当前时间计算）负责——设置当前活动音符 id（首个），音符 id 不变不触发滚动，播放开始不再滚到底、播放中色块区域保持在视口内；② `passEndMs = max(passEndMs, passMs + groupStartMs[g] + blockDurOfGroup[g])`；smoke [15] 新增多曲行断言（第二行 atMs=2000、totalMs=4000、8 事件）
- **预防**：① 播放序列的 totalMs 必须覆盖全部块（多曲行/多页），断言用「第二行 atMs + 总时长」兜底；② 异步音频调度（同步循环批量 schedule）内不要用回调同步设置「单值」状态（批处理后语义失真）——播放跟随/高亮一律由定时器按当前播放时钟现算

### E-2026-085 力度修饰符斜体加粗 + 渐强渐弱 hairpin（起点/终点定位 + "+" 提升）
- **场景**：新增力度修饰符（`&pp` `&p` `&mp` `&mf` `&f` `&ff` `&fff` `&sf` `&fp` `&sfp` `&rit`，音符上方**斜体加粗**）与渐强渐弱（`<`/`>` 起、`!` 终，`<+`/`>++` 逐级抬升；形状为**开口尖括号 hairpin**，高度与对音符间距对齐连音线）
- **现象**：① 力度编码此前走渲染 fallback 呈普通上方小文本（非斜体、不加粗）；② 渐强渐弱此前渲染为**闭合梯形楔形**，且起点/终点取值用 `prevBeatAcc`（恒为小节末音符拍）→ `<` 起点错位到小节最后一个音符；`<+`/`>++` 抬升级数虽被 tokenizer 收进 code 但布局/渲染未用；记号 y 用固定 `yTop-26`（离音符过远，异于连音线间距）
- **根因**：① `renderNote` 的 `symbols` 循环对未知 `&` 编码统一 fallback 渲染（无力度/速度斜体分支）；② layout 渐强渐弱定位按「小节内音符累积拍」近似取 `prevBeatAcc`，该变量在音符放置循环里被每个音符覆盖、结束时=小节末音符 → 装饰 token 处理取其拍位即错位；抬升级数未透传到 `PlacedDynamic`/`renderDynamic`
- **解决**（adj）：① `render/index.ts` 增 `DYN_MARKS`（力度/速度编码集），`renderNote` 单独命中时以 `font-style=italic` + `font-weight=bold` 居中于数字槽渲染，其余 fallback 不变；② `renderDynamic` 改为开口尖括号 hairpin（尖点 + 上下两线，张开半高 `DYN_HALF_H×s` 如连音线弧高），并按 `plus×VOLTA_RAISE` 上移；`layout/index.ts` bars 行按小节音符顺序记录 `noteCenters`（每音符数字槽中心），装饰循环用游标 `nk` 对齐 `<`/`>`/`!` 所跟音符（起点/终点=其槽中心），y 改按「行音符数字顶 − (LAYER_GAP+DYN_HALF_H+SLUR_W/2)×s」计算（贴近音符、间距对齐连音线）；③ `types.ts` `PlacedDynamic` 增 `plus`；`spacing.ts` 增 `DYN_HALF_H`；`completions` 补力度编码提示；`smoke [20]` 新增斜体加粗、hairpin、起止点、plus 断言
- **预防**：装饰 token（渐强渐弱/连音线/滑音等）定位必须取「其所跟音符」的槽中心，不能用全局/小节末音符近似；`+`/`-` 等抬升级数（类似跳房子）应从 code 解析并在 layout→render 全程透传，底层类型（`Placed*`）同步增字段；记号 y 与间距应复用上方元素基准（LAYER_GAP/连音线）而非固定偏移，并随音符字号缩放；`.jps` 语法改动同步 `JPS-SPEC.md`/`SYNTAX.md` 且以 smoke 断言回归

### E-2026-086 Ctrl+S 保存静默失败无反馈（“有时按 Ctrl+S 不保存”）
- **场景**：编辑区按 Ctrl+S 保存，用户反馈“有时不会保存”（已打开/另存过的文件、无弹窗、未保存红点仍亮）
- **现象**：保存失败时无任何提示，用户误以为已保存；`dirty` 保持 true、红点仍亮、内容未写入文件
- **根因**：`docStore.saveFile` 有 fileHandle 时 `createWritable()` 若抛错（句柄权限失效 NotAllowedError / 文件被占用等），catch 后转 `saveFileAs`；若 `saveFileAs` 也失败（`showSaveFilePicker` 不可用或抛错被吞）则返回 `false`，全过程静默无反馈
- **解决**（adj）：① 新增轻量浮动提示 `ui/Toast.tsx`（右下角、按 kind 着色，ok 1.8s / warn·error 4s 自动隐藏）；② `uiStore` 增 `notice`/`showNotice`/`clearNotice`；③ `docStore.saveFile`/`saveFileAs` 成功 → `showNotice(saveOk)`；`saveFileAs` 失败（picker 不可用 → `saveUnsupported`；真实异常 → `saveAsFailed`）；用户取消另存为（AbortError）静默不提示；④ 文案集中 `brand/copy.ts`；样式 `index.css` 复用主题变量
- **预防**：任何异步写（保存/导出等）失败必须有可见反馈，不能静默；写失败后应引导用户走「另存为」重新授权；区分「用户主动取消」（静默）与「真实失败」（提示）避免误报

### E-2026-087 小节线「附加内容顺序敏感」：修饰符/引号注释/跳房子任意顺序解析
- **场景**：用户反馈 `|"p:2/4"&hs` 可解析，但 `|&hs"p:2/4"` 不行（花S修饰符 + 临时节拍丢失）
- **现象**：小节线后的引号备注（临时节拍/备注）只在「最开头」处理一次；当 `&` 修饰符在引号前（`|&hs"p:2/4"`）时引号被跳过 → 临时节拍不解析；音符块注释（`1"注释"&tr`）同样因注释后 `break` 而丢失后续修饰符
- **根因**：① tokenizer 小节线处理：引号备注在循环外只处理一次，未与 `[`/`]`/`&` 一同按任意顺序循环（adj295 只覆盖跳房子+修饰符，漏了引号）；② `collectSuffix` 音符注释用 `break` 结束收集，注释后仍合法的 `&` 等修饰符不再收集
- **解决**（adj）：① 小节线：删除循环外的「引号只处理一次」，把引号备注分支并入 `[`/`]`/`&` 的任意顺序循环（`|"p:2/4"&hs` 与 `|&hs"p:2/4"` 均解析出 marks=[hs] + comment="p:2/4"，渲染花S + 临时节拍分数）；② 音符块：`collectSuffix` 注释后不再 `break`，继续收集后续修饰符（`1"注释"&tr` 与 `1&tr"注释"` 等价）；smoke 新增「小节线任意顺序」「音符注释任意顺序」断言
- **预防**：凡「同一块内多个独立元素（修饰符/注释/跳房子）」应做成**顺序无关**（循环消费 + 各自分支），不能先处理其中一种；语法改动同步 `JPS-SPEC.md` 且以 smoke 断言回归

### E-2026-088 试听色块残留：上一行色块冻结驻留在行末/旧行
- **场景**：用户反馈试听时「色块已走到新行，上一行色块还残留在行末」
- **现象**：播放到反复/跳房子段落时，旧行的跟随色块停在原位置不动（冻结），没有随下一段音乐出现/消失；多行谱上表现为旧行行末处残留一个色块
- **根因**：`preview/PreviewPane.tsx` 的 `playheadPosOf` 隐藏条件只写了「**本曲行最后一段**结束时才隐藏」（`i === segs.length - 1 && currentMs >= a.atMs + a.durationMs`）。反复/跳房子（`|:`/`:|`/`[ ]`/`&dc`/`&ds` 等）在展开后会留下**段间空隙**——当前拍段已结束、下一拍段还未开始（`currentMs` 落在空隙里），此时 `i` 并非最后一段 → 旧行色块按 `a.x` 停在「已结束的上一段」位置冻结，直到下一段开始才跳走；视觉即旧行驻留/行末残留
- **解决**（adj313，`src/preview/PreviewPane.tsx`）：隐藏条件由「仅最后一段结束」放宽为「**当前段已结束即隐藏**」（`currentMs >= a.atMs + a.durationMs` 即返回 null）——色块只在该拍段「正在发声」期间显示，旧行按各自发声时间出现/消失，不再冻结残留；段间空隙（该处无声）无色块，与音频一致
- **预防**：跟随/高亮类元素（试听色块、音符高亮）的显隐必须以「当前是否正在发声」为判据，不能在拍段序列末尾才判定；凡播放序列展开（反复/跳房子）会产生的**时间空隙/跳变**，渲染侧必须显式处理，不能依赖「到序列末尾」推断单个元素何时消失

### E-2026-089 发布为 http:// 网站后「文件/打开」无反应（非安全上下文无 File System Access API）
- **场景**：`npm run dev`（localhost）「文件 → 打开」正常；`npm run build` 后把 `dist/` 发布为 `http://` 网站，点「文件/打开」毫无反应
- **现象**：点击「文件/打开」静默失败、无任何提示、无弹窗；同一功能在 `localhost` 下正常。可排除「页面白屏/资源 404」（菜单能点开，说明 JS 已加载）
- **根因**：`docStore.openFile` 依赖 Web File System Access API 的 `window.showOpenFilePicker`；该 API 仅在**安全上下文**（`https://` 或 `localhost`）且 Chromium 内核（Chrome/Edge）下存在。发布到 `http://`（非 localhost）即非安全上下文 → `showOpenFilePicker` 为 `undefined` → `openFile` 走 `typeof picker !== 'function'` 分支**静默 `return false`**，无任何反馈；`showSaveFilePicker`（另存为）同理
- **解决**（adj281）：`openFile` 检测到 `showOpenFilePicker` 不存在时，降级用标准 `<input type="file" accept=".jps">` 读取文本载入谱面（打开本质只读文本，不依赖文件系统 API）。新增模块级 `store/docStore.ts#openFileViaInput()`：读文件文本 → 载入 code/parseResult/pageConfig，降级环境无写回权限故 `fileHandle` 置 null、`useUiStore.showNotice(uiCopy.openFallbackNotice, 'warn')` 提示改用「导出」；加载逻辑复用正常打开的全部 set 字段。文案 `brand/copy.ts` 新增 `openFallbackNotice`
- **预防**：凡依赖浏览器专属/非标准 API（File System Access、clipboard、Fullscreen、蓝牙等）的功能，入口处**必须做能力检测**并给**非安全上下文 / 非 Chromium** 用户一条可用降级路径（如标准 `<input type=file>`、`<canvas.toBlob>` 下载），不能静默失败；发布前用 `http://`（非 localhost）或 `file://` 打开构建产物跑一遍「文件/打开/另存为」验证

### E-2026-090 编辑器长行折行后 textarea 与高亮层文字错位（`#===...=== 描述/主体` 装饰行在临界窗口宽度）
- **场景**：将「码上简谱」模板（含两行 `#============================...===...===` 装饰行）粘贴进编辑器，调整窗口宽度到一定大小时（约 340~350px 视口宽）
- **现象**：两行 `#===...===以下为描述头定义/以下开始简谱主体...===` 中，textarea 实际折行（行高增加为 2 行），但高亮层（显示层）仍按单行排版（`pts=[]`），导致**行错位**——textarea 已折而显示层未折，或反之
- **根因**：① `wrapPoints` useMemo 中用 `charW = fontSize * 0.6 = 8.4` 做**短行跳过**（`if (line.length * charW <= cw) return []`）→ `=` 实际 advance ≈ **8.40625**（sub-pixel），`=` 28 + `#` + 中文 9 字符总宽 319.44px，在临界 taClientW=347（内容 319）时：`charW=8.4` 估算 319.2 ≤ 319 → 判「装得下不折」`pts=[]`；而 textarea 实际整数像素 layout 总宽 319.44 > 319 → **装不下折了** → 一层折一层没折。② 此前还尝试过 `box-sizing` 修复（adj232 思路：textarea 改 `box-sizing:border-box`）但 `charW` 估算误差才是 sub-pixel 临界错位的根因
- **解决**（adj282，`src/editor/EditorPane.tsx` `wrapPoints` useMemo）：**去掉「短行跳过」优化**——所有行都用 Range API `getBoundingClientRect` 测真实字符 X 坐标（精确反映 textarea layout），不再依赖 `charW` 估算 → 临界窗口宽度下 mirror 测出的折行点 == textarea 实际折行点。同时利用 `adj225` 思路直接读 `taRef.current.clientWidth`（实时，与 textarea reflow 同帧），不回 state（避免一帧滞后）
- **预防**：① **任何折行测量都不要用字符宽估算**做短行跳过/条件判断（`fontSize*0.6` 等都是近似，sub-pixel 边界必翻车），全部用 Range API 测真实几何；② 测量镜像（mirror/clone）的 `box-sizing` / `padding` / `font-size` / `line-height` / `font-variant-ligatures` / `tab-size` / `word-break` / `overflow-wrap` / `white-space` 必须与 textarea **逐项一致**（adj232 补 border:none、adj234 overflow-wrap:normal、adj247 tab-size:4、adj282 box-sizing:border-box 一致）；③ `wrapPoints` deps 用 `taClientW` 仅触发重算，**测量时直接读 `taRef.current.clientWidth`**避免 state 滞后

## 五、预防清单（Checklist，提交/交付前自检）

- [ ] 所有 npm 命令带 `--cache "D:/Coding/JPCoder/.npm-cache"`
- [ ] 抓取网页带浏览器 UA；解码前确认真实编码
- [ ] 新增/修改代码后：`npm run build`（tsc strict）+ `npm run lint`（oxlint）+ `npm run smoke` 全绿
- [ ] import 全部在文件顶部；无未使用变量（strict 会自动拦）
- [ ] 解析器行为对照 docs/JPS-SPEC.md 与原站格式化输出
- [ ] 测试断言数值先手工推算
- [ ] 新工具链先确认沙箱兼容（无 spawn / 无外部依赖）
- [ ] 覆盖既有文件先 read；并发命令注意写冲突
- [ ] 几何数值（连音线/小节线/点线间距）以实测像素为准（WPF/GDI/像素扫描），不靠估算
- [ ] 源码/文档的批量文本修改一律用 edit/write 工具，不用 shell 正则/反引号拼接
- [ ] 写 UTF-8 文档前先确认原文件编码；追加内容与文件编码保持一致
- [ ] 符号类型矩阵（小节线/连音线/修饰符）先列全再实现，避免只实现单一形态
- [ ] 冒烟断言涉及坐标/宽度先输出实际值核对，再写期望（数值比较，不用字符串匹配）

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
| v0.1 | 2026-08-16 | 追加 E-2026-024（M5 引号损坏 TS1002） |
| v0.1 | 2026-08-16 | 追加 E-2026-025（M6 未使用变量） |
| v0.1 | 2026-08-16 | 追加 E-2026-026/027（M7a 断言误算；M7b 番号合并/M7d 变量重名） |
| v0.1 | 2026-08-16 | 追加 E-2026-028（M9 小节线备注前空格） |
| v0.1 | 2026-08-16 | 追加 E-2026-029/030（T1 缺 MSVC 链接器→GNU 方案；rust 环境变量不跨进程） |
| v0.1 | 2026-08-16 | 追加 E-2026-031（T1 沙箱隔离证书存储→schannel TLS 失败） |
| v0.1 | 2026-08-16 | 追加 E-2026-032（T1 沙箱下 WebView2 初始化失败→完整权限 GUI 正常） |
| v0.1 | 2026-08-16 | 追加 E-2026-033（adj1 排版重构：splitBars 尾部空段/行首线省略/超长行断行） |
| v0.1 | 2026-08-16 | 追加 E-2026-034（adj2 小节线/增时线/歌词对齐/快捷键误触四修复） |
| v0.1 | 2026-08-16 | 追加 E-2026-035（adj3 音符密度重叠→密度感知每拍最小宽） |
| v0.1 | 2026-08-16 | 追加 E-2026-036（adj4 宽度语义：段宽 vs 数字左缘） |
| v0.1 | 2026-08-16 | 追加 E-2026-037（adj5 超拍小节/密度溢出→挤在左侧） |
| v0.1 | 2026-08-16 | 追加 E-2026-038（adj6 增时线浮点未舍入） |
| v0.1 | 2026-08-16 | 追加 E-2026-039（adj12 metaPos 语义：绝对→相对描述区） |
| v0.1 | 2026-08-16 | 追加 E-2026-040（adj16 metaPos 语义：相对左上角 → 相对各自锚点 top-center/bottom-right/bottom-left） |
| v0.1 | 2026-08-16 | 追加 E-2026-041（adj23 语法规范：变音后置 #/\$/=、虚音符 (1)、倚音 [65]/[h65]、块间单空格校验；[ 按前 token 区分跳房子/倚音） |
| v0.1 | 2026-08-16 | 追加 E-2026-042（adj24 行宽兜底：断行按行内统一 perBeat=maxPbm 估算，保证行在页面区域内；小节实际拍数>拍号不再溢出；歌词中心精确对齐槽中心） |
| v0.1 | 2026-08-16 | 追加 E-2026-043（adj25 小节线居中：单声部线在小节右边界+gap/2 居中；多声部修正误画小节中央；formatter 补空格防双空格；编辑区小节线高亮） |
| v0.1 | 2026-08-16 | 追加 E-2026-044（adj26 跳房子语法：|[ 起点 + 修饰(引号注释/+抬高//不封闭) + |] 结束(|]/ 开口)；] 后连续 [ 为 voltaOnly 不画竖线；行首须 |/ [；行首裸 [ 警告） |
| v0.1 | 2026-08-16 | 追加 E-2026-045（adj30 描述头下端虚线：新增 descAreaH 内容区高参数，metaAreaH=上边距+内容区+曲上间距；描述头下端线拖拽改 descAreaH，与曲部上端线区分，间距下限 4px） |
| v0.1 | 2026-08-16 | 追加 E-2026-046（adj31 描述头元素锚定 descAreaH 区域：作者/调式/拍号跟随描述头区域左下/右下角，不再含 body_margin_top 间距空间，且钳制不出区域） |
| v0.1 | 2026-08-16 | 追加 E-2026-047（adj33 无歌词行行高：歌词部空间（曲下间距 quci+歌词行高）为 0，两曲部间距=曲上间距 ciqu） |
| v0.1 | 2026-08-17 | 追加 E-2026-048（adj35 音符间距原则：拍级每拍宽独立，正常拍平均、密集拍挤占其它拍，最小间距 1px=12.16；断行改逐拍 need 累加；音符拆拍段 segments） |
| v0.1 | 2026-08-17 | 追加 E-2026-049（adj36 附点占位 0.5×前音符（附点段用基础拍每拍宽不被超拍放大）；连音线端点=音符中心±1px、高度在高八度点上方；小节线=内容右端+6px 不重叠音符） |
| v0.1 | 2026-08-17 | 追加 E-2026-050（adj37 独立增时线 - 归入前面最近音符：可跳过连音线括号等中间符号，不跨小节线） |
| v0.1 | 2026-08-17 | 追加 E-2026-051（adj38 小节线最小占位 9.5px：线宽 1.5+两侧各 4px；小节线空间 = max(bar_gap, 9.5)） |
| v0.1 | 2026-08-17 | 追加 E-2026-052（adj39 附点定位改拍级附点段：跨拍/超拍音符附点不再错位，圆点恒在其占位宽度正中） |
| v0.1 | 2026-08-17 | 追加 E-2026-053（adj40 歌词对齐：@ 占位留空后移；中文标点不占音符位、渲染紧跟前面的字） |
| v0.1 | 2026-08-18 | 追加 E-2026-048（adj35 歌词规则：@ 占一个字空间、中文标点不占音符位且紧跟前面文字渲染；buildLyricMaps 重建对象时保留 trailing） |
| v0.1 | 2026-08-18 | 追加 E-2026-049（adj37 连音线：下沿距音符上沿 4px、有高音点距最高点 4px；减时线间距 4→3、线粗 2→1.5、低音点避让同步） |
| v0.1 | 2026-08-18 | 追加 E-2026-050（adj38 拍间距：拍与拍之间 8px（NOTE_GAP，按行内拍序 floor(拍)×8 偏移），行宽预算与断行含间距，小节线右移同步；冒烟 16 处断言按新布局重算） |
| v0.1 | 2026-08-18 | 追加 E-2026-051（adj39 小节线：高度=字体+16=34px（基线-17..+17）；两侧间距 4→8px（MIN_BARLINE_SPACE 9.5→17.5），断言批量重算） |
| v0.1 | 2026-08-18 | 追加 E-2026-052（adj40 歌词标点独立渲染：标点并入歌词文本会使其视觉中心右移失中，改为字对中音符、标点独立紧跟渲染） |
| v0.1 | 2026-08-18 | 追加 E-2026-053（adj41 重调：拍间距 8→4px、小节线两侧 8→4px；确认音符/附点/增时线占位居中与音符最小间距 1px 不重叠） |
| v0.1 | 2026-08-18 | 追加 E-2026-054/055（T1 链接 cdylib 导出序数过大→crate-type 去 cdylib；tauri-env.ps1 旧路径失效→命令内联三件套） |
| v0.1 | 2026-08-18 | 追加 E-2026-056（撤销时间窗合并：isAdjacentEdit 不适用于替换） |
| v0.1 | 2026-08-18 | 追加 E-2026-057/058（拍号分数与 J 多行文本几何；歌词 CJK 每字一音节） |
| v0.1 | 2026-08-18 | 追加 E-2026-059（小节线分型几何：||/||:/|://|: :| :|: |/ |* + 钳制/leadPad/高度） |
| v0.1 | 2026-08-18 | 追加 E-2026-060（连音线 FIFO 配对、跨行半段、自动样式 ≤4 弧/>4 平顶、实测数字高基准） |
| v0.1 | 2026-08-18 | 追加 E-2026-061（分数拍 segBarW 过算 + 拍内偏移漏算→溢出行 517>515 修复） |
| v0.1 | 2026-08-18 | 追加 E-2026-062（第 2 页起无描述区：bodyTopH 按页序） |
| v0.1 | 2026-08-18 | 追加 E-2026-063（字体/字号可配置：标题/副标题/歌词/音符，布局按 note_size 缩放） |
| v0.1 | 2026-08-18 | 追加 E-2026-064（三连音/多连音线：(1 2 3) 各自时值、(y1 2 3) 平均时值 + 弧线数字标签不透明背景） |
| v0.1 | 2026-08-18 | 追加 E-2026-065（调试方法沉淀：像素扫描测几何、截图需 danger 权限、源码改动用 edit/write 不用 shell 正则）+ 修复本文件混合编码（前半 UTF-8、后半 GB18030）统一为 UTF-8 |
| v0.1 | 2026-08-18 | 追加 E-2026-066/067/068（调式/节拍 = 号实测字形宽对齐；页号渲染进 SVG 以随导出；下边距虚线拖拽方向 invert 修正） |
| v0.1 | 2026-08-18 | 追加 E-2026-069/070（普通连音线 (…) 误标数字→tupletCount 仅限 (y 组；平均连音数字下移 2px 居中） |
| v0.1 | 2026-08-18 | 追加 E-2026-071/072（跨拍平均组数字按整段居中 + 组内统一拍间距基准；连音线避让中间音符高音点） |
| v0.1 | 2026-08-18 | 追加 E-2026-073（页面设置分组重排 + 描述头字体独立配置 + 排版辅助改工具栏纵横线图标） |
| v0.1 | 2026-08-18 | 追加 E-2026-074（拆分视图可拖拽分隔条调窗格高度 + 编辑器字号 A−/A+ 按钮 + 排版辅助纯图标） |
| v0.1 | 2026-08-18 | 追加 E-2026-075（跨行跳房子起点线移到下一行行首，番号不溢出、不反向跨行） |
| v0.1 | 2026-08-18 | 追加 E-2026-076（浅深色模式：跟随系统 prefers-color-scheme + 各主题浅色变体） |
| v0.1 | 2026-08-18 | 追加 E-2026-077（连音线/高音点/减时线/低音点四组间距 4px→2px） |
| v0.1 | 2026-08-18 | 追加 E-2026-078（线宽统一 1.1/1.8 + 小节线增高 ±4px + 跳房子起止 ±2px） |
| v0.1 | 2026-08-18 | 追加 E-2026-079（预览缩放 −/+ 工具条 + 浅色模式主按钮黑字修复） |
| v0.1 | 2026-08-18 | 追加 E-2026-080（预览缩放并入顶部工具条 + 移除工具栏撤销/重做按钮） |
| v0.1 | 2026-08-18 | 追加 E-2026-088（试听色块残留：反复/跳房子空隙导致旧行色块冻结在行末，adj313 改为「段结束即隐藏」） |

