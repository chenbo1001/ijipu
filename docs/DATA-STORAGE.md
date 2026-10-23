# 三端存储与桌面本机配置（adj1085）

> 用户口径（2026-10-23）：桌面壳的「本机配置」应放在**个人目录**下，由应用自己管，
> 而不是寄在 WebView2 的浏览器缓存里——缓存一清就没了。网站/PWA 用浏览器缓存，
> 插件用插件目录，这是三端应有的区别。

## 一、分层（先定层，再定落点）

| 层 | 内容 | 落点 |
|---|---|---|
| **L2 谱面配置** | 页边距、字号、行距、背景图、水印、`# jps-config` 全部字段 | **始终写在 `.jps` 里**；三端一致，**不进**本机配置 |
| **L1 本机偏好** | 主题、缩放、拆分比例、卡片模板/自定义卡片、音色库选择、导出背景、草稿… | 桌面：`%APPDATA%\iJipu\settings.json`；网站/PWA：浏览器 `localStorage`；插件：插件目录 `data.json` |
| **L1 大文件** | 自定义卡片背景图（当前 ≤2.5MB 的 data URL） | P1：桌面落 `files\`、网站 IndexedDB、插件目录文件；P0 暂存在键值里 |
| **L3 会话** | 当前弹窗、临时预览状态 | 内存，不落盘 |

硬规则：**换台机器打开同一份 `.jps`，谱面必须一样** ⇒ L2 永远跟着谱走；
本机配置只放"这个人怎么用"，丢了会烦、但不该改变谱面长相。

## 二、桌面壳的路径与文件

```text
%APPDATA%\iJipu\
  settings.json        # 当前配置（人可读、可手改）
  settings.bak.json    # 上一份（主文件坏了回退）
  settings.json.tmp    # 原子写的临时文件（写完即替换，读的人看不到半截）
```

- Windows 上 `%APPDATA%` = `C:\Users\<你>\AppData\Roaming`；macOS 是
  `~/Library/Application Support/iJipu`，Linux 是 `~/.config/iJipu`（Tauri `config_dir()` + `iJipu`）。
- **不放安装目录**（`%LOCALAPPDATA%\iJipu`）：那里是程序文件，卸载/升级会动它。
- **不放 WebView2 的 profile**（`%LOCALAPPDATA%\<identifier>\EBWebView`）：那是浏览器缓存。
- 卸载默认**保留**本目录；以后若加"同时删除本机配置"选项，默认不勾。

文件格式：

```json
{
  "schema": 1,
  "app": "iJipu",
  "updatedAt": 1792727433176,
  "values": {
    "ijipu.theme": "ink",
    "ijipu.previewZoom": "125"
  }
}
```

`values` 里的键与浏览器 `localStorage` **完全同一套**（`ijipu.` 前缀），值是字符串。
这样"迁移"只是换落点，不换数据形状。

## 三、启动、迁移与失败口径

1. 启动时（`main.tsx`，**早于任何 store 模块求值**）调 `prefs_load`。
2. 文件不存在 ⇒ 把 WebView2 `localStorage` 里现有的 `ijipu.*` 抄进快照，先落盘一次，再接管。
   **源不删**：新文件写失败时旧版本还能读；等这版用稳了再谈清理。
3. 把 `window.localStorage` 换成只接管 `ijipu.` 前缀的 `Storage` 门面
   （`createPrefsFacade`；与插件版 `embedStorage.ts` 同一手法）⇒ 80+ 个调用点一行不用改。
4. 写入防抖 300ms 后**整表**落盘；切到后台/关窗前再补一次。
5. 主文件坏掉 ⇒ 读 `settings.bak.json`，控制台提示"已回退到上一份"，**不静默重置**。
6. 读不到 / 旧版 exe 没有命令 ⇒ **不接管**，退回浏览器存储，界面照常启动。

### 启动顺序的坑（已修，adj1085 实测）

`main.tsx` 末尾还有**另一个顶层 IIFE**（外部改动轮询），它在模块求值时就启动，并会
`import('./store/docStore')` → docStore 静态 import 了 uiStore。冷启动时它和"读配置文件"的
IPC **赛跑**：IPC 稍慢，uiStore 就先用 WebView2 里的旧值求值了（实测：文件写 `dark`、界面却是
`light`，刷新一次才对）。

修法：`prefs.ts` 导出 `prefsReady`，那个 IIFE 在动 store 之前先 `await prefsReady`；
`preloadDesktopPrefs` 在成功/失败/无需接管的**所有出口**都 resolve 它（只保证"等待结束"，
不保证"已经接管"）。冷启动连跑 3 次，顺序都是 `prefs 完成 → uiStore`，主题一致。

失败时绝不做的两件事：不把设置悄悄清成默认；不因为写盘失败挡住用户操作。

## 四、三端的差异（同一个键空间）

| | 桌面壳 | 网站 / PWA | Obsidian 插件 |
|---|---|---|---|
| L1 配置 | `%APPDATA%\iJipu\settings.json` | `localStorage` | `<vault>/.obsidian/plugins/ijipu/data.json` |
| 大文件 | `%APPDATA%\iJipu\files\`（P1） | IndexedDB（P1） | 插件目录文件（P1） |
| 跨端迁移 | 首次从 `localStorage` 抄一次 | — | 早已由 `embedKv` 走宿主桥 |
| L2 谱面配置 | `.jps` | `.jps` | `.jps` |

## 五、为什么这样定（而不是别的做法）

- **不每个功能一个文件**：`settings.json` 一个键值表，迁移/备份/导出都只有一份；
  分文件会重演"哪个设置存在哪"的老问题。
- **不逐键写盘**：80+ 个调用点、拖滑块会连续写；整表 300ms 防抖 + 原子替换，
  既不打碎磁盘，也不会出现"一半新一半旧"。
- **不直接改 store**：替换 `localStorage` 门面是插件已经验证过的路径，风险最小、
  回退最容易（不接管即回到现状）。
- **不让命令行出片窗口写配置**：它是第二个进程，会和主窗口互相覆盖；出片只需要读默认值。

## 六、验证

- `npm run smoke`：`adj1085` 的纯逻辑断言（只搬 `ijipu.*`、门面代理、去重、clear 不越界、落盘形状）。
- `npm run test:rust`：`prefs.rs` 的单元测试（往返、备份、坏文件回退、旧格式、非字符串值）。
  ⚠ 本机 GNU 工具链上 `cargo test` 起不来（`STATUS_ENTRYPOINT_NOT_FOUND`，见 `ERRORS-LOG.md`），
  所以这几条用 `cargo test --no-run` 证明"能编译"，运行结果须在正常环境补跑。
- 真机：启动桌面壳一次 → 检查 `%APPDATA%\iJipu\settings.json` 已生成且含原 `ijipu.*`；
  改主题/缩放 → 文件随动；重启 → 设置还在。
  本次实测：首次启动迁移出 9 个键（主题 `zhusha`、浅色模式、拆分方向、草稿正文、工作区绑定、
  民族乐器、音色库选择）；把文件改成 `themeMode=dark` 后**冷启动 3 次**，界面均为深色
  （`data-mode=dark`、背景 `rgb(23,13,12)`），证明"读的是文件"而不是浏览器缓存。

## 七、还没做的（P1）

- 自定义卡片背景图等大值外置（桌面文件 / 网站 IndexedDB / 插件文件），避免 3MB 字符串塞 JSON。
- 设置页的「打开配置目录」「导出/导入设置（zip）」。
- 卸载器里的"同时删除本机配置"选项（默认保留）。
- 草稿体积变大后再拆 `drafts/`（P0 先与其它 L1 一起放 `settings.json`，草稿是文本、量级可接受）。
