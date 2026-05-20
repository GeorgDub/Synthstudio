/**
 * Synthstudio – sampleStutterBuffer.ts (v3.211.0)
 *
 * Pure-Helper fuer einen Stutter-Buffer-Effekt auf Sample-Ebene:
 * eine kurze Slice wird mehrfach wiederholt (looped) ueber einen
 * neuen Buffer der EXAKT (repeats * sliceSamples) lang ist.
 *
 * ─── Abgrenzung ─────────────────────────────────────────────────────────────
 *
 * Es existiert bereits ein patternStutter.ts (v3.184) — der Helper
 * arbeitet auf Pattern-Step-Ebene (Step-Wiederholung im Sequencer).
 * Dieser Helper hier ist Sample-Level / Audio-DSP — er reisst Audio-
 * Samples eines AudioBufferLike heraus und repliziert sie.
 *
 * ─── Modell ─────────────────────────────────────────────────────────────────
 *
 * 1) Slice extrahieren: take [startMs..startMs+sliceMs] in samples.
 *    sliceSamples = round(sliceMs * sampleRate / 1000).
 *    startSample  = round(startMs  * sampleRate / 1000).
 *
 *    Wenn startSample + sliceSamples > input.length, werden die
 *    verfuegbaren Samples ans Anfang geschrieben und der Rest mit
 *    Stille (0.0) gepaddet.
 *
 * 2) Output-Buffer der Laenge (repeats * sliceSamples).
 *    Im Gegensatz zu Tremolo/Vibrato/Chorus/Flanger/AutoPan ist die
 *    Output-Laenge NICHT == input.length, sondern explizit von
 *    repeats * sliceSamples bestimmt. Caller muss damit umgehen koennen.
 *
 * 3) Pro repeat n (n=0..repeats-1):
 *      amplitude = max(0, 1 - n*decay)
 *      output[n*sliceSamples..(n+1)*sliceSamples] = slice * amplitude
 *
 *    Bei decay=0 sind alle Repeats voll. Bei decay=1 ist nur Repeat 0
 *    voll, Rest = 0. Per-repeat-Amp ist >=0 (kein Sign-Flip).
 *
 * 4) LFO-Phase / Feedback: KEINE — reine Kopier-Operation pro Repeat.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * Wichtig: Sanitizer-Asymmetrie!
 *
 * - sliceMs   NaN/<5             -> 50 (default, NICHT clamp auf 5!)
 *             +Infinity / >500   -> 500 (clamp; AutoPan-Konvention)
 *             -Infinity          -> 50 (default)
 * - repeats   NaN/<1             -> 4  (default, NICHT clamp auf 1!)
 *             +Infinity / >32    -> 32 (clamp)
 *             -Infinity          -> 4 (default)
 *             non-integer        -> floor
 * - startMs   NaN/non-finite/<0  -> 0 (default)
 *             > duration         -> 0 (default! Reset, NICHT clamp)
 * - decay     NaN/<0/-Infinity   -> 0
 *             +Infinity / >1     -> 1 (clamp)
 *             undefined          -> 0 (default)
 *
 * Empty buffer (length=0||numberOfChannels=0) -> empty output
 *   {numberOfChannels=0, length=0, fallback sampleRate=48000} —
 *   Tremolo-Konvention.
 *
 * Input wird nie mutiert.
 *
 * ─── Multi-Channel ──────────────────────────────────────────────────────────
 *
 * Output preserved numberOfChannels. Jeder Channel wird unabhaengig
 * slice+repeated aus der entsprechenden Input-Channel-Quelle.
 *
 * ─── Finiteness ─────────────────────────────────────────────────────────────
 *
 * Reine Multiply+Copy-Operationen. Solange input finite ist, ist
 * output finite. Kein Feedback, kein IIR.
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const DEFAULT_SLICE_MS = 50;
const DEFAULT_REPEATS = 4;
const DEFAULT_START_MS = 0;
const DEFAULT_DECAY = 0;

const MIN_SLICE_MS = 5;
const MAX_SLICE_MS = 500;
const MIN_REPEATS = 1;
const MAX_REPEATS = 32;
const MAX_DECAY = 1;

const FALLBACK_SAMPLE_RATE = 48000;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface StutterBufferOptions {
  /** Slice-Laenge in ms (5..500). Default 50ms.
   *  NaN/<5 -> Default; >500 -> Clamp. */
  sliceMs?: number;
  /** Anzahl der Wiederholungen (1..32). Default 4.
   *  NaN/<1 -> Default; >32 -> Clamp; non-int -> floor. */
  repeats?: number;
  /** Startposition der Slice in ms. Default 0.
   *  NaN/<0 -> Default; > duration -> Default (NICHT clamp). */
  startMs?: number;
  /** Amplitudenabnahme pro Wiederholung 0..1. Default 0.
   *  NaN/<0 -> 0; >1 -> 1. */
  decay?: number;
}

// ─── Helpers (intern) ────────────────────────────────────────────────────────

function sanitizeSliceMs(v: number | undefined): number {
  if (v === undefined) return DEFAULT_SLICE_MS;
  if (Number.isNaN(v)) return DEFAULT_SLICE_MS;
  if (v === Number.POSITIVE_INFINITY) return MAX_SLICE_MS;
  if (!Number.isFinite(v) || v < MIN_SLICE_MS) return DEFAULT_SLICE_MS;
  if (v > MAX_SLICE_MS) return MAX_SLICE_MS;
  return v;
}

function sanitizeRepeats(v: number | undefined): number {
  if (v === undefined) return DEFAULT_REPEATS;
  if (Number.isNaN(v)) return DEFAULT_REPEATS;
  if (v === Number.POSITIVE_INFINITY) return MAX_REPEATS;
  if (!Number.isFinite(v) || v < MIN_REPEATS) return DEFAULT_REPEATS;
  if (v > MAX_REPEATS) return MAX_REPEATS;
  return Math.floor(v);
}

function sanitizeStartMs(v: number | undefined, durationMs: number): number {
  if (v === undefined || !Number.isFinite(v) || v < 0) return DEFAULT_START_MS;
  if (v > durationMs) return DEFAULT_START_MS;
  return v;
}

function sanitizeDecay(v: number | undefined): number {
  if (v === undefined) return DEFAULT_DECAY;
  if (Number.isNaN(v)) return 0;
  if (v === Number.POSITIVE_INFINITY) return MAX_DECAY;
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > MAX_DECAY) return MAX_DECAY;
  return v;
}

function wrapBuffer(channels: Float32Array[], sampleRate: number): AudioBufferLike {
  const ch = channels.length;
  const len = ch === 0 ? 0 : channels[0].length;
  return {
    sampleRate,
    numberOfChannels: ch,
    length: len,
    getChannelData: (channel: number) => {
      if (channel < 0 || channel >= ch) {
        throw new RangeError(`getChannelData: index ${channel} out of range`);
      }
      return channels[channel];
    },
  };
}

function emptyResult(sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet einen Stutter-Buffer-Effekt auf einen Sample-Buffer an: extrahiert
 * eine kurze Slice ab startMs (Laenge sliceMs) und wiederholt diese
 * `repeats` mal, optional mit per-Repeat-Amplituden-Decay.
 *
 * WICHTIG: Output-Laenge == repeats * sliceSamples, NICHT input.length.
 * Caller muss mit veraenderter Buffer-Laenge umgehen koennen.
 *
 * Pro Repeat n in 0..repeats-1:
 *   amplitude = max(0, 1 - n*decay)
 *   output[n*sliceSamples..(n+1)*sliceSamples] = slice * amplitude
 *
 * Falls startSample + sliceSamples > input.length: verfuegbare Samples
 * werden ans Anfang geschrieben, Rest mit 0.0 gepaddet (silence-pad).
 *
 * Defensive: Empty buffer -> empty output. Sanitizer-Asymmetrie:
 * sliceMs/repeats fallen bei NaN/<min auf Default zurueck, NICHT auf
 * min-clamp. startMs > duration -> Reset auf 0. siehe Modul-JSDoc.
 *
 * Pure & DOM-frei.
 */
export function applyStutterBuffer(
  buffer: AudioBufferLike,
  opts: StutterBufferOptions = {},
): AudioBufferLike {
  // Empty buffer -> empty output (Tremolo-Konvention)
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return emptyResult(buffer?.sampleRate ?? FALLBACK_SAMPLE_RATE);
  }

  const sampleRate = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const inLen = buffer.length;
  const durationMs = (inLen / sampleRate) * 1000;

  const sliceMs = sanitizeSliceMs(opts.sliceMs);
  const repeats = sanitizeRepeats(opts.repeats);
  const startMs = sanitizeStartMs(opts.startMs, durationMs);
  const decay = sanitizeDecay(opts.decay);

  // Slice-Groesse in Samples (mind. 1)
  const sliceSamples = Math.max(1, Math.round((sliceMs * sampleRate) / 1000));
  const startSample = Math.max(0, Math.round((startMs * sampleRate) / 1000));

  const outLen = repeats * sliceSamples;

  const outChannels: Float32Array[] = [];

  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(outLen);

    // 1) Slice extrahieren in eigenes Array (silence-pad falls noetig)
    const slice = new Float32Array(sliceSamples);
    for (let i = 0; i < sliceSamples; i++) {
      const srcIdx = startSample + i;
      slice[i] = srcIdx < inLen ? dry[srcIdx] : 0.0;
    }

    // 2) Repeats schreiben mit per-Repeat-Amplitude
    for (let n = 0; n < repeats; n++) {
      const rawAmp = 1 - n * decay;
      const amp = rawAmp > 0 ? rawAmp : 0;
      const base = n * sliceSamples;
      if (amp === 0) {
        // out ist bereits 0-initialisiert; nichts zu tun
        continue;
      }
      if (amp === 1) {
        // schneller Copy-Pfad
        for (let i = 0; i < sliceSamples; i++) {
          out[base + i] = slice[i];
        }
      } else {
        for (let i = 0; i < sliceSamples; i++) {
          out[base + i] = slice[i] * amp;
        }
      }
    }

    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}

/**
 * Vorgefertigte Stutter-Buffer-Presets fuer UI-Dropdowns.
 *
 * - short:   kurze fast Repeats (30ms x 8 mit 10% decay) — typischer Drum-Stutter
 * - classic: 50ms x 4 ohne Decay — Spec-Default
 * - glitch:  sehr kurze Slices x 16 (20ms x 16) mit dezenter 5% decay
 * - fade:    laengere Slices mit deutlichem Fade (100ms x 6 mit 30% decay)
 */
export const STUTTER_PRESETS = {
  short: { sliceMs: 30, repeats: 8, decay: 0.1 },
  classic: { sliceMs: 50, repeats: 4, decay: 0 },
  glitch: { sliceMs: 20, repeats: 16, decay: 0.05 },
  fade: { sliceMs: 100, repeats: 6, decay: 0.3 },
} as const;
