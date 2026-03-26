---
applyTo: ".copilot-tracking/changes/20260326-synthstudio-v19-roadmap-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: Synthstudio v1.9 – "The Producer's Studio"

## Overview

Synthstudio v1.9 baut auf der vollständig fertiggestellten v1.8-Basis auf und bringt 6 neue
differenzierende Features: Ein vollständiges UI-Theming-System mit 3 Themes, einen Piano Roll
Melodie-Sequencer für die FM/Wavetable-Engine, einen Standard-MIDI-File-Import, ein
Mix-Analytics-Dashboard mit Echtzeit-FFT-Spektrum, algorithmisches Pattern-Morphing und
verbesserte Export-Optionen. Alle Features halten das Goldene Gesetz (isomorphe Architektur)
strikt ein.

## Ziel-Version

- **v1.9.0** (Minor Release – 6 neue Features)
- Branch: `electron-dev`
- GitHub Actions Build: Win/Linux/Mac nach Tag-Push

## Objectives

- 6 neue Features implementieren, die tief in die professionelle Creative-Workflow integriert sind
- Alle neuen Features vollständig typsicher (TypeScript strict) implementieren
- Mindestens 55 neue Unit-Tests (Vitest) und 3 neue E2E-Test-Suiten (Playwright)
- Isomorphie-Gesetz strikt einhalten: kein direkter `window.electronAPI`, nur über `useElectron()`
- Pro Phase sinnvolle Delegation an den besten Spezialisten-Agenten

## Agent-Delegation

| Phase | Feature | Delegierter Agent |
|-------|---------|------------------|
| 1 | UI Theming Engine | Expert React Frontend Engineer |
| 2 | Piano Roll Sequencer | Expert React Frontend Engineer + audio-engine-agent |
| 3 | MIDI File Import | audio-engine-agent (Parser) + ipc-bridge-agent (IPC) |
| 4 | Mix Analytics Dashboard | audio-engine-agent (FFT) + Expert React Frontend Engineer (Viz) |
| 5 | Pattern Morphing Engine | audio-engine-agent (Algorithmus) + Expert React Frontend Engineer (UI) |
| 6 | Advanced Export | backend-agent (Electron) + audio-engine-agent (Encoding) |
| 7 | E2E-Tests | testing-qa-agent |

## Research Summary

### Projekt-Dateien (verifiziert, Stand v1.8.1)
- `client/src/audio/AudioEngine.ts` – Look-ahead Scheduler, Channel-FX, Slice-Playback
- `client/src/audio/SynthEngine.ts` – FM + Wavetable Synthese (2-Op)
- `client/src/store/useDrumMachineStore.ts` – Pattern/Part/Step mit Probability + Conditions
- `client/src/store/useHumanizerStore.ts` – Swing, Velocity-Jitter, Groove-Presets
- `client/src/hooks/useMidi.ts` – MIDI-Geräte, MIDI-Learn, Clock-Sync (Slave)
- `client/src/hooks/useAudioAnalysis.ts` – Worker-Pool, BPM-Detection, Transient-Onset
- `client/src/components/SampleBrowser/SampleBrowser.tsx` – Playlists, Kategorien, Waveform-Preview
- `client/src/components/PerformanceMode/` – Pattern-LaunchPad, Quantized Switch
- `electron/zip-import.ts` – ZIP-Import, Auto-Tagging, BPM-Detection
- `tests/electron/e2e/setup.ts` – E2E-Muster für Playwright-Tests

### Technologie-Stack
- React 19 + TypeScript strict
- Vite 6.x + Vitest 3.x
- Tailwind CSS v4 (CSS Custom Properties bereits integriert)
- Web Audio API (AudioContext, AnalyserNode, OscillatorNode, PeriodicWave)
- tRPC v11 + React Query v5
- Drizzle ORM + MySQL2
- Playwright + `_electron` für E2E

## Implementation Checklist

### [x] Phase 1: UI Theming Engine

> **Delegation:** Expert React Frontend Engineer
> **Grund:** Komplexe CSS-Architektur, Theme-Token-System, React Context

- [x] Task 1.1: Theme-Token-System (CSS Custom Properties in index.css)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 30–90)

- [x] Task 1.2: useThemeStore – Theme-State mit Persistence (localStorage + electronStore)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 91–135)

- [x] Task 1.3: 3 eingebaute Themes: DarkStudio, NeonCircuit, AnalogHardware
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 136–220)

- [x] Task 1.4: ThemeSwitcher-Komponente (Dropdown in Settings oder Toolbar)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 221–260)

- [x] Task 1.5: Tests – theme-store.test.ts (8 Tests)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 261–310)

### [x] Phase 2: Piano Roll / Melodic Step Sequencer

> **Delegation:** Expert React Frontend Engineer (UI) + audio-engine-agent (Audio-Integration)
> **Grund:** Piano-Roll-UI ist hochkomplexe React-Komponente, Audio-Scheduling gehört in AudioEngine

- [x] Task 2.1: MelodicPart-Datenstruktur (PitchStep Interface, Note-Map)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 313–370)

- [x] Task 2.2: useMelodicPartStore – Zustand für Pitch-Steps pro Kanal
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 371–420)

- [x] Task 2.3: AudioEngine – Pitch-aware Scheduling für SynthEngine-Parts
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 421–465)

- [x] Task 2.4: PianoRollModal-Komponente (16 Steps × 24 Noten, 2 Oktaven)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 466–540)

- [x] Task 2.5: Drag-to-draw Noten, Delete per Rechtsklick, Velocity per Shift+Click
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 541–590)

- [x] Task 2.6: Tests – melodic-part.test.ts (10 Tests)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 591–645)

### [x] Phase 3: MIDI File Import (.mid → Drum-Pattern)

> **Delegation:** audio-engine-agent (binary SMF-Parser) + ipc-bridge-agent (Electron IPC)
> **Grund:** Binär-Parsing ist Main-Process-nah, IPC-Bridge hat eigene Zuständigkeit

- [x] Task 3.1: SMF-Parser-Utility (Standard MIDI File Type 0/1, Basics)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 648–720)

- [x] Task 3.2: GM-Drum-Map → Parts-Automap (Note 35–81 → Kategorie)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 721–760)

- [x] Task 3.3: IPC-Handler `midi:importFile` (Electron main.ts)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 761–800)

- [x] Task 3.4: MidiImportDialog-Komponente (Vorschau + Bestätigung)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 801–840)

- [x] Task 3.5: Tests – smf-parser.test.ts (10 Tests)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 841–900)

### [x] Phase 4: Mix Analytics Dashboard

> **Delegation:** audio-engine-agent (FFT Worker) + Expert React Frontend Engineer (Canvas-Viz)
> **Grund:** FFT-Audio ist Performance-kritisch (Worker), Visualisierung ist React-Canvas

- [x] Task 4.1: SpectrumAnalyzerWorker (FFT via OfflineAudioContext, SharedArrayBuffer)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 903–960)

- [x] Task 4.2: PatternDensityMap (Step-Dichte pro Kanal als Heatmap-Data)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 961–1005)

- [x] Task 4.3: FrequencyClashDetector (Überlappende Frequenzbänder für Kick/Bass)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1006–1055)

- [x] Task 4.4: MixAnalyticsPanel-Komponente (Spektrum Canvas + Density Grid + Clash-Warn)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1056–1115)

- [x] Task 4.5: Tests – mix-analytics.test.ts (10 Tests)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1116–1165)

### [x] Phase 5: Pattern Morphing Engine

> **Delegation:** audio-engine-agent (Algorithmus) + Expert React Frontend Engineer (UI)
> **Grund:** Interpolationslogik ist Audio-Domain, UI ist React-Slider-Komponente

- [x] Task 5.1: morphPatterns()-Algorithmus (Step-Weight-Interpolation A→B)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1168–1220)

- [x] Task 5.2: useMorphStore – Morph-State (Source, Target, Amount 0–1)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1221–1260)

- [x] Task 5.3: Probabilistisches Morph-Rendering im AudioEngine-Scheduler
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1261–1300)

- [x] Task 5.4: PatternMorph-UI (Morph-Slider + Preset A/B-Buttons im DrumMachine-Panel)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1301–1340)

- [x] Task 5.5: Tests – pattern-morph.test.ts (9 Tests)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1341–1395)

### [x] Phase 6: Advanced Export

> **Delegation:** backend-agent / ipc-bridge-agent (Electron Export-IPC) + audio-engine-agent (Encoding)
> **Grund:** Datei-Schreiben und Dialogs sind Electron-Main-Process, Audio-Encoding ist Engine-Domain

- [x] Task 6.1: Export-Konfiguration (ExportPreset-Interface: Format, Bitrate, Normalisierung)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1398–1435)

- [x] Task 6.2: WAV+MIDI-Bundle-Export (ZIP: alle Stems + Pattern.mid)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1436–1475)

- [x] Task 6.3: IPC-Handler `export:bundle` + showSaveDialog-Integration
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1476–1515)

- [x] Task 6.4: ExportPresetsPanel-Komponente (Presets: Quick/Studio/Broadcast + Custom)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1516–1560)

- [x] Task 6.5: Tests – export-bundle.test.ts (8 Tests)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1561–1605)

### [x] Phase 7: E2E-Tests

> **Delegation:** testing-qa-agent
> **Grund:** Playwright-E2E-Spezialist

- [x] Task 7.1: theme-switch.spec.ts (Theme wechseln, CSS-Variable prüfen)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1608–1650)

- [x] Task 7.2: piano-roll.spec.ts (Piano Roll öffnen, Note zeichnen, Audio-Trigger prüfen)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1651–1690)

- [x] Task 7.3: midi-import.spec.ts (MIDI-Datei importieren, Pattern-Vorschau prüfen)
  - Details: .copilot-tracking/details/20260326-synthstudio-v19-roadmap-details.md (Zeilen 1691–1730)

## Dependencies

- Tailwind CSS v4 mit CSS Custom Properties (bereits installiert)
- Web Audio API `AnalyserNode` + `Float32Array` für FFT (bereits in AudioEngine)
- `@tonejs/midi` oder nativer SMF-Parser (ggf. neu installieren)
- Vitest 3.x (bereits konfiguriert)
- Playwright (bereits konfiguriert)

## Success Criteria

- `pnpm test` läuft ohne Fehler, alle neuen Test-Dateien grün
- Theme-Wechsel vollzieht sich ohne Reload, CSS-Variablen werden live aktualisiert
- Piano Roll ermöglicht Pitch-Eingabe für SynthEngine-Parts (FM/Wavetable)
- MIDI-File-Import übersetzt GM-Drum-Notes korrekt in Drum-Machine-Parts
- Spektrum-Analyzer zeigt Echtzeit-FFT als Canvas-Visualisierung
- Pattern-Morph interpoliert visuell und auditiv zwischen zwei Patterns (0% = A, 100% = B)
- Bundle-Export erzeugt ZIP mit WAV-Stems + MIDI-File + Metadaten-JSON
- Isomorphie-Gesetz strikt eingehalten
