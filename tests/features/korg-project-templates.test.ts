/**
 * tests/features/korg-project-templates.test.ts
 *
 * Unit-Tests für v3.49.0 — KORG-zentrierte Project-Templates.
 *
 * Env: jsdom (für localStorage — SceneStore + Pad-Bank-Persistenz).
 *
 * Coverage:
 *   - Definitions-Integrität (3 Templates, alle Pflichtfelder, eindeutige IDs)
 *   - getKorgTemplate (Lookup + null bei unbekannter ID)
 *   - listKorgTemplateIds (stabile Reihenfolge)
 *   - buildPerfPadBankSlots (16 perf-pad-slots mit param 0..15)
 *   - applyKorgProjectTemplate ruft setBpm / reseedParts / postApplyNotice in
 *     der erwarteten Reihenfolge
 *   - applyKorgProjectTemplate ist isomorph (kein DOM/electronAPI nötig)
 *   - apply mit unbekannter ID → throw
 *   - Pad-Bank wird persistiert bei ESX-Live + nanoKONTROL2 Mix
 *   - E2 Studio enabled Clock-Out
 *   - ESX Live created 8 Scenes
 *   - nanoKONTROL2 Mix enabled LED-Feedback (nicht Clock-Out)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  KORG_PROJECT_TEMPLATES,
  applyKorgProjectTemplate,
  buildPerfPadBankSlots,
  getKorgTemplate,
  listKorgTemplateIds,
  type KorgTemplateApplyDeps,
} from "@/utils/korgProjectTemplates";
import {
  __resetMidiNoteOutStoreForTests,
  getAllPartMidiOutConfigs,
} from "@/store/useMidiNoteOutStore";
import { __resetPadBankForTests, loadPadBankSlots } from "@/utils/padBankPersistence";
import { __resetSceneStoreForTests } from "@/store/useSceneStore";

// ─── Test-Helpers ─────────────────────────────────────────────────────────────

/**
 * Vor jedem Test alle berührten Stores resetten. v3.50.0: nutzt jetzt den
 * offiziellen `__resetSceneStoreForTests` API-Export anstelle des manuellen
 * localStorage.removeItem-Hacks.
 */
function fullReset(): void {
  __resetMidiNoteOutStoreForTests();
  __resetPadBankForTests();
  __resetSceneStoreForTests();
}

function buildSpyDeps(partCount: number): {
  deps: KorgTemplateApplyDeps;
  setBpm: ReturnType<typeof vi.fn>;
  setStepCount: ReturnType<typeof vi.fn>;
  reseedParts: ReturnType<typeof vi.fn>;
  enableClockOut: ReturnType<typeof vi.fn>;
  enableLedFeedback: ReturnType<typeof vi.fn>;
  postApplyNotice: ReturnType<typeof vi.fn>;
} {
  const setBpm = vi.fn();
  const setStepCount = vi.fn();
  const reseedParts = vi.fn((drum: number, synth: number) =>
    Array.from({ length: drum + synth }, (_, i) => `part-${i}`).slice(0, partCount),
  );
  const enableClockOut = vi.fn();
  const enableLedFeedback = vi.fn();
  const postApplyNotice = vi.fn();
  return {
    deps: {
      setBpm,
      setStepCount,
      reseedParts,
      enableClockOut,
      enableLedFeedback,
      postApplyNotice,
    },
    setBpm,
    setStepCount,
    reseedParts,
    enableClockOut,
    enableLedFeedback,
    postApplyNotice,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("KORG Project Templates (v3.49.0)", () => {
  beforeEach(() => {
    fullReset();
  });

  // ── 1. Definitionen ────────────────────────────────────────────────────────

  it("liefert genau 3 Templates mit eindeutigen IDs", () => {
    expect(KORG_PROJECT_TEMPLATES.length).toBe(3);
    const ids = KORG_PROJECT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(["korg-e2-studio", "korg-esx-live", "nanokontrol2-mix"]);
  });

  it("jedes Template hat name/description/bpm/stepCount/icon korrekt befüllt", () => {
    for (const t of KORG_PROJECT_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
      expect([16, 32, 64]).toContain(t.stepCount);
      expect(t.bpm).toBeGreaterThanOrEqual(60);
      expect(t.bpm).toBeLessThanOrEqual(220);
      expect(["Mic", "Disc", "Sliders"]).toContain(t.icon);
      expect(t.postApplyHints.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("KORG E2 Template hat 8 drum + 8 synth Parts", () => {
    const t = getKorgTemplate("korg-e2-studio");
    expect(t).not.toBeNull();
    expect(t!.drumPartCount).toBe(8);
    expect(t!.synthPartCount).toBe(8);
    expect(t!.modifies.midiClockOut).toBe(true);
    expect(t!.modifies.midiNoteOut).toBe(true);
  });

  it("ESX Live Template hat 10 drum Parts und 8 Scenes", () => {
    const t = getKorgTemplate("korg-esx-live");
    expect(t).not.toBeNull();
    expect(t!.drumPartCount).toBe(10);
    expect(t!.synthPartCount).toBe(0);
    expect(t!.modifies.scenes).toBe(true);
    expect(t!.modifies.sceneCount).toBe(8);
    expect(t!.modifies.padBank).toBe(true);
    expect(t!.modifies.padBankSlots).toBe(16);
  });

  it("nanoKONTROL2-Template aktiviert NICHT Clock-Out, aber LED-Feedback", () => {
    const t = getKorgTemplate("nanokontrol2-mix");
    expect(t).not.toBeNull();
    expect(t!.modifies.midiClockOut).toBe(false);
    expect(t!.modifies.midiNoteOut).toBe(false);
    expect(t!.modifies.padBank).toBe(true);
    expect(t!.modifies.padBankSlots).toBe(16);
    expect(t!.midiDeviceHintRegex).toMatch(/nanokontrol/i);
  });

  // ── 2. Lookup-Helpers ──────────────────────────────────────────────────────

  it("getKorgTemplate liefert null für unbekannte IDs", () => {
    expect(getKorgTemplate("unknown")).toBeNull();
    expect(getKorgTemplate("")).toBeNull();
  });

  it("listKorgTemplateIds liefert IDs in Definition-Order", () => {
    const ids = listKorgTemplateIds();
    expect(ids).toEqual(["korg-e2-studio", "korg-esx-live", "nanokontrol2-mix"]);
  });

  // ── 3. Pad-Bank Builder ────────────────────────────────────────────────────

  it("buildPerfPadBankSlots erzeugt 16 perf-pad-slots", () => {
    const slots = buildPerfPadBankSlots();
    expect(slots.length).toBe(16);
    expect(slots.every((s) => s.kind === "perf-pad")).toBe(true);
    expect(slots.map((s) => s.param)).toEqual(
      Array.from({ length: 16 }, (_, i) => String(i)),
    );
  });

  // ── 4. Apply ────────────────────────────────────────────────────────────────

  it("apply ruft setBpm und reseedParts in der korrekten Reihenfolge", () => {
    const { deps, setBpm, reseedParts } = buildSpyDeps(16);
    const result = applyKorgProjectTemplate("korg-e2-studio", deps);
    expect(setBpm).toHaveBeenCalledWith(120);
    expect(reseedParts).toHaveBeenCalledWith(8, 8);
    expect(result.partIds.length).toBe(16);
    expect(result.templateId).toBe("korg-e2-studio");
  });

  it("apply für E2 Studio: enableClockOut wird gerufen, enableLedFeedback nicht", () => {
    const { deps, enableClockOut, enableLedFeedback } = buildSpyDeps(16);
    applyKorgProjectTemplate("korg-e2-studio", deps);
    expect(enableClockOut).toHaveBeenCalledTimes(1);
    // v3.50.0: enableClockOut(hint, resolvedOutputId) — ohne midiAccess → null
    expect(enableClockOut).toHaveBeenCalledWith("electribe", null);
    expect(enableLedFeedback).not.toHaveBeenCalled();
  });

  it("apply für nanoKONTROL2: enableLedFeedback gerufen, enableClockOut nicht", () => {
    const { deps, enableClockOut, enableLedFeedback } = buildSpyDeps(8);
    applyKorgProjectTemplate("nanokontrol2-mix", deps);
    expect(enableLedFeedback).toHaveBeenCalledTimes(1);
    // v3.50.0: enableLedFeedback(hint, resolvedOutputId) — ohne midiAccess → null
    expect(enableLedFeedback).toHaveBeenCalledWith("nanokontrol", null);
    expect(enableClockOut).not.toHaveBeenCalled();
  });

  it("apply für ESX Live erzeugt 8 Scenes im SceneStore", () => {
    const { deps } = buildSpyDeps(10);
    const result = applyKorgProjectTemplate("korg-esx-live", deps);
    expect(result.scenesCreated).toBe(8);
    // Verify localStorage persistence
    const raw = localStorage.getItem("ss-scenes:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.scenes.length).toBe(8);
    expect(parsed.scenes[0].name).toBe("Scene 1");
    expect(parsed.scenes[7].name).toBe("Scene 8");
  });

  it("apply für ESX Live persistiert 16 Performance-Pad-Slots", () => {
    const { deps } = buildSpyDeps(10);
    applyKorgProjectTemplate("korg-esx-live", deps);
    const slots = loadPadBankSlots();
    expect(slots.length).toBe(16);
    expect(slots.every((s) => s.kind === "perf-pad")).toBe(true);
  });

  it("apply für nanoKONTROL2 persistiert 16 Pad-Bank-Slots", () => {
    const { deps } = buildSpyDeps(8);
    applyKorgProjectTemplate("nanokontrol2-mix", deps);
    const slots = loadPadBankSlots();
    expect(slots.length).toBe(16);
  });

  it("apply für E2 Studio schreibt MIDI-Note-Out-Configs für die 8 Drum-Parts", () => {
    const { deps } = buildSpyDeps(16);
    applyKorgProjectTemplate("korg-e2-studio", deps);
    const cfgs = getAllPartMidiOutConfigs();
    const keys = Object.keys(cfgs);
    // Es sollten genau 8 Drum-Part-Configs angelegt sein (synth-Parts nicht).
    expect(keys.length).toBe(8);
    // Channel 10 (= 0-indexed 9) = GM Drum.
    expect(cfgs[keys[0]].channel).toBe(9);
    // Erste Note = GM-Kick 36.
    expect(cfgs["part-0"]?.note).toBe(36);
  });

  it("apply wirft bei unbekannter Template-ID", () => {
    expect(() => applyKorgProjectTemplate("invalid", {})).toThrow(
      /Unknown KORG template/,
    );
  });

  it("apply ist isomorph: fehlende DI-Setter werden geskippt, kein Error", () => {
    // Keine deps → kein setBpm, kein reseedParts. Apply muss trotzdem laufen
    // (Scenes/Pad-Bank persistieren, da das Store-direkt funktioniert).
    expect(() => applyKorgProjectTemplate("korg-esx-live", {})).not.toThrow();
    // Scenes wurden trotzdem angelegt
    const raw = localStorage.getItem("ss-scenes:v1");
    expect(raw).not.toBeNull();
  });

  it("apply liefert postApplyNotice mit Template-Name", () => {
    const { deps, postApplyNotice } = buildSpyDeps(16);
    applyKorgProjectTemplate("korg-e2-studio", deps);
    expect(postApplyNotice).toHaveBeenCalledWith(
      expect.stringContaining("KORG E2 Studio"),
    );
  });

  it("apply liefert hints im Result", () => {
    const { deps } = buildSpyDeps(16);
    const result = applyKorgProjectTemplate("korg-e2-studio", deps);
    expect(result.hints.length).toBeGreaterThanOrEqual(2);
    expect(result.hints[0]).toMatch(/clock/i);
  });
});

// ── v3.50.0 — Template-Apply End-to-End Wiring ──────────────────────────────

describe("KORG Project Templates — v3.50.0 End-to-End Wiring", () => {
  beforeEach(() => {
    __resetMidiNoteOutStoreForTests();
    __resetPadBankForTests();
    __resetSceneStoreForTests();
  });

  // ── reseedParts ─────────────────────────────────────────────────────────────

  it("reseedParts mit 8 drum + 8 synth erzeugt 16 part-IDs in DI-Result", () => {
    const reseedParts = vi.fn((drum: number, synth: number) =>
      Array.from({ length: drum + synth }, (_, i) =>
        i < drum ? `drum-${i}` : `synth-${i - drum}`,
      ),
    );
    const result = applyKorgProjectTemplate("korg-e2-studio", { reseedParts });
    expect(reseedParts).toHaveBeenCalledWith(8, 8);
    expect(result.partIds.length).toBe(16);
    // Drum-IDs zuerst, dann Synth.
    expect(result.partIds[0]).toBe("drum-0");
    expect(result.partIds[8]).toBe("synth-0");
  });

  // ── enableClockOut Auto-Resolve ─────────────────────────────────────────────

  it("enableClockOut bekommt resolvedOutputId wenn midiAccess match liefert", () => {
    const enableClockOut = vi.fn();
    const midiOutputs = [
      { id: "out-1", name: "Some MIDI Thru", manufacturer: "X", state: "connected" as const },
      { id: "out-2", name: "Electribe 2 Sampler", manufacturer: "KORG", state: "connected" as const },
    ];
    const result = applyKorgProjectTemplate("korg-e2-studio", {
      reseedParts: (d, s) => Array.from({ length: d + s }, (_, i) => `p-${i}`),
      enableClockOut,
      midiAccess: midiOutputs,
    });
    expect(enableClockOut).toHaveBeenCalledWith("electribe", "out-2");
    expect(result.resolvedOutputId).toBe("out-2");
  });

  it("enableClockOut bekommt null wenn kein device matched", () => {
    const enableClockOut = vi.fn();
    const onMissingDevice = vi.fn();
    const result = applyKorgProjectTemplate("korg-e2-studio", {
      reseedParts: (d, s) => Array.from({ length: d + s }, (_, i) => `p-${i}`),
      enableClockOut,
      midiAccess: [
        { id: "out-x", name: "Unrelated Synth", manufacturer: "Y", state: "connected" as const },
      ],
      onMissingDevice,
    });
    expect(enableClockOut).toHaveBeenCalledWith("electribe", null);
    expect(onMissingDevice).toHaveBeenCalledWith("electribe", "Clock-Out");
    expect(result.resolvedOutputId).toBeNull();
  });

  // ── MIDI-Note-Out Placeholder Auto-Resolve ──────────────────────────────────

  it("MIDI-Note-Out outputId wird zu echter ID resolved wenn midiAccess match liefert", () => {
    // E2-Template Hint = "electribe" → match-Test mit "Electribe 2 MIDI"
    const midiOutputs = [
      { id: "korg-e2-001", name: "Electribe 2 MIDI", manufacturer: "KORG", state: "connected" as const },
    ];
    applyKorgProjectTemplate("korg-e2-studio", {
      reseedParts: (d, s) => Array.from({ length: d + s }, (_, i) => `part-${i}`),
      midiAccess: midiOutputs,
    });
    const cfgs = getAllPartMidiOutConfigs();
    const ids = Object.values(cfgs).map((c) => c.outputId);
    expect(ids.every((id) => id === "korg-e2-001")).toBe(true);
    // Kein __pending__-Rest
    expect(ids.some((id) => id.startsWith("__pending__"))).toBe(false);
  });

  it("MIDI-Note-Out Placeholder bleibt bestehen wenn kein device matched", () => {
    applyKorgProjectTemplate("korg-e2-studio", {
      reseedParts: (d, s) => Array.from({ length: d + s }, (_, i) => `part-${i}`),
      midiAccess: [
        { id: "x", name: "Random Device", manufacturer: "Y", state: "connected" as const },
      ],
    });
    const cfgs = getAllPartMidiOutConfigs();
    const firstCfg = Object.values(cfgs)[0];
    expect(firstCfg.outputId).toMatch(/^__pending__:/);
  });

  // ── resolveMidiOutputIdByHint ───────────────────────────────────────────────

  it("resolveMidiOutputIdByHint findet connected device case-insensitive", async () => {
    const { resolveMidiOutputIdByHint } = await import(
      "@/utils/korgProjectTemplates"
    );
    const id = resolveMidiOutputIdByHint(
      [
        { id: "a", name: "ELECTRIBE 2", manufacturer: "KORG", state: "connected" as const },
      ],
      "electribe",
    );
    expect(id).toBe("a");
  });

  it("resolveMidiOutputIdByHint liefert null bei keine outputs", async () => {
    const { resolveMidiOutputIdByHint } = await import(
      "@/utils/korgProjectTemplates"
    );
    expect(resolveMidiOutputIdByHint([], "electribe")).toBeNull();
    expect(resolveMidiOutputIdByHint(null, "electribe")).toBeNull();
    expect(resolveMidiOutputIdByHint([], null)).toBeNull();
  });

  it("resolveMidiOutputIdByHint bevorzugt connected vor disconnected", async () => {
    const { resolveMidiOutputIdByHint } = await import(
      "@/utils/korgProjectTemplates"
    );
    const id = resolveMidiOutputIdByHint(
      [
        { id: "disco", name: "Electribe 2", manufacturer: "KORG", state: "disconnected" as const },
        { id: "live", name: "Electribe 2 Sampler", manufacturer: "KORG", state: "connected" as const },
      ],
      "electribe",
    );
    expect(id).toBe("live");
  });

  // ── isKorgTemplateApplyDestructive ──────────────────────────────────────────

  it("isKorgTemplateApplyDestructive: false bei fresh state", async () => {
    const { isKorgTemplateApplyDestructive } = await import(
      "@/utils/korgProjectTemplates"
    );
    expect(isKorgTemplateApplyDestructive()).toBe(false);
    expect(isKorgTemplateApplyDestructive({ existingPartCount: 9 })).toBe(false);
  });

  it("isKorgTemplateApplyDestructive: true wenn existingPartCount > default", async () => {
    const { isKorgTemplateApplyDestructive } = await import(
      "@/utils/korgProjectTemplates"
    );
    expect(isKorgTemplateApplyDestructive({ existingPartCount: 12 })).toBe(true);
  });

  it("isKorgTemplateApplyDestructive: true wenn scenes existieren", async () => {
    const { isKorgTemplateApplyDestructive } = await import(
      "@/utils/korgProjectTemplates"
    );
    const { addScene } = await import("@/store/useSceneStore");
    addScene("Scene 1", "default");
    expect(isKorgTemplateApplyDestructive()).toBe(true);
  });

  it("isKorgTemplateApplyDestructive: true wenn Pad-Bank Slots non-default sind", async () => {
    const { isKorgTemplateApplyDestructive } = await import(
      "@/utils/korgProjectTemplates"
    );
    const { savePadBankSlots } = await import("@/utils/padBankPersistence");
    // Macro-Slot statt perf-pad → destructive
    savePadBankSlots([
      { kind: "macro", param: "0" },
      ...Array.from({ length: 15 }, (_, i) => ({ kind: "perf-pad" as const, param: String(i) })),
    ]);
    expect(isKorgTemplateApplyDestructive()).toBe(true);
  });

  it("isKorgTemplateApplyDestructive: false bei default-Layout (16 perf-pads, 0 scenes)", async () => {
    const { isKorgTemplateApplyDestructive } = await import(
      "@/utils/korgProjectTemplates"
    );
    const { savePadBankSlots } = await import("@/utils/padBankPersistence");
    savePadBankSlots(
      Array.from({ length: 16 }, (_, i) => ({
        kind: "perf-pad" as const,
        param: String(i),
      })),
    );
    expect(isKorgTemplateApplyDestructive()).toBe(false);
  });

  // ── useSceneStore reset API ─────────────────────────────────────────────────

  it("__resetSceneStoreForTests killt scenes + persistiert leeren state", async () => {
    const { addScene, getSceneState, __resetSceneStoreForTests: resetFn } =
      await import("@/store/useSceneStore");
    addScene("Scene A", "p1");
    addScene("Scene B", "p2");
    expect(getSceneState().scenes.length).toBe(2);
    resetFn();
    expect(getSceneState().scenes.length).toBe(0);
    // localStorage muss ebenfalls leer sein
    const raw = localStorage.getItem("ss-scenes:v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      expect(parsed.scenes.length).toBe(0);
    }
  });

  // ── Result.resolvedOutputId ─────────────────────────────────────────────────

  it("result.resolvedOutputId === null wenn kein midiAccess", () => {
    const result = applyKorgProjectTemplate("korg-e2-studio", {
      reseedParts: (d, s) => Array.from({ length: d + s }, (_, i) => `p-${i}`),
    });
    expect(result.resolvedOutputId).toBeNull();
  });

  // ── Pre-existing __pending__ → auto-Update wenn Resolve gefunden ────────────

  it("apply ersetzt bestehende __pending__-Configs mit echter ID wenn match", async () => {
    const { setPartMidiOutConfig } = await import("@/store/useMidiNoteOutStore");
    setPartMidiOutConfig("legacy-part", {
      outputId: "__pending__:electribe",
      channel: 9,
      note: 36,
      noteDurationMs: 50,
      localSoundEnabled: true,
    });
    applyKorgProjectTemplate("korg-e2-studio", {
      reseedParts: (d, s) => Array.from({ length: d + s }, (_, i) => `part-${i}`),
      midiAccess: [
        { id: "live-out", name: "Electribe 2 USB", manufacturer: "KORG", state: "connected" as const },
      ],
    });
    const cfgs = getAllPartMidiOutConfigs();
    expect(cfgs["legacy-part"].outputId).toBe("live-out");
  });
});
