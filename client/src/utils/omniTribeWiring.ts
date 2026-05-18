/**
 * omniTribeWiring.ts — Mapping-Konstanten + Helper-API fuer Panel ↔ Bridge.
 *
 * SoT: SYNTHSTUDIO_INTEGRATION.md §5 (Mapping-Tabelle SynthStudio-Panel → NRPN).
 *
 * Adress-Konvention aus dem NRPN-Spec (host/omnitribe/docs/midi/nrpn_spec.md):
 *   paramLow LSB = (paramPid & 0x0F) | ((part & 0x0F) << 4)
 *
 * Helper:
 *   - clampPartIndex(p)            — 0..15, NaN→0
 *   - uiToMidi(v, lo=0, hi=1)      — UI-Range → 0..127 Int (Linear)
 *   - midiToUi(v, lo=0, hi=1)      — 0..127 Int → UI-Range
 *   - sendGranularParam(...) etc.  — wrappt Throttle + isConnected-Check
 *
 * Wichtig: Alle send*-Funktionen sind NO-OPs wenn die Bridge nicht
 * connected ist. Synthstudio bleibt damit vollstaendig funktional ohne
 * OmniTribe-Hardware (CLAUDE.md isomorphic invariant).
 */

import { omniTribeBridge } from "@/audio/OmniTribeBridge";
import { makeThrottledSender } from "@/utils/omniTribeThrottle";

// ─── NRPN-Adress-Konstanten ──────────────────────────────────────────────────

/** Granular-Modul: paramHigh = 0x19, paramLow LSB-PIDs */
export const OMNITRIBE_GRANULAR = {
  PARAM_HIGH:  0x19,
  GRAIN_SIZE:  0x00,
  DENSITY:     0x01,
  PITCH_SCATTER: 0x02,
  POSITION:    0x03,
  SPRAY:       0x04,
  FEEDBACK:    0x05,
} as const;

/** Wavetable-Modul: paramHigh = 0x07 */
export const OMNITRIBE_WAVETABLE = {
  PARAM_HIGH:   0x07,
  FRAME_POSITION: 0x01,
  MORPH_SPEED:    0x02,
} as const;

/** Euclidean-Modul: paramHigh = 0x11 */
export const OMNITRIBE_EUCLIDEAN = {
  PARAM_HIGH: 0x11,
  N_STEPS:    0x00,
  K_HITS:     0x01,
  ROTATION:   0x02,
  ENABLE:     0x03,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Klammert den Part-Index auf 0..15 (NaN/negative → 0, >15 → 15). */
export function clampPartIndex(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p < 0) return 0;
  if (p > 15) return 15;
  return Math.floor(p);
}

/** Skaliert UI-Wert in [lo..hi] auf MIDI 0..127 (gerundet, geclampt). */
export function uiToMidi(v: number, lo = 0, hi = 1): number {
  if (!Number.isFinite(v)) return 0;
  if (hi === lo) return 0;
  const norm = (v - lo) / (hi - lo);
  const i = Math.round(norm * 127);
  if (i < 0) return 0;
  if (i > 127) return 127;
  return i;
}

/** Umkehrung uiToMidi — MIDI 0..127 → UI-Range [lo..hi] (Float). */
export function midiToUi(v: number, lo = 0, hi = 1): number {
  if (!Number.isFinite(v)) return lo;
  const norm = Math.max(0, Math.min(127, v)) / 127;
  return lo + norm * (hi - lo);
}

/**
 * Baut paramLow (LSB) aus pid + part nach NRPN-Konvention.
 *   bits[7:4] = part & 0x0F
 *   bits[3:0] = pid  & 0x0F
 */
export function buildParamLow(pid: number, part: number): number {
  return ((clampPartIndex(part) << 4) | (pid & 0x0F)) & 0x7F;
}

// ─── Throttled Sender (60 Hz pro Param-Key) ──────────────────────────────────

type SendArgs = [part: number, paramHigh: number, paramLow: number, value: number];

const throttled = makeThrottledSender<SendArgs>(
  ([part, ph, pl, value]) => {
    omniTribeBridge.setParam(part, ph, pl, value);
  },
  { minIntervalMs: 16 },
);

/** Test-Hook: erlaubt Tests die Throttle-Queue zu flushen. */
export function __flushOmniTribeSends(): void {
  throttled.flush();
}

/** Test-Hook: erlaubt Tests die Throttle-Queue zu canceln. */
export function __cancelOmniTribeSends(): void {
  throttled.cancel();
}

/**
 * Generischer Send-Wrapper. NO-OP wenn Bridge nicht connected (isomorphic).
 * Routet ueber den Throttler — der trailing-edge garantiert dass Slider-
 * Release-Wert immer ankommt.
 */
export function sendNrpn(part: number, paramHigh: number, paramLow: number, value: number): void {
  if (!omniTribeBridge.isConnected) return;
  const p = clampPartIndex(part);
  const key = `${p}:${paramHigh}:${paramLow}`;
  throttled.send(key, [p, paramHigh & 0x7F, paramLow & 0x7F, value & 0x3FFF]);
}

// ─── High-Level: Granular / Wavetable / Euclidean ────────────────────────────

export type GranularParamKey =
  | "grainSize" | "density" | "pitchScatter"
  | "position" | "spray" | "feedback";

/** Mapping UI-Param-Key → Granular-PID. */
const GRANULAR_PID: Record<GranularParamKey, number> = {
  grainSize:    OMNITRIBE_GRANULAR.GRAIN_SIZE,
  density:      OMNITRIBE_GRANULAR.DENSITY,
  pitchScatter: OMNITRIBE_GRANULAR.PITCH_SCATTER,
  position:     OMNITRIBE_GRANULAR.POSITION,
  spray:        OMNITRIBE_GRANULAR.SPRAY,
  feedback:     OMNITRIBE_GRANULAR.FEEDBACK,
};

/**
 * Sendet einen Granular-Param-Wert (UI 0..1 Float, ausser pitchScatter→0..200ct).
 * Internal: skaliert auf MIDI 0..127, baut paramLow, ruft sendNrpn.
 */
export function sendGranularParam(part: number, key: GranularParamKey, uiValue: number): void {
  const pid = GRANULAR_PID[key];
  const pl  = buildParamLow(pid, part);
  // Per-Key Wert-Range: meiste 0..1, density 1..50, pitchScatter 0..200, grainSize 10..500
  let midi: number;
  switch (key) {
    case "grainSize":    midi = uiToMidi(uiValue, 10, 500); break;
    case "density":      midi = uiToMidi(uiValue, 1, 50); break;
    case "pitchScatter": midi = uiToMidi(uiValue, 0, 200); break;
    default:             midi = uiToMidi(uiValue, 0, 1);   break;
  }
  sendNrpn(part, OMNITRIBE_GRANULAR.PARAM_HIGH, pl, midi);
}

/** Umkehrung: MIDI-Wert → UI-Range fuer Granular-Param. */
export function midiToGranularUi(key: GranularParamKey, midi: number): number {
  switch (key) {
    case "grainSize":    return midiToUi(midi, 10, 500);
    case "density":      return midiToUi(midi, 1, 50);
    case "pitchScatter": return midiToUi(midi, 0, 200);
    default:             return midiToUi(midi, 0, 1);
  }
}

/** Decodiert paramLow → {pid, part}. */
export function decodeParamLow(paramLow: number): { pid: number; part: number } {
  return {
    pid:  paramLow & 0x0F,
    part: (paramLow >> 4) & 0x0F,
  };
}

/** Decodiert Granular-PID → UI-Key (oder null wenn unbekannt). */
export function granularPidToKey(pid: number): GranularParamKey | null {
  switch (pid & 0x0F) {
    case OMNITRIBE_GRANULAR.GRAIN_SIZE:     return "grainSize";
    case OMNITRIBE_GRANULAR.DENSITY:        return "density";
    case OMNITRIBE_GRANULAR.PITCH_SCATTER:  return "pitchScatter";
    case OMNITRIBE_GRANULAR.POSITION:       return "position";
    case OMNITRIBE_GRANULAR.SPRAY:          return "spray";
    case OMNITRIBE_GRANULAR.FEEDBACK:       return "feedback";
    default: return null;
  }
}

// ─── Wavetable ───────────────────────────────────────────────────────────────

export type WavetableParamKey = "framePosition" | "morphSpeed";

const WAVETABLE_PID: Record<WavetableParamKey, number> = {
  framePosition: OMNITRIBE_WAVETABLE.FRAME_POSITION,
  morphSpeed:    OMNITRIBE_WAVETABLE.MORPH_SPEED,
};

/** Sendet Wavetable-Param (UI 0..1 Float). */
export function sendWavetableParam(part: number, key: WavetableParamKey, uiValue: number): void {
  const pid = WAVETABLE_PID[key];
  const pl  = buildParamLow(pid, part);
  sendNrpn(part, OMNITRIBE_WAVETABLE.PARAM_HIGH, pl, uiToMidi(uiValue, 0, 1));
}

export function wavetablePidToKey(pid: number): WavetableParamKey | null {
  switch (pid & 0x0F) {
    case OMNITRIBE_WAVETABLE.FRAME_POSITION: return "framePosition";
    case OMNITRIBE_WAVETABLE.MORPH_SPEED:    return "morphSpeed";
    default: return null;
  }
}

/**
 * Sendet einen Wavetable-Upload an die Bridge (slot, frames).
 * NO-OP wenn nicht connected. Kein Throttling — Upload ist ein
 * Einzelereignis (User-Trigger), nicht ein Slider-Drag.
 */
export function uploadWavetable(slot: number, frames: Float32Array[]): void {
  if (!omniTribeBridge.isConnected) return;
  omniTribeBridge.uploadWavetable(slot & 0x7F, frames);
}

// ─── Euclidean ───────────────────────────────────────────────────────────────

export type EuclideanParamKey = "nSteps" | "kHits" | "rotation" | "enable";

const EUCLIDEAN_PID: Record<EuclideanParamKey, number> = {
  nSteps:   OMNITRIBE_EUCLIDEAN.N_STEPS,
  kHits:    OMNITRIBE_EUCLIDEAN.K_HITS,
  rotation: OMNITRIBE_EUCLIDEAN.ROTATION,
  enable:   OMNITRIBE_EUCLIDEAN.ENABLE,
};

/** Sendet Euclidean-Param. Werte sind Integers (steps/hits/rot 0..32, enable 0/1). */
export function sendEuclideanParam(part: number, key: EuclideanParamKey, intValue: number): void {
  const pid = EUCLIDEAN_PID[key];
  const pl  = buildParamLow(pid, part);
  const v   = Math.max(0, Math.min(127, Math.round(intValue)));
  sendNrpn(part, OMNITRIBE_EUCLIDEAN.PARAM_HIGH, pl, v);
}
