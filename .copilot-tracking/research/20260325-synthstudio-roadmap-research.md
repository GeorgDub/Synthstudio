<!-- markdownlint-disable-file -->

# Research: Synthstudio Roadmap – Differenzierende Features & Tests

**Datum:** 20260325  
**Projekt:** Synthstudio v1.7.5  
**Ziel:** Neue Features identifizieren, die Synthstudio von der Konkurrenz abheben, und vollständige Test-Abdeckung planen.

---

## 1. Aktueller Feature-Stand (verifiziert)

### 1.1 Audio-Engine (client/src/audio/AudioEngine.ts)
- Look-ahead Scheduling mit 16ms Intervall / 100ms Look-ahead
- Step-Auflösungen: 1/8, 1/16, 1/32 pro Pattern und pro Channel
- Per-Channel Effektkette: Filter (LP/HP/BP/Notch) → Distortion → Compressor → Delay → Reverb → EQ (3-Band)
- Velocity (0–127), Pan (-1..+1), Pitch (Halbtöne) pro Step
- Metronom (Click-Track)
- Pattern-BPM-Override (Pattern kann eigenes BPM haben)

### 1.2 Drum Machine Store (client/src/store/useDrumMachineStore.ts)
- 9 Channels (Kick, Snare, H-Hat cl./op., Clap, Tom Hi/Lo, Perc, FX)
- 16/32-Step Patterns, 4 Banks (A–D)
- Velocity-Modus, Pitch-Modus
- Pattern-Operationen: clear, fill, randomize, shift (left/right)
- FX-Panel pro Channel
- Undo/Redo (50 Schritte)

### 1.3 Transport (client/src/hooks/useTransport.ts)
- Sync mit AudioEngine (BPM, Play/Stop)
- Metronom-State
- Position-Callback für Step-Highlighting

### 1.4 Sample Management
- Auto-Tagging (Dateiname + Frequenzinhalt): useBpmDetection.ts
- BPM-Detection mit Genre-Tags
- Worker-Pool (max. 4) für parallele Analyse: useAudioAnalysis.ts
- IndexedDB-Cache: client/src/utils/waveformCache.ts
- ZIP-Import: electron/zip-import.ts

### 1.5 Song Mode & Motion Sequencing
- Song-Datenstruktur: client/src/store/useSongStore.ts
- Motion Recording (Parameter-Automation): useDrumMachineStore.ts
- Song-Playback-Engine

### 1.6 MIDI
- Web MIDI API: client/src/hooks/useMidi.ts
- MIDI-Clock Sync (Master/Slave), MIDI-Learn
- Latenz-Kompensation ±50ms, Jitter-Filtering

### 1.7 AI & Community Features (tRPC-basiert)
- AI Pattern Generator (LLM-basiert, Prompt → Beat)
- Cloud Pattern Save/Load/Share
- Community Browser (Like, Kommentare, Remix/Fork)
- Genre Templates (10+ Genres)

### 1.8 Mix Analytics
- Echtzeit-Spektrum-Analyzer
- Waveform-Visualisierung
- Pattern-Dichte-Heatmap
- Groove-Analyse (Swing, Synkopation)

### 1.9 Smart Humanizer
- Pattern-Variation (Velocity-Jitter, Timing-Jitter)
- Fill-Generator, Buildup-Generator
- Pattern-Reverse, Pattern-Shift
- AI Chord Progression Vorschläge

### 1.10 Export
- WAV Mono/Stereo: electron/export.ts / electron/export-stereo.ts
- Multi-Track Stems: todo.md ✅
- MIDI-Export

### 1.11 Bestehende Tests (tests/electron/)
- dragdrop.test.ts – Kategorisierungs-Logik
- store.test.ts – AppStore (CRUD, recentProjects, WindowBounds)
- export.test.ts – Export-Logik
- waveform.test.ts – Waveform-Cache / Worker

---

## 2. Konkurenz-Analyse

| Produkt | Stärken | Schwächen |
|---|---|---|
| Splice Beatmaker | Cloud-Library, Sample-Suche | Keine echte Synthese, West-DAW |
| AKAI MPC Software | Professionell, VST-Host | Teuer, komplex, kein Browser |
| Ableton Live | Industry Standard, Live-Performance | Teuer, kein Browser |
| Groovepad (iOS) | Einfach, Loop-basiert | Kein Sequencer, limitiert |
| Hydrogen | Open-Source, Drum Machine | Kein AI, kein Browser, veraltet |
| BeatMaker 3 (iOS) | Mächtig, Mobile | Nur iOS, kein Web |

**Alleinstellungsmerkmal Synthstudio (bereits vorhanden):**
- Isomorphe Architektur (Browser + Desktop)
- AI Pattern Generator
- Community-Integration im Tool selbst

---

## 3. Fehlende Differenzierungs-Features (Marktlücken)

### 3.1 Step Probability & Conditional Triggers (Elektron-Stil)
**Warum:** Fehlt in ALLEN Web-Sequencern. Elektron-Hardware (Syntakt, Digitakt) haben dies,
  aber nur als Hardware. Im Browser wäre das einzigartig.
**Beschreibung:**
- Wahrscheinlichkeit pro Step (0–100%), ob Step ausgelöst wird
- Conditional Triggers: "1:2" (jeder 2.), "2:2" (jeder 2. genau beim 2. Pass), "Fill" (nur bei Fill), "!Fill" (nie bei Fill), "A:B" (A-mal bei B Durchläufen)
- Zufalls-Muster für lebendige Grooves
**Technische Umsetzung:**
- StepData erweitern: `probability?: number` (0–100), `condition?: StepCondition`
- AudioEngine: Zufallszahl vor Trigger prüfen, Pattern-Counter für Conditionals
- UI: Rechtsklick-Kontextmenü oder spezieller Modus pro Step

### 3.2 Euclidean Rhythm Generator
**Warum:** Mathematisch generierte polyrhythmische Pattern – sehr beliebt in experimenteller Elektronik.
  Kein Web-Sequencer bietet das nativ.
**Beschreibung:**
- Bjorklund-Algorithmus: n Pulse über k Steps gleichmäßig verteilen
- Pro Channel: "Hits" und "Steps" einstellen
- Rotation (Offset des Musters)
- Realisiert in wenigen Rechenoperationen
**Technische Umsetzung:**
- `euclidean(hits: number, steps: number, rotation: number): boolean[]`
- Utility-Funktion in client/src/utils/
- Integration in DrumMachine-Store als `setPartEuclidean()`
- UI: Kompakter Mini-Knob (Hits/Steps/Rotation) pro Channel

### 3.3 Wavetable / FM Synthesizer Engine
**Warum:** Synthstudio ist aktuell rein Sample-basiert. Ein integrierter Synth würde die Zielgruppe
  massiv erweitern und ist der meistgewünschte Fehlende Feature bei Beat-Makern.
**Beschreibung:**
- Wavetable-Synth mit mind. 4 Standard-Wavetables (Sine, Saw, Square, Custom)
- FM-Synthese (2-Operator Minimum): Carrier + Modulator
- ADSR-Hüllkurve, LFO
- Kann als Channel-Source (neben Sample) genutzt werden
**Technische Umsetzung:**
- Neues AudioEngine-Modul: SynthEngine.ts
- PartData.sourceType: "sample" | "wavetable" | "fm"
- Separate SynthParams-Sektion im PartData

### 3.4 Sample Slicer & Loop Manager
**Warum:** Sample-Slicer ist Standard in MPC, Maschine etc. aber fehlt komplett in Web-Tools.
**Beschreibung:**
- Waveform anzeigen, Transient-Detection, Slice-Punkte setzen
- Slices auf Steps mappen (automatisch oder manuell)
- Loop-Regionen definieren (Loop-Start, Loop-End, Loop-Mode: One-Shot/Loop/PingPong)
- Reverse-Playback pro Slice
**Technische Umsetzung:**
- Erweitert waveform.ts (Electron) + waveformCache.ts (Browser)
- Neuer SampleSlicer-Store
- UI: Waveform-Editor-Modal mit Slice-Markers

### 3.5 Modulationsmatrix (Mod-Matrix)
**Warum:** In Hardware-Synths (Elektron, Korg) Standard. Im Browser völlig neu.
**Beschreibung:**
- Visuelle Routing-Tabelle: Quellen × Ziele
- Quellen: LFO, Step-Sequencer, MIDI CC, Envelope, Random
- Ziele: Alle Channel-FX-Parameter, Pitch, Volume, Pan
- Freie Zuordnung mit Stärke-Wert
**Technische Umsetzung:**
- ModMatrix-State in DrumMachineStore
- AudioEngine: ModMatrix im Scheduling-Loop abarbeiten
- UI: Grid-Tabelle mit Slider-Zellen

### 3.6 Collaborative Live Session (WebRTC / WebSockets)
**Warum:** Komplett einzigartig in diesem Markt. Kein Konkurrent bietet echte Echtzeit-Kollaboration.
**Beschreibung:**
- Session erstellen / beitreten mit Code
- Synchronisierter Pattern-State über alle Teilnehmer
- Cursor-Tracking (wer bearbeitet was)
- Push-to-Play: Host startet/stoppt Transport für alle
**Technische Umsetzung:**
- WebSocket-Server Endpoint (tRPC WebSocket oder Socket.io)
- CRDT-basierte State-Synchronisation (optimale Konfliktauflösung)
- useCollaborativeSession() Hook
- Session-Status in Transport-Bar anzeigen

### 3.7 Performance Mode / Live View
**Warum:** DJ/Live-Performer brauchen einen anderen View als Studio-Produzenten.
**Beschreibung:**
- Vereinfachter Vollbild-View: nur Pattern-Buttons + Transport
- Pattern-Launch-Pad (16 Pattern-Slots, Farb-codiert)
- Quantized Pattern-Launching (wechselt am Ende des aktuellen Patterns)
- "Scenes" (mehrere Track-States gleichzeitig speichern/auslösen)
**Technische Umsetzung:**
- PerformanceMode-State in App.tsx
- PatternLaunchPad-Komponente
- Quantized-Switching-Logik in AudioEngine/Transport

### 3.8 AI Mix Assistant
**Warum:** Analytics sind schon vorhanden (Spektrum, Heatmap). Der nächste Schritt wäre AI-basierte
  Empfehlungen – konkrete Handlungsvorschläge, nicht nur Visualisierung.
**Beschreibung:**
- Analysiert aktives Pattern + Effekt-Einstellungen
- Gibt konkrete Empfehlungen: "Kick braucht mehr Low-Shelf EQ bei 80Hz", "Drums sind zu dicht"
- A/B-Vergleich (Original vs. AI-Vorschlag)
- Integration mit bestehendem LLM-Backend (tRPC)
**Technische Umsetzung:**
- Erweiterung bestehenden AI-Pattern-Generator tRPC-Endpunktes
- Neuer tRPC-Endpunkt: mixAssistant.analyze()
- Anzeige als Context-Panel neben dem FX-Panel

---

## 4. Test-Strategie

### 4.1 Test-Framework und -Konfiguration
- **Unit Tests:** Vitest (vitest.config.ts), Node-Environment
- **E2E Tests:** Playwright (playwright.config.ts), Electron + Browser
- **Test-Location:** tests/electron/*.test.ts (Unit), tests/electron/e2e/*.spec.ts (E2E)
- **Pattern-Beispiele:** tests/electron/dragdrop.test.ts, store.test.ts

### 4.2 Neue Test-Dateien geplant

#### Feature-Tests (Unit):
- `tests/electron/euclidean.test.ts` – Bjorklund-Algorithmus, Edge Cases (0 Hits, Hits=Steps)
- `tests/electron/step-probability.test.ts` – Wahrscheinlichkeits-Verteilung, Conditional-Trigs
- `tests/electron/mod-matrix.test.ts` – Routing-Logik, Wert-Berechnung
- `tests/electron/sample-slicer.test.ts` – Transient-Detection, Slice-Mapping
- `tests/electron/performance-mode.test.ts` – Pattern-Launch, quantized Switching
- `tests/electron/ai-mix-assistant.test.ts` – Analyse-Logik, Empfehlungs-Format

#### Store-Tests (Unit):
- `tests/electron/drum-machine-store.test.ts` – toggleStep, Velocity, FX, Undo/Redo, Euclidean
- `tests/electron/song-store.test.ts` – Pattern-Chaining, Song-Loop, Position

#### Audio-Tests (Unit, WebAudio-Mock):
- `tests/electron/audio-engine.test.ts` – BPM-Scheduling, Step-Auflösung, Channel-FX
- `tests/electron/waveform-extended.test.ts` – Slice-Algorithmus, Transient-Detection

#### E2E-Tests (Playwright):
- `tests/electron/e2e/drum-machine.spec.ts` – Vollständiger Drum-Machine-Workflow
- `tests/electron/e2e/sample-import.spec.ts` – Sample-Import, Analyse, Tagging
- `tests/electron/e2e/midi-sync.spec.ts` – MIDI-Clock Workflow
- `tests/electron/e2e/export.spec.ts` – WAV/MIDI/Stems-Export

---

## 5. Verifizierte Konventionen

### 5.1 Architektur-Muster
- Electron-Calls NUR über useElectron()-Hook (Goldenes Gesetz)
- Alle IPC-Handler in electron/main.ts registriert (ipcMain.handle)
- Typen in electron/types.d.ts zentral definiert
- React Stores als Custom Hooks (useState + useCallback)

### 5.2 Naming Conventions
- Hook-Dateien: use*.ts (camelCase)
- Store-Dateien: use*Store.ts
- Komponenten: PascalCase.tsx
- Tests: *.test.ts (Unit), *.spec.ts (E2E)

### 5.3 Test-Konventionen (aus bestehenden Tests)
- describe/it/expect Pattern (Vitest)
- vi.mock() für Node-Module (fs, path)
- beforeEach/afterEach für Cleanup
- Kein Electron-Import in Unit-Tests
- Logik vor dem Test extrahieren (Pure Functions testbar machen)

### 5.4 Abhängigkeiten (aus package.json verifiziert)
- React 19, TypeScript, Vitest, Playwright
- Radix UI (alle UI-Primitives)
- tRPC v11 + React Query v5
- Drizzle ORM + MySQL2
- Framer Motion, Lucide React
- AWS S3 SDK (für Cloud-Features)
