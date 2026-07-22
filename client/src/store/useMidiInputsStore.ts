/**
 * useMidiInputsStore — Multi-Device-MIDI-Input-Konfiguration.
 *
 * Ermöglicht, MEHRERE Input-Geräte gleichzeitig aktiv zu haben (z.B. eine
 * Electribe 2 für SysEx/Clock UND einen Akai-Controller für CC/Noten) — statt
 * wie bisher nur ein einziges aktives Input. Pro Gerät: enabled + Rolle.
 *
 * Persistenz KEYED BY NAME (nicht id): Web-MIDI-/RtMidi-Port-IDs sind zwischen
 * Sessions/Backends instabil, der Name ist portabel — dieselbe Konvention wie
 * die bestehende by-name-Reconnect-Logik in `useMidi.refreshDevices`.
 *
 * Observer-Store-Muster (kein Zustand-Paket), analog zu den anderen ss-Stores.
 * Die reinen Rollen-Gates (`roleAccepts*`) sind exportiert + unit-testbar; der
 * `useMidi`-Hook hängt seinen Handler an ALLE enabled Inputs und filtert die
 * Consumer (CC/Note/SysEx/Clock) über diese Gates.
 */
import { useEffect, useReducer } from "react";

/**
 * Rolle eines Input-Geräts — bestimmt, welche Consumer seine Events sehen.
 *  - all        : alles (Default, rückwärtskompatibel)
 *  - controller : CC-Mappings + Noten (typischer Fader/Pad-Controller, z.B. Akai)
 *  - keys       : nur Noten (Masterkeyboard)
 *  - sysex      : nur SysEx (reine Geräte-Kommunikation, z.B. E2S-Param-Sync)
 *  - clock      : nur MIDI-Clock/Transport (externer Tempo-Master)
 */
export type MidiInputRole = "all" | "controller" | "keys" | "sysex" | "clock";

export const MIDI_INPUT_ROLES: MidiInputRole[] = [
  "all",
  "controller",
  "keys",
  "sysex",
  "clock",
];

export interface MidiInputConfig {
  enabled: boolean;
  role: MidiInputRole;
}

export function defaultInputConfig(): MidiInputConfig {
  return { enabled: false, role: "all" };
}

// ─── Rollen-Gates (rein, testbar) ─────────────────────────────────────────────
export function roleAcceptsCc(role: MidiInputRole): boolean {
  return role === "all" || role === "controller";
}
export function roleAcceptsNote(role: MidiInputRole): boolean {
  return role === "all" || role === "controller" || role === "keys";
}
export function roleAcceptsSysex(role: MidiInputRole): boolean {
  return role === "all" || role === "sysex";
}
export function roleAcceptsClock(role: MidiInputRole): boolean {
  return role === "all" || role === "clock";
}

// ─── State + Persistenz ───────────────────────────────────────────────────────
export interface MidiInputsState {
  /** Konfiguration pro Geräte-NAME. */
  byName: Record<string, MidiInputConfig>;
}

const STORAGE_KEY = "ss-midi-inputs:v1";

function loadState(): MidiInputsState {
  if (typeof localStorage === "undefined") return { byName: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { byName: {} };
    const parsed = JSON.parse(raw) as Partial<MidiInputsState>;
    const byName: Record<string, MidiInputConfig> = {};
    for (const [name, cfg] of Object.entries(parsed.byName ?? {})) {
      const role = (cfg as MidiInputConfig)?.role;
      byName[name] = {
        enabled: !!(cfg as MidiInputConfig)?.enabled,
        role: MIDI_INPUT_ROLES.includes(role) ? role : "all",
      };
    }
    return { byName };
  } catch {
    return { byName: {} };
  }
}

let _state: MidiInputsState = loadState();
const _listeners = new Set<() => void>();

function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    /* Quota/Private-Mode — nicht fatal. */
  }
}
function notify(): void {
  _listeners.forEach(fn => fn());
}
function set(next: MidiInputsState): void {
  _state = next;
  persist();
  notify();
}

export function getMidiInputsState(): MidiInputsState {
  return _state;
}

/** Konfiguration eines Geräts (Default, falls unbekannt). */
export function getInputConfig(name: string): MidiInputConfig {
  return _state.byName[name] ?? defaultInputConfig();
}

/** true, wenn das Gerät aktiv geschaltet ist. */
export function isInputEnabled(name: string): boolean {
  return _state.byName[name]?.enabled ?? false;
}

/** Namen aller aktiven Geräte. */
export function enabledInputNames(): string[] {
  return Object.entries(_state.byName)
    .filter(([, c]) => c.enabled)
    .map(([name]) => name);
}

export function setInputEnabled(name: string, enabled: boolean): void {
  const prev = _state.byName[name] ?? defaultInputConfig();
  set({ byName: { ..._state.byName, [name]: { ...prev, enabled } } });
}

export function setInputRole(name: string, role: MidiInputRole): void {
  const prev = _state.byName[name] ?? defaultInputConfig();
  set({ byName: { ..._state.byName, [name]: { ...prev, role } } });
}

/** Entfernt die gespeicherte Konfiguration eines Geräts. */
export function removeInputConfig(name: string): void {
  if (!(name in _state.byName)) return;
  const byName = { ..._state.byName };
  delete byName[name];
  set({ byName });
}

/**
 * Einmalige Migration: übernimmt das alte Single-Device (by-name) als aktives
 * Multi-Device, falls die neue Konfig noch leer ist. No-op, wenn bereits Geräte
 * konfiguriert sind. Gibt true zurück, wenn migriert wurde.
 */
export function migrateSingleInput(name: string | null): boolean {
  if (!name) return false;
  if (Object.keys(_state.byName).length > 0) return false;
  set({ byName: { [name]: { enabled: true, role: "all" } } });
  return true;
}

/** Test-Hook. */
export function __resetMidiInputsForTests(): void {
  _state = { byName: {} };
  notify();
}

// ─── React Hook ────────────────────────────────────────────────────────────────
export interface MidiInputsStoreApi extends MidiInputsState {
  getConfig: (name: string) => MidiInputConfig;
  isEnabled: (name: string) => boolean;
  enabledNames: () => string[];
  setEnabled: (name: string, enabled: boolean) => void;
  setRole: (name: string, role: MidiInputRole) => void;
  remove: (name: string) => void;
}

export function useMidiInputsStore(): MidiInputsStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    ..._state,
    getConfig: getInputConfig,
    isEnabled: isInputEnabled,
    enabledNames: enabledInputNames,
    setEnabled: setInputEnabled,
    setRole: setInputRole,
    remove: removeInputConfig,
  };
}
