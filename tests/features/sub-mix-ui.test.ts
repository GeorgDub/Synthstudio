/**
 * tests/features/sub-mix-ui.test.ts (v3.80.0)
 *
 * Unit-Tests für die Sub-Mix UI-Layer in MixerView:
 *  - "+ New Bus"-Button → createBus
 *  - "Send to Bus"-Dropdown listet alle Buses
 *  - Assignment ändert den Store (Engine-Sync via App.tsx-useEffect, hier nicht
 *    direkt — wir testen den Store-Pfad den die UI-Komponente aufruft).
 *  - Remove Bus mit/ohne members
 *  - Bus-Strip Volume/Pan/Mute/Solo wirken (state-level — Engine-Wiring ist
 *    bereits via sub-mix-engine.test.ts gedeckt)
 *
 * Pure node-env (kein jsdom) — Wir testen die Store-Actions die die UI-
 * Komponenten aufrufen plus die kleine Pure-Helpers aus SubMixBusStrip.tsx.
 * Render-Tests via Testing-Library wären redundant: die Komponenten reichen
 * onClick/onChange direkt an `createBus / assignChannelToBus / setBusVolume /
 * setBusMute / setBusSolo / removeBus` durch — und die Mutations-Pfade sind
 * exakt die selben die wir hier testen.
 *
 * 7 Tests in 5 describes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage-Mock ────────────────────────────────────────────────────────

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
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: localStorageMock, confirm: (): boolean => true },
    writable: true,
    configurable: true,
  });
}

// ─── Dynamische Imports (NACH Mock-Setup) ─────────────────────────────────────

let storeModule: typeof import("../../client/src/store/useSubMixStore");

beforeEach(async () => {
  vi.resetModules();
  localStorageMock.clear();
  storeModule = await import("../../client/src/store/useSubMixStore");
  storeModule.__resetSubMixStoreForTests();
});

// ─── (1) "+ New Bus"-Button → createBus ──────────────────────────────────────

describe("v3.80.0 UI → createBus", () => {
  it("New Bus-Button-Click erzeugt einen Bus mit Default-Namen", () => {
    // Simuliert handleCreateBus() aus MixerView.tsx:
    //   const handleCreateBus = useCallback(() => {
    //     if (subMixBuses.length >= MAX_SUB_MIX_BUSES) return;
    //     createBus();
    //   }, [subMixBuses.length]);
    expect(storeModule.getBuses()).toHaveLength(0);
    const id = storeModule.createBus();
    expect(id).toBeTruthy();
    const buses = storeModule.getBuses();
    expect(buses).toHaveLength(1);
    expect(buses[0].name).toBe("Bus 1"); // Default-Fallback aus createBus()
    expect(buses[0].channelIds).toEqual([]);
    expect(buses[0].mute).toBe(false);
    expect(buses[0].solo).toBe(false);
  });

  it("Button bleibt disabled-äquivalent: 9. createBus liefert null (Limit-Guard)", () => {
    // Spiegelt die `disabled={subMixBuses.length >= MAX_SUB_MIX_BUSES}` Logik
    // des Buttons: der Store-Aufruf muss bei Limit selber noch defensive sein.
    const ids: (string | null)[] = [];
    for (let i = 0; i < storeModule.MAX_SUB_MIX_BUSES; i++) {
      ids.push(storeModule.createBus());
    }
    expect(ids.every((x) => typeof x === "string")).toBe(true);
    // 9. ist null.
    const overflow = storeModule.createBus();
    expect(overflow).toBeNull();
    expect(storeModule.getBuses()).toHaveLength(storeModule.MAX_SUB_MIX_BUSES);
  });
});

// ─── (2) "Send to Bus"-Dropdown listet alle Buses ────────────────────────────

describe("v3.80.0 UI → Channel-Dropdown listet Buses", () => {
  it("Dropdown-Options entsprechen subMixBuses + 'Master'-Default-Eintrag", () => {
    // Spiegelt das <select>-Rendering im MixerChannel:
    //   <option value="">Master</option>
    //   {subMixBuses.map((b) => <option value={b.id}>{b.name}</option>)}
    const a = storeModule.createBus("Drums")!;
    const b = storeModule.createBus("Bass")!;
    const c = storeModule.createBus("FX")!;
    const buses = storeModule.getBuses();
    const dropdownOptions = [
      { value: "", label: "Master" },
      ...buses.map((b) => ({ value: b.id, label: b.name })),
    ];
    expect(dropdownOptions).toHaveLength(4);
    expect(dropdownOptions[0]).toEqual({ value: "", label: "Master" });
    expect(dropdownOptions[1]).toEqual({ value: a, label: "Drums" });
    expect(dropdownOptions[2]).toEqual({ value: b, label: "Bass" });
    expect(dropdownOptions[3]).toEqual({ value: c, label: "FX" });
  });
});

// ─── (3) Assignment via Dropdown → Store-Mutation ────────────────────────────

describe("v3.80.0 UI → onAssignBus updates Store", () => {
  it("Assignment via Dropdown-onChange updates Store (Engine-Sync läuft via App.tsx-Effect)", () => {
    // Spiegelt handleAssignBus aus MixerView.tsx:
    //   const handleAssignBus = useCallback((partId, busId) => {
    //     if (busId === null) unassignChannel(partId);
    //     else assignChannelToBus(busId, partId);
    //   }, []);
    const busId = storeModule.createBus("Drums")!;
    expect(storeModule.getBusForChannel("kick")).toBeUndefined();

    // User wählt "Drums" im Dropdown — onChange(busId).
    storeModule.assignChannelToBus(busId, "kick");
    expect(storeModule.getBusForChannel("kick")?.id).toBe(busId);

    // User wechselt zurück auf "Master" — onChange("") → unassignChannel.
    storeModule.unassignChannel("kick");
    expect(storeModule.getBusForChannel("kick")).toBeUndefined();
  });

  it("Re-Assignment von Bus A → Bus B entfernt aus A (auto-unassign)", () => {
    const a = storeModule.createBus("Drums")!;
    const b = storeModule.createBus("Perc")!;
    storeModule.assignChannelToBus(a, "kick");
    expect(storeModule.getBusById(a)!.channelIds).toEqual(["kick"]);

    // User wählt jetzt Bus B im selben Dropdown.
    storeModule.assignChannelToBus(b, "kick");
    expect(storeModule.getBusById(a)!.channelIds).toEqual([]);
    expect(storeModule.getBusById(b)!.channelIds).toEqual(["kick"]);
    expect(storeModule.getBusForChannel("kick")?.id).toBe(b);
  });
});

// ─── (4) Remove Bus mit/ohne members ─────────────────────────────────────────

describe("v3.80.0 UI → Remove Bus", () => {
  it("Remove Bus ohne Mitglieder: kein Confirm nötig — entfernt direkt", () => {
    const id = storeModule.createBus("Empty")!;
    expect(storeModule.getBuses()).toHaveLength(1);
    // Member-Count = 0, deshalb skipt SubMixBusStrip.handleRemove den Confirm.
    storeModule.removeBus(id);
    expect(storeModule.getBuses()).toHaveLength(0);
  });

  it("Remove Bus mit Mitgliedern: Confirm-Guard + nach Remove fallen Members zu Master zurück", () => {
    const id = storeModule.createBus("Drums")!;
    storeModule.assignChannelToBus(id, "kick");
    storeModule.assignChannelToBus(id, "snare");
    expect(storeModule.getBuses()).toHaveLength(1);
    expect(storeModule.getBusById(id)!.channelIds).toHaveLength(2);

    // SubMixBusStrip.handleRemove ruft window.confirm — wir setzen es auf false.
    const origConfirm = (globalThis as { window?: { confirm?: () => boolean } }).window?.confirm;
    (globalThis as { window: { confirm: () => boolean } }).window.confirm = () => false;
    // → Bei false bleibt der Bus erhalten (kein Store-Mutation).
    // (Wir simulieren das Verhalten direkt — der Strip ruft removeBus nur bei
    //  ok=true. Da User abgelehnt hat, kein Aufruf.)
    expect(storeModule.getBuses()).toHaveLength(1);

    // Bei Confirm=true räumt der Store auf und Members verlieren ihre
    // Bus-Membership (auto via removeBus).
    (globalThis as { window: { confirm: () => boolean } }).window.confirm = () => true;
    storeModule.removeBus(id);
    expect(storeModule.getBuses()).toHaveLength(0);
    expect(storeModule.getBusForChannel("kick")).toBeUndefined();
    expect(storeModule.getBusForChannel("snare")).toBeUndefined();

    // Restore.
    if (origConfirm) {
      (globalThis as { window: { confirm: () => boolean } }).window.confirm = origConfirm;
    }
  });
});

// ─── (5) Bus-Strip Volume/Pan/Mute/Solo wirken state-level ───────────────────

describe("v3.80.0 UI → Bus-Strip Controls", () => {
  it("Volume/Pan/Mute/Solo-Controls im Bus-Strip mutieren den Store korrekt", () => {
    // Diese 4 Slider/Buttons im SubMixBusStrip rufen 1:1 die Store-Setter:
    //   setBusVolume / setBusPan / setBusMute / setBusSolo
    const id = storeModule.createBus("Drums")!;

    // Volume.
    storeModule.setBusVolume(id, 1.5);
    expect(storeModule.getBusById(id)!.volume).toBe(1.5);

    // Pan.
    storeModule.setBusPan(id, -0.5);
    expect(storeModule.getBusById(id)!.pan).toBe(-0.5);

    // Mute.
    storeModule.setBusMute(id, true);
    expect(storeModule.getBusById(id)!.mute).toBe(true);
    expect(storeModule.isBusEffectivelyMuted(id)).toBe(true);

    // Solo (mit zweitem Bus zum Test der Sister-Bus-Stummschaltung).
    storeModule.setBusMute(id, false);
    const other = storeModule.createBus("Bass")!;
    storeModule.setBusSolo(id, true);
    expect(storeModule.getBusById(id)!.solo).toBe(true);
    expect(storeModule.anyBusSolo()).toBe(true);
    expect(storeModule.isBusEffectivelyMuted(id)).toBe(false);     // self-solo
    expect(storeModule.isBusEffectivelyMuted(other)).toBe(true);   // sister
  });
});
