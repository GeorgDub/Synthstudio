/**
 * tests/features/drum-kit-distribution.test.ts (v3.173)
 *
 * Pure-Coverage fuer client/src/utils/drumKitDistribution.ts:
 * intelligente Sample-zu-Part-Verteilung via Pattern-Matching auf
 * Category + Tags + Name.
 */
import { describe, it, expect } from "vitest";
import {
  distributeDrumKit,
  DEFAULT_SLOT_PREFERENCES,
  type SampleCandidate,
} from "@/utils/drumKitDistribution";

describe("DrumKitDistribution - Empty + Edge Cases", () => {
  it("empty samples returns 16 null slots and empty unassigned", () => {
    const result = distributeDrumKit([]);
    expect(result.partAssignments).toHaveLength(16);
    expect(result.partAssignments.every((a) => a.sampleId === null)).toBe(true);
    expect(result.partAssignments.map((a) => a.partIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(result.unassignedSamples).toEqual([]);
  });

  it("partCount below 1 is clamped to 1", () => {
    const result = distributeDrumKit([], { partCount: 0 });
    expect(result.partAssignments).toHaveLength(1);
    expect(result.partAssignments[0]).toEqual({ partIndex: 0, sampleId: null });
  });

  it("negative partCount becomes 1 slot", () => {
    const result = distributeDrumKit([], { partCount: -5 });
    expect(result.partAssignments).toHaveLength(1);
  });

  it("sample without matching name/tags/category lands in unassigned", () => {
    const samples: SampleCandidate[] = [{ id: "s1", name: "" }];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments.every((a) => a.sampleId === null)).toBe(true);
    expect(result.unassignedSamples).toEqual(["s1"]);
  });
});

describe("DrumKitDistribution - Single Sample Matching", () => {
  it("single kick.wav goes to partIndex 0, no unassigned", () => {
    const samples: SampleCandidate[] = [{ id: "s1", name: "kick.wav" }];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[0].sampleId).toBe("s1");
    expect(result.unassignedSamples).toEqual([]);
    for (let i = 1; i < 16; i++) {
      expect(result.partAssignments[i].sampleId).toBeNull();
    }
  });

  it("matched via tags (tag=snare) goes to slot 1", () => {
    const samples: SampleCandidate[] = [
      { id: "s1", name: "anything.wav", tags: ["snare"] },
    ];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[1].sampleId).toBe("s1");
    expect(result.partAssignments[0].sampleId).toBeNull();
    expect(result.unassignedSamples).toEqual([]);
  });

  it("matched via category (category=kick) goes to slot 0", () => {
    const samples: SampleCandidate[] = [
      { id: "s1", name: "x.wav", category: "kick" },
    ];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[0].sampleId).toBe("s1");
  });

  it("case-insensitive: KICK.WAV matches slot 0", () => {
    const samples: SampleCandidate[] = [{ id: "s1", name: "KICK.WAV" }];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[0].sampleId).toBe("s1");
  });

  it("partial match in name: 808-kick-deep.wav matches slot 0", () => {
    const samples: SampleCandidate[] = [{ id: "s1", name: "808-kick-deep.wav" }];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[0].sampleId).toBe("s1");
  });

  it("tag case-insensitive: tag SNARE matches slot 1", () => {
    const samples: SampleCandidate[] = [
      { id: "s1", name: "x.wav", tags: ["SNARE"] },
    ];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[1].sampleId).toBe("s1");
  });

  it("category case-insensitive: category KICK matches slot 0", () => {
    const samples: SampleCandidate[] = [
      { id: "s1", name: "x.wav", category: "KICK" },
    ];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[0].sampleId).toBe("s1");
  });
});

describe("DrumKitDistribution - Greedy Consumption", () => {
  it("multiple kicks: first wins slot 0, others unassigned", () => {
    const samples: SampleCandidate[] = [
      { id: "k1", name: "kick1.wav" },
      { id: "k2", name: "kick2.wav" },
      { id: "k3", name: "kick3.wav" },
    ];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[0].sampleId).toBe("k1");
    expect(result.unassignedSamples).toContain("k2");
    expect(result.unassignedSamples).toContain("k3");
    expect(result.unassignedSamples).toHaveLength(2);
  });

  it("sample is not assigned twice (consumed set works)", () => {
    const samples: SampleCandidate[] = [
      { id: "ambi", name: "ambi-kick.wav", tags: ["snare"] },
    ];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[0].sampleId).toBe("ambi");
    expect(result.partAssignments[1].sampleId).toBeNull();
    expect(result.unassignedSamples).toEqual([]);
  });

  it("tag priority: sample with tag kick wins slot 0 even if name contains snare", () => {
    const samples: SampleCandidate[] = [
      { id: "s1", name: "snare-loop.wav", tags: ["kick"] },
    ];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[0].sampleId).toBe("s1");
    expect(result.partAssignments[1].sampleId).toBeNull();
  });

  it("multi-kit: kick + snare + hat go to three distinct slots", () => {
    const samples: SampleCandidate[] = [
      { id: "k", name: "kick.wav" },
      { id: "s", name: "snare.wav" },
      { id: "h", name: "hihat.wav" },
    ];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments[0].sampleId).toBe("k");
    expect(result.partAssignments[1].sampleId).toBe("s");
    expect(result.partAssignments[2].sampleId).toBe("h");
    expect(result.unassignedSamples).toEqual([]);
  });
});

describe("DrumKitDistribution - Custom Options", () => {
  it("custom slotPreferences override defaults", () => {
    const samples: SampleCandidate[] = [
      { id: "a", name: "alpha.wav" },
      { id: "b", name: "beta.wav" },
    ];
    const result = distributeDrumKit(samples, {
      slotPreferences: [
        { partIndex: 0, matchers: ["beta"] },
        { partIndex: 1, matchers: ["alpha"] },
      ],
    });
    expect(result.partAssignments[0].sampleId).toBe("b");
    expect(result.partAssignments[1].sampleId).toBe("a");
  });

  it("partCount=8 yields only 8 slots", () => {
    const result = distributeDrumKit([], { partCount: 8 });
    expect(result.partAssignments).toHaveLength(8);
    expect(result.partAssignments.map((a) => a.partIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("partCount=20: slots 16-19 stay null (no default prefs)", () => {
    const samples: SampleCandidate[] = [{ id: "k", name: "kick.wav" }];
    const result = distributeDrumKit(samples, { partCount: 20 });
    expect(result.partAssignments).toHaveLength(20);
    expect(result.partAssignments[0].sampleId).toBe("k");
    for (let i = 16; i < 20; i++) {
      expect(result.partAssignments[i].sampleId).toBeNull();
    }
  });

  it("partCount=8 ignores slotPreferences with partIndex >= 8", () => {
    const samples: SampleCandidate[] = [
      { id: "k", name: "kick.wav" },
      { id: "c", name: "crash.wav" },
    ];
    const result = distributeDrumKit(samples, { partCount: 8 });
    expect(result.partAssignments).toHaveLength(8);
    expect(result.partAssignments[0].sampleId).toBe("k");
    expect(result.unassignedSamples).toContain("c");
  });
});

describe("DrumKitDistribution - Unassigned Logic", () => {
  it("sample with no matcher hit (ambient.wav) lands in unassigned", () => {
    const samples: SampleCandidate[] = [{ id: "s1", name: "ambient.wav" }];
    const result = distributeDrumKit(samples);
    expect(result.partAssignments.every((a) => a.sampleId === null)).toBe(true);
    expect(result.unassignedSamples).toEqual(["s1"]);
  });

  it("unassignedSamples preserves input order", () => {
    const samples: SampleCandidate[] = [
      { id: "x", name: "ambient.wav" },
      { id: "y", name: "noise.wav" },
      { id: "z", name: "fx.wav" },
    ];
    const result = distributeDrumKit(samples);
    expect(result.unassignedSamples).toEqual(["x", "y", "z"]);
  });
});

describe("DrumKitDistribution - DEFAULT_SLOT_PREFERENCES", () => {
  it("has 16 entries with unique partIndex 0..15", () => {
    expect(DEFAULT_SLOT_PREFERENCES).toHaveLength(16);
    const indices = DEFAULT_SLOT_PREFERENCES.map((p) => p.partIndex).sort(
      (a, b) => a - b,
    );
    expect(indices).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
  });

  it("every slot has at least one matcher", () => {
    for (const pref of DEFAULT_SLOT_PREFERENCES) {
      expect(pref.matchers.length).toBeGreaterThan(0);
    }
  });

  it("slot 0 is kick, slot 1 is snare", () => {
    expect(DEFAULT_SLOT_PREFERENCES[0].matchers).toContain("kick");
    expect(DEFAULT_SLOT_PREFERENCES[1].matchers).toContain("snare");
  });
});
