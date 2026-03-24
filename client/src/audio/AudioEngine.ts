/**
 * Synthstudio – AudioEngine.ts
 *
 * Zentrale Audio-Engine basierend auf der Web Audio API.
 * Implementiert:
 * - Sample-Playback mit AudioBuffer-Cache
 * - Look-ahead Scheduling (16ms Interval, 100ms Look-ahead)
 * - Präzises Timing über AudioContext.currentTime
 * - Velocity, Pan, Pitch-Shift pro Step
 * - Metronom (Click-Track)
 *
 * ─── DESIGN-PRINZIP ──────────────────────────────────────────────────────────
 * Die Engine ist ein reines Singleton-Modul (kein React-State).
 * React-Komponenten kommunizieren über den useAudioEngine()-Hook.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ScheduledStep {
  /** Welche Part-Zeile (0-basiert) */
  partIndex: number;
  /** Welcher Step (0-basiert) */
  stepIndex: number;
  /** AudioContext-Zeit für den Trigger */
  time: number;
  /** Velocity 0–127 */
  velocity: number;
  /** Pan -1 bis +1 */
  pan: number;
  /** Pitch-Shift in Halbtönen */
  pitch: number;
}

export type StepCallback = (step: ScheduledStep) => void;
export type PositionCallback = (currentStep: number) => void;

class AudioEngineClass {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private loadingPromises = new Map<string, Promise<AudioBuffer | null>>();

  // Scheduling
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private readonly LOOK_AHEAD = 0.1;   // Sekunden voraus planen
  private readonly SCHEDULE_INTERVAL = 16; // ms zwischen Scheduler-Aufrufen

  // Transport
  private _isPlaying = false;
  private _bpm = 120;
  private _steps = 16;
  private _currentStep = 0;
  private _nextStepTime = 0;
  private _startTime = 0;

  // Callbacks
  private stepCallbacks: StepCallback[] = [];
  private positionCallbacks: PositionCallback[] = [];

  // Pattern-Daten (werden von außen gesetzt)
  private patternGetter: (() => PatternData) | null = null;

  // Metronom
  private _metronomEnabled = false;
  private _metronomGain = 0.5;

  get isPlaying() { return this._isPlaying; }
  get bpm() { return this._bpm; }
  get currentStep() { return this._currentStep; }

  /** AudioContext initialisieren (muss nach User-Interaktion aufgerufen werden) */
  async init(): Promise<void> {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;
    this.masterGain.connect(this.ctx.destination);
    console.log("[AudioEngine] Initialisiert, Sample-Rate:", this.ctx.sampleRate);
  }

  /** AudioContext nach Browser-Suspend wieder aufwecken */
  async resume(): Promise<void> {
    if (this.ctx?.state === "suspended") {
      await this.ctx.resume();
    }
  }

  setBpm(bpm: number) {
    this._bpm = Math.max(20, Math.min(300, bpm));
  }

  setSteps(steps: 16 | 32) {
    this._steps = steps;
  }

  setMetronom(enabled: boolean, gain = 0.5) {
    this._metronomEnabled = enabled;
    this._metronomGain = gain;
  }

  setMasterVolume(vol: number) {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, vol)),
        this.ctx!.currentTime,
        0.01
      );
    }
  }

  /** Pattern-Getter registrieren (wird beim Scheduling aufgerufen) */
  setPatternGetter(getter: () => PatternData) {
    this.patternGetter = getter;
  }

  onStep(cb: StepCallback) {
    this.stepCallbacks.push(cb);
    return () => { this.stepCallbacks = this.stepCallbacks.filter(c => c !== cb); };
  }

  onPosition(cb: PositionCallback) {
    this.positionCallbacks.push(cb);
    return () => { this.positionCallbacks = this.positionCallbacks.filter(c => c !== cb); };
  }

  /** Transport starten */
  async play(fromStep = 0) {
    await this.init();
    await this.resume();
    if (this._isPlaying) this.stop();

    this._isPlaying = true;
    this._currentStep = fromStep;
    this._nextStepTime = this.ctx!.currentTime + 0.05; // 50ms Anlauf
    this._startTime = this.ctx!.currentTime;

    this.schedulerTimer = setInterval(() => this._schedule(), this.SCHEDULE_INTERVAL);
    console.log("[AudioEngine] Play gestartet, BPM:", this._bpm);
  }

  /** Transport stoppen */
  stop() {
    this._isPlaying = false;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this._currentStep = 0;
    this.positionCallbacks.forEach(cb => cb(0));
    console.log("[AudioEngine] Gestoppt");
  }

  /** Einzelnen Sample sofort abspielen (Preview) */
  async previewSample(url: string, volume = 1.0) {
    await this.init();
    await this.resume();
    const buf = await this._loadBuffer(url);
    if (!buf || !this.ctx) return;
    this._triggerBuffer(buf, this.ctx.currentTime, volume, 0, 0);
  }

  /** Sample-Buffer laden und cachen */
  async loadSample(url: string): Promise<AudioBuffer | null> {
    await this.init();
    return this._loadBuffer(url);
  }

  /** Alle gecachten Buffer freigeben */
  clearCache() {
    this.bufferCache.clear();
    this.loadingPromises.clear();
  }

  // ─── Private Methoden ────────────────────────────────────────────────────

  private _stepDuration(): number {
    // Dauer eines 16tel-Steps in Sekunden
    return (60 / this._bpm) / 4;
  }

  private _schedule() {
    if (!this.ctx || !this._isPlaying) return;
    const now = this.ctx.currentTime;
    const lookAheadUntil = now + this.LOOK_AHEAD;

    while (this._nextStepTime < lookAheadUntil) {
      this._scheduleStep(this._currentStep, this._nextStepTime);
      this._currentStep = (this._currentStep + 1) % this._steps;
      this._nextStepTime += this._stepDuration();
    }
  }

  private _scheduleStep(stepIndex: number, time: number) {
    // Position-Callback für UI-Update (via setTimeout für React)
    const step = stepIndex;
    setTimeout(() => {
      if (this._isPlaying) {
        this.positionCallbacks.forEach(cb => cb(step));
      }
    }, Math.max(0, (time - (this.ctx?.currentTime ?? 0)) * 1000 - 5));

    // Metronom-Click
    if (this._metronomEnabled && this.ctx && this.masterGain) {
      const isDownbeat = stepIndex % 4 === 0;
      this._playClick(time, isDownbeat ? 1.0 : 0.4, isDownbeat ? 1200 : 800);
    }

    // Pattern-Steps auslösen
    if (!this.patternGetter) return;
    const pattern = this.patternGetter();

    pattern.parts.forEach((part, partIndex) => {
      if (part.muted) return;
      const step = part.steps[stepIndex];
      if (!step?.active) return;

      const scheduled: ScheduledStep = {
        partIndex,
        stepIndex,
        time,
        velocity: step.velocity ?? 100,
        pan: part.pan ?? 0,
        pitch: step.pitch ?? 0,
      };

      // Step-Callback für Humanizer etc.
      this.stepCallbacks.forEach(cb => cb(scheduled));

      // Sample abspielen
      if (part.sampleUrl) {
        this._loadBuffer(part.sampleUrl).then(buf => {
          if (!buf || !this.ctx) return;
          const vol = (scheduled.velocity / 127) * (part.volume ?? 1.0);
          this._triggerBuffer(buf, scheduled.time, vol, scheduled.pan, scheduled.pitch);
        });
      }
    });
  }

  private _triggerBuffer(
    buf: AudioBuffer,
    time: number,
    volume: number,
    pan: number,
    pitch: number
  ) {
    if (!this.ctx || !this.masterGain) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buf;

    // Pitch via playbackRate (Halbtöne → Rate: 2^(n/12))
    if (pitch !== 0) {
      source.playbackRate.value = Math.pow(2, pitch / 12);
    }

    // Gain
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(2, volume));

    // Pan
    const panNode = this.ctx.createStereoPanner();
    panNode.pan.value = Math.max(-1, Math.min(1, pan));

    source.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(this.masterGain);

    source.start(Math.max(time, this.ctx.currentTime));
  }

  private _playClick(time: number, volume: number, freq: number) {
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(volume * this._metronomGain, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  private async _loadBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;

    // Cache-Hit
    const cached = this.bufferCache.get(url);
    if (cached) return cached;

    // Bereits ladend
    const pending = this.loadingPromises.get(url);
    if (pending) return pending;

    // Neu laden
    const promise = (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
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
}

// ─── Pattern-Datentypen ───────────────────────────────────────────────────────

export interface StepData {
  /** Step aktiv? */
  active: boolean;
  /** Velocity 0–127 (Standard: 100) */
  velocity?: number;
  /** Pitch-Shift in Halbtönen */
  pitch?: number;
}

export interface PartData {
  id: string;
  name: string;
  /** URL zum Sample (Blob-URL oder Datei-Pfad) */
  sampleUrl?: string;
  /** Muted? */
  muted: boolean;
  /** Solo? */
  soloed: boolean;
  /** Volume 0–1 */
  volume: number;
  /** Pan -1 bis +1 */
  pan: number;
  /** Steps (16 oder 32) */
  steps: StepData[];
}

export interface PatternData {
  id: string;
  name: string;
  /** Anzahl Steps (16 oder 32) */
  stepCount: 16 | 32;
  parts: PartData[];
}

// ─── Singleton-Export ─────────────────────────────────────────────────────────
export const AudioEngine = new AudioEngineClass();
