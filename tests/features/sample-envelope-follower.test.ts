/**
 * sample-envelope-follower.test.ts (v3.216)
 *
 * Pure-Coverage fuer sampleEnvelopeFollower.ts.
 */

import { describe, it, expect } from "vitest";
import type { AudioBufferLike } from "@/utils/sampleEmbedding";
import {
  followEnvelope,
  bufferEnvelope,
  envelopePeak,
} from "@/utils/sampleEnvelopeFollower";

function makeBuffer(channelData: number[][], sampleRate = 44100): AudioBufferLike {
  const channels = channelData.map((c) => Float32Array.from(c));
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length,
    getChannelData(ch: number) {
      const data = channels[ch];
      if (!data) throw new RangeError("channel " + ch + " out of range");
      return data;
    },
  };
}

function makeSine(freqHz: number, durationS: number, sampleRate = 44100, amplitude = 1): Float32Array {
  const n = Math.round(durationS * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

function allFinite(arr: Float32Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

describe("followEnvelope - empty / degenerate", () => {
  it("empty Float32Array -> empty result", () => {
    const out = followEnvelope(new Float32Array(0), 44100);
    expect(out.length).toBe(0);
  });

  it("null cast -> empty result", () => {
    // @ts-expect-error: bewusster ungueltiger Cast
    const out = followEnvelope(null, 44100);
    expect(out.length).toBe(0);
  });
});

describe("followEnvelope - DC signal", () => {
  it("DC=0.5 -> envelope konvergiert gegen 0.5 (peak)", () => {
    const sr = 44100;
    const samples = new Float32Array(sr * 0.2);
    samples.fill(0.5);
    const env = followEnvelope(samples, sr, { attackMs: 5, mode: "peak" });
    expect(env[env.length - 1]).toBeCloseTo(0.5, 3);
    expect(env.length).toBe(samples.length);
    expect(allFinite(env)).toBe(true);
  });

  it("DC=-0.5 (negativ) -> peak-envelope konvergiert gegen 0.5 (Betrag)", () => {
    const sr = 44100;
    const samples = new Float32Array(sr * 0.2);
    samples.fill(-0.5);
    const env = followEnvelope(samples, sr, { attackMs: 5, mode: "peak" });
    expect(env[env.length - 1]).toBeCloseTo(0.5, 3);
  });
});

describe("followEnvelope - burst", () => {
  it("envelope steigt waehrend burst und faellt danach ab", () => {
    const sr = 44100;
    const silence1 = new Float32Array(sr * 0.05);
    const burst = makeSine(440, 0.1, sr, 0.8);
    const silence2 = new Float32Array(sr * 0.2);
    const samples = new Float32Array(silence1.length + burst.length + silence2.length);
    samples.set(silence1, 0);
    samples.set(burst, silence1.length);
    samples.set(silence2, silence1.length + burst.length);

    const env = followEnvelope(samples, sr, { attackMs: 5, releaseMs: 50, mode: "peak" });

    const endSilence1 = env[silence1.length - 1];
    const endBurst = env[silence1.length + burst.length - 1];
    const endTotal = env[env.length - 1];

    expect(endSilence1).toBeLessThan(0.05);
    expect(endBurst).toBeGreaterThan(0.4);
    expect(endTotal).toBeLessThan(endBurst);
  });
});

describe("followEnvelope - peak vs rms", () => {
  it("Im stationaeren Zustand: Peak konvergiert gegen 2/pi, RMS gegen 1/sqrt(2) bei Voll-Sinus", () => {
    const sr = 44100;
    // 1 Sekunde 440Hz Sinus, Amplitude 1.
    const samples = makeSine(440, 1.0, sr, 1);
    // Gleiche Attack=Release Zeitkonstante so dass beide Modi vollstaendig
    // ueber viele Perioden glaetten (440Hz => Periode ~2.27ms; 50ms Smoothing
    // mittelt ueber ~22 Perioden, gibt theoretischen Mean-Of-Abs-Value bzw.
    // Mean-Of-Squared-Value-sqrt).
    const peak = followEnvelope(samples, sr, { attackMs: 50, releaseMs: 50, mode: "peak" });
    const rms = followEnvelope(samples, sr, { attackMs: 50, releaseMs: 50, mode: "rms" });
    // Probe-Punkt in der Mitte (nicht am Ende - Smoothing schwingt dort
    // gegen die letzte Phase). Werte sind nach >>5*tau stationaer.
    const probeIdx = Math.floor(sr * 0.5);
    const peakLate = peak[probeIdx];
    const rmsLate = rms[probeIdx];
    // Mean(|sin|) = 2/pi ~ 0.6366 (theoretischer one-pole-IIR-Stationaerwert
    // bei abs-Eingabe).
    expect(peakLate).toBeGreaterThan(0.5);
    expect(peakLate).toBeLessThan(0.75);
    // Mean(sin^2)^0.5 = 1/sqrt(2) ~ 0.7071.
    expect(rmsLate).toBeGreaterThan(0.6);
    expect(rmsLate).toBeLessThan(0.8);
    // RMS > Peak fuer einen Sinus (folgt aus Jensen / Mean(|x|) <= Mean(x^2)^0.5).
    expect(rmsLate).toBeGreaterThan(peakLate);
    expect(allFinite(peak)).toBe(true);
    expect(allFinite(rms)).toBe(true);
  });
});

describe("followEnvelope - Attack-Time", () => {
  it("schnellere Attack -> schnellerer Anstieg auf DC-Sprung", () => {
    const sr = 44100;
    const samples = new Float32Array(sr * 0.05);
    samples.fill(1);
    const fast = followEnvelope(samples, sr, { attackMs: 1, releaseMs: 50 });
    const slow = followEnvelope(samples, sr, { attackMs: 100, releaseMs: 50 });
    const probe = Math.floor(sr * 0.001);
    expect(fast[probe]).toBeGreaterThan(slow[probe]);
  });
});

describe("followEnvelope - Release-Time", () => {
  it("schnellere Release -> schnellerer Abfall auf DC-zu-0-Sprung", () => {
    const sr = 44100;
    const onLen = Math.floor(sr * 0.02);
    const offLen = Math.floor(sr * 0.05);
    const samples = new Float32Array(onLen + offLen);
    for (let i = 0; i < onLen; i++) samples[i] = 1;
    const fast = followEnvelope(samples, sr, { attackMs: 1, releaseMs: 5 });
    const slow = followEnvelope(samples, sr, { attackMs: 1, releaseMs: 200 });
    const probe = onLen + Math.floor(sr * 0.01);
    expect(fast[probe]).toBeLessThan(slow[probe]);
  });
});

describe("followEnvelope - length preservation", () => {
  it("Output-Laenge == Input-Laenge fuer diverse Groessen", () => {
    for (const n of [1, 17, 256, 4096]) {
      const samples = new Float32Array(n);
      const env = followEnvelope(samples, 44100);
      expect(env.length).toBe(n);
    }
  });
});

describe("followEnvelope - defaults", () => {
  it("opts undefined -> laeuft sauber durch", () => {
    const env = followEnvelope(makeSine(440, 0.05, 44100, 1), 44100);
    expect(env.length).toBe(2205);
    expect(allFinite(env)).toBe(true);
    expect(env[env.length - 1]).toBeGreaterThan(0.5);
  });

  it("opts {} (leer) -> identisch zu undefined", () => {
    const samples = makeSine(440, 0.05, 44100, 1);
    const a = followEnvelope(samples, 44100);
    const b = followEnvelope(samples, 44100, {});
    expect(a[a.length - 1]).toBeCloseTo(b[b.length - 1], 8);
  });
});

describe("followEnvelope - sanitizer attackMs", () => {
  it("attackMs NaN -> default", () => {
    const env = followEnvelope(new Float32Array(100).fill(1), 44100, { attackMs: Number.NaN });
    expect(allFinite(env)).toBe(true);
  });

  it("attackMs negativ -> default", () => {
    const env = followEnvelope(new Float32Array(100).fill(1), 44100, { attackMs: -10 });
    expect(allFinite(env)).toBe(true);
  });

  it("attackMs > MAX (99999) -> clamp 5000", () => {
    const env = followEnvelope(new Float32Array(100).fill(1), 44100, { attackMs: 99999 });
    expect(allFinite(env)).toBe(true);
  });

  it("attackMs = 0 -> instant attack", () => {
    const samples = new Float32Array([0, 0.7, 0.7, 0.7]);
    const env = followEnvelope(samples, 44100, { attackMs: 0, releaseMs: 50 });
    expect(env[1]).toBeCloseTo(0.7, 6);
    expect(allFinite(env)).toBe(true);
  });

  it("attackMs Infinity -> default (non-finite-Pfad)", () => {
    const env = followEnvelope(new Float32Array(50).fill(1), 44100, { attackMs: Number.POSITIVE_INFINITY });
    expect(allFinite(env)).toBe(true);
  });
});

describe("followEnvelope - sanitizer releaseMs", () => {
  it("releaseMs NaN -> default", () => {
    const env = followEnvelope(makeSine(440, 0.05, 44100, 1), 44100, { releaseMs: Number.NaN });
    expect(allFinite(env)).toBe(true);
  });

  it("releaseMs < 1 (=0) -> default 50", () => {
    const env = followEnvelope(makeSine(440, 0.05, 44100, 1), 44100, { releaseMs: 0 });
    expect(allFinite(env)).toBe(true);
  });

  it("releaseMs > MAX (99999) -> clamp 10000", () => {
    const env = followEnvelope(makeSine(440, 0.05, 44100, 1), 44100, { releaseMs: 99999 });
    expect(allFinite(env)).toBe(true);
  });
});

describe("followEnvelope - sanitizer mode", () => {
  it("mode unbekannt -> fallback peak", () => {
    const samples = makeSine(440, 0.2, 44100, 1);
    // @ts-expect-error: invalid mode
    const env = followEnvelope(samples, 44100, { mode: "foo" });
    expect(env[env.length - 1]).toBeGreaterThan(0.8);
  });
});

describe("followEnvelope - sampleRate variants", () => {
  it.each([[8000], [22050], [44100], [48000], [96000]])("sr=%d liefert finite envelope", (sr) => {
    const samples = makeSine(220, 0.05, sr, 0.5);
    const env = followEnvelope(samples, sr);
    expect(env.length).toBe(samples.length);
    expect(allFinite(env)).toBe(true);
  });

  it("sr <= 0 -> fallback 44100", () => {
    const env = followEnvelope(new Float32Array(100).fill(0.5), -1);
    expect(allFinite(env)).toBe(true);
  });

  it("sr NaN -> fallback 44100", () => {
    const env = followEnvelope(new Float32Array(100).fill(0.5), Number.NaN);
    expect(allFinite(env)).toBe(true);
  });
});

describe("followEnvelope - purity / immutability", () => {
  it("input wird NICHT mutiert", () => {
    const samples = makeSine(440, 0.05, 44100, 0.8);
    const before = Array.from(samples);
    followEnvelope(samples, 44100, { attackMs: 5, releaseMs: 50 });
    const after = Array.from(samples);
    expect(after).toEqual(before);
  });

  it("Output-Float32Array !== Input-Float32Array (aliasing-frei)", () => {
    const samples = new Float32Array(50).fill(1);
    const env = followEnvelope(samples, 44100);
    expect(env).not.toBe(samples);
  });

  it("deterministisch: 2 Aufrufe identisches Resultat", () => {
    const samples = makeSine(440, 0.05, 44100, 1);
    const a = followEnvelope(samples, 44100, { attackMs: 3, releaseMs: 70 });
    const b = followEnvelope(samples, 44100, { attackMs: 3, releaseMs: 70 });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 8);
  });
});

describe("bufferEnvelope - multi-channel", () => {
  it("Stereo: Output = arithmetisches Mittel der Per-Channel-Envelopes", () => {
    const sr = 44100;
    const left = makeSine(220, 0.05, sr, 0.4);
    const right = makeSine(220, 0.05, sr, 0.8);
    const buf = makeBuffer([Array.from(left), Array.from(right)], sr);
    const mixed = bufferEnvelope(buf, { attackMs: 5, releaseMs: 50 });
    const envL = followEnvelope(left, sr, { attackMs: 5, releaseMs: 50 });
    const envR = followEnvelope(right, sr, { attackMs: 5, releaseMs: 50 });
    expect(mixed.length).toBe(buf.length);
    for (let i = 0; i < mixed.length; i += 200) {
      expect(mixed[i]).toBeCloseTo((envL[i] + envR[i]) * 0.5, 6);
    }
  });

  it("Mono-Buffer -> identisch zu followEnvelope direkt", () => {
    const sr = 44100;
    const samples = makeSine(220, 0.05, sr, 0.6);
    const buf = makeBuffer([Array.from(samples)], sr);
    const fromBuf = bufferEnvelope(buf, { attackMs: 5, releaseMs: 50 });
    const direct = followEnvelope(samples, sr, { attackMs: 5, releaseMs: 50 });
    expect(fromBuf.length).toBe(direct.length);
    for (let i = 0; i < fromBuf.length; i += 100) {
      expect(fromBuf[i]).toBeCloseTo(direct[i], 6);
    }
  });

  it("empty buffer -> leere Float32Array", () => {
    const buf = makeBuffer([[]], 44100);
    const env = bufferEnvelope(buf);
    expect(env.length).toBe(0);
  });

  it("null buffer-Cast -> leere Float32Array", () => {
    // @ts-expect-error: bewusster Cast
    const env = bufferEnvelope(null);
    expect(env.length).toBe(0);
  });
});

describe("envelopePeak", () => {
  it("findet Maximum und dessen Index", () => {
    const env = Float32Array.from([0.1, 0.5, 0.9, 0.3, 0.8]);
    const peak = envelopePeak(env);
    expect(peak.value).toBeCloseTo(0.9, 6);
    expect(peak.sampleIndex).toBe(2);
  });

  it("Tie-Break: erste Position mit Max gewinnt (strict greater than)", () => {
    const env = Float32Array.from([0.2, 0.7, 0.7, 0.7, 0.1]);
    const peak = envelopePeak(env);
    expect(peak.value).toBeCloseTo(0.7, 6);
    expect(peak.sampleIndex).toBe(1);
  });

  it("Empty Float32Array -> { value: 0, sampleIndex: 0 }", () => {
    const peak = envelopePeak(new Float32Array(0));
    expect(peak).toEqual({ value: 0, sampleIndex: 0 });
  });

  it("Single element -> value=element, index=0", () => {
    const peak = envelopePeak(Float32Array.from([0.42]));
    expect(peak.value).toBeCloseTo(0.42, 6);
    expect(peak.sampleIndex).toBe(0);
  });

  it("Real-world Envelope einer burst: Peak liegt im Burst-Bereich", () => {
    const sr = 44100;
    const silence1 = new Float32Array(sr * 0.05);
    const burst = makeSine(440, 0.1, sr, 0.9);
    const silence2 = new Float32Array(sr * 0.2);
    const samples = new Float32Array(silence1.length + burst.length + silence2.length);
    samples.set(silence1, 0);
    samples.set(burst, silence1.length);
    samples.set(silence2, silence1.length + burst.length);
    const env = followEnvelope(samples, sr, { attackMs: 5, releaseMs: 50 });
    const peak = envelopePeak(env);
    expect(peak.sampleIndex).toBeGreaterThanOrEqual(silence1.length);
    expect(peak.sampleIndex).toBeLessThan(silence1.length + burst.length);
  });
});
