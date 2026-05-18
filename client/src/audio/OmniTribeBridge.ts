/**
 * OmniTribeBridge.ts — SynthStudio ↔ OmniTribe Bridge.
 *
 * SoT: G:/IdeaProjects/Omnitribe/host/synthstudio/OmniTribeBridge.ts
 * (v3.16.0 / Sprint Tag 1-2 — drop-in port from sibling repo)
 *
 * Spec: docs/midi/otp_protocol.md (im Omnitribe-Repo)
 * Mirror in Python: tools/midi/otp_codec.py (im Omnitribe-Repo)
 *
 * Diese Datei ist isomorph: läuft in Browser-Renderer und Electron-Renderer.
 * Web-MIDI muss durch Caller mit `{ sysex: true }` initialisiert sein.
 */

const OTP_SYSEX_START = 0xF0;
const OTP_SYSEX_END   = 0xF7;
const OTP_MFR_ID = [0x7D, 0x01, 0x02];

// ─── Command-IDs ─────────────────────────────────────────────
export const OtpCmd = {
  IDENTITY:       0x01,
  PARAM:          0x02,
  STATE_DUMP:     0x03,
  PATTERN:        0x04,
  SAMPLE:         0x05,
  WAVETABLE:      0x06,
  SONG:           0x07,
  STREAM:         0x08,
  FIRMWARE_INFO:  0x09,
  MIDI_LEARN:     0x0A,
  UNDO_REDO:      0x0B,
  ANALYSIS:       0x0C,
  PRESET:         0x0D,
  TRANSPORT:      0x0E,
} as const;

export const StreamFlag = {
  VU_METER:      1 << 0,
  SPECTRUM:      1 << 1,
  SEQ_STEP:      1 << 2,
  MIDI_ACTIVITY: 1 << 3,
  PARAM_NOTIFY:  1 << 4,
} as const;

export interface ParamChangeEvent {
  part: number;
  paramHigh: number;
  paramLow: number;
  value: number;
}

export interface VuMeterEvent {
  levels: number[];   // 16 × 0..127
}

export interface SpectrumEvent {
  bins: number[];     // 64 × 0..127
}

// ─── Helper: 7-bit Encoding (8-bit → MIDI-safe) ──────────────

export function encode7Bit(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const block = data.slice(i, i + 7);
    let header = 0;
    for (let j = 0; j < block.length; j++) {
      if (block[j] & 0x80) header |= 1 << j;
    }
    out.push(header & 0x7F);
    for (let j = 0; j < block.length; j++) {
      out.push(block[j] & 0x7F);
    }
  }
  return new Uint8Array(out);
}

export function decode7Bit(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const header = data[i++];
    for (let j = 0; j < 7 && i < data.length; j++) {
      let b = data[i++];
      if (header & (1 << j)) b |= 0x80;
      out.push(b);
    }
  }
  return new Uint8Array(out);
}

function xorChecksum(payload: number[] | Uint8Array): number {
  let chk = 0;
  for (let i = 0; i < payload.length; i++) chk ^= payload[i];
  return chk & 0x7F;
}

/** Klammert einen Integer auf [lo..hi] und floort. NaN/Infinity → lo. */
function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  const f = Math.floor(v);
  if (f < lo) return lo;
  if (f > hi) return hi;
  return f;
}

// ─── Frame-Builder ───────────────────────────────────────────

export function buildFrame(cmd: number, sub: number, payload: number[] | Uint8Array): Uint8Array {
  const len = payload.length;
  if (len > 0x3FFF) throw new Error(`Payload zu gross: ${len} > 16383`);
  const arr = [
    OTP_SYSEX_START,
    ...OTP_MFR_ID,
    cmd & 0x7F,
    sub & 0x7F,
    (len >> 7) & 0x7F,
    len & 0x7F,
    ...payload,
    xorChecksum(payload),
    OTP_SYSEX_END,
  ];
  return new Uint8Array(arr);
}

// ─── Bridge-Klasse ───────────────────────────────────────────

export type FrameHandler = (cmd: number, sub: number, payload: Uint8Array) => void;

// ─── Echo-Schutz-Konfiguration ───────────────────────────────
/**
 * Zeitfenster (ms) in dem nach einem setParam(...) eingehende
 * Param-Notify-Echos auf derselben Adresse verworfen werden. 50 ms
 * ist groesser als USB-MIDI-Round-Trip-Latenz (typ < 3 ms), klein
 * genug fuer echtes Encoder-Pickup ohne UI-Lag.
 */
const PENDING_SET_TTL_MS = 50;

/**
 * Monotone Zeitquelle.
 *
 * NB: Wir nutzen Date.now() statt performance.now() weil vi.useFakeTimers()
 * Date kontrolliert, performance.now() aber typischerweise NICHT. Die Bridge
 * verwendet ohnehin nur ms-Granularitaet (50ms Echo-Fenster) — der
 * Wall-Clock-Drift von Date.now() ist hier irrelevant.
 */
function nowMs(): number {
  return Date.now();
}

export class OmniTribeBridge {
  private output: MIDIOutput | null = null;
  private input: MIDIInput | null = null;
  private connected = false;
  private handlers: Map<number, FrameHandler[]> = new Map();
  /**
   * Echo-Vermeidung: vom Host via setParam gesetzte Params duerfen nicht
   * sofort danach als Notify zurueck-verarbeitet werden.
   *
   * v3.21.0-Refactor: Map<key, expiresAt:number> statt Set+setTimeout-Chain.
   * Vorher gewesen: jeder setParam plante einen eigenen setTimeout(50ms),
   * der den key wieder loescht. Bei einem Slider-Sweep (>50ms zwischen
   * erstem und zweitem Set) loescht der aelteste Timer den Eintrag, BEVOR
   * das 50 ms-Fenster des juengsten Sets abgelaufen ist — Echos sickern
   * fuer ~50ms nach jedem Sweep-Tick durch.
   *
   * Neu: bei jedem setParam wird expiresAt = now + 50ms gesetzt; alte
   * Eintraege werden lazy beim naechsten Zugriff (set OR Notify) per
   * sweepExpired() entfernt. Keine setTimeout-Spam.
   */
  private pendingSets = new Map<string, number>();
  private throttleQueue: Uint8Array[] = [];
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Verbindet zu OmniTribe via Web-MIDI. Liefert true bei Erfolg. */
  async connect(midiAccess: MIDIAccess): Promise<boolean> {
    for (const o of midiAccess.outputs.values()) {
      if (o.name?.toLowerCase().includes("omnitribe")) this.output = o;
    }
    for (const i of midiAccess.inputs.values()) {
      if (i.name?.toLowerCase().includes("omnitribe")) {
        this.input = i;
        this.input.onmidimessage = (e: MIDIMessageEvent) => {
          if (e.data) this.handleIncoming(e.data);
        };
      }
    }
    this.connected = !!(this.output && this.input);
    if (this.connected) {
      await this.requestIdentity();
    }
    return this.connected;
  }

  /** Trennt die Bridge — flusht pending Frames und cleant Listener. */
  disconnect(): void {
    if (this.input) {
      this.input.onmidimessage = null;
    }
    this.input = null;
    this.output = null;
    this.connected = false;
    this.throttleQueue = [];
    if (this.throttleTimer !== null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.pendingSets.clear();
    this.handlers.clear();
  }

  get isConnected(): boolean { return this.connected; }

  /** CMD 0x01 0x00: Identity Request — Antwort kommt via `on(OtpCmd.IDENTITY, ...)`. */
  async requestIdentity(): Promise<void> {
    this.send(OtpCmd.IDENTITY, 0x00, []);
  }

  /** CMD 0x02 0x00: Parameter setzen mit Echo-Vermeidung. */
  setParam(part: number, paramHigh: number, paramLow: number, value: number): void {
    const key = `${part}:${paramHigh}:${paramLow}`;
    const now = nowMs();
    // Lazy GC: alte abgelaufene Eintraege beim Hot-Path entfernen.
    this.sweepExpired(now);
    this.pendingSets.set(key, now + PENDING_SET_TTL_MS);
    const v = value & 0x3FFF;
    this.send(OtpCmd.PARAM, 0x00,
      [part & 0x0F, paramHigh & 0x7F, paramLow & 0x7F, (v >> 7) & 0x7F, v & 0x7F]);
  }

  /**
   * v3.21.0: Garbage-Collect abgelaufene pendingSets-Eintraege.
   * O(n) ueber die typischerweise kleine Map (selten >20 Eintraege bei
   * aktivem Slider-Sweep), wird nur in Hot-Paths (setParam, handleIncoming)
   * aufgerufen. Test-Hook fuer explizites Clearen.
   */
  private sweepExpired(now: number): void {
    if (this.pendingSets.size === 0) return;
    for (const [key, expiresAt] of this.pendingSets) {
      if (now >= expiresAt) this.pendingSets.delete(key);
    }
  }

  /** CMD 0x02 0x01: Parameter abfragen — Response via `on(OtpCmd.PARAM, ...)`. */
  getParam(part: number, paramHigh: number, paramLow: number): void {
    this.send(OtpCmd.PARAM, 0x01,
      [part & 0x0F, paramHigh & 0x7F, paramLow & 0x7F]);
  }

  /** CMD 0x03 0x00: Full State Dump. */
  requestFullDump(): void { this.send(OtpCmd.STATE_DUMP, 0x00, []); }

  /** CMD 0x06 0x00: Wavetable upload (256 × N Frames, 16-bit LE). */
  uploadWavetable(slot: number, frames: Float32Array[]): void {
    const data: number[] = [slot, frames.length];
    for (const frame of frames) {
      for (const sample of frame) {
        const i16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
        data.push((i16 >> 8) & 0x7F, i16 & 0x7F);
      }
    }
    this.send(OtpCmd.WAVETABLE, 0x00, data);
  }

  /** CMD 0x08 0x00: Real-time Streams aktivieren (Bitfield). */
  enableStreams(flags: number): void {
    this.send(OtpCmd.STREAM, 0x00, [flags & 0x7F]);
  }

  /** CMD 0x08 0x01: Streams deaktivieren. */
  disableStreams(): void { this.send(OtpCmd.STREAM, 0x01, []); }

  /** CMD 0x0B 0x00 / 0x01. */
  undo(): void { this.send(OtpCmd.UNDO_REDO, 0x00, []); }
  redo(): void { this.send(OtpCmd.UNDO_REDO, 0x01, []); }

  /**
   * v3.21.0: CMD 0x02 0x04 — Chord User-Slot Upload.
   *
   * Payload-Format: [slotIndex(1B), intervalCount(1B), N×interval(1B signed semitones)].
   * - slotIndex: 0..3 (entspricht Chord-Type 11..14 in CHORD_TYPES).
   * - Intervalle: -64..+63 Halbtoene (signed-i8, gemapped auf 7-bit).
   *
   * Defensive: Disconnected → NO-OP. Invalide Eingaben werden geklamt.
   * Wird gebaut via buildFrame() — landet im Throttle-Queue analog zu setParam.
   */
  uploadChordUserSlot(slotIndex: number, intervals: number[]): void {
    if (!this.connected) return;
    const slot = clampInt(slotIndex, 0, 3);
    const list = Array.isArray(intervals) ? intervals : [];
    // Max 16 Intervalle pro User-Slot (Hardware-Window) — laengere truncaten.
    const trimmed = list.slice(0, 16);
    const payload: number[] = [slot & 0x7F, trimmed.length & 0x7F];
    for (const iv of trimmed) {
      // signed semitones -64..+63 → 7-bit two's-complement (0x00..0x7F).
      // negative: rawByte = (val + 0x80) & 0x7F → MIDI-safe.
      const clamped = clampInt(iv, -64, 63);
      const byte = clamped < 0 ? (clamped + 0x80) & 0x7F : clamped & 0x7F;
      payload.push(byte);
    }
    this.send(OtpCmd.PARAM, 0x04, payload);
  }

  /** CMD 0x0E: Transport. */
  remotePlay():   void { this.send(OtpCmd.TRANSPORT, 0x00, []); }
  remoteStop():   void { this.send(OtpCmd.TRANSPORT, 0x01, []); }
  remoteRecord(): void { this.send(OtpCmd.TRANSPORT, 0x02, []); }
  remoteTempo(bpm: number): void {
    const bpm100 = Math.round(bpm * 100) & 0x3FFF;
    this.send(OtpCmd.TRANSPORT, 0x03, [(bpm100 >> 7) & 0x7F, bpm100 & 0x7F]);
  }

  /** Event-Listener: pro CMD ein oder mehrere Handler. */
  on(cmd: number, handler: FrameHandler): () => void {
    if (!this.handlers.has(cmd)) this.handlers.set(cmd, []);
    this.handlers.get(cmd)!.push(handler);
    return () => {
      const list = this.handlers.get(cmd) ?? [];
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  /** Test-Hook: simuliert eingehende Sysex-Frames (für Vitest). */
  __testInject(raw: Uint8Array): void {
    this.handleIncoming(raw);
  }

  /**
   * v3.21.0 Test-Hook: liefert die aktuelle Groesse der pendingSets-Map
   * (fuer Garbage-Collection-Verifikation in Tests).
   */
  __testGetPendingSetSize(): number {
    this.sweepExpired(nowMs());
    return this.pendingSets.size;
  }

  /** Test-Hook: liefert zuletzt gesendete Frames (für Vitest). */
  __testGetSentFrames(): Uint8Array[] {
    // Wir können nicht direkt rausziehen ohne FakeOutput; Tests greifen
    // stattdessen über das FakeMidiOutput.sent-Array zu. Helper bleibt
    // hier als Anker, falls die Bridge-Klasse später eigene Sniffing-
    // Unterstützung will.
    return [];
  }

  // ─── Internal: Sende mit Throttling (max 100/sec) ─────────

  private send(cmd: number, sub: number, payload: number[] | Uint8Array): void {
    if (!this.output) return;
    const frame = buildFrame(cmd, sub, payload);
    this.throttleQueue.push(frame);
    if (this.throttleTimer === null) {
      this.throttleTimer = setTimeout(() => this.flushQueue(), 10);
    }
  }

  private flushQueue(): void {
    const start = Date.now();
    while (this.throttleQueue.length > 0 && Date.now() - start < 5) {
      const frame = this.throttleQueue.shift()!;
      this.output?.send(Array.from(frame));
    }
    if (this.throttleQueue.length > 0) {
      this.throttleTimer = setTimeout(() => this.flushQueue(), 10);
    } else {
      this.throttleTimer = null;
    }
  }

  // ─── Internal: Eingehende Frames ───────────────────────────

  private handleIncoming(raw: Uint8Array): void {
    if (raw[0] !== OTP_SYSEX_START || raw[raw.length - 1] !== OTP_SYSEX_END) return;
    if (raw[1] !== OTP_MFR_ID[0] || raw[2] !== OTP_MFR_ID[1] || raw[3] !== OTP_MFR_ID[2]) return;
    if (raw.length < 10) return;

    const cmd = raw[4];
    const sub = raw[5];
    const len = (raw[6] << 7) | raw[7];
    if (raw.length !== 10 + len) return;
    const payload = raw.slice(8, 8 + len);
    // Checksum
    let chk = 0;
    for (let i = 0; i < payload.length; i++) chk ^= payload[i];
    if ((chk & 0x7F) !== raw[8 + len]) return;

    // Dispatch
    this.handlers.get(cmd)?.forEach(h => h(cmd, sub, payload));

    // CustomEvents fuer typische Bridge-Use-Cases
    if (cmd === OtpCmd.PARAM && sub === 0x03) {
      // Param-Notify vom Geraet — Echo-Schutz
      const part = payload[0] & 0x0F;
      const ph = payload[1];
      const pl = payload[2];
      const vh = payload[3];
      const vl = payload[4];
      let value = (vh << 7) | vl;
      if (value >= 0x2000) value -= 0x4000;
      const key = `${part}:${ph}:${pl}`;
      // v3.21.0: MaxTimestamp-Lookup statt setTimeout-Set.
      const expiresAt = this.pendingSets.get(key);
      const now = nowMs();
      if (expiresAt !== undefined) {
        if (now < expiresAt) return;             // Echo im Fenster, ignorieren
        this.pendingSets.delete(key);            // abgelaufen → GC + durchlassen
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("omnitribe:paramChange", {
          detail: { part, paramHigh: ph, paramLow: pl, value } as ParamChangeEvent,
        }));
      }
    }
    if (cmd === OtpCmd.STREAM && sub === 0x02) {
      const levels = Array.from(payload.slice(0, 16));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("omnitribe:vuMeter", {
          detail: { levels } as VuMeterEvent,
        }));
      }
    }
    if (cmd === OtpCmd.STREAM && sub === 0x03) {
      const bins = Array.from(payload.slice(0, 64));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("omnitribe:spectrum", {
          detail: { bins } as SpectrumEvent,
        }));
      }
    }
  }
}

// Singleton fuer die SynthStudio-Integration
export const omniTribeBridge = new OmniTribeBridge();
