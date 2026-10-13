# iJipu 命令行使用手册

> 这份文件讲**怎么用**（面向使用者）。命令行的**设计口径、协议与维护说明**在
> `docs/CLI.md`（面向改代码的人）——两份分工不同，别把维护细节抄到这里。
>
> - 适用版本：**iJipu 0.58.0**（内嵌命令行 `adj942` / 注册 PATH `adj944` 起 /
>   **控制台垫片 `bin\ijipu.cmd` `adj946` 起**）
> - 许可：**AGPL-3.0** ｜ 源码与问题反馈：<https://github.com/snailhome/ijipu>
> - 装完 iJipu 就有命令行，**不需要另外装 Node**，也不需要联网。

---

## 一、一分钟上手

### 1.1 调用形态：`ijipu cli <命令>`

装了 iJipu 之后，`ijipu.exe` 就在**安装目录**里（默认 `%LOCALAPPDATA%\iJipu`）。
让它跑命令行，要显式写第一个参数 `cli`：

```text
ijipu.exe cli <命令> [选项]
```

- 只是查看用法、版本号，可以直接敲（不用注册）：

  ```text
  > "%LOCALAPPDATA%\iJipu\bin\ijipu.cmd" cli --version
  iJipu 0.58.0
  ```

  ⚠ 上面用的是**命令行入口垫片**（`bin\ijipu.cmd`）。若直呼 `ijipu.exe` 本体，
  **cmd 不会等它**（GUI 子系统程序）⇒ 输出顺序、退出码、`>` 重定向都不可靠（原因见 §1.3）；
  注册之后（§1.2）这两种路径都可以写成简短的一句：`ijipu cli <命令> [选项]` ✓

- ⚠ **第一个参数必须恰好是 `cli`**。不带 `cli` 时（双击 `.jps`、`ijipu.exe 我的谱.jps`）
  照旧**打开图形界面** —— 命令行与图形界面用的是同一个 exe，靠这个参数分流。
  垫片是**透明**的（参数原样转交），所以你敲的仍然是 `ijipu cli …`，不是 `ijipu lint …`。

### 1.2 注册之后，终端里直接敲 `ijipu cli …`（推荐）

每次都写一大串完整路径太麻烦。在应用的
**底栏 →「全局」→「命令行」** 子页签里点一次「**注册**」，就进了
**当前用户**的 PATH，之后新开的终端里可以直接敲：

```text
> ijipu cli lint 我的谱.jps
```

**注册进去的是「命令行入口目录」`<安装目录>\bin`**，里面放的是一个小小的控制台垫片
`bin\ijipu.cmd`（`ijipu.exe` 本体**不进 PATH**）。这样做的原因见 §1.3 —— 一句话：
**现在直接敲即可，输出顺序、退出码、重定向都正常**。

> **旧终端要重开**：注册只对新起的进程生效（已经开着的终端在启动那一刻就把环境变量固定了）。
> 注册后**新开一个终端**才敲得到 `ijipu`。

注册等价于在终端里跑（两者是同一份实现）：

```text
> "%LOCALAPPDATA%\iJipu\ijipu.exe" cli register
已注册 ✓ 命令行入口目录已加入当前用户 PATH：C:\Users\<你>\AppData\Local\iJipu\bin
  · 请**新开一个终端**，之后就能直接敲：ijipu cli lint 我的谱.jps
  · 只对当前用户生效，不需要管理员权限
  · 这一条是**命令行入口目录**（里面有控制台垫片 ijipu.cmd）：输出顺序、退出码、重定向都正常 ✓，
    双击 .jps 照旧打开界面、不闪黑框
```

三条必须知道的事：

| 事项 | 说明 |
|---|---|
| **要新开一个终端** | 已经开着的终端里，环境变量在进程启动那一刻就固定了，**看不到**新加的 PATH。注册后**新开一个终端**才生效。 |
| **只对当前用户生效** | 只写当前用户的 PATH（`HKCU\Environment\Path`），**不需要管理员权限**，不动系统级 PATH，也不动别的用户。 |
| **随时可以解除** | `ijipu cli unregister`（或设置里那个按钮）会把自己那一条摘掉，**其余条目逐字不动**。卸载应用时也会自动解除。 |

### 1.3 为什么要有那个 `bin\ijipu.cmd` 垫片（Windows 控制台那点事）

`ijipu.exe` 是 **GUI 子系统**程序（好处是双击 `.jps` 不弹黑框）。代价是
**cmd 与 PowerShell 都不会等它跑完** —— 这是 Windows 的固有行为，不是本命令行的毛病
（`code.exe`、`sublime_text.exe` 也一样）：

- cmd 会**先把下一个提示符打出来**，我们的输出随后才补上去 ⇒ 看起来「每一行前面都多一个提示符」；
- `%ERRORLEVEL%` / `$LASTEXITCODE` 留下的是**上一条命令**的值 ⇒ 脚本判断不了成败；
- PowerShell 的 `>` 会写出一个 **0 字节**文件；`Start-Process -Wait -PassThru` 才拿得到退出码。

**现在这些问题都没有了**：PATH 里放的是控制台垫片 `bin\ijipu.cmd`，而 **cmd 会等批处理文件**
⇒ 输出顺序、退出码、`>` 重定向一次性都正常，同时 `ijipu.exe` 仍是 GUI 程序（双击照旧不闪黑框）。

| 写法 | 输出看得见吗 | 拿得到退出码吗 |
|---|---|---|
| `ijipu cli lint 我的谱.jps`（垫片，注册之后） | ✓ 紧跟在自己那条命令后面 | ✓ `%ERRORLEVEL%` / `$LASTEXITCODE` |
| `ijipu cli lint 我的谱.jps > out.txt` | ✓ 真写进文件（UTF-8，不再是 0 字节） | ✓ |
| 直接调 exe：`"%LOCALAPPDATA%\iJipu\ijipu.exe" cli lint 我的谱.jps` | ✗ 提示符会夹在输出中间 | ✗ 拿到的是旧值 |
| 绕过垫片时的老办法：PowerShell `Start-Process -Wait -PassThru -NoNewWindow` | ✓（要 `-NoNewWindow`） | ✓ `$p.ExitCode` |

> **兜底**：不想注册 PATH 时，用垫片的**完整路径**调用也一样好 ——
> `"%LOCALAPPDATA%\iJipu\bin\ijipu.cmd" cli lint 我的谱.jps` ✓
> （**别**直接调 `ijipu.exe`：上面表格第 3 行那两条毛病会回来。）
>
> 垫片是**透明**的：它只把参数原样转给 `ijipu.exe`，**不会**替你补 `cli` 子命令 ⇒
> 命令行形态仍然是 `ijipu cli <命令>`；`ijipu 我的谱.jps`（不带 `cli`）照旧打开图形界面。

---

## 二、命令集（逐条：真实示例 + 真实输出）

下面每条的示例都在 Windows 上真跑过；示例用的谱是**随包自带的示例谱**
（`samples\ershenbu.jps`，也可在应用「示例」里打开）。

| 命令 | 一句话作用 |
|---|---|
| `format` | 按应用规范**规范化源码** |
| `lint` | 语法检查（有错 ⇒ 退出码 3） |
| `info` | 谱面概况（行数 / 分组 / 问题数） |
| `render` | 渲染导出：`-t svg \| midi \| png \| jpg \| pdf` |
| `play` | 导出音频：`-t midi \| wav` |
| `batch` | 目录批量转换（SVG / MIDI / 规范化源码） |
| `settings` | 查**某一个设置项**的值与来源 |
| `config` | 打印**生效设置全表**与每项来源 |
| `doctor` | 环境自检（如实报告能力有无） |
| `completions` | 输出 shell 补全脚本 |
| `register` | 把安装目录注册进当前用户 PATH |
| `unregister` | 从当前用户 PATH 里解除注册 |
| `status` | 看现在注册了没有（读系统实况） |

### `--version` / `--help`

```text
> ijipu.exe cli --version
iJipu 0.58.0

> ijipu.exe cli --help
iJipu 命令行（爱记谱）

用法：ijipu [全局选项] <命令> [命令选项]

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
  register      [--json]                                                      把安装目录注册进当前用户 PATH
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
```

> 帮助文本里的命令与选项**就是从程序里读出来的** —— 以 `ijipu.exe cli --help` 为准，
> 这份手册若与它不一致，是手册过期了。

### `lint`：语法检查

```text
> ijipu.exe cli lint -i samples\ershenbu.jps
没有发现问题 ✓
```

有错时**逐条打印**，并给出**退出码 3**：

```text
> ijipu.exe cli lint -i 我的谱.jps
第 5 行：引号注释未闭合
（退出码 3）
```

给 CI 用（GitHub Actions 注解格式，每个问题一行 `::error`）：

```text
> ijipu.exe cli lint -i 我的谱.jps --format gh
::error file=我的谱.jps,line=5::引号注释未闭合
```

机器可读（`--json`）：

```text
> ijipu.exe cli lint -i 我的谱.jps --json
{
  "schema": 1,
  "generator": "ijipu 0.58.0",
  "input": "我的谱.jps",
  "ok": false,
  "errors": [
    {
      "line": 5,
      "message": "引号注释未闭合"
    }
  ],
  "warnings": []
}
```

> ⚠ 「错误」让退出码变 3，「告警」不会 —— 例如 `Q: 1 2 x 4 |` 里的 `x` 是**告警**
> （`第 5 行：无法识别的符号 "x"`，退出码仍是 0）。

### `format`：规范化源码

```text
> ijipu.exe cli format -i samples\ershenbu.jps --check
已符合规范 ✓
（退出码 0）
```

需要格式化时（`--check` 不改文件，只表态）：

```text
> ijipu.exe cli format -i 我的谱.jps --check
需要格式化 ✗
（退出码 3）
```

看差异（`-` 原样 / `+` 规范化后）：

```text
> ijipu.exe cli format -i 我的谱.jps --diff
- Q:1 2 3 4|
+ Q: 1 2 3 4 |
```

原地改写（**必须显式** `--in-place`，且只能对文件、不能对 stdin）：

```text
> ijipu.exe cli format -i 我的谱.jps --in-place
已原地格式化：我的谱.jps
```

写到另一个文件 / 标准输出：

```text
> ijipu.exe cli format -i 我的谱.jps -o 我的谱.规范化.jps
已写入 我的谱.规范化.jps

> ijipu.exe cli format -i 我的谱.jps -o -
```

### `info`：谱面概况

```text
> ijipu.exe cli info -i samples\ershenbu.jps
文件：samples\ershenbu.jps
调号：C
源码行：17｜曲词分组：3｜字符：259
问题：错误 0 个、告警 0 个
```

```text
> ijipu.exe cli info -i samples\ershenbu.jps --json
{
  "schema": 1,
  "generator": "ijipu 0.58.0",
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

### `render`：渲染 / 导出（`-t svg|midi|png|jpg|pdf`）

**SVG（矢量，任意环境可用）**：

```text
> ijipu.exe cli render -i samples\ershenbu.jps -t svg -o 我的谱.svg
已写入 我的谱.svg
```

多页谱会写成 `我的谱-1.svg`、`我的谱-2.svg`…；不写 `-o` 就打到标准输出
（页与页之间用一行 `<!-- 分页 -->` 分隔）。

**MIDI**：

```text
> ijipu.exe cli render -i samples\ershenbu.jps -t midi -o 我的谱.mid
已写入 我的谱.mid（MIDI，225 字节）
```

**只想导出「谱面那一块」**（裁掉纸张空白）：

```text
> ijipu.exe cli render -i samples\ershenbu.jps -t svg --crop score --pad 4 -o 我的谱.svg
已写入 我的谱.svg
```

`--crop` 取值 `page`（**缺省**，整页）或 `score`（墨迹范围）；`--pad` 是每边留白 px（0–64，缺省 2）；
量不到可信的墨迹盒时**明确报错退出**（不会静默退回整页）。

**位图 / PDF（`png` / `jpg` / `pdf`）**：需要「隐藏窗口渲染」通道（canvas、字体、分页）。
当前版本**通道尚未接线**，所以在任何环境下都会**如实报错**（退出码 4），不会产出半成品：

```text
> ijipu.exe cli render -i 我的谱.jps -t png -o 我的谱.png
-t png 需要"隐藏窗口渲染"通道（桌面端 exe 内置）；当前环境没有该能力。
  可用：-t svg（矢量，任意环境）｜或改用桌面端：ijipu render -i <谱> -t png -o <输出>
（退出码 4）
```

> 现在要位图/PDF，请在**应用的「导出」**里做（那条路径有完整的 canvas 与字体）。
> `-t svg` 与 `-t midi` 是当前命令行可靠的两种产出。

### `play`：导出音频（`-t midi|wav`）

```text
> ijipu.exe cli play -i samples\ershenbu.jps -t midi -o 我的谱.mid
已写入 我的谱.mid（MIDI，225 字节）
```

**WAV** 需要采样合成（音色库 + AudioContext）——同「隐藏窗口渲染」，当前**如实报错（退出码 4）**：

```text
> ijipu.exe cli play -i 我的谱.jps -t wav -o 我的谱.wav
WAV 需要采样合成（音色库 + AudioContext），当前环境没有该能力。
  可用：-t midi（任意环境）｜或改用桌面端：ijipu play -i <谱> -t wav -o <输出.wav>
（退出码 4）
```

### `batch`：目录批量转换

```text
> ijipu.exe cli batch --in samples -o 输出目录 -t svg
批处理完成：成功 7 个、失败 0 个（输出到 输出目录，类型 svg）
```

- `-t` 取 `svg`（缺省）/ `midi` / `fmt`（规范化源码）；
- 输出目录**会自动创建**；某个谱有语法错误 ⇒ 记进「失败」并**逐条列出**，整体退出码 3；
- 输入目录写 `--in`（等价于 `-i`；stdin 不适用）。

### `settings`：查某个设置项的值与来源

先把键名当**位置参数**给：

```text
> ijipu.exe cli settings -i samples\ershenbu.jps margin_right
margin_right = 50   [来自：代码默认]
```

想看「换成别的值会怎样」（**临时覆盖，不落盘**）：

```text
> ijipu.exe cli settings -i samples\ershenbu.jps margin_right -s margin_right=33
margin_right = "33"   [来自：命令行 -s]
```

来源优先级：**命令行 `-s` > 源内 `# jps-config` > 代码默认**。

### `config`：打印生效设置全表（含每项来源）

```text
> ijipu.exe cli config -i samples\ershenbu.jps -t effective --quiet
生效设置（来源：命令行 > 源内 # jps-config > 代码默认）
```

`--quiet` = 只列**非默认**的项；去掉 `--quiet` 会逐行列出全部（含默认值），例如：

```text
  page = "A4"   [代码默认]
  margin_top = 40   [代码默认]
  margin_right = 50   [代码默认]
  noteSpaceLayout = "space"   [代码默认]
  …
```

加 `--json` 得到 `{ "schema": 1, "rows": [{ "key", "value", "source" }] }`。

### `doctor`：环境自检

```text
> ijipu.exe cli doctor
iJipu CLI doctor
  可设置项：35 个（含可选字段 5 个）
  能力：svg ✓｜midi ✓｜位图(png/jpg/pdf) ✗（需桌面端隐藏窗口渲染）｜音频(wav) ✗（需音色库合成）
  提示：位图/音频在桌面端 exe 内可用；独立 Node 环境只能用 svg/midi ✓
```

先跑这个能一眼看清「这台机器上哪些 `-t` 现在能用」，省得撞到退出码 4 才知道。

### `completions`：shell 补全

```text
> ijipu.exe cli completions powershell
# iJipu PowerShell 补全：ijipu completions powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName ijipu -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  @('format','lint','info','render','play','batch','settings','config','doctor','completions','register','unregister','status') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
```

按提示「照着那一行执行」就装上了；也支持 `bash` / `zsh`。
（补全对 `ijipu` 这个命令名生效 ⇒ 先注册 PATH 才有意义。）

### `register` / `unregister` / `status`

```text
> ijipu.exe cli status
iJipu CLI 注册状态：未注册 ✗（终端里还敲不了 ijipu）
  安装目录：C:\Users\<你>\AppData\Local\iJipu
  命令行入口目录（写进 PATH 的就是它）：C:\Users\<你>\AppData\Local\iJipu\bin
  当前用户 PATH：519 / 2047 字符
  App Paths：（未注册）
  注册：ijipu cli register（注册后**新开一个终端**才生效；只对当前用户生效、不需要管理员）
```

```text
> ijipu.exe cli register
已注册 ✓ 命令行入口目录已加入当前用户 PATH：C:\Users\<你>\AppData\Local\iJipu\bin
  · 请**新开一个终端**，之后就能直接敲：ijipu cli lint 我的谱.jps
  · 只对当前用户生效，不需要管理员权限
  · 这一条是**命令行入口目录**（里面有控制台垫片 ijipu.cmd）：输出顺序、退出码、重定向都正常 ✓，
    双击 .jps 照旧打开界面、不闪黑框

> ijipu.exe cli register        # 再点一次：幂等，一个字都不写
已是注册状态 ✓（PATH 里本来就有这一条，未重复写入）：C:\Users\<你>\AppData\Local\iJipu\bin
```

```text
> ijipu.exe cli unregister
已解除 ✓ 已从当前用户 PATH 里摘掉：C:\Users\<你>\AppData\Local\iJipu\bin
  · 其余 PATH 条目**逐字未动**；新开的终端里就不再能直接敲 ijipu 了
```

三条口径：

- **状态读系统实况**：`status` 现读 `HKCU\Environment\Path`，你在「环境变量」里手改过也如实反映；
- **幂等**：已注册再注册不重复追加；未注册再解除不改动 PATH；
- **上限 2047 字符**：注册后会超过就不写（明确报错 + 给出三条可执行建议），
  因为「写了之后某些老程序读不全」这类问题最难查。

> **从旧版本升上来的（`adj944` 那会儿注册的是「安装目录本身」）**：`status` 会把那一形态
> 标成 `legacy`（并**按未注册**报，因为那条会跟垫片抢 `ijipu`）；点一次「注册」就会
> **把它换成 `bin` 目录**，`unregister` 则**两种形态都摘**。设置的「命令行」页签里也会直接提示。

> 这三个命令**要读写当前用户的注册表**，只有**桌面端**（`ijipu.exe cli …`）能做。
> 用独立 Node 包跑会**如实报退出码 6**，并提示改用内嵌版（见 §三）。

### 全局选项速查

| 选项 | 含义 |
|---|---|
| `-i, --input <文件\|->` | 输入文件；`-` = stdin（省略时也读 stdin）；`--in` 是别名 |
| `-o, --output <文件\|->` | 输出文件；`-` 或省略 = stdout |
| `-t, --type <类型>` | 输出类型；省略时按 `-o` 后缀推断 |
| `--json` | 机器可读输出（带 `"schema": 1`，给脚本/CI 用） |
| `--quiet` | 不输出非必要信息 |
| `--deterministic` | 输出不含时间戳（CI 逐字节比对用） |
| `-s <k=v>` | 临时设置（可重复；优先级最高，**不落盘**） |
| `--config <文件>` | CLI 配置文件（**尚未实现**；给了 ⇒ 退出码 5） |
| `-h, --help` / `-v, --version` | 帮助 / 版本号 |

---

## 三、能力与限制

| 能力 | 现在能用吗 | 说明 |
|---|---|---|
| `format` / `lint` / `info` / `batch` / `settings` / `config` / `doctor` | ✓ | 纯计算，任意环境 |
| `render -t svg` | ✓ | 矢量图，任意环境 |
| `render -t midi` / `play -t midi` | ✓ | 二进制 MIDI，必须 `-o` 指定文件（不能打 stdout） |
| `render -t png \| jpg \| pdf` | ✗ 退出码 4 | 需要 canvas / 字体 / 分页（「隐藏窗口渲染」通道，尚未接线）⇒ 用应用里的「导出」 |
| `play -t wav` | ✗ 退出码 4 | 需要音色库采样合成 ⇒ 用应用里的试听/导出 |
| `lint --watch` | ✗ 退出码 1 | 需要文件监视能力（内嵌 CLI 没有） |
| `register` / `unregister` / `status` | ✓（仅内嵌版） | 要读写注册表；独立 Node 环境 ⇒ 退出码 6 |

**两条交付路径的差别**（跑的是同一份命令逻辑）：

| 路径 | 形态 | 注册表能力 | 位图/音频 |
|---|---|---|---|
| **内嵌版**（装过应用就有） | `ijipu.exe cli <命令>` | ✓ 有 | ✗ 现在都报退出码 4 |
| **独立 Node 包** `@ijipu/cli` | `ijipu <命令>`（`npm i -g`） | ✗ **退出码 6** | ✗ 同上 |

独立 Node 环境跑注册类命令时是这样（**刻意与"用法错误 1"分开**，脚本据此就知道该换个环境再跑）：

```text
> node packages\ijipu-cli\dist\ijipu.cjs register
“register”需要读写当前用户的 PATH/注册表，这个能力由**桌面端**注入（内嵌 CLI）。
  请改用：ijipu.exe cli register（独立 Node 环境没有该能力 ⇒ 退出码 6）
（退出码 6）
```

---

## 四、退出码表

脚本请按**退出码**判断，不要解析文案（文案会改，码不会）。

| 码 | 含义 | 典型触发 |
|---|---|---|
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
