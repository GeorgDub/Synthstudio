/**
 * Synthstudio – LooperEngine.ts (TASK-235 / v2.87)
 *
 * Web-Audio-Orchestrierung für den Live-Looper. Owner der Float32-Aufnahmen
 * + AudioBufferSourceNodes für die Playback.
 *
 * Public-API (von AudioEngine wrappt):
 *   - setContext(ctx)
 *   - setTransportAnchor(anchorTime)       — beim Transport-Start vom Engine gesetzt
 *   - setBpm(bpm)                          — vom Engine bei BPM-Wechsel gesetzt
 *   - getLoopState(index) / getProgress(index)
 *   - trigger(index, source, onState)       — State-Machine-Übergang (Beat-quantisiert)
 *   - erase(index)
 *
 * Sehr bewusst KEIN direkter Store-Zugriff hier (DI per Callback) — sonst hätte
 * der Recorder eine zyklische Abhängigkeit auf den Store, was Unit-Tests schwer
 * macht. Wer den Store updaten will, nutzt die `onState` / `onLength`-Callbacks.
 *
 * State-Machine: siehe looperUtils.nextLoopState. Wir orchestrieren die
 * Beat-/Bar-quantisierten Übergänge:
 *
 *   trigger() auf empty       → state=arming, schedule recording-start auf bar-boundary
 *   trigger() auf recording   → state=playing, snap lengthBars + start playback-loop
 *   trigger() auf playing     → state=overdubbing, start zweite Aufnahme
 *   trigger() auf overdubbing → state=playing, merge linear-sum in base buffer
 *
 * Wir tappen wie AudioRecorder einen ScriptProcessorNode mono an. Beim Stop
 * wird der gemessene Sample-Count auf die quantisierte Bar-Länge (POWER-OF-2,
 * siehe quantizeLoopLengthBars) angepasst — Padding mit Null wenn zu kurz,
 * Trimm wenn zu lang.
 */

import {
  beatDurationSec,
  loopLengthSec,
  mixLoopBuffersLinear,
  nextBarBoundary,
  nextLoopState,
  quantizeLoopLengthBars,
  type LoopState,
  isValidLoopIndex,
  MAX_LOOPS,
  DEFAULT_BEATS_PER_BAR,
} from "./looperUtils";

const DEFAULT_BUFFER_SIZE = 4096;

// ─── Internal Slot-Repräsentation ────────────────────────────────────────────

interface ActiveLoopSlot {
  index: number;
  state: LoopState;
  /** Gepacktes Mono-Audio nach letztem Recording/Merge. */
  buffer: Float32Array | null;
  /** Quantisierte Loop-Länge in Bars (1/2/4/8). */
  lengthBars: number | null;
  /** Sample-Rate die zur Aufnahmezeit aktiv war. */
  sampleRate: number;
  /** Frames-Zähler — wird nach Quantize identisch zu buffer.length sein. */
  frameCount: number;
  /** Während Recording/Overdub aktiv: ScriptProcessor + Chunks. */
  recordChunks: Float32Array[];
  recordProcessor: ScriptProcessorNode | null;
  recordSource: AudioNode | null;
  /** Während Playback aktiv: AudioBufferSourceNode + Gain. */
  playSource: AudioBufferSourceNode | null;
  playGain: GainNode | null;
  /** Zeitpunkt (ctx.currentTime) ab dem Recording effektiv läuft. */
  recordStartedAt: number | null;
  /** Zeitpunkt (ctx.currentTime) ab dem Playback gestartet wurde. */
  playStartedAt: number | null;
  /** BPM/Beats die zur Aufnahmezeit aktiv waren — für lengthBeats-Berechnung. */
  bpmAtRecord: number;
  beatsPerBar: number;
}

// ─── Engine-Klasse ───────────────────────────────────────────────────────────

export interface LooperEngineCallbacks {
  /** Wird nach jedem State-Übergang gefeuert (Store-Update). */
  onState?: (index: number, state: LoopState) => void;
  /** Nach Recording-Quantize: lengthBeats + lengthSec + frameCount. */
  onLength?: (
    index: number,
    lengthBeats: number,
    lengthSec: number,
    frameCount: number,
  ) => void;
}

export class LooperEngine {
  private _ctx: AudioContext | null = null;
  private _destination: AudioNode | null = null;
  private _bpm = 120;
  private _anchorTime = 0;
  private _slots: Map<number, ActiveLoopSlot> = new Map();
  private _callbacks: LooperEngineCallbacks = {};

  /** Initialisierung: AudioContext + Mix-Bus-Ziel (typisch masterGain). */
  setContext(ctx: AudioContext | null, destination: AudioNode | null): void {
    this._ctx = ctx;
    this._destination = destination;
  }

  setCallbacks(cb: LooperEngineCallbacks): void {
    this._callbacks = cb;
  }

  setBpm(bpm: number): void {
    this._bpm = bpm;
  }

  /**
   * Setzt den Transport-Anchor: Zeitpunkt an dem Beat 0 lief.
   * AudioEngine.play() ruft das beim Start, damit Beat-Quantize-Mathematik
   * funktioniert.
   */
  setTransportAnchor(anchorTime: number): void {
    this._anchorTime = anchorTime;
  }

  getLoopState(index: number): LoopState {
    return this._slots.get(index)?.state ?? "empty";
  }

  /**
   * Liefert den Playback-Progress als 0..1 (für Progress-Ring im UI).
   * Wenn nicht playing/overdubbing → 0.
   */
  getProgress(index: number, now: number): number {
    const slot = this._slots.get(index);
    if (!slot || !slot.buffer || !slot.lengthBars) return 0;
    if (slot.state !== "playing" && slot.state !== "overdubbing") return 0;
    if (slot.playStartedAt === null) return 0;
    const lenSec = loopLengthSec(slot.lengthBars, slot.bpmAtRecord, slot.beatsPerBar);
    if (lenSec <= 0) return 0;
    const elapsed = now - slot.playStartedAt;
    return ((elapsed % lenSec) + lenSec) % lenSec / lenSec;
  }

  /**
   * Loop triggern (Pad-Click / Footswitch). State-Machine-Step.
   *
   * @param index   0..MAX_LOOPS-1
   * @param source  AudioNode der das Recording-Tap-Material liefert
   *                (typisch ein Live-Input-Channel oder master Tap).
   */
  trigger(index: number, source: AudioNode | null): void {
    if (!isValidLoopIndex(index)) return;
    if (!this._ctx) return;
    const slot = this._ensureSlot(index);
    const current = slot.state;
    const next = nextLoopState(current);

    switch (current) {
      case "empty": {
        if (!source) return; // Ohne Source kein Recording
        this._beginRecording(slot, source);
        this._setState(slot, "arming");
        return;
      }
      case "arming": {
        // Bei Bar-Boundary → recording. Wir sind eigentlich schon Arming und
        // warten auf nächste Beat-Boundary; der Trigger erlaubt User früher
        // zu starten.
        this._enterRecordingNow(slot);
        return;
      }
      case "recording": {
        // Stop recording + finalize loop length + start playback.
        this._finalizeRecordingAndPlay(slot);
        return;
      }
      case "playing": {
        // Beginne Overdub-Pass (zweite Aufnahme parallel zur Playback).
        if (!source) return;
        this._beginOverdub(slot, source);
        this._setState(slot, "overdubbing");
        return;
      }
      case "overdubbing": {
        // Stop Overdub + merge linear-sum.
        this._finalizeOverdub(slot);
        return;
      }
      case "stopped": {
        this._setState(slot, next);
        this._startPlayback(slot);
        return;
      }
    }
  }

  /** Long-Press / explizite Erase-Action. */
  erase(index: number): void {
    if (!isValidLoopIndex(index)) return;
    const slot = this._slots.get(index);
    if (!slot) return;
    this._stopAllNodes(slot);
    slot.buffer = null;
    slot.lengthBars = null;
    slot.frameCount = 0;
    slot.recordChunks = [];
    slot.recordStartedAt = null;
    slot.playStartedAt = null;
    this._setState(slot, "empty");
  }

  /** Stop alles (Transport-Stop). Loops bleiben erhalten, nur Playback aus. */
  stopAllPlayback(): void {
    for (const slot of this._slots.values()) {
      if (slot.state === "playing" || slot.state === "overdubbing") {
        this._stopPlaybackNodes(slot);
        this._setState(slot, "stopped");
      }
    }
  }

  /** Voll-Reset (clearCache / "Neues Projekt"). */
  dispose(): void {
    for (const slot of this._slots.values()) {
      this._stopAllNodes(slot);
    }
    this._slots.clear();
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private _ensureSlot(index: number): ActiveLoopSlot {
    let slot = this._slots.get(index);
    if (!slot) {
      slot = {
        index,
        state: "empty",
        buffer: null,
        lengthBars: null,
        sampleRate: this._ctx?.sampleRate ?? 48000,
        frameCount: 0,
        recordChunks: [],
        recordProcessor: null,
        recordSource: null,
        playSource: null,
        playGain: null,
        recordStartedAt: null,
        playStartedAt: null,
        bpmAtRecord: this._bpm,
        beatsPerBar: DEFAULT_BEATS_PER_BAR,
      };
      this._slots.set(index, slot);
    }
    return slot;
  }

  private _setState(slot: ActiveLoopSlot, state: LoopState): void {
    slot.state = state;
    this._callbacks.onState?.(slot.index, state);
  }

  /** Bereitet ScriptProcessor + Tap vor — Aufnahme beginnt erst bei Bar-Boundary. */
  private _beginRecording(slot: ActiveLoopSlot, source: AudioNode): void {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const proc = ctx.createScriptProcessor(DEFAULT_BUFFER_SIZE, 1, 1);
    slot.recordChunks = [];
    slot.recordProcessor = proc;
    slot.recordSource = source;
    slot.bpmAtRecord = this._bpm;
    slot.beatsPerBar = DEFAULT_BEATS_PER_BAR;
    slot.sampleRate = ctx.sampleRate;

    // Schedule: Bei nächster Bar-Boundary fängt die Recording effektiv an.
    // Da ScriptProcessor.onaudioprocess sofort feuert, gaten wir das per
    // `recordStartedAt`-Vergleich.
    const targetStart = nextBarBoundary(
      ctx.currentTime,
      this._anchorTime,
      this._bpm,
      DEFAULT_BEATS_PER_BAR,
    );
    slot.recordStartedAt = targetStart;

    proc.onaudioprocess = (ev: AudioProcessingEvent) => {
      if (slot.recordStartedAt === null) return;
      const now = ctx.currentTime;
      if (now < slot.recordStartedAt) return; // noch im Pre-Roll
      const ch0 = ev.inputBuffer.getChannelData(0);
      const copy = new Float32Array(ch0.length);
      copy.set(ch0);
      slot.recordChunks.push(copy);
      slot.frameCount += ch0.length;

      // Wenn wir gerade von arming → recording übergehen, melden
      if (slot.state === "arming") {
        this._setState(slot, "recording");
      }
    };

    // Routing: source → proc → silentSink → destination
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(proc);
    proc.connect(silent);
    silent.connect(ctx.destination);
  }

  /** Erzwingt Übergang arming → recording sofort (Trigger während arming). */
  private _enterRecordingNow(slot: ActiveLoopSlot): void {
    if (!this._ctx) return;
    slot.recordStartedAt = this._ctx.currentTime;
    if (slot.state === "arming") {
      this._setState(slot, "recording");
    }
  }

  /** Stoppt Aufnahme, quantisiert Loop-Länge, startet Playback. */
  private _finalizeRecordingAndPlay(slot: ActiveLoopSlot): void {
    if (!this._ctx) return;
    const ctx = this._ctx;

    // Tap disconnect
    if (slot.recordProcessor) {
      try { slot.recordSource?.disconnect(slot.recordProcessor); } catch { /* ignore */ }
      try { slot.recordProcessor.disconnect(); } catch { /* ignore */ }
      slot.recordProcessor.onaudioprocess = null;
    }
    slot.recordProcessor = null;

    // Concat chunks → linear Float32
    const merged = concatChunks(slot.recordChunks);
    slot.recordChunks = [];

    // Quantize: messe elapsed bars + snap to Power-of-2.
    const beatDur = beatDurationSec(slot.bpmAtRecord);
    const barDur = beatDur * slot.beatsPerBar;
    const elapsedSec = merged.length / slot.sampleRate;
    const elapsedBars = barDur > 0 ? elapsedSec / barDur : 1;
    const lengthBars = quantizeLoopLengthBars(elapsedBars);
    const lengthSec = loopLengthSec(lengthBars, slot.bpmAtRecord, slot.beatsPerBar);
    const targetFrames = Math.round(lengthSec * slot.sampleRate);

    // Trimm / pad auf targetFrames
    const finalBuf = new Float32Array(targetFrames);
    const copyLen = Math.min(merged.length, targetFrames);
    finalBuf.set(merged.subarray(0, copyLen), 0);
    // Rest bleibt Null (pad).

    slot.buffer = finalBuf;
    slot.lengthBars = lengthBars;
    slot.frameCount = targetFrames;

    this._callbacks.onLength?.(
      slot.index,
      lengthBars * slot.beatsPerBar,
      lengthSec,
      targetFrames,
    );

    // Sofort Playback starten.
    this._startPlayback(slot);
    this._setState(slot, "playing");

    // Voraus: erste Beat-Boundary nach `now` als Anker — Hand-off vom
    // Transport-Anchor. Für saubere Sync.
    void ctx;
  }

  /** Startet Playback-Loop des aktuellen Buffers. */
  private _startPlayback(slot: ActiveLoopSlot): void {
    if (!this._ctx || !this._destination) return;
    if (!slot.buffer || slot.buffer.length === 0) return;
    const ctx = this._ctx;

    // Existierende Source ggf. stoppen
    this._stopPlaybackNodes(slot);

    const audioBuf = ctx.createBuffer(1, slot.buffer.length, slot.sampleRate);
    audioBuf.getChannelData(0).set(slot.buffer);

    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.loop = true;

    const gain = ctx.createGain();
    gain.gain.value = 0.85;

    src.connect(gain);
    gain.connect(this._destination);

    slot.playSource = src;
    slot.playGain = gain;
    slot.playStartedAt = ctx.currentTime;

    src.start(0);
  }

  /** Startet zweiten Recording-Pass (Overdub). Playback läuft parallel weiter. */
  private _beginOverdub(slot: ActiveLoopSlot, source: AudioNode): void {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const proc = ctx.createScriptProcessor(DEFAULT_BUFFER_SIZE, 1, 1);
    slot.recordChunks = [];
    slot.recordProcessor = proc;
    slot.recordSource = source;
    slot.recordStartedAt = ctx.currentTime;

    proc.onaudioprocess = (ev: AudioProcessingEvent) => {
      const ch0 = ev.inputBuffer.getChannelData(0);
      const copy = new Float32Array(ch0.length);
      copy.set(ch0);
      slot.recordChunks.push(copy);
    };

    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(proc);
    proc.connect(silent);
    silent.connect(ctx.destination);
  }

  /** Stoppt Overdub-Tap, merget Linear-Sum, restartet Playback mit neuem Buffer. */
  private _finalizeOverdub(slot: ActiveLoopSlot): void {
    if (!slot.buffer) {
      // Defensive: kein Base → just stop
      this._stopRecordNodes(slot);
      this._setState(slot, "playing");
      return;
    }
    // Tap disconnect
    if (slot.recordProcessor) {
      try { slot.recordSource?.disconnect(slot.recordProcessor); } catch { /* ignore */ }
      try { slot.recordProcessor.disconnect(); } catch { /* ignore */ }
      slot.recordProcessor.onaudioprocess = null;
    }
    slot.recordProcessor = null;

    const overdub = concatChunks(slot.recordChunks);
    slot.recordChunks = [];

    // Merge: gleiche Länge wie base; overdub wird ge-trimmed / gepadded.
    const merged = mixLoopBuffersLinear(slot.buffer, overdub);
    slot.buffer = merged;

    // Update Store mit (unchanged) lengthBeats + frameCount
    this._callbacks.onLength?.(
      slot.index,
      (slot.lengthBars ?? 1) * slot.beatsPerBar,
      loopLengthSec(slot.lengthBars ?? 1, slot.bpmAtRecord, slot.beatsPerBar),
      merged.length,
    );

    // Re-start Playback mit neuem Buffer (alte Source disconnected)
    this._startPlayback(slot);
    this._setState(slot, "playing");
  }

  private _stopRecordNodes(slot: ActiveLoopSlot): void {
    if (slot.recordProcessor) {
      try { slot.recordSource?.disconnect(slot.recordProcessor); } catch { /* ignore */ }
      try { slot.recordProcessor.disconnect(); } catch { /* ignore */ }
      slot.recordProcessor.onaudioprocess = null;
      slot.recordProcessor = null;
    }
    slot.recordChunks = [];
  }

  private _stopPlaybackNodes(slot: ActiveLoopSlot): void {
    if (slot.playSource) {
      try { slot.playSource.stop(); } catch { /* ignore */ }
      try { slot.playSource.disconnect(); } catch { /* ignore */ }
      slot.playSource = null;
    }
    if (slot.playGain) {
      try { slot.playGain.disconnect(); } catch { /* ignore */ }
      slot.playGain = null;
    }
    slot.playStartedAt = null;
  }

  private _stopAllNodes(slot: ActiveLoopSlot): void {
    this._stopRecordNodes(slot);
    this._stopPlaybackNodes(slot);
  }
}

// ─── Helper ──────────────────────────────────────────────────────────────────

function concatChunks(chunks: Float32Array[]): Float32Array {
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

// Re-export Konstanten für AudioEngine
export { MAX_LOOPS };
