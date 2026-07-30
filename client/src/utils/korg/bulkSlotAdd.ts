/**
 * bulkSlotAdd.ts — „Alle hinzufügen" für den Sample-Picker des Bank-Editors.
 *
 * Warum das eine eigene Funktion ist und keine Schleife über die Einzelaktion:
 * `addSampleAsSlot` liest `newSlots.length` für den Slot-Index und `Date.now()`
 * für die Zeilen-ID. In einer Schleife aufgerufen sieht jeder Durchlauf
 * denselben React-State (Updates sind gebündelt) und dieselbe Millisekunde —
 * alle Slots bekämen **Index 0 und dieselbe ID**. Ein Massen-Button, der so
 * gebaut wird, funktioniert im Test mit zwei Samples und zerlegt bei zwanzig
 * die Liste.
 *
 * Deshalb plant diese Funktion den kompletten Anhang in einem Rutsch und der
 * Aufrufer setzt den State genau einmal.
 *
 * Rein & seiteneffektfrei — inklusive der IDs: der Zähler kommt als Parameter
 * herein, statt hier `Date.now()` zu rufen.
 */

/** Was von einem Sample gebraucht wird — mehr will diese Datei nicht wissen. */
export interface BulkAddSource {
  id: string;
  name: string;
}

export interface PlannedSlot<T extends BulkAddSource> {
  source: T;
  /** Zielposition in der Liste, fortlaufend ab dem bisherigen Ende. */
  slotIndex: number;
  /** Eindeutig auch bei gleichzeitigem Anlegen vieler Zeilen. */
  rowId: string;
}

export interface BulkAddPlan<T extends BulkAddSource> {
  toAdd: PlannedSlot<T>[];
  /** Übersprungen, weil das Sample schon in der Liste liegt. */
  skippedDuplicate: number;
  /** Übersprungen, weil die Slot-Obergrenze erreicht war. */
  skippedFull: number;
}

/**
 * Plant das Anhängen mehrerer Samples.
 *
 * @param existingIds Sample-IDs, die bereits in der Liste stehen.
 * @param existingCount Aktuelle Länge der Liste (= erster freier Slot-Index).
 * @param samples Kandidaten, in der Reihenfolge, in der sie angezeigt werden.
 * @param maxSlots Obergrenze des Geräts.
 * @param idSeed Stamm für die Zeilen-IDs (z. B. ein Zeitstempel des Aufrufers).
 */
export function planBulkSlotAdd<T extends BulkAddSource>(
  existingIds: ReadonlySet<string>,
  existingCount: number,
  samples: readonly T[],
  maxSlots: number,
  idSeed: string,
): BulkAddPlan<T> {
  const toAdd: PlannedSlot<T>[] = [];
  const seen = new Set(existingIds);
  let skippedDuplicate = 0;
  let skippedFull = 0;
  let next = Math.max(0, existingCount);

  for (const source of samples) {
    // Duplikate zuerst prüfen: ein bereits vorhandenes Sample soll nicht als
    // „kein Platz mehr" gemeldet werden, das wäre eine irreführende Ursache.
    if (seen.has(source.id)) {
      skippedDuplicate++;
      continue;
    }
    if (next >= maxSlots) {
      skippedFull++;
      continue;
    }
    // Der laufende Index macht die ID eindeutig — `idSeed` allein reicht nicht,
    // weil alle Zeilen im selben Aufruf entstehen.
    toAdd.push({ source, slotIndex: next, rowId: `slot-${idSeed}-${next}-${source.id}` });
    seen.add(source.id);
    next++;
  }

  return { toAdd, skippedDuplicate, skippedFull };
}

/** Ein Satz zum Ergebnis — nennt auch, was NICHT hinzugefügt wurde. */
export function describeBulkAdd(plan: BulkAddPlan<BulkAddSource>): string {
  const parts = [`${plan.toAdd.length} Sample(s) hinzugefügt`];
  if (plan.skippedDuplicate > 0) {
    parts.push(`${plan.skippedDuplicate} bereits in der Liste`);
  }
  if (plan.skippedFull > 0) {
    parts.push(`${plan.skippedFull} ohne Platz (Slot-Grenze erreicht)`);
  }
  return parts.join(" · ");
}
