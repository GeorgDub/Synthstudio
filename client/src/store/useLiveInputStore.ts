/**
 * Synthstudio – useLiveInputStore.ts (TASK-233 / v2.85)
 *
 * State-Management für Live-Input-Channels (Outboard-FX-Box-Modus).
 *
 * KORG-Hardware (Electribe 2 / ESX) per USB-Audio in Synthstudio einspeisen,
 * Audio durch FX-Chain laufen lassen (EQ/Comp/Reverb/Delay), wieder ausgeben.
 * Macht Synthstudio zur "Outboard-FX-Box" für KORG.
 *
 * Persistenz: localStorage (deviceId, name, volume, pan, mute, solo, sends,
 * latencyCompensationMs). MediaStream-Reattach passiert beim ersten attach
 * via AudioEngine.attachLiveInput.
 *
 * Architektur: Custom Observer Store (analog useAudioTrackStore.ts).
 * KEIN Zustand-npm-Package.
 */

import { useEffect, useReducer } from "react";
import { nanoid } from "nanoid";

// ─── Typen ───────────────────────────────────────────────────────────────────

export interface LiveInputSends {
  reverb: number; // 0..1
  delay: number;  // 0..1
}

export interface LiveInputChannelData {
  /** Format: `liveinput:<nanoid>` */
  id: string;
  /** Anzeigename im Mixer-Strip. */
  name: string;
  /**
   * Web-Audio-Device-ID (von navigator.mediaDevices.enumerateDevices()).
   * NULL solange noch kein Device gewählt wurde (Strip ist dann "leer").
   */
  deviceId: string | null;
  /** Letzter bekannter Device-Label (Fallback-Text wenn enumerate noch leer). */
  deviceLabel?: string;
  volume: number;      // 0..1.5 (Default: ~0.5 = -6dB)
  pan: number;         // -1..1
  muted: boolean;
  soloed: boolean;
  sends: LiveInputSends;
  /**
   * Manuelle Plugin-Delay-Compensation in ms (0..1000).
   * User justiert pro Channel um die Audio-Interface-Latenz zu kompensieren.
   * Default 0 — Advanced-User-Setting.
   */
  latencyCompensationMs: number;
  /**
   * Record-Arm (TASK-234 / v2.86). Bei `transport:play` startet eine Aufnahme
   * auf diesem Channel, bei `transport:stop` wird sie als Audio-Track persistiert.
   * Default `false` — alle Channels sind anfangs disarmed.
   */
  recordArmed?: boolean;
}

// ─── Konstanten ──────────────────────────────────────────────────────────────

export const MAX_LIVE_INPUT_CHANNELS = 4;
export const DEFAULT_LIVE_INPUT_VOLUME = 0.5; // ~-6 dB Headroom
export const DEFAULT_LIVE_INPUT_PAN = 0;
const STORAGE_KEY = "synthstudio:liveinputs:v1";
const ID_PREFIX = "liveinput:";

// ─── Persistierter State ─────────────────────────────────────────────────────

let _channels: LiveInputChannelData[] = loadFromStorage();

type Listener = () => void;
const _listeners = new Set<Listener>();

function notify(): void {
  _listeners.forEach((l) => {
    try { l(); } catch { /* ignore */ }
  });
}

// ─── Persistence Helpers ─────────────────────────────────────────────────────

function loadFromStorage(): LiveInputChannelData[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidChannel).slice(0, MAX_LIVE_INPUT_CHANNELS);
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_channels));
  } catch { /* quota voll – ignore */ }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function isValidChannel(x: unknown): x is LiveInputChannelData {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.startsWith(ID_PREFIX)) return false;
  if (typeof o.name !== "string") return false;
  if (o.deviceId !== null && typeof o.deviceId !== "string") return false;
  if (typeof o.volume !== "number") return false;
  if (typeof o.pan !== "number") return false;
  if (typeof o.muted !== "boolean") return false;
  if (typeof o.soloed !== "boolean") return false;
  if (typeof o.latencyCompensationMs !== "number") return false;
  // recordArmed ist optional (älter Schema-Migration friendly).
  if (o.recordArmed !== undefined && typeof o.recordArmed !== "boolean") return false;
  const sends = o.sends as { reverb?: unknown; delay?: unknown } | undefined;
  if (!sends || typeof sends !== "object") return false;
  if (typeof sends.reverb !== "number") return false;
  if (typeof sends.delay !== "number") return false;
  return true;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fügt einen neuen Live-Input-Channel hinzu.
 * @throws Error wenn MAX_LIVE_INPUT_CHANNELS erreicht.
 * @returns Die generierte ID im Format `liveinput:<nanoid>`.
 */
export function addLiveInputChannel(
  overrides: Partial<Omit<LiveInputChannelData, "id">> = {},
): string {
  if (_channels.length >= MAX_LIVE_INPUT_CHANNELS) {
    throw new Error(
      `Maximum number of live-input channels reached (${MAX_LIVE_INPUT_CHANNELS}).`,
    );
  }
  const id = `${ID_PREFIX}${nanoid()}`;
  const channel: LiveInputChannelData = {
    id,
    name: overrides.name ?? `Live In ${_channels.length + 1}`,
    deviceId: overrides.deviceId ?? null,
    deviceLabel: overrides.deviceLabel,
    volume: clamp(overrides.volume ?? DEFAULT_LIVE_INPUT_VOLUME, 0, 1.5),
    pan: clamp(overrides.pan ?? DEFAULT_LIVE_INPUT_PAN, -1, 1),
    muted: overrides.muted ?? false,
    soloed: overrides.soloed ?? false,
    sends: {
      reverb: clamp(overrides.sends?.reverb ?? 0, 0, 1),
      delay:  clamp(overrides.sends?.delay  ?? 0, 0, 1),
    },
    latencyCompensationMs: clamp(overrides.latencyCompensationMs ?? 0, 0, 1000),
    recordArmed: overrides.recordArmed ?? false,
  };
  _channels = [..._channels, channel];
  persist();
  notify();
  return id;
}

/**
 * Setzt das `recordArmed`-Flag eines Channels (TASK-234).
 * Idempotent — no-op wenn Channel unbekannt oder Flag bereits identisch.
 */
export function setLiveInputRecordArm(id: string, armed: boolean): void {
  const idx = _channels.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const existing = _channels[idx];
  if ((existing.recordArmed ?? false) === armed) return;
  _channels = [
    ..._channels.slice(0, idx),
    { ...existing, recordArmed: armed },
    ..._channels.slice(idx + 1),
  ];
  persist();
  notify();
}

/** Liefert alle Channel-IDs die armed=true sind (für Transport-Play). */
export function getArmedLiveInputChannelIds(): string[] {
  return _channels.filter((c) => c.recordArmed).map((c) => c.id);
}

/**
 * v3.62.0: Setzt `recordArmed` für alle Live-Input-Channels in einem Rutsch.
 *
 * Multi-Track-Recording-UX (Bulk-Action für die Mixer-Topbar). Hartes Wechseln
 * auf den Ziel-Status, keine inkrementelle Toggle-Logik. Idempotent — wenn
 * der State bereits identisch ist passiert nichts (kein notify, keine
 * Persist-Schreibe).
 *
 * Limit-Check: die Engine erzwingt MAX_SIMULTANEOUS_RECORDINGS=8 zur
 * Aufnahmezeit (siehe AudioRecorder.start). Hier dürfen alle vorhandenen
 * Live-Inputs armed werden — die Konsequenz (welche kommen tatsächlich
 * durch) wird erst bei `transport:play` sichtbar.
 */
export function setAllLiveInputRecordArm(armed: boolean): void {
  let mutated = false;
  const next = _channels.map((c) => {
    if ((c.recordArmed ?? false) === armed) return c;
    mutated = true;
    return { ...c, recordArmed: armed };
  });
  if (!mutated) return;
  _channels = next;
  persist();
  notify();
}

/** v3.62.0: Anzahl der gerade armed Live-Input-Channels (für UI-Counter). */
export function countArmedLiveInputs(): number {
  let n = 0;
  for (const c of _channels) if (c.recordArmed) n++;
  return n;
}

/** Entfernt einen Live-Input-Channel. Caller MUSS vorher den Stream detachen. */
export function removeLiveInputChannel(id: string): void {
  const next = _channels.filter((c) => c.id !== id);
  if (next.length === _channels.length) return;
  _channels = next;
  persist();
  notify();
}

/** Patcht nur die angegebenen Felder. ID kann NICHT geändert werden. */
export function updateLiveInputChannel(
  id: string,
  patch: Partial<LiveInputChannelData>,
): void {
  const idx = _channels.findIndex((c) => c.id === id);
  if (idx < 0) return;
  // ID darf nicht überschrieben werden
  const { id: _ignoredId, ...safe } = patch;
  void _ignoredId;

  const existing = _channels[idx];
  const merged: LiveInputChannelData = {
    ...existing,
    ...safe,
    sends: {
      reverb: clamp(safe.sends?.reverb ?? existing.sends.reverb, 0, 1),
      delay:  clamp(safe.sends?.delay  ?? existing.sends.delay,  0, 1),
    },
    volume: clamp(safe.volume ?? existing.volume, 0, 1.5),
    pan:    clamp(safe.pan    ?? existing.pan,   -1, 1),
    latencyCompensationMs: clamp(
      safe.latencyCompensationMs ?? existing.latencyCompensationMs,
      0,
      1000,
    ),
  };
  _channels = [..._channels.slice(0, idx), merged, ..._channels.slice(idx + 1)];
  persist();
  notify();
}

/**
 * Setzt Solo-Status. exclusive=true un-soloed alle anderen (Radio-Button-Mode).
 */
export function setLiveInputSoloed(
  id: string,
  soloed: boolean,
  exclusive = false,
): void {
  const idx = _channels.findIndex((c) => c.id === id);
  if (idx < 0) return;
  _channels = _channels.map((c, i) => {
    if (i === idx) return { ...c, soloed };
    return exclusive ? { ...c, soloed: false } : c;
  });
  persist();
  notify();
}

export function getLiveInputChannel(id: string): LiveInputChannelData | null {
  return _channels.find((c) => c.id === id) ?? null;
}

export function getAllLiveInputChannels(): LiveInputChannelData[] {
  return _channels.slice();
}

/** Replace komplett (für Project-Load — analog loadAudioTracks). */
export function loadLiveInputChannels(items: LiveInputChannelData[]): void {
  const valid = (items ?? []).filter(isValidChannel).slice(0, MAX_LIVE_INPUT_CHANNELS);
  _channels = valid;
  persist();
  notify();
}

/** Reset für Tests + "Neues Projekt". Nicht für UI-Buttons gedacht. */
export function clearLiveInputChannels(): void {
  if (_channels.length === 0) return;
  _channels = [];
  persist();
  notify();
}

/** Vollständiger Reset inkl. localStorage. */
export function __resetForTests(): void {
  _channels = [];
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* ignore */ }
  notify();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export interface LiveInputStoreApi {
  channels: LiveInputChannelData[];
  add: (overrides?: Partial<Omit<LiveInputChannelData, "id">>) => string;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<LiveInputChannelData>) => void;
  setSoloed: (id: string, soloed: boolean, exclusive?: boolean) => void;
  setRecordArm: (id: string, armed: boolean) => void;
  /** v3.62.0: Bulk-Action für Multi-Track-Recording. */
  setAllRecordArm: (armed: boolean) => void;
  /** v3.62.0: Anzahl armed Channels (für UI-Counter-Badges). */
  armedCount: number;
  get: (id: string) => LiveInputChannelData | null;
}

/**
 * React-Hook: Observer-Pattern. Returnt einen Snapshot + Public Mutation API.
 */
export function useLiveInputStore(): LiveInputStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    channels: _channels,
    add: addLiveInputChannel,
    remove: removeLiveInputChannel,
    update: updateLiveInputChannel,
    setSoloed: setLiveInputSoloed,
    setRecordArm: setLiveInputRecordArm,
    setAllRecordArm: setAllLiveInputRecordArm,
    armedCount: _channels.reduce((n, c) => n + (c.recordArmed ? 1 : 0), 0),
    get: getLiveInputChannel,
  };
}
