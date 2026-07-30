/**
 * Synthstudio – audioEdit.ts
 *
 * Audacity-ähnliche Audio-Bearbeitungs-Utilities.
 * Reine Funktionen auf AudioBuffer-Objekten.
 */

/** Erstellt einen neuen AudioBuffer aus einem Ausschnitt (Sekunden). */
export function trimBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number,
): AudioBuffer {
  const sampleRate = source.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample   = Math.min(source.length, Math.floor(endSec * sampleRate));
  const length = Math.max(1, endSample - startSample);

  const out = ctx.createBuffer(source.numberOfChannels, length, sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const inData = source.getChannelData(c);
    const outData = out.getChannelData(c);
    for (let i = 0; i < length; i++) outData[i] = inData[startSample + i];
  }
  return out;
}

/** Kehrt einen AudioBuffer um. */
export function reverseBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
): AudioBuffer {
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const inData = source.getChannelData(c);
    const outData = out.getChannelData(c);
    for (let i = 0; i < source.length; i++) {
      outData[i] = inData[source.length - 1 - i];
    }
  }
  return out;
}

/** Normalisiert auf Peak = 1.0 (oder targetPeak). */
export function normalizeBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  targetPeak = 1.0,
): AudioBuffer {
  // Peak finden (über alle Kanäle)
  let peak = 0;
  for (let c = 0; c < source.numberOfChannels; c++) {
    const data = source.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  if (peak === 0) return source; // Stille

  const gain = targetPeak / peak;
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const inData  = source.getChannelData(c);
    const outData = out.getChannelData(c);
    for (let i = 0; i < source.length; i++) outData[i] = inData[i] * gain;
  }
  return out;
}

/** Wendet Fade-In von 0→1 über die ersten `durationSec` Sekunden an. */
export function fadeIn(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  durationSec: number,
): AudioBuffer {
  const fadeSamples = Math.min(source.length, Math.floor(durationSec * source.sampleRate));
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const inData  = source.getChannelData(c);
    const outData = out.getChannelData(c);
    for (let i = 0; i < source.length; i++) {
      const gain = i < fadeSamples ? i / fadeSamples : 1;
      outData[i] = inData[i] * gain;
    }
  }
  return out;
}

/** Wendet Fade-Out von 1→0 über die letzten `durationSec` Sekunden an. */
export function fadeOut(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  durationSec: number,
): AudioBuffer {
  const fadeSamples = Math.min(source.length, Math.floor(durationSec * source.sampleRate));
  const fadeStart = source.length - fadeSamples;
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const inData  = source.getChannelData(c);
    const outData = out.getChannelData(c);
    for (let i = 0; i < source.length; i++) {
      const gain = i >= fadeStart ? (source.length - i) / fadeSamples : 1;
      outData[i] = inData[i] * gain;
    }
  }
  return out;
}

/** Stille einfügen ab `atSec` für `durationSec` Sekunden (verlängert den Buffer). */
export function insertSilence(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  atSec: number,
  durationSec: number,
): AudioBuffer {
  const sampleRate = source.sampleRate;
  const insertSample  = Math.max(0, Math.min(source.length, Math.floor(atSec * sampleRate)));
  const silenceLength = Math.max(0, Math.floor(durationSec * sampleRate));
  const newLength = source.length + silenceLength;

  const out = ctx.createBuffer(source.numberOfChannels, newLength, sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const inData  = source.getChannelData(c);
    const outData = out.getChannelData(c);
    // Vor Insert-Punkt
    for (let i = 0; i < insertSample; i++) outData[i] = inData[i];
    // Stille (bereits 0 initialisiert)
    // Nach Insert-Punkt
    for (let i = insertSample; i < source.length; i++) {
      outData[i + silenceLength] = inData[i];
    }
  }
  return out;
}

/** Lautstärke (Gain) auf gesamten Buffer anwenden. */
export function applyGain(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  gainFactor: number,
): AudioBuffer {
  const out = ctx.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let c = 0; c < source.numberOfChannels; c++) {
    const inData  = source.getChannelData(c);
    const outData = out.getChannelData(c);
    for (let i = 0; i < source.length; i++) outData[i] = inData[i] * gainFactor;
  }
  return out;
}

/** Schneidet einen Ausschnitt heraus (Cut). Gibt das *übrige* Audio zurück. */
export function cutSelection(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  startSec: number,
  endSec: number,
): { remainder: AudioBuffer; cut: AudioBuffer } {
  const sampleRate = source.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample   = Math.min(source.length, Math.floor(endSec * sampleRate));
  const cutLength   = endSample - startSample;
  const remLength   = source.length - cutLength;

  const cut = ctx.createBuffer(source.numberOfChannels, Math.max(1, cutLength), sampleRate);
  const rem = ctx.createBuffer(source.numberOfChannels, Math.max(1, remLength), sampleRate);

  for (let c = 0; c < source.numberOfChannels; c++) {
    const inData = source.getChannelData(c);
    const cutData = cut.getChannelData(c);
    const remData = rem.getChannelData(c);

    for (let i = 0; i < cutLength; i++) cutData[i] = inData[startSample + i];

    let remIdx = 0;
    for (let i = 0; i < source.length; i++) {
      if (i >= startSample && i < endSample) continue;
      remData[remIdx++] = inData[i];
    }
  }

  return { remainder: rem, cut };
}

/** Fügt einen Buffer in einen anderen ein (Paste). */
export function pasteBuffer(
  ctx: BaseAudioContext,
  source: AudioBuffer,
  clip: AudioBuffer,
  atSec: number,
): AudioBuffer {
  const sampleRate = source.sampleRate;
  const at = Math.max(0, Math.min(source.length, Math.floor(atSec * sampleRate)));
  const newLength = source.length + clip.length;
  const channels  = Math.max(source.numberOfChannels, clip.numberOfChannels);

  const out = ctx.createBuffer(channels, newLength, sampleRate);
  for (let c = 0; c < channels; c++) {
    const inData  = source.numberOfChannels > c ? source.getChannelData(c) : source.getChannelData(0);
    const clipData = clip.numberOfChannels > c ? clip.getChannelData(c) : clip.getChannelData(0);
    const outData = out.getChannelData(c);

    for (let i = 0; i < at; i++) outData[i] = inData[i];
    for (let i = 0; i < clip.length; i++) outData[at + i] = clipData[i];
    for (let i = at; i < source.length; i++) outData[clip.length + i] = inData[i];
  }
  return out;
}

/** Berechnet den Peak-Pegel eines Buffers (0–1). */
export function getPeak(source: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < source.numberOfChannels; c++) {
    const data = source.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

/**
 * Linearen Amplitudenwert in dBFS umrechnen, für die Anzeige.
 *
 * Eine Untergrenze ist nötig, weil `log10(0)` minus unendlich ergibt und in der
 * Oberfläche als `-Infinity` landen würde. −120 dB liegt weit unter allem, was
 * 16-Bit-Material auflösen kann, taugt also als „still".
 */
export function toDbfs(amplitude: number, digits = 1): string {
  if (!Number.isFinite(amplitude) || amplitude <= 0) return "-∞";
  const db = 20 * Math.log10(amplitude);
  return db < -120 ? "-∞" : db.toFixed(digits);
}

/** Berechnet den RMS-Pegel eines Buffers. */
export function getRms(source: AudioBuffer): number {
  let sum = 0;
  let count = 0;
  for (let c = 0; c < source.numberOfChannels; c++) {
    const data = source.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}
