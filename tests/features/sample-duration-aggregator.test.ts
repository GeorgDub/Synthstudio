// @vitest-environment node
/**
 * sample-duration-aggregator.test.ts (v3.162.0)
 *
 * Pure-Unit-Tests für aggregateSampleDuration + formatDuration.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateSampleDuration,
  formatDuration,
  type DurationCandidate,
} from "@/utils/sampleDurationAggregator";

describe("sampleDurationAggregator", () => {
  describe("aggregateSampleDuration", () => {
    it("leeres Array → totalSec=0, knownCount=0, unknownCount=0", () => {
      const r = aggregateSampleDuration([]);
      expect(r.totalSec).toBe(0);
      expect(r.knownCount).toBe(0);
      expect(r.unknownCount).toBe(0);
    });

    it("durationSec hat Priorität vor buffer", () => {
      const samples: DurationCandidate[] = [
        {
          durationSec: 5,
          buffer: { length: 96000, sampleRate: 48000 }, // wäre 2s
        },
      ];
      const r = aggregateSampleDuration(samples);
      expect(r.totalSec).toBe(5);
      expect(r.knownCount).toBe(1);
      expect(r.unknownCount).toBe(0);
    });

    it("buffer berechnet aus length/sampleRate", () => {
      const samples: DurationCandidate[] = [
        { buffer: { length: 96000, sampleRate: 48000 } }, // 2s
        { buffer: { length: 22050, sampleRate: 44100 } }, // 0.5s
      ];
      const r = aggregateSampleDuration(samples);
      expect(r.totalSec).toBeCloseTo(2.5, 6);
      expect(r.knownCount).toBe(2);
      expect(r.unknownCount).toBe(0);
    });

    it("sizeBytes-Fallback (custom sampleRate)", () => {
      // sampleRate=44100, stereo 16-bit → 176400 Bytes/Sek
      // 176400 + 44 Header = 176444 Bytes → 1s
      const samples: DurationCandidate[] = [
        { sizeBytes: 176444, sampleRate: 44100 },
      ];
      const r = aggregateSampleDuration(samples);
      expect(r.totalSec).toBeCloseTo(1, 4);
      expect(r.knownCount).toBe(1);
      expect(r.unknownCount).toBe(0);
    });

    it("sizeBytes-Fallback verwendet default sampleRate 48000", () => {
      // 48000 * 4 = 192000 Bytes/Sek
      // 192000 + 44 = 192044 Bytes → 1s
      const samples: DurationCandidate[] = [{ sizeBytes: 192044 }];
      const r = aggregateSampleDuration(samples);
      expect(r.totalSec).toBeCloseTo(1, 4);
      expect(r.knownCount).toBe(1);
    });

    it("unknown wenn keine source verfügbar", () => {
      const samples: DurationCandidate[] = [{}, {}];
      const r = aggregateSampleDuration(samples);
      expect(r.totalSec).toBe(0);
      expect(r.knownCount).toBe(0);
      expect(r.unknownCount).toBe(2);
    });

    it("knownCount + unknownCount summieren auf samples.length", () => {
      const samples: DurationCandidate[] = [
        { durationSec: 1 },
        { buffer: { length: 48000, sampleRate: 48000 } },
        {}, // unknown
        { sizeBytes: 192044 }, // ~1s
        { durationSec: NaN }, // invalid → unknown
      ];
      const r = aggregateSampleDuration(samples);
      expect(r.knownCount + r.unknownCount).toBe(samples.length);
      expect(r.knownCount).toBe(3);
      expect(r.unknownCount).toBe(2);
    });

    it("Priorität: durationSec > buffer > sizeBytes", () => {
      const samples: DurationCandidate[] = [
        {
          durationSec: 10,
          buffer: { length: 48000, sampleRate: 48000 }, // 1s
          sizeBytes: 192044, // 1s
        },
      ];
      const r = aggregateSampleDuration(samples);
      expect(r.totalSec).toBe(10);
    });

    it("Priorität: buffer > sizeBytes wenn durationSec fehlt", () => {
      const samples: DurationCandidate[] = [
        {
          buffer: { length: 96000, sampleRate: 48000 }, // 2s
          sizeBytes: 192044, // 1s
        },
      ];
      const r = aggregateSampleDuration(samples);
      expect(r.totalSec).toBeCloseTo(2, 6);
    });

    it("durationSec=0 ist valid (knownCount++)", () => {
      const samples: DurationCandidate[] = [{ durationSec: 0 }];
      const r = aggregateSampleDuration(samples);
      expect(r.totalSec).toBe(0);
      expect(r.knownCount).toBe(1);
      expect(r.unknownCount).toBe(0);
    });

    it("negative durationSec → unknown", () => {
      const samples: DurationCandidate[] = [{ durationSec: -5 }];
      const r = aggregateSampleDuration(samples);
      expect(r.knownCount).toBe(0);
      expect(r.unknownCount).toBe(1);
    });

    it("sizeBytes < 44 → totalSec bleibt 0 (Math.max-Clamp)", () => {
      const samples: DurationCandidate[] = [{ sizeBytes: 20 }];
      const r = aggregateSampleDuration(samples);
      expect(r.totalSec).toBe(0);
      expect(r.knownCount).toBe(1); // sizeBytes ist gesetzt → known, aber 0s
    });
  });

  describe("formatDuration", () => {
    it("0 → '0:00'", () => {
      expect(formatDuration(0)).toBe("0:00");
    });

    it("90 → '1:30'", () => {
      expect(formatDuration(90)).toBe("1:30");
    });

    it("3661 → '1:01:01'", () => {
      expect(formatDuration(3661)).toBe("1:01:01");
    });

    it("NaN → '0:00'", () => {
      expect(formatDuration(NaN)).toBe("0:00");
    });

    it("Infinity → '0:00'", () => {
      expect(formatDuration(Infinity)).toBe("0:00");
    });

    it("negative → '0:00'", () => {
      expect(formatDuration(-5)).toBe("0:00");
    });

    it("floor: 90.7 → '1:30'", () => {
      expect(formatDuration(90.7)).toBe("1:30");
    });

    it("padding bei < 1h: 5 → '0:05'", () => {
      expect(formatDuration(5)).toBe("0:05");
    });

    it("padding bei < 1h: 65 → '1:05'", () => {
      expect(formatDuration(65)).toBe("1:05");
    });

    it("exactly 1h: 3600 → '1:00:00'", () => {
      expect(formatDuration(3600)).toBe("1:00:00");
    });

    it("ungerade Stunden + Padding: 7325 → '2:02:05'", () => {
      // 7325 = 2*3600 + 2*60 + 5
      expect(formatDuration(7325)).toBe("2:02:05");
    });
  });
});
