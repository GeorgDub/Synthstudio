/**
 * Synthstudio – sampleDelay.ts (v3.191.0)
 *
 * Pure-Helper fuer einen klassischen Echo/Delay-Effekt mit Feedback.
 * Implementiert ein circular-buffer-Delay-Line-Modell ohne FFT/IR.
 *
 * ─── Modell ─────────────────────────────────────────────────────────────────
 *
 * Pro Channel laeuft ein eigenes Ringpuffer-Delay:
 *
 *   for i in 0..outputLength-1:
 *     drySample      = i < dry.length ? dry[i] : 0
 *     delayedSample  = delayBuffer[i % delaySamples]   // READ first
 *     feedbackOut    = clamp(drySample + delayedSample * feedback, -1, 1)
 *     delayBuffer[i % delaySamples] = feedbackOut       // WRITE after
 *     output[i]      = drySample * (1-wet) + delayedSample * wet
 *
 * Wichtig: Read-vor-Write. Wuerden wir umgekehrt schreiben, kollabiert das
 * Delay auf 0 (wir laesen den selben Wert, den wir gerade geschrieben haben).
 *
 * Clamp ±1.0 wirkt auf den feedback-Path, NICHT auf den Output.  So
 * verhindern wir, dass eine zu hohe Feedback-Setting den Puffer in eine
 * unendliche Verstaerkungsschleife treibt.  Der Output selbst darf am Ende
 * ueber ±1 gehen (Caller normalisiert via Auto-Normalize).
 *
 * ─── Foundation fuer Preset-Delays ──────────────────────────────────────────
 *
 * DELAY_PRESETS liefert 4 UI-Dropdown-Eintraege: Slapback (kurz, leise),
 * Echo (Klassiker), Long Echo (Hall-artig), Dub-Delay (viel Feedback).
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Default Delay-Zeit in Millisekunden. */
const DEFAULT_DELAY_MS = 250;

/** Default Feedback (0..0.95). */
const DEFAULT_FEEDBACK = 0.4;

/** Default Wet-Mix (0..1). */
const DEFAULT_WET = 0.4;

/** Default Tail-Verlaengerung in Millisekunden (fuer letzte Echos). */
const DEFAULT_TAIL_MS = 1000;

/** Max-Feedback (verhindert unendliche Verstaerkungsschleifen). */
const MAX_FEEDBACK = 0.95;

/** Hard-Clip-Grenze fuer feedback-Path. */
const CLIP = 1.0;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface DelayOptions {
  /** Delay-Time in ms. Default 250. */
  delayMs?: number;
  /** Feedback 0..0.95. Default 0.4. */
  feedback?: number;
  /** Wet-Mix 0..1. Default 0.4. */
  wet?: number;
  /** Output-Buffer-Tail-Verlängerung in ms (für letzte Echos). Default 1000. */
  tailMs?: number;
}

// ─── Helpers (intern) ────────────────────────────────────────────────────────

/** sanitize delayMs — NaN / <=0 → 250. */
function sanitizeDelayMs(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return DEFAULT_DELAY_MS;
  return v;
}

/** sanitize feedback — NaN → default, clamp [0, 0.95]. */
function sanitizeFeedback(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_FEEDBACK;
  if (v < 0) return 0;
  if (v > MAX_FEEDBACK) return MAX_FEEDBACK;
  return v;
}

/** sanitize wet — NaN → default, clamp [0, 1]. */
function sanitizeWet(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_WET;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** sanitize tailMs — NaN / <0 → 1000. */
function sanitizeTailMs(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v < 0) return DEFAULT_TAIL_MS;
  return v;
}

/** Hard-Clip auf ±1.0. */
function clip(x: number): number {
  if (x > CLIP) return CLIP;
  if (x < -CLIP) return -CLIP;
  return x;
}

/** Verpackt ein Float32Array-pro-Channel-Array als AudioBufferLike. */
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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet einen Echo/Delay-Effekt mit Feedback auf einen Sample-Buffer an.
 *
 * Pro Channel laeuft ein eigener Circular-Buffer.  Output-Laenge =
 * dry.length + tailSamples — damit die letzten Echos noch ausschwingen
 * koennen, auch wenn das Original schon vorbei ist.
 *
 * Defensive: NaN / out-of-range Optionen fallen auf Defaults zurueck.
 *
 * Liefert AudioBufferLike mit identischer Channel-Anzahl wie input.
 */
export function applyDelay(
  buffer: AudioBufferLike,
  options: DelayOptions = {},
): AudioBufferLike {
  const delayMs = sanitizeDelayMs(options.delayMs);
  const feedback = sanitizeFeedback(options.feedback);
  const wet = sanitizeWet(options.wet);
  const tailMs = sanitizeTailMs(options.tailMs);

  // empty input → empty output (Channel-Anzahl bleibt)
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return {
      sampleRate: buffer?.sampleRate ?? 48000,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }

  const sampleRate = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const dryLen = buffer.length;

  const delaySamples = Math.max(1, Math.round((delayMs * sampleRate) / 1000));
  const tailSamples = Math.round((tailMs * sampleRate) / 1000);
  const outputLength = dryLen + tailSamples;

  const oneMinusWet = 1 - wet;

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(outputLength);
    const delayBuffer = new Float32Array(delaySamples);

    for (let i = 0; i < outputLength; i++) {
      const drySample = i < dryLen ? dry[i] : 0;
      const slot = i % delaySamples;
      const delayedSample = delayBuffer[slot];          // READ before WRITE
      const feedbackOut = clip(drySample + delayedSample * feedback);
      delayBuffer[slot] = feedbackOut;                  // WRITE after READ
      out[i] = drySample * oneMinusWet + delayedSample * wet;
    }

    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}

/**
 * Vorgefertigte Delay-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - slap: kurzer, dezenter Doubler-Effekt (Slapback aus dem Rockabilly)
 * - echo: klassisches mittellanges Echo
 * - long: laenger und mit mehr Feedback — Hall-artig
 * - dub: hohes Feedback, mittlere Zeit — Dub-Reggae-Feel
 */
export const DELAY_PRESETS = [
  { id: "slap", name: "Slapback", delayMs: 80, feedback: 0.2, wet: 0.3 },
  { id: "echo", name: "Echo", delayMs: 250, feedback: 0.4, wet: 0.4 },
  { id: "long", name: "Long Echo", delayMs: 500, feedback: 0.55, wet: 0.5 },
  { id: "dub", name: "Dub-Delay", delayMs: 350, feedback: 0.7, wet: 0.45 },
] as const;
