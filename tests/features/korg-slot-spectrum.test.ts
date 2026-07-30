/**
 * Klangprofil eines .all-Slots (client/src/utils/korg/korgSlotSpectrum.ts)
 *
 * Die Goertzel-Auswertung hat eigene Tests. Hier geht es um die Schicht
 * darüber: trifft das gemeldete Schwerpunkt-Band die tatsächlich vorhandene
 * Frequenz, und ist die EQ-Empfehlung zurückhaltend genug, um noch etwas zu
 * bedeuten? Ein Hinweis, der bei jedem zweiten Sample erscheint, wird ignoriert
 * und ist damit wertlos.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeSlotSpectrum,
  describeSlotSpectrum,
} from "@/utils/korg/korgSlotSpectrum";

const SR = 44100;
const FRAMES = 8192;

/** Mono-Sinus, interleaved-kompatibel (bei 1 Kanal identisch). */
function tone(freq: number, amp = 0.5, frames = FRAMES): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  return out;
}

/** Summe mehrerer Sinus. */
function mix(parts: Array<[freq: number, amp: number]>, frames = FRAMES): Float32Array {
  const out = new Float32Array(frames);
  for (const [f, a] of parts) {
    for (let i = 0; i < frames; i++) out[i] += a * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return out;
}

describe("Schwerpunkt-Erkennung", () => {
  it("findet das Band, in dem der Ton tatsächlich liegt", () => {
    for (const hz of [60, 100, 440, 3520]) {
      const spec = analyzeSlotSpectrum(tone(hz), 1, SR);
      expect(spec.dominant?.frequencyHz).toBe(hz);
    }
  });

  it("liefert für jedes der sieben Bänder einen Eintrag mit Namen", () => {
    const spec = analyzeSlotSpectrum(tone(440), 1, SR);
    expect(spec.bands).toHaveLength(7);
    expect(spec.bands.map(b => b.frequencyHz)).toEqual([60, 100, 200, 440, 880, 1760, 3520]);
    for (const b of spec.bands) expect(b.label.length).toBeGreaterThan(0);
  });

  it("normalisiert die Anzeige auf das stärkste Band", () => {
    const spec = analyzeSlotSpectrum(tone(440), 1, SR);
    const dom = spec.bands.find(b => b.frequencyHz === 440)!;
    expect(dom.relative).toBeCloseTo(1, 5);
    for (const b of spec.bands) {
      expect(b.relative).toBeGreaterThanOrEqual(0);
      expect(b.relative).toBeLessThanOrEqual(1);
    }
  });

  it("gibt bei Stille keinen Schwerpunkt und keinen Hinweis aus", () => {
    // Eine Empfehlung auf Grundlage von Rauschen wäre schlimmer als keine.
    const spec = analyzeSlotSpectrum(new Float32Array(FRAMES), 1, SR);
    expect(spec.dominant).toBeNull();
    expect(spec.hint).toBeNull();
    expect(describeSlotSpectrum(spec)).toContain("zu leise");
  });

  it("verträgt leere Eingaben und unsinnige Abtastraten", () => {
    expect(analyzeSlotSpectrum(new Float32Array(0), 1, SR).bands).toEqual([]);
    expect(analyzeSlotSpectrum(tone(440), 1, 0).bands).toEqual([]);
    expect(analyzeSlotSpectrum(tone(440), 1, Number.NaN).bands).toEqual([]);
  });

  it("wertet Stereo aus, ohne zu werfen", () => {
    const frames = 4096;
    const inter = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      inter[i * 2] = 0.4 * Math.sin((2 * Math.PI * 100 * i) / SR);
      inter[i * 2 + 1] = 0.4 * Math.sin((2 * Math.PI * 100 * i) / SR);
    }
    expect(analyzeSlotSpectrum(inter, 2, SR).dominant?.frequencyHz).toBe(100);
  });

  it("verändert die Eingabe nicht", () => {
    const src = tone(440);
    const copy = Float32Array.from(src);
    analyzeSlotSpectrum(src, 1, SR);
    expect(Array.from(src)).toEqual(Array.from(copy));
  });
});

describe("EQ-Empfehlung", () => {
  it("schlägt bei dumpfem Material 'Höhen auf' vor", () => {
    // Nur tiefe/mittlere Anteile, oben praktisch nichts — die Signatur von
    // Material, das heruntergerechnet wurde.
    const spec = analyzeSlotSpectrum(mix([[200, 0.3], [440, 0.5]]), 1, SR);
    expect(spec.hint?.preset).toBe("air");
    expect(spec.hint?.reason.length).toBeGreaterThan(10);
  });

  it("schlägt bei Schwerpunkt in der Tief-Mitte 'Mumpf raus' vor", () => {
    const spec = analyzeSlotSpectrum(mix([[200, 0.6], [1760, 0.2], [3520, 0.12]]), 1, SR);
    expect(spec.hint?.preset).toBe("mud-out");
  });

  it("schlägt bei reiner Sub-Energie 'Sub weg' vor", () => {
    const spec = analyzeSlotSpectrum(mix([[60, 0.6], [100, 0.2]]), 1, SR);
    expect(spec.hint?.preset).toBe("sub-cut");
  });

  it("hält sich bei ausgewogenem Material zurück", () => {
    // Der wichtigste Fall: ein Hinweis bei JEDEM Sample wäre wertlos.
    const spec = analyzeSlotSpectrum(
      mix([[60, 0.3], [200, 0.3], [880, 0.3], [3520, 0.3]]),
      1,
      SR,
    );
    expect(spec.hint).toBeNull();
  });

  it("nennt immer eine Begründung, wenn es einen Hinweis gibt", () => {
    // Ohne Grund waere die Empfehlung nicht ueberpruefbar.
    for (const pcm of [
      mix([[200, 0.6], [1760, 0.2], [3520, 0.12]]),
      mix([[60, 0.6], [100, 0.2]]),
      mix([[200, 0.3], [440, 0.5]]),
    ]) {
      const spec = analyzeSlotSpectrum(pcm, 1, SR);
      if (spec.hint) {
        // Ein ganzer Satz, kein Stichwort — die Begründung soll erklären.
        expect(spec.hint.reason.length).toBeGreaterThan(20);
        expect(spec.hint.reason.trim().split(/\s+/).length).toBeGreaterThan(3);
      }
    }
  });

  it("beschreibt Schwerpunkt und Hinweis in einem Satz", () => {
    const text = describeSlotSpectrum(analyzeSlotSpectrum(mix([[60, 0.6], [100, 0.2]]), 1, SR));
    expect(text).toContain("Schwerpunkt");
    expect(text).toContain("Sub");
  });
});
