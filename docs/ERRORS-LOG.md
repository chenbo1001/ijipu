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

