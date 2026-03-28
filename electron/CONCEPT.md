# Synthstudio – Electron Desktop-Entwicklungskonzept

**Branch:** `electron-dev` | **Projekt:** [GeorgDub/Synthstudio](https://github.com/GeorgDub/Synthstudio) | **Stand:** März 2026

---

## 1. Zielsetzung

Das Ziel dieses Konzepts ist die Entwicklung einer vollwertigen Desktop-Applikation auf Basis von Electron, die die bestehende Synthstudio Web-App (React/Vite/Tone.js) als Kern nutzt. Die Desktop-Version soll native Betriebssystem-Features bieten – direkter Dateisystemzugriff, native Menüs, System-Tray, Auto-Updater – ohne die Web-Version in ihrer Funktionalität zu beeinträchtigen. Synthstudio muss weiterhin vollständig im Browser lauffähig bleiben.

---

## 2. Architektur-Prinzipien

Die gesamte Architektur folgt drei fundamentalen Prinzipien:

**Progressive Enhancement** bedeutet, dass die Web-App das Fundament bildet. Electron-Features werden additiv hinzugefügt und sind immer optional. Jede Funktion, die in Electron verfügbar ist, hat einen sinnvollen Browser-Fallback.

**Strikte Prozesstrennung** bedeutet, dass der Electron Main-Prozess (Node.js) niemals direkt mit dem React-Renderer kommuniziert – ausschließlich über die typsichere IPC-Bridge. Kein Node.js-Objekt verlässt den Main-Prozess ohne explizite Serialisierung.

**Isomorphe Entwicklung** bedeutet, dass alle Electron-spezifischen Aufrufe im Frontend hinter dem `useElectron()`-Hook liegen. Derselbe React-Code funktioniert im Browser (mit Fallbacks) und in Electron (mit nativen Features).

---

## 3. Technologie-Stack

| Schicht | Technologie | Version | Zweck |
|---|---|---|---|
| Desktop-Shell | Electron | ^40.6.1 | Chromium + Node.js Wrapper |
| Frontend | React + Vite | 19 / 7 | UI-Rendering |
| Audio | Tone.js | ^15.1.22 | Web Audio API Abstraktion |
| Sprache | TypeScript | 5.9.3 | Typsicherheit |
| Styling | Tailwind CSS | ^4.1.14 | Utility-first CSS |
| Build | electron-builder | ^26.8.1 | Cross-Platform Packaging |
| Paketmanager | pnpm | 10.4.1 | Schnelle Abhängigkeiten |

---

## 4. Aufgabenbereiche und Zuständigkeiten

Das Projekt ist in sechs parallele Aufgabenbereiche unterteilt. Jeder Bereich hat eine eigene `agent.md` im Verzeichnis `electron/agents/`.

| # | Bereich | Dateien | Priorität |
|---|---|---|---|
| 1 | Backend & Main-Prozess | `main.ts`, `windows.ts`, `dragdrop.ts`, `updater.ts` | Hoch |
| 2 | IPC-Bridge & API-Design | `preload.ts`, `types.d.ts`, `useElectron.ts` | Hoch |
| 3 | Frontend & GUI-Integration | `client/src/**` | Mittel |
| 4 | Audio-Engine & Performance | `waveform.ts`, `export.ts` | Mittel |
| 5 | Build, Packaging & Release | `package.json`, CI/CD | Niedrig (nach Stabilisierung) |
| 6 | Testing & QA | `tests/electron/**` | Laufend |

---

## 5. Vorhandene Implementierung (Ist-Zustand)

Die folgenden Module sind bereits im Branch `electron-dev` implementiert und bilden die Basis für die weitere Entwicklung:

| Modul | Größe | Status | Beschreibung |
|---|---|---|---|
| `electron/main.ts` | 29 KB | Stabil | Hauptprozess, Menüs, Shortcuts, Tray, Folder-Import |
| `electron/preload.ts` | 15 KB | Stabil | 50+ IPC-Methoden, typsichere Bridge |
| `electron/types.d.ts` | 6 KB | Stabil | Globale TypeScript-Deklarationen |
| `electron/useElectron.ts` | 9,2 KB | Stabil | React-Hook mit Browser-Fallbacks |
| `electron/updater.ts` | 5,7 KB | Bereit | Auto-Updater (aktivierbar mit `electron-updater`) |
| `electron/dragdrop.ts` | 5,5 KB | Stabil | Drag & Drop Kategorisierung und Routing |
| `electron/waveform.ts` | 9,7 KB | Stabil | WAV-Header-Parser, Waveform-Peak-Extraktion |
| `electron/windows.ts` | 7 KB | Stabil | Multi-Window-Support, WindowManager |
| `electron/export.ts` | 11 KB | Stabil | WAV-Bounce, MIDI-Export, Projekt-Save/Load |

---

## 6. IPC-Kanal-Übersicht

Die folgende Tabelle listet alle implementierten IPC-Kanäle auf:

| Kanal | Richtung | Beschreibung |
|---|---|---|
| `app:get-version` | Renderer → Main | App-Version abrufen |
| `app:get-path` | Renderer → Main | System-Pfade (home, documents, etc.) |
| `fs:read-file` | Renderer → Main | Audio-/Projektdatei lesen |
| `fs:list-directory` | Renderer → Main | Ordnerinhalt auflisten |
| `fs:write-file` | Renderer → Main | Datei schreiben |
| `samples:import-folder` | Renderer → Main | Ordner-Import starten |
| `samples:cancel-import` | Renderer → Main | Laufenden Import abbrechen |
| `samples:import-progress` | Main → Renderer | Fortschritt-Event (alle 5 Dateien) |
| `samples:import-complete` | Main → Renderer | Import abgeschlossen |
| `samples:import-error` | Main → Renderer | Fehler bei einzelner Datei |
| `dialog:open-file` | Renderer → Main | Nativer Öffnen-Dialog |
| `dialog:save-file` | Renderer → Main | Nativer Speichern-Dialog |
| `dialog:message` | Renderer → Main | Nativer Bestätigungs-Dialog |
| `window:set-fullscreen` | Renderer → Main | Vollbild umschalten |
| `window:new` | Renderer → Main | Neues Fenster öffnen |
| `window:update-state` | Renderer → Main | isDirty, Titel synchronisieren |
| `waveform:get-peaks` | Renderer → Main | Waveform-Peaks aus Datei |
| `waveform:get-metadata` | Renderer → Main | Audio-Metadaten |
| `dragdrop:process-files` | Renderer → Main | Gedropte Dateien kategorisieren |
| `dragdrop:load-sample` | Main → Renderer | Einzelne Datei auf Pad laden |
| `dragdrop:bulk-import` | Main → Renderer | Mehrere Dateien importieren |
| `export:wav` | Renderer → Main | WAV-Datei schreiben |
| `export:midi` | Renderer → Main | MIDI-Datei schreiben |
| `export:project` | Renderer → Main | Projekt als .esx1 speichern |
| `export:import-project` | Renderer → Main | Projekt-Datei lesen |
| `menu:*` | Main → Renderer | Alle Menü-Aktionen |
| `shortcut:*` | Main → Renderer | Globale Keyboard-Shortcuts |
| `updater:*` | Bidirektional | Auto-Updater Events |

---

## 7. Entwicklungs-Workflow

**Lokale Entwicklung:**
```bash
# Nur Web-App (wie bisher)
pnpm dev

# Electron + Web parallel
pnpm dev:electron
```

**Branching-Strategie:**
- `main` – Stabile Web-App, wird nie direkt für Electron-Features geändert
- `electron-dev` – Alle Electron-Entwicklungen, wird regelmäßig mit `main` synchronisiert

**Release-Prozess (nach Aktivierung des Build-Agents):**
```bash
# Version erhöhen
npm version patch|minor|major

# Build für alle Plattformen
pnpm build:electron

# Artefakte in release/ verfügbar
```

---

## 8. Offene Aufgaben

Die folgenden Aufgaben sind noch offen und werden von den jeweiligen Agenten bearbeitet:

| Aufgabe | Bereich | Priorität |
|---|---|---|
| `electron-updater` installieren und aktivieren | Build | Hoch |
| App-Icons erstellen (512×512 PNG, ICO, ICNS) | Build | Hoch |
| Frontend: Drag & Drop UI-Feedback implementieren | Frontend | Mittel |
| Frontend: Menü-Events an React-State binden | Frontend | Mittel |
| Frontend: Native Dialoge in Sample-Browser einbinden | Frontend | Mittel |
| WAV-Export: Stereo-Support (aktuell nur Mono) | Audio | Mittel |
| MIDI-Clock-Sync (optional) | Backend | Niedrig |
| E2E-Tests mit Playwright einrichten | Testing | Niedrig |
| GitHub Actions CI/CD Workflow erstellen | Build | Niedrig |

---

## 9. Dateistruktur

```
electron/
├── CONCEPT.md              ← Dieses Dokument
├── README.md               ← Schnellstart-Anleitung
├── main.ts                 ← Hauptprozess (Einstiegspunkt)
├── preload.ts              ← IPC-Bridge (Renderer-Seite)
├── types.d.ts              ← TypeScript-Typen für window.electronAPI
├── useElectron.ts          ← React-Hook mit Browser-Fallbacks
├── updater.ts              ← Auto-Updater Modul
├── dragdrop.ts             ← Drag & Drop Handler
├── waveform.ts             ← Waveform-Preview Modul
├── windows.ts              ← Multi-Window-Manager
├── export.ts               ← WAV/MIDI/Projekt-Export
└── agents/
    ├── backend_agent.md    ← Anweisungen für Backend-Entwickler
    ├── ipc_bridge_agent.md ← Anweisungen für IPC-Entwickler
    ├── frontend_agent.md   ← Anweisungen für Frontend-Entwickler
    ├── audio_engine_agent.md ← Anweisungen für Audio-Entwickler
    ├── build_agent.md      ← Anweisungen für Build/Release-Entwickler
    └── testing_agent.md    ← Anweisungen für QA-Entwickler
```
