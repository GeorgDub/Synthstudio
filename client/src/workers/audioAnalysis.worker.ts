/**
 * Synthstudio – Audio-Analyse Web Worker (Browser)
 *
 * Analysiert Audio-Dateien in einem separaten Thread ohne den UI-Thread zu blockieren.
 * Nutzt die Web Audio API (OfflineAudioContext) für die Dekodierung.
 *
 * Kommunikation:
 * - Eingehend:  { type: 'analyze', id: string, audioData: ArrayBuffer, numPeaks: number }
 *              { type: 'analyzeBpm', id: string, audioData: ArrayBuffer }
 * - Ausgehend:  { type: 'result', id: string, peaks: number[], duration: number, ... }
 *              { type: 'bpmResult', id: string, bpm: number, confidence: number }
 *              { type: 'error', id: string, message: string }
 *              { type: 'progress', id: string, percentage: number }
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

interface AnalyzeRequest {
  type: "analyze";
  id: string;
  audioData: ArrayBuffer;
  numPeaks: number;
}

interface BpmRequest {
  type: "analyzeBpm";
  id: string;
  audioData: ArrayBuffer;
}

type WorkerRequest = AnalyzeRequest | BpmRequest;

// ─── Waveform-Analyse ─────────────────────────────────────────────────────────

async function analyzeWaveform(
  audioData: ArrayBuffer,
  numPeaks: number
): Promise<{
  peaks: number[];
  duration: number;
  sampleRate: number;
  channels: number;
}> {
  // OfflineAudioContext für Dekodierung ohne Playback
  const audioContext = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));

  const channelData = audioBuffer.getChannelData(0);
  const totalSamples = channelData.length;
  const samplesPerPeak = Math.floor(totalSamples / numPeaks);

  const peaks: number[] = new Array(numPeaks);

  for (let i = 0; i < numPeaks; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, totalSamples);
    let max = 0;

    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }

    peaks[i] = max;
  }

  return {
    peaks,
    duration: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
    channels: audioBuffer.numberOfChannels,
  };
}

// ─── BPM-Detection ────────────────────────────────────────────────────────────

/**
 * BPM-Detection via Onset-Erkennung und Auto-Korrelation.
 * Algorithmus: Energy-basierte Onset-Erkennung → Intervall-Histogramm → BPM
 */
async function detectBpm(
  audioData: ArrayBuffer
): Promise<{ bpm: number; confidence: number }> {
  const audioContext = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;

  // Energie in 10ms-Fenstern berechnen
  const windowSize = Math.floor(sampleRate * 0.01); // 10ms
  const energies: number[] = [];

  for (let i = 0; i < channelData.length - windowSize; i += windowSize) {
    let energy = 0;
    for (let j = i; j < i + windowSize; j++) {
      energy += channelData[j] * channelData[j];
    }
    energies.push(energy / windowSize);
  }

  // Onset-Erkennung: Energie-Anstieg über Schwellwert
  const onsets: number[] = [];
  const threshold = 1.5; // Energie muss 1.5x über dem Durchschnitt liegen

  for (let i = 1; i < energies.length - 1; i++) {
    const localMean =
      energies.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) /
      Math.min(20, i);

    if (energies[i] > localMean * threshold && energies[i] > energies[i - 1]) {
      onsets.push(i * windowSize * 1000 / sampleRate); // In Millisekunden
      i += 5; // Mindestabstand zwischen Onsets
    }
  }

  if (onsets.length < 4) {
    return { bpm: 120, confidence: 0 }; // Fallback
  }

  // Intervall-Histogramm
  const intervals: number[] = [];
  for (let i = 1; i < onsets.length; i++) {
    const interval = onsets[i] - onsets[i - 1];
    if (interval > 200 && interval < 2000) { // 30–300 BPM
      intervals.push(interval);
    }
  }

  if (intervals.length === 0) {
    return { bpm: 120, confidence: 0 };
  }

  // Median-Intervall
  intervals.sort((a, b) => a - b);
  const medianInterval = intervals[Math.floor(intervals.length / 2)];

  // BPM aus Intervall berechnen
  let bpm = 60000 / medianInterval;

  // BPM in sinnvollen Bereich bringen (60–200)
  while (bpm < 60) bpm *= 2;
  while (bpm > 200) bpm /= 2;

  // Konfidenz: Wie konsistent sind die Intervalle?
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance =
    intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  const confidence = Math.max(0, Math.min(1, 1 - stdDev / mean));

  return { bpm: Math.round(bpm), confidence };
}

// ─── Message-Handler ──────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, id } = event.data;

  try {
    if (type === "analyze") {
      const { audioData, numPeaks } = event.data as AnalyzeRequest;

      self.postMessage({ type: "progress", id, percentage: 10 });

      const result = await analyzeWaveform(audioData, numPeaks);

      self.postMessage({ type: "progress", id, percentage: 90 });

      self.postMessage({
        type: "result",
        id,
        ...result,
      });
    } else if (type === "analyzeBpm") {
      const { audioData } = event.data as BpmRequest;

      self.postMessage({ type: "progress", id, percentage: 20 });

      const result = await detectBpm(audioData);

      self.postMessage({
        type: "bpmResult",
        id,
        ...result,
      });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
