// @vitest-environment node
/**
 * wav-encoder-24bit.test.ts (v3.150.0)
 *
 * Tests für 24-bit PCM Support in wavEncoder.ts.
 */
import { describe, it, expect } from "vitest";
import { encodeWav, isValidWavHeader } from "@/audio/wavEncoder";

describe("wavEncoder 24-bit support", () => {
  it("akzeptiert bitDepth: 24 ohne Throw", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buf = encodeWav([samples], { sampleRate: 48000, channels: 1, bitDepth: 24 });
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf.byteLength).toBe(44 + 5 * 3); // header + 5 samples × 3 bytes
  });

  it("Header reportet bitDepth=24", () => {
    const samples = new Float32Array(100);
    const buf = encodeWav([samples], { sampleRate: 48000, channels: 1, bitDepth: 24 });
    const view = new DataView(buf);
    // Bits-per-Sample-Feld liegt bei offset 34 (siehe wavEncoder writeAscii layout).
    const bps = view.getUint16(34, true);
    expect(bps).toBe(24);
  });

  it("Header byteRate korrekt für 24-bit stereo 48k", () => {
    const l = new Float32Array(100);
    const r = new Float32Array(100);
    const buf = encodeWav([l, r], { sampleRate: 48000, channels: 2, bitDepth: 24 });
    const view = new DataView(buf);
    // byteRate = sampleRate * channels * bytesPerSample = 48000 * 2 * 3 = 288000
    expect(view.getUint32(28, true)).toBe(288000);
    // blockAlign = channels * bytesPerSample = 2 * 3 = 6
    expect(view.getUint16(32, true)).toBe(6);
  });

  it("encoded peak (sample=1.0) liegt nahe 0x7fffff", () => {
    const samples = new Float32Array([1.0]);
    const buf = encodeWav([samples], { sampleRate: 48000, channels: 1, bitDepth: 24 });
    const view = new DataView(buf);
    // PCM data starts at offset 44.
    const lo = view.getUint8(44);
    const mid = view.getUint8(45);
    const hi = view.getUint8(46);
    const value = (hi << 16) | (mid << 8) | lo;
    expect(value).toBe(0x7fffff);
  });

  it("encoded negative peak (sample=-1.0) liegt nahe 0x800000 (two's complement)", () => {
    const samples = new Float32Array([-1.0]);
    const buf = encodeWav([samples], { sampleRate: 48000, channels: 1, bitDepth: 24 });
    const view = new DataView(buf);
    const lo = view.getUint8(44);
    const mid = view.getUint8(45);
    const hi = view.getUint8(46);
    const value = (hi << 16) | (mid << 8) | lo;
    expect(value).toBe(0x800000);
  });

  it("16-bit default unverändert (Backward-Compat)", () => {
    const samples = new Float32Array([0.5, -0.5]);
    const buf = encodeWav([samples], { sampleRate: 48000, channels: 1 });
    expect(buf.byteLength).toBe(44 + 2 * 2);
    const view = new DataView(buf);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it("rejects unsupported bitDepth (z.B. 32) mit klarer Fehlermeldung", () => {
    const samples = new Float32Array([0]);
    expect(() =>
      // @ts-expect-error testing invalid bitDepth
      encodeWav([samples], { sampleRate: 48000, bitDepth: 32 }),
    ).toThrow(/16 or 24/);
  });

  it("isValidWavHeader akzeptiert 24-bit Header", () => {
    const samples = new Float32Array(50);
    const buf = encodeWav([samples], { sampleRate: 48000, channels: 1, bitDepth: 24 });
    expect(isValidWavHeader(buf)).toBe(true);
  });

  it("Round-Trip-Decode (clip-to-int24 ≈ float): Mid-Range Sample", () => {
    const samples = new Float32Array([0.25]);
    const buf = encodeWav([samples], { sampleRate: 48000, channels: 1, bitDepth: 24 });
    const view = new DataView(buf);
    const lo = view.getUint8(44);
    const mid = view.getUint8(45);
    const hi = view.getUint8(46);
    // Lesen als signed int24
    let n = (hi << 16) | (mid << 8) | lo;
    if (n & 0x800000) n -= 0x1000000; // sign-extend
    // Reconstructed float: n / 0x7fffff
    const reconstructed = n / 0x7fffff;
    expect(reconstructed).toBeCloseTo(0.25, 4);
  });
});
