/**
 * Synthstudio – korg-import-part-truncation.test.ts (v3.319.0)
 *
 * Meta-Gate gegen eine Fehlerklasse, die zweimal zugeschlagen hat.
 *
 * Ein Korg-Pattern bringt seine Part-Zahl mit (E2/E2S: immer 16). Ein
 * Synthstudio-Projekt hat, was es hat (Default: 9 Kanäle). Wer beim Import
 * `Math.min(<Quelle>, pattern.parts.length)` schreibt, wirft die überzähligen
 * Parts **still** weg — kein Toast, keine Meldung, im Raster fehlen sie einfach.
 *
 * Genau das ist am 2026-08-10 am Gerät passiert, und zwar an ZWEI unabhängigen
 * Stellen derselben Datei:
 *   - `applyE2DecodedToActivePattern`  (Buttons „⇧/⇩ Gerät")
 *   - `importElectribePatternIntoActive` (Button „⬇ Von Korg" + Datei-Import)
 *
 * Die erste wurde gefixt, die zweite fiel demselben Fehler danach erneut zum
 * Opfer — der User drückte den anderen Button. Ein Test auf die einzelne
 * Fundstelle hätte das nicht verhindert; dieser hier deckt die Datei ab.
 *
 * Richtig ist: `dm.ensureParts(<Quell-Part-Zahl>)` und über die Quelle
 * iterieren.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HIER = dirname(fileURLToPath(import.meta.url));
const DRUM_MACHINE = join(
  HIER,
  "..",
  "..",
  "client",
  "src",
  "components",
  "DrumMachine",
  "DrumMachine.tsx"
);

/**
 * Kommentare raus, bevor gesucht wird — sonst schlägt das Gate an, sobald
 * jemand die alte Zeile in einem Kommentar ZITIERT (genau das ist beim Fix
 * passiert). Ein Gate, das Prosa für Code hält, wird umformuliert statt
 * behoben.
 */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("Korg-Import darf Parts nicht still abschneiden", () => {
  it("kappt die Part-Zahl nirgends auf die des aktiven Patterns", () => {
    const code = ohneKommentare(readFileSync(DRUM_MACHINE, "utf8"));

    const treffer = code.match(/Math\.min\([^)]*parts\.length[^)]*\)/g) ?? [];

    expect(treffer).toEqual([]);
  });

  it("greift überhaupt — die alte Zeile würde auffliegen", () => {
    const alteZeile =
      "const partLimit = Math.min(conv.drumParts.length, pattern.parts.length);";

    const treffer =
      ohneKommentare(alteZeile).match(/Math\.min\([^)]*parts\.length[^)]*\)/g) ??
      [];

    expect(treffer).toHaveLength(1);
  });

  it("wächst in beiden Import-Pfaden über ensureParts", () => {
    const quelle = readFileSync(DRUM_MACHINE, "utf8");

    expect(quelle).toContain("dm.ensureParts(decoded.parts.length)");
    expect(quelle).toContain("dm.ensureParts(conv.drumParts.length)");
  });
});
