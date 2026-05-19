/**
 * Synthstudio — MidiClickOut.ts (v3.98.0)
 *
 * MIDI-Click-Track-Output für externe Hardware-Sync. Sendet pro Beat eine
 * MIDI-Note an einen externen Empfaenger (KORG Volca, Drum-Machine, etc.) —
 * parallel zum lokalen Metronom in AudioEngine._scheduleStep.
 *
 * Architektur (analog MidiClockOut / MidiNoteOut):
 *   - Dependency-Injection-Sender: `(outputId, bytes) => void`. Damit ohne
 *     Web-MIDI in Node testbar.
 *   - Ein einziger Output + ein einziger Channel pro Click — der externe
 *     Empfaenger erwartet typischerweise einen festen Trigger-Punkt.
 *   - `triggerStep(stepIndex, totalSteps, beatsPerBar, time)` wird vom
 *     AudioEngine fuer jeden Step aufgerufen. Berechnet ob es ein Downbeat
 *     (= Bar-Start, Accent-Note) oder ein weiterer Beat (Beat-Note) ist.
 *     Non-Beat-Steps werden ignoriert — wir feuern nur auf "1/4-Note"-Boundaries.
 *   - Note-Off-Timing: setTimeout mit `noteDurationMs` (default 50ms). Schnell
 *     genug fuer typische Drum-Trigger-In ports, lang genug damit der Empfaenger
 *     den Hit registriert.
 *
 * Beat-Detection: reuse der Formel aus AudioEngine-Metronom-Logik:
 *   closestBeat = round(stepIndex * beatsPerBar / totalSteps)
 *   representStep = round(closestBeat * totalSteps / beatsPerBar) % totalSteps
 *   isBeat = representStep === stepIndex
 * Damit funktioniert es bei beliebigen Pattern-Laengen (16/32/24/12 Steps)
 * und Taktarten (3/4, 4/4, 6/8 etc.).
 *
 * Disable-Policy: setEnabled(false) waehrend offener Note → sofortiger
 * Note-Off (kein "stuck note" auf der Hardware).
 */

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

export const DEFAULT_CLICK_NOTE_DURATION_MS = 50;
export const DEFAULT_ACCENT_NOTE = 76;   // GM: High Wood Block
export const DEFAULT_BEAT_NOTE = 77;     // GM: Low Wood Block
export const DEFAULT_ACCENT_VELOCITY = 110;
export const DEFAULT_BEAT_VELOCITY = 80;
export const DEFAULT_CLICK_CHANNEL = 9;  // MIDI Channel 10 = Drum-Channel (0-indexed)

/** Clamp MIDI-Velocity auf 0..127. NaN → 0. */
export function clampClickVelocity(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(127, Math.round(v)));
}

/** Clamp MIDI-Channel auf 0..15. */
export function clampClickChannel(ch: number): number {
  if (!Number.isFinite(ch)) return DEFAULT_CLICK_CHANNEL;
  return Math.max(0, Math.min(15, Math.round(ch)));
}

/** Clamp MIDI-Note auf 0..127. */
export function clampClickNote(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(127, Math.round(n)));
}

/** Erzeugt ein Note-On Status-Byte: 0x90 | channel (0..15). */
export function buildClickNoteOn(channel: number, note: number, velocity: number): [number, number, number] {
  return [0x90 | (clampClickChannel(channel) & 0x0f), clampClickNote(note), clampClickVelocity(velocity)];
}

/** Erzeugt ein Note-Off Status-Byte: 0x80 | channel, velocity=0. */
export function buildClickNoteOff(channel: number, note: number): [number, number, number] {
  return [0x80 | (clampClickChannel(channel) & 0x0f), clampClickNote(note), 0];
}

/**
 * Pure Beat-Detection. Liefert das ClickKind fuer einen Step oder null wenn
 * kein Beat. Identisch zur Logik im AudioEngine-Metronom — bei beliebigen
 * Pattern-Laengen + Taktarten korrekt.
 *
 * @param stepIndex     Aktueller Step (0-indexed).
 * @param totalSteps    Anzahl Steps im Pattern (typisch 16, 32).
 * @param beatsPerBar   Beats pro Bar (3/4, 4/4 etc., typisch 4).
 * @returns "accent" fuer Bar-Start (Step 0), "beat" fuer 2-3-4, null sonst.
 */
export type ClickKind = "accent" | "beat" | null;

export function detectClickKind(
  stepIndex: number,
  totalSteps: number,
  beatsPerBar: number,
): ClickKind {
  if (!Number.isFinite(stepIndex) || !Number.isFinite(totalSteps) || !Number.isFinite(beatsPerBar)) {
    return null;
  }
  if (totalSteps <= 0 || beatsPerBar <= 0) return null;
  if (stepIndex < 0 || stepIndex >= totalSteps) return null;
  const closestBeat = Math.round((stepIndex * beatsPerBar) / totalSteps);
  const representStep = Math.round((closestBeat * totalSteps) / beatsPerBar) % totalSteps;
  if (representStep !== stepIndex) return null;
  // Downbeat = Bar-Start = Step 0.
  return stepIndex === 0 ? "accent" : "beat";
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Sender bekommt outputId + rohe Bytes. Symmetrisch zu MidiNoteOut.
 * Der useMidi-Hook loest outputId zur Laufzeit gegen MIDIAccess.outputs auf.
 */
export type MidiClickSender = (outputId: string, bytes: number[]) => void;

export interface MidiClickConfig {
  outputId: string | null;
  channel: number;          // 0..15
  accentNote: number;       // 0..127
  beatNote: number;         // 0..127
  accentVelocity: number;   // 0..127
  beatVelocity: number;     // 0..127
}

export function defaultClickConfig(): MidiClickConfig {
  return {
    outputId: null,
    channel: DEFAULT_CLICK_CHANNEL,
    accentNote: DEFAULT_ACCENT_NOTE,
    beatNote: DEFAULT_BEAT_NOTE,
    accentVelocity: DEFAULT_ACCENT_VELOCITY,
    beatVelocity: DEFAULT_BEAT_VELOCITY,
  };
}

interface PendingOff {
  outputId: string;
  channel: number;
  note: number;
  timerId: ReturnType<typeof setTimeout>;
}

// ─── MidiClickOut Class ───────────────────────────────────────────────────────

export class MidiClickOut {
  private _sender: MidiClickSender | null;
  private _enabled = false;
  private _config: MidiClickConfig = defaultClickConfig();
  private _pendingOffs: PendingOff[] = [];

  constructor(sender: MidiClickSender | null = null) {
    this._sender = sender;
  }

  // ── Konfiguration ─────────────────────────────────────────────────────────

  setSender(sender: MidiClickSender | null): void {
    this._sender = sender;
  }

  setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    if (!enabled) this._flushAllNoteOffs();
  }

  get enabled(): boolean { return this._enabled; }

  setConfig(config: Partial<MidiClickConfig>): void {
    this._config = {
      outputId: config.outputId !== undefined ? config.outputId : this._config.outputId,
      channel: config.channel !== undefined ? clampClickChannel(config.channel) : this._config.channel,
      accentNote: config.accentNote !== undefined ? clampClickNote(config.accentNote) : this._config.accentNote,
      beatNote: config.beatNote !== undefined ? clampClickNote(config.beatNote) : this._config.beatNote,
      accentVelocity: config.accentVelocity !== undefined ? clampClickVelocity(config.accentVelocity) : this._config.accentVelocity,
      beatVelocity: config.beatVelocity !== undefined ? clampClickVelocity(config.beatVelocity) : this._config.beatVelocity,
    };
  }

  getConfig(): MidiClickConfig {
    return { ...this._config };
  }

  // ── Trigger ───────────────────────────────────────────────────────────────

  /**
   * Wird vom AudioEngine._scheduleStep fuer jeden Step aufgerufen. Sendet
   * Note-On + plant Note-Off nur wenn der Step ein Beat ist UND ein gueltiger
   * Output gesetzt ist UND enabled=true.
   *
   * @returns true wenn eine Note gesendet wurde, false sonst.
   */
  triggerStep(
    stepIndex: number,
    totalSteps: number,
    beatsPerBar: number,
    noteDurationMs = DEFAULT_CLICK_NOTE_DURATION_MS,
  ): boolean {
    if (!this._enabled) return false;
    if (!this._config.outputId) return false;
    const kind = detectClickKind(stepIndex, totalSteps, beatsPerBar);
    if (!kind) return false;

    const note = kind === "accent" ? this._config.accentNote : this._config.beatNote;
    const velocity = kind === "accent" ? this._config.accentVelocity : this._config.beatVelocity;
    const channel = this._config.channel;
    const outputId = this._config.outputId;

    this._send(outputId, buildClickNoteOn(channel, note, velocity));

    const duration = Math.max(1, Math.min(10_000, Math.round(noteDurationMs)));
    const timerId = setTimeout(() => {
      this._send(outputId, buildClickNoteOff(channel, note));
      this._pendingOffs = this._pendingOffs.filter(p => p.timerId !== timerId);
    }, duration);
    this._pendingOffs.push({ outputId, channel, note, timerId });

    return true;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _send(outputId: string, bytes: number[]): void {
    if (!this._sender || !outputId) return;
    try { this._sender(outputId, bytes); } catch { /* swallow */ }
  }

  private _flushAllNoteOffs(): void {
    for (const pending of this._pendingOffs) {
      clearTimeout(pending.timerId);
      this._send(pending.outputId, buildClickNoteOff(pending.channel, pending.note));
    }
    this._pendingOffs = [];
  }
}
