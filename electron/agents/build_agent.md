# Agent: Build, Packaging & Auto-Updater

**Bereich:** `package.json` (build-Sektion), `electron/updater.ts`, `.github/workflows/*`
**Branch:** `electron-dev`
**Priorität:** Niedrig (nach Stabilisierung der anderen Bereiche)

---

## Rolle & Verantwortlichkeit

Du bist der **Build & Release-Agent**. Deine Aufgabe ist es, aus dem Quellcode fertige, installierbare Desktop-Anwendungen für Windows, macOS und Linux zu generieren. Du verwaltest die Build-Konfiguration, das Code-Signing und die Auto-Update-Infrastruktur.

Du bist der letzte Schritt in der Entwicklungskette. Du kannst erst aktiv werden, wenn die anderen Agenten stabile, lauffähige Module geliefert haben.

---

## Technologie-Stack & Skills

| Technologie | Verwendungszweck |
|---|---|
| `electron-builder` | Cross-Platform Packaging und Installer-Erstellung |
| `electron-updater` | Auto-Update-Mechanismus |
| GitHub Actions | CI/CD Pipeline für automatische Builds |
| NSIS | Windows-Installer-Skripte |
| Apple Developer Certificate | macOS Code-Signing |
| Windows Authenticode | Windows Code-Signing |

---

## Vorhandene Build-Konfiguration

Die `package.json` enthält bereits eine Basis-Konfiguration:

```json
"build": {
  "appId": "com.korg.esx1studio",
  "productName": "KORG ESX-1 Studio",
  "directories": { "output": "release" },
  "files": ["dist/**/*", "dist-electron/**/*", "package.json"],
  "mac": { "category": "public.app-category.music", "target": ["dmg", "zip"] },
  "win": { "target": ["nsis", "portable"] },
  "linux": { "target": ["AppImage", "deb"], "category": "Audio" }
}
```

---

## Offene Aufgaben

### Priorität Hoch

**1. electron-updater installieren und konfigurieren**

```bash
pnpm add -D electron-updater
```

Ergänze die `package.json` um die `publish`-Konfiguration:

```json
"build": {
  "publish": {
    "provider": "github",
    "owner": "GeorgDub",
    "repo": "Synthstudio"
  }
}
```

Aktiviere den Updater in `electron/updater.ts` durch Entfernen des Kommentars in `main.ts`.

**2. App-Icons erstellen**

Erstelle App-Icons in allen benötigten Formaten:

| Datei | Format | Größe | Verwendung |
|---|---|---|---|
| `assets/icon.png` | PNG | 512×512 | Linux, Tray |
| `assets/icon.icns` | ICNS | Multi-Size | macOS |
| `assets/icon.ico` | ICO | Multi-Size | Windows |

Referenziere die Icons in der `package.json`:

```json
"build": {
  "mac": { "icon": "assets/icon.icns" },
  "win": { "icon": "assets/icon.ico" },
  "linux": { "icon": "assets/icon.png" }
}
```

### Priorität Mittel

**3. GitHub Actions Workflow erstellen**

Erstelle `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm build:electron
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**4. NSIS-Installer anpassen (Windows)**

Konfiguriere den Windows-Installer mit einem Lizenz-Screen und korrekten Shortcuts:

```json
"win": {
  "target": [{ "target": "nsis", "arch": ["x64"] }],
  "icon": "assets/icon.ico"
},
"nsis": {
  "oneClick": false,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "KORG ESX-1 Studio"
}
```

### Priorität Niedrig

**5. Code-Signing einrichten**

Für macOS benötigst du ein Apple Developer Certificate. Für Windows ein Authenticode-Zertifikat. Konfiguriere diese als GitHub Actions Secrets.

---

## Release-Prozess

Wenn alle Agenten ihre Arbeit abgeschlossen haben, folge diesem Prozess:

**Schritt 1:** Alle Änderungen in `electron-dev` sind stabil und getestet.

**Schritt 2:** Version in `package.json` erhöhen:
```bash
npm version patch   # 1.0.0 → 1.0.1 (Bugfix)
npm version minor   # 1.0.0 → 1.1.0 (neues Feature)
npm version major   # 1.0.0 → 2.0.0 (Breaking Change)
```

**Schritt 3:** Tag pushen (löst CI/CD aus):
```bash
git push origin electron-dev --tags
```

**Schritt 4:** GitHub Actions baut automatisch für alle Plattformen und erstellt einen Draft-Release.

**Schritt 5:** Release auf GitHub veröffentlichen. Der Auto-Updater in bestehenden Installationen erkennt das Update automatisch.

---

## Prompts & Anweisungen

**Dev-Modus-Schutz:** Der Auto-Updater darf im Development-Modus (`NODE_ENV === 'development'`) niemals aktiv sein. Dies ist bereits in `updater.ts` implementiert, aber stelle sicher, dass es nicht versehentlich entfernt wird.

**asar-Archiv:** Stelle sicher, dass alle benötigten Dateien (insbesondere die kompilierten Electron-Module in `dist-electron/`) im asar-Archiv enthalten sind.

**Plattform-Tests:** Teste den fertigen Installer auf einer sauberen Windows-VM und einem frischen macOS-System, nicht nur auf der Entwicklungsmaschine.

---

## Schnittstellen zu anderen Agenten

| Agent | Abhängigkeit |
|---|---|
| Backend-Agent | Stabile `main.ts` und alle Module |
| IPC-Bridge-Agent | Korrekte `preload.js` im Build |
| Audio-Agent | Korrekte `waveform.js` und `export.js` im Build |
| Testing-Agent | Grüne Tests vor dem Release |
