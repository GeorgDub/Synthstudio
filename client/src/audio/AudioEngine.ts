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
  stepCount: 16 | 32;
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
  private _globalDelayBus: DelayNode | null = null;
  private _globalDelayFeedback: GainNode | null = null;
  private _globalDelayWet: GainNode | null = null;

  // Scheduling
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  // Sammelt pending Position-Callback-Timeouts, damit stop() sie aufräumen kann
  private _pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly LOOK_AHEAD = 0.1;
  private readonly SCHEDULE_INTERVAL = 16;

  // Transport
  private _isPlaying = false;
  private _bpm = 120;
  private _steps = 16;
  private _currentStep = 0;
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
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;
    this.masterGain.connect(this.ctx.destination);

    // Global Reverb Bus (Plate-ähnlich, 2s Decay)
    this._globalReverbBus = this.ctx.createConvolver();
    this._globalReverbWet = this.ctx.createGain();
    this._globalReverbWet.gain.value = 0.6;
    this._getOrCreateReverbBuffer(2.0).then(buf => {
      if (buf && this._globalReverbBus) this._globalReverbBus.buffer = buf;
    });
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
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === "suspended") await this.ctx.resume();
  }

  setBpm(bpm: number) {
    this._bpm = Math.max(20, Math.min(300, bpm));
    this._updateAudioTrackPlaybackRates();
  }
  setSteps(steps: 16 | 32) { this._steps = steps; }
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
  smoothBpmTransition(targetBpm: number, bars: number, stepCount: 16 | 32 = 16): void {
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
      nodes.sidechainGain.connect(this.masterGain);
    }
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

  onPosition(cb: PositionCallback) {
    this.positionCallbacks.push(cb);
    return () => { this.positionCallbacks = this.positionCallbacks.filter(c => c !== cb); };
  }

  async play(fromStep = 0) {
    await this.init();
    await this.resume();
    if (this._isPlaying) this.stop();

    this._isPlaying = true;
    this._currentStep = fromStep;
    this._nextStepTime = this.ctx!.currentTime + 0.05;

    this.schedulerTimer = setInterval(() => this._schedule(), this.SCHEDULE_INTERVAL);

    // Externe Audio-Tracks (Vocals, Songs) parallel zum Step-Sequencer starten.
    this.playAllRegisteredAudioTracks();
  }

  stop() {
    // Audio-Tracks (Vocals/Songs) zuerst stoppen, solange ctx noch verfügbar ist.
    this.stopAllAudioTracks();
    this._isPlaying = false;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    // Pending Position-Callbacks abräumen — sonst feuern sie nach Stop
    this._pendingTimeouts.forEach((id) => clearTimeout(id));
    this._pendingTimeouts.clear();
    this._currentStep = 0;
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
    const now = this.ctx.currentTime;
    const lookAheadUntil = now + this.LOOK_AHEAD;

    while (this._nextStepTime < lookAheadUntil) {
      const pattern = this.patternGetter?.();
      const effectiveBpm = pattern?.bpm ?? this._bpm;
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

      if (part.sampleUrl) {
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
        this._triggerMelodicNote(time, freq, vol, part.pan ?? 0);
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

  /** Melodische Note als kurzen Sinus-Ton abspielen (Piano Roll Playback) */
  private _triggerMelodicNote(time: number, freq: number, volume: number, pan: number): void {
    if (!this.ctx || !this.masterGain) return;
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
    sidechainGain.connect(master);

    // Sends vom Output in globale Buses
    if (this._globalReverbBus) output.connect(globalReverbSend);
    if (this._globalReverbBus) globalReverbSend.connect(this._globalReverbBus);
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

  private async _getOrCreateReverbBuffer(decay: number): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const key = decay.toFixed(1);
    const cached = this.reverbBuffers.get(key);
    if (cached) return cached;

    // Synthetischen Reverb-IR generieren
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * decay);
    const buf = this.ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }

    this.reverbBuffers.set(key, buf);
    return buf;
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

    if (data?.syncMode === "timestretch") {
      void this._playAudioTrackViaWorklet(id, opts);
      return;
    }

    // Existierende Source stoppen (Replay) – auch evtl. Worklet, falls zuvor aktiv.
    this._stopAudioTrackSource(id);
    this._stopAudioTrackWorklet(id);

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.loop = opts?.loop ?? data?.loop ?? false;

    // PlaybackRate aus syncMode ableiten
    const rate = this._calcAudioTrackPlaybackRate(data);
    source.playbackRate.value = rate;

    // Routing: source → channelNodes.input → FX → master
    const nodes = this._getOrCreateChannelNodes(id, DEFAULT_CHANNEL_FX);
    source.connect(nodes.input);

    const offsetSec = Math.max(0, opts?.startOffsetSec ?? data?.startOffsetSec ?? 0);
    const ctxStart = this.ctx.currentTime;
    try {
      source.start(ctxStart, offsetSec);
    } catch (err) {
      console.warn("[AudioEngine] playAudioTrack start error:", err);
      return;
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
    const wantLoop = opts?.loop ?? data?.loop ?? false;
    try {
      node.port.postMessage({ type: "setBuffer", channels });
      node.port.postMessage({ type: "setLoop", loop: wantLoop });
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

    // Stretch-Param: bpm / originalBpm (default 1.0).
    const orig = data?.originalBpm && data.originalBpm > 0 ? data.originalBpm : null;
    const ratio = orig ? this._bpm / orig : 1.0;
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

  // ─── Private: Audio-Track Helpers ──────────────────────────────────────────

  /**
   * Berechnet die effektive Playback-Rate für BufferSource ("stretch") oder
   * den Worklet-Stretch-Param ("timestretch"). Beide nutzen dasselbe Verhältnis
   * `bpm/originalBpm` – der Unterschied liegt im Routing (Pitch-Kopplung).
   */
  private _calcAudioTrackPlaybackRate(data: AudioTrackChannelData | undefined): number {
    if (!data) return 1;
    if (data.syncMode !== "stretch" && data.syncMode !== "timestretch") return 1;
    const orig = data.originalBpm;
    if (!orig || orig <= 0) return 1;
    return this._bpm / orig;
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
  }

  private _cleanupAudioTrackSource(id: string): void {
    this.audioTrackSources.delete(id);
    this.audioTrackStartTimes.delete(id);
    this._stopAudioTrackPositionRaf(id);
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
        const rate = (data?.syncMode === "stretch" || data?.syncMode === "timestretch")
          && data.originalBpm
          ? this._bpm / data.originalBpm
          : 1;
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
}

export const AudioEngine = new AudioEngineClass();
