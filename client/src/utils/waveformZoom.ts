/**
 * Synthstudio – waveformZoom.ts (v3.67.0)
 *
 * Pure-fn-Modul für Sample-Precise-Waveform-Zoom + Scroll + Cursor + Loop-Points.
 * Komplett DOM-frei damit das in Node/Vitest deterministisch testbar ist. Die
 * React-Komponente `ZoomableWaveform` wired die Helper an Canvas + Maus/Tastatur.
 *
 * Konventionen:
 *   - `totalSamples`  – komplette Audio-Länge in Samples (zB buffer.length).
 *   - `zoomLevel`     – Faktor 1..MAX_ZOOM. 1 = full track, MAX = max in.
 *   - `scrollOffset`  – Position in *Samples* (NICHT pixel). 0..lastValid.
 *   - `samplesPerPixel` – view-only — wird aus zoom + viewport berechnet.
 *
 * Architektur-Regeln (CLAUDE.md):
 *   - Pure-fns: kein Side-Effect, keine globalen Reads, keine console.*.
 *   - Defensive: NaN/Infinity/negative Inputs werden auf Bounds geclamped.
 *   - Sample-precise: alle Rundungen explizit (Math.floor/round) damit
 *     der Cursor sich nicht zwischen Zoom-Steps "verschiebt".
 */

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Minimaler Zoom — 1× = ganzer Track passt in den Viewport. */
export const MIN_ZOOM = 1;

/** Maximaler Zoom — 100× = 100 Samples pro Pixel (sample-line-Rendering). */
export const MAX_ZOOM = 100;

/**
 * Schwelle wann der Renderer von "peak bars" zu "sample line" wechseln sollte.
 * Bei < 1 Sample pro Pixel ist Peak-Rendering nutzlos — wir zeichnen die
 * tatsächlichen Sample-Werte als zusammenhängende Linie.
 */
export const SAMPLE_LINE_THRESHOLD = 1.0;

/**
 * Zoom-Step-Multiplikator für Mouse-Wheel + Keyboard +/-.
 * 1.25 = "smooth" zoom, jeder Tick ist ~25% Schritt.
 */
export const ZOOM_STEP = 1.25;

/**
 * Default-Window für Zero-Crossing-Snap (in Samples).
 * Loop-Marker beim Drop sucht innerhalb dieser Distanz nach dem nächsten
 * Vorzeichenwechsel um Click-Artefakte zu vermeiden.
 */
export const DEFAULT_ZERO_CROSS_WINDOW = 64;

/**
 * Maximale samples-per-pixel-Schranke bei MIN_ZOOM. Falls totalSamples < viewport
 * (winziger Buffer) clamp wir nicht — der Renderer zeigt das Sample 1:1.
 */
export const MAX_SAMPLES_PER_PIXEL_AT_MIN_ZOOM = Number.POSITIVE_INFINITY;

// ─── Typen ───────────────────────────────────────────────────────────────────

export interface ZoomState {
  zoomLevel: number;
  scrollOffset: number; // in samples
}

export interface ViewportInfo {
  /** Anzahl Samples die sichtbar sind (totalSamples / zoomLevel). */
  visibleSamples: number;
  /** Sample-Index am linken Rand des Viewports (== scrollOffset, geclamped). */
  firstVisibleSample: number;
  /** Sample-Index am rechten Rand (exklusiv). */
  lastVisibleSample: number;
  /** Wieviele Samples pro Pixel — < 1.0 ⇒ sample-line-Rendering. */
  samplesPerPixel: number;
}

// ─── Pure Helpers ────────────────────────────────────────────────────────────

/**
 * Clamp + NaN-defensive. Liefert immer eine Zahl im Bereich [min, max].
 * NaN, undefined, null, ±Infinity werden auf min gemappt.
 */
export function clampNumber(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * Clamp Zoom-Level auf [MIN_ZOOM, MAX_ZOOM]. NaN → MIN_ZOOM.
 */
export function clampZoom(zoom: number): number {
  return clampNumber(zoom, MIN_ZOOM, MAX_ZOOM);
}

/**
 * Maximaler scrollOffset gegeben Total und Zoom — verhindert dass das Ende
 * des Tracks innerhalb des Viewports erscheint (kein leerer Rand).
 *
 * Wenn totalSamples ≤ 0 oder zoom ≤ 0: 0.
 */
export function computeMaxScrollOffset(totalSamples: number, zoom: number): number {
  if (!Number.isFinite(totalSamples) || totalSamples <= 0) return 0;
  const z = clampZoom(zoom);
  const visible = totalSamples / z;
  const max = totalSamples - visible;
  return Math.max(0, Math.floor(max));
}

/**
 * Clamp scrollOffset gegen totalSamples + zoom. Garantiert dass der Viewport
 * niemals über das Track-Ende hinaus ragt.
 */
export function clampScrollOffset(
  offset: number,
  totalSamples: number,
  zoom: number,
): number {
  const max = computeMaxScrollOffset(totalSamples, zoom);
  return clampNumber(offset, 0, max);
}

/**
 * Berechnet welche Samples gerade sichtbar sind + samples-per-pixel.
 *
 * @param viewportWidthPx Canvas-Breite in CSS-Pixeln. Falls 0/negativ wird 1 angenommen.
 */
export function computeViewport(
  totalSamples: number,
  state: ZoomState,
  viewportWidthPx: number,
): ViewportInfo {
  const safeTotal = Math.max(0, Math.floor(totalSamples) || 0);
  const safeWidth = Math.max(1, Math.floor(viewportWidthPx) || 1);
  const zoom = clampZoom(state.zoomLevel);

  if (safeTotal === 0) {
    return {
      visibleSamples: 0,
      firstVisibleSample: 0,
      lastVisibleSample: 0,
      samplesPerPixel: 0,
    };
  }

  const visibleSamples = Math.max(1, Math.floor(safeTotal / zoom));
  const first = clampScrollOffset(state.scrollOffset, safeTotal, zoom);
  const last = Math.min(safeTotal, first + visibleSamples);
  const spp = visibleSamples / safeWidth;

  return {
    visibleSamples,
    firstVisibleSample: first,
    lastVisibleSample: last,
    samplesPerPixel: spp,
  };
}

/**
 * Zoom-In/Out centered auf eine Mauseposition. Liefert neuen ZoomState so dass
 * der Sample-Index unter dem Cursor an derselben Pixel-Position bleibt.
 *
 * @param state          aktueller Zoom + Scroll
 * @param totalSamples   Track-Länge
 * @param viewportWidthPx Viewport-Breite (px)
 * @param mouseXPx       Maus-X relativ zum Canvas (0..viewportWidthPx)
 * @param wheelDeltaY    >0 = zoom out, <0 = zoom in (Chrome-Konvention)
 * @param stepFactor     Multiplikator je Tick (default ZOOM_STEP)
 */
export function zoomAtPoint(
  state: ZoomState,
  totalSamples: number,
  viewportWidthPx: number,
  mouseXPx: number,
  wheelDeltaY: number,
  stepFactor: number = ZOOM_STEP,
): ZoomState {
  if (!Number.isFinite(totalSamples) || totalSamples <= 0) {
    return { zoomLevel: MIN_ZOOM, scrollOffset: 0 };
  }
  const safeWidth = Math.max(1, viewportWidthPx);
  const factor = wheelDeltaY < 0 ? stepFactor : 1 / stepFactor;
  const oldZoom = clampZoom(state.zoomLevel);
  const newZoom = clampZoom(oldZoom * factor);

  // Sample unter der Maus berechnen (vor dem Zoom)
  const oldVisible = totalSamples / oldZoom;
  const safeMouseX = clampNumber(mouseXPx, 0, safeWidth);
  const mouseSample = state.scrollOffset + (safeMouseX / safeWidth) * oldVisible;

  // Neuer Scroll so dass mouseSample an derselben mouseX bleibt
  const newVisible = totalSamples / newZoom;
  const rawScroll = mouseSample - (safeMouseX / safeWidth) * newVisible;
  const newScroll = clampScrollOffset(Math.round(rawScroll), totalSamples, newZoom);

  return { zoomLevel: newZoom, scrollOffset: newScroll };
}

/**
 * Scroll-Delta in Samples anwenden (drag/keyboard). Clamped gegen bounds.
 */
export function scrollBy(
  state: ZoomState,
  totalSamples: number,
  deltaSamples: number,
): ZoomState {
  return {
    zoomLevel: state.zoomLevel,
    scrollOffset: clampScrollOffset(
      state.scrollOffset + deltaSamples,
      totalSamples,
      state.zoomLevel,
    ),
  };
}

/**
 * Pixel-X auf Canvas → Sample-Index. Liefert ein gerundetes Integer.
 *
 * Garantiert: für x=0 → firstVisibleSample, für x=width → lastVisibleSample-1.
 */
export function pixelToSample(
  pixelX: number,
  state: ZoomState,
  totalSamples: number,
  viewportWidthPx: number,
): number {
  if (!Number.isFinite(totalSamples) || totalSamples <= 0) return 0;
  const safeWidth = Math.max(1, viewportWidthPx);
  const safeX = clampNumber(pixelX, 0, safeWidth);
  const zoom = clampZoom(state.zoomLevel);
  const visible = totalSamples / zoom;
  const first = clampScrollOffset(state.scrollOffset, totalSamples, zoom);
  const sample = first + (safeX / safeWidth) * visible;
  return clampNumber(Math.floor(sample), 0, Math.max(0, totalSamples - 1));
}

/**
 * Sample-Index → Pixel-X im aktuellen Viewport. Liefert NaN-frei +
 * clamped-floor — wenn sample außerhalb des Viewports liegt, wird die
 * X-Position trotzdem (extrapoliert) zurückgegeben (Caller filtert).
 */
export function sampleToPixel(
  sample: number,
  state: ZoomState,
  totalSamples: number,
  viewportWidthPx: number,
): number {
  if (!Number.isFinite(totalSamples) || totalSamples <= 0) return 0;
  const safeWidth = Math.max(1, viewportWidthPx);
  const zoom = clampZoom(state.zoomLevel);
  const visible = totalSamples / zoom;
  if (visible <= 0) return 0;
  const first = clampScrollOffset(state.scrollOffset, totalSamples, zoom);
  const x = ((sample - first) / visible) * safeWidth;
  return x;
}

/**
 * Prüft ob ein Sample im aktuellen Viewport sichtbar ist (für Render-Skip).
 */
export function isSampleVisible(
  sample: number,
  state: ZoomState,
  totalSamples: number,
): boolean {
  if (!Number.isFinite(sample) || sample < 0) return false;
  const vp = computeViewport(totalSamples, state, 1);
  return sample >= vp.firstVisibleSample && sample < vp.lastVisibleSample;
}

// ─── Sample-Formatting (Zeit-Display) ────────────────────────────────────────

/**
 * Formatiert einen Sample-Index als "MM:SS.mmm" String.
 * Defensive bei NaN/negative → "00:00.000".
 *
 * @param sampleIndex Sample-Position (0..N)
 * @param sampleRate  Hz (default 44100)
 */
export function formatSampleTime(sampleIndex: number, sampleRate = 44100): string {
  if (!Number.isFinite(sampleIndex) || sampleIndex < 0) return "00:00.000";
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return "00:00.000";
  const totalSec = sampleIndex / sampleRate;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec) % 60;
  const ms = Math.round((totalSec - Math.floor(totalSec)) * 1000);
  // Edge: rounding overflow 999→1000
  const carry = ms >= 1000 ? 1 : 0;
  const finalMs = ms >= 1000 ? 0 : ms;
  const finalSec = sec + carry;
  const finalSecOverflow = finalSec >= 60 ? finalSec - 60 : finalSec;
  const finalMin = finalSec >= 60 ? min + 1 : min;
  return (
    String(finalMin).padStart(2, "0") +
    ":" +
    String(finalSecOverflow).padStart(2, "0") +
    "." +
    String(finalMs).padStart(3, "0")
  );
}

/**
 * Format-Variante "Zoom: 5.2×" für die UI-Anzeige.
 */
export function formatZoomLevel(zoom: number): string {
  const z = clampZoom(zoom);
  if (z < 10) return "Zoom: " + z.toFixed(1) + "×";
  return "Zoom: " + Math.round(z) + "×";
}

// ─── Zero-Crossing-Snap ──────────────────────────────────────────────────────

/**
 * Sucht den nächsten Zero-Crossing (Vorzeichenwechsel) innerhalb eines Fensters
 * um den gegebenen Sample-Index. Liefert den nächst-gelegenen Index zurück.
 *
 * Wenn KEIN Zero-Crossing im Fenster gefunden wird, liefert die Funktion
 * den ursprünglichen Sample-Index unverändert (kein "best effort"-Snap weiter).
 *
 * Defensive bei null/empty/out-of-bounds Inputs → input passthrough.
 */
export function snapToZeroCrossing(
  channelData: Float32Array | null | undefined,
  sampleIndex: number,
  windowSize: number = DEFAULT_ZERO_CROSS_WINDOW,
): number {
  if (!channelData || channelData.length === 0) return sampleIndex;
  if (!Number.isFinite(sampleIndex)) return 0;
  const idx = Math.max(0, Math.min(channelData.length - 1, Math.floor(sampleIndex)));
  const win = Math.max(1, Math.floor(windowSize));

  let bestIdx = idx;
  let bestDist = Infinity;

  const lo = Math.max(1, idx - win);
  const hi = Math.min(channelData.length - 1, idx + win);

  for (let i = lo; i <= hi; i++) {
    const prev = channelData[i - 1];
    const cur = channelData[i];
    // Sign change OR exact zero hit
    if ((prev <= 0 && cur > 0) || (prev >= 0 && cur < 0) || cur === 0) {
      const dist = Math.abs(i - idx);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
  }

  return bestIdx;
}

// ─── Peak-Cache (Performance bei niedrigem Zoom) ─────────────────────────────

/**
 * Reduziert ein Float32-Channel auf `numPeaks` absolute Peak-Werte. Idee:
 * statt bei jedem Render-Frame über N Millionen Samples zu loopen, baut
 * der Caller diesen Cache EINMAL und das Render-Loop liest nur Slice-Pos.
 *
 * Defensive: numPeaks ≤ 0 oder empty input → leeres Float32Array.
 */
export function buildPeakCache(
  channelData: Float32Array | null | undefined,
  numPeaks: number,
): Float32Array {
  if (!channelData || channelData.length === 0 || numPeaks <= 0) {
    return new Float32Array(0);
  }
  const out = new Float32Array(numPeaks);
  const blockSize = Math.max(1, Math.floor(channelData.length / numPeaks));
  for (let i = 0; i < numPeaks; i++) {
    const start = i * blockSize;
    const end = Math.min(channelData.length, start + blockSize);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(channelData[j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
  }
  return out;
}

/**
 * Liefert für eine sichtbare Viewport-Range das Slice aus dem Peak-Cache.
 * Wird vom Renderer im "peak-bars"-Modus gerufen (samplesPerPixel ≥ 1).
 *
 * Defensive: leerer Cache oder out-of-range → leeres Array.
 */
export function getVisiblePeaks(
  peakCache: Float32Array,
  totalSamples: number,
  state: ZoomState,
): Float32Array {
  if (peakCache.length === 0 || totalSamples <= 0) return new Float32Array(0);
  const zoom = clampZoom(state.zoomLevel);
  const first = clampScrollOffset(state.scrollOffset, totalSamples, zoom);
  const visible = totalSamples / zoom;
  const startIdx = Math.floor((first / totalSamples) * peakCache.length);
  const endIdx = Math.min(
    peakCache.length,
    Math.ceil(((first + visible) / totalSamples) * peakCache.length),
  );
  return peakCache.slice(startIdx, endIdx);
}

// ─── Loop-Point-Helpers ──────────────────────────────────────────────────────

export interface LoopPoints {
  loopStart: number; // sample
  loopEnd: number;   // sample
}

/**
 * Setzt Loop-Start defensive — clamped gegen [0, loopEnd - 1] und totalSamples.
 */
export function setLoopStart(
  current: LoopPoints,
  newStart: number,
  totalSamples: number,
): LoopPoints {
  const safeStart = clampNumber(
    Math.floor(newStart),
    0,
    Math.max(0, current.loopEnd - 1),
  );
  return {
    loopStart: Math.min(safeStart, Math.max(0, totalSamples - 1)),
    loopEnd: current.loopEnd,
  };
}

/**
 * Setzt Loop-End defensive — clamped gegen [loopStart + 1, totalSamples].
 */
export function setLoopEnd(
  current: LoopPoints,
  newEnd: number,
  totalSamples: number,
): LoopPoints {
  const safeEnd = clampNumber(
    Math.floor(newEnd),
    current.loopStart + 1,
    Math.max(current.loopStart + 1, totalSamples),
  );
  return {
    loopStart: current.loopStart,
    loopEnd: safeEnd,
  };
}

/**
 * Wendet snapToZeroCrossing auf beide Loop-Marker an. Caller ruft das auf
 * Drag-Drop (Mouse-Up), nicht während Drag — damit der Marker nicht "springt".
 */
export function snapLoopPointsToZeroCrossing(
  current: LoopPoints,
  channelData: Float32Array | null | undefined,
  windowSize: number = DEFAULT_ZERO_CROSS_WINDOW,
): LoopPoints {
  const snappedStart = snapToZeroCrossing(channelData, current.loopStart, windowSize);
  const snappedEnd = snapToZeroCrossing(channelData, current.loopEnd, windowSize);
  // Defensive: snapped-end darf NICHT vor snapped-start liegen
  if (snappedEnd <= snappedStart) {
    return current; // No-op statt invalid
  }
  return { loopStart: snappedStart, loopEnd: snappedEnd };
}
