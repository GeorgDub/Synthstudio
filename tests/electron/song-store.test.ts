/**
 * song-store.test.ts
 *
 * Tests für die Song-Store Logik-Schicht (Phase 9).
 * Song-Slots, Pattern-Chaining, Loop-Modus – isoliert ohne React.
 */
import { describe, it, expect } from "vitest";

// ─── Typen (aus useSongStore.ts gespiegelt) ───────────────────────────────────

type PatternBank = "A" | "B" | "C" | "D";

interface SongSlot {
  id: string;
  bank: PatternBank;
  repeats: number;
  label?: string;
  muted: boolean;
}

// ─── Hilfsfunktionen (aus useSongStore.ts isoliert) ──────────────────────────

function generateId(): string {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function calculateTotalSteps(slots: SongSlot[]): number {
  return slots.reduce((sum, slot) => sum + slot.repeats * 16, 0);
}

function addSlot(slots: SongSlot[], bank: PatternBank, repeats = 1, label?: string): SongSlot[] {
  const newSlot: SongSlot = {
    id: generateId(),
    bank,
    repeats: Math.max(1, Math.min(16, repeats)),
    label,
    muted: false,
  };
  return [...slots, newSlot];
}

function removeSlot(slots: SongSlot[], id: string): SongSlot[] {
  return slots.filter(s => s.id !== id);
}

function moveSlot(slots: SongSlot[], fromIndex: number, toIndex: number): SongSlot[] {
  if (fromIndex === toIndex) return slots;
  const next = [...slots];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function updateSlot(
  slots: SongSlot[],
  id: string,
  changes: Partial<Pick<SongSlot, "bank" | "repeats" | "label" | "muted">>
): SongSlot[] {
  return slots.map(s =>
    s.id === id
      ? {
          ...s,
          ...changes,
          repeats: changes.repeats !== undefined
            ? Math.max(1, Math.min(16, changes.repeats))
            : s.repeats,
        }
      : s
  );
}

function createArrangement(pattern: Array<{ bank: PatternBank; repeats: number }>): SongSlot[] {
  return pattern.map(({ bank, repeats }) => ({
    id: generateId(),
    bank,
    repeats: Math.max(1, Math.min(16, repeats)),
    muted: false,
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("calculateTotalSteps", () => {
  it("berechnet korrekte Gesamtschritte", () => {
    const slots: SongSlot[] = [
      { id: "1", bank: "A", repeats: 2, muted: false },
      { id: "2", bank: "B", repeats: 4, muted: false },
    ];
    // 2*16 + 4*16 = 32 + 64 = 96
    expect(calculateTotalSteps(slots)).toBe(96);
  });

  it("gibt 0 für leere Song zurück", () => {
    expect(calculateTotalSteps([])).toBe(0);
  });
});

describe("addSlot", () => {
  it("fügt neuen Slot hinzu", () => {
    const result = addSlot([], "A");
    expect(result).toHaveLength(1);
    expect(result[0].bank).toBe("A");
    expect(result[0].muted).toBe(false);
  });

  it("clampmt repeats auf 1–16", () => {
    const over = addSlot([], "B", 20);
    const under = addSlot([], "C", 0);
    expect(over[0].repeats).toBe(16);
    expect(under[0].repeats).toBe(1);
  });

  it("setzt Label wenn angegeben", () => {
    const result = addSlot([], "D", 2, "Chorus");
    expect(result[0].label).toBe("Chorus");
  });
});

describe("removeSlot", () => {
  it("entfernt Slot mit korrekter ID", () => {
    const slots = addSlot(addSlot([], "A"), "B");
    const id = slots[0].id;
    const result = removeSlot(slots, id);
    expect(result).toHaveLength(1);
    expect(result[0].bank).toBe("B");
  });
});

describe("moveSlot", () => {
  it("verschiebt Slot von hinten nach vorne", () => {
    const slots: SongSlot[] = [
      { id: "a", bank: "A", repeats: 1, muted: false },
      { id: "b", bank: "B", repeats: 1, muted: false },
      { id: "c", bank: "C", repeats: 1, muted: false },
    ];
    const result = moveSlot(slots, 2, 0);
    expect(result[0].id).toBe("c");
    expect(result[1].id).toBe("a");
  });

  it("ändert nichts wenn fromIndex === toIndex", () => {
    const slots: SongSlot[] = [{ id: "a", bank: "A", repeats: 1, muted: false }];
    expect(moveSlot(slots, 0, 0)).toEqual(slots);
  });
});

describe("updateSlot", () => {
  it("aktualisiert Bank und Repeats", () => {
    const slots: SongSlot[] = [{ id: "x", bank: "A", repeats: 1, muted: false }];
    const result = updateSlot(slots, "x", { bank: "C", repeats: 8 });
    expect(result[0].bank).toBe("C");
    expect(result[0].repeats).toBe(8);
  });

  it("muted-Flag kann geändert werden", () => {
    const slots: SongSlot[] = [{ id: "x", bank: "A", repeats: 1, muted: false }];
    const result = updateSlot(slots, "x", { muted: true });
    expect(result[0].muted).toBe(true);
  });
});

describe("createArrangement", () => {
  it("erstellt Slots aus Pattern-Vorlage", () => {
    const result = createArrangement([
      { bank: "A", repeats: 2 },
      { bank: "B", repeats: 4 },
      { bank: "A", repeats: 2 },
    ]);
    expect(result).toHaveLength(3);
    expect(result[1].bank).toBe("B");
    expect(result[1].repeats).toBe(4);
    expect(calculateTotalSteps(result)).toBe((2 + 4 + 2) * 16);
  });
});
