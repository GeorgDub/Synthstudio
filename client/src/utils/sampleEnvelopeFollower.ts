/**
 * sampleEnvelopeFollower.ts (v3.216)
 *
 * Pure-Helper für Amplituden-Envelope-Tracking eines Sample-Buffers via
 * klassischem one-pole IIR-Smoother mit getrennten Attack- und Release-
 * Zeitkonstanten (analog Hardware-Envelope-Followern / Side-Chain-Detektoren).
 *
 * Foundation für:
 * - Side-Chain-Detection (Drum-Compressor-Trigger),
 * - Auto-Gain / Auto-Normalize via Envelope-Peak,
 * - Modulation-Sources (Envelope-Follower als LFO-Ersatz, Filter-Cutoff
 *   folgt der Sample-Lautstärke),
 * - Visualisierung (Waveform-Overlay-Linie mit smoothed amplitude).
 *
 * Modi:
 *  - "peak": target = |x|              (folgt absolutem Spitzenwert)
 *  - "rms":  target = x*x, out = sqrt  (folgt Effektivwert)
 *
 * Pure & DOM-frei.  Einzige Abhängigkeit: AudioBufferLike aus
 * sampleEmbedding.ts (nur Type-Import).
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

export type EnvelopeFollowerMode = "peak" | "rms";

export interface EnvelopeFollowerOptions {
  /** Attack-Zeitkonstante in ms (0..5000, default 5). */
  attackMs?: number;
  /** Release-Zeitkonstante in ms (1..10000, default 50). */
  releaseMs?: number;
  /** Detection-Mode.  Default "peak". */
  mode?: EnvelopeFollowerMode;
}

export interface EnvelopePeak {
  /** Maximaler Envelope-Wert. */
  value: number;
  /** Sample-Index an dem das Maximum erstmals auftritt. */
  sampleIndex: number;
}

// ─── Konstanten ──────────────────────────────────────────────────────────────

const DEFAULT_ATTACK_MS = 5;
const DEFAULT_RELEASE_MS = 50;
const DEFAULT_MODE: EnvelopeFollowerMode = "peak";

const MIN_ATTACK_MS = 0;
const MAX_ATTACK_MS = 5000;
const MIN_RELEASE_MS = 1;
const MAX_RELEASE_MS = 10000;

const FALLBACK_SAMPLE_RATE = 44100;

// ─── Sanitizers ──────────────────────────────────────────────────────────────

function sanitizeAttackMs(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < MIN_ATTACK_MS) {
    return DEFAULT_ATTACK_MS;
  }
  if (v > MAX_ATTACK_MS) return MAX_ATTACK_MS;
  return v;
}

function sanitizeReleaseMs(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < MIN_RELEASE_MS) {
    return DEFAULT_RELEASE_MS;
  }
  if (v > MAX_RELEASE_MS) return MAX_RELEASE_MS;
  return v;
}

function sanitizeMode(v: unknown): EnvelopeFollowerMode {
  return v === "rms" ? "rms" : DEFAULT_MODE;
}

function sanitizeSampleRate(sr: unknown): number {
  if (typeof sr !== "number" || !Number.isFinite(sr) || sr <= 0) {
    return FALLBACK_SAMPLE_RATE;
  }
  return sr;
}

// ─── Core: followEnvelope (single channel) ───────────────────────────────────

/**
 * Berechnet die Amplituden-Envelope einer Float32-Sample-Reihe.
 *
 * Algorithmus (one-pole IIR, getrennt Attack/Release):
 *  - alphaAttack  = exp(-1 / (attackMs  * sr / 1000))
 *  - alphaRelease = exp(-1 / (releaseMs * sr / 1000))
 *  - target = |x|       (peak) bzw. x*x (rms)
 *  - if target > env_prev: env = alphaAttack  * env_prev + (1 - alphaAttack ) * target
 *    else:                 env = alphaRelease * env_prev + (1 - alphaRelease) * target
 *  - State (env_prev für next iteration) bleibt SQUARED bei rms — nur das
 *    Output-Sample wird sqrt-genommen.  Sonst stimmt die Smoothing-Mathematik
 *    nicht.
 *
 * Liefert eine NEUE Float32Array gleicher Länge wie das Input.  Input wird
 * NICHT mutiert.
 *
 * @param samples     Float32-Sample-Reihe (Mono).  Empty → leere Output-Array.
 * @param sampleRate  Hz.  <= 0 / NaN → Fallback 44100.
 * @param opts        Attack/Release/Mode.
 */
export function followEnvelope(
  samples: Float32Array,
  sampleRate: number,
  opts?: EnvelopeFollowerOptions,
): Float32Array {
  const len = samples?.length | 0;
  if (!len) return new Float32Array(0);

  const sr = sanitizeSampleRate(sampleRate);
  const attackMs = sanitizeAttackMs(opts?.attackMs);
  const releaseMs = sanitizeReleaseMs(opts?.releaseMs);
  const mode = sanitizeMode(opts?.mode);

  // alpha = exp(-1 / (timeMs * sr / 1000)) — Standard-RBJ-Envelope-Formel.
  // attackMs === 0 → exp(-Infinity) === 0 → "instant attack" (env folgt sofort).
  // releaseMs >= 1 garantiert per Sanitizer endliches Resultat.
  const attackSamples = attackMs * sr * 0.001;
  const releaseSamples = releaseMs * sr * 0.001;
  const alphaAttack = attackSamples > 0 ? Math.exp(-1 / attackSamples) : 0;
  const alphaRelease = releaseSamples > 0 ? Math.exp(-1 / releaseSamples) : 0;

  const out = new Float32Array(len);
  let envState = 0; // smoothed value (squared bei rms-mode)
  const isRms = mode === "rms";

  for (let i = 0; i < len; i++) {
    const x = samples[i];
    const xs = Number.isFinite(x) ? x : 0;
    const target = isRms ? xs * xs : Math.abs(xs);

    let next: number;
    if (target > envState) {
      next = alphaAttack * envState + (1 - alphaAttack) * target;
    } else {
      next = alphaRelease * envState + (1 - alphaRelease) * target;
    }

    // belt-and-suspenders gegen Float-Overflow / cumulative NaN
    if (!Number.isFinite(next)) next = 0;

    envState = next;
    out[i] = isRms ? Math.sqrt(next) : next;
  }

  return out;
}

// ─── bufferEnvelope (multi-channel, averaged) ────────────────────────────────

/**
 * Berechnet die Envelope eines Multi-Channel-Buffers:
 *  1) Pro Channel wird die Envelope einzeln gefolgt (preserves
 *     Attack/Release-Dynamik pro Channel),
 *  2) Output[i] = arithmetisches Mittel der Channel-Envelopes an Position i.
 *
 * Liefert eine NEUE Float32Array der Länge buffer.length.
 * Empty/null-Buffer → leere Float32Array.
 */
export function bufferEnvelope(
  buffer: AudioBufferLike,
  opts?: EnvelopeFollowerOptions,
): Float32Array {
  if (!buffer) return new Float32Array(0);
  const ch = buffer.numberOfChannels | 0;
  const len = buffer.length | 0;
  if (!ch || !len) return new Float32Array(0);

  const sr = sanitizeSampleRate(buffer.sampleRate);

  // Erste Channel direkt — vermeidet temporäres Allokieren wenn mono.
  const acc = followEnvelope(buffer.getChannelData(0), sr, opts);
  if (ch === 1) return acc;

  // Multi-Channel: weitere Channels folgen und element-wise mitteln.
  for (let c = 1; c < ch; c++) {
    const env = followEnvelope(buffer.getChannelData(c), sr, opts);
    for (let i = 0; i < len; i++) {
      acc[i] += env[i];
    }
  }
  const inv = 1 / ch;
  for (let i = 0; i < len; i++) {
    acc[i] *= inv;
  }
  return acc;
}

// ─── envelopePeak ────────────────────────────────────────────────────────────

/**
 * Findet den Maximalwert einer Envelope per linearem Scan.
 *
 * Tie-Break: STRICT GREATER-THAN — erste Position mit Max gewinnt.
 *
 * Empty → { value: 0, sampleIndex: 0 }.
 */
export function envelopePeak(envelope: Float32Array): EnvelopePeak {
  const len = envelope?.length | 0;
  if (!len) return { value: 0, sampleIndex: 0 };

  let maxVal = envelope[0];
  let maxIdx = 0;
  if (!Number.isFinite(maxVal)) maxVal = 0;

  for (let i = 1; i < len; i++) {
    const v = envelope[i];
    if (Number.isFinite(v) && v > maxVal) {
      maxVal = v;
      maxIdx = i;
    }
  }
  return { value: maxVal, sampleIndex: maxIdx };
}
