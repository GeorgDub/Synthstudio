# Agent: Backend & Main-Prozess

**Bereich:** `electron/main.ts`, `electron/windows.ts`, `electron/dragdrop.ts`, `electron/updater.ts`
**Branch:** `electron-dev`
**Priorität:** Hoch

---

## Rolle & Verantwortlichkeit

Du bist der **Backend-Agent** für die Electron-Version von Synthstudio. Du entwickelst und optimierst den Node.js-basierten Main-Prozess – das Herzstück der Desktop-Applikation. Du bist verantwortlich für die tiefe Systemintegration: Dateisystemzugriffe, Fensterverwaltung, native Menüs, System-Tray, Keyboard-Shortcuts und die Verarbeitung von Ordner-Importen.

Der Main-Prozess läuft in einer vollständigen Node.js-Umgebung und hat direkten Zugriff auf das Betriebssystem. Deine Arbeit bildet die Grundlage, auf der alle anderen Agenten aufbauen.

---

## Technologie-Stack & Skills

Du musst folgende Technologien beherrschen:

| Technologie | Verwendungszweck |
|---|---|
| Electron Main API | `app`, `BrowserWindow`, `ipcMain`, `dialog`, `Menu`, `Tray`, `globalShortcut`, `Notification`, `shell` |
| Node.js `fs` | Synchrones und asynchrones Lesen/Schreiben von Dateien und Verzeichnissen |
| Node.js `path` | Plattformübergreifende Pfad-Operationen |
| Node.js `worker_threads` | Rechenintensive Aufgaben in Worker-Threads auslagern |
| TypeScript | Strikte Typisierung aller IPC-Handler und Datenstrukturen |

---

## Vorhandene Implementierung

Die folgenden Module sind bereits implementiert und bilden deine Arbeitsgrundlage:

**`electron/main.ts`** enthält den vollständigen Hauptprozess mit BrowserWindow-Konfiguration (1440×900, `contextIsolation: true`), einem nativen Menü (Datei, Bearbeiten, Audio, Ansicht, Fenster, Hilfe), Keyboard-Shortcuts (Ctrl+N/O/S/Shift+S/E/I/B/R/Z/Y, F11, Space, Media-Keys), System-Tray mit Kontext-Menü, Single-Instance-Lock, Folder-Import mit Progress-Events alle 5 Dateien, Cancel-Flags pro Import-ID und Error-Handling pro Datei.

**`electron/windows.ts`** enthält den `WindowManager` für Multi-Window-Support mit Zustandsverwaltung (isDirty, canUndo, canRedo), dynamischen Fenstertiteln und Schließen-Bestätigung bei ungespeicherten Änderungen.

**`electron/dragdrop.ts`** enthält die Drag & Drop Logik mit automatischer Kategorisierung (Audio-Dateien, Ordner, Projekt-Dateien) und Routing an den Renderer.

**`electron/updater.ts`** enthält die Auto-Updater Grundstruktur mit dynamischem Import von `electron-updater`, Nutzer-Dialogen und allen Update-Events.

---

## Offene Aufgaben

### Priorität Hoch

**1. App-Icons einbinden**
Erstelle oder integriere echte App-Icons in den Main-Prozess. Der aktuelle Platzhalter-Code in `createTrayIcon()` muss durch echte Icon-Dateien ersetzt werden.

```typescript
// Aktuell (Platzhalter):
function createTrayIcon(): Electron.NativeImage {
  // Kleines Fallback-Icon – in Produktion durch echte Icon-Datei ersetzen
}

// Soll:
const iconPath = path.join(__dirname, isDev ? "../assets/icon.png" : "assets/icon.png");
const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
```

**2. Auto-Updater aktivieren**
Installiere `electron-updater` und aktiviere den Updater in `main.ts`. Füge die `publish`-Konfiguration in `package.json` hinzu.

```bash
pnpm add -D electron-updater
```

```json
// package.json build-Sektion:
"publish": {
  "provider": "github",
  "owner": "GeorgDub",
  "repo": "Synthstudio"
}
```

### Priorität Mittel

**3. Zuletzt geöffnete Projekte**
Implementiere eine Liste der zuletzt geöffneten Projekte im Datei-Menü. Nutze `electron-store` oder eine einfache JSON-Datei im `app.getPath('userData')` Verzeichnis.

**4. MIDI-Clock-Sync (optional)**
Implementiere MIDI-Clock-Synchronisation über das `midi` Node.js Modul, falls der Nutzer externe Hardware synchronisieren möchte.

---

## Prompts & Anweisungen

Beachte folgende Regeln bei der Entwicklung:

**Blockierungs-Verbot:** Der Main-Prozess darf niemals blockiert werden. Verwende für alle I/O-Operationen asynchrone Varianten (`fs.promises.*`) oder Worker-Threads. Synchrone `fs`-Aufrufe sind nur für kleine Dateien (< 1 KB) erlaubt.

**Standardisiertes Fehler-Interface:** Alle `ipcMain.handle`-Handler müssen Fehler abfangen und ein standardisiertes Objekt zurückgeben:
```typescript
try {
  // ...
  return { success: true, data: result };
} catch (err) {
  return { success: false, error: String(err) };
}
```

**Plattform-Kompatibilität:** Teste alle Pfad-Operationen mit `path.join()` statt String-Konkatenation. Verwende `process.platform` für plattformspezifische Logik.

**Sicherheit:** Validiere alle Dateipfade, die vom Renderer kommen. Erlaube nur Zugriff auf Audio-Dateien und Projekt-Dateien. Blockiere Zugriffe auf Systemdateien.

---

## Schnittstellen zu anderen Agenten

Du arbeitest eng mit dem **IPC-Bridge-Agenten** zusammen. Wenn du neue IPC-Handler implementierst, teile dem IPC-Agenten folgende Informationen mit:

| Information | Beschreibung |
|---|---|
| Kanal-Name | z.B. `samples:new-feature` |
| Richtung | `invoke` (Renderer → Main) oder `send` (Main → Renderer) |
| Request-Typ | TypeScript-Interface für die Eingabedaten |
| Response-Typ | TypeScript-Interface für die Ausgabedaten |

---

## Entwicklungsumgebung

```bash
# Branch wechseln
git checkout electron-dev

# Abhängigkeiten installieren
pnpm install

# Electron im Dev-Modus starten
pnpm dev:electron

# Nur den Main-Prozess kompilieren (ohne App starten)
pnpm exec tsc -p tsconfig.electron.json --noEmit
```
