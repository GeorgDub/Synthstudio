/**
 * Synthstudio – useWelcomeStore (v3.22.0)
 *
 * First-Run-Detection für den Welcome-Wizard. Persistiert in localStorage
 * unter dem Key "synthstudio:welcome:v1".
 *
 *   - firstRun:  true wenn der User Synthstudio noch nie geöffnet hat.
 *                Wird beim ersten markFirstRunComplete()-Aufruf auf false
 *                gesetzt (das passiert wenn der Wizard das erste Mal
 *                geöffnet ODER geschlossen wurde).
 *   - dismissed: true wenn der User explizit "Don't show again" geklickt
 *                hat. Solange dismissed=false, kann der Wizard manuell
 *                aus den Settings wieder geöffnet werden.
 *
 * Custom Observer-Pattern (NICHT Zustand-npm) — analog zu useToastStore /
 * useSceneStore. Reine Pure-Helpers, isomorph (kein DOM).
 */
import { useEffect, useReducer } from "react";

const STORAGE_KEY = "synthstudio:welcome:v1";
const STORAGE_VERSION = 1;

export interface WelcomeState {
  /** True, solange der User die App noch nie aufgemacht hat (oder localStorage geleert wurde). */
  firstRun: boolean;
  /** True wenn der User "Don't show again" abgewählt hat. */
  dismissed: boolean;
}

interface PersistedShape {
  v: number;
  firstRun: boolean;
  dismissed: boolean;
}

function defaultState(): WelcomeState {
  return { firstRun: true, dismissed: false };
}

function loadState(): WelcomeState {
  if (typeof localStorage === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    if (!parsed || typeof parsed !== "object") return defaultState();
    return {
      firstRun: typeof parsed.firstRun === "boolean" ? parsed.firstRun : true,
      dismissed: typeof parsed.dismissed === "boolean" ? parsed.dismissed : false,
    };
  } catch {
    return defaultState();
  }
}

function saveState(s: WelcomeState): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: PersistedShape = {
      v: STORAGE_VERSION,
      firstRun: s.firstRun,
      dismissed: s.dismissed,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private-mode → ignore, in-memory only */
  }
}

let _state: WelcomeState = loadState();
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach((fn) => fn());
}

/** Read-only state snapshot — getter für Tests + non-React-Code. */
export function getWelcomeState(): WelcomeState {
  return _state;
}

/** Soll der Wizard beim App-Mount automatisch erscheinen? */
export function shouldAutoShowWelcome(): boolean {
  return _state.firstRun && !_state.dismissed;
}

/**
 * Markiert den ersten Run als abgeschlossen (firstRun → false). Wird vom
 * Wizard sowohl beim "Got it!"-Click als auch beim "Skip" / Close-Klick
 * gerufen, damit der Wizard nicht zweimal beim Start aufploppt.
 */
export function markFirstRunComplete(): void {
  if (!_state.firstRun) return;
  _state = { ..._state, firstRun: false };
  saveState(_state);
  notify();
}

/**
 * "Don't show again" — setzt dismissed=true UND firstRun=false. Wizard
 * erscheint danach nur noch über den manuellen Trigger aus den Settings.
 */
export function dismissWelcomeWizard(): void {
  if (_state.dismissed && !_state.firstRun) return;
  _state = { firstRun: false, dismissed: true };
  saveState(_state);
  notify();
}

/**
 * Reset für Tests UND für den (zukünftigen) Settings-Button
 * "Welcome-Tour erneut anzeigen". Setzt firstRun=true + dismissed=false.
 */
export function resetWelcomeWizard(): void {
  _state = { firstRun: true, dismissed: false };
  saveState(_state);
  notify();
}

/** Test-Only: löscht State + Listener komplett. */
export function __resetWelcomeStoreForTests(): void {
  _listeners.clear();
  _state = defaultState();
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** React-Hook — rerendert bei jedem state-change. */
export function useWelcomeStore(): WelcomeState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return _state;
}

// ─── Try-it-now CustomEvent-Helpers ─────────────────────────────────────────
//
// Pro Slide gibt es einen "Try it now"-Button, der einen CustomEvent auf
// window dispatched. App.tsx listened darauf und führt die jeweilige
// Aktion aus (Tab-Switch / Settings-Open / etc.). Pattern analog zu
// "korg:bank:open" (siehe dragDropDispatch.ts).

export const WELCOME_EVENT_NAME = "synthstudio:welcome:try-it";

export type WelcomeTryItTarget =
  | "midi-settings"      // → Settings → omnitribe / midi-devices
  | "korg-bank-editor"   // → DrumMachine → KORG Editor öffnen
  | "scene-launch"       // → Sequencer-Tab + Scene-Pad-Fokus
  | "looper"             // → Sequencer-Tab + Looper sichtbar
  | "sample-slicer"      // → Tools-Tab → Sample-Slicer
  | "settings"           // → Settings-Modal öffnen (Default-Section)
  | "templates"          // → MIDI-Hardware-Templates anzeigen
  | "korg-templates";    // v3.49.0 → KORG-Project-Templates-Picker öffnen

export interface WelcomeTryItDetail {
  target: WelcomeTryItTarget;
}

/** Pure-Helper für Tests — gibt das CustomEvent-Detail zurück. */
export function buildWelcomeTryItDetail(target: WelcomeTryItTarget): WelcomeTryItDetail {
  return { target };
}

/**
 * Dispatched einen window-CustomEvent, den App.tsx abhört.
 * NO-OP wenn kein window (SSR / Node-Tests ohne jsdom).
 */
export function dispatchWelcomeTryIt(target: WelcomeTryItTarget): void {
  if (typeof window === "undefined") return;
  try {
    const evt = new CustomEvent<WelcomeTryItDetail>(WELCOME_EVENT_NAME, {
      detail: buildWelcomeTryItDetail(target),
    });
    window.dispatchEvent(evt);
  } catch {
    /* CustomEvent unsupported in some test envs → ignore */
  }
}
