/**
 * 3-Band-EQ auf einem .all-Slot (client/src/utils/korg/korgSlotEq.ts)
 *
 * Die Biquads selbst haben eigene Tests (`sample-equalizer-3band.test.ts`).
 * Hier wird geprüft, was durch die Anbindung an den Gerätepfad dazukommt:
 * dass die Voreinstellungen tun, was ihr Name sagt, dass das interleavte
 * Slot-Format überlebt, und dass eine Übersteuerung **gemeldet** wird — die
 * Electribe hat keinen Limiter, also darf sie nicht stillschweigend passieren.
 */
import { describe, it, expect } from "vitest";
import {
  KORG_EQ_PRESETS,
  applyKorgEq,
  applyKorgEqPreset,
  describeKorgEq,
  korgEqPreset,
  type KorgEqPresetId,
} from "@/utils/korg/korgSlotEq";

const SR = 44100;
const ALL_IDS: KorgEqPresetId[] = ["mud-out", "punch", "air", "phone", "sub-cut"];

/** Mono-Sinus einer Frequenz. */
function sine(freq: number, amp = 0.3, frames = 8192): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return out;
}

/** Effektivwert der zweiten Hälfte — die erste enthält den Filter-Einschwinger. */
function rmsTail(pcm: Float32Array, stride = 1): number {
  const start = Math.floor(pcm.length / 2);
  let sum = 0;
  let n = 0;
  for (let i = start; i < pcm.length; i += stride) {
    sum += pcm[i] * pcm[i];
    n++;
  }
  return Math.sqrt(sum / Math.max(1, n));
}

describe("Preset-Katalog", () => {
  it("führt genau die fünf angekündigten Voreinstellungen", () => {
    expect(KORG_EQ_PRESETS.map(p => p.id)).toEqual(ALL_IDS);
  });

  it("erklärt jede Voreinstellung", () => {
    for (const p of KORG_EQ_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(30);
    }
  });

  it("wirft bei unbekannter Kennung", () => {
    expect(() => korgEqPreset("gibtsnicht" as KorgEqPresetId)).toThrow(RangeError);
  });
});

describe("Die Voreinstellungen tun, was ihr Name sagt", () => {
  it("'Sub weg' senkt 50 Hz deutlich und lässt 1 kHz stehen", () => {
    const low = applyKorgEqPreset(sine(50), 1, SR, "sub-cut");
    const mid = applyKorgEqPreset(sine(1000), 1, SR, "sub-cut");
    expect(rmsTail(low.pcm)).toBeLessThan(rmsTail(sine(50)) * 0.6);
    // 1 kHz bleibt praktisch unangetastet.
    expect(rmsTail(mid.pcm)).toBeGreaterThan(rmsTail(sine(1000)) * 0.9);
  });

  it("'Höhen auf' hebt 8 kHz an", () => {
    const before = rmsTail(sine(8000));
    const after = rmsTail(applyKorgEqPreset(sine(8000), 1, SR, "air").pcm);
    expect(after).toBeGreaterThan(before * 1.2);
  });

  it("'Druck' hebt 100 Hz an", () => {
    const before = rmsTail(sine(100));
    const after = rmsTail(applyKorgEqPreset(sine(100), 1, SR, "punch").pcm);
    expect(after).toBeGreaterThan(before * 1.2);
  });

  it("'Mumpf raus' senkt 300 Hz, ohne die Höhen anzufassen", () => {
    const mud = applyKorgEqPreset(sine(300), 1, SR, "mud-out");
    const top = applyKorgEqPreset(sine(8000), 1, SR, "mud-out");
    expect(rmsTail(mud.pcm)).toBeLessThan(rmsTail(sine(300)) * 0.8);
    expect(rmsTail(top.pcm)).toBeCloseTo(rmsTail(sine(8000)), 1);
  });

  it("'Telefon' nimmt unten UND oben weg", () => {
    const lo = applyKorgEqPreset(sine(80), 1, SR, "phone");
    const hi = applyKorgEqPreset(sine(10000), 1, SR, "phone");
    expect(rmsTail(lo.pcm)).toBeLessThan(rmsTail(sine(80)) * 0.5);
    expect(rmsTail(hi.pcm)).toBeLessThan(rmsTail(sine(10000)) * 0.6);
  });
});

describe("Übersteuerung wird gemeldet, nicht verschluckt", () => {
  it("markiert clipped, wenn eine Anhebung über 0 dBFS führt", () => {
    // Fast voller Pegel plus Anhebung → muss über 1.0 gehen.
    const res = applyKorgEqPreset(sine(100, 0.95), 1, SR, "punch");
    expect(res.peakAfter).toBeGreaterThan(1);
    expect(res.clipped).toBe(true);
    expect(describeKorgEq("punch", res)).toContain("Korg Match");
  });

  it("normalisiert NICHT von selbst", () => {
    // Bewusst: ein EQ, der heimlich den Pegel korrigiert, ist nicht
    // nachvollziehbar. Das Aufräumen macht 'Korg Match'.
    const res = applyKorgEqPreset(sine(100, 0.95), 1, SR, "punch");
    expect(res.peakAfter).not.toBeCloseTo(1.0, 2);
  });

  it("meldet bei einer Senkung keine Übersteuerung", () => {
    const res = applyKorgEqPreset(sine(50, 0.8), 1, SR, "sub-cut");
    expect(res.clipped).toBe(false);
    expect(res.peakAfter).toBeLessThanOrEqual(res.peakBefore + 1e-6);
  });
});

describe("Slot-Format", () => {
  it("behält Länge und Kanalzahl bei Stereo", () => {
    const frames = 4096;
    const inter = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      inter[i * 2] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR);
      inter[i * 2 + 1] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR);
    }
    const res = applyKorgEqPreset(inter, 2, SR, "air");
    expect(res.pcm.length).toBe(inter.length);
  });

  it("hält die Kanäle auseinander", () => {
    // Rechts stumm: nach dem EQ muss rechts stumm bleiben, sonst rührt die
    // Brücke die Kanäle zusammen.
    const frames = 4096;
    const inter = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      inter[i * 2] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR);
      inter[i * 2 + 1] = 0;
    }
    const res = applyKorgEqPreset(inter, 2, SR, "punch");
    let rightPeak = 0;
    for (let i = 0; i < frames; i++) {
      rightPeak = Math.max(rightPeak, Math.abs(res.pcm[i * 2 + 1]));
    }
    expect(rightPeak).toBeLessThan(1e-6);
  });

  it("verändert die Eingabe nicht", () => {
    const src = sine(440);
    const copy = Float32Array.from(src);
    applyKorgEqPreset(src, 1, SR, "phone");
    expect(Array.from(src)).toEqual(Array.from(copy));
  });

  it("lässt eine leere Eingabe unverändert durch", () => {
    const empty = new Float32Array(0);
    const res = applyKorgEqPreset(empty, 1, SR, "air");
    expect(res.pcm.length).toBe(0);
    expect(res.clipped).toBe(false);
  });

  it("erlaubt eigene Bänder statt einer Voreinstellung", () => {
    const res = applyKorgEq(sine(8000), 1, SR, { high: { freq: 6000, gainDb: 6 } });
    expect(rmsTail(res.pcm)).toBeGreaterThan(rmsTail(sine(8000)));
  });

  it("ist bei lauter Null-Anhebung praktisch unverändert", () => {
    const src = sine(1000);
    const res = applyKorgEq(src, 1, SR, {
      low: { freq: 200, gainDb: 0 },
      mid: { freq: 1000, gainDb: 0 },
      high: { freq: 5000, gainDb: 0 },
    });
    expect(rmsTail(res.pcm)).toBeCloseTo(rmsTail(src), 5);
  });
});
