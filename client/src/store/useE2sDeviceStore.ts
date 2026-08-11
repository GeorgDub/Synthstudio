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
  decodePatternBody,
  type PatternSummary,
  type E2PatternDecoded,
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
  /** Voll dekodierter Edit-Buffer (für Import in die DrumMachine). */
  currentDecoded: E2PatternDecoded | null;
  /** Roh-Body des zuletzt gepullten Edit-Buffers (für Feld-Editing + Push). */
  currentBody: Uint8Array | null;
  /** Voll dekodierte nummerierte Patterns, keyed by slot. */
  decoded: Record<number, E2PatternDecoded>;
  /** Zuletzt gelesene Global-Data (opaker Blob, dekodiert). */
  globalData: Uint8Array | null;
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
    currentDecoded: null,
    currentBody: null,
    decoded: {},
    globalData: null,
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

/** Die aktive Bridge (oder null) — für andere Stores wie useE2sPresetStore. */
export function getE2sBridge(): E2SysexBridge | null {
  return _state.status === "connected" ? _bridge : null;
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

/**
 * Holt einen Body und verlangt, dass ZWEI Lesungen übereinstimmen.
 *
 * ★ Am 2026-08-11 am Gerät gemessen: ein 18,7-KB-Dump kommt regelmässig mit
 * falscher Länge an — die Abweichung ist stets ein Vielfaches von 3, und ein
 * USB-MIDI-Paket trägt genau 3 Datenbytes. Es gehen einzelne USB-Pakete
 * verloren oder kommen doppelt an.
 *
 * ☠ Der Empfänger merkt davon nichts: alle Nutzbytes sind gültige 7-Bit-Werte,
 * es gibt keine Prüfsumme, und der Dekoder liefert klaglos ein verschobenes
 * Ergebnis. Das Pattern sieht danach plausibel aus — einzelne Parts ohne
 * Sample, seltsame Pegel. Genau die Meldung „die Sample-Zuweisungen fehlen
 * MANCHMAL komplett".
 *
 * Zwei übereinstimmende Lesungen sind die einzige Absicherung, die ohne
 * Prüfsumme möglich ist: dieselbe Verfälschung zweimal an derselben Stelle
 * ist unwahrscheinlich. Stimmen sie nie überein, ist das ein Befund und
 * keine Kleinigkeit — dann wird geworfen statt geraten.
 */
async function pullMitPruefung(
  lies: () => Promise<Uint8Array>,
  versuche = 4
): Promise<Uint8Array> {
  const gesehen: Uint8Array[] = [];
  for (let i = 0; i < versuche; i++) {
    const b = await lies();
    if (
      gesehen.some(
        alt => alt.length === b.length && alt.every((x, k) => x === b[k])
      )
    ) {
      return b;
    }
    gesehen.push(b);
  }
  throw new Error(
    `Der Dump kam in ${versuche} Lesungen nie zweimal gleich an — die ` +
      `USB-MIDI-Verbindung verliert Pakete. Andere Buchse/anderes Kabel ` +
      `probieren; ein einzeln gelesenes Pattern waere still verfaelscht.`
  );
}

/** Holt den Edit-Buffer (Current Pattern) und legt die Zusammenfassung ab. */
export async function pullE2sCurrentPattern(): Promise<PatternSummary | null> {
  if (!_bridge || _state.status !== "connected") return null;
  set({ busy: true, error: null });
  try {
    const bridge = _bridge;
    const body = await pullMitPruefung(() => bridge.pullCurrentPattern());
    const summary = summarizePatternBody(body);
    set({
      busy: false,
      currentPattern: summary,
      currentDecoded: decodePatternBody(body),
      currentBody: body,
    });
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
    const body = await _bridge.pullPattern(patternNumber);
    const summary = summarizePatternBody(body);
    set({
      busy: false,
      patterns: { ..._state.patterns, [patternNumber]: summary },
      decoded: { ..._state.decoded, [patternNumber]: decodePatternBody(body) },
    });
    return summary;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Schreibt einen Roh-Body in den Edit-Buffer des Geräts (0x40). Wartet auf ACK.
 * Body kommt vom Caller (synthstudioPatternToBody). Bei laufendem Geräte-
 * Sequencer antwortet das Gerät mit NAK → Fehler wird gemeldet.
 */
export async function pushE2sCurrentBody(body: Uint8Array): Promise<boolean> {
  if (!_bridge || _state.status !== "connected") {
    set({ error: "Kein Gerät verbunden" });
    return false;
  }
  set({ busy: true, error: null });
  try {
    await _bridge.pushCurrentPattern(body);
    set({ busy: false });
    return true;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** Schreibt einen Roh-Body in einen nummerierten Slot (0..249). Wartet auf ACK. */
export async function pushE2sBody(
  slot: number,
  body: Uint8Array
): Promise<boolean> {
  if (!_bridge || _state.status !== "connected") {
    set({ error: "Kein Gerät verbunden" });
    return false;
  }
  set({ busy: true, error: null });
  try {
    await _bridge.pushPattern(slot, body);
    set({ busy: false });
    return true;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/** Liest die Global-Data (opaker Blob) und legt sie ab. */
export async function pullE2sGlobal(): Promise<Uint8Array | null> {
  if (!_bridge || _state.status !== "connected") {
    set({ error: "Kein Gerät verbunden" });
    return null;
  }
  set({ busy: true, error: null });
  try {
    const body = await _bridge.pullGlobal();
    set({ busy: false, globalData: body });
    return body;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Schreibt einen Global-Data-Blob zurück (Round-Trip). Nur zuvor gelesene Bytes
 * verwenden — wir kennen das interne Feld-Layout nicht. Wartet auf ACK.
 */
export async function pushE2sGlobal(body: Uint8Array): Promise<boolean> {
  if (!_bridge || _state.status !== "connected") {
    set({ error: "Kein Gerät verbunden" });
    return false;
  }
  set({ busy: true, error: null });
  try {
    await _bridge.pushGlobal(body);
    set({ busy: false });
    return true;
  } catch (e) {
    set({ busy: false, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/**
 * FX-Edit via NRPN (fire-and-forget, kein ACK): setzt in FX-Slot `fxSlot` den
 * Parameter `paramIndex` auf `value` (0..127). Gibt false zurück, wenn nicht
 * verbunden. Kein busy/error-State — NRPN ist Realtime, nicht anfragebasiert.
 */
export function sendE2sFxParam(
  fxSlot: number,
  paramIndex: number,
  value: number
): boolean {
  if (!_bridge || _state.status !== "connected") return false;
  try {
    _bridge.sendFxEdit(fxSlot, paramIndex, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Liest den Live-FX-Edit-Buffer eines Slots (FX-Typ + aktuelle Param-Werte).
 * Null wenn nicht verbunden oder Lesefehler.
 */
export async function readE2sFxBuffer(fxSlot: number) {
  if (!_bridge || _state.status !== "connected") return null;
  try {
    return await _bridge.readFxEditBuffer(fxSlot);
  } catch {
    return null;
  }
}

/**
 * Konfiguriert einen kompletten FX-Control-Map-Slot via NRPN (fire-and-forget).
 * false, wenn nicht verbunden.
 */
export function sendE2sFxControlMapSlot(
  fxSlot: number,
  spec: import("../utils/korg/e2Nrpn").FxControlMapSlotSpec
): boolean {
  if (!_bridge || _state.status !== "connected") return false;
  try {
    _bridge.sendFxControlMapSlot(fxSlot, spec);
    return true;
  } catch {
    return false;
  }
}

/**
 * Legt einen editierten Roh-Body als aktuellen Edit-Buffer ab (nach Feld-Editing
 * über e2PatternEdit.ts) und re-dekodiert ihn für die UI. Schreibt NICHT ans
 * Gerät — dafür pushCurrent(body) mit demselben Body aufrufen.
 */
export function applyE2sCurrentBodyEdit(edited: Uint8Array): void {
  set({
    currentBody: edited,
    currentDecoded: decodePatternBody(edited),
    currentPattern: summarizePatternBody(edited),
  });
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
  pushCurrent: (body: Uint8Array) => Promise<boolean>;
  push: (slot: number, body: Uint8Array) => Promise<boolean>;
  pullGlobal: () => Promise<Uint8Array | null>;
  pushGlobal: (body: Uint8Array) => Promise<boolean>;
  sendFxParam: (fxSlot: number, paramIndex: number, value: number) => boolean;
  readFxBuffer: (
    fxSlot: number
  ) => Promise<import("../utils/korg/e2FxParams").FxEditBuffer | null>;
  sendFxControlMapSlot: (
    fxSlot: number,
    spec: import("../utils/korg/e2Nrpn").FxControlMapSlotSpec
  ) => boolean;
  applyCurrentBodyEdit: (edited: Uint8Array) => void;
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
    pushCurrent: pushE2sCurrentBody,
    push: pushE2sBody,
    pullGlobal: pullE2sGlobal,
    pushGlobal: pushE2sGlobal,
    sendFxParam: sendE2sFxParam,
    readFxBuffer: readE2sFxBuffer,
    sendFxControlMapSlot: sendE2sFxControlMapSlot,
    applyCurrentBodyEdit: applyE2sCurrentBodyEdit,
  };
}
