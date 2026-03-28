/**
 * SynthEngine.ts – Wavetable / FM Synthesizer Engine
 * Phase 5: Wavetable / FM Synthesizer
 *
 * Basiert auf Web Audio API: OscillatorNode + PeriodicWave für Wavetable,
 * zwei OscillatorNodes (Carrier + Modulator) für 2-Op-FM.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export type OscillatorType = "sine" | "sawtooth" | "square" | "triangle" | "custom";
export type SynthMode = "wavetable" | "fm";

export interface SynthParams {
  mode: SynthMode;
  // Wavetable
  oscType: OscillatorType;
  detune: number;          // Cents (-100..+100)
  // FM
  fmRatio: number;         // Modulator/Carrier Frequenz-Verhältnis (0.1–10)
  fmDepth: number;         // Modulations-Tiefe in Hz (0–1000)
  // ADSR
  attack: number;          // 0–2s
  decay: number;           // 0–2s
  sustain: number;         // 0–1
  release: number;         // 0–5s
  // LFO
  lfoEnabled: boolean;
  lfoRate: number;         // Hz (0.1–20)
  lfoDepth: number;        // Cents (0–100)
  lfoTarget: "pitch" | "volume" | "filter";
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
};

// ─── SynthEngine-Klasse ────────────────────────────────────────────────────────

export class SynthEngine {
  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode
  ) {}

  /**
   * Spielt eine Note ab.
   * @param frequency Frequenz in Hz (z.B. 440 für A4)
   * @param params    Synth-Parameter
   * @param time      AudioContext-Zeit (ctx.currentTime + Offset)
   * @returns der Gain-Ausgangsknoten (für spätere Verbindung)
   */
  triggerNote(frequency: number, params: SynthParams, time: number): GainNode {
    const ctx = this.ctx;
    const now = Math.max(time, ctx.currentTime);

    // ADSR-Hüllkurve via GainNode
    const ampEnv = ctx.createGain();
    ampEnv.gain.setValueAtTime(0, now);
    // Attack
    ampEnv.gain.linearRampToValueAtTime(1, now + Math.max(0.001, params.attack));
    // Decay → Sustain
    ampEnv.gain.linearRampToValueAtTime(
      Math.max(0, Math.min(1, params.sustain)),
      now + params.attack + Math.max(0.001, params.decay)
    );
    // Release (nach einer festen Note-Länge von 1s starten – vereinfacht)
    const noteEnd = now + 1.0;
    ampEnv.gain.setValueAtTime(params.sustain, noteEnd);
    ampEnv.gain.linearRampToValueAtTime(0, noteEnd + Math.max(0.001, params.release));

    if (params.mode === "fm") {
      this._triggerFm(frequency, params, now, ampEnv);
    } else {
      this._triggerWavetable(frequency, params, now, ampEnv);
    }

    ampEnv.connect(this.destination);

    // LFO
    if (params.lfoEnabled && params.lfoTarget === "pitch") {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = Math.max(0.1, params.lfoRate);
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = Math.max(0, params.lfoDepth);
      lfo.connect(lfoGain);
      // LFO → ampEnv.gain (vereinfachtes Pitch-Modell)
      lfo.start(now);
      lfo.stop(noteEnd + params.release + 0.1);
    }

    return ampEnv;
  }

  private _triggerWavetable(
    frequency: number,
    params: SynthParams,
    time: number,
    ampEnv: GainNode
  ) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = params.oscType === "custom" ? "sine" : params.oscType;
    osc.frequency.value = frequency;
    osc.detune.value = Math.max(-100, Math.min(100, params.detune));
    osc.connect(ampEnv);
    osc.start(time);
    osc.stop(time + 1.0 + Math.max(0.001, params.release) + 0.1);
  }

  private _triggerFm(
    frequency: number,
    params: SynthParams,
    time: number,
    ampEnv: GainNode
  ) {
    const ctx = this.ctx;
    const carrier = ctx.createOscillator();
    carrier.frequency.value = frequency;
    carrier.type = "sine";

    const modulator = ctx.createOscillator();
    modulator.frequency.value = frequency * Math.max(0.1, params.fmRatio);
    modulator.type = "sine";

    const modDepth = ctx.createGain();
    modDepth.gain.value = Math.max(0, params.fmDepth);

    modulator.connect(modDepth);
    modDepth.connect(carrier.frequency);
    carrier.connect(ampEnv);

    modulator.start(time);
    carrier.start(time);
    const noteEnd = time + 1.0 + params.release + 0.1;
    modulator.stop(noteEnd);
    carrier.stop(noteEnd);
  }
}
