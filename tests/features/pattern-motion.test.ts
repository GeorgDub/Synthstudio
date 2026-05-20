// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeMotion, motionPeak, type MotionStepLike } from "@/utils/patternMotion";

function step(active: boolean, velocity?: number): MotionStepLike {
  return velocity === undefined ? { active } : { active, velocity };
}

describe("patternMotion", () => {
  describe("computeMotion", () => {
    it("empty array → all zeros", () => {
      const r = computeMotion([]);
      expect(r.vectors).toEqual([]);
      expect(r.overallMotion).toBe(0);
      expect(r.netDirection).toBe(0);
      expect(r.acceleration).toBe(0);
    });

    it("single step → all zeros", () => {
      const r = computeMotion([step(true, 1)]);
      expect(r.vectors).toEqual([]);
      expect(r.overallMotion).toBe(0);
    });

    it("all active uniform → motion=0", () => {
      const steps = [step(true, 1), step(true, 1), step(true, 1), step(true, 1)];
      const r = computeMotion(steps);
      expect(r.overallMotion).toBe(0);
      expect(r.netDirection).toBe(0);
      expect(r.acceleration).toBe(0);
    });

    it("rising velocities → positive netDirection", () => {
      const steps = [step(true, 0.2), step(true, 0.4), step(true, 0.6), step(true, 0.8)];
      const r = computeMotion(steps);
      expect(r.netDirection).toBeGreaterThan(0);
    });

    it("falling velocities → negative netDirection", () => {
      const steps = [step(true, 0.8), step(true, 0.6), step(true, 0.4), step(true, 0.2)];
      const r = computeMotion(steps);
      expect(r.netDirection).toBeLessThan(0);
    });

    it("vectors.length = steps.length - 1", () => {
      const steps = [step(true), step(false), step(true), step(false), step(true)];
      const r = computeMotion(steps);
      expect(r.vectors.length).toBe(4);
    });

    it("velocity default 1 for active without velocity", () => {
      const r1 = computeMotion([step(false), step(true)]);
      const r2 = computeMotion([step(false), step(true, 1)]);
      expect(r1.vectors[0].delta).toBe(r2.vectors[0].delta);
      expect(r1.vectors[0].delta).toBe(1);
    });

    it("inactive → 0 energy regardless of velocity", () => {
      const r = computeMotion([step(true, 1), step(false, 0.5)]);
      expect(r.vectors[0].delta).toBeCloseTo(-1, 6);
    });

    it("delta clamped -1..1", () => {
      const r = computeMotion([step(true, 1), step(false)]);
      expect(r.vectors[0].delta).toBeGreaterThanOrEqual(-1);
      expect(r.vectors[0].delta).toBeLessThanOrEqual(1);
    });

    it("high-variance pattern → higher acceleration than uniform", () => {
      const high = computeMotion([step(true, 0.1), step(true, 0.9), step(true, 0.2), step(true, 0.95)]);
      const low = computeMotion([step(true, 0.5), step(true, 0.55), step(true, 0.5), step(true, 0.55)]);
      expect(high.acceleration).toBeGreaterThan(low.acceleration);
    });

    it("low-variance uniform-delta → low acceleration", () => {
      const steps = [step(true, 0.2), step(true, 0.4), step(true, 0.6), step(true, 0.8)];
      const r = computeMotion(steps);
      expect(r.acceleration).toBeLessThan(0.5);
    });

    it("velocity NaN treated as 1", () => {
      const r = computeMotion([step(false), step(true, NaN)]);
      expect(r.vectors[0].delta).toBe(1);
    });

    it("velocity neg treated as 1", () => {
      const r = computeMotion([step(false), step(true, -0.5)]);
      expect(r.vectors[0].delta).toBe(1);
    });

    it("velocity >1 treated as 1", () => {
      const r = computeMotion([step(false), step(true, 5)]);
      expect(r.vectors[0].delta).toBe(1);
    });

    it("non-array input → empty result", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = computeMotion(null as any);
      expect(r.vectors).toEqual([]);
    });
  });

  describe("motionPeak", () => {
    it("empty motion → null", () => {
      expect(motionPeak({ vectors: [], overallMotion: 0, netDirection: 0, acceleration: 0 })).toBeNull();
    });

    it("finds vector with largest absolute delta", () => {
      const r = computeMotion([step(true, 0.1), step(true, 0.9), step(true, 0.2)]);
      const peak = motionPeak(r);
      expect(peak).not.toBeNull();
      expect(Math.abs(peak!.delta)).toBeGreaterThanOrEqual(Math.abs(r.vectors[1].delta));
    });

    it("returns first-found on ties", () => {
      const r = computeMotion([step(false), step(true), step(false), step(true)]);
      const peak = motionPeak(r);
      expect(peak).not.toBeNull();
      expect(peak!.fromStep).toBe(0);
    });
  });
});
