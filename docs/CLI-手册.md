# iJipu 命令行使用手册

> 这份文件只讲**怎么用**：怎么注册、怎么确认注册好了、每个命令有哪些参数、输出长什么样。
> 命令行的维护与设计说明在 `docs/CLI.md`（面向改代码的人）——两份分工不同。
>
> - 适用版本：**iJipu 0.61.0**
> - 许可：**AGPL-3.0** ｜ 源码与问题反馈：<https://github.com/snailhome/ijipu>
> - 装完 iJipu 就有命令行：**不需要另外装 Node，也不需要联网**。
> - 一共 **13 个命令**。下面每条示例都是**实跑输出**：`>` 开头的是敲的命令，紧跟其后的是真实输出
>   （这些示例都在 Windows 上**实跑过**，输出原文照贴）。

---

## 一、一分钟上手

### 1.1 注册：让终端里直接敲 `ijipu`

在应用的**底栏 →「全局」→「命令行」**子页签里点一次「**注册**」；也可以在终端里做同一件事：

```text
> ijipu.exe cli register
已注册 ✓ 命令行入口目录已加入当前用户 PATH：C:\Users\<你>\AppData\Local\iJipu\bin
  · 请**新开一个终端**，之后就能直接敲：ijipu cli lint 我的谱.jps
  · 只对当前用户生效，不需要管理员权限
  · 这一条是**命令行入口目录**（里面有控制台垫片 ijipu.cmd）：输出顺序、退出码、重定向都正常 ✓，
    双击 .jps 照旧打开界面、不闪黑框
```

写进 PATH 的是**命令行入口目录** `<安装目录>\bin`（`ijipu.exe` 本体**不进 PATH**），
那里面放的就是控制台垫片 `bin\ijipu.cmd` ⇒ **现在直接敲即可**：输出顺序、退出码、`>` 重定向都正常。

注册是**幂等**的，重复执行不会重复写入：

```text
> ijipu cli register
已是注册状态 ✓（PATH 里本来就有这一条，未重复写入）：C:\Users\<你>\AppData\Local\iJipu\bin
```

### 1.2 注册省掉的是什么（不注册照样能用）

注册只省掉"**路径**"，不省"`cli`"：

| 时机 | 怎么敲 |
| --- | --- |
| 注册前 | `"%LOCALAPPDATA%\iJipu\bin\ijipu.cmd" cli lint 我的谱.jps` |
| 注册后 | `ijipu cli lint 我的谱.jps` |

三条必须知道的事：

| 事项 | 说明 |
| --- | --- |
| **要新开一个终端** | 已经开着的终端看不到新加的 PATH —— 注册后**新开一个终端**才敲得到 `ijipu`。 |
| **只对当前用户生效** | 只写当前用户的 PATH（`HKCU\Environment\Path`），**不需要管理员权限**，不动系统级 PATH、也不动别的用户。 |
| **随时可以解除** | `ijipu cli unregister`（或设置里那个按钮）只摘掉自己那一条，**其余条目逐字不动**；卸载应用时也会自动解除。 |

从更早的版本升上来的（那会儿写进 PATH 的是"安装目录本身"）：`status` 会把那一形态标成 `legacy` 并按**未注册**报；
点一次「注册」就会把它换成命令行入口目录，`unregister` 则**两种形态都摘**。

### 1.3 怎么确认已经注册好

新开一个终端，敲这两条：

```text
> ijipu cli --version
iJipu 0.61.0
```

```text
> ijipu cli status
iJipu CLI 注册状态：已注册 ✓（终端里可以直接敲 ijipu）
  安装目录：C:\Users\<你>\AppData\Local\iJipu
  命令行入口目录（写进 PATH 的就是它）：C:\Users\<你>\AppData\Local\iJipu\bin
  当前用户 PATH：558 / 2047 字符
  App Paths：C:\Users\<你>\AppData\Local\iJipu\ijipu.exe
```

- 第一条能打印出版本 ⇒ **PATH 通了**（这也是最省事的验证）。
- 第二条 `status` **现读系统实况**：你在「环境变量」里手改过也如实反映，不读我们自己的配置。
- 给脚本用就加 `--json`，读 `registered` 字段比解析上面那段文案稳：

```text
> ijipu cli status --json
{
  "schema": 1,
  "registered": true,
  …
}
```

（节选。完整字段：`installDir` / `binDir` / `legacy` / `pathLength` / `pathLimit` / `pathValue` / `appPaths`。
未注册时第一行是 `iJipu CLI 注册状态：未注册 ✗（终端里还敲不了 ijipu）`，并多一行以 `注册：` 开头的提示。）

**别直接调 `ijipu.exe` 当命令行用** —— 它是图形界面程序，cmd 与 PowerShell 都不会等它跑完：

| 写法 | 输出看得见吗 | 拿得到退出码吗 |
| --- | --- | --- |
| `ijipu cli lint 我的谱.jps`（垫片，注册之后） | ✓ 紧跟在自己那条命令后面 | ✓ `%ERRORLEVEL%` / `$LASTEXITCODE` |
| `ijipu cli lint 我的谱.jps > out.txt` | ✓ 真写进文件（UTF-8，不再是 0 字节） | ✓ |
| 直接调 exe：`"%LOCALAPPDATA%\iJipu\ijipu.exe" cli lint 我的谱.jps` | ✗ 提示符会夹在输出中间 | ✗ 拿到的是旧值 |
| 绕过垫片时的老办法：PowerShell `Start-Process -Wait -PassThru -NoNewWindow` | ✓（要 `-NoNewWindow`） | ✓ `$p.ExitCode` |

### 1.4 常见误区

命令行与图形界面是**同一个 `ijipu.exe`**，靠"第一个参数是不是 `cli`"分流。下面这些写法**不执行命令**，而是照旧拉起窗口：

| 你敲的（✗ 会打开图形界面） | 实际发生的事 | 正确写法（✓） |
| --- | --- | --- |
| `ijipu lint 我的谱.jps` ✗ | 拉起图形界面（`lint` 不是 `.jps` 路径 ⇒ 被忽略）⇒ **一个语法检查都没做**，命令行这边一个字都不打印 | `ijipu cli lint 我的谱.jps` |
| `ijipu.exe --help` ✗ | 拉起图形界面，**不打印命令行帮助**（"看用法"要显式写 `cli`） | `ijipu.exe cli --help` |
| `ijipu --version` ✗ | 同上，拉起图形界面 | `ijipu cli --version` |
| `ijipu 我的谱.jps`（✓ 有意为之） | 打开图形界面并载入这份谱 —— 双击 `.jps`、文件关联走的就是这条路 | 想用命令行就写 `ijipu cli …` |

> 一句话：**注册省掉的是"路径"，不是"`cli`"** —— 形态永远是 `ijipu cli <命令>`。
> 垫片也不会替你补（补了会变成 `ijipu.exe cli cli …`）。

### 1.5 看用法

```text
用法：ijipu cli [全局选项] <命令> [命令选项]
```

完整帮助随时可查：`ijipu cli --help`。每条命令的选项与示例见下一节。

---

## 二、命令集

下面每个命令的示例都在 Windows 上实跑过，输出是**原文粘贴**。示例谱用仓库 `samples` 目录里的
7 份示例谱（如 `samples\ershenbu.jps`）；两处需要"出错 / 不规范"的示例，谱的全文也贴在对应小节里，
照抄就能复现。换成你自己的谱时把路径换掉即可。

### 2.1 命令总表

| 命令 | 一句话作用 | 关键选项 |
| --- | --- | --- |
| `format` | 按应用规范**规范化源码**（与应用编辑器里的格式化结果一致） | `-i` `-o` `--check` `--in-place` `--diff` |
| `lint` | 语法检查（有错 ⇒ 退出码 3）；**输入可以是目录** | `-i` `-r` `--filter` `--format text\|json\|gh` `--watch` |
| `info` | 谱面概况（调号 / 行数 / 分组 / 问题数） | `-i` `-t text\|json` `--json` |
| `render` | 渲染导出：`-t svg` ｜ `-t midi` ｜ `-t png` `-t jpg` `-t pdf` | `-i` `-t` `-o` `--crop` `--pad` `--ink` |
| `play` | 导出音频：`-t midi` ｜ `-t wav` | `-i` `-t` `-o` |
| `batch` | 目录批量操作，**任务可逗号组合** | `--in` `-o` `-t lint,svg,midi,fmt` `-r` `--filter` |
| `settings` | 查**某一个设置项**的值与来源 | `-i <谱>` `<键名>` `-s k=v` |
| `config` | 打印**生效设置全表**与每项来源 | `-i <谱>` `-t effective` `--quiet` `--json` |
| `doctor` | 环境自检（如实报告各能力有没有） | `--json` |
| `completions` | 输出 shell 补全脚本 | `bash` ｜ `zsh` ｜ `powershell` |
| `register` | 把命令行入口目录注册进当前用户 PATH | `--json` |
| `unregister` | 从当前用户 PATH 里解除注册 | `--json` |
| `status` | 看现在注册了没有（读系统实况） | `--json` |

### 2.2 通用选项

| 选项 | 说明 |
| --- | --- |
| `-i, --input <文件\|目录\|->` | 输入。`-` = stdin；省略时也读 stdin；`--in` 是别名 |
| `-o, --output <文件\|->` | 输出文件（`-` 或省略 = stdout）；在 `batch` 里是**输出目录** |
| `-t, --type <类型>` | 输出类型。省略时按 `-o` 后缀推断；`batch` 里可逗号组合 |
| `--json` | 机器可读输出（带 schema 版本） |
| `--quiet` | 不输出非必要信息 |
| `-s <k=v>` | 临时设置（可重复；**优先级最高**，不落盘）。只接受于 `settings` / `config` / `render` / `play` / `batch` |
| `-r, --recursive` | 输入是目录时**连子目录一起**（缺省只看当前一层） |
| `--filter <通配符>` | 只处理**文件名**匹配的（支持 `*` 与 `?`，如 `--filter "春*"`） |

`-s` 的三条规矩：键名必须是**真的设置项**（写错 ⇒ 退出码 5，不会当没写）；`k=v` 缺 `=` 也报退出码 5；
值能当数字就当数字（`margin_right=33` 就是数字 33）。

### 2.3 `lint`：语法检查

**① 检查一份谱**（干净 ⇒ 打印一行、退出码 0）：

```text
> ijipu cli lint -i samples\ershenbu.jps
没有发现问题 ✓
```

**② 检查一整个目录**（这是最常用的一条：不必再写 bat 循环）：

```text
> ijipu cli lint -i samples
samples/liangzhilaohu.jps 第 12 行：第 5 小节共 6 拍，与拍号 4/4（每小节 4 拍）不符
samples/liangzhilaohu.jps 第 12 行：第 6 小节共 6 拍，与拍号 4/4（每小节 4 拍）不符
samples/lianyinxian-zhuangshi.jps 第 10 行：第 2 小节共 6 拍，与拍号 4/4（每小节 4 拍）不符
samples/yinyun-zhuangshi.jps 第 11 行：第 2 小节共 6 拍，与拍号 4/4（每小节 4 拍）不符
samples/yufa-quangai.jps 第 12 行：第 2 小节共 4 拍，与拍号 6/8（每小节 6 拍）不符
samples/yufa-quangai.jps 第 12 行：第 3 小节共 3 拍，与拍号 6/8（每小节 6 拍）不符
samples/yufa-quangai.jps 第 12 行：第 4 小节共 7 拍，与拍号 6/8（每小节 6 拍）不符
检查 7 个文件：7 个通过、0 个有错（错误 0 个、告警 7 个）
```

> **哪一行说的是哪个文件，一眼就能看出来**：凡"某一个文件独有"的信息（每一处问题）**行首带文件名**；
> 只有最后那句"检查 N 个文件…"是**共同信息**，所以不带。单文件输入**也带**（`错谱.jps 第 5 行：…`）——
> 两种输出同一口径，混在一个日志里也不会对不上号。

默认**只看当前一层**；要连子目录一起查就加 `-r`：

```text
> ijipu cli lint -i 乐谱 -r
```

只想查名字匹配的那几份，用 `--filter`（支持 `*` 与 `?`）：

```text
> ijipu cli lint -i 乐谱 --filter "春*"
```

目录里没有 `.jps` 时如实报错（退出码 2），并提示加 `-r`。

**③ 有错时**：逐行打印，退出码 3。这份谱的全文如下（照抄存成 `错谱.jps` 即可复现）：

```text
V: 1.0
B: 错谱演示
D: C
P: 4/4
Q: 1"注释没闭合 2 3 4 |
```

```text
> ijipu cli lint -i 错谱.jps
错谱.jps 第 5 行：引号注释未闭合
```

**④ 给 CI 用**：`--format gh` 让每行都是 GitHub Actions 注解（问题会直接标在 diff 上）：

```text
> ijipu cli lint -i 错谱.jps --format gh
::error file=错谱.jps,line=5::引号注释未闭合
```

**⑤ 给脚本用**（`--json`；目录输入时 `files` 是每个文件一条）：

```text
> ijipu cli lint -i 错谱.jps --json
{
  "schema": 1,
  "generator": "ijipu 0.61.0",
  "input": "错谱.jps",
  "ok": false,
  …
  "errors": [
    {
      "line": 5,
      …
```

```text
> ijipu cli lint -i samples -r --json
{
  "schema": 1,
  "generator": "ijipu 0.61.0",
  "files": [
```

**⑥ 告警不动退出码**：下面这份谱只有告警，退出码仍是 0（存成 `告警谱.jps`）：

```text
V: 1.0
B: w
D: C
P: 4/4
Q: 1 2 x 4 |
```

```text
> ijipu cli lint -i 告警谱.jps
告警谱.jps 第 5 行：无法识别的符号 "x"
```

**⑦ 边写边查**（`--watch`：改一次文件就重查一次，`Ctrl+C` 结束）。这项能力**只有独立 Node 包有**：

```text
> ijipu cli lint -i samples\ershenbu.jps --watch
--watch 需要宿主的文件监视能力（node 入口提供；独立环境不可用）
```

### 2.4 `format`：规范化源码

**① 只检查是否合规**（不改文件）。合规就是一行 `已符合规范 ✓`、退出码 0：

```text
> ijipu cli format -i samples\ershenbu.jps --check
已符合规范 ✓
```

不合规 ⇒ 退出码 3（适合拿来当提交前钩子）。这份谱就一行：

```text
Q:1 2 3 4|
```

```text
> ijipu cli format -i 我的谱.jps --check
需要格式化 ✗
```

**② 看差异**（`-` 旧 / `+` 新，逐行）：

```text
> ijipu cli format -i 我的谱.jps --diff
- Q:1 2 3 4|
+ Q: 1 2 3 4 |
```

**③ 规范化后打到屏幕**（`-o -` 或省略 `-o`）：

```text
> ijipu cli format -i 我的谱.jps -o -
Q: 1 2 3 4 |
```

**④ 写到另一个文件**：

```text
> ijipu cli format -i 我的谱.jps -o 我的谱.规范化.jps
已写入 我的谱.规范化.jps
```

**⑤ 原地改**（只能对文件，不能对 stdin）：

```text
> ijipu cli format -i 我的谱.jps --in-place
已原地格式化：我的谱.jps
```

### 2.5 `info`：谱面概况

```text
> ijipu cli info -i samples\ershenbu.jps
文件：samples\ershenbu.jps
调号：C
源码行：17｜曲词分组：3｜字符：259
问题：错误 0 个、告警 0 个
```

```text
> ijipu cli info -i samples\ershenbu.jps --json
{
  "schema": 1,
  "generator": "ijipu 0.61.0",
  …
  "groups": 3,
```

### 2.6 `render`：渲染导出

输出类型：`-t svg|midi|png|jpg|pdf`。

**① 矢量图**（多页谱会自动加 `-1` `-2`…）：

```text
> ijipu cli render -i samples\ershenbu.jps -t svg -o 我的谱.svg
已写入 我的谱.svg
```

**② MIDI**（二进制，**必须**用 `-o` 指定文件）：

```text
> ijipu cli render -i samples\ershenbu.jps -t midi -o 我的谱.mid
已写入 我的谱.mid（MIDI，225 字节）
```

```text
> ijipu cli render -i samples\ershenbu.jps -t midi
MIDI 是二进制，必须用 -o 指定文件（不能用 stdout）
```

**③ 裁到谱面**（缺省是整页；`--pad` 是每边留白 px，钳制 0–64）：

```text
> ijipu cli render -i samples\ershenbu.jps -t svg --crop score --pad 4 -o 我的谱.svg
已写入 我的谱.svg
```

**④ 位图 / PDF**：需要"隐藏窗口渲染"通道，**只有桌面端 exe 内有**：

```text
> ijipu cli render -i samples\ershenbu.jps -t png -o 我的谱.png
-t png 需要"隐藏窗口渲染"通道（桌面端 exe 内置）；当前环境没有该能力。
  可用：-t svg（矢量，任意环境）｜或改用桌面端：ijipu cli render -i <谱> -t png -o <输出>
```

### 2.7 `play`：导出音频

输出类型：`-t midi|wav`。

```text
> ijipu cli play -i samples\ershenbu.jps -t midi -o 我的谱.mid
已写入 我的谱.mid（MIDI，225 字节）
```

`-t wav` 需要音色库采样合成，**同样只有桌面端 exe 内有**：

```text
> ijipu cli play -i samples\ershenbu.jps -t wav -o 我的谱.wav
WAV 需要采样合成（音色库 + AudioContext），当前环境没有该能力。
  可用：-t midi（任意环境）｜或改用桌面端：ijipu cli play -i <谱> -t wav -o <输出.wav>
```

### 2.8 `batch`：目录批量操作

`-t` 可以**逗号组合**（一次遍历目录，多种产物一起拿）；可用任务：`lint` / `svg` / `midi` / `fmt`。
**只有纯 `-t lint` 可以省掉 `-o`**（lint 不产出文件），其余任务必须给 `-o <目录>`。

**① 对整个目录做语法检查**（不必给 `-o`）：

```text
> ijipu cli batch --in samples -t lint
批处理完成：成功 7 个、失败 0 个（任务 lint；输入 7 个文件）
```

**② 批量出 SVG**：

```text
> ijipu cli batch --in samples -o 输出目录 -t svg
批处理完成：成功 7 个、失败 0 个（任务 svg；输入 7 个文件，输出到 输出目录）
```

**③ 组合式批量**（一次遍历，同时拿 lint 结果 + 规范化源码 + SVG）：

```text
> ijipu cli batch --in 乐谱 -o 输出 -t lint,fmt,svg
```

**④ 个别谱有语法错误**：记进"失败"并逐条列出，整体退出码 3（其余照常产出）：

```text
> ijipu cli batch --in 待检查 -o 输出目录 -t svg
批处理完成：成功 1 个、失败 1 个（任务 svg；输入 2 个文件，输出到 输出目录）
  ✗ bad.jps（1 个语法错误）
```

组合里只要有一个写文件的任务，`-o` 就仍然必填；任务名写错（如 `-t lint,png`）直接报用法错误（退出码 1）。

### 2.9 `settings` / `config`：设置项的值与来源

```text
> ijipu cli settings -i samples\ershenbu.jps margin_right
margin_right = 50   [来自：代码默认]
```

临时换成别的值看看（**不落盘**）：

```text
> ijipu cli settings -i samples\ershenbu.jps margin_right -s margin_right=33
margin_right = 33   [来自：命令行 -s]
```

键名漏了会给用法与可用键提示：

```text
> ijipu cli settings -i samples\ershenbu.jps
settings 需要键名（位置参数），例如：settings -i <谱> margin_right
  可用键 35 个：settings -i <谱> -t effective 可全量列出；可选字段：heights、metaPos、lyricShrink、showInstrument、segmentRowGap
```

一次看全部生效设置：

```text
> ijipu cli config -i samples\ershenbu.jps -t effective --quiet
生效设置（来源：命令行 > 源内 # jps-config > 代码默认）
```

上面的 `--quiet` 表示"只看非默认的项"（这份谱没有，所以只有标题一行）。去掉它逐行列全部：

```text
> ijipu cli config -i samples\ershenbu.jps -t effective
生效设置（来源：命令行 > 源内 # jps-config > 代码默认）
  page = "A4"   [代码默认]
  margin_top = 40   [代码默认]
  …
```

来源优先级：**命令行 `-s` > 源内 `# jps-config` > 代码默认**。

### 2.10 `doctor` / `completions`

`doctor` 一眼看清"这台机器上哪些 `-t` 现在能用"（省得撞到退出码 4 才知道）：

```text
> ijipu cli doctor
iJipu CLI doctor
  可设置项：35 个（含可选字段 5 个）
  能力：svg ✓｜midi ✓｜位图(png/jpg/pdf) ✗（需桌面端隐藏窗口渲染）｜音频(wav) ✗（需音色库合成）
  提示：位图/音频在桌面端 exe 内可用；独立 Node 环境只能用 svg/midi ✓
```

加 `--json` 给脚本读：

```text
> ijipu cli doctor --json
{
  "schema": 1,
  "generator": "ijipu 0.61.0",
  "capabilities": {
    "svg": true,
    "midi": true,
    "raster": false,
    "audio": false
  },
  …
}
```

`completions` 输出补全脚本（先注册 PATH 才有意义）：

```text
> ijipu cli completions powershell
# iJipu PowerShell 补全（桌面端）：ijipu cli completions powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName ijipu -ScriptBlock {
```

```text
> ijipu cli completions bash
# iJipu bash 补全（桌面端）：source <(ijipu cli completions bash)
_ijipu() {
```

```text
> ijipu cli completions foo
completions 支持 bash | zsh | powershell（收到 “foo”）
```

### 2.11 `register` / `unregister` / `status`

这三个命令**只在桌面端 exe 内可用**（要读写当前用户的 PATH / 注册表）。看状态、注册、解除分别在 §1.3 / §1.1 / §1.2 有实跑输出，这里补两条：

```text
> ijipu cli unregister
已解除 ✓ 已从当前用户 PATH 里摘掉：C:\Users\<你>\AppData\Local\iJipu\bin
  · 其余 PATH 条目**逐字未动**；新开的终端里就不再能直接敲 ijipu 了
```

```text
> ijipu.exe cli status
iJipu CLI 注册状态：未注册 ✗（终端里还敲不了 ijipu）
  安装目录：C:\Users\<你>\AppData\Local\iJipu
  命令行入口目录（写进 PATH 的就是它）：C:\Users\<你>\AppData\Local\iJipu\bin
  当前用户 PATH：450 / 2047 字符
  App Paths：（未注册）
  注册：ijipu cli register（注册后**新开一个终端**才生效；只对当前用户生效、不需要管理员）
```

三个命令都是**幂等**的：重复跑不会把 PATH 写坏。当前用户 PATH 超过 **2047 字符**时**不写**，
并明确报错 + 给出三条可执行建议。注册时还会顺带写 `HKCU\...\App Paths\ijipu.exe`（于是"运行"对话框、
资源管理器地址栏敲 `ijipu` 也能起来）；解除时**只删指向我们的那一条**。

### 2.12 常见用法

**① 单文件：检查 → 规范化 → 出图**

```text
> ijipu cli lint -i 我的谱.jps
> ijipu cli format -i 我的谱.jps --check
> ijipu cli render -i 我的谱.jps -t svg -o 我的谱.svg
```

`lint` 看有没有错、`format --check` 看合不合规范、`render` 出图；三条的退出码都能当判据（0 才是过）。

**② 整个目录一起查**

```text
> ijipu cli lint -i 乐谱 -r
```

有错的逐条列出来，整体退出码 3。

**③ 导出 SVG / MIDI**

```text
> ijipu cli render -i 我的谱.jps -t svg -o 我的谱.svg
> ijipu cli render -i 我的谱.jps -t midi -o 我的谱.mid
```

**④ 在 CI / 提交前钩子里跑**（靠退出码判断，别解析文案）

```text
> ijipu cli lint -i 乐谱 --format gh
```

`--format gh` 的每一行都是 GitHub Actions 注解。提交前钩子里可以用
`ijipu cli format -i 我的谱.jps --check`（不合规 ⇒ 退出码 3 ⇒ 拦下提交）。

**⑤ 注册之后仍要写 `cli`** —— 见 §1.4：注册省掉的是**路径**，不是 `cli`。

---

## 三、能力与限制

### 3.1 能力表

| 能力 | 现在能用吗 | 说明 |
| --- | --- | --- |
| `format` / `lint` / `info` / `batch` / `settings` / `config` / `doctor` | ✓ | 纯计算，任意环境 |
| `render -t svg` | ✓ | 矢量图，任意环境 |
| `render -t midi` / `play -t midi` | ✓ | 二进制 MIDI，**必须 `-o` 指定文件** |
| `render -t png` `-t jpg` `-t pdf` | ✗ 退出码 4 | 需要隐藏窗口渲染通道 ⇒ 请用应用里的「导出」 |
| `play -t wav` | ✗ 退出码 4 | 需要音色库采样合成 ⇒ 请用应用里的试听 / 导出 |
| `lint --watch` | ✗ 退出码 1 | **内嵌版没有**该能力；**独立 Node 包**（`@ijipu/cli`）可用 ✓ |
| `register` / `unregister` / `status` | ✓（仅桌面版） | 要读写当前用户的注册表；独立 Node 环境 ⇒ 退出码 6 |

拿不准就先跑一次 `ijipu cli doctor`（§2.10）——它如实报告每一项能力有没有。

### 3.2 两条交付路径

跑的是**同一份命令逻辑**，差别只在"谁提供能力"：

| 路径 | 命令形态 | 注册表能力 | 位图 / 音频 |
| --- | --- | --- | --- |
| **内嵌版**（装过应用就有） | `ijipu.exe cli <命令>`；注册后 `ijipu cli <命令>` | ✓ 有 | ✗ 报退出码 4 |
| **独立 Node 包**（给 CI / 没装应用的机器） | 独立 Node 包 `@ijipu/cli` 装好后**没有 `cli` 这一层**：直接 `ijipu <命令>` | ✗ 退出码 6 | ✗ 同上 |

### 3.3 几条平台限制（Windows）

- **别直接调 `ijipu.exe` 当命令行用** —— 输出顺序、退出码、`>` 重定向都会坏（§1.3）；走 `ijipu`（注册后）或垫片的完整路径。
- **注册后要新开一个终端**才敲得到 `ijipu`（已开着的终端看不到新 PATH）。
- **补全脚本对 `ijipu` 这个命令名生效** ⇒ 先注册 PATH 才有意义。

---

## 四、退出码表

脚本请按**退出码**判断，不要解析文案（文案会改，码不会）。

| 码 | 含义 | 典型触发 |
| --- | --- | --- |
| `0` | 成功 | 一切正常（含 `lint` 只有告警） |
| `1` | **用法错误** | 未知命令 / 选项、缺参数、`batch` 任务名写错、目录输入配 `--watch` |
| `2` | **输入不存在或读失败** | `-i` 指的文件不在、路径写错、目录里没有 `.jps` |
| `3` | **语法错误** | `lint` 命中错误；`format --check` 认为需要格式化；`render` / `play` 遇到错误源码 |
| `4` | **渲染失败** | 需要位图 / 音频能力但当前环境没有（`png` / `jpg` / `pdf` / `wav`） |
| `5` | **设置非法** | `--config`（尚未实现）、`-s` 的键名写错或格式不对、`-s` 用在只看谱面的命令上 |
| `6` | **环境能力缺失** | 注册类命令在独立 Node 环境跑、当前用户 PATH 超长写不进去 |
| `70` | **接线层自身出错**（仅内嵌版） | 内嵌脚本加载失败等内部异常 —— 不是"用法错误"，脚本别混为一谈 |

---

## 五、许可与源码

iJipu（爱记谱）0.61.0 以 **GNU Affero General Public License v3.0（AGPL-3.0）** 发布，
全文随安装目录放在 `LICENSE`；第三方组件与音色库的许可见安装目录的 `THIRD-PARTY.md`。

- 源码：<https://github.com/snailhome/ijipu>
- 官网 / 在线版：<https://ijipu.pages.dev>

欢迎学习、修改与再分发。
