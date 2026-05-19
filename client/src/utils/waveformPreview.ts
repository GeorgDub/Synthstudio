/**
 * Synthstudio – waveformPreview.ts  (v3.130.0)
 *
 * Pure helpers für Mini-Waveform-Previews im Step-Grid (DrumMachine).
 * Berechnet ein verdichtetes Amplitude-Envelope (max-abs-pro-Segment) aus
 * einem AudioBuffer, damit jeder Step-Cell eine winzige Wave-Vorschau des
 * zugewiesenen Samples zeigen kann.
 *
 * Public API:
 *  - computeWaveformPreview(buffer, width=32) → number[] (0..1, length=width)
 *  - getOrComputeWaveform(sampleId, buffer)   → number[] (cached)
 *  - invalidateWaveform(sampleId)             → void
 *  - clearWaveformCache()                     → void
 *  - waveformCacheSize()                      → number
 *
 * Cache: LRU mit max. WAVEFORM_CACHE_MAX_ENTRIES (64) Einträgen,
 * in-memory only (NICHT persistiert — Waveform regeneriert beim Reload).
 *
 * Die Helpers sind DOM-frei und Node-testbar (AudioBufferLike-Interface).
 */

/** Default-Width für Step-Cell-Previews (32 Bars, gut sichtbar). */
export const WAVEFORM_PREVIEW_DEFAULT_WIDTH = 32;

/** LRU-Cache-Cap. */
export const WAVEFORM_CACHE_MAX_ENTRIES = 64;

/**
 * Minimales Interface, das computeWaveformPreview von einem AudioBuffer
 * braucht. Erlaubt Mocks in Node-Tests (kein DOM-AudioBuffer nötig).
 */
export interface AudioBufferLike {
  numberOfChannels: number;
  length: number;
  /** Liefert die Samples für einen Kanal (mono = 0). */
  getChannelData(channel: number): Float32Array;
}

/**
 * Berechnet ein verdichtetes Amplitude-Envelope.
 *
 * Algorithmus:
 *  - Wir teilen den Buffer in `width` gleich grosse Segmente.
 *  - Pro Segment: max(|sample|) → ergibt einen Peak-Wert 0..1.
 *  - Mono: ersten Kanal nehmen.
 *  - Stereo: pro Sample max(|L|, |R|) — schnell & visuell konsistent.
 *
 * Defensive:
 *  - Leerer Buffer (length=0)            → Array<width> aus Nullen.
 *  - width <= 0                          → []
 *  - numberOfChannels <= 0               → Array<width> aus Nullen.
 *  - NaN/Infinity in Samples             → werden als 0 behandelt.
 *  - Werte > 1 oder < -1                 → werden auf [0,1] geclampt nach |abs|.
 */
export function computeWaveformPreview(
  buffer: AudioBufferLike,
  width: number = WAVEFORM_PREVIEW_DEFAULT_WIDTH,
): number[] {
  if (!Number.isFinite(width) || width <= 0) return [];
  const w = Math.max(1, Math.floor(width));
  const len = buffer.length | 0;
  if (len <= 0 || buffer.numberOfChannels <= 0) {
    return new Array<number>(w).fill(0);
  }

  // Channels einsammeln (mono = 1 Kanal, stereo = 2, 5.1 = 6 …). Wir nehmen
  // bis zu 2 Kanäle, das reicht für Drum-Samples vollkommen.
  const chCount = Math.min(2, buffer.numberOfChannels);
  const chans: Float32Array[] = [];
  for (let c = 0; c < chCount; c++) {
    chans.push(buffer.getChannelData(c));
  }

  const out = new Array<number>(w);
  const segLen = len / w; // float — wir nutzen floor/ceil pro Segment
  for (let i = 0; i < w; i++) {
    const start = Math.floor(i * segLen);
    const end = Math.min(len, Math.floor((i + 1) * segLen));
    let peak = 0;
    for (let j = start; j < end; j++) {
      let v = 0;
      for (let c = 0; c < chCount; c++) {
        const s = chans[c][j];
        if (!Number.isFinite(s)) continue;
        const abs = s < 0 ? -s : s;
        if (abs > v) v = abs;
      }
      if (v > peak) peak = v;
    }
    if (peak > 1) peak = 1;
    out[i] = peak;
  }
  return out;
}

// ─── In-Memory LRU-Cache ─────────────────────────────────────────────────────

type CacheKey = string; // composite: `${sampleId}|${width}`

const _cache = new Map<CacheKey, number[]>();

function _key(sampleId: string, width: number): CacheKey {
  return `${sampleId}|${width}`;
}

function _touch(key: CacheKey, value: number[]): void {
  // LRU-Order: erst delete, dann re-set → wandert ans Ende.
  _cache.delete(key);
  _cache.set(key, value);
  if (_cache.size > WAVEFORM_CACHE_MAX_ENTRIES) {
    // Ältesten Eintrag (erster Key) entfernen.
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
}

/**
 * Liefert das gecachte Envelope für ein Sample oder berechnet & cached es.
 * Falls `buffer` null/undefined und nichts gecached ist, wird undefined
 * zurückgegeben (Caller rendert dann nichts).
 */
export function getOrComputeWaveform(
  sampleId: string,
  buffer: AudioBufferLike | null | undefined,
  width: number = WAVEFORM_PREVIEW_DEFAULT_WIDTH,
): number[] | undefined {
  if (typeof sampleId !== "string" || sampleId.length === 0) return undefined;
  const key = _key(sampleId, width);
  const cached = _cache.get(key);
  if (cached !== undefined) {
    // LRU: ans Ende
    _cache.delete(key);
    _cache.set(key, cached);
    return cached;
  }
  if (!buffer) return undefined;
  const env = computeWaveformPreview(buffer, width);
  _touch(key, env);
  return env;
}

/**
 * Invalidate alle Cache-Einträge für eine bestimmte sampleId
 * (alle Widths). Wird aufgerufen, wenn der zugewiesene Sample-Pfad
 * sich ändert oder transformiert wurde.
 */
export function invalidateWaveform(sampleId: string): void {
  if (typeof sampleId !== "string" || sampleId.length === 0) return;
  const prefix = `${sampleId}|`;
  // Map.keys ist iterator-stable während delete — sammeln & löschen.
  const toDelete: CacheKey[] = [];
  for (const k of _cache.keys()) {
    if (k.startsWith(prefix)) toDelete.push(k);
  }
  toDelete.forEach(k => _cache.delete(k));
}

/** Gesamten Cache leeren (z.B. bei Project-Reset). */
export function clearWaveformCache(): void {
  _cache.clear();
}

/** Aktuelle Anzahl Cache-Einträge — nützlich für Tests & Debug-UI. */
export function waveformCacheSize(): number {
  return _cache.size;
}

/** Test-Helper: cached-Eintrag direkt setzen (umgeht Compute). */
export function __setCachedWaveformForTests(
  sampleId: string,
  env: number[],
  width: number = WAVEFORM_PREVIEW_DEFAULT_WIDTH,
): void {
  _touch(_key(sampleId, width), env);
}
