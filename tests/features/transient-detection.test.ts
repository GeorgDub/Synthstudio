/**
 * tests/features/transient-detection.test.ts (TASK-CVG-TRANSIENT / v2.62)
 *
 * Pure-Coverage für client/src/utils/transientDetection.ts.
 *
 * Amplitude-Onset-Detection für den Sample-Slicer. Diese Suite verifiziert
 * Threshold-Filter + minGap-Spacing gegen synthetisch konstruierte
 * AudioBuffers (kein echtes Web-Audio nötig — die Funktion nimmt nur ein
 * { getChannelData, sampleRate } Interface an).
 */
import { describe, it, expect } from "vitest";
import { detectTransients } from "@/utils/transientDetection";

interface FakeBuffer {
  getChannelData: (channel: number) => Float32Array;
  sampleRate: number;
}

function makeBuffer(samples: number[], sampleRate = 44100): FakeBuffer {
  const data = new Float32Array(samples);
  return {
    getChannelData: () => data,
    sampleRate,
  };
}

/**
 * Konstruiert ein Burst-Signal: N Bursts mit `burstAmplitude` an `burstStarts`,
 * sonst silence.
 */
function makeBurstBuffer(
  length: number,
  burstStarts: number[],
  burstAmplitude: number,
  burstWidth = 1,
  sampleRate = 44100,
): FakeBuffer {
  const data = new Float32Array(length);
  for (const start of burstStarts) {
    for (let i = 0; i < burstWidth && start + i < length; i++) {
      data[start + i] = burstAmplitude;
    }
  }
  return {
    getChannelData: () => data,
    sampleRate,
  };
}

describe("TransientDetection – Empty + Silent Buffers", () => {
  it("Leerer Buffer (Length=0) → keine Marker", () => {
    const buf = makeBuffer([]);
    expect(detectTransients(buf)).toEqual([]);
  });

  it("Komplett silence → keine Marker", () => {
    const buf = makeBuffer(new Array(1000).fill(0));
    expect(detectTransients(buf)).toEqual([]);
  });

  it("Konstante Amplitude (DC offset): ein Initial-Marker (Algorithmus startet mit prevAmplitude=0), danach keine weiteren", () => {
    // Quirk: prevAmplitude=0 initial → erster Sample bei 0.5 sieht aus wie ein Onset.
    // Danach delta=0 → keine weiteren Marker.
    const buf = makeBuffer(new Array(1000).fill(0.5));
    const markers = detectTransients(buf, 0.15, 0);
    expect(markers).toHaveLength(1);
    expect(markers[0].sampleOffset).toBe(1);
  });
});

describe("TransientDetection – Single Burst Detection", () => {
  it("Ein Burst (0 → 1.0) bei Sample 100 → ein Marker an Position 100", () => {
    const buf = makeBurstBuffer(500, [100], 1.0);
    const markers = detectTransients(buf, 0.15, 0);
    expect(markers).toHaveLength(1);
    expect(markers[0].sampleOffset).toBe(100);
  });

  it("Burst-Amplitude unter Threshold → kein Marker", () => {
    const buf = makeBurstBuffer(500, [100], 0.1);
    const markers = detectTransients(buf, 0.15);
    expect(markers).toHaveLength(0);
  });

  it("Burst-Amplitude klar unter Threshold (delta=0.14) → kein Marker (strict >)", () => {
    // Wir testen NICHT die exakte 0.15-Grenze, weil Float32-Precision das
    // Vergleichs-Verhalten nicht-deterministisch macht (0.15 als Float32 wird
    // zu 0.15000000596046448 und dadurch zu > 0.15-als-Float64).
    const buf = makeBurstBuffer(500, [100], 0.14);
    expect(detectTransients(buf, 0.15)).toHaveLength(0);
  });

  it("Burst leicht über Threshold (0.16) → Marker mit strength≈0.16", () => {
    const buf = makeBurstBuffer(500, [100], 0.16);
    const markers = detectTransients(buf, 0.15, 0);
    expect(markers).toHaveLength(1);
    expect(markers[0].strength).toBeCloseTo(0.16, 5);
  });

  it("Marker-strength wird auf [0,1] geclamped (delta=2 → strength=1)", () => {
    const buf = makeBurstBuffer(500, [100], 2.0);
    const markers = detectTransients(buf, 0.15, 0);
    expect(markers[0].strength).toBe(1);
  });
});

describe("TransientDetection – timeSeconds + sampleRate", () => {
  it("timeSeconds = sampleOffset / sampleRate", () => {
    const buf = makeBurstBuffer(2000, [1000], 1.0, 1, 44100);
    const markers = detectTransients(buf, 0.15, 0);
    expect(markers[0].timeSeconds).toBeCloseTo(1000 / 44100, 6);
  });

  it("48kHz Buffer: timeSeconds skaliert mit sampleRate", () => {
    const buf = makeBurstBuffer(2000, [1000], 1.0, 1, 48000);
    const markers = detectTransients(buf, 0.15, 0);
    expect(markers[0].timeSeconds).toBeCloseTo(1000 / 48000, 6);
  });
});

describe("TransientDetection – minGapMs Spacing", () => {
  it("Zwei Bursts nah beieinander, default minGapMs=50 → nur erster gemarkert", () => {
    // 44100 Hz × 50ms = 2205 samples minimum gap
    const buf = makeBurstBuffer(5000, [100, 200], 1.0); // Abstand 100 samples = ~2.3ms
    const markers = detectTransients(buf, 0.15, 50);
    expect(markers).toHaveLength(1);
    expect(markers[0].sampleOffset).toBe(100);
  });

  it("Zwei Bursts mit ausreichend Abstand → beide gemarkert", () => {
    // Abstand 3000 samples = ~68ms > minGapMs 50
    const buf = makeBurstBuffer(8000, [100, 3100], 1.0);
    const markers = detectTransients(buf, 0.15, 50);
    expect(markers).toHaveLength(2);
  });

  it("minGapMs=0 erlaubt direkt aufeinanderfolgende Marker (wenn delta>threshold)", () => {
    // Mit Width=1 und Abstand 1 sample: zweiter Burst hat aber kein delta>threshold
    // weil prevAmplitude noch der erste Burst-Wert ist
    // Stattdessen: drei isolierte Bursts mit width=1 + Lücken
    const data = new Float32Array(100);
    data[10] = 1.0; // delta = 1.0
    data[12] = 0;
    data[20] = 1.0; // delta = 1.0
    data[22] = 0;
    data[30] = 1.0; // delta = 1.0
    const buf: FakeBuffer = { getChannelData: () => data, sampleRate: 44100 };
    const markers = detectTransients(buf, 0.15, 0);
    expect(markers.length).toBeGreaterThanOrEqual(3);
  });

  it("Custom minGapMs=100 erfordert größeren Abstand", () => {
    // 44100 × 0.1s = 4410 samples minGap
    // Bursts bei 100 + 5000 (Abstand 4900 > 4410 → beide werden gemarkert)
    const buf = makeBurstBuffer(10000, [100, 5000], 1.0);
    const markers = detectTransients(buf, 0.15, 100);
    expect(markers).toHaveLength(2);
  });

  it("Custom minGapMs=100 + zu naher zweiter Burst → nur erster", () => {
    // Abstand 4000 samples ≈ 90ms < 100ms minGap
    const buf = makeBurstBuffer(10000, [100, 4100], 1.0);
    const markers = detectTransients(buf, 0.15, 100);
    expect(markers).toHaveLength(1);
  });
});

describe("TransientDetection – Amplitude-Absolute (negative Werte)", () => {
  it("Negativer Burst (-1.0 → 0) wird auch detektiert (über Math.abs)", () => {
    const data = new Float32Array(500);
    data[100] = -1.0;
    const buf: FakeBuffer = { getChannelData: () => data, sampleRate: 44100 };
    const markers = detectTransients(buf, 0.15, 0);
    expect(markers).toHaveLength(1);
    expect(markers[0].sampleOffset).toBe(100);
  });

  it("Symmetrische Sinusschwingung mit langsamem Anstieg → keine Marker bis delta>threshold", () => {
    // Sinus mit niedriger Frequenz hat kleine sample-zu-sample-deltas
    const length = 1000;
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * i) / 200); // Periode 200 samples
    }
    const buf: FakeBuffer = { getChannelData: () => data, sampleRate: 44100 };
    const markers = detectTransients(buf, 0.15, 0);
    // Glatter Sinus → max delta ≈ 0.5 * (Math.sin(2π*1/200) - Math.sin(0)) ≈ 0.016 → unter threshold
    expect(markers).toHaveLength(0);
  });
});
