/**
 * audio-engine.test.ts
 *
 * Tests für reine Berechnungs-Logik in AudioEngine (Phase 9).
 * Keine AudioContext-Instanz nötig – nur mathematische Funktionen.
 */
import { describe, it, expect } from "vitest";

// ─── Isolierte Berechnungen (aus AudioEngine.ts extrahiert) ──────────────────

/** Sekunden pro Beat bei gegebenem BPM */
function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/** Sekunden pro Step bei gegebener Resolution und BPM */
function secondsPerStep(bpm: number, resolution: "1/8" | "1/16" | "1/32"): number {
  const factor = resolution === "1/8" ? 0.5 : resolution === "1/16" ? 0.25 : 0.125;
  return secondsPerBeat(bpm) * factor;
}

/** BPM-Clamping: erlaubt 20–300 */
function clampBpm(bpm: number): number {
  return Math.max(20, Math.min(300, bpm));
}

/** Berechnet Pitch-Shift-Rate aus Halbtonschritten */
function semitoneToRate(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/** Normalisiert Volume (0–1) auf das korrekte GainNode-Level */
function normalizeVolume(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Pan-Wert (-1 bis +1) → linkes Gain */
function panToLeftGain(pan: number): number {
  // Equal-Power Panning
  return Math.cos(((pan + 1) / 2) * (Math.PI / 2));
}

/** Pan-Wert (-1 bis +1) → rechtes Gain */
function panToRightGain(pan: number): number {
  return Math.sin(((pan + 1) / 2) * (Math.PI / 2));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BPM-Clamping", () => {
  it("akzeptiert gültige BPM (120)", () => expect(clampBpm(120)).toBe(120));
  it("clampmt zu niedrige BPM auf 20", () => expect(clampBpm(0)).toBe(20));
  it("clampmt zu hohe BPM auf 300", () => expect(clampBpm(999)).toBe(300));
  it("Grenzwert 20 wird akzeptiert", () => expect(clampBpm(20)).toBe(20));
  it("Grenzwert 300 wird akzeptiert", () => expect(clampBpm(300)).toBe(300));
});

describe("Step-Dauer-Berechnungen", () => {
  it("1/16 bei 120 BPM = 0.125 s", () => {
    expect(secondsPerStep(120, "1/16")).toBeCloseTo(0.125);
  });

  it("1/8 bei 120 BPM = 0.25 s", () => {
    expect(secondsPerStep(120, "1/8")).toBeCloseTo(0.25);
  });

  it("1/32 bei 120 BPM = 0.0625 s", () => {
    expect(secondsPerStep(120, "1/32")).toBeCloseTo(0.0625);
  });

  it("bei 60 BPM sind Step-Dauern doppelt so lang", () => {
    const at120 = secondsPerStep(120, "1/16");
    const at60 = secondsPerStep(60, "1/16");
    expect(at60).toBeCloseTo(at120 * 2);
  });
});

describe("Pitch-Shift (Semitone → Rate)", () => {
  it("0 Halbton = Rate 1.0 (kein Shift)", () => {
    expect(semitoneToRate(0)).toBeCloseTo(1.0);
  });

  it("12 Halbton = Rate 2.0 (eine Oktave hoch)", () => {
    expect(semitoneToRate(12)).toBeCloseTo(2.0);
  });

  it("-12 Halbton = Rate 0.5 (eine Oktave tiefer)", () => {
    expect(semitoneToRate(-12)).toBeCloseTo(0.5);
  });
});

describe("Volume-Normalisierung", () => {
  it("akzeptiert Werte in 0–1", () => expect(normalizeVolume(0.8)).toBe(0.8));
  it("clampmt > 1 auf 1", () => expect(normalizeVolume(2)).toBe(1));
  it("clampmt < 0 auf 0", () => expect(normalizeVolume(-0.5)).toBe(0));
});

describe("Equal-Power Panning", () => {
  it("Center: linkes und rechtes Gain gleich (~0.707)", () => {
    const l = panToLeftGain(0);
    const r = panToRightGain(0);
    expect(l).toBeCloseTo(r, 2);
    expect(l).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("Full-Links: linkes Gain ≈ 1, rechtes ≈ 0", () => {
    expect(panToLeftGain(-1)).toBeCloseTo(1, 2);
    expect(panToRightGain(-1)).toBeCloseTo(0, 2);
  });

  it("Full-Rechts: rechtes Gain ≈ 1, linkes ≈ 0", () => {
    expect(panToRightGain(1)).toBeCloseTo(1, 2);
    expect(panToLeftGain(1)).toBeCloseTo(0, 2);
  });
});
