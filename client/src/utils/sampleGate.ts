/**
 * Synthstudio - sampleGate.ts (v3.228.0)
 *
 * Pure-DSP Hard Noise-Gate (linear thresholds, kein-knee, mit Hysteresis):
 *   Eine simplere Variante von applyNoiseGate (sampleNoiseGate.ts, v3.186).
 *   Wahrend sampleNoiseGate dB-Thresholds + hysteresisDb-Offset verwendet,
 *   nutzt dieser Helper LINEARE Thresholds (0..1) und einen EXPLIZITEN
 *   closeThreshold-Parameter — UI-freundlicher fuer simple Slider-Bindings
 *   (zwei direkte 0..1 Slider statt dB-Math + Offset).
 *
 * "Hard" bedeutet: kein soft-knee am Threshold — der State-Flip ist binaer.
 * Die Ramps (attackMs/releaseMs) bleiben jedoch erhalten (klick-frei).
 *
 * Pure & DOM-frei -> Node-testbar. Eingaben werden nie mutiert.
 *
 * --- Pinned Choices (Spec-Ambiguities aufgeloest) -------------------------
 *
 * Pin #1 (closeThreshold > openThreshold): SWAP statt both=0.05.
 *   Rationale: "both=0.05" wuerde User-Intent silent zerstoeren. Swap
 *   preserviert beide Werte und matched "User hat die zwei Felder vertauscht".
 *
 * Pin #2 (attackMs<=0 / releaseMs<=0): -> 1 (statt nur <0).
 *   Rationale: attackMs=0 wuerde 1/attackSamples = div-by-zero verursachen.
 *   Mirror sampleNoiseGate.ts:72 (sanitizePositiveMs returns 1 fuer value<=0).
 *
 * Pin #3 (Threshold-Vergleiche): STRICT >, NICHT >=.
 *   Rationale: defensive Test "openThreshold>1 -> 1" wird zum no-op-Gate
 *   nur wenn strict-greater verglichen wird (kein Sample kann amp>1 sein
 *   bei sauberen Float32-PCM-Inputs). Mirror sampleNoiseGate.ts.
 *
 * Pin #4 (Init): Smart-init analog sampleNoiseGate.
 *   gateOpen = firstEnv > openThreshold; coeff = gateOpen ? 1 : 0.
 *   Vermeidet leading attack-ramp bei "all-loud -> identity" Test.
 *
 * Pin #5 (Per-Channel-State): unabhaengig pro Channel, kein Cross-Coupling.
 *   Mirror sampleNoiseGate.ts. Matches AudioEngine-Convention.
 *
 * Tests: tests/features/sample-gate.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// --- Public Types ----------------------------------------------------------

export interface GateOptions {
  /** Linear envelope to OPEN gate. 0..1. Default 0.1. */
  openThreshold?: number;
  /** Linear envelope to CLOSE gate (hysteresis). 0..1. Default 0.05. */
  closeThreshold?: number;
  /** Attack time in ms (open ramp). Default 1. */
  attackMs?: number;
  /** Release time in ms (close ramp). Default 50. */
  releaseMs?: number;
}

// --- Constants / Defaults --------------------------------------------------

export const DEFAULT_OPEN_THRESHOLD = 0.1;
export const DEFAULT_CLOSE_THRESHOLD = 0.05;
export const DEFAULT_ATTACK_MS = 1;
export const DEFAULT_RELEASE_MS = 50;

/** Spec-Caps fuer Ramp-Zeiten. */
const MAX_ATTACK_MS = 100;
const MAX_RELEASE_MS = 1000;
const MIN_RELEASE_MS = 1;

/** Minimum ramp duration in samples — avoids divide-by-zero. */
const MIN_RAMP_SAMPLES = 1;

const FALLBACK_SAMPLE_RATE = 48000;

// --- Internal Sanitizers ---------------------------------------------------

/**
 * Sanitize a 0..1 linear threshold.
 * NaN / undefined / <0 -> fallback. >1 -> clamp to 1.
 */
function sanitizeThreshold(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return fallback;
  if (value > 1) return 1;
  return value;
}

/**
 * Sanitize attackMs.
 * NaN / undefined / <=0 -> 1. >100 -> 100.
 */
function sanitizeAttackMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_ATTACK_MS;
  if (!Number.isFinite(value)) return DEFAULT_ATTACK_MS;
  if (value <= 0) return 1;
  if (value > MAX_ATTACK_MS) return MAX_ATTACK_MS;
  return value;
}

/**
 * Sanitize releaseMs.
 * NaN / undefined / <1 -> 50. >1000 -> 1000.
 */
function sanitizeReleaseMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RELEASE_MS;
  if (!Number.isFinite(value)) return DEFAULT_RELEASE_MS;
  if (value < MIN_RELEASE_MS) return DEFAULT_RELEASE_MS;
  if (value > MAX_RELEASE_MS) return MAX_RELEASE_MS;
  return value;
}

// --- Public API ------------------------------------------------------------

/**
 * Applies a hard noise gate to a buffer. Returns a NEW buffer (input is not
 * mutated). Each channel has independent gate state.
 *
 * Behaviour:
 *   - amp > openThreshold && state==closed -> open
 *   - amp < closeThreshold && state==open  -> close
 *   - When open: coeff ramps up over attackMs (linear).
 *   - When closed: coeff ramps down over releaseMs (linear).
 *   - Output = input * coeff per sample.
 *
 * Edge-Cases:
 *   - empty / null buffer            -> empty buffer (same shape signature)
 *   - openThreshold > 1              -> clamped to 1 (effectively no-op gate)
 *   - closeThreshold > openThreshold -> SWAP (pin #1)
 *   - NaN / undefined inputs         -> default fallbacks
 */
export function applyGate(
  buffer: AudioBufferLike,
  opts: GateOptions = {},
): AudioBufferLike {
  const sampleRate = buffer?.sampleRate ?? FALLBACK_SAMPLE_RATE;
  const chCount = buffer?.numberOfChannels ?? 0;
  const len = buffer?.length ?? 0;

  // Empty-Buffer-Shortcut
  if (!buffer || len === 0 || chCount === 0) {
    return {
      sampleRate,
      numberOfChannels: chCount,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }

  // Resolve + sanitize parameters
  let openThreshold = sanitizeThreshold(opts.openThreshold, DEFAULT_OPEN_THRESHOLD);
  let closeThreshold = sanitizeThreshold(opts.closeThreshold, DEFAULT_CLOSE_THRESHOLD);
  const attackMs = sanitizeAttackMs(opts.attackMs);
  const releaseMs = sanitizeReleaseMs(opts.releaseMs);

  // Pin #1: swap if user has them backwards.
  if (closeThreshold > openThreshold) {
    const tmp = openThreshold;
    openThreshold = closeThreshold;
    closeThreshold = tmp;
  }

  // Pre-compute ramp steps (linear).
  const attackSamples = Math.max(MIN_RAMP_SAMPLES, (attackMs * sampleRate) / 1000);
  const releaseSamples = Math.max(MIN_RAMP_SAMPLES, (releaseMs * sampleRate) / 1000);
  const attackStep = 1 / attackSamples;
  const releaseStep = 1 / releaseSamples;

  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    // Pin #4: smart-init — if first sample already above openThreshold,
    // start with gateOpen + coeff=1 (no spurious leading attack ramp on
    // an "already loud" input). Otherwise start closed.
    const firstEnv = Math.abs(src[0]);
    let gateOpen = firstEnv > openThreshold;
    let coeff = gateOpen ? 1 : 0;

    for (let i = 0; i < len; i++) {
      const envelope = Math.abs(src[i]);

      // Pin #3: STRICT >/< on both thresholds.
      // Hysteresis: must drop below closeThreshold (not openThreshold!).
      if (gateOpen) {
        if (envelope < closeThreshold) {
          gateOpen = false;
        }
      } else {
        if (envelope > openThreshold) {
          gateOpen = true;
        }
      }

      if (gateOpen) {
        coeff += attackStep;
        if (coeff > 1) coeff = 1;
      } else {
        coeff -= releaseStep;
        if (coeff < 0) coeff = 0;
      }

      dst[i] = src[i] * coeff;
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
