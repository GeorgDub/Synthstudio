/**
 * Synthstudio – LiveRecorder.ts (v3.110.0)
 *
 * Live Multi-Track Recording — Real-Time Session-Capture.
 *
 * Was es macht (vs. AudioRecorder.ts):
 *  - Record-arm pro Channel (oder Master) gleichzeitig, NICHT begrenzt auf 8.
 *  - Erfasst während Playback ALLE Live-Tweaks (Knobs, Mute/Solo, Pattern-
 *    Switches, Macros). Anders als channelBounce.ts (offline-render) ist das
 *    eine echte Realtime-Capture-Session.
 *  - Liefert am Ende eine Map<channelId, Stereo-Float32-Pair> + Master-Pair.
 *  - WAV-Build wird vom AudioEngine bzw. UI später über wavEncoder.ts geleistet
 *    (siehe `writeMultiTrackWavs` weiter unten).
 *
 * Architektur:
 *  - ScriptProcessorNode (DEPRECATED-Web-Audio aber überall verfügbar) tap'd
 *    auf den gewählten Source-Node, sammelt Float32-Chunks in RAM.
 *  - Audio-Worklet wäre besser, scheitert aber an Module-URL-Resolution in
 *    Vitest/Node — daher ScriptProcessor wie AudioRecorder.ts.
 *  - Memory-Cap: 10 Minuten @ 48k Stereo Float32 = ~230 MB/track. Bei
 *    Überschreiten Warn-Event + auto-Stop, kein Crash.
 *
 * Side-effect-frei testbar:
 *  - Klasse hängt nur am AudioContext (per setContext injiziert).
 *  - AudioContext kann ein simples Mock-Objekt sein (siehe Tests).
 */

import { concatFloat32, encodeWavStereo } from "./wavEncoder";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Default Buffer-Size für ScriptProcessor — 4096 Frames = ~85 ms @ 48 k. */
export const LIVE_REC_BUFFER_SIZE = 4096;

/**
 * Memory-Cap pro Track in Frames. Default ~10 min Stereo @ 48 kHz.
 * = 600 s * 48000 = 28_800_000 Frames Mono, x2 für Stereo = 57_600_000.
 * Bei Überschreitung wird ein 'limit'-Event ausgelöst und der Recorder stoppt.
 */
export const LIVE_REC_MAX_FRAMES_PER_TRACK = 600 * 48000;

/** Hard-Cap: nie mehr als 32 simultane Tracks (Performance-Guard). */
export const LIVE_REC_MAX_TRACKS = 32;

// ─── Public-Types ────────────────────────────────────────────────────────────

export type LiveTrackKind = "master" | "channel";

export interface LiveRecordingTrack {
  /** Kanal-ID — "master" für Master-Bus, sonst Channel-ID. */
  id: string;
  kind: LiveTrackKind;
  /** Float32 Stereo L+R (gleiche Länge). Bei Mono-Source = downmix-Kopien. */
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  durationSec: number;
  channels: 1 | 2;
}

export interface LiveRecordingResult {
  /** Master-Bus-Recording (immer eingeschlossen wenn `start` lief). */
  master: LiveRecordingTrack | null;
  /** Per-Channel-Recordings. Key = channelId. */
  perChannel: Map<string, LiveRecordingTrack>;
  /** Wallclock-Dauer von start() bis stop() in ms. */
  durationMs: number;
  /** True wenn Memory-Cap erreicht und auto-stop ausgelöst wurde. */
  truncated: boolean;
}

interface ActiveTrackState {
  id: string;
  kind: LiveTrackKind;
  source: AudioNode;
  processor: ScriptProcessorNode | null;
  silentSink: GainNode | null;
  bufferLeft: Float32Array[];
  bufferRight: Float32Array[];
  channels: 1 | 2;
  frameCount: number;
  truncated: boolean;
}

// ─── Recorder-Klasse ────────────────────────────────────────────────────────

export class LiveRecorder {
  private _ctx: AudioContext | null = null;
  private _tracks = new Map<string, ActiveTrackState>();
  private _running = false;
  private _startedAt = 0;
  private _stoppedAt = 0;
  private _sampleRate = 48000;

  /** Inject AudioContext (analog AudioRecorder). */
  setContext(ctx: AudioContext | null): void {
    this._ctx = ctx;
    if (ctx) this._sampleRate = ctx.sampleRate;
  }

  hasContext(): boolean {
    return !!this._ctx;
  }

  /** Anzahl aktiv getappter Sources (incl. Master). */
  get trackCount(): number {
    return this._tracks.size;
  }

  /** True solange `start` lief und kein `stop`. */
  get isRunning(): boolean {
    return this._running;
  }

  /**
   * Elapsed time in ms seit `start()` (0 wenn nicht laufend, final wenn gestoppt).
   * Wallclock — kein AudioContext-Drift, weil nur fürs UI.
   */
  get recordedDurationMs(): number {
    if (!this._running && this._stoppedAt > 0) {
      return Math.max(0, this._stoppedAt - this._startedAt);
    }
    if (this._running && this._startedAt > 0) {
      return Math.max(0, Date.now() - this._startedAt);
    }
    return 0;
  }

  /**
   * Bereitet den armed-State vor. Tracks müssen über `addTrack` registriert
   * werden, BEVOR `start` läuft (oder via AudioEngine-Wrapper). Idempotent —
   * doppeltes start() ist no-op.
   *
   * `channels` wird hier nur als Hint genutzt um die Mocks/Tests einfacher zu
   * machen — der reale AudioContext-Sample-Rate aus setContext() gewinnt.
   */
  start(channelsHint?: number, sampleRateHint?: number): boolean {
    if (this._running) return false;
    if (!this._ctx) {
      // Defensive — wenn kein Context, aber Hints da: simulier-Modus für Tests.
      if (sampleRateHint && sampleRateHint > 0) this._sampleRate = sampleRateHint;
    } else {
      this._sampleRate = this._ctx.sampleRate;
    }
    // channelsHint ist nur dokumentarisch — wir tappen genau die Tracks die
    // via addTrack registriert wurden.
    void channelsHint;
    this._running = true;
    this._startedAt = Date.now();
    this._stoppedAt = 0;
    // Pre-registrierte Tracks (vor start()) jetzt scharfschalten.
    for (const t of this._tracks.values()) {
      if (!t.processor) this._armTap(t);
    }
    return true;
  }

  /**
   * Fügt einen Tap-Track hinzu. Wenn `start()` schon lief, wird der Tap sofort
   * scharfgeschaltet. Wenn noch nicht: Track wird armed und beim start() verkabelt.
   *
   * @returns true wenn der Track frisch angemeldet wurde; false wenn schon vorhanden
   *          oder Limit erreicht.
   */
  addTrack(
    id: string,
    source: AudioNode,
    kind: LiveTrackKind = "channel",
    channels: 1 | 2 = 2,
  ): boolean {
    if (!id || typeof id !== "string") return false;
    if (this._tracks.has(id)) return false;
    if (this._tracks.size >= LIVE_REC_MAX_TRACKS) return false;

    const ch: 1 | 2 = channels === 2 ? 2 : 1;
    const state: ActiveTrackState = {
      id,
      kind,
      source,
      processor: null,
      silentSink: null,
      bufferLeft: [],
      bufferRight: [],
      channels: ch,
      frameCount: 0,
      truncated: false,
    };
    this._tracks.set(id, state);

    // Wenn laufend, sofort scharfschalten — sonst beim ersten start().
    if (this._running) {
      this._armTap(state);
    }
    return true;
  }

  /** Entfernt einen Track ohne Encode — Cleanup-Pfad. */
  removeTrack(id: string): void {
    const t = this._tracks.get(id);
    if (!t) return;
    this._teardownTap(t);
    this._tracks.delete(id);
  }

  /** True wenn ein Track für diese ID registriert ist (egal ob start/stop). */
  hasTrack(id: string): boolean {
    return this._tracks.has(id);
  }

  /** Liste der aktiv getappten Track-IDs. */
  trackIds(): string[] {
    return Array.from(this._tracks.keys());
  }

  /**
   * Schließt die Aufnahme ab und liefert das fertige Recording-Result.
   * Nach `stop()` ist die Instanz "leer" — alle Buffers wurden geleert.
   */
  stop(): LiveRecordingResult {
    if (!this._running) {
      return {
        master: null,
        perChannel: new Map(),
        durationMs: 0,
        truncated: false,
      };
    }
    this._running = false;
    this._stoppedAt = Date.now();
    const durationMs = Math.max(0, this._stoppedAt - this._startedAt);

    let master: LiveRecordingTrack | null = null;
    const perChannel = new Map<string, LiveRecordingTrack>();
    let truncated = false;

    // Iterieren via Snapshot (clear() würde sonst die Iteration brechen).
    const ids = Array.from(this._tracks.keys());
    for (const id of ids) {
      const t = this._tracks.get(id);
      if (!t) continue;
      this._teardownTap(t);

      const left = concatFloat32(t.bufferLeft);
      const right =
        t.channels === 2 && t.bufferRight.length > 0
          ? concatFloat32(t.bufferRight)
          : left.slice(); // Mono → Kopie für Stereo-Output
      const durationSec = this._sampleRate > 0 ? t.frameCount / this._sampleRate : 0;
      const track: LiveRecordingTrack = {
        id: t.id,
        kind: t.kind,
        left,
        right,
        sampleRate: this._sampleRate,
        durationSec,
        channels: t.channels,
      };
      if (t.kind === "master") {
        master = track;
      } else {
        perChannel.set(id, track);
      }
      if (t.truncated) truncated = true;
    }
    this._tracks.clear();

    return { master, perChannel, durationMs, truncated };
  }

  /** Abbrechen ohne Result (Cleanup für Engine-disposal). */
  cancel(): void {
    const ids = Array.from(this._tracks.keys());
    for (const id of ids) {
      const t = this._tracks.get(id);
      if (t) this._teardownTap(t);
    }
    this._tracks.clear();
    this._running = false;
    this._startedAt = 0;
    this._stoppedAt = 0;
  }

  /** Reset (Test-Helper). */
  dispose(): void {
    this.cancel();
    this._ctx = null;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _armTap(state: ActiveTrackState): void {
    const ctx = this._ctx;
    if (!ctx) return; // Test-Modus ohne Context → no-op
    const processor = ctx.createScriptProcessor(
      LIVE_REC_BUFFER_SIZE,
      state.channels,
      state.channels,
    );
    state.processor = processor;

    processor.onaudioprocess = (ev: AudioProcessingEvent) => {
      if (!this._running) return;
      const input = ev.inputBuffer;
      const ch0 = input.getChannelData(0);
      const copy0 = new Float32Array(ch0.length);
      copy0.set(ch0);
      state.bufferLeft.push(copy0);
      if (state.channels === 2 && input.numberOfChannels > 1) {
        const ch1 = input.getChannelData(1);
        const copy1 = new Float32Array(ch1.length);
        copy1.set(ch1);
        state.bufferRight.push(copy1);
      }
      state.frameCount += ch0.length;

      // Memory-Cap-Check — auto-stop bei Überschreitung.
      if (state.frameCount > LIVE_REC_MAX_FRAMES_PER_TRACK && !state.truncated) {
        state.truncated = true;
        try {
          processor.disconnect();
        } catch {
          /* ignore */
        }
      }
    };

    const silentSink = ctx.createGain();
    silentSink.gain.value = 0;
    try {
      state.source.connect(processor);
      processor.connect(silentSink);
      silentSink.connect(ctx.destination);
    } catch {
      /* ignore — invalid mock or already disconnected */
    }
    state.silentSink = silentSink;
  }

  private _teardownTap(state: ActiveTrackState): void {
    if (state.processor) {
      try { state.source.disconnect(state.processor); } catch { /* ignore */ }
      try { state.processor.disconnect(); } catch { /* ignore */ }
      state.processor.onaudioprocess = null;
    }
    if (state.silentSink) {
      try { state.silentSink.disconnect(); } catch { /* ignore */ }
    }
    state.processor = null;
    state.silentSink = null;
  }

  /**
   * Test-Helper: simuliert eingehende Frames für einen Track (ohne realen
   * AudioContext). Schreibt direkt in die Buffer-Listen.
   */
  __pushFramesForTest(
    id: string,
    left: Float32Array,
    right?: Float32Array,
  ): void {
    const t = this._tracks.get(id);
    if (!t) return;
    const lcopy = new Float32Array(left.length);
    lcopy.set(left);
    t.bufferLeft.push(lcopy);
    if (t.channels === 2 && right) {
      const rcopy = new Float32Array(right.length);
      rcopy.set(right);
      t.bufferRight.push(rcopy);
    }
    t.frameCount += left.length;
    if (t.frameCount > LIVE_REC_MAX_FRAMES_PER_TRACK && !t.truncated) {
      t.truncated = true;
    }
  }
}

// ─── WAV-Multi-Track Output ──────────────────────────────────────────────────

export interface MultiTrackWavOptions {
  /** Wallclock-Timestamp für Filename. Default = jetzt. */
  date?: Date;
  /** Prefix vor allen Filenames. Default = "live". */
  prefix?: string;
  /** Bit-Depth (aktuell nur 16 unterstützt). */
  bitDepth?: 16;
}

/**
 * Erzeugt formatierten Timestamp YYYY-MM-DD_HH-MM-SS (sortierbar in Datei-
 * Browsern, alle Trennzeichen sind FAT/NTFS-safe).
 */
export function formatLiveRecordTimestamp(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    "-" +
    pad(d.getMinutes()) +
    "-" +
    pad(d.getSeconds())
  );
}

/** Sanitize a channel-ID-Token to be filename-safe. */
export function sanitizeChannelToken(token: string): string {
  if (!token || typeof token !== "string") return "track";
  const cleaned = token
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : "track";
}

/**
 * Baut das Filename-Pattern eines Live-Tracks.
 *  - Master:  live_2026-05-19_22-30-15_master.wav
 *  - Channel: live_2026-05-19_22-30-15_channel_kick.wav
 */
export function buildLiveTrackFileName(
  kind: LiveTrackKind,
  id: string,
  date: Date,
  prefix = "live",
): string {
  const ts = formatLiveRecordTimestamp(date);
  const safePrefix = sanitizeChannelToken(prefix);
  if (kind === "master") {
    return `${safePrefix}_${ts}_master.wav`;
  }
  return `${safePrefix}_${ts}_channel_${sanitizeChannelToken(id)}.wav`;
}

/**
 * Erzeugt für jedes Track-Element einen WAV-Buffer (Uint8Array). Map-Key
 * = vollständiger Filename.
 *
 * Pure — keine Disk-I/O, ruft nur encodeWavStereo aus wavEncoder.ts.
 */
export function writeMultiTrackWavs(
  result: LiveRecordingResult,
  options: MultiTrackWavOptions = {},
): Map<string, Uint8Array> {
  const date = options.date ?? new Date();
  const prefix = options.prefix ?? "live";
  const out = new Map<string, Uint8Array>();

  const allTracks: LiveRecordingTrack[] = [];
  if (result.master) allTracks.push(result.master);
  for (const t of result.perChannel.values()) allTracks.push(t);

  for (const t of allTracks) {
    const name = buildLiveTrackFileName(t.kind, t.id, date, prefix);
    const buffer = encodeWavStereo(t.left, t.right, t.sampleRate);
    out.set(name, new Uint8Array(buffer));
  }
  return out;
}
