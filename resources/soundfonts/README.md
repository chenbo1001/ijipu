# 内置音色库：GeneralUser GS

`generaluser_gs.sf2` 是**第三方作品**，不是本项目的代码，随安装包一起分发。
这里记录它的来源、许可与我们遵守的方式（**署名与许可是分发第三方作品的义务，不是可选项**）。

## 来源与署名

| 项 | 内容 |
|---|---|
| 名称 | **GeneralUser GS** v1.471 |
| 作者 | **S. Christian Collins**（s_chriscollins@hotmail.com） |
| 主页 | http://www.schristiancollins.com |
| 许可 | **GeneralUser GS License v2.0**（全文见同目录 `LICENSE-GeneralUserGS.txt`） |

## 许可允许我们这么做

许可原文里与"随软件分发"直接相关的两条：

- “Please feel free to use it in **your software projects**, and to modify the SoundFont bank
  or its **packaging** to suit your needs.”
  ⇒ 用在软件项目里、并按其需要对**打包方式**做调整，是**明确允许**的。
- “If you plan to feature GeneralUser GS on your own website, please **do not link directly to my
  download files**. Either link to my website, or **provide your own local copy** instead.”
  ⇒ 我们**没有**直链作者的下载文件，而是**随安装包分发一份本地副本** —— 正是这条要求的做法。

所以 iJipu 把 `generaluser_gs.sf2` 打进安装包并随附本许可与署名，**符合该许可**。

## ⚠️ 一处必须如实说明的保留

原作者在许可里**自己声明**：这个 bank 里"大部分采样是原创的，但也有一些取自网络上免费
（且合法）的 SoundFont，因为他当初只当个人项目、没打算发布，所以**无法 100% 确认每个采样的来源**"。

- 他同时说明：这些采样**都不来自**商业发行的 SoundFont 包或采样 CD；
  自 2000 年发布至今，他和使用它的商业软件公司都**没有**收到过采样归属方面的投诉。
- 但 Linux 发行版 Debian 在收录它时，就是因为这条不确定性把它标记为
  [“unclean license”](https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1036719)。

**对我们的影响**：
- iJipu 是**免费开源**项目（AGPL-3.0），不靠这个音色库盈利 ⇒ 风险远低于商业软件。
- 但如果你要把它用于**商业闭源产品**，这条不确定性需要你自己评估（许可是这么写的）。
- 一旦发现其中含受限采样，正确做法是替换掉该采样（作者本人也这么请求）。

## 相关文件

- `LICENSE-GeneralUserGS.txt` —— 许可**原文**（逐字保留，不要改写）
- 打包配置：`src-tauri/tauri.conf.json` 的 `bundle.resources` —— 音色库与许可**一起**进安装包
- 音色库的加载与顺序：`packages/ijipu-engine/src/engine/playback/soundbanks.ts`
