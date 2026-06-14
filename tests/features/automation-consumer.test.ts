/**
 * tests/features/automation-consumer.test.ts
 *
 * TASK-249 — Tests fuer den Playback-Consumer-Mapping-Layer:
 *   parseAutomationTarget()  — Lane-Target → {kind, partId}
 *   compileAutomationLanes() — Lanes → dichte, vorab aufgeloeste Wert-Arrays
 *   readCompiledValue()      — allokationsfreier Step-Lookup (mit Clamp)
 *
 * Diese Helfer sind pure und decken den Hot-Path (App.tsx onPosition) ab,
 * der KEINE Per-Step-Allokationen machen darf (finding #6): das gesamte
 * String-Parsen + Interpolieren passiert hier EINMAL beim Kompilieren.
 */
import { describe, it, expect } from "vitest";
import {
  parseAutomationTarget,
  compileAutomationLanes,
  readCompiledValue,
  type AutomationLane,
} from "../../client/src/store/useAutomationStore";

// ─── Helper: minimale Lane bauen ───────────────────────────────────────────────

function lane(partial: Partial<AutomationLane> & Pick<AutomationLane, "target" | "points">): AutomationLane {
  return {
    id: partial.id ?? "L",
    target: partial.target,
    label: partial.label ?? "L",
    points: partial.points,
    enabled: partial.enabled ?? true,
    min: partial.min ?? 0,
    max: partial.max ?? 1,
    defaultValue: partial.defaultValue ?? 0,
  };
}

// ─── parseAutomationTarget ─────────────────────────────────────────────────────

describe("parseAutomationTarget", () => {
  it("bpm → kind=bpm, partId=null", () => {
    expect(parseAutomationTarget("bpm")).toEqual({ kind: "bpm", partId: null });
  });

  it("master-vol → kind=master-vol, partId=null", () => {
    expect(parseAutomationTarget("master-vol")).toEqual({ kind: "master-vol", partId: null });
  });

  it("vol:<partId> → kind=vol, partId extrahiert", () => {
    expect(parseAutomationTarget("vol:kick")).toEqual({ kind: "vol", partId: "kick" });
  });

  it("pan:<partId> → kind=pan, partId extrahiert", () => {
    expect(parseAutomationTarget("pan:snare-01")).toEqual({ kind: "pan", partId: "snare-01" });
  });

  it("send-rev:<partId> → kind=send-rev, partId extrahiert", () => {
    expect(parseAutomationTarget("send-rev:hihat")).toEqual({ kind: "send-rev", partId: "hihat" });
  });

  it("send-dly:<partId> → kind=send-dly, partId extrahiert", () => {
    expect(parseAutomationTarget("send-dly:perc")).toEqual({ kind: "send-dly", partId: "perc" });
  });

  it("partId mit Doppelpunkt im ID-Teil bleibt erhalten (nur Praefix gesplittet)", () => {
    // slice(4) nach "vol:" → Rest unangetastet
    expect(parseAutomationTarget("vol:a:b" as AutomationLane["target"]))
      .toEqual({ kind: "vol", partId: "a:b" });
  });
});

// ─── compileAutomationLanes ────────────────────────────────────────────────────

describe("compileAutomationLanes", () => {
  it("ueberspringt disabled Lanes", () => {
    const compiled = compileAutomationLanes(
      [lane({ target: "bpm", points: { 0: 120 }, enabled: false })],
      16,
    );
    expect(compiled).toHaveLength(0);
  });

  it("ueberspringt leere Lanes (keine Punkte)", () => {
    const compiled = compileAutomationLanes(
      [lane({ target: "bpm", points: {} })],
      16,
    );
    expect(compiled).toHaveLength(0);
  });

  it("kompiliert eine bpm-Lane in dichtes values-Array der Laenge stepCount", () => {
    const compiled = compileAutomationLanes(
      [lane({ target: "bpm", points: { 0: 100, 8: 140 } })],
      16,
    );
    expect(compiled).toHaveLength(1);
    expect(compiled[0].kind).toBe("bpm");
    expect(compiled[0].partId).toBeNull();
    expect(compiled[0].values).toHaveLength(16);
    expect(compiled[0].values[0]).toBe(100);
    expect(compiled[0].values[4]).toBe(120); // linear mid
    expect(compiled[0].values[8]).toBe(140);
    // nach letztem Punkt → clamp auf letzten Wert
    expect(compiled[0].values[15]).toBe(140);
  });

  it("kompiliert eine vol:<partId>-Lane mit partId", () => {
    const compiled = compileAutomationLanes(
      [lane({ target: "vol:kick", points: { 0: 0, 8: 1 }, min: 0, max: 1 })],
      16,
    );
    expect(compiled).toHaveLength(1);
    expect(compiled[0].kind).toBe("vol");
    expect(compiled[0].partId).toBe("kick");
    expect(compiled[0].values[4]).toBeCloseTo(0.5);
  });

  it("kompiliert mehrere Lanes in stabiler Reihenfolge", () => {
    const compiled = compileAutomationLanes(
      [
        lane({ target: "bpm", points: { 0: 120 } }),
        lane({ target: "pan:snare", points: { 0: -1, 15: 1 }, min: -1, max: 1 }),
      ],
      16,
    );
    expect(compiled.map(c => c.kind)).toEqual(["bpm", "pan"]);
    expect(compiled[1].partId).toBe("snare");
  });

  it("respektiert stepCount=32", () => {
    const compiled = compileAutomationLanes(
      [lane({ target: "master-vol", points: { 0: 0.2, 16: 0.8 } })],
      32,
    );
    expect(compiled[0].values).toHaveLength(32);
    expect(compiled[0].values[0]).toBe(0.2);
    expect(compiled[0].values[16]).toBe(0.8);
  });
});

// ─── readCompiledValue (allokationsfreier Step-Lookup) ──────────────────────────

describe("readCompiledValue", () => {
  const compiled = compileAutomationLanes(
    [lane({ target: "bpm", points: { 0: 100, 8: 140 } })],
    16,
  )[0];

  it("liest exakten Step-Wert", () => {
    expect(readCompiledValue(compiled, 0)).toBe(100);
    expect(readCompiledValue(compiled, 8)).toBe(140);
  });

  it("liest interpolierten Mid-Wert", () => {
    expect(readCompiledValue(compiled, 4)).toBe(120);
  });

  it("clampt Step ueber die Laenge auf letzten Index (statt undefined)", () => {
    // 16 Steps Pattern, aber Sequencer koennte hoeheren Index liefern
    expect(readCompiledValue(compiled, 99)).toBe(140);
    expect(readCompiledValue(compiled, 16)).toBe(140);
  });

  it("clampt negativen Step auf Index 0", () => {
    expect(readCompiledValue(compiled, -5)).toBe(100);
  });

  it("leere values → null", () => {
    expect(readCompiledValue({ kind: "bpm", partId: null, values: [] }, 0)).toBeNull();
  });

  it("liefert dieselbe Objekt-Referenz nicht neu — reines Lesen (kein Alloc)", () => {
    // Sanity: zweimal lesen liefert identischen primitiven Wert, kein neues Objekt.
    const a = readCompiledValue(compiled, 4);
    const b = readCompiledValue(compiled, 4);
    expect(a).toBe(b);
  });
});
