/**
 * Synthstudio – sampleConvolutionReverb.ts (v3.185.0)
 *
 * Pure-Helper fuer simple direct Convolution-Reverb (FFT-frei).  Faltet ein
 * "dry" Audio-Sample mit einer Impulse-Response (IR) und mischt das Resultat
 * mit dem Original (Wet/Dry-Mix).
 *
 * ─── Warum direct convolution (kein FFT)? ────────────────────────────────────
 *
 * FFT-Convolution waere O((n+m) log(n+m)) vs. direct O(n*m).  Fuer kurze IRs
 * (typischerweise < 12000 Samples ≈ 250ms @ 48k) ist direct schneller im
 * Setup + braucht keine Bibliothek + ist trivial pure-testbar.  Sobald wir
 * IR-Pakete mit > 1s laden wollen (Cathedral, Concert-Hall-Convolution-Files
 * aus dem Web), MUSS auf overlap-save/FFT umgestellt werden.
 *
 * ─── Foundation fuer Preset-IRs (v3.186+) ────────────────────────────────────
 *
 * generateSyntheticIR liefert eine procedural-generierte IR (exponential decay
 * gewichteter White-Noise).  REVERB_PRESETS gibt UI-Dropdown-Eintraege fuer
 * 4 Klassiker (Small Room, Concert Hall, Cathedral, Plate).  Echte gemessene
 * IRs koennten via Audio-File-Import als AudioBufferLike eingespeist werden.
 *
 * Pure & DOM-frei.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Default Wet/Dry mix. */
const DEFAULT_WET = 0.5;

/** Default Output-Gain (Normalisierung). */
const DEFAULT_OUTPUT_GAIN = 0.8;

/** Default Decay-Exponent fuer generateSyntheticIR. */
const DEFAULT_IR_DECAY = 4.0;

/** Fallback-Dauer (ms) wenn durationMs <= 0 / NaN. */
const FALLBACK_IR_DURATION_MS = 100;

/** Pre-Delay in Sekunden (Sample 0..3ms Silence am Anfang einer IR). */
const IR_PRE_DELAY_SEC = 0.003;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface ReverbOptions {
  /** Wet/Dry mix 0..1. Default 0.5. */
  wet?: number;
  /** Output-Gain (Normalisierung). Default 0.8. */
  outputGain?: number;
}

// ─── Helpers (intern) ────────────────────────────────────────────────────────

/** Downmix einen Multi-Channel-Buffer zu einem einzigen Float32Array (mono). */
function downmixToMono(buffer: AudioBufferLike): Float32Array {
  const len = buffer.length;
  const ch = buffer.numberOfChannels;
  if (len === 0 || ch === 0) return new Float32Array(0);
  if (ch === 1) {
    // Kopie damit Caller-Buffer unveraendert bleibt.
    return new Float32Array(buffer.getChannelData(0));
  }
  const out = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const src = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += src[i];
  }
  const inv = 1 / ch;
  for (let i = 0; i < len; i++) out[i] *= inv;
  return out;
}

/** Wrappt ein Float32Array als mono AudioBufferLike. */
function wrapMonoBuffer(data: Float32Array, sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: data.length === 0 ? 0 : 1,
    length: data.length,
    getChannelData: (channel: number) => {
      if (channel !== 0) {
        throw new RangeError(`getChannelData: index ${channel} out of range`);
      }
      return data;
    },
  };
}

/** sanitize wet 0..1 — NaN / out-of-range → fallback. */
function sanitizeWet(w: number | undefined): number {
  if (w === undefined || !Number.isFinite(w)) return DEFAULT_WET;
  if (w < 0) return 0;
  if (w > 1) return 1;
  return w;
}

/** sanitize outputGain — NaN → 0.8, negative → 0. */
function sanitizeOutputGain(g: number | undefined): number {
  if (g === undefined || !Number.isFinite(g)) return DEFAULT_OUTPUT_GAIN;
  if (g < 0) return 0;
  return g;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet Convolution-Reverb an. Sample (dry) wird mit IR (impulse response)
 * gefaltet.  Direct convolution (O(n*m)) — fuer IRs <= ~12000 samples (250ms
 * @ 48k) machbar.
 *
 * Output-Length = dry.length (IR-Tail wird abgeschnitten — caller, der den
 * vollen Tail will, soll dry um die IR-Laenge mit Zeros padden).
 *
 * Convolution-Formel:
 *   wet_out[n] = sum_{k=0..min(IR.length-1, n)} dry[n-k] * IR[k]
 * Anschliessend Mix:
 *   output[n] = dry[n] * (1 - wet) + wet_out[n] * wet * outputGain
 *
 * Liefert mono AudioBufferLike, sampleRate = dry.sampleRate.
 */
export function applyConvolutionReverb(
  dry: AudioBufferLike,
  impulseResponse: AudioBufferLike,
  options: ReverbOptions = {},
): AudioBufferLike {
  const wet = sanitizeWet(options.wet);
  const outputGain = sanitizeOutputGain(options.outputGain);

  // empty dry → empty out
  if (!dry || dry.length === 0 || dry.numberOfChannels === 0) {
    return wrapMonoBuffer(new Float32Array(0), dry?.sampleRate ?? 48000);
  }

  const dryMono = downmixToMono(dry);
  const len = dryMono.length;

  // empty IR → identical copy of dry (mono)
  if (
    !impulseResponse ||
    impulseResponse.length === 0 ||
    impulseResponse.numberOfChannels === 0
  ) {
    return wrapMonoBuffer(dryMono, dry.sampleRate);
  }

  const irMono = downmixToMono(impulseResponse);
  const irLen = irMono.length;
  const out = new Float32Array(len);

  // Direct convolution. Inner loop laeuft nur ueber gueltige k Werte
  // (k <= n && k < irLen), spart die n-k>=0 Pruefung pro Iteration.
  const oneMinusWet = 1 - wet;
  const wetGain = wet * outputGain;
  for (let n = 0; n < len; n++) {
    let sum = 0;
    const kMax = n < irLen - 1 ? n : irLen - 1;
    for (let k = 0; k <= kMax; k++) {
      sum += dryMono[n - k] * irMono[k];
    }
    out[n] = dryMono[n] * oneMinusWet + sum * wetGain;
  }

  return wrapMonoBuffer(out, dry.sampleRate);
}

/**
 * Generiert eine synthetische Impulse-Response (exponential-decay weighted
 * white noise).  Foundation fuer kuenftige preset-IRs / UI-Dropdown.
 *
 * Formel pro Sample i:
 *   t = i / durationSamples
 *   amp = exp(-decay * t)  // exponential decay 1.0 → exp(-decay)
 *   IR[i] = (random in [-1, 1]) * amp
 *
 * Erste ~3ms = Silence (pre-delay).
 *
 * Defensive:
 *   - durationMs <= 0 / NaN → 100ms
 *   - sampleRate <= 0 / NaN → 48000
 *   - decay NaN → DEFAULT_IR_DECAY (4.0)
 *
 * Deterministisch ist die IR NICHT (Math.random) — Tests pruefen daher nur
 * Laenge + Endpunkt-Energy, nicht exakte Sample-Werte.
 */
export function generateSyntheticIR(
  durationMs: number,
  sampleRate: number,
  decay: number = DEFAULT_IR_DECAY,
): AudioBufferLike {
  const ms =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : FALLBACK_IR_DURATION_MS;
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
  const decayFactor = Number.isFinite(decay) ? decay : DEFAULT_IR_DECAY;

  const durationSamples = Math.floor((ms / 1000) * sr);
  if (durationSamples === 0) {
    return wrapMonoBuffer(new Float32Array(0), sr);
  }

  const preDelaySamples = Math.min(
    durationSamples,
    Math.floor(IR_PRE_DELAY_SEC * sr),
  );
  const out = new Float32Array(durationSamples);
  for (let i = preDelaySamples; i < durationSamples; i++) {
    const t = i / durationSamples;
    const amp = Math.exp(-decayFactor * t);
    const noise = Math.random() * 2 - 1; // [-1, 1]
    out[i] = noise * amp;
  }
  return wrapMonoBuffer(out, sr);
}

/**
 * Vorgefertigte Preset-Definitionen fuer UI-Dropdowns.  Werden via
 * generateSyntheticIR(durationMs, sampleRate, decay) instanziiert.
 *
 * Werte empirisch gewaehlt — kuenftig durch gemessene IRs ersetzbar.
 */
export const REVERB_PRESETS = [
  { id: "room", name: "Small Room", durationMs: 100, decay: 6 },
  { id: "hall", name: "Concert Hall", durationMs: 300, decay: 3 },
  { id: "cathedral", name: "Cathedral", durationMs: 600, decay: 1.5 },
  { id: "plate", name: "Plate", durationMs: 200, decay: 5 },
] as const;
