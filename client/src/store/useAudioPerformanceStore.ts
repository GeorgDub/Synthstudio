/**
 * Synthstudio – useAudioPerformanceStore (v3.25.0)
 *
 * Live-Performance-Telemetrie: CPU-Approximation der Scheduler-Tick-Dauer,
 * Buffer-Underruns, Audio-Latenz (base/output via AudioContext). KEINE
 * Persistenz — Live-Daten only (Reset bei App-Start, Reset-Button im UI).
 *
 * Wichtig: Web Audio gibt KEINEN direkten CPU-%-Access. Wir approximieren
 * via JS-Scheduler-Callback-Dauer (Performance.now() vor/nach _schedule()).
 * Das ist nicht der echte Audio-Thread-CPU-Verbrauch, aber ein guter
 * Indikator für JS-Side-Glitches (wenn die Scheduler-Iteration > SCHEDULE
 * _INTERVAL braucht, droppen Steps).
 *
 * CPU% = (callback-ms / schedule-interval-ms) × 100  (geclampt 0..100)
 *
 * Sampling:
 *   - AudioEngine ruft recordScheduleTick(ms) bei jedem _schedule()-Aufruf.
 *   - Store hält gleitenden Average (EWMA, alpha=0.2 → "smooth").
 *   - UI rerendert via Hook nur wenn sich der gerundete CPU%-Wert ändert
 *     (verhindert 60Hz-Re-Renders bei minimalen Schwankungen).
 *
 * Warning-Throttle:
 *   - max 1 Warning pro Type pro Minute → simple Map<type, lastFiredAt>.
 */
import { useEffect, useReducer } from "react";

export interface AudioPerformanceState {
  /** Geschätzte CPU-Auslastung der Scheduler-Iteration in %, gleitender Mittelwert. */
  cpuPercent: number;
  /** Letzter (sofortiger) Callback-Tick in ms. */
  audioCallbackMs: number;
  /** Anzahl detektierter Buffer-Underruns (Callback > 2× Schedule-Interval). */
  bufferUnderruns: number;
  /** AudioContext.outputLatency in ms. */
  outputLatencyMs: number;
  /** AudioContext.baseLatency in ms. */
  baseLatencyMs: number;
  /** Glitch-Counter: wieviele aufeinander folgende Sekunden lag CPU > 90 %. */
  glitchEvents: number;
}

const _initial: AudioPerformanceState = {
  cpuPercent: 0,
  audioCallbackMs: 0,
  bufferUnderruns: 0,
  outputLatencyMs: 0,
  baseLatencyMs: 0,
  glitchEvents: 0,
};

let _state: AudioPerformanceState = { ..._initial };
const _listeners = new Set<() => void>();

// EWMA-Faktor für CPU%-Glättung. Kleiner = ruhiger, träger.
const EWMA_ALPHA = 0.2;
// Scheduler-Interval (ms) wird via setSchedulerInterval konfiguriert
let _schedulerIntervalMs = 16;
// Underrun-Schwelle: Callback länger als FAKTOR × intervalMs.
const UNDERRUN_FACTOR = 2;
// CPU-%-Schwelle ab der glitchEvents incrementiert wird.
const GLITCH_CPU_THRESHOLD = 90;

function _notify(): void {
  _listeners.forEach((fn) => fn());
}

/**
 * Setzt das Scheduler-Intervall in ms (AudioEngine teilt das mit init mit).
 * Defensive vs. <=0 oder NaN.
 */
export function setSchedulerInterval(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  _schedulerIntervalMs = ms;
}

export function getSchedulerInterval(): number {
  return _schedulerIntervalMs;
}

/**
 * Wird von AudioEngine pro _schedule()-Tick aufgerufen.
 * msTaken = Performance.now()-Differenz vor/nach _schedule().
 *
 * Updates:
 *   - audioCallbackMs (Last-Wert)
 *   - cpuPercent (EWMA)
 *   - bufferUnderruns (wenn msTaken > UNDERRUN_FACTOR × intervalMs)
 *   - glitchEvents (wenn EWMA > 90)
 *
 * Defensive vs. NaN/Infinity. Diff-vor-Notify (nur rerender bei
 * gerundeter CPU%-Änderung ODER Counter-Inkrement).
 */
export function recordScheduleTick(msTaken: number): void {
  if (!Number.isFinite(msTaken) || msTaken < 0) return;
  const before = _state;
  const instantPct = Math.min(
    100,
    Math.max(0, (msTaken / _schedulerIntervalMs) * 100),
  );
  const newCpu = before.cpuPercent === 0
    ? instantPct
    : before.cpuPercent * (1 - EWMA_ALPHA) + instantPct * EWMA_ALPHA;
  const isUnderrun = msTaken > UNDERRUN_FACTOR * _schedulerIntervalMs;
  const newUnderruns = before.bufferUnderruns + (isUnderrun ? 1 : 0);
  const isGlitch = newCpu > GLITCH_CPU_THRESHOLD;
  const newGlitch = before.glitchEvents + (isGlitch ? 1 : 0);

  // Diff-Check: nur ändern wenn sich was Sichtbares ändert (gerundete %)
  const prevRounded = Math.round(before.cpuPercent);
  const newRounded = Math.round(newCpu);
  const changed =
    prevRounded !== newRounded ||
    Math.round(before.audioCallbackMs * 10) !== Math.round(msTaken * 10) ||
    newUnderruns !== before.bufferUnderruns ||
    newGlitch !== before.glitchEvents;

  _state = {
    ...before,
    cpuPercent: newCpu,
    audioCallbackMs: msTaken,
    bufferUnderruns: newUnderruns,
    glitchEvents: newGlitch,
  };
  if (changed) _notify();
}

/**
 * Wird periodisch (z.B. alle 500ms) aufgerufen um AudioContext-Latency-
 * Felder einzusammeln. Wenn ctx null/undefined → No-Op (Defaults bleiben).
 */
export function updateContextLatency(
  baseLatencyMs: number,
  outputLatencyMs: number,
): void {
  if (!Number.isFinite(baseLatencyMs) || !Number.isFinite(outputLatencyMs)) return;
  const clampedBase = Math.max(0, baseLatencyMs);
  const clampedOut = Math.max(0, outputLatencyMs);
  if (
    _state.baseLatencyMs === clampedBase &&
    _state.outputLatencyMs === clampedOut
  ) return;
  _state = { ..._state, baseLatencyMs: clampedBase, outputLatencyMs: clampedOut };
  _notify();
}

/** Setzt alle Counter (Underrun, Glitch) zurück — UI-Reset-Button. */
export function resetPerformanceCounters(): void {
  if (_state.bufferUnderruns === 0 && _state.glitchEvents === 0) return;
  _state = { ..._state, bufferUnderruns: 0, glitchEvents: 0 };
  _notify();
}

export function getPerformanceState(): AudioPerformanceState {
  return _state;
}

/** Liefert true wenn CPU% in "kritisch" Range. */
export function isPerformanceCritical(): boolean {
  return _state.cpuPercent > GLITCH_CPU_THRESHOLD;
}

/** Liefert "ok" | "warn" | "critical" für UI-Color-Coding. */
export function getPerformanceStatus(
  state: AudioPerformanceState = _state,
): "ok" | "warn" | "critical" {
  if (state.cpuPercent >= GLITCH_CPU_THRESHOLD) return "critical";
  if (state.cpuPercent >= 70) return "warn";
  return "ok";
}

// ─── Warning-Throttle ───────────────────────────────────────────────────────

const _warningCooldownMs = 60_000; // 1 Warning pro Type pro Minute
const _lastWarningAt = new Map<string, number>();

/**
 * Liefert true wenn ein Warning des angegebenen Types ausgelöst werden DARF
 * (Cooldown abgelaufen ist). Markiert den Type sofort als "jetzt geworfen".
 * Pure-Helper (kein DOM, kein Toast — Caller dispatcht).
 */
export function shouldFireWarning(type: string, nowMs: number = Date.now()): boolean {
  const last = _lastWarningAt.get(type);
  if (last !== undefined && nowMs - last < _warningCooldownMs) return false;
  _lastWarningAt.set(type, nowMs);
  return true;
}

/** Test-Hook: setzt Warning-Throttle zurück. */
export function __resetWarningThrottleForTests(): void {
  _lastWarningAt.clear();
}

/** React-Hook: liefert aktuellen State + rerendert bei Änderung. */
export function useAudioPerformance(): AudioPerformanceState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return _state;
}

/** Test-Hook: kompletter Store-Reset. */
export function __resetPerformanceStoreForTests(): void {
  _state = { ..._initial };
  _schedulerIntervalMs = 16;
  _lastWarningAt.clear();
  _notify();
}
