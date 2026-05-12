/**
 * Synthstudio – macroHoldLoop
 *
 * Reine Logik für den Hold-Mode der Macro-Buttons (TASK-118 / v1.22.0).
 *
 * Verwaltung mehrerer parallel laufender Hold-Loops (eine pro Macro-Index)
 * mit Garantie:
 *   - Pro Macro-Index nur EINE Loop-Iteration parallel (kein Stacking).
 *   - Erste Iteration läuft sofort, Folge-Iterationen alle `intervalMs`.
 *   - Stop via `stop(macroIndex)` oder `stopAll()`.
 *
 * Architektur:
 *  - Module-Scope-Map _holdState: Map<macroIndex → { intervalId, run, active }>
 *  - Loop-Timer wird mit injizierbaren scheduler-Funktionen abgewickelt
 *    (default: globalThis.setInterval/clearInterval), damit Tests mit
 *    `vi.useFakeTimers()` arbeiten können oder einen eigenen Scheduler injizieren.
 *  - Die `run`-Funktion ist eine pure Aktion (Script-Run oder Pad-Trigger),
 *    die der Caller (App.tsx) bereitstellt — ohne Wissen über deren Inhalt.
 *
 * Isomorphes Design: setInterval/clearInterval gibt es sowohl im Browser
 * als auch in Electron. Keine Web-API-Abhängigkeiten außer Timer.
 */

export type RunFn = () => void;

export interface HoldLoopScheduler {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

interface HoldLoopState {
  /** Scheduler-Handle (typabhängig: Browser=number, Node=Timeout). */
  intervalHandle: unknown;
  /** Aktive Run-Funktion — referenziert, damit Tests sie zählen können. */
  run: RunFn;
  /** Markiert ob Loop noch aktiv ist (true bis stop()). */
  active: boolean;
}

const _holdState = new Map<number, HoldLoopState>();

/** Default-Scheduler: globalThis.setInterval/clearInterval. */
function defaultScheduler(): HoldLoopScheduler {
  return {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
  };
}

/**
 * Startet eine Hold-Loop für einen Macro-Index.
 *
 * Verhalten:
 *  - Wenn bereits eine Loop für diesen Index aktiv ist, wird sie zuerst gestoppt
 *    (kein Stacking; verhindert doppelte Trigger bei Mehrfach-mouseDown).
 *  - Die `run`-Funktion wird SOFORT einmal aufgerufen (erste Iteration).
 *  - Danach alle `intervalMs` Millisekunden, bis stop(macroIndex) gerufen wird.
 *
 * @param macroIndex - Eindeutige Loop-Kennung (0..MACRO_COUNT-1).
 * @param run - Auszuführende Aktion pro Iteration.
 * @param intervalMs - Pause zwischen Iterationen (Script: 200ms, Pad: 100ms üblich).
 * @param scheduler - Optional injizierbarer Scheduler (für Tests).
 */
export function startHoldLoop(
  macroIndex: number,
  run: RunFn,
  intervalMs: number,
  scheduler: HoldLoopScheduler = defaultScheduler(),
): void {
  // No-Stacking: wenn bereits aktiv, alten Loop stoppen
  stopHoldLoop(macroIndex, scheduler);

  // Erste Iteration sofort
  try {
    run();
  } catch {
    // Wenn die Aktion wirft: Loop trotzdem starten, damit Folgeiterationen
    // erneut versuchen. App.tsx kann selbst entscheiden, ob es loggt.
  }

  const handle = scheduler.setInterval(() => {
    const state = _holdState.get(macroIndex);
    if (!state || !state.active) return;
    try {
      state.run();
    } catch {
      // siehe oben — Loop läuft weiter
    }
  }, intervalMs);

  _holdState.set(macroIndex, {
    intervalHandle: handle,
    run,
    active: true,
  });
}

/**
 * Stoppt eine laufende Hold-Loop. No-op wenn keine Loop für diesen Index aktiv.
 *
 * @param macroIndex - Index dessen Loop gestoppt wird.
 * @param scheduler - Optional (sollte derselbe sein, mit dem gestartet wurde).
 */
export function stopHoldLoop(
  macroIndex: number,
  scheduler: HoldLoopScheduler = defaultScheduler(),
): void {
  const state = _holdState.get(macroIndex);
  if (!state) return;
  state.active = false;
  scheduler.clearInterval(state.intervalHandle);
  _holdState.delete(macroIndex);
}

/**
 * Stoppt ALLE laufenden Hold-Loops. Nützlich beim Tab-Wechsel,
 * Component-Unmount oder Test-Cleanup.
 */
export function stopAllHoldLoops(scheduler: HoldLoopScheduler = defaultScheduler()): void {
  for (const [idx] of Array.from(_holdState.entries())) {
    stopHoldLoop(idx, scheduler);
  }
}

/** Liefert true wenn aktuell eine Hold-Loop für diesen Index läuft. */
export function isHoldLoopActive(macroIndex: number): boolean {
  return _holdState.get(macroIndex)?.active === true;
}

/** Anzahl aktuell aktiver Hold-Loops (für Tests/Debugging). */
export function getActiveHoldLoopCount(): number {
  return _holdState.size;
}

/**
 * Standard-Intervalle (kommerzielle Drum-Machines wie MPC nutzen ähnliche Werte):
 *  - SCRIPT_INTERVAL_MS: 200ms — JS-Skripte haben Overhead durch Sandbox-Start
 *  - PAD_INTERVAL_MS:    100ms — Pad-Queue ist günstig (nur State-Update)
 */
export const SCRIPT_HOLD_INTERVAL_MS = 200;
export const PAD_HOLD_INTERVAL_MS = 100;
