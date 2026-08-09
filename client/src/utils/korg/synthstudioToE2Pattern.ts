/**
 * synthstudioToE2Pattern — Gegenrichtung zu e2PatternToSynthstudio: mappt ein
 * SynthStudio-`PatternData` auf ein `E2PatternInput` und baut daraus einen
 * E2-Pattern-Body (0x4000), der via `E2SysexBridge.pushPattern`/`pushCurrentPattern`
 * auf ein echtes E2/E2S geschrieben werden kann.
 *
 * Rein & seiteneffektfrei. Inverse der Import-Mappings:
 *  - stepCount → stepLength (16/32/64).
 *  - Part-Volume 0..1 → 0..127; Pan −1..+1 → 0..127 (64 = center).
 *  - Step: active/velocity 1:1; note = pitch + E2-Default-Note (0x48);
 *    chordNotes 1:1 durchgereicht (buildE2PatternBody clamped/kürzt auf die
 *    3 Chord-Slots, nur bei aktiven Steps geschrieben — v3.309-Symmetrie
 *    zum Pull-Pfad, der stepChordNotes() aus dem gepullten Body anwendet).
 *  - sampleId: aus dem Part-Namen geparst ("#501" → 501), damit ein Import→Push-
 *    Round-Trip die Sample-Referenz erhält. Fehlt sie, bleibt der Slot leer.
 * buildE2PatternBody clamped note/velocity/pan/volume selbst auf gültige Ranges.
 */
import { buildE2PatternBody } from "../e2sExport";
import type {
  E2PatternInput,
  E2PartInput,
  E2StepInput,
} from "../electribePatternBuilder";
import type { PatternData, PartData, StepData } from "../../audio/AudioEngine";
import { E2_DEFAULT_NOTE } from "./e2PatternToSynthstudio";

/** Extrahiert eine Sample-Nummer aus einem Part-Namen ("P1 · #501" → 501). */
export function parseSampleIdFromName(
  name: string | undefined
): number | undefined {
  const m = /#(\d+)/.exec(name ?? "");
  return m ? Number(m[1]) : undefined;
}

function stepToE2(step: StepData): E2StepInput {
  return {
    active: !!step.active,
    velocity: step.velocity,
    note: E2_DEFAULT_NOTE + (step.pitch ?? 0),
    // v3.309 gave the pull path (DrumMachine.applyE2DecodedToActivePattern)
    // chord-note support via stepChordNotes(decoded step) — but the push
    // direction never carried StepData.chordNotes back into E2StepInput, so
    // a pulled-then-pushed pattern silently lost its chords. buildE2PatternBody
    // already knows how to encode this field (bytes +0x05..+0x07, max 3 notes,
    // 0..127 clamped, only written for active steps) — just pass it through.
    chordNotes: step.chordNotes,
  };
}

function partToE2(part: PartData): E2PartInput {
  return {
    sampleId: parseSampleIdFromName(part.name),
    volume: Math.round((part.volume ?? 1) * 127),
    // −1..+1 → 0..127 mit center 64 (round(63.5) = 64, +1 → 127).
    pan: Math.round(((part.pan ?? 0) + 1) * 63.5),
    steps: (part.steps ?? []).map(stepToE2),
  };
}

/** SynthStudio-`PatternData` → `E2PatternInput`. */
export function synthstudioPatternToE2(
  pattern: PatternData,
  opts: { bpm?: number } = {}
): E2PatternInput {
  const stepLength = (
    pattern.stepCount === 32 || pattern.stepCount === 64
      ? pattern.stepCount
      : 16
  ) as 16 | 32 | 64;
  const bpm =
    typeof opts.bpm === "number"
      ? opts.bpm
      : typeof pattern.bpm === "number"
        ? pattern.bpm
        : 120;
  return {
    name: pattern.name ?? "",
    bpm,
    stepLength,
    // E2 hat genau 16 Parts; überzählige SynthStudio-Parts werden ignoriert.
    parts: (pattern.parts ?? []).slice(0, 16).map(partToE2),
  };
}

/** SynthStudio-`PatternData` → E2-Pattern-Body (0x4000, ohne 0x100-Header). */
export function synthstudioPatternToBody(
  pattern: PatternData,
  opts: { bpm?: number } = {}
): Uint8Array {
  return buildE2PatternBody(synthstudioPatternToE2(pattern, opts));
}
