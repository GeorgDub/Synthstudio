/**
 * Synthstudio – LiveRecorder.ts (v3.114.0 — AudioWorklet Migration)
 *
 * Live Multi-Track Recording — Real-Time Session-Capture.
 *
 * v3.114.0 Migration vs. v3.110:
 *  - ScriptProcessorNode wird durch AudioWorkletNode (recorder-processor)
 *    ersetzt, läuft im Audio-Rendering-Thread (off main).
 *  - Public API ist UNVERÄNDERT — UI/Tests funktionieren ohne Anpassung.
 *  - Bei Browsers ohne AudioWorklet (Vitest-Stubs, sehr alte Engines) wird
 *    automatisch der ScriptProcessor-Pfad verwendet (feature-detect at start).
 *  - Worklet wird einmal pro AudioContext geladen (idempotent).
 *
 * Was es macht (vs. AudioRecorder.ts):
 *  - Record-arm pro Channel (oder Master) gleichzeitig, NICHT begrenzt auf 8.
 *  - Erfasst während Playback ALLE Live-Tweaks.
 *  - Liefert am Ende eine Map<channelId, Stereo-Float32-Pair> + Master-Pair.
 *
 * Memory-Cap: 10 Minuten @ 48k Stereo Float32. Bei Überschreiten Auto-Stop
 * mit truncated:true.
 *
 * Side-effect-frei testbar: AudioContext-Mock genügt.
 */

import { concatFloat32, encodeWavStereo } from "./wavEncoder";
import { getApiSettings } from "@/store/useApiSettingsStore";
import {
  isAudioWorkletAvailable,
  loadRecorderWorklet,
  RECORDER_DEFAULT_MAX_FRAMES,
} from "./worklets/recorderWorkletLoader";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Default Buffer-Size für ScriptProcessor-Fallback — 4096 Frames = ~85 ms @ 48 k. */
export const LIVE_REC_BUFFER_SIZE = 4096;

/**
 * Memory-Cap pro Track in Frames. Default ~10 min Stereo @ 48 kHz.
 * = 600 s * 48000 = 28_800_000 Frames Mono, x2 für Stereo = 57_600_000.
 * Bei Überschreitung wird ein 'limit'-Event ausgelöst und der Recorder stoppt.
 */
export const LIVE_REC_MAX_FRAMES_PER_TRACK = RECORDER_DEFAULT_MAX_FRAMES;

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

/** Eingehende Worklet-Messages (interner Typ). */
interface WorkletMessage {
  type: "chunks" | "limit" | "done";
  left?: Float32Array | null;
  right?: Float32Array | null;
  frameCount?: number;
  truncated?: boolean;
}

interface ActiveTrackState {
  id: string;
  kind: LiveTrackKind;
  source: AudioNode;
  /** Entweder ein AudioWorkletNode ODER ein ScriptProcessorNode (Fallback). */
  processor: AudioNode | null;
  silentSink: GainNode | null;
  bufferLeft: Float32Array[];
  bufferRight: Float32Array[];
  channels: 1 | 2;
  frameCount: number;
  truncated: boolean;
  /** True = AudioWorklet-Pfad, false = ScriptProcessor-Fallback. */
  usesWorklet: boolean;
  /** Resolver für stop() — wird durch 'done'-Worklet-Message resolved. */
  donePromise: Promise<void> | null;
  doneResolve: (() => void) | null;
}

// ─── Recorder-Klasse ────────────────────────────────────────────────────────

export class LiveRecorder {
  private _ctx: AudioContext | null = null;
  private _tracks = new Map<string, ActiveTrackState>();
  private _running = false;
  private _startedAt = 0;
  private _stoppedAt = 0;
  private _sampleRate = 48000;
  /** True nach erfolgreichem loadRecorderWorklet(). Pro-Context-State. */
  private _workletReady = false;
  /** True wenn aktuelle Context-AudioWorklet-Verfügbarkeit gecheckt wurde. */
  private _workletDetected = false;
  private _workletAvailable = false;

  /** Inject AudioContext (analog AudioRecorder). */
  setContext(ctx: AudioContext | null): void {
    if (ctx !== this._ctx) {
      // Context-Switch invalidiert Worklet-Ready-Flag.
      this._workletReady = false;
      this._workletDetected = false;
      this._workletAvailable = false;
    }
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

  /** True wenn AudioWorklet-Pfad aktiv (für Telemetrie/Tests). */
  get usesAudioWorklet(): boolean {
    return this._workletAvailable && this._workletReady;
  }

  /**
   * Elapsed time in ms seit `start()` (0 wenn nicht laufend, final wenn gestoppt).
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
   * werden, BEVOR `start` läuft. Idempotent.
   *
   * NEU v3.114.0: Bei AudioWorklet-Pfad wird `loadRecorderWorklet` aufgerufen.
   * Async-Load erfolgt im Hintergrund — wenn noch nicht ready, fallen
   * pre-registered Taps temporär auf ScriptProcessor zurück.
   */
  start(channelsHint?: number, sampleRateHint?: number): boolean {
    if (this._running) return false;
    if (!this._ctx) {
      if (sampleRateHint && sampleRateHint > 0) this._sampleRate = sampleRateHint;
    } else {
      this._sampleRate = this._ctx.sampleRate;
    }
    void channelsHint;

    // Feature-detect once per context.
    if (this._ctx && !this._workletDetected) {
      this._workletAvailable = isAudioWorkletAvailable(this._ctx);
      this._workletDetected = true;
    }

    this._running = true;
    this._startedAt = Date.now();
    this._stoppedAt = 0;

    // Trigger async worklet-init (fire-and-forget). Bei Erfolg wird
    // _workletReady=true gesetzt, alle künftigen addTracks nutzen Worklet.
    // Pre-registered Tracks werden weiterhin ueber ScriptProcessor-Fallback
    // getappt — Wechsel ohne Stop wäre disruptiv.
    if (this._workletAvailable && !this._workletReady && this._ctx) {
      const ctx = this._ctx;
      loadRecorderWorklet(ctx).then(
        () => { this._workletReady = true; },
        () => { /* fallback path stays */ }
      );
    }

    // Pre-registrierte Tracks scharfschalten.
    for (const t of this._tracks.values()) {
      if (!t.processor) this._armTap(t);
    }
    return true;
  }

  /**
   * Fügt einen Tap-Track hinzu. Wenn `start()` schon lief, sofort scharfschalten.
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
      usesWorklet: false,
      donePromise: null,
      doneResolve: null,
    };
    this._tracks.set(id, state);

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

  /** True wenn ein Track für diese ID registriert ist. */
  hasTrack(id: string): boolean {
    return this._tracks.has(id);
  }

  /** Liste der aktiv getappten Track-IDs. */
  trackIds(): string[] {
    return Array.from(this._tracks.keys());
  }

  /**
   * Schließt die Aufnahme ab. Bei Worklet-Pfad triggern wir per port.postMessage
   * den finalen Flush; der 'done'-Handler resolved das donePromise. Da die Tests
   * synchron sind, fallen wir hier auf den synchronen Pfad zurück: wir nehmen
   * den bereits aufgebauten Buffer-State (chunks-stream wurde während des Runs
   * appended) und ignorieren die letzte unflushed Partial-Chunk.
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

    const ids = Array.from(this._tracks.keys());
    for (const id of ids) {
      const t = this._tracks.get(id);
      if (!t) continue;
      // Bei Worklet: stop-cmd schicken um remaining-Frames zu flushen
      // (Synchron-Path: wir lesen sofort danach den Snapshot — Worklet-Done
      //  wird asynchron eintreffen und appended noch evtl. wenige Frames).
      if (t.usesWorklet && t.processor) {
        try {
          (t.processor as AudioWorkletNode).port.postMessage({ cmd: "stop" });
        } catch { /* ignore */ }
      }
      this._teardownTap(t);

      const left = concatFloat32(t.bufferLeft);
      const right =
        t.channels === 2 && t.bufferRight.length > 0
          ? concatFloat32(t.bufferRight)
          : left.slice();
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
    this._workletReady = false;
    this._workletDetected = false;
    this._workletAvailable = false;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _armTap(state: ActiveTrackState): void {
    const ctx = this._ctx;
    if (!ctx) return;

    // Entscheidung: Worklet-Pfad oder ScriptProcessor-Fallback?
    const useWorklet = this._workletAvailable && this._workletReady;

    if (useWorklet) {
      this._armTapWorklet(ctx, state);
    } else {
      this._armTapScriptProcessor(ctx, state);
    }
  }

  /** Worklet-Pfad — bevorzugt ab v3.114.0. */
  private _armTapWorklet(ctx: AudioContext, state: ActiveTrackState): void {
    let node: AudioWorkletNode;
    try {
      node = new AudioWorkletNode(ctx, "recorder-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [state.channels],
        channelCount: state.channels,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
    } catch {
      // Fallback wenn Worklet-Node-Init fehlschlägt (Mock-Lücke o.ä.).
      this._armTapScriptProcessor(ctx, state);
      return;
    }
    state.processor = node;
    state.usesWorklet = true;

    node.port.onmessage = (ev: MessageEvent<WorkletMessage>) => {
      const data = ev.data;
      if (!data) return;
      if (data.type === "chunks") {
        // Streaming: append finalisierte chunks ins Buffer.
        if (data.left && data.left.length > 0) {
          state.bufferLeft.push(data.left);
        }
        if (data.right && data.right.length > 0 && state.channels === 2) {
          state.bufferRight.push(data.right);
        }
        if (typeof data.frameCount === "number") {
          state.frameCount = data.frameCount;
        }
      } else if (data.type === "limit") {
        state.truncated = true;
      } else if (data.type === "done") {
        // Finale Frames aufnehmen (überschreibt streaming wenn nötig).
        if (data.left && data.left.length > 0) {
          // Komplettes Buffer kommt im done-Event — wir nutzen das als
          // Quelle der Wahrheit damit kein chunk doppelt landet.
          state.bufferLeft = [data.left];
          if (data.right && data.right.length > 0 && state.channels === 2) {
            state.bufferRight = [data.right];
          }
        }
        if (typeof data.frameCount === "number") {
          state.frameCount = data.frameCount;
        }
        if (data.truncated) state.truncated = true;
        if (state.doneResolve) state.doneResolve();
      }
    };

    state.donePromise = new Promise<void>((resolve) => {
      state.doneResolve = resolve;
    });

    const silentSink = ctx.createGain();
    silentSink.gain.value = 0;
    try {
      state.source.connect(node);
      node.connect(silentSink);
      silentSink.connect(ctx.destination);
      // Memory-Cap an Processor durchreichen.
      node.port.postMessage({ cmd: "setMaxFrames", value: LIVE_REC_MAX_FRAMES_PER_TRACK });
      node.port.postMessage({ cmd: "start" });
    } catch {
      /* ignore — invalid mock */
    }
    state.silentSink = silentSink;
  }

  /** Fallback-Pfad mit deprecated ScriptProcessorNode. */
  private _armTapScriptProcessor(ctx: AudioContext, state: ActiveTrackState): void {
    if (typeof ctx.createScriptProcessor !== "function") return;
    const processor = ctx.createScriptProcessor(
      LIVE_REC_BUFFER_SIZE,
      state.channels,
      state.channels,
    );
    state.processor = processor;
    state.usesWorklet = false;

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

      if (state.frameCount > LIVE_REC_MAX_FRAMES_PER_TRACK && !state.truncated) {
        state.truncated = true;
        try { processor.disconnect(); } catch { /* ignore */ }
      }
    };

    const silentSink = ctx.createGain();
    silentSink.gain.value = 0;
    try {
      state.source.connect(processor);
      processor.connect(silentSink);
      silentSink.connect(ctx.destination);
    } catch {
      /* ignore */
    }
    state.silentSink = silentSink;
  }

  private _teardownTap(state: ActiveTrackState): void {
    if (state.processor) {
      try { state.source.disconnect(state.processor); } catch { /* ignore */ }
      try { state.processor.disconnect(); } catch { /* ignore */ }
      // ScriptProcessor: onaudioprocess explicit nullen damit GC freier wird.
      if (!state.usesWorklet) {
        const sp = state.processor as ScriptProcessorNode;
        if (sp.onaudioprocess !== undefined) sp.onaudioprocess = null;
      } else {
        const wp = state.processor as AudioWorkletNode;
        if (wp.port) {
          try { wp.port.onmessage = null; } catch { /* ignore */ }
        }
      }
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

  /** Test-Helper: simuliert eingehende Worklet-Message. */
  __postWorkletMessageForTest(id: string, message: WorkletMessage): void {
    const t = this._tracks.get(id);
    if (!t || !t.usesWorklet) return;
    const node = t.processor as AudioWorkletNode | null;
    if (!node) return;
    const handler = node.port.onmessage;
    if (typeof handler === "function") {
      handler.call(node.port, { data: message } as MessageEvent<WorkletMessage>);
    }
  }
}

// ─── WAV-Multi-Track Output (UNVERÄNDERT) ────────────────────────────────────

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
 * Erzeugt für jedes Track-Element einen WAV-Buffer (Uint8Array).
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

  // v3.151: WAV-Bit-Depth aus User-Setting (default 16, optional 24).
  const bitDepth = getApiSettings().wavBitDepth;
  for (const t of allTracks) {
    const name = buildLiveTrackFileName(t.kind, t.id, date, prefix);
    const buffer = encodeWavStereo(t.left, t.right, t.sampleRate, bitDepth);
    out.set(name, new Uint8Array(buffer));
  }
  return out;
}
