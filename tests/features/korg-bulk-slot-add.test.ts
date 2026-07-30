/**
 * „Alle hinzufügen" (client/src/utils/korg/bulkSlotAdd.ts)
 *
 * Der Kern dieser Tests ist der Fehler, den eine Schleife über die
 * Einzelaktion erzeugt hätte: gleiche Slot-Indizes und gleiche Zeilen-IDs,
 * weil React-State-Updates gebündelt sind und `Date.now()` innerhalb einer
 * Millisekunde konstant bleibt. Beides fällt bei zwei Samples nicht auf und
 * zerlegt bei zwanzig die Liste.
 */
import { describe, it, expect } from "vitest";
import {
  describeBulkAdd,
  planBulkSlotAdd,
  type BulkAddSource,
} from "@/utils/korg/bulkSlotAdd";

const S = (id: string): BulkAddSource => ({ id, name: `Sample ${id}` });
const SEED = "t0";

describe("planBulkSlotAdd", () => {
  it("vergibt fortlaufende Slot-Indizes ab dem bisherigen Ende", () => {
    const plan = planBulkSlotAdd(new Set(), 3, [S("a"), S("b"), S("c")], 1020, SEED);
    expect(plan.toAdd.map(p => p.slotIndex)).toEqual([3, 4, 5]);
  });

  it("vergibt eindeutige Zeilen-IDs innerhalb EINES Aufrufs", () => {
    // Genau hier scheitert die naive Schleife: derselbe Zeitstempel für alle.
    const plan = planBulkSlotAdd(new Set(), 0, [S("a"), S("b"), S("c")], 1020, SEED);
    const ids = plan.toAdd.map(p => p.rowId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("überspringt Samples, die schon in der Liste liegen", () => {
    const plan = planBulkSlotAdd(new Set(["b"]), 1, [S("a"), S("b"), S("c")], 1020, SEED);
    expect(plan.toAdd.map(p => p.source.id)).toEqual(["a", "c"]);
    expect(plan.skippedDuplicate).toBe(1);
    // Die Indizes bleiben lückenlos, obwohl in der Mitte etwas ausfiel.
    expect(plan.toAdd.map(p => p.slotIndex)).toEqual([1, 2]);
  });

  it("erkennt Duplikate auch INNERHALB der Auswahl", () => {
    const plan = planBulkSlotAdd(new Set(), 0, [S("a"), S("a"), S("b")], 1020, SEED);
    expect(plan.toAdd.map(p => p.source.id)).toEqual(["a", "b"]);
    expect(plan.skippedDuplicate).toBe(1);
  });

  it("hält die Slot-Obergrenze ein", () => {
    const plan = planBulkSlotAdd(new Set(), 1018, [S("a"), S("b"), S("c"), S("d")], 1020, SEED);
    expect(plan.toAdd).toHaveLength(2);
    expect(plan.toAdd.map(p => p.slotIndex)).toEqual([1018, 1019]);
    expect(plan.skippedFull).toBe(2);
  });

  it("unterscheidet 'schon drin' von 'kein Platz'", () => {
    // Eine gemeinsame Zahl wäre eine irreführende Ursache: der Nutzer würde
    // Samples löschen, obwohl sie längst in der Liste stehen.
    const plan = planBulkSlotAdd(new Set(["a"]), 1019, [S("a"), S("b"), S("c")], 1020, SEED);
    expect(plan.skippedDuplicate).toBe(1);
    expect(plan.skippedFull).toBe(1);
    expect(plan.toAdd).toHaveLength(1);
  });

  it("liefert bei voller Liste einen leeren Plan statt zu werfen", () => {
    const plan = planBulkSlotAdd(new Set(), 1020, [S("a")], 1020, SEED);
    expect(plan.toAdd).toEqual([]);
    expect(plan.skippedFull).toBe(1);
  });

  it("verträgt eine leere Auswahl", () => {
    const plan = planBulkSlotAdd(new Set(), 0, [], 1020, SEED);
    expect(plan).toEqual({ toAdd: [], skippedDuplicate: 0, skippedFull: 0 });
  });

  it("behandelt einen negativen Startwert als 0", () => {
    const plan = planBulkSlotAdd(new Set(), -5, [S("a")], 1020, SEED);
    expect(plan.toAdd[0].slotIndex).toBe(0);
  });

  it("behält die Reihenfolge der Anzeige bei", () => {
    const order = ["z", "m", "a"];
    const plan = planBulkSlotAdd(new Set(), 0, order.map(S), 1020, SEED);
    expect(plan.toAdd.map(p => p.source.id)).toEqual(order);
  });

  it("verändert das übergebene Set nicht", () => {
    const existing = new Set(["a"]);
    planBulkSlotAdd(existing, 1, [S("b"), S("c")], 1020, SEED);
    expect([...existing]).toEqual(["a"]);
  });
});

describe("describeBulkAdd", () => {
  it("nennt nur die Zahl, wenn alles geklappt hat", () => {
    const plan = planBulkSlotAdd(new Set(), 0, [S("a"), S("b")], 1020, SEED);
    expect(describeBulkAdd(plan)).toBe("2 Sample(s) hinzugefügt");
  });

  it("nennt beide Ausfallgründe getrennt", () => {
    const plan = planBulkSlotAdd(new Set(["a"]), 1019, [S("a"), S("b"), S("c")], 1020, SEED);
    const text = describeBulkAdd(plan);
    expect(text).toContain("bereits in der Liste");
    expect(text).toContain("Slot-Grenze");
  });
});
