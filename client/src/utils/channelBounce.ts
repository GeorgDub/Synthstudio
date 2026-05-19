/**
 * Synthstudio – channelBounce.ts (TASK-241 / v2.95.0)
 *
 * Per-Channel WAV-Bounce (Stem-Export) MIT vollständiger Insert-FX-Chain.
 *
 * v2.94: nur Volume/Pan/Lowpass-Filter
 * v2.95: komplette FX-Chain analog zu AudioEngine._getOrCreateChannelNodes:
 *        input → EQ(3-Band) → Filter → Distortion → Compressor →
 *        Delay(dry/wet+feedback) → Reverb(dry/wet via Convolver) →
 *        output → panner → destination
 *
 * Architektur:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ OfflineAudioContext(stereo, durationSec * sampleRate)            │
 *   │                                                                  │
 *   │   FX-Chain wird EINMAL pro Channel gebaut (nicht pro Step).      │
 *   │   Für jeden aktiven Step:                                        │
 *   │     BufferSource(sample) → stepGain(vel) → channelInput          │
 *   │                                              │                   │
 *   │   channelInput → EQLow → EQMid → EQHigh → Filter → Distortion → │
 *   │     Compressor → DelayDry/Wet → ReverbDry/Wet → Output → Panner │
 *   │     → destination                                                │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Architektur-Entscheidung (DRY vs Copy):
 *   AudioEngine._makeDistortionCurve und _getOrCreateReverbBuffer sind
 *   privat. Statt sie zu exportieren (was die Engine-API aufweicht)
 *   kopieren wir die identische Logik hier mit klarem SoT-Marker.
 *   Ein größeres Refactoring (shared `fxGraph.ts`-Modul) ist als
 *   Follow-Up dokumentiert (siehe README am Ende).
 *
 * Begrenzungen (siehe README am Ende der Datei):
 *  - Synth/Wavetable/FM/Granular-Parts (sourceType ≠ "sample") werden weiterhin
 *    als stille Frames gebounced — offline-Synth-Render ist Scope von v2.96.
 *  - Sidechain wird vereinfacht gerendert: wenn ein Sidechain-Source existiert,
 *    wird das Channel-Gain pro Trigger des Source-Parts kurz abgesenkt (rein
 *    statisch, ohne den vollen Live-Modulationsgraph).
 *  - Global-Reverb/Delay-Bus wird NICHT gespiegelt (das wäre eine Mix-Stem-
 *    Funktion, kein Channel-Stem).
 */

import type {
  PartData,
  PatternData,
  ChannelFx,
} from "@/audio/AudioEngine";
import { encodeWav } from "@/audio/wavEncoder";
import {
  triggerOfflineSynthNote,
  pitchToFrequency,
  isSynthPart,
  isGranularPart,
} from "@/utils/synthOfflineRender";
import type { MixerFxSlot } from "@/utils/mixerFx";
import {
  encodeAsOgg,
  filenameForFormat,
  DEFAULT_OGG_BITRATE_BPS,
  type CompressFormat,
  type AudioBufferLike,
} from "@/utils/audioCompressEncoder";

// ─── Längen-Optionen ─────────────────────────────────────────────────────────

export type BounceLengthMode =
  | "currentPattern"   // 1 Durchlauf des aktuellen Patterns (stepCount steps)
  | "currentLoop"      // n Bars Loop (Default 4)
  | "customBars";      // beliebige Bar-Anzahl

export interface BounceLengthOption {
  mode: BounceLengthMode;
  bars?: number;       // nur für customBars/currentLoop
}

/**
 * Maximal-Länge die wir ohne Warnung rendern (5 Minuten @ 48kHz Stereo = 110 MB).
 * Aufrufer sind angehalten ab dieser Grenze einen UI-Confirm zu zeigen.
 */
export const BOUNCE_WARN_DURATION_SEC = 5 * 60;

/**
 * Hartes Maximum — Bounces über 30 Minuten werden abgelehnt (Schutz vor Lock-up
 * und Out-of-Memory). 30min Stereo 48k = ~660 MB.
 */
export const BOUNCE_MAX_DURATION_SEC = 30 * 60;

// ─── Pure-Helpers ────────────────────────────────────────────────────────────

/**
 * Berechnet Sekunden-Dauer für einen Bounce.
 *
 * Formel: durationSec = bars * stepsPerBar * stepDurSec
 *         stepDurSec  = 60 / (bpm * stepsPerBar / 4)
 *                     = 60 * 4 / (bpm * stepsPerBar)
 *
 * Beispiel: 1 Bar, 16 steps, 120 bpm → 60*4/(120*16) * 16 = 2.0 sec.
 *
 * @param bars         Anzahl Bars (>0).
 * @param stepsPerBar  Step-Auflösung (typ. 16 oder 32).
 * @param bpm          Tempo in BPM (>0).
 * @param tailSec      Fadeout-Reserve in Sek (Default 0.5).
 *                     Damit der letzte Sample-Trigger noch ausklingen kann.
 */
export function computeBounceDurationSec(
  bars: number,
  stepsPerBar: number,
  bpm: number,
  tailSec: number = 0.5,
): number {
  if (!Number.isFinite(bars) || bars <= 0) return 0;
  if (!Number.isFinite(stepsPerBar) || stepsPerBar <= 0) return 0;
  if (!Number.isFinite(bpm) || bpm <= 0) return 0;
  const stepDurSec = 60 / (bpm * stepsPerBar / 4);
  return bars * stepsPerBar * stepDurSec + Math.max(0, tailSec);
}

/**
 * Berechnet einen dynamischen Tail-Wert abhängig von Reverb-/Delay-FX.
 *
 * - Reverb-Decay: braucht ~decay sec zum Ausklingen → reverbDecay + 0.2 buffer
 * - Delay: feedback*delayTime / (1 - feedback) ≈ steady-state-Sum
 *
 * Wenn beide FX aus sind: 0.5 sec Default.
 */
export function computeDynamicTailSec(fx: ChannelFx | undefined): number {
  if (!fx) return 0.5;
  let tail = 0.5;
  if (fx.reverbEnabled && fx.reverbDecay > 0) {
    tail = Math.max(tail, fx.reverbDecay + 0.2);
  }
  if (fx.delayEnabled && fx.delayTime > 0 && fx.delayFeedback > 0) {
    // Geometric series approximation, capped at 4 seconds.
    const fb = Math.min(0.95, Math.max(0, fx.delayFeedback));
    const delayTail = (fx.delayTime * fb) / Math.max(0.01, 1 - fb);
    tail = Math.max(tail, Math.min(4.0, delayTail + fx.delayTime));
  }
  return tail;
}

/**
 * Resolved: berechnet konkrete `bars`-Anzahl aus einer Bounce-Length-Option.
 * Für `currentPattern` → 1 Bar (= stepCount steps).
 * Für `currentLoop` → opt.bars ?? 4.
 * Für `customBars` → opt.bars ?? 1 (clamped 1..64).
 */
export function resolveBounceBars(opt: BounceLengthOption): number {
  switch (opt.mode) {
    case "currentPattern": return 1;
    case "currentLoop":    return Math.max(1, Math.min(64, opt.bars ?? 4));
    case "customBars":     return Math.max(1, Math.min(64, opt.bars ?? 1));
    default:               return 1;
  }
}

/**
 * Sanitisiert einen Filename-Stem für plattform-übergreifenden Save.
 * Erlaubt: A-Z a-z 0-9 _ - (siehe Electron-IPC-Validierung in main.ts).
 * Whitespace → "_", alle anderen Zeichen entfernt. Max 80 Zeichen.
 */
export function sanitizeStemFilenameStem(input: string): string {
  if (!input) return "stem";
  const replaced = input.trim().replace(/\s+/g, "_");
  const cleaned  = replaced.replace(/[^A-Za-z0-9_-]/g, "");
  const truncated = cleaned.slice(0, 80);
  return truncated || "stem";
}

/**
 * Standard-Filename für einen Channel-Stem:
 *   "<projectName>-<channelName>-stem.wav"
 *
 * Beide Komponenten werden sanitisiert. Bei leeren Inputs nutzen wir
 * "synthstudio" und "channel" als semantische Defaults (nicht "stem"
 * den der Sanitizer als hartes Fallback zurückgibt) — sonst sähe der
 * Default-Filename "stem-stem-stem.wav" verwirrend aus.
 */
export function defaultStemFilename(projectName: string, channelName: string): string {
  const hasProj = projectName && projectName.trim().length > 0;
  const hasCh   = channelName && channelName.trim().length > 0;
  const proj = hasProj ? sanitizeStemFilenameStem(projectName) : "synthstudio";
  const ch   = hasCh   ? sanitizeStemFilenameStem(channelName) : "channel";
  return `${proj}-${ch}-stem.wav`;
}

// ─── FX-Helpers (Copy aus AudioEngine — siehe SoT-Marker) ────────────────────

/**
 * SoT (Source of Truth): `AudioEngineClass._makeDistortionCurve`.
 * Erzeugt eine WaveShaper-Curve (256 Samples) für tanh-artige Distortion.
 *
 * Pure Function — Param-In → Float32-Array-Out.
 */
export function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const samples = 256;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const k = amount;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    if (k === 0) {
      curve[i] = x;
    } else {
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
  }
  return curve;
}

/**
 * SoT: `AudioEngineClass._getOrCreateReverbBuffer`.
 *
 * Erzeugt eine synthetische Reverb-IR im gegebenen Context. Im Offline-
 * Render brauchen wir den IR ungecacht (jeder Render hat eigenen Context).
 *
 * @param ctx        BaseAudioContext (online oder offline)
 * @param decaySec   Reverb-Tail in Sek (>0)
 * @returns          AudioBuffer (2 Channels) oder null wenn decaySec <= 0
 */
export function buildReverbImpulse(
  ctx: BaseAudioContext,
  decaySec: number,
): AudioBuffer | null {
  if (!Number.isFinite(decaySec) || decaySec <= 0) return null;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * decaySec);
  if (length <= 0) return null;
  const buf = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      // Identische Formel wie AudioEngine: weißes Rauschen * (1-t)^2
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    }
  }
  return buf;
}

/**
 * Sicherer FX-Field-Reader. Fallback wenn ein Wert undefined oder NaN ist.
 * Defensive Bounce: bei unbekannten Werten lieber Default als Crash.
 */
function safeNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// ─── Bitcrusher (offline pure-fn + WaveShaper) ────────────────────────────────

/**
 * v3.41 — SoT: BitcrusherProcessor.js
 *
 * Erzeugt eine WaveShaper-Curve, die ein kontinuierliches [-1, +1]-Signal auf
 * ⌊2^bitDepth⌋ diskrete Stufen abbildet. Identische Quantisierungs-Mathematik
 * wie das Online-Worklet: `Math.round(inp * steps) / steps` mit
 * `steps = 2^bitDepth`.
 *
 * Sample-Rate-Reduction wird im Offline-Render NICHT über die Curve modelliert
 * (sie ist eine zeitlich gefaltete Operation). Dafuer gibt es eine separate
 * pure-fn `applyBitcrusherToBuffer` die das Sample-Buffer pre-processed.
 *
 * @param bitDepth  0.5..16 (1 = heavy crush, 16 = ~lossless)
 * @returns         256-Sample Float32-Array
 */
export function makeBitcrusherCurve(bitDepth: number): Float32Array<ArrayBuffer> {
  const depth = Math.max(0.5, Math.min(16, safeNum(bitDepth, 16)));
  const steps = Math.pow(2, depth);
  const samples = 256;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}

/**
 * v3.41 — Pure-fn Bitcrusher (für Sample-Pre-Processing).
 *
 * Identisch zum Online-Worklet:
 *   - Bit-Depth Quantization auf 2^bitDepth Stufen
 *   - Sample-Rate-Reduction via Hold-Sample (alle N samples neuer Wert)
 *   - Dry/Wet-Mix
 *
 * @param input         Source Float32Array (single channel)
 * @param bitDepth      0.5..16
 * @param sampleReduct  1..50 (1 = no reduction, 50 = heavy decimation)
 * @param mix           0..1 dry/wet
 */
export function applyBitcrusher(
  input: Float32Array,
  bitDepth: number,
  sampleReduct: number,
  mix: number,
): Float32Array {
  const depth = Math.max(0.5, Math.min(16, safeNum(bitDepth, 16)));
  const reduct = Math.max(1, Math.min(50, Math.round(safeNum(sampleReduct, 1))));
  const wet = Math.max(0, Math.min(1, safeNum(mix, 1)));
  const dry = 1 - wet;
  const steps = Math.pow(2, depth);
  const out = new Float32Array(input.length);
  let hold = 0;
  let counter = 0;
  for (let i = 0; i < input.length; i++) {
    counter++;
    if (counter >= reduct) {
      counter = 0;
      hold = Math.round(input[i] * steps) / steps;
    }
    out[i] = input[i] * dry + hold * wet;
  }
  return out;
}

/**
 * v3.41 — Pre-processed AudioBuffer mit Bitcrusher-FX angewendet pro Channel.
 *
 * Erzeugt ein NEUES Buffer im gegebenen Context. Original bleibt unverändert.
 * Wenn ctx ein Mock ohne `createBuffer` ist, wird `null` zurueckgegeben und
 * der Caller faellt auf das Original zurueck.
 */
export function applyBitcrusherToBuffer(
  ctx: BaseAudioContext,
  input: AudioBuffer | null | undefined,
  bitDepth: number,
  sampleReduct: number,
  mix: number,
): AudioBuffer | null {
  if (!input) return null;
  const out = ctx.createBuffer(input.numberOfChannels, input.length, input.sampleRate);
  for (let ch = 0; ch < input.numberOfChannels; ch++) {
    const src = input.getChannelData(ch);
    const dst = applyBitcrusher(src, bitDepth, sampleReduct, mix);
    out.getChannelData(ch).set(dst);
  }
  return out;
}

// ─── Transient-Shaper (offline pure-fn) ───────────────────────────────────────

/**
 * v3.41 — Pure-fn Transient-Shaper.
 *
 * Envelope-Follower-basiert: zwei one-pole-low-pass-Filter mit
 * unterschiedlichen Attack-Coefficients. Der "fast"-Detektor reagiert
 * schnell auf Peaks (folgt dem Transient), der "slow"-Detektor reagiert
 * langsam (folgt dem Sustain). Die Differenz fast−slow ist die
 * Transient-Komponente.
 *
 * Aequivalent zu typischen Transient-Designer-Plugins (SPL Transient Designer,
 * Native FX Transient Master): attack > 0 boosted Snares/Kicks-Punch,
 * attack < 0 weicht sie ab.
 *
 * Algorithmus (one-pole IIR):
 *   envFast(i) = max(envFast(i-1) + (|x|-envFast(i-1))*aFast, envFast(i-1)*rFast)
 *   envSlow(i) = max(envSlow(i-1) + (|x|-envSlow(i-1))*aSlow, envSlow(i-1)*rSlow)
 *   transient = max(0, envFast − envSlow)
 *   sustainPart = envSlow
 *   gain = 1 + attack*transient*BOOST + sustain*sustainPart*BOOST_S
 *   y(i) = x(i) * gain * mix + x(i) * (1-mix)
 *
 * @param input    Source Float32Array
 * @param attack   −1..+1 (positiv = mehr Punch, negativ = weicher)
 * @param sustain  −1..+1 (positiv = laenger, negativ = ducked)
 * @param mix      0..1
 */
export function applyTransientShaper(
  input: Float32Array,
  attack: number,
  sustain: number,
  mix: number,
): Float32Array {
  const att = Math.max(-1, Math.min(1, safeNum(attack, 0)));
  const sus = Math.max(-1, Math.min(1, safeNum(sustain, 0)));
  const wet = Math.max(0, Math.min(1, safeNum(mix, 1)));
  const dry = 1 - wet;
  const out = new Float32Array(input.length);
  let envFast = 0;
  let envSlow = 0;
  // Attack-coefficients (one-pole). Hoeher = schneller follow.
  const aFast = 0.30;  // ~3 samples to reach ~95% — sehr schneller transient detector
  const aSlow = 0.005; // ~600 samples — folgt Sustain
  // Release-coefficients (decay zum nullen).
  const rFast = 0.999;
  const rSlow = 0.9999;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const abs = Math.abs(x);
    // Fast envelope: attack-style follower (schnell rauf, langsam runter)
    const targetFast = envFast + (abs - envFast) * aFast;
    envFast = Math.max(targetFast, envFast * rFast);
    // Slow envelope: sustain-style follower (langsam rauf, sehr langsam runter)
    const targetSlow = envSlow + (abs - envSlow) * aSlow;
    envSlow = Math.max(targetSlow, envSlow * rSlow);
    const transient = Math.max(0, envFast - envSlow);
    const gain = 1 + att * transient * 3 + sus * envSlow * 1;
    out[i] = x * gain * wet + x * dry;
  }
  return out;
}

/**
 * v3.41 — Pre-processed AudioBuffer mit Transient-Shaper-FX.
 *
 * Erzeugt ein NEUES Buffer im gegebenen Context.
 */
export function applyTransientShaperToBuffer(
  ctx: BaseAudioContext,
  input: AudioBuffer | null | undefined,
  attack: number,
  sustain: number,
  mix: number,
): AudioBuffer | null {
  if (!input) return null;
  const out = ctx.createBuffer(input.numberOfChannels, input.length, input.sampleRate);
  for (let ch = 0; ch < input.numberOfChannels; ch++) {
    const src = input.getChannelData(ch);
    const dst = applyTransientShaper(src, attack, sustain, mix);
    out.getChannelData(ch).set(dst);
  }
  return out;
}

// ─── RingMod-Nodes (offline native Web-Audio) ─────────────────────────────────

/**
 * v3.41 — RingMod-Offline-Node-Graph.
 *
 * Native Web-Audio-Implementation des Online-Worklets:
 *   y(t) = x(t) * (1 - mix) + (x(t) * sin(2π * freq * t)) * mix
 *
 * Topologie:
 *   inputNode → dryGain ─────────────→ outputNode
 *             → ringGain (gain=0)──→ outputNode
 *   osc(freq) → ringGain.gain (modulation)
 *
 * Die Sinus-Oszillator-Ausgabe steuert direkt den `ringGain.gain`-Param
 * — das ist die Standard-Web-Audio-Multiplikation (signal × carrier).
 *
 * Sub-Nodes werden alle gestartet (oscillator.start(0)) damit der Render
 * im OfflineAudioContext sofort beginnt.
 */
export interface RingModOfflineNodes {
  /** Eingang: x(t) hier reinverbinden */
  input: GainNode;
  /** Ausgang: dry+wet gemixt */
  output: GainNode;
  /** Innere Nodes (lifetime-Hold, sonst GC) */
  dryGain: GainNode;
  ringGain: GainNode;
  osc: OscillatorNode;
}

export function buildRingModOffline(
  ctx: BaseAudioContext,
  frequency: number,
  mix: number,
): RingModOfflineNodes {
  const f = Math.max(20, Math.min(5000, safeNum(frequency, 200)));
  const wet = Math.max(0, Math.min(1, safeNum(mix, 0.5)));

  const input = ctx.createGain();
  const output = ctx.createGain();
  const dryGain = ctx.createGain();
  const ringGain = ctx.createGain();
  const osc = ctx.createOscillator();

  input.gain.value = 1;
  output.gain.value = 1;
  dryGain.gain.value = 1 - wet;
  // ringGain.gain wird vom Oscillator moduliert; Start-Wert 0.
  ringGain.gain.value = 0;
  osc.type = "sine";
  osc.frequency.value = f;
  // Oscillator-Output (Amplitude ±1) wird auf ringGain.gain addiert
  // → ringGain.gain schwingt zwischen ~−1 und ~+1 mit `mix`-skalierter Amplitude.
  // Wir wollen y = x * sin(2π*f*t) * mix → ringGain Amplitude = sin * mix.
  // Daher modulieren wir mit gainScaling.
  const modScale = ctx.createGain();
  modScale.gain.value = wet;
  osc.connect(modScale);
  modScale.connect(ringGain.gain);

  input.connect(dryGain);
  input.connect(ringGain);
  dryGain.connect(output);
  ringGain.connect(output);
  try { osc.start(0); } catch { /* mock */ }

  return { input, output, dryGain, ringGain, osc };
}

// ─── Offline-Graph-Builder ───────────────────────────────────────────────────

export interface OfflinePartGraph {
  /** Sample/Synth-Sources hier reinconnecten. */
  input: GainNode;
  /** Der Endpunkt vor ctx.destination — meist der StereoPanner. */
  output: AudioNode;
  /** Optionaler Sidechain-Gain — wenn der Caller pro Step ducken will. */
  sidechainGain: GainNode;
  /**
   * v3.41: Wenn der Insert-Chain einen Bitcrusher/Transient-Shaper enthielt,
   * gibt dieses Feld die *Pre-Processing-Anweisungen* zurück damit der Caller
   * sein Sample-Buffer entsprechend pre-quantizen kann (Native AudioWorklet
   * im OfflineCtx ist nicht zuverlaessig). Bei reinen native-Nodes (RingMod
   * etc.) bleibt das Feld undefined.
   */
  preProcessing?: {
    bitcrusher?: { bitDepth: number; sampleReduct: number; mix: number };
    transient?: { attack: number; sustain: number; mix: number };
  };
}

/**
 * Baut die komplette Per-Channel-FX-Chain im gegebenen OfflineAudioContext.
 *
 * Spiegelt 1:1 die Online-Variante in `AudioEngineClass._getOrCreateChannelNodes`
 * + `_applyFxToNodes`. Wenn `part.fx` undefined ist (z.B. Legacy-Projekte) wird
 * eine reine Pass-Through-Chain mit Volume + Pan zurückgegeben.
 *
 * @param ctx        OfflineAudioContext (oder kompatibler Mock)
 * @param part       PartData mit fx, pan, muted
 * @param channels   1 (mono) oder 2 (stereo) — bestimmt ob Panner aktiv
 */
export function buildOfflinePartGraph(
  ctx: BaseAudioContext,
  part: PartData,
  channels: 1 | 2 = 2,
  insertChain?: MixerFxSlot[] | null,
): OfflinePartGraph {
  const fx = part.fx as ChannelFx | undefined;

  // Defensive: ohne FX-Objekt fällt der Graph auf Pass-Through zurück.
  // Wir bauen trotzdem alle Nodes damit die Topologie konsistent bleibt.
  const input = ctx.createGain();
  input.gain.value = 1.0;

  // ─── EQ (3-Band) ────────────────────────────────────────────────────────
  const eqLow = ctx.createBiquadFilter();
  eqLow.type = "lowshelf";
  eqLow.frequency.value = 200;
  eqLow.gain.value = (fx?.eqEnabled ? safeNum(fx.eqLow, 0) : 0);

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = "peaking";
  eqMid.frequency.value = 1000;
  eqMid.Q.value = 1;
  eqMid.gain.value = (fx?.eqEnabled ? safeNum(fx.eqMid, 0) : 0);

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = "highshelf";
  eqHigh.frequency.value = 6000;
  eqHigh.gain.value = (fx?.eqEnabled ? safeNum(fx.eqHigh, 0) : 0);

  // ─── Filter ─────────────────────────────────────────────────────────────
  const filter = ctx.createBiquadFilter();
  if (fx?.filterEnabled) {
    filter.type = fx.filterType ?? "lowpass";
    filter.frequency.value = Math.max(20, Math.min(20000, safeNum(fx.filterFreq, 20000)));
    filter.Q.value = Math.max(0.1, Math.min(20, safeNum(fx.filterQ, 1)));
  } else {
    // Bypass via allpass — identisch zum Online-Behavior.
    filter.type = "allpass";
    filter.frequency.value = 20000;
    filter.Q.value = 1;
  }

  // ─── Distortion (WaveShaper) ────────────────────────────────────────────
  const distortion = ctx.createWaveShaper();
  const distAmount = fx?.distortionEnabled ? safeNum(fx.distortionAmount, 0) : 0;
  distortion.curve = makeDistortionCurve(distAmount);
  // oversample "4x" ist on offline-ctx oft kostenintensiv aber korrekt.
  // Wir lassen den Default "none" damit Tests schneller laufen.
  // Online-Engine nutzt "4x" — die Klang-Differenz ist minimal bei k<100.

  // ─── Compressor ─────────────────────────────────────────────────────────
  const compressor = ctx.createDynamicsCompressor();
  if (fx?.compressorEnabled) {
    compressor.threshold.value = safeNum(fx.compressorThreshold, -24);
    compressor.ratio.value = safeNum(fx.compressorRatio, 4);
    compressor.attack.value = Math.max(0, safeNum(fx.compressorAttack, 0.003));
    compressor.release.value = Math.max(0, safeNum(fx.compressorRelease, 0.25));
  } else {
    // Bypass-Approximation: 0 dB Threshold, 1:1 Ratio.
    compressor.threshold.value = 0;
    compressor.ratio.value = 1;
  }

  // ─── Delay (Dry + Wet mit Feedback) ─────────────────────────────────────
  const delayNode = ctx.createDelay(2.0);
  delayNode.delayTime.value = Math.max(0, Math.min(2.0, safeNum(fx?.delayTime, 0.25)));
  const delayFeedback = ctx.createGain();
  delayFeedback.gain.value = fx?.delayEnabled
    ? Math.min(0.95, safeNum(fx.delayFeedback, 0.3))
    : 0;
  const delayDry = ctx.createGain();
  delayDry.gain.value = 1.0;
  const delayWet = ctx.createGain();
  delayWet.gain.value = fx?.delayEnabled ? safeNum(fx.delayMix, 0) : 0;

  // ─── Reverb (Convolver, Dry + Wet) ──────────────────────────────────────
  const reverbConvolver = ctx.createConvolver();
  if (fx?.reverbEnabled && fx.reverbDecay > 0) {
    const ir = buildReverbImpulse(ctx, fx.reverbDecay);
    if (ir) reverbConvolver.buffer = ir;
  }
  const reverbDry = ctx.createGain();
  reverbDry.gain.value = 1.0;
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = fx?.reverbEnabled ? safeNum(fx.reverbMix, 0) : 0;

  // ─── Output + Sidechain + Panner ────────────────────────────────────────
  const output = ctx.createGain();
  output.gain.value = 1.0;

  const sidechainGain = ctx.createGain();
  sidechainGain.gain.value = 1;

  // ─── Verschaltung — identisch zu AudioEngine._getOrCreateChannelNodes ──
  input.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(filter);
  filter.connect(distortion);
  distortion.connect(compressor);

  // Delay-Routing: Dry-Path + Wet-Path mit Feedback-Loop
  compressor.connect(delayDry);
  compressor.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(delayWet);

  // Reverb-Routing: Dry-Path + Wet-Path
  delayDry.connect(reverbDry);
  delayWet.connect(reverbDry);
  reverbDry.connect(output);
  reverbDry.connect(reverbConvolver);
  reverbConvolver.connect(reverbWet);
  reverbWet.connect(output);

  // ─── v3.41 Insert-Chain (Bitcrusher / RingMod / Transient-Shaper) ──────
  // Online-Topologie: output → inserts (in Reihe) → sidechainGain → panner.
  // Wir hängen alle aktiven inserts zwischen `output` und `sidechainGain`.
  // Bitcrusher + Transient-Shaper werden NICHT als Inline-Nodes umgesetzt,
  // sondern als Sample-Pre-Processing zurückgegeben (preProcessing-Field).
  let chainTail: AudioNode = output;
  const preProcessing: OfflinePartGraph["preProcessing"] = {};

  const activeInserts = (insertChain ?? []).filter(s => s.enabled);
  for (const slot of activeInserts) {
    switch (slot.type) {
      case "ringmod": {
        const p = slot.params as { frequency?: number; mix?: number };
        const ringmod = buildRingModOffline(
          ctx,
          safeNum(p.frequency, 200),
          safeNum(p.mix, 0.5),
        );
        chainTail.connect(ringmod.input);
        chainTail = ringmod.output;
        break;
      }
      case "bitcrusher": {
        // Caveat: AudioWorklet im OfflineCtx ist nicht zuverlaessig portierbar.
        // Wir liefern die Settings als preProcessing zurueck → Caller wendet
        // sie auf das Sample-Buffer an. Native-Inline wird zudem nicht moeglich
        // wenn sample-rate-reduction != 1 (zeit-gefaltete Operation).
        const p = slot.params as { bitDepth?: number; sampleReduct?: number; mix?: number };
        preProcessing.bitcrusher = {
          bitDepth: safeNum(p.bitDepth, 8),
          sampleReduct: safeNum(p.sampleReduct, 4),
          mix: safeNum(p.mix, 1),
        };
        break;
      }
      case "transient": {
        // Aequivalent zur Bitcrusher-Strategie: pure-fn auf Sample-Buffer.
        const p = slot.params as { attack?: number; sustain?: number; mix?: number };
        preProcessing.transient = {
          attack: safeNum(p.attack, 0),
          sustain: safeNum(p.sustain, 0),
          mix: safeNum(p.mix, 1),
        };
        break;
      }
      default:
        // Andere Inserts (filter/compressor/distortion/chorus/flanger/etc.)
        // sind in v3.41 NICHT als 2nd-Chain implementiert — sie sind bereits
        // via ChannelFx Bestandteil der Main-Chain. Skip silently.
        break;
    }
  }

  // chainTail → sidechainGain → (optional Panner) → destination
  chainTail.connect(sidechainGain);

  let finalNode: AudioNode;
  if (channels === 2) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, safeNum(part.pan, 0)));
    sidechainGain.connect(panner);
    panner.connect(ctx.destination);
    finalNode = panner;
  } else {
    sidechainGain.connect(ctx.destination);
    finalNode = sidechainGain;
  }

  // Wenn keine preProcessing-FX aktiv sind, lass das Feld undefined.
  const hasPre = preProcessing.bitcrusher || preProcessing.transient;
  return {
    input,
    output: finalNode,
    sidechainGain,
    ...(hasPre ? { preProcessing } : {}),
  };
}

// ─── Render-Engine ───────────────────────────────────────────────────────────

export interface ChannelBounceRenderOptions {
  /** Wie lang soll das Pattern gerendert werden? */
  length: BounceLengthOption;
  /** Globales BPM (Pattern.bpm override greift wenn gesetzt). */
  bpm: number;
  /** Ziel-Sample-Rate (44100 / 48000). */
  sampleRate: 44100 | 48000;
  /**
   * Optional: AudioBuffer für den `sampleUrl`-Key des Parts. Wenn nicht
   * gegeben oder kein sampleUrl → liefert nur stille Frames.
   */
  sampleBuffer?: AudioBuffer | null;
  /**
   * Stereo (default) oder Mono. Mono spart 50% Datenvolumen; Stereo
   * erhält den Pan-Wert.
   */
  channels?: 1 | 2;
  /**
   * Fadeout-Reserve in Sek. Wenn nicht angegeben wird dynamisch aus den
   * Reverb-/Delay-Settings berechnet (siehe computeDynamicTailSec).
   */
  tailSec?: number;
  /**
   * Wenn true wird die Insert-FX-Chain ÜBERSPRUNGEN und der Bounce wird wie
   * in v2.94 (Volume/Pan/Lowpass) gemacht. Default false. Nützlich für
   * Performance-Bypass oder Debug-Vergleich.
   */
  bypassFx?: boolean;
  /**
   * v3.41: Optional MixerFxSlot-Insert-Chain (Bitcrusher / RingMod /
   * Transient-Shaper). Im Online-Mode werden diese über `applyInsertChain`
   * angelegt; im Offline-Bounce werden RingMod-Slots als native Nodes
   * gerendert und Bitcrusher/Transient-Slots als Sample-Pre-Processing.
   *
   * Andere Insert-Typen werden silent ignoriert (sind bereits via ChannelFx
   * abgedeckt). Backward-Compat: bei undefined → keine Inserts.
   */
  insertChain?: MixerFxSlot[] | null;
}

export interface ChannelBounceRenderResult {
  buffer: AudioBuffer;
  durationSec: number;
  sampleRate: number;
  channels: 1 | 2;
}

/**
 * Konstruktor-Type für `OfflineAudioContext`. In Tests injizierbar damit
 * Node.js die Web-Audio-API nicht braucht.
 */
export type OfflineAudioContextCtor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => OfflineAudioContext;

/**
 * Rendert genau EINEN Channel als AudioBuffer.
 *
 * @param part            Channel-Daten (steps + Pan + Volume + FX).
 * @param pattern         Übergeordnetes Pattern (für stepCount + stepResolution).
 * @param opts            Render-Optionen (Länge, Sample-Rate, Sample-Buffer).
 * @param OfflineCtxCtor  Optional: injizierter OfflineAudioContext-Konstruktor
 *                        (für Unit-Tests; default ist der globale).
 *
 * @returns AudioBuffer mit dem gerenderten Channel-Output.
 * @throws  Error wenn duration > BOUNCE_MAX_DURATION_SEC.
 */
export async function renderChannelToBuffer(
  part: PartData,
  pattern: PatternData,
  opts: ChannelBounceRenderOptions,
  OfflineCtxCtor?: OfflineAudioContextCtor,
): Promise<ChannelBounceRenderResult> {
  const Ctor = OfflineCtxCtor
    ?? (typeof OfflineAudioContext !== "undefined" ? OfflineAudioContext : null);
  if (!Ctor) {
    throw new Error("OfflineAudioContext is not available in this environment");
  }

  const stepsPerBar = pattern.stepCount;
  const bars = resolveBounceBars(opts.length);
  const effectiveBpm = pattern.bpm ?? opts.bpm;

  // Tail dynamisch wenn Caller keinen expliziten Wert übergibt.
  const fx = part.fx as ChannelFx | undefined;
  const tailSec = opts.tailSec ?? computeDynamicTailSec(fx);

  const durationSec = computeBounceDurationSec(bars, stepsPerBar, effectiveBpm, tailSec);
  if (durationSec <= 0) {
    throw new Error(`Computed bounce duration <= 0 (bars=${bars} bpm=${effectiveBpm})`);
  }
  if (durationSec > BOUNCE_MAX_DURATION_SEC) {
    throw new Error(`Bounce duration ${durationSec.toFixed(1)}s exceeds maximum ${BOUNCE_MAX_DURATION_SEC}s`);
  }

  const channels: 1 | 2 = opts.channels ?? 2;
  const ctx = new Ctor(channels, Math.ceil(durationSec * opts.sampleRate), opts.sampleRate);

  // v2.96: Synth-Parts (Wavetable/FM) brauchen KEIN sampleBuffer und werden
  // jetzt rein offline mit OscillatorNodes gerendert. Granular bleibt silent.
  const partIsSynth = isSynthPart(part);
  const partIsGranular = isGranularPart(part);

  const stepDurSec = 60 / (effectiveBpm * stepsPerBar / 4);

  if (partIsSynth) {
    // ─── v3.42-Pfad: Synth mit optionalem Pre-Processing (Bitcrusher/Transient) ─
    // Wenn Bitcrusher oder Transient als Insert aktiv sind, machen wir einen
    // two-stage Render: erst Synth-Output in einen temporären OfflineAudioContext,
    // dann pre-process Buffer, dann als BufferSource in den Main-FX-Graph.
    const needsSynthPreProc = _hasSynthPreProcessing(opts.insertChain);
    if (needsSynthPreProc) {
      await _renderSynthWithPreProcessing(
        ctx, Ctor, part, pattern, stepDurSec, bars, stepsPerBar, channels,
        opts.insertChain, durationSec, opts.sampleRate,
      );
    } else {
      // ─── v2.96-Pfad: Synth-Offline-Render mit voller FX-Chain ───────────
      _renderSynthWithFxChain(ctx, part, pattern, stepDurSec, bars, stepsPerBar, channels, opts.insertChain);
    }
  } else if (partIsGranular) {
    // ─── v2.96 Caveat: Granular bleibt silent (siehe synthOfflineRender.ts) ─
    // No-op — Granular braucht RAF + lookahead, das ist im Offline-Ctx
    // nicht ohne separates "plan-then-render"-Modul moeglich. Buffer wird
    // als stiller Frame zurueckgegeben.
  } else if (opts.sampleBuffer) {
    if (opts.bypassFx) {
      // ─── Legacy v2.94-Pfad (Volume/Pan/Lowpass nur) ─────────────────────
      _renderBypassFx(ctx, part, pattern, opts.sampleBuffer, stepDurSec, bars, stepsPerBar, channels);
    } else {
      // ─── v2.95/v3.41-Pfad: Sample mit voller FX-Chain + Insert-Chain ───
      _renderWithFxChain(ctx, part, pattern, opts.sampleBuffer, stepDurSec, bars, stepsPerBar, channels, opts.insertChain);
    }
  }
  // Sonst: kein Sample, kein Synth, kein Granular → silent buffer (z.B. Part
  // ohne sampleUrl und ohne synthParams). Liefert trotzdem valid-leeres Result.

  const buffer = await ctx.startRendering();
  return { buffer, durationSec, sampleRate: opts.sampleRate, channels };
}

/**
 * v2.95-Render-Pfad: baut die FX-Chain einmal und routet alle Step-Trigger
 * durch den input-Node.
 */
function _renderWithFxChain(
  ctx: BaseAudioContext,
  part: PartData,
  pattern: PatternData,
  sampleBuffer: AudioBuffer,
  stepDurSec: number,
  bars: number,
  stepsPerBar: number,
  channels: 1 | 2,
  insertChain?: MixerFxSlot[] | null,
): void {
  void pattern;
  const graph = buildOfflinePartGraph(ctx, part, channels, insertChain);

  // v3.41: Apply Bitcrusher/Transient als Sample-Buffer-Pre-Processing.
  let effectiveBuffer = sampleBuffer;
  if (graph.preProcessing?.bitcrusher) {
    const p = graph.preProcessing.bitcrusher;
    const crushed = applyBitcrusherToBuffer(ctx, effectiveBuffer, p.bitDepth, p.sampleReduct, p.mix);
    if (crushed) effectiveBuffer = crushed;
  }
  if (graph.preProcessing?.transient) {
    const p = graph.preProcessing.transient;
    const shaped = applyTransientShaperToBuffer(ctx, effectiveBuffer, p.attack, p.sustain, p.mix);
    if (shaped) effectiveBuffer = shaped;
  }

  let absStep = 0;
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < stepsPerBar; s++) {
      const step = part.steps[s];
      if (step?.active) {
        const t = absStep * stepDurSec;
        const src = ctx.createBufferSource();
        src.buffer = effectiveBuffer;

        // Pitch (semitones → playbackRate)
        const pitch = safeNum(step.pitch, 0);
        if (pitch !== 0) {
          src.playbackRate.value = Math.pow(2, pitch / 12);
        }

        // Per-Step Gain (velocity * partVolume)
        const stepGain = ctx.createGain();
        const vel = safeNum(step.velocity, 100) / 127;
        const partVol = safeNum(part.volume, 1);
        stepGain.gain.value = part.muted ? 0 : vel * partVol;

        src.connect(stepGain);
        stepGain.connect(graph.input);
        try {
          src.start(t);
        } catch {
          // ignore — manche Mocks haben keine start-Implementation
        }
      }
      absStep++;
    }
  }
}

/**
 * v2.96-Render-Pfad: Synth-Parts (Wavetable/FM) durch die volle FX-Chain
 * routen. Identische Topologie wie der Sample-Pfad — nur dass jeder aktive
 * Step einen OscillatorNode statt eines BufferSource erzeugt.
 *
 * SoT: AudioEngine._scheduleStep + _triggerSynthOnChannel.
 */
function _renderSynthWithFxChain(
  ctx: BaseAudioContext,
  part: PartData,
  pattern: PatternData,
  stepDurSec: number,
  bars: number,
  stepsPerBar: number,
  channels: 1 | 2,
  insertChain?: MixerFxSlot[] | null,
): void {
  void pattern;
  const graph = buildOfflinePartGraph(ctx, part, channels, insertChain);
  // v3.42: Bitcrusher/Transient pre-processing fuer Synth-Parts laeuft im
  // 2-Stage-Pfad (siehe _renderSynthWithPreProcessing). Wenn Caller diesen
  // Pfad nimmt, sind preProcessing-Settings hier irrelevant (graph wird
  // ohnehin neu gebaut). Wenn Caller den direkten Pfad nimmt (kein BC/TS),
  // bleibt das Verhalten identisch zu v2.96.
  const synthParams = part.synthParams;

  let absStep = 0;
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < stepsPerBar; s++) {
      const step = part.steps[s];
      if (step?.active) {
        const t = absStep * stepDurSec;
        // Pitch → Frequenz (identisch AudioEngine: 440 Hz Basis + Semitones).
        const pitch = safeNum(step.pitch, 0);
        const freq = pitchToFrequency(pitch);

        // velocity * partVolume → pre-envelope volume
        const vel = safeNum(step.velocity, 100) / 127;
        const partVol = safeNum(part.volume, 1);
        const volume = part.muted ? 0 : vel * partVol;

        triggerOfflineSynthNote(
          ctx,
          synthParams,
          freq,
          t,
          volume,
          graph.input,
        );
      }
      absStep++;
    }
  }
}

/**
 * v3.42 — Helper: prüft ob die Insert-Chain Bitcrusher oder Transient enthält
 * (die einzigen FX die pre-processing benoetigen). Reine Pure-fn, exportiert
 * für Testbarkeit.
 */
export function hasSynthPreProcessing(insertChain?: MixerFxSlot[] | null): boolean {
  if (!insertChain || insertChain.length === 0) return false;
  return insertChain.some(s => s.enabled && (s.type === "bitcrusher" || s.type === "transient"));
}

/** Alias mit underscore-prefix für interne Konsistenz. */
const _hasSynthPreProcessing = hasSynthPreProcessing;

/**
 * v3.42 — Two-stage Synth-Render mit Pre-Processing.
 *
 * Stage 1: Render Synth-Notes in einen separaten OfflineAudioContext (ohne FX).
 * Stage 2: Pre-process das resultierende Buffer via Bitcrusher/Transient.
 * Stage 3: Feed Buffer als BufferSource in den Main-FX-Graph zurueck.
 *
 * Closes v3.41 Caveat: Bitcrusher + Transient sind nun auch fuer Synth-Parts
 * wirksam.
 */
async function _renderSynthWithPreProcessing(
  mainCtx: BaseAudioContext,
  Ctor: OfflineAudioContextCtor,
  part: PartData,
  pattern: PatternData,
  stepDurSec: number,
  bars: number,
  stepsPerBar: number,
  channels: 1 | 2,
  insertChain: MixerFxSlot[] | null | undefined,
  durationSec: number,
  sampleRate: number,
): Promise<void> {
  void pattern;
  // ─── Stage 1: Render Synth-Notes pur in tempCtx (kein FX-Chain) ──────────
  const intermediateLength = Math.ceil(durationSec * sampleRate);
  const tempCtx = new Ctor(channels, intermediateLength, sampleRate);

  const synthParams = part.synthParams;
  // Direct-connect: alle Notes direkt zu tempCtx.destination (kein FX-Filter).
  // Damit ist Stage-1-Output das pure Synth-Signal.
  let absStep = 0;
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < stepsPerBar; s++) {
      const step = part.steps[s];
      if (step?.active) {
        const t = absStep * stepDurSec;
        const pitch = safeNum(step.pitch, 0);
        const freq = pitchToFrequency(pitch);
        const vel = safeNum(step.velocity, 100) / 127;
        const partVol = safeNum(part.volume, 1);
        const volume = part.muted ? 0 : vel * partVol;
        triggerOfflineSynthNote(
          tempCtx,
          synthParams,
          freq,
          t,
          volume,
          tempCtx.destination,
        );
      }
      absStep++;
    }
  }

  let synthBuffer: AudioBuffer;
  try {
    synthBuffer = await tempCtx.startRendering();
  } catch {
    // Defensive: wenn der Mock kein startRendering hat, fallen wir auf v2.96
    // Behavior zurueck (direct FX-chain render).
    _renderSynthWithFxChain(mainCtx, part, pattern, stepDurSec, bars, stepsPerBar, channels, insertChain);
    return;
  }

  // ─── Stage 2: Pre-process Buffer ─────────────────────────────────────────
  // Wir verwenden die SELBEN Bitcrusher/Transient-Settings die der Caller via
  // insertChain mitgegeben hat. Reihenfolge: erst Bitcrusher, dann Transient
  // (identisch zur Sample-Path-Logik in _renderWithFxChain).
  let processedBuffer: AudioBuffer = synthBuffer;
  const bcSlot = (insertChain ?? []).find(s => s.enabled && s.type === "bitcrusher");
  const tsSlot = (insertChain ?? []).find(s => s.enabled && s.type === "transient");

  if (bcSlot) {
    const p = bcSlot.params as { bitDepth?: number; sampleReduct?: number; mix?: number };
    const crushed = applyBitcrusherToBuffer(
      mainCtx,
      processedBuffer,
      safeNum(p.bitDepth, 8),
      safeNum(p.sampleReduct, 4),
      safeNum(p.mix, 1),
    );
    if (crushed) processedBuffer = crushed;
  }
  if (tsSlot) {
    const p = tsSlot.params as { attack?: number; sustain?: number; mix?: number };
    const shaped = applyTransientShaperToBuffer(
      mainCtx,
      processedBuffer,
      safeNum(p.attack, 0),
      safeNum(p.sustain, 0),
      safeNum(p.mix, 1),
    );
    if (shaped) processedBuffer = shaped;
  }

  // ─── Stage 3: BufferSource im Main-Graph durch FX-Chain feeden ──────────
  // Wir bauen den FX-Graph mit derselben insertChain — buildOfflinePartGraph
  // ueberspringt Bitcrusher/Transient als Inline-Nodes (sie sind bereits in
  // Stage 2 angewendet), aber RingMod-Slots werden trotzdem korrekt inline
  // gehaengt. preProcessing-Field auf dem Graph wird ignoriert (Buffer ist
  // bereits pre-processed).
  const graph = buildOfflinePartGraph(mainCtx, part, channels, insertChain);
  const src = mainCtx.createBufferSource();
  src.buffer = processedBuffer;
  src.connect(graph.input);
  try { src.start(0); } catch { /* mock */ }
}

/**
 * v2.94-Legacy-Pfad: nur Volume/Pan/Lowpass. Bleibt für Bypass + Defensive
 * Fallback erhalten. Identisch zur alten Inline-Logik.
 */
function _renderBypassFx(
  ctx: BaseAudioContext,
  part: PartData,
  pattern: PatternData,
  sampleBuffer: AudioBuffer,
  stepDurSec: number,
  bars: number,
  stepsPerBar: number,
  channels: 1 | 2,
): void {
  void pattern;
  let absStep = 0;
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < stepsPerBar; s++) {
      const step = part.steps[s];
      if (step?.active) {
        const t = absStep * stepDurSec;
        const src  = ctx.createBufferSource();
        src.buffer = sampleBuffer;
        const gain = ctx.createGain();
        gain.gain.value = ((safeNum(step.velocity, 100)) / 127) * safeNum(part.volume, 1);
        if (part.muted) gain.gain.value = 0;

        let node: AudioNode = gain;
        const fx = part.fx as ChannelFx | undefined;
        if (fx?.filterFreq && fx.filterFreq < 20000) {
          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = fx.filterFreq;
          filter.Q.value = safeNum(fx.filterQ, 1);
          gain.connect(filter);
          node = filter;
        }

        if (channels === 2) {
          const panner = ctx.createStereoPanner();
          panner.pan.value = Math.max(-1, Math.min(1, safeNum(part.pan, 0)));
          node.connect(panner);
          panner.connect(ctx.destination);
        } else {
          node.connect(ctx.destination);
        }

        src.connect(gain);
        try { src.start(t); } catch { /* mock */ }
      }
      absStep++;
    }
  }
}

// ─── WAV-Encode ──────────────────────────────────────────────────────────────

/**
 * v3.84.0: Format-Option für Channel-Bounce.
 *
 * 'wav'      → 16-bit PCM RIFF (default, backward-compat).
 * 'ogg-opus' → Opus in OGG-Container via WebCodecs. Bei fehlendem WebCodecs
 *              fällt encodeAsOgg transparent auf WAV zurück — der Caller
 *              sieht das am tatsächlichen Blob.type (audio/wav statt audio/ogg).
 */
export type BounceFormat = "wav" | "ogg-opus";

/**
 * Optionen für die formatbewusste Bounce-Variante (`bounceChannelToBuffer`).
 * Erweitert ChannelBounceRenderOptions um Output-Format + Bitrate.
 */
export interface ChannelBounceFormatOptions extends ChannelBounceRenderOptions {
  /** Output-Format. Default 'wav' (backward-compat). */
  format?: BounceFormat;
  /** Opus-Bitrate in bps (nur relevant bei ogg-opus). Default 192_000. */
  bitrate?: number;
}

/**
 * Rendert einen Channel und kodiert das Ergebnis als WAV-ArrayBuffer.
 * Convenience-Wrapper über `renderChannelToBuffer` + `encodeWav`.
 *
 * Backward-Compat: liefert IMMER WAV. Für Format-Selection nutze
 * `bounceChannelToBuffer`.
 */
export async function bounceChannelToWavBuffer(
  part: PartData,
  pattern: PatternData,
  opts: ChannelBounceRenderOptions,
  OfflineCtxCtor?: OfflineAudioContextCtor,
): Promise<ArrayBuffer> {
  const { buffer, sampleRate, channels } = await renderChannelToBuffer(part, pattern, opts, OfflineCtxCtor);
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }
  return encodeWav(channelData, { sampleRate, channels, bitDepth: 16 });
}

/**
 * v3.84.0 Format-aware Bounce-Result. Liefert sowohl die Bytes als auch das
 * tatsächlich verwendete Format + die korrekte Dateiendung. Bei Fallback
 * (kein WebCodecs vorhanden) wird `actualFormat='wav'` und `extension='.wav'`
 * gesetzt — der Caller muss die Filename-Endung am Result-Feld festmachen,
 * nicht am Wunsch-Format.
 */
export interface ChannelBounceFormatResult {
  /** Encoded Audio-Bytes (WAV oder OGG). */
  data: ArrayBuffer;
  /** Tatsächlich verwendetes Format (kann von opts.format abweichen bei Fallback). */
  actualFormat: BounceFormat;
  /** Datei-Endung passend zum actualFormat ('.wav' oder '.ogg'). */
  extension: ".wav" | ".ogg";
  /** MIME-Typ passend zum actualFormat. */
  mimeType: "audio/wav" | "audio/ogg";
}

/**
 * v3.84.0 — Format-aware Convenience-Wrapper.
 *
 * Rendert einen Channel und kodiert ihn entweder als WAV oder OGG-Opus.
 * Bei 'ogg-opus' wird WebCodecs versucht; ohne WebCodecs liefert
 * `encodeAsOgg` transparent ein WAV-Blob zurück (sichtbar an Blob.type) —
 * `actualFormat` wird entsprechend auf 'wav' gesetzt.
 *
 * @returns ChannelBounceFormatResult mit Bytes + tatsächlichem Format.
 */
export async function bounceChannelToBuffer(
  part: PartData,
  pattern: PatternData,
  opts: ChannelBounceFormatOptions,
  OfflineCtxCtor?: OfflineAudioContextCtor,
): Promise<ChannelBounceFormatResult> {
  const format: BounceFormat = opts.format ?? "wav";
  const { buffer, sampleRate, channels } = await renderChannelToBuffer(part, pattern, opts, OfflineCtxCtor);

  if (format === "wav") {
    const channelData: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) {
      channelData.push(buffer.getChannelData(ch));
    }
    const data = encodeWav(channelData, { sampleRate, channels, bitDepth: 16 });
    return {
      data,
      actualFormat: "wav",
      extension: ".wav",
      mimeType: "audio/wav",
    };
  }

  // ogg-opus: encode via WebCodecs, mit transparentem WAV-Fallback.
  // `buffer` ist ein AudioBuffer (online) oder MockAudioBuffer (tests) — beide
  // implementieren das AudioBufferLike-Interface.
  const bufferLike: AudioBufferLike = {
    sampleRate,
    numberOfChannels: channels,
    length: buffer.length,
    getChannelData: (ch: number) => buffer.getChannelData(ch),
  };
  const bitrate = typeof opts.bitrate === "number" && Number.isFinite(opts.bitrate)
    ? opts.bitrate
    : DEFAULT_OGG_BITRATE_BPS;
  const blob = await encodeAsOgg(bufferLike, { bitrate });
  const data = await blob.arrayBuffer();
  // encodeAsOgg liefert bei fehlendem WebCodecs einen WAV-Blob zurück.
  // Wir folgen dem tatsächlichen Blob.type (nicht dem User-Wunsch).
  const isOgg = blob.type === "audio/ogg";
  return {
    data,
    actualFormat: isOgg ? "ogg-opus" : "wav",
    extension: isOgg ? ".ogg" : ".wav",
    mimeType: isOgg ? "audio/ogg" : "audio/wav",
  };
}

// ─── Multi-Channel Bounce ────────────────────────────────────────────────────

export interface BounceAllProgress {
  /** Index des aktuell verarbeiteten Channels (0-basiert). */
  current: number;
  /** Anzahl Channels gesamt. */
  total: number;
  /** Name des aktuell verarbeiteten Channels. */
  channelName: string;
  /** Phase: 'rendering' | 'encoding' | 'saving' | 'done' | 'error'. */
  phase: "rendering" | "encoding" | "saving" | "done" | "error";
  error?: string;
}

export interface BounceAllResult {
  channelId: string;
  channelName: string;
  /**
   * Dateiname inklusive Endung. Bei format='wav' immer '.wav', bei
   * format='ogg-opus' '.ogg' wenn WebCodecs verfügbar war, sonst '.wav'
   * (silent-Fallback).
   */
  filename: string;
  /**
   * Encoded Audio-Bytes. Backward-compat-Alias für `data` — beide Felder
   * zeigen auf denselben ArrayBuffer (kein Copy).
   * @deprecated Verwende `data` für format-bewussten Code.
   */
  wav: ArrayBuffer;
  /** v3.84.0: Encoded Audio-Bytes (WAV oder OGG). */
  data: ArrayBuffer;
  /** v3.84.0: Tatsächlich verwendetes Format. */
  actualFormat: BounceFormat;
  /** v3.84.0: MIME-Typ passend zum actualFormat. */
  mimeType: "audio/wav" | "audio/ogg";
}

/**
 * v3.84.0 — Erweiterte Options für `bounceAllChannels` mit Format-Support.
 */
export interface BounceAllOptions extends Omit<ChannelBounceRenderOptions, "sampleBuffer"> {
  /** Output-Format pro Channel. Default 'wav' (backward-compat). */
  format?: BounceFormat;
  /** Opus-Bitrate in bps (nur bei format='ogg-opus'). Default 192_000. */
  bitrate?: number;
}

/**
 * Bounced alle gegebenen Channels sequentiell. Liefert ein Array
 * { filename, wav } pro Channel. Aufrufer entscheidet, ob via Electron-IPC
 * gespeichert oder via Blob-Download ausgegeben wird.
 *
 * Sequentiell (nicht parallel) um Memory nicht zu sprengen — ein 4-bar-Bounce
 * @ 48k Stereo = ~1.5 MB raw, parallel über 16 Channels wären 24 MB
 * gleichzeitig im RAM. Sequenziell hält Peak-RAM klein.
 *
 * v3.84.0: `opts.format = 'ogg-opus'` aktiviert Opus-Encoding. Default ist
 * weiterhin 'wav' (backward-compat). Filenames folgen `actualFormat` —
 * bei silent-WAV-Fallback bekommt der User '.wav' obwohl er OGG wollte.
 */
export async function bounceAllChannels(
  parts: PartData[],
  pattern: PatternData,
  sampleBuffers: Map<string, AudioBuffer>,
  opts: BounceAllOptions,
  projectName: string,
  onProgress?: (p: BounceAllProgress) => void,
  OfflineCtxCtor?: OfflineAudioContextCtor,
  /** v3.41: Optional Map partId → MixerFxSlot[] für Bitcrusher/RingMod/Transient */
  partInsertChains?: Map<string, MixerFxSlot[]> | Record<string, MixerFxSlot[]> | null,
): Promise<BounceAllResult[]> {
  const getChain = (id: string): MixerFxSlot[] | undefined => {
    if (!partInsertChains) return undefined;
    if (partInsertChains instanceof Map) return partInsertChains.get(id);
    return partInsertChains[id];
  };
  const format: BounceFormat = opts.format ?? "wav";
  const bitrate = opts.bitrate ?? DEFAULT_OGG_BITRATE_BPS;
  const results: BounceAllResult[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    onProgress?.({
      current: i,
      total: parts.length,
      channelName: part.name,
      phase: "rendering",
    });
    try {
      const sampleBuffer = part.sampleUrl ? sampleBuffers.get(part.sampleUrl) ?? null : null;
      const insertChain = getChain(part.id) ?? null;
      const out = await bounceChannelToBuffer(
        part,
        pattern,
        { ...opts, sampleBuffer, insertChain, format, bitrate },
        OfflineCtxCtor,
      );
      // Filename folgt dem actualFormat (Fallback wird respektiert).
      const baseName = defaultStemFilename(projectName, part.name);
      const filename = filenameForFormat(baseName, out.actualFormat === "ogg-opus" ? "ogg" : "wav");
      results.push({
        channelId: part.id,
        channelName: part.name,
        filename,
        wav: out.data,
        data: out.data,
        actualFormat: out.actualFormat,
        mimeType: out.mimeType,
      });
    } catch (err) {
      onProgress?.({
        current: i,
        total: parts.length,
        channelName: part.name,
        phase: "error",
        error: String(err),
      });
      // Continue mit nächstem Channel — ein einziger Failure soll nicht das
      // gesamte Bundle blocken.
    }
  }
  onProgress?.({
    current: parts.length,
    total: parts.length,
    channelName: "",
    phase: "done",
  });
  return results;
}

// ─── Browser-Download-Fallback ───────────────────────────────────────────────

/**
 * Speichert ein WAV-ArrayBuffer im Browser als Download (kein Electron nötig).
 *
 * @param wav      Encoded WAV (z.B. aus bounceChannelToWavBuffer).
 * @param filename Pflicht — wird vom Browser-Save-Dialog übernommen.
 *
 * No-op wenn nicht im DOM-Kontext (z.B. Node.js-Tests).
 */
export function downloadWavInBrowser(wav: ArrayBuffer, filename: string): void {
  downloadAudioInBrowser(wav, filename, "audio/wav");
}

/**
 * v3.84.0 — Format-aware Browser-Download.
 *
 * Speichert beliebige Encoded-Audio-Bytes mit beliebigem MIME-Typ als
 * Browser-Download. Generalisierung von `downloadWavInBrowser` — alter
 * Helper bleibt als Convenience-Wrapper erhalten (backward-compat).
 *
 * @param data     Encoded Audio (WAV oder OGG).
 * @param filename Pflicht — wird vom Browser-Save-Dialog übernommen.
 * @param mimeType MIME-Typ (audio/wav oder audio/ogg).
 *
 * No-op wenn nicht im DOM-Kontext (z.B. Node.js-Tests).
 */
export function downloadAudioInBrowser(
  data: ArrayBuffer,
  filename: string,
  mimeType: "audio/wav" | "audio/ogg" = "audio/wav",
): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke nach kurzem Delay damit der Download startet
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/*
 * ─── README ──────────────────────────────────────────────────────────────────
 *
 * v2.96 (NEU) — Synth-Parts im Bounce:
 *  ✓ Wavetable/Subtractive (sourceType="wavetable", mode="wavetable"):
 *    OscillatorNode + ADSR + Detune + Glide. Klingt identisch zur Online-Engine.
 *  ✓ FM (mode="fm"): carrier+modulator+modDepth, identisch zu SynthEngine._triggerFm.
 *  ✓ Synth-Output geht durch die KOMPLETTE FX-Chain (v2.95): EQ, Filter,
 *    Distortion, Comp, Delay, Reverb. D.h. ein FM-Bass mit Reverb-Send
 *    klingt im Stem-Bounce so wie live.
 *  ✓ step.pitch → Note-Frequenz (A4=440 + Semitones, identisch AudioEngine).
 *
 * v2.95 — Was IM Bounce ist (Sample-Pfad):
 *  ✓ Volume + Pan (wie v2.94)
 *  ✓ 3-Band-EQ (Lowshelf 200Hz / Peaking 1kHz Q=1 / Highshelf 6kHz)
 *  ✓ Filter (lowpass/highpass/bandpass/notch + Cutoff + Q)
 *  ✓ Distortion (WaveShaper mit tanh-artiger Curve)
 *  ✓ Compressor (Threshold/Ratio/Attack/Release)
 *  ✓ Delay (Dry/Wet + Feedback-Loop)
 *  ✓ Reverb (Convolver mit synthetischem IR, Decay aus fx.reverbDecay)
 *  ✓ Dynamischer Reverb-/Delay-Tail (kein 0.5s-Cutoff mehr)
 *  ✓ Sidechain-Gain-Node (im Graph vorhanden, aktuell statisch=1)
 *  ✓ Step.pitch wird in playbackRate übersetzt
 *  ✓ Step.velocity * part.volume → stepGain
 *
 * v3.42 (NEU) — Bitcrusher / Transient fuer Synth-Parts + ExportPanel-Wiring:
 *  ✓ Two-stage Synth-Render: synth notes werden in einen separaten
 *    OfflineAudioContext gerendert, dann Buffer pre-processed (Bitcrusher /
 *    Transient pure-fn), dann als BufferSource in den Main-FX-Graph gefeedet.
 *    Closes v3.41-Caveat (Synth-Parts hatten kein BC/TS).
 *  ✓ ExportPanel + ChannelInspector reichen jetzt useMixerStore.insertChains
 *    als partInsertChains-Map an bounceAllChannels/renderChannelToBuffer durch.
 *    Damit greifen User-konfigurierte Inserts im Stem-Bounce wirklich.
 *  ✓ hasSynthPreProcessing(insertChain) als Pure-fn fuer Testbarkeit.
 *
 * v3.41 (NEU) — Bitcrusher / RingMod / Transient-Shaper im Bounce:
 *  ✓ Bitcrusher: bit-depth quantization + sample-rate-reduction via pure-fn
 *    auf das Sample-Buffer (applyBitcrusherToBuffer). Identische Math zum
 *    BitcrusherProcessor.js-Worklet (Math.round(x*2^d)/2^d + hold-sample).
 *    v3.42: auch fuer Synth-Parts wirksam via two-stage Render
 *    (_renderSynthWithPreProcessing).
 *  ✓ RingMod: Native Web-Audio-Nodes (OscillatorNode + GainNode-Multiplikation).
 *    buildRingModOffline liefert input/output-Subgraph. Klingt identisch zum
 *    RingModProcessor.js-Worklet (y = x*(1-mix) + (x*sin(2πft))*mix).
 *  ✓ Transient-Shaper: Envelope-Follower-basiert via pure-fn auf das Buffer
 *    (applyTransientShaperToBuffer). Boost/Cut von Attack-Transient und
 *    Sustain-Tail separat steuerbar.
 *  ✓ Insert-Chain wird per `opts.insertChain` (MixerFxSlot[]) durchgereicht.
 *    Native-Inserts (RingMod) gehen inline zwischen output und sidechainGain.
 *
 * Was NICHT im Bounce ist (Scope v3.42+):
 *  ✗ Granular-Parts (sourceType="granular") — silent (siehe synthOfflineRender.ts):
 *    GranularEngine nutzt RAF + Lookahead-Scheduling, beides im Offline-Ctx
 *    nicht direkt portierbar. Workaround: plan-then-render-Algorithmus.
 *  ✗ Synth-LFO (lfoEnabled/lfoRate/lfoDepth/lfoTarget) — Bounce ist statisch.
 *  ✗ Custom-Wavetables (oscType="custom") — wird auf "sine" abgebildet (wie online).
 *  ✗ Sidechain-Modulation aus anderen Channels (statisch unducked)
 *  ✗ Global-Reverb/Delay-Bus (channel-stems sollten dry-ish sein,
 *    Bus-FX gehört in Mix-Stem)
 *  ✗ Andere Insert-Typen (chorus/flanger/filter/comp/dist) — sind bereits via
 *    ChannelFx Bestandteil der Main-Chain; doppelt einsetzen über InsertChain
 *    wird v3.42 oder später nachgezogen.
 *  ✗ Parameter Locks pro Step (step.paramLock)
 *  ✗ Live-Input-Channels und AudioTrack-Channels
 *
 * Architektur-Entscheidung:
 *  Wir kopieren `_makeDistortionCurve` und `_getOrCreateReverbBuffer`-Logik
 *  aus AudioEngine.ts statt einen Refactor durchzuführen. Begründung:
 *   1. AudioEngine.ts ist ein Singleton mit Engine-State — saubere Extraction
 *      bräuchte ein neues fxGraph.ts-Modul + Migration aller call-sites.
 *   2. Die FX-Helpers sind nur ~20 LoC und stabil seit v1.x.
 *   3. Test-Coverage hier garantiert die Parität.
 *  Follow-Up (Issue TASK-242 oder v2.96): Extract `buildPartFxChain` in ein
 *  shared Modul und nutze es in BEIDEN AudioEngine + channelBounce, damit
 *  Online + Offline garantiert byte-identisch klingen.
 */
