/**
 * tests/features/api-settings-embed-behavior.test.ts (v3.138.0 NEU)
 *
 * Unit-Tests für das v3.138 embedBehavior-Feld im useApiSettingsStore.
 * Verifiziert: Default-Value, Setter+Persistence, Migration alt → neu.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => { store[k] = v; },
    removeItem: (k: string): void => { delete store[k]; },
    clear: (): void => { store = {}; },
    _raw: () => store,
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

const STORAGE_KEY = "ss-api-settings:v1";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("v3.138 useApiSettingsStore embedBehavior — Default & Setter", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.resetModules();
  });

  it("Default embedBehavior === 'auto'", async () => {
    const { getApiSettings } = await import("../../client/src/store/useApiSettingsStore");
    const s = getApiSettings();
    expect(s.embedBehavior).toBe("auto");
  });

  it("setEmbedBehavior('always') persistiert in localStorage", async () => {
    const { setEmbedBehavior, getApiSettings } = await import(
      "../../client/src/store/useApiSettingsStore"
    );
    setEmbedBehavior("always");
    expect(getApiSettings().embedBehavior).toBe("always");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.embedBehavior).toBe("always");
  });

  it("setEmbedBehavior('never') persistiert in localStorage", async () => {
    const { setEmbedBehavior, getApiSettings } = await import(
      "../../client/src/store/useApiSettingsStore"
    );
    setEmbedBehavior("never");
    expect(getApiSettings().embedBehavior).toBe("never");
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.embedBehavior).toBe("never");
  });

  it("setEmbedBehavior ignoriert invalid Werte (no-op)", async () => {
    const mod = await import("../../client/src/store/useApiSettingsStore");
    mod.setEmbedBehavior("always");
    // Forced invalid input via cast
    (mod.setEmbedBehavior as (v: unknown) => void)("garbage");
    expect(mod.getApiSettings().embedBehavior).toBe("always");
  });

  it("Setter-Round-Trip: auto → always → never → auto", async () => {
    const { setEmbedBehavior, getApiSettings } = await import(
      "../../client/src/store/useApiSettingsStore"
    );
    expect(getApiSettings().embedBehavior).toBe("auto");
    setEmbedBehavior("always");
    expect(getApiSettings().embedBehavior).toBe("always");
    setEmbedBehavior("never");
    expect(getApiSettings().embedBehavior).toBe("never");
    setEmbedBehavior("auto");
    expect(getApiSettings().embedBehavior).toBe("auto");
  });
});

describe("v3.138 Migration — alter Store-State ohne embedBehavior-Feld", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.resetModules();
  });

  it("Load von altem Storage-Payload (new-schema ohne embedBehavior) → 'auto'", async () => {
    // Simuliere v3.137-localStorage-Payload: providers-Feld vorhanden, aber kein
    // embedBehavior. Default-Migration muss 'auto' liefern.
    const oldPayload = {
      activeProvider: "anthropic",
      providers: {
        anthropic: { apiKey: "sk-test", model: "claude-haiku-4-5-20251001" },
        openai: { apiKey: "", model: "gpt-4o-mini" },
      },
      autoSaveEnabled: true,
      snapshotsEnabled: true,
      autoSaveIntervalMin: 5,
      // ABSICHTLICH KEIN embedBehavior — emuliert pre-v3.138-State.
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(oldPayload));

    const { getApiSettings } = await import(
      "../../client/src/store/useApiSettingsStore"
    );
    const s = getApiSettings();
    expect(s.embedBehavior).toBe("auto");
    // Andere Felder müssen erhalten geblieben sein:
    expect(s.autoSaveIntervalMin).toBe(5);
    expect(s.providers.anthropic.apiKey).toBe("sk-test");
  });

  it("Load von Legacy-Payload (kein providers-Feld) → embedBehavior='auto'", async () => {
    // Simuliere pre-v1.25-Payload: anthropicApiKey + aiModel direkt.
    const legacy = {
      anthropicApiKey: "sk-legacy",
      aiModel: "claude-haiku-4-5-20251001",
      autoSaveEnabled: false,
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const { getApiSettings } = await import(
      "../../client/src/store/useApiSettingsStore"
    );
    const s = getApiSettings();
    expect(s.embedBehavior).toBe("auto");
    expect(s.providers.anthropic.apiKey).toBe("sk-legacy");
    expect(s.autoSaveEnabled).toBe(false);
  });

  it("Load von Storage mit invalidem embedBehavior-Wert → fallback 'auto'", async () => {
    const corruptPayload = {
      activeProvider: "anthropic",
      providers: {
        anthropic: { apiKey: "", model: "claude-haiku-4-5-20251001" },
        openai: { apiKey: "", model: "gpt-4o-mini" },
      },
      autoSaveEnabled: true,
      snapshotsEnabled: true,
      autoSaveIntervalMin: 3,
      embedBehavior: "garbage-value",
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(corruptPayload));

    const { getApiSettings } = await import(
      "../../client/src/store/useApiSettingsStore"
    );
    expect(getApiSettings().embedBehavior).toBe("auto");
  });

  it("Load von Storage mit valid embedBehavior-Wert → erhalten", async () => {
    const payload = {
      activeProvider: "anthropic",
      providers: {
        anthropic: { apiKey: "", model: "claude-haiku-4-5-20251001" },
        openai: { apiKey: "", model: "gpt-4o-mini" },
      },
      autoSaveEnabled: true,
      snapshotsEnabled: true,
      autoSaveIntervalMin: 3,
      embedBehavior: "always",
    };
    localStorageMock.setItem(STORAGE_KEY, JSON.stringify(payload));

    const { getApiSettings } = await import(
      "../../client/src/store/useApiSettingsStore"
    );
    expect(getApiSettings().embedBehavior).toBe("always");
  });
});

describe("v3.138 EMBED_BEHAVIORS constant + EmbedBehavior type-export", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.resetModules();
  });

  it("exportiert EMBED_BEHAVIORS = ['auto','always','never']", async () => {
    const { EMBED_BEHAVIORS } = await import(
      "../../client/src/store/useApiSettingsStore"
    );
    expect(EMBED_BEHAVIORS).toEqual(["auto", "always", "never"]);
  });
});
