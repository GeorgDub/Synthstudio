/**
 * Synthstudio – korg-dump-laenge-letzte-gruppe.test.ts
 *
 * ☠ Die Längenprüfung aus `korg-dump-vollstaendigkeit.test.ts` rechnete falsch
 * — und ihr eigener Test hat den Fehler mitgetragen, weil er dieselbe Formel
 * benutzte wie die Produktion.
 *
 * `ceil(16384/7) * 8` unterstellt, dass ALLE 7-in-8-Gruppen acht Byte lang
 * sind. Die letzte ist kürzer: 16384 = 2340·7 + 4, also 2340 volle Gruppen à
 * 8 Byte plus eine Restgruppe aus 1 Kopfbyte + 4 Datenbytes.
 *
 *     2340·8 + 5 = 18725     (nicht 18728)
 *
 * Am Gerät gemessen (2026-08-12): Slot-Dumps kommen mit **18735** Byte an,
 * Dumps des aktuellen Patterns mit **18733**. Genau diese Rahmen hat die alte
 * Rechnung als „falsche Länge" verworfen — sie hätte in SynthStudio jeden
 * gültigen Dump abgelehnt und die verfälschten (18741) durchgelassen.
 *
 * ★ Der Test rechnet deshalb NICHT mit derselben Formel wie die Produktion,
 * sondern nennt die am Gerät gemessenen Zahlen. Eine Prüfung, die ihre
 * Erwartung aus dem Prüfling ableitet, prüft nichts.
 */
import { describe, it, expect } from "vitest";
import {
  erwarteteDumpLaenge,
  istMasshaltigerDump,
  encode7in8,
  E2_PATTERN_BODY_SIZE,
} from "../../client/src/utils/korg/e2Sysex";

describe("Rahmenlänge eines Pattern-Dumps", () => {
  it("entspricht dem, was das Gerät wirklich schickt", () => {
    expect(erwarteteDumpLaenge(0x40)).toBe(18733); // aktuelles Pattern
    expect(erwarteteDumpLaenge(0x4c)).toBe(18735); // Slot-Dump
  });

  it("deckt sich mit dem, was unser eigener Kodierer erzeugt", () => {
    // Unabhängige Gegenprobe: `encode7in8` ist bit-genau zu hacktribes
    // e2_syx_codec.py. Wenn dieselbe Zahl aus einer ganz anderen Richtung
    // herauskommt, ist sie nicht geraten.
    const nutz = encode7in8(new Uint8Array(E2_PATTERN_BODY_SIZE)).length;
    expect(nutz).toBe(18725);
    expect(erwarteteDumpLaenge(0x40)).toBe(7 + nutz + 1);
    expect(erwarteteDumpLaenge(0x4c)).toBe(9 + nutz + 1);
  });

  it("nimmt einen echten Slot-Dump an", () => {
    const f = new Uint8Array(18735);
    f[0] = 0xf0;
    f[6] = 0x4c;
    f[f.length - 1] = 0xf7;
    expect(istMasshaltigerDump(f)).toBe(true);
  });

  it("verwirft einen um zwei USB-Pakete zu langen Rahmen", () => {
    const f = new Uint8Array(18741);
    f[0] = 0xf0;
    f[6] = 0x4c;
    f[f.length - 1] = 0xf7;
    expect(istMasshaltigerDump(f)).toBe(false);
  });
});
