/**
 * Synthstudio – ESLI Slice ↔ Sample-Slicing Bridge (v3.8.0)
 *
 * Konvertierungs-Layer zwischen
 *   - `E2sSlice`  (e2sBankReader / e2sBankBuilder): start/length/attack/amplitude
 *                 in PCM-frames bzw. 0..N integers
 *   - `OnsetCandidate` (sampleSlicing): frame + strength
 *
 * Damit kann der bestehende `SampleSliceEditor`-Layer (Waveform-Canvas +
 * draggable Markers + autoSlice/addOnset/moveOnset/removeOnset) im
 * KorgBankEditor wiederverwendet werden, ohne dass das ESLI-on-disk-Format
 * bis in die UI durchsickert.
 *
 * Rounding-Konvention:
 *   - ESLI-Slices speichern Integer-Frame-Offsets (i32) bezogen auf den
 *     PCM-Frame-Index (Kanal-unabhängig — Stereo-Slots zählen Frames, nicht
 *     interleaved Samples).
 *   - Beim Konvertieren snappen wir auf Integer-Werte (Math.floor / Math.max).
 *
 * Defaults für noch-nicht-via-UI editierbare Felder:
 *   - attackLength: 0 (kein Envelope-Attack — voller Slice gehört dem Sample)
 *   - amplitude: 0x7FFFFFFF / 2 ≈ 0x40000000 — Default-Gain-Level laut
 *     Oe2sSLE-Konvention. Wir setzen aktuell 0 (device-default fallback).
 *
 * Keine React/DOM-Dependencies — komplett unit-testbar.
 */

import { ESLI_SLICES_COUNT } from "./constants";
import type { E2sSlice } from "./e2sBankReader";
import type { OnsetCandidate } from "@/utils/sampleSlicing";

// ─── Slice (ESLI) → Onset ─────────────────────────────────────────────────────

/**
 * Konvertiert einen einzelnen ESLI-Slice in einen `OnsetCandidate`.
 * Der `frame` ist der Slice-Start (in PCM-frames). `strength` wird auf 1
 * gesetzt, weil ESLI keine Onset-Detection-Strength speichert.
 */
export function esliSliceToOnset(slice: E2sSlice): OnsetCandidate {
  const frame = Math.max(0, Math.floor(slice.start));
  return { frame, strength: 1 };
}

/**
 * Konvertiert einen `OnsetCandidate` + Total-Frame-Information in einen
 * ESLI-Slice.
 *
 * `length` wird zur nächsten Onset-Grenze gebildet — diese muss der Caller
 * an `nextOnsetFrame` durchreichen (oder `totalFrames` für den letzten Slice).
 *
 * `attackLength` und `amplitude` werden auf 0 gesetzt (device defaults).
 */
export function onsetToEsliSlice(
  onset: OnsetCandidate,
  nextFrame: number,
): E2sSlice {
  const start = Math.max(0, Math.floor(onset.frame));
  const length = Math.max(0, Math.floor(nextFrame - start));
  return {
    start,
    length,
    attackLength: 0,
    amplitude: 0,
  };
}

/**
 * Vollständige Konvertierung Slice-Array → Onset-Array.
 *
 * Nur non-empty Slices (length > 0 ODER start > 0) werden zurückgegeben.
 * Reihenfolge ist nach `start` sortiert.
 */
export function slicesToOnsets(slices: E2sSlice[]): OnsetCandidate[] {
  if (!Array.isArray(slices) || slices.length === 0) return [];
  const filtered: OnsetCandidate[] = [];
  for (const s of slices) {
    // Ein Slice ist "leer" wenn alle 4 Felder 0 sind. Aber: Slice 0 mit
    // start=0 und length>0 ist gültig — also nutzen wir die Heuristik
    // "alle 4 Felder == 0" für Empty-Detection.
    if (s.start === 0 && s.length === 0 && s.attackLength === 0 && s.amplitude === 0) {
      continue;
    }
    filtered.push(esliSliceToOnset(s));
  }
  return filtered.sort((a, b) => a.frame - b.frame);
}

/**
 * Vollständige Konvertierung Onset-Array → ESLI-Slice-Array.
 *
 * `length` jedes Slices = (nächster Onset.frame oder totalFrames) - eigener Frame.
 * Cap auf `ESLI_SLICES_COUNT` (64); überzählige Onsets werden verworfen.
 *
 * Onsets mit `frame >= totalFrames` werden gefiltert (defensive).
 */
export function onsetsToSlices(
  onsets: OnsetCandidate[],
  totalFrames: number,
): E2sSlice[] {
  if (!Array.isArray(onsets) || onsets.length === 0 || totalFrames <= 0) {
    return [];
  }
  // Filter: nur in-bounds Onsets
  const inBounds = onsets
    .filter((o) => o.frame >= 0 && o.frame < totalFrames)
    .map((o) => ({ frame: Math.floor(o.frame), strength: o.strength }))
    .sort((a, b) => a.frame - b.frame);

  if (inBounds.length === 0) return [];

  // Cap auf ESLI_SLICES_COUNT — verwerfe Überschuss (max 64).
  const capped = inBounds.slice(0, ESLI_SLICES_COUNT);

  const out: E2sSlice[] = [];
  for (let i = 0; i < capped.length; i++) {
    const start = capped[i].frame;
    const nextFrame = i + 1 < capped.length ? capped[i + 1].frame : totalFrames;
    out.push(onsetToEsliSlice(capped[i], nextFrame));
  }
  return out;
}

/**
 * Slice-Limit als Public-Constant für UI-Code (z.B. Slice-Counter im Editor).
 */
export const MAX_ESLI_SLICES = ESLI_SLICES_COUNT;
