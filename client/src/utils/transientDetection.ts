/**
 * transientDetection.ts – Amplitude-Onset-Detection
 * Findet Stellen im Audio-Buffer wo die Amplitude steil ansteigt.
 * Phase 3: Sample Slicer
 */

export interface TransientMarker {
  sampleOffset: number;  // Frame-Position im AudioBuffer
  timeSeconds: number;
  strength: number;      // 0–1, Stärke des Transienten (delta der Amplitude)
}

/**
 * Erkennt Transienten (Einschwingvorgänge) in einem AudioBuffer.
 *
 * @param buffer     Web-Audio AudioBuffer (oder simuliertes Objekt mit getChannelData)
 * @param threshold  Minimaler Amplituden-Anstieg pro Sample (default 0.15)
 * @param minGapMs   Mindestabstand zwischen zwei Transienten in Millisekunden (default 50)
 */
export function detectTransients(
  buffer: { getChannelData: (channel: number) => Float32Array; sampleRate: number },
  threshold = 0.15,
  minGapMs = 50
): TransientMarker[] {
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const minGapSamples = (minGapMs / 1000) * sampleRate;
  const markers: TransientMarker[] = [];
  let prevAmplitude = 0;
  let lastMarkerOffset = -minGapSamples;

  for (let i = 1; i < channelData.length; i++) {
    const amplitude = Math.abs(channelData[i]);
    const delta = amplitude - prevAmplitude;
    if (delta > threshold && (i - lastMarkerOffset) > minGapSamples) {
      markers.push({
        sampleOffset: i,
        timeSeconds: i / sampleRate,
        strength: Math.min(1, delta),
      });
      lastMarkerOffset = i;
    }
    prevAmplitude = amplitude;
  }
  return markers;
}
