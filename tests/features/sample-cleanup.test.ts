/**
 * tests/features/sample-cleanup.test.ts — v3.300.0
 *
 * Spec: client/src/utils/sampleCleanup.ts
 *
 * Geprüft wird die Verkettung, nicht die einzelnen DSP-Bausteine — die haben
 * eigene Suiten (sample-noise-gate, sample-noise-reduction, sample-high-pass …).
 * Interessant ist hier: Reihenfolge, Abschaltbarkeit, Reinheit, und die
 * Randfälle, in denen ein naiv gebauter Cleanup Material zerstört.
 */

import { describe, it, expect } from "vitest";
import {
  CLEANUP_DEFAULTS,
  CLEANUP_PRESETS,
  applyEdgeFades,
  cleanupSample,
  computeDcOffset,
  describeCleanup,
  findContentBounds,
  normalizePeak,
  peakOf,
  removeDcOffset,
} from "../../client/src/utils/sampleCleanup";

const SR = 44100;

function sine(frames: number, freq = 440, amp = 0.5, sr = SR): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sr) * amp;
  return out;
}

/** Stille — Nutzsignal — Stille. */
function padded(signal: Float32Array, padFrames: number): Float32Array {
  const out = new Float32Array(signal.length + padFrames * 2);
  out.set(signal, padFrames);
  return out;
}

// ─── Einzelschritte ──────────────────────────────────────────────────────────

describe("computeDcOffset / removeDcOffset", () => {
  it("misst den Gleichanteil eines konstant verschobenen Signals", () => {
    const pcm = new Float32Array(1000).fill(0.25);
    expect(computeDcOffset(pcm)).toBeCloseTo(0.25, 6);
  });

  it("zieht ihn ab und lässt die Wellenform sonst in Ruhe", () => {
    // GANZE Perioden (100 Hz bei 44100 = 441 Frames, 4410 = exakt 10 Zyklen).
    // Bei einem Bruchteil einer Periode hat schon der Sinus selbst einen
    // Mittelwert ungleich 0 — der Test würde dann die eigene Wahl der
    // Frame-Zahl messen statt den Gleichanteil.
    const clean = sine(4410, 100);
    const shifted = new Float32Array(clean.length);
    for (let i = 0; i < clean.length; i++) shifted[i] = clean[i] + 0.3;

    const { pcm, offset } = removeDcOffset(shifted);
    expect(offset).toBeCloseTo(0.3, 3);
    expect(computeDcOffset(pcm)).toBeCloseTo(0, 6);
    for (let i = 0; i < clean.length; i += 64) {
      expect(pcm[i]).toBeCloseTo(clean[i], 3);
    }
  });

  it("verändert die Eingabe nicht", () => {
    const src = new Float32Array([1, 1, 1, 1]);
    removeDcOffset(src);
    expect(Array.from(src)).toEqual([1, 1, 1, 1]);
  });

  it("kommt mit einem leeren Signal klar", () => {
    expect(computeDcOffset(new Float32Array(0))).toBe(0);
    expect(removeDcOffset(new Float32Array(0)).pcm).toHaveLength(0);
  });
});

describe("normalizePeak", () => {
  it("zieht auf den Zielpegel", () => {
    const out = normalizePeak(sine(1000, 440, 0.1), 0.95);
    expect(peakOf(out)).toBeCloseTo(0.95, 2);
  });

  it("dämpft auch nach unten", () => {
    const loud = new Float32Array([1, -1, 0.8]);
    expect(peakOf(normalizePeak(loud, 0.5))).toBeCloseTo(0.5, 5);
  });

  it("lässt Stille still — sonst wäre nur der Rauschteppich lauter", () => {
    const silence = new Float32Array(500);
    expect(peakOf(normalizePeak(silence, 0.95))).toBe(0);
  });
});

describe("findContentBounds", () => {
  it("findet Anfang und Ende des Nutzsignals", () => {
    const b = findContentBounds(padded(sine(1000, 440, 0.5), 2000), -40);
    expect(b).not.toBeNull();
    expect(b!.start).toBeGreaterThanOrEqual(2000);
    expect(b!.end).toBeLessThanOrEqual(3000);
  });

  it("meldet null, wenn ALLES unter der Schwelle liegt", () => {
    // Der Aufrufer darf dann nicht trimmen — sonst bliebe nichts übrig.
    expect(findContentBounds(new Float32Array(500).fill(0.0001), -40)).toBeNull();
  });
});

describe("applyEdgeFades", () => {
  it("blendet an beiden Rändern", () => {
    const out = applyEdgeFades(new Float32Array(4410).fill(1), SR, 10);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBeLessThan(0.1);
    expect(out[2205]).toBeCloseTo(1, 5);
  });

  it("überlappt bei sehr kurzem Signal nicht", () => {
    // 100 ms Fade auf einem 10-Frame-Sample: ohne Deckelung wäre die Mitte
    // leiser als die Ränder.
    const out = applyEdgeFades(new Float32Array(10).fill(1), SR, 100);
    expect(out).toHaveLength(10);
    expect(Math.max(...Array.from(out))).toBeGreaterThan(0);
  });

  it("ist bei fadeMs=0 eine reine Kopie", () => {
    const src = new Float32Array([1, 1, 1]);
    expect(Array.from(applyEdgeFades(src, SR, 0))).toEqual([1, 1, 1]);
  });
});

// ─── Pipeline ────────────────────────────────────────────────────────────────

describe("cleanupSample", () => {
  it("ohne Optionen eine reine Kopie", () => {
    const src = sine(1000);
    const { pcm, report } = cleanupSample(src, SR, {});
    expect(Array.from(pcm)).toEqual(Array.from(src));
    expect(report.applied).toEqual([]);
    expect(report.framesAfter).toBe(report.framesBefore);
  });

  it("verändert die Eingabe nie", () => {
    const src = sine(1000, 440, 0.2);
    const before = Array.from(src);
    cleanupSample(src, SR, { ...CLEANUP_DEFAULTS, trimSilenceDb: -50 });
    expect(Array.from(src)).toEqual(before);
  });

  it("entfernt Gleichanteil und normalisiert in einem Durchgang", () => {
    const shifted = new Float32Array(4096);
    const base = sine(4096, 440, 0.1);
    for (let i = 0; i < base.length; i++) shifted[i] = base[i] + 0.4;

    const { pcm, report } = cleanupSample(shifted, SR, {
      removeDcOffset: true,
      normalizePeak: 0.9,
    });
    expect(report.dcOffset).toBeCloseTo(0.4, 2);
    expect(computeDcOffset(pcm)).toBeCloseTo(0, 3);
    expect(peakOf(pcm)).toBeCloseTo(0.9, 2);
  });

  it("trimmt die Stille an den Rändern und meldet wie viel", () => {
    const { pcm, report } = cleanupSample(padded(sine(2000, 440, 0.5), 5000), SR, {
      trimSilenceDb: -50,
    });
    expect(report.trimmedStart).toBeGreaterThan(0);
    expect(report.trimmedEnd).toBeGreaterThan(0);
    expect(pcm.length).toBeLessThan(12000);
    expect(report.framesAfter).toBe(pcm.length);
  });

  it("trimmt NICHT, wenn das ganze Sample unter der Schwelle liegt", () => {
    // Lieber ein zu langes Sample als ein leeres.
    const quiet = new Float32Array(1000).fill(0.0005);
    const { pcm, report } = cleanupSample(quiet, SR, { trimSilenceDb: -40 });
    expect(pcm).toHaveLength(1000);
    expect(report.trimmedStart).toBe(0);
    expect(report.trimmedEnd).toBe(0);
  });

  it("normalisiert VOR dem Trimmen — sonst hinge die Schwelle am alten Pegel", () => {
    // Sehr leises Signal mit Stille drumherum: erst durch die Normalisierung
    // kommt es über die Trim-Schwelle von -50 dB.
    const quiet = padded(sine(2000, 440, 0.004), 4000);
    const { report } = cleanupSample(quiet, SR, {
      normalizePeak: 0.95,
      trimSilenceDb: -50,
    });
    expect(report.trimmedStart).toBeGreaterThan(0);
  });

  it("führt die Schritte in dokumentierter Reihenfolge auf", () => {
    const { report } = cleanupSample(padded(sine(2000), 3000), SR, {
      removeDcOffset: true,
      highPassHz: 30,
      lowPassHz: 15000,
      normalizePeak: 0.95,
      trimSilenceDb: -50,
      fadeMs: 2,
    });
    const order = report.applied.map(s => s.split(" ")[0]);
    expect(order[0]).toBe("DC-Offset");
    expect(order.indexOf("Hochpass")).toBeLessThan(order.indexOf("Tiefpass"));
    expect(order.indexOf("Normalisiert")).toBeLessThan(order.indexOf("Stille"));
    expect(order[order.length - 1]).toBe("Fades");
  });

  it("lässt einzelne Schritte weg, wenn sie aus sind", () => {
    const { report } = cleanupSample(sine(2000), SR, { removeDcOffset: true });
    expect(report.applied).toEqual(["DC-Offset"]);
  });

  it("behandelt ein leeres Sample ohne zu werfen", () => {
    const { pcm, report } = cleanupSample(new Float32Array(0), SR, CLEANUP_DEFAULTS);
    expect(pcm).toHaveLength(0);
    expect(report.framesBefore).toBe(0);
    expect(report.peakAfter).toBe(0);
  });

  it("fängt eine unsinnige Sample-Rate ab", () => {
    const { pcm } = cleanupSample(sine(1000), 0, { highPassHz: 30, fadeMs: 1 });
    expect(pcm).toHaveLength(1000);
    expect(pcm.every(v => Number.isFinite(v))).toBe(true);
  });

  it("liefert nur endliche Werte im Bereich [-1,1]", () => {
    const harsh = new Float32Array(4096);
    for (let i = 0; i < harsh.length; i++) harsh[i] = (Math.random() * 2 - 1) * 1.5;
    const { pcm } = cleanupSample(harsh, SR, {
      removeDcOffset: true,
      highPassHz: 50,
      lowPassHz: 12000,
      noiseReduction: 0.4,
      gateThresholdDb: -40,
      normalizePeak: 0.95,
      fadeMs: 2,
    });
    expect(pcm.every(v => Number.isFinite(v) && v >= -1 && v <= 1)).toBe(true);
  });
});

describe("Presets und Report-Text", () => {
  it("CLEANUP_DEFAULTS enthält kein Gate und keine Rauschminderung", () => {
    // Beide können Material beschädigen — sie gehören dem Nutzer in die Hand,
    // nicht in einen Default.
    expect(CLEANUP_DEFAULTS.gateThresholdDb).toBeUndefined();
    expect(CLEANUP_DEFAULTS.noiseReduction).toBeUndefined();
  });

  it("das 'Aus'-Preset ist wirklich leer", () => {
    const none = CLEANUP_PRESETS.find(p => p.id === "none");
    expect(none?.options).toEqual({});
  });

  it("jedes Preset hat eine eindeutige id und einen Namen", () => {
    const ids = CLEANUP_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CLEANUP_PRESETS.every(p => p.name.length > 0)).toBe(true);
  });

  it("jedes Preset läuft ohne Fehler durch", () => {
    for (const preset of CLEANUP_PRESETS) {
      const { pcm } = cleanupSample(padded(sine(4000), 2000), SR, preset.options);
      expect(pcm.every(v => Number.isFinite(v))).toBe(true);
    }
  });

  it("describeCleanup meldet Leerlauf als solchen", () => {
    const { report } = cleanupSample(sine(100), SR, {});
    expect(describeCleanup(report)).toBe("Keine Bearbeitung");
  });

  it("describeCleanup nennt die Längenänderung", () => {
    const { report } = cleanupSample(padded(sine(2000, 440, 0.5), 6000), SR, {
      trimSilenceDb: -50,
    });
    expect(describeCleanup(report)).toMatch(/% kürzer/);
  });
});
