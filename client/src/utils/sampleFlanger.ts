/**
 * Synthstudio – sampleFlanger.ts (v3.206.0)
 *
 * Pure-Helper fuer einen Flanger-Effekt via kurze modulierte Delay-Line
 * MIT Feedback-Loop (im Gegensatz zu Chorus v3.205, der kein Feedback hat).
 *
 * ─── Modell ─────────────────────────────────────────────────────────────────
 *
 * Pro Channel laeuft eine eigene Delay-Line, deren Lese-Position via LFO
 * (Sinus, bipolar) um eine Center-Delay moduliert wird.  Das Feedback wird
 * VOR dem Mix zurueck in den Delay-Buffer geschrieben — das erzeugt die
 * resonante Kamm-Filter-Charakteristik des Flangers.
 *
 *   t            = i / sampleRate                          // Zeit in s
 *   lfo          = sin(2*pi*rate*t)                        // [-1, 1] bipolar
 *   modDelayMs   = delayMs + lfo * depthMs                 // [delayMs-d, delayMs+d]
 *   delaySamples_t = max(1, modDelayMs * sampleRate/1000)  // safety clamp
 *   delayed      = linear-interp(delayBuffer, writeIdx - delaySamples_t)
 *   fbSample     = dry[i] + feedback * delayed             // INPUT inkl. Feedback
 *   delayBuffer[writeIdx] = fbSample                       // WRITE feedback-loop
 *   output[i]    = mix * delayed + (1 - mix) * dry[i]
 *
 * Wichtiger Unterschied zum Chorus: LFO ist BIPOLAR (sin direkt), nicht
 * (sin+1)/2-unipolar.  Die Spec-Formel `delayMs + sin(2π·rate·t) * depthMs`
 * ist eindeutig — modDelayMs liegt in [delayMs - depthMs, delayMs + depthMs].
 * Bei jet-Preset (depth=4, delay=3) kann modDelayMs also negativ werden;
 * `delaySamplesT < 1 → 1` faengt das ab.
 *
 * ─── LFO-Phase pro Channel ──────────────────────────────────────────────────
 *
 * SHARED LFO-Phase ueber alle Channels — analog Chorus.  Stereo-Sample mit
 * identischen Channels liefert identischen Output.  Pro-Channel-Delay-Buffer
 * und -Write-Index, aber gleicher LFO-State pro Sample-Index.
 *
 * ─── Defensive Defaults ─────────────────────────────────────────────────────
 *
 * - rateHz   NaN/non-finite -> 0.5,  <0.01 -> 0.5,  >10 -> 10
 * - depthMs  NaN/non-finite -> 2,    <0.1  -> 2,    >20 -> 20
 * - delayMs  NaN/non-finite -> 3,    <0.1  -> 3,    >20 -> 20
 * - feedback NaN/non-finite -> 0.5  (Projekt-Konvention NaN -> default,
 *                                    NICHT -0.95 wie Spec-Wortlaut),
 *            < -0.95 -> -0.95,  > 0.95 -> 0.95 (Stability-Cap)
 * - mix      NaN/non-finite -> 0.5,  <0 -> 0,  >1 -> 1
 *
 * Empty buffer -> empty output (numberOfChannels=0).  Input wird nie mutiert.
 * Output-Laenge == Input-Laenge.  Erste Samples (vor i = delaySamplesT) lesen
 * aus dem zero-prefilled Delay-Buffer.  Bei mix=1 also NICHT identitaet
 * zu dry[0].  Per Design (analog Chorus).
 *
 * ─── Finiteness ─────────────────────────────────────────────────────────────
 *
 * Feedback ist stability-capped auf |feedback| <= 0.95.  Damit bleibt die
 * Delay-Line-IIR stabil — Output ist garantiert finite, selbst bei einem
 * dauernden 1.0-Eingangs-Pegel.  Sanitizer fangen NaN/Inf-Optionen.
 * Sample-Werte werden nicht geclipped (Caller darf via sampleAutoNormalize
 * aufraeumen).
 *
 * Pure & DOM-frei.  Pattern angelehnt an sampleChorus.ts (v3.205), mit
 * Feedback-Loop + bipolarer LFO.
 */

import type { AudioBufferLike } from "./sampleEmbedding";

// ─── Konstanten ──────────────────────────────────────────────────────────────

const DEFAULT_RATE_HZ = 0.5;
const DEFAULT_DEPTH_MS = 2;
const DEFAULT_DELAY_MS = 3;
const DEFAULT_FEEDBACK = 0.5;
const DEFAULT_MIX = 0.5;

const MIN_RATE_HZ = 0.01;
const MAX_RATE_HZ = 10;
const MIN_DEPTH_MS = 0.1;
const MAX_DEPTH_MS = 20;
const MIN_DELAY_MS = 0.1;
const MAX_DELAY_MS = 20;
const MIN_FEEDBACK = -0.95;
const MAX_FEEDBACK = 0.95;

// ─── Public Types ────────────────────────────────────────────────────────────

export interface FlangerOptions {
  /** LFO-Rate in Hz (0.05..5 typ, 0.01..10 erlaubt). Default 0.5. */
  rateHz?: number;
  /** Modulations-Tiefe in ms (0.5..10 typ, 0.1..20 erlaubt). Default 2. */
  depthMs?: number;
  /** Center-Delay in ms (0.5..10 typ, 0.1..20 erlaubt). Default 3. */
  delayMs?: number;
  /** Feedback-Resonanz (-0.95..0.95). Default 0.5.
   *  Negative Werte ergeben inverted-comb-filter Charakteristik. */
  feedback?: number;
  /** Wet/Dry-Mix (0..1). Default 0.5. */
  mix?: number;
}

// ─── Helpers (intern) ────────────────────────────────────────────────────────

function sanitizeRate(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v < MIN_RATE_HZ) return DEFAULT_RATE_HZ;
  if (v > MAX_RATE_HZ) return MAX_RATE_HZ;
  return v;
}

function sanitizeDepth(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v < MIN_DEPTH_MS) return DEFAULT_DEPTH_MS;
  if (v > MAX_DEPTH_MS) return MAX_DEPTH_MS;
  return v;
}

function sanitizeDelayMs(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v < MIN_DELAY_MS) return DEFAULT_DELAY_MS;
  if (v > MAX_DELAY_MS) return MAX_DELAY_MS;
  return v;
}

function sanitizeFeedback(v: number | undefined): number {
  // NaN / non-finite / undefined -> default (Projekt-Konvention).
  // In-range invalid values clamp to MIN/MAX.
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_FEEDBACK;
  if (v < MIN_FEEDBACK) return MIN_FEEDBACK;
  if (v > MAX_FEEDBACK) return MAX_FEEDBACK;
  return v;
}

function sanitizeMix(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return DEFAULT_MIX;
  if (v < 0) return 0;
  if (v > 1) return 1;
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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Wendet einen Flanger-Effekt auf einen Sample-Buffer an.
 *
 * Algorithmus: pro Channel kurze modulierte Delay-Line (1..20 ms) MIT
 * Feedback-Loop fuer resonante Kamm-Filter-Charakteristik.  LFO-Phase
 * ist SHARED ueber Channels.  Linear-Interpolation fuer fractional delay
 * reads.
 *
 * Defensive: NaN / out-of-range Optionen fallen auf Defaults zurueck
 * oder werden geclamped (siehe Modul-JSDoc).  Empty buffer -> empty output.
 *
 * Liefert AudioBufferLike mit identischer Channel-Anzahl & Laenge wie input.
 */
export function applyFlanger(
  buffer: AudioBufferLike,
  opts: FlangerOptions = {},
): AudioBufferLike {
  const rateHz = sanitizeRate(opts.rateHz);
  const depthMs = sanitizeDepth(opts.depthMs);
  const delayMs = sanitizeDelayMs(opts.delayMs);
  const feedback = sanitizeFeedback(opts.feedback);
  const mix = sanitizeMix(opts.mix);

  // empty input -> empty output (Channel-Anzahl bleibt 0)
  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return {
      sampleRate: buffer?.sampleRate ?? 48000,
      numberOfChannels: 0,
      length: 0,
      getChannelData: () => new Float32Array(0),
    };
  }

  const sampleRate = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;

  // Delay-Buffer-Groesse: max read-window + Guard fuer linear-Interpolation.
  // Bipolare LFO -> max delayMs_t = delayMs + depthMs (NICHT depthMs/2).
  const maxDelayMs = delayMs + depthMs;
  const maxDelaySamples = Math.max(
    1,
    Math.ceil((maxDelayMs * sampleRate) / 1000) + 2,
  );

  const oneMinusMix = 1 - mix;
  const twoPiRate = 2 * Math.PI * rateHz;

  const outChannels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    const dry = buffer.getChannelData(c);
    const out = new Float32Array(len);
    const delayBuffer = new Float32Array(maxDelaySamples);

    // write-index in ring buffer (advances jeden Sample)
    let writeIdx = 0;

    for (let i = 0; i < len; i++) {
      const drySample = dry[i];

      // 1) Compute modulated read-position (bipolar LFO)
      const t = i / sampleRate;
      const lfoRaw = Math.sin(twoPiRate * t);              // [-1, 1]
      const modDelayMs = delayMs + lfoRaw * depthMs;       // [delayMs-d, delayMs+d]
      let delaySamplesT = (modDelayMs * sampleRate) / 1000;
      if (delaySamplesT < 1) delaySamplesT = 1;            // safety clamp

      // 2) READ from delay buffer at (writeIdx - delaySamplesT), linear-interp
      const readPos = writeIdx - delaySamplesT;
      let readFloor = Math.floor(readPos);
      const frac = readPos - readFloor;
      readFloor = ((readFloor % maxDelaySamples) + maxDelaySamples) % maxDelaySamples;
      const readNext = (readFloor + 1) % maxDelaySamples;
      const a = delayBuffer[readFloor];
      const b = delayBuffer[readNext];
      const delayed = a + (b - a) * frac;

      // 3) WRITE feedback-loop into delay buffer
      const fbSample = drySample + feedback * delayed;
      delayBuffer[writeIdx] = fbSample;

      // 4) Mix wet + dry
      out[i] = mix * delayed + oneMinusMix * drySample;

      // 5) Advance write-index
      writeIdx = (writeIdx + 1) % maxDelaySamples;
    }

    outChannels.push(out);
  }

  return wrapBuffer(outChannels, sampleRate);
}

/**
 * Vorgefertigte Flanger-Preset-Definitionen fuer UI-Dropdowns.
 *
 * - subtle:   dezent, leichte Resonanz
 * - classic:  Default-Flanger
 * - jet:      schnellere Sweeps, hoehere Resonanz, "jet-plane"-Effekt
 * - metallic: extreme Resonanz, klingt metallisch/koerperhaft
 */
export const FLANGER_PRESETS = {
  subtle: { rateHz: 0.3, depthMs: 1, feedback: 0.3, mix: 0.4 },
  classic: { rateHz: 0.5, depthMs: 2, feedback: 0.5, mix: 0.5 },
  jet: { rateHz: 1.0, depthMs: 4, feedback: 0.7, mix: 0.6 },
  metallic: { rateHz: 0.2, depthMs: 3, feedback: 0.85, mix: 0.7 },
} as const;
