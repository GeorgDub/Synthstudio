# Synthstudio – Electron Integration

Dieses Verzeichnis enthält den Electron-Hauptprozess für die Desktop-Version von Synthstudio.
Die Web-App (`client/`) bleibt vollständig unverändert und funktioniert weiterhin wie gewohnt im Browser.

## Architektur

```
synthstudio/
├── client/          ← Web-App (React/Vite) – UNVERÄNDERT
├── server/          ← Backend (Express/tRPC) – UNVERÄNDERT
├── shared/          ← Gemeinsamer Code – UNVERÄNDERT
├── electron/        ← Electron-Prozesse (NUR HIER ÄNDERUNGEN)
│   ├── main.ts      ← Hauptprozess (BrowserWindow, Menü, IPC-Handler)
│   ├── preload.ts   ← Sichere Bridge: Main ↔ Renderer
│   └── README.md    ← Diese Datei
├── tsconfig.electron.json  ← TypeScript-Konfiguration für Electron
└── package.json     ← Electron-Scripts bereits vorhanden
```

## Entwicklung

### Voraussetzungen

```bash
pnpm install
```

### Entwicklungs-Modus starten

**Terminal 1** – Vite Dev-Server starten:
```bash
pnpm dev
```

**Terminal 2** – Electron starten (wartet automatisch auf Vite):
```bash
pnpm dev:electron
```

Oder beides zusammen:
```bash
pnpm dev:electron
# Startet: Vite Dev-Server + Electron (via concurrently + wait-on)
```

### Electron-Dateien kompilieren

```bash
pnpm build:electron
```

Dies führt aus:
1. `vite build` – Frontend bauen
2. `tsc` mit `tsconfig.electron.json` – Electron-TypeScript kompilieren
3. `electron-builder` – Installer/Pakete erstellen

## Verfügbare Scripts

| Script | Beschreibung |
|---|---|
| `pnpm dev` | Nur Vite Dev-Server (Web-Browser) |
| `pnpm dev:electron` | Vite + Electron parallel |
| `pnpm build` | Nur Web-App bauen |
| `pnpm build:electron` | Alles bauen + Installer erstellen |
| `pnpm start:electron` | Gebaute Electron-App starten |

## window.electronAPI

Im Renderer (React-Komponenten) ist die Electron-API über `window.electronAPI` zugänglich.
Prüfe immer ob Electron verfügbar ist:

```typescript
if (window.electronAPI?.isElectron) {
  // Electron-spezifischer Code
  const filePaths = await window.electronAPI.readFile("/path/to/sample.wav");
} else {
  // Browser-Fallback
}
```

### Verfügbare Methoden

| Methode | Beschreibung |
|---|---|
| `isElectron` | `true` wenn in Electron |
| `platform` | `'win32'` / `'darwin'` / `'linux'` |
| `getVersion()` | App-Version |
| `readFile(path)` | Lokale Datei als ArrayBuffer lesen |
| `listDirectory(path)` | Verzeichnis-Inhalt auflisten |
| `onMenuExportProject(cb)` | Menü-Event: Projekt exportieren |
| `onMenuImportProject(cb)` | Menü-Event: Projekt importieren |
| `onMenuOpenSampleBrowser(cb)` | Menü-Event: Sample-Browser öffnen |
| `onMenuImportSamples(cb)` | Menü-Event: Samples importieren |
| `onMenuImportSampleFolder(cb)` | Menü-Event: Sample-Ordner importieren |

## Build-Ausgabe

Nach `pnpm build:electron` befinden sich die Installer in `release/`:

- **Windows**: `release/KORG ESX-1 Studio Setup.exe` (NSIS) + portable `.exe`
- **macOS**: `release/KORG ESX-1 Studio.dmg`
- **Linux**: `release/KORG ESX-1 Studio.AppImage` + `.deb`

## Branch-Strategie

- `main` – Stabile Web-App, wird **nicht** durch Electron-Entwicklung berührt
- `electron-dev` – Aktive Electron-Entwicklung (dieser Branch)

Änderungen an der Web-App (`client/`, `server/`, `shared/`) werden von `main` in `electron-dev` gemergt.
Electron-spezifische Änderungen bleiben in `electron-dev` und werden erst nach Stabilisierung in `main` gemergt.
