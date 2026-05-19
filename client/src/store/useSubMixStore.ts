/**
 * Synthstudio – useSubMixStore.ts (v3.79.0)
 *
 * Sub-Mix-Bus-State: Channel-Grouping mit shared FX (DAW-Standard).
 *
 * Konzept:
 *   - Bis zu MAX_SUB_MIX_BUSES (=8) Sub-Mix-Buses pro Projekt.
 *   - Jeder Bus hat eigene Volume/Pan/Mute/Solo + optional ChannelFx (reused
 *     von der bestehenden ChannelFx-Definition, damit AudioEngine den
 *     channel-FX-graph-builder wiederverwenden kann).
 *   - Channels werden via `channelIds: string[]` assigned. Ein Channel kann
 *     pro Zeitpunkt nur an einem Bus hängen (auto-unassign aus anderen Buses
 *     beim Re-Assign).
 *   - Channels ohne Bus default zu master (kein Eintrag in irgendeinem Bus).
 *
 * Routing-Schema (siehe AudioEngine.ts):
 *     channelOutput → (bus.fx?) → bus.gain → bus.panner → masterEq → … → destination
 *
 * Architektur:
 *   - Custom Observer-Pattern (analog useMasterFxStore), KEIN zustand-npm.
 *   - localStorage-Persist unter `synthstudio:sub-mix:v1`.
 *   - Zusätzlich Snapshot-Round-Trip im .synth-Projektformat (Schema v1.32).
 *   - Audio-Wiring übernimmt AudioEngine.setSubMixBus*() — diese Datei selbst
 *     hat KEINE Audio-Side-Effects.
 *
 * Backward-Compat:
 *   - Pre-v3.79 hat keine Persistenz → defaults (leere bus-Liste) werden geladen.
 *   - parseProject (v1.32) toleriert fehlendes `subMixBuses`-Feld (→ defaults).
 *   - Channels ohne Bus-Membership default zu master (additiv-Feature).
 */
import { useEffect, useReducer } from "react";

// ─── Typen ───────────────────────────────────────────────────────────────────

/**
 * Maximalanzahl Sub-Mix-Buses pro Projekt.
 *
 * Begründung: Jeder Bus bedeutet einen zusätzlichen Strip im Mixer-View
 * (Visual-Density), einen GainNode + StereoPannerNode + optional ChannelFx-
 * Chain im Audio-Graph (CPU-Budget) und einen Routing-Branch (Mental Model).
 * 8 deckt die Standard-DAW-Workflow-Gruppen ab (Drums, Bass, Synths, Vocals,
 * Pads, Leads, FX, Master-Returns) ohne dass die UI in mehrere Reihen
 * scrollen muss. Höhere Counts machen erst Sinn bei Bus-of-Bus-Routing das
 * v3.79.0 bewusst NICHT unterstützt.
 */
export const MAX_SUB_MIX_BUSES = 8;

/**
 * Pro-Bus ChannelFx-Snapshot. Reuse vom bestehenden ChannelFx-Type aus
 * AudioEngine, damit der channel-FX-graph-builder wiederverwendbar ist.
 * Wir importieren den Type lazy hier rein um keinen circular-dependency-
 * risk zu erzeugen.
 */
export interface SubMixBusFx {
  /** Wenn true, durchläuft das Bus-Signal die FX-Chain. */
  enabled: boolean;
  /** Volume-Trim hinter den FX (linear, 0..2). */
  postGain: number;
  // Future: reverbSend, delaySend, EQ, etc. — gehalten klein für v3.79.0.
}

export interface SubMixBus {
  /** Stable UUID. */
  id: string;
  /** User-editable Name (max 32 Zeichen, getrimmt). */
  name: string;
  /** Hex-Color "#RRGGBB" oder "#RGB" lowercase, oder undefined (Palette-Default). */
  color?: string;
  /** Volume linear 0..2 (Range konsistent mit Channel-Volume). */
  volume: number;
  /** Pan -1..+1. */
  pan: number;
  /** Mute-Toggle. */
  mute: boolean;
  /** Solo-Toggle. Solo-Logik: wenn mind. ein Bus Solo, sind alle anderen stumm. */
  solo: boolean;
  /** Liste der Channel-PartIds die in diesen Bus routen. */
  channelIds: string[];
  /** Optional pro-Bus FX-Chain (v3.79 minimal: postGain + enabled-Flag). */
  fx?: SubMixBusFx;
}

export interface SubMixState {
  buses: SubMixBus[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "synthstudio:sub-mix:v1";

export function defaultSubMixState(): SubMixState {
  return { buses: [] };
}

const DEFAULT_BUS_FX: SubMixBusFx = {
  enabled: false,
  postGain: 1.0,
};

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

function clampString(v: unknown, maxLen: number, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  if (t.length === 0) return fallback;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function clampBusFx(input: Partial<SubMixBusFx> | undefined): SubMixBusFx {
  const i = input ?? {};
  return {
    enabled: clampBool(i.enabled, DEFAULT_BUS_FX.enabled),
    postGain: clampNum(i.postGain, 0, 2, DEFAULT_BUS_FX.postGain),
  };
}

/**
 * Validiert + clampt einen einzelnen SubMixBus aus unbekannter Quelle
 * (localStorage, .synth-File). Liefert null wenn unbrauchbar.
 */
export function sanitizeBus(raw: unknown): SubMixBus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SubMixBus>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  const name = clampString(r.name, 32, "Bus");
  const channelIds = Array.isArray(r.channelIds)
    ? r.channelIds.filter((c): c is string => typeof c === "string" && c.length > 0)
    : [];
  const bus: SubMixBus = {
    id: r.id,
    name,
    volume: clampNum(r.volume, 0, 2, 0.85),
    pan: clampNum(r.pan, -1, 1, 0),
    mute: clampBool(r.mute, false),
    solo: clampBool(r.solo, false),
    channelIds,
  };
  // Color ist optional; nur akzeptieren, wenn es ein plausibles Hex ist.
  if (typeof r.color === "string" && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(r.color)) {
    bus.color = r.color.toLowerCase();
  }
  // FX optional.
  if (r.fx !== undefined) {
    bus.fx = clampBusFx(r.fx);
  }
  return bus;
}

export function sanitizeSubMixState(raw: unknown): SubMixState {
  if (!raw || typeof raw !== "object") return defaultSubMixState();
  const r = raw as Partial<SubMixState>;
  if (!Array.isArray(r.buses)) return defaultSubMixState();
  const buses: SubMixBus[] = [];
  const seenIds = new Set<string>();
  for (const raw of r.buses) {
    const b = sanitizeBus(raw);
    if (!b || seenIds.has(b.id)) continue;
    seenIds.add(b.id);
    buses.push(b);
    if (buses.length >= MAX_SUB_MIX_BUSES) break; // hart cappen
  }
  return { buses };
}

// ─── Persist ─────────────────────────────────────────────────────────────────

function loadState(): SubMixState {
  if (typeof window === "undefined") return defaultSubMixState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSubMixState();
    return sanitizeSubMixState(JSON.parse(raw));
  } catch {
    return defaultSubMixState();
  }
}

function persist(state: SubMixState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Quota / Private-Mode → swallow */
  }
}

// ─── Module-Singleton State + Listener Set ───────────────────────────────────

type Listener = () => void;

let _state: SubMixState = loadState();
const _listeners = new Set<Listener>();

function notify(): void {
  for (const l of _listeners) {
    try { l(); } catch { /* swallow */ }
  }
}

function commit(next: SubMixState): void {
  _state = next;
  persist(_state);
  notify();
}

// ─── ID-Generator ────────────────────────────────────────────────────────────

function makeBusId(): string {
  // crypto.randomUUID falls verfügbar (Node 18+, Modern Browsers),
  // sonst Fallback auf timestamp + random.
  try {
    if (typeof globalThis !== "undefined" && (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID) {
      return (globalThis as { crypto: { randomUUID: () => string } }).crypto.randomUUID();
    }
  } catch { /* fallthrough */ }
  return `bus-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Public Getters (DOM-frei, testbar) ──────────────────────────────────────

export function getSubMixState(): SubMixState {
  return _state;
}

export function getBuses(): SubMixBus[] {
  return _state.buses;
}

export function getBusForChannel(partId: string): SubMixBus | undefined {
  return _state.buses.find((b) => b.channelIds.includes(partId));
}

export function getBusById(id: string): SubMixBus | undefined {
  return _state.buses.find((b) => b.id === id);
}

/** Wahr wenn mind. ein Bus solo'd ist. */
export function anyBusSolo(): boolean {
  return _state.buses.some((b) => b.solo);
}

/**
 * Effektiver Mute-State: ein Bus ist effektiv stumm, wenn:
 *  - er selbst mute=true ist, ODER
 *  - mind. ein anderer Bus solo'd ist, aber dieser nicht.
 */
export function isBusEffectivelyMuted(busId: string): boolean {
  const bus = _state.buses.find((b) => b.id === busId);
  if (!bus) return false;
  if (bus.mute) return true;
  const anySolo = _state.buses.some((b) => b.solo);
  if (anySolo && !bus.solo) return true;
  return false;
}

// ─── Public Setters ──────────────────────────────────────────────────────────

/**
 * Erstellt einen neuen Bus mit Defaults. Returnt die neue Bus-ID, oder null
 * wenn MAX_SUB_MIX_BUSES erreicht.
 */
export function createBus(name?: string): string | null {
  if (_state.buses.length >= MAX_SUB_MIX_BUSES) return null;
  const id = makeBusId();
  const fallbackName = `Bus ${_state.buses.length + 1}`;
  const bus: SubMixBus = {
    id,
    name: clampString(name, 32, fallbackName),
    volume: 0.85,
    pan: 0,
    mute: false,
    solo: false,
    channelIds: [],
  };
  commit({ buses: [..._state.buses, bus] });
  return id;
}

export function removeBus(id: string): void {
  const next = _state.buses.filter((b) => b.id !== id);
  if (next.length === _state.buses.length) return;
  commit({ buses: next });
}

export function renameBus(id: string, name: string): void {
  const next = _state.buses.map((b) =>
    b.id === id ? { ...b, name: clampString(name, 32, b.name) } : b,
  );
  commit({ buses: next });
}

export function setBusColor(id: string, color: string | undefined): void {
  const next = _state.buses.map((b) => {
    if (b.id !== id) return b;
    if (color === undefined || color === null) {
      const { color: _omit, ...rest } = b;
      return rest as SubMixBus;
    }
    if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)) return b;
    return { ...b, color: color.toLowerCase() };
  });
  commit({ buses: next });
}

export function setBusVolume(id: string, volume: number): void {
  const v = clampNum(volume, 0, 2, 0.85);
  const next = _state.buses.map((b) => (b.id === id ? { ...b, volume: v } : b));
  commit({ buses: next });
}

export function setBusPan(id: string, pan: number): void {
  const p = clampNum(pan, -1, 1, 0);
  const next = _state.buses.map((b) => (b.id === id ? { ...b, pan: p } : b));
  commit({ buses: next });
}

export function setBusMute(id: string, mute: boolean): void {
  const next = _state.buses.map((b) => (b.id === id ? { ...b, mute: !!mute } : b));
  commit({ buses: next });
}

export function setBusSolo(id: string, solo: boolean): void {
  const next = _state.buses.map((b) => (b.id === id ? { ...b, solo: !!solo } : b));
  commit({ buses: next });
}

export function setBusFx(id: string, update: Partial<SubMixBusFx>): void {
  const next = _state.buses.map((b) => {
    if (b.id !== id) return b;
    const merged = clampBusFx({ ...(b.fx ?? DEFAULT_BUS_FX), ...update });
    return { ...b, fx: merged };
  });
  commit({ buses: next });
}

/**
 * Weist `partId` dem Bus `busId` zu. Entfernt den Channel automatisch aus
 * allen anderen Buses (ein Channel kann nur in einem Bus sein).
 * NO-OP wenn busId nicht existiert.
 */
export function assignChannelToBus(busId: string, partId: string): void {
  if (typeof partId !== "string" || partId.length === 0) return;
  if (!_state.buses.some((b) => b.id === busId)) return;
  const next = _state.buses.map((b) => {
    const filtered = b.channelIds.filter((c) => c !== partId);
    if (b.id === busId) {
      return { ...b, channelIds: [...filtered, partId] };
    }
    return { ...b, channelIds: filtered };
  });
  commit({ buses: next });
}

/** Entfernt den Channel aus allen Buses (→ default zu master). */
export function unassignChannel(partId: string): void {
  if (typeof partId !== "string" || partId.length === 0) return;
  let changed = false;
  const next = _state.buses.map((b) => {
    if (!b.channelIds.includes(partId)) return b;
    changed = true;
    return { ...b, channelIds: b.channelIds.filter((c) => c !== partId) };
  });
  if (!changed) return;
  commit({ buses: next });
}

/**
 * Bulk-Set (Project-Restore-Path). Wenn `input` undefined ist, bleibt der
 * State unverändert — Signal "Pre-v1.32-File, User-localStorage nicht
 * überschreiben". Explicit `null` oder `[]` / object → setze entsprechend.
 */
export function setAllBuses(input: unknown): void {
  if (input === undefined) return;
  commit(sanitizeSubMixState(input));
}

/** Komplett-Reset auf Defaults (leere Bus-Liste). */
export function resetSubMix(): void {
  commit(defaultSubMixState());
}

/** Test-Helper: setzt Modul-State + localStorage zurück. */
export function __resetSubMixStoreForTests(): void {
  _state = defaultSubMixState();
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* swallow */ }
  }
}

// ─── React-Hook ──────────────────────────────────────────────────────────────

export function useSubMixStore(): SubMixState {
  const [, forceRender] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    _listeners.add(forceRender);
    return () => { _listeners.delete(forceRender); };
  }, []);
  return _state;
}
