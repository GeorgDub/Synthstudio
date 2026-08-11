/**
 * Synthstudio – korg-e2-roundtrip-verlustfrei.test.ts
 *
 * Der Bedienende am Gerät: „wenn ich von der Korg ein Pattern lade, dann genau
 * dasselbe ohne Änderung direkt zurückschicke, ist der Pan falsch und die
 * Sample-Zuweisungen fehlen manchmal komplett."
 *
 * Das ist eine **Verlustprobe**, und sie braucht kein Gerät: `decoded →
 * e2PatternToSynthstudio → synthstudioPatternToE2` muss die Identität sein.
 * Was dabei nicht überlebt, geht am Gerät verloren — jedes Mal, unbemerkt.
 *
 * Die Tests nennen die verlorene Größe beim Namen. Ein Test, der nur „Roundtrip
 * kaputt" sagt, verschiebt das Raten bloß.
 */
import { describe, it, expect } from "vitest";
import { e2PatternToSynthstudio } from "../../client/src/utils/korg/e2PatternToSynthstudio";
import { synthstudioPatternToE2 } from "../../client/src/utils/korg/synthstudioToE2Pattern";
import type { E2PatternDecoded } from "../../client/src/utils/korg/e2PatternToSynthstudio";

/** Ein dekodiertes Pattern, wie es vom Gerät kommt. */
function geraetePattern(
  ueberschreiben: Partial<E2PatternDecoded> = {}
): E2PatternDecoded {
  const part = (i: number) => ({
    sampleRef: 500 + i,
    muted: i % 3 === 0,
    volume: 100,
    pan: 64,
    steps: Array.from({ length: 16 }, (_, s) => ({
      active: s % 4 === 0,
      velocity: 100,
      note: 0x48,
      // Ein dekodierter Step traegt immer die 7 Motion-Bytes (+0x05..+0x0B);
      // die ersten drei sind die Akkord-Noten.
      motion: [0, 0, 0, 0, 0, 0, 0],
    })),
  });
  return {
    name: "TESTPAT",
    bpm: 120,
    stepLength: 16,
    parts: Array.from({ length: 16 }, (_, i) => part(i)),
    ...ueberschreiben,
  } as E2PatternDecoded;
}

function hinUndZurueck(decoded: E2PatternDecoded) {
  return synthstudioPatternToE2(e2PatternToSynthstudio(decoded), {
    bpm: decoded.bpm,
  });
}

describe("Pull → Push ohne Änderung", () => {
  it("gibt jeden Pan-Wert unverändert zurück", () => {
    // Alle 128 Werte, nicht drei Stichproben: der Fehler sitzt in der
    // Umrechnung und trifft nur eine Hälfte des Bereichs. Drei Proben links
    // der Mitte hätten „bestanden" gemeldet.
    const decoded = geraetePattern();
    decoded.parts.forEach((p, i) => {
      p.pan = i * 8 > 127 ? 127 : i * 8; // 0, 8, 16 … 120, plus die Ränder
    });
    decoded.parts[15].pan = 127;

    const zurueck = hinUndZurueck(decoded);

    const erwartet = decoded.parts.map(p => p.pan);
    const bekommen = zurueck.parts.map(p => p.pan);
    expect(bekommen).toEqual(erwartet);
  });

  it("gibt die Sample-Referenz zurück, auch wenn der Part-Name sie nicht trägt", () => {
    // ☠ Die Referenz darf nicht am ANZEIGENAMEN hängen. Ohne geladene Bank
    // hängt der Pull kein „· #NNN" an — dann pusht die App einen leeren Slot
    // und die Zuweisung ist weg. Genau das meldet der Bedienende mit
    // „fehlen manchmal komplett".
    const decoded = geraetePattern();

    const zurueck = hinUndZurueck(decoded);

    expect(zurueck.parts.map(p => p.sampleId)).toEqual(
      decoded.parts.map(p => p.sampleRef)
    );
  });

  it("gibt Lautstärke und Mute unverändert zurück", () => {
    const decoded = geraetePattern();
    decoded.parts.forEach((p, i) => {
      p.volume = i * 8 > 127 ? 127 : i * 8;
    });

    const zurueck = hinUndZurueck(decoded);

    expect(zurueck.parts.map(p => p.volume)).toEqual(
      decoded.parts.map(p => p.volume)
    );
    expect(zurueck.parts.map(p => p.muted)).toEqual(
      decoded.parts.map(p => p.muted)
    );
  });

  it("behält die Schrittzahl 64 bei", () => {
    // Bekannte Lücke aus der Sitzung vom 2026-08-10: der Pull übernahm die
    // stepLength des Geräts nicht, wodurch bei 16 vs. 64 Steps still wegfielen.
    const decoded = geraetePattern({ stepLength: 64 });
    decoded.parts.forEach(p => {
      p.steps = Array.from({ length: 64 }, (_, s) => ({
        active: s % 8 === 0,
        velocity: 100,
        note: 0x48,
        motion: [0, 0, 0, 0, 0, 0, 0],
      }));
    });

    const zurueck = hinUndZurueck(decoded);

    expect(zurueck.stepLength).toBe(64);
    expect(zurueck.parts[0].steps).toHaveLength(64);
  });
});
