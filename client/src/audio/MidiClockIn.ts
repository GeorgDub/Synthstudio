/**
 * Synthstudio — MidiClockIn.ts (v3.36.0)
 *
 * MIDI-Clock-Slave-Implementierung — Pendant zu MidiClockOut.ts (v2.83).
 * Empfängt MIDI-Real-Time-Messages von einem externen Master (Electribe,
 * OmniTribe, DAW, Drum-Machine) und liefert ein stabiles BPM-Estimate +
 * Transport-Events (start/stop/continue) + Song-Position-Seek (SPP).
 *
 * Protokoll (Web MIDI Status-Bytes):
 *   0xF8 — Timing Clock (24× pro Quarternote)
 *   0xFA — Start    — Reset position to start (oder zur letzten SPP-Position)
 *   0xFB — Continue — Resume from current position (kein Reset)
 *   0xFC — Stop     — Halt at current position
 *   0xF2 — Song Position Pointer (BE u14: MIDI-Beats = 1/16-Note-Steps)
 *
 * Design-Entscheidungen:
 *   - Stateful Klasse (instance pro Hook), kein Modul-Singleton. Damit lassen
 *     sich mehrere Receiver in Tests parallel laufen.
 *   - Tick-Timing kommt aus `performance.now()` (Default) ODER aus einem
 *     injizierten Clock-Provider (für deterministische Tests). KEIN Date.now.
 *   - BPM-Smoothing: EWMA mit alpha=0.1 — langsam adaptiv, kein Yoyo.
 *     Erstes ticks wird direkt übernommen (kein Bootstrapping-Bias).
 *   - Jitter-Filter: Intervalle > 50% vom EWMA-Mittel werden als Outlier
 *     verworfen — schützt gegen Spike-Bursts (USB-Hub-Hickups, GC-Pausen).
 *   - Sync-Loss-Detection: kein Tick > 500ms → Status "lost". Caller pollt
 *     `getStatus()` (z.B. UI-LED-Indikator) ODER hört auf `midiclockin:lost`.
 *   - v3.36.0: SPP wird nur akzeptiert wenn Transport NICHT running (per MIDI-
 *     Spec). Während Playback ignoriert der Slave SPP-Messages — der Master
 *     soll erst stoppen, seeken, dann starten.
 *
 * Performance:
 *   - `handleMidiMessage` ist heap-allocation-frei im Hot-Path (0xF8). Keine
 *     Arrays, keine Objekte, keine String-Konkatenation pro Tick.
 *   - Tempo-Events werden gerundet & ge-throttled (nur bei Δ ≥ 0.1 BPM).
 *
 * Events (alle CustomEvent auf window):
 *   "midiclockin:start"    detail: { time: number, positionStep: number }
 *   "midiclockin:stop"     detail: { time: number }
 *   "midiclockin:continue" detail: { time: number }
 *   "midiclockin:tempo"    detail: { bpm: number, raw: number }
 *   "midiclockin:lost"     detail: { lastTickTime: number }
 *   "midiclockin:spp"      detail: { midiBeat: number, positionStep: number }
 *
 * Konversion: 1 MIDI-Beat = 6 MIDI-Clocks = 1/16-Note = 1 Sequencer-Step.
 * D.h. `positionStep === midiBeat`. Wir liefern beide Felder explizit für
 * Klarheit & Downstream-Kompatibilität.
 *
 * Isomorphic: keine React/Electron-Imports, läuft im Browser + Node-Tests.
 */

// ─── Konstanten ─────────────────────────────────────────────────────────────

/** System-Realtime: Timing-Clock. 24× pro Quarter-Note. */
export const MIDI_RT_CLOCK_TICK = 0xf8;
/** System-Realtime: Start (Reset Position + Play). */
export const MIDI_RT_START      = 0xfa;
/** System-Realtime: Continue (Play ohne Position-Reset). */
export const MIDI_RT_CONTINUE   = 0xfb;
/** System-Realtime: Stop. */
export const MIDI_RT_STOP       = 0xfc;
/** System-Common: Song Position Pointer Status. */
export const MIDI_SC_SPP        = 0xf2;

/** PPQN — Pulses Per Quarter Note. MIDI 1.0 Standard. */
export const MIDI_PPQN = 24;

/** Sync-Loss-Threshold in Millisekunden (kein Tick → status lost). */
export const SYNC_LOSS_MS = 500;

/** EWMA-Glättungs-Faktor (0..1). Klein = langsam, groß = schnell. */
export const TEMPO_EWMA_ALPHA = 0.1;

/** Outlier-Filter: Intervalle > N% vom EWMA-Mittel werden verworfen. */
export const TEMPO_OUTLIER_THRESHOLD = 0.5;

/** Minimum-Anzahl Ticks bis ein BPM-Estimate emittiert wird. */
export const TEMPO_MIN_SAMPLES = 6;

/** BPM-Bereich für Sanity-Check. */
export const TEMPO_MIN_BPM = 20;
export const TEMPO_MAX_BPM = 300;

/** SPP-Maximum (14-bit unsigned). MIDI 1.0 Spec. */
export const SPP_MAX_MIDI_BEAT = 16383;

// ─── Pure Helpers ───────────────────────────────────────────────────────────

/**
 * Berechnet BPM aus einem Tick-Intervall (zwischen zwei aufeinander folgenden
 * 0xF8-Pulsen). Reine Funktion, keine Side-Effects.
 *
 *   bpm = 60000 / (intervalMs * 24)
 *
 * @returns BPM (gerundet auf 0.1) oder null wenn out-of-range.
 */
export function bpmFromTickInterval(intervalMs: number): number | null {
  if (intervalMs <= 0 || !isFinite(intervalMs)) return null;
  const raw = 60000 / (intervalMs * MIDI_PPQN);
  if (raw < TEMPO_MIN_BPM || raw > TEMPO_MAX_BPM) return null;
  return Math.round(raw * 10) / 10;
}

/**
 * Wendet einen EWMA-Schritt auf den bisherigen Mittelwert an.
 * Beim ersten Sample (current===null) wird `next` 1:1 übernommen.
 */
export function ewmaStep(current: number | null, next: number, alpha = TEMPO_EWMA_ALPHA): number {
  if (current === null || !isFinite(current)) return next;
  return current * (1 - alpha) + next * alpha;
}

/**
 * Outlier-Check: gibt true zurück wenn `interval` mehr als `threshold` (0..1)
 * vom Referenz-Mittel `mean` abweicht. Mean===null → never outlier.
 */
export function isOutlier(interval: number, mean: number | null, threshold = TEMPO_OUTLIER_THRESHOLD): boolean {
  if (mean === null || mean <= 0) return false;
  const delta = Math.abs(interval - mean) / mean;
  return delta > threshold;
}

// ─── Status-Enum ────────────────────────────────────────────────────────────

/** Sync-Phase, abgeleitet aus den letzten empfangenen Real-Time-Messages. */
export type MidiClockInStatus =
  /** Receiver disabled (oder noch nie ein Tick empfangen). */
  | "off"
  /** Ticks kommen rein, aber kein 0xFA/0xFB → wir kennen Tempo, kein Transport. */
  | "tempo-only"
  /** 0xFA/0xFB empfangen + Ticks fließen → Master spielt, wir folgen. */
  | "running"
  /** Kein Tick > SYNC_LOSS_MS → Sync ist verloren. */
  | "lost";

// ─── Clock-Provider (Test-Hook) ─────────────────────────────────────────────

/** Liefert die aktuelle Wallclock-Zeit in Millisekunden. */
export type NowProvider = () => number;

const defaultNow: NowProvider = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

// ─── Public API: MidiClockIn ────────────────────────────────────────────────

export interface MidiClockInOptions {
  /** Test-Hook: stelle eine deterministische Zeitquelle bereit. Default: performance.now(). */
  now?: NowProvider;
  /**
   * Event-Sink. Default: `window.dispatchEvent(new CustomEvent(...))`.
   * In Node-Tests einfach mit einem mock-Recorder ersetzen.
   */
  dispatch?: (event: string, detail: unknown) => void;
}

/**
 * MIDI-Clock-Slave. Eine Instanz pro Receiver-Konsumenten (typisch:
 * eine pro `useMidi`-Hook).
 */
export class MidiClockIn {
  // ── Public-readable state ────────────────────────────────────────────────
  private _enabled = false;
  private _isRunning = false;
  private _lastTickTime = 0;
  private _ticksSeen = 0;
  /** EWMA-gemitteltes Tick-Intervall in ms (null bis MIN_SAMPLES). */
  private _meanInterval: number | null = null;
  /** Letzte herausgegebene gerundete BPM (für Throttle des `tempo`-Events). */
  private _lastEmittedBpm: number | null = null;
  /**
   * v3.36.0: Zuletzt empfangene SPP-Position (in MIDI-Beats = 1/16-Steps).
   * Wird beim nächsten 0xFA Start an die Engine durchgereicht damit der
   * Sequencer von der gewünschten Position weiterspielt. null = noch nie SPP
   * empfangen → 0xFA startet bei step 0. Wird beim 0xFA verbraucht (cleared).
   */
  private _pendingStartStep: number | null = null;

  // ── Konfiguration ────────────────────────────────────────────────────────
  private readonly _now: NowProvider;
  private readonly _dispatch: (event: string, detail: unknown) => void;

  constructor(opts: MidiClockInOptions = {}) {
    this._now = opts.now ?? defaultNow;
    this._dispatch = opts.dispatch ?? defaultDispatch;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    // Tick-Counter NICHT resetten — wenn der Master schon läuft, sollen die
    // nächsten Ticks sofort als gültig durchgehen. lastTickTime aber ja, damit
    // der erste neue Tick nicht fälschlich als 0ms-Intervall interpretiert
    // wird.
    this._lastTickTime = 0;
    this._ticksSeen = 0;
    this._meanInterval = null;
    this._lastEmittedBpm = null;
    this._pendingStartStep = null;
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._isRunning = false;
    this._lastTickTime = 0;
    this._ticksSeen = 0;
    this._meanInterval = null;
    this._lastEmittedBpm = null;
    this._pendingStartStep = null;
  }

  /** Vollständiger State-Reset — typischerweise nach Device-Wechsel. */
  reset(): void {
    this._isRunning = false;
    this._lastTickTime = 0;
    this._ticksSeen = 0;
    this._meanInterval = null;
    this._lastEmittedBpm = null;
    this._pendingStartStep = null;
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  get enabled(): boolean       { return this._enabled; }
  get isRunning(): boolean     { return this._isRunning; }
  get lastTickTime(): number   { return this._lastTickTime; }
  get ticksSeen(): number      { return this._ticksSeen; }
  /**
   * v3.36.0: Letzte empfangene SPP-Position (in MIDI-Beats = 1/16-Steps).
   * Wird beim nächsten 0xFA Start an die Engine durchgereicht. null = kein
   * SPP empfangen ODER bereits verbraucht.
   */
  get pendingStartStep(): number | null { return this._pendingStartStep; }

  /**
   * Liefert das aktuelle BPM-Estimate (gerundet auf 0.1) oder null wenn noch
   * nicht genügend Samples. Berechnet aus dem EWMA-gemittelten Intervall.
   */
  getEstimatedBpm(): number | null {
    if (this._meanInterval === null || this._ticksSeen < TEMPO_MIN_SAMPLES) return null;
    return bpmFromTickInterval(this._meanInterval);
  }

  /**
   * Liefert den abgeleiteten Sync-Status (off | tempo-only | running | lost).
   * Caller (UI) sollte das per RAF oder setInterval pollen.
   */
  getStatus(): MidiClockInStatus {
    if (!this._enabled) return "off";
    if (this._lastTickTime === 0) return "off";
    const now = this._now();
    if (now - this._lastTickTime > SYNC_LOSS_MS) return "lost";
    if (this._isRunning) return "running";
    return "tempo-only";
  }

  // ── Hot-Path: Message-Handler ────────────────────────────────────────────

  /**
   * Wird vom useMidi-Hook bei jedem `onmidimessage`-Event aufgerufen. Lazy:
   * bei !enabled sofort return.
   *
   * Performance-Hot-Path: keine Allocations für 0xF8. Wir reichen die rohen
   * data-Bytes durch — entweder Uint8Array oder number[] tut beides.
   */
  handleMidiMessage(bytes: ArrayLike<number>): void {
    if (!this._enabled) return;
    if (!bytes || bytes.length < 1) return;
    const status = bytes[0];

    // ── 0xF8 — Timing Clock (24× pro Beat). HEISSER PFAD. ────────────────
    if (status === MIDI_RT_CLOCK_TICK) {
      this._onTick();
      return;
    }

    // ── 0xFA — Start ─────────────────────────────────────────────────────
    if (status === MIDI_RT_START) {
      this._onStart();
      return;
    }

    // ── 0xFB — Continue ──────────────────────────────────────────────────
    if (status === MIDI_RT_CONTINUE) {
      this._onContinue();
      return;
    }

    // ── 0xFC — Stop ──────────────────────────────────────────────────────
    if (status === MIDI_RT_STOP) {
      this._onStop();
      return;
    }

    // ── 0xF2 — Song Position Pointer ────────────────────────────────────
    // v3.36.0: per MIDI-Spec wird SPP nur akzeptiert wenn Transport NICHT
    // läuft. Der Master soll erst stop, dann SPP, dann start senden. Während
    // Playback würde SPP zu Audio-Glitches führen — wir verwerfen still.
    if (status === MIDI_SC_SPP && bytes.length >= 3) {
      if (this._isRunning) return;
      const lsb = bytes[1] & 0x7f;
      const msb = bytes[2] & 0x7f;
      const midiBeat = (msb << 7) | lsb;
      // 14-bit u14 implicit by the masks above → range 0..16383. Defensive
      // Sanity-Check vs. fremde / korrupte Streams.
      if (midiBeat < 0 || midiBeat > SPP_MAX_MIDI_BEAT) return;
      // 1 MIDI-Beat = 6 MIDI-Clocks = 1/16-Note → positionStep === midiBeat.
      const positionStep = midiBeat;
      this._pendingStartStep = positionStep;
      this._dispatch("midiclockin:spp", { midiBeat, positionStep });
      return;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _onTick(): void {
    const now = this._now();

    // Erster Tick nach Enable / Reset: nur Zeit merken, kein Interval rechnen.
    if (this._lastTickTime === 0) {
      this._lastTickTime = now;
      this._ticksSeen = 1;
      return;
    }

    const interval = now - this._lastTickTime;
    this._lastTickTime = now;
    this._ticksSeen++;

    // Pathologisch (z.B. NaN): ignorieren.
    if (interval <= 0 || !isFinite(interval)) return;

    // Outlier-Filter: aktuelles Intervall extrem off vom Mean? → discard.
    // Hot-Path: nur EWMA-Update, kein Mapping/Array.
    if (!isOutlier(interval, this._meanInterval)) {
      this._meanInterval = ewmaStep(this._meanInterval, interval);
    }

    // Tempo-Event throttled: nur emit wenn (a) genug samples UND (b) BPM-Δ ≥ 0.1.
    if (this._ticksSeen >= TEMPO_MIN_SAMPLES && this._meanInterval !== null) {
      const bpm = bpmFromTickInterval(this._meanInterval);
      if (bpm !== null && bpm !== this._lastEmittedBpm) {
        this._lastEmittedBpm = bpm;
        this._dispatch("midiclockin:tempo", { bpm, raw: 60000 / (this._meanInterval * MIDI_PPQN) });
      }
    }
  }

  private _onStart(): void {
    const now = this._now();
    this._isRunning = true;
    // Position-Reset: tick-counter wird auf 0 gesetzt damit beim ersten
    // nachfolgenden 0xF8 wieder mit "first sample" begonnen wird. Mean bleibt
    // bestehen — das ist der ganze Sinn eines Slave: BPM-Schätzung läuft auch
    // über stop/start hinweg weiter, damit ein erneuter Start nicht 6 Ticks
    // braucht bis ein BPM kommt.
    this._lastTickTime = 0;
    this._ticksSeen = 0;
    // v3.36.0: pendingStartStep (aus letztem SPP) wird beim Start verbraucht.
    // null → konventionelles Start-from-0. Wir reichen die positionStep im
    // Event-Detail weiter, damit der Bridge-Listener AudioEngine.seekToStep
    // aufrufen kann.
    const positionStep = this._pendingStartStep ?? 0;
    this._pendingStartStep = null;
    this._dispatch("midiclockin:start", { time: now, positionStep });
  }

  private _onContinue(): void {
    const now = this._now();
    this._isRunning = true;
    this._dispatch("midiclockin:continue", { time: now });
  }

  private _onStop(): void {
    const now = this._now();
    this._isRunning = false;
    this._dispatch("midiclockin:stop", { time: now });
  }
}

// ─── Default-Dispatch: window CustomEvent ───────────────────────────────────

function defaultDispatch(event: string, detail: unknown): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(event, { detail }));
  } catch {
    /* swallow — niemals tick-handler crashen lassen */
  }
}
