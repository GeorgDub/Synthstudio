/**
 * Synthstudio — MidiClockOut.ts (TASK-230 / v2.83.0)
 *
 * MIDI-Clock-Master-Implementierung. Sendet 24 PPQN-Clock-Pulse + Transport-
 * Realtime-Messages an einen registrierten MIDI-Output.
 *
 * Architektur:
 *   - Stateless gegenüber dem AudioContext: alle Tick-Zeitpunkte werden
 *     aus `currentTime`+BPM berechnet, NICHT aus setInterval.
 *   - Tick-Generator: drei Modi
 *       (1) `scheduleTicks(now, lookAhead, bpm)` — pulled aus `_schedule()`,
 *           wir berechnen wieviele Ticks im [lastTickTime+1Tick .. now+lookAhead]
 *           liegen und feuern sie sofort. Drift-arm da AudioContext.currentTime
 *           monoton steigt.
 *       (2) `start(now)` — sendet 0xFA, setzt nextTickTime = now (erster Tick
 *           feuert beim nächsten schedule).
 *       (3) `stop()` — sendet 0xFC, hält Zustand zurück.
 *       (4) `resume(now)` — sendet 0xFB (Continue), kein Position-Reset.
 *
 * Output-Strategie:
 *   - Sender ist ein injizierter Callback `(bytes: number[]) => void`.
 *   - Damit ist die Klasse OHNE Web-MIDI testbar — wir checken nur was wann
 *     gesendet wurde.
 *
 * KEINE setInterval/setTimeout — alle Timing-Entscheidungen kommen vom
 * Caller (AudioEngine._schedule). Damit ist Drift gegenüber Audio-Scheduling
 * < 1 Tick (~20ms bei 120 BPM).
 */

import {
  MIDI_CLOCK_TICK,
  MIDI_CLOCK_START,
  MIDI_CLOCK_CONTINUE,
  MIDI_CLOCK_STOP,
  MIDI_PPQN,
  buildSongPositionPointer,
} from "../utils/midiOutput";

export type MidiClockSender = (bytes: number[]) => void;

/** Transport-Phase aus Sicht der Clock — separat vom AudioEngine-State. */
export type MidiClockPhase = "stopped" | "running";

/**
 * Berechnet die Dauer eines einzelnen Clock-Tick-Pulses in Sekunden bei
 * gegebener BPM. 24 PPQN → 1 Tick = 60s / (BPM * 24).
 */
export function tickDurationSec(bpm: number): number {
  const safeBpm = Math.max(20, Math.min(300, bpm));
  return 60 / (safeBpm * MIDI_PPQN);
}

/**
 * Reine Helper-Funktion: gegeben den nächsten geplanten Tick-Zeitpunkt, eine
 * Look-Ahead-Grenze und BPM, liefert die Liste der Zeitpunkte für jeden Tick
 * der im Fenster fällt. Pure, deterministisch, ohne Side-Effects.
 *
 * @returns `{ tickTimes, newNextTickTime, tickCount }`
 */
export function planTicks(
  nextTickTime: number,
  lookAheadUntil: number,
  bpm: number,
): { tickTimes: number[]; newNextTickTime: number; tickCount: number } {
  const dur = tickDurationSec(bpm);
  const tickTimes: number[] = [];
  let t = nextTickTime;
  // Schutz gegen runaway-loop bei pathologischen Inputs.
  let safetyCounter = 0;
  while (t <= lookAheadUntil && safetyCounter < 10_000) {
    tickTimes.push(t);
    t += dur;
    safetyCounter++;
  }
  return { tickTimes, newNextTickTime: t, tickCount: tickTimes.length };
}

/**
 * Stateful Clock-Out-Generator. Eine Instanz pro AudioEngine.
 *
 * Lebenszyklus:
 *   ctor(sender) → start(now) → scheduleTicks(...) … → stop() → start(now) …
 *
 * Re-konfigurierbar zur Laufzeit:
 *   setEnabled(false) → setEnabled(true) preserved Position aber kein Auto-Restart.
 *   setSender(...) → ersetzt den Output-Callback (z.B. wenn User Device wechselt).
 */
export class MidiClockOut {
  private _phase: MidiClockPhase = "stopped";
  private _enabled = false;
  private _nextTickTime = 0;
  private _ticksSinceStart = 0;
  private _sender: MidiClockSender | null;

  constructor(sender: MidiClockSender | null = null) {
    this._sender = sender;
  }

  // ── Konfiguration ─────────────────────────────────────────────────────────

  setSender(sender: MidiClockSender | null): void {
    this._sender = sender;
  }

  setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    // Wenn während laufendem Transport deaktiviert: Stop senden, aber Phase
    // NICHT auf "stopped" setzen — Engine ist weiter playing, falls User
    // wieder enabled, soll Continue gehen. Damit der externe Empfänger nicht
    // hängenbleibt, senden wir den Stop sofort.
    if (!enabled && this._phase === "running") {
      this._send([MIDI_CLOCK_STOP]);
    }
    // Wenn re-enabled während laufendem Transport: Continue + Position-Pointer.
    // Caller muss aber NICHT zwingend start() rufen — wir handeln das hier
    // defensiv: er sollte resume() aufrufen damit nextTickTime gesetzt wird.
  }

  get enabled(): boolean { return this._enabled; }
  get phase(): MidiClockPhase { return this._phase; }
  get nextTickTime(): number { return this._nextTickTime; }
  get ticksSinceStart(): number { return this._ticksSinceStart; }

  // ── Transport-Übergänge ───────────────────────────────────────────────────

  /**
   * Wird beim AudioEngine.play() aufgerufen. Sendet 0xFA (Start) und resettet
   * den Tick-Counter — d.h. externe Empfänger interpretieren das als
   * "Position auf Bar 1, Beat 1".
   *
   * @param now Aktuelle AudioContext.currentTime (in Sekunden).
   */
  start(now: number): void {
    this._ticksSinceStart = 0;
    this._nextTickTime = now;
    this._phase = "running";
    if (!this._enabled) return;
    this._send([MIDI_CLOCK_START]);
  }

  /**
   * Wird beim AudioEngine.stop() aufgerufen. Sendet 0xFC und setzt Phase auf
   * "stopped". Der Tick-Counter wird NICHT resettet — damit ein subsequenter
   * resume() weiterzählen kann (für SPP-Berechnung).
   */
  stop(): void {
    if (this._phase === "stopped") return;
    this._phase = "stopped";
    if (!this._enabled) return;
    this._send([MIDI_CLOCK_STOP]);
  }

  /**
   * Wird beim Resume aus Pause aufgerufen. Sendet 0xFB (Continue). Optional
   * sendet zuvor eine SPP (Song-Position-Pointer) damit der externe Empfänger
   * die Bar-Position korrekt setzt.
   *
   * @param now Aktuelle AudioContext.currentTime.
   * @param sendSpp Wenn true (default), sendet SPP basierend auf ticksSinceStart.
   */
  resume(now: number, sendSpp = true): void {
    this._nextTickTime = now;
    this._phase = "running";
    if (!this._enabled) return;
    if (sendSpp) {
      // 1 MIDI-Beat = 6 Clock-Pulse (1/16-Note)
      const midiBeat = Math.floor(this._ticksSinceStart / 6);
      this._send(buildSongPositionPointer(midiBeat));
    }
    this._send([MIDI_CLOCK_CONTINUE]);
  }

  /**
   * Sendet einen Song-Position-Pointer für die gegebene MIDI-Beat-Position.
   * Wird typischerweise bei Pattern-Wechsel oder manuellem Seek aufgerufen.
   * Setzt auch den internen ticksSinceStart-Counter neu.
   */
  sendSongPosition(midiBeat: number): void {
    this._ticksSinceStart = Math.max(0, midiBeat) * 6;
    if (!this._enabled) return;
    this._send(buildSongPositionPointer(midiBeat));
  }

  // ── Tick-Scheduling ───────────────────────────────────────────────────────

  /**
   * Wird vom AudioEngine._schedule()-Loop aufgerufen. Berechnet alle Ticks im
   * [_nextTickTime, lookAheadUntil] und sendet sie. Drift-Robust: nextTickTime
   * wird mit der exakten Tick-Dauer fortgeschrieben statt mit dem aktuellen
   * `now` — Akkumulationsfehler sind dadurch ausgeschlossen.
   *
   * @returns Anzahl gesendeter Ticks (für Tests/Debug).
   */
  scheduleTicks(lookAheadUntil: number, bpm: number): number {
    if (!this._enabled || this._phase !== "running") return 0;
    const plan = planTicks(this._nextTickTime, lookAheadUntil, bpm);
    for (let i = 0; i < plan.tickTimes.length; i++) {
      this._send([MIDI_CLOCK_TICK]);
      this._ticksSinceStart++;
    }
    this._nextTickTime = plan.newNextTickTime;
    return plan.tickCount;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _send(bytes: number[]): void {
    if (!this._sender) return;
    try { this._sender(bytes); } catch { /* swallow */ }
  }
}
