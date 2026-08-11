/**
 * Synthstudio – korg-e2-pull-wertebereiche.test.ts
 *
 * Der Geräte-Pull schrieb Roh-Gerätewerte direkt in Store-Felder mit einem
 * ANDEREN Wertebereich:
 *
 *     dm.setPartPan(partId, src.pan);       // 0..127  →  Feld ist −1..+1
 *     dm.setPartVolume(partId, src.volume); // 0..127  →  Feld ist 0..1
 *
 * `setPartPan` schreibt unverändert durch. Nach einem Pull stand also in jedem
 * Part ein Pan von z. B. 100 statt 0,56 — hart rechts, und beim Push wurde
 * daraus `round(100 × 64) + 64`, begrenzt auf 127.
 *
 * Das ist die eigentliche Ursache von „der Pan ist falsch". Die Rundungs-
 * asymmetrie, die vorher gefixt wurde, war echt, aber nur ±1 — dieser Fehler
 * ist total.
 *
 * ★ Die Umrechnung gehört an EINE Stelle. Der Pull-Handler hatte seine eigene
 * (nämlich gar keine), obwohl `mapPart` im selben Repo bereits richtig rechnet.
 * Zwei Implementierungen desselben Vorgangs — dieselbe Fehlerklasse, die am
 * 2026-08-10 die Sitzung gekostet hat.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  e2PanToUnit,
  e2VolumeToUnit,
} from "../../client/src/utils/korg/e2PatternToSynthstudio";

describe("Geräte-Werte → Store-Wertebereiche", () => {
  it("bildet Pan 0..127 auf −1..+1 ab, Mitte auf 0", () => {
    expect(e2PanToUnit(64)).toBe(0);
    expect(e2PanToUnit(0)).toBe(-1);
    expect(e2PanToUnit(127)).toBeCloseTo(63 / 64, 6);
  });

  it("bildet Lautstärke 0..127 auf 0..1 ab", () => {
    expect(e2VolumeToUnit(0)).toBe(0);
    expect(e2VolumeToUnit(127)).toBe(1);
    expect(e2VolumeToUnit(64)).toBeCloseTo(64 / 127, 6);
  });

  it("fängt kaputte Gerätewerte ab, statt sie durchzureichen", () => {
    // Ein aussetzender Peek liefert schon mal Müll. Ein Pan von 300 im Store
    // wäre danach nicht mehr als Lesefehler erkennbar.
    expect(e2PanToUnit(300)).toBe(1);
    expect(e2VolumeToUnit(-5)).toBe(0);
  });
});

describe("Der Pull-Handler benutzt die Umrechnung", () => {
  const quelle = readFileSync(
    resolve(__dirname, "../../client/src/components/DrumMachine/DrumMachine.tsx"),
    "utf-8"
  );

  it("reicht den rohen Gerätewert nicht mehr direkt in den Store", () => {
    // ☠ Genau diese zwei Zeilen waren der Bug. Als Sperre formuliert, weil ein
    // Wertebereichs-Fehler im Store nicht wehtut, bis jemand am Gerät hört,
    // dass alles rechts steht.
    expect(quelle).not.toMatch(/setPartPan\(\s*partId\s*,\s*src\.pan\s*\)/);
    expect(quelle).not.toMatch(/setPartVolume\(\s*partId\s*,\s*src\.volume\s*\)/);
  });

  it("übernimmt die Schrittzahl des Geräts, statt auf die des Projekts zu kürzen", () => {
    // `const target = active.stepCount` kürzte ein 64-Step-Pattern vom Gerät
    // auf die 16 Steps des Projekts — still, ohne Meldung.
    expect(quelle).not.toMatch(/const target = active\.stepCount/);
  });
});
