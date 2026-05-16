/**
 * Synthstudio – OSC-Out-Bridge Diff-Helpers Tests (v2.47)
 *
 * Testet die Pure Diff-Funktionen aus useOscOutBridge — analog zu v2.40
 * MIDI-Bridge-Tests. Hook-Wiring selbst wird durch das bestehende
 * E2E-Verhalten abgedeckt (Tests existieren bereits in v2.26-v2.31).
 */
import { describe, it, expect } from "vitest";
import {
  diffMuteSnapshots,
  diffVolumeSnapshots,
  diffMacroSnapshots,
} from "../../client/src/hooks/useOscOutBridge";

describe("diffMuteSnapshots (v2.47)", () => {
  it("Leere Snapshots → keine Changes", () => {
    expect(diffMuteSnapshots(new Map(), new Map())).toEqual([]);
  });

  it("Neue Parts werden NICHT als Change geliefert (initial-broadcast unterdrückt)", () => {
    const prev = new Map<string, boolean>();
    const next = new Map([["p1", true], ["p2", false]]);
    expect(diffMuteSnapshots(prev, next)).toEqual([]);
  });

  it("Mute → Unmute liefert {muted:false}", () => {
    const prev = new Map([["p1", true]]);
    const next = new Map([["p1", false]]);
    expect(diffMuteSnapshots(prev, next)).toEqual([{ partId: "p1", muted: false }]);
  });

  it("Unmute → Mute liefert {muted:true}", () => {
    const prev = new Map([["p1", false]]);
    const next = new Map([["p1", true]]);
    expect(diffMuteSnapshots(prev, next)).toEqual([{ partId: "p1", muted: true }]);
  });

  it("Unveränderte Parts werden ignoriert", () => {
    const prev = new Map([["p1", true], ["p2", false]]);
    const next = new Map([["p1", true], ["p2", false]]);
    expect(diffMuteSnapshots(prev, next)).toEqual([]);
  });

  it("Mehrere gleichzeitige Changes", () => {
    const prev = new Map([["p1", false], ["p2", true], ["p3", false]]);
    const next = new Map([["p1", true], ["p2", false], ["p3", false]]);
    const result = diffMuteSnapshots(prev, next);
    expect(result).toContainEqual({ partId: "p1", muted: true });
    expect(result).toContainEqual({ partId: "p2", muted: false });
    expect(result.find(c => c.partId === "p3")).toBeUndefined();
    expect(result).toHaveLength(2);
  });

  it("Entfernte Parts (in next nicht mehr enthalten) lösen keinen Send aus", () => {
    // Wir senden nur über NEXT iterierte Parts — verlorene Parts schweigen.
    const prev = new Map([["p1", true]]);
    const next = new Map<string, boolean>();
    expect(diffMuteSnapshots(prev, next)).toEqual([]);
  });
});

describe("diffVolumeSnapshots (v2.47)", () => {
  it("Volume-Change liefert exakten neuen Wert", () => {
    const prev = new Map([["p1", 0.5]]);
    const next = new Map([["p1", 0.8]]);
    expect(diffVolumeSnapshots(prev, next)).toEqual([{ partId: "p1", volume: 0.8 }]);
  });

  it("Initial-Volume (kein prev) wird unterdrückt", () => {
    const prev = new Map<string, number>();
    const next = new Map([["p1", 0.5]]);
    expect(diffVolumeSnapshots(prev, next)).toEqual([]);
  });

  it("Volume 0 ist nicht falsy-trap (Mute via Volume=0)", () => {
    const prev = new Map([["p1", 0.5]]);
    const next = new Map([["p1", 0]]);
    expect(diffVolumeSnapshots(prev, next)).toEqual([{ partId: "p1", volume: 0 }]);
  });

  it("Float-Equality wird strict gecheckt — 0.5 vs 0.5 ist no-op", () => {
    const prev = new Map([["p1", 0.5]]);
    const next = new Map([["p1", 0.5]]);
    expect(diffVolumeSnapshots(prev, next)).toEqual([]);
  });
});

describe("diffMacroSnapshots (v2.47)", () => {
  it("Erst-Initialisierung: kein Send (alle prev=undefined)", () => {
    expect(diffMacroSnapshots([], [0.5, 0.6, 0.7])).toEqual([]);
  });

  it("Veränderter Slot 0 → ein Change", () => {
    expect(diffMacroSnapshots([0.5, 0.6], [0.7, 0.6])).toEqual([
      { index: 0, value: 0.7 },
    ]);
  });

  it("Mehrere veränderte Slots — Reihenfolge entspricht Index", () => {
    const result = diffMacroSnapshots([0, 0, 0, 0], [0, 0.3, 0, 0.5]);
    expect(result).toEqual([
      { index: 1, value: 0.3 },
      { index: 3, value: 0.5 },
    ]);
  });

  it("Neue Slots werden NICHT als Change geliefert (prev kürzer)", () => {
    expect(diffMacroSnapshots([0.5], [0.5, 0.6, 0.7])).toEqual([]);
  });

  it("Unveränderter Snapshot → leeres Array", () => {
    expect(diffMacroSnapshots([0.1, 0.2, 0.3], [0.1, 0.2, 0.3])).toEqual([]);
  });

  it("Macro-Wert 0 ist nicht falsy-trap", () => {
    expect(diffMacroSnapshots([0.5], [0])).toEqual([{ index: 0, value: 0 }]);
  });
});
