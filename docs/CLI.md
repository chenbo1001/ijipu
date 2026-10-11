# iJipu 命令行（CLI）操作手册

> 方案与决策见 `docs/CLI-AND-COMMAND-PLAN.md`（**① 同一个 exe 带子命令 ② 位图/音频走隐藏窗口渲染
> ③ 嵌入版 RPC 默认关闭 + 仅 vault 内路径**）。
> 阶段状态：**P1 + P2 已实现**（`format` / `lint` / `info` / `render` / `batch`）；
> P3（隐藏窗口渲染 `png/jpg/pdf/wav`）、P4（`settings`/`config`/`doctor`/补全）**未实现**，
> 调用时会**明确报错并给出退出码 1**（不假装成功 ✗）。

## 一、怎么运行

```powershell
# 开发/CI（本仓库内，Node 环境）：
npm run cli -- <命令> [选项]         # 等价于 vite build --config vite.smoke.config.ts && node dist-smoke/cli.cjs …

# 直接用已构建产物：
node dist-smoke/cli.cjs <命令> [选项]

# 桌面端（P3 起，决策①）：同一个 exe，带子命令就不进 GUI
ijipu <命令> [选项]
```
> 现在**没有参数**仍是打开 GUI（现状不变 ✓）；只有带**已知子命令**才走 CLI。

## 二、命令一览（P1）

| 命令 | 作用 | 关键选项 |
|---|---|---|
| `format` | 按应用规范**规范化源码**（与应用编辑器/插件格式化同一实现） | `-i` `-o` `--check` `--in-place` `--diff` |
| `lint` | 语法检查（错误/告警） | `-i` `--format text\|json\|gh` |
| `info` | 谱面概况（标题/调号/行数/分组/问题数） | `-i` `-t text\|json` |
| `render` | 源码 → **SVG**（每页一段）／**MIDI**／**PNG·JPG·PDF**（需桌面端通道） | `-i` `-t svg\|midi\|png\|jpg\|pdf` `-o` |
| `play` | 导出音频：**MIDI**（任意环境）／**WAV**（需桌面端通道） | `-i` `-t midi\|wav` `-o` |
| `batch` | **目录批量**转换（SVG / MIDI / 规范化源码）；输出目录会自动创建 | `--in <目录>` `-o <目录>` `-t svg\|midi\|fmt` |
| `settings` | 看**某一个设置项**的值与**来源**（位置参数 = 键名） | `-i <谱>` `<键名>` `-s k=v`（临时覆盖） |
| `config` | 打印**生效设置全表 + 每项来源** | `-i <谱>` `-t effective` |
| `doctor` | 环境自检（可设置项数量、各项能力是否可用） | `--json` |
| `completions` | 输出 shell 补全脚本 | `completions bash\|zsh\|powershell` |

未实现（**会报错**）：`--watch`（后续）。`settings` 的键名直接当**位置参数**给，例如：

```powershell
npm run cli -- settings -i 我的谱.jps pageMode          # pageMode = "score"   [来自：源内 # jps-config]
npm run cli -- settings -i 我的谱.jps margin_top -s margin_top=33
#   margin_top = "33"   [来自：命令行 -s]
npm run cli -- config -i 我的谱.jps -t effective --quiet # 只看"非默认"的项（精简视图）
npm run cli -- doctor                                    # 能力自检：位图/音频在独立 Node 里为 ✗（需桌面端通道）
```

### P3：位图/音频为什么在独立 Node 里"报错"而不是"硬做"
`png/jpg/pdf` 需要 **canvas + 字体 + 分页**，`wav` 需要 **AudioContext + 音色库** ——
这些能力**只在应用侧存在**（决策②：走**隐藏窗口渲染**，复用 `src/export/*` 与应用音色库 ⇒ 与 GUI 导出像素级一致 ✓）。
所以本 CLI 把它们做成**由宿主注入的可选能力**：
- 在**桌面端 exe** 里（同一 exe 的子命令，决策①）由宿主注入 ⇒ 正常产出 ✓；
- 在**独立 Node** 环境里 ⇒ **明确报错 + 退出码 4**（"需要隐藏窗口渲染通道"），并给出可用的替代（`-t svg` / `-t midi`）✓
  —— **不产出半成品、不假装成功** ✓。

> **render 的 SVG 口径（重要）**：CLI 在 Node 里**没有 canvas 实测角标墨迹** ⇒ 引擎按**估算宽**排版，
> 与应用（实测版）可能有**亚像素差异**；版式、音符位置与页数一致 ✓。
> 需要像素级一致时用应用导出（P3 的"隐藏窗口渲染"就是为此 ✓）。

## 三、全局选项

| 选项 | 含义 |
|---|---|
| `-i, --input <文件\|->` | 输入文件；`-` 表示 **stdin**（省略时也读 stdin） |
| `-o, --output <文件\|->` | 输出文件；`-` 或省略 = **stdout** |
| `-t, --type <类型>` | 指定输出类型；省略时**按 `-o` 后缀推断**（P1 只有文本类） |
| `--json` | 机器可读输出（带 `"schema": 1`） |
| `--quiet` | 不输出非必要信息（成功即静默，便于脚本判断） |
| `--deterministic` | 输出不含时间戳（CI 逐字节比对用） |
| `-s <k=v>` | 临时设置（P4 完整实现；当前仅 `info` 接受） |
| `--config <文件>` | CLI 配置文件（**P4**，现在给会报退出码 5） |
| `-h, --help` / `-v, --version` | 帮助 / 版本 |

## 四、退出码（**对外承诺**，脚本按它判断，不要解析文案 ✗）

| 码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 用法错误（未知命令/选项、缺少参数） |
| `2` | 输入不存在或读失败 |
| `3` | **语法错误**（`lint` 命中；`format --check` 发现"需要格式化"） |
| `4` | 渲染失败（P2 起） |
| `5` | 设置非法（`--config`/`-s` 相关） |

## 五、示例

```powershell
# 1) 校验一份谱（有错 ⇒ 退出码 3）
npm run cli -- lint -i samples/ershenbu.jps

# 2) CI 里贴 GitHub Actions 注解（每个问题一行 ::error）
npm run cli -- lint -i 我的谱.jps --format gh

# 3) 机器可读（schema 版本 + 逐条 line/message）
npm run cli -- lint -i 我的谱.jps --json

# 4) 看概况
npm run cli -- info -i 我的谱.jps
#   文件：我的谱.jps
#   标题：…（有则打印）
#   调号：C
#   源码行：17｜曲词分组：3｜字符：259
#   问题：错误 0 个、告警 0 个

# 5) 管道：规范化后写回另一份文件
Get-Content 乱.jps -Raw | npm run cli -- format -i - -o 规范.jps

# 6) 原地规范化（**必须显式**，且只能对文件、不能对 stdin）
npm run cli -- format -i 我的谱.jps --in-place

# 7) 只检查是否合规（不改文件；不合规 ⇒ 退出码 3，适合 pre-commit）
npm run cli -- format -i 我的谱.jps --check

# 8) 看差异（- 旧 / + 新，逐行）
npm run cli -- format -i 乱.jps --diff

# 9) 一次性批量（P2 起用 batch；P1 时代用 PowerShell 循环兜）
npm run cli -- batch --in samples -o dist-out -t svg     # 每个谱 → 一/多个 SVG（多页加 -1/-2）
npm run cli -- batch --in samples -o dist-out -t midi    # 每个谱 → 一个 .mid
npm run cli -- batch --in samples -o dist-out -t fmt     # 每个谱 → 规范化后的 .jps

# 10) 导出矢量图 / MIDI
npm run cli -- render -i 我的谱.jps -t svg -o 我的谱.svg
npm run cli -- render -i 我的谱.jps -t midi -o 我的谱.mid
```

## 六、CI 集成

**GitHub Actions**（`.github/workflows/jps.yml`）：
```yaml
- run: npm ci
- run: npm run cli -- lint -i 乐谱/ --format gh     # P2 起支持目录/glob；P1 先逐个文件
- run: npm run cli -- format -i 乐谱/ --check       # 不合规就红灯
```
**pre-commit / husky**：对改动过的 `.jps` 跑 `format --in-place` + `lint`（退出码非 0 即拦下提交 ✓）。

## 七、输出与编码约定

- **一律 UTF-8**；Windows 控制台若显示乱码，先 `chcp 65001`（或**优先写文件**而不是打到终端 ✓）；
- `--json` 输出**永远是单段 JSON**（带 `"schema": 1` 与 `"generator": "ijipu <版本>"`）；
- `lint --format gh` 的问题行格式：`::error file=<文件>,line=<行>::<消息>`；
- `format --diff`：`- 旧行` / `+ 新行`，只列**有变化**的行 ✓。

## 八、实现约定（给后续维护者，来自项目铁律）

1. **纯逻辑 + 注入式 IO**：核心是 `packages/ijipu-cli/src/cli.ts` 的 `runCli(argv, io)` ——
   不碰 `process`/`console` ⇒ 可被 ① node 可执行 ② 桌面端 exe 子命令（决策①）③ 测试直接调用，
   **三处共用一份逻辑** ✓；
2. **不重写引擎**：解析/格式化只调 `@ijipu/engine`（AGENTS §六之二·4"数值口径必须同源"）；
3. **不引依赖**：参数解析手写（§一"新增依赖必须先询问"）；
4. **未实现就报错**：不给"看起来成功了"的假象 ✗（退出码 1 + 明确提示 ✓）；
5. **凡新增命令**：同步更新本文件 + `--help` 快照断言 + 冒烟用例（§六之二·5）。
