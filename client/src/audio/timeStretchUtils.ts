/**
 * Synthstudio – timeStretchUtils.ts
 *
 * Offline OLA (Overlap-Add) Time-Stretch.
 * Erstellt einen neuen AudioBuffer der zeitlich gestreckt/komprimiert ist,
 * ohne die Tonhöhe zu ändern (Pitch-Preserving).
 *
 * Einschränkungen:
 *  - Nur Mono oder Stereo
 *  - Ratio 0.25–4.0
 *  - Einfaches OLA ohne Ähnlichkeits-Suche (kein echtes WSOLA) – für kurze Samples
 */

const GRAIN_SIZE = 2048;
const HOP_SIZE = 512;

function makeHann(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

/**
 * Streckt einen AudioBuffer zeitlich um den Faktor `ratio`.
 * ratio > 1 = länger (langsamer), ratio < 1 = kürzer (schneller).
 * Tonhöhe bleibt unverändert.
 */
export function timeStretchBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  ratio: number,
): AudioBuffer {
  ratio = Math.max(0.25, Math.min(4.0, ratio));
  if (Math.abs(ratio - 1.0) < 0.01) return source;

  const sampleRate = source.sampleRate;
  const channels = source.numberOfChannels;
  const inLength = source.length;
  const outLength = Math.round(inLength * ratio);
  const hopIn = Math.max(1, Math.round(HOP_SIZE * ratio));
  const hopOut = HOP_SIZE;
  const window = makeHann(GRAIN_SIZE);

  const outBuffer = ctx.createBuffer(channels, outLength, sampleRate);

  for (let c = 0; c < channels; c++) {
    const inData = source.getChannelData(c);
    const outData = outBuffer.getChannelData(c);

    let inPos = 0;
    let outPos = 0;

    while (outPos < outLength) {
      // Grain aus Eingang lesen + Hann-Fenster anwenden
      for (let j = 0; j < GRAIN_SIZE; j++) {
        const inIdx = inPos + j;
        const outIdx = outPos + j;
        if (outIdx >= outLength) break;
        const sample = inIdx < inLength ? inData[inIdx] : 0;
        outData[outIdx] += sample * window[j];
      }
      inPos += hopIn;
      outPos += hopOut;
      if (inPos >= inLength) inPos = inPos % inLength; // Loop für kurze Samples
    }

    // Normalisierung (OLA kann Werte > 1 erzeugen durch Überlappung)
    let maxVal = 0;
    for (let i = 0; i < outLength; i++) {
      if (Math.abs(outData[i]) > maxVal) maxVal = Math.abs(outData[i]);
    }
    if (maxVal > 1.0) {
      const norm = 1.0 / maxVal;
      for (let i = 0; i < outLength; i++) outData[i] *= norm;
    }
  }

  return outBuffer;
}

/** Cache für gestreckte Buffer. Key: `${url}::${ratio}` */
const stretchCache = new Map<string, AudioBuffer>();

export function getCachedStretchBuffer(
  ctx: BaseAudioContext,
  url: string,
  source: AudioBuffer,
  ratio: number,
): AudioBuffer {
  const key = `${url}::${ratio.toFixed(3)}`;
  const cached = stretchCache.get(key);
  if (cached) return cached;
  const stretched = timeStretchBuffer(ctx, source, ratio);
  stretchCache.set(key, stretched);
  return stretched;
}

export function clearStretchCache(): void {
  stretchCache.clear();
}
