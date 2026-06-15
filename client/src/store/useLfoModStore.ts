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
import { type EnvConfig, defaultEnvConfig } from "@/utils/modSource";

const STORAGE_KEY = "ss-lfo-mod:v1";

/** Ziel-Parameter einer Mod-Route. Jeder hat einen direkten Engine-Setter. */
export type ModTargetParam =
  | "volume"
  | "pan"
  | "filterFreq"
  | "reverbMix"
  | "delayMix";

/**
 * Modulationsquelle einer Route (TASK-257-FOLLOWUP-3).
 *  - "lfo"   → frei laufender LFO (LfoConfig via route.lfoId). DEFAULT.
 *  - "macro" → aktueller Wert eines Macro-Knobs (route.macroIndex, 0..7).
 *  - "env"   → zyklische Hüllkurve (route.env, frei laufend nach Wall-Clock).
 *
 * Optionales Feld auf ModRoute mit Default "lfo" für Abwärtskompatibilität:
 * persisted Routes ohne `source` (TASK-257 v1) werden beim Load als "lfo"
 * migriert (siehe migrateRoute).
 */
export type ModSource = "lfo" | "macro" | "env";

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
  /**
   * Modulationsquelle. Optional für Abwärtskompatibilität — fehlt das Feld
   * (alte persisted Routes), wird beim Load "lfo" gesetzt (migrateRoute).
   */
  source?: ModSource;
  /** Verweist auf LfoConfig.id (nur relevant wenn source === "lfo"). */
  lfoId: string;
  /** Macro-Index 0..7 (nur relevant wenn source === "macro"). */
  macroIndex?: number;
  /** Hüllkurven-Parameter (nur relevant wenn source === "env"). */
  env?: EnvConfig;
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

/**
 * Effektive Quelle einer Route. Alte Routes ohne `source`-Feld (TASK-257 v1)
 * gelten als "lfo". Defensiv: invalide Strings → "lfo".
 */
export function routeSource(route: ModRoute): ModSource {
  const s = route.source;
  return s === "macro" || s === "env" ? s : "lfo";
}

/**
 * Wählt einen gültigen `lfoId` beim (Zurück-)Wechsel einer Route auf
 * source==="lfo" (TASK-271, Task B).
 *
 * Problem (Round-Trip-Edge): Routes, die ohne verfügbaren LFO erstellt wurden
 * (LfoModPanel addModRoute → `lfoId: lfo?.id ?? ""`), oder deren referenzierter
 * LFO inzwischen entfernt wurde, tragen einen leeren/verwaisten `lfoId`. Wechselt
 * man eine macro/env-Route zurück auf "lfo", wäre die Quelle ohne erneute manuelle
 * LFO-Auswahl inaktiv (getActiveModRoutes verwirft sie).
 *
 * Verhalten:
 *  - Ist der aktuelle `currentLfoId` weiterhin ein existierender LFO → unverändert
 *    bewahren (kein Verlust der ursprünglichen Auswahl beim Hin-/Her-Wechseln).
 *  - Sonst (leer / verwaist) → ersten verfügbaren LFO als definierten Default.
 *  - Gibt es gar keinen LFO → `""` (UI zeigt leere Auswahl; konsistent mit v1).
 *
 * Rein/deterministisch → testbar ohne Browser.
 */
export function resolveLfoIdForSwitch(
  currentLfoId: string | undefined,
  lfos: LfoConfig[],
): string {
  if (currentLfoId && lfos.some((l) => l.id === currentLfoId)) {
    return currentLfoId;
  }
  return lfos.length > 0 ? lfos[0].id : "";
}

/**
 * Migriert eine persisted Route aus TASK-257 v1 (kein `source`/`macroIndex`/
 * `env`) auf das erweiterte Modell (TASK-257-FOLLOWUP-3). Normalisiert das
 * `source`-Feld defensiv und setzt sinnvolle Sub-Felder, sodass die Engine
 * jede Route konsistent auswerten kann. Bewahrt die übrigen Felder verbatim.
 */
function migrateRoute(raw: ModRoute): ModRoute {
  const source: ModSource =
    raw.source === "macro" || raw.source === "env" ? raw.source : "lfo";
  const macroIndex =
    typeof raw.macroIndex === "number" &&
    Number.isInteger(raw.macroIndex) &&
    raw.macroIndex >= 0 &&
    raw.macroIndex < 8
      ? raw.macroIndex
      : source === "macro"
        ? 0
        : raw.macroIndex;
  const env =
    raw.env && typeof raw.env === "object"
      ? raw.env
      : source === "env"
        ? defaultEnvConfig()
        : raw.env;
  return { ...raw, source, macroIndex, env };
}

function load(): LfoModState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LfoModState>;
      return {
        lfos: Array.isArray(parsed.lfos) ? parsed.lfos : [],
        routes: Array.isArray(parsed.routes)
          ? parsed.routes.map((r) => migrateRoute(r as ModRoute))
          : [],
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
  // source defaultet auf "lfo" (Abwärtskompatibilität: bestehende Aufrufer wie
  // der "+Route"-Button im LfoModPanel übergeben kein source-Feld).
  const withSource: ModRoute = { ...route, id, source: route.source ?? "lfo" };
  _state = { ..._state, routes: [..._state.routes, withSource] };
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

/**
 * Liefert aktive Routes für den Engine-Seam (TASK-257-FOLLOWUP-3).
 *
 * Aktivitäts-Prädikat je nach Quelle:
 *  - "lfo":   Route enabled UND zugehörige LfoConfig existiert + ist enabled.
 *  - "macro": Route enabled (Macro-Wert wird im Seam live gelesen).
 *  - "env":   Route enabled (Hüllkurve läuft frei nach Wall-Clock).
 *
 * `lfo` ist nur für source==="lfo" gesetzt — für macro/env ist es `undefined`.
 * (Vor FOLLOWUP-3 wurde JEDE Route ohne enabled-LFO verworfen; dadurch wären
 * macro/env-Routes stumm geblieben — daher die Verzweigung.)
 */
export function getActiveModRoutes(): Array<{ route: ModRoute; lfo?: LfoConfig }> {
  const out: Array<{ route: ModRoute; lfo?: LfoConfig }> = [];
  for (const route of _state.routes) {
    if (!route.enabled) continue;
    const source = routeSource(route);
    if (source === "lfo") {
      const lfo = _state.lfos.find((l) => l.id === route.lfoId);
      if (!lfo || !lfo.enabled) continue;
      out.push({ route, lfo });
    } else {
      // macro / env: kein LFO erforderlich.
      out.push({ route });
    }
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
