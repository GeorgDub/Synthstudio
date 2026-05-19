// @vitest-environment node
/**
 * api-settings-wav-bit-depth.test.ts (v3.151.0)
 *
 * Tests für die wavBitDepth-Setting im useApiSettingsStore.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("useApiSettingsStore — wavBitDepth", () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear localStorage between tests for isolation
    if (typeof globalThis.localStorage !== "undefined") {
      try { globalThis.localStorage.clear(); } catch { /* ignore */ }
    }
  });

  it("Default ist 16-bit", async () => {
    const mod = await import("@/store/useApiSettingsStore");
    const settings = mod.getApiSettings();
    expect(settings.wavBitDepth).toBe(16);
  });

  it("WAV_BIT_DEPTHS enthält [16, 24]", async () => {
    const mod = await import("@/store/useApiSettingsStore");
    expect(mod.WAV_BIT_DEPTHS).toEqual([16, 24]);
  });

  it("setWavBitDepth(24) persistiert + getApiSettings liefert 24", async () => {
    const mod = await import("@/store/useApiSettingsStore");
    mod.setWavBitDepth(24);
    expect(mod.getApiSettings().wavBitDepth).toBe(24);
  });

  it("setWavBitDepth(16) zurücksetzen funktioniert", async () => {
    const mod = await import("@/store/useApiSettingsStore");
    mod.setWavBitDepth(24);
    mod.setWavBitDepth(16);
    expect(mod.getApiSettings().wavBitDepth).toBe(16);
  });

  it("setWavBitDepth ignoriert invalid input (defensive)", async () => {
    const mod = await import("@/store/useApiSettingsStore");
    mod.setWavBitDepth(16);
    // @ts-expect-error testing invalid input
    mod.setWavBitDepth(32);
    expect(mod.getApiSettings().wavBitDepth).toBe(16);
    // @ts-expect-error testing invalid input
    mod.setWavBitDepth("foo");
    expect(mod.getApiSettings().wavBitDepth).toBe(16);
  });

  it("Migration: alter Store-State ohne wavBitDepth → default 16", async () => {
    // Simulate old localStorage payload without wavBitDepth.
    if (typeof globalThis.localStorage !== "undefined") {
      const oldPayload = {
        providers: {
          anthropic: { apiKey: "", model: "claude-haiku-4-5-20251001" },
          openai: { apiKey: "", model: "gpt-4o-mini" },
        },
        activeProvider: "anthropic",
        autoSaveEnabled: true,
        snapshotsEnabled: true,
        autoSaveIntervalMin: 3,
        embedBehavior: "auto",
        // wavBitDepth fehlt
      };
      try {
        globalThis.localStorage.setItem("ss-api-settings:v1", JSON.stringify(oldPayload));
      } catch { /* ignore */ }
    }
    vi.resetModules();
    const mod = await import("@/store/useApiSettingsStore");
    expect(mod.getApiSettings().wavBitDepth).toBe(16);
  });
});
