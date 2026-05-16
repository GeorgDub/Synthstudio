/**
 * tests/features/patch-serialize.test.ts (TASK-CVG-PATCHSER / v2.62)
 *
 * Pure-Coverage für client/src/utils/patchSerialize.ts.
 *
 * Hot-Swap-Patch Format (v2.16). Garantien dieser Suite:
 *   - extractPatch + applyPatch sind Immutable-Pattern (kein Mutation)
 *   - Round-Trip patchToJson + patchFromJson rekonstruiert Felder exakt
 *   - patchFromJson liefert null bei jedem schemafremden Input (Defensive
 *     gegen User-Imports + Project-File-Drift)
 */
import { describe, it, expect } from "vitest";
import {
  extractPatch,
  applyPatch,
  patchToJson,
  patchFromJson,
  type Patch,
} from "@/utils/patchSerialize";
import type { PartData } from "@/audio/AudioEngine";
import type { SynthParams } from "@/audio/SynthEngine";

// ─── Test-Fixtures ───────────────────────────────────────────────────────────

const DUMMY_FX: PartData["fx"] = {
  filterEnabled: false, filterType: "lowpass", filterFreq: 8000, filterQ: 1, filterGain: 0,
  distortionEnabled: false, distortionAmount: 50,
  compressorEnabled: false, compressorThreshold: -24, compressorRatio: 4, compressorAttack: 0.003, compressorRelease: 0.25,
  delayEnabled: false, delayTime: 0.25, delayFeedback: 0.3, delayMix: 0.3,
  reverbEnabled: false, reverbDecay: 2.0, reverbMix: 0.3,
  eqEnabled: false, eqLow: 0, eqMid: 0, eqHigh: 0,
};

const DUMMY_SYNTH: SynthParams = {
  oscMode: "wavetable",
  oscWaveform: "sine",
  oscWaveTableIndex: 0,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.2,
  filterCutoff: 8000,
  filterResonance: 1,
  fmRatio: 1,
  fmAmount: 0,
  lfoRate: 1,
  lfoDepth: 0,
  lfoWaveform: "sine",
} as SynthParams;

function makePart(overrides: Partial<PartData> = {}): PartData {
  return {
    id: "p1",
    name: "Kick",
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    steps: [],
    sampleUrl: "kick.wav",
    sampleName: "Kick.wav",
    synthParams: { ...DUMMY_SYNTH },
    fx: { ...DUMMY_FX },
    ...overrides,
  };
}

// ─── extractPatch ────────────────────────────────────────────────────────────

describe("PatchSerialize – extractPatch", () => {
  it("extrahiert sample + synth + fx + sourceType in ein Patch", () => {
    const part = makePart({ sourceType: "sample" });
    const patch = extractPatch(part, "My Kick");
    expect(patch.name).toBe("My Kick");
    expect(patch.sourceType).toBe("sample");
    expect(patch.sampleUrl).toBe("kick.wav");
    expect(patch.sampleName).toBe("Kick.wav");
    expect(patch.synthParams).toBeDefined();
    expect(patch.fx).toBeDefined();
  });

  it("setzt eine ID + createdAt-Timestamp", () => {
    const patch = extractPatch(makePart(), "x");
    expect(patch.id).toMatch(/^patch_\d+_\d+_/);
    expect(typeof patch.createdAt).toBe("number");
    expect(patch.createdAt).toBeGreaterThan(0);
  });

  it("name='' → Fallback 'Patch <time>'", () => {
    const patch = extractPatch(makePart(), "");
    expect(patch.name).toMatch(/^Patch /);
  });

  it("name='   ' (nur whitespace) → Fallback", () => {
    const patch = extractPatch(makePart(), "   ");
    expect(patch.name).toMatch(/^Patch /);
  });

  it("name wird getrimmt (führender/folgender Whitespace weg)", () => {
    const patch = extractPatch(makePart(), "  My Sound  ");
    expect(patch.name).toBe("My Sound");
  });

  it("Default: includeFx=true → FX wird mitkopiert", () => {
    const patch = extractPatch(makePart(), "x");
    expect(patch.fx).toBeDefined();
  });

  it("includeFx=false → FX nicht in der Patch", () => {
    const patch = extractPatch(makePart(), "x", { includeFx: false });
    expect(patch.fx).toBeUndefined();
  });

  it("Tags werden flach kopiert (kein shared reference)", () => {
    const tags = ["drum", "kick"];
    const patch = extractPatch(makePart(), "x", { tags });
    expect(patch.tags).toEqual(["drum", "kick"]);
    expect(patch.tags).not.toBe(tags); // neue Referenz
  });

  it("synthParams sind eine Kopie, nicht Reference (Immutability)", () => {
    const part = makePart();
    const patch = extractPatch(part, "x");
    expect(patch.synthParams).toEqual(part.synthParams);
    expect(patch.synthParams).not.toBe(part.synthParams);
  });

  it("Part ohne synthParams → patch.synthParams ist undefined", () => {
    const part = makePart({ synthParams: undefined });
    const patch = extractPatch(part, "x");
    expect(patch.synthParams).toBeUndefined();
  });

  it("Part ohne fx → patch.fx ist undefined (auch mit includeFx=true)", () => {
    const part = makePart({ fx: undefined });
    const patch = extractPatch(part, "x");
    expect(patch.fx).toBeUndefined();
  });
});

// ─── applyPatch ──────────────────────────────────────────────────────────────

describe("PatchSerialize – applyPatch", () => {
  it("ersetzt sample/synth/fx Felder aus der Patch", () => {
    const part = makePart({ sampleUrl: "old.wav", sampleName: "Old" });
    const patch: Patch = {
      id: "p1", name: "P", createdAt: 0,
      sampleUrl: "new.wav",
      sampleName: "New",
      synthParams: { ...DUMMY_SYNTH },
      fx: { ...DUMMY_FX },
    };
    const result = applyPatch(part, patch);
    expect(result.sampleUrl).toBe("new.wav");
    expect(result.sampleName).toBe("New");
  });

  it("ist Immutable: Original Part bleibt unverändert", () => {
    const part = makePart({ sampleUrl: "orig.wav" });
    const partBefore = { ...part };
    applyPatch(part, { id: "p", name: "P", createdAt: 0, sampleUrl: "new.wav" });
    expect(part.sampleUrl).toBe(partBefore.sampleUrl); // unverändert
  });

  it("Felder die in Patch undefined sind: Part-Werte bleiben erhalten", () => {
    const part = makePart({ sampleUrl: "keep.wav", sampleName: "Keep" });
    const patch: Patch = { id: "p", name: "P", createdAt: 0 }; // alles optional weg
    const result = applyPatch(part, patch);
    expect(result.sampleUrl).toBe("keep.wav"); // bleibt
    expect(result.sampleName).toBe("Keep");
  });

  it("replaceFx=false → Part.fx bleibt erhalten obwohl Patch.fx vorhanden", () => {
    const oldFx = { ...DUMMY_FX, distortionEnabled: false };
    const newFx = { ...DUMMY_FX, distortionEnabled: true };
    const part = makePart({ fx: oldFx });
    const patch: Patch = { id: "p", name: "P", createdAt: 0, fx: newFx };
    const result = applyPatch(part, patch, { replaceFx: false });
    expect(result.fx?.distortionEnabled).toBe(false); // Part's old FX bleibt
  });

  it("replaceFx=true (default) → Patch.fx überschreibt Part.fx", () => {
    const oldFx = { ...DUMMY_FX, distortionEnabled: false };
    const newFx = { ...DUMMY_FX, distortionEnabled: true };
    const part = makePart({ fx: oldFx });
    const patch: Patch = { id: "p", name: "P", createdAt: 0, fx: newFx };
    const result = applyPatch(part, patch);
    expect(result.fx?.distortionEnabled).toBe(true);
  });

  it("synthParams wird kopiert (kein shared reference zu Patch)", () => {
    const part = makePart();
    const patch: Patch = { id: "p", name: "P", createdAt: 0, synthParams: { ...DUMMY_SYNTH } };
    const result = applyPatch(part, patch);
    expect(result.synthParams).toEqual(patch.synthParams);
    expect(result.synthParams).not.toBe(patch.synthParams);
  });
});

// ─── patchToJson + patchFromJson ─────────────────────────────────────────────

describe("PatchSerialize – Round-Trip JSON", () => {
  it("Roundtrip: patchToJson → patchFromJson erhält id/name/createdAt", () => {
    const original: Patch = {
      id: "p_123",
      name: "My Sound",
      sourceType: "sample",
      sampleUrl: "s.wav",
      createdAt: 1234567890,
    };
    const reconstructed = patchFromJson(patchToJson(original));
    expect(reconstructed).not.toBeNull();
    expect(reconstructed!.id).toBe("p_123");
    expect(reconstructed!.name).toBe("My Sound");
    expect(reconstructed!.createdAt).toBe(1234567890);
  });

  it("Tags-Array wird im Round-Trip erhalten", () => {
    const original: Patch = {
      id: "p", name: "P", createdAt: 0,
      tags: ["kick", "808"],
    };
    const r = patchFromJson(patchToJson(original));
    expect(r!.tags).toEqual(["kick", "808"]);
  });

  it("Tags-Array filtert non-string Einträge defensiv", () => {
    // Manuell konstruierter JSON mit invaliden Tags
    const dirtyJson = JSON.stringify({
      id: "p", name: "P", createdAt: 0,
      tags: ["good", 42, null, "also-good"],
    });
    const r = patchFromJson(dirtyJson);
    expect(r!.tags).toEqual(["good", "also-good"]);
  });
});

describe("PatchSerialize – patchFromJson Defensive (Persistenz-Boundary)", () => {
  it("Invalid JSON → null", () => {
    expect(patchFromJson("not-json{")).toBeNull();
  });

  it("Leerer String → null", () => {
    expect(patchFromJson("")).toBeNull();
  });

  it("JSON-null → null", () => {
    expect(patchFromJson("null")).toBeNull();
  });

  it("Missing id → null", () => {
    expect(patchFromJson(JSON.stringify({ name: "P", createdAt: 0 }))).toBeNull();
  });

  it("Missing name → null", () => {
    expect(patchFromJson(JSON.stringify({ id: "p", createdAt: 0 }))).toBeNull();
  });

  it("Missing createdAt → null", () => {
    expect(patchFromJson(JSON.stringify({ id: "p", name: "P" }))).toBeNull();
  });

  it("Non-string id → null", () => {
    expect(patchFromJson(JSON.stringify({ id: 42, name: "P", createdAt: 0 }))).toBeNull();
  });

  it("Non-number createdAt (String-Timestamp) → null", () => {
    expect(patchFromJson(JSON.stringify({ id: "p", name: "P", createdAt: "1234" }))).toBeNull();
  });

  it("non-string sampleUrl wird zu undefined (Defensive)", () => {
    const r = patchFromJson(JSON.stringify({ id: "p", name: "P", createdAt: 0, sampleUrl: 42 }));
    expect(r).not.toBeNull();
    expect(r!.sampleUrl).toBeUndefined();
  });

  it("non-array tags wird zu undefined", () => {
    const r = patchFromJson(JSON.stringify({ id: "p", name: "P", createdAt: 0, tags: "not-an-array" }));
    expect(r).not.toBeNull();
    expect(r!.tags).toBeUndefined();
  });
});

// ─── extractPatch + applyPatch Round-Trip ────────────────────────────────────

describe("PatchSerialize – extract → apply Round-Trip", () => {
  it("Sample + synth wird identisch zurückübertragen", () => {
    const source = makePart({ sampleUrl: "abc.wav", sampleName: "ABC" });
    const dest = makePart({ sampleUrl: "different.wav", sampleName: "Other" });
    const patch = extractPatch(source, "RoundTrip");
    const result = applyPatch(dest, patch);
    expect(result.sampleUrl).toBe("abc.wav");
    expect(result.sampleName).toBe("ABC");
    expect(result.synthParams).toEqual(source.synthParams);
  });
});
