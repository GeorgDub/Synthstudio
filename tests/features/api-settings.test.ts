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
} from "../../client/src/store/useApiSettingsStore";

const STORAGE_KEY = "ss-api-settings:v1";

describe("useApiSettingsStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    // Reset zu Default-Werten ueber die exportierten Setter
    setApiKey("");
    setAiModel("claude-haiku-4-5-20251001");
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
    expect(parsed.anthropicApiKey).toBe("sk-persist");
    expect(parsed.aiModel).toBe("test-model");
  });
});
