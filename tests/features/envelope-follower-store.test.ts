/**
 * tests/features/envelope-follower-store.test.ts (TASK-CVG-EF-STORE / v2.64)
 *
 * Unit-Tests für useEnvelopeFollowerStore (Modul-Singleton mit localStorage).
 * Store hat keine __resetForTests-Helper → Cleanup via removeEnvelopeFollower
 * für alle Configs in beforeEach.
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

import {
  addEnvelopeFollower,
  removeEnvelopeFollower,
  updateEnvelopeFollower,
  getEnvelopeFollowerConfigs,
  type EnvelopeFollowerConfig,
} from "@/store/useEnvelopeFollowerStore";

const STORAGE_KEY = "ss-envelope-follower:v1";

function clearAll(): void {
  for (const c of getEnvelopeFollowerConfigs()) {
    removeEnvelopeFollower(c.id);
  }
}

function baseConfig(): Omit<EnvelopeFollowerConfig, "id"> {
  return {
    enabled: true,
    sourcePartId: "kick",
    sourcePartName: "Kick",
    targetPartId: "bass",
    targetPartName: "Bass",
    target: "volume",
    amount: 0.5,
    attackMs: 10,
    releaseMs: 200,
  };
}

describe("useEnvelopeFollowerStore – Default-State", () => {
  beforeEach(() => {
    localStorageMock.clear();
    clearAll();
  });

  it("getEnvelopeFollowerConfigs startet leer (nach Cleanup)", () => {
    expect(getEnvelopeFollowerConfigs()).toEqual([]);
  });
});

describe("useEnvelopeFollowerStore – addEnvelopeFollower", () => {
  beforeEach(() => {
    localStorageMock.clear();
    clearAll();
  });

  it("addEnvelopeFollower liefert eine non-empty id zurück", () => {
    const id = addEnvelopeFollower(baseConfig());
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("id-Format folgt 'ef-<timestamp>-<rand>'", () => {
    const id = addEnvelopeFollower(baseConfig());
    expect(id).toMatch(/^ef-\d+-[a-z0-9]+$/);
  });

  it("Nach Add: Config ist abrufbar mit der zurückgegebenen id", () => {
    const id = addEnvelopeFollower(baseConfig());
    const configs = getEnvelopeFollowerConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe(id);
  });

  it("Mehrere Adds liefern verschiedene IDs", () => {
    const id1 = addEnvelopeFollower(baseConfig());
    const id2 = addEnvelopeFollower(baseConfig());
    expect(id1).not.toBe(id2);
    expect(getEnvelopeFollowerConfigs()).toHaveLength(2);
  });

  it("Config-Felder werden vollständig übernommen", () => {
    const id = addEnvelopeFollower({
      enabled: false,
      sourcePartId: "src",
      sourcePartName: "Source",
      targetPartId: "tgt",
      targetPartName: "Target",
      target: "filterFreq",
      amount: 0.75,
      attackMs: 5,
      releaseMs: 150,
    });
    const c = getEnvelopeFollowerConfigs().find((x) => x.id === id)!;
    expect(c.enabled).toBe(false);
    expect(c.sourcePartId).toBe("src");
    expect(c.target).toBe("filterFreq");
    expect(c.amount).toBe(0.75);
    expect(c.attackMs).toBe(5);
  });
});

describe("useEnvelopeFollowerStore – removeEnvelopeFollower", () => {
  beforeEach(() => {
    localStorageMock.clear();
    clearAll();
  });

  it("entfernt eine Config bei matching id", () => {
    const id = addEnvelopeFollower(baseConfig());
    removeEnvelopeFollower(id);
    expect(getEnvelopeFollowerConfigs()).toEqual([]);
  });

  it("entfernt nur den Match, andere bleiben", () => {
    const id1 = addEnvelopeFollower(baseConfig());
    const id2 = addEnvelopeFollower(baseConfig());
    removeEnvelopeFollower(id1);
    const remaining = getEnvelopeFollowerConfigs();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(id2);
  });

  it("unbekannte id → no-op", () => {
    addEnvelopeFollower(baseConfig());
    removeEnvelopeFollower("nope-id");
    expect(getEnvelopeFollowerConfigs()).toHaveLength(1);
  });
});

describe("useEnvelopeFollowerStore – updateEnvelopeFollower", () => {
  beforeEach(() => {
    localStorageMock.clear();
    clearAll();
  });

  it("ändert nur das matching id", () => {
    const id1 = addEnvelopeFollower(baseConfig());
    const id2 = addEnvelopeFollower(baseConfig());
    updateEnvelopeFollower(id1, { amount: 0.9 });
    const configs = getEnvelopeFollowerConfigs();
    expect(configs.find((c) => c.id === id1)!.amount).toBe(0.9);
    expect(configs.find((c) => c.id === id2)!.amount).toBe(0.5);
  });

  it("partielles Update behält ungeänderte Felder", () => {
    const id = addEnvelopeFollower(baseConfig());
    updateEnvelopeFollower(id, { amount: 0.8 });
    const c = getEnvelopeFollowerConfigs()[0];
    expect(c.amount).toBe(0.8);
    expect(c.sourcePartId).toBe("kick"); // unverändert
    expect(c.target).toBe("volume"); // unverändert
  });

  it("kann target wechseln (volume → filterFreq)", () => {
    const id = addEnvelopeFollower(baseConfig());
    updateEnvelopeFollower(id, { target: "filterFreq" });
    expect(getEnvelopeFollowerConfigs()[0].target).toBe("filterFreq");
  });

  it("unbekannte id → no-op", () => {
    const id = addEnvelopeFollower(baseConfig());
    updateEnvelopeFollower("nope-id", { amount: 0.9 });
    expect(getEnvelopeFollowerConfigs()[0].amount).toBe(0.5);
  });

  it("enabled toggling", () => {
    const id = addEnvelopeFollower(baseConfig());
    updateEnvelopeFollower(id, { enabled: false });
    expect(getEnvelopeFollowerConfigs()[0].enabled).toBe(false);
    updateEnvelopeFollower(id, { enabled: true });
    expect(getEnvelopeFollowerConfigs()[0].enabled).toBe(true);
  });
});

describe("useEnvelopeFollowerStore – localStorage Persistenz", () => {
  beforeEach(() => {
    localStorageMock.clear();
    clearAll();
  });

  it("add persistiert nach localStorage", () => {
    addEnvelopeFollower(baseConfig());
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.configs).toHaveLength(1);
  });

  it("remove persistiert nach localStorage", () => {
    const id = addEnvelopeFollower(baseConfig());
    removeEnvelopeFollower(id);
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.configs).toEqual([]);
  });

  it("update persistiert nach localStorage", () => {
    const id = addEnvelopeFollower(baseConfig());
    updateEnvelopeFollower(id, { amount: 0.85 });
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.configs[0].amount).toBe(0.85);
  });
});
