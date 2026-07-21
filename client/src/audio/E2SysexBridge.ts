/**
 * E2SysexBridge.ts — Host-Session-Ebene für das native Korg-E2/E2S-SysEx.
 *
 * Setzt auf den reinen Frame-Buildern/Parsern in `utils/korg/e2Sysex.ts` auf und
 * ergänzt das, was ein echtes Gerät braucht: Request/Response-Korrelation,
 * Timeouts, ACK-Warten und einen Sequencer-Stop-Guard beim Schreiben.
 *
 * Abgrenzung: das ist die *Korg-native* Schicht (0x42) zum Reden mit einem
 * echten E2/E2S — Stock oder hacktribe. NICHT das OmniTribe-OTP (0x7D,
 * OmniTribeBridge.ts). Beide Bridges können parallel existieren.
 *
 * Transport-agnostisch (wie WsTransport in OmniTribeBridge): die Session nimmt
 * ein `E2Transport` und ist damit ohne Web-MIDI in Node unit-testbar. Ein
 * Web-MIDI-Adapter (`connectWebMidi`) ist als dünne Hülle dabei.
 */
import {
  E2Model,
  buildSearchRequest,
  buildCurrentPatternDumpRequest,
  buildPatternDumpRequest,
  buildGlobalDumpRequest,
  buildCurrentPatternDump,
  buildPatternDump,
  buildGlobalDump,
  buildReadCpuRamRequest,
  buildSetWriteAddrRequest,
  buildWriteCpuRamData,
  parseSysex,
  summarizePatternBody,
  isWritablePresetRam,
  ifxPresetAddr,
  groovePresetAddr,
  IFX_STRIDE,
  IFX_MAX,
  IFX_COUNT_ADDR,
  GROOVE_STRIDE,
  GROOVE_MAX,
  GROOVE_COUNT_ADDR,
  CPU_RAM_WRITE_CHUNK,
  type E2SysexParsed,
  type PatternSummary,
} from "../utils/korg/e2Sysex";
import {
  buildFxEdit,
  buildFxControlMap,
  MFX_FX_SLOT,
} from "../utils/korg/e2Nrpn";
import {
  fxEditBufferAddr,
  decodeFxEditBuffer,
  FX_EDIT_BUFFER_STRIDE,
  type FxEditBuffer,
} from "../utils/korg/e2FxParams";

// ─── Transport ───────────────────────────────────────────────────────────────
export interface E2Transport {
  send(data: Uint8Array): void;
  onmessage?: ((data: Uint8Array) => void) | null;
  close?(): void;
}

export interface E2Identity {
  globalChannel: number;
  model: number;
  versionMajor: number;
  versionMinor: number;
}

export interface E2BridgeOptions {
  model?: E2Model;
  globalChannel?: number;
  /** Timeout pro Request in ms (Default 3000). */
  timeoutMs?: number;
  /**
   * Max. Bytes pro Transport-`send()`. 0 = ganzen Frame in einem send() (Default,
   * korrekt für Web-MIDI). >0 splittet für Transporte mit kleinem Puffer
   * (RtMidi/amidi-Stil, siehe korg_e2_native_sysex.md §7).
   */
  maxChunkBytes?: number;
  /** Liefert true, wenn der Gerät-Sequencer läuft → Schreib-Requests werden geblockt. */
  isPlaying?: () => boolean;
}

/**
 * Zerlegt einen Byte-Puffer in Stücke von max. `maxBytes`. `maxBytes <= 0`
 * liefert den Puffer als ein einziges Stück (kein Chunking). Rein & getestet.
 */
export function chunkBytes(bytes: Uint8Array, maxBytes: number): Uint8Array[] {
  if (maxBytes <= 0 || bytes.length <= maxBytes) return [bytes];
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += maxBytes) {
    out.push(bytes.subarray(i, Math.min(i + maxBytes, bytes.length)));
  }
  return out;
}

export class E2SysexError extends Error {}
/** Fehler, wenn ein Schreib-Request bei laufendem Sequencer versucht wird. */
export class E2SequencerRunningError extends E2SysexError {
  constructor() {
    super("E2 sequencer is running — stop it before writing patterns/globals");
  }
}

interface Waiter {
  match: (p: E2SysexParsed) => boolean;
  resolve: (p: E2SysexParsed) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class E2SysexBridge {
  private transport: E2Transport | null = null;
  private waiters: Waiter[] = [];
  private readonly opts: Required<Omit<E2BridgeOptions, "isPlaying">> & {
    isPlaying?: () => boolean;
  };

  constructor(options: E2BridgeOptions = {}) {
    this.opts = {
      model: options.model ?? E2Model.SAMPLER,
      globalChannel: options.globalChannel ?? 0,
      timeoutMs: options.timeoutMs ?? 3000,
      maxChunkBytes: options.maxChunkBytes ?? 0,
      isPlaying: options.isPlaying,
    };
  }

  /** Bindet einen Transport an und routet dessen Nachrichten in die Session. */
  attach(transport: E2Transport): void {
    this.transport = transport;
    transport.onmessage = (data: Uint8Array) => this.handleIncoming(data);
  }

  /** Löst den Transport, verwirft offene Waiter (mit Reject) und schließt ggf. */
  detach(): void {
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new E2SysexError("bridge detached"));
    }
    this.waiters = [];
    if (this.transport) {
      this.transport.onmessage = null;
      try {
        this.transport.close?.();
      } catch {
        /* ignore */
      }
      this.transport = null;
    }
  }

  get isConnected(): boolean {
    return this.transport !== null;
  }

  /** Verarbeitet eingehende SysEx: parsen → ersten passenden Waiter auflösen. */
  handleIncoming(data: Uint8Array): void {
    const parsed = parseSysex(data);
    if (!parsed) return;
    const idx = this.waiters.findIndex(w => w.match(parsed));
    if (idx === -1) return;
    const [w] = this.waiters.splice(idx, 1);
    clearTimeout(w.timer);
    w.resolve(parsed);
  }

  private frameOpts() {
    return { model: this.opts.model, globalChannel: this.opts.globalChannel };
  }

  private sendFrame(frame: Uint8Array): void {
    if (!this.transport) throw new E2SysexError("no transport attached");
    for (const chunk of chunkBytes(frame, this.opts.maxChunkBytes)) {
      this.transport.send(chunk);
    }
  }

  private waitFor(
    match: (p: E2SysexParsed) => boolean,
    label: string
  ): Promise<E2SysexParsed> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex(w => w.timer === timer);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(
          new E2SysexError(
            `timeout waiting for ${label} (${this.opts.timeoutMs}ms)`
          )
        );
      }, this.opts.timeoutMs);
      this.waiters.push({ match, resolve, reject, timer });
    });
  }

  // ─── Identity-Handshake ─────────────────────────────────────────────────────
  /** Sendet Search-Request und wartet auf die Identity-Antwort. */
  async identify(): Promise<E2Identity> {
    const p = this.waitFor(x => x.kind === "identity", "identity");
    this.sendFrame(buildSearchRequest());
    const r = await p;
    if (r.kind !== "identity") throw new E2SysexError("unexpected reply");
    return {
      globalChannel: r.globalChannel,
      model: r.model,
      versionMajor: r.versionMajor,
      versionMinor: r.versionMinor,
    };
  }

  // ─── Pattern-Pull ────────────────────────────────────────────────────────────
  /** Holt den Edit-Buffer (Current Pattern) → dekodierter Roh-Body. */
  async pullCurrentPattern(): Promise<Uint8Array> {
    const p = this.waitFor(
      x => x.kind === "currentPattern" || x.kind === "nak",
      "current pattern"
    );
    this.sendFrame(buildCurrentPatternDumpRequest(this.frameOpts()));
    const r = await p;
    if (r.kind === "nak")
      throw new E2SysexError("device returned DATA LOAD ERROR");
    if (r.kind !== "currentPattern") throw new E2SysexError("unexpected reply");
    return r.body;
  }

  /** Holt ein nummeriertes Pattern (0–249) → dekodierter Roh-Body. */
  async pullPattern(patternNumber: number): Promise<Uint8Array> {
    const p = this.waitFor(
      x =>
        (x.kind === "pattern" && x.patternNumber === patternNumber) ||
        x.kind === "nak",
      `pattern ${patternNumber}`
    );
    this.sendFrame(buildPatternDumpRequest(patternNumber, this.frameOpts()));
    const r = await p;
    if (r.kind === "nak")
      throw new E2SysexError("device returned DATA LOAD ERROR");
    if (r.kind !== "pattern") throw new E2SysexError("unexpected reply");
    return r.body;
  }

  /** Convenience: Pattern pullen + sichere Zusammenfassung (Name + OSC-Refs). */
  async pullPatternSummary(patternNumber: number): Promise<PatternSummary> {
    return summarizePatternBody(await this.pullPattern(patternNumber));
  }

  /** Holt die Global-Data → dekodierter Roh-Body. */
  async pullGlobal(): Promise<Uint8Array> {
    const p = this.waitFor(
      x => x.kind === "global" || x.kind === "nak",
      "global data"
    );
    this.sendFrame(buildGlobalDumpRequest(this.frameOpts()));
    const r = await p;
    if (r.kind === "nak")
      throw new E2SysexError("device returned DATA LOAD ERROR");
    if (r.kind !== "global") throw new E2SysexError("unexpected reply");
    return r.body;
  }

  // ─── Pattern-Push (mit Sequencer-Stop-Guard + ACK-Wait) ──────────────────────
  private guardWrite(): void {
    if (this.opts.isPlaying?.()) throw new E2SequencerRunningError();
  }

  /** Schreibt einen Roh-Body in den Edit-Buffer. Wartet auf ACK/NAK. */
  async pushCurrentPattern(body: Uint8Array): Promise<void> {
    this.guardWrite();
    const p = this.waitFor(
      x => x.kind === "ack" || x.kind === "nak",
      "ACK (current pattern)"
    );
    this.sendFrame(buildCurrentPatternDump(body, this.frameOpts()));
    if ((await p).kind === "nak")
      throw new E2SysexError("device rejected current-pattern write");
  }

  /** Schreibt einen Roh-Body in einen nummerierten Slot (0–249). Wartet auf ACK/NAK. */
  async pushPattern(patternNumber: number, body: Uint8Array): Promise<void> {
    this.guardWrite();
    const p = this.waitFor(
      x => x.kind === "ack" || x.kind === "nak",
      `ACK (pattern ${patternNumber})`
    );
    this.sendFrame(buildPatternDump(patternNumber, body, this.frameOpts()));
    if ((await p).kind === "nak")
      throw new E2SysexError(`device rejected pattern ${patternNumber} write`);
  }

  /** Schreibt Global-Data zurück. Wartet auf ACK/NAK. */
  async pushGlobal(body: Uint8Array): Promise<void> {
    this.guardWrite();
    const p = this.waitFor(
      x => x.kind === "ack" || x.kind === "nak",
      "ACK (global)"
    );
    this.sendFrame(buildGlobalDump(body, this.frameOpts()));
    if ((await p).kind === "nak")
      throw new E2SysexError("device rejected global write");
  }

  // ─── CPU-RAM Read/Write (hacktribe) + IFX/Groove-Presets ────────────────────
  /**
   * Liest `len` Bytes CPU-RAM ab `addr` (hacktribe 0x52). Nur lesen → risikofrei.
   * @returns exakt `len` Bytes (dekodiert).
   */
  async readCpuRam(addr: number, len: number): Promise<Uint8Array> {
    const p = this.waitFor(
      x => x.kind === "cpuRamData",
      `CPU RAM @0x${addr.toString(16)}`
    );
    this.sendFrame(buildReadCpuRamRequest(addr, len, this.frameOpts()));
    const r = await p;
    if (r.kind !== "cpuRamData") throw new E2SysexError("unexpected reply");
    return r.data.subarray(0, len);
  }

  /**
   * Schreibt `data` nach CPU-RAM ab `addr` (hacktribe 0x53→0x54, in ≤0x100-Chunks
   * wie set_ifx). **Guard:** nur in die IFX-/Groove-Preset-Bereiche — verhindert
   * arbiträre RAM-Writes aus dem UI. Sequencer-Stop-Guard greift ebenfalls.
   */
  async writeCpuRam(addr: number, data: Uint8Array): Promise<void> {
    this.guardWrite();
    if (!isWritablePresetRam(addr, data.length)) {
      throw new E2SysexError(
        `refusing CPU-RAM write outside IFX/Groove preset range (0x${addr.toString(16)}+${data.length})`
      );
    }
    for (let off = 0; off < data.length; off += CPU_RAM_WRITE_CHUNK) {
      const chunk = data.subarray(
        off,
        Math.min(off + CPU_RAM_WRITE_CHUNK, data.length)
      );
      // 0x53 set addr+len, dann 0x54 data — nach jedem auf eine Geräte-Antwort warten.
      const ack1 = this.waitFor(() => true, "write set-addr ack");
      this.sendFrame(
        buildSetWriteAddrRequest(addr + off, chunk.length, this.frameOpts())
      );
      await ack1;
      const ack2 = this.waitFor(() => true, "write data ack");
      this.sendFrame(buildWriteCpuRamData(chunk, this.frameOpts()));
      const r = await ack2;
      if (r.kind === "nak")
        throw new E2SysexError("device rejected CPU-RAM write");
    }
  }

  /** Liest einen IFX-Preset-Slot (0..99) → 0x20C rohe Bytes. */
  async readIfxPreset(index: number): Promise<Uint8Array> {
    if (index < 0 || index >= IFX_MAX)
      throw new E2SysexError(`IFX index ${index} out of range`);
    return this.readCpuRam(ifxPresetAddr(index), IFX_STRIDE);
  }
  /** Schreibt rohe Bytes (0x20C) in einen IFX-Preset-Slot (0..99). */
  async writeIfxPreset(index: number, data: Uint8Array): Promise<void> {
    if (index < 0 || index >= IFX_MAX)
      throw new E2SysexError(`IFX index ${index} out of range`);
    if (data.length !== IFX_STRIDE)
      throw new E2SysexError(
        `IFX preset must be ${IFX_STRIDE} bytes, got ${data.length}`
      );
    return this.writeCpuRam(ifxPresetAddr(index), data);
  }
  /** Liest ein Groove-Template (0..127) → 0x140 rohe Bytes. */
  async readGrooveTemplate(index: number): Promise<Uint8Array> {
    if (index < 0 || index >= GROOVE_MAX)
      throw new E2SysexError(`Groove index ${index} out of range`);
    return this.readCpuRam(groovePresetAddr(index), GROOVE_STRIDE);
  }
  /** Schreibt rohe Bytes (0x140) in ein Groove-Template (0..127). */
  async writeGrooveTemplate(index: number, data: Uint8Array): Promise<void> {
    if (index < 0 || index >= GROOVE_MAX)
      throw new E2SysexError(`Groove index ${index} out of range`);
    if (data.length !== GROOVE_STRIDE)
      throw new E2SysexError(
        `Groove template must be ${GROOVE_STRIDE} bytes, got ${data.length}`
      );
    return this.writeCpuRam(groovePresetAddr(index), data);
  }
  /** Liest den aktuellen IFX-Preset-Zähler (1 Byte). */
  async readIfxCount(): Promise<number> {
    return (await this.readCpuRam(IFX_COUNT_ADDR, 1))[0] ?? 0;
  }
  /** Liest den aktuellen Groove-Template-Zähler (1 Byte). */
  async readGrooveCount(): Promise<number> {
    return (await this.readCpuRam(GROOVE_COUNT_ADDR, 1))[0] ?? 0;
  }

  // ─── NRPN (FX-Control, fire-and-forget — kein ACK) ──────────────────────────
  /** Sendet rohe MIDI-Bytes (z.B. NRPN-CCs) über den Transport. */
  sendRaw(bytes: Uint8Array): void {
    if (!this.transport) throw new E2SysexError("no transport attached");
    this.transport.send(bytes);
  }

  /** FX-Edit via NRPN: FX-Slot `fxSlot`, Parameter `paramIndex` → `value`. */
  sendFxEdit(fxSlot: number, paramIndex: number, value: number): void {
    this.sendRaw(
      buildFxEdit(this.opts.globalChannel, fxSlot, paramIndex, value)
    );
  }

  /** FX-Control-Map via NRPN. */
  sendFxControlMap(fxSlot: number, mapParamIndex: number, value: number): void {
    this.sendRaw(
      buildFxControlMap(this.opts.globalChannel, fxSlot, mapParamIndex, value)
    );
  }

  /**
   * Liest den Live-FX-Edit-Buffer eines Slots (hacktribe RAM, 0x72 B) und
   * dekodiert ihn (FX-Typ + aktuelle Param-Werte). MFX-Slot (0x20) nutzt die
   * MFX-Typ-Tabelle. Nur mit hacktribe-Firmware.
   */
  async readFxEditBuffer(fxSlot: number): Promise<FxEditBuffer> {
    const bytes = await this.readCpuRam(
      fxEditBufferAddr(fxSlot),
      FX_EDIT_BUFFER_STRIDE
    );
    return decodeFxEditBuffer(bytes, fxSlot === MFX_FX_SLOT);
  }

  // ─── Web-MIDI-Adapter ────────────────────────────────────────────────────────
  /**
   * Verbindet über Web-MIDI: sucht In/Out-Ports, deren Name `nameMatch` enthält
   * (Default "electribe"), bindet sie als Transport und macht den Identity-
   * Handshake. Liefert die Identity oder null, wenn keine Ports gefunden wurden.
   * MIDIAccess muss mit `{ sysex: true }` erzeugt sein.
   */
  async connectWebMidi(
    midiAccess: MIDIAccess,
    nameMatch = "electribe"
  ): Promise<E2Identity | null> {
    const needle = nameMatch.toLowerCase();
    let output: MIDIOutput | null = null;
    let input: MIDIInput | null = null;
    for (const o of midiAccess.outputs.values()) {
      if (o.name?.toLowerCase().includes(needle)) output = o;
    }
    for (const i of midiAccess.inputs.values()) {
      if (i.name?.toLowerCase().includes(needle)) input = i;
    }
    if (!output || !input) return null;

    const transport: E2Transport = {
      send: (data: Uint8Array) => output!.send(Array.from(data)),
      close: () => {
        input!.onmidimessage = null;
      },
    };
    input.onmidimessage = (e: MIDIMessageEvent) => {
      if (e.data) this.handleIncoming(e.data);
    };
    this.transport = transport;
    try {
      return await this.identify();
    } catch {
      // Ports offen lassen; Identity kann bei manchen Setups zeitlich verzögert sein.
      return null;
    }
  }
}
