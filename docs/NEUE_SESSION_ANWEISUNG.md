# Synthstudio – Anweisungsdatei für neue Claude-Session

**Version: 1.24.0** | Stand: 2026-05-13 (Sprints 1–24 abgeschlossen)

---

## Projekt-Übersicht

**Synthstudio** ist eine professionelle Drum Machine / Synthesizer / DAW als isomorphe App
(React 19 + TypeScript + Electron 40 + Vite 7 + Tailwind v4 + pnpm).

```bash
pnpm dev              # Web App → http://localhost:5173
pnpm dev:electron     # Electron App mit Hot Reload
pnpm check            # TypeScript-Check (IMMER ausführen nach Änderungen!)
pnpm test             # Alle Unit-Tests (Vitest)
pnpm test:features    # Nur Feature-Tests in tests/features/
pnpm test:web         # Playwright E2E im Browser
pnpm build            # Web App Build
```

**WICHTIG**: Package Manager = `pnpm`. Niemals `npm` oder `yarn`.

---

## Kritische Regeln

### 1. CSS Design-Token (KEIN hardcoded Tailwind!)
```
FALSCH: bg-gray-900, text-cyan-400, bg-slate-800, bg-blue-500
RICHTIG: bg-bg-panel, text-accent-secondary, bg-bg-elevated, bg-accent-primary
```

Alle Semantic-Classes (via `@theme` in `index.css`):
```
bg-bg-base / bg-bg-panel / bg-bg-elevated
text-text-primary / text-text-muted / text-text-dim
border-border-color / border-border-subtle
bg-accent-primary / bg-accent-secondary / bg-accent-success / bg-accent-danger
text-accent-primary / text-accent-secondary / ...
```

**Verifiziert via `tests/features/theme-class-purity.test.ts`** (TASK-122):
0 hardcoded Tailwind palette classes + 0 arbitrary hex classes im gesamten *.tsx-Baum.

### 2. Goldenes Gesetz (Electron)
```ts
const electron = useElectron(); // IMMER dieser Hook!
if (electron.isElectron) { /* native */ }
// NIEMALS direktes window.electronAPI in Komponenten
```

### 3. CollabSplitView Stubs
Wenn neue `DrumMachineActions` hinzugefügt werden → IMMER `noop`-Stubs in:
`client/src/components/CollabSplitView/CollabSplitView.tsx` ergänzen!

---

## Architektur

### DrumMachine (refactored in v1.16)
```
client/src/components/DrumMachine/
├── DrumMachine.tsx          # Haupt-Komponente
├── ChannelStrip.tsx         # Einzelner Drum-Kanal
├── StepInspector.tsx        # Step-Editor Panel
├── FxPanel.tsx              # FX-Einstellungen
├── ResizableDrumPanel.tsx   # Resize-Wrapper mit X-Button (BUG-008 fix v1.18.1)
├── drumMachineHelpers.ts    # velocityColor, stepGroupBorder
├── EnvelopeFollowerPanel.tsx
├── MixAssistantPanel.tsx
├── GranularSynthPanel.tsx
├── SynthPanel.tsx           # Wavetable/FM Synthese
├── WavetableEditor.tsx      # Canvas Wavetable-Editor
├── PolyrhythmVisualizer.tsx
├── EuclideanControls.tsx
├── ModMatrix.tsx
└── index.ts
```

### State Management
**Modul-Singleton**: `let _state; const _listeners = new Set(); function notify()`
**React-local**: `useState` für komplexe Stores

---

## Vollständige Store-Action-Liste (useDrumMachineStore)

```typescript
// Pattern
addPattern, addPatternData, removePattern, renamePattern, setActivePattern,
duplicatePattern, startLivePatternEdit, commitLivePatternEdit, cancelLivePatternEdit,
scheduleCommit, toggleStackedPattern, clearStackedPatterns,
setPatternBpm, setPatternBpmRatio, setPatternBpmTransitionBars,
setPatternStepResolution, setPatternFollowAction,

// Parts
addPart, removePart, renamePart, setPartSample, setPartMuted, setPartSoloed,
setPartVolume, setPartPan, setPartStepResolution, setPartStepLength, setActivePart,
movePart, setPartFx, setFxPanelPartId, setPartSourceType, setPartGranularParams,
setPartStretchRatio, setPartMicroTiming,

// Steps
toggleStep, setPartSteps, setStepVelocity, setStepPitch, setStepProbability,
setStepCondition, setStepReverse, setStepParamLock, setStepLength, setStepChainNext,
quantizePartSteps, setPartEuclidean,

// Pattern-Operationen
clearPattern, fillPattern, randomizePattern, shiftPattern,
setStepCount, setCurrentStep, setVelocityMode, setPitchMode,

// Undo/Redo
undo, redo, canUndo, canRedo,

// Getter
getActivePattern, getPlaybackPattern
```

---

## AudioEngine Public API

```typescript
// Core
AudioEngine.init()
AudioEngine.play(fromStep?)
AudioEngine.stop()
AudioEngine.setBpm(bpm)
AudioEngine.setSteps(count: 16|32)
AudioEngine.setPatternGetter(fn)
AudioEngine.setMelodicGetter(fn)

// Callbacks (geben unsubscribe-Funktion zurück)
AudioEngine.onStep(cb)         // bei jedem aktiven Step
AudioEngine.onPosition(cb)     // bei jedem Step (auch Stille)

// Channel
AudioEngine.setChannelVolume(partId, vol)
AudioEngine.setChannelPan(partId, pan)
AudioEngine.setChannelSend(partId, "reverb"|"delay", level)
AudioEngine.updateChannelFx(partId, fx)
AudioEngine.setSidechainSettings(targetPartId, settings)
AudioEngine.routeChannelToBus(partId, toBus)

// Bus / FX
AudioEngine.setBusCompressor(settings)
AudioEngine.applyInsertChain(partId, chain[])
AudioEngine.getOutputAnalyser()
AudioEngine.getAudioContext()

// Synthese
AudioEngine.startGranular(partId, sampleUrl, params)
AudioEngine.stopGranular(partId)
AudioEngine.setGlobalTranspose(semitones)

// Macro-LFO Delegates (v1.22.0 / TASK-117)
AudioEngine.setPartLfoRate(partId, rate)      // 0.01..30 Hz
AudioEngine.setPartLfoDepth(partId, depth)    // 0..1
AudioEngine.getPartLfoRate(partId) / .getPartLfoDepth(partId)
// → SynthEngine.triggerNote(.., partId?) wendet Cache-Werte an
// (Hinweis TASK-128 offen: Step-Trigger-Site reicht partId noch NICHT durch)

// Follow Action / Live Edit
AudioEngine.setFollowActionCallback(cb)
AudioEngine.smoothBpmTransition(targetBpm, bars)
AudioEngine.resetBarCount()

// MIDI Out
AudioEngine.setMidiOutCallback(cb)
AudioEngine.setMidiClockCallback(cb)
AudioEngine.setMidiProgramChangeCallback(cb)
AudioEngine.sendPatternProgramChange(index, channel?)

// Granular
AudioEngine.applyParamLock(partId, lock, duration)
AudioEngine.applyInsertChain(partId, chain)
```

---

## Resizable Panels System

```typescript
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { ResizablePanelHandle } from "@/components/UI/ResizablePanelHandle";

const { height, handleMouseDown } = useResizablePanel({
  defaultHeight: 220,
  minHeight: 140,
  maxHeight: 500,
  storageKey: "ss-my-panel",
  direction: "up",
});
```

**ResizableDrumPanel** (fertige Wrapper-Komponente):
```tsx
<ResizableDrumPanel
  storageKey="ss-panel-xxx"
  defaultHeight={160}
  minHeight={100}
  maxHeight={300}
  onClose={() => setShowXxx(false)}
  title="Panel Name"
>
  <MeinInhalt />
</ResizableDrumPanel>
```

---

## Pattern Generator — Zwei Modi

**Modus A: 🎛 Vorlagen** (algorithmisch + optional KI):
```
Store-Actions: setGenre, setComplexity, setCustomPrompt,
               setTemplateBpm, setTemplateStepCount, setTemplateSwing,
               setTemplateDensity, toggleTemplatePart
Generate: generateAndStore() | generateAndStoreAI()
```

**Modus B: ✨ KI-Prompt**:
```
Store-Actions: setPromptText, setPromptBpm, setPromptStepCount,
               setPromptSwing, togglePromptPart
Generate: generateFromPromptAI()
Benötigt: Anthropic API Key (Settings → KI & API)
```

---

## Custom Themes — Extras-System

```typescript
addCustomTheme({ name, colors, extras: {
  fontSize?: number,        // 10–18px Schriftgröße
  borderRadius?: number,    // 0–20px Abrundung
  glowIntensity?: number,   // 0–1 Leucht-Effekt
  glassEffect?: number,     // 0–1 Backdrop-Blur
  customCss?: string,
}})
```

---

## Neue Features v1.17 – v1.22 (Releases im Detail)

### v1.17.0 — Persistent Scripts + Web Worker Sandbox (TASK-103)
- `useScriptStore` (App- + Project-Scripts, max 64, 10kB Code-Limit)
- Web Worker-Sandbox: kein `globalThis`, kein Node-Access, 5s Default-Timeout
- Macro- und Keyboard-Bindings via `findScriptByKeyCombo` / `findScriptByMacroIndex`
- Codegen für Sandbox-Source: `scripts/generate-sandbox-source.mjs` (pre-dev/build hook)

### v1.18.0 – v1.18.3 — Hardening + Theme-Refactor
- **v1.18.0**: CSP-Headers, Sandbox-Codegen, Refactor-Pass
- **v1.18.1**: BUG-008 — doppelte Header in DrumMachine-Floating-Panels behoben
- **v1.18.2**: BUG-002 — BPM +/- Buttons mit visible click feedback
- **v1.18.3**: FOLLOWUP-110 (Teil 1) — Theme-Refactor + Daylight/Paper-Token-Fix

### v1.19.0 — Audio-Tracks (FOLLOWUP-102 Teil 1+2)
- De-Duplikation von `AudioTrackChannelData` (vorher in Store + AudioEngine doppelt)
- Pitch-preserving Stretch via existing `TimeStretchProcessor.js` AudioWorklet
- **Offene Restposten**: Solo cross-store unification + Playwright round-trip E2E (siehe FOLLOWUP-102 in INDEX.js)

### v1.20.0 — Performance Mode UX-Overhaul (TASK-111)
- 16 Pads mit `quantizeMode` und `queuedPatternId`
- Pattern-Switch quantisiert auf Beat/Bar/Pattern

### v1.21.0 — Macro→Pad + Performance a11y + CI-Drift-Check
- **TASK-115**: Macro-Button kann Pads triggern (`macro:button:trigger` Event mit `triggerKind: 'script' | 'pad'`)
- **TASK-114**: Performance-Pad Multi-Select (Shift+Click, `movePad` + `moveMultiplePads` mit Insert-Semantik) + ARIA-Labels
- CI-Drift-Check: GitHub Actions sweep prüft INDEX.js ↔ package.json Version-Sync

### v1.22.0 — LFO-Macros + Hold-Mode + Pad-Theme + Final Polish (6 Tasks)
- **TASK-117** (LFO-Macros): SynthEngine-Macro-LFO-Cache (`Map<partId, {rate?, depth?}>`), `setPartLfoRate/Depth`, `triggerNote(.., partId?)` Override-Pfad. App.tsx Macro-Setter-Bag mit `setLfoRate/setLfoDepth` erweitert.
- **TASK-118** (Hold-Mode): `MacroTriggerMode = 'edge' | 'hold'` voll funktional. Loop-Re-Trigger solange Button gedrückt (Script: 200ms, Pad: 100ms). Pure-Logik-Helper `client/src/utils/macroHoldLoop.ts` mit Inject-Scheduler-Pattern (testbar mit `vi.useFakeTimers`). UI: 🔁-Icon-Overlay im Hold-Mode.
- **TASK-119** (Pad-Theme): `PAD_COLOR_VAR_NAMES` (8 CSS-vars `--ss-pad-1..8`) für theme-aware Default-Pad-Farben.
- **TASK-120** (Mouse-Box Rubber-Band): Im Reorder-Mode mousedown auf Grid-Background → Box-Drag mit fixed-positioniertem Overlay. Pure Helper `normalizeBox`/`boxIntersects`/`collectPadsInBox` exportiert. Shift=additiv, Escape clearet, 24 Unit-Tests + 9 Playwright-Tests.
- **TASK-122** (Final Theme-Class-Purity Sweep): 15 Komponenten refactored, Endstand 0/0 hardcoded Tailwind palette classes + 0 arbitrary hex im *.tsx-Baum. Slider-Prop `color` → `accent` (statische Klassen-Tabellen damit Tailwind JIT die Klassen findet).
- **TASK-123** (Multi-Drag-Canvas): Programmatisch erzeugtes Canvas mit Pad-Color + accent-secondary Border + '+N' Badge via `dataTransfer.setDragImage()` bei Multi-Select-Drag. `data-multi-drag-count` Attribut für deterministische Playwright-Assertion.

### v1.23.0 — Synth-Integration + Performance UX + Test-Hardening + Solo-Unification
- **TASK-128** (LFO-Macros Wave 2): `SynthEngine.triggerNote()` um optionalen `destination?: AudioNode` erweitert; AudioEngine `_triggerMelodicNote` routet `wavetable`/`fm`-Parts jetzt durch SynthEngine mit partId — der v1.22.0 Macro-LFO-Cache wird endlich konsultiert.
- **TASK-129** (Synth-Part Wave 2): Neuer `_triggerSynthOnChannel`-Helper bündelt Trigger + Channel-FX-Routing. DrumLoop-Branch für `sourceType=wavetable|fm` ergänzt (vorher: skip). SynthEngine-Output geht jetzt durch die Channel-FX-Chain (EQ, Filter, Distortion, Compressor, Sidechain, Sends) statt direkt zu masterGain. Insert-FX wirken auch auf Synth-Parts.
- **TASK-127** (Performance-Pad UX): Cmd/Ctrl+A im Reorder-Mode = Select All non-empty Pads. Box-Drag Auto-Scroll via RAF wenn Maus < 40px vom Viewport-Rand. Neue Pure Helper `collectNonEmptyPadIndices` + `computeAutoScrollDelta`.
- **TASK-125** (Theme-Purity Glob-Hardening): `tests/features/theme-class-purity.test.ts` von 19 harten Pfaden auf `walkSync` (node:fs builtin) umgestellt. Test-Count 41 → 131. Neue *.tsx wird automatisch geprüft.
- **TASK-126** (Macro-Hold-Mode E2E): Neue `tests/web/macros.spec.ts` mit 4 Tests für UI-Wiring `mouseDown → CustomEvent → App.tsx`. data-testids auf `MacroButton` + `toggle-macro-panel`.
- **FOLLOWUP-102-3** (Solo Cross-Store UI-Unification): `setPartSoloed` um `exclusive`-Parameter erweitert (default true = Radio, false = additive). Neue `setAudioTrackSoloed(id, soloed, exclusive=false)`. Shift+Click invertiert Default in beiden UIs (Drum: shift=additive, Audio: shift=exclusive).
- **FOLLOWUP-102-4** (Round-Trip E2E): Neue `tests/web/audio-track-round-trip.spec.ts` mit 4 Tests (Phase 1 save → Phase 2 reopen → Phase 3 relocate + ID-Stabilität).
- Test-Count: 1345 unit + 8 neue Playwright. INDEX.js openTasks: LEER.

### v1.24.0 — Multi-Window-Architektur + 7 kritische Bug-Fixes (post-v1.23.0 Stabilisierung)
- **Performance Mode in eigenem Fenster — Phase 1 + 2**: Separates Electron `BrowserWindow` mit `?perfPopup=1` URL-Param. Bidirektionaler State-Sync via 8 IPC-Channels (`window:open/close/is-performance-open`, `window:perf-set/is-always-on-top`, `perf-sync:state`, `perf-sync:action`, `perf-window:closed`). PatternLaunchPad mit injectable `PerformanceStoreActions` — Edit + Reorder + Pad-CRUD vollständig synced über beide Fenster. Always-on-Top Toggle 📌.
- **Settings → Über**: neuer Update-Check-Button mit Live-Status-Anzeige (idle/checking/up-to-date/available/downloading/ready/error), Progress-Bar. Nutzt existierende `useUpdater`-Infra.
- **BUG-009** (high): Performance Mode Mode-Buttons im Fullscreen unklickbar. Fix: `ElectronTitleBar` versteckt sich in Fullscreen + Performance-Mode-Wrapper bekommt defensiv `WebkitAppRegion: no-drag`.
- **BUG-010** (critical): Script-Runner CSP-Error "unsafe-eval". Fix: User-Code wird vor Worker-Bau in die Source eingebettet (statt `new Function`). CSP bleibt strikt.
- **BUG-011** (high): Audio-Workbench Waveform unsichtbar. Fix: Canvas 2D unterstützt keine CSS-Variablen → `getComputedStyle().getPropertyValue()` für Token-Auflösung.
- **BUG-012** (high): Sample-Browser BPM-Detection. Fix: BPM in-band im Worker beim `analyze`-Call mit-berechnet (Renderer + Electron), vermeidet zweiten decodeAudioData-Trip.
- **BUG-013** (high): "Neues Projekt" resettet nicht. Fix: neuer `doFullProjectReset`-Helper, 5 neue Public-Reset-APIs (`resetMixer`, `resetAutomation`, `resetPerformance`, `resetMelodicParts`, `resetNoteRepeat`), koordinierter Reset über 13 Stores.
- **BUG-014** (medium): Pattern-Generator BPM-Input springt auf 40 beim Clearen. Fix: lokaler String-Draft-State während des Tippens, Commit + Clamp erst on-Blur/Enter (sowohl Vorlagen- als auch Prompt-Tab).
- **BUG-015** (medium): ElectronTitleBar-Titel überlappt. Fix: linke Seite zeigt nur "Synthstudio" (App-Name), Projektname bleibt zentriert in der Mitte.

---

## Implementierte Features (Überblick)

| Kategorie | Features |
|-----------|---------|
| **Sequencer** | 16/32-Step Grid, Velocity/Pitch/Probability/Condition/Reverse pro Step |
| **Step Inspector** | Param Lock, Note Length, Probability Chain, Quantize-Grid |
| **Performance** | Live Pattern Edit (Draft+Commit), Follow Actions, BPM-Sync zwischen Patterns |
| **Pattern Tools** | A/B/C/D Variations, Pattern Stacking, Polyrhythm, Morph |
| **Performance Mode** | 16 Pads, Quantized Pattern-Switch, Multi-Select Reorder, Box-Drag (v1.20–v1.22) |
| **Synthese** | Wavetable/FM + ADSR, Granular, Custom Wavetable Editor |
| **LFO** | 6 Wellenformen, BPM-Sync, S&H, Glide/Portamento, Macro-Routing (v1.22) |
| **Mixer** | Insert FX Chain (12 Typen), 16-Band EQ, Sidechain, Bus Compressor, Spectrum |
| **Effekte** | Bitcrusher, Ring Modulator, Chorus, Flanger, alle klassischen |
| **Song** | Arrangement Timeline, Automation Lanes, Scene Launch |
| **MIDI** | In (CC-Zuweisungen 30+, Note-Map, Chord Memory, MPE) + Out + Clock |
| **Kollaboration** | LAN-Session, Chat, Roles, Session Recording, Cross-Sample Transfer |
| **KI** | AI Beat Co-Pilot (Claude API), Pattern Generator (Template + Prompt) |
| **Export** | WAV (Master/Stems), MIDI-Bundle (.mid Format 1) |
| **Barrierefreiheit** | 10+ Themes (inkl. 2 Colorblind), ARIA-Labels, Touch-Optimierung |
| **PWA** | Service Worker, Manifest, Offline-Fähigkeit |
| **Plugins** | ESM Plugin API, Script Runner (Sandbox seit v1.17) |
| **Macros** | 8 Knöpfe (Knob+Button-Mode), Edge+Hold-Trigger, Script+Pad-Routing (v1.21–v1.22) |
| **Envelope Follower** | Audio-Level → Modulations-Quelle |
| **Audio-Tracks** | Vocals/Songs als Kanäle (v1.16), pitch-preserving Stretch (v1.19) |

---

## Wichtige Konventionen

### Neue DrumMachine Actions → CollabSplitView-Stub!
```typescript
// In CollabSplitView.tsx — immer ergänzen:
meinNeueAction: noop,
```

### Inline-Styles vs Tailwind
- Inline-Styles: OK für dynamische Werte (z.B. `style={{ background: color }}`)
- Tailwind: für statische Klassen (semantic Colors verwenden!)
- CSS-Variablen direkt: `style={{ color: "var(--ss-accent-primary)" }}`

### Categorical Palettes (Sonderfall)
Wenn mehrere kategorische Farben gleichzeitig nötig sind (z.B. Pattern-Banks A/B/C/D, Drop-Zone-Types), Top-Comment-Block in der Datei dokumentieren und auf `accent-primary/secondary/success/danger` mappen (Beispiele: `SongTimeline.tsx`, `ElectronDropZone.tsx`, `MixAssistantPanel.tsx`). Bei Bedarf später `--ss-accent-tertiary` / `--ss-accent-warning` Tokens einführen.

### Import-Pfade
```typescript
// Aus client/src: @/ alias
import { AudioEngine } from "@/audio/AudioEngine";

// Aus src/ (außerhalb client/): relativer Pfad
import { parseMidiFile } from "../../../../src/utils/midiParser.js";
```

---

## Offene Roadmap (v1.23.0+)

Quelle: `agents/INDEX.js` → `openTasks`

| Priorität | Task | Owner | Beschreibung |
|-----------|------|-------|--------------|
| ❗ Hoch | **TASK-128** | backend + testing-Review | LFO-Macros Wave 2: AudioEngine Step-Trigger reicht `partId` noch nicht durch — Macro-LFO-Cache läuft ins Leere |
| 🔶 Mittel | **TASK-127** | frontend | Performance-Pad UX: Cmd/Ctrl+A + Auto-Scroll bei Box-Drag (aus TASK-114/120 next[]) |
| 🔷 Niedrig | **TASK-125** | testing | theme-class-purity Glob-Hardening (statt 19 harter Pfade glob-basierter Mass-Check) |
| 🔷 Niedrig | **TASK-126** | testing | Macro-Hold-Mode Playwright-Smoke (App.tsx-Wiring fehlt im E2E) |
| 🔷 Niedrig | **FOLLOWUP-102** | testing + audio | Solo cross-store unification (drum+audio) + Playwright round-trip E2E |

---

**Dev-Server**: http://localhost:5173  
**Letzter Test-Run**: `pnpm test` → 1347 passed / 15 skipped (pre-existing) / 64 Files / ~3.0s + `pnpm test:web` 8 Playwright-Tests grün  
**Version**: 1.24.0
