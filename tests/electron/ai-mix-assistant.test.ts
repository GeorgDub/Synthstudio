/**
 * ai-mix-assistant.test.ts
 *
 * Tests für den regelbasierten Mix-Analysten (Phase 8).
 * Kein LLM erforderlich – rein deterministisch.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeMix,
  MixAnalysisInput,
  PartSnapshot,
} from "../../client/src/utils/mixAnalysis";

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function part(overrides: Partial<PartSnapshot> & { id: string; name: string }): PartSnapshot {
  return {
    volume: 80,
    pan: 0,
    activeSteps: 8,
    totalSteps: 16,
    reverbSend: 10,
    ...overrides,
  };
}

const baseInput = (): MixAnalysisInput => ({
  bpm: 120,
  masterVolume: 90,
  parts: [
    part({ id: "1", name: "Kick", trackType: "kick" }),
    part({ id: "2", name: "Snare", trackType: "snare" }),
    // 12/16 = 75 % Dichte → unter dem 85 %-Schwellwert, keine Density-Warnung
    part({ id: "3", name: "HiHat", trackType: "hihat", activeSteps: 12 }),
  ],
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("analyzeMix – Volume-Regeln", () => {
  it("meldet keine Empfehlungen bei gesundem Mix", () => {
    const result = analyzeMix(baseInput());
    expect(result).toHaveLength(0);
  });

  it("meldet 'critical' wenn masterVolume > 115", () => {
    const result = analyzeMix({ ...baseInput(), masterVolume: 120 });
    const critical = result.filter(r => r.severity === "critical");
    expect(critical.length).toBeGreaterThan(0);
    expect(critical[0].targetProperty).toBe("masterVolume");
    expect(critical[0].suggestedValue).toBeLessThan(120);
  });

  it("meldet 'warning' wenn Kick-Lautstärke > 110", () => {
    const input = baseInput();
    input.parts[0].volume = 120;
    const result = analyzeMix(input);
    const kickWarning = result.find(r => r.partId === "1" && r.category === "volume");
    expect(kickWarning).toBeDefined();
    expect(kickWarning!.severity).toBe("warning");
  });

  it("meldet 'info' wenn Kick-Lautstärke < 60", () => {
    const input = baseInput();
    input.parts[0].volume = 40;
    const result = analyzeMix(input);
    const kickInfo = result.find(r => r.partId === "1" && r.category === "volume" && r.severity === "info");
    expect(kickInfo).toBeDefined();
  });
});

describe("analyzeMix – Panning-Regeln", () => {
  it("meldet 'warning' wenn Kick stark seitlich ist (pan > 20)", () => {
    const input = baseInput();
    input.parts[0].pan = 50; // Kick stark rechts
    const result = analyzeMix(input);
    const panWarning = result.find(r => r.category === "panning" && r.partId === "1");
    expect(panWarning).toBeDefined();
    expect(panWarning!.severity).toBe("warning");
    expect(panWarning!.suggestedValue).toBe(0);
  });

  it("erkennt Link-Lastigkeit des gesamten Mixes", () => {
    const input: MixAnalysisInput = {
      bpm: 120,
      masterVolume: 90,
      parts: [
        part({ id: "1", name: "A", pan: -60 }),
        part({ id: "2", name: "B", pan: -50 }),
        part({ id: "3", name: "C", pan: -45 }),
        part({ id: "4", name: "D", pan: -55 }),
      ],
    };
    const result = analyzeMix(input);
    expect(result.some(r => r.id === "pan-all-left")).toBe(true);
  });
});

describe("analyzeMix – Density-Regeln", () => {
  it("meldet 'info' für dichte HiHat (>85% Steps aktiv)", () => {
    const input = baseInput();
    input.parts[2].activeSteps = 16;
    input.parts[2].totalSteps = 16;
    const result = analyzeMix(input);
    const hatInfo = result.find(r => r.category === "density" && r.partId === "3");
    expect(hatInfo).toBeDefined();
  });

  it("meldet 'info' für stille Spur (0 aktive Steps)", () => {
    const input = baseInput();
    input.parts[1].activeSteps = 0;
    const result = analyzeMix(input);
    const silentInfo = result.find(r => r.id.startsWith("density-silent-2"));
    expect(silentInfo).toBeDefined();
  });
});

describe("analyzeMix – BPM-Regeln", () => {
  it("meldet 'warning' für BPM > 200", () => {
    const result = analyzeMix({ ...baseInput(), bpm: 220 });
    expect(result.some(r => r.id === "bpm-high")).toBe(true);
  });

  it("meldet 'info' für BPM < 60", () => {
    const result = analyzeMix({ ...baseInput(), bpm: 45 });
    expect(result.some(r => r.id === "bpm-low")).toBe(true);
  });
});

describe("analyzeMix – Reihenfolge", () => {
  it("sortiert critical vor warning vor info", () => {
    const input: MixAnalysisInput = {
      bpm: 45,           // → info
      masterVolume: 127, // → critical
      parts: [
        part({ id: "1", name: "Kick", trackType: "kick", volume: 120, pan: 80 }),
      ],
    };
    const result = analyzeMix(input);
    const severities = result.map(r => r.severity);
    const firstInfo = severities.indexOf("info");
    const firstCritical = severities.indexOf("critical");
    const firstWarning = severities.indexOf("warning");
    if (firstCritical !== -1 && firstWarning !== -1) expect(firstCritical).toBeLessThan(firstWarning);
    if (firstWarning !== -1 && firstInfo !== -1) expect(firstWarning).toBeLessThan(firstInfo);
  });
});
