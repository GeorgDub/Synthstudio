/**
 * korg-remote.test.ts — v3.269.0
 *
 * Deckt die CC-Fernsteuerung der echten Electribe 2 ab:
 * Controller → Synthstudio → Korg.
 *
 * Drei Schichten, alle hier geprüft:
 *   - `utils/korg/e2ControlChange.ts` — CC-Nummern, Kanalwahl, Skalierung
 *   - `utils/korg/korgRemote.ts`      — Regel-Matching und Übersetzung
 *   - `store/useKorgRemoteStore.ts`   — Regelverwaltung, Learn, Persistenz
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (Node-Environment hat keinen) ────────────────────────
function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  E2_CC_PARAMS,
  E2_PART_COUNT,
  buildE2CcMessage,
  channelForE2Param,
  clampChannel0,
  clampMidi7,
  clampPart,
  describeE2Target,
  findE2CcParam,
  scaleMidiToRange,
} from "@/utils/korg/e2ControlChange";
import {
  KORG_TARGET_KINDS,
  MIDIMIX_FADER_CCS,
  MIDIMIX_KNOB_ROW1_CCS,
  buildKorgRemoteMessages,
  buildPanelBank,
  buildRuleBank,
  describeKorgRemoteTarget,
  korgTargetsEqual,
  labelForTargetKind,
  makeKorgRemoteRule,
  normalizeTarget,
  ruleMatchesCc,
  targetNeedsHacktribe,
  type KorgRemoteRule,
} from "@/utils/korg/korgRemote";
import {
  FX_MAP_SLOT_COUNT,
  FX_SOURCE_CONTROL,
  FX_SOURCE_CONTROL_KEYS,
  MFX_SLOT,
  NRPN_CATEGORY,
  NRPN_CC,
  PANEL_MODE,
  buildGlobalParam,
  buildMapFxParam,
  buildNrpn,
  buildPanelControl,
  buildSequenceParam,
  buildSetFxParam,
  fxSlotForPart,
  labelForFxSourceControl,
  labelForPanelMode,
  type FxSourceControl,
  type PanelMode,
} from "@/utils/korg/hacktribeNrpn";
import {
  __reloadKorgRemoteForTests,
  __resetKorgRemoteForTests,
  addKorgRemoteRule,
  addKorgRemoteRules,
  cancelKorgRemoteLearn,
  clearKorgRemoteRules,
  completeKorgRemoteLearn,
  getKorgRemoteState,
  removeKorgRemoteRule,
  setKorgRemoteEnabled,
  setKorgRemoteGlobalChannel,
  startKorgRemoteLearn,
  updateKorgRemoteRule,
} from "@/store/useKorgRemoteStore";

const STORAGE_KEY = "synthstudio:korg-remote:v1";

function rule(
  patch: Partial<KorgRemoteRule> & { part?: number; param?: string } = {},
): KorgRemoteRule {
  const { part, param, ...rest } = patch;
  return makeKorgRemoteRule({
    id: "r1",
    ...rest,
    target: rest.target ?? { kind: "cc", part: part ?? 1, param: param ?? "ampLevel" },
  });
}

// ─── e2ControlChange ────────────────────────────────────────────────────────

describe("E2_CC_PARAMS", () => {
  it("hat eindeutige Schlüssel und gültige CC-Nummern", () => {
    const keys = new Set(E2_CC_PARAMS.map((p) => p.key));
    expect(keys.size).toBe(E2_CC_PARAMS.length);
    for (const p of E2_CC_PARAMS) {
      expect(p.cc).toBeGreaterThanOrEqual(0);
      expect(p.cc).toBeLessThanOrEqual(127);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("führt die CC-Nummern aus Korgs offizieller MIDI-Implementation", () => {
    // Referenz: „electribe sampler MIDI Implementation" Rev 1.00 §CC-Liste.
    expect(findE2CcParam("ampLevel")?.cc).toBe(7);
    expect(findE2CcParam("pan")?.cc).toBe(10);
    expect(findE2CcParam("resonance")?.cc).toBe(71);
    expect(findE2CcParam("egDecay")?.cc).toBe(72);
    expect(findE2CcParam("egAttack")?.cc).toBe(73);
    expect(findE2CcParam("cutoff")?.cc).toBe(74);
    expect(findE2CcParam("ifxOnOff")?.cc).toBe(104);
    expect(findE2CcParam("mfxSend")?.cc).toBe(105);
    expect(findE2CcParam("mfxX")?.cc).toBe(102);
    expect(findE2CcParam("mfxY")?.cc).toBe(103);
  });

  it("markiert Master-FX als global, Klangparameter als Part-bezogen", () => {
    expect(findE2CcParam("mfxX")?.scope).toBe("global");
    expect(findE2CcParam("mfxY")?.scope).toBe("global");
    expect(findE2CcParam("mfxOnOff")?.scope).toBe("global");
    // MFX *Send* ist der Anteil EINES Parts am Master-FX — also Part-bezogen.
    expect(findE2CcParam("mfxSend")?.scope).toBe("part");
    expect(findE2CcParam("cutoff")?.scope).toBe("part");
  });

  it("liefert undefined für unbekannte Schlüssel", () => {
    expect(findE2CcParam("gibtsNicht")).toBeUndefined();
  });
});

describe("clamp-Helfer", () => {
  it("clampMidi7 begrenzt auf 0..127 und rundet", () => {
    expect(clampMidi7(-5)).toBe(0);
    expect(clampMidi7(200)).toBe(127);
    expect(clampMidi7(63.6)).toBe(64);
    expect(clampMidi7(Number.NaN)).toBe(0);
  });

  it("clampPart begrenzt auf 1..16", () => {
    expect(clampPart(0)).toBe(1);
    expect(clampPart(17)).toBe(E2_PART_COUNT);
    expect(clampPart(8)).toBe(8);
  });

  it("clampChannel0 begrenzt auf 0..15", () => {
    expect(clampChannel0(-1)).toBe(0);
    expect(clampChannel0(99)).toBe(15);
  });
});

describe("channelForE2Param", () => {
  it("adressiert Parts über den Kanal: Part 1 → Kanal 0, Part 16 → Kanal 15", () => {
    const cutoff = findE2CcParam("cutoff")!;
    expect(channelForE2Param(cutoff, 1, 0)).toBe(0);
    expect(channelForE2Param(cutoff, 16, 0)).toBe(15);
  });

  it("schickt globale Parameter auf den Global-Channel, nicht auf den Part-Kanal", () => {
    const mfxX = findE2CcParam("mfxX")!;
    expect(channelForE2Param(mfxX, 5, 9)).toBe(9);
  });
});

describe("buildE2CcMessage", () => {
  it("baut Status/CC/Wert korrekt", () => {
    const cutoff = findE2CcParam("cutoff")!;
    expect(buildE2CcMessage(cutoff, 3, 100)).toEqual([0xb2, 74, 100]);
  });

  it("begrenzt einen zu großen Wert statt ihn überlaufen zu lassen", () => {
    const level = findE2CcParam("ampLevel")!;
    expect(buildE2CcMessage(level, 1, 999)).toEqual([0xb0, 7, 127]);
  });

  it("benutzt für globale Parameter den Global-Channel", () => {
    const mfxX = findE2CcParam("mfxX")!;
    expect(buildE2CcMessage(mfxX, 4, 64, 9)).toEqual([0xb9, 102, 64]);
  });
});

describe("scaleMidiToRange", () => {
  it("bildet den vollen Bereich identisch ab", () => {
    expect(scaleMidiToRange(0, 0, 127)).toBe(0);
    expect(scaleMidiToRange(127, 0, 127)).toBe(127);
    expect(scaleMidiToRange(64, 0, 127)).toBe(64);
  });

  it("begrenzt auf ein Teilintervall", () => {
    expect(scaleMidiToRange(0, 40, 100)).toBe(40);
    expect(scaleMidiToRange(127, 40, 100)).toBe(100);
    expect(scaleMidiToRange(64, 40, 100)).toBe(70); // 40 + 60*64/127 = 70.2
  });

  it("invertiert, wenn min > max", () => {
    expect(scaleMidiToRange(0, 127, 0)).toBe(127);
    expect(scaleMidiToRange(127, 127, 0)).toBe(0);
  });
});

describe("describeE2Target", () => {
  it("nennt Part und CC", () => {
    expect(describeE2Target(findE2CcParam("cutoff")!, 3)).toBe("Part 3 · Cutoff (CC 74)");
  });

  it("lässt den Part bei globalen Parametern weg", () => {
    expect(describeE2Target(findE2CcParam("mfxX")!, 3)).toBe("Global · MFX X (CC 102)");
  });
});

// ─── korgRemote (Matching + Übersetzung) ────────────────────────────────────

describe("ruleMatchesCc", () => {
  it("trifft bei gleicher CC-Nummer auf Omni", () => {
    expect(ruleMatchesCc(rule({ srcCc: 19, srcChannel: 0 }), { cc: 19, channel: 7, value: 0 })).toBe(true);
  });

  it("trifft nicht bei anderer CC-Nummer", () => {
    expect(ruleMatchesCc(rule({ srcCc: 19 }), { cc: 20, channel: 1, value: 0 })).toBe(false);
  });

  it("respektiert einen gesetzten Quell-Kanal", () => {
    const r = rule({ srcCc: 19, srcChannel: 2 });
    expect(ruleMatchesCc(r, { cc: 19, channel: 2, value: 0 })).toBe(true);
    expect(ruleMatchesCc(r, { cc: 19, channel: 3, value: 0 })).toBe(false);
  });

  it("trifft nie, wenn die Regel deaktiviert ist", () => {
    expect(ruleMatchesCc(rule({ srcCc: 19, enabled: false }), { cc: 19, channel: 1, value: 0 })).toBe(false);
  });
});

describe("buildKorgRemoteMessages", () => {
  it("übersetzt ein Fader-CC in ein Part-Level-CC", () => {
    const rules = [rule({ srcCc: 19, part: 3, param: "ampLevel" })];
    const out = buildKorgRemoteMessages(rules, { cc: 19, channel: 1, value: 100 });
    expect(out).toHaveLength(1);
    expect(out[0].messages).toEqual([[0xb2, 7, 100]]); // Part 3 → Kanal 2
    expect(out[0].value).toBe(100);
    expect(out[0].label).toBe("Part 3 · Level (CC 7)");
  });

  it("bedient mehrere Ziele aus einem einzigen Regler", () => {
    // Ein Fader auf Cutoff UND Resonance desselben Parts.
    const rules = [
      makeKorgRemoteRule({ id: "a", srcCc: 19, target: { kind: "cc", part: 1, param: "cutoff" } }),
      makeKorgRemoteRule({ id: "b", srcCc: 19, target: { kind: "cc", part: 1, param: "resonance" } }),
    ];
    const out = buildKorgRemoteMessages(rules, { cc: 19, channel: 1, value: 64 });
    expect(out.map((m) => m.messages[0][1])).toEqual([74, 71]);
  });

  it("liefert nichts, wenn keine Regel passt", () => {
    expect(buildKorgRemoteMessages([rule({ srcCc: 19 })], { cc: 77, channel: 1, value: 5 })).toEqual([]);
  });

  it("wendet den Wertebereich der Regel an", () => {
    const rules = [rule({ srcCc: 19, part: 1, param: "ampLevel", min: 40, max: 100 })];
    expect(buildKorgRemoteMessages(rules, { cc: 19, channel: 1, value: 0 })[0].value).toBe(40);
    expect(buildKorgRemoteMessages(rules, { cc: 19, channel: 1, value: 127 })[0].value).toBe(100);
  });

  it("überspringt Regeln mit unbekanntem Parameter statt zu werfen", () => {
    // Kann durch eine aus neuerer Version importierte Regel entstehen — darf
    // den Live-Betrieb nicht abbrechen.
    const broken: KorgRemoteRule = {
      ...rule({ srcCc: 19 }),
      target: { kind: "cc", part: 1, param: "ausDerZukunft" },
    };
    const ok = makeKorgRemoteRule({ id: "b", srcCc: 19, target: { kind: "cc", part: 2, param: "cutoff" } });
    const out = buildKorgRemoteMessages([broken, ok], { cc: 19, channel: 1, value: 10 });
    expect(out).toHaveLength(1);
    expect(out[0].rule.id).toBe("b");
  });

  it("routet globale Parameter auf den übergebenen Global-Channel", () => {
    const rules = [rule({ srcCc: 19, part: 7, param: "mfxX" })];
    const out = buildKorgRemoteMessages(rules, { cc: 19, channel: 1, value: 64 }, 9);
    expect(out[0].messages[0][0]).toBe(0xb9);
  });
});

describe("makeKorgRemoteRule", () => {
  it("setzt vernünftige Vorgaben", () => {
    const r = makeKorgRemoteRule({ id: "x" });
    expect(r).toMatchObject({ enabled: true, srcChannel: 0, min: 0, max: 127 });
    expect(r.target).toEqual({ kind: "cc", part: 1, param: "ampLevel" });
  });

  it("normalisiert unsinnige Werte statt sie durchzulassen", () => {
    const r = makeKorgRemoteRule({ id: "x", srcCc: 999, part: 99, srcChannel: 42, min: -10, max: 999 });
    expect(r.srcCc).toBe(127);
    expect(r.target).toEqual({ kind: "cc", part: 16, param: "ampLevel" });
    expect(r.srcChannel).toBe(0); // außerhalb 1..16 → Omni
    expect(r.min).toBe(0);
    expect(r.max).toBe(127);
  });

  it("ersetzt einen unbekannten Parameter durch den Default", () => {
    expect(makeKorgRemoteRule({ id: "x", param: "quatsch" }).target).toEqual({
      kind: "cc",
      part: 1,
      param: "ampLevel",
    });
  });
});

describe("buildRuleBank", () => {
  it("legt eine Regel pro CC auf aufsteigende Parts", () => {
    const bank = buildRuleBank(MIDIMIX_FADER_CCS, "ampLevel");
    expect(bank).toHaveLength(8);
    expect(bank.map((r) => r.srcCc)).toEqual([...MIDIMIX_FADER_CCS]);
    expect(bank.map((r) => (r.target as { part: number }).part)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bank.every((r) => r.target.kind === "cc" && r.target.param === "ampLevel")).toBe(true);
  });

  it("respektiert einen abweichenden Start-Part", () => {
    const bank = buildRuleBank(MIDIMIX_KNOB_ROW1_CCS, "cutoff", { startPart: 9 });
    expect(bank.map((r) => (r.target as { part: number }).part)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("vergibt eindeutige IDs", () => {
    const bank = buildRuleBank(MIDIMIX_FADER_CCS, "ampLevel");
    expect(new Set(bank.map((r) => r.id)).size).toBe(bank.length);
  });

  it("bildet den kompletten MIDImix-Fader-Satz auf die Korg ab (End-to-End)", () => {
    const bank = buildRuleBank(MIDIMIX_FADER_CCS, "ampLevel");
    // Fader 5 (CC 49) ganz oben → Part 5 Level auf Anschlag, Kanal 4.
    const out = buildKorgRemoteMessages(bank, { cc: 49, channel: 1, value: 127 });
    expect(out).toHaveLength(1);
    expect(out[0].messages).toEqual([[0xb4, 7, 127]]);
  });
});

// ─── Store ──────────────────────────────────────────────────────────────────

describe("useKorgRemoteStore", () => {
  beforeEach(() => {
    __resetKorgRemoteForTests();
  });

  it("startet ausgeschaltet und ohne Regeln", () => {
    const st = getKorgRemoteState();
    // Aus per Default: eine Fernsteuerung, die ungefragt an fremde Hardware
    // sendet, wäre eine böse Überraschung.
    expect(st.enabled).toBe(false);
    expect(st.rules).toEqual([]);
    expect(st.learnTarget).toBeNull();
  });

  it("legt Regeln an, ändert und löscht sie", () => {
    const r = addKorgRemoteRule({ srcCc: 19, target: { kind: "cc", part: 2, param: "cutoff" } });
    expect(getKorgRemoteState().rules).toHaveLength(1);

    updateKorgRemoteRule(r.id, { target: { kind: "cc", part: 5, param: "cutoff" } });
    expect(getKorgRemoteState().rules[0].target).toEqual({ kind: "cc", part: 5, param: "cutoff" });

    removeKorgRemoteRule(r.id);
    expect(getKorgRemoteState().rules).toEqual([]);
  });

  it("normalisiert auch beim Update", () => {
    const r = addKorgRemoteRule({ srcCc: 19 });
    updateKorgRemoteRule(r.id, { target: { kind: "cc", part: 99, param: "cutoff" } });
    expect(getKorgRemoteState().rules[0].target).toEqual({ kind: "cc", part: 16, param: "cutoff" });
  });

  it("fügt einen ganzen Regelsatz auf einmal hinzu", () => {
    addKorgRemoteRules(buildRuleBank(MIDIMIX_FADER_CCS, "ampLevel"));
    expect(getKorgRemoteState().rules).toHaveLength(8);
    clearKorgRemoteRules();
    expect(getKorgRemoteState().rules).toEqual([]);
  });

  it("schließt Learn mit dem bewegten Regler ab", () => {
    startKorgRemoteLearn({ kind: "cc", part: 4, param: "cutoff" });
    expect(getKorgRemoteState().learnTarget).toEqual({ kind: "cc", part: 4, param: "cutoff" });

    const created = completeKorgRemoteLearn(23, 1);
    expect(created).not.toBeNull();
    expect(created!).toMatchObject({ srcCc: 23, srcChannel: 1 });
    expect(created!.target).toEqual({ kind: "cc", part: 4, param: "cutoff" });
    expect(getKorgRemoteState().learnTarget).toBeNull();
  });

  it("ersetzt beim erneuten Lernen desselben Ziels, statt zu doppeln", () => {
    startKorgRemoteLearn({ kind: "cc", part: 4, param: "cutoff" });
    completeKorgRemoteLearn(23, 1);
    startKorgRemoteLearn({ kind: "cc", part: 4, param: "cutoff" });
    completeKorgRemoteLearn(24, 1);

    const rules = getKorgRemoteState().rules;
    expect(rules).toHaveLength(1);
    expect(rules[0].srcCc).toBe(24);
  });

  it("bricht Learn ab — durch cancel und durch erneuten Klick auf dasselbe Ziel", () => {
    startKorgRemoteLearn({ kind: "cc", part: 1, param: "pan" });
    cancelKorgRemoteLearn();
    expect(getKorgRemoteState().learnTarget).toBeNull();

    startKorgRemoteLearn({ kind: "cc", part: 1, param: "pan" });
    startKorgRemoteLearn({ kind: "cc", part: 1, param: "pan" }); // Toggle
    expect(getKorgRemoteState().learnTarget).toBeNull();
  });

  it("liefert null, wenn ohne aktiven Learn abgeschlossen wird", () => {
    expect(completeKorgRemoteLearn(19, 1)).toBeNull();
    expect(getKorgRemoteState().rules).toEqual([]);
  });

  it("persistiert Regeln und Einstellungen — aber niemals einen offenen Learn", () => {
    setKorgRemoteEnabled(true);
    setKorgRemoteGlobalChannel(9);
    addKorgRemoteRule({ srcCc: 19, target: { kind: "cc", part: 2, param: "cutoff" } });
    startKorgRemoteLearn({ kind: "cc", part: 3, param: "pan" });

    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.enabled).toBe(true);
    expect(parsed.globalChannel).toBe(9);
    expect(parsed.rules).toHaveLength(1);
    // Ein beim Beenden offener Learn dürfte nach dem Neustart nicht heimlich
    // den ersten bewegten Regler kapern.
    expect(parsed.learnTarget).toBeNull();
  });

  it("liest Regeln beim Laden zurück und startet ohne offenen Learn", () => {
    setKorgRemoteEnabled(true);
    setKorgRemoteGlobalChannel(9);
    addKorgRemoteRule({ srcCc: 19, target: { kind: "cc", part: 2, param: "cutoff" } });
    startKorgRemoteLearn({ kind: "cc", part: 3, param: "pan" });

    __reloadKorgRemoteForTests();

    const st = getKorgRemoteState();
    expect(st.enabled).toBe(true);
    expect(st.globalChannel).toBe(9);
    expect(st.rules).toHaveLength(1);
    expect(st.rules[0].srcCc).toBe(19);
    expect(st.rules[0].target).toEqual({ kind: "cc", part: 2, param: "cutoff" });
    expect(st.learnTarget).toBeNull();
  });

  it("fällt bei kaputtem localStorage-Inhalt auf Defaults zurück statt zu werfen", () => {
    localStorage.setItem(STORAGE_KEY, "[[kein json");
    expect(() => __reloadKorgRemoteForTests()).not.toThrow();
    expect(getKorgRemoteState().rules).toEqual([]);
    expect(getKorgRemoteState().enabled).toBe(false);
  });

  it("wirft beim Laden kaputte Regeln raus und normalisiert die brauchbaren", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        rules: [null, { kein: "id" }, { id: "ok", srcCc: 999, part: 42, param: "cutoff" }],
      }),
    );
    __reloadKorgRemoteForTests();

    const rules = getKorgRemoteState().rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: "ok", srcCc: 127 });
    expect(rules[0].target).toEqual({ kind: "cc", part: 16, param: "cutoff" });
  });
});

// ─── Hacktribe-NRPN (schreibende Schicht) ───────────────────────────────────
//
// Diese Kommandos existieren nur auf Hacktribe-Firmware. Sie sind gewöhnlicher
// MIDI-Verkehr — anders als die Sysex-RAM/Flash-Kommandos (0x52–0x58), die
// bewusst NICHT angebunden sind.

describe("buildNrpn", () => {
  it("baut die vier CCs in der vorgeschriebenen Reihenfolge", () => {
    // Reihenfolge ist Teil des Protokolls: MSB, LSB, DATA-MSB, DATA-LSB.
    expect(buildNrpn(0, 1, 2, 3, 4)).toEqual([
      [0xb0, NRPN_CC.msb, 1],
      [0xb0, NRPN_CC.lsb, 2],
      [0xb0, NRPN_CC.dataMsb, 3],
      [0xb0, NRPN_CC.dataLsb, 4],
    ]);
  });

  it("legt alle vier CCs auf denselben Kanal", () => {
    const msgs = buildNrpn(9, 0, 0, 0, 0);
    expect(msgs.every((m) => m[0] === 0xb9)).toBe(true);
  });

  it("begrenzt jedes Byte auf 7 Bit und den Kanal auf 0..15", () => {
    expect(buildNrpn(99, 999, -1, 500, 128)).toEqual([
      [0xbf, NRPN_CC.msb, 127],
      [0xbf, NRPN_CC.lsb, 0],
      [0xbf, NRPN_CC.dataMsb, 127],
      [0xbf, NRPN_CC.dataLsb, 127],
    ]);
  });
});

describe("fxSlotForPart", () => {
  it("rechnet Part+Slot flach: part*2 + slot, 0-basiert", () => {
    expect(fxSlotForPart(1, 0)).toBe(0);
    expect(fxSlotForPart(1, 1)).toBe(1);
    expect(fxSlotForPart(2, 0)).toBe(2);
    expect(fxSlotForPart(16, 1)).toBe(31);
  });

  it("begrenzt den Part auf 1..16", () => {
    expect(fxSlotForPart(0, 0)).toBe(0);
    expect(fxSlotForPart(99, 0)).toBe(30);
  });

  it("kollidiert nicht mit dem MFX-Slot", () => {
    // MFX = 0x20 = 32, direkt oberhalb des höchsten Part-Slots (31).
    expect(MFX_SLOT).toBe(0x20);
    expect(fxSlotForPart(16, 1)).toBeLessThan(MFX_SLOT);
  });
});

describe("buildSetFxParam", () => {
  it("adressiert Part 3 / IFX 2 über den flachen Slot-Index", () => {
    const msgs = buildSetFxParam(0, fxSlotForPart(3, 1), 5, 100);
    expect(msgs[0][2]).toBe(NRPN_CATEGORY.setFxParam);
    expect(msgs[1][2]).toBe(5); // part 3 → (3-1)*2 + 1 = 5
    expect(msgs[2][2]).toBe(5); // Param-Index
    expect(msgs[3][2]).toBe(100);
  });

  it("adressiert das Master-FX über MFX_SLOT", () => {
    expect(buildSetFxParam(0, MFX_SLOT, 0, 64)[1][2]).toBe(0x20);
  });
});

describe("buildPanelControl", () => {
  it("schaltet ein Pad stumm", () => {
    const msgs = buildPanelControl(0, "mute", 2, 1);
    expect(msgs[0][2]).toBe(NRPN_CATEGORY.panelControl);
    expect(msgs[1][2]).toBe(PANEL_MODE.mute);
    expect(msgs[2][2]).toBe(2);
    expect(msgs[3][2]).toBe(1);
  });

  it("kennt alle zehn Pad-Modi mit ihren Geräte-Codes", () => {
    expect(PANEL_MODE).toMatchObject({
      mute: 0, solo: 1, erase: 2, trigger: 3, sequencer: 4,
      keyboard: 5, chord: 6, stepJump: 7, patternAssign: 8, patternSet: 9,
    });
  });

  it("liefert für jeden Modus ein Label", () => {
    for (const m of Object.keys(PANEL_MODE) as PanelMode[]) {
      expect(labelForPanelMode(m).length).toBeGreaterThan(0);
    }
  });
});

describe("buildGlobalParam", () => {
  it("teilt den 14-bit-Index auf LSB (high) und DATA-MSB (low)", () => {
    // 0x1234 = 4660 → high 7 bit = 0x24, low 7 bit = 0x34
    const msgs = buildGlobalParam(0, 0x1234, 77);
    expect(msgs[0][2]).toBe(NRPN_CATEGORY.globalParam);
    expect(msgs[1][2]).toBe(0x24);
    expect(msgs[2][2]).toBe(0x34);
    expect(msgs[3][2]).toBe(77);
  });

  it("begrenzt den Index auf 14 Bit", () => {
    const msgs = buildGlobalParam(0, 0xffff, 0);
    expect(msgs[1][2]).toBe(0x7f);
    expect(msgs[2][2]).toBe(0x7f);
  });
});

describe("buildSequenceParam", () => {
  it("adressiert Step und Parameter — der einzige MIDI-Weg zu Motion-Steps", () => {
    const msgs = buildSequenceParam(0, 12, 3, 90);
    expect(msgs[0][2]).toBe(NRPN_CATEGORY.sequenceParam);
    expect(msgs[0][2]).toBe(9); // Kategorie 9 laut ht_nrpn_format
    expect(msgs[1][2]).toBe(12);
    expect(msgs[2][2]).toBe(3);
    expect(msgs[3][2]).toBe(90);
  });
});

describe("buildMapFxParam", () => {
  it("sendet genau fünf NRPN-Nachrichten in fester Reihenfolge", () => {
    const msgs = buildMapFxParam(0, MFX_SLOT, {
      mapSlot: 0,
      sourceControl: FX_SOURCE_CONTROL.fxEditX,
      targetParam: 4,
      minValue: 10,
      maxValue: 120,
    });
    expect(msgs).toHaveLength(20); // 5 × 4 CCs

    // Die Sub-Indizes laufen 0..4 durch, die Werte folgen dem Mapping.
    const subIndexes = [0, 1, 2, 3, 4].map((i) => msgs[i * 4 + 2][2]);
    const values = [0, 1, 2, 3, 4].map((i) => msgs[i * 4 + 3][2]);
    expect(subIndexes).toEqual([0, 1, 2, 3, 4]);
    expect(values).toEqual([0, FX_SOURCE_CONTROL.fxEditX, 4, 10, 120]);
  });

  it("trägt in jeder Teil-Nachricht denselben FX-Slot", () => {
    const msgs = buildMapFxParam(0, 7, {
      mapSlot: 1, sourceControl: 0, targetParam: 0, minValue: 0, maxValue: 127,
    });
    for (let i = 0; i < 5; i++) expect(msgs[i * 4 + 1][2]).toBe(7);
  });
});

// ─── Ziel-Union ─────────────────────────────────────────────────────────────

describe("Ziel-Arten", () => {
  it("markiert nur `cc` als Hacktribe-frei", () => {
    expect(targetNeedsHacktribe("cc")).toBe(false);
    for (const k of KORG_TARGET_KINDS.filter((k) => k !== "cc")) {
      expect(targetNeedsHacktribe(k)).toBe(true);
    }
  });

  it("liefert für jede Art ein Label", () => {
    for (const k of KORG_TARGET_KINDS) {
      expect(labelForTargetKind(k).length).toBeGreaterThan(0);
    }
  });

  it("beschreibt jede Art lesbar", () => {
    expect(describeKorgRemoteTarget({ kind: "cc", part: 3, param: "cutoff" }))
      .toBe("Part 3 · Cutoff (CC 74)");
    expect(describeKorgRemoteTarget({ kind: "panel", mode: "solo", padIndex: 2 }))
      .toBe("Panel · Solo Pad 2");
    expect(describeKorgRemoteTarget({ kind: "fxParam", part: 2, slot: 1, paramIndex: 5 }))
      .toBe("Part 2 IFX 2 · Param 5");
    expect(describeKorgRemoteTarget({ kind: "fxParam", part: 2, slot: "mfx", paramIndex: 5 }))
      .toBe("MFX · Param 5");
    expect(describeKorgRemoteTarget({ kind: "globalParam", paramIndex: 12 }))
      .toBe("Global-Param 12");
    expect(describeKorgRemoteTarget({ kind: "seqParam", stepIndex: 4, paramIndex: 1 }))
      .toBe("Step 4 · Param 1");
  });
});

describe("korgTargetsEqual", () => {
  it("unterscheidet Arten", () => {
    expect(korgTargetsEqual(
      { kind: "cc", part: 1, param: "pan" },
      { kind: "panel", mode: "mute", padIndex: 1 },
    )).toBe(false);
  });

  it("vergleicht innerhalb einer Art alle Felder", () => {
    expect(korgTargetsEqual(
      { kind: "fxParam", part: 2, slot: 1, paramIndex: 3 },
      { kind: "fxParam", part: 2, slot: 1, paramIndex: 3 },
    )).toBe(true);
    expect(korgTargetsEqual(
      { kind: "fxParam", part: 2, slot: 1, paramIndex: 3 },
      { kind: "fxParam", part: 2, slot: 0, paramIndex: 3 },
    )).toBe(false);
  });

  it("erkennt gleiche Panel-Ziele", () => {
    expect(korgTargetsEqual(
      { kind: "panel", mode: "mute", padIndex: 4 },
      { kind: "panel", mode: "mute", padIndex: 4 },
    )).toBe(true);
  });
});

describe("normalizeTarget", () => {
  it("hebt das Altformat (part/param direkt auf der Regel) auf ein cc-Ziel", () => {
    // Ohne diese Migration verlöre jeder seine bereits angelegten Regeln.
    expect(normalizeTarget({ part: 4, param: "cutoff" }))
      .toEqual({ kind: "cc", part: 4, param: "cutoff" });
  });

  it("fällt bei Müll auf ein sicheres cc-Ziel zurück", () => {
    expect(normalizeTarget(null)).toEqual({ kind: "cc", part: 1, param: "ampLevel" });
    expect(normalizeTarget("quatsch")).toEqual({ kind: "cc", part: 1, param: "ampLevel" });
    expect(normalizeTarget({ kind: "gibtsNicht" })).toEqual({ kind: "cc", part: 1, param: "ampLevel" });
  });

  it("normalisiert unsinnige Panel- und FX-Felder", () => {
    expect(normalizeTarget({ kind: "panel", mode: "erfunden", padIndex: 999 }))
      .toEqual({ kind: "panel", mode: "mute", padIndex: 127 });
    expect(normalizeTarget({ kind: "fxParam", part: 99, slot: 7, paramIndex: -3 }))
      .toEqual({ kind: "fxParam", part: 16, slot: 0, paramIndex: 0 });
  });
});

describe("buildKorgRemoteMessages mit NRPN-Zielen", () => {
  it("erzeugt für ein Panel-Ziel vier CCs auf dem Global-Channel", () => {
    const r = rule({ srcCc: 1, target: { kind: "panel", mode: "mute", padIndex: 2 }, min: 0, max: 1 });
    const out = buildKorgRemoteMessages([r], { cc: 1, channel: 1, value: 127 }, 9);
    expect(out).toHaveLength(1);
    expect(out[0].messages).toHaveLength(4);
    expect(out[0].messages.every((m) => m[0] === 0xb9)).toBe(true);
    // Taster ganz gedrückt → Wertebereich 0..1 → 1 = stumm.
    expect(out[0].value).toBe(1);
    expect(out[0].messages[3][2]).toBe(1);
  });

  it("schickt einen losgelassenen Taster als 0 (Mute aus)", () => {
    const r = rule({ srcCc: 1, target: { kind: "panel", mode: "mute", padIndex: 2 }, min: 0, max: 1 });
    expect(buildKorgRemoteMessages([r], { cc: 1, channel: 1, value: 0 })[0].value).toBe(0);
  });

  it("fährt einen FX-Parameter mit dem vollen Fader-Weg", () => {
    const r = rule({ srcCc: 19, target: { kind: "fxParam", part: 1, slot: 0, paramIndex: 2 } });
    const out = buildKorgRemoteMessages([r], { cc: 19, channel: 1, value: 64 });
    expect(out[0].messages[0][2]).toBe(NRPN_CATEGORY.setFxParam);
    expect(out[0].messages[1][2]).toBe(0); // Part 1, IFX 1
    expect(out[0].messages[3][2]).toBe(64);
  });

  it("schreibt einen Motion-Step", () => {
    const r = rule({ srcCc: 19, target: { kind: "seqParam", stepIndex: 7, paramIndex: 2 } });
    const out = buildKorgRemoteMessages([r], { cc: 19, channel: 1, value: 100 });
    expect(out[0].messages[0][2]).toBe(NRPN_CATEGORY.sequenceParam);
    expect(out[0].messages[1][2]).toBe(7);
  });

  it("mischt CC- und NRPN-Ziele auf demselben Regler", () => {
    // Ein Fader fährt gleichzeitig den Stock-Level und einen FX-Parameter.
    const rules = [
      makeKorgRemoteRule({ id: "a", srcCc: 19, target: { kind: "cc", part: 1, param: "ampLevel" } }),
      makeKorgRemoteRule({ id: "b", srcCc: 19, target: { kind: "fxParam", part: 1, slot: 0, paramIndex: 1 } }),
    ];
    const out = buildKorgRemoteMessages(rules, { cc: 19, channel: 1, value: 100 });
    expect(out.map((m) => m.messages.length)).toEqual([1, 4]);
  });
});

describe("buildPanelBank", () => {
  it("legt ein Pad pro CC an, aufsteigend und 0-basiert", () => {
    const bank = buildPanelBank([1, 4, 7], "mute");
    expect(bank.map((r) => (r.target as { padIndex: number }).padIndex)).toEqual([0, 1, 2]);
    expect(bank.every((r) => r.target.kind === "panel")).toBe(true);
  });

  it("begrenzt den Wertebereich auf 0..1 — Panel-Schalter erwarten genau das", () => {
    const bank = buildPanelBank([1], "solo");
    expect(bank[0].min).toBe(0);
    expect(bank[0].max).toBe(1);
  });

  it("respektiert einen abweichenden Start-Pad", () => {
    const bank = buildPanelBank([1, 4], "trigger", { startPad: 8 });
    expect(bank.map((r) => (r.target as { padIndex: number }).padIndex)).toEqual([8, 9]);
  });
});

describe("Learn mit NRPN-Zielen", () => {
  beforeEach(() => {
    __resetKorgRemoteForTests();
  });

  it("bindet einen Taster an ein Panel-Ziel und setzt den Bereich auf 0/1", () => {
    startKorgRemoteLearn({ kind: "panel", mode: "mute", padIndex: 3 });
    const created = completeKorgRemoteLearn(4, 1);
    expect(created!.target).toEqual({ kind: "panel", mode: "mute", padIndex: 3 });
    // Ein durchlaufender Regler würde sonst wilde Panel-Werte schicken.
    expect(created!.min).toBe(0);
    expect(created!.max).toBe(1);
  });

  it("ersetzt auch bei NRPN-Zielen statt zu doppeln", () => {
    startKorgRemoteLearn({ kind: "fxParam", part: 1, slot: 0, paramIndex: 2 });
    completeKorgRemoteLearn(19, 1);
    startKorgRemoteLearn({ kind: "fxParam", part: 1, slot: 0, paramIndex: 2 });
    completeKorgRemoteLearn(23, 1);
    const rules = getKorgRemoteState().rules;
    expect(rules).toHaveLength(1);
    expect(rules[0].srcCc).toBe(23);
  });

  it("hält Ziele verschiedener Arten auseinander", () => {
    startKorgRemoteLearn({ kind: "cc", part: 1, param: "ampLevel" });
    completeKorgRemoteLearn(19, 1);
    startKorgRemoteLearn({ kind: "panel", mode: "mute", padIndex: 0 });
    completeKorgRemoteLearn(19, 1);
    // Gleiches Quell-CC, verschiedene Ziele → beide bleiben bestehen.
    expect(getKorgRemoteState().rules).toHaveLength(2);
  });
});

// ─── FX-Zuweisungs-Metadaten (fuer die map_fx_param-Oberflaeche) ─────────────

describe("FX_SOURCE_CONTROL-Metadaten", () => {
  it("listet jeden Code genau einmal und deckt die Tabelle vollständig ab", () => {
    const keys = new Set(FX_SOURCE_CONTROL_KEYS);
    expect(keys.size).toBe(FX_SOURCE_CONTROL_KEYS.length);
    // Die Anzeigeliste darf keinen Eintrag der Quelltabelle unterschlagen.
    expect(keys).toEqual(new Set(Object.keys(FX_SOURCE_CONTROL) as FxSourceControl[]));
  });

  it("führt die Codes aus dem Preset-Format, nicht die des RAM-Formats", () => {
    // ht_fx_preset_format.py: 0x41..0x4A. Das RAM-Format benutzt 0x01..0x0A für
    // dieselben Elemente — wer die verwechselt, verdrahtet stillschweigend
    // falsche Bedienelemente.
    expect(FX_SOURCE_CONTROL.none).toBe(0x00);
    expect(FX_SOURCE_CONTROL.fxOn).toBe(0x41);
    expect(FX_SOURCE_CONTROL.fxEditX).toBe(0x42);
    expect(FX_SOURCE_CONTROL.fxEditY).toBe(0x43);
    expect(FX_SOURCE_CONTROL.pressPlay).toBe(0x4a);
  });

  it("liefert für jedes Element ein Label", () => {
    for (const k of FX_SOURCE_CONTROL_KEYS) {
      expect(labelForFxSourceControl(k).length).toBeGreaterThan(0);
    }
  });

  it("kennt die 10 Map-Slots des FX-Presets", () => {
    // control_map = 10 × fx_control (28 B) laut ht_fx_preset_format.py.
    expect(FX_MAP_SLOT_COUNT).toBe(10);
  });
});
