# 资源安装包命名与拆分规则（2026-10-26 用户口径）

> 用户原话：「鉴于音色库等资源文件都比较大，为每个音色库资源文件创建单独了安装包，要求安装包名称要能体现资源文件信息（资源类型：音色库/工具，资源名称等，以便于区分），以便让用户可以按需下载。」

## 一、硬规则

1. **一个资源文件 = 一个安装包**；不再做「一个 exe 里勾选多个资源」的资源合集安装器。
2. **文件名只用 ASCII**（下载链接、命令行、对象存储都友好）；中文只出现在安装器界面/显示名里。
3. **文件名必须能看出：资源类型 + 资源名称 + 适用版本**。
4. 资源文件不随主安装包分发；用户按需下载、单独安装、单独卸载。
5. 旧版合集包 `iJipu-Assets_*` **不再产出**；已装过的旧包由主卸载器的兼容分支处理。

## 二、固定格式

```text
iJipu-<Type>-<ResourceId>_<Version>_<Arch>-setup.exe
```

| 段 | 取值 | 说明 |
|---|---|---|
| `iJipu` | 固定 | 应用名（ASCII） |
| `<Type>` | `SoundFont` / `Tool` | 资源类型：音色库 / 工具 |
| `<ResourceId>` | `GeneralUserGS` / `FluidR3GM` / `FFmpeg` … | 稳定 ASCII 标识；**大写字母开头，只含字母数字**；发布后不要改 |
| `<Version>` | `0.75.1` … | **应用版本**（方便判断与哪一版 iJipu 配套） |
| `<Arch>` | `x64` | 当前桌面安装包架构 |
| 后缀 | `-setup.exe` | NSIS 安装器 |

示例（当前 0.75.1）：

```text
iJipu-SoundFont-GeneralUserGS_0.75.1_x64-setup.exe
iJipu-SoundFont-FluidR3GM_0.75.1_x64-setup.exe
iJipu-Tool-FFmpeg_0.75.1_x64-setup.exe
```

不允许：

```text
iJipu-Assets_0.1.0_x64-setup.exe      # 旧合集包，无法看出装的是什么
iJipu-音色库-GeneralUserGS-setup.exe   # 文件名不要中文
iJipu-SoundFont-generaluser_...        # id 必须大写字母开头
iJipu-SoundFont-GeneralUserGS-setup.exe  # 缺版本
```

## 三、装到哪里 / 怎么卸

| 类型 | 安装目录（主程序目录下） | manifest | 卸载键 |
|---|---|---|---|
| `SoundFont` | `soundfonts\<file>` | `assets.<Id>.manifest.json` | `iJipuAsset-<Id>` |
| `Tool` | `tools\<file>` | `assets.<Id>.manifest.json` | `iJipuAsset-<Id>` |

- 安装器靠 `HKCU\Software\iJipu\InstallDir` 找主程序，并校验 `ijipu.exe` 存在才允许安装；
- 每个资源写自己的卸载键与 manifest；卸载**只删自己那一个文件**，用户自己导入/下载的其它库不动；
- 每个资源还在 `HKCU\Software\iJipu\ResourceUninstallers` 登记卸载器路径；主安装器「完全卸载」会枚举它逐个调用（旧 `iJipuAssets` 键保留兼容）。

## 四、新增/调整一个资源

1. 把源文件放到 `resources/` 下（大文件不进 git 时，发布前显式放好）；
2. 在 `resources/installers.json` 追加一项：

```json
{
  "type": "SoundFont",
  "id": "GeneralUserGS",
  "name": "GeneralUser GS",
  "source": "resources/soundfonts/generaluser_gs.sf2",
  "dir": "soundfonts",
  "file": "generaluser_gs.sf2"
}
```

3. 构建：

```powershell
npm run build:assets                 # 有源文件就构建，缺的跳过
npm run build:assets -- --strict     # 发布前：缺任何一个源文件就失败
npm run build:assets -- --only GeneralUserGS
```

4. 闸门：

```powershell
npm run check:assets                 # 命名/单文件/卸载/登记 的静态检查
```

## 五、单一出处

- 命名函数与类型校验：`scripts/asset-naming.mjs`（构建、检查、冒烟共用）；
- 资源清单：`resources/installers.json`；
- 安装器脚本：`src-tauri/nsis/assets-installer.nsi`；
- 构建：`scripts/build-assets-installer.mjs`；
- 静态闸门：`scripts/check-assets-installer.mjs`。

**改格式只改 `scripts/asset-naming.mjs`，并同步本文件与闸门。**
