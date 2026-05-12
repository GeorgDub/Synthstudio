# Synthstudio – Release-Workflow

Dieses Dokument beschreibt wie neue Versionen veröffentlicht werden – inkl. Auto-Updater-Flow für Desktop-User.

## Voraussetzungen (einmalig)

1. **GitHub Personal Access Token** mit Schreibrechten auf das Release-Repo
   - Repo: `https://github.com/GeorgDub/Synthstudio-releases`
   - Token erstellen: GitHub → Settings → Developer Settings → Personal access tokens (classic) → `repo`-Scope
   - In Repo-Settings → Secrets → New repository secret: **`RELEASES_TOKEN`**

2. **Code-Signing (optional, empfohlen für Produktion)**
   - **Windows**: Code-Signing-Zertifikat (z.B. von DigiCert / Sectigo)
     - Secret `CSC_LINK` (Base64-Encoded `.pfx`) + `CSC_KEY_PASSWORD`
   - **macOS**: Apple Developer Account ($99/Jahr) + Notarization
     - Secrets: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
   - Aktuell deaktiviert via `CSC_IDENTITY_AUTO_DISCOVERY: "false"`

3. **Code lokal aktuell**
   - `pnpm install`
   - `pnpm check` (TypeScript clean)
   - `pnpm test` (alle Vitest-Tests grün)
   - `pnpm test:web` (Playwright Browser-Tests grün)

## Release-Schritte

### 1. Version bumpen

```bash
# Sicherstellen dass alle Änderungen committed sind
git status

# Version in package.json setzen (z.B. 1.14 → 1.15)
# Manuell oder mit npm version:
npm version 1.15.0 --no-git-tag-version
```

### 2. Commit + Tag

```bash
git add package.json pnpm-lock.yaml
git commit -m "Bump version to 1.15.0"
git tag v1.15.0
git push origin main
git push origin v1.15.0
```

### 3. GitHub Actions baut automatisch

Beim Push des Tags `v*.*.*` startet `electron-release.yml`:

1. **Pre-Release Tests** (Ubuntu) – TypeScript-Check + Vitest
2. **Parallele Builds** auf:
   - `ubuntu-latest` → AppImage + DEB
   - `windows-latest` → NSIS-Installer
   - `macos-latest` (Intel x64) → DMG + ZIP
   - `macos-14` (Apple Silicon arm64) → DMG + ZIP
3. **Upload** zur GitHub-Releases-Seite des `Synthstudio-releases`-Repos

**Status prüfen**: https://github.com/GeorgDub/Synthstudio/actions

### 4. Release veröffentlichen

Nach erfolgreichem Build:

1. Zu `Synthstudio-releases` → Releases gehen
2. Den von `electron-builder` erstellten Draft-Release öffnen
3. Changelog ergänzen (manuell oder aus `git log`)
4. **Publish release** klicken

### 5. Auto-Updater erkennt das Release

User mit installierter App bekommen:
- Beim nächsten Start (oder nach 10 Sekunden) einen Dialog: "Version 1.15.0 ist verfügbar – Herunterladen?"
- Nach Download: "Update bereit – Jetzt neu starten?"
- Update wird beim nächsten App-Start installiert

## Lokales Build-Testing (vor Release)

```bash
# Nur das aktuelle Betriebssystem bauen
pnpm build:electron        # alle Plattformen via electron-builder
pnpm build:electron:win    # nur Windows
pnpm build:electron:mac    # nur macOS (Intel + ARM)
pnpm build:electron:linux  # nur Linux

# Output: release/
ls release/
```

**WICHTIG für Mac-Tests:**
- `--x64` für Intel-Macs
- `--arm64` für Apple Silicon (M1/M2/M3/M4)
- Ohne Signierung: User muss beim ersten Start in Systemeinstellungen → Sicherheit → "Trotzdem öffnen" klicken

## Manueller Workflow-Trigger

Falls kein Tag gepusht werden soll:

1. GitHub → Actions → "Electron Release" → "Run workflow"
2. Optional: Version-Eingabefeld → z.B. `1.15.0-beta1`

## Troubleshooting

### Auto-Updater zeigt „Update-Check fehlgeschlagen"

- **Wahrscheinlich Ursache**: `Synthstudio-releases`-Repo ist privat oder hat keine Releases
- **Fix**: Repo öffentlich machen ODER `RELEASES_TOKEN` mit Lesezugriff in der App einbetten

### macOS: „App ist beschädigt"

- **Ursache**: Fehlende Notarization
- **Workaround für User**: `xattr -dr com.apple.quarantine /Applications/Synthstudio.app`
- **Permanente Lösung**: Apple Developer Account + Code-Signing aktivieren

### Windows: SmartScreen-Warnung

- **Ursache**: Fehlendes EV Code-Signing-Zertifikat
- **Workaround für User**: "Weitere Informationen" → "Trotzdem ausführen"
- **Permanente Lösung**: Code-Signing-Zertifikat erwerben + `CSC_LINK`/`CSC_KEY_PASSWORD` setzen

### Linux AppImage startet nicht

- **Ursache**: Fehlende Ausführungsrechte
- **Fix**: `chmod +x Synthstudio-1.15.0.AppImage`

## Versionierung (SemVer)

- `MAJOR.MINOR.PATCH` (z.B. `1.15.0`)
- **MAJOR**: Breaking Changes (z.B. Projekt-Format inkompatibel)
- **MINOR**: Neue Features
- **PATCH**: Bug-Fixes
- Pre-Releases: `1.15.0-beta1`, `1.15.0-rc1`

## Aktuelle Phase

Stand: Synthstudio v1.14
- ✅ electron-updater installiert
- ✅ Publish-Config in `package.json`
- ✅ `setupAutoUpdater` in `main.ts` aktiv
- ✅ UpdateBadge in Toolbar funktional
- ✅ GitHub Actions Multi-Platform-Workflow
- ⚠️ Code-Signing **noch nicht** aktiviert (CSC_LINK/CSC_KEY_PASSWORD nicht gesetzt)
- ⚠️ macOS Notarization **noch nicht** aktiviert
