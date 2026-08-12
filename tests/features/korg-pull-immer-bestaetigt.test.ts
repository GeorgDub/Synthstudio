/**
 * Synthstudio – korg-pull-immer-bestaetigt.test.ts
 *
 * ☠ Am 2026-08-11 wurde `pullMitPruefung` eingebaut — und nur an EINER von drei
 * Stellen benutzt. `pullPattern` (nummerierter Slot) und `pullGlobal` lasen
 * weiter einmal und ungeprüft.
 *
 * Das ist keine Kleinigkeit: die USB-Strecke verliert einzelne Pakete, alle
 * Nutzbytes sind gültige 7-Bit-Werte, und eine Prüfsumme gibt es nicht. Ein
 * einzeln gelesener Dump ist deshalb prinzipiell nicht vertrauenswürdig, egal
 * wie sauber er aussieht — er dekodiert klaglos zu etwas Plausiblem.
 *
 * ★ Deshalb ein Gate über die GANZE Datei statt eines Tests für eine
 * Fundstelle. Die Fehlerklasse ist „ein Leseweg ohne Bestätigung", nicht
 * „diese eine Zeile".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DATEI = resolve(
  __dirname,
  "../../client/src/store/useE2sDeviceStore.ts"
);
const quelle = readFileSync(DATEI, "utf-8");

/** `await irgendwas.pullXyz(` — die ungeschützte Form. */
const UNGESCHUETZT = /await\s+\w+\.pull[A-Z]\w*\s*\(/g;

describe("Jeder Leseweg vom Gerät wird bestätigt", () => {
  it("liest nirgends direkt, ohne die Bestätigung", () => {
    const treffer = [...quelle.matchAll(UNGESCHUETZT)].map(m => m[0]);
    expect(treffer).toEqual([]);
  });

  it("benutzt die Bestätigung für jeden der drei Lesewege", () => {
    // Pattern (Edit-Buffer), Pattern (Slot), Global-Data. Wer einen davon
    // vergisst, hat einen Weg, auf dem ein verfälschter Dump durchgeht.
    for (const weg of ["pullCurrentPattern", "pullPattern", "pullGlobal"]) {
      const muster = new RegExp(
        `pullMitPruefung\\(\\s*\\(\\)\\s*=>[^)]*\\.${weg}\\(`
      );
      expect(muster.test(quelle), `${weg} laeuft nicht ueber pullMitPruefung`).toBe(
        true
      );
    }
  });

  it("die Bestätigung verlangt wirklich zwei übereinstimmende Lesungen", () => {
    // Ein Gate, das nur die Existenz des Aufrufs prüft, liesse sich mit einer
    // leeren Hülle bestehen. Hier steht, was die Hülle können muss.
    expect(quelle).toMatch(/async function pullMitPruefung/);
    expect(quelle).toMatch(/versuche/);
    // Wirft, statt still eine einzelne Lesung durchzulassen.
    expect(quelle).toMatch(/throw new Error\(/);
  });
});
