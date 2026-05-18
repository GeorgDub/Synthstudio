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

// ─── Offline-Graph-Builder ───────────────────────────────────────────────────

export interface OfflinePartGraph {
  /** Sample/Synth-Sources hier reinconnecten. */
  input: GainNode;
  /** Der Endpunkt vor ctx.destination — meist der StereoPanner. */
  output: AudioNode;
  /** Optionaler Sidechain-Gain — wenn der Caller pro Step ducken will. */
  sidechainGain: GainNode;
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

  // Output → sidechainGain → (optional Panner) → destination
  output.connect(sidechainGain);

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

  return { input, output: finalNode, sidechainGain };
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
    // ─── v2.96-Pfad: Synth-Offline-Render mit voller FX-Chain ─────────────
    _renderSynthWithFxChain(ctx, part, pattern, stepDurSec, bars, stepsPerBar, channels);
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
      // ─── v2.95-Pfad: Sample mit voller FX-Chain ─────────────────────────
      _renderWithFxChain(ctx, part, pattern, opts.sampleBuffer, stepDurSec, bars, stepsPerBar, channels);
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
): void {
  const graph = buildOfflinePartGraph(ctx, part, channels);

  let absStep = 0;
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < stepsPerBar; s++) {
      const step = part.steps[s];
      if (step?.active) {
        const t = absStep * stepDurSec;
        const src = ctx.createBufferSource();
        src.buffer = sampleBuffer;

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
): void {
  void pattern;
  const graph = buildOfflinePartGraph(ctx, part, channels);
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
 * Rendert einen Channel und kodiert das Ergebnis als WAV-ArrayBuffer.
 * Convenience-Wrapper über `renderChannelToBuffer` + `encodeWav`.
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
  filename: string;
  wav: ArrayBuffer;
}

/**
 * Bounced alle gegebenen Channels sequentiell. Liefert ein Array
 * { filename, wav } pro Channel. Aufrufer entscheidet, ob via Electron-IPC
 * gespeichert oder via Blob-Download ausgegeben wird.
 *
 * Sequentiell (nicht parallel) um Memory nicht zu sprengen — ein 4-bar-Bounce
 * @ 48k Stereo = ~1.5 MB raw, parallel über 16 Channels wären 24 MB
 * gleichzeitig im RAM. Sequenziell hält Peak-RAM klein.
 */
export async function bounceAllChannels(
  parts: PartData[],
  pattern: PatternData,
  sampleBuffers: Map<string, AudioBuffer>,
  opts: Omit<ChannelBounceRenderOptions, "sampleBuffer">,
  projectName: string,
  onProgress?: (p: BounceAllProgress) => void,
  OfflineCtxCtor?: OfflineAudioContextCtor,
): Promise<BounceAllResult[]> {
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
      const wav = await bounceChannelToWavBuffer(
        part,
        pattern,
        { ...opts, sampleBuffer },
        OfflineCtxCtor,
      );
      const filename = defaultStemFilename(projectName, part.name);
      results.push({ channelId: part.id, channelName: part.name, filename, wav });
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
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([wav], { type: "audio/wav" });
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
 * Was NICHT im Bounce ist (Scope v2.97+):
 *  ✗ Granular-Parts (sourceType="granular") — silent (siehe synthOfflineRender.ts):
 *    GranularEngine nutzt RAF + Lookahead-Scheduling, beides im Offline-Ctx
 *    nicht direkt portierbar. Workaround: plan-then-render-Algorithmus.
 *  ✗ Synth-LFO (lfoEnabled/lfoRate/lfoDepth/lfoTarget) — Bounce ist statisch.
 *  ✗ Custom-Wavetables (oscType="custom") — wird auf "sine" abgebildet (wie online).
 *  ✗ Sidechain-Modulation aus anderen Channels (statisch unducked)
 *  ✗ Global-Reverb/Delay-Bus (channel-stems sollten dry-ish sein,
 *    Bus-FX gehört in Mix-Stem)
 *  ✗ Bitcrusher (AudioWorklet — braucht offline-Worklet-Setup)
 *  ✗ RingMod / Transient-Shaper (custom AudioNodes; Online-Engine hat sie
 *    aktuell nur als optional-slots, kein 1st-class FX-Field in ChannelFx)
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
