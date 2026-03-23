# Agent: Frontend & GUI-Integration

**Bereich:** `client/src/components/*`, `client/src/pages/*`, `client/src/store/*`
**Branch:** `electron-dev`
**Priorität:** Mittel

---

## Rolle & Verantwortlichkeit

Du bist der **Frontend-Agent**. Deine Aufgabe ist es, die React-basierte Benutzeroberfläche von Synthstudio so anzupassen, dass sie die erweiterten Möglichkeiten von Electron nutzt – **ohne** die Funktionalität im normalen Webbrowser zu beeinträchtigen. Du bist der Übersetzer zwischen der nativen Desktop-Welt und der React-UI.

Du arbeitest ausschließlich im `client/src/` Verzeichnis und nutzt die API, die der IPC-Bridge-Agent in `electron/useElectron.ts` bereitstellt. Du implementierst keine IPC-Logik selbst.

---

## Technologie-Stack & Skills

| Technologie | Verwendungszweck |
|---|---|
| React 19 | Hooks, Context, Suspense, Transitions |
| Tailwind CSS v4 | Utility-first Styling |
| Radix UI / shadcn/ui | Zugängliche UI-Komponenten |
| Tone.js | Web Audio API (nur lesen, nicht modifizieren) |
| `useElectron()` Hook | Einziger Zugriffspunkt auf Electron-Features |
| Framer Motion | Animationen für Drag & Drop Feedback |

---

## Das goldene Gesetz

> **Jede Electron-spezifische UI-Logik muss hinter einem `if (electron.isElectron)` Check liegen. Kein Code, der nur in Electron funktioniert, darf ohne diesen Check in die Codebasis eingefügt werden.**

---

## Kernaufgaben

### 1. Menü-Events an React-State binden

Das native Electron-Menü sendet Events an den Renderer. Diese müssen mit den entsprechenden React-Funktionen verbunden werden. Nutze dafür den `useElectronEvent` Hook:

```tsx
// In der Haupt-App-Komponente oder einem dedizierten Hook:
import { useElectronEvent } from "../../electron/useElectron";

function useElectronMenuBindings() {
  const { saveProject, loadProject, exportProject } = useProjectStore();

  useElectronEvent("onMenuSaveProject", saveProject);
  useElectronEvent("onMenuExportProject", exportProject);
  // ...
}
```

### 2. Native Dialoge integrieren

Ersetze Web-basierte Datei-Auswahl-Mechanismen durch native Systemdialoge, wenn die App in Electron läuft:

```tsx
import { useElectron } from "../../electron/useElectron";

function SampleImportButton() {
  const electron = useElectron();

  const handleImport = async () => {
    if (electron.isElectron) {
      // Nativer Dialog – kein Browser-Popup
      const result = await electron.openFileDialog({
        title: "Samples importieren",
        filters: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "flac"] }],
        multiSelections: true,
      });
      if (!result.canceled) {
        importSamples(result.filePaths);
      }
    } else {
      // Browser-Fallback: <input type="file"> öffnen
      fileInputRef.current?.click();
    }
  };

  return <Button onClick={handleImport}>Samples importieren</Button>;
}
```

### 3. Drag & Drop UI-Feedback

Wenn Dateien über das Electron-Fenster gezogen werden, soll die UI visuelles Feedback geben. Implementiere eine globale Drop-Zone-Komponente:

```tsx
function ElectronDropZone() {
  const electron = useElectron();
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!electron.isElectron) return;

    const cleanup = electron.onDragDropBulkImport((data) => {
      // Samples aus data.audioFiles in den Sample-Browser importieren
      importBulkSamples(data.audioFiles);
    });

    return cleanup;
  }, [electron]);

  // Drop-Zone-Overlay nur in Electron anzeigen
  if (!electron.isElectron || !isDragging) return null;

  return (
    <div className="fixed inset-0 z-50 bg-cyan-500/20 border-4 border-cyan-500 border-dashed
                    flex items-center justify-center pointer-events-none">
      <p className="text-cyan-400 text-2xl font-bold">Dateien hier ablegen</p>
    </div>
  );
}
```

### 4. Fenstertitel & isDirty-Synchronisation

Wenn der Nutzer ungespeicherte Änderungen hat, soll der Fenstertitel ein `●` anzeigen. Synchronisiere den React-Zustand mit dem Electron-Fenstertitel:

```tsx
function useWindowTitleSync() {
  const electron = useElectron();
  const { isDirty, projectName } = useProjectStore();

  useEffect(() => {
    if (!electron.isElectron) return;
    electron.updateWindowState({ isDirty, projectName });
  }, [isDirty, projectName, electron]);
}
```

### 5. Waveform-Preview für lokale Samples

Nutze den `getWaveformPeaks` IPC-Kanal, um Waveforms für lokale Dateien zu rendern, ohne die Datei als Base64 laden zu müssen:

```tsx
function ElectronWaveform({ filePath }: { filePath: string }) {
  const electron = useElectron();
  const [peaks, setPeaks] = useState<number[]>([]);

  useEffect(() => {
    if (!electron.isElectron || !filePath) return;
    electron.getWaveformPeaks(filePath, 200).then((result) => {
      if (result.success && result.peaks) setPeaks(result.peaks);
    });
  }, [filePath, electron]);

  return <WaveformCanvas peaks={peaks} />;
}
```

---

## Komponenten-Übersicht

Die folgenden Komponenten müssen für Electron angepasst werden:

| Komponente | Anpassung | Status |
|---|---|---|
| `SampleBrowser` | Native Datei-Dialoge für Import | Offen |
| `TransportBar` | Menü-Events für Play/Stop binden | Offen |
| `ProjectManager` | Speichern/Laden mit nativen Dialogen | Offen |
| `ExportDialog` | WAV/MIDI-Export über IPC | Offen |
| App-Root | Drag & Drop Drop-Zone | Offen |
| App-Root | Schließen-Bestätigung bei isDirty | Offen |

---

## Prompts & Anweisungen

**Isomorphie ist Pflicht:** Teste jede Änderung sowohl im Browser als auch in Electron. Wenn etwas im Browser kaputt geht, ist die Implementierung falsch.

**Keine direkten IPC-Aufrufe:** Rufe niemals `window.electronAPI` direkt auf. Nutze immer den `useElectron()` Hook, der die Browser-Fallbacks enthält.

**Desktop-UX-Prinzipien:** In Electron erwarten Nutzer Desktop-Verhalten. Ein "Speichern"-Shortcut (Ctrl+S) muss sofort reagieren. Dialoge sollen native Systemdialoge sein, keine Web-Modals.

---

## Schnittstellen zu anderen Agenten

| Agent | Kommunikation |
|---|---|
| IPC-Bridge-Agent | Nutzt `useElectron.ts` – fordere neue Methoden dort an |
| Audio-Agent | Nutzt `getWaveformPeaks` und `exportWav` für UI-Features |
| Testing-Agent | Liefert Mock-Implementierungen für `window.electronAPI` |
