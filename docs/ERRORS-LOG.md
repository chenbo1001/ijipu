# iJipu 错误日志与经验教训（Error Log & Lessons）

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
- **解决**：确认服务端真实编码（看乱码形态判断是"UTF-8 当 GBK 解"），改用 `new TextDecoder('utf-8')`（node 内置 ICU）；抓取脚本集中管理编码（开发参考材料快照，不随项目分发）
- **预防**：解码前先确认编码；乱码时先判断"字节真实编码 × 当前解码"组合再重试

### E-2026-008 原站示例谱接口需登录（zhipu-getFile 返回 19 字节）
- **场景**：原站示例谱需登录才能访问，未抓取
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

### E-2026-091 多页（自动分页）时编辑器↔预览音符联动"时灵时不灵"
- **场景**：预览区音符高亮 / 点击跳转（编辑器光标联动）
- **现象**：单页正常；谱面被自动分页成多页时，点击预览第 2 页音符不跳转、编辑器光标不亮（"时灵时不灵"）
- **根因**：`cursorMap` 的`page`只按源码 `[fenye]` 注释行计数（无 `[fenye]` 恒为 0），而 layout 的 `note.id.page` 是**自动分页的物理页**（0,1,2…）。两者不一致 → 多页音符的 id 带 page>0，cursorMap 在 page=0 里找不到（点击不跳）；编辑器返回 page=0 的 id，预览高亮匹配不到 page>0 的音符（不亮）
- **解决**：`cursorMap` 增加 `buildIndexToPage(layout)` 生成「全局音符 index → 物理页」映射（自动分页一致）；`codePosToNoteId` 用该映射定 id.page、`noteIdToCodePos` 改为用全局 index 定位（忽略 page）；映射由 `PreviewPane` 布局后回填 `docStore`，`EditorPane` 光标联动读取
- **预防**：凡涉及 "音符 id ↔ 源码位置" 的映射都必须基于**布局实际产物**（物理页），不要用源码 `[fenye]` 重推 page；两种布局模式（时长/空间）都从同一 layout 生成

### E-2026-092 空间优先复用时长优先的拍级断行，导致本可一行的旋律被过早换行
- **场景**：空间优先布局断行
- **现象**：某曲部本体宽 < 有效宽、本可一行放下，却被断成两行（`rows=2`）
- **根因**：空间优先模式复用了时长优先的 `breakRows`（按每小节拍级`need`自然宽判断，会高估小节宽）→ 过早断行；而空间优先的判据是「本体宽 + 非时值占位 ≤ 有效宽」
- **解决**：新增 `breakRowsSpace`，按空间优先「带时值元素本体宽 + 非时值元素占位」累计判断断行（对应"可分配宽<0 必换行"）；`placeGroup` 在 `noteSpaceLayout==='space'` 时改用
- **预防**：布局模式不同则断行/分配判据不同，不能复用时长优先的拍级 `need`；为空间优先单独实现断行

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

### E-2026-093 多声部空间优先忽略 `align_min_bars`：设置两端对齐最小小节数对多声部无效
- **场景**：用户反馈在「页面设置 → 间距 → 两端对齐最小小节数」调整 `align_min_bars` 对多声部**完全无效**——多声部始终撑满两端对齐、不论设置几；单声部行按预期「小节数 ≥ 阈值撑满、< 阈值自然宽」
- **现象**：默认 `align_min_bars=4`，用户设 6 / 10 期望多声部行小节数不足时不撑满、行尾留白；但实际多声部行（不论小节数多少）始终末线贴右、行内音符均匀分散到边界
- **根因**：`align_min_bars` 在 `types.ts:607` 字段定义 + 单声部 `placeMusicRow`（`layout/index.ts:937` `stretch = barCount >= config.align_min_bars`）读取生效；多声部 `placeVoiceBlock` 的 space 路径 (`adj317c`) **完全没读这个字段**——末线钳制 `targetEndBarX` 总是触发，`avStretch = targetBarSum - baseBarSum` 总为正，`s` 始终撑满
- **解决**（`adj318`，`packages/ijipu-engine/src/engine/layout/index.ts:1696-1704`）：在多声部 space 分支加 `stretchBars = numBars >= config.align_min_bars`，`stretchBars=false` 时 `targetBarSum=0`、`avStretch=0`、`s=0` → `ΣbarBar=baseBarSum`（自然宽）、末线自然值 `< rightLimit - halfW`（行尾留白，与单声部 `<` 阈值自然宽语义对齐）；`stretchBars=true` 时维持现有 adj317c 末线钳制行为。smoke `[67]` 改用 `align_min_bars=2` 验证 `≥` 撑满钳制；smoke `[68]` 用默认 4 验证 `<` 自然宽不撑满
- **预防**：任何「撑满/自然宽」类阈值开关必须**全布局路径同步检查**（单声部行 + 多声部块 + 时值/空间两路径）；新增配置项后跑一段各路径覆盖——「设了不生效」通常因为另一条路径忘读；任何「`numBars / barCount / segCount` 类行级数量阈值」都该 grep `config.*` 全布局函数确认读到了

### E-2026-094 空间优先布局计算规则梳理与归档（adj283~adj318）
- **场景**：用户要求「梳理空间优先布局的计算」便于后阅；同时排查 `align_min_bars` 设置在多声部失效（详见 E-2026-093）
- **现象**：多声部 space 路径经多轮调整（`adj250/283/314/315/316/317a-c/318`），`placeVoiceBlock` 内嵌 ⑥ 的拍宽分配、拉伸均分、首尾节头、末线钳制逻辑与单声部 `placeMusicRowSpace` 差异散落各处，缺乏一份「单声部 vs 多声部」对照备忘
- **根因**：规则随调整累积，没在每一轮后归档；后续若再改某一步，需重新推导全局不变量（`ΣbarRelW`/`lineX0_末`/`beatBodyW` 与 `mspBarRelW`/`mspSegX` 的耦合）；同时 `placeVoiceBlock` 新增 `stretchBars` 后，已具备「自然宽 ↔ 撑满」切换能力，备忘正好把这个分叉记录下来
- **解决**：① 新增 `docs/SPACE-LAYOUT.md`：单声部 / 多声部 space 计算规则对照备忘（常量、口分配、口约束、差异表、已知问题、变更历史 adj283~adj318）；② 排查过程中发现 E-2026-093（多声部漏读 `align_min_bars`）→ 见 `adj318` 修复条目
- **预防**：布局规则每累计 ≥3 个 adj 调整后写一份「单/多声部对照备忘」；新增配置字段后跑全布局路径回归（不仅新代码所在路径），避免「设了不生效」类问题反复出现

### E-2026-095 多声部块不自动断行——超宽由谱师编排平衡（决策变更）
- **场景**：用户梳理 `docs/SPACE-LAYOUT.md` 时提出"超宽小节换行"修复建议（初判为 bug），但用户后续明确**否决**该规则
- **现象**：多声部 `placeVoiceBlock` 无 `breakVoiceBlock`，整块单行渲染。`ΣbaseBarSum > blockAvailW − nonDurPad` 时末音符挤右 margin
- **根因**：① 多声部行是「多声部同步编排」语义（同一拍多声部对齐）；② **换行会让第二声部看上去像「新一组二声部块」，破坏多声部视觉与语义**；③ 超宽属谱师编排平衡范畴（删内容/缩字号/改行/调时值），引擎不强行处理
- **解决**：**不实施断行**——撤销 E-2026-095 初版「建议修复 `breakVoiceBlock`」。`docs/SPACE-LAYOUT.md` 5.3/5.4 标 `[撤销/不实施]`，说明决策原因与用户原话（"这个规则不要，超就超，这是需要谱师需要对谱的编排进行平衡考虑的事"）
- **预防**：**多声部块的断行决策**——视觉语义上是「多声部同步」，不能简单复用单声部「超宽换行」逻辑；任何对多声部「超宽自动换行」的设想都需先与用户确认是否会破坏多声部视觉，否则宁可留给谱师；引擎层面的「不自动断行」应在 SPACE-LAYOUT.md 等布局备忘中明确标记，避免后续维护者再被当作 bug 提出

### E-2026-096 多声部试听色块：(5. 5) 附点消失 + 宽度用本体而非显示占宽（adj319）
- **场景**：用户给 3 声部谱 `Q3: 0 0 0 5/ 6/ | 5// 6// (5. 5) - | 6 - - - | 5 - 3 - | 0 1 5 - |`，播放到 `(5. 5)` 附点时色块消失；其他色块显示宽度用本体宽而非显示占宽
- **现象**：① (5. 5) 附点段 width=0 → 附点色块不显示；② `6 - - -` 等增时线音符色块宽 ≈ `noteBodyW`（本体宽），不覆盖增时线本体（`augBodyW`）；③ 含附点的音符色块右端提前停止，未到附点右
- **根因**（双根因）：
  1. **多声部 `placeNoteAt` space 分支 `noteRightX = first.x + space.noteBodyW`**（line620），**只含本体宽不含附点 + 增时线 + hx 显示占宽**。单声部 `placeMusicRowSpace` 有 `xCursor += augElW; if (n.hasHx) xCursor += hxBodyW; actualW = xCursor − curX; rightX = xCursor`（line1437-1450），多声部遗漏同等累加
  2. **`buildPlayheadSegs`（`sequence.ts:99`）按"下一段 x − 本段 x"算 width**（adj290 注释"色块宽 = 该段到下一段的物理区间，连续覆盖无重叠"），但**多声部 note/dot 段混排在 plc.segments 数组**且 note段无 `el`（与单声部 line1435 `el: 'note'` 不同）。多声部 note段 push 时（line1813）**未设 el**，导致 `segs.some(el !== undefined)` 走"按 el 分段"分支但段类型错乱。dot段 x = `first.x + noteBodyW + dotGap + dotBodyW/2`（圆心）> 下一 note 段 x 时 width = max(0, 负) = 0 → 附点消失；多声部 `plc.rightX` 只含本体宽 → 末段 width = 本体宽
- **解决**（`adj319`，`packages/ijipu-engine/src/engine/layout/index.ts:617-643` + `playback/sequence.ts:97-108`）：
  - **多声部 `space` 增 `augW` + `hxW` 字段**（line603/1835）；调用处传 `augW = t.kind==='note' ? splitNoteDur(t).augCount * augBodyW(m.noteSize) : 0`、`hxW = ... hx ? hxBodyW(m.noteSize) : 0`
  - **多声部 `noteRightX = first.x + noteBodyW + (hasDot?dotBodyW:0) + augW + hxW`**（与单声部 actualW/rightX 对齐）
  - **`buildPlayheadSegs`**：首段 `width = plc.rightX − s.x`（含附点+增时线显示占宽），其余段 `width = 0`（避免重叠；色块由首段覆盖整音符）
  - **smoke [69]**：附点音符 `rightX − x ≥ 本体 + dotBodyW` ✓、增时线音符 `rightX − x ≥ 本体 + augBodyW` ✓
- **预防**：
  ① **多声部 vs 单声部必须**「同一个（显示/几何）属性」**同步实现**（accW/augW/hxW/dotBodyW 等累加）——新增 `space` 字段时同时更新所有调用处 + 默认构造
  ② **playhead / 渲染 / 布局** 三个消费方对 `note.width` vs `note.rightX − note.x` 的语义需明确：前者=本体宽（无附点/增时线/hx），后者=**显示占宽**（含所有修饰符空间）。色块类「覆盖」逻辑统一用 `rightX − x`
  ③ `placeVoiceBlock` 段循环 push segments 时**漏 `el` 字段**——单声部 `placeMusicRowSpace` 已设 `el: 'note'/'dot'/'aug'`，多声部遗漏导致 `buildPlayheadSegs` 按 el 分支错位。两边对称修复后按 el 分段才正确
  ④ 任何 **空间优先路径**（`useSpace`）几何常量都与 `placeMusicRowSpace`（`placeNoteSpace` 闭包）双轨实现，每轨独立维护——容易漂移；建议**后续重构**把 `space` 几何抽到公共 helper（`placeNoteSpace` 多声部版）

### E-2026-097 试听色块分段规则：一个时值元素 = 一个色块（覆盖显示占宽，到下一元素/小节线前）（adj320）
- **场景**：用户反馈此前"按拍段分段"的色块在附点（权点段 x=圆心 > rightX → width=0）消失；用户提出更简单规则：**色块主要针对有时值元素，把「当前时值元素到下一个时值元素前（或小节线前）」作为当前元素的色块宽度**，这样色块之间连续
- **现象**：① 按「拍段」（adj290，每段≤1拍）分段，附点段 width=max(0, 负)=0 消失；② 用户观察"附点都没色块，只是 (5.5) 时值大所以看起来显示"；③ 用户明确：空+音符块+空 为音符色块一块，附点+空 为附点色块一块，连续覆盖
- **根因**：`buildPlayheadSegs`（sequence.ts）按 `placed.segments` 的拍段算 width（`x1−x0`），但①多声部 note段 push 无 `el`（与单声部 line1435 不同，段类型混排）②附点段 x 是圆心（> rightX）→ width=0 ③多声部 rightX 只含本体宽（不含附点/增时线/hx）→ 末段 width 用本体宽
- **解决**（adj320，`sequence.ts:87-99`）：`buildPlayheadSegs` 改为**一个时值元素 = 一个色块**——返回单段 `{ beat: startBeat, beats: plc.duration, x: plc.x, width: plc.rightX − plc.x }`（`width` = 显示占宽，含附点/增时线/hx；`x` = 元素左缘）。相邻元素色块天然连续（各音符显示占宽相接），附点/增时线都在色块内不再消失。同时 `adj319` 修 `placeNoteAt` 多声部 `noteRightX` 累加附点圆右（圆心 + DOT_R）、增时线、hx（此前只含本体宽）
- **预防**：
  ① 色块「覆盖」的**粒度**决策：用户规则 = **一个时值元素一个色块**（不是每个拍段）。任何"按拍段/按段 el 分段"的色块方案都要考虑段 x 是否单调、附点圆心 > rightX 是否导致负宽——**宁可整元素一块**，简单且稳定
  ② `buildPlayheadSegs` 用 `plc.rightX − plc.x`（显示占宽）而非 `note.width`（本体宽）作色块宽；`rightX` 由 layout 提供且必须含附点/增时线/hx（否则色块右偏、附点不覆盖）
  ③ 色块 x 始终 = `plc.x`（元素起点，非段圆心/段左缘）——避免圆心 > rightX 的负宽回归

### E-2026-098 跨项目同步：@ijipu/engine 镜像 + obsidian-ijipu 插件版本号（v0.10.1）
- **场景**：发布 v0.10.1 后 `@ijipu/engine` 和 `obsidian-ijipu` 也需要"按需更新"
- **现象**：
  - `packages/ijipu-engine/package.json` 版本 `0.9.0`（落后主项目 `0.10.1`）
  - `obsidian-ijipu/package.json` + `manifest.json` 版本 `0.2.0`
  - `obsidian-ijipu/vendor/engine/` 内 3 个文件落后主项目引擎（`layout/index.ts` / `layout/spacing.ts` / `playback/sequence.ts`）——`vendor` 是插件"仓库自包含"的引擎源码副本（esbuild `alias '@ijipu/engine' → ./vendor/engine/index.ts`），与主项目 `@ijipu/engine` 容易漂移
- **根因**：跨项目版本号没有联动机制；vendor 镜像需手动复制引擎 src 更新
- **解决**：
  - 同步 vendor/engine 3 文件（adj314→adj318 多声部空间优先几何重写 + adj317 `DOT_AFTER_DIGIT_GAP` 常量 + adj319→adj320 色块按"时值元素"分块）
  - `@ijipu/engine` 版本号 `0.9.0` → `0.10.1`
  - `obsidian-ijipu` 版本号 `0.2.0` → `0.10.1`（package.json + manifest.json 双处）
  - `obsidian-ijipu/docs/RELEASE-NOTES.md` 追加 v0.10.1 条目
  - 插件 ts 类型检查通过（vite build 因沙箱 spawn EPERM 无法跑，但 vendor 同步无类型问题）
- **预防**：
  ① **vendor 镜像漂移**：每次主项目引擎改动（任何 adj），检查 `obsidian-ijipu/vendor/engine/` 与主项目的 diff（`Compare-Object` 或 git diff），按需同步；建议**后续**把 vendor 改为 git submodule / symlink 指向主项目引擎，或在 CI 里加自动同步脚本
  ② **跨项目版本号同步**：任何版本发布（patch/minor/major）必须同时更新**所有相关 package**（主项目 + 引擎 + 插件 + 文档）；建议**后续**用 `scripts/sync-version.mjs` 自动同步三处
  ③ **vendor 仓库自包含** vs **submodule** 的取舍：自包含利于离线/CI（无外部依赖），但漂移风险高；建议**发布前**对比并明确同步责任（README/CONTRIBUTING 写明）

### E-2026-099 连音线连接点规则：`(X)` 单音符终止前一连音 + 起新连音（adj321）
- **场景**：用户反馈跨行连音线配对错误。给两行 `Q: 2/ 1/ (7,/ 6,// 5,//) (6,- |` 与 `Q: (6,)--- | 6)- 0 (3/ 6// 7//) |`，期望上一行 6, 连到下一行第一个 6,（`(6,)`），下一行第一个 6, 再起新连音到第二个 6,；但实际从上一行 6, 直接连到下一行第二个 6,（跳过 `(6,)`）
- **现象**：`(6,)` 处本应是「两个连音线的连接点（上个连音结束、下个连音开始）」，但 LIFO 栈式配对把行1 `(6,` 配到行2 第二个 6,（idx5→idx7），跳过连接点 idx6
- **根因**：LIFO 栈式（adj55）把 `(X)`（单音符被 `(`开 + `)`关紧贴）当作「退化对」（起点=终点，按 adj137 不渲染自身）。`(6,)` 的 `)` pop 掉行2 `(6,`（退化对），行1 `(6,` 留到 idx7 才配对 → 跳过连接点
- **解决**（adj321，`layout/index.ts:2026-2034`）：连音线至少连接 2 个音符。当 pop 出的开括号为退化（`start===lastNote`，即 `(`开 + 一个音符 + `)`关紧贴），且栈内还有更早未闭合 open 时，该音符 X 是**连接点**——终止前一个未闭合连音（`prev`）于 X（`prev.start→X`），并以 X 为起点重新开启新连音（把退化 open 改造为 `start=X`、`depth=prev.depth` 断开嵌套、独立顶层）
- **语义验证**（用户澄清 + 四例 smoke 断言）：
  - `(1 (2) 3)` → 1→2 + 2→3（两条，连接点 2 终止外层于 2）
  - `(1(2 3))` → 1→3外层 + 2→3内层（真嵌套，内层 2 音符不触发连接点）
  - `(1 (2 3) 4)` → 1→4外层 + 2→3内层（真嵌套）
  - 用户谱：上一行 6, → 连接点 idx6（`(6,)`）+ 连接点 idx6 → 下一行第二个 6,（idx6→idx7）
- **受影响更新**：smoke `[51]` / `[53]` / adj140 平顶断言从"`(4)` 退化不渲染"更新为"`(4)` 连接点"（3 条：外层被 4 终止 + 4→跨行两半）；新增 `[71]` 连接点规则四例 / `[72]` 用户谱跨行连接点
- **解决补充（adj321b）**：深嵌套连接点——连接点检测**不受 `depth<2`（adj91 渲染层数限制）约束**。用户大段谱 `...(6,- | 1 2 (6,)- | 6,)- ...` 的 `(6,)` 嵌套在 depth≥2 括号内，被外层 `s.depth < 2` 阻断连接点（当成普通退化对）→ 前一连音延到第二个 6,（跳连接点）。已把连接点分支移出 `depth<2`：连接点总是触发（depth 取被终止连音层级，保持可渲染）。
- **预防**：
  ① **连音线语义核心**：`(X)`（单音符）不是"空嵌套/退化"，只要前面有未闭合连音就是**连接点**（终止前一连音 + 起新连音）；真嵌套 = 内层 ≥ 2 音符（`(2 3)`）
  ② **改连音线配对/嵌套语义前**，先连同 smoke 相关断言（[51]/[53]/adj140 等）一起考虑——它们可能锁定了旧语义
  ③ **跨行 + 连接点 + 深嵌套**是连音线最易错场景，用用户谱例 + 四例断言回归
  ④ **连接点是用户明确的连音语义**，不应被"渲染层数上限"（depth<2，adj91，防过密）之类布局限制阻断——语义元素与渲染上限分开判断

### E-2026-100 音符上方单字修饰符：吐音/打音/叠音（adj334，adj335 叠音横向缩 3/4，adj336 加吐音 &ku，adj338 上方修饰层专属间距）
- **需求**：为音符增加三种新的 `&` 修饰符，符号显示在音符正上方——吐音 `&tu` → 粗体 **T**、打音 `&da` → 粗体 **扌**、叠音 `&die` → 粗体 **又**；输入条 `&` 修饰符候选与帮助文档同步。
- **解决**（adj334）：
  - **解析**：tokenizer `&` 编码收集（`tokenizer.ts:107-118`）对任意字母序列入 `symbols`，`&tu/&da/&die` 天然被收集为音符修饰符，无需改解析。
  - **渲染**：`render/index.ts` 新增 `ABOVE_GLYPH = { tu:'T', ku:'K', da:'扌', die:'又' }`，在 `&` 符号上方分支（`DYN_MARKS` 之前）新增 `ABOVE_GLYPH[sym]` 分支——用 `FONT_CN`（微软雅黑/黑体）`font-weight="bold"` + `text-anchor="middle"` 在数字槽中心渲染粗体单字，居中于音符正上方；`die`（叠音）额外 `scale(0.75,1)` 横向缩 3/4（adj335），`tu/ku/da` 走无缩放分支。**adj338 上方修饰层专属层间留白更小**——共享 `LAYER_GAP=2` 同时用于减时线/低八度点/连音线（冒然缩小会破坏 `adj219` 减时线分组/平顶线高/连音线几何断言）；故新增 `SYM_LAYER_GAP=1` 仅替换**音符上方符号循环**的层间留白（`symY = aboveTop - SYM_LAYER_GAP*s - ...`），让多修饰符堆叠更紧凑而不影响其它层，smoke 维持在 10 项预存基线。
  - **布局**：`layout/index.ts` `maxSymInRange`/`slurYFor` 用 `symbols.length`（排除 hx）计上方层数与连音线基准，新符号自动计入、无需改。
  - **输入条**：`completions.ts` `MODIFIER_SYMBOLS` 新增 `tu/da/die`（label 注明字形），`NOTE_MODIFIER_HINTS`（自动补全）与 `padLayout.ts` `DECOR_KEYS`（输入条「装饰」组）**两处同源派生**自动更新。
  - **文档**：JPS-SPEC.md、SYNTAX.md、public/doc/jps-spec.html 增补三个修饰符说明。
  - **smoke**：新增 `[74]` 三例渲染断言（粗体 T/扌/又 居中）+ `adj334` 音符修饰符池含 tu/da/die 断言；tsc -b + npm run build 通过（npm run smoke 其他 10 项为既有预存失败）。
- **预防**：新增音符上方修饰符时，沿用 `ABOVE_GLYPH` 单字字形映射 + 居中渲染；`MODIFIER_SYMBOLS` 一处添加即可同时更新自动补全与输入条。　

### E-2026-101 帮助文档显示异常：操作手册/脚本语法行内 MD 外显 + 脚本规则说明表格错乱（adj353）
- **场景**：① 应用内「帮助 → 操作手册/脚本语法」对话框（`DocDialog`，`docs/USER-GUIDE.md` + `docs/SYNTAX.md`）；② 「帮助 → 脚本规则说明」新开页 `public/doc/jps-spec.html`（浏览器打开）
- **现象**：① 行内反引号 `` ` ``、粗体 `**`、斜体 `*` 等 Markdown 标记原样显示（如 `` `编码` ``、`**菜单栏**`）；② 缩进的子列表项（`  - ...`）渲染成带 `-` 前缀的普通段落，落入"MD 源码外显"；③ `jps-spec.html` 第 5 节「小节线与反复」表格错乱——列被拆乱、单元格里透出 `` `\`` 字面**反斜杠+反引号**（如 `` `\</td>``），符号列几乎不可读。用户据此误判为"使用错误的 `\` 转义符"。
- **根因**：
  - `DocDialog` 的 `mdToHtml` 只处理块级结构（标题/列表/代码块/表格），**不处理行内语法**；列表判定用 `/^[-*] /` 要求行首即是 `-`，导致带缩进的子项不识别。文档全量渲染后 Markdown 标记未转换即散落到 HTML 文本，形成"还是 MD 源文件显示"。
  - `jps-spec.html` 由 `docs/JPS-SPEC.md`（源为正确 Markdown，用 `\|` 转义表格内的管道）转换而来，但转换器**把表格单元格内联代码里的 `\|` 转义当普通字符输出**，既没还原成 `|` 也没转成 `<code>|</code>`，反而把反引号/反斜杠当独立 `<td>` 边界切开，整张表列错乱。
- **解决**（adj353）：`DocDialog` 增加行内解析 `inlineMd`（`code`→`<code>`、`**bold**`→`<strong>`、`*italic*`→`<em>`、`[text](url)`→`<a>`，普通文本仍 `esc` 转义防 XSS）；列表改为按缩进深度用栈管理（含 `<ul>/<ol>` 与父项 `<li>` 保持未闭合以容纳子列表），子项正确嵌套；标题/段落走 `inlineMd`。`index.css` 补 `.doc-content` 的 `code/strong/em/a/ol` 样式。空白行/标题/表格等非列表行会先 `closeAllLists` 收口。`jps-spec.html` 的「小节线与反复」表**手工重写为合法 HTML**（`\|` 还原为管道，符号包 `<code>`，两列对齐；顺带把「快速上手示例」里裸 ```jps 包成 `<code>`）。
- **预防**：
  ① 演示型 `?raw` 文档若含行内 Markdown（`` ` ``、`**`、链接、子列表），渲染器须覆盖行内语法与缩进列表；判定列表要允许行首空白（`/^\s*[-*]\s+/`）。
  ② `docs/JPS-SPEC.md` 与 `public/doc/jps-spec.html` 为**手工同步**（VERSIONING 约定），任一改动都要同步另一端并人工核对表格/代码块渲染，不能只看源文件。
  ③ 改渲染器/文档后，用一次性对照脚本（`scripts/_tmp_*.mjs`，用后即删）或直接检查生成 HTML 里是否残留 `` `\``、`` `` ` `` `` 等转义痕迹。

### E-2026-102 `@@` 恢复默认音色未按"第一音色"链路 + 单声部空间优先忽略 `align_min_bars`（adj354）
- **场景**：① 用户在脚本里用 `@@` 想切回默认音色，但无描述头 `Y:` 时默认落回钢琴，未用「试听音色列表」第一个启用音色；② 用户在「页面设置 → 音符空间布局」选"空间优先"后，`align_min_bars`（两端对齐最小小节数）对单声部无效——行小节数小于阈值仍撑满两端对齐
- **现象**：① `@@` 恢复默认音色——有 `Y:` 时正确；无 `Y:` 时 `sequence.ts` 里 `defaultInstrument = parseInstrumentRef(yInstruments?.[0] ?? '').ref` = `''`（空串），即便用户在「音色库管理」启用了收藏音色（如只留八音盒、关掉大钢琴），`@@` 也落回钢琴（`instrumentToProgram('')→0`），未用首个启用音色；② 单声部 `placeMusicRowSpace`（`layout/index.ts`）忽略 `align_min_bars`——`W = availW − durBodySum − nonDurPad` 恒为"全部剩余宽"，行小节数 < 阈值时仍把音符撑满到右边缘（行尾不自然留白），与多声部 `placeVoiceBlock` 已有 `stretchBars` 行为（adj318）不一致
- **根因**：
  - `@@` → `voiceDefaultOf(voice)` → 全局 `defaultInstrument`：无 `Y:` 时解析出空串，引擎层无法感知 UI 的"试听音色列表首个启用音色"（`uiStore.playbackHqEnabled`，React 状态），二者是纯 TS 引擎与 UI 的边界，缺一个从 UI 注入默认乐器的入口（`buildPlaySequence` 无此参数）
  - 单声部空间优先 `placeMusicRowSpace` 只实现"始终撑满"一条路径，没读 `config.align_min_bars`；这是 E-2026-093（多声部"设了不生效"）的单声部版——当时只修了多声部，单声部空间路径漏了
- **解决**（adj354）：
  - **`@@` 第一音色链路**：`buildPlaySequence` 增加可选 `defaultInstrumentRef?: string`；`sequence.ts` 的 `defaultInstrument` 改为「先取第一个 `Y:`（`yRef`），无 `Y:` 时用调用方传入的 `defaultInstrumentRef`（UI 传入 `playbackHqEnabled` 第一个启用音色的 GM 名），仍空则回退 `''`（播放端路由→第一音色库第一音色钢琴）」。`PlaybackDialog`/`ExportDialog` 传入 `firstEnabledInstrumentRef = GM_VOICE_OPTIONS[Math.min(...playbackHqEnabled)].label.replace(/^\d+\s+/,'')`（无启用则 undefined）。保证 `@@` 一定有可用音色：有 `Y:`→首个 `Y:`；无 `Y:`→首个启用收藏音色；收藏为空→第一音色库第一音色
  - **单声部空间优先自然宽**：`placeMusicRowSpace` 加 `barCount = row.end − row.start − leadingEmpty`、`stretch = barCount >= config.align_min_bars`；`W = stretch ? 剩余宽 : 0`（不撑满、行尾留白、末小节线 `atEnd` 仅在 stretch 时贴右钳制）。与多声部 `avStretch=0` 一致
  - **顺带修**：多附点音符 `dotBodyW` 未乘 `t.dots`（双附点只按一个附点占宽，自然宽路径下色块偏窄）——`placeMusicRowSpace` 与 `placeVoiceBlock` 的 `dotBodyW` 均改为 `dotBodyW(m.noteSize) * t.dots`。smoke 新增 `[68b]`（单声部空间优先自然宽 + align_min_bars=2 撑满）、`[68c]`（@@ 第一音色链路三种情形）
  - **@@ 显示标注音色名（adj303 显示乐器名开启时）**：`layoutScore` 的 `@@` 标注原用 `INSTRUMENT_LIB_NAMES[resolveInstrument(...)]`，只映射固定 6 种合成音色，无 `Y:` 时固定显示"钢琴"。现 `layoutScore` 也接受 `defaultInstrumentRef`，`@@` 标注与播放端一致（有 `Y:`→该声部 `Y:` 乐器名；无 `Y:`→第一启用音色；再空第一音色库第一音色），用 `parseInstrumentRef(...).instrument` 取纯乐器名（GM 音色名不再显示为钢琴）。`PreviewPane`/`PlaybackDialog`/`ExportDialog` 均传入；抽 `firstEnabledInstrumentRef(enabled)` helper（`playback/spessaSynthBackend.ts`）三处共用
  - **自然宽行小节宽对齐上一行（adj355）**：单声部空间优先自然宽行（`stretch=false`）此前各小节恒为自然本体宽，末行窄小节被压缩、与上一行小节线纵向错位。现 `placeMusicRowSpace` 读 `refRelMeasureW`（上一行各小节内容宽，按行内相对下标），本小节自然内容宽 < 上一行对应小节宽时扩到上一行宽度，多余宽按小节内时值摊开（空间布局）；并把本行各小节内容宽回传，供下一行对齐。`measureContentW` 累计时值分隔表（含增时线）宽度。**跨组共享**：`prevRowMeasW` 提到 `layoutScore` 作用域，多行谱（两组 Q 行）后一行自然宽对齐前一行对应小节（用户示例：第 2 行前两小节宽原仅为第 1 行约 1/2，现对齐）。smoke `[68d]`（同组行内对齐）+ `[68e]`（两行谱跨组对齐）
- **预防**：
  ① **"某设置不生效"先 grep 全布局路径确认**：`align_min_bars` 类行级阈值在单/多声部 + 时值/空间四路径都要读到（E-2026-093 已提，本次单声部空间再次印证）
  ② **引擎与 UI 状态边界**：UI 态（收藏音色）不能直接进纯 TS 引擎——需显式 `buildPlaySequence(...)` 参数传入默认值，否则 `@@` 类"回默认"行为只能落到硬编码默认（钢琴）
  ③ **多附点占宽**：`dotBodyW` 按附点数（`t.dots`）相乘；自然宽/撑满两条路径都要一致，否则双附点色块/占宽偏窄

### E-2026-103 跳房子 `[` 修饰不支持 `-` 降低（adj356）
- **场景**：用户要求「连音线 `(` / 跳房子 `[` 后用 `+` 抬升，现已加 `-` 降低，方向相反」。连音线 `(+`/`(-`（adj135/136）早已支持，但跳房子 `[` 只支持 `+`、不支持 `-`
- **现象**：`|[-` 把 `-` 当普通字符/音符前缀处理，无法降低跳房子线；`[` 后只有 `+` 抬升一种方向
- **根因**：`tokenizer.ts` 的 `parseVoltaMods` 只识别 `/`、`+`、`"`，未识别 `-`；`voltaStart`/`PlacedBarline.voltaStart` 类型缺 `minus`；layout/render 的跳房子线 y 只减 `plus×VOLTA_RAISE`，不增 `minus×VOLTA_RAISE`。连音线（adj136）已有 `minus` 通路，跳房子漏了
- **解决**（adj356）：`parseVoltaMods` 增 `minus` 计数（与 `+` 对称）；`voltaStart`（token 类型 + `PlacedBarline`）增 `minus?: number`；`layout/index.ts` 跳房子 floor 高度用 `yTop - VOLTA_BAR_GAP - plus×VOLTA_RAISE + minus×VOLTA_RAISE`（降低=向下）；`render/index.ts` 起止 y 同样 `+ minus×VOLTA_RAISE`。smoke [38] 新增：`[-` 解析 `minus=1` + 渲染 `[-` 更低/`[--` 更低/`[+` 更高（方向与 `+` 相反）。JPS-SPEC/SYNTAX 文档同步
- **预防**：凡「方向性修饰」（+抬升/-降低、上移/下移）应**成对实现并全程透传**（tokenizer → token 类型 → layout → render 类型），漏一边就会只支持一个方向；语法改动同步 JPS-SPEC/SYNTAX 并以 smoke 断言回归

### E-2026-104 临时节拍 `"p:2/4"` 预览显示与占位（adj357）
- **场景**：① 用户反馈临时节拍预览区字体应与音符字体一致、字号一样、高度缩为 2/3、加粗；② 它是有占宽元素，但空间优先路径未预留其宽度，分数压到下一小节音符
- **现象**：临时节拍分数字体用固定 `FONT_CN`（非音符字体）、字号 10×s（非音符字号）、非加粗、分数较高；空间优先（`noteSpaceLayout:'space'`）下小节线右侧 `barGapSide`（=barlinePad=noteSize/4）不含分数宽度 → 分数与下一音符重叠
- **根因**：`renderBarline` 用 `FONT_CN` + `size=10*s` + 非粗体渲染分数（无音符字体透传）；`placeMusicRowSpace` 小节线间距仅用固定 `barGapSide`（不读备注/分数宽），而时值优先路径用 `barlineSpace`（含 `meterCommentHalfW`）→ 空间路径漏算占宽；`render` 与 `layout` 的分数半宽各自维护（`10*s`），改动需同步
- **解决**（adj357）：`renderBarline` 增 `noteFontFamily` 参数（调用处传 `noteFont(config.shuzi_font)`），分数用 `font-size=noteSize`、`font-weight=bold`、`font-family=noteFontFamily`，并用 `scale(1, 2/3)`（围绕小节线中点）把分数高度压到 2/3；`meterCommentHalfW` 改 `size=noteSize`（与 render 一致）；`placeMusicRowSpace` 小节线右侧 `gapR` 补 `2×s + 2×halfW + 2`（分数半宽×2 + 起始 + 末距），空间路径不再压音符；smoke 新增 `adj357 空间优先路径预留临时节拍宽度` + 分数字号/加粗断言
- **预防**：**无时值有占宽元素**（临时节拍/括号/滑音箭头等）的**占宽必须在所有布局路径（单/多声部、时值/空间）同步预留**，且渲染端尺寸与布局端占宽要**共享同一计算**（避免改一边另一边脱节）；方向性/比例性修饰（高度、字号、加粗）注意与音符一致并加粗

### E-2026-105 MIDI/WAV/MP3 导出只用每声部第一个音色（曲内 `@`/`@@` 不生效）（adj358）
- **场景**：用户反馈单声部曲子导出 mp3/wav 时「只使用曲部设置的第一个音色，且遇到 `@@` 也不切回默认（Y:）音色」；要求检查 MIDI 导出、多声部、单/多声部混合是否同样，并按音色设置导出
- **现象**：导出音频（WAV/MP3）与 MIDI 全曲只用每声部**第一个音符**的音色；曲内 `@乐器名` 切换、`@@` 回默认均无效；单声部/多声部/混合一致
- **根因**：`eventsToMidi`（`playback/midi.ts`）按声部收集音符时用 `if (!notesByVoice.has(v)) programByVoice.set(v, instrumentToProgram(e.instrument))` —— **每声部只取第一个可发声音乐的乐器**，且每轨只在开头发一次 Program Change（`bytes.push(vlq(0), 0xc0|chan, program)`），曲内乐器变化全部丢失。音频导出（`export/audio.ts`）与 MIDI 导出都走 `eventsToMidi`，故三者同病；而**试听**走 `SpessaSynthBackend`（逐事件 `programChange`，program 变化时才发）→ 试听正常、导出异常
- **解决**（adj358）：`eventsToMidi` 改为**每个音符记录其 program**，音符按 tick 排序后**在乐器变化处插入 Program Change**（首音色、曲内 `@` 切换、`@@` 回默认都覆盖）；同 tick 排序 `Program Change 最先 → Note Off → Note On`（先切音色再发声、同音重复先断后起）。smoke 新增：单声部 `Y 长笛(73)→@大钢琴(0)→@@ 长笛(73)`、多声部 `Q1 0→73 / Q2 48→73`（各自声部独立）
- **预防**：**导出与试听的乐器路由必须同源**——试听逐事件 `programChange`，则导出（`eventsToMidi`）也必须**逐音符/逐变化**发 Program Change，不能"每轨一次"（否则曲内乐器切换静默丢失）；新增「逐事件属性」（乐器/力度/声部）时，检查**所有消费方**（试听后端、MIDI 导出、音频渲染）是否都按事件读取；导出类功能至少断言"曲内切换生效"，不能只断言"首音色正确"

### E-2026-106 小节跳跃（试听）实现不完整：无 |: 不从头反复 / 房子只看第 2 遍 / &dc 死循环 / &ds 找错方向 / &ty 首遍就跳（adj359/adj360）
- **场景**：用户给出 5 组「路标」用例（跳房子、段落反复、大反复、跳越）要求校验并完善试听跳跃顺序
- **现象**：① `<1,2> |["1." <1> :|] <2> ||`（无 `|:`）不从头反复，直接顺播；② 两房子（各自 `:|`）只走 2 遍、第 2 遍把**所有**房子都跳过；③ `&dc` 每次遇到都跳 → 死循环（靠 guard 截断）；④ `&ds` 用 `k > i` **往后**找 `&hs`，而花 S 通常写在前面 → 找不到、不跳；⑤ `&ty` 第一遍就跳（规范要求第一次忽略）
- **根因**（多条）：
  1. `repeatStart` 初值 `-1` → 无 `|:` 时 `:|` 判定 `repeatStart >= 0` 失败，不跳；
  2. 房子按 `pass === 2` 二元跳过（`pass` 只有 1/2）→ 多房子/多遍失效；
  3. `&dc` 无「已跳过」状态，`i = 0` 反复触发；
  4. `&ds` 查找方向错（`k > i`）；
  5. `&ty` 无「大反复后才跳」门控；
  6. 跳房子配对把 `voltaStart` 先入栈、`voltaEnd` 后出栈——`:|]["2."`（同一根线同时有 voltaEnd 与 voltaStart）**把自身配成自己的末尾**（`voltaAfter.set(i, i)`）→ 跳过时原地死循环；
  7. 未封闭房子 `|]/` 未做「延续到其后第一个 `:|`/`||`」处理
- **解决**（adj359/adj360，`playback/sequence.ts`）：
  - 预计算：`segnoIdx`（全曲第一个 `&hs`）、`hasBigRepeat`（有 `&dc`/`&ds`）、`repeatCountAt`（每个 `:|` 的遍数 = 本段内到该线的第几个 `:|` + 1）
  - 大反复 `&dc`/`&ds` **只跳一次**（`bigRepeatDone`；跳后 `pass=1`、`passMs=passEndMs`）；`&ds` 跳到 `segnoIdx + 1`；`&ty` 仅 `bigRepeatDone` 后跳下一个 `&ty`；`&fine` 有 dc/ds 时仅 `bigRepeatDone` 后生效
  - 房子：volta 番号（`comment` 里的数字，无番号按 1）≠ 当前 `pass` 则跳过；跳过时**停在房子末尾小节线**（而非其后一位）以便处理该线上下一房子的番号；新增 `landedByVoltaSkip` 标记——因跳过房子落在的小节线不再触发 `:|` 回跳（该反复已越过），只判其 volta 番号后前进
  - **`:|` 处理优先于房子跳过**（`:|]["2."` 共用线：正常演奏到该线先按反复回跳）
  - 配对改为**先出栈（voltaEnd）再入栈（voltaStart）**，消除自配死循环
  - **未封闭房子 `|]/`（`voltaEndSlash`）**：`voltaAfter` 指向其后第一个 `:|`/`:|:`/`||`/`||/`（房子延续），已封闭 `|]` 仍以本线为界
- **预防**：① 跳跃类状态机要**穷举「路标」组合**（无 `|:`/多房子/跨行/D.C.+跳越/未封闭房子）并逐一断言"演奏顺序"，不能只测单条；② **大反复类记号必须有「只跳一次」状态**（否则死循环，靠 guard 兜底只是掩盖）；③ 查找配对记号要明确方向（`&ds→&hs` 通常 hs 在前，需全局预计算而非单向 `k > i`）；④ **同一节点同时「收尾 + 开启」**（`:|]["2."`）时，入栈/出栈顺序与「回跳 vs 跳过」的优先级都要显式设计——曾因先入栈导致自配死循环；⑤ 相邻既有断言若与规范冲突（如 `&ty` 首遍跳），按规范**修订断言**并在 CHANGELOG 说明

### E-2026-107 跳跃演奏有十几~几十秒延迟（跳跃后未按当前播放时刻对齐）（adj361）
- **场景**：用户反馈"演奏时遇到跳跃时，会延迟十几到几十秒才开始从要跳跃到的小节处开始演奏，应该是无缝的演奏"
- **现象**：反复回跳（`:|`）、大反复（`&dc`/`&ds`）、跳越（`&ty`）、跳房子跳过之后，都会先空等一段（长度随"该行在谱中的位置/整行时长"增大，十几~几十秒），才从目标小节开始出声；且谱越靠后的行、跳跃后的空档越长
- **根因**（两个方向的跳跃都错）：
  1. **回跳**：`passMs = passEndMs`，而 `passEndMs = max(…, passMs + groupStartMs[g] + blockDurOfGroup[g])` —— 推进量是「**该组在谱中的布局起点 + 整组时长**」，而不是「本遍已播时长」。于是第 2 行的反复会把时间整体后推 `行1时长 + 行2时长`，行越靠后空档越大；
  2. **前跳**（`&ds`/`&ty`/跳房子跳过）：**完全不动** `passMs`，但 `atMs = passMs + 布局时钟`，而布局时钟已跳过被跳过段落 → **被跳过的段落被当成空档**；
  3. 另有 `atMs` 只由 `passMs + 布局时钟` 决定，缺少"以当前播放时刻为基准"的对齐，任何跳跃都会产生与布局时钟绑定的误差
- **解决**（adj361，`playback/sequence.ts`）：改为**按当前播放时刻对齐**——
  - 维护 `lastEndMs` = 已生成事件的最大结束时刻（= 当前播放时刻；连音合并后同步前移）；
  - 任意跳跃（`:|` 回跳、`&dc`、`&ds`、`&ty`、`trySkipVolta`）统一记 `pendingJumpMs = lastEndMs`；
  - 生成下一个事件时，若 `pendingJumpMs >= 0` 则 `passMs = pendingJumpMs - clock`（`clock` = 该事件的布局时钟），使该事件 `atMs` 正好落在待跳时刻 → **所有跳跃无缝**；
  - `totalMs = lastEndMs`（实际播放到的时刻；原按布局时钟估算会与实际事件不符）；删除已无用的 `blockDurOfGroup`
- **预防**：① **时间轴的"当前时刻"必须显式维护**（`lastEndMs`），跳跃后按它对齐，不能靠"布局时钟 + 遍偏移"隐式推算——布局时钟含段落位置信息，任何"位置跳变"都会变成时间空档；② **回跳与前跳必须用同一套时间对齐机制**（不能只处理回跳，前跳同样会漏）；③ `totalMs` 之类"总时长"要基于**实际生成的事件**推算，不能基于布局估算（否则与真实事件不符，还会被 doneTimer 提前截断）；④ 断言要测"**第二遍首音 atMs == 第一遍末音结束 atMs**"这类**无缝性**，而不只是"atMs 单调不重叠"（后者在有巨大空档时也成立）

### E-2026-108 大反复（D.S./D.C.）后遍次被重置为 1 → 走了已奏过的房子并错误回跳（adj362）
- **场景**：用户给出三房子 + 花S + D.S. 的谱（`:|` 段内房子1；房子2 末尾 `||&ds`；房子3 末尾 `||`），反馈：第 1、2 遍正确，`&ds` 跳到 `&hs` 后应为**第 3 遍**——却（1）**走了房子1**，（2）随后又**从头重演**
- **现象**：`&ds` 跳花S 之后，`pass` 变回 1，于是房子1（番号 `1.`）被判为"本遍该奏"→ 演奏房子1；而房子1 末尾是 `:|`，`count=2`、`pass=1 < 2` → **回跳到 `repeatStart`**（当时还被我重置为 0）→ 从乐曲开头重演
- **根因**：`&ds`（以及 `&dc`）分支里写了 `pass = 1` + `repeatStart = 0`——把大反复当成"重新开始"，但用户语义里大反复是**遍次继续递增**：房子番号 = **第几遍**，故 D.S. 后应进入下一遍（2→3），从而跳过房子1/2、进入房子3；`repeatStart` 也应保持（大反复后仍在同一反复段内）
- **解决**（adj362，`playback/sequence.ts`）：`&ds` 分支改为 `pass++`（不重置为 1）、删除 `repeatStart = 0`（保持不变）。于是 `&ds` 后 `pass: 2→3` → 房子1（1≠3）/房子2（2≠3）被跳过、房子3（3==3）演奏；因 `pass(3) ≥ count(2)`，即便再遇 `:|` 也不回跳。smoke 新增：简化三房子用例 + **用户真实谱 56 音符全序列回归**（第1遍 段A+B+C+房子1；第2遍 B+C+房子2；第3遍 C+房子3）
- **预防**：① **"遍次/遍数"是跨大反复延续的状态**——大反复不是"回到第 1 遍"，而是"进入下一遍"；凡是按遍次选择的分支（volta 番号、`:|` 回跳判定）都要保证 `pass` 不被大反复重置；② 重置类操作（`pass=1`、`repeatStart=0`）在跳跃分支里要**逐条论证**：`&dc`（真·从头）与 `&ds`（跳到段中间）语义不同，不能共用一套重置；③ 用**用户真实谱**做全序列回归（56 音符）比只测缩短版更能暴露"多遍 + 多房子 + 花S + D.S."的组合问题

### E-2026-109 「保存」有时毫无反应、文件没变（必须「另存为」才有效）（adj363）
- **场景**：已打开/另存过的文件，编辑后按 Ctrl+S 或「文件 → 保存」——**有时**什么都没发生（无对话框、无提示），磁盘文件未更新、未保存红点仍在；改用「文件 → 另存为」就正常
- **现象**：保存请求被**完全静默地**吞掉，用户无从判断是没保存还是保存了
- **根因**（静默链条，三层叠加）：
  1. `saveFile` 有句柄时的写入 `createWritable()` 若抛 `NotAllowedError`（句柄来自 IndexedDB 恢复，重启后写权限失效——权限需重新申请），旧代码 `catch {}` 静默转 `saveFileAs()`；
  2. `saveFileAs` 调 `showSaveFilePicker()` **必须在用户手势内**（[Chrome 策略](https://gpedit.tplant.com.au/en-us/policy/Google.Policies.Chrome/FileOrDirectoryPickerWithoutGestureAllowedForOrigins/)），而前一步的 `await` 已消耗手势 → 选择器抛 `NotAllowedError`，**对话框根本不弹**；
  3. `saveFileAs` 的 catch 把 `NotAllowedError` 与 `AbortError` 一起当"用户取消"静默忽略 → 按保存彻底无反应
  另有两个同源隐患：① 写入没有回读校验，`close()` 成功即报"已保存"，而写入流被中断/目标被换走时磁盘其实没变；② 连按两次 Ctrl+S 会同时对同一句柄 `createWritable()`（后一次可能 `InvalidStateError`），且句柄持久化是异步 fire-and-forget——「新建」后立即退出应用可能留下旧句柄，下次启动草稿与句柄不是同一文件，按保存会把新谱写进旧文件
- **解决**（adj363）：
  - 新增纯逻辑模块 `src/store/saveSupport.ts`（无 DOM/store 依赖，可在 smoke 用假句柄断言）：`classifySaveError`（cancel/permission/gone/busy/verify/unknown）、`isUserCancel`（**只有 `AbortError` 算取消**）、`ensureWritePermission`（写入前 `queryPermission` → 必要时**在用户手势内** `requestPermission`）、`writeTextToHandle`（写入 → `close()` → **回读比对**，中途失败 `abort()` 丢弃临时文件避免原文件被截断）、`fileBaseName`
  - `docStore.saveFile` 拆为 `doSaveFile()`：有句柄则**先申请权限再写 + 回读校验**；失败按类型提示（`gone`/`busy`/`verify` 各有可操作文案，集中 `brand/copy.ts`）；`permission`/`gone` 时**断开失效句柄**并立即转「另存为」（下次按保存直接弹对话框 = 全新手势）；并发保存用 `saveInFlight` 合并；写入期间内容又变则保留未保存标记
  - `saveFileAs`：`NotAllowedError` 不再当取消，提示「未获得用户操作授权，请再点一次」；同样回读校验
  - 启动恢复句柄时**核对草稿名与句柄名一致**才恢复（防止旧句柄配新草稿）
  - smoke 新增 `[77]`（27 项：分类矩阵、取消语义、权限申请顺序/拒绝/无 API/查询抛错、写入成功与磁盘内容、createWritable 失败归类、写入中途失败 abort、回读不一致 → verify、无法回读不误报）
- **预防**：① **用户取消只认 `AbortError`**——`NotAllowedError` 是权限/手势问题，绝不能当取消静默；② 依赖**用户手势**的 API（选择器/全屏/剪贴板写）**不可在 `await` 之后调用**，需要恢复权限时应在手势内先 `requestPermission`；③ 任何"写入成功"的结论都应有**回读校验**支撑，`close()` 成功不等于磁盘已更新；④ 句柄/令牌类**异步持久化**的对象恢复时必须与当前文档**同源核对**（草稿名 vs 句柄名），否则会写错文件；⑤ 失败必须有可见且**可操作**的提示，并把失败分类（取消/权限/丢失/占用/校验）逐一映射到文案

### E-2026-110 「保存」变慢：把权限检查与回读校验放进了每次保存的必经路径（adj364）
- **场景**：E-2026-109 修复（adj363：写入前主动查/申请权限 + 写入后回读校验）之后，用户续报「Ctrl+S 响应很慢，菜单保存响应也很慢」
- **现象**：保存本身能成功，但每次按保存到「已保存」提示之间有明显延迟（菜单保存同样慢，说明不是快捷键链路问题）
- **根因**：adj363 的可靠性措施被放在了**热路径**上——每次保存都要 `queryPermission()`（权限为 `prompt` 时还要 `requestPermission()`，该调用可能等待用户对权限提示作答）+ 写入后 `getFile().text()` 回读比对。相比旧版「createWritable → write → close」，每次多出 2~3 次文件系统往返（其中权限申请还可能是**等待人工操作**），于是保存明显变慢。此外每次保存都 `void saveFileHandle(handle)` 重复写了一次 IndexedDB 句柄（句柄本就在打开/另存为时已持久化）
- **解决**（adj364）：
  - `saveSupport.saveTextToHandle()`：**先直接写**（一次往返，等同旧版速度）；**仅当因权限失败**（`NotAllowedError`/`SecurityError`）才 `queryPermission → requestPermission` 并重试一次（此时通常仍在用户手势窗口内，既不静默失败也不为常态保存付代价）；非权限失败原样抛出（不申请权限）
  - `writeTextToHandle(handle, text, { verify })`：回读校验改为**默认关闭**（可按需开启，仅供诊断），校验与比对逻辑（`sameContent`）保留
  - `docStore.doSaveFile`：去掉热路径里重复的 `saveFileHandle(handle)`；另存为同样走 `saveTextToHandle`
  - smoke 新增 adj364 断言：默认不读回（无 `getFile`）、`verify:true` 才读回、热路径调用序列恰为 `create,write,close`（无 query/request/getFile）、权限失效时序列为 `createFail,query,request,create,write,close`、非权限失败不申请权限
- **预防**：① **可靠性措施与热路径解耦**——「权限确认、回读校验、重复持久化」这类**防御性**动作应放在**失败分支或诊断开关**里，不能塞进每次操作的必经路径（否则用户为极少数异常场景长期付性能代价）；② 评估新增 await 的**往返次数**，凡是"每次操作都多调 1~2 次系统 API"的改动要按效果判断是否值得；③ 可能**等待人工交互**的 API（权限提示、选择器）绝不能出现在热路径上；④ 性能类反馈要看**调用序列**（smoke 断言调用序列，而不只看最终结果），把"热路径上到底调了什么"固化为断言

### E-2026-111 「保存反应慢」缺乏反馈：按键到提示之间是空白期，且耗时不可见（adj365）
- **场景**：用户续报「Ctrl+S 响应很慢」（浏览器网页版；**没有权限提示**，只是延迟一会儿才出现「已保存」）
- **现象**：保存确实会成功，但按下快捷键/点菜单后到提示出现之间没有任何反馈；若写盘本身耗时（大文件、云端同步目录、杀软扫描、FSA 临时文件交换重试等），用户只能感知为"卡住了"，且无从判断慢在哪里
- **根因**（反馈层，与 E-2026-110 的真实耗时是两件事）：保存是"静默进行 + 结束才提示"，没有任何进行中的状态；耗时也没有任何可观测出口（既不显示也不记录），因此"慢"只能靠感觉描述，无法定位
- **解决**（adj365，`store/docStore.ts` + `brand/copy.ts`）：
  - `armSavingHint()`：保存开始后 **150ms 仍未完成**才提示「保存中…」（快保存不会闪烁）；保存结束即撤销计时器，由成功/失败提示接管；
  - `reportSaved(t0)`：整次保存 **≥400ms** 时提示带上实际耗时（「已保存 · 1.3s」）并 `console.info('[iJipu] 保存耗时 …ms')`，慢时用户/开发者可直接读出数字；<400ms 提示保持「已保存」不变；
  - 「另存为」从**选定文件之后**开始计时/提示（选文件期间显示"保存中"会误导）
- **预防**：① 任何**可能超过 100ms 的写操作**都要有"进行中"状态（延迟阈值触发，避免快速操作闪烁）+ 结束状态，让"慢"与"卡死"可区分；② 关键路径要有**可观测的耗时出口**（提示中带数字 / 控制台日志），否则性能反馈永远只能靠感觉，无法定位到具体环节；③ 计时区间的起点要选在**用户动作之后、真正耗时操作之前**（选文件/选目录的等待不属于保存耗时）

### E-2026-112 试听「音色」默认不是「自动」而是大钢琴，且选「自动」存不住（adj366）
- **场景**：用户要求「试听播放的音色默认选择『自动』」。打开试听对话框，音色下拉默认停在「大钢琴」而非「自动（按声部名）」；手选「自动」后下次打开又回到大钢琴
- **现象**：默认值错误 + 选择无法持久化（试听被强制成钢琴，谱面 `@乐器` 被忽略），两者其实是同一个 bug 的两种表现
- **根因**：`uiStore` 初始化 `playbackHqVoice` 时用 `Number(localStorage.getItem(KEY))` 解析——**`Number(null)`（键不存在，首次使用）与 `Number('')`（选「自动」时写入的值）都等于 0**，而 0 是合法 GM program（大钢琴），于是：
  - 首次使用：本应「自动」→ 解析成 0（大钢琴）；
  - 选过「自动」：写入 `''` → 回读又是 0 → 自动永远存不住
  （`setPlaybackHqVoice(null)` 写空串、`PlaybackDialog` 的 `<option value="">` 用 `''` 表示自动，格式本身没错，错在读取时没有区分"空"与 0）
- **解决**（adj366）：
  - 新增纯函数模块 `src/store/playbackVoice.ts`：`parseStoredVoice(raw)`——`null` / `''` / 空白 / 非法值（含越界、非整数）一律 → `null`（**自动**），合法 0-127 原样返回（含 `0`）；`formatStoredVoice(program)` 反向格式化（自动 = 空串，兼容既有存储）
  - `uiStore` 的初始化与 `setPlaybackHqVoice` 均改用这两个纯函数；`PlaybackDialog` 默认项文案改为「自动（跟随谱面声部/乐器）」（`brand/copy.ts` 的 `playbackCopy.voiceAuto`），底部说明同步
  - 「自动」的语义与落点：`backend.setVoice(null)` → 按谱面 `@乐器名` / 声部名路由 GM 音色（`instrumentToProgram`：手风琴 21 / 长笛 73 / 库:小提琴 40 / 小号 56 / 无乐器 → 钢琴 0），不再全局覆盖
  - smoke 新增 `[78]`（14 项：解析矩阵 + 存↔读往返 + 自动路由落点）
- **预防**：① **区分"未设置/空"与数值 0**——`Number(null)`/`Number('')` 都是 0，凡是从 localStorage 读"可空数值"必须显式判 `null`/`''` 再转换（**用纯函数集中解析**，别在初始化表达式里就地 `Number()`）；② 枚举值的"空/自动/默认"选项要有**独立表示**（空串/`null`）并保证**存↔读往返一致**（写入自动、回读还得是自动）；③ 默认值类问题要把"首次使用（键不存在）"当作一等用例写进断言

### E-2026-113 一次保存 7.2 秒：缺少阶段耗时，无法判断卡在文件系统哪一步（adj367）
- **场景**：用户按 adj365 的耗时提示实测，「一个保存需要 7.2 秒」（几 KB 的 `.jps` 文件，明显不正常）
- **现象**：总耗时有了（7.2s，非"感觉慢"而是真实秒级），但只有一个总数——`createWritable()`（打开写入流）、`write()`（写入数据）、`close()`（提交/原子替换）三步各自耗时未知，也分不清是文件系统慢还是主线程被占住（收尾阶段）
- **根因**（可观测性缺口）：adj365 只统计了**总耗时**。浏览器 FSA 的一次保存实际由三步构成，三者慢的成因、可优化手段完全不同（打开/创建临时文件 = 目录/云同步；写入数据 = 数据量；提交替换 = 目标文件被占用/杀软扫描/原子替换重试），只有一个总数无法定位，只能猜
- **解决**（adj367）：`saveSupport.writeTextToHandle()` 增加 `trace?: (phase, ms) => void`——按 **open（打开写入流）/ write（写入数据）/ commit（提交文件）** 三段计时并回调（打开失败也报耗时，否则该段会被算进笼统的「收尾」）；权限重试单独计时为 **perm（权限申请）**；`docStore` 再把尾部 **store（写入草稿名）/ ui（更新界面状态）** 两段也计入。慢保存（≥400ms）的提示给出完整明细与「收尾」耗时（= 总耗时 − 各阶段），例如：
  `已保存 · 7.2s（打开写入流 12ms · 写入数据 3ms · 提交文件 7180ms · 写入草稿名 0ms · 更新界面状态 1ms · 收尾 3ms）`
  同时 `console.info('[iJipu] 保存耗时 7200ms（…）')`。正常保存（<400ms）提示不变，仍只显示「已保存」（阶段计时的开销可忽略）。顺带：文件名未变时不再重复写 `localStorage`（同步存储写可能被 StorageService 争用拖住）
- **预防**：① 性能问题定位到"总耗时"只完成一半——**必须把耗时拆到可归因的阶段**（尤其涉及浏览器/系统 I/O 的复合操作：打开、写、提交各有独立成因）；② 阶段明细要**直接呈现给能用的人**（提示里一行带数字），不要只 `console.log` 等对方开 DevTools；③ 诊断信息在正常路径下**零噪音**（只在超阈值时显示），这样它可以长期留在产品里而不是"查完就删"

### E-2026-114 跳房子用「结束句」做标签时末遍整段不演奏（文字标签被当成"无番号 = 第 1 遍"）（adj368）
- **场景**：用户提出「最后一个跳房子允许使用『结束句』做为标签」。谱面写成 `|: A B |["1." C :|]["结束句" D ||]`（或三房子 + 花S + D.S. 的末房子写 `["结束句"`）
- **现象**：**末遍房子（结束句）的内容整段不演奏**——如 `1 |: 2 |["1." 3 :|]["结束句" 4 ||]` 实测只奏出 `1 2 3` + 第 2 遍的 `2`（缺 `4`）；三房子+`&ds` 谱的末房子同样丢音（少了最后一个音），谱面上却明明写着这些音符（渲染正常，只是不发声）
- **根因**：`sequence.ts` 的 `voltaNumOf()` 只从标签里 `/(\d+)/` 取番号，取不到就 `return 1`——即"无番号按第 1 遍"。文字标签（`结束句`）因此被当成**第 1 遍房子**：第 1 遍时它排在 `:|` 之后、走不到（先回跳了），第 2 遍起又因 `1 !== pass` 被跳过 → **任何一遍都不奏**。（番号与"末遍"之间的语义在引擎里缺失：标签只有"第 N 遍"一种含义）
- **解决**（adj368，`playback/sequence.ts`）：
  - `voltaLabelOf()` 把标签分三类：`num`（含数字 → 番号，行为不变）、`text`（有文字无数字 → **末遍房子**）、`none`（无注释 → 旧行为第 1 遍）
  - 新增 `segMaxPass[]`：每段"最终遍数"= 段内最后一个 `:|` 的遍数（段 = 最近 `|:`/`||:` 起、到下一个 `|:` 前；无 `:|` 则 1）
  - `trySkipVolta()`：文字标签按 `pass < segMaxPass[i]` 跳过（末遍奏响；`&ds/&dc` 让 `pass` 更大同样奏响）；**无 `:|` 时 `segMaxPass = 1` → 照常奏响，绝不丢音**；数字/无标签走原逻辑
  - 语法与文档同步：`docs/JPS-SPEC.md`（`[修饰` 行 + 新增 `["结束句"` 行）、`docs/SYNTAX.md`、`docs/USER-GUIDE.md`、`public/doc/jps-spec.html`；输入工具条「跳房子」组新增 `"结束句"` 键
  - smoke 新增 `[79]`（8 项：解析/格式化/渲染 + 两房子、无反复、仅段落反复、三房子+D.S. 的演奏顺序与"数字番号版逐音一致"回归）
- **预防**：① 标签/注释类字段**不要用"取不到就给默认值"的写法吞掉语义差异**——`/(\d+)/ 取不到 → 1` 把"文字标签"错并进"第一遍"，正确做法是**先分类再取值**（num/text/none 三态）；② **新增一个语法写法时，先问"它在演奏语义里对应什么"**：谱面能渲染 ≠ 演奏正确（本次渲染与格式化本就支持文字标签，只有播放错，最容易漏测）；③ 涉及"第 N 遍/末遍"的逻辑要与**段遍数**（`:|` 计数）对齐，并保证**边界谱面不丢音**（无 `:|` 的单遍谱必须照常奏响）；④ 断言要**与等价的既有写法比对**（"结束句版 == 数字番号版 逐音一致"），比只断言一条固定序列更能锁住语义

### E-2026-115 保存 7.1 秒：耗时全在 close() 的「提交文件」（浏览器原子替换被占用）（adj369）
- **场景**：用户按 adj367 的阶段提示回报实测明细：`已保存 · 7.1s（打开写入流 2ms · 写入数据 1ms · 提交文件 7140ms · 写入草稿名 0ms · 更新界面状态 0ms · 收尾 0.6ms）`（浏览器网页版，保存几 KB 的 `.jps`）
- **现象**：数据写入本身瞬时（1ms），**7.14 秒全部花在「提交文件」**——即 `FileSystemWritableFileStream.close()`
- **根因（已定位到机制层，非应用代码）**：浏览器 FSA 的写入模型是「在目标目录创建临时文件 → 写入 → `close()` 时**原子替换**目标文件」。`close()` 的替换在 Windows 上若目标文件被其它进程持有（未以 `FILE_SHARE_DELETE` 打开），会因共享冲突失败并**反复重试**（Chromium 对可重试的 rename 有重试逻辑），直到对方释放才成功——典型持有者：云同步客户端（OneDrive/坚果云等）、杀毒软件实时扫描、其它编辑器/程序打开着该文件、网络盘/异机占用。因此 `createWritable` 与 `write` 都快，只有 `close` 慢；应用侧无 API 可绕开（`keepExistingData` 同样要替换；`createSyncAccessHandle` 仅 OPFS 可用）
- **解决**（adj369，仅做「可观测 + 可操作」，不改写盘机制）：
  - 提示改为**只点出瓶颈**：`已保存 · 7.1s（提交文件 7140ms）`；完整阶段明细与「收尾」仍进 `console.info`
  - 瓶颈是「提交文件」且 ≥2s 时附可操作建议（文案 `uiCopy.saveSlowCommitHint`：文件被云同步/杀软/其它程序占用，可另存到本地文件夹），并用 `warn`（toast 停留 4s，够读完）
  - 阶段收集抽成纯函数 `saveSupport.createSavePhaseLog(label)`（阶段名文案集中 `brand/copy.ts` 的 `savePhaseCopy`），smoke 新增 `[80]`（明细拼接/合计/瓶颈识别/空记录）4 项断言
- **预防**：① 遇到「某操作很慢」，先**分段计时定位到具体系统调用**再谈优化——本次明细一出来就排除了应用代码（打开 2ms、写入 1ms、收尾 0.6ms），避免了在应用层做无效"优化"；② 属于**浏览器/操作系统机制**的耗时（原子替换、fsync、同步盘拦截）不要试图在应用层硬解，应把结论变成**可操作建议**（换目录/加白名单/换保存方式）并保持可见；③ 阶段明细要**长驻产品**（正常时零噪音、异常时自动给出瓶颈 + 建议），这样下一次同类问题用户一次就能报准；④ 提示文案遵循「结论 + 建议」两段式，且只在真正异常阈值（≥2s）才出现，避免噪音

### E-2026-116 「打开一个文件，当前文件名还是之前的文件名」（打开流程全程无反馈，无法判断成败）（adj370）
- **场景**：用户报「打开一个文件，当前文件名还是之前的文件名。另存一个文件时也是这样」——疑似 `fileName` / 文件句柄没有跟着换（若真如此，之后按保存会写进**错误的文件**，属数据安全问题）
- **排查过程（先复现再动手，未凭猜改代码）**：新增临时脚本把真实 store 跑到 Node 里——桩化 `localStorage` / `indexedDB` / `window`，动态导入 `docStore`，按真实时序跑「启动（草稿名 A）→ 打开 B.jps（**IndexedDB 恢复句柄故意延迟 200ms 返回**，制造启动恢复 vs 用户打开的竞态）→ 保存 → 另存为 C.jps」：每一步的 `fileName` / 句柄名 / 写入目标句柄全部正确，慢恢复也没有覆盖已打开文件（adj200 + adj363 的守卫有效）。**结论：store 逻辑本身正确，问题在可观测性**——`openFile` 的 `catch { return false }` 把失败（选择器不可用、`getFile()` 抛错等）**静默吞掉**，用户看到的现象是"点了打开、什么都没变"，与"文件名没更新"无法区分；同理保存成功也没有说明**写到了哪个文件**
- **解决**（adj370）：
  - `openFile`：成功 → 提示「已打开：xxx.jps」+ `console.info('[iJipu] 打开文件：name=… handle=…')`（同时暴露句柄名，二者不一致即能立刻看出）；失败 → 提示「打开失败：<错误名: 信息>」+ `console.warn`（**用户主动取消 AbortError 仍静默**，复用 `isUserCancel`）
  - `reportSaved`：提示带上**实际写入的文件名**（「已保存：B.jps」；控制台同步 `保存耗时 … → B.jps`），出现"写错文件"疑虑时一眼可确认
  - 把上述不变量固化为 smoke `[81]`（12 项，桩化 store 级）：打开/保存/另存为后 `fileName`、句柄名、`DRAFT_NAME_KEY` 三者一致；写入落到正确句柄；慢启动恢复不覆盖；打开失败可见；用户取消静默
- **预防**：① **文件类操作必须有"打开了哪个文件 / 写到了哪个文件"的可见反馈**——`return false` 的静默失败让用户把"没打开"误读成"文件名没更新"（同类教训：E-2026-086 保存静默、E-2026-109 保存静默）；② 用户报"状态没跟着变"时，先把**文件身份不变量**（文件名 ↔ 句柄 ↔ 草稿名）用桩化流程在 Node 里跑起来自证，再决定改什么，避免凭猜改存储逻辑；③ 涉及"当前文档 ↔ 磁盘文件"的绑定要**三者一起更新且可断言**（本轮把这条写进 smoke，后续任何重构立刻能发现回归）
### E-2026-117 状态栏文件名要等写盘完成才更新（慢保存下"改名看起来很慢"）（adj371）
- **场景**：E-2026-116 修复后用户确认「打开、保存、显示都正常了」，但补充：「状态栏显示为新保存的名称也响应较慢」——因为**同一个保存的 `close()`（原子替换）要 7s**，文件名跟着一起等
- **现象**：按下保存/另存为后，状态栏文件名要过几秒才变成新名字；用户看到的是"改名慢"（其实写盘在后台正常进行）
- **根因**：文件名（+ 草稿名）在**写盘完成后**才更新——`fileName` 与 `dirty` 绑在同一次 `set` 里，而 `dirty` 必须等写盘结果，于是把"已知信息"（目标文件名在按下保存/选完文件那一刻就确定了）也一起拖到了最后
- **解决**（adj371，`store/docStore.ts`）：
  - 保存/另存为**立即乐观切名**：`doSaveFile` 在写盘前用句柄名切换 `fileName` 并同步写 `DRAFT_NAME_KEY`；`saveFileAs` 在**选定文件后**（pick 返回即知名字）同样先切名再写盘
  - **未保存标记不乐观**——`dirty` 仍保留到写盘成功才清除；写盘失败则 `rollbackOptimisticName()` 回滚文件名与草稿名并给出失败提示（保证「句柄名 ↔ 草稿名」配对不被改坏）
  - smoke `[81]` 增加 6 项断言：写盘未完成时文件名已切换、标记仍为未保存、完成后清除标记、失败回滚、草稿名不被改坏
- **预防**：① **区分"已知信息"与"待确认结果"**——UI 里凡是**在发起操作时已知**的字段（目标文件名、目标路径）都不该等 I/O 返回；只有**结果性状态**（已保存标记、成功/失败）才绑定 I/O 完成；② 乐观更新必须配**回滚路径**与断言（本轮失败回滚 + 草稿名一致性都有断言）；③ 性能问题的用户感知常常由"反馈时序"决定，先把**已知信息前置**再谈优化底层耗时

### E-2026-118 保存 7 秒的最终定性：Chrome/PWA 环境差异（Edge 正常、Chrome 较慢），非应用问题（adj372）
- **场景**：接 E-2026-115（阶段明细已确认耗时 100% 在 `close()` 的「提交文件」）。用户按建议做环境对比：
  - 文件位置：**下载目录**；
  - **另存到本地文件夹也慢**（排除"某目录被同步/占用"）；
  - **换 Edge 保存：正常、很快**；
  - **Chrome：较慢但未到 7 秒**；
  - **7 秒那次是在 Chrome 里以 PWA（已安装应用窗口）方式操作**
- **结论**：同一份文件、同一台机器、同一套应用代码，**换浏览器即恢复**——说明慢的是**该浏览器/PWA 窗口写文件（落盘 + 原子替换）的实现或其所处环境**（浏览器版本、扩展/安全组件、PWA 窗口的写入路径、系统对该进程的文件操作拦截等），不是应用逻辑；应用侧已无优化空间（FSA 没有"不经临时文件替换"的写入 API）
- **解决**（adj372，应用侧只做"提示与归档"）：
  - 慢保存提示按实测补充可操作方向：`uiCopy.saveSlowCommitHint` 改为「保存慢在文件替换（浏览器/系统行为）：可试试换用其它浏览器或非 PWA 窗口，或把文件移出云同步/杀软监控目录」
  - 本条归档进 ERRORS-LOG，供以后遇到同类"保存秒级"反馈时**先分环境对比、再谈改代码**
- **预防**：① "同一功能在不同浏览器/宿主（标签页 vs PWA vs 桌面壳）表现不同"是**环境问题**的强信号——先做**换环境对比**（换浏览器、非 PWA、换目录），再决定是否需要改代码，避免为环境差异改应用逻辑；② 跨浏览器差异类问题要**记录实测组合**（谁正常、谁慢、差多少），下次同类反馈可直接比对；③ 应用侧能做的是"把耗时拆到阶段 + 给出可操作建议"，**不要试图在应用层硬解浏览器/系统的 I/O 行为**

### E-2026-119 桌面打包失败：Rust 构建缓存残留改名前（jianpuscript）的旧绝对路径（打包 0.12.16 时）
- **场景**：发布 0.12.16 时执行 `npx tauri build`（Rust env 就绪、前端 dist 构建正常）
- **现象**：
  ```
  error: failed to run custom build command for `ijipu v0.1.0`
  Caused by: process didn't exit successfully: ...\build-script-build (exit code: 1)
  failed to read plugin permissions: failed to read file
    '\\?\D:\Coding\JianpuScript\jianpuscript\src-tauri\target\release\build\tauri-1b6a16814c0c1258\out\permissions\app\autogenerated\commands\app_hide.toml':
    系统找不到指定的路径。 (os error 3)
  ```
  注意路径里是**项目改名前的旧目录** `jianpuscript`（现为 `ijipu`）
- **根因**：`src-tauri/target` 下的 Cargo/tauri 构建缓存是**项目还在 `jianpuscript` 目录时生成的**（`.fingerprint/*`、`*.d`、构建脚本 `output` 等文本文件里记着旧绝对路径）。tauri 的构建脚本按缓存里的清单去读插件权限文件 → 命中不存在的旧路径直接失败。`cargo clean -p tauri -p ijipu` **不足以清掉**（它清产物但旧 `.fingerprint`/`.d` 仍被复用、其他依赖的 `.d` 也留着旧路径）
- **解决**：**整目录清缓存后重建** —— `Remove-Item -Recurse -Force src-tauri\target` 再 `npx tauri build`；本次 2m39s 完成，产出 `src-tauri/target/release/bundle/nsis/iJipu_0.12.16_x64-setup.exe`（4.2MB）。源码侧无残留（`jianpuscript` 只出现在有意保留的旧 localStorage 前缀/旧库名/历史文档里）
- **预防**：① **项目目录改名/移动后必须清 Rust 构建缓存**（`target` 里缓存的是**绝对路径**，不只是哈希）——改名当次就该清，否则会在很久之后的某次打包突然炸；② 排错时先用命令定位残留文件而不是猜：
  `Get-ChildItem src-tauri\target -Recurse -File | Where-Object { $_.Length -lt 5MB -and ($_.Extension -in '.json','.d','.toml','.txt' -or $_.Name -eq 'output') } | Select-String -Pattern '<旧目录名>' -List | % Path`；
  ③ 别指望局部 `cargo clean -p` 能清掉跨包的路径缓存——**证伪过一次就直接整目录清**（全量重建对本项目仅约 3 分钟）

### E-2026-120 试听时末音符后的增时线没有高亮/色块（渲染只给数字挂 id + 末元素色块右边界取声明宽度）（adj374）
- **场景**：用户反馈「最后一个音符后面是增时线时，演奏声音会有，但增时线没有色块显示；如 `| 6,) 1-- ||`，色块只显示到 `1`，后面的 `--` 没有色块」
- **排查**（先量化再动手，用临时探针脚本，后转为 smoke `[83]` 断言）：
  - 渲染层：`renderScoreToSvg` 产物里 `data-notepos` **只出现 2 次**（两个数字），增时线是独立 `<text>` 元素、**没有 id** → 高亮的 CSS 选择器 `[data-notepos].note-active` 命不中增时线，`--` 永远不变色
  - 引擎层：色块（`playheadSegs`）在 8 种写法下**多数能覆盖增时线**；只有「末元素无后续音符/小节线」时末段宽度退化为 7px（应为 18px）
- **根因**：① **一个逻辑对象由多个 SVG 元素组成，却只有一个元素带契约属性**——数字有 `data-notepos`、增时线没有，于是"整音高亮/命中"只能覆盖一部分视觉（光标联动、点击命中同样会漏）；② **色块右边界在末元素退回 `rightX = x + width`**，而 `width` 是按每时值元素约 14px 累加的，实际槽距更大（18px）→ **末条增时线越过 `rightX`**，末段色块宽度被算成 0/极小（观感"增时线没有色块"）
- **解决**（adj374）：
  - `render/index.ts`：增时线 `<text>` 也带 `data-notepos`（与数字同一 id；属性置于元素**末尾**，避免破坏既有正则/消费方对属性顺序的假设）；文件头契约注释补充「一个音符可有多个元素共用 id：要整音高亮用 `querySelectorAll`，要代表元素用 `querySelector`（首个=数字）」
  - `preview/PreviewPane.tsx`：两处高亮（批量 `activeNoteIds` / 单个 `activeNoteId`）由 `querySelector` 改为 `querySelectorAll` 全量加类；滚动定位仍取首个（数字）
  - `playback/sequence.ts`：色块右边界改为 `max(下一时值元素/小节线左缘, 本音符实际笔画右缘)`，实际右缘 = 末个 `segments` 的 `x + perBeat*beats`（无 segments 时回退 `rightX`）
  - 既有断言同步：两处「按 `data-notepos` 出现次数数音符」改为**按唯一 id 计数**（`uniqIds()`）——契约变化后"出现次数 ≠ 音符数"
  - smoke `[83]`（10 项）：渲染契约 2 项（`1--` 该 id 出现 3 次、无增时线仍 1 次）+ 8 种写法（行末/无收尾线/跳房子收尾/`&fine`/拆开写/多行末行）的「末段色块盖住末格增时线」不变量
- **预防**：① **视觉高亮/命中类需求先问"这个对象由几个 SVG 元素组成"**：只要不止一个，就必须让它们**共用契约 id**，消费方（高亮、点击、光标联动）统一用 `querySelectorAll`——只给主体挂 id 是"高亮少一块"类问题的通病；② 契约属性变更要**同步既有断言**（计数类断言尤其容易假通过/假失败），并把新契约写进渲染模块头部注释；③ 边界计算**不要在末元素退回"声明宽度"**——声明宽度常按窄槽累加、实际笔画可能更宽，末元素要用「实际笔画右缘」兜底；④ 探针要**覆盖多种写法**再下结论，最小用例通过 ≠ 没问题
- **复报核对（adj374 追加验证）**：用户复报两条对照谱「`| 6,) 1-- ||` 增时线没有色块 / `| 1- 0 0 &ykh ||` 有色块」。用探针量当前 main 的实际几何：A 的两条增时线笔画中心 x=89/107，分别落在色块 82~100、100~124 内；B 的 x=71 落在 64~83 内——**两条都已覆盖**（复报的构建是 0.12.16 桌面包，早于 adj374）。据此把不变量升级为更强的一条并固化进 smoke `[83]`：**每条增时线的实际笔画中心必须落在某个色块内**（用户 A / 用户 B / "末小节不写收尾线"变体共 3 项）。排查经验：用户给的"最小示例"常与真实谱有差异（此处真实谱的末小节很可能没写收尾 `||`，正是 adj374 修的"末元素退回声明宽度"那一档），**先按用户示例 + 相邻变体一起量**再对照结论

### E-2026-121 `&hx` 只能依附音符才显示，写成独立块（`&hx 6 5` / `6 &hx 5`）不显示（adj375）
- **场景**：用户规范「把呼吸符 `&hx` 独立出来，不再依附音符」：现状 `6&hx 5` 能在 6 与 5 之间显示 V，但 `&hx 6 5` / `6 &hx 5` 完全不显示；并要求 `&hx` 占宽（类似 `&zkh`/`&ykh`），但**占前一个音符总时值的 1/4（最多 1/2 拍）作为呼吸换气静音**（总时值含同音连音、增时线、附点）
- **根因**：`&hx` 一直是**音符修饰符**（收进 `note.symbols`，渲染时按 `note.rightX + 7s` 画在音符右侧）——只有紧贴音符才会被收进该音符；独立书写时它落成**独立 decoration token**（无渲染实现）→ 什么都不显示；同时音符修饰符天然**不占宽**（只按 hxBodyW 在音符右缘外留位），无法像括号那样插位
- **解决**（adj375）：
  - **解析**：`tokenizer` 不再把 `hx` 收进音符 symbols（与 zkh/ykh 同规则，含 `-&hx` 分支），改为发出**独立标记 token** `{ kind:'bracket', code:'hx' }`；`BracketToken`/`PlacedBracket` 增加 `code`（zkh/ykh/hx）
  - **格式化**：`&hx` 与 `&zkh/&ykh` 同规则两侧补空格（`6&hx 5` → `6 &hx 5`、`&hx6 5` → `&hx 6 5`，幂等）
  - **排版**：沿用 bracket 通道插位占宽，宽度抽成 `spaceLayout.markBodyW(code, noteSize)`（括号 = BRACKET_PAD、hx = hxBodyW），12 处占宽/插位点统一改用该函数；旧「依附音符」的 `hasHx/hxW` 路径自然失效（保留但不再触发）
  - **渲染**：`renderBracket` 按 `code` 分派——hx 画 V 形（线宽/尺寸与旧版一致；y 按「标记中心 = 数字中心」反推，与旧「依附音符」位置一致），不再依赖 `note.rightX`
  - **演奏**（`playback/sequence.ts`）：预计算每个 `&hx` 作用的音符 index（本组内左侧最近的可发声 token；左侧没有则退化为右侧最近）；事件完成时结算 `呼吸量 = min(总时值/4, 1/2 拍)` 并从该事件发声时值中扣除——**槽位不变**（`totalMs`/后续位置不动），连音合并事件按合并后总时值算基数
  - smoke `[84]`（17 项）+ `adj109`/`adj180` 同步；文档 JPS-SPEC/SYNTAX/USER-GUIDE/jps-spec.html/SPACE-LAYOUT 同步；输入条与自动补全标签更新
  - **追加规范（adj376）**：用户确认 `&hx` 的"占宽"只需与 `&zkh`/`&ykh` **相同的基本占宽**——它占的是**前一个音符的时值**（演奏概念），与排版宽度无关；故 `markBodyW()` 统一返回 `bracketBodyW()`（不再为 V 形预留 `hxBodyW` 的额外宽度），smoke 增加「`&hx` 占宽 == 括号占宽」断言
- **预防**：① **「修饰符」与「独立标记」是两种模型**——修饰符随宿主元素收集、只能贴在宿主旁且不占宽；一旦需求里出现"可独立书写 / 占宽 / 可插入到任意位置"，就必须走**独立 token 通道**（本项目已有 bracket 通道，直接复用最省），不要指望在符号渲染里加分支；② 语法模型的迁移要**同步既有断言**（本轮 `adj109` 把 hx 从 symbols 期望里移除、`adj180` 改用独立写法取样），否则会留下"假通过/假失败"；③ 占宽类改动要**同时**改「预算（扣宽/分摊）」与「放置（x 游标推进）」两侧，只改一侧会出现行宽溢出或音符重叠；④ 播放语义改动优先做**槽位不变**的设计（只改发声时值不改时间轴），这样反复/跳房子/色块/总时长全部无需改动，风险面最小

### E-2026-122 行内只要有独立标记（&zkh/&ykh/&hx）就过早断行（标记占宽被"每音符重复计一次"）（adj377）
- **场景**：用户核对「A4、页面左右边距 40、音符黑体 13 号」下这条 5 小节 Q 行是否**合理**放不下一行（谱面被断成 2 行）
- **排查（先量数据再改代码）**：用探针把三个量分别测出来 ——
  1. **该行自然宽**（把页宽临时改成 10000 且 `align_min_bars=999` 不拉伸）只有 **350.9pt**，而 A4 − 40×2 = **515.3pt 可用** → 一行**放得下**，断成 2 行不合理；
  2. 逐小节自然宽 = [65.2, 63.1, 65.2, 76.2, 66]，合计 335.7 + 小节间 ≈ 351.7 ✓ 与上面一致；
  3. 在 `breakRowsSpace`（空间优先断行）里打点：每小节估算 need = [113.6, 76.5, 113.6, 149.5, 79.4]（Σ=532.6 > 阈值 503.3 → 第 5 小节被挤到下一行）——**估算比真实自然宽大 1.5~1.6 倍**
- **根因**：`breakRowsSpace` 里累加「独立标记占位宽」的循环被写在了**音符循环内部**：
  ```ts
  for (const t of seg.notes) { if (note) durSum += 本体宽
    for (const t of seg.notes) { if (bracket) durSum += markBodyW(...) }  // ← 嵌在里面
  }
  ```
  于是**每个音符都把全部标记宽重复计一次**（N 音符 × 标记宽）。该行第 1 小节有 7 个音符 + 1 个 `&hx`（基本占宽 5）→ 多算 6×5 = 30 ✓（113.6 − 应有 ≈ 83）；整行 3 个 `&hx` 累计多算 ~70 → 越过阈值而断行。（adj294 引入括号 token 时埋下，adj375 我把宽度函数换成 `markBodyW` 时**只做了替换、没注意嵌套层次**，属同源疏漏）
- **解决**（adj377，`layout/index.ts`）：把标记累加循环**移出**音符循环（与音符累加平级），并加注释说明"必须平级，否则每音符重复计一次"；该行恢复为**一行且两端对齐撑满**（内容宽 514.7 ≈ 可用 515.3 ✓）
- **预防**：① **"按 token 计数"的累加必须与"按元素计数"的累加平级** —— 任何"先遍历 A 累加、再遍历同样的 A 累加 B"的写法都要检查括号层次（此类嵌套在 JS 里语法合法、结果只是"偏大"，很难一眼看出）；② 行宽/占位类改动要**用探针把"估算值 vs 实际值"一起打印**（本轮正是两个数一对比才定位到"估算大 1.6 倍"），只量最终行数会误判成"断行策略保守"；③ 替换宽度函数（如 `bracketBodyW` → `markBodyW`）属**行为修改**，要顺带复核该处**上下文（是否在别的循环里）**，不能纯做文本替换；④ 用户给的真实谱例 + 明确参数（纸型/边距/字号）要**固化成断言**（本轮 `[85]` 3 项），把"该放得下却断了"这一类问题钉死

### E-2026-123 试听时**最后一小节最后一个音符**后面的增时线没有色块（`schedulePlay` 总时长只算末事件「起声时刻」）（adj381）
- **场景**：用户复报「增时线没有色块 / 不变红」，并指明要看**最后一小节最后一个音符后面的增时线**，Web 版 `v0.12.17 (2026-09-12 @c400e6d9)`；对照谱 `| 6,--- &ykh ||`（最初报告是 `| 6,) 1-- ||`）
- **排查（关键：拿"部署产物"在真浏览器里量，而不是只看引擎数据）**：
  1. 先证明**线上代码确实含 adj374**：本地 `dist/` 是同一构建（`AboutDialog-*.js` 里的串就是 `v0.12.17 (2026-09-12 @c400e6d9)`），且引擎 chunk 有 `data-notepos="${y}">-</text>`、应用 chunk 有 `querySelectorAll([data-notepos=…]` —— 两半都在，排除"部署是旧版"（这是上一轮的主要怀疑方向，此处被证伪）
  2. 起了**无头 Chrome + CDP** 脚本，直接跑这份 `dist/`（本地静态服务器 + 真 CSS 层叠 + 真 React 路径）：点击增时线 → 数字 + 三条 `-` **全部** `.note-active`、computed fill = `rgb(255,93,108)` → **字形高亮没问题**
  3. 真跑试听并按帧采样色块几何：末尾三条增时线（中心 x = 122.9 / 133.2 / 143.5）**从未被色块覆盖**——色块最右只到 **108.5**，且它**停在倒数第二个音符上**；下一帧起色块消失、按钮回到「▶ 播放」，而对话框同时显示「总时长 9.6 秒」（♩=50 × 8 拍）——**显示时长 9.6s、实播 5.1s**
- **根因**：`playback/index.ts` 的 `schedulePlay` 返回 `totalMs = events[last].atMs + 100 + firstDelayMs`——**只算末事件的"起声时刻"，没算它的 `durationMs`**。`PlaybackDialog` 用 `job.totalMs + 100` 做收尾定时器（清空 `playheadTrack`/`activeNoteIds`/`voiceBlocks`）。于是**末音符时值跨多拍**时（如 `6,---` 共 4 拍 = 4.8s），收尾定时器在该音符**刚起声**就触发：色块轨道被清空 → 它后面的每一条增时线永远没有色块，末音符高亮也只闪一瞬。中间音符不受影响（后续事件的起声时刻把时间轴撑住了），所以这个 bug 只在**末音符时值 > 1 拍**时显形——正对用户两条对照谱
- **解决**（adj381，`playback/index.ts`）：`totalMs = max(atMs + durationMs) + 100 + firstDelayMs`（取**所有事件尾端**的最大值，保留 100ms 余量语义）；`obsidian-ijipu/vendor/engine` 同步；smoke 新增 `[88]`（3 用例 × 3 项 = 9 项：**每个色块时间窗的结束时刻 ≤ totalMs**、totalMs = 事件尾端 + 100 + 准备延迟、末音符至少 2 条增时线各有独立色块）。真浏览器复测：末尾增时线色块覆盖 `#0❌#1❌#2❌` → **`#0✅#1✅#2✅`**（色块最右 108.5 → 161.6），用户最初报告的 `| 6,) 1-- ||` 同样由 ❌ 转 ✅
- **预防**：① **时间轴类「总长」取值一律取事件尾端**（`atMs + durationMs`）而非起点，并把**"每个可视段的结束时刻 ≤ 总时长"固化成断言**——本轮正是这条不变量能一句话钉死此类 bug；② 视觉"少一块/提前消失"类问题，**别把引擎数据或最小用例通过当结论**：本轮 adj374 的引擎数据（末段色块宽度）确实是对的，错的在**调度层返回的总时长**，必须跑真浏览器看**部署产物**的逐帧表现（本文件 E-2026-065 已沉淀"截图需 danger 权限"，本轮补充：无头 Chrome + CDP 在受限沙箱里会因命名管道被拒，需一次性 danger 权限）；③ 抄近路的自检点：**"对话框显示的总时长" vs "实际播放结束时刻"** 不一致就直接怀疑收尾口径；④ 用户给的"最小示例"要**按原样 + 相邻变体一起量**（本轮额外测了"无括号""增时线在开头"的对照，才确认只有"末尾 + 长时值"这一档会坏）

### E-2026-124 谱面级设置 `# jps-config` 往返丢字段（可选字段白名单漏 `showInstrument`）（adj382）
- **场景**：为让 obsidian-ijipu 插件**直接复用 iJipu 的谱面设置**（把 .jps 复制进 Obsidian 即渲染一致）做前置核对 → 发现「显示乐器名」保存后重新打开失效
- **排查**（临时探针：esbuild 打包成 CJS 后 node 跑）：
  - `writeJpsConfig(code, cfg)` 写出的 JSON 有 **30** 个字段（含 `"showInstrument":true`）
  - `extractJpsConfig(written)` 只返回 **29** 个字段
  - `mergeJpsConfig(written, null).showInstrument === undefined` → 设置**读不回来**
- **根因**：白名单写成 `new Set([...Object.keys(defaultPageConfig), 'heights','metaPos','editorFont','editorFontSize','lyricShrink'])`。`showInstrument` 与 `lyricShrink` 一样是**可选字段**（`?` 修饰、**不在 `defaultPageConfig` 对象上**），而当初只有 `lyricShrink` 被手工补进白名单（adj292），`showInstrument` 被漏掉。**"白名单靠人工补"本身就是缺陷来源**——新增可选字段时没有任何机制提醒
- **解决**（adj382，`engine/settings.ts`）：可选字段抽成 `OPTIONAL_CONFIG_FIELDS` 常量（补齐 `showInstrument`），白名单 = `defaultPageConfig` 运行键 ∪ 该常量；并加**编译期完整性断言**——`type OptionalConfigKey = { [K in keyof PageConfig]-?: undefined extends PageConfig[K] ? K : never }[keyof PageConfig]`，`Exclude<OptionalConfigKey, typeof OPTIONAL_CONFIG_FIELDS[number]> extends never ? true : never`：引擎以后新增可选字段而不更新常量时 **`tsc` 直接报错**。smoke 新增 `[89]`（14 项），核心是**强不变量**「写入 JSON 里的每个字段都必须能读回」（比逐个列举字段更难被绕过）
- **预防**：① **"白名单/映射表"必须有"新增即报错"的机制**（编译期断言，或"写入→读回全等"这类不变量断言），否则迟早在新字段上漏一项；② 序列化往返功能先写**不变量断言**（写入集合 ⊆ 读回集合）再改实现——本轮若只按字段逐个断言，很可能又漏掉下一个字段；③ 本轮是"为下游插件复用"做核对时才发现的：**跨项目复用前先验证上游往返保真**，否则下游会把上游 bug 误当成自己配置写错（同类问题在插件侧刚发生过：插件自己的 `PAGE_CONFIG_FIELDS` 也曾漏掉同一批可选字段）

### E-2026-125 编辑器字体/字号被写进谱面 `# jps-config`（且与 uiStore 两份存储）（adj-font）
- **场景**：梳理"设置归属"准备嵌入 Obsidian 插件时发现：**把 .jps 发给别人，对方的编辑器字体/字号会被改**；用户自己也反馈"改了字号换个谱又变回去"
- **排查**：全仓扫描 `editorFont|editorFontSize` → 顶栏 A−/A+ 与字体下拉走 `setPageConfig({ ...pageConfig, editorFontSize: v }, true)`（`TopBar.tsx:368/380/416/469/483`）→ `docStore.setPageConfig(cfg, true)` → `writeJpsConfig(code, cfg)`（`JSON.stringify(cfg)` 写整份 PageConfig）；同时 `uiStore` 里还有同名偏好（localStorage `ijipu.editorFont`），**读取是 `pageConfig.editorFontSize ?? editorFontSize`**；而**页面设置对话框里的字体/字号控件写的却是 uiStore**（`PageConfigDialog.tsx:100-103`）→ 同一偏好两份存储、两个入口
- **根因**：**没有"设置分层"约束**——把"用户个性"（L1）当成了"谱面级"（L2）字段塞进 `PageConfig`。`PageConfig` 是随谱序列化的结构，里面出现编辑器偏好，就必然被写进文件
- **解决**（adj-font）：
  - `PageConfig` **移除** `editorFont/editorFontSize`（类型层保证不可能再写入）；新增 `EditorPrefs`/`defaultEditorPrefs`（`engine/fonts.ts`）
  - L1 偏好收敛到 `src/store/editorPrefs.ts`（唯一读写入口）；顶栏/编辑器只读写 L1，不再 `setPageConfig`
  - 旧谱（已带 editorFont 的历史文件）由 `extractLegacyEditorPrefs()` 一次性迁移到本机偏好（仅当本机未设置过），此后保存自动清除
  - 插件侧 `frontmatter.ts` 把 `ijipu_editorFont*` 归入「已不再随谱保存」并给出原因提示（不是"未识别键"）
- **预防**：① **新增/调整设置项必须先定层**（已写入 `AGENTS.md` 七 + `docs/SETTINGS-AUDIT.md`：L0 默认/L1 用户个性/L1.5 笔记级/L2 谱面级/L3 会话级 + 判定三问）；② **"随文件序列化的结构"里只允许出现 L2 字段**——发现序列化结构里混入偏好类字段，直接移出而不是加白名单过滤；③ 同一语义**只允许一个存储位置**（出现 `A ?? B` 这种"两级回退读取"就是两份存储的征兆）

### E-2026-126 `# jps-config` 全量写入把旧默认永久钉在文件里 + 字体裸名跨机失效（adj-font）
- **场景**：同上梳理过程中发现两个设计问题：① 设置行写入**全部**字段（约 930 字符一行，含与默认值相同的项）；② 谱面字体下拉存的是**裸字体名**（`Microsoft YaHei`/`SimHei`/`KaiTi`…）
- **根因**：① `writeJpsConfig` 用 `JSON.stringify(cfg)` → 将来把某个默认值改得更合理，**旧谱仍按旧默认渲染**（哪怕那份谱从未被用户改过）；② 字体是单个族名、**没有 fallback 链**，macOS/Linux/手机缺该字体时静默回退到浏览器默认字体（笔画粗细/字宽全变，简谱数字对位崩坏）
- **解决**（adj-font）：
  - 写入改为**差量**：只写与 `defaultPageConfig` 不同的字段；**无差量则删除该行**（并收敛空行）；新增 `{ mode:'full' }` 与界面「固化全部到谱面」应对"分享/存档要完全一致"
  - 字体集中到 `engine/fonts.ts`：候选项一律是**含通用族的完整栈**（三原则：跨机尽量有 / 适合简谱 / 保证有可用字体）；`normalizeFontStack()` 让**旧谱里的裸名读到时自动补 fallback**（用户无需改谱）；应用与插件共用同一份目录（此前应用 10 项裸名、插件 5 项且不一致）
- **预防**：① **"写到用户文件里的东西"默认应是差量**（无差量则不留痕），全量只在用户显式要求时使用；② 涉及字体的值一律**带通用族兜底**，并在读取侧做一次归一化以兼容历史数据；③ 同一份候选清单不允许两处各写一套（此处应用/插件两份，正是漂移来源）

### E-2026-127 矮视口（PAD/手机横屏）下顶栏菜单超出视口，末几项无法选择（adj385）
- **场景**：用户反馈「宽屏模式（PAD/手机横屏）下菜单高度超过视界，下面的菜单项无法选择」；同批还反馈「窄屏下视图组仍显示『左右拆分』，没有意义」
- **排查**（无头 Chrome 多视口实测，量 `scrollHeight` / `clientHeight` / 下拉底边与视口底边）：
  | 视口 | 菜单内容高 | 实际可见高 | 差 |
  |---|---|---|---|
  | 1400×900 | 742 | 718 | 24（需内滚） |
  | 1366×768 | 742 | 710 | 32 |
  | 1024×768 | 742 | 710 | 32 |
  | 844×390 | 742 | 332 | **410** |
  | 900×414 | 742 | 356 | 386 |
- **根因**：① 限高公式 `.menu-dropdown { max-height: min(calc(100vh - 56px), 720px) }` 里的 **56px 是"猜的下拉顶偏移"**（顶栏实际高 40 + 6 间距 = 46，浏览器工具栏还会再吃掉一截）——矮视口下这点偏差直接变成"底部被裁"；② 菜单内容本身高 742px（5 组 20+ 项），矮视口没有任何布局适配；③ 触屏上 `scrollbar-width: thin` 的菜单内滚动条不可见，用户无法察觉"可以滚" → 表现就是"菜单项点不了"
- **解决**（adj385）：
  1. `TopBar.clampDropdowns()`：按**实测 top** 现算 `max-height = window.innerHeight − top − 12`，在 `resize` / `orientationchange` 时重算（真实设备浏览器工具栏吃高度也能自适应）；多列布局跳过限高
  2. CSS 补矮视口适配：`@media (max-height: 820px)` 收紧菜单行高/间距（覆盖 PAD 横屏 1366×768 与所有手机横屏）；`@media (max-height: 560px) and (min-width: 620px)` 时汉堡菜单改**双列**排布（多列按列数容纳内容，从根上不超视口，隐藏列间分隔线）
  3. 视图下拉补 `overflow-y: auto`（此前只有 `max-height`、没有滚动 → 内容会被直接裁掉）
  4. 顺带修：视图组下拉在窄屏（≤1024px）下过滤「左右拆分」条目（窄屏拆分固定上下，列出无意义）
- **验证**：五档视口复测 `scrollHeight == clientHeight`（不再裁切）、`menuOverVh: false`；844×390 截图核对双列菜单完整可见
- **预防**：① **浮层的高度约束不能用"猜的偏移"**——一律用实测位置（本次 56px 就是猜的，顶栏高度/浏览器工具栏一变就错）；② **矮视口是独立场景**：至少过 390/414（手机横屏）、768（PAD 横屏）三档，别只在桌面窗口验证；③ 依赖"用户自己滚"的浮层，在触屏上必须让可滚性可见（本次改用双列直接避免滚动）；④ 与"有没有意义"相关的选项要按当前形态过滤（窄屏不该出现"左右拆分"）

### E-2026-128 顶栏「字体」下拉打不开——被 `overflow: hidden` 裁掉 + `fontRef` 被隐藏测量容器覆盖（adj386）
- **场景**：用户反馈「顶栏的编辑区字体下拉菜单无法打开」
- **排查**（无头 Chrome 多宽度实测，逐步缩小范围）：
  1. 1050~1600 宽下字体按钮都在工具条里；点击后 `aria-expanded=true`、下拉 **DOM 存在**、几何也正确（160×122）——所以不是"没触发"；
  2. 但把下拉矩形中心做 `elementFromPoint` 命中测试，拿到的是 **TEXTAREA** → 说明它**根本没画出来**；
  3. 打印祖先计算样式：`.topbar-toolbar { overflow: hidden }`（用于裁掉横向溢出的按钮）→ absolute 定位的向下弹层被该容器裁掉；
  4. 改成 `position: fixed` 后仍然跑偏：下拉 x 恒为 447（应贴按钮右缘）。再逐个实例 dump 发现**同一个 ref 挂了两份**：隐藏测量容器 `.topbar-measure`（渲染全部按钮量宽）里也渲染了这个分体按钮，React 把 `fontRef`/`fontDdRef` 指到了**后渲染的测量实例**（其按钮 x≈525）→ 定位按"测量容器里那个按钮"算，自然跑偏。
- **解决**（adj386）：
  1. `renderBtn(t, measuring = false)` 增加测量态参数：测量容器里的那份**不挂 ref、不渲染下拉**；
  2. 字体下拉改 `position: fixed`，按真实按钮 rect 现算 `top`/`right`（`fontDdPos`）——视觉仍是贴按钮右缘向下弹出，但彻底脱离 `overflow: hidden` 祖先裁切；
  3. 与 adj385 的 `clampDropdowns` 动态限高联动（该下拉已在限高列表内）。
- **验证**：1050/1120/1200/1280/1400/1600 六档实测 `dropdownVisible: true`、命中测试落在 `.opt`（弹层在最上层）、下拉右缘与按钮右缘对齐；1400×760 打开态截图确认 4 个字体选项（Consolas/Courier New/Menlo·DejaVu/系统等宽）可见
- **预防**：① **浮层不要放在 `overflow: hidden` 容器内**——要么用 portal/`position: fixed` 提到裁切之外，要么在展开时让该容器 `overflow: visible`；② **不要把 ref 挂在会重复渲染的组件上**：本项目的隐藏测量容器会渲染全部按钮，凡 `renderBtn` 内挂 ref 的点都必须用"测量态"参数排除（这类 bug 表现是"功能触发了但表现用错了参照物"，很难从截图上直接看出）；③ 排查"打不开"先分两类：**没触发**（看 `aria-expanded`/事件）vs **触发了但没画出来**（看命中测试 `elementFromPoint`）——本次一眼分开就定位到了裁切

### E-2026-129 小节线「渲染一套偏移、布局一套总宽」两处各写 → `adj104` 缩线宽时占位表未同步（线组偏左、预留虚胖、线间距 1→1.2）（adj391）
- **场景**：用户问「现在小节线的细线与粗线宽度各是多少」，核对代码时发现**渲染与实际占位对不上**：`render/index.ts` 的 `renderBarline` 里写死一整套偏移（`|` 画在 `-0.55`、`||` 画在 `-1.95`/`0.15`…），而 `layout/index.ts` 另有一份 `barlineTotalW()` 总宽表（`|`→1.1、`||`→3.9、`|:`/`:|`→8.4、`:|:`→15.0，点径按 3.0）。
- **根因**：同一件事（线组几何）在**两个文件各维护一份**，只能靠人工同步：
  1. `adj104` 把线宽从 1.1/1.8 缩到 0.9/1.4 时**只改了渲染**，且改法是「线左缘位置保持、右缘内收」；
  2. 于是**占位表仍是旧线宽**——预留比实际画出的宽 0.2~3.0px（`:|:` 15.0 vs 实际 ~12.0）；
  3. 同时「左缘固定」使线组**不再以小节线中心 x 对称**（`|` 实际 [-0.55,+0.35]，中心偏左 0.1），而布局那边是按「x = 线组中心、半宽 = totalW/2」算位置的（`lineX = width - margin_right - totalW/2` 等），两边假设不一致；
  4. `||` 的**线与线间距**也从注释里的 1px 变成了 1.2px（-1.05 → 0.15），注释与实际脱节。
- **解决**（adj391，用户规则：**细线 1、粗线 2**）：
  1. 线组几何**收敛为单一来源**：`layout/spacing.ts` 新增 `barlineGeometry(type)`（元素序列 + 间距 → 线组总宽 + 各元素相对**中心**的偏移）与 `barlineTotalW = geometry.total`；
  2. `renderBarline` 改为遍历几何绘制（不再写死偏移），临时节拍分数、`&fine/&dc/&ds` 标记的横向基准也改由几何的「右缘 = total/2」给出；
  3. `layout/index.ts` **删除自带的 `barlineTotalW`**，改从 `spacing.ts` 导入；`MIN_BARLINE_SPACE` 9.1 → 9（单线宽 1 + 两侧各 4px）；
  4. 线组一律**以小节线中心对称**（与布局既有假设一致）；线与线间距恢复 `adj55` 原意 1px（`BARLINE_LINE_GAP`），线与点仍 1.2px（`BARLINE_DOT_GAP`）；
  5. 顺带把 `renderBarline` 里硬编码的 `4 * s` 换成已有的 `BARLINE_DOT_OFF * s`。
  6. **另一项用户规则（同批）**：高八度点此前比低八度点额外左移 1px（`adj19`），现统一取「数字槽中心」`x + digitW/2`——与低八度点、增时线、上方修饰符、注释同一中心（`adj391`）。
- **验证**：`npm run smoke` **17 项失败 == 改动前基线**（无新增），其中新增断言覆盖：线宽常量 1/2、`||`/`||/` 线间距 1px、`|`/`||`/`||/`/`|:`/`:|`/`:|:` 的**渲染几何逐项 == `barlineGeometry`**（线偏移/宽 + 点圆心）、占位总宽表（1/4/3/6.6/7.6/7.6/13.2，`|*`=1、`|/`=0）、几何对称性、高音点 x == 数字槽中心；`tsc -b` 通过；`obsidian-ijipu` 同步 `vendor/engine` 后其 smoke 99 项全绿；无头 Chrome 截图（示例 `yufa-quangai`）实测高八度点 `cx=51.93` 与数字槽中心 `47.9+13×0.31=51.93` 完全一致。
- **预防**：① **同一几何量只能有一处定义**——渲染与布局必须消费同一个纯函数（本项目已对间距用 `spacing.ts` 集中管理，本次把"线组几何"也纳入；凡"渲染写偏移 + 布局写总宽"的形态都视为隐患）；② 改线宽/间距这类**影响占位**的常量时，必须**同时**核对「画出来的形状」与「占位表」，不能只看渲染；③ 断言要写成「渲染实测 == 几何函数」而不是「渲染 == 手抄的魔数」——手抄的魔数正是这次漂移的载体（`smoke.mts` 里 `0.55/1.95/4.2/8.1` 那套右缘表已全部改用 `barlineTotalW`）；④ 小节线中心 x 由布局以 `r1`（0.1px）取整，故"右缘 = 中心 + 半宽"可能有 ≤0.05px 取整外溢，断言按此放容差而不是硬 `<=`。

### E-2026-216 短前倚音改为"总是抢在拍前"（主音符稳落拍点）（adj508）
- **场景**（用户决定）：「短前倚音是否总是抢在拍前：**改**，以保证主音符总在拍点上」。
  此前所有前倚音（长/短）都占拍点、把主音符往后推，与"短倚音不占强位、重音在主音符上"的规范不符。
- **改法**（`sequence.ts`）：短前倚音（`!after && 有减时线`）走新分支——
  - 倚音组占 `[拍点 − 窗宽, 拍点]`（`graceAtMs = atMs − graceWindowMs`），**主音符起奏点偏移 0**（稳落拍点）、时值不变；
  - 时间从**上一个主音符**匀：把它截短到窗口起点（沿用既有 `prevConsumeMs` patch 机制）；
    拍点前的**空白**（休止/间隙）可直接用，不必截短任何音；
  - **安全下限**：上一个主音符最多让出**一半**（`prevDur / 2`），避免"前一个音被整个吃掉"；
    若可借的量仍不足，则**压缩倚音窗口**（`graceWindowMs = gap + 借到的量`）而**不动主音符位置**；
  - 前面一点时间都没有（全曲/乐句第一个音）⇒ 退回"占拍点、主音符后移"（否则倚音无声）。
  - 长前倚音与后倚音**不变**（长倚音占拍点=重音；后倚音占自己主音符尾部）。
  实现时先踩了一个坑：只改了主音符的**时值**而没改它的**起点**（兜底分支漏设偏移）⇒ 首个音上出现
  "倚音与主音都从 0 起"。修法是引入 `mainShiftMs`（主音符相对拍点的偏移）统一决定起点：
  短前倚音抢拍前 = 0、长前倚音/兜底 = 组时值。
- **验证**：smoke 新增 **4 条 adj508 断言** + 改写借用那条：
  `1 3[2/] 1` ⇒ 前音 750、倚音 750–1000、**主音 1000 处奏满 1000ms**；
  `1 3[2] 1` ⇒ 长倚音仍占拍点（倚音 1000+500、主音 1500+500）；
  `1 3[h2/] 1` ⇒ 后倚音不受影响（主音 1000+750、倚音 1750+250）；
  `5 - 6,////[2/] 1` ⇒ 前一个主音符 2000 → 1875（让出整个 1/8 拍窗口）、倚音 1875+125、主音在 2000 处。
  既有断言里"全曲第一个音"的用例（`3[2/] …`）自然走兜底分支、数值不变 ✔。
  `tsc -b` / `lint`（0 error）/ `build` / `smoke`（ALL PASSED）/ `preview:render`（0 错误谱）全过。
  文档：`docs/SYNTAX.md` §2.5 第 3、4 条重写（借用来源 + 三种摆放），并给出 `1 3[2/] 1` / `1 3[2] 1` 两个对照例子。
- **预防**：① **"改变时值"与"改变起点"是两件事**——本轮兜底分支只改了时长没改起点，症状是"两个事件挤在同一时刻"；
  凡是"从邻居匀时间"的机制，都要同时检查**被借方的时长**与**借方的起点**，并用一条断言把两者钉在一起。
  ② 一个机制加"兜底分支"时（本轮"前面没时间可借"），要问清楚兜底分支下**其它变量是否也要跟着回退**（本轮 `mainShiftMs` 就漏了）。
  ③ 同类规则的"边界首例"（谱首第一个音）最容易被兜底分支悄悄改掉行为 ⇒ 断言里要**同时保留首例与正常例**两种用例。

### E-2026-217 无告警 / 少于 2 条告警时 dock 显示「至少 4 行高度」（adj513/516）
- **场景**（用户连续报）：①"点击告警页签，无告警时只显示了一行'语法检查通过，没有问题。'，却显示了至少 4 行文件的高度"；②"在少于两个告警或无告警的情况下应按最小高度显示"。
- **根因**：告警面板 0 条告警时只渲染 `<div className="dock-empty">{dockCopy.noProblems}</div>`，内容自然高 ≈ 30px；但 `clampH` 用 `MIN_H = CHROME_H(43) + PANE_PAD_H(18) + MIN_CONTENT_H(34) = 95px` 作为下限，硬把 dock 钳到 ≈95px ≈ "4 行"。adj510 把告警纳入 AUTO_FIT 后走 `forPanel()` 拿到的内容自然高 73px 仍 < MIN_H → `max(73, 95) = 95`。
- **解决**：
  1. `clampH(v, key, noProblems = false)` 新增第三参数：告警面板在 `noProblems=true` 时下限改为 `0`（仅约束上限）。
  2. `dockH` 调用 `clampH(baseH, dockPanel, noProblems)`：初始高度无告警时不被 MIN_H 拉高。
  3. 拖拽回调 + 键盘 bump 同步透传 `noProblems`，与 `dockH` 计算保持一致。
  4. `noProblems` 语义从 `problemCount === 0` 扩为 `problemCount < 2`（adj516）：1 条告警时仅"头 + 1 行 ≈ 80px"也不再被 MIN_H 拉高。
- **验证**：行为对照表（场景 → dock 高度）：0 条 ≈ 73、1 条 ≈ 64、3+ 条 ≈ 133（cap 头 + 2 行）+ 列表自身滚动；smoke 151 项全绿。
- **预防**：① **"下限"是为有交互的面板（按钮/输入框）准备的兜底，纯展示型内容（`.dock-empty` / 提示文字）应当尊重内容自然高**——设下限前先问"这里有没有可交互区域"；② 拖拽相关计算（拖动 + 键盘 bump + 初始 fit）的下限口径必须**三处同步**，否则用户在面板上调整过高度后再次打开又被不同的下限拉回去；③ "用户报'X 行太高'"时，先把"X 行高对应的 px"算出来对照 `MIN_H` —— 本次 `95 / 22 ≈ 4.3` 一眼钉死。

### E-2026-218 告警展开/收起三角箭头太小（adj512/515/516/517）
- **场景**（用户连续 4 轮报）：①"展开后的下方向三角箭头太小了，应设置与收起时的右方向箭头一样大小"；②"告警的右向三角箭头和下向三角箭头太小了"；③"三角箭头还是偏小调 16 试试"；④"三角箭头改 18"——从 10 调到 18。
- **根因**：
  1. 收起态用 `▸` (U+25B8)、展开态用 `▾` (U+25BE) —— **两个字符在不同字体下字形宽高不一致**，看起来"展开后变小"（adj512 根因）；
  2. glyph 初始字号 10px、盒子 10×10，比告警正文 `.problem-row` 的 12px 还小，视觉"虚"。
- **解决**：
  1. 收起/展开**只用同一个字符** `▸`，展开态用 CSS `transform: rotate(90deg)` 旋转成下三角 —— 同字符旋转前后**视觉大小完全一致**（adj512）。
  2. glyph 字号从 10 → 14 → 16 → **18px**（按用户连续反馈逐步放大），父按钮容器 `flex: 0 0` 从 16 → 18 → 20 → **22px** 保证字符旋转 90° 后仍居中不抖不偏（adj515/516/517）。
  3. 用 `<span class="problem-expand-glyph">` 包住字符而非 `::before` 伪元素 —— 伪元素里的字符在不同浏览器/字体下也存在尺寸差异，且伪元素不便做"基于 `is-open` 类旋转"的条件 transform。
- **验证**：smoke 153 项全绿（无新增断言；本条是 UI 视觉调整，无新增可断言的不变量）。
- **预防**：① **同一个 UI 状态用两个 Unicode 字符渲染**几乎必有跨字体差异——要么用单个字符 + `transform: rotate()`，要么用 SVG；② "用户报'图标太小'"是**可断言的不变量**（glyph 字号 ≥ X）——下轮类似可加 smoke 的"字号下限"断言把这次调子锁住；③ "字符在盒子里旋转 90° 后居中"依赖 `display: inline-block` + 等宽高 + `line-height` 与 `font-size` 一致；缺一条就偏移或溢出。

### E-2026-219 底栏页签图标与顶栏按钮图标尺寸不一致（adj514）
- **场景**（用户报）："与顶栏比较，底栏的页签按钮上的图标有点虚，确认底栏的页签按钮是否与顶栏的一致？"。
- **根因**：adj486 把页签图标统一为 `ToolIcon` 时写了 `<ToolIcon name={t.icon} size={14} />`，而顶栏所有按钮的 `<ToolIcon />` 都是**默认 size=16**（除"下拉箭头"用 size=9 外）。底栏页签图标比顶栏小 2px —— 视觉上"虚"。
- **解决**：去掉 `size={14}`，让 `<ToolIcon />` 用默认 16px —— 与顶栏所有按钮图标一致；smoke 断言由硬编码 `size={14}` 改为正则 `<ToolIcon name={t.icon} />`（默认 16），断言改名"adj486 底栏页签用 ToolIcon（试听→play / 导出→export / 设置→settings）；adj514 图标与顶栏同 16px"，把"对齐顶栏 16px"写进断言。
- **验证**：smoke 重新全绿；用户面"图标有点虚"的视觉反馈消除。
- **预防**：① **"同一套图标"在不同调用点的尺寸必须由同一来源控制**（`ToolIcon` 的默认 `size=16`）——凡需不同尺寸的，必须显式传 prop；不要在某处写死 `size=14` 那种"看起来差不多"的数；② 顶栏 vs 底栏"同种图标"的尺寸差，可加 smoke 的"两端尺寸一致"断言钉死 —— 这次的修复就是顺着这条加的；③ **"看起来差不多"的尺寸差（1-2px）在高 DPR/Retina 屏上会被放大感知**——比想象更敏感。

### E-2026-220 主题配色列表改为流式单选框（adj509）+ 音色库「指定音色」对话框独立
- **场景**（用户报）："主题页中的主题配色列表，取消列表，改用流式的复选框选项，以获得更一致的体验"；"音色库中的通用音源列表不再显示，而是在全选和全消之间添加一个指定按钮，点击按钮时弹出带列表的对话框来选择要使用的音色，即把这个通用音源列表独立到一个对话框中，同时对音色库的内容进行重新梳理排版"。
- **根因**：
  1. 主题配色原为 `.theme-list` 的 `flex-direction: column`（竖向列表 + 单选色块勾选），与全局页签里"输入条/折行/排版"等**复选框选项**的视觉/手感不一致——用户在两个标签页之间来回切会感到"明明都该是同一类选项，长得却不一样"。
  2. `SoundBankPanel` 内嵌展开的 128 音色列表（`.soundbank-voices`）把面板撑高且与"音源/收藏/音色文件"等其它操作混在一起，导致面板高度不可控（一展开就占满整列），且不便快速定位分组。
- **解决**：
  1. **主题配色**（`PageConfigDialog` 主题 tab）：`<div onClick>` → `<input type="radio" name="ijipu-theme">`（行为仍单选），`.theme-list` 改 `flex-wrap: wrap`，视觉与全局页签复选项同款（边框 + 选中态高亮 + `:has(input:checked)`）；描述 `max-width: 140px` + `text-overflow: ellipsis`。
  2. **音色库重构**：移除内嵌展开列表，新增 `VoicePickerDialog`（独立浮窗）—— 128 种 GM 音色按 14 类分组（钢琴/打击/风琴/吉他/贝斯/弦乐/合奏/铜管/簧管/笛管/合成/民族/打击/音效），含「全选/全消/反选/搜索」与每组的「选本组/消本组」快捷操作；`SoundBankPanel` 改为「音源状态 / 音色启用 / 收藏与音色文件 / 说明」四块小节排版，「全选 / 指定音色 / 全消」三个按钮横排（指定音色按钮用 accent 色突出）；`ModalKind` 新增 `'voicePicker'`。
  3. 所有新增文案入 `brand/copy.ts` 的 `voicePickerCopy`（`title/searchPlaceholder/summary/selectAll/clearAll/invert/selectGroup/clearGroup/doneSelectVoices`）。
- **验证**：smoke 148 项全绿（断言更新为 `['problems','tryout','export','about']` + 路径存在 `'src/dialogs/VoicePickerDialog.tsx'`）；`tsc -b` + `npm run build` + `npm run smoke` 全过。
- **预防**：① **"列表 vs 流式复选项"在同一应用的视觉一致性**——重复类型操作的不同表现会让用户疑惑"是不是两种东西"；同类选项应统一为同一种控件；② **"在面板里展开 128 项长列表"几乎必破坏 AUTO_FIT**（内容自然高 = 128 行 × 22px = 2.8k px 远超 `maxH()`）——长列表一律拆到独立对话框/drawer；③ **单一职责的分块排版**比"塞在同一面板"更利于调高度与扫读——本次四块小节标题（音源状态/音色启用/收藏与音色文件/说明）每块 12px 间距与「设置 → 谱面」保持一致。

### E-2026-221 dock 设置面板「恢复默认 / 保存设置」按钮样式与顶栏不一致（adj511）
- **场景**（用户报）："设置的恢复默认，保存设置按钮的样式也参考顶栏按钮，以保持一致性"。
- **根因**：设置面板底部按钮原用全局 `.btn`（padding 6×16、font-size 13、hover 仅改 border-color）；adj509 把页签改成顶栏 `.topbar-btn` 同款（5×10 padding、12px 字号、7px 圆角、hover 三联动）后，dock 内的页签与底部按钮之间又出现了视觉断层 —— "上面页签是顶栏风格，下面按钮不是"。
- **解决**：新增 `.tool-dock .pcfg-foot > button.btn` 作用域（特异性 0,3,1 严格压过全局 `.btn` 的 0,1,0）：
  - 恢复默认 = 普通顶栏按钮（5×10 padding、12px、7px 圆角、hover 三联动 border + color + bg-panel-hover）；
  - 保存设置 = 顶栏 `.topbar-btn.active-guide` 同款（`--jp-bg-panel-active` 实心背景 + 强调色文字 + 强调色边框；hover 用 `filter: brightness(1.05)` 微亮）。
- **验证**：smoke 147 项全绿（无新增断言；本条是 UI 视觉调整）。
- **预防**：① **"同套视觉规范"在 dock 内必须通顶到底**——页签、按钮、内容区三处的圆角/字号/padding 应当来自同一个 `var(--jp-resize-h)` / `--jp-font-sans` 体系；一旦中途换了"全局 `.btn`"就会断层；② 特异性压过全局基类（`0,3,1` vs `0,1,0`）的写法只在**确认不影响其它对话框**的前提下用 —— 本次设置面板的底部按钮是仅有的两处，不会污染其它使用 `.btn` 的对话框（试听/关于/捐赠/快捷键）；③ **"主操作"按钮的视觉权重应明显大于次操作**——`primary` 不能只是"换个 accent border"，本轮改成与顶栏 active-guide 完全一致（实心背景 + 强调色文字），更突出。

### E-2026-222 底栏"除设置外都调不动高度" + 高度档位"只能两段切换"（adj518–adj520）
- **场景**（用户两次实测反馈）：
  ① "目前除了设置页签是可以调整高度的外，其它几个页签都不能调整"；
  ② 加了高度切换按钮后："现在的高度只能在两段里切换，没有三段切换"。
- **根因**（三个独立缺陷叠在一起，只在同一个功能上才一起暴露）：
  1. **拖拽值从不被读取**——高度取值写成 `baseH = fitKeys ? forPanel(dockPanel) : (heights[dockPanel] ?? forPanel(dockPanel))`。
     `fitKeys`（AUTO_FIT = 告警/试听/导出/关于）为真时**直接返回 `forPanel()`**，把用户拖拽写入的
     `heights[dockPanel]` 整条绕过 ⇒ 这几个面板怎么拖都不动；设置面板不在 AUTO_FIT 里，所以"只有它能拖"。
  2. **状态机生不出第三档**——循环写成三分支 `suggested→max` / `max→suggested` / `其余→suggested`，
     `next` **从未被赋值为 `'min'`** ⇒ "最小"在代码上不存在。深层原因：目标序列
     `建议→最大→建议→最小→建议` 里**"建议"出现两次、两次的下一步方向相反**，
     "只记当前是哪一档"这类状态**在信息上就不足以推出下一步**（缺的是历史，不是当前值）。
  3. **下限把"最小"钳回去**——`clampH` 的下限按面板/告警数给三种值：设置 `MIN_H_SETTINGS=133`、
     普通 `MIN_H=95`、告警且 <2 条时 **0**。于是"最小"档要么被钳到 95/133（看起来没变），
     要么真到 0（连页签和按钮一起藏起来）。同一份"能到多小"的口径按面板给出三种答案，本身就是隐患。
  4. 附带：设置面板的"建议高度"取 `forPanel('settings')`，而它在宽屏下**等于 `maxH()`**（adj509 为看全
     左栏 5 个页签把默认高度拉满）⇒ 三档里两档重合，同样表现为"只有两段"。
- **解决**：
  1. `baseH = heights[dockPanel] ?? forPanel(dockPanel)`——**用户拖过的值优先**，AUTO_FIT 只负责给"初始默认"；
     同时删除"切换面板时清掉 AUTO_FIT 拖拽值"的 effect（保留"重新打开 dock 才清"）。
  2. 循环改为**模块级 `SIZE_PHASES` 4 相位表 + `sizePhase` 状态**（显式记住走到第几步），
     每点一步、4 步一循环；图标（`上.png`/`下.png`）由相位表给出，语义 = "点一下会往哪走"。
  3. `min` 改为物理下限 `MIN_DOCK_H = CHROME_H`（抓手 + 页签栏 = 43px，只留外壳）；`clampH` 下限统一为它，
     **删掉 `MIN_H`/`MIN_H_SETTINGS`/`minFor()` 与按告警数特判的 `noProblems`**；
     `aria-valuemin` 与 `clampH` 共用同一常量（消除"ARIA 报 95、实际能到 43"的漂移）。
     内容不够高改由内容区的 `overflow-y: auto` 兜底，不再用抬高下限来"保护内容"。
  4. 设置面板"建议"改用 `settingsDefaultH`（6 行 ≈235px）；再夹一道 `(min+8, max−8)`，
     把"三档两两不同"从"数值凑巧"变成**结构性保证**。
  5. **相位同步只在手动路径拨**（拖拽 / 键盘 bump），不用 effect 监听高度——否则
     "点击设相位 → 高度变化 → effect 按高度把相位改回"会互相触发、把循环卡死在同一档。
- **验证**：用一个独立小脚本（跑完即删）模拟相位表 8 次点击，与用户给的对照表（含图标方向）
  **逐项比对全部一致**，并断言 `min(43) < suggested(133) < max(460)`；`smoke` 全绿（151 项）；
  `lint` 0 error（中途出现的 5 条 `exhaustive-deps` 已通过"去掉多余的 `useMemo`"消除，回到 27 条基线）。
- **预防**：① **"用户操作没生效"先查"写进去的值有没有被读出来"**——本次是 `heights` 写了但取值表达式
  把它整条绕过；凡是"状态 A 写入、状态 B 生效"的链路，都要在**取值那一行**确认分支不会跳过它；
  ② **循环/多档切换的状态设计先问"当前值是否足以推出下一步"**——若同一个显示值后面跟着两种不同的下一步
  （本次"建议"之后可能是最大也可能是最小），就必须显式记住**步骤/相位**，不能只存"当前档"；
  ③ **"下限/上限"这类约束只应有一处定义**，且必须与 ARIA（`aria-valuemin/valuemin`）、拖拽、键盘、
  预设档四类消费方**共用同一个常量**——本次三套下限并存正是"最小档到不了"的直接来源；
  ④ 用 `useEffect` 去"同步"两个本就该单向流动的状态（点击 → 高度）容易形成互相触发，
   本轮的定式是：**effect 只做"外部输入 → 内部状态"，不做"内部状态 → 内部状态"的镜像**。

### E-2026-223 新增按钮图标时漏同步 `public/sw.js` 预热清单（adj520）
- **场景**：为档位按钮新增 `public/icons/上.png` 并在 `ui/toolIcons.ts` 里登记 `up: '上'` 后，
  `npm run smoke` 立刻失败：`adj417 sw.js 预热清单与 ui/toolIcons.ts 完全一致（防清单漂移）`。
- **根因**：图标清单有**两处**——`src/ui/toolIcons.ts`（TS 侧，组件按名字取图）与
  `public/sw.js` 的 `ICON_FILES`（SW 安装时预热的文件列表，手写数组）。新增图标只改了一处。
- **解决**：把 `'上'` 同步进 `public/sw.js` 的 `ICON_FILES`（位置紧挨 `'下'`）。
- **验证**：`smoke` 恢复全绿；该断言正是为这类漂移准备的（adj417 立的），本轮它按预期拦住了漏改。
- **预防**：① **新增/删除按钮图标是"三处同步"动作**：图标文件本身、`toolIcons.ts` 的映射、
  `sw.js` 的预热清单（第 4 处是 `scripts/smoke.mts` 里可能存在的硬编码断言）——改完立刻跑 `smoke`；
  ② 这类"两份手写清单必须一致"的结构，**断言就是唯一的防线**，所以新增同类清单时要**同时补断言**；
  ③ 用户提供的图标资源（如本次的 `上.png`）落在 `public/` 下会显示为**未跟踪文件**，
  代码一旦引用就必须 `git add` 进本次提交，否则干净检出/CI 会缺图（本项目的 `public/icons/` 属源码资产）。

### E-2026-224 手机端"底栏最小化时下压，显示的最小高度小于页签栏高度"（adj521）
- **场景**（用户报）："在手机端的窄屏模式下，可能是放大的高度调整条的高度，导致在底栏最小化时下压，
  从而底栏 dock 显示最小高度小于页签栏的高度。"
- **根因**：外壳高度是**写死的常量**，而抓手高度其实来自 CSS 变量：
  `const CHROME_H = RESIZE_H(5) + TABS_H(38) = 43`，但 CSS 在 `@media (pointer: coarse)`
  （手机/平板）下把 `--jp-resize-h` 设为 **14px** ⇒ 手机上真实外壳 = 14 + 38 = **52px**。
  "最小档"取了 43px，比外壳矮 9px ⇒ 容器装不下"抓手 + 页签栏"，页签栏被
  `.tool-dock { overflow: hidden }` 裁掉一截（用户描述的"下压"）。
  同一处偏差还会污染**所有**按 `CHROME_H` 算出来的高度（告警 cap、设置 6 行、建议档…），
  只是"最小档"最紧、最先暴露。
- **解决**：把外壳高度从"写死常量"改为**运行时实测**——
  组件内新增 `chromeH` 状态，`useLayoutEffect` 里量 `.tool-dock-resize` + `.tool-dock-tabs`
  的 `getBoundingClientRect().height`，并用 `ResizeObserver` 观察这两个元素（`--jp-resize-h`
  随媒体查询变化时 RO 会触发重测）+ `window.resize` 兜底；`clampH` / `defaultH` /
  `settingsDefaultH` / 三档取值 / `aria-valuemin` 一律改用 `chromeH`（`CHROME_H` 只作首帧兜底），
  并删除已无用的 `MIN_DOCK_H` 常量。上限补一道 `Math.max(maxH(), chromeH)`，
  避免极矮视口下出现"下限 > 上限"的反向钳制。
- **验证**：镜像算式的小脚本逐档核对（跑完即删）——
  桌面（抓手 5）外壳 43 / 最小 43；手机（抓手 14）外壳 52 / 最小 52；
  6 组视口 × 面板组合下"三档严格有序 + 最小档 ≥ 外壳（页签不被裁）"全部通过；
  并复现旧写法：最小档恒 43、手机真实外壳 52 ⇒ 差 9px（正是被裁的量）。
  `tsc -b` / `lint`（0 error）/ `build` / `smoke` 全绿。
- **预防**：① **凡是在 JS 里参与高度/尺寸计算的 CSS 值，都应该是"量出来的"而不是"抄一份常量"**——
  本项目已多次踩"CSS 改了、JS 常量没跟上"（E-2026-143 顶栏宽度预算、E-2026-129 线组几何）；
  ② 响应式/媒体查询改变尺寸时，**常量必然只在某一个断点成立**——这次的 5px 只在鼠标环境下正确；
  ③ 新引入的"档位/阈值"要顺手做一次**跨环境取值核对**（桌面 vs 触屏、宽 vs 窄、高 vs 矮），
  本轮正是靠"手机外壳 52 > 最小档 43"这一个不等式一眼定位；
  ④ 断言里不要写死函数签名（本轮 adj521 给 `settingsDefaultH` 加了一个参数，就把 adj492 的
  正则断言打挂了）——断言应钉**语义**（"用 rowPitch × SETTINGS_ROWS"）而不是形参表。

### E-2026-225 告警展开「正确写法」后内容超过视界，却没有滚动条（adj522）
- **场景**（用户报）："告警展开信息后，信息超过视界了，但没有出现滚动条。"
- **根因**：adj510 为了让"列表自己滚、头部固定"，做了两件事——关掉 body 的滚动
  （`.tool-dock-body:has(.problem-panel){ overflow-y: hidden }`）+ 给 `.problems-list` 加
  `flex: 1 1 auto; min-height: 0; overflow-y: auto`。但**高度链没有建立**：
  `.tool-dock-pane`（告警那一层）是普通 block（只有 `.pane-settings` 是弹性列），
  `.problem-panel` 高度因此是 auto（内容撑高）⇒ 列表的 `flex: 1 1 auto` 拿不到"受限高度"，
  `overflow-y: auto` **永远不触发**。于是内容超出后**既不滚也无人裁**，被
  `.tool-dock { overflow: hidden }` 直接切掉——不只是"没有滚动条"，
  展开的「正确写法」**根本看不到**（内容丢失，比缺滚动条更严重）。
  更根本的问题：adj510 的改动是"只加了滚动容器，没有同时给出让滚动容器生效的**受限高度链**"，
  而它又把原来的滚动容器（body）关掉了，属于"拆了旧的、新的没装好"。
- **解决**：
  1. `.tool-dock-pane.pane-problems { display: flex; flex-direction: column }` —— 补齐高度链
     （与 `.pane-settings` 同一手法）；
  2. `.problems-list` 的 `flex: 1 1 auto` 改为 **`0 1 auto`** —— 按内容取高、空间不够时可收缩；
     收缩后 `overflow-y: auto` 才真的出滚动条。（若用 `1 1 auto`，列表会被拉满到可用高度，
     "内容 < 可用"时 `scrollHeight` 等于**可用高度**，会把"内容自然高"的测量带偏 —— 充气式增长。）
  3. `.problems-head { flex: 0 0 auto }` —— 头部不参与收缩（滚到底也要能点到"收起"）；
  4. **删掉** `.tool-dock-body:has(.problem-panel){ overflow-y: hidden }`，让 body 恢复 `auto`
     作**兜底**：链万一再断，也是"能滚"而不是"内容被裁"（把失效模式从"丢内容"降级为"多一条滚动条"）；
  5. 测量跟着改：告警的"内容自然高"不再读 `pane.scrollHeight`（弹性列下它会退化成可用高度），
     改读 `PANE_PAD_H + 头部高 + 列表.scrollHeight`——三者都与当前 dock 多高**无关**，稳定且无反馈。
- **验证**：smoke 新增 3 条断言守住这条链（① pane 弹性列 + 列表 `flex: 0 1 auto` + `overflow-y: auto`
  + 头部不收缩；② 不再存在"关掉 body 滚动"的覆盖；③ 告警自然高改由 head + list.scrollHeight 量取）；
  `tsc -b` / `lint`（0 error）/ `build` / `smoke` 全绿。
- **预防**：① **"给容器加 `overflow: auto`"不等于"它会滚"**——必须同时确认它拿到了**受限高度**
  （父级是 flex/grid 且自己 `min-height: 0`，或有显式高度）；验证手段是问一句
  "这个元素的可用高度是从哪来的"；② 修"抄近路"时**不要先拆旧的滚动容器**——
  正确顺序是"新的先成立（能滚），再撤旧的"，否则一旦新的没成立就没有任何兜底
  （本轮正是先撤旧的、新的又没建立）；③ 失效模式的取向：**宁可多一条滚动条，也不要裁掉内容**——
  兜底容器要留在 `auto` 而不是 `hidden`；④ 用 `scrollHeight` 当"自然高度"探针时，
  先确认该元素**在当前布局下是否真的会溢出**（一旦它变成弹性容器，"溢出"就转移到了子元素上，
  读数会退化）；⑤ 断言要覆盖"用户能拿到内容"这一点（本轮补的断言钉的是**高度链**，
  因为链一断，滚动条和内容会同时消失）。

### E-2026-226 「建议高度」随"从哪一档切过来"而变——从最大切不正好、从最小切正好（adj523）
- **场景**（用户报）："告警、试听、导出、关于从最高切到建议高度时的建议高度并不合适，
  应该使用从最小切到建议高度时所计算的高度才正好。" —— 用户直接给出了"方向不同、结果不同"这一关键线索。
- **根因**：AUTO_FIT 的"内容自然高"取自 `pane.scrollHeight`，而
  **`scrollHeight === max(内容高, clientHeight)`**（内容放得下时它等于 clientHeight）。当时
  `.tool-dock-pane` 是 `flex: 1 1 auto`（**被拉伸到 dock 高度**）⇒ clientHeight = 当前 dock 高 − 外壳：
  - 从**最小**切建议：dock 很矮 ⇒ clientHeight 很小 ⇒ `scrollHeight` = **内容自然高** ✓
  - 从**最大**切建议：dock=460 ⇒ clientHeight≈417 > 内容 ⇒ `scrollHeight` = **417**（拉伸后的可用高度）
    ⇒ 建议档算成 `min(43+417, 460−8) = 452px`（几乎等于最大）✗
  即"测量值被**当前 dock 高度**污染"，同一个档位因来路不同而给出不同高度。
  代码注释里那句"`pane.scrollHeight` 不受当前可视高度影响，恒为内容自然高度"**是错的**，
  它掩盖了这个前提冲突（让 pane 填满高度 ↔ 用 pane.scrollHeight 当自然高，两者不可兼得）。
- **解决**：让 pane **按内容取高**，测量与 dock 高度彻底解耦——
  `.tool-dock-pane { flex: 0 0 auto }`（原 `1 1 auto`），设置面板与告警面板这两条**必须填满 dock**
  的 pane 各自显式覆盖回 `flex: 1 1 auto; min-height: 0`（它们不依赖这个读数：设置量的是行高，
  告警量的是"头部 + 列表 scrollHeight"）。顺带两个好处：① pane 盒子不再随 dock 变化 ⇒
  挂在其上的 ResizeObserver 不再因"拖高度/切档"而反复触发测量；② `flex-shrink: 0`（不压缩）⇒
  内容比 dock 高时由 `.tool-dock-body` 滚动兜底，而不是被裁掉。同时修正了 AUTO_FIT 注释里的错误论断。
- **验证**：镜像算式的脚本（跑完即删）——内容自然高 114px 时：
  旧语义"从最小切=157 / 从最大切=452（差 295px）"复现用户现象；
  新语义"两个方向都是 157 = 内容刚好装下" ✓。`tsc -b` / `lint`（0 error）/ `build` / `smoke` 全绿；
  smoke 新增 2 条断言钉住 CSS 契约（基类必须 `flex: 0 0 auto`、设置/告警两条必须显式 `1 1 auto`）。
- **预防**：① **`scrollHeight` 是"内容高"还是"可用高度"，取决于该元素当前是否被拉伸**——
  用它当"自然高度"探针前，先确认元素**没有被父级拉伸**（`align-self: stretch` / `flex: 1` /
  `height: 100%` 都会让它退化成 clientHeight）；这类"被测元素同时被布局拉伸"的组合是**结构性矛盾**，
  必须让其中一方让步（本轮让 pane 不参与拉伸）；② **"结果取决于操作顺序"是状态污染类 bug 的典型气味**——
  用户这次直接点出了"从最小切正好、从最大切不正好"，一句话就把范围锁到"测量依赖当前状态"；
  ③ 注释里的**绝对化论断**（"不受……影响"、"恒为……"）要当作待验证假设，而不是事实——
  本条的注释错误论断让问题多潜伏了两个版本；④ 单元/结构断言要能挡住"契约被改回去"
  （本轮把 pane 的 `flex` 契约写进 smoke）。

### E-2026-227 底栏页签一溢出，右侧的「高度档位 / 关闭」按钮被顶出可视区（adj525）
- **场景**（用户报）："底栏 dock 的页签栏，高度切换按钮和关闭按钮应该固定在右侧（如顶栏的主题、支持），
  其它页签在个数超过时可通过左右滑动显示出视界外的页签。"
- **根因**：页签与两个按钮当时**在同一个 `overflow-x: auto` 容器里**（`.tool-dock-tabs`，
  adj491 把它设成横向滚动兜底，并给按钮 `flex: 0 0 auto` 以求"不被压缩"）。
  但"不被压缩"抵挡不住"被**推出可视区**"：容器一横向滚动，内容整体右移，
  排在最后的档位按钮与 ✕ 就被送到滚动区之外，用户必须先滑到底才能点。
  —— 与顶栏 `E-2026-193`（「更多」按钮被 `overflow:hidden` 的工具条顶出视口）是**同一类结构性错误**：
  **"必须始终可见"的元素不能与"会溢出的内容"放在同一个滚动/裁切容器里**。
  `flex-shrink: 0` 只保证元素自身不变形，不保证它留在可视区内。
- **解决**：把结构拆成「**可滚的页签区** + **页签区之外的两个常驻按钮**」（与顶栏 adj453 同一手法）：
  - 新增内层 `.tool-dock-tabstrip`（页签都放这里）：`flex: 1 1 auto` + **`min-width: 0`**（关键：
    flex 项默认最小尺寸是内容宽，不加它就不会收缩、也就永远不会出现横向滚动）+ `overflow-x: auto`
    （触屏原生滑动，`-webkit-overflow-scrolling: touch`）→ 页签放得下时铺开、放不下时**在页签区内左右滑**；
  - 档位按钮 / 关闭按钮移到页签区**之外**、`flex: 0 0 auto`，间距交给父级 `gap`（删掉原先的
    `margin-left: auto` / `margin-right: 4px`：现在由页签区吃掉剩余宽度，不再需要靠 auto 推）；
  - `.tool-dock-tabs` 自身不再滚动（只留 `width: 100%` + 固定 38px 高），
    `role="tablist"` 随之移到页签区（它才是"页签的容器"）；滚动条继续隐藏（与顶栏观感一致）。
  - 宽度账（窄屏 360px 例）：容器内容宽 348 − gap 8 − 按钮 28+26 ⇒ 页签区收缩到 **286px** 并在内部横滚；
    两个按钮合计 54px 恒在右侧、永远可点。
- **验证**：smoke 新增 4 条断言——页签区 `min-width: 0` + `overflow-x: auto`；`role="tablist"` 挂在页签区上；
  两个按钮 `flex: 0 0 auto` / `flex-shrink: 0`；并用**结构断言**（源码里 `tool-dock-tabstrip` 出现在
  `tool-dock-size-btn` 之前、且两者之间含 `TABS.map` 与一个 `</div>`）钉住"按钮在可滚区之外"。
  `tsc -b` / `lint`（0 error）/ `build` / `smoke` 全绿。
- **预防**：① **区分"不被压缩"与"始终可见"**——前者是 `flex-shrink: 0`，后者要求元素**不在溢出容器内**；
  本轮两者被混为一谈，才让"已经加了 flex-shrink:0"给人"已经修好了"的错觉；
  ② **凡是"可滚动的条 + 常驻按钮"的布局，一律按"滚动区 + 兄弟节点按钮"两段式拆**——
  这已是本项目第三次同类修正（顶栏 adj453、底栏 adj491 的 ✕、本次），写布局时可直接套用；
  ③ 布局护栏要断言**结构**（谁在谁的容器之外）而不只是样式属性——样式对但 DOM 位置错，问题照旧
  （本轮补的结构断言正是为此）；④ 把"窄屏下逐个控件是否可点"列入手动验收项（宽度取 360/390/430）。

### E-2026-228 手机端数字输入框没有原生上下小按钮 + "输入即钳制" ⇒ 数字根本改不动（adj526）
- **场景**（用户报）："手机上显示设置里的数字输入框无上下调节小按钮，而输入范围又有限定，
  导致数字无法正常修改，请修改其它调整方式。"用户并给出设想：数字（含预览比率、字号）用**一种统一的方式**
  ——按住数值出现滑条、上下滑动调节。
- **根因**（两条叠加，缺一都不至于"改不动"）：
  1. **手机浏览器不显示 `type=number` 的原生 spinner**（iOS Safari 一直如此）⇒ "上下小按钮"这条退路没有；
  2. `NumInput` 是**受控 + 每次按键立即钳制**：
     `onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.round(n)) }}`，
     而部分字段有范围（编辑器字号 10~26、段层间距 10~80）。想输 `50`：打到 `5` 就被钳成 `10`，
     输入框立刻跳回 —— 数字**永远拼不出来**。
  - 附带发现：范围定义**分散**——字号在 `clampEditorFontSize`、段间距在 `clampGap`、
    而边距/间距/声部间距的范围其实**早就存在**于引擎 `GUIDE_LIMITS`/`GUIDE_LIMITS_EX`
    （预览虚线拖拽用的同一张表），设置面板却没用它、也不限范围。
- **解决**（用户选定"按住拖数值 + 修好输入"；范围复用引擎表）：
  1. **输入不再即时钳制**：`NumInput` 改为**本地草稿文本**（`draft`），`onChange` 只写草稿、
     **失焦 / 回车**才 `commit()`（钳制 + 取整）；空串视为放弃编辑（不把 0 写进配置）。
     另加 `inputMode="numeric"`（手机弹数字键盘）与 `enterKeyHint="done"`。
  2. **`−`/`+` 步进钮 + 按住连续**：`useHoldRepeat`（长按 420ms 后每 90ms 一步，松手那次 click 被吃掉）。
     桌面保留原生 spinner，故按钮用 `@media (pointer: coarse)` **只在触屏显示**（不改变桌面观感）。
  3. **按住数值上下拖**（用户设想的统一方式，实现为"按住拖"而非弹滑条）：
     新增 `ui/numberScrub.ts`（**纯换算** `scrubTarget`：上拖增大、每 8px 一档、横向位移超 24px 转 ×10 粗调、
     有范围则钳制、**无范围只做相对增量**）与 `ui/numberScrubGesture.ts`（手势 + 两个 hook）。
     接线处：设置里的数值输入框（`NumInput`）、顶栏**预览比率**与**编辑器字号**（新组件 `ui/ScrubValue.tsx`）。
     触屏**先长按 250ms** 才进入调节——否则在可滚动的设置面板里，手指落在数值上想滚页面就滚不动了
     （长按期间位移 > 10px 即判定为"滚页面"并放弃调节；接管手法是长按成功后挂 `touchmove` preventDefault，
     因为 `touch-action` 中途改不了、`preventDefault(pointermove)` 又拦不住原生滚动）。
  4. **范围"单一来源"**：新增 `ui/numFieldRanges.ts`，谱面字段**逐项引用**引擎
     `GUIDE_LIMITS`/`GUIDE_LIMITS_EX`（不抄数字），字号用 `EDITOR_FONT_SIZE_RANGE`，
     预览缩放把原先写死在 `setPreviewZoom` 里的 50/200 提为导出的 `PREVIEW_ZOOM_RANGE`（两处共用）。
  5. 文案入 `brand/copy.ts` 的 `numCopy`（步进钮 title / 拖动提示）。
- **验证**：smoke 新增 **14 条 adj526 断言**——纯换算 8 条（上下方向、不足半步不动、粗调 ×10、可关粗调、
  步长按字段、有范围钳制、无范围相对增量且允许负值）、范围来源 3 条（逐项等于引擎表、字号范围、粗调阈值）、
  结构护栏 3 条（草稿提交式输入、`inputMode`/`enterKeyHint` 与拖动/步进接线、步进钮只在粗指针显示、
  顶栏两处值用 `ScrubValue`、缩放范围单一来源）。`tsc -b` / `lint`（0 error，27 warnings == 基线）/
  `build` / `smoke` **ALL SMOKE TESTS PASSED ✅**。
- **预防**：① **受控数值输入 + 立即钳制 = 带范围字段"打不进去"**——凡有 min/max 的受控输入，
  都必须"编辑期存草稿、提交时才钳制"（与 `E-2026-013` 那类"断言数值先推算"无关，这是**输入法交互**层）；
  ② **平台能力不能假设**：`type=number` 的原生 spinner 在移动端并不存在，凡依赖它的调节方式都要有替代路径
  （本轮给了"步进钮 + 按住拖"两条）；③ **"统一交互"先找现成的单一定义**：范围不该新造一张表——
  引擎 `GUIDE_LIMITS` 已经在给预览虚线用，本次直接引用并用断言逐项比对，避免第二次"两处各写一份"；
  ④ **在可滚动容器里做拖拽手势，必须给"滚动"留通道**（长按门槛 + 阈值判定），否则会把面板滚动弄坏
  ——这与 `E-2026-208`（触屏拖不动）是同一枚硬币的另一面；⑤ 纯换算与手势**分文件**，
  纯函数才能被 smoke 直接断言（`numberScrub.ts` 零 React/DOM）。

### E-2026-229 手机上「高度档位按钮」与「关闭按钮」看着分得很开（旧修复的副作用）（adj527）
- **场景**（用户报）："高度切换按钮与关闭按钮在手机上看分得比较开，需要再靠近一点。"
  同一条反馈里还要求"页签按钮宽度缩小一些，刚好放得下 5 个"。
- **根因**（分开看是两件事，第二件是**旧修复的副作用**）：
  1. **页签放不下 5 个**：每个页签 `padding: 5px 10px` ⇒ 单签 ≈ 67px，5 个 + 间距 ≈ 347px，
     加栏开销（内边距 12 + 档位钮 28 + ✕ 38 + 间距）≈ **420px 以上**，而手机宽 360/375/390
     ⇒ 页签区必然横滑，第 5 个"关于"默认在视界外。
  2. **两个按钮显空**：`E-2026-208/adj491` 为"手指点不中 ✕"把粗指针下的内边距加到
     `10px 14px` —— **横向 padding 同时把视觉盒子撑宽了**：✕ 字形只有 ~10px，盒子却有 ~38px，
     于是它与左侧档位按钮之间凭空多出十几像素的空白。**扩命中区用了"撑大盒子"这种有副作用的手段**。
- **解决**：
  1. 页签横向内边距 **10 → 7**、图标与文字间距 **5 → 4**、页签区间距 4 → 3、栏内边距 6 → 5
     ⇒ 单签 60px、"常规手机宽（≥370px）"即可整栏放下 5 个；再加一条
     `@container (max-width: 400px)` 把内边距收到 **5px**（单签 56px ⇒ 全栏 ≈354px），
     **360px 的机器也放得下**；比这更窄才回落到横滑兜底（不丢页签）。
     只动横向内边距，边框/圆角/字号/行高不变 —— 视觉仍与顶栏按钮同族。
  2. ✕ 改为 **"视觉盒子只留小内边距（`6px 5px`）+ 命中区用隐形 `::before` 向上下扩 7px"**：
     按钮彼此贴近了，而命中区（≈26×42）**比原来还大**。关键约束：**只向上下扩、不向左右扩**
     —— 向左右扩会吃掉相邻档位按钮的命中区（谁在后、谁在上层，谁先命中）。
- **验证**：smoke 更新/新增 3 条断言（旧的 `padding: 10px 14px` 断言按新做法改写为"隐形 ::before 上下扩"；
  页签紧凑档 7px；≤400px 再收紧档 5px）。`tsc -b` / `lint`（0 error）/ `build` / `smoke` 全绿。
- **预防**：① **扩大命中区 `要"加覆盖层"，不要"加 padding"**——padding 会改变元素的视觉尺寸与占位，
  在有相邻控件的条里会把它们推开（本条正是如此）；本项目已有正确先例：
  `E-2026-208/adj493` 给分屏线与分隔条用 `::before` 向两侧扩 12px。**扩的时候还要想清楚"扩到谁的地盘上"**
  （重叠命中区由层级/DOM 顺序决定）；② **一排 N 个控件的条要在设计时就写出"宽度账"**（本文件与 CSS 注释里
  都留了算式），否则每次加元素/加内边距都会悄悄把最后一个挤出视界（同族教训 `E-2026-193` 顶栏按钮）；
  ③ 紧凑化时**只收横向、不收纵向**——纵向尺寸直接关系到手指命中高度，横向才是"排不下"的主要矛盾；
  ④ 窄屏还有一层兜底手段（"再收紧一档"的容器查询），比"一刀切全局变小"更好：
  宽屏保持与顶栏一致的外观，窄屏才压缩。

### E-2026-230 告警面板「从最大切建议」的高度仍不对（同一坑第三次：读数被可用高度充气）（adj528）
- **场景**（用户报）："底栏 dock 在告警时，最高切建议时还是没有按最小切建议时计算的高度设置，请修复。"
  —— `E-2026-226`（adj523）修过同一症状，但那次只覆盖到"有告警且列表已展开"的路径。
- **根因**：告警那条 pane 必须**填满 dock**（`.pane-problems` 是弹性列——列表要拿到受限高度才能滚，
  见 `E-2026-225`），于是 **`pane.scrollHeight` 在"内容不足以撑满可用高度"时等于 clientHeight
  （= 可用高度）**，被"dock 当前多高"充气。adj522 把读数改成 `头部 + 列表 scrollHeight`，
  但那条分支外面写着 `if (!head || !list) return pane.scrollHeight` —— 两种情况会掉进污染分支：
  ① **0 条告警**（面板渲染 `.dock-empty` 占位，没有 head/list）；
  ② **面板被"收起"**（`open === false` 时只渲染头部、不渲染列表）。
  于是"从最大切建议"（此时 pane 已被拉高）量到虚高的内容自然高，而"从最小切"量到的是真值 ⇒ 两值不同。
  **本质教训（第三次复发）**：只要"被测元素会被布局拉伸"，用它的 `scrollHeight` 当"内容自然高"就不可靠；
  逐个分支去修读数**永远覆盖不全**（这次就是漏了两个分支）。
- **解决**：**换成"数据 × 单行实测"，彻底不读任何总量**——新增 `ui/dock/problemsHeight.ts`（纯函数 + 常量单一来源）：
  · 行数 ← **数据**（`summarizeProblems().total`，即渲染出的行数），不来自布局；
  · 单行高 ← 实测 `.problem-line`（`.problems-list` 里的**行盒子**，内容尺寸；**不含**展开的「正确写法」——
    那是它的兄弟节点）；
  · 面板头 / `.dock-empty` 占位块 ← 实测各自元素（都是内容尺寸的弹性项）；
  · 收起态（只剩头部）按 `内边距 + 面板头`；0 条按 `内边距 + 占位块`；超 4 行按 4 行。
  `ToolDock` 的高度常量（`PANE_PAD_H`/`ROW_H`/`PROBLEMS_HEAD_H`/`PROBLEMS_MAX_VISIBLE_ROWS`）
  与 cap 算式**一并引用该模块**（不再各写一份），式子也因此可被 smoke 直接断言。
- **验证**：smoke 新增 **7 条 adj528 断言**——0 条告警 = 内边距 + 占位行（**不预留面板头/4 行**，正是用户看到的症状）、
  n 条 = 内边距 + 头 + n×行高、超上限按 4 行、收起态只算头、缺测时回落常量不产生 0/负数、
  cap 对算式幂等；外加结构护栏"ToolDock 常量与算式同源"与"告警路径**不得再出现 `scrollHeight`**"。
  另更新 2 条受影响旧断言（adj522 的 `list.scrollHeight` 断言、adj524 的常量位置断言）。
  `tsc -b` / `lint`（0 error，27 warnings == 基线）/ `build` / `smoke` **ALL SMOKE TESTS PASSED ✅**。
- **预防**：① **同一个 bug 修到第三次，就该换"量法"而不是继续补分支**——前两次分别在修
  `pane.scrollHeight`（adj523）与"补 head+list 分支"（adj522），这次直接改成"数据驱动的纯算式"，
  与布局彻底解耦；② **"内容自然高"这类量，优先用"数据 + 单元素内容尺寸"算出来，而不是用容器总量量出来**
  ——容器总量永远受"当前可用高度"影响（`scrollHeight = max(内容, clientHeight)`），
  而单元素的内容尺寸（如一个行盒子的 `getBoundingClientRect()`）不受影响；
  ③ **`scrollHeight` 用之前先问"这个元素会不会被拉伸"**（`E-2026-226` 已记，本条是它的三度复发，
  说明"注释里写清楚"不足以防住，**要用断言把危险读数从代码里禁掉**：本轮就加了
  "告警路径不得出现 `scrollHeight`"的结构断言）；④ 该分支的**旁路（`if (!x) return 兜底`）最容易被漏**
  ——"0 条"与"收起"都是旁路；写这类分支时把**所有渲染分支列一遍**（`ProblemPanel` 有：占位 / 面板头+列表 / 收起）。

### E-2026-231 预览缩放实际是「平方关系」⇒ 按宽度适配算出的比例越窄越偏小（adj529）
- **场景**（用户报）：① "预览区越窄，按页宽算出的比率显示差异越大（缩得更小）。"
  ② "缩进到更多菜单后，双击预览比率无效。"
- **根因**（两个独立问题，同一轮发现）：
  1. **平方关系**：`.preview-zoom-scale` 同时声明了 **`width: PREVIEW_W × z%`** 与 **`zoom: z%`**，
     而 **CSS `zoom` 会把元素自己声明的 `width` 再乘一遍**（MDN `zoom` 示例写得很直白：
     `width: 25px` + `zoom: 200%` ⇒ 圆直径 **50px**；`zoom: 2.9` ⇒ 72.5px）。
     于是实际渲染宽 = `760 × z²`（**平方**）：可用宽 952px 时 z=125% 渲染 1187px（偏宽），
     而可用宽 552px 时 z=73% 只渲染 **405px**（容器的 73%）——**越窄差得越多**，正是用户看到的现象。
     反证作者本意是线性：拖拽换算 `scale = (PREVIEW_W / page.width) × z%` 用的就是线性模型，
     `width` 上那次乘法是多余的（且当年把该 bug 一起写进了注释"实际显示宽 = PREVIEW_W × zoom"）。
  2. **折叠菜单里双击无效**：「更多」下拉里那一行被写成**纯文本 `<span>{previewZoom}%</span>`**，
     工具条折叠后上一轮加的 `onDoubleClick` 根本不在那棵 DOM 里，连"按住拖"也一起丢了。
- **解决**：
  1. `width` 只写**基准宽**（`width: PREVIEW_BASE_W`），缩放全部交给 `zoom`
     ⇒ 实际显示宽 = `760 × z%`（**线性**），"按宽度适配"的反算 `z = 可用宽 / 760` 因此精确。
     `zoom` 必须保留——虚线线宽、播放头等**用 px 定位的子元素**要靠它一起缩放（它们的位置已是百分比）。
     顺带把**手动缩放从 adj51 起的"平方"也修了**（50% 实际 1/4、200% 实际 4×）；现在比例 = 显示宽，名字与含义终于一致。
  2. 改用与工具条**同一个 `ScrubValue` 组件**（拖动 + 双击 + 方向键 + 提示全等值），样式类 `.menu-scrub-val`
     保持下拉里的等宽小字号。**不复刻"简化版 JSX"**——折叠版若与主版交互不同，必然丢功能。
- **验证**：smoke 新增 2 条护栏——① 预览缩放必须**线性**渲染（`width: PREVIEW_W` 且**不得**出现
  `PREVIEW_W * (previewZoom / 100)`）；② 「更多」下拉里的比率也必须是 `ScrubValue` 且接 `onDoubleClick`
  （`<ScrubValue` 共 3 处）。另更新 2 条受影响旧断言。
  `tsc -b` / `lint`（0 error）/ `build` / `smoke` **ALL SMOKE TESTS PASSED ✅**。
- **预防**：① **`zoom` 与 `transform: scale()` 的坐标语义完全不同**——`scale()` 不改布局、也不影响声明值；
  `zoom` 会**参与布局并缩放声明值**。两者混用时"再手动乘一次比例"就是经典的重复缩放
  （本条即 `width×z` + `zoom:z` = `z²`）；② **凡"比例类"功能上线前，至少在 50% / 100% / 200% 三档量一次实际像素**
  ——平方关系在 100% 附近几乎看不出来（±10% 只差约 10%），偏离越远越离谱，极易长期潜伏
  （该 bug 自 adj51 潜伏到本轮）；③ **同一份换算在代码里出现两次就要对齐口径**：渲染用平方、拖拽换算用线性
  ——"两处口径不一致"本身就是一个该被断言的信号（本轮已把线性写成断言）；
  ④ **控件折叠进"更多"菜单时要检查交互是否等值**：折叠版常被写成"简化版"（这里退化成纯文本 span），
  于是拖动/双击/提示一起消失；做法是**复用同一个组件**，而不是复制一份简化的 JSX。

### E-2026-250 过滤"每敲一个字就把整棵目录树重走一遍"⇒ 明显卡顿；改"走一次建索引 + 内存过滤"（adj543）
- **现象**（用户反馈）："过滤筛选的速度很慢"。
- **根因**：过滤实现是**每次输入都调用一次 `searchWorkspaceJps`**（debounce 200ms 只是排队，省不掉遍历）——
  每次都是一轮完整递归：每层目录一次 `dir.values()`（磁盘/FSA 调用），大工作区下每敲一个字都要等整轮走完。
- **解决**：**先建一次索引，之后只在内存里过滤**——
  首次过滤走一次整树（上限放大到 `maxHits 3000 / maxEntries 30000`，因为只走一次），把全部 `.jps`
  存进 `indexRef`；同一面板会话内之后的每次输入只是 `idx.filter(matchesQuery)`（纯字符串比较）。
  索引在**写操作后**（`invalidateCache`）与**每次打开面板时**作废，下次过滤重建。
  首次建索引期间显示「正在读取工作区…」，避免那一下看着像空列表。
- **实测**（180 份 `.jps`）：首次输入 **60ms**（建索引）→ 之后 **12ms / 6ms**，一键 `*` 列出全部 180 份 **7ms**。
- **预防**：① **"按输入实时过滤"的功能，遍历/IO 只做一次，其余走内存**——
  把"数据获取"和"筛选"分开，debounce 不能替代缓存；② 缓存要**明确失效时机**（写操作 + 重新打开），
  且失效点集中在一处（本例 `invalidateCache`），别散落在各个操作里；③ 慢查询要有**首帧反馈**
  （"读取中…"），否则用户看到的是"点了没反应/什么都没有"。

### E-2026-249 面板"内容一直闪、点目录/文件没反应"= 我引入的**无限刷新循环**（普通函数进了 useCallback 依赖）（adj540）
- **现象**（用户反馈）：打开工作区页签后，面板内容一直在闪动（像是反复刷新），此时点目录或文件**没有响应**。
- **根因**：上一轮做"目录列表缓存"时加了 `invalidateCache`，它是**组件体内的普通函数**（每次渲染都是新引用），
  却被写进了 `refresh` 的 `useCallback(..., [showNotice, invalidateCache])` 依赖数组：
  `invalidateCache` 每次渲染变 → `refresh` 每次渲染变 → 依赖 `[active, refresh]` 的"面板激活"effect **每次渲染都重跑** →
  effect 里 `setWs/setPerm/setEntries` 又触发渲染 → **无限循环**。
  列表被反复重建 ⇒ 视觉上"一直在刷新"；点击落在**正在被替换的节点**上 ⇒ 表现为点不动。
- **定位**：`MutationObserver` 数面板 2.5 秒内的 DOM 变动次数（修复前成百上千，修复后 **0**）；
  再点目录/文件验证响应（面包屑变 `/杂记/`、底栏收起）。
  ⚠️ 其实 **lint 早就报了**——`exhaustive-deps` 那两条告警正是这里，我当时把它当"基线噪声"放过了。
- **解决**：`invalidateCache` 改 `useCallback(() => {...}, [])`；写操作（改名/新建/另存/移动/删除）在**真正改动处**显式调用；
  关闭面板写路径记忆改读 `pathRef.current`（不把 `path` 塞进依赖，否则每次导航都会重跑 effect）。
  修后 lint 基线 28 → **26** 条（正好是那两条），并补了一条 smoke 断言守住"依赖里只有稳定引用"。
- **预防**：① **进 `useCallback`/`useEffect` 依赖的必须是稳定引用**（store action / `useCallback([])` / ref）——
  组件体内定义的普通函数**一律不许进依赖数组**；② `exhaustive-deps` 告警**不许当基线噪声忽略**：
  它是这类死循环最直接的线索，看到就要读一遍依赖链；③ 面板/列表类组件凡涉及"重复读取或刷新"，
  交付前先跑一次 **DOM 变动计数**（MutationObserver）自查，>0 就要查是不是循环。

### E-2026-248 「加粗图标」用膨胀把内部细节糊平了，且原图被覆盖无法还原；顺带记"图标发虚"的三条真因（adj541/542）
- **现象**（用户反馈）：底栏的**展开/收起**图标"有点糊"。
- **真因（三条叠加）**：① 源图 alpha 过渡像素过多（`底栏展开.png`：实心 104 / 过渡 176，而对照 `菜单.png` 是 204/24）
  ⇒ 缩到 16px 时描边发虚；② 悬浮按钮写了 `opacity: .92` + 用灰色 `--jp-text-secondary`，叠上去更"虚"；
  ③ 图标按 **14px** 渲染，32px 源在 DPR 2 / 2.75 / 3 下分别是 1.14× / 1.375× / 1.5×，**都不是整数比**。
- **处理**：alpha 走"软化阈值 + 二值化"（形状实心、只留极窄过渡）；渲染尺寸统一 **16px**（DPR2 下 1:1、DPR1 下 2:1，都是整数缩放）；
  去掉 `opacity`、改用主文字色；三个新图标（`工作区` / `底栏展开` / `底栏收起`）RGB 归一到纯黑（adj457 口径）。
- **我自己的失误（重点）**：为了让描边更"实"，对 `底栏展开.png` 做了 **1px 形态学膨胀**，
  把框内那三个小点糊成一条实心条 —— 结果**展开/收起两个图标长得几乎一样**，
  而 `public/icons/*.png` **尚未入 git**，原始 alpha 已被覆盖、**无法回滚**，只能按原设计意图（圆角框 + 三个小点）
  用 GDI+ 重画一版。
- **预防**：① **动用户素材前先备份**（哪怕嘴上说"临时处理"）——这次没备份，只能重画；
  ② 图标"加粗"**不要用形态学膨胀**（不可逆）：先二值化看效果，不够再想别的；
  ③ 改完必须**同尺寸 + 真机 DPR（16px @2.75）对照渲染**，并且**和相邻已有图标并排比**——本次一并排就看出两个图标重了；
  ④ 自查页读的是 `dist/icons/`（构建产物）：改完 `public/` 必须重新构建或同步，否则验证的是**旧图**（本轮被这个坑了一次）。
- **附带（用户新要求 adj542）**：行号栏宽度改为按**当前可见的最大行号**算（默认两位宽，滚到 4 位数才加宽）——
  之前按"整篇行数"算，1000+ 行的谱一打开就占 4 位宽度。实测：行 1 处 46px，滚到 1498–1500 行时 51px。

### E-2026-247 用户报「过滤 `*` 列不出文件」——真机上是**旧包**（通配符是新版才有的），但"没搜到 vs 没搜完"这个坑是真的（adj540）
- **场景**（用户反馈）："过滤输入 `*`，按道理应列出工作区（含子目录）所有 `.jps`，但实现没有 .jps 文件列出"。
- **定位**：在**当前线上包**（`315182a`）上用无头 Chrome + OPFS 真目录实测：`*`、`*.jps` 都正确列出
  全部 3 个 `.jps`（含两层子目录），`*星*`/`甲`/`甲*` 也分别正确 ⇒ **代码没问题**；
  用户看到的现象与"通配符支持是 `315182a` 才加的、手机上仍是旧包"完全吻合
  （旧版按**子串**匹配，`*` 自然一个也匹配不到）。
- **但顺手查出一个真问题（预防性修）**：递归过滤设了上限（原为深度 6 / 条目 2000 / 命中 200），
  **超限时静默截断**——用户只会看到"少了很多文件"，而这与"工作区里本来就没有"在界面上**无法区分**。
  对一个"文件管理器"来说这是最坏的失败模式：**文件不见了，但不告诉你为什么**。
- **解决**：① `searchWorkspaceJps` 改为返回 `{ hits, truncated }`，上限放宽到**深度 10 / 条目 5000 / 命中 500**；
  ② 面板在 `truncated` 时弹提示「匹配项很多，先显示前 N 个（输入更具体的关键词可缩小范围）」，
  侧栏计数后加 `…`；③ smoke 加断言：`truncated` 字段、面板消费、以及**上限不得低于 10/5000**。
- **预防**：① **凡"遍历用户数据 + 有上限"的功能，必须把"截断"变成可见状态**——静默截断 = 数据丢失的观感；
  ② 用户报"功能没生效"时，第一步确认**他跑的是不是当前版本**（PWA 尤其容易停在旧包）：
  先在同一构建上复现，再改代码——本轮差点为一个不存在的问题改实现；
  ③ 反过来，即使代码是对的，也要问"用户为什么会这么以为"：`*` 这个直觉（列出全部）值得支持，
  而"上限/旧版本"这类解释必须能被界面自己说出来。

### E-2026-246 面板里的"弹出菜单"有两个坑：dock 的 `overflow:hidden` 会裁掉就地浮层、portal 后又会**溢出屏幕右缘**；以及"过滤=全工作区平坦列表"必须带上限（adj540）
- **场景**：用户要求 ① 工作区列表默认层级、加**过滤框**（过滤时列出整个工作区符合条件的 `.jps`，单列表便于快速打开）；
  ② 右侧**只留一个下拉按钮**，点它**弹出菜单**再选操作。
- **现象/根因①（浮层被裁）**：`.tool-dock` 是 `overflow: hidden` 的容器（adj498/adj525 为页签横滑定的），
  就地 `position: absolute` 弹出的菜单会被裁在 dock 里；内联展开（上一版做法）虽然不被裁，但会挤占列表行数。
  ⇒ 必须用 **`createPortal` 渲染到 `document.body` + `position: fixed`**，菜单锚在按钮**上方**（底栏在屏幕底部）。
- **现象/根因②（portal 后溢出屏幕）**：直接用按钮的 `rect.left` 定位时，因为侧栏贴在右边缘，
  菜单（宽 150）从 `left=296` 起算 ⇒ **右缘到 446，超出 390px 视口 56px**（实测数据）。
  ⇒ 定位时必须**夹进视口**：`left = clamp(r.left, 8, innerWidth - width - 8)`。
- **现象/根因③（递归过滤的防呆）**：过滤要跨**所有子目录**递归找 `.jps`，真实工作区可能有上千条目。
  没有上限就会在大目录上长时间卡住（用户以为"卡死"）⇒ 给 `searchWorkspaceJps` 加**深度 6 层 /
  访问 2000 条 / 命中 200 条**三个上限，并且**某一层读不动就跳过该层**（权限竞态）而不是整次失败。
  匹配口径：**大小写不敏感的子串**，文件名与**相对路径**都参与（于是"练习"能命中 `2.曲谱集/练习曲/…`）。
- **解决**：`createPortal` + 视口夹取 + 单个「操作▾」按钮（菜单含 保存/另存/新建/新建夹/改名/移动/删除，
  无勾选时后三项禁用）；过滤框 200ms debounce，命中结果显示**所在子目录**，点一条直接打开并收起底栏；
  搜索模式下不提供勾选（改名/移动/删除依赖勾选）。
- **验证**：无头 Chrome + 390px 视口 + OPFS 真目录：过滤「星星」→ 平坦结果 `🎼小星星.jps`+`2.曲谱集`、
  侧栏「匹配 1 个」；点结果 → 打开且底栏收起；菜单 7 项状态正确，`parentElement === BODY`，
  rect `left 232 / right 382 ≤ 390` 完全在视口内（修前 446）。
- **预防**：① **`overflow: hidden` 的容器里不要就地做浮层**（页面级 portal 才稳），但 portal 之后
  **必须自己做视口夹取**——"贴边元素 + 固定宽度浮层"是溢出高发组合；② 递归遍历用户目录**一定带上限与
  容错**（深度/条数/命中数 + 单层失败跳过），否则用户的大目录就是我们的死循环；
  ③ 过滤=平坦列表时，结果行必须**显示所在目录**，否则同名文件无法区分。

### E-2026-245 自造的二义交互（"点一下=选中，再点=打开"）与"一列塞 6~8 个按钮"都被用户当场否掉——改用**复选框**与**分组下拉**（adj540）
- **场景**：把工作区面板做成"左列表 + 右操作按钮"后，我为了给破坏性操作一个明确的作用对象，
  把交互定成「点一下行 = 选中，再点同一行 = 打开/进入」；右侧按钮则把 打开/改名/移动/删除/新建/存到此处
  六个平铺在一列里（窄屏再压扁到 ~21px）。
- **现象（用户反馈，两条都对）**：
  1. **"没有新建、保存、另存操作按钮"**——真机上那一列 6 个按钮**底部被裁**（窄屏覆盖写在基础规则之前被盖掉，
     见 E-2026-244），用户实际只看到前 4 个；而且确实缺"新建谱面 / 保存"这两个语义；
  2. **"可以考虑使用下拉按钮的方式以避免太多按钮不便操作"**、"文件列表里的文件名前应该有个复选框"
     ——我的方案把简单事情做复杂了：**每次打开文件都要点两下**，而按钮数量靠"压扁"来塞。
- **解决**：
  ① **每行加复选框**（用户建议）：勾选 = 选中（供 改名/移动/删除，**支持多选/批量**），
     **点名字/图标 = 打开/进入** —— 两件事各归其位，不再需要"点两次打开"；
  ② **右侧改分组下拉**（用户建议）：默认只有 打开 / 保存▾ / 新建▾ / 操作▾ 四个（同一时刻只展开一组，
     最多 5 个按钮），按钮**高度与其它按钮一致**（不再压扁）；子项：保存▾→保存/另存，
     新建▾→新建谱/新建夹，操作▾→改名/移动/删除；
  ③ 补上缺的语义：**保存**（写回绑定的工作区文件；未绑定时自动转为"另存"，不留死路）、**另存**、**新建谱**（用
     `src/samples/未命名.jps` 模板写一份并打开）；
  ④ 批量移动/删除**逐个执行并汇总**（`opPartial` 如实报"几项成功、几项失败+原因"，不假装全成功）；
  ⑤ 窄屏菜单进一步简化（用户要求"主要操作以工作区操作按钮为主"）：只剩
     工作区 / 打开示例 / 粘贴源码导入 / 试听播放 / 导出。
- **验证**：无头 Chrome + 390px 手机视口 + OPFS 真句柄：① 每行复选框存在；② **点目录名直接进入**
  （面包屑变化确认，不再需要两下）；③ 勾两个文件 → 侧栏「已选 2 项」、操作▾ 里 改名 禁用 / 移动 可用；
  ④ 删除确认文案为「永久删除选中的 2 项？删了就找不回来了」→ 执行后文件树确认两项消失、其余不动。
- **预防**：① **别自己发明"点一下选中、再点打开"这类二义交互**——移动端已有共识：**点名字=打开、
  复选框/长按=选中**；② **"按钮太多"不是靠压扁解决的**——先问"能不能分组/收进下拉"，压扁只会同时失去
  可读性与可点性；③ 破坏性操作的**作用对象必须可见**（复选框 + 已选条数），否则用户不敢按；
  ④ 用户报"没有某个按钮"时，先怀疑**它被挤出可视区**（截图量一遍），而不是先怀疑没实现。

### E-2026-244 窄屏 CSS 覆盖写在了基础规则**之前**（同级"后者胜"⇒ 白写）；新图标 RGB 不是纯黑触发既有断言；探针桩权限打实例而非原型（adj540）
- **场景**：按用户要求把工作区面板改成"左列表 + 右按钮"、窄屏隐藏页签图标、并收紧右侧按钮列。
- **现象①**：窄屏下右侧 6 个按钮里的最后一个（「存到此处」）被裁在可视区外；把 `padding`/`font-size`
  改小后**数字几乎没变**（`scrollHeight` 208 → 202）。根因：这些窄屏覆盖写在了 `@container` 块里，
  而该块**位于文件靠前位置**，下面的 `.ws-side-btn { padding: 6px 4px; font-size: 12px }` 基础规则在它之后
  ⇒ **同级选择器"后写的赢"**，覆盖被基础规则盖掉。真正让按钮变高的还有**继承的行高 1.6**
  （11×1.6≈18 + padding 8 + 边框 2 ≈ 28px），所以必须显式压 `line-height`。
  **解决**：把窄屏覆盖移到**所有 `.ws-*` 基础规则之后**（文件末尾），并补 `line-height: 1.25` ⇒ 每签 ≈21px，
  6 个按钮整列可见（实测 `scrollHeight === clientHeight === 181`）。同时给 `.ws-side` 加
  `overflow-y: auto` 作兜底（用户把底栏压到极矮时按钮仍可达）。**并写成 smoke 断言**：
  「`.ws-side-btn { padding: 3px 2px` 的下标必须大于基础规则的下标」——这条断言专门防"以后又把它挪上去"。
- **现象②**：新增 `public/icons/工作区.png` 后，既有的 adj458 断言（"全部图标的形状像素均为纯黑"）报错
  （实测该图 271 个形状像素全是灰值 50/51/85…）。根因：图标**以 CSS mask 用 alpha 通道**绘制，
  RGB 本身不参与渲染，但项目约定"文件层面统一纯黑"，并逐张解 PNG 核对（adj457）以防"下一批又混进灰值"。
  **解决**：把该 PNG 的 RGB 归一化为 `(0,0,0)`、**alpha 原样保留**（32×32、271 个形状像素不变，
  渲染效果完全一致）——顺带证明这条断言确实在起作用。
- **现象③**（测试方法坑）：为验证"重新授权"视图，先给拿到的目录句柄打 `queryPermission` 实例属性 ⇒
  面板查权限时用的是**从 IndexedDB 反序列化出来的另一个句柄对象**，打的桩根本没生效（视图不出现）。
  **解决**：改打 `FileSystemDirectoryHandle.prototype`。
- **预防**：① **CSS 窄屏/主题覆盖一律放在对应基础规则之后**（或用更高特异性）——"改了没效果"先看层叠顺序，
  别急着调数值；② **行高是"按钮高度"的隐形大头**（继承 1.6 时 `font-size` 11px 也能撑到 28px），
  压缩按钮高度要显式写 `line-height`；③ **图标是"纯黑 + alpha"的资源约定**，新图先归一化再提交；
  ④ **在页面里给对象打桩要打原型**（原型方法才覆盖得住"从存储反序列化出来的新对象"）；
  ⑤ 把"顺序类陷阱"写成可执行的断言（比较下标），比注释更管用。

### E-2026-243 把「工作区」做成 dock 面板时踩到两条坑：pane 缺"受限高度链"⇒ 页脚主按钮被挤出可视区；以及误用"提示 + 按钮同一行"在窄屏换行（adj540）
- **场景**：用户要求把文件操作（打开/保存/另存/重命名/移动/删除）集中到工作区，并**集成进底栏 dock**
  以保持一致的操作行为（同「试听/导出/设置/关于」）。
- **现象①**：390px 手机视口下，面板底部的「新建文件夹 / **保存当前谱到此处**」看不见——要滚动才够得到。
- **根因①**：`.tool-dock-pane` 基类是 `flex: 0 0 auto`（**按内容取高**，adj523 为 AUTO_FIT 定的），
  而 `.ws-panel` 写了 `height: 100%`——父高是 auto ⇒ 这个 100% 等于没写，面板随内容长高，
  内容一多就把页脚推出 `.tool-dock-pane` 的可视区（pane 自身 `overflow-y: auto`，于是变成"滚动才能看到主按钮"）。
  **正确做法**：像 `.pane-problems`（adj522）那样把 pane 变成弹性列容器（`display:flex; flex-direction:column;
  flex:1 1 auto; min-height:0`），受限高度链才建立：**列表内部滚动、页脚常驻**。
- **现象②**：同一屏上页脚那行「只列出文件夹与 .jps 文件」提示 + 两个按钮放不下，换行后又把按钮挤到下一行。
- **解决**：① 新增 `.tool-dock-pane.pane-workspace` 的受限高度链（并把 `.ws-panel` 改为
  `flex: 1 1 auto; min-height: 0`）；② 窄屏 `@media (max-width: 520px)` 隐藏该提示文字、把列表最小高度从
  120px 调到 72px，保证两个主按钮留在可视区内。两条都写进 smoke 断言防回归。
- **验证**：无头 Chrome + 390px 手机视口逐屏截图确认「新建文件夹 / 保存当前谱到此处」在**不滚动**时可见，
  列表自身可滚（截图对比修前/修后）。
- **预防**：① **dock 面板要沿用既有的"受限高度链"套路**——只要面板里出现"列表滚动 + 底部常驻按钮"的结构，
  就必须给 pane 加弹性列容器，否则 `height:100%` 是空转；这条在 `.pane-problems` 里已有先例，做新面板时先照抄；
  ② **"一行里塞提示 + 按钮"在窄屏必然换行**：提示是"锦上添花"的话，窄屏直接隐藏，别让它把主按钮顶走；
  ③ 又一条"**只有截图才能发现**"的问题：DOM 断言全绿、布局却把主按钮藏在滚动区外——
  凡"底部有主操作"的新面板，验收必须**在窄屏截一张图**。

### E-2026-242 以为「重命名/移动」能用 `FileSystemHandle.move()`、以为「删除」能撤销——两条都不成立，故必须自己实现且默认保守（adj540）
- **场景**：用户要求工作区里支持 打开/保存/重命名/移动/删除。
- **根因（两条 API 事实，与本机实测 + 规范一致）**：
  1. **`move()` 只对 OPFS 生效**：用户通过 `showDirectoryPicker` 选中的真实目录上**没有可用的 `move()`**
     （非 OPFS 的移动至今仍是 WICG 提案 [MovingNonOpfsFiles](https://github.com/whatwg/fs/blob/main/proposals/MovingNonOpfsFiles.md)、
     原 `MoveAndRename.md` 也只覆盖 OPFS）。⇒ 重命名/移动只能"复制 + 删除"。
  2. **FSA 没有回收站**：`FileSystemDirectoryHandle.removeEntry()` 是**永久删除**，删掉后浏览器/系统层面
     都无法恢复（连"移到废纸篓"都没有）。
- **解决**：
  ① `transferFile()`：读出 → 写到新位置 → **回读校验一致 → 才删原文件**；校验不一致就抛错并**保留原文件**
     （宁可留一个重复文件，也不能出现"两个都没了"）；
  ② 删除走 UI **二次确认**，并在文案里写明"删了就找不回来（浏览器文件 API 没有回收站）"；
  ③ 目录**只允许删空**（`removeEntry` 不带 `recursive`）：工作区是用户自己的文件夹，里面可能混着照片/文档，
     递归删会一起抹掉；非空时给明确提示；
  ④ 重名一律**拒绝并提示**，不静默覆盖别人的谱。
- **验证**：无头 Chrome + OPFS 真句柄跑完整流程（重命名/移动/新建空目录/删空目录/删文件），
  每步都用真实文件树核对；并实测"删非空目录被拒且目录完好"、"删除当前正在编辑的文件后解绑并提示
  （内容仍在编辑器里）"。
- **预防**：① **动手前先确认 API 的真实边界**（`move()` 是否为 OPFS-only、删除是否可恢复），
  别按"名字听起来该有"的能力写代码；② **破坏性操作一律"先确认、后执行、只删自己确定的东西"**：
  顺序上是"新副本校验通过 → 才删原件"，范围上是"只删空目录、绝不 recursive"；
  ③ 把这类约束写成 smoke 负向断言（例如**禁止出现** `recursive: true`、**禁止出现** `.move(`），
  比写在注释里可靠（注释会被忽略，断言不会）。

### E-2026-241 「手机上打开/保存不好用」不是 Android 的限制，而是我们**在移动端一律降级**；但降级的理由只对**文件选择器**成立，对**目录选择器**不成立（adj540）
- **场景**（用户需求）："网页版在手机上打开/保存体验差；希望有 app 壳能选一个目录当工作区"。到底要不要做壳，
  取决于 Android Chrome 的 File System Access API 能不能"选目录 + 写入 + 重启后仍有权限"。
- **根因**：`saveSupport.shouldUseFileInputPicker()` 只要 `coarsePointer` 就返回 `true` ⇒ **手机上一次都没走过 FSA 路径**。
  而这条降级的真实理由（adj405）是**文件选择器**：已安装的 PWA 里 `showOpenFilePicker` 可能"点了没反应"
  （同一个地址在浏览器里却正常），Android 上还有对应的已知回归
  （[Chromium 457203705：Android showOpenFilePicker broken since M142](https://issues.chromium.org/issues/457203705)）。
  我们把这个结论**扩大到了整个 FSA**，于是"目录选择器"这条本来可用的通道也被一起关掉了。
- **真机探针（临时页面 `/probe-fsa.html`，已删除）实测**（Android 10 / Chrome 151 / https）：
  ① 三个 picker 都是 `function`、`isSecureContext = true`；② 选目录后 `readwrite` **granted**，
  `createWritable/write/close` 成功且**回读一致**，目录可列举（27 项），句柄成功存入 IndexedDB；
  ③ **刷新后**句柄仍在，`queryPermission = prompt` →（用户手势内）`requestPermission = granted` → **仍可写**。
- **解决**：**不做 Android 壳**，改为纯网页「工作区目录」（adj540）：
  `store/workspace.ts`（选目录/授权/列目录含子目录/读写+回读校验）+ `docStore.workspacePath`（与
  `fileHandle`/`nativePath` 三者互斥）+ `dialogs/WorkspaceDialog.tsx`（面包屑/上级/进子目录/打开/另存到此处）。
  **不动**移动端原有的 `打开`/`另存为` 降级逻辑——那是为文件选择器踩的坑，与目录选择器无关。
- **验证**：① smoke 新增 `[122]` 11 条（`.jps` 判定、目录优先+时间倒序、路径规整/拼接/上级、三者互斥重置点、
  保存分支、UI 接线、子目录与"不静默失败"）；② 无头 Chrome（390px 手机视口）真跑一遍完整流程：
  桩掉 `showDirectoryPicker` 返回 **OPFS 真句柄** → 造"子目录 + 2 个 .jps + 1 个 .txt"→ 列表只出现
  **文件夹 + .jps**（`.txt` 被过滤）→ 进子目录后面包屑 `工作区/杂记/`、出现「上级目录」→
  「保存当前谱到此处」**真的写进了子目录**（回读文件内容确认）且对话框关闭；零控制台错误。
- **预防**：① **"某个 API 在 A 环境有坑"不等于"这一类 API 都有坑"**——降级判断要精确到**具体 API**
  （开文件 vs 选目录是两条通道、两套 Android 实现），一刀切会把能用的功能也关掉；
  ② **"要不要做原生壳"这类决定，先花 15 分钟写一个能真机点一下的探针页面**：本轮探针直接免掉了整个 Android 壳
  （Tauri Android 的 `cdylib`/ACL/单人维护插件/信任边界等一堆风险）；
  ③ 权限只在**用户手势内**可申请 ⇒ UI 必须"挂载时只查、给按钮让用户点"，探针的 `prompt → granted` 也证明了这一点；
  ④ 探针页要**真机、https、用户点**：控制台直接调用会因缺手势得到假阴性。

### E-2026-240 临时探针脚本两次自伤：GUI 子系统 exe 用 `&` 启动**不会等待**（备份/还原与探针写入竞态，改坏了用户真实的快捷方式）；复用宏时忽略了它把 `$0`–`$5` 当草稿寄存器（第二个 `CreateShortcut` 的目标被写坏）（验证流程）
- **场景**：验证"安装器把 `iJipu.lnk` 迁成「i记谱 iJipu」+ 备注"时，最可信的做法是在**真机**上跑真实的
  `IJIPU_FixShortcuts`。但 `$DESKTOP`/`$SMPROGRAMS` 是 **NSIS 只读常量**（`StrCpy $DESKTOP …` 直接报
  `cannot change constants`），没法把探针重定向到临时目录 ⇒ 只能动**真实桌面/开始菜单**，
  于是外层 PowerShell 先备份这两个 .lnk、跑完再还原。
- **现象/根因一（竞态）**：`& "$d\probe4.exe"` 之后 `$LASTEXITCODE` 是**空的**、桌面文件看起来也没变 ⇒ 原来
  **PowerShell 的 `&` 只对控制台程序等待，对 GUI 子系统的 exe 立即返回**。探针还在后台跑，"还原"就已经执行：
  它删掉 `iJipu.lnk` 并把备份放回；紧接着探针又 `CreateShortcut` + `IJIPU_FixShortcuts` ⇒ 用户真实的
  `iJipu.lnk` 最终指向 **`%TEMP%\ijipu-shortcut-probe\ijipu.exe`**（探针的假主程序，而且跑完就被删了），
  桌面与开始菜单各坏一个（等于给用户桌面留了个点不开的图标）。
- **现象/根因二（草稿寄存器）**：修回时写了 repair.nsi：`StrCpy $0 "<目标>"` → `CreateShortcut 桌面 "$0"` →
  `!insertmacro IJIPU_SET_AUMI` → `CreateShortcut 开始菜单 "$0"`，结果开始菜单那个 .lnk 的 target 变成
  `D:\主文件夹\桌面\8557320`（垃圾值）。原因：`IJIPU_SET_AUMI`（照抄模板 `SetLnkAppUserModelId`）内部用
  `r0`–`r5`，即 **`$0`–`$5` 全被当草稿寄存器写掉**，两次 Create 之间 `$0` 已不是目标路径。
- **解决**：① 探针一律 `Start-Process -Wait -PassThru` 并核对 `$ExitCode`；
  ② 修复脚本改成"两个 `CreateShortcut` 全部建完，再统一调 `IJIPU_SET_AUMI`"；
  ③ 把"本宏会写坏 `$0`–`$5`"写进 `IJIPU_SET_AUMI` 的注释（这是宏的公有副作用，必须让调用者看见）；
  ④ 事后用 NSIS 重建出**与安装器一致**的快捷方式（目标 `%LOCALAPPDATA%\iJipu\ijipu.exe` + AUMI
  `com.ijipu.app`），并逐个读回 `TargetPath`/`Description`/`System.AppUserModel.ID` 核对，同时确认
  桌面上那个 Chrome PWA 的「爱记谱 iJipu.lnk」**始终未被触碰**。
- **预防**：① **探针要动用户真实目录（桌面/开始菜单/注册表）时，先把"等待"做对**：GUI exe 必须
  `Start-Process -Wait`；**`&` 之后 `$LASTEXITCODE` 为空本身就是"没等到"的信号**，不要当成"成功且无输出"；
  ② **备份/还原必须覆盖探针的完整生命周期**，绝不能"启动后立刻还原"；能重定向就绝不碰真实目录
  （本轮 `$DESKTOP` 是常量、只能碰真实目录 ⇒ 更要把等待与还原做扎实）；
  ③ **NSIS 里含 COM 的宏都是"草稿寄存器黑洞"（`$0`–`$5`）**，调用前后不要指望这些寄存器的值还在——
  这也解释了模板自己的宏为什么每次用完就丢掉、不复用寄存器；
  ④ 复用/照抄别人的宏时，把它的副作用（占用哪些寄存器、会写哪些文件/注册表）写进注释。

### E-2026-239 NSIS 里"改快捷方式名 + 加备注"的五个硬约束：包含时机早于 `!define`、`!define` 不能重定义、中文必须带 BOM、显示方式只能写符号名、新名可能与用户已有文件重名（adj539）
- **场景**（用户要求）："PC 版创建的桌面链接命名为「爱记谱 iJipu」，备注为「爱记谱 - 码即成，谱自现，代码式简谱制谱引擎。」"；
  顺带把右键「打开方式」里的英文 `Open with iJipu` 改成中文「使用 iJipu 打开」。
- **根因 / 五个硬约束**（全部实测踩出，非推测）：
  1. **不能用 `productName` 改名**：`tauri.conf.json` 的 `productName` 就是模板里的 `${PRODUCTNAME}`，
     它还决定安装目录（`$LOCALAPPDATA\<productName>`）与"卸载"注册表键 ⇒ 一改名老用户会被装进新目录、
     旧目录与旧卸载项永久残留。只能在钩子里把模板建好的 `iJipu.lnk` **重建**成中文名。
     为什么是"重建"而不是"改名"：快捷方式「备注」只能通过 `CreateShortCut` 的**第 7 个参数**写一次，
     事后纯 NSIS 改不了（要写 COM 的 `IPropertyStore`）。
  2. **钩子文件的包含时机比模板 `!define` 更早**：`installer.nsi` 第 **31** 行 `!include hooks.nsh`，而
     `PRODUCTNAME`（36 行）、`MAINBINARYNAME`（47 行）、`BUNDLEID`（49 行）都在**其后**。于是在钩子里：
     · 用不了 `${PRODUCTNAME}` 这类符号（报未定义），只能自带等价字面量；
     · **尤其不能**照搬 `!insertmacro SetLnkAppUserModelId`——它宏体里是 `${BUNDLEID}`，展开时未定义，
       makensis 只给 `warning 6000: unknown variable/constant "{BUNDLEID}"`，然后**把字面量 `{BUNDLEID}`
       当成 AUMI 写进 .lnk**（任务栏会把快捷方式当成另一个应用 ⇒ 图标分裂），静默写坏；
     · 也**不能**在钩子里抢先 `!define BUNDLEID`——NSIS 的 `!define` 重复定义是**编译错误**
       （实测 `!define: "X" already defined!` 后 `aborting creation process`），不是覆盖。
     ⇒ 解法：自备参数化宏 `IJIPU_SET_AUMI shortcut aumi`；它用到的 `CLSID_ShellLink`/`IID_*`/`PKEY_*`/
       `VT_BSTR`/`SYSSTRUCT_*` 都来自第 25-26 行的 `Win\COM.nsh`/`Win\Propkey.nsh`，**在包含点之前**，可用。
  3. **含中文的 .nsh 必须带 UTF-8 BOM**：makensis 对无 BOM 的脚本按 **ANSI（ACP）** 解析，直接
     `Bad text encoding: …:1` 中止编译（**连注释里的中文都会炸**，不只是字符串常量）。
     `installer.nsi`/`utils.nsh` 都是带 BOM 的；`hooks.nsh` 原先没有 BOM，是因为它此前只在注释里出现中文才侥幸没炸。
  4. **`CreateShortcut` 的"显示方式"只能写符号名**：写数字会被拒——实测 `CreateShortcut: unknown show mode "1"`，
     必须写 `SW_SHOWNORMAL`。这是**位置参数**的坑：想补第 7 个参数（备注），中间的图标/显示方式就得一起补齐。
  另有一处**时序**坑：GUI 安装的桌面快捷方式是**完成页勾选时才建**的
  （模板 `MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut`），那时
  `NSIS_HOOK_POSTINSTALL` 早已跑完 ⇒ 只在钩子里改会漏掉最常见的 GUI 路径。
  5. **新快捷方式名可能与"用户在同一文件夹里已有的同名文件"撞车**：`CreateShortcut`/`Delete` 都是
     **静默按名覆盖**，不问也不改名。本机实测：桌面上**已经有一个** `爱记谱 iJipu.lnk`，但它是
     **Chrome 装的网页版(PWA)** 快捷方式（目标 `chrome_proxy.exe` + `--app-id=…`、AUMI `Chrome._crx_…`）；
     若照最初要求把桌面版也叫「爱记谱 iJipu」，安装器就会**悄悄把这个 PWA 图标换成桌面版快捷方式**
     （用户莫名少一个图标，且极难联想到是安装器干的）。⇒ 必须**先查用户机器上的实际文件**再定名：
     查清后用户定为 `i记谱 iJipu`（首字是**拉丁字母 i**，与「爱记谱」区分，两个图标并存）。
- **解决**（`src-tauri/nsis/hooks.nsh`）：
  ① `Function IJIPU_FixShortcuts`：**幂等**，仅在「旧名 .lnk 确实存在」且「`$INSTDIR\ijipu.exe` 已就位」时动手
     （⇒ 用户取消勾选桌面快捷方式时我们什么都不做；安装中途取消也不会去改上一版留下的快捷方式）；
     桌面与开始菜单都重建为「i记谱 iJipu」+ 备注，重建后补 AUMI，并在删旧名前 `UnpinShortcut`
     （改名后旧 pin 必然失效，主动摘掉比留个点不开的幽灵图标好）；
  ② `NSIS_HOOK_POSTINSTALL` 覆写 `Software\Classes\iJipu.jps\shell\open` 默认值为「使用 iJipu 打开」；
  ③ `Function .onGUIEnd` 再调一次 `IJIPU_FixShortcuts`（补齐 GUI 完成页那条路径；静默模式重复调用无害）；
  ④ 新增 `NSIS_HOOK_PREUNINSTALL`：模板只删 `${PRODUCTNAME}.lnk`，不认中文名，故补删——**同样受
     `$UpdateMode <> 1` 保护**，否则更新流程（先跑卸载器）会白删用户的快捷方式、而更新路径又不重建。
- **验证**：① 用 `makensis` **真编译生成的 `installer.nsi`**：exit 0 且**零告警**（改前有 2 条 `{BUNDLEID}` 告警）；
  ② 临时探针 `_nsis_probe/probe.nsi` 真建 .lnk 再读回：`WScript.Shell.CreateShortcut(…).Description`
  == 备注原文（中文正确）、中文文件名正确、**无备注对照组为空** ✓；
  ③ 探针 `probe2.nsi` 包含**真实 `hooks.nsh`** 并调 `IJIPU_SET_AUMI`：`Shell.Application … ExtendedProperty("System.AppUserModel.ID")`
  读回 `com.ijipu.app`，**对照组为空** ✓；④ 探针 `probe3.nsi` 在**隔离目录**里跑**真实的
  `IJIPU_FixShortcuts`**（先用模板的写法建 `iJipu.lnk`、再造一个假 `$INSTDIR\ijipu.exe`，然后连调两次验幂等），
  再读回新名 .lnk 的 `Description` / `System.AppUserModel.ID`/旧名已被删除 ⇒ 迁移结果与幂等性都被证明；
  ⑤ smoke 新增断言（BOM 存在性、备注原文、新名首字必须是拉丁 `i`（负向断言防同名覆盖 PWA）、
  `SW_SHOWNORMAL`、`IJIPU_AUMI` 与 `identifier` 同源、`.onGUIEnd` 唯一、删旧名前 Unpin、
  PREUNINSTALL 受 `$UpdateMode` 保护、无模板 AUMI 宏残留）。
- **预防**：① **在 NSIS 钩子里引用模板的宏/常量前，先确认其定义在包含点之前**——钩子被包含得极早，
  模板常量几乎都在其后；错序往往只给 `warning 6000` 而不报错，**静默写坏数据**是最坑的失败模式；
  ② **`!define` 重复定义是编译错误**（既非覆盖也非警告），"我先定义、让模板后面重复定义"这条路不通；
  ③ **含非 ASCII 的 .nsi/.nsh 一律带 BOM，并把 BOM 写成断言**——本轮 `edit` 工具每次写回都会**抹掉 BOM**，
  故 BOM 必须在**最后一次内容编辑之后**才补（顺序反了就白干）；
  ④ 凡是"给用户看的系统集成效果"（快捷方式名/备注、右键动词）**必须真建真读**：编译通过 ≠ 效果对
  （`unknown show mode` 只在编译期暴露，`{BUNDLEID}` 甚至只给告警）；
  ⑤ 探针要带**对照组**（无备注 / 无 AUMI），否则分不清"本来就对"还是"我们写对了"；
  ⑥ **凡"按名创建/删除文件"的安装器行为（快捷方式、关联、开始菜单项），定名前先列出用户机器上该目录的现有文件**
  ——同名是**静默覆盖**，用户只会看到"图标怎么变了/没了"。本轮就是先 `Get-ChildItem` 桌面才发现的冲突。

### E-2026-238 装好的桌面版打开是白屏——陈旧的 Service Worker 把旧 `index.html` 变成了"毒丸"，而页面的自救代码正被它自己挡着（死锁）（adj538/adj539）
- **场景**（用户报告）："安装好的 ijipu 应用打开是一个白屏。"
- **现象**：安装版启动后窗口全白。用
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 挂 CDP 观察：
  `#root` 的 `innerHTML` 长度为 **0**（React 根本没挂载），控制台 **7 条**
  `Failed to load module script: … responded with a MIME type of "text/html"`。
- **根因**（三层叠加，缺任何一层都解释不通）：
  1. 历史版本在桌面壳里注册过 PWA Service Worker——Tauri 在 Windows 用 `http(s)://tauri.localhost`，
     是**安全上下文**，SW 完全能注册；它把旧构建的 `/index.html`、`/assets/*` 存进了
     `%LOCALAPPDATA%\com.ijipu.app\EBWebView\Default\Service Worker\CacheStorage`
     （实测 17+ 份 index.html，最早一份是 2026-09-13）；
  2. SW 上下文里 `fetch('/assets/index-XXXX.js')` 取不到 Tauri 的**自定义协议**，`.catch()` 便回退到缓存的
     **旧 `index.html`**；而旧 HTML 引用的 `/assets/index_D_ON1muP.js` 在新安装里**已不存在**，Tauri 资源协议
     对不存在的路径返回 `index.html`（HTTP 200 + `text/html`）⇒ 模块脚本 MIME 校验失败 ⇒ `main.tsx` 不执行 ⇒ 白屏；
  3. **死锁**：`src/main.tsx` 里本来就有一段"发现自己在桌面壳里就注销 SW"的自救代码（adj443），
     但那段代码属于**页面 JS**，而页面 JS 恰恰被这个 SW 挡着 ⇒ 自救永远执行不到。
  证据链的另一半：把**同一份生产构建**放进无头 Chrome（带/不带 `__TAURI__` 桩）跑，控制台**零错误**、
  正常挂载 ⇒ 前端产物无辜，问题只出在壳里的 SW 缓存。
- **解决**（两道防线，都不依赖页面 JS）：
  ① **Rust 侧启动前物理清理**：新增 `purge_stale_service_worker(&Path)`，删除
     `<LOCALAPPDATA>\<identifier>\EBWebView\Default\Service Worker`，在 `run()` 最开始调用；
     identifier 取自 `tauri::generate_context!().config().identifier`，不写死字面量；
  ② **SW 自毁保险**（`public/sw.js`）：新增 `const IN_DESKTOP_SHELL = self.location.hostname === 'tauri.localhost'`，
     `install` 直接 `skipWaiting()`、`activate` **清空所有缓存 + `self.registration.unregister()`**、
     `fetch` 直接 `return` 不拦截任何请求 ⇒ 就算某个旧 SW 抢先激活，它也会立刻把自己注销掉。
- **验证**：装上**新包**并**故意保留**那份陈旧 SW 存储再启动 → 正常挂载（`mounted: true`、`rootHtmlLen > 0`）、
  CDP 目标列表里不再出现 `service_worker`；同时用生产构建在无头 Chrome 复核渲染无回归。
- **预防**：① **"在页面里写自救代码"对 SW 造成的白屏天然无效**——SW 拦截的正是页面 JS 本身；自救必须放在
  **SW 够不到的地方**（Rust 启动钩子 / SW 自己的 `activate`）。这是本轮最值钱的一条；
  ② **桌面壳里不要注册 PWA SW**：资源随二进制内嵌，SW 在这里只剩"陈旧缓存"这一种作用；
  ③ 排查白屏先看 **CDP 控制台的 MIME 报错 + `#root.innerHTML` 长度**，不要凭"像前端崩了"就去翻 React 代码；
  ④ `responded with a MIME type of "text/html"` 是"资源 404 被回退成 index.html"的典型指纹，
  在「SPA + 自定义协议 + SW」三者同场时要第一时间往这条线上想；
  ⑤ 清理类修复要**只删自己名下的目录**（`<identifier>\EBWebView\Default\Service Worker`），
  不要删整个 `EBWebView`（会把用户的 Cookie/缓存一起抹掉）。

### E-2026-237 Tauri 的 NSIS 文件关联"配了就以为完整"其实漏三件事；且 `DeleteRegKey /ifempty` 会误删别人的键（adj538）
- **场景**（用户要求）："PC 版安装时注册 `.jps` 扩展名、用 iJipu 打开；卸载时注销 `.jps` 的应用关联。"
- **根因**（查源码 + **本机真实生成的 `installer.nsi`/`FileAssociation.nsh`**，不是只看文档）：
  Tauri v2 的 NSIS 模板只做 `APP_ASSOCIATE`（安装）/ `APP_UNASSOCIATE`（卸载），而后者只做两件事——
  把 `.jps` 默认值**还原**（备份为空时写入的是**空串**，不是删值）+ 删我方 ProgID 键。于是缺三件事：
  1. **不写** `Software\Classes\.jps\OpenWithProgids` ⇒ 右键「打开方式」列表里**看不到 iJipu**，
     用户只能走"选择其他应用"（Microsoft 明确要求该项；上游 tauri#9803 至今未修）；
  2. **不调** `SHChangeNotify`（`UPDATEFILEASSOC` 宏在 `FileAssociation.nsh` 里定义了，但 `installer.nsi`
     从未 `!insertmacro` 它）⇒ 资源管理器可能继续显示旧图标/旧关联，要重启或重新登录才刷新；
  3. 卸载**不删** `Software\Classes\.jps` 键本身、也不删它写的 `<ProgID>_backup` 备份值 ⇒ 永久残留。
     更隐蔽的是：一次**覆盖安装**（`/UPDATE` 路径不先卸载）会把我们自己的 ProgID 读进备份值，
     之后再卸载就会把默认值"还原"成一个指向**已删键**的悬空 ProgID。
  此外 `FileAssociation.nsh` 是 vendored 的第三方宏（Saivert/nikku），其默认 ProgID 直接取 `name`，
  **省略 `name` 时 ProgID 就是裸 `jps`**（易撞名，Microsoft 建议 `Vendor.Component`）。
- **解决**：
  ① `bundle.fileAssociations: [{ ext:["jps"], name:"iJipu.jps", description:"简谱工程文件", role:"Editor", mimeType:"application/x-jps" }]`
     —— `name` 同时是 Windows ProgID 与 macOS 的 `CFBundleTypeName`，故显式给出；
  ② `bundle.windows.nsis.installerHooks: "nsis/hooks.nsh"`（键名取自本机 `@tauri-apps/cli` 的 `config.schema.json`），
     钩子里 `NSIS_HOOK_POSTINSTALL` 写 `OpenWithProgids` + `SHChangeNotify`，
     `NSIS_HOOK_POSTUNINSTALL` 删我方两个值名（`iJipu.jps_backup`、OpenWithProgids 里的 `iJipu.jps`），
     再**手工枚举**（`EnumRegValue`/`EnumRegKey`）确认"默认值为空 + 无其它值 + 无子键"后才删键。
- **验证**：打包后**检查真实生成的 `installer.nsi`**（这是唯一可信的"配置生效"证据）：
  L31 `!include …hooks.nsh`、L649 `APP_ASSOCIATE "jps" "iJipu.jps" …`、
  L708-709 `NSIS_HOOK_POSTINSTALL`（在关联写入之后）、L770 `APP_UNASSOCIATE "jps" "iJipu.jps"`、
  L844-845 `NSIS_HOOK_POSTUNINSTALL`（在关联移除之后）✓；makensis 编译通过 ⇒ 钩子语法有效 ✓；
  `iJipu_0.28.0_x64-setup.exe` 31194 KB，`check:installer 全部通过` ✓；
  smoke 新增 16 条断言（含"多文件载入第一个 + 剩余计数"纯函数、`hasShell()` 在 Node 为 false、
  以及"**禁用** `DeleteRegKey /ifempty`"的负向护栏）全部通过 ✓。
- **预防**：① **"配置开了"不等于"功能完整"**——文件关联这类要动系统注册表的功能，改完必须
  **打开生成的 `installer.nsi` 逐行核对**（配置对不对、钩子进没进、顺序对不对），只看文档或只看"打包成功"都会漏；
  ② **清理注册表永远"只删自己的值名，再枚举确空才删键"**——`DeleteRegKey /ifempty` 在 NSIS 里
  **不检查值**（社区专门有 "How to delete a registry key only if it has no values" 与
  "DeleteRegKey /IfEmpty doesn't work" 的 bug 报告），拿它清"可能还有别人数据的键"会误删；
  ③ 做"禁用某写法"的负向断言时**先剥掉注释**——本轮就被自己注释里写着的 `DeleteRegKey /ifempty` 绊了一次
  （断言匹配到注释 ⇒ 假失败）；
  ④ `.jps` 并非无人认领的扩展名（JPEG Stereo 图像、Java Print Service 也在用）⇒ 预期"部分机器上
  首次双击仍会弹一次系统选择框"（Windows 8+ 的 `UserChoice` 受哈希保护，安装器无法静默接管），
  这属于系统策略而非缺陷，不要试图绕过。

### E-2026-236 设置→主题「浅深模式」选中项在**浅色模式**下几乎看不见——字色写死了只对深色模式成立的 `#101010`（adj535）
- **场景**（用户报）："设置-主题-浅深模式的选中项的文本在浅色模式下，因为文本颜色与背景颜色过于接近，看不清楚。"
- **根因**：选中态是「**实心强调色底 + 反色字**」，但字色**写死成 `#101010`**——它只对**深色模式**成立：
  深色主题的 `--jp-accent` 全是亮色（霓虹青 `#00f0ff`、竹青 `#8fbf6f`、缃色 `#e3c13d`…），深字压亮底 ✓；
  而**浅色模式**下强调色本来就是**深色**（黛蓝浅 `#0891a6`、竹青浅 `#3f7a2e`、秋香浅 `#9c7a16`、玄墨浅 `#666666`…），
  于是成了"深字压深底"——无头 Chrome 实测黛蓝浅色下对比度约 **1.1:1**（等于看不见）。
  本质与 `E-2026-197/198`（图标颜色口径漂移）同类：**把"跨主题的语义色"当成常量写死**，
  只在当初那一个模式里验证过就收工。
- **解决**：字色改 `color: var(--jp-bg-panel)`（"面板底色"，两个模式下都恰好是强调色的反色）——
  浅色模式 = `#ffffff`（白字压深底 ✓）、深色模式 = 深面板色（深字压亮底 ✓），**随主题自动成立**，
  不必给 6 个主题 × 2 个模式各写一个字色。
  顺带（用户同一条要求）把文案「浅深模式」统一改为「**深浅模式**」（设置标签、顶栏 title/aria、更多菜单组标题；
  代码注释与活文档一并更新；`docs/ERRORS-LOG.md` 的**历史条目按"不改写历史"原则保持原样**）。
- **验证**：无头 Chrome 实测两种模式的对比度（在页面里用 `getComputedStyle` + WCAG 相对亮度公式现算）：
  浅色（黛蓝浅）白字 `rgb(255,255,255)` 压 `rgb(8,145,166)` = **3.74:1**（改前深字压同底 ≈ 1.1:1）；
  深色（黛蓝）`rgb(22,29,58)` 压 `rgb(0,240,255)` = **11.73:1**（与改前一致 ⇒ 深色模式行为不变）。
  设置面板实测标签显示「深浅模式」✓。`tsc -b` / `npm run lint`（0 error）/ `npm run build` /
  `npm run smoke` **ALL SMOKE TESTS PASSED ✅**（新增 adj534–537 共 13 条断言，另更新 2 条钉在旧画法上的断言）。
- **预防**：① **"反色/对照色"永远不要写死**——凡"实心底 + 前景字"的组合，前景必须取**语义色对应的反色 token**
  （本项目即 `--jp-bg-panel`）或明暗两套各自定义；写死十六进制必然在另一个模式下翻车；
  ② **颜色类改动要在浅/深两个模式下各算一次对比度再收工**——用 `getComputedStyle` + WCAG 公式在页面里现算，
  比盯着截图看可靠（本轮就是这么发现"浅色 1.1:1"的）；
  ③ 术语类文案统一改时，**历史排错记录不改写**（改写等于篡改记录），只改活文档、代码与注释。

### E-2026-235 发布流程里两次**自伤**：用 `write` 覆盖整份文档、用 `Get-Content` 读"UTF-8 无 BOM"后再回写（整行变乱码）（发布流程）
- **场景**：v0.27.4 走到 OP-03（给 `docs/ERRORS-LOG.md` 的「变更记录」表追加一行）时，连续两次把文档写坏。
- **事故 1（覆盖整份文档）**：为"追加一行"而调用 `write` 工具——该工具语义是**整文件替换**，于是 2870 行的 ERRORS-LOG 只剩刚写的那一行。
  **恢复**：`git checkout HEAD -- docs/ERRORS-LOG.md` 取回已提交版本（v0.27.3 的 2842 行），
  再按本轮实际改动**重新插入** `E-2026-232/233/234` 三个条目（内容按原始编辑逐字恢复），最后补上 v0.27.4 的表行。
- **事故 2（读错编码 → 回写乱码）**：把新表行写到临时文件后，用 `Get-Content -Raw` 读回来再 `AppendAllText`。
  本机 `Get-Content` 对**无 BOM 的 UTF-8** 默认按 **ANSI/GBK** 解码（`Console.InputEncoding` 实测是 DBCS 代码页），
  读出的字符串本身就是乱码，再以 UTF-8 写回 ⇒ 文件里那一行成了"**合法 UTF-8 的错字**"
  （`发布` → `鍙戝竷`：肉眼与 read 工具一眼可见，但**字节层面完全合法，任何 UTF-8 校验都查不出来**）。
  **恢复**：按字节定位该行起始偏移（`| v0.27.4 |` 的字节位置）截断 → 用
  `[IO.File]::ReadAllText($tmp, UTF8Encoding($false))` 读临时文件 → `UTF8Encoding($false).GetBytes`
  → `FileStream(Append)` 写字节 → 最后用 **`UTF8Encoding($false, $true)`（抛异常的严格模式）**复核整份文件。
- **根因**：两条都属"**工具语义与意图不匹配**"，而且都是本项目**已经写过**的教训——
  事故 1 是"局部追加不该用整文件写工具"；事故 2 正是 `.dsh/skills/版本发布/SKILL.md` §3 与 `E-2026-164`
  明确警告过的"中文文本一律经 UTF-8 文件 + .NET API 显式编码进出，**禁止 PowerShell 文本 cmdlet 参与**"。
- **解决/预防**：① **改已有文档只用 `edit`（局部替换）**，`write` 只用于**新建**文件，绝不对既有长文档使用；
  ② 追加内容固定姿势：`write` 生成临时文件 → `[IO.File]::ReadAllText($p, UTF8Encoding($false))`
  → `UTF8Encoding($false).GetBytes` → `FileStream(Append)` → **严格模式 UTF-8 复核**（`UTF8Encoding($false,$true)`）；
  ③ **每次文档写入后立刻用 read 工具复核**（它按 UTF-8 解码，乱码一眼可见）——事故 2 正是靠它发现；
  ④ 破坏性操作前先确认可恢复路径（事故 1 能全量挽回，是因为文件已在 HEAD 里、且新增条目在对话记录中可逐字复现）。
- **验证**：事故处理后 `ERRORS-LOG.md` 2871 行、E 条目数与 HEAD 一致（217 + 本轮新增 3 + 本条 = 221）、
  严格 UTF-8 校验通过；`git diff --stat` 复核改动集与预期一致。

### E-2026-234 告警行首三角箭头"连调三轮字号还是不够大"——根因是**字符选错**（SMALL 变体）而不是字号（adj532）
- **场景**（用户连续反馈，第 4 次）："告警的三角箭头大小再放大，还是不够大。" 此前 adj512 统一字符、adj515/516 把字号 10 → 14 → 16、adj517 再提到 18px（盒子 18×18、父按钮 22px），用户仍觉得小。
- **根因**：**问题不在字号，在字符本身**。用的是 `▸`（U+25B8 **BLACK RIGHT-POINTING *SMALL* TRIANGLE**）——"SMALL"是这一码位的设计口径，墨迹只占字号的一小部分。用 `canvas.measureText().actualBoundingBox*` 在当前字体栈（`"Segoe UI","Microsoft YaHei",sans-serif`）下逐档实测：`▸` 12px→6×4、**18px→7×6**、26px→10×9、36px→12×12px。也就是说前三轮把字号翻近一倍，可见墨迹只从 4px 长到 7px——用户"看不出变大"完全合理；要靠它做到 15px 级别的箭头得把字号拉到 45px 以上（会把行高和整块面板撑变形）。同一测试里 `▶`（U+25B6 常规实心三角）18px→**17×18px**、13px→12×14px。顺带记一条**验证方法**的教训：之前几轮只改了字号 + 肉眼看截图，没有量"墨迹像素"，于是"改了但看不出来"被当成"没改到位"，反复调参。
- **解决**（`src/ui/dock/ProblemPanel.tsx` + `src/index.css`）：① 字符由 `▸` 换成 **`▶`（U+25B6）**，字号仍取 18px（与告警正文 12px 成比例），**+`canvas` 实测墨迹 17×18px ≈ 原来的 2.5 倍**；② 口径不变：仍是**单字符 + `rotate(90deg)`**（收起右指、展开下指，旋转前后视觉一致，不做第二个字符——这是 adj512/515 的既有结论，仍然成立，只是当年挑错了字符）；③ glyph 盒子 18×18 → **20×20**（容纳旋转后的占位），父按钮预留 22 → **24px**，行高与面板高**实测未变**（行仍 21px、面板仍 46px），故告警面板的高度算式（adj528）无需改动；④ `.problem-hint` 缩进注释同步（让过 24px 展开列）。
  **adj533（同轮追加）**：用户看到实机后又反馈"又偏大了一点，改 3/4 大小"⇒ 字号 18 → **13.5px（= 18×3/4）**，墨迹 17×18 → **12×14px**（渲染实心部分约 10×12px）；**盒子 20×20 与展开列 24px 不动**——盒子是"旋转占位 + 点击热区"，缩小它会把可点区域一起缩小；行高实测 21 → 22px（盒子基线随字号略移），而面板高度本来就按**实测行高**算（adj528），没有写死常量需要同步。这条也说明"按比例改图标大小"要**只改字形、别顺手等比缩盒子**（否则热区与相邻文字位置一起漂）。
- **验证**：`tsc -b` / `npm run lint`（0 error）/ `npm run build` / `npm run smoke`（新增 3 条 adj532 断言：字符必须是 `▶` 且不得再用 `▸`、仍是单字符 + rotate(90deg)、盒子 20×20 与展开列 24px）**ALL SMOKE TESTS PASSED ✅**。另用无头 Chrome + CDP 注入一条带 hint 的告警行，开 dock 告警面板**逐像素扫墨迹**：改前 3×4px（在 18×18 盒子里几乎是个点）→ 改后 **12×15px**（截图对比确认是清晰的实心右三角）；展开态确认旋转 90° 后大小不变、行高 21px、面板 46px 全程不变。adj533 微调后实测墨迹 ≈ **10×12px 实心**（原 18px 实心约 12×15），行高因盒子基线随字号略移 21→22px，面板仍按"条数×实测行高"算（adj528），无写死常量需要同步。
- **预防**：① **怀疑"太小/太大"时先量墨迹，别调字号**——不同 Unicode 码位的字形墨迹占比差异极大（SMALL 变体 ≈0.4em 宽，常规 ≈0.95em），本项目已有"▸/▾ 两字符尺寸不一致"的前科（adj512），这次是同一个坑的另一面：**统一了字符，却统一到了一个特别小的字符**；② 调整字号类修复最多试 1~2 次，若"看起来没变化"就立刻去量像素/换实现，而不是继续加档；③ `canvas.measureText(...).actualBoundingBox{Ascent,Descent,Left,Right}` 是**量任意字符墨迹盒**的现成手段（不必真渲染、不必截图），选图标字符时先用它比一比；④ 遗留同类项（本轮未动，待用户确认）：`dialogs/VoicePickerDialog.tsx` 的折叠指示仍用 `▸`/`▾` 这一对 SMALL 变体（且 width 只有 12px），大概率同样偏小。

### E-2026-233 底栏高度档位按钮与 ✕ 紧挨在最右端 ⇒ 手机上够不到、容易误按关闭（adj531）
- **场景**（用户要求）："将底栏的页签组的高度调整按钮移到最左边，在手机上左边操作更顺手，也避免误按关闭按钮。"
- **根因**（布局层面的两个不对称）：adj525 之后，页签栏被拆成「可滚页签区 + 两个常驻按钮」，两个常驻按钮（高度档位、✕）**并排**留在**最右端**、彼此只隔一个 3px 的 `gap`。于是：① **触屏够不到**：手机单手持机时拇指自然落在左半屏，右端最边上是"够得吃力"的区域；② **误触代价不对称**：档位按钮是**高频、无害**的轻操作（点错只是换个高度），而紧挨着它的 ✕ 是**破坏性**操作（点错直接收起底栏），两者相邻却给出同等的命中距离 ——正是"手指想点档位、结果关了底栏"的成因；而栏左端本来就空着一大截。
- **解决**：把档位按钮从 ✕ 左侧移到**整栏最左端**，栏内顺序成为「**档位按钮 → 可滚页签区 → ✕**」(`src/ui/ToolDock.tsx`)。要点：① **改 DOM 顺序而不是用 CSS `order` 反转**——视觉、焦点序、读屏序三者保持一致（`.topbar-toolbar` 自己用 `order: 2` 把整条栏挪到 dock 底部，那是"整块搬家"，不涉及内部顺序）；② 两个按钮**仍在可滚页签区之外**（adj525 的"必须常驻"口径完全不变），`flex: 0 0 auto` 原样；③ 于是 ✕ 成为**最右端唯一**的按钮（贴着屏幕右缘），档位按钮与它之间隔着整条页签区；④ CSS 无需任何功能性改动（`gap`/内边距/命中区规则都不动），只同步注释与断言。宽度账不受影响：栏开销仍是「档位 28 + 两个 gap + ✕」+ 内边距，5 个页签的"整栏放得下"结论不变。
- **验证**：smoke 更新/新增 5 条——① 钉住新顺序 `sizeIdx < stripIdx < closeIdx`；② "档位按钮与 ✕ 之间隔着整条页签区"；③ 两个按钮的 `flex: 0 0 auto` 不变；④ `role="tablist"` 仍在页签区；⑤ 旧断言改为**与顺序无关**的"页签区里只有页签"。`tsc -b` / `npm run lint`（0 error）/ `npm run smoke` **ALL SMOKE TESTS PASSED ✅**。另用无头 Chrome + CDP 实测两档：**390×844**（手机）→ 档位钮 x=3..31、页签区 34..364、✕ 367..387，5 个页签 `scrollWidth === clientWidth`（整栏放得下、未触发横滑）、末页签右缘 322 < 364、✕ 完全在视口内；**1400×900**（桌面）→ 5..33 / 36..1372 / 1375..1395。两档都做中心点命中测试（档位钮命中其内图标、✕ 命中 `.tool-dock-close`），并截图确认观感（✕ 独立贴右缘、档位钮贴左缘）。
- **预防**：① **破坏性操作（关闭/删除/退出）不要与高频轻操作相邻**——触屏上误触代价不对称，应让破坏性按钮"独自待在最边上"；② 触屏优先把**高频操作放左手拇指可达区**（左半屏），右端留给"偶尔用、且要慎重"的操作；③ 只调顺序时**同步 DOM 与视觉顺序**，别用 `order` 反转内部项（焦点/读屏序会与视觉不符）；④ 结构性断言尽量写**与顺序无关的性质**（"页签区里只有页签"），顺序另钉一条——本轮旧断言（`sizeIdx > stripIdx`）正因绑死顺序才必须跟着改。

### E-2026-232 顶栏按钮重排（功能组靠左 / 编辑设置组靠右 / 视图与主题并入功能组）——两处「一改就踩」的暗坑（adj530）
- **场景**（用户要求）：① 菜单图标换新 `菜单.png`（处理方式不变）；② 视图下拉、排版、试听、导出、主题、设置、预览比率缩放 **归并为功能按钮组、靠左对齐**；③ 折行、输入条、字体、字号 **归并为编辑设置组**，「支持」独立成组，**这两组靠右对齐**；④ 两组仍**外框包围**；⑤ 窗口变窄时保持「先图标化、再逐步隐藏」，但可见优先级按 **视图 > 支持 > 排版 > 试听 > 导出 > 主题 > 设置 > 预览比率 > 折行 > 输入条 > 字体 > 字号**；⑥ 只是重排 + 对齐变化，按钮样式/响应行为/折叠后的表现/「更多」的出现条件**都不变**。
- **根因/暗坑**（重排本身不难，难在两处"看起来无关"的既有约束）：
  1. **视图下拉会被工具条的横向裁剪切掉**。视图按钮原来挂在 `.topbar` 下（`overflow` 默认可见），并入功能组后就落进了 `.topbar-toolbar { overflow: hidden }`；该容器是 adj453 的**宽度预算安全阀**，而绝对定位后代只要**包含块在裁剪盒内部**就会被裁（CSS 2.1 §11.1.1）——视图下拉的包含块 `.topbar-views` 正是它的后代 ⇒ 下拉整体被裁、表现成"点视图按钮没反应"。**同一个坑 E-2026-128（adj386）已经在「字体」按钮上踩过一次**（当时靠改 `position: fixed` 绕过）。
  2. **宽度预算的"子项数"和"槽位数"随重排全变了**：原来顶栏在流子项是 Logo/汉堡/视图/弹性间距/工具条/浅深/支持[/更多]，重排后是 Logo/汉堡/工具条/支持[/更多]（视图、主题进了工具条，弹性间距 div 取消）；漏改任何一项都会让预算虚高（E-2026-193/adj453 的复现路径）。
- **解决**：
  1. 分组与顺序**拆成三份互不耦合的常量**：`FN_ORDER`（功能组内顺序）、`EDIT_ORDER`（编辑设置组内顺序）、`TOOL_PRIORITY`（**可见优先级**，末位最先被折叠）。按钮定义改**按 key 查表**（`toolDefs`），折叠不再依赖"数组顺序切片"，于是"顺序"与"谁先消失"可以各自独立调整。
  2. 折叠判定抽成纯函数 `src/ui/topbarFold.ts` 的 `foldKeys()`（与 `preview/zoomFit`、`dock/problemsHeight` 同一套路）：从优先级**末位**开始逐个折叠，每折一个就把「更多」的槽位算进来（`fits(visible, withMore)` 两段判定），直到放得下；空组不占位、组框开销/间距全部按实测值算。组件只负责"量"与"读活值"。同时删掉了不再需要的 `visCount`、`topbar-spacer`、`donateRef`/`themeModeRef` 常驻测量。
  3. 裁剪改成 **`overflow-x: clip` + `overflow-y: visible`**（规范允许且不会被隐式改写：`visible` 只在另一轴为 `hidden/scroll/auto` 时才被算成 `auto`）——横向安全阀保留，纵向不再裁；再加 `.topbar-toolbar:has(.topbar-views.open) { overflow: visible }`，下拉打开时整体放开裁剪（极窄屏下下拉会横向超出工具条右缘，此时也不需要安全阀）。视图下拉的浮层结构、`clampDropdowns` 限高、移动端重定位全部照旧。
  4. 「支持」独立成组（`margin-left: auto` 在工具条之外自然靠右），且**同样参与折叠**（优先级第 2，几乎不会被收走）；折叠后它也会出现在「更多」里（`.menu-entry` 复用同一份 `iconOf` + 文案）。视图/主题被折叠时，「更多」里给出与下拉等值的完整选项（视图四项、浅深三档，当前项打 ✓），view 下拉与更多菜单**共用同一份渲染**。
- **验证**：smoke 新增 20 条（`[119]`）——8 条折叠算式（合成宽度表断言"谁先走、走几个"、折叠顺序 = 优先级倒序、「更多」自身占位、组框开销/空组、极窄屏收敛）+ 12 条接线（三份顺序常量逐项比对、两组外框 CSS、靠左/靠右的 CSS、视图/主题分支、更多出现条件、测量副本位置、下拉不被裁）。`tsc -b` / `npm run lint`（0 error）/ `npm run build` / `npm run smoke` **ALL SMOKE TESTS PASSED ✅**。另用无头 Chrome + CDP **逐宽度实测**（1400/1200/1100/1000/950/900/860/820/780/740/700/660/620/580/540/500/460/420/390/360/320 共 21 档）：每档断言"工具条无隐藏溢出（`scrollWidth === clientWidth`）、最右子项右缘 ≤ 视口 − 内边距、文档无横向滚动"，并核对折叠序列与优先级完全一致（`字体→字号→输入条→折行→缩放→设置→主题→导出→试听→排版→支持→视图`）；520/620 档确认「先图标化」（`.tool-label` 隐藏）后能放回更多按钮；再打开视图下拉（420px 视口）用 `elementFromPoint` 命中测试确认**四个角都命中下拉自身**（未被裁剪）、「更多」下拉完整落在视口内且条目齐全。
- **预防**：① **把浮层放进新的祖先容器前，先问"这个祖先会不会裁它"**——本项目已有两次（adj386 字体、adj530 视图），判据是"浮层的包含块是否落在裁剪盒内部"，而不是"祖先有没有 `overflow`"；② **顶栏宽度预算里凡是"子项数/槽位数/间距数"的算术，重排后必须重新数一遍**（adj453/E-2026-193 的教训），并把这类算术抽成纯函数让 smoke 直接断言——正则盯源码挡不住"少算一个 6px"；③ 折叠类需求落地时**先把"优先级"写成一行常量**再实现，用户调整"谁先消失"就只改这一行；④ UI 布局改动除了截图，**用 CDP 逐档量几何**（`scrollWidth/clientWidth`、最右子项右缘、`elementFromPoint` 命中）比肉眼看截图可靠得多——本轮截图里"支持/更多 不见了"其实是压缩图裁切造成的假象，量几何才发现布局一直是对的。

### E-2026-215 长倚音时值按规范修订（附点 2/3、增时线不计）+ 倚音力度分级（adj505）
- **场景**（用户给出倚音规范并要求核对→确认后修改）：核对结论是"短/长判定、长倚音 1/2（单纯音符）、总时值守恒、多倚音共享、
  现代记谱不写记号即按谱面演奏"**都已符合**；不符合的是 **① 长倚音 + 附点应为 2/3（当时是 1/2）**、
  **② 短倚音时值偏长**、**③ 力度不分长短**。用户逐条裁定后本轮只做 ① 与 ③（② 待定）。
- **① 长倚音 = 本体 ×（附点 2/3、否则 1/2）**（`spaceLayout.ts` `graceGroupBeats`）：
  关键是"**增时线不计入**"——用户口径「有增时线也只占主音符（不包括增时线）时值 1/2」。
  实现上**不重写附点算法**，而是借引擎自己的 `tokenDuration` 把 `augmentCount` **抹零**：
  `tokenDuration({ ...t, augmentCount: 0 })`。踩到的坑：引擎口径是「**附点作用在含增时线的整体上**」
  （`duration.ts` 的 `(1+aumentCount)/2^diminishCount` 再补附点 ⇒ `3. -` = **3 拍**而非 2.5 拍），
  所以"本体"必须用"抹零后的引擎值"、不能用 `总时值 − 增时线条数`（那会算成 2 拍）。
  实测：`3[2]` 倚 1/2 主 1/2 ｜ `3.[2]` 倚 **1**（2/3×1.5）主 1/2 ｜ `3 -[2]` 倚 1/2 主 3/2 ｜ `3. -[2]` 倚 **1**（2/3×本体 1.5）。
- **③ 力度分级（用户选"只做力度区分"方案）**：**短倚音**（不占强位、重音在主音符上）取 **90%**、**长倚音力度不变**；
  前/后倚音同一把尺子（`sequence.ts` 里按 `max(diminishCount) > 0` 判定短/长，`graceGain = isShortGrace ? gain * 0.9 : gain`，
  前倚音与后倚音两处事件都用它）。逐事件 `gain` 经 `playback/index.ts` 的 `0.5 × gain` 落到
  `velocity = round(127 × gain)`（`spessaSynthBackend.ts`）⇒ 是真实的力度差、不是标记。
- **② 未做（待用户定）**：短倚音现在仍是 `1/2^(减时线条数+1)` 拍（`3[2/]` = 1/4 拍，四分音符上占 25%），
  与用户"短倚音非常短促、几乎不占时值"的描述仍有差距；给了三个口径（保持按减时线 / 绝对毫秒制 / 比例再加一级）待选。
  同理"短倚音是否**总是**抢在主音符之前（从上一个主音符借时值）"也待确认——本轮按用户"只做力度区分、不改位置"的方案，
  位置维持"占拍点"，借用仍只在**装不下**时触发（adj489 机制）。
- **② 短倚音时值 = 主音符因子 × 倚音因子（adj507，用户最终方案；adj506 的"一味再减一级"被取代）**：
  用户试听后指出「不要只看倚音自己的减时线，**要看主音符**——`3[2/]` 与 `3/[2/]` 听感完全不同，前者该短、后者可以长一些」，
  并给出「两者相乘」：**主音符因子**（不带减时线 `1`、**有**减时线 `1/2`；只看有无、与条数无关）×
  **倚音因子**（1 条 `1/4`、2 条 `1/8`、≥3 条 `1/16` 封顶）。
  实现：`graceGroupBeats` 的短倚音分支改为 `(t.diminishCount > 0 ? 1/2 : 1) * 1/2^min(beamCount,3)+1`。
  实测：`3[2/]` 1/4 拍、`3/[2/]` **1/8 拍**（前者恰是后者两倍）、`3[2//]` 1/8、`3/[2//]` 1/16、`3[2///]` 1/16（封顶）。
  ⚠️ 用户原文写「3 个减时线 1/6」，按二进制时值应为 **1/16**（且与下句"再多也是 1/16"自洽）⇒ 按 1/16 实现，
  已向用户说明；若确为 1/6 需再改。**只影响演奏**（该函数只被 `sequence.ts` 使用）。
  连带再扫一遍断言：`[92]` 6 条（回到 `g250`/`g125`/`per12` 口径）、`[119]` 4 条（倚音+波音共存回到 250/750、
  `(3[h5/] 3)` 回到 750/250；`(3/[3/5/] 3)` 因主音符带减时线而**数值不变**），并新增 6 条 adj507 专项断言
  （主音符有无减时线的对比、`3[2/]` = `3/[2/]` 的两倍、1/2/≥3 条倚音因子、两因子相乘、封顶）。
- **③ 借用（adj489）保留**：组时值随主音符变化后，"装不下"才借的机制不变；
  `[92]` 的借用用例改用 `5 - 6,////[2/] 1`（主音符 4 条减时线 ⇒ 主音符因子 1/2、倚音因子 1/4 ⇒ 组时值 1/8 拍 = 125ms，
  主音符 1/16 拍 ⇒ 缺 1/16 拍从上一个主音符借，前主音由 2 拍变 2 拍 − 1/16）。
- **验证**：smoke 新增/更新 **12 + 6 项断言**；`tsc -b` / `lint`（0 error）/ `build` / `smoke`（ALL PASSED）/ `preview:render`（0 错误谱）全过。
  文档：`docs/SYNTAX.md` §2.5 第 1 条改为「主音符因子 × 倚音因子」并列出 6 个例子，
  旧规则注记补 adj505/adj507 的数值变化。
- **预防**：① 定"某个记号占多少时值"这类规则时，**取值必须走引擎已有的时值函数**（本轮 `tokenDuration`），
  否则很容易把"附点/连音/增时线"的算法抄第二遍并与引擎口径分叉（本项目已多次踩）。
  ② 核对规范时先分清"**已符合 / 不符合 / 待定**"三类再动手，别把用户对某一维度的选择
  （本轮"力度只做区分"）误当成对所有维度的选择（时间位置仍另需确认）。
  ③ **改了数值口径后要连带扫一遍吃这些数值的断言**：本轮 `[92]` 有 6 条、`[119]` 有 4 条记录着旧值；
  其中"借用"那条还因**触发条件被抬高**（组时值变小 ⇒ 更难触发）而必须换用例，不能只改数字。
  ④ **`tsc -b` 不覆盖 `scripts/`** ⇒ smoke.mts 里"引用了已删除的常量"这类错误**只在运行时才炸**：
  删/改常量后必须 `grep` 一遍**所有相关名字**——本轮先漏了 `g250`、修完又漏了 `g625`，
  两次都是 `ReferenceError` 崩在 smoke 里（教训：改完立刻 `Select-String -Pattern "\bg\d+\b"` 全量核对）。
  ⑤ 用户写出的数字如有**明显笔误**（本轮 `1/6`），按"体系自洽 + 上下文"取合理值实现，并**明确回告**，
  不要沉默照抄（否则会留下一个非二进制的怪异时值）。

### E-2026-214 波音（mordent）演奏时值实现（adj502）+ 倚音括号后的 `&编码` 丢失（tokenizer）
- **场景**（用户给定规范并要求实现，5 点口径已逐条确认）：「波音与倚音原则一样，时值从主音符匀出、演奏总时值守恒，
  但波音**从主音开始**（先弹主音再波动）；单波音约占 1/4、复波音约占 1/3~1/2；波音没有固定比例、弹得越快越好」。
- **现状核对**：`&sby/&xby/&sby+/&xby+` 此前**只画不奏**——`render/index.ts` 用用户提供的矢量图画记号，
  而 `playback/sequence.ts` **完全不读** `note.symbols`（全库只有 `&hx` 读符号）⇒ 演奏里没有任何波动。
- **实现**（`engine/playback/ornaments.ts` 新模块 + `sequence.ts` 接线，纯函数、可单测、插件 vendor 直接复用）：
  - **每个短音 = `clamp(P/8, 45, 110)`ms**，`P` = 主音符谱面时值。于是单波音 2 个短音占 P/4、复波音 4 个占 P/2，
    且**两者波动速度一致**（复只是多波一下）——比"占 P/4 / P/3~1/2 再除"更符合"弹得越快越好"的听感。
  - **绝对夹紧**：拍速快 → `P/8` 自动变小（快板更紧）；长音符/附点音上短音**不再跟着变长** ⇒ 占比自然掉到 ~5%（全音符）。
  - **不抢太多**：装饰部分最多占 `P/2`（保主音 ≥ 一半、重音仍落在主音上）；极短音符上**复波音降级为单波音**，
    再不行按比例压缩（"塞得进去"优先于"够长"）。**不变式**：`shortMs × steps + heldMs ≡ P`（smoke 断言）。
  - **音高**：`'P'` 步不带 `pitch` ⇒ 沿用 `placed.audioPitch`（主音本体，含变音记号）；邻音按**调内二度**算且
    `accidental: null`（**不继承主音的临时变音**），`7` 上翻八度、`1` 下翻八度。
  - **接线**：短音排在**主音起奏点**之后、其后是"按住的主音"（`heldMs`）；预算在**扣掉倚音后的剩余时值**里匀
    （与倚音共用同一个主音符预算 ⇒ 总守恒）；首个短音携带 `playheadSegs`（色块与"音符起奏"对齐、不晚一个波音长度）；
    与**连音合并**的关系见下面 adj503 的修正（最初写成"带波音的音符不参与合并"，过严）。
- **adj504 再修（用户报 `(3/[3/5/] 3)`）**：同一类"方向"错误其实**更早就存在于倚音上**——`adj396` 的守卫是
  `lastEventHadGrace = curHasGrace`（**任何**倚音都阻止下一个音符合并进来）⇒ `(3/[3/5/] 3)` 里倚音后又弹了一次 3 ✗。
  当时这么写有它的道理：那会儿合并取的是"`events` 末元素"，带后倚音的音符末元素是倚音事件，合并会并到倚音上 ✗；
  现在合并目标是 `lastMainEvIdx`（**主音事件**），旧顾虑已不存在。于是把守卫改成
  **`lastEventHadTailGrace = curHasGrace && gn?.after === true`**（只判**后**倚音）：
  - **前倚音**（`(3/[3/5/] 3)`）：合并 ⇒ 第二个 3 **延长**（合并只延长主音事件，倚音在开头不受影响）✔；
  - **后倚音**（`(3[h5/] 3)`）：仍不合并 ✔——后倚音占主音符**尾部**，延长主音会把它盖住（变成"在长音里插一嘴"）。
  验证：`(3/[3/5/] 3) 1 2` ⇒ 倚音 3/5 各 125ms，主音 3 从 250 起、并入第二个 3 的整拍 ⇒ **1250ms 无第二个起奏**；
  `(3[h5/] 3) 1 2` ⇒ 主音 750 + 后倚音 250，第二个 3 从 1000 照常起奏。两条断言都在 `[119]`。
- **adj503 修正（用户报 `(5/&sby 5)`）**：连音里"带波音的音符 + 后一个同音"被我改坏了——我把"上一个音符带波音"
  也加进了**禁止合并**的条件（`lastEventHadGrace = curHasGrace || curHasMordent`），于是 `(5/&sby 5)` 的第二个 5
  **又弱响了一次**（应为延长）。正解分两种情况：
  ① **带波音的音符自己不能并入前一个**（它必须重新起奏并波动）⇒ 保留 `!curHasMordent` 守卫；
  ② **后一个同音可以并入带波音的音符** ⇒ `lastEventHadGrace` 只保留倚音那一项。并入的是 `lastMainEvIdx`
  指向的"**按住的主音**"事件，波动短音在开头、不会被吞 ✔。
  顺带修一处色块归属：带波音的音符其 `playheadSegs` 挂在**首个波音短音**上（不是主事件），
  所以连音合并追加拍段时要落到那个事件上——为此新增 `lastBlockEvIdx`（普通音符 = 主事件、带波音 = 首个短音），
  合并时 `durationMs` 仍加在 `lastMainEvIdx`（发声事件）、拍段加在 `lastBlockEvIdx`（色块事件）。
  验证：`(5/&sby 5)` ⇒ 波音 3 事件 + 后半小节 2 事件 = 5，且"按住的主音"时长 = 375 + 1000 = **1375ms**（中间无第二个起奏）；
  `(5 5/&sby)` ⇒ 前一个 5 奏满 1000ms、第二个 5 **在 1000 处重新起奏**并波动（共 6 事件）。
- **顺带修掉一个 tokenizer 缺陷**：`3[2/]&sby`（`&` 写在**倚音括号之后**）时 `sby` **不会挂到音符 `symbols`** ✗——
  `collectSuffixes` 遇到 `[` 就 `break`，而括号是主循环解析的、解析完直接 `continue` ⇒ 括号后的 `&sby` 变成独立 decoration
  （`3&sby[2/]` 才正常）。已在括号解析后补一段"续接依附音符的 `&` 编码"（`&zkh/&ykh/&hx` 仍按既有规则独立化）。
  这条也是本轮"演奏读 `symbols`"才暴露出来的：**渲染走 decoration 路径看着没问题，但数据没落到音符上**。
- **验证**：smoke 新增 **20 项断言（`[119]`）**：守恒不变式、主音保留 ≥ P/2、单/复 steps、上/下邻音、`clamp(P/8,45,110)` 四档取值、
  长音符占比、极短音符降级、八度回卷、`+` 优先取码、四个真实播放序列（`3&sby` / `3&xby` / `3&sby+` 的 atMs+时长+音高）、
  后续音符仍整拍、极短主音符不越界、倚音+波音共存、括号后 `&sby` 挂载。
  另更新 `[92]` 真实谱回归（`adj362` 三遍跳跃结构）——该谱含两处 `&sby`、段B 走两遍 ⇒ 事件数 56 → 64，
  并把音高映射从 `placed.audioPitch` 改为**实际发声音高** `e.pitch ?? placed.audioPitch`，让邻音也纳入回归覆盖。
  `tsc -b` / `lint`（0 error）/ `build` / `smoke`（ALL PASSED）/ `preview:render`（0 错误谱）全过。
  文档：`docs/SYNTAX.md` 新增「波音的演奏时值」小节（六条口径 + 与倚音/连音/现代记谱的关系），并注明
  `3&sby` 与 `3[2/]&sby` 等价。
- **预防**：① **装饰记号的"画"与"奏"是两条数据通路**——渲染可以靠独立 decoration token，演奏却要读音符自己的字段；
  实现演奏前先确认"这个记号是否真的落在音符对象上"（本轮若不做这步，`3[2/]&sby` 会静默不发声）。
  ② 给"块内后缀"加语法（`collectSuffixes`）时，**任何让后缀收集中断的字符**（本轮是 `[`）都要检查"之后还能不能接着写"。
  ③ 记号的时值规则一旦定成"从主音符匀出"，就**必然与已有倚音规则争同一份预算**——把两者的顺序与预算关系写进文档与断言
  （先倚音、后波音，都在同一个主音符预算里匀、总守恒）。
  ④ **连音合并的守卫要分方向看**：`A B` 合并与否，取决于"B 能不能并入 A"，与"B 自己是什么"是两件事——
  本轮就是把"带波音的音符不能并入别人"错推广成了"带波音的音符不能被别人并入"，导致 `(5/&sby 5)` 多响一次。
  写这类守卫时**把两个方向分开写、并各配一条断言**（`(5/&sby 5)` 与 `(5 5/&sby)` 两个方向我都补了）。

### E-2026-213 dock 五页签懒加载（启动 −170KB）/ 页签栏移到底部 / 两条调整线统一 / 关于面板居中（adj497–adj501）
- **场景**（用户四条要求）：①「将底栏 dock 里的各页签做成懒加载，首次打开时才加载，以加快主进程的启动速度」；
  ②「页签栏放在底部会不会更好，不然因为高度不一，要点个页签需要上下找」；
  ③「底栏 dock 的高度调整线与分屏调整线的**线高/宽**和**鼠标形状**都不统一」；
  ④「关于的标题、版本、'用代码的严谨…'和支持作者行都设为居中对齐」+「图标应与标题靠一起，然后再居中」。
- **① 懒加载（adj497）**：`ToolDock` 里此前只有试听/设置/关于是 `React.lazy`，**告警与导出是静态 import** ⇒
  `ExportPanel` 那条依赖链（`export/export` 的 PDF、`export/audio` 的 WAV/MP3、`playback/spessaCache`、
  `spessaSynthBackend` 的 245KB WASM）**在启动时就被拉进主包并加载**。现九个面板全部 lazy。
  **实测**：入口 chunk **418KB → 248KB（−170KB，−41%）**；`ExportPanel`(168KB) / `ProblemPanel`(2.4KB) 独立成 chunk；
  入口**完全不再引用**那个 245KB 的 WASM chunk（只在 `ExportPanel` chunk 里引用）⇒ 它彻底离开启动路径。
  真机侧验证（同源 iframe + resource timing）：启动时抓到的只有 `index/rolldown-runtime/copy/spessaSynthBackend/jsx-runtime/docStore/ToolIcon/problems`，
  **没有 ExportPanel/ProblemPanel chunk**；逐个打开 5 个页签后它们的 chunk 才出现，且 5 个面板内容都正常渲染
  （告警 12 字 / 试听 137 / 导出 137 / 设置 205 / 关于 212，均非 Suspense 占位）。
- **② 页签栏移到底部（adj498）**：dock 的**底边固定在窗口底部**、顶边随拖拽与各面板默认高度上下移动 ⇒ 页签跟在顶边就要"每次上下找"。
  改为 flex `order`（抓手 0 → 内容 1 → 页签 2）而不是调 DOM 顺序：**DOM 仍是「页签 → 面板」**，读屏与 Tab 序不受影响，只改视觉顺序。
  分隔线随之由 `border-bottom` 翻成 `border-top`（放在内容与页签之间），并**去掉 border-bottom**——dock 下面是状态栏 `.footer`，
  它自带 `border-top`，两者叠起来会成双线。
- **③ 两条调整线统一（adj495/adj499）**：先量后改。实测（真实应用，574px 窄窗口 + `viewType=split`）：
  底栏线 `cursor=ns-resize`、分屏线 `cursor=row-resize` ⇒ **光标关键字不同**；且窄屏媒体查询 `@media (max-width:640px)`
  只把 `.split-divider` 加粗到 8px、**底栏线没跟上** ⇒ 粗细不一致（这正是用户看到的"线高/宽不统一"）。
  修法：① 光标统一为 `row-resize`（纵向分屏线仍 `col-resize`，方向不同必须不同）；
  ② 删掉那条 ≤640 的特例；③ **厚度收敛成一个共用 token `--jp-resize-h`**（theme.css，`(pointer: coarse)` 下覆盖为 14px）——
  分屏线 `height`、纵向分屏线 `width`、底栏线 `flex-basis` 三处都取该 token ⇒ 以后只改一处、两条线**必然同步**
  （E-2026-206「同一几何量只能有一处定义」的同类教训）。改后实测三条全一致：厚度 6px、光标 `row-resize`、底色/握把完全相同。
- **④ 关于面板居中 + 图标贴标题（adj500/adj501）**：这四行（标题块、版本、页脚、支持作者）在**弹窗版本来就是 `textAlign:'center'`**，
  adj492 搬到 dock 改两栏布局时被我丢了。现恢复：正文与署名保持左对齐；品牌块 `justify-content: center` +
  文字块按内容定宽（`flex: 0 1 auto`，不再撑满）⇒ **「图标 + 标题」贴合成一组并整组居中**，口号在文字块内居中落在标题下方。
- **验证**：smoke 新增/改写 **16 项断言**（`[117]`/`[118]` 与 `[113]` 内 1 项）——五面板全 lazy、无静态面板 import、
  `PANELS.filter(everActive)` 守卫、页签 `order` 三值、分隔线翻边、共用 token 三处引用、粗指针只改 token、光标三处、旧 8px 规则已删、
  版本/页脚/支持作者居中而正文不居中、品牌块组居中。`tsc -b` / `lint`（0 error）/ `build` / `smoke`（ALL PASSED）全过。
- **预防**：① **面板类组件一律 `React.lazy`**——静态 import 一个面板会把它的整条依赖链（本例含 245KB WASM）拖进启动路径；
  判断标准很简单：**"用户首屏一定要看到它吗"**，不是就不进主包。改造后用"入口 chunk 大小 + resource timing"两个数各自验证。
  ② 给 `flex` 子元素改视觉顺序用 `order`，**不要**直接调 DOM 顺序（会改掉读屏/Tab 序）；同时记得把"跟着方向走"的边框/分隔线一起翻过来。
  ③ **同一几何量只留一处定义**（本条是第 N 次同类教训）：两条线的粗细一旦写成两个字面量，早晚一个改一个不改。
  ④ 写源码扫描断言时**不要用"窗口正则"**（`[\s\S]{0,260}`）做否定判断——它会越过规则边界误伤后面的内容（本轮 `<about-brand>` 的
  否定断言就被 `.tool-dock-body{flex-direction:column}` 命中而假失败）；**先精确取出规则体再判断**。

### E-2026-212 设置默认高度改 6 行 / 「关于」迁入底栏 dock / 分隔条手指命中区（adj492–adj494）
- **场景**（用户三条要求）：①「打开设置时调整高度为显示内容 6 行的高度」；②「将关于对话框的内容移到底栏 dock 中」；
  ③「打开关于栏时应以能够显示全内容为宜」；④（同时报的 bug）「现场的拆分屏的拖动框又拖不动了，调整不了分屏的大小」。
- **① 设置 6 行**：`ToolDock` 的 `SETTINGS_ROWS` 由 5 → **6**（高度 = 外壳 58 + 面板内边距 18 + `rowPitch × SETTINGS_ROWS`，
  窄屏再 + 按钮行）。`rowPitch` 仍是运行时实测的字段行高（与告警的纯文字行高 `ROW_H` 解绑）。实测宽屏 dock 高 189px（≈6 行）。
- **② 关于迁入 dock**：照 `adj462` 把「试听/导出/设置」搬进底栏的同一套路——
  `DockPanelKey` 加 `'about'`；`ToolDock` 的 `PANELS`/`TABS` 各加一项（页签 `ⓘ 关于`，暂无对应设计图标故用字符兜底）；
  `AboutDialog` 增加 `inline` 参数（`<Modal inline>` 只交内容）；顶栏菜单「关于(&A)」由 `openModal('about')` 改为
  `toggleDock('about')`（入口保持原位、改为开关）；`App.tsx` 删掉 about 弹窗渲染与懒加载。
  顺带把 `AboutDialog` 的内联样式改成 CSS 类：新增 `.about-panel`（宽屏「左品牌块 + 右正文」两栏、窄栏竖排），
  原来的 `palette` 内联渐变改用品牌 CSS 变量（`--jp-deep-space-blue` → `--jp-neon-cyan`）。
- **③ 关于按内容自适应高度**：把 `'about'` 加入 `AUTO_FIT`（该机制的注释原写"试听/导出"）——
  它是**实测 `pane.scrollHeight`**（不受当前可视高度影响，恒为内容自然高），并在 dock 宽度变化 / 懒加载 chunk 到位后复测。
  验证：宽屏 内容自然高 192 == 可视高 192 ⇒ **完整显示无需滚动**；窄屏 283 == 283 ⇒ 同样完整显示。
- **④ 分隔条"拖不动"**：先复现——真实应用探针（合成 pointer 序列）测出 **mouse 与 touch 两种序列都能正常改分屏比例**
  （第 1 个窗格 587 → 707，`flex: 0 0 50%` → `60.22%`），`elementFromPoint` 也确认中心命中的就是分隔条本身
  ⇒ **事件处理没坏**（`touch-action: none` + Pointer Events 都在起作用）。
  真正的原因是**手指点不中**：分隔条视觉只有 5px（粗指针档 14px），而手指触点约 40px，偏向一侧就落到窗格上变成滚动。
  修法：`@media (pointer: coarse)` 下用 `::before` 向两侧各扩 12px 做**隐形命中区**（伪元素参与命中测试、事件 target 仍是分隔条），
  有效命中区 14 + 24 = 38px；**只在粗指针生效**（鼠标环境不加，否则会挡住窗格边缘的点击与选择）。
- **验证**：真实应用探针（`dist` 起静态服务 + 同源 iframe）宽窄两档：dock 页签 5 个（告警/试听/导出/设置/关于）、
  关于面板含 Logo/版本串/支持作者按钮且内容完整显示、设置面板高度 ≈6 行、关闭按钮仍在；
  smoke 新增 **11 项断言（`[116]`）**：`SETTINGS_ROWS = 6`、设置高度仍按自身行高算、`DockPanelKey` 含 about、
  PANELS/TABS 含 about、`AboutDialog` inline、顶栏菜单改为 `toggleDock('about')`、App 不再渲染 about 弹窗、
  `.about-panel` 三类名、**关于纳入 AUTO_FIT**、分隔条粗指针隐形命中区、命中区只在粗指针生效（用大括号配对抠掉
  `@media (pointer: coarse)` 整块后再断言）。
  `tsc -b` / `lint`（0 error）/ `build` / `smoke`（ALL PASSED）全过。
  文档同步：`DEPLOY-PWA.md` §5.6（"看「关于」里的版本号" → "看底栏「关于」页签的版本号"）、`VERSIONING.md` 展示位置一节。
- **预防**：① 面板类内容"打开就该看见全部"的，一律走 `AUTO_FIT` 实测，不要用常量猜高度（内容随宽度重排，常量必失准）；
  ② 从弹窗迁 dock 的清单是固定的五步（`DockPanelKey` → `PANELS`/`TABS` → 组件加 `inline` → 入口改 `toggleDock` → 删 App 里
  的弹窗渲染），**漏掉最后一步就会"既在 dock 又在弹窗"**（本轮靠 smoke 断言 `App 不再渲染 about 弹窗` 钉住）；
  ③ 触摸设备上"拖不动"的第一嫌疑是**命中区太小**而不是事件类型——先量 `elementFromPoint` 与元素尺寸，
  再动事件代码（本轮若直奔事件代码就会白改）；④ 只在粗指针下放大的命中区**必须写在 `@media (pointer: coarse)` 里**，
  否则会悄悄吃掉鼠标用户对窗格边缘的点击。

### E-2026-211 dock 右上角 ✕ 关不掉（adj487 重构时连带删掉了 `if (!dockOpen) return null`）+ 窄屏下 ✕ 被推出可视区（adj491）
- **场景**（用户报）：「底栏 dock 右上角的关闭按钮无法关闭」。点 ✕ 没有任何反应（面板照样在）。
- **根因 ①（主因）**：`ToolDock` 里控制"是否渲染"的早退守卫 **`if (!dockOpen) return null` 不见了**——
  它在 `adj487`（把 dock 高度拖拽从 `mousedown + mousemove/mouseup` 改成 Pointer Events）时被**连带删除**：
  那次编辑的 `old_string` 恰好把「拖拽 effect + 空行 + 守卫 + startDrag」整块换成了「注释 + startDrag」，
  守卫就夹在中间被一起吃掉。于是点 ✕ → `closeDock()` → `dockOpen=false`（**状态是对的**）→ 但组件照样
  渲染 ⇒ 表现为"关闭按钮失灵"。这类"按状态决定渲染与否"的守卫**极容易被重构误删、且没有任何编译/类型报错**。
- **根因 ②（次因，顺带发现）**：窄视口下 ✕ 会被**推出 dock 之外**。`.tool-dock` 用了
  `container-type: inline-size` + `overflow: hidden`，实测（同源 iframe 探针测 390×844 视口）`.tool-dock-tabs`
  被撑到 **974px**（dock 只有 384px 宽）——`margin-left: auto` 因此算出 666px 左外距，把 ✕ 推到 `x=494`
  （dock 之外）→ 被 `overflow:hidden` **裁掉** ⇒ 手机上根本看不见 ✕，自然也点不到。
- **解决**（adj491）：
  1. **恢复守卫** `if (!dockOpen) return null`，并在注释里写明这次被误删的前因后果。
  2. `.tool-dock-tabs` 加 `width: 100%; min-width: 0`（显式约束到 dock 宽）+ `overflow-x: auto`
     （超窄时页签横向滚动兜底）+ `scrollbar-width: none` / `::-webkit-scrollbar { display:none }`
     （工具条不该出现滚动条）；`.tool-dock-tab` 加 `flex-shrink: 0; white-space: nowrap`
     （页签不被压缩变形）；`.tool-dock-close` 加 `flex: 0 0 auto`（**✕ 永不被挤压出可视区**）。
  3. 粗指针设备（手机/平板）把 ✕ 命中区由 26×18 放大到 `padding: 10px 14px`（与 adj487 给调整条/分隔条
     加宽同一理由：手指点不中）。
- **验证**：真实应用探针（`dist` 起静态服务 + 同源 iframe + 点顶栏「设置」开 dock → 量 `getBoundingClientRect`
  → 在 ✕ 的 9 个点位做 `elementFromPoint` 命中测试 → `close.click()` → 查 dock 是否消失）：
  - **窄视口**（390×844）：dock 526 宽 / tabs 526 宽（已约束）/ ✕ 在 `(494,516)` ⇒ **在可视区内 = true**；
    三点命中测试全部 `tool-dock-close`；点一次 → `dock 存在=false` ✔；重开再点 → 再次 `false` ✔（稳定）。
  - **桌面**（1280×900）：✕ 在 `(1222,614)`、右缘 1248 ≤ dock 右缘 1280 ⇒ 在可视区内；点击两次均 `false` ✔。
  - smoke 新增 **5 项断言（`[115]`）**：`if (!dockOpen) return null` 守卫在位（**回归护栏**）、✕ 接线到
    `closeDock`、tabs 的 `width:100%`/`min-width:0`、`overflow-x:auto` + ✕ `flex:0 0 auto`、
    粗指针放大命中区。全绿；`tsc -b` / `lint`（0 error）/ `build` / `smoke`（ALL PASSED）全过。
- **预防**：① **重构/替换代码块时，块首尾之间的"小守卫"最容易丢**——替换前把 `old_string` 里的每一行
  都过一遍"这行还要不要"，尤其是 `if (!xxx) return null` / `if (guard) return` 这类早退；
  ② 本轮同类教训还有 `E-2026-208`（adj487 那次改动引入的触屏问题）——`adj487` 这一处重构同时埋下了
  两个 bug（触屏拖不动、✕ 关不掉），**说明"小重构"同样要跑一遍完整验证**（不能因为"只是换事件类型"就跳过）；
  ③ 给"渲染与否"的守卫补 **smoke 源码断言**（编译器和类型系统都不会管它）；
  ④ 面板/工具条的固定按钮（关闭、更多）**必须显式 `flex: 0 0 auto` 并验证它在最窄视口下仍在 `getBoundingClientRect`
  的父容器范围内**——`margin-left:auto` 在父容器被内容撑宽时会把按钮推到可视区之外，配合 `overflow:hidden` 就是"按钮消失"。

### E-2026-210 底栏 dock 试听页签下，点击预览音符无法从该音符开始播放（adj490）
- **场景**（用户报）：把试听从弹窗移到**底栏 dock 的「试听」页签**后（0.24.0，adj462），
  暂停或停止时**点击预览区的音符**不会从该音符开始播放。
  双击跳转、播放中双击快速跳跃（adj158）也连带失效。
- **根因**：`PreviewPane.onClick` / `onDoubleClick` 判定"试听可达"只写了 `modal === 'playback'`——
  但**底栏 dock 的试听页签并不设 modal**：顶栏的「试听」按钮只调 `toggleDock('tryout')`，
  调 `openModal('playback')` 的只有 Ctrl+Q 这条快捷键（adj168）。
  所以"打开 dock 试听 → 点预览音符"的常见路径上 `modal !== 'playback'`，整套跳转播放链路被跳过。
  这是从**弹窗模式**迁到**底栏 dock 模式**时漏掉的——弹窗时 modal 自然就是 'playback'。
- **解决**（adj490）：把判定改成「弹窗 modal **或** 底栏 dock 当前在试听页签」——
  ```ts
  const isPlaybackOpen = modal === 'playback' || (dockOpen && dockPanel === 'tryout')
  ```
  onClick 与 onDoubleClick 共用此谓词。`onDoubleClick` 之前是 `if (modal !== 'playback') return`
  （弹窗模式下单击已触发、双击不再重复；adj284），dock 模式下单击/双击**都会**触发跳转。
  uiStore 端不动——`playbackStartId` / `bumpPlaybackTick` / `play()` 链路本身没问题。
- **验证**：① 真实应用（dist 起静态服务 + 同源 iframe 探针：开 dock 试听 → 点击第 3 个音符 → 等约 600ms）
  → 播放按钮由「**播放**」变为「**暂停**」，确认从该音符开始播放 ✓。
  ② smoke `[114]` 新增 3 项源码断言：`isPlaybackOpen` 谓词同时识别 modal 与 dock；
  onDoubleClick 同样接受 dock；PreviewPane 已从 uiStore 订阅 dockOpen / dockPanel。
  ③ `tsc -b` / `lint`（0 error）/ `build` / `smoke`（ALL PASSED）全过。
- **预防**：① 凡"上下文在某处可达"类的状态（如「试听打开」「编辑器获得焦点」「弹窗可见」）——**统一抽出布尔谓词**
  并从 store 订阅各维度（modal / dockOpen / dockPanel 等），不要在调用点散落 `if (modal === X) return`。
  ② 把行为从「弹窗模式」迁到「dock 模式」时，**所有 `modal === 'X'` 守卫都要重审**——dock 通常不设 modal。
  ③ UI 行为类问题**用真实应用探针验**——源码扫描 + smoke 只能证伪代码路径，看不见的运行时副作用（如本例的"点了但没反应"）
  必须在 iframe + 脚本派发合成事件 + 读 DOM 侧效（按钮 label 变了没）才能确认。

### E-2026-209 倚音时值规则细化：短倚音按减时线数定组时值、组内均分；主音符不够时向前/后借（adj489）
- **场景**（用户细化需求）：旧规则 `3[3/2/]` = 「1/4 + 1/4 倚音、主音符余 1/2 拍」——两个倚音各自占满 1/4 拍，挤掉了主音符一半。
  用户的演奏口径是**短倚音按减时线数定「组时值」、组内均分**——
  - `3[2/]` 组时值 1/4 拍（单倚音占满 → 1/4）；
  - `3[3/2/]` 组时值 1/4 拍，两个**均分**各 1/8 → 主音符余 3/4 拍；
  - `3[2/1/2/]` 组时值 1/4 拍，三个各 **1/12** → 主音符余 3/4 拍。
  长倚音组时值 = 主音符 / 2，组内均分（`3.[2]` = 3/4 + 3/4）。
  当主音符 ≤ 组时值时**向前（前倚音）/ 后（后倚音）借**——
  主音符不够的部分**从前/后主音符里扣**，两主音符总时值不变；组长 > 两主音符总长时只能装下这么多。
- **根因**：旧规则 `graceNoteBeats(n) = 1 / 2^(n+1)` 是**逐个**倚音的时值，多倚音时 `Σ` 偏紧，
  短谱面（`3[3/2/]` 主音符只有 1 拍）常误报「Σ > 总时值」；而且组时值口径没与用户对齐。
- **解决**（adj489）：① 新增 `graceGroupBeats(token, principal)`（`spaceLayout.ts`）——组时值 = 短 `1/2^(beam_count+1)`、长 `principal/2`；
  `gracePerNoteBeats(groupBeats, count) = groupBeats / count`；保留 `graceNoteBeats(n)` 仅作单倚音兼容名。
  ② 播放循环（`playback/sequence.ts`）改用组时值：主音符新时值 = 原时值 − 组时值；
  不够装则 `prev_consume = min(prev_orig, shortfall)`、principal_new = principal_orig − (shortfall − prev_consume)，
  最后把 `events[lastMainEvIdx].durationMs -= prev_consume` 落到前主音符事件上；
  后倚音反向同理（先 patch 下一个主音符事件——当前实现把后向借用留作 TODO，详见下文）。
  ③ 解析侧删掉了旧的「Σ > 总时值」报警——借用机制接管，不再让书写报警。
  ④ 谱面渲染**未变**（宽 / 槽位计算仍按旧规则），所以 .jps 文件本身的谱面长相完全一致；**只改播放时值**。
- **可观察的兼容性差异**：`3[3/2/]` 的主音符从 1/2 拍（旧）变为 3/4 拍（新），每个倚音从 1/4 拍（旧）变为 1/8 拍（新）——
  既有 .jps 文件打开后**演奏时值会变**，谱面长相不变。
- **验证**：smoke `[92]` 段从 6 条 adj396 断言**翻新为 15 条 adj489 + 保留 7 条 adj396 解析/渲染**：
  - `3[2/]` / `3[h2/]` 单短倚音（与旧口径一致，回归护栏）；
  - `3[3/2/]` 组时值 1/4 + 两倚音各 1/8 + 主音符 3/4；
  - `3[2/1/2/]` 组时值 1/4 + 三倚音各 1/12；
  - `3[2]` / `3[32]` 长倚音组时值 = 主音 / 2、组内均分；
  - **借用**：`5/,/6/,//[2/] 1` 前主音 1/16 + 主音 1/16，组时值 1/4 > 1/16 → 借足（assertion 验证前主音时长被扣）；
  - `3 -[h5/]` 增时线 + 后倚音 → 主音符 1.75 + 末尾 1/4、总长仍 3 拍。
  全部绿；`preview:render` 7 谱 errors=0；`tsc -b` / `lint`(0 error) / `build` 全过。
- **已知边界**：① 后倚音向后借当前实现暂留 TODO——主音符保持原时值，借走量没 patch 到下一个主音符事件；
  实践里「后倚音组时值 > 当前主音符」很罕见（要后倚音比主音符还长），待真撞到再补。
  ② 假设**组内所有倚音减时线数一致**——与现有写法一致；不一致时 `graceGroupBeats` 取最大值（保守、对齐旧行为）。
  ③ `5/[2//]` 这种"主音符 = 1 拍、组时值 = 1/8"的情形走"够装"分支（principal_new = 7/8），不触发借。
- **预防**：① 倚音时值口径一旦调整，**所有 .jps 既有文件的播放时长都会变**——务必先把"组时值 + 均分 + 借用"的语义写到 SYNTAX（§2.5），再用 smoke 的多组样本钉死每条规则。
  ② `graceNoteBeats` 保留作「单倚音兼容名」但**不再被新代码使用**——后续如果有人误用旧函数算「Σ 各自时值」会得到错误结果，**新代码一律用 `graceGroupBeats` + `gracePerNoteBeats`**。
  ③ 「借用」本质是**相邻主音符时值的预算调度**——`buildPlaySequence` 的事件序列是一维时间轴，借用就是 patch `events[idx].durationMs`；未来若引入多声部对齐或节拍量化规则，**借用策略要重新审视**（不能让一个声部的借时影响另一个声部的拍位）。

### E-2026-208 手机浏览器上 dock 调整条 / split 分隔条拖不动（adj487）+ 试听面板「调式拍号」与「作者」位置对调（adj488）
- **场景**（用户两条反馈）：① 手机浏览器上，**底栏 dock 与编辑区之间**、**编辑区与预览区之间**的调整条**完全拖不动**；
  ② 试听面板的曲目信息里，「调式/拍号」和「作者」两段文本的顺序想对调一下。
- **根因 ①**：调整条与 split 分隔条的拖拽都是 `onMouseDown={…}` + `window.addEventListener('mousemove'/'mouseup')`——**只响应鼠标**。
  手机的手指落下不产生鼠标事件，只产生 `pointerdown`/`pointermove`/`pointerup`（以及兼容的 `touch*`），
  所以 `mousemove` 一条都收不到 ⇒ 拖不动。`PreviewPane` 的描述头 / 辅助虚线拖拽（`onMetaMouseDown` / `startDrag`）也是同样毛病。
  光换成 Pointer Events 还不够——浏览器默认把手指的移动当成「滚动/缩放」自己消费掉，`pointermove` 压根不派发；
  CSS 必须给拖拽元素 `touch-action: none`。
- **解决 ①**（adj487）：① 新增 `src/ui/dragGesture.ts` 的统一入口 `beginDrag(e, { onStart, onMove, onEnd })`：
  `onPointerDown` → `setPointerCapture`（保证手指/鼠标划出元素仍能收到 move） + `window.addEventListener('pointermove'/'pointerup'/'pointercancel')`，
  按下点作原点返回 `(dx, dy)`；同时给 `touch-action: none`（`.tool-dock-resize` / `.split-divider[-h]` / `.guide-line`）。
  ② 全部切到 Pointer Events：`ToolDock` 的 resize 把手、`App.tsx` 的两个 split 分隔条（上下 + 左右）、
  `PreviewPane` 的 `onMetaPointerDown` 与 `startDrag(spec, e: React.PointerEvent, …)`。
  ③ **粗指针设备（手机/平板）放大命中区**：`.tool-dock-resize` 5px → **14px**、`.split-divider` 5px → **14px**
  （`@media (pointer: coarse)`，桌面不受影响），原 5px 手指很难抓住。
- **解决 ②**（adj488）：`PlaybackDialog` 的 `playback-meta` 子元素顺序改为
  `playback-title` → `playback-key`（C调 + 拍号） → `authors`——**作者写在前面**（看谱先想"谁写的"再看"什么调"），
  调式/拍号仍是次级灰色行。
- **验证**：
  - 听/看的部分：真实应用（dist 起服务 + 同源 iframe 探针点开试听）**DIAG 确认**——
    `playback-title: 未命名 | dock-muted playback-key: C调 4/4 | dock-muted: 佚名词曲`，索引 `title=0, key=1, auth=2`，**顺序正确 ✓**。
  - 拖拽的部分：smoke 新增 **7 项断言（`[113]`）**——`beginDrag` 用 Pointer Events + setPointerCapture + pointermove/up/cancel；
    三个拖拽元素均有 `touch-action: none`；`@media (pointer: coarse)` 把 5px 调到 14px；
    `ToolDock`/`App` 改为 `onPointerDown`；`PreviewPane` 描述头 + 虚线也用 Pointer Events；
    `startDrag` 签名 `e: React.PointerEvent`；App/ToolDock 已不再用 `mousemove`/`mouseup` 装拖拽监听。**全绿**。
  - **端到端手测清单**（headless Chrome 对合成 PointerEvent 的 React 委托路径不能完整还原真触屏，**需真机验证**）：
    - 手机浏览器打开应用 → 拖 **dock 顶部调整条**上下，dock 高应变；
    - 拖 **编辑区与预览区之间的 split 分隔条**，窗格占比应变；
    - 上述拖动过程不应触发页面滚动 / 缩放（说明 `touch-action: none` 生效）。
- **预防**：① 凡「按下一个东西拖动」的交互，**必须走 Pointer Events**（不要只监听 mouse），
  并给元素 `touch-action: none`（否则触屏上 move 事件根本不派发）；② 5px 的命中区在触屏上几乎不可抓，
  `@media (pointer: coarse)` 加宽到 12–14px 是必要的人因工程；③ 头lessly 验证触屏交互**只能验代码/样式结构**（smoke 源码扫描），
  **真机手测不可省**（headless Chrome 的合成 PointerEvent 经 React 委托后可能不刷状态——本次就是个例子）。

### E-2026-207 窄底栏「间距(px)」标题与字段挤在同一行（隐式网格列）+ 浅色主题下未设色文本看不清（主题属性挂错层）（adj483/adj484/adj486）
- **场景**（用户两条反馈，都是真实应用里看到的）：① 窗口宽 500 时，设置 → 谱面 页签里「间距(px)」本是**分组标题**，却被当成一个内容项、与「描述头高」并排；② 浅色主题下音色库的「通用音源（GeneralUser GS）」等文本与背景过近、看不清。
- **根因 ①（隐式列）**：字段网格是 `repeat(auto-fill, minmax(var(--pcfg-field-w), 1fr))`，跨格用 `grid-column: span var(--pcfg-span)`。窄底栏（≤560px）时容器查询把网格压成**单列**，而 JS 算出的 `--pcfg-span` 仍是 2（按"自然宽 ÷ 格宽"算，不知道当前有几列）⇒ `span 2` 在只有 1 条**显式**列时**新建一条隐式列**（`grid-auto-columns: auto`）；分组标题的 `grid-column: 1 / -1` 只跨**显式**列，于是标题占第 1 列、后续字段被塞进隐式列 ⇒ 标题与字段同行。（实测：字段区 `grid-template-columns: 211px 192px` —— 两条列宽不等，正是"一条显式 + 一条隐式"的特征。）
- **解决 ①**（adj483）：① JS 侧把跨格数**钳到当前实际列数**（`cols = floor((clientWidth + gap) / (cellW + gap))`，`span = min(cols, …)`）；② 容器宽度变化（拖 dock / 窗口 resize）→ `ResizeObserver` 重测（列数变了跨格数要跟着变）；③ CSS 侧窄栏（`@container (max-width: 560px)`）直接 `grid-column: auto` 作为首帧兜底。
- **根因 ②（主题属性挂错层）**：主题调色板是**属性选择器** `[data-theme]` / `[data-mode='light']`（`styles/theme.css`），属性原先挂在 `.app`（`App.tsx` 的根 div，**body 的子元素**）上；而 `index.css` 里 `body { color: var(--jp-text-primary) }` 是在 **body** 处**求值**的——那时只有 `:root` 的**深色**默认值 ⇒ body 及其下**所有没显式设色**的文本继承到"深色主题的浅字"。浅色主题里，音色库那行的库名 `<span>`（唯一没设色的）于是白底浅字（实测对比度 **1.18**，几乎不可见）；其它文本因为都显式用了 `var(--jp-text-secondary/muted)` 才没事。
- **解决 ②**（adj483）：把 `data-theme` / `data-mode` **同步挂到 `<html>`**（`documentElement`），`:root` 与主题属性落在同一元素上、变量从根上就对（浅色块在后、同特异性后者胜），`.app` 上的属性保留给"按 `.app[data-mode]` 取用"的样式/嵌入方。实测库名对比度 **1.18 → 15.13**。
- **同批顺带完善**：
  - **adj484 浅深模式按钮**（用户报"图标与文本没对齐、按钮太窄、两侧没留白"）：`.theme-mode-btn` 改 `inline-flex + align-items/justify-content: center + gap`（此前是普通按钮，16px 图标是 inline-block、底边贴 12px 文本基线 ⇒ 看着偏上）+ `padding: 4px 10px`（此前 `4px 0` 文字贴边）+ `min-width: 72px`（三个按钮等宽），图标改用 14（对话框口径，与 12px 文本同高）。
  - **adj486 底栏页签图标**（用户报"还是沿用顶栏上按钮的图标"）：告警/试听/导出/设置四个页签此前用 **Unicode 字符**（`⚠ ▶ ⬇ ⚙`）当图标，与顶栏那套用户设计的线稿图标不是一路货；现试听/导出/设置改用 `ToolIcon`（`play` / `export` / `settings`，与顶栏同一个文件、size 14），并按"统一占位 + 居中"重排图标位（`.tool-dock-tab-icon`）；**告警暂无对应设计图标**，暂留 `⚠` 字符（等用户补图后替换）。
- **验证**：`npm run smoke` 新增 **11 项断言（`[111]`/`[112]` 与 `[110]` 内 3 条）**：跨格数钳列 + ResizeObserver + 窄栏取消跨格、`data-theme`/`data-mode` 挂 `documentElement`、`body` 继承色仍取主题变量、页签用 `ToolIcon` 且不再出现 `▶ ⬇ ⚙`、图标位居中、浅深按钮的居中/留白/最小宽度/图标 14；全绿；`tsc -b`/`npm run build`/`npm run lint`（0 error）通过。
  并**在真实应用里逐项复核**（`dist` 起静态服务 + 同源 iframe 探针点开「设置 → 指定页签」+ 无头 Chrome 截图 + 读计算样式）：窗口 500 时字段区 `模板=421px`（单列）、标题 `grid-column=1/-1` 宽 421 = 面板宽、同行右侧元素为空；窗口 1400 时 4 列、边距行 `span 2`、标题跨满 1162；浅色主题下库名 `color=rgb(28,37,64)` / 对比度 15.13；浅深按钮与底栏页签截图目视确认。
- **预防**：① **`grid-column: span N` 会造隐式列**——凡是"跨格/跨列"的布局，跨格数必须按**当前实际列数**钳制，且列数随容器宽变化时要重算（`ResizeObserver`）；`1 / -1` 只覆盖**显式**轨道，别指望它兜住隐式列；② **主题/模式属性要挂在**变量**被求值的那一层或更高**——`body` 上的 `color: var(…)` 在 body 处求值，属性挂到它的子元素（`.app`）上就会拿到上一层的旧调色板；新皮肤/新主题一律挂 `<html>`；③ **"未显式设色的文本"是浅色主题的隐形地雷**：截图核对时除了看主要内容，也要扫一眼"没有指定颜色的继承文本"（音色库这行就是唯一一处）；④ UI 类问题**先在真实应用里复现再动手**——本轮的窄栏与浅色主题两个问题，自建对照页都复现不出来，是 iframe 探针（真实 bundle + 真实样式）一跑就现形。

### E-2026-206 底栏「设置」的内容项对齐差（流式排列 + 标签长短不一）——改为「按当页最长标签」的等宽字段网格（adj482）
- **场景**：用户报「设置里的内容项由于是流式排列，又由于标签长短不一，导致内容对齐效果差」，要求**取当页内最长标签长度为基准**对齐各控件。
- **根因**：adj463b 把 dock 的设置面板做成**流式 flex**（分组标题独占一行、字段项整项不可压缩地换行排列）⇒ 每个字段的宽度随自身"标签 + 控件"变化：标签长短不同、控件宽度不同（一个数值框 52px、下拉 ~90px、"边距"四个数值框 ~290px、带长说明的勾选项更宽），于是**同一行里的控件落点参差**、跨行更不成列，整片看着杂。窄 dock 下还退化成"标签在左、控件右对齐到行尾"，与宽 dock 口径也不一致。
- **解决**（adj482，用户要求的口径）：dock 里把字段区换成**等宽字段网格**：
  1. `--pcfg-label-w` = **当页最长标签宽**（JS 实测）⇒ 每格的标签列一样宽、控件左缘对齐；
  2. `--pcfg-field-w` = 一格基本宽（= 标签列 + 控件区最小宽 `CTL_MIN_W`）⇒ 各格等宽、跨格成列；
  3. 每行 `--pcfg-span` = 该字段自然宽需要跨几格 ⇒ **宽字段跨 2 格**（"边距"的四个数值框、带长说明的勾选项），既不折行、也不把整页格子撑宽；分组标题与说明文字 `grid-column: 1/-1` 跨整行；
  4. 窄 dock（≤560px）退化为单列且**仍用同一标签基准**（不再把控件右对齐到行尾）；
  5. 测量只在 dock 里跑（弹窗宽度固定，保留原 `.pcfg-grid2` 两列布局），重算时机 = 页签切换 + 字段增删/文本变化（MutationObserver + rAF 合并）。
- **过程中的两个坑**（都已修，且加了断言守着）：
  1. **Row 的内联样式压过 CSS**：字段行的 `display:flex/align-items/gap/margin` 原写在组件的内联 `style` 里 ⇒ dock 里的覆盖规则（`display:grid` + 标签列）**永远不生效**（现象是"规则明明写了却没变化"）。已把基样式搬进 `index.css` 的 `.pcfg-row`/`.pcfg-row-label`/`.pcfg-row-ctl`（外加新的 `.pcfg-note`），组件只留类名；smoke 断言"Row 里不得再出现 `style={{`"。
  2. **测量手段**：先试"给真实面板临时加测量 class 摊开字段"——控件容器是 `flex: 1`（flex-basis 0），`width: max-content` 会算成**几千 px 的假值**；改读容器宽又会被"说明文字"那类长行撑大。最终用**离屏克隆探针**（`.pcfg-measure-probe`：逐行 `width: max-content` + 不换行 + 控件不压缩，`position: fixed; left: -10000px`）读每行自然宽，读完即弃——不碰真实 DOM、不受覆盖规则胜负影响、也不会闪。
- **随访（用户报「间距(px) 本应是标题行，结果被当作内容项排列」）**：截图显示分组标题与「描述头高」挤在同一行 ⇒ 标题**没跨整行**、被当成一个字段格。修法：把"标题跨整行"从 `.pcfg-fields > .pcfg-group-title`（只认**直系**子元素）提升为从 `.pcfg-panel` 起的**后代选择器**（`.tool-dock .pcfg-panel .pcfg-group-title { grid-column: 1 / -1 }`）⇒ 不论标题被包在哪一层（`.pcfg-fields` 直系、某个页签自己再包一层、甚至写进 `.pcfg-grid2`）都不会再和字段同行；说明文字 `.pcfg-note` 同规则。**并用真实应用复核**：`dist` 起静态服务 → 同源 iframe 加载应用 + 脚本点开「设置 → 谱面/全局」→ 无头 Chrome 截图，实测 `间距(px)` 的 `grid-column=1/-1`、宽度 = 面板宽（跨满整行），1400px 下 4 列、820px 下 2 列、窄栏单列，标签与控件全部成列。
- **验证**：`npm run smoke` 新增 **9 项断言（`[110]`）**：网格三条规则（标签列/等宽格/跨格）在位、**标题跨整行（后代选择器）**、说明文字跨整行、窄 dock 单列退化、离屏探针、三个 CSS 变量写回、只在 dock 测量、**Row 无内联布局样式**（回归护栏）、行基样式在 CSS 里；`tsc -b` / `npm run build` / `npm run lint`（0 error）通过。另用无头 Chrome 渲染**真实样式表 + 同构 DOM** 的对照页（dock 宽 560/900/1280 + 字体页）逐档核对：实测 `labelW=96~108、cellW=236~256、spans=[1,2,1,…]`（只有"边距"跨 2 格）。
- **预防**：① **组件内联样式会压过样式表**——凡"某处（dock/嵌入）要覆盖布局"的组件，布局必须写在 CSS 类里，内联只留真正随数据变化的样式；② 需要"同类元素统一基准"的对齐，用**实测 + CSS 变量**（`max-content` 只能对齐同一网格的列，跨格等宽做不到）；③ 测量一律用**离屏克隆探针**，不要在真实 DOM 上做"临时改布局再读回"（既脆又可能闪）；④ 改 dock 面板这类**多栏 grid**（页签 | 内容 | 按钮）时，注意中栏自身别留 `display:flex` 之类的旧规则——它会把内层网格收缩成内容宽（本次就是这条旧规则让网格排不出来）。

### E-2026-205 「新建」模板文件 `未命名.jps` 被当成测试残留删掉（所幸构建产物里有副本）+ 新建模板改为文件驱动（adj481）
- **场景**：用户在 `public/` 下新建了 `未命名.jps`（准备作为「新建」的模板）。我收尾时看到 `git status` 里一个**未跟踪**的 `public/未命名.jps`、内容又恰好是内置默认样板，就判定为"测试残留"直接删了并写进了汇报——**误删用户资产**。
- **根因（流程）**：① 判定依据只有"未跟踪 + 内容像样例"，**没有先问文件来源**，也没查"是否有代码/文档引用它"；② 该文件名与内置 `NEW_FILE_TEMPLATE` 恰好同名同内容（用户当时就是照默认样板建的），"像"被当成了"是"。
- **恢复**：此前跑过 `npm run build`，`public/` 会被复制进 `dist/` ⇒ `dist/未命名.jps`（271 字节，时间戳一致）里还留着原文件，逐字节恢复 ✔。
- **同时落地的功能改动（用户要求，adj481）**：「**新建**」不再使用内嵌在 `src/samples/index.ts` 里的模板字符串，改为**文件驱动**——模板就是 `src/samples/未命名.jps`（Vite `import.meta.glob('./未命名.jps', { query:'?raw', eager:true })` 构建期内联）。想改"新建出来的空白谱什么样"，直接编辑该文件即可（重跑构建生效）；代码里只留一份**最小兜底**（文件缺失时用），不再保留模板副本。
  - 位置：原先放 `public/未命名.jps`，按用户要求移到 `src/samples/未命名.jps`——模板只在构建期被内联，**不必作为静态资源随产物发布**（在 `public/` 下的文件会被复制进 `dist/`、Web 端还能按 URL 直接下载）。
- **验证**：smoke `[99]` 改为断言**行为**而非格式：模板文件存在且非空、`defaultSample().code` == 模板文件内容（规范化换行后）、`src/samples/index.ts` 里不再有内嵌样板、`public/未命名.jps` 已不存在（不随产物发布）、模板能正常解析、`# jps-config:{}` 语义与写回可读回；smoke `[81b]` 走真实 store 流程断言"菜单「新建」正文 == 模板文件内容 + 文件名为「未命名」+ 页面设置 = 默认"；`npm run smoke` 全绿；`npm run build` 后确认模板已内联进 `dist/assets/docStore-*.js`（`#===` 分隔注释出现在产物里）且产物根目录**不再**有 `未命名.jps`。
- **预防**：① **删除任何"未跟踪文件"前必须先确认来源**——先问一句用户/先 grep 代码与文档引用，再做判断；"内容像样例/测试产物"不是证据（本次正是它像才删错）；② 汇报里提到的"顺手清理"如果涉及用户目录（`public/`、`samples/`、`src/`）尤其要谨慎，`public/` 下的文件会被打进发布物，属于**用户资产**而不是构建垃圾；③ 改"新建/示例"这类**内容来源**时优先文件驱动（本项目 adj423 的示例谱已这么做）——用户能直接编辑、无需改代码，也不会再出现"代码里的副本与文件不一致"；④ 用户资产类构建输入放**源码目录**（`src/`）而不是 `public/`：前者只在构建期被内联，后者会随产物发布。

### E-2026-204 「我把源码复制给别人，别人显示的不一样」——本机页面设置层让渲染依赖本机历史（用户确认取消该层）（adj480）
- **场景**：用户的目标是"**把脚本复制给其他人，其他人显示的应该和我一样**（字体跨机不确定可接受）"。实测不一致。
- **根因（用户判断 + 逐层核对确认）**：`PageConfig` 曾被当作三层「谱面 > 本机缓存 > 默认」，而**写入是差量的**（只写与默认不同的项）⇒ 凡"生效值来自本机缓存、谱面没写"的项，复制出去后由**对方的缓存/默认**决定 ⇒ 必然不一致。且这一层本身是"脏"的：`setPageConfig()` 无论是否持久化（含对话框实时预览、取消时回写快照）都把**整份生效配置**写进 `localStorage` ⇒ 它实际是"上一份谱的整份配置"，不是"我的默认设置"。用户追问后确认：**既然要求"必须值都进谱面"，本机缓存就没有存在意义**。
- **旁证**：新建文档从 adj214 起**已经不吃**这一层（`mergeJpsConfig(template, null)`，当时的动因正是"新建谱还带着旧的本机设置"）⇒ 删掉它几乎没有便利性损失；`ijipu.pageConfig` 只剩"给未自带设置的谱面兜底"这一个作用，而那正是问题本身。
- **解决**（adj480，阶段一 + 阶段二）：
  1. **应用侧取消 L1 页面设置层**：`resolveConfig()` 改为 `mergeJpsConfig(code, null)`；`setPageConfig()` 不再写 `localStorage`（预览态只改内存）；生效配置 = **代码默认 ← 谱面**。
  2. **保存即自包含**：差量写入（只写与默认不同的项）+ 无隐藏层 ⇒ "保存"就把"我看到的非默认部分"全部写进谱面 ⇒ 复制给别人效果一致。设置面板的「**固化到谱面**」按钮**删除**（已无存在意义）。
  3. **旧缓存一次性迁移**：`migrateLegacyPageConfig()` 删键，并在旧值确有非默认项时给一次可见提示（含项数），不静默吞掉用户的历史设置。
  4. **宿主侧（Obsidian 插件）**：插件设置 / 笔记 frontmatter 仍是"只对源内没写的项生效"的默认层（保留"改一处、全库统一变"的能力）⇒ 新增引擎 `configCarryover(code, effective)` 列出"未随谱携带"的项，工具栏徽标 + 设置对话框提示；对话框「随谱固化（分享用）」把**与引擎默认不同的全部生效项**写进谱面（此前是 `mode:'full'` 全量 ≈900 字符，现收敛为差量口径）；**拖拽写回统一为"只写本次改动"**（`mergeConfigEdits`）——此前插件拖一次虚线就把插件设置/frontmatter 的每个非默认项顺手烧进谱面（与应用口径不一致）。
  5. **文档同步**：`docs/SYNTAX.md`（**唯一对外口径**）把优先级改写为「源码 > 代码默认值」并说明宿主默认层与分享保真；`AGENTS.md` §七、`src/AGENTS.md`、`docs/SETTINGS-AUDIT.md` 同步。
- **验证**：`npm run smoke` 新增 **15 项断言（`[109]`）**：`configCarryover` 四种情形（自包含 / 未写设置行的缺口 / 谱面值与生效值不一致 / 等于默认值不算缺口）、docStore 不再写缓存键且改吃 `null` 兜底、迁移删键 + 提示文案 + 预览态不写缓存、**生效配置不吃旧缓存**（预置 `{margin_left:99,note_size:15}` 的旧键后仍为默认值）、"改一项 → 保存 → 换无缓存环境解析结果一致 + 该谱自包含"端到端；插件 smoke 新增 **6 项（`[10b]`）**：保存到谱面只含本次改动、本库层仍兜底、`configCarryover` 列出缺口、随谱固化写全非默认项且不写默认项、固化后换到应用无缺口 → `ijipu` 全绿、插件 **155 全绿**；两端 `tsc`/`build` 通过。
- **预防**：① **"隐藏默认层"是分享保真的天敌**——只要"生效值可以来自谱面之外的某个本机/宿主层"，"复制源码 = 效果一致"就不成立；凡新增此类层，必须同时给出"如何随谱携带"的显式动作与提示（本次的 `configCarryover` + 随谱固化）；② **写方向的差量口径要问"这个值是'谁的'"**（E-2026-194 的教训）：差量写入 + 隐藏层 = 静默不一致，两者不能同时存在；③ 删除一层时要回答"它原本还提供什么"——本次核对下来只剩"兜底未自带设置的谱面"这一个作用（新建早已不吃），所以代价几乎为零；④ **改动对外口径（`docs/SYNTAX.md`）必须同批完成**，否则文档仍在承诺一个已不存在的层。

### E-2026-203 声部行间距（`height_shengbu`）的虚线只能拖到 0 → 用户报「无法往负数的方向调」（adj479）
- **场景**：上一项（E-2026-202）补了设置入口后，用户改用**预览虚线**压缩声部之间的空白：往上拖到 0 就卡住，再拖也不动。
- **根因**：`GUIDE_LIMITS_EX.height_shengbu = [0, 300]`（adj72 定下时只考虑"加大间距"）；`PreviewPane` 的拖拽统一走 `clamp(startVal + delta, min, max)`，min = 0 ⇒ 负方向被钳掉。设置面板的输入框本身没有下限（能直接输负数），所以只有虚线这一条路堵着——表现为"拖不动"。
- **解决**（adj479）：范围改为 `[-30, 300]`。下限依据：该间距是**行高之外的额外间距**，行高本身已含行尾间距（无歌词 `height_ciqu` 20 / 有歌词 `height_ciqu_lyric` 10）与上一行歌词下伸 ≈2，故 −30 ≈ 默认配置下「上下两行内容刚好不压字」的极限（实测：有歌词时歌词行与下一声部数字仍有 ≈7px 净距；无歌词时两行数字刚好相切；−40 则开始压字——已用无头 Chrome 截图逐档核对）。同时把 `computeRowGuides` 的**声部序号判定下限放宽 1.5×字号**——负间距会把靠后的声部行压到块顶之上，原区间判定会落空并把该行误判成"单声部行"（那就会去改行距而不是声部间距）。
- **验证**：smoke 新增 7 条 `adj479` 断言（范围允许负值；拖拽换算向上拖 12px 得 −12、极限取 −30；−12 时第二声部上移 12 而第一声部不动；负值下声部序号仍为 1；−12 写回 `# jps-config` 并回读；默认 0 不写该字段）；`npm run smoke` 全绿；无头 Chrome 截图核对 0 / −20 / −30 / −40 四档（有歌词、无歌词两种谱）。
- **预防**：① **"允许负值"的间距项要逐个核对下限**——项目已有 `height_ciqu_lyric: [-80, 120]` 的先例，新增/调整间距项时默认写 `[0, …]` 是常见疏漏（`height_quci/cici/ciqu` 目前仍是 0 下限，用户若再报同类问题按此处理）；② **拖拽钳制范围要按"用户可能想调的方向"给足**：虚线拖拽有钳制（防止把手拖飞），设置输入框则不限（项目既有口径，其余间距项一致）——两者不一致时，用户会得到"输入框能填、虚线拖不到"的困惑，故钳制下限按"几何上还有意义"取，不要一律写 0；③ 放开负值后要顺带检查**依赖几何顺序的判定**（本次的声部序号）会不会因"行被压到块顶之上"而失效。

### E-2026-202 多声部「声部行间距」（`height_shengbu`）在设置里没有入口 → 用户报「同一组的多个声部之间间距无法调整」（adj479）
- **场景**：用户想把同一组内堆叠的两个声部拉开（Q1/Q2 太挤）。
- **根因**：`height_shengbu`（adj72 引入）**只有预览虚线拖拽**一个入口（`PreviewPane` 里 `voiceIdx > 0` 的行虚线拖它），而「设置 → 谱面 → 间距」那一组成员里 `height_ciqu / height_quci / height_cici / height_ciqu_lyric` 都有数字输入框、唯独没有声部间距——用户按设置找就找不到，等于"无法调整"。（引擎侧一直是好的：`spacingFor().shengbu` 从 adj72 起就参与块高与声部推进。）
- **解决**（adj479）：设置 → 谱面 → 间距 增加「声部间距」（文案 `uiCopy.shengbuGapLabel`，与相邻行距项同层：L2 谱面级、随 `.jps` 的 `# jps-config` 走，范围 0~300 由虚线拖拽的 `GUIDE_LIMITS_EX` 兜底）；预览虚线拖拽照旧。
- **验证**：`tsc -b` 通过；`height_shengbu` ∈ `defaultPageConfig` ⇒ 在 `CONFIG_FIELDS` 内，改值后按 diff 写回谱面（重开仍在）；几何探针确认设置生效（第二声部 y 随 `height_shengbu` 下移、其余行距不变）。
- **预防**：① **"可拖拽"不能是唯一入口**——凡 `GUIDE_LIMITS_EX` 里的可调项，设置面板都应有对应输入框（本次逐项核对：描述头高 / 首行至描述头间距 / 曲部与曲部 / 曲词 / 词词 / 曲部与上词部 / 声部间距 / 临时段上下间距 现均已可见）；② 新增设置项先按 `AGENTS.md` §七 定层再写码（本项 L2，随谱面）。

### E-2026-201 多声部块里独立标记（`&hx`/`&zkh`/`&ykh`）**完全不渲染**；滑音/附点等「无时值但有占宽」的元素压到相邻数字（用户报「多声部对无时值有占宽的元素显示不理想」）（adj479）
- **场景**：用户在多声部里写呼吸记号与滑音（`Q1: 6 &hx 5 4 3 |`、`Q1: 1&shy 2&xhy 3 4 |`），报「`&hx` 不显示，`&shy`/`&xhy` 与音符重叠」。
- **现象**（几何探针 + 无头 Chrome 截图）：① 多声部块的 `page.brackets` **一个都没有**——`&hx`/`&zkh`/`&ykh` 在块内**完全不画**，可拍宽里已经把它们算进去了（空位照留，观感"少了点什么"；实测 `6 &hx 5` 的 6 与 5 之间空出 5px 却什么都没有）；② 滑音图形墨迹宽 ≈7.3px（note_size=13）从数字右缘向右伸，而多声部每拍宽 = **各声部本体宽的最大值（没有可分摊的留白）** ⇒ 墨迹盖住后一个数字约 3px。
- **根因**（两处，同一类「预算与放置不同源」）：
  1. `placeVoiceBlock` 的 token 循环只处理 `note/rest/rhythm`——`kind === 'bracket'` 既不 `page.brackets.push`，在**时值优先**路径下连宽度都没计（adj375 独立化 `&hx` 时只补了单声部路径，与 E-2026-131 的 hairpin 完全同型：**多声部是另一套放置代码**）；
  2. 滑音是**音符修饰符**（进 `note.symbols`），布局端没有任何占宽口径（`spaceLayout.ts` 里 `slideBodyW` 定义了却从未接线）；单声部靠"`W` 按比例分摊"的留白遮住了问题，多声部每拍紧密排布就暴露。附点同理：本体宽按「总宽 ÷ 覆盖拍数」平摊，首拍不够 → 附点压到后一拍数字。
- **解决**（adj479，规则：**无时值但有墨迹的元素必须有插位与占宽**）：
  1. **插位模型**：每个独立标记按源码位置算出「所在拍 + 拍内时值偏移」；拍首的成为该拍**前置占位** `markShift`（该拍内容整体右移，块级取各声部最大 → 同拍数字仍纵向对齐，保住 adj314 的对齐口径）；拍中的按「本体游标 / 拍内时值比例」取较后者落位（`beatCursor`，前后元素都不重叠）；
  2. **绘制**：多声部块补 `page.brackets.push`（`yTop = 声部行顶 + 0.7×字号`，与单声部同一纵向基准），`&hx` 的 V 形与 `&zkh/&ykh` 的圆括号共用既有 `renderBracket`；
  3. **滑音占宽**：`slideGlyphInk(sym, noteSize)` 抽到 `layout/spaceLayout.ts`，作为**渲染与布局的唯一几何来源**（渲染端按它摆放、布局端用 `slideExtraW` 占宽），彻底避免 E-2026-129 式"两处各写一份几何"；
  4. **逐拍归位**：本体宽记在**真正画出它的那一拍**（首拍 = 数字槽 + 变音角标 + 附点 + 滑音墨迹；第 i 拍 = 第 i 条增时线；末拍 = 尾部倚音）——取代"本体总宽 ÷ 覆盖拍数"的平摊；
  5. **两条布局路径**（空间优先 / 时值优先）同一套口径，避免 E-2026-131 式"只修了一条路径"。
- **验证**：`scripts/smoke.mts` 新增 16 条 `adj479` 断言（**两种布局逐一对照**：`&hx` 渲染且落在 6 与 5 之间、占位后同拍各声部 x 仍对齐、`&zkh/&ykh` 渲染且位置正确、滑音墨迹不压后一音符、附点+滑音让开后一音符、SVG 里的 `translate(...) scale(...)` == `slideGlyphInk` 给出的框 ⇒ 渲染与布局同源）；`npm run smoke` 全绿（无新增失败）；几何探针实测：`6 &hx 5` → hx 占 `[82.1, 87.1]`、5 由 82.1 右移到 87.1、两声部同拍 x 一致；`1&shy 2&xhy 3 4` → 本体宽 8.06 → 15.3 / 15.5，后一音符 x 89.3 > 墨迹右缘 85.3；`2.&xhy 3` → 3 由 144.6 让到 151.2（附点不再压字）；无头 Chrome 截图目视确认；`obsidian-ijipu/vendor/engine` 同步后其 smoke 全绿。
- **预防**：① 凡「非时值但有墨迹」的元素（括弧 / 呼吸记号 / 滑音 / 附点 / 变音角标 / 倚音）都要在**本体宽**里占位，且要占在**它真正被画出来的那一拍**；② 一条几何量只允许一处定义（本次把滑音图形几何从 render 收敛到 `spaceLayout.ts`）；③ **单声部与多声部是两套放置代码**——凡新增/调整元素类型，必须问"多声部里画了吗、占宽了吗"（括弧与呼吸记号这次就是"只加进单声部"的漏项）；④ 断言要覆盖**默认配置**（`defaultPageConfig` = space）与 `DUR_CFG`（duration）两条路径。

### E-2026-200 CSS 容器查询里给**容器自身**设自定义属性 → 规则空转（adj472/adj473）

**现象**：dock 试听面板按宽度分档调右栏宽度（`--dock-side-w`）与导出按钮网格（`--dock-cell`/`--dock-btn`）的
`@container` 规则**完全不生效**——420px 窄屏下右栏仍是 104px、导出按钮一直是默认 132px 下限。

**根因**：容器查询只查**祖先容器**，被查询的元素**不能是自己**。写成
`@container (max-width:480px) { .tool-dock { --dock-side-w: 84px } }` 时，`.tool-dock` 正是那个
`container-type: inline-size` 的容器，规则对自身无效（不报错、静默空转）。

**解决**：把变量设在**真正消费它的后代**上——`.playback-actions { --dock-side-w: 84px }`、
`.dock-grid { --dock-cell }`、`.dock-actions > button { --dock-btn }`。

**验证**：420px 下右栏实测 84px（此前 104px）；导出按钮在 1240px 下排 2 行（分档后每行更宽）。

**预防**：写 `@container` 时先问「括号里的元素是不是那个容器？」。给容器自身设样式要用**媒体查询**，
不能用宽度容器查询。

### E-2026-199 误删 `.modal-inline{display:contents}` → dock 内设置面板不滚动；且**自测页长期假绿**（adj462→adj477）

**现象**：底部 dock 的「设置」面板在窄屏下页签栏/内容栏**不出滚动条**，内容被挤出视界无法操作。
用户连报三次，我三次自测都显示"可滚"。

**根因**（两层）：
1. **真因**：`ui/Modal.tsx` 的 `inline` 模式会渲染一层 `<div class="modal-inline">`，靠
   `.modal-inline { display: contents }` 透明掉。我在早先一次替换相邻 CSS 块时**把它顺手删了**，
   产物里也确实没有。于是这层成了 `display:block` 的普通 div，插在
   `.tool-dock-pane`(flex column) 与 `.pcfg-root` 之间，**切断了定高链**：
   `.pcfg-root { flex: 1 1 auto }` 落在 block 父级上完全失效 → 高度退化为内容高 →
   grid 行高 `minmax(0,1fr)` 也跟着退化 → 三栏拿不到受限高度、不滚，还被 `.pane-settings{overflow:hidden}` 裁掉。
2. **为什么测不出来**：我的验证页一直**手抄 CSS**、且 DOM **少放这一层包裹**（按"`display:contents`
   等于不存在"的假设直接把 `.pcfg-root` 放进 pane）。测的是"我以为的结构"，不是真实结构。

**解决**：补回 `.modal-inline { display: contents }` 并写明"删不得"的原因；设置面板的容器
**宽窄统一改用 grid**（`grid-template-rows: minmax(0,1fr) auto`），滚动由 grid 轨道的确定高度保证，
不再依赖 flex `min-height:0` 链（那条链只保证"可以被压小"，不保证"被压到了容器高度"）。

**验证**：`<link>` **编译产物真实 CSS** + 复现**含 `.modal-inline` 的完整 DOM 链**，9 组宽度/高度实测：
1000/900/800/760/720/700/620/620×137/420 全部「页签可滚✓ 内容可滚✓ 按钮可见 3/3✓」。

**预防**：
① 布局类改动的验证页必须**加载 `dist/assets/index-*.css`**，不手抄 CSS；
② 验证页 DOM 必须与 JSX **逐层对齐**（含 `Modal` 的 `.modal-inline` 这类"透明包裹层"）；
③ 删 CSS 前先在产物里确认该选择器是否仍被 JSX 使用（在 `dist` 里搜类名）；
④ 反复修不好的布局问题，停下来质疑**机制选择**而不是继续加兜底——本次连加三次 flex 兜底，
最后换 grid 才了结。

### E-2026-198 谱面波音/滑音换用用户提供的图形：iconfont `viewBox` 留白导致符号偏移/大小不一；滑音按"旧弧线包围盒"等比内缩偏小；两条旧断言钉在被替换掉的画法上（adj458）

- **场景**：用户要求把谱面里的波音/滑音（`&sby`/`&xby`/`&sby+`/`&xby+`/`&shy`/`&xhy`）从引擎手绘的矢量近似换成自己提供的成套图形。用户先给了 6 张 PNG（32×32），随后改口「我已提供了 svg 图，请改为 svg 图」，并提供 6 个 SVG。
- **做法与决策**：先用**位图内嵌**（`<image>` + data URI）跑通并实测（`renderScoreToSvg` 的产物在「Blob URL 把 SVG 当图片」的导出路径下能正常渲染、canvas 不被污染——同批还跑了「外部引用被拦」的**对照组**证明测试有效）；拿到 SVG 后改为**矢量内联**（把源 `<path>` 直接拼进谱面 SVG 的 `<g transform>`），既保住用户的原始图形、又保留无损矢量（导出 SVG/PDF 放大不糊）。两条路都把图形**内联成常量**：engine 是纯 TS 零依赖模块且被 obsidian-ijipu 逐字节 vendor，不能走「资源文件 + 打包器插件」（两个宿主都得配、vendor 还得多带文件）。
- **现象①（符号偏移 + 大小不一）**：直接把 SVG 按自己的 `viewBox` 摆进目标框，六枚符号位置/大小都对不上。
  - **根因**：源图是 iconfont 导出的 `viewBox="0 0 1024 1024"`，**画面在 viewBox 里留白很大且每个图形各不相同**——实测紧包围盒：「上波音」`x 36..988 / y 327..677`、「复上波音」`x 10..1014 / y 380..644`、「上滑音」`x 132..888 / y 173..858`。按原 `viewBox` 归一化等于把"各自的留白"当成"各自的边距"，于是既偏移又大小不一。
  - **解决**：生成器用**无头 Chrome `getBBox()`** 量出每个图形的**紧包围盒**（viewBox 单位，精确到小数，不靠像素量化），存进常量；渲染时按紧包围盒换算，六枚符号口径一致。
- **现象②（滑音明显偏小）**：首版把滑音按"旧弧线的包围盒"**等比内缩（contain）**摆放，实测箭头只有数字高度的约 1/3，像个小上标——正是用户说的「效果差」。
  - **根因**：旧矢量是"细弧线 + 小箭头"（包围盒扁而窄），而用户给的滑音图形近似正方（宽高比 1.02~1.10）；把正方图形塞进扁框，只能受宽度约束缩得很小。
  - **解决**：滑音改为**按高度贴合**（与旧弧线等高），并把**左缘锚在数字右缘** `x + digitW`——首版居中摆放时左缘落进数字槽内约 0.8px，视觉上压字。
- **现象③（源图自带写死的灰色填充）**：随后要把 `&yc`（延长记号）也换成用户的 `延长记号.svg`，而该文件的路径上带着 **`fill="#686868"`（灰）**。外层 `<g fill="#1b1b1b">` **盖不住**子元素自己的 `fill` —— 直接内联会让延长记号是灰的、与其它元素不同色，深色模式整页反相后也跟别处不一致（别人反成浅色、它反成另一种灰）。
  - **根因**：iconfont 导出的图形**各自可能带写死的填充色**（同批 7 个里只有这一个有），而"颜色由外层统一继承"依赖"子元素不自己声明颜色"。这是"部分素材不守约定"的典型：默认路径能跑，换一张图就破功。
  - **解决**：生成器在剥离阶段**去掉非 `none` 的 `fill`**（`fill="none"` 是描边图形的语义，必须保留），颜色一律交渲染时的外层 `<g fill>`；smoke 相应地新增「生成路径不带写死颜色（无 `fill=`、无 `stroke="#`）」断言，下次再有带色素材会被自动拦下。
- **现象④（两条断言挂掉）**：`adj115 波音锯齿斜下粗线（stroke 1.8 ≥10 条）`、`adj116 下波音竖线为细线（stroke 0.8 ≥2 条）` 双双失败；换 `&yc` 时又挂掉 `adj109 yc 渲染点 + 半圆弧（circle + Q）` 与 `adj109 滑音渲染弧线（Q）+ 箭头（fill 三角）`。
  - **根因**：这几条断言**钉的是被本次替换掉的手绘画法**（锯齿线的粗细、下波音的竖线、圆点+半圆弧、弧线+箭头），属于"断言停留在旧口径"——正是 `E-2026-196` 预防②记过的坑。
  - **解决**：按"当前设计"改写为「该用例里的 7 个修饰符全部渲染为矢量 `<g>`、且 `<g>` 内紧跟源 `<path>`」，完整口径断言另立 `[108]`。**注意这是同一坑在本轮第二次踩**（第一次见现象④上半），说明"改实现时要主动 grep 钉在旧实现上的断言"应当固化成动作而不是靠碰。
- **验证**：
  1. **smoke 新增 `[108]` 共 31 条**：七枚符号的路径标记与 `public/icons/*.svg` **逐字一致**（防生成物漂移）、包围盒为正且宽高比合理、**生成路径不带写死颜色**（由外层 `<g>` 统一上色）、七种编码端到端渲染出 **7 个矢量 `<g>`**、SVG 里**没有任何 `<image>` 位图**、**不引用任何外部资源**；摆放口径——波音墨迹宽度 = `9s/9s/13.5s/13.5s`（沿用 adj123 的占位）、延长记号宽度 = `9.6s`（沿用旧手绘的横向口径）、滑音按高度贴合且左缘在数字右缘右侧（不压字）。`npm run smoke` **ALL SMOKE TESTS PASSED ✅**；`tsc -b` + `npm run build` 通过；`preview:render` **7 谱 errors=0**。
  2. **无头 Chrome 实图核对**：把渲染出的 SVG 按 3 倍、再局部 9 倍放大截图，逐个符号肉眼比对——波音四型齿数/竖线正确，滑音上下箭头方向正确，延长记号「弧 + 点」形态正确、大小与数字协调。
  3. **生成器可重跑**：`scripts/gen-modifier-glyphs.mjs` 从 `public/icons/*.svg` 重新生成常量（含 Chrome 量包围盒），换图后一条命令即可，不必手改 base64/路径。
  4. **跨仓库**：`obsidian-ijipu/vendor/engine` 同步后**33 个文件逐文件哈希一致**；插件 `npm run build` 通过、`npm run smoke` **149 passed, 0 failed**。
- **预防**：① **iconfont/设计工具导出的 SVG 一律不能直接按 `viewBox` 定位**——留白是随图形变的，必须按**紧包围盒**（浏览器 `getBBox()` 最准）换算，否则一定偏移 + 大小不一；② 把**非等比图形**放进一个"按旧元素量出来的框"时，先想清楚该受哪个维度约束（本次滑音按宽度内缩就偏小，改按高度才对）；右侧依附的符号要**锚左缘**而不是居中，否则容易压到音符本体；③ **"颜色由外层继承"依赖素材守约定**——外部素材常自带写死的 `fill`，内联前必须剥掉（保留 `fill="none"`），并用断言把"生成物不带写死颜色"钉住；④ **凡替换掉某个绘制实现，就要主动 grep 钉在该实现上的断言**（粗细、条数、具体坐标）并同步改写——本轮同一坑**踩了两次**（波音/滑音一次、延长记号一次），说明"靠碰"不行，得当成规定的收尾动作；⑤ 生成物（内联常量）必须配一条「与源文件逐字一致」的断言，否则源图改了、常量没重生成，界面照旧且无人察觉；⑥ 换素材时"先位图跑通、再换矢量"是有效的探索顺序，但**先证伪验证手段**（本次跑了"外部引用被拦"的对照组）再下结论。

### E-2026-197 新一批图标又混进灰值（#333333 / #7f7f7f），adj457「统一纯黑」口径当场漂移；拆分图标靠 `rotate(90)` 复用导致方向对不上（用户报「图标颜色没统一」）（adj458）

- **场景**：用户要求把 iJipu 顶栏的「拆分(左右)/拆分(上下)」改用 `左右.png`/`上下.png`、「导出」改用 `导出.png`，并把 `obsidian-ijipu` 插件工具条的「试听/排版/设置/谱面/满宽/整页」也换成 `public/icons/` 里同一批 PNG，同时强调「**注意统一图片文件图案颜色，并能适应明暗主题**」。随后同一轮内又追加：视图组「编码」→`编码.png`、「预览」→`预览.png`、「折行」→新的 `折行.png`、「输入条」→`输入.png`。
- **现象①（颜色口径漂移，同一轮内连发两批）**：逐像素核对发现**第一批** `菜单.png`（`#323232~#343434`）、`页宽.png`（`#7d7d7d~#808080`）、`导出.png`（`#303030~#343434`）**都不是纯黑**——而 `adj457` 刚把 19 个按钮图标统一成 `#000000`；**第二批**又把 `预览.png`（AA 边缘 31 种色，如 `34,24,21`）、`折行.png`（`#333333~#555555`）、`输入.png`（`3,0,0~8,0,0`，带偏红）带成灰。同一目录里 23 个图标出现「20 个纯黑 + 3 个灰」的混杂。
  - **根因**：**形状编码在 alpha 通道、界面颜色由 CSS mask + `currentColor` 决定**，所以 PNG 的 RGB 在屏幕上**完全看不出差别**——正因"看不出"，它没有任何可见反馈来阻止漂移；而 `adj457` 定下的只是一句口径，**没有任何断言守着它**，下一批图（从外部工具导出/换一套线稿）自然带来自己的一套灰值。第二批更是证明了这一点：**光修文件不改机制，下一批必然再犯**。
  - **解决**：把 `菜单.png`/`页宽.png`/`导出.png`/`预览.png`/`折行.png`/`输入.png` 的 RGB 一律归零、**alpha 逐像素原样保留**（`GetPixel` → `FromArgb(a,0,0,0)` → 存回 PNG），并逐张回读校验「alpha 与原文件逐字节一致 + 非黑像素 == 0」。23 个按钮图标全部纯黑。**真正的解法是随附的 smoke 断言**（见验证①）——它在本轮第二批**当场把三个灰图标抓了出来**。
- **现象②（图标靠"借用"复用，语义对不上）**：五处按钮用着别的语义的图标——「拆分(上下)」用「收起」`rotate(90)`、「拆分(左右)」用未旋转的「收起」、「导出」借「下载」、「编码」借「文件」、「预览」借「查看」、「输入条」借「键盘」。
  - **根因**：当初资源少，就用旋转/借用凑（`ToolIcon` 为此专门加了 `rotate` 参数）。属于"用变换省资源"，但省掉的是**可读性**：图标是用户认按钮的唯一线索。
  - **解决**：新增 `splitH='左右'`、`splitV='上下'`、`code='编码'`（键名由 `file` 更名，图标已是代码块）、`export='导出'`，`view` 与 `keyboard` 两个键名与新图（眼睛 / 键盘）语义仍相符故保留；`TopBar` 各按钮改绑；`ToolIcon` 的 `rotate` 参数随之删除（已无调用方）；被替换的「收起/下载/文件/查看/键盘」五个图标从清单与磁盘一并移除（`adj417` 口径：只放用得到的）。
- **顺带**：插件侧「试听/排版/设置/谱面/满宽/整页」与顶栏用了**同一批 PNG**（`vendor/icons/`，与 `ijipu/public/icons/` 逐字节一致），取代此前"照着应用手绘一套内联 SVG"的做法——两处各画一份正是形状漂移的温床（本插件历史上已为对齐应用把「页面设置」从滑杆改成齿轮、线宽 1.4 提到 1.8）。
- **验证**：
  1. **smoke 新增 12 条零容忍断言**（`[103]`）：表驱动的「图标键 → 期望 PNG → 源码绑定处」六项（编码/左右/上下/预览/导出/输入条）、「已废弃五个图标的文件与引用一并清除」、「不再靠旋转复用」；并新增一个**零依赖 PNG 解码器**（`node:zlib` + 逐行反滤波，只支持 8 位灰度+alpha / RGBA）**逐张解 PNG**断言「有形状像素一律纯黑（adj457 口径）」「形状像素非空」「都带 alpha 通道」。`npm run smoke` **ALL SMOKE TESTS PASSED ✅（0 失败，20 个图标）**；`tsc -b` + `npm run build` 通过。
  2. **该断言当场证明有效**：第二批图标接进来后、**在归一化之前先跑一次 smoke → `1 CHECKS FAILED ❌`**，失败详情精确列出 `预览:[34,23,21 …] 折行:[61,61,61 …] 输入:[4,0,0 …]`（正是肉眼完全看不出的那三个）；归一化后复跑转绿。**这是本轮最有价值的一步**——口径从"写在文档里的一句话"变成了"能自动抓住漂移的检查"。
  3. **解码器本身先被证伪再使用**（否则"永远返回空"也能让断言假绿）：造一张已知答案的探针 PNG（`#333333`/alpha 128 + `#7f7f7f`/alpha 255）→ 解码器准确报出这两种色值；再对真图标解出的「有形状像素数」与 System.Drawing 独立测得的值逐张吻合（`菜单` 380、`页宽` 212）。
  4. **真浏览器渲染核对**：无头 Chrome 用**构建产物里的真实 data URI + `styles.css`/`index.css` 里真实的样式规则**渲染装配页，覆盖「浅色 / 深色 / 激活态（强调色底）× 15px / 放大」——顶栏 14 枚与插件 7 枚形状正确、同一主题内**只有一个颜色**、深色底上不隐形、激活态跟随 `--text-on-accent`。
  5. 插件侧 `tsc -noEmit` + `npm run build` 通过；`main.js` 逐项核对**7 枚图标都以完整 data URI 内联**、`data:image/png;base64` 恰好 7 处、无任何运行时图标路径残留（发布物仍是自包含的 `main.js`/`manifest.json`/`styles.css` 三个文件）；插件 `npm run smoke` **149 passed, 0 failed**。
- **预防**：① **"看不出来"的一致性口径必须写成断言**——凡是靠 alpha/掩膜/约定维持、肉眼无法验证的文件级口径（像素色、通道、尺寸、格式），一律补一条能自动跑的检查，否则它必然在下一次加资源时漂移（本条 `adj457` 之后**同一轮内就犯了两次**，正是"只修文件不建机制"的代价）；② **写断言前先证伪断言**：本轮先造已知答案的探针确认解码器真在读数，"断言全绿"才有意义（否则一个恒返回空的实现也能全绿）；③ **图标一律一图一义**，"借用"别的图标或用旋转/翻转凑数都会让按钮语义对不上（同时旋转还会重采样糊线稿）；④ 跨仓库共用同一份素材时**逐字节复制进 `vendor/`** 而不是各画一份（`obsidian-ijipu` 与 `ijipu` 只有引擎共用是既有约定，本次把图标也纳入同一思路）；⑤ 插件发布物限定三个文件，**任何新增素材都必须内联进 bundle**（构建期转 base64 data URI），不能顺手加一个资源目录——否则社区发布/`copy2ob.bat` 会静默丢文件、图标全空；⑥ 替换图标时**旧图标要文件与引用一并清除**（只删引用会留下一堆"看着还在用"的孤儿资源）。

### E-2026-196 控制台 React 报错 `flushSync was called from inside a lifecycle method`（EditorPane adj228）+ smoke「18 条预存失败基线」清理（adj456）

- **场景**：用户要求「`flushSync` 那条（来自 `src/editor/EditorPane.tsx:258` 的 adj228 逻辑）开一轮排查，同时排查是否还有其它遗留问题」。
- **现象①（flushSync）**：干净加载即在控制台出现 **2 条** `flushSync was called from inside a lifecycle method`（dev 下 StrictMode 双跑 effect，故恰好 2 条）。
  - **根因**：`EditorPane` 的宽度测量 effect（adj225/adj228）里 `update()` **在 effect 体内被直接调用一次**（生命周期内），而它内部用了 `flushSync(setTaClientW/setContentW)` —— React 明确禁止在生命周期（render/commit）里调用 `flushSync`；`ResizeObserver` 回调里的那次（帧间触发、不在生命周期内）才是 flushSync 的正确用法。
  - **解决**：effect 由 `useEffect` 改为 **`useLayoutEffect`**，并把「是否同步渲染」参数化：初次测量走**普通 setState**（layout effect 内的 setState 本就在本帧绘制**前**同步提交，与 flushSync 等效、还少一次多余渲染，语义不降级），ResizeObserver 回调仍用 `flushSync`（保住 adj228 的"拖动窗体时高亮层折行点与 textarea 同帧一致"）。
  - **验证**：无头 Chrome + CDP 采集**全部** console 输出（`Runtime.consoleAPICalled` + `exceptionThrown` + `Log.entryAdded`），覆盖「干净加载 / 连续改尺寸×5 / 折行开关+输入+撤销+设置对话框+试听对话框+三种视图切换 / 窄屏 390 + 汉堡菜单」四组场景 → **除 vite 连接日志与 React DevTools 提示外零输出**；并专门复核对齐没有回归（折行开/关 × 改宽前后四种状态：高亮层 `.highlight-inner` 高度 ÷ 行高 == textarea 视觉行数，实测 7 == 7；截图目视高亮文字、行号、续行标记与光标逐行对齐）。
- **现象②（"18 条预存失败基线"）**：`npm run smoke` 长期报 18 项失败，历次提交都写"18 == 基线"带过——等于**把红灯当绿灯**，新引入的失败会被淹没在其中。
  - **逐条分类后的结论：17 条是"断言口径过时"（行为本身没错），1 条是**真 bug**：
    | # | 用例 | 性质 | 处置 |
    |---|---|---|---|
    | 1 | `sw.js` 预热清单漂移（缺 adj426 新增的「自动主题/浅色主题/深色主题」） | **真 bug**：PWA 离线/首装后顶栏「浅深模式」按钮**空白**（图标是 CSS mask URL，缺文件即无形状） | 补齐清单（`public/sw.js`），并把该断言从"已知失败"变成零容忍 |
    | 2-6 | `Y 默认乐器=flute` / `@弦乐=strings` / `@@=flute` / `多声部 Y[0]=piano` / `Q3=钢琴` | 过时：期望**合成后端时代**的预设 id，而 adj354 起试听只走高保真、序列里带的是**乐器名 ref**（`长笛`/`弦乐`/`钢琴`） | 按当前口径改写，并补一条"ref 能被 `instrumentToProgram` 解回 GM program（长笛=73、弦乐=48）" |
    | 7-8 | `无 J → 60` / `J 文字 → 60` | 过时：adj343 已把无 J 默认从 60 改成 **70**（连函数头注释也漏改了，写的是 90） | 断言改 70；`inferBpm` 头注释 90 → 70 |
    | 9-15 | 调号角标 adj174/175/179/189/190/191 共 7 条 | 过时：现行设计早已改成「角标字号 = 调号 **3/4**（9.8）、y = 基线 − **0.35×字号**、字母让位改用 **`<tspan dx="0.9×角标宽">`**（不再是整体右移 `keyline.x`）」；旧断言还按 0.6/0.4/右移 x 判，且算字母左缘时**漏加 tspan dx**（实测只差 0.04px 就判失败） | 按现行设计重写（用 SVG 正则取真实几何），并补一条**用户可见不变量**：调号与拍号不重叠 |
    | 16 | `多声部空间优先 变音音符数字右移给角标腾位` | 过时：空间优先下 `note.x` 就是**本体框左缘**（"腾位"体现在**本体宽** `noteBodyW + accidentalBodyW`），拿 `x > 段起点` 判永远近似相等（实测差 0.017px） | 改为可观测后果：与"去掉变音"的对照谱逐音比较、其后音符右移 ≈ 一个角标宽；并断言角标在自己的本体预留内、不出前一个音符的本体框（容差 0.6px，本体宽按字形 advance 计） |
  - **验证与副作用**：`npm run smoke` **ALL SMOKE TESTS PASSED ✅（0 失败）**——这是 v0.15 以来第一次归零；顺带修掉：`public/sw.js` 清单、`inferBpm` 头注释、7 条断言的字形 advance 硬编码（改为从 SVG 实测反解）。**渲染本身未改动任何一行**（本次只改断言与注释，`render/index.ts` 未动）——即"18 条基线"里没有隐藏的渲染退化，另有一半是"断言在用旧机制描述新实现"。
- **现象③（其它遗留，一并清理）**：
  - **失效 CSS（死规则）**：`adj281` 把原「状态栏工具条」（折行/字体/字号按钮组）并入顶栏后，`.footer-settings` / `.footer-btn*` / `.footer-toggle` / `.footer-zoom*` / `.editor-font-split-btn`（JSX 走 `.topbar-btn` 基类，该 class 从未被使用）全部无人引用，窄屏媒体查询里还在为不存在的按钮隐藏标签 → 整批删除（`.editor-font-split` / `.editor-font-split-dropdown` **仍在用**，保留）；删后底部状态栏截图核对正常。
  - `scripts/patch-vite.js`（postinstall 打补丁绕开 DSH 沙箱下的 `net use` 探测 EPERM）经复核**仍然必需**（沙箱受限模式下 vite 仍会崩），保留并确认幂等。
- **预防**：① **禁止把"红灯"当基线**——"N == 基线"这类表述会让真正的失败被淹没（本次正是靠逐条分类才发现 1 条真 bug + 1 处注释漂移）；若确有无法立刻修的失败，必须在断言里写清"为什么允许失败 + 跟踪单号"，而不是在提交信息里写个数；② **断言要锚在"当前设计"上**：本项目多处设计改过两三轮（调号角标机制、序列乐器口径、默认 BPM），断言却停留在旧口径——改动这类设计时**必须同步改断言**，否则下次排查会先怀疑代码；③ **渲染类断言优先从产出的 SVG 里反解真实几何**（本次用正则取 `tspan dx` / 角标字号），不要硬编码字形 advance；④ React 里 `flushSync` 只能用于**非生命周期**的时机（事件回调、ResizeObserver 等）；在 effect 内做同步提交请用 `useLayoutEffect` + 普通 setState；⑤ 组件结构大改（如把底部工具条并入顶栏）后要**顺手搜一遍 CSS 里对应类名**是否还有人用。

### E-2026-195 「试听音色」选定具体音色时只覆盖了主声部（伴奏/第二声部与曲内 `@` 仍是自己的音色）——用户要求恢复「全篇统一音色」（adj455）

- **场景**：用户复核试听音色语义：「之前是音色选择自动时，按 谱面音色设置 > 描述头 `Y:` > 第一可选音色 > 音色库第一音色 的顺序选择演奏音色。而当有选择特定音色时，**全篇使用指定音色**演奏，我还是倾向这种方式，而不是目前的**只有第一音色变为你选择的特定音色**」。
- **根因**：adj427/adj434 给「全局试听音色」开了两个**例外**（各自都有当时的用户报障支撑），叠加后语义变成"半覆盖"，用户看到的正是"只有主旋律（第一个音色）跟着变"：
  1. `playVoice === 'accomp' | 'second'`（`{bz}`/`{dsb}` 伴奏/第二声部）→ `keepInstrument`，保留自己的音色（E-2026-164 的结论）；
  2. `explicitInstrument`（曲内 `@乐器名@`）→ 同样保留（E-2026-174 的结论）。
  两者都落在**播放后端**（`SpessaSynthBackend.play` 的 `opts.keepInstrument`）与调度层（`schedulePlay` 的 `keepOwn`），序列里的 `instrument` 并未统一 ⇒ **色块轨道也跟着各色**（音频与配色虽然一致，但都不是"全篇一个音色"）。
- **解决**（adj455，用户选定方案「全篇覆盖（含 `@`）+ 有 `@` 时给提示」）：
  1. `buildPlaySequence` 新增第 6 个参数 `instrumentOverride?: string`：非空时**所有事件**（主声部 / 伴奏 / 第二声部 / 曲内 `@` 切换 / 倚音 / 段层）的 `instrument` 一律改用该音色名 ref；同时**不再标记** `explicitInstrument`（避免"标记说它有自己的音色、实际却统一"的自相矛盾）。覆盖设在**序列层**而不是后端：序列里的 `instrument` 同时喂音频事件与 `playheadSegs`（色块配色），只在后端改会出现"音频一个音色、色块五颜六色"。
  2. 覆盖为空/undefined 时**完全不介入**（= 自动模式）：仍按 曲内 `@` > `Y:`（按声部）> 启用列表第一 > 音色库第一 路由（原语义零变化）。
  3. 引擎新增 `gmVoiceRef(program)`（`gmVoiceProgram` 的逆映射，program → 音色名 ref，剥显示编号）；应用侧 `PlaybackDialog` 用 `gmVoiceRef(playbackHqVoice)` 得到覆盖值，与 `backend.setVoice(program)` **同源**（同一张 GM 表）。`firstEnabledInstrumentRef` 改为复用它（去掉重复的 label 拼接）。
  4. 新增 `countScoreInstrumentSwitches(result)`（递归数曲内 `@乐器名@`，含 `{bz …}` 段内的子 token；`@@` 不计）+ 文案 `playbackCopy.voiceOverrideHint/voiceOverrideAtHint`：选定具体音色且谱面确有 `@` 时，界面明示"N 处 `@` 已被统一覆盖，要按谱面演奏请选「自动」"——避免重演 E-2026-174 那种"写了 `@` 却不生效"的误判（现在它是**设计行为**，不再是 bug）。
- **验证**：smoke 新增 **AY1–AY9**（用户原行为例：全篇覆盖后事件音色集合 = 单一音色、`explicitInstrument` 全为 false、色块轨道音色同样统一、力度角色/0.75 不变、空覆盖时与原序列逐事件一致、`@` 处数=2 且 `@@` 不计、`gmVoiceRef ↔ gmVoiceProgram` 对 128 项逐项互逆、边界返回 undefined、应用侧确把选择作为第 6 参数传入）→ **失败项 18 == 基线**（首轮 AY5/AY6 挂：AY5 拿"仅主声部事件"的旧数组比全量、AY6 漏数 `{bz}` 段内的子 token——两处都是断言/实现自身的问题，已修）。界面侧用无头 Chrome + CDP 复核：`音色=自动` 时无覆盖提示；选定 `40 小提琴` 后提示同时出现"全篇（含 `{bz}`/`{dsb}` 伴奏与曲内 `@乐器名@` 切换）"与"谱面里有 **2** 处 `@` 已被统一覆盖"（与 smoke 的处数一致）。
- **预防**：① **"全局覆盖"类能力必须一句话说清作用范围**，否则每加一个"例外"都会让语义往"半覆盖"漂移——本轮把两个例外收成"零例外"，并把两档语义（自动=跟随谱面 / 指定=全篇）写进 `docs/SYNTAX.md` 作为对外口径；② 覆盖要加在**数据源层**（序列）而不是**消费端**（后端），因为同一份数据往往有多个消费者（音频 + 色块配色 + MIDI 导出），只在消费端加会立刻出现"视听不一致"；③ 把"用户报障"变成"设计行为"时，**必须配套可见提示**（本轮 = `@` 处数提示），否则同一个现象会被再次当成 bug 报回来；④ 计数这类"扫源码"的辅助函数要**覆盖嵌套结构**（段内 `@` 是子 token）——首轮断言正是靠"用户原始行含 1 个段内 + 1 个段后 `@`"把它抓出来。
- **用户决策（adj457，两项口径就此钉住）**：
  1. **导出**（MIDI / WAV / MP3）**始终按谱面音色**导出，**不跟随**试听「音色」选项——`ExportDialog` 的 3 处 `buildPlaySequence` 均不传第 6 参数（smoke 新增 `adj457` 断言守住这一点：三条调用必须恰好是 `parseResult, layout, bpm, undefined, defaultInstrumentRef`）；`docs/SYNTAX.md` 音色优先级一节已写明。
  2. **Obsidian 插件侧保持老口径**（**不改**）：插件 `render.ts` 的 `buildPlaySequence(parsed, layout, bpm)` 只传 3 个参数、`backend.setVoice(settings.hqVoice ?? null)`（默认「自动」= 空），即**按谱面音色试听**；本轮引擎改动全部是**可选参数/新增导出**，插件不传覆盖就完全不受影响 ⇒ 将来同步 `vendor/engine` 也只带来"设置行校验告警 + 新 API 可用"，**不改变插件的试听口径**。

### E-2026-194 页面设置分层三处漏口径：写回把**本机缓存设置**固化进谱面 / 撤销-重做漏了字体覆盖层 / 设置行坏值静默生效（用户确认「源码>缓存>默认」后修复）（adj454）

- **背景**：用户要求确认「页面设置是优先按键源码中的设置还是使用缓存的设置？优先级应该是：源码设置>缓存设置>默认设置」。逐层核对 `mergeJpsConfig` 后确认**读取优先级本来就是这三层**（展开顺序 `{...defaultPageConfig, ...(缓存), ...(源码)}`，实测：缓存 `margin_left=99/margin_right=77` + 源码 `margin_left=55` → 生效 左=55、右=77、上=默认），但同轮排查发现**三处口径不一致**（用户确认后一并修）。
- **问题与根因**：
  1. **写方向把缓存固化进谱面**（L1 泄漏成 L2）：`setPageConfig(cfg, persist=true)`（「保存设置」按钮、预览虚线拖拽松手）直接把**合并后的生效配置**交给 `writeJpsConfig`，后者按"与默认值的差量"全量写行 → 本机公共设置里那些**非默认值**（如缓存 `margin_right=77`、`height_quci=50`）会被写进 `# jps-config`。实测：只改一个字段并点「保存设置」，源码变成 `{"margin_left":55,"margin_right":77,"height_quci":50}`——后两项只来自本机缓存。
  2. **撤销/重做少了 L1 层**：`restoreEntry()` 用 `mergeJpsConfig(code, loadPageConfig())`，漏掉 `applyFontOverride`（L1「用我的字体覆盖谱面字体」），而其它入口（初始加载/`setCode`/打开文件）都走 `resolveConfig()` → 开启字体覆盖时，撤销一步会让覆盖暂时失效。
  3. **设置行的坏值静默生效 / 坏 JSON 静默整层失效**：`extractJpsConfig` 只做"白名单键"过滤、**不做类型校验**——手写 `{"margin_left":"abc"}` 会把字符串直接塞进排版配置（设置框显示空白、无任何提示）；而 JSON 坏掉时**整行**静默失效、回退本机缓存，用户只会看到"我的设置没生效"；键拼错（`margin_laft`）同样静默丢弃；设置行**缩进**（非顶格）时 `settings` 根本找不到该行、整行不生效，也无提示。
- **解决**（adj454）：
  1. **写回只固化"用户本次改动"**：引擎新增 `mergeConfigEdits(code, base, next)`——以「本次编辑**开始前**的生效配置」为基线，只把 `next` 与 `base` 不同的字段并入**源码层**（源码原字段原样保留，缓存来源的值既不在源码层也不在改动集 → 不写盘）。`setPageConfig(cfg, persist, base?)` 接收基线；对话框传打开时的快照 `snapRef`，虚线拖拽传按下时的 `baseCfg`（新增到 `metaDragRef` / 拖拽 state）。**不传基线时退回旧行为**，避免漏改调用方时"保存什么都不写"。
  2. **解析口径统一**：`restoreEntry` 改走 `resolveConfig(code)`。
  3. **读取端类型校验 + 可见告警**：`engine/settings.ts` 收敛出 `readConfigLine`（解析 + 白名单 + 逐项类型校验）与 `expectDescOf`（数值/字符串/布尔/枚举 `page`·`noteSpaceLayout`·`lianyinxian_type`/嵌套 `metaPos`·`heights`·`segmentRowGap` 各自的形状），对外暴露 `inspectJpsConfig` / `inspectJpsConfigLine`；`parser.ts` 在 `#` 注释行分支里把设置行的告警并进 `ParseResult.errors`（**复用既有问题条 + 状态栏橙点 + 行号定位**，分级用 warning：谱面仍能正常渲染，不因此阻断导出），并对**缩进**的设置行单独告警「必须顶格」。坏项一律**忽略该项**（回退下一层），坏 JSON 才整行失效。
  4. `writeJpsConfig` / `pickWritableConfig` / `roundPxIntegers` 入参放宽为 `Partial<PageConfig>`（写回的"源码层配置"天然可能只含少数字段；缺项按未设置跳过，而不是补默认值）。
- **验证**：`npm run smoke` 新增 **27 项断言（`[107]`）**：三层优先级（源码压缓存、缓存兜底、默认兜底、缓存传缺省值时源码仍赢）、写回只含用户改动且**不含缓存字段**、落盘后缓存项在生效值里仍生效、无改动不新增字段、改回默认即从设置行移除、坏 JSON / 坏值 / 拼错键 / 非法枚举 / `metaPos` 缺字段 / `heights` 元素非数 / 缩进行各自的告警与回退、合法设置行零告警 → **失败项 18 == 基线**（首轮曾多出 1 条：`adj382 往返保真` 报 `丢失=noteSpaceLayout`，原因是校验里把布局模式枚举写成了 `space/time`，实际是 **`space/duration`**——断言当场抓到，已修正并补"合法枚举值不误报"用例）；`tsc -b` 通过。另用无头 Chrome + CDP 端到端复核：预置缓存 `{margin_left:99,margin_right:77,height_quci:50}` + 源码 `{"margin_left":55}` → 设置对话框实际显示 左=55 / 右=77 / 上=40；改一个字段保存后源码只多出该字段（不再出现缓存值）；坏 JSON / 坏值场景下谱面照常渲染且问题条给出告警。
- **预防**：① **"读"与"写"是两个方向的分层问题**——读取只要展开顺序对，写回却必须回答"这个值是**谁的**"：凡是"把生效值写回某一层"的代码，都要问一句"它来自哪一层"，本轮的 `mergeConfigEdits(base)` 就是把"值来源"显式化；② **交互式编辑必须携带"编辑前快照"**（对话框打开时 / 拖拽按下时），否则无法区分"用户改的"与"本来就这样的"（这也是"预览态"与"持久态"分离的同一个坑）；③ 设置类文本是**用户可手改的源码**，读入端必须做类型/枚举/嵌套校验，且**不合法要有可见反馈**——静默忽略等于把错误藏起来（本次直接复用解析器的告警通道，零新增 UI）；④ 校验表要与类型定义**同源**：枚举值写错（`time` vs `duration`）时，只有"往返保真"这类断言能发现——所以"写进去的每一个字段都必须能读回"这条不变量断言要长期保留。

### E-2026-193 手机顶栏「⋮ 更多」只露半个 / 整颗看不到（主题三状态、支持作者同样有被挤出视口的风险）（用户报）（adj453）

- **现象**：用户在手机上反馈「顶栏上的『更多』只显示了一半，有些手机上没有显示、看不到三个点，导致不知道还有更多按钮」，要求「保证主题三状态按钮、支持按钮、更多按钮一定会在顶栏右侧显示」。
- **根因**（四条叠加，前两条是主因）：
  1. **宽度预算漏算常驻项**：`TopBar` 折叠测量里 `avail` 只扣了「支持作者」的宽度，**没有扣 adj426 新加的浅深三状态按钮**（约 36px）；
  2. **flex 间距只按 1 个算**：`avail` 里只减了一个 `gap`，而顶栏在流内子项有 7~8 个（每个间距 4~6px）→ 两项合计使预算比**真实可用宽度多出约 40px**；
  3. **超出的后果落在最后一个子项上**：预算虚高 → `visCount` 多留按钮 → 顶栏总宽超出视口，而 `.topbar-toolbar` 是 `flex-shrink: 0`（不压缩、只 `overflow: hidden`），于是排在最后的「⋮ 更多」被**顶出视口右缘**，表现为"只露一半"（超出十几像素）或"整颗不见"（更窄的机型 / 浏览器工具栏再挤一点）；
  4. **常驻按钮放错了容器**：浅深三状态与支持作者原本在 `.topbar-toolbar` **内部**，该容器带 `overflow: hidden`（用于裁掉超出 `visCount` 的按钮）——宽度不足时它们会被容器裁掉或随容器一起外溢，而 JSX 里「更多」的显隐条件是 `visCount < toolBtns.length`，一旦预算算成"全都放得下"就根本不渲染三点按钮（用户"看不到三个点、也不知道还有更多"的另一半原因）。
- **解决**（adj453）：
  1. **右侧三个常驻按钮移出工具条**：浅深三状态 → 支持作者 → 更多，直接挂在 `.topbar` 下（不再是 `.topbar-toolbar` 的子节点），并统一 `flex-shrink: 0`——不再受工具条的 `overflow: hidden` 影响；
  2. **工具条改为 `flex-shrink: 1`（结构性安全阀）**：宽度不足时由工具条自己让步（裁掉自身内部溢出的功能按钮），右侧三个按钮**一定留在视口内**；正常路径下仍由测量先把多余按钮收进「更多」；
  3. **重写宽度预算**：常驻项（Logo / 汉堡 / 视图 / 浅深 / 支持 / 更多）宽度**含外边距实测** + 顶栏间距按**实际在流子项数**算（`topbar.children` 里非 `absolute` 的项数 − 1，并按"含更多"的最坏情况补 1 个 gap）+ 2px 安全余量；
  4. **「更多」槽位恒定预留**且取**实测宽**（隐藏测量容器里放了它的隐形副本）：与可见的「更多」当前是否存在无关，避免"按钮消失→预算变大→按钮又出现"的抖动（乃至无限重渲染）；
  5. **测量容器改为与真实工具条相同的组结构**（按钮放进 `.topbar-buttons` / `.topbar-settings` 副本里），量到的宽度即所见——原先平铺裸 span 用的是基类 `.topbar-btn` 样式（padding 5/10 + 有边框），比组内真实按钮每个宽 4px，窄屏会白白少显示一个本可放下的按钮；
  6. **修掉测量里的一个真坑**：包裹 span 是 `display: contents`（为与真实布局一致），它**不产生盒子**、`getBoundingClientRect()` 恒为 `0×0`，直接量它会得到全 0 宽度（一度导致「所有按钮都放得下」→ 干脆不渲染「更多」→ 右侧按钮被挤出视口）；改为量包裹层的 `firstElementChild`，并按 `data-tool-key` 建表取宽（不再依赖测量容器的 DOM 顺序）；
  7. `.topbar-buttons:empty` / `.topbar-settings:empty { display: none }`：极窄屏 `visCount` 很小时不留空组框占位（用 `:empty` 而非条件渲染——容器仍在 DOM 里，测量才能继续读到真实的 padding/border/gap）。
- **验证**：无头 Chrome + CDP（`Emulation.setDeviceMetricsOverride`，`mobile: true`）在 **280 / 320 / 360 / 390 / 412 / 430 / 480 / 600 / 640 / 768 / 900 / 1024 / 1280 / 1600 共 14 档宽度**实测：三个常驻按钮 `getBoundingClientRect().right ≤ documentElement.clientWidth` **全部成立**（280px 时 `more=[244..274]`、320px `more=[284..314]`、360px `more=[324..354]`、430px `more=[394..424]`；≥1280 全部按钮放得下时 `more` 不渲染、浅深与支持仍在最右）；文档横向溢出 `scrollWidth − clientWidth == 0`；工具条 `scrollWidth == clientWidth`（不再有被裁的按钮，见修复前后对比：之前 360px 时 `hasMore=false` 且工具条被裁 76→356）；点开「更多」下拉实测完整落在视口内（360px：`left=174 right=354`，320px：`left=134 right=314`）；`tsc -b` 通过。
- **预防**：① **顶栏宽度预算要逐项枚举**——每加一个"不参与折叠的常驻按钮"都必须进预算，flex 间距也必须按**实际子项数**算，不能写死 1 个 gap（"CSS 加了元素、JS 预算没跟上"是本项目反复踩的坑，见 E-2026-143）；② 「必须始终可见」的元素**不要放进带 `overflow: hidden` 的容器**，并且要有**结构性安全阀**（测量再准也挡不住新按钮/字体度量/亚像素），本次的安全阀 = 让可折叠容器自己 `flex-shrink`、常驻项一律 `flex-shrink: 0`；③ 恒定预留量必须与"元素当前是否已渲染"解耦（隐形副本实测），否则"测量 ↔ 渲染"互相影响会产生抖动甚至无限重渲染；④ **无头 Chrome 的 `--window-size` 与布局视口并不一致**（实测 `--window-size=360,740` 时布局视口是 526px，截图只截到左侧 360px）——手机布局必须用 CDP `Emulation.setDeviceMetricsOverride` + `mobile: true` 验证，否则"看不到按钮"的结论本身就是假的。

### E-2026-192 插件试听色块「每曲行只取一个拍段 + 硬编码高度 + 按声部号配色」→ 多声部/重叠区看不出一层一块（adj452）

- **背景**：应用侧色块在 adj429/adj432 已改为「按曲行几何动态定界 + 按音色/声部角色配色 + 按 (页,曲行,声部,音色,声部角色) 逐块」，而插件（`obsidian-ijipu`）的色块一直是简版：`playheadPosOf` 每个曲行**只取一个当前拍段**、高度用硬编码 `[y−1.6×字号, y+1.1×字号]`、颜色只按声部号取调色板。用户要求「先按你的建议补上 `yTopMin/yBottomMax`（高度）与 `playVoice`（声部角色），后面再考虑完善」。
- **现象影响**：① 多声部行 / `{bz}` 重叠区 / `{dsb}` 上下层**只画得出一个色块**（另几层看不到）；② 色块高度与应用的观感不一致（下沿多出 0.5×字号）、压到歌词方向更明显；③ 临时段/多声部的两层颜色不区分（都按 voice 号上色）。
- **解决**（插件侧）：
  1. 新增 `src/playhead.ts` 纯函数模块（`trackKeysOf` / `instrumentColorMap` / `playheadBaseOf` / `playheadPosIn`），把应用的色块规则原样搬过来——纯逻辑可被 `npm run smoke` 直接断言；
  2. `scorePane.ts` 改为按 **(页, 曲行, 声部, 音色, 声部角色)** 逐组建色块（键含 `playVoice`——重叠区两层音色相同时也不会并成一块）；
  3. 高度**优先用引擎给的 `yTopMin`/`yBottomMax`**（多声部按声部中线分块、临时段按上下层分块），缺一时回退 `[y − 1.6×字号, y + 0.6×字号]`（与应用 `PreviewPane.playheadPosIn` 同一公式）；
  4. 配色：`playVoice` 固定色（bz 上层蓝 / dsb 下层绿 / dsb 上层红）→ 音色调色板 → 声部号。
- **验证**：插件 smoke 新增 **adj452 十四项**（真实谱面数据：同一曲行内主旋律与 bz 伴奏各成一组、dsb 上下层各成一组且纵向不重叠、有/无动态定界两条路径的上下边界逐值校验、末段播完与跨页返回 null、三种声部角色固定色、同音色恒定同色）→ **149 passed, 0 failed**；`tsc -noEmit` + `npm run build` 通过。
- **预防**：① 同一功能的**两处实现**（应用预览层 / 插件视图层）必然漂移——本次把规则抽成纯函数模块，插件侧只留 DOM 绘制，后续改规则只改一处（与应用侧的对应实现保持"同一公式、同一常量"）；② 断言要写**几何不变量**（"两层色块纵向不重叠"、"有动态定界时逐值等于引擎给的值"），而不是抄像素；③ 「每 N 只取一个」这种省事的取法在"同一 N 内可以有多层同时发声"的场景下必然漏画。

### E-2026-191 插件侧（obsidian-ijipu）音色口径与应用不一致：自持音色表 / `program % 16` 分通道 / 默认音色连伴奏一起覆盖（adj450）

- **背景**：用户在应用侧确认「试听音色要默认自动、本次会话内记住」后要求「Obsidian 插件那侧同步改成同样的默认」。核查发现插件的**默认值本来就是「自动」**（`settings.hqVoice` 未设置 → `?? null` → 声部路由），但另外三处与应用的音色口径**长期分叉**：
  1. 插件自持一份 128 项 GM 音色表（`soundbank.ts`），与应用侧同一份数据两处维护（E-2026-188 的"表分叉"正是同类隐患，且应用侧 `GM_VOICES` 已能解析 `N 名称`/纯编号两种写法）。
  2. 后端用 `ch = program % 16` 分通道替代应用侧的按族映射：**不同音色会撞同一通道**（0 与 16、4 与 20…），且「(通道,音色) 发过就不再发」⇒ 与 E-2026-187 同样的"整首只剩一种音色"；更糟的是 `program % 16 === 9`（如 `9 钢片琴`）会落到 GM **打击乐通道**，音色完全走样。
  3. 后端 `play()` 没有 `opts.keepInstrument`：插件的「默认音色」会把**伴奏/第二声部**（bz/dsb）与曲内 `@乐器名@` 一起覆盖——而应用侧 adj427/adj434 明确保留它们（"重叠区两个声部要有区分"）。
- **解决**（插件侧，`obsidian-ijipu`）：
  1. `GM_VOICE_OPTIONS` 改为 `= GM_VOICES`（engine 唯一来源，随 `vendor/engine` 同步）；
  2. 后端改用 `GmChannelAllocator` + `channelProgram`（触发时刻核对），`stop()` 清记录、`dispose()` 重置分配；
  3. `play()` 增加 `opts?: { keepInstrument?: boolean }`，与引擎 `schedulePlay` 的 `keepOwn` 对齐（伴奏/`@乐器名@` 保留自身音色）；
  4. 设置项「默认音色」说明补上覆盖关系：**「选了具体音色会覆盖谱面里的 Y: 乐器（要按谱面各声部音色演奏，请选『自动』）」**。
- **应用侧同批调整**（用户要求「改成记住到本次会话结束」）：`playbackHqVoice` 仍是会话级（不落盘），但**取消**原 adj448 的"每次打开试听都重置"——本次运行内记住，只有重启应用才回到「自动」（见 E-2026-189）。
- **验证**：插件 smoke 新增 **adj450 八项**（表取自 engine、通道分配器且无 `const ch = program % 16`、触发时刻核对、`stop()` 清记录、`keepInstrument`、`render` 传 `?? null`、设置项说明、试听走引擎 `schedulePlay`）→ **127 passed, 0 failed**；`tsc -noEmit` 通过。应用侧 smoke 18 == 基线、`tsc -b` + `npm run build` 通过。
- **预防**：① **同一份数据/同一套语义在两个仓库各写一份，必然会分叉**（音色表、音色优先级、通道分配三处都是如此）——能收敛到 `vendor/engine` 的一律收敛；② 宿主插件侧的"设置项"看起来是宿主的持久化选择，但**语义**（能否覆盖谱面、谁优先）必须与应用完全一致，否则用户会在两个环境得到不同结果；③ **`x % N` 之类的"顺手的散列"用作资源分配时最危险**：它既不保证互斥，也可能撞上保留值（这里是 GM 打击乐通道 9）。

### E-2026-190 多组多声部时色块「跑到第一组的位置」：`voiceBlockByNoteIdx` 只按声部号匹配同页第一个块（用户报）（adj449）

- **现象**（用户）：测试多组声部时，**到第二组色块就跑到第一组的位置上去了**。
- **实测复现**（一页三行：`Q1/Q2` 第 1 组 → 单声部 `Q:` → `Q1/Q2` 第 2 组）：
  ```
  g0 v1 y=154.3 bounds=[136.8,158.9] 含本音=true   ← 第 1 组：正确
  g2 v1 y=238.5 bounds=[136.8,158.9] 含本音=false  ← 中间的单声部行也被算成第 1 组的块
  g3 v1 y=280.6 bounds=[136.8,158.9] 含本音=false  ← 第 2 组跑回第 1 组那行 ✗
  g4 v2 y=322.7 bounds=[178.9,201.0] 含本音=false  ← 同上 ✗
  ```
- **根因**：`buildPlaySequence` 建 `voiceBlockByNoteIdx` 时是「取**本页第一个**包含该声部号的块」（`voiceSetPerBlock[bi].has(n.id.voice)` → `break`）。一页里可以有多组多声部块（声部号必然重复：第 1 组的 Q1/Q2 与第 2 组的 Q1/Q2 都是 1/2），于是第 2 组及之后的所有音符、乃至中间穿插的**单声部**行，全部被判成第 1 组的块；`computeColorBounds` 随即拿第 1 组的 `voiceCenters` 算 `yTopMin/yBottomMax` ⇒ 色块整块画到第 1 组那一行。
- **解决**：改为**按"行归属"匹配**——块的纵向范围 `[yTop, yBottom]` 必须包含本音符（多声部块按行依次排布、互不重叠）；多个块都命中时取「声部中心离本音符最近」者，避免块间范围相接时的边界含糊。
- **验证**：smoke 新增 **AP[A1–A6] ×2 布局**：每个多声部音的色块定界必须**包含本音符**、必须落在**本组**的纵向范围内（允许 `TOP_EXT=1.1×字号`/`BOT_EXT=0.6×字号` 的自然外扩）、中间穿插的单声部行**不得**被套上多声部定界、横向仍取本音符的时值段左缘、第 2 组与第 1 组的定界集合不相交。失败项 **18 == 基线**（既有 adj429 单项多声部断言继续通过）。顺带确认：色块左缘是音符的**时值段**左缘而非数字 x（adj320/adj314：数字在段内水平居中），断言按此口径写。
- **预防**：① **按"编号/名称"匹配资源时，必须再叠一个"位置/归属"判据**——声部号在同一页里天然重复，"第一个匹配"几乎必错（与 E-2026-186 的"同一 id 编码跨距"、E-2026-188 的"同族塌缩"是同一类错误：**用不完备的键做定位**）；② 布局产物之间的关联（音符 → 所属块）**不能靠"页内唯一"的假设**，页内可以有多组同构结构；③ 写断言时优先用**几何不变量**（"色块必须包含自己的音符"）而不是抄具体像素值——本次正是这条不变量一眼钉死了跨组错配。

### E-2026-189 试听「音色」被记住 → 选过一次具体音色后，之后每份谱子的 `Y:` 乐器都被它覆盖（用户实测反馈）（adj448 + adj450 调整）

- **现象**（用户）：在多声部乐谱里写了多个 `Y:` 音色，试听却只响一种；**用户自行定位到原因**：「我试听时音色没有选择自动」。
- **性质**：**不是解析/播放缺陷**——按设计与文档（`docs/SYNTAX.md` 音色一节），试听「音色」下拉**只覆盖谱面没有显式切换的部分**（即 `Y:` 行与缺省音色），选了具体音色就是要用它盖过 `Y:`。真正的隐患是**这个选择被持久化**（`ijipu.playbackHqVoice`，L1）：用户为某次试听选了音色后，**下次打开任何谱子它仍然生效**，于是"谱面写了 `Y:` 却没听见"会被反复误判成 bug。
- **解决**（用户要求：「试听时还是默认选择自动好了，减少这种情况发生」）：
  1. `playbackHqVoice` 由 L1（持久化）改为 **L3 会话级**：store 初值恒为 `null`（自动），setter 不再写 localStorage；旧键 `ijipu.playbackHqVoice` 仅在 store 初始化时 `removeItem` 清残留（避免"明明没选却仍按旧音色演奏"）。
  2. **本次运行内记住选择**（用户要求「改成记住到本次会话结束」）：只有重启应用才回到「自动」——adj448 首版曾"每次打开试听都重置"，属于过度矫正，已按用户反馈取消。
  3. 选定具体音色时在下拉下方给出提示：`已指定音色：将覆盖谱面里的 Y: 乐器（要按谱面各声部音色演奏，请选「自动」）`（文案入 `brand/copy.ts` 的 `playbackCopy.voiceOverrideHint`）。Obsidian 插件侧同口径写入设置项说明（见 E-2026-191）。收藏音色集合 `playbackHqEnabled` 仍按 L1 持久化（那是长期偏好）。
  4. 删除不再使用的 `src/store/playbackVoice.ts`（其 adj366 断言改为对新行为的断言）。
- **验证**：smoke 的 `[78]` 组改为 adj448/adj450 断言：setter 不落盘、旧键只 `removeItem` 不 `getItem`、初值 `null`、**本次运行内记住（打开试听不重置）**、选定音色有提示、旧模块已删除；`adj366` 的"自动路由"断言（`@手风琴`→21 等）保留。失败项 **18 == 基线**；`tsc -b` + `npm run build` 通过；插件侧同口径改动见 E-2026-191（插件 smoke 127 项全绿）。
- **预防**：① **"会覆盖谱面"的开关型偏好，不该默默记住**——凡"用户上次选的值会让本次结果与谱面不一致"的设置，默认值必须回到"跟随谱面"，或在每次进入相关界面时复位；② 持久化前先问「换份文件打开，这个值还合适吗？」（不合适 ⇒ L3）；③ 用户报"某个语法不生效"时，**先确认没有更高优先级的全局开关在起作用**（本项目优先级：`@乐器名@` > 试听「音色」 > `Y:` > 默认）——这一条已写进 `docs/SYNTAX.md`，本次再加界面提示把口径摆到用户眼前。

### E-2026-188 音色名 → GM program 的解析表不完整（128 个名称有 101 个解析不到本音色）→ `Y:`/`@乐器名@` 指定的音色不生效（adj447）

- **场景**：核查 E-2026-187（用户报「多声部多个 `Y:` 音色只用了第一个」）时顺带发现——**用户报的那一例是"试听音色没选自动"（按设计覆盖 `Y:`，非缺陷）**，但同一症状还有一条真缺陷路径。
- **现象/实测**：把应用「设置 → 音色库」列表里**全部 128 个音色名**逐个喂给解析函数，**101 个解析不到自己的 program**：`钢片琴`→10（应 9）、`钟琴`→10（应 8）、`打击风琴`→16（应 17）、`教堂风琴`→16（应 19）、`探戈手风琴`→16（应 23）、`民谣吉他`→0（应 24）、`电钢琴1`→0（应 4）、`高音/中音/次中音/上低音萨克斯`→**全部 65**、`弦乐合奏1/2`→**同为 48**……而用列表的显示写法（`22 手风琴`）则有 **122/128** 解析错（几乎全落到钢琴 0）。
- **根因（三处，同一主题：名称表分叉）**：
  1. 谱面乐器名解析（`instrumentToProgram`）只查 `midi.ts` 里一张约 **40 条**中文简称的表（`GM_NAME_PROGRAMS`），远少于 GM 的 128 音色；表外名称只能靠「乐器族关键词」兜底（`matchInstrument`）→ 整族塌缩到同一个 program（萨克斯族全 65、弦乐合奏全 48）。
  2. **同一份数据存了两处**：应用「音色库」列表（`GM_VOICE_OPTIONS`，128 项，在 app 的 `spessaSynthBackend.ts`）与 engine 的解析表各自维护 —— 用户在列表里看到的名称，正是解析不出来的那些。
  3. 列表显示名带编号（`21 手风琴`），而描述头 `Y:` 只取**第一个词**（adj302「一个 Y 行一种乐器」）⇒ 用户照列表抄下来实际得到的是 `21`，既不是名称、也没被当作编号解释。
  - 两个声部的音色一旦塌缩到**同一 program**，听感就是"只用了一种音色"——与 E-2026-187 的现象完全一致，可叠加发生。
- **解决**：新增 `engine/playback/gmVoices.ts` 作为**唯一来源**：`GM_VOICES`（128 项 `program`+`label`，从 app 表原样迁入，`program` 与序号一一对应）+ `gmVoiceProgram()`（接受 `名称` / `N 名称` / **纯编号 `N`** 三种写法）。
  - `instrumentToProgram` 改为按 `GM_VOICES` → 旧简称表（`风琴/弦乐/萨克斯…` 这类别名仍可用）→ 乐器族关键词 的顺序解析；
  - app 的 `GM_VOICE_OPTIONS` 直接取 `GM_VOICES`（不再各存一份表，三处消费：勾选列表、选中音色还原名称、谱面名称解析天然一致）。
  - **行为变化（唯一一处）**：`电钢琴` 由旧表的 4 改为按应用内列表口径 = **2**（GM 标准：2 是电钢琴、4 是电钢琴1）；只写 `电钢琴1` 的谱面不受影响。
- **验证**：smoke 新增 **AN1–AN7**：表 128 项且 program 与序号一一对应、**128 个名称（不带编号）全部解析到本 program**、**128 个名称（带编号）同样正确**、常用名/纯编号/库前缀三种写法、同族音色各解析到不同 program（萨克斯/弦乐合奏/钢片琴/电钢琴）、端到端 `Y: 弦乐合奏1`+`Y: 弦乐合奏2` 两声部取得 48/49、app 列表确实取自 `GM_VOICES`。失败项 **18 == 基线**；`tsc -b` + `npm run build` 通过；插件 `vendor/engine` 同步后 `tsc -noEmit` + smoke **119/119**。
- **预防**：① **"用户能看到的取值"与"程序能解析的取值"必须是同一份数据**——本次就是列表在 app、解析表在 engine，两边各写一半，用户照着列表抄反而解析不出；② **凡"名称 → 编号"的映射表都要有"全量往返断言"**（`for v of TABLE: resolve(v.name) === v.id`），这是一行断言就能挡住 101 处错误的检查；③ 兜底策略（按族关键词回退）会把"解析失败"伪装成"解析成了一个相似音色"，**同族塌缩**是它的典型症状（萨克斯全 65、弦乐合奏全 48）——回退越"聪明"，越要配全量往返断言。

### E-2026-187 MIDI 通道按「乐器族」分配 → 同族两个 `Y:` 音色撞同一通道、整首只剩一种音色（用户报）（adj446）

- **现象**（用户）：多声部乐谱的描述区写了多个 `Y:` 音色，试听时**只用了第一个音色**，其它声部的音色没用上。
- **定位**：先证明**序列是对的**——`buildPlaySequence` 对二声部谱逐事件给出 `钢琴/0`、`弦乐/48`（或 `大钢琴/0`、`手风琴/21`；`小提琴/40`、`大提琴/42`），即「Q1→Y[0]、Q2→Y[1]」解析正确、`PlayEvent.instrument` 也各自不同。问题在**播放后端**。
- **根因**：HQ 后端（`src/playback/spessaSynthBackend.ts`）用 `CHANNEL_OF[乐器族]` 把音色映射到 MIDI 通道：`piano→0 / organ→1 / strings→2 / flute→3 / brass→4 / musicbox→5`，**未识别的族一律 0**。而 **MIDI 通道同时只能承载一个 program**：
  - 同族两个音色（钢琴+电钢琴、小提琴+大提琴、长笛+竖笛、双簧管+单簧管…）必然落在**同一通道**；
  - 后设的 `programChange` 把该通道**先前声部一起改掉**（连正在发声的音也一起变）；
  - 又因为 `programSet` 以「(通道,音色) 是否发过」判重，先设过的音色**再也不会补发** ⇒ 从那以后**整首**都按最后设的那个音色演奏。
  - 实测模拟（二声部、每声部 8 音 + 1 小节单声部 = 17 个事件）：`钢琴+电钢琴`/`小提琴+大提琴`/`长笛+竖笛` 三组**各错 11/17 个事件**（如 v1 期望 `prog0` 实得 `prog4`）；异族组合（钢琴+弦乐、大钢琴+手风琴）本就正常 ⇒ 与"只有某些组合出问题"的用户感受一致。
- **解决**：
  1. 新增 `engine/playback/channels.ts`（纯逻辑、零 DOM）：`GmChannelAllocator`——**一个音色独占一个通道**。同音色复用同一通道；新音色优先取空通道（跳过 GM 打击乐通道 9）；音色数超过 15 个时按 `program % 15` 复用。
  2. 后端改用分配器：`const ch = this.channels.channelFor(program)`。
  3. `programSet` 换成 `channelProgram`（通道 → 当前已设音色），在 **`onFn` 触发时刻**核对并补发：独占通道时只发一次，通道复用（>15 音色）时逐音补发 —— 顺带修掉「首个事件在时间上不是最早」时可能拿默认音色起奏的隐患。
  4. `stop()` 清空 `channelProgram`（`stopAll(true)` 会重置合成器状态，否则下次播放会跳过 `programChange` 而全部按钢琴演奏）；`dispose()` 再 `channels.reset()`。MIDI 文件导出（`eventsToMidi`）本来就是「每声部一条轨、`ti % 16` 通道、音色变化处插 program change」✓ 未受影响。
- **验证**：smoke 新增 **AM1–AM5**（分配器：同族不同音色分到不同通道、同音色复用、跳过通道 9、>15 音色只占 15 通道、第 16 种起才开始复用）、**AM6–AM9**（4 组音色对 × 真实事件序列 + 真实分配器 + 后端触发规则，逐事件校验音色，全部 17/17 正确）、**AMA–AMD**（结构守卫：后端用分配器、不得退回 `CHANNEL_OF`、触发时刻核对、`stop()` 清记录）、**AMN/AMN2**（`{bz}` 伴奏 = Y[1] 电钢琴、主声部 = Y[0] 钢琴，且各占通道）。失败项 **18 == 基线**；`tsc -b` + `npm run build` 通过；插件 `vendor/engine` 同步后 `tsc -noEmit` + smoke **119/119**。
- **预防**：① **凡"同时只能有一个值"的资源（MIDI 通道的 program、单例开关等），分配键必须取"真正需要独立的那个维度"**——这里需要独立的是**音色（program）**，而不是"乐器族"；按族合并只会在同族时互相踩。② **"发过就不再发"的判重缓存必须绑定"该资源当前的值"，并在使用时核对**（本次改为按触发时刻核对 `channelProgram`），否则一旦资源被别的值占用，缓存就会让正确值永不恢复。③ 排查"音色不对"类问题时，**先把链路切成两半**（序列里的 `instrument` 对不对 → 后端有没有照着发），本次正是靠"序列正确、后端错"这一步把范围从引擎缩到后端。④ 状态重置类调用（`stopAll(true)`）之后，**所有"我已设过什么"的本地记录都要一起清**。

### E-2026-186 段内音符不在「全局音符序号」流里、且旧 id 编码跨距只有 10 → `{bz}`/`{dsb}` 段内音符的光标联动两个方向全失效（用户报）（adj445）

- **现象**（用户）：预览区点 `{bz }` 区域里的音符，编辑区**不会定位**到对应音符；反过来在编辑区点 `{bz }` 里的音符，预览区相应音符**不会标红**。`{dsb }` 同样。
- **根因（两层）**：
  1. **段内音符不在主旋律音符流里**。临时段对主旋律时间轴贡献 **0 拍**（段是"叠加"，段后 token 从段前同一拍位继续），段内 token 挂在段头 token 的 `children` 上，**不在** Q 行的顶层 token 数组里。而 `cursorMap.codePosToNoteId` / `noteIdToCodePos` 只按「Q 行内第 n 个音符」的**全局序号**推算 id ⇒ 段内音符既算不出来（光标在段内时被算成"段前最后一个主旋律音"）也对不上（反查时全被解释为主旋律序号）。用户看到的正是"点段内音符 → 亮的是段前那个主旋律音 / 什么都不亮"。
  2. **旧 id 编码会撞号**。adj427～adj444 的段内 id 是 `900000 + 组号×1000 + 段头下标×10 + 段内序号`——「段头下标×10」的**跨距只有 10**，段内时值 token 超过 10 个时后 10 位就溢进下一个段头区块（`{bz 1 2 3 4 5 6 7 8 | 1' 2' 3' 4'}` 这类 12 音段极常见）⇒ 两个不同音符拿到同一 `data-notepos`，「按 id 高亮」会亮错音（`byIndex`/`indexToPage` 也会被后写者覆盖）。此外 `noteSeq` 只在**成功放置**时自增（`bx1 ≤ bx0` 被 `continue` 时不自增），一旦某音因挤不下被丢弃，其后所有段内音 id 全部错位。
- **解决**：
  1. **段内 id 改高位命名空间编码**（`layout/segments.ts` 新增 `segmentNoteIndexBase`/`segmentBarIndexBase`/`decodeSegmentNoteId`，layout 与 cursorMap **共用同一套**）：`index = SEG_NOTE_ID_BASE + 组号×1e6 + 段头token下标×1e3 + 段内时值序号`；小节线用 `SEG_BAR_ID_BASE` 另一段，二者与主旋律小整数 id 三者互不重叠；跨距 1e6/1e3 ⇒ 组内任意段、段内任意音数都不会撞号。
  2. **段内序号取「源码次序」**：`const seq = durSeq++` 移到"是否放得下"的判断**之前**，id 只由源码决定，与排版压缩/跳过无关。
  3. **`cursorMap` 两个方向都按同一套三元组定位**：`segmentSpansOf(tokens)` 枚举一行的段（段头下标 + `{`/`}` 列 + 段内时值 token 源码序），`codePosToNoteId` 在光标落入 `[openPos, closePos]` 时取"光标处或紧邻左侧"的段内音并把 id 编成 `组号 + 段头下标 + 序号`；`noteIdToCodePos` 用 `decodeSegmentNoteId` 解出三元组，回到第 `group` 个 Q 行、`tokens[openIndex]` 的 children 里取第 `durSeq` 个时值 token 的 `pos`。
- **踩坑**：`locateSegmentNote` 最初直接拿"相对 trimmed 行的列"和 token 的 `pos` 比，而 token 的 `pos` 是**相对曲行内容（`Q:` 之后那段）**的 ⇒ 每个段内音都偏了 `headLen`（`Q: ` 的宽度）而恒不命中，5 项断言全红。改传 `col - headLen` 后一次全绿（与主旋律路径 `t.pos + headLen > col` 同一口径）。
- **验证**：smoke 新增 **AL1～AL7**（`{bz}` / `{dsb}` / 同组两段 / 段内含 `&zkh`+`@乐器@` 非时值 token，各跑**两种布局**）：段内音符数、`decodeSegmentNoteId().durSeq` == 段内源码次序、id 唯一且 `indexToPage` 命中本页、**渲染出的 `data-notepos` 与 id 逐字一致**、`noteIdToCodePos`→`codePosToNoteId` 双向往返且落在**该音符自己的源码字符**上（含"光标在块末空隙仍取本块"）、同组各段 id 区块互不重叠、单段可容纳 >10 音而不越区块。失败项 **18 == 基线**；`tsc -b` 通过。
- **预防**：① **凡"某类元素不在主序号流里"，就必须给它独立命名空间并让两端共用同一个编解码函数**——本项目已有"段不占拍""隐藏休止符不绘制"等多处例外，任何"按第 n 个元素推算 id"的代码都要先问"这个元素真的在主序号流里吗"；② **打包多个字段进一个整数 id 时，跨距必须远大于该字段的取值上界**（本次是 10 而段内音轻松过 10），否则是定时炸弹；③ **id 的生成必须只依赖源码**，不能依赖排版结果（"放得下才自增"会让 id 随排版漂移）；④ 光标联动的断言要**打到渲染产物上**（`svg.includes('data-notepos="id"')`）而不是只比 `layout.notes`——`data-notepos` 才是两端真正的契约。

### E-2026-185 adj441 的「音符拍区间右端取 `nextNote.x`」跨过小节线 → 段层末音被钳成 0 宽而丢失（用户报）（adj444）

- **现象**（用户 + 截图）：`{bz 8 &zkh @手风琴@ 2'/ 3'/ }` 的伴奏层**只显示到 `2'/`**，`3'/` 不见了（`8` 是隐藏休止符、`(` 是 `&zkh`，都正常）。
- **根因**：**adj441 引入的回归**。adj441 为解决"最后一个子拍被算宽"把 `beatToX` 的音符拍区间右端从 `min(占位右端, nextNote.x)` 改成了 `nextNote.x`——但当**下一个音符在小节线另一侧**时，`nextNote.x` 可能远在 ~35px 之外，使本音符内部的拍位被**整体拉宽**：实测 `6, -`（2 拍）的 `beatToX(+1)` = **261.4** 而非应有的 244.9。段层内容随之**溢出内容区右缘** `xContent1`，末音 `3'/` 的 `bx1` 被钳到 `xContent1` 后 `bx1 ≤ bx0` ⇒ **整音被 `continue` 丢弃** ✓ 与截图一致。
- **解决**：`zoneEnd = nextNote ? min(nextNote.x, 本音符到下一个**小节线**的 x) : 占位右端`——即"本节拍区间止于**下一个音符或下一个小节线，取先到者**"（与色块右边界同一条规则）。新增 `nextBarXOf(x)` 用 `mainBarAnchors` 找本音符右侧最近的小节线。
- **效果**（两布局）：段层 3 个音全部放下，且每拍宽均匀——`8`(1 拍) : `2'/`(0.5) : `3'/`(0.5) = **48.7 : 24.3 : 24.3**（= 2:1:1）✓
- **验证**：smoke 新增 **AK1–AK3**（两布局）：段内 `@乐器名@` 不影响段层音符数（3 个）、末音有正宽度、每拍宽比 2:1:1。失败项 18 == 基线。
- **预防**：① **修 bug 时要检查"被改动的量"在其它场景的取值**——adj441 只验证了"两个相邻音符之间"的场景，没验证"两音符之间隔着小节线"的场景；② **"到下一个元素前"在本项目里始终是 `min(下一个同类元素, 小节线)`**（色块右边界、拍位映射都适用）——这是一个**通用口径**，任何一处漏掉小节线都会出问题；③ 段层内容"溢出即丢弃"的容错策略（`bx1 ≤ bx0` 就 `continue`）会让"宽度算错"表现为"音符消失"，排查时要**先量 `bx0`/`bx1`/`xContent1`**，不要先怀疑渲染。

### E-2026-184 桌面端也注册了 Service Worker → 重装后打开仍是旧界面、要 Ctrl+R 才更新（用户报）（adj443）

- **现象**（用户）：「PC 版**重新安装**后，打开的界面还是**旧版**界面，需要按 `Ctrl+R` 才能更新为最新界面；对普通用户不友好，可能认为没有更新」。
- **根因**：`src/main.tsx` 在 `import.meta.env.PROD && 'serviceWorker' in navigator` 时注册 `/sw.js`，原注释写着「Tauri（`tauri://localhost` 自定义协议）下注册会**静默失败**，不影响桌面端」——**这个假设是错的**：Tauri v2 在 Windows 下页面来自 **`http(s)://tauri.localhost`**，这是**安全上下文**，Service Worker 能正常注册并接管。于是重装后磁盘上虽然是新 bundle，**SW 仍从 Cache Storage 返回旧的 `index.html`/JS/CSS** ⇒ 界面停在旧版；`Ctrl+R` 强刷绕过了 SW 才看到新版。
- **为什么桌面端不需要 SW**：PWA 的离线能力是为**网页版**服务的；桌面端资源已随安装包落盘（`tauri.localhost` 下本地读取），SW 只带来"装了新版还显示旧界面"的陈旧缓存 —— **纯负担**。
- **解决**：① 新增 `isTauriDesktop()`（与 `playback/samplerCache.ts` 的判定同源，用 `window.__TAURI__.core.invoke`）；② **桌面端不注册** SW，且对**已装过旧版本的用户**主动 `getRegistrations()` → `unregister()` + `caches.keys()` → `caches.delete()` → 用 `sessionStorage` 标记**只重载一次**（避免"注销失败 → 无限刷新"，也避免每次启动都刷新）；③ 注册代码收进 `else` 分支（仅网页版/PWA）。
- **验证**：smoke 新增 **AJ8/AJ8b/AJ8c**（读 `src/main.tsx` 断言：存在桌面端判定、桌面分支含注销+清缓存、注册在 `else` 分支）。`tsc -b` + `npm run build` 通过；失败项 18 == 基线。
- **预防**：① **平台能力假设必须验证**，不能靠注释里的"应该会失败"——本次就是一句错误假设埋了长期的"重装不更新"（用户会直接理解为"没更新"）；② **PWA 的 SW 只应存在网页版**——凡"打包成桌面应用"的项目，都要显式判断运行环境来决定是否注册 SW；③ 升级路径要照顾**存量用户**：改了注册策略后必须**主动清理旧 SW 与缓存**，否则老用户仍然看到旧界面（本次用 `unregister + caches.delete + 一次性重载`）；④ 一次性重载必须加**幂等标记**（`sessionStorage`），否则出错时会陷入刷新循环。

### E-2026-183 段层**首个**色块左端外扩到左括号/`{` → 观感不对（用户修正）（adj442 修正）

- **现象**（用户截图）：dsb 上层 `1` 的红色块**从 `(` 左侧 / `{` 处开始**，把左括号整段都盖住了；用户指出「由于音符是**左对齐**（通常），所以起始的音符通常是对齐的，因此多声部/伴奏重叠部分**起始的音符是对齐的**，因此色块可以**不用从左括号右侧开始，而是从起始音符开始**」。
- **根因**：adj442 首版按"左右**对称**"处理——既然右端要外扩到段层右界（`&ykh`/括号是无时值占宽元素），就把左端也外扩到段层左界。但**两端的时间语义并不对称**：
  - **右端**：末音唱完之后还有"括号占宽但不占拍"的一段，该声部在这段时间里仍处于"本段末尾"⇒ 色块**应覆盖**到右界；
  - **左端**：重叠区首个音与主旋律对应音**本来就对齐**（音符左对齐），左括号所在的那段空间属于**本段开始之前**——把它涂上会让色块比"发声起点"更早，观感不对。
- **解决**：撤掉左端外扩（`buildPlayheadSegs` 里首块 `x` 回到 `blk.x`，不再用 `bounds.left`）；`segLeftByGroupVoice` 映射保留备用。右端外扩（AL5/Z18c/AL6）保持。
- **验证**：smoke **AL6 断言改为**「左端 = 起始音符、右端 = 大括号界限」（两布局）；其余 AL1–AL5、AJ1–AJ3、Y1–Y4、Z18 系列全部继续通过。失败项 18 == 基线。
- **预防**：① **"对称"是直觉陷阱**——一个区间两端的**时间语义**可能不同（一端是"还没开始"、另一端是"还没结束"）；先各自想清楚"这段时间该声部在不在发声"，再决定要不要涂色，**不要因为一端要外扩就顺手把另一端也外扩**；② 用户提"以 X 为界"时，要问清楚**是哪一端**、以及**另一端为什么不同**；③ 左端基准应取**音符自己的 x**（左对齐锚点），这是全项目"数字左缘"的统一基准。

### E-2026-182 段层色块的左右边界没按段型区分（用户规则：bz 以前后小节线为界、dsb 以大括号为界）（adj442）

- **要求**（用户）：「对于**临时伴奏**，应该是**以前后的小节线为界**；对于**临时多声部**，应该是**以大括号为界**为宜」。
- **此前**：色块边界一律用 `segmentBrackets.x2`（对 bz 那是右**圆括号**的外缘、对 dsb 才是 `}`），且**左边界完全没处理**（首个色块从段内首音的数字位置开始）。
- **解决**：在布局端按段型算出**色块占宽边界**并写进 `PlacedSegmentBracket.blockLeft/.blockRight`：
  - `dsb` → 大括号槽（`braceLeftX`/`braceRightX`，即 `{`/`}`）
  - `bz` → 包络两端的**主旋律小节线**（`barAtStart.x`/`barAtEnd.x`；无锚点时退回内容区边界）
  播放端据此：① **末块右缘**外扩到 `blockRight`（adj440 的推广）；② **首块左缘**外扩到 `blockLeft`——与右端对称（`&zkh`/左括号同样是**无时值占宽元素**，其占据的图形空间在时间上仍属本段开头）。
- **踩坑**：首块外扩起初用 `startBeat === 0` 判断"是否段内首个音"，但 `emitSegmentEvents` 对**每个**段层音符都传 `startBeat = 0` ⇒ 所有块都被拉到左界（AL4 立刻报错）。改为**按音符身份**判断（`segNotes[0] === placed`）。
- **验证**：smoke 新增 **AL6**（两布局）：dsb 首块左缘 = `x1`、末块右缘 = `x2`；既有 AL4（不跨段内小节线）/AL5（末块到大括号）继续通过。失败项 18 == 基线。
- **预防**：① **"起点参数"不等于"身份"**——`startBeat` 这类每次调用都重置的局部量不能用来判断"全局第一个"，必须用**对象身份**或显式传入的标志；② 段型（bz/dsb）在**几何语义上本就不同**（有/无大括号），凡涉及段层边界的计算都应**按段型分支**，不要"一套公式套两种段"；③ 左右对称的规则要**同时实现**（这次先只做了右端，用户立刻指出左端也该如此）。

### E-2026-181 段层同一拍的子拍宽之和不等于主旋律该拍的字距跨度（用户：「多声部同一拍的总占宽应该要一致」）（adj441）

- **要求**（用户）：「从视觉来看，多声部的**同一拍的总占宽**应该是要一致的」。
- **现象**：`{bz &zkh 1/ 2// 3// 2 3 4 | …}` 第 1 拍三个子拍（0.5/0.25/0.25 拍）实测 **11.10 / 5.50 / 12.50**，合计 **29.10**；而主旋律该拍的字距跨度也是 29.10 —— 但**三个子拍本身不均**（`3//` 是 `2//` 的 2.3 倍，应为相等）。空间优先下更明显（合计 26.10 ≠ 29.10）。
- **根因（两处）**：
  1. **内部插值端点用 `min(占位右端, 下一个音的 x)`**：`rightX`（含分配留白）常**小于**下一个音的 x（实测小 6.9px），于是内部插值止于 `rightX`、而边界处（半开区间）取的是 `next.x` ⇒ **最后一个子拍被算宽**（12.50 而非 5.55）。**两端必须同口径**，取「下一个音的 x」（= 该拍的视觉跨度"数字到数字"）。
  2. **包络末音的终点**随之跳到包络**之外**那个音的 x（越线），使 `segNaturalW` 虚大 ⇒ `segScale` 又被触发压缩（空间优先实测漂移 39px、子拍合计不足）。修法：**包络右界钳到主旋律小节线**（`segNaturalXEnd = min(beatToXEndOf(envEnd), xEndBoundary)`）。
- **解决**：`zoneEnd = 下一个音的 x`（无下一个音时用占位右端）；`segNaturalXEnd` 钳到 `xEndBoundary`。
- **效果**：两布局下 **段层子拍宽之和 = 主旋律同拍字距跨度**（同一拍总占宽一致）✓；子拍比 ≈ **2:1:1** ✓；三个子拍宽均 ≥ 数字净宽（不重叠）✓；dsb 上下层**逐拍精确对齐** ✓。
- **验证**：smoke 把 AJ1–AJ3 改为**两布局都跑**（此前空间优先被跳过）；**Y3/Y4 期望值更新**（段内容应铺满整段包络 `包络音 → 其后小节线`，而非止于主旋律音的 `rightX`）。失败项 18 == 基线。
- **预防**：① **一个区间的"两端"必须用同一个口径**——内部插值端点与边界取值不一致时，最后一个子元素必然被算错（本次两端口径差了一个 `rightX`）；② **"占位右端"（含留白）与"下一个元素的 x"不是同一件事**，前者是分配结果、后者是视觉位置；凡"到下一个元素前"的语义都要用后者；③ 用户的验收口径是**视觉几何**（"同一拍总占宽一致"），断言就该直接量这个等式，而不是量"某层被加宽了"这类实现细节。

### E-2026-180 段内**末音**色块止于内容区右缘、没到大括号 → 无时值占宽元素（`&ykh`）之后的空白被算作"无声"（用户要求）（adj440）

- **现象/要求**（用户）：「上层的 `1' &ykh`，其 `&ykh` 不占时值，因此 `1'` 的占宽应该也要到**大括号的界限**为宜」——即上层末音的色块应延伸到 `}`，而不是停在 `)` 之前。
- **根因**：段层色块右边界（`emitSegmentEvents.edgeOf`）对**最后一个音**取的是 `own`（= 该音占位右端 `rightX`），而布局把内容区收在 `xContent1 = xEndBoundary − tailPad`（`tailPad = barInset + nonDurGap + 括号宽`）——**为括号预留的那段空间**因此被当成了"已经不发声"。但 `&ykh`（以及右括号本身）是**无时值占宽元素：只占宽、不占拍**，其后的图形空白在**时间上仍属本段末尾**。
- **解决**：段内最后一个音的右边界改用**段层右界** `segmentBrackets.x2`（bz = 段层范围右缘，dsb = 大括号 `}` 槽位左缘）：`Math.max(segRightBound, own)`。与 adj439（下层钳到同一个 `x2`）合起来，**上下两层色块都恰好收在大括号的界限**。
- **验证**：smoke 新增 **AL5**（两布局）：段内末音色块右缘 = `segmentBrackets.x2`（误差 < 0.6px）。失败项 18 == 基线。
- **预防**：① **"占宽不占拍"的元素（`&zkh/&ykh`、括号、大括号）在时间轴上需要显式处理**——它们是图形上占据空间的"空拍"，色块**应当覆盖**这段空间（因为该声部在这段时间里仍在"这一拍/这一段的末尾"）；反之若把它们当作"已经结束"，色块就会提前断掉；② 布局里凡是 `tailPad`/`braceW` 这类"为装饰预留的宽度"，都要同时想清楚**时间语义**（是"这段还没结束"还是"已经结束"）——本次是前者；③ 上下两层用**同一个右界**（`segmentBrackets.x2`）最省心，也天然满足"上下对齐"。

### E-2026-179 dsb **下层**色块越过段层右界（大括号 `}`）→ 用户要求「色块都以大括号为界限定占宽」（adj439）

- **现象**（用户截图）：dsb 重叠区里，下层（包络内的主旋律 `5`）的绿色块从 `5` **跨过 `}`** 一直盖到包络**外**最后一个 `5` 之前；上层（段内容 `1'`）的红块是正常的。
- **根因**：下层是"被下移的主旋律音"，其色块右边界走的是**主旋律那套** `rightEdgeByNoteIdx` = `min(下一主旋律音符, 下一主旋律小节线)`；而它在包络内的**下一个主旋律音符在包络之外**（`}` 之后）⇒ 边界越过 `}`。上层走 `emitSegmentEvents` 的 `edgeOf`（收在段内容区 `xContent1` ≤ 大括号槽），所以上层正常。
- **解决**：按用户要求统一"**以段层右界（大括号）为界限定占宽**"——构建 `(页|曲行|声部) → segmentBrackets.x2` 映射，对 **`playVoice === 'second'`（dsb 下层）**的色块右边界取 `Math.min(base, segRight)`。bz 不加此钳制（bz 只在上方叠加、其括号在主旋律上方，钳制会白白缩窄主旋律色块）。
- **验证**：smoke **Z18 拆分**——`bz` 仍要求"与无段时逐段一致"（bz 不污染），新增 **Z18c** 断言 dsb 下层色块不跨过 `segmentBrackets.x2`。失败项 18 == 基线。
- **预防**：① **同一条规则（"色块到下一元素/小节线前"）在三条通道上各有一份实现**（主旋律 / 段内容层 / 段覆盖的下层），改一条要想清楚另外两条；本次下层用的是主旋律那套，而主旋律**不知道段层边界存在** ⇒ 必须由调用方补钳制；② 用户以"**以 X 为界**"提要求时，优先用 **X 的几何**（这里是 `segmentBrackets.x2`）作钳制，而不是另立一套估算；③ 把"段层不得影响主旋律"这类断言在语义变更时**拆分**（bz 不变 / dsb 按新规则），不要整条删掉——否则会丢掉 bz 那半边的回归保护。

### E-2026-178 段层色块右边界只看「下一个段层音符」→ 段内末音色块跨过段内小节线（用户报「色块占宽明显有误」）（adj438）

- **场景**：dsb 段内有自己的小节线（`{dsb 1 2 3 4 | 5 6 7 1' }`），段层音符与段内小节线都排在包络内。
- **现象**（用户截图）：dsb **上层** `4` 的红色块**越过 `|`** 一直盖到下一小节首音 `5` 之前，看起来像 **1.5 拍宽**（下层主旋律的绿块是对的，止于 `|`）。
- **根因**：`emitSegmentEvents` 的 `edgeOf`（段层色块右边界）只取"**同段内下一个段层音符**的左缘"（adj427 为避免与主旋律那套 `rightEdgeByNoteIdx` 互相污染而特意独立的一套），**完全没看段内小节线**。于是段内末音 `4` 的右边界 = 15px 之外 `5` 的 x ⇒ 跨线。
  （对照：主旋律的 `rightEdgeByNoteIdx` 取的是 `min(下一音符, 下一小节线)`，规则本来是"到下一时值元素**或小节线**前"——段层这套漏了后半条。）
- **解决**：给段层色块也加**段内小节线**边界（从 `page.barlines` 里取 `b.segment` 且同 group/voice 的 x）。**注意小节线必须是硬上限**——第一版写成 `Math.max(edge, own)`，而段层音符的"占位右端"`rightX`（含分配留白）本就可能越过段内小节线（实测 own=315.3 > 线 299.6），`max` 会把钳制盖回去、色块照样跨线；改为 `Math.min(barX, Math.max(next, own))` 才对。
- **验证**：smoke 新增 AL4（两布局各跑）：段层色块区间不得包含任一段内小节线 x。修复前 `268.0~315.3` 含 299.6（失败），修复后通过。失败项 18 == 基线。
- **预防**：① **"色块到下一元素或小节线前"是一条完整规则，两套实现都要实现全**——段层那套独立出来是为了避免坐标污染，但顺手漏了小节线这一半；② 新增"独立右边界算法"时，要**逐条对照既有算法做到了什么**（这里就是漏了一条分支）；③ **钳制类代码里 `Math.max(own, X)` 会抵消上限**——凡"上限"语义都要用 `Math.min` 兜在外层，`own`（自身墨迹）只能用来抬高下限。

### E-2026-177 `segScale` 被误触发（溢出只在「尾括号预留区」内）→ dsb 上下两层逐拍漂移（用户报）（adj437）

- **场景**：`{dsb 1 2 3 4 | 5 6 7 1' } 5 6&dy 7&yc 1' | 1' 7 6 5 | 5 5` —— 段内容 8 拍、包络 8 拍（拍数相等）。
- **现象**（用户报 + 截图）：「多声部的拍子也没有对齐」——两层**起点对齐、随后逐拍递增漂移**：实测（空间优先）每拍偏 **1.95px**、末拍偏 **13.6px**；内部小节线也只差 5px。
- **根因**：adj433 修好 `beatToX` 之后，`segNaturalW`（段层自然映射总宽）≈ 主旋律覆盖区真实宽度，此时剩下的"溢出"**只是 `tailPad`**（= `barInset + nonDurGap + 尾括号宽` ≈ 16.75px）——那是**本该留给 `)` 的空间**，不是越界。但 adj430 的 `segScale = min(1, segContentW/segNaturalW)` 照样触发：实测 `291.45/308.9 = 0.9435` ⇒ 8 拍被整体压缩 5.65% ⇒ **逐拍漂移**（压缩以 `xContent0` 为原点，所以起点对齐、越往右偏得越多 —— 正是"起点对齐+递增漂移"这个特征）。
- **解决**：给 `segScale` 加**触发判据**——`segNaturalXEnd > xEndBoundary + bracketReserve + 0.5` 才整体压缩；否则 `scale = 1` 保证**逐拍精确对齐**，只把**最后一个音**的右缘钳到 `xContent1`（该音占位变窄，但数字墨迹远在占位右端左侧，观感不受影响；实测末音宽 8.1~16.0px，与 `)` 仍有 ≥5px 净距）。
- **验证**：两布局实测 MEL 与 SEG 的 x **逐个完全相等**（`[158.0 195.7 233.4 271.0 316.2 353.9 391.5 429.2]` 两行一致）；smoke 新增 AL1–AL3 ×2 布局（逐拍最大偏差 < 0.51px、末音不压右括号、宽度>0 且单调）。失败项 18 == 基线。
- **预防**：① **"溢出"要分清是"真的越界"还是"占用了本该属于自己的预留区"**——后者压缩是错的；② 整体压缩的代价是**逐拍漂移**（锚点端对齐、远端偏移），对"上下两层对齐"这种要求逐拍成立的场景**不可接受**，宁可只钳制末端一个元素；③ 用户描述"起点对齐、越往右越偏"时，第一反应就该是**"某处做了以起点为原点的整体缩放"**。

### E-2026-176 倚音是独立事件但不继承音色来源 → 试听音色把 `@手风琴@` 之后的倚音压回主音色（用户报）（adj436）

- **场景**：谱面 `|"p:4/4" @手风琴@ 6/"原速" 3'// (2'// 2') … (3/[3/5/] 3) - 2'/ 3'/ |`，倚音 `[3/5/]` 依附在 `3` 上。
- **现象**（用户报）：「演奏到 `3/[3/5/]` 处又切回主音色了，这是不对的，应该还是手风琴」。**这也反证了试听对话框的「音色」确实选了具体音色**（否则不会有全局覆盖）。
- **根因**：adj434 的 `explicitInstrument` 只加在**主音符事件**上；而**倚音是以独立事件发声的**（`events.push({ …, pitch: gracePitches[gi] })`，前倚音在主音符之前、后倚音在其之后），那两个 `push` 既没有 `explicitInstrument` 也没有 `playVoice`。于是调度端 `keepOwn = isSecondary || explicitInstrument` 判为 false ⇒ 走 `voiceOverride ?? …` ⇒ 倚音被「试听音色」压回主音色。**主音符是对的、只有倚音串味**，所以听感上是"到倚音处突然切回去"。
- **同类隐患（一并修）**：缺少 `playVoice` 还会让**段内（bz/dsb）音符的倚音丢掉伴奏/第二声部音色**（`isSecondary` 判不出来），并让倚音色块落到主旋律色组。
- **解决**：两处倚音 `events.push` 补 `playVoice: playRole` 与 `...(hasExplicitInst ? { explicitInstrument: true } : {})`——**倚音继承所属主音符的声部角色与音色来源**。
- **验证**：smoke 新增 AX8/AX9/AX9b/AX9c（用户原行含 `3/[3/5/]`）：存在倚音事件、音色 = 手风琴、**带 `explicitInstrument`**、带合法 `playVoice`。失败项 18 == 基线。其中 **AX9b 是真正的回归护栏**——`instrument` 字段本来就算对了，出问题的只是"要不要保留自己音色"这个标志位。
- **预防**：① **一个音符被拆成多个事件时，所有事件必须继承同一份"演奏上下文"**（音色、声部角色、力度）——本项目的音符拆分点有：倚音（前/后）、连音合并、临时段补发；任何新增拆分点都要照抄这套字段；② 排查"某处音色/音量突变"时，先问**"这一拍是不是被拆成了多个事件"**（倚音、连音、段层），因为只有拆分事件才会漏字段；③ 断言要打在**标志位**上（`explicitInstrument`），而不是打在"看起来对"的 `instrument` 上——后者在 bug 存在时也是对的，测不出问题。

### E-2026-175 段层与主旋律重叠区没有按「多声部方式」算占宽 → 段内密集拍音符挤在一起（用户报）（adj435）

- **场景**：段层与主旋律在包络内**上下重叠**——本质就是一个"多声部块"。多声部块的占宽规则是**每拍取各声部里更密那一层的需求**（`segBeatMap` 的 `minDur`/`extra` → `minNoteW/minDur`，见 `allocatePerBeats`/`singleRulePerBeats` 的 `baseW`）。
- **现象**（用户报 + 截图）：`{bz &zkh 1/ 2// 3// 2 3 4 | 5 6/ 5/ 7 1' &ykh } 5 6/ 5/ 7 1' | …` —— 段层第 1 拍有 3 个音（最小时值 1/16），主旋律同拍只有 1 个音（`5`）。实测子拍宽 **11.0 / 5.5 / 12.5 px**（应 ≈2:1:1），`2//` 只有 5.5px < 数字净宽 ⇒ **视觉重叠**。
- **根因（两层）**：
  1. **`beatToX` 混用两套坐标系**：音符起点分支返回 `n.x`（数字位置），内部插值却以 `n.segments[0].x`（**拍槽左缘**）为基准——两者相差 ≈ (槽宽−数字宽)/2 ≈ **11px**，在"音符起点"处产生跳变（实测第 1 子拍被压成 5.9px、第 3 个被拉成 16.1px）。同一函数的**端点**口径也不一致：内部用 `rightX`，而边界半开区间取"下一个音符的 `x`"（比 `rightX` 靠左 3px）⇒ 最后一个子拍再被算短（5.2px）。
  2. **重叠区没参与行宽分配**：段层此前只做"叠加"，主旋律行按**自己的**密度给拍宽 ⇒ 段层更密的拍拿不到额外宽度。
- **解决**：
  - `beatToX` 统一口径：基准用 `n.x`，端点用 `zoneEnd = min(占位右端, 下一个音符的 x)`（两端同口径、无跳变），各子拍宽 = `(zoneEnd − n.x) × 子拍时值/音符时值`。
  - **时值优先**：新增 `segBeatNeedsOf(gi)`（按曲行缓存段层"每拍最小时值 + 倚音额外宽"）；`placeMusicRow` 把段层需求并进 `beatsInfo[p]`（`minDur` 取更小、`extra` 取更大），经 `baseW = max(BPW_NATURAL, minNoteW/minDur)` 让密集拍拿到宽度。
  - **空间优先**：`placeMusicRowSpace` 增加"缺口两遍分配"——先按基准每拍宽找段层更密的拍与缺口，把缺口并入本体宽后重算（因 `W = availW − durBodySum − nonDurPad`，并入缺口让富余等量减少 ⇒ **行总宽不变、不溢出**）。
- **验证**：时值优先路径实测子拍宽由 5.9/8.3/16.1 变为 **19.9/9.9/9.9**（比例 2:1:1、均 ≥ 数字净宽），被覆盖的主旋律拍由 33.9 加宽到 **57.4**，段首音与主旋律 `5` **精确对齐**（x 都是 158.0）。smoke 新增 AJ1–AJ5（两布局各跑对齐/单调；时值优先另跑宽比与不重叠）。失败项 18 == 基线。
- **未完成（待续）**：**空间优先路径的"取更密层需求"未生效**——`minNoteW = noteSize*0.62 + H_GAP + extra`，而 `H_GAP` 在 adj66 被调成**负值**（-2），于是 `segPerBeat = minNoteW/minDur` **系统性低估**（本例算出 24.2 < 实际拍宽 36.2 ⇒ 判定"无需加宽"，块被跳过）。需改用**不含间隙的字形槽宽**（`digitSlotW(ns)`）作为需求口径，或让 `segBeatNeedsOf` 直接给出"该拍需要的总字形宽"而非"每拍宽"。
- **预防**：① **"叠加层"必须参与宿主行的宽度分配**——只要它在视觉上与宿主重叠，就不能只按自己的密度排版（本次与 E-2026-163「叠加层污染宿主几何」是同一类结构性问题的两个方向）；② 修"坐标系混用"时要**同时检查函数两端口径**（起点基准 / 终点基准），只改一头会把误差挪到另一头；③ `H_GAP` 这类**负值间距常量**不适合直接当"最小宽度"用——凡是"需要多少像素才不重叠"的计算，都必须用**字形净宽**而不是"含间距的槽宽"。

### E-2026-174 段层拍位与主旋律错位（用户报「bz/dsb 上下层拍子没对齐，之前还好好的」）（adj433）

- **场景**：`placeSegmentOverlays` 用 `beatToX(拍位)` 把段内音映射到主旋律几何上。`beatToX` 原本只在**音符起点**做锚点插值：拍位落在音符起点 → 返回该音符 x；落在**音符内部** → 朝**下一个音符的 x** 线性插值。
- **现象**（用户报）：bz/dsb 上下层**逐拍对不齐**——段内音比对应主旋律音位偏左/偏右，且**之前（v0.20.0 刚做完 adj427 时）是对齐的**。
- **根因（两处叠加）**：
  1. **音符内部拍位跨到了下一个音符**：相邻音符之间夹着**小节线占宽 + 槽间留白**，把它们算成时值宽会让映射总宽虚大。实测用户原例：主旋律 `6, -`（跨 2 拍）自身只占 27.9px（198.9→195.9 区间的实际），但旧 `beatToX(envEnd)` 跨到了**下一小节**那个 `6/` 的 x，使"段内自然映射总宽"算成 58.5px。
  2. **adj430 的 `segScale` 把这个虚大的总宽压缩回内容区**：`scale = 25.35/58.5 = 0.433` ⇒ 段内所有音被**整体压缩到 43%** ⇒ 与主旋律拍位全面错位。**adj430 修好了"内容不丢失"，却引入了"拍位错位"**——两者是同一个错误映射的两面。
- **解决**（`beatToX` 改为"在音符**自身**范围内插值"）：
  1. 用**半开区间** `[startBeat, startBeat+beats)` 定位拍位归属的音符——拍位正好落在两个音符交界处时归**后一个**（否则会把上一音的右缘当本拍位，整体左移一个音符宽）。
  2. 音符内部**优先用该音符自己的拍段 `segments`**（layout 已按拍给出每段 x/perBeat，含增时线/附点分段）——这是最精确的"同拍位"几何；拍段之间同样用半开区间（拍位落在段末端时归**下一段起点**，因为 `6, -` 的 note 段 `x` 是"数字槽"而非该拍几何中点）。
  3. 无 `segments` 时退化为在 `[note.x, 该音符占位右端]` 内线性插值。
  4. 新增 `beatToXEndOf(beat)`：**包络终点**语义不同——`beat` 落在音符边界时要取**前一个音符的右缘**（"覆盖到的最后一音的结束"），而不是 `beatToX` 取的"下一个音符起点"。段的自然映射总宽与末音右缘都用它。
- **验证**：`segScale` 在用户原例下由 0.433 变为 **1.0**（不再压缩）；smoke 新增 Y1–Y4：段层不丢失、段首音与包络起点音同 x、**段层占宽 / 主旋律包络音占宽 ≈ 1.0**、段层各音不跨小节。失败项 18 == 基线。
- **预防**：① **"拍位 ↔ x"的映射必须区分"音符起点锚定"与"音符内部插值"**——前者要精确对齐，后者**绝不能跨音符**（音符之间的空隙不是时值）；② 出现"先修 A 又坏 B"时，要怀疑 **A 的修复是否建立在错误的中间量上**（这里 adj430 依赖了一个虚大的 `segNaturalW`，adj433 修好映射后 adj430 的压缩自然退回 1.0，**两层修复互相印证**）；③ "起点"与"终点"的边界语义**方向相反**（起点取后一个、终点取前一个），要显式分成两个函数，别用同一个 `beatToX` 硬凑；④ 断言要量**比值**（`段层占宽 / 主旋律占宽`）而不是"看起来差不多"——比值 0.43 与 1.0 的区别一眼可见。

### E-2026-173 曲内 `@乐器名@` 被「试听音色」的全局覆盖压掉 → 主声部不切换（用户报）（adj434）

- **场景**：谱面里写 `|"p:4/4" @手风琴@ 6/"原速" …`，用户期望从这里起主声部换成手风琴。
- **现象**（用户报）：「到 `@手风琴@ 6/"原速"` 这里主声部没有切换为手风琴」。
- **排查**：引擎层**是对的**——smoke 实测 `@手风琴@` 之后的主声部事件 `instrument === '手风琴'`（AX4），色块音色集合也含 `大钢琴`+`手风琴`（AX6）。问题在**播放端优先级**：`SpessaSynthBackend.play` 里 `program = opts?.keepInstrument ? instrumentToProgram(instrument) : (this.voiceOverride ?? instrumentToProgram(instrument))`——`voiceOverride` 是试听对话框「音色」下拉选定的**全局覆盖**，一旦非空就把每个事件自己的音色压掉。adj427 只为伴奏/第二声部加了 `keepInstrument`，**普通主声部事件（含曲内 `@` 切换）没有**。
- **解决**：给 `PlayEvent` 增加 `explicitInstrument?: boolean`——**只有**来自曲内 `@乐器名@` 的事件为 true（`Y:` 行与缺省音色**不**标记）；`schedulePlay` 的 `keepOwn = isSecondary || ev.explicitInstrument`，据此传 `{ keepInstrument: true }`。语义变成：**曲内的、局部的、明确的演奏指示 > 全局默认音色**；「音色」下拉仍可覆盖 `Y:` 与缺省音色（保留试听用途）。
- **验证**：smoke 新增 AX1–AX7c 共 9 条（两个 `@手风琴@` 的解析位置、段内 instrument 进 children、段前/段后主声部音色、段层伴奏音色、色块音色集合、`explicitInstrument` 三态）。失败项 18 == 基线。
- **预防**：① **"全局设置"与"局部指示"冲突时，局部优先**——这是本项目的第二次同类问题（adj427 的 E-2026-164 是伴奏音色被压掉，这次是 `@` 切换被压掉），**根因都是"全局覆盖没有区分作用范围"**；② 新增"全局覆盖"类能力时，要同时定义**它不覆盖什么**并写进文档（本次补了 SYNTAX 的音色优先级说明）；③ 排查"某功能无效"时**先分层验证**（引擎序列 → 调度 → 后端），本次正是先证明引擎正确、才把范围收敛到后端一行三元表达式。

### E-2026-172 v0.20.0 以来复查：`roundPxIntegers` 漏了新字段 `segmentRowGap`（嵌套数值对象不取整）（adj432 复查）

- **场景**：v0.20.0 之后累计 6 个提交（adj428~adj432）。复查"新增可选字段是否在所有字段清单里登记过"。
- **现象**：`roundPxIntegers`（adj413：**设置与间距里的 px 一律整数**）显式处理了 `heights`（数组）与 `metaPos`（嵌套对象），但**没有** adj428 新增的 `segmentRowGap`（嵌套对象）。于是手改的 `# jps-config:{"segmentRowGap":{"bz":22.5}}` 读出来仍是 `22.5`，与约定不符（应用内写入路径已取整，**读入端**却不归一化；插件 frontmatter 走 `mergeJpsConfig` 同样漏掉）。
- **根因**：`roundPxIntegers` 是**手维护的字段清单**，没有像 `OPTIONAL_CONFIG_FIELDS` 那样的**编译期完整性断言**兜底——新增字段时容易只记得改 `OPTIONAL_CONFIG_FIELDS`（有断言报错）而忘了 `roundPxIntegers`（不会报错）。
- **解决**：`roundPxIntegers` 补 `segmentRowGap` 分支（`bz`/`dsb` 逐项取整；缺失/非数值不造出假字段），并加注释说明"以后新增嵌套数值字段必须在这里补一段（无编译期兜底，只能靠注释 + smoke 断言）"。smoke adj413 段补 3 条断言：`{bz:22.5,dsb:30.4}` → `{bz:23,dsb:30}`、缺失时为 `undefined`、读取端 `{"bz":22.5,"dsb":30.6}` → `{bz:23,dsb:31}`。
- **预防**：① 新增**可选/嵌套**配置字段时，要同时检查**四处**清单：引擎 `OPTIONAL_CONFIG_FIELDS`（有断言）、引擎 `roundPxIntegers`（**无断言**）、插件 `PAGE_CONFIG_FIELDS`（有断言）、插件 `OPTIONAL_FIELD_KIND`（对象型可透传）——本次只有 `roundPxIntegers` 漏了；② 有编译期断言的清单是安全的，**没有断言的那份才是风险点**，改动时要主动回想；③ 读取端与写入端都要归一化（本项目 adj413 定的是"两端各过一遍"，新增字段必须两端都能覆盖）。

### E-2026-171 上下层音色相同时色块被合并成一块（分组键缺 `playVoice`）（adj432 复查）

- **场景**：`PlayheadLayer` 按 `(pageIndex, group, voice, instrument)` 分组，每组画一个色块——设计意图是"重叠区上下两层各有自己的色块"。**adj432 复查时发现该键不含 `playVoice`**。
- **现象**：谱面只写一条 `Y:` 时（如 `Y: 手风琴`）——主旋律音色 = `Y[0]` = 手风琴；`{bz … }` 伴奏的 `accompInstrument()` 因为 `Y[1]` 不存在而**回退到「手风琴」** ⇒ 上下两层的 `(page,group,voice,instrument)` **完全相同** ⇒ 两层被并成一组 ⇒ **只画一个色块**（用户看到的还是"只有一个色块"，与 adj427 修好的表现回退）。dsb 同理（`Y[0]` 与 `Y[1]` 同名时）。
- **根因**：分组键用"音色"区分上下层，但**音色可以相同**（回退默认值就是同一个）；真正的区分维度是**声部角色** `playVoice`。
- **解决**：分组键加上 `playVoice`：`${pageIndex}|${group}|${voice}|${instrument}|${playVoice ?? ''}`。键仍以 `${pageIndex}|` 开头，`PlayheadLayer` 的页过滤不受影响。
- **验证**：smoke 新增 X7/X7b/X7c 三条断言——前提（只有一条 `Y:` 时上下层 instrument 都是手风琴）、**旧键确实把两层并成一组**（复现 bug）、新键把两层分开且含 `accomp` 键。
- **预防**：① **"区分维度"不能借用"表现维度"**——音色是"听起来像什么"，声部角色才是"是哪一层"；用表现维度做分组键，一旦两个角色表现相同就会塌陷；② 这类 bug 只在**特定数据组合**下出现（音色同名），日常样例（`Y: 钢琴` + `Y: 弦乐`）永远测不到——写分组/去重键时要问"这个键在什么输入下会塌陷"；③ 断言要**先复现旧行为**（X7b 证明旧键合并）再验证新行为（X7c），否则只是"看起来通过了"。

### E-2026-170 段层行虚线混在普通行距虚线里：颜色一样、拖错了变量（用户要求）（adj432）

- **场景**：`computeRowGuides` 用 `page.notes` 推导行顶——临时叠加段的段层音符（`y = yUpper`）**也在 `page.notes` 里**，于是段层自动多出"行"，预览区为它画了一条普通曲行虚线（绿色）。
- **问题**（用户要求）：① 段层虚线与普通曲行虚线段**颜色一样**，看不出这是"段层"；② 拖它会走 `ri===0 → body_margin_top` / `voiceIdx>0 → height_shengbu` / 否则 `height_ciqu(_lyric)` 的分支——**拖段层虚线会改谱面行距**，把排版改坏（段层是叠加层，不占主旋律拍位，跟行距无关）。
- **解决**：
  1. `RowGuide` 增加 `segType?: 'bz'|'dsb'` + `segLayer?: 'upper'|'lower'`；`computeRowGuides` 在累计行时记录来源——`n.segment?.type`（段内容层）或 `n.playVoice === 'second'`（dsb 下层 = 被 `shiftEnvelopeDown` 下移的主旋律，它**不设** `segment` 字段，只设 `playVoice`）。
  2. 预览层给段层行加 `guide-seg` class（**紫色** `#a855f7`）区分；`onMouseDown` 走 `segmentRowGap_bz` / `segmentRowGap_dsb`。
  3. 拖动写回是**子对象**（`PageConfig.segmentRowGap.{bz,dsb}`）而不是顶层字段——`onMove` 里对这两个 key 特判，写 `{ ...cur, [which]: val }`。
  4. 拖拽方向：段层**上层**向上拖 = 增大间距（`invert: true`，因为 `dragDelta` 的 `curY - startY` 向上为负）；dsb **下层**向下拖 = 增大间距（不 invert）——两个方向都符合"往外拖 = 拉开"的直觉。
  5. `GUIDE_LIMITS_EX` 补 `segmentRowGap_bz` / `segmentRowGap_dsb` = `[10, 80]`（与设置面板一致）。
- **验证**：smoke 新增 X1–X5 共 12 条断言（playheadSegs.playVoice 透传三类角色；bz/dsb 段层行的 segType/segLayer 标记；GUIDE_LIMITS_EX 范围；`segmentRowGap` 22→50 时段层 y 上移 28 的几何一致性）；`tsc -b` + `npm run build` 通过；smoke 失败项 18 == 基线；`preview:render` 7 谱 `errors=0`；obsidian-ijipu 同步 `layout/guides.ts` + `playback/sequence.ts`，`tsc -noEmit` + `smoke` 119/119 全绿。
- **预防**：① **叠加层元素混进"行结构推导"是结构性隐患**——`computeRowGuides` 假设"`page.notes` 里的每个 y 都是一个排版行"，段层打破了这个假设。凡新增"往 `page.notes` 追加元素"的功能，都要审查所有"遍历 `page.notes` 推结构"的代码（与 E-2026-163 同源）；② 虚线的**颜色必须与它拖的变量一一对应**（青=边距、橙=描述头、绿=行距、紫=段层间距），否则用户无法判断"我在拖什么"；③ 拖动写回要区分"顶层字段"与"子对象字段"——`GUIDE_LIMITS_EX` 的 key 是扁平字符串，但目标可能是嵌套路径，必须显式特判（这次用 `segmentRowGap_bz` 这种"路径编码"key + 特判）。

### E-2026-169 段头括号被分到 `tailBrackets` → `&zkh` 跑到 `3'/` 之后（用户原例 `{bz 8 &zkh 2'/ 3'/}` 的 `&zkh` 显示在 `3'/` 右侧而非 `2'/` 之前）（adj431）

- **场景**：adj430 修复后 `{bz 8 &zkh 2'/ 3'/}` 的 `2'/ 3'/` 已显示，但 `&zkh` 位置不对——画在 `3'/` 右侧（看起来像 `)` 跑到最右），而用户期望它在 `2'/` 之前。
- **现象**（用户对照截图）：上方段层从左到右依次是 `2' 3'`（中间无空格），最右侧多了一个 `(2` 形状的括号。这是 `&zkh` 的位置。
- **根因**：`placeSegmentOverlays` 用 `seenNote` 判断 lead/tail 分类——遇到任何 durational token 就视为"已发声"，后续 bracket 归 tailBrackets。但 `{bz 8 &zkh 2'/ 3'/}` 的 `8` 是 **hidden rest**（`hidden=true`，不画、不发声），却依然被 `seenNote = true` 触发，导致 `&zkh` 被分到 tailBrackets → 排在所有 durational token 之后。
- **第一次修复（adj431a）**：把判断从 `isDurational(t)` 改为 `isDurational(t) && !(t.kind === 'rest' && t.hidden)` —— hidden rest 不算"已发声"。`&zkh` 现在正确分到 leadBrackets，渲染位置变成**段首音 `8` 之前**（x=189.90）。但用户期望**`&zkh` 靠近 `2'/`（第一个发声音）**，而不是 `8`（hidden rest）。
- **第二次修复（adj431）**：把括号锚点从 `xContent0` 改成 **`firstPlayedX`**——扫一遍 seg.tokens 找到第一个真正发声的 token（跳过 hidden rest），用它的拍位作为 leadBrackets 的左锚点。bz 分支的 `leftSlots.x = firstPlayedX − bgap − leadW`、`rightSlots.x = lastPlayedRightX + bgap`（同样跳 hidden rest）。dsb 分支保持不变（dsb 包络起点 = 拍位映射起点 = dsb 下层主旋律基线，没有 hidden rest 占位语义）。
- **几何**（用户原例）：`{bz 8 &zkh 2'/ 3'/}`，`firstPlayedBeatAbs = envStart + 1`（跳过 1 拍 hidden rest 后到达 `2'/`）→ `firstPlayedX = beatToX(envStart+1) = 266` → `&zkh.x = 266 − 6.5 − 5 + 2.5 = 257` ≈ 紧贴 `2'/`（x=251.60），`2'/ 3'/` 中间位置。
- **预防**：① **"已发声"语义必须区分可见 vs 隐藏**——hidden rest `8` 用于占拍但**不画不响**，参与"声部对齐"语义但不参与"视觉布局"语义；所有"基于源码位置的视觉判断"都要把 hidden rest 排除；② lead/tail 分类不应用 `isDurational` 而应用 `isPlayedToken`（更严格：排除 hidden rest）；③ 段内音和段内括号的锚点**分别**用 `xContent0`（包络拍位映射起点，对齐主旋律）vs `firstPlayedX/lastPlayedRightX`（第一个/最后一个发声位置，决定括号视觉邻接）——两者在段内没有 hidden rest 时一致，有 hidden rest 时必须分开计算；④ smoke W6f 专门覆盖此场景（用户原例 + 检查 `&zkh` 离 `2'/` < 20 px）。
- **验证**：smoke W6f 新增断言 `&zkh` 离段内第一个发声音 < 20 px；`tsc -b` 通过；smoke 失败项 18 == 基线；obsidian-ijipu `tsc -noEmit` + `smoke` 119/119 全绿。

### E-2026-168 段内音拍位映射越界 → 段内容丢失（用户原例 `|"p:2/4" {bz 8 &zkh 2'/ 3'/ } 6, - |` 的 `2'/ 3'/` 不显示）（adj430）

- **场景**：`adj427` 实现段层拍位映射时直接用 `beatToX(envStart+beatAt)` 作为 bx0、`beatToX(envStart+beatAt+dur)` 作为 bx1。
  `beatToX` 基于主旋律相邻音符锚点插值，**可能越过包络末小节线**（spans[1] 是下一小节音符）。
  当段内容总拍位映射宽 > 段内容区宽（`xContent1 − xContent0`），后续音 bx0 > xContent1 ⇒ bx1 ≤ bx0 跳过。
- **现象**（用户原例实测）：
  - 谱：`Q: 6,/ 3// (2// 2) 2/&rit 3/ 6,/ 5,/&yc |"p:2/4" {bz 8 &zkh 2'/ 3'/ } 6, - | 6 5 |`
  - 主旋律 bz 包络 `6, -` 跨 2 拍（2/4 小节），段内容 `8 + 2'/ + 3'/` 也是 2 拍。
  - 期望：段层画 8（hidden rest）+ 2'/ + 3'/ 共 3 个 placedToken。
  - 实际：只画了 8，`2'/ 3'/` **完全丢失**。probe 显示 `segNotes.length=1`，token 流 children 4 个但 placedToken 只 1 个。
- **根因**：`beatToX(envStart+1)` 走 `spans[1]=下一小节音符（idx=9 的 6,，x=226.5）` 插值，结果落在主旋律 `|`（x=210.1）**右侧** ⇒ bx0=226.5 > xContent1=193.35 ⇒ `2'/` 被跳过；同理 `3'/` 也跳过。
- **解决**：`placeSegmentOverlays` 段内循环改为：
  1. 算段内自然拍位映射总宽 `segNaturalW = beatToX(envStart+segTotalBeats) − beatToX(envStart)`。
  2. 算缩放因子 `segScale = min(1, segContentW / segNaturalW)`（自然宽 ≤ 内容宽 ⇒ scale=1；自然宽 > 内容宽 ⇒ 整体压缩）。
  3. 每个音 bx0/bx1 = `xContent0 + (拍位映射 − 自然段起点) × segScale`，再钳制 bx1 ≤ xContent1。
  4. 这样段首音 bx0 = xContent0（对齐段左界）、段末音 bx1 ≤ xContent1（不溢出）；中间按段内拍位比例映射。
- **设计权衡**：之前 U8 测试**逐音**断言段音 x = 主旋律拍位 2..9 x — 这个语义在拍位映射不溢出时成立（adj427 原设计例 `{bz &zkh 1 2 3 4 | 5 6 7 1' &ykh }` 8 个音 2 个小节，spans 跨段对齐，没有溢出），但**不是** "bz 内容按比例映射" 规范的本意。规范说 "bz 内容按比例映射到该宽度内"，所以修复后语义更接近规范。U8 已拆分为 U8a（段首对齐）+ U8b（段末不溢出），去掉"逐音严格对齐"的强假设。
- **预防**：① 拍位映射必须**校验** `xEndBoundary` —— `xEndBoundary = min(beatToBarX(envEnd), row.right)` 已经存在但**只用于段层小节线**，段内音用 `beatToX` 没做同样的钳制 ⇒ 用户实测踩中；② 凡涉及"两个坐标系映射"（拍位 ↔ x），必须**比较两套几何**（自然映射宽 vs 内容区宽），超界就**整体缩**而不是**逐项跳**——后者会让用户以为"丢失了音符"实际是几何算爆了；③ 涉及"段层 vs 主旋律"的语义断言，要明确"拍位垂直对齐"是**段首/段末**（与 xContent0/xContent1 对齐）还是**每个音**（与主旋律逐音 x 相等）——后者在包络跨小节时物理上不成立。
- **验证**：smoke 新增 W6a-e 共 5 条断言（用户原例）：W6a 段层 3 个 placedToken（不丢失 2'/ 3'/）；W6b 每个音宽度 > 0；W6c 三个音 bx0 单调递增；W6d bx1 ≤ 主旋律包络后小节线（不溢出）；W6e 总宽合理。U8 重写为 U8a/U8b 段首段末对齐语义。`tsc -b` 通过；smoke 失败项 18 == 基线。

### E-2026-167 dsb 上下色块高度不对称（25 vs 19）→ 视觉上"一边高一边低"（用户报）（adj429b）

- **场景**：adj429 修复 dsb 上下层重叠后，采用"沿 mid 对半劈"的方案，但上下块高度差 6.5 px（25 vs 19，dy=22 时）。用户报告"上下看起来不均衡"。
- **现象**（用户报）："对于临时多声部，由于是垂直居中对齐，上下两两部空间上是等分提，因此可以以中线为分界，作为色块的上下分割线"——要求 dsb 上下色块**严格等高**。
- **根因**：上块延伸量 `TOP_EXT = 1.1×ns`（盖减时线）、下块延伸量 `BOT_EXT = 0.6×ns`（避歌词），天然差 `0.5×ns = 6.5 px`。原来的"沿 row.y 中线对半劈"把不对称性**体现在高度差**里——上下看起来不等。
- **解决**：把"对称中线" `midEqual` 从 `row.y` 上移 `(TOP_EXT − BOT_EXT)/2 = 0.25×ns = 3.25 px`，让上下块各自用原有延伸量后**高度相等**。不对称性被消化在**位置**（整组上移 3.25 px）而非**高度**里——视觉上"上盖减时线、下不压歌词"的设计意图保留，但上下看起来完全等高。
- **几何**（ns=13, dy=22）：yUpper=143.3, yLower=165.3, midEqual=151.05；upper 顶=129、底=151.05（高=22.05）；lower 顶=151.05、底=173.1（高=22.05）。
- **侵入风险核查**：整组上移 3.25 px。上一行曲部底 − quci=15 ≫ 3.25（实际约 40 px 余量），无侵入风险。
- **预防**：① **几何对称**应当体现在**位置**而非**高度**里——高度不对称必导致视觉失衡；② 改公式时同时检查"几何意图"是否保留（这里"上盖减时线、下不压歌词"两条都没破）；③ smoke 增加等高断言（V3b + V5）防止后续回归。
- **验证**：smoke V3b（默认 dsb 上下等高 < 0.1 px）+ V5（dy=60 上下仍等高且 ≥ 30 px）全绿；`tsc -b` 通过；smoke 失败项 18 == 基线。

### E-2026-166 试听色块用硬编码 28.6 px 高 → 多声部 Q1↔Q2 重叠 / dsb 上下层黏成一坨 / bz 段侵入上一行（用户报）（adj429）

- **场景**：v0.20 起临时叠加段（bz/dsb）和多声部块同时存在时，试听色块按 `[y − 1.6×字号, y + 0.6×字号]` 硬编码 28.6 px 高延伸，多块之间互相覆盖、且可能侵入相邻行。
- **现象**（用户报三类）：
  1. **多声部**：Q1 与 Q2 色块分别从各自基线向下/向上延伸 28.6 px，而两基线仅相差 `1.7×字号 + shengbu` ≈ 22 px ⇒ **重叠 ~3.6 px**（用户看到"两个色块黏在一起"）。
  2. **{dsb … }**：上下两层基线相差 `dy`（默认 22 px），每层延伸 28.6 px ⇒ **重叠 ~17.6 px**（两层色块几乎盖成一块，丧失"上下层"语义）。
  3. **{bz … }**：段层在主旋律上方 dy 距离，段层色块底 `yUpper + 7.8` 与主旋律色块顶 `yRow − 20.8` **重叠 ~6.6 px**；同时段层色块顶 `yUpper − 20.8` 可能侵入**上一行**曲部/减时线区。
- **根因**：色块高度由音符基线**对称**延伸，与相邻元素（中线、上一行基线、歌词行基线）**无关**。任何"两个垂直距离 < 2.2×字号"的相邻色块都会互相覆盖；用户调 `dy` 也救不了——只是把重叠推迟到更窄的 `dy` 才发生。
- **解决**：色块**按曲行几何动态定界**（adj429）——
  - `PlayheadSeg` 增加可选字段 `yTopMin` / `yBottomMax`（绝对 y，未设 = 用默认硬编码，单声部零回归）。
  - `buildPlaySequence` 在构造 `playheadSegs` 时根据 `PlacedToken` 身份调 `computeColorBounds`：
    - **多声部**：按 `voiceBlock.voiceCenters[vi]` 与相邻声部中线分块（Q1 底 = 中线 - 0.25、Q2 顶 = 中线 + 0.25，中间留 0.5 px 视觉细缝）。
    - **bz upper**：底 = `min(yUpper + 0.6×字号, 主旋律基线 − 1.6×字号)`（恰好贴住主旋律色块顶）。
    - **dsb upper**：顶 = `yUpper − 1.1×字号`、底 = `(yUpper + yLower)/2 − 0.25`（占上下层中线之上半部）。
    - **dsb lower**（即包络内主旋律，`placed.playVoice === 'second'`）：顶 = `(yUpper + yLower)/2 + 0.25`、底 = `yLower + 0.6×字号`。
    - **单声部**：不传 `yTopMin` / `yBottomMax`，渲染端走原 `[y−1.6×字号, y+0.6×字号]` 默认。
  - 任一块高度 < 4 px → 返回 null（不传 bounds → 渲染端**完全不画**，避免色块"瘦成一条线"反而干扰视觉）。
  - `playheadTrack` / `docStore.playheadTrack` 增加同名可选字段；`PlaybackDialog` 透传；`PreviewPane.playheadPosIn` 优先用 `a.yTopMin/a.yBottomMax`，未设才回退默认。
- **关键实现陷阱**（自检发现）：
  - **dsb 下层识别**不能用 `placed.segment?.layer === 'lower'`——`shiftEnvelopeDown` 只设 `placed.playVoice = 'second'`，**没**设 `placed.segment`！必须改用 `placed.playVoice === 'second'` 判下层，否则 V3 lower 的色块永远不出现 bounds。
  - **`parseJps` 必须只调一次**——`layoutScore(parseJps(src), cfg)` 与 `buildPlaySequence(parseJps(src), lay, ...)` 各调一次会拿到**两份不同的 MusicToken 对象**，段层 children 的对象身份对不上 `page.notes[i].token` → `segPlacedByToken.get(t) === undefined` → **段层事件根本不补发**。smoke V3 第一次跑遇到的就是这个问题（debug emit 看到 `placed=UNDEFINED` 才定位到）。
- **预防**：① **相邻色块的几何关系必须在数据层就约束**——渲染端拿到每个 `PlayheadSeg` 时只做"用 yTopMin / 用默认"二选一，不允许它自己在渲染时算"我的上面是谁"（那需要遍历整页，O(n²) 还会跨段不一致）；② **任何动态定界**必须配合**最小高度 + 隐藏**的下限（这里 4 px）；否则两个离得太近的块会缩成一条噪声线；③ **段层的"对侧"语义分两套**：bz 的对侧是主旋律基线（bz 不动主旋律），dsb 的对侧是另一个段层（dsb 包络上下移动）——别把这两套合并成一个公式；④ **新语法首次落地**就要把"几何参数清单"列一遍——色块高度、上下层间距、括号占宽等**都**是有可能需要用户调节的几何量，临时段这次缺了"色块按曲行几何"这条，是 v0.20 漏掉的。
- **验证**：smoke 新增 V1–V5 共 7 条断言（V1 单声部不带 bounds 零回归、V2 多声部 Q1↔Q2 不重叠、V3 dsb 上下层各带 bounds 且不重叠、V4 bz upper 不侵入主旋律色块顶、V5 dsb dy=60 上下色块均 ≥ 20 px）；`tsc -b` + `npm run build` 通过；`smoke` 失败项 18 == 基线；`preview:render` 7 谱 `errors=0`；**涉及引擎改动**（`playback/sequence.ts` / `playback/types.ts` / `types.ts` + `preview/PreviewPane.tsx` + `store/docStore.ts` + `dialogs/PlaybackDialog.tsx`）→ 已同步 obsidian-ijipu/vendor/engine。

### E-2026-165 临时叠加段（`{bz … }` / `{dsb … }`）上下层间距写死 `note_size × 1.7` → 用户无法按需调整行距（用户要求）（adj428）

- **场景**：adj427 实现临时段时，段层与主旋律基线的纵向偏移硬编码为 `dy = note_size × 1.7`（ns=13 ≈ 22.1 px），对 bz 是「段层到主旋律」的距离，对 dsb 是「上下两层各偏移 dy/2」的对称量。`spacing.ts` 里其它间距常量（`LAYER_GAP`、`barlinePad`、`BRACKET_PAD` 等）全部走集中管理，唯独这段层间距是 inline 的——违反了 `spacing.ts` 文件头"改间距只改本文件"的约定。
- **现象**（用户要求）："现在的临时伴奏、临时多声部两声部之间的是否可调？……可能需要增加一个临时多声部间距的变量"。bz 的"上面虚线"应控制伴奏声部与主旋律之间的间距，dsb 的"上面或下面的虚线"应控制上下两层之间的间距——目前都是硬编码，用户改不动。
- **根因**：① 设计漏项——adj427 阶段只把临时段"能出图、对齐、播放"做出来，没有给"行距"预留调节接口；② 实现细节未走 `spacing.ts`——`dy` 直接写在 `layout/index.ts` 里、没有常量符号，导致既不在文档里、也改不动。
- **解决**：① `spacing.ts` 新增 `SEGMENT_ROW_GAP_DEFAULT = { bz: 22, dsb: 22 }`（与原硬编码 ≈`note_size × 1.7` 一致 → 旧谱零回归）；② `PageConfig` 新增可选字段 `segmentRowGap?: { bz?: number; dsb?: number }`（L2 谱面级），同步登记到 `OPTIONAL_CONFIG_FIELDS` 保证写回不被过滤；③ `layout/index.ts` 的 `dy = ns * 1.7` 改为 `dy = config.segmentRowGap?.{bz,dsb} ?? SEGMENT_ROW_GAP_DEFAULT.{bz,dsb}`，**bz / dsb 分别独立**（用户要求"分高两个变量"）；④ 设置面板「谱面 → 临时段」加两个 NumInput（范围 10–80），写进 `# jps-config`；⑤ `uiCopy` 新增 4 条文案（group 标题 + 两个 label + hint），不散落到组件里。
- **预防**：① **凡"纵向距离 / 横向间距"类几何量都必须落在 `spacing.ts`**（adj60 集中管理），新加的几何常量若没进 spacing.ts、tsc 通过也得审查——spacing.ts 是项目硬约定；② 新语法第一次落地时要把"几何参数清单"列一遍，缺哪条就在同一 adj 内补完，避免"下一轮再补"留下硬编码死角；③ **dsb 上下两层居中**这个性质属于"行为不变性"（用户语义），未来调整该变量时**只能同步外扩 dy/2**，不能让中线偏离主旋律基线——smoke 的 Y4/Y6 同时断言「偏移量 == dy/2」与「两层中线 == yRow」就是为了挡住这一类回归。
- **验证**：smoke 新增 Y3/Y4/Y5/Y6 四条断言：默认间距 22 px（零回归）；dsb 上下各 11 px 且中线 == yRow；bz 调到 40 → 段层 y 移动 40、主旋律不动；dsb 调到 50 → 上下各 25、中线仍 == yRow。`tsc -b` + `npm run build` 通过；`smoke` 失败项 18 == 基线（Y3-Y6 全绿）；`preview:render` 7 谱 `errors=0`；**不涉及引擎改动 `obsidian-ijipu/vendor/engine` 不同步**。

### E-2026-164 「试听音色」的全局覆盖压掉了第二声部音色 → 重叠区两个声部听成同一音色（用户报）（adj427）

- **场景**：dsb/bz 重叠区按两个声部演奏（主声部 + 伴奏/第二声部），已按规格分别给了音色（大钢琴 / 手风琴）。
- **现象**（用户报）："两个声部的音色没有区分，都使用主声部的音色演奏的"。
- **根因**：`SpessaSynthBackend.play` 里 `const program = this.voiceOverride ?? instrumentToProgram(instrument)`——`voiceOverride` 是「试听音色」下拉选定的**全局覆盖**（`setVoice(program)`），一旦非空就把**每个事件自己的音色**都压掉，两个声部于是同音色。（引擎侧的序列本身是对的：smoke Z5/Z9 已断言两事件 instrument 分别为手风琴/大钢琴。）
- **解决**：给 `AudioBackend.play` 增加可选 `opts.keepInstrument`（**可选参数，向后兼容**），`schedulePlay` 对 `playVoice` 为 `'accomp'`/`'second'` 的事件置位；后端在该标志下**只用事件自己的音色**、不套全局覆盖。同时 `schedulePlay` 里 `globalInstrument` 也只作用于非次级声部。
- **预防**：① **"全局覆盖"类设置必须说清作用范围**——它只能覆盖"没自己指定音色"的那一类事件，否则会把有意的音色区分抹平；② 新增"多音色同响"能力时，要检查链路上每一层的音色解析（引擎序列 → 调度器 → 后端 → 合成器），**任一层做全局覆盖都会让前面所有区分白费**；③ 断言要同时覆盖**数据层**（事件的 instrument 不同：Z5/Z9）与**路由层**（program/channel 确实不同：Z20）——只测数据层会漏掉这种"数据对、播放端压平"的缺陷。

### E-2026-163 段层音符混进 adj320 的「下一个时值元素」计算 → 主旋律色块被拉长到**整个小节**（用户报）（adj427）

- **场景**：段层音符与主旋律做叠加对齐后，两者**x 坐标相同**；`buildPlaySequence` 里 adj320 的色块右边界计算遍历 `page.notes` 全部音符、按 x 排序取"下一个时值元素"。
- **现象**（用户截图）："下层演奏到小节第一个音符时色块是覆盖完整个小节，而不是只有其音符本身"。
- **根因**：段层音符与主旋律音符**同 x**，按 x 排序后互为"下一个元素"；而判定条件是 `sorted[i+1].x > n.x + 1e-3`，同 x 不满足 ⇒ `nextNote` 退化为 `Infinity` ⇒ 边界只剩"小节线左缘" ⇒ 该音符的色块一路铺到小节末尾。
- **解决**：adj320 的右边界计算**排除段层音符与段层小节线**（保持既有谱面的色块几何零变化）；段层音符的右边界在 `emitSegmentEvents` 里按「**同段内下一个段层音符**」单独计算（末音用其占位右缘）。
- **预防**：① 往 `page.notes` 追加**叠加层**音符时，必须审查所有"遍历 page.notes 推几何"的既有代码——它们普遍假设"同 group 内按 x 排序即源码顺序、相邻即前后元素"；② 这类"同坐标元素"缺陷不会报错、只会让几何悄悄错，**必须用"有叠加层 vs 无叠加层的结果应逐项一致"这种对照断言**挡住（本次 Z18），单看某一条数据是发现不了的；③ 叠加层元素要走**自己的**几何通道，不要复用主旋律的排序/邻接假设。

### E-2026-162 段层右括号的右缘正好落在**小节线中心** → 压在小节线上、左右净距不对称（用户报「右括号明显偏右」）（adj427）

- **场景**：bz 段层括号的横向定位。左括号位置 = `内容左缘 − nonDurGap − 括号宽`（相对内容），右括号位置 = `内容右缘 + nonDurGap`，而**内容右缘** = `包络右界 − (括号宽 + nonDurGap)`。
- **现象**（用户对照截图）：上一行的右括号**明显偏右**——实测它距右小节线只有 ~4px 甚至贴到线上，而左括号距左小节线还有净距；两者相对各自小节线不对称。
- **根因**：右侧的定位基准是**小节线位置**（`xEndBoundary = 小节线 x`），而左括号的定位基准是**内容**。于是右括号的**右缘**正好落在小节线**中心**上——没给「小节线自身半宽 + barlinePad」留净距，直接压到线上。（左侧因为是相对内容定位，天然落在距节线更远的位置，所以两侧看起来不对称。）
- **解决**：引入统一的 `barInset = barlineTotalW('|') / 2 + barlinePad(字号)`（括号到小节线**笔画外侧**的净距），两种段型一致处理：右侧把 `barInset` 计入 `tailPad`（内容右缘提前让出），并把右括号槽用「小节线内侧」**钳制**（`min(内容右缘+gap, 小节线x − barInset − 括号宽)`）；左侧用同一个 `innerL` 钳制。实测左右净距由「4.2 / 0（贴线）」变为 **4.2 / 3.7**，两侧对称。
- **预防**：① **一个元素的位置只能有一个基准**——左右对称的两个装饰若分别"相对内容"和"相对边框"定位，必然出现净距不等（本例差 ~26px）；② 凡是贴着"线"（小节线/边框）的元素，净距必须**显式包含线的半宽**，只留 padding 会压到线上；③ 断言要直接量**两侧各自到边界的净距并比较**（本次 U12/U13/U14），只断言"在边线内侧"（`x ≤ bar`）挡不住"贴线"这种观感问题——注意比较两侧距离时符号方向要统一为正距离（我第一版就写错符号导致误判）。

### E-2026-161 段边界"给音符加权"来腾地方 → 段内每拍占宽是其它小节的 **2.35 倍**（用户实测发现）（adj427）

- **场景**：dsb/bz 段层的大括号 + 圆括号需要横向空间，而它们只能落在「包络边界小节线内侧 ~ 内容边」之间。为腾地方，给**段边界所在小节的音符**加了分配权重（`SEG_BOUNDARY_WEIGHT = 3.5`）。
- **现象**（用户问「`3 4 |` 小节的一拍占宽与 `1 2 3 4 |` 小节的一拍占宽各是多少」）：
  - 空间优先（默认）：`3 4` 小节 **21.70 px/拍**，段内 **51.05 px/拍** → **2.35 倍**；
  - 时值优先（未加权）：43.60 / 40.60 → 1.07 倍（正常）。
  段内的拍明显被撑宽、相邻小节被挤窄，整行疏密不均。
- **根因**：行宽是被**撑满**的（总宽 = `availW` 固定），给部分音符加权 = 把富余从别的小节**抽走**给边界小节。于是「腾地方」的代价直接落在**拍宽分布**上——而拍宽分布是排版的基本观感，不该为装饰元素让路。
- **解决**：不再给音符加权，改为把这份空间记在**那两条边界小节线**上（左边界线的**右侧**、右边界线的**左侧**各留 `SEG_BOUNDARY_PAD = 0.8×字号`），**并计入 `nonDurPad`**。因为行宽撑满，`nonDurPad` 增加只会让富余 `W` **等比缩小** → 各拍占宽**同比例**减小 ⇒ **均匀性保持** ✓，而边界处确实多出这段间隙 ✓。实测两种布局每拍占宽 max/min ≤ 1.005，边界净空仍 ≥20px。
- **预防**：① **装饰性元素（括号/大括号/记号）的横向需求应记在"非时值占位"上，绝不要用"改拍宽分配"去腾地方**——前者只等比缩放，后者破坏疏密均匀；② 用户会量具体数字（"各是多少"），所以断言要直接量**同一小节内相邻音符间距**并断言 max/min（本次 Y1 四种组合 + Y2），而不是量"小节宽÷拍数"（后者把**小节线间距**也算进去，会掩盖真实差异，也让我第一轮差点误判）。

### E-2026-160 大括号轮廓边界曲线误用 `xTip ± e` → 整体偏向外侧、越出槽位压到圆括号（adj427）

- **场景**：把 dsb 大括号从"字体字形"改为"自绘填充轮廓"（`M 尖端 C 一侧 中缝尖角 C 同侧 下端尖端 C 另一侧 中缝尖角 C 另一侧 尖端 Z`）。
- **现象**：大括号形状偏向一侧、横向越出自己的占宽槽位，压到紧邻的圆括号上；观感也与期望不符（用户反馈"这个字体也不对"）。
- **根因**：两条边界曲线的控制点写成了 `xTip ± e`（**以尖端为基准**偏移），而正确基准是**中轴**：`xs ± e`（`xs = (xTip + xCusp) / 2`）。以尖端为基准会把两条曲线一起推到外侧（`xTip + e` 甚至落到槽位之外），既越界又失去左右对称。
- **解决**：控制点改为 `xs ± e`。此时两条曲线分别过中轴两侧 `e`，中段厚度 = `2e = t`，且在两端尖端与中间尖角处**都收拢为一点**——既保住粗细变化，又让轮廓**严格落在 `[槽左缘, 槽左缘+w]` 内**。
- **预防**：① 画对称形状时，**偏移基准取对称轴**（这里是中轴），不要取端点/尖端——端点基准会让"对称形状"整体平移；② 这类"形状越界"要用**几何断言**挡住：解析路径 `d` 的坐标、断言其 x 落在槽位内（本次 X6g），光看"存在路径"完全挡不住；③ 手绘轮廓的端点—控制点关系先在草图上定"哪条边过哪条基准线"，再写代码。

### E-2026-159 用 PowerShell `Get-Content`/`Set-Content` 改源码 → UTF-8 中文被重新编码、整文件报废（adj427）

- **场景**：想快速把 `layout/index.ts` 里的一个常量 `2.6` 改成 `5`，图省事用了
  `(Get-Content f) -replace '2.6','5' | Set-Content f`。
- **现象**：`npm run smoke` 里 vite 构建直接失败（`Build failed with 1 error`，errors 数组为空看不到细节）；`git diff --stat` 显示该文件 **1152 行变动**；`git diff` 里中文全变乱码：`* engine/layout/index.ts — 排版引擎` → `* engine/layout/index.ts �?排版引擎`；行数从 2800 掉到 2593（多字节被破坏后换行解析也乱了）。
- **根因**：`Set-Content` 不带 `-Encoding` 时用**宿主默认编码**写回，**不是 UTF-8**；中文源码因此被重新编码，多字节序列被破坏。本项目源码是 UTF-8（含大量中文注释），一旦被重新编码即整文件报废。
- **解决**：`git checkout --` 回滚该文件，改用**文件编辑工具**（保留 UTF-8 与行尾）重新施加改动。教训：**改源码一律用专用编辑工具，不用 shell 文本重写**；批量替换也不要用 `Get-Content | Set-Content`。
- **预防**：① 改源码只用带编码保证的编辑工具，**不要**用 `Set-Content`/`Out-File`/`>` 重定向写源码；② 若必须用 shell 改，先 `git diff --stat` 看改动规模——**远超预期的行数就是"整个文件被重新编码"的信号**；③ 破坏后**不要**在坏文件上继续编辑（会连锁污染），直接 `git checkout -- <file>` 回滚再重做；④ 回滚前先确认该文件之外还有哪些未提交改动（`git status`），避免误丢工作。

### E-2026-158 大括号按 `x ± bulge` 外扩绘制 → 画到小节线**外面**（用户报）（adj427）

- **场景**：dsb 临时多声部的跨两层大花括号。
- **现象**（用户对照目标效果图）：左大括号跑到起始小节线**左侧**、右大括号跑到结束小节线**右侧**——两条大括号都被画到小节线外面去了；且括号与小节线、括号与圆括号挤在一起。
- **根因**：① 绘制端把 `x1/x2` 当作"区间端点"再向外 `± bulge` 扩了 4~9px，而 `x1/x2` 本身已经是包络边界（小节线位置），一扩就越线；② 大括号此前**没有自己的占宽槽位**——它只是"画在边界上"，既没参与布局，也没和圆括号协调位置。
- **解决**（adj427）：把大括号当**无时值占宽元素**（同 `&zkh/&ykh`）处理——在布局层给它一个**槽位**：左槽排在「起始小节线内侧 → 内容左缘」之间、右槽排在「内容右缘 → 结束小节线内侧」之间，与圆括号一起用 `placeSlots` 均分间距（间距上限 `nonDurGap`，放不下则压缩且绝不重叠）；绘制端**只在给定槽位内画**，不再外扩；线宽加粗（`max(1.8, 0.16×字号)`）与细线条的小节线形成层次。另加**段边界小节加权**（`extraOf` 的 `segWeight`）给小节线到音符的净空加权（空间优先路径 14px → 24.3px），让"大括号 + 圆括号"真正排得下。
- **预防**：① **凡是"依附于某个边界的装饰"，先问它有没有自己的占宽槽位**——没有槽位就只能挤在别人身上、或画到界外；② 绘制端不做"以锚点为中心外扩"这类几何猜测（E-2026-157 的 `y ± bulge`、本条的 `x ± bulge` 是同一类错误），**位置一律由布局层给出**；③ 布局/渲染的横向占宽公式要**同源**（本次 `braceW = max(3, 0.32×字号)` 在两侧写成同一公式并互相注释），否则一处改了另一处就漂；④ 断言要覆盖"在边界**内侧**"这种带方向的不等式（本次 X1/X2/X10），只断言"存在/不重叠"不足以挡住越界。

### E-2026-157 段层括号纵向基准传错 → 括号比数字**高 0.3×字号**；且本体宽紧贴音符、无间距（adj427）

- **场景**：临时段 `{bz &zkh … &ykh}` 的左右括号画在段内容层上。
- **现象**（用户对照番茄简谱的效果图）：括号比数字**明显偏高**（≈4px），且与相邻音符**紧贴无间距**（渲染成 `(1`），而目标是 `( 1`。
- **根因**（两处独立偏差）：
  1. **纵向**：`renderBracket` 把 `yTop` 当**字形中心**（`dominant-baseline="central"`），而正常曲行的调用方传的是 `行顶 + 0.7×字号`，配合「音符基线 = 行顶 + 1.1×字号」正好得到 **字形中心 = 基线 − 0.4×字号 = 数字中心**（`DIGIT_HEIGHT_RATIO = 0.8` 的一半）。我给段层传的是 `基线 − 0.7×字号`，直接**高了 0.3×字号**。
  2. **横向**：段层只预留了括号**本体宽**（`markBodyW` = `BRACKET_PAD` = 5px），没有预留与音符之间的间距；而非时值元素的标准间距是 `nonDurGap = 0.5×字号`。于是括号本体右缘直接贴在音符左缘。
- **解决**（adj427）：① 纵向改传 `基线 − 0.4×字号`（并写成注释说明「字形中心 = 数字中心」这条基准）；② 横向预留区改为 `本体宽 + nonDurGap`，括号整体外移一个间距；③ **统一渲染路径**——段层圆括号不再手绘弧线，改为发 `page.brackets`（`zkh`/`ykh`）走全项目同一套 `renderBracket`，`renderSegmentBracket` 只保留 dsb 的跨两层花括号。这样"括号长什么样、落在哪个基准上"全项目只有**一处定义**。
- **预防**：① 画任何依附于音符的符号前，先确认**该项目对该符号的纵向基准约定**（本项目：`yTop` = 字形中心 = 数字中心 = 基线 − 0.4×字号；`digitTopY` = 基线 − 0.8×字号）；② 新增一类元素时**优先复用既有渲染函数**而不是手绘——手绘弧线既拿不到正确基准，也拿不到与其它元素一致的间距；③ 断言要锚在**基准表达式**上（本次 U9：`yTop === 段层音符 y − 0.4×字号`）而不是"看起来居中"；④ 间距断言锚在常量上（U10/U11：`间距 === nonDurGap`），这样常量调整时断言自动跟随。

### E-2026-156 「拍位 → x」只锚定音符，小节线拍位被映射到**小节线之后的音符** → 段内小节线/右括号右偏一个小节线占宽（adj427）

- **场景**：临时伴奏 `{bz … }` 的段内容与段内小节线要映射到主旋律的横向坐标上（用户要求「中间的小节线要对齐」「右大括号要在最后一节前面的小节线前」）。
- **现象**（用户实测截图 + 几何实测）：段内 `|` 落在 315.3，而主旋律 `|` 在 299.6——**右偏 15.7px**；包络右缘（右括号 / `&ykh`）落在 477.7，而它该对齐的主旋律小节线在 462.1——**越线 15.6px**。
- **根因**：`beatToX(beat)` 的锚点**只有音符**（`startBeat → note.x`）。于是一个「小节线所在的拍位」按分段插值落到的是**小节线之后那个音符**的 x。而小节线自身有占宽（线宽 + 两侧间距 ≈ 15.6px），两者天然差一个小节线占宽。用户写 `{bz &zkh 1 2 3 4 | … &ykh }` 时，段内 `|` 与右括号都吃到这个偏差。
- **解决**（adj427）：新增**小节线锚点**——用「该小节线右侧第一个音符的起拍」反推每条主旋律小节线的拍位，得到 `(beat → barline.x)`；再分两套映射各司其职：`beatToX`（音符锚点）用于**段内音符起点**（与主旋律同拍位音符精确对齐）、`beatToXBar`（小节线锚点）用于**段内小节线与包络右缘**（与主旋律小节线精确对齐）。同时：包络右缘 = 主旋律小节线 x 再左让尾括号预留宽；自动圆括号也预留占宽（`markBodyW('zkh')`），段内 `&zkh/&ykh` 的占宽计入行宽预算（沿用既有 `&zkh/&ykh` 的「从行宽扣」A 方案）。
- **预防**：① **一个拍位可能对应多个几何锚点**（音符起点、小节线、跳房子线），映射函数必须**按用途选锚点**，不能"一套插值打天下"；② 断言不要只断言"段内音符对齐主旋律音符"，还要断言**段内小节线对齐主旋律小节线**、**包络右缘不越小节线**（本次 U1/U2/U6）——前者全绿也掩盖不了后者偏差 15px；③ 这类"某个占宽元素夹在两个时间点之间"的坑，判据是：**两个锚点之间的实测距离是否等于两者的占宽之和**（本次 15.7px 恰是小节线占宽，一眼可辨）。

### E-2026-155 段内 token 的位置没随切片偏移 → 错误列号偏小 + 光标↔谱面联动错位（adj427）

- **场景**：实现临时段 `{bz … }` / `{dsb … }` 时，段内内容是把 `{` `}` 之间的子串**切片后递归调用** `tokenizeMusicLine`。
- **现象**：①段内报错时定位到的列号**偏小**（指向行首方向）；②段内音符与编辑器光标**对不上**——在编辑器里点某音，预览高亮的是另一个位置（或反之）。
- **根因**：递归调用传的是**整行的 `pos`**，而段内 token 的 `pos` 是**相对切片起点**的偏移。于是 `t.pos` 比真实列号小了 `segStart`（`{bz ` 的长度）。`cursorMap.ts` 正是用 `t.pos + headLen` 反查光标列（`codePosToNoteId` / `noteIdToCodePos`），偏移量直接变成"点错音"。
- **解决**（adj427）：两处一起修——①递归调用时把位置基准的列加上 `segStart`（`{ line, col: pos.col + segStart }`），段内报错的列号**绝对化**；②新增 `shiftTokenPos(tokens, offset)` 把段内 token 的 `pos` 统一右移 `segStart` 后再挂到段头 token 的 `children`。
- **验证**：smoke 新增 B1/B2 断言（`{bz 1 2 3}` 的 children[0].pos === 4、children[1].pos === 6，即 `{bz ` 之后）；C1/C2 断言引号内的 `}` 不结束段（顺带修的另一处，见下）。

### E-2026-154 拍位边界映射到「前一个音符的右缘」→ 临时段整体左移、与主旋律同拍位音符对不齐（adj427）

- **场景**：实现临时段叠加层时，要把「拍位 b」换算成 x 坐标（段内容按拍位映射到包络内、与主旋律同一拍位垂直对齐）。第一版用**音符本体宽**做线性插值：`x = note.x + t × note.width`。
- **现象**：段内容整体**左偏**，段首音与主旋律同拍位的音符差约 **13px（≈ 一个 `note_size`）**。
- **根因**：两处偏差叠加——①空间优先布局下相邻音符之间有**槽间留白**，`width` 只是**本体宽**，用它在拍位边界处插值得到的是前一个音符的**本体右缘**，而不是下一个音符的左缘；②改看 `rightX`（占位右端）后仍差一整个间距，因为 `4` 与 `5` 之间**夹着小节线**（占宽），前一个音符的槽右端落在**小节线左侧**。
- **解决**（adj427）：`beatToX` 改为**按音符起点锚点做分段线性插值**——相邻两个音符以 `(startBeat_k → x_k)`、`(startBeat_{k+1} → x_{k+1})` 两个锚点连线，任一**被锚定的拍位（音符起点）精确映射到该音符的 `x`**，音符内部拍位线性过渡；末音之后按自身时值延伸到 `rightX`。这样「上下两层同一拍位垂直对齐」精确成立，且自然跨过小节线占宽。
- **预防**：**"拍位 → x"这类换算不要用"元素宽"自己凑**——元素之间可能夹着**其它占宽元素**（小节线、独立括号、留白）。凡是"两个时间点之间的空间映射"，必须建立在**锚点（元素起点）**上做分段插值，锚点之外的部分再线性过渡；写断言时不要只断言"宽度合理"，要断言**同拍位的两个元素 x 相等**（本次 O4）。

### E-2026-153 文档表格里写 `\|` 转义，渲染器却按裸 `|` 切分 → 「小节线与反复」表被切成三列错位（adj423）
- **场景**：新建的《脚本语法说明》里，「2.8 小节线与反复」这一节要列出 `|`、`||`、`|:`、`:|`、`|/`、`|*` 这些写法，于是表格单元格里写了转义竖线：`` | `\|` | 单小节线 | ``。
- **现象**：应用内打开该文档，这张表**列错位**——第一列只显示一个反斜杠、后面的内容跑到别的格子里（用户报"又出现之前出现过的表格问题"）。
- **根因**：`DocDialog` 的表格解析用 `s.split('|')` **无条件按竖线切分**，而 Markdown 里 `\|` 是**转义后的竖线**（应当属于单元格内容）。于是 `` `\|` `` 被切成两半，整行列数与表头不一致；`\|/`、`\|\|` 等同理。上一轮刚补的表格渲染（E-2026-152）只覆盖了简单表，语法表这种"内容里就有竖线"的场景没测到。
- **解决**（adj423）：单元格切分改为 `split(/(?<!\\)\|/)`（只在**未转义**的竖线处切），切完再把 `\|` 还原成 `|`；同时给 smoke 增加**文档表格列数一致性**断言——把 `docs/SYNTAX.md` / `docs/USER-GUIDE.md` 里的每张表逐行切格，要求每行列数与表头一致（本次 15 + 4 张表全绿）。
- **验证**：无头 Chrome 打开「帮助 → 脚本语法说明」实测该表 **8 行全部 2 列**、首格文本就是 `|`，且 `||`、`|:` 等写法完整保留；截图目视。
- **预防**：① **文档渲染器与文档写法是一对**——凡文档里出现"转义字符"（`\|`、`\*`、`\_`），渲染器必须支持同样的转义规则，否则内容会被错误切分/吞掉；② 补渲染能力时要用**真实文档里最刁钻的那张表**验收（含竖线、含反引号、含长文本），别只用简单表试；③ 把"文档结构不变量"写成断言（本次是表格列数一致），这类问题就能在提交前被抓到，而不是等用户翻到那一页。

### E-2026-152 帮助文档的 Markdown 渲染器不支持表格与引用块 → 表格变一串竖线、`>` 直接透出（adj422）
- **场景**：用户要求把「脚本语法」与「脚本规则说明」合并成一份《脚本语法说明》，并把操作手册梳理成"新手能照抄、老手能查"的说明书——文档里因此大量用到**表格**（语法速查）与**引用块**（开头"怎么读这份文档"）。
- **现象**：应用内打开「帮助 → 脚本语法说明」，表格行显示成一堆竖线的等宽文本、引用块每行都以 `>` 开头直接把标记透出来——当参考书查基本没法用。
- **根因**：`DocDialog` 的极简 Markdown 渲染器（adj353 只补了行内语法与多级列表）**从来没有实现表格与引用块**：`|` 行被降级成 `<p class="doc-table">` 等宽段落，`>` 行按普通段落处理，而 `esc()` 又把 `>` 转义成 `&gt;`，于是字面透出。旧文档（USER-GUIDE / SYNTAX）里几乎没有表格，这个缺口一直没暴露。
- **解决**（adj422）：`mdToHtml` 增加 **表格**（连续 `|` 行合成 `<table class="doc-md-table">`，紧随表头的 `|---|` 分隔行进 `<thead>`）与**引用块**（连续 `> ` 行合成 `<blockquote>`，每行一个 `<p>`），并补 CSS（表头底色、单元格边框、首列等宽；引用块左侧强调色竖条）。
- **验证**：无头 Chrome 打开帮助对话框实测——`<table>` 15 个、`<blockquote>` 7 个、`<pre>` 16 个，截图目视表格与代码块；`smoke [104]` 顺带校验文档里 14 段示例仍然**零错误零告警**。
- **预防**：① **文档渲染器支持的语法必须与文档实际写法对齐**——用表格/引用块/脚注前先确认渲染端认识它们（本项目是自研极简渲染器，不是完整 Markdown）；② 文档大改后要**打开渲染结果**确认（用无头 Chrome 量 DOM 或截图），不能只读源文件——`>` 与 `|` 透出这类问题只在渲染后可见；③ 缺的能力优先补渲染器（一次性投入），不要为了绕开它把文档写成难读的形式。

### E-2026-151 输入条倚音键把「用法示例」当成了插入内容（点一下就写进谱子）+ 虚音符键多余（adj420）
- **场景**：用户反馈输入条「括倚」组里的 `1[65]` / `1[h65]`——「提示可以这样用，但输出还是应该输出 `[]` 和 `[h]`，然后光标放在 `]` 前」，另外 `(1)` 虚音符不必占菜单位。
- **现象 / 根因**：`padLayout.ts` 的 `BRACE_KEYS` 里 `label` 写的是骨架（`[]`/`[h]`），`insert` 却是完整示例 `1[65]`/`1[h65]`（注释还写着"label 用骨架、insert 仍插入完整语法"）；而 `PadMenuPopover` **左侧展示的就是 `insert`**（`.pad-menu-insert`，右侧才是 hint）——于是用户看到的"用法提示"其实是要写进正文的文本：点一下就把示例数字 `1`、`65` 也变成真音符，语义完全变了（倚音挂在错误的音符上）。顺带发现 `cursorOffset` 机制早就存在（`Q1"":` 用它把光标停在引号内），只是这两个键没用。
- **解决**（adj420）：① `insert` 改为骨架 `[]` / `[h]`，并用 `cursorOffset`（1 / 2）把光标停在 `]` **之前**，接着输倚音数字即可；用法示例改写到 `hint`（"写在主音符后，如 `1[65]`"）；② 移除 `(1)` 虚音符键——低频装饰写法，需要时在源码里手写（**语法本身不变**，引擎/文档照旧支持）；③ 操作手册补一句「菜单项左侧显示的是**实际会插入的文本**，右侧是用法说明」。
- **验证**：`npm run smoke` 新增 12 条 adj420 断言（骨架 insert / cursorOffset / 提示仍含 `1[65]`·`1[h65]` / 无虚音符键 + 模拟插入后光标落在括号内、继续输 `65` 得到 `1[65]`），失败项 **17 == 基线**；无头 Chrome 真机实测 12 项全绿（打开输入条 → 点「括倚」→ 读二级菜单文本 → 点 `[]` 后正文与光标 → 继续输 `65` → 点 `[h]` 光标停在 `]` 前），并截图目视菜单与编辑区。
- **预防**：① **"会插入什么"和"怎么用"是两件事**——菜单/按钮的预览位必须显示真正写入的文本，用法示例只能放提示里（否则示例数字会进谱子）；② 需要"插骨架 + 光标停中间"时优先用既有的 `cursorOffset`，不要"插完整示例再让用户删"；③ 输入条是**高频输入入口**，低频且易误用的写法不必都放进菜单（本次去掉虚音符键）——菜单不是语法全集。

### E-2026-150 快捷键速查与实现不一致（写大写/漏 Y·S/多出无效 H）+ 新断言把 `ParseError` 的字段写错（adj419）
- **场景**：用户反馈「快捷键速查里的 Q/C、B/Z 等实际响应的是小写字母，速查写成大写容易误导；另外新增的 `Y:` `S:` 描述头没包含进来」。
- **现象 / 根因**（三处不一致，都在"文档写着 A、实现做着 B"这一类）：
  1. **大小写写法误导**：`EditorPane` 用 `isLineHeaderKey(key.toUpperCase())` 判断 → **大小写都认**，插入的又永远是大写命令头（按 `q` 得 `Q: `）；而速查写成 `Q / C`、`B / Z / D / P / J`，用户按小写试出来能用，就以为速查写错了（反过来也让人以为必须按 Shift）。
  2. **漏了两个描述头**：解析器 `HEADER_KEYS` 与输入条「描述头」组都支持 `Y:`（默认乐器）与 `S:`（说明文字），但 `.jps` 行首命令集合 `LINE_HEADER_KEYS` 里没有 → 行首按 `y`/`s` **没有任何反应**，速查里也自然没有。
  3. **多了一个无效键**：`LINE_HEADER_KEYS` 里还留着 `H`，而解析器根本不认 `H:` → 行首按 `h` 会插出一行随即被报语法错误的内容（历史遗留，M2 阶段写下后没人再核对）。
- **解决**（adj419）：行首命令按**小写**书写；命令集合改为与解析器对齐的 `Q/C/B/Z/D/P/J/V/Y/S`（补 `Y`/`S`、去掉 `H`）；速查拆成 `q / c`、`b / z`、`d / p / j`、`y / s`、`v` 五行并加一句说明「光标在行首触发、大小写均可、插入的永远是大写命令头」；操作手册同步（§八 与小节三）。
- **附带踩坑**（同一批新写的 smoke 断言）：新加的「文档示例零错误零告警」检查里用 `e.pos.line` 取行号，但 `ParseError` 的实际字段是 `{ line, col, message, severity, hint? }`（**没有 `pos`**）——于是 `w.pos.line` 在"有告警"的那条分支上抛 `TypeError: Cannot read properties of undefined`，**整个 smoke 崩掉**。（首版没暴露是因为错误列表为空、`map` 根本没执行——空的集合掩盖了字段写错。）
- **验证**：`npm run smoke` 失败项回到 **17 == 基线**；新增 `[104]` 会**把文档里的示例整段抠出来解析**（`docs/SYNTAX.md` 7 段、`docs/JPS-SPEC.md` 3 段、`public/doc/jps-spec.html` 8 段），既保证示例能跑、也逼文档跟实现同步——本次正是靠它抓出示例里用了旧的 `@弦乐`（会告警）并改成推荐的 `@弦乐@`。无头 Chrome 实测 29 项全绿（谱面分组顺序、速查文案、关于对话框已移出四段、操作手册已收入、脚本语法含 7 段示例）。
- **预防**：① **凡是"用户按键 → 行为"的说明，都要以实现的判定条件为准**（本次是 `toUpperCase()`），并把"大小写是否敏感"这类细节写进说明，别只列字母；② **同一语义的键集合只应有一处**——行首命令集合与解析器 `HEADER_KEYS` 必须成对维护，加描述头时两处一起改（已在 `shortcuts.ts` 注释里写明这条约定）；③ **断言里读对象字段前先看类型定义**，尤其"只在失败分支才执行"的格式化代码——空集合会让它一直不被执行，直到某天真的失败时才发现它本身是坏的；④ 给用户看的示例/文档应当**可自动校验**（本次把示例抽出来跑解析），文档才不会腐烂。

### E-2026-148 页面设置弹窗宽度由内容撑开 → 切页签时弹窗宽度跳动、页签与面板对不齐（adj418）
- **场景**：用户反馈「设置里各页签的宽度应能适应对话框宽度、页签内容应适应页签宽度（不溢出、不余不必要的空白），底部『恢复默认』等三个按钮不用滚动就要可见」。
- **现象 / 根因**（用无头 Chrome 量真实几何后定位到三条）：
  1. **弹窗宽度由内容撑开**：`<Modal>` 没传 `width`，`.modal` 只有 `min-width:420 / max-width:700`，实际宽度取内容的 max-content → **各页签内容宽度不同，切页签时整个弹窗宽度会跳**（桌面实测：音色库页签时 700px、主题页签时只有 420px）。页签是 `flex:1 1 0`，于是跟着一起缩放，看起来"时宽时窄、右侧一大块空白或内容贴边"。
  2. **底部按钮落在滚动区内**：桌面端 `.modal` 是 `overflow:auto`，而 `.modal-foot` 是作为 children 放在 `.modal-body` 里的 → 内容一长，三个按钮就滚出可视区（手机上的 bottom-sheet 布局本来有"head/foot 固定 + 中段滚动"，桌面端没有）。
  3. **音色库列表 300px 高**：面板整体偏高，进一步把按钮顶出可视区。
- **解决**（adj418）：
  1. `<Modal fill width="min(700px, 100%)">`——宽度固定为「桌面 700px 上限 / 窄屏铺满」，不再随页签跳动；
  2. `Modal` 新增 `fill` 属性（`.modal.fill` = 纵向 flex + 中段滚动），页面设置把「页签 + 面板」放进唯一滚动区 `.pcfg-scroll`，`.pcfg-foot` 留在滚动区之外 → **三个按钮恒定可见**；
  3. 页签改等分宽度（`flex:1 1 0` + 居中 + 文本省略号），音色库列表 300 → 212px（一屏约 10 条），`.soundbank-panel` 由 2/3 宽改为铺满页签，间距设置改两列网格（桌面与手机都双列）。
- **验证**：无头 Chrome 在 **1400×900 与 390×844** 两种视口各实测一遍（共 22 项）：页签一行且等分（桌面 5×128px / 手机 5×68px）、无横向溢出、弹窗本体不滚动（`scrollHeight == clientHeight`）、底部三按钮完全可见、五个页签面板均不横向溢出、音色库列表 10 行、间距双列；两种视口截图目视确认。
- **预防**：① **弹窗宽度不要靠内容撑**——内容随页签/状态变化时宽度就会跟着跳，要么写死、要么用 `min(上限, 100%)`，别指望 `max-width` 兜底；② **"固定底栏"必须让底栏位于滚动容器之外**，把按钮塞进滚动区再想用 CSS 固定是缘木求鱼；③ 列表类设置项要有**明确的"一屏几条"**，否则面板高度会把底部操作顶出可视区；④ UI 调整后用无头 Chrome **量真实几何**（`scrollHeight/clientHeight/scrollWidth/getBoundingClientRect`），不要只看截图下结论。

### E-2026-149 断言里写死绝对坐标 → 改默认边距（40→50）就要重钉一堆断言（adj418）
- **场景**：用户要求「页面设置里的左右边距默认调整为 50px」，改 `defaultPageConfig.margin_left/right`。
- **现象**：`npm run smoke` 失败项由基线 **17 涨到 30**——多出来的 13 条全是布局几何断言（adj198/adj199/adj211/adj297 等），报出的实测值与期望值差 4~10px。
- **根因**：这些断言把**绝对 x 坐标**（如 152.1 / 203.7 / 115.2 / 195.1）直接写进断言，而它们的基准是「左右边距 40」时的实测值。更要紧的是两类值偏移量**并不一致**：自然宽行的 x 是纯平移（+10 = 边距增量），而"按前面曲部行对齐"的行宽取决于可用宽（右边界 − 左边距），边距变宽 → 可用宽变窄 → 每拍宽变窄，偏移只有 +4.5~+7.3。
- **解决**：① 纯平移类的期望值改成 `旧值 + ML_SHIFT`（新常量 `ML_SHIFT = ML - 40`，默认边距再改只动这一处）；② 依赖可用宽的两处按调整后的实测重钉，并在注释里写明"为什么不是 ML_SHIFT"；③ `adj297 自然宽不撑满` 原本写死「离右边界 100px」的阈值（换边距后仅差 2.7px 就误报），改为**相对比较** `maxRight5n < maxRight5 - 50`（自然宽 vs 撑满）。最终失败项回到 **17 == 基线**。
- **预防**：① 布局断言优先写成**由 `defaultPageConfig` 派生的量**或**两条布局产出之间的相对比较**，不要抄实测绝对坐标；② 一旦确实要钉绝对坐标，就把它的**依赖来源**（哪个默认值、哪个基准）写进断言旁的注释，并把"改默认值时的整体偏移量"抽成常量；③ **改任何默认排版数值后必须全量跑 smoke 并按基线核对失败数**——本次正是靠"30 ≠ 17"才发现断言里藏着一批硬编码坐标。

### E-2026-147 用 PowerShell 文本 cmdlet 改 UTF-8 中文文件 → 中文全变乱码 + 末尾多出 BOM（adj417）
- **场景**：把 `public/manifest.webmanifest` 里的图标路径批量换成 `/icons/…`，图省事写了一句 `(Get-Content -Raw) -replace … | Set-Content -Encoding utf8`。
- **现象**：文件里的中文（应用名/描述）全变成 `鐖辫璋?iJipu` 一类乱码，且文件头多了 **BOM**（`EF BB BF`）——manifest 是 JSON，带 BOM + 乱码等于直接解析失败；`git diff` 里那 7 行"改动"混着乱码，一眼可见。
- **根因**：Windows PowerShell 5.1 的 `Get-Content` 默认按 **ANSI（本机 GBK）** 解码 UTF-8 文件——读进来就已经是乱码；`Set-Content -Encoding utf8` 又写成**带 BOM 的 UTF-8**。两步叠加 = 内容与编码同时损坏（本仓库文件一律 UTF-8 无 BOM，且中文注释/文案极多，正中要害）。
- **解决**：用 `write` 工具按原文重写该文件（内容取损坏前版本），恢复 UTF-8 无 BOM；其余改动（`index.html` / `public/sw.js` / `brand/copy.ts` / 组件）全部改用 edit/write 工具完成。
- **预防**：① **改文本一律用 edit/write 工具，不要用 shell 文本 cmdlet**（预防清单里早有这条，本次属于"图省事"重犯）；② 确需在 shell 里读文件时用 `[System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)` 显式指定编码，并且**不要**用 5.1 的 `Set-Content -Encoding utf8`（会写 BOM）；③ 改完立刻 `git diff` 扫一眼——乱码与 BOM 都会在 diff 里现形，本次正是靠 diff 发现的；④ 含中文的配置文件（manifest/JSON）改完顺手 `JSON.parse` 验一遍。

### E-2026-146 桌面「内置音源」既没进安装包、查找路径也对不上、还走 JSON IPC → 试听每次都退回国内不可达的远端下载（adj346 → adj416）
- **场景**：用户要求「PC 端发布程序应带上 `generaluser_gs.sf2`，安装目录存在该文件时直接使用、不要提示下载」。
- **现象 / 根因**（四处独立缺陷，任一处都足以让"内置音源"名存实亡）：
  1. **安装包里根本没有这个文件**：`bundle.resources` 只有 `WebView2Loader.dll`；30MB 的 SF2 仅由 `scripts/prepare-tauri-soundfont.mjs` 复制到**安装包旁边**（`bundle/nsis/soundfonts/`）与 `target/release/soundfonts/` 当"独立附件"，而 NSIS 只安装 exe + resources → 用户装完 `<安装目录>` 里没有 SF2。（CHANGELOG 与注释里写的"桌面端内置随应用提供"**从未真正成立**。）
  2. **就算手动放了文件也读不到**：Rust `sf_soundfont_resource_read` 只找 `resource_dir()/soundfonts/<id>.sf2` **子目录**，而发布约定与用户预期都是**安装目录下的 `generaluser_gs.sf2`**——两边命名不一致，文件在也命中不到。
  3. **命中也会极慢**：该命令返回 `Vec<u8>`，Tauri 会把它按 **JSON 数组**序列化（30MB → 上亿字符的文本），前端再 `new Uint8Array(...)` 还原——每次试听都要这样传一遍。
  4. **UI 无从预判**："有没有内置音源"只能"读了才知道"，于是打开试听/音色库**必然先**弹出「⏳ 正在后台下载音色库（约30MB，仅首次）」，桌面用户看到的就是"它在联网下载"。
- **解决**（adj416）：
  1. **随包内置**：`src-tauri/tauri.conf.json` 的 `bundle.resources` 增 `{ "../resources/soundfonts/generaluser_gs.sf2": "generaluser_gs.sf2" }` → 安装后 `<安装目录>\generaluser_gs.sf2` 存在；`prepare-tauri-soundfont.mjs` 改为只服务**不经过安装包**的目录（`target/release`、`target/debug`，便携版与 `tauri dev`），删掉已无意义的 `bundle/nsis/soundfonts/` 附件。
  2. **查找路径统一**：Rust 抽出 `builtin_soundfont_candidates()`，按「**安装目录根 `<id>.sf2`** → `soundfonts/<id>.sf2`（兼容旧便携布局）」顺序查找；新增 `sf_soundfont_builtin_path` 只做**存在性探测**（前端据此在下载前判定）。
  3. **少走 JSON**：`sf_soundfont_resource_read` 改返回 `tauri::ipc::Response::new(bytes)`（raw body → 前端直接得 `ArrayBuffer`）。
  4. **前端来源收敛为一处**：`spessaCache.resolveHqBank` = IndexedDB 缓存 → 安装目录内置 → 远端下载，**只有下载结果才写缓存**（内置文件已在安装目录，不再复制 30MB 进 IndexedDB）；试听 / 音色库面板 / 导出音频三处统一改用它，"音色数据导出"也不再因为没有缓存而报「未缓存」。
  5. **自检兜底**：`npm run check:installer` 增 `generaluser_gs.sf2` 必需项 + 打包源体积校验；smoke 增 `[101]`（resources 映射、源文件真伪 `RIFF…sfbk`、Rust 候选顺序与 raw body、脚本一致性）。
- **预防**：① **"打包会带上"必须由打包产物证明**——写了 `bundle.resources` ≠ 装到目标目录，用 `check:installer` 这类**读安装清单**的自检兜底（同 E-2026-134 的教训）；② **跨语言（Rust ↔ TS）共用一个路径/协议约定时，两边都要有断言**，前端只认"有/没有"，不要在前端再猜目录；③ **大二进制不要走 JSON IPC**——Tauri v2 用 `tauri::ipc::Response` 传 raw body；④ **"是否内置"要能便宜地问出来**（独立的存在性探测命令），否则 UI 只能先假定"要下载"；⑤ 文档/注释里出现的"已经内置/已经带上"结论，都要能指向一条**可执行的自检**，否则就是空头承诺。

### E-2026-145 PDF 流数据前多出一个换行 → `/Length` 少 1 字节、内嵌 JPEG 丢掉 EOI（adj411）
- **场景**：把「导出 PDF」从"开新窗口 + `window.print()`（会被弹窗拦截）"改为**直接生成 .pdf 并下载**，自己拼 PDF 字节流、把每页栅格化的 JPEG 以 `/DCTDecode` 内嵌。
- **现象**：写完后**结构断言全绿**（`%PDF-` 魔数、`/Count`、xref 偏移精确指向 `N 0 obj`、`/Length` 与传入 JPEG 长度一致……），但把内嵌流抓出来一看：首字节是 `0x0A`（换行）而不是 `0xFF`，末两字节是 `0x03FF` 而不是 JPEG 的 `0xFFD9` —— **流被整体错位 1 字节，且声明长度比实际数据少 1，JPEG 的 EOI 被截断**。
- **根因**：写流对象的辅助函数 `beginObj(num, body)` 习惯性地在正文后补了一个 `\n`（对普通对象没问题），而**流对象的正文结尾是 `stream` 关键字，其后必须紧接字节流**——于是多出的那个 `\n` 跑到了流数据里面。同时 `/Length` 是按原始 JPEG 字节数声明的，于是"声明的长度"与"实际的流数据"错开 1 字节。（当时 smoke 断言只查"文件里含 `FFD8`"，而 SOI 确实在数据里、只是被挤到第 2 字节，**断言抓不到这个错位**。）
- **解决**（adj411）：拆出 `beginStreamObj()`（写入的头部以 `stream\n` 结尾、**不再补换行**）与 `endStreamObj()`；普通对象仍用 `beginObj()`。并把断言从"包含 FFD8"升级为**精确位置断言**：① 流数据首两字节必须紧接在 `stream\n` 之后且等于 `FFD8`；② `/Length` 声明的字节数处末两字节必须为 `FFD9`；③ 流内 N 字节与传入 JPEG **逐字节一致**。
- **验证**：`npm run smoke` 新增 16 条 adj411 断言（PDF 结构 + 上列精确位置）全绿，失败项 17 == 基线；**真实端到端**——无头 Chrome 里打开应用、点「导出 → PDF」，用 `Browser.setDownloadBehavior` 接住下载：得到 `未命名.pdf`（53 KB），把内嵌流抓出后 `SOI=0xFFD8 / EOI=0xFFD9`、逐字节与源 JPEG 一致，`read_image` 目视该 JPEG 即为渲染正确的 A4 谱面。
- **预防**：① **流的边界是"字节精确"的**——凡写 `stream…endstream`，头部结尾只能有一个 EOL 且其后立刻是数据，任何"顺手补换行"的通用写入函数都不该用于流对象；② **断言要落在"精确位置/逐字节"上，不能只查"包含某字节序列"**——后者对错位、截断、重复全都无感（本次正是靠"把产物抓出来看首尾字节"才发现）；③ 生成二进制文件（PDF/JPEG/音频）时，**结构自检 + 真实产物落地检查缺一不可**：结构对不对和内容对不对是两件事。

### E-2026-144 试听「暂停」无处可借：后端按 setTimeout 排程，ctx 级暂停无效；`disabled` 又会吃掉焦点（adj409）
- **场景**：用户要求试听支持暂停/继续——播放中再按播放键 = 暂停（图标/文案都变「暂停」），并且**点击播放后焦点要留在播放按钮上**，这样按空格就能暂停/恢复。
- **根因（两层，都不是"写错一行"而是机制认知问题）**：
  1. **没有可借的暂停原语**。试听后端 `SpessaSynthBackend.play()` 是**用 `window.setTimeout` 逐个排程** `noteOn`/`noteOff` 的（注释写明"规避 worklet `{time}` 时间语义，更可靠"），**不是**按 `AudioContext` 绝对时间排的。所以"`ctx.suspend()` 暂停、`ctx.resume()` 继续"这套常规做法**在这里无效**：挂起只是让声音静音，`setTimeout` 照旧把整首曲子的 noteOn/noteOff 全部跑完，恢复后什么都不剩。→ 暂停只能"**撤掉全部待触发排程**"，续播只能把**剩余事件重新排一遍**。
  2. **`disabled` 与"保持焦点"直接冲突**。第一版把准备期写成 `disabled={starting}`：按钮一被禁用就**立刻失去焦点**（浏览器规范行为）。而"焦点留在播放按钮上、空格即切换"正是本需求的核心，于是"防止连点"的小手段把主需求打掉了——实测：点击播放后 `activeElement` 变成 `body`，空格毫无反应。
- **解决**（adj409）：
  1. 时间轴换算收敛成纯函数 `src/playback/playbackTimeline.ts` 的 `shiftEventsFrom(events, fromMs)`：已播完的丢弃、起点重定位到 0、暂停瞬间正在发声的音符取**剩余时长**（后端没有"从中间起声"，该音从头再响一遍是已知取舍）；
  2. **两个时钟分开**：`timeBaseRef`（本次音频起点对应的原时间轴毫秒）+ `startTimeRef`（`performance.now()`），于是 `curMs()` 恒为**原时间轴**位置 → 高亮比对与 `playheadTrack`（都存原时间轴 `atMs`）**一行都不用改**，只有音频侧平移；
  3. 三个驱动定时器（RAF 色块 / 50ms 高亮 / 收尾复位）收敛为 `startTimers(job)`，首次播放与续播共用；暂停时只 `clearTimers()` + 定格 `currentMs`，**保持 `playing = true`**（会话未结束：「停止」可用、对话框保持停靠）；
  4. **准备期不用 `disabled`**：改 `aria-busy` + 降透明度，连点由 `onPlayToggle` 里的 `starting` 守卫拦掉 → 焦点全程留在按钮上；
  5. 新增 `activeGroupId` 之外的焦点效果：`playing || starting` 变化时 `playBtnRef.current?.focus()`（打开对话框时不抢焦点）。
- **验证**：`npm run smoke` 新增 9 条断言（平移/裁剪边界：已播完丢弃、未开始保持时长、正在发声取剩余部分、终点恰好落在边界、播到结尾与越界返回空、负数 from 归零、纯函数不改入参、起点恒 ≥ 0），失败项 17 == 基线；无头 Chrome + CDP 实测：真实鼠标点击「播放」后 `document.activeElement` **仍是播放按钮**（此前是 body），派发**真实空格键**确实触发该按钮 click。
  **遗留说明**：音色库 CDN（`raw.githubusercontent.com`）在本沙箱**不可达** → 音频链路无法端到端跑通，故"暂停后确实静音、续播后确实从暂停处出声"这一层未能在本环境实测，仅以纯函数断言 + 状态机实测覆盖。
- **预防**：① **做"暂停"前先确认底层播放器的排程方式**——按 `AudioContext` 绝对时间排的可借 `ctx.suspend()`；按 `setTimeout` 排的只能"撤掉重排"，两者的暂停实现完全不同（本项目属后者；`SpessaSynthBackend` 的注释里已写明原因）；② **`disabled` 会丢焦点**，凡"点击后要求焦点保持"的交互都不能用 `disabled` 表达忙碌，改用 `aria-busy` + 视觉弱化 + 事件守卫；③ 暂停/续播这类"时间轴换算"要**抽成纯函数**并用边界断言守住（本次：终点恰好等于暂停位置、播到结尾、越界、负值）——它是全功能里最容易差一毫秒的地方，而音频链路的端到端测试在 CI/沙箱里往往跑不起来。

### E-2026-143 顶栏「隐藏」按钮仍占宽度预算 → 本可显示的按钮被提前挤进「更多」（adj407）
- **场景**：用户要求「编辑区字体选择框在窄屏模式下不显示」。
- **根因（潜在，属设计陷阱）**：顶栏的按钮折叠是靠**隐藏测量容器**实现的——该容器渲染**全部** `toolBtns`、逐个量宽，再贪心算出能显示几个（`visCount`）。因此「隐藏一个按钮」若只写 CSS `display:none`，它在 `toolBtns` 里**依然存在、依然被量宽**，等于白占一份宽度预算：窄屏下会把别的按钮**提前**推进「更多」——症状是"明明藏了一个，显示的反而更少"。另外 `toolBtns` 的过滤条件只对**视图缩放**按钮生效（`t.kind === 'zoom' ? t.show : true`），给新按钮加 `show` 字段**不会生效**——是个会静默骗人的写法。末了还有个连带面：字体下拉若正开着，切到窄屏后按钮消失、**下拉会变成浮在顶栏下方的孤儿**。
- **解决**（adj407）：① 隐藏项加 `show: false` 并**从 `toolBtns` 数组里过滤掉**（`.filter((t) => !('show' in t) || t.show)`），使可见区、隐藏测量容器、「更多」下拉**三处同源一致**；② 过滤表达式统一用 `'show' in t`，不再按 `kind` 特判；③ `isNarrow` 变化时强制收起字体下拉。
- **验证**：无头 Chrome `--dump-dom` 按视口实测 `data-tool-key="font"` 出现次数——1400px / 1100px = 2（实体 + 测量容器各一），1000px / 700px = **0**（两处都没有，即不占预算）；CDP 真点击 13 项时序见 CHANGELOG。
- **预防**：① 凡是"**按空间决定显示哪些**"的布局，**隐藏必须发生在数据层**（数组过滤），CSS 隐藏只用于纯样式——否则"量宽"和"显示"两套判断会各说各话；② 顶栏按钮的可见性**只有 `toolBtns` 一个来源**，新增隐藏条件时必须同时确认**测量容器**也去掉了它（本项目已两次踩"两处各写一套"：E-2026-129 线组几何、E-2026-131 布局路径）；③ 可选标记（`show`）要用统一的过滤表达式而不是按 `kind` 特判——特判会在新增同类按钮时悄悄失效，且不会有任何报错。

### E-2026-142 已安装的 PWA 里菜单「打开」点了没反应（adj405）
- **场景**：用户手机上的 iJipu 装在主屏（PWA），点菜单「打开」**毫无反应**；同一个地址用浏览器打开时，对话框能正常弹出（只是列表里看不到 .jps）。
- **根因**：`openFile` 优先走 `window.showOpenFilePicker`（File System Access API）。浏览器里它不可用 → 落到 `<input type="file">` 降级路径 ✓ 正常；而**已安装的 PWA**（WebAPK）里该 API 存在却会**静默失败**——既不弹选择器、也不 reject（Promise 悬着），于是用户看到的就是"点了没反应"。Android 上即便它能工作，拿到的句柄也无法用于写回（移动端保存本来就走「导出」），走它没有收益。
- **解决**（adj405）：
  1. 移动端**一律走 `<input type="file">` 路径**：判定收敛成纯函数 `shouldUseFileInputPicker(coarsePointer, hasFileSystemAccess)`（`coarsePointer || !hasFsApi`），桌面端行为不变；
  2. 降级路径加"选择器没弹出来"兜底：`input.click()` 后 4 秒内既无 `change`/`cancel`、页面又始终保有焦点（说明从未被选择器抢走焦点）→ 弹一条可操作提示（改用浏览器打开 / 先用「导出」存到手机），不再让用户干等；
  3. 文案入 `brand/copy.ts`（`openPickerSilent`）。
- **验证**：`npm run smoke` 新增 2 条断言（移动端走 input、桌面端仍用系统选择器）全绿，失败项 17 == 基线；`tsc -b` + `lint`（0 error）通过。真机行为待用户复测（PWA 与浏览器应表现一致）。
- **预防**：① **"同一份代码在浏览器里行、在 PWA 里不行"——先怀疑"能力探测骗人"**：`'showOpenFilePicker' in window` 为真不代表能用（WebAPK 里会静默挂起），移动端不该按"API 存在"选路径，而应按"这个环境能不能可靠地弹选择器"选；② **任何"点了没反应"的用户反馈都值得加兜底提示**：静默失败的 Promise 是最难排查的形态（用户只会说"没反应"），能在超时后给一句可操作提示，就能把问题从"神秘"变成"可自助"。

### E-2026-141 已安装的 PWA 里软键盘弹出不收缩内容区，编辑区底部被盖住（adj403 / adj404）
- **场景**：用户手机上一直**用浏览器**操作而不用装到主屏的 PWA，原因是"PWA 窗口不随输入法打开而缩小"——键盘一弹出来就盖住编辑区，没法一边看一边写。
- **根因**：Android Chrome 的 standalone（PWA）模式默认虚拟键盘策略是 `resizes-visual`——键盘只缩**视觉视口**，**布局视口不变**，所以页面高度（`.app { height: 100dvh }`）不变，键盘就叠在内容上面；而浏览器标签页里 Chrome 走的是"缩布局视口"，所以浏览器里正常。App 侧没有对这个默认值做任何声明。
- **解决**（adj403）：`index.html` 的 viewport 加 `interactive-widget=resizes-content`（Chrome 108+ 支持）——声明"键盘出现时收缩内容区"，于是 PWA 与浏览器行为一致，`.app` 的 `100dvh` 跟着变小、编辑区自动让位。浏览器里该值本就是默认行为，等于无害。
- **验证**：`npm run smoke` 新增 1 条断言（index.html 含 `interactive-widget=resizes-content`）；构建产物 `dist/index.html` 同步（`vite build` 直接拷贝 index.html）。
- **预防**：① **"浏览器里正常、PWA 里不正常"这类差异，先想"两者默认值不同"**——本次是虚拟键盘策略（standalone 默认 overlay）；凡 PWA 与浏览器表现分叉，先把 `viewport`/`display`/`safe-area` 这几个"外壳相关"声明核对一遍；② 这类平台默认值要**显式声明**（不要依赖默认），并写一条断言钉住，否则换个部署形态（浏览器→PWA→TWA）又会分叉。
- **后续（adj404，用户真机复测后）**：`interactive-widget=resizes-content` 在用户机上**无效**——已安装 PWA / 国产浏览器外壳在键盘弹出时只缩"视觉视口"、不缩布局视口，`100dvh` 因此不变，键盘依旧盖住编辑区。结论：**不要猜宿主策略**。改为直接量 `visualViewport`（它在以上所有情况下都等于"真正看得见的区域"）：新增 `src/pwa/appHeight.ts` 把可视高写进 `--app-h`，`.app { height: var(--app-h, 100dvh) }`，并跟随 `visualViewport` 的 `resize`/`scroll` 与窗口 `resize`/`orientationchange` 更新；`appHeightPx` 写成纯函数便于单测（缩放≠1 时回退窗口内高，避免双指放大把应用缩小）。`adj403` 的声明保留（支持的内核上仍更优）。**同一批在 Obsidian 插件侧也修了同一类问题**（那边是 WebView 缩一次 + Obsidian 的 `--keyboard-height` 再扣一次，见插件 RELEASE-NOTES 0.7.2 / adj404）。

### E-2026-140 PWA 更新提示永不触发：`sw.js` 跨版本字节不变 → 手机长期停在旧 bundle（adj400）
- **场景**：发布 0.16.0 并在手机上验证——「关于」里已经是 v0.16.0，但用户反馈手机上的行为仍是旧的（打开对话框里看不到 .jps）。排查后确认**服务端没问题**（线上 `docStore-*.js` 与本地对同一提交的构建哈希一致、内含新代码签名），问题在**客户端一直跑旧 bundle**。
- **现象**：
  1. 已装到主屏的 PWA 窗口**长期不重载**，页面里始终是旧 JS；
  2. App 里的「发现新版本，点击刷新」（adj379）**从不出现**；
  3. 定时/窗口获焦触发的 `reg.update()` 也**查不到新 SW**（`navigator.serviceWorker` 无新注册、无 `controllerchange`）。
- **根因**：adj379 的更新提示挂在 `controllerchange` 上——只有**新 SW 被安装并接管**时才触发；而 `public/sw.js` 是纯静态文件，**每次发布字节完全一样**（内容与版本无关），浏览器于是判定"SW 未变化"：不安装、不接管、不触发提示。也就是说「更新提示」这套机制**缺少一个会随版本变化的触发源**。顺带核对了缓存头（Cloudflare Pages 给 `/sw.js` 的是 `public, max-age=0, must-revalidate`），这部分没问题；`sw.js` 里导航是 network-first，只要**发生一次导航**（关掉 PWA 重开）就能拿到新 HTML——但没人会那么做，用户以为"部署了就该自动生效"。
- **解决**（adj400）：
  1. 新增 `scripts/stamp-sw.mjs`：`vite build` 之后给 `dist/sw.js` **追加一行构建指纹**（`// ijipu-build: v<版本> <日期 时间> @<commit>`，重复执行先去掉旧行，保证只有一行）→ 每个构建的 sw.js 字节都不同 → 浏览器判定有新版本 → 安装新 SW → `skipWaiting`/`clients.claim` → `controllerchange` → 弹「发现新版本，点击刷新」✓；
  2. **缓存名 `jps-shell-v3` 刻意不动**：`activate` 只清"名字不同"的缓存，保持同名 → 已缓存的 30MB+ 字体不会每次更新都被清掉重下（adj192 的本意）；
  3. `src/main.tsx` 注册改为 `register('/sw.js', { updateViaCache: 'none' })`：SW 脚本本身也绕开 HTTP 缓存，`reg.update()` 一定拿到线上最新字节；
  4. `npm run build` 串联 `node scripts/stamp-sw.mjs`（指纹只进产物，源文件 `public/sw.js` 保持干净）。
- **验证**：构建后 `dist/sw.js` 末尾出现指纹行、重复运行仍只有一行；`npm run smoke` 新增 3 条 `adj400` 断言（build 脚本串联 stamp-sw / 脚本存在 / 注册带 `updateViaCache:'none'`）——**用断言把"机制不许被改回去"钉住**；线上 `sw.js` 缓存头实测 `max-age=0, must-revalidate`；本次 0.16.1 即为该机制在真机上的首次验证（手机上应出现更新提示）。
- **预防**：① **凡是"靠 X 变化来触发"的机制，必须有一个会随发布变化的 X**——adj379 依赖 SW 变化，却没人保证 SW 会变；把"打指纹"写进 build 并用断言钉住，否则后人把脚本从 `build` 里摘掉，机制会**静默失效**（且失效表现是"看着没事，只是用户永远用旧版"，最难发现）；② 排查"部署了没生效"要**分服务端/客户端两段证伪**：先证明服务器上是新代码（比对哈希/签名），再谈客户端缓存——本次正是先证服务端没问题，才把方向锁到 SW 更新链上；③ 真机验证要问清"用户看到的是哪个版本"（关于对话框的版本号 + 哈希比对），不要凭"我部署了"就判客户端已更新。

### E-2026-139 手机端「打开」对话框看不到 .jps 文件（adj399 / adj401）
- **场景**：用户在手机端（Android/iOS，含 PWA 与 App）点「打开」，文件对话框里**找不到任何 .jps 文件**（自家保存的谱也看不见）。
- **现象**：对话框能正常打开，但 .jps 文件被隐藏或置灰；PC 端不受影响（走 `showOpenFilePicker`，其中的 `.jps` 扩展过滤在桌面按后缀匹配有效）。
- **根因**：降级路径 `<input type="file">` 的 `accept` **按 MIME 过滤**——`.jps` 是自定义扩展，移动端文件管理器（Android SAF / iOS 文件 App）没有它的 MIME 记录，于是把它当未知类型处理；accept 里即便同时写上 `.jps`、`text/plain`、`application/octet-stream`（此前已放宽过一次），过滤仍然生效，自家的 .jps 依旧不可见。
- **解决**（adj399）：抽出纯函数 `fileInputAccept(coarsePointer)`（`saveSupport.ts`）——**移动端返回 null（完全不设 accept，全部文件可见）**，桌面降级路径保留原过滤串；`docStore.openFileViaInput` 按 `isCoarsePointer()`（`(pointer: coarse)` 媒体特性 + Android/iPhone/iPad/iPod/Mobile UA 兜底）取值，为 null 时不写 `accept`。打开后仍按内容解析，选错文件会给出解析告警，不会静默出错。
- **验证**：`npm run smoke` 新增 2 条 `adj399` 断言（移动端 `fileInputAccept(true) === null`、桌面串含 `.jps`）全绿；`npm run smoke` 失败项 17 == 基线；`tsc -b` 通过。
- **预防**：① **自定义扩展名 + 移动端 = 不要依赖 accept 过滤**——未知扩展在 MIME 体系里没有身份，任何"放宽 accept"都是在跟平台过滤规则猜拳，直接不设过滤才是确定行为；② 平台能力差异（媒体特性/UA）要做**多信号兜底**并写成可单测的纯函数（本次 `fileInputAccept(coarsePointer)`），把"环境判定"与"决策"分开。
- **后续（用户实测，adj401）——accept 不是全部原因**：真机上（Android + 国产浏览器）用户看到的是「列表里**能看到 .md**、就是没有 .jps」，而他的谱面文件来自**网盘 App**。逐字节核对线上产物确认"移动端不设 accept"已生效，于是 `accept` 已排除。真正的原因是两类**App 无法绕过**的情况：
  1. **文件不在本机**——网盘/微信里的文件不参与系统选择器的本机文件列表（用户在网盘 App 里"看得到"≠ 手机上存在该文件）；
  2. **所选提供方按类型隐藏**——部分网盘 SAF / 国产浏览器的文件选择器只暴露自己认识的文件类型（`.md` 认识、`.jps` 不认识）。
  所以 App 侧能做的只有**把出路讲清楚**：`adj401` 在移动端**用户放弃选择**（`cancel` 事件或老内核的失焦兜底）时弹一条可操作指引——保存到手机后再从「下载」目录选、或把扩展名改成 `.md`/`.txt`（内容按文本读入，选错文件只会给解析告警）。同时把 warn 类提示由 4s 延长到 6s（含操作指引，4s 读不完），并写进 `docs/DEPLOY-PWA.md` §5.5。
- **预防（补充）**：③ 排查"看不到文件"要**先问清用户看到的是什么、文件从哪来**——本次靠"能看到 .md 却看不到 .jps"这一条信息就把范围从"accept 过滤"收窄到"文件/provider 层面"，否则会一直在 Web 侧空转；④ 遇到"平台/第三方 App 的限制"时，App 的正确姿势是**给可操作的多条出路 + 明确告知**，而不是继续在自家代码里猜平台规则。

### E-2026-138 临时拍号分数未计入行宽预算 → 整行内容越出右边距（adj398）
- **场景**：用户报 4/4 的一行谱（`5'/. 6'// 5'/ 2'/ 3' 0/ 6// 5// | 6/ 5'// (3'// 3'/) 3'/ 2' 7&yc |"p:2/4" 0 5 |"p:4/4" 6-- &zkh 6/ 5/&sby |`，左右边距 40、音符字号 13、默认字体）**越出右边距**，并提示注意其中一个小节是 `|"p:2/4"` 的 2/4 临时节拍。
- **现象**（改动前引擎探针，默认空间优先布局）：右界 555.28，而该行**内容右缘 574.5（越 19.2px）**；末小节线本身被钳制在右界内（右缘 555.3）→ 音符跑到末小节线**右侧**去了。把两个 `|"p:x/y"` 注释去掉后同一行不越界（内容右缘 553.2）——**溢出量恰为每个分数约 10.7px**（两个分数 19.2 ≈ 2×9.6，含小数差）。
- **根因**：临时节拍分数画在小节线**右缘之后**（render 的 `fx = 线右缘 + 2s + halfW`，整宽 ≈ 2×halfW），空间优先路径（`placeMusicRowSpace`）里与它相关的**两处算法不一致**：
  1. **放置处**（adj357 起）：`gapR = max(barGapSide(), 2s + 2×halfW + 2)`——按分数整宽撑开，正确；
  2. **行宽预算**（`nonDurPad`，决定可分配宽 `W`）：一律 `lineW + barlinePad×2`，**完全没算分数**——于是 `W` 比实际需要多出「分数宽 − barlinePad」×分数个数，音符按这份虚高的 `W` 摊开，行尾自然冲出右边距。
  同类问题还有一处：**行末小节线**（atEnd）右缘贴右边距，分数画在线右缘之后 → 分数本身越界 12px（`… |"p:2/4"` 收尾可复现，两种布局都中）。
- **解决**（adj398）：
  1. 新增纯函数 `meterGapRight(comment, noteSize)`（= 分数整宽 + 起始 2×s + 末距 2px，单一定义）；
  2. 空间优先预算改为 `lineW + barlinePad + max(barlinePad, meterGapRight)`——**无分数时与原式 `lineW + 2×barlinePad` 完全相同**（既有排版零影响，smoke 失败项 17 == 基线即证）；
  3. 放置处复用同一函数（替换原先就地展开的算式），预算与放置**同源**；
  4. 行末小节线的右钳制改为 `右边距 − 半线宽 − meterGapRight`（空间优先 pin + 时值优先 `Math.min` 钳制各一处），分数右缘贴右边距。
- **验证**：`npm run smoke` 新增 **5 条 `adj398` 断言全绿**（第 94 节：用户原谱在**空间优先/时值优先两种布局**下「含分数右缘的行右缘 ≤ 右边距」+ 去注释对照 2 条 + 行末小节线带拍号 1 条）；**失败项 17 == 改动前基线**；用户原谱在字号 13 与 18 下均不再越界。另实测确认：`&yc`/`&zkh`/`&sby` 与临时拍号**无关**（逐个删除溢出量不变），排除干扰项。
- **预防**：① **"画在线外的东西"必须计入行宽预算**——凡"渲染时画在某元素右缘之外"的装饰（临时拍号分数、注释、& 标记）都要有一个 `xxxGapRight` 纯函数，并同时被「预算是它 / 放置也是它」两处消费（本项目已有 E-2026-129/E-2026-134 两次"两处各写一份"的教训，这是第三次，且这次是"预算少算"方向）；② 用户报"越出右边距"时，先量**可见内容右缘**（音符 `rightX`、非槽宽 `width`）与右界的差，再逐个"嫌疑装饰"做**删除对照实验**（本次靠删 `&yc`/`&zkh` 排除、靠删 `"p:2/4"` 定位），比读代码快得多；③ 断言要写成「可见右缘 ≤ 右边距」的端到端形式（而非断言某个中间量），这样任何来源的右溢都会被这条抓住。

### E-2026-137 连音组减时线与「同一拍内的组外音符」被强行分开：`5/ (y5// 6// 5//)` 的减时线断开（adj397）
- **场景**：用户报 4/4 的 `2/. 3// 5/ (y5// 6// 5//) 3[2/] 0// 2// 3// 5// |` 里 `5/` 的减时线是**孤立一小段**——`5/` 与 `(y5// 6// 5//)` **在同一拍内**，减时线应当**连在一起**。
- **现象**（改动前引擎探针）：该小节第 1 条（最上）减时线被切成两段——`5/` 一段（x 60→66.1）、组内三音一段（x 68.1→90.3），中间断开。拍位实测：`5/` = 1.0，组内三音 = 1.5 / 1.667 / 1.833（`floor(beatPos)` **都是 1**，确属同一拍）。
- **根因**：`render/index.ts` 的 `computeBeams` 用**单个分组键**归桶：`有 tupletGroup 按组号 t{n}、否则按拍 b{floor(beatPos)}`，再要求整段音符与**起点同桶**。于是 "连音组成员" 与 "同拍组外音符" 天然落在两个桶里——`5/` 是 `b1`、组内三音是 `t0`，即使同拍也永不共用减时线。这是 adj395 为"跨拍连音组不被拍线切断"引入组号时的**副作用**：把"组号"当成了**互斥**的分组依据，而不是"额外允许相连"的依据。
- **解决**（adj397）：把 `computeBeams` 的分组从「桶比较」改为**相邻逐对判定** `linked(a, b)`：① 同属一个等时值连音组 → 相连（跨拍不断，adj395 规则保留）；② **否则同一拍内 → 相连**（连音组不再与同拍组外音符"绝缘"）。连通性由"相邻对"自然传递，跨拍组与组外音符的相对关系不变（例：`(y3/ 2/ 1/) 1 2 |` 组占 2 拍、每音 2/3 拍 → 仍只有组内一条线，`1`（拍 3）不并入）。
- **验证**：`npm run smoke` 新增 **9 条 `adj397` 断言**（第 93 节：用户小节在**空间优先/时值优先两种布局**下各断言「`5/` 与组内三音同处第 2 拍」「第 1 条线从 `5/` 连到组末」「组首音不再是独立线头」「第 2 条只覆盖组内三音」+ 跨拍组反例 2 条），第 91 节原「连音组不与同拍组外音符相连」断言按新规则改写并**全绿**；**失败项 17 == 改动前基线**（均为既有乐器/变音角标/J 速度用例，与本改动无关）。规范同步：`docs/JPS-SPEC.md` §6 规则 3、`docs/SYNTAX.md` 速查、官网 `public/doc/jps-spec.html`。
- **预防**：① **"分组键"比不出"应当相连"**——凡"某类元素特殊相连"的规则，要用**相邻对谓词**（`linked(a,b)`）表达，而不是把所有元素塞进互斥的桶（桶天然排斥跨类相连，adj395 就是这么被带偏的）；② 用户报"线断开/连不上"类问题时，先打印**实测拍位与分组依据**（本例 `beatPos` + `tupletGroup`）再改代码——数值一眼看出"同拍却被分桶"，比在渲染结果上猜快得多；③ 断言里要**同时钉住"该连的连上"和"不该连的没连上"**（新增用例既断言 `5/`→组末连成一条，又断言组首音不再是线头、第 2 条不含 `5/`），否则放宽规则时容易顺手连错。

### E-2026-136 倚音时值规则缺失：演奏不占用主音符时值、后倚音位置不随增时线/附点移动（adj396）
- **场景**：用户给倚音规范并要求实现——① `3[2/]`：主音符 3 为 1 拍，倚音 `2/` 的**实际时值 = 实音符的 `2//` = 1/4 拍**（"再减一半"），演奏时**先奏 1/4 拍倚音 2、再奏主音符 3**，**合计仍 1 拍**；② 后倚音同理但排在**末尾**（先 3/4 拍主音符，最后 1/4 拍奏倚音）；③ 多倚音 `3[3/2/]` = 1/4 + 1/4 倚音后主音符余 1/2 拍；④ **增时线/附点后可写后倚音**（`3 -[h5/]`）：总时值 2 拍，主音符**先奏满增时线/附点**（到末尾前），最后 1/4 拍才奏倚音；谱面上倚音画在**增时线/附点之后**（紧靠）。用户随后补充：**后倚音应紧靠音符/增时线/附点**。
- **现象**（改动前）：
  1. **演奏**：倚音时值写死为 **1/8 拍**，且**不占主音符时值**——前倚音排在 `atMs − n×1/8 拍`（**借前一个音符的时间**）、后倚音排在 `atMs + 主音符时值 + …`（**借后一个音符的时间**），一个音符的**总占时被撑长**；`3[2/]` 听到的是「1/8 拍倚音 + 整 1 拍主音符」，不是"合计 1 拍"；
  2. **谱面位置**：后倚音一律画在 `x + digitW + 1px`（数字右侧），`3 -[h5/]` / `3.[h5/]` 的倚音**压在增时线/附点上**（数字右缘紧邻就是 `-`），既不符合新规则也看不清；
  3. **占位**：`graceExtraW` 一律并入音符数字块宽，尾部倚音没有排在增时线/附点之后的占位，改位置就会与 `-`/`.` 及后一音符重叠。
- **根因**：
  1. `playback/sequence.ts` 用固定 `graceMs = 0.125 拍` 且**把倚音事件放在主音符时值区间之外**（前减后加），语义是"装饰音额外插在缝里"；新规范是"从主音符**内部**切出时值"——两者是互斥的模型，必须重写；
  2. `render/index.ts` 的后倚音锚点是常量 `x + digitW`，与音符的时值元素（增时线/附点）无关；
  3. `layout/index.ts` 的 `graceExtraW` 只有"并入数字块"一种占位方式（前倚音向左、后倚音向右），没有"排在时值尾部"的形态。
- **解决**（adj396）：
  1. **规则常量收敛**（`layout/spaceLayout.ts`，layout/render/parser/playback 共用）：`graceNoteBeats(dc) = 1/2^(dc+1)`（倚音实际时值）、`graceAtTail(t)`（后倚音且主音符有增时线或附点 → 排时值尾部）；
  2. **演奏**（`playback/sequence.ts`）：主音符发声时值 = `tokenDuration − Σ倚音时值`（不足时钳制 0）；前倚音依次排在主音符**开头**、后倚音依次排在**末尾**，**总时值不变**（不再向相邻音符借时间，布局时钟/`totalMs`/反复跳转全部沿用原拍位）；顺带修正连音合并目标——合并原本取 `events[末元素]`，后倚音事件排在主音符之后时会**把长音并到倚音上**，现改为记录**主音符事件下标**并在任一方带倚音时不做连音合并；
  3. **谱面位置**（`render/index.ts`）：后倚音锚点改为「末个时值元素右缘」——附点右缘（`dotX0 + (dots−1)×2r + r`）、增时线末段右缘（空间优先取 `el==='aug'` 的最后一段、时值优先取第 `augmentCount` 段），无增时线/附点时仍为数字右缘；弧线终点同步落在锚点（倚音紧靠所依附的元素）；附点圆心/半径**提前到倚音之前**计算（两处共用同一份几何）；
  4. **占位**（`layout/index.ts`）：`graceExtraW` 拆为 `graceInlineW`（紧贴数字）+ `graceTailW`（接在增时线/附点之后），**合计不变**（行宽/断行不受影响），三条布局路径（断行预算 / 空间优先单声部 / 空间优先多声部）与 `beatBodyW` 同步；
  5. **语法健壮性**（`parser/tokenizer.ts`）：独立 `.` 与独立 `-` 同理归入前方音符 → `3 .[h5/]` 等价 `3.[h5/]`（与 `3 -[h5/]` 对称）；`parser.ts` 新增**倚音总时值超过主音符时值**的告警（附正确写法 hint，主音符会被钳制为 0 拍、不发声）；
  6. 规范同步：`docs/JPS-SPEC.md` §4 增两行（倚音时值、增时线/附点后的后倚音）+ 要点速览、`docs/SYNTAX.md` 速查、官网 `public/doc/jps-spec.html` 同步；输入条「括倚」组的 `[]`/`[h]` 键提示写明时值规则与尾部写法。
- **验证**：`npm run smoke` 新增 **21 条 `adj396` 断言全绿**（解析 4 条 + 演奏 7 条 + 位置 6 条（**空间优先/时值优先各一遍**）+ 占位 2 条 + 告警 1 条 + 独立附点 1 条），**失败项 17 == 改动前基线**；`npm run build`（tsc -b strict）+ `npm run lint`（0 error）通过；无头 Chrome 截图目视核对 8 个用例：`3[2/]`（倚音在数字左上）、`3[h2/]`（紧靠数字右上）、`3[3/2/]`、`3 -[h5/]`（两种布局：`5` 紧靠 `-` 右侧）、`3.[h5/]`（两种布局：`5` 紧靠附点右侧）、`3[h5/]` 基线（仍紧贴数字）均正确。
- **预防**：① **"装饰音时值"这类语义必须先在文档里定成一条公式**（本次 = `1/2^(减时线条数+1)`，并写成 layout 层纯函数供 layout/render/parser/playback 共同引用），否则四处各写一个常数就会漂移（旧代码的 `0.125` 就是这么来的）；② **占位与绘制必须成对改动**：谱面元素换位置时，同时改「渲染锚点」和「布局占位」（含全部布局路径），并用「不压到下一元素」的断言守住（`rightX ≤ 下一音符 x`）——本项目已有 E-2026-129（渲染一套偏移、布局一套总宽）与 E-2026-135（三条路径漏一条）两次同类教训；③ 改动布局几何前先**把共用几何提前算好**（本次附点圆心/半径由"仅附点块内"上提为函数级），避免第二处消费时复制公式；④ 用户报"效果不对"时，先按「语义公式 → 演奏事件时刻 → 谱面锚点」三层分别验证，不要只改一头。

### E-2026-135 等时值连音组 `(y…)` 在空间优先布局下按「各自写的减时线时值」占宽 → 越出小节、减时线被拍线切断（adj395）
- **场景**：用户给规则与用例——2/4 的 `3./ 6,// (y3/ 2/ 1/) |`：`3./`（0.75 拍）+ `6,//`（0.25 拍）已占 1 拍，`(y3/ 2/ 1/)` 应占**剩下的 1 拍**、组内三音**各 1/3 拍**（演奏时值也是 1/3 拍）；并要求「**占宽也按剩下的 1 拍算**」「谱面上三音的**减时线连成一条**」。
- **现象**（改动前引擎探针，`defaultPageConfig` 即空间优先）：
  1. 组内三音各被当成 **0.5 拍**（`3/` 的书写时值）→ 组合计 **1.5 拍**，小节内容越出小节线；
  2. 拍位变成 `1.0 / 1.5 / 2.0`（第 3 个音已落到小节外）→ `computeBeams` 按 `floor(beatPos)` 分组的规则把第 3 个音**甩出**减时线组，三音出现「两条短横线断开」；
  3. 占宽按 0.5/2.5 而非 (1/3)/2 分摊 → 组比该有的宽。
  （时值优先 `duration` 路径本来就正确——`tokenDuration` 已认 `tupletDur`，故只错在空间优先路径。）
- **根因（两层）**：
  1. **`splitNoteDur` 不认 `tupletDur`**：`layout/spaceLayout.ts` 的拆分只按 `diminishCount` 算 `noteDur = 1/2^dc`，`dotDur = tokenDuration − noteDur×(1+aug)` 又被 `max(0, …)` 夹成 0 → 返回的合计仍是 0.5 拍。而**三条布局路径里只有拍级路径不经过它**（拍级用 `tokenDuration`），空间优先单声部 `placeMusicRowSpace`、多声部 `placeVoiceBlock` 的段时值都从这里取——于是「默认布局下 `(y…)` 占宽错」。
  2. **减时线分组键只有「拍」**：`render/index.ts` 的 `computeBeams` 一律按 `floor(beatPos)` 归组；等时值连音是"平分一段总时值"的**一个组**，一旦该组跨拍（如 `(y3/ 2/ 1/) 1 2 |` 组总 2 拍、每音 2/3 拍），第 3 个音就被归到下一拍、线被切断——即使时值算对了也不满足"连成一条"。
- **解决**（adj395）：
  1. `splitNoteDur` 增 `tupletDur?`：组内音符的**总时值 = tupletDur**，按原始构型（`/ 条数`、`-` 条数、`.`）**等比缩放**各分量（书写形态不变、只换算实际时值；附点段吸收浮点余量保证合计精确等于 `tupletDur`）。由此空间优先的「元素可支配宽 = (元素时值 ÷ 行总时值) × W」自动按 1/3 拍分摊——组（1 拍）拿到的可支配宽**正好等于一个整拍音符的**（撑满行断言 `< 0.1px`）。
  2. `types.ts` 的 Note/Rest/Rhythm token 增 `tupletGroup?: number`，`parser.ts` 的 `applyTupletDurations` 给同组音符打**组号**（跨小节递增）；`computeBeams` 的分组键改为「**有组号按组号、无组号按拍**」→ 组内三音无论跨不跨拍都连成一条，同时连音组**不与同一拍内的组外音符**共用线（三连音自成一组）。
  3. 编辑器输入条「括倚」组补 `(y` 键（含中文提示）；`highlight.ts` 把 `(` 连同其后的 `+/-/y` 前缀一起高亮（否则 `(y` 的 y 是普通字符色）。
  4. 规范同步：`docs/JPS-SPEC.md` §6 增「`(y ... )`：等时值连音组」四条规则（组总时值 = 小节名义拍数 − 组外实际时值；占宽同样分摊；减时线连成一条；弧线标数字）、要点速览补一条，`docs/SYNTAX.md` 速查与官网 `public/doc/jps-spec.html` 同步；「待确认项」删掉「三连音精确语法」。
- **验证**：`npm run smoke` 新增 14 条 `adj395` 断言（解析 1/3 拍 + 组号；**两种布局**各自断言拍位 `1/4⁄3/5⁄3`、减时线连成一条、跨拍组仍一条、连音组不与同拍组外音符共线；撑满行可支配宽相等；多声部块拍位/段时值/减时线），**全绿且失败项 17 == 改动前基线**；`npm run build`（tsc -b strict）+ `npm run lint`（0 error）通过；`npm run preview:render` 临时样例用**无头 Chrome 截图**目视核对：默认布局 `3·6321 |`（三音一条减时线 + 上方数字 3）、跨拍组 `32112 |` 一条线、`(y1 2 3) 4 |` 无减时线（四分音符）均正确。
- **预防**：① **凡"某 token 的时值被覆盖"（`tupletDur` 这类）都要检查所有取时值的入口**——本次漏的就是"空间优先专用"的 `splitNoteDur`（它不调 `tokenDuration` 而自己算）；新增"覆盖型"字段时应 grep 所有 `1 / Math.pow(2, …)` 式的独立时值计算；② **凡是"看起来像一组"的排版元素，分组键不能只依赖几何位置**（拍位/序号会因时值覆盖、浮点、跨行而漂移）——应像 `tupletGroup` 一样由**解析期给出稳定分组 id**，渲染只消费；③ 断言必须**两种布局各跑一遍**（`defaultPageConfig` 空间优先 + `DUR_CFG` 时值优先）：本次时值优先本来就对，只测它等于没测（同 E-2026-131 的教训）；④ 布局类改动用**无头 Chrome 截图**目视复核（数字/线/标注的相对位置关系很难从数值看出对错）。

### E-2026-134 安装包漏带 `WebView2Loader.dll` → 装完启动报「找不到 WebView2Loader.dll」（打包）
- **场景**：用户装 `iJipu_0.14.0_x64-setup.exe` 后启动报缺 `WebView2Loader.dll`。
- **根因（两层）**：
  1. **工具链决定链接方式**：`webview2-com-sys` 的 `src/lib.rs` 里 `link_webview2!` 宏按 `target_env` 分派——`msvc` 静态链接 `WebView2LoaderStatic.lib`（**不需要 DLL**），其它（本项目用的 **GNU**，`x86_64-pc-windows-gnu`，见 E-2026-029）链接 `WebView2Loader.dll`（**运行期必须有该 DLL 与 exe 同目录**）；
  2. **打包没带上它**：`tauri.conf.json` 的 `bundle.resources` 是空数组，生成的 `installer.nsi` 只有 `File "${MAINBINARYSRCPATH}"`（即 exe）——**0.12.16 起的每个安装包都缺这个 DLL**。之所以长期没暴露：从 `target/release/ijipu.exe` 直接跑时 DLL 就在旁边，只有**装到干净目录**才炸。
- **解决**：`bundle.resources` 加映射 `{ "target/release/WebView2Loader.dll": "WebView2Loader.dll" }`（源路径相对 `src-tauri/`，目标 = 安装根目录），生成的 `installer.nsi` 随之多出 `File /a "/oname=WebView2Loader.dll" …`；安装包体积约 +70KB（压缩后的 DLL）。并新增 `scripts/check-installer.mjs`（`npm run check:installer`）：读 `installer.nsi` 断言「主程序 + 必需 DLL」都在安装清单里，且列出 `bundle/nsis` 下的产物大小，供发布前一眼核对。
- **预防**：① **换工具链（MSVC↔GNU）会改变运行期依赖**——GNU 下 `WebView2Loader.dll` 必须随包，别只看本机能不能跑；② 发布前**必须跑一次 `npm run check:installer`**（已写进 `docs/VERSIONING.md` 打包步骤与 `AGENTS.md` 命令速查）；③ 验证"装出来能用"要在**干净目录**里装（`/S /D=<临时目录>`）或至少核对安装清单，不能只在本机开发目录里跑 exe；④ 这类"清单类"问题适合脚本化断言（读打包脚本比人工比对文件列表可靠）。

### E-2026-133 渐强/渐弱退化判定误报：`3<---!`（合法）被报「起止之间没有音符」（adj394）
- **场景**：用户报 `3<---! |` 还会弹语法告警，而它**符合语法**（起点 = 音符 3，终点 = 该音符末增时线右缘）。
- **根因**：我在 adj393 里写的退化校验用的是「`<` **之后**是否有音符 token」——但**起点音符写在 `<` 之前**（`<` 是紧跟其前音符的起点记号），所以 `3<---!` 的 token 序列是 `[音符3, <, !]`，`<` 之后一个音符都没有 → 误判为「起止落在同一音符」。真正的退化条件是「起止**锚点**是同一个元素」，与时值元素写在 `<` 前还是后无关。
- **解决**：判定改为比较**起止锚点**——`!` 直接跟在音符后（`endOn='note'`）**且** `!` 前的音符个数与 `<` 前的音符个数相同（= 同一音符）时才算退化；`3<---!` 因 `endOn='aug'`（终点取增时线右缘，宽度 > 0）不再告警。同时**保留** `3<!`（无任何时值元素，零宽度）的告警与不渲染。
- **验证**：`npm run smoke` 新增断言——`3<---!` 无任何问题且两种布局都渲染出渐强（起点 = 音符中心、终点 = 该音符右缘）、`3<!` 仍告警且不渲染；失败项 17 == 基线。**应用内实测**：`3<---! |` → 无提示条、footer「语法检查通过」、SVG 含 1 条 hairpin；`3<!` → 1 条告警 + 「正确写法：…」；`1"未闭合` → 1 个错误 + 「正确写法：引号要成对闭合，如 `1"渐强" 2`」。
- **预防**：① 校验「某记号所修饰的对象」时，必须按**语义锚点**（"它前面那个音符"）判断，不能按"token 出现的先后顺序"数——起止记号与被修饰对象的书写位置关系可能相反（本次 `<` 在前、起始音符在后已在 token 流中出现）；② 报错/告警的判定逻辑要**配一组"合法边界写法"断言**（例如紧贴写法 `3<---!`、分写写法 `3 < --- !`），只测"该报错的例子"会漏掉误报；③ 顺带定案：**每条报错都要带 `hint`（正确语法规则 + 最小示例）**，端侧在提示下方直接给出「正确写法」——引擎 17 处报错点已全部补齐，并由 smoke 的"十类语法问题全部带正确写法"守住。
- **追加（同名语法约定）**：用户明确「渐强/渐弱只有 `+` 抬升，**不能**用 `-` 降低，因为 `-` 会被当作增时线」——**语法上写明**（`JPS-SPEC.md` 新增一行、`SYNTAX.md` 速查、官网 `jps-spec.html` 各一条；编辑器输入条「强弱」组的 `<`/`>`/`+` 键提示也写明）。
  **但不加解析告警**：`3<- 4`（想降低）与 `3<---!`（合法增时 + 渐强收尾）在源码上完全同形、无法区分，任何"`<-` 就告警"的规则都会误伤后者（第一版实现即如此，被 smoke 的 `3<---!` 断言当场拦下）。改为用**断言固定实际语义**：`3<- 4` → `-` 计入音符 3 的增时、且不产生任何"降低"告警；`3<+ 4` → `+` 是抬升级数、不改变时值。
- **全量排查（用户追问"还有哪个语法会因为 `-` 降低与增时线矛盾"）**：把引擎里所有吃 `+`/`-` 的位置逐一过了一遍（`types.ts` 的 `plus`/`minus` 字段 + tokenizer 的 5 处消费点），结论如下表；其中**只有连音线一处需要动手**。

| 语法点 | `-` 的含义 | 与增时线是否冲突 | 处理 |
|---|---|---|---|
| 渐强/渐弱 `<`/`>` | **不是**修饰（归增时线） | 同形不可分 | 已在规范写明；**不告警** ✓ |
| 连音线 `(` | **降低级数**（`(-`/`(--`） | **有**：`1(-`（紧贴音符）时 `-` 被连音线吃掉，用户可能以为在给音符 1 增时 | **新增告警 + hint**（`(` 前应有空格；增时写 `1- (- 2 3)`）；规范补条目 ✓ |
| 跳房子 `[` | **降低级数**（`[-`） | 无：`-` 位于小节线后的 `[` 记号区，增时线不可能出现在那里（增时线依附音符且不跨小节线） | 规范补条目（`1- | [-]…` 明确两者各写其位） ✓ |
| 音符注释 `"…"` | **降低级数**（adj392） | 有（已定案） | 规范已写明替代写法（`1-"注释"`） ✓ |
| `&编码` 尾部 | **不是**修饰（`&sby-` 的 `-` 是增时线，编码仍是 `sby`） | 有（用户易猜 `-` 是反向） | 规范补条目（`+` = **加长版**：`&sby+` 三齿半加长波音、`&cy+` 长颤音；**没有 `-`**） ✓ |

  新增断言（smoke）：`1(- 2 3)` → `-` 归连音线且音符 1 不增时 + 告警带 hint；`1- (- 2 3)`（规范写法）→ 增时 1 级 + 连音线降低 1 级，无告警；`1- | [-"1."` → 跳房子降低 1 级 + 音符增时 1 拍；`&sby+` / `&sby-` 的编码与增时差异。仓库内除文档举例外没有任何源码触发新告警。

### E-2026-132 `obsidian-ijipu` 把解析告警（warning）当致命错误 → 一条告警就整页不渲染（adj394）
- **场景**：应用侧新增「问题提示条」并把渐强/渐弱的不完整写法降为 warning 后，回看插件实现发现：插件一直用 `parsed.errors.length > 0` 判定失败。
- **根因**：引擎 `parseJps` 的 `errors` 数组**同时含 error 与 warning**（`severity` 字段区分）。应用侧（编辑器着色、导出、问题条）一直按 severity 区分，**插件侧漏了**——`renderScore`/`renderScoreFull`/`playScore` 三处都只看数组长度。于是插件里**任何告警都会让谱面整页变成「简谱解析失败」**（例：`音符块与小节线块之间应只有一个空格`、`孤立的 "&"`、`无法识别的符号`，以及本次新增的渐强/渐弱告警）。这也解释了此前"谱子在 iJipu 里能看、在 Obsidian 里报解析失败"的困惑来源。
- **解决**（adj394）：
  1. 新增纯逻辑模块 `src/parseIssues.ts` 的 `splitParseIssues(parsed)`：按 severity 拆成 `errors`（阻断）与 `warnings`（提示，带「第N行 第M列」前缀）；`render.ts` 的 `renderScore`/`renderScoreFull` 只把 errors 当失败，并把 warnings 一并返回；`playScore` 同样只对 error 抛错；
  2. `scorePane.ts` 在谱面下方渲染可展开的告警区（`.ijipu-warn`：`⚠ N 条语法告警（不影响显示）`，点击展开明细），与应用的「问题提示条」语义一致（应用侧为 `ui/ProblemsBar.tsx`，纯逻辑 `ui/problems.ts`）；
  3. `styles.css` 增 `.ijipu-warn*` 样式（用 `--text-warning` 并给 `--color-orange` 兜底，深色主题同样可读）。
- **验证**：应用侧 `npm run smoke` 17 项失败 == 基线（新增 `adj394` 断言覆盖：问题汇总/排序/行列/文案/跳转换算、`!` 写在不同时值元素后的终点定位）；**应用内实测**（无头 Chrome + CDP 真键输入）——合法写法出 3 条 hairpin、状态栏「语法检查通过」；非法写法出现问题条「2 个问题（2 个告警）」并逐条给出「第5行第9列…」；`!` 跟音符/增时线/两根增时线/附点时终点 x 依次为 68.2 / 80.3 / 88.4 / 75.1（数字 4 中心 68.2）。插件侧 `npm run smoke` **104 项全绿**（新增 6 条：仅告警可渲染、含错误阻断、正常无问题、跨行渐强属告警）。
- **预防**：① **凡是读 `parseResult.errors` 的地方都要看 `severity`**——数组名是历史包袱（同时装 error 与 warning），把「有告警」当「有错误」会造成"整页不渲染"这类重症状；② 引擎新增 warning 级提示时，**必须回头检查所有消费方**（应用编辑器/导出/试听、插件的渲染/试听/源码视图）；③ 端侧 UI 的"提示"应在端侧各实现一次但要语义一致（应用=编辑区底部问题条、插件=谱面下方告警区），文案与分级规则共用一份约定。

### E-2026-131 渐强/渐弱（`<`/`>`/`!`）在默认布局下**静默不显示**——装饰 token 只在拍级路径被处理（adj393）
- **场景**：用户报告「渐强/渐弱线在预览不显示」。
- **排查**（引擎探针，两种布局逐一对照）：
  1. 单声部 + **空间优先 `space`（`defaultPageConfig.noteSpaceLayout` 的默认值）**：`page.dynamics = 0`、SVG 无 hairpin；
  2. 单声部 + 拍级 `duration`：`dynamics = 1`，几何正确（起点 = `<+` 所跟音符槽中心、终点 = `!` 所跟音符槽中心、`plus=1`）；
  3. 多声部块（Q1/Q2）**两种布局都 = 0**。
- **根因**：`<`/`>`/`!` 是**装饰 token**（`DecorationToken.dynamics`），而 `layout/index.ts` 里处理 `decoration` 的代码**全文只有一处**——`placeMusicRow`（拍级路径）。默认配置走的是 `placeMusicRowSpace`（空间优先），`placeVoiceBlock`（多声部）也同样不处理 → **记号被静默丢弃**（不报错、不提示）。之所以一直没暴露：`scripts/smoke.mts` 的 hairpin 断言用的是 `DUR_CFG = { ...defaultPageConfig, noteSpaceLayout: 'duration' }`，**只测了非默认的那条路径**。
- **解决**（adj393）：
  1. 新增纯模块 `engine/layout/hairpins.ts`：`hairpinEvents(tokens)`（按源码顺序产出「音符/hairpin 起/hairpin 终」事件流）+ `resolveHairpins(events, centerOf, fallbackX, rowEndX)`（配对、未写 `!` 者行尾收尾、`+` 级数透传）；
  2. **三条布局路径共用**同一套语义：`placeMusicRow`（拍级，`noteCenters` 改为**行级**并改喂事件流）、`placeMusicRowSpace`（空间优先，新增事件流与「行内音符序号 → 数字槽中心」映射）、`placeVoiceBlock`（多声部，按声部行分别定位）；
  3. smoke 新增 13 条 `adj393` 断言：**两种布局逐一对照**（都是 1 条、类型/级数/中心 y 一致、起止锚定同一音符、SVG 都含 hairpin），外加多声部两种布局、未写 `!` 的行尾收尾。
- **验证**：`npm run smoke` **17 项失败 == 改动前基线（无新增）**，13 条 adj393 断言全绿；`tsc -b` 通过；`npm run preview:render` 临时样例（默认空间优先）实测 5 条 hairpin：`<+` y=137.3、`<++` y=135.3（基准 139.3，每级 2px）、未闭合者收尾于行末 x=552、多声部声部行 y=181.4，截图目视确认。
- **后续（adj394，用户当天追问）**：① 用户报「只显示一根竖线」→ 起止落在同一处时两条线重合；现加 `MIN_HAIRPIN_W=2` 退化防护（不画竖线）+ 解析期 warning 说明原因，并把未闭合者的行尾收尾改为 `max(行尾, 末音符右缘)`（避免反向）；② 用户明确「起点在音符、但 `!` 可结束于任意有时值元素（`-`/`.` 等）之后」→ tokenizer 记录 `dynamicsEndOn`（按 `!` 前一个非空格字符判定），layout 提供两个停靠点（数字槽中心 / 末时值元素右缘）；实测 `4 !`=68.2、`4- !`=80.3、`4-- !`=88.4、`4. !`=75.1；③ 新增编辑区「问题提示条」（`ui/ProblemsBar.tsx` + 纯逻辑 `ui/problems.ts`），把解析问题以可读文字呈现在编辑区（此前只有行号栏着色 + 悬停 tooltip），状态栏加绿/橙/红圆点。
- **预防**：① **新增/修改任何「装饰 token 语义」时必须两条布局路径都实现**——项目有两套排版实现（时值优先/空间优先）＋多声部块，凡按 token 类型分派的处理都要问一句"另外两条路径呢"；② **smoke 断言必须覆盖默认配置**：只用 `DUR_CFG`（非默认的 duration）测过就等于没测——涉及布局的功能断言应分别用 `defaultPageConfig`（默认 space）与 `DUR_CFG` 各跑一遍；③ 用户报"XX 不显示"时，先按「语法 → 解析 → 布局（哪种模式） → 渲染」逐层探针确认产出在哪一层消失（本次 5 分钟定位：`page.dynamics` 直接为 0）；④ 同类语义收敛成纯函数（本模块）而不是在每条路径里各写一遍（E-2026-129 的同类教训）。

### E-2026-130 用匿名 `api.github.com` 复核 Release 正文被 CDN 缓存误导 → 6 个历史 Release 被写错内容（发布流程）
- **场景**：给 `obsidian-ijipu` 补历史 Release 正文（`v0.3.1`~`v0.3.7` 是累积正文），用 `gh release edit --notes-file` 批量改写，改完用 `curl https://api.github.com/...` 匿名核对。
- **根因（两层）**：
  1. **匿名 API 响应会被 CDN 缓存**（`api.github.com` 对未鉴权请求返回可缓存响应）——核对时读到的是**改写前的旧响应**，据此又做了一轮多余的改写；可信的读法是**带鉴权的 `gh api`**（不走共享缓存），或给 URL 加随机查询串破缓存。
  2. 批量循环里"改完即读"没有独立复核，把错误内容当成了成功：实测 `v0.3.2`~`v0.3.7` 被写成了 `0.4.2` 的正文（28 行），只有 `v0.3.1` 正确——直到用带鉴权 API 全量核对才发现。
- **解决**：
  1. 改为**一次一个版本**：`node scripts/release-body.mjs <版本>` → 正文另存为**唯一文件名**（`release-body-<版本>.md`）→ `gh release edit --notes-file <绝对路径>`（避免共用同一个临时文件互相覆盖）；
  2. 每改完一个版本**立刻用 `gh api repos/<owner>/<repo>/releases/tags/<tag> --jq .body` 校验首行是否等于该版本号**，全绿才算完成；
  3. 终态复核：插件 21 个 Release 首行全部匹配各自版本；新建 `ijipu v0.13.1`（正文 1 个小节 + 附件 `iJipu_0.13.1_x64-setup.exe` 4.22MB）并同样校验。
- **预防**：① **GitHub 状态一律用带鉴权的 `gh api`/`gh release view` 读**，不要把匿名 `curl api.github.com` 当真相（缓存窗口内必然误判"没改成功/改错了"）；② 批量改远端状态时**每个条目都要用可信读回验一遍**——退出码 0 只说明 HTTP 成功，不说明内容对；③ 改写类脚本产出**唯一文件名**并在 `.gitignore` 挡住（`release-body.md`、`release-body-*.md`），避免"共用临时文件"串味与误提交；④ 破缓存小技巧：URL 追加 `?cb=<random>`。

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
- [ ] 同一几何量（线组宽度/偏移等）只有一处定义，渲染与布局消费同一个纯函数（禁"渲染写偏移 + 布局写总宽"）
- [ ] 核对 GitHub 上的 Release/远端状态用带鉴权的 `gh api`（匿名 `curl api.github.com` 有缓存，会误判）
- [ ] 布局类断言必须覆盖**默认配置**（`defaultPageConfig` 的 space）与 `DUR_CFG`（duration）两条路径；装饰 token 语义（渐强渐弱/连音线/跳房子等）三条路径（拍级/空间优先/多声部）都要实现
- [ ] 报错/告警的判定逻辑要配「**合法边界写法**」断言（如紧贴写法 `3<---!`、分写写法 `3 < --- !`），只测"该报错的例子"会漏掉误报；每条报错都要带 `hint`（正确语法规则 + 最小示例）
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
| v0.5.0 | 2026-08-27 | 发布 v0.5.0：窄屏适配（≤640px）— 汉堡菜单收纳、顶栏/状态栏合并为工具条、对话框 bottom-sheet、http 网站 openFile 降级 `<input type=file>`、顶栏工具条公共化（设置组上移 + 「⋮ 更多」公共按钮 + 三组同款风格 + 选中态统一 + nowrap）、试听对话框优化（速度/音色上下排 + 播放/停止外移 + 窄屏不 dock）、状态栏精简（行x,列x/共x行）、字体下拉 ▲；修复 E-2026-090（编辑器长行折行后 textarea 与高亮层错位——`wrapPoints` `charW=fontSize*0.6` 估算在 sub-pixel 临界宽度误判，去掉短行跳过 + 直接读 `taRef.current.clientWidth` 实时宽 + textarea `box-sizing:border-box` 与 mirror 一致） |
| v0.5.0 | 2026-08-27 | 补 PWA 部署文档 `docs/DEPLOY-PWA.md`（adj155 sw.js/manifest/main.tsx 注册已就绪，dist 构建产物已含 sw.js + manifest；部署 HTTPS 静态托管 → 手机 Chrome/Edge "添加到主屏幕"即可作为独立 App 运行；文档覆盖 HTTPS 平台推荐、部署验证清单、Android/iOS 安装步骤、调试问题、PWABuilder 打包上架路径） |
| v0.5.0 | 2026-08-27 | 应用更名为「iJipu / 爱记谱 / i记谱」（仅用户可见改名，零内部包名改动）：改 5 个文件（`src/brand/tokens.ts` brand.name/nameZh/shortName/extensionFull；`public/manifest.webmanifest` name/short_name/description；`index.html` title/description/apple-mobile-web-app-title；`src/ui/TopBar.tsx` 顶栏 Logo zh/en + img alt；`src/brand/copy.ts` + `src/dialogs/AboutDialog.tsx` 加致谢「番茄简谱」原作者与社区 + 本脚本高度兼容说明卡片）。**未改** `package.json` name/Cargo.toml name/`tauri.conf.json` identifier/localStorage 键 `jianpuscript.*`/`.jps` 后缀（保持兼容与零数据迁移）。`npm run build` 验证 dist 含新名 → 重新上传 Cloudflare 即生效 |
| v0.5.1 | 2026-08-27 | 发布 v0.5.1（更名/文案及若干修复调整）：更名「iJipu/爱记谱/i记谱」（仅用户可见）、关于对话框中文为主+slogan「敲码即简谱」、关于对话框 Logo 用网站 Jianpu.png、**编辑器选中仅文字高亮**（去 .hl-current-block outline + 删 .editor-current-line-bg 整行铺满层，参考排版按钮选中风格）、**对话框标题浅色主题偏浅**（.modal 显式 color:var(--jp-text-primary)）、**隐藏「打开示例谱」菜单并清空 SAMPLES**（defaultSample 返回新建模板；无草稿首开=新建，有草稿恢复草稿；sampless 入口隐藏）、PWA 部署文档。版本号三处（version.ts/package.json/tauri.conf.json）+ package-lock 同步 0.5.0 → 0.5.1 |
| v0.5.1 | 2026-08-27 | 追加 E-2026-093（多声部空间优先忽略 `align_min_bars`：设置两端对齐最小小节数对多声部无效 → adj318 `stretchBars = numBars >= config.align_min_bars`，自然宽 vs 撑满分叉与单声部同步；smoke [67] 改用 `align_min_bars=2` 验证撑满钳制，[ [68] 用默认 4 验证自然宽不撑满）+ E-2026-094（空间优先布局规则梳理与归档——新增 `docs/SPACE-LAYOUT.md` 单/多声部对照备忘，含 adj283~adj318 变更历史与已知问题清单） |
| v0.10.1 | 2026-08-27 | 发布 v0.10.1（多声部空间优先布局修复 + 试听色块按"时值元素"分块规则）：① **adj314~adj318 多声部空间优先几何重写**——`placeVoiceBlock` 重构 `mspSegX`/`mspBarRelW`/`mspS` 几何：小节头空、拉伸空白均分「(tb+numBars-1) 槽」、末节线钳制 rightLimit − halfW（`barlineTotalW('|')/2`，adj317c）、多声部读 `config.align_min_bars`（自然宽 vs 撑满分叉，adj318）、`DOT_AFTER_DIGIT_GAP` 入 `spacing.ts` 规范化常量；② **adj319/adj320 试听色块按"时值元素"分块**——一个时值元素一个色块（音符块 / 附点 / 增时线 / 双附点各自一块或附点并入主音符），色块右边界 = 下一时值元素左缘或小节线左缘（连续覆盖），附点段 `dotGap` 间隙防 `dotX0` 落在数字内，多声部 `plc.rightX` 累加附点圆右 + 增时线 + hx 显示占宽，多声部段循环 `dur` 用主时值（去附点）防止双重计入；③ **修复多声部块无断行用户决策**——撤 `breakVoiceBlock` 提案（多声部换行破坏"多声部同步编排"语义，超宽归谱师编排平衡，E-2026-095 撤销条目）；smoke 新增 [65][66][67][68][69][70]：行首贴左 + 附点有间隙 + 不溢出 + 末线贴右 + 双附点 + 5---分4块 + 5.附点并入主音符（1块）；tsc -b 通过；版本号三处（version.ts/package.json/tauri.conf.json）+ package-lock 同步 0.5.1 → 0.10.1。**未发布**：deploy PWA（需 HTTPS 静态托管更新 + Android/iOS "添加到主屏幕"刷缓存）。详见 `docs/SPACE-LAYOUT.md` 单/多声部布局备忘、E-2026-093~098 错误日志条目。 |
| v0.10.4 | 2026-09-02 | 发布 v0.10.4（输入工具条一级化 + 主键组浮层 + 两处同源收敛 + 移动端布局/对齐修复）：**adj321/adj321b 连音线连接点规则**（`(X)` 单音符 + 更早未闭合开括号 = 连接点，终止前一连音并以 X 起新连音；深嵌套不受 `depth<2` 阻断）+ **adj322 当前行全宽高亮**（`.hl-current-line` 负外边距延伸到编辑器边缘 + `.gutter-current` 行号高亮 + 单击行号语义 = 非当前行跳行首 / 当前行跳错误位置）+ **adj322b 两处同源收敛**：新建 `completions.ts` 的 `MODIFIER_SYMBOLS` 统一 `&` 修饰符字典，`NOTE_MODIFIER_HINTS`/`BARLINE_MODIFIER_HINTS`（自动补全）与 `padLayout.ts` 的 `DECOR_KEYS`（输入条「装饰」组）**同源派生**，杜绝两处各自维护符号/文案漂移；`DECOR_KEYS` 现含全部 & 符号（补齐 cy+/bc/zy/sby+/xby+），装饰浮层与自动补全候选完全一致；**adj323 输入工具条一级化 + 主键组浮层**：取消二级态（← 返回），一级主键在按钮位置弹出该组二级键浮层（每项「插入内容 + 中文说明」，复用自动补全浮层风格/定位）；keepOpen 组（音符/时值）浮层常驻（连续插多个、点浮层外关闭）、其余组点一项后自动关闭；键盘导航（↑↓/Enter/Esc）复用自动补全同一套；`EditorPane.tsx` 新增 `PadMenu`/`PadMenuPopover`，`ScriptToolbar.tsx` 改一级（`onGroupMenuOpen`）；**adj323b 浮层底部统一对齐**——浮层底部对齐工具条顶边、水平居中于工具条、向上弹出，不再跟随按钮左右飘；**adj323c 菜单底边真实对齐**——此前用 `top = area.y - estH` 定位，`estH` 为**估算高度**（`keys.length*30+10`）且被 CSS `max-height` 钳制，与实际渲染高不符，导致各菜单底边漂移、不齐；改为 **CSS `bottom` 定位**（`bottom = viewH - (area.y - 6)` 内联，`maxHeight = viewH - bottom - 6`），浏览器直接按底边对齐——所有菜单底边精确落在工具条顶边上方 6px、在同一水平线，键数/高度变化不再影响底边；水平仍以按钮中心居中跟随并钳制视口。**adj324 移除「音符」主键组**——数字音符 1-7/休止 0 用物理键盘输入更快，工具条只保留键盘难以产出的符号（时值/小节线/括号/装饰/跳房子/变音/描述头/乐器）；删除 `padLayout.ts` 的 `NOTE_KEYS` 定义与 `PAD_GROUPS` 中的 note 项。**adj325 菜单固定最大高度**——所有主键组浮层统一 `max-height: 240px`（≈8 个菜单项，`--pad-menu-item-h` 28px 估算），超出部分 `overflow-y: auto` 滚动，避免高分组（装饰/变音）菜单过高；EditorPane 内联 `maxHeight = min(240, 视口可用高)` 双保险，小窗口不超视口。**adj326 乐器组直插乐器名**——输入条「乐器」组不再只放 `@`/`@@` 再靠自动补全选，直接列出 `INSTRUMENT_LIB_NAMES` 全部乐器名（钢琴/风琴/弦乐/长笛/铜管/八音盒）为菜单项，点击一步插入 `@乐器名`（label=名称、insert=`@名`、hint=切换乐器：X），保留 `@@` 切回默认；`padLayout.ts` 从 `@ijipu/engine` 导入 `INSTRUMENT_LIB_NAMES` 派生，与描述头 Y / 自动补全同源。**adj327 菜单最大高度收紧为 7 项**——`.pad-menu` 与 EditorPane 内联 `maxHeight` 均由 240px → 204px（28×7 + 8px padding）。**adj328 收紧为 6 项**——204px → 176px（28×6 + 8px padding）。**adj329 移动端页面固定不滚**——手机端 `.app` 用 `height:100vh`（移动地址栏使 100vh 大于可见视口 → 纵向可滚）且 `overflow:visible`（原注释误写 hidden），子元素一旦超宽/超高即把 document 撑出可滚区域。修复：`html{overflow:hidden}` 锁死 document 两向滚动（仅 body hidden 在 iOS/部分安卓对横向不总生效）；`.app` 加 `width:100%; max-width:100vw` 防超宽 + `height:100dvh`（降级 100vh）动态视口高；页面主体由 `split-pane{overflow:hidden}` 裁剪，编辑器/预览/工具条各自内部滚动不受影响；`.app` 仍 `overflow:visible` 保证下拉不被裁剪。**adj330 行号与内容对齐**——手机端行号错位：`wrapPoints` 的 mirror 经 `font-family:${effectiveFont},monospace` 拼接，当 `effectiveFont` 为空或含特殊字族时 mirror 与 textarea 实际生效字体分裂 → 折行点不同 → `visualLines` 与实际折行不符 → 行号栏高度（vis×lh）错位。修复：mirror 改从 textarea **`getComputedStyle` 取 font-family/font-size/line-height/letter-spacing**，与 textarea 逐字同源，折行测量即实际渲染；行号栏 `.gutter-line`/`--jp-editor-lh` 已与 textarea 一致（整数行高）+ mirror 同字体后，行号与内容行对齐。**adj331 实测行高根治累积漂移**——用户报告行号仍累积漂移（越往下越错），根因：`editorLineH = Math.round(fs*1.7)` 为**理论**整数行高，手机端某些字体/浏览器下 textarea 实际行盒与之不符，行号栏/高亮层按理论 editorLineH 排布与内容行逐行错位。修复：新增 `measuredLineH`（用同款 mirror 测两行 offsetHeight 差，仍取整）作为**实测行高** `lineH`，统一用于滚动目标、补全浮层 y、CSS 变量 `--jp-editor-lh`、行号栏高度、CompletionPopover lineH——textarea/行号栏/高亮层/滚动全部以实测值排布，消除累积漂移。**adj332 折行点误判根治**——用户诊断：`textarea lineHeight=31`、`gutter lineHeight=31` 一致，但 `gutter rect=62`（2 视觉行）→ 行号栏把某源码行误算成 2 视觉行，比 textarea（1 行）多占一行高，往下累积、内容行相对行号越离越开。根因：wrapPoints 折行判定用 `cur.top > prev.top + 0.5`（0.5px 阈值过小），手机/亚像素渲染下相邻字符 top 抖动 >0.5px 即误判为折行 → visualLines 高估。修复：top 阈值改按行高缩放 `cur.top > prev.top + lh*0.6`（真实换行 top 增≈一整行必过，亚像素抖动远小于 0.6 行高不误判）。**验证**：tsc -b 通过、npm run smoke 10 项预存失败（无新增）、npm run build 通过。**adj334 音符上方单字修饰符**——新增 `&tu`（吐音→粗体 T）/`&da`（打音→粗体 扌）/`&die`（叠音→粗体 又），音符正上方居中渲染（`render/index.ts` 的 `ABOVE_GLYPH`，`FONT_CN` 粗体）；`completions.ts` `MODIFIER_SYMBOLS` 一处添加即同步自动补全与输入条「装饰」组（两处同源）；文档 JPS-SPEC/SYNTAX/jps-spec.html 同步；smoke 新增断言通过、tsc/build 通过。**遗留**：手机端行号与内容行仍有微偏移（PC 正常，仅手机），疑为移动字体行盒与 CSS line-height 差异所致，adj331/332/333 已加固、留待 0.10.5 真机复核。（三处版本号 version.ts/package.json/tauri.conf.json + package-lock 已同步 0.10.3 → 0.10.4）。 |
| v0.10.5 | 2026-09-02 | 发布 v0.10.5（音符上方单字修饰符）：**adj334 吐音/打音/叠音**——新增 `&tu`（吐音→粗体 **T**）/`&ku`（吐音→粗体 **K**）/`&da`（打音→粗体 **扌**）/`&die`（叠音→粗体 **又**），写在音符后、居中显示于音符正上方（`render/index.ts` 的 `ABOVE_GLYPH`，`FONT_CN` 粗体 + `text-anchor="middle"`）；**adj335 叠音又横向缩 3/4**（`scale(0.75,1)`，以数字槽中心为锚）；**adj336 新增吐音 &ku**（与 &tu 同显示方式）；**adj338 上方修饰层专属层间留白更小**——新增 `SYM_LAYER_GAP` 仅用于音符上方符号循环（共享 `LAYER_GAP=2` 仍用于减时线/低八度点/连音线，冒然缩小会破坏 `adj219` 减时线分组/平顶/连音线断言），多修饰符堆叠紧凑而不影响其它层；`completions.ts` `MODIFIER_SYMBOLS` 一处添加即同步自动补全（`NOTE_MODIFIER_HINTS`）与输入条「装饰」组（`DECOR_KEYS`）两处同源；文档 JPS-SPEC/SYNTAX/jps-spec.html 同步；smoke 新增断言（吐音/打音/叠音粗体居中 + 归属前方音符 + 修饰符池含 tu/ku/da/die）通过。**验证**：tsc -b + npm run build 通过，smoke 10 项预存基线无新增。版本号三处 + package-lock 同步 0.10.4 → 0.10.5。 |
| （未发布） | 2026-09-12 | 追加 E-2026-129（小节线渲染偏移与布局占位表两处各写 → `adj104` 缩线宽时占位未同步，线组偏左/预留虚胖/线间距 1→1.2；adj391 收敛为 `spacing.ts` 的 `barlineGeometry` 单一来源，细 1 粗 2，线组以中心对称；同批高八度点改与音符水平居中） |
| （未发布） | 2026-09-14 | 追加 E-2026-136（倚音规范落地：倚音**占用主音符时值**——实际时值 = 1/2^(括号内减时线条数+1) 拍（`3[2/]` = 1/4 拍倚音 + 3/4 拍主音符，合计 1 拍），前倚音先奏、后倚音末奏、多倚音依次排列，**总时值不变**（旧实现把倚音插在主音符时值之外、还向相邻音符借时间）；**增时线/附点后可写后倚音**（`3 -[h5/]` / `3.[h5/]`）：谱面上倚音画在增时线/附点**之后**（紧靠）、末拍才奏，主音符先奏满；独立 `.` 归前音符（`3 .[h5/]` 等价 `3.[h5/]`）+ 倚音总时值超主音符告警；连带修连音合并目标错取倚音事件；smoke 新增 21 条 adj396 断言，两种布局各跑一遍） |
| （未发布） | 2026-09-14 | 追加 E-2026-135（等时值连音组 `(y…)` 规则定案与修复：组占「小节剩余时值」（2/4 的 `3./ 6,// (y3/ 2/ 1/)` → 组占剩下 1 拍、每音 1/3 拍），**占宽同样按剩余拍分摊**、**减时线连成一条**；根因是空间优先专用的 `splitNoteDur` 不认 `tupletDur`（把 `3/` 当 0.5 拍）＋ `computeBeams` 分组键只有「拍」（跨拍组被切断）→ `splitNoteDur` 增 `tupletDur` 等比缩放、token 增 `tupletGroup` 组号（解析期给出、渲染只消费）；输入条补 `(y` 键、`highlight` 把 `(+/-/y` 前缀一起高亮；规范 JPS-SPEC/SYNTAX/jps-spec.html 同步并删「待确认项·三连音精确语法」；smoke 新增 14 条 adj395 断言，两种布局各跑一遍） |
| （未发布） | 2026-09-13 | 追加 E-2026-134（安装包漏带 `WebView2Loader.dll`：GNU 工具链下该 DLL 是动态依赖，而 `bundle.resources` 为空、`installer.nsi` 只装 exe → 0.12.16 起所有安装包都缺；已加 resources 映射 + `npm run check:installer` 自检并写进发布流程） |
| （未发布） | 2026-09-13 | 追加 E-2026-133（渐强/渐弱退化判定误报：`3<---!` 合法却被报「起止之间没有音符」——根因是按「`<` 之后的音符数」判定，而起始音符写在 `<` 之前；改为比较起止锚点；顺带定案「每条报错都带正确语法规则 hint」，端侧显示「正确写法」；并全量排查 `-` 降低 vs 增时线的冲突点：仅连音线 `1(-` 需加提示，跳房子 `[-` 无冲突，`&编码+` 为加长版且无 `-`） |
| （未发布） | 2026-09-13 | 追加 E-2026-132（插件把 warning 当致命错误：`parsed.errors.length > 0` 判失败 → 一条告警整页不渲染；改为按 `severity` 拆分，告警在谱面下方可展开显示；同批：应用新增「问题提示条」`ui/ProblemsBar.tsx` + 纯逻辑 `ui/problems.ts`，`!` 支持收在 `-`/`.` 之后） |
| （未发布） | 2026-09-13 | 追加 E-2026-131（渐强/渐弱在默认布局下静默不显示：装饰 token 只在拍级路径处理，而默认是空间优先；多声部块同样不处理 → 新增 `layout/hairpins.ts` 纯模块，三条路径共用；smoke 断言改为两种布局逐一对照） |
| （未发布） | 2026-09-13 | 追加 E-2026-130（补历史 Release 正文时用匿名 `api.github.com` 复核被 CDN 缓存误导 → 6 个 Release 被写成 0.4.2 正文；改为「一版一文件 + 带鉴权 `gh api` 逐个校验」；终态：插件 21 个 Release 首行全部匹配各自版本，新建 `ijipu v0.13.1` 并附安装包） |
| （未发布） | 2026-09-12 | 追加 E-2026-128（顶栏字体下拉打不开：弹层在 `overflow:hidden` 的 `.topbar-toolbar` 内被裁 → 改 fixed 定位；并修掉 ref 被隐藏测量容器覆盖导致定位跑偏；沉淀"没触发 vs 没画出来"的命中测试排查法） |

| （未发布） | 2026-09-12 | 追加 E-2026-127（矮视口下顶栏菜单超视口、末项点不了：限高用"猜的 56px 偏移" → 改按实测位置动态限高 + 矮视口紧凑/双列；顺带窄屏隐藏「左右拆分」） |
| （未发布） | 2026-09-12 | 追加 E-2026-125（编辑器偏好被写进谱面 `# jps-config` 且与 uiStore 两份存储：设置分层缺失 → 类型层移出 + L1 唯一入口 + 旧值迁移；并把「设置分层原则」写入 AGENTS.md 七） |
| （未发布） | 2026-09-12 | 追加 E-2026-126（`# jps-config` 全量写入把旧默认永久钉住 + 谱面字体裸名跨机回退失效 → 差量写入 + 固化全量入口 + 字体完整栈与 `normalizeFontStack` 兼容旧谱） |
| （未发布） | 2026-09-12 | 追加 E-2026-124（`# jps-config` 往返丢 `showInstrument`：可选字段白名单靠人工补 → 抽常量 + 编译期完整性断言 + "写入字段必可读回"强不变量；为 obsidian-ijipu 复用谱面设置做的前置修复） |
| （未发布） | 2026-09-12 | 追加 E-2026-123（试听「最后一小节最后一个音符后面的增时线没有色块」：`schedulePlay` 的 `totalMs` 只算末事件**起声时刻**、未算 `durationMs`，收尾定时器在末音符刚起声就清空色块轨道 → adj381 改为取**事件尾端**最大值；沉淀排查法：**用无头 Chrome + CDP 跑部署产物本身**按帧量几何，而不是只看引擎数据/最小用例） |
| （未发布） | 2026-09-14 | 追加 E-2026-139（手机端「打开」对话框看不到 .jps：移动端文件管理器按 MIME 过滤，`.jps` 无 MIME 记录 → 隐藏/置灰（放宽 accept 也无效）；抽出 `fileInputAccept(coarsePointer)` 纯函数，**移动端不设 accept**、桌面保留过滤，`isCoarsePointer` 用 `(pointer: coarse)` + UA 双信号兜底；smoke 新增 2 条 adj399 断言） |
| （未发布） | 2026-09-14 | 追加 E-2026-138（临时拍号分数未计入行宽预算 → 带 `\|"p:2/4"` 的行内容整体右溢，用户谱越界 19.2px（每个分数约 10.7px）；根因是空间优先「预算按 barlinePad×2、放置按分数整宽」两套算法 → 新增 `meterGapRight` 纯函数并让预算与放置同源，行末小节线右钳制再让出分数占位（原分数越界 12px，两种布局都中）；smoke 新增 5 条 adj398 断言，失败项 17 == 基线） |
| （未发布） | 2026-09-14 | 追加 E-2026-137（连音组减时线与同拍组外音符被强行分开：4/4 的 `2/. 3// 5/ (y5// 6// 5//) …` 里 `5/`（拍 2 起点）与组内三音（拍 2 内）**同拍却各画一段线**；根因是 adj395 引入的「有组号按组号、无组号按拍」**单键分桶**——组号被当成互斥依据，同拍跨类永不共用 → `computeBeams` 改为**相邻逐对判定** `linked(a,b)`：同组相连（跨拍不断，保留）**或** 同拍相连（adj397）；规范 JPS-SPEC/SYNTAX/jps-spec.html 同步；smoke 新增 9 条 adj397 断言（两种布局各一遍 + 跨拍组反例），第 91 节旧断言按新规则改写，失败项 17 == 基线） |
| v0.16.2 | 2026-09-14 | 发布 v0.16.2（**键盘不再吃掉编辑区 + PWA 里「打开」能用 + 粘贴源码导入**）：**adj403/adj404** 已安装 PWA 键盘不缩窗口 → `interactive-widget=resizes-content` 在真机无效后改为 `min(visualViewport, innerHeight)` 写 `--app-h`（E-2026-141 及后续）；**adj405** 移动端一律走 `<input type=file>`（PWA 里 `showOpenFilePicker` 静默挂起 → 「打开」点了没反应）+ 选择器未弹出的 4 秒兜底提示（E-2026-142）；**adj406** 新增「文件 → 粘贴源码导入」（不依赖系统选择器的兜底入口，纯函数清洗 BOM/CRLF/```jps 代码围栏）；**adj400/adj401** SW 更新指纹与 .jps 指引。smoke 新增 11 条断言，失败项 17 == 基线 |
| v0.16.1 | 2026-09-14 | 发布 v0.16.1（**让更新真正到达手机端**）：**adj400** 新增 `scripts/stamp-sw.mjs`，`vite build` 后给 `dist/sw.js` 追加构建指纹（版本+时间+commit）→ 每次构建 SW 字节都变 → adj379 的「发现新版本，点击刷新」才真正会触发（此前 sw.js 跨版本不变，手机上永远等不到提示）；缓存名保持不变（30MB 字体不重下）+ 注册加 `updateViaCache:'none'`（E-2026-140）。**adj401** 手机端**放弃选择文件**时弹出三条出路（保存到手机／从「下载」目录选／改扩展名 .md/.txt 也能按文本读入），warn 提示 4s→6s；`docs/DEPLOY-PWA.md` 新增 §5.5/§5.6 真机排查表（E-2026-139 后续：用户实测"能看到 .md 却看不到 .jps"→ 文件在网盘未落地 / provider 隐藏未知扩展，非 accept 问题）。smoke 新增 4 条断言（adj400 3 + adj401 1），失败项 17 == 基线。**adj403** `index.html` viewport 加 `interactive-widget=resizes-content`——已安装的 PWA 里软键盘弹出不再盖住编辑区（standalone 默认只缩视觉视口），用户不用再为了键盘而放弃 PWA（E-2026-141）；smoke 再 +1 条断言 |
| v0.16.0 | 2026-09-14 | 发布 v0.16.0（**减时线按拍相连 + 临时拍号不再撑破右边距 + 手机端能看见自己的 .jps**）：**adj397** 减时线分组由「单键分桶」改为相邻逐对判定 `linked(a,b)`——同组相连（跨拍不断，保留 adj395）**或同拍相连**，修掉 `5/ (y5// 6// 5//)` 同拍却被强行分线（E-2026-137）；**adj398** 新增 `meterGapRight()` 让行宽预算与放置同源 + 行末小节线右钳制让出分数占位，修掉 `\|"p:2/4"` 行内容整体右溢 19.2px、末线分数越界 12px（E-2026-138）；**adj399** 抽出 `fileInputAccept(coarsePointer)`，移动端不设 accept、桌面保留过滤，修掉手机端打开对话框看不到 .jps（E-2026-139）。规范 JPS-SPEC/SYNTAX/jps-spec.html 与 SPACE-LAYOUT 同步；smoke 新增 16 条断言（两种布局各跑一遍），失败项 17 == 基线；`tsc -b` + `npm run build` + `lint` 0 error。**已知未修**：时值优先路径自身右溢（与临时拍号无关，7.8~10.3px） |
| v0.15.0 | 2026-09-14 | 发布 v0.15.0（连音组与倚音的「时值规矩」）：**adj395 等时值连音组 `(y …)`**——组总时值 = 小节名义拍数 − 组外实际时值（2/4 的 `3./ 6,// (y3/ 2/ 1/)` → 组占剩下 1 拍、每音 1/3 拍），**占宽同样按剩余拍分摊**、**减时线连成一条**（跨拍不断、不与同拍组外音符共线）、弧线标数字；修复空间优先专用 `splitNoteDur` 不认 `tupletDur`（默认布局把三音当 1.5 拍 → 越出小节）＋ `computeBeams` 分组键只有「拍」（跨拍组被切断）→ token 增 `tupletGroup` 稳定组号。**adj396 倚音时值与位置**——倚音**占用主音符时值**（实际时值 = 1/2^(括号内减时线条数+1) 拍），前倚音先奏、后倚音末奏、多倚音依次排，**总时值不变**（旧实现把倚音插在主音符时值之外、向相邻音符借时间）；**增时线/附点后可写后倚音**（`3 -[h5/]` / `3.[h5/]`）：主音符先奏满、末拍才奏倚音，谱面上倚音画在增时线/附点**之后**（紧靠）；独立 `.` 归前音符（`3 .[h5/]` 等价 `3.[h5/]`）+ 倚音总时值超主音符告警；连带修连音合并目标错取倚音事件。规范 JPS-SPEC/SYNTAX/jps-spec.html 同步；smoke 新增 35 条断言（两种布局各跑一遍），失败项 17 == 基线；无头 Chrome 截图核对 9 个用例 |
| v0.16.3 | 2026-09-15 | 发布 v0.16.3（**顶栏与输入条各让出一点位置**，两条界面调整，PATCH 级）：**adj407** ①**编辑器字体选择框窄屏模式（≤1024px）不显示**——顶栏字体项加 `show: !isNarrow` 并**从 `toolBtns` 数组过滤掉**（不是只加 CSS：隐藏项若留在数组里，仍会被隐藏测量容器量宽、白占预算，把本可显示的按钮提前挤出「更多」，见 E-2026-143），过滤表达式统一为 `!('show' in t) || t.show`（此前只对视图缩放生效），并在 `isNarrow` 变化时收起已展开的字体下拉（防孤儿浮层）；设置入口仍在「页面设置 → 全局 → 编辑器字体」；②**输入条主键按钮改开关语义**——同组再点即收起、点别组直接换菜单（不叠加），新增 `activeGroupId` 使展开的按钮高亮 + `aria-expanded`。**无头 Chrome 实测**：字体按钮 1400/1100px 存在、1000/700px 为 0 次（按钮集中也已消失）；CDP 真点击 13 项时序（开→再点关→换组→再点关→点外关闭）全部符合预期。`tsc -b` + `npm run build` + `lint` 0 error；smoke 失败项 17 == 基线（不涉及引擎，未动 obsidian-ijipu/vendor/engine） |
| v0.17.0 | 2026-09-15 | 发布 v0.17.0（**图标全套替换 + 试听暂停/继续**）：**adj408** 顶栏/试听对话框按钮图标全部改用 `public/*.png`（新增 `src/ui/ToolIcon.tsx`）——用 **CSS mask 只取 PNG 的 alpha 通道**当形状、`background-color: currentColor` 上色，于是**原始颜色/灰度不一**（近乎纯黑/偏灰/实心填充）的图标在界面里只剩一个颜色，且与**同一按钮的文字标签同色**；顶栏按钮文字色同时由次级灰 `--jp-text-secondary` 提到正文主色 `--jp-text-primary`（图标与文字一起更显眼）；覆盖菜单/编码(文件)/左右拆分(收起)/上下拆分(收起旋转90°)/预览(查看)/排版/试听(播放)/设置/导出/折行/输入条(键盘)/字体/支持(爱心) + 下拉箭头(下)/更多/播放/暂停/停止；`public/sw.js` 把这 16 个图标**逐个非致命预热**（不并进 `PRECACHE`，避免 addAll 任一失败拖垮 SW 安装 → E-2026-140）。**adj409** 试听新增**暂停/继续**：播放键改开关（播放中显示暂停.png/「暂停」，暂停后显示播放.png/「继续」），点击后**焦点留在按钮**故**空格即可暂停/继续**；时间轴换算抽成纯函数 `src/playback/playbackTimeline.ts` 的 `shiftEventsFrom`（后端按 setTimeout 排程、没有 ctx 级暂停可借，只能撤掉重排；两个时钟分离使高亮与色块轨道一行未改），准备期不用 `disabled`（会丢焦点）改 `aria-busy`。smoke 新增 9 条 adj409 断言，失败项 17 == 基线；无头 Chrome 实测图标色==按钮色==标签色（17 项全真）、真鼠标点击后焦点仍在播放键、真实空格键确实触发 click。**遗留**：音色库 CDN 在本沙箱不可达，音频链路未能端到端实测。**adj410**（后续提交）图标图集由 200×200 换为 32×32 解决缩放模糊，导出按钮改用 `下载.png` |
| v0.17.1 | 2026-09-15 | 发布 v0.17.1（**PDF 直接下载 + 附点减时线**，PATCH 级）：**adj411** ①导出 PDF 不再开新窗口——零依赖自建 PDF 字节流（每页 SVG 栅格化为 JPEG、以 `/DCTDecode` 原样内嵌），**直接下载 .pdf**，彻底消除「浏览器拦截了新窗口，请允许弹窗后重试」（E-2026-145）；②修同批发现的**流数据错位 1 字节**（`stream` 后多一个换行 → `/Length` 少 1 → JPEG 的 EOI 被截断，而结构自检当时全绿，因断言只查"含 FFD8"）→ 拆 `beginStreamObj/endStreamObj` + 断言升级为精确位置与逐字节比对；③附点音符的**减时线延伸到附点之下**（`1//2/.` 里 2 的线原本止于数字右缘），附点几何抽成 `dotCenterXOf/dotRightEdgeOf` 与附点绘制共用。**adj412** PDF 清晰度跟随导出对话框「图片清晰度」（2x/4x/6x，与 PNG/JPG 同档）。**矢量 PDF 评估结论：不做**——jspdf+svg2pdf 实测 ≈398 KB 原始/≈125 KB gzip，但 svg2pdf 要求非 ASCII 字符自行注册字体，本谱标题歌词全中文需额外解决 CJK 字体嵌入（数 MB），大头在字体不在库。smoke 新增 21 条 adj411 断言（两种布局各跑一遍），失败项 17 == 基线；无头 Chrome 真实导出核对 2x/4x 内嵌尺寸与 JPEG 首尾字节。**涉及引擎改动**（`render/index.ts` 减时线几何）→ 已同步 obsidian-ijipu/vendor/engine 并发 0.7.3 |
| v0.18.0 | 2026-09-16 | 发布 v0.18.0（**设置与帮助大修 + 短曲排版规则 + 打开示例**，MINOR 级）：**adj418** 设置对话框八页签收敛为五个（全局/主题/音色库/**谱面**/字体）、宽度固定 `min(700px,100%)` + 页签等分 + `Modal.fill`（head/底栏固定、仅中段滚动 → 三个按钮恒定可见）、「页面设置」改名「设置」、左右边距默认 40→50（E-2026-148/149）；**adj419** 行首命令改小写书写并补 `Y:`/`S:`、去掉无效 `H`（E-2026-150），关于对话框四段移入操作手册，谱面页签「音符布局」组移到「间距」下；**adj420** 输入条倚音键只插骨架 `[]`/`[h]` 且光标停在 `]` 前、移除 `(1)` 虚音符键（E-2026-151）；**adj421** 单行曲部少于 4 小节按 4 槽预分占宽（每小节一槽、槽内摊开、本体超槽则自然宽；两种布局都实现）；**adj422** 「脚本语法」与「脚本规则说明」合并为《脚本语法说明》（四部分：五分钟上手/语法参考/组合示例集/报错排查）、JPS-SPEC 改占位、HTML 页删除、帮助渲染器补表格与引用块（E-2026-152）、菜单取消「编辑」子菜单（撤销/重做快捷键保留）、音色库 7 行、操作手册重排；**adj423** 新增「文件 → 打开示例」（`public/samples/*.jps` 构建期 glob 自动发现，收录《茉莉花》《送别》）、取消「格式化脚本」菜单项、修文档表格 `\|` 转义被切分（E-2026-153）。smoke 新增 60+ 条断言（文档示例 14 段零错误零告警、19 张文档表格列数一致、输入条骨架、小节槽规则两种布局各 8 条…），失败项 17 == 基线；`tsc -b`/`build`/`lint` 通过；无头 Chrome 实测 141 项全绿；`npx tauri build` + `check:installer` 全绿。**涉及引擎改动**（`settings.ts`/`types.ts`/`layout/index.ts`）→ 已同步 obsidian-ijipu/vendor/engine 并发 0.7.5 |
| v0.18.1 | 2026-09-16 | 发布 v0.18.1（**菜单分组重排**，PATCH 级）：**adj424** 汉堡菜单「文件」组顺序改为 新建→打开→**打开示例**（紧跟打开、无分隔线）→粘贴源码导入→保存→另存为→试听播放→导出；「设置」从「文件」组拆出**单独成一组**（仅一项「设置…」）；原「播放」分组随之取消（仅试听一项，已挪走；音色库入口仍在「设置 → 音色库」标签内）。顶栏工具按钮顺序保持原样（排版→试听→导出→设置），与菜单内的「试听-导出-设置」顺序对齐。`tsc -b` + `npm run build` 通过；**不涉及引擎改动**，`obsidian-ijipu/vendor/engine` 不同步 |
| v0.21.0 | 2026-09-16 | 发布 v0.21.0（**临时段打磨：行间距可调 + 色块全面校准 + 多声部音色修复**，MINOR 级，共 21 项 adj428–adj452）：**新增** `segmentRowGap.{bz,dsb}` 临时段上下层纵向间距（页面设置「临时段」+ 预览紫色段层虚线可拖，缺省 22、钳制 10–80，`adj428`）；`PlayheadSeg.gain` 力度变量贯通「事件 → 拍段 → 轨道」，为后续**强弱单/力度记号**预留（`adj451`）；色块按曲行几何**动态定界**（多声部按声部中线、临时段按上下层中线；`{dsb}` 上下严格等高）与**按音色/声部角色着色**（`adj429/429b/432`）。**变更**：试听「音色」默认回到「自动」且改为**会话级**（不再落盘、本次运行内记住），选定具体音色时提示「会覆盖谱面 Y:」（`adj448`）；GM 128 音色表收敛为唯一来源 `playback/gmVoices.ts`，`Y:`/`@乐器名@` 可用音色库列表里的任意名称与编号（此前 **128 个名称有 101 个解析不到本音色**，如弦乐合奏1/2 都成 48、萨克斯族都成 65；注意 `Y: 电钢琴` 由 4 改为按列表口径 **2**）（`adj447`）；曲内 `@乐器名@` 优先于全局试听音色（`adj434`）。**修复**：`{bz}`/`{dsb}` 段内音符**光标联动双向失效**（段内音不在主旋律音符流里 + 旧 id 跨距仅 10 会撞号 ⇒ 独立 id 命名空间 + 按源码次序编号，`adj445`）；**多声部试听只响一种音色**两条根因（MIDI 通道按乐器族分配 → 同族音色撞同一通道，实测 17 事件错 11 ⇒ 一个音色独占一个通道 `GmChannelAllocator`，`adj446`；音色名解析不完整，`adj447`）；**多组多声部时色块跑到第一组位置**（`voiceBlockByNoteIdx` 只按声部号取本页第一个块 ⇒ 改为按行归属匹配，`adj449`）；段层与主旋律**逐拍对齐**（`adj433/437/441`，`beatToX` 音符内插值 + `segScale` 只在真越线时压缩 + 子拍宽之和 = 字距跨度）；段内内容/末音丢失（`adj430/444`）；段层色块左右边界（段内小节线为硬上限、`bz` 以前后小节线为界、`dsb` 以大括号为界、首块从起始音符开始、末音延伸到段层右界，`adj438/439/440/442`）；`&zkh` 位置取段内第一个发声音（`adj431`）；倚音继承主音符音色（`adj436`）；重叠区按多声部算占宽（`adj435`）；**桌面端重装后仍显示旧界面**（Tauri v2 的 `tauri.localhost` 是安全上下文、SW 能注册并返回旧缓存 ⇒ 桌面端不注册 SW + 注销旧 SW/清缓存，`adj443`）。引擎改动 13 文件（新增 `playback/channels.ts`、`playback/gmVoices.ts`）→ 已同步 `obsidian-ijipu/vendor/engine`（32 文件 0 差异）并发插件 **0.9.0**；引擎包版本 0.11.0 → **0.12.0**。smoke 断言大幅扩充（每期均有、含两套布局），失败项 18 == 基线；`tsc -b` + `npm run build` 通过；`preview:render` 7 谱 errors=0 |
| v0.20.0 | 2026-09-16 | 发布 v0.20.0（**临时伴奏 `{bz}` / 临时多声部 `{dsb}`**，MINOR 级）：**adj427** 新增写在曲行中间的叠加段——段**不占主旋律拍位**，与主旋律同拍位对齐（`bz` 段画在主旋律上方；`dsb` 段为主声部、包络内主旋律为第二声部，两层上下叠放并用大花括号括住）；括号可自动（段内不写）或显式（`&zkh`/`&ykh`，预留占宽）；**试听按两个声部同时演奏**——`bz` 上层=伴奏声部（第 2 可用音色=`Y[1]` 或「手风琴」、力度 0.75）、下层=主声部不变；`dsb` 上层=主声部、下层=第二声部（同上音色与力度）；新增 `PlayEvent.gain` 力度倍率字段（本次用于伴奏 0.75，为后续力度记号预留）；**播放色块按音色着色**、重叠区上下两层各一个色块同步移动。修复共 11 条（`E-2026-154`~`E-2026-164`）：拍位→x 只锚定音符（小节线右偏 15.7px）、段层括号纵向基准高 0.3×字号且无间距、大括号外扩/轮廓控制点基准、**段边界加权致段内每拍占宽 2.35 倍**（用户实测）、段内 token 位置未偏移、**段层同 x 污染 adj320 色块右边界 → 色块铺满整小节**（用户报）、**「试听音色」全局覆盖压掉第二声部音色**（用户报）、右括号压小节线、`startNoteId` 误判段层音符、以及 PowerShell `Set-Content` 改源码致 UTF-8 中文重编码报废。引擎新增 `layout/segments.ts` + 8 文件改动 → 同步 obsidian-ijipu/vendor/engine 并发 0.8.0。smoke 新增 100+ 条断言（token 8 + 包络 30 + 出图 26 + 括号几何 14 + 每拍均匀 5 + 试听 22 + 文档 2 段），失败项 18 == 基线；`tsc -b`/`build` 通过；`preview:render` 7 谱 errors=0 |
| v0.19.0 | 2026-09-16 | 发布 v0.19.0（**顶栏浅深模式快捷切换 + 预览暗纸**，MINOR 级）：**adj426** ①顶栏「支持作者」按钮前新增**浅深模式三状态按钮**（不参与工具条折叠、常驻），点击循环 `自动→浅色→深色→自动`，图标与文字随当前档位切换（自动主题/浅色主题/深色主题 三个 png 图标收录到 `public/icons/`），与「设置 → 主题 → 浅深模式」三个按钮共用 `uiStore.themeMode`、状态实时双向同步；②设置面板「浅深模式」三个按钮改用 ToolIcon，与顶栏视觉一致。**adj425** 预览区在**所有主题的深色模式**下加 `filter: invert(1)`，整页反相——白纸黑字 → 黑纸浅字，与深色编辑区柔和过渡；浅色模式保持白纸黑字不变。**底层约束**：引擎 SVG 内 89 处 `fill="#1b1b1b"` 写死墨色 + 第 1446 行 `<rect fill="#ffffff"/>` 写死白底，`--jp-paper-bg/ink` CSS 变量不生效，filter 是零引擎改动的快速适配；**正式落地**仍需改引擎（参数化底色与墨色，或 SVG 渲染前注入主题色）。`tsc -b` + `npm run build` 通过；**不涉及引擎改动**，`obsidian-ijipu/vendor/engine` 不同步 |
| v0.17.2 | 2026-09-15 | 发布 v0.17.2（**桌面音源真正随包 + 顶栏按钮组只留外框 + 模板与 px 取整**，PATCH 级）：**adj416** 桌面「内置音源」此前**从未真正成立**——SF2 只被复制到安装包**旁边**、而程序找的是 `<安装目录>\soundfonts\` 子目录，于是每次试听都退回**国内不可达**的 GitHub raw 直链并先弹「正在后台下载（约30MB）」（E-2026-146）：现在 `bundle.resources` 把 `resources/soundfonts/generaluser_gs.sf2` 映射到**安装目录根**、Rust 按「安装目录根 → `soundfonts/` 子目录」查找并新增 `sf_soundfont_builtin_path` 只做存在性探测、读音源改返回 `tauri::ipc::Response`（raw body，30MB 不再走 JSON 数组），前端来源收敛为 `resolveHqBank`（缓存 → 内置 → 远端，**只有下载结果写 IndexedDB**），试听/音色库/导出三处**探测到内置即不显示下载提示**；`check:installer` 增 `generaluser_gs.sf2` 必需项与源体积校验。**adj413** 新建模板分隔注释恰好 30 字符 + 正文后 5 空行 + 尾部页面设置区块；**px 值一律整数**（`roundPxIntegers` 读写两端 + 拖拽 + 对话框步长）。**adj414** 顶栏「操作」「设置」两组去背景、保留外框，悬停按钮才高亮。**adj415** 顶栏「设置」与「导出」位置对调。**adj417** 图标资源集中到 `public/icons/`（此前 60 多个 png 平铺 public 根 → dist 根目录一堆图片），只保留实际用到的 16 个按钮图标 + Logo/PWA 图标/赞赏码（删掉 47 个未用图标，仍需时从 git 历史取回），并修好 `sw.js` 预热清单漂移（漏「暂停」「下载」）、让清单与 `src/ui/toolIcons.ts` 单一来源对齐（E-2026-147）。smoke 新增 56 条断言（adj413 22 + adj416 25 + adj417 9）全绿，失败项 17 == 基线；`tsc -b`/`build`/`lint` 通过；`npx tauri build` + `check:installer` 全绿，安装包 4.4 MB → **30.4 MB**（随包音源）；无头 Chrome 真实 `dist/` A/B 对照 12 条全绿（假 Tauri → 显示内置提示且不发读取命令；无 Tauri → 照旧显示下载提示），另核对 dist 根目录无 png、16 个图标 URL 全 200。**涉及引擎改动**（`settings.ts` 加 `roundPxIntegers`）→ 已同步 obsidian-ijipu/vendor/engine 并发 0.7.4 |
| v0.22.0 | 2026-09-16 | 发布 v0.22.0（**顶栏手机端不再丢按钮 + 设置/试听口径收口 + 控制台与测试基线清零**，MINOR 级，共 5 项 adj453–adj457）：**adj453** 顶栏右侧「浅深三状态 / 支持作者 / 更多」移出带 `overflow:hidden` 的工具条、直接挂顶栏并 `flex-shrink:0`，工具条改 `flex-shrink:1` 作安全阀；重写折叠宽度预算（常驻项含外边距实测 + 间距按实际在流子项数 + 恒定预留「更多」槽位用隐形副本取实测宽），修掉手机上「更多」只露一半 / 整颗看不到（用户报）；测量容器改为与真实工具条同组结构，并修掉包裹层 `display:contents`「无盒子 → 宽度恒 0」的坑。**adj454** 页面设置分层口径定稿并写进文档：读取 = 源码 `# jps-config` > 本机缓存 > 代码默认（`mergeJpsConfig` 展开顺序即优先级），**写回只固化用户本次改动**（新增 `mergeConfigEdits` + `setPageConfig(cfg, persist, base?)`，缓存来源的值不再被写进谱面）、撤销/重做改走 `resolveConfig`（补上「字体覆盖」层）、新增设置行校验 `inspectJpsConfig`（坏 JSON / 值类型错 / 键拼错 / 行缩进 → 带行号告警接入问题条，坏项忽略并回退下一层）。**adj455** 试听「指定音色 = 全篇统一音色」（`buildPlaySequence` 新增第 6 参数 `instrumentOverride`，覆盖主声部 / 伴奏与第二声部 / 曲内 `@乐器名@`；设在**序列层**以免音频与色块各说各话）+ 引擎新增 `gmVoiceRef` / `countScoreInstrumentSwitches` + 界面「谱面里有 N 处 `@` 已被统一覆盖」提示；「自动」档完全按谱面路由不变。**adj456** 修控制台 `flushSync was called from inside a lifecycle method`（`EditorPane` 测量 effect 改 `useLayoutEffect` + 初次测量不用 flushSync，ResizeObserver 回调保留 flushSync）；**smoke「18 条预存失败基线」逐条分类清零**（1 条真 bug = `sw.js` 漏 3 个主题图标 → PWA 离线时浅深按钮空白；17 条过时断言 = 乐器 id→名称、默认 BPM 60→70、调号角标机制改 `tspan dx` + 3/4 字号 + 0.35 基线），`npm run smoke` 首次全绿并把「必须 0 失败」写进 `docs/VERSIONING.md`；删除失效 CSS（`.footer-settings`/`.footer-btn*`/`.footer-toggle`/`.footer-zoom*`/`.editor-font-split-btn`）、修正 `inferBpm` 头注释（90→70）。**adj457** 播放/停止图标换新图 + 19 个按钮图标像素色统一 `#000000`（逐像素保留 alpha）+ `sw.js` 图标预热改 `cache:'reload'`（换图后不再被旧 HTTP 缓存挡住）+ 导出仍按谱面音色（新增断言守住三条导出路径不传覆盖）。引擎包 0.12.0 → 0.13.0；排错条目见 `E-2026-193`~`E-2026-196` |


| v0.23.0 | 2026-09-17 | 发布 v0.23.0（**全面换用用户设计的图标集**，MINOR 级，1 项 adj458）：**顶栏**视图组「编码」→`编码.png`、「预览」→`预览.png`、拆分两方向改用专属图标（`左右.png`/`上下.png`）、「导出」→`导出.png`、「折行」换新图、「输入条」→`输入.png`；**不再靠"借用+旋转"复用图标**（此前五处按钮用着别的语义的图标：拆分共用「收起」并 `rotate(90)`、导出借「下载」、编码借「文件」、预览借「查看」、输入条借「键盘」），`ToolIcon` 的 `rotate` 参数随之删除，被替换的 `收起/下载/文件/查看/键盘` 五个图标从清单与磁盘一并清除。**谱面修饰符改用用户提供的矢量图（引擎改动）**：`&sby`/`&xby`/`&sby+`/`&xby+`（波音）、`&shy`/`&xhy`（滑音）、`&yc`（延长记号）七枚从手绘矢量近似改为**内联用户 SVG 路径**（`<g transform>`），保住无损矢量；新增生成器 `scripts/gen-modifier-glyphs.mjs`（含无头 Chrome `getBBox()` 量紧包围盒）与生成物 `engine/render/modifierGlyphs.ts`；语法与语义零变化、尺寸沿用既有占位（波音 9s/13.5s、延长记号 9.6s、滑音按高度贴合）故**排版不位移**。**插件**工具条图标改用应用同一批 PNG（`vendor/icons/` 逐字节一致、构建期内联成 data URI，发布物仍是自包含三文件）、上色改 CSS mask + `currentColor`（随主题/选中态）。**修复 6 条**（`E-2026-197`/`E-2026-198`）：①新一批图标又混进灰值、`adj457`「统一纯黑」口径当场漂移（`菜单 #323232`/`页宽 #7d7d7d`/`导出 #303030`/`预览` AA 边缘 31 色/`折行 #333~#555`/`输入 #030000~#080000`）——根因是"形状在 alpha、颜色由 CSS mask 决定"⇒**屏幕上看不出差别，而 adj457 只留了一句口径、没有断言守着**；已归一化为纯黑并**逐像素保留 alpha**，真正的解法是新增的 smoke PNG 像素断言（**归一化前先跑一次即可复现，它当场精确列出那三个灰图标**）；②iconfont SVG 不能按 `viewBox` 直接定位（画面留白很大且各图不同，上波音墨迹只占 `x 36..988/y 327..677`）→ 改按 Chrome `getBBox()` 紧包围盒换算；③滑音按"旧弧线包围盒"等比内缩明显偏小（箭头只有数字高 1/3）→ 改按高度贴合 + 左缘锚数字右缘（居中摆会压字 0.8px）；④`延长记号.svg` 自带 `fill="#686868"` 会盖住外层统一墨色 → 生成器剥掉非 `none` 的 `fill`（保留描边语义）；⑤⑥八条断言钉在被替换掉的旧画法上（`adj115`/`adj116` 波音锯齿粗细与下波音竖线、`adj109` 的 yc 圆点半圆弧与滑音弧线 Q）→ 按当前设计改写，完整口径另立 smoke `[108]` 共 31 条。**验证**：smoke 新增 `[103]` 图标绑定表驱动 + `[108]` 修饰符 31 条断言，`npm run smoke` **ALL SMOKE TESTS PASSED ✅（0 失败）**；`tsc -b` + `lint` 0 error + `npm run build` 通过；`preview:render` **7 谱 errors=0**；无头 Chrome 3 倍整页 + 9 倍局部截图逐符号肉眼核对（波音四型齿数/竖线、滑音上下箭头、延长记号「弧+点」）；`vendor/engine` 同步后 **33 文件逐文件哈希一致**，插件 `tsc` + `build` 通过、smoke **149 passed, 0 failed**。引擎包 0.13.0 → **0.13.1**；插件 0.9.1 → **0.10.0** |

| v0.27.2 | 2026-09-18 | 发布 v0.27.2（**dock 高度：外壳实测 / 告警滚动修复 / 建议高度去污染**，PATCH 级，共 4 项 adj521–adj524）：**① 手机端最小档比页签栏还矮（adj521）**——外壳高度写死 `5+38=43px`，而抓手由 CSS 变量决定、`@media (pointer: coarse)`（手机/平板）下 `--jp-resize-h` 是 **14px** ⇒ 真实外壳 **52px**，最小档装不下"抓手+页签栏"、页签栏被 `overflow:hidden` 裁掉 9px（用户推测"可能是放大的调整条高度"完全正确）；改为**运行时实测** `.tool-dock-resize + .tool-dock-tabs`（`ResizeObserver` 盯这两个元素 + `window.resize` 兜底），`clampH`/`defaultH`/`settingsDefaultH`/三档取值/`aria-valuemin` 一律改用实测 `chromeH`（`CHROME_H` 仅首帧兜底）、删除 `MIN_DOCK_H`，上限补 `Math.max(maxH(), chromeH)` 防反向钳制。**② 告警展开「正确写法」后无滚动条、内容不可见（adj522）**——adj510 关掉了内容区滚动却**没给受限高度链**（告警 pane 是普通 block、`.problem-panel` 高度 auto）⇒ 列表 `overflow-y:auto` 永不触发、超出内容被裁（展开内容根本看不到，比缺滚动条更严重）；修法：告警 pane 改弹性列容器、列表 `flex: 1 1 auto → 0 1 auto`（可收缩才出滚动条，且 `scrollHeight` 恒为内容高）、头部 `flex: 0 0 auto`、**删除**"关掉内容区滚动"的覆盖恢复 `auto` 兜底（失效模式由"丢内容"降级为"多一条滚动条"）、告警自然高改由「头部 + 列表 `scrollHeight`」量取。**③ 建议高度随"从哪一档切过来"而变（adj523）**——`pane.scrollHeight === max(内容高, clientHeight)` 而 pane 被拉伸到 dock 高度 ⇒ 从"最大"切"建议"量到的是**拉伸后的可用高度**（≈417px ⇒ 建议档 452px）、从"最小"切才对；修法：pane 改**按内容取高**（`flex: 0 0 auto`）使测量与 dock 高度解耦，设置/告警两条需填满 dock 的 pane 各自显式覆盖 `1 1 auto`（并修正注释里"`pane.scrollHeight` 不受当前可视高度影响"这句**错误论断**——它掩盖了本 bug 两个版本）。**④ 告警建议档 2 行 → 4 行（adj524，用户要求）**——依据是底栏有了高度档位按钮，"默认多给一点"不再挤占编辑区；0/1/2/3 条仍按内容自然高收缩，>4 条才滚动。**用户确认**：设置/试听/导出/关于的建议高度**继续按实测自动适配**（不改为一组写死常量）。**排错条目** `E-2026-224`（手机外壳高度） / `E-2026-225`（告警滚动高度链） / `E-2026-226`（测量被当前高度污染）。**验证**：两个镜像算式的脚本（跑完即删）分别复现"旧：最小 43 < 手机外壳 52（裁 9px）"与"旧：从最小切=157 / 从最大切=452"，新实现两个方向一致且等于"内容刚好装下"；6 组视口×面板组合下"三档严格有序 + 最小档 ≥ 外壳"全部通过；smoke 新增 6 条断言（高度链三件套 / 不再关内容区滚动 / 自然高量法 / pane 契约 / 4 行常量）；`tsc -b` + `lint`（0 error，27 warnings == 基线）+ `npm run build` + `npm run smoke` **ALL SMOKE TESTS PASSED ✅（0 失败）**。**不涉及引擎改动**，`obsidian-ijipu/vendor/engine` 不同步 |
| v0.27.1 | 2026-09-18 | 发布 v0.27.1（**dock 高度：拖拽修复 + 档位切换按钮**，PATCH 级，共 3 项 adj518–adj520）：**① 修复"底栏除设置外其它页签都调不动高度"（adj518）**——高度取值 `baseH = fitKeys ? forPanel(dockPanel) : (heights[dockPanel] ?? forPanel(dockPanel))` 在 AUTO_FIT 面板（告警/试听/导出/关于）上**整条绕过**用户拖拽写入的 `heights[dockPanel]` ⇒ 拖拽值写了却从不被读；改为 `baseH = heights[dockPanel] ?? forPanel(dockPanel)`（用户值优先，AUTO_FIT 只给初始默认），并删除"切换面板时清掉 AUTO_FIT 拖拽值"的 effect（保留"重新打开 dock 才清"）。**② 新增底栏高度档位切换按钮（adj519/adj520）**——关闭按钮左侧一个按钮，三档循环 `建议（上.png）→ 最大（下.png）→ 建议（下.png）→ 最小（上.png）→ 建议（上.png）`，图标方向 = "点一下会往哪走"；三档 = `maxH()` / "刚好装下内容" / `MIN_DOCK_H = CHROME_H`（43px 只留外壳）；循环用模块级 `SIZE_PHASES` **4 相位表 + `sizePhase` 状态**（序列里"建议"出现两次且两次下一步相反，只记"当前档"推不出下一步）；相位同步**只在手动路径**（拖拽/键盘）拨，不用 effect 监听高度（否则与点击互相触发会卡死）；新增 `toolIcons.ts` 的 `up: '上'` 并同步 `public/sw.js` 预热清单；图标资源 `public/icons/上.png`（用户提供，32×32 RGBA）随批入库。**③ 修复"档位只能在两段里切换"（adj520）**——三处叠加：循环状态机三分支里 `next` **从未被赋 `'min'`**（"最小"档在代码上不存在）；`clampH` 下限（普通 95 / 设置 133 / 告警 <2 条时 **0**）把"最小"钳回去或干脆藏掉整个 dock；设置面板"建议"取 `forPanel('settings')` 而它宽屏下**等于 `maxH()`**（adj509 遗留）⇒ 三档两档重合。修法：`min` 改物理下限 `MIN_DOCK_H`、`clampH` 下限统一为它并**删除 `MIN_H`/`MIN_H_SETTINGS`/`minFor()`/`noProblems`**（同一份"能到多小"原按面板给出 0/95/133 三种答案，且与 ARIA 不一致）、设置"建议"改 `settingsDefaultH`（6 行 ≈235px）、再夹 `(min+8, max−8)` 把"三档两两不同"变成结构性保证、`aria-valuemin` 与 `clampH` 共用同一常量。**排错条目** `E-2026-222`（拖拽不生效 + 两段循环）/ `E-2026-223`（新增图标漏同步 sw.js）。**验证**：独立小脚本模拟 8 次点击与用户对照表**逐项一致**并断言 `43 < 建议 < 460`（跑完即删）；`tsc -b` + `lint`（0 error，27 warnings == 基线）+ `npm run build` + `npm run smoke` **ALL SMOKE TESTS PASSED ✅（0 失败）**。**不涉及引擎改动**，`obsidian-ijipu/vendor/engine` 不同步 |
| v0.27.0 | 2026-09-18 | 发布 v0.27.0（**dock 二次打磨：底栏页签样式对齐、告警自适应、AUTO_FIT 全覆盖**，MINOR 级，共 12+ 项 adj509–adj517）：**① 底栏页签样式全面对齐顶栏按钮（adj509/511/514）**——页签换成 `.topbar-btn` 同源（7px 圆角、同款边框/字号/padding 5×10 + 12px + 同款 hover 三联动）；页签栏高度固定 38px（不再随拖拽变高，避免"调整线拖动时页签跟着变高"的视觉跳动）；页签图标尺寸与顶栏按钮**一致**（`ToolIcon` 默认 size=16；此前 size=14 比顶栏小 2px "偏虚"，用户报），smoke 断言由 `size={14}` 改为正则 `<ToolIcon name={t.icon} />`、把"对齐顶栏 16px"写进断言；设置面板底部按钮（恢复默认 / 保存设置）同样参照顶栏 —— 恢复默认 = 普通顶栏按钮、保存设置 = `.topbar-btn.active-guide` 同款（实心背景板 + 强调色文字 + 强调色边框），特异性 `.tool-dock .pcfg-foot > button.btn`（0,3,1）严格压过全局 `.btn`（0,1,0）只影响设置面板底部两按钮。**② 音色库「指定音色」对话框（adj509）**——128 种 GM 音色列表从 `SoundBankPanel` 内嵌展开拆出为独立浮窗 `VoicePickerDialog`；底栏音色库面板改为「音源状态 / 音色启用 / 收藏与音色文件 / 说明」四块小节排版，「全选 / 指定音色 / 全消」三个按钮横排（指定音色按钮用 accent 色突出）；对话框按 GM 14 大类分组，含「全选/全消/反选/搜索」快捷操作与每组的「选本组/消本组」；`ModalKind` 新增 `'voicePicker'`。**③ dock AUTO_FIT 全覆盖告警（adj510）**——与试听/导出/关于同源，**始终**按"能显示全内容的最小高度"定 dock 高度：0 条告警 = `dock-empty` 一行文字、1 条 = 头 + 1 行、≥ 2 条 = cap 在头 + 最多 2 行的可见高度且面板内 `problems-list` 自身滚动（`.tool-dock-body:has(.problem-panel) { overflow-y: hidden }` 关闭 body 滚动避免双滚动条）；smoke 断言 AUTO_FIT = `['problems','tryout','export','about']`。**④ 无告警/少于 2 条告警时 dock 按最小高度（adj513/516）**——`clampH` 新增第三参数 `noProblems`：告警面板在 `noProblems=true` 时下限改为 0（不再被 `MIN_H=95` 硬撑 4 行），`noProblems = problemCount < 2`（扩到 1 条告警也按内容自然高），拖拽/键盘 bump 同步透传。**⑤ 主题配色列表流式单选框（adj509）**——`.theme-list` 从 `flex-direction: column` 改为 `flex-wrap: wrap`，`<input type="radio" name="ijipu-theme">` 与全局页签复选项同款；选中态 `:has(input:checked)` 高亮。**⑥ 告警三角箭头统一 `▸` + `transform: rotate(90deg)` + 字号调到 18px（adj512/515/516/517）**——告别 `▸`/`▾` 两个字符在不同字体下尺寸不一致的视觉断层，按用户连续反馈逐步把 glyph 从 10 → 14 → 16 → 18、容器从 16 → 22。**⑦ 修复**：设置面板左栏页签在宽屏下"滚一档跳 3 个、第三个'音色库'一直显示不到"——dock 上限从 `min(50vh,420px)` 抬到 `min(55vh,460px)`、宽屏默认高度直接取 `maxH()`，narrow 时仍走 `settingsDefaultH` 避免矮屏默认过高。**排错条目** E-2026-217（告警最小高度） / E-2026-218（三角箭头） / E-2026-219（页签图标尺寸） / E-2026-220（主题/音色库重构） / E-2026-221（设置按钮样式）。`tsc -b` + `npm run build` + `npm run smoke` **ALL SMOKE TESTS PASSED ✅（0 失败）**；`npm run lint` 0 error。**不涉及引擎改动**，`obsidian-ijipu/vendor/engine` 不同步 |

| v0.26.0 | 2026-09-18 | 发布 v0.26.0（**dock 全套调整 / 关于栏迁入 / 倚音+波音演奏时值落地**，MINOR 级，共 15+ 项 adj487–adj508）：**① 底栏 dock 全套调整（adj487-adj491, adj495-adj501，应用 + 引擎）**——五个面板（告警/试听/导出/设置/关于）全部 `React.lazy` ⇒ 入口 chunk 418KB→248KB（**−41%**）、245KB SpessaSynth WASM 也彻底离开启动路径（用户面"页面拖慢"+"首次打开慢"两条反馈一起解决）；页签栏**移到 dock 底部**（flex `order` 抓手0/内容1/页签2，DOM 顺序不变 ⇒ 读屏/Tab 序不受影响；dock 底边钉在窗口底部、顶边随拖拽与各面板默认高度上下移动，页签跟在顶边就得"每次上下找"）；**dock 调整线与分屏线统一**：共用 `--jp-resize-h` 厚度 token + `cursor: row-resize`（用户报"鼠标形状不统一"实为 `ns-resize` vs `row-resize` 在某些渲染下的差异 + 窄屏只把分屏线加粗到 8px 的特例导致粗细也不一致；token 化后改一处全同步）；`adj491` 还原 `if (!dockOpen) return null` 守卫（adj487 重构时误删 ⇒ ✕ 推出可视区外）+ 窄屏页签栏 `overflow-x:auto + flex:0 0 auto` 收 ✕ 回 dock 内；`&bc` 修正为"保持音"（adj496，原补全/文档都误作"波音（横线）"，与渲染代码矛盾）。**② 关于对话框迁入 dock（adj492/adj500/adj501）**——去掉弹窗、改在 dock 内显示品牌块 + 正文 + 署名 + 版本 + 支持作者；按用户口径把"标题/版本/'用代码的严谨…'/支持作者"四行居中、图标与标题**贴合成一组居中**（`.about-brand { justify-content: center }` + 文字块按内容定宽）；删 `modal === 'about'` 渲染 + 顶栏菜单关于 `openModal('about')` → `toggleDock('about')`。**③ 波音（mordent）演奏时值（adj502-adj504，引擎）**——此前只画不奏（render 读 `symbols`，playback/sequence 不读 ⇒ 整库只有 `&hx` 读符号）；新增 `playback/ornaments.ts` 纯函数模块（`mordentOf/mordentShortMs/neighborDegree/mordentPlan`，已从引擎入口导出，插件 vendor 可直接复用）；规则：每个短音 = `clamp(P/8, 45, 110)ms`（单波音 ≈ P/4、复波音 ≈ P/2，两者波动速度一致）、**不抢太多**（装饰最多 P/2 ⇒ 主音至少留一半；极短音符上复波音**自动降级为单波音**）、邻音取**调内二度不继承主音临时变音**（7 上翻八度、1 下翻八度）；连音合并：**带波音音符自己不能并进前一个**（必须重起奏并波动）、**后一个同音可并进它**（并的是"按住的主音"，波动在开头不受影响）；**顺带修了 tokenizer 潜在 bug**：`3[2/]&sby`（`&` 写在倚音括号**之后**）时 `sby` 此前丢成独立 decoration、不挂音符 symbols ⇒ 演奏端读不到；`graceGroupBeats` 解析完括号后**续接依附音符的 `&` 编码**（`&zkh/&ykh/&hx` 仍独立化）。**④ 倚音演奏时值按用户规范完整落地（adj505/adj507/adj508，引擎）**——长倚音 = 本体 ×（附点 2/3、否则 1/2），借引擎自己的 `tokenDuration` 把 `augmentCount` 抹零（**增时线不计入**，但引擎"附点作用在含增时线整体上"的既有口径未改 ⇒ `3. -` 仍为 3 拍）；**短倚音 = 主音符因子 × 倚音因子**（adj507，用户提出"同样写 `[2/]`，主音符 1 拍还是 1/2 拍，听感完全不同"）：主音符因子（不带减时线 1、有减时线 1/2）+ 倚音因子（1 条 1/4、2 条 1/8、≥3 条 1/16 封顶）⇒ `3[2/]` 1/4 拍、`3/[2/]` 1/8 拍（后者恰是前者一半）；**力度分级**（adj505，用户选"只做力度区分"）：短倚音 90%、长倚音不变（逐事件 `gain` 经 `0.5 × gain` → `velocity = round(127 × gain)`，是**真力度差**不是标记）；**短前倚音总是抢在拍前**（adj508，用户要求"保证主音符总在拍点上"）：主音符保持原时值、时间从**上一个主音符**匀（**最多让出一半**安全下限）、前面没时间可借（谱首第一个音）时退回"占拍点、主音符后移"；长前倚音仍占拍点、后倚音占自己主音符尾部。**⑤ 涟音/连音合并方向性错误（adj503/adj504，用户连报两次）**——`(5/&sby 5)` 因"带波音不许被并入"一刀切 ⇒ 第二个 5 又弱响一次（**adj503**：区分两方向）；`(3/[3/5/] 3)` 同样一刀切 ⇒ 倚音后又弹了一次 3（**adj504**：前倚音可并入、前倚音在开头、合并只延长主音事件；后倚音**不可**并入、占尾部、合并会让它在延长的音里"插一嘴"）；新建 `lastBlockEvIdx`（普通音符 = 主事件、带波音 = 首个短音，合并时 `durationMs` 加在 `lastMainEvIdx`、拍段加在 `lastBlockEvIdx`）。**⑥ `dragGesture.ts`（应用，新文件）**——抽出 `beginDrag(e, handlers)` 工具，封装 Pointer Events 的 `pointerdown→pointermove→pointerup` + `setPointerCapture`，手机/触屏拖拽不再失效（之前的 `mousedown+mousemove` 在手机上不响应）。**⑦ dock 拆分条命中区放大（`adj493`）**——@media `(pointer: coarse)` 下给分隔条一个**放大的隐形命中区**（`::before` ±12px），视觉仍是 5px 细条但手指能稳定抓住；桌面体验不变。**验证**：smoke 新增/调整 ~25 项断言（`[113]/[117]/[118]/[119]` 段：`&bc` 文案、懒加载触发链、调整线光标、波音整套事件序列 + 八度回卷 + 自动降级 + 连音合并方向、倚音规范新口径 + 借用例、力度分级四向）；`tsc -b` / `lint`（0 error）/ `build` / **`smoke` ALL SMOKE TESTS PASSED ✅（0 失败）** / `preview:render`（0 错误谱）全过。引擎包 0.14.0 → **0.15.0**；插件 0.11.0 → **0.12.0**（随 vendor 同步 + 引擎行为变更需复核自身断言；具体增量由插件侧 `package.json` 与 `RELEASE-NOTES` 自述） |

| v0.25.0 | 2026-09-18 | 发布 v0.25.0（**多声部占宽元素 / 谱面自包含 / 新建模板文件化 / 底栏设置对齐**，MINOR 级，共 8 项 adj479–adj486）：**① 多声部里"无时值但有占宽"的元素（`adj479`，引擎）**——`&zkh`/`&ykh`/`&hx` 此前在多声部块内**算进拍宽却从不绘制**（写了等于没写、空位照留），滑音 `&shy`/`&xhy` 布局端完全不占宽（压到后一个数字）、附点按"总宽÷覆盖拍数"平摊导致首拍不够；改为**标记插位模型**（拍首 ⇒ 该拍前置占位、块级取各声部最大以保同拍纵向对齐；拍中 ⇒ 本体游标/时值比例取较后者）+ **滑音几何单一来源**（`slideGlyphInk`，渲染与布局共用，`slideExtraW` 计入本体宽）+ **本体宽逐拍归位**（首拍=数字槽+变音+附点+滑音墨迹、第 i 拍=第 i 条增时线、末拍=尾部倚音）+ 两条布局路径同口径；**声部间距**范围放宽为 `[-30,300]`（此前虚线拖不动负数）并在设置→谱面→间距补上入口，`computeRowGuides` 的声部序号判定下限放宽（负间距会把靠后声部行压到块顶之上）。**② 谱面自包含（`adj480`，引擎 + 应用 + 插件）**——`localStorage['ijipu.pageConfig']`「本机页面设置层」**删除**（它只对"谱面没写的项"兜底，是"复制给别人显示不一样"的唯一来源；且 `setPageConfig` 无论是否持久化都回写整份生效配置 = 上一份谱的配置），生效配置改为 **代码默认 ← 谱面**，保存即自包含、旧缓存一次性清理并提示、设置面板「固化到谱面」按钮删除；新增引擎 `configCarryover()`（列出"生效≠默认但谱面没写"的项），插件侧据此显示「未随谱携带 N 项」徽标、对话框「随谱固化（分享用）」改为差量口径（取代 `mode:'full'` 全量）、拖拽写回统一为"只写本次改动"；`docs/SYNTAX.md`（唯一对外口径）/`AGENTS.md` §七/`SETTINGS-AUDIT`/`USER-GUIDE` 同步。**③「新建」模板文件驱动（`adj481`）**：模板 = `src/samples/未命名.jps`（构建期 `?raw` 内联，放在源码目录不随产物发布），代码里不再内嵌模板（只留最小兜底）。**④ 底栏「设置」字段对齐与两处渲染缺陷（`adj482`–`adj486`）**：由"流式排列"改为**按当页最长标签对齐的等宽字段网格**（`--pcfg-label-w`/`--pcfg-field-w`/每行 `--pcfg-span` 跨格，离屏克隆探针测量，标签与字段基样式从内联搬到 CSS），修掉窄底栏 `span N` 造**隐式列**导致"标题与字段挤在同一行"、以及**主题属性挂 `.app`** 导致浅色主题下未设色文本继承深色主题浅字（实测对比度 1.18 → 15.13）；顺带完善浅深模式按钮（inline-flex 居中 + 留白 + 最小宽度）与底栏页签图标（改用顶栏同一套设计图标，告警暂无对应图仍用 `⚠`）。**验证**：`tsc -b` + `lint`（0 error，27 warnings == 基线）+ `npm run build` + `npm run smoke` **ALL SMOKE TESTS PASSED ✅（0 失败，新增 adj479/480/481/482/483/484/486 断言共 60+ 项）**；`preview:render` 7 谱 errors=0；关键 UI 项用**真实应用**（`dist` 起服务 + 同源 iframe 探针 + 无头 Chrome 截图 + 读计算样式）逐档复核。引擎包 0.13.2 → **0.14.0**；插件 0.10.1 → **0.11.0** |：新增 `src/ui/ToolDock.tsx` + `src/ui/dock/ProblemPanel.tsx`、`ExportPanel.tsx`，把原先散在**对话框**里的四块内容集中到编辑区底部**一条 dock**、**同一时间只显示一块**（标题栏 tab 互斥切换 + 右侧 `×` 显式关闭）；**入口保持原位并改为「开关」**（告警 = 状态栏告警文本，试听/导出/设置 = 顶栏按钮与菜单项）：dock 关 → 展开并切到该面板，已开且正是该面板 → 收起，已开但不是 → 只切面板。**面板状态跨切换保留**：首次激活才挂载（避免试听一进编辑器就下载音源），之后常挂载、切换仅 `hidden` 隐藏，故播放进度/导出选项/设置页签天然保留；三块仍走 `React.lazy`。**导出进行中的状态栏动态指示**：任务名写进 `uiStore.exportJob`，显示「⟳ 导出中：PDF 文档」，切走或关掉 dock 仍在、点击跳回。**告警每条「正确写法」默认收起**（行首 `▶/▾` 按需展开）。**默认高度按用途分别定义**：告警固定 5 行（`adj467`）、设置**内容区**固定 5 行且**与告警解绑**（按字段行高实测计算，窄屏另加下方按钮行 = 宽屏 203px / 窄屏 247px）、试听/导出取「能显示全内容的最小高度」（实测）；**当次拖拽按面板各自记住、重新打开才复位**（试听/导出每次打开或切换过去都重新贴合内容）。**布局**：设置 = 左竖排页签（窄屏只留图标）｜中内容**分组一行、字段依次流式排列**（标签与输入框恒同行）｜右按钮**竖排靠上固定**，窄屏「页签左通高｜右上内容、右下按钮横向」；试听 = 左内容流式 + 右按钮（宽屏横排靠右、窄屏固定宽竖排）；导出 = 清晰度与动作分两行；dock 页签固定高（顶栏 30px / 设置左栏 36px）；`Modal` 新增 `inline` 模式供 dock 复用对话框内容。**引擎修复两处**：`adj459` 跨行连音线端点弧线统一（半径同时受层级间距与两端水平距离约束，修掉音符靠近左边距时弧线偏小）；`adj460` `+`/`-` 变号断开格式化（`5"注释"++++---` → `5"注释"++++ ---`，连音线前缀 `(y…` 内不插空格）。**修复 3 条**（`E-2026-199`/`E-2026-200`）：①误删 `.modal-inline{display:contents}` 导致 dock 内设置面板在窄屏**不滚动、按钮被裁**（根因是那层成了 `display:block`，切断 `.pcfg-root` 的定高链；同时我三次自测**假绿**——手抄 CSS 且 DOM 少放这层包裹，现已改为 `<link>` 编译产物真实 CSS + 逐层对齐真实 DOM，设置面板容器**宽窄统一改 grid** 由轨道定高，不再依赖 flex 链）；②CSS **容器查询给容器自身设自定义属性**导致 `--dock-side-w`/`--dock-cell`/`--dock-btn` 分档规则**空转**（改为设在消费方后代）；③`.pane-settings{display:flex}` 与 `.tool-dock-pane[hidden]{display:none}` 特异性相同且后者靠前 → 设置内容在**所有面板**里都显示（改 `.tool-dock .tool-dock-pane[hidden]` 0,3,0）。删 `src/dialogs/ExportDialog.tsx`（重写为流式 `ExportPanel`）、`src/ui/ProblemsBar.tsx`（拆为 `ProblemPanel`）。**验证**：`tsc -b` + `lint` 0 error（27 warnings == 基线）+ `npm run build` + `npm run smoke` **ALL SMOKE TESTS PASSED ✅（0 失败）**；`preview:render` 7 谱 errors=0。引擎包 0.13.1 → **0.13.2**；插件 0.10.0 → **0.10.1** |
| v0.27.4 | 2026-09-19 | 发布 v0.27.4（**顶栏重排 + dock 档位左移 + 告警三角字符换 + 新菜单图标**，PATCH 级，共 5 项 adj530–adj533）：**① 顶栏重排成两组：功能组靠左 + 编辑设置组靠右（`adj530`）**——按用户口径——功能组（视图/排版/试听/导出/主题/设置/预览比率缩放）**靠左对齐**；编辑设置组（折行/输入条/字体/字号）与独立成组的「支持」**靠右对齐**；两组**外框包围**；原"弹性间距"div 取消（两层弹性叠加打架），改由工具条吃满剩余宽度 + 编辑设置组 `margin-left: auto`。折叠判定抽成纯算式 `src/ui/topbarFold.ts` 的 `foldKeys()`——按**可见优先级**（视图 > 支持 > 排版 > 试听 > 导出 > 主题 > 设置 > 预览比率 > 折行 > 输入条 > 字体 > 字号）从末位开始逐个收进「更多」，每收一个就把「更多」自身槽位算进预算；空组不占位、组框开销/间距全部按实测值算。组件只负责"量宽/读活值"。**② 底栏档位按钮从 ✕ 旁边移到页签栏最左端（`adj531`）**——按用户"手机上左手更顺手、也避免误按关闭"——档位与 ✕ 之间隔着整条页签区，✕ 独自留在最右端贴屏边；改 DOM 顺序而不是 `order` 反转（保持视觉 = 焦点序 = 读屏序一致）；两个按钮**仍在可滚页签区之外**（adj525 口径不变），`flex: 0 0 auto` 常驻不动。**③ 告警行首三角箭头"还是太小"（`adj532` + `adj533`，同轮两次微调）**——根因不是字号，是字符本身：原 `▸`（U+25B8 **BLACK RIGHT-POINTING *SMALL* TRIANGLE**）是"小号"变体，`canvas.measureText().actualBoundingBox*` 实测墨迹/字号 ≈ 0.4×0.33em（**18px 字号下只有 7×6px**，36px 也才 12×12）——所以 adj515/516/517 三轮调字号几乎看不出变化。换成常规实心三角 `▶`（U+25B6）：**同样 18px 字号墨迹 17×18px**（约 2.5 倍）。口径不变（仍单字符 + `rotate(90deg)`）。按用户反馈"又偏大了一点，改 3/4 大小"把字号回收到 **13.5px**（= 18 × 3/4，墨迹 12×14px）；盒子/展开列刻意不动（盒子是旋转占位 + 点击热区，等比缩会把热区一起缩小），行高实测 21→22px 因盒子基线略移（**不引入任何写死常量**，adj528 的"条数 × 单行实测"自动同步）。**④ 新菜单图标**——用户提供新版 `public/icons/菜单.png`（289→299 字节），处理方式不变（`ToolIcon` 同一套 CSS mask 上色）；仓库内仅此一份（无插件副本）；smoke `[103]` 逐图标守"纯黑 + 带 alpha"口径，`dist/icons/菜单.png` 同步更新。**排错条目** `E-2026-232`（adj530 顶栏重排的两处暗坑：视图下拉被工具条裁切 / 宽度预算子项数重排必须重新数）/ `E-2026-233`（adj531 档位按钮与 ✕ 相邻 ⇒ 手机误触）/ `E-2026-234`（adj532–533 告警三角字符选错 ⇒ 调字号治不好的根因）。**验证**：无头 Chrome + CDP **逐宽度实测 21 档**（1400→320）——每档「工具条无隐藏溢出（`scrollWidth===clientWidth`）、最右子项右缘 ≤ 视口 − 内边距、文档无横向滚动」全过；折叠序列与用户给的优先级完全一致；520/620 档确认"先图标化"后能放回更多按钮；420px 视口打开视图下拉做四角命中测试**未被裁剪**（`elementFromPoint` 命中下拉自身）；告警面板逐像素扫箭头墨迹：3×4（▸ 18px）→ 12×15（▶ 18px）→ **10×12 实心**（▶ 13.5px）。`tsc -b` + `npm run lint`（0 error，26 warnings 全在 smoke.mts 既有基线）+ `npm run build` + `npm run smoke` **ALL SMOKE TESTS PASSED ✅**（新增 `[119]` adj530 折叠算式 + 接线 20 条、adj531/533 补充共 22 条）。**不涉及引擎改动**，`obsidian-ijipu/vendor/engine` 不同步；**无新设置、无新持久化键、无新变量** |
| v0.27.5 | 2026-09-19 | 发布 v0.27.5（**界面一致性微调：按钮高度统一 + 浅深模式反色 + 调整线主题色 + 输入条撤销/重做**，PATCH 级，共 5 项 adj534–adj537）：**① 界面按钮统一高度（`adj534`）**——顶栏组内 / 输入条按键 / 试听播放停止按钮三者原分别写死 24/30/31px，高低不齐；**新增共用 token `--jp-btn-h: 24px`**（取自顶栏按钮实测 24px = padding 4+4 + 12px 字行高），三处一律 `height: var(--jp-btn-h)` 引用；顺带修 `.playback-btn` 的 `padding: 4px 14px` 一直被文件末尾 `.btn { padding: 6px 16px }` 盖掉这一潜伏 bug（声明更靠后），只设 `height` 会被 padding 顶开——现在纵向内边距清零，`height: 24px` 才真正生效。**② 设置→主题「深浅模式」选中项在浅色模式下几乎看不见（`adj535`，见 `E-2026-236`）**——选中态是「实心强调色底 + 反色字」，但字色**写死成 `#101010**`，只对深色模式成立（深色主题 `--jp-accent` 全是亮色，深字压亮底 ✓）；浅色模式强调色本来就是深色（黛蓝浅 `#0891a6`…），深字压深底 ⇒ 无头 Chrome 实测黛蓝浅色下对比度仅 **1.1:1**（等于看不见）；改为 `color: var(--jp-bg-panel)`（面板底色，两个模式下都恰是强调色反色，**随主题自动成立**，不必给 6 主题 × 2 模式各写一个字色），实测浅色 **3.74:1**、深色 **11.73:1**（与改前一致 ⇒ 深色行为不变）；顺带把文案「浅深模式」统一改为「**深浅模式**」（设置标签 / 顶栏 title·aria / 更多菜单组标题；代码注释与活文档一并更新；`docs/ERRORS-LOG.md` 的**历史条目按"不改写历史"原则保持原样**）。**③ 两条调整线加主题色（`adj536`）**——`.split-divider` 与 `.tool-dock-resize` 原底色为纯面板色、握把为灰 `--jp-text-muted`，在所有主题里都"和边框混在一起、看不出可拖"；改为**两处同一配方**：底色 `color-mix(in srgb, var(--jp-accent) 10%, var(--jp-bg-panel))`、居中握把用 `var(--jp-accent)` (opacity .55)，让"可拖区域"在视觉上自成一类；hover/按住仍是底色转满强调色 + 白握把（与之前完全一致）。**④ 输入条行首插入撤销 / 重做图标按钮（`adj537`）**——手机端不依赖 Ctrl+Z 的入口；放在**最左**（左手拇指第一落点），与后面的主键组用分隔点隔开；两个 16px 内联 SVG 图标（不走 `ToolIcon`，因为本轮没有对应的设计图；且 SVG 走 `currentColor` 自动跟随按钮文字色，不受字体区别影响——`E-2026-234` 的同类教训），空栈时 `disabled` 置灰；与其它按键一致用 `onMouseDown.preventDefault()` 保住 textarea 焦点（否则手机上点完撤销后编辑器失焦、后续按键落空）。**排错条目** `E-2026-236`（adj535 浅色模式对比度 1.1:1 的根因 / 解决 / 实测数据 / 预防：反色永不写死、颜色改动要在浅深两个模式各算一次对比度、术语改动不改写历史）。**验证**：无头 Chrome + CDP 实测三处按钮均 **24px**（顶栏组内 / 输入条按键 / 试听播放停止），输入条整条 41 → 35px；行首 DOM 顺序为「撤销 → 重做 → 分隔点 → 主键组」；空栈 `disabled`，行为 文本 173 → 编辑 179 → 点撤销 173 → 点重做 179 ✅；两条调整线：底色 `rgb(20,50,78)`（原 `#161d3a`，明显偏青蓝），握把 `rgb(0,240,255)`（强调色）✅；深浅模式选中项在页面里**用 `getComputedStyle` + WCAG 公式现算对比度**（不再靠肉眼看截图），浅色 **3.74:1**、深色 **11.73:1**；`tsc -b` / `npm run lint`（0 error，26 warnings == 基线）/ `npm run build` / `npm run smoke` **ALL SMOKE TESTS PASSED ✅**（新增 adj534–537 **13 条**断言；另**更新 2 条**钉在旧画法上的断言——adj495/499 的"握把 muted/opacity .6" 现已改为"两条线同款强调色配方"）。**不涉及引擎改动**，`obsidian-ijipu/vendor/engine` 不同步；**无新设置、无新持久化键、无新变量** |
