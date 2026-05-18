/**
 * Synthstudio – synthOfflineRender.ts (TASK-241-FOLLOWUP-2 / v2.96.0)
 *
 * Offline-Synth-Note-Builder fuer Stem-Bounce.
 *
 * SoT (Source of Truth): `client/src/audio/SynthEngine.ts` — wir kopieren
 * den Oscillator-Build + ADSR-Hüllkurven-Logik 1:1, weil SynthEngine ein
 * AudioContext-Constructor-Singleton ist und nicht ohne grossen Refactor
 * vom OfflineAudioContext genutzt werden kann.
 *
 * Geltungsbereich v2.96:
 *   ✓ Subtractive  (sourceType === "wavetable", params.mode === "wavetable")
 *   ✓ Wavetable    (subtractive ist der Wavetable-Pfad in der Engine)
 *   ✓ FM           (sourceType === "wavetable"|"fm", params.mode === "fm")
 *   ✗ Granular     (sourceType === "granular") — siehe README am Datei-Ende
 *
 * Architektur:
 *   triggerOfflineSynthNote(ctx, params, freq, time, output)
 *     ├─ Erzeugt OscillatorNode(s) im Offline-Ctx
 *     ├─ Baut ADSR-GainNode (setValueAtTime + linearRampToValueAtTime)
 *     ├─ Connectet osc → ampEnv → output (typischerweise graph.input)
 *     └─ Returnt das ampEnv (caller kann es ignorieren)
 *
 * Defensive-Bounce:
 *   Wenn `params` undefined/inkonsistent ist (z.B. mode="wavetable" aber
 *   oscType=null), nutzen wir audible-safe Defaults aus DEFAULT_SYNTH_PARAMS.
 */

import type { SynthParams, OscillatorType, SynthMode } from "@/audio/SynthEngine";
import { DEFAULT_SYNTH_PARAMS } from "@/audio/SynthEngine";

/** Pure Helper — safeNum (lokale Kopie um keine Cross-Dep zu channelBounce zu ziehen). */
function safeNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Pure Helper — clamp. */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Konvertiert einen Step.pitch (Semitones) und eine Basis-Frequenz in die
 * effektive Note-Frequenz fuer Synth-Parts. Drums haben keine eigene Note,
 * deshalb nehmen wir A4=440 Hz als Basis und transponieren via Semitones.
 *
 * Identisch zur Online-Engine in AudioEngine._scheduleStep:
 *   `const freq = 440 * Math.pow(2, scheduled.pitch / 12);`
 */
export function pitchToFrequency(semitones: number, baseHz: number = 440): number {
  const safeSemi = safeNum(semitones, 0);
  return baseHz * Math.pow(2, safeSemi / 12);
}

/**
 * Validiert + befuellt SynthParams mit Defaults. Niemals undefined zurueck.
 * Defensive: bei wildem Input klingt der Sound vorhersagbar statt zu crashen.
 */
export function normalizeSynthParams(params: SynthParams | undefined | null): SynthParams {
  if (!params) return { ...DEFAULT_SYNTH_PARAMS };
  return {
    mode:        (params.mode === "fm" || params.mode === "wavetable") ? params.mode : DEFAULT_SYNTH_PARAMS.mode,
    oscType:     (params.oscType as OscillatorType) ?? DEFAULT_SYNTH_PARAMS.oscType,
    detune:      clamp(safeNum(params.detune, 0), -100, 100),
    fmRatio:     Math.max(0.1, safeNum(params.fmRatio, DEFAULT_SYNTH_PARAMS.fmRatio)),
    fmDepth:     Math.max(0, safeNum(params.fmDepth, DEFAULT_SYNTH_PARAMS.fmDepth)),
    attack:      Math.max(0.001, safeNum(params.attack, DEFAULT_SYNTH_PARAMS.attack)),
    decay:       Math.max(0.001, safeNum(params.decay, DEFAULT_SYNTH_PARAMS.decay)),
    sustain:     clamp(safeNum(params.sustain, DEFAULT_SYNTH_PARAMS.sustain), 0, 1),
    release:     Math.max(0.001, safeNum(params.release, DEFAULT_SYNTH_PARAMS.release)),
    lfoEnabled:  !!params.lfoEnabled,
    lfoRate:     Math.max(0.1, safeNum(params.lfoRate, DEFAULT_SYNTH_PARAMS.lfoRate)),
    lfoDepth:    Math.max(0, safeNum(params.lfoDepth, DEFAULT_SYNTH_PARAMS.lfoDepth)),
    lfoTarget:   params.lfoTarget ?? DEFAULT_SYNTH_PARAMS.lfoTarget,
    lfoWaveform: params.lfoWaveform ?? DEFAULT_SYNTH_PARAMS.lfoWaveform,
    lfoBpmSync:  params.lfoBpmSync ?? DEFAULT_SYNTH_PARAMS.lfoBpmSync,
    glide:       Math.max(0, safeNum(params.glide, 0)),
  };
}

/**
 * Berechnet die effektive Note-Dauer fuer eine Synth-Note im Offline-Render.
 *
 * Online-SynthEngine.triggerNote() haelt die Note 1 Sekunde lang + Release-Tail.
 * Im Offline-Bounce nutzen wir dieselbe Heuristik, damit Sustain hoerbar wird.
 *
 * Wir kapseln das in eine eigene Funktion, damit Tests die Konstante 1.0 nicht
 * erraten muessen.
 */
export function computeNoteHoldSec(): number {
  return 1.0;
}

/** Result eines Synth-Note-Builds — Caller braucht im Normalfall nichts davon. */
export interface OfflineSynthNoteHandle {
  /** Der ADSR-Gain-Node — connected zu `output`. */
  ampEnv: GainNode;
  /** Note-Stop-Zeit (incl. Release). Caller kann sie fuer Tail-Berechnung nutzen. */
  releaseEnd: number;
}

/**
 * Triggert eine Synth-Note im OfflineAudioContext.
 *
 * Identische Topologie wie `SynthEngine.triggerNote`:
 *   ┌────────────┐
 *   │ Wavetable: │ osc(type) → ampEnv → output
 *   ├────────────┤
 *   │ FM:        │ modulator → modDepth → carrier.frequency
 *   │            │ carrier → ampEnv → output
 *   └────────────┘
 *
 * @param ctx      Offline- oder Online-BaseAudioContext (beide kompatibel).
 * @param params   SynthParams (wird normalisiert, undefined ist OK).
 * @param freq     Note-Frequenz in Hz (A4=440).
 * @param time     Start-Zeitpunkt in Sekunden (ctx-Zeit).
 * @param volume   Pre-Envelope-Gain (typisch velocity*partVol, geclampt 0..2).
 * @param output   Ziel-Node (z.B. graph.input aus channelBounce).
 * @param prevFreq Optional vorherige Frequenz fuer Glide.
 */
export function triggerOfflineSynthNote(
  ctx: BaseAudioContext,
  params: SynthParams | undefined | null,
  freq: number,
  time: number,
  volume: number,
  output: AudioNode,
  prevFreq?: number,
): OfflineSynthNoteHandle {
  const p = normalizeSynthParams(params);
  const now = time;
  const noteEnd = now + computeNoteHoldSec();
  const releaseEnd = noteEnd + Math.max(0.001, p.release) + 0.1;

  // ─── ADSR-Hüllkurve (SoT: SynthEngine.triggerNote) ──────────────────────
  const ampEnv = ctx.createGain();
  const peak = clamp(safeNum(volume, 1), 0, 2);
  ampEnv.gain.setValueAtTime(0, now);
  ampEnv.gain.linearRampToValueAtTime(peak, now + Math.max(0.001, p.attack));
  ampEnv.gain.linearRampToValueAtTime(
    peak * clamp(p.sustain, 0, 1),
    now + p.attack + Math.max(0.001, p.decay),
  );
  ampEnv.gain.setValueAtTime(peak * clamp(p.sustain, 0, 1), noteEnd);
  ampEnv.gain.linearRampToValueAtTime(0, releaseEnd);

  // ─── Oszillator-Netz erstellen ──────────────────────────────────────────
  if (p.mode === "fm") {
    _buildFmOscillator(ctx, p, freq, now, releaseEnd, ampEnv, prevFreq);
  } else {
    _buildWavetableOscillator(ctx, p, freq, now, releaseEnd, ampEnv, prevFreq);
  }

  ampEnv.connect(output);

  return { ampEnv, releaseEnd };
}

/**
 * SoT: SynthEngine._triggerWavetable.
 *
 * Erzeugt einen einzelnen Oscillator mit type/detune/glide. "custom" wird
 * auf "sine" abgebildet (Online-Engine macht dasselbe — Wavetable-Custom-
 * Tables wuerden hier eine `ctx.createPeriodicWave()`-API brauchen; das
 * ist in v2.96 noch nicht angedockt, weil die App keine User-defined-
 * Wavetables persistiert).
 */
function _buildWavetableOscillator(
  ctx: BaseAudioContext,
  params: SynthParams,
  freq: number,
  startTime: number,
  stopTime: number,
  ampEnv: GainNode,
  prevFreq?: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = params.oscType === "custom" ? "sine" : (params.oscType as OscillatorType);
  osc.detune.value = clamp(params.detune, -100, 100);

  // Glide / Portamento
  if (params.glide > 0 && prevFreq && Number.isFinite(prevFreq) && prevFreq !== freq) {
    osc.frequency.setValueAtTime(prevFreq, startTime);
    osc.frequency.linearRampToValueAtTime(freq, startTime + params.glide);
  } else {
    osc.frequency.setValueAtTime(freq, startTime);
  }

  osc.connect(ampEnv);
  try {
    osc.start(startTime);
    osc.stop(stopTime);
  } catch {
    // OfflineAudioContext-Implementationen koennen start/stop ein zweites Mal
    // nicht erlauben oder einen "already started"-Error werfen — defensive ok.
  }
}

/**
 * SoT: SynthEngine._triggerFm.
 *
 * Erzeugt 2 Oscillators: modulator -> modDepth(Gain) -> carrier.frequency.
 * Carrier traegt die Note-Frequenz, Modulator laeuft auf fmRatio * freq.
 */
function _buildFmOscillator(
  ctx: BaseAudioContext,
  params: SynthParams,
  freq: number,
  startTime: number,
  stopTime: number,
  ampEnv: GainNode,
  prevFreq?: number,
): void {
  const carrier = ctx.createOscillator();
  carrier.type = "sine";

  // Glide auf Carrier (Modulator folgt frequency-mod nur ueber Ratio, nicht
  // ueber Glide — identisch zur Online-Engine).
  if (params.glide > 0 && prevFreq && Number.isFinite(prevFreq) && prevFreq !== freq) {
    carrier.frequency.setValueAtTime(prevFreq, startTime);
    carrier.frequency.linearRampToValueAtTime(freq, startTime + params.glide);
  } else {
    carrier.frequency.setValueAtTime(freq, startTime);
  }

  const modulator = ctx.createOscillator();
  modulator.frequency.value = freq * Math.max(0.1, params.fmRatio);
  modulator.type = "sine";

  const modDepth = ctx.createGain();
  modDepth.gain.value = Math.max(0, params.fmDepth);

  modulator.connect(modDepth);
  modDepth.connect(carrier.frequency);

  carrier.connect(ampEnv);

  try {
    modulator.start(startTime);
    carrier.start(startTime);
    modulator.stop(stopTime);
    carrier.stop(stopTime);
  } catch {
    // defensive — siehe Wavetable.
  }
}

/**
 * Erkennt ob ein Part als Synth (statt Sample) gerendert werden soll.
 *
 * Identisch zur Online-Logik in AudioEngine._scheduleStep:
 *   isSynthPart = !!part.synthParams && (sourceType === "wavetable" || "fm")
 */
export function isSynthPart(part: {
  sourceType?: "sample" | "wavetable" | "fm" | "granular";
  synthParams?: SynthParams;
}): boolean {
  if (!part.synthParams) return false;
  return part.sourceType === "wavetable" || part.sourceType === "fm";
}

/**
 * Erkennt Granular-Parts. Diese werden in v2.96 explizit als silent gebounced
 * — siehe Caveat-Block am Ende.
 */
export function isGranularPart(part: { sourceType?: string }): boolean {
  return part.sourceType === "granular";
}

/*
 * ─── README ──────────────────────────────────────────────────────────────────
 *
 * v2.96 — Was IM Bounce ist (Synth-Pfad):
 *  ✓ Subtractive / Wavetable (sourceType="wavetable", mode="wavetable"):
 *    OscillatorNode mit type sine/sawtooth/square/triangle + detune + glide.
 *  ✓ FM (mode="fm"): 2-Oscillator-Patch carrier+modulator mit fmRatio/fmDepth.
 *  ✓ ADSR (attack/decay/sustain/release) per linearRampToValueAtTime.
 *  ✓ Step.pitch → Note-Frequenz (Semi-Transpose von A4=440).
 *  ✓ Step.velocity * part.volume → Pre-Envelope-Gain.
 *  ✓ Defensive Defaults bei missing/NaN params.
 *  ✓ Connectet sich auf das Insert-FX-Chain-Input des channelBounce-Graphen,
 *    d.h. EQ/Filter/Distortion/Comp/Delay/Reverb (alles aus v2.95) wirkt
 *    auch auf Synth-Parts.
 *
 * Was NICHT im Bounce ist (Scope v2.97+):
 *  ✗ Granular (sourceType="granular"):
 *    GranularEngine nutzt requestAnimationFrame + lookahead-Scheduling.
 *    Beides ist im OfflineAudioContext unmoeglich (kein RAF, ctx.currentTime
 *    steht still bis startRendering aufgerufen wird). Ein Offline-Port wuerde
 *    einen separaten "Plan-then-render"-Algorithmus brauchen, der alle Grains
 *    der gesamten Bounce-Dauer im Voraus berechnet. Out-of-scope.
 *    → FOLLOWUP-2-GRANULAR.
 *  ✗ LFO-Modulation (lfoEnabled, lfoTarget, lfoRate, lfoDepth):
 *    Wir koennten OscillatorNodes connecten — aber die SynthEngine-Online-
 *    Pfad-Behavior weicht durch _attachLfo() ab (S&H nutzt setValueAtTime-
 *    Loops, das ist im Offline-Ctx exakt reproduzierbar aber noch ungetestet).
 *    Out-of-scope fuer v2.96 — der Bounce klingt ohne LFO etwas trockener,
 *    aber nicht silent.
 *    → FOLLOWUP-3-SYNTHLFO.
 *  ✗ Custom-Wavetables (oscType="custom"):
 *    SynthEngine mapped das aktuell auf "sine" — wir tun dasselbe.
 *    Sobald die App User-PeriodicWaves persistiert (heute nicht), muessen
 *    wir createPeriodicWave aufrufen. → FOLLOWUP-4-CUSTOM-WAVE.
 *  ✗ Per-Part-Macro-LFO-Cache (SynthEngine._partLfoCache):
 *    Macros werden zur Online-Zeit dynamisch ueberlagert. Im Offline-Bounce
 *    wird der STATISCHE Snapshot der params verwendet — was sinnvoller ist
 *    als die letzte Macro-Position zu erraten. Macros bleiben Live-FX.
 *
 * Architektur-Entscheidung — Copy statt Shared-Modul:
 *   Identisch zur v2.95-Begruendung in channelBounce.ts. SynthEngine ist eine
 *   Klasse mit ctx-Constructor-Coupling und stateful _partLfoCache. Saubere
 *   Extraction wuerde ein neues shared/synthGraph.ts mit reinen Builder-
 *   Funktionen brauchen + Migration aller call-sites. Die Logik ist ~30 LoC
 *   und stabil seit v1.x; Test-Coverage garantiert die Paritaet.
 *   → FOLLOWUP-242-EXTRACT-SYNTHGRAPH.
 */
