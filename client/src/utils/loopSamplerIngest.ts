/**
 * loopSamplerIngest.ts — „Loop-Sampler"-Spuren aus dem Sequenzer hinzufügen.
 *
 * Ein Loop-Sampler ist ein pattern-UNABHÄNGIGER Audio-Track (Melodie-Loop oder
 * Vocal-One-Shot), der über das bestehende Audio-Track-System läuft
 * (`useAudioTrackStore` + `AudioEngine.playAudioTrack` + `AudioClipLaneList`).
 * Diese Spuren stecken bewusst NICHT in `PatternData.parts` → der Step-Scheduler
 * sieht sie nie, und ein Pattern-Wechsel stoppt sie nicht. Genau das will der
 * User: Melodien/Vocals, die über Pattern-Grenzen hinweg weiterlaufen.
 *
 * Statt ein paralleles System zu bauen, ergänzt dieses Util nur den fehlenden
 * Sequenzer-Einstiegspunkt (Button neben „+ Kanal") und wiederverwendet den
 * exakt gleichen Ingest-Pfad wie der Mixer (`MixerView.ingestAudioFile`):
 * addAudioTrack → loadAudioTrack → registerAudioTrack → Peaks.
 *
 * Zwei Modi:
 *   - "loop"    : `loop`/`loopEnabled = true`  → nahtlose Endlosschleife (Melodie)
 *   - "oneshot" : `loop`/`loopEnabled = false` → einmal durchspielen (Vocal/FX)
 *
 * Der reine Builder (`buildLoopSamplerTrackData`, `loopSamplerStemName`) ist in
 * Node testbar; das eigentliche Laden/Decoden ist Browser-only (Web Audio) und
 * wird — wie der übrige AudioEngine-Pfad — nicht in Node unit-getestet.
 */

import { AudioEngine } from "@/audio/AudioEngine";
import {
  addAudioTrack,
  markBroken,
  setRuntimeWaveform,
} from "@/store/useAudioTrackStore";
import { computePeaksFromBuffer } from "@/components/Mixer/AudioTrackStrip";
import {
  type LoopSamplerMode,
  loopSamplerStemName,
  buildLoopSamplerTrackData,
} from "./loopSampler";

export type { LoopSamplerMode };

export interface LoopSamplerIngestResult {
  trackId: string | null;
  broken: boolean;
  error?: string;
}

/**
 * Legt einen Loop-Sampler aus einer Browser-`File` an: Track registrieren,
 * Buffer laden/decoden, Peaks berechnen. Fire-and-forget-tauglich; liefert das
 * Ergebnis für UI-Feedback. Bei erreichtem Track-Limit oder Decode-Fehler wird
 * `trackId` (falls angelegt) als broken markiert und `error` gesetzt.
 */
export async function ingestLoopSamplerFile(
  file: File,
  mode: LoopSamplerMode
): Promise<LoopSamplerIngestResult> {
  const name = loopSamplerStemName(file.name);
  const data = buildLoopSamplerTrackData({
    name,
    filePath: file.name,
    fileName: file.name,
    fileSize: file.size,
    mode,
  });

  let trackId: string;
  try {
    trackId = addAudioTrack(data);
  } catch (err) {
    return {
      trackId: null,
      broken: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const buf = await AudioEngine.loadAudioTrack(trackId, file);
    if (!buf) {
      markBroken(trackId, true);
      return { trackId, broken: true, error: "Decode fehlgeschlagen" };
    }
    AudioEngine.registerAudioTrack({ id: trackId, ...data });
    setRuntimeWaveform(trackId, buf.duration, computePeaksFromBuffer(buf, 200));
    return { trackId, broken: false };
  } catch (err) {
    markBroken(trackId, true);
    return {
      trackId,
      broken: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
