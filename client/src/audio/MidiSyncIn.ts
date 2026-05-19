/**
 * Synthstudio — MidiSyncIn.ts (v3.111.0)
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

// ─── Event-Typ ──────────────────────────────────────────────────────────────

export type MidiSyncEvent = "start" | "stop" | "continue" | "bpm-changed";

export interface MidiSyncEventDetail {
  /** Aktuelles geschaetztes BPM (gerundet 0.01) — null bis MIN_STABLE_SAMPLES. */
  bpm?: number | null;
  /** Zeitstempel des Events (ms, vom Caller bereitgestellt). */
  time?: number;
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

  // ── State-Reset ──────────────────────────────────────────────────────────

  /** Loescht Intervalle und BPM-Estimate. enabled / Listener bleiben. */
  reset(): void {
    this._lastClockTime = 0;
    this._clockIntervals = [];
    this._detectedBpm = null;
    this._lastEmittedBpm = null;
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

  /**
   * Convenience: leitet ein rohes MIDI-Message-Byte-Array weiter und ruft
   * die passende handle*()-Methode auf. Active-Sensing (0xFE) und System
   * Reset (0xFF) werden bewusst ignoriert.
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
