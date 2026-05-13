/**
 * tests/features/api-settings.test.ts
 *
 * Unit-Tests fuer useApiSettingsStore.
 * Testet die imperativen Setter und den getApiSettings()-Getter
 * (Singleton-Store, Hook wird ausgelassen weil React in Node ohne DOM
 *  nicht ohne weiteres testbar ist).
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => store[k] ?? null,
    setItem: (k: string, v: string): void => {
      store[k] = v;
    },
    removeItem: (k: string): void => {
      delete store[k];
    },
    clear: (): void => {
      store = {};
    },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  setApiKey,
  setAiModel,
  setAutoSaveEnabled,
  setSnapshotsEnabled,
  setAutoSaveInterval,
  getApiSettings,
  setActiveProvider,
  setProviderKey,
  setProviderModel,
  getActiveProviderConfig,
} from "../../client/src/store/useApiSettingsStore";

const STORAGE_KEY = "ss-api-settings:v1";

describe("useApiSettingsStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    // Reset zu Default-Werten ueber die exportierten Setter.
    // WICHTIG: erst aktiven Provider auf anthropic, dann beide Keys leeren.
    setActiveProvider("anthropic");
    setProviderKey("anthropic", "");
    setProviderKey("openai", "");
    setProviderModel("anthropic", "claude-haiku-4-5-20251001");
    setProviderModel("openai", "gpt-4o-mini");
    setAutoSaveEnabled(true);
    setSnapshotsEnabled(true);
    setAutoSaveInterval(3);
  });

  it("hat sinnvolle Default-Werte nach Reset", () => {
    const s = getApiSettings();
    expect(s.anthropicApiKey).toBe("");
    expect(s.aiModel).toBe("claude-haiku-4-5-20251001");
    expect(s.autoSaveEnabled).toBe(true);
    expect(s.snapshotsEnabled).toBe(true);
    expect(s.autoSaveIntervalMin).toBe(3);
  });

  it("setApiKey speichert den Key und aktiviert AI automatisch", () => {
    setApiKey("sk-ant-test-key");
    const s = getApiSettings();
    expect(s.anthropicApiKey).toBe("sk-ant-test-key");
    expect(s.aiEnabled).toBe(true);
  });

  it("setApiKey leerer String deaktiviert AI", () => {
    setApiKey("some-key");
    setApiKey("");
    const s = getApiSettings();
    expect(s.anthropicApiKey).toBe("");
    expect(s.aiEnabled).toBe(false);
  });

  it("setApiKey trimmt Whitespace", () => {
    setApiKey("   sk-trimmed   ");
    expect(getApiSettings().anthropicApiKey).toBe("sk-trimmed");
  });

  it("setAiModel aktualisiert den Modell-Namen", () => {
    setAiModel("claude-opus-4-7");
    expect(getApiSettings().aiModel).toBe("claude-opus-4-7");
  });

  it("setAutoSaveEnabled toggelt Auto-Save", () => {
    setAutoSaveEnabled(false);
    expect(getApiSettings().autoSaveEnabled).toBe(false);
    setAutoSaveEnabled(true);
    expect(getApiSettings().autoSaveEnabled).toBe(true);
  });

  it("setSnapshotsEnabled toggelt Snapshots", () => {
    setSnapshotsEnabled(false);
    expect(getApiSettings().snapshotsEnabled).toBe(false);
    setSnapshotsEnabled(true);
    expect(getApiSettings().snapshotsEnabled).toBe(true);
  });

  it("setAutoSaveInterval klemmt Werte zwischen 1 und 60 Minuten", () => {
    setAutoSaveInterval(0);
    expect(getApiSettings().autoSaveIntervalMin).toBe(1);
    setAutoSaveInterval(120);
    expect(getApiSettings().autoSaveIntervalMin).toBe(60);
    setAutoSaveInterval(15);
    expect(getApiSettings().autoSaveIntervalMin).toBe(15);
  });

  it("persistiert Settings in localStorage", () => {
    setApiKey("sk-persist");
    setAiModel("test-model");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    // Post-v1.25.0: persistiertes Schema nutzt providers.<provider>.{apiKey,model}.
    // Backward-compat: setApiKey/setAiModel schreiben in den AKTIVEN Provider
    // (default = anthropic).
    expect(parsed.activeProvider).toBe("anthropic");
    expect(parsed.providers.anthropic.apiKey).toBe("sk-persist");
    expect(parsed.providers.anthropic.model).toBe("test-model");
  });

  // ─── Multi-Provider Tests (post-v1.25.0) ───────────────────────────────────

  it("setActiveProvider wechselt zwischen anthropic und openai", () => {
    setActiveProvider("openai");
    expect(getApiSettings().activeProvider).toBe("openai");
    setActiveProvider("anthropic");
    expect(getApiSettings().activeProvider).toBe("anthropic");
  });

  it("setActiveProvider mit ungültigem Provider wird ignoriert", () => {
    setActiveProvider("anthropic");
    setActiveProvider("invalid" as never);
    expect(getApiSettings().activeProvider).toBe("anthropic");
  });

  it("setProviderKey isoliert Keys zwischen Providern", () => {
    setProviderKey("anthropic", "sk-ant-xxx");
    setProviderKey("openai", "sk-oai-yyy");
    const s = getApiSettings();
    expect(s.providers.anthropic.apiKey).toBe("sk-ant-xxx");
    expect(s.providers.openai.apiKey).toBe("sk-oai-yyy");
  });

  it("setProviderModel isoliert Modelle zwischen Providern", () => {
    setProviderModel("anthropic", "claude-opus-4-7");
    setProviderModel("openai", "gpt-4o");
    const s = getApiSettings();
    expect(s.providers.anthropic.model).toBe("claude-opus-4-7");
    expect(s.providers.openai.model).toBe("gpt-4o");
  });

  it("setApiKey ohne Provider-Param schreibt in den aktiven Provider", () => {
    setActiveProvider("openai");
    setApiKey("sk-oai-active");
    const s = getApiSettings();
    expect(s.providers.openai.apiKey).toBe("sk-oai-active");
    expect(s.providers.anthropic.apiKey).toBe(""); // unverändert
  });

  it("aiEnabled reflektiert den Key des AKTIVEN Providers", () => {
    setProviderKey("openai", "sk-oai-set");
    setActiveProvider("anthropic");
    // anthropic hat keinen Key → aiEnabled=false
    expect(getApiSettings().aiEnabled).toBe(false);
    setActiveProvider("openai");
    // openai hat Key → aiEnabled=true
    expect(getApiSettings().aiEnabled).toBe(true);
  });

  it("aiModel (derived) reflektiert das Modell des AKTIVEN Providers", () => {
    setProviderModel("anthropic", "claude-sonnet-4-6");
    setProviderModel("openai", "gpt-4-turbo");
    setActiveProvider("anthropic");
    expect(getApiSettings().aiModel).toBe("claude-sonnet-4-6");
    setActiveProvider("openai");
    expect(getApiSettings().aiModel).toBe("gpt-4-turbo");
  });

  it("anthropicApiKey (derived) zeigt immer den anthropic-Key — auch wenn openai aktiv", () => {
    setProviderKey("anthropic", "sk-ant-legacy-readers");
    setActiveProvider("openai");
    // Legacy-Konsumenten lesen weiterhin den Anthropic-Key
    expect(getApiSettings().anthropicApiKey).toBe("sk-ant-legacy-readers");
  });

  it("getActiveProviderConfig liefert Provider + Key + Modell zusammen", () => {
    setProviderKey("openai", "sk-oai-test");
    setProviderModel("openai", "gpt-4o");
    setActiveProvider("openai");
    const cfg = getActiveProviderConfig();
    expect(cfg.provider).toBe("openai");
    expect(cfg.apiKey).toBe("sk-oai-test");
    expect(cfg.model).toBe("gpt-4o");
  });

  it("persistiert beide Provider unabhängig", () => {
    setProviderKey("anthropic", "sk-ant-1");
    setProviderKey("openai", "sk-oai-2");
    setActiveProvider("openai");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed.activeProvider).toBe("openai");
    expect(parsed.providers.anthropic.apiKey).toBe("sk-ant-1");
    expect(parsed.providers.openai.apiKey).toBe("sk-oai-2");
  });
});

// ─── Migrations-Test (Legacy → Multi-Provider) ───────────────────────────────

describe("useApiSettingsStore — Migration alt → neu", () => {
  // Wir testen die Migration indirekt: Legacy-Format in localStorage schreiben,
  // dann den Store erneut laden lassen — nicht trivial wegen Module-Singleton.
  // Stattdessen testen wir die Migrations-Helper-Funktion direkt nicht (privat),
  // aber wir können mindestens checken dass beim Reset die Defaults konsistent
  // sind und das neue Schema valide bleibt.

  it("Default-State hat beide Provider mit leerem Key und Default-Modell", () => {
    localStorageMock.clear();
    setActiveProvider("anthropic");
    setProviderKey("anthropic", "");
    setProviderKey("openai", "");
    const s = getApiSettings();
    expect(s.providers.anthropic.apiKey).toBe("");
    expect(s.providers.openai.apiKey).toBe("");
    expect(s.providers.anthropic.model).toMatch(/claude/);
    expect(s.providers.openai.model).toMatch(/gpt/);
  });
});
