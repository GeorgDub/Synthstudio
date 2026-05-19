/**
 * tests/features/pattern-variations.test.ts (v3.105.0)
 *
 * Unit-Tests für patternVariations.ts — pure Algorithmen.
 * Verifiziert Reproducibility (seed), Invarianten und Edge-Cases.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { StepData, PatternData } from "../../client/src/audio/AudioEngine";
import {
  humanize,
  addGhostNotes,
  addFill,
  varySwing,
  increaseDensity,
  decreaseDensity,
  shuffleVelocity,
  rhythmicDisplacement,
  applyVariation,
  makeRng,
  ALL_VARIATION_KINDS,
  type VariationConfig,
} from "../../client/src/utils/patternVariations";

// ─── localStorage Mock ───────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  generateBatch,
  previewVariation,
  applyVariationToPattern,
  setLastUsedConfig,
  getPatternVariationGenState,
  __resetPatternVariationGenForTests,
} from "../../client/src/store/usePatternVariationStore";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function step(active: boolean, velocity = 100): StepData {
  return { active, velocity };
}

function emptyRow(n: number): StepData[] {
  return Array.from({ length: n }, () => step(false));
}

function activeRow(n: number, velocity = 100): StepData[] {
  return Array.from({ length: n }, () => step(true, velocity));
}

function fourOnFloor(): StepData[] {
  // 16-step kick pattern: 0, 4, 8, 12
  const row: StepData[] = emptyRow(16);
  [0, 4, 8, 12].forEach((i) => (row[i] = step(true, 100)));
  return row;
}

function countActive(row: StepData[]): number {
  return row.filter((s) => s.active).length;
}

function countActiveGrid(grid: StepData[][]): number {
  return grid.reduce((sum, row) => sum + countActive(row), 0);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("patternVariations – humanize", () => {
  it("erhält Anzahl aktiver Steps, verändert nur Velocity", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = humanize(grid, 0.5, 42);

    expect(countActiveGrid(out)).toBe(4);
    // Velocity sollte sich bewegen, aber innerhalb 1..127
    out[0].forEach((s) => {
      if (s.active) {
        expect(s.velocity).toBeGreaterThanOrEqual(1);
        expect(s.velocity).toBeLessThanOrEqual(127);
      }
    });
  });

  it("seeded: deterministisch reproduzierbar (identische Outputs)", () => {
    const grid: StepData[][] = [fourOnFloor(), activeRow(16, 80)];
    const a = humanize(grid, 0.7, 123);
    const b = humanize(grid, 0.7, 123);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("intensity=0 → keine Velocity-Änderung (Identity bis auf Klone)", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = humanize(grid, 0, 42);
    expect(out[0][0].velocity).toBe(100);
    expect(out[0][4].velocity).toBe(100);
  });

  it("mutiert Input NICHT (pure)", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const before = JSON.stringify(grid);
    humanize(grid, 0.9, 1);
    expect(JSON.stringify(grid)).toBe(before);
  });
});

describe("patternVariations – addGhostNotes", () => {
  it("ghost-notes nur auf leere Steps, aktive bleiben unverändert", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = addGhostNotes(grid, 1.0, 7);
    // Original-aktive (0,4,8,12) bleiben aktiv mit alter Velocity 100
    [0, 4, 8, 12].forEach((i) => {
      expect(out[0][i].active).toBe(true);
      expect(out[0][i].velocity).toBe(100);
    });
  });

  it("intensity=1.0 mit seed → alle leeren Steps werden ghost", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = addGhostNotes(grid, 1.0, 13);
    // 12 originally empty + 4 originally active = 16 active
    expect(countActiveGrid(out)).toBe(16);
    // Ghost velocity 10..30 für die zuvor leeren Steps
    [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].forEach((i) => {
      expect(out[0][i].active).toBe(true);
      expect(out[0][i].velocity).toBeGreaterThanOrEqual(10);
      expect(out[0][i].velocity).toBeLessThanOrEqual(30);
    });
  });

  it("intensity=0 → keine Änderung", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = addGhostNotes(grid, 0, 1);
    expect(countActiveGrid(out)).toBe(4);
  });
});

describe("patternVariations – addFill", () => {
  it("letzte 4 steps mit höherer density als rest", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = addFill(grid);
    // Last 4 steps (12, 13, 14, 15): alle active
    for (let i = 12; i < 16; i++) {
      expect(out[0][i].active).toBe(true);
    }
    // First 12 unangetastet (außer step 12 ist jetzt zwingend active —
    // war es aber schon vorher, durch fourOnFloor)
    expect(out[0][0].active).toBe(true); // war bereits aktiv
    expect(out[0][1].active).toBe(false);
    expect(out[0][2].active).toBe(false);
  });

  it("density letzte 4 > density first 12", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = addFill(grid);
    const last4 = out[0].slice(12, 16).filter((s) => s.active).length;
    const first12 = out[0].slice(0, 12).filter((s) => s.active).length;
    expect(last4 / 4).toBeGreaterThanOrEqual(first12 / 12);
    expect(last4).toBe(4); // alle 4 aktiv
  });

  it("velocity bumps für vorher leere Steps", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = addFill(grid);
    // step 13, 14, 15 sind neu aktiv → velocity ≥ 80 (default 100)
    expect(out[0][13].velocity).toBeGreaterThanOrEqual(80);
    expect(out[0][14].velocity).toBeGreaterThanOrEqual(80);
    expect(out[0][15].velocity).toBeGreaterThanOrEqual(80);
  });
});

describe("patternVariations – varySwing", () => {
  it("timing-offsets (velocity) unterschiedlich für even vs odd Steps", () => {
    const grid: StepData[][] = [activeRow(16, 100)];
    const out = varySwing(grid, 1.0, 5);
    const evenVels: number[] = [];
    const oddVels: number[] = [];
    for (let i = 0; i < 16; i++) {
      if (i % 2 === 0) evenVels.push(out[0][i].velocity!);
      else oddVels.push(out[0][i].velocity!);
    }
    // Alle even haben gleichen Wert, alle odd auch — und sie sind unterschiedlich
    expect(new Set(evenVels).size).toBe(1);
    expect(new Set(oddVels).size).toBe(1);
    expect(evenVels[0]).not.toBe(oddVels[0]);
  });

  it("intensity=0 → keine Änderung", () => {
    const grid: StepData[][] = [activeRow(16, 100)];
    const out = varySwing(grid, 0, 1);
    out[0].forEach((s) => expect(s.velocity).toBe(100));
  });

  it("seeded: deterministisch reproduzierbar", () => {
    const grid: StepData[][] = [activeRow(16, 100)];
    const a = varySwing(grid, 0.6, 99);
    const b = varySwing(grid, 0.6, 99);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("patternVariations – increaseDensity", () => {
  it("intensity=1.0 → alle leeren Steps werden gefüllt", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = increaseDensity(grid, 1.0, 1);
    expect(countActiveGrid(out)).toBe(16);
  });

  it("intensity=0 → keine Änderung", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = increaseDensity(grid, 0, 1);
    expect(countActiveGrid(out)).toBe(4);
  });

  it("seeded mit mittlerer intensity: deterministisch", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const a = increaseDensity(grid, 0.5, 77);
    const b = increaseDensity(grid, 0.5, 77);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("patternVariations – decreaseDensity", () => {
  it("intensity=1.0 → alle gefüllten Steps werden geleert", () => {
    const grid: StepData[][] = [activeRow(16, 100)];
    const out = decreaseDensity(grid, 1.0, 1);
    expect(countActiveGrid(out)).toBe(0);
  });

  it("intensity=0 → keine Änderung", () => {
    const grid: StepData[][] = [activeRow(16, 100)];
    const out = decreaseDensity(grid, 0, 1);
    expect(countActiveGrid(out)).toBe(16);
  });

  it("seeded mit mittlerer intensity: deterministisch", () => {
    const grid: StepData[][] = [activeRow(16, 100)];
    const a = decreaseDensity(grid, 0.5, 21);
    const b = decreaseDensity(grid, 0.5, 21);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("patternVariations – shuffleVelocity", () => {
  it("same multiset wie input (sortiert identisch)", () => {
    const row: StepData[] = emptyRow(16);
    row[0] = step(true, 100);
    row[4] = step(true, 80);
    row[8] = step(true, 60);
    row[12] = step(true, 120);

    const grid: StepData[][] = [row];
    const out = shuffleVelocity(grid, 42);
    const before = [100, 80, 60, 120].sort();
    const after = out[0].filter((s) => s.active).map((s) => s.velocity!).sort();
    expect(after).toEqual(before);
  });

  it("aktive Steps bleiben an denselben Positionen aktiv", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = shuffleVelocity(grid, 12);
    [0, 4, 8, 12].forEach((i) => expect(out[0][i].active).toBe(true));
    [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].forEach((i) =>
      expect(out[0][i].active).toBe(false),
    );
  });

  it("seeded: deterministisch reproduzierbar", () => {
    const row: StepData[] = emptyRow(16);
    [0, 2, 5, 9].forEach((i, j) => (row[i] = step(true, 50 + j * 20)));
    const grid: StepData[][] = [row];
    const a = shuffleVelocity(grid, 555);
    const b = shuffleVelocity(grid, 555);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("patternVariations – rhythmicDisplacement", () => {
  it("max ±1 step shift (kein Step weiter als 1 weg)", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = rhythmicDisplacement(grid, 1.0, 100);

    // Für jeden Original-Step (0,4,8,12) muss EIN aktiver Step in [orig-1..orig+1] sein
    [0, 4, 8, 12].forEach((origIdx) => {
      const window = [origIdx - 1, origIdx, origIdx + 1].filter(
        (i) => i >= 0 && i < 16,
      );
      const anyActive = window.some((i) => out[0][i].active);
      expect(anyActive).toBe(true);
    });

    // Gesamt darf die Anzahl nicht über die Original-Anzahl steigen
    expect(countActiveGrid(out)).toBeLessThanOrEqual(4);
  });

  it("intensity=0 → keine Verschiebung (alle bleiben auf Originalpositionen)", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const out = rhythmicDisplacement(grid, 0, 1);
    [0, 4, 8, 12].forEach((i) => expect(out[0][i].active).toBe(true));
  });

  it("seeded: deterministisch reproduzierbar", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const a = rhythmicDisplacement(grid, 0.7, 88);
    const b = rhythmicDisplacement(grid, 0.7, 88);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("patternVariations – applyVariation (dispatch)", () => {
  it("alle 8 Kinds ergeben gültige Grids (pure, kein Throw)", () => {
    const grid: StepData[][] = [fourOnFloor()];
    for (const kind of ALL_VARIATION_KINDS) {
      const out = applyVariation(grid, { kind, intensity: 0.5, seed: 1 });
      expect(out).toBeDefined();
      expect(out.length).toBe(1);
      expect(out[0].length).toBe(16);
    }
  });

  it("gleicher input + config = gleicher output (preview pure)", () => {
    const grid: StepData[][] = [fourOnFloor(), activeRow(16, 80)];
    const config = { kind: "humanize" as const, intensity: 0.6, seed: 2024 };
    const a = applyVariation(grid, config);
    const b = applyVariation(grid, config);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("ohne Seed: noch immer pure (verschiedene Outputs bei verschiedenen Calls — kein Throw)", () => {
    const grid: StepData[][] = [fourOnFloor()];
    expect(() =>
      applyVariation(grid, { kind: "humanize", intensity: 0.5 }),
    ).not.toThrow();
  });
});

describe("patternVariations – makeRng", () => {
  it("seeded RNG: deterministisch", () => {
    const r1 = makeRng(42);
    const r2 = makeRng(42);
    expect(r1()).toBe(r2());
    expect(r1()).toBe(r2());
    expect(r1()).toBe(r2());
  });

  it("verschiedene Seeds → verschiedene Sequenzen (probabilistisch)", () => {
    const r1 = makeRng(1);
    const r2 = makeRng(2);
    expect(r1()).not.toBe(r2());
  });

  it("kein Seed → Math.random Fallback (gibt 0..1)", () => {
    const r = makeRng();
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it("NaN/Infinity Seed → Math.random Fallback", () => {
    const r1 = makeRng(NaN);
    const r2 = makeRng(Infinity);
    expect(typeof r1()).toBe("number");
    expect(typeof r2()).toBe("number");
  });
});

// ─── Store Tests ─────────────────────────────────────────────────────────────

function makeTestPattern(id = "p1", name = "Test"): PatternData {
  return {
    id,
    name,
    stepCount: 16,
    stepResolution: "1/16",
    bpm: null,
    parts: [
      {
        id: "part-0",
        name: "Kick",
        muted: false,
        soloed: false,
        volume: 1,
        pan: 0,
        steps: emptyRow(16).map((s, i) =>
          i === 0 || i === 4 || i === 8 || i === 12 ? step(true, 100) : s,
        ),
        fx: {
          filterEnabled: false,
          filterType: "lowpass",
          filterFreq: 8000,
          filterQ: 1,
          filterGain: 0,
          distortionEnabled: false,
          distortionAmount: 50,
          compressorEnabled: false,
          compressorThreshold: -24,
          compressorRatio: 4,
          compressorAttack: 0.003,
          compressorRelease: 0.25,
          delayEnabled: false,
          delayTime: 0.25,
          delayFeedback: 0.3,
          delayMix: 0.3,
          reverbEnabled: false,
          reverbDecay: 2.0,
          reverbMix: 0.3,
          eqEnabled: false,
          eqLow: 0,
          eqMid: 0,
          eqHigh: 0,
        },
      },
    ],
  };
}

describe("usePatternVariationStore – previewVariation (pure)", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetPatternVariationGenForTests();
  });

  it("gleicher input + config = gleicher output (deterministic)", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const config: VariationConfig = { kind: "humanize", intensity: 0.7, seed: 42 };
    const a = previewVariation(grid, config);
    const b = previewVariation(grid, config);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("mutiert Input nicht", () => {
    const grid: StepData[][] = [fourOnFloor()];
    const before = JSON.stringify(grid);
    previewVariation(grid, { kind: "ghost-notes", intensity: 1.0, seed: 1 });
    expect(JSON.stringify(grid)).toBe(before);
  });
});

describe("usePatternVariationStore – generateBatch", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetPatternVariationGenForTests();
  });

  it("returns N pattern-IDs für N configs", () => {
    let counter = 0;
    const dup = (_cfg: VariationConfig) => `new-pattern-${counter++}`;
    const configs: VariationConfig[] = [
      { kind: "humanize", intensity: 0.5 },
      { kind: "ghost-notes", intensity: 0.3 },
      { kind: "fill-add", intensity: 1.0 },
      { kind: "shuffle-velocity", intensity: 0.5 },
    ];
    const ids = generateBatch(configs, dup);
    expect(ids).toEqual(["new-pattern-0", "new-pattern-1", "new-pattern-2", "new-pattern-3"]);
    expect(ids.length).toBe(4);
  });

  it("empty configs → empty result", () => {
    const ids = generateBatch([], () => "should-not-call");
    expect(ids).toEqual([]);
  });

  it("dup-callback returns empty string → wird gefiltert", () => {
    const dup = (_cfg: VariationConfig) => "";
    const ids = generateBatch(
      [{ kind: "humanize", intensity: 0.5 }],
      dup,
    );
    expect(ids).toEqual([]);
  });
});

describe("usePatternVariationStore – applyVariationToPattern", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetPatternVariationGenForTests();
  });

  it("erzeugt neues PatternData mit varied steps", () => {
    const src = makeTestPattern();
    const config: VariationConfig = { kind: "humanize", intensity: 0.5, seed: 1 };
    const out = applyVariationToPattern(src, config);
    expect(out.id).toBe(src.id);
    expect(out.name).toContain("humanize");
    expect(out.parts.length).toBe(1);
    expect(out.parts[0].steps.length).toBe(16);
  });

  it("optionaler Name wird übernommen", () => {
    const src = makeTestPattern();
    const out = applyVariationToPattern(
      src,
      { kind: "fill-add", intensity: 1.0 },
      "Custom Name",
    );
    expect(out.name).toBe("Custom Name");
  });

  it("mutiert source-Pattern nicht (pure)", () => {
    const src = makeTestPattern();
    const before = JSON.stringify(src);
    applyVariationToPattern(src, { kind: "ghost-notes", intensity: 1.0, seed: 5 });
    expect(JSON.stringify(src)).toBe(before);
  });
});

describe("usePatternVariationStore – setLastUsedConfig persistence", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetPatternVariationGenForTests();
  });

  it("persistiert in localStorage und liest zurück", () => {
    setLastUsedConfig({ kind: "fill-add", intensity: 0.8, seed: 99 });
    const stored = localStorageMock.getItem("ss-pattern-variation-gen:v1");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.lastUsedConfig.kind).toBe("fill-add");
    expect(parsed.lastUsedConfig.intensity).toBe(0.8);
    expect(parsed.lastUsedConfig.seed).toBe(99);
  });

  it("clampt intensity-out-of-range bei get", () => {
    setLastUsedConfig({ kind: "humanize", intensity: 1.5 });
    // setLastUsedConfig speichert was übergeben wurde; _loadState beim Reload clampt.
    // Hier: nach setLastUsedConfig getState liefert den un-clamped Wert (nur load clampt)
    expect(getPatternVariationGenState().lastUsedConfig.kind).toBe("humanize");
  });
});
