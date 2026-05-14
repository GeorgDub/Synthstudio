/**
 * Synthstudio – BPM- und Onset-Detection (pure Utility)
 *
 * Extrahiert aus client/src/workers/audioAnalysis.worker.ts und
 * client/src/hooks/useBpmDetection.ts. Reine Float32Array-Logik ohne
 * Browser-/Worker-API-Abhängigkeiten – damit Node-testbar.
 *
 * Algorithmus: Energie-basierte Onset-Erkennung in 10ms-Fenstern,
 * Median-Intervall der Onsets liefert das BPM.
 */

export interface BpmResult {
  bpm: number;
  confidence: number;
}

export interface OnsetDetectionOptions {
  /** Fenster-Größe in Sekunden (Default 0.01 = 10ms). */
  windowSeconds?: number;
  /** Energie muss diesen Faktor über dem lokalen Mean liegen (Default 1.5). */
  threshold?: number;
  /** Wie viele Sample-Fenster werden für den lokalen Mean betrachtet (Default 20). */
  meanWindow?: number;
  /** Mindestabstand zwischen Onsets in Fenstern (Default 5). */
  minSpacing?: number;
  /** Maximale Analyse-Länge in Sekunden (Default: gesamte Buffer). */
  maxSeconds?: number;
}

/**
 * Erkennt Onsets (Hits) in einem Audio-Buffer und liefert deren Zeitpunkte
 * in Sekunden ab Buffer-Anfang.
 */
export function detectOnsets(
  channelData: Float32Array,
  sampleRate: number,
  options: OnsetDetectionOptions = {}
): number[] {
  const windowSeconds = options.windowSeconds ?? 0.01;
  const threshold = options.threshold ?? 1.5;
  const meanWindow = options.meanWindow ?? 20;
  const minSpacing = options.minSpacing ?? 5;
  const maxSamples =
    options.maxSeconds != null
      ? Math.min(channelData.length, Math.floor(options.maxSeconds * sampleRate))
      : channelData.length;

  const windowSize = Math.max(1, Math.floor(sampleRate * windowSeconds));
  const energies: number[] = [];

  for (let i = 0; i + windowSize <= maxSamples; i += windowSize) {
    let energy = 0;
    for (let j = i; j < i + windowSize; j++) {
      energy += channelData[j] * channelData[j];
    }
    energies.push(energy / windowSize);
  }

  const onsets: number[] = [];
  for (let i = 1; i < energies.length - 1; i++) {
    const lo = Math.max(0, i - meanWindow);
    let sum = 0;
    for (let k = lo; k < i; k++) sum += energies[k];
    const localMean = sum / Math.max(1, i - lo);

    if (energies[i] > localMean * threshold && energies[i] > energies[i - 1]) {
      onsets.push((i * windowSize) / sampleRate);
      i += minSpacing;
    }
  }

  return onsets;
}

/**
 * Schätzt das BPM eines Audio-Buffers über das Median-Intervall der Onsets.
 * Liefert immer ein Ergebnis (Fallback 120 BPM bei niedriger Konfidenz).
 */
export function detectBpm(
  channelData: Float32Array,
  sampleRate: number,
  options: OnsetDetectionOptions = {}
): BpmResult {
  const onsets = detectOnsets(channelData, sampleRate, options);

  if (onsets.length < 4) {
    return { bpm: 120, confidence: 0 };
  }

  const intervalsMs: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const ms = (onsets[i] - onsets[i - 1]) * 1000;
    if (ms > 200 && ms < 2000) intervalsMs.push(ms);
  }

  if (intervalsMs.length === 0) {
    return { bpm: 120, confidence: 0 };
  }

  intervalsMs.sort((a, b) => a - b);
  const median = intervalsMs[Math.floor(intervalsMs.length / 2)];
  let bpm = 60000 / median;
  while (bpm < 60) bpm *= 2;
  while (bpm > 200) bpm /= 2;

  const mean = intervalsMs.reduce((a, b) => a + b, 0) / intervalsMs.length;
  const variance =
    intervalsMs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / intervalsMs.length;
  const stdDev = Math.sqrt(variance);
  const confidence = mean > 0 ? Math.max(0, Math.min(1, 1 - stdDev / mean)) : 0;

  return { bpm: Math.round(bpm), confidence };
}

/**
 * Hilfsfunktion: Erzeugt einen Test-Buffer mit periodischen Klick-Onsets bei
 * gegebenem BPM. Für Tests + Demo-Zwecke.
 */
export function generateClickTrack(
  bpm: number,
  durationSeconds: number,
  sampleRate = 44100
): Float32Array {
  const totalSamples = Math.floor(durationSeconds * sampleRate);
  const data = new Float32Array(totalSamples);
  const interval = (60 / bpm) * sampleRate;
  const clickLength = Math.floor(sampleRate * 0.005); // 5ms-Klick

  for (let t = 0; t < totalSamples; t += interval) {
    const start = Math.floor(t);
    for (let j = 0; j < clickLength && start + j < totalSamples; j++) {
      // Decaying click
      data[start + j] = (1 - j / clickLength) * (j % 2 === 0 ? 1 : -1);
    }
  }
  return data;
}
