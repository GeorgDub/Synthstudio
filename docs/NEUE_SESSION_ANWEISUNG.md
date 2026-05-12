# Synthstudio – Anweisungsdatei für neue Claude-Session

## Projekt-Übersicht

**Synthstudio** ist eine professionelle Drum Machine / Synthesizer / DAW als isomorphe App
(React 19 + TypeScript + Electron 40 + Vite 7 + Tailwind v4 + pnpm).

- **Dev-Server starten**: `pnpm dev` → http://localhost:5173
- **TypeScript-Check**: `pnpm check`
- **Package Manager**: NUR `pnpm` verwenden

## Wichtigste Dateien

| Datei | Zweck |
|-------|-------|
| `client/src/App.tsx` | Haupt-App, alle Stores, Transport, Tastatur-Events |
| `client/src/audio/AudioEngine.ts` | Web Audio API Engine (Singleton) |
| `client/src/index.css` | Tailwind v4 + CSS-Variablen-System (`--ss-*`) |
| `docs/HANDBUCH.md` | Vollständiges Funktionshandbuch (30+ Kapitel) |

## CSS Design-Token System

**KRITISCH**: Alle Farben müssen semantic sein — KEINE hardcodierten Tailwind-Farben!

```css
/* @theme in index.css mappt --ss-* auf Tailwind-Utilities */
bg-bg-base        → var(--ss-bg-base)
bg-bg-panel       → var(--ss-bg-panel)
bg-bg-elevated    → var(--ss-bg-elevated)
text-text-primary → var(--ss-text-primary)
text-text-muted   → var(--ss-text-muted)
text-text-dim     → var(--ss-text-dim)
border-border-color → var(--ss-border)
bg-accent-primary   → var(--ss-accent-primary)
bg-accent-secondary → var(--ss-accent-secondary)
bg-accent-success   → var(--ss-accent-success)
bg-accent-danger    → var(--ss-accent-danger)
```

**FALSCH**: `bg-gray-900`, `text-cyan-400`, `bg-slate-800`  
**RICHTIG**: `bg-bg-panel`, `text-accent-secondary`, `bg-bg-elevated`

## Goldenes Gesetz (Electron)

```ts
const electron = useElectron(); // IMMER diesen Hook verwenden
if (electron.isElectron) { /* native path */ }
// Kein direktes window.electronAPI in Komponenten!
```

## State Management Pattern

**Modul-Singleton-Stores** (KEIN Zustand-npm-Paket):
```ts
let _state = loadState();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach(l => l()); }
export function useMyStore(): MyState { /* useEffect + useReducer */ }
```

**React-local-Stores** (für komplexe State-Maschinen):
```ts
export function useDrumMachineStore() { const [state, setState] = useState<...>(...); ... }
```

## Wichtige Store-Dateien

| Store | Zweck |
|-------|-------|
| `useProjectStore.ts` | Projekt-Metadaten, BPM, Samples (jetzt mit echtem Save/Load!) |
| `useDrumMachineStore.ts` | Pattern, Parts, Steps (⚠ viele neue Actions!) |
| `useMixerStore.ts` | Mixer-Channels, Insert-Chains, Sidechain |
| `useApiSettingsStore.ts` | API-Keys, Auto-Save-Toggle, Snapshot-Toggle |
| `usePatternGeneratorStore.ts` | Template + Prompt-Generator (zwei Modi) |
| `useThemeStore.ts` | Custom Themes inkl. Extras (Font, Radius, Glow, CSS) |

## Implementierte Feature-Übersicht (Sprints 1–16)

### DrumMachine Store Actions (alle verfügbar via `dm.*`):
```
toggleStep, setPartSteps, setStepVelocity, setStepPitch, setStepProbability,
setStepCondition, setStepReverse, setStepParamLock, setStepLength, setStepChainNext,
quantizePartSteps, setPartEuclidean, clearPattern, fillPattern, randomizePattern,
shiftPattern, setStepCount, setCurrentStep, setVelocityMode, setPitchMode,
setPartMuted, setPartSoloed, setPartVolume, setPartPan, setPartSampleUrl,
setPartStepResolution, setPartStepLength, setActivePart, movePart, setPartFx,
setFxPanelPartId, setPartSourceType, setPartGranularParams, setPartStretchRatio,
setPartMicroTiming, setPatternBpm, setPatternBpmRatio, setPatternBpmTransitionBars,
setPatternStepResolution, setPatternFollowAction, setPatternFollowAction,
addPattern, addPatternData, removePattern, renamePattern, setActivePattern,
duplicatePattern, startLivePatternEdit, commitLivePatternEdit, cancelLivePatternEdit,
scheduleCommit, toggleStackedPattern, clearStackedPatterns, undo, redo,
getActivePattern, getPlaybackPattern
```

### AudioEngine Public API:
```ts
AudioEngine.init()
AudioEngine.play(fromStep?)
AudioEngine.stop()
AudioEngine.setBpm(bpm)
AudioEngine.setSteps(count)
AudioEngine.setPatternGetter(fn)
AudioEngine.setMelodicGetter(fn)
AudioEngine.onStep(cb)          // returns unsubscribe fn
AudioEngine.onPosition(cb)      // returns unsubscribe fn
AudioEngine.setGlobalTranspose(semitones)
AudioEngine.setChannelVolume(partId, vol)
AudioEngine.setChannelPan(partId, pan)
AudioEngine.setChannelSend(partId, bus, level)
AudioEngine.updateChannelFx(partId, fx)
AudioEngine.setSidechainSettings(targetPartId, settings)
AudioEngine.setBusCompressor(settings)
AudioEngine.applyInsertChain(partId, chain)
AudioEngine.startGranular(partId, sampleUrl, params)
AudioEngine.stopGranular(partId)
AudioEngine.setMidiOutCallback(cb)
AudioEngine.setMidiClockCallback(cb)
AudioEngine.setFollowActionCallback(cb)
AudioEngine.smoothBpmTransition(targetBpm, bars, stepCount?)
AudioEngine.applyParamLock(partId, lock, duration)
AudioEngine.getOutputAnalyser()
AudioEngine.getAudioContext()
```

## Resizable Panels System

```ts
// Hook
import { useResizablePanel } from "@/hooks/useResizablePanel";
const { height, handleMouseDown } = useResizablePanel({
  defaultHeight: 220,
  minHeight: 140,
  maxHeight: 500,
  storageKey: "ss-my-panel-height",
  direction: "up", // Panel wächst nach oben
});

// Komponente
import { ResizablePanelHandle } from "@/components/UI/ResizablePanelHandle";
<ResizablePanelHandle onMouseDown={handleMouseDown} direction="up" />

// DrumMachine-spezifischer Wrapper
<ResizableDrumPanel storageKey="ss-panel-xxx" defaultHeight={160} minHeight={100} maxHeight={300}>
  <MeinPanel />
</ResizableDrumPanel>
```

## Offene Roadmap (nächste Phasen)

Siehe `docs/HANDBUCH.md` Kapitel 21–33 für implementierte Features.

**Nächste Prioritäten (Sprint 17+):**
1. **Multi-Sample Mode** — Keyboard-Mapping mit Velocity-Zonen (UI vorhanden: `KeyboardSamplerPanel`, Store: `useKeyboardSamplerStore`)
2. **Envelope Follower** — Audio-Level als Modulations-Quelle
3. **MIDI SysEx** — System-Exclusive Nachrichten
4. **Cloud Pattern Library** — Backend-Sync (lokale Version vorhanden: `usePatternLibraryStore`)
5. **Public Relay Server** — WAN-Kollaboration (LAN vorhanden, WAN fehlt)
6. **Time-Stretch** (echte DSP-Qualität via AudioWorklet/WSOLA)
7. **ReWire/Ableton Link** — Electron-native Bibliothek

## Pattern Generator — Zwei Modi (wichtig!)

**Modus A: Vorlagen** (`generateAndStore` / `generateAndStoreAI`):
- Genre + BPM + Steps + Komplexität + Dichte + Swing + Instrumente + optionale Beschreibung
- `templateBpm: null` = Genre-Standard, `templateBpm: 140` = Override

**Modus B: KI-Prompt** (`generateFromPromptAI`):
- Freier Text + BPM + Steps + Swing + Instrumente
- Benötigt Anthropic API Key (Settings → KI & API)

## Bekannte Besonderheiten

1. **Zirkulärer Import**: `ThemeSettings.tsx ↔ useThemeStore.ts` — bewusst so, funktioniert mit ES-Module-live-bindings
2. **CollabSplitView Stubs**: Wenn neue Store-Actions hinzugefügt werden, IMMER `noop`-Stubs in `CollabSplitView.tsx` ergänzen!
3. **HMR bei ThemeSettings**: ThemeSettings hat einen zirkulären Export der manchmal Full-Page-Reload auslöst — normal
4. **Vite root = client/**: Imports aus `src/generation/` und `src/utils/` brauchen `../../../../` prefix
5. **pnpm check** muss IMMER fehlerfrei sein vor Commits

## Kollaboration-System

- **LAN**: WebSocket-Server in `electron/collab-server.ts`, mDNS-Discovery in `electron/collab-discovery.ts`
- **Session-Events**: `step:toggle`, `bpm:change`, `pattern:switch`, `transport:play/stop`, `snapshot:full`, `chat`, `role:change`
- **Rollen**: host (alle Rechte), editor (Steps/BPM), viewer (read-only)
- **Session-Scan**: Browser → localStorage (zuletzt verwendet), Electron → mDNS + UDP-Scan

## Wichtige Custom Hooks

```
useTransport       — Audio-Engine ↔ React (BPM, Play/Stop, Pattern-Getter)
useMidi            — Web MIDI API (In + Out + Clock + MPE)
useGlobalKeyBindings — Konfigurierbare Tastatur-Bindings
useLaunchpad       — Novation Launchpad / Push Grid-Controller
useBeatRepeat      — Stutter-Effekt via Timer
useMidiStepInput   — MIDI-Keyboard → Piano-Roll Step-Eingabe
useAudioInput      — Mikrofon/Line-In Recording
useResizablePanel  — Drag-to-Resize für Panels
```

## Datei-Format

- **Projekte**: `.synth` (JSON, serialisiert alle Stores via `projectSerializer.ts`)
- **Samples**: `.wav/.mp3/.ogg/.flac` + `.zip` Sample-Packs
- **MIDI Export**: `.mid` (Standard MIDI Format 1, via `midiExport.ts`)
- **WAV Export**: Stereo + Stems via `OfflineAudioContext` (`wavExporter.ts`)

---

**Dev-Server sollte laufen auf http://localhost:5173**  
**Immer `pnpm check` nach Änderungen ausführen!**
