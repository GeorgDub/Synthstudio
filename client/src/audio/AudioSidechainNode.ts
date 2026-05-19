/**
 * Synthstudio – AudioSidechainNode (v3.119.0)
 *
 * DAW-grade audio-triggered Sidechain: peak-detect auf source-AudioNode →
 * dynamische Gain-Reduktion auf target-GainNode mit klassischer
 * Compressor-Hüllkurve (threshold / ratio / attack / release).
 *
 * Architektur:
 *   sourceNode ─► AnalyserNode (timeDomain) ─┐
 *                                            ▼
 *                              detectPeak → applyEnvelope
 *                                            │
 *                                            ▼  (linearRampToValueAtTime)
 *                                       targetGainNode.gain
 *
 * Der eigentliche Audio-Pfad wird NICHT verändert — wir tappen den source
 * (parallel zur Wiedergabe) und modulieren target.gain. Keine Latenz im
 * Wet-Pfad, kein dropped sample im Source-Signal.
 *
 * Pure-Helpers (detectPeak/applyEnvelope/dbToGain/gainToDb) sind side-
 * effect-frei und liegen am Datei-Ende — testbar ohne AudioContext.
 */

// ─── Pure Helpers ────────────────────────────────────────────────────────────

const MIN_DB = -60;
const TINY_GAIN = 1e-6; // unterhalb dessen treat as silence

/**
 * Konvertiert Linear-Gain → dB. Kappt bei MIN_DB (-60 dB).
 * gainToDb(0) → -60, gainToDb(1) → 0, gainToDb(0.5) ≈ -6.02.
 */
export function gainToDb(gain: number): number {
  if (!Number.isFinite(gain) || gain <= TINY_GAIN) return MIN_DB;
  return Math.max(MIN_DB, 20 * Math.log10(gain));
}

/**
 * dB → Linear-Gain. dbToGain(0) === 1, dbToGain(-6) ≈ 0.501,
 * dbToGain(-Infinity) → 0.
 */
export function dbToGain(db: number): number {
  if (!Number.isFinite(db)) return db === -Infinity ? 0 : 1;
  return Math.pow(10, db / 20);
}

/**
 * Maximum absolute sample value über einen Time-Domain-Buffer.
 * Werte aus AnalyserNode.getFloatTimeDomainData kommen in -1..+1.
 */
export function detectPeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    const abs = v < 0 ? -v : v;
    if (abs > peak) peak = abs;
  }
  return peak;
}

/**
 * Compressor-Envelope-Step. Returnt die neue smoothed gain-reduction in dB.
 *
 * Algorithm:
 *   inputDb        = max(MIN_DB, gainToDb(peak))
 *   overThreshold  = max(0, inputDb - threshold)
 *   reductionRaw   = overThreshold × (1 - 1/ratio)
 *   coef           = 1 - exp(-dtMs / timeMs)         ← per-frame approximation
 *   reductionSmooth = prevReductionDb + (target - prev) × coef
 *
 * @param peak Aktuelles Peak-Sample-Magnitude (0..~1+)
 * @param threshold In dB (z.B. -18). Reduction kickt erst ein wenn peak > threshold.
 * @param ratio Kompressions-Ratio (1..20). 1 = no compression.
 * @param attackMs Attack-Zeit in ms (Wenn reduction wächst).
 * @param releaseMs Release-Zeit in ms (Wenn reduction fällt).
 * @param prevReductionDb Vorheriger smoothed reduction-Wert in dB (≥ 0).
 * @param dtMs Vergangene Zeit seit letztem Tick in ms.
 * @returns Neue reduction in dB (≥ 0). 0 = keine Reduktion, 12 = -12 dB Gain.
 */
export function applyEnvelope(
  peak: number,
  threshold: number,
  ratio: number,
  attackMs: number,
  releaseMs: number,
  prevReductionDb: number,
  dtMs: number,
): number {
  const inputDb = gainToDb(peak);
  const overThreshold = Math.max(0, inputDb - threshold);
  const safeRatio = Math.max(1, ratio);
  const reductionRaw = overThreshold * (1 - 1 / safeRatio);

  const isRising = reductionRaw > prevReductionDb;
  const timeMs = Math.max(0.1, isRising ? attackMs : releaseMs);
  // Per-frame exponential approach. coef = 1 - exp(-dt/τ).
  const safeDt = Math.max(0, dtMs);
  const coef = 1 - Math.exp(-safeDt / timeMs);
  const clampedCoef = Math.max(0, Math.min(1, coef));

  const next = prevReductionDb + (reductionRaw - prevReductionDb) * clampedCoef;
  return Math.max(0, next);
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface AudioSidechainConfig {
  /** Threshold in dB (-60..0). Default -18. */
  threshold: number;
  /** Compression-Ratio (1..20). Default 4. */
  ratio: number;
  /** Attack in ms (0.1..100). Default 5. */
  attackMs: number;
  /** Release in ms (10..1000). Default 120. */
  releaseMs: number;
}

export const DEFAULT_AUDIO_SIDECHAIN_CONFIG: AudioSidechainConfig = {
  threshold: -18,
  ratio: 4,
  attackMs: 5,
  releaseMs: 120,
};

export function sanitizeAudioSidechainConfig(
  partial: Partial<AudioSidechainConfig>,
): AudioSidechainConfig {
  const cfg = { ...DEFAULT_AUDIO_SIDECHAIN_CONFIG, ...partial };
  cfg.threshold = Math.max(-60, Math.min(0, Number.isFinite(cfg.threshold) ? cfg.threshold : -18));
  cfg.ratio = Math.max(1, Math.min(20, Number.isFinite(cfg.ratio) ? cfg.ratio : 4));
  cfg.attackMs = Math.max(0.1, Math.min(100, Number.isFinite(cfg.attackMs) ? cfg.attackMs : 5));
  cfg.releaseMs = Math.max(10, Math.min(1000, Number.isFinite(cfg.releaseMs) ? cfg.releaseMs : 120));
  return cfg;
}

// ─── AudioSidechainNode-Klasse ───────────────────────────────────────────────

/**
 * Runtime-Instance einer Audio-Sidechain-Verkabelung. Wird von AudioEngine
 * gehalten — niemals direkt von UI-Code instanziiert.
 *
 * Lifecycle:
 *   new AudioSidechainNode(ctx, source, target) → enable() → … → dispose()
 *
 * Während enabled läuft eine rAF-Loop die alle ~16ms peak-detected und
 * target.gain mit linearRampToValueAtTime auf den neuen Wert rampt
 * (click-frei).
 */
export class AudioSidechainNode {
  private readonly ctx: AudioContext;
  private readonly sourceNode: AudioNode;
  private readonly targetGain: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly buffer: Float32Array<ArrayBuffer>;

  private config: AudioSidechainConfig;
  private enabled = false;
  private rafId: number | null = null;
  private prevReductionDb = 0;
  private lastTickMs = 0;

  constructor(
    ctx: AudioContext,
    sourceNode: AudioNode,
    targetGainNode: GainNode,
    config: Partial<AudioSidechainConfig> = {},
  ) {
    this.ctx = ctx;
    this.sourceNode = sourceNode;
    this.targetGain = targetGainNode;
    this.config = sanitizeAudioSidechainConfig(config);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    this.buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4)) as Float32Array<ArrayBuffer>;

    // Source-Tap: parallel anschließen, beeinflusst Original-Audio-Pfad nicht.
    try {
      this.sourceNode.connect(this.analyser);
    } catch {
      /* sourceNode might be disconnected already — fail silent */
    }
  }

  configure(partial: Partial<AudioSidechainConfig>): void {
    this.config = sanitizeAudioSidechainConfig({ ...this.config, ...partial });
  }

  getConfig(): AudioSidechainConfig {
    return { ...this.config };
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.lastTickMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
    this.prevReductionDb = 0;
    this._scheduleTick();
  }

  disable(): void {
    this.enabled = false;
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    // Reset gain → 1 (no reduction)
    try {
      const now = this.ctx.currentTime;
      this.targetGain.gain.cancelScheduledValues(now);
      this.targetGain.gain.linearRampToValueAtTime(1, now + 0.02);
    } catch {
      /* node may be disconnected */
    }
    this.prevReductionDb = 0;
  }

  /** Aktuelle Gain-Reduktion in dB (≥ 0). Für UI-Meter. */
  getCurrentReductionDb(): number {
    return this.prevReductionDb;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.disable();
    try {
      this.sourceNode.disconnect(this.analyser);
    } catch {
      /* ignore */
    }
  }

  private _scheduleTick(): void {
    if (!this.enabled) return;
    if (typeof requestAnimationFrame !== "function") return;
    this.rafId = requestAnimationFrame(() => this._tick());
  }

  private _tick(): void {
    if (!this.enabled) return;
    try {
      this.analyser.getFloatTimeDomainData(this.buffer);
    } catch {
      this._scheduleTick();
      return;
    }
    const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const dtMs = Math.max(0, nowMs - this.lastTickMs);
    this.lastTickMs = nowMs;

    const peak = detectPeak(this.buffer);
    const nextReductionDb = applyEnvelope(
      peak,
      this.config.threshold,
      this.config.ratio,
      this.config.attackMs,
      this.config.releaseMs,
      this.prevReductionDb,
      dtMs,
    );
    this.prevReductionDb = nextReductionDb;

    const targetGain = dbToGain(-nextReductionDb);
    try {
      const acNow = this.ctx.currentTime;
      this.targetGain.gain.cancelScheduledValues(acNow);
      this.targetGain.gain.linearRampToValueAtTime(
        targetGain,
        acNow + Math.max(0.005, dtMs / 1000),
      );
    } catch {
      /* target disconnected — ignore */
    }

    this._scheduleTick();
  }
}
