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

export interface StepData {
  active: boolean;
  velocity?: number;       // 0–127
  pitch?: number;          // Halbtöne
  probability?: number;    // NEU: 0–100, default 100
  condition?: StepCondition; // NEU: default { type: "always" }
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
  steps: StepData[];
  fx: ChannelFx;
  /** NEU (Phase 5): Quelle des Sounds – Sample oder Synthesizer */
  sourceType?: "sample" | "wavetable" | "fm";
  /** NEU (Phase 5): Synthesizer-Parameter (nur wenn sourceType !== "sample") */
  synthParams?: import("./SynthEngine").SynthParams;
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
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class AudioEngineClass {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private loadingPromises = new Map<string, Promise<AudioBuffer | null>>();
  private channelNodes = new Map<string, ChannelNodes>();
  private reverbBuffers = new Map<string, AudioBuffer>(); // decay → buffer

  // Scheduling
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
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

  // Probability / Fill state (Phase 1)
  private loopCount = 0;
  private isFillActive = false;

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
  }

  async resume(): Promise<void> {
    if (this.ctx?.state === "suspended") await this.ctx.resume();
  }

  setBpm(bpm: number) { this._bpm = Math.max(20, Math.min(300, bpm)); }
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

  setPatternGetter(getter: () => PatternData) { this.patternGetter = getter; }

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
  }

  stop() {
    this._isPlaying = false;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
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

  private _stepDuration(resolution?: StepResolution): number {
    const res = resolution ?? this._stepResolution;
    const beatDuration = 60 / this._bpm;
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
      this._scheduleStep(this._currentStep, this._nextStepTime);
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
      this._nextStepTime += this._stepDuration();
      // Sofortiger Wechsel (quantizeMode=step)
      if (this.queuedPatternId && this.quantizeMode === "step") {
        const nextId = this.queuedPatternId;
        this.queuedPatternId = null;
        this.patternSwitchCallback?.(nextId);
      }
    }
  }

  // ─── Private: Probability-Check ──────────────────────────────────────────

  /** Prüft ob ein Step ausgelöst werden soll (Probability + Condition) */
  shouldTriggerStep(step: StepData): boolean {
    if (!step.active) return false;
    const prob = Math.max(0, Math.min(100, step.probability ?? 100));
    if (prob <= 0) return false;
    if (prob < 100 && Math.random() * 100 > prob) return false;
    const condition = step.condition;
    if (!condition || condition.type === "always") return true;
    if (condition.type === "every") {
      return (this.loopCount % condition.of) === (condition.n - 1);
    }
    if (condition.type === "fill") return this.isFillActive;
    if (condition.type === "not_fill") return !this.isFillActive;
    return true;
  }

  private _scheduleStep(stepIndex: number, time: number) {
    const step = stepIndex;
    setTimeout(() => {
      if (this._isPlaying) this.positionCallbacks.forEach(cb => cb(step));
    }, Math.max(0, (time - (this.ctx?.currentTime ?? 0)) * 1000 - 5));

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
        this._playClick(time, vol, freq);
      }
    }

    if (!this.patternGetter) return;
    const pattern = this.patternGetter();

    // BPM aus Pattern (falls gesetzt)
    const effectiveBpm = pattern.bpm ?? this._bpm;
    const effectiveResolution = pattern.stepResolution ?? this._stepResolution;

    pattern.parts.forEach((part, partIndex) => {
      if (part.muted) return;
      // Solo-Check
      const anySolo = pattern.parts.some(p => p.soloed);
      if (anySolo && !part.soloed) return;

      const partRes = part.stepResolution ?? effectiveResolution;
      const step = part.steps[stepIndex];
      if (!step || !this.shouldTriggerStep(step)) return;

      const scheduled: ScheduledStep = {
        partIndex,
        stepIndex,
        time,
        velocity: step.velocity ?? 100,
        pan: part.pan ?? 0,
        pitch: step.pitch ?? 0,
      };

      this.stepCallbacks.forEach(cb => cb(scheduled));

      if (part.sampleUrl) {
        this._loadBuffer(part.sampleUrl).then(buf => {
          if (!buf || !this.ctx) return;
          const vol = (scheduled.velocity / 127) * (part.volume ?? 1.0);
          this._triggerBufferWithFx(buf, scheduled.time, vol, scheduled.pan, scheduled.pitch, part);
        });
      }
    });
  }

  // ─── Private: Sample triggern mit Effektkette ─────────────────────────────

  private _triggerBufferWithFx(
    buf: AudioBuffer,
    time: number,
    volume: number,
    pan: number,
    pitch: number,
    part: PartData
  ) {
    if (!this.ctx || !this.masterGain) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    if (pitch !== 0) source.playbackRate.value = Math.pow(2, pitch / 12);

    // Kanal-Knoten holen oder erstellen
    const nodes = this._getOrCreateChannelNodes(part.id, part.fx);

    // Volume in den Kanal-Input
    nodes.input.gain.value = Math.max(0, Math.min(2, volume));
    nodes.panner.pan.value = Math.max(-1, Math.min(1, pan));

    source.connect(nodes.input);
    source.start(Math.max(time, this.ctx.currentTime));
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

    output.connect(panner);
    panner.connect(master);

    const nodes: ChannelNodes = {
      input, eq: { low: eqLow, mid: eqMid, high: eqHigh },
      filter, distortion, compressor,
      delayNode, delayFeedback, delayDry, delayWet,
      reverbConvolver, reverbDry, reverbWet,
      output, panner,
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

  private _playClick(time: number, volume: number, freq: number) {
    if (!this.ctx || !this.masterGain) return;
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
}

export const AudioEngine = new AudioEngineClass();
