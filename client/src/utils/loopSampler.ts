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
    // Start "free"; der Ingest schaltet nach erfolgreicher BPM-Erkennung auf
    // timestretch um (siehe warpFieldsForDetectedBpm). Ohne bekanntes
    // originalBpm wäre timestretch nur unnötige Worklet-Last bei Rate 1.
    syncMode: "free",
    loop: looping,
    loopEnabled: looping,
  };
}

/** Mindest-Confidence, ab der ein erkanntes BPM den Loop automatisch warpt. */
export const LOOP_SYNC_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Bestimmt die Tempo-Sync-Felder für einen frisch erkannten BPM-Wert. Rein +
 * testbar. Nur Loop-Modus wird gewarpt (One-Shots/Vocals sollen ihr Original-
 * Tempo behalten). Bei zu geringer Confidence oder ungültigem BPM → null (der
 * Track bleibt „free", spielt also im Naturtempo — kein Artefakt).
 *
 * `timestretch` = pitch-erhaltend: die Melodie folgt dem Projekt-BPM, ohne die
 * Tonhöhe zu verziehen (`_calcAudioTrackPlaybackRate` nutzt projectBpm/originalBpm).
 */
export function warpFieldsForDetectedBpm(
  mode: LoopSamplerMode,
  detected: { bpm: number; confidence: number } | null
): {
  originalBpm: number;
  syncMode: NonNullable<AudioTrackChannelData["syncMode"]>;
} | null {
  if (mode !== "loop" || !detected) return null;
  if (!Number.isFinite(detected.bpm) || detected.bpm <= 0) return null;
  if (detected.confidence < LOOP_SYNC_CONFIDENCE_THRESHOLD) return null;
  return { originalBpm: detected.bpm, syncMode: "timestretch" };
}
