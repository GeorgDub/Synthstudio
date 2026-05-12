/**
 * tests/envelope-follower.test.ts
 *
 * Unit-Tests für Envelope-Follower-Store: Config-Verwaltung.
 */
import { describe, it, expect, beforeEach } from "vitest";

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
}
const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock, writable: true, configurable: true,
});

import {
  addEnvelopeFollower,
  removeEnvelopeFollower,
  updateEnvelopeFollower,
  getEnvelopeFollowerConfigs,
} from "../client/src/store/useEnvelopeFollowerStore";

function clearAll() {
  getEnvelopeFollowerConfigs().forEach(c => removeEnvelopeFollower(c.id));
}

beforeEach(() => {
  localStorageMock.clear();
  clearAll();
});

describe("EnvelopeFollower Store", () => {
  it("fügt einen Follower hinzu", () => {
    const id = addEnvelopeFollower({
      enabled: true,
      sourcePartId: "kick", sourcePartName: "Kick",
      targetPartId: "bass", targetPartName: "Bass",
      target: "volume", amount: 0.5,
      attackMs: 10, releaseMs: 100,
    });
    expect(id).toMatch(/^ef-/);
    expect(getEnvelopeFollowerConfigs()).toHaveLength(1);
    expect(getEnvelopeFollowerConfigs()[0].target).toBe("volume");
  });

  it("entfernt einen Follower via ID", () => {
    const id = addEnvelopeFollower({
      enabled: true, sourcePartId: "a", sourcePartName: "A",
      targetPartId: "b", targetPartName: "B",
      target: "pan", amount: 1, attackMs: 1, releaseMs: 100,
    });
    expect(getEnvelopeFollowerConfigs()).toHaveLength(1);
    removeEnvelopeFollower(id);
    expect(getEnvelopeFollowerConfigs()).toHaveLength(0);
  });

  it("aktualisiert einen Follower (partial update)", () => {
    const id = addEnvelopeFollower({
      enabled: true, sourcePartId: "a", sourcePartName: "A",
      targetPartId: "b", targetPartName: "B",
      target: "volume", amount: 0.3, attackMs: 5, releaseMs: 50,
    });
    updateEnvelopeFollower(id, { amount: 0.9, enabled: false });
    const cfg = getEnvelopeFollowerConfigs()[0];
    expect(cfg.amount).toBe(0.9);
    expect(cfg.enabled).toBe(false);
    expect(cfg.target).toBe("volume"); // unverändert
    expect(cfg.attackMs).toBe(5);
  });

  it("persistiert Configs in localStorage", () => {
    addEnvelopeFollower({
      enabled: true, sourcePartId: "x", sourcePartName: "X",
      targetPartId: "y", targetPartName: "Y",
      target: "reverbMix", amount: 0.5, attackMs: 10, releaseMs: 200,
    });
    const raw = localStorageMock.getItem("ss-envelope-follower:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.configs).toHaveLength(1);
    expect(parsed.configs[0].target).toBe("reverbMix");
  });

  it("unterstützt mehrere gleichzeitige Follower", () => {
    addEnvelopeFollower({
      enabled: true, sourcePartId: "k", sourcePartName: "K",
      targetPartId: "b", targetPartName: "B",
      target: "volume", amount: 0.5, attackMs: 10, releaseMs: 100,
    });
    addEnvelopeFollower({
      enabled: false, sourcePartId: "s", sourcePartName: "S",
      targetPartId: "h", targetPartName: "H",
      target: "filterFreq", amount: 0.8, attackMs: 5, releaseMs: 50,
    });
    expect(getEnvelopeFollowerConfigs()).toHaveLength(2);
  });
});
