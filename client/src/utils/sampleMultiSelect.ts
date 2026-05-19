/**
 * Synthstudio – sampleMultiSelect.ts (v3.152.0)
 *
 * Pure-Helpers für Multi-Select-Operationen in der Sample-Library.
 *
 * Public API:
 *  - toggleInSet(set, id) → neuer Set (Ctrl/Cmd+Click toggle)
 *  - rangeSelect(orderedIds, anchorId, targetId, initialSet?) → neuer Set (Shift+Click)
 *  - clearSelection() → leerer Set
 *  - selectAll(orderedIds) → Set mit allen IDs
 *  - filterSelected(allIds, selected) → IDs aus selected die noch im allIds-Array sind
 *
 * Pure & Node-testbar.
 *
 * Tests: tests/features/sample-multi-select.test.ts
 */

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Toggle: wenn ID in Set → entfernen, sonst hinzufügen.  Returns neuer Set
 * (immutable).
 */
export function toggleInSet(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * Range-Select: alle IDs zwischen anchorId und targetId (inkl.) im
 * orderedIds-Array.  Reihenfolge der Anker spielt keine Rolle — funktioniert
 * in beide Richtungen.
 *
 * Bei initialSet: Existing-Selection bleibt erhalten (Set-Union mit Range).
 * Bei missing anchor/target: gleicher initialSet zurück (defensive).
 */
export function rangeSelect(
  orderedIds: readonly string[],
  anchorId: string,
  targetId: string,
  initialSet: ReadonlySet<string> = new Set(),
): Set<string> {
  const next = new Set(initialSet);
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return next;
  const anchorIdx = orderedIds.indexOf(anchorId);
  const targetIdx = orderedIds.indexOf(targetId);
  if (anchorIdx === -1 || targetIdx === -1) return next;
  const start = Math.min(anchorIdx, targetIdx);
  const end = Math.max(anchorIdx, targetIdx);
  for (let i = start; i <= end; i++) {
    next.add(orderedIds[i]);
  }
  return next;
}

/** Liefert einen leeren Set. */
export function clearSelection(): Set<string> {
  return new Set();
}

/** Liefert einen Set mit allen IDs aus orderedIds. */
export function selectAll(orderedIds: readonly string[]): Set<string> {
  return new Set(orderedIds);
}

/**
 * Filtert ein Set auf nur die IDs, die noch im allIds-Array existieren.
 * Nützlich nach Sample-Delete um aus dem Selection-Set verschwundene IDs
 * zu entfernen.
 */
export function filterSelected(
  allIds: readonly string[],
  selected: ReadonlySet<string>,
): Set<string> {
  const allSet = new Set(allIds);
  const next = new Set<string>();
  for (const id of selected) {
    if (allSet.has(id)) next.add(id);
  }
  return next;
}
