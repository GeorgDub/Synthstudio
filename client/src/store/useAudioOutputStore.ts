/**
 * useAudioOutputStore — Auswahl des Audio-AUSGABEgeräts (z.B. Scarlett 2i2).
 *
 * Web Audio geht per Default an `ctx.destination` = OS-Standardgerät. Chromium/
 * Electron unterstützen `AudioContext.setSinkId(deviceId)` (live, ohne Reinit),
 * womit sich der Master-Bus gezielt auf ein Interface legen lässt. Diese Store-
 * Ebene hält nur die Auswahl (persistiert); das Anwenden macht `AudioEngine`.
 *
 * `deviceId === ""` bedeutet „System-Standard" (setSinkId("")). Persistiert wird
 * die deviceId; Labels/Enumeration liefert `navigator.mediaDevices` in der UI.
 *
 * Observer-Store-Muster (kein Zustand-Paket), analog den anderen ss-Stores.
 */
import { useEffect, useReducer } from "react";

export interface AudioOutputState {
  /** "" = System-Standard, sonst eine mediaDevices-audiooutput-deviceId. */
  deviceId: string;
}

const STORAGE_KEY = "ss-audio-output:v1";

function loadState(): AudioOutputState {
  if (typeof localStorage === "undefined") return { deviceId: "" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { deviceId: "" };
    const parsed = JSON.parse(raw) as Partial<AudioOutputState>;
    return {
      deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : "",
    };
  } catch {
    return { deviceId: "" };
  }
}

let _state: AudioOutputState = loadState();
const _listeners = new Set<() => void>();

function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
  } catch {
    /* Quota/Private-Mode */
  }
}
function notify(): void {
  _listeners.forEach(fn => fn());
}

export function getAudioOutputState(): AudioOutputState {
  return _state;
}
export function getAudioOutputDeviceId(): string {
  return _state.deviceId;
}

export function setAudioOutputDeviceId(deviceId: string): void {
  const id = typeof deviceId === "string" ? deviceId : "";
  if (id === _state.deviceId) return;
  _state = { deviceId: id };
  persist();
  notify();
}

/** true = System-Standard (kein spezifisches Gerät gewählt). */
export function isDefaultAudioOutput(): boolean {
  return _state.deviceId === "";
}

/** Test-Hook. */
export function __resetAudioOutputForTests(): void {
  _state = { deviceId: "" };
  notify();
}

// ─── React Hook ────────────────────────────────────────────────────────────────
export interface AudioOutputStoreApi extends AudioOutputState {
  setDeviceId: (id: string) => void;
  isDefault: boolean;
}

export function useAudioOutputStore(): AudioOutputStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    ..._state,
    setDeviceId: setAudioOutputDeviceId,
    isDefault: _state.deviceId === "",
  };
}
