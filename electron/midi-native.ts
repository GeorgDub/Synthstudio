/**
 * electron/midi-native.ts — Nativer MIDI-Layer (Electron Main).
 *
 * Synth.md #11: nativer MIDI-I/O für robustes SysEx (Reliability) als Ergänzung
 * zum Web-MIDI-Pfad (der im Browser-Build Fallback bleibt). Backed by
 * `@julusian/midi` (RtMidi, N-API → ABI-stabil über Electron-Versionen;
 * Packaging in Spike 1+2 verifiziert: lädt im gepackten Win-Build).
 *
 * Sicherheit: der Renderer ist nicht vertrauenswürdig. Nicht-serialisierbare
 * Port-Objekte bleiben hier im Main; der Renderer hält nur Opaque-String-Handles.
 * Jede IPC-Payload wird VOR dem nativen Call in main.ts via ipcValidators
 * geprüft (bytes 0..255 + Längen-Cap, portIndex-Bounds, handle in der Map).
 *
 * Lazy `require` in try/catch — fehlt die native Binary, liefert `available:false`
 * und der Renderer fällt sauber auf Web-MIDI zurück (KEIN Crash). Das Modul ist
 * für Tests injizierbar (`__setMidiModuleForTests`).
 */

// ─── Native-Lib-Typen (Subset von @julusian/midi) ───────────────────────────

interface RtInput {
  getPortCount(): number;
  getPortName(index: number): string;
  openPort(index: number): void;
  closePort(): void;
  /** sysex=false → SysEx NICHT ignorieren (für OmniTribe/Identity nötig). */
  ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
  on(
    event: "message",
    cb: (deltaTime: number, message: number[]) => void
  ): void;
}
interface RtOutput {
  getPortCount(): number;
  getPortName(index: number): string;
  openPort(index: number): void;
  closePort(): void;
  sendMessage(bytes: number[]): void;
}
export interface MidiModule {
  Input: new () => RtInput;
  Output: new () => RtOutput;
}

// ─── Modul-Lade-Layer (lazy + injizierbar) ──────────────────────────────────

let _mod: MidiModule | null = null;
let _loadError: string | null = null;
let _injected = false;

/** Test-Hook: ersetzt die native Lib durch einen Fake. */
export function __setMidiModuleForTests(mod: MidiModule | null): void {
  _mod = mod;
  _loadError = null;
  _injected = mod !== null;
  closeAllMidi();
}

export function loadNativeMidi(): { ok: boolean; error?: string } {
  if (_mod) return { ok: true };
  if (_loadError) return { ok: false, error: _loadError };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _mod = require("@julusian/midi") as MidiModule;
    return { ok: true };
  } catch (e) {
    _loadError = e instanceof Error ? e.message : String(e);
    return { ok: false, error: _loadError };
  }
}

// ─── Event-Emitter (Main → Renderer) ────────────────────────────────────────

export type MidiEmit = (channel: string, payload: unknown) => void;
let _emit: MidiEmit | null = null;

/** main.ts setzt hier den Sender (mainWindow.webContents.send). */
export function setMidiEmitter(emit: MidiEmit | null): void {
  _emit = emit;
}

// ─── Port-Handle-Verwaltung ─────────────────────────────────────────────────

interface OpenInput {
  kind: "input";
  port: RtInput;
}
interface OpenOutput {
  kind: "output";
  port: RtOutput;
}
type OpenPort = OpenInput | OpenOutput;

const _ports = new Map<string, OpenPort>();

function makeHandle(kind: "in" | "out", index: number): string {
  return `${kind}:${index}`;
}

export interface PortInfo {
  index: number;
  name: string;
}
export interface MidiPorts {
  inputs: PortInfo[];
  outputs: PortInfo[];
}

function enumerate(): MidiPorts {
  if (!_mod) return { inputs: [], outputs: [] };
  const i = new _mod.Input();
  const o = new _mod.Output();
  const inputs: PortInfo[] = [];
  for (let k = 0; k < i.getPortCount(); k++)
    inputs.push({ index: k, name: i.getPortName(k) });
  const outputs: PortInfo[] = [];
  for (let k = 0; k < o.getPortCount(); k++)
    outputs.push({ index: k, name: o.getPortName(k) });
  // Enumerations-Ports sofort schließen — nur die geöffneten Handles bleiben.
  try {
    i.closePort();
  } catch {
    /* nicht geöffnet */
  }
  try {
    o.closePort();
  } catch {
    /* nicht geöffnet */
  }
  return { inputs, outputs };
}

export interface MidiResult {
  success: boolean;
  error?: string;
}

export function listMidiPorts(): MidiResult & Partial<MidiPorts> {
  const load = loadNativeMidi();
  if (!load.ok || !_mod)
    return { success: false, error: load.error ?? "MIDI nicht verfügbar" };
  try {
    return { success: true, ...enumerate() };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface MidiStatus {
  available: boolean;
  injected: boolean;
  openInputs: number;
  openOutputs: number;
  /** Virtuelle Ports nur mac/linux (RtMidi); auf Windows false. */
  virtualPortsSupported: boolean;
}

export function getMidiStatus(): MidiStatus {
  const available = _injected || loadNativeMidi().ok;
  let openIn = 0,
    openOut = 0;
  for (const p of _ports.values()) p.kind === "input" ? openIn++ : openOut++;
  return {
    available,
    injected: _injected,
    openInputs: openIn,
    openOutputs: openOut,
    virtualPortsSupported: process.platform !== "win32",
  };
}

export function openMidiInput(
  portIndex: number
): MidiResult & { handle?: string } {
  const load = loadNativeMidi();
  if (!load.ok || !_mod)
    return { success: false, error: load.error ?? "MIDI nicht verfügbar" };
  const handle = makeHandle("in", portIndex);
  if (_ports.has(handle)) return { success: true, handle };
  try {
    const input = new _mod.Input();
    if (portIndex < 0 || portIndex >= input.getPortCount()) {
      // Native RtMidi-Instanz sofort freigeben statt auf GC-Finalizer zu warten
      // (sonst akkumulieren wiederholte Out-of-Range-Opens native Handles).
      try {
        input.closePort();
      } catch {
        /* nicht geöffnet */
      }
      return { success: false, error: `Ungültiger Input-Port ${portIndex}` };
    }
    // ignoreTypes(sysex, timing, activeSensing):
    //  - SysEx NICHT ignorieren (RtMidi ignoriert es per Default!) — für
    //    OmniTribe/KORG-Identity/Param-Sync zwingend.
    //  - Timing (MIDI-Clock 0xF8) NICHT ignorieren — nötig, damit ein externes
    //    Gerät (z.B. Electribe 2) als Clock-Master das Tempo an SynthStudio
    //    geben kann. Last ist gering: 24 PPQN ⇒ ~48 msg/s bei 120 BPM pro Gerät,
    //    selbst mit mehreren Geräten unkritisch für webContents.send.
    //  - Active-Sensing (0xFE) WEITER ignorieren: reines Keep-Alive-Rauschen
    //    (~alle 300 ms), kein Consumer braucht es.
    input.ignoreTypes(false, false, true);
    input.on("message", (deltaTime, message) => {
      _emit?.("midi:message", { handle, bytes: message, deltaTime });
    });
    input.openPort(portIndex);
    _ports.set(handle, { kind: "input", port: input });
    return { success: true, handle };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function openMidiOutput(
  portIndex: number
): MidiResult & { handle?: string } {
  const load = loadNativeMidi();
  if (!load.ok || !_mod)
    return { success: false, error: load.error ?? "MIDI nicht verfügbar" };
  const handle = makeHandle("out", portIndex);
  if (_ports.has(handle)) return { success: true, handle };
  try {
    const output = new _mod.Output();
    if (portIndex < 0 || portIndex >= output.getPortCount()) {
      // Native RtMidi-Instanz sofort freigeben (siehe openMidiInput).
      try {
        output.closePort();
      } catch {
        /* nicht geöffnet */
      }
      return { success: false, error: `Ungültiger Output-Port ${portIndex}` };
    }
    output.openPort(portIndex);
    _ports.set(handle, { kind: "output", port: output });
    return { success: true, handle };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function sendMidi(handle: string, bytes: number[]): MidiResult {
  const entry = _ports.get(handle);
  if (!entry) return { success: false, error: `Unbekanntes Handle ${handle}` };
  if (entry.kind !== "output")
    return { success: false, error: `Handle ${handle} ist kein Output` };
  try {
    entry.port.sendMessage(bytes);
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function closeMidiPort(handle: string): MidiResult {
  const entry = _ports.get(handle);
  if (!entry) return { success: true };
  try {
    entry.port.closePort();
  } catch {
    /* schon zu */
  }
  _ports.delete(handle);
  return { success: true };
}

export function closeAllMidi(): void {
  for (const entry of _ports.values()) {
    try {
      entry.port.closePort();
    } catch {
      /* ignore */
    }
  }
  _ports.clear();
}

/** Test-Helper: Anzahl offener Ports. */
export function __openPortCountForTests(): number {
  return _ports.size;
}
