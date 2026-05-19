/**
 * Synthstudio – AudioEngine.ts  (v2)
 *
 * Erweiterte Audio-Engine:
 * - Step-Auflösung: 1/8, 1/16, 1/32 pro Pattern
 * - Per-Kanal Effektkette: Filter (LP/HP/BP) → Distortion → Compressor → Delay → Reverb → Gain → Pan
 * - Look-ahead Scheduling (16ms Interval, 100ms Look-ahead)
 * - Velocity, Pan, Pitch-Shift pro Step
 * - Metronom (Click-Track)
 * - BPM-Sync: Patterns können eigenes BPM oder globales BPM nutzen
 */

import { SynthEngine } from "./SynthEngine";
import {
  LufsAnalyzer,
  LUFS_SILENCE,
  phaseCorrelation as lufsPhaseCorrelation,
  lrImbalanceDb as lufsLrImbalanceDb,
} from "./LufsAnalyzer";
import { MidiClockOut } from "./MidiClockOut";
import { MidiNoteOut, type MidiPartConfig } from "./MidiNoteOut";
import { MidiClickOut, type MidiClickConfig } from "./MidiClickOut";
import { AudioRecorder, type RecordingResult, MAX_SIMULTANEOUS_RECORDINGS } from "./AudioRecorder";
import { LiveRecorder, type LiveRecordingResult } from "./LiveRecorder";
import { LooperEngine } from "./LooperEngine";
import type { LoopState } from "./looperUtils";
// v3.44.0 (TASK-239 Phase 1): AudioWorklet-Plugin-Host. Built-Ins werden in
// init() registriert, applyPluginSlot() wirt vom Mixer-Diff-Sync gerufen.
import {
  registerBuiltInPlugins,
  getPlugin as getPluginManifest,
} from "./PluginRegistry";
import { createPluginHost, PluginHost } from "./PluginHost";
// v3.0.0 (TASK-236-ALT): AudioContext-Low-Latency-Config (latencyHint + sampleRate)
// gelesen aus dem User-Store. Store ist Browser-pure und im Node-Test safe
// (siehe sanitize-on-load / typeof-localStorage-Guards).
import {
  getAudioEngineConfig,
  buildAudioContextOptions,
} from "../store/useAudioEngineConfigStore";
// v3.25.0: Live-Performance-Telemetrie. Pro Scheduler-Tick wird die Dauer
// gemessen und in den globalen Store gespiegelt. Kein Re-Import-Zyklus weil
// useAudioPerformanceStore nur pure-Funktionen exportiert.
import {
  recordScheduleTick as _perfRecordScheduleTick,
  updateContextLatency as _perfUpdateContextLatency,
  setSchedulerInterval as _perfSetSchedulerInterval,
} from "../store/useAudioPerformanceStore";
// v3.79.1: Sub-Mix-Bus-Routing (Audio-Wiring).
// Der Store (v3.79.0) liefert die State-Layer, AudioEngine verdrahtet Channels
// auf Bus-Gain-Nodes statt direkt zum Master.
import type { SubMixBus, SubMixState } from "../store/useSubMixStore";

// ─── Typen ────────────────────────────────────────────────────────────────────

export type StepResolution = "1/8" | "1/16" | "1/32";

// ─── Step Probability & Conditional Triggers (Phase 1) ───────────────────────

export type StepCondition =
  | { type: "always" }
  | { type: "every"; n: number; of: number }
  | { type: "fill" }
  | { type: "not_fill" };

// ─── Modulationsmatrix-Typen (Phase 6) ────────────────────────────────────────

export type ModSource =
  | { type: "lfo"; partId: string }
  | { type: "stepSeq"; partId: string; stepIndex: number }
  | { type: "midiCC"; ccNumber: number }
  | { type: "envelope"; partId: string }
  | { type: "random" };

export type ModTarget =
  | { type: "channelFx"; partId: string; param: string }
  | { type: "pitch"; partId: string }
  | { type: "volume"; partId: string }
  | { type: "pan"; partId: string };

export interface ModMatrixEntry {
  id: string;
  source: ModSource;
  target: ModTarget;
  amount: number;    // -1..+1 (bipolar)
  enabled: boolean;
}

export interface ScheduledStep {
  partIndex: number;
  stepIndex: number;
  time: number;
  velocity: number;
  pan: number;
  pitch: number;
  reverse?: boolean;
}

export type StepCallback = (step: ScheduledStep) => void;
export type PositionCallback = (currentStep: number) => void;

/** Effekt-Parameter für einen Kanal */
export interface ChannelFx {
  // Filter
  filterEnabled: boolean;
  filterType: "lowpass" | "highpass" | "bandpass" | "notch";
  filterFreq: number;      // 20–20000 Hz
  filterQ: number;         // 0.1–20
  filterGain: number;      // dB (nur für peaking/shelf)

  // Distortion
  distortionEnabled: boolean;
  distortionAmount: number; // 0–400

  // Compressor
  compressorEnabled: boolean;
  compressorThreshold: number; // -60–0 dB
  compressorRatio: number;     // 1–20
  compressorAttack: number;    // 0–1 s
  compressorRelease: number;   // 0–1 s

  // Delay
  delayEnabled: boolean;
  delayTime: number;    // 0–2 s
  delayFeedback: number; // 0–0.95
  delayMix: number;     // 0–1 (Wet-Level)

  // Reverb
  reverbEnabled: boolean;
  reverbDecay: number;  // 0.1–10 s
  reverbMix: number;    // 0–1 (Wet-Level)

  // EQ (3-Band)
  eqEnabled: boolean;
  eqLow: number;   // dB -15..+15
  eqMid: number;
  eqHigh: number;
}

/**
 * Liste aller numerisch-mappbaren FX-Parameter pro Channel mit ihrer
 * MIDI-Skala (min/max). MIDI 0-127 wird linear auf [min, max] gemappt.
 * Toggle-Params (enabled, filterType) sind hier nicht aufgeführt — die
 * werden über Button-style-Targets gebunden (>63 = an, <=63 = aus).
 *
 * v1.76 (FX-PARAM-TARGETS): MidiLearnTarget { type: "fxParam", param }
 * nutzt diesen Range-Mapping um eingehende CC-Werte korrekt zu skalieren.
 */
export interface FxParamRange {
  param: keyof ChannelFx;
  label: string;
  min: number;
  max: number;
  /** Wenn true wird der MIDI-Wert exponentiell statt linear gemappt
   *  (sinnvoll für Frequency-Param der über mehrere Oktaven läuft). */
  exponential?: boolean;
}

export const FX_PARAM_RANGES: ReadonlyArray<FxParamRange> = [
  // Filter (kein filterType — das ist enum, nicht skalierbar)
  { param: "filterFreq",          label: "Filter Cutoff",    min: 20,    max: 20000, exponential: true },
  { param: "filterQ",             label: "Filter Resonance", min: 0.1,   max: 20 },
  { param: "filterGain",          label: "Filter Gain",      min: -15,   max: 15 },
  // Distortion
  { param: "distortionAmount",    label: "Distortion Drive", min: 0,     max: 400 },
  // Compressor
  { param: "compressorThreshold", label: "Comp Threshold",   min: -60,   max: 0 },
  { param: "compressorRatio",     label: "Comp Ratio",       min: 1,     max: 20 },
  { param: "compressorAttack",    label: "Comp Attack",      min: 0,     max: 1 },
  { param: "compressorRelease",   label: "Comp Release",     min: 0,     max: 1 },
  // Delay
  { param: "delayTime",           label: "Delay Time",       min: 0,     max: 2 },
  { param: "delayFeedback",       label: "Delay Feedback",   min: 0,     max: 0.95 },
  { param: "delayMix",            label: "Delay Wet",        min: 0,     max: 1 },
  // Reverb
  { param: "reverbDecay",         label: "Reverb Decay",     min: 0.1,   max: 10 },
  { param: "reverbMix",           label: "Reverb Wet",       min: 0,     max: 1 },
  // EQ (3-Band)
  { param: "eqLow",               label: "EQ Low",           min: -15,   max: 15 },
  { param: "eqMid",               label: "EQ Mid",           min: -15,   max: 15 },
  { param: "eqHigh",              label: "EQ High",          min: -15,   max: 15 },
] as const;

export type FxParamKey =
  | "filterFreq" | "filterQ" | "filterGain"
  | "distortionAmount"
  | "compressorThreshold" | "compressorRatio" | "compressorAttack" | "compressorRelease"
  | "delayTime" | "delayFeedback" | "delayMix"
  | "reverbDecay" | "reverbMix"
  | "eqLow" | "eqMid" | "eqHigh";

/**
 * Wandelt einen MIDI-Wert (0-127) in den param-spezifischen Range um.
 * Falls `exponential` aktiv → log-scale (für filterFreq u.ä.).
 * Pure Funktion, in Tests nutzbar.
 */
export function midiValueToFxParam(midiValue: number, range: FxParamRange): number {
  const v = Math.max(0, Math.min(127, midiValue)) / 127; // 0..1
  if (range.exponential) {
    // exp-Mapping: t=0 → min, t=1 → max
    const ratio = range.max / Math.max(1e-9, range.min);
    return range.min * Math.pow(ratio, v);
  }
  return range.min + v * (range.max - range.min);
}

/** Lookup für FxParamRange by param-key. */
export function findFxParamRange(param: FxParamKey): FxParamRange | undefined {
  return FX_PARAM_RANGES.find((r) => r.param === param);
}

export const DEFAULT_CHANNEL_FX: ChannelFx = {
  filterEnabled: false,
  filterType: "lowpass",
  filterFreq: 8000,
  filterQ: 1,
  filterGain: 0,

  distortionEnabled: false,
  distortionAmount: 50,

  compressorEnabled: false,
  compressorThreshold: -24,
  compressorRatio: 4,
  compressorAttack: 0.003,
  compressorRelease: 0.25,

  delayEnabled: false,
  delayTime: 0.25,
  delayFeedback: 0.3,
  delayMix: 0.3,

  reverbEnabled: false,
  reverbDecay: 2.0,
  reverbMix: 0.3,

  eqEnabled: false,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
};

/**
 * Parameter Lock: Pro-Step FX-Override (Elektron-Stil).
 * Enthält temporäre Parameterwerte die nur für diesen Step gelten.
 */
export interface StepParamLock {
  filterFreq?: number;      // Hz
  filterQ?: number;
  volume?: number;          // 0–1 (überschreibt Part.volume nur für diesen Step)
  pan?: number;             // -1..+1
  reverbSend?: number;      // 0–1
  delaySend?: number;       // 0–1
  distortionAmount?: number;// 0–400
  pitch?: number;           // Halbtöne (überschreibt step.pitch)
}

export interface StepData {
  active: boolean;
  velocity?: number;       // 0–127
  pitch?: number;          // Halbtöne
  probability?: number;    // 0–100, default 100
  condition?: StepCondition;
  reverse?: boolean;       // Sample rückwärts abspielen
  /** Parameter Lock: überschreiben FX-Werte nur für diesen Step */
  paramLock?: StepParamLock;
  /**
   * Probability Chain: Wenn dieser Step spielt, ändert sich die Wahrscheinlichkeit
   * des nächsten Steps. "up"=+25%, "down"=-25%, "none"=keine Änderung.
   */
  chainNext?: "up" | "down" | "none";
  /**
   * Note-Länge als Vielfaches eines Steps (0.25=1/4, 0.5=1/2, 1=ein Step, 2=zwei Steps).
   */
  length?: number;
  /**
   * v2.14: TB-303-Slide. Wenn true, gleitet die aktuelle Synth-Note tonal vom
   * zuletzt getriggerten Step desselben Parts auf die aktuelle Pitch-Frequenz
   * (Portamento). Wirkt nur für Synth-Parts (sourceType wavetable/fm) –
   * Sample-Parts ignorieren das Flag.
   */
  slide?: boolean;
}

/**
 * Externe Audio-Datei als Mixer-Channel (Vocals, Songs zum Remixen).
 * Persistierung erfolgt als Pfad-Referenz im .synth-Projekt.
 *
 * Routing: Source → channelNodes[id].input → existierende FX-Chain → master
 * BPM-Sync: nur über `AudioBufferSourceNode.playbackRate` (Pitch+Tempo gekoppelt).
 */
export interface AudioTrackChannelData {
  /** Eindeutige ID. Konvention: "audiotrack:" Prefix. Engine erzwingt es nicht. */
  id: string;
  name: string;
  /** Absoluter Pfad (Electron) oder Dateiname (Browser). */
  filePath: string;
  fileName: string;
  fileSize?: number;
  /** 0..2 */
  volume: number;
  /** -1..+1 */
  pan: number;
  muted: boolean;
  soloed: boolean;
  sends: { reverb: number; delay: number };
  /** Wo im Sample der Track beginnen soll (Sekunden ab Buffer-Anfang). */
  startOffsetSec?: number;
  loop?: boolean;
  /**
   * "free"        = unabhängig vom Transport-BPM (playbackRate=1).
   * "stretch"     = playbackRate = bpm/originalBpm (Pitch+Tempo gekoppelt, DJ-Pitch).
   * "timestretch" = Pitch-erhaltender Time-Stretch via AudioWorklet (OLA),
   *                 Tempo folgt BPM, Pitch bleibt konstant. Teurer auf der CPU.
   */
  syncMode?: "free" | "stretch" | "timestretch";
  originalBpm?: number | null;
  /**
   * v3.52.0: Manueller Stretch-Faktor unabhängig vom BPM-Sync (0.25..4.0).
   * Wirkt MULTIPLIKATIV zur BPM-Sync-Rate (für "stretch"/"timestretch"). Bei
   * `syncMode === "free"` ist `stretchRatio` die einzige Quelle der Rate.
   * Default 1.0 (= keine Veränderung). `autoWarpToBpm` setzt diesen Wert
   * direkt auf `projectBpm / bpmHint` für tap-and-warp Workflows.
   */
  stretchRatio?: number;
  /**
   * v3.52.0: Wenn true, wird der Track via Pitch-erhaltendem AudioWorklet-OLA
   * abgespielt (unabhängig von `syncMode`). False → klassischer Resample-Pfad
   * (CPU-günstig, Pitch+Tempo gekoppelt). Greift nur wenn die effektive Rate
   * != 1.0 ist. Default false.
   */
  pitchLocked?: boolean;
  /**
   * v3.52.0: User-eingegebenes Original-BPM des Samples (für Auto-Warp via
   * `autoWarpToBpm`). Bewusst separat von `originalBpm` (= BPM-Sync) gehalten
   * damit man "Tap-BPM-Hint" setzen kann ohne sofort den Track-Tempo-Sync zu
   * aktivieren. Bei undefined: autoWarp fällt auf `originalBpm` zurück.
   */
  bpmHint?: number;
  /**
   * v3.70.0: Loop-Engine-Wiring (closes v3.67-Caveat — Loop-Marker waren
   * visual-only). Wenn `loopEnabled === true` UND `loopStartSample`/
   * `loopEndSample` gesetzt sind, wird die Engine im Continuous-Loop-Mode
   * zwischen loopStart und loopEnd zirkulieren (AudioBufferSourceNode.loop
   * + loopStart/loopEnd in Sekunden). Bei `loopEnabled === false`
   * werden die Sample-Indizes weiter persistiert (UI-Zustand) — die Engine
   * ignoriert sie aber. Bei loopEnabled=true ohne valid loopPoints fällt
   * der Code auf eine sichere Default-Range zurück (komplette Buffer-Länge).
   */
  loopEnabled?: boolean;
  /** v3.70.0: Loop-Start-Sample (≥0, < loopEndSample). null = unset. */
  loopStartSample?: number | null;
  /** v3.70.0: Loop-End-Sample (> loopStartSample, ≤ buffer.length). null = unset. */
  loopEndSample?: number | null;
  /**
   * v3.72.0: Loop-Boundary Crossfade in Millisekunden (0..200). 0 = hard cut
   * (backward-compat zu v3.70/v3.71). > 0 = smooth fade-out vor loopEnd +
   * fade-in nach loopStart mit equal-power-Kurve (cos/sin). Verhindert die
   * Click/Pop-Artefakte beim AudioBufferSourceNode-Loop-Wrap (interner
   * harter Cut wenn loopStart/End nicht auf Zero-Crossings liegen).
   *
   * Implementation:
   *   - BufferSource-Pfad: zusätzlicher GainNode in der Chain (source → xfade
   *     → channelNodes.input). setValueCurveAtTime mit periodischer Hann-
   *     Window-artigen Hüllkurve, geplant pro Loop-Cycle für die nächsten
   *     ~LOOP_XFADE_SCHEDULE_COUNT Cycles. Auto-rescheduled wenn der Track
   *     weiterläuft.
   *   - Worklet-Pfad: TimeStretchProcessor liest crossfadeSamples aus der
   *     setLoop-Message und mischt am Boundary intern (read-ahead aus
   *     loopStart + Sum mit fading source).
   *
   * Clamp: NaN/Infinity/negative → 0. > 200 → 200 (Sane-Default damit
   * Crossfade nicht länger als die kürzeste sinnvolle Loop wird).
   * Falls crossfadeMs > (loopRange / 2) zur Laufzeit: Engine clampt auf
   * loopRange / 2 für diesen einen Track (defensive — kein Double-Wrap).
   */
  loopCrossfadeMs?: number;
  /**
   * v3.74.0: Channel-Strip Color-Coding (closes v3.73-Caveat —
   * AudioTrack-Strips fehlte Color-Coding). User-defined Hex-Farbe
   * ("#RRGGBB" oder "#RGB"), lowercase. Wenn nicht gesetzt, fällt die
   * UI auf den zyklischen Palette-Default zurück (resolveChannelColor
   * in utils/channelColors). Additiv-optional — Pre-v1.29-Files laden
   * unverändert (color bleibt undefined).
   *
   * KEINE Engine-seitigen Side-Effects — color ist rein visueller State,
   * beeinflusst keine Audio-Pfade.
   */
  color?: string;
}

export interface PartData {
  id: string;
  name: string;
  sampleUrl?: string;
  /** Anzeigename des zugewiesenen Samples (z.B. Dateiname ohne Pfad) */
  sampleName?: string;
  muted: boolean;
  soloed: boolean;
  volume: number;      // 0–1
  pan: number;         // -1..+1
  /** Step-Auflösung für diesen Kanal (überschreibt Pattern-Default) */
  stepResolution?: StepResolution;
  /**
   * Eigene Loop-Länge in Steps (1–32, Polymeter).
   * Wenn gesetzt, loopt der Part nach `stepLength` Steps zurück – unabhängig
   * von pattern.stepCount. Ungesetzt = Pattern-Default verwenden.
   */
  stepLength?: number;
  steps: StepData[];
  fx: ChannelFx;
  /** Quelle des Sounds – Sample, Synthesizer oder Granular */
  sourceType?: "sample" | "wavetable" | "fm" | "granular";
  /** Synthesizer-Parameter (wavetable / fm) */
  synthParams?: import("./SynthEngine").SynthParams;
  /** Granular-Parameter (granular mode) */
  granularParams?: import("./GranularEngine").GranularParams;
  /** Time-Stretch Faktor (1.0 = Original, 2.0 = doppelt so lang) */
  stretchRatio?: number;
  /**
   * Micro-Timing: Zeitlicher Offset in ms (−50..+50).
   * Negativ = vor dem Beat (anticipated), Positiv = hinter dem Beat (laid back).
   */
  microTiming?: number;
  /**
   * v3.73.0: Channel-Strip Color-Coding (Mixer + DrumMachine).
   * User-defined Hex-Farbe ("#RRGGBB" oder "#RGB"), lowercase. Wenn nicht
   * gesetzt, fällt die UI auf den zyklischen Palette-Default zurück
   * (resolveChannelColor in utils/channelColors). Additiv-optional —
   * Pre-v1.28-Files laden unverändert (color bleibt undefined).
   */
  color?: string;
}

export type FollowActionType = "none" | "next" | "prev" | "random" | "specific";

export interface FollowAction {
  type: FollowActionType;
  /** Für type "specific": Ziel-Pattern-ID */
  targetId?: string;
  /** Nach wie vielen Bars die Action ausgelöst wird (1–16) */
  barsBeforeSwitch: number;
}

export interface PatternData {
  id: string;
  name: string;
  stepCount: 16 | 32 | 64;
  /** Standard-Step-Auflösung für alle Parts (kann pro Part überschrieben werden) */
  stepResolution: StepResolution;
  /** Eigenes BPM (null = globales BPM verwenden) */
  bpm: number | null;
  parts: PartData[];
  /** Follow Action: automatischer Wechsel nach N Bars */
  followAction?: FollowAction;
  /**
   * BPM-Verhältnis relativ zum globalen BPM (z.B. 2.0 = Doppeltempo, 0.5 = Halbtempo).
   * Wenn gesetzt, überschreibt dies `bpm` und skaliert das globale BPM.
   * null/undefined = verwende `bpm` oder globales BPM.
   */
  bpmRatio?: number | null;
  /** Anzahl Bars für sanfte BPM-Transition beim Wechsel zu diesem Pattern */
  bpmTransitionBars?: number;
}

// ─── Audio-Knoten pro Kanal ───────────────────────────────────────────────────

interface ChannelNodes {
  input: GainNode;
  eq: { low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode };
  filter: BiquadFilterNode;
  distortion: WaveShaperNode;
  compressor: DynamicsCompressorNode;
  delayNode: DelayNode;
  delayFeedback: GainNode;
  delayDry: GainNode;
  delayWet: GainNode;
  reverbConvolver: ConvolverNode;
  reverbDry: GainNode;
  reverbWet: GainNode;
  output: GainNode;
  panner: StereoPannerNode;
  /** Sidechain ducking gain – zwischen panner und master geschaltet */
  sidechainGain: GainNode;
  // Global-Bus Sends
  globalReverbSend: GainNode;
  globalDelaySend: GainNode;
}

/**
 * v3.86.0 / v3.88.0: Pro-Sub-Mix-Bus Audio-Nodes.
 *
 * Routing-Order (input → output) — v3.88.0 inserts postGain zwischen compMix
 * und gain:
 *   input → eqLow → eqMid → eqHigh → compIn
 *     → compressor → compWet ──┐
 *                              ├→ compMix → postGain → gain (volume·solo) → panner → master
 *     → compDry ───────────────┘
 *
 *   gain → reverbSend → global-reverb-bus
 *   gain → delaySend  → global-delay-bus
 *
 * EQ-Bypass: wenn fx.enabled=false werden die EQ-Bänder auf 0dB Gain
 * gefahren (Pfad bleibt verkabelt, Audio passt aber transparent durch).
 *
 * Compressor-Bypass (fx.compressor.enabled=false): compWet=0 + compDry=1
 * (kein disconnect, click-frei via setTargetAtTime).
 *
 * postGain (v3.88.0): linear 0..2, wirkt vor dem Volume-Fader (also vor
 * Mute/Solo-Multiplikation). Default = 1.0 (transparent). Sends zweigen
 * weiterhin POST-bus.gain ab — postGain skaliert sie damit indirekt nur über
 * den dazwischenliegenden gain-Faktor.
 */
export interface SubMixBusNodes {
  /** Channel-Output landet hier — Multi-Source-Tap. */
  input: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  compIn: GainNode;
  compressor: DynamicsCompressorNode;
  compWet: GainNode;
  compDry: GainNode;
  compMix: GainNode;
  /**
   * v3.88.0: Post-Comp-Gain-Trim, wirkt ZWISCHEN compMix und gain.
   * Skaliert linear 0..2 via bus.fx.postGain. NICHT in der Sends-Kette —
   * Reverb-/Delay-Sends zweigen weiterhin post-`gain` ab.
   */
  postGain: GainNode;
  /** Post-FX Volume + Solo/Mute-Multiplikator. */
  gain: GainNode;
  panner: StereoPannerNode;
  reverbSend: GainNode;
  delaySend: GainNode;
  /** Memo der zuletzt applied volume (Solo-Logik kommt vom Store-Snapshot). */
  volume: number;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class AudioEngineClass {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _outputAnalyser: AnalyserNode | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private loadingPromises = new Map<string, Promise<AudioBuffer | null>>();
  private channelNodes = new Map<string, ChannelNodes>();
  /** targetPartId → SidechainSettings */
  private _sidechainSettings = new Map<string, { enabled: boolean; sourcePartId: string | null; amount: number; attack: number; release: number }>();
  /** Aktive Granular Engines pro Part */
  private _granularEngines = new Map<string, import("./GranularEngine").GranularEngine>();
  private reverbBuffers = new Map<string, AudioBuffer>(); // decay → buffer
  /**
   * Lazy SynthEngine-Instanz für Macro-LFO-Cache (TASK-117).
   * Wird beim ersten Aufruf von setPartLfo* erzeugt, damit AudioEngine
   * vor `init()` keine AudioContext-Pflicht hat. Persistenter Wertespeicher
   * pro Part-ID — bestehende Step-Trigger-Sites können später
   * `getPartLfoRate/Depth` lesen und auf `synthParams` mappen.
   */
  private _synthEngine: SynthEngine | null = null;

  /**
   * v2.14 (TB-303-Slide): Pro Part die zuletzt getriggerte Frequenz + ob der
   * vorherige Step `slide=true` hatte. Wird im Synth-Trigger ausgewertet damit
   * der nächste Note-On bei aktivem Slide vom alten Pitch herangleitet.
   */
  private _partSlideState = new Map<string, { lastFreq: number; lastHadSlide: boolean }>();

  // ─── Audio-Track Channels (externe Dateien: Vocals/Songs) ──────────────────
  private audioTrackSources = new Map<string, AudioBufferSourceNode>();
  private audioTrackBuffers = new Map<string, AudioBuffer>();
  /** Zeitpunkt zu dem ein Track gestartet wurde + sein offset im Buffer. */
  private audioTrackStartTimes = new Map<string, { ctxStart: number; offsetSec: number }>();
  /** Aktive rAF-IDs für Position-Updates. */
  private audioTrackPositionRaf = new Map<string, number>();
  private audioTrackPositionListeners = new Map<string, Set<(pos01: number, sec: number) => void>>();
  private audioTrackEndedListeners = new Map<string, Set<() => void>>();
  /** Track-Metadaten (für playAllRegisteredAudioTracks + setBpm sync). */
  private audioTrackData = new Map<string, AudioTrackChannelData>();
  /** Externer Getter (Store) – primäre Quelle für playAllRegisteredAudioTracks. */
  private audioTracksGetter: (() => AudioTrackChannelData[]) | null = null;
  /**
   * Pitch-preserving Worklet-Nodes pro Track (syncMode="timestretch").
   * Wenn ein Track Worklet-basiert läuft, gibt es KEINE AudioBufferSourceNode
   * in audioTrackSources für diesen Track — Helpers prüfen beide Maps.
   */
  private audioTrackWorkletNodes = new Map<string, AudioWorkletNode>();
  /** Letzte gemeldete Sample-Position pro Worklet-Track (für Playhead-rAF). */
  private audioTrackWorkletPositions = new Map<string, number>();
  /**
   * v3.72.0: Crossfade-GainNode pro Track (BufferSource-Pfad). Sitzt in der
   * Chain source → xfadeGain → channelNodes.input. Wird nur erzeugt wenn
   * loopCrossfadeMs > 0 + loopEnabled + valid range. Mit periodisch
   * scheduled setValueCurveAtTime-Hüllkurve am Loop-Boundary.
   */
  private audioTrackXfadeGains = new Map<string, GainNode>();
  /** v3.72.0: Bookkeeping für rescheduling der Crossfade-Hüllkurve. */
  private audioTrackXfadeMeta = new Map<string, {
    /** Wann der nächste Schedule-Pass nötig ist (ctx.currentTime in Sekunden). */
    nextScheduleAt: number;
    /** Loop-Period in Sekunden (auf playbackRate normalisiert). */
    loopPeriodSec: number;
    /** Anzahl der bereits scheduled cycles seit start. */
    scheduledCount: number;
  }>();

  // ─── Cross-Store Solo (FOLLOWUP-102 / B) ───────────────────────────────────
  /**
   * Externer Flag-Getter aus dem Drum-Store: liefert true wenn mindestens
   * ein Drum-Part im aktiven Pattern soloed ist. Wird im Mixer-Solo-Pfad
   * konsultiert damit Audio-Tracks bei Drum-Solo mit-stummgeschaltet werden.
   * Default null = backward-kompatibel (nur audio-track-internes Solo wirkt).
   */
  private drumSoloFlagGetter: (() => boolean) | null = null;

  // Global Send Buses
  private _globalReverbBus: ConvolverNode | null = null;
  private _globalReverbWet: GainNode | null = null;
  /** v3.75.0: Pre-Delay (DelayNode) vor dem Convolver — User-konfigurierbar 0..200ms. */
  private _globalReverbPreDelay: DelayNode | null = null;
  /** v3.75.0: Damping (Lowpass-Biquad) zwischen Pre-Delay und Convolver. */
  private _globalReverbDamping: BiquadFilterNode | null = null;
  /** v3.75.0: Aktuelle Reverb-Settings (für IR-Regeneration bei decay/damping-Change). */
  private _globalReverbDecay = 2.0;
  private _globalReverbDamping01 = 0.5;
  private _globalReverbBypass = false;
  private _globalReverbWetLevel = 0.6;
  private _globalDelayBus: DelayNode | null = null;
  private _globalDelayFeedback: GainNode | null = null;
  private _globalDelayWet: GainNode | null = null;
  /** v3.75.0: Aktueller Delay-Bypass-Flag. */
  private _globalDelayBypass = false;
  private _globalDelayWetLevel = 0.5;
  // ─── Master EQ (v3.75.0) ───────────────────────────────────────────────────
  /** Master-EQ: Low-Shelf → Peak-Mid → High-Shelf zwischen masterGain und destination. */
  private _masterEqLow: BiquadFilterNode | null = null;
  private _masterEqMid: BiquadFilterNode | null = null;
  private _masterEqHigh: BiquadFilterNode | null = null;
  private _masterEqBypass = false;
  private _masterEqLowGain = 0;
  private _masterEqMidGain = 0;
  private _masterEqHighGain = 0;
  /** v3.76.0: Peak Mid-Band Q-Faktor (0.3..10), default 0.7. */
  private _masterEqMidQ = 0.7;

  // ─── Master Limiter (v3.76.0 → v3.77.0) ────────────────────────────────────
  /**
   * v3.77.0: Limiter-Routing mit Lookahead (DelayNode 5ms vor dem
   * Compressor) + parallel Wet/Dry-Pfad für No-Click-Bypass-Crossfade.
   *
   * Routing (statisch, beide Pfade bleiben permanent verbunden):
   *   eqHigh ──► lookahead(5ms) ──► limiter ──► limiterGain ──► wetGain ─┐
   *           └► dryGain ───────────────────────────────────────────────┴► destination
   *
   * Bypass via Crossfade (20ms): bei bypass=true rampt wetGain→0 und
   * dryGain→1; bei bypass=false umgekehrt. Vermeidet Click-Artefakte aus
   * den vorherigen disconnect/reconnect-Switches (v3.76).
   *
   * Lookahead-Strategy (Simple, v3.77): DelayNode VOR dem Compressor mit
   * 5ms Verzögerung + Compressor-Attack auf 0.001s (effektiv 1ms). Der
   * Compressor sieht das Signal 5ms nach der eqHigh-Position; die
   * Gain-Reduction reagiert damit "rückwirkend" auf Transienten die ein
   * paralleler Detection-Pfad sehen würde — der Audio-Pfad selbst hat den
   * gleichen 5ms-Vorlauf zwischen "Signal sichtbar" und "Reaktion an der
   * Destination". Eine vollständige sidechain-split Implementation (Audio
   * delayed + Detection ungedelayed mit eigenem Gain-Param) ist für v3.78
   * vorgesehen, falls Transient-Rejection messbar besser sein muss.
   *
   * Closes v3.76 Caveats: "Lookahead fehlt → harte Transienten rutschen
   * durch", "Bypass-Toggle klickt", "Make-Up-Gain UI in linear statt dB".
   */
  private _masterLimiter: DynamicsCompressorNode | null = null;
  private _masterLimiterGain: GainNode | null = null;
  /** v3.77.0: 5ms Lookahead vor dem Compressor. */
  private _masterLimiterLookahead: DelayNode | null = null;
  /** v3.77.0: Wet-Path-Gain (Limiter-Ausgang × wetGain → destination). */
  private _masterLimiterWet: GainNode | null = null;
  /** v3.77.0: Dry-Path-Gain (eqHigh direkt × dryGain → destination, für Bypass). */
  private _masterLimiterDry: GainNode | null = null;
  private _masterLimiterBypass = false;
  private _masterLimiterMakeup = 1.0;

  /**
   * v3.77.0: Lookahead-Zeit für den Master-Limiter in Sekunden. 5ms ist
   * ein Sweet-Spot — niedrig genug um Latenz nicht hörbar zu machen,
   * hoch genug um snare-/kick-Transienten erkennbar zu reduzieren.
   */
  private readonly MASTER_LIMITER_LOOKAHEAD_SEC = 0.005;
  /** v3.77.0: Bypass-Crossfade-Zeit in Sekunden (20ms). */
  private readonly MASTER_LIMITER_BYPASS_CROSSFADE_SEC = 0.02;

  // ─── LUFS-Meter (v3.78.0, ITU-R BS.1770-4) ────────────────────────────────
  /**
   * v3.78.0: LUFS-Meter am post-master-FX-Tap.
   *
   * Routing: Wet/Dry-Gains konnektieren parallel zu ctx.destination UND zu
   * `_lufsAnalyserNode` (Web-Audio-AnalyserNode mit fftSize=2048). Wir
   * pollen alle 100ms `getFloatTimeDomainData(...)`, übergeben den Block
   * an den pure-TS `_lufsAnalyzer` der die K-weighted Filter + Block-
   * Aggregation macht.
   *
   * Polling-Loop läuft solang der LUFS-Tap aktiv ist (lazy gestartet beim
   * ersten `getLufsSnapshot()`-Call). `reset()` setzt nur den Integrated-
   * Akku zurück — gleitende Momentary/Short-Term-Werte bleiben hängen am
   * Audio-Stream.
   *
   * Caveats:
   *   - AnalyserNode liefert 1-channel-tap (DownMix). Für true-stereo LUFS
   *     bräuchten wir zwei separate AnalyserNodes oder einen
   *     AudioWorkletNode. Mono-LUFS ist akzeptabel da Synthstudio-Output
   *     primär als Stereo-Sum gemastert wird.
   *   - 100ms-Polling ist ein Trade-off: häufiger = mehr CPU, seltener =
   *     Lücken im Stream. Bei 48kHz fftSize=2048 deckt ein Read 42.6ms ab,
   *     mit 100ms-Polling überlappen wir ~60ms. Spec sagt nicht
   *     "alle Samples müssen gesehen werden" — wir mitteln über das was
   *     wir bekommen.
   */
  private _lufsAnalyser: LufsAnalyzer | null = null;
  /**
   * v3.78: Mono-AnalyserNode (downmix). Bleibt fuer Mock-AudioContext
   * ohne ChannelSplitter weiterhin als Fallback erhalten.
   */
  private _lufsAnalyserNode: AnalyserNode | null = null;
  /**
   * v3.101.0: True-Stereo-Tap via ChannelSplitter — zwei AnalyserNodes
   * (links + rechts). Wenn beide gesetzt sind, hat der Polling-Loop
   * Vorrang vor dem Mono-Fallback und ruft `processBlock(L, R)` mit
   * separaten L/R-Buffers (echtes BS.1770-4 Stereo-K-weighting).
   */
  private _lufsSplitter: ChannelSplitterNode | null = null;
  private _lufsAnalyserNodeL: AnalyserNode | null = null;
  private _lufsAnalyserNodeR: AnalyserNode | null = null;
  private _lufsScratchBufferR: Float32Array | null = null;
  private _lufsPollingTimer: ReturnType<typeof setInterval> | null = null;
  private _lufsScratchBuffer: Float32Array | null = null;
  /** Polling-Intervall in ms (Task-Spec: 10Hz). */
  private readonly LUFS_POLL_INTERVAL_MS = 100;

  // ─── Sub-Mix-Buses (v3.79.1) ──────────────────────────────────────────────
  /**
   * v3.79.1 / v3.86.0: Sub-Mix-Bus Audio-Wiring + volle FX-Chain.
   *
   * v3.79.0 hat den State (useSubMixStore) + Schema (v1.32). v3.79.1
   * verdrahtete das Routing initial:
   *
   *   channelOutput (sidechainGain) → busGain(volume·soloFactor) →
   *     busPanner(pan) → masterGain
   *
   * v3.86.0 erweitert auf volle FX-Chain analog Channel-FX:
   *
   *   channelOutput → bus.input → bus.eqLow → bus.eqMid → bus.eqHigh →
   *     bus.compIn → [compressor] / [compDry] (Wet/Dry-Crossfade) →
   *     bus.compMix → bus.gain (volume·soloFactor) →
   *     bus.panner → masterGain
   *
   *   bus.gain → bus.reverbSend → global-reverb-bus (via _globalReverbPreDelay)
   *   bus.gain → bus.delaySend  → global-delay-bus
   *
   * Channels ohne `subMixBusId` routen weiter direkt in `masterGain`
   * (Default-Verhalten, backward-compat).
   *
   * Solo-Logik: anyBusSolo → andere Buses bekommen gain=0 (Bus-Gain
   * gemultiplext mit einem effective-mute-Faktor in `applySubMixBus`).
   * Mute analog: gain.value = 0. Beides ohne disconnect — der Pfad bleibt
   * permanent verkabelt, nur der Pegel wird auf 0 gerampt.
   *
   * Compressor-Bypass: Wet/Dry-Crossfade via 2 GainNodes (compWet/compDry).
   * Kein disconnect, keine Clicks. `enabled` toggle't compWet=1+compDry=0
   * bzw. compWet=0+compDry=1.
   */
  private _subMixBusNodes = new Map<string, SubMixBusNodes>();
  /** Mapping partId → busId. Channels ohne Eintrag routen direkt in master. */
  private _channelSubMixAssignments = new Map<string, string>();
  /** Smoothing-Konstante (ms*1e-3) für Bus-Gain-Rampe (no-click). */
  private readonly SUB_MIX_BUS_RAMP_SEC = 0.02;

  // Scheduling
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  // Sammelt pending Position-Callback-Timeouts, damit stop() sie aufräumen kann
  private _pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly LOOK_AHEAD = 0.1;
  private readonly SCHEDULE_INTERVAL = 16;
  /**
   * v3.0.0 (TASK-236-ALT, MIDI-Clock-Lead): MIDI-Clock-Tick-Lookahead.
   * Bis v2.99 wurde der Step-Lookahead (100ms) auch für Clock-Ticks genutzt.
   * 50ms reduzieren die Vor-Latenz zum externen Empfänger spürbar — die
   * Drift-Robustheit bleibt erhalten weil `MidiClockOut.scheduleTicks`
   * den Tick-Cursor unabhängig vom Wallclock-`now` fortschreibt
   * (siehe `planTicks`). Tatsächliche Drift bei 50 ms Lookahead und 16 ms
   * Schedule-Interval: < 1 Tick (~20 ms bei 120 BPM). Revert auf 100 ms
   * wenn externe Empfänger (Volca/Digitakt) Jitter melden.
   */
  private readonly MIDI_CLOCK_LOOK_AHEAD = 0.05;

  /**
   * MIDI-Clock-Out (TASK-230 / v2.83.0). 24 PPQN Tick-Generator + Transport-
   * Realtime-Messages. Sender wird per `setMidiClockOutSender()` injiziert
   * (typisch vom useMidi-Hook). Default: kein Sender = no-op.
   */
  private _midiClockOut = new MidiClockOut(null);

  /**
   * MIDI-Note-Out (TASK-240 / v2.92.0). Per-Part Note-On/Off-Generator für
   * externe Sample-Engines (z.B. KORG Electribe als Sound-Modul). Sender
   * wird per `setMidiNoteOutSender()` injiziert. Pro Part wird via
   * `setMidiNoteOutPartConfig()` ein Output/Channel/Note-Mapping gesetzt.
   */
  private _midiNoteOut = new MidiNoteOut(null);

  /**
   * MIDI-Click-Out (v3.98.0). Sendet pro Beat eine Note an externe Hardware
   * fuer Metronom-Sync (KORG Volca, Drum-Machine). Sender wird per
   * `setMidiClickOutSender()` injiziert. Config via `setMidiClickOutConfig()`.
   */
  private _midiClickOut = new MidiClickOut(null);

  /**
   * v3.99.0: Note-Duration fuer MIDI-Click-Out (ms). Wird beim triggerStep
   * an _midiClickOut.triggerStep(..., noteDurationMs) durchgereicht. Default 50.
   */
  private _midiClickNoteDurationMs = 50;

  /**
   * v3.99.0: Count-In Pre-Roll Konfiguration.
   *
   * Wenn `_countInEnabled === true` und `play()` aufgerufen wird, wird vor
   * dem eigentlichen Pattern-Start ein "stiller" Pre-Roll von N Bars
   * geschaltet — nur Click-Triggers (lokal + MIDI-Click-Out), kein
   * Pattern-Audio. UI bekommt pro Beat ein `countin:tick` CustomEvent
   * (remaining-Beats), sodass DAW-Style Countdown angezeigt werden kann.
   *
   * Strategie: `play()` plant pro Pre-Roll-Beat ein setTimeout (Click +
   * UI-Event); nach dem letzten Beat startet die normale Scheduler-Schleife.
   * Bei `stop()` waehrend Pre-Roll werden alle Pre-Roll-Timeouts gecleart.
   */
  private _countInEnabled = false;
  private _countInBars = 1;
  /** Pending setTimeout-IDs des Pre-Rolls — wird in stop() abgeraeumt. */
  private _preRollTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();
  /** True solange Pre-Roll laeuft (zwischen play()-Call und erstem Pattern-Step). */
  private _preRollActive = false;

  // ─── MIDI-Clock-IN External-Sync (v3.35.0) ────────────────────────────────
  //
  // Wenn `_externalSyncActive === true`, akzeptiert die Engine externe
  // Tempo-Updates per `applyExternalBpm()` und ignoriert manuelle BPM-Slider-
  // Inputs auf der Settings-/UI-Seite. Start/Stop-Trigger kommen ebenfalls
  // von außen — entweder über `play()/stop()`-Calls die der useMidi-Hook auf
  // 0xFA/0xFC einstellt, oder direkt via `externalStart()/externalStop()`.
  //
  // Diese State-Variable spiegelt das User-Toggle in MidiSettings wider; die
  // tatsächliche MidiClockIn-Instanz lebt im useMidi-Hook.
  private _externalSyncActive = false;

  // Transport
  private _isPlaying = false;
  private _bpm = 120;
  private _steps = 16;
  private _currentStep = 0;
  /**
   * v3.37.0: SPP-driven pending-start-position. Wird von `seekToStep`
   * gesetzt und von `play()` konsumiert (oder ignoriert wenn explizit ein
   * fromStep-Parameter übergeben wurde). null = kein Pending-Seek.
   */
  private _pendingStartStep: number | null = null;
  private _nextStepTime = 0;
  private _stepResolution: StepResolution = "1/16";

  // Callbacks
  private stepCallbacks: StepCallback[] = [];
  private positionCallbacks: PositionCallback[] = [];
  private patternGetter: (() => PatternData) | null = null;
  private patternSwitchCallback: ((patternId: string) => void) | null = null;
  private melodicGetter: ((partId: string) => { active: boolean; note: number; velocity: number }[] | undefined) | null = null;

  // Global Transpose (Halbtöne, -24..+24) – wird auf melodische Trigger angewendet
  private _globalTranspose = 0;

  // Probability / Fill state (Phase 1)
  private loopCount = 0;
  private isFillActive = false;
  /** Probability-Chain-Modifikatoren pro Part+Step (partId:stepIdx → offset) */
  private _probabilityChainMods = new Map<string, number>();

  // Performance Mode – Queued Pattern Switch (Phase 4)
  private queuedPatternId: string | null = null;
  private quantizeMode: "bar" | "beat" | "step" = "bar";

  // Metronom
  private _metronomEnabled = false;
  private _metronomGain = 0.5;
  private _metronomAccent = 1.0;
  private _metronomDownbeatFreq = 1200;
  private _metronomBeatFreq = 800;
  private _metronomBeatsPerBar = 4;
  private _metronomOscType: OscillatorType = "sine";
  private _metronomSubdivision: "beat" | "eighth" | "sixteenth" = "beat";

  get isPlaying() { return this._isPlaying; }
  get bpm() { return this._bpm; }
  get currentStep() { return this._currentStep; }

  async init(): Promise<void> {
    if (this.ctx) return;
    // v3.0.0 (TASK-236-ALT): AudioContext mit latencyHint + (optional) sampleRate
    // aus dem User-Config-Store erzeugen. Browser-Default ohne Options =
    // 'balanced' → auf Windows ~30-50ms; mit 'interactive' → ~10-20ms.
    // Wenn der Browser die Options nicht akzeptiert (sehr alte Engines),
    // fallback auf zero-arg-Ctor — Web-Audio-Spec garantiert das.
    try {
      const opts = buildAudioContextOptions(getAudioEngineConfig());
      this.ctx = new AudioContext(opts);
    } catch {
      this.ctx = new AudioContext();
    }
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;

    // v3.75.0: Master-EQ-Chain zwischen masterGain und destination.
    // v3.76.0: NEU Master-Limiter (DynamicsCompressor) am Ende der Chain.
    // Routing: masterGain → eqLow → eqMid → eqHigh → limiter → limiterGain → destination
    // 3 BiquadFilter (lowshelf / peaking / highshelf). Gain-defaults = 0dB
    // (kein hörbarer Einfluss), Frequenzen aus DEFAULT_MASTER_EQ.
    this._masterEqLow = this.ctx.createBiquadFilter();
    this._masterEqLow.type = "lowshelf";
    this._masterEqLow.frequency.value = 250;
    this._masterEqLow.gain.value = 0;
    this._masterEqMid = this.ctx.createBiquadFilter();
    this._masterEqMid.type = "peaking";
    this._masterEqMid.frequency.value = 1000;
    this._masterEqMid.Q.value = this._masterEqMidQ;
    this._masterEqMid.gain.value = 0;
    this._masterEqHigh = this.ctx.createBiquadFilter();
    this._masterEqHigh.type = "highshelf";
    this._masterEqHigh.frequency.value = 4000;
    this._masterEqHigh.gain.value = 0;

    // v3.76.0 → v3.77.0: Limiter (brick-wall Preset) mit 5ms Lookahead
    // (DelayNode vor dem Compressor) und parallel Wet/Dry-Pfad für
    // No-Click-Bypass-Crossfade.
    this._masterLimiter = this.ctx.createDynamicsCompressor();
    this._masterLimiter.threshold.value = -1;
    this._masterLimiter.knee.value      = 0;
    this._masterLimiter.ratio.value     = 20;
    // v3.77.0: Attack auf 1ms reduziert (war 3ms) — zusammen mit 5ms
    // Lookahead-Delay vor dem Compressor entspricht die Reaktion ~6ms
    // "Vorlauf" über die Audio-Sample-Position an der Destination.
    this._masterLimiter.attack.value    = 0.001;
    this._masterLimiter.release.value   = 0.05;
    this._masterLimiterGain = this.ctx.createGain();
    this._masterLimiterGain.gain.value  = 1.0;
    // v3.77.0: Lookahead-Delay vor dem Limiter (5ms). Max-Delay-Headroom
    // 0.02s damit eine spätere v3.78-Erhöhung auf bis zu 20ms ohne neue
    // Node-Allokation möglich bleibt.
    this._masterLimiterLookahead = this.ctx.createDelay(0.02);
    this._masterLimiterLookahead.delayTime.value = this.MASTER_LIMITER_LOOKAHEAD_SEC;
    // v3.77.0: Wet/Dry-Crossfade-Pfad. Beide Gains werden konstant
    // konnektiert — Bypass-Switch nur via setTargetAtTime / Curve auf gain.
    this._masterLimiterWet = this.ctx.createGain();
    this._masterLimiterWet.gain.value = 1.0;
    this._masterLimiterDry = this.ctx.createGain();
    this._masterLimiterDry.gain.value = 0.0;

    this.masterGain.connect(this._masterEqLow);
    this._masterEqLow.connect(this._masterEqMid);
    this._masterEqMid.connect(this._masterEqHigh);
    // v3.77.0 Wet-Path: eqHigh → lookahead → limiter → limiterGain → wetGain → destination
    this._masterEqHigh.connect(this._masterLimiterLookahead);
    this._masterLimiterLookahead.connect(this._masterLimiter);
    this._masterLimiter.connect(this._masterLimiterGain);
    this._masterLimiterGain.connect(this._masterLimiterWet);
    this._masterLimiterWet.connect(this.ctx.destination);
    // v3.77.0 Dry-Path: eqHigh → dryGain → destination (parallel).
    this._masterEqHigh.connect(this._masterLimiterDry);
    this._masterLimiterDry.connect(this.ctx.destination);

    // v3.78.0 → v3.101.0: LUFS-Meter-Tap am post-master-FX-Punkt.
    // v3.101.0: TRUE STEREO. wet+dry → ChannelSplitter → 2x AnalyserNode
    // (L=Ch0, R=Ch1). Polling-Loop liest L+R separat und ruft
    // `analyzer.processBlock(L, R)` → BS.1770-4 K-weighting pro Kanal.
    // Mono-Fallback bleibt fuer Mock-AudioContext ohne createChannelSplitter
    // bestehen (kein Behavior-Change in Tests / Headless-Builds).
    try {
      // Stereo-Pfad zuerst versuchen.
      const splitter = this.ctx.createChannelSplitter
        ? this.ctx.createChannelSplitter(2)
        : null;
      if (splitter) {
        this._lufsSplitter = splitter;
        this._lufsAnalyserNodeL = this.ctx.createAnalyser();
        this._lufsAnalyserNodeR = this.ctx.createAnalyser();
        this._lufsAnalyserNodeL.fftSize = 2048;
        this._lufsAnalyserNodeR.fftSize = 2048;
        this._lufsAnalyserNodeL.smoothingTimeConstant = 0;
        this._lufsAnalyserNodeR.smoothingTimeConstant = 0;
        this._masterLimiterWet.connect(splitter);
        this._masterLimiterDry.connect(splitter);
        splitter.connect(this._lufsAnalyserNodeL, 0);
        splitter.connect(this._lufsAnalyserNodeR, 1);
        this._lufsScratchBuffer  = new Float32Array(this._lufsAnalyserNodeL.fftSize);
        this._lufsScratchBufferR = new Float32Array(this._lufsAnalyserNodeR.fftSize);
        this._lufsAnalyser = new LufsAnalyzer({
          sampleRate: this.ctx.sampleRate,
          channelCount: 2, // v3.101: echtes Stereo!
        });
      } else {
        // Fallback: Mono-AnalyserNode (v3.78-Verhalten).
        this._lufsAnalyserNode = this.ctx.createAnalyser();
        this._lufsAnalyserNode.fftSize = 2048;
        this._lufsAnalyserNode.smoothingTimeConstant = 0;
        this._masterLimiterWet.connect(this._lufsAnalyserNode);
        this._masterLimiterDry.connect(this._lufsAnalyserNode);
        this._lufsAnalyser = new LufsAnalyzer({
          sampleRate: this.ctx.sampleRate,
          channelCount: 1,
        });
        this._lufsScratchBuffer = new Float32Array(this._lufsAnalyserNode.fftSize);
      }
    } catch {
      // Mock-AudioContext ohne createAnalyser/createChannelSplitter → LUFS disabled.
      this._lufsAnalyserNode  = null;
      this._lufsAnalyserNodeL = null;
      this._lufsAnalyserNodeR = null;
      this._lufsSplitter      = null;
      this._lufsAnalyser      = null;
      this._lufsScratchBuffer  = null;
      this._lufsScratchBufferR = null;
    }

    // Global Reverb Bus (Plate-ähnlich, default 2s Decay).
    // v3.75.0: PreDelay (DelayNode 0..200ms) + Damping (Lowpass-Biquad) vor
    // dem Convolver. Chain: send → preDelay → damping → convolver → wet → master.
    this._globalReverbPreDelay = this.ctx.createDelay(0.25); // max 250ms Headroom
    this._globalReverbPreDelay.delayTime.value = 0;
    this._globalReverbDamping = this.ctx.createBiquadFilter();
    this._globalReverbDamping.type = "lowpass";
    // damping=0.5 default → cutoff ≈ 8kHz (siehe _dampingToHz).
    this._globalReverbDamping.frequency.value = this._dampingToHz(0.5);
    this._globalReverbDamping.Q.value = 0.7;
    this._globalReverbBus = this.ctx.createConvolver();
    this._globalReverbWet = this.ctx.createGain();
    this._globalReverbWet.gain.value = 0.6;
    this._regenerateReverbIr();
    this._globalReverbPreDelay.connect(this._globalReverbDamping);
    this._globalReverbDamping.connect(this._globalReverbBus);
    this._globalReverbBus.connect(this._globalReverbWet);
    this._globalReverbWet.connect(this.masterGain);

    // Global Delay Bus (1/4 Note bei 120 BPM ≈ 0.5s)
    this._globalDelayBus = this.ctx.createDelay(2.0);
    this._globalDelayBus.delayTime.value = 0.5;
    this._globalDelayFeedback = this.ctx.createGain();
    this._globalDelayFeedback.gain.value = 0.35;
    this._globalDelayWet = this.ctx.createGain();
    this._globalDelayWet.gain.value = 0.5;
    this._globalDelayBus.connect(this._globalDelayFeedback);
    this._globalDelayFeedback.connect(this._globalDelayBus);
    this._globalDelayBus.connect(this._globalDelayWet);
    this._globalDelayWet.connect(this.masterGain);

    // Record-Pipeline (TASK-234) — Recorder bekommt den AudioContext, hängt
    // sich aber erst auf explizites startRecording() in die Signal-Pfade.
    this._audioRecorder.setContext(this.ctx);

    // Live-Multi-Track-Recorder (v3.110.0) — Session-Capture. Wird beim
    // startLiveRecording() scharfgeschaltet, tappt master + alle gewählten
    // Channel-Panner.
    this._liveRecorder.setContext(this.ctx);

    // Live-Looper (TASK-235) — Loops mischen direkt in masterGain (post-FX,
    // sodass Loop-Playback nicht durch die per-Channel-FX-Chain läuft).
    this._looperEngine.setContext(this.ctx, this.masterGain);
    this._looperEngine.setBpm(this._bpm);

    // v3.25.0: Performance-Telemetrie initialisieren. SCHEDULE_INTERVAL ist
    // im Store die Bezugsgröße für CPU% (callback-ms / interval-ms × 100).
    try {
      _perfSetSchedulerInterval(this.SCHEDULE_INTERVAL);
      const base = (this.ctx as AudioContext & { baseLatency?: number }).baseLatency ?? 0;
      const out = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
      _perfUpdateContextLatency(base * 1000, out * 1000);
    } catch {
      /* ignore */
    }
  }

  /**
   * v3.25.0: Liefert aktuelle AudioContext-Latency-Snapshot in ms (für die
   * UI um auch außerhalb des Scheduler-Loops aktuelle Werte abzulesen).
   */
  getAudioPerformanceSnapshot(): { baseLatencyMs: number; outputLatencyMs: number } {
    const ctx = this.ctx;
    if (!ctx) return { baseLatencyMs: 0, outputLatencyMs: 0 };
    const base = (ctx as AudioContext & { baseLatency?: number }).baseLatency ?? 0;
    const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return { baseLatencyMs: base * 1000, outputLatencyMs: out * 1000 };
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === "suspended") await this.ctx.resume();
  }

  /**
   * v3.0.0 (TASK-236-ALT): Vollständiges Tear-Down + Re-Initialisierung des
   * AudioContexts. Notwendig wenn der User in den Settings den
   * `latencyHint` oder die `sampleRate` ändert — eine bestehende
   * AudioContext-Instanz akzeptiert diese Felder NICHT zur Laufzeit.
   *
   * Vorgehen:
   *   1. Transport stoppen (clear-Schedulers, Note-Off, Looper-Cleanup).
   *   2. Pro-Channel-Nodes-Cache, Reverb-Buffers, Granular-Engines wegwerfen.
   *   3. AudioContext.close() — alle weiteren Nodes werden mit-GC'd.
   *   4. init() neu — liest aktuelle Config aus dem Store.
   *
   * Live-State (BPM, Volume, FX-Configs in den Stores) bleibt erhalten —
   * die Nodes werden bei den nächsten Step-Triggers via _getOrCreateChannelNodes
   * lazy neu gebaut. Aktive Recordings + Live-Inputs werden abgebrochen
   * (kein State-Sync möglich über einen Context-Wechsel).
   */
  async reinit(): Promise<void> {
    // 1) Transport sicher stoppen — schließt auch MIDI-Clock/-Note-Out flush.
    if (this._isPlaying) {
      try { this.stop(); } catch { /* swallow */ }
    }
    // 2) Granular-Engines stoppen — sie halten eigene Refs auf Nodes.
    try {
      this._granularEngines.forEach((g) => { try { g.stop(); } catch { /* swallow */ } });
      this._granularEngines.clear();
    } catch { /* swallow */ }
    // 3) Live-Inputs abreißen — MediaStreamTracks werden via stop() befreit.
    try {
      this.getAttachedLiveInputChannelIds().forEach((id) => {
        try { this.detachLiveInput(id); } catch { /* swallow */ }
      });
    } catch { /* swallow */ }
    // 4) Caches leeren — sonst hängen Nodes am alten Context.
    this.channelNodes.clear();
    this.reverbBuffers.clear();
    this._globalReverbBus = null;
    this._globalReverbWet = null;
    this._globalReverbPreDelay = null;
    this._globalReverbDamping = null;
    this._globalDelayBus = null;
    this._globalDelayFeedback = null;
    this._globalDelayWet = null;
    this._masterEqLow = null;
    this._masterEqMid = null;
    this._masterEqHigh = null;
    this._masterLimiter = null;
    this._masterLimiterGain = null;
    this._masterLimiterLookahead = null;
    this._masterLimiterWet = null;
    this._masterLimiterDry = null;
    // v3.79.1 / v3.86.0: Sub-Mix-Bus-Nodes verwerfen — werden bei nächstem
    // syncSubMixState() neu erzeugt wenn der Store noch Buses hat.
    // Alle FX-Nodes disconnecten damit sie GC-frei werden.
    for (const bus of this._subMixBusNodes.values()) {
      try { bus.input.disconnect(); } catch { /* ignore */ }
      try { bus.eqLow.disconnect(); } catch { /* ignore */ }
      try { bus.eqMid.disconnect(); } catch { /* ignore */ }
      try { bus.eqHigh.disconnect(); } catch { /* ignore */ }
      try { bus.compIn.disconnect(); } catch { /* ignore */ }
      try { bus.compressor.disconnect(); } catch { /* ignore */ }
      try { bus.compWet.disconnect(); } catch { /* ignore */ }
      try { bus.compDry.disconnect(); } catch { /* ignore */ }
      try { bus.compMix.disconnect(); } catch { /* ignore */ }
      try { bus.postGain.disconnect(); } catch { /* ignore */ }
      try { bus.gain.disconnect(); } catch { /* ignore */ }
      try { bus.panner.disconnect(); } catch { /* ignore */ }
      try { bus.reverbSend.disconnect(); } catch { /* ignore */ }
      try { bus.delaySend.disconnect(); } catch { /* ignore */ }
    }
    this._subMixBusNodes.clear();
    // Assignments bleiben — sie werden beim nächsten Channel-Get bzw.
    // syncSubMixState neu angewendet.
    this.masterGain = null;
    this._outputAnalyser = null;
    // v3.78.0: LUFS-Tap aufräumen.
    if (this._lufsPollingTimer) {
      try { clearInterval(this._lufsPollingTimer); } catch { /* swallow */ }
      this._lufsPollingTimer = null;
    }
    this._lufsAnalyserNode = null;
    this._lufsAnalyserNodeL = null;
    this._lufsAnalyserNodeR = null;
    this._lufsSplitter      = null;
    this._lufsAnalyser      = null;
    this._lufsScratchBuffer  = null;
    this._lufsScratchBufferR = null;
    // 5) AudioContext schließen (kein await — close ist robust gegen state).
    if (this.ctx) {
      try { await this.ctx.close(); } catch { /* swallow — already closed */ }
      this.ctx = null;
    }
    // 6) Bufferleichen sind noch im Cache; sie werden vom GC erst entfernt
    //    wenn keiner sie mehr referenziert. Wir LEEREN den Cache nicht
    //    aktiv — Sample-URLs werden beim nächsten _loadBuffer reused
    //    weil decodeAudioData buffer-ctx-agnostisch ist.
    // 7) Re-init — liest neue Config aus dem Store.
    await this.init();
  }

  setBpm(bpm: number) {
    // v3.35.0: External-Sync-Pflicht. Wenn ein externer MIDI-Master aktiv
    // ist, ignorieren wir manuelle BPM-Updates (UI-Slider, Hotkey, KI). Der
    // externe Wert kommt ausschließlich über `applyExternalBpm()`.
    if (this._externalSyncActive) return;
    this._bpm = Math.max(20, Math.min(300, bpm));
    this._updateAudioTrackPlaybackRates();
    // Looper (TASK-235) braucht aktuelle BPM für Bar-Boundary-Mathematik.
    this._looperEngine.setBpm(this._bpm);
  }

  /**
   * v3.35.0: External-Sync-Schalter. Wenn aktiv, wird `setBpm()` no-op und
   * BPM-Updates kommen nur noch via `applyExternalBpm()`. UI muss den Slider
   * read-only schalten und ein "ext-sync"-Badge zeigen.
   */
  setExternalSyncActive(active: boolean): void {
    this._externalSyncActive = active;
  }

  /** v3.35.0: read-only Flag. */
  get externalSyncActive(): boolean {
    return this._externalSyncActive;
  }

  /**
   * v3.35.0: Bypass für `setBpm`, wird vom useMidi-Hook bei jedem
   * `midiclockin:tempo`-Event aufgerufen. Schlägt durch zum Looper.
   * Triggert KEINE Re-Trigger des Step-Sequencers — der nutzt _bpm beim
   * nächsten _schedule()-Loop.
   */
  applyExternalBpm(bpm: number): void {
    this._bpm = Math.max(20, Math.min(300, bpm));
    this._updateAudioTrackPlaybackRates();
    this._looperEngine.setBpm(this._bpm);
  }

  // ─── v3.111.0: MidiSyncIn-Facade (KORG-Master-Sync) ──────────────────────
  // Schlanke API-Façade fuer den neuen MidiSyncIn-Receiver (alongside MidiClockIn).
  // Der Hook installiert per `setMidiSyncIn(instance)` den Receiver und kann
  // dann direkt `applyDetectedBpm/applyExternalStart/Stop/Continue` aufrufen.

  private _midiSyncIn: import("./MidiSyncIn").MidiSyncIn | null = null;

  /**
   * v3.111.0: Registriert (oder unregistriert) eine MidiSyncIn-Instanz.
   * NICHT wirklich notwendig — der Hook kann auch direkt applyDetectedBpm()
   * etc. aufrufen — aber speichert die Instanz fuer Telemetrie / Tests.
   */
  setMidiSyncIn(sync: import("./MidiSyncIn").MidiSyncIn | null): void {
    this._midiSyncIn = sync;
  }

  /** v3.111.0: Read-only Getter — fuer Tests / UI-Inspect. */
  get midiSyncIn(): import("./MidiSyncIn").MidiSyncIn | null {
    return this._midiSyncIn;
  }

  /**
   * v3.111.0: Setzt internal _bpm wenn syncTempo aktiv (Caller-Entscheidung).
   * Aequivalent zu applyExternalBpm — separat benannt damit Sync-In-Pfad
   * im Stack-Trace klar erkennbar ist.
   */
  applyDetectedBpm(bpm: number): void {
    if (typeof bpm !== "number" || !isFinite(bpm)) return;
    this.applyExternalBpm(bpm);
  }

  /**
   * v3.111.0: Externer Master sendet 0xFA Start. Wenn wir nicht spielen,
   * starten wir das Pattern; wenn wir bereits laufen, ist es ein Reset
   * auf Step 0 (Spec-konform). Defensive: keine doppelte Tick-Machine.
   */
  applyExternalStart(): void {
    // Wenn bereits spielend: hart auf Step 0 zurueck.
    if (this._isPlaying) {
      this._currentStep = 0;
      this.positionCallbacks.forEach((cb) => cb(0));
      return;
    }
    // Sonst klassisch starten — wir leiten ueber play(0) um damit der
    // Scheduler korrekt initialisiert wird.
    try {
      // play() ist async — wir feuern fire-and-forget; der externe Master
      // toleriert ein paar ms Latenz beim ersten Tick.
      void this.play();
    } catch {
      /* swallow — Engine muss bei Sync-In-Fehlern resilient bleiben */
    }
  }

  /** v3.111.0: Externer Master sendet 0xFC Stop. */
  applyExternalStop(): void {
    if (!this._isPlaying) return;
    try {
      this.stop();
    } catch {
      /* swallow */
    }
  }

  /**
   * v3.111.0: Externer Master sendet 0xFB Continue. Resume from current
   * step (kein Position-Reset). Wenn bereits laufend: no-op.
   */
  applyExternalContinue(): void {
    if (this._isPlaying) return;
    try {
      // play(fromStep) ohne Argument startet bei _currentStep (oder
      // pending-Start-Step). Wir uebergeben explizit _currentStep damit
      // play() nicht auf 0 zurueck-springt.
      void this.play(this._currentStep);
    } catch {
      /* swallow */
    }
  }

  // ─── Tempo-Map / BPM-Automation (v3.95.0 / v3.104.0 stepCount-aware) ──────

  /**
   * v3.95.0: Resolver-Callback fuer Tempo-Map. Wird vom App.tsx-Wire-Up mit
   * einem Closure ueber useTempoMapStore.getCurrentBpm + atBar gesetzt.
   * Liefert null wenn keine Tempo-Map aktiv ist → Engine nutzt static _bpm.
   *
   * Defensive: bei leerer Map / null-Return fallt das Sequencer-Verhalten
   * 1:1 auf den pre-v3.95.0-Pfad zurueck (backward-compat).
   */
  private _tempoMapResolver: ((atBar: number) => number | null) | null = null;

  /** v3.95.0: setzt oder loescht den Tempo-Map-Resolver. */
  setTempoMapResolver(resolver: ((atBar: number) => number | null) | null): void {
    this._tempoMapResolver = resolver;
  }

  /**
   * v3.104.0: Liefert das aktuell von der Tempo-Map aufgeloeste BPM
   * bei der aktuellen Bar-Position. Bar = floor(absStep / stepsPerBar).
   *
   * stepsPerBar wird aus dem aktuellen Pattern abgeleitet:
   *  - Default = 16 (16th-note-Resolution, 4/4 Takt, ein 16-step Pattern = 1 Bar).
   *  - Bei nicht-16-Step-Patterns (12 triplet, 32, 64) wird die Stepzahl der
   *    Engine herangezogen (das Pattern entspricht dann 1 Bar mit der
   *    entsprechenden Sub-Resolution).
   *
   * Defensive vs. Resolver-Throws: bei Fehler → null (Fallback).
   */
  private _resolveTempoMapBpm(): number | null {
    if (!this._tempoMapResolver) return null;
    try {
      // Absolute Step-Position = vollendete Pattern-Loops * Stepzahl + currentStep.
      const total = Math.max(1, this._steps);
      const absStep = this.loopCount * total + this._currentStep;
      // stepsPerBar: bei nicht-Standard-Stepzahl (12/32/64) gilt das Pattern als
      // 1 Bar mit entsprechend skalierter Sub-Resolution. Standard 16 = 1 Bar.
      const stepsPerBar = total === 16 ? 16 : total;
      const bar = Math.floor(absStep / stepsPerBar);
      const resolved = this._tempoMapResolver(bar);
      if (typeof resolved !== "number" || !Number.isFinite(resolved)) return null;
      return Math.max(20, Math.min(300, resolved));
    } catch {
      return null;
    }
  }

  /**
   * v3.36.0: Sequencer-Position seeken (in Steps, 0..steps-1). Wird vom
   * useMidi-Hook bei `midiclockin:spp`-Events aufgerufen ODER beim
   * `midiclockin:start` mit positionStep>0 (SPP-driven Start-Resume).
   *
   * Semantik:
   *   - Wenn aktuell nicht spielend: setzt `_currentStep` für den nächsten
   *     `play()`-Aufruf — sobald 0xFA Start ankommt und der Scheduler
   *     anläuft, wird ab dieser Position weitergespielt. Achtung: `play()`
   *     selbst überschreibt `_currentStep` per default mit `fromStep=0` —
   *     der Caller (App.tsx-Listener) muss daher entweder vor `play(0)`
   *     `seekToStep(N)` aufrufen UND `play(N)` aufrufen, oder den
   *     SPP-Listener UNTERHALB der Start-Bridge ausführen.
   *   - Wenn bereits laufend: hard-jump zum Step. Tritt bei laufender
   *     External-Sync auf wenn ein DAW-Master mid-track repositioniert wird.
   *     `_nextStepTime` wird NICHT angefasst — der nächste Tick triggert
   *     dann den neuen Step.
   *   - Negative Steps werden auf 0 geclampt; Werte ≥ `_steps` werden
   *     modulo `_steps` gefaltet (defensiv gegen lange SPP-Werte aus DAWs
   *     mit Song-Ranges > Pattern-Länge).
   */
  seekToStep(step: number): void {
    if (!isFinite(step)) return;
    const total = Math.max(1, this._steps);
    const wrapped = ((Math.floor(step) % total) + total) % total;
    this._currentStep = wrapped;
    // v3.37.0: Race-Fix — _pendingStartStep wird gesetzt damit ein
    // nachfolgendes `play(0)` (durch den klassischen useTransport-Pfad) nicht
    // den Seek-Wert überschreibt. play() konsumiert das Feld am Anfang.
    this._pendingStartStep = wrapped;
    // Position-Callbacks sofort feuern damit UI (Step-LED) sich neu zeichnet.
    this.positionCallbacks.forEach(cb => cb(wrapped));
  }

  /**
   * v3.37.0: Konsumiert den pendingStartStep — vom Caller (useTransport) am
   * Anfang von play() verwendet um die SPP-Position vor `play(0)`-Default
   * zu schützen. Single-Use: nach Lesen wird der Wert geleert.
   */
  consumePendingStartStep(): number | null {
    const pending = this._pendingStartStep;
    this._pendingStartStep = null;
    return pending;
  }

  /** v3.36.0: read-only — aktuell anvisierter / laufender Step. */
  get currentStepIndex(): number {
    return this._currentStep;
  }
  /** v3.39.0: read-only — aktive Pattern-Step-Anzahl (16, 32 oder 64). */
  get stepCount(): number {
    return this._steps;
  }
  setSteps(steps: 16 | 32 | 64) { this._steps = steps; }
  setStepResolution(res: StepResolution) { this._stepResolution = res; }

  setMetronom(
    enabled: boolean,
    gain = 0.5,
    accent = 1.0,
    downbeatFreq = 1200,
    beatFreq = 800,
    beatsPerBar = 4,
    subdivision: "beat" | "eighth" | "sixteenth" = "beat",
    oscType: OscillatorType = "sine",
  ) {
    this._metronomEnabled = enabled;
    this._metronomGain = gain;
    this._metronomAccent = Math.max(0.2, Math.min(2, accent));
    this._metronomDownbeatFreq = Math.max(200, Math.min(4000, downbeatFreq));
    this._metronomBeatFreq = Math.max(200, Math.min(4000, beatFreq));
    this._metronomBeatsPerBar = Math.max(1, Math.min(12, beatsPerBar));
    this._metronomSubdivision = subdivision;
    this._metronomOscType = oscType;
  }

  setMasterVolume(vol: number) {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, vol)), this.ctx!.currentTime, 0.01
      );
    }
  }

  setReturnTrackVolume(bus: "reverb" | "delay", vol: number) {
    const target = bus === "reverb" ? this._globalReverbWet : this._globalDelayWet;
    if (!target || !this.ctx) return;
    target.gain.setTargetAtTime(Math.max(0, Math.min(1, vol)), this.ctx.currentTime, 0.01);
  }

  setReturnTrackMuted(bus: "reverb" | "delay", muted: boolean) {
    this.setReturnTrackVolume(bus, muted ? 0 : 0.85);
  }

  setPatternGetter(getter: () => PatternData) { this.patternGetter = getter; }

  /** Persistente Kanal-Lautstärke setzen (Mixer-Fader) */
  setChannelVolume(partId: string, vol: number) {
    const nodes = this.channelNodes.get(partId);
    if (nodes) {
      nodes.output.gain.setTargetAtTime(
        Math.max(0, Math.min(2, vol)),
        this.ctx?.currentTime ?? 0,
        0.01
      );
    }
  }

  /** Persistente Kanal-Pan setzen (Mixer-Pan) */
  setChannelPan(partId: string, pan: number) {
    const nodes = this.channelNodes.get(partId);
    if (nodes) {
      nodes.panner.pan.setTargetAtTime(
        Math.max(-1, Math.min(1, pan)),
        this.ctx?.currentTime ?? 0,
        0.01
      );
    }
  }

  /** Filter-Cutoff-Frequenz eines Kanals direkt setzen (für Envelope Follower / LFO) */
  setChannelFilterFreq(partId: string, freq: number) {
    const nodes = this.channelNodes.get(partId);
    if (!nodes) return;
    nodes.filter.frequency.value = Math.max(20, Math.min(20000, freq));
  }

  /** Send-Level zu globalem Reverb- oder Delay-Bus setzen */
  setChannelSend(partId: string, bus: "reverb" | "delay", level: number) {
    const nodes = this.channelNodes.get(partId);
    if (!nodes) return;
    const clampedLevel = Math.max(0, Math.min(1, level));
    if (bus === "reverb") {
      nodes.globalReverbSend.gain.setTargetAtTime(clampedLevel, this.ctx?.currentTime ?? 0, 0.01);
    } else {
      nodes.globalDelaySend.gain.setTargetAtTime(clampedLevel, this.ctx?.currentTime ?? 0, 0.01);
    }
  }

  // ─── Macro-LFO-Delegates (TASK-117) ─────────────────────────────────────────
  // Diese Setter werden vom Macro-Routing in App.tsx aufgerufen. Sie speichern
  // den letzten gewünschten Wert in der SynthEngine-Cache-Map. Step-Trigger-
  // Sites können später `getPartLfoRate`/`getPartLfoDepth` lesen, um
  // `synthParams.lfoRate/lfoDepth` zur Laufzeit zu überschreiben.

  /**
   * Lazy-Getter für die SynthEngine-Instanz. Browser-fallback-safe:
   * wenn kein AudioContext (z.B. SSR, Tests ohne init), wird `null`
   * zurückgegeben und Aufrufer sind no-op.
   */
  private _getOrCreateSynthEngine(): SynthEngine | null {
    if (this._synthEngine) return this._synthEngine;
    if (!this.ctx || !this.masterGain) return null;
    this._synthEngine = new SynthEngine(this.ctx, this.masterGain);
    return this._synthEngine;
  }

  /**
   * Setzt die LFO-Rate (Hz) für einen Part via Macro-Layer.
   * Range-Clamping passiert in der SynthEngine ([0.01..30]).
   */
  setPartLfoRate(partId: string, hz: number): void {
    const eng = this._getOrCreateSynthEngine();
    if (!eng) return;
    eng.setPartLfoRate(partId, hz);
  }

  /**
   * Setzt die LFO-Tiefe (0..1) für einen Part via Macro-Layer.
   * Range-Clamping passiert in der SynthEngine ([0..1]).
   */
  setPartLfoDepth(partId: string, depth: number): void {
    const eng = this._getOrCreateSynthEngine();
    if (!eng) return;
    eng.setPartLfoDepth(partId, depth);
  }

  /** Liefert letzten gesetzten Macro-LFO-Rate-Wert für einen Part. */
  getPartLfoRate(partId: string): number | null {
    return this._synthEngine?.getPartLfoRate(partId) ?? null;
  }

  /** Liefert letzten gesetzten Macro-LFO-Depth-Wert für einen Part. */
  getPartLfoDepth(partId: string): number | null {
    return this._synthEngine?.getPartLfoDepth(partId) ?? null;
  }

  /**
   * Sanfte BPM-Transition über N Bars.
   * Berechnet wie viele Steps N Bars entsprechen und
   * ändert das interne BPM schrittweise.
   */
  smoothBpmTransition(targetBpm: number, bars: number, stepCount: 16 | 32 | 64 = 16): void {
    const totalSteps = bars * stepCount;
    if (totalSteps <= 0 || Math.abs(this._bpm - targetBpm) < 0.1) {
      this.setBpm(targetBpm);
      return;
    }
    const bpmDelta = (targetBpm - this._bpm) / totalSteps;
    let step = 0;
    const unsub = this.onPosition(() => {
      step++;
      const next = Math.round((this._bpm + bpmDelta) * 10) / 10;
      if (step >= totalSteps || Math.abs(next - targetBpm) < 0.2) {
        this.setBpm(targetBpm);
        unsub();
        return;
      }
      this._bpm = next;
      // _nextStepTime wird beim nächsten Schedule-Zyklus automatisch neu berechnet
    });
  }

  /** Globale Delay-Zeit mit BPM synchronisieren */
  syncGlobalDelayToBpm(bpm: number, division: "1/4" | "1/8" | "3/16" = "1/4") {
    if (!this._globalDelayBus || !this.ctx) return;
    const beatDur = 60 / bpm;
    const delayTime = division === "1/8" ? beatDur / 2 : division === "3/16" ? beatDur * 0.75 : beatDur;
    this._globalDelayBus.delayTime.setTargetAtTime(
      Math.min(1.99, delayTime), this.ctx.currentTime, 0.05
    );
  }

  /** Melodic getter: liefert PitchSteps für eine Part-ID aus dem useMelodicPartStore */
  setMelodicGetter(getter: (partId: string) => { active: boolean; note: number; velocity: number }[] | undefined) {
    this.melodicGetter = getter;
  }

  private _midiOutCallback: ((note: number, velocity: number, partId: string) => void) | null = null;
  private _midiClockCallback: ((pulse: Uint8Array) => void) | null = null;
  private _midiProgramChangeCallback: ((program: number, channel: number) => void) | null = null;
  private _clockPulseCount = 0;  // 24 Pulse per Quarter Note
  /** Gestapelte Pattern-IDs die zusätzlich zum Haupt-Pattern abgespielt werden */
  private _stackedPatternIds: Set<string> = new Set();
  private _followActionCallback: ((action: FollowAction, currentPatternId: string) => void) | null = null;
  private _barCount = 0;
  /** Insert Chain Nodes pro Kanal (partId → AudioNode[]) */
  private _insertChainNodes = new Map<string, AudioNode[]>();
  /** Insert Chain Bypass Node (letzter Output-Node nach Inserts) */
  private _insertChainOuts = new Map<string, GainNode>();
  /** AudioWorklet geladen? */
  private _workletLoaded = false;
  /** Bus Compressor */
  private _busCompressor: DynamicsCompressorNode | null = null;
  private _busCompressorEnabled = false;
  private _busCompressorIn: GainNode | null = null;

  /** Registriert einen Callback für MIDI-Out-Ereignisse (step:trigger). */
  setMidiOutCallback(cb: ((note: number, velocity: number, partId: string) => void) | null) {
    this._midiOutCallback = cb;
  }

  /** Registriert einen MIDI-Clock-Callback (0xF8 Pulse, 24 pro Viertelnote). */
  setMidiClockCallback(cb: ((pulse: Uint8Array) => void) | null) {
    this._midiClockCallback = cb;
  }

  /** Registriert einen MIDI Program-Change-Callback. */
  setMidiProgramChangeCallback(cb: ((program: number, channel: number) => void) | null) {
    this._midiProgramChangeCallback = cb;
  }

  /** Sendet MIDI Program Change (0xC0) für ein Pattern. */
  sendPatternProgramChange(patternIndex: number, channel = 1): void {
    this._midiProgramChangeCallback?.(patternIndex % 128, channel);
  }

  /** Registriert einen Callback für Follow Actions (Pattern-Ende nach N Bars). */
  setFollowActionCallback(cb: ((action: FollowAction, currentPatternId: string) => void) | null) {
    this._followActionCallback = cb;
  }

  resetBarCount() { this._barCount = 0; }

  /** Fügt ein Pattern zum Stapel hinzu (wird zusätzlich abgespielt). */
  addStackedPattern(patternId: string): void { this._stackedPatternIds.add(patternId); }
  removeStackedPattern(patternId: string): void { this._stackedPatternIds.delete(patternId); }
  clearStackedPatterns(): void { this._stackedPatternIds.clear(); }
  getStackedPatternIds(): string[] { return [...this._stackedPatternIds]; }

  // ─── AudioWorklet laden ───────────────────────────────────────────────────

  private async _ensureWorklets(): Promise<void> {
    if (this._workletLoaded || !this.ctx) return;
    try {
      await this.ctx.audioWorklet.addModule(
        new URL("./worklets/BitcrusherProcessor.js", import.meta.url)
      );
      await this.ctx.audioWorklet.addModule(
        new URL("./worklets/RingModProcessor.js", import.meta.url)
      );
      await this.ctx.audioWorklet.addModule(
        new URL("./worklets/TimeStretchProcessor.js", import.meta.url)
      );
      this._workletLoaded = true;
    } catch (e) {
      console.warn("[AudioEngine] AudioWorklet konnte nicht geladen werden:", e);
    }

    // v3.44.0 (TASK-239 Phase 1): Built-In Plugin-Manifeste registrieren.
    // Die Worklet-Module selbst werden via createPluginHost() lazy geladen
    // (erst wenn ein Channel das Plugin tatsächlich aktiviert).
    try {
      registerBuiltInPlugins();
    } catch (e) {
      console.warn("[AudioEngine] Plugin-Registry-Init fehlgeschlagen:", e);
    }
  }

  // ─── Insert Chain ─────────────────────────────────────────────────────────

  /** Wendet eine Insert-FX-Chain auf einen Kanal an (ersetzt bestehende). */
  async applyInsertChain(
    partId: string,
    chain: Array<{ type: string; params: Record<string, number | string | boolean>; enabled: boolean }>,
  ): Promise<void> {
    if (!this.ctx) return;
    await this._ensureWorklets();

    // Alte Nodes trennen
    const old = this._insertChainNodes.get(partId) ?? [];
    old.forEach(n => { try { n.disconnect(); } catch { /* ignore */ } });
    this._insertChainNodes.delete(partId);

    const nodes = this._getOrCreateChannelNodes(partId, DEFAULT_CHANNEL_FX);

    // Wenn keine aktiven Inserts: direktes output→panner (Standard)
    const active = chain.filter(s => s.enabled);
    if (active.length === 0) {
      // Sicherstellen dass output direkt mit sidechainGain verbunden ist
      try { nodes.output.disconnect(); } catch { /* ignore */ }
      nodes.output.connect(nodes.panner);
      return;
    }

    // Insert-Nodes in Serie schalten
    const insertNodes: AudioNode[] = [];
    let prev: AudioNode = nodes.output;

    try { nodes.output.disconnect(); } catch { /* ignore */ }

    for (const slot of active) {
      let node: AudioNode | null = null;

      switch (slot.type) {
        case "bitcrusher":
          if (this._workletLoaded) {
            const n = new AudioWorkletNode(this.ctx, "bitcrusher-processor");
            const p = slot.params as { bitDepth?: number; sampleReduct?: number; mix?: number };
            n.parameters.get("bitDepth")!.value    = p.bitDepth    ?? 8;
            n.parameters.get("sampleReduct")!.value = p.sampleReduct ?? 4;
            n.parameters.get("mix")!.value         = p.mix         ?? 1;
            node = n;
          }
          break;
        case "ringmod":
          if (this._workletLoaded) {
            const n = new AudioWorkletNode(this.ctx, "ringmod-processor");
            const p = slot.params as { frequency?: number; mix?: number };
            n.parameters.get("frequency")!.value = p.frequency ?? 200;
            n.parameters.get("mix")!.value       = p.mix       ?? 0.5;
            node = n;
          }
          break;
        case "filter": {
          const f = this.ctx.createBiquadFilter();
          const p = slot.params as { type?: string; frequency?: number; q?: number };
          f.type = (p.type ?? "lowpass") as BiquadFilterType;
          f.frequency.value = p.frequency ?? 8000;
          f.Q.value = p.q ?? 1;
          node = f;
          break;
        }
        case "compressor": {
          const c = this.ctx.createDynamicsCompressor();
          const p = slot.params as { threshold?: number; ratio?: number; attack?: number; release?: number };
          c.threshold.value = p.threshold ?? -24;
          c.ratio.value     = p.ratio     ?? 4;
          c.attack.value    = p.attack    ?? 0.003;
          c.release.value   = p.release   ?? 0.25;
          node = c;
          break;
        }
        case "distortion": {
          const d = this.ctx.createWaveShaper();
          const amount = Number((slot.params as { amount?: number }).amount ?? 50);
          const curve = new Float32Array(256);
          for (let i = 0; i < 256; i++) {
            const x = (i * 2) / 256 - 1;
            curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
          }
          d.curve = curve;
          node = d;
          break;
        }
        case "chorus":
        case "flanger": {
          const p = slot.params as { rate?: number; depth?: number; feedback?: number; mix?: number };
          const rate     = p.rate     ?? (slot.type === "chorus" ? 1.5 : 0.5);
          const depth    = p.depth    ?? (slot.type === "chorus" ? 0.003 : 0.002);
          const feedback = p.feedback ?? (slot.type === "chorus" ? 0.1 : 0.7);
          const mix      = p.mix      ?? 0.5;

          // Dry/Wet-Mix
          const dryGain = this.ctx.createGain();
          const wetGain = this.ctx.createGain();
          dryGain.gain.value = 1 - mix;
          wetGain.gain.value = mix;

          // Delay-Netz mit LFO
          const delay = this.ctx.createDelay(0.05);
          delay.delayTime.value = slot.type === "chorus" ? 0.02 : 0.005;
          const lfo = this.ctx.createOscillator();
          lfo.frequency.value = rate;
          lfo.type = "sine";
          const lfoGain = this.ctx.createGain();
          lfoGain.gain.value = depth;
          lfo.connect(lfoGain);
          lfoGain.connect(delay.delayTime);
          lfo.start();

          // Feedback
          const fbGain = this.ctx.createGain();
          fbGain.gain.value = feedback;
          delay.connect(fbGain);
          fbGain.connect(delay);

          // Mixer-Knoten: input → dry + wet (via delay)
          const merger = this.ctx.createGain(); // Ausgabe-Knoten
          dryGain.connect(merger);
          delay.connect(wetGain);
          wetGain.connect(merger);

          // Wir brauchen einen "Eingangs-Knoten" der dryGain und delay speist
          const splitter = this.ctx.createGain();
          splitter.connect(dryGain);
          splitter.connect(delay);

          // Overwrite: splitter ist der Eingang, merger der Ausgang
          // da node nur einen einzigen AudioNode sein kann, wrappen wir über splitter
          node = splitter;
          // merger wird als letztes connected (connect in Schleife wird prev.connect(node) rufen)
          // Daher überschreiben wir prev.connect nach der Schleife nicht korrekt —
          // für einen sauberen Ansatz verbinden wir merger direkt zum panner
          // Wir lösen das indem merger am Ende der Loop statt node verwendet wird:
          insertNodes.push(splitter, delay, dryGain, wetGain, merger, fbGain, lfoGain, lfo);
          prev.connect(splitter);
          merger.connect(nodes.panner);
          prev = null as unknown as AudioNode; // Signal: nicht nochmal connecten
          break;
        }
      }

      if (node && prev) {
        prev.connect(node);
        insertNodes.push(node);
        prev = node;
      }
    }

    // Falls prev null wurde (Chorus/Flanger haben selbst verbunden), kein weiteres connect
    if (prev) {
      prev.connect(nodes.panner);
    }
    this._insertChainNodes.set(partId, insertNodes);
  }

  // ─── Plugin-Slot Chain (v3.44.0 → v3.45.0) ───────────────────────────────
  // Per-Channel Plugin-Chain mit max MAX_PLUGIN_SLOTS_PER_CHANNEL Slots
  // (siehe useMixerStore). Chain ist seriell: nodes.output → plugin[0] →
  // plugin[1] → ... → plugin[N-1] → nodes.panner.
  //
  // v3.45.0:
  //   - Multi-Slot (1–4 Plugins pro Channel) statt Single-Slot.
  //   - Click-Free Bypass via PluginHost.setBypassed (5ms gain-ramp).
  //     Plugin-Knoten bleibt im Signalweg verkabelt — Bypass crossfaded
  //     intern wet/dry. Keine disconnect/connect-Pops mehr.
  //
  // ARCHITEKTUR-ENTSCHEIDUNG: Plugin-Slots sind eine SEPARATE Schicht neben
  // den klassischen 12 Insert-Typen. In Phase-2 (native VST3) wird dies
  // wichtig weil native Plugins via IPC ein anderes Wiring brauchen.

  /** Pro-Channel Plugin-Chain (Liste von Hosts). Slot-Index === Chain-Position. */
  private _pluginHosts = new Map<string, PluginHost[]>();

  /**
   * Lädt/entlädt eine Plugin-Chain für einen Kanal. Bei leerer Liste wird
   * die Chain entfernt. Defensive: bei Plugin-Load-Fehler wird der Slot
   * übersprungen (Chain bleibt funktional, keine Audio-Unterbrechung).
   *
   * v3.45.0: ersetzt die single-slot `applyPluginSlot` API. Die Legacy-
   * Single-Slot-Variante delegiert auf diese Methode (siehe Wrapper unten).
   */
  async applyPluginSlots(
    partId: string,
    slots: Array<{ pluginId: string; params: Record<string, number>; bypassed?: boolean }>,
  ): Promise<void> {
    if (!this.ctx) return;

    // Existierende Plugin-Instanzen disposen damit kein Memory-Leak entsteht.
    const existing = this._pluginHosts.get(partId);
    if (existing) {
      for (const h of existing) {
        try { h.dispose(); } catch { /* ignore */ }
      }
      this._pluginHosts.delete(partId);
    }

    // Plugin-Hosts für jeden Slot async erzeugen. Failed-Loads landen als
    // `null` im Array und werden vor dem Wiring gefiltert.
    const hostsRaw = await Promise.all(
      slots.map(async (slot) => {
        const manifest = getPluginManifest(slot.pluginId);
        if (!manifest) {
          console.warn(`[AudioEngine] Unknown plugin id: ${slot.pluginId}`);
          return null;
        }
        const host = await createPluginHost(this.ctx!, manifest, { params: slot.params });
        if (!host) return null;
        // Bypass-State direkt setzen — durch den crossfade-Wrapper ist das
        // click-free, der Knoten bleibt im Signalweg verkabelt.
        if (slot.bypassed) host.setBypassed(true, 0); // initial — keine Rampe nötig
        return host;
      }),
    );
    const hosts = hostsRaw.filter((h): h is PluginHost => h !== null);
    this._pluginHosts.set(partId, hosts);

    // Wiring: nodes.output → plugin[0].in → plugin[0].out → plugin[1].in → ...
    // → plugin[N-1].out → nodes.panner. Bei leerer Chain: output → panner.
    const nodes = this._getOrCreateChannelNodes(partId, DEFAULT_CHANNEL_FX);
    try { nodes.output.disconnect(); } catch { /* ignore */ }

    if (hosts.length === 0) {
      nodes.output.connect(nodes.panner);
      return;
    }

    let cursor: AudioNode = nodes.output;
    for (const host of hosts) {
      cursor.connect(host.getInputNode());
      cursor = host.getOutputNode();
    }
    cursor.connect(nodes.panner);
  }

  /**
   * Legacy v3.44 API — single-slot applyPluginSlot.
   * Convenience-Wrapper auf `applyPluginSlots`. Slot=null → leere Chain.
   */
  async applyPluginSlot(
    partId: string,
    slot: { pluginId: string; params: Record<string, number>; bypassed?: boolean } | null,
  ): Promise<void> {
    return this.applyPluginSlots(partId, slot ? [slot] : []);
  }

  /**
   * Setzt einen einzelnen Plugin-Param zur Laufzeit (für UI-Slider-Drag).
   * v3.45: nutzt optional einen Slot-Index. Default 0 für Legacy-Kompatibilität.
   */
  setPluginParam(partId: string, paramId: string, value: number, slotIndex: number = 0): void {
    const hosts = this._pluginHosts.get(partId);
    if (!hosts || slotIndex < 0 || slotIndex >= hosts.length) return;
    hosts[slotIndex].setParam(paramId, value);
  }

  /**
   * Setzt den Bypass-State für einen Slot mit click-free gain-ramp (v3.45).
   * Default rampMs=5ms — schnell genug für UI-Responsiveness, lang genug
   * gegen Click-Artefakte.
   */
  setPluginSlotBypassed(partId: string, slotIndex: number, bypassed: boolean, rampMs: number = 5): void {
    const hosts = this._pluginHosts.get(partId);
    if (!hosts || slotIndex < 0 || slotIndex >= hosts.length) return;
    hosts[slotIndex].setBypassed(bypassed, rampMs);
  }

  /** Liefert die aktuell aktive Plugin-Host-Chain (für Tests/UI). */
  getPluginHosts(partId: string): PluginHost[] {
    return this._pluginHosts.get(partId) ?? [];
  }

  /** Legacy v3.44 — liefert nur Slot 0. */
  getPluginHost(partId: string): PluginHost | undefined {
    const hosts = this._pluginHosts.get(partId);
    return hosts && hosts.length > 0 ? hosts[0] : undefined;
  }

  // ─── Bus Compressor ───────────────────────────────────────────────────────

  /** Konfiguriert den globalen Bus-Kompressor (Drum Bus). */
  setBusCompressor(settings: {
    enabled: boolean;
    threshold?: number; ratio?: number; attack?: number; release?: number; makeup?: number;
  }): void {
    if (!this.ctx || !this.masterGain) return;

    this._busCompressorEnabled = settings.enabled;

    if (!settings.enabled) {
      // Bypass: Channels direkt in masterGain leiten (default)
      this._busCompressor = null;
      this._busCompressorIn = null;
      return;
    }

    if (!this._busCompressor) {
      this._busCompressorIn = this.ctx.createGain();
      this._busCompressor = this.ctx.createDynamicsCompressor();
      const makeup = this.ctx.createGain();
      makeup.gain.value = Math.pow(10, (settings.makeup ?? 0) / 20);
      this._busCompressorIn.connect(this._busCompressor);
      this._busCompressor.connect(makeup);
      makeup.connect(this.masterGain);
    }

    const c = this._busCompressor;
    c.threshold.value = settings.threshold ?? -18;
    c.ratio.value     = settings.ratio     ?? 4;
    c.attack.value    = settings.attack    ?? 0.005;
    c.release.value   = settings.release   ?? 0.1;
  }

  /** Routet einen Kanal durch den Bus-Kompressor. */
  routeChannelToBus(partId: string, toBus: boolean): void {
    const nodes = this.channelNodes.get(partId);
    if (!nodes || !this.masterGain) return;

    try { nodes.sidechainGain.disconnect(); } catch { /* ignore */ }

    if (toBus && this._busCompressorIn && this._busCompressorEnabled) {
      nodes.sidechainGain.connect(this._busCompressorIn);
    } else {
      // v3.79.1: Sub-Mix-Bus hat Priorität gegenüber dem direkten Master-
      // Route — wenn der Channel einem Bus zugewiesen ist, route dorthin.
      const dest = this._resolveChannelDestination(partId);
      nodes.sidechainGain.connect(dest);
    }
  }

  // ─── Sub-Mix-Buses (v3.79.1) ───────────────────────────────────────────────

  /**
   * v3.79.1: Default-Destination für einen Channel-Output berechnen.
   * Priorität: Sub-Mix-Bus (assigned) → masterGain.
   * Der Bus-Compressor (`routeChannelToBus`) wickelt sein Routing selbst ab.
   */
  private _resolveChannelDestination(partId: string): AudioNode {
    const busId = this._channelSubMixAssignments.get(partId);
    if (busId) {
      const bus = this._subMixBusNodes.get(busId);
      // v3.86.0: Channel-Output landet jetzt am Bus-Input (vor der FX-Chain).
      if (bus) return bus.input;
    }
    return this.masterGain!;
  }

  /**
   * v3.79.1 / v3.86.0: Erzeugt (falls nicht existent) die Bus-Nodes inkl. voller
   * FX-Chain (EQ-3 + Compressor + Reverb/Delay-Sends) und verbindet sie zum
   * Master. Wendet volume/pan/mute/solo/FX-Params mit 20ms Rampen an (no-click).
   *
   * Routing-Order: input → eqLow → eqMid → eqHigh → compIn
   *   → [compressor → compWet] || [compDry] → compMix
   *   → gain (·solo) → panner → master
   *
   *   gain → reverbSend → global-reverb-bus
   *   gain → delaySend  → global-delay-bus
   *
   * Solo-Logik: wenn `anyBusSolo` true ist und dieser Bus selbst nicht solo'd
   * ist, wird das effective-Volume auf 0 multipliziert (Sister-Bus-Ducking).
   *
   * Idempotent — mehrfacher Aufruf mit identischem State ist no-op am Audio-
   * Graph (rampt nur die Parameter auf die selben Werte).
   */
  applySubMixBus(busId: string, bus: SubMixBus, anyBusSolo: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    let nodeSet = this._subMixBusNodes.get(busId);
    if (!nodeSet) {
      nodeSet = this._createSubMixBusNodes();
      this._subMixBusNodes.set(busId, nodeSet);
    }
    const now = this.ctx.currentTime;
    const rampSec = this.SUB_MIX_BUS_RAMP_SEC;

    // ─── Pan smooth ─────────────────────────────────────────────────────
    nodeSet.panner.pan.setTargetAtTime(bus.pan, now, rampSec);

    // ─── Effective Main-Gain (Volume × Mute × Solo) ────────────────────
    const muted = bus.mute || (anyBusSolo && !bus.solo);
    const target = muted ? 0 : bus.volume;
    nodeSet.volume = bus.volume;
    nodeSet.gain.gain.setTargetAtTime(target, now, rampSec);

    // ─── v3.86.0: FX-Chain auf bus.fx anwenden ──────────────────────────
    // bus.fx ist optional — Pre-v3.79.1-Buses haben kein fx-Feld. Defaults
    // entsprechen flacher EQ + bypassed Compressor + 0 Sends (transparent).
    const fx = bus.fx;
    const enabled = fx?.enabled ?? false;

    // EQ-3: wenn enabled=false fallen alle Bänder auf 0dB (transparent).
    const lowGain  = enabled ? (fx?.eq3?.lowGain  ?? 0) : 0;
    const midGain  = enabled ? (fx?.eq3?.midGain  ?? 0) : 0;
    const highGain = enabled ? (fx?.eq3?.highGain ?? 0) : 0;
    nodeSet.eqLow.gain.setTargetAtTime(lowGain,   now, rampSec);
    nodeSet.eqMid.gain.setTargetAtTime(midGain,   now, rampSec);
    nodeSet.eqHigh.gain.setTargetAtTime(highGain, now, rampSec);

    // Compressor: Wet/Dry-Crossfade (kein disconnect → click-frei).
    const comp = fx?.compressor;
    const compOn = enabled && (comp?.enabled ?? false);
    if (comp) {
      nodeSet.compressor.threshold.setTargetAtTime(comp.threshold, now, rampSec);
      nodeSet.compressor.ratio.setTargetAtTime(comp.ratio,         now, rampSec);
      nodeSet.compressor.attack.setTargetAtTime(comp.attack,       now, rampSec);
      nodeSet.compressor.release.setTargetAtTime(comp.release,     now, rampSec);
    }
    nodeSet.compWet.gain.setTargetAtTime(compOn ? 1 : 0, now, rampSec);
    nodeSet.compDry.gain.setTargetAtTime(compOn ? 0 : 1, now, rampSec);

    // v3.88.0: postGain (zwischen compMix und gain). Liegt im FX-Block, daher
    // bei fx.enabled=false transparent (1.0) — Werte aus fx.postGain wirken
    // erst wenn die FX-Chain aktiv ist. Default-Fallback auf 1.0.
    const postGain = enabled ? (fx?.postGain ?? 1.0) : 1.0;
    nodeSet.postGain.gain.setTargetAtTime(postGain, now, rampSec);

    // Reverb-Send / Delay-Send — independent von fx.enabled (Send ist eigener Pfad).
    const reverbSend = fx?.reverbSend ?? 0;
    const delaySend  = fx?.delaySend  ?? 0;
    nodeSet.reverbSend.gain.setTargetAtTime(reverbSend, now, rampSec);
    nodeSet.delaySend.gain.setTargetAtTime(delaySend,   now, rampSec);
  }

  /**
   * v3.86.0: Baut eine frische Sub-Mix-Bus-Node-Sammlung mit voller FX-Chain
   * und verkabelt alle Nodes intern + zu master / global-bus.
   */
  private _createSubMixBusNodes(): SubMixBusNodes {
    if (!this.ctx || !this.masterGain) {
      throw new Error("AudioEngine not initialized");
    }
    const ctx = this.ctx;

    const input  = ctx.createGain();
    input.gain.value = 1;

    // EQ-3 (Channel-FX-konsistent: Lowshelf 200Hz, Peak 1kHz Q=1, Highshelf 4kHz).
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = "lowshelf";
    eqLow.frequency.value = 200;
    eqLow.gain.value = 0;
    const eqMid = ctx.createBiquadFilter();
    eqMid.type = "peaking";
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1;
    eqMid.gain.value = 0;
    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = "highshelf";
    eqHigh.frequency.value = 4000;
    eqHigh.gain.value = 0;

    // Compressor + Wet/Dry-Crossfade (bypass-frei mittels Mix-Bus).
    const compIn = ctx.createGain();
    compIn.gain.value = 1;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.1;
    compressor.knee.value = 6;
    const compWet = ctx.createGain();
    compWet.gain.value = 0; // Default: Compressor bypassed (dry pfad aktiv).
    const compDry = ctx.createGain();
    compDry.gain.value = 1;
    const compMix = ctx.createGain();
    compMix.gain.value = 1;

    // v3.88.0: postGain (zwischen compMix und gain) — Post-Comp-Trim 0..2.
    const postGain = ctx.createGain();
    postGain.gain.value = 1; // Default transparent (1.0).

    // Main Gain + Panner.
    const gain = ctx.createGain();
    gain.gain.value = 0; // Start stumm — wird gleich gerampt.
    const panner = ctx.createStereoPanner();
    panner.pan.value = 0;

    // Reverb-Send / Delay-Send.
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0;
    const delaySend = ctx.createGain();
    delaySend.gain.value = 0;

    // ─── Wiring: input → eqLow → eqMid → eqHigh → compIn ───
    input.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(compIn);

    // compIn fans out to compressor (wet) + compDry (parallel).
    compIn.connect(compressor);
    compressor.connect(compWet);
    compIn.connect(compDry);
    // Both merge into compMix.
    compWet.connect(compMix);
    compDry.connect(compMix);
    // v3.88.0: compMix → postGain → gain → panner → master.
    compMix.connect(postGain);
    postGain.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain);

    // Sends zweigen post-gain ab → global-buses (sofern initialisiert).
    gain.connect(reverbSend);
    if (this._globalReverbPreDelay) {
      reverbSend.connect(this._globalReverbPreDelay);
    } else if (this._globalReverbBus) {
      reverbSend.connect(this._globalReverbBus);
    }
    gain.connect(delaySend);
    if (this._globalDelayBus) {
      delaySend.connect(this._globalDelayBus);
    }

    return {
      input, eqLow, eqMid, eqHigh,
      compIn, compressor, compWet, compDry, compMix,
      postGain,
      gain, panner,
      reverbSend, delaySend,
      volume: 0,
    };
  }

  /**
   * v3.79.1 / v3.86.0: Entfernt einen Bus aus dem Audio-Graph. Disconnected
   * alle FX-Nodes (input, EQ-Bänder, Compressor-Mix, Gain, Panner, Sends).
   * Channels die noch auf diesen Bus zeigten werden zu master rerouted.
   */
  removeSubMixBus(busId: string): void {
    const nodeSet = this._subMixBusNodes.get(busId);
    if (!nodeSet) return;
    try { nodeSet.input.disconnect();      } catch { /* ignore */ }
    try { nodeSet.eqLow.disconnect();      } catch { /* ignore */ }
    try { nodeSet.eqMid.disconnect();      } catch { /* ignore */ }
    try { nodeSet.eqHigh.disconnect();     } catch { /* ignore */ }
    try { nodeSet.compIn.disconnect();     } catch { /* ignore */ }
    try { nodeSet.compressor.disconnect(); } catch { /* ignore */ }
    try { nodeSet.compWet.disconnect();    } catch { /* ignore */ }
    try { nodeSet.compDry.disconnect();    } catch { /* ignore */ }
    try { nodeSet.compMix.disconnect();    } catch { /* ignore */ }
    try { nodeSet.postGain.disconnect();   } catch { /* ignore */ }
    try { nodeSet.gain.disconnect();       } catch { /* ignore */ }
    try { nodeSet.panner.disconnect();     } catch { /* ignore */ }
    try { nodeSet.reverbSend.disconnect(); } catch { /* ignore */ }
    try { nodeSet.delaySend.disconnect();  } catch { /* ignore */ }
    this._subMixBusNodes.delete(busId);
    // Channels die noch auf diesen Bus zeigen → unassign + reroute zu master.
    const orphans: string[] = [];
    for (const [pid, bid] of this._channelSubMixAssignments) {
      if (bid === busId) orphans.push(pid);
    }
    for (const pid of orphans) {
      this._channelSubMixAssignments.delete(pid);
      this._reconnectChannelOutput(pid);
    }
  }

  /**
   * v3.79.1: Weist einen Channel einem Bus zu (oder null = master direkt).
   * Disconnected den Channel-Output und re-connected zum neuen Destination.
   * Klick-Robust durch sidechainGain als Branchpoint (existierender Pattern).
   */
  routeChannelToSubMixBus(partId: string, busId: string | null): void {
    if (busId !== null && !this._subMixBusNodes.has(busId)) {
      // Unknown Bus → defensive: behandle wie null (=master).
      busId = null;
    }
    if (busId === null) {
      this._channelSubMixAssignments.delete(partId);
    } else {
      this._channelSubMixAssignments.set(partId, busId);
    }
    this._reconnectChannelOutput(partId);
  }

  /**
   * v3.79.1: Disconnect+Reconnect der channel-Output-Verbindung (sidechainGain)
   * gemäß aktuellem Sub-Mix-Assignment + Bus-Compressor-Status.
   * Idempotent — auch wenn der Channel noch nicht existiert (silent no-op).
   */
  private _reconnectChannelOutput(partId: string): void {
    const nodes = this.channelNodes.get(partId);
    if (!nodes || !this.masterGain) return;
    try { nodes.sidechainGain.disconnect(); } catch { /* ignore */ }
    // Bus-Compressor hat höchste Priorität (existierende v3.x-Logik).
    if (this._busCompressorIn && this._busCompressorEnabled) {
      nodes.sidechainGain.connect(this._busCompressorIn);
      return;
    }
    const dest = this._resolveChannelDestination(partId);
    nodes.sidechainGain.connect(dest);
  }

  /**
   * v3.79.1: Bulk-Sync vom Store-Snapshot. Erzeugt fehlende Bus-Nodes,
   * entfernt orphan-Buses, aktualisiert Channel-Assignments. Wird vom React-
   * useEffect-Subscriber in App.tsx gerufen.
   *
   * Defensiv gegen wiederholtes Aufrufen mit identischem State (idempotent).
   */
  syncSubMixState(state: SubMixState): void {
    if (!this.ctx || !this.masterGain) return;
    const wantedBusIds = new Set<string>();
    const anyBusSolo = state.buses.some((b) => b.solo);
    // 1) Anwesende Buses upserten.
    for (const bus of state.buses) {
      wantedBusIds.add(bus.id);
      this.applySubMixBus(bus.id, bus, anyBusSolo);
    }
    // 2) Entfernte Buses abräumen.
    const toRemove: string[] = [];
    for (const id of this._subMixBusNodes.keys()) {
      if (!wantedBusIds.has(id)) toRemove.push(id);
    }
    for (const id of toRemove) this.removeSubMixBus(id);
    // 3) Channel-Assignments synchen.
    const wantedAssign = new Map<string, string>();
    for (const bus of state.buses) {
      for (const partId of bus.channelIds) {
        wantedAssign.set(partId, bus.id);
      }
    }
    // Channels die im Store gelistet sind:
    const touched = new Set<string>();
    for (const [partId, busId] of wantedAssign) {
      touched.add(partId);
      const current = this._channelSubMixAssignments.get(partId);
      if (current === busId) continue;
      this.routeChannelToSubMixBus(partId, busId);
    }
    // Channels die intern noch ein Assignment haben, im Store aber nicht
    // mehr (= un-assigned worden) → zurück zu master.
    const orphans: string[] = [];
    for (const [partId] of this._channelSubMixAssignments) {
      if (!touched.has(partId)) orphans.push(partId);
    }
    for (const pid of orphans) {
      this.routeChannelToSubMixBus(pid, null);
    }
  }

  /** v3.79.1 / v3.86.0: Test-Helper / Inspection — liefert die Bus-Node-Map. */
  getSubMixBusNodes(): ReadonlyMap<string, SubMixBusNodes> {
    return this._subMixBusNodes;
  }

  /** v3.79.1: Test-Helper — Channel-Assignment-Lookup. */
  getChannelSubMixAssignment(partId: string): string | null {
    return this._channelSubMixAssignments.get(partId) ?? null;
  }

  /**
   * v3.79.1: Eager-Create der Channel-Nodes ohne ein konkretes Audio-
   * Event abzufeuern. Hauptsächlich für Tests + Sub-Mix-Routing-Probes
   * verwendet. Idempotent. Liefert true wenn (jetzt) verkabelt.
   */
  ensureChannelExists(partId: string): boolean {
    if (!this.ctx || !this.masterGain) return false;
    this._getOrCreateChannelNodes(partId, DEFAULT_CHANNEL_FX);
    return this.channelNodes.has(partId);
  }

  /** Liefert den Bus-Kompressor-AnalyserNode für VU-Anzeige. */
  getBusCompressorLevel(): number {
    const comp = this._busCompressor;
    if (!comp) return 0;
    return Math.max(0, -comp.reduction); // reduction ist negativ
  }

  /** Setzt den globalen Transpose in Halbtönen (-24..+24). Wirkt sofort auf das Playback. */
  setGlobalTranspose(semitones: number) {
    const clamped = Math.max(-24, Math.min(24, Math.round(semitones)));
    this._globalTranspose = clamped;
  }

  /** Liefert den aktuell gesetzten Global-Transpose-Wert. */
  getGlobalTranspose(): number {
    return this._globalTranspose;
  }

  /** Setzt die Sidechain-Einstellungen für einen Ziel-Part. */
  setSidechainSettings(targetPartId: string, settings: { enabled: boolean; sourcePartId: string | null; amount: number; attack: number; release: number }): void {
    if (!settings.enabled || !settings.sourcePartId) {
      this._sidechainSettings.delete(targetPartId);
      // Gain auf 1 zurücksetzen
      const nodes = this.channelNodes.get(targetPartId);
      if (nodes && this.ctx) nodes.sidechainGain.gain.setValueAtTime(1, this.ctx.currentTime);
    } else {
      this._sidechainSettings.set(targetPartId, settings);
    }
  }

  /** Gibt den AudioContext zurück (null wenn noch nicht initialisiert). */
  getAudioContext(): AudioContext | null {
    return this.ctx ?? null;
  }

  // ─── Granular Synthesizer ─────────────────────────────────────────────────

  /** Startet eine Granular-Wolke für einen Kanal. Lädt den Buffer falls nötig. */
  async startGranular(partId: string, sampleUrl: string, params: import("./GranularEngine").GranularParams): Promise<void> {
    await this.init();
    if (!this.ctx) return;

    const { GranularEngine } = await import("./GranularEngine");
    const buf = await this._loadBuffer(sampleUrl);
    if (!buf || !this.ctx) return;

    // Vorherige Engine stoppen
    this._granularEngines.get(partId)?.stop();

    const engine = new GranularEngine(this.ctx);
    engine.setBuffer(buf);

    const nodes = this._getOrCreateChannelNodes(partId, DEFAULT_CHANNEL_FX);
    engine.start(params, nodes.output);
    this._granularEngines.set(partId, engine);
  }

  /** Aktualisiert Granular-Parameter während der Wiedergabe. */
  updateGranularParams(partId: string, params: Partial<import("./GranularEngine").GranularParams>): void {
    this._granularEngines.get(partId)?.updateParams(params);
  }

  /** Stoppt die Granular-Wolke eines Kanals. */
  stopGranular(partId: string): void {
    this._granularEngines.get(partId)?.stop();
    this._granularEngines.delete(partId);
  }

  /** Stoppt alle Granular Engines (z.B. bei globalem Stop). */
  stopAllGranular(): void {
    this._granularEngines.forEach(e => e.stop());
    this._granularEngines.clear();
  }

  /** Erstellt einen zeitlich umgekehrten AudioBuffer (für Reverse-Steps). */
  private _reverseBuffer(buffer: AudioBuffer): AudioBuffer {
    if (!this.ctx) return buffer;
    const reversed = this.ctx.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = reversed.getChannelData(ch);
      for (let i = 0; i < buffer.length; i++) {
        dst[i] = src[buffer.length - 1 - i];
      }
    }
    return reversed;
  }

  /** Lazy-erzeugt einen AnalyserNode am Master-Ausgang und gibt ihn zurück. */
  getOutputAnalyser(): AnalyserNode | null {
    if (!this.ctx || !this.masterGain) return null;
    if (!this._outputAnalyser) {
      this._outputAnalyser = this.ctx.createAnalyser();
      this._outputAnalyser.fftSize = 512;
      this._outputAnalyser.smoothingTimeConstant = 0.75;
      this.masterGain.connect(this._outputAnalyser);
    }
    return this._outputAnalyser;
  }

  onStep(cb: StepCallback) {
    this.stepCallbacks.push(cb);
    return () => { this.stepCallbacks = this.stepCallbacks.filter(c => c !== cb); };
  }

  // ─── MIDI-Clock-Out (TASK-230 / v2.83.0) ─────────────────────────────────

  /**
   * Setzt den Sender-Callback für MIDI-Clock-Out. Der Sender bekommt die
   * Realtime-Bytes (z.B. [0xF8] für Tick) und muss sie an einen aktiven
   * Web-MIDI-Output weiterleiten. Wird typischerweise vom useMidi-Hook
   * aufgerufen mit `(bytes) => sendMessage(midiAccess, outputId, bytes)`.
   * Setze auf null um die Clock-Out komplett zu deaktivieren.
   */
  setMidiClockOutSender(sender: ((bytes: number[]) => void) | null) {
    this._midiClockOut.setSender(sender);
  }

  /**
   * Aktiviert/deaktiviert MIDI-Clock-Out. Wenn während laufendem Transport
   * deaktiviert wird, sendet MidiClockOut automatisch ein 0xFC (Stop) an den
   * externen Empfänger, damit dieser nicht hängenbleibt.
   */
  setMidiClockOutEnabled(enabled: boolean) {
    this._midiClockOut.setEnabled(enabled);
  }

  /** Liefert die laufende MidiClockOut-Instanz (read-only access für UI/Tests). */
  getMidiClockOut(): MidiClockOut {
    return this._midiClockOut;
  }

  // ─── MIDI-Note-Out (TASK-240 / v2.92.0) ──────────────────────────────────

  /**
   * Setzt den Sender für MIDI-Note-Out. Bekommt die kompletten Bytes
   * (Note-On / Note-Off) und muss sie an einen Web-MIDI-Output schicken.
   * Typischerweise vom useMidi-Hook aufgerufen mit
   * `(bytes) => sendMessage(midiAccess, partConfig.outputId, bytes)`.
   *
   * Wichtig: der Sender muss selber die richtige Output-ID auswählen — wir
   * geben hier nur Bytes raus. Der Sender liest pro Call die aktuelle
   * Config-Map (oder löst die outputId aus dem aufrufenden Kontext).
   */
  setMidiNoteOutSender(sender: ((outputId: string, bytes: number[]) => void) | null) {
    this._midiNoteOut.setSender(sender);
  }

  /**
   * Aktiviert/deaktiviert die MIDI-Note-Out global. Bei Disable während
   * offene Notes werden alle pending Note-Offs sofort gesendet (kein stuck).
   */
  setMidiNoteOutEnabled(enabled: boolean) {
    this._midiNoteOut.setEnabled(enabled);
  }

  /** Setzt eine Per-Part-Config für MIDI-Note-Out. */
  setMidiNoteOutPartConfig(partId: string, config: MidiPartConfig) {
    this._midiNoteOut.setPartConfig(partId, config);
  }

  /** Entfernt eine Per-Part-Config (Part spielt wieder ausschließlich lokal). */
  clearMidiNoteOutPartConfig(partId: string) {
    this._midiNoteOut.clearPartConfig(partId);
  }

  /** Liefert die laufende MidiNoteOut-Instanz (read-only access für UI/Tests). */
  getMidiNoteOut(): MidiNoteOut {
    return this._midiNoteOut;
  }

  // ─── MIDI-Click-Out (v3.98.0) ────────────────────────────────────────────

  /**
   * Setzt den Sender fuer MIDI-Click-Out. Bekommt outputId + Bytes
   * (Note-On / Note-Off) und muss sie an den entsprechenden Web-MIDI-Output
   * routen. Typischerweise vom useMidi-Hook gebridged.
   */
  setMidiClickOutSender(sender: ((outputId: string, bytes: number[]) => void) | null) {
    this._midiClickOut.setSender(sender);
  }

  /** Aktiviert/deaktiviert MIDI-Click-Out. Bei Disable: pending Note-Offs werden geflusht. */
  setMidiClickOutEnabled(enabled: boolean) {
    this._midiClickOut.setEnabled(enabled);
  }

  /** Setzt/aktualisiert die Click-Out-Config (Output, Channel, Notes, Velocities). */
  setMidiClickOutConfig(config: Partial<MidiClickConfig>) {
    this._midiClickOut.setConfig(config);
  }

  /** Liefert die laufende MidiClickOut-Instanz (read-only access fuer UI/Tests). */
  getMidiClickOut(): MidiClickOut {
    return this._midiClickOut;
  }

  /**
   * v3.99.0: Setzt die Note-Duration fuer MIDI-Click-Out (ms). Wird bei jedem
   * Trigger an MidiClickOut.triggerStep durchgereicht. Wert wird intern auf
   * 1..10_000ms geclamped (siehe MidiClickOut.triggerStep), Store-Layer
   * begrenzt zusaetzlich auf 10..500ms (clampNoteDurationMs).
   */
  setMidiClickNoteDurationMs(ms: number) {
    if (!Number.isFinite(ms)) return;
    this._midiClickNoteDurationMs = Math.max(1, Math.min(10_000, Math.round(ms)));
  }

  /** v3.99.0: Aktiviert/deaktiviert den Count-In Pre-Roll bei play(). */
  setCountInEnabled(enabled: boolean) {
    this._countInEnabled = !!enabled;
  }

  /** v3.99.0: Setzt die Anzahl Pre-Roll-Bars (1..4). */
  setCountInBars(bars: number) {
    if (!Number.isFinite(bars)) return;
    this._countInBars = Math.max(1, Math.min(4, Math.round(bars)));
  }

  /** v3.99.0: Status-Getter fuer Tests/UI — laeuft gerade Pre-Roll? */
  isPreRollActive(): boolean {
    return this._preRollActive;
  }

  onPosition(cb: PositionCallback) {
    this.positionCallbacks.push(cb);
    return () => { this.positionCallbacks = this.positionCallbacks.filter(c => c !== cb); };
  }

  async play(fromStep = 0) {
    await this.init();
    await this.resume();
    if (this._isPlaying || this._preRollActive) this.stop();

    // v3.99.0: Count-In Pre-Roll — wenn aktiv, schedule N Bars Click vor
    // dem eigentlichen Pattern-Start. Bei Disable: direkter Start.
    if (this._countInEnabled) {
      await this._startWithCountIn(fromStep);
      return;
    }

    this._startPattern(fromStep);
  }

  /**
   * v3.99.0: Eigentlicher Pattern-Start ohne Pre-Roll. Wird direkt aus
   * play() (bei deaktiviertem Count-In) oder am Ende des Pre-Roll-Loops
   * aufgerufen.
   */
  private _startPattern(fromStep: number) {
    if (!this.ctx) return;
    this._isPlaying = true;
    // v3.37.0: Race-Fix — wenn explizit fromStep=0 übergeben wurde (Default
    // Call vom Transport-Hook) UND ein pendingStartStep gesetzt ist (vorher
    // via seekToStep z.B. durch SPP-driven Sync), konsumieren wir den Pending-
    // Wert. Explizit übergebene fromStep>0 bleiben unverändert.
    const pending = this._pendingStartStep;
    this._pendingStartStep = null;
    this._currentStep = (fromStep === 0 && pending !== null) ? pending : fromStep;
    this._nextStepTime = this.ctx.currentTime + 0.05;

    // Looper (TASK-235): Transport-Anchor für Bar-Boundary-Quantisierung.
    this._looperEngine.setTransportAnchor(this._nextStepTime);

    this.schedulerTimer = setInterval(() => this._schedule(), this.SCHEDULE_INTERVAL);

    // MIDI-Clock-Out: sendet 0xFA (Start) und initialisiert den 24-PPQN-Ticker.
    // (TASK-230) — der eigentliche Tick-Send läuft im _schedule()-Loop.
    this._midiClockOut.start(this._nextStepTime);

    // Externe Audio-Tracks (Vocals, Songs) parallel zum Step-Sequencer starten.
    this.playAllRegisteredAudioTracks();
  }

  /**
   * v3.99.0: Pre-Roll Count-In. Plant pro Beat (im aktuellen Pattern-BPM +
   * Beats-per-Bar) einen Click-Trigger (lokales Metronom + MIDI-Click-Out)
   * und dispatched ein `countin:tick`-CustomEvent fuer die UI. Nach dem
   * letzten Beat wird _startPattern(fromStep) gerufen.
   *
   * Total-Beats = countInBars * metronomBeatsPerBar.
   * Beat-Duration = 60 / effectiveBpm.
   */
  private async _startWithCountIn(fromStep: number): Promise<void> {
    if (!this.ctx) return;
    this._preRollActive = true;
    const beatsPerBar = this._metronomBeatsPerBar;
    const totalBeats = Math.max(1, this._countInBars * beatsPerBar);
    const pattern = this.patternGetter?.();
    const bpm = pattern?.bpm ?? this._bpm;
    const beatDur = 60 / Math.max(20, Math.min(300, bpm));
    const startTime = this.ctx.currentTime + 0.05;

    // Dispatch initial countdown-event
    this._dispatchCountInEvent("start", totalBeats, totalBeats);

    for (let i = 0; i < totalBeats; i++) {
      const isAccent = (i % beatsPerBar) === 0;
      const beatTime = startTime + i * beatDur;
      const delayMs = Math.max(0, (beatTime - this.ctx.currentTime) * 1000);
      const remaining = totalBeats - i;
      const tid = setTimeout(() => {
        this._preRollTimeouts.delete(tid);
        if (!this._preRollActive) return;
        // Lokales Click-Geraeusch (wenn Metronom enabled oder immer? — wir
        // spielen es immer waehrend Count-In, damit der User die Zaehlung hoert).
        if (this.ctx && this.masterGain) {
          const freq = isAccent ? this._metronomDownbeatFreq : this._metronomBeatFreq;
          const vol = isAccent ? Math.max(0.2, this._metronomAccent) : 0.5;
          try { this._playClick(this.ctx.currentTime, vol, freq, isAccent); } catch { /* ignore */ }
        }
        // MIDI-Click-Out: stepIndex 0 fuer accent, anderen Beat fuer beat. Wir
        // koennen direkt detectClickKind umgehen und manuell triggern.
        if (this._midiClickOut.enabled) {
          // Hack: triggerStep mit stepIndex=0 fuer accent, anderen Index fuer beat.
          // Sauberer: einfach stepIndex=0 (accent) bzw. stepIndex=1*stepsPerBeat (beat)
          // im stepRaster fuer den Beat-Detect Algorithmus. Wir nutzen die
          // bestehende Logik mit einem temporaeren stepIndex.
          const stepsPerBeat = Math.max(1, Math.round(this._steps / beatsPerBar));
          const fakeStep = isAccent ? 0 : stepsPerBeat;
          this._midiClickOut.triggerStep(fakeStep, this._steps, beatsPerBar, this._midiClickNoteDurationMs);
        }
        this._dispatchCountInEvent("tick", remaining, totalBeats);
      }, delayMs);
      this._preRollTimeouts.add(tid);
    }

    // Nach dem letzten Beat: tatsaechlicher Pattern-Start.
    const totalDurMs = Math.max(0, (startTime + totalBeats * beatDur - this.ctx.currentTime) * 1000);
    const startTid = setTimeout(() => {
      this._preRollTimeouts.delete(startTid);
      if (!this._preRollActive) return;
      this._preRollActive = false;
      this._dispatchCountInEvent("end", 0, totalBeats);
      this._startPattern(fromStep);
    }, totalDurMs);
    this._preRollTimeouts.add(startTid);
  }

  /** v3.99.0: Dispatcht ein 'countin:tick'-Event (UI hoert via window listener). */
  private _dispatchCountInEvent(phase: "start" | "tick" | "end", remaining: number, total: number) {
    if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent("countin:tick", {
        detail: { phase, remaining, total },
      }));
    } catch { /* ignore */ }
  }

  stop() {
    // v3.99.0: Pre-Roll-Timeouts canceln, falls Count-In gerade laeuft.
    if (this._preRollActive || this._preRollTimeouts.size > 0) {
      this._preRollTimeouts.forEach((id) => clearTimeout(id));
      this._preRollTimeouts.clear();
      this._preRollActive = false;
      this._dispatchCountInEvent("end", 0, 0);
    }
    // Audio-Tracks (Vocals/Songs) zuerst stoppen, solange ctx noch verfügbar ist.
    this.stopAllAudioTracks();
    this._isPlaying = false;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    // MIDI-Clock-Out: sendet 0xFC (Stop). (TASK-230)
    this._midiClockOut.stop();
    // MIDI-Note-Out (TASK-240): pending Note-Offs sofort flushen damit auf
    // dem externen Gerät keine Stuck Notes hängenbleiben. Wir tun das per
    // Disable/Enable-Cycle — Configs bleiben erhalten.
    if (this._midiNoteOut.enabled) {
      this._midiNoteOut.setEnabled(false);
      this._midiNoteOut.setEnabled(true);
    }
    // v3.98.0: MIDI-Click-Out — pending Note-Offs flushen (gleiches Pattern).
    if (this._midiClickOut.enabled) {
      this._midiClickOut.setEnabled(false);
      this._midiClickOut.setEnabled(true);
    }
    // Pending Position-Callbacks abräumen — sonst feuern sie nach Stop
    this._pendingTimeouts.forEach((id) => clearTimeout(id));
    this._pendingTimeouts.clear();
    this._currentStep = 0;
    // v2.14: Slide-State zurücksetzen damit beim nächsten Play die erste Note
    // nicht versehentlich vom letzten Run her gleitet.
    this._partSlideState.clear();
    this.positionCallbacks.forEach(cb => cb(0));
  }

  async previewSample(url: string, volume = 1.0) {
    await this.init();
    await this.resume();
    const buf = await this._loadBuffer(url);
    if (!buf || !this.ctx) return;
    this._triggerBufferDirect(buf, this.ctx.currentTime, volume, 0, 0);
  }

  async loadSample(url: string): Promise<AudioBuffer | null> {
    await this.init();
    return this._loadBuffer(url);
  }

  clearCache() {
    this.bufferCache.clear();
    this.loadingPromises.clear();
    this.channelNodes.clear();
    this.reverbBuffers.clear();
    // Aktive Aufnahmen abräumen (TASK-234) — verhindert Zombie-Recorder
    // wenn der Cache während einer aufnahme geleert wird.
    this._audioRecorder.dispose();
    // Live-Multi-Track-Recorder (v3.110.0) — falls noch eine Session läuft.
    this._liveRecorder.cancel();
    // Looper (TASK-235): Buffer + Nodes freigeben
    this._looperEngine.dispose();
  }

  /** Kanal-Effekte live aktualisieren (ohne Neustart) */
  updateChannelFx(partId: string, fx: ChannelFx) {
    if (!this.ctx) return;
    const nodes = this.channelNodes.get(partId);
    if (!nodes) return;
    this._applyFxToNodes(nodes, fx);
  }

  /** Fill-Mode aktiv/deaktiv setzen (für Conditional Triggers) */
  setFillActive(active: boolean) { this.isFillActive = active; }

  /** Performance Mode: Pattern mit Quantisierung wechseln */
  setQueuedPattern(patternId: string, quantize: "bar" | "beat" | "step" = "bar") {
    // Gleiche Pattern nochmal → Queue leeren
    if (this.queuedPatternId === patternId) {
      this.queuedPatternId = null;
    } else {
      this.queuedPatternId = patternId;
      this.quantizeMode = quantize;
    }
  }

  /** Callback wenn Pattern gewechselt wird (quantisiert) */
  onPatternSwitch(cb: (patternId: string) => void) {
    this.patternSwitchCallback = cb;
    return () => { this.patternSwitchCallback = null; };
  }

  // ─── Private: Step-Dauer ──────────────────────────────────────────────────

  private _stepDuration(resolution?: StepResolution, bpm = this._bpm): number {
    const res = resolution ?? this._stepResolution;
    const beatDuration = 60 / Math.max(20, Math.min(300, bpm));
    switch (res) {
      case "1/8":  return beatDuration / 2;   // Achtel
      case "1/16": return beatDuration / 4;   // Sechzehntel
      case "1/32": return beatDuration / 8;   // Zweiunddreißigstel
    }
  }

  private _schedule() {
    if (!this.ctx || !this._isPlaying) return;
    // v3.25.0: Live-Performance-Telemetrie. Performance.now() ist <1µs
    // Overhead. Wir messen die Dauer der vollständigen Scheduler-Iteration
    // (inkl. MIDI-Clock + Step-Scheduling). Schreiben ans Ende.
    const _perfT0 =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    const now = this.ctx.currentTime;
    const lookAheadUntil = now + this.LOOK_AHEAD;

    // MIDI-Clock-Out: 24 PPQN-Ticks im Look-Ahead-Fenster senden.
    // Nutzt die effektive BPM (pattern.bpm overrides this._bpm). (TASK-230)
    // v3.0.0: Eigener (kleinerer) Lookahead reduziert Lead-Latenz zum
    // externen Empfänger ohne den Step-Scheduler zu beeinflussen.
    const clockPattern = this.patternGetter?.();
    const clockBpm = clockPattern?.bpm ?? this._bpm;
    const clockLookAheadUntil = now + this.MIDI_CLOCK_LOOK_AHEAD;
    this._midiClockOut.scheduleTicks(clockLookAheadUntil, clockBpm);

    while (this._nextStepTime < lookAheadUntil) {
      const pattern = this.patternGetter?.();
      // v3.95.0: Tempo-Map hat Vorrang vor pattern.bpm und this._bpm wenn aktiv.
      // Backward-Compat: Resolver liefert null bei leerer Map → faellt auf den
      // bisherigen pattern?.bpm ?? this._bpm Pfad zurueck.
      const tempoMapBpm = this._resolveTempoMapBpm();
      const effectiveBpm = tempoMapBpm ?? pattern?.bpm ?? this._bpm;
      // Side-effect: synchronisiere _bpm wenn die Tempo-Map einen neuen Wert
      // liefert — damit UI-BPM-Anzeige + Looper + AudioTracks updaten.
      if (tempoMapBpm !== null && Math.abs(this._bpm - tempoMapBpm) > 0.05) {
        this._bpm = tempoMapBpm;
        this._updateAudioTrackPlaybackRates();
        this._looperEngine.setBpm(this._bpm);
      }
      const effectiveResolution = pattern?.stepResolution ?? this._stepResolution;
      this._scheduleStep(this._currentStep, this._nextStepTime, pattern);
      // Loop-Count inkrementieren wenn Pattern-Wrap erfolgt
      if (this._currentStep === this._steps - 1) {
        this.loopCount++;
        // Quantisierter Pattern-Wechsel (Performance Mode)
        if (this.queuedPatternId && this.quantizeMode === "bar") {
          const nextId = this.queuedPatternId;
          this.queuedPatternId = null;
          this.patternSwitchCallback?.(nextId);
        }
      } else if (this._currentStep === 0 && this.queuedPatternId && this.quantizeMode === "beat") {
        const stepsPerBeat = Math.round(this._steps / this._metronomBeatsPerBar);
        if (this._currentStep % stepsPerBeat === 0) {
          const nextId = this.queuedPatternId;
          this.queuedPatternId = null;
          this.patternSwitchCallback?.(nextId);
        }
      }
      this._currentStep = (this._currentStep + 1) % this._steps;
      this._nextStepTime += this._stepDuration(effectiveResolution, effectiveBpm);
      // Sofortiger Wechsel (quantizeMode=step)
      if (this.queuedPatternId && this.quantizeMode === "step") {
        const nextId = this.queuedPatternId;
        this.queuedPatternId = null;
        this.patternSwitchCallback?.(nextId);
      }
    }
    // v3.25.0: Telemetrie schreiben. Defensive vs. Store-Throws.
    try {
      const t1 =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      _perfRecordScheduleTick(t1 - _perfT0);
    } catch {
      /* ignore — Telemetry darf den Audio-Pfad nie crashen */
    }
  }

  // ─── Private: Probability-Check ──────────────────────────────────────────

  /** Prüft ob ein Step ausgelöst werden soll (Probability + Condition + Probability Chains) */
  shouldTriggerStep(step: StepData, partId?: string, stepIndex?: number): boolean {
    if (!step.active) return false;
    let prob = Math.max(0, Math.min(100, step.probability ?? 100));

    // Probability Chain: Modifier aus vorherigem Step anwenden
    if (partId !== undefined && stepIndex !== undefined) {
      const key = `${partId}:${stepIndex}`;
      const mod = this._probabilityChainMods.get(key) ?? 0;
      prob = Math.max(0, Math.min(100, prob + mod));
    }

    if (prob <= 0) return false;
    const fires = prob >= 100 || Math.random() * 100 <= prob;

    // Probability Chain: Nächsten Step-Modifier setzen
    if (partId !== undefined && stepIndex !== undefined && step.chainNext && step.chainNext !== "none") {
      const nextKey = `${partId}:${stepIndex + 1}`;
      if (fires) {
        this._probabilityChainMods.set(nextKey, step.chainNext === "up" ? 25 : -25);
      }
    }

    if (!fires) return false;
    const condition = step.condition;
    if (!condition || condition.type === "always") return true;
    if (condition.type === "every") {
      return (this.loopCount % condition.of) === (condition.n - 1);
    }
    if (condition.type === "fill") return this.isFillActive;
    if (condition.type === "not_fill") return !this.isFillActive;
    return true;
  }

  private _scheduleStep(stepIndex: number, time: number, scheduledPattern?: PatternData) {
    const step = stepIndex;
    // Pending UI-Callback in der ID-Liste tracken, damit stop() ihn clearen kann
    const tid = setTimeout(() => {
      this._pendingTimeouts.delete(tid);
      if (!this._isPlaying) return;
      this.positionCallbacks.forEach(cb => cb(step));

      // Bar-Counter + Follow Action
      if (step === 0) {
        this._barCount++;
        const pattern = this.patternGetter?.();
        if (pattern?.followAction && pattern.followAction.type !== "none") {
          const fa = pattern.followAction;
          if (this._barCount >= fa.barsBeforeSwitch) {
            this._barCount = 0;
            this._followActionCallback?.(fa, pattern.id);
          }
        }
      }
    }, Math.max(0, (time - (this.ctx?.currentTime ?? 0)) * 1000 - 5));
    this._pendingTimeouts.add(tid);

    // Metronom
    if (this._metronomEnabled && this.ctx && this.masterGain) {
      const beatsPerBar = this._metronomBeatsPerBar;
      const totalSteps = this._steps;

      // Korrekte Beat-Erkennung für beliebige Taktarten:
      // Beat b liegt genau bei Step = round(b * totalSteps / beatsPerBar).
      // Wir prüfen, ob stepIndex der repräsentative Step für den nächsten Beat ist.
      const closestBeat = Math.round((stepIndex * beatsPerBar) / totalSteps);
      const representStep = Math.round((closestBeat * totalSteps) / beatsPerBar) % totalSteps;
      const isBeat = representStep === stepIndex;
      const isDownbeat = stepIndex === 0;

      // Unterteilung
      const stepsPerHalfBeat = Math.max(1, Math.round(totalSteps / beatsPerBar / 2));
      let shouldClick = false;
      if (this._metronomSubdivision === "beat") {
        shouldClick = isBeat;
      } else if (this._metronomSubdivision === "eighth") {
        shouldClick = stepIndex % stepsPerHalfBeat === 0;
      } else {
        shouldClick = true; // sixteenth: jeder Step
      }

      if (shouldClick) {
        const vol = isDownbeat
          ? Math.max(0.2, this._metronomAccent)
          : isBeat
            ? Math.max(0.05, 0.7 / Math.max(0.2, this._metronomAccent))
            : Math.max(0.02, 0.3 / Math.max(0.2, this._metronomAccent));
        const freq = isDownbeat ? this._metronomDownbeatFreq : this._metronomBeatFreq;
        this._playClick(time, vol, freq, isDownbeat);
      }
    }

    // v3.98.0: MIDI-Click-Out parallel zum lokalen Metronom. Unabhaengig von
    // _metronomEnabled — User kann externe Click-Spur (KORG Volca, Drum-Machine)
    // ohne lokales Click-Geraeusch laufen lassen. Beat-Detection in MidiClickOut
    // dupliziert die Formel (closestBeat/representStep) damit der Click-Out
    // auch bei beliebigen Pattern-Laengen + Taktarten korrekt liegt.
    this._midiClickOut.triggerStep(stepIndex, this._steps, this._metronomBeatsPerBar, this._midiClickNoteDurationMs);

    if (!scheduledPattern && !this.patternGetter) return;
    const pattern = scheduledPattern ?? this.patternGetter!();

    // Cross-Store Solo-Check (FOLLOWUP-102/B): Drum + Audio-Track Solo wirken zusammen.
    // Wenn irgendein Audio-Track soloed ist, werden alle nicht-soloed Drum-Parts
    // ebenfalls stumm — analog zum Mixer-Mute-Verhalten von _reapplyAudioTrackSoloMutes.
    const anyDrumSolo = pattern.parts.some(p => p.soloed);
    const anyAudioSolo = this.audioTracksGetter?.().some(t => t.soloed) ?? false;
    const anySolo = anyDrumSolo || anyAudioSolo;

    pattern.parts.forEach((part, partIndex) => {
      if (part.muted) return;
      if (anySolo && !part.soloed) return;

      // Polymeter: bei eigener stepLength wrappt der Part modular
      const effIdx = part.stepLength && part.stepLength > 0
        ? stepIndex % part.stepLength
        : stepIndex;
      const step = part.steps[effIdx];
      if (!step || !this.shouldTriggerStep(step, part.id, effIdx)) return;

      // Micro-Timing: zeitlicher Offset in ms (statisch pro Part)
      const microOffsetSec = (part.microTiming ?? 0) / 1000;

      // Humanizer: Swing + Timing-Jitter (dynamisch)
      let humanizerTimingOffset = 0;
      let humanizerVelocityMult = 1.0;
      try {
        // Lazy require um Zirkular-Imports zu vermeiden
        const hum = (globalThis as Record<string, unknown>)["__synthstudio_humanizer__"] as
          | { timing: (i: number, d: number, p?: number) => number; velocity: (p?: number) => number }
          | undefined;
        if (hum) {
          humanizerTimingOffset = hum.timing(effIdx, this._stepDuration(), partIndex);
          humanizerVelocityMult = hum.velocity(partIndex);
        }
      } catch { /* ignore */ }

      const scheduledTime = time + microOffsetSec + humanizerTimingOffset;
      const humanizedVelocity = Math.max(1, Math.min(127, Math.round((step.velocity ?? 100) * humanizerVelocityMult)));

      const scheduled: ScheduledStep = {
        partIndex,
        stepIndex,
        time: scheduledTime,
        velocity: humanizedVelocity,
        pan: part.pan ?? 0,
        pitch: step.pitch ?? 0,
        reverse: step.reverse ?? false,
      };

      this.stepCallbacks.forEach(cb => cb(scheduled));

      // MIDI-Note-Out (TASK-240 / v2.92): wenn Part eine externe MIDI-Out-Config
      // hat (z.B. KORG Electribe), Note-On feuern. Note-Off läuft intern über
      // setTimeout im MidiNoteOut. Parallel zum optionalen lokalen Sample (siehe
      // shouldPlayLocalSound-Check weiter unten).
      this._midiNoteOut.triggerNote(part.id, scheduledTime, humanizedVelocity);

      // MIDI Clock: 6 Pulse pro 1/16-Step (= 24 Pulse/Viertelnote)
      if (this._midiClockCallback) {
        const clockMsg = new Uint8Array([0xF8]);
        for (let p = 0; p < 6; p++) {
          const pulseTime = time + (p / 6) * this._stepDuration();
          setTimeout(() => this._midiClockCallback?.(clockMsg), Math.max(0, (pulseTime - (this.ctx?.currentTime ?? 0)) * 1000));
        }
      }

      // Parameter Lock: pro-Step FX-Overrides anwenden
      if (step.paramLock && Object.keys(step.paramLock).length > 0) {
        const stepDuration = this._stepDuration(pattern.stepResolution ?? part.stepResolution);
        this.applyParamLock(part.id, step.paramLock, stepDuration);
      }

      // MIDI Out: Note senden wenn Callback registriert
      if (this._midiOutCallback) {
        const midiNote = 36 + (scheduled.partIndex % 32); // GM Drum Map Basis
        this._midiOutCallback(midiNote, scheduled.velocity, part.id);
      }

      // Sidechain ducking: wenn dieser Part als Quelle für andere Parts konfiguriert ist,
      // Gain-Automation auf die Ziel-Parts anwenden
      if (this.ctx) {
        const srcId = part.id;
        this._sidechainSettings.forEach((sc, targetId) => {
          if (sc.sourcePartId !== srcId || !sc.enabled) return;
          const targetNodes = this.channelNodes.get(targetId);
          if (!targetNodes) return;
          const g = targetNodes.sidechainGain.gain;
          const duckLevel = Math.max(0, 1 - sc.amount);
          // Sofortiger Duck zum Step-Zeitpunkt
          g.cancelScheduledValues(time);
          g.setValueAtTime(duckLevel, time);
          // Linearer Ramp zurück zu 1 über release-Zeit
          g.linearRampToValueAtTime(1, time + sc.release);
        });
      }

      // Local-Sound-Gate (TASK-240): wenn Part nur als MIDI-Out konfiguriert
      // ist (localSoundEnabled=false), Sample-/Synth-Trigger überspringen.
      // shouldPlayLocalSound liefert true wenn kein MIDI-Out-Config existiert
      // (Backwards-Compat) oder localSoundEnabled !== false.
      if (!this._midiNoteOut.shouldPlayLocalSound(part.id)) {
        return;
      }

      // Synth-Pfad (TASK-129): Parts mit sourceType=wavetable/fm + synthParams
      // werden über SynthEngine getriggert. Hat Vorrang vor sampleUrl, damit
      // Synth-Parts, die irrtümlich ein altes sampleUrl-Feld tragen, trotzdem
      // korrekt als Synth abgespielt werden.
      const isSynthPart = !!part.synthParams && (part.sourceType === "wavetable" || part.sourceType === "fm");
      if (isSynthPart) {
        const vol = (scheduled.velocity / 127) * (part.volume ?? 1.0);
        // Drum-Step hat keine eigene Note — A4 (440 Hz) als Basis, step.pitch
        // wird als Halbton-Transpose appliziert (analog zur melodischen Logik).
        const freq = 440 * Math.pow(2, scheduled.pitch / 12);
        this._triggerSynthOnChannel(scheduled.time, freq, vol, scheduled.pan, part, !!step.slide);
      } else if (part.sampleUrl) {
        const stepLength = step.length ?? 1;
        const partRef = part;
        (async () => {
          const buf = await this._loadBuffer(partRef.sampleUrl!);
          if (!buf || !this.ctx) return;
          const vol = (scheduled.velocity / 127) * (partRef.volume ?? 1.0);
          let playBuf = scheduled.reverse ? this._reverseBuffer(buf) : buf;
          if (partRef.stretchRatio && Math.abs(partRef.stretchRatio - 1) > 0.01) {
            const { getCachedStretchBuffer } = await import("./timeStretchUtils");
            playBuf = getCachedStretchBuffer(this.ctx, partRef.sampleUrl!, playBuf, partRef.stretchRatio);
          }
          this._triggerBufferWithFx(playBuf, scheduled.time, vol, scheduled.pan, scheduled.pitch, partRef, stepLength);
        })();
      }
    });

    // ─── Melodische Parts (Piano Roll) ────────────────────────────────────
    // Nutzt denselben cross-store Solo-Check wie der Drum-Loop oben.
    if (this.melodicGetter) {
      pattern.parts.forEach((part) => {
        if (part.muted) return;
        if (anySolo && !part.soloed) return;

        const melodicSteps = this.melodicGetter!(part.id);
        if (!melodicSteps) return;
        const mIdx = part.stepLength && part.stepLength > 0
          ? stepIndex % part.stepLength
          : stepIndex;
        const mStep = melodicSteps[mIdx];
        if (!mStep?.active) return;

        const vol = (mStep.velocity / 127) * (part.volume ?? 1.0);
        const transposedNote = Math.max(0, Math.min(127, mStep.note + this._globalTranspose));
        const freq = 440 * Math.pow(2, (transposedNote - 69) / 12);
        this._triggerMelodicNote(time, freq, vol, part.pan ?? 0, part);
      });
    }

    // ─── Gestapelte Patterns ─────────────────────────────────────────────────
    if (this._stackedPatternIds.size > 0) {
      window.dispatchEvent(new CustomEvent("audio:stackedStep", { detail: { stepIndex, time } }));
    }
  }

  // ─── Private: Sample triggern mit Effektkette ─────────────────────────────

  private _triggerBufferWithFx(
    buf: AudioBuffer,
    time: number,
    volume: number,
    pan: number,
    pitch: number,
    part: PartData,
    stepLengthMultiplier = 1,
  ) {
    if (!this.ctx || !this.masterGain) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buf;

    // Note Length: kürzt oder verlängert Sample-Abspieldauer
    if (stepLengthMultiplier !== 1 && stepLengthMultiplier > 0) {
      const stepDur = this._stepDuration();
      const maxDur  = stepDur * stepLengthMultiplier;
      // Kurze Note: Sample nach maxDur abschneiden
      if (stepLengthMultiplier < 1) {
        source.stop(Math.max(time, this.ctx.currentTime) + maxDur);
      }
      // Lange Note: Sample bis zu maxDur* laufen lassen (kein künstliches Verlängern)
    }

    // Pitch-Shift über Halbtöne (Time-Stretch wird via OLA vorverarbeitet, kein pitchRate-Kompromiss)
    const pitchRate = pitch !== 0 ? Math.pow(2, pitch / 12) : 1;
    source.playbackRate.value = pitchRate;

    // Kanal-Knoten holen oder erstellen
    const nodes = this._getOrCreateChannelNodes(part.id, part.fx);

    // Volume in den Kanal-Input
    nodes.input.gain.value = Math.max(0, Math.min(2, volume));
    nodes.panner.pan.value = Math.max(-1, Math.min(1, pan));

    source.connect(nodes.input);
    source.start(Math.max(time, this.ctx.currentTime));
  }

  /** Wendet Parameter-Lock-Werte an und stellt sie nach duration wieder her. */
  applyParamLock(partId: string, lock: import("./AudioEngine").StepParamLock, duration: number): void {
    if (!this.ctx) return;
    const nodes = this.channelNodes.get(partId);
    if (!nodes) return;
    const now = this.ctx.currentTime;
    const restoreTime = now + duration;

    if (lock.volume !== undefined) {
      nodes.input.gain.setValueAtTime(lock.volume, now);
      nodes.input.gain.setValueAtTime(nodes.input.gain.value, restoreTime);
    }
    if (lock.pan !== undefined) {
      nodes.panner.pan.setValueAtTime(lock.pan, now);
      nodes.panner.pan.setValueAtTime(nodes.panner.pan.value, restoreTime);
    }
    if (lock.filterFreq !== undefined) {
      nodes.filter.frequency.setValueAtTime(lock.filterFreq, now);
      nodes.filter.frequency.setValueAtTime(nodes.filter.frequency.value, restoreTime);
    }
    if (lock.reverbSend !== undefined) {
      nodes.globalReverbSend.gain.setValueAtTime(lock.reverbSend, now);
      nodes.globalReverbSend.gain.setValueAtTime(nodes.globalReverbSend.gain.value, restoreTime);
    }
    if (lock.delaySend !== undefined) {
      nodes.globalDelaySend.gain.setValueAtTime(lock.delaySend, now);
      nodes.globalDelaySend.gain.setValueAtTime(nodes.globalDelaySend.gain.value, restoreTime);
    }
  }

  /**
   * Synth-Part triggern und durch die Channel-FX-Chain routen (TASK-129).
   *
   * SynthEngine.triggerNote() schreibt in `nodes.input` (Channel-Input-GainNode)
   * statt direkt zu masterGain — damit propagieren Channel-FX (EQ, Filter,
   * Distortion, Compressor, Sidechain, Delay/Reverb-Sends, Insert-Chain)
   * korrekt. Volume + Pan werden über `nodes.input.gain` / `nodes.panner.pan`
   * gesetzt — analog zum Sample-Pfad (`_triggerBufferWithFx`).
   *
   * partId wird durchgereicht → Macro-LFO-Cache (TASK-117/128) wird konsultiert.
   *
   * @returns true wenn die SynthEngine genutzt wurde, false wenn Voraussetzungen
   *          fehlen (kein ctx, kein synthParams, falscher sourceType) — Aufrufer
   *          kann auf Fallback-Pfad ausweichen.
   */
  private _triggerSynthOnChannel(time: number, freq: number, volume: number, pan: number, part: PartData, slide = false): boolean {
    if (!this.ctx) return false;
    if (!part.synthParams) return false;
    if (part.sourceType !== "wavetable" && part.sourceType !== "fm") return false;

    const eng = this._getOrCreateSynthEngine();
    if (!eng) return false;

    const nodes = this._getOrCreateChannelNodes(part.id, part.fx);
    nodes.input.gain.value = Math.max(0, Math.min(2, volume));
    nodes.panner.pan.value = Math.max(-1, Math.min(1, pan));

    const now = Math.max(time, this.ctx.currentTime);

    // v2.14: Per-Step-Slide. Wenn der vorherige Step `slide=true` hatte,
    // ramp der neue Note von der alten Frequenz auf die aktuelle.
    const prevState = this._partSlideState.get(part.id);
    const stepDur = this._stepDuration();
    let synthParams = part.synthParams;
    let prevFreq: number | undefined = undefined;
    if (prevState?.lastHadSlide && prevState.lastFreq && prevState.lastFreq !== freq) {
      // Glide-Override für diese Note (ohne Mutation des persistierten Params).
      synthParams = { ...part.synthParams, glide: Math.max(0.005, stepDur * 0.8) };
      prevFreq = prevState.lastFreq;
    }
    eng.triggerNote(freq, synthParams, now, prevFreq, part.id, nodes.input);

    // State für die nächste Note merken
    this._partSlideState.set(part.id, { lastFreq: freq, lastHadSlide: slide });
    return true;
  }

  /**
   * Melodische Note abspielen (Piano Roll Playback).
   *
   * TASK-128 (v1.23.0): Synth-Parts (sourceType `wavetable`/`fm`) routen über
   * `SynthEngine.triggerNote()` mit partId — das aktiviert den Macro-LFO-Cache
   * (TASK-117).
   * TASK-129 (v1.23.0): Synth-Output geht jetzt durch die Channel-FX-Chain
   * (via `_triggerSynthOnChannel`) statt direkt zu masterGain. Parts ohne
   * synthParams oder mit unbekanntem sourceType fallen auf den simplen
   * Triangle-Oscillator-Pfad zurück (Backwards-Compat).
   */
  private _triggerMelodicNote(time: number, freq: number, volume: number, pan: number, part?: PartData): void {
    if (!this.ctx || !this.masterGain) return;

    // Synth-Pfad mit Channel-FX-Routing (TASK-128 + TASK-129)
    if (part && this._triggerSynthOnChannel(time, freq, volume, pan, part)) return;

    // Fallback-Pfad: simpler Triangle-Oscillator (Default für Parts ohne synthParams)
    const now = Math.max(time, this.ctx.currentTime);
    const duration = Math.max(0.05, 60 / this._bpm / 4); // 1/16-Note

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();

    osc.type = "triangle";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, volume)) * 0.5, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, now + duration);
    panner.pan.value = Math.max(-1, Math.min(1, pan));

    osc.connect(env);
    env.connect(panner);
    panner.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  /** Sample mit optionaler Slice-Region abspielen */
  triggerDrum(
    partId: string,
    buf: AudioBuffer,
    time: number,
    volume: number,
    pan: number,
    pitch: number,
    part: PartData,
    options?: {
      sliceStart?: number;  // Sekunden
      sliceEnd?: number;    // Sekunden
      loopMode?: "one-shot" | "loop" | "ping-pong";
      reverse?: boolean;
    }
  ) {
    if (!this.ctx || !this.masterGain) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    if (pitch !== 0) source.playbackRate.value = Math.pow(2, pitch / 12);
    if (options?.reverse) source.playbackRate.value *= -1;
    if (options?.loopMode === "loop" || options?.loopMode === "ping-pong") {
      source.loop = true;
      if (options.sliceStart != null) source.loopStart = options.sliceStart;
      if (options.sliceEnd != null) source.loopEnd = options.sliceEnd;
    }
    const nodes = this._getOrCreateChannelNodes(part.id, part.fx);
    nodes.input.gain.value = Math.max(0, Math.min(2, volume));
    nodes.panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(nodes.input);
    const startTime = Math.max(time, this.ctx.currentTime);
    const offset = options?.sliceStart ?? 0;
    const duration = options?.sliceEnd != null ? options.sliceEnd - offset : undefined;
    source.start(startTime, offset, duration);
  }

  /** Direktes Triggern ohne Effektkette (für Preview) */
  private _triggerBufferDirect(buf: AudioBuffer, time: number, volume: number, pan: number, pitch: number) {
    if (!this.ctx || !this.masterGain) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    if (pitch !== 0) source.playbackRate.value = Math.pow(2, pitch / 12);

    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(2, volume));
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;

    source.connect(gain);
    gain.connect(panner);
    panner.connect(this.masterGain);
    source.start(Math.max(time, this.ctx.currentTime));
  }

  // ─── Private: Kanal-Knoten verwalten ─────────────────────────────────────

  private _getOrCreateChannelNodes(partId: string, fx: ChannelFx): ChannelNodes {
    const existing = this.channelNodes.get(partId);
    if (existing) return existing;

    const ctx = this.ctx!;
    const master = this.masterGain!;

    // Input-Gain
    const input = ctx.createGain();

    // 3-Band EQ
    const eqLow = ctx.createBiquadFilter();
    eqLow.type = "lowshelf";
    eqLow.frequency.value = 200;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = "peaking";
    eqMid.frequency.value = 1000;
    eqMid.Q.value = 1;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = "highshelf";
    eqHigh.frequency.value = 6000;

    // Filter
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 8000;
    filter.Q.value = 1;

    // Distortion
    const distortion = ctx.createWaveShaper();
    distortion.curve = this._makeDistortionCurve(0);
    distortion.oversample = "4x";

    // Compressor
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    // Delay
    const delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.25;
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.3;
    const delayDry = ctx.createGain();
    delayDry.gain.value = 1.0;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0;

    // Reverb
    const reverbConvolver = ctx.createConvolver();
    const reverbDry = ctx.createGain();
    reverbDry.gain.value = 1.0;
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 0;

    // Output + Panner
    const output = ctx.createGain();
    output.gain.value = 1.0;
    const panner = ctx.createStereoPanner();
    panner.pan.value = 0;

    // ── Signal-Kette ──────────────────────────────────────────────────────
    // input → EQ → filter → distortion → compressor
    //       → delay (dry/wet) → reverb (dry/wet) → output → panner → master

    input.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(filter);
    filter.connect(distortion);
    distortion.connect(compressor);

    // Delay-Routing: Dry + Wet
    compressor.connect(delayDry);
    compressor.connect(delayNode);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode); // Feedback-Loop
    delayNode.connect(delayWet);

    // Reverb-Routing: Dry + Wet
    delayDry.connect(reverbDry);
    delayWet.connect(reverbDry); // Delay-Output auch in Reverb-Dry
    reverbDry.connect(output);
    reverbDry.connect(reverbConvolver);
    reverbConvolver.connect(reverbWet);
    reverbWet.connect(output);

    // Global-Bus Sends (Reverb + Delay)
    const globalReverbSend = ctx.createGain();
    globalReverbSend.gain.value = 0;
    const globalDelaySend = ctx.createGain();
    globalDelaySend.gain.value = 0;

    // Sidechain ducking gain (default 1 = kein Ducking)
    const sidechainGain = ctx.createGain();
    sidechainGain.gain.value = 1;

    output.connect(panner);
    panner.connect(sidechainGain);
    // v3.79.1: Wenn der Channel bereits einem Sub-Mix-Bus zugewiesen ist,
    // route direkt dorthin statt zu master. Sonst default master.
    sidechainGain.connect(this._resolveChannelDestination(partId));

    // Sends vom Output in globale Buses.
    // v3.75.0: Reverb-Pfad geht jetzt durch den PreDelay-Node, damit der
    // User Pre-Delay live einstellen kann. Wenn _globalReverbPreDelay
    // existiert: send → preDelay → damping → convolver → wet. Sonst Fallback
    // (sehr alte Engine ohne v3.75-init): direkt in den Convolver.
    if (this._globalReverbPreDelay) {
      output.connect(globalReverbSend);
      globalReverbSend.connect(this._globalReverbPreDelay);
    } else if (this._globalReverbBus) {
      output.connect(globalReverbSend);
      globalReverbSend.connect(this._globalReverbBus);
    }
    if (this._globalDelayBus) output.connect(globalDelaySend);
    if (this._globalDelayBus) globalDelaySend.connect(this._globalDelayBus);

    const nodes: ChannelNodes = {
      input, eq: { low: eqLow, mid: eqMid, high: eqHigh },
      filter, distortion, compressor,
      delayNode, delayFeedback, delayDry, delayWet,
      reverbConvolver, reverbDry, reverbWet,
      output, panner, sidechainGain,
      globalReverbSend, globalDelaySend,
    };

    this._applyFxToNodes(nodes, fx);
    this.channelNodes.set(partId, nodes);
    return nodes;
  }

  private _applyFxToNodes(nodes: ChannelNodes, fx: ChannelFx) {
    if (!this.ctx) return;

    // EQ
    nodes.eq.low.gain.value = fx.eqEnabled ? fx.eqLow : 0;
    nodes.eq.mid.gain.value = fx.eqEnabled ? fx.eqMid : 0;
    nodes.eq.high.gain.value = fx.eqEnabled ? fx.eqHigh : 0;

    // Filter
    if (fx.filterEnabled) {
      nodes.filter.type = fx.filterType;
      nodes.filter.frequency.value = Math.max(20, Math.min(20000, fx.filterFreq));
      nodes.filter.Q.value = Math.max(0.1, Math.min(20, fx.filterQ));
    } else {
      nodes.filter.type = "allpass"; // Bypass
    }

    // Distortion
    nodes.distortion.curve = fx.distortionEnabled
      ? this._makeDistortionCurve(fx.distortionAmount)
      : this._makeDistortionCurve(0);

    // Compressor
    if (fx.compressorEnabled) {
      nodes.compressor.threshold.value = fx.compressorThreshold;
      nodes.compressor.ratio.value = fx.compressorRatio;
      nodes.compressor.attack.value = fx.compressorAttack;
      nodes.compressor.release.value = fx.compressorRelease;
    } else {
      nodes.compressor.threshold.value = 0;
      nodes.compressor.ratio.value = 1;
    }

    // Delay
    nodes.delayNode.delayTime.value = fx.delayTime;
    nodes.delayFeedback.gain.value = fx.delayEnabled ? Math.min(0.95, fx.delayFeedback) : 0;
    nodes.delayWet.gain.value = fx.delayEnabled ? fx.delayMix : 0;
    nodes.delayDry.gain.value = 1.0;

    // Reverb
    nodes.reverbWet.gain.value = fx.reverbEnabled ? fx.reverbMix : 0;
    nodes.reverbDry.gain.value = 1.0;
    if (fx.reverbEnabled) {
      this._getOrCreateReverbBuffer(fx.reverbDecay).then(buf => {
        if (buf) nodes.reverbConvolver.buffer = buf;
      });
    }
  }

  private _makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const samples = 256;
    const curve = new Float32Array(samples);
    const k = amount;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      if (k === 0) {
        curve[i] = x;
      } else {
        curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
      }
    }
    return curve;
  }

  private async _getOrCreateReverbBuffer(decay: number, damping = 0.5): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    // Cache-Key über Decay + Damping (Damping beeinflusst IR-Tiefpass am
    // Sample, nicht nur den Bus-Filter — bei extremen damping-Werten
    // klingt das deutlich anders).
    const key = `${decay.toFixed(1)}_${damping.toFixed(2)}`;
    const cached = this.reverbBuffers.get(key);
    if (cached) return cached;

    // Synthetischen Reverb-IR generieren mit damping-skaliertem
    // Smoothing-Faktor. damping=0 → fast kein Smoothing (heller IR),
    // damping=1 → starkes Smoothing (dunkler IR).
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * Math.max(0.1, Math.min(10, decay)));
    const buf = this.ctx.createBuffer(2, length, sampleRate);
    const dampClamped = Math.max(0, Math.min(1, damping));
    // smoothing-coefficient: 0..0.95 ; ein-Pol-IIR Lowpass auf den Noise.
    const a = dampClamped * 0.95;

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let prev = 0;
      for (let i = 0; i < length; i++) {
        const noise = (Math.random() * 2 - 1);
        // exponential decay envelope
        const env = Math.pow(1 - i / length, 2);
        // smooth noise with one-pole filter for damping
        prev = a * prev + (1 - a) * noise;
        data[i] = prev * env;
      }
    }

    this.reverbBuffers.set(key, buf);
    return buf;
  }

  /**
   * v3.75.0: Konvertiert damping (0..1) auf den Lowpass-Cutoff am Reverb-Bus.
   * damping=0 → 20kHz (offen, kein Tiefpass), damping=1 → 500Hz (sehr dark).
   * Exponentiell skaliert, weil Filterwahrnehmung logarithmisch ist.
   */
  private _dampingToHz(damping: number): number {
    const d = Math.max(0, Math.min(1, damping));
    // 1 - d ∈ [0,1]; min=500, max=20000 → logarithmisch
    const minHz = 500;
    const maxHz = 20000;
    return minHz * Math.pow(maxHz / minHz, 1 - d);
  }

  /**
   * v3.75.0: IR-Regeneration für den globalen Reverb-Bus. Wird bei
   * decay/damping-Changes und in init() aufgerufen. Idempotent: wenn kein
   * Convolver vorhanden ist (z.B. Engine nicht initialisiert), no-op.
   */
  private _regenerateReverbIr(): void {
    if (!this._globalReverbBus) return;
    void this._getOrCreateReverbBuffer(this._globalReverbDecay, this._globalReverbDamping01).then(buf => {
      if (buf && this._globalReverbBus) this._globalReverbBus.buffer = buf;
    });
  }

  // ─── Master-FX Public Setter (v3.75.0) ─────────────────────────────────────

  /** Master-Reverb Decay (0.1..10 Sekunden). Triggert IR-Neugenerierung. */
  setMasterReverbDecay(decay: number): void {
    const clamped = Math.max(0.1, Math.min(10, decay));
    this._globalReverbDecay = clamped;
    this._regenerateReverbIr();
  }

  /** Master-Reverb Damping (0..1). Setzt Lowpass-Cutoff + Re-generiert IR. */
  setMasterReverbDamping(damping: number): void {
    const clamped = Math.max(0, Math.min(1, damping));
    this._globalReverbDamping01 = clamped;
    if (this._globalReverbDamping && this.ctx) {
      this._globalReverbDamping.frequency.setTargetAtTime(
        this._dampingToHz(clamped), this.ctx.currentTime, 0.05,
      );
    }
    this._regenerateReverbIr();
  }

  /** Master-Reverb PreDelay (0..200ms). */
  setMasterReverbPreDelay(ms: number): void {
    const clamped = Math.max(0, Math.min(200, ms));
    if (this._globalReverbPreDelay && this.ctx) {
      this._globalReverbPreDelay.delayTime.setTargetAtTime(
        clamped / 1000, this.ctx.currentTime, 0.01,
      );
    }
  }

  /** Master-Reverb Wet-Level (0..1). */
  setMasterReverbWet(wet: number): void {
    const clamped = Math.max(0, Math.min(1, wet));
    this._globalReverbWetLevel = clamped;
    if (this._globalReverbWet && this.ctx) {
      const target = this._globalReverbBypass ? 0 : clamped;
      this._globalReverbWet.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
    }
  }

  /** Master-Reverb Bypass. Setzt Wet-Gain auf 0 ohne den State zu verlieren. */
  setMasterReverbBypass(bypass: boolean): void {
    this._globalReverbBypass = bypass;
    if (this._globalReverbWet && this.ctx) {
      const target = bypass ? 0 : this._globalReverbWetLevel;
      this._globalReverbWet.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
    }
  }

  /** Master-Delay Time (0.001..2 Sekunden). */
  setMasterDelayTime(timeSec: number): void {
    const clamped = Math.max(0.001, Math.min(2.0, timeSec));
    if (this._globalDelayBus && this.ctx) {
      this._globalDelayBus.delayTime.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Master-Delay Feedback (0..0.95). Engine clampt hart auf 0.95 als
   * Stabilitätsgrenze — höhere Werte führen zu monotonem Anschwellen
   * (Feedback-Loop-Selbsterregung).
   */
  setMasterDelayFeedback(feedback: number): void {
    const clamped = Math.max(0, Math.min(0.95, feedback));
    if (this._globalDelayFeedback && this.ctx) {
      this._globalDelayFeedback.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-Delay Wet-Level (0..1). */
  setMasterDelayWet(wet: number): void {
    const clamped = Math.max(0, Math.min(1, wet));
    this._globalDelayWetLevel = clamped;
    if (this._globalDelayWet && this.ctx) {
      const target = this._globalDelayBypass ? 0 : clamped;
      this._globalDelayWet.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
    }
  }

  /** Master-Delay Bypass. */
  setMasterDelayBypass(bypass: boolean): void {
    this._globalDelayBypass = bypass;
    if (this._globalDelayWet && this.ctx) {
      const target = bypass ? 0 : this._globalDelayWetLevel;
      this._globalDelayWet.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
    }
  }

  /** Master-EQ Low-Shelf Gain (-24..+24 dB). */
  setMasterEqLowGain(db: number): void {
    const clamped = Math.max(-24, Math.min(24, db));
    this._masterEqLowGain = clamped;
    if (this._masterEqLow && this.ctx) {
      const target = this._masterEqBypass ? 0 : clamped;
      this._masterEqLow.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-EQ Mid-Peak Gain (-24..+24 dB). */
  setMasterEqMidGain(db: number): void {
    const clamped = Math.max(-24, Math.min(24, db));
    this._masterEqMidGain = clamped;
    if (this._masterEqMid && this.ctx) {
      const target = this._masterEqBypass ? 0 : clamped;
      this._masterEqMid.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-EQ High-Shelf Gain (-24..+24 dB). */
  setMasterEqHighGain(db: number): void {
    const clamped = Math.max(-24, Math.min(24, db));
    this._masterEqHighGain = clamped;
    if (this._masterEqHigh && this.ctx) {
      const target = this._masterEqBypass ? 0 : clamped;
      this._masterEqHigh.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-EQ Low-Shelf Frequenz (20..1000 Hz). */
  setMasterEqLowFreq(hz: number): void {
    const clamped = Math.max(20, Math.min(1000, hz));
    if (this._masterEqLow && this.ctx) {
      this._masterEqLow.frequency.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-EQ High-Shelf Frequenz (1000..20000 Hz). */
  setMasterEqHighFreq(hz: number): void {
    const clamped = Math.max(1000, Math.min(20000, hz));
    if (this._masterEqHigh && this.ctx) {
      this._masterEqHigh.frequency.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-EQ Bypass (alle Bands auf 0dB). */
  setMasterEqBypass(bypass: boolean): void {
    this._masterEqBypass = bypass;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this._masterEqLow)  this._masterEqLow.gain.setTargetAtTime(bypass ? 0 : this._masterEqLowGain,  now, 0.02);
    if (this._masterEqMid)  this._masterEqMid.gain.setTargetAtTime(bypass ? 0 : this._masterEqMidGain,  now, 0.02);
    if (this._masterEqHigh) this._masterEqHigh.gain.setTargetAtTime(bypass ? 0 : this._masterEqHighGain, now, 0.02);
  }

  /**
   * v3.76.0: Master-EQ Mid-Band Q-Faktor (0.3..10). Closes v3.75-Caveat —
   * der Q-Wert war bis dahin hart auf 0.7 codiert. Surgical-Cuts brauchen
   * Q≥5, gentle-Boost Q<0.5.
   */
  setMasterEqMidQ(q: number): void {
    const clamped = Math.max(0.3, Math.min(10, q));
    this._masterEqMidQ = clamped;
    if (this._masterEqMid && this.ctx) {
      this._masterEqMid.Q.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  // ─── Master-Limiter Setter (v3.76.0) ───────────────────────────────────────

  /** Master-Limiter Threshold in dB (-60..0). */
  setMasterLimiterThreshold(db: number): void {
    const clamped = Math.max(-60, Math.min(0, db));
    if (this._masterLimiter && this.ctx) {
      this._masterLimiter.threshold.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-Limiter Knee in dB (0..40). 0 = brick-wall. */
  setMasterLimiterKnee(knee: number): void {
    const clamped = Math.max(0, Math.min(40, knee));
    if (this._masterLimiter && this.ctx) {
      this._masterLimiter.knee.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-Limiter Ratio (1..20). 20 = brick-wall. */
  setMasterLimiterRatio(ratio: number): void {
    const clamped = Math.max(1, Math.min(20, ratio));
    if (this._masterLimiter && this.ctx) {
      this._masterLimiter.ratio.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-Limiter Release in Sekunden (0..1). */
  setMasterLimiterRelease(sec: number): void {
    const clamped = Math.max(0, Math.min(1, sec));
    if (this._masterLimiter && this.ctx) {
      this._masterLimiter.release.setTargetAtTime(clamped, this.ctx.currentTime, 0.02);
    }
  }

  /** Master-Limiter Make-Up-Gain linear (0..16, ≙ ca. -∞..+24 dB). v3.77.0 erweitert von 0..4. */
  setMasterLimiterGain(gain: number): void {
    const clamped = Math.max(0, Math.min(16, gain));
    this._masterLimiterMakeup = clamped;
    if (this._masterLimiterGain && this.ctx) {
      const target = this._masterLimiterBypass ? clamped : clamped;
      // Bypass-Pfad ändert Routing nicht den Make-Up-Wert
      this._masterLimiterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * v3.77.0: Master-Limiter Bypass via No-Click-Crossfade.
   *
   * Beide Pfade (wet = durch Limiter, dry = direkt) sind permanent
   * konnektiert. Bypass-Toggle rampt nur die zwei Gain-Werte über 20ms
   * gegeneinander (equal-power wäre overkill bei zwei korrelierten
   * Signalen — wir nehmen linear mit setValueCurveAtTime). Vermeidet die
   * Click-Artefakte aus v3.76 (disconnect/reconnect erzeugte einen
   * Sample-Glitch). Engine-internal-Memory (threshold/ratio/etc.) bleibt
   * unverändert.
   */
  setMasterLimiterBypass(bypass: boolean): void {
    this._masterLimiterBypass = bypass;
    if (!this.ctx || !this._masterLimiterWet || !this._masterLimiterDry) return;
    const now = this.ctx.currentTime;
    const xfade = this.MASTER_LIMITER_BYPASS_CROSSFADE_SEC;
    const wetParam = this._masterLimiterWet.gain;
    const dryParam = this._masterLimiterDry.gain;
    // Cancel pending ramps damit aufeinanderfolgende Toggles nicht klemmen.
    try {
      wetParam.cancelScheduledValues(now);
      dryParam.cancelScheduledValues(now);
    } catch { /* swallow */ }
    const wetStart = wetParam.value;
    const dryStart = dryParam.value;
    const wetTarget = bypass ? 0 : 1;
    const dryTarget = bypass ? 1 : 0;
    // setValueCurveAtTime mit 2-Wert-Linear-Curve = Linear-Ramp ohne den
    // Edge-Case dass linearRampToValueAtTime einen vorherigen setValueAtTime
    // braucht.
    try {
      const wetCurve = new Float32Array([wetStart, wetTarget]);
      const dryCurve = new Float32Array([dryStart, dryTarget]);
      wetParam.setValueCurveAtTime(wetCurve, now, xfade);
      dryParam.setValueCurveAtTime(dryCurve, now, xfade);
    } catch {
      // Fallback für Mock-AudioContexts oder Browser ohne Curve-Support
      try { wetParam.setTargetAtTime(wetTarget, now, xfade / 3); } catch { /* swallow */ }
      try { dryParam.setTargetAtTime(dryTarget, now, xfade / 3); } catch { /* swallow */ }
    }
  }

  // ─── LUFS-Meter (v3.78.0) ────────────────────────────────────────────────

  /**
   * v3.78.0: Startet den LUFS-Polling-Loop falls noch nicht aktiv. Wird vom
   * UI-Komponenten lazy aufgerufen (Mount eines LUFS-Displays). Idempotent.
   */
  private _ensureLufsPollingStarted(): void {
    if (this._lufsPollingTimer !== null) return;
    if (!this._lufsAnalyser) return;

    const analyzer = this._lufsAnalyser;

    // v3.101.0: Stereo-Pfad bevorzugt wenn Splitter+2 AnalyserNodes vorhanden.
    if (
      this._lufsAnalyserNodeL && this._lufsAnalyserNodeR &&
      this._lufsScratchBuffer  && this._lufsScratchBufferR
    ) {
      const nodeL    = this._lufsAnalyserNodeL;
      const nodeR    = this._lufsAnalyserNodeR;
      const scratchL = this._lufsScratchBuffer;
      const scratchR = this._lufsScratchBufferR;
      this._lufsPollingTimer = setInterval(() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nodeL.getFloatTimeDomainData(scratchL as any);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nodeR.getFloatTimeDomainData(scratchR as any);
          analyzer.processBlock(scratchL, scratchR);
          // v3.101: snapshot fuer phase/imbalance-Reader.
          this._lastLufsBlockL = scratchL;
          this._lastLufsBlockR = scratchR;
        } catch {
          /* swallow — AnalyserNode kann nach reinit nullsein */
        }
      }, this.LUFS_POLL_INTERVAL_MS);
      return;
    }

    // v3.78-Fallback: Mono-AnalyserNode.
    if (!this._lufsAnalyserNode || !this._lufsScratchBuffer) return;
    const node = this._lufsAnalyserNode;
    const scratch = this._lufsScratchBuffer;
    this._lufsPollingTimer = setInterval(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        node.getFloatTimeDomainData(scratch as any);
        analyzer.processBlock(scratch);
      } catch {
        /* swallow — AnalyserNode kann nach reinit nullsein */
      }
    }, this.LUFS_POLL_INTERVAL_MS);
  }

  /**
   * v3.101.0: Letzte gepolte L/R-Bloecke — fuer Phase-Correlation +
   * L/R-Imbalance-Reader. Werden im Polling-Loop aktualisiert; UI ruft
   * `getPhaseCorrelation()` / `getLrImbalanceDb()` und bekommt den
   * 2048-Sample-Snapshot (≈ 42ms @ 48kHz).
   */
  private _lastLufsBlockL: Float32Array | null = null;
  private _lastLufsBlockR: Float32Array | null = null;

  /** v3.78.0: Aktuelle Momentary-LUFS (400ms gleitend, BS.1770-4). */
  getLufsMomentary(): number {
    if (!this._lufsAnalyser) return LUFS_SILENCE;
    this._ensureLufsPollingStarted();
    return this._lufsAnalyser.getMomentary();
  }

  /** v3.78.0: Aktuelle Short-Term-LUFS (3s gleitend, BS.1770-4). */
  getLufsShortTerm(): number {
    if (!this._lufsAnalyser) return LUFS_SILENCE;
    this._ensureLufsPollingStarted();
    return this._lufsAnalyser.getShortTerm();
  }

  /** v3.78.0: Integrated-LUFS mit BS.1770-4 Two-Pass-Gating. */
  getLufsIntegrated(): number {
    if (!this._lufsAnalyser) return LUFS_SILENCE;
    this._ensureLufsPollingStarted();
    return this._lufsAnalyser.getIntegrated();
  }

  /**
   * v3.78.0: Setzt nur das Integrated-Akku zurück. Momentary/Short-Term
   * bleiben gleitend (sie spiegeln den laufenden Stream — Reset würde
   * den Meter kurz auf -Infinity springen lassen).
   */
  resetLufsIntegrated(): void {
    this._lufsAnalyser?.reset();
  }

  /** v3.78.0: Combined Read für UI (vermeidet 3 Engine-Aufrufe / Tick). */
  getLufsSnapshot(): { momentary: number; shortTerm: number; integrated: number } {
    if (!this._lufsAnalyser) {
      return { momentary: LUFS_SILENCE, shortTerm: LUFS_SILENCE, integrated: LUFS_SILENCE };
    }
    this._ensureLufsPollingStarted();
    return {
      momentary:  this._lufsAnalyser.getMomentary(),
      shortTerm:  this._lufsAnalyser.getShortTerm(),
      integrated: this._lufsAnalyser.getIntegrated(),
    };
  }

  /**
   * v3.101.0: Erweitertes UI-Snapshot mit Stereo-Info, Phase-Correlation
   * und L/R-Imbalance.
   *
   * v3.102.0 ergänzt um True-Peak (BS.1770-4 Annex 2):
   *   truePeakL/truePeakR/truePeakMax in dBTP (Inter-Sample-Peaks via
   *   4x-Polyphase-FIR im LufsAnalyzer).
   *
   *   momentary/shortTerm/integrated: channel-summed wie v3.78.
   *   momentaryL/momentaryR:          per-Channel-LUFS (nur dieser Kanal).
   *   phaseCorrelation:               -1..+1 (siehe LufsAnalyzer.phaseCorrelation).
   *                                    NaN-Sentinel: NaN wenn noch keine Bloecke
   *                                    gepolt wurden (Polling-Lazy-Start).
   *   lrImbalanceDb:                  RMS-Diff in dB (positiv = rechts lauter).
   *   truePeakL/R/Max:                v3.102 True-Peak in dBTP (-Inf bei Silence).
   */
  getLufsStereoSnapshot(): {
    momentary:        number;
    shortTerm:        number;
    integrated:       number;
    momentaryL:       number;
    momentaryR:       number;
    phaseCorrelation: number;
    lrImbalanceDb:    number;
    truePeakL:        number;
    truePeakR:        number;
    truePeakMax:      number;
    lra:              number;
    lraHistoryLength: number;
  } {
    if (!this._lufsAnalyser) {
      return {
        momentary:        LUFS_SILENCE,
        shortTerm:        LUFS_SILENCE,
        integrated:       LUFS_SILENCE,
        momentaryL:       LUFS_SILENCE,
        momentaryR:       LUFS_SILENCE,
        phaseCorrelation: NaN,
        lrImbalanceDb:    0,
        truePeakL:        -Infinity,
        truePeakR:        -Infinity,
        truePeakMax:      -Infinity,
        lra:              0,
        lraHistoryLength: 0,
      };
    }
    this._ensureLufsPollingStarted();
    const stereo = this._lufsAnalyser.getMomentaryStereo();
    let phase = NaN;
    let imb   = 0;
    if (this._lastLufsBlockL && this._lastLufsBlockR) {
      try {
        phase = lufsPhaseCorrelation(this._lastLufsBlockL, this._lastLufsBlockR);
        imb   = lufsLrImbalanceDb(this._lastLufsBlockL, this._lastLufsBlockR);
      } catch {
        phase = NaN;
        imb   = 0;
      }
    }
    // v3.102.0: True-Peak-Reader (vom LufsAnalyzer-internen TruePeakMeter).
    let tpL = -Infinity, tpR = -Infinity, tpMax = -Infinity;
    try {
      const tp = this._lufsAnalyser.getCurrentTruePeak();
      tpL = tp.leftDb;
      tpR = tp.rightDb;
      tpMax = tp.maxDb;
    } catch {
      /* swallow — old LufsAnalyzer ohne TP-API */
    }
    // v3.103.0: Echte EBU R128 LRA + History-Fuellstand (UI-Indicator).
    let lra = 0;
    let lraLen = 0;
    try {
      lra = this._lufsAnalyser.getCurrentLra();
      lraLen = this._lufsAnalyser.getShortTermHistoryLength();
    } catch {
      /* swallow — old LufsAnalyzer ohne LRA-API */
    }
    return {
      momentary:        this._lufsAnalyser.getMomentary(),
      shortTerm:        this._lufsAnalyser.getShortTerm(),
      integrated:       this._lufsAnalyser.getIntegrated(),
      momentaryL:       stereo.L,
      momentaryR:       stereo.R,
      phaseCorrelation: phase,
      lrImbalanceDb:    imb,
      truePeakL:        tpL,
      truePeakR:        tpR,
      truePeakMax:      tpMax,
      lra,
      lraHistoryLength: lraLen,
    };
  }

  /**
   * v3.76.0: Liefert die aktuelle Gain-Reduction des Master-Limiters in dB.
   * Web-Audio-Spec: `DynamicsCompressorNode.reduction` ist ein read-only
   * float (negativ = es wird komprimiert, 0 = kein GR). Wenn kein Limiter
   * existiert oder bypassed ist → 0. UI pollt typisch alle ~50ms.
   */
  getMasterLimiterReduction(): number {
    if (!this._masterLimiter || this._masterLimiterBypass) return 0;
    const r = (this._masterLimiter as DynamicsCompressorNode & { reduction?: number }).reduction;
    return typeof r === "number" && Number.isFinite(r) ? r : 0;
  }

  /**
   * Read-only Accessors für Tests + UI. Liefern die aktuell aktiven Engine-
   * Werte unabhängig vom Store (Crash-Recovery / Restore-Verifikation).
   */
  getMasterFxSnapshot(): {
    reverb:  { decay: number; damping: number; wet: number; bypass: boolean };
    delay:   { time: number; feedback: number; wet: number; bypass: boolean };
    eq:      { lowGain: number; midGain: number; highGain: number; midQ: number; bypass: boolean };
    limiter: { threshold: number; knee: number; ratio: number; release: number; gain: number; bypass: boolean };
  } {
    return {
      reverb: {
        decay: this._globalReverbDecay,
        damping: this._globalReverbDamping01,
        wet: this._globalReverbWetLevel,
        bypass: this._globalReverbBypass,
      },
      delay: {
        time: this._globalDelayBus?.delayTime.value ?? 0.5,
        feedback: this._globalDelayFeedback?.gain.value ?? 0.35,
        wet: this._globalDelayWetLevel,
        bypass: this._globalDelayBypass,
      },
      eq: {
        lowGain: this._masterEqLowGain,
        midGain: this._masterEqMidGain,
        highGain: this._masterEqHighGain,
        midQ: this._masterEqMidQ,
        bypass: this._masterEqBypass,
      },
      limiter: {
        threshold: this._masterLimiter?.threshold.value ?? -1,
        knee:      this._masterLimiter?.knee.value      ?? 0,
        ratio:     this._masterLimiter?.ratio.value     ?? 20,
        release:   this._masterLimiter?.release.value   ?? 0.05,
        gain:      this._masterLimiterMakeup,
        bypass:    this._masterLimiterBypass,
      },
    };
  }

  private async _loadBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.bufferCache.get(url);
    if (cached) return cached;
    const pending = this.loadingPromises.get(url);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const localPath = this._toLocalFilePath(url);

        let arrayBuffer: ArrayBuffer;
        if (localPath && typeof window !== "undefined" && window.electronAPI?.readFile) {
          const result = await window.electronAPI.readFile(localPath);
          if (!result.success || !result.data) {
            throw new Error(result.error || "fs:read-file fehlgeschlagen");
          }
          arrayBuffer = result.data;
        } else {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          arrayBuffer = await response.arrayBuffer();
        }

        const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer.slice(0));
        this.bufferCache.set(url, audioBuffer);
        this.loadingPromises.delete(url);
        return audioBuffer;
      } catch (err) {
        console.warn("[AudioEngine] Fehler beim Laden:", url, err);
        this.loadingPromises.delete(url);
        return null;
      }
    })();

    this.loadingPromises.set(url, promise);
    return promise;
  }

  private _toLocalFilePath(url: string): string | null {
    const value = (url || "").trim();
    if (!value) return null;

    // Windows absolute paths, UNC shares and POSIX absolute paths.
    if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.startsWith("/")) {
      return value;
    }

    if (!value.startsWith("file://")) return null;

    const decoded = decodeURI(value.replace(/^file:\/\//i, ""));
    if (/^\/[a-zA-Z]:\//.test(decoded)) {
      return decoded.slice(1).replace(/\//g, "\\");
    }
    return decoded;
  }

  /** Cache für Metronome-Custom-Click-Buffers, Key = Data-URL */
  private _customClickBuffers = new Map<string, AudioBuffer>();

  /** Lädt und cached einen Custom-Click-Sound (Data-URL → AudioBuffer). */
  async setCustomClickSound(role: "downbeat" | "beat", dataUrl: string | null): Promise<void> {
    if (!this.ctx) return;
    const cacheKey = `${role}::${dataUrl ?? "none"}`;
    if (dataUrl === null) {
      this._customClickBuffers.delete(role);
      return;
    }
    if (this._customClickBuffers.has(cacheKey)) {
      this._customClickBuffers.set(role, this._customClickBuffers.get(cacheKey)!);
      return;
    }
    try {
      const arr = Uint8Array.from(atob(dataUrl.split(",")[1]), c => c.charCodeAt(0));
      const buf = await this.ctx.decodeAudioData(arr.buffer);
      this._customClickBuffers.set(role, buf);
      this._customClickBuffers.set(cacheKey, buf);
    } catch (err) {
      console.warn(`[AudioEngine] Metronome Custom-Sound (${role}) konnte nicht dekodiert werden:`, err);
    }
  }

  private _playClick(time: number, volume: number, freq: number, isDownbeat = false) {
    if (!this.ctx || !this.masterGain) return;

    // Custom-Click-Buffer wenn vorhanden
    const role = isDownbeat ? "downbeat" : "beat";
    const buf = this._customClickBuffers.get(role);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = volume * this._metronomGain;
      src.connect(gain);
      gain.connect(this.masterGain);
      src.start(Math.max(time, this.ctx.currentTime));
      return;
    }

    // Synthetischer Click als Fallback
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = freq;
    osc.type = this._metronomOscType;
    const clickDur = this._metronomOscType === "sine" ? 0.05 : 0.03;
    gain.gain.setValueAtTime(volume * this._metronomGain, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + clickDur);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + clickDur + 0.01);
  }

  // ─── Keyboard Sampler Playback ────────────────────────────────────────────

  /**
   * Spielt alle passenden Keyboard-Sampler-Zonen für eine MIDI-Note + Velocity.
   * Berechnet playbackRate aus Differenz zur Root-Note der Zone.
   */
  async triggerKeyboardSamplerNote(note: number, velocity: number): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    const mod = await import("../store/useKeyboardSamplerStore");
    const zones = mod.findZones(note, velocity);
    for (const zone of zones) {
      const buf = await this._loadBuffer(zone.sampleUrl);
      if (!buf) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buf;
      const rate = mod.zonePlaybackRate(zone, note);
      source.playbackRate.value = rate;
      const gain = this.ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(2, zone.volume * (velocity / 127)));
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, zone.pan));
      source.connect(gain);
      gain.connect(panner);
      panner.connect(this.masterGain);
      source.start(this.ctx.currentTime);
    }
  }

  // ─── Audio-Track Channels (externe Dateien) ───────────────────────────────
  //
  // Vocals, Songs zum Remixen – als Mixer-Channel persistiert (Pfad-Referenz in
  // .synth). Routing geht über _getOrCreateChannelNodes(id, DEFAULT_CHANNEL_FX),
  // wodurch die volle Insert-FX-Kette und Sends automatisch verfügbar sind.

  /**
   * Lädt einen Audio-Buffer für einen Audio-Track. Cached intern.
   * - `string`-Eingabe: nutzt `_loadBuffer` (Electron `fs:read-file` oder fetch).
   * - `File`-Eingabe: dekodiert direkt via `decodeAudioData(file.arrayBuffer())`.
   * Bei Fehler null zurueck – kein Throw, damit UI dialog ohne crash zeigen kann.
   */
  async loadAudioTrack(id: string, fileOrPath: string | File): Promise<AudioBuffer | null> {
    await this.init();
    if (!this.ctx) return null;

    // Wenn bereits geladen: cache treffen.
    const cached = this.audioTrackBuffers.get(id);
    if (cached) return cached;

    let buf: AudioBuffer | null = null;
    if (typeof fileOrPath === "string") {
      buf = await this._loadBuffer(fileOrPath);
    } else {
      try {
        const arr = await fileOrPath.arrayBuffer();
        buf = await this.ctx.decodeAudioData(arr.slice(0));
      } catch (err) {
        console.warn("[AudioEngine] loadAudioTrack File decode error:", err);
        return null;
      }
    }
    if (!buf) return null;
    this.audioTrackBuffers.set(id, buf);
    return buf;
  }

  /**
   * Registriert die Track-Metadaten und wendet Volume/Pan/Sends/Mute auf den
   * Channel an. Der Buffer muss separat via `loadAudioTrack` geladen sein bzw.
   * sein. Idempotent – aktualisiert vorhandene Einträge.
   */
  registerAudioTrack(data: AudioTrackChannelData): void {
    this.audioTrackData.set(data.id, { ...data });
    // Channel-Nodes anlegen damit Mixer-Routing direkt funktioniert.
    if (this.ctx) {
      const nodes = this._getOrCreateChannelNodes(data.id, DEFAULT_CHANNEL_FX);
      // Volume / Pan / Sends initial setzen.
      this.setChannelVolume(data.id, data.muted ? 0 : data.volume);
      this.setChannelPan(data.id, data.pan);
      this.setChannelSend(data.id, "reverb", data.sends?.reverb ?? 0);
      this.setChannelSend(data.id, "delay", data.sends?.delay ?? 0);
      // Solo-Logik delegiert an Engine-Helfer (audio-track-only scope).
      void nodes;
      this._reapplyAudioTrackSoloMutes();
    }
  }

  /**
   * Startet die Wiedergabe eines registrierten + geladenen Tracks.
   * Wenn der Track bereits laeuft, wird er zuerst gestoppt (replay).
   *
   * Routing-Auswahl:
   *   - syncMode === "timestretch" → AudioWorkletNode (Pitch-erhaltend, OLA)
   *   - sonst → klassischer AudioBufferSourceNode (Pitch+Tempo gekoppelt)
   */
  playAudioTrack(id: string, opts?: { startOffsetSec?: number; loop?: boolean }): void {
    if (!this.ctx) return;
    const buf = this.audioTrackBuffers.get(id);
    if (!buf) return;
    const data = this.audioTrackData.get(id);

    // v3.52.0: Worklet-Routing entweder via syncMode="timestretch" (Legacy)
    // oder via pitchLocked=true (neuer manueller Stretch-Pfad).
    if (this._shouldUseWorklet(data)) {
      void this._playAudioTrackViaWorklet(id, opts);
      return;
    }

    // Existierende Source stoppen (Replay) – auch evtl. Worklet, falls zuvor aktiv.
    this._stopAudioTrackSource(id);
    this._stopAudioTrackWorklet(id);

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    // v3.70.0: Loop-Engine-Wiring. Wenn loopEnabled + valid loopPoints gesetzt
    // sind, dominiert das den (legacy) loop-Flag. Sample→Sec via buf.sampleRate.
    // Defensive: NaN/Infinity/negative → fallback auf 0..duration.
    const wantsLoopRange =
      data?.loopEnabled === true &&
      typeof data?.loopStartSample === "number" &&
      typeof data?.loopEndSample === "number" &&
      Number.isFinite(data.loopStartSample as number) &&
      Number.isFinite(data.loopEndSample as number) &&
      (data.loopStartSample as number) >= 0 &&
      (data.loopEndSample as number) > (data.loopStartSample as number);
    if (wantsLoopRange) {
      source.loop = true;
      const sr = buf.sampleRate || 44100;
      const totalSec = buf.duration;
      const startSec = Math.max(
        0,
        Math.min(totalSec, (data!.loopStartSample as number) / sr),
      );
      const endSec = Math.max(
        startSec,
        Math.min(totalSec, (data!.loopEndSample as number) / sr),
      );
      source.loopStart = startSec;
      source.loopEnd = endSec;
    } else if (data?.loopEnabled === true) {
      // loopEnabled=true ohne valid points → komplette Buffer-Länge (no-op
      // semantically equivalent zu loop=true ohne range).
      source.loop = true;
    } else {
      source.loop = opts?.loop ?? data?.loop ?? false;
    }

    // PlaybackRate aus syncMode ableiten
    const rate = this._calcAudioTrackPlaybackRate(data);
    source.playbackRate.value = rate;

    // Routing: source → [xfadeGain?] → channelNodes.input → FX → master
    // v3.72.0: Crossfade-Gain einfügen falls loop-crossfade aktiv.
    const nodes = this._getOrCreateChannelNodes(id, DEFAULT_CHANNEL_FX);
    // Alte Crossfade-Chain disposen (z.B. nach Restart via setAudioTrackLoopPoints).
    this._disposeAudioTrackXfade(id);
    const crossfadeMs = this._effectiveLoopCrossfadeMs(data, buf);
    const xfadeEnabled = wantsLoopRange && crossfadeMs > 0;
    if (xfadeEnabled) {
      const xfade = this.ctx.createGain();
      xfade.gain.value = 1;
      source.connect(xfade);
      xfade.connect(nodes.input);
      this.audioTrackXfadeGains.set(id, xfade);
    } else {
      source.connect(nodes.input);
    }

    const offsetSec = Math.max(0, opts?.startOffsetSec ?? data?.startOffsetSec ?? 0);
    const ctxStart = this.ctx.currentTime;
    try {
      source.start(ctxStart, offsetSec);
    } catch (err) {
      console.warn("[AudioEngine] playAudioTrack start error:", err);
      this._disposeAudioTrackXfade(id);
      return;
    }

    // v3.72.0: Crossfade-Hüllkurve initial schedulen.
    if (xfadeEnabled) {
      try {
        this._scheduleAudioTrackLoopCrossfade(id, ctxStart, offsetSec);
      } catch (err) {
        console.warn("[AudioEngine] crossfade schedule error:", err);
      }
    }

    source.onended = () => {
      // Nur cleanup wenn die Source noch unsere aktuelle ist.
      if (this.audioTrackSources.get(id) === source) {
        this.audioTrackEndedListeners.get(id)?.forEach(cb => {
          try { cb(); } catch { /* ignore */ }
        });
        this._cleanupAudioTrackSource(id);
      }
    };

    this.audioTrackSources.set(id, source);
    this.audioTrackStartTimes.set(id, { ctxStart, offsetSec });

    // Position-rAF starten, falls Listener registriert.
    if ((this.audioTrackPositionListeners.get(id)?.size ?? 0) > 0) {
      this._startAudioTrackPositionRaf(id);
    }
  }

  /**
   * Interne Pitch-preserving-Variante via AudioWorklet (OLA).
   * Wird aus `playAudioTrack` aufgerufen wenn `syncMode === "timestretch"`.
   * Bei Worklet-Fehlern (z.B. Modul nicht geladen) → graceful Fallback
   * auf `"stretch"`-Verhalten (BufferSourceNode) + console.warn.
   */
  private async _playAudioTrackViaWorklet(
    id: string,
    opts?: { startOffsetSec?: number; loop?: boolean },
  ): Promise<void> {
    if (!this.ctx) return;
    const buf = this.audioTrackBuffers.get(id);
    if (!buf) return;
    const data = this.audioTrackData.get(id);

    // Worklet-Modul sicherstellen.
    await this._ensureWorklets();
    if (!this._workletLoaded) {
      console.warn(
        "[AudioEngine] timestretch: AudioWorklet nicht verfügbar – Fallback auf 'stretch'.",
      );
      const fallback: AudioTrackChannelData = { ...(data ?? ({} as AudioTrackChannelData)), id, syncMode: "stretch" };
      this.audioTrackData.set(id, fallback);
      this.playAudioTrack(id, opts);
      return;
    }

    // Existierende Source/Worklet stoppen (Replay).
    this._stopAudioTrackSource(id);
    this._stopAudioTrackWorklet(id);

    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(this.ctx, "time-stretch-processor", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
    } catch (err) {
      console.warn(
        "[AudioEngine] timestretch: AudioWorkletNode-Erzeugung fehlgeschlagen – Fallback auf 'stretch'.",
        err,
      );
      const fallback: AudioTrackChannelData = { ...(data ?? ({} as AudioTrackChannelData)), id, syncMode: "stretch" };
      this.audioTrackData.set(id, fallback);
      this.playAudioTrack(id, opts);
      return;
    }

    // Channels aus Buffer extrahieren (Mono → upmix passiert im Worklet).
    const channels: Float32Array[] = [];
    const numCh = Math.min(2, buf.numberOfChannels || 1);
    for (let c = 0; c < numCh; c++) {
      channels.push(buf.getChannelData(c));
    }

    // Loop-Flag + Buffer initial setzen.
    // v3.71.0: Worklet-Pfad respektiert nun Loop-Range analog zum BufferSource-
    // Pfad — closes v3.70-Caveat "Worklet-Pfad ignoriert Loop-Range".
    const loopParams = this._computeWorkletLoopParams(data, opts);
    try {
      node.port.postMessage({ type: "setBuffer", channels });
      node.port.postMessage({
        type: "setLoop",
        loop: loopParams.loop,
        loopStart: loopParams.loopStart,
        loopEnd: loopParams.loopEnd,
        // v3.72.0: Crossfade-Samples für boundary fade (0 = hard cut).
        crossfadeSamples: loopParams.crossfadeSamples,
      });
    } catch (err) {
      console.warn("[AudioEngine] timestretch: postMessage(setBuffer) failed:", err);
    }

    // Initial-Seek?
    const offsetSec = Math.max(0, opts?.startOffsetSec ?? data?.startOffsetSec ?? 0);
    if (offsetSec > 0) {
      const samplePos = Math.floor(offsetSec * (buf.sampleRate || this.ctx.sampleRate));
      try {
        node.port.postMessage({ type: "seek", samplePos });
      } catch { /* ignore */ }
    }

    // v3.52.0: Stretch-Param berücksichtigt sowohl BPM-Sync als auch
    // manuellen `stretchRatio` (Multiplikation).
    const ratio = this._calcAudioTrackPlaybackRate(data);
    try {
      const p = node.parameters.get("stretch");
      if (p) p.setValueAtTime(ratio, this.ctx.currentTime);
    } catch { /* ignore */ }

    // Position-Listener registrieren.
    const initialSamplePos = offsetSec > 0
      ? Math.floor(offsetSec * (buf.sampleRate || this.ctx.sampleRate))
      : 0;
    this.audioTrackWorkletPositions.set(id, initialSamplePos);
    node.port.onmessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; samplePos?: number } | undefined;
      if (!m || m.type !== "position" || typeof m.samplePos !== "number") return;
      this.audioTrackWorkletPositions.set(id, m.samplePos);
    };

    // Routing: worklet → channelNodes.input → FX → master
    const nodes = this._getOrCreateChannelNodes(id, DEFAULT_CHANNEL_FX);
    try { node.connect(nodes.input); } catch (err) {
      console.warn("[AudioEngine] timestretch: connect error:", err);
    }

    this.audioTrackWorkletNodes.set(id, node);
    // ctxStart wird hier dennoch hinterlegt damit existing rAF-Position-Code
    // einen Anker hat (Fallback). Sample-Position kommt aber via postMessage.
    this.audioTrackStartTimes.set(id, {
      ctxStart: this.ctx.currentTime,
      offsetSec,
    });

    if ((this.audioTrackPositionListeners.get(id)?.size ?? 0) > 0) {
      this._startAudioTrackPositionRaf(id);
    }
  }

  /** Stoppt einen Track. No-op wenn nicht aktiv. */
  stopAudioTrack(id: string): void {
    this._stopAudioTrackSource(id);
    this._stopAudioTrackWorklet(id);
    this._cleanupAudioTrackSource(id);
  }

  /** Delegiert an setChannelVolume – Audio-Track nutzt die FX-Chain wie ein Drum-Part. */
  setAudioTrackVolume(id: string, v: number): void {
    const data = this.audioTrackData.get(id);
    if (data) data.volume = v;
    // Wenn muted, bleibt der Channel auf 0 bis unmute.
    if (data?.muted) return;
    this.setChannelVolume(id, v);
  }

  setAudioTrackPan(id: string, p: number): void {
    const data = this.audioTrackData.get(id);
    if (data) data.pan = p;
    this.setChannelPan(id, p);
  }

  setAudioTrackMute(id: string, muted: boolean): void {
    const data = this.audioTrackData.get(id);
    if (data) data.muted = muted;
    if (muted) {
      this.setChannelVolume(id, 0);
    } else {
      this.setChannelVolume(id, data?.volume ?? 1);
    }
    this._reapplyAudioTrackSoloMutes();
  }

  /**
   * Solo-Logik beschraenkt auf Audio-Tracks: wenn mindestens ein Audio-Track
   * `soloed=true` hat, werden alle anderen Audio-Tracks stumm geschaltet.
   * Drum-Parts werden NICHT beeinflusst (out of scope fuer v1.16.0).
   */
  setAudioTrackSolo(id: string, soloed: boolean): void {
    const data = this.audioTrackData.get(id);
    if (data) data.soloed = soloed;
    this._reapplyAudioTrackSoloMutes();
  }

  /**
   * Setzt die Wiedergabe-Position auf `sec` Sekunden. Wenn der Track gerade
   * spielt, wird die Source neu erzeugt und beim neuen Offset gestartet.
   */
  seekAudioTrack(id: string, sec: number): void {
    const wasSourceActive = this.audioTrackSources.has(id);
    const wasWorkletActive = this.audioTrackWorkletNodes.has(id);
    const data = this.audioTrackData.get(id);
    const safeSec = Math.max(0, sec);
    if (data) data.startOffsetSec = safeSec;

    // Wenn Worklet aktiv → in-place seek via postMessage (kein Re-Create).
    if (wasWorkletActive) {
      const node = this.audioTrackWorkletNodes.get(id);
      const buf = this.audioTrackBuffers.get(id);
      const sr = buf?.sampleRate || this.ctx?.sampleRate || 44100;
      const samplePos = Math.floor(safeSec * sr);
      try {
        node?.port.postMessage({ type: "seek", samplePos });
      } catch (err) {
        console.warn("[AudioEngine] seekAudioTrack worklet error:", err);
      }
      this.audioTrackWorkletPositions.set(id, samplePos);
      // ctxStart anker neu setzen damit rAF-Fallback sinnvoll bleibt.
      if (this.ctx) {
        this.audioTrackStartTimes.set(id, {
          ctxStart: this.ctx.currentTime,
          offsetSec: safeSec,
        });
      }
      return;
    }

    if (wasSourceActive) {
      this.playAudioTrack(id, { startOffsetSec: safeSec, loop: data?.loop });
    }
  }

  /**
   * Registriert einen Position-Callback. Liefert `(pos01, sec)` ca. 60 Hz
   * waehrend Wiedergabe. Gibt eine Unsub-Funktion zurueck.
   */
  onAudioTrackPosition(id: string, cb: (pos01: number, sec: number) => void): () => void {
    let set = this.audioTrackPositionListeners.get(id);
    if (!set) {
      set = new Set();
      this.audioTrackPositionListeners.set(id, set);
    }
    set.add(cb);
    const sourceActive = this.audioTrackSources.has(id) || this.audioTrackWorkletNodes.has(id);
    if (sourceActive && !this.audioTrackPositionRaf.has(id)) {
      this._startAudioTrackPositionRaf(id);
    }
    return () => {
      const s = this.audioTrackPositionListeners.get(id);
      s?.delete(cb);
      if (s && s.size === 0) {
        this.audioTrackPositionListeners.delete(id);
        this._stopAudioTrackPositionRaf(id);
      }
    };
  }

  onAudioTrackEnded(id: string, cb: () => void): () => void {
    let set = this.audioTrackEndedListeners.get(id);
    if (!set) {
      set = new Set();
      this.audioTrackEndedListeners.set(id, set);
    }
    set.add(cb);
    return () => {
      const s = this.audioTrackEndedListeners.get(id);
      s?.delete(cb);
      if (s && s.size === 0) this.audioTrackEndedListeners.delete(id);
    };
  }

  /**
   * Volles cleanup: stoppt Source, loescht Buffer-Cache, rAF, Listener und
   * Channel-Metadaten. Der Channel-Knoten selbst bleibt bestehen (Re-Use bei
   * Re-Add). Wenn der Channel komplett entfernt werden soll, muss die Store-
   * Schicht zusaetzlich `channelNodes.delete(id)` anstoßen – das ist hier
   * absichtlich nicht enthalten, weil andere Komponenten den Channel-Knoten
   * fuer Visualisierungen referenzieren koennten.
   */
  disposeAudioTrack(id: string): void {
    this._stopAudioTrackSource(id);
    this._stopAudioTrackWorklet(id);
    this._stopAudioTrackPositionRaf(id);
    this.audioTrackBuffers.delete(id);
    this.audioTrackStartTimes.delete(id);
    this.audioTrackPositionListeners.delete(id);
    this.audioTrackEndedListeners.delete(id);
    this.audioTrackData.delete(id);
    this.audioTrackWorkletPositions.delete(id);
  }

  /**
   * Startet alle Tracks die durch den Store-Getter geliefert werden. Wenn kein
   * Getter gesetzt ist, iteriert ueber die intern registrierten Tracks. Tracks
   * mit `muted=true` werden uebersprungen.
   */
  playAllRegisteredAudioTracks(): void {
    const list = this.audioTracksGetter
      ? this.audioTracksGetter()
      : Array.from(this.audioTrackData.values());
    for (const t of list) {
      if (t.muted) continue;
      // Sicherstellen dass Engine die Metadaten kennt (Getter ist Source of Truth).
      this.audioTrackData.set(t.id, { ...t });
      // Nur abspielen wenn Buffer geladen wurde. Wenn nicht: silently skip – die
      // Store-Schicht ist fuer Preload-Orchestrierung verantwortlich.
      if (!this.audioTrackBuffers.has(t.id)) continue;
      this.playAudioTrack(t.id, { startOffsetSec: t.startOffsetSec, loop: t.loop });
    }
  }

  stopAllAudioTracks(): void {
    // Kopie der Keys (Maps werden waehrend stop mutiert)
    const sourceIds = Array.from(this.audioTrackSources.keys());
    for (const id of sourceIds) {
      this._stopAudioTrackSource(id);
      this._cleanupAudioTrackSource(id);
    }
    const workletIds = Array.from(this.audioTrackWorkletNodes.keys());
    for (const id of workletIds) {
      this._stopAudioTrackWorklet(id);
      this._cleanupAudioTrackSource(id);
    }
  }

  /**
   * Externe Quelle fuer alle aktiven Audio-Tracks (typischerweise vom Store).
   * Wird in `playAllRegisteredAudioTracks` und `_updateAudioTrackPlaybackRates`
   * konsultiert.
   */
  setAudioTracksGetter(getter: () => AudioTrackChannelData[]): void {
    this.audioTracksGetter = getter;
  }

  /**
   * Registriert einen Getter, der true liefert wenn mindestens ein Drum-Part
   * im aktiven Pattern soloed ist. Wird vom Mixer-Solo-Pfad gelesen damit
   * Audio-Tracks bei Drum-Solo mit-stummgeschaltet werden (FOLLOWUP-102/B).
   * Setzen mit `null` entfernt die Cross-Subscription (Legacy-Verhalten).
   */
  setDrumSoloFlagGetter(fn: (() => boolean) | null): void {
    this.drumSoloFlagGetter = fn;
  }

  /**
   * Wird aus dem Drum-Store aufgerufen, wenn sich die Drum-Solo-Flags geaendert
   * haben. Triggert ein Re-Apply der Audio-Track-Solo-Mutes, damit das
   * cross-store Solo-Verhalten konsistent ist (Drum-Solo → andere Channels stumm).
   * Idempotent — kann beliebig oft gerufen werden.
   */
  notifyDrumSoloChanged(): void {
    this._reapplyAudioTrackSoloMutes();
  }

  /** Dauer in Sekunden des geladenen Buffers, oder null wenn nicht geladen. */
  getAudioTrackDuration(id: string): number | null {
    const buf = this.audioTrackBuffers.get(id);
    return buf ? buf.duration : null;
  }

  /**
   * Liefert den dekodierten AudioBuffer für sample-precise Edit-Workflows
   * (v3.67.0: ZoomableWaveform). Read-only — Mutationen am Buffer würden
   * die Engine-Wiedergabe brechen.
   */
  getAudioTrackBuffer(id: string): AudioBuffer | null {
    return this.audioTrackBuffers.get(id) ?? null;
  }

  /** Sample-Rate des geladenen Audio-Track-Buffers oder null. */
  getAudioTrackSampleRate(id: string): number | null {
    const buf = this.audioTrackBuffers.get(id);
    return buf ? buf.sampleRate : null;
  }

  // ─── Private: Audio-Track Helpers ──────────────────────────────────────────

  /**
   * Berechnet die effektive Playback-Rate für BufferSource ("stretch") oder
   * den Worklet-Stretch-Param ("timestretch"). Beide nutzen dasselbe Verhältnis
   * `bpm/originalBpm` – der Unterschied liegt im Routing (Pitch-Kopplung).
   */
  private _calcAudioTrackPlaybackRate(data: AudioTrackChannelData | undefined): number {
    if (!data) return 1;
    let bpmRate = 1;
    if (data.syncMode === "stretch" || data.syncMode === "timestretch") {
      const orig = data.originalBpm;
      if (orig && orig > 0) {
        bpmRate = this._bpm / orig;
      }
    }
    // v3.52.0: Manueller Stretch wirkt MULTIPLIKATIV zur BPM-Sync-Rate.
    // Clamp auf 0.25..4.0 wie der Worklet-Param es ohnehin tut.
    const manual = data.stretchRatio;
    let manualClamped = 1;
    if (typeof manual === "number" && Number.isFinite(manual) && manual > 0) {
      manualClamped = Math.max(0.25, Math.min(4.0, manual));
    }
    return bpmRate * manualClamped;
  }

  /**
   * v3.52.0: Entscheidet ob ein Track via AudioWorklet (Pitch-Lock) ODER
   * AudioBufferSourceNode (Resample) abgespielt wird. Wahr wenn der User
   * explizit Pitch-Lock will (`pitchLocked === true`) ODER `syncMode ===
   * "timestretch"` für Backward-Compat. Pure-fn, kein State.
   */
  private _shouldUseWorklet(data: AudioTrackChannelData | undefined): boolean {
    if (!data) return false;
    if (data.syncMode === "timestretch") return true;
    if (data.pitchLocked === true) return true;
    return false;
  }

  /**
   * v3.71.0: Berechnet Loop-Parameter für die Worklet-postMessage(setLoop)-
   * Payload. Mirrors die wantsLoopRange-Logik aus dem BufferSource-Pfad damit
   * beide Engines konsistent loopen. Pure-fn — kein State.
   *
   * - loopEnabled=true + valid range → {loop:true, loopStart, loopEnd} (Sample-Indizes)
   * - loopEnabled=true ohne valid range → {loop:true, loopStart:null, loopEnd:null}
   * - sonst → legacy {loop: opts?.loop ?? data.loop ?? false, …null}
   */
  private _computeWorkletLoopParams(
    data: AudioTrackChannelData | undefined,
    opts?: { loop?: boolean },
  ): {
    loop: boolean;
    loopStart: number | null;
    loopEnd: number | null;
    /** v3.72.0: Crossfade-Länge in Samples (0 = hard cut). */
    crossfadeSamples: number;
  } {
    const wantsRange =
      data?.loopEnabled === true
      && typeof data?.loopStartSample === "number"
      && typeof data?.loopEndSample === "number"
      && Number.isFinite(data.loopStartSample as number)
      && Number.isFinite(data.loopEndSample as number)
      && (data.loopStartSample as number) >= 0
      && (data.loopEndSample as number) > (data.loopStartSample as number);
    // v3.72.0: Crossfade-Samples für Worklet. Sample-Rate aus dem aktuellen
    // ctx (44.1kHz default falls noch nicht initialisiert).
    const sr = this.ctx?.sampleRate || 44100;
    const xfadeMsRaw = data?.loopCrossfadeMs;
    let xfadeMs = 0;
    if (typeof xfadeMsRaw === "number" && Number.isFinite(xfadeMsRaw) && xfadeMsRaw > 0) {
      xfadeMs = Math.min(200, xfadeMsRaw);
    }
    let crossfadeSamples = Math.max(0, Math.floor((xfadeMs / 1000) * sr));
    // Wenn Range gesetzt: clampen auf rangeLen / 2.
    if (wantsRange && crossfadeSamples > 0) {
      const rangeLen = (data!.loopEndSample as number) - (data!.loopStartSample as number);
      const maxXfade = Math.floor(rangeLen / 2);
      if (crossfadeSamples > maxXfade) crossfadeSamples = maxXfade;
    }
    if (wantsRange) {
      return {
        loop: true,
        loopStart: data!.loopStartSample as number,
        loopEnd: data!.loopEndSample as number,
        crossfadeSamples,
      };
    }
    if (data?.loopEnabled === true) {
      return { loop: true, loopStart: null, loopEnd: null, crossfadeSamples: 0 };
    }
    return {
      loop: opts?.loop ?? data?.loop ?? false,
      loopStart: null,
      loopEnd: null,
      crossfadeSamples: 0,
    };
  }

  /**
   * v3.71.0: Live-Edit von Loop-Range bei laufender Wiedergabe.
   *
   * - Buffer-Source-Pfad: AudioBufferSourceNode.loop/loopStart/loopEnd sind
   *   read-only NACH start() in vielen Browsern — wir restarten die Source
   *   mit der neuen Range. Position wird preserved falls sie innerhalb der
   *   neuen Range liegt, sonst restart from new loopStart.
   * - Worklet-Pfad: postMessage(setLoop) mit neuer Range — keine Restart
   *   nötig (der Processor wrappt live an der neuen Boundary).
   *
   * `data` wird vorher zwingend via registerAudioTrack aktualisiert (Caller-
   * Verantwortung — analog zu setAudioTrackVolume/Pan etc.).
   */
  setAudioTrackLoopPoints(id: string): void {
    if (!this.ctx) return;
    const data = this.audioTrackData.get(id);
    const buf = this.audioTrackBuffers.get(id);
    if (!data || !buf) return;

    // Worklet aktiv → in-place update via postMessage.
    const workletNode = this.audioTrackWorkletNodes.get(id);
    if (workletNode) {
      const params = this._computeWorkletLoopParams(data);
      try {
        workletNode.port.postMessage({
          type: "setLoop",
          loop: params.loop,
          loopStart: params.loopStart,
          loopEnd: params.loopEnd,
          // v3.72.0: Crossfade-Samples (Live-Edit).
          crossfadeSamples: params.crossfadeSamples,
        });
      } catch (err) {
        console.warn("[AudioEngine] setAudioTrackLoopPoints worklet error:", err);
      }
      return;
    }

    // BufferSource aktiv → Stop+Restart mit position-preservation.
    const src = this.audioTrackSources.get(id);
    const startMeta = this.audioTrackStartTimes.get(id);
    if (!src || !startMeta) return;

    // Aktuelle Position in Sekunden berechnen (analog zu rAF-Tick).
    const rate = this._calcAudioTrackPlaybackRate(data);
    const elapsedCtx = this.ctx.currentTime - startMeta.ctxStart;
    const currentSec = Math.max(0, startMeta.offsetSec + elapsedCtx * rate);

    // Falls neue Range gesetzt + currentSec außerhalb → restart bei loopStart.
    const sr = buf.sampleRate || 44100;
    const totalSec = buf.duration;
    const lsSec =
      typeof data.loopStartSample === "number" && Number.isFinite(data.loopStartSample)
        ? Math.max(0, Math.min(totalSec, data.loopStartSample / sr))
        : null;
    const leSec =
      typeof data.loopEndSample === "number" && Number.isFinite(data.loopEndSample)
        ? Math.max(0, Math.min(totalSec, data.loopEndSample / sr))
        : null;

    let restartSec = currentSec;
    if (
      data.loopEnabled === true
      && lsSec !== null
      && leSec !== null
      && leSec > lsSec
      && (currentSec < lsSec || currentSec >= leSec)
    ) {
      restartSec = lsSec;
    }

    // Restart mit aktualisierter Range. playAudioTrack stoppt vorher die alte
    // Source via _stopAudioTrackSource + cleanup; die neue Source liest die
    // frischen loopEnabled/loopStartSample/loopEndSample-Werte aus data.
    this.playAudioTrack(id, { startOffsetSec: restartSec });
  }

  private _updateAudioTrackPlaybackRates(): void {
    // Beim BPM-Wechsel alle aktiven Sources auf neue Rate setzen.
    this.audioTrackSources.forEach((source, id) => {
      const data = this.audioTrackData.get(id);
      const rate = this._calcAudioTrackPlaybackRate(data);
      try {
        source.playbackRate.setValueAtTime(rate, this.ctx?.currentTime ?? 0);
      } catch {
        // Fallback fuer Mocks: direkter value-Set
        try { source.playbackRate.value = rate; } catch { /* ignore */ }
      }
    });
    // Aktive Worklet-Tracks: stretch-AudioParam aktualisieren.
    this.audioTrackWorkletNodes.forEach((node, id) => {
      const data = this.audioTrackData.get(id);
      const rate = this._calcAudioTrackPlaybackRate(data);
      try {
        const p = node.parameters.get("stretch");
        if (p) p.setValueAtTime(rate, this.ctx?.currentTime ?? 0);
      } catch {
        // Mock-Fallback: direkter value-Set wenn AudioParam-API nicht voll vorhanden.
        try {
          const p = node.parameters.get("stretch");
          if (p) (p as unknown as { value: number }).value = rate;
        } catch { /* ignore */ }
      }
    });
  }

  /** Disconnect+Cleanup für einen Worklet-basierten Audio-Track. */
  private _stopAudioTrackWorklet(id: string): void {
    const node = this.audioTrackWorkletNodes.get(id);
    if (!node) return;
    try { node.port.onmessage = null as unknown as (e: MessageEvent) => void; } catch { /* ignore */ }
    try { node.disconnect(); } catch { /* ignore */ }
    this.audioTrackWorkletNodes.delete(id);
    this.audioTrackWorkletPositions.delete(id);
  }

  private _stopAudioTrackSource(id: string): void {
    const src = this.audioTrackSources.get(id);
    if (!src) return;
    try { src.onended = null; } catch { /* ignore */ }
    try { src.stop(); } catch { /* already stopped */ }
    try { src.disconnect(); } catch { /* ignore */ }
    // v3.72.0: Crossfade-Chain mit-disposen falls vorhanden.
    this._disposeAudioTrackXfade(id);
  }

  private _cleanupAudioTrackSource(id: string): void {
    this.audioTrackSources.delete(id);
    this.audioTrackStartTimes.delete(id);
    this._stopAudioTrackPositionRaf(id);
    // v3.72.0: defensiver Cleanup falls noch xfade-Meta hängt.
    this._disposeAudioTrackXfade(id);
  }

  /**
   * v3.72.0: Cancelt Crossfade-Schedule + disconnected den GainNode.
   * No-op wenn nicht vorhanden.
   */
  private _disposeAudioTrackXfade(id: string): void {
    const xfade = this.audioTrackXfadeGains.get(id);
    if (xfade) {
      try { xfade.gain.cancelScheduledValues(0); } catch { /* ignore */ }
      try { xfade.disconnect(); } catch { /* ignore */ }
      this.audioTrackXfadeGains.delete(id);
    }
    this.audioTrackXfadeMeta.delete(id);
  }

  /**
   * v3.72.0: Berechnet die effektive Crossfade-Länge in Millisekunden.
   * Clamp 0..200ms; bei aktiver Loop-Range zusätzlich auf loopRange / 2
   * limitiert (in Audio-Sekunden, nicht Samples, weil der Buffer am Ende
   * via playbackRate gespielt wird — wir clampen aber gegen die SAMPLES
   * der Range, da source.loopStart/End ebenfalls die Buffer-Sekunden sind,
   * unabhängig von playbackRate). NaN/Inf/negativ → 0.
   *
   * Pure-fn (kein State) — Caller liefert data + buffer.
   */
  private _effectiveLoopCrossfadeMs(
    data: AudioTrackChannelData | undefined,
    buf: AudioBuffer | undefined,
  ): number {
    const raw = data?.loopCrossfadeMs;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 0;
    let ms = Math.min(200, raw);
    if (!buf) return ms;
    const sr = buf.sampleRate || 44100;
    const ls = data?.loopStartSample;
    const le = data?.loopEndSample;
    if (
      typeof ls === "number" && typeof le === "number"
      && Number.isFinite(ls) && Number.isFinite(le)
      && le > ls
    ) {
      const loopRangeMs = ((le - ls) / sr) * 1000;
      // Clamp auf loopRange/2 damit Crossfade nicht > halbe Loop.
      const maxMs = loopRangeMs / 2;
      if (ms > maxMs) ms = maxMs;
    }
    return Math.max(0, ms);
  }

  /**
   * v3.72.0: Plant die periodische Crossfade-Hüllkurve am Loop-Boundary.
   *
   * Algorithmus (Equal-Power Crossfade, smoother Übergang als linear):
   *   - Loop-Period T = (loopEnd - loopStart) / sampleRate Sekunden
   *     (im Buffer-Zeit-Raum, source.loopEnd ist read-only nach start()
   *     und in Sekunden gemessen UNABHÄNGIG von source.playbackRate.value,
   *     ABER die effektive Loop-Dauer im ctx-Zeitraum ist T / rate).
   *   - In den letzten xfadeMs vor jedem loopEnd: Gain fadet von 1 → 0
   *     (cos-Quadrant) per setValueCurveAtTime.
   *   - In den ersten xfadeMs nach jedem loopStart: Gain fadet von 0 → 1
   *     (sin-Quadrant). Da source.loop intern den Buffer einfach wrappt,
   *     hört man bei xfade=0 → Silence, kein Click.
   *
   * Hinweis: Web-Audio-BufferSource erlaubt KEINE Read-Ahead-Mischung —
   * wir können also NICHT die Tail-Samples vor loopEnd mit den Head-
   * Samples nach loopStart mischen. Die hier implementierte Lösung blendet
   * stattdessen die Lautstärke an der Boundary aus + wieder ein. Das ist
   * akustisch immer noch DEUTLICH besser als ein harter Cut (die Click-
   * Artefakte entstehen durch die abrupten Sample-Diskontinuitäten am
   * Wrap, ein 5-20ms Volumen-Dip eliminiert die). Echtes Sample-Crossfade
   * erfordert eine Two-Source-Strategie (FUTURE).
   *
   * Wir planen LOOP_XFADE_SCHEDULE_COUNT (= 64) Loop-Cycles im Voraus.
   * Bei langlaufenden Tracks sollte ein Refresh-Mechanismus rescheduln —
   * für v3.72.0 First-Pass akzeptieren wir den 64-Cycle-Horizont
   * (= 32 Sekunden bei 0.5s Loops, > 30min bei 30s Loops).
   */
  private _scheduleAudioTrackLoopCrossfade(
    id: string,
    ctxStart: number,
    offsetSec: number,
  ): void {
    if (!this.ctx) return;
    const data = this.audioTrackData.get(id);
    const buf = this.audioTrackBuffers.get(id);
    const xfade = this.audioTrackXfadeGains.get(id);
    if (!data || !buf || !xfade) return;
    const sr = buf.sampleRate || 44100;
    const ls = data.loopStartSample;
    const le = data.loopEndSample;
    if (
      typeof ls !== "number" || typeof le !== "number"
      || !Number.isFinite(ls) || !Number.isFinite(le)
      || le <= ls
    ) return;
    const xfadeMs = this._effectiveLoopCrossfadeMs(data, buf);
    if (xfadeMs <= 0) return;
    const xfadeSec = xfadeMs / 1000;
    const loopStartSec = ls / sr;
    const loopEndSec = le / sr;
    const bufLoopPeriod = loopEndSec - loopStartSec; // in Buffer-Sekunden

    // Skalierung: ctx-Zeit pro Buffer-Sekunde = 1 / playbackRate.
    const rate = this._calcAudioTrackPlaybackRate(data);
    const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    const ctxLoopPeriod = bufLoopPeriod / safeRate;
    if (ctxLoopPeriod <= 0 || !Number.isFinite(ctxLoopPeriod)) return;

    // Equal-Power Hüllkurven (precomputed, 64 Steps reicht für 5-20ms).
    const STEPS = 64;
    const fadeOutCurve = new Float32Array(STEPS);
    const fadeInCurve = new Float32Array(STEPS);
    for (let i = 0; i < STEPS; i++) {
      const t = i / (STEPS - 1);
      // Equal-power: cos(t * π/2) für out, sin(t * π/2) für in.
      fadeOutCurve[i] = Math.cos((t * Math.PI) / 2);
      fadeInCurve[i] = Math.sin((t * Math.PI) / 2);
    }

    // Zeitpunkt im ctx-Frame an dem der erste Loop-Wrap stattfindet.
    // source.start(ctxStart, offsetSec) → t=0 im Buffer entspricht ctxStart-offsetSec.
    // Wir suchen den ersten t_wrap >= ctxStart wo Buffer-Position = loopEnd.
    // Buffer-Position(ctx_t) = offsetSec + (ctx_t - ctxStart) * rate, dann ggf. wrap im loop.
    // Erstes Erreichen loopEnd: (loopEndSec - offsetSec) / rate + ctxStart,
    // falls offsetSec < loopEndSec, sonst über den Wrap-Punkt.
    let firstWrapCtx: number;
    if (offsetSec < loopEndSec) {
      firstWrapCtx = ctxStart + (loopEndSec - offsetSec) / safeRate;
    } else {
      // Wir starten bereits jenseits loopEnd → loop wrapt sofort auf loopStart,
      // dann Period bis nächster loopEnd.
      const remainder = ((offsetSec - loopStartSec) % bufLoopPeriod + bufLoopPeriod) % bufLoopPeriod;
      const distToEnd = bufLoopPeriod - remainder;
      firstWrapCtx = ctxStart + distToEnd / safeRate;
    }

    const LOOP_XFADE_SCHEDULE_COUNT = 64;
    for (let n = 0; n < LOOP_XFADE_SCHEDULE_COUNT; n++) {
      const wrapAt = firstWrapCtx + n * ctxLoopPeriod;
      const fadeOutStart = wrapAt - xfadeSec;
      const fadeInStart = wrapAt;
      // Defensive: wenn das vor dem aktuellen Zeitpunkt liegt, skippen.
      const now = this.ctx.currentTime;
      if (fadeOutStart < now) {
        // Kontinuierliche Re-Schedule würde hier kicken — für v3.72 First-Pass:
        // skip past cycles.
        continue;
      }
      try {
        xfade.gain.setValueCurveAtTime(fadeOutCurve, fadeOutStart, xfadeSec);
        xfade.gain.setValueCurveAtTime(fadeInCurve, fadeInStart, xfadeSec);
      } catch (err) {
        // Manche Browser werfen wenn die Kurven sich überlappen; defensive
        // gegen Mocks die setValueCurveAtTime nicht unterstützen.
        void err;
        break;
      }
    }

    this.audioTrackXfadeMeta.set(id, {
      nextScheduleAt: firstWrapCtx + LOOP_XFADE_SCHEDULE_COUNT * ctxLoopPeriod,
      loopPeriodSec: ctxLoopPeriod,
      scheduledCount: LOOP_XFADE_SCHEDULE_COUNT,
    });
  }

  private _startAudioTrackPositionRaf(id: string): void {
    if (this.audioTrackPositionRaf.has(id)) return;
    if (typeof requestAnimationFrame !== "function") return;
    const buf = this.audioTrackBuffers.get(id);
    if (!buf || !this.ctx) return;

    const tick = () => {
      const start = this.audioTrackStartTimes.get(id);
      const src = this.audioTrackSources.get(id);
      const workletNode = this.audioTrackWorkletNodes.get(id);
      if (!this.ctx) return;
      if (!start || (!src && !workletNode)) return;
      const data = this.audioTrackData.get(id);
      const dur = buf.duration || 1;
      let sec: number;
      if (workletNode) {
        // Worklet liefert samplePos via postMessage – wir lesen aus Map.
        const samplePos = this.audioTrackWorkletPositions.get(id) ?? 0;
        const sr = buf.sampleRate || this.ctx.sampleRate || 44100;
        sec = samplePos / sr;
      } else {
        // v3.52.0: gemeinsame Rate-Berechnung mit playAudioTrack (inkl. stretchRatio)
        const rate = this._calcAudioTrackPlaybackRate(data);
        const elapsedCtx = this.ctx.currentTime - start.ctxStart;
        sec = start.offsetSec + elapsedCtx * rate;
      }
      let pos01 = sec / dur;
      if (data?.loop) {
        // Modulo im Loop, damit pos01 in [0, 1) bleibt.
        pos01 = ((pos01 % 1) + 1) % 1;
      } else {
        pos01 = Math.min(1, Math.max(0, pos01));
      }
      this.audioTrackPositionListeners.get(id)?.forEach(cb => {
        try { cb(pos01, sec); } catch { /* ignore */ }
      });
      // Naechsten Frame nur planen wenn noch listener da sind und source ODER worklet aktiv.
      const stillActive = this.audioTrackSources.has(id) || this.audioTrackWorkletNodes.has(id);
      if (
        stillActive
        && (this.audioTrackPositionListeners.get(id)?.size ?? 0) > 0
      ) {
        const rid = requestAnimationFrame(tick);
        this.audioTrackPositionRaf.set(id, rid);
      } else {
        this.audioTrackPositionRaf.delete(id);
      }
    };
    const rid = requestAnimationFrame(tick);
    this.audioTrackPositionRaf.set(id, rid);
  }

  private _stopAudioTrackPositionRaf(id: string): void {
    const rid = this.audioTrackPositionRaf.get(id);
    if (rid !== undefined) {
      try {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(rid);
      } catch { /* ignore */ }
      this.audioTrackPositionRaf.delete(id);
    }
  }

  /**
   * Wendet die Audio-Track-Solo-Logik an: wenn irgendein Audio-Track ODER
   * irgendein Drum-Part soloed ist, sind alle nicht-soloed Audio-Tracks
   * effektiv stumm (cross-store Solo-Verhalten, FOLLOWUP-102/B).
   * Drum-Parts werden über den Scheduler-Loop separat gesteppskipped.
   * Der drumSoloFlagGetter ist optional — wenn null, wirkt nur das
   * audio-track-interne Solo (Legacy-Verhalten v1.16.x).
   */
  private _reapplyAudioTrackSoloMutes(): void {
    const list = Array.from(this.audioTrackData.values());
    const anyAudioSolo = list.some(t => t.soloed);
    const anyDrumSolo = this.drumSoloFlagGetter?.() ?? false;
    const anySolo = anyAudioSolo || anyDrumSolo;
    for (const t of list) {
      const effectiveMuted = t.muted || (anySolo && !t.soloed);
      this.setChannelVolume(t.id, effectiveMuted ? 0 : t.volume);
    }
  }

  // ─── Envelope Follower ────────────────────────────────────────────────────

  private _envelopeAnalysers = new Map<string, AnalyserNode>();
  private _envelopeLevels = new Map<string, number>();

  /** Gibt den aktuellen Envelope-Level (0–1) eines Kanals zurück. */
  getChannelEnvelopeLevel(partId: string): number {
    return this._envelopeLevels.get(partId) ?? 0;
  }

  /**
   * Startet das Envelope-Tracking für einen Kanal.
   * Hängt einen AnalyserNode an den Kanal-Output und liest den RMS-Pegel.
   */
  startEnvelopeFollower(partId: string): void {
    if (!this.ctx || this._envelopeAnalysers.has(partId)) return;
    const nodes = this.channelNodes.get(partId);
    if (!nodes) return;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    nodes.output.connect(analyser);
    this._envelopeAnalysers.set(partId, analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!this._envelopeAnalysers.has(partId)) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      this._envelopeLevels.set(partId, Math.min(1, rms * 4));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stopEnvelopeFollower(partId: string): void {
    const analyser = this._envelopeAnalysers.get(partId);
    if (analyser) {
      try { analyser.disconnect(); } catch { /* ignore */ }
      this._envelopeAnalysers.delete(partId);
      this._envelopeLevels.delete(partId);
    }
  }

  // ─── Live-Input Channels (TASK-233 / v2.85) ─────────────────────────────────
  //
  // Outboard-FX-Box-Modus: User schickt KORG-Hardware (Electribe / ESX) per
  // USB-Audio nach Synthstudio. Audio durchläuft die volle Insert-/Send-FX-Chain
  // wie ein drum-part und geht wieder raus. Routing:
  //
  //   getUserMedia(deviceId) → MediaStream
  //     → MediaStreamSource
  //     → DelayNode (latencyCompensationMs / 1000)  // manual PDC
  //     → channelNodes.input  (full FX-chain reused)
  //     → master
  //
  // PDC (Plugin-Delay-Compensation) ist *manuell* — der User justiert die
  // Latenz pro Channel via UI-Slider. Volle automatische PDC würde alle
  // anderen Bus-Pfade kompensieren müssen (komplex, später). MVP: hier wird
  // nur dieser Live-Input verzögert; für negative Kompensation (Live-Input
  // führt vor Drums) müsste man stattdessen die Drum-Busse delayen — aktuell
  // nicht implementiert (Default-Latenz vom Audio-Interface ist immer positiv,
  // sodass die meisten User mit 0–200 ms Delay auskommen).

  /** Per-Channel Live-Input-Streams + Nodes (TASK-233). */
  private _liveInputs = new Map<
    string,
    {
      stream: MediaStream;
      source: MediaStreamAudioSourceNode;
      latencyDelay: DelayNode;
      deviceId: string;
    }
  >();

  /** Persist last latency-Wert pro Channel auch wenn Stream gerade nicht hängt. */
  private _liveInputLatencyMs = new Map<string, number>();

  /**
   * Verbindet ein Audio-Input-Device als Mixer-Channel mit voller FX-Chain.
   * Idempotent: zweiter Aufruf für denselben channelId stoppt erst den
   * vorhandenen Stream + erzeugt einen neuen (Device-Switch).
   *
   * @throws Error wenn getUserMedia nicht verfügbar (kein https / kein Mic-API)
   * @throws DOMException wenn der User die Permission verweigert
   *                       — caller muss in try/catch.
   */
  async attachLiveInput(channelId: string, deviceId: string): Promise<void> {
    await this.init();
    if (!this.ctx) throw new Error("AudioContext not initialised");

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("MediaDevices.getUserMedia() is not available in this environment");
    }

    // Bei Re-Attach (Device-Switch) erst altes cleanup
    if (this._liveInputs.has(channelId)) {
      this.detachLiveInput(channelId);
    }

    // Standard-Constraints: deaktivierte Browser-Processing für Outboard-FX
    // (User will Raw-Audio durch unsere FX-Chain — kein Echo-Cancellation,
    // sonst zerstört Chrome unser Audio).
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as MediaTrackConstraints,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    // Channel-Nodes anlegen (FX-Chain wie drum-part) + Default-Volume/Pan setzen
    this._getOrCreateChannelNodes(channelId, DEFAULT_CHANNEL_FX);

    const source = this.ctx.createMediaStreamSource(stream);
    const latencyDelay = this.ctx.createDelay(1.0); // max 1s manuelle Kompensation
    const ms = this._liveInputLatencyMs.get(channelId) ?? 0;
    latencyDelay.delayTime.value = Math.max(0, Math.min(1, ms / 1000));

    // Routing: source → latency → channel input → existing FX-Chain → master
    const nodes = this.channelNodes.get(channelId);
    if (!nodes) {
      // sollte nicht passieren weil _getOrCreateChannelNodes oben angelegt hat
      stream.getTracks().forEach(t => t.stop());
      throw new Error(`channelNodes missing for ${channelId}`);
    }
    source.connect(latencyDelay);
    latencyDelay.connect(nodes.input);

    this._liveInputs.set(channelId, { stream, source, latencyDelay, deviceId });
  }

  /**
   * Trennt einen Live-Input + stoppt alle Stream-Tracks (verhindert Zombie-
   * Streams mit aktiver Hardware-Indikator-LED am Audio-Interface).
   * Idempotent: no-op wenn channelId unbekannt.
   */
  detachLiveInput(channelId: string): void {
    const entry = this._liveInputs.get(channelId);
    if (!entry) return;
    try { entry.source.disconnect(); } catch { /* ignore */ }
    try { entry.latencyDelay.disconnect(); } catch { /* ignore */ }
    try { entry.stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    this._liveInputs.delete(channelId);
  }

  /**
   * Setzt die manuelle Latenz-Kompensation in ms (0..1000) für einen
   * Live-Input-Channel. Wert wird auch persistiert wenn aktuell kein
   * Stream attached ist (User-Setting überlebt Detach/Re-Attach).
   */
  setLiveInputLatencyMs(channelId: string, ms: number): void {
    const clamped = Math.max(0, Math.min(1000, ms));
    this._liveInputLatencyMs.set(channelId, clamped);
    const entry = this._liveInputs.get(channelId);
    if (entry && this.ctx) {
      entry.latencyDelay.delayTime.setTargetAtTime(
        clamped / 1000,
        this.ctx.currentTime,
        0.01,
      );
    }
  }

  /** Liefert die aktuell gesetzte Latenz-Kompensation (0 wenn unbekannt). */
  getLiveInputLatencyMs(channelId: string): number {
    return this._liveInputLatencyMs.get(channelId) ?? 0;
  }

  /** True wenn ein aktiver MediaStream für diesen Channel hängt. */
  isLiveInputAttached(channelId: string): boolean {
    return this._liveInputs.has(channelId);
  }

  /**
   * Liefert eine geschätzte Audio-System-Latenz in ms (Base + Output Latency).
   * Default-Vorschlag für den User wenn er noch nicht manuell kalibriert hat.
   * Liefert 0 wenn AudioContext fehlt oder Browser die Felder nicht hat.
   */
  getEstimatedSystemLatencyMs(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    // baseLatency: hardware buffer (~2–10 ms); outputLatency: full path
    const base = (ctx as AudioContext & { baseLatency?: number }).baseLatency ?? 0;
    const out  = (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return Math.round((base + out) * 1000);
  }

  /** Liste der aktuell angeschlossenen Live-Input-Channels (für Cleanup-Loops). */
  getAttachedLiveInputChannelIds(): string[] {
    return Array.from(this._liveInputs.keys());
  }

  // ─── Audio-Recording (TASK-234 / v2.86) ─────────────────────────────────────
  //
  // Pro-Channel-Recorder. Tappt den Channel-Output (NACH FX-Chain, NACH Panner)
  // ab und sammelt Float32-Samples. Bei `stopRecording` wird ein WAV produziert.
  //
  // Pipeline (siehe AudioRecorder.ts für Detail):
  //   channelNodes[id].panner → ScriptProcessor → (silent sink → destination)
  //                                  ↓
  //                          Float32-Frames in RAM-Buffer
  //                                  ↓
  //                          encodeWavStereo / encodeWavMono
  //
  // Limit: MAX_SIMULTANEOUS_RECORDINGS (8) gleichzeitige Aufnahmen.
  // Wir tappen MONO (Channel-Output-GainNode ist 1-Kanal bis zum Panner).
  //
  // App.tsx wired:
  //   - transport:play → AudioEngine.startRecordingForArmedChannels(armedIds)
  //   - transport:stop → AudioEngine.finalizeAllRecordings()
  //
  // KEINE persistente State-Bridge — der Recorder weiß nur was gerade läuft;
  // armed-Flag lebt im Store (useLiveInputStore / useAudioTrackStore).

  private _audioRecorder = new AudioRecorder();
  private _liveRecorder = new LiveRecorder();
  private _looperEngine = new LooperEngine();

  /**
   * Startet eine Aufnahme für genau einen Channel. Source-Node: der `panner`
   * des Channels (post-FX, pre-master). Mono, weil der Channel-Strip bis dahin
   * 1-kanalig läuft.
   *
   * @returns `true` wenn gestartet; `false` wenn bereits läuft oder Channel
   *          unbekannt oder Limit erreicht.
   */
  startRecording(channelId: string): boolean {
    if (!this.ctx) return false;
    const nodes = this.channelNodes.get(channelId);
    if (!nodes) return false;
    if (this._audioRecorder.activeCount() >= MAX_SIMULTANEOUS_RECORDINGS) {
      return false;
    }
    // Tap am Panner: nach Insert-FX, vor Sidechain + Master.
    // Mono — Web-Audio StereoPanner mischt aber zu 2 Kanälen; wir nehmen
    // den Output trotzdem mono auf (ScriptProcessor mit 1-Channel),
    // Browser downmixed automatisch.
    return this._audioRecorder.start(channelId, nodes.panner, 1);
  }

  /**
   * Stoppt eine einzelne Aufnahme + liefert das WAV-Result.
   * Returnt null wenn der Channel nicht aufnimmt.
   */
  stopRecording(channelId: string): RecordingResult | null {
    return this._audioRecorder.stop(channelId);
  }

  /**
   * Startet Aufnahmen für alle Channels in der Liste (typisch: alle armed
   * Channels beim Transport-Play). Returnt eine detaillierte Map:
   * - `started`: Channels die erfolgreich Aufnahme starten konnten
   * - `rejected`: Channels die NICHT starten konnten (Engine-Limit oder
   *               unbekannte channelId — typischer Grund: User hat mehr
   *               Channels armed als MAX_SIMULTANEOUS_RECORDINGS erlaubt)
   * - `ok`:       true wenn rejected.length === 0, sonst false
   *
   * v3.63.0: API-Erweiterung von `string[]` auf Detail-Result um Performance-
   * Toast im UI zu unterstützen ("X channels could not start recording").
   * Kein Breakage — Caller die nur das Array brauchen lesen `.started`.
   */
  startRecordingForChannels(channelIds: string[]): {
    ok: boolean;
    started: string[];
    rejected: string[];
  } {
    const started: string[] = [];
    const rejected: string[] = [];
    for (const id of channelIds) {
      if (this.startRecording(id)) {
        started.push(id);
      } else {
        rejected.push(id);
      }
    }
    return { ok: rejected.length === 0, started, rejected };
  }

  /**
   * Stoppt ALLE aktiven Aufnahmen und liefert die Ergebnisse. Wird vom
   * Transport-Stop-Hook aufgerufen.
   */
  finalizeAllRecordings(): RecordingResult[] {
    return this._audioRecorder.stopAll();
  }

  /** True wenn der gegebene Channel gerade aufgenommen wird. */
  isRecordingChannel(channelId: string): boolean {
    return this._audioRecorder.isRecording(channelId);
  }

  /** Liste der aktiv aufnehmenden Channel-IDs (für UI-Indikatoren). */
  getActiveRecordingChannelIds(): string[] {
    return this._audioRecorder.activeChannelIds();
  }

  /** Aktuelle Aufnahmedauer in Millisekunden (für Timer-Overlay). */
  getRecordingDurationMs(channelId: string): number {
    return this._audioRecorder.currentDurationMs(channelId);
  }

  /** Bricht eine Aufnahme ab OHNE Encode (Cleanup-Pfad bei removeChannel). */
  cancelRecording(channelId: string): void {
    this._audioRecorder.cancel(channelId);
  }

  // ─── Live-Multi-Track-Recording (v3.110.0) ──────────────────────────────
  //
  // ECHTE Real-Time-Session-Capture (vs. channelBounce.ts = offline-render).
  // Während Playback werden ALLE Live-Tweaks (Knobs, Mute/Solo, Pattern-
  // Switches, Macros) mitgeschnitten. Liefert Master + Per-Channel-WAVs.

  /**
   * Liefert oder erzeugt einen Tap-Node für einen Channel.
   * Aktuell = panner (post-FX, pre-master). Master-ID = "master" → masterGain.
   */
  getChannelTapNode(channelId: string): AudioNode | null {
    if (channelId === "master") return this.masterGain;
    const nodes = this.channelNodes.get(channelId);
    return nodes?.panner ?? null;
  }

  /**
   * Startet ein Live-Multi-Track-Recording. `channels === undefined` = ALLE
   * registrierten Channels werden getapped (zzgl. Master). Sonst nur die
   * angegebenen IDs.
   */
  startLiveRecording(channels?: string[]): boolean {
    if (!this.ctx) return false;
    // Sicherstellen dass keine alte Session noch läuft.
    if (this._liveRecorder.isRunning) return false;
    this._liveRecorder.setContext(this.ctx);
    this._liveRecorder.start(undefined, this.ctx.sampleRate);
    // Master immer dabei.
    if (this.masterGain) {
      this._liveRecorder.addTrack("master", this.masterGain, "master", 2);
    }
    // Channels — entweder explizit, oder alle bekannten.
    const ids = channels && channels.length > 0
      ? channels.filter(c => c !== "master")
      : Array.from(this.channelNodes.keys());
    for (const id of ids) {
      const tap = this.getChannelTapNode(id);
      if (tap) this._liveRecorder.addTrack(id, tap, "channel", 2);
    }
    return true;
  }

  /** Stoppt das Live-Recording und liefert das fertige Result. */
  stopLiveRecording(): LiveRecordingResult {
    return this._liveRecorder.stop();
  }

  /** True solange `startLiveRecording` lief. */
  get liveRecording(): boolean {
    return this._liveRecorder.isRunning;
  }

  /** Anzahl aktuell getappter Tracks (Master + Channels). */
  getLiveRecordingTrackCount(): number {
    return this._liveRecorder.trackCount;
  }

  /** Aufnahmedauer in ms (für UI-Timer). */
  getLiveRecordingDurationMs(): number {
    return this._liveRecorder.recordedDurationMs;
  }

  /** Bricht Live-Recording ohne Encode ab (Cleanup). */
  cancelLiveRecording(): void {
    this._liveRecorder.cancel();
  }

  /**
   * Test-Helper — direkter Zugriff auf den Recorder. Nicht für Produktiv-Code.
   * Wird in tests/features/live-recorder.test.ts genutzt.
   */
  __getLiveRecorderForTests(): LiveRecorder {
    return this._liveRecorder;
  }

  // ─── Live-Looper (TASK-235 / v2.87) ──────────────────────────────────────
  //
  // RC-505 / Ableton Live Looper. Max 4 Loops. State-Machine in looperUtils.ts.
  // Audio-Buffer leben in LooperEngine; AudioEngine stellt nur Tap-Source +
  // Mix-Bus zur Verfügung. Loops werden NACH der Channel-FX-Chain abgegriffen
  // (panner) und VOR dem Master gemischt — gleicher Pfad wie Recording.

  /**
   * Verdrahtet Store-Callbacks. Wird einmalig in App.tsx-Bootstrap aufgerufen,
   * damit der Store über State-/Length-Änderungen informiert wird.
   */
  setLooperCallbacks(
    onState: (index: number, state: LoopState) => void,
    onLength: (index: number, lengthBeats: number, lengthSec: number, frameCount: number) => void,
  ): void {
    this._looperEngine.setCallbacks({ onState, onLength });
  }

  /**
   * Triggert den Loop-State-Machine-Step (Pad-Klick / Footswitch).
   *
   * @param index           Loop-Index (0..MAX_LOOPS-1)
   * @param sourceChannelId Channel-ID dessen panner-Node als Tap-Source dient.
   *                        Leer-String → versuche masterGain als Source (Mix-Loop).
   */
  triggerLoop(index: number, sourceChannelId: string): void {
    if (!this.ctx) return;
    let source: AudioNode | null = null;
    if (sourceChannelId) {
      const nodes = this.channelNodes.get(sourceChannelId);
      source = nodes?.panner ?? null;
    } else {
      // Mix-Tap: alles was am Master ankommt. Funktionsfähig auch ohne
      // Channel-Auswahl — sinnvoll für "Whole-Mix-Looping".
      source = this.masterGain;
    }
    this._looperEngine.trigger(index, source);
  }

  /** Long-Press / explizite Erase-Action. */
  eraseLoop(index: number): void {
    this._looperEngine.erase(index);
  }

  /** Aktueller State des Loops (für UI-Polling / Color-Code). */
  getLoopState(index: number): LoopState {
    return this._looperEngine.getLoopState(index);
  }

  /** Progress 0..1 für den Progress-Ring im UI. */
  getLoopProgress(index: number): number {
    const now = this.ctx?.currentTime ?? 0;
    return this._looperEngine.getProgress(index, now);
  }

  /** Transport-Stop hat alle Loop-Playbacks pausiert. */
  stopAllLoopPlayback(): void {
    this._looperEngine.stopAllPlayback();
  }

  // ─── Slice-Pad-Playback (TASK-238-FOLLOWUP-1 / v2.90) ────────────────────
  /**
   * Spielt einen Slice-Buffer (Float32Array, Mono) als One-Shot ab.
   *
   * @param buffer     Float32Array mit Audio-Daten (Mono).
   * @param sampleRate Sample-Rate des Buffers.
   * @returns true wenn erfolgreich gestartet, false wenn AudioContext fehlt.
   */
  playSliceBuffer(buffer: Float32Array, sampleRate: number): boolean {
    if (!this.ctx || !this.masterGain) return false;
    if (!buffer || buffer.length === 0) return false;
    const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
    try {
      const audioBuffer = this.ctx.createBuffer(1, buffer.length, rate);
      // copyToChannel akzeptiert nur Float32Array<ArrayBuffer>; bei
      // Float32Array<ArrayBufferLike> (z.B. aus File.arrayBuffer) braucht es
      // einen impliziten Copy → neue Float32Array vom selben Inhalt.
      audioBuffer.copyToChannel(new Float32Array(buffer), 0);
      const src = this.ctx.createBufferSource();
      src.buffer = audioBuffer;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.85;
      src.connect(gain);
      gain.connect(this.masterGain);
      src.start();
      src.onended = () => {
        try { src.disconnect(); gain.disconnect(); } catch { /* ignore */ }
      };
      return true;
    } catch (err) {
      console.warn("[AudioEngine] playSliceBuffer failed", err);
      return false;
    }
  }
}

export const AudioEngine = new AudioEngineClass();
