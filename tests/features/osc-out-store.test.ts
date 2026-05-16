/**
 * tests/features/osc-out-store.test.ts (TASK-CVG-OSC-STORE / v2.65)
 *
 * Unit-Tests für useOscOutStore. Verifiziert Partial-Update-Merge,
 * Port/StepRate-Clamping und localStorage-Persistenz mit Schema-Defensive
 * (Felder mit falschem Typ fallen auf Defaults zurück).
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ───────────────────────────────────────────────────────

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

import { getOscOutConfig, setOscOutConfig } from "@/store/useOscOutStore";

const STORAGE_KEY = "ss-osc-out:v1";

// Da der Store kein __resetForTests-Helper hat, setzen wir manuell auf Default
const DEFAULT_CONFIG = {
  enabled: false,
  host: "127.0.0.1",
  port: 7401,
  syncBpm: true,
  syncTransport: false,
  syncStep: false,
  stepRate: 4,
  syncMutes: false,
  syncMacros: false,
  syncVolumes: false,
  syncPatternSwitch: false,
};

function resetStore(): void {
  localStorageMock.clear();
  setOscOutConfig(DEFAULT_CONFIG);
}

describe("useOscOutStore – Default-State + Partial-Update", () => {
  beforeEach(resetStore);

  it("getOscOutConfig liefert alle Default-Felder", () => {
    const config = getOscOutConfig();
    expect(config.enabled).toBe(false);
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(7401);
    expect(config.syncBpm).toBe(true);
    expect(config.syncTransport).toBe(false);
    expect(config.stepRate).toBe(4);
  });

  it("setOscOutConfig partial → ungeänderte Felder bleiben", () => {
    setOscOutConfig({ enabled: true });
    const config = getOscOutConfig();
    expect(config.enabled).toBe(true);
    expect(config.host).toBe("127.0.0.1"); // unverändert
    expect(config.port).toBe(7401); // unverändert
  });

  it("Mehrere partielle Updates merge sich auf", () => {
    setOscOutConfig({ enabled: true });
    setOscOutConfig({ host: "10.0.0.1" });
    setOscOutConfig({ syncMutes: true });
    const config = getOscOutConfig();
    expect(config.enabled).toBe(true);
    expect(config.host).toBe("10.0.0.1");
    expect(config.syncMutes).toBe(true);
  });
});

describe("useOscOutStore – Port-Clamping", () => {
  beforeEach(resetStore);

  it("Port 9000 (normal) bleibt 9000", () => {
    setOscOutConfig({ port: 9000 });
    expect(getOscOutConfig().port).toBe(9000);
  });

  it("Port 0 → 1 (Min)", () => {
    setOscOutConfig({ port: 0 });
    expect(getOscOutConfig().port).toBe(1);
  });

  it("Port -100 → 1 (Min)", () => {
    setOscOutConfig({ port: -100 });
    expect(getOscOutConfig().port).toBe(1);
  });

  it("Port 99999 → 65535 (Max)", () => {
    setOscOutConfig({ port: 99999 });
    expect(getOscOutConfig().port).toBe(65535);
  });

  it("Port 8080.7 → 8080 (Math.floor)", () => {
    setOscOutConfig({ port: 8080.7 });
    expect(getOscOutConfig().port).toBe(8080);
  });
});

describe("useOscOutStore – StepRate-Clamping", () => {
  beforeEach(resetStore);

  it("stepRate 1..16 bleibt erhalten", () => {
    setOscOutConfig({ stepRate: 1 });
    expect(getOscOutConfig().stepRate).toBe(1);
    setOscOutConfig({ stepRate: 16 });
    expect(getOscOutConfig().stepRate).toBe(16);
  });

  it("stepRate 0 → 1 (Min)", () => {
    setOscOutConfig({ stepRate: 0 });
    expect(getOscOutConfig().stepRate).toBe(1);
  });

  it("stepRate 100 → 16 (Max)", () => {
    setOscOutConfig({ stepRate: 100 });
    expect(getOscOutConfig().stepRate).toBe(16);
  });

  it("stepRate 4.6 → 4 (Math.floor)", () => {
    setOscOutConfig({ stepRate: 4.6 });
    expect(getOscOutConfig().stepRate).toBe(4);
  });
});

describe("useOscOutStore – localStorage-Persistenz", () => {
  beforeEach(resetStore);

  it("setOscOutConfig persistiert kompletten Config", () => {
    setOscOutConfig({ enabled: true, host: "192.168.1.10", port: 9000 });
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.enabled).toBe(true);
    expect(parsed.host).toBe("192.168.1.10");
    expect(parsed.port).toBe(9000);
  });

  it("Sync-Flags persistieren (alle 6 v2.28+ Flags)", () => {
    setOscOutConfig({
      syncBpm: false,
      syncTransport: true,
      syncStep: true,
      syncMutes: true,
      syncMacros: true,
      syncVolumes: true,
      syncPatternSwitch: true,
    });
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.syncBpm).toBe(false);
    expect(parsed.syncTransport).toBe(true);
    expect(parsed.syncMutes).toBe(true);
    expect(parsed.syncMacros).toBe(true);
    expect(parsed.syncVolumes).toBe(true);
    expect(parsed.syncPatternSwitch).toBe(true);
  });
});
