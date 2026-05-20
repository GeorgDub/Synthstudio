/**
 * Synthstudio - sampleSidechain.ts (v3.192.0)
 *
 * Pure-DSP offline-rendered Sidechain Compression / Pump-Effekt.
 *
 * Klassischer EDM/House "Pump"-Effekt: ein Trigger-Pattern (z.B. ein Kick auf
 * jeder 1/4) drueckt die Lautstaerke eines anderen Samples periodisch herunter.
 * Hier offline pre-rendered, ohne Audio-Engine-Wire — d.h. man wendet den
 * Effekt direkt auf einen Sample-Buffer an und bekommt einen neuen Buffer.
 *
 * Algorithmus (per sample, per channel):
 *   stepDurationSec     = (60 / bpm) / stepsPerBeat
 *   stepDurationSamples = stepDurationSec * sampleRate
 *   currentStep         = floor(i / stepDurationSamples) % triggerPattern.length
 *   targetGain          = triggerPattern[currentStep]
 *                            ? 10^(duckDb/20)  // gain-reduction when triggered
 *                            : 1.0
 *   coef       = (targetGain < envelope) ? attackCoef : releaseCoef
 *   envelope   = targetGain + (envelope - targetGain) * coef
 *   out[i]     = in[i] * envelope
 *
 * Pure & DOM-frei -> Node-testbar. Input wird nie mutiert.
 *
 * --- Design Notes ---------------------------------------------------------
 *
 * - "envelope" hier ist ein LINEARER GAIN-Wert, kein dB-Wert. targetGain liegt
 *   im Bereich (0, 1]: 1.0 = keine Reduktion, < 1.0 = ducked. Wir starten den
 *   Tracker bei 1.0 (Initialzustand "voll auf").
 *
 * - "Attack" bedeutet hier: das Tempo, mit dem die Gain-Reduktion EINSETZT —
 *   also envelope sinkt von 1.0 in Richtung targetGain. "Release" ist die
 *   Rueck-Erholung — envelope steigt zurueck Richtung 1.0. Das matched mit der
 *   gaengigen Sidechain-Compressor-Sprache (kurzes Attack = scharfes Ducking,
 *   langes Release = sanftes Pumpen).
 *
 * - Cross-channel: jeder Kanal teilt sich denselben Trigger-Pattern, aber jeder
 *   Kanal hat seinen EIGENEN envelope-Tracker. Das matched Stereo-Material wenn
 *   beide Kanaele synchron getriggert werden, ist aber defensiver fuer den Fall
 *   dass Kanaele unterschiedlich starten (z.B. delayed Stereo-Sample).
 *
 * - duckDb=0 (oder positiv): targetGain >= 1.0 — zero/upward effect. Wir lassen
 *   das offen statt zu clampen, falls jemand bewusst boosten will. Defaults
 *   sind aber -12 dB, also Reduktion.
 *
 * - missing/empty triggerPattern -> Identity (kein Effekt). Defensiv gegen
 *   leere UI-Inputs.
 *
 * Tests: tests/features/sample-sidechain.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Public Types ------------------------------------------------------------

export interface SidechainOptions {
  /** Pattern (boolean[]) - true = trigger sidechain duck. */
  triggerPattern: readonly boolean[];
  /** BPM der Pattern-Trigger. Default 120. */
  bpm?: number;
  /** Steps pro Beat. Default 4 (1/16). */
  stepsPerBeat?: number;
  /** Duck-Amount in dB (gain-reduction when triggered). Default -12. */
  duckDb?: number;
  /** Attack ms - speed of duck-onset. Default 1. */
  attackMs?: number;
  /** Release ms - speed of recovery. Default 200. */
  releaseMs?: number;
}

// --- Constants / Defaults ----------------------------------------------------

export const DEFAULT_BPM = 120;
export const DEFAULT_STEPS_PER_BEAT = 4;
export const DEFAULT_DUCK_DB = -12;
export const DEFAULT_ATTACK_MS = 1;
export const DEFAULT_RELEASE_MS = 200;

// --- Internal Sanitizers -----------------------------------------------------

function sanitizeFinite(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function sanitizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return fallback;
  return value;
}

function sanitizeNonNegativeMs(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  // Sehr kleine positive Werte erlaubt (>=0.001ms), aber nichts <=0.
  if (value <= 0) return 0.001;
  return value;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function makeEmptyLike(buffer: AudioBufferLike | null | undefined): AudioBufferLike {
  return {
    sampleRate: buffer?.sampleRate ?? 48000,
    numberOfChannels: buffer?.numberOfChannels ?? 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

function copyBuffer(buffer: AudioBufferLike): AudioBufferLike {
  const ch = Math.max(0, buffer.numberOfChannels);
  const len = Math.max(0, buffer.length);
  const channels: Float32Array[] = [];
  for (let c = 0; c < ch; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);
    dst.set(src);
    channels.push(dst);
  }
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: ch,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= ch) {
        throw new RangeError(`channel ${c} out of range (0..${ch - 1})`);
      }
      return channels[c];
    },
  };
}

// --- Public API --------------------------------------------------------------

/**
 * Wendet einen offline-Sidechain-Pump auf einen Buffer an. Liefert einen NEUEN
 * Buffer (Input wird nicht mutiert). Jeder Kanal traegt seinen eigenen
 * envelope-Follower; das Trigger-Pattern ist global.
 *
 * Edge-Cases:
 *   - empty / null buffer            -> empty buffer
 *   - missing triggerPattern         -> Identity-Copy (kein Effekt)
 *   - empty triggerPattern           -> Identity-Copy
 *   - all-false triggerPattern       -> Identity (envelope bleibt bei 1.0)
 *   - all-true triggerPattern        -> konstant ducked (steady-state)
 *   - duckDb=0                       -> targetGain=1 -> kein Effekt
 *   - duckDb>0                       -> upward boost (offen gelassen)
 *   - NaN options                    -> default fallbacks
 *   - bpm<=0 / stepsPerBeat<=0       -> defaults
 *   - attackMs<=0 / releaseMs<=0     -> 0.001 (vermeidet div-by-zero)
 */
export function applySidechain(
  buffer: AudioBufferLike,
  options: SidechainOptions,
): AudioBufferLike {
  // Defensive: missing buffer
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return makeEmptyLike(buffer);
  }

  // Defensive: missing or empty triggerPattern -> Identity-Copy
  const pattern = options?.triggerPattern as readonly boolean[] | undefined;
  if (!pattern || typeof pattern.length !== "number" || pattern.length === 0) {
    return copyBuffer(buffer);
  }

  // Resolve + sanitize parameters
  const bpm = sanitizePositive(options.bpm, DEFAULT_BPM);
  const stepsPerBeat = sanitizePositive(options.stepsPerBeat, DEFAULT_STEPS_PER_BEAT);
  const duckDb = sanitizeFinite(options.duckDb, DEFAULT_DUCK_DB);
  const attackMs = sanitizeNonNegativeMs(options.attackMs, DEFAULT_ATTACK_MS);
  const releaseMs = sanitizeNonNegativeMs(options.releaseMs, DEFAULT_RELEASE_MS);

  const sampleRate = buffer.sampleRate > 0 ? buffer.sampleRate : 48000;
  const chCount = buffer.numberOfChannels;
  const len = buffer.length;

  // Step-Dauer in Samples. Floor=1 vermeidet currentStep=Infinity bei extremem
  // BPM oder stepsPerBeat. Kein hard-rounding (float ist ok hier — floor() im
  // Loop liefert eine stabile Step-Zuordnung).
  const stepDurationSec = 60 / bpm / stepsPerBeat;
  const stepDurationSamples = Math.max(1, stepDurationSec * sampleRate);

  // Envelope-Follower-Koeffizienten:
  //   coef = exp(-1 / (ms * sr / 1000))
  // attackCoef beschreibt das "Sinken" von 1.0 -> targetGain (duck),
  // releaseCoef das "Steigen" zurueck Richtung 1.0.
  const attackSamples = Math.max(1, (attackMs * sampleRate) / 1000);
  const releaseSamples = Math.max(1, (releaseMs * sampleRate) / 1000);
  const attackCoef = Math.exp(-1 / attackSamples);
  const releaseCoef = Math.exp(-1 / releaseSamples);

  // Pre-compute targetGain fuer trigger=true (linear domain).
  const duckedGain = dbToLinear(duckDb);
  const openGain = 1.0;

  const patternLen = pattern.length;
  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    // Envelope startet "offen" (kein Duck-Zustand) — der erste Trigger laesst
    // ihn dann auf duckedGain absinken via attackCoef.
    let envelope = openGain;

    for (let i = 0; i < len; i++) {
      const currentStep = Math.floor(i / stepDurationSamples) % patternLen;
      const triggered = pattern[currentStep] === true;
      const targetGain = triggered ? duckedGain : openGain;

      // One-pole follower:
      //   Wenn target < envelope -> ducking (sinken) -> attackCoef.
      //   Sonst -> release (steigen) -> releaseCoef.
      const coef = targetGain < envelope ? attackCoef : releaseCoef;
      envelope = targetGain + (envelope - targetGain) * coef;

      dst[i] = src[i] * envelope;
    }

    channels.push(dst);
  }

  return {
    sampleRate,
    numberOfChannels: chCount,
    length: len,
    getChannelData: (c: number) => {
      if (c < 0 || c >= chCount) {
        throw new RangeError(`channel ${c} out of range (0..${chCount - 1})`);
      }
      return channels[c];
    },
  };
}

// --- Presets -----------------------------------------------------------------

/**
 * Curated Presets — von subtle bis EDM-pumpend. Stabile Reihenfolge fuer UIs.
 */
export const SIDECHAIN_PRESETS: readonly {
  id: string;
  name: string;
  duckDb: number;
  attackMs: number;
  releaseMs: number;
}[] = [
  { id: "subtle-pump", name: "Subtle Pump", duckDb: -6, attackMs: 5, releaseMs: 250 },
  { id: "edm-pump", name: "EDM Pump", duckDb: -18, attackMs: 1, releaseMs: 180 },
  { id: "heavy", name: "Heavy Duck", duckDb: -24, attackMs: 0.5, releaseMs: 120 },
  { id: "ambient", name: "Ambient", duckDb: -3, attackMs: 20, releaseMs: 400 },
];
