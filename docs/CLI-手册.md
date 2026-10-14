# iJipu 命令行使用手册

> 这份文件讲**怎么用**（面向使用者）：有什么命令、怎么敲、参数怎么给、输出长什么样、有哪些限制。
> 命令行的**维护与设计说明**在 `docs/CLI.md`（面向改代码的人）——两份分工不同，别把维护细节抄到这里。
>
> - 适用版本：**iJipu 0.60.0**
> - 许可：**AGPL-3.0** ｜ 源码与问题反馈：<https://github.com/snailhome/ijipu>
> - 装完 iJipu 就有命令行：**不需要另外装 Node，也不需要联网**。
> - 一共 **13 个命令**；下面每条示例都是**实跑输出** —— `>` 开头的是敲的命令，紧跟其后的是真实输出。

![这份手册在官网上的样子（`/cli/` 页首，左侧是可点的目录）](/docs/cli/manual-page.png)

---

## 一、一分钟上手

### 1.1 调用形态：`ijipu cli <命令>`

装了 iJipu 之后，`ijipu.exe` 就在**安装目录**里（默认 `%LOCALAPPDATA%\iJipu`）。让它跑命令行，**第一个参数必须恰好是 `cli`**：

```text
ijipu cli <命令> [选项]
```

只是看用法、版本号，可以直接敲完整路径（**不用注册**）：

```text
> "%LOCALAPPDATA%\iJipu\bin\ijipu.cmd" cli --version
iJipu 0.60.0
```

> ⚠ 上面调的是**命令行入口垫片** `bin\ijipu.cmd`。**别直接调 `ijipu.exe` 本体**：
> cmd 与 PowerShell 不会等它跑完，输出顺序、退出码、`>` 重定向都不可靠（见 §1.3）。
> 注册之后（§1.2）两种路径都可以写成简短的一句：`ijipu cli <命令> [选项]` ✓

### 1.2 注册 PATH：之后终端里直接敲 `ijipu cli …`（推荐）

每次都写一大串完整路径太麻烦。在应用的**底栏 →「全局」→「命令行」**子页签里点一次「**注册**」，命令行入口目录就进了**当前用户**的 PATH，之后**新开的**终端里可以直接敲：

```text
> ijipu cli lint 我的谱.jps
```

写进 PATH 的是**命令行入口目录** `<安装目录>\bin`（里面就是垫片 `bin\ijipu.cmd`；`ijipu.exe` 本体**不进 PATH**）⇒ **现在直接敲即可**：输出顺序、退出码、`>` 重定向都正常 ✓

三条必须知道的事：

| 事项 | 说明 |
| --- | --- |
| **要新开一个终端** | 已经开着的终端看不到新加的 PATH —— 注册后**新开一个终端**才敲得到 `ijipu`。 |
| **只对当前用户生效** | 只写当前用户的 PATH（`HKCU\Environment\Path`），**不需要管理员权限**，不动系统级 PATH、也不动别的用户。 |
| **随时可以解除** | `ijipu cli unregister`（或设置里那个按钮）会把自己那一条摘掉，**其余条目逐字不动**；卸载应用时也会自动解除。 |

注册也可以直接在终端里做（与设置里那个按钮是同一件事）：

```text
> ijipu.exe cli register
已注册 ✓ 命令行入口目录已加入当前用户 PATH：C:\Users\<你>\AppData\Local\iJipu\bin
  · 请**新开一个终端**，之后就能直接敲：ijipu cli lint 我的谱.jps
  · 只对当前用户生效，不需要管理员权限
  · 这一条是**命令行入口目录**（里面有控制台垫片 ijipu.cmd）：输出顺序、退出码、重定向都正常 ✓，
    双击 .jps 照旧打开界面、不闪黑框
```

> **从旧版本升上来的**（`adj944` 那会儿注册的是「安装目录本身」）：`status` 会把那一形态标成
> `legacy` 并按**未注册**报；点一次「注册」就会把它换成 `bin` 目录，`unregister` 则**两种形态都摘**。
> 设置里的「命令行」页签也会直接提示。

### 1.3 直接调 `ijipu.exe` 会丢输出与退出码

`ijipu.exe` 是图形界面程序，cmd 与 PowerShell **都不会等它跑完**。于是：

| 写法 | 输出看得见吗 | 拿得到退出码吗 |
| --- | --- | --- |
| `ijipu cli lint 我的谱.jps`（垫片，注册之后） | ✓ 紧跟在自己那条命令后面 | ✓ `%ERRORLEVEL%` / `$LASTEXITCODE` |
| `ijipu cli lint 我的谱.jps > out.txt` | ✓ 真写进文件（UTF-8，不再是 0 字节） | ✓ |
| 直接调 exe：`"%LOCALAPPDATA%\iJipu\ijipu.exe" cli lint 我的谱.jps` | ✗ 提示符会夹在输出中间 | ✗ 拿到的是旧值 |
| 绕过垫片时的老办法：PowerShell `Start-Process -Wait -PassThru -NoNewWindow` | ✓（要 `-NoNewWindow`） | ✓ `$p.ExitCode` |

> **兜底**：不想注册 PATH 时，用垫片的**完整路径**调用也一样好：
> `"%LOCALAPPDATA%\iJipu\bin\ijipu.cmd" cli lint 我的谱.jps` ✓
>
> 垫片是**透明**的：它只把参数原样转交，**不会**替你补 `cli` 子命令 ⇒ 命令行形态仍然是
> `ijipu cli <命令>`；`ijipu 我的谱.jps`（不带 `cli`）照旧打开图形界面。

### 1.4 常见误区：不带 `cli` 会**打开图形界面**（不是"命令没生效"）

命令行与图形界面是**同一个 `ijipu.exe`**，靠"第一个参数是不是 `cli`"分流。下面这些写法**不执行命令**，而是照旧拉起窗口 —— 屏幕上出现界面时，别以为是"命令跑挂了"：

| 你敲的（✗ 会开图形界面） | 实际发生的事 | 正确写法（✓） |
| --- | --- | --- |
| `ijipu lint 我的谱.jps` ✗ | 拉起图形界面（`lint` 不是 `.jps` 路径 ⇒ 被忽略）⇒ **一个语法检查都没做**，命令行这边一个字都不打印 | `ijipu cli lint 我的谱.jps` |
| `ijipu.exe --help` ✗ | 拉起图形界面，**不打印命令行帮助**（"看用法"要显式写 `cli`） | `ijipu.exe cli --help` |
| `ijipu --version` ✗ | 同上，拉起图形界面 | `ijipu cli --version` |
| `ijipu 我的谱.jps`（✓ 有意为之） | 打开图形界面并载入这份谱 —— 双击 `.jps`、文件关联走的就是这条路 | 想用命令行就写 `ijipu cli …` |

> 一句话：**注册 PATH 省掉的是"路径"，不是"`cli`"** —— 形态永远是 `ijipu cli <命令>` ✓。
> 垫片也不会替你补（补了会变成 `ijipu.exe cli cli …`）。

---

## 二、命令集（逐条：用途 / 选项 / 实跑示例）

下面每个命令的示例都在 Windows 上**实跑过**，输出是**原文粘贴**。示例谱用仓库里的 `samples` 目录
（7 份示例谱，如 `samples\ershenbu.jps`）；两处需要"出错/不规范"的示例，谱的全文也贴在对应小节里，
照抄就能复现。换成你自己的谱时，把路径换掉即可。

### 2.1 命令总表

| 命令 | 一句话作用 | 关键选项 |
| --- | --- | --- |
| `format` | 按应用规范**规范化源码**（与应用编辑器里的格式化结果一致） | `-i` `-o` `--check` `--in-place` `--diff` |
| `lint` | 语法检查（有错 ⇒ 退出码 3） | `-i` `--format text\|json\|gh` `--watch` `--json` |
| `info` | 谱面概况（调号 / 行数 / 分组 / 问题数） | `-i` `-t text\|json` `--json` |
| `render` | 渲染导出：`-t svg` ｜ `-t midi` ｜ `-t png` `-t jpg` `-t pdf`（后三种现在不可用，见 §3.2） | `-i` `-t` `-o` `--crop` `--pad` `--ink` |
| `play` | 导出音频：`-t midi` ｜ `-t wav`（现在不可用，见 §3.2） | `-i` `-t` `-o` |
| `batch` | 目录批量转换（SVG / MIDI / 规范化源码） | `--in` `-o` `-t svg\|midi\|fmt` |
| `settings` | 查**某一个设置项**的值与来源 | `-i <谱>` `<键名>` `-s k=v` |
| `config` | 打印**生效设置全表**与每项来源 | `-i <谱>` `-t effective` `--quiet` `--json` |
| `doctor` | 环境自检（如实报告各能力有没有） | `--json` |
| `completions` | 输出 shell 补全脚本 | `bash` \| `zsh` \| `powershell` |
| `register` | 把安装目录注册进当前用户 PATH | `--json` |
| `unregister` | 从当前用户 PATH 里解除注册 | `--json` |
| `status` | 看现在注册了没有（读系统实况） | `--json` |

### 2.2 `--help` / `--version`：看用法与版本

```text
> ijipu.exe cli --version
iJipu 0.60.0

> ijipu.exe cli --help
iJipu 命令行（爱记谱）

用法：ijipu cli [全局选项] <命令> [命令选项]

⚠ 第一个参数必须**恰好**是 cli：命令行与图形界面是同一个 exe，靠它分流。
  不带 cli 时（例如 ijipu 我的谱.jps、ijipu --help）会照旧**打开图形界面**，不执行命令。
  注册 PATH 之后终端里的 ijipu 是控制台垫片 bin\ijipu.cmd：它**原样转交**参数、不替你补 cli。

命令：
  format        -i <文件|-> [-o <文件|->] [--check] [--in-place] [--diff]     按应用规范规范化源码
  lint          -i <文件|-> [--format text|json|gh] [--watch]                 语法检查（有错 ⇒ 退出码 3）
  info          -i <文件|-> [-t text|json]                                    谱面概况（行数/分组/问题数）
  render        -i <文件|-> -t svg|midi|png|jpg|pdf -o <输出>                 渲染/导出
                [--crop page|score] [--pad N] [--ink x,y,w,h]                画布范围（缺省 page = 整页）
  play          -i <文件|-> -t midi|wav -o <输出>                             导出音频
  batch         --in <目录> -o <目录> [-t svg|midi|fmt]                       目录批量转换
  settings      -i <谱> <键名> [-s k=v]                                       看某个设置项的值与来源
  config        -i <谱> [-t effective] [--quiet]                              打印生效设置全表 + 每项来源
  doctor        [--json]                                                      环境自检（如实报告能力有无）
  completions   bash|zsh|powershell                                           输出 shell 补全脚本
  register      [--json]                                                      把命令行入口目录（<安装目录>\bin）注册进当前用户 PATH
  unregister    [--json]                                                      从当前用户 PATH 里解除注册
  status        [--json]                                                      看是否已注册（**读系统实况**）

全局选项：
  -i, --input <文件|->      输入文件（- = stdin；省略时也读 stdin）；--in 是别名
  -o, --output <文件|->     输出文件（- 或省略 = stdout）
  -t, --type <类型>         输出类型（省略时按 -o 后缀推断）
  --json                    机器可读输出（带 schema 版本）
  --quiet                   不输出非必要信息
  --deterministic           输出不含时间戳（CI 逐字节比对用）
  -s <k=v>                  临时设置（可重复；优先级最高，**不落盘**）
  --config <文件>           CLI 配置文件（**尚未实现**；给了 ⇒ 退出码 5）
  -h, --help                帮助
  -v, --version             版本

需要桌面端能力的两类输出：render -t png|jpg|pdf（canvas/字体/分页）、play -t wav（AudioContext + 音色库）。
  有宿主能力 ⇒ 正常产出；没有（独立 Node 环境）⇒ **退出码 4 + 原因** 并给出替代（-t svg / -t midi），
  不产出半成品、不假装成功。

注册类命令（register / unregister / status）**只在内嵌版可用**（ijipu.exe cli register）：
  它要读写当前用户的 PATH / App Paths，这个能力由桌面端注入；独立 Node 环境 ⇒ 退出码 6 + 原因。
  注册写进 PATH 的是**命令行入口目录 <安装目录>\bin**（里面有控制台垫片 ijipu.cmd）——
  ijipu.exe 是 GUI 子系统程序，cmd 不等它（提示符会夹在输出中间、退出码也拿不到）；
  cmd **会等批处理文件** ⇒ 垫片把输出顺序/退出码/重定向一次性修好，而双击 .jps 照旧不闪黑框。
  注册后**要新开一个终端**才生效（已开着的终端看不到新 PATH）；只对**当前用户**生效、不需要管理员。

退出码：0 成功 ｜ 1 用法错误 ｜ 2 输入不存在 ｜ 3 语法错误 ｜ 4 渲染失败 ｜ 5 设置非法 ｜ 6 环境能力缺失
```

> 这份手册若与 `ijipu.exe cli --help` 的输出不一致，**以程序输出为准**（那是从程序里读出来的）。

### 2.3 `format`：规范化源码

用途：按应用规范规范化源码。选项：`-i`（输入，`-` = stdin）、`-o`（输出，`-` 或省略 = stdout）、`--check`、`--diff`、`--in-place`。

**① 只检查是否合规**（不改文件；不合规 ⇒ 退出码 3，适合 pre-commit）。示例谱 `我的谱.jps` 就一行：

```text
Q:1 2 3 4|
```

```text
> ijipu.exe cli format -i 我的谱.jps --check
需要格式化 ✗
（退出码 3）
```

**② 看差异**（`-` 原样 / `+` 规范化后；只列有变化的行）：

```text
> ijipu.exe cli format -i 我的谱.jps --diff
- Q:1 2 3 4|
+ Q: 1 2 3 4 |
```

**③ 原地改写**（**必须显式** `--in-place`，且只能对文件、不能对 stdin）：

```text
> ijipu.exe cli format -i 我的谱.jps --in-place
已原地格式化：我的谱.jps

> ijipu.exe cli format -i 我的谱.jps --check
已符合规范 ✓
```

**④ 写到另一个文件 / 打到标准输出**：

```text
> ijipu.exe cli format -i 我的谱.jps -o 我的谱.规范化.jps
已写入 我的谱.规范化.jps

> ijipu.exe cli format -i 我的谱.jps -o -
Q: 1 2 3 4 |
```

**⑤ 管道用法**（stdin → stdout，适合编辑器/脚本里串起来）：

```text
> "Q:1 2 3 4|" | ijipu cli format -i -
Q: 1 2 3 4 |
```

**⑥ stdin 不能原地写**（如实报用法错误，退出码 1）：

```text
> "Q:1 2 3 4|" | ijipu cli format -i - --in-place
--in-place 需要文件输入（不能对 stdin 原地写）
（退出码 1）
```

### 2.4 `lint`：语法检查

用途：语法检查，**有错 ⇒ 退出码 3**。选项：`-i`、`--format text|json|gh`、`--json`、`--watch`。

**① 没问题时**：

```text
> ijipu.exe cli lint -i samples\ershenbu.jps
没有发现问题 ✓
```

**② 有错时逐条打印**。示例谱 `错谱.jps`（第 5 行的引号注释没闭合）：

```text
V: 1.0
B: 错谱演示
D: C
P: 4/4
Q: 1"注释没闭合 2 3 4 |
```

```text
> ijipu.exe cli lint -i 错谱.jps
第 5 行：引号注释未闭合
（退出码 3）
```

**③ 给 CI 用**（GitHub Actions 注解格式，每个问题一行 `::error`）：

```text
> ijipu.exe cli lint -i 错谱.jps --format gh
::error file=错谱.jps,line=5::引号注释未闭合
（退出码 3）
```

**④ 给脚本用**（`--json`，单段 JSON，带 schema 版本）：

```text
> ijipu.exe cli lint -i 错谱.jps --json
{
  "schema": 1,
  "generator": "ijipu 0.60.0",
  "input": "错谱.jps",
  "ok": false,
  "errors": [
    {
      "line": 5,
      "message": "引号注释未闭合"
    }
  ],
  "warnings": []
}
（退出码 3）
```

**⑤ 管道用法**（源码从 stdin 进来）：

```text
> "Q: 1 2 3 4 |" | ijipu cli lint -i -
没有发现问题 ✓
```

**⑥ 监视文件、改一次查一次**（`--watch`，Ctrl+C 结束）—— **只有独立 Node 包能用**：

```text
> ijipu.exe cli lint -i samples\ershenbu.jps --watch
--watch 需要宿主的文件监视能力（node 入口提供；独立环境不可用）
（退出码 1）
```

> ⚠ **「错误」让退出码变 3，「告警」不会**。例如 `Q: 1 2 x 4 |` 里的 `x` 是**告警**：

```text
> ijipu.exe cli lint -i 告警谱.jps
第 5 行：无法识别的符号 "x"
（退出码 0）
```

### 2.5 `info`：谱面概况

用途：一眼看清调号、行数、分组、问题数。选项：`-i`、`-t text|json`、`--json`。

**① 文本**：

```text
> ijipu.exe cli info -i samples\ershenbu.jps
文件：samples\ershenbu.jps
调号：C
源码行：17｜曲词分组：3｜字符：259
问题：错误 0 个、告警 0 个
```

**② JSON**（给脚本/CI 读）：

```text
> ijipu.exe cli info -i samples\ershenbu.jps --json
{
  "schema": 1,
  "generator": "ijipu 0.60.0",
  "input": "samples\\ershenbu.jps",
  "title": null,
  "key": "C",
  "lines": 17,
  "groups": 3,
  "errors": 0,
  "warnings": 0,
  "bytes": 259
}
```

**③ 管道用法**（源码从 stdin 进来；标题一行省略不打印）：

```text
> "Q: 1 2 3 4 |" | ijipu cli info -i -
文件：(stdin)
源码行：2｜曲词分组：1｜字符：14
问题：错误 0 个、告警 0 个
```

### 2.6 `render`：渲染导出

用途：把谱渲染成文件。选项：`-i`、`-t`、`-o`，以及画布范围 `--crop` / `--pad` / `--ink`。

**① SVG**（矢量，任意环境可用；推荐）：

```text
> ijipu.exe cli render -i samples\ershenbu.jps -t svg -o 我的谱.svg
已写入 我的谱.svg
```

**② MIDI**（二进制，**必须**用 `-o` 指定文件）：

```text
> ijipu.exe cli render -i samples\ershenbu.jps -t midi -o 我的谱.mid
已写入 我的谱.mid（MIDI，225 字节）
```

**③ 多页谱**：一页一个文件，文件名自动加 `-1` `-2` `-3`…

```text
> ijipu.exe cli render -i 长谱.jps -t svg -o 长谱.svg
已写入 长谱-1.svg、长谱-2.svg、长谱-3.svg
```

（那份 `长谱.jps` 是 `V: 1.0` + `D: C` + `P: 4/4` + **40 行** `Q: 1 2 3 4 | 5 6 5 - |`；把它复制几遍就能复现。）

**④ 不写 `-o`**：打到标准输出，页与页之间用一行 `<!-- 分页 -->` 分隔（适合接管道）：

```text
> ijipu.exe cli render -i samples\ershenbu.jps -t svg -o -
<svg xmlns="http://www.w3.org/2000/svg" width="595.28" height="841.89" viewBox="0 0 595.28 841.89">…
```

**⑤ 只导出「谱面那一块」**（裁掉纸张空白）：

```text
> ijipu.exe cli render -i samples\ershenbu.jps -t svg --crop score --pad 4 -o 我的谱.svg
已写入 我的谱.svg
```

`--crop` 取值 `page`（**缺省**，整页）或 `score`（墨迹范围）；`--pad` 是每边留白 px（0–64，缺省 2）；
量不到可信的墨迹盒时**明确报错退出**（不会静默退回整页）。

**⑥ 位图 / PDF 现在不可用**（`-t png` `-t jpg` `-t pdf` ⇒ 退出码 4，见 §3.2）：

```text
> ijipu.exe cli render -i samples\ershenbu.jps -t png -o 我的谱.png
-t png 需要"隐藏窗口渲染"通道（桌面端 exe 内置）；当前环境没有该能力。
  可用：-t svg（矢量，任意环境）｜或改用桌面端：ijipu cli render -i <谱> -t png -o <输出>
（退出码 4）
```

### 2.7 `play`：导出音频

用途：导出一份能播的音频。选项：`-i`、`-t midi|wav`、`-o`。

**① MIDI**（任意环境可用；同样**必须** `-o`）：

```text
> ijipu.exe cli play -i samples\ershenbu.jps -t midi -o 我的谱.mid
已写入 我的谱.mid（MIDI，225 字节）
```

**② WAV 现在不可用**（⇒ 退出码 4，见 §3.2）：

```text
> ijipu.exe cli play -i samples\ershenbu.jps -t wav -o 我的谱.wav
WAV 需要采样合成（音色库 + AudioContext），当前环境没有该能力。
  可用：-t midi（任意环境）｜或改用桌面端：ijipu cli play -i <谱> -t wav -o <输出.wav>
（退出码 4）
```

**③ MIDI 不能打到标准输出**（二进制；如实报用法错误）：

```text
> ijipu.exe cli render -i samples\ershenbu.jps -t midi
MIDI 是二进制，必须用 -o 指定文件（不能用 stdout）
（退出码 1）
```

### 2.8 `batch`：目录批量转换

用途：把一个目录里的 `.jps` 一次全转掉。选项：`--in <目录>`（等价 `-i`，stdin 不适用）、`-o <目录>`、`-t svg|midi|fmt`。

**① 批量出 SVG**（输出目录**会自动创建**）：

```text
> ijipu.exe cli batch --in samples -o 输出目录 -t svg
批处理完成：成功 7 个、失败 0 个（输出到 输出目录，类型 svg）
```

**② 批量出 MIDI / 批量规范化源码**（只换 `-t`）：

```text
> ijipu.exe cli batch --in samples -o 输出目录 -t midi
批处理完成：成功 7 个、失败 0 个（输出到 输出目录，类型 midi）

> ijipu.exe cli batch --in samples -o 输出目录 -t fmt
批处理完成：成功 7 个、失败 0 个（输出到 输出目录，类型 fmt）
```

**③ 个别谱有语法错误**：记进「失败」并**逐条列出**，整体退出码 3（其余照常产出）：

```text
> ijipu.exe cli batch --in 待检查 -o 输出目录 -t svg
批处理完成：成功 1 个、失败 1 个（输出到 输出目录，类型 svg）
  ✗ bad.jps（1 个语法错误）
（退出码 3）
```

### 2.9 `settings`：查某个设置项的值与来源

用途：看**某一个**设置项现在是多少、这个值从哪来。选项：`-i <谱>`、**键名当位置参数**、`-s k=v`（临时覆盖）。

**① 查一个键**：

```text
> ijipu.exe cli settings -i samples\ershenbu.jps margin_right
margin_right = 50   [来自：代码默认]
```

**② 看「换成别的值会怎样」**（**临时覆盖，不落盘**）：

```text
> ijipu.exe cli settings -i samples\ershenbu.jps margin_right -s margin_right=33
margin_right = "33"   [来自：命令行 -s]
```

来源优先级：**命令行 `-s` > 源内 `# jps-config` > 代码默认**。

**③ 键名漏了或对不上**：打印用法与可用键提示，退出码 1：

```text
> ijipu.exe cli settings -i samples\ershenbu.jps
settings 需要键名（位置参数），例如：settings -i <谱> margin_right
  可用键 35 个：settings -i <谱> -t effective 可全量列出；可选字段：heights、metaPos、lyricShrink、showInstrument、segmentRowGap
（退出码 1）
```

### 2.10 `config`：打印生效设置全表（含每项来源）

用途：一次看全部生效设置。选项：`-i <谱>`、`-t effective`、`--quiet`、`--json`。

**① 只看「非默认」的项**（`--quiet`）：

```text
> ijipu.exe cli config -i samples\ershenbu.jps -t effective --quiet
生效设置（来源：命令行 > 源内 # jps-config > 代码默认）
```

**② 去掉 `--quiet`**：逐行列出**全部**（含默认值），例如：

```text
> ijipu.exe cli config -i samples\ershenbu.jps -t effective
生效设置（来源：命令行 > 源内 # jps-config > 代码默认）
  page = "A4"   [代码默认]
  margin_top = 40   [代码默认]
  margin_bottom = 40   [代码默认]
  margin_left = 50   [代码默认]
  margin_right = 50   [代码默认]
  body_margin_top = 20   [代码默认]
  …
```

**③ 给脚本用**（`--json`）：

```text
> ijipu.exe cli config -i samples\ershenbu.jps --json
{
  "schema": 1,
  "rows": [
    {
      "key": "page",
      "value": "A4",
      "source": "代码默认"
    },
    {
      "key": "margin_top",
      "value": 40,
      "source": "代码默认"
    }
  ]
}
```

（上面为节选：`rows` 里每个键都有一项 `key` / `value` / `source`。）

### 2.11 `doctor`：环境自检

用途：一眼看清「这台机器上哪些 `-t` 现在能用」，省得撞到退出码 4 才知道。选项：`--json`。

```text
> ijipu.exe cli doctor
iJipu CLI doctor
  可设置项：35 个（含可选字段 5 个）
  能力：svg ✓｜midi ✓｜位图(png/jpg/pdf) ✗（需桌面端隐藏窗口渲染）｜音频(wav) ✗（需音色库合成）
  提示：位图/音频在桌面端 exe 内可用；独立 Node 环境只能用 svg/midi ✓

> ijipu.exe cli doctor --json
{
  "schema": 1,
  "generator": "ijipu 0.60.0",
  "engine": "ijipu-engine",
  "configKeys": 35,
  "capabilities": {
    "svg": true,
    "midi": true,
    "raster": false,
    "audio": false
  },
  "platform": "cli"
}
```

### 2.12 `completions`：shell 补全

用途：让终端帮你补命令名。用法：`completions bash|zsh|powershell`（**先注册 PATH 才有意义**）。

**① PowerShell**（照提示那一行执行就装上了）：

```text
> ijipu.exe cli completions powershell
# iJipu PowerShell 补全（桌面端）：ijipu cli completions powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName ijipu -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  @('format','lint','info','render','play','batch','settings','config','doctor','completions','register','unregister','status') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
```

**② bash**：

```text
> ijipu.exe cli completions bash
# iJipu bash 补全（桌面端）：source <(ijipu cli completions bash)
_ijipu() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=( $(compgen -W "format lint info render play batch settings config doctor completions register unregister status" -- "$cur") ); return; fi
…
```

**③ zsh**：

```text
> ijipu.exe cli completions zsh
# iJipu zsh 补全（桌面端）：ijipu cli completions zsh > "${fpath[1]}/_ijipu"
#compdef ijipu
…
```

**④ 写错 shell 名字**：如实报支持哪三种（退出码 1）：

```text
> ijipu.exe cli completions foo
completions 支持 bash | zsh | powershell（收到 “foo”）
（退出码 1）
```

### 2.13 `register` / `unregister` / `status`：注册与解除

用途：把命令行入口目录写进/移出**当前用户**的 PATH，以及查现在是什么状态。选项：`--json`。
这三个命令**只在桌面版能用**（要读写注册表，见 §3.4）。

**① 看状态**（**读系统实况**：你在「环境变量」里手改过也如实反映）：

```text
> ijipu.exe cli status
iJipu CLI 注册状态：已注册 ✓（终端里可以直接敲 ijipu）
  安装目录：C:\Users\<你>\AppData\Local\iJipu
  命令行入口目录（写进 PATH 的就是它）：C:\Users\<你>\AppData\Local\iJipu\bin
  当前用户 PATH：558 / 2047 字符
  App Paths：C:\Users\<你>\AppData\Local\iJipu\ijipu.exe
```

（未注册时第一行是 `iJipu CLI 注册状态：未注册 ✗（终端里还敲不了 ijipu）`，并多一行以 `注册：` 开头的提示。）

**② 给脚本用**（`--json`：读 `registered` 就能判断，比解析上面那段文案稳）：

```text
> ijipu.exe cli status --json
{
  "schema": 1,
  "registered": true,
  "installDir": "C:\\Users\\<你>\\AppData\\Local\\iJipu",
  "binDir": "C:\\Users\\<你>\\AppData\\Local\\iJipu\\bin",
  "legacy": false,
  "pathLength": 558,
  "pathLimit": 2047,
  "pathValue": "……（当前用户 PATH 的完整值）",
  "appPaths": "C:\\Users\\<你>\\AppData\\Local\\iJipu\\ijipu.exe"
}
```

（`installDir` / `pathValue` / `appPaths` 里的用户名与 PATH 已按 `<你>` 与省略处理 —— 原文是这台机器上的真实值。）

**③ 注册**（**幂等**：已注册再注册一个字都不写）：

```text
> ijipu.exe cli register
已注册 ✓ 命令行入口目录已加入当前用户 PATH：C:\Users\<你>\AppData\Local\iJipu\bin
  · 请**新开一个终端**，之后就能直接敲：ijipu cli lint 我的谱.jps
  · 只对当前用户生效，不需要管理员权限

> ijipu.exe cli register
已是注册状态 ✓（PATH 里本来就有这一条，未重复写入）：C:\Users\<你>\AppData\Local\iJipu\bin
```

**④ 解除**（只摘掉自己那一条，**其余 PATH 条目逐字不动**）：

```text
> ijipu.exe cli unregister
已解除 ✓ 已从当前用户 PATH 里摘掉：C:\Users\<你>\AppData\Local\iJipu\bin
  · 其余 PATH 条目**逐字未动**；新开的终端里就不再能直接敲 ijipu 了
```

没注册过的时候再敲一次 `unregister` 也**不会改动 PATH**（退出码 0，提示「本就未注册 ✓」）——这三个命令都是
幂等的，脚本里反复跑不会把 PATH 写坏：`ijipu cli register` / `ijipu cli unregister` 都可以重复执行。

**⑤ 上限**：PATH 值超过 **2047 字符**就**不写**（明确报错 + 给出三条可执行建议：先清理失效目录 /
把应用装到更短的路径 / 直接用完整路径调用）。原因见 `docs/CLI.md`。

**⑥ 顺带的便利**：注册时还会写 `HKCU\...\App Paths\ijipu.exe`（指向我们的 exe），于是「运行」对话框、
资源管理器地址栏敲 `ijipu` 也能起来；解除时**只删指向我们的那一条**。

### 2.14 常见用法（照抄这五段就够）

**① 单文件：检查 + 规范化 + 出图**（最常用的一串）：

```text
> ijipu cli lint -i 我的谱.jps
> ijipu cli format -i 我的谱.jps --check
> ijipu cli render -i 我的谱.jps -t svg -o 我的谱.svg
```

一句话：`lint` 看有没有错，`format --check` 看合不合规范，`render` 出图。三条的退出码分别能当判据（0 才是过）。

**② 批量检查多份谱**（一整目录）：

```text
> ijipu cli batch --in 乐谱 -o 输出 -t svg
批处理完成：成功 7 个、失败 0 个（输出到 输出，类型 svg）
```

一句话：一次转完整个目录；有错的会逐条列在下面，整体退出码 3。只想规范化源码就把 `-t` 换成 `fmt`。

**③ 导出 SVG / MIDI**：

```text
> ijipu cli render -i 我的谱.jps -t svg -o 我的谱.svg
已写入 我的谱.svg
> ijipu cli render -i 我的谱.jps -t midi -o 我的谱.mid
已写入 我的谱.mid（MIDI，225 字节）
```

一句话：矢量图给人看/打印，MIDI 拿去编曲软件；要多页谱就照原样敲，程序自己加 `-1` `-2`。

**④ 在 CI / 提交前钩子里跑**（靠退出码判断，别解析文案）：

```text
> ijipu cli lint -i 乐谱 --format gh
```

一句话：`--format gh` 的每一行都是 GitHub Actions 注解，问题会直接标在 diff 上。
提交前钩子里可以用 `ijipu cli format -i 我的谱.jps --check`（不合规 ⇒ 退出码 3 ⇒ 拦下提交）。

**⑤ 注册之后仍要写 `cli`**：见 §1.4 —— 注册省掉的是**路径**，不是 `cli`；
`ijipu lint 我的谱.jps` ✗ 会**打开图形界面**、什么也没检查。

---

## 三、能力与限制

### 3.1 现在哪些能用

| 能力 | 现在能用吗 | 说明 |
| --- | --- | --- |
| `format` / `lint` / `info` / `batch` / `settings` / `config` / `doctor` | ✓ | 纯计算，任意环境 |
| `render -t svg` | ✓ | 矢量图，任意环境 |
| `render -t midi` / `play -t midi` | ✓ | 二进制 MIDI，**必须 `-o` 指定文件**（不能打 stdout） |
| `render -t png` `-t jpg` `-t pdf` | ✗ 退出码 4 | 需要 canvas / 字体 / 分页 ⇒ 请用应用里的「导出」 |
| `play -t wav` | ✗ 退出码 4 | 需要音色库采样合成 ⇒ 请用应用里的试听/导出 |
| `lint --watch` | ✗ 退出码 1 | 需要文件监视能力。**内嵌版没有**该能力；**独立 Node 包**（`@ijipu/cli`）可用 ✓ |
| `register` / `unregister` / `status` | ✓（仅桌面版） | 要读写当前用户的注册表；独立 Node 环境 ⇒ 退出码 6 |

> 拿不准就先跑一次 `ijipu cli doctor`（§2.11）——它如实报告每一项能力有没有。

### 3.2 位图 / PDF / WAV：现在都不可用（退出码 4）

`-t png` / `-t jpg` / `-t pdf`（`render`）与 `-t wav`（`play`）现在都会**如实报错**（退出码 4 + 原因），
**不会产出半成品**。实跑输出见 §2.6 ⑥、§2.7 ②。要位图/PDF/WAV，请在**应用**里用「导出」与试听
（那条路径有完整的画布、字体与音色库）。这条通道的设计口径与落地状态见 `docs/CLI.md`。

> `-t svg` 与 `-t midi` 是命令行现在可靠的两种产出。

### 3.3 `lint --watch`：只有独立 Node 包能用

`--watch`（改一次文件就重查一次）需要"文件监视"这项能力：**内嵌版没有**该能力 ⇒ 退出码 1（见 §2.4 ⑥）；
独立 Node 包有 ⇒ 可用。两种形态都**不能对 stdin 用**（要监视具体文件）。

### 3.4 两条交付路径的差别

跑的是**同一份命令逻辑**，差别只在"谁提供能力"：

| 路径 | 命令形态 | 注册表能力 | 位图/音频 |
| --- | --- | --- | --- |
| **内嵌版**（装过应用就有） | `ijipu.exe cli <命令>`（注册后 `ijipu cli <命令>`） | ✓ 有 | ✗ 现在都报退出码 4 |
| **独立 Node 包**（`@ijipu/cli`，给 CI / 没装应用的环境） | `ijipu <命令>`（`npm i -g` 装上后**没有 `cli` 这一层**） | ✗ **退出码 6** | ✗ 同上 |

独立 Node 环境跑注册类命令时是这样（**刻意与"用法错误 1"分开**，脚本据此就知道该换个环境再跑）：

```text
> node packages\ijipu-cli\dist\ijipu.cjs register
“register”需要读写当前用户的 PATH/注册表，这个能力由**桌面端**注入（内嵌 CLI）。
  请改用：ijipu.exe cli register（独立 Node 环境没有该能力 ⇒ 退出码 6）
（退出码 6）
```

### 3.5 几条平台限制（Windows）

- **别直接调 `ijipu.exe` 当命令行用** —— 输出顺序、退出码、`>` 重定向都会坏（§1.3）；走 `ijipu`（注册后）或垫片完整路径。
- **注册后要新开一个终端**才敲得到 `ijipu`（已开着的终端看不到新 PATH）。
- **补全脚本对 `ijipu` 这个命令名生效** ⇒ 先注册 PATH 才有意义。

---

## 四、退出码表

脚本请按**退出码**判断，不要解析文案（文案会改，码不会）。

| 码 | 含义 | 典型触发 |
| --- | --- | --- |
| `0` | 成功 | 一切正常（含 `lint` 只有告警） |
| `1` | **用法错误** | 未知命令/选项、缺参数、`--watch` 没有监视能力 |
| `2` | **输入不存在或读失败** | `-i` 指的文件不在、路径写错 |
| `3` | **语法错误** | `lint` 命中错误；`format --check` 认为需要格式化；`render`/`play` 遇到错误源码 |
| `4` | **渲染失败** | 需要位图/音频能力但当前环境没有（`png`/`jpg`/`pdf`/`wav`） |
| `5` | **设置非法** | `--config`（尚未实现）、`-s` 用了不接受的命令 |
| `6` | **环境能力缺失** | 注册类命令在独立 Node 环境跑、PATH 超长写不进去 |
| `70` | **接线层自身出错**（仅内嵌版） | 内嵌脚本加载失败等内部异常 —— 不是「用法错误」，脚本别混为一谈 |

---

## 五、许可与源码

iJipu（爱记谱）以 **GNU Affero General Public License v3.0（AGPL-3.0）** 发布，
全文随安装目录放在 `LICENSE`；第三方组件与音色库的许可见安装目录的 `THIRD-PARTY.md`。

- 源码：<https://github.com/snailhome/ijipu>
- 官网 / 在线版：<https://ijipu.pages.dev>

欢迎学习、修改与再分发。
