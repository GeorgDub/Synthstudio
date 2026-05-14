/**
 * Synthstudio – BPM- und Onset-Detection Tests (v2.13)
 *
 * Validiert die pure Float32Array-basierte Detection-Logik aus
 * client/src/utils/bpmAndOnsetDetection.ts.
 */
import { describe, it, expect } from "vitest";
import {
  detectBpm,
  detectOnsets,
  generateClickTrack,
} from "../../client/src/utils/bpmAndOnsetDetection";

describe("detectOnsets", () => {
  it("findet Onsets bei einem Click-Track mit bekanntem Tempo", () => {
    const sampleRate = 44100;
    const data = generateClickTrack(120, 4, sampleRate); // 120 BPM = 8 Klicks in 4s
    const onsets = detectOnsets(data, sampleRate);
    // Erwartung: ungefähr 8 Onsets ± kleine Toleranz
    expect(onsets.length).toBeGreaterThanOrEqual(6);
    expect(onsets.length).toBeLessThanOrEqual(10);
  });

  it("liefert leere Liste bei Stille", () => {
    const data = new Float32Array(44100 * 2); // 2s Stille
    const onsets = detectOnsets(data, 44100);
    expect(onsets).toEqual([]);
  });

  it("respektiert maxSeconds-Option", () => {
    const sampleRate = 44100;
    const data = generateClickTrack(120, 10, sampleRate);
    const allOnsets = detectOnsets(data, sampleRate);
    const limitedOnsets = detectOnsets(data, sampleRate, { maxSeconds: 2 });
    expect(limitedOnsets.length).toBeLessThan(allOnsets.length);
    // 2s @ 120 BPM ≈ 4 Klicks
    expect(limitedOnsets.length).toBeLessThanOrEqual(4);
  });
});

describe("detectBpm", () => {
  it("erkennt 120 BPM aus einem 120-BPM-Click-Track", () => {
    const sampleRate = 44100;
    const data = generateClickTrack(120, 8, sampleRate);
    const result = detectBpm(data, sampleRate);
    expect(result.bpm).toBeGreaterThanOrEqual(115);
    expect(result.bpm).toBeLessThanOrEqual(125);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("erkennt 140 BPM (Drum & Bass-Bereich)", () => {
    const sampleRate = 44100;
    const data = generateClickTrack(140, 8, sampleRate);
    const result = detectBpm(data, sampleRate);
    expect(result.bpm).toBeGreaterThanOrEqual(135);
    expect(result.bpm).toBeLessThanOrEqual(145);
  });

  it("liefert Fallback 120 BPM bei zu wenig Onsets", () => {
    const data = new Float32Array(44100 * 2); // Stille
    const result = detectBpm(data, 44100);
    expect(result.bpm).toBe(120);
    expect(result.confidence).toBe(0);
  });

  it("normalisiert Tempo nach unten in den 60–200-Bereich (Half-Time)", () => {
    const sampleRate = 44100;
    // Halbierter 60 BPM-Track (extrem langsam) sollte hoch-skaliert werden
    const data = generateClickTrack(50, 10, sampleRate);
    const result = detectBpm(data, sampleRate);
    expect(result.bpm).toBeGreaterThanOrEqual(60);
    expect(result.bpm).toBeLessThanOrEqual(200);
  });

  it("liefert immer eine numerische BPM auch bei verrauschten Inputs", () => {
    const data = new Float32Array(44100 * 2);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() - 0.5) * 0.01; // sehr leise Noise
    }
    const result = detectBpm(data, 44100);
    expect(typeof result.bpm).toBe("number");
    expect(Number.isFinite(result.bpm)).toBe(true);
    expect(result.bpm).toBeGreaterThanOrEqual(60);
    expect(result.bpm).toBeLessThanOrEqual(200);
  });
});

describe("generateClickTrack", () => {
  it("erzeugt einen Float32Array mit korrekter Länge", () => {
    const data = generateClickTrack(120, 2, 44100);
    expect(data.length).toBe(88200);
  });

  it("enthält non-zero Samples (nicht reine Stille)", () => {
    const data = generateClickTrack(120, 1);
    const hasNonZero = data.some((v) => v !== 0);
    expect(hasNonZero).toBe(true);
  });
});
