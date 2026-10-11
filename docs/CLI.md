# iJipu 命令行（CLI）操作手册

> 方案与决策见 `docs/CLI-AND-COMMAND-PLAN.md`（**① 同一个 exe 带子命令 ② 位图/音频走隐藏窗口渲染
> ③ 嵌入版 RPC 默认关闭 + 仅 vault 内路径**）。
> 阶段状态：**P1 已实现**（`format` / `lint` / `info`）；P2（`render`/`play`/`batch`）、
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

未实现（**会报错**）：`render` `play` `batch` `settings` `config` `doctor` `completions`。

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

# 9) 一次性批量（P2 之前用 PowerShell 循环兜住）
Get-ChildItem *.jps | ForEach-Object {
  npm run cli -- format -i $_.FullName --check --quiet
  if ($LASTEXITCODE -ne 0) { Write-Host "需格式化：$($_.Name)" }
}
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
