import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildE2PatternBody } from "../../client/src/utils/e2sExport";
import { parseEsxBank } from "../../client/src/utils/korg/esxParser";
import { convertEsxToE2sBank } from "../../client/src/utils/korg/esxToE2sBank";

// v3.312: ESX-Part-egtime (Amp-EG-Zeit) muss im E2-Export landen (@ Part+0x15).
// Vorher blieben alle Parts auf dem Template-Wert 127 — kurze perkussive
// ESX-Hüllkurven gingen verloren und der gehörte Mix verschob sich
// (Gerätebefund 2026-08-01, "lukn kicks"-Bank).

const PARTS_OFF = 0x800;
const PART_STRIDE = 0x330;
const EG_OFF = 0x15;

describe("egTime → E2 EG-Decay-Byte (+0x15)", () => {
  it("schreibt egTime, wenn gesetzt — und lässt Template (127) sonst stehen", () => {
    const body = buildE2PatternBody({
      name: "EGT",
      bpm: 120,
      stepLength: 16,
      parts: [
        { egTime: 13, steps: [{ active: true }] },
        { steps: [{ active: true }] }, // kein egTime → Template
        { egTime: 0, steps: [] }, // 0 ist gültig (kürzeste Hüllkurve)
        { egTime: 999, steps: [] }, // wird auf 0..127 geklemmt → 127
      ],
    });
    expect(body[PARTS_OFF + 0 * PART_STRIDE + EG_OFF]).toBe(13);
    expect(body[PARTS_OFF + 1 * PART_STRIDE + EG_OFF]).toBe(127);
    expect(body[PARTS_OFF + 2 * PART_STRIDE + EG_OFF]).toBe(0);
    expect(body[PARTS_OFF + 3 * PART_STRIDE + EG_OFF]).toBe(127);
  });
});

// Integration gegen echte ESX-Datei (Repo-lokal; skip, wenn nicht vorhanden).
const ESX_PATH = path.join(__dirname, "..", "..", "Korg ESX files", "lukn kicks.esx");
(fs.existsSync(ESX_PATH) ? describe : describe.skip)(
  "ESX→E2S überträgt egtime (lukn kicks)",
  () => {
    it("mindestens ein aktiver Part bekommt EG < 127, Werte matchen die Quelle", () => {
      const esx = parseEsxBank(
        new Uint8Array(fs.readFileSync(ESX_PATH)),
        "lukn kicks"
      );
      // Quelle: es gibt Parts mit kurzer Hüllkurve (sonst testet das nichts)
      const shortSrc = esx.patterns
        .flatMap((p) => p.parts)
        .filter(
          (pt) =>
            pt.steps.some((s) => s.active) &&
            typeof pt.egTime === "number" &&
            pt.egTime < 127
        );
      expect(shortSrc.length).toBeGreaterThan(0);

      const r = convertEsxToE2sBank(esx);
      const allpat = r.allpat;
      const BPAT = 0x10100,
        BPLEN = 0x4000,
        BPART = 0x800,
        BPARTLEN = 0x330;
      // Erwartung pro Bank-Pattern i = i-tes selektiertes ESX-Pattern:
      // EG-Byte des Parts == ESX-egtime (geklemmt 0..127).
      const selected = esx.patterns.filter(
        (p) =>
          (p.name && p.name.trim().length > 0) ||
          p.parts.some((pt) => pt.steps.some((s) => s.active))
      );
      let checked = 0,
        short = 0;
      for (let i = 0; i < Math.min(selected.length, 250); i++) {
        for (const pt of selected[i].parts) {
          if (typeof pt.egTime !== "number") continue;
          const off =
            BPAT + i * BPLEN + BPART + pt.partIndex * BPARTLEN + EG_OFF;
          expect(allpat[off]).toBe(Math.max(0, Math.min(127, pt.egTime)));
          checked++;
          if (pt.egTime < 127) short++;
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(short).toBeGreaterThan(0);
    });
  }
);
