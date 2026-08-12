/**
 * Synthstudio – e2s-ifx-geraet-fixture.test.ts
 *
 * ★ Das Fixture ist am 2026-08-12 vom GERÄT gelesen
 * (`tools/hwtest/ifx_preset.py --slot 1`, bestätigt durch zwei
 * übereinstimmende Lesungen), nicht erdacht.
 *
 * Der Feld-Layer stammt aus `bangcorrupt/hacktribe-editor` und war bisher nur
 * gegen selbst gebaute Blobs geprüft — also gegen unsere eigene Annahme. Ein
 * echtes Werks-Preset ist die erste unabhängige Instanz: die Offsets müssen
 * einen lesbaren Namen, einen bekannten FX-Typ und plausible Pegel ergeben.
 * Stimmte auch nur einer nicht, käme etwas Plausibles-aber-Falsches heraus,
 * und das fiele beim Hören nicht auf.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  decodeIfxPreset,
  setIfxPresetParam,
  decodePresetControlMap,
  PRESET_FX_SOURCES,
  IFX_PRESET_SIZE,
} from "../../client/src/utils/korg/e2FxPreset";

const FIXTURE = path.resolve(
  __dirname,
  "../fixtures/e2s/geraet-ifx-overdrive.bin"
);

const blob = new Uint8Array(fs.readFileSync(FIXTURE));

describe("Echtes IFX-Preset vom Gerät (Slot 1)", () => {
  it("hat die Grösse, die das Protokoll vorschreibt", () => {
    expect(blob.length).toBe(IFX_PRESET_SIZE); // 0x20C
  });

  it("liest den Preset-Namen an der erwarteten Stelle", () => {
    // Der Name liegt bei 0x01, nicht bei 0x00 — am Gerät belegt, weil bei
    // 0xC00A80F0 wörtlich `\0Punch` steht (Slot 0).
    expect(decodeIfxPreset(blob).name).toBe("Overdrive");
  });

  it("findet im IFX1-Slot einen Typ, den der Katalog kennt", () => {
    const slot = decodeIfxPreset(blob).slots.find(s => s.role === "ifx1")!;
    expect(slot.device).toBe(0x10);
    // Kein „Unknown (0x…)" — der Katalog aus e2FxParams.ts deckt diesen Typ ab.
    expect(slot.deviceName).not.toMatch(/^Unknown/);
    expect(slot.paramNames.length).toBeGreaterThan(0);
  });

  it("liest Pegel, die im gültigen Bereich liegen", () => {
    // Wären die Offsets verschoben, stünden hier beliebige Bytes — dass beide
    // in 0..127 fallen UND Pre auf Anschlag steht, passt zu einem Werks-Preset.
    const slot = decodeIfxPreset(blob).slots.find(s => s.role === "ifx1")!;
    expect(slot.preLevel).toBe(127);
    expect(slot.postLevel).toBe(64);
  });

  it("belegt alle drei Slots mit gültigen Werten", () => {
    const d = decodeIfxPreset(blob);
    expect(d.slots.map(s => s.role)).toEqual(["ifx1", "ifx2", "mfx"]);
    for (const s of d.slots) {
      expect(s.preLevel).toBeGreaterThanOrEqual(0);
      expect(s.preLevel).toBeLessThanOrEqual(127);
      expect(s.postLevel).toBeGreaterThanOrEqual(0);
      expect(s.postLevel).toBeLessThanOrEqual(127);
    }
  });

  it("ändert an ECHTEN Gerätebytes genau ein Byte", () => {
    // Die Garantie zählt erst gegen echte Daten. Ein selbst gebauter Blob
    // enthält nur Bytes, deren Bedeutung wir zu kennen glauben; ein Werks-
    // Preset enthält auch die, von denen wir nichts wissen.
    const nachher = setIfxPresetParam(blob, "ifx1", 0, 42);
    const diff: number[] = [];
    for (let i = 0; i < blob.length; i++) {
      if (blob[i] !== nachher[i]) diff.push(i);
    }
    expect(diff).toHaveLength(1);
    expect(nachher[diff[0]]).toBe(42);
  });
});

/**
 * §2 des Geräte-Prüfprotokolls: welche Kodierung tragen die Source-Controls?
 *
 * Das Datei-Format nutzt für dieselben Bedienelemente `0x41`–`0x4A`, die
 * Live-FX-Map `0x01`–`0x0A`. Welche im **Preset-Blob** steht, war laut Protokoll
 * „gerätefrei nicht entscheidbar" — beide Kodierungen sind in sich stimmig.
 *
 * ★ Am 2026-08-12 an acht echten Geräte-Presets entschieden: **jeder** belegte
 * Control-Slot trägt `0x42`/`0x44`/`0x45`, also den `0x4x`-Bereich. Kein
 * einziger nutzt `0x01`–`0x0A`. Die Werte sind zusätzlich semantisch stimmig —
 * „FX Edit X", „X Hi", „X Lo" ist genau das, was man an einem FX-Preset
 * festmacht.
 */
describe("§2 — Source-Control-Kodierung im Preset-Blob", () => {
  it("nutzt den 0x4x-Bereich, nicht die Live-RAM-Codes", () => {
    const slots = decodePresetControlMap(blob).filter(s => s.sourceControl !== 0);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(s.sourceControl).toBeGreaterThanOrEqual(0x41);
      expect(s.sourceControl).toBeLessThanOrEqual(0x4a);
    }
  });

  it("benennt jeden gefundenen Code, statt ihn als unbekannt zu melden", () => {
    // Eine Tabelle, die den Code nicht kennt, liefert etwas Plausibles-aber-
    // Leeres — und das sieht in der Oberfläche wie „nicht belegt" aus.
    const slots = decodePresetControlMap(blob).filter(s => s.sourceControl !== 0);
    for (const s of slots) {
      expect(PRESET_FX_SOURCES[s.sourceControl]).toBeTruthy();
    }
  });

  it("trägt in diesem Preset die vier erwarteten Zuordnungen", () => {
    // Am Gerät abgelesen — X Lo und X Hi auf je zwei Zielparameter.
    const slots = decodePresetControlMap(blob).filter(s => s.sourceControl !== 0);
    expect(slots.map(s => s.sourceControl)).toEqual([0x45, 0x44, 0x45, 0x44]);
    expect(slots.map(s => s.targetParam)).toEqual([0, 0, 1, 1]);
  });
});
