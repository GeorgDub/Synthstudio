/**
 * e2PatternToSynthstudio — mappt ein vom Gerät gepulltes, dekodiertes E2-Pattern
 * (decodePatternBody) auf ein SynthStudio-`PatternData`, das der DrumMachine-
 * Store via `addPatternData` / `addPatternsData` aufnehmen kann.
 *
 * Rein & seiteneffektfrei (kein Store-Zugriff) → in Node testbar. Der Store-Aufruf
 * passiert im Caller (useE2sDeviceStore.importPulledPattern).
 *
 * Mapping-Entscheidungen (dokumentiert):
 *  - stepLength (16/32/64) → stepCount 1:1.
 *  - E2 hat immer 16 Parts → 16 SynthStudio-Parts (leere bleiben leer, damit die
 *    Struktur dem Gerät entspricht). Part-Name = "P<n>" (+ Sample-Ref falls > 0).
 *  - Step: active→active, velocity→velocity (0..127, 0 → 1 als Minimum).
 *  - pitch: relativ zur E2-Default-Note 0x48 (C5) → note − 0x48 Halbtöne, sodass
 *    der Normalfall (Note 0x48) pitch 0 ergibt und echte Melodien relativ erhalten
 *    bleiben. E2 gate/gateLen haben in SynthStudio (Step-Grid) kein Pendant → verworfen.
 *  - Part-Volume (0..127) → 0..1; Pan (0..127, 64=center) → −1..+1.
 */
import {
  DEFAULT_CHANNEL_FX,
  type PatternData,
  type PartData,
  type StepData,
} from "../../audio/AudioEngine";
import type { E2PatternDecoded, E2PartDecoded } from "./e2Sysex";

/** E2-Default-Note (C5) — Referenz für die Pitch-Umrechnung. */
export const E2_DEFAULT_NOTE = 0x48;

function makeId(seed: string): string {
  // Deterministischer, aber eindeutiger Platzhalter; der Store regeneriert IDs
  // ohnehin in addPatternData/addPatternsData. Kein Date.now()/random hier, damit
  // die Funktion pur & testbar bleibt.
  return `e2imp-${seed}`;
}

function mapStep(step: E2PartDecoded["steps"][number]): StepData {
  return {
    active: step.active,
    velocity: Math.max(1, Math.min(127, step.velocity || 1)),
    pitch: step.note - E2_DEFAULT_NOTE,
  };
}

function mapPart(part: E2PartDecoded, index: number): PartData {
  const hasSample = part.sampleRef > 0;
  return {
    id: makeId(`p${index}`),
    name: hasSample ? `P${index + 1} · #${part.sampleRef}` : `P${index + 1}`,
    muted: false,
    soloed: false,
    volume: Math.max(0, Math.min(1, part.volume / 127)),
    pan: Math.max(-1, Math.min(1, (part.pan - 64) / 64)),
    steps: part.steps.map(mapStep),
    fx: { ...DEFAULT_CHANNEL_FX },
  };
}

/**
 * Baut ein SynthStudio-`PatternData` aus einem dekodierten E2-Pattern.
 * @param opts.fallbackName Name, falls das Pattern keinen (nutzbaren) trägt.
 */
export function e2PatternToSynthstudio(
  decoded: E2PatternDecoded,
  opts: { fallbackName?: string } = {}
): PatternData {
  const stepCount = (
    decoded.stepLength === 32 || decoded.stepLength === 64
      ? decoded.stepLength
      : 16
  ) as 16 | 32 | 64;
  const name = decoded.name?.trim() || opts.fallbackName || "E2 Import";
  const bpm =
    Number.isFinite(decoded.bpm) && decoded.bpm >= 20 && decoded.bpm <= 300
      ? decoded.bpm
      : null;
  return {
    id: makeId(name),
    name,
    stepCount,
    stepResolution: "1/16",
    bpm,
    parts: decoded.parts.map(mapPart),
  };
}
