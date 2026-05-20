/**
 * Synthstudio - sampleVibrato.ts (v3.208.0)
 *
 * Pure-Helper fuer einen Vibrato-Effekt: Pitch-Modulation per LFO via
 * kurze, modulierte Delay-Line - KEIN FFT, KEIN Phase-Vocoder.
 *
 * --- Modell ---------------------------------------------------------------
 *
 * Vibrato = periodische Pitch-Modulation (im Gegensatz zu Tremolo, das nur
 * die Amplitude moduliert). Realisiert via modulated delay-line: durch
 * Oszillation der Read-Position relativ zur Write-Position wird der
 * Output instantan in der Frequenz verschoben (Doppler-Prinzip).
 *
 * Pro Channel laeuft eine eigene Delay-Line. Es gibt KEINEN Dry-Mix -
 * der Output ist 100% wet (klassisches Vibrato hat keinen separaten Wet/Dry,
 * im Gegensatz zu Chorus/Flanger).
 *
 *   t              = i / sampleRate
 *   lfo            = sin(2*pi*rate*t)                        // bipolar [-1, 1]
 *   baseDelay_smp  = BASE_DELAY_MS * sampleRate / 1000       // ~5ms center
 *   depthFactor    = (depthCents / 1200) * sampleRate * 0.01 // ms-scale heuristic
 *   delaySamples_t = baseDelay_smp + lfo * depthFactor       // safety-clamp >= 1
 *   delayed        = linear-interp(delayBuffer, writeIdx - delaySamples_t)
 *   delayBuffer[writeIdx] = dry[i]                           // WRITE current sample
 *   output[i]      = delayed
 *
 * Die Heuristik (depthCents/1200) * sr * 0.01 mapped 20 cents @ 48kHz auf
 * ~8 samples Delay-Modulation, was musikalisch sinnvoll ist. Rate-unabhaengig
 * (im Gegensatz zur physikalisch korrekten Formel, die depthSamples mit
 * 1/rate skalieren wuerde) - Buffer-Groesse bleibt vorhersagbar.
 *
 * --- LFO-Phase pro Channel ------------------------------------------------
 *
 * SHARED LFO-Phase ueber alle Channels - analog Chorus/Flanger/Tremolo.
 * Stereo-Sample mit identischen Channels liefert identischen Output.
 *
 * --- depthCents = 0 -------------------------------------------------------
 *
 * Bei depthCents=0 schaltet die Implementierung auf einen Short-Circuit-Pfad:
 * Output ist exakt eine Kopie des Inputs (identity).  Damit ist depthCents=0
 * deterministisch eine no-op statt "dry-delayed-um-baseDelay".
 *
 * --- Defensive Defaults ---------------------------------------------------
 *
 * - rateHz     NaN/non-finite/<=0 -> 5,    >50 -> 50
 * - depthCents NaN/non-finite/<0  -> 0 (-> identity), >200 -> 200
 *
 * (depthCents-NaN -> 0 folgt der Tremolo-Konvention: NaN -> identity, NICHT
 * Default-Wert. Damit ist depth=NaN deterministisch eine no-op statt halber
 * Effekt.)
 *
 * Empty buffer -> empty output (numberOfChannels=0). Input wird nie mutiert.
 * Output-Laenge == Input-Laenge.
 *
 * --- Finiteness -----------------------------------------------------------
 *
 * Kein Feedback-Loop - Delay-Line ist FIR-aehnlich (jeder Write erhaelt
 * den dry[i], es gibt keine Rueckkopplung). Solange dry finite ist, ist
 * Output garantiert finite. Sanitizer fangen NaN/Inf-Optionen.
 *
 * Pure & DOM-frei. Pattern angelehnt an sampleChorus.ts (v3.205), aber
 * ohne mix-Option, ohne Feedback, mit depthCents statt depthMs, und
 * depth=0 Short-Circuit auf identity.
 */
import type { AudioBufferLike } from "./sampleEmbedding";

// --- Konstanten -----------------------------------------------------------

const DEFAULT_RATE_HZ = 5;
const DEFAULT_DEPTH_CENTS = 20;
const MAX_RATE_HZ = 50;
const MAX_DEPTH_CENTS = 200;
/** Center-Delay in ms. Nicht als Option exponiert - fester DSP-Parameter. */
const BASE_DELAY_MS = 5;

// --- Public Types ---------------------------------------------------------

export interface VibratoOptions {
  /** LFO-Rate in Hz (0.1..20 typ, 0.1..50 erlaubt). Default 5. */
  rateHz?: number;
  /** Pitch-Modulations-Tiefe in Cents (0..100 typ, 0..200 erlaubt).
   *  Default 20. 0 -> identity. */
  depthCents?: number;
}

function sanitizeRate(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return DEFAULT_RATE_HZ;
  if (v > MAX_RATE_HZ) return MAX_RATE_HZ;
  return v;
}

function sanitizeDepth(v: number | undefined): number {
  if (v === undefined) return DEFAULT_DEPTH_CENTS;
  if (!Number.isFinite(v) || v < 0) return 0;
  if (v > MAX_DEPTH_CENTS) return MAX_DEPTH_CENTS;
  return v;
}

function wrapBuffer(channels: Float32Array[], sampleRate: number): AudioBufferLike {
  const ch = channels.length;
  const len = ch === 0 ? 0 : channels[0].length;
  return {
    sampleRate,
    numberOfChannels: ch,
    length: len,
    getChannelData: (channel: number) => {
      if (channel < 0 || channel >= ch) {
        throw new RangeError(`getChannelData: index ${channel} out of range`);
      }
      return channels[channel];
    },
  };
}

function emptyResult(sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 0,
    length: 0,
    getChannelData: () => new Float32Array(0),
  };
}

/**
 * Wendet einen Vibrato-Effekt (Pitch-Modulation via LFO) auf einen
 * Sample-Buffer an.
 *
 * Algorithmus: pro Channel kurze modulierte Delay-Line (~5ms Center) OHNE
 * Feedback und OHNE Dry-Mix (100% wet). Bipolarer Sinus-LFO oszilliert die
 * Read-Position; Frequenz-Shift entsteht via Doppler-Prinzip.
 *
 * depthCents=0 -> Short-Circuit auf identity (exakte Kopie des Inputs).
 *
 * Defensive: NaN / out-of-range Optionen fallen auf Defaults zurueck oder
 * werden geclamped (siehe Modul-JSDoc). Empty buffer -> empty output.
 *
 * Liefert AudioBufferLike mit identischer Channel-Anzahl & Laenge wie input.
 */
export function applyVibrato(
  buffer: AudioBufferLike,
  opts: VibratoOptions = {},
): AudioBufferLike {
  const rateHz = sanitizeRate(opts.rateHz);
  const depthCents = sanitizeDepth(opts.depthCents);

  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return emptyResult(buffer?.sampleRate ?? 48000);
  }

  const sampleRate = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;

  if (depthCents === 0) {
    const outCopy: Float32Array[] = [];
    for (let c = 0; c < numCh; c++) {
      const src = buffer.getChannelData(c);
      const dst = new Float32Array(len);
      dst.set(src);
      outCopy.push(dst);
    }
    return wrapBuffer(outCopy, sampleRate);
  }

  const baseDelaySamples = (BASE_DELAY_MS * sampleRate) / 1000;
  const depthFactor = (depthCents / 1200) * sampleRate * 0.01;

  const maxDelaySamples = Math.max(
    1,
    Math.ceil(baseDelaySamples + depthFactor) + 2,
  );

  const twoPiRate = 2 * Math.PI * rateHz;

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(len);
    const delayBuffer = new Float32Array(maxDelaySamples);

    let writeIdx = 0;

    for (let i = 0; i < len; i++) {
      const drySample = dry[i];

      delayBuffer[writeIdx] = drySample;

      const t = i / sampleRate;
      const lfo = Math.sin(twoPiRate * t);
      let delaySamplesT = baseDelaySamples + lfo * depthFactor;
      if (delaySamplesT < 1) delaySamplesT = 1;

      const readPos = writeIdx - delaySamplesT;
      let readFloor = Math.floor(readPos);
      const frac = readPos - readFloor;
      readFloor = ((readFloor % maxDelaySamples) + maxDelaySamples) % maxDelaySamples;
      const readNext = (readFloor + 1) % maxDelaySamples;
      const a = delayBuffer[readFloor];
      const b = delayBuffer[readNext];
      const delayed = a + (b - a) * frac;

      out[i] = delayed;

      writeIdx = (writeIdx + 1) % maxDelaySamples;
    }

    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}

/**
 * Vorgefertigte Vibrato-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - subtle:     dezent, 4Hz/10ct  - kaum wahrnehmbar, "warm"
 * - classic:    Default-Vibrato, 5Hz/20ct (= Spec-Defaults)
 * - expressive: sing-stimme-aehnlich, 6Hz/35ct
 * - warble:     extreme Modulation, 8Hz/60ct - Vintage-Synth-Vibe
 */
export const VIBRATO_PRESETS = {
  subtle: { rateHz: 4, depthCents: 10 },
  classic: { rateHz: 5, depthCents: 20 },
  expressive: { rateHz: 6, depthCents: 35 },
  warble: { rateHz: 8, depthCents: 60 },
} as const;
