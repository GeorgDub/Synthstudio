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
  MIDIMIX_FADER_CCS,
  MIDIMIX_KNOB_ROW1_CCS,
  buildKorgRemoteMessages,
  buildRuleBank,
  makeKorgRemoteRule,
  ruleMatchesCc,
  type KorgRemoteRule,
} from "@/utils/korg/korgRemote";
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

function rule(patch: Partial<KorgRemoteRule> = {}): KorgRemoteRule {
  return makeKorgRemoteRule({ id: "r1", ...patch });
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
    expect(out[0].bytes).toEqual([0xb2, 7, 100]); // Part 3 → Kanal 2
    expect(out[0].value).toBe(100);
  });

  it("bedient mehrere Ziele aus einem einzigen Regler", () => {
    // Ein Fader auf Cutoff UND Resonance desselben Parts.
    const rules = [
      makeKorgRemoteRule({ id: "a", srcCc: 19, part: 1, param: "cutoff" }),
      makeKorgRemoteRule({ id: "b", srcCc: 19, part: 1, param: "resonance" }),
    ];
    const out = buildKorgRemoteMessages(rules, { cc: 19, channel: 1, value: 64 });
    expect(out.map((m) => m.bytes[1])).toEqual([74, 71]);
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
    const broken = { ...rule({ srcCc: 19 }), param: "ausDerZukunft" };
    const ok = makeKorgRemoteRule({ id: "b", srcCc: 19, part: 2, param: "cutoff" });
    const out = buildKorgRemoteMessages([broken, ok], { cc: 19, channel: 1, value: 10 });
    expect(out).toHaveLength(1);
    expect(out[0].param.key).toBe("cutoff");
  });

  it("routet globale Parameter auf den übergebenen Global-Channel", () => {
    const rules = [rule({ srcCc: 19, part: 7, param: "mfxX" })];
    const out = buildKorgRemoteMessages(rules, { cc: 19, channel: 1, value: 64 }, 9);
    expect(out[0].bytes[0]).toBe(0xb9);
  });
});

describe("makeKorgRemoteRule", () => {
  it("setzt vernünftige Vorgaben", () => {
    const r = makeKorgRemoteRule({ id: "x" });
    expect(r).toMatchObject({ enabled: true, srcChannel: 0, part: 1, param: "ampLevel", min: 0, max: 127 });
  });

  it("normalisiert unsinnige Werte statt sie durchzulassen", () => {
    const r = makeKorgRemoteRule({ id: "x", srcCc: 999, part: 99, srcChannel: 42, min: -10, max: 999 });
    expect(r.srcCc).toBe(127);
    expect(r.part).toBe(16);
    expect(r.srcChannel).toBe(0); // außerhalb 1..16 → Omni
    expect(r.min).toBe(0);
    expect(r.max).toBe(127);
  });

  it("ersetzt einen unbekannten Parameter durch den Default", () => {
    expect(makeKorgRemoteRule({ id: "x", param: "quatsch" }).param).toBe("ampLevel");
  });
});

describe("buildRuleBank", () => {
  it("legt eine Regel pro CC auf aufsteigende Parts", () => {
    const bank = buildRuleBank(MIDIMIX_FADER_CCS, "ampLevel");
    expect(bank).toHaveLength(8);
    expect(bank.map((r) => r.srcCc)).toEqual([...MIDIMIX_FADER_CCS]);
    expect(bank.map((r) => r.part)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bank.every((r) => r.param === "ampLevel")).toBe(true);
  });

  it("respektiert einen abweichenden Start-Part", () => {
    const bank = buildRuleBank(MIDIMIX_KNOB_ROW1_CCS, "cutoff", { startPart: 9 });
    expect(bank.map((r) => r.part)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
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
    expect(out[0].bytes).toEqual([0xb4, 7, 127]);
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
    const r = addKorgRemoteRule({ srcCc: 19, part: 2, param: "cutoff" });
    expect(getKorgRemoteState().rules).toHaveLength(1);

    updateKorgRemoteRule(r.id, { part: 5 });
    expect(getKorgRemoteState().rules[0].part).toBe(5);

    removeKorgRemoteRule(r.id);
    expect(getKorgRemoteState().rules).toEqual([]);
  });

  it("normalisiert auch beim Update", () => {
    const r = addKorgRemoteRule({ srcCc: 19 });
    updateKorgRemoteRule(r.id, { part: 99 });
    expect(getKorgRemoteState().rules[0].part).toBe(16);
  });

  it("fügt einen ganzen Regelsatz auf einmal hinzu", () => {
    addKorgRemoteRules(buildRuleBank(MIDIMIX_FADER_CCS, "ampLevel"));
    expect(getKorgRemoteState().rules).toHaveLength(8);
    clearKorgRemoteRules();
    expect(getKorgRemoteState().rules).toEqual([]);
  });

  it("schließt Learn mit dem bewegten Regler ab", () => {
    startKorgRemoteLearn(4, "cutoff");
    expect(getKorgRemoteState().learnTarget).toEqual({ part: 4, param: "cutoff" });

    const created = completeKorgRemoteLearn(23, 1);
    expect(created).not.toBeNull();
    expect(created!).toMatchObject({ srcCc: 23, srcChannel: 1, part: 4, param: "cutoff" });
    expect(getKorgRemoteState().learnTarget).toBeNull();
  });

  it("ersetzt beim erneuten Lernen desselben Ziels, statt zu doppeln", () => {
    startKorgRemoteLearn(4, "cutoff");
    completeKorgRemoteLearn(23, 1);
    startKorgRemoteLearn(4, "cutoff");
    completeKorgRemoteLearn(24, 1);

    const rules = getKorgRemoteState().rules;
    expect(rules).toHaveLength(1);
    expect(rules[0].srcCc).toBe(24);
  });

  it("bricht Learn ab — durch cancel und durch erneuten Klick auf dasselbe Ziel", () => {
    startKorgRemoteLearn(1, "pan");
    cancelKorgRemoteLearn();
    expect(getKorgRemoteState().learnTarget).toBeNull();

    startKorgRemoteLearn(1, "pan");
    startKorgRemoteLearn(1, "pan"); // Toggle
    expect(getKorgRemoteState().learnTarget).toBeNull();
  });

  it("liefert null, wenn ohne aktiven Learn abgeschlossen wird", () => {
    expect(completeKorgRemoteLearn(19, 1)).toBeNull();
    expect(getKorgRemoteState().rules).toEqual([]);
  });

  it("persistiert Regeln und Einstellungen — aber niemals einen offenen Learn", () => {
    setKorgRemoteEnabled(true);
    setKorgRemoteGlobalChannel(9);
    addKorgRemoteRule({ srcCc: 19, part: 2, param: "cutoff" });
    startKorgRemoteLearn(3, "pan");

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
    addKorgRemoteRule({ srcCc: 19, part: 2, param: "cutoff" });
    startKorgRemoteLearn(3, "pan");

    __reloadKorgRemoteForTests();

    const st = getKorgRemoteState();
    expect(st.enabled).toBe(true);
    expect(st.globalChannel).toBe(9);
    expect(st.rules).toHaveLength(1);
    expect(st.rules[0]).toMatchObject({ srcCc: 19, part: 2, param: "cutoff" });
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
    expect(rules[0]).toMatchObject({ id: "ok", srcCc: 127, part: 16, param: "cutoff" });
  });
});
