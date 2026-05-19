/**
 * Synthstudio – LufsAnalyzer.ts  (v3.103.0)
 *
 * ITU-R BS.1770-4 konformes Loudness-Measurement (Mastering-Standard
 * für Broadcast + Streaming).
 *
 * v3.103.0 closes v3.101+v3.102 LRA-Caveat: echtes EBU R128 LRA (Tech 3342)
 * mit Short-Term-Historie (3s-Window, 100ms-Hop → 10 Hz) + Two-Pass-Gating
 * (absolute ≥ -70 LUFS, relative ≥ integrated - 20 LU) + Percentile-Distrib
 * (LU95 - LU10). API: `getCurrentLra()`, `getShortTermHistoryLength()`,
 * `reset()` clears die History; Pure-Helpers `percentile`, `computeLra`.
 *
 * v3.102.0 ergänzt um optionalen True-Peak-Reader (BS.1770-4 Annex 2):
 * Bei `truePeakOversampling > 1` läuft parallel zum K-weighting ein
 * 4x-Polyphase-FIR über die rohen (nicht-K-weighted) Samples, der den
 * Inter-Sample-Peak in dBTP ermittelt. Per-Channel L+R getrennt.
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
 * dem analogen Prototyp neu rechnen — siehe `designKWeightingPreFilter`
 * und `designKWeightingRlbFilter`. Bei 48kHz liefert das exakt die
 * BS.1770-4-Werte (innerhalb 1e-9 fp-precision).
 *
 * Loudness-Formel (BS.1770-4 §3):
 *   1. K-weighted Signal pro Kanal → mean-square pro Block
 *      (jeder Kanal hat sein eigenes Biquad-Paar, KEIN mono-downmix vor
 *      K-weighting — Pre-Filter ist linear, aber unterschiedliche L/R-
 *      Spektren werden separat ge-weighted bevor summiert wird).
 *   2. Channel-Sum mit Gewichtungen (L/R = 1.0, Center = 1.0,
 *      Surround = 1.41) — wir nehmen 1.0 für Stereo.
 *   3. LUFS = -0.691 + 10 * log10(meanSquare)
 *
 * Gating für Integrated (BS.1770-4 §3.3):
 *   - Absolute gate:  -70 LUFS → Blöcke darunter zählen nicht.
 *   - Relative gate:  10 LU unter dem ungelateten Mittelwert.
 *   - Block-Size für Integrated: 400ms, 75% Overlap → 100ms-Hop.
 *
 * Public API:
 *   getMomentary()             → current 400ms LUFS (channel-summed)
 *   getShortTerm()             → current 3s LUFS (channel-summed)
 *   getIntegrated()            → gegateteter LUFS-Mittelwert
 *   getMomentaryStereo()       → v3.101 per-channel LUFS {L, R, sum}
 *   reset()                    → Integrated-Messung neu starten
 *   processBlock(L, R?)        → samples einsteuern (mono = L=R)
 *   analyzeStereo(L, R)        → v3.101 offline batch-Analyse
 *   analyzeFromBuffer(buf)     → v3.101 AudioBuffer-Convenience
 *
 * v3.101 Pure-Helper (Mastering-Bonus):
 *   phaseCorrelation(L, R)     → [-1, +1], Pearson-Korrelation
 *   lrImbalanceDb(L, R)        → RMS-Differenz in dB (positiv = rechts lauter)
 *
 * Sample-Rate-Hinweise:
 *   - Designed bei sampleRate=44100 oder 48000.
 *   - Bilinear-Transform-Coeffs sind exakt bei 48kHz, leichte
 *     Frequenz-Verzerrung bei anderen Rates (Pre-Warping berücksichtigt).
 *
 * Caveats:
 *   - Mono-Eingang: `processBlock(L)` ohne `R` → channelCount=2-Analyzer
 *     spiegelt L auf R intern (= equivalent zur Stereo-Eingabe mit L=R).
 *   - v3.102 closes v3.101-Caveat: True-Peak ist jetzt enthalten via
 *     `truePeakOversampling`-Option (default 4x, 0 oder 1 = disabled).
 *     Polyphase-FIR (12 Taps × 4 Phasen = 48 Taps gesamt). Per-Channel
 *     getrennt — siehe `getCurrentTruePeak()`.
 *   - v3.101 closes v3.78-Caveat: AudioEngine-Tap war pro AnalyserNode
 *     mono-downmixed. Mit ChannelSplitter + zwei AnalyserNodes geht die
 *     Engine jetzt auf channelCount=2 → echtes Stereo-K-weighting.
 */
import { TruePeakMeter } from "./TruePeakMeter";

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

// ─── v3.103.0: EBU R128 LRA-Konstanten ───────────────────────────────────────

/**
 * v3.103.0: Short-Term-History Hop-Size (Tech 3342: 100ms zwischen Samples).
 * Bei 10 Hz × 60s = 600 Einträge pro Minute.
 */
export const LRA_SHORT_TERM_HOP_SEC = 0.1;

/**
 * v3.103.0: Maximal-Anzahl Einträge im Short-Term-Ringbuffer.
 * 3600 Einträge × 100ms = 6 Minuten Mess-Historie (typische Master-Length).
 * Beyond: FIFO-Drop.
 */
export const LRA_HISTORY_MAX = 3600;

/**
 * v3.103.0: EBU R128 LRA absolute gate threshold (LUFS).
 * Identisch zu BS.1770-4 Absolute-Gate (-70 LUFS).
 */
export const LRA_ABSOLUTE_GATE_LUFS = -70.0;

/**
 * v3.103.0: EBU R128 LRA relative gate offset (LU unterhalb Integrated).
 * Tech 3342 §3: -20 LU (NICHT -10 wie BS.1770-4 Loudness-Gate!).
 */
export const LRA_RELATIVE_GATE_LU = -20.0;

/** v3.103.0: 10%-Percentile fuer LRA-Untergrenze (Tech 3342). */
export const LRA_PERCENTILE_LOW = 0.1;

/** v3.103.0: 95%-Percentile fuer LRA-Obergrenze (Tech 3342). */
export const LRA_PERCENTILE_HIGH = 0.95;

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

// ─── v3.103.0: EBU R128 LRA Pure-Helpers ─────────────────────────────────────

/**
 * v3.103.0: Linear interpolierter Percentile-Lookup nach Tech 3342.
 *
 *   rank = p × (N - 1)   (0-indexed, inclusive both ends)
 *
 * Bei rank zwischen zwei Indizes: lineare Interpolation zwischen
 * `sortedArr[floor(rank)]` und `sortedArr[ceil(rank)]`. Pre-Condition:
 * `sortedArr` MUSS bereits ascending sortiert sein (kein internes Sort —
 * Caller-Verantwortung, weil computeLra mehrere Percentile auf demselben
 * sortierten Array ausliest).
 *
 * Edge-Cases:
 *   - leeres Array → NaN (Caller-Defense erforderlich).
 *   - p outside [0,1] → clamped auf [0,1].
 *   - N=1 → einziger Wert wird zurueck-gegeben.
 *
 * Tests:
 *   percentile([10,20,30], 0)    === 10   (Linker Rand)
 *   percentile([10,20,30], 1)    === 30   (Rechter Rand)
 *   percentile([10,20,30], 0.5)  === 20   (Median)
 *   percentile([10,20,30], 0.25) === 15   (Linear-Interp zwischen 10/20)
 */
export function percentile(sortedArr: readonly number[], p: number): number {
  const N = sortedArr.length;
  if (N === 0) return NaN;
  if (N === 1) return sortedArr[0];
  const clampedP = p < 0 ? 0 : p > 1 ? 1 : p;
  const rank = clampedP * (N - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedArr[lo];
  const frac = rank - lo;
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * frac;
}

/**
 * v3.103.0: Echter EBU R128 / Tech 3342 LRA-Algorithmus.
 *
 * Verarbeitungs-Schritte:
 *   1. Absolute-Gate: Verwerfe alle ST-Werte < -70 LUFS.
 *   2. Relative-Gate: Verwerfe alle Werte < (integrated - 20 LU).
 *      → Bei nicht-endlichem Integrated (-Inf) wird der Relative-Gate
 *        ausgesetzt — keine sinnvolle Schwelle gibt es vor der ersten
 *        I-Messung.
 *   3. Sortiere die gegateten Werte ascending.
 *   4. LRA = percentile(95%) - percentile(10%).
 *
 * Edge-Cases:
 *   - Leeres `stHistory` → 0.
 *   - Alle Werte identisch → 0 (LU95 == LU10).
 *   - Alle Werte unter Absolute-Gate → 0 (keine Verteilung messbar).
 *   - Nur ein Wert nach Gating → 0 (Single-Point hat keine Spanne).
 *
 * Einheit: LU (Loudness Units). Der Wert ist die *Differenz* zweier
 * LUFS-Werte und hat keine Skala-Basis.
 *
 * @param stHistory  Liste der Short-Term-LUFS-Werte (kontinuierlich, channel-summed).
 * @param integrated Aktueller Integrated-LUFS-Wert (fuer Relative-Gate).
 *                   -Infinity → Relative-Gate uebersprungen.
 */
export function computeLra(
  stHistory: readonly number[],
  integrated: number,
): number {
  if (stHistory.length === 0) return 0;

  // Step 1+2: Gating (kombiniert in einer Filter-Pass).
  const useRelative = Number.isFinite(integrated);
  const relThreshold = useRelative
    ? integrated + LRA_RELATIVE_GATE_LU
    : -Infinity;
  const gated: number[] = [];
  for (const v of stHistory) {
    if (!Number.isFinite(v)) continue;
    if (v < LRA_ABSOLUTE_GATE_LUFS) continue;
    if (useRelative && v < relThreshold) continue;
    gated.push(v);
  }
  if (gated.length < 2) return 0;

  // Step 3: Sort ascending.
  gated.sort((a, b) => a - b);

  // Step 4: Percentile-Diff.
  const lo = percentile(gated, LRA_PERCENTILE_LOW);
  const hi = percentile(gated, LRA_PERCENTILE_HIGH);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  const lra = hi - lo;
  return lra < 0 ? 0 : lra;
}

// ─── LUFS-Analyzer ───────────────────────────────────────────────────────────

export interface LufsAnalyzerOptions {
  /** Sample-Rate in Hz. Default 48000. */
  sampleRate?: number;
  /** Anzahl Kanäle (1 = Mono, 2 = Stereo). Default 2. */
  channelCount?: number;
  /**
   * v3.102.0: Oversampling-Faktor für True-Peak-Detection (BS.1770-4
   * Annex 2). Default 4 (Spec-Minimum). 0 oder 1 = disabled (kein
   * True-Peak-FIR — `getCurrentTruePeak()` liefert dann den reinen
   * Sample-Peak des Streams).
   */
  truePeakOversampling?: number;
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

  /**
   * v3.102.0: True-Peak-Meter pro Kanal. Bei truePeakOversampling=0/1
   * sind die Meter zwar instanziiert, laufen aber im Fast-Path
   * (sample-peak). `null` wird nie geschrieben — wir entscheiden nur,
   * ob `processBlock` die Raw-Samples weiterleitet (s.u.).
   */
  private truePeakL: TruePeakMeter;
  private truePeakR: TruePeakMeter;
  /** v3.102.0: Aktiv-Flag (false = oversampling=0). */
  private truePeakEnabled: boolean;

  /** Integrated: 400ms-Block, 100ms-Hop. */
  private integratedBlockL: Float64Array;
  private integratedBlockR: Float64Array;
  private integratedBlockSize: number;
  private integratedHopSize: number;
  private integratedWriteIdx = 0;
  private integratedSinceHop = 0;
  /** Loudness-Werte (in LUFS) aller 400ms-Blöcke seit dem letzten reset(). */
  private integratedBlockLoudness: number[] = [];

  /**
   * v3.103.0: Short-Term-Historie (LUFS-Werte, channel-summed) fuer
   * EBU R128 LRA-Berechnung. Sampled bei jedem ST-Hop (100ms) — also
   * 10 Hz. Tiefer-FIFO-Bound `LRA_HISTORY_MAX` (=3600 = 6 Minuten).
   *
   * Push-Logik:
   *   - Erst nach `shortTermLen` Samples Anlauf (sonst zeigt SlidingMS
   *     pre-fill-Werte die nicht der "echte" 3s-Wert sind).
   *   - In `processBlock` pro Sample inkrementiert; alle 100ms hop
   *     (`_shortTermHopSamples`) wird der aktuelle ST-Wert gepusht.
   */
  private _shortTermHistory: number[] = [];
  private _shortTermHopSamples: number;
  private _shortTermSinceHop = 0;
  private _shortTermAnlaufSamples = 0;
  private _shortTermFullSamples: number;

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

    // v3.103.0: Short-Term-Historie fuer LRA.
    // Hop-Size = 100ms; Anlauf bis ST-Buffer voll = 3s.
    this._shortTermHopSamples  = Math.max(1, Math.round(LRA_SHORT_TERM_HOP_SEC * sr));
    this._shortTermFullSamples = Math.max(1, Math.round(SHORT_TERM_WINDOW_SEC * sr));

    // v3.102.0: True-Peak-Meter pro Kanal.
    // Defensive: NaN / negativ / non-integer fallen auf default zurueck.
    const tpRaw = opts.truePeakOversampling;
    const tp =
      tpRaw === undefined ? 4
      : !Number.isFinite(tpRaw) || tpRaw < 0 ? 0
      : Math.floor(tpRaw);
    this.truePeakEnabled = tp >= 1;
    // Bei oversampling=0 instanziieren wir trotzdem (mit 1x), damit getCurrentTruePeak
    // einen sample-peak liefert wenn der User irgendwann sample-peak haben moechte.
    const tpOs = Math.max(1, tp || 1);
    this.truePeakL = new TruePeakMeter(tpOs);
    this.truePeakR = new TruePeakMeter(tpOs);
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

    // v3.102.0: True-Peak parallel zur K-weighting. Raw-Samples (NICHT
    // K-weighted) gehen durch den Polyphase-FIR — dBTP soll die echte
    // Peak-Amplitude reflektieren, nicht die loudness-gewichtete.
    // Bei truePeakEnabled=false (oversampling=0) ueberspringen wir den
    // Update-Loop komplett (sample-peak-fallback bleibt 0 / -Infinity).
    if (this.truePeakEnabled) {
      this.truePeakL.processBlock(left);
      // Im Stereo-Modus separater R-Block; bei mono-spiegelung sehen die
      // beiden Meter identische Samples → R-TruePeak == L-TruePeak.
      this.truePeakR.processBlock(r);
    }

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

      // v3.103.0: Short-Term-History sampler fuer EBU R128 LRA.
      // Push erst nach Anlauf von 3s (sonst zeigt SlidingMS noch nicht den
      // echten ST-Wert). Danach pro Hop einen Snapshot.
      if (this._shortTermAnlaufSamples < this._shortTermFullSamples) {
        this._shortTermAnlaufSamples++;
      } else {
        this._shortTermSinceHop++;
        if (this._shortTermSinceHop >= this._shortTermHopSamples) {
          this._shortTermSinceHop = 0;
          const msStL = this.msShortTermL.meanSquare();
          const msStR = isStereo ? this.msShortTermR.meanSquare() : 0;
          const msStSum = isStereo ? msStL + msStR : msStL;
          const stLufs = meanSquareToLufs(msStSum);
          if (Number.isFinite(stLufs)) {
            // FIFO-Drop bei overflow (max 3600 = 6 Min @ 10Hz).
            if (this._shortTermHistory.length >= LRA_HISTORY_MAX) {
              this._shortTermHistory.shift();
            }
            this._shortTermHistory.push(stLufs);
          }
        }
      }

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

  /** Momentary-LUFS (400ms gleitend, channel-summed). */
  getMomentary(): number {
    const msL = this.msMomentaryL.meanSquare();
    const msR = this.channelCount === 2 ? this.msMomentaryR.meanSquare() : 0;
    const sum = this.channelCount === 2 ? msL + msR : msL;
    return meanSquareToLufs(sum);
  }

  /** Short-Term-LUFS (3s gleitend, channel-summed). */
  getShortTerm(): number {
    const msL = this.msShortTermL.meanSquare();
    const msR = this.channelCount === 2 ? this.msShortTermR.meanSquare() : 0;
    const sum = this.channelCount === 2 ? msL + msR : msL;
    return meanSquareToLufs(sum);
  }

  /**
   * v3.101.0: Per-Channel Momentary LUFS Snapshot.
   *
   * Liefert L, R + Channel-Sum separat — fuer L/R-getrennte Meter im UI.
   *
   * Channel-Gain = 1.0 pro Kanal (BS.1770-4 fuer Stereo).
   * Sum = L + R; Single-Channel-LUFS wird per `meanSquareToLufs(msX)`
   * (also nur dieser Kanal) berechnet — das ergibt -3 LUFS gegenueber der
   * Stereo-Sum bei identischen Signalen (was Mastering-Engineers von ihren
   * Tools erwarten).
   *
   * Bei Mono-Analyzer (channelCount=1): L gibt den Mono-Wert, R = L (gespiegelt),
   * sum = L (channel-gain 1.0).
   */
  getMomentaryStereo(): { L: number; R: number; sum: number } {
    const msL = this.msMomentaryL.meanSquare();
    if (this.channelCount === 1) {
      const v = meanSquareToLufs(msL);
      return { L: v, R: v, sum: v };
    }
    const msR = this.msMomentaryR.meanSquare();
    return {
      L:   meanSquareToLufs(msL),
      R:   meanSquareToLufs(msR),
      sum: meanSquareToLufs(msL + msR),
    };
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
   * v3.103.0: Echte EBU R128 / Tech 3342 LRA (Loudness Range) basierend auf
   * der internen Short-Term-Historie + aktuellem Integrated-Loudness als
   * Relative-Gate-Anker.
   *
   * Liefert 0 wenn:
   *   - History noch leer (vor dem ersten 3s-Anlauf bzw. nach reset())
   *   - Alle Werte gleich (statische Loudness)
   *   - Alle Werte unter Absolute-Gate
   *
   * Einheit: LU (Loudness Units).
   */
  getCurrentLra(): number {
    return computeLra(this._shortTermHistory, this.getIntegrated());
  }

  /**
   * v3.103.0: Aktuelle History-Laenge (Anzahl Short-Term-Samples seit
   * letztem reset()). UI nutzt das fuer "Building history..."-Indicator
   * waehrend der ersten 30 Sekunden — vorgeschlagen-Threshold: 30 ST-Samples
   * (= 3 Sekunden post-Anlauf) sind das absolute Minimum fuer eine
   * sinnvolle LRA-Verteilung.
   */
  getShortTermHistoryLength(): number {
    return this._shortTermHistory.length;
  }

  /**
   * v3.102.0: Aktueller True-Peak (BS.1770-4 Annex 2) pro Kanal seit dem
   * letzten `reset()` bzw. `resetAll()`. Werte in dBTP.
   *
   *   leftDb  → max True-Peak im linken Kanal
   *   rightDb → max True-Peak im rechten Kanal (bei mono: identisch zu links)
   *   maxDb   → max(leftDb, rightDb) — der Wert, an dem sich Streaming-Limits
   *              orientieren.
   *
   * Bei Silence / vor erstem processBlock: -Infinity.
   * Bei `truePeakOversampling=0`: alle drei sind -Infinity (Meter deaktiviert).
   */
  getCurrentTruePeak(): { leftDb: number; rightDb: number; maxDb: number } {
    if (!this.truePeakEnabled) {
      return { leftDb: -Infinity, rightDb: -Infinity, maxDb: -Infinity };
    }
    const leftDb  = this.truePeakL.getPeakDb();
    const rightDb = this.channelCount === 2
      ? this.truePeakR.getPeakDb()
      : leftDb; // Mono: R spiegelt L
    const maxDb = Math.max(
      Number.isFinite(leftDb)  ? leftDb  : -Infinity,
      Number.isFinite(rightDb) ? rightDb : -Infinity,
    );
    return { leftDb, rightDb, maxDb };
  }

  /**
   * Setzt nur das Integrated-Akku zurück (Momentary/Short-Term bleiben
   * gleitend — die hängen am Audio-Stream und sollen nicht aufeinmal
   * Stille zeigen).
   *
   * v3.102.0: Setzt auch den True-Peak-Running-Max zurück — UI-Pattern
   * "Reset" soll alle akkumulierten Mess-Werte zurücksetzen, nicht
   * inkonsistent nur LUFS aber nicht TP.
   *
   * Filter-State (Biquad-Memory) wird NICHT zurückgesetzt — sonst gäbe
   * es einen Filter-Einschwing-Glitch im laufenden Stream. Gleiches gilt
   * für True-Peak-FIR-Ring (gibt sonst einen Block-Boundary-Glitch).
   */
  reset(): void {
    this.integratedBlockL.fill(0);
    this.integratedBlockR.fill(0);
    this.integratedWriteIdx = 0;
    this.integratedSinceHop = 0;
    this.integratedBlockLoudness = [];
    // v3.103.0: Short-Term-Historie + Hop-Counter + Anlauf-Counter resetten.
    // Reset() laeuft synchron zum Integrated-Reset — LRA waere ohne neuen
    // Anlauf-Filter inkonsistent (alte ST-Werte gehen nicht zu neuem I).
    this._shortTermHistory = [];
    this._shortTermSinceHop = 0;
    this._shortTermAnlaufSamples = 0;
    // True-Peak: nur Running-Max zuruecksetzen, nicht den FIR-Ring
    // (s.o.). TruePeakMeter.reset() leert beides — wir wollen aber nur
    // den Peak resetten. Workaround: getPeakLinear() lesen, reset() rufen,
    // dann den Ring wieder einschwingen-lassen ist zu kompliziert. Da der
    // FIR-Ring nur 12 Samples Latenz produziert (0.25ms @ 48kHz), ist
    // ein voller Reset hier akzeptabel — der Engineer drueckt "Reset"
    // typischerweise vor einem neuen Mess-Lauf und sieht beim naechsten
    // Block-Pop ohnehin frische Werte.
    this.truePeakL.reset();
    this.truePeakR.reset();
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
    // v3.102.0: True-Peak-Meter komplett zuruecksetzen (Ring + Running-Max).
    this.truePeakL.reset();
    this.truePeakR.reset();
    this.reset();
  }
}

// ─── v3.101.0: Offline-Convenience-API ───────────────────────────────────────

/**
 * v3.101.0: Snapshot-Result einer Offline-Analyse.
 *
 * `lra` (Loudness Range) ist die Differenz zwischen 10% und 95%
 * Perzentil der Short-Term-Werte (EBU R128 / Tech 3342) mit
 * absolute-gate (-70 LUFS) + relative-gate (integrated - 20 LU).
 *
 * v3.103.0: Echter LRA-Algorithmus via interner Short-Term-Historie
 * (closed v3.101+v3.102-Caveat). Bei Buffern <3s ist die Historie noch
 * leer und LRA=0.
 */
export interface LufsStereoResult {
  momentary:  number;
  shortTerm:  number;
  integrated: number;
  /** v3.103: True EBU R128 Loudness Range in LU (LU95 - LU10, gated). */
  lra:        number;
  /** v3.101: Per-Channel Momentary fuer Stereo-Imbalance-Check. */
  channels:   { L: number; R: number };
}

/**
 * v3.101.0: Offline-Stereo-Analyse eines kompletten Buffer-Paars.
 *
 * Erzeugt eine fresh-`LufsAnalyzer`-Instanz (channelCount=2), pusht den
 * gesamten Buffer in einem Block durch und liest M/S/I + LRA raus.
 *
 * Backwards-Compat: wenn `right` weggelassen wird, gilt L=R (mono).
 *
 * Defensive:
 *   - `left.length !== right.length` → throw (Programmer-Error).
 *   - Buffer-Laenge < 400ms @ sampleRate → Momentary kann noch nicht
 *     "fertig sein" — der Wert wird trotzdem zurueck-gegeben (SlidingMS
 *     mittelt ueber filledCount).
 */
export function analyzeStereo(
  left:         Float32Array,
  right?:       Float32Array,
  sampleRate    = 48000,
): LufsStereoResult {
  if (right !== undefined && right.length !== left.length) {
    throw new Error(
      `analyzeStereo: L/R length mismatch (${left.length} vs ${right.length})`,
    );
  }
  const a = new LufsAnalyzer({ sampleRate, channelCount: 2 });
  a.processBlock(left, right);

  // v3.103.0: Echte EBU R128 / Tech 3342 LRA aus Short-Term-Historie.
  // Bei sehr kurzen Buffern (<3s + Hop) bleibt History leer → LRA=0.
  const integrated = a.getIntegrated();
  const shortTerm  = a.getShortTerm();
  const momentary  = a.getMomentary();
  const lra = a.getCurrentLra();
  const stereo = a.getMomentaryStereo();
  return {
    momentary, shortTerm, integrated, lra,
    channels: { L: stereo.L, R: stereo.R },
  };
}

/**
 * v3.101.0: Convenience-Wrapper fuer Web-Audio-AudioBuffer.
 *
 * Liest L+R (oder Mono) raus, ruft `analyzeStereo` mit der buffer-eigenen
 * sampleRate. Akzeptiert auch ein duck-typed Plain-Object mit
 * `numberOfChannels`, `sampleRate` und `getChannelData(i)` — damit der
 * Aufruf in Tests ohne Web-Audio-Browser-Mock funktioniert.
 */
export interface AudioBufferLike {
  numberOfChannels: number;
  sampleRate:       number;
  getChannelData:   (i: number) => Float32Array;
}

export function analyzeFromBuffer(buf: AudioBufferLike): LufsStereoResult {
  if (!buf || typeof buf.getChannelData !== "function") {
    throw new Error("analyzeFromBuffer: invalid buffer (missing getChannelData)");
  }
  const sr = buf.sampleRate;
  const nch = buf.numberOfChannels;
  if (!Number.isFinite(sr) || sr <= 0) {
    throw new Error(`analyzeFromBuffer: invalid sampleRate ${sr}`);
  }
  if (nch < 1) {
    throw new Error(`analyzeFromBuffer: needs >=1 channel (got ${nch})`);
  }
  const L = buf.getChannelData(0);
  const R = nch >= 2 ? buf.getChannelData(1) : undefined;
  return analyzeStereo(L, R, sr);
}

// ─── v3.101.0: Phase-Correlation + L/R-Imbalance (Pure Helpers) ─────────────

/**
 * v3.101.0: Phase-Correlation-Meter (Pearson-Korrelation L vs R).
 *
 *   r = Σ((L - meanL) · (R - meanR))
 *       / sqrt(Σ(L - meanL)² · Σ(R - meanR)²)
 *
 * Returns:
 *   +1 = identische Kanaele (mono / fully correlated)
 *    0 = uncorrelated (independent noise / wide stereo)
 *   -1 = inverted (out-of-phase — Phase-Cancellation-Warnung!)
 *
 * Pre-Conditions:
 *   - `left.length === right.length` → throw bei Mismatch.
 *   - Mind. 2 Samples (sonst keine Varianz).
 *   - Silence in beiden Kanaelen → 0 (undefined Korrelation, neutrale
 *     Anzeige).
 *
 * Performance: O(N), zwei Passes (mean + covariance). Bei 400ms @ 48kHz
 * = 19200 Samples — vernachlaessigbar.
 */
export function phaseCorrelation(
  left:  Float32Array,
  right: Float32Array,
): number {
  if (left.length !== right.length) {
    throw new Error(
      `phaseCorrelation: L/R length mismatch (${left.length} vs ${right.length})`,
    );
  }
  const N = left.length;
  if (N < 2) return 0;

  // Pass 1: Mittelwerte.
  let sumL = 0, sumR = 0;
  for (let i = 0; i < N; i++) {
    sumL += left[i];
    sumR += right[i];
  }
  const meanL = sumL / N;
  const meanR = sumR / N;

  // Pass 2: Kovarianz + Varianzen.
  let cov = 0, varL = 0, varR = 0;
  for (let i = 0; i < N; i++) {
    const dl = left[i]  - meanL;
    const dr = right[i] - meanR;
    cov  += dl * dr;
    varL += dl * dl;
    varR += dr * dr;
  }
  const denom = Math.sqrt(varL * varR);
  if (!Number.isFinite(denom) || denom <= 1e-30) return 0;
  const r = cov / denom;
  // Defensive numeric clamp — fp-Drift kann r minimal ueber 1 schieben.
  if (r >  1) return  1;
  if (r < -1) return -1;
  return r;
}

/**
 * v3.101.0: L/R-Imbalance in dB.
 *
 * Vergleicht RMS-Pegel der beiden Kanaele:
 *   imbalance = 20 · log10(rmsR / rmsL)
 *
 * Returns:
 *   0 dB   → perfectly balanced
 *   +X dB  → rechter Kanal um X dB lauter
 *   -X dB  → linker Kanal um X dB lauter
 *
 * Convention "positive = louder right" entspricht dem PPM-Meter-Standard
 * (links links, rechts rechts; Balance-Drift "nach rechts" = positiv).
 *
 * Pre-Conditions:
 *   - `left.length === right.length` → throw bei Mismatch.
 *   - Silence in einem Kanal → -Infinity / +Infinity (dB-Skala ist
 *     unbeschraenkt nach unten). Wir clampen auf +/-Infinity damit das UI
 *     den Edge-Case erkennen kann.
 *
 * Threshold-Hinweis fuer UI: >3dB = Imbalance-Warning (Mastering-Praxis).
 */
export function lrImbalanceDb(
  left:  Float32Array,
  right: Float32Array,
): number {
  if (left.length !== right.length) {
    throw new Error(
      `lrImbalanceDb: L/R length mismatch (${left.length} vs ${right.length})`,
    );
  }
  const N = left.length;
  if (N === 0) return 0;

  let sumSqL = 0, sumSqR = 0;
  for (let i = 0; i < N; i++) {
    sumSqL += left[i]  * left[i];
    sumSqR += right[i] * right[i];
  }
  const rmsL = Math.sqrt(sumSqL / N);
  const rmsR = Math.sqrt(sumSqR / N);

  // Edge-Cases: beide silent → 0 (balanced).
  if (rmsL <= 1e-30 && rmsR <= 1e-30) return 0;
  // Nur ein Kanal silent → +/-Infinity (UI sollte das als "kompletter
  // Mono-Bias" anzeigen, nicht als 0).
  if (rmsL <= 1e-30) return  Infinity; // links stumm → rechts unendlich lauter
  if (rmsR <= 1e-30) return -Infinity; // rechts stumm → links unendlich lauter

  return 20 * Math.log10(rmsR / rmsL);
}

/**
 * v3.101.0: UI-Hilfsfunktion — clampt `lrImbalanceDb`-Resultat auf einen
 * sinnvollen Range fuer Bar-Anzeige (z.B. +/-12dB).
 */
export function lrImbalanceForDisplay(db: number, maxAbsDb = 12): number {
  if (!Number.isFinite(db)) return db > 0 ? maxAbsDb : -maxAbsDb;
  if (db >  maxAbsDb) return  maxAbsDb;
  if (db < -maxAbsDb) return -maxAbsDb;
  return db;
}

/**
 * v3.101.0: UI-Hilfsfunktion — ist die Phase-Correlation in einem
 * gefaehrlichen Bereich (=out-of-phase-Warning)?
 *
 * Threshold default -0.2 — alles unter 0 ist "decorrelated to inverted",
 * unter -0.2 ist klar out-of-phase und sollte rot blinken.
 */
export function isPhaseCorrelationRisky(corr: number, threshold = -0.2): boolean {
  if (!Number.isFinite(corr)) return false;
  return corr < threshold;
}
