// @vitest-environment node
/**
 * sample-embedding-flow.test.ts — v3.131.0
 * Tests für Save/Load-Flow (prepareProjectForSave + restoreEmbeddedSamples).
 */

import { describe, it, expect } from "vitest";
import {
  prepareProjectForSave,
  restoreEmbeddedSamples,
  estimateProjectEmbedSizeKb,
  countBlobUrlSamples,
  type EmbedProjectLike,
} from "../../client/src/utils/sampleEmbeddingFlow";
import type { AudioBufferLike } from "../../client/src/utils/sampleEmbedding";

function makeMockBuffer(durationSec = 0.1, sampleRate = 48000, channels = 1): AudioBufferLike {
  const length = Math.floor(durationSec * sampleRate);
  const data = new Float32Array(length);
  // Fill with sine for non-trivial content
  for (let i = 0; i < length; i++) data[i] = Math.sin((i / sampleRate) * 440 * 2 * Math.PI) * 0.5;
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData: () => data,
  };
}

describe("v3.131 estimateProjectEmbedSizeKb", () => {
  it("empty project → 0", () => {
    expect(estimateProjectEmbedSizeKb({ samples: [] })).toBe(0);
  });

  it("no samples field → 0", () => {
    expect(estimateProjectEmbedSizeKb({})).toBe(0);
  });

  it("samples without embeddedData → 0", () => {
    expect(estimateProjectEmbedSizeKb({
      samples: [{ id: "s1", path: "file.wav" }, { id: "s2", path: "blob:..." }],
    })).toBe(0);
  });

  it("single embedded sample: ≈ length × 0.75 / 1024", () => {
    const b64 = "A".repeat(4096);
    const expected = Math.ceil((4096 * 0.75) / 1024);
    expect(estimateProjectEmbedSizeKb({
      samples: [{ id: "s1", embeddedData: b64 }],
    })).toBe(expected);
  });

  it("multiple embedded samples sum correctly", () => {
    const b64a = "A".repeat(1024);
    const b64b = "B".repeat(2048);
    const result = estimateProjectEmbedSizeKb({
      samples: [
        { id: "s1", embeddedData: b64a },
        { id: "s2", embeddedData: b64b },
      ],
    });
    expect(result).toBe(
      Math.ceil((1024 * 0.75) / 1024) + Math.ceil((2048 * 0.75) / 1024),
    );
  });
});

describe("v3.131 countBlobUrlSamples", () => {
  it("counts blob: paths only", () => {
    const project: EmbedProjectLike = {
      samples: [
        { id: "s1", path: "file:///disk.wav" },
        { id: "s2", path: "blob:http://localhost/abc" },
        { id: "s3", path: "blob:null/xyz" },
        { id: "s4" },
      ],
    };
    expect(countBlobUrlSamples(project)).toBe(2);
  });

  it("empty project → 0", () => {
    expect(countBlobUrlSamples({})).toBe(0);
  });
});

describe("v3.131 prepareProjectForSave", () => {
  it("noop wenn embedTransformed=false", async () => {
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", path: "blob:foo" }],
    };
    const result = await prepareProjectForSave(project, {
      embedTransformed: false,
      loadAudioBuffer: async () => makeMockBuffer(),
    });
    expect(result.samples?.[0].embeddedData).toBeUndefined();
  });

  it("noop wenn loadAudioBuffer fehlt", async () => {
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", path: "blob:foo" }],
    };
    const result = await prepareProjectForSave(project, {});
    expect(result.samples?.[0].embeddedData).toBeUndefined();
  });

  it("noop wenn keine Samples", async () => {
    const result = await prepareProjectForSave({}, {
      loadAudioBuffer: async () => makeMockBuffer(),
    });
    expect(result).toEqual({});
  });

  it("embeds Blob-URL-Samples", async () => {
    const project: EmbedProjectLike = {
      samples: [
        { id: "s1", path: "blob:foo" },
        { id: "s2", path: "file:///disk.wav" }, // kein blob → skip
      ],
    };
    const result = await prepareProjectForSave(project, {
      loadAudioBuffer: async () => makeMockBuffer(0.05),
    });
    expect(typeof result.samples?.[0].embeddedData).toBe("string");
    expect(result.samples?.[0].embeddedData!.length).toBeGreaterThan(0);
    // Sample s2 ist nicht-blob → bleibt unverändert
    expect(result.samples?.[1].embeddedData).toBeUndefined();
  });

  it("skipt wenn bereits embeddedData", async () => {
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", path: "blob:foo", embeddedData: "existing-data" }],
    };
    let called = false;
    await prepareProjectForSave(project, {
      loadAudioBuffer: async () => {
        called = true;
        return makeMockBuffer();
      },
    });
    expect(called).toBe(false);
  });

  it("skipt wenn loadAudioBuffer null liefert", async () => {
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", path: "blob:foo" }],
    };
    const result = await prepareProjectForSave(project, {
      loadAudioBuffer: async () => null,
    });
    expect(result.samples?.[0].embeddedData).toBeUndefined();
  });

  it("throws bei Total-Size-Cap-Überschreitung", async () => {
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", path: "blob:foo" }],
    };
    await expect(
      prepareProjectForSave(project, {
        loadAudioBuffer: async () => makeMockBuffer(10, 48000, 2), // ~960 KB
        maxTotalSizeKb: 1, // tiny cap
      }),
    ).rejects.toThrow(/total embed size would exceed cap/);
  });

  it("onProgress wird pro Sample gerufen", async () => {
    const fractions: number[] = [];
    const project: EmbedProjectLike = {
      samples: [
        { id: "s1", path: "blob:1" },
        { id: "s2", path: "blob:2" },
      ],
    };
    await prepareProjectForSave(project, {
      loadAudioBuffer: async () => makeMockBuffer(0.01),
      onProgress: (f) => fractions.push(f),
    });
    expect(fractions).toEqual([0.5, 1.0]);
  });
});

describe("v3.131 restoreEmbeddedSamples", () => {
  it("noop wenn decodeToBlobUrl fehlt", async () => {
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", embeddedData: "fake-b64", path: "" }],
    };
    const result = await restoreEmbeddedSamples(project, {});
    expect(result.samples?.[0].path).toBe("");
  });

  it("noop wenn keine Samples", async () => {
    const result = await restoreEmbeddedSamples({}, {
      decodeToBlobUrl: async () => "blob:test",
    });
    expect(result).toEqual({});
  });

  it("restored Blob-URL für embeddedData", async () => {
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", embeddedData: "fake-b64", path: "" }],
    };
    const result = await restoreEmbeddedSamples(project, {
      decodeToBlobUrl: async () => "blob:restored-url",
    });
    expect(result.samples?.[0].path).toBe("blob:restored-url");
  });

  it("skipt wenn path bereits Blob-URL (kein doppeltes decode)", async () => {
    let called = false;
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", embeddedData: "fake-b64", path: "blob:already" }],
    };
    await restoreEmbeddedSamples(project, {
      decodeToBlobUrl: async () => {
        called = true;
        return "blob:never";
      },
    });
    expect(called).toBe(false);
  });

  it("warning bei corruptem embeddedData, Sample unverändert", async () => {
    const warnings: Array<{ id: string; reason: string }> = [];
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", embeddedData: "corrupt-b64", path: "" }],
    };
    const result = await restoreEmbeddedSamples(project, {
      decodeToBlobUrl: async () => {
        throw new Error("invalid base64");
      },
      onWarning: (id, reason) => warnings.push({ id, reason }),
    });
    expect(warnings).toEqual([{ id: "s1", reason: "invalid base64" }]);
    expect(result.samples?.[0].path).toBe("");
  });

  it("skipt Samples ohne embeddedData", async () => {
    let called = false;
    const project: EmbedProjectLike = {
      samples: [
        { id: "s1", path: "file:///x.wav" },
        { id: "s2", path: "blob:foo" }, // kein embeddedData
      ],
    };
    await restoreEmbeddedSamples(project, {
      decodeToBlobUrl: async () => {
        called = true;
        return "blob:never";
      },
    });
    expect(called).toBe(false);
  });

  it("onProgress wird pro Sample gerufen", async () => {
    const fractions: number[] = [];
    const project: EmbedProjectLike = {
      samples: [
        { id: "s1", embeddedData: "a", path: "" },
        { id: "s2", embeddedData: "b", path: "" },
      ],
    };
    await restoreEmbeddedSamples(project, {
      decodeToBlobUrl: async () => "blob:restored",
      onProgress: (f) => fractions.push(f),
    });
    expect(fractions).toEqual([0.5, 1.0]);
  });
});

describe("v3.138 prepareProjectForSave embedAll", () => {
  it("embedAll=false (default): File-Path-Samples bleiben unverändert", async () => {
    let loadCalled = false;
    const project: EmbedProjectLike = {
      samples: [
        { id: "s1", path: "/disk/kick.wav" }, // kein Blob-URL
        { id: "s2", path: "/disk/snare.wav" },
      ],
    };
    const result = await prepareProjectForSave(project, {
      // embedAll explicitly false
      embedAll: false,
      loadAudioBuffer: async () => {
        loadCalled = true;
        return makeMockBuffer(0.01);
      },
    });
    expect(loadCalled).toBe(false);
    expect(result.samples?.[0].embeddedData).toBeUndefined();
    expect(result.samples?.[1].embeddedData).toBeUndefined();
  });

  it("embedAll=true: File-Path-Samples WERDEN eingebettet", async () => {
    const loadedPaths: string[] = [];
    const project: EmbedProjectLike = {
      samples: [
        { id: "s1", path: "/disk/kick.wav" },
        { id: "s2", path: "blob:transformed-snare" },
      ],
    };
    const result = await prepareProjectForSave(project, {
      embedAll: true,
      loadAudioBuffer: async (path: string) => {
        loadedPaths.push(path);
        return makeMockBuffer(0.01);
      },
    });
    expect(loadedPaths).toContain("/disk/kick.wav");
    expect(loadedPaths).toContain("blob:transformed-snare");
    expect(typeof result.samples?.[0].embeddedData).toBe("string");
    expect(result.samples?.[0].embeddedData!.length).toBeGreaterThan(0);
    expect(typeof result.samples?.[1].embeddedData).toBe("string");
    expect(result.samples?.[1].embeddedData!.length).toBeGreaterThan(0);
  });

  it("embedAll=true skippt Samples mit bereits gesetztem embeddedData (Idempotenz)", async () => {
    let loadCalled = false;
    const project: EmbedProjectLike = {
      samples: [
        { id: "s1", path: "/disk/kick.wav", embeddedData: "existing-b64-data" },
      ],
    };
    const result = await prepareProjectForSave(project, {
      embedAll: true,
      loadAudioBuffer: async () => {
        loadCalled = true;
        return makeMockBuffer(0.01);
      },
    });
    expect(loadCalled).toBe(false);
    expect(result.samples?.[0].embeddedData).toBe("existing-b64-data");
  });

  it("embedAll=true skippt Samples ohne Pfad (kein loadAudioBuffer-Identifier)", async () => {
    let loadCalled = false;
    const project: EmbedProjectLike = {
      samples: [
        { id: "s1" }, // kein path
        { id: "s2", path: "" }, // leerer path
      ],
    };
    const result = await prepareProjectForSave(project, {
      embedAll: true,
      loadAudioBuffer: async () => {
        loadCalled = true;
        return makeMockBuffer(0.01);
      },
    });
    expect(loadCalled).toBe(false);
    expect(result.samples?.[0].embeddedData).toBeUndefined();
    expect(result.samples?.[1].embeddedData).toBeUndefined();
  });

  it("embedAll=true respektiert Total-Size-Cap", async () => {
    const project: EmbedProjectLike = {
      samples: [{ id: "s1", path: "/disk/big.wav" }],
    };
    await expect(
      prepareProjectForSave(project, {
        embedAll: true,
        loadAudioBuffer: async () => makeMockBuffer(10, 48000, 2),
        maxTotalSizeKb: 1,
      }),
    ).rejects.toThrow(/total embed size would exceed cap/);
  });
});

describe("v3.131 Round-Trip prepare → restore", () => {
  it("preserves IDs + andere Felder", async () => {
    const project: EmbedProjectLike = {
      samples: [
        { id: "kick", path: "blob:k1", name: "Kick", tags: ["drum"] },
      ],
    };
    const prepared = await prepareProjectForSave(project, {
      loadAudioBuffer: async () => makeMockBuffer(0.01),
    });
    expect(prepared.samples?.[0].name).toBe("Kick");
    expect(prepared.samples?.[0].tags).toEqual(["drum"]);
    expect(typeof prepared.samples?.[0].embeddedData).toBe("string");

    // Simuliert .synth-File "round-trip" — wir setzen path leer um Restore-Pfad zu triggern.
    const beforeRestore: EmbedProjectLike = {
      ...prepared,
      samples: prepared.samples?.map((s) => ({ ...s, path: "" })) ?? [],
    };
    const restored = await restoreEmbeddedSamples(beforeRestore, {
      decodeToBlobUrl: async () => "blob:fresh",
    });
    expect(restored.samples?.[0].id).toBe("kick");
    expect(restored.samples?.[0].name).toBe("Kick");
    expect(restored.samples?.[0].tags).toEqual(["drum"]);
    expect(restored.samples?.[0].path).toBe("blob:fresh");
  });
});
