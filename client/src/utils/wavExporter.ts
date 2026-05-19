/**
 * Synthstudio – wavExporter.ts
 *
 * Browser-basierter WAV-Export via OfflineAudioContext.
 * Rendert das aktuelle Pattern in Echtzeit in einen AudioBuffer
 * und konvertiert ihn zu einer WAV-Datei.
 *
 * Unterstützte Modi:
 *  - Master Mix (Stereo): Alle Kanäle gemischt
 *  - Stems: Jeder Kanal als separate WAV-Datei
 *
 * Qualität: 44100 Hz / 32-bit Float → 16-bit PCM WAV
 */

import type { PatternData } from "@/audio/AudioEngine";
import {
  encodeAsOgg,
  filenameForFormat,
  DEFAULT_OGG_BITRATE_BPS,
  type CompressFormat,
} from "@/utils/audioCompressEncoder";

export interface ExportOptions {
  mode: "master" | "stems";
  bars: number;          // Anzahl Bars exportieren (1–16)
  bpm: number;
  sampleRate: number;    // 44100 | 48000
  bitDepth: 16 | 24 | 32;
  /** v3.83.0 — Compressed-Export-Format (wav default, ogg = Opus). */
  format?: CompressFormat;
  /** v3.83.0 — Ziel-Bitrate für ogg (bps). Default 192_000. */
  bitrate?: number;
}

export interface ExportProgress {
  phase: "rendering" | "encoding" | "downloading" | "done" | "error";
  progress: number;      // 0–1
  message: string;
  error?: string;
}

/** Konvertiert Float32Array PCM zu WAV Blob (16-bit PCM) */
function floatTo16BitPCM(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view   = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Erstellt WAV-Header */
function createWavHeader(numSamples: number, sampleRate: number, numChannels: number): ArrayBuffer {
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;

  const header = new ArrayBuffer(44);
  const view   = new DataView(header);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);         // Chunk size
  view.setUint16(20, 1, true);          // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  return header;
}

/** Erstellt WAV-Blob aus AudioBuffer */
function audioBufferToWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const numSamples  = audioBuffer.length;
  const sampleRate  = audioBuffer.sampleRate;

  // Interleave Channels
  const interleaved = new Float32Array(numSamples * numChannels);
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < numSamples; i++) {
      interleaved[i * numChannels + ch] = channelData[i];
    }
  }

  const header  = createWavHeader(numSamples * numChannels, sampleRate, numChannels);
  const pcmData = floatTo16BitPCM(interleaved);

  return new Blob([header, pcmData], { type: "audio/wav" });
}

/** Download-Hilfsfunktion */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/**
 * Exportiert das Pattern als WAV (Master Mix oder Stems).
 * Verwendet OfflineAudioContext für offline-Rendering.
 */
export async function exportPattern(
  pattern: PatternData,
  samples: Map<string, AudioBuffer>,
  opts: ExportOptions,
  onProgress: (p: ExportProgress) => void,
): Promise<void> {
  const stepsPerBar  = pattern.stepCount;
  const totalSteps   = stepsPerBar * opts.bars;
  const secsPerStep  = 60 / (opts.bpm * (pattern.stepCount / 4));
  const durationSec  = totalSteps * secsPerStep + 1.0; // +1s Fadeout
  const sampleRate   = opts.sampleRate;

  onProgress({ phase: "rendering", progress: 0, message: "Rendering startet…" });

  try {
    if (opts.mode === "master") {
      const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);

      // Alle Parts rendern
      for (const part of pattern.parts) {
        const buf = samples.get(part.sampleUrl ?? "");
        if (!buf) continue;
        let absStep = 0;
        for (let bar = 0; bar < opts.bars; bar++) {
          for (let s = 0; s < stepsPerBar; s++) {
            const step = part.steps[s];
            if (!step?.active) { absStep++; continue; }
            const t   = absStep * secsPerStep;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const vol  = ((step.velocity ?? 100) / 127) * (part.volume ?? 1);
            const gain = ctx.createGain();
            gain.gain.value = vol;
            const pan   = ctx.createStereoPanner();
            pan.pan.value = part.pan ?? 0;
            src.connect(gain); gain.connect(pan); pan.connect(ctx.destination);
            src.start(t);
            absStep++;
            onProgress({ phase: "rendering", progress: absStep / totalSteps, message: `Render Step ${absStep}/${totalSteps}…` });
          }
        }
      }

      const rendered = await ctx.startRendering();
      const fmt: CompressFormat = opts.format ?? "wav";
      onProgress({ phase: "encoding", progress: 0.9, message: fmt === "ogg" ? "OGG/Opus kodieren…" : "WAV kodieren…" });
      const blob = fmt === "ogg"
        ? await encodeAsOgg(rendered, { bitrate: opts.bitrate ?? DEFAULT_OGG_BITRATE_BPS })
        : audioBufferToWav(rendered);
      onProgress({ phase: "downloading", progress: 0.95, message: "Herunterladen…" });
      downloadBlob(blob, filenameForFormat(pattern.name, blob.type === "audio/ogg" ? "ogg" : "wav"));
    }

    else {
      // Stems: ein WAV pro Part
      for (let pi = 0; pi < pattern.parts.length; pi++) {
        const part = pattern.parts[pi];
        const buf  = samples.get(part.sampleUrl ?? "");
        if (!buf) continue;

        const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
        let absStep = 0;
        for (let bar = 0; bar < opts.bars; bar++) {
          for (let s = 0; s < stepsPerBar; s++) {
            const step = part.steps[s];
            if (step?.active) {
              const t   = absStep * secsPerStep;
              const src = ctx.createBufferSource();
              src.buffer = buf;
              const gain = ctx.createGain();
              gain.gain.value = ((step.velocity ?? 100) / 127) * (part.volume ?? 1);
              src.connect(gain); gain.connect(ctx.destination);
              src.start(t);
            }
            absStep++;
          }
        }
        const rendered = await ctx.startRendering();
        const fmt: CompressFormat = opts.format ?? "wav";
        const blob = fmt === "ogg"
          ? await encodeAsOgg(rendered, { bitrate: opts.bitrate ?? DEFAULT_OGG_BITRATE_BPS })
          : audioBufferToWav(rendered);
        const baseName = `${pattern.name}_${part.name}`;
        downloadBlob(blob, filenameForFormat(baseName, blob.type === "audio/ogg" ? "ogg" : "wav"));
        onProgress({ phase: "rendering", progress: (pi + 1) / pattern.parts.length, message: `${part.name} exportiert` });
      }
    }

    onProgress({ phase: "done", progress: 1, message: "Export abgeschlossen ✓" });
  } catch (err) {
    onProgress({ phase: "error", progress: 0, message: "Export fehlgeschlagen", error: String(err) });
  }
}
