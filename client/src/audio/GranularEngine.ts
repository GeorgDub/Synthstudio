/**
 * Synthstudio – GranularEngine
 *
 * Echtzeit-Granular-Synthesizer basierend auf Web Audio API.
 * Streut kurze Körner (Grains) über einen Sample-Buffer und erzeugt
 * so Clouds, Pads und Texturen aus beliebigem Audiomaterial.
 *
 * Algorithmus:
 *  - Lookahead-Scheduling: Grains werden 100ms im Voraus geplant (sample-accurate)
 *  - Hanning-Fenster-Envelope pro Grain (Attack/Release = 15% der Grain-Dauer)
 *  - Zufällige Positionsstreuung (spray), Panorama-Streuung, Pitch per playbackRate
 */

export interface GranularParams {
  /** Position im Buffer 0–1 (Mittelpunkt der Streuung) */
  position: number;
  /** Streuung um position in Sekunden (0 = deterministisch, 1 = voller Buffer) */
  spray: number;
  /** Grain-Länge in Millisekunden (10–500) */
  grainSize: number;
  /** Grains pro Sekunde (1–50) */
  density: number;
  /** Pitch-Versatz in Halbtönen (-24..+24) */
  pitch: number;
  /** Lautstärke 0–1 */
  amplitude: number;
  /** Panorama-Streuung 0–1 (0 = mono, 1 = volle Breite) */
  panSpread: number;
  /** Zufällige Pitch-Streuung in Cents (0–200) */
  pitchSpray: number;
}

export const DEFAULT_GRANULAR_PARAMS: GranularParams = {
  position:  0.0,
  spray:     0.2,
  grainSize: 80,
  density:   12,
  pitch:     0,
  amplitude: 0.7,
  panSpread: 0.4,
  pitchSpray: 0,
};

export class GranularEngine {
  private readonly _ctx: AudioContext;
  private _buffer: AudioBuffer | null = null;
  private _output: AudioNode | null = null;
  private _active = false;
  private _params: GranularParams = { ...DEFAULT_GRANULAR_PARAMS };
  private _nextGrainTime = 0;
  private _rafId: number | null = null;

  constructor(ctx: AudioContext) {
    this._ctx = ctx;
  }

  /** Setzt den Sample-Buffer der als Granular-Quelle dient. */
  setBuffer(buffer: AudioBuffer): void {
    this._buffer = buffer;
  }

  /** Startet die Grain-Wolke und verbindet sie mit dem output-Node. */
  start(params: GranularParams, output: AudioNode): void {
    if (!this._buffer) return;
    this._active = true;
    this._params = { ...params };
    this._output = output;
    this._nextGrainTime = this._ctx.currentTime;
    this._scheduleLoop();
  }

  /** Aktualisiert Parameter während der Wiedergabe (keine Unterbrechung). */
  updateParams(params: Partial<GranularParams>): void {
    this._params = { ...this._params, ...params };
  }

  /** Stoppt die Grain-Wolke. */
  stop(): void {
    this._active = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  get isActive(): boolean { return this._active; }

  // ─── Privat ──────────────────────────────────────────────────────────────────

  private _scheduleLoop(): void {
    if (!this._active) return;

    const now = this._ctx.currentTime;
    const LOOKAHEAD = 0.1; // 100ms vorausplanen
    const intervalSec = 1 / Math.max(0.5, this._params.density);

    while (this._nextGrainTime < now + LOOKAHEAD) {
      if (this._buffer && this._output) {
        this._spawnGrain(this._params, this._nextGrainTime);
      }
      this._nextGrainTime += intervalSec;
    }

    this._rafId = requestAnimationFrame(() => this._scheduleLoop());
  }

  private _spawnGrain(p: GranularParams, startTime: number): void {
    const buf = this._buffer!;
    const out = this._output!;

    const durSec = Math.max(0.005, p.grainSize / 1000);

    // Position im Buffer (zufällige Streuung um Mittelpunkt)
    const centerSec = p.position * buf.duration;
    const sprayRangeSec = p.spray * buf.duration * 0.5;
    const offsetSec = Math.max(
      0,
      Math.min(buf.duration - durSec, centerSec + (Math.random() * 2 - 1) * sprayRangeSec)
    );

    // Pitch = Halbtöne + zufällige Cents-Streuung
    const centsOffset = (Math.random() * 2 - 1) * p.pitchSpray;
    const playbackRate = Math.pow(2, (p.pitch * 100 + centsOffset) / 1200);

    // Source
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;

    // Hanning-Fenster (15% attack/release)
    const env = this._ctx.createGain();
    const rampSec = Math.min(durSec * 0.15, 0.02);
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(p.amplitude, startTime + rampSec);
    env.gain.setValueAtTime(p.amplitude, startTime + durSec - rampSec);
    env.gain.linearRampToValueAtTime(0, startTime + durSec);

    // Panorama-Streuung
    const panner = this._ctx.createStereoPanner();
    panner.pan.value = (Math.random() * 2 - 1) * p.panSpread;

    src.connect(env);
    env.connect(panner);
    panner.connect(out);

    src.start(startTime, offsetSec, durSec);
    // Cleanup: Source nach Grain-Ende freigeben
    src.addEventListener("ended", () => {
      try { src.disconnect(); env.disconnect(); panner.disconnect(); } catch { /* ignore */ }
    }, { once: true });
  }
}
