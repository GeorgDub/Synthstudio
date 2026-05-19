/**
 * tests/features/project-diff.test.ts (v3.118.0)
 *
 * Unit-Tests für projectDiff.ts:
 *  - Pure-Helpers (valuesEqual, diffObject, diffArrays)
 *  - diffProjects (Top-level Sections: metadata, patterns, channels, samples, mixer, macros)
 *  - formatDiffSummary + formatDiffMarkdown + isEmptyDiff
 *
 * Alle Tests laufen ohne DOM (Node) — projectDiff hat 0 externe Effekte.
 */
import { describe, it, expect } from "vitest";
import {
  diffArrays,
  diffObject,
  diffProjects,
  formatDiffMarkdown,
  formatDiffSummary,
  formatValue,
  isEmptyDiff,
  valuesEqual,
  FLOAT_EPSILON,
  type FieldDiff,
} from "@/utils/projectDiff";
import type { SynthProject } from "@/utils/projectSerializer";

// ─── Fixture-Builder ──────────────────────────────────────────────────────────

function makeProject(overrides: Partial<SynthProject> = {}): SynthProject {
  return {
    version: "1.36",
    projectId: "11111111-1111-4111-8111-111111111111",
    projectName: "Test-Projekt",
    savedAt: "2026-05-19T10:00:00.000Z",
    bpm: 120,
    samples: [],
    patterns: [],
    activePatternId: "pat-1",
    song: { slots: [], songModeActive: false, loopSong: false },
    mixer: {
      masterVolume: 0.8,
      channels: {},
      returnTracks: {
        reverb: { id: "reverb", name: "Reverb", volume: 0.7, muted: false },
        delay: { id: "delay", name: "Delay", volume: 0.7, muted: false },
      },
      insertChains: {},
      eq16: {},
      sidechains: {},
      transientShapers: {},
    },
    humanizer: { global: { timing: 0, velocity: 0, swing: 0 } } as SynthProject["humanizer"],
    automation: { lanes: [], stepCount: 16 },
    ...overrides,
  };
}

function makePattern(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Pattern-${id}`,
    stepCount: 16 as const,
    stepResolution: "16th" as const,
    bpm: null,
    parts: [],
    ...overrides,
  };
}

function makePart(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Part-${id}`,
    muted: false,
    soloed: false,
    volume: 0.8,
    pan: 0,
    steps: [],
    fx: { reverbMix: 0.2, delayMix: 0.1 },
    ...overrides,
  } as unknown as import("@/audio/AudioEngine").PartData;
}

// ─── valuesEqual ──────────────────────────────────────────────────────────────

describe("valuesEqual", () => {
  it("identische Primitives sind gleich", () => {
    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual("a", "a")).toBe(true);
    expect(valuesEqual(true, true)).toBe(true);
    expect(valuesEqual(null, null)).toBe(true);
  });

  it("verschiedene Primitives sind ungleich", () => {
    expect(valuesEqual(1, 2)).toBe(false);
    expect(valuesEqual("a", "b")).toBe(false);
    expect(valuesEqual(true, false)).toBe(false);
  });

  it("Float-Epsilon: 0.500001 vs 0.5 → gleich (innerhalb 1e-4)", () => {
    expect(valuesEqual(0.500001, 0.5)).toBe(true);
    expect(valuesEqual(0.5 + FLOAT_EPSILON / 2, 0.5)).toBe(true);
  });

  it("Float außerhalb Epsilon ist ungleich", () => {
    expect(valuesEqual(0.501, 0.5)).toBe(false);
    expect(valuesEqual(120, 128)).toBe(false);
  });

  it("Arrays element-für-element verglichen", () => {
    expect(valuesEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(valuesEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(valuesEqual([1, 2, 3], [1, 2, 4])).toBe(false);
  });

  it("verschachtelte Objekte rekursiv", () => {
    expect(valuesEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(valuesEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("NaN gilt als gleich NaN (Diff-Zweck)", () => {
    expect(valuesEqual(NaN, NaN)).toBe(true);
  });
});

// ─── diffObject ───────────────────────────────────────────────────────────────

describe("diffObject", () => {
  it("identische Objekte → leeres Diff-Array", () => {
    expect(diffObject({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
  });

  it("ein geänderter Wert → ein FieldDiff", () => {
    const diffs = diffObject({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toEqual({ path: "b", before: 2, after: 3 });
  });

  it("ignoreKeys überspringt Top-level-Felder", () => {
    const diffs = diffObject(
      { savedAt: "yesterday", bpm: 120 },
      { savedAt: "today", bpm: 128 },
      new Set(["savedAt"]),
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe("bpm");
  });

  it("nested object → punkt-separierter Pfad", () => {
    const diffs = diffObject(
      { fx: { reverbMix: 0.2, delayMix: 0.1 } },
      { fx: { reverbMix: 0.5, delayMix: 0.1 } },
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe("fx.reverbMix");
    expect(diffs[0].before).toBe(0.2);
    expect(diffs[0].after).toBe(0.5);
  });

  it("Float-Epsilon: 0.5000001 vs 0.5 erzeugt KEINEN Diff", () => {
    const diffs = diffObject(
      { fx: { reverbMix: 0.5 } },
      { fx: { reverbMix: 0.5000001 } },
    );
    expect(diffs).toEqual([]);
  });

  it("undefined-Felder werden gleich behandelt", () => {
    const diffs = diffObject({ x: undefined }, { x: undefined });
    expect(diffs).toEqual([]);
  });

  it("explizites null vs Wert ergibt einen Diff", () => {
    const diffs = diffObject({ x: null }, { x: 5 });
    expect(diffs).toHaveLength(1);
  });
});

// ─── diffArrays ───────────────────────────────────────────────────────────────

describe("diffArrays", () => {
  it("identische Arrays → leer", () => {
    const a = [{ id: "1", name: "a" }];
    const b = [{ id: "1", name: "a" }];
    const r = diffArrays(a, b);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.changed).toEqual([]);
  });

  it("Hinzugefügtes Item landet in added", () => {
    const r = diffArrays(
      [{ id: "1", name: "a" }],
      [{ id: "1", name: "a" }, { id: "2", name: "b" }],
    );
    expect(r.added).toHaveLength(1);
    expect(r.added[0].id).toBe("2");
  });

  it("Entferntes Item landet in removed", () => {
    const r = diffArrays(
      [{ id: "1", name: "a" }, { id: "2", name: "b" }],
      [{ id: "1", name: "a" }],
    );
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0].id).toBe("2");
  });

  it("Geändertes Item landet in changed mit fieldDiffs", () => {
    const r = diffArrays(
      [{ id: "1", name: "a", volume: 0.5 }],
      [{ id: "1", name: "a", volume: 0.8 }],
    );
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0].fieldDiffs).toHaveLength(1);
    expect(r.changed[0].fieldDiffs[0].path).toBe("volume");
  });

  it("ignoreKeys werden in Changed-Pfad nicht durchgereicht", () => {
    const r = diffArrays(
      [{ id: "1", name: "a", peakLevel: 0.1 }],
      [{ id: "1", name: "a", peakLevel: 0.9 }],
      "id",
      new Set(["peakLevel"]),
    );
    expect(r.changed).toEqual([]);
  });
});

// ─── diffProjects ─────────────────────────────────────────────────────────────

describe("diffProjects", () => {
  it("identische Projekte: leeres Diff (außer savedAt-bewusst ignoriert)", () => {
    const a = makeProject();
    const b = makeProject({ savedAt: "2026-05-19T12:00:00.000Z" });
    const diff = diffProjects(a, b);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("BPM-Änderung landet in metadata.fieldDiffs", () => {
    const a = makeProject({ bpm: 120 });
    const b = makeProject({ bpm: 128 });
    const diff = diffProjects(a, b);
    const bpm = diff.metadata.fieldDiffs.find((d) => d.path === "bpm");
    expect(bpm).toBeDefined();
    expect(bpm!.before).toBe(120);
    expect(bpm!.after).toBe(128);
  });

  it("Project-Name-Änderung landet in metadata", () => {
    const a = makeProject({ projectName: "Alt" });
    const b = makeProject({ projectName: "Neu" });
    const diff = diffProjects(a, b);
    const name = diff.metadata.fieldDiffs.find((d) => d.path === "projectName");
    expect(name).toBeDefined();
    expect(name!.before).toBe("Alt");
    expect(name!.after).toBe("Neu");
  });

  it("Hinzugefügtes Pattern: in patterns.added", () => {
    const a = makeProject({ patterns: [makePattern("p1")] });
    const b = makeProject({ patterns: [makePattern("p1"), makePattern("p2")] });
    const diff = diffProjects(a, b);
    expect(diff.patterns.added).toHaveLength(1);
    expect(diff.patterns.added[0].id).toBe("p2");
  });

  it("Entferntes Pattern: in patterns.removed", () => {
    const a = makeProject({ patterns: [makePattern("p1"), makePattern("p2")] });
    const b = makeProject({ patterns: [makePattern("p1")] });
    const diff = diffProjects(a, b);
    expect(diff.patterns.removed).toHaveLength(1);
    expect(diff.patterns.removed[0].id).toBe("p2");
  });

  it("Geändertes Pattern (stepCount): in patterns.changed", () => {
    const a = makeProject({ patterns: [makePattern("p1", { stepCount: 16 })] });
    const b = makeProject({ patterns: [makePattern("p1", { stepCount: 32 })] });
    const diff = diffProjects(a, b);
    expect(diff.patterns.changed).toHaveLength(1);
    expect(diff.patterns.changed[0].id).toBe("p1");
    expect(diff.patterns.changed[0].fieldDiffs.some((d) => d.path === "stepCount")).toBe(true);
  });

  it("Float-Epsilon: BPM 120 vs 120.00001 → kein Diff", () => {
    const a = makeProject({ bpm: 120 });
    const b = makeProject({ bpm: 120.00001 });
    const diff = diffProjects(a, b);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("Macro-Änderungen landen in macros.fieldDiffs", () => {
    const macroA = { id: "m1", name: "Drop", keybind: null, actions: [] };
    const macroB = { id: "m1", name: "Build", keybind: null, actions: [] };
    const a = makeProject({ macros: [macroA] as never });
    const b = makeProject({ macros: [macroB] as never });
    const diff = diffProjects(a, b);
    expect(diff.macros.fieldDiffs.length).toBeGreaterThan(0);
  });

  it("FX-Param-Änderung am Channel landet in channels.changed", () => {
    const a = makeProject({
      patterns: [makePattern("p1", { parts: [makePart("ch1", { fx: { reverbMix: 0.2 } })] })],
    });
    const b = makeProject({
      patterns: [makePattern("p1", { parts: [makePart("ch1", { fx: { reverbMix: 0.7 } })] })],
    });
    const diff = diffProjects(a, b);
    expect(diff.channels.changed).toHaveLength(1);
    expect(diff.channels.changed[0].id).toBe("ch1");
    const fxDiff = diff.channels.changed[0].fieldDiffs.find((d) => d.path === "fx.reverbMix");
    expect(fxDiff).toBeDefined();
    expect(fxDiff!.before).toBe(0.2);
    expect(fxDiff!.after).toBe(0.7);
  });

  it("Nested deep diff: mixer.masterVolume", () => {
    const a = makeProject();
    const b = makeProject({
      mixer: { ...makeProject().mixer, masterVolume: 0.4 },
    });
    const diff = diffProjects(a, b);
    const mv = diff.mixer.fieldDiffs.find((d) => d.path === "masterVolume");
    expect(mv).toBeDefined();
    expect(mv!.before).toBe(0.8);
    expect(mv!.after).toBe(0.4);
  });

  it("Sample hinzugefügt → samples.added", () => {
    const sampleB = { id: "s1", name: "kick.wav", path: "/x.wav", category: "imported" };
    const a = makeProject({ samples: [] });
    const b = makeProject({ samples: [sampleB] });
    const diff = diffProjects(a, b);
    expect(diff.samples.added).toHaveLength(1);
    expect(diff.samples.added[0].name).toBe("kick.wav");
  });

  it("Sample entfernt → samples.removed", () => {
    const sampleA = { id: "s1", name: "kick.wav", path: "/x.wav", category: "imported" };
    const a = makeProject({ samples: [sampleA] });
    const b = makeProject({ samples: [] });
    const diff = diffProjects(a, b);
    expect(diff.samples.removed).toHaveLength(1);
  });
});

// ─── formatDiffSummary ────────────────────────────────────────────────────────

describe("formatDiffSummary", () => {
  it("leerer Diff → 'Keine Unterschiede'", () => {
    const a = makeProject();
    const b = makeProject();
    expect(formatDiffSummary(diffProjects(a, b))).toBe("Keine Unterschiede");
  });

  it("BPM-Diff erscheint in Summary", () => {
    const a = makeProject({ bpm: 120 });
    const b = makeProject({ bpm: 128 });
    const s = formatDiffSummary(diffProjects(a, b));
    expect(s).toContain("BPM");
    expect(s).toContain("120");
    expect(s).toContain("128");
  });

  it("Counts: +2 Patterns, -1 Channel", () => {
    const a = makeProject({
      patterns: [makePattern("p1", { parts: [makePart("c1"), makePart("c2")] })],
    });
    const b = makeProject({
      patterns: [
        makePattern("p1", { parts: [makePart("c1")] }),
        makePattern("p2"),
        makePattern("p3"),
      ],
    });
    const s = formatDiffSummary(diffProjects(a, b));
    expect(s).toContain("+2 Patterns");
    expect(s).toContain("-1 Channels");
  });
});

// ─── formatDiffMarkdown ───────────────────────────────────────────────────────

describe("formatDiffMarkdown", () => {
  it("liefert Markdown-String mit Heading", () => {
    const a = makeProject({ bpm: 120 });
    const b = makeProject({ bpm: 128 });
    const md = formatDiffMarkdown(diffProjects(a, b));
    expect(md).toContain("# Project Diff");
    expect(md).toContain("**Summary:**");
  });

  it("listet hinzugefügte Patterns explizit", () => {
    const a = makeProject({ patterns: [] });
    const b = makeProject({ patterns: [makePattern("p1", { name: "Intro" })] });
    const md = formatDiffMarkdown(diffProjects(a, b));
    expect(md).toContain("Added");
    expect(md).toContain("Intro");
  });
});

// ─── formatValue ──────────────────────────────────────────────────────────────

describe("formatValue", () => {
  it("null → 'null'", () => {
    expect(formatValue(null)).toBe("null");
  });
  it("undefined → '—'", () => {
    expect(formatValue(undefined)).toBe("—");
  });
  it("Integer ohne Dezimal-Suffix", () => {
    expect(formatValue(42)).toBe("42");
  });
  it("Float wird gekürzt", () => {
    expect(formatValue(0.123456)).toMatch(/^0\.\d+/);
  });
  it("Bool als 'true'/'false'", () => {
    expect(formatValue(true)).toBe("true");
    expect(formatValue(false)).toBe("false");
  });
  it("Array zeigt Länge", () => {
    expect(formatValue([1, 2, 3])).toBe("Array(3)");
  });
  it("Object als JSON-Substring", () => {
    expect(formatValue({ a: 1 })).toContain("a");
  });
});

// ─── isEmptyDiff ──────────────────────────────────────────────────────────────

describe("isEmptyDiff", () => {
  it("ist true für gleiches Projekt", () => {
    const a = makeProject();
    const b = makeProject();
    expect(isEmptyDiff(diffProjects(a, b))).toBe(true);
  });

  it("ist false sobald ein BPM unterschiedlich", () => {
    const a = makeProject({ bpm: 120 });
    const b = makeProject({ bpm: 121 });
    expect(isEmptyDiff(diffProjects(a, b))).toBe(false);
  });
});

// ─── FieldDiff Type-Smoke ────────────────────────────────────────────────────

describe("FieldDiff shape", () => {
  it("jeder Diff hat path/before/after", () => {
    const diffs: FieldDiff[] = diffObject({ a: 1 }, { a: 2 });
    expect(diffs[0]).toHaveProperty("path");
    expect(diffs[0]).toHaveProperty("before");
    expect(diffs[0]).toHaveProperty("after");
  });
});
