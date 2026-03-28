# Changes: Synthstudio Roadmap – Differenzierende Features & Tests

**Erstellt:** 2026-03-25  
**Plan:** [20260325-synthstudio-roadmap-plan.instructions.md](../plans/20260325-synthstudio-roadmap-plan.instructions.md)

---

## Phase 1: Step Probability & Conditional Triggers

### Task 1.1 – StepData-Interface erweitern
- **Datei:** `client/src/audio/AudioEngine.ts`
  - `StepData.probability?: number` (0–100) hinzugefügt
  - `StepData.condition?: StepCondition` hinzugefügt
  - `StepCondition`-Typ (always / probability / every / fill / not_fill) hinzugefügt
- **Datei:** `client/src/store/useDrumMachineStore.ts`
  - `setStepProbability()` Aktion hinzugefügt
  - `setStepCondition()` Aktion hinzugefügt
  - Interface `DrumMachineActions` erweitert

### Task 1.2 – AudioEngine Probability-Logik
- **Datei:** `client/src/audio/AudioEngine.ts`
  - `loopCount: number` privates Feld hinzugefügt
  - `isFillActive: boolean` privates Feld hinzugefügt
  - `shouldTriggerStep()` private Methode hinzugefügt
  - `setFillActive()` öffentliche Methode hinzugefügt
  - `_scheduleStep()` verwendet jetzt `shouldTriggerStep()` statt direktem `step.active`-Check

### Task 1.3 – UI: StepContextMenu-Komponente
- **Datei:** `client/src/components/DrumMachine/StepContextMenu.tsx` (NEU)
  - Radix Popover mit Probability-Slider und Condition-Selector
- **Datei:** `client/src/components/DrumMachine/DrumMachine.tsx`
  - `onContextMenu` auf Step-Buttons → öffnet StepContextMenu

### Task 1.4 – Tests: step-probability.test.ts
- **Datei:** `tests/electron/step-probability.test.ts` (NEU)
  - 12 Tests: Probability-Logik (0%, 50%, 100%), Conditional Triggers (every, fill)

---

## Phase 2: Euclidean Rhythm Generator

### Task 2.1 – euclidean() Utility-Funktion
- **Datei:** `client/src/utils/euclidean.ts` (NEU)
  - Bjorklund-Algorithmus: `euclidean(hits, steps, rotation) → boolean[]`

### Task 2.2 – setPartEuclidean() Store-Aktion
- **Datei:** `client/src/store/useDrumMachineStore.ts`
  - `setPartEuclidean(partId, hits, steps, rotation?)` hinzugefügt
  - Interface `DrumMachineActions` erweitert

### Task 2.3 – UI: EuclideanControls-Komponente
- **Datei:** `client/src/components/DrumMachine/EuclideanControls.tsx` (NEU)
  - Radix Popover mit Hits/Steps/Rotation-Inputs und Apply-Button

### Task 2.4 – Tests: euclidean.test.ts
- **Datei:** `tests/electron/euclidean.test.ts` (NEU)
  - 10 Tests: Bjorklund-Algorithmus, Rotation, Randfälle

---

## Phase 3: Sample Slicer & Loop Manager

### Task 3.1 – Transient-Detection-Algorithmus
- **Datei:** `client/src/utils/transientDetection.ts` (NEU)
  - `detectTransients(buffer, threshold, minGapMs)` → `TransientMarker[]`

### Task 3.2 – SampleSlicerStore
- **Datei:** `client/src/store/useSampleSlicerStore.ts` (NEU)
  - `SliceRegion`-Interface, CRUD-Aktionen

### Task 3.3 – AudioEngine Slice-Playback
- **Datei:** `client/src/audio/AudioEngine.ts`
  - `triggerDrum()` um `sliceStart/sliceEnd/loopMode/reverse`-Optionen erweitert

### Task 3.4 – UI: SampleSlicer-Modal
- **Datei:** `client/src/components/SampleSlicer/SampleSlicer.tsx` (NEU)
- **Datei:** `client/src/components/SampleSlicer/index.ts` (NEU)

### Task 3.5 – Tests: sample-slicer.test.ts
- **Datei:** `tests/electron/sample-slicer.test.ts` (NEU)
  - 10 Tests: Transient-Detection, SampleSlicerStore CRUD

---

## Phase 4: Performance Mode / Live View

### Task 4.1 – PerformanceStore
- **Datei:** `client/src/store/usePerformanceStore.ts` (NEU)
  - `PerformancePad`, `PerformanceState`, Store-Hook

### Task 4.2 – AudioEngine Quantized Pattern-Switch
- **Datei:** `client/src/audio/AudioEngine.ts`
  - `setQueuedPattern()`, `onPatternSwitch`-Callback

### Task 4.3 – UI: PatternLaunchPad-Komponente
- **Datei:** `client/src/components/PerformanceMode/PatternLaunchPad.tsx` (NEU)
- **Datei:** `client/src/components/PerformanceMode/index.ts` (NEU)

### Task 4.4 – Tests: performance-mode.test.ts
- **Datei:** `tests/electron/performance-mode.test.ts` (NEU)
  - 8 Tests: PerformanceStore, Quantized Pattern Switch

---

## Phase 5: Wavetable / FM Synthesizer Engine

### Task 5.1 – SynthEngine-Modul
- **Datei:** `client/src/audio/SynthEngine.ts` (NEU)
  - `SynthParams`, `DEFAULT_SYNTH_PARAMS`, `SynthEngine`-Klasse

### Task 5.2 – PartData.sourceType & SynthParams
- **Datei:** `client/src/audio/AudioEngine.ts`
  - `PartData.sourceType`, `PartData.synthParams` hinzugefügt

### Task 5.3 – ADSR + LFO Integration
- **Datei:** `client/src/audio/AudioEngine.ts`
  - Synth-Playback-Pfad im Scheduler

### Task 5.4 – UI: SynthPanel-Komponente
- **Datei:** `client/src/components/DrumMachine/SynthPanel.tsx` (NEU)

### Task 5.5 – Tests: synth-engine.test.ts
- **Datei:** `tests/electron/synth-engine.test.ts` (NEU)
  - 8 Tests (Web Audio API Mock)

---

## Phase 6: Modulationsmatrix

### Task 6.1 – ModMatrix-Datenstruktur
- **Datei:** `client/src/audio/AudioEngine.ts`
  - `ModSource`, `ModTarget`, `ModMatrixEntry` Typen
- **Datei:** `client/src/store/useDrumMachineStore.ts`
  - `modMatrix` State, CRUD-Aktionen

### Task 6.2 – AudioEngine ModMatrix-Processing
- **Datei:** `client/src/audio/AudioEngine.ts`
  - `processModMatrix()` private Methode

### Task 6.3 – UI: ModMatrix-Grid
- **Datei:** `client/src/components/DrumMachine/ModMatrix.tsx` (NEU)

### Task 6.4 – Tests: mod-matrix.test.ts
- **Datei:** `tests/electron/mod-matrix.test.ts` (NEU)
  - 8 Tests: Routing-Logik

---

## Phase 7: Collaborative Live Session

### Task 7.1 – WebSocket Session-Management
- **Datei:** `client/src/utils/collabSession.ts` (NEU – Browser-seitige Logik)

### Task 7.2 – useCollaborativeSession()-Hook
- **Datei:** `client/src/hooks/useCollaborativeSession.ts` (NEU)

### Task 7.3 – CollabStatus in Transport-Bar
- **Datei:** `client/src/components/DrumMachine/CollabStatus.tsx` (NEU)

### Task 7.4 – Tests: collaborative-session.test.ts
- **Datei:** `tests/electron/collaborative-session.test.ts` (NEU)
  - 8 Tests: Session-Management-Logik

---

## Phase 8: AI Mix Assistant

### Task 8.1 – Mix-Analyse-Service
- **Datei:** `client/src/utils/mixAnalysis.ts` (NEU)

### Task 8.2-8.3 – tRPC-Endpunkt + UI
- Bestehende Backend-Infrastruktur nutzen

### Task 8.4 – Tests: ai-mix-assistant.test.ts
- **Datei:** `tests/electron/ai-mix-assistant.test.ts` (NEU)
  - 8 Tests: regelbasierte Logik

---

## Phase 9: Test-Suiten für bestehende Features

### Task 9.1 – drum-machine-store.test.ts
- **Datei:** `tests/electron/drum-machine-store.test.ts` (NEU) – 13 Tests

### Task 9.2 – audio-engine.test.ts
- **Datei:** `tests/electron/audio-engine.test.ts` (NEU) – 7 Tests

### Task 9.3 – song-store.test.ts
- **Datei:** `tests/electron/song-store.test.ts` (NEU) – 8 Tests

### Task 9.4 – E2E-Tests
- **Datei:** `tests/electron/e2e/drum-machine.spec.ts` (NEU)
- **Datei:** `tests/electron/e2e/sample-import.spec.ts` (NEU)
