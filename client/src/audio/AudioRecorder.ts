/**
 * Synthstudio – AudioRecorder.ts (TASK-234 / v2.86)
 *
 * Capturing-Pipeline für einen einzelnen Mixer-Channel.
 * Tapped den Channel-Output (NACH der vollständigen FX-Chain) über einen
 * ScriptProcessorNode und sammelt Float32-PCM-Buffer im RAM.
 *
 * Architektur-Entscheidung (siehe TASK-234-Beschreibung):
 *   Option A: AudioWorklet → produktiv, aber polyfill-Pain + braucht eigene
 *             Module-URL und ist im Test-Env (Node/Vitest) nicht trivial.
 *   Option B: MediaRecorder + MediaStreamDestination → produziert WebM/Opus
 *             — falsche Format, müsste re-encoded werden.
 *   ▶ Gewählt: ScriptProcessorNode (deprecated, aber überall verfügbar). Liefert
 *     direkt Float32 — wir können trivial in WAV encoden. AudioWorklet-Upgrade
 *     ist ein follow-up (siehe INDEX.js).
 *
 * Performance:
 *   - Default-Bufferlänge 4096 Frames (~85ms @ 48k) — gut genug für Backend-Tap
 *     ohne hörbare Audio-Glitches.
 *   - Maximaler Konsum bei 8 simultanen Recorders: 8*4096*4 Byte = 128 KB pro
 *     onaudioprocess-Tick alle ~85ms → vernachlässigbar.
 *
 * Limitationen:
 *   - Aktuell mono (Channel-Output ist nach panner→sidechain→master → master ist
 *     stereo, aber der Channel-Output-Node selber ist hier ein GainNode pre-panner;
 *     wir tappen NACH dem Panner an einem dedizierten Splitter-Node).
 *   - Kein User-konfigurierbarer Pre-Roll / Punch.
 */

import { concatFloat32, encodeWavMono, encodeWavStereo } from "./wavEncoder";
import { getApiSettings } from "@/store/useApiSettingsStore";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/**
 * Performance-Limit. Mehr als 8 simultane Recordings würden Audio-Glitches
 * auf älterer Hardware riskieren. UI sollte Record-Arm-Button auf weiteren
 * Channels deaktivieren wenn dieses Limit erreicht ist.
 */
export const MAX_SIMULTANEOUS_RECORDINGS = 8;

const DEFAULT_BUFFER_SIZE = 4096;

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface RecordingResult {
  /** ID des aufgenommenen Channels. */
  channelId: string;
  /** Voll-konstruierter WAV-File-Buffer (RIFF-Header + PCM). */
  wavBuffer: ArrayBuffer;
  /** Sample-Rate die zur Aufnahmezeit aktiv war. */
  sampleRate: number;
  /** Dauer in Sekunden. */
  durationSec: number;
  /** Anzahl Kanäle (1=mono, 2=stereo). */
  channels: 1 | 2;
}

export interface ActiveRecording {
  channelId: string;
  startedAt: number; // Date.now() ms — für Timer-Overlay
  bufferLeft: Float32Array[];
  bufferRight: Float32Array[]; // leer wenn mono
  channels: 1 | 2;
  /** Wenn vorhanden: aktiver Tap-Node (für disconnect on stop). */
  tap: AudioNode | null;
  processor: ScriptProcessorNode | null;
  source: AudioNode;
  sampleRate: number;
  /** Total-Frames für durationSec-Berechnung. */
  frameCount: number;
}

// ─── Recorder-Klasse (AudioContext-bound) ────────────────────────────────────

/**
 * Wrapper um den AudioContext der von außen injiziert wird (von AudioEngine).
 * Eine Instanz hält den State aller aktiven Recordings; AudioEngine besitzt
 * genau eine Instanz davon.
 */
export class AudioRecorder {
  private _ctx: AudioContext | null = null;
  private _active = new Map<string, ActiveRecording>();

  setContext(ctx: AudioContext | null): void {
    this._ctx = ctx;
  }

  hasContext(): boolean {
    return !!this._ctx;
  }

  /**
   * Startet eine Aufnahme für einen Channel. Source = der Audio-Node am Ende
   * der Channel-FX-Chain (typisch `channelNodes.panner` oder `output`).
   *
   * Idempotent: wenn bereits aktiv → no-op und returnt false.
   *
   * @returns `true` wenn gestartet, `false` wenn bereits aktiv oder Limit erreicht.
   * @throws Error wenn AudioContext fehlt.
   */
  start(channelId: string, source: AudioNode, channels: 1 | 2 = 1): boolean {
    if (!this._ctx) throw new Error("AudioRecorder has no AudioContext");
    if (this._active.has(channelId)) return false;
    if (this._active.size >= MAX_SIMULTANEOUS_RECORDINGS) {
      return false;
    }

    const ctx = this._ctx;
    const sampleRate = ctx.sampleRate;

    // ScriptProcessor: liefert Float32 für eingehende Frames.
    // Web-Audio-Standard: deprecated zu Gunsten von AudioWorklet, aber überall
    // verfügbar und für Tap-Recording absolut ausreichend.
    const processor = ctx.createScriptProcessor(
      DEFAULT_BUFFER_SIZE,
      channels,
      channels,
    );

    const rec: ActiveRecording = {
      channelId,
      startedAt: Date.now(),
      bufferLeft: [],
      bufferRight: [],
      channels,
      tap: source,
      processor,
      source,
      sampleRate,
      frameCount: 0,
    };

    processor.onaudioprocess = (ev: AudioProcessingEvent) => {
      const input = ev.inputBuffer;
      // Kopie nötig — der Input-Buffer wird vom Audio-Thread wiederverwendet.
      const ch0 = input.getChannelData(0);
      const copy0 = new Float32Array(ch0.length);
      copy0.set(ch0);
      rec.bufferLeft.push(copy0);
      if (channels === 2 && input.numberOfChannels > 1) {
        const ch1 = input.getChannelData(1);
        const copy1 = new Float32Array(ch1.length);
        copy1.set(ch1);
        rec.bufferRight.push(copy1);
      }
      rec.frameCount += ch0.length;
    };

    // Routing: source -tap-> processor -> ctx.destination (silent passthrough
    // — wir routen den ScriptProcessor an destination weil der Browser sonst
    // den Node garbage-collected. Lautstärke 0 verhindert Doppel-Output.)
    const silentSink = ctx.createGain();
    silentSink.gain.value = 0;
    source.connect(processor);
    processor.connect(silentSink);
    silentSink.connect(ctx.destination);

    this._active.set(channelId, rec);
    return true;
  }

  /**
   * Stoppt eine Aufnahme + liefert das fertige WAV-Result. No-op wenn der
   * Channel nicht gerade aufnimmt → return null.
   */
  stop(channelId: string): RecordingResult | null {
    const rec = this._active.get(channelId);
    if (!rec) return null;
    this._active.delete(channelId);

    // Disconnect zuerst — verhindert Frame-Leakage nach Stop.
    try { rec.source.disconnect(rec.processor!); } catch { /* ignore */ }
    try { rec.processor?.disconnect(); } catch { /* ignore */ }
    if (rec.processor) {
      rec.processor.onaudioprocess = null;
    }

    const leftBuf = concatFloat32(rec.bufferLeft);
    // v3.151: WAV-Bit-Depth aus User-Setting (default 16, optional 24).
    const bitDepth = getApiSettings().wavBitDepth;
    const wavBuffer =
      rec.channels === 2 && rec.bufferRight.length > 0
        ? encodeWavStereo(leftBuf, concatFloat32(rec.bufferRight), rec.sampleRate, bitDepth)
        : encodeWavMono(leftBuf, rec.sampleRate, bitDepth);
    const durationSec = rec.sampleRate > 0 ? rec.frameCount / rec.sampleRate : 0;

    return {
      channelId,
      wavBuffer,
      sampleRate: rec.sampleRate,
      durationSec,
      channels: rec.channels,
    };
  }

  /** Stoppt alle aktiven Aufnahmen und liefert die Ergebnisse. */
  stopAll(): RecordingResult[] {
    const ids = Array.from(this._active.keys());
    const results: RecordingResult[] = [];
    for (const id of ids) {
      const r = this.stop(id);
      if (r) results.push(r);
    }
    return results;
  }

  /** Bricht eine Aufnahme ab OHNE Encode (Cleanup-Pfad). */
  cancel(channelId: string): void {
    const rec = this._active.get(channelId);
    if (!rec) return;
    this._active.delete(channelId);
    try { rec.source.disconnect(rec.processor!); } catch { /* ignore */ }
    try { rec.processor?.disconnect(); } catch { /* ignore */ }
    if (rec.processor) rec.processor.onaudioprocess = null;
  }

  isRecording(channelId: string): boolean {
    return this._active.has(channelId);
  }

  activeChannelIds(): string[] {
    return Array.from(this._active.keys());
  }

  /** Anzahl gerade laufender Aufnahmen — für UI-Counter + Limit-Check. */
  activeCount(): number {
    return this._active.size;
  }

  /**
   * Liefert die Aufnahmedauer in ms (für Timer-Overlay). 0 wenn nicht aktiv.
   * Berechnet aus `Date.now() - startedAt` (Wallclock — kein Drift-Issue,
   * da nur UI-Anzeige).
   */
  currentDurationMs(channelId: string): number {
    const rec = this._active.get(channelId);
    if (!rec) return 0;
    return Date.now() - rec.startedAt;
  }

  /**
   * Vollständiger Reset (für Tests / Engine-clearCache).
   * Bricht alle Aufnahmen ab.
   */
  dispose(): void {
    const ids = Array.from(this._active.keys());
    for (const id of ids) this.cancel(id);
  }
}

// Singleton-Bezogen ist die Engine-Instanz — siehe AudioEngine._audioRecorder.
