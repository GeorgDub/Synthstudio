/**
 * sampleSlicing.ts (TASK-238 / v2.89.0)
 *
 * Pure-Funktionen für Sample-Slicing / Chop:
 *   - Onset-Detection per Spectral-Flux (windowed RMS-Differenz als
 *     leichtgewichtige FFT-freie Variante — ohne Browser-Dependencies
 *     testbar in Node).
 *   - Snap-to-Zero-Crossing (Pop-Avoidance beim Slice-Start).
 *   - Limitierung auf 16 stärkste Onsets / equidistantes Auffüllen.
 *   - Buffer-Splitting an Frame-Offsets → Float32Array-Slices.
 *   - Pad-Mapping: Slices 0..N-1 auf Performance-Pad-Indizes.
 *
 * KEINE React- oder Browser-API-Abhängigkeit — komplett unit-testbar.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface OnsetDetectionOptions {
  /**
   * Spectral-Flux-Threshold. Frames mit Flux > `threshold * localMean` werden
   * als Onset markiert. Default 1.4.
   */
  threshold?: number;
  /** Window-Size in Samples (Default 1024). */
  windowSize?: number;
  /** Hop-Size in Samples (Default = windowSize / 2). */
  hopSize?: number;
  /** Minimum-Gap zwischen Onsets in Millisekunden (Default 50). */
  minGapMs?: number;
}

export interface OnsetCandidate {
  /** Sample-Index im Original-Buffer. */
  frame: number;
  /** Spectral-Flux-Stärke an dieser Stelle (höher = stärker). */
  strength: number;
}

export interface SliceSpec {
  /** Index im Slice-Array (0..N-1). */
  index: number;
  /** Start-Frame im Original-Buffer (inklusive). */
  startFrame: number;
  /** End-Frame im Original-Buffer (exklusive). */
  endFrame: number;
}

export const MAX_PERFORMANCE_PADS = 16;

// ─── Onset-Detection (Spectral Flux, FFT-frei) ───────────────────────────────

/**
 * Spectral-Flux-Onset-Detection.
 *
 * Statt einer vollständigen FFT (die in Node ohne dom-lib komplex zu testen
 * wäre) approximieren wir den spectral flux durch Sub-Band-RMS-Differenzen:
 *   1. Aufteilen in überlappende Windows.
 *   2. Pro Window: RMS in 4 Sub-Bändern (Low/Mid-Low/Mid-High/High) berechnen
 *      via Sample-Slice-Subsampling — günstige Approximation des Spectrums.
 *   3. "Flux" = Summe positiver Differenzen zum Vorgänger-Window (HWR).
 *   4. Adaptive Schwelle: localMean(20 windows) * threshold.
 *   5. Onsets = Flux-Peaks > Schwelle, mit minGap-Spacing.
 *
 * Pure-Funktion — nimmt ein Float32Array entgegen.
 */
export function detectOnsetsSpectralFlux(
  channelData: Float32Array,
  sampleRate: number,
  options: OnsetDetectionOptions = {},
): OnsetCandidate[] {
  const threshold = options.threshold ?? 1.4;
  const windowSize = Math.max(64, options.windowSize ?? 1024);
  const hopSize = Math.max(1, options.hopSize ?? Math.floor(windowSize / 2));
  const minGapMs = options.minGapMs ?? 50;
  const minGapFrames = Math.floor((minGapMs / 1000) * sampleRate);

  if (channelData.length < windowSize * 2) return [];

  // 4 Sub-Bänder als günstige Frequenz-Approximation
  const NUM_BANDS = 4;
  const numWindows = Math.floor((channelData.length - windowSize) / hopSize) + 1;
  if (numWindows < 2) return [];

  // Pro Window: 4 RMS-Werte. Subsampling per Stride statt FFT.
  const spectra: Float32Array[] = new Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    const start = w * hopSize;
    const bands = new Float32Array(NUM_BANDS);
    // Sub-Band approximieren: niedrige Bänder = downsampled,
    // hohe Bänder = high-pass via first-difference.
    for (let b = 0; b < NUM_BANDS; b++) {
      let sum = 0;
      let count = 0;
      const stride = b + 1; // grob: niedrige Bänder dichter sampled
      for (let i = 0; i < windowSize; i += stride) {
        const idx = start + i;
        if (idx >= channelData.length) break;
        let v = channelData[idx];
        // Bands 2/3 als High-Pass: 1st-difference dämpft DC + Low-Freq
        if (b >= 2 && idx > 0) {
          v = channelData[idx] - channelData[idx - 1];
        }
        sum += v * v;
        count++;
      }
      bands[b] = count > 0 ? Math.sqrt(sum / count) : 0;
    }
    spectra[w] = bands;
  }

  // Spectral Flux = Summe positiver Differenzen zum Vorgänger
  const flux = new Float32Array(numWindows);
  for (let w = 1; w < numWindows; w++) {
    let f = 0;
    const cur = spectra[w];
    const prev = spectra[w - 1];
    for (let b = 0; b < NUM_BANDS; b++) {
      const diff = cur[b] - prev[b];
      if (diff > 0) f += diff;
    }
    flux[w] = f;
  }

  // Adaptive Peak-Picking
  const localWindow = 20;
  const candidates: OnsetCandidate[] = [];
  let lastOnsetFrame = -minGapFrames;

  for (let w = 1; w < numWindows - 1; w++) {
    const lookback = Math.max(0, w - localWindow);
    let mean = 0;
    let n = 0;
    for (let k = lookback; k < w; k++) {
      mean += flux[k];
      n++;
    }
    mean = n > 0 ? mean / n : 0;
    // Threshold absolut + relativ (vermeidet Onsets in komplett stillen Bereichen)
    const minAbsolute = 1e-6;
    if (flux[w] < minAbsolute) continue;
    if (mean > 0 && flux[w] < mean * threshold) continue;
    if (flux[w] <= flux[w - 1] || flux[w] < flux[w + 1]) continue;

    const frame = w * hopSize;
    if (frame - lastOnsetFrame < minGapFrames) continue;
    candidates.push({ frame, strength: flux[w] });
    lastOnsetFrame = frame;
  }

  return candidates;
}

// ─── Zero-Crossing Snap ──────────────────────────────────────────────────────

/**
 * Sucht das nächste Zero-Crossing (Vorzeichenwechsel) in der Nähe eines
 * Frames. Reduziert Pops/Klicks beim Slice-Start.
 *
 * Sucht symmetrisch im Bereich [frame-searchRadius, frame+searchRadius] und
 * gibt das ZC mit dem geringsten Abstand zur Ziel-Position zurück.
 * Falls keines gefunden: gibt `frame` unverändert zurück.
 */
export function snapToZeroCrossing(
  channelData: Float32Array,
  frame: number,
  searchRadius = 256,
): number {
  if (!channelData || channelData.length === 0) return frame;
  const len = channelData.length;
  const clamped = Math.max(0, Math.min(len - 1, frame));
  // Edge-Case: Frame 0 → bleibt 0 (Slice-0 startet immer am Buffer-Start).
  if (clamped === 0) return 0;
  const lo = Math.max(1, clamped - searchRadius);
  const hi = Math.min(len - 1, clamped + searchRadius);

  let best = clamped;
  let bestDist = Infinity;
  for (let i = lo; i <= hi; i++) {
    const a = channelData[i - 1];
    const b = channelData[i];
    // ZC = Vorzeichenwechsel, oder direkter 0-Wert
    if ((a <= 0 && b > 0) || (a >= 0 && b < 0) || b === 0) {
      const d = Math.abs(i - clamped);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
  }
  return best;
}

// ─── Slice-Helpers ───────────────────────────────────────────────────────────

/**
 * Begrenzt eine Onset-Liste auf die N stärksten Peaks. Erhält danach die
 * zeitliche Reihenfolge (sortiert nach `frame`).
 */
export function limitToStrongestOnsets(
  onsets: OnsetCandidate[],
  maxCount = MAX_PERFORMANCE_PADS,
): OnsetCandidate[] {
  if (onsets.length <= maxCount) return [...onsets].sort((a, b) => a.frame - b.frame);
  const sortedByStrength = [...onsets].sort((a, b) => b.strength - a.strength);
  const top = sortedByStrength.slice(0, maxCount);
  return top.sort((a, b) => a.frame - b.frame);
}

/**
 * Füllt eine Onset-Liste auf `targetCount` Slices auf — mit equidistanten
 * Markern. Wird verwendet, wenn die Onset-Detection weniger als 16 Slices
 * gefunden hat. Garantiert ≥ 1 Onset bei Frame 0.
 *
 * Algorithmus:
 *   1. Sicherstellen, dass ein Onset bei 0 existiert.
 *   2. Falls Anzahl < targetCount: zwischen den existierenden Onsets oder
 *      ans Ende equidistant auffüllen, bis targetCount erreicht ist.
 */
export function padOnsetsEquidistant(
  onsets: OnsetCandidate[],
  totalFrames: number,
  targetCount: number,
): OnsetCandidate[] {
  if (totalFrames <= 0 || targetCount <= 0) return [];
  // Sort + ensure-zero
  const sorted = [...onsets].sort((a, b) => a.frame - b.frame);
  if (sorted.length === 0 || sorted[0].frame > 0) {
    sorted.unshift({ frame: 0, strength: 0 });
  }
  if (sorted.length >= targetCount) return sorted.slice(0, targetCount);

  // Existierende behalten, restliche Slots equidistant über [lastFrame..totalFrames]
  const last = sorted[sorted.length - 1].frame;
  const remaining = targetCount - sorted.length;
  if (remaining <= 0 || last >= totalFrames - 1) return sorted;
  const spanStart = last;
  const span = totalFrames - spanStart;
  const step = span / (remaining + 1);
  for (let i = 1; i <= remaining; i++) {
    const f = Math.floor(spanStart + step * i);
    if (f < totalFrames) sorted.push({ frame: f, strength: 0 });
  }
  return sorted.sort((a, b) => a.frame - b.frame).slice(0, targetCount);
}

/**
 * Konvertiert eine sortierte Onset-Liste in SliceSpec-Regionen.
 * Slice[i] = [frame[i], frame[i+1]); letzter Slice → totalFrames.
 */
export function onsetsToSlices(
  onsets: OnsetCandidate[],
  totalFrames: number,
): SliceSpec[] {
  if (totalFrames <= 0) return [];
  const sorted = [...onsets].sort((a, b) => a.frame - b.frame);
  // Falls keine Onsets oder erstes nicht 0: ein 1-Slice-Fallback ab 0
  if (sorted.length === 0) {
    return [{ index: 0, startFrame: 0, endFrame: totalFrames }];
  }
  if (sorted[0].frame > 0) sorted.unshift({ frame: 0, strength: 0 });

  const slices: SliceSpec[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = Math.max(0, Math.min(totalFrames, sorted[i].frame));
    const end = i + 1 < sorted.length
      ? Math.max(start + 1, Math.min(totalFrames, sorted[i + 1].frame))
      : totalFrames;
    if (end > start) slices.push({ index: slices.length, startFrame: start, endFrame: end });
  }
  return slices;
}

/**
 * Komplette Auto-Slice-Pipeline:
 *   1. Onset-Detection (Spectral Flux)
 *   2. Falls > maxSlices: nimm die `maxSlices` stärksten
 *   3. Falls < maxSlices: fülle mit equidistanten Markern auf
 *   4. (Optional) Snap aller Onsets zur nächsten Zero-Crossing
 *   5. Onsets → SliceSpec-Array
 */
export function autoSlice(
  channelData: Float32Array,
  sampleRate: number,
  options: {
    maxSlices?: number;
    snapToZero?: boolean;
    detection?: OnsetDetectionOptions;
    /** Falls true: Slice-Liste wird auf exakt `maxSlices` (default 16) aufgefüllt. */
    fillToMax?: boolean;
  } = {},
): SliceSpec[] {
  const maxSlices = options.maxSlices ?? MAX_PERFORMANCE_PADS;
  const fillToMax = options.fillToMax ?? true;
  const snapZero = options.snapToZero ?? true;
  const totalFrames = channelData.length;

  // Detection liefert "interior"-Onsets (typischerweise NICHT bei Frame 0).
  // Da onsetsToSlices implicit ein Onset bei 0 hinzufügt, bedeutet jeder
  // detected Onset → +1 Slice. Wir cappen also auf maxSlices-1, damit nach
  // dem Frame-0-Prepend genau maxSlices Slices entstehen.
  let onsets = detectOnsetsSpectralFlux(channelData, sampleRate, options.detection);
  // Filter: Onsets bei Frame 0 erst rauswerfen, sonst Doppel-Zählung
  onsets = onsets.filter(o => o.frame > 0);
  // Max interior-Onsets = maxSlices - 1 (+ implicit frame-0)
  onsets = limitToStrongestOnsets(onsets, Math.max(0, maxSlices - 1));

  if (fillToMax && onsets.length + 1 < maxSlices) {
    // Auffüllen auf maxSlices Onsets total (inkl. Frame-0)
    onsets = padOnsetsEquidistant(onsets, totalFrames, maxSlices);
  } else {
    // Garantiere Onset bei Frame 0
    onsets = [{ frame: 0, strength: 0 }, ...onsets].sort((a, b) => a.frame - b.frame);
  }

  // Final-Cap (defensiv): falls padding overshot
  if (onsets.length > maxSlices) {
    onsets = onsets.slice(0, maxSlices);
  }

  if (snapZero) {
    onsets = onsets.map(o => ({
      ...o,
      frame: snapToZeroCrossing(channelData, o.frame, Math.min(256, Math.floor(sampleRate / 100))),
    })).sort((a, b) => a.frame - b.frame);
  }

  // Dedupe + Mindestabstand zwischen Onsets (verhindert Mini-Slices die durch
  // Snap-to-Zero zu nah aneinander rutschen können). Mindestens 1ms Spacing.
  const minSpacingFrames = Math.max(2, Math.floor(sampleRate / 1000));
  const deduped: OnsetCandidate[] = [];
  for (const o of onsets) {
    const last = deduped[deduped.length - 1];
    if (!last || o.frame - last.frame >= minSpacingFrames) {
      deduped.push(o);
    }
  }
  onsets = deduped;

  // Final-Cap nach Snap/Dedupe (kann nochmal nötig sein)
  if (onsets.length > maxSlices) onsets = onsets.slice(0, maxSlices);

  return onsetsToSlices(onsets, totalFrames);
}

// ─── Manual-Editing ──────────────────────────────────────────────────────────

/**
 * Fügt einen Onset an `frame` ein und re-sliced. Max-Limit wird respektiert.
 */
export function addOnset(
  onsets: OnsetCandidate[],
  frame: number,
  maxCount = MAX_PERFORMANCE_PADS,
): OnsetCandidate[] {
  if (frame < 0) return onsets;
  // Vermeide Duplikat
  if (onsets.some(o => o.frame === frame)) return onsets;
  if (onsets.length >= maxCount) return onsets;
  return [...onsets, { frame, strength: 1 }].sort((a, b) => a.frame - b.frame);
}

/**
 * Entfernt einen Onset an einem gegebenen Frame.
 */
export function removeOnset(onsets: OnsetCandidate[], frame: number): OnsetCandidate[] {
  return onsets.filter(o => o.frame !== frame);
}

/**
 * Bewegt einen Onset auf eine neue Frame-Position. Behält die Original-
 * Strength. Sortiert das Ergebnis nach Frame.
 */
export function moveOnset(
  onsets: OnsetCandidate[],
  fromFrame: number,
  toFrame: number,
): OnsetCandidate[] {
  const target = onsets.find(o => o.frame === fromFrame);
  if (!target) return onsets;
  const filtered = onsets.filter(o => o.frame !== fromFrame);
  return [...filtered, { ...target, frame: toFrame }].sort((a, b) => a.frame - b.frame);
}

// ─── Buffer-Splitting ────────────────────────────────────────────────────────

/**
 * Splittet die Channel-Data eines AudioBuffers an den Slice-Grenzen in
 * eigenständige Float32Arrays. Reines Mono-Splitting (channel 0). Für Stereo-
 * Export müsste dies analog auf Kanal 1 ausgeführt werden.
 *
 * Niemals leere Slices — Mindestlänge 1 Frame ist durch onsetsToSlices garantiert.
 */
export function splitChannelDataAtSlices(
  channelData: Float32Array,
  slices: SliceSpec[],
): Float32Array[] {
  return slices.map(s => {
    const start = Math.max(0, Math.min(channelData.length, s.startFrame));
    const end = Math.max(start, Math.min(channelData.length, s.endFrame));
    return channelData.slice(start, end);
  });
}

// ─── Pad-Mapping ─────────────────────────────────────────────────────────────

export interface PadAssignment {
  padIndex: number;
  sliceIndex: number;
  startFrame: number;
  endFrame: number;
}

/**
 * Mappt Slice-Specs auf Performance-Pad-Indizes 0..padCount-1.
 *
 * - Bei N <= padCount: Slices landen auf Pads 0..N-1; restliche Pads bleiben unverbunden.
 * - Bei N > padCount: Erste padCount Slices werden gemappt; weitere werden verworfen.
 *
 * Wir lassen den Caller entscheiden, was er mit "restlichen" Pads tut
 * (typischerweise: unverändert lassen, NICHT überschreiben).
 */
export function mapSlicesToPads(
  slices: SliceSpec[],
  padCount = MAX_PERFORMANCE_PADS,
): PadAssignment[] {
  const n = Math.min(slices.length, padCount);
  const out: PadAssignment[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      padIndex: i,
      sliceIndex: slices[i].index,
      startFrame: slices[i].startFrame,
      endFrame: slices[i].endFrame,
    });
  }
  return out;
}
