/**
 * tests/features/mix-analysis.test.ts (TASK-CVG-MIXANALYSIS / v2.63)
 *
 * Pure-Coverage für client/src/utils/mixAnalysis.ts.
 *
 * Regelbasierter Mix-Assistent: 6 Regeln (Master-Volume / BPM / Kick-Volume /
 * Low-End-Balance / Panning / Density). Diese Suite verifiziert jede
 * einzelne Regel + Sort-Order der Empfehlungen (critical > warning > info).
 */
import { describe, it, expect } from "vitest";
import {
  analyzeMix,
  type PartSnapshot,
  type MixAnalysisInput,
} from "@/utils/mixAnalysis";

function part(overrides: Partial<PartSnapshot> = {}): PartSnapshot {
  return {
    id: overrides.id ?? "p1",
    name: overrides.name ?? "Part",
    volume: 80,
    pan: 0,
    activeSteps: 4,
    totalSteps: 16,
    ...overrides,
  };
}

function input(overrides: Partial<MixAnalysisInput> = {}): MixAnalysisInput {
  return {
    bpm: 120,
    masterVolume: 100,
    parts: [],
    ...overrides,
  };
}

describe("MixAnalysis – Master-Volume Rule", () => {
  it("master=100 → keine Empfehlung", () => {
    const recs = analyzeMix(input({ masterVolume: 100 }));
    expect(recs.find((r) => r.id === "master-clipping")).toBeUndefined();
  });

  it("master=115 (grenze) → keine Empfehlung (strict >)", () => {
    const recs = analyzeMix(input({ masterVolume: 115 }));
    expect(recs.find((r) => r.id === "master-clipping")).toBeUndefined();
  });

  it("master=116 → critical 'master-clipping' mit suggestedValue=100", () => {
    const recs = analyzeMix(input({ masterVolume: 116 }));
    const rec = recs.find((r) => r.id === "master-clipping");
    expect(rec).toBeDefined();
    expect(rec!.severity).toBe("critical");
    expect(rec!.suggestedValue).toBe(100);
    expect(rec!.targetProperty).toBe("masterVolume");
  });
});

describe("MixAnalysis – BPM Rule", () => {
  it("BPM 120 → keine Empfehlung", () => {
    const recs = analyzeMix(input({ bpm: 120 }));
    expect(recs.find((r) => r.id.startsWith("bpm-"))).toBeUndefined();
  });

  it("BPM 200 (grenze) → keine Empfehlung (strict >)", () => {
    const recs = analyzeMix(input({ bpm: 200 }));
    expect(recs.find((r) => r.id === "bpm-high")).toBeUndefined();
  });

  it("BPM 201 → warning 'bpm-high'", () => {
    const recs = analyzeMix(input({ bpm: 201 }));
    const rec = recs.find((r) => r.id === "bpm-high");
    expect(rec?.severity).toBe("warning");
  });

  it("BPM 60 → keine Empfehlung (strict <)", () => {
    const recs = analyzeMix(input({ bpm: 60 }));
    expect(recs.find((r) => r.id === "bpm-low")).toBeUndefined();
  });

  it("BPM 59 → info 'bpm-low'", () => {
    const recs = analyzeMix(input({ bpm: 59 }));
    const rec = recs.find((r) => r.id === "bpm-low");
    expect(rec?.severity).toBe("info");
  });
});

describe("MixAnalysis – Kick-Volume Rule", () => {
  it("Kick @ vol 100 → keine Empfehlung (normal)", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "k", name: "Kick", trackType: "kick", volume: 100 })],
    }));
    expect(recs.find((r) => r.id.startsWith("vol-kick"))).toBeUndefined();
  });

  it("Kick @ vol 115 → warning 'vol-kick-loud'", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "k", name: "Kick", trackType: "kick", volume: 115 })],
    }));
    const rec = recs.find((r) => r.id === "vol-kick-loud-k");
    expect(rec?.severity).toBe("warning");
    expect(rec?.suggestedValue).toBe(100);
  });

  it("Kick @ vol 50 → info 'vol-kick-quiet'", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "k", name: "Kick", trackType: "kick", volume: 50 })],
    }));
    const rec = recs.find((r) => r.id === "vol-kick-quiet-k");
    expect(rec?.severity).toBe("info");
  });

  it("Non-Kick trackType → keine Kick-Rule triggert", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "h", name: "Hat", trackType: "hihat", volume: 115 })],
    }));
    expect(recs.find((r) => r.id.startsWith("vol-kick"))).toBeUndefined();
  });

  it("trackType-Matching ist case-insensitive ('BD' matcht KICK_TYPES)", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "k", name: "Big Kick", trackType: "BD", volume: 115 })],
    }));
    expect(recs.find((r) => r.id === "vol-kick-loud-k")).toBeDefined();
  });
});

describe("MixAnalysis – Low-End-Balance Rule", () => {
  it("Kick + Bass mit ähnlicher Lautstärke (diff<5) → info empfohlen", () => {
    const recs = analyzeMix(input({
      parts: [
        part({ id: "k", name: "Kick", trackType: "kick", volume: 100 }),
        part({ id: "b", name: "Bass", trackType: "bass", volume: 102 }),
      ],
    }));
    expect(recs.find((r) => r.id === "balance-kick-bass")).toBeDefined();
  });

  it("Kick + Bass mit großer Differenz → keine balance-Empfehlung", () => {
    const recs = analyzeMix(input({
      parts: [
        part({ id: "k", name: "Kick", trackType: "kick", volume: 100 }),
        part({ id: "b", name: "Bass", trackType: "bass", volume: 60 }),
      ],
    }));
    expect(recs.find((r) => r.id === "balance-kick-bass")).toBeUndefined();
  });

  it("Nur Kick, kein Bass → keine balance-Empfehlung", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "k", trackType: "kick", volume: 100 })],
    }));
    expect(recs.find((r) => r.id === "balance-kick-bass")).toBeUndefined();
  });
});

describe("MixAnalysis – Panning Rule", () => {
  it("Kick @ pan=0 (center) → keine Empfehlung", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "k", trackType: "kick", pan: 0 })],
    }));
    expect(recs.find((r) => r.id === "pan-center-k")).toBeUndefined();
  });

  it("Kick @ pan=21 → warning 'pan-center'", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "k", name: "Kick", trackType: "kick", pan: 21 })],
    }));
    const rec = recs.find((r) => r.id === "pan-center-k");
    expect(rec?.severity).toBe("warning");
    expect(rec?.suggestedValue).toBe(0);
  });

  it("Snare @ pan=-30 → warning 'pan-center'", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "s", name: "Snare", trackType: "snare", pan: -30 })],
    }));
    expect(recs.find((r) => r.id === "pan-center-s")).toBeDefined();
  });

  it("Hihat @ pan=80 → keine pan-center-Empfehlung (Hi-Hat ist OK off-center)", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "h", trackType: "hihat", pan: 80 })],
    }));
    expect(recs.find((r) => r.id === "pan-center-h")).toBeUndefined();
  });

  it("60%+ Parts stark links → warning 'pan-all-left'", () => {
    const recs = analyzeMix(input({
      parts: [
        part({ id: "1", pan: -50 }),
        part({ id: "2", pan: -50 }),
        part({ id: "3", pan: -50 }),
      ],
    }));
    expect(recs.find((r) => r.id === "pan-all-left")).toBeDefined();
  });

  it("60%+ Parts stark rechts → warning 'pan-all-right'", () => {
    const recs = analyzeMix(input({
      parts: [
        part({ id: "1", pan: 50 }),
        part({ id: "2", pan: 50 }),
        part({ id: "3", pan: 50 }),
      ],
    }));
    expect(recs.find((r) => r.id === "pan-all-right")).toBeDefined();
  });
});

describe("MixAnalysis – Density Rule", () => {
  it("HiHat @ 14/16 Steps (density=0.875) → info 'density-hat'", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "h", name: "Hat", trackType: "hihat", activeSteps: 14, totalSteps: 16 })],
    }));
    expect(recs.find((r) => r.id === "density-hat-h")).toBeDefined();
  });

  it("HiHat @ 12/16 (density=0.75) → keine Empfehlung (strict >0.85)", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "h", trackType: "hihat", activeSteps: 12, totalSteps: 16 })],
    }));
    expect(recs.find((r) => r.id === "density-hat-h")).toBeUndefined();
  });

  it("Kick @ 14/16 → keine density-hat Empfehlung (nur HiHats werden geprüft)", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "k", trackType: "kick", activeSteps: 14, totalSteps: 16 })],
    }));
    expect(recs.find((r) => r.id.startsWith("density-hat"))).toBeUndefined();
  });

  it("Part @ 0/16 (komplett leer) → info 'density-silent'", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "x", name: "Empty", activeSteps: 0, totalSteps: 16 })],
    }));
    expect(recs.find((r) => r.id === "density-silent-x")).toBeDefined();
  });

  it("Part mit totalSteps=0 → keine density-Empfehlung (Divide-by-zero Guard)", () => {
    const recs = analyzeMix(input({
      parts: [part({ id: "p", activeSteps: 0, totalSteps: 0 })],
    }));
    expect(recs.find((r) => r.id.startsWith("density-"))).toBeUndefined();
  });
});

describe("MixAnalysis – Sort-Order", () => {
  it("critical kommt vor warning vor info", () => {
    const recs = analyzeMix(input({
      masterVolume: 120,                 // critical
      bpm: 250,                          // warning
      parts: [part({ id: "x", activeSteps: 0, totalSteps: 16 })], // info (density-silent)
    }));
    const severities = recs.map((r) => r.severity);
    const criticalIdx = severities.indexOf("critical");
    const warningIdx = severities.indexOf("warning");
    const infoIdx = severities.indexOf("info");
    expect(criticalIdx).toBeLessThan(warningIdx);
    expect(warningIdx).toBeLessThan(infoIdx);
  });

  it("Bei gleicher severity: alphabetisch nach ID", () => {
    const recs = analyzeMix(input({
      parts: [
        // beide info
        part({ id: "zzz", activeSteps: 0, totalSteps: 16 }),
        part({ id: "aaa", activeSteps: 0, totalSteps: 16 }),
      ],
    }));
    const infoRecs = recs.filter((r) => r.severity === "info");
    const ids = infoRecs.map((r) => r.id);
    // density-silent-aaa < density-silent-zzz
    const aaaIdx = ids.findIndex((id) => id.includes("aaa"));
    const zzzIdx = ids.findIndex((id) => id.includes("zzz"));
    expect(aaaIdx).toBeLessThan(zzzIdx);
  });
});

describe("MixAnalysis – Empty Input", () => {
  it("Keine Parts + normale Werte → leere Empfehlungs-Liste", () => {
    const recs = analyzeMix(input());
    expect(recs).toEqual([]);
  });
});
