/**
 * Synthstudio – AudioInputRecorder.ts (v3.113.0)
 *
 * External Audio-Input Recording — Mic / Synth / Line-In / KORG-Sampler-Out.
 *
 * Was es macht (vs. LiveRecorder.ts):
 *  - LiveRecorder capturet INTERNEN Synthstudio-Output (master + per-channel).
 *  - AudioInputRecorder capturet EXTERNES Audio (Mic, Gitarre, Synth-Line)
 *    via navigator.mediaDevices.getUserMedia.
 *  - Lieert am Ende ein Float32-Pair (oder Mono) + WAV-Encoder-Ready-Buffer.
 *  - Optional Monitor-Path (input → destination via gain) für Hör-Through.
 *
 * Architektur (browser-only — Electron erbt Chromium getUserMedia):
 *   getUserMedia(deviceId, {echoCancellation:false, noiseSuppression:false,
 *                          autoGainControl:false})
 *     → MediaStreamAudioSourceNode
 *     → AnalyserNode (Level-Meter, RMS dB)
 *     → ScriptProcessorNode (Capture in RAM)
 *     → silent destination
 *
 *   Monitor-Path (parallel, optional):
 *     source → monitorGain (0..1) → ctx.destination
 *
 * Side-effect-frei testbar: Engine-Ref ist injizierbar, getUserMedia kann
 * gemockt werden. Permission-graceful — bei Denial throwen wir kein crash,
 * der UI-Layer rendert nur einen Error-State.
 */

import { encodeWavStereo } from "./wavEncoder";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Default Buffer-Size für ScriptProcessor — 4096 Frames = ~85 ms @ 48 k. */
export const AUDIO_INPUT_BUFFER_SIZE = 4096;

/** FFT-Größe für Analyser (Level-Meter). 1024 = niedrige Latenz. */
export const AUDIO_INPUT_FFT_SIZE = 1024;

/**
 * Memory-Cap in Frames pro Aufnahme (~10 min Stereo @ 48 kHz).
 * = 600 s * 48000 = 28_800_000 Frames Mono x2 = 57_600_000 Stereo.
 * Bei Überschreitung wird auto-stop ausgelöst (truncated:true).
 */
export const AUDIO_INPUT_MAX_FRAMES = 600 * 48000;

/** Silence-Floor dB für getLevel(). */
export const AUDIO_INPUT_SILENCE_DB = -100;

// ─── Public-Types ────────────────────────────────────────────────────────────

export type AudioInputRoute = "master" | "live-recorder" | "both";

export interface AudioInputDeviceInfo {
  deviceId: string;
  label: string;
  groupId: string;
}

export interface AudioInputRecordingResult {
  /** Stereo-Float32 Left. */
  left: Float32Array;
  /** Stereo-Float32 Right (= left.copy bei Mono). */
  right: Float32Array;
  sampleRate: number;
  durationMs: number;
  channels: 1 | 2;
  truncated: boolean;
  /** WAV-Encoded-Buffer als Convenience. */
  wavBytes: Uint8Array;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** RMS aus einem Float32-Array; -Inf wenn alle 0. */
export function rmsDbFromTimeDomain(buf: Float32Array): number {
  if (!buf || buf.length === 0) return AUDIO_INPUT_SILENCE_DB;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length);
  if (!Number.isFinite(rms) || rms <= 0) return AUDIO_INPUT_SILENCE_DB;
  const db = 20 * Math.log10(rms);
  return Math.max(AUDIO_INPUT_SILENCE_DB, db);
}

/**
 * Verkettet eine Liste von Float32Arrays zu einem zusammenhängenden Buffer.
 * Pure — keine Side-Effects.
 */
export function concatFloat32Chunks(chunks: Float32Array[]): Float32Array {
  if (chunks.length === 0) return new Float32Array(0);
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ─── Recorder-Klasse ────────────────────────────────────────────────────────

export class AudioInputRecorder {
  private _ctx: AudioContext | null = null;
  private _stream: MediaStream | null = null;
  private _source: MediaStreamAudioSourceNode | null = null;
  private _analyser: AnalyserNode | null = null;
  private _processor: ScriptProcessorNode | null = null;
  private _silentSink: GainNode | null = null;
  private _monitorGain: GainNode | null = null;
  private _inputGain: GainNode | null = null;
  private _bufferLeft: Float32Array[] = [];
  private _bufferRight: Float32Array[] = [];
  private _channels: 1 | 2 = 2;
  private _frameCount = 0;
  private _truncated = false;
  private _recording = false;
  private _startedAt = 0;
  private _stoppedAt = 0;
  private _sampleRate = 48000;
  private _deviceId: string | null = null;
  private _analyserBuffer: Float32Array | null = null;

  // ─── Device-Enumeration ──────────────────────────────────────────────────

  /**
   * Listet alle Audio-Input-Devices. Returns leeres Array wenn das API nicht
   * verfügbar oder die Permission noch nie erteilt wurde (Labels sind dann
   * leer und Devices werden gefiltert — User muss erst `connect` rufen).
   */
  async enumerateDevices(): Promise<AudioInputDeviceInfo[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === "audioinput")
        .map(d => ({
          deviceId: d.deviceId,
          label: d.label || "Audio Input",
          groupId: d.groupId,
        }));
    } catch {
      return [];
    }
  }

  // ─── Connect / Disconnect ────────────────────────────────────────────────

  /**
   * Öffnet einen Input-Stream + verkabelt Analyser für Level-Meter.
   * Wirft DOMException wenn Permission verweigert wird — caller MUSS in
   * try/catch + UI-Error-State setzen.
   *
   * Idempotent: zweiter Aufruf detached den vorhandenen Stream + erzeugt neu.
   */
  async connect(deviceId: string, ctx: AudioContext): Promise<MediaStreamAudioSourceNode> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("MediaDevices.getUserMedia() is not available in this environment");
    }
    // Cleanup bestehender Stream falls Re-Connect.
    if (this._stream) this.disconnect();

    this._ctx = ctx;
    this._sampleRate = ctx.sampleRate;
    this._deviceId = deviceId;

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as MediaTrackConstraints,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this._stream = stream;

    const source = ctx.createMediaStreamSource(stream);
    this._source = source;

    // Analyser für Level-Meter (RMS). FFT-Size klein → niedrige Latenz.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = AUDIO_INPUT_FFT_SIZE;
    analyser.smoothingTimeConstant = 0.2;
    this._analyser = analyser;
    this._analyserBuffer = new Float32Array(analyser.fftSize);

    // Input-Gain (User-justierbar). Default 1.0 (unity).
    const inputGain = ctx.createGain();
    inputGain.gain.value = 1.0;
    this._inputGain = inputGain;

    // Monitor-Gain (Default 0 = no hör-through).
    const monitorGain = ctx.createGain();
    monitorGain.gain.value = 0;
    this._monitorGain = monitorGain;

    try {
      source.connect(inputGain);
      inputGain.connect(analyser);
      // Monitor-Path parallel (off bei gain=0).
      inputGain.connect(monitorGain);
      monitorGain.connect(ctx.destination);
    } catch {
      /* ignore — invalid mock */
    }

    return source;
  }

  /** Trennt den Stream + stoppt alle Tracks (verhindert Zombie-Mic-LED). */
  disconnect(): void {
    if (this._recording) {
      // Capture-State zerstören aber kein Result emit.
      this._teardownCapture();
      this._recording = false;
    }
    try { this._source?.disconnect(); } catch { /* ignore */ }
    try { this._analyser?.disconnect(); } catch { /* ignore */ }
    try { this._inputGain?.disconnect(); } catch { /* ignore */ }
    try { this._monitorGain?.disconnect(); } catch { /* ignore */ }
    try { this._stream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    this._stream = null;
    this._source = null;
    this._analyser = null;
    this._inputGain = null;
    this._monitorGain = null;
    this._analyserBuffer = null;
    this._deviceId = null;
  }

  // ─── Recording-Lifecycle ─────────────────────────────────────────────────

  /**
   * Startet Capture. Idempotent — zweiter Aufruf returnt false.
   * Wenn kein Stream angeschlossen ist (connect() noch nicht aufgerufen),
   * returnt ebenfalls false.
   */
  start(): boolean {
    if (this._recording) return false;
    if (!this._ctx || !this._inputGain) return false;
    this._bufferLeft = [];
    this._bufferRight = [];
    this._frameCount = 0;
    this._truncated = false;
    this._startedAt = Date.now();
    this._stoppedAt = 0;
    this._recording = true;
    this._armCapture();
    return true;
  }

  /**
   * Stoppt Capture, liefert Float32-Buffer + WAV-Bytes.
   * Returnt einen leeren Buffer wenn nicht recording.
   */
  stop(): AudioInputRecordingResult {
    if (!this._recording) {
      const empty = new Float32Array(0);
      return {
        left: empty,
        right: empty,
        sampleRate: this._sampleRate,
        durationMs: 0,
        channels: this._channels,
        truncated: false,
        wavBytes: new Uint8Array(0),
      };
    }
    this._recording = false;
    this._stoppedAt = Date.now();
    this._teardownCapture();

    const left = concatFloat32Chunks(this._bufferLeft);
    const right = this._channels === 2 && this._bufferRight.length > 0
      ? concatFloat32Chunks(this._bufferRight)
      : left.slice();

    const durationMs = Math.max(0, this._stoppedAt - this._startedAt);
    const wavBuffer = encodeWavStereo(left, right, this._sampleRate);
    return {
      left,
      right,
      sampleRate: this._sampleRate,
      durationMs,
      channels: this._channels,
      truncated: this._truncated,
      wavBytes: new Uint8Array(wavBuffer),
    };
  }

  // ─── Level-Meter ─────────────────────────────────────────────────────────

  /**
   * Liefert RMS-Pegel in dB (von AUDIO_INPUT_SILENCE_DB bis ~0).
   * Pull-API: UI ruft das in requestAnimationFrame-Loop auf.
   */
  getLevel(): number {
    if (!this._analyser || !this._analyserBuffer) return AUDIO_INPUT_SILENCE_DB;
    try {
      // Cast für TS-lib types (Float32Array<ArrayBufferLike> vs <ArrayBuffer>).
      this._analyser.getFloatTimeDomainData(this._analyserBuffer as Float32Array<ArrayBuffer>);
      return rmsDbFromTimeDomain(this._analyserBuffer);
    } catch {
      return AUDIO_INPUT_SILENCE_DB;
    }
  }

  // ─── Setters ─────────────────────────────────────────────────────────────

  /** Monitor-Gain (0 = off, 1 = full hear-through). Clamp 0..2. */
  setMonitorGain(gain: number): void {
    const clamped = Math.max(0, Math.min(2, Number.isFinite(gain) ? gain : 0));
    if (this._monitorGain && this._ctx) {
      try {
        this._monitorGain.gain.setTargetAtTime(clamped, this._ctx.currentTime, 0.01);
      } catch {
        try { this._monitorGain.gain.value = clamped; } catch { /* ignore */ }
      }
    }
  }

  /** Input-Gain pre-capture (0..2). */
  setInputGain(gain: number): void {
    const clamped = Math.max(0, Math.min(2, Number.isFinite(gain) ? gain : 1));
    if (this._inputGain && this._ctx) {
      try {
        this._inputGain.gain.setTargetAtTime(clamped, this._ctx.currentTime, 0.01);
      } catch {
        try { this._inputGain.gain.value = clamped; } catch { /* ignore */ }
      }
    }
  }

  // ─── Getters ─────────────────────────────────────────────────────────────

  get isConnected(): boolean { return !!this._stream; }
  get isRecording(): boolean { return this._recording; }
  get deviceId(): string | null { return this._deviceId; }
  get sampleRate(): number { return this._sampleRate; }
  get frameCount(): number { return this._frameCount; }
  get sourceNode(): MediaStreamAudioSourceNode | null { return this._source; }
  /** Tap-Node für externe Mixer (LiveRecorder, etc.). */
  get tapNode(): GainNode | null { return this._inputGain; }

  /** Wallclock recording-Dauer in ms. */
  get recordedDurationMs(): number {
    if (!this._recording && this._stoppedAt > 0) {
      return Math.max(0, this._stoppedAt - this._startedAt);
    }
    if (this._recording && this._startedAt > 0) {
      return Math.max(0, Date.now() - this._startedAt);
    }
    return 0;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _armCapture(): void {
    const ctx = this._ctx;
    const inputGain = this._inputGain;
    if (!ctx || !inputGain) return;

    const processor = ctx.createScriptProcessor(
      AUDIO_INPUT_BUFFER_SIZE,
      this._channels,
      this._channels,
    );
    this._processor = processor;

    processor.onaudioprocess = (ev: AudioProcessingEvent) => {
      if (!this._recording) return;
      const input = ev.inputBuffer;
      const ch0 = input.getChannelData(0);
      const copy0 = new Float32Array(ch0.length);
      copy0.set(ch0);
      this._bufferLeft.push(copy0);
      if (this._channels === 2 && input.numberOfChannels > 1) {
        const ch1 = input.getChannelData(1);
        const copy1 = new Float32Array(ch1.length);
        copy1.set(ch1);
        this._bufferRight.push(copy1);
      }
      this._frameCount += ch0.length;

      if (this._frameCount > AUDIO_INPUT_MAX_FRAMES && !this._truncated) {
        this._truncated = true;
        try { processor.disconnect(); } catch { /* ignore */ }
      }
    };

    const silentSink = ctx.createGain();
    silentSink.gain.value = 0;
    this._silentSink = silentSink;

    try {
      inputGain.connect(processor);
      processor.connect(silentSink);
      silentSink.connect(ctx.destination);
    } catch {
      /* ignore — invalid mock */
    }
  }

  private _teardownCapture(): void {
    if (this._processor) {
      try { this._inputGain?.disconnect(this._processor); } catch { /* ignore */ }
      try { this._processor.disconnect(); } catch { /* ignore */ }
      this._processor.onaudioprocess = null;
    }
    if (this._silentSink) {
      try { this._silentSink.disconnect(); } catch { /* ignore */ }
    }
    this._processor = null;
    this._silentSink = null;
  }

  /**
   * Test-Helper: simuliert eingehende Frames ohne realen ScriptProcessor.
   */
  __pushFramesForTest(left: Float32Array, right?: Float32Array): void {
    if (!this._recording) return;
    const lcopy = new Float32Array(left.length);
    lcopy.set(left);
    this._bufferLeft.push(lcopy);
    if (this._channels === 2 && right) {
      const rcopy = new Float32Array(right.length);
      rcopy.set(right);
      this._bufferRight.push(rcopy);
    }
    this._frameCount += left.length;
    if (this._frameCount > AUDIO_INPUT_MAX_FRAMES && !this._truncated) {
      this._truncated = true;
    }
  }

  /** Test-Helper: bypass setContext + connect für reine Buffer-Tests. */
  __forceTestState(ctx: AudioContext | null, sampleRate = 48000, channels: 1 | 2 = 2): void {
    this._ctx = ctx;
    this._sampleRate = sampleRate;
    this._channels = channels;
  }
}
