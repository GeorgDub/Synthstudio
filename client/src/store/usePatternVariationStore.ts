/**
 * Synthstudio – usePatternVariationStore (v3.105.0)
 *
 * Singular Variation-Generator Store (nicht zu verwechseln mit
 * usePatternVariationsStore — das sind die A/B/C/D Slot-Variationen).
 *
 * Hält die zuletzt verwendete VariationConfig (für UI-Persistence) und
 * stellt batch-generate Helpers bereit.
 *
 * Pattern: Modul-Singleton + React Hook (Observer-Pattern, kein Zustand npm).
 */
import { useEffect, useReducer } from "react";
import type { StepData, PatternData } from "@/audio/AudioEngine";
import {
  applyVariation,
  type VariationConfig,
  type VariationKind,
} from "@/utils/patternVariations";

// ─── Konstanten ───────────────────────────────────────────────────────────────

const STORAGE_KEY = "ss-pattern-variation-gen:v1";

const DEFAULT_CONFIG: VariationConfig = {
  kind: "humanize",
  intensity: 0.5,
};

// ─── State ────────────────────────────────────────────────────────────────────

export interface PatternVariationGenState {
  /** Zuletzt verwendete Config (für UI-Restore) */
  lastUsedConfig: VariationConfig;
}

const DEFAULT_STATE: PatternVariationGenState = {
  lastUsedConfig: { ...DEFAULT_CONFIG },
};

// ─── Singleton + Listener ─────────────────────────────────────────────────────

let _state: PatternVariationGenState = _loadState();
const _listeners = new Set<() => void>();

function _notify(): void {
  _listeners.forEach((fn) => fn());
}

function _loadState(): PatternVariationGenState {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_STATE };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<PatternVariationGenState>;
    const cfg = parsed.lastUsedConfig;
    if (cfg && typeof cfg === "object" && typeof cfg.kind === "string") {
      return {
        lastUsedConfig: {
          kind: cfg.kind as VariationKind,
          intensity: typeof cfg.intensity === "number" && Number.isFinite(cfg.intensity)
            ? Math.max(0, Math.min(1, cfg.intensity))
            : DEFAULT_CONFIG.intensity,
          seed: typeof cfg.seed === "number" && Number.isFinite(cfg.seed) ? cfg.seed : undefined,
        },
      };
    }
    return { ...DEFAULT_STATE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function _persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    /* ignore */
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getPatternVariationGenState(): PatternVariationGenState {
  return _state;
}

export function setLastUsedConfig(config: VariationConfig): void {
  _state = { ...DEFAULT_STATE, lastUsedConfig: { ...config } };
  _persist();
  _notify();
}

/**
 * Pure Preview: erzeugt das Variation-Grid ohne Side-Effects.
 * Deterministisch wenn config.seed gesetzt ist.
 */
export function previewVariation(
  grid: StepData[][],
  config: VariationConfig,
): StepData[][] {
  return applyVariation(grid, config);
}

/**
 * Erzeugt N Varianten eines Source-Patterns. Für jede Config in `configs`
 * wird `duplicateAndApply` aufgerufen — gibt die neuen Pattern-IDs zurück.
 *
 * Dependency-Injection: der Caller stellt `duplicateAndApply` bereit, das
 * - Source-Pattern dupliziert (z.B. via dm.duplicatePattern + dm.addPatternData)
 * - die Variation auf das neue Pattern anwendet
 * - die neue Pattern-ID zurückgibt
 *
 * Der Store mutiert die DrumMachine nicht direkt — das hält Tests DOM-frei.
 */
export function generateBatch(
  configs: VariationConfig[],
  duplicateAndApply: (config: VariationConfig) => string,
): string[] {
  const ids: string[] = [];
  for (const config of configs) {
    const newId = duplicateAndApply(config);
    if (newId) ids.push(newId);
  }
  return ids;
}

/**
 * Wendet eine Variation direkt auf ein PatternData-Objekt an — gibt ein NEUES
 * Pattern zurück (keine Mutation). Verwendet vom Panel beim "Apply".
 */
export function applyVariationToPattern(
  source: PatternData,
  config: VariationConfig,
  newName?: string,
): PatternData {
  const variedParts = source.parts.map((part) => {
    const variedGrid = applyVariation([part.steps], config);
    return { ...part, steps: variedGrid[0] };
  });
  return {
    ...source,
    parts: variedParts,
    name: newName ?? `${source.name} (${config.kind})`,
  };
}

/** Nur für Unit-Tests. */
export function __resetPatternVariationGenForTests(): void {
  _state = { ...DEFAULT_STATE };
  _listeners.clear();
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export function usePatternVariationStore() {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    lastUsedConfig: _state.lastUsedConfig,
    setLastUsedConfig,
    previewVariation,
    generateBatch,
    applyVariationToPattern,
  };
}
