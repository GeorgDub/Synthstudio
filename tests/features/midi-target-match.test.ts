/**
 * tests/features/midi-target-match.test.ts
 *
 * v1.86: targetsMatch + findMappingForTarget — Pure-Helper-Tests.
 * Wird vom useMidiLearn-Hook (Right-Click-MIDI-Learn) verwendet um zu
 * erkennen ob ein UI-Element bereits MIDI-gebunden ist.
 */
import { describe, it, expect } from "vitest";
import {
  targetsMatch,
  findMappingForTarget,
  remapMappingChannel,
  type MidiLearnTarget,
  type MidiMapping,
} from "../../client/src/hooks/useMidi";

describe("targetsMatch (v1.86)", () => {
  it("single-targets ohne Param: bpm === bpm", () => {
    expect(targetsMatch({ type: "bpm" }, { type: "bpm" })).toBe(true);
  });

  it("single-targets ohne Param: playStop === playStop", () => {
    expect(targetsMatch({ type: "playStop" }, { type: "playStop" })).toBe(true);
  });

  it("verschiedene Typen sind ungleich", () => {
    expect(targetsMatch({ type: "bpm" }, { type: "playStop" })).toBe(false);
    expect(
      targetsMatch({ type: "masterVolume" }, { type: "volume", partId: "p1" })
    ).toBe(false);
  });

  it("volume: gleicher partId → match", () => {
    expect(
      targetsMatch(
        { type: "volume", partId: "p1" },
        { type: "volume", partId: "p1" }
      )
    ).toBe(true);
  });

  it("volume: unterschiedlicher partId → no match", () => {
    expect(
      targetsMatch(
        { type: "volume", partId: "p1" },
        { type: "volume", partId: "p2" }
      )
    ).toBe(false);
  });

  it("fxParam: gleicher partId + param → match", () => {
    expect(
      targetsMatch(
        { type: "fxParam", partId: "p1", param: "filterFreq" },
        { type: "fxParam", partId: "p1", param: "filterFreq" }
      )
    ).toBe(true);
  });

  it("fxParam: gleicher partId aber anderer param → no match", () => {
    expect(
      targetsMatch(
        { type: "fxParam", partId: "p1", param: "filterFreq" },
        { type: "fxParam", partId: "p1", param: "reverbMix" }
      )
    ).toBe(false);
  });

  it("pattern: gleicher patternIndex → match", () => {
    expect(
      targetsMatch(
        { type: "pattern", patternIndex: 2 },
        { type: "pattern", patternIndex: 2 }
      )
    ).toBe(true);
  });

  it("step: gleicher partId + stepIndex → match", () => {
    expect(
      targetsMatch(
        { type: "step", partId: "p1", stepIndex: 5 },
        { type: "step", partId: "p1", stepIndex: 5 }
      )
    ).toBe(true);
    expect(
      targetsMatch(
        { type: "step", partId: "p1", stepIndex: 5 },
        { type: "step", partId: "p1", stepIndex: 6 }
      )
    ).toBe(false);
  });

  it("runScript: gleicher scriptId → match", () => {
    expect(
      targetsMatch(
        { type: "runScript", scriptId: "abc" },
        { type: "runScript", scriptId: "abc" }
      )
    ).toBe(true);
    expect(
      targetsMatch(
        { type: "runScript", scriptId: "abc" },
        { type: "runScript", scriptId: "xyz" }
      )
    ).toBe(false);
  });

  it("chain: gleicher label → match", () => {
    const a: MidiLearnTarget = { type: "chain", label: "Drop", steps: [] };
    const b: MidiLearnTarget = {
      type: "chain",
      label: "Drop",
      steps: [{ target: { type: "playStop" } }],
    };
    expect(targetsMatch(a, b)).toBe(true);
  });

  it("scenelaunch: gleicher sceneIndex → match", () => {
    expect(
      targetsMatch(
        { type: "scenelaunch", sceneIndex: 3 },
        { type: "scenelaunch", sceneIndex: 3 }
      )
    ).toBe(true);
    expect(
      targetsMatch(
        { type: "scenelaunch", sceneIndex: 3 },
        { type: "scenelaunch", sceneIndex: 4 }
      )
    ).toBe(false);
  });

  it("tab: gleicher tabId → match", () => {
    expect(
      targetsMatch(
        { type: "tab", tabId: "mixer" },
        { type: "tab", tabId: "mixer" }
      )
    ).toBe(true);
  });

  // v1.88
  it("macro: gleicher index → match", () => {
    expect(
      targetsMatch(
        { type: "macro", index: 3 },
        { type: "macro", index: 3, label: "Filter Sweep" }
      )
    ).toBe(true);
    expect(
      targetsMatch({ type: "macro", index: 3 }, { type: "macro", index: 5 })
    ).toBe(false);
  });

  // v2.1
  it("send: gleicher partId + bus → match", () => {
    expect(
      targetsMatch(
        { type: "send", partId: "p1", bus: "reverb" },
        { type: "send", partId: "p1", bus: "reverb", partName: "Kick" }
      )
    ).toBe(true);
  });

  it("send: unterschiedlicher bus → no match", () => {
    expect(
      targetsMatch(
        { type: "send", partId: "p1", bus: "reverb" },
        { type: "send", partId: "p1", bus: "delay" }
      )
    ).toBe(false);
  });

  it("send: unterschiedlicher partId → no match", () => {
    expect(
      targetsMatch(
        { type: "send", partId: "p1", bus: "reverb" },
        { type: "send", partId: "p2", bus: "reverb" }
      )
    ).toBe(false);
  });
});

describe("findMappingForTarget (v1.86)", () => {
  const mappings: MidiMapping[] = [
    { cc: 7, channel: 1, target: { type: "masterVolume" }, label: "Master" },
    {
      cc: 10,
      channel: 1,
      target: { type: "volume", partId: "p1" },
      label: "Vol p1",
    },
    {
      cc: 11,
      channel: 1,
      target: { type: "volume", partId: "p2" },
      label: "Vol p2",
    },
    {
      cc: 20,
      channel: 1,
      target: { type: "fxParam", partId: "p1", param: "filterFreq" },
      label: "Filter p1",
    },
  ];

  it("findet das matchende Mapping anhand des Targets", () => {
    const r = findMappingForTarget(mappings, { type: "masterVolume" });
    expect(r?.cc).toBe(7);
  });

  it("findet partId-spezifische Mappings", () => {
    const r = findMappingForTarget(mappings, { type: "volume", partId: "p2" });
    expect(r?.cc).toBe(11);
  });

  it("findet fxParam mit partId + param", () => {
    const r = findMappingForTarget(mappings, {
      type: "fxParam",
      partId: "p1",
      param: "filterFreq",
    });
    expect(r?.cc).toBe(20);
  });

  it("liefert undefined bei No-Match", () => {
    expect(
      findMappingForTarget(mappings, { type: "volume", partId: "p999" })
    ).toBeUndefined();
    expect(findMappingForTarget(mappings, { type: "bpm" })).toBeUndefined();
  });

  it("leere Mappings → immer undefined", () => {
    expect(findMappingForTarget([], { type: "masterVolume" })).toBeUndefined();
  });
});

describe("remapMappingChannel (FL-Studio-artige Kanal-Wahl)", () => {
  const base: MidiMapping[] = [
    { cc: 7, channel: 0, target: { type: "masterVolume" }, label: "Master" },
    {
      cc: 20,
      channel: 1,
      target: { type: "fxParam", partId: "p1", param: "filterFreq" },
      label: "Filter p1",
    },
  ];

  it("pinnt ein Mapping auf einen festen Kanal (z.B. Akai MIDImix)", () => {
    const next = remapMappingChannel(base, { type: "masterVolume" }, 5);
    const m = findMappingForTarget(next, { type: "masterVolume" });
    expect(m?.channel).toBe(5);
    // cc + target bleiben unverändert, nur der Kanal wechselt.
    expect(m?.cc).toBe(7);
  });

  it("öffnet ein festes Mapping wieder auf 'alle Kanäle' (0)", () => {
    const next = remapMappingChannel(
      base,
      { type: "fxParam", partId: "p1", param: "filterFreq" },
      0
    );
    expect(
      findMappingForTarget(next, {
        type: "fxParam",
        partId: "p1",
        param: "filterFreq",
      })?.channel
    ).toBe(0);
  });

  it("clamped auf 0..16 und rundet ab", () => {
    expect(
      remapMappingChannel(base, { type: "masterVolume" }, 99).find(
        m => m.target.type === "masterVolume"
      )?.channel
    ).toBe(16);
    expect(
      remapMappingChannel(base, { type: "masterVolume" }, -3).find(
        m => m.target.type === "masterVolume"
      )?.channel
    ).toBe(0);
    expect(
      remapMappingChannel(base, { type: "masterVolume" }, 4.9).find(
        m => m.target.type === "masterVolume"
      )?.channel
    ).toBe(4);
  });

  it("verwirft ein kollidierendes Mapping auf (cc, neuer Kanal)", () => {
    // Zwei Targets auf derselben cc=7, aber verschiedenen Kanälen.
    const mappings: MidiMapping[] = [
      { cc: 7, channel: 1, target: { type: "masterVolume" }, label: "Master" },
      {
        cc: 7,
        channel: 5,
        target: { type: "volume", partId: "p1" },
        label: "Vol p1",
      },
    ];
    // masterVolume von Ch1 → Ch5: kollidiert mit dem Vol-p1-Mapping (cc7/Ch5).
    const next = remapMappingChannel(mappings, { type: "masterVolume" }, 5);
    expect(next.filter(m => m.cc === 7 && m.channel === 5)).toHaveLength(1);
    expect(findMappingForTarget(next, { type: "masterVolume" })?.channel).toBe(
      5
    );
    // Das kollidierende Vol-p1-Mapping wurde verworfen.
    expect(
      findMappingForTarget(next, { type: "volume", partId: "p1" })
    ).toBeUndefined();
  });

  it("No-op (gleicher Kanal) gibt dieselbe Referenz zurück", () => {
    const next = remapMappingChannel(
      base,
      { type: "fxParam", partId: "p1", param: "filterFreq" },
      1
    );
    expect(next).toBe(base);
  });

  it("fehlendes Mapping → dieselbe Referenz (kein Persist/Rerender)", () => {
    const next = remapMappingChannel(
      base,
      { type: "volume", partId: "ghost" },
      3
    );
    expect(next).toBe(base);
  });
});
