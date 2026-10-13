/**
 * nsis/cli-path.nsh — 卸载时把 iJipu 从**当前用户 PATH** 里摘掉（adj944；adj946 改口径）
 *
 * 由 `hooks.nsh` 在 `NSIS_HOOK_POSTUNINSTALL` 里 `!insertmacro IJIPU_PATH_UNREGISTER` 调用
 * （那里是"我方注册表清理"的统一落点，「只动自己写的东西」原则见 `hooks.nsh` 文件头）。
 *
 * 为什么卸载要自己做，而不是调 `ijipu.exe cli unregister`：
 *   · 卸载器是 GUI 子系统进程，起 `ijipu.exe` 会**闪一个黑框**（它要 `AllocConsole` 才输出）；
 *   · 那还要求 exe 在卸载那一刻**还在且能跑**（杀软/占用都会让它失败）；
 *   · PATH 的增删是纯字符串活，NSIS 自己就能做 ⇒ **不引入进程、不引入新依赖** ✓。
 *   ⚠ 代价（如实记）：**值的类型**只能靠问一次注册表（见 `IJIPU_EnvValueType`）；
 *     引号/空白之类的"变体写法"只认大小写与末尾反斜杠两种（应用里那个「解除」按钮认得更多 ✓）。
 *
 * ## 口径（与 `packages/ijipu-cli/src/envPath.ts` 的 `removeDirFromPath` 对齐）
 *  · **只摘完全等于我们那条的条目**（比较大小写无关，忽略末尾反斜杠）——
 *    adj946 起是**两条**：`${INSTDIR}\bin`（现行，命令行入口目录）与 `${INSTDIR}`（adj944 旧形态）；
 *  · 其余条目**逐字保留** —— 尤其**连续分号留下的空条目**不许被"顺手清理"✗；
 *  · **幂等**：PATH 里没有我们那条 ⇒ 一个字都不写（连注册表都不碰）；
 *  · 摘完之后 PATH 空了 ⇒ 直接把 `Path` 值删掉（不留一个空值）。
 *
 * ⚠ 本文件含中文字符串**注释**，保存成**带 BOM 的 UTF-8**（与 `hooks.nsh` 同一口径；
 *   无 BOM 时 makensis 按 ANSI 解，中文注释会变乱码 —— 注释乱码不致命，但别开这个头）。
 *   机器闸门：`scripts/check-installer.mjs` 会核对 `nsis/*.nsh` 都带 BOM ✓。
 *
 * ⚠⚠ 三个函数**必须叫 `un.` 开头**（`un.IJIPU_PathDropDir` 等）：它们只在**卸载段**里被 `Call`，
 *   而 makensis 的规矩是"卸载段里只能 `Call` 名字以 `un.` 开头的函数"
 *   （实测报错原文：`Call must be used with function names starting with "un." in the uninstall section.`）。
 *   `!macro`（下面的 `IJIPU_PATH_UNREGISTER`）本身不受这条限制，受限制的是 `Call` ✓。
 */

; 当前用户环境变量所在的键值（与 Rust 侧 `cli_path.rs` 的 ENV_KEY / ENV_NAME 一致）
!define IJIPU_ENV_KEY "Environment"
!define IJIPU_ENV_NAME "Path"
; App Paths 里我们那一条（"运行"对话框 / 资源管理器地址栏也能敲 ijipu）
!define IJIPU_APP_PATHS_KEY "Software\Microsoft\Windows\CurrentVersion\App Paths\${IJIPU_EXE}"
; 应用侧（Rust）写前备份用的我们自己的键 —— 卸载时整个删掉
!define IJIPU_BACKUP_KEY "Software\iJipu\CliPath"

/**
 * 广播 `WM_SETTINGCHANGE` + `"Environment"`：让**新起的进程**（新的资源管理器/终端）
 * 重新读环境块。
 *
 * 与 Rust 侧 `cli_path.rs` 的 `broadcast_environment_change()` 同一口径：
 * `HWND_BROADCAST`(0xFFFF) / `WM_SETTINGCHANGE`(26) / `SMTO_ABORTIFHUNG`(2) / 5 秒超时。
 * ⚠ 已经开着的终端**不会**因此刷新（它的环境块在进程创建时就固定了）。
 */
!macro IJIPU_NOTIFY_ENVIRONMENT
  System::Call 'user32::SendMessageTimeoutW(i 0xFFFF, i 26, i 0, w "Environment", i 2, i 5000, *i.r9)'
!macroend

/**
 * 结算一个条目：判它是不是我们要摘的目录，不是就拼进结果。
 *
 * 入参：`$2` = 当前条目（**原样，不许改** —— 别人的条目要逐字保留）
 *       `$R0` = 要摘掉的目录
 *       `$1` = 已拼好的结果；`$R1` = 是否摘过东西（1/0）；`$R2` = 结果里是否已经放过条目
 * 出参：`$1` / `$R1` / `$R2` 更新
 * 副作用：`$6`–`$9` 被写坏（**刻意避开 `$0`/`$3`/`$4`/`$5`/`$R0`**：调用方正在用）
 *
 * ⚠ `$R1`（改过没有）与 `$R2`（放过条目没有）**必须分成两个寄存器**：只有一条、且正是我们那条时，
 *   `$R1` 要为 1（确实改了、要写回），而 `$R2` 仍是 0（结果为空串）——合成一个的话这个用例
 *   就会报"没改过"从而**不写回**，等于解除失败 ✗（这个小测试当场抓到过，见报告）。
 */
Function un.IJIPU_PathKeepEntry
  StrCpy $6 $2
  StrCpy $7 $6 1 0                 ; 第一个字符
  StrCmp $7 "$\"" 0 ijipu_pke_trim_bs
    StrCpy $7 $6 1 -1              ; 最后一个字符
    StrCmp $7 "$\"" 0 ijipu_pke_trim_bs
    StrLen $8 $6
    IntOp $8 $8 - 2
    StrCpy $6 $6 $8 1              ; 从偏移 1 起取 (长度-2) 个字符 = 去掉两端引号
  ijipu_pke_trim_bs:
    StrCpy $7 0                    ; 最多去 4 个末尾反斜杠（再多就不是正常路径了）
  ijipu_pke_trim_bs_loop:
    StrCmp $7 4 ijipu_pke_compare
    StrCpy $8 $6 1 -1
    StrCmp $8 "\" 0 ijipu_pke_compare
    StrLen $9 $6
    IntOp $9 $9 - 1
    StrCpy $6 $6 $9
    IntOp $7 $7 + 1
    Goto ijipu_pke_trim_bs_loop
  ijipu_pke_compare:
  ; `StrCmp` 本身就是**大小写无关**比较（`StrCmpS` 才是敏感版）—— 正是 Windows 路径要的口径 ✓
  StrCmp $6 "$R0" 0 ijipu_pke_keep
    StrCpy $R1 1                   ; 命中 ⇒ 摘掉：连它前面那个分隔符一起省掉（不留下 `;;`）
    Return
  ijipu_pke_keep:
  StrCmp $R2 0 ijipu_pke_first
    StrCpy $1 "$1;$2"
    Return
  ijipu_pke_first:
    StrCpy $1 "$2"
    StrCpy $R2 1
FunctionEnd

/**
 * 从 PATH 字符串里**只摘掉一个目录**（纯字符串活；有独立小测试，见报告）。
 *
 * 入参：`$0` = 原 PATH 串；`$R0` = 要摘掉的目录
 * 出参：`$1` = 新 PATH 串；`$R1` = 是否改过（1 = 改了，0 = 原样）
 * 副作用：`$0`–`$9`、`$R0`–`$R2` 全被写坏
 *
 * 手法：把 `$0` 末尾补一个**虚拟分隔符**，于是"最后一条"也走"命中分隔符就结算"那条路，
 * 只需要一份结算逻辑（`IJIPU_PathKeepEntry`）；扫到串尾（读到空字符）就收工。
 */
Function un.IJIPU_PathDropDir
  StrCpy $1 ""
  StrCpy $2 ""
  StrCpy $3 0
  StrCpy $R1 0
  StrCpy $R2 0
  StrCmp $0 "" ijipu_pdd_done      ; 空串 ⇒ 没什么可摘的
  StrCpy $4 "$0;"
  ijipu_pdd_scan:
    StrCpy $5 $4 1 $3
    StrCmp $5 "" ijipu_pdd_done
    StrCmp $5 ";" 0 ijipu_pdd_accum
      Call un.IJIPU_PathKeepEntry
      StrCpy $2 ""
      Goto ijipu_pdd_next
    ijipu_pdd_accum:
      StrCpy $2 "$2$5"
    ijipu_pdd_next:
    IntOp $3 $3 + 1
    Goto ijipu_pdd_scan
  ijipu_pdd_done:
FunctionEnd

/**
 * 问出某个环境变量值的**类型**（`REG_SZ` / `REG_EXPAND_SZ`）——写回时必须沿用原类型：
 * PATH 里常有 `%USERPROFILE%` 这类变量，写成 `REG_SZ` 会让它们**不再展开** ✗。
 *
 * 入参：`$R4` = 子键（如 `Environment`）；`$R5` = 值名（如 `Path`）
 * 出参：`$R3` = 0 值不存在 / 1 `REG_SZ` / 2 `REG_EXPAND_SZ` / 3 其它类型（或查询失败）
 * 副作用：`$6`–`$9`（**编号寄存器**，见下）、`$R3`
 *
 * 为什么用 `System::Call` 而不是 NSIS 内置指令：`ReadRegStr` **不返回值类型**，
 * 而类型恰恰是"逐字还原"的关键（见上）。查询是只读的 ⇒ 就算写错也只会退化成"按 REG_SZ 写"✓。
 *
 * ⚠⚠ **System 插件的输出写法 `.rN` 指的是编号寄存器 `$N`，不是 `$RN`**（实测：
 *   `System::Call 'kernel32::GetCurrentProcessId() i.r5'` 之后 `$5` 拿到了 PID，
 *   而 `$R5` 原封不动）—— 所以本函数用 `$6`–`$9` 收结果，再 `StrCpy` 进 `$R3` 这个出参。
 *   写成 `$R6` 的话**一句报错都没有**，只是永远查不到类型（退化成"值不存在"）。
 */
Function un.IJIPU_EnvValueType
  StrCpy $R3 0
  ; 0x80000001 = HKEY_CURRENT_USER；0x20019 = KEY_READ
  System::Call 'advapi32::RegOpenKeyExW(i 0x80000001, w "$R4", i 0, i 0x20019, *i.r6) i.r7'
  StrCmp $7 0 0 ijipu_evt_done
  ; lpdata = 0 ⇒ 只问类型（`*i.r8` 收类型，`lpcbdata` 传 0 即可）
  System::Call 'advapi32::RegQueryValueExW(i $6, w "$R5", i 0, *i.r8, i 0, i 0) i.r9'
  System::Call 'advapi32::RegCloseKey(i $6)'
  StrCmp $9 0 0 ijipu_evt_done      ; 值不存在 / 查不到 ⇒ 保持 0（"未知"，调用方按 REG_SZ 兜底 ✓）
  StrCmp $8 1 0 ijipu_evt_not_sz
    StrCpy $R3 1
    Goto ijipu_evt_done
  ijipu_evt_not_sz:
  StrCmp $8 2 0 ijipu_evt_other
    StrCpy $R3 2
    Goto ijipu_evt_done
  ijipu_evt_other:
    StrCpy $R3 3                    ; 其它类型（REG_DWORD / REG_MULTI_SZ…）
  ijipu_evt_done:
FunctionEnd

/**
 * 卸载时：把**我们写进 PATH 的那一条**从**当前用户 PATH** 里摘掉 + 删我方 App Paths 与备份键 + 广播环境变更。
 *
 * ⚠ adj946 改口径：注册写进 PATH 的是**命令行入口目录 `${INSTDIR}\bin`**（里面有控制台垫片
 *   `ijipu.cmd`），**不是 `${INSTDIR}` 本身** ✗ —— 所以这里要**两个都摘**：
 *   ① `${INSTDIR}\bin`（现行形态）；② `${INSTDIR}`（adj944 的旧形态，用户可能还留着）。
 *   两条都摘才能保证"卸载后终端里敲不出 ijipu"（留旧的还更糟：`ijipu` 会解析回 GUI 的 exe，
 *   于是又变回"提示符夹在输出中间"那个用户实报的症状 ✗）。
 *   两次调用的"改过没有"要**累计**进 `$R9`（半路清零会出现"摘了一半却不写回"✗）；
 *   `$R8` 存第一轮的结果串（第二次调用会把 `$1` 盖掉）。
 *   ⚠ `$R8`/`$R9` 是**空着的**编号寄存器（`IJIPU_PathDropDir`/`IJIPU_PathKeepEntry` 只用
 *   `$0`–`$9` 与 `$R0`–`$R2`，`$R3`–`$R7` 被本宏后面用到）—— 挑它们不会互相踩 ✓。
 *
 * ⚠ 必须在 `$UpdateMode <> 1` 时调用（更新流程会先跑一次卸载器：
 *   那时把 PATH 摘了，而更新路径又不会重新注册 ⇒ 用户"更新一次就丢注册"✗）。
 */
!macro IJIPU_PATH_UNREGISTER
  ReadRegStr $0 HKCU "${IJIPU_ENV_KEY}" "${IJIPU_ENV_NAME}"
  StrCmp $0 "" ijipu_pu_app_paths      ; 没有 PATH 值 ⇒ 没什么可摘（幂等 ✓）
  StrCpy $R0 "$INSTDIR\bin"            ; adj946：现行形态 = 命令行入口目录
  Call un.IJIPU_PathDropDir
  StrCpy $R8 "$1"                      ; 第一轮结果（第二轮会盖掉 $1）
  StrCpy $R9 $R1                       ; 第一轮"改过没有"
  StrCpy $0 "$R8"                      ; 第二轮输入 = 第一轮输出
  StrCpy $R0 "$INSTDIR"                ; adj944 的旧形态 = 安装目录本身（一并摘掉）
  Call un.IJIPU_PathDropDir
  StrCmp $R1 0 ijipu_pu_legacy_done
    StrCpy $R9 1
  ijipu_pu_legacy_done:
  StrCmp $R9 0 ijipu_pu_app_paths      ; 两条都不在里面 ⇒ **一个字都不写** ✓
  StrCpy $R4 "${IJIPU_ENV_KEY}"
  StrCpy $R5 "${IJIPU_ENV_NAME}"
  Call un.IJIPU_EnvValueType
  StrCmp $R3 2 ijipu_pu_write_expand
    WriteRegStr HKCU "${IJIPU_ENV_KEY}" "${IJIPU_ENV_NAME}" "$1"
    Goto ijipu_pu_written
  ijipu_pu_write_expand:
    WriteRegExpandStr HKCU "${IJIPU_ENV_KEY}" "${IJIPU_ENV_NAME}" "$1"
  ijipu_pu_written:
  !insertmacro IJIPU_NOTIFY_ENVIRONMENT

  ijipu_pu_app_paths:
  ; ① App Paths：**只删我们自己写的**（默认值必须正好指向我们的 exe）
  ReadRegStr $R6 HKCU "${IJIPU_APP_PATHS_KEY}" ""
  StrCmp $R6 "$INSTDIR\${IJIPU_EXE}" 0 ijipu_pu_backup
    DeleteRegValue HKCU "${IJIPU_APP_PATHS_KEY}" ""
    ; 键里再没有别的值、也没有子键 ⇒ 才删键（照 hooks.nsh 的既有原则：只动自己写的东西 ✓）
    EnumRegValue $R7 HKCU "${IJIPU_APP_PATHS_KEY}" 0
    StrCmp $R7 "" 0 ijipu_pu_backup
    EnumRegKey $R7 HKCU "${IJIPU_APP_PATHS_KEY}" 0
    StrCmp $R7 "" 0 ijipu_pu_backup
    DeleteRegKey HKCU "${IJIPU_APP_PATHS_KEY}"

  ijipu_pu_backup:
  ; ② 我们自己的备份键（应用侧"写前备份原值"用的）：整个删掉；`Software\iJipu` 空了也删 ✓
  DeleteRegKey HKCU "${IJIPU_BACKUP_KEY}"
  DeleteRegKey /ifempty HKCU "Software\iJipu"
!macroend
