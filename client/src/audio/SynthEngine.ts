/**
 * SynthEngine.ts – Wavetable / FM Synthesizer Engine
 * Phase 5 + Phase I: Wavetable, FM, erweiterte LFOs
 *
 * Neu in Phase I:
 *  - LFO Waveform-Auswahl (sine, square, sawtooth, triangle, s&h/random)
 *  - LFO BPM-Sync: Rate als Takt-Bruch (1/4, 1/8, 1/16, 1/32, 1/2, 1/1)
 *  - LFO Target: pitch, volume, filter (vollständig verdrahtet)
 *  - Glide / Portamento für Melodie-Parts
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export type OscillatorType = "sine" | "sawtooth" | "square" | "triangle" | "custom";
export type SynthMode = "wavetable" | "fm";
export type LfoWaveform = "sine" | "square" | "sawtooth" | "triangle" | "random" | "sh";
export type LfoBpmRate = "free" | "1/1" | "1/2" | "1/4" | "1/8" | "1/16" | "1/32" | "1/64";

export interface SynthParams {
  mode: SynthMode;
  // Wavetable
  oscType: OscillatorType;
  detune: number;            // Cents (-100..+100)
  // FM
  fmRatio: number;           // Modulator/Carrier Frequenz-Verhältnis (0.1–10)
  fmDepth: number;           // Modulations-Tiefe in Hz (0–1000)
  // ADSR
  attack: number;            // 0–2s
  decay: number;             // 0–2s
  sustain: number;           // 0–1
  release: number;           // 0–5s
  // LFO
  lfoEnabled: boolean;
  lfoRate: number;           // Hz (0.1–20), nur wenn lfoBpmSync === "free"
  lfoDepth: number;          // Cents (0–100)
  lfoTarget: "pitch" | "volume" | "filter";
  lfoWaveform: LfoWaveform;  // NEU: Wellenform
  lfoBpmSync: LfoBpmRate;    // NEU: BPM-Sync Rate
  // Glide
  glide: number;             // Portamento-Zeit 0–2s (0 = kein Glide)
}

export const DEFAULT_SYNTH_PARAMS: SynthParams = {
  mode: "wavetable",
  oscType: "sawtooth",
  detune: 0,
  fmRatio: 2,
  fmDepth: 100,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.8,
  release: 0.3,
  lfoEnabled: false,
  lfoRate: 4,
  lfoDepth: 10,
  lfoTarget: "pitch",
  lfoWaveform: "sine",
  lfoBpmSync: "free",
  glide: 0,
};

// LFO→Filter (v3.269): Der Synth-Voice-Pfad hat regulär KEINEN Filter. Wenn der
// LFO auf "filter" routet, fügen wir per Voice einen Lowpass ein und sweepen
// dessen Cutoff. Es gibt (noch) keinen Cutoff/Q-Knopf — daher feste, musikalisch
// sinnvolle Werte: Basis-Cutoff + moderate Resonanz, Hub skaliert mit lfoDepth.
const FILTER_LFO_BASE_HZ = 1500;   // Basis-Cutoff (Mitte des Sweeps)
const FILTER_LFO_Q = 4;            // hörbare, nicht schrille Resonanz
const FILTER_LFO_RANGE_HZ = 1200;  // ±Hz-Hub bei lfoDepth = 100

// ─── BPM-Sync Berechnung ──────────────────────────────────────────────────────

export const LFO_BPM_RATES: Record<LfoBpmRate, number> = {
  "free": 0,
  "1/1":  1,
  "1/2":  2,
  "1/4":  4,
  "1/8":  8,
  "1/16": 16,
  "1/32": 32,
  "1/64": 64,
};

export const LFO_WAVEFORM_LABELS: Record<LfoWaveform, string> = {
  sine:     "Sine",
  square:   "Square",
  sawtooth: "Sawtooth",
  triangle: "Triangle",
  random:   "Random",
  sh:       "S&H",
};

/** Berechnet LFO-Rate in Hz aus BPM und Sync-Rate. */
export function lfoRateFromBpm(bpm: number, syncRate: LfoBpmRate): number {
  if (syncRate === "free") return 0; // Wird nicht verwendet
  const beatsPerBar = 4;
  const beatsPerSecond = bpm / 60;
  const division = LFO_BPM_RATES[syncRate];
  return (beatsPerSecond * beatsPerBar) / division;
}

// ─── SynthEngine-Klasse ────────────────────────────────────────────────────────

/**
 * Macro-LFO Range-Konstanten (siehe TASK-117).
 *
 * Diese definieren den gültigen Wertebereich, den die Macro-Layer
 * (`setPartLfoRate` / `setPartLfoDepth`) durchsetzt:
 *  - Rate: 0.01 .. 30 Hz  (typischer LFO-Bereich; SynthParams selbst
 *    erlaubt nur 0.1..20 in der UI, aber Macros dürfen breiter)
 *  - Depth: 0 .. 1        (normalisiert; Macros arbeiten in 0..1)
 */
export const PART_LFO_RATE_MIN = 0.01;
export const PART_LFO_RATE_MAX = 30;
export const PART_LFO_DEPTH_MIN = 0;
export const PART_LFO_DEPTH_MAX = 1;

/** Pro-Part LFO-Macro-Overrides (TASK-117). */
interface PartLfoCacheEntry {
  rate?: number;
  depth?: number;
}

export class SynthEngine {
  private _bpm = 120;

  /**
   * Cache letzter via Macro gesetzter LFO-Werte pro Part-ID.
   * Wird von `setPartLfoRate` / `setPartLfoDepth` befüllt und kann von
   * Step-Trigger-Sites (AudioEngine, etc.) ausgelesen werden, um
   * `SynthParams.lfoRate`/`lfoDepth` zur Laufzeit zu überschreiben.
   *
   * Cache-Variant statt persistenter Per-Part-Audio-Nodes — Per-Note-LFOs
   * werden in `_attachLfo` weiterhin pro Step neu erzeugt, weil sie an die
   * Note-Lebensdauer gekoppelt sind. Der Macro-Setter speichert nur den
   * gewünschten Zielwert, der beim nächsten Step-Trigger sichtbar wird.
   */
  private _partLfoCache = new Map<string, PartLfoCacheEntry>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode
  ) {}

  setBpm(bpm: number) { this._bpm = bpm; }

  // ─── Macro-LFO-Setter (TASK-117) ──────────────────────────────────────────

  /**
   * Setzt die LFO-Rate (Hz) für einen Part. Wird zur Macro-Routing-Zeit
   * aufgerufen. Geclampt auf [PART_LFO_RATE_MIN, PART_LFO_RATE_MAX].
   *
   * Non-finite Werte (NaN, Infinity) werden ignoriert (no-op) — damit
   * misskonfigurierte Bindings nicht den Cache vergiften.
   *
   * Der Cache wird beim nächsten Step-Trigger gelesen und überschreibt
   * `synthParams.lfoRate`. Bestehende laufende Noten ändern sich nicht
   * (LFO-Nodes sind per-note erzeugt, an die Note-Lebensdauer gekoppelt).
   */
  setPartLfoRate(partId: string, hz: number): void {
    if (!partId || typeof partId !== "string") return;
    if (typeof hz !== "number" || !Number.isFinite(hz)) return;
    const clamped = Math.max(PART_LFO_RATE_MIN, Math.min(PART_LFO_RATE_MAX, hz));
    const existing = this._partLfoCache.get(partId) ?? {};
    this._partLfoCache.set(partId, { ...existing, rate: clamped });
  }

  /**
   * Setzt die LFO-Tiefe (0..1, normalisiert) für einen Part. Wird zur
   * Macro-Routing-Zeit aufgerufen. Geclampt auf [0, 1].
   *
   * Non-finite Werte werden ignoriert (no-op).
   *
   * Hinweis: SynthParams.lfoDepth ist intern in Cents (0..100). Aufrufer
   * können den 0..1-Wert hier setzen und beim Step-Trigger umrechnen
   * (oder den normalisierten Wert direkt als Multiplikator verwenden).
   */
  setPartLfoDepth(partId: string, depth: number): void {
    if (!partId || typeof partId !== "string") return;
    if (typeof depth !== "number" || !Number.isFinite(depth)) return;
    const clamped = Math.max(PART_LFO_DEPTH_MIN, Math.min(PART_LFO_DEPTH_MAX, depth));
    const existing = this._partLfoCache.get(partId) ?? {};
    this._partLfoCache.set(partId, { ...existing, depth: clamped });
  }

  /**
   * Liefert die letzte via `setPartLfoRate` gesetzte Rate für einen Part
   * (Hz), oder `null` wenn noch nie gesetzt.
   */
  getPartLfoRate(partId: string): number | null {
    const entry = this._partLfoCache.get(partId);
    return entry && typeof entry.rate === "number" ? entry.rate : null;
  }

  /**
   * Liefert die letzte via `setPartLfoDepth` gesetzte Tiefe für einen Part
   * (0..1), oder `null` wenn noch nie gesetzt.
   */
  getPartLfoDepth(partId: string): number | null {
    const entry = this._partLfoCache.get(partId);
    return entry && typeof entry.depth === "number" ? entry.depth : null;
  }

  /**
   * Löscht den Macro-LFO-Cache für einen Part (oder gesamt, wenn partId
   * weggelassen). Nützlich bei Part-Removal oder Project-Reset.
   */
  clearPartLfoCache(partId?: string): void {
    if (partId === undefined) {
      this._partLfoCache.clear();
    } else {
      this._partLfoCache.delete(partId);
    }
  }

  /**
   * Spielt eine Note ab.
   * @param frequency   Frequenz in Hz (z.B. 440 für A4)
   * @param params      Synth-Parameter
   * @param time        AudioContext-Zeit (ctx.currentTime + Offset)
   * @param prevFreq    Vorherige Frequenz für Glide (optional)
   * @param partId      Optional: wenn gesetzt, werden gecachte Macro-LFO-Werte
   *                    aus `_partLfoCache` über `params.lfoRate`/`lfoDepth` gelegt.
   * @param destination Optional: Per-Call Ziel-Node (z.B. Volume/Pan-Wrapper).
   *                    Default: die im Constructor übergebene Destination
   *                    (typischerweise masterGain). TASK-128 nutzt diesen Pfad,
   *                    damit AudioEngine pro Note eine eigene Gain+Pan-Kette
   *                    vorschalten kann ohne SynthEngine-Constructor-Destination
   *                    zu ändern.
   */
  triggerNote(
    frequency: number,
    params: SynthParams,
    time: number,
    prevFreq?: number,
    partId?: string,
    destination?: AudioNode,
  ): GainNode {
    const ctx = this.ctx;
    const now = Math.max(time, ctx.currentTime);
    const noteEnd = now + 1.0;
    const releaseEnd = noteEnd + Math.max(0.001, params.release) + 0.1;

    // Macro-LFO-Overrides (TASK-117): wenn für diesen Part Macro-Werte
    // gesetzt wurden, klonen wir params und überschreiben lfoRate/lfoDepth.
    let effectiveParams = params;
    if (partId) {
      const cached = this._partLfoCache.get(partId);
      if (cached && (cached.rate !== undefined || cached.depth !== undefined)) {
        effectiveParams = { ...params };
        if (cached.rate !== undefined) effectiveParams.lfoRate = cached.rate;
        if (cached.depth !== undefined) {
          // Cache hält 0..1 (normalisiert), SynthParams.lfoDepth ist in Cents (0..100).
          effectiveParams.lfoDepth = cached.depth * 100;
        }
      }
    }
    params = effectiveParams;

    // ADSR-Hüllkurve
    const ampEnv = ctx.createGain();
    ampEnv.gain.setValueAtTime(0, now);
    ampEnv.gain.linearRampToValueAtTime(1, now + Math.max(0.001, params.attack));
    ampEnv.gain.linearRampToValueAtTime(
      Math.max(0, Math.min(1, params.sustain)),
      now + params.attack + Math.max(0.001, params.decay)
    );
    ampEnv.gain.setValueAtTime(params.sustain, noteEnd);
    ampEnv.gain.linearRampToValueAtTime(0, releaseEnd);

    // Oszillator-Netz erstellen
    const oscOut = params.mode === "fm"
      ? this._triggerFm(frequency, params, now, releaseEnd, prevFreq)
      : this._triggerWavetable(frequency, params, now, releaseEnd, prevFreq);

    // LFO→Filter: nur bei lfoTarget==="filter" einen Lowpass in den Voice-Pfad
    // einfügen (osc → filter → ampEnv). pitch/volume-Voices bleiben byte-identisch.
    let ampInput: AudioNode = oscOut.node;
    let filterFreqTarget: AudioParam | null = null;
    if (params.lfoEnabled && params.lfoTarget === "filter") {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(FILTER_LFO_BASE_HZ, now);
      filter.Q.value = FILTER_LFO_Q;
      oscOut.node.connect(filter);
      ampInput = filter;
      filterFreqTarget = filter.frequency;
    }

    // LFO
    if (params.lfoEnabled) {
      this._attachLfo(params, now, releaseEnd, ampEnv, oscOut.detuneTarget ?? null, filterFreqTarget);
    }

    ampInput.connect(ampEnv);
    ampEnv.connect(destination ?? this.destination);
    return ampEnv;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _triggerWavetable(
    frequency: number,
    params: SynthParams,
    time: number,
    stopTime: number,
    prevFreq?: number,
  ): { node: AudioNode; detuneTarget: AudioParam | null } {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = params.oscType === "custom" ? "sine" : (params.oscType as OscillatorType);
    osc.detune.value = Math.max(-100, Math.min(100, params.detune));

    // Glide
    if (params.glide > 0 && prevFreq && prevFreq !== frequency) {
      osc.frequency.setValueAtTime(prevFreq, time);
      osc.frequency.linearRampToValueAtTime(frequency, time + params.glide);
    } else {
      osc.frequency.setValueAtTime(frequency, time);
    }

    osc.start(time);
    osc.stop(stopTime);
    return { node: osc, detuneTarget: osc.detune };
  }

  private _triggerFm(
    frequency: number,
    params: SynthParams,
    time: number,
    stopTime: number,
    prevFreq?: number,
  ): { node: AudioNode; detuneTarget: AudioParam | null } {
    const ctx = this.ctx;
    const carrier = ctx.createOscillator();
    carrier.type = "sine";

    if (params.glide > 0 && prevFreq && prevFreq !== frequency) {
      carrier.frequency.setValueAtTime(prevFreq, time);
      carrier.frequency.linearRampToValueAtTime(frequency, time + params.glide);
    } else {
      carrier.frequency.setValueAtTime(frequency, time);
    }

    const modulator = ctx.createOscillator();
    modulator.frequency.value = frequency * Math.max(0.1, params.fmRatio);
    modulator.type = "sine";
    const modDepth = ctx.createGain();
    modDepth.gain.value = Math.max(0, params.fmDepth);
    modulator.connect(modDepth);
    modDepth.connect(carrier.frequency);

    modulator.start(time);
    carrier.start(time);
    modulator.stop(stopTime);
    carrier.stop(stopTime);
    return { node: carrier, detuneTarget: carrier.detune };
  }

  private _attachLfo(
    params: SynthParams,
    startTime: number,
    stopTime: number,
    ampEnv: GainNode,
    detuneTarget: AudioParam | null,
    filterFreqTarget: AudioParam | null = null,
  ) {
    const ctx = this.ctx;

    // Rate berechnen
    const rate = params.lfoBpmSync !== "free"
      ? lfoRateFromBpm(this._bpm, params.lfoBpmSync)
      : Math.max(0.1, params.lfoRate);

    if (params.lfoWaveform === "random" || params.lfoWaveform === "sh") {
      // Sample & Hold / Random: regelmäßige zufällige Gain-Sprünge via setValueAtTime
      this._attachRandomLfo(params, rate, startTime, stopTime, ampEnv, detuneTarget, filterFreqTarget);
      return;
    }

    // Standardmäßige Wellenform-LFO via OscillatorNode
    const lfo = ctx.createOscillator();
    // "random" und "sh" sind oben schon abgefangen; hier nur Standardwellenformen
    const oscType = (["sine","square","sawtooth","triangle"] as const).includes(params.lfoWaveform as "sine")
      ? params.lfoWaveform as OscillatorType
      : "sine";
    lfo.type = oscType;
    lfo.frequency.value = rate;

    const lfoGain = ctx.createGain();
    // Filter-Target braucht einen Hz-Hub, nicht den Cents/Gain-Wert von lfoDepth.
    lfoGain.gain.value = params.lfoTarget === "filter"
      ? (params.lfoDepth / 100) * FILTER_LFO_RANGE_HZ
      : Math.max(0, params.lfoDepth);
    lfo.connect(lfoGain);

    if (params.lfoTarget === "pitch" && detuneTarget) {
      lfoGain.connect(detuneTarget);
    } else if (params.lfoTarget === "volume") {
      lfoGain.connect(ampEnv.gain);
    } else if (params.lfoTarget === "filter" && filterFreqTarget) {
      lfoGain.connect(filterFreqTarget);
    }

    lfo.start(startTime);
    lfo.stop(stopTime);
  }

  private _attachRandomLfo(
    params: SynthParams,
    rate: number,
    startTime: number,
    stopTime: number,
    ampEnv: GainNode,
    detuneTarget: AudioParam | null,
    filterFreqTarget: AudioParam | null = null,
  ) {
    const ctx = this.ctx;
    const intervalSec = 1 / Math.max(0.5, rate);

    // Filter-Target: absolute Cutoff-Sprünge um den Basis-Cutoff (Hz-Hub).
    if (params.lfoTarget === "filter" && filterFreqTarget) {
      const depthHz = (params.lfoDepth / 100) * FILTER_LFO_RANGE_HZ;
      let t = startTime;
      while (t < stopTime) {
        const value = Math.max(20, FILTER_LFO_BASE_HZ + (Math.random() * 2 - 1) * depthHz);
        filterFreqTarget.setValueAtTime(value, t);
        t += intervalSec;
      }
      return;
    }

    const depth = Math.max(0, params.lfoDepth);
    const target = params.lfoTarget === "volume"
      ? ampEnv.gain
      : detuneTarget;

    if (!target) return;

    let t = startTime;
    while (t < stopTime) {
      const value = (Math.random() * 2 - 1) * depth;
      target.setValueAtTime(value, t);
      t += intervalSec;
    }
  }
}
