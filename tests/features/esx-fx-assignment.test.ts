import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseEsxPattern,
  parseEsxBank,
  esxFxTypeName,
  ESX_FX_TYPE_NAMES,
} from "../../client/src/utils/korg/esxParser";
import { convertEsxToE2sBank } from "../../client/src/utils/korg/esxToE2sBank";

// v3.313: Die ESX routet Parts insert-artig durch ihre 3 Master-FX (fxflags
// bit 2 = Send, bits 0-1 = FX-Auswahl; FXParam-Block @ Pattern+1148). Beim
// Transfer geht das Routing verloren → die Anleitung (mapping.md) bekommt
// eine FX-Zuweisungs-Sektion zum Nachbauen am Gerät.

describe("esxParser FX-Dekodierung (synthetisch)", () => {
  it("dekodiert fxflags (Send/Select) und die 3 FXParam-Slots + Chain", () => {
    const raw = new Uint8Array(4280);
    // Drum-Part 0 @24: Trigger-Bit für Step 0 (Bitmaske MSB-first @+18)
    raw[24 + 18] = 0x80;
    // fxflags @+13: 0b101 = Send AN, Select FX2 (bits0-1 = 1)
    raw[24 + 13] = 0b101;
    // FXParam @1148: FX1 = Compressor(10) 62/38, FX2 = EQ(13) 99/67,
    // FX3 = Short Delay(2) 127/0
    raw.set([10, 62, 38, 0, 13, 99, 67, 0, 2, 127, 0, 0], 1148);
    // FX-Chain @12: 3 = FX1→FX2→FX3
    raw[12] = 3;

    const p = parseEsxPattern(raw, 0);
    expect(p).not.toBeNull();
    expect(p!.parts[0].fxSend).toBe(true);
    expect(p!.parts[0].fxSelect).toBe(1);
    expect(p!.fx).toEqual([
      { fxType: 10, edit1: 62, edit2: 38 },
      { fxType: 13, edit1: 99, edit2: 67 },
      { fxType: 2, edit1: 127, edit2: 0 },
    ]);
    expect(p!.fxChain).toBe(3);
    expect(esxFxTypeName(10)).toBe("Compressor");
    expect(ESX_FX_TYPE_NAMES).toHaveLength(16);
  });
});

const ESX_PATH = path.join(__dirname, "..", "..", "Korg ESX files", "lukn kicks.esx");
(fs.existsSync(ESX_PATH) ? describe : describe.skip)(
  "FX-Zuweisung in der Import-Anleitung (lukn kicks)",
  () => {
    it("Pattern 1 dekodiert EQ/Compressor/ShortDelay; mapping.md listet Routing", () => {
      const esx = parseEsxBank(
        new Uint8Array(fs.readFileSync(ESX_PATH)),
        "lukn kicks"
      );
      // Empirisch am Hexdump verifiziert (2026-08-01): Pattern-Slot 0 trägt
      // FX1=EQ(99/67), FX2=Compressor(62/38), FX3=Short Delay(127/0).
      const p0 = esx.patterns.find((p) => p.index === 0);
      expect(p0).toBeDefined();
      expect(p0!.fx).toEqual([
        { fxType: 13, edit1: 99, edit2: 67 },
        { fxType: 10, edit1: 62, edit2: 38 },
        { fxType: 2, edit1: 127, edit2: 0 },
      ]);
      // Es gibt Parts mit aktivem FX-Send (87 lt. Analyse; hier nur >0 prüfen)
      const routed = esx.patterns
        .flatMap((p) => p.parts)
        .filter((pt) => pt.fxSend && pt.steps.some((s) => s.active));
      expect(routed.length).toBeGreaterThan(0);

      const r = convertEsxToE2sBank(esx);
      expect(r.mapping).toContain("## FX-Zuweisung (am Gerät nachbauen)");
      expect(r.mapping).toContain("Compressor");
      expect(r.mapping).toMatch(/- Part \d+.* → FX[123] \(/);
    });
  }
);
