/**
 * Synthstudio – korg-dump-vollstaendigkeit.test.ts
 *
 * ★ Am 2026-08-11 am Gerät gemessen: ein Pattern-Dump (18,7 KB) kommt auf
 * diesem Rechner regelmässig mit falscher Länge an — 18735 oder 18741 statt
 * 18738 Byte. Die Abweichung ist immer ein Vielfaches von **3**, und ein
 * USB-MIDI-Paket trägt genau 3 Datenbytes: es gehen einzelne USB-Pakete
 * verloren oder kommen doppelt an.
 *
 * ☠ Für den Empfänger ist das unsichtbar. Alle Nutzbytes sind gültige
 * 7-Bit-Werte, es gibt keine Prüfsumme, und der 7-in-8-Dekoder liefert
 * klaglos ein Ergebnis — nur eben ein um Tausende Bytes verschobenes. Das
 * Pattern sieht danach plausibel aus: einzelne Parts ohne Sample, seltsame
 * Pegel. Genau die Meldung „die Sample-Zuweisungen fehlen MANCHMAL komplett".
 *
 * Die Länge ist die einzige Prüfung, die vor dem Dekodieren greift. Ein Dump
 * mit falscher Länge muss verworfen werden, nicht gedeutet.
 */
import { describe, it, expect } from "vitest";
import {
  istMasshaltigerDump,
  erwarteteDumpLaenge,
} from "../../client/src/utils/korg/e2Sysex";

const KOPF_AKTUELL = [0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x40];
const KOPF_SLOT = [0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x4c, 0x79, 0x01];

function rahmen(kopf: number[], nutzbytes: number): Uint8Array {
  return Uint8Array.from([...kopf, ...new Array(nutzbytes).fill(0), 0xf7]);
}

describe("Vollständigkeit eines Pattern-Dumps", () => {
  it("kennt die einzige richtige Länge", () => {
    // 16384 B -> ceil(16384/7) = 2341 Gruppen à 8 B = 18728 Nutzbytes.
    expect(erwarteteDumpLaenge(0x40)).toBe(7 + 18728 + 1); // 18736
    expect(erwarteteDumpLaenge(0x4c)).toBe(9 + 18728 + 1); // 18738
  });

  it("nimmt einen masshaltigen Rahmen an", () => {
    expect(istMasshaltigerDump(rahmen(KOPF_AKTUELL, 18728))).toBe(true);
    expect(istMasshaltigerDump(rahmen(KOPF_SLOT, 18728))).toBe(true);
  });

  it("verwirft einen Rahmen, dem ein USB-Paket fehlt", () => {
    // 3 Byte zu wenig — am Gerät gemessen, nicht erdacht.
    expect(istMasshaltigerDump(rahmen(KOPF_AKTUELL, 18725))).toBe(false);
  });

  it("verwirft einen Rahmen mit einem USB-Paket zu viel", () => {
    expect(istMasshaltigerDump(rahmen(KOPF_AKTUELL, 18731))).toBe(false);
  });

  it("lässt Rahmen in Ruhe, die keine Pattern-Dumps sind", () => {
    // Ein ACK ist kurz und trotzdem völlig in Ordnung — die Prüfung darf nur
    // für Dumps gelten, sonst verwirft sie den halben Protokollverkehr.
    const ack = Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x23, 0xf7]);
    expect(istMasshaltigerDump(ack)).toBe(true);
  });
});
