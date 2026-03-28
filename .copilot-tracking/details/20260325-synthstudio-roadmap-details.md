<!-- markdownlint-disable-file -->

# Task Details: Synthstudio Roadmap – Differenzierende Features & Tests

## Research Reference

**Source Research**: #file:../research/20260325-synthstudio-roadmap-research.md

---

## Phase 1: Step Probability & Conditional Triggers

### Task 1.1: StepData-Interface erweitern

Erweitere `StepData` in `client/src/audio/AudioEngine.ts` um `probability` und `condition`.
Ergänze `DEFAULT_STEP` Konstante. Aktualisiere `useDrumMachineStore.ts` und Persistenz.

```typescript
export type StepCondition = 
  | { type: "always" }
  | { type: "probability"; value: number }       // 0–100 %
  | { type: "every"; n: number; of: number }     // "A:B" – jedes n-te von B
  | { type: "fill" }
  | { type: "not_fill" };

export interface StepData {
  active: boolean;
  velocity?: number;  // 0–127
  pitch?: number;     // Halbtöne
  probability?: number;   // NEU: 0–100, default 100
  condition?: StepCondition; // NEU: default { type: "always" }
}
```

- **Dateien:**
  - client/src/audio/AudioEngine.ts – StepData Interface erweitern
  - client/src/store/useDrumMachineStore.ts – setStepProbability(), setStepCondition() Aktionen
- **Success:**
  - TypeScript kompiliert ohne Fehler (`pnpm check`)
  - Neuer State persistiert in localStorage
- **Research:** #file:../research/20260325-synthstudio-roadmap-research.md (Zeilen 80–120)
- **Dependencies:** Keine

### Task 1.2: AudioEngine Probability-Logik im Scheduler

Im `scheduleStep()`-Callback der AudioEngine: Vor dem Auslösen eines Steps die Wahrscheinlichkeit prüfen.
Pattern-Counter (loopCount) als privates Feld der Engine hinzufügen.

```typescript
// In AudioEngine.ts – scheduleNote() / triggerStep() Methode
private loopCount: number = 0;  // Zählt Durchläufe seit Play

private shouldTriggerStep(step: StepData): boolean {
  if (!step.active) return false;
  const prob = step.probability ?? 100;
  if (prob <= 0) return false;
  if (prob >= 100) return !step.condition || step.condition.type === "always";
  // Wahrscheinlichkeits-Check
  if (Math.random() * 100 > prob) return false;
  // Conditional-Check
  if (step.condition) {
    if (step.condition.type === "every") {
      return (this.loopCount % step.condition.of) === (step.condition.n - 1);
    }
    if (step.condition.type === "fill") return this.isFillActive;
    if (step.condition.type === "not_fill") return !this.isFillActive;
  }
  return true;
}
```

- **Dateien:**
  - client/src/audio/AudioEngine.ts – shouldTriggerStep(), loopCount, isFillActive
- **Success:**
  - Step mit probability=0 wird niemals ausgelöst
  - Step mit probability=100 und condition="always" wird immer ausgelöst
  - "every 1 of 2" löst exakt jeden 2. Durchlauf aus
- **Research:** #file:../research/20260325-synthstudio-roadmap-research.md (Zeilen 80–95)
- **Dependencies:** Task 1.1

### Task 1.3: UI – Step-Kontextmenü für Probability/Condition

Rechtsklick auf einen Step-Button öffnet ein Popover (Radix PopoverContent) mit:
- Probability-Slider (0–100)
- Condition-Selector (Dropdown: Always / Every N:M / Fill / !Fill)

```tsx
// Neue Komponente: client/src/components/DrumMachine/StepContextMenu.tsx
import * as Popover from "@radix-ui/react-popover";
import { Slider } from "@/components/ui/slider";
```

- **Dateien:**
  - client/src/components/DrumMachine/StepContextMenu.tsx – NEU
  - client/src/components/DrumMachine/DrumMachine.tsx – onContextMenu auf Step-Button
- **Success:**
  - Rechtsklick zeigt Popover
  - Slider ändert Step-Probability im Store
  - Visuelles Indikator-Symbol (z.B. %) auf Step wenn probability < 100
- **Dependencies:** Task 1.1, Task 1.2

### Task 1.4: Tests – step-probability.test.ts

```typescript
// tests/electron/step-probability.test.ts
describe("shouldTriggerStep – Probability", () => {
  it("löst nie aus wenn probability=0")
  it("löst immer aus wenn probability=100")
  it("löst statistisch ~50% aus bei probability=50 (1000 Iterationen)")
  it("löst immer aus wenn condition=always und probability=100")
})

describe("shouldTriggerStep – Conditional Triggers", () => {
  it("'every 1:2' löst exakt jeden 2. Durchlauf aus")
  it("'every 2:2' löst exakt beim 2. von 2 Durchläufen aus")
  it("'every 1:4' löst beim 1., 5., 9. Durchlauf aus")
  it("fill-condition löst nur aus wenn isFillActive=true")
  it("not_fill-condition löst nur aus wenn isFillActive=false")
  it("inaktiver Step wird nie ausgelöst unabhängig von probability")
  it("Step ohne probability-Feld hat Standard-Verhalten (100%)")
  it("probability=-1 wird als 0 behandelt (Clamp)")
})
```

- **Dateien:**
  - tests/electron/step-probability.test.ts – NEU (12 Tests)
- **Success:** `pnpm test` – 12/12 Tests grün
- **Dependencies:** Task 1.2

---

## Phase 2: Euclidean Rhythm Generator

### Task 2.1: euclidean() Utility-Funktion

Bjorklund-Algorithmus: Verteilt `hits` Pulse gleichmäßig über `steps` Steps.

```typescript
// client/src/utils/euclidean.ts
/**
 * Bjorklund-Algorithmus: Erzeugt ein Euclidean-Pattern.
 * euclidean(3, 8, 0) → [true, false, false, true, false, false, true, false]  (Clave-Pattern)
 * euclidean(4, 4, 0) → [true, true, true, true]
 */
export function euclidean(hits: number, steps: number, rotation = 0): boolean[] {
  if (steps <= 0) return [];
  hits = Math.max(0, Math.min(hits, steps));
  if (hits === 0) return Array(steps).fill(false);
  if (hits === steps) return Array(steps).fill(true);
  
  const pattern: boolean[] = [];
  // Bjorklund via Bresenham-ähnliche Methode
  let bucket = 0;
  for (let i = 0; i < steps; i++) {
    bucket += hits;
    if (bucket >= steps) {
      bucket -= steps;
      pattern.push(true);
    } else {
      pattern.push(false);
    }
  }
  // Rotation anwenden
  const r = ((rotation % steps) + steps) % steps;
  return [...pattern.slice(r), ...pattern.slice(0, r)];
}
```

- **Dateien:**
  - client/src/utils/euclidean.ts – NEU
- **Success:** euclidean(3,8,0) === [T,F,F,T,F,F,T,F]
- **Research:** #file:../research/20260325-synthstudio-roadmap-research.md (Zeilen 123–155)
- **Dependencies:** Keine

### Task 2.2: setPartEuclidean() in DrumMachine-Store

Neue Aktion im DrumMachineStore die das euclidean() Ergebnis auf die Steps eines Parts anwendet.

```typescript
// In useDrumMachineStore.ts – DrumMachineActions Interface
setPartEuclidean: (partId: string, hits: number, steps: number, rotation?: number) => void;

// Implementierung:
setPartEuclidean: (partId, hits, steps, rotation = 0) => {
  const pattern = euclidean(hits, steps, rotation);
  // Steps des Parts aktualisieren
  updatePart(partId, part => ({
    ...part,
    steps: part.steps.map((s, i) => ({ ...s, active: pattern[i] ?? false }))
  }));
  saveState(); // Undo-History
},
```

- **Dateien:**
  - client/src/store/useDrumMachineStore.ts – setPartEuclidean() hinzufügen
- **Success:** Aktion ändert Steps korrekt, Undo/Redo funktioniert
- **Dependencies:** Task 2.1

### Task 2.3: UI – EuclideanControls-Komponente

Kompakter Inline-Editor pro Channel-Row (3 Knöpfe/Inputs: Hits, Steps, Rotation) mit "Apply"-Button.

```tsx
// client/src/components/DrumMachine/EuclideanControls.tsx
// Anzeige: "E: 3/8 r:0" als Kurzform
// Öffnet Mini-Popover (Radix Popover) mit 3 NumberInputs
```

- **Dateien:**
  - client/src/components/DrumMachine/EuclideanControls.tsx – NEU
  - client/src/components/DrumMachine/DrumMachine.tsx – EuclideanControls in Channel-Row einbetten
- **Success:** E-Button pro Channel sichtbar, Pattern wird korrekt angewendet
- **Dependencies:** Task 2.1, Task 2.2

### Task 2.4: Tests – euclidean.test.ts

```typescript
// tests/electron/euclidean.test.ts
describe("euclidean() – Bjorklund-Algorithmus", () => {
  it("e(3,8) → klassisches Clave-Pattern [T,F,F,T,F,F,T,F]")
  it("e(4,4) → alle Steps aktiv")
  it("e(0,8) → alle Steps inaktiv")
  it("e(8,8) → alle Steps aktiv")
  it("e(1,4) → [T,F,F,F]")
  it("e(2,4) → [T,F,T,F]")
  it("e(3,8,1) → Rotation verschiebt Pattern um 1")
  it("e(3,8,-1) → negative Rotation möglich")
  it("steps=0 → leeres Array zurück")
  it("hits > steps → wird auf steps geclampt")
})
```

- **Dateien:**
  - tests/electron/euclidean.test.ts – NEU (10 Tests)
- **Success:** `pnpm test` – 10/10 Tests grün
- **Dependencies:** Task 2.1

---

## Phase 3: Sample Slicer & Loop Manager

### Task 3.1: Transient-Detection-Algorithmus

Amplitude-Onset-Detection: Findet Stellen im Audio-Buffer wo die Amplitude steil ansteigt.

```typescript
// client/src/utils/transientDetection.ts
export interface TransientMarker {
  sampleOffset: number;  // Frame-Position im AudioBuffer
  timeSeconds: number;
  strength: number;       // 0–1, Stärke des Transienten
}

export function detectTransients(
  buffer: AudioBuffer,
  threshold = 0.15,
  minGapMs = 50
): TransientMarker[] {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const minGapSamples = (minGapMs / 1000) * sampleRate;
  const markers: TransientMarker[] = [];
  let prevAmplitude = 0;
  let lastMarkerOffset = -minGapSamples;

  for (let i = 1; i < channelData.length; i++) {
    const amplitude = Math.abs(channelData[i]);
    const delta = amplitude - prevAmplitude;
    if (delta > threshold && (i - lastMarkerOffset) > minGapSamples) {
      markers.push({ sampleOffset: i, timeSeconds: i / sampleRate, strength: delta });
      lastMarkerOffset = i;
    }
    prevAmplitude = amplitude;
  }
  return markers;
}
```

- **Dateien:**
  - client/src/utils/transientDetection.ts – NEU
- **Success:** detectTransients() gibt korrekte Marker für Drum-Loop zurück
- **Research:** #file:../research/20260325-synthstudio-roadmap-research.md (Zeilen 175–210)
- **Dependencies:** Keine

### Task 3.2: SampleSlicerStore mit Slice-Datenstruktur

```typescript
// client/src/store/useSampleSlicerStore.ts
export interface SliceRegion {
  id: string;
  startOffset: number;   // Frames
  endOffset: number;     // Frames (0 = bis Ende)
  loopMode: "one-shot" | "loop" | "ping-pong";
  reverse: boolean;
  name?: string;
}
export interface SampleSlicerState {
  sampleUrl?: string;
  audioDuration: number;
  slices: SliceRegion[];
}
```

- **Dateien:**
  - client/src/store/useSampleSlicerStore.ts – NEU
- **Success:** Store initialisiert, CRUD für Slices funktioniert
- **Dependencies:** Task 3.1

### Task 3.3: AudioEngine – Slice-Playback

Erweitere `triggerDrum()` in AudioEngine um optionale `sliceRegion`-Parameter (start, end, loop, reverse).

```typescript
// In AudioEngine.ts – triggerDrum() Methode
triggerDrum(partId: string, options?: {
  sliceStart?: number;  // Sekunden
  sliceEnd?: number;    // Sekunden
  loopMode?: "one-shot" | "loop" | "ping-pong";
  reverse?: boolean;
}): void
```

- **Dateien:** client/src/audio/AudioEngine.ts – triggerDrum() erweitern
- **Success:** Sample-Playback startet an sliceStart, endet an sliceEnd
- **Dependencies:** Task 3.2

### Task 3.4: UI – SampleSlicer-Modal

Öffnet sich via Doppelklick auf Sample-Name in Channel-Row. Zeigt:
- Waveform-Canvas (bestehender WaveformDisplay nutzen)
- Vertikale Slice-Marker, ziehbar
- Slice-Liste mit Loop-Mode und Reverse-Toggle
- "Auto-Slice"-Button (Transient-Detection)
- "Map to Steps"-Button (Slices auf Steps anwenden)

- **Dateien:**
  - client/src/components/SampleSlicer/ – Neuer Ordner mit SampleSlicer.tsx, index.ts
- **Success:** Modal öffnet sich, Slices werden erstellt und auf Steps gemappt
- **Dependencies:** Task 3.1, Task 3.2, Task 3.3

### Task 3.5: Tests – sample-slicer.test.ts

```typescript
// tests/electron/sample-slicer.test.ts
describe("detectTransients()", () => {
  it("findet keine Transienten in stillem Audio")
  it("findet einen Transienten nach einem Amplituden-Sprung")
  it("minGapMs verhindert doppelte Markierungen")
  it("threshold=0 findet jeden Sample-Anstieg")
  it("strength ist proportional zur Amplitude-Änderung")
})
describe("SampleSlicerStore", () => {
  it("addSlice() erstellt neuen Slice mit ID")
  it("removeSlice() entfernt Slice korrekt")
  it("updateSlice() aktualisiert loopMode")
  it("slices sind sortiert nach startOffset")
  it("Auto-Slice aus detectTransients() erstellt korrektes Slices-Array")
})
```

- **Dateien:** tests/electron/sample-slicer.test.ts – NEU (10 Tests)
- **Success:** `pnpm test` – 10/10 grün
- **Dependencies:** Task 3.1, Task 3.2

---

## Phase 4: Performance Mode / Live View

### Task 4.1: PerformanceMode-State und Pattern-Launch-Pad-Datenstruktur

```typescript
// In useProjectStore.ts oder neuer usePerformanceStore.ts
export interface PerformancePad {
  patternId: string;
  color?: string;   // Benutzerdefinierte Farbe
  label?: string;
}
export interface PerformanceState {
  active: boolean;          // Performance-Mode ein/aus
  pads: PerformancePad[];   // 16 Pads (entsprechen Pattern-Slots)
  queuedPatternId: string | null;   // Nächstes Pattern (wird quantisiert gewechselt)
  quantizeMode: "bar" | "beat" | "step";
}
```

- **Dateien:**
  - client/src/store/usePerformanceStore.ts – NEU
  - client/src/App.tsx – PerformanceMode toggle (Shortcut F12)
- **Success:** Store initialisiert, Performance-Mode toggle funktioniert

### Task 4.2: AudioEngine – Quantized Pattern-Switch-Logik

Am Ende jedes Bars (oder Beats/Steps je nach quantizeMode) prüft der Scheduler ob ein `queuedPatternId` gesetzt ist und wechselt dann das aktive Pattern.

```typescript
// In AudioEngine.ts
setQueuedPattern(patternId: string, quantize: "bar" | "beat" | "step"): void
// Internes Flag: queuedPatternId wird beim nächsten Quantisierungspunkt
// durch Aufruf von onPatternSwitch-Callback übernommen
```

- **Dateien:** client/src/audio/AudioEngine.ts – setQueuedPattern(), onPatternSwitch-Callback
- **Success:** Pattern wechselt exakt am nächsten Bar-Ende ohne Glitch
- **Dependencies:** Task 4.1

### Task 4.3: UI – PatternLaunchPad-Komponente (Vollbild-View)

Vollbild-Overlay (Portal) mit 4×4 Grid aus farbigen Pad-Buttons. Aktives Pattern leuchtet.
Queued Pattern blinkt. Zeigt BPM, aktuellen Step, Sync-Status.

```tsx
// client/src/components/PerformanceMode/PatternLaunchPad.tsx
// Öffnet sich via Button in Transport-Bar oder F12 Shortcut
// ESC oder gleicher Button schließt Performance-Mode
```

- **Dateien:**
  - client/src/components/PerformanceMode/ – NEU (PatternLaunchPad.tsx, index.ts)
  - client/src/App.tsx – Performance-Mode Integration
- **Success:** Vollbild öffnet, Pads starten Pattern mit Quantisierung
- **Dependencies:** Task 4.1, Task 4.2

### Task 4.4: Tests – performance-mode.test.ts

```typescript
// tests/electron/performance-mode.test.ts
describe("PerformanceStore", () => {
  it("initial state: active=false, pads=[], queuedPatternId=null")
  it("setActive(true) aktiviert Performance-Mode")
  it("queuePattern() setzt queuedPatternId")
  it("clearQueue() setzt queuedPatternId auf null")
})
describe("Quantized Pattern Switch", () => {
  it("quantizeMode=bar: Wechsel erfolgt auf nächsten Bar-Start")
  it("quantizeMode=beat: Wechsel erfolgt auf nächsten Beat")
  it("quantizeMode=step: sofortiger Wechsel")
  it("zweimaliges Queuen desselben Pattern löscht die Queue")
})
```

- **Dateien:** tests/electron/performance-mode.test.ts – NEU (8 Tests)
- **Success:** `pnpm test` – 8/8 grün
- **Dependencies:** Task 4.1, Task 4.2

---

## Phase 5: Wavetable / FM Synthesizer Engine

### Task 5.1: SynthEngine-Modul

Neues Audio-Modul für Wavetable- und FM-Synthese basierend auf Web Audio API OscillatorNode und PeriodicWave.

```typescript
// client/src/audio/SynthEngine.ts
export type OscillatorType = "sine" | "sawtooth" | "square" | "triangle" | "custom";
export type SynthMode = "wavetable" | "fm";

export interface SynthParams {
  mode: SynthMode;
  // Wavetable
  oscType: OscillatorType;
  detune: number;          // Cents (-100..+100)
  // FM
  fmRatio: number;         // Modulator/Carrier Frequenz-Verhältnis (0.1–10)
  fmDepth: number;         // Modulations-Tiefe (0–1000 Hz)
  // ADSR
  attack: number;          // 0–2s
  decay: number;           // 0–2s
  sustain: number;         // 0–1
  release: number;         // 0–5s
  // LFO
  lfoEnabled: boolean;
  lfoRate: number;         // Hz (0.1–20)
  lfoDepth: number;        // 0–100 Cents
  lfoTarget: "pitch" | "volume" | "filter";
}

export const DEFAULT_SYNTH_PARAMS: SynthParams = {
  mode: "wavetable", oscType: "sawtooth", detune: 0,
  fmRatio: 2, fmDepth: 100,
  attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.3,
  lfoEnabled: false, lfoRate: 4, lfoDepth: 10, lfoTarget: "pitch"
};
```

- **Dateien:** client/src/audio/SynthEngine.ts – NEU
- **Success:** SynthEngine erzeugt hörbare Töne über Web Audio API
- **Research:** #file:../research/20260325-synthstudio-roadmap-research.md (Zeilen 145–175)
- **Dependencies:** Keine

### Task 5.2: PartData.sourceType und SynthParams erweitern

PartData in AudioEngine.ts erhält `sourceType` und `synthParams`.

```typescript
export interface PartData {
  // ... bestehende Felder ...
  sourceType: "sample" | "wavetable" | "fm";  // NEU, default "sample"
  synthParams?: SynthParams;                   // NEU
}
```

- **Dateien:** client/src/audio/AudioEngine.ts, client/src/store/useDrumMachineStore.ts
- **Success:** TypeScript kompiliert, Persistenz funktioniert
- **Dependencies:** Task 5.1

### Task 5.3: ADSR-Hüllkurve + LFO-Integration

Im AudioEngine-Scheduling: Wenn `sourceType !== "sample"`, SynthEngine.triggerNote() aufrufen statt Audio-Buffer.
ADSR via GainNode-Automation, LFO via OscillatorNode→GainNode.

- **Dateien:** client/src/audio/AudioEngine.ts – triggerDrum() Verzweigung
- **Success:** Note mit ADSR abgespielt, LFO moduliert Pitch hörbar
- **Dependencies:** Task 5.1, Task 5.2

### Task 5.4: UI – SynthPanel-Komponente

Tab neben FX-Panel. Zeigt: Osc-Typ Selector, FM-Ratio Slider, ADSR-Envelope-Display (SVG-Kurve), LFO On/Off + Rate/Depth.

- **Dateien:** client/src/components/DrumMachine/SynthPanel.tsx – NEU
- **Success:** Panel öffnet sich, Parameter-Änderungen hörbar
- **Dependencies:** Task 5.2, Task 5.3

### Task 5.5: Tests – synth-engine.test.ts

```typescript
// tests/electron/synth-engine.test.ts
describe("SynthParams – Defaults und Validierung", () => {
  it("DEFAULT_SYNTH_PARAMS hat alle Pflichtfelder")
  it("mode=wavetable verwendet OscillatorNode")
  it("mode=fm setzt Modulator-Frequenz korrekt (carrier * fmRatio)")
  it("ADSR attack=0 startet sofort auf voller Lautstärke")
  it("LFO mit lfoEnabled=false hat keine Auswirkung")
})
describe("SynthEngine.triggerNote()", () => {
  it("gibt AudioNode zurück (nicht null)")
  it("Detune wird korrekt an OscillatorNode übergeben")
  it("Release-Phase stoppt nach release-Zeit")
})
```

- **Dateien:** tests/electron/synth-engine.test.ts – NEU (8 Tests, Web Audio Mock)
- **Success:** `pnpm test` – 8/8 grün
- **Dependencies:** Task 5.1

---

## Phase 6: Modulationsmatrix

### Task 6.1: ModMatrix-Datenstruktur

```typescript
// In client/src/store/useDrumMachineStore.ts oder neuer Datei
export type ModSource = 
  | { type: "lfo"; partId: string }
  | { type: "stepSeq"; partId: string; stepIndex: number }
  | { type: "midiCC"; ccNumber: number }
  | { type: "envelope"; partId: string }
  | { type: "random" };

export type ModTarget = 
  | { type: "channelFx"; partId: string; param: keyof ChannelFx }
  | { type: "pitch"; partId: string }
  | { type: "volume"; partId: string }
  | { type: "pan"; partId: string };

export interface ModMatrixEntry {
  id: string;
  source: ModSource;
  target: ModTarget;
  amount: number;   // -1..+1 (bipolar)
  enabled: boolean;
}
```

- **Dateien:**
  - client/src/audio/AudioEngine.ts – ModMatrixEntry, ModSource, ModTarget Typen
  - client/src/store/useDrumMachineStore.ts – modMatrix: ModMatrixEntry[] State, CRUD-Aktionen
- **Success:** TypeScript kompiliert, State persistiert
- **Dependencies:** Phase 5 (für SynthParams als mögliche Targets)

### Task 6.2: AudioEngine – ModMatrix-Processing

Im pre-scheduling Schritt (vor scheduleNote): Alle aktiven ModMatrix-Entries abarbeiten,
Werte berechnen und Parameter temporär überschreiben.

- **Dateien:** client/src/audio/AudioEngine.ts – processModMatrix() private Methode
- **Success:** LFO-Quelle moduliert Filter-Cutoff sichtbar am Filter-Knob
- **Dependencies:** Task 6.1

### Task 6.3: UI – ModMatrix-Grid-Komponente

Tabellen-View: Zeilen = Quellen, Spalten = Ziele. Jede Zelle: leer oder Slider (-1..+1).
"+" Button um neue Route hinzuzufügen. Löschen via X-Icon.

- **Dateien:** client/src/components/DrumMachine/ModMatrix.tsx – NEU
- **Success:** Grid angezeigt, Routing-Änderungen hörbar
- **Dependencies:** Task 6.1, Task 6.2

### Task 6.4: Tests – mod-matrix.test.ts

```typescript
describe("ModMatrix – Routing-Logik", () => {
  it("addEntry() fügt Entry mit eindeutiger ID hinzu")
  it("removeEntry() entfernt korrekt")
  it("disabled Entry hat keine Auswirkung auf Audio-Parameter")
  it("amount=0 hat keine Auswirkung")
  it("amount=1 addiert Maximum zum Ziel-Parameter")
  it("amount=-1 subtrahiert Maximum vom Ziel-Parameter")
  it("Wert-Clamp: Ziel überschreitet nicht seinen gültigen Bereich")
  it("mehrere Entries auf dasselbe Ziel werden summiert")
})
```

- **Dateien:** tests/electron/mod-matrix.test.ts – NEU (8 Tests)
- **Success:** `pnpm test` – 8/8 grün
- **Dependencies:** Task 6.1

---

## Phase 7: Collaborative Live Session

### Task 7.1: WebSocket-Endpunkt für Session-Management

Neues tRPC-WebSocket-Subscription für Session-Sync. Alternativ: einfacher Socket.io-Endpunkt.

```typescript
// server/ oder electron/ – collabSession.ts
// Endpunkte:
//   createSession(hostName) → { sessionCode: string }
//   joinSession(code, userName) → { sessionId, participants }
//   syncState(sessionId, stateDelta) → void (broadcast)
//   leaveSession(sessionId) → void
```

- **Dateien:**
  - server/ – collabSession.ts (WebSocket-Handler) – NEU
  - electron/main.ts – IPC-Handler für Desktop-Version
- **Success:** Zwei Browser-Clients können Session erstellen/beitreten
- **Research:** #file:../research/20260325-synthstudio-roadmap-research.md (Zeilen 215–255)
- **Dependencies:** tRPC WebSocket Setup

### Task 7.2: useCollaborativeSession()-Hook

React-Hook der WebSocket-Verbindung managed und Pattern-State via CRDT synchronisiert.

```typescript
// client/src/hooks/useCollaborativeSession.ts
export interface CollabSession {
  sessionCode: string;
  participants: Participant[];
  isHost: boolean;
  syncState: (delta: Partial<DrumMachineState>) => void;
  disconnect: () => void;
}
export function useCollaborativeSession(): {
  session: CollabSession | null;
  createSession: (name: string) => Promise<string>;
  joinSession: (code: string, name: string) => Promise<void>;
}
```

- **Dateien:** client/src/hooks/useCollaborativeSession.ts – NEU
- **Success:** State-Änderungen propagieren an alle Verbundenen in <100ms
- **Dependencies:** Task 7.1

### Task 7.3: Session-Status in Transport-Bar + Participant-Cursors

Kleines Status-Badge in Transport-Bar: grüner Punkt = Session aktiv, Anzahl Teilnehmer.
Tooltip mit Session-Code (zum Teilen). Optional: farbige Cursor-Overlays.

- **Dateien:**
  - client/src/components/DrumMachine/CollabStatus.tsx – NEU
  - App.tsx / Transport-Bereich – CollabStatus einbetten
- **Success:** Badge erscheint in Transport, zeigt Teilnehmer-Anzahl
- **Dependencies:** Task 7.2

### Task 7.4: Tests – collaborative-session.test.ts

```typescript
describe("Collaborative Session – State Sync", () => {
  it("createSession() gibt 6-stelligen Code zurück")
  it("joinSession() mit gültigem Code verbindet")
  it("joinSession() mit ungültigem Code wirft Error")
  it("syncState() broadcastet Delta an alle Teilnehmer")
  it("disconnect() beendet Session gracefully")
  it("Host-Disconnect beendet Session für alle")
  it("State-Delta wird nur mit geänderten Keys übertragen (nicht Gesamt-State)")
  it("Maximale Teilnehmer-Anzahl wird enforced (z.B. 8)")
})
```

- **Dateien:** tests/electron/collaborative-session.test.ts – NEU (8 Tests)
- **Success:** `pnpm test` – 8/8 grün
- **Dependencies:** Task 7.1, Task 7.2

---

## Phase 8: AI Mix Assistant

### Task 8.1: Mix-Analyse-Service

Analysiert aktiven Pattern-State + FX-Einstellungen und gibt strukturierte Empfehlungen zurück.

```typescript
// Analyse-Eingabe:
interface MixAnalysisInput {
  patternData: PatternData;        // Aktives Pattern
  spectrumData: Float32Array;      // Aus Spektrum-Analyzer
  grooveAnalysis: GrooveAnalysis;  // Aus bestehender Groove-Analyse
}
// Empfehlungs-Format:
interface MixRecommendation {
  partId: string;
  category: "eq" | "compression" | "density" | "timing" | "fx";
  priority: "high" | "medium" | "low";
  description: string;             // Human-readable Erklärung
  suggestedParams?: Partial<ChannelFx>;  // Optionale konkrete Werte
}
```

- **Dateien:** client/src/utils/mixAnalysis.ts – NEU
- **Success:** Gibt sinnvolle Empfehlungen für Standard-Drum-Pattern zurück
- **Research:** #file:../research/20260325-synthstudio-roadmap-research.md (Zeilen 260–295)
- **Dependencies:** Bestehender Spektrum-Analyzer muss Daten exportieren

### Task 8.2: tRPC-Endpunkt mixAssistant.analyze()

Erweitert bestehenden AI-Router (oder neuer Router) um mixAssistant.analyze()-Mutation.
Sendet Analyse-Daten an LLM, parst strukturierte Empfehlungen zurück.

```typescript
// server/ – router/mixAssistant.ts
mixAssistant.analyze: t.procedure
  .input(z.object({ analysisData: MixAnalysisInputSchema }))
  .mutation(async ({ input }) => {
    // LLM-Prompt mit Analyse-Daten
    // Response parsen → MixRecommendation[]
  })
```

- **Dateien:**
  - server/ – router/mixAssistant.ts – NEU
  - server/ – _core/index.ts – Router einbinden
- **Success:** Endpunkt gibt valides MixRecommendation[]-Array zurück
- **Dependencies:** Task 8.1, bestehender LLM-Backend

### Task 8.3: UI – MixAssistant-Panel

Side-Panel neben FX-Panel mit:
- "Analyse starten"-Button (triggert mixAssistant.analyze())
- Liste der Empfehlungen (Priority-Badge, Beschreibung, "Apply"-Button)
- A/B-Toggle: Original-FX vs. AI-vorgeschlagene FX

- **Dateien:** client/src/components/DrumMachine/MixAssistantPanel.tsx – NEU
- **Success:** Panel zeigt Empfehlungen, Apply übernimmt vorgeschlagene FX
- **Dependencies:** Task 8.1, Task 8.2

### Task 8.4: Tests – ai-mix-assistant.test.ts

```typescript
describe("mixAnalysis – Regelbasierte Grundlogik", () => {
  it("Kick ohne Low-Shelf EQ → Empfehlung mit category=eq")
  it("Pattern-Density > 80% → Empfehlung mit category=density")
  it("Leeres Pattern → keine Empfehlungen")
  it("Alle FX deaktiviert → mind. eine Empfehlung")
})
describe("MixRecommendation Format", () => {
  it("jede Empfehlung hat partId, category, priority, description")
  it("suggestedParams entspricht validen ChannelFx-Werten")
  it("priority-Werte sind nur 'high'|'medium'|'low'")
  it("description ist nicht leer")
})
```

- **Dateien:** tests/electron/ai-mix-assistant.test.ts – NEU (8 Tests)
- **Success:** `pnpm test` – 8/8 grün
- **Dependencies:** Task 8.1

---

## Phase 9: Test-Suiten für bestehende Features (Audit & Gap-Fill)

### Task 9.1: drum-machine-store.test.ts

Vollständige Store-Test-Suite für den wichtigsten Store der Anwendung.

```typescript
// tests/electron/drum-machine-store.test.ts
describe("toggleStep()", () => {
  it("togglet Step von inactive auf active")
  it("togglet Step von active auf inactive")
  it("Step außerhalb des Bereichs wird ignoriert")
})
describe("Velocity & Pitch", () => {
  it("setStepVelocity() speichert Wert 0–127")
  it("setStepVelocity() clampt Werte außerhalb des Bereichs")
  it("setStepPitch() speichert Halbtöne")
})
describe("FX-Chain", () => {
  it("setPartFx() aktualisiert einzelnen FX-Parameter")
  it("DEFAULT_CHANNEL_FX hat alle Pflichtfelder")
})
describe("Undo/Redo", () => {
  it("undo() nach toggleStep() stellt vorherigen State wieder her")
  it("redo() nach undo() stellt neuen State wieder her")
  it("History-Limit 50 wird eingehalten")
})
describe("Euclidean Integration", () => {
  it("setPartEuclidean(3,8) setzt korrekte Steps")
  it("setPartEuclidean erzeugt Undo-History-Eintrag")
})
```

- **Dateien:** tests/electron/drum-machine-store.test.ts – NEU (13 Tests)
- **Success:** 13/13 grün
- **Research:** #file:../research/20260325-synthstudio-roadmap-research.md (Zeilen 35–60)
- **Dependencies:** Phase 1 und Phase 2 müssen abgeschlossen sein

### Task 9.2: audio-engine.test.ts

Tests für die Audio-Engine-Logik (ohne echte Web Audio API – mit Mock).

```typescript
// tests/electron/audio-engine.test.ts
describe("BPM-Scheduling", () => {
  it("setBpm(120) aktualisiert Schedule-Interval korrekt")
  it("setBpm(0) wird auf Minimum-BPM geclampt")
})
describe("Step-Auflösung", () => {
  it("1/8 hat doppelt so großen Step-Abstand wie 1/16")
  it("1/32 hat halb so großen Step-Abstand wie 1/16")
})
describe("Channel-FX-Routing", () => {
  it("initChannel() erstellt validen ChannelNodes-Graphen")
  it("setChannelFx() aktualisiert BiquadFilter-Frequenz korrekt")
  it("Delay-Feedback > 0.95 wird geclampt")
})
```

- **Dateien:** tests/electron/audio-engine.test.ts – NEU (7 Tests, Web Audio API Mock)
- **Success:** 7/7 grün
- **Dependencies:** Web Audio API Mock in tests/electron/mocks/

### Task 9.3: song-store.test.ts

```typescript
// tests/electron/song-store.test.ts
describe("Song – Pattern-Chaining", () => {
  it("addPattern() fügt Pattern-ID zur Song-Sequenz hinzu")
  it("removePattern() entfernt Pattern aus Song-Sequenz")
  it("movePattern() verschiebt Pattern korrekt")
  it("getNextPatternId() gibt nächste Pattern-ID zurück")
  it("getNextPatternId() wraps around bei letztem Pattern (Loop)")
  it("getNextPatternId() mit leerer Sequenz gibt null zurück")
})
describe("Song – Loop-Mode", () => {
  it("loop=true: nach letztem Pattern kehrt es zum ersten zurück")
  it("loop=false: nach letztem Pattern stoppt Playback")
})
```

- **Dateien:** tests/electron/song-store.test.ts – NEU (8 Tests)
- **Success:** 8/8 grün
- **Dependencies:** Keine (Store ist isoliert testbar)

### Task 9.4: E2E-Tests – Playwright

```typescript
// tests/electron/e2e/drum-machine.spec.ts
test("kompletter Drum-Machine-Workflow: Import → Pattern → Play → Export")
test("Performance-Mode öffnet sich via F12 und schließt sich via ESC")
test("Pattern-Kopieren/Einfügen zwischen Banks")

// tests/electron/e2e/sample-import.spec.ts
test("ZIP-Datei kann per Drag & Drop importiert werden")
test("Auto-Tagging erkennt 'kick' im Dateinamen")
test("BPM-Detection nach Import zeigt Wert in Sample-Details")
```

- **Dateien:**
  - tests/electron/e2e/drum-machine.spec.ts – NEU
  - tests/electron/e2e/sample-import.spec.ts – NEU
- **Success:** `pnpm test:e2e` – alle E2E-Tests grün
- **Dependencies:** App muss lauffähig sein (pnpm dev)

---

## Dependencies

- Vitest (bereits konfiguriert)
- Playwright (bereits konfiguriert)
- Web Audio API Mock für Node-Environment (AudioContext, OscillatorNode etc.)
- tRPC WebSocket für Collaborative Session (bereits installiert: @trpc/server v11)
- jszip (bereits installiert: ^3.10.1) – für ZIP-Import der Sample-Tests

## Success Criteria

- `pnpm test` → alle 84+ Unit-Tests grün (0 failures)
- `pnpm test:e2e` → alle 6+ E2E-Tests grün
- `pnpm check` → TypeScript-Kompilierung ohne Fehler
- Performance-Mode startet mit F12, Pad-Klick wechselt Pattern mit Quantisierung
- Euclidean e(3,8) ergibt in der App das Clave-Pattern
- Step mit probability=0 wird im laufenden Betrieb nie ausgelöst
