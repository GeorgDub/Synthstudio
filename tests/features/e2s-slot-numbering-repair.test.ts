/**
 * Reparatur einer fehlnummerierten .all-Bank.
 *
 * Hintergrund (am Gerät belegt, 2026-07-28): Anzeige, Pattern-Referenz,
 * Tabellen-Index und `OSC_0index` sind dieselbe Zahl. Weicht `OSC_0index`
 * konstant ab, ist die Bank falsch gebaut — sie lädt, aber Patterns greifen auf
 * die Nachbar-Samples. Der Nutzer musste so eine Bank (`luknkicks.all`) real neu
 * bauen, damit sein Pattern-Set wieder passte.
 *
 * Der Kern dieser Tests ist die unbequeme Hälfte: **Neu-Speichern allein
 * reicht nicht.** Der Bit-exakt-Passthrough reicht das originale RIFF durch und
 * damit auch dessen falsche Nummer. Ohne diesen Nachweis würde die Oberfläche
 * eine Reparatur versprechen, die nicht stattfindet.
 */
import { describe, it, expect } from "vitest";
import { buildE2sBank, type E2sBankSlotInput } from "@/utils/korg/e2sBankBuilder";
import { parseE2sBank } from "@/utils/korg/e2sBankReader";
import {
  bankToOpenedSlots,
  openedSlotsToBuildInputs,
  repairSlotNumbering,
} from "@/utils/korg/bankEditorState";
import {
  E2S_ALL_OFFSET_TABLE_START,
  ESLI_OSC_INDEX_OFFSET,
} from "@/utils/korg/constants";

function slot(index: number, name: string): E2sBankSlotInput {
  return {
    slotIndex: index,
    name,
    pcmData: new Float32Array(64).fill(0.2),
    sampleRate: 44100,
    channels: 1,
  };
}

/** Verbiegt die `OSC_0index`-Felder der Slots um `shift` — simuliert altes Tooling. */
function misnumber(buffer: ArrayBuffer, indexes: number[], shift: number): ArrayBuffer {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer);
  for (const i of indexes) {
    const riffOff = dv.getUint32(E2S_ALL_OFFSET_TABLE_START + i * 4, true);
    let p = riffOff;
    while (p < bytes.length - 8) {
      if (
        bytes[p] === 0x6b && bytes[p + 1] === 0x6f &&
        bytes[p + 2] === 0x72 && bytes[p + 3] === 0x67
      ) break;
      p++;
    }
    dv.setUint16(p + 8 + ESLI_OSC_INDEX_OFFSET, i + shift, true);
  }
  return bytes.buffer;
}

const INDEXES = [500, 501, 502];

function misnumberedBank(shift = 1): ArrayBuffer {
  const built = buildE2sBank(INDEXES.map((i, n) => slot(i, `S${n}`)));
  return misnumber(built.buffer, INDEXES, shift);
}

describe("fehlnummerierte Bank: Speichern allein repariert NICHT", () => {
  it("der Bit-exakt-Passthrough reicht die falsche Nummer weiter", () => {
    // preserveRawRiff wie im Editor (KorgBankEditor.tsx:771) — ohne diese
    // Option re-encodiert der Builder sowieso alles und der Fallstrick
    // verschwindet aus dem Test, obwohl er in der App existiert.
    const bad = parseE2sBank(misnumberedBank(), "bad.all", { preserveRawRiff: true });
    expect(bad.slotNumbering.kind).toBe("constant-shift");

    // Laden → direkt wieder speichern, ohne etwas anzufassen.
    const opened = bankToOpenedSlots(bad);
    const { inputs } = openedSlotsToBuildInputs(opened);
    const rebuilt = buildE2sBank(inputs, { preserveRawRiff: true });
    const after = parseE2sBank(rebuilt.buffer, "resaved.all");

    // Genau das ist der Fallstrick: die Bank sieht „gespeichert" aus, ist aber
    // unverändert kaputt.
    expect(after.slotNumbering.kind).toBe("constant-shift");
    expect(after.slotNumbering.shift).toBe(1);
  });
});

describe("repairSlotNumbering", () => {
  it("erzwingt Neu-Kodierung der betroffenen Slots und heilt die Bank", () => {
    const bad = parseE2sBank(misnumberedBank(), "bad.all", { preserveRawRiff: true });
    const opened = bankToOpenedSlots(bad);

    const { slots: repaired, changed } = repairSlotNumbering(opened);
    expect(changed).toBe(3);

    const { inputs } = openedSlotsToBuildInputs(repaired);
    const rebuilt = buildE2sBank(inputs, { preserveRawRiff: true });
    const after = parseE2sBank(rebuilt.buffer, "repaired.all");

    expect(after.slotNumbering.kind).toBe("ok");
    for (const i of INDEXES) {
      expect(after.slots[i]?.sampleNumber).toBe(i);
    }
  });

  it("behält die Slot-Positionen — es wird nichts verschoben", () => {
    // Wichtig: die Samples bleiben, wo sie liegen. Repariert wird die Nummer,
    // nicht die Position — sonst würden Patterns, die auf 500..502 zeigen,
    // plötzlich woanders landen.
    const bad = parseE2sBank(misnumberedBank(), "bad.all", { preserveRawRiff: true });
    const { slots: repaired } = repairSlotNumbering(bankToOpenedSlots(bad));
    const filled = repaired.filter(s => !s.empty).map(s => s.slotIndex);
    expect(filled).toEqual(INDEXES);
  });

  it("lässt eine gesunde Bank unangetastet (kein Verlust der Bit-Exaktheit)", () => {
    // Der Passthrough ist ein Kern-Feature; eine Reparatur, die auch saubere
    // Bänke neu kodiert, würde ihn beschädigen.
    const good = parseE2sBank(
      buildE2sBank(INDEXES.map((i, n) => slot(i, `S${n}`))).buffer,
      "good.all",
      { preserveRawRiff: true },
    );
    const opened = bankToOpenedSlots(good);
    const { slots: repaired, changed } = repairSlotNumbering(opened);
    expect(changed).toBe(0);
    expect(repaired.every(s => !s.isDirty)).toBe(true);
  });

  it("greift auch bei einzelnen krummen Slots (scattered)", () => {
    const built = buildE2sBank(INDEXES.map((i, n) => slot(i, `S${n}`)));
    const bytes = misnumber(built.buffer, [501], 40); // nur einer, anderer Betrag
    const bank = parseE2sBank(bytes, "one-bad.all", { preserveRawRiff: true });
    expect(bank.slotNumbering.kind).toBe("scattered");

    const { slots: repaired, changed } = repairSlotNumbering(bankToOpenedSlots(bank));
    expect(changed).toBe(1);
    const { inputs } = openedSlotsToBuildInputs(repaired);
    const after = parseE2sBank(
      buildE2sBank(inputs, { preserveRawRiff: true }).buffer,
      "fixed.all",
    );
    expect(after.slotNumbering.kind).toBe("ok");
  });
});
