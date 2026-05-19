/**
 * Synthstudio — MidiSyncIn.ts (v3.112.0)
 *
 * KORG-Master-Sync / Hardware-Master-Sync — schlanke, callback-basierte
 * Façade fuer MIDI-Clock-Slave-Funktionalitaet. Pendant zu MidiClockIn.ts
 * (v3.37.0), die per CustomEvent dispatched. MidiSyncIn nutzt stattdessen
 * einen direkten `onSyncEvent`-Callback — geeignet fuer:
 *
 *   - KORG Electribe2 als Master, Synthstudio als Slave.
 *   - v3.99-Caveat (externes Pre-Roll-Sync): wenn der externe Master die
 *     Tempo+Transport-Hoheit hat, orchestriert er das Pre-Roll.
 *
 * v3.112.0: Position-Sync erweitert MidiSyncIn um Song Position Pointer (SPP,
 * 0xF2 LSB MSB) und MIDI Time Code (MTC, 0xF1 quarter-frame + 0xF0 7F XX 01 01
 * full-frame Sysex). Damit kann der externe Master nicht nur Tempo/Transport,
 * sondern auch die exakte Position (Bar/Beat oder SMPTE HH:MM:SS:FF) ueber-
 * geben. Wichtige Designs:
 *   - SPP/MTC sind opt-in via Store `syncPosition` — Default false.
 *   - Quarter-Frame-Akkumulator stitched 8 Messages zu einer vollen Position.
 *   - Full-Frame-Sysex (0xF0 7F 7F 01 01 hh mm ss ff 0xF7) ist die bevorzugte
 *     Locate-Variante (instant); quarter-frame fuer continuous-running.
 *   - Pure-Helpers (decodeSpp / midiBeatsToStep / decodeMtcQuarterFrame /
 *     accumulateMtcQuarterFrames / mtcRateToFps / mtcPositionToMs) sind
 *     komplett Node-testbar.
 *
 * MIDI Real-Time-Bytes:
 *   0xF8 — Timing Clock (24 PPQN)
 *   0xFA — Start    (Reset Position + Play)
 *   0xFB — Continue (Resume from current position)
 *   0xFC — Stop
 *   0xFE — Active Sensing (ignoriert)
 *   0xFF — System Reset
 *
 * BPM-Derivation:
 *   24 Clocks pro Quarter Note → bei 120 BPM = 48 Clocks/sec = 20.83ms/Clock.
 *   bpm = 60_000 / (intervalMs * 24)
 *
 * Glaettung: gleitender Durchschnitt (Window-Default 16) plus optionale EWMA.
 *
 * Design-Entscheidungen:
 *   - Pure-Helpers (bpmFromClockIntervalMs / bpmFromIntervals / smoothBpm)
 *     stehen oeffentlich zur Verfuegung damit andere Klassen + Tests sie
 *     direkt verwenden koennen.
 *   - Stateful-Klasse haelt nur eine schlanke Sliding-Window-Liste der
 *     letzten Intervalle. Reset/Disable raeumt sauber auf.
 *   - Kein direkter window-Dispatch — der Caller installiert `onSyncEvent`
 *     und mappt selber auf Engine-Methoden / Custom Events. Damit ist die
 *     Klasse 100% Node-Test-tauglich.
 *
 * Isomorphic: keine React/Electron/Window-Imports.
 */

// ─── Konstanten ─────────────────────────────────────────────────────────────

/** Pulses per Quarter Note (MIDI 1.0 Standard). */
export const PPQN = 24;

/** Default-Sliding-Window-Groesse fuer das Moving-Average. */
export const DEFAULT_WINDOW_SIZE = 16;

/** Mindest-Sample-Anzahl bevor `getDetectedBpm()` einen Wert liefert. */
export const MIN_STABLE_SAMPLES = 6;

/** BPM-Sanity-Range. */
export const SYNC_IN_MIN_BPM = 20;
export const SYNC_IN_MAX_BPM = 300;

/** Default EWMA-Alpha fuer smoothBpm. */
export const DEFAULT_SMOOTH_ALPHA = 0.2;

// ─── Pure Helpers ───────────────────────────────────────────────────────────

/**
 * Berechnet das BPM aus einem einzelnen Tick-Intervall in Millisekunden.
 *
 *   bpm = 60_000 / (intervalMs * PPQN)
 *
 * @returns BPM gerundet auf 0.01 — null wenn out-of-range oder ungueltig.
 */
export function bpmFromClockIntervalMs(intervalMs: number): number | null {
  if (typeof intervalMs !== "number" || !isFinite(intervalMs) || intervalMs <= 0) return null;
  const raw = 60_000 / (intervalMs * PPQN);
  if (raw < SYNC_IN_MIN_BPM || raw > SYNC_IN_MAX_BPM) return null;
  return Math.round(raw * 100) / 100;
}

/**
 * Mittelt die letzten `windowSize` Intervalle und liefert das daraus
 * abgeleitete BPM. Pure — kein Side-Effect.
 *
 * @returns null wenn weniger als MIN_STABLE_SAMPLES Werte vorliegen oder
 *          alle Werte ungueltig sind.
 */
export function bpmFromIntervals(
  intervals: ReadonlyArray<number>,
  windowSize: number = DEFAULT_WINDOW_SIZE,
): number | null {
  if (!Array.isArray(intervals) || intervals.length === 0) return null;
  const w = Math.max(1, Math.floor(windowSize));
  const slice = intervals.slice(-w);
  // Defensive: filter NaN/Infinity/<=0 raus.
  const valid: number[] = [];
  for (let i = 0; i < slice.length; i++) {
    const v = slice[i];
    if (typeof v === "number" && isFinite(v) && v > 0) valid.push(v);
  }
  if (valid.length < MIN_STABLE_SAMPLES) return null;
  let sum = 0;
  for (let i = 0; i < valid.length; i++) sum += valid[i];
  const avg = sum / valid.length;
  return bpmFromClockIntervalMs(avg);
}

/**
 * Exponential-Moving-Average-Schritt zur BPM-Glaettung. Bei `prevBpm===null`
 * (oder ungueltig) wird `rawBpm` 1:1 uebernommen (Bootstrap).
 *
 *   smoothed = prev * (1 - alpha) + raw * alpha
 *
 * @param alpha Glaettungs-Faktor (0..1). Klein=langsam, 1=keine Glaettung.
 */
export function smoothBpm(
  rawBpm: number,
  prevBpm: number | null,
  alpha: number = DEFAULT_SMOOTH_ALPHA,
): number {
  if (typeof rawBpm !== "number" || !isFinite(rawBpm)) {
    return typeof prevBpm === "number" && isFinite(prevBpm) ? prevBpm : 0;
  }
  if (prevBpm === null || typeof prevBpm !== "number" || !isFinite(prevBpm)) return rawBpm;
  const a = Math.max(0, Math.min(1, typeof alpha === "number" && isFinite(alpha) ? alpha : DEFAULT_SMOOTH_ALPHA));
  const next = prevBpm * (1 - a) + rawBpm * a;
  return Math.round(next * 100) / 100;
}

// ─── MIDI Real-Time-Status-Bytes ────────────────────────────────────────────

export const RT_CLOCK   = 0xf8;
export const RT_START   = 0xfa;
export const RT_CONTINUE = 0xfb;
export const RT_STOP    = 0xfc;
export const RT_ACTIVE_SENSING = 0xfe;
export const RT_SYSTEM_RESET   = 0xff;

// ─── System-Common-Status-Bytes (v3.112.0 Position-Sync) ────────────────────

/** MTC Quarter-Frame Message (System Common, 0xF1). */
export const SC_MTC_QUARTER_FRAME = 0xf1;
/** Song Position Pointer (System Common, 0xF2). */
export const SC_SONG_POSITION = 0xf2;
/** Sysex Start. */
export const SYSEX_START = 0xf0;
/** Sysex End. */
export const SYSEX_END = 0xf7;
/** Universal Real-Time Sysex ID. */
export const SYSEX_UNIV_REALTIME = 0x7f;
/** MTC sub-ID #1 = Full-Frame-Message-Type. */
export const MTC_SUB_ID_1 = 0x01;
/** MTC sub-ID #2 = Full-Time-Code. */
export const MTC_SUB_ID_2 = 0x01;

// ─── Event-Typ ──────────────────────────────────────────────────────────────

export type MidiSyncEvent =
  | "start"
  | "stop"
  | "continue"
  | "bpm-changed"
  /** v3.112.0: SPP empfangen — `midiBeats` ist 14-bit Wert (1 beat = 16th). */
  | "position-changed"
  /** v3.112.0: MTC Quarter-Frame Stream tickt — leichtgewichtig pro Frame. */
  | "mtc-tick"
  /** v3.112.0: MTC Full-Frame (Sysex) instant locate. */
  | "mtc-locate";

export interface MidiSyncEventDetail {
  /** Aktuelles geschaetztes BPM (gerundet 0.01) — null bis MIN_STABLE_SAMPLES. */
  bpm?: number | null;
  /** Zeitstempel des Events (ms, vom Caller bereitgestellt). */
  time?: number;
  /** v3.112.0: SPP — MIDI Beats (0..16383, 1 beat = 6 clocks = 16th note). */
  midiBeats?: number;
  /** v3.112.0: MTC HH:MM:SS:FF. */
  hh?: number;
  mm?: number;
  ss?: number;
  ff?: number;
  /** v3.112.0: MTC rate code (0=24, 1=25, 2=29.97, 3=30). */
  rate?: number;
  /** v3.112.0: MTC effective FPS. */
  fps?: number;
  /** v3.112.0: MTC position in ms (calculated from HH:MM:SS:FF + fps). */
  positionMs?: number;
}

// ─── Pure Helpers: SPP / MTC (v3.112.0) ─────────────────────────────────────

/**
 * Decodiert ein 14-bit Song Position Pointer aus LSB + MSB.
 *   midiBeats = (msb << 7) | lsb     (0..16383)
 *   1 MIDI Beat = 6 MIDI Clocks = 1/16-note
 *
 * @returns 0..16383 oder 0 bei ungueltigem Input (defensive — kein NaN-Leak).
 */
export function decodeSpp(lsb: number, msb: number): number {
  const l = typeof lsb === "number" && isFinite(lsb) ? lsb & 0x7f : 0;
  const m = typeof msb === "number" && isFinite(msb) ? msb & 0x7f : 0;
  return (m << 7) | l;
}

/**
 * Wandelt MIDI Beats (16th-notes seit Song-Start) in einen Step-Index um —
 * `stepsPerBar` ist die Synth-Pattern-Length (16 / 32 / 64).
 *
 *   step = midiBeats * (stepsPerBar / 16)
 *
 * Bei 16er-Pattern: 16 MIDI Beats = 1 Bar = 16 Steps → step = midiBeats.
 * Bei 32er-Pattern: 32 Steps pro Bar, ein 16th-note ist 2 Steps → ×2.
 *
 * @returns Step-Index (0..)
 */
export function midiBeatsToStep(midiBeats: number, stepsPerBar: number): number {
  const mb = typeof midiBeats === "number" && isFinite(midiBeats) ? Math.max(0, midiBeats) : 0;
  const spb = typeof stepsPerBar === "number" && isFinite(stepsPerBar) && stepsPerBar > 0 ? stepsPerBar : 16;
  // 16th-notes pro Bar = 16; Scale = spb/16.
  return Math.round(mb * (spb / 16));
}

/**
 * Decodiert ein MTC Quarter-Frame-Byte (0xF1 data):
 *   data = (type << 4) | (value & 0x0F)
 *
 * type: 0..7 (welches Nibble von HH:MM:SS:FF), value: 4-bit-Nibble.
 *
 * @returns null bei ungueltigem Input.
 */
export function decodeMtcQuarterFrame(data: number): { type: number; value: number } | null {
  if (typeof data !== "number" || !isFinite(data) || data < 0 || data > 127) return null;
  const type = (data >> 4) & 0x07;
  const value = data & 0x0f;
  return { type, value };
}

/**
 * Akkumuliert 8 Quarter-Frames zu einem vollen HH:MM:SS:FF mit Rate-Code.
 *
 * Frame-Layout (per MIDI 1.0 Spec):
 *   0 — ff_low  (frame number low nibble)
 *   1 — ff_high (frame number high nibble)
 *   2 — ss_low  (seconds low)
 *   3 — ss_high (seconds high)
 *   4 — mm_low  (minutes low)
 *   5 — mm_high (minutes high)
 *   6 — hh_low  (hours low)
 *   7 — hh_high (hours high 1 bit + rate code 2 bits)
 *
 * @param frames Array von `{type, value}`-Objekten (alle 8 muessen present sein
 *               und type 0..7 distinct decken). Reihenfolge ist relevant —
 *               die Funktion sortiert NICHT (Caller stellt Reihenfolge sicher).
 * @returns null wenn nicht alle 8 Types abgedeckt; sonst HH:MM:SS:FF + rate.
 */
export function accumulateMtcQuarterFrames(
  frames: ReadonlyArray<{ type: number; value: number } | null | undefined>,
): { hh: number; mm: number; ss: number; ff: number; rate: number } | null {
  if (!Array.isArray(frames) || frames.length < 8) return null;
  // Pflicht: alle 8 Typen 0..7 vorhanden.
  const seen = new Array<{ type: number; value: number } | null>(8).fill(null);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f || typeof f.type !== "number" || typeof f.value !== "number") continue;
    if (f.type >= 0 && f.type < 8) seen[f.type] = f;
  }
  for (let t = 0; t < 8; t++) {
    if (!seen[t]) return null;
  }
  const ff_low = seen[0]!.value & 0x0f;
  const ff_high = seen[1]!.value & 0x01; // FF high ist nur 1 bit (0..29 → max 0x1F)
  const ss_low = seen[2]!.value & 0x0f;
  const ss_high = seen[3]!.value & 0x03; // SS high nur 2 bit (0..59 → max 0x3B)
  const mm_low = seen[4]!.value & 0x0f;
  const mm_high = seen[5]!.value & 0x03;
  const hh_low = seen[6]!.value & 0x0f;
  const hh_high_byte = seen[7]!.value & 0x07; // 3 bit: bit0=hh-high1, bits1-2=rate
  const hh_high = hh_high_byte & 0x01;
  const rate = (hh_high_byte >> 1) & 0x03;
  const ff = (ff_high << 4) | ff_low;
  const ss = (ss_high << 4) | ss_low;
  const mm = (mm_high << 4) | mm_low;
  const hh = (hh_high << 4) | hh_low;
  return { hh, mm, ss, ff, rate };
}

/** Konvertiert MTC-Rate-Code (0..3) in effektive FPS. */
export function mtcRateToFps(rate: number): number {
  switch (rate & 0x03) {
    case 0: return 24;
    case 1: return 25;
    case 2: return 29.97;
    case 3: return 30;
    default: return 30;
  }
}

/**
 * Konvertiert eine SMPTE-Position in Millisekunden.
 *   ms = hh*3600000 + mm*60000 + ss*1000 + ff*(1000/fps)
 *
 * @returns ms, oder 0 bei ungueltigem fps.
 */
export function mtcPositionToMs(hh: number, mm: number, ss: number, ff: number, fps: number): number {
  const _hh = typeof hh === "number" && isFinite(hh) ? Math.max(0, Math.floor(hh)) : 0;
  const _mm = typeof mm === "number" && isFinite(mm) ? Math.max(0, Math.floor(mm)) : 0;
  const _ss = typeof ss === "number" && isFinite(ss) ? Math.max(0, Math.floor(ss)) : 0;
  const _ff = typeof ff === "number" && isFinite(ff) ? Math.max(0, Math.floor(ff)) : 0;
  const _fps = typeof fps === "number" && isFinite(fps) && fps > 0 ? fps : 30;
  return _hh * 3_600_000 + _mm * 60_000 + _ss * 1000 + (_ff * 1000) / _fps;
}

export type MidiSyncEventListener = (event: MidiSyncEvent, detail?: MidiSyncEventDetail) => void;

// ─── MidiSyncIn-Klasse ──────────────────────────────────────────────────────

export interface MidiSyncInOptions {
  /** Sliding-Window-Groesse fuer Moving-Average. Default 16. */
  windowSize?: number;
  /** EWMA-Alpha fuer Glaettung des BPM-Estimates. Default 0.2. */
  smoothAlpha?: number;
  /** Schwelle fuer `bpm-changed`-Emission (in BPM). Default 0.1. */
  bpmChangeThreshold?: number;
}

/**
 * Stateful Slave-Receiver. Eine Instanz pro Hook-Konsumenten.
 *
 *   const sync = new MidiSyncIn();
 *   sync.enabled = true;
 *   sync.onSyncEvent = (ev, detail) => console.log(ev, detail);
 *   sync.handleClock(performance.now()); // pro 0xF8
 *   sync.handleStart();
 *   sync.handleStop();
 */
export class MidiSyncIn {
  /** Toggle — Caller darf direkt schreiben. Bei false: alle handle*() no-op. */
  enabled = false;

  /** Listener — null = stumm. Caller installiert in der Wire-Up-Phase. */
  onSyncEvent: MidiSyncEventListener | null = null;

  // ── Internals ────────────────────────────────────────────────────────────
  private _lastClockTime = 0;
  private _clockIntervals: number[] = [];
  private _detectedBpm: number | null = null;
  /** Letzter emittierter Wert — fuer Threshold-Throttle. */
  private _lastEmittedBpm: number | null = null;

  // v3.112.0: Position-Sync-State.
  private _lastSppMidiBeats: number | null = null;
  /** Akkumulator-Slots fuer 8 Quarter-Frames (indiziert nach type 0..7). */
  private _mtcAccumulator: Array<{ type: number; value: number } | null> = new Array(8).fill(null);
  /** Anzahl distinct types die seit letzter Vollvermessung gefuellt wurden. */
  private _mtcAccumulatorCount = 0;
  /** Letzte vollstaendig decodierte MTC-Position (Quarter-Frame-Stream). */
  private _lastMtcPosition: { hh: number; mm: number; ss: number; ff: number; rate: number } | null = null;

  private readonly _windowSize: number;
  private readonly _smoothAlpha: number;
  private readonly _bpmChangeThreshold: number;

  constructor(opts: MidiSyncInOptions = {}) {
    this._windowSize = Math.max(2, Math.floor(opts.windowSize ?? DEFAULT_WINDOW_SIZE));
    this._smoothAlpha = Math.max(
      0,
      Math.min(1, typeof opts.smoothAlpha === "number" ? opts.smoothAlpha : DEFAULT_SMOOTH_ALPHA),
    );
    this._bpmChangeThreshold = Math.max(
      0,
      typeof opts.bpmChangeThreshold === "number" ? opts.bpmChangeThreshold : 0.1,
    );
  }

  // ── Public Getters ───────────────────────────────────────────────────────

  /** Aktuelles BPM-Estimate — null bis MIN_STABLE_SAMPLES erreicht. */
  getDetectedBpm(): number | null {
    return this._detectedBpm;
  }

  /** Anzahl der bisher gesammelten Intervalle (max windowSize). */
  getSampleCount(): number {
    return this._clockIntervals.length;
  }

  /** Letzter Clock-Timestamp (vom Caller geliefert). */
  getLastClockTime(): number {
    return this._lastClockTime;
  }

  /** v3.112.0: Letzter empfangener SPP-Wert in MIDI Beats (null = noch keiner). */
  getLastSppMidiBeats(): number | null {
    return this._lastSppMidiBeats;
  }

  /** v3.112.0: Letzte vollstaendig decodierte MTC-Position. */
  getLastMtcPosition(): { hh: number; mm: number; ss: number; ff: number; rate: number } | null {
    return this._lastMtcPosition;
  }

  // ── State-Reset ──────────────────────────────────────────────────────────

  /** Loescht Intervalle und BPM-Estimate. enabled / Listener bleiben. */
  reset(): void {
    this._lastClockTime = 0;
    this._clockIntervals = [];
    this._detectedBpm = null;
    this._lastEmittedBpm = null;
    // v3.112.0: Position-State auch resetten.
    this._lastSppMidiBeats = null;
    this._mtcAccumulator = new Array(8).fill(null);
    this._mtcAccumulatorCount = 0;
    this._lastMtcPosition = null;
  }

  // ── Handlers (Hot-Path) ──────────────────────────────────────────────────

  /**
   * Pro 0xF8 (Timing Clock) aufrufen. `timestampMs` ist eine monotone
   * Wallclock-Zeit (typisch `performance.now()` oder MIDIMessageEvent.timeStamp).
   */
  handleClock(timestampMs: number): void {
    if (!this.enabled) return;
    if (typeof timestampMs !== "number" || !isFinite(timestampMs)) return;

    // Erster Tick: nur Zeit merken, kein Intervall berechnen.
    if (this._lastClockTime === 0) {
      this._lastClockTime = timestampMs;
      return;
    }
    const interval = timestampMs - this._lastClockTime;
    this._lastClockTime = timestampMs;
    if (interval <= 0 || !isFinite(interval)) return;

    this._clockIntervals.push(interval);
    if (this._clockIntervals.length > this._windowSize) {
      this._clockIntervals.shift();
    }

    // BPM-Estimate aktualisieren — nur wenn genuegend Samples.
    if (this._clockIntervals.length >= MIN_STABLE_SAMPLES) {
      const raw = bpmFromIntervals(this._clockIntervals, this._windowSize);
      if (raw !== null) {
        const smoothed = smoothBpm(raw, this._detectedBpm, this._smoothAlpha);
        this._detectedBpm = smoothed;
        // Emission-Threshold.
        if (
          this._lastEmittedBpm === null ||
          Math.abs(smoothed - this._lastEmittedBpm) >= this._bpmChangeThreshold
        ) {
          this._lastEmittedBpm = smoothed;
          this._emit("bpm-changed", { bpm: smoothed, time: timestampMs });
        }
      }
    }
  }

  /** Pro 0xFA (Start) aufrufen — emittiert "start". */
  handleStart(): void {
    if (!this.enabled) return;
    // Reset des Tick-Windows damit der erste Tick nach Start nicht als 0ms-
    // Intervall-Spike interpretiert wird. _detectedBpm bleibt bestehen,
    // damit der Slave nicht 16 Ticks braucht bis die UI wieder reagiert.
    this._lastClockTime = 0;
    this._emit("start", { bpm: this._detectedBpm });
  }

  /** Pro 0xFB (Continue) aufrufen — emittiert "continue". */
  handleContinue(): void {
    if (!this.enabled) return;
    this._lastClockTime = 0;
    this._emit("continue", { bpm: this._detectedBpm });
  }

  /** Pro 0xFC (Stop) aufrufen — emittiert "stop". */
  handleStop(): void {
    if (!this.enabled) return;
    this._emit("stop", { bpm: this._detectedBpm });
  }

  // ── v3.112.0: Position-Sync-Handler ─────────────────────────────────────

  /**
   * v3.112.0: Pro 0xF2 LSB MSB (Song Position Pointer) aufrufen.
   * Decodiert das 14-bit Position-Wert und emittiert "position-changed".
   */
  handleSongPositionPointer(lsb: number, msb: number): void {
    if (!this.enabled) return;
    const midiBeats = decodeSpp(lsb, msb);
    this._lastSppMidiBeats = midiBeats;
    this._emit("position-changed", { midiBeats });
  }

  /**
   * v3.112.0: Pro 0xF1 data (MTC Quarter-Frame) aufrufen.
   * Akkumuliert 8 Frames; bei vollstaendiger Position emittiert "mtc-tick"
   * mit decodierter HH:MM:SS:FF + rate + fps + positionMs.
   */
  handleMtcQuarterFrame(data: number): void {
    if (!this.enabled) return;
    const decoded = decodeMtcQuarterFrame(data);
    if (!decoded) return;
    const slot = this._mtcAccumulator[decoded.type];
    if (slot === null) {
      this._mtcAccumulatorCount++;
    }
    this._mtcAccumulator[decoded.type] = decoded;
    // Nur emit wenn alle 8 Slots ausgefuellt.
    if (this._mtcAccumulatorCount < 8) return;
    const pos = accumulateMtcQuarterFrames(this._mtcAccumulator);
    if (!pos) {
      // Defensive: irgendwas korrupt — reset accumulator.
      this._mtcAccumulator = new Array(8).fill(null);
      this._mtcAccumulatorCount = 0;
      return;
    }
    this._lastMtcPosition = pos;
    const fps = mtcRateToFps(pos.rate);
    const positionMs = mtcPositionToMs(pos.hh, pos.mm, pos.ss, pos.ff, fps);
    this._emit("mtc-tick", {
      hh: pos.hh, mm: pos.mm, ss: pos.ss, ff: pos.ff,
      rate: pos.rate, fps, positionMs,
    });
    // Slots fuer naechsten Frame-Zyklus leeren — neue 8 Quarter-Frames werden
    // wieder akkumuliert. Damit ist die Position kontinuierlich aktualisiert.
    this._mtcAccumulator = new Array(8).fill(null);
    this._mtcAccumulatorCount = 0;
  }

  /**
   * v3.112.0: MTC Full-Frame (Sysex 0xF0 7F 7F 01 01 hh mm ss ff 0xF7).
   * Instant locate — bevorzugt gegenueber Quarter-Frame fuer Position-Jumps.
   */
  handleMtcFullFrame(hh: number, mm: number, ss: number, ff: number, rate: number): void {
    if (!this.enabled) return;
    const _hh = typeof hh === "number" && isFinite(hh) ? Math.max(0, Math.floor(hh)) : 0;
    const _mm = typeof mm === "number" && isFinite(mm) ? Math.max(0, Math.floor(mm)) : 0;
    const _ss = typeof ss === "number" && isFinite(ss) ? Math.max(0, Math.floor(ss)) : 0;
    const _ff = typeof ff === "number" && isFinite(ff) ? Math.max(0, Math.floor(ff)) : 0;
    const _rate = typeof rate === "number" && isFinite(rate) ? rate & 0x03 : 0;
    this._lastMtcPosition = { hh: _hh, mm: _mm, ss: _ss, ff: _ff, rate: _rate };
    const fps = mtcRateToFps(_rate);
    const positionMs = mtcPositionToMs(_hh, _mm, _ss, _ff, fps);
    this._emit("mtc-locate", {
      hh: _hh, mm: _mm, ss: _ss, ff: _ff,
      rate: _rate, fps, positionMs,
    });
  }

  /**
   * v3.112.0: Versucht eine Universal-Real-Time Sysex MTC-Full-Frame-Message
   * zu parsen und delegiert an handleMtcFullFrame. Erwartet das 10-Byte-Layout
   * 0xF0 0x7F <deviceId> 0x01 0x01 hh mm ss ff 0xF7 — die `deviceId` ist
   * meist 0x7F (broadcast), wird aber nicht validiert.
   *
   * @returns true wenn die Bytes eine MTC-Full-Frame-Message darstellen und
   *          erfolgreich gehandled wurden.
   */
  handleSysexMessage(bytes: ArrayLike<number>): boolean {
    if (!this.enabled) return false;
    if (!bytes || bytes.length < 10) return false;
    // Header check: 0xF0 0x7F <id> 0x01 0x01 hh mm ss ff 0xF7
    if (bytes[0] !== SYSEX_START) return false;
    if (bytes[1] !== SYSEX_UNIV_REALTIME) return false;
    if (bytes[3] !== MTC_SUB_ID_1) return false;
    if (bytes[4] !== MTC_SUB_ID_2) return false;
    if (bytes[bytes.length - 1] !== SYSEX_END) return false;
    const hh_byte = bytes[5] & 0x7f;
    const mm = bytes[6] & 0x7f;
    const ss = bytes[7] & 0x7f;
    const ff = bytes[8] & 0x7f;
    // hh-Byte enthaelt rate in bits 5-6 und hh in bits 0-4.
    const hh = hh_byte & 0x1f;
    const rate = (hh_byte >> 5) & 0x03;
    this.handleMtcFullFrame(hh, mm, ss, ff, rate);
    return true;
  }

  /**
   * Convenience: leitet ein rohes MIDI-Message-Byte-Array weiter und ruft
   * die passende handle*()-Methode auf. Active-Sensing (0xFE) und System
   * Reset (0xFF) werden bewusst ignoriert.
   *
   * v3.112.0: dispatched auch 0xF1 (MTC Quarter-Frame), 0xF2 (SPP) und
   * Sysex-MTC-Full-Frame.
   */
  handleMessage(bytes: ArrayLike<number>, timestampMs: number): void {
    if (!this.enabled) return;
    if (!bytes || bytes.length < 1) return;
    const status = bytes[0];
    switch (status) {
      case RT_CLOCK: this.handleClock(timestampMs); return;
      case RT_START: this.handleStart(); return;
      case RT_CONTINUE: this.handleContinue(); return;
      case RT_STOP: this.handleStop(); return;
      case SC_MTC_QUARTER_FRAME:
        if (bytes.length >= 2) this.handleMtcQuarterFrame(bytes[1]);
        return;
      case SC_SONG_POSITION:
        if (bytes.length >= 3) this.handleSongPositionPointer(bytes[1], bytes[2]);
        return;
      case SYSEX_START:
        // Versuche MTC-Full-Frame-Sysex; andere Sysex-Messages werden ignoriert.
        this.handleSysexMessage(bytes);
        return;
      case RT_ACTIVE_SENSING:
      case RT_SYSTEM_RESET:
      default:
        return;
    }
  }

  // ── Internal Emit ────────────────────────────────────────────────────────

  private _emit(ev: MidiSyncEvent, detail?: MidiSyncEventDetail): void {
    const listener = this.onSyncEvent;
    if (!listener) return;
    try {
      listener(ev, detail);
    } catch {
      /* swallow — never crash the hot-path */
    }
  }
}
