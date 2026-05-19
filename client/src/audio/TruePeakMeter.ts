/**
 * Synthstudio – TruePeakMeter.ts  (v3.102.0)
 *
 * True-Peak-Meter nach ITU-R BS.1770-4 Annex 2.
 *
 * Hintergrund:
 *   Sample-Peaks (max |x[n]|) reichen nicht aus, um die maximale Pegel-
 *   Spitze eines digitalen Signals zu erfassen. Beim D/A-Wandeln oder
 *   bei Sample-Rate-Conversion entstehen zwischen den diskreten Samples
 *   sogenannte Inter-Sample-Peaks. Streaming-Plattformen verlangen
 *   True-Peak-compliance:
 *     - Spotify:      -1 dBTP
 *     - Apple Music:  -1 dBTP
 *     - Amazon HD:    -2 dBTP
 *     - YouTube:      -1 dBTP
 *
 * Algorithmus (BS.1770-4 Annex 2):
 *   1. Upsample um Faktor L (≥4) via FIR-Tiefpass.
 *   2. Peak-Detection auf dem oversampled Signal.
 *   3. dBTP = 20 · log10(max(|x_oversampled|))
 *
 * Wir nutzen 4x-Oversampling via Polyphase-FIR (48 Taps gesamt = 12 Taps
 * pro Phase × 4 Phasen). Das ist der Spec-empfohlene Minimum-Faktor und
 * deckt Inter-Sample-Peaks bis nyquist/2 sicher ab.
 *
 * Implementation:
 *   - Polyphase-Decomposition: H(z) = Σ_p z^-p · E_p(z^L)
 *     wobei E_p(z) = h[p+kL] für k=0..TAPS_PER_PHASE-1.
 *   - Pro Input-Sample werden L Output-Samples berechnet (eines pro Phase).
 *   - Ring-Buffer (Length TAPS_PER_PHASE) hält die letzten Input-Samples.
 *
 * Filter-Design:
 *   - Windowed-Sinc, Hann-Fenster, Cutoff = nyquist/L (Spiegelfrequenzen
 *     unterdrücken).
 *   - 12 Taps pro Phase reichen für ~60dB Stopband-Attenuation — das
 *     reicht für Inter-Sample-Peak-Detection mit <0.1 dBTP Fehler.
 *   - Filter-Koeffizienten werden bei Modul-Load einmal berechnet
 *     (Module-Const), kein per-call Overhead.
 *
 * Stateful Variante (TruePeakMeter-Klasse):
 *   - Hält den Ring-Buffer + Running-Max zwischen processBlock-Calls.
 *   - reset() setzt beides zurück.
 *   - Für streaming-LUFS-Tap, der alle 100ms einen Block bekommt.
 *
 * Stateless Variante (truePeak()):
 *   - Einmal-Aufruf für komplette Float32Array — frische FIR-State.
 *   - Für Offline-Analyse + Tests.
 *
 * v3.102.0 Public API:
 *   - truePeak(samples, oversampling?=4) → dBTP (number)
 *   - TruePeakMeter-Klasse mit processBlock/getPeakDb/reset
 *
 * Caveats:
 *   - FIR-Group-Delay (TAPS_PER_PHASE/2 = 6 Samples Input-Latenz) wird
 *     nicht kompensiert — wir suchen den MAX, nicht die exakte
 *     Sample-Position.
 *   - Bei oversampling=1 (disabled-Gate) liefert truePeak den sample-peak.
 */

// ─── FIR-Filter-Design ────────────────────────────────────────────────────────

/**
 * Anzahl Filter-Taps pro Polyphase-Branch. Mit PHASES=4 macht das
 * 48 Taps Gesamtfilter — guter Trade-off zwischen Qualität (~60dB SB-Att)
 * und Performance (12 MACs pro Output-Sample).
 */
export const TAPS_PER_PHASE = 12;

/**
 * Upsampling-Faktor (BS.1770-4 empfiehlt mind. 4x). Höhere Werte (8x, 16x)
 * geben präzisere Inter-Sample-Peaks aber kosten linear mehr CPU.
 */
export const DEFAULT_OVERSAMPLING = 4;

/**
 * Designed einen Polyphase-FIR-Tiefpass via Windowed-Sinc + Hann-Window.
 *
 * @param phases  Upsampling-Faktor L (≥1).
 * @param tapsPerPhase Anzahl Taps pro Phase (≥1).
 * @returns Array von L Float32Arrays, je tapsPerPhase Koeffizienten.
 *
 * Pseudocode:
 *   for p = 0..L-1:
 *     for k = 0..N-1:
 *       n_centered = k*L + p - (N*L/2)
 *       sinc       = sin(π·n/L) / (π·n/L), oder 1 wenn n==0
 *       hann       = 0.5·(1 - cos(2π·(k+0.5)/N))
 *       taps[p][k] = sinc · hann / L   (1/L compensates für upsampling-DC-gain)
 */
export function designPolyphaseFIR(
  phases       = DEFAULT_OVERSAMPLING,
  tapsPerPhase = TAPS_PER_PHASE,
): Float32Array[] {
  if (!Number.isInteger(phases) || phases < 1) {
    throw new Error(`designPolyphaseFIR: invalid phases ${phases}`);
  }
  if (!Number.isInteger(tapsPerPhase) || tapsPerPhase < 1) {
    throw new Error(`designPolyphaseFIR: invalid tapsPerPhase ${tapsPerPhase}`);
  }
  const filters: Float32Array[] = [];
  const totalTaps  = tapsPerPhase * phases;
  const halfCenter = totalTaps / 2;
  // Erst die volle (nicht-polyphase) Impulse-Response designen, dann in
  // L Phasen zerlegen. Hann-Window MUSS ueber die volle Filterlaenge
  // laufen — sonst entsteht ein per-phase-Gain-Drift der den
  // Inter-Sample-Peak verfaelscht (Phase-0 sieht z.B. die Window-Mitte,
  // Phase-L-1 sieht den Window-Rand).
  const fullIR = new Float32Array(totalTaps);
  let sumIR = 0;
  for (let i = 0; i < totalTaps; i++) {
    // Position zentriert um 0 — fuer einen kausalen FIR-Filter ist die
    // Mitte bei index = totalTaps/2 - 0.5 (zwischen Samples). Wir
    // verwenden i+0.5 als Sample-Position um Linear-Phase zu erhalten.
    const n = i + 0.5 - halfCenter;
    const x = (Math.PI * n) / phases;
    const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x;
    // Hann-Window ueber die VOLLE Filterlaenge.
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * (i + 0.5)) / totalTaps));
    fullIR[i] = sinc * hann;
    sumIR += fullIR[i];
  }
  // Polyphase-Decomposition: Phase p enthaelt jede L-te Tap startend bei p.
  // Anschliessend normalisieren wir JEDE Phase separat auf sum=1, damit bei
  // DC-Input (alle 1) jede Phase Output 1.0 liefert (kein 0dBTP-Offset).
  for (let p = 0; p < phases; p++) {
    const taps = new Float32Array(tapsPerPhase);
    let sumP = 0;
    for (let k = 0; k < tapsPerPhase; k++) {
      taps[k] = fullIR[p + k * phases];
      sumP += taps[k];
    }
    if (sumP !== 0) {
      const scale = 1 / sumP;
      for (let k = 0; k < tapsPerPhase; k++) taps[k] *= scale;
    }
    filters.push(taps);
  }
  // sumIR wird nach Normalisierung nicht mehr verwendet, aber wir wollen den
  // Wert nicht stranden lassen — Lint-clean Hilfsmittel.
  void sumIR;
  return filters;
}

/**
 * Modul-Const: 4x-Polyphase-Filter (default). Wird einmal bei Modul-Load
 * berechnet, alle truePeak()-Calls greifen darauf zu (kein Allocation pro
 * Call).
 */
const DEFAULT_FILTERS = designPolyphaseFIR(DEFAULT_OVERSAMPLING, TAPS_PER_PHASE);

// ─── True-Peak — Stateless ────────────────────────────────────────────────────

/**
 * Berechnet den True-Peak in dBTP für einen kompletten Sample-Block.
 *
 * @param samples Eingangssamples (Float32Array, typischerweise -1..+1).
 * @param oversampling Faktor (default 4). Bei 1 = sample-peak (FIR disabled).
 * @returns dBTP-Wert (z.B. -1.2). Bei Silence: -Infinity.
 *
 * Pre-Conditions:
 *   - samples.length >= 1 (kürzer → -Infinity, kein Throw)
 *   - oversampling > 0
 *
 * Performance: O(N · L · TAPS_PER_PHASE). Bei N=2048, L=4, T=12: 98304 MACs.
 * Bei 48kHz/100ms-Polling: ~1ms CPU auf modernen Browsern.
 */
export function truePeak(
  samples:      Float32Array,
  oversampling = DEFAULT_OVERSAMPLING,
): number {
  if (!Number.isFinite(oversampling) || oversampling < 1) {
    throw new Error(`truePeak: invalid oversampling ${oversampling}`);
  }
  if (!samples || samples.length === 0) return -Infinity;

  // Fast-Path: oversampling=1 → einfaches sample-peak.
  if (oversampling === 1) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    return peak <= 0 ? -Infinity : 20 * Math.log10(peak);
  }

  // Polyphase-Filter (cached für default, neu für custom Faktoren).
  const filters =
    oversampling === DEFAULT_OVERSAMPLING && DEFAULT_FILTERS.length === DEFAULT_OVERSAMPLING
      ? DEFAULT_FILTERS
      : designPolyphaseFIR(oversampling, TAPS_PER_PHASE);
  const tapsPerPhase = filters[0].length;
  const phases = filters.length;

  // Sample-Peak als Untergrenze (Polyphase-Phase-0 gibt das nicht exakt
  // wieder wegen Filter-Gain; wir berechnen es trotzdem mit, damit das
  // Resultat NIEMALS unter dem Sample-Peak liegt — das wäre eine
  // BS.1770-4 Annex 2 Verletzung).
  let samplePeak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > samplePeak) samplePeak = a;
  }

  // Ring-Buffer für die letzten tapsPerPhase Input-Samples.
  // writeIdx zeigt auf die nächste Schreibposition (= ältester Slot).
  const ring = new Float32Array(tapsPerPhase);
  let writeIdx = 0;
  let peak = samplePeak;

  for (let i = 0; i < samples.length; i++) {
    ring[writeIdx] = samples[i];
    writeIdx = (writeIdx + 1) % tapsPerPhase;
    // L Output-Samples (eines pro Phase) berechnen.
    // Convolution: y[p] = Σ_k h_p[k] · x[t - k]
    //   t = aktueller Sample-Index
    //   x[t-k] = ring[(writeIdx - 1 - k + N) % N]
    //     (writeIdx-1 ist gerade der NEUESTE Slot — k=0 dort, k=N-1 am ältesten)
    for (let p = 0; p < phases; p++) {
      const h = filters[p];
      let acc = 0;
      for (let k = 0; k < tapsPerPhase; k++) {
        const idx = (writeIdx - 1 - k + tapsPerPhase) % tapsPerPhase;
        acc += h[k] * ring[idx];
      }
      const a = Math.abs(acc);
      if (a > peak) peak = a;
    }
  }

  if (peak <= 0) return -Infinity;
  return 20 * Math.log10(peak);
}

// ─── True-Peak — Stateful ─────────────────────────────────────────────────────

/**
 * Stateful TruePeakMeter für streaming-Audio. Hält den FIR-Ring-Buffer
 * zwischen processBlock-Calls (Continuity über Block-Grenzen) und einen
 * Running-Max-Peak.
 *
 * Typische Verwendung (siehe AudioEngine LUFS-Polling-Loop):
 *
 *   const tp = new TruePeakMeter();
 *   // ... alle 100ms:
 *   tp.processBlock(scratch);
 *   const dbtp = tp.getPeakDb();
 *   // ... bei Reset-Button:
 *   tp.reset();
 *
 * Stereo: zwei Instanzen, eine pro Kanal.
 */
export class TruePeakMeter {
  /** Anzahl Phasen (Upsampling-Faktor). */
  public readonly oversampling: number;
  /** Filter-Taps pro Phase. */
  private filters: Float32Array[];
  private tapsPerPhase: number;
  /** Ring-Buffer mit letzten Input-Samples. */
  private ring: Float32Array;
  private writeIdx = 0;
  /** Running-Maximum des linear-Peaks (≥ 0). */
  private peakLinear = 0;
  /** Ob seit dem letzten Reset überhaupt Samples gesehen wurden. */
  private sawAny = false;

  constructor(oversampling = DEFAULT_OVERSAMPLING) {
    if (!Number.isInteger(oversampling) || oversampling < 1) {
      throw new Error(`TruePeakMeter: invalid oversampling ${oversampling}`);
    }
    this.oversampling = oversampling;
    this.filters =
      oversampling === DEFAULT_OVERSAMPLING
        ? DEFAULT_FILTERS
        : designPolyphaseFIR(oversampling, TAPS_PER_PHASE);
    this.tapsPerPhase = this.filters[0].length;
    this.ring = new Float32Array(this.tapsPerPhase);
  }

  /**
   * Verarbeitet einen Sample-Block — updated den Running-Max-Peak.
   *
   * Hot path: keine Allokationen, inline-MACs.
   * Bei oversampling=1: Fast-Path (kein FIR-Loop).
   */
  processBlock(samples: Float32Array): void {
    if (!samples || samples.length === 0) return;
    this.sawAny = true;

    // Sample-Peak immer mit-tracken (siehe Begründung in truePeak()).
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > this.peakLinear) this.peakLinear = a;
    }

    if (this.oversampling === 1) return;

    const phases       = this.oversampling;
    const tapsPerPhase = this.tapsPerPhase;
    const ring         = this.ring;
    const filters      = this.filters;
    let writeIdx       = this.writeIdx;

    for (let i = 0; i < samples.length; i++) {
      ring[writeIdx] = samples[i];
      writeIdx = (writeIdx + 1) % tapsPerPhase;
      // y[p] = Σ_k h_p[k] · x[t-k]; ring[(writeIdx-1-k) % N] = x[t-k].
      for (let p = 0; p < phases; p++) {
        const h = filters[p];
        let acc = 0;
        for (let k = 0; k < tapsPerPhase; k++) {
          const idx = (writeIdx - 1 - k + tapsPerPhase) % tapsPerPhase;
          acc += h[k] * ring[idx];
        }
        const a = Math.abs(acc);
        if (a > this.peakLinear) this.peakLinear = a;
      }
    }
    this.writeIdx = writeIdx;
  }

  /**
   * Aktueller True-Peak seit letztem reset() in dBTP.
   * Bei noch keinen Samples → -Infinity.
   */
  getPeakDb(): number {
    if (!this.sawAny || this.peakLinear <= 0) return -Infinity;
    return 20 * Math.log10(this.peakLinear);
  }

  /** Linear-Peak (für UI mit eigener log-Skala). */
  getPeakLinear(): number {
    return this.peakLinear;
  }

  /**
   * Setzt Running-Max + FIR-State zurück. UI nutzt das typischerweise
   * synchron mit "Reset Integrated LUFS" — neuer Mess-Lauf.
   */
  reset(): void {
    this.peakLinear = 0;
    this.sawAny = false;
    this.ring.fill(0);
    this.writeIdx = 0;
  }
}

// ─── UI-Helpers ──────────────────────────────────────────────────────────────

/**
 * Color-Coding für True-Peak-Display:
 *   ≥ -1 dBTP   → danger (über Streaming-Limit, Inter-Sample-Clipping
 *                  möglich)
 *   ≥ -3 dBTP   → warning (knapp)
 *   < -3 dBTP   → success (sicher)
 *   -Infinity   → muted (Silence)
 */
export function truePeakColorClass(db: number): string {
  if (!Number.isFinite(db)) return "text-text-muted";
  if (db >= -1) return "text-accent-danger";
  if (db >= -3) return "text-accent-warning";
  return "text-accent-success";
}

/**
 * Formatiert einen dBTP-Wert für die Anzeige:
 *   -Infinity → "−∞ dBTP"
 *   sonst     → "−1.2 dBTP" (1 Nachkommastelle, eigenes Minuszeichen "−")
 */
export function formatTruePeak(db: number): string {
  if (!Number.isFinite(db)) return "−∞ dBTP";
  if (db < 0)  return `−${Math.abs(db).toFixed(1)} dBTP`;
  if (db > 0)  return `+${db.toFixed(1)} dBTP`;
  return "0.0 dBTP";
}

/**
 * Threshold-Check: True-Peak ≥ -1 dBTP → Streaming-Standard verletzt.
 * Default-Threshold ist Spotify/Apple/YouTube-Limit. Streaming-Bots
 * reduzieren Lautheit bei Verletzung automatisch.
 */
export function isTruePeakRisky(db: number, threshold = -1): boolean {
  if (!Number.isFinite(db)) return false;
  return db >= threshold;
}
