/**
 * nativeMidiAccess.ts — Synth.md #11
 *
 * Brückt den nativen RtMidi-Layer (electron/midi-native.ts, via IPC-Bridge) auf
 * die Interfaces, die die bestehenden Web-MIDI-Consumer erwarten — OHNE deren
 * Protokoll-Code zu ändern:
 *
 *   - D2 (useMidi / generische Geräte): `createNativeMidiAccess()` liefert ein
 *     `MIDIAccess`-ähnliches Objekt (echte Maps, settable `onstatechange`),
 *     das useMidi.enable() statt navigator.requestMIDIAccess() verwenden kann.
 *   - D1 (OmniTribe): `connectOmniTribeNative()` öffnet die per Namens-Pattern
 *     gematchten In/Out-Ports und liefert einen `WsTransport`-Adapter für
 *     OmniTribeBridge.connectWebSocket() — identisches Wire-Protokoll.
 *
 * Kern ist `NativeMidiManager`: er kapselt Enumerate/Open/Send/Close + das
 * Routing des globalen `midi:message`-Events auf die jeweils geöffneten
 * Handles. Die Bridge wird injiziert → Routing/Lifecycle sind ohne Electron
 * unit-testbar.
 *
 * Sicherheits-/Robustheits-Annahmen (siehe Advisor-Review):
 *   - `send()` ist fire-and-forget: electron.sendMidi liefert ein Promise, das
 *     im Adapter NICHT awaited wird (Web-MIDI send() ist synchron). Reihenfolge
 *     reitet auf IPC-FIFO.
 *   - Kein Hotplug: RtMidi liefert keinen statechange. `onstatechange` ist ein
 *     settable No-op; Geräte müssen vor enable() existieren.
 *   - Teardown ist Pflicht: Windows-MIDI-Inputs sind exklusiv — geleakte
 *     Handles blockieren den nächsten Open. `closeAll()` schließt + entkoppelt.
 */

// ─── Bridge-Interface (Subset von ElectronAPI) ──────────────────────────────

export interface NativeMidiPort { index: number; name: string; }

export interface NativeMidiBridgeResult {
  success: boolean;
  error?: string;
  handle?: string;
  inputs?: NativeMidiPort[];
  outputs?: NativeMidiPort[];
}

export interface NativeMidiMessage {
  handle: string;
  bytes: number[];
  deltaTime: number;
}

/** Das injizierbare Subset von `useElectron()`/ElectronAPI für nativen MIDI-I/O. */
export interface NativeMidiBridge {
  listMidiPorts(): Promise<NativeMidiBridgeResult>;
  openMidiInput(portIndex: number): Promise<NativeMidiBridgeResult>;
  openMidiOutput(portIndex: number): Promise<NativeMidiBridgeResult>;
  sendMidi(handle: string, bytes: number[]): Promise<{ success: boolean; error?: string }>;
  closeMidiPort(handle: string): Promise<{ success: boolean; error?: string }>;
  onMidiMessage(cb: (msg: NativeMidiMessage) => void): () => void;
}

// ─── Manager: Enumerate / Open / Send / Close + Message-Routing ──────────────

type MessageRoute = (bytes: number[], deltaTime: number) => void;

export class NativeMidiManager {
  private unsub: (() => void) | null = null;
  private routes = new Map<string, MessageRoute>();
  private openHandles = new Set<string>();

  constructor(private bridge: NativeMidiBridge) {}

  async listPorts(): Promise<{ inputs: NativeMidiPort[]; outputs: NativeMidiPort[]; error?: string }> {
    const r = await this.bridge.listMidiPorts();
    if (!r.success) return { inputs: [], outputs: [], error: r.error };
    return { inputs: r.inputs ?? [], outputs: r.outputs ?? [] };
  }

  /** Abonniert das globale midi:message-Event genau einmal. */
  private ensureSubscribed(): void {
    if (this.unsub) return;
    this.unsub = this.bridge.onMidiMessage((msg) => {
      this.routes.get(msg.handle)?.(msg.bytes, msg.deltaTime);
    });
  }

  /** Öffnet einen Input-Port und routet dessen Messages an `cb`. Liefert Handle oder null. */
  async openInput(portIndex: number, cb: MessageRoute): Promise<string | null> {
    const r = await this.bridge.openMidiInput(portIndex);
    if (!r.success || !r.handle) return null;
    this.ensureSubscribed();
    this.routes.set(r.handle, cb);
    this.openHandles.add(r.handle);
    return r.handle;
  }

  /** Öffnet einen Output-Port. Liefert Handle oder null. */
  async openOutput(portIndex: number): Promise<string | null> {
    const r = await this.bridge.openMidiOutput(portIndex);
    if (!r.success || !r.handle) return null;
    this.openHandles.add(r.handle);
    return r.handle;
  }

  /** Ändert das Routing-Ziel eines bereits offenen Input-Handles. */
  setRoute(handle: string, cb: MessageRoute | null): void {
    if (cb) this.routes.set(handle, cb);
    else this.routes.delete(handle);
  }

  /**
   * Fire-and-forget-Send: konvertiert auf number[] und sendet ohne await
   * (Web-MIDI-send-Semantik). Fehler werden geschluckt (Gerät kann während
   * des Sends entkoppelt werden).
   */
  send(handle: string, bytes: number[] | Uint8Array): void {
    const arr = Array.from(bytes);
    void this.bridge.sendMidi(handle, arr).catch(() => { /* device gone */ });
  }

  isOpen(handle: string): boolean {
    return this.openHandles.has(handle);
  }

  get openHandleCount(): number {
    return this.openHandles.size;
  }

  /** Schließt einen einzelnen Handle + entfernt sein Routing. */
  async close(handle: string): Promise<void> {
    if (!this.openHandles.has(handle)) return;
    this.routes.delete(handle);
    this.openHandles.delete(handle);
    try { await this.bridge.closeMidiPort(handle); } catch { /* schon zu */ }
  }

  /**
   * Schließt ALLE offenen Handles + entkoppelt den Message-Listener.
   * PFLICHT bei Backend-Wechsel/Disconnect (Windows-Exklusivität).
   */
  async closeAll(): Promise<void> {
    const handles = Array.from(this.openHandles);
    this.routes.clear();
    this.openHandles.clear();
    for (const h of handles) {
      try { await this.bridge.closeMidiPort(h); } catch { /* ignore */ }
    }
    if (this.unsub) { this.unsub(); this.unsub = null; }
  }
}

// ─── D2: MIDIAccess-ähnlicher Shim für useMidi ──────────────────────────────

/** Subset von MIDIInput, das useMidi liest (refreshDevices + connectDevice). */
export interface NativeMidiInput {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
  type: "input";
  onmidimessage: ((event: { data: Uint8Array }) => void) | null;
}

/** Subset von MIDIOutput, das useMidi/midiOutput.ts liest. */
export interface NativeMidiOutput {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
  type: "output";
  send(data: number[] | Uint8Array, timestamp?: number): void;
}

export interface NativeMidiAccess {
  inputs: Map<string, NativeMidiInput>;
  outputs: Map<string, NativeMidiOutput>;
  onstatechange: ((event: unknown) => void) | null;
  /** Manager für Teardown (closeAll) — nicht Teil des echten MIDIAccess. */
  readonly __manager: NativeMidiManager;
}

/**
 * Baut ein MIDIAccess-ähnliches Objekt über dem nativen Layer auf: enumeriert,
 * öffnet ALLE In/Out-Ports und legt echte Maps (key = Handle, z.B. "in:0") an.
 *
 * Jeder Input routet seine Messages an das jeweils zugewiesene `onmidimessage`
 * — exakt wie ein Web-MIDI-Input. Liefert null, wenn der native Layer nicht
 * verfügbar ist (Browser/keine Binary), damit der Caller auf Web-MIDI
 * zurückfällt.
 */
export async function createNativeMidiAccess(
  bridge: NativeMidiBridge,
): Promise<NativeMidiAccess | null> {
  const manager = new NativeMidiManager(bridge);
  const ports = await manager.listPorts();
  if (ports.error) return null;

  const inputs = new Map<string, NativeMidiInput>();
  const outputs = new Map<string, NativeMidiOutput>();

  for (const p of ports.inputs) {
    const node: NativeMidiInput = {
      id: "", // wird nach Open auf den Handle gesetzt
      name: p.name,
      manufacturer: "",
      state: "connected",
      type: "input",
      onmidimessage: null,
    };
    const handle = await manager.openInput(p.index, (bytes) => {
      node.onmidimessage?.({ data: Uint8Array.from(bytes) });
    });
    if (!handle) continue; // Port belegt/exklusiv → überspringen
    node.id = handle;
    inputs.set(handle, node);
  }

  for (const p of ports.outputs) {
    const handle = await manager.openOutput(p.index);
    if (!handle) continue;
    const node: NativeMidiOutput = {
      id: handle,
      name: p.name,
      manufacturer: "",
      state: "connected",
      type: "output",
      send: (data) => manager.send(handle, data),
    };
    outputs.set(handle, node);
  }

  return { inputs, outputs, onstatechange: null, __manager: manager };
}

// ─── D1: OmniTribe nativer WsTransport-Adapter ──────────────────────────────

/**
 * Default-Namens-Patterns für KORG/OmniTribe-Geräte (aus OmniTribeBridge +
 * KORG-Bank-Logik). Lowercase-substring-Match.
 */
export const OMNITRIBE_PORT_PATTERNS = [
  "omnitribe", "electribe", "esx", "korg",
  "es-1", "es-2", "es-9", "nu:tekt", "nts",
] as const;

function matchPort(name: string, patterns: readonly string[]): boolean {
  const n = name.toLowerCase();
  return patterns.some((p) => n.includes(p));
}

/** Subset von WsTransport (siehe OmniTribeBridge.ts) — hier dupliziert, um
 *  Audio-Engine-Import in dieser Util zu vermeiden. */
export interface NativeWsTransport {
  send(data: Uint8Array): void;
  close(): void;
  onmessage?: ((data: Uint8Array) => void) | null;
  onclose?: (() => void) | null;
}

export interface OmniTribeNativeConnection {
  transport: NativeWsTransport;
  manager: NativeMidiManager;
  inHandle: string;
  outHandle: string;
  inName: string;
  outName: string;
}

/**
 * Sucht per Namens-Pattern ein OmniTribe/KORG-In+Out-Paar, öffnet BEIDE und
 * baut einen WsTransport-Adapter für `OmniTribeBridge.connectWebSocket()`.
 *
 * WICHTIG (Advisor): öffnet und bestätigt BEIDE Handles, BEVOR der Adapter
 * gebaut wird — connectWebSocket feuert sofort requestIdentity(), und ein
 * nicht wirklich geöffneter Output würde dieses SysEx still verschlucken.
 *
 * @returns null wenn nativer Layer nicht verfügbar, kein Match, oder ein
 *          Port-Open fehlschlägt (Caller fällt dann auf Web-MIDI zurück).
 */
export async function connectOmniTribeNative(
  bridge: NativeMidiBridge,
  patterns: readonly string[] = OMNITRIBE_PORT_PATTERNS,
): Promise<OmniTribeNativeConnection | null> {
  const manager = new NativeMidiManager(bridge);
  const ports = await manager.listPorts();
  if (ports.error) return null;

  const inPort = ports.inputs.find((p) => matchPort(p.name, patterns));
  const outPort = ports.outputs.find((p) => matchPort(p.name, patterns));
  if (!inPort || !outPort) return null;

  // Output ZUERST öffnen — er muss garantiert offen sein, bevor connectWebSocket
  // requestIdentity() sendet.
  const outHandle = await manager.openOutput(outPort.index);
  if (!outHandle) return null;

  const transport: NativeWsTransport = {
    send: (data) => manager.send(outHandle, data),
    close: () => { void manager.closeAll(); },
    onmessage: null,
    onclose: null,
  };

  const inHandle = await manager.openInput(inPort.index, (bytes) => {
    transport.onmessage?.(Uint8Array.from(bytes));
  });
  if (!inHandle) {
    // Input-Open fehlgeschlagen → Output wieder freigeben, sonst Leak.
    await manager.closeAll();
    return null;
  }

  return {
    transport, manager,
    inHandle, outHandle,
    inName: inPort.name, outName: outPort.name,
  };
}
