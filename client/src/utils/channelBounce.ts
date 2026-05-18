/**
 * Synthstudio – channelBounce.ts (TASK-241 / v2.94.0)
 *
 * Per-Channel WAV-Bounce (Stem-Export).
 *
 * Anders als der Full-Mix-Export (`wavExporter.ts`) rendert dieses Modul
 * EINEN einzelnen Mixer-Channel inkl. seiner Pan-/Volume-/Filter-Werte
 * in einen Offline-AudioBuffer. Andere Channels werden NICHT mitgerendert —
 * sie existieren im Offline-Graph schlicht nicht.
 *
 * Architektur:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ OfflineAudioContext(stereo, durationSec * sampleRate)            │
 *   │                                                                  │
 *   │   For each active step in part.steps:                            │
 *   │     BufferSource(sample) → Gain(vel*partVol) → Filter? → Pan →   │
 *   │     ctx.destination                                              │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Begrenzungen (siehe README am Ende der Datei):
 *  - Insert-FX-Chain (Sidechain, Reverb-Send, etc.) wird NICHT mitgerendert.
 *    Für eine FX-genaue Bounce-Pipeline müsste der gesamte AudioEngine-
 *    Graph 1:1 im Offline-Context nachgebaut werden — explizit out-of-scope.
 *  - Synth/Wavetable-Parts (sourceType wavetable/fm/granular) werden ignoriert
 *    weil kein offline-fähiger Synth-Pfad existiert.
 *  - Velocity = step.velocity ?? 100 (default DAW-Norm).
 */

import type { PartData, PatternData } from "@/audio/AudioEngine";
import { encodeWav } from "@/audio/wavEncoder";

// ─── Längen-Optionen ─────────────────────────────────────────────────────────

export type BounceLengthMode =
  | "currentPattern"   // 1 Durchlauf des aktuellen Patterns (stepCount steps)
  | "currentLoop"      // n Bars Loop (Default 4)
  | "customBars";      // beliebige Bar-Anzahl

export interface BounceLengthOption {
  mode: BounceLengthMode;
  bars?: number;       // nur für customBars/currentLoop
}

/**
 * Maximal-Länge die wir ohne Warnung rendern (5 Minuten @ 48kHz Stereo = 110 MB).
 * Aufrufer sind angehalten ab dieser Grenze einen UI-Confirm zu zeigen.
 */
export const BOUNCE_WARN_DURATION_SEC = 5 * 60;

/**
 * Hartes Maximum — Bounces über 30 Minuten werden abgelehnt (Schutz vor Lock-up
 * und Out-of-Memory). 30min Stereo 48k = ~660 MB.
 */
export const BOUNCE_MAX_DURATION_SEC = 30 * 60;

// ─── Pure-Helpers ────────────────────────────────────────────────────────────

/**
 * Berechnet Sekunden-Dauer für einen Bounce.
 *
 * Formel: durationSec = bars * stepsPerBar * stepDurSec
 *         stepDurSec  = 60 / (bpm * stepsPerBar / 4)
 *                     = 60 * 4 / (bpm * stepsPerBar)
 *
 * Beispiel: 1 Bar, 16 steps, 120 bpm → 60*4/(120*16) * 16 = 2.0 sec.
 *
 * @param bars         Anzahl Bars (>0).
 * @param stepsPerBar  Step-Auflösung (typ. 16 oder 32).
 * @param bpm          Tempo in BPM (>0).
 * @param tailSec      Fadeout-Reserve in Sek (Default 0.5).
 *                     Damit der letzte Sample-Trigger noch ausklingen kann.
 */
export function computeBounceDurationSec(
  bars: number,
  stepsPerBar: number,
  bpm: number,
  tailSec: number = 0.5,
): number {
  if (!Number.isFinite(bars) || bars <= 0) return 0;
  if (!Number.isFinite(stepsPerBar) || stepsPerBar <= 0) return 0;
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;
  const stepDurSec = 60 / (bpm * stepsPerBar / 4);
  return bars * stepsPerBar * stepDurSec + Math.max(0, tailSec);
}

/**
 * Resolved: berechnet konkrete `bars`-Anzahl aus einer Bounce-Length-Option.
 * Für `currentPattern` → 1 Bar (= stepCount steps).
 * Für `currentLoop` → opt.bars ?? 4.
 * Für `customBars` → opt.bars ?? 1 (clamped 1..64).
 */
export function resolveBounceBars(opt: BounceLengthOption): number {
  switch (opt.mode) {
    case "currentPattern": return 1;
    case "currentLoop":    return Math.max(1, Math.min(64, opt.bars ?? 4));
    case "customBars":     return Math.max(1, Math.min(64, opt.bars ?? 1));
    default:               return 1;
  }
}

/**
 * Sanitisiert einen Filename-Stem für plattform-übergreifenden Save.
 * Erlaubt: A-Z a-z 0-9 _ - (siehe Electron-IPC-Validierung in main.ts).
 * Whitespace → "_", alle anderen Zeichen entfernt. Max 80 Zeichen.
 */
export function sanitizeStemFilenameStem(input: string): string {
  if (!input) return "stem";
  const replaced = input.trim().replace(/\s+/g, "_");
  const cleaned  = replaced.replace(/[^A-Za-z0-9_-]/g, "");
  const truncated = cleaned.slice(0, 80);
  return truncated || "stem";
}

/**
 * Standard-Filename für einen Channel-Stem:
 *   "<projectName>-<channelName>-stem.wav"
 *
 * Beide Komponenten werden sanitisiert. Bei leeren Inputs nutzen wir
 * "synthstudio" und "channel" als semantische Defaults (nicht "stem"
 * den der Sanitizer als hartes Fallback zurückgibt) — sonst sähe der
 * Default-Filename "stem-stem-stem.wav" verwirrend aus.
 */
export function defaultStemFilename(projectName: string, channelName: string): string {
  const hasProj = projectName && projectName.trim().length > 0;
  const hasCh   = channelName && channelName.trim().length > 0;
  const proj = hasProj ? sanitizeStemFilenameStem(projectName) : "synthstudio";
  const ch   = hasCh   ? sanitizeStemFilenameStem(channelName) : "channel";
  return `${proj}-${ch}-stem.wav`;
}

// ─── Render-Engine ───────────────────────────────────────────────────────────

export interface ChannelBounceRenderOptions {
  /** Wie lang soll das Pattern gerendert werden? */
  length: BounceLengthOption;
  /** Globales BPM (Pattern.bpm override greift wenn gesetzt). */
  bpm: number;
  /** Ziel-Sample-Rate (44100 / 48000). */
  sampleRate: 44100 | 48000;
  /**
   * Optional: AudioBuffer für den `sampleUrl`-Key des Parts. Wenn nicht
   * gegeben oder kein sampleUrl → liefert nur stille Frames.
   */
  sampleBuffer?: AudioBuffer | null;
  /**
   * Stereo (default) oder Mono. Mono spart 50% Datenvolumen; Stereo
   * erhält den Pan-Wert.
   */
  channels?: 1 | 2;
  /** Fadeout-Reserve in Sek. Default 0.5. */
  tailSec?: number;
}

export interface ChannelBounceRenderResult {
  buffer: AudioBuffer;
  durationSec: number;
  sampleRate: number;
  channels: 1 | 2;
}

/**
 * Konstruktor-Type für `OfflineAudioContext`. In Tests injizierbar damit
 * Node.js die Web-Audio-API nicht braucht.
 */
export type OfflineAudioContextCtor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

/**
 * Rendert genau EINEN Channel als AudioBuffer.
 *
 * @param part            Channel-Daten (steps + Pan + Volume + Filter-Cutoff).
 * @param pattern         Übergeordnetes Pattern (für stepCount + stepResolution).
 * @param opts            Render-Optionen (Länge, Sample-Rate, Sample-Buffer).
 * @param OfflineCtxCtor  Optional: injizierter OfflineAudioContext-Konstruktor
 *                        (für Unit-Tests; default ist der globale).
 *
 * @returns AudioBuffer mit dem gerenderten Channel-Output.
 * @throws  Error wenn duration > BOUNCE_MAX_DURATION_SEC.
 */
export async function renderChannelToBuffer(
  part: PartData,
  pattern: PatternData,
  opts: ChannelBounceRenderOptions,
  OfflineCtxCtor?: OfflineAudioContextCtor,
): Promise<ChannelBounceRenderResult> {
  const Ctor = OfflineCtxCtor
    ?? (typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : null);
  if (!Ctor) {
    throw new Error("OfflineAudioContext is not available in this environment");
  }

  const stepsPerBar = pattern.stepCount;
  const bars = resolveBounceBars(opts.length);
  const effectiveBpm = pattern.bpm ?? opts.bpm;
  const durationSec = computeBounceDurationSec(bars, stepsPerBar, effectiveBpm, opts.tailSec ?? 0.5);
  if (durationSec <= 0) {
    throw new Error(`Computed bounce duration <= 0 (bars=${bars} bpm=${effectiveBpm})`);
  }
  if (durationSec > BOUNCE_MAX_DURATION_SEC) {
    throw new Error(`Bounce duration ${durationSec.toFixed(1)}s exceeds maximum ${BOUNCE_MAX_DURATION_SEC}s`);
  }

  const channels: 1 | 2 = opts.channels ?? 2;
  const ctx = new Ctor(channels, Math.ceil(durationSec * opts.sampleRate), opts.sampleRate);

  // Wenn kein Sample-Buffer da ist (z.B. Synth-Part oder Sample noch nicht
  // geladen) liefern wir trotzdem einen valid-leeren Buffer zurück. Das
  // erlaubt der UI ein "leeres Stem"-Hinweis und blockt den Workflow nicht.
  if (opts.sampleBuffer) {
    const stepDurSec = 60 / (effectiveBpm * stepsPerBar / 4);
    let absStep = 0;
    for (let bar = 0; bar < bars; bar++) {
      for (let s = 0; s < stepsPerBar; s++) {
        const step = part.steps[s];
        if (step?.active) {
          const t = absStep * stepDurSec;
          const src  = ctx.createBufferSource();
          src.buffer = opts.sampleBuffer;
          const gain = ctx.createGain();
          gain.gain.value = ((step.velocity ?? 100) / 127) * (part.volume ?? 1);

          // Mute-Flag — wenn der User den Channel im Mixer stummgeschaltet
          // hat, soll der Bounce auch silent sein. Solo wird IGNORIERT —
          // ein User klickt "Bounce" explizit auf diesem Channel.
          if (part.muted) gain.gain.value = 0;

          // Filter (BiquadFilter) — die Channel-FX-Chain hat einen Lowpass
          // pro Channel. Wir spiegeln das hier vereinfacht wenn ein
          // synthParams.cutoff existiert. Für volle FX-Genauigkeit braucht
          // es einen separaten Pfad (siehe README am Ende).
          let node: AudioNode = gain;
          if (part.fx?.filterFreq && part.fx.filterFreq < 20000) {
            const filter = ctx.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = part.fx.filterFreq;
            filter.Q.value = part.fx.filterQ ?? 1;
            gain.connect(filter);
            node = filter;
          }

          if (channels === 2) {
            const panner = ctx.createStereoPanner();
            panner.pan.value = Math.max(-1, Math.min(1, part.pan ?? 0));
            node.connect(panner);
            panner.connect(ctx.destination);
          } else {
            node.connect(ctx.destination);
          }

          src.connect(gain);
          src.start(t);
        }
        absStep++;
      }
    }
  }

  const buffer = await ctx.startRendering();
  return { buffer, durationSec, sampleRate: opts.sampleRate, channels };
}

// ─── WAV-Encode ──────────────────────────────────────────────────────────────

/**
 * Rendert einen Channel und kodiert das Ergebnis als WAV-ArrayBuffer.
 * Convenience-Wrapper über `renderChannelToBuffer` + `encodeWav`.
 */
export async function bounceChannelToWavBuffer(
  part: PartData,
  pattern: PatternData,
  opts: ChannelBounceRenderOptions,
  OfflineCtxCtor?: OfflineAudioContextCtor,
): Promise<ArrayBuffer> {
  const { buffer, sampleRate, channels } = await renderChannelToBuffer(part, pattern, opts, OfflineCtxCtor);
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }
  return encodeWav(channelData, { sampleRate, channels, bitDepth: 16 });
}

// ─── Multi-Channel Bounce ────────────────────────────────────────────────────

export interface BounceAllProgress {
  /** Index des aktuell verarbeiteten Channels (0-basiert). */
  current: number;
  /** Anzahl Channels gesamt. */
  total: number;
  /** Name des aktuell verarbeiteten Channels. */
  channelName: string;
  /** Phase: 'rendering' | 'encoding' | 'saving' | 'done' | 'error'. */
  phase: "rendering" | "encoding" | "saving" | "done" | "error";
  error?: string;
}

export interface BounceAllResult {
  channelId: string;
  channelName: string;
  filename: string;
  wav: ArrayBuffer;
}

/**
 * Bounced alle gegebenen Channels sequentiell. Liefert ein Array
 * { filename, wav } pro Channel. Aufrufer entscheidet, ob via Electron-IPC
 * gespeichert oder via Blob-Download ausgegeben wird.
 *
 * Sequentiell (nicht parallel) um Memory nicht zu sprengen — ein 4-bar-Bounce
 * @ 48k Stereo = ~1.5 MB raw, parallel über 16 Channels wären 24 MB
 * gleichzeitig im RAM. Sequenziell hält Peak-RAM klein.
 */
export async function bounceAllChannels(
  parts: PartData[],
  pattern: PatternData,
  sampleBuffers: Map<string, AudioBuffer>,
  opts: Omit<ChannelBounceRenderOptions, "sampleBuffer">,
  projectName: string,
  onProgress?: (p: BounceAllProgress) => void,
  OfflineCtxCtor?: OfflineAudioContextCtor,
): Promise<BounceAllResult[]> {
  const results: BounceAllResult[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    onProgress?.({
      current: i,
      total: parts.length,
      channelName: part.name,
      phase: "rendering",
    });
    try {
      const sampleBuffer = part.sampleUrl ? sampleBuffers.get(part.sampleUrl) ?? null : null;
      const wav = await bounceChannelToWavBuffer(
        part,
        pattern,
        { ...opts, sampleBuffer },
        OfflineCtxCtor,
      );
      const filename = defaultStemFilename(projectName, part.name);
      results.push({ channelId: part.id, channelName: part.name, filename, wav });
    } catch (err) {
      onProgress?.({
        current: i,
        total: parts.length,
        channelName: part.name,
        phase: "error",
        error: String(err),
      });
      // Continue mit nächstem Channel — ein einziger Failure soll nicht das
      // gesamte Bundle blocken.
    }
  }
  onProgress?.({
    current: parts.length,
    total: parts.length,
    channelName: "",
    phase: "done",
  });
  return results;
}

// ─── Browser-Download-Fallback ───────────────────────────────────────────────

/**
 * Speichert ein WAV-ArrayBuffer im Browser als Download (kein Electron nötig).
 *
 * @param wav      Encoded WAV (z.B. aus bounceChannelToWavBuffer).
 * @param filename Pflicht — wird vom Browser-Save-Dialog übernommen.
 *
 * No-op wenn nicht im DOM-Kontext (z.B. Node.js-Tests).
 */
export function downloadWavInBrowser(wav: ArrayBuffer, filename: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([wav], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke nach kurzem Delay damit der Download startet
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/*
 * ─── README ──────────────────────────────────────────────────────────────────
 *
 * Known Limitations (v2.94.0):
 *  - Insert-FX (16-Band-EQ, Distortion, Comp, Delay, Reverb-Send, Sidechain,
 *    Transient-Shaper, Bitcrusher, RingMod) werden NICHT in den Offline-Render
 *    übernommen. Wir spiegeln nur Volume, Pan und den Lowpass-Filter (fx.filterFreq).
 *  - Synth/Wavetable/FM/Granular-Parts (sourceType ≠ "sample") werden als
 *    stille Frames gebounced — kein Synthesizer-Offline-Render.
 *  - Live-Input-Channels und AudioTrack-Channels (Vocals/Songs) werden nicht
 *    unterstützt — die haben keinen part.steps[]-Pfad.
 *  - Reverb/Delay als Globale Buses werden ebenfalls nicht mitgerendert.
 *
 * Für eine FX-genaue Bounce-Pipeline müsste der gesamte AudioEngine-Graph
 * 1:1 im OfflineAudioContext nachgebaut werden. Das ist ein separates Projekt
 * (siehe Feature-Backlog "OfflineRenderEngine v2"). Für 95% der Bounce-
 * Anwendungsfälle (Stem-Sharing, Quick-Master-Check) ist der pure-Sample-Render
 * mit Volume/Pan/Filter ausreichend.
 */
