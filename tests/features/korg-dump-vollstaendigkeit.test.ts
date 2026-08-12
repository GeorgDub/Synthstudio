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
    // ☠ Hier stand zuerst 18728 Nutzbytes (= ceil(16384/7)·8). Das ist falsch:
    // die LETZTE 7-in-8-Gruppe ist kürzer. 16384 = 2340·7 + 4, also 2340 volle
    // Gruppen à 8 B plus 1 Kopfbyte + 4 Datenbytes = 18725.
    //
    // Der Fehler überlebte, weil dieser Test dieselbe Formel benutzte wie die
    // Produktion — er hätte jeden gültigen Dump als „falsche Länge" verworfen.
    // Am Gerät gemessen (2026-08-12): 18733 bzw. 18735.
    expect(erwarteteDumpLaenge(0x40)).toBe(18733);
    expect(erwarteteDumpLaenge(0x4c)).toBe(18735);
  });

  it("nimmt einen masshaltigen Rahmen an", () => {
    expect(istMasshaltigerDump(rahmen(KOPF_AKTUELL, 18725))).toBe(true);
    expect(istMasshaltigerDump(rahmen(KOPF_SLOT, 18725))).toBe(true);
  });

  it("verwirft einen Rahmen, dem ein USB-Paket fehlt", () => {
    // 3 Byte zu wenig — am Gerät gemessen, nicht erdacht.
    expect(istMasshaltigerDump(rahmen(KOPF_AKTUELL, 18722))).toBe(false);
  });

  it("verwirft einen Rahmen mit einem USB-Paket zu viel", () => {
    expect(istMasshaltigerDump(rahmen(KOPF_AKTUELL, 18728))).toBe(false);
  });

  it("lässt Rahmen in Ruhe, die keine Pattern-Dumps sind", () => {
    // Ein ACK ist kurz und trotzdem völlig in Ordnung — die Prüfung darf nur
    // für Dumps gelten, sonst verwirft sie den halben Protokollverkehr.
    const ack = Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x23, 0xf7]);
    expect(istMasshaltigerDump(ack)).toBe(true);
  });
});
