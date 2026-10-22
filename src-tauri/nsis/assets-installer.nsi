;
; assets-installer.nsi — iJipu 资源包安装器（独立于主程序安装器）
;
; 用户口径（2026-10-21 / 2026-10-22）：
;  - 主安装包不含音色库；资源包单独装、单独卸；
;  - 资源包装进主程序目录的 soundfonts\，靠 HKCU\Software\iJipu\InstallDir 定位主程序；
;  - 一个 exe、可选组件；UI 与主应用强关联（「爱记谱 iJipu 资源包」）；
;  - 谁装的谁删：本卸载器只删自己装的 sf2 与 assets.manifest.json，
;    用户自己导入/下载的音色库不动。
;
; 构建：node scripts/build-assets-installer.mjs（调用 Tauri 的 makensis）
;   -DGENERALUSER=<path>  必填，基础音色库
;   -DFLUIDR3=<path>      可选，高级音色库
;   -DVERSION=<x.y.z>     默认 0.1.0
;   -DOUTFILE=<path>      默认 iJipu-Assets_<VERSION>_x64-setup.exe
;   -DSCRIPT_DIR=<dir>    本文件所在目录（构建脚本传入，供 NSIS 找 include）
;
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include WinVer.nsh

!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!ifndef OUTFILE
  !define OUTFILE "iJipu-Assets_${VERSION}_x64-setup.exe"
!endif
!ifndef GENERALUSER
  !error "缺少 -DGENERALUSER=<generaluser_gs.sf2 路径>"
!endif

!define APP_NAME "爱记谱 iJipu 资源包"
!define APP_KEY "iJipuAssets"
!define MAIN_EXE "ijipu.exe"
!define MAIN_REG_KEY "Software\iJipu"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_KEY}"
!define UNINSTALLER "uninst-iJipuAssets.exe"
!define MANIFEST "assets.manifest.json"

Name "${APP_NAME}"
Caption "${APP_NAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\iJipu"
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "这个安装包为「爱记谱 iJipu」补充音色库。$\r$\n$\r$\n全部不装也能正常打开和编辑谱面；只是试听需要音色库。$\r$\n$\r$\n安装位置会自动找主程序，也可以手动选择。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "请选择 **iJipu 主程序所在目录**（里面有 ijipu.exe）。资源包会装进这个目录的 soundfonts\ 子目录。"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "启动爱记谱 iJipu"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  ; ① 先看主程序安装时记下的目录
  ReadRegStr $0 HKCU "${MAIN_REG_KEY}" "InstallDir"
  StrCmp $0 "" 0 ijipu_assets_use_reg
  ; ② 退到 Tauri currentUser 的默认安装目录
  StrCpy $0 "$LOCALAPPDATA\iJipu"
  ijipu_assets_use_reg:
  StrCpy $INSTDIR $0
  ; ③ 主程序不在就明确拒绝，并让用户手动选
  IfFileExists "$INSTDIR\${MAIN_EXE}" ijipu_assets_init_done
  MessageBox MB_OK|MB_ICONINFORMATION "没有在默认位置找到 iJipu 主程序。$\r$\n$\r$\n请点「下一步」后手动选择 ijipu.exe 所在目录；如果还没安装主程序，请先安装 iJipu。"
  ijipu_assets_init_done:
FunctionEnd

Function .onVerifyInstDir
  ; 目录页每次变化都校验：必须是主程序目录，避免把资源包装到无关目录
  IfFileExists "$INSTDIR\${MAIN_EXE}" +2
    Abort
FunctionEnd

Function LaunchApp
  Exec '"$INSTDIR\${MAIN_EXE}"'
FunctionEnd

Section "基础音色库（GeneralUser GS）" SecGeneralUser
  SectionIn 1
  SetOutPath "$INSTDIR\soundfonts"
  File "/oname=generaluser_gs.sf2" "${GENERALUSER}"
SectionEnd

!ifdef FLUIDR3
Section /o "高级音色库（FluidR3 GM）" SecFluidR3
  SetOutPath "$INSTDIR\soundfonts"
  File "/oname=FluidR3_GM.sf2" "${FLUIDR3}"
SectionEnd
!endif

Section "-资源清单" SecManifest
  ; 主程序据此判断资源包版本；卸载器也靠它只删自己的东西
  SetOutPath "$INSTDIR"
  FileOpen $0 "$INSTDIR\${MANIFEST}" w
  FileWrite $0 "{$\r$\n"
  FileWrite $0 '  "pack": "iJipu-Assets",$\r$\n'
  FileWrite $0 '  "version": "${VERSION}",$\r$\n'
  FileWrite $0 '  "installedAt": "${__DATE__} ${__TIME__}",$\r$\n'
  FileWrite $0 '  "components": ["GeneralUser GS"'
  !ifdef FLUIDR3
  FileWrite $0 ', "FluidR3 GM"'
  !endif
  FileWrite $0 ']$\r$\n'
  FileWrite $0 "}$\r$\n"
  FileClose $0
SectionEnd

Section "-卸载信息"
  WriteUninstaller "$INSTDIR\${UNINSTALLER}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "蜗牛🐌"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${MAIN_EXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER}" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; 只删本安装器装的东西；用户自己放进 soundfonts\ 的其它库不动
  Delete "$INSTDIR\soundfonts\generaluser_gs.sf2"
  !ifdef FLUIDR3
  Delete "$INSTDIR\soundfonts\FluidR3_GM.sf2"
  !endif
  Delete "$INSTDIR\${MANIFEST}"
  RMDir "$INSTDIR\soundfonts"
  Delete "$INSTDIR\${UNINSTALLER}"
  DeleteRegKey HKCU "${UNINSTKEY}"
SectionEnd

; 组件说明（必须放在 Section 之后：${SecGeneralUser} 由 Section 定义）
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecGeneralUser} "GeneralUser GS，约 30.8 MB。基础 GM 音色，覆盖大多数谱面。"
  !ifdef FLUIDR3
  !insertmacro MUI_DESCRIPTION_TEXT ${SecFluidR3} "FluidR3 GM，约 141.5 MB。更完整的 GM 音色，体积较大。"
  !endif
!insertmacro MUI_FUNCTION_DESCRIPTION_END
