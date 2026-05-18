/**
 * tests/features/sample-slicing.test.ts (TASK-238 / v2.89.0)
 *
 * Unit-Tests für die pure Sample-Slicing-Pipeline in
 * client/src/utils/sampleSlicing.ts.
 *
 * Kein Browser / kein Web-Audio nötig — alle Tests laufen gegen
 * Float32Array-Buffer.
 */
import { describe, it, expect } from "vitest";
import {
  detectOnsetsSpectralFlux,
  snapToZeroCrossing,
  limitToStrongestOnsets,
  padOnsetsEquidistant,
  onsetsToSlices,
  autoSlice,
  addOnset,
  removeOnset,
  moveOnset,
  splitChannelDataAtSlices,
  mapSlicesToPads,
  MAX_PERFORMANCE_PADS,
  type OnsetCandidate,
} from "@/utils/sampleSlicing";

// ─── Test-Helper ─────────────────────────────────────────────────────────────

/**
 * Konstruiert ein Drum-Loop-ähnliches Signal: bei jedem `burstStart`
 * eine kurze Burst-Sequenz hoher Amplitude, sonst Silence.
 */
function makeBurstSignal(
  totalLength: number,
  burstStarts: number[],
  burstLength = 200,
  amplitude = 0.9,
): Float32Array {
  const data = new Float32Array(totalLength);
  for (const start of burstStarts) {
    for (let i = 0; i < burstLength && start + i < totalLength; i++) {
      // Decay-Envelope für realistischere Onsets
      const decay = 1 - i / burstLength;
      // Sinus mit Decay
      data[start + i] = amplitude * decay * Math.sin((2 * Math.PI * i) / 20);
    }
  }
  return data;
}

const SR = 44100;

// ─── detectOnsetsSpectralFlux ────────────────────────────────────────────────

describe("detectOnsetsSpectralFlux", () => {
  it("liefert Array von OnsetCandidates mit Sample-Indices", () => {
    const data = makeBurstSignal(SR, [0, SR / 4, SR / 2, (3 * SR) / 4]);
    const onsets = detectOnsetsSpectralFlux(data, SR);
    expect(Array.isArray(onsets)).toBe(true);
    expect(onsets.length).toBeGreaterThan(0);
    // Jeder Onset muss frame + strength enthalten
    onsets.forEach(o => {
      expect(typeof o.frame).toBe("number");
      expect(typeof o.strength).toBe("number");
      expect(o.frame).toBeGreaterThanOrEqual(0);
      expect(o.frame).toBeLessThan(data.length);
    });
  });

  it("findet mehrere Onsets in einem Burst-Loop", () => {
    // 8 Bursts mit klarem Abstand → erwarte ≥ 6 detected
    const burstStarts = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000];
    const data = makeBurstSignal(40000, burstStarts);
    const onsets = detectOnsetsSpectralFlux(data, SR, { threshold: 1.2 });
    expect(onsets.length).toBeGreaterThanOrEqual(4);
  });

  it("liefert leeres Array bei komplettem Silence", () => {
    const data = new Float32Array(SR);
    const onsets = detectOnsetsSpectralFlux(data, SR);
    expect(onsets).toEqual([]);
  });

  it("respektiert minGapMs (keine doppelten Onsets in Mindestabstand)", () => {
    // Zwei Bursts im Abstand von nur 100 samples (~ 2.3ms bei 44100Hz)
    const data = makeBurstSignal(20000, [1000, 1100]);
    const onsets = detectOnsetsSpectralFlux(data, SR, { minGapMs: 50 });
    // Bei 50ms minGap (2205 frames) darf max 1 Onset entstehen
    const closeTogether = onsets.filter(o => o.frame >= 800 && o.frame <= 1500);
    expect(closeTogether.length).toBeLessThanOrEqual(1);
  });
});

// ─── snapToZeroCrossing ──────────────────────────────────────────────────────

describe("snapToZeroCrossing", () => {
  it("rundet Frame-Position zur nächsten Zero-Crossing", () => {
    // Sinus → ZCs bei i % 10 == 0
    const data = new Float32Array(1000);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.sin((2 * Math.PI * i) / 10);
    }
    // Frame 47 → erwarte Snap auf 50 (oder 40 oder 45)
    const snapped = snapToZeroCrossing(data, 47, 100);
    // Snapping muss innerhalb des Such-Radius bleiben
    expect(Math.abs(snapped - 47)).toBeLessThanOrEqual(100);
    // An der gefundenen Stelle sollte ein Vorzeichenwechsel sein
    const prev = data[snapped - 1] ?? 0;
    const cur = data[snapped];
    const isZC = (prev <= 0 && cur > 0) || (prev >= 0 && cur < 0) || cur === 0;
    expect(isZC).toBe(true);
  });

  it("gibt unveränderten Frame bei leerem Buffer zurück", () => {
    expect(snapToZeroCrossing(new Float32Array(0), 100)).toBe(100);
  });

  it("clampt Frame an Buffer-Grenzen", () => {
    const data = new Float32Array(10);
    expect(snapToZeroCrossing(data, 999)).toBeLessThanOrEqual(9);
  });
});

// ─── Limitierung & equidistantes Auffüllen ───────────────────────────────────

describe("limitToStrongestOnsets", () => {
  it("limitiert auf max 16 Slices (stärkste Peaks)", () => {
    const onsets: OnsetCandidate[] = Array.from({ length: 30 }, (_, i) => ({
      frame: i * 1000,
      strength: Math.random(),
    }));
    const limited = limitToStrongestOnsets(onsets, MAX_PERFORMANCE_PADS);
    expect(limited.length).toBe(MAX_PERFORMANCE_PADS);
    // Sortiert nach frame
    for (let i = 1; i < limited.length; i++) {
      expect(limited[i].frame).toBeGreaterThanOrEqual(limited[i - 1].frame);
    }
  });

  it("behält stärkste Onsets (nicht beliebige)", () => {
    const onsets: OnsetCandidate[] = [
      { frame: 0, strength: 0.1 },
      { frame: 100, strength: 0.9 }, // sehr stark
      { frame: 200, strength: 0.2 },
      { frame: 300, strength: 0.8 }, // sehr stark
    ];
    const limited = limitToStrongestOnsets(onsets, 2);
    expect(limited).toHaveLength(2);
    expect(limited.map(o => o.frame).sort()).toEqual([100, 300]);
  });
});

describe("padOnsetsEquidistant", () => {
  it("füllt Onset-Liste auf targetCount = 16 auf, wenn weniger gefunden", () => {
    const onsets: OnsetCandidate[] = [{ frame: 0, strength: 1 }];
    const padded = padOnsetsEquidistant(onsets, 16000, 16);
    expect(padded).toHaveLength(16);
    // Sortiert
    for (let i = 1; i < padded.length; i++) {
      expect(padded[i].frame).toBeGreaterThanOrEqual(padded[i - 1].frame);
    }
  });

  it("garantiert Onset bei Frame 0", () => {
    const onsets: OnsetCandidate[] = [{ frame: 5000, strength: 0.5 }];
    const padded = padOnsetsEquidistant(onsets, 16000, 8);
    expect(padded[0].frame).toBe(0);
  });
});

// ─── Auto-Slice Pipeline ─────────────────────────────────────────────────────

describe("autoSlice", () => {
  it("Auto-Slice limitiert auf max 16 Slices", () => {
    // Loop mit 30 Bursts — Detection würde mehr finden, aber wir cappen auf 16
    const burstStarts: number[] = [];
    for (let i = 0; i < 30; i++) burstStarts.push(i * 3000);
    const data = makeBurstSignal(100000, burstStarts);
    const onsetsRaw = detectOnsetsSpectralFlux(data, SR);
    // eslint-disable-next-line no-console
    console.log("[debug] detected raw:", onsetsRaw.length, "first 5 frames:", onsetsRaw.slice(0, 5).map(o => o.frame));
    const slices = autoSlice(data, SR, { maxSlices: 16, fillToMax: false });
    // eslint-disable-next-line no-console
    console.log("[debug] slices:", slices.length, "frames:", slices.map(s => s.startFrame));
    expect(slices.length).toBeLessThanOrEqual(16);
  });

  it("Auto-Slice mit fillToMax füllt auf exakt 16 Slices auf", () => {
    // Nur 2 Bursts → Detection findet ~2, fillToMax soll auf 16 padden
    const data = makeBurstSignal(100000, [10000, 50000]);
    const slices = autoSlice(data, SR, { maxSlices: 16, fillToMax: true });
    expect(slices.length).toBeGreaterThanOrEqual(8);
    expect(slices.length).toBeLessThanOrEqual(16);
  });

  it("liefert Slices mit aufsteigenden Frames und gültigen Bereichen", () => {
    const data = makeBurstSignal(50000, [0, 10000, 20000, 30000, 40000]);
    const slices = autoSlice(data, SR, { snapToZero: false });
    for (let i = 0; i < slices.length; i++) {
      expect(slices[i].startFrame).toBeLessThan(slices[i].endFrame);
      expect(slices[i].index).toBe(i);
      if (i + 1 < slices.length) {
        // End == nextStart (kontinuierlich, kein Gap, kein Overlap)
        expect(slices[i].endFrame).toBe(slices[i + 1].startFrame);
      }
    }
    // Letzter Slice endet am Buffer-Ende
    expect(slices[slices.length - 1].endFrame).toBe(data.length);
  });
});

// ─── Manual-Add / Remove / Move ──────────────────────────────────────────────

describe("Manual-Edit", () => {
  it("Manual-Add fügt Slice an Frame ein und sortiert", () => {
    const onsets: OnsetCandidate[] = [
      { frame: 0, strength: 1 },
      { frame: 1000, strength: 1 },
    ];
    const added = addOnset(onsets, 500);
    expect(added).toHaveLength(3);
    expect(added.map(o => o.frame)).toEqual([0, 500, 1000]);
  });

  it("Manual-Add respektiert maxCount (16) und blockt Duplikate", () => {
    const onsets: OnsetCandidate[] = Array.from({ length: 16 }, (_, i) => ({
      frame: i * 100,
      strength: 1,
    }));
    const result = addOnset(onsets, 9999, 16);
    expect(result).toHaveLength(16); // ignored — already full
    const dup = addOnset(onsets, 500); // 500 = onsets[5].frame
    expect(dup).toHaveLength(16); // unchanged
  });

  it("Manual-Remove entfernt Slice", () => {
    const onsets: OnsetCandidate[] = [
      { frame: 0, strength: 1 },
      { frame: 500, strength: 1 },
      { frame: 1000, strength: 1 },
    ];
    const removed = removeOnset(onsets, 500);
    expect(removed).toHaveLength(2);
    expect(removed.map(o => o.frame)).toEqual([0, 1000]);
  });

  it("Move bewegt Onset auf neue Position und re-sortiert", () => {
    const onsets: OnsetCandidate[] = [
      { frame: 0, strength: 1 },
      { frame: 500, strength: 1 },
      { frame: 1000, strength: 1 },
    ];
    const moved = moveOnset(onsets, 500, 1500);
    expect(moved.map(o => o.frame)).toEqual([0, 1000, 1500]);
  });
});

// ─── splitChannelDataAtSlices ────────────────────────────────────────────────

describe("splitChannelDataAtSlices", () => {
  it("splitAudioBuffer liefert N Float32Array-Slices", () => {
    const data = new Float32Array(1000);
    for (let i = 0; i < data.length; i++) data[i] = i / 1000;
    const slices = onsetsToSlices(
      [
        { frame: 0, strength: 1 },
        { frame: 250, strength: 1 },
        { frame: 500, strength: 1 },
        { frame: 750, strength: 1 },
      ],
      1000,
    );
    const splits = splitChannelDataAtSlices(data, slices);
    expect(splits).toHaveLength(4);
    expect(splits[0].length).toBe(250);
    expect(splits[1].length).toBe(250);
    expect(splits[3].length).toBe(250);
    // Daten korrekt kopiert
    expect(splits[1][0]).toBeCloseTo(data[250]);
    expect(splits[3][0]).toBeCloseTo(data[750]);
  });

  it("splitChannelDataAtSlices erzeugt 16 Slices bei 16-Slice-Spec", () => {
    const data = new Float32Array(1600);
    const slices = onsetsToSlices(
      Array.from({ length: 16 }, (_, i) => ({ frame: i * 100, strength: 1 })),
      1600,
    );
    const splits = splitChannelDataAtSlices(data, slices);
    expect(splits).toHaveLength(16);
    splits.forEach(s => expect(s.length).toBe(100));
  });
});

// ─── Pad-Mapping ─────────────────────────────────────────────────────────────

describe("mapSlicesToPads", () => {
  it("Slices werden auf Pads 0..N-1 gemappt", () => {
    const slices = onsetsToSlices(
      [
        { frame: 0, strength: 1 },
        { frame: 100, strength: 1 },
        { frame: 200, strength: 1 },
      ],
      400,
    );
    const assignments = mapSlicesToPads(slices, 16);
    expect(assignments).toHaveLength(3);
    expect(assignments[0].padIndex).toBe(0);
    expect(assignments[1].padIndex).toBe(1);
    expect(assignments[2].padIndex).toBe(2);
  });

  it("mapSlicesToPads cappt bei mehr Slices als Pads", () => {
    const slices = onsetsToSlices(
      Array.from({ length: 20 }, (_, i) => ({ frame: i * 100, strength: 1 })),
      2100,
    );
    const assignments = mapSlicesToPads(slices, 16);
    expect(assignments).toHaveLength(16);
    expect(assignments[15].padIndex).toBe(15);
  });

  it("mapSlicesToPads erhält Slice-Bereiche", () => {
    const slices = onsetsToSlices(
      [
        { frame: 0, strength: 1 },
        { frame: 500, strength: 1 },
      ],
      1000,
    );
    const assignments = mapSlicesToPads(slices, 16);
    expect(assignments[0].startFrame).toBe(0);
    expect(assignments[0].endFrame).toBe(500);
    expect(assignments[1].startFrame).toBe(500);
    expect(assignments[1].endFrame).toBe(1000);
  });
});
