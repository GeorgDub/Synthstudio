/**
 * euclidean.test.ts
 *
 * Tests für den Bjorklund-Algorithmus (client/src/utils/euclidean.ts)
 * Phase 2 – Euclidean Rhythm Generator
 */
import { describe, it, expect } from "vitest";
import { euclidean } from "../../client/src/utils/euclidean";

describe("euclidean() – Bjorklund-Algorithmus", () => {
  it("e(3,8) → klassisches Clave-Pattern [T,F,F,T,F,F,T,F]", () => {
    const result = euclidean(3, 8, 0);
    expect(result).toEqual([true, false, false, true, false, false, true, false]);
  });

  it("e(4,4) → alle Steps aktiv", () => {
    const result = euclidean(4, 4, 0);
    expect(result).toEqual([true, true, true, true]);
  });

  it("e(0,8) → alle Steps inaktiv", () => {
    const result = euclidean(0, 8, 0);
    expect(result).toEqual(Array(8).fill(false));
  });

  it("e(8,8) → alle Steps aktiv", () => {
    const result = euclidean(8, 8, 0);
    expect(result).toEqual(Array(8).fill(true));
  });

  it("e(1,4) → [T,F,F,F]", () => {
    const result = euclidean(1, 4, 0);
    expect(result).toEqual([true, false, false, false]);
  });

  it("e(2,4) → [T,F,T,F]", () => {
    const result = euclidean(2, 4, 0);
    expect(result).toEqual([true, false, true, false]);
  });

  it("e(3,8,1) → Rotation verschiebt Pattern um 1 nach rechts", () => {
    const base = euclidean(3, 8, 0);
    const rotated = euclidean(3, 8, 1);
    // Rotation 1: letztes Element wird erstes
    expect(rotated).toEqual([base[1], base[2], base[3], base[4], base[5], base[6], base[7], base[0]]);
  });

  it("e(3,8,-1) → negative Rotation ist möglich", () => {
    const base = euclidean(3, 8, 0);
    const rotated = euclidean(3, 8, -1);
    // Rotation -1 entspricht Rotation +7 (steps-1)
    expect(rotated).toEqual(euclidean(3, 8, 7));
    expect(rotated.length).toBe(8);
  });

  it("steps=0 → leeres Array zurück", () => {
    expect(euclidean(3, 0, 0)).toEqual([]);
  });

  it("hits > steps → wird auf steps geclampt", () => {
    const result = euclidean(10, 4, 0);
    expect(result).toEqual([true, true, true, true]);
    expect(result.length).toBe(4);
  });
});
