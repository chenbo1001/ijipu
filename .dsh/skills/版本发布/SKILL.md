---
name: 版本发布
description: JianpuScript / iJipu「更新提交」的固化流程：把一次改动落地为正式发布——判定版本递增（SemVer）、同步文档（CHANGELOG 当版条目 + ERRORS-LOG 排错条目与变更记录表 + SYNTAX/SETTINGS-AUDIT/VERSIONING）、同步 6 处版本号（version.ts / package.json / tauri.conf.json / package-lock.json×2 / 引擎包）、过验证门（tsc -b + lint + build + smoke 必须 0 失败）、Conventional 提交（中文信息经 UTF-8 文件传入）、打 tag 与推送、桌面打包与 check:installer、生成只含当版的 release-body、建/核对 GitHub Release（gh 需已登录）、涉及引擎改动时同步 obsidian-ijipu/vendor/engine 并按插件自身更新量发插件版本。当用户说"更新提交""发布版本""递增版本号""准备发布""打新版本"，或功能/修复开发完成需要落地时使用。
whenToUse: 仅当一次改动需要走完整发布链（判版本 → 文档 → 版本号 → 验证 → 提交/tag/推送 → 打包 → Release，涉引擎再加插件同步链）时使用。只改代码不发布→直接改；只打包→「编译应用」技能；只跑测试→「环境运行与测试」技能；只同步语法文档→「语法规范同步」技能。
---

# 版本发布（触发词：**更新提交**）

> 权威细则仍以 `docs/VERSIONING.md` 为准；本技能是它的**可执行分解**（原子操作 + 流程链 + 实测踩坑）。
> 本轮（v0.22.0 / 插件 0.9.1）整串跑通后的固化版本。

## 0. 心智模型

```
                 ┌── CHAIN-A：应用发布（每次「更新提交」都走）
   改动就绪 ────┤   OP-01 冻结 → OP-02 判版本 → OP-03 文档 → OP-04 版本号 → OP-05 验证门
                 │   → OP-06 提交 → OP-07 tag+推送 → OP-08 打包 → OP-09 安装包自检
                 │   → OP-10 release-body → OP-11 GitHub Release
                 └── CHAIN-B：引擎联动（仅当改过 packages/ijipu-engine/src/engine/**）
                     OP-12 同步 vendor → OP-13 插件自检 → OP-14 插件版本+发布说明
                     → OP-15 插件提交/tag/推送（CI 自动建 Release）
   收尾：OP-16 两库核对
```

**三条铁律**（踩过坑，别再犯）：

1. **验证门必须是 0 失败**——`npm run smoke` 不接受"N == 基线"（旧「18 条基线」已清零，见 `docs/VERSIONING.md` 第 4 条）。
2. **打包必须在提交之后**——构建信息要带发布提交号（`gen:info` 读 `.git` 取 commit）。
3. **中文文本一律经 UTF-8 文件进出**——提交信息用 `write` 工具落盘后 `git commit -F`；**禁止** PowerShell 内联中文/`Set-Content` 改源码（会重编码报废，见 `E-2026-164` 末条）。

---

## 1. 原子操作（OP：各自可独立执行、各有验证点）

| OP | 操作 | 动作 / 命令 | 验证点 |
|---|---|---|---|
| **OP-01** | 冻结改动 | `git status --short`（**含未跟踪**）；逐项确认归属：自己的 / 用户自带的（如 `public/samples/*.jps`、`copy2ob.bat`） | 没有"不知道哪来的"改动；未跟踪文件明确"提交/不提交" |
| **OP-02** | 判定版本 | 看内容大小定 MAJOR/MINOR/PATCH（拿不准偏 MINOR）；**三处独立判**：应用版本、引擎包版本、插件版本 | 版本号写进后续所有文件前先定死 |
| **OP-03** | 同步文档 | ① `CHANGELOG.md` 顶部当版条目（新增/变更/修复/清理，带 `adjNN`）；② `docs/ERRORS-LOG.md` 排错条目 `E-年份-序号`（现象/根因/解决/验证/预防）+ **末尾「变更记录」表追加一行**；③ 语法/口径变更 → `docs/SYNTAX.md`；④ 设置分层 → `docs/SETTINGS-AUDIT.md`；⑤ 流程规则 → `docs/VERSIONING.md` | 条目编号连续；表行与 CHANGELOG 口径一致 |
| **OP-04** | 同步版本号 | **应用 5 处**：`src/brand/version.ts`（`APP_VERSION`）、`package.json`、`src-tauri/tauri.conf.json`、`package-lock.json`（顶层 + `packages[""]`）；**引擎 1 处**：`packages/ijipu-engine/package.json` | `Select-String` 一次性列出全部命中，确认无遗漏、无旧值残留 |
| **OP-05** | 验证门 | `npx tsc -b` → `npm run lint`（0 error）→ `npm run build` → `npm run smoke` | **smoke 必须 `ALL SMOKE TESTS PASSED`**；lint warning 数 == 基线（新增 warning 要处理） |
| **OP-06** | 提交 | 分**两个**提交（推荐）：① 改动批量 `fix(adjNNN-adjMMM): …`（代码+图标+相关文档）② `chore(release): x.y.z（…）`（版本号 + CHANGELOG + ERRORS-LOG）。信息先 `write` 到仓库外文件（如 `.ui-preview/commit1.txt`），再 `git commit -F <file>` | `git log --oneline -2`；`git show --stat` 核对文件集 |
| **OP-07** | tag + 推送 | `git tag v<x.y.z>` → `git push origin main` → `git push origin v<x.y.z>` | `git rev-parse HEAD == origin/main`；`git ls-remote --tags origin \| grep v<x.y.z>` |
| **OP-08** | 桌面打包 | `. .\scripts\tauri-env.ps1` → `npx tauri build`（**耗时数分钟，用后台任务**） | 产出 `src-tauri/target/release/bundle/nsis/iJipu_<x.y.z>_x64-setup.exe`；`[stamp-sw] … v<x.y.z>` 且 commit 号 == 发布提交 |
| **OP-09** | 安装包自检 | `npm run check:installer` | 输出 **`[check-installer] 全部通过 ✓`**；核对包体积（含音源 ≈ 30MB，突然变小要查 `bundle.resources`） |
| **OP-10** | Release 正文 | `npm run release:body`（按 `package.json` 版本从 CHANGELOG 截**当版**）→ 另存 `release-body-<x.y.z>.md` | 输出"命中 ## [x.y.z]…只取该版本"；文件里**不得**出现历史版本节 |
| **OP-11** | GitHub Release | `gh auth status` 通过后：`gh release create v<x.y.z> --title "…" --notes-file release-body-<x.y.z>.md <安装包>`；改附件用 `gh release upload v<x.y.z> <包> --clobber` | 核对一律用**带鉴权**的 `gh release view`（匿名 `api.github.com` 会读 CDN 缓存 → `E-2026-130`） |
| **OP-12** | 同步插件引擎 | 对 `packages/ijipu-engine/src/engine/**` 与 `obsidian-ijipu/vendor/engine/**` 做**逐文件 SHA256 对比**（含"缺失/多余"两类）→ 复制差异文件 → 再全量复核哈希 | 同步后**差异为 0**（含新增与删除） |
| **OP-13** | 插件自检 | 在 `obsidian-ijipu/`：`npx tsc -noEmit -skipLibCheck`、`npm run smoke` | tsc 退出码 0；smoke **`149 passed, 0 failed`**（数字随版本变化） |
| **OP-14** | 插件版本+说明 | `manifest.json`、`package.json`、`versions.json`（追加 `"<v>": "<minAppVersion>"`）、`package-lock.json`（两处）；`docs/RELEASE-NOTES.md` **只留当版**，上一版整段移入 `docs/RELEASE-NOTES-ARCHIVE.md`（H1 必须是 `# 爱记谱 iJipu <版本>`，`release-body.mjs` 按版本号定位） | `node scripts/release-body.mjs` 命中当版（如 `命中版本小节：# 爱记谱 iJipu 0.9.1`） |
| **OP-15** | 插件提交/tag/推送 | `git commit -F <file>` → `git tag <v>`（**无 `v` 前缀**）→ push 分支 + tag；插件仓库 `.github/workflows/release.yml` 由 tag 触发、用 `release-body.md` 自动建 Release | HEAD == origin/main；远端 tag 存在 |
| **OP-16** | 收尾核对 | 两库 `git status --short`（应干净或只剩用户自带未跟踪文件）、`HEAD == origin/main`、`git tag --points-at HEAD`、Release 已存在 | 本技能第 4 节清单逐项打勾 |

---

## 2. 流程链（把 OP 串成可照抄的命令序列）

### CHAIN-A：应用发布（必走）

```powershell
cd D:\Coding\JianpuScript\ijipu
git status --short                                   # OP-01
# OP-02/03/04：判版本 → 写文档 → 同步版本号（用 edit/write 工具，勿用 PS 写中文）
npx tsc -b; npm run lint; npm run build; npm run smoke   # OP-05（smoke 必须 0 失败）
git add <改动文件集>; git commit -F ..\.ui-preview\commit1.txt      # OP-06
git add -A; git commit -F ..\.ui-preview\commit2.txt
git tag v<x.y.z>; git push origin main; git push origin v<x.y.z>    # OP-07
. .\scripts\tauri-env.ps1; npx tauri build            # OP-08（后台跑，数分钟）
npm run check:installer                              # OP-09
npm run release:body; Copy-Item release-body.md release-body-<x.y.z>.md   # OP-10
gh release create v<x.y.z> --title "…" --notes-file release-body-<x.y.z>.md `
  "src-tauri\target\release\bundle\nsis\iJipu_<x.y.z>_x64-setup.exe"      # OP-11
```

### CHAIN-B：引擎联动（仅当 `packages/ijipu-engine/src/engine/**` 有改动）

```powershell
cd D:\Coding\JianpuScript\obsidian-ijipu
# OP-12：hash 对比 → 复制 → 复核（PowerShell 片段见第 3 节"安全写法"）
npx tsc -noEmit -skipLibCheck; npm run smoke            # OP-13
# OP-14：bump manifest.json / package.json / versions.json / package-lock.json；
#        RELEASE-NOTES.md 只留当版，上一版移入 RELEASE-NOTES-ARCHIVE.md
node scripts/release-body.mjs                          # 命中当版即正确
git add …; git commit -F ..\.ui-preview\commit-plugin.txt   # OP-15
git tag <v>; git push origin main; git push origin <v>
```

> 两库版本号**各自独立**：插件只因"引擎同步"或"自身代码更新"而递增，**不照抄**应用版本号。

---

## 3. 安全写法（本轮实测）

**① 中文提交信息（唯一可靠姿势）**

```powershell
# 用 write 工具写 UTF-8 文件（不要用 PowerShell here-string / Set-Content）
git commit -F D:\Coding\JianpuScript\.ui-preview\commit1.txt
```
> PowerShell 命令行里的中文经控制台编码往返会变乱码；`Set-Content`/`Get-Content` 改写含中文的源码会**整文件重编码报废**（`E-2026-164`）。

**② 文件搬运 / 文档拆分用 .NET API + 显式 UTF-8，且别用负索引切片**

```powershell
$utf8 = New-Object System.Text.UTF8Encoding($false)
$a = ([System.IO.File]::ReadAllText($p, $utf8) -replace "`r`n","`n").Split("`n")
# ✗ $a[0..($n-1)] 当 $n=0 时是 $a[0..-1] = 「首元素 + 尾元素」（不是全体！）→ 本轮就这样弄坏过归档
$head = if ($n -le 1) { @() } else { $a[0..($n-1)] }
```

**③ hash 同步（OP-12 的标准片段）**

```powershell
$src='packages\ijipu-engine\src\engine'; $dst='..\obsidian-ijipu\vendor\engine'
Get-ChildItem $src -Recurse -File | ForEach-Object {
  $rel=$_.FullName.Substring((Resolve-Path $src).Path.Length+1); $t=Join-Path $dst $rel
  if (-not (Test-Path $t)) { "新增 $rel" }
  elseif ((Get-FileHash $_.FullName).Hash -ne (Get-FileHash $t).Hash) { "DIFF $rel" }
}
# 反向再扫一遍"插件侧多余"，复制后再全量复核必须为 0 差异
```

**④ 长任务放后台**：`npx tauri build` 用后台任务（job），期间并行做 CHAIN-B，别空等。

---

## 4. 检查清单

**CHAIN-A**
- [ ] OP-01 改动逐项确认归属（用户自带的未跟踪文件不代提交）
- [ ] OP-02 版本幅度符合 SemVer；引擎包/插件版本**各自独立**判定
- [ ] OP-03 CHANGELOG 当版条目 + ERRORS-LOG 条目与**变更记录表行**齐备；口径类改动同步 SYNTAX/SETTINGS-AUDIT/VERSIONING
- [ ] OP-04 应用 5 处 + 引擎 1 处版本号全部命中、无旧值残留
- [ ] OP-05 `tsc -b` / `lint` 0 error / `build` / **`smoke` 0 失败** 全绿
- [ ] OP-06 提交信息 Conventional + `adjNN`；中文经 UTF-8 文件传入
- [ ] OP-07 tag 打在发布提交上；分支与 tag 均已推送
- [ ] OP-08/09 安装包版本号与三处一致；`check:installer 全部通过`
- [ ] OP-10 release-body **只含当版**
- [ ] OP-11 Release 已建、附件已挂、用**带鉴权** gh 核对

**CHAIN-B（涉引擎时）**
- [ ] OP-12 `vendor/engine` 与应用引擎**逐文件哈希一致**（含新增/删除）
- [ ] OP-13 插件 `tsc` + `smoke` 全绿
- [ ] OP-14 四处版本号 + `versions.json` 新增行；RELEASE-NOTES 只留当版、上一版已归档
- [ ] OP-15 插件 tag **无 `v` 前缀**；推送后 CI 自动建 Release
- [ ] OP-16 两库工作区干净、HEAD == origin、tag 指向 HEAD

---

## 5. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 应用内版本显示 `dev` | 构建信息未注入 | 重跑 `npm run gen:info`（dev/build 会自动跑） |
| 安装包版本与应用不一致 | 6 处版本号漏改 | OP-04 用 `Select-String` 全量核对（含 `package-lock.json` 两处） |
| Release 正文把历史版本都带上了 | 直接贴了 `CHANGELOG.md` 全文 | 必须用 `npm run release:body` 产物（`E-2026-130` 同类教训） |
| 匿名 `api.github.com` 查到 404/旧内容 | CDN 缓存 | 改用**带鉴权** `gh release view`（`E-2026-130`） |
| `gh` 未登录（`You are not logged into any GitHub hosts`） | 沙箱/环境无凭证 | **不要**把 token 写进仓库；把 OP-11 的命令交给用户手工执行，或请其先 `gh auth login` |
| 插件 smoke 在引擎同步后失败 | 引擎行为变更（如新增校验）与插件断言不一致 | 先判"是引擎 bug 还是断言口径过时"，再决定改代码/改断言（参考 `E-2026-196` 的分类方法） |
| 插件 Release 没出现 | tag 未推送 / 未带 `v` 前缀规范 | 推 tag（无 `v` 前缀）；CI `release.yml` 触发后自动建 |
| `npx tauri build` 报链接/证书错 | 沙箱隔离 | 需完整权限环境；先 `. .\scripts\tauri-env.ps1`（见 `E-2026-055`） |

---

## 6. 与其它技能的分工

| 场景 | 用哪个 |
|---|---|
| 一次改动要落地为发布（本链） | **本技能**（触发词：更新提交） |
| 只编译/打包，不发版 | 「编译应用」 |
| 只跑 dev / 测试 / 冒烟 | 「环境运行与测试」 |
| 语法或解析行为变更、要改 `docs/SYNTAX.md` | 「语法规范同步」（本链 OP-03 会调用它） |
