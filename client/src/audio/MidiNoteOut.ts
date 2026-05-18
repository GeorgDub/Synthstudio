/**
 * Synthstudio — MidiNoteOut.ts (TASK-240 / v2.92.0)
 *
 * Per-Part MIDI-Note-Output. Erlaubt Synthstudio, Note-Events an externe
 * MIDI-Geräte (z.B. KORG Electribe 2 als Sound-Modul) zu schicken statt nur
 * lokal Drum-Samples abzuspielen. Komplettiert die KORG-Bidir-Brücke:
 *   - v2.83 brachte MIDI-Clock-Out (Sync der Timeline)
 *   - v2.92 bringt MIDI-Note-Out (Note-Trigger der Drum-Engine extern)
 *
 * Architektur (analog MidiClockOut):
 *   - Dependency-Injection-Sender: `(bytes: number[]) => void`. Damit ohne
 *     Web-MIDI in Node testbar.
 *   - Per-Part Config-Map: `Map<partId, MidiPartConfig>`. Wird vom UI
 *     (ChannelInspector) via `setPartConfig` befüllt.
 *   - `triggerNote(partId, time, velocity)` wird vom AudioEngine._scheduleStep
 *     für jeden gefeuerten Step aufgerufen — parallel zum (optionalen) lokalen
 *     Sample-Playback.
 *   - Note-Off-Timing: setTimeout mit `noteDurationMs`. Konsistent zur
 *     bisherigen MIDI-Send-Architektur in AudioEngine (`_midiOutCallback`).
 *     Alternative wäre AudioContext.setValueAtTime, das aber MIDI nicht
 *     scheduled — deshalb pragmatisch via JS-Timer.
 *
 * Retrigger-Policy: Wenn dieselbe Note erneut getriggert wird bevor das
 * Note-Off raus ist, feuern wir sofort ein Note-Off (cancel pending) und
 * dann das neue Note-On. Damit gibt es keine hängenden Noten und keine
 * Overlap-Stacks beim externen Empfänger.
 *
 * setEnabled(false) während offene Notes → alle pending Note-Offs werden
 * sofort gesendet, sonst bleiben sie auf dem externen Gerät hängen
 * (klassischer "Stuck Note"-Bug).
 */

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

/** Default Note-Length in ms wenn config.noteDurationMs nicht gesetzt ist. */
export const DEFAULT_NOTE_DURATION_MS = 100;

/** Minimale erlaubte Note-Duration. < 1 ms macht keinen Sinn (Note-Off käme vor Note-On). */
export const MIN_NOTE_DURATION_MS = 1;

/** Maximale Note-Duration. Verhindert hängende Notes durch User-Fehler. */
export const MAX_NOTE_DURATION_MS = 10_000;

/** Clamp MIDI-Velocity auf 0..127. NaN → 0. */
export function clampVelocity(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(127, Math.round(v)));
}

/** Clamp MIDI-Channel auf 0..15. */
export function clampMidiChannel(ch: number): number {
  if (!Number.isFinite(ch)) return 0;
  return Math.max(0, Math.min(15, Math.round(ch)));
}

/** Clamp MIDI-Note auf 0..127. */
export function clampMidiNote(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(127, Math.round(n)));
}

/** Clamp Note-Duration. */
export function clampNoteDuration(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_NOTE_DURATION_MS;
  return Math.max(MIN_NOTE_DURATION_MS, Math.min(MAX_NOTE_DURATION_MS, Math.round(ms)));
}

/**
 * Erzeugt ein Note-On Status-Byte für den angegebenen Channel (0..15).
 * MIDI 1.0: 0x90 | channel.
 */
export function buildNoteOn(channel: number, note: number, velocity: number): [number, number, number] {
  return [0x90 | (clampMidiChannel(channel) & 0x0f), clampMidiNote(note), clampVelocity(velocity)];
}

/**
 * Erzeugt ein Note-Off Status-Byte für den angegebenen Channel.
 * MIDI 1.0: 0x80 | channel, velocity=0 (Standard für Sample-Player wie
 * Electribe — Release-Velocity ist nicht relevant).
 */
export function buildNoteOff(channel: number, note: number): [number, number, number] {
  return [0x80 | (clampMidiChannel(channel) & 0x0f), clampMidiNote(note), 0];
}

/** Liefert den Notennamen für eine MIDI-Nummer. C-1 = 0, C4 = 60 (Yamaha-Konvention). */
export function noteNameFromNumber(n: number): string {
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const clamped = clampMidiNote(n);
  const oct = Math.floor(clamped / 12) - 1;
  const name = NAMES[clamped % 12];
  return `${name}${oct}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Sender bekommt die outputId aus der jeweils aktiven Per-Part-Config plus
 * die rohen Bytes. Damit kann ein einziger Sender alle Configs bedienen — der
 * useMidi-Hook löst die outputId zur Laufzeit gegen MIDIAccess.outputs auf.
 */
export type MidiNoteSender = (outputId: string, bytes: number[]) => void;

/**
 * Konfiguration für einen einzelnen Drum-Part. Gespeichert pro `partId`.
 * `localSoundEnabled` steuert ob neben dem MIDI-Send auch das lokale Sample
 * spielt — manche User wollen Layering (Local + MIDI), andere nur extern.
 * Default: true (Layering ist die User-Erwartung beim ersten Einrichten).
 */
export interface MidiPartConfig {
  outputId: string;
  channel: number;          // 0..15
  note: number;             // 0..127
  noteDurationMs?: number;  // default DEFAULT_NOTE_DURATION_MS
  localSoundEnabled?: boolean; // default true
}

interface PendingNoteOff {
  partId: string;
  outputId: string;
  channel: number;
  note: number;
  timerId: ReturnType<typeof setTimeout>;
}

// ─── MidiNoteOut Class ────────────────────────────────────────────────────────

export class MidiNoteOut {
  private _sender: MidiNoteSender | null;
  private _enabled = false;
  private _configs: Map<string, MidiPartConfig> = new Map();
  /** Eine Map<partId, PendingNoteOff>, damit Retrigger den Vorgänger killen kann. */
  private _pendingOffs: Map<string, PendingNoteOff> = new Map();

  constructor(sender: MidiNoteSender | null = null) {
    this._sender = sender;
  }

  // ── Konfiguration ─────────────────────────────────────────────────────────

  setSender(sender: MidiNoteSender | null): void {
    this._sender = sender;
  }

  setEnabled(enabled: boolean): void {
    if (this._enabled === enabled) return;
    this._enabled = enabled;
    if (!enabled) {
      // Disable während offene Notes → alle pending Note-Offs sofort senden,
      // sonst bleiben sie auf dem externen Gerät als "stuck notes" hängen.
      this._flushAllNoteOffs();
    }
  }

  get enabled(): boolean { return this._enabled; }

  /** Setzt die Output-Config für einen Part. Überschreibt existierende Config. */
  setPartConfig(partId: string, config: MidiPartConfig): void {
    if (!partId || !config.outputId) return;
    this._configs.set(partId, {
      outputId: config.outputId,
      channel: clampMidiChannel(config.channel),
      note: clampMidiNote(config.note),
      noteDurationMs: clampNoteDuration(config.noteDurationMs ?? DEFAULT_NOTE_DURATION_MS),
      localSoundEnabled: config.localSoundEnabled ?? true,
    });
  }

  /** Liest die aktuelle Config für einen Part oder null. */
  getPartConfig(partId: string): MidiPartConfig | null {
    return this._configs.get(partId) ?? null;
  }

  /** Entfernt die Config für einen Part — danach kein Note-Out mehr für ihn. */
  clearPartConfig(partId: string): void {
    this._cancelPendingOff(partId);
    this._configs.delete(partId);
  }

  /** Entfernt alle Configs (z.B. bei Project-Reset). */
  clearAllConfigs(): void {
    this._flushAllNoteOffs();
    this._configs.clear();
  }

  isPartConfigured(partId: string): boolean {
    return this._configs.has(partId);
  }

  getAllConfiguredPartIds(): string[] {
    return Array.from(this._configs.keys());
  }

  /**
   * Liefert true wenn der lokale Sound für diesen Part gespielt werden soll.
   * Verwendet vom AudioEngine._scheduleStep um zu entscheiden ob das Sample
   * lokal abgespielt wird.
   *
   * Regeln:
   *   - Kein Config → true (Backwards-Compat: Drum-Part spielt normal)
   *   - !enabled    → true (User hat MIDI-Out global aus)
   *   - sonst       → config.localSoundEnabled
   */
  shouldPlayLocalSound(partId: string): boolean {
    const cfg = this._configs.get(partId);
    if (!cfg) return true;
    if (!this._enabled) return true;
    return cfg.localSoundEnabled !== false;
  }

  // ── Note-Trigger ──────────────────────────────────────────────────────────

  /**
   * Wird vom AudioEngine._scheduleStep für jeden gefeuerten Step aufgerufen.
   * Schickt sofort ein Note-On und plant ein Note-Off via setTimeout.
   *
   * @param partId   Welcher Drum-Part feuert.
   * @param time    AudioContext-Zeit des Step-Triggers — derzeit nur für
   *                spätere Drift-Korrektur-Erweiterungen vorgehalten; das
   *                tatsächliche MIDI-Send läuft sofort (Web-MIDI kennt
   *                kein hardware-precise Scheduling).
   * @param velocity 0..127 (wird intern geclampt).
   * @returns true wenn ein Note-On gesendet wurde, false sonst.
   */
  triggerNote(partId: string, _time: number, velocity: number): boolean {
    if (!this._enabled) return false;
    const cfg = this._configs.get(partId);
    if (!cfg) return false;

    // Retrigger-Policy: wenn für diesen Part schon ein Note-Off pending ist,
    // sofort feuern damit es keine Overlap-Stuck-Notes gibt.
    this._cancelPendingOff(partId, /* sendOffNow */ true);

    const noteOn = buildNoteOn(cfg.channel, cfg.note, velocity);
    this._send(cfg.outputId, noteOn);

    const durationMs = cfg.noteDurationMs ?? DEFAULT_NOTE_DURATION_MS;
    const outputId = cfg.outputId;
    const channel = cfg.channel;
    const note = cfg.note;
    const timerId = setTimeout(() => {
      const off = buildNoteOff(channel, note);
      this._send(outputId, off);
      this._pendingOffs.delete(partId);
    }, durationMs);

    this._pendingOffs.set(partId, {
      partId,
      outputId,
      channel,
      note,
      timerId,
    });

    return true;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _send(outputId: string, bytes: number[]): void {
    if (!this._sender || !outputId) return;
    try { this._sender(outputId, bytes); } catch { /* swallow disconnected-device errors */ }
  }

  private _cancelPendingOff(partId: string, sendOffNow = false): void {
    const pending = this._pendingOffs.get(partId);
    if (!pending) return;
    clearTimeout(pending.timerId);
    if (sendOffNow) {
      this._send(pending.outputId, buildNoteOff(pending.channel, pending.note));
    }
    this._pendingOffs.delete(partId);
  }

  private _flushAllNoteOffs(): void {
    for (const pending of this._pendingOffs.values()) {
      clearTimeout(pending.timerId);
      this._send(pending.outputId, buildNoteOff(pending.channel, pending.note));
    }
    this._pendingOffs.clear();
  }
}
