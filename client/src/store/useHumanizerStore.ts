/**
 * Synthstudio – useHumanizerStore
 *
 * Smart Humanizer: Automatische Variation von Patterns für einen natürlicheren Groove.
 *
 * Features:
 * - Swing: Verzögerung jedes zweiten Steps (klassischer Shuffle-Effekt)
 * - Velocity-Jitter: Zufällige Variation der Anschlagstärke
 * - Timing-Jitter: Minimale Timing-Abweichungen (Humanisierung)
 * - Groove-Presets: Vorgefertigte Groove-Templates (MPC, Akai, TR-909, etc.)
 * - Per-Part Humanizer: Unterschiedliche Einstellungen pro Drum-Part
 *
 * Isomorph: Funktioniert im Browser und in Electron.
 */
import { useState, useCallback } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface HumanizerSettings {
  /** Swing-Stärke: 0 = gerade, 1 = maximaler Swing (50% = klassischer Shuffle) */
  swing: number;
  /** Velocity-Jitter: 0 = keine Variation, 1 = maximale Variation */
  velocityJitter: number;
  /** Timing-Jitter in Millisekunden: 0 = perfekt, 20 = stark humanisiert */
  timingJitter: number;
  /** Ob der Humanizer aktiv ist */
  enabled: boolean;
  /** Ob Swing nur auf gerade Steps angewendet wird (klassisch) oder alle */
  swingOnEvenSteps: boolean;
  /** Groove-Preset Name (null = Custom) */
  preset: string | null;
}

export interface GroovePreset {
  name: string;
  description: string;
  swing: number;
  velocityJitter: number;
  timingJitter: number;
}

export interface HumanizerState {
  /** Globale Humanizer-Einstellungen */
  global: HumanizerSettings;
  /** Per-Part Einstellungen (Part-Index → Einstellungen) */
  perPart: Record<number, Partial<HumanizerSettings>>;
  /** Verfügbare Groove-Presets */
  presets: GroovePreset[];
}

export interface HumanizerActions {
  /** Globale Einstellungen aktualisieren */
  updateGlobal: (changes: Partial<HumanizerSettings>) => void;
  /** Per-Part Einstellungen aktualisieren */
  updatePart: (partIndex: number, changes: Partial<HumanizerSettings>) => void;
  /** Per-Part Einstellungen zurücksetzen (nutzt globale) */
  resetPart: (partIndex: number) => void;
  /** Preset laden */
  loadPreset: (presetName: string) => void;
  /** Humanizer ein/ausschalten */
  toggleEnabled: () => void;
  /** Alle Einstellungen zurücksetzen */
  reset: () => void;
  /**
   * Timing-Offset für einen Step berechnen (in Sekunden).
   * Wird vom Sequencer aufgerufen um humanisierte Timing-Werte zu erhalten.
   */
  getTimingOffset: (stepIndex: number, partIndex?: number) => number;
  /**
   * Velocity-Multiplikator für einen Step berechnen (0.5–1.5).
   * Wird vom Sequencer aufgerufen.
   */
  getVelocityMultiplier: (partIndex?: number) => number;
}

// ─── Groove-Presets ───────────────────────────────────────────────────────────

const GROOVE_PRESETS: GroovePreset[] = [
  {
    name: "MPC Classic",
    description: "Klassischer MPC-Swing (66% Shuffle)",
    swing: 0.33,
    velocityJitter: 0.08,
    timingJitter: 2,
  },
  {
    name: "TR-909",
    description: "Roland TR-909 Shuffle-Feeling",
    swing: 0.25,
    velocityJitter: 0.05,
    timingJitter: 1,
  },
  {
    name: "Akai S950",
    description: "Akai S950 Groove (leichter Swing)",
    swing: 0.18,
    velocityJitter: 0.12,
    timingJitter: 3,
  },
  {
    name: "Live Feel",
    description: "Natürliches Live-Spielgefühl",
    swing: 0.05,
    velocityJitter: 0.2,
    timingJitter: 8,
  },
  {
    name: "Techno Tight",
    description: "Straffes Techno-Timing mit minimalem Swing",
    swing: 0.08,
    velocityJitter: 0.03,
    timingJitter: 1,
  },
  {
    name: "Hip-Hop Heavy",
    description: "Schwerer Hip-Hop Swing (70% Shuffle)",
    swing: 0.4,
    velocityJitter: 0.15,
    timingJitter: 5,
  },
  {
    name: "Straight",
    description: "Kein Swing, kein Jitter – maschinenpräzise",
    swing: 0,
    velocityJitter: 0,
    timingJitter: 0,
  },
];

// ─── Standard-Einstellungen ───────────────────────────────────────────────────

const DEFAULT_SETTINGS: HumanizerSettings = {
  swing: 0,
  velocityJitter: 0,
  timingJitter: 0,
  enabled: false,
  swingOnEvenSteps: true,
  preset: null,
};

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

/** Seeded Pseudo-Zufallszahl (deterministisch für reproduzierbare Grooves) */
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

/** Gaußsche Zufallszahl (Box-Muller-Transformation) */
function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHumanizerStore(): HumanizerState & HumanizerActions {
  const [state, setState] = useState<HumanizerState>({
    global: { ...DEFAULT_SETTINGS },
    perPart: {},
    presets: GROOVE_PRESETS,
  });

  const updateGlobal = useCallback((changes: Partial<HumanizerSettings>) => {
    setState((prev) => ({
      ...prev,
      global: { ...prev.global, ...changes, preset: null },
    }));
  }, []);

  const updatePart = useCallback(
    (partIndex: number, changes: Partial<HumanizerSettings>) => {
      setState((prev) => ({
        ...prev,
        perPart: {
          ...prev.perPart,
          [partIndex]: { ...prev.perPart[partIndex], ...changes },
        },
      }));
    },
    []
  );

  const resetPart = useCallback((partIndex: number) => {
    setState((prev) => {
      const perPart = { ...prev.perPart };
      delete perPart[partIndex];
      return { ...prev, perPart };
    });
  }, []);

  const loadPreset = useCallback((presetName: string) => {
    setState((prev) => {
      const preset = prev.presets.find((p) => p.name === presetName);
      if (!preset) return prev;
      return {
        ...prev,
        global: {
          ...prev.global,
          swing: preset.swing,
          velocityJitter: preset.velocityJitter,
          timingJitter: preset.timingJitter,
          enabled: true,
          preset: presetName,
        },
      };
    });
  }, []);

  const toggleEnabled = useCallback(() => {
    setState((prev) => ({
      ...prev,
      global: { ...prev.global, enabled: !prev.global.enabled },
    }));
  }, []);

  const reset = useCallback(() => {
    setState((prev) => ({
      ...prev,
      global: { ...DEFAULT_SETTINGS },
      perPart: {},
    }));
  }, []);

  /**
   * Timing-Offset für einen Step berechnen.
   * Positiv = Step wird später gespielt, Negativ = früher.
   * Einheit: Sekunden
   */
  const getTimingOffset = useCallback(
    (stepIndex: number, partIndex?: number): number => {
      const settings =
        partIndex !== undefined && state.perPart[partIndex]
          ? { ...state.global, ...state.perPart[partIndex] }
          : state.global;

      if (!settings.enabled) return 0;

      let offset = 0;

      // Swing: Jeder zweite Step wird verzögert
      if (settings.swing > 0 && settings.swingOnEvenSteps) {
        const isSwingStep = stepIndex % 2 === 1; // Ungerade Steps (0-basiert)
        if (isSwingStep) {
          // Swing-Offset: 0 = 50% (gerade), 0.5 = 75% (maximaler Swing)
          // Bei 120 BPM: 1 Step = 125ms, Swing-Offset = swing * 125ms
          const stepDurationMs = 60000 / 120 / 4; // Wird vom Sequencer überschrieben
          offset += settings.swing * stepDurationMs * 0.001; // In Sekunden
        }
      }

      // Timing-Jitter: Gaußsche Verteilung um 0
      if (settings.timingJitter > 0) {
        const jitterMs = gaussianRandom(0, settings.timingJitter * 0.5);
        offset += jitterMs * 0.001; // In Sekunden
      }

      return offset;
    },
    [state.global, state.perPart]
  );

  /**
   * Velocity-Multiplikator berechnen.
   * 1.0 = keine Änderung, < 1 = leiser, > 1 = lauter
   */
  const getVelocityMultiplier = useCallback(
    (partIndex?: number): number => {
      const settings =
        partIndex !== undefined && state.perPart[partIndex]
          ? { ...state.global, ...state.perPart[partIndex] }
          : state.global;

      if (!settings.enabled || settings.velocityJitter === 0) return 1.0;

      // Gaußsche Verteilung um 1.0
      const multiplier = gaussianRandom(1.0, settings.velocityJitter * 0.3);
      return Math.max(0.1, Math.min(2.0, multiplier));
    },
    [state.global, state.perPart]
  );

  return {
    ...state,
    updateGlobal,
    updatePart,
    resetPart,
    loadPreset,
    toggleEnabled,
    reset,
    getTimingOffset,
    getVelocityMultiplier,
  };
}
