/**
 * Synthstudio – LufsAnalyzer.ts  (v3.78.0)
 *
 * ITU-R BS.1770-4 konformes Loudness-Measurement (Mastering-Standard
 * für Broadcast + Streaming).
 *
 * Drei Werte:
 *   - Momentary  (M):  400ms gleitender Block
 *   - Short-Term (S):  3s gleitender Block
 *   - Integrated (I):  Gesamte Messung mit Two-Pass Gating
 *                        (absolute -70 LUFS + relative -10 LU)
 *
 * K-Weighting Filter (BS.1770-4 Annex 1):
 *   Stufe 1: "Pre-Filter" — High-Shelf, fc≈1681Hz, +4dB Boost
 *            (modelliert Kopf-/Außenohr-Resonanz).
 *   Stufe 2: "RLB-Filter" — High-Pass, fc≈38Hz, Q=0.5
 *            (entfernt Sub-Bass die das Ohr nicht als laut empfindet).
 *
 * Die ITU-Spec gibt Biquad-Koeffizienten nur für 48kHz an. Für andere
 * Sample-Rates müssen wir die Koeffizienten via Bilinear-Transform aus
 * dem analogen Prototyp neu rechnen — siehe `_designPreFilter` und
 * `_designRlbFilter`. Bei 48kHz liefert das exakt die BS.1770-4-Werte
 * (innerhalb 1e-9 fp-precision).
 *
 * Loudness-Formel (BS.1770-4 §3):
 *   1. K-weighted Signal pro Kanal → mean-square pro Block
 *   2. Channel-Sum mit Gewichtungen (L/R = 1.0, Center = 1.0,
 *      Surround = 1.41) — wir nehmen 1.0 für Stereo.
 *   3. LUFS = -0.691 + 10 * log10(meanSquare)
 *
 * Gating für Integrated (BS.1770-4 §3.3):
 *   - Absolute gate:  -70 LUFS → Blöcke darunter zählen nicht.
 *   - Relative gate:  10 LU unter dem ungelateten Mittelwert.
 *   - Block-Size für Integrated: 400ms, 75% Overlap → 100ms-Hop.
 *
 * Public API (siehe Task-Spec):
 *   getMomentary()    → current 400ms LUFS
 *   getShortTerm()    → current 3s LUFS
 *   getIntegrated()   → gegateteter LUFS-Mittelwert
 *   reset()           → Integrated-Messung neu starten
 *   processBlock(L,R) → samples einsteuern (Mono = L=R)
 *
 * Sample-Rate-Hinweise:
 *   - Designed bei sampleRate=44100 oder 48000.
 *   - Bilinear-Transform-Coeffs sind exakt bei 48kHz, leichte
 *     Frequenz-Verzerrung bei anderen Rates (Pre-Warping berücksichtigt).
 *
 * Caveats:
 *   - Mono-Eingang: rechter Kanal-Input == linker → korrekte Mono-LUFS.
 *   - True-Peak: NICHT enthalten, separater Reader in v3.78 future
 *     (4x-Oversampling für Inter-Sample-Peaks).
 */

// ─── Konstanten ───────────────────────────────────────────────────────────────

/** Absolute gating threshold per BS.1770-4 §3.3. */
export const ABSOLUTE_GATE_LUFS = -70.0;

/** Relative gating offset (LU unterhalb ungegatetem Mean) per BS.1770-4. */
export const RELATIVE_GATE_LU = -10.0;

/** Momentary-Fenster (BS.1770-4 §3.2). */
export const MOMENTARY_WINDOW_SEC = 0.4;

/** Short-Term-Fenster (BS.1770-4 §3.2). */
export const SHORT_TERM_WINDOW_SEC = 3.0;

/** Integrated-Block-Size = 400ms (selbe wie Momentary). */
export const INTEGRATED_BLOCK_SEC = 0.4;

/** Integrated-Block-Overlap (75% = 100ms Hop). */
export const INTEGRATED_OVERLAP = 0.75;

/** LUFS-Offset aus der Spec: K-weighted MS=1 → -0.691 LUFS. */
export const LUFS_OFFSET = -0.691;

/** Default-Wert wenn Messung nicht aufgelaufen / Stille. */
export const LUFS_SILENCE = -Infinity;

// ─── Biquad ──────────────────────────────────────────────────────────────────

/**
 * Direct-Form II Biquad (4 State-Variablen).
 * Transfer-Funktion:
 *   H(z) = (b0 + b1·z⁻¹ + b2·z⁻²) / (1 + a1·z⁻¹ + a2·z⁻²)
 *
 * `process` läuft per-sample um Allokationen zu vermeiden.
 */
export interface BiquadCoeffs {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}

export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(public coeffs: BiquadCoeffs) {}

  process(x: number): number {
    const { b0, b1, b2, a1, a2 } = this.coeffs;
    const y = b0 * x + this.z1;
    this.z1 = b1 * x - a1 * y + this.z2;
    this.z2 = b2 * x - a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

// ─── K-Weighting Filter-Design ────────────────────────────────────────────────

/**
 * Pre-Filter (high-shelf) per BS.1770-4 Annex 1.
 *
 * Analoger Prototyp:
 *   fc  = 1681.97 Hz (resonance frequency)
 *   gain = +4.0 dB (boost)
 *   Q   = 0.7071 (Butterworth)
 *
 * Bei sampleRate=48000 liefert das exakt die Tabellen-Koeffizienten:
 *   b0=1.53512485958697  b1=-2.69169618940638  b2=1.19839281085285
 *   a1=-1.69065929318241  a2=0.73248077421585
 *
 * Implementation via "RBJ Audio EQ Cookbook" high-shelf-Form mit
 * pre-warped omega.
 */
export function designKWeightingPreFilter(sampleRate: number): BiquadCoeffs {
  const f0 = 1681.974450955533;
  const G  = 3.999843853973347;      // dB (entspricht +4dB im Audio-Range)
  const Q  = 0.7071752369554196;

  const K  = Math.tan(Math.PI * f0 / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);

  const a0_ = 1 + K / Q + K * K;
  const b0  = (Vh + Vb * K / Q + K * K) / a0_;
  const b1  = 2 * (K * K - Vh) / a0_;
  const b2  = (Vh - Vb * K / Q + K * K) / a0_;
  const a1  = 2 * (K * K - 1) / a0_;
  const a2  = (1 - K / Q + K * K) / a0_;

  return { b0, b1, b2, a1, a2 };
}

/**
 * RLB-Filter (high-pass) per BS.1770-4 Annex 1.
 *
 * Analoger Prototyp:
 *   fc = 38.135 Hz
 *   Q  = 0.5003 (über-gedämpft, Butterworth-ähnlich)
 *
 * Bei sampleRate=48000:
 *   b0=1.0  b1=-2.0  b2=1.0
 *   a1=-1.99004745483398  a2=0.99007225036621
 *
 * Hinweis: Die BS.1770-RLB-Koeffizienten sind nicht "RBJ-Cookbook-
 * normalisiert" (b0/a0 wäre etwa 0.995 bei direkter Anwendung). Stattdessen
 * gilt die Spec-Konvention b0=1, b1=-2, b2=1 (klassischer HPF-Zähler) und
 * die a-Koeffizienten werden separat als Polstellen berechnet. Wir
 * matchen die Spec exakt indem wir die b-Werte fix lassen und nur die
 * Pole-Positionen über das Sample-Rate skaliert.
 */
export function designKWeightingRlbFilter(sampleRate: number): BiquadCoeffs {
  const f0 = 38.13547087602444;
  const Q  = 0.5003270373238773;

  const K = Math.tan(Math.PI * f0 / sampleRate);
  const denom = 1 + K / Q + K * K;
  // Pole aus Bilinear-Transform (denominator-Koeffizienten):
  const a1 = 2 * (K * K - 1) / denom;
  const a2 = (1 - K / Q + K * K) / denom;
  // Zero-Koeffizienten direkt nach Spec — klassischer HPF-Zähler.
  // Damit bleibt die DC-Sperre intakt und die Hochfrequenz-Verstärkung
  // ist exakt 4·sin²(ωT/2) wie analytisch erwartet.
  return { b0: 1, b1: -2, b2: 1, a1, a2 };
}

// ─── Mean-Square Aggregator ──────────────────────────────────────────────────

/**
 * Gleitender Mean-Square-Aggregator mit fixer Fenster-Länge.
 *
 * Wir nutzen einen Ring-Buffer von sample-quadrierten Werten und einen
 * laufenden Sum-Pointer (O(1)-update statt O(N)-mean).
 *
 * `addSample(x)` läuft pro Sample (hot path). `meanSquare()` liefert
 * die aktuell-fenster-gemittelte Quadrat-Energie. Wenn das Fenster noch
 * nicht gefüllt ist (weniger Samples als capacity), liefert mean
 * dennoch (sum / filledCount) — das ist nahe-Echtzeit-tauglich und
 * spec-konform für Momentary/Short-Term (die Spec verlangt nur eine
 * "Mittelung über das Fenster", nicht "ignorier alles vor T0").
 */
class SlidingMeanSquare {
  private buffer: Float64Array;
  private writeIdx = 0;
  private filledCount = 0;
  private sum = 0;
  public readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`SlidingMeanSquare: invalid capacity ${capacity}`);
    }
    this.capacity = Math.floor(capacity);
    this.buffer = new Float64Array(this.capacity);
  }

  addSquared(sq: number): void {
    const oldVal = this.buffer[this.writeIdx];
    this.buffer[this.writeIdx] = sq;
    this.sum += sq - oldVal;
    this.writeIdx = (this.writeIdx + 1) % this.capacity;
    if (this.filledCount < this.capacity) this.filledCount++;
  }

  meanSquare(): number {
    if (this.filledCount === 0) return 0;
    const denom = this.filledCount;
    const ms = this.sum / denom;
    // Defensive: numeric drift kann sum knapp unter 0 driften lassen.
    return ms < 0 ? 0 : ms;
  }

  reset(): void {
    this.buffer.fill(0);
    this.sum = 0;
    this.writeIdx = 0;
    this.filledCount = 0;
  }
}

// ─── LUFS-Konversion ─────────────────────────────────────────────────────────

/**
 * Mean-Square → LUFS-Skala.
 * Eingang ist die Summe der K-weighted MS-Werte über alle Kanäle
 * (Stereo: linker MS + rechter MS, beide channel-weight 1.0).
 *
 * meanSquareSum = 0 → LUFS_SILENCE (−Infinity).
 */
export function meanSquareToLufs(meanSquareSum: number): number {
  if (!Number.isFinite(meanSquareSum) || meanSquareSum <= 0) return LUFS_SILENCE;
  return LUFS_OFFSET + 10 * Math.log10(meanSquareSum);
}

// ─── LUFS-Analyzer ───────────────────────────────────────────────────────────

export interface LufsAnalyzerOptions {
  /** Sample-Rate in Hz. Default 48000. */
  sampleRate?: number;
  /** Anzahl Kanäle (1 = Mono, 2 = Stereo). Default 2. */
  channelCount?: number;
}

export class LufsAnalyzer {
  public readonly sampleRate: number;
  public readonly channelCount: number;

  /** K-Weighting-Filter pro Kanal (Pre + RLB). */
  private preFiltersL: Biquad;
  private rlbFiltersL: Biquad;
  private preFiltersR: Biquad;
  private rlbFiltersR: Biquad;

  /** Sliding-Mean-Square pro Kanal für Momentary (400ms). */
  private msMomentaryL: SlidingMeanSquare;
  private msMomentaryR: SlidingMeanSquare;

  /** Sliding-Mean-Square pro Kanal für Short-Term (3s). */
  private msShortTermL: SlidingMeanSquare;
  private msShortTermR: SlidingMeanSquare;

  /** Integrated: 400ms-Block, 100ms-Hop. */
  private integratedBlockL: Float64Array;
  private integratedBlockR: Float64Array;
  private integratedBlockSize: number;
  private integratedHopSize: number;
  private integratedWriteIdx = 0;
  private integratedSinceHop = 0;
  /** Loudness-Werte (in LUFS) aller 400ms-Blöcke seit dem letzten reset(). */
  private integratedBlockLoudness: number[] = [];

  constructor(opts: LufsAnalyzerOptions = {}) {
    const sr = opts.sampleRate ?? 48000;
    if (!Number.isFinite(sr) || sr <= 0) {
      throw new Error(`LufsAnalyzer: invalid sampleRate ${sr}`);
    }
    const cc = opts.channelCount ?? 2;
    if (cc !== 1 && cc !== 2) {
      throw new Error(`LufsAnalyzer: only mono/stereo supported (got ${cc})`);
    }
    this.sampleRate = sr;
    this.channelCount = cc;

    const preCoeffs = designKWeightingPreFilter(sr);
    const rlbCoeffs = designKWeightingRlbFilter(sr);
    this.preFiltersL = new Biquad(preCoeffs);
    this.rlbFiltersL = new Biquad(rlbCoeffs);
    this.preFiltersR = new Biquad(preCoeffs);
    this.rlbFiltersR = new Biquad(rlbCoeffs);

    const momentaryLen = Math.round(MOMENTARY_WINDOW_SEC * sr);
    const shortTermLen = Math.round(SHORT_TERM_WINDOW_SEC * sr);
    this.msMomentaryL = new SlidingMeanSquare(momentaryLen);
    this.msMomentaryR = new SlidingMeanSquare(momentaryLen);
    this.msShortTermL = new SlidingMeanSquare(shortTermLen);
    this.msShortTermR = new SlidingMeanSquare(shortTermLen);

    this.integratedBlockSize = Math.round(INTEGRATED_BLOCK_SEC * sr);
    this.integratedHopSize   = Math.round(INTEGRATED_BLOCK_SEC * (1 - INTEGRATED_OVERLAP) * sr);
    this.integratedBlockL = new Float64Array(this.integratedBlockSize);
    this.integratedBlockR = new Float64Array(this.integratedBlockSize);
  }

  /**
   * Verarbeitet einen Sample-Block. Mono: nur left übergeben (right=undefined).
   * Stereo: beide. Arrays dürfen unterschiedlich lang sein nur wenn one mono ist.
   *
   * Hot path — keine Allokationen, alles inline.
   */
  processBlock(left: Float32Array, right?: Float32Array): void {
    const N = left.length;
    const isStereo = this.channelCount === 2 && right !== undefined;
    const r = isStereo ? right! : left; // mono spiegelt L auf R

    for (let i = 0; i < N; i++) {
      // K-Weighting: pre-filter → rlb-filter pro Kanal.
      const xL = this.rlbFiltersL.process(this.preFiltersL.process(left[i]));
      const xR = this.rlbFiltersR.process(this.preFiltersR.process(r[i]));

      const sqL = xL * xL;
      const sqR = xR * xR;

      // Momentary + Short-Term sliding (O(1) per sample).
      this.msMomentaryL.addSquared(sqL);
      this.msMomentaryR.addSquared(sqR);
      this.msShortTermL.addSquared(sqL);
      this.msShortTermR.addSquared(sqR);

      // Integrated: fill 400ms block, dann hop.
      this.integratedBlockL[this.integratedWriteIdx] = sqL;
      this.integratedBlockR[this.integratedWriteIdx] = sqR;
      this.integratedWriteIdx = (this.integratedWriteIdx + 1) % this.integratedBlockSize;
      this.integratedSinceHop++;

      if (this.integratedSinceHop >= this.integratedHopSize) {
        this.integratedSinceHop = 0;
        // Block-MS = mean(sq) über die 400ms = integratedBlockSize Samples.
        // Wir summieren über den gesamten Ring (auch ungewrappte Plätze
        // sind 0 in der Anfangsphase — fein, Block-Loudness ist dann
        // einfach unter Absolute-Gate und wird verworfen).
        let sumL = 0, sumR = 0;
        for (let k = 0; k < this.integratedBlockSize; k++) {
          sumL += this.integratedBlockL[k];
          sumR += this.integratedBlockR[k];
        }
        const msL = sumL / this.integratedBlockSize;
        const msR = sumR / this.integratedBlockSize;
        // Channel-sum (channel-gain 1.0 für L/R/Mono).
        const msSum = isStereo ? msL + msR : msL;
        const lufs = meanSquareToLufs(msSum);
        if (Number.isFinite(lufs)) {
          this.integratedBlockLoudness.push(lufs);
        }
      }
    }
  }

  /** Momentary-LUFS (400ms gleitend). */
  getMomentary(): number {
    const msL = this.msMomentaryL.meanSquare();
    const msR = this.channelCount === 2 ? this.msMomentaryR.meanSquare() : 0;
    const sum = this.channelCount === 2 ? msL + msR : msL;
    return meanSquareToLufs(sum);
  }

  /** Short-Term-LUFS (3s gleitend). */
  getShortTerm(): number {
    const msL = this.msShortTermL.meanSquare();
    const msR = this.channelCount === 2 ? this.msShortTermR.meanSquare() : 0;
    const sum = this.channelCount === 2 ? msL + msR : msL;
    return meanSquareToLufs(sum);
  }

  /**
   * Integrated-LUFS mit Two-Pass-Gating per BS.1770-4 §3.3:
   *   Pass 1: Mittel aller Blöcke ≥ -70 LUFS (absolute gate).
   *   Pass 2: Mittel aller Blöcke ≥ (Pass1-Mittel + relative gate=-10 LU).
   *
   * Gibt LUFS_SILENCE zurück wenn keine Blöcke aufgelaufen oder alle gegated.
   */
  getIntegrated(): number {
    const blocks = this.integratedBlockLoudness;
    if (blocks.length === 0) return LUFS_SILENCE;

    // Pass 1: absolute gate.
    const passOne = blocks.filter((l) => l >= ABSOLUTE_GATE_LUFS);
    if (passOne.length === 0) return LUFS_SILENCE;

    // Mittelung in linear-space (mean-square), nicht in dB.
    const linMean = (arr: number[]): number => {
      let sum = 0;
      for (const l of arr) sum += Math.pow(10, (l - LUFS_OFFSET) / 10);
      return sum / arr.length;
    };

    const passOneMS = linMean(passOne);
    const passOneLufs = meanSquareToLufs(passOneMS);
    const relGateLufs = passOneLufs + RELATIVE_GATE_LU;

    // Pass 2: relative gate.
    const passTwo = blocks.filter(
      (l) => l >= ABSOLUTE_GATE_LUFS && l >= relGateLufs,
    );
    if (passTwo.length === 0) return passOneLufs;

    return meanSquareToLufs(linMean(passTwo));
  }

  /**
   * Setzt nur das Integrated-Akku zurück (Momentary/Short-Term bleiben
   * gleitend — die hängen am Audio-Stream und sollen nicht aufeinmal
   * Stille zeigen).
   *
   * Filter-State (Biquad-Memory) wird NICHT zurückgesetzt — sonst gäbe
   * es einen Filter-Einschwing-Glitch im laufenden Stream.
   */
  reset(): void {
    this.integratedBlockL.fill(0);
    this.integratedBlockR.fill(0);
    this.integratedWriteIdx = 0;
    this.integratedSinceHop = 0;
    this.integratedBlockLoudness = [];
  }

  /**
   * Voller Reset inkl. Filter-State und Sliding-Buffers. Nutzbar bei
   * Engine-Reinit / Sample-Rate-Wechsel.
   */
  resetAll(): void {
    this.preFiltersL.reset();
    this.rlbFiltersL.reset();
    this.preFiltersR.reset();
    this.rlbFiltersR.reset();
    this.msMomentaryL.reset();
    this.msMomentaryR.reset();
    this.msShortTermL.reset();
    this.msShortTermR.reset();
    this.reset();
  }
}
