import { describe, it, expect } from "vitest";
import {
  loopSamplerStemName,
  buildLoopSamplerTrackData,
  LOOP_SAMPLER_MODES,
} from "../../client/src/utils/loopSampler";

describe("loopSamplerStemName", () => {
  it("strips the extension and uses the stem", () => {
    expect(loopSamplerStemName("vocals_chorus.wav")).toBe("vocals_chorus");
    expect(loopSamplerStemName("melody.loop.mp3")).toBe("melody.loop");
  });

  it("caps overly long names at 40 chars", () => {
    const long = "a".repeat(60) + ".wav";
    expect(loopSamplerStemName(long)).toHaveLength(40);
  });

  it("falls back to a default when the stem is empty", () => {
    expect(loopSamplerStemName(".wav")).toBe("Loop-Sampler");
    expect(loopSamplerStemName("")).toBe("Loop-Sampler");
  });
});

describe("buildLoopSamplerTrackData", () => {
  const common = {
    name: "Melody",
    filePath: "melody.wav",
    fileName: "melody.wav",
    fileSize: 1234,
  };

  it("loop mode → looping flags on (pattern-independent melody loop)", () => {
    const t = buildLoopSamplerTrackData({ ...common, mode: "loop" });
    expect(t.loop).toBe(true);
    expect(t.loopEnabled).toBe(true);
    // Sinnvolle Defaults wie beim Mixer-Ingest.
    expect(t.volume).toBe(1);
    expect(t.pan).toBe(0);
    expect(t.muted).toBe(false);
    expect(t.soloed).toBe(false);
    expect(t.syncMode).toBe("free");
    expect(t.sends).toEqual({ reverb: 0, delay: 0 });
  });

  it("oneshot mode → looping flags off (vocal plays through once)", () => {
    const t = buildLoopSamplerTrackData({ ...common, mode: "oneshot" });
    expect(t.loop).toBe(false);
    expect(t.loopEnabled).toBe(false);
  });

  it("carries name + file metadata through", () => {
    const t = buildLoopSamplerTrackData({
      name: "Chorus",
      filePath: "chorus.wav",
      fileName: "chorus.wav",
      fileSize: 999,
      mode: "oneshot",
    });
    expect(t.name).toBe("Chorus");
    expect(t.fileName).toBe("chorus.wav");
    expect(t.fileSize).toBe(999);
  });

  it("does not contain an id (added by the store on insert)", () => {
    const t = buildLoopSamplerTrackData({ ...common, mode: "loop" });
    expect("id" in t).toBe(false);
  });

  it("exposes exactly the two supported modes", () => {
    expect(LOOP_SAMPLER_MODES).toEqual(["loop", "oneshot"]);
  });
});
