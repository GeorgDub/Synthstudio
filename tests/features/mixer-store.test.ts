// @vitest-environment jsdom
/**
 * tests/features/mixer-store.test.ts (TASK-256)
 *
 * Unit-Tests für den useMixerStore-HOOK (nicht den pure-Helper mixerFx.ts —
 * der ist in mixer-fx.test.ts abgedeckt, und der Pure-Migrations-Helper
 * migratePluginSlots in plugin-multislot.test.ts).
 *
 * Diese Suite schloss die Lücke: bis TASK-256 war der Hook selbst
 * (setChannelSend, ensureChannel, setMasterVolume, returnTracks, EQ-Bands,
 * Sidechain/TransientShaper, Plugin-Slot-Actions, resetMixer) komplett
 * ungetestet — nur seine pure-Helper waren abgedeckt.
 *
 * Architektur-Hinweis: useMixerStore nutzt React `useState(() => loadMixerState())`
 * — KEIN Modul-Singleton+Listener (anders als useMasterFxStore). Persistenz-
 * Round-Trip wird daher durch ZWEI getrennte renderHook-Mounts verifiziert:
 * Setter im ersten Mount → frischer Mount liest aus localStorage.
 * Es gibt KEINE Audio-Side-Effects im Store, also kein AudioContext-Mock nötig.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── localStorage Mock (jsdom hat zwar localStorage, wir wollen aber harte
//     Isolation pro Test ohne Cross-Talk) ─────────────────────────────────────

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
// useMixerStore liest window.localStorage — sicherstellen dass window denselben Mock hat.
Object.defineProperty(globalThis, "window", {
  value: globalThis,
  writable: true,
  configurable: true,
});

import {
  useMixerStore,
  MAX_PLUGIN_SLOTS_PER_CHANNEL,
  type MixerPluginSlot,
} from "../../client/src/store/useMixerStore";

const STORAGE_KEY = "synthstudio:mixer:v1";

function slot(pluginId: string, params: Record<string, number> = {}): MixerPluginSlot {
  return { pluginId, params };
}

beforeEach(() => {
  localStorageMock.clear();
});

// ─── (1) Channels / Sends ─────────────────────────────────────────────────────

describe("useMixerStore — Channels & Sends", () => {
  it("happy: ensureChannel legt Channel + EQ + Sidechain + TransientShaper an", () => {
    const { result } = renderHook(() => useMixerStore());
    expect(result.current.channels["kick"]).toBeUndefined();
    act(() => { result.current.ensureChannel("kick"); });
    expect(result.current.channels["kick"]).toBeDefined();
    expect(result.current.channels["kick"].partId).toBe("kick");
    expect(result.current.eq16["kick"]).toHaveLength(16);
    expect(result.current.sidechains["kick"]).toBeDefined();
    expect(result.current.transientShapers["kick"]).toBeDefined();
  });

  it("happy: setChannelSend setzt Reverb- + Delay-Send", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.setChannelSend("snare", "reverb", 0.4);
      result.current.setChannelSend("snare", "delay", 0.25);
    });
    expect(result.current.channels["snare"].sends.reverb).toBe(0.4);
    expect(result.current.channels["snare"].sends.delay).toBe(0.25);
  });

  it("edge: setChannelSend clampt auf [0,1]", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.setChannelSend("hh", "reverb", 5);
      result.current.setChannelSend("hh", "delay", -3);
    });
    expect(result.current.channels["hh"].sends.reverb).toBe(1);
    expect(result.current.channels["hh"].sends.delay).toBe(0);
  });

  it("edge: setChannelPeakLevel clampt, persistiert aber NICHT (commit persist=false)", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => { result.current.setChannelPeakLevel("kick", 2.5); });
    expect(result.current.channels["kick"].peakLevel).toBe(1); // clamped
    // peakLevel darf nicht im persistierten JSON landen (volatiler VU-Wert)
    const raw = localStorageMock.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Falls der Channel persistiert wurde, ist sein peakLevel auf 0 genullt.
      if (parsed.channels?.kick) {
        expect(parsed.channels.kick.peakLevel).toBe(0);
      }
    }
  });

  it("persistence: Channel-Sends überleben einen frischen Mount (localStorage)", () => {
    const first = renderHook(() => useMixerStore());
    act(() => { first.result.current.setChannelSend("kick", "reverb", 0.7); });
    first.unmount();
    // Frischer Mount liest aus localStorage
    const second = renderHook(() => useMixerStore());
    expect(second.result.current.channels["kick"].sends.reverb).toBe(0.7);
  });
});

// ─── (2) Master / Selektion / Return-Tracks ──────────────────────────────────

describe("useMixerStore — Master, Selection, Return-Tracks", () => {
  it("happy: setMasterVolume setzt den Master-Pegel", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => { result.current.setMasterVolume(0.5); });
    expect(result.current.masterVolume).toBe(0.5);
  });

  it("edge: setMasterVolume clampt auf [0,1]", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => { result.current.setMasterVolume(9); });
    expect(result.current.masterVolume).toBe(1);
    act(() => { result.current.setMasterVolume(-9); });
    expect(result.current.masterVolume).toBe(0);
  });

  it("happy: setSelectedChannel + zurück auf null", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => { result.current.setSelectedChannel("kick"); });
    expect(result.current.selectedChannelId).toBe("kick");
    act(() => { result.current.setSelectedChannel(null); });
    expect(result.current.selectedChannelId).toBeNull();
  });

  it("happy: setReturnTrackVolume + setReturnTrackMuted (Reverb-Return)", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.setReturnTrackVolume("reverb", 0.3);
      result.current.setReturnTrackMuted("reverb", true);
    });
    expect(result.current.returnTracks.reverb.volume).toBe(0.3);
    expect(result.current.returnTracks.reverb.muted).toBe(true);
  });

  it("edge: setReturnTrackVolume clampt auf [0,1]", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => { result.current.setReturnTrackVolume("delay", 5); });
    expect(result.current.returnTracks.delay.volume).toBe(1);
  });

  it("persistence: Master + Return-Track-State überleben frischen Mount", () => {
    const first = renderHook(() => useMixerStore());
    act(() => {
      first.result.current.setMasterVolume(0.42);
      first.result.current.setReturnTrackMuted("delay", true);
    });
    first.unmount();
    const second = renderHook(() => useMixerStore());
    expect(second.result.current.masterVolume).toBe(0.42);
    expect(second.result.current.returnTracks.delay.muted).toBe(true);
  });
});

// ─── (3) Insert-FX-Chain ─────────────────────────────────────────────────────

describe("useMixerStore — Insert-FX-Chain", () => {
  it("happy: addInsertFx hängt einen FX-Slot an die Chain", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => { result.current.addInsertFx("kick", "compressor"); });
    expect(result.current.insertChains["kick"]).toHaveLength(1);
    expect(result.current.insertChains["kick"][0].type).toBe("compressor");
    expect(result.current.insertChains["kick"][0].enabled).toBe(true);
  });

  it("happy: toggleInsertFx kippt enabled, updateInsertFxParam setzt Param", () => {
    const { result } = renderHook(() => useMixerStore());
    let slotId = "";
    act(() => { result.current.addInsertFx("kick", "filter"); });
    slotId = result.current.insertChains["kick"][0].id;
    act(() => {
      result.current.toggleInsertFx("kick", slotId);
      result.current.updateInsertFxParam("kick", slotId, "frequency", 1234);
    });
    expect(result.current.insertChains["kick"][0].enabled).toBe(false);
    expect(result.current.insertChains["kick"][0].params.frequency).toBe(1234);
  });

  it("happy: moveInsertFx reordert + removeInsertFx entfernt", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.addInsertFx("kick", "eq16");
      result.current.addInsertFx("kick", "compressor");
      result.current.addInsertFx("kick", "delay");
    });
    const ids = result.current.insertChains["kick"].map(s => s.id);
    act(() => { result.current.moveInsertFx("kick", 0, 2); });
    const reordered = result.current.insertChains["kick"].map(s => s.id);
    expect(reordered).toEqual([ids[1], ids[2], ids[0]]);
    act(() => { result.current.removeInsertFx("kick", ids[1]); });
    expect(result.current.insertChains["kick"].map(s => s.id)).not.toContain(ids[1]);
  });

  it("persistence: Insert-Chain überlebt frischen Mount", () => {
    const first = renderHook(() => useMixerStore());
    act(() => { first.result.current.addInsertFx("kick", "reverb"); });
    first.unmount();
    const second = renderHook(() => useMixerStore());
    expect(second.result.current.insertChains["kick"]).toHaveLength(1);
    expect(second.result.current.insertChains["kick"][0].type).toBe("reverb");
  });
});

// ─── (4) EQ-Bands ────────────────────────────────────────────────────────────

describe("useMixerStore — 16-Band-EQ", () => {
  it("happy: setEqBandGain setzt das Gain eines Bandes", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.ensureChannel("kick");
      result.current.setEqBandGain("kick", 3, 6);
    });
    expect(result.current.eq16["kick"][3].gain).toBe(6);
  });

  it("edge: setEqBandGain clampt auf ±24 dB", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.ensureChannel("kick");
      result.current.setEqBandGain("kick", 0, 99);
      result.current.setEqBandGain("kick", 1, -99);
    });
    expect(result.current.eq16["kick"][0].gain).toBe(24);
    expect(result.current.eq16["kick"][1].gain).toBe(-24);
  });

  it("edge: setEqBandGain mit out-of-range bandIndex ist No-Op", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.ensureChannel("kick");
      result.current.setEqBandGain("kick", 99, 6);
      result.current.setEqBandGain("kick", -1, 6);
    });
    // alle Bänder bleiben auf default 0
    expect(result.current.eq16["kick"].every(b => b.gain === 0)).toBe(true);
  });

  it("happy: resetEqBands setzt die Bänder auf Default zurück", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.ensureChannel("kick");
      result.current.setEqBandGain("kick", 5, 12);
    });
    expect(result.current.eq16["kick"][5].gain).toBe(12);
    act(() => { result.current.resetEqBands("kick"); });
    expect(result.current.eq16["kick"][5].gain).toBe(0);
  });
});

// ─── (5) Sidechain / TransientShaper ─────────────────────────────────────────

describe("useMixerStore — Sidechain & TransientShaper", () => {
  it("happy: setSidechain merged ein Partial-Update", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.setSidechain("bass", { enabled: true, sourcePartId: "kick", amount: 0.7 });
    });
    expect(result.current.sidechains["bass"].enabled).toBe(true);
    expect(result.current.sidechains["bass"].sourcePartId).toBe("kick");
    expect(result.current.sidechains["bass"].amount).toBe(0.7);
  });

  it("edge: setSidechain clampt amount via normalizeSidechain auf [0,1]", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => { result.current.setSidechain("bass", { amount: 5 }); });
    expect(result.current.sidechains["bass"].amount).toBe(1);
  });

  it("happy/edge: setTransientShaper merged + clampt attack/sustain auf [-1,1]", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => { result.current.setTransientShaper("kick", { attack: 5, sustain: -5 }); });
    expect(result.current.transientShapers["kick"].attack).toBe(1);
    expect(result.current.transientShapers["kick"].sustain).toBe(-1);
  });

  it("persistence: Sidechain überlebt frischen Mount", () => {
    const first = renderHook(() => useMixerStore());
    act(() => { first.result.current.setSidechain("bass", { enabled: true, amount: 0.5 }); });
    first.unmount();
    const second = renderHook(() => useMixerStore());
    expect(second.result.current.sidechains["bass"].enabled).toBe(true);
    expect(second.result.current.sidechains["bass"].amount).toBe(0.5);
  });
});

// ─── (6) Plugin-Slot-Actions (Hook — NICHT der pure migratePluginSlots) ───────

describe("useMixerStore — Plugin-Slot-Actions (Multi-Slot)", () => {
  it("happy: addPluginSlot hängt an + returnt true", () => {
    const { result } = renderHook(() => useMixerStore());
    let ok = false;
    act(() => { ok = result.current.addPluginSlot("kick", slot("synthstudio.tape-sat", { drive: 0.5 })); });
    expect(ok).toBe(true);
    expect(result.current.pluginSlots["kick"]).toHaveLength(1);
    expect(result.current.pluginSlots["kick"][0].pluginId).toBe("synthstudio.tape-sat");
  });

  it("edge: addPluginSlot returnt false wenn MAX erreicht (4)", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      for (let i = 0; i < MAX_PLUGIN_SLOTS_PER_CHANNEL; i++) {
        result.current.addPluginSlot("kick", slot(`p.${i}`));
      }
    });
    expect(result.current.pluginSlots["kick"]).toHaveLength(MAX_PLUGIN_SLOTS_PER_CHANNEL);
    let overflow = true;
    act(() => { overflow = result.current.addPluginSlot("kick", slot("p.overflow")); });
    expect(overflow).toBe(false);
    expect(result.current.pluginSlots["kick"]).toHaveLength(MAX_PLUGIN_SLOTS_PER_CHANNEL);
  });

  it("happy: setPluginSlotParam + setPluginSlotBypassed wirken auf den Index-Slot", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.addPluginSlot("kick", slot("p.a", { drive: 0.1 }));
      result.current.setPluginSlotParam("kick", 0, "drive", 0.9);
      result.current.setPluginSlotBypassed("kick", 0, true);
    });
    expect(result.current.pluginSlots["kick"][0].params.drive).toBe(0.9);
    expect(result.current.pluginSlots["kick"][0].bypassed).toBe(true);
  });

  it("happy: movePluginSlot reordert die Chain", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.addPluginSlot("kick", slot("p.a"));
      result.current.addPluginSlot("kick", slot("p.b"));
      result.current.addPluginSlot("kick", slot("p.c"));
      result.current.movePluginSlot("kick", 0, 2);
    });
    expect(result.current.pluginSlots["kick"].map(s => s.pluginId)).toEqual(["p.b", "p.c", "p.a"]);
  });

  it("edge: removePluginSlot/setPluginSlotParam mit out-of-range Index = No-Op", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.addPluginSlot("kick", slot("p.a", { drive: 0.5 }));
      result.current.removePluginSlot("kick", 99);          // out of range
      result.current.setPluginSlotParam("kick", -1, "drive", 0.9); // out of range
      result.current.movePluginSlot("kick", 0, 0);          // from===to no-op
    });
    expect(result.current.pluginSlots["kick"]).toHaveLength(1);
    expect(result.current.pluginSlots["kick"][0].params.drive).toBe(0.5);
  });

  it("happy: Legacy setPluginSlot(null) leert die Chain, setPluginSlot(slot) setzt [slot]", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => { result.current.setPluginSlot("kick", slot("legacy.plug", { x: 1 })); });
    expect(result.current.pluginSlots["kick"]).toHaveLength(1);
    expect(result.current.pluginSlots["kick"][0].pluginId).toBe("legacy.plug");
    act(() => { result.current.setPluginSlot("kick", null); });
    expect(result.current.pluginSlots["kick"]).toHaveLength(0);
  });

  it("happy: Legacy setPluginParam/setPluginBypassed operieren auf Slot 0", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.setPluginSlot("kick", slot("legacy.plug", { x: 0 }));
      result.current.setPluginParam("kick", "x", 7);
      result.current.setPluginBypassed("kick", true);
    });
    expect(result.current.pluginSlots["kick"][0].params.x).toBe(7);
    expect(result.current.pluginSlots["kick"][0].bypassed).toBe(true);
  });

  it("edge: setPluginParam/setPluginBypassed sind No-Op bei leerer Chain", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.setPluginParam("kick", "x", 7);
      result.current.setPluginBypassed("kick", true);
    });
    expect(result.current.pluginSlots["kick"] ?? []).toHaveLength(0);
  });

  it("persistence: Plugin-Slots überleben frischen Mount", () => {
    const first = renderHook(() => useMixerStore());
    act(() => { first.result.current.addPluginSlot("kick", slot("synthstudio.notch", { frequency: 2000 })); });
    first.unmount();
    const second = renderHook(() => useMixerStore());
    expect(second.result.current.pluginSlots["kick"]).toHaveLength(1);
    expect(second.result.current.pluginSlots["kick"][0].params.frequency).toBe(2000);
  });
});

// ─── (7) resetMixer ──────────────────────────────────────────────────────────

describe("useMixerStore — resetMixer (BUG-013)", () => {
  it("happy: resetMixer setzt alle Daten auf Default + entfernt localStorage", () => {
    const { result } = renderHook(() => useMixerStore());
    act(() => {
      result.current.setMasterVolume(0.2);
      result.current.setChannelSend("kick", "reverb", 0.9);
      result.current.addInsertFx("kick", "compressor");
      result.current.addPluginSlot("kick", slot("p.a"));
    });
    expect(localStorageMock.getItem(STORAGE_KEY)).toBeTruthy();
    act(() => { result.current.resetMixer(); });
    expect(result.current.masterVolume).toBe(0.85);
    expect(result.current.channels).toEqual({});
    expect(result.current.insertChains).toEqual({});
    expect(result.current.pluginSlots).toEqual({});
    expect(localStorageMock.getItem(STORAGE_KEY)).toBeNull();
  });
});
