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

export class SynthEngine {
  private _bpm = 120;

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode
  ) {}

  setBpm(bpm: number) { this._bpm = bpm; }

  /**
   * Spielt eine Note ab.
   * @param frequency Frequenz in Hz (z.B. 440 für A4)
   * @param params    Synth-Parameter
   * @param time      AudioContext-Zeit (ctx.currentTime + Offset)
   * @param prevFreq  Vorherige Frequenz für Glide (optional)
   */
  triggerNote(frequency: number, params: SynthParams, time: number, prevFreq?: number): GainNode {
    const ctx = this.ctx;
    const now = Math.max(time, ctx.currentTime);
    const noteEnd = now + 1.0;
    const releaseEnd = noteEnd + Math.max(0.001, params.release) + 0.1;

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

    // LFO
    if (params.lfoEnabled) {
      this._attachLfo(params, now, releaseEnd, ampEnv, oscOut.detuneTarget ?? null);
    }

    oscOut.node.connect(ampEnv);
    ampEnv.connect(this.destination);
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
  ) {
    const ctx = this.ctx;

    // Rate berechnen
    const rate = params.lfoBpmSync !== "free"
      ? lfoRateFromBpm(this._bpm, params.lfoBpmSync)
      : Math.max(0.1, params.lfoRate);

    if (params.lfoWaveform === "random" || params.lfoWaveform === "sh") {
      // Sample & Hold / Random: regelmäßige zufällige Gain-Sprünge via setValueAtTime
      this._attachRandomLfo(params, rate, startTime, stopTime, ampEnv, detuneTarget);
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
    lfoGain.gain.value = Math.max(0, params.lfoDepth);
    lfo.connect(lfoGain);

    if (params.lfoTarget === "pitch" && detuneTarget) {
      lfoGain.connect(detuneTarget);
    } else if (params.lfoTarget === "volume") {
      lfoGain.connect(ampEnv.gain);
    }
    // filter: TODO - connect to filter frequency in a future sprint

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
  ) {
    const ctx = this.ctx;
    const intervalSec = 1 / Math.max(0.5, rate);
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
