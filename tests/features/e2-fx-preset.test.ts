/**
 * e2-fx-preset.test.ts — v3.286.0
 *
 * Deckt die Dekodierung des 524-Byte-FX-Presets ab (`utils/korg/e2FxPreset.ts`).
 *
 * Schwerpunkt: **dass kein Offset verrutscht**. Ein FX-Preset ist ein
 * undurchsichtiger Byte-Block; ein um eins verschobenes Feld liefert weiterhin
 * plausibel aussehende Zahlen und fällt sonst nirgends auf. Der Kern-Test setzt
 * deshalb an jedem dokumentierten Offset einen eindeutigen Marker und prüft, dass
 * genau der wieder herauskommt.
 *
 * Zweiter Schwerpunkt: der Fallstrick mit den **zwei Kodierungen** für
 * `source_control` (Preset-Datei `0x41`–`0x4A` gegen RAM `0x01`–`0x0A`).
 */
import { describe, it, expect } from "vitest";
import {
  CHAIN_INDEX,
  FX_CONTROL_SIZE,
  FX_CONTROL_SLOTS,
  FX_PRESET_SIZE,
  FX_SOURCE_CONTROL_RAM,
  IFX2_WHITELIST,
  IFX_DEVICES,
  MFX_DEVICES,
  assignedControls,
  formatFxPresetSummary,
  isIfx2Allowed,
  labelForChainIndex,
  labelForIfxDevice,
  labelForMfxDevice,
  labelForSourceControl,
  parseFxControl,
  parseFxPreset,
} from "@/utils/korg/e2FxPresetInspect";
import {
  FX_SOURCE_CONTROL,
  FX_SOURCE_CONTROL_KEYS,
  buildMapFxParam,
  type FxSourceControl,
} from "@/utils/korg/hacktribeNrpn";

// ─── Testdaten ──────────────────────────────────────────────────────────────

/** Die Offsets aus `hacktribe_ram_and_formats.md` §2, hier bewusst dupliziert. */
const OFF = {
  name: 0x01,
  controlMap: 0x12,
  ifx1Device: 0x12a,
  ifx1PostLevel: 0x12b,
  ifx1SlotIndex: 0x12e,
  ifx1PreLevel: 0x12f,
  ifx2Device: 0x174,
  ifx2PostLevel: 0x175,
  ifx2SlotIndex: 0x178,
  ifx2PreLevel: 0x179,
  mfxDevice: 0x1be,
  mfxPostLevel: 0x1bf,
  mfxSlotIndex: 0x1c2,
  mfxPreLevel: 0x1c3,
} as const;

function writeAscii(buf: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) buf[offset + i] = text.charCodeAt(i);
}

/** Ein Preset mit eindeutigen Markern an jedem dokumentierten Offset. */
function makeMarkedPreset(): Uint8Array {
  const b = new Uint8Array(FX_PRESET_SIZE);
  writeAscii(b, OFF.name, "Testpreset");

  b[OFF.ifx1Device] = 0x0a;      // Filter
  b[OFF.ifx1PostLevel] = 0x40;
  b[OFF.ifx1SlotIndex] = 0x07;
  b[OFF.ifx1PreLevel] = 0x7f;

  b[OFF.ifx2Device] = 0x04;      // Punch (in der Whitelist)
  b[OFF.ifx2PostLevel] = 0x41;
  b[OFF.ifx2SlotIndex] = 0x08;
  b[OFF.ifx2PreLevel] = 0x7e;

  b[OFF.mfxDevice] = 0x3c;       // Tape Echo
  b[OFF.mfxPostLevel] = 0x42;
  b[OFF.mfxSlotIndex] = 0x09;
  b[OFF.mfxPreLevel] = 0x7d;

  // Slot 0 belegt (RAM-Kodierung: fxEditX = 0x02), Slot 3 ebenfalls.
  const s0 = OFF.controlMap;
  b[s0 + 0] = FX_SOURCE_CONTROL_RAM.fxEditX;
  b[s0 + 1] = 0x02;  // MFX
  b[s0 + 2] = 4;     // Ziel-Param
  b[s0 + 4] = 10;    // min
  b[s0 + 6] = 120;   // max

  const s3 = OFF.controlMap + 3 * FX_CONTROL_SIZE;
  b[s3 + 0] = FX_SOURCE_CONTROL_RAM.pressPlay;
  b[s3 + 1] = 0x00;  // IFX 1
  b[s3 + 2] = 1;
  b[s3 + 4] = 0;
  b[s3 + 6] = 127;

  return b;
}

// ─── Device-Tabellen ────────────────────────────────────────────────────────

describe("Device-Tabellen", () => {
  it("führt 21 IFX- und 26 MFX-Devices", () => {
    // Anzahl aus hacktribe_ram_and_formats.md §2 — ändert sie sich, ist die
    // Tabelle unvollständig abgeschrieben worden.
    expect(Object.keys(IFX_DEVICES)).toHaveLength(21);
    expect(Object.keys(MFX_DEVICES)).toHaveLength(26);
  });

  it("hat eindeutige Anzeigenamen je Tabelle", () => {
    expect(new Set(Object.values(IFX_DEVICES)).size).toBe(Object.keys(IFX_DEVICES).length);
    expect(new Set(Object.values(MFX_DEVICES)).size).toBe(Object.keys(MFX_DEVICES).length);
  });

  it("kennt die Eckwerte aus der Doku", () => {
    expect(labelForIfxDevice(0x00)).toBe("No FX (Thru)");
    expect(labelForIfxDevice(0x0a)).toBe("Filter");
    expect(labelForIfxDevice(0x27)).toBe("No FX (Mute)");
    expect(labelForMfxDevice(0x3c)).toBe("Tape Echo");
    expect(labelForMfxDevice(0x40)).toBe("Vinyl Break");
  });

  it("zeigt unbekannte IDs als solche statt undefined", () => {
    // Die Enums sind nicht dicht — ein Loch darf nicht wie ein Fehler aussehen.
    expect(labelForIfxDevice(0x0b)).toBe("unbekannt (0x0B)");
    expect(labelForMfxDevice(0x99)).toBe("unbekannt (0x99)");
    expect(labelForChainIndex(0x7f)).toBe("unbekannt (0x7F)");
  });

  it("benennt die Ketten-Positionen", () => {
    expect(labelForChainIndex(0x00)).toBe("IFX 1");
    expect(labelForChainIndex(0x02)).toBe("MFX");
    expect(labelForChainIndex(0x0a)).toBe("Output Level");
    expect(Object.keys(CHAIN_INDEX)).toHaveLength(5);
  });

  it("kennt die IFX-2-Whitelist und prüft gegen sie", () => {
    expect(IFX2_WHITELIST.size).toBe(7);
    expect(isIfx2Allowed(0x04)).toBe(true);   // Punch
    expect(isIfx2Allowed(0x3c)).toBe(false);  // Tape Echo ist ein MFX
    expect(isIfx2Allowed(0x11)).toBe(false);  // Chorus, zu schwer für IFX 2
  });
});

// ─── Die zwei Kodierungen ───────────────────────────────────────────────────

describe("source_control — zwei Kodierungen", () => {
  it("deckt in beiden Tabellen dieselben Bedienelemente ab", () => {
    expect(new Set(Object.keys(FX_SOURCE_CONTROL_RAM))).toEqual(
      new Set(Object.keys(FX_SOURCE_CONTROL)),
    );
  });

  it("unterscheidet sich genau um 0x40 — außer bei none", () => {
    for (const k of FX_SOURCE_CONTROL_KEYS) {
      if (k === "none") {
        expect(FX_SOURCE_CONTROL_RAM[k]).toBe(FX_SOURCE_CONTROL[k]);
        continue;
      }
      expect(FX_SOURCE_CONTROL[k] - FX_SOURCE_CONTROL_RAM[k]).toBe(0x40);
    }
  });

  it("liest dieselben Bytes je nach Kodierung als verschiedene Elemente", () => {
    // Genau das ist der Fallstrick: 0x02 ist im RAM-Format fxEditX, im
    // Preset-Format gar nichts.
    expect(labelForSourceControl(0x02, "ram")).toBe("FX Edit X");
    expect(labelForSourceControl(0x02, "preset")).toBe("unbekannt (0x02)");
    expect(labelForSourceControl(0x42, "preset")).toBe("FX Edit X");
    expect(labelForSourceControl(0x42, "ram")).toBe("unbekannt (0x42)");
  });

  it("erkennt im Preset-Modus genau die Codes, die buildMapFxParam sendet", () => {
    // Wir senden die Preset-Codes über NRPN. Wenn das Gerät sie unverändert
    // ablegt, muss der Preset-Modus sie wiederfinden — sonst haben wir die
    // falsche Tabelle beim Senden benutzt.
    for (const key of FX_SOURCE_CONTROL_KEYS) {
      const msgs = buildMapFxParam(0, 0, {
        mapSlot: 0,
        sourceControl: FX_SOURCE_CONTROL[key],
        targetParam: 0,
        minValue: 0,
        maxValue: 127,
      });
      const sentValue = msgs[1 * 4 + 3][2]; // zweite NRPN-Gruppe, DATA-LSB
      expect(labelForSourceControl(sentValue, "preset")).not.toMatch(/^unbekannt/);
    }
  });
});

// ─── parseFxControl ─────────────────────────────────────────────────────────

describe("parseFxControl", () => {
  function ctrl(source: number, chain: number, target: number, min: number, max: number) {
    const b = new Uint8Array(FX_CONTROL_SIZE);
    b[0] = source; b[1] = chain; b[2] = target; b[4] = min; b[6] = max;
    return b;
  }

  it("liest alle fünf Felder an ihren Positionen", () => {
    const c = parseFxControl(ctrl(0x02, 0x02, 4, 10, 120), "ram", 7);
    expect(c).toMatchObject({
      index: 7, sourceControl: 0x02, sourceKey: "fxEditX",
      chainIndex: 0x02, targetParam: 4, minValue: 10, maxValue: 120,
      assigned: true,
    });
  });

  it("überspringt die Padding-Bytes an 3 und 5", () => {
    // Wäre die Feldlage um eins verschoben, käme hier das Padding heraus.
    const b = ctrl(0x02, 0x02, 4, 10, 120);
    b[3] = 0xff; b[5] = 0xff;
    const c = parseFxControl(b, "ram");
    expect(c.minValue).toBe(10);
    expect(c.maxValue).toBe(120);
  });

  it("markiert source_control 0 als freien Slot", () => {
    const c = parseFxControl(ctrl(0, 0, 0, 0, 0), "ram");
    expect(c.assigned).toBe(false);
    expect(c.sourceKey).toBe("none");
  });

  it("liefert sourceKey null bei unbekanntem Code", () => {
    expect(parseFxControl(ctrl(0x77, 0, 0, 0, 0), "ram").sourceKey).toBeNull();
  });

  it("wirft bei zu kurzem Puffer statt über die Grenze zu lesen", () => {
    expect(() => parseFxControl(new Uint8Array(3), "ram")).toThrow(RangeError);
  });
});

// ─── parseFxPreset ──────────────────────────────────────────────────────────

describe("parseFxPreset", () => {
  it("liest jedes dokumentierte Feld von seinem Offset", () => {
    const p = parseFxPreset(makeMarkedPreset());

    expect(p.name).toBe("Testpreset");
    expect(p.ifx1).toMatchObject({ device: 0x0a, deviceName: "Filter", postLevel: 0x40, slotIndex: 0x07, preLevel: 0x7f });
    expect(p.ifx2).toMatchObject({ device: 0x04, deviceName: "Punch", postLevel: 0x41, slotIndex: 0x08, preLevel: 0x7e });
    expect(p.mfx).toMatchObject({ device: 0x3c, deviceName: "Tape Echo", postLevel: 0x42, slotIndex: 0x09, preLevel: 0x7d });
  });

  it("liest alle zehn Zuweisungs-Slots, auch die freien", () => {
    const p = parseFxPreset(makeMarkedPreset());
    expect(p.controlMap).toHaveLength(FX_CONTROL_SLOTS);
    expect(p.controlMap.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("trifft den richtigen Slot — Slot-Abstand ist 28 Bytes", () => {
    const p = parseFxPreset(makeMarkedPreset());
    const assigned = assignedControls(p);
    expect(assigned.map((c) => c.index)).toEqual([0, 3]);
    expect(assigned[0]).toMatchObject({ sourceKey: "fxEditX", chainIndex: 0x02, targetParam: 4, minValue: 10, maxValue: 120 });
    expect(assigned[1]).toMatchObject({ sourceKey: "pressPlay", chainIndex: 0x00, targetParam: 1, maxValue: 127 });
  });

  it("liefert die Rohparameter je Slot, ohne sie zu deuten", () => {
    const b = makeMarkedPreset();
    b[0x135] = 0xab; // erstes IFX-1-Param-Byte
    b[0x1c9] = 0xcd; // erstes MFX-Param-Byte
    const p = parseFxPreset(b);
    expect(p.ifx1.rawParams[0]).toBe(0xab);
    expect(p.mfx.rawParams[0]).toBe(0xcd);
    // Länge = bis zum nächsten Abschnitt, nicht willkürlich abgeschnitten.
    expect(p.ifx1.rawParams).toHaveLength(0x174 - 0x135);
    expect(p.mfx.rawParams).toHaveLength(0x209 - 0x1c9);
  });

  it("schneidet den Namen an der Nullterminierung ab", () => {
    const b = makeMarkedPreset();
    b[OFF.name + 4] = 0;
    expect(parseFxPreset(b).name).toBe("Test");
  });

  it("wirft nicht-druckbare Zeichen aus dem Namen", () => {
    const b = new Uint8Array(FX_PRESET_SIZE);
    writeAscii(b, OFF.name, "AB");
    b[OFF.name + 2] = 0x07; // BEL
    writeAscii(b, OFF.name + 3, "CD");
    expect(parseFxPreset(b).name).toBe("ABCD");
  });

  it("verträgt ein komplett leeres Preset", () => {
    const p = parseFxPreset(new Uint8Array(FX_PRESET_SIZE));
    expect(p.name).toBe("");
    expect(p.ifx1.deviceName).toBe("No FX (Thru)");
    expect(assignedControls(p)).toEqual([]);
  });

  it("wirft bei zu kurzem Puffer", () => {
    expect(() => parseFxPreset(new Uint8Array(FX_PRESET_SIZE - 1))).toThrow(RangeError);
  });

  it("merkt sich die benutzte Kodierung", () => {
    expect(parseFxPreset(makeMarkedPreset()).encoding).toBe("ram");
    expect(parseFxPreset(makeMarkedPreset(), { encoding: "preset" }).encoding).toBe("preset");
  });

  it("deutet dieselben Bytes je nach Kodierung anders", () => {
    const b = makeMarkedPreset();
    expect(parseFxPreset(b, { encoding: "ram" }).controlMap[0].sourceKey).toBe("fxEditX");
    // Im Preset-Modus ist 0x02 kein gültiger Code — der Slot gilt weiterhin als
    // belegt (source != 0), aber ohne benennbare Quelle.
    const asPreset = parseFxPreset(b, { encoding: "preset" }).controlMap[0];
    expect(asPreset.sourceKey).toBeNull();
    expect(asPreset.assigned).toBe(true);
  });
});

// ─── Zusammenfassung ────────────────────────────────────────────────────────

describe("formatFxPresetSummary", () => {
  it("nennt Name, alle drei Devices und die belegten Zuweisungen", () => {
    const text = formatFxPresetSummary(parseFxPreset(makeMarkedPreset()));
    expect(text).toContain("Testpreset");
    expect(text).toContain("Filter");
    expect(text).toContain("Punch");
    expect(text).toContain("Tape Echo");
    expect(text).toContain("Zuweisungen (2/10)");
    expect(text).toContain("MFX Param 4");
  });

  it("warnt, wenn IFX 2 ein dort unzulässiges Device trägt", () => {
    const b = makeMarkedPreset();
    b[OFF.ifx2Device] = 0x11; // Chorus — nicht in der Whitelist
    expect(formatFxPresetSummary(parseFxPreset(b))).toContain("IFX-2-Whitelist");
  });

  it("sagt es deutlich, wenn nichts zugewiesen ist", () => {
    const text = formatFxPresetSummary(parseFxPreset(new Uint8Array(FX_PRESET_SIZE)));
    expect(text).toContain("Zuweisungen: keine");
  });

  it("zeigt unbekannte Quellcodes als Hex statt sie zu verschweigen", () => {
    const b = makeMarkedPreset();
    b[OFF.controlMap] = 0x77;
    expect(formatFxPresetSummary(parseFxPreset(b))).toContain("0x77");
  });
});

// ─── Typ-Konsistenz ─────────────────────────────────────────────────────────

describe("Konsistenz mit hacktribeNrpn", () => {
  it("benutzt denselben FxSourceControl-Schlüsselraum", () => {
    const keys: FxSourceControl[] = [...FX_SOURCE_CONTROL_KEYS];
    for (const k of keys) {
      expect(FX_SOURCE_CONTROL_RAM[k]).toBeTypeOf("number");
    }
  });
});
