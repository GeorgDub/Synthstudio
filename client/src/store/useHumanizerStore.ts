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
import { useState, useCallback, useEffect } from "react";
import { GROOVE_TEMPLATES, type GrooveTemplate } from "@/utils/grooveEngine";

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
  /**
   * Aktive Groove-Engine-Vorlage (GROOVE_TEMPLATES[].id). Wenn gesetzt, wendet
   * der Sequencer das Per-Step-Timing+Velocity-Profil der Vorlage an statt des
   * einfachen Even-Step-Swings. null/undefined = kein Template (manueller Swing).
   * Optional für Rückwärtskompatibilität mit persistierten Alt-Settings.
   */
  grooveTemplateId?: string | null;
  /** Groove-Intensität 0..1 (0 = aus, 1 = Vorlage voll). Default 1. */
  grooveAmount?: number;
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
  /**
   * Groove-Engine-Vorlage aktivieren (GROOVE_TEMPLATES[].id). Aktiviert den
   * Humanizer, setzt den manuellen Swing auf 0 (die Vorlage besitzt das Timing)
   * und merkt sich den Anzeigenamen als preset.
   */
  loadGrooveTemplate: (templateId: string) => void;
  /** Groove-Intensität setzen (0..1) ohne die aktive Vorlage zu verwerfen. */
  setGrooveAmount: (amount: number) => void;
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
   * Velocity-Multiplikator für einen Step berechnen (0.1–2.0).
   * Wird vom Sequencer aufgerufen.
   */
  getVelocityMultiplier: (stepIndex: number, partIndex?: number) => number;
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
  grooveTemplateId: null,
  grooveAmount: 1.0,
};

// ─── Groove-Engine-Template Helpers ───────────────────────────────────────────

/** Schlägt eine Groove-Template anhand ihrer ID nach (null = keine/unbekannt). */
function resolveGrooveTemplate(id: string | null | undefined): GrooveTemplate | null {
  if (!id) return null;
  return GROOVE_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Clamp der Groove-Intensität auf [0,1] (NaN → 1). */
function clampGrooveAmount(amount: number | undefined): number {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return 1.0;
  return Math.max(0, Math.min(1, amount));
}

// ─── Singleton-State (für nicht-React Konsumenten wie AudioEngine) ───────────
// Wird vom Hook bei jedem Render synchronisiert.

let _singletonState: HumanizerState = {
  global: { ...DEFAULT_SETTINGS },
  perPart: {},
  presets: GROOVE_PRESETS,
};

/** Liefert den aktuellen Humanizer-State (außerhalb React aufrufbar). */
export function getHumanizerState(): HumanizerState {
  return _singletonState;
}

/** Berechnet den Timing-Offset für einen Step in Sekunden (deterministisch). */
export function computeHumanizerTimingOffset(
  stepIndex: number,
  stepDurationSec: number,
  partIndex?: number,
): number {
  const s = _singletonState;
  const settings = partIndex !== undefined && s.perPart[partIndex]
    ? { ...s.global, ...s.perPart[partIndex] } : s.global;
  if (!settings.enabled) return 0;

  let offset = 0;
  const template = resolveGrooveTemplate(settings.grooveTemplateId);
  if (template) {
    // Groove-Engine-Vorlage aktiv: Per-Step-Timing aus dem Template (in ms,
    // relativ zum quantisierten Step) — das ist die eigentliche Groove-Signatur.
    // Ersetzt den einfachen Even-Step-Swing (das Template kodiert ihn bereits).
    const amount = clampGrooveAmount(settings.grooveAmount);
    const tMs = template.timing[stepIndex % template.timing.length] ?? 0;
    offset += tMs * 0.001 * amount;
  } else if (settings.swing > 0 && settings.swingOnEvenSteps && stepIndex % 2 === 1) {
    // Swing-Offset relativ zur tatsächlichen Step-Dauer (BPM-unabhängig).
    offset += settings.swing * stepDurationSec * 0.5;
  }
  if (settings.timingJitter > 0) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, u1))) * Math.cos(2 * Math.PI * u2);
    offset += z * settings.timingJitter * 0.5 * 0.001;
  }
  return offset;
}

/**
 * Berechnet einen Velocity-Multiplikator (0.1..2.0).
 *
 * Kombiniert die Per-Step-Velocity-Kurve einer aktiven Groove-Vorlage
 * (deterministisch) mit dem optionalen Velocity-Jitter (nicht-deterministisch).
 */
export function computeHumanizerVelocityMultiplier(stepIndex: number, partIndex?: number): number {
  const s = _singletonState;
  const settings = partIndex !== undefined && s.perPart[partIndex]
    ? { ...s.global, ...s.perPart[partIndex] } : s.global;
  if (!settings.enabled) return 1.0;

  let multiplier = 1.0;

  // Groove-Vorlage: Per-Step-Velocity-Kurve (z.B. Ghost-Notes bei "Funk Ghost").
  const template = resolveGrooveTemplate(settings.grooveTemplateId);
  if (template) {
    const amount = clampGrooveAmount(settings.grooveAmount);
    const tVel = template.velocity[stepIndex % template.velocity.length] ?? 1.0;
    multiplier *= 1 + (tVel - 1) * amount;
  }

  // Velocity-Jitter: gaußsche Streuung um den aktuellen Multiplikator.
  if (settings.velocityJitter > 0) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, u1))) * Math.cos(2 * Math.PI * u2);
    multiplier *= 1.0 + z * settings.velocityJitter * 0.3;
  }

  return Math.max(0.1, Math.min(2.0, multiplier));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHumanizerStore(): HumanizerState & HumanizerActions {
  const [state, setState] = useState<HumanizerState>(_singletonState);

  // Singleton-State auf React-State syncen damit AudioEngine aktuelle Werte sieht
  useEffect(() => {
    _singletonState = state;
  }, [state]);

  const updateGlobal = useCallback((changes: Partial<HumanizerSettings>) => {
    setState((prev) => ({
      ...prev,
      // Manuelle Slider-Änderung verlässt den Preset-/Template-Modus, sofern die
      // Änderung nicht selbst die Vorlage/Intensität betrifft.
      global: {
        ...prev.global,
        ...changes,
        preset: changes.preset ?? null,
        grooveTemplateId:
          "grooveTemplateId" in changes ? (changes.grooveTemplateId ?? null) : null,
      },
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
          // Jitter-Preset hat Vorrang vor einer evtl. aktiven Groove-Vorlage.
          grooveTemplateId: null,
        },
      };
    });
  }, []);

  const loadGrooveTemplate = useCallback((templateId: string) => {
    setState((prev) => {
      const template = resolveGrooveTemplate(templateId);
      if (!template) return prev;
      return {
        ...prev,
        global: {
          ...prev.global,
          grooveTemplateId: template.id,
          // Die Vorlage besitzt das Timing — manueller Even-Step-Swing aus.
          swing: 0,
          enabled: true,
          preset: template.name,
        },
      };
    });
  }, []);

  const setGrooveAmount = useCallback((amount: number) => {
    const clamped = clampGrooveAmount(amount);
    setState((prev) => ({
      ...prev,
      global: { ...prev.global, grooveAmount: clamped },
    }));
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
  // Delegieren an die Modul-Funktionen (gleiche Logik wie der Sequencer-Pfad).
  // Standard-Step-Dauer 120 BPM / 16tel; der Sequencer übergibt den echten Wert.
  const getTimingOffset = useCallback(
    (stepIndex: number, partIndex?: number): number =>
      computeHumanizerTimingOffset(stepIndex, 60000 / 120 / 4 * 0.001, partIndex),
    []
  );

  const getVelocityMultiplier = useCallback(
    (stepIndex: number, partIndex?: number): number =>
      computeHumanizerVelocityMultiplier(stepIndex, partIndex),
    []
  );

  return {
    ...state,
    updateGlobal,
    updatePart,
    resetPart,
    loadPreset,
    loadGrooveTemplate,
    setGrooveAmount,
    toggleEnabled,
    reset,
    getTimingOffset,
    getVelocityMultiplier,
  };
}
