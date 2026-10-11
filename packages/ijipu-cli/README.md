# @ijipu/cli

iJipu（爱记谱）命令行：把 `.jps` 简谱源码**格式化 / 校验 / 渲染 / 导出**，不打开界面。

- **纯 Node**：运行期**零依赖**（引擎已打进单文件产物）。
- **与应用同源**：解析、排版、渲染、播放序列全部调用 `@ijipu/engine` 的同一份实现，
  所以 CLI 产出的谱面版式与应用一致（数值口径同源）。
- **诚实报错**：做不到的（独立环境里的位图/音频）**明确报退出码 4 + 原因**，不产出半成品。

## 安装

```powershell
# 从本仓库的包目录装（先构建产物：在仓库根运行 npm run cli:build）
npm i -g ./packages/ijipu-cli

# 或先用 npm pack 出一个单文件 tarball，再装
npm pack ./packages/ijipu-cli
npm i -g ./ijipu-cli-<版本>.tgz
```

> 发布到 npm 时是**带 scope** 的包名 `@ijipu/cli`（与引擎包 `@ijipu/engine` 对齐）——
> 首次发布前需要先在 npm 上拥有 `ijipu` 这个 scope（注册一个同名 org 即可，免费）。
> 本地安装（上面两条命令）不需要 scope。

装好后命令名是 `ijipu`：

```powershell
ijipu --help
ijipu --version
ijipu lint -i 我的谱.jps
ijipu format -i 乱.jps --check
ijipu render -i 我的谱.jps -t svg -o 我的谱.svg
```

## 需要桌面端能力的两类输出

| 输出 | 需要什么 | 独立 Node 环境下的行为 |
|---|---|---|
| `render -t png\|jpg\|pdf` | canvas / 字体 / 分页 | 退出码 4 + 原因，并提示改用 `-t svg` |
| `play -t wav` | AudioContext + 音色库 | 退出码 4 + 原因，并提示改用 `-t midi` |

这两类能力由**宿主**（桌面端应用）注入；有宿主时正常产出，且与应用导出走同一条代码路径。

## 退出码（对外承诺，脚本按它判断，不要解析文案）

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 用法错误（未知命令/选项、缺少参数） |
| 2 | 输入不存在或读失败 |
| 3 | 语法错误（`lint` 命中；`format --check` 发现需要格式化） |
| 4 | 渲染失败（能力缺失等） |
| 5 | 设置非法（`--config` / `-s` 相关） |

## 许可

AGPL-3.0（与 iJipu 应用一致）。
