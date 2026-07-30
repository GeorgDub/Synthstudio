/**
 * Kapazitätsbewertung einer .all-Bank gegen das Gerätelimit.
 *
 * Warum das eigene Tests hat, obwohl es „nur" ein Vergleich ist: die Zahl
 * existierte schon lange im Builder, erreichte den Nutzer aber nur über
 * `console.warn`. Der Fehler war also keine falsche Rechnung, sondern eine
 * unsichtbare — genau deshalb wird hier die *Aussage* geprüft, nicht bloß der
 * Schwellwert.
 */
import { describe, it, expect } from "vitest";
import {
  E2S_CAPACITY_TIGHT_RATIO,
  assessE2sCapacity,
  describeE2sCapacity,
} from "@/utils/korg/e2sCapacity";
import { E2S_DEVICE_PCM_WARN_BYTES } from "@/utils/korg/constants";

const MiB = 1024 * 1024;

describe("assessE2sCapacity", () => {
  it("nimmt standardmäßig das Gerätelimit aus constants", () => {
    const cap = assessE2sCapacity(1 * MiB);
    expect(cap.limitBytes).toBe(E2S_DEVICE_PCM_WARN_BYTES);
    expect(cap.limitBytes).toBe(24 * MiB);
  });

  it("meldet ok, solange deutlich Luft ist", () => {
    const cap = assessE2sCapacity(12 * MiB);
    expect(cap.level).toBe("ok");
    expect(cap.ratio).toBeCloseTo(0.5, 5);
    expect(cap.freeBytes).toBe(12 * MiB);
  });

  it("warnt vor dem Reißen, nicht erst danach", () => {
    // 90 % ist die Vorwarnstufe: eine Bank, die fast voll ist, verträgt kein
    // weiteres Sample mehr — das soll man sehen, bevor man exportiert.
    const cap = assessE2sCapacity(E2S_CAPACITY_TIGHT_RATIO * 24 * MiB);
    expect(cap.level).toBe("tight");
  });

  it("meldet over, sobald das Limit überschritten ist", () => {
    const cap = assessE2sCapacity(24 * MiB + 1);
    expect(cap.level).toBe("over");
    expect(cap.freeBytes).toBe(0);
    expect(cap.ratio).toBeGreaterThan(1);
  });

  it("zieht die Grenze bei genau vollem Speicher noch nicht", () => {
    // Genau 24 MiB ist laut Bestandsmessung erreichbar (größte reale Bank
    // 24.037.610 B lag knapp darunter) — exakt am Limit gilt als tight, nicht
    // als kaputt, sonst melden wir Bänke als unbrauchbar, die es nicht sind.
    const cap = assessE2sCapacity(24 * MiB);
    expect(cap.level).toBe("tight");
    expect(cap.freeBytes).toBe(0);
  });

  it("behandelt leere und unsinnige Eingaben ohne NaN", () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const cap = assessE2sCapacity(v);
      expect(Number.isNaN(cap.ratio)).toBe(false);
      expect(cap.usedBytes).toBeGreaterThanOrEqual(0);
    }
    expect(assessE2sCapacity(0).level).toBe("ok");
  });

  it("akzeptiert ein abweichendes Limit (nicht an die Konstante genagelt)", () => {
    const cap = assessE2sCapacity(5 * MiB, 4 * MiB);
    expect(cap.level).toBe("over");
    expect(cap.limitBytes).toBe(4 * MiB);
  });
});

describe("describeE2sCapacity", () => {
  it("sagt bei Überschreitung, was das Gerät tut — nicht nur Zahlen", () => {
    const text = describeE2sCapacity(assessE2sCapacity(30 * MiB));
    expect(text).toContain("30.0 MB");
    expect(text).toContain("24.0 MB");
    // Die eigentliche Information: die Bank ist am Gerät unbrauchbar.
    expect(text).toMatch(/lädt diese Bank nicht/);
  });

  it("nennt im Normalfall den freien Rest", () => {
    const text = describeE2sCapacity(assessE2sCapacity(4 * MiB));
    expect(text).toContain("20.0 MB frei");
  });

  it("nennt bei knappem Stand den Prozentwert", () => {
    const text = describeE2sCapacity(assessE2sCapacity(23 * MiB));
    expect(text).toContain("knapp");
    expect(text).toMatch(/9[0-9] %/);
  });
});
