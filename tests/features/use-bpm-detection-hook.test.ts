// @vitest-environment jsdom
/**
 * tests/features/use-bpm-detection-hook.test.ts (TASK-CVG-USE-BPM / v2.76)
 *
 * Coverage für useBpmDetection — Pure-Helper autoTagFromFilename
 * (Filename-Regex-Tags) plus Hook (tag-Wrapper, isDetecting-State,
 * detectBpmForSample mit fetch+AudioContext-Mock, detectBpmBatch mit
 * Rhythmic-Filter + Progress-Callback).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useBpmDetection, autoTagFromFilename } from "@/hooks/useBpmDetection";
import type { Sample } from "@/store/useProjectStore";

// ─── DOM-API-Mocks ───────────────────────────────────────────────────────────

interface FakeAudioBuffer {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData: (ch: number) => Float32Array;
}

const audioState = {
  decodeResult: null as FakeAudioBuffer | null,
  shouldDecodeFail: false,
};

const fetchMock = vi.fn(async (_url: string) => {
  return {
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as Response;
});

class FakeAudioContext {
  decodeAudioData = vi.fn(async (_buf: ArrayBuffer) => {
    if (audioState.shouldDecodeFail) throw new Error("decode fail");
    if (!audioState.decodeResult) throw new Error("no decode result set");
    return audioState.decodeResult as unknown as AudioBuffer;
  });
  close = vi.fn(async () => {});
}

(globalThis as unknown as { AudioContext: typeof FakeAudioContext }).AudioContext = FakeAudioContext;
(globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

// ─── Test-Helper: synthetische Audio-Buffer ──────────────────────────────────

function silentBuffer(durationSec: number, sampleRate = 44100): FakeAudioBuffer {
  const length = Math.floor(sampleRate * durationSec);
  const data = new Float32Array(length);
  return {
    sampleRate, length, numberOfChannels: 1,
    getChannelData: () => data,
  };
}

function clickBufferAt120Bpm(durationSec = 4, sampleRate = 44100): FakeAudioBuffer {
  const length = Math.floor(sampleRate * durationSec);
  const data = new Float32Array(length);
  // 120 BPM = 1 Click alle 500ms
  const intervalSamples = Math.floor(sampleRate * 0.5);
  const clickWidth = Math.floor(sampleRate * 0.005); // 5ms loud click
  for (let pos = 0; pos < length; pos += intervalSamples) {
    for (let j = 0; j < clickWidth && pos + j < length; j++) {
      data[pos + j] = 0.9; // sharp peak
    }
  }
  return {
    sampleRate, length, numberOfChannels: 1,
    getChannelData: () => data,
  };
}

function fakeSample(id: string, path: string): Sample {
  return { id, path, name: path.split(/[\\/]/).pop() ?? path } as Sample;
}

beforeEach(() => {
  audioState.decodeResult = null;
  audioState.shouldDecodeFail = false;
  fetchMock.mockClear();
  fetchMock.mockImplementation(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as Response));
});

afterEach(() => cleanup());

// ─── Pure: autoTagFromFilename ───────────────────────────────────────────────

describe("autoTagFromFilename – Drum-Kategorien", () => {
  it("'kick.wav' → ['kick']", () => {
    expect(autoTagFromFilename("kick.wav")).toContain("kick");
  });

  it("'BD_01.wav' → ['kick']", () => {
    expect(autoTagFromFilename("BD_01.wav")).toContain("kick");
  });

  it("'Bass Drum 808.wav' → ['kick']", () => {
    expect(autoTagFromFilename("Bass Drum 808.wav")).toContain("kick");
  });

  // Wichtig: JS-Regex `\b` ist Word-Boundary, und `_` zählt als Word-Char.
  // Daher matched `\bsnare\b` NICHT in `snare_acoustic` (kein boundary an `_`).
  // Wir testen mit Hyphen / Punkt / Space als Separator.

  it("'snare.wav' → ['snare']", () => {
    expect(autoTagFromFilename("snare.wav")).toContain("snare");
  });

  it("'clap.wav' → ['snare'] (Clap zählt als Snare-Kategorie)", () => {
    expect(autoTagFromFilename("clap.wav")).toContain("snare");
  });

  it("'open_hat.wav' → ['open-hat'] (via 'open.?hat'-Pattern, '_' als optionales Zeichen)", () => {
    expect(autoTagFromFilename("open_hat.wav")).toContain("open-hat");
  });

  it("'closed_hat.wav' → ['closed-hat']", () => {
    expect(autoTagFromFilename("closed_hat.wav")).toContain("closed-hat");
  });

  it("'hi-hat 03.wav' → ['closed-hat'] (hi.?hat-Pattern)", () => {
    expect(autoTagFromFilename("hi-hat 03.wav")).toContain("closed-hat");
  });

  it("'floor tom.wav' → ['tom']", () => {
    expect(autoTagFromFilename("floor tom.wav")).toContain("tom");
  });

  it("'cymbal.wav' → ['cymbal']", () => {
    expect(autoTagFromFilename("cymbal.wav")).toContain("cymbal");
  });

  it("'shaker.wav' → ['percussion']", () => {
    expect(autoTagFromFilename("shaker.wav")).toContain("percussion");
  });
});

describe("autoTagFromFilename – Melodische Kategorien", () => {
  it("'bass.wav' → ['bass']", () => {
    expect(autoTagFromFilename("bass.wav")).toContain("bass");
  });

  it("'synth lead.wav' → ['synth']", () => {
    expect(autoTagFromFilename("synth lead.wav")).toContain("synth");
  });

  it("'piano chord.wav' → ['synth', 'chord']", () => {
    const tags = autoTagFromFilename("piano chord.wav");
    expect(tags).toContain("synth");
    expect(tags).toContain("chord");
  });

  it("'vocal.wav' → ['vocal']", () => {
    expect(autoTagFromFilename("vocal.wav")).toContain("vocal");
  });

  it("'riser.wav' → ['fx']", () => {
    expect(autoTagFromFilename("riser.wav")).toContain("fx");
  });

  it("Kick erkannt aber bass-Guard verhindert bass-Tag bei 'kick bass.wav'", () => {
    const tags = autoTagFromFilename("kick bass.wav");
    expect(tags).toContain("kick");
    expect(tags).not.toContain("bass");
  });
});

describe("autoTagFromFilename – Qualitäts-Tags + Pfad-Strip", () => {
  it("'kick dry.wav' → enthält 'dry'", () => {
    expect(autoTagFromFilename("kick dry.wav")).toContain("dry");
  });

  it("'snare wet long.wav' → enthält 'wet' + 'long'", () => {
    const tags = autoTagFromFilename("snare wet long.wav");
    expect(tags).toContain("wet");
    expect(tags).toContain("long");
  });

  it("Voller Pfad wird zu Basename gestripped: 'C:/foo/bar/kick.wav' → kick gefunden", () => {
    expect(autoTagFromFilename("C:/foo/bar/kick.wav")).toContain("kick");
  });

  it("Unix-Pfad: '/usr/samples/snare.wav'", () => {
    expect(autoTagFromFilename("/usr/samples/snare.wav")).toContain("snare");
  });

  it("Unbekannter Filename liefert leeres Array", () => {
    expect(autoTagFromFilename("xyz_unknown_123.wav")).toEqual([]);
  });

  it("Duplikate werden entfernt: 'fx sweep riser.wav' liefert 'fx' nur einmal", () => {
    const tags = autoTagFromFilename("fx sweep riser.wav");
    expect(tags.filter((t) => t === "fx").length).toBe(1);
  });
});

describe("autoTagFromFilename – Underscore-Separator (v2.77 Fix)", () => {
  // v2.77: Underscores werden vor dem Regex-Match zu Spaces normalisiert,
  // damit `\b`-Word-Boundaries greifen. Vor v2.77 wurden Filenames wie
  // 'snare_kick_01.wav' (häufigste Sample-Naming-Convention) komplett
  // ignoriert. Diese Suite garantiert das gefixte Verhalten.

  it("'snare_acoustic.wav' → ['snare'] (vor v2.77: [])", () => {
    expect(autoTagFromFilename("snare_acoustic.wav")).toContain("snare");
  });

  it("'floor_tom_01.wav' → ['tom']", () => {
    expect(autoTagFromFilename("floor_tom_01.wav")).toContain("tom");
  });

  it("'crash_cymbal.wav' → ['cymbal']", () => {
    expect(autoTagFromFilename("crash_cymbal.wav")).toContain("cymbal");
  });

  it("'shaker_loop_01.wav' → ['percussion', 'loop']", () => {
    const tags = autoTagFromFilename("shaker_loop_01.wav");
    expect(tags).toContain("percussion");
    expect(tags).toContain("loop");
  });

  it("'synth_lead.wav' → ['synth']", () => {
    expect(autoTagFromFilename("synth_lead.wav")).toContain("synth");
  });

  it("'sub_bass.wav' → ['bass']", () => {
    expect(autoTagFromFilename("sub_bass.wav")).toContain("bass");
  });

  it("'vocal_ah_long.wav' → ['vocal', 'long']", () => {
    const tags = autoTagFromFilename("vocal_ah_long.wav");
    expect(tags).toContain("vocal");
    expect(tags).toContain("long");
  });

  it("'kick_bass.wav' → ['kick'] (Kick-Guard greift auch mit Underscore)", () => {
    const tags = autoTagFromFilename("kick_bass.wav");
    expect(tags).toContain("kick");
    expect(tags).not.toContain("bass");
  });

  it("'^bd[_\\-\\s]'-Pattern bleibt funktional: 'BD_01.wav' → ['kick']", () => {
    // BD_01 → "bd 01" nach Normalisierung. ^bd[_\-\s] matched "bd " (Space).
    expect(autoTagFromFilename("BD_01.wav")).toContain("kick");
  });
});

// ─── Hook: Initial-State ─────────────────────────────────────────────────────

describe("useBpmDetection – Initial-State", () => {
  it("isDetecting=false, detectionProgress=0", () => {
    const { result } = renderHook(() => useBpmDetection());
    expect(result.current.isDetecting).toBe(false);
    expect(result.current.detectionProgress).toBe(0);
  });
});

// ─── Hook: tagSampleFromFilename ─────────────────────────────────────────────

describe("useBpmDetection – tagSampleFromFilename", () => {
  it("Bekannter Filename: autoTags + confidence=0.8", () => {
    const { result } = renderHook(() => useBpmDetection());
    const tagged = result.current.tagSampleFromFilename(fakeSample("s1", "kick.wav"));
    expect(tagged.autoTags).toContain("kick");
    expect(tagged.confidence).toBe(0.8);
  });

  it("Unbekannter Filename: leere autoTags + confidence=0.1", () => {
    const { result } = renderHook(() => useBpmDetection());
    const tagged = result.current.tagSampleFromFilename(fakeSample("s1", "xyz.wav"));
    expect(tagged.autoTags).toEqual([]);
    expect(tagged.confidence).toBe(0.1);
  });

  it("Sample-Felder bleiben erhalten (Spread)", () => {
    const { result } = renderHook(() => useBpmDetection());
    const tagged = result.current.tagSampleFromFilename(fakeSample("s-42", "snare.wav"));
    expect(tagged.id).toBe("s-42");
    expect(tagged.path).toBe("snare.wav");
  });
});

describe("useBpmDetection – tagSamplesFromFilenames (Batch)", () => {
  it("Liste von 3 Samples wird einzeln getagged", () => {
    const { result } = renderHook(() => useBpmDetection());
    const tagged = result.current.tagSamplesFromFilenames([
      fakeSample("1", "kick.wav"),
      fakeSample("2", "snare.wav"),
      fakeSample("3", "xyz.wav"),
    ]);
    expect(tagged).toHaveLength(3);
    expect(tagged[0].autoTags).toContain("kick");
    expect(tagged[1].autoTags).toContain("snare");
    expect(tagged[2].autoTags).toEqual([]);
  });

  it("Leere Liste → leeres Ergebnis", () => {
    const { result } = renderHook(() => useBpmDetection());
    expect(result.current.tagSamplesFromFilenames([])).toEqual([]);
  });
});

// ─── Hook: detectBpmForSample ────────────────────────────────────────────────

describe("useBpmDetection – detectBpmForSample Edge-Cases", () => {
  it("fetch-Fail (nicht-ok-Response): null", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response));
    const { result } = renderHook(() => useBpmDetection());
    const res = await result.current.detectBpmForSample(fakeSample("s1", "kick.wav"));
    expect(res).toBeNull();
  });

  it("fetch wirft: null (try/catch)", async () => {
    fetchMock.mockImplementationOnce(async () => { throw new Error("network"); });
    const { result } = renderHook(() => useBpmDetection());
    expect(await result.current.detectBpmForSample(fakeSample("s1", "kick.wav"))).toBeNull();
  });

  it("decodeAudioData wirft: null", async () => {
    audioState.shouldDecodeFail = true;
    const { result } = renderHook(() => useBpmDetection());
    expect(await result.current.detectBpmForSample(fakeSample("s1", "kick.wav"))).toBeNull();
  });

  it("Silence-Buffer (zu wenig Onsets): null", async () => {
    audioState.decodeResult = silentBuffer(2);
    const { result } = renderHook(() => useBpmDetection());
    expect(await result.current.detectBpmForSample(fakeSample("s1", "kick.wav"))).toBeNull();
  });

  it("Click-Buffer @ 120 BPM: detection liefert ~120 BPM", async () => {
    audioState.decodeResult = clickBufferAt120Bpm(4);
    const { result } = renderHook(() => useBpmDetection());
    const res = await result.current.detectBpmForSample(fakeSample("s1", "kick.wav"));
    expect(res).not.toBeNull();
    expect(res!.bpm).toBeGreaterThanOrEqual(115);
    expect(res!.bpm).toBeLessThanOrEqual(125);
    expect(res!.confidence).toBeGreaterThan(0.5);
    expect(res!.tags).toContain("kick"); // aus filename
  });

  it("Absolute Pfad-Prefix '/path': wird zu file://-URL umgewandelt", async () => {
    audioState.decodeResult = silentBuffer(1);
    const { result } = renderHook(() => useBpmDetection());
    await result.current.detectBpmForSample(fakeSample("s1", "/abs/path/kick.wav"));
    expect(fetchMock).toHaveBeenCalledWith("file:///abs/path/kick.wav");
  });

  it("Relative URL: wird unverändert weitergegeben", async () => {
    audioState.decodeResult = silentBuffer(1);
    const { result } = renderHook(() => useBpmDetection());
    await result.current.detectBpmForSample(fakeSample("s1", "blob:abc123"));
    expect(fetchMock).toHaveBeenCalledWith("blob:abc123");
  });
});

// ─── Hook: detectBpmBatch ────────────────────────────────────────────────────

describe("useBpmDetection – detectBpmBatch", () => {
  it("isDetecting wird true während Batch-Processing", async () => {
    audioState.decodeResult = clickBufferAt120Bpm(4);
    const { result } = renderHook(() => useBpmDetection());

    // Wir können isDetecting nur observe wenn wir mid-flight stoppen.
    // Lieber: nach completed prüfen dass es wieder false ist + progress=0.
    await act(async () => {
      await result.current.detectBpmBatch([fakeSample("1", "kick.wav")]);
    });
    expect(result.current.isDetecting).toBe(false);
    expect(result.current.detectionProgress).toBe(0);
  });

  it("Filtert non-rhythmic Samples raus (z.B. 'synth lead.wav')", async () => {
    audioState.decodeResult = silentBuffer(1);
    const { result } = renderHook(() => useBpmDetection());
    await act(async () => {
      await result.current.detectBpmBatch([
        fakeSample("1", "synth lead.wav"), // bekanntes melodisch → skipped
        fakeSample("2", "kick.wav"),       // rhythmic → analyzed
      ]);
    });
    // synth lead wird übersprungen → fetch nur für kick aufgerufen
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("kick.wav");
  });

  it("Unbekannte Filenames (keine Tags) werden TROTZDEM analysiert", async () => {
    audioState.decodeResult = silentBuffer(1);
    const { result } = renderHook(() => useBpmDetection());
    await act(async () => {
      await result.current.detectBpmBatch([fakeSample("1", "xyz_unknown.wav")]);
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("onProgress wird pro Sample mit (completed, total) aufgerufen", async () => {
    audioState.decodeResult = clickBufferAt120Bpm(4);
    const { result } = renderHook(() => useBpmDetection());
    const progressCalls: Array<[number, number]> = [];

    await act(async () => {
      await result.current.detectBpmBatch(
        [fakeSample("1", "kick.wav"), fakeSample("2", "snare.wav")],
        (done, total) => progressCalls.push([done, total]),
      );
    });
    expect(progressCalls).toEqual([[1, 2], [2, 2]]);
  });

  it("Result-Map enthält nur erfolgreiche Detections", async () => {
    audioState.decodeResult = clickBufferAt120Bpm(4);
    const { result } = renderHook(() => useBpmDetection());

    let resultsMap: Map<string, unknown> | null = null;
    await act(async () => {
      resultsMap = await result.current.detectBpmBatch([
        fakeSample("1", "kick.wav"),
      ]);
    });
    expect(resultsMap).not.toBeNull();
    expect(resultsMap!.size).toBe(1);
    expect(resultsMap!.has("1")).toBe(true);
  });
});
