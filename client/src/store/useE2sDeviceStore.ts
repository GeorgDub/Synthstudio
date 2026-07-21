/**
 * Synthstudio — useE2sDeviceStore
 *
 * Custom Observer Store für die *live* Verbindung zu einer echten Korg
 * Electribe 2 / E2S (Stock oder hacktribe) über natives Korg-SysEx (0x42).
 *
 * Orchestriert die reine Session-Ebene `audio/E2SysexBridge.ts`:
 *   Connect → Identity-Handshake → Pattern-Pull (Edit-Buffer + nummeriert).
 *
 * Abgrenzung: NICHT das OmniTribe-OTP (0x7D, useOmniTribe). Reine
 * User-Preference/Live-State — nicht im .synth-Projekt persistiert.
 *
 * Testbarkeit: `connect()` nimmt optional ein MIDIAccess (Default:
 * navigator.requestMIDIAccess({sysex:true})). Tests injizieren ein Fake-Access
 * mit Fake-Ports → der komplette Connect/Identity/Pull-Flow läuft in Node.
 */
import { useEffect, useReducer } from "react";
import { E2SysexBridge, type E2Identity } from "../audio/E2SysexBridge";
import {
  summarizePatternBody,
  type PatternSummary,
} from "../utils/korg/e2Sysex";

export type E2sConnStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface E2sDeviceState {
  status: E2sConnStatus;
  identity: E2Identity | null;
  error: string | null;
  /** Zuletzt gepullter Edit-Buffer. */
  currentPattern: PatternSummary | null;
  /** Gepullte nummerierte Patterns, keyed by slot (0..249). */
  patterns: Record<number, PatternSummary>;
  /** true während eines laufenden Pull-Requests. */
  busy: boolean;
}

function defaultState(): E2sDeviceState {
  return {
    status: "disconnected",
    identity: null,
    error: null,
    currentPattern: null,
    patterns: {},
    busy: false,
  };
}

// ─── Modul-Singletons ─────────────────────────────────────────────────────────
let _state: E2sDeviceState = defaultState();
const _listeners = new Set<() => void>();
let _bridge: E2SysexBridge | null = null;

function notify(): void {
  _listeners.forEach(fn => fn());
}
function set(patch: Partial<E2sDeviceState>): void {
  _state = { ..._state, ...patch };
  notify();
}

/** Web-MIDI-Access-Provider (überschreibbar in Tests). */
type MidiAccessProvider = () => Promise<MIDIAccess>;
let _accessProvider: MidiAccessProvider = () => {
  if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
    return Promise.reject(new Error("Web MIDI not available"));
  }
  return navigator.requestMIDIAccess({ sysex: true });
};

// ─── Public State + Actions ────────────────────────────────────────────────────
export function getE2sDeviceState(): E2sDeviceState {
  return _state;
}

/**
 * Verbindet zu einem E2/E2S: sucht In/Out-Ports (Name enthält `nameMatch`),
 * bindet die Bridge und macht den Identity-Handshake.
 * @param midiAccess optional (Tests/Custom); Default = navigator-Web-MIDI.
 */
export async function connectE2sDevice(
  midiAccess?: MIDIAccess,
  nameMatch = "electribe"
): Promise<boolean> {
  if (_state.status === "connecting") return false;
  set({ status: "connecting", error: null });
  try {
    const access = midiAccess ?? (await _accessProvider());
    _bridge = new E2SysexBridge();
    const identity = await _bridge.connectWebMidi(access, nameMatch);
    if (!identity) {
      _bridge.detach();
      _bridge = null;
      set({
        status: "error",
        error: `Kein Gerät gefunden (Port enthält "${nameMatch}")`,
      });
      return false;
    }
    set({ status: "connected", identity });
    return true;
  } catch (e) {
    _bridge?.detach();
    _bridge = null;
    set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export function disconnectE2sDevice(): void {
  _bridge?.detach();
  _bridge = null;
  set({ ...defaultState() });
}

/** Holt den Edit-Buffer (Current Pattern) und legt die Zusammenfassung ab. */
export async function pullE2sCurrentPattern(): Promise<PatternSummary | null> {
  if (!_bridge || _state.status !== "connected") return null;
  set({ busy: true, error: null });
  try {
    const summary = summarizePatternBody(await _bridge.pullCurrentPattern());
    set({ busy: false, currentPattern: summary });
    return summary;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Holt ein nummeriertes Pattern (0..249) und legt die Zusammenfassung ab. */
export async function pullE2sPattern(
  patternNumber: number
): Promise<PatternSummary | null> {
  if (!_bridge || _state.status !== "connected") return null;
  set({ busy: true, error: null });
  try {
    const summary = summarizePatternBody(
      await _bridge.pullPattern(patternNumber)
    );
    set({
      busy: false,
      patterns: { ..._state.patterns, [patternNumber]: summary },
    });
    return summary;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Test-Hooks. */
export function __setE2sMidiAccessProviderForTests(
  p: MidiAccessProvider
): void {
  _accessProvider = p;
}
export function __resetE2sDeviceForTests(): void {
  _bridge?.detach();
  _bridge = null;
  _state = defaultState();
  notify();
}

// ─── React Hook ────────────────────────────────────────────────────────────────
export interface E2sDeviceStoreApi extends E2sDeviceState {
  connect: (midiAccess?: MIDIAccess, nameMatch?: string) => Promise<boolean>;
  disconnect: () => void;
  pullCurrent: () => Promise<PatternSummary | null>;
  pull: (n: number) => Promise<PatternSummary | null>;
}

export function useE2sDeviceStore(): E2sDeviceStoreApi {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    _listeners.add(rerender);
    return () => {
      _listeners.delete(rerender);
    };
  }, []);
  return {
    ..._state,
    connect: connectE2sDevice,
    disconnect: disconnectE2sDevice,
    pullCurrent: pullE2sCurrentPattern,
    pull: pullE2sPattern,
  };
}
