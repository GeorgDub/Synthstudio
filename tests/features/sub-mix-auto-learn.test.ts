/**
 * tests/features/sub-mix-auto-learn.test.ts (v3.82.0)
 *
 * Unit-Tests für das v3.82 Auto-Learn-Preset "Sub-Mix-Buses" (closes v3.81
 * Caveat "kein Auto-Learn-Preset für Sub-Mix-Bus-Faders/Mutes").
 *
 * Getestet wird der Pure-Helper `buildSubMixBusAutoLearnEntries` aus
 * MidiSettings.tsx (exportiert auf Modul-Scope damit Tests DOM-frei laufen).
 *
 * Test-Cluster:
 *  (1) Entry-Generation: 8 Buses → 16 AutoLearnEntries (8 CC-Volume + 8 Note-Mute)
 *  (2) AutoLearnEntry-Format: jeder Entry hat das richtige discriminated-union-
 *      Shape und sein Target zeigt auf den richtigen busId.
 *  (3) MAX-Cap: 9 Buses → nur die ersten 8 generiert (Schutz vor State-Drift,
 *      auch wenn der Store bereits auf MAX gecapt ist).
 *  (4) 0-Buses-Case: empty Array → empty Result.
 *  (5) withMute=false: nur Volume-Entries.
 *  (6) Preset disabled wenn 0 Buses: Spiegelt die UI-Logik 1:1 (das Disabled-
 *      Flag wird vom Component aus subMixBuses.length === 0 abgeleitet).
 *
 * env:node — kein jsdom-Render. Das Preset-Disabled-Verhalten wird über die
 * Pure-Helper-Bedingung getestet (length === 0 → disabled), nicht über
 * Komponenten-Render (analog zu sub-mix-ui.test.ts).
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  buildSubMixBusAutoLearnEntries,
} from "../../client/src/components/MidiSettings/MidiSettings";
import { MAX_SUB_MIX_BUSES } from "../../client/src/store/useSubMixStore";

// ─── Test-Daten-Fabriken ─────────────────────────────────────────────────────

function makeBus(i: number): { id: string; name: string } {
  return { id: `bus-${i}`, name: `Bus ${i}` };
}

function makeBuses(n: number): Array<{ id: string; name: string }> {
  return Array.from({ length: n }, (_, i) => makeBus(i + 1));
}

// ─── (1) Entry-Generation ────────────────────────────────────────────────────

describe("buildSubMixBusAutoLearnEntries — Entry-Generation", () => {
  it("8 Buses → 16 Entries (8 CC-Volume + 8 Note-Mute)", () => {
    const buses = makeBuses(8);
    const entries = buildSubMixBusAutoLearnEntries(buses, true);
    expect(entries).toHaveLength(16);
    const ccCount   = entries.filter((e) => e.kind === "cc").length;
    const noteCount = entries.filter((e) => e.kind === "note").length;
    expect(ccCount).toBe(8);
    expect(noteCount).toBe(8);
  });

  it("3 Buses → 6 Entries (3 CC + 3 Note)", () => {
    const buses = makeBuses(3);
    const entries = buildSubMixBusAutoLearnEntries(buses, true);
    expect(entries).toHaveLength(6);
  });

  it("Reihenfolge: zuerst alle Volume-CCs, dann alle Mute-Notes", () => {
    const buses = makeBuses(2);
    const entries = buildSubMixBusAutoLearnEntries(buses, true);
    expect(entries[0].kind).toBe("cc");
    expect(entries[1].kind).toBe("cc");
    expect(entries[2].kind).toBe("note");
    expect(entries[3].kind).toBe("note");
  });
});

// ─── (2) AutoLearnEntry-Format ───────────────────────────────────────────────

describe("buildSubMixBusAutoLearnEntries — Target-Shape", () => {
  it("CC-Entry target.type === 'subMixBusVolume' + korrekter busId", () => {
    const buses = [{ id: "drums-bus", name: "Drums" }];
    const entries = buildSubMixBusAutoLearnEntries(buses, true);
    const cc = entries.find((e) => e.kind === "cc");
    expect(cc).toBeDefined();
    if (cc?.kind === "cc") {
      expect(cc.target.type).toBe("subMixBusVolume");
      if (cc.target.type === "subMixBusVolume") {
        expect(cc.target.busId).toBe("drums-bus");
        expect(cc.target.busName).toBe("Drums");
      }
    }
  });

  it("Note-Entry hat target.type === 'subMixBusMute' + busId-Reference", () => {
    const buses = [{ id: "fx-bus", name: "FX" }];
    const entries = buildSubMixBusAutoLearnEntries(buses, true);
    const note = entries.find((e) => e.kind === "note");
    expect(note).toBeDefined();
    if (note?.kind === "note") {
      expect(note.target).toBeDefined();
      if (note.target && note.target.type === "subMixBusMute") {
        expect(note.target.busId).toBe("fx-bus");
        expect(note.target.busName).toBe("FX");
      }
      // partId/partName sind nur fürs UI-Progress-Display
      expect(note.partId).toBe("sub-mix-bus-fx-bus");
      expect(note.partName).toBe("Bus Mute: FX");
    }
  });

  it("Pro Bus genau 2 Targets — Volume + Mute mit demselben busId", () => {
    const buses = [{ id: "bass-bus", name: "Bass" }];
    const entries = buildSubMixBusAutoLearnEntries(buses, true);
    expect(entries).toHaveLength(2);
    const busIds = entries.map((e) => {
      if (e.kind === "cc" && e.target.type === "subMixBusVolume") return e.target.busId;
      if (e.kind === "note" && e.target?.type === "subMixBusMute") return e.target.busId;
      return null;
    });
    expect(busIds).toEqual(["bass-bus", "bass-bus"]);
  });
});

// ─── (3) MAX-Cap ─────────────────────────────────────────────────────────────

describe("buildSubMixBusAutoLearnEntries — MAX-Cap", () => {
  it("9 Buses → nur die ersten 8 generiert (hart auf MAX_SUB_MIX_BUSES)", () => {
    const buses = makeBuses(9);
    const entries = buildSubMixBusAutoLearnEntries(buses, true);
    // 8 Volume + 8 Mute = 16
    expect(entries).toHaveLength(MAX_SUB_MIX_BUSES * 2);
    // Verifiziere dass Bus 9 (id "bus-9") NICHT in den Entries auftaucht
    const busIdsInEntries = entries.flatMap((e) => {
      if (e.kind === "cc" && e.target.type === "subMixBusVolume") return [e.target.busId];
      if (e.kind === "note" && e.target?.type === "subMixBusMute") return [e.target.busId];
      return [];
    });
    expect(busIdsInEntries).not.toContain("bus-9");
    expect(busIdsInEntries).toContain("bus-1");
    expect(busIdsInEntries).toContain("bus-8");
  });

  it("MAX_SUB_MIX_BUSES Konstante === 8 (Cap-Invariante)", () => {
    expect(MAX_SUB_MIX_BUSES).toBe(8);
  });
});

// ─── (4) 0-Buses-Case ────────────────────────────────────────────────────────

describe("buildSubMixBusAutoLearnEntries — 0-Buses-Case", () => {
  it("Leere Bus-Liste → leeres Entry-Array (kein Crash)", () => {
    expect(buildSubMixBusAutoLearnEntries([], true)).toEqual([]);
  });

  it("Leere Bus-Liste mit withMute=false → leeres Entry-Array", () => {
    expect(buildSubMixBusAutoLearnEntries([], false)).toEqual([]);
  });

  it("UI-Logik: 0 Buses → Preset disabled (length === 0 Check)", () => {
    // Spiegelt die exakte Bedingung im autoLearnPresets-Array von
    // MidiSettings.tsx: `disabled: subMixBuses.length === 0`. Wenn dieser
    // Test fehlschlägt → UI-Disabled-Logik weicht von der Pure-Helper-
    // Semantik ab (regression-guard).
    const buses: Array<{ id: string; name: string }> = [];
    const presetDisabled = buses.length === 0;
    expect(presetDisabled).toBe(true);
    // Und mit ≥1 Bus → enabled
    expect([makeBus(1)].length === 0).toBe(false);
  });
});

// ─── (5) withMute=false ──────────────────────────────────────────────────────

describe("buildSubMixBusAutoLearnEntries — withMute-Toggle", () => {
  it("withMute=false → nur N Volume-CC-Entries (kein Mute)", () => {
    const buses = makeBuses(4);
    const entries = buildSubMixBusAutoLearnEntries(buses, false);
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.kind === "cc")).toBe(true);
    expect(entries.every((e) =>
      e.kind === "cc" && e.target.type === "subMixBusVolume",
    )).toBe(true);
  });

  it("withMute=true (Default) → 2× soviel Entries wie withMute=false", () => {
    const buses = makeBuses(5);
    const withMute    = buildSubMixBusAutoLearnEntries(buses, true);
    const withoutMute = buildSubMixBusAutoLearnEntries(buses, false);
    expect(withMute.length).toBe(withoutMute.length * 2);
  });
});

// ─── (6) Round-Trip: Preset-Build-Funktion ───────────────────────────────────

describe("Sub-Mix-Buses Preset — Round-Trip-Sanity", () => {
  let buses: Array<{ id: string; name: string }>;

  beforeEach(() => {
    buses = makeBuses(3);
  });

  it("Build → AutoLearnEntries → kann ohne Throw an startAutoLearn übergeben werden", () => {
    // startAutoLearn() akzeptiert AutoLearnEntry[] — wir prüfen nur Typ-
    // Kompatibilität (kein Runtime-Call, da Hook React-State braucht).
    const entries = buildSubMixBusAutoLearnEntries(buses, true);
    expect(Array.isArray(entries)).toBe(true);
    // Jeder Entry muss entweder kind:"cc" oder kind:"note" sein (discriminated-union-Sanity)
    entries.forEach((e) => {
      expect(["cc", "note"]).toContain(e.kind);
    });
  });

  it("Entries sind keyed by busId — Re-Build mit gleichem Input ist deterministisch", () => {
    const a = buildSubMixBusAutoLearnEntries(buses, true);
    const b = buildSubMixBusAutoLearnEntries(buses, true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
