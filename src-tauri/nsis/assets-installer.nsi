;
; assets-installer.nsi — 单个资源文件的独立安装器（2026-10-26 用户口径）
;
; 规则：**一个安装包只装一个资源文件**；文件名必须是
;   iJipu-<Type>-<ResourceId>_<ResourceVersion>_<Arch>-setup.exe
; 具体见 scripts/asset-naming.mjs 与 docs/INSTALLER-NAMING.md。
;
; 构建：node scripts/build-assets-installer.mjs（调用 Tauri 的 makensis）
; 必需参数：
;   -DTYPE=SoundFont|Tool  资源类型
;   -DRESOURCE_ID=...      资源标识（ASCII，如 GeneralUserGS）
;   -DRESOURCE_NAME=...    安装器里显示的资源名（如 GeneralUser GS）
;   -DSUBDIR=soundfonts    安装到主程序目录下的哪个子目录
;   -DFILENAME=...         安装后的文件名
;   -DSOURCE=...           源文件绝对路径
; Optional:
;   -DRESOURCE_VERSION=<x.y.z> 资源自身版本（默认 0.1.0；不是应用版本）
;   -DOUTFILE=<path>       默认 iJipu-${TYPE}-${RESOURCE_ID}_${RESOURCE_VERSION}_x64-setup.exe
;
; 与主安装包的关系：主包不含大资源；本安装器靠 HKCU\Software\iJipu\InstallDir
; 找主程序，校验 ijipu.exe 后才允许安装；卸载只删自己装的那一个文件与自己的 manifest。
;
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include WinVer.nsh

!ifndef TYPE
  !error "缺少 -DTYPE=SoundFont|Tool"
!endif
!ifndef RESOURCE_ID
  !error "缺少 -DRESOURCE_ID=<ASCII id>"
!endif
!ifndef RESOURCE_NAME
  !error "缺少 -DRESOURCE_NAME=<显示名>"
!endif
!ifndef SUBDIR
  !error "缺少 -DSUBDIR=<soundfonts|tools|...>"
!endif
!ifndef FILENAME
  !error "缺少 -DFILENAME=<安装后的文件名>"
!endif
!ifndef SOURCE
  !error "缺少 -DSOURCE=<源文件路径>"
!endif
!ifndef RESOURCE_VERSION
  !define RESOURCE_VERSION "0.1.0"
!endif
!ifndef OUTFILE
  !define OUTFILE "iJipu-${TYPE}-${RESOURCE_ID}_${RESOURCE_VERSION}_x64-setup.exe"
!endif

; 类型中文名（安装器 UI；文件名只用 ASCII 的 TYPE）
!if "${TYPE}" == "SoundFont"
  !define TYPE_CN "音色库"
!else if "${TYPE}" == "Tool"
  !define TYPE_CN "工具"
!else
  !error "TYPE 只支持 SoundFont / Tool"
!endif

!define APP_NAME "爱记谱 iJipu ${TYPE_CN} · ${RESOURCE_NAME}"
!define APP_KEY "iJipuAsset-${RESOURCE_ID}"
!define MAIN_EXE "ijipu.exe"
!define MAIN_REG_KEY "Software\iJipu"
!define RES_KEY "Software\iJipu\ResourceUninstallers"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_KEY}"
!define UNINSTALLER "uninst-iJipu-${RESOURCE_ID}.exe"
!define MANIFEST "assets.${RESOURCE_ID}.manifest.json"

Name "${APP_NAME}"
Caption "${APP_NAME} ${RESOURCE_VERSION}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\iJipu"
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "这个安装包为「爱记谱 iJipu」补充${TYPE_CN}：${RESOURCE_NAME}。$\r$\n$\r$\n只装这一个资源文件；不需要的资源不必下载。$\r$\n$\r$\n安装位置会自动找主程序，也可以手动选择。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "请选择 **iJipu 主程序所在目录**（里面有 ijipu.exe）。本资源会装进这个目录的 ${SUBDIR}\ 子目录。"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "启动爱记谱 iJipu"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  ReadRegStr $0 HKCU "${MAIN_REG_KEY}" "InstallDir"
  StrCmp $0 "" 0 ijipu_asset_use_reg
  StrCpy $0 "$LOCALAPPDATA\iJipu"
  ijipu_asset_use_reg:
  StrCpy $INSTDIR $0
  IfFileExists "$INSTDIR\${MAIN_EXE}" ijipu_asset_init_done
  MessageBox MB_OK|MB_ICONINFORMATION "没有在默认位置找到 iJipu 主程序。$\r$\n$\r$\n请点「下一步」后手动选择 ijipu.exe 所在目录；如果还没安装主程序，请先安装 iJipu。"
  ijipu_asset_init_done:
FunctionEnd

Function .onVerifyInstDir
  IfFileExists "$INSTDIR\${MAIN_EXE}" +2
    Abort
FunctionEnd

Function LaunchApp
  Exec '"$INSTDIR\${MAIN_EXE}"'
FunctionEnd

Section "${TYPE_CN}：${RESOURCE_NAME}" SecResource
  SetOutPath "$INSTDIR\${SUBDIR}"
  File "/oname=${FILENAME}" "${SOURCE}"
SectionEnd

Section "-资源清单" SecManifest
  ; 每个资源一个 manifest；主程序当前不消费它，但卸载器/诊断靠它只删自己
  SetOutPath "$INSTDIR"
  FileOpen $0 "$INSTDIR\${MANIFEST}" w
  FileWrite $0 "{$\r$\n"
  FileWrite $0 '  "type": "${TYPE}",$\r$\n'
  FileWrite $0 '  "id": "${RESOURCE_ID}",$\r$\n'
  FileWrite $0 '  "name": "${RESOURCE_NAME}",$\r$\n'
  FileWrite $0 '  "file": "${SUBDIR}/${FILENAME}",$\r$\n'
  FileWrite $0 '  "resourceVersion": "${RESOURCE_VERSION}",$\r$\n'
  FileWrite $0 '  "installedAt": "${__DATE__} ${__TIME__}"$\r$\n'
  FileWrite $0 "}$\r$\n"
  FileClose $0
SectionEnd

Section "-卸载信息"
  WriteUninstaller "$INSTDIR\${UNINSTALLER}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${RESOURCE_VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "蜗牛🐌"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${MAIN_EXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER}" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ; 主卸载器的「完全卸载」会枚举这个键，逐个调用各资源的卸载器
  WriteRegStr HKCU "${RES_KEY}" "${RESOURCE_ID}" "$INSTDIR\${UNINSTALLER}"
SectionEnd

Section "Uninstall"
  ; 只删本安装器装的那一个文件；用户自己导入/下载的其它库不动
  Delete "$INSTDIR\${SUBDIR}\${FILENAME}"
  Delete "$INSTDIR\${MANIFEST}"
  Delete "$INSTDIR\${UNINSTALLER}"
  DeleteRegValue HKCU "${RES_KEY}" "${RESOURCE_ID}"
  DeleteRegKey HKCU "${UNINSTKEY}"
  RMDir "$INSTDIR\${SUBDIR}"
SectionEnd
