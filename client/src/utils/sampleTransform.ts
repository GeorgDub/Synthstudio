/**
 * Synthstudio – sampleTransform.ts (v3.116.0)
 *
 * Zentraler Wrapper-Util für Time-Stretch + Pitch-Shift auf AudioBuffern.
 * Wird vom Sample-Manager (SampleBrowser → SampleTransformDialog) genutzt,
 * um DAW-übliche Transformationen offline auf einen Sample-Buffer anzuwenden.
 *
 * ─── Reuse ──────────────────────────────────────────────────────────────────
 * Die Time-Stretch-Engine (OLA, Pitch-erhaltend) existiert bereits in
 * `client/src/audio/timeStretchUtils.ts` (`timeStretchBuffer`). Sie wird hier
 * NICHT neu implementiert — nur gewrappt + um Pitch-Shift erweitert.
 *
 * ─── Pitch-Shift-Strategie ──────────────────────────────────────────────────
 * Wir verwenden den klassischen "Phase-Vocoder + Resample"-Trick:
 *   1. Time-stretch um Faktor 2^(semitones/12) — Buffer wird länger oder
 *      kürzer, Pitch bleibt unverändert.
 *   2. Anschließend mit linearer Resampling-Interpolation auf die Original-
 *      Länge zurück → die Pitch verändert sich um die gewünschten Semitones,
 *      die Länge bleibt erhalten.
 *
 * Mathematisch:
 *   semitoneRatio = 2^(semitones/12)
 *   - +12 (Oktave hoch) → semitoneRatio = 2.0 → wir stretchen erst um 2× (Buffer
 *     wird doppelt so lang, gleiche Pitch), dann resamplen wir um Faktor 0.5
 *     (jede zweite Sample-Position interpoliert) → halbe Länge zurück = Original-
 *     Länge, aber Pitch eine Oktave höher.
 *
 * ─── Combined Transform ────────────────────────────────────────────────────
 * `combinedTransform(buffer, ratio, semitones)` führt Stretch + Pitch in
 * EINEM Schritt aus (effizienter als zwei separate Aufrufe, weil das
 * Zwischenresult nicht materialisiert wird).
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 * - ratio wird auf [STRETCH_MIN, STRETCH_MAX] geclampt (0.25–4.0)
 * - semitones wird auf [PITCH_MIN, PITCH_MAX] geclampt (-24 .. +24)
 * - NaN/Infinity → fallback auf Identity (ratio=1, semitones=0)
 * - buffer mit length=0 → wirft Error (kein sinnvoller Output)
 */

import { timeStretchBuffer } from "@/audio/timeStretchUtils";

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const STRETCH_MIN = 0.25;
export const STRETCH_MAX = 4.0;
export const PITCH_MIN = -24;
export const PITCH_MAX = 24;

/** Toleranz, ab der ratio/semitones als Identity behandelt werden. */
const RATIO_EPSILON = 0.001;
const SEMITONE_EPSILON = 0.01;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return 1;
  if (r < STRETCH_MIN) return STRETCH_MIN;
  if (r > STRETCH_MAX) return STRETCH_MAX;
  return r;
}

function clampSemitones(s: number): number {
  if (!Number.isFinite(s)) return 0;
  if (s < PITCH_MIN) return PITCH_MIN;
  if (s > PITCH_MAX) return PITCH_MAX;
  return s;
}

/**
 * Lineare Interpolations-Resample-Funktion: kopiert `source` in einen neuen
 * Buffer mit `outLength` Samples. Wird für den Pitch-Shift-Schritt genutzt.
 *
 * Pure Float32 → Float32. Side-effect-frei. Mono-channel-Operation;
 * Aufrufer wendet sie pro Kanal an.
 */
export function resampleLinear(source: Float32Array, outLength: number): Float32Array {
  const out = new Float32Array(outLength);
  if (outLength === 0 || source.length === 0) return out;
  if (outLength === source.length) {
    out.set(source);
    return out;
  }
  // Position-Schrittweite im Eingangs-Buffer pro Output-Sample.
  const step = (source.length - 1) / Math.max(1, outLength - 1);
  for (let i = 0; i < outLength; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(source.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = source[i0] * (1 - frac) + source[i1] * frac;
  }
  return out;
}

/**
 * Konvertiert Semitones in einen multiplikativen Pitch-Ratio.
 * +12 Semitones → 2.0 (eine Oktave hoch)
 * -12 Semitones → 0.5 (eine Oktave runter)
 */
export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Streckt einen AudioBuffer zeitlich, OHNE die Tonhöhe zu verändern.
 *
 * @param ctx         AudioContext / OfflineAudioContext zum Erzeugen des
 *                    neuen Buffers (`createBuffer` wird gerufen).
 * @param buffer      Original-Buffer (immutable — wird nicht modifiziert).
 * @param ratio       1.0 = unverändert, 2.0 = doppelt so lang (halbe Speed),
 *                    0.5 = halb so lang (doppelte Speed). Wird auf
 *                    [STRETCH_MIN, STRETCH_MAX] geclampt.
 * @returns Neuer AudioBuffer mit gestretchter Länge.
 * @throws Error wenn buffer leer (length=0).
 */
export function stretchSample(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  ratio: number,
): AudioBuffer {
  if (buffer.length === 0) {
    throw new Error("stretchSample: buffer has length 0");
  }
  const r = clampRatio(ratio);
  if (Math.abs(r - 1) < RATIO_EPSILON) {
    // Identity — return Copy damit Caller-Code immutable bleibt.
    return cloneBuffer(ctx, buffer);
  }
  return timeStretchBuffer(ctx, buffer, r);
}

/**
 * Verschiebt die Tonhöhe eines AudioBuffers um `semitones` Halbtöne, OHNE
 * die Länge zu verändern (Phase-Vocoder + Resample-Trick).
 *
 * @param ctx         AudioContext.
 * @param buffer      Original-Buffer.
 * @param semitones   -24 .. +24 (auf Range geclampt). +12 = Oktave hoch.
 * @returns Neuer Buffer mit gleicher Länge, aber verschobener Pitch.
 */
export function pitchShiftSample(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  semitones: number,
): AudioBuffer {
  if (buffer.length === 0) {
    throw new Error("pitchShiftSample: buffer has length 0");
  }
  const st = clampSemitones(semitones);
  if (Math.abs(st) < SEMITONE_EPSILON) {
    return cloneBuffer(ctx, buffer);
  }
  return combinedTransform(ctx, buffer, 1.0, st);
}

/**
 * Kombinierter Stretch + Pitch-Shift in EINEM Schritt.
 *
 * Algorithmus:
 *   1. effectiveStretch = ratio * 2^(semitones/12)
 *      (so dass das Resample-Out die Ziel-Länge ergibt: original * ratio)
 *   2. Time-stretch um effectiveStretch (Pitch bleibt)
 *   3. Resample auf round(originalLength * ratio) → finale Länge
 *      (Pitch verschiebt sich um semitones, weil Resample-Faktor
 *      = 1/(2^(semitones/12)))
 *
 * Wenn ratio≈1 und semitones≈0 → Identity (Buffer-Kopie zurück).
 *
 * @returns Neuer Buffer mit Länge = round(buffer.length * ratio).
 */
export function combinedTransform(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  ratio: number,
  semitones: number,
): AudioBuffer {
  if (buffer.length === 0) {
    throw new Error("combinedTransform: buffer has length 0");
  }
  const r = clampRatio(ratio);
  const st = clampSemitones(semitones);

  const isStretchIdentity = Math.abs(r - 1) < RATIO_EPSILON;
  const isPitchIdentity = Math.abs(st) < SEMITONE_EPSILON;
  if (isStretchIdentity && isPitchIdentity) {
    return cloneBuffer(ctx, buffer);
  }

  // Reines Stretch (kein Pitch) → existing OLA-Pfad ist effizienter.
  if (isPitchIdentity) {
    return timeStretchBuffer(ctx, buffer, r);
  }

  // Pitch-Shift (mit oder ohne zusätzlichem Stretch):
  // Stretch um effectiveRatio = r * semitoneRatio, dann auf finale
  // Länge resamplen.
  const semitoneRatio = semitonesToRatio(st);
  const effectiveStretch = clampRatio(r * semitoneRatio);
  const stretched = isStretchIdentity && Math.abs(semitoneRatio - 1) < RATIO_EPSILON
    ? cloneBuffer(ctx, buffer)
    : timeStretchBuffer(ctx, buffer, effectiveStretch);

  const finalLength = Math.max(1, Math.round(buffer.length * r));
  if (stretched.length === finalLength) {
    return stretched;
  }

  const out = ctx.createBuffer(stretched.numberOfChannels, finalLength, stretched.sampleRate);
  for (let c = 0; c < stretched.numberOfChannels; c++) {
    const inData = stretched.getChannelData(c);
    const outData = out.getChannelData(c);
    outData.set(resampleLinear(inData, finalLength));
  }
  return out;
}

// ─── Internal ───────────────────────────────────────────────────────────────

function cloneBuffer(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) {
    out.getChannelData(c).set(src.getChannelData(c));
  }
  return out;
}

// ─── Re-exports (Convenience) ───────────────────────────────────────────────

export { timeStretchBuffer };
