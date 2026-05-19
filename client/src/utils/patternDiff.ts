/**
 * patternDiff.ts — v3.91.0
 * ------------------------------------------------------------------------
 * Pure utilities to compute the differences between two PatternData snapshots.
 *
 * The Pattern-Compare-Workflow zeigt Step-für-Step die Unterschiede zwischen
 * zwei Pattern-Variationen (z.B. "Verse A" vs "Verse B"). Die Funktion ist
 * frei von React/UI-State und damit voll in Node testbar.
 *
 * Strategy:
 *   1. BPM-Delta: numerisch (treat null als globalBpm "neutral" – wir geben
 *      eindeutig zurück was effektiv gesetzt ist, der UI-Layer formatiert).
 *   2. StepCount-Delta: einfach b.stepCount - a.stepCount.
 *   3. Part-Match: Parts werden per `id` gematched. Was nur in A existiert
 *      → removedPart. Was nur in B existiert → addedPart. Existiert beides
 *      → wir vergleichen Step-für-Step bis zum kleineren stepCount-Maximum.
 *   4. Step-Klassifikation:
 *        - "added"            → a.active=false, b.active=true
 *        - "removed"          → a.active=true,  b.active=false
 *        - "changedVelocity"  → beide aktiv, aber velocity unterscheidet sich
 *   5. Steps außerhalb der jeweiligen Pattern-Länge gelten als inaktiv
 *      (Backfill mit virtual {active:false}-Step). So entstehen z.B. "added"-
 *      Einträge wenn B 64 Steps hat und A nur 32.
 *
 * Wichtig: pure function — kein Mutieren der Inputs, kein Date.now(), keine
 * Math.random(). Damit ist die Funktion in Tests deterministisch.
 */

import type { PatternData, PartData, StepData } from "../audio/AudioEngine";

/** Klassifikation eines einzelnen Step-Unterschieds. */
export type StepDiffKind = "added" | "removed" | "changedVelocity";

export interface StepDiff {
  /** 0-based Step-Index innerhalb des Parts. */
  stepIndex: number;
  /** Art des Unterschieds. */
  kind: StepDiffKind;
  /** Velocity in A (wenn der Step in A vorhanden+aktiv ist). */
  velocityA?: number;
  /** Velocity in B (wenn der Step in B vorhanden+aktiv ist). */
  velocityB?: number;
}

export interface PartDiff {
  /** Eindeutige Part-ID (gleich in A und B wenn beide existieren). */
  partId: string;
  /** Anzeigename — bevorzugt aus B, fallback A. */
  partName: string;
  /**
   * Existiert der Part nur in einer Seite? "added" = nur in B, "removed" =
   * nur in A, undefined = beidseitig vorhanden. Bei einseitigen Parts werden
   * die jeweils aktiven Steps als added/removed gelistet.
   */
  presence?: "added" | "removed";
  /** Steps die nur in B aktiv sind (kind="added"). */
  addedSteps: StepDiff[];
  /** Steps die nur in A aktiv sind (kind="removed"). */
  removedSteps: StepDiff[];
  /** Steps die in beiden aktiv sind, aber andere Velocity haben. */
  changedVelocity: StepDiff[];
}

export interface PatternDiff {
  /** b.bpm - a.bpm (null wenn eine der beiden Seiten null ist). */
  bpmDelta: number | null;
  /** Effektives BPM in A (wie gespeichert, kann null sein). */
  bpmA: number | null;
  /** Effektives BPM in B. */
  bpmB: number | null;
  /** b.stepCount - a.stepCount. */
  stepCountDelta: number;
  /** Roher stepCount aus A. */
  stepCountA: number;
  /** Roher stepCount aus B. */
  stepCountB: number;
  /** Pro Part die detaillierten Step-Unterschiede. Reihenfolge: zuerst Parts
   * die in B existieren (in B-Reihenfolge), dann removed-only Parts aus A. */
  partDiffs: PartDiff[];
}

// ─── Hilfen ─────────────────────────────────────────────────────────────────

/**
 * Liefert einen Step in deterministischer Form: existiert er nicht, geben
 * wir einen virtuellen inaktiven Step zurück (für stepCount-Mismatch).
 */
function safeStep(steps: ReadonlyArray<StepData>, idx: number): StepData {
  return steps[idx] ?? { active: false };
}

/**
 * Effektive Velocity eines Steps. Pattern-Editor speichert oft `undefined`
 * statt Default 100; für den Compare-Workflow ist 100 die akzeptierte
 * Backwards-Compat-Konvention (Engine: VELOCITY_DEFAULT).
 */
function effectiveVelocity(step: StepData): number {
  return typeof step.velocity === "number" ? step.velocity : 100;
}

/**
 * Berechnet die Step-Diffs zwischen zwei Parts. Beide Inputs MÜSSEN
 * dieselbe partId / partName-Welt repräsentieren — die Routing-Logik
 * `diffPatterns` stellt das sicher.
 */
function diffParts(
  a: PartData | undefined,
  b: PartData | undefined,
  maxSteps: number,
  fallbackPartId: string,
  fallbackPartName: string,
): PartDiff {
  const stepsA = a?.steps ?? [];
  const stepsB = b?.steps ?? [];

  const addedSteps:      StepDiff[] = [];
  const removedSteps:    StepDiff[] = [];
  const changedVelocity: StepDiff[] = [];

  for (let i = 0; i < maxSteps; i++) {
    const sa = safeStep(stepsA, i);
    const sb = safeStep(stepsB, i);
    const aOn = !!sa.active;
    const bOn = !!sb.active;

    if (aOn && bOn) {
      const va = effectiveVelocity(sa);
      const vb = effectiveVelocity(sb);
      if (va !== vb) {
        changedVelocity.push({
          stepIndex: i,
          kind: "changedVelocity",
          velocityA: va,
          velocityB: vb,
        });
      }
    } else if (!aOn && bOn) {
      addedSteps.push({
        stepIndex: i,
        kind: "added",
        velocityB: effectiveVelocity(sb),
      });
    } else if (aOn && !bOn) {
      removedSteps.push({
        stepIndex: i,
        kind: "removed",
        velocityA: effectiveVelocity(sa),
      });
    }
    // both inactive → nichts zu melden
  }

  const presence: PartDiff["presence"] =
    a && !b ? "removed" : !a && b ? "added" : undefined;

  return {
    partId:   a?.id   ?? b?.id   ?? fallbackPartId,
    partName: b?.name ?? a?.name ?? fallbackPartName,
    presence,
    addedSteps,
    removedSteps,
    changedVelocity,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Vergleicht zwei PatternData-Snapshots. Reine Funktion — keine Mutation,
 * keine Seiteneffekte.
 *
 * Reihenfolge der `partDiffs`:
 *   1. Alle Parts aus B in deren Reihenfolge (matched oder added).
 *   2. Anschließend Parts die nur in A existieren (presence="removed").
 * Diese Sortierung spiegelt die "B ist Ziel-Variation"-Semantik.
 */
export function diffPatterns(a: PatternData, b: PatternData): PatternDiff {
  const maxSteps = Math.max(a.stepCount, b.stepCount);

  const aPartById = new Map<string, PartData>();
  for (const p of a.parts) aPartById.set(p.id, p);

  const partDiffs: PartDiff[] = [];
  const seenIds = new Set<string>();

  // 1) Parts aus B in B-Reihenfolge.
  for (const partB of b.parts) {
    const partA = aPartById.get(partB.id);
    partDiffs.push(diffParts(partA, partB, maxSteps, partB.id, partB.name));
    seenIds.add(partB.id);
  }

  // 2) Übrig gebliebene Parts aus A (removed).
  for (const partA of a.parts) {
    if (seenIds.has(partA.id)) continue;
    partDiffs.push(diffParts(partA, undefined, maxSteps, partA.id, partA.name));
  }

  const bpmDelta: number | null =
    a.bpm !== null && b.bpm !== null ? b.bpm - a.bpm : null;

  return {
    bpmDelta,
    bpmA:           a.bpm,
    bpmB:           b.bpm,
    stepCountDelta: b.stepCount - a.stepCount,
    stepCountA:     a.stepCount,
    stepCountB:     b.stepCount,
    partDiffs,
  };
}

/**
 * Aggregiert-Summe für UI-Header: "23 added · 4 removed · 7 vel-change".
 */
export function summarizeDiff(diff: PatternDiff): {
  added: number;
  removed: number;
  changedVelocity: number;
} {
  let added = 0, removed = 0, changedVelocity = 0;
  for (const pd of diff.partDiffs) {
    added           += pd.addedSteps.length;
    removed         += pd.removedSteps.length;
    changedVelocity += pd.changedVelocity.length;
  }
  return { added, removed, changedVelocity };
}

/**
 * Liefert die per-Step-Klassifikation für einen bestimmten Part — Helper
 * für die UI um direkt im Grid pro Step die richtige Farbe zu setzen
 * (grün=added, rot=removed, gelb=changedVelocity, undefined=unchanged).
 */
export function classifyPartSteps(
  pd: PartDiff,
  stepCount: number,
): Array<StepDiffKind | undefined> {
  const out: Array<StepDiffKind | undefined> = new Array(stepCount).fill(undefined);
  for (const s of pd.addedSteps)      if (s.stepIndex < stepCount) out[s.stepIndex] = "added";
  for (const s of pd.removedSteps)    if (s.stepIndex < stepCount) out[s.stepIndex] = "removed";
  for (const s of pd.changedVelocity) if (s.stepIndex < stepCount) out[s.stepIndex] = "changedVelocity";
  return out;
}
