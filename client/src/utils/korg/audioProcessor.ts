/**
 * Synthstudio – KORG E2S Audio-Processor (v3.4.0)
 *
 * TypeScript-Port aus `G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/audio_processor.py`.
 *
 * SCOPE — v3.4 Write-Side Hilfsfunktionen:
 *   - Resampling auf 44.1 oder 48 kHz (lineare Interpolation – MVP-Qualität)
 *   - Channel-Adjust: Mono ↔ Stereo (mit Average-Downmix)
 *   - Float32 [-1, +1] → 16-bit signed-LE PCM-Bytes
 *   - Defensive Caps: max 10 MB PCM pro Slot, NaN/Infinity-Filter
 *
 * Diese Datei ist **pure** (kein Web-Audio-API-Import) damit sie problemlos
 * im Vitest/Node-Test-Env läuft. Konsumer dürfen `AudioBuffer.getChannelData`
 * vorher aufrufen und das Ergebnis hier reinspeisen.
 *
 * SoT-Marker:
 *   - `convertToE2sSpec`     ⇄ audio_processor.py::convert_to_e2s_spec
 *   - `resampleLinear`       ⇄ audio_processor.py::resample (poly-phase FIR
 *                              ist out-of-scope, MVP-Replacement = lineare
 *                              Interpolation; Quality-Followup v3.5)
 *   - `downmixToMono`        ⇄ audio_processor.py::downmix_to_mono
 *   - `floatToInt16LeBytes`  ⇄ audio_processor.py::_float_to_int16_le
 */

import {
  E2S_BIT_DEPTH,
  E2S_SAMPLE_RATES,
  MAX_BYTES_PER_SLOT,
} from "./constants";

// ─── Public Types ─────────────────────────────────────────────────────────────

export type E2sTargetSampleRate = (typeof E2S_SAMPLE_RATES)[number]; // 44100 | 48000

export interface ProcessAudioOptions {
  /** Ziel-Sample-Rate für den E2-Sampler. Muss 44100 oder 48000 sein. */
  targetSampleRate?: E2sTargetSampleRate;
  /** Wenn `true` und Input ist Stereo → average downmix auf Mono. Default false. */
  forceMono?: boolean;
  /** Optional: Peak-Normalize auf den Wert (0,1]. Default keine Normalize. */
  normalizePeak?: number;
}

export interface ProcessedAudio {
  /** Float32-PCM, mono = flach, stereo = interleaved L,R,L,R,…  */
  pcm: Float32Array;
  /** Resultierende Sample-Rate (Hz). */
  sampleRate: number;
  /** 1 = mono, 2 = stereo. */
  channels: 1 | 2;
  /** Anzahl Frames PRO Kanal. */
  frames: number;
  /** Geschätzte Bytes als 16-bit-PCM (frames × channels × 2). */
  estimatedPcmBytes: number;
  /** Soft-Warnings (z.B. "downmix peak > 0.95"). */
  warnings: string[];
}

export class AudioProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioProcessError";
  }
}

// ─── DSP-Konstanten ───────────────────────────────────────────────────────────

const INT16_PEAK_POS = 32_767;
const INT16_PEAK_NEG = 32_768;
const DOWNMIX_HEADROOM_THRESHOLD = 0.95;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Wandelt einen rohen Float32-PCM-Buffer (mono oder stereo-interleaved) in
 * eine E2S-kompatible Repräsentation:
 *
 *   1. Optional: Stereo → Mono (Average-Downmix)
 *   2. Resampling auf 44.1 oder 48 kHz (linear)
 *   3. Optional: Peak-Normalize
 *
 * @throws AudioProcessError bei ungültigen Eingaben oder Cap-Verletzung.
 */
export function convertToE2sSpec(
  inputPcm: Float32Array,
  inputSampleRate: number,
  inputChannels: 1 | 2,
  opts: ProcessAudioOptions = {},
): ProcessedAudio {
  if (!(inputPcm instanceof Float32Array)) {
    throw new AudioProcessError("inputPcm must be Float32Array");
  }
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new AudioProcessError(`invalid input sample rate ${inputSampleRate}`);
  }
  if (inputChannels !== 1 && inputChannels !== 2) {
    throw new AudioProcessError(`unsupported input channels ${inputChannels}`);
  }
  const targetSr: E2sTargetSampleRate = opts.targetSampleRate ?? 44_100;
  if (!E2S_SAMPLE_RATES.includes(targetSr)) {
    throw new AudioProcessError(
      `target sample rate ${targetSr} not in [${E2S_SAMPLE_RATES.join(", ")}]`,
    );
  }

  const warnings: string[] = [];
  let workingPcm = inputPcm;
  let workingChannels: 1 | 2 = inputChannels;

  // Schritt 1 — Downmix Stereo → Mono (optional)
  if (opts.forceMono && workingChannels === 2) {
    const { pcm: mono, peak } = downmixToMono(workingPcm);
    workingPcm = mono;
    workingChannels = 1;
    if (peak > DOWNMIX_HEADROOM_THRESHOLD) {
      warnings.push(
        `downmix peak ${peak.toFixed(3)} > ${DOWNMIX_HEADROOM_THRESHOLD} — consider attenuating source`,
      );
    }
  }

  // Schritt 2 — Resampling
  if (inputSampleRate !== targetSr) {
    workingPcm = resampleLinear(workingPcm, inputSampleRate, targetSr, workingChannels);
  }

  // Schritt 3 — Optional Peak-Normalize
  if (typeof opts.normalizePeak === "number") {
    workingPcm = peakNormalize(workingPcm, opts.normalizePeak);
  }

  // Resource-Cap: berechne 16-bit-Bytes und prüfe gegen 10 MB-Slot-Cap.
  const frames = (workingPcm.length / workingChannels) | 0;
  const estimatedPcmBytes = frames * workingChannels * (E2S_BIT_DEPTH / 8);
  if (estimatedPcmBytes > MAX_BYTES_PER_SLOT) {
    throw new AudioProcessError(
      `processed PCM ${estimatedPcmBytes} bytes exceeds per-slot cap ${MAX_BYTES_PER_SLOT}`,
    );
  }

  return {
    pcm: workingPcm,
    sampleRate: targetSr,
    channels: workingChannels,
    frames,
    estimatedPcmBytes,
    warnings,
  };
}

/**
 * Wandelt einen Float32-Buffer in 16-bit signed LE PCM Bytes.
 * Clipped auf [-1, +1], skaliert mit 32767 (positive) bzw. -32768 (negative).
 *
 * NaN/Infinity werden defensiv auf 0 gemappt.
 */
export function floatToInt16LeBytes(pcm: Float32Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    let v = pcm[i];
    if (!Number.isFinite(v)) v = 0;
    if (v > 1) v = 1;
    if (v < -1) v = -1;
    const scaled = v < 0 ? Math.round(v * INT16_PEAK_NEG) : Math.round(v * INT16_PEAK_POS);
    // sign-extend negative scaled to 2 LE bytes
    const u = scaled < 0 ? scaled + 0x10000 : scaled;
    out[i * 2] = u & 0xff;
    out[i * 2 + 1] = (u >> 8) & 0xff;
  }
  return out;
}

/**
 * Downmix stereo-interleaved PCM (L,R,L,R,…) → mono via `(L+R)/2` pro Frame.
 *
 * Liefert das mono-PCM + den (post-downmix) Peak für die Headroom-Warnung.
 * Input darf nicht ungerade lang sein (würde sonst einen halben Frame
 * implizieren) — wir trunkieren auf das letzte vollständige Frame.
 */
export function downmixToMono(stereo: Float32Array): { pcm: Float32Array; peak: number } {
  const frames = (stereo.length / 2) | 0;
  const mono = new Float32Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    const l = stereo[i * 2];
    const r = stereo[i * 2 + 1];
    const m = (l + r) / 2;
    mono[i] = m;
    const abs = m >= 0 ? m : -m;
    if (abs > peak) peak = abs;
  }
  return { pcm: mono, peak };
}

/**
 * Lineare Resampler-Implementierung (MVP-Qualität).
 *
 * - Mono: direkt frame-für-frame interpolieren.
 * - Stereo: deinterleave → resample je Kanal → re-interleave.
 *
 * Caveat: keine Anti-Alias-Filterung — für Downsampling (z.B. 96 → 44.1)
 * können Frequenzen oberhalb Nyquist Aliasing erzeugen. Für die meisten
 * User-Workflows (44.1 → 44.1, 48 → 44.1) ist das akzeptabel. Höhere
 * Qualität (Poly-Phase-FIR analog `scipy.signal.resample_poly`) ist
 * Followup v3.5.
 */
export function resampleLinear(
  pcm: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
  channels: 1 | 2,
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return pcm.slice();
  }
  if (channels === 1) {
    return resampleLinearMono(pcm, inputSampleRate, outputSampleRate);
  }
  // Stereo: deinterleave
  const inFrames = (pcm.length / 2) | 0;
  const left = new Float32Array(inFrames);
  const right = new Float32Array(inFrames);
  for (let i = 0; i < inFrames; i++) {
    left[i] = pcm[i * 2];
    right[i] = pcm[i * 2 + 1];
  }
  const lOut = resampleLinearMono(left, inputSampleRate, outputSampleRate);
  const rOut = resampleLinearMono(right, inputSampleRate, outputSampleRate);
  const outFrames = Math.min(lOut.length, rOut.length);
  const out = new Float32Array(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    out[i * 2] = lOut[i];
    out[i * 2 + 1] = rOut[i];
  }
  return out;
}

function resampleLinearMono(
  pcm: Float32Array,
  inSr: number,
  outSr: number,
): Float32Array {
  const inFrames = pcm.length;
  const ratio = outSr / inSr;
  const outFrames = Math.max(1, Math.floor(inFrames * ratio));
  const out = new Float32Array(outFrames);
  if (inFrames === 0) return out;
  for (let i = 0; i < outFrames; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, inFrames - 1);
    const frac = srcPos - i0;
    out[i] = pcm[i0] * (1 - frac) + pcm[i1] * frac;
  }
  return out;
}

/**
 * Peak-Normalize: skaliert den Buffer so dass das Maximum exakt `target` ist.
 * Silent-Inputs werden unverändert zurückgegeben (keine 0/0-Division).
 */
export function peakNormalize(pcm: Float32Array, target = 0.95): Float32Array {
  if (!(target > 0 && target <= 1)) {
    throw new AudioProcessError(`normalizePeak must be in (0,1], got ${target}`);
  }
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    if (!Number.isFinite(v)) continue;
    const abs = v >= 0 ? v : -v;
    if (abs > peak) peak = abs;
  }
  if (peak === 0) return pcm.slice();
  const factor = target / peak;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = pcm[i] * factor;
  }
  return out;
}

/** Helper: Sanitize ASCII-only name auf max `maxLen` chars für ESLI-Body. */
export function sanitizeE2sSlotName(name: string, maxLen = 16): string {
  let out = "";
  for (let i = 0; i < name.length && out.length < maxLen; i++) {
    const cp = name.charCodeAt(i);
    if (cp >= 0x20 && cp <= 0x7e) {
      out += String.fromCharCode(cp);
    }
  }
  return out;
}
