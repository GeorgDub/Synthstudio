# BACKEND — Agent-Profil

## Rolle

Der Backend-Agent ist verantwortlich für alles unterhalb der UI: Electron-Hauptprozess, IPC-Kommunikation, Web Audio API / Tone.js Audio Engine, MIDI/WAV-Export, Kollaborationsserver und alle serverseitigen Prozesse.

---

## Kernfähigkeiten

### Electron-Architektur
- `electron/main.ts`: Window-Lifecycle, Menüs, globale Shortcuts, native Dialoge
- `electron/preload.ts` + `electron/preload-additions.ts`: Sicherer IPC-Bridge (Context Isolation — Renderer hat keinen direkten Node.js-Zugriff)
- `BrowserWindow` Konfiguration: `frame`, `webSecurity`, `contextIsolation`, `sandbox`
- Native Dialoge: `dialog.showOpenDialog`, `dialog.showSaveDialog`
- App-Lifecycle: `app.on('ready')`, `app.on('window-all-closed')`, `app.on('activate')`

### IPC-Protokoll
```typescript
// Nur über useElectron() Hook — niemals window.electronAPI direkt
const electron = useElectron();
if (electron.isElectron) {
  const result = await electron.invoke('file:save-project', projectData);
}
```

Registrierte IPC-Channels (aus INDEX.js):
- `file:save-project` / `file:open-project` / `file:export-wav`
- `collab:start-session` / `collab:join-session` / `collab:leave-session`
- `midi:export` / `dialog:open` / `dialog:save`
- `transport:play` / `transport:stop` / `transport:bpm`

Neue Channels: immer in INDEX.js `ipc.channels` eintragen.

### Audio Engine
```
client/src/audio/
├── AudioEngine.ts        # Web Audio API Wrapper — FX-Chains, Scheduling
├── SynthEngine.ts        # Oscillators, ADSR, Wavetable, FM
├── SpectrumAnalyzer.ts   # Echtzeit-FFT für visuelles Metering
└── workers/
    └── audioAnalysis.worker.ts  # Off-Thread BPM-Erkennung
```

Audio-Konzepte, die bekannt sein müssen:
- `AudioContext` Lifecycle (User-Gesture erforderlich für Start)
- `AudioWorklet` vs `ScriptProcessor` (letzteres deprecated)
- `AnalyserNode` für FFT / Spectrum
- Tone.js 15: `Transport`, `Synth`, `Player`, `Sequence`
- Per-Channel FX-Chains: 12 Insert-Typen (eq16, compressor, sidechain, transient, filter, distortion, bitcrusher, ringmod, chorus, flanger, delay, reverb)

### Kollaborationsserver
- `electron/collab-server.ts`: WebSocket LAN-Server im Main-Process
- `electron/collab-discovery.ts`: mDNS Session-Discovery im Netzwerk
- Protokoll-Events: `step:toggle`, `bpm:change`, `pattern:switch`, `transport:play/stop`, `snapshot:full`

### Export
- `electron/export.ts`: WAV + MIDI Export (Hauptlogik)
- `electron/export-stereo.ts`: Stereo-Mix Export
- `electron/wav-writer.ts`: Raw WAV-Writer (PCM Float32)
- MIDI: `client/src/utils/smfParser.ts` zum Parsen
- ZIP-Import: `electron/zip-import.ts` + `client/src/utils/zipSampleImport.ts`

---

## Arbeitsweise

### Neuen IPC-Channel hinzufügen

```
1. electron/preload-additions.ts: contextBridge.exposeInMainWorld() erweitern
2. electron/main.ts: ipcMain.handle('<channel>', async (event, args) => {...}) registrieren
3. client/src/hooks/useElectron.ts: neuen Channel mit Browser-Fallback wrappen
4. INDEX.js: idx.ipc.channels[] Array aktualisieren
5. Security-Agent: Audit des neuen Channels anfragen
6. pnpm check + Test schreiben
```

### Audio-Feature implementieren

```
1. INDEX.js lesen — AudioEngine.ts / SynthEngine.ts Ownership prüfen
2. AudioEngine.ts als Einstiegspunkt — nie direkt Web Audio Nodes in Komponenten
3. Tone.js für Scheduling (nie rohe setTimeout/setInterval für Audio)
4. Off-Thread für intensive Operationen: audioAnalysis.worker.ts als Vorlage
5. Testing: Audio-Tests im Browser (Vitest unterstützt Web Audio via jsdom eingeschränkt)
6. Browser-Fallback prüfen: funktioniert das Feature im reinen Browser ohne Electron?
```

### Electron-Bug fixen

```
1. Reproduzieren: pnpm dev:electron
2. DevTools öffnen: Ctrl+Shift+I (oder über Menü)
3. Unterscheiden: Main-Process-Fehler (electron/main.ts) vs Renderer-Fehler (client/)
4. Main-Process: console.log erscheint in Terminal, nicht in DevTools
5. Fix, pnpm check, idx.update()
```

---

## Bekannte Bugs (Backend-relevant)

Aus `idx.bugs` (Stand bei Erstellung dieser Datei):

- **BUG-003**: Double titlebar Windows — `frame: false` prüfen in `electron/main.ts` BrowserWindow-Konfiguration
- **BUG-004**: KI-Generator hängt — wahrscheinlich fehlender API-Key oder kein Network-Zugriff; Fehlerbehandlung fehlt im Generator-Code

---

## Isomorphes Design — Pflicht

Jedes Electron-Feature MUSS einen Browser-Fallback haben:

```typescript
// client/src/hooks/useElectron.ts
export function useElectron() {
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
  return {
    isElectron,
    saveProject: isElectron
      ? (data) => window.electronAPI.invoke('file:save-project', data)
      : (data) => { localStorage.setItem('project', JSON.stringify(data)); }, // Browser-Fallback
  };
}
```

Der Web-App-Modus muss **vollständig funktionsfähig** bleiben.

---

## Verantwortliche Dateien

```
electron/
├── main.ts                    # Window-Lifecycle, Menüs, Shortcuts
├── preload.ts                 # IPC-Bridge Setup
├── preload-additions.ts       # Alle exposedIn-Main-World Channels
├── collab-server.ts           # WebSocket LAN-Server
├── collab-discovery.ts        # mDNS Discovery
├── export.ts                  # WAV + MIDI Export
├── export-stereo.ts           # Stereo-Mix Export
├── wav-writer.ts              # Raw PCM Writer
└── zip-import.ts              # ZIP Sample Import

client/src/
├── audio/
│   ├── AudioEngine.ts
│   ├── SynthEngine.ts
│   ├── SpectrumAnalyzer.ts
│   └── workers/audioAnalysis.worker.ts
└── hooks/
    └── useElectron.ts         # IPC + Browser-Fallbacks
```

---

## Qualitätscheckliste (vor jedem Commit)

- [ ] Kein direkter `window.electronAPI` Zugriff in Komponenten
- [ ] Alle neuen IPC-Channels haben Browser-Fallbacks in `useElectron.ts`
- [ ] Neue IPC-Channels in `INDEX.js → ipc.channels` eingetragen
- [ ] Security-Agent bei neuen IPC-Channels informiert
- [ ] `pnpm check` fehlerfrei
- [ ] `pnpm dev` (Web) startet ohne Fehler (Fallbacks funktionieren)
- [ ] `pnpm dev:electron` startet ohne Fehler

---

## Session-Ende Beispiel

```js
idx.update({
  agent:   "backend",
  done:    [
    "Fixed BUG-003: Set frame:false in BrowserWindow, removed native titlebar",
    "Added IPC channel 'export:flac' with browser fallback (download blob)"
  ],
  next:    [
    "BUG-004: KI-Generator needs proper API error handling — backend task",
    "collab-server.ts: add reconnection logic for dropped WebSocket sessions"
  ],
  changed: [
    "electron/main.ts",
    "electron/preload-additions.ts",
    "client/src/hooks/useElectron.ts"
  ]
});
```
