# iJipu 资源包（音色库 / 工具）

> 这是**独立于应用版本**的资源 Release：应用升级不重发热资源；
> 只有资源文件本身更新时，才升该资源的版本并替换对应安装包。旧版本资产保留，便于回滚。
>
> 主程序：<https://github.com/snailhome/ijipu/releases/latest>

## 当前资源

| 类型 | 资源 | 版本 | 安装包 |
|---|---|---|---|
| 音色库 | GeneralUser GS | `1.471.1` | `iJipu-SoundFont-GeneralUserGS_1.471.1_x64-setup.exe` |
| 音色库 | FluidR3 GM | `1.0.1` | `iJipu-SoundFont-FluidR3GM_1.0.1_x64-setup.exe` |

> 两个安装包都**随附对应 LICENSE**（GeneralUser GS License v2.0 / FluidR3 MIT），装进 `soundfonts\`，卸载时只删自己的许可。

> 工具类型（`Tool`）已支持；有工具文件时在 `resources/installers.json` 增加一项即可。

## 怎么用

1. 下载你需要的**单个**安装包（不需要的不用下）；
2. 运行安装器，它会自动找 iJipu 主程序目录（校验 `ijipu.exe` 所在目录），只装这一个资源文件；
3. 装完在应用「设置 → 音色库」里点「使用」；
4. 每个资源都能在 Windows「应用和功能」里**单独卸载**；卸载主程序时也可选「完全卸载」一起清理。

命名规则与构建方法见 `docs/INSTALLER-NAMING.md`。
