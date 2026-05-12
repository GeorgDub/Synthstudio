/**
 * tests/keyboard-sampler.test.ts
 *
 * Unit-Tests für den Multi-Sample Keyboard Sampler Store.
 * Testet Zone-Management, Note-Matching und Playback-Rate-Berechnung.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock ────────────────────────────────────────────────────────

function createLocalStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem:    (key: string): string | null => store[key] ?? null,
    setItem:    (key: string, value: string): void => { store[key] = value; },
    removeItem: (key: string): void => { delete store[key]; },
    clear:      (): void => { store = {}; },
  };
}

const localStorageMock = createLocalStorageMock();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock, writable: true, configurable: true,
});

import {
  addSampleZone,
  removeSampleZone,
  updateSampleZone,
  setKeyboardSamplerEnabled,
  findZones,
  zonePlaybackRate,
  getKeyboardSamplerState,
  type SampleZone,
} from "../client/src/store/useKeyboardSamplerStore";

function clearAllZones() {
  const ids = getKeyboardSamplerState().zones.map(z => z.id);
  ids.forEach(removeSampleZone);
}

beforeEach(() => {
  localStorageMock.clear();
  clearAllZones();
  setKeyboardSamplerEnabled(false);
});

describe("KeyboardSampler Store – Zone-Verwaltung", () => {
  it("fügt eine Zone hinzu und gibt eine ID zurück", () => {
    const id = addSampleZone({
      sampleUrl: "test.wav", sampleName: "Test",
      loNote: 60, hiNote: 72, rootNote: 60,
      loVelocity: 0, hiVelocity: 127, volume: 1, pan: 0,
    });
    expect(id).toMatch(/^ksz-/);
    expect(getKeyboardSamplerState().zones).toHaveLength(1);
  });

  it("entfernt eine Zone via ID", () => {
    const id = addSampleZone({
      sampleUrl: "a.wav", sampleName: "A", loNote: 0, hiNote: 127, rootNote: 60,
      loVelocity: 0, hiVelocity: 127, volume: 1, pan: 0,
    });
    expect(getKeyboardSamplerState().zones).toHaveLength(1);
    removeSampleZone(id);
    expect(getKeyboardSamplerState().zones).toHaveLength(0);
  });

  it("aktualisiert eine bestehende Zone", () => {
    const id = addSampleZone({
      sampleUrl: "a.wav", sampleName: "A", loNote: 0, hiNote: 127, rootNote: 60,
      loVelocity: 0, hiVelocity: 127, volume: 1, pan: 0,
    });
    updateSampleZone(id, { rootNote: 48, volume: 0.5 });
    const zone = getKeyboardSamplerState().zones[0];
    expect(zone.rootNote).toBe(48);
    expect(zone.volume).toBe(0.5);
    expect(zone.sampleUrl).toBe("a.wav"); // unverändert
  });

  it("persistiert Zonen in localStorage", () => {
    addSampleZone({
      sampleUrl: "p.wav", sampleName: "P", loNote: 60, hiNote: 72, rootNote: 60,
      loVelocity: 0, hiVelocity: 127, volume: 1, pan: 0,
    });
    const raw = localStorageMock.getItem("ss-keyboard-sampler:v1");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.zones).toHaveLength(1);
  });
});

describe("KeyboardSampler Store – findZones (Note + Velocity Matching)", () => {
  it("findet eine Zone die exakt für eine Note passt", () => {
    addSampleZone({
      sampleUrl: "k.wav", sampleName: "Kick",
      loNote: 36, hiNote: 36, rootNote: 36,
      loVelocity: 0, hiVelocity: 127, volume: 1, pan: 0,
    });
    expect(findZones(36, 100)).toHaveLength(1);
    expect(findZones(37, 100)).toHaveLength(0);
  });

  it("findet keine Zone wenn Velocity außerhalb des Bereichs liegt", () => {
    addSampleZone({
      sampleUrl: "h.wav", sampleName: "Hard",
      loNote: 60, hiNote: 60, rootNote: 60,
      loVelocity: 100, hiVelocity: 127, volume: 1, pan: 0,
    });
    expect(findZones(60, 50)).toHaveLength(0);
    expect(findZones(60, 110)).toHaveLength(1);
  });

  it("findet mehrere überlappende Zonen (Velocity-Layer)", () => {
    addSampleZone({
      sampleUrl: "s.wav", sampleName: "Soft",
      loNote: 60, hiNote: 60, rootNote: 60,
      loVelocity: 0, hiVelocity: 63, volume: 1, pan: 0,
    });
    addSampleZone({
      sampleUrl: "h.wav", sampleName: "Hard",
      loNote: 60, hiNote: 60, rootNote: 60,
      loVelocity: 64, hiVelocity: 127, volume: 1, pan: 0,
    });
    expect(findZones(60, 50)).toHaveLength(1);
    expect(findZones(60, 100)).toHaveLength(1);
    expect(findZones(60, 64)).toHaveLength(1);
  });

  it("findet eine Zone an den Grenzen (lo/hi inklusiv)", () => {
    addSampleZone({
      sampleUrl: "r.wav", sampleName: "Range",
      loNote: 50, hiNote: 60, rootNote: 55,
      loVelocity: 0, hiVelocity: 127, volume: 1, pan: 0,
    });
    expect(findZones(50, 100)).toHaveLength(1); // lo inklusiv
    expect(findZones(60, 100)).toHaveLength(1); // hi inklusiv
    expect(findZones(49, 100)).toHaveLength(0);
    expect(findZones(61, 100)).toHaveLength(0);
  });
});

describe("KeyboardSampler – zonePlaybackRate", () => {
  const zone: SampleZone = {
    id: "test",
    sampleUrl: "u", sampleName: "n",
    loNote: 0, hiNote: 127, rootNote: 60,
    loVelocity: 0, hiVelocity: 127, volume: 1, pan: 0,
  };

  it("gibt 1.0 zurück wenn Note = rootNote", () => {
    expect(zonePlaybackRate(zone, 60)).toBeCloseTo(1.0);
  });

  it("verdoppelt die Rate bei +12 Halbtönen (Oktave höher)", () => {
    expect(zonePlaybackRate(zone, 72)).toBeCloseTo(2.0);
  });

  it("halbiert die Rate bei -12 Halbtönen (Oktave tiefer)", () => {
    expect(zonePlaybackRate(zone, 48)).toBeCloseTo(0.5);
  });

  it("ergibt korrekte gleichschwebende Stimmung für 1 Halbton", () => {
    expect(zonePlaybackRate(zone, 61)).toBeCloseTo(1.0594630943592953);
  });
});
