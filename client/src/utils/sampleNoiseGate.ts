/**
 * Synthstudio - sampleNoiseGate.ts (v3.186.0)
 *
 * Pure-DSP Noise-Gate:
 *   Samples whose instantaneous envelope falls below `thresholdDb` are
 *   attenuated to silence. To avoid clicks, the gate gain coefficient
 *   ramps linearly between 0 and 1 over `attackMs` (open) / `releaseMs`
 *   (close). Hysteresis is provided via `hysteresisDb` so that brief
 *   amplitude dips do not retrigger the gate.
 *
 * Pure & DOM-frei -> Node-testbar. Eingaben werden nie mutiert.
 *
 * --- Design Notes ---------------------------------------------------------
 *
 * Envelope detector: raw |sample|. No one-pole smoothing — keeps the API
 *   surface minimal and the 11 spec-tests tractable. (A one-pole follower
 *   could be added later as an optional EnvelopeMode parameter without
 *   breaking the public API.)
 *
 * Initialization: gate starts OPEN when sample[0] amplitude exceeds the
 *   reopen-threshold, otherwise CLOSED. This makes the "all-loud" identity
 *   test correct (no leading attack-ramp on input that's already above
 *   threshold).
 *
 * State model: single boolean `gateOpen` + scalar `coeff ∈ [0,1]`.
 *   The four notional states (closed/opening/open/closing) collapse into
 *   {gateOpen, coeff} since transitions are externally observable only via
 *   coeff. This is simpler and externally equivalent.
 *
 * Per-channel state: each channel has its own {gateOpen, coeff} pair —
 *   no cross-channel coupling. Matches AudioEngine convention.
 *
 * Tests: tests/features/sample-noise-gate.test.ts
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface NoiseGateOptions {
  /** Threshold in dBFS. Default -40. */
  thresholdDb?: number;
  /** Attack time in ms (open the gate). Default 5. */
  attackMs?: number;
  /** Release time in ms (close the gate). Default 50. */
  releaseMs?: number;
  /** Hysteresis: re-open threshold (dB above thresholdDb). Default 6. */
  hysteresisDb?: number;
}

// ─── Constants / Defaults ────────────────────────────────────────────────────

export const DEFAULT_THRESHOLD_DB = -40;
export const DEFAULT_ATTACK_MS = 5;
export const DEFAULT_RELEASE_MS = 50;
export const DEFAULT_HYSTERESIS_DB = 6;

/** Minimum ramp duration in samples — avoids divide-by-zero. */
const MIN_RAMP_SAMPLES = 1;

// ─── Internal Sanitizers ─────────────────────────────────────────────────────

function sanitizeFiniteDb(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return value;
}

function sanitizePositiveMs(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  if (value <= 0) return 1; // spec: attackMs<=0 -> 1, releaseMs<=0 -> 1
  return value;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Applies a noise gate to a buffer. Returns a NEW buffer (input is not
 * mutated). Each channel has independent gate state.
 *
 * Edge-Cases:
 *   - empty / null buffer            -> empty buffer (same shape signature)
 *   - thresholdDb very low (-100)    -> effectively bypass (most signal above)
 *   - thresholdDb = 0 (full-scale)   -> all signal below 1.0 gated to 0
 *   - NaN / undefined inputs         -> default fallbacks
 */
export function applyNoiseGate(
  buffer: AudioBufferLike,
  options: NoiseGateOptions = {},
): AudioBufferLike {
  const sampleRate = buffer?.sampleRate ?? 48000;
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
  const thresholdDb = sanitizeFiniteDb(options.thresholdDb, DEFAULT_THRESHOLD_DB);
  const attackMs = sanitizePositiveMs(options.attackMs, DEFAULT_ATTACK_MS);
  const releaseMs = sanitizePositiveMs(options.releaseMs, DEFAULT_RELEASE_MS);
  const hysteresisDb = sanitizeFiniteDb(options.hysteresisDb, DEFAULT_HYSTERESIS_DB);

  // Pre-compute linear thresholds and ramp steps
  const thresholdLinear = dbToLinear(thresholdDb);
  const reopenLinear = dbToLinear(thresholdDb + hysteresisDb);

  const attackSamples = Math.max(MIN_RAMP_SAMPLES, (attackMs * sampleRate) / 1000);
  const releaseSamples = Math.max(MIN_RAMP_SAMPLES, (releaseMs * sampleRate) / 1000);

  // Per-sample increment toward target coeff
  const attackStep = 1 / attackSamples;
  const releaseStep = 1 / releaseSamples;

  const channels: Float32Array[] = [];

  for (let c = 0; c < chCount; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(len);

    // Smart-init: decide gate-open state based on first sample's envelope.
    // This avoids a spurious leading attack-ramp on input that already starts
    // above the threshold (e.g. an identity-bypass on a steady tone).
    const firstEnv = Math.abs(src[0]);
    let gateOpen = firstEnv > reopenLinear;
    let coeff = gateOpen ? 1 : 0;

    for (let i = 0; i < len; i++) {
      const envelope = Math.abs(src[i]);

      // State transitions with hysteresis:
      //   - currently open: close when envelope drops STRICTLY below threshold
      //   - currently closed: open when envelope rises STRICTLY above reopen
      // Use strict > so threshold=0dB at amplitude=1.0 stays gated.
      if (gateOpen) {
        if (envelope < thresholdLinear) {
          gateOpen = false;
        }
      } else {
        if (envelope > reopenLinear) {
          gateOpen = true;
        }
      }

      // Step coeff toward target (1 if open, 0 if closed), clamped.
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

// ─── Presets ─────────────────────────────────────────────────────────────────

/**
 * Curated presets covering the most common gating scenarios. Order is
 * stable so UIs can render them as a dropdown.
 */
export const NOISE_GATE_PRESETS: readonly {
  id: string;
  name: string;
  thresholdDb: number;
  attackMs: number;
  releaseMs: number;
}[] = [
  { id: "vocal", name: "Vocal", thresholdDb: -40, attackMs: 2, releaseMs: 80 },
  { id: "drums", name: "Drums", thresholdDb: -30, attackMs: 0.5, releaseMs: 30 },
  { id: "ambient", name: "Ambient", thresholdDb: -55, attackMs: 20, releaseMs: 200 },
  { id: "tight", name: "Tight", thresholdDb: -20, attackMs: 1, releaseMs: 10 },
];
