/**
 * Synthstudio – sampleNormalizeBatch.ts (v3.171.0)
 *
 * Batch-Normalize für mehrere Samples auf ein gemeinsames Loudness-Target.
 * Foundation für Sample-Browser Multi-Select Normalize-Action.
 *
 * Drei Modi:
 *  - "uniform-peak"  : alle Samples auf denselben Target-Peak (default -1 dBTP)
 *  - "match-loudest" : alle auf das Niveau des lautesten Inputs
 *  - "relative-mix"  : Relations bleiben, lautestes Sample landet am Target
 *
 * Schutz vor exzessivem Boost via maxBoostDb (default +24 dB).  Silente Samples
 * (peak = -Infinity oder < -90 dBTP) werden durchgereicht ohne Gain.
 *
 * Public API:
 *  - batchNormalizeSamples(inputs, options?) → BatchNormalizeResult
 *
 * Verwendet sampleAutoNormalize-Primitives (analyzeSamplePeak, applyGainToBuffer).
 * Die Gain-Math passiert hier lokal, weil computeNormalizeGain intern bereits
 * bei +24 dB cappt — wir wollen den User-konfigurierbaren maxBoostDb-Cap
 * korrekt anwenden und cappedCount sauber zählen.
 *
 * Pure & Node-testbar (DOM-frei).
 */

import { analyzeSamplePeak, applyGainToBuffer } from "./sampleAutoNormalize";
import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const DEFAULT_TARGET_DBTP = -1;
const DEFAULT_MAX_BOOST_DB = 24;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface BatchNormalizeInput {
  id: string;
  buffer: AudioBufferLike;
}

export type BatchNormalizeMode =
  | "uniform-peak"
  | "relative-mix"
  | "match-loudest";

export interface BatchNormalizeOptions {
  /** Default "uniform-peak". */
  mode?: BatchNormalizeMode;
  /** Target dBTP. Default -1 (Streaming-Standard). */
  targetDbTp?: number;
  /** Cap pro Sample (Schutz vor zu starkem Boost). Default +24 dB. */
  maxBoostDb?: number;
}

export interface BatchNormalizeResultEntry {
  id: string;
  /** Original peak in dBTP (vor Normalize). */
  originalDbTp: number;
  /** Tatsächlich angewandter Gain in dB (nach maxBoostDb-Cap). */
  gainAppliedDb: number;
  /** Buffer nach Gain-Anwendung. */
  buffer: AudioBufferLike;
}

export interface BatchNormalizeResult {
  entries: BatchNormalizeResultEntry[];
  /** Loudest Sample im Input (vor Normalize). */
  loudestOriginalDbTp: number;
  /** Quietest Sample im Input. */
  quietestOriginalDbTp: number;
  /** Effective Target dBTP für die Operation. */
  effectiveTargetDbTp: number;
  /** Anzahl Samples, deren Boost > maxBoostDb gewesen wäre und gecappt wurde. */
  cappedCount: number;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

const VALID_MODES: ReadonlySet<BatchNormalizeMode> = new Set([
  "uniform-peak",
  "relative-mix",
  "match-loudest",
]);

function sanitizeOptions(options?: BatchNormalizeOptions): Required<BatchNormalizeOptions> {
  const rawMode = options?.mode;
  const mode: BatchNormalizeMode =
    rawMode && VALID_MODES.has(rawMode) ? rawMode : "uniform-peak";

  const rawTarget = options?.targetDbTp;
  const targetDbTp = Number.isFinite(rawTarget) ? (rawTarget as number) : DEFAULT_TARGET_DBTP;

  const rawCap = options?.maxBoostDb;
  let maxBoostDb = Number.isFinite(rawCap) ? (rawCap as number) : DEFAULT_MAX_BOOST_DB;
  if (maxBoostDb < 0) maxBoostDb = 0;

  return { mode, targetDbTp, maxBoostDb };
}

function isSilent(dbTp: number): boolean {
  return !Number.isFinite(dbTp);
}

/**
 * Wandelt gewünschten dB-Boost in linearen Faktor. Pure.
 */
function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Normalisiert mehrere Samples auf ein gemeinsames Loudness-Target.
 *
 * Verhalten:
 *  - Empty inputs → leeres Result mit loudest=-Infinity, quietest=Infinity.
 *  - Silente Samples (peak nicht endlich) werden durchgereicht (gain=0 dB).
 *  - Bei mode "match-loudest" mit nur silenten Inputs: alle pass-through.
 *  - Bei mode "relative-mix" mit nur silenten Inputs: alle pass-through
 *    (master-gain wäre +Infinity).
 *
 * Die per-Sample Gain-Math passiert lokal (nicht via computeNormalizeGain),
 * damit user-supplied maxBoostDb < 24 dB korrekt anwendbar ist und
 * cappedCount sauber zählbar bleibt.
 */
export function batchNormalizeSamples(
  inputs: readonly BatchNormalizeInput[],
  options?: BatchNormalizeOptions,
): BatchNormalizeResult {
  const { mode, targetDbTp, maxBoostDb } = sanitizeOptions(options);

  if (!inputs || inputs.length === 0) {
    return {
      entries: [],
      loudestOriginalDbTp: -Infinity,
      quietestOriginalDbTp: Infinity,
      effectiveTargetDbTp: targetDbTp,
      cappedCount: 0,
    };
  }

  // Phase 1: analyse all inputs.
  const analyses: { id: string; buffer: AudioBufferLike; originalDbTp: number }[] = [];
  let loudest = -Infinity;
  let quietest = Infinity;

  for (const inp of inputs) {
    const analysis = analyzeSamplePeak(inp.buffer);
    const dbTp = analysis.peakDbTp;
    analyses.push({ id: inp.id, buffer: inp.buffer, originalDbTp: dbTp });
    if (Number.isFinite(dbTp)) {
      if (dbTp > loudest) loudest = dbTp;
      if (dbTp < quietest) quietest = dbTp;
    }
  }

  const anyAudible = Number.isFinite(loudest);

  // Phase 2: choose effective target per mode.
  let effectiveTargetDbTp: number;
  if (mode === "match-loudest") {
    // Wenn nichts audible ist, fällt das Target auf default zurück
    // (informativ; per-sample-loop reicht stille Inputs sowieso durch).
    effectiveTargetDbTp = anyAudible ? loudest : targetDbTp;
  } else {
    // "uniform-peak" + "relative-mix"
    effectiveTargetDbTp = targetDbTp;
  }

  // Phase 3: per-input gain.
  let cappedCount = 0;
  const entries: BatchNormalizeResultEntry[] = [];

  // Für "relative-mix": Master-Verschiebung berechnen (gleiche Gain für alle audiblen Samples).
  // Bei nur-silent Inputs: master = 0 (pass-through).
  const relativeMasterDb =
    mode === "relative-mix" && anyAudible ? effectiveTargetDbTp - loudest : 0;

  for (const a of analyses) {
    // Silent → pass-through.
    if (isSilent(a.originalDbTp)) {
      entries.push({
        id: a.id,
        originalDbTp: a.originalDbTp,
        gainAppliedDb: 0,
        buffer: a.buffer,
      });
      continue;
    }

    let rawGainDb: number;
    if (mode === "uniform-peak") {
      rawGainDb = effectiveTargetDbTp - a.originalDbTp;
    } else if (mode === "match-loudest") {
      // Wenn nichts audible (sollte nicht herkommen weil silent oben gefiltert),
      // aber defensiv: dann 0.
      rawGainDb = anyAudible ? loudest - a.originalDbTp : 0;
    } else {
      // relative-mix
      rawGainDb = relativeMasterDb;
    }

    let appliedGainDb = rawGainDb;
    if (rawGainDb > maxBoostDb) {
      appliedGainDb = maxBoostDb;
      cappedCount += 1;
    }

    const gainLinear = dbToLinear(appliedGainDb);
    const newBuffer =
      appliedGainDb === 0 ? a.buffer : applyGainToBuffer(a.buffer, gainLinear);

    entries.push({
      id: a.id,
      originalDbTp: a.originalDbTp,
      gainAppliedDb: appliedGainDb,
      buffer: newBuffer,
    });
  }

  return {
    entries,
    loudestOriginalDbTp: loudest,
    quietestOriginalDbTp: quietest,
    effectiveTargetDbTp,
    cappedCount,
  };
}
