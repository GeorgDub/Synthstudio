/**
 * Synthstudio – Patch-Serialisierung + Patch-Store Tests (v2.16)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  extractPatch,
  applyPatch,
  patchToJson,
  patchFromJson,
  type Patch,
} from "../../client/src/utils/patchSerialize";
import {
  savePatch,
  deletePatch,
  renamePatch,
  getPatches,
  getPatchById,
  clearAllPatches,
  exportLibrary,
  importLibrary,
  __resetPatchStoreForTests,
} from "../../client/src/store/usePatchStore";
import type { PartData } from "../../client/src/audio/AudioEngine";
import { DEFAULT_SYNTH_PARAMS } from "../../client/src/audio/SynthEngine";

const FX_DEFAULTS: PartData["fx"] = {
  filterEnabled: false,
  filterType: "lowpass",
  filterFreq: 1000,
  filterQ: 1,
  filterGain: 0,
  distortionEnabled: false,
  distortionAmount: 0,
  compressorEnabled: false,
  compressorThreshold: -20,
  compressorRatio: 4,
  compressorAttack: 0.01,
  compressorRelease: 0.1,
  delayEnabled: false,
  delayTime: 0.25,
  delayFeedback: 0.3,
  delayMix: 0.3,
  reverbEnabled: false,
  reverbDecay: 2,
  reverbMix: 0.3,
  eqEnabled: false,
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
};

function makePart(overrides: Partial<PartData> = {}): PartData {
  return {
    id: "p1",
    name: "Kick",
    sampleUrl: "samples/kick.wav",
    sampleName: "kick.wav",
    muted: false,
    soloed: false,
    volume: 0.8,
    pan: 0,
    steps: Array.from({ length: 16 }, () => ({ active: false })),
    fx: FX_DEFAULTS,
    sourceType: "sample",
    ...overrides,
  };
}

describe("extractPatch (v2.16)", () => {
  it("extrahiert Sample-URL + Name aus einer Sample-Part", () => {
    const part = makePart();
    const patch = extractPatch(part, "My Kick");
    expect(patch.name).toBe("My Kick");
    expect(patch.sampleUrl).toBe("samples/kick.wav");
    expect(patch.sourceType).toBe("sample");
    expect(patch.fx).toBeDefined();
    expect(patch.id).toMatch(/^patch_/);
    expect(patch.createdAt).toBeGreaterThan(0);
  });

  it("includeFx=false lässt FX-Chain weg", () => {
    const part = makePart();
    const patch = extractPatch(part, "Sound only", { includeFx: false });
    expect(patch.fx).toBeUndefined();
  });

  it("synthParams werden geklont (kein shared reference)", () => {
    const part = makePart({
      sourceType: "wavetable",
      synthParams: { ...DEFAULT_SYNTH_PARAMS, glide: 0.5 },
    });
    const patch = extractPatch(part, "Lead");
    expect(patch.synthParams?.glide).toBe(0.5);
    patch.synthParams!.glide = 99;
    expect(part.synthParams!.glide).toBe(0.5); // Original unverändert
  });

  it("default-Name wenn leer", () => {
    const patch = extractPatch(makePart(), "   ");
    expect(patch.name).toMatch(/^Patch /);
  });
});

describe("applyPatch (v2.16)", () => {
  it("Patch ersetzt Sample-Felder", () => {
    const part = makePart();
    const patch: Patch = {
      id: "px",
      name: "New",
      sourceType: "sample",
      sampleUrl: "samples/snare.wav",
      sampleName: "snare.wav",
      createdAt: 1,
    };
    const updated = applyPatch(part, patch);
    expect(updated.sampleUrl).toBe("samples/snare.wav");
    expect(updated.sampleName).toBe("snare.wav");
    expect(updated.id).toBe("p1"); // Part-ID bleibt
  });

  it("undefined-Felder in der Patch überschreiben NICHT", () => {
    const part = makePart({ volume: 0.42 });
    const patch: Patch = { id: "x", name: "Empty", createdAt: 1 };
    const updated = applyPatch(part, patch);
    expect(updated.sampleUrl).toBe("samples/kick.wav");
    expect(updated.volume).toBe(0.42);
  });

  it("replaceFx=false bewahrt die existierende FX-Chain", () => {
    const part = makePart();
    const patch: Patch = {
      id: "x",
      name: "P",
      fx: { ...FX_DEFAULTS, filterEnabled: true, filterFreq: 8000 },
      createdAt: 1,
    };
    const replaced = applyPatch(part, patch, { replaceFx: true });
    expect(replaced.fx?.filterEnabled).toBe(true);

    const kept = applyPatch(part, patch, { replaceFx: false });
    expect(kept.fx?.filterEnabled).toBe(false);
  });
});

describe("patchToJson / patchFromJson", () => {
  it("ist round-trip-stabil", () => {
    const patch = extractPatch(makePart(), "Round-Trip");
    const json = patchToJson(patch);
    const back = patchFromJson(json);
    expect(back).not.toBeNull();
    expect(back?.id).toBe(patch.id);
    expect(back?.sampleUrl).toBe(patch.sampleUrl);
  });

  it("liefert null bei invalidem JSON", () => {
    expect(patchFromJson("nicht-json")).toBeNull();
    expect(patchFromJson("{}")).toBeNull();
    expect(patchFromJson('{"id": 0, "name": "x", "createdAt": 1}')).toBeNull();
  });
});

describe("usePatchStore (v2.16)", () => {
  beforeEach(() => __resetPatchStoreForTests());

  it("savePatch fügt einen neuen Eintrag hinzu", () => {
    const patch = extractPatch(makePart(), "A");
    savePatch(patch);
    expect(getPatches()).toHaveLength(1);
    expect(getPatchById(patch.id)?.name).toBe("A");
  });

  it("savePatch mit gleicher ID updated den existierenden Eintrag", () => {
    const patch = extractPatch(makePart(), "A");
    savePatch(patch);
    savePatch({ ...patch, name: "Renamed" });
    expect(getPatches()).toHaveLength(1);
    expect(getPatchById(patch.id)?.name).toBe("Renamed");
  });

  it("deletePatch entfernt per ID", () => {
    const patch = extractPatch(makePart(), "A");
    savePatch(patch);
    deletePatch(patch.id);
    expect(getPatches()).toHaveLength(0);
  });

  it("renamePatch tauscht den Namen aus, leere Namen werden ignoriert", () => {
    const patch = extractPatch(makePart(), "A");
    savePatch(patch);
    renamePatch(patch.id, "  Neuer Name  ");
    expect(getPatchById(patch.id)?.name).toBe("Neuer Name");
    renamePatch(patch.id, "   ");
    expect(getPatchById(patch.id)?.name).toBe("Neuer Name");
  });

  it("exportLibrary / importLibrary ist round-trip-stabil (replace)", () => {
    const a = extractPatch(makePart({ id: "p1" }), "A");
    const b = extractPatch(makePart({ id: "p2" }), "B");
    savePatch(a); savePatch(b);
    const json = exportLibrary();

    clearAllPatches();
    expect(getPatches()).toHaveLength(0);

    const count = importLibrary(json, "replace");
    expect(count).toBe(2);
    const ids = getPatches().map(p => p.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("importLibrary merge ergänzt fehlende und überschreibt existierende", () => {
    const a = extractPatch(makePart(), "A");
    savePatch(a);
    const b = extractPatch(makePart(), "B");

    const json = JSON.stringify([{ ...a, name: "A renamed" }, b]);
    const count = importLibrary(json, "merge");
    expect(count).toBe(2);
    expect(getPatchById(a.id)?.name).toBe("A renamed");
    expect(getPatches().some(p => p.id === b.id)).toBe(true);
  });

  it("importLibrary lehnt invalides JSON ab", () => {
    expect(importLibrary("nicht-json")).toBe(0);
    expect(importLibrary("{}")).toBe(0);
    expect(getPatches()).toHaveLength(0);
  });

  it("clearAllPatches leert die Library", () => {
    savePatch(extractPatch(makePart(), "X"));
    clearAllPatches();
    expect(getPatches()).toHaveLength(0);
  });
});
