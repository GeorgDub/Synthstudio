/**
 * Synthstudio – korg-e2-sample-ref-offset.test.ts (v3.321.0)
 *
 * AM GERÄT GEMESSEN (2026-08-10, echtes E2S): Die Sample-Referenz im Pattern
 * und die Slot-Nummer in der `.all`-Bank sind **nicht** dieselbe Zahl.
 *
 *     Bank-Slot (OSC_0index) == Pattern-Referenz + 1
 *
 * Beleg, dreifach und unabhängig: Die Parts 1..3 des geladenen Patterns
 * referenzieren 584, 586, 588; das Gerät zeigt und spielt bei allen dreien
 * `Jumpkick`. In der Bank (`e2sSample.all`, Geometrie-Check „Versatz: OK")
 * steht:
 *
 *     584 KICK9      585 Jumpkick     586 L3oN_HaT
 *     587 Jumpkick   588 ZaHnI_ki     589 Jumpkick
 *
 * Ein direkter Wert-Vergleich landet also **konsequent einen Slot zu früh** —
 * jeder Part bekommt das Sample davor. Das ist der Grund, warum die Zuordnung
 * nach dem Pull „irgendwie nicht zusammenpasst", ohne dass etwas leer bleibt:
 * es sieht ja jedes Mal nach einem echten Sample aus.
 */
import { describe, it, expect } from "vitest";
import {
  e2PatternRefToBankNumber,
  buildE2sSampleMap,
} from "../../client/src/utils/korg/e2sPatternSampleLink";
import type { E2sBank, E2sSlot } from "../../client/src/utils/korg/e2sBankReader";

/** Ausschnitt der echten Bank rund um die gemessene Stelle. */
const ECHTE_SLOTS: Array<[number, string]> = [
  [583, "wappel b"],
  [584, "KICK9"],
  [585, "Jumpkick"],
  [586, "L3oN_HaT"],
  [587, "Jumpkick"],
  [588, "ZaHnI_ki"],
  [589, "Jumpkick"],
];

function bankAusMessung(): E2sBank {
  return {
    slots: ECHTE_SLOTS.map(([nummer, name]) => ({
      sampleNumber: nummer,
      name,
    })) as unknown as E2sSlot[],
  } as unknown as E2sBank;
}

describe("Pattern-Referenz → Bank-Slot (am Gerät gemessen)", () => {
  it("verschiebt die Referenz um genau einen Slot nach oben", () => {
    expect(e2PatternRefToBankNumber(584)).toBe(585);
  });

  it("trifft für alle drei gemessenen Jumpkick-Parts das richtige Sample", () => {
    const map = buildE2sSampleMap(bankAusMessung());

    const namen = [584, 586, 588].map(
      ref => map.get(e2PatternRefToBankNumber(ref))?.name
    );

    expect(namen).toEqual(["Jumpkick", "Jumpkick", "Jumpkick"]);
  });

  it("belegt, dass der direkte Wert-Vergleich danebenlag", () => {
    const map = buildE2sSampleMap(bankAusMessung());

    const namen = [584, 586, 588].map(ref => map.get(ref)?.name);

    expect(namen).toEqual(["KICK9", "L3oN_HaT", "ZaHnI_ki"]);
  });

  it("lässt „kein Sample\" (0) unangetastet", () => {
    expect(e2PatternRefToBankNumber(0)).toBe(0);
  });
});
