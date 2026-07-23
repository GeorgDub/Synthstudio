/**
 * loopSampler.ts — reine Builder/Helfer für „Loop-Sampler"-Spuren.
 *
 * Ein Loop-Sampler ist ein pattern-UNABHÄNGIGER Audio-Track (Melodie-Loop oder
 * Vocal-One-Shot) über das bestehende Audio-Track-System. Diese Datei enthält
 * NUR seiteneffektfreie Logik (Default-Naming + Track-Daten-Builder) und
 * importiert ausschließlich den Typ `AudioTrackChannelData` (type-only → zur
 * Laufzeit gelöscht). Dadurch bleibt sie in Node testbar, während der
 * eigentliche Ingest (`loopSamplerIngest.ts`) die Browser-Singletons zieht.
 */

import type { AudioTrackChannelData } from "@/audio/AudioEngine";

export type LoopSamplerMode = "loop" | "oneshot";

export const LOOP_SAMPLER_MODES: LoopSamplerMode[] = ["loop", "oneshot"];

/** Dateiname-Stamm als Default-Spurname (ohne Endung, auf 40 Zeichen gekappt). */
export function loopSamplerStemName(rawName: string): string {
  return rawName.replace(/\.[^.]+$/, "").slice(0, 40) || "Loop-Sampler";
}

/**
 * Baut das Track-Daten-Objekt (ohne id) für einen neuen Loop-Sampler. Rein +
 * testbar. `mode` steuert die Loop-Flags (`loop`/`loopEnabled`); alle anderen
 * Felder sind sinnvolle Defaults, identisch zum Mixer-Ingest.
 *
 *  - "loop"    → looping = true  (nahtlose Endlosschleife, Melodie/Groove)
 *  - "oneshot" → looping = false (einmal durchspielen, Vocal-Phrase/FX)
 */
export function buildLoopSamplerTrackData(opts: {
  name: string;
  filePath: string;
  fileName: string;
  fileSize?: number;
  mode: LoopSamplerMode;
}): Omit<AudioTrackChannelData, "id"> {
  const looping = opts.mode === "loop";
  return {
    name: opts.name,
    filePath: opts.filePath,
    fileName: opts.fileName,
    fileSize: opts.fileSize,
    volume: 1,
    pan: 0,
    muted: false,
    soloed: false,
    sends: { reverb: 0, delay: 0 },
    syncMode: "free",
    loop: looping,
    loopEnabled: looping,
  };
}
