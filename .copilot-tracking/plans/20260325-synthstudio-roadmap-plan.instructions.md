---
applyTo: ".copilot-tracking/changes/20260325-synthstudio-roadmap-changes.md"
---

<!-- markdownlint-disable-file -->

# Task Checklist: Synthstudio Roadmap – Differenzierende Features & Tests

## Overview

Implementierung von 8 differenzierenden Features und vollständiger Test-Abdeckung, die Synthstudio klar von der Konkurrenz (Splice Beatmaker, AKAI MPC, Ableton Live) abheben und einzigartig im Web-Sequencer-Markt positionieren.

## Objectives

- 8 neue Features implementieren, die in keinem Web-Sequencer vorhanden sind
- Mind. 60 neue Unit-Tests (Vitest) und 4 E2E-Test-Suiten (Playwright) schreiben
- Isomorphe Architektur beibehalten (alle Electron-Calls nur über useElectron-Hook)
- Test-Coverage für alle neuen Features von Tag 1 an gewährleisten

## Research Summary

### Projekt-Dateien (verifiziert)
- client/src/audio/AudioEngine.ts – Look-ahead Audio-Scheduler, Channel-FX-Kette
- client/src/store/useDrumMachineStore.ts – Pattern/Part/Step-Datenstruktur
- client/src/hooks/useTransport.ts – Play/Stop/BPM-Sync zwischen AudioEngine und React
- client/src/hooks/useAudioAnalysis.ts – Worker-Pool für Audio-Analyse
- client/src/hooks/useBpmDetection.ts – BPM-Detection mit Genre-Tags
- tests/electron/dragdrop.test.ts – Vorlage für Unit-Test-Konventionen
- tests/electron/store.test.ts – Vorlage für Store-Tests
- vitest.config.ts – Test-Konfiguration (Node-Environment, include-Pfade)

### External References
- #file:../research/20260325-synthstudio-roadmap-research.md – Vollständige Analyse, alle Features und Test-Strategie
- Bjorklund-Algorithmus (Euclidean Rhythms): Standard-Implementierung O(n)
- Web Audio API Docs: Oscillator, PeriodicWave für Wavetable-Synthese
- WebRTC / WebSocket Kollaborations-Patterns für CRDT-basierte Sync

## Implementation Checklist

### [x] Phase 1: Step Probability & Conditional Triggers

- [x] Task 1.1: StepData-Interface erweitern (probability, condition)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 30–65)

- [x] Task 1.2: AudioEngine Probability-Logik im Scheduler
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 66–95)

- [x] Task 1.3: UI – Step-Kontextmenü für Probability/Condition
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 96–120)

- [x] Task 1.4: Tests – step-probability.test.ts (12 Tests)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 121–165)

### [x] Phase 2: Euclidean Rhythm Generator

- [x] Task 2.1: euclidean() Utility-Funktion (Bjorklund-Algorithmus)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 168–205)

- [x] Task 2.2: setPartEuclidean() in DrumMachine-Store
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 206–225)

- [x] Task 2.3: UI – EuclideanControls-Komponente (Hits/Steps/Rotation)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 226–250)

- [x] Task 2.4: Tests – euclidean.test.ts (10 Tests)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 251–300)

### [x] Phase 3: Sample Slicer & Loop Manager

- [x] Task 3.1: Transient-Detection-Algorithmus (Amplitude-Onset)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 303–340)

- [x] Task 3.2: SampleSlicerStore mit Slice-Datenstruktur
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 341–375)

- [x] Task 3.3: AudioEngine – Slice-Playback (Start/Ende/Loop-Mode)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 376–405)

- [x] Task 3.4: UI – SampleSlicer-Modal (Waveform + Slice-Marker)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 406–435)

- [x] Task 3.5: Tests – sample-slicer.test.ts (10 Tests)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 436–490)

### [x] Phase 4: Performance Mode / Live View

- [x] Task 4.1: PerformanceMode-State und Pattern-Launch-Pad-Datenstruktur
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 493–525)

- [x] Task 4.2: AudioEngine – Quantized Pattern-Switch-Logik
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 526–555)

- [x] Task 4.3: UI – PatternLaunchPad-Komponente (Vollbild-View)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 556–585)

- [x] Task 4.4: Tests – performance-mode.test.ts (8 Tests)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 586–625)

### [x] Phase 5: Wavetable / FM Synthesizer Engine

- [x] Task 5.1: SynthEngine-Modul (Wavetable + FM, 2-Op)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 628–680)

- [x] Task 5.2: PartData.sourceType und SynthParams erweitern
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 681–710)

- [x] Task 5.3: ADSR-Hüllkurve + LFO-Integration
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 711–740)

- [x] Task 5.4: UI – SynthPanel-Komponente (Osc-Typ, FM-Ratio, ADSR)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 741–770)

- [x] Task 5.5: Tests – synth-engine.test.ts (8 Tests)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 771–815)

### [x] Phase 6: Modulationsmatrix

- [x] Task 6.1: ModMatrix-Datenstruktur (Quellen x Ziele, Stärke)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 818–850)

- [x] Task 6.2: AudioEngine – ModMatrix-Processing im Scheduling-Loop
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 851–880)

- [x] Task 6.3: UI – ModMatrix-Grid-Komponente
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 881–910)

- [x] Task 6.4: Tests – mod-matrix.test.ts (8 Tests)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 911–955)

### [x] Phase 7: Collaborative Live Session

- [x] Task 7.1: WebSocket-Endpunkt für Session-Management (tRPC WebSocket)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 958–1000)

- [x] Task 7.2: useCollaborativeSession()-Hook mit CRDT-State-Sync
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1001–1045)

- [x] Task 7.3: Session-Status in Transport-Bar + Participant-Cursors
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1046–1075)

- [x] Task 7.4: Tests – collaborative-session.test.ts (8 Tests)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1076–1120)

### [x] Phase 8: AI Mix Assistant

- [x] Task 8.1: Mix-Analyse-Service (Spektrum + Pattern → Empfehlungen)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1123–1160)

- [x] Task 8.2: tRPC-Endpunkt mixAssistant.analyze()
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1161–1190)

- [x] Task 8.3: UI – MixAssistant-Panel (Empfehlungen + A/B-Vergleich)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1191–1220)

- [x] Task 8.4: Tests – ai-mix-assistant.test.ts (8 Tests)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1221–1260)

### [x] Phase 9: Test-Suiten für bestehende Features (Audit & Gap-Fill)

- [x] Task 9.1: drum-machine-store.test.ts (toggleStep, FX, Undo/Redo, Euclidean)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1263–1310)

- [x] Task 9.2: audio-engine.test.ts (BPM-Scheduling, Step-Auflösung, Channel-FX-Routing)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1311–1360)

- [x] Task 9.3: song-store.test.ts (Pattern-Chaining, Loop-Mode, Position)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1361–1400)

- [ ] Task 9.4: E2E-Tests – drum-machine.spec.ts, sample-import.spec.ts  ← offen (Playwright E2E)
  - Details: .copilot-tracking/details/20260325-synthstudio-roadmap-details.md (Zeilen 1401–1455)

## Dependencies

- Vitest (bereits konfiguriert: vitest.config.ts)
- Playwright (bereits konfiguriert: playwright.config.ts)
- Web Audio API (OscillatorNode, PeriodicWave, ConvolverNode – bereits genutzt)
- tRPC v11 + React Query v5 (bereits installiert)
- Drizzle ORM + MySQL2 (für Collaborative Session DB-Schema)
- framer-motion (für UI-Animationen im Performance-Mode)

## Success Criteria

- `pnpm test` läuft ohne Fehler, alle neuen Test-Dateien grün
- Alle 8 neuen Features sind in der Browser-Version (ohne Electron) funktionsfähig
- Isomorphie-Gesetz strikt eingehalten (kein direkter electron-Import in client/)
- Performance Mode öffnet sich per Shortcut und wechselt Pattern mit Quantisierung
- Euclidean Generator erzeugt für e(3,8) das Pattern [1,0,0,1,0,0,1,0]
- Step Probability: Steps mit 0% werden nie ausgelöst, Steps mit 100% immer
- Collaborative Session: Zwei Browser-Tabs synchronisieren Pattern-Changes in <100ms
