/**
 * tests/features/esx-pattern-length.test.ts
 *
 * ESX-1 patternLength (Byte 11, Length_1..Length_8 = Wiederhol-Multiplikator).
 * Verifiziert gegen open-electribe-editor v1.2.0 (PatternLength EEnum, 0..7) +
 * reale .esx-Dateien (Byte 11 ∈ {0x00 → 16 Steps, 0x07 → 128 Steps}).
 *
 * Klärt die „128 vs 64"-Frage: ESX kann 8×16=128, E2S nur 4×16=64.
 */
import { describe, it, expect } from "vitest";
import { decodeEsxPatternLength } from "../../client/src/utils/korg/esxParser";

describe("decodeEsxPatternLength", () => {
  it("0x00 → Length_1 = 16 Steps (Default, 1 Bank)", () => {
    expect(decodeEsxPatternLength(0x00)).toEqual({
      length: 1,
      effectiveSteps: 16,
    });
  });

  it("0x07 → Length_8 = 128 Steps (8 Bänke — die realen 128-Step-Patterns)", () => {
    expect(decodeEsxPatternLength(0x07)).toEqual({
      length: 8,
      effectiveSteps: 128,
    });
  });

  it("alle Bank-Zahlen 1..8 → 16..128", () => {
    for (let i = 0; i < 8; i++) {
      expect(decodeEsxPatternLength(i)).toEqual({
        length: i + 1,
        effectiveSteps: (i + 1) * 16,
      });
    }
  });

  it("ignoriert höhere Bits (beat/roll im gepackten Byte 11)", () => {
    // low 3 bits = patternLength; höhere Bits (beat/roll) dürfen nicht stören.
    expect(decodeEsxPatternLength(0xf7)).toEqual({
      length: 8,
      effectiveSteps: 128,
    });
    expect(decodeEsxPatternLength(0xf8)).toEqual({
      length: 1,
      effectiveSteps: 16,
    });
  });

  it("E2S-Relevanz: Length_5..8 (>64 Steps) muss beim Konvertieren reduziert werden", () => {
    // >64 Steps → Reduktion nötig (E2S max 64).
    for (const b11 of [0x04, 0x05, 0x06, 0x07]) {
      expect(decodeEsxPatternLength(b11).effectiveSteps).toBeGreaterThan(64);
    }
    // ≤64 passt ohne Reduktion.
    for (const b11 of [0x00, 0x01, 0x02, 0x03]) {
      expect(decodeEsxPatternLength(b11).effectiveSteps).toBeLessThanOrEqual(
        64
      );
    }
  });
});
