/**
 * Synthstudio – useAiCostStore (post-v1.40.0)
 *
 * Tracking von AI-Token-Verbrauch pro Provider mit optionalem Monats-Budget-Cap.
 *
 * Was getrackt wird (pro Provider: anthropic / openai):
 *  - `monthInputTokens`: input-Tokens diesen Monat
 *  - `monthOutputTokens`: output-Tokens diesen Monat
 *  - `monthlyCapTokens`: optionaler Cap (input + output). null = kein Cap.
 *
 * Reset-Logik: beim ersten Call eines neuen Monats wird der Counter
 * automatisch auf 0 zurückgesetzt (`currentMonth` field).
 *
 * Persistence: localStorage "ss-ai-cost:v1".
 *
 * Privacy: keine Prompt-Inhalte werden persistiert — nur Token-Counts +
 * Provider-Tag + Timestamp des letzten Calls.
 */
import { useEffect, useReducer } from "react";
import type { AiProvider } from "./useApiSettingsStore";

const STORAGE_KEY = "ss-ai-cost:v1";

export interface ProviderCostState {
  /** Yyyy-mm (z.B. "2026-05"). Tracking-Periode-Marker. */
  currentMonth: string;
  /** Akkumulierte input-Tokens diesen Monat. */
  monthInputTokens: number;
  /** Akkumulierte output-Tokens diesen Monat. */
  monthOutputTokens: number;
  /** Optionaler monatlicher Cap (Summe input+output). null = kein Cap. */
  monthlyCapTokens: number | null;
  /** Timestamp des letzten Calls (ISO 8601). */
  lastCallAt: string | null;
  /** Anzahl Calls diesen Monat. */
  monthCallCount: number;
}

export interface AiCostState {
  anthropic: ProviderCostState;
  openai: ProviderCostState;
}

type Listener = () => void;

function currentMonthKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function defaultProviderState(): ProviderCostState {
  return {
    currentMonth: currentMonthKey(),
    monthInputTokens: 0,
    monthOutputTokens: 0,
    monthlyCapTokens: null,
    lastCallAt: null,
    monthCallCount: 0,
  };
}

function defaults(): AiCostState {
  return { anthropic: defaultProviderState(), openai: defaultProviderState() };
}

function load(): AiCostState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<AiCostState>;
    return {
      anthropic: { ...defaultProviderState(), ...(parsed.anthropic ?? {}) },
      openai: { ...defaultProviderState(), ...(parsed.openai ?? {}) },
    };
  } catch {
    return defaults();
  }
}

function persist(state: AiCostState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

let _state: AiCostState = load();
const _listeners = new Set<Listener>();
function notify() { _listeners.forEach((l) => l()); }

/**
 * Rolling-Window-Reset: wenn der `currentMonth` nicht mehr dem aktuellen Monat
 * entspricht, werden die Token-Counters auf 0 gesetzt.
 */
export function maybeRollMonth(provider: AiProvider, now: Date = new Date()): ProviderCostState {
  const cur = _state[provider];
  const nowMonth = currentMonthKey(now);
  if (cur.currentMonth === nowMonth) return cur;
  const rolled: ProviderCostState = {
    ...cur,
    currentMonth: nowMonth,
    monthInputTokens: 0,
    monthOutputTokens: 0,
    monthCallCount: 0,
  };
  _state = { ..._state, [provider]: rolled };
  persist(_state);
  notify();
  return rolled;
}

/**
 * Bucht einen erfolgreichen AI-Call ins Tracking ein.
 * Synchronisiert auch automatisch den Monats-Reset wenn nötig.
 */
export function recordAiCall(provider: AiProvider, inputTokens: number, outputTokens: number): void {
  const rolled = maybeRollMonth(provider);
  const updated: ProviderCostState = {
    ...rolled,
    monthInputTokens: rolled.monthInputTokens + Math.max(0, Math.floor(inputTokens)),
    monthOutputTokens: rolled.monthOutputTokens + Math.max(0, Math.floor(outputTokens)),
    monthCallCount: rolled.monthCallCount + 1,
    lastCallAt: new Date().toISOString(),
  };
  _state = { ..._state, [provider]: updated };
  persist(_state);
  notify();
}

export function setMonthlyCap(provider: AiProvider, capTokens: number | null): void {
  const validated =
    capTokens === null || (typeof capTokens === "number" && Number.isFinite(capTokens) && capTokens >= 0)
      ? capTokens
      : null;
  _state = { ..._state, [provider]: { ..._state[provider], monthlyCapTokens: validated } };
  persist(_state);
  notify();
}

export function resetMonth(provider: AiProvider): void {
  _state = {
    ..._state,
    [provider]: {
      ..._state[provider],
      currentMonth: currentMonthKey(),
      monthInputTokens: 0,
      monthOutputTokens: 0,
      monthCallCount: 0,
    },
  };
  persist(_state);
  notify();
}

/** Total tokens diesen Monat (input + output). Rollt auch den Monat. */
export function getProviderUsage(provider: AiProvider): {
  total: number;
  input: number;
  output: number;
  cap: number | null;
  capExceeded: boolean;
  callCount: number;
} {
  const rolled = maybeRollMonth(provider);
  const total = rolled.monthInputTokens + rolled.monthOutputTokens;
  const cap = rolled.monthlyCapTokens;
  return {
    total,
    input: rolled.monthInputTokens,
    output: rolled.monthOutputTokens,
    cap,
    capExceeded: cap !== null && total >= cap,
    callCount: rolled.monthCallCount,
  };
}

export function getAiCostState(): AiCostState { return _state; }

export function useAiCostStore(): AiCostState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return _state;
}
