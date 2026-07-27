/**
 * tests/features/e2-layout.test.ts
 *
 * Sichert die gemeinsame Layout-Quelle (e2Layout.ts) + garantiert, dass die
 * bislang 4× kopierten Konstanten in allen Modulen jetzt DENSELBEN Wert tragen
 * (Anti-Drift-Guard — genau das Problem, das die Konsolidierung behebt).
 */
import { describe, it, expect } from "vitest";
import * as L from "../../client/src/utils/korg/e2Layout";
import * as Sysex from "../../client/src/utils/korg/e2Sysex";
import {
  ALLPAT_PATTERN_OFFSET,
  ALLPAT_PATTERN_STRIDE,
  ALLPAT_PATTERN_COUNT,
  E2_PATTERN_BODY_SIZE,
  allpatSlotOffset,
} from "../../client/src/utils/korg/e2AllpatBuild";
import {
  E2S_BODY_SIZE,
  E2S_FILE_HEADER_SIZE,
  E2S_SINGLE_FILE_SIZE,
  E2S_ALLPAT_PREFIX_SIZE,
  E2S_ALLPAT_SLOT_COUNT,
  E2S_ALLPAT_FILE_SIZE,
} from "../../client/src/utils/e2sExport";
import {
  ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET,
  ELECTRIBE_ALLPAT_PATTERN_STRIDE,
  ELECTRIBE_ALLPAT_SLOT_COUNT,
  ELECTRIBE_ALLPAT_EXPECTED_SIZE,
} from "../../client/src/utils/electribeImport";

describe("e2Layout — kanonische Werte", () => {
  it("AllPat-Container-Konstanten (verifiziert gegen KORG-Files)", () => {
    expect(L.E2_ALLPAT_PATTERN_OFFSET).toBe(0x10100);
    expect(L.E2_ALLPAT_PATTERN_STRIDE).toBe(0x4000);
    expect(L.E2_ALLPAT_SLOT_COUNT).toBe(250);
    expect(L.E2_ALLPAT_FILE_SIZE).toBe(0x10100 + 250 * 0x4000);
    expect(L.E2_ALLPAT_FILE_SIZE).toBe(4_161_792);
  });

  it("Einzel-Pattern-Datei-Konstanten", () => {
    expect(L.E2_PATTERN_BODY_SIZE).toBe(0x4000);
    expect(L.E2_FILE_HEADER_SIZE).toBe(0x100);
    expect(L.E2_SINGLE_FILE_SIZE).toBe(0x100 + 0x4000);
  });

  it("Body-interne Layout-Konstanten (System A + e2Sysex einig)", () => {
    expect(L.E2_PART_TABLE_OFFSET).toBe(0x800);
    expect(L.E2_PART_STRIDE).toBe(0x330);
    // v3.297 (Gerätebefund + Korg TABLE 6): Volume = Amp Level @0x18,
    // Pan = Amp Pan @0x19 (i8, 0=Center). Die alten Ziele 0x15/0x22 sind
    // EG Decay bzw. IFX Edit und werden nicht mehr als Vol/Pan benutzt.
    expect(L.E2_PART_VOLUME_OFFSET).toBe(0x18);
    expect(L.E2_PART_PAN_OFFSET).toBe(0x19);
    expect(L.E2_PART_EG_DECAY_OFFSET).toBe(0x15);
    expect(L.E2_PART_IFX_EDIT_OFFSET).toBe(0x22);
    expect(L.E2_STEP_RECORD_SIZE).toBe(0x0c);
    expect(L.E2_STEPS_PER_PART).toBe(64);
    expect(L.E2_STEP_TRIGGER_OFFSET).toBe(0);
  });

  it("e2AllpatSlotOffset rechnet korrekt", () => {
    expect(L.e2AllpatSlotOffset(0)).toBe(0x10100);
    expect(L.e2AllpatSlotOffset(1)).toBe(0x10100 + 0x4000);
    expect(L.e2AllpatSlotOffset(249)).toBe(0x10100 + 249 * 0x4000);
  });

  it("Step-Record-Offsets = real-file-verifiziertes Layout", () => {
    expect(L.E2_STEP_TRIGGER_OFFSET).toBe(0);
    expect(L.E2_STEP_NOTE_OFFSET).toBe(1);
    expect(L.E2_STEP_VELOCITY_OFFSET).toBe(2);
    expect(L.E2_STEP_GATE_OFFSET).toBe(3);
    expect(L.E2_STEP_GATELEN_OFFSET).toBe(4);
  });

  it("der kanonische Decoder (e2Sysex) teilt exakt dieses Step-Layout", () => {
    // Lockt fest, dass e2Sysex das real-file-verifizierte Layout nutzt — der
    // vereinheitlichte Import routet bewusst hierüber (nicht über System A).
    expect(Sysex.STEP_TRIGGER_OFFSET).toBe(L.E2_STEP_TRIGGER_OFFSET);
    expect(Sysex.STEP_NOTE_OFFSET).toBe(L.E2_STEP_NOTE_OFFSET);
    expect(Sysex.STEP_VELOCITY_OFFSET).toBe(L.E2_STEP_VELOCITY_OFFSET);
    expect(Sysex.STEP_GATE_OFFSET).toBe(L.E2_STEP_GATE_OFFSET);
    expect(Sysex.STEP_GATELEN_OFFSET).toBe(L.E2_STEP_GATELEN_OFFSET);
  });
});

describe("Anti-Drift: alle Module teilen jetzt EINEN Wert", () => {
  it("e2AllpatBuild-Namen == e2Layout", () => {
    expect(ALLPAT_PATTERN_OFFSET).toBe(L.E2_ALLPAT_PATTERN_OFFSET);
    expect(ALLPAT_PATTERN_STRIDE).toBe(L.E2_ALLPAT_PATTERN_STRIDE);
    expect(ALLPAT_PATTERN_COUNT).toBe(L.E2_ALLPAT_SLOT_COUNT);
    expect(E2_PATTERN_BODY_SIZE).toBe(L.E2_PATTERN_BODY_SIZE);
    expect(allpatSlotOffset(3)).toBe(L.e2AllpatSlotOffset(3));
  });

  it("e2sExport-Namen == e2Layout", () => {
    expect(E2S_BODY_SIZE).toBe(L.E2_PATTERN_BODY_SIZE);
    expect(E2S_FILE_HEADER_SIZE).toBe(L.E2_FILE_HEADER_SIZE);
    expect(E2S_SINGLE_FILE_SIZE).toBe(L.E2_SINGLE_FILE_SIZE);
    expect(E2S_ALLPAT_PREFIX_SIZE).toBe(L.E2_ALLPAT_PATTERN_OFFSET);
    expect(E2S_ALLPAT_SLOT_COUNT).toBe(L.E2_ALLPAT_SLOT_COUNT);
    expect(E2S_ALLPAT_FILE_SIZE).toBe(L.E2_ALLPAT_FILE_SIZE);
  });

  it("electribeImport (System A) -Namen == e2Layout", () => {
    expect(ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET).toBe(
      L.E2_ALLPAT_PATTERN_OFFSET
    );
    expect(ELECTRIBE_ALLPAT_PATTERN_STRIDE).toBe(L.E2_ALLPAT_PATTERN_STRIDE);
    expect(ELECTRIBE_ALLPAT_SLOT_COUNT).toBe(L.E2_ALLPAT_SLOT_COUNT);
    expect(ELECTRIBE_ALLPAT_EXPECTED_SIZE).toBe(L.E2_ALLPAT_FILE_SIZE);
  });
});

// v3.297: Pan-Konvertierung UI (0..127, 64=Center) ↔ Gerät (i8, 0=Center).
import { e2PanUiToDevice, e2PanDeviceToUi } from "@/utils/korg/e2Layout";
import { describe as d2, it as it2, expect as ex2 } from "vitest";

d2("e2Pan UI↔Device Konvertierung (v3.297)", () => {
  it2("Center: UI 64 → 0 → UI 64", () => {
    ex2(e2PanUiToDevice(64)).toBe(0);
    ex2(e2PanDeviceToUi(0)).toBe(64);
  });
  it2("Extreme werden auf ±63 geclampt und runden zurück", () => {
    ex2(e2PanUiToDevice(0)).toBe(0xc1); // -63
    ex2(e2PanUiToDevice(127)).toBe(63);
    ex2(e2PanDeviceToUi(0xc1)).toBe(1); // -63 → UI 1
    ex2(e2PanDeviceToUi(63)).toBe(127);
  });
  it2("Round-Trip innerhalb des Geräte-Bereichs ist verlustfrei", () => {
    for (let ui = 1; ui <= 127; ui++) {
      ex2(e2PanDeviceToUi(e2PanUiToDevice(ui))).toBe(ui);
    }
  });
});
