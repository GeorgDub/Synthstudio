/**
 * Synthstudio – useLfoModStore (TASK-257, Modulations-/LFO-Routing v1)
 *
 * Routbares LFO→Ziel-System. Zwei Sammlungen:
 *   - lfos[]:   LFO-Quellen (Waveform, Rate Hz, Phase, Depth)
 *   - routes[]: Verknüpfungen { lfoId → ParamTarget, amount }
 *
 * Custom-Observer-Pattern (KEIN Zustand-npm), localStorage-Persistenz —
 * analog useEnvelopeFollowerStore. Die Engine-Anbindung (rAF-Seam in App.tsx)
 * liest getLfos()/getModRoutes() pro Frame und wendet die Modulation auf
 * die Ziel-Params an (volume/pan/filterFreq/reverbMix/delayMix).
 *
 * Persistenz für v1 bewusst nur über diesen localStorage-Store (kein
 * .synth-Schema-Bump), analog useMidiNoteOutStore.
 */
import { useEffect, useReducer } from "react";
import type { LfoWaveform } from "@/utils/lfo";

const STORAGE_KEY = "ss-lfo-mod:v1";

/** Ziel-Parameter einer Mod-Route. Jeder hat einen direkten Engine-Setter. */
export type ModTargetParam =
  | "volume"
  | "pan"
  | "filterFreq"
  | "reverbMix"
  | "delayMix";

export interface LfoConfig {
  id: string;
  /** Anzeigename (UI). */
  name: string;
  enabled: boolean;
  waveform: LfoWaveform;
  /** Frequenz in Hz (frei laufend nach Wall-Clock). */
  rateHz: number;
  /** Phasen-Offset 0..1. */
  phase: number;
  /** Modulationstiefe 0..1 (globaler Master-Scaler dieser LFO). */
  depth: number;
}

export interface ModRoute {
  id: string;
  enabled: boolean;
  /** Verweist auf LfoConfig.id. */
  lfoId: string;
  /** Ziel-Part (Mixer-Channel / Drum-Part). */
  targetPartId: string;
  targetPartName: string;
  /** Zu modulierender Parameter. */
  param: ModTargetParam;
  /** Routing-Stärke -1..+1 (bipolar, invertierbar). */
  amount: number;
}

export interface LfoModState {
  lfos: LfoConfig[];
  routes: ModRoute[];
}

type Listener = () => void;

function makeLfoId() {
  return `lfo-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}
function makeRouteId() {
  return `mr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

function load(): LfoModState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LfoModState>;
      return {
        lfos: Array.isArray(parsed.lfos) ? parsed.lfos : [],
        routes: Array.isArray(parsed.routes) ? parsed.routes : [],
      };
    }
  } catch {
    /* ignore */
  }
  return { lfos: [], routes: [] };
}

function persist(s: LfoModState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

let _state: LfoModState = load();
const _listeners = new Set<Listener>();
function notify() {
  _listeners.forEach((l) => l());
}

// ─── LFO-Quellen ──────────────────────────────────────────────────────────────

export function addLfo(config: Omit<LfoConfig, "id">): string {
  const id = makeLfoId();
  _state = { ..._state, lfos: [..._state.lfos, { ...config, id }] };
  persist(_state);
  notify();
  return id;
}

export function removeLfo(id: string): void {
  // Verwaiste Routes (die auf diese LFO zeigen) mit entfernen.
  _state = {
    lfos: _state.lfos.filter((l) => l.id !== id),
    routes: _state.routes.filter((r) => r.lfoId !== id),
  };
  persist(_state);
  notify();
}

export function updateLfo(
  id: string,
  changes: Partial<Omit<LfoConfig, "id">>,
): void {
  _state = {
    ..._state,
    lfos: _state.lfos.map((l) => (l.id === id ? { ...l, ...changes } : l)),
  };
  persist(_state);
  notify();
}

export function getLfos(): LfoConfig[] {
  return _state.lfos;
}

export function getLfoById(id: string): LfoConfig | undefined {
  return _state.lfos.find((l) => l.id === id);
}

// ─── Mod-Routes ─────────────────────────────────────────────────────────────

export function addModRoute(route: Omit<ModRoute, "id">): string {
  const id = makeRouteId();
  _state = { ..._state, routes: [..._state.routes, { ...route, id }] };
  persist(_state);
  notify();
  return id;
}

export function removeModRoute(id: string): void {
  _state = { ..._state, routes: _state.routes.filter((r) => r.id !== id) };
  persist(_state);
  notify();
}

export function updateModRoute(
  id: string,
  changes: Partial<Omit<ModRoute, "id">>,
): void {
  _state = {
    ..._state,
    routes: _state.routes.map((r) => (r.id === id ? { ...r, ...changes } : r)),
  };
  persist(_state);
  notify();
}

export function getModRoutes(): ModRoute[] {
  return _state.routes;
}

/** Liefert nur Routes, deren Route UND zugehörige LFO aktiviert sind. */
export function getActiveModRoutes(): Array<{ route: ModRoute; lfo: LfoConfig }> {
  const out: Array<{ route: ModRoute; lfo: LfoConfig }> = [];
  for (const route of _state.routes) {
    if (!route.enabled) continue;
    const lfo = _state.lfos.find((l) => l.id === route.lfoId);
    if (!lfo || !lfo.enabled) continue;
    out.push({ route, lfo });
  }
  return out;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLfoModStore(): LfoModState {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return _state;
}

/** Nur für Tests: harter Reset des Modul-Singletons. */
export function __resetLfoModStoreForTests(): void {
  _state = { lfos: [], routes: [] };
  persist(_state);
  notify();
}
