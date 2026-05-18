/**
 * tests/features/audio-track-auto-bpm.test.ts
 *
 * Unit-Tests für v3.53.0 — Auto-BPM-Detection beim Track-Add + Time-Stretch
 * UI-Polish (Effective-Rate, Snap-zu-1.0).
 *
 * Coverage:
 *  - shouldApplyAutoBpm   — Confidence-Threshold + defensive defaults
 *  - applyAutoBpmToTrack  — High-Confidence setzt bpmHint, Low-Confidence NICHT
 *  - computeEffectiveStretchRate — BPM-Sync × stretchRatio kombiniert
 *  - snapStretchRatio     — Snap-zu-1.0 bei [0.95, 1.05]
 *  - analyzeBpmFromBufferDirect — direkte Worker-Mirror-fn auf AudioBuffer
 *
 * 16 Tests in 5 describes (env:node — pure functions + Store ohne DOM).
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ──────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => {
      store[k] = v;
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      store = {};
    },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock },
    writable: true,
    configurable: true,
  });
}

// ─── Imports nach Mock-Setup ────────────────────────────────────────────────

import {
  addAudioTrack,
  getAudioTrack,
  setTrackBpmHint,
  shouldApplyAutoBpm,
  applyAutoBpmToTrack,
  computeEffectiveStretchRate,
  snapStretchRatio,
  STRETCH_SNAP_THRESHOLD,
  AUTO_BPM_CONFIDENCE_THRESHOLD,
  __resetForTests as resetTrackStore,
  type AudioTrackChannelData,
} from "../../client/src/store/useAudioTrackStore";

import { analyzeBpmFromBufferDirect } from "../../client/src/components/Mixer/MixerView";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTrackData(
  overrides: Partial<AudioTrackChannelData> = {},
): Omit<AudioTrackChannelData, "id"> {
  return {
    name: "T",
    filePath: "/t.wav",
    fileName: "t.wav",
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    sends: { reverb: 0, delay: 0 },
    syncMode: "free",
    ...overrides,
  };
}

/**
 * Stellt einen Mini-AudioBuffer-Mock mit deterministischem Beat-Pattern bereit.
 * Schedule N regelmäßige Impulse, ergibt eine klare BPM.
 *
 * 120 BPM = 500 ms / Beat. Bei sampleRate=44100 → 22050 Samples / Beat.
 */
function makeFakeAudioBuffer(opts: {
  sampleRate?: number;
  durationSec?: number;
  beatsPerMin?: number;
  spikeAmplitude?: number;
}): AudioBuffer {
  const sampleRate = opts.sampleRate ?? 44100;
  const durationSec = opts.durationSec ?? 4;
  const beatsPerMin = opts.beatsPerMin ?? 120;
  const spikeAmplitude = opts.spikeAmplitude ?? 0.9;

  const length = Math.round(sampleRate * durationSec);
  const data = new Float32Array(length);

  // Beat-Intervall in Samples (60s / bpm * sr)
  const beatSamples = Math.round((60 / beatsPerMin) * sampleRate);
  for (let pos = 0; pos < length; pos += beatSamples) {
    // 10ms Burst (440 Samples bei 44100) damit Energy-Onset-Detection feuert
    const burstLen = Math.min(440, length - pos);
    for (let i = 0; i < burstLen; i++) {
      // Decay-Hülle: schneller Anstieg, kurzes Decay
      data[pos + i] = spikeAmplitude * (1 - i / burstLen);
    }
  }

  // Minimal AudioBuffer-Mock — nur die fields die wir nutzen.
  return {
    sampleRate,
    length,
    duration: durationSec,
    numberOfChannels: 1,
    getChannelData: (_ch: number) => data,
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer;
}

// ─── Tests: shouldApplyAutoBpm (Pure-fn) ────────────────────────────────────

describe("v3.53.0 – shouldApplyAutoBpm (Threshold-Logik)", () => {
  it("High-Confidence (>= threshold) → applied=true", () => {
    const r = shouldApplyAutoBpm(120, 0.8);
    expect(r.applied).toBe(true);
    expect(r.bpm).toBe(120);
    expect(r.confidence).toBeCloseTo(0.8);
  });

  it("Low-Confidence (< threshold) → applied=false (dim-display only)", () => {
    const r = shouldApplyAutoBpm(120, 0.3);
    expect(r.applied).toBe(false);
    expect(r.bpm).toBe(120);
    expect(r.confidence).toBeCloseTo(0.3);
  });

  it("Threshold-Konstante ist 0.5 (Branchenkompromiss)", () => {
    expect(AUTO_BPM_CONFIDENCE_THRESHOLD).toBe(0.5);
    expect(shouldApplyAutoBpm(120, 0.5).applied).toBe(true);
    expect(shouldApplyAutoBpm(120, 0.499).applied).toBe(false);
  });

  it("Defensive: NaN/0/negative bpm → applied=false auch bei Hoch-Confidence", () => {
    expect(shouldApplyAutoBpm(NaN, 0.99).applied).toBe(false);
    expect(shouldApplyAutoBpm(0, 0.99).applied).toBe(false);
    expect(shouldApplyAutoBpm(-1, 0.99).applied).toBe(false);
    expect(shouldApplyAutoBpm(Infinity, 0.99).applied).toBe(false);
    // 1000 BPM ist nicht valid (Detection-Range bis ~300)
    expect(shouldApplyAutoBpm(1500, 0.99).applied).toBe(false);
  });
});

// ─── Tests: applyAutoBpmToTrack (Store-Integration) ─────────────────────────

describe("v3.53.0 – applyAutoBpmToTrack (Track-Wiring)", () => {
  beforeEach(() => {
    resetTrackStore();
    localStorageMock.clear();
  });

  it("High-Confidence-Detection setzt bpmHint auf Track", () => {
    const id = addAudioTrack(makeTrackData());
    expect(getAudioTrack(id)!.bpmHint).toBeUndefined();
    const r = applyAutoBpmToTrack(id, 128, 0.85);
    expect(r.applied).toBe(true);
    expect(getAudioTrack(id)!.bpmHint).toBe(128);
  });

  it("Low-Confidence-Detection setzt KEINEN bpmHint (dim-display only)", () => {
    const id = addAudioTrack(makeTrackData());
    const r = applyAutoBpmToTrack(id, 128, 0.3);
    expect(r.applied).toBe(false);
    expect(getAudioTrack(id)!.bpmHint).toBeUndefined();
  });

  it("User-eingegebener bpmHint wird NICHT überschrieben (Auto-Detection respektiert User)", () => {
    const id = addAudioTrack(makeTrackData());
    setTrackBpmHint(id, 140); // User-Eingabe
    const r = applyAutoBpmToTrack(id, 100, 0.9); // Detection sagt 100
    expect(r.applied).toBe(false);
    expect(getAudioTrack(id)!.bpmHint).toBe(140); // User-Wert bleibt
  });

  it("Unbekannte Track-ID → applied=false (no-op)", () => {
    const r = applyAutoBpmToTrack("audiotrack:invalid", 120, 0.9);
    expect(r.applied).toBe(false);
  });
});

// ─── Tests: computeEffectiveStretchRate ─────────────────────────────────────

describe("v3.53.0 – computeEffectiveStretchRate (BPM-Sync × Manual)", () => {
  it("syncMode=free → rate = stretchRatio (bpmRate=1.0)", () => {
    const r = computeEffectiveStretchRate(140, 120, "free", 1.5);
    expect(r.bpmRate).toBe(1.0);
    expect(r.manualRatio).toBe(1.5);
    expect(r.rate).toBe(1.5);
    expect(r.clamped).toBe(false);
  });

  it("syncMode=stretch + originalBpm → bpmRate × stretchRatio", () => {
    // 130 / 120 = 1.0833, × 1.0 manual = 1.0833
    const r = computeEffectiveStretchRate(130, 120, "stretch", 1.0);
    expect(r.bpmRate).toBeCloseTo(130 / 120);
    expect(r.rate).toBeCloseTo(130 / 120, 5);
    expect(r.clamped).toBe(false);
  });

  it("Kombinierte rate > 4.0 wird geclamped (Engine-Limit)", () => {
    // 240 / 60 = 4.0 bpmRate × 2 manual = 8 → clamped auf 4.0
    const r = computeEffectiveStretchRate(240, 60, "stretch", 2.0);
    expect(r.rate).toBe(4.0);
    expect(r.clamped).toBe(true);
  });

  it("Defensive: kein originalBpm + syncMode=stretch → bpmRate=1.0", () => {
    const r = computeEffectiveStretchRate(140, null, "stretch", 1.0);
    expect(r.bpmRate).toBe(1.0);
    expect(r.rate).toBe(1.0);
  });
});

// ─── Tests: snapStretchRatio (UI-Polish) ────────────────────────────────────

describe("v3.53.0 – snapStretchRatio (Snap-zu-1.0)", () => {
  it("Werte in [1 - threshold, 1 + threshold] snappen auf exakt 1.0", () => {
    expect(STRETCH_SNAP_THRESHOLD).toBe(0.05);
    // Werte innerhalb der Snap-Zone
    expect(snapStretchRatio(0.97)).toBe(1.0);
    expect(snapStretchRatio(1.03)).toBe(1.0);
    expect(snapStretchRatio(1.0)).toBe(1.0);
    expect(snapStretchRatio(0.999)).toBe(1.0);
    // Werte außerhalb der Snap-Zone bleiben
    expect(snapStretchRatio(0.9)).toBeCloseTo(0.9, 5);
    expect(snapStretchRatio(1.1)).toBeCloseTo(1.1, 5);
    expect(snapStretchRatio(2.0)).toBe(2.0);
  });

  it("Snap clampt zusätzlich auf 0.25..4.0", () => {
    expect(snapStretchRatio(0.1)).toBe(0.25);
    expect(snapStretchRatio(8.0)).toBe(4.0);
    // NaN/0/neg → 1.0 defensive default
    expect(snapStretchRatio(NaN)).toBe(1.0);
    expect(snapStretchRatio(0)).toBe(1.0);
  });

  it("Custom-Threshold kann übergeben werden (für Tests/Use-Cases)", () => {
    // Mit kleiner threshold (0.01) bleibt 0.97 erhalten
    expect(snapStretchRatio(0.97, 0.01)).toBeCloseTo(0.97, 5);
    // Mit großer threshold (0.5) snappt auch 0.7 auf 1.0
    expect(snapStretchRatio(0.7, 0.5)).toBe(1.0);
  });
});

// ─── Tests: analyzeBpmFromBufferDirect (Worker-Mirror) ──────────────────────

describe("v3.53.0 – analyzeBpmFromBufferDirect (Auto-BPM beim Track-Add)", () => {
  it("Detected einen 120-BPM-Beat-Pattern (Onset-Detection on synthetic spikes)", () => {
    const buf = makeFakeAudioBuffer({ beatsPerMin: 120, durationSec: 5 });
    const r = analyzeBpmFromBufferDirect(buf);
    expect(r).not.toBeNull();
    // ±5 BPM Toleranz wegen Octave-Snap (60..200)
    expect(r!.bpm).toBeGreaterThan(115);
    expect(r!.bpm).toBeLessThan(125);
    expect(r!.confidence).toBeGreaterThan(0.5);
  });

  it("Returnt null bei zu wenig Onsets (silence)", () => {
    // 2s komplette Stille
    const buf = makeFakeAudioBuffer({ durationSec: 2, spikeAmplitude: 0 });
    const r = analyzeBpmFromBufferDirect(buf);
    expect(r).toBeNull();
  });

  it("Defensive: Empty-Buffer (length=0) → null", () => {
    const emptyBuf = {
      sampleRate: 44100,
      length: 0,
      duration: 0,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(0),
    } as unknown as AudioBuffer;
    const r = analyzeBpmFromBufferDirect(emptyBuf);
    expect(r).toBeNull();
  });

  it("Bei sehr klarem 100-BPM-Pattern → Confidence > Threshold", () => {
    const buf = makeFakeAudioBuffer({ beatsPerMin: 100, durationSec: 6 });
    const r = analyzeBpmFromBufferDirect(buf);
    expect(r).not.toBeNull();
    expect(r!.confidence).toBeGreaterThanOrEqual(AUTO_BPM_CONFIDENCE_THRESHOLD);
  });
});
