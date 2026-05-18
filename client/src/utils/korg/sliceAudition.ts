/**
 * Synthstudio – Slice Audition (v3.9.0)
 *
 * Pure-Helpers für Slice-Preview-Playback im KorgBankEditor:
 *   - findSliceUnderFrame: locate the slice region containing a given frame
 *   - extractSliceBuffer:  copy the PCM sub-range of a slice into a mono Float32Array
 *   - playSliceWithContext: thin wrapper around Web-Audio for one-shot audition
 *                           with a stop-handle (Web-Audio side; testable via
 *                           AudioContext-like mock)
 *
 * KEINE React- oder DOM-spezifischen Imports. Vollständig in Node testbar.
 *
 * Wird ergänzend zu AudioEngine.playSliceBuffer angeboten — die Engine-Methode
 * gibt nur ein boolean zurück (kein stop-Handle). Audition braucht aber:
 *   - "Click → next click stoppt previous" → handle.stop()
 *   - "onEnded → highlight automatisch raus" → onEnded-Callback
 */

import type { OnsetCandidate } from "@/utils/sampleSlicing";

// ─── Slice-Region-Finder ─────────────────────────────────────────────────────

export interface SliceRegion {
  /** Index in der `onsets` Liste (0..n-1). */
  index: number;
  /** Start-Frame (inklusiv). */
  startFrame: number;
  /** End-Frame (exklusiv). Endet entweder am nächsten Onset oder bei totalFrames. */
  endFrame: number;
}

/**
 * Findet die Slice-Region, die `frame` enthält.
 *
 * Annahmen:
 *   - onsets sind nicht zwingend sortiert; wir sortieren lokal nach frame asc.
 *   - Out-of-range frames (frame < firstOnset.frame oder frame >= totalFrames)
 *     liefern null.
 *   - totalFrames <= 0 oder leere Onsets → null.
 *
 * Beispiel: onsets = [{frame:0}, {frame:100}, {frame:300}], total=500.
 *           frame=50  → region 0 (0..100)
 *           frame=200 → region 1 (100..300)
 *           frame=400 → region 2 (300..500)
 *           frame=600 → null
 */
export function findSliceUnderFrame(
  onsets: ReadonlyArray<OnsetCandidate>,
  frame: number,
  totalFrames: number,
): SliceRegion | null {
  if (!Array.isArray(onsets) || onsets.length === 0) return null;
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) return null;
  if (!Number.isFinite(frame) || frame < 0 || frame >= totalFrames) return null;

  // Defensive: lokale Kopie + sort.
  const sorted = [...onsets].sort((a, b) => a.frame - b.frame);

  // Frame liegt vor dem ersten Onset → kein Slice greift.
  if (frame < sorted[0].frame) return null;

  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].frame;
    const end =
      i + 1 < sorted.length ? sorted[i + 1].frame : totalFrames;
    if (frame >= start && frame < end) {
      // Wir geben den Index in der lokalen sortierten Liste zurück —
      // bei bereits-sortierten Onsets matched das den Caller-Index.
      // Mapping zurück: finde den Original-Index per frame-Vergleich.
      const originalIndex = onsets.findIndex(
        (o) => o.frame === sorted[i].frame,
      );
      return {
        index: originalIndex >= 0 ? originalIndex : i,
        startFrame: start,
        endFrame: end,
      };
    }
  }
  return null;
}

// ─── PCM-Slice-Extraktion ────────────────────────────────────────────────────

/**
 * Extrahiert die Frames [startFrame, endFrame) aus einem PCM-Buffer in einen
 * frischen Mono-Float32Array. Bei Stereo (channels=2, interleaved L/R) wird
 * Kanal 0 (Left) verwendet — kein Mixdown, damit der User die "echte" Wave hört.
 *
 * Defensive Bound-Clamping:
 *   - startFrame < 0          → 0
 *   - endFrame > totalFrames  → totalFrames
 *   - endFrame <= startFrame  → leerer Array
 *
 * pcm muss interleaved sein bei channels=2: [L0,R0,L1,R1,...]. Die Länge muss
 * frames*channels betragen. Wir clampen tolerant.
 */
export function extractSliceBuffer(
  pcm: Float32Array,
  channels: 1 | 2,
  startFrame: number,
  endFrame: number,
): Float32Array {
  if (!pcm || pcm.length === 0) return new Float32Array(0);
  const ch = channels === 2 ? 2 : 1;
  const totalFrames = Math.floor(pcm.length / ch);
  const s = Math.max(0, Math.floor(startFrame));
  const e = Math.min(totalFrames, Math.floor(endFrame));
  if (e <= s) return new Float32Array(0);

  if (ch === 1) {
    // Mono: directes subarray reicht nicht — wir wollen GC-Unabhängigkeit,
    // also Copy via slice() (eigener Buffer).
    return pcm.slice(s, e);
  }

  // Stereo: Kanal 0 deinterleaven.
  const out = new Float32Array(e - s);
  for (let i = 0; i < out.length; i++) {
    out[i] = pcm[(s + i) * 2];
  }
  return out;
}

// ─── Web-Audio One-Shot mit Stop-Handle ──────────────────────────────────────

export interface SliceAuditionHandle {
  /** Stoppt die laufende Source sofort + disconnect. Idempotent. */
  stop: () => void;
  /** True wenn aktuell noch nicht gestoppt wurde. */
  readonly active: boolean;
}

/**
 * Minimal-AudioContext-Interface, damit wir gegen Mocks testen können.
 * Echte AudioContext erfüllt es trivial.
 */
export interface MinimalAudioCtx {
  createBuffer: (
    numChannels: number,
    length: number,
    sampleRate: number,
  ) => AudioBuffer;
  createBufferSource: () => AudioBufferSourceNode;
  createGain: () => GainNode;
  readonly destination: AudioNode;
}

/**
 * Erstellt eine one-shot Slice-Playback Source und gibt ein Stop-Handle zurück.
 *
 * Routing: BufferSource → Gain (0.85) → outputNode (default: ctx.destination).
 *   - outputNode kann der masterGain der AudioEngine sein (so kann die FX-Bus
 *     Kette mitgenutzt werden, falls gewünscht). Default = ctx.destination,
 *     damit Audition immer den User-Setup-FX umgeht (sauberes A/B).
 *
 * onEnded wird einmalig gerufen wenn die Source natürlich fertig ist ODER
 * stop() aufgerufen wurde (Browser feuert "ended" auch nach explicit stop()).
 *
 * Defensive:
 *   - buffer.length === 0      → null
 *   - sampleRate <= 0 / !finite → null
 *   - Exception im createBuffer → null
 */
export function playSliceWithContext(
  ctx: MinimalAudioCtx,
  buffer: Float32Array,
  sampleRate: number,
  options?: {
    outputNode?: AudioNode;
    gain?: number;
    onEnded?: () => void;
  },
): SliceAuditionHandle | null {
  if (!buffer || buffer.length === 0) return null;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;

  let stopped = false;
  let source: AudioBufferSourceNode | null = null;
  let gainNode: GainNode | null = null;

  try {
    const ab = ctx.createBuffer(1, buffer.length, sampleRate);
    // copyToChannel ist im real AudioContext verfügbar; bei Mocks erlauben
    // wir alternativ einen direkten Zugriff über getChannelData().
    if (typeof (ab as AudioBuffer).copyToChannel === "function") {
      (ab as AudioBuffer).copyToChannel(new Float32Array(buffer), 0);
    } else {
      const ch = (ab as AudioBuffer).getChannelData(0);
      for (let i = 0; i < buffer.length && i < ch.length; i++) {
        ch[i] = buffer[i];
      }
    }
    source = ctx.createBufferSource();
    source.buffer = ab;
    gainNode = ctx.createGain();
    gainNode.gain.value =
      typeof options?.gain === "number" && options.gain >= 0
        ? options.gain
        : 0.85;
    source.connect(gainNode);
    const out = options?.outputNode ?? ctx.destination;
    gainNode.connect(out);

    const cleanup = (): void => {
      try { source?.disconnect(); } catch { /* ignore */ }
      try { gainNode?.disconnect(); } catch { /* ignore */ }
    };

    source.onended = (): void => {
      if (stopped) return;
      stopped = true;
      cleanup();
      try { options?.onEnded?.(); } catch { /* swallow user-cb errors */ }
    };

    source.start();

    return {
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        try { source?.stop(); } catch { /* already stopped */ }
        cleanup();
        try { options?.onEnded?.(); } catch { /* swallow */ }
      },
      get active(): boolean { return !stopped; },
    };
  } catch (err) {
    // Cleanup partial state on error.
    try { source?.disconnect(); } catch { /* ignore */ }
    try { gainNode?.disconnect(); } catch { /* ignore */ }
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[sliceAudition] playSliceWithContext failed", err);
    }
    return null;
  }
}
