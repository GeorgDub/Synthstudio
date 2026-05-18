/**
 * tests/features/audio-engine-config.test.ts
 *
 * Unit-Tests fuer den Audio-Engine-Config-Store (v3.0.0 / TASK-236-ALT).
 * Testet:
 *   - Defaults
 *   - latencyHint-Persistenz + Validierung
 *   - sampleRate-Persistenz + Validierung
 *   - buildAudioContextOptions liefert korrektes Options-Objekt
 *   - sanitize-on-load (kaputte localStorage-Blobs → Defaults)
 *
 * AudioContext-Init wird NICHT real getestet (Node-Env hat kein Web-Audio).
 * Stattdessen pruefen wir den Pure-Helper buildAudioContextOptions, der
 * der einzige Berührungspunkt zwischen Store und AudioEngine.init() ist.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ─── localStorage Mock (analog api-settings.test.ts) ─────────────────────────

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
  getAudioEngineConfig,
  setLatencyHint,
  setSampleRate,
  buildAudioContextOptions,
  __resetAudioEngineConfigForTests,
  DEFAULT_CONFIG,
  type LatencyHint,
  type SampleRateOption,
} from "../../client/src/store/useAudioEngineConfigStore";

const STORAGE_KEY = "ss-audio-engine-config:v1";

describe("useAudioEngineConfigStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    __resetAudioEngineConfigForTests();
  });

  // ── Defaults ───────────────────────────────────────────────────────────────

  it("Store-Default ist 'interactive' + sampleRate 'auto'", () => {
    const cfg = getAudioEngineConfig();
    expect(cfg.latencyHint).toBe("interactive");
    expect(cfg.sampleRate).toBe("auto");
    // DEFAULT_CONFIG ist exposed für externe Konsumenten (z.B. AudioEngine).
    expect(DEFAULT_CONFIG.latencyHint).toBe("interactive");
    expect(DEFAULT_CONFIG.sampleRate).toBe("auto");
  });

  // ── Latency-Hint ───────────────────────────────────────────────────────────

  it("Latency-Hint-Wechsel persistiert in localStorage", () => {
    setLatencyHint("balanced");
    expect(getAudioEngineConfig().latencyHint).toBe("balanced");
    const raw = localStorageMock.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.latencyHint).toBe("balanced");
  });

  it("Latency-Hint ungültiger Wert ist no-op", () => {
    setLatencyHint("balanced");
    // @ts-expect-error — bewusst ungültiger Wert
    setLatencyHint("crazy-fast");
    expect(getAudioEngineConfig().latencyHint).toBe("balanced");
  });

  it("Latency-Hint identischer Wert triggert keinen Re-Write", () => {
    setLatencyHint("playback");
    const firstWrite = localStorageMock.getItem(STORAGE_KEY);
    // Manipulier den Storage manuell — wenn setLatencyHint identisch
    // re-persistiert, würde das hier wieder überschrieben.
    localStorageMock.setItem(STORAGE_KEY, "MARKER");
    setLatencyHint("playback");
    expect(localStorageMock.getItem(STORAGE_KEY)).toBe("MARKER");
    // sanity: vorheriger Write war kein Marker.
    expect(firstWrite).not.toBe("MARKER");
  });

  // ── Sample-Rate ────────────────────────────────────────────────────────────

  it("Sample-Rate-Wechsel persistiert", () => {
    setSampleRate(48000);
    expect(getAudioEngineConfig().sampleRate).toBe(48000);
    const parsed = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
    expect(parsed.sampleRate).toBe(48000);
  });

  it("Sample-Rate akzeptiert nur Whitelist (44.1/48/96/auto)", () => {
    setSampleRate("auto");
    // @ts-expect-error — ungültige Rate
    setSampleRate(22050);
    expect(getAudioEngineConfig().sampleRate).toBe("auto");
    // @ts-expect-error — ungültiger String
    setSampleRate("crazy");
    expect(getAudioEngineConfig().sampleRate).toBe("auto");
    // Gültige Werte gehen durch.
    setSampleRate(96000);
    expect(getAudioEngineConfig().sampleRate).toBe(96000);
  });

  // ── buildAudioContextOptions ──────────────────────────────────────────────

  it("buildAudioContextOptions liefert nur latencyHint bei sampleRate='auto'", () => {
    setLatencyHint("interactive");
    setSampleRate("auto");
    const opts = buildAudioContextOptions();
    expect(opts.latencyHint).toBe("interactive");
    // Wichtig: sampleRate darf NICHT gesetzt sein wenn 'auto', sonst
    // resampelt der Browser bei Mismatch unnötig CPU-intensiv.
    expect("sampleRate" in opts).toBe(false);
  });

  it("buildAudioContextOptions setzt sampleRate wenn konkret gewählt", () => {
    setLatencyHint("balanced");
    setSampleRate(48000);
    const opts = buildAudioContextOptions();
    expect(opts.latencyHint).toBe("balanced");
    expect(opts.sampleRate).toBe(48000);
  });

  it("buildAudioContextOptions akzeptiert explizite Config (Test-Helper)", () => {
    const opts = buildAudioContextOptions({
      latencyHint: "playback" as LatencyHint,
      sampleRate: 96000 as SampleRateOption,
    });
    expect(opts.latencyHint).toBe("playback");
    expect(opts.sampleRate).toBe(96000);
  });

  // ── Sanitize-on-Load ──────────────────────────────────────────────────────

  it("sanitize: kaputtes localStorage-Blob → Defaults", () => {
    // Wir testen das indirekt: schreiben einen kaputten Blob, resetten den
    // In-Memory-State + lassen die Datei erneut importieren wäre overkill —
    // stattdessen prüfen wir dass __reset funktioniert + nach manueller
    // korrumpiertem Storage der nächste setter sauber arbeitet.
    localStorageMock.setItem(STORAGE_KEY, "{not-valid-json");
    __resetAudioEngineConfigForTests();
    expect(getAudioEngineConfig().latencyHint).toBe("interactive");
    expect(getAudioEngineConfig().sampleRate).toBe("auto");
  });

  // ── Independence ──────────────────────────────────────────────────────────

  it("Latency-Hint und Sample-Rate sind unabhängig", () => {
    setLatencyHint("playback");
    setSampleRate(96000);
    expect(getAudioEngineConfig()).toMatchObject({
      latencyHint: "playback",
      sampleRate: 96000,
    });
    setLatencyHint("interactive");
    expect(getAudioEngineConfig().sampleRate).toBe(96000);
    setSampleRate("auto");
    expect(getAudioEngineConfig().latencyHint).toBe("interactive");
  });

  // ── AudioContext-Init-Mock ────────────────────────────────────────────────

  it("AudioContext wird mit gewählter Latency-Hint erstellt (Mock)", () => {
    // Mock AudioContext-Konstruktor — capture Args.
    const captured: Array<AudioContextOptions | undefined> = [];
    class MockAudioContext {
      constructor(opts?: AudioContextOptions) {
        captured.push(opts);
      }
    }
    // Run buildAudioContextOptions wie AudioEngine.init() es tun würde.
    setLatencyHint("interactive");
    setSampleRate(48000);
    const opts = buildAudioContextOptions();
    new MockAudioContext(opts);
    expect(captured.length).toBe(1);
    expect(captured[0]).toEqual({ latencyHint: "interactive", sampleRate: 48000 });
  });
});
