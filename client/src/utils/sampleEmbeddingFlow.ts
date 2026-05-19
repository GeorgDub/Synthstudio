/**
 * Synthstudio – sampleEmbeddingFlow.ts (v3.131.0)
 *
 * Save/Load-Flow für Embed-Sample-Persistence — schließt v3.124 UI-Caveat:
 * v3.124 lieferte sampleEmbedding.ts (pure WAV-Encode/Decode), aber der App.tsx
 * Save/Load-Pipeline-Anschluss fehlte. v3.131 bringt zwei Pure Helpers, die
 * die Sample-Liste eines Projekts transformieren:
 *
 *   prepareProjectForSave(project, options) → Promise<Project>
 *     • iteriert sample-array
 *     • bei Blob-URL-Sample + options.embedTransformed=true:
 *       fetch(blob-url) → decodeAudioData → audioBufferToBase64Wav → set embeddedData
 *     • Total-Size-Cap-Check (default 50 × MAX_EMBED_SIZE_KB = 500 MB) — throws
 *
 *   restoreEmbeddedSamples(project, ctx, options) → Promise<Project>
 *     • iteriert samples mit embeddedData
 *     • base64WavToAudioBuffer → Blob → URL.createObjectURL → set path
 *     • bei corruptem Base64: setzt path leer, behält embeddedData
 *       (Sample bleibt unbenutzbar, aber kein Crash; Caller kann Warning zeigen)
 *
 * Pure: keine direkten DOM/AudioEngine-Calls — Dependency-Injection via
 * options.decodeAudioData / options.fetchBlob für Testbarkeit ohne Browser.
 *
 * Tests: tests/features/sample-embedding-flow.test.ts
 */

import {
  audioBufferToBase64Wav,
  base64WavToAudioBuffer,
  estimateEmbedSizeKb,
  isBlobUrlPath,
  MAX_EMBED_SIZE_KB,
  type AudioBufferLike,
} from "./sampleEmbedding";

// ─── Public Types ────────────────────────────────────────────────────────────

/**
 * Minimal-Sample-Interface das wir hier brauchen.  Match useProjectStore.Sample
 * (id + path + optional embeddedData) ohne harten Import (vermeidet Circular).
 */
export interface EmbedSampleLike {
  id: string;
  path?: string;
  embeddedData?: string;
  /** Optional: weitere Felder werden 1:1 durchgereicht. */
  [extra: string]: unknown;
}

export interface EmbedProjectLike {
  samples?: EmbedSampleLike[];
  /** Andere Felder werden 1:1 durchgereicht. */
  [extra: string]: unknown;
}

export interface PrepareForSaveOptions {
  /** Default true — wenn false werden Blob-URLs NICHT embedded. */
  embedTransformed?: boolean;
  /** Default 50× MAX_EMBED_SIZE_KB = 500 MB Total-Cap.  Wenn überschritten → throws. */
  maxTotalSizeKb?: number;
  /**
   * Dependency-Injection: liefert AudioBufferLike für einen Sample-Pfad.
   * In App.tsx: fetch(path) → blob → AudioContext.decodeAudioData → AudioBuffer.
   * In Tests: liefert MockAudioBuffer.  Wenn nicht angegeben → Sample wird
   * unverändert gelassen (kein Fehler).
   */
  loadAudioBuffer?: (path: string) => Promise<AudioBufferLike | null>;
  /**
   * Optional progress-callback für lange Operations (z.B. 10+ Samples).
   * Bekommt 0..1 — UI kann progress-bar zeigen.
   */
  onProgress?: (fraction: number) => void;
}

export interface RestoreOptions {
  /**
   * Dependency-Injection: decodet Base64 + WAV bytes zu AudioBuffer und liefert
   * eine Blob-URL.  In App.tsx: base64WavToAudioBuffer + URL.createObjectURL.
   * In Tests: liefert mock string.  Wenn nicht angegeben → embeddedData wird
   * NICHT restored (Sample bleibt mit embeddedData drin, path bleibt wie es war).
   */
  decodeToBlobUrl?: (base64: string) => Promise<string>;
  /** Optional progress callback. */
  onProgress?: (fraction: number) => void;
  /** Optional warning callback für corruptes embeddedData. */
  onWarning?: (sampleId: string, reason: string) => void;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Liefert Schätzung der Gesamt-Embed-Größe (alle Samples mit embeddedData).
 * Nützlich für UI-Anzeige im Save-Dialog vor Commit.
 */
export function estimateProjectEmbedSizeKb(project: EmbedProjectLike): number {
  const samples = Array.isArray(project.samples) ? project.samples : [];
  let total = 0;
  for (const s of samples) {
    if (typeof s.embeddedData === "string" && s.embeddedData.length > 0) {
      // Base64 → bytes ≈ length × 0.75 → kb = bytes / 1024.
      total += Math.ceil((s.embeddedData.length * 0.75) / 1024);
    }
  }
  return total;
}

/**
 * Liefert die Anzahl Blob-URL-Samples (= Kandidaten für embedding).
 */
export function countBlobUrlSamples(project: EmbedProjectLike): number {
  const samples = Array.isArray(project.samples) ? project.samples : [];
  let count = 0;
  for (const s of samples) {
    if (isBlobUrlPath(s.path)) count++;
  }
  return count;
}

/**
 * Prepare-for-Save.  Pure (keine globale Mutation).
 *
 * Iteriert alle samples, embeded Blob-URLs (wenn enabled), liefert eine neue
 * Project-Kopie mit aktualisierten Sample-Einträgen.  Sample-Objekte werden
 * shallow-copy'd — die anderen Felder (name, tags, etc.) bleiben unverändert.
 *
 * Throws bei:
 *  - Total-Size-Cap-Überschreitung (default 500 MB)
 *  - loadAudioBuffer-Errors (propagiert)
 */
export async function prepareProjectForSave(
  project: EmbedProjectLike,
  options: PrepareForSaveOptions = {},
): Promise<EmbedProjectLike> {
  const embedTransformed = options.embedTransformed !== false; // default true
  const maxTotal = options.maxTotalSizeKb ?? MAX_EMBED_SIZE_KB * 50;
  const samples = Array.isArray(project.samples) ? project.samples : [];

  if (!embedTransformed || !options.loadAudioBuffer || samples.length === 0) {
    return project;
  }

  const newSamples: EmbedSampleLike[] = [];
  let totalKb = estimateProjectEmbedSizeKb(project);
  const total = samples.length;
  let i = 0;

  for (const s of samples) {
    i++;
    options.onProgress?.(i / total);

    // Skip wenn bereits embeddedData, oder kein Blob-URL.
    if (s.embeddedData || !isBlobUrlPath(s.path)) {
      newSamples.push(s);
      continue;
    }

    // Try to load buffer.
    const buffer = await options.loadAudioBuffer(s.path as string);
    if (!buffer) {
      newSamples.push(s);
      continue;
    }

    // Estimate cost before encoding.
    const cost = estimateEmbedSizeKb(buffer);
    if (totalKb + cost > maxTotal) {
      throw new Error(
        `prepareProjectForSave: total embed size would exceed cap (${maxTotal} KB), aborting at sample "${s.id}"`,
      );
    }

    // Encode and embed.
    const base64 = audioBufferToBase64Wav(buffer);
    newSamples.push({ ...s, embeddedData: base64 });
    totalKb += cost;
  }

  return { ...project, samples: newSamples };
}

/**
 * Restore-on-Load.  Pure.
 *
 * Iteriert samples mit embeddedData, decodet sie und ersetzt den path durch
 * eine frische Blob-URL.  Sample-Objekte werden shallow-copy'd.
 *
 * Defensive bei corruptem embeddedData:
 *  - onWarning wird gerufen (wenn provided)
 *  - Sample wird unverändert durchgelassen (embeddedData bleibt → kann später retried werden)
 */
export async function restoreEmbeddedSamples(
  project: EmbedProjectLike,
  options: RestoreOptions = {},
): Promise<EmbedProjectLike> {
  const samples = Array.isArray(project.samples) ? project.samples : [];
  if (!options.decodeToBlobUrl || samples.length === 0) return project;

  const newSamples: EmbedSampleLike[] = [];
  const total = samples.length;
  let i = 0;

  for (const s of samples) {
    i++;
    options.onProgress?.(i / total);

    // Skip wenn kein embeddedData.
    if (typeof s.embeddedData !== "string" || s.embeddedData.length === 0) {
      newSamples.push(s);
      continue;
    }

    // Skip wenn path bereits aktiver Blob-URL (bereits restored — vermeidet
    // doppelte Decodes pro Reload).  Das ist defensive für Round-Trip-Use-Cases.
    if (isBlobUrlPath(s.path)) {
      newSamples.push(s);
      continue;
    }

    try {
      const blobUrl = await options.decodeToBlobUrl(s.embeddedData);
      newSamples.push({ ...s, path: blobUrl });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      options.onWarning?.(s.id, reason);
      newSamples.push(s);
    }
  }

  return { ...project, samples: newSamples };
}

/**
 * Browser-Adapter wird in App.tsx selbst gebaut (kein TS-friction-Wrapper hier).
 * Empfohlene Implementierung (in App.tsx):
 *
 *     const decodeToBlobUrl = async (b64: string): Promise<string> => {
 *       const buf = await base64WavToAudioBuffer(b64, audioCtx as any);
 *       const wavBytes = audioBufferToWavBytes(buf);
 *       const blob = new Blob([new Uint8Array(wavBytes)], { type: "audio/wav" });
 *       return URL.createObjectURL(blob);
 *     };
 *
 * Wir lassen es Caller's Verantwortung — der Type-Cast `as any` ist OK weil
 * AudioBuffer + AudioBufferLike strukturell kompatibel sind (nur duration/copy
 * fehlen die wir nicht nutzen).
 */
