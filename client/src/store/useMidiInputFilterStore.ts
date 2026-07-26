/**
 * Synthstudio — useMidiInputFilterStore (v3.269.0)
 *
 * Zustand + Persistenz für den MIDI-Eingangsfilter. Die Entscheidungslogik
 * selbst liegt in `utils/midiInputFilter.ts` (rein, getestet).
 *
 * Persistenz: localStorage, NICHT im .synth-Schema — das ist eine
 * Arbeitsplatz-Einstellung (welche Hardware hängt gerade dran), keine
 * Projekteigenschaft.
 *
 * Pattern: Modul-Singleton + Hook, analog `useE2sPatternSyncStore`.
 */
import { useEffect, useReducer } from "react";
import {
  allClassesEnabled,
  toggleMutedDeviceName,
  type MidiInputFilterState,
  type MidiMessageClass,
} from "../utils/midiInputFilter";

const STORAGE_KEY = "synthstudio:midi-input-filter:v1";

function defaultState(): MidiInputFilterState {
  return {
    masterMute: false,
    // Default an: ohne Multi-Input-Betrieb kann man Korg und Controller nicht
    // gleichzeitig fahren, und ein Pro-Gerät-Mute hätte nichts zu muten.
    listenAllInputs: true,
    mutedDeviceNames: [],
    classes: allClassesEnabled(),
  };
}

function loadState(): MidiInputFilterState {
  if (typeof localStorage === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<MidiInputFilterState> | null;
    if (!parsed || typeof parsed !== "object") return defaultState();
    const base = defaultState();
    const classes = { ...base.classes };
    if (parsed.classes && typeof parsed.classes === "object") {
      for (const key of Object.keys(classes) as MidiMessageClass[]) {
        const v = (parsed.classes as Record<string, unknown>)[key];
        if (typeof v === "boolean") classes[key] = v;
      }
    }
    return {
      masterMute: parsed.masterMute === true,
      listenAllInputs: parsed.listenAllInputs !== false,
      mutedDeviceNames: Array.isArray(parsed.mutedDeviceNames)
        ? parsed.mutedDeviceNames.filter((n): n is string => typeof n === "string" && n.length > 0)
        : [],
      classes,
    };
  } catch {
    return defaultState();
  }
}

function persist(state: MidiInputFilterState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / Privacy-Mode — bewusst still.
  }
}

let _state: MidiInputFilterState = loadState();
const _listeners = new Set<() => void>();

function notify(): void {
  _listeners.forEach((fn) => fn());
}

function commit(next: MidiInputFilterState): void {
  _state = next;
  persist(_state);
  notify();
}

// ─── Getter / Setter (Hook-frei, für den MIDI-Handler) ──────────────────────

/**
 * Aktueller Filterzustand. Wird im MIDI-Handler pro Nachricht gelesen — daher
 * bewusst ein einfacher Objekt-Read ohne Kopie.
 */
export function getMidiInputFilterState(): MidiInputFilterState {
  return _state;
}

export function setMidiInputMasterMute(masterMute: boolean): void {
  if (_state.masterMute === masterMute) return;
  commit({ ..._state, masterMute });
}

export function setMidiInputListenAll(listenAllInputs: boolean): void {
  if (_state.listenAllInputs === listenAllInputs) return;
  commit({ ..._state, listenAllInputs });
}

export function setMidiInputClassEnabled(cls: MidiMessageClass, enabled: boolean): void {
  if (_state.classes[cls] === enabled) return;
  commit({ ..._state, classes: { ..._state.classes, [cls]: enabled } });
}

export function toggleMidiInputClass(cls: MidiMessageClass): void {
  setMidiInputClassEnabled(cls, _state.classes[cls] === false);
}

/** Schaltet einen Eingang stumm bzw. wieder frei (per Gerätename). */
export function toggleMidiInputDeviceMute(deviceName: string): void {
  const next = toggleMutedDeviceName(_state.mutedDeviceNames, deviceName);
  commit({ ..._state, mutedDeviceNames: next });
}

export function setMidiInputDeviceMuted(deviceName: string, muted: boolean): void {
  const isMuted = _state.mutedDeviceNames.some(
    (n) => n.trim().toLowerCase() === deviceName.trim().toLowerCase(),
  );
  if (isMuted === muted) return;
  toggleMidiInputDeviceMute(deviceName);
}

/** Alles wieder offen — der „ich hab mich verklickt"-Ausweg. */
export function resetMidiInputFilter(): void {
  commit({ ...defaultState(), listenAllInputs: _state.listenAllInputs });
}

/** Test-only Reset. */
export function __resetMidiInputFilterForTests(): void {
  _state = defaultState();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  notify();
}

/**
 * Test-only: Zustand neu aus localStorage lesen. Nur so ist der Parse-Pfad
 * (inkl. kaputter Inhalte) prüfbar — beim Modul-Import läuft er genau einmal.
 */
export function __reloadMidiInputFilterForTests(): void {
  _state = loadState();
  notify();
}

// ─── React Hook ─────────────────────────────────────────────────────────────

export interface MidiInputFilterStoreApi extends MidiInputFilterState {
  setMasterMute: (v: boolean) => void;
  setListenAllInputs: (v: boolean) => void;
  setClassEnabled: (cls: MidiMessageClass, enabled: boolean) => void;
  toggleClass: (cls: MidiMessageClass) => void;
  toggleDeviceMute: (deviceName: string) => void;
  setDeviceMuted: (deviceName: string, muted: boolean) => void;
  reset: () => void;
}

export function useMidiInputFilterStore(): MidiInputFilterStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => { _listeners.delete(rerender); };
  }, []);
  return {
    ..._state,
    setMasterMute: setMidiInputMasterMute,
    setListenAllInputs: setMidiInputListenAll,
    setClassEnabled: setMidiInputClassEnabled,
    toggleClass: toggleMidiInputClass,
    toggleDeviceMute: toggleMidiInputDeviceMute,
    setDeviceMuted: setMidiInputDeviceMuted,
    reset: resetMidiInputFilter,
  };
}
