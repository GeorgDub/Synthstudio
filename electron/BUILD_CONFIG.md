# Synthstudio – Build-Konfiguration (Build-Agent)

Vollständige Anleitung zum Bauen und Veröffentlichen der Electron-Desktop-App.

---

## 1. package.json – Build-Sektion

Füge folgendes in die `package.json` ein (auf oberster Ebene, neben `scripts`):

```json
{
  "build": {
    "appId": "com.synthstudio.esx1",
    "productName": "Synthstudio",
    "copyright": "Copyright © 2025 Synthstudio",
    "directories": {
      "output": "release",
      "buildResources": "assets"
    },
    "files": [
      "dist/**/*",
      "electron/dist/**/*",
      "assets/**/*",
      "!**/*.map",
      "!**/*.ts",
      "!node_modules/.cache/**/*"
    ],
    "extraResources": [
      {
        "from": "assets/samples",
        "to": "samples",
        "filter": ["**/*.wav"]
      }
    ],
    "win": {
      "target": [
        { "target": "nsis", "arch": ["x64", "ia32"] }
      ],
      "icon": "assets/icon.ico",
      "publisherName": "Synthstudio",
      "verifyUpdateCodeSignature": false
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "allowElevation": true,
      "installerIcon": "assets/icon.ico",
      "uninstallerIcon": "assets/icon.ico",
      "installerHeaderIcon": "assets/icon.ico",
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "Synthstudio",
      "include": "assets/installer.nsh"
    },
    "mac": {
      "target": [
        { "target": "dmg", "arch": ["x64", "arm64"] },
        { "target": "zip", "arch": ["x64", "arm64"] }
      ],
      "icon": "assets/icon.icns",
      "category": "public.app-category.music",
      "darkModeSupport": true,
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "assets/entitlements.mac.plist",
      "entitlementsInherit": "assets/entitlements.mac.plist"
    },
    "dmg": {
      "title": "Synthstudio ${version}",
      "icon": "assets/icon.icns",
      "background": "assets/dmg-background.png",
      "window": { "width": 540, "height": 380 },
      "contents": [
        { "x": 130, "y": 220, "type": "file" },
        { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
      ]
    },
    "linux": {
      "target": [
        { "target": "AppImage", "arch": ["x64"] },
        { "target": "deb", "arch": ["x64"] }
      ],
      "icon": "assets/icon.png",
      "category": "Audio",
      "synopsis": "KORG ESX-1 Sample-Manager und Synthesizer-Studio",
      "description": "Professioneller Sample-Manager und Synthesizer-Studio für den KORG ESX-1"
    },
    "deb": {
      "depends": ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1"],
      "recommends": ["libappindicator3-1"]
    },
    "publish": {
      "provider": "github",
      "owner": "GeorgDub",
      "repo": "Synthstudio",
      "releaseType": "release"
    }
  }
}
```

---

## 2. Scripts in package.json

```json
{
  "scripts": {
    "dev": "vite",
    "dev:electron": "concurrently \"pnpm dev\" \"wait-on http://localhost:5173 && electron .\"",
    "build": "tsc && vite build",
    "build:electron": "pnpm build && tsc -p tsconfig.electron.json && electron-builder",
    "build:electron:win": "pnpm build && tsc -p tsconfig.electron.json && electron-builder --win",
    "build:electron:mac": "pnpm build && tsc -p tsconfig.electron.json && electron-builder --mac",
    "build:electron:linux": "pnpm build && tsc -p tsconfig.electron.json && electron-builder --linux",
    "generate:icons": "npx tsx electron/assets/icon-generator.ts",
    "release": "pnpm build:electron --publish always"
  }
}
```

---

## 3. Auto-Updater aktivieren

### Schritt 1: Paket installieren
```bash
pnpm add -D electron-updater
```

### Schritt 2: In electron/main.ts einkommentieren
```ts
// Am Anfang der Datei:
import { setupAutoUpdater } from "./updater";

// In der app.whenReady() Funktion nach createWindow():
setupAutoUpdater(mainWindow);
```

### Schritt 3: GitHub Token als Secret hinterlegen
Im GitHub Repository unter **Settings → Secrets → Actions**:
- `GH_TOKEN` = Personal Access Token mit `repo` Berechtigung

---

## 4. Icon-Dateien erstellen

### PNG (Basis)
```bash
pnpm generate:icons
# Erstellt: assets/icon.png (512×512)
```

### Windows ICO
```bash
pnpm add -D png-to-ico
npx png-to-ico assets/icon.png > assets/icon.ico
```

### macOS ICNS
```bash
# macOS:
mkdir icon.iconset
sips -z 16 16   assets/icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32   assets/icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32   assets/icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64   assets/icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128 assets/icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256 assets/icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256 assets/icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512 assets/icon.png --out icon.iconset/icon_256x256@2x.png
cp assets/icon.png icon.iconset/icon_512x512.png
iconutil -c icns icon.iconset -o assets/icon.icns
rm -rf icon.iconset
```

---

## 5. macOS Entitlements

Erstelle `assets/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
</dict>
</plist>
```

---

## 6. Release-Prozess (Schritt für Schritt)

### Lokaler Test-Build
```bash
# Alle Plattformen (nur auf CI empfohlen)
pnpm build:electron

# Nur aktuelle Plattform
pnpm build:electron  # automatisch erkannt
```

### Release veröffentlichen

```bash
# 1. Version in package.json erhöhen
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0

# 2. Tag pushen (löst GitHub Actions Workflow aus)
git push origin main --tags

# 3. GitHub Actions baut automatisch für alle Plattformen
# 4. Release wird automatisch erstellt
```

### Manueller Release (ohne Tag)
```bash
# Im GitHub Repository: Actions → Electron Release → Run workflow
# Version eingeben und starten
```

---

## 7. Abhängigkeiten (devDependencies)

```json
{
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "electron-updater": "^6.0.0",
    "concurrently": "^9.0.0",
    "wait-on": "^8.0.0",
    "canvas": "^2.11.0",
    "png-to-ico": "^2.1.8"
  }
}
```

---

## 8. Verzeichnisstruktur nach dem Build

```
release/
├── Synthstudio-1.0.0-Setup.exe       (Windows NSIS Installer)
├── Synthstudio-1.0.0.dmg             (macOS DMG)
├── Synthstudio-1.0.0.AppImage        (Linux AppImage)
├── synthstudio_1.0.0_amd64.deb       (Linux DEB)
├── latest.yml                        (Auto-Updater Manifest)
├── latest-mac.yml
└── latest-linux.yml
```
