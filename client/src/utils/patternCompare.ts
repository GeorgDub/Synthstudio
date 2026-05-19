/**
 * patternCompare.ts — v3.163.0
 * ------------------------------------------------------------------------
 * Pure utilities to compare two PatternData snapshots step-by-step.
 *
 * Im Unterschied zum bereits vorhandenen `patternDiff.ts` (das Velocity-
 * Änderungen und BPM/StepCount-Deltas mit-trackt) liefert dieses Modul
 * eine kompakte added/removed-Step-Liste plus Part-Only-Sets — die ideale
 * Grundlage für ein künftiges Pattern-Compare-Modal (A/B-Switch,
 * "Was hat sich geändert?"-Highlights).
 *
 * Reine Funktion: keine Mutation, kein Date.now(), kein Math.random().
 * Damit deterministisch und vollständig in Node testbar.
 */

import type { PatternData } from "../audio/AudioEngine";

/** Klassifikation eines einzelnen Step-Unterschieds. */
export interface StepDiff {
  partId: string;
  partName: string;
  stepIndex: number;
  /** 'added' = a war false, b ist true; 'removed' = umgekehrt. */
  kind: "added" | "removed";
}

export interface PatternCompareResult {
  /** Alle einzelnen Step-Diffs (added + removed gemischt, partId-sortiert). */
  diffs: StepDiff[];
  /** Anzahl added-Steps insgesamt. */
  addedCount: number;
  /** Anzahl removed-Steps insgesamt. */
  removedCount: number;
  /** Patterns identisch (diffs.length === 0). */
  identical: boolean;
  /** Pattern-IDs die unique-only in einem der Patterns sind (z.B. neuer Part). */
  patternAOnlyPartIds: string[];
  patternBOnlyPartIds: string[];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Vergleicht zwei PatternData-Snapshots auf reiner Step-Active-Basis.
 *
 * Regeln:
 *   1. Parts werden per `id` gematched.
 *   2. Part nur in A → alle aktiven a-Steps zählen als `removed`.
 *   3. Part nur in B → alle aktiven b-Steps zählen als `added`.
 *   4. Part in beiden → Step-by-Step bis max(a.steps.length, b.steps.length):
 *        a.active=false UND b.active=true → added
 *        a.active=true  UND b.active=false → removed
 *        sonst nichts
 *      Bei mismatch der step-array-length zählen die jeweils "überstehenden"
 *      aktiven Steps in B als added, in A als removed.
 *   5. Reihenfolge der diffs: partId-sortiert (stable), darin stepIndex aufsteigend.
 */
export function comparePatterns(a: PatternData, b: PatternData): PatternCompareResult {
  const aParts = new Map(a.parts.map((p) => [p.id, p]));
  const bParts = new Map(b.parts.map((p) => [p.id, p]));

  // Union of partIds, in deterministischer Reihenfolge: zuerst A-Reihenfolge,
  // dann B-Parts die in A fehlen.
  const partIds: string[] = [];
  const seen = new Set<string>();
  for (const p of a.parts) {
    if (!seen.has(p.id)) {
      partIds.push(p.id);
      seen.add(p.id);
    }
  }
  for (const p of b.parts) {
    if (!seen.has(p.id)) {
      partIds.push(p.id);
      seen.add(p.id);
    }
  }

  const diffs: StepDiff[] = [];
  const patternAOnlyPartIds: string[] = [];
  const patternBOnlyPartIds: string[] = [];

  for (const partId of partIds) {
    const partA = aParts.get(partId);
    const partB = bParts.get(partId);

    if (partA && !partB) {
      // Part existiert nur in A → alle aktiven Steps als removed.
      patternAOnlyPartIds.push(partId);
      const partName = partA.name;
      for (let i = 0; i < partA.steps.length; i++) {
        if (partA.steps[i]?.active) {
          diffs.push({ partId, partName, stepIndex: i, kind: "removed" });
        }
      }
      continue;
    }

    if (!partA && partB) {
      // Part existiert nur in B → alle aktiven Steps als added.
      patternBOnlyPartIds.push(partId);
      const partName = partB.name;
      for (let i = 0; i < partB.steps.length; i++) {
        if (partB.steps[i]?.active) {
          diffs.push({ partId, partName, stepIndex: i, kind: "added" });
        }
      }
      continue;
    }

    if (!partA || !partB) continue; // narrow für TS

    // Beidseitig vorhandener Part → Step-by-Step compare.
    // partName bevorzugt aus B (das "Ziel"), fallback A.
    const partName = partB.name || partA.name;
    const maxLen = Math.max(partA.steps.length, partB.steps.length);
    for (let i = 0; i < maxLen; i++) {
      const aOn = !!partA.steps[i]?.active;
      const bOn = !!partB.steps[i]?.active;
      if (!aOn && bOn) {
        diffs.push({ partId, partName, stepIndex: i, kind: "added" });
      } else if (aOn && !bOn) {
        diffs.push({ partId, partName, stepIndex: i, kind: "removed" });
      }
    }
  }

  // Sortierung: partId aufsteigend (stable), darin stepIndex aufsteigend.
  diffs.sort((x, y) => {
    if (x.partId !== y.partId) return x.partId < y.partId ? -1 : 1;
    return x.stepIndex - y.stepIndex;
  });

  let addedCount = 0;
  let removedCount = 0;
  for (const d of diffs) {
    if (d.kind === "added") addedCount++;
    else removedCount++;
  }

  return {
    diffs,
    addedCount,
    removedCount,
    identical: diffs.length === 0,
    patternAOnlyPartIds,
    patternBOnlyPartIds,
  };
}

/**
 * Convenience: Liefert einen formattierten Summary-String fürs UI.
 *
 * Beispiele:
 *   - identisch                        → "identisch"
 *   - 12 added / 3 removed            → "+12 steps, -3 steps"
 *   - mit neuen Parts                  → "+5 steps, -0 steps, 1 neuer Part"
 *   - mit removed Parts                → "+0 steps, -7 steps, 2 entfernte Parts"
 *   - kombiniert                       → "+5 steps, -2 steps, 1 neuer Part, 2 entfernte Parts"
 *
 * Pluralisierung: 1 → Singular ("neuer Part" / "entfernter Part"),
 *                 sonst Plural ("neue Parts" / "entfernte Parts").
 */
export function formatCompareSummary(result: PatternCompareResult): string {
  if (result.identical) return "identisch";

  const parts: string[] = [
    `+${result.addedCount} steps`,
    `-${result.removedCount} steps`,
  ];

  const newCount = result.patternBOnlyPartIds.length;
  if (newCount > 0) {
    parts.push(`${newCount} ${newCount === 1 ? "neuer Part" : "neue Parts"}`);
  }

  const removedCount = result.patternAOnlyPartIds.length;
  if (removedCount > 0) {
    parts.push(
      `${removedCount} ${removedCount === 1 ? "entfernter Part" : "entfernte Parts"}`,
    );
  }

  return parts.join(", ");
}
