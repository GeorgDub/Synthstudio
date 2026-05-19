/**
 * Synthstudio – sampleTransform.worker.ts (v3.120.0)
 *
 * Web Worker für offline Time-Stretch + Pitch-Shift auf Sample-Buffern.
 * Schließt das Main-Thread-Blocking-Caveat aus v3.116 — Stereo-Loops > 30s
 * @ 48k haben dort den UI-Thread ~1s blockiert.
 *
 * ─── Protokoll ──────────────────────────────────────────────────────────────
 * Inbound:
 *   {
 *     cmd: 'transform',
 *     requestId: string,
 *     channels: Float32Array[],   // pro Kanal ein typed array
 *     sampleRate: number,
 *     ratio: number,              // time-stretch (0.25..4.0)
 *     semitones: number           // pitch-shift (-24..+24)
 *   }
 *
 * Outbound:
 *   { type: 'progress', requestId, percent }   // alle ~5%
 *   { type: 'done', requestId, channels, sampleRate }
 *   { type: 'error', requestId, message }
 *
 * Float32Array-Buffer werden via Transferable transferiert (zero-copy).
 *
 * ─── Algorithmus ───────────────────────────────────────────────────────────
 * Identisch zur Sync-Version (sampleTransform.ts → combinedTransform):
 *   1. effectiveStretch = ratio * 2^(semitones/12)
 *   2. OLA-Time-Stretch (Hann-Window, 2048 grain, 512 hop)
 *   3. Resample-Linear auf finalLength = round(sourceLen * ratio)
 *
 * Pure (kein AudioContext im Worker — Float32Array in, Float32Array out).
 */

// ─── Konstanten ──────────────────────────────────────────────────────────────

const STRETCH_MIN = 0.25;
const STRETCH_MAX = 4.0;
const PITCH_MIN = -24;
const PITCH_MAX = 24;
const RATIO_EPSILON = 0.001;
const SEMITONE_EPSILON = 0.01;
const GRAIN_SIZE = 2048;
const HOP_SIZE = 512;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return 1;
  if (r < STRETCH_MIN) return STRETCH_MIN;
  if (r > STRETCH_MAX) return STRETCH_MAX;
  return r;
}

function clampSemitones(s: number): number {
  if (!Number.isFinite(s)) return 0;
  if (s < PITCH_MIN) return PITCH_MIN;
  if (s > PITCH_MAX) return PITCH_MAX;
  return s;
}

function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

function makeHann(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return w;
}

function resampleLinear(source: Float32Array, outLength: number): Float32Array {
  const out = new Float32Array(outLength);
  if (outLength === 0 || source.length === 0) return out;
  if (outLength === source.length) {
    out.set(source);
    return out;
  }
  const step = (source.length - 1) / Math.max(1, outLength - 1);
  for (let i = 0; i < outLength; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(source.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = source[i0] * (1 - frac) + source[i1] * frac;
  }
  return out;
}

/**
 * OLA Time-Stretch pro Kanal.  Operiert pure Float32 → Float32.
 * `progress` Callback wird in ~5%-Schritten gerufen.
 */
function timeStretchChannel(
  inData: Float32Array,
  ratio: number,
  channelIdx: number,
  channelCount: number,
  onProgress?: (percent: number) => void,
): Float32Array {
  const inLength = inData.length;
  const outLength = Math.round(inLength * ratio);
  const hopIn = Math.max(1, Math.round(HOP_SIZE * ratio));
  const hopOut = HOP_SIZE;
  const window = makeHann(GRAIN_SIZE);

  const outData = new Float32Array(outLength);

  let inPos = 0;
  let outPos = 0;
  let lastProgress = 0;

  while (outPos < outLength) {
    for (let j = 0; j < GRAIN_SIZE; j++) {
      const inIdx = inPos + j;
      const outIdx = outPos + j;
      if (outIdx >= outLength) break;
      const sample = inIdx < inLength ? inData[inIdx] : 0;
      outData[outIdx] += sample * window[j];
    }
    inPos += hopIn;
    outPos += hopOut;
    if (inPos >= inLength) inPos = inPos % inLength;

    // Progress alle ~5% (per Kanal)
    if (onProgress && outLength > 0) {
      const channelPct = outPos / outLength;
      const overallPct = ((channelIdx + channelPct) / channelCount) * 100;
      if (overallPct - lastProgress >= 5) {
        lastProgress = overallPct;
        onProgress(Math.min(99, Math.floor(overallPct)));
      }
    }
  }

  // Normalisierung
  let maxVal = 0;
  for (let i = 0; i < outLength; i++) {
    const a = Math.abs(outData[i]);
    if (a > maxVal) maxVal = a;
  }
  if (maxVal > 1.0) {
    const norm = 1.0 / maxVal;
    for (let i = 0; i < outLength; i++) outData[i] *= norm;
  }

  return outData;
}

// ─── Core Transform (pure, exportiert für Tests) ────────────────────────────

export interface TransformInput {
  channels: Float32Array[];
  sampleRate: number;
  ratio: number;
  semitones: number;
}

export interface TransformOutput {
  channels: Float32Array[];
  sampleRate: number;
}

/**
 * Hauptlogik — gleiche Math wie combinedTransform aus sampleTransform.ts.
 * Wird im Worker UND in der Main-Thread-Fallback aufgerufen (DRY).
 */
export function transformChannels(
  input: TransformInput,
  onProgress?: (percent: number) => void,
): TransformOutput {
  const { channels, sampleRate } = input;
  const ratio = clampRatio(input.ratio);
  const semitones = clampSemitones(input.semitones);

  if (channels.length === 0 || channels[0].length === 0) {
    throw new Error("transformChannels: empty input");
  }

  const isStretchIdentity = Math.abs(ratio - 1) < RATIO_EPSILON;
  const isPitchIdentity = Math.abs(semitones) < SEMITONE_EPSILON;

  // Identity → copy
  if (isStretchIdentity && isPitchIdentity) {
    onProgress?.(100);
    return {
      channels: channels.map((ch) => new Float32Array(ch)),
      sampleRate,
    };
  }

  // Reines Stretch (kein Pitch)
  if (isPitchIdentity) {
    const out: Float32Array[] = [];
    for (let c = 0; c < channels.length; c++) {
      out.push(timeStretchChannel(channels[c], ratio, c, channels.length, onProgress));
    }
    onProgress?.(100);
    return { channels: out, sampleRate };
  }

  // Pitch (mit oder ohne Stretch): stretch um effective, dann resample
  const semitoneRatio = semitonesToRatio(semitones);
  const effectiveStretch = clampRatio(ratio * semitoneRatio);

  const stretched: Float32Array[] = [];
  for (let c = 0; c < channels.length; c++) {
    if (Math.abs(effectiveStretch - 1) < RATIO_EPSILON) {
      stretched.push(new Float32Array(channels[c]));
    } else {
      stretched.push(
        timeStretchChannel(channels[c], effectiveStretch, c, channels.length, (p) => {
          // Stretch ist ~80% der Arbeit, Resample ~20%
          onProgress?.(Math.min(80, Math.floor(p * 0.8)));
        }),
      );
    }
  }

  const finalLength = Math.max(1, Math.round(channels[0].length * ratio));
  const out: Float32Array[] = [];
  for (let c = 0; c < stretched.length; c++) {
    if (stretched[c].length === finalLength) {
      out.push(stretched[c]);
    } else {
      out.push(resampleLinear(stretched[c], finalLength));
    }
    onProgress?.(80 + Math.floor(((c + 1) / stretched.length) * 19));
  }

  onProgress?.(100);
  return { channels: out, sampleRate };
}

// ─── Worker Message Protocol ────────────────────────────────────────────────

export interface TransformWorkerInboundMessage {
  cmd: "transform";
  requestId: string;
  channels: Float32Array[];
  sampleRate: number;
  ratio: number;
  semitones: number;
}

export type TransformWorkerOutboundMessage =
  | { type: "progress"; requestId: string; percent: number }
  | { type: "done"; requestId: string; channels: Float32Array[]; sampleRate: number }
  | { type: "error"; requestId: string; message: string };

/**
 * Handler-Funktion (exportiert für Tests). Verarbeitet eine eingehende
 * Message + ruft `post`-Callback für jede outbound Message.
 */
export function handleTransformMessage(
  msg: TransformWorkerInboundMessage,
  post: (out: TransformWorkerOutboundMessage, transfer?: ArrayBufferLike[]) => void,
): void {
  if (!msg || msg.cmd !== "transform") {
    post({
      type: "error",
      requestId: msg?.requestId ?? "unknown",
      message: "Invalid cmd",
    });
    return;
  }

  const { requestId, channels, sampleRate, ratio, semitones } = msg;

  try {
    const result = transformChannels(
      { channels, sampleRate, ratio, semitones },
      (percent) => {
        post({ type: "progress", requestId, percent });
      },
    );

    // Transferable: alle output-buffers zero-copy zurück
    const transfer: ArrayBufferLike[] = result.channels.map((c) => c.buffer);
    post(
      {
        type: "done",
        requestId,
        channels: result.channels,
        sampleRate: result.sampleRate,
      },
      transfer,
    );
  } catch (err) {
    post({
      type: "error",
      requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Worker Bootstrap ───────────────────────────────────────────────────────
// Top-level self-Listener nur im echten Worker-Context aktivieren.
// Wir vermeiden hard-coded `DedicatedWorkerGlobalScope`-Typ (in tsconfig
// 'dom'-lib enthalten, aber Worker-Context hat 'webworker'-lib). Mit
// loosem Typ via `unknown` umgehen wir den Conflict.

const workerScope: {
  postMessage?: (msg: unknown, transfer?: unknown[]) => void;
  addEventListener?: (type: string, listener: (event: MessageEvent) => void) => void;
} = (typeof self !== "undefined" ? (self as unknown as Record<string, unknown>) : {}) as {
  postMessage?: (msg: unknown, transfer?: unknown[]) => void;
  addEventListener?: (type: string, listener: (event: MessageEvent) => void) => void;
};

if (
  typeof workerScope.postMessage === "function" &&
  typeof workerScope.addEventListener === "function"
) {
  workerScope.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as TransformWorkerInboundMessage;
    handleTransformMessage(data, (out, transfer) => {
      if (transfer && transfer.length > 0) {
        workerScope.postMessage!(out, transfer as unknown[]);
      } else {
        workerScope.postMessage!(out);
      }
    });
  });
}
