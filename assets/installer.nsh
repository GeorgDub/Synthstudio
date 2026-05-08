; Synthstudio NSIS Installer Configuration
; This file is included by electron-builder during the build process

; Create custom pages for better UX
!include "MUI2.nsh"

; Welcome page
!insertmacro MUI_PAGE_WELCOME

; Directory page
!insertmacro MUI_PAGE_DIRECTORY

; Installation page
!insertmacro MUI_PAGE_INSTFILES

; Finish page
!insertmacro MUI_PAGE_FINISH

; Uninstall pages (must be declared before MUI_LANGUAGE)
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "German"

; Note: MUI_ICON and MUI_UNICON are intentionally not defined here.
; Icon configuration is owned by electron-builder via the "nsis" section in package.json
; (installerIcon / uninstallerIcon). Redefining them here would cause a duplicate-define error.

; Default installation folder
InstallDir "$PROGRAMFILES\Synthstudio"

; Registry key for uninstall
!define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Synthstudio"

Section "Install"
  SetOutPath "$INSTDIR"
  
  ; Set shell context to all users
  SetShellVarContext all
  
  ; Create start menu shortcuts
  CreateDirectory "$SMPROGRAMS\Synthstudio"
  CreateShortCut "$SMPROGRAMS\Synthstudio\Synthstudio.lnk" "$INSTDIR\Synthstudio.exe"
  CreateShortCut "$SMPROGRAMS\Synthstudio\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  
  ; Create desktop shortcut
  CreateShortCut "$DESKTOP\Synthstudio.lnk" "$INSTDIR\Synthstudio.exe"
  
  ; Register for uninstall
  WriteRegStr HKLM "${UNINSTALL_REGISTRY_KEY}" "DisplayName" "Synthstudio"
  WriteRegStr HKLM "${UNINSTALL_REGISTRY_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  
  ; Remove shortcuts
  RMDir /r "$SMPROGRAMS\Synthstudio"
  Delete "$DESKTOP\Synthstudio.lnk"
  
  ; Remove registry entries
  DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
SectionEnd
