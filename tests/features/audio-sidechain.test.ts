/**
 * Synthstudio – audio-sidechain.test.ts (v3.119.0)
 *
 * Tests für die Audio-Triggered Sidechain v2:
 *   - Pure helpers (detectPeak, applyEnvelope, dbToGain ⇄ gainToDb)
 *   - Store (addChain / removeChain / updateChain / persistence)
 *
 * AudioSidechainNode runtime-instance NICHT direkt getestet — braucht
 * AudioContext + rAF, nicht in Node-Vitest abbildbar. Wir testen die
 * Algorithmen-Helper (die der Node intern aufruft).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyEnvelope,
  dbToGain,
  detectPeak,
  gainToDb,
  sanitizeAudioSidechainConfig,
} from "@/audio/AudioSidechainNode";
import {
  __resetAudioSidechainStoreForTests,
  addChain,
  getAudioSidechainState,
  removeChain,
  removeChainsForChannel,
  updateChain,
} from "@/store/useAudioSidechainStore";

// ─── Pure Helpers: detectPeak ────────────────────────────────────────────────

describe("detectPeak", () => {
  it("returns max abs value of samples", () => {
    const samples = new Float32Array([0.1, -0.3, 0.5, -0.7, 0.2]);
    expect(detectPeak(samples)).toBeCloseTo(0.7, 6);
  });

  it("returns 0 for silence", () => {
    const samples = new Float32Array(512); // all zeros
    expect(detectPeak(samples)).toBe(0);
  });

  it("handles single-sample buffer", () => {
    const samples = new Float32Array([-0.42]);
    expect(detectPeak(samples)).toBeCloseTo(0.42, 6);
  });

  it("handles full-scale signal", () => {
    const samples = new Float32Array([1.0, -1.0, 0.5, -0.5]);
    expect(detectPeak(samples)).toBe(1.0);
  });
});

// ─── Pure Helpers: dbToGain / gainToDb ───────────────────────────────────────

describe("dbToGain / gainToDb", () => {
  it("0 dB ↔ 1.0 gain", () => {
    expect(dbToGain(0)).toBeCloseTo(1, 9);
    expect(gainToDb(1)).toBeCloseTo(0, 6);
  });

  it("-6 dB ≈ 0.501 gain", () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 2);
  });

  it("round-trip preserves value within tolerance", () => {
    for (const db of [-40, -20, -12, -6, -3, 0]) {
      const g = dbToGain(db);
      const back = gainToDb(g);
      expect(back).toBeCloseTo(db, 4);
    }
  });

  it("gainToDb clamps silence to MIN_DB (-60)", () => {
    expect(gainToDb(0)).toBe(-60);
    expect(gainToDb(1e-9)).toBe(-60);
  });

  it("dbToGain(-Infinity) → 0", () => {
    expect(dbToGain(-Infinity)).toBe(0);
  });
});

// ─── Pure Helpers: applyEnvelope ─────────────────────────────────────────────

describe("applyEnvelope", () => {
  it("peak below threshold → no reduction", () => {
    // -30 dBFS signal, threshold -18 → over = 0 → reduction = 0
    const peak = dbToGain(-30);
    const result = applyEnvelope(peak, -18, 4, 5, 100, 0, 16);
    expect(result).toBe(0);
  });

  it("peak above threshold → positive reduction", () => {
    // 0 dBFS signal, threshold -18, ratio 4
    // over = 18 dB, reduction = 18 × (1 - 1/4) = 13.5 dB → after long dt
    const peak = 1.0;
    // dt huge relative to attack so we approach target fully.
    const result = applyEnvelope(peak, -18, 4, 5, 100, 0, 1000);
    expect(result).toBeGreaterThan(13);
    expect(result).toBeLessThanOrEqual(13.5);
  });

  it("ratio is applied correctly (10:1 → almost full overshoot collapse)", () => {
    const peak = 1.0; // 0 dBFS
    // over = 18 dB, ratio 10 → reduction ≈ 18 × 0.9 = 16.2 dB
    const result = applyEnvelope(peak, -18, 10, 0.1, 1, 0, 100);
    expect(result).toBeGreaterThan(15.5);
    expect(result).toBeLessThanOrEqual(16.2 + 0.01);
  });

  it("ratio 1:1 → no reduction even above threshold", () => {
    const peak = 1.0;
    const result = applyEnvelope(peak, -18, 1, 5, 100, 0, 1000);
    expect(result).toBe(0);
  });

  it("attack-time controls onset (short attack reaches target faster)", () => {
    const peak = 1.0;
    // Same dt, different attack → short attack → closer to target.
    const shortAttack = applyEnvelope(peak, -18, 4, 1, 200, 0, 5); // dt=5ms, atk=1ms
    const longAttack = applyEnvelope(peak, -18, 4, 50, 200, 0, 5); // atk=50ms
    expect(shortAttack).toBeGreaterThan(longAttack);
  });

  it("release-time controls return (short release falls faster)", () => {
    const peakSilence = 0;
    const prevReduction = 12; // already compressing 12 dB
    // peak below threshold → target = 0, falls via release.
    const shortRelease = applyEnvelope(peakSilence, -18, 4, 5, 20, prevReduction, 10);
    const longRelease = applyEnvelope(peakSilence, -18, 4, 5, 500, prevReduction, 10);
    // Short release decays MORE in same dt → resulting reduction is LOWER.
    expect(shortRelease).toBeLessThan(longRelease);
  });

  it("smoothing: prevReduction is carried forward (single-step partial movement)", () => {
    const peak = 1.0;
    // First step with dt=1ms (attack=5ms): partial movement toward target.
    const r1 = applyEnvelope(peak, -18, 4, 5, 100, 0, 1);
    expect(r1).toBeGreaterThan(0);
    expect(r1).toBeLessThan(13.5);
    // Second step should continue rising from r1.
    const r2 = applyEnvelope(peak, -18, 4, 5, 100, r1, 1);
    expect(r2).toBeGreaterThan(r1);
  });

  it("reduction never negative", () => {
    // Even with weird inputs.
    const r = applyEnvelope(0.0001, -60, 20, 1, 1, 0, 100);
    expect(r).toBeGreaterThanOrEqual(0);
  });

  it("dt = 0 → no movement (returns prev)", () => {
    const r = applyEnvelope(1.0, -18, 4, 5, 100, 7.5, 0);
    expect(r).toBeCloseTo(7.5, 6);
  });
});

// ─── Sanitize Config ─────────────────────────────────────────────────────────

describe("sanitizeAudioSidechainConfig", () => {
  it("clamps threshold to [-60, 0]", () => {
    expect(sanitizeAudioSidechainConfig({ threshold: 99 }).threshold).toBe(0);
    expect(sanitizeAudioSidechainConfig({ threshold: -200 }).threshold).toBe(-60);
  });

  it("clamps ratio to [1, 20]", () => {
    expect(sanitizeAudioSidechainConfig({ ratio: 0.1 }).ratio).toBe(1);
    expect(sanitizeAudioSidechainConfig({ ratio: 999 }).ratio).toBe(20);
  });

  it("clamps attackMs and releaseMs", () => {
    const cfg = sanitizeAudioSidechainConfig({ attackMs: -5, releaseMs: 9999 });
    expect(cfg.attackMs).toBe(0.1);
    expect(cfg.releaseMs).toBe(1000);
  });

  it("rejects NaN/Infinity → defaults", () => {
    const cfg = sanitizeAudioSidechainConfig({
      threshold: NaN,
      ratio: Infinity,
      attackMs: NaN,
      releaseMs: -Infinity,
    });
    expect(cfg.threshold).toBe(-18);
    // Infinity actually IS Number.isFinite=false → default 4, then clamped.
    expect(cfg.ratio).toBe(4);
    expect(cfg.attackMs).toBe(5);
    expect(cfg.releaseMs).toBe(120);
  });
});

// ─── Store ───────────────────────────────────────────────────────────────────

describe("useAudioSidechainStore", () => {
  beforeEach(() => {
    __resetAudioSidechainStoreForTests();
  });
  afterEach(() => {
    __resetAudioSidechainStoreForTests();
  });

  it("starts empty", () => {
    expect(getAudioSidechainState().chains).toEqual([]);
  });

  it("addChain creates a chain with sanitized config", () => {
    const chain = addChain({
      sourceChannelId: "kick",
      targetChannelId: "bass",
      config: { threshold: 99 }, // will be clamped to 0
    });
    expect(chain.id).toBeTruthy();
    expect(chain.sourceChannelId).toBe("kick");
    expect(chain.targetChannelId).toBe("bass");
    expect(chain.enabled).toBe(true);
    expect(chain.config.threshold).toBe(0);
    expect(getAudioSidechainState().chains).toHaveLength(1);
  });

  it("addChain assigns unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const c = addChain({ sourceChannelId: "a", targetChannelId: "b" });
      ids.add(c.id);
    }
    expect(ids.size).toBe(20);
  });

  it("removeChain removes existing chain", () => {
    const c = addChain({ sourceChannelId: "a", targetChannelId: "b" });
    removeChain(c.id);
    expect(getAudioSidechainState().chains).toHaveLength(0);
  });

  it("removeChain no-op on unknown id", () => {
    addChain({ sourceChannelId: "a", targetChannelId: "b" });
    removeChain("unknown-id");
    expect(getAudioSidechainState().chains).toHaveLength(1);
  });

  it("updateChain updates source/target/enabled/config", () => {
    const c = addChain({ sourceChannelId: "a", targetChannelId: "b" });
    updateChain(c.id, {
      sourceChannelId: "c",
      targetChannelId: "d",
      enabled: false,
      config: { ratio: 8 },
    });
    const updated = getAudioSidechainState().chains[0];
    expect(updated.sourceChannelId).toBe("c");
    expect(updated.targetChannelId).toBe("d");
    expect(updated.enabled).toBe(false);
    expect(updated.config.ratio).toBe(8);
  });

  it("updateChain sanitizes invalid config values", () => {
    const c = addChain({ sourceChannelId: "a", targetChannelId: "b" });
    updateChain(c.id, { config: { threshold: 999, ratio: 999 } });
    const updated = getAudioSidechainState().chains[0];
    expect(updated.config.threshold).toBe(0);
    expect(updated.config.ratio).toBe(20);
  });

  it("removeChainsForChannel removes chains where channel is source or target", () => {
    const c1 = addChain({ sourceChannelId: "kick", targetChannelId: "bass" });
    const c2 = addChain({ sourceChannelId: "snare", targetChannelId: "kick" });
    const c3 = addChain({ sourceChannelId: "snare", targetChannelId: "bass" });
    removeChainsForChannel("kick");
    const remaining = getAudioSidechainState().chains;
    expect(remaining.find((c) => c.id === c1.id)).toBeUndefined();
    expect(remaining.find((c) => c.id === c2.id)).toBeUndefined();
    expect(remaining.find((c) => c.id === c3.id)).toBeDefined();
  });

  it("persists chains to localStorage (when available)", () => {
    addChain({ sourceChannelId: "kick", targetChannelId: "bass" });
    if (typeof localStorage === "undefined") {
      // Node-only Vitest env without DOM → store still works in-memory.
      expect(getAudioSidechainState().chains).toHaveLength(1);
      return;
    }
    const raw = localStorage.getItem("ss-audio-sidechain:v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.chains).toHaveLength(1);
    expect(parsed.chains[0].sourceChannelId).toBe("kick");
  });
});
