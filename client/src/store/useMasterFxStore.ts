/**
 * Synthstudio – useMasterFxStore.ts (v3.75.0)
 *
 * Master-FX-Bus State: User-Control über die globalen Reverb/Delay/EQ-Busse.
 * Closes v3.74-Caveat: bis v3.74 war der `_globalReverbBus` (Plate-Reverb,
 * fix decay=2s) und der `_globalDelayBus` (delayTime=0.5s, feedback=0.35) im
 * AudioEngine.init() hart codiert — kein User-Control über Decay, Damping,
 * Pre-Delay, Delay-Time, Feedback. Kein Master-EQ. Send-Amount pro Channel
 * lebte bereits im useMixerStore (channels[id].sends.reverb / .delay), die
 * Master-Bus-Parameter aber waren nicht persistiert.
 *
 * Architektur:
 *  - Custom Observer-Pattern (analog useThemeStore + Co), KEIN zustand-npm.
 *  - localStorage-Persist unter `synthstudio:master-fx:v1`.
 *  - Zusätzlich Snapshot-Round-Trip im .synth-Projektformat (Schema v1.30).
 *  - Audio-Wiring (Reverb-IR, Delay-Time/-Feedback, EQ-Bands) übernimmt
 *    AudioEngine. Diese Store-Datei selbst hat KEINE Audio-Side-Effects —
 *    Komponenten (MasterFxPanel) rufen explizit AudioEngine.setMaster*().
 *
 * Backward-Compat:
 *  - Default-Werte spiegeln die alten hart codierten v2.94/v3.74-Werte wider:
 *    Reverb decay=2.0s, damping=0.5, preDelay=0ms, wet=0.6, bypass=false.
 *    Delay  time=0.5s, feedback=0.35, wet=0.5, bypass=false.
 *    EQ     low/mid/high=0dB, lowFreq=250Hz, highFreq=4000Hz, bypass=false.
 *  - Pre-v3.75 hat keine Persistenz → defaults werden geladen.
 *  - parseProject (v1.30) toleriert fehlendes `masterFx`-Feld (→ defaults).
 */
import { useEffect, useReducer } from "react";

// ─── Typen ───────────────────────────────────────────────────────────────────

export interface MasterReverbState {
  /** Decay in Sekunden (0.1..10). Steuert die IR-Länge. */
  decay: number;
  /** Damping 0..1 — Lowpass-Cutoff am Reverb-Bus (0=sehr dark, 1=offen). */
  damping: number;
  /** Pre-Delay in ms (0..200). DelayNode vor dem Convolver. */
  preDelay: number;
  /** Wet-Level 0..1 — Reverb-Bus → Master. */
  wet: number;
  /** Bypass-Toggle (true = Reverb-Send hat keinen Effekt). */
  bypass: boolean;
}

export interface MasterDelayState {
  /** Delay-Zeit in Sekunden (0.001..2.0). */
  time: number;
  /** Feedback 0..0.95 (Engine clampt auf 0.95 als Stabilitätsgrenze). */
  feedback: number;
  /** Wet-Level 0..1 — Delay-Bus → Master. */
  wet: number;
  /** Bypass-Toggle. */
  bypass: boolean;
}

export interface MasterEqState {
  /** Low-Shelf Gain in dB (-24..+24). */
  lowGain: number;
  /** Peak Mid Gain in dB (-24..+24). */
  midGain: number;
  /** High-Shelf Gain in dB (-24..+24). */
  highGain: number;
  /** Low-Shelf Frequenz in Hz (20..1000). */
  lowFreq: number;
  /** High-Shelf Frequenz in Hz (1000..20000). */
  highFreq: number;
  /** Bypass-Toggle — alle 3 Bands auf 0dB intern. */
  bypass: boolean;
}

export interface MasterFxState {
  reverb: MasterReverbState;
  delay:  MasterDelayState;
  eq:     MasterEqState;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "synthstudio:master-fx:v1";

export const DEFAULT_MASTER_REVERB: MasterReverbState = {
  decay:    2.0,
  damping:  0.5,
  preDelay: 0,
  wet:      0.6,
  bypass:   false,
};

export const DEFAULT_MASTER_DELAY: MasterDelayState = {
  time:     0.5,
  feedback: 0.35,
  wet:      0.5,
  bypass:   false,
};

export const DEFAULT_MASTER_EQ: MasterEqState = {
  lowGain:  0,
  midGain:  0,
  highGain: 0,
  lowFreq:  250,
  highFreq: 4000,
  bypass:   false,
};

export function defaultMasterFxState(): MasterFxState {
  return {
    reverb: { ...DEFAULT_MASTER_REVERB },
    delay:  { ...DEFAULT_MASTER_DELAY },
    eq:     { ...DEFAULT_MASTER_EQ },
  };
}

// ─── Clamping (defensiv) ─────────────────────────────────────────────────────

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function clampBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function clampReverb(input: Partial<MasterReverbState> | undefined): MasterReverbState {
  const d = DEFAULT_MASTER_REVERB;
  const i = input ?? {};
  return {
    decay:    clampNum(i.decay,    0.1,    10,   d.decay),
    damping:  clampNum(i.damping,  0,      1,    d.damping),
    preDelay: clampNum(i.preDelay, 0,      200,  d.preDelay),
    wet:      clampNum(i.wet,      0,      1,    d.wet),
    bypass:   clampBool(i.bypass, d.bypass),
  };
}

export function clampDelay(input: Partial<MasterDelayState> | undefined): MasterDelayState {
  const d = DEFAULT_MASTER_DELAY;
  const i = input ?? {};
  return {
    time:     clampNum(i.time,     0.001,  2.0,  d.time),
    feedback: clampNum(i.feedback, 0,      0.95, d.feedback),
    wet:      clampNum(i.wet,      0,      1,    d.wet),
    bypass:   clampBool(i.bypass, d.bypass),
  };
}

export function clampEq(input: Partial<MasterEqState> | undefined): MasterEqState {
  const d = DEFAULT_MASTER_EQ;
  const i = input ?? {};
  return {
    lowGain:  clampNum(i.lowGain,  -24,   24,    d.lowGain),
    midGain:  clampNum(i.midGain,  -24,   24,    d.midGain),
    highGain: clampNum(i.highGain, -24,   24,    d.highGain),
    lowFreq:  clampNum(i.lowFreq,  20,    1000,  d.lowFreq),
    highFreq: clampNum(i.highFreq, 1000,  20000, d.highFreq),
    bypass:   clampBool(i.bypass, d.bypass),
  };
}

export function sanitizeMasterFx(raw: unknown): MasterFxState {
  if (!raw || typeof raw !== "object") return defaultMasterFxState();
  const r = raw as Partial<MasterFxState>;
  return {
    reverb: clampReverb(r.reverb),
    delay:  clampDelay(r.delay),
    eq:     clampEq(r.eq),
  };
}

// ─── Persist ─────────────────────────────────────────────────────────────────

function loadState(): MasterFxState {
  if (typeof window === "undefined") return defaultMasterFxState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMasterFxState();
    return sanitizeMasterFx(JSON.parse(raw));
  } catch {
    return defaultMasterFxState();
  }
}

function persist(state: MasterFxState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Quota / Private-Mode → swallow */
  }
}

// ─── Module-Singleton State + Listener Set ───────────────────────────────────

type Listener = () => void;

let _state: MasterFxState = loadState();
const _listeners = new Set<Listener>();

function notify(): void {
  for (const l of _listeners) {
    try { l(); } catch { /* swallow */ }
  }
}

function commit(next: MasterFxState): void {
  _state = next;
  persist(_state);
  notify();
}

// ─── Public Getters (DOM-frei, testbar) ──────────────────────────────────────

export function getMasterFxState(): MasterFxState {
  return _state;
}

export function getMasterReverb(): MasterReverbState { return _state.reverb; }
export function getMasterDelay():  MasterDelayState  { return _state.delay;  }
export function getMasterEq():     MasterEqState     { return _state.eq;     }

// ─── Public Setters (atomar pro Param) ───────────────────────────────────────

export function setMasterReverb(update: Partial<MasterReverbState>): void {
  commit({ ..._state, reverb: clampReverb({ ..._state.reverb, ...update }) });
}

export function setMasterDelay(update: Partial<MasterDelayState>): void {
  commit({ ..._state, delay: clampDelay({ ..._state.delay, ...update }) });
}

export function setMasterEq(update: Partial<MasterEqState>): void {
  commit({ ..._state, eq: clampEq({ ..._state.eq, ...update }) });
}

/**
 * Bulk-Set (Project-Restore-Path). Wenn `input` undefined ist, bleibt der
 * State unverändert — Signal "Pre-v1.30-File, User-localStorage nicht
 * überschreiben". Explicit `null` oder `{}` → defaults.
 */
export function setAllMasterFx(input: unknown): void {
  if (input === undefined) return;
  commit(sanitizeMasterFx(input));
}

/** Komplett-Reset auf Defaults. */
export function resetMasterFx(): void {
  commit(defaultMasterFxState());
}

/** Test-Helper: setzt Modul-State + localStorage zurück (nicht in der App benutzen). */
export function __resetMasterFxStoreForTests(): void {
  _state = defaultMasterFxState();
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* swallow */ }
  }
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function useMasterFxStore(): MasterFxState {
  const [, forceRender] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    _listeners.add(forceRender);
    return () => { _listeners.delete(forceRender); };
  }, []);
  return _state;
}

// ─── Type-Guard für Project-Restore-Pfad ─────────────────────────────────────

export function isValidMasterFxSnapshot(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Partial<MasterFxState>;
  // sehr lax — primary Guard ist sanitizeMasterFx, das defaults bei jedem
  // fehlenden Feld einsetzt. Diese Funktion hilft parseProject ein
  // explizites `masterFx: null` vs. `masterFx: {}` zu unterscheiden.
  return !!(r.reverb || r.delay || r.eq);
}
