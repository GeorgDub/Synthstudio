/**
 * tests/features/midi-auto-learn.test.ts
 *
 * Unit-Tests für die Pure-Helper aus useMidi (v1.71 CC + v1.72 Note):
 *   - `labelForTarget(target)` — Anzeigename pro MidiLearnTarget-Variante
 *   - `nextAutoLearnEntry(queue, msg)` — Queue-Transition + Mapping-Generation
 *
 * Diese Funktionen sind bewusst pure ohne React-Dependency damit sie isoliert
 * testbar sind (BUG-Risk: Auto-Learn-Queue-Logik war vor v1.72 inline in
 * handleMidiMessage → schwer zu reproduzieren in Tests).
 */
import { describe, it, expect } from "vitest";
import {
  labelForTarget,
  nextAutoLearnEntry,
  type AutoLearnEntry,
} from "../../client/src/hooks/useMidi";

describe("labelForTarget (v1.71+v1.72)", () => {
  it("BPM-Target → 'BPM (absolut)'", () => {
    expect(labelForTarget({ type: "bpm" })).toBe("BPM (absolut)");
  });

  it("Transport-Targets haben deutsche Labels", () => {
    expect(labelForTarget({ type: "playStop" })).toBe("Play / Stop");
    expect(labelForTarget({ type: "record" })).toBe("Record");
    expect(labelForTarget({ type: "tapTempo" })).toBe("Tap Tempo");
  });

  it("Part-Volume nutzt partName wenn vorhanden", () => {
    expect(labelForTarget({ type: "volume", partId: "p1", partName: "Kick" })).toBe("Volume: Kick");
  });

  it("Part-Volume fällt auf gekürzte partId zurück wenn kein partName", () => {
    expect(labelForTarget({ type: "volume", partId: "part-1234567890" })).toBe("Volume: part-123");
  });

  it("Pattern-Index ist 0-based intern, 1-based im Label", () => {
    expect(labelForTarget({ type: "pattern", patternIndex: 0 })).toBe("Pattern 1");
    expect(labelForTarget({ type: "pattern", patternIndex: 4 })).toBe("Pattern 5");
  });

  it("Scene-Index ebenfalls 1-based im Label", () => {
    expect(labelForTarget({ type: "scenelaunch", sceneIndex: 2 })).toBe("Scene 3");
  });

  it("Unbekannter Type fällt auf 'Unbekannt' zurück (defensive)", () => {
    // @ts-expect-error - bewusst invalider Wert für Defensive-Test
    expect(labelForTarget({ type: "non-existent" })).toBe("Unbekannt");
  });
});

describe("nextAutoLearnEntry (v1.72)", () => {
  const ccTarget = { kind: "cc" as const, target: { type: "playStop" as const } };
  const noteTarget = { kind: "note" as const, partId: "p1", partName: "Kick" };

  it("leere Queue → unverändert, kein Mapping", () => {
    const result = nextAutoLearnEntry([], { type: 0xb0, byte1: 7, byte2: 100, channel: 1 });
    expect(result.newQueue).toEqual([]);
    expect(result.ccMapping).toBeUndefined();
    expect(result.noteMapping).toBeUndefined();
  });

  it("CC-Entry + CC-Message → Queue shiften + ccMapping zurückgeben", () => {
    const queue: AutoLearnEntry[] = [ccTarget];
    const result = nextAutoLearnEntry(queue, { type: 0xb0, byte1: 7, byte2: 100, channel: 1 });
    expect(result.newQueue).toEqual([]);
    expect(result.ccMapping).toEqual({
      cc: 7,
      channel: 1,
      target: { type: "playStop" },
      label: "Play / Stop",
    });
    expect(result.noteMapping).toBeUndefined();
  });

  it("CC-Entry + Note-Message → Queue unverändert (Mismatch)", () => {
    const queue: AutoLearnEntry[] = [ccTarget];
    const result = nextAutoLearnEntry(queue, { type: 0x90, byte1: 36, byte2: 100, channel: 1 });
    expect(result.newQueue).toEqual(queue);
    expect(result.ccMapping).toBeUndefined();
    expect(result.noteMapping).toBeUndefined();
  });

  it("CC-Entry + CC mit Value=0 → ignoriert (Slider auf Null fängt nicht)", () => {
    const queue: AutoLearnEntry[] = [ccTarget];
    const result = nextAutoLearnEntry(queue, { type: 0xb0, byte1: 7, byte2: 0, channel: 1 });
    expect(result.newQueue).toEqual(queue);
  });

  it("Note-Entry + Note-On → Queue shiften + noteMapping zurückgeben", () => {
    const queue: AutoLearnEntry[] = [noteTarget];
    const result = nextAutoLearnEntry(queue, { type: 0x90, byte1: 36, byte2: 100, channel: 1 });
    expect(result.newQueue).toEqual([]);
    expect(result.noteMapping).toEqual({
      note: 36,
      channel: 1,
      partId: "p1",
      label: "Kick",
    });
    expect(result.ccMapping).toBeUndefined();
  });

  it("Note-Entry + CC-Message → Queue unverändert (Mismatch)", () => {
    const queue: AutoLearnEntry[] = [noteTarget];
    const result = nextAutoLearnEntry(queue, { type: 0xb0, byte1: 7, byte2: 100, channel: 1 });
    expect(result.newQueue).toEqual(queue);
  });

  it("Note-Entry + Note-On mit Velocity=0 → ignoriert (Note-Off-Pattern)", () => {
    const queue: AutoLearnEntry[] = [noteTarget];
    const result = nextAutoLearnEntry(queue, { type: 0x90, byte1: 36, byte2: 0, channel: 1 });
    expect(result.newQueue).toEqual(queue);
  });

  it("Mixed Queue: CC zuerst, dann Note → advanciert in Reihenfolge", () => {
    const queue: AutoLearnEntry[] = [ccTarget, noteTarget];
    // 1. CC-Capture → Queue verkürzt sich, ccMapping zurück
    const step1 = nextAutoLearnEntry(queue, { type: 0xb0, byte1: 7, byte2: 100, channel: 1 });
    expect(step1.newQueue).toHaveLength(1);
    expect(step1.newQueue[0]).toEqual(noteTarget);
    expect(step1.ccMapping).toBeDefined();
    expect(step1.noteMapping).toBeUndefined();

    // 2. Note-Capture → Queue leer, noteMapping zurück
    const step2 = nextAutoLearnEntry(step1.newQueue, { type: 0x90, byte1: 36, byte2: 100, channel: 1 });
    expect(step2.newQueue).toEqual([]);
    expect(step2.noteMapping).toBeDefined();
    expect(step2.ccMapping).toBeUndefined();
  });

  it("simuliert kompletten Mixer-Preset-Durchlauf (4 CC-Entries → 4 CC-Mappings)", () => {
    const queue: AutoLearnEntry[] = [
      { kind: "cc", target: { type: "volume", partId: "p1", partName: "Kick" } },
      { kind: "cc", target: { type: "volume", partId: "p2", partName: "Snare" } },
      { kind: "cc", target: { type: "mute",   partId: "p1", partName: "Kick" } },
      { kind: "cc", target: { type: "mute",   partId: "p2", partName: "Snare" } },
    ];
    let current = queue;
    const captured: number[] = [];
    for (const cc of [7, 8, 64, 65]) {
      const r = nextAutoLearnEntry(current, { type: 0xb0, byte1: cc, byte2: 100, channel: 1 });
      expect(r.ccMapping).toBeDefined();
      captured.push(r.ccMapping!.cc);
      current = r.newQueue;
    }
    expect(current).toHaveLength(0);
    expect(captured).toEqual([7, 8, 64, 65]);
  });

  it("Channel der eingehenden Message wird im Mapping persistiert", () => {
    const queue: AutoLearnEntry[] = [ccTarget];
    const result = nextAutoLearnEntry(queue, { type: 0xb0, byte1: 7, byte2: 100, channel: 10 });
    expect(result.ccMapping?.channel).toBe(10);
  });

  it("Status-Byte 0xa0 (Aftertouch) wird weder als CC noch Note erkannt", () => {
    const queue: AutoLearnEntry[] = [ccTarget];
    const result = nextAutoLearnEntry(queue, { type: 0xa0, byte1: 7, byte2: 100, channel: 1 });
    expect(result.newQueue).toEqual(queue);
    expect(result.ccMapping).toBeUndefined();
    expect(result.noteMapping).toBeUndefined();
  });
});
