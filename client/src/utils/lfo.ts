/**
 * Synthstudio – LFO math (TASK-257, Modulations-/LFO-Routing v1)
 *
 * Reine, deterministische LFO-Auswertung. KEINE Web-Audio-Abhängigkeit,
 * KEIN Lesen von `currentTime` o.ä. — `timeSec` wird übergeben, damit die
 * Funktionen in Node/Vitest ohne AudioContext testbar sind.
 *
 * Eine LFO erzeugt eine bipolare Schwingung in [-1, +1]. Eine Mod-Route
 * multipliziert das mit `amount` (-1..+1) und addiert es um den Basiswert
 * eines Ziel-Params (siehe applyBipolarMod). Frei laufend nach Wall-Clock
 * (Rate in Hz) — bewusst NICHT transport-synchronisiert in v1.
 */

export type LfoWaveform = "sine" | "triangle" | "square" | "saw";

export interface LfoShape {
  waveform: LfoWaveform;
  /** Frequenz in Hz. <= 0 → eingefroren (gibt Wert bei Phase-Offset zurück). */
  rateHz: number;
  /** Phasen-Offset in [0, 1) (0 = Start der Wellenform). */
  phase: number;
}

/**
 * Wickelt einen normalisierten Phasen-Wert sicher nach [0, 1).
 * Funktioniert für negative und sehr große Eingaben.
 */
export function wrapPhase01(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return ((p % 1) + 1) % 1;
}

/**
 * Wertet eine Wellenform bei normalisierter Phase t ∈ [0,1) aus.
 * Rückgabe bipolar in [-1, +1].
 *   sine     → sin(2πt)
 *   triangle → /\ Dreieck, Peak +1 bei t=0.25, -1 bei t=0.75
 *   square   → +1 für t<0.5, sonst -1
 *   saw      → aufsteigende Rampe von -1 (t=0) nach +1 (t→1)
 */
export function waveformValue(waveform: LfoWaveform, t: number): number {
  const x = wrapPhase01(t);
  switch (waveform) {
    case "sine":
      return Math.sin(2 * Math.PI * x);
    case "triangle":
      // 0→0, 0.25→+1, 0.5→0, 0.75→-1, 1→0
      if (x < 0.25) return 4 * x;
      if (x < 0.75) return 2 - 4 * x;
      return 4 * x - 4;
    case "square":
      return x < 0.5 ? 1 : -1;
    case "saw":
      return 2 * x - 1;
    default:
      return 0;
  }
}

/**
 * Aktuelle bipolare LFO-Auslenkung in [-1, +1] zu einem Zeitpunkt.
 * Bei rateHz <= 0 wird die Welle eingefroren und nur der Phasen-Offset
 * ausgewertet (nützlich als statischer Offset / zum Pausieren).
 */
export function evaluateLfo(shape: LfoShape, timeSec: number): number {
  const phaseOffset = wrapPhase01(shape.phase ?? 0);
  if (!Number.isFinite(shape.rateHz) || shape.rateHz <= 0) {
    return waveformValue(shape.waveform, phaseOffset);
  }
  const t = wrapPhase01(timeSec * shape.rateHz + phaseOffset);
  return waveformValue(shape.waveform, t);
}

/**
 * Sampelt eine LFO-Wellenform über `cycles` volle Zyklen für die Kurven-
 * Visualisierung (Canvas). Reine, deterministische Funktion — kein rAF, kein
 * AudioContext. Reuse von `waveformValue` (keine Re-Implementierung der Math).
 *
 * Der Phasen-Offset aus `shape.phase` verschiebt die Samples; `depth` (0..1)
 * skaliert die Amplitude (Master-Scaler der LFO, lebt im Store nicht in
 * LfoShape — daher als separater Parameter, bewusst KEIN Import von LfoConfig,
 * um einen Zirkular-Import lfo.ts ↔ useLfoModStore zu vermeiden).
 *
 * @param shape   Wellenform + Phasen-Offset (rateHz wird hier ignoriert — die
 *                X-Achse ist phasenbasiert, nicht zeitbasiert).
 * @param depth   Amplituden-Scaler 0..1 (geklemmt).
 * @param points  Anzahl Samples über alle Zyklen (>= 2).
 * @param cycles  Anzahl voller Zyklen (Default 1).
 * @returns       Array bipolarer Werte in [-depth, +depth].
 */
export function sampleLfoCycle(
  shape: LfoShape,
  depth: number,
  points: number,
  cycles = 1,
): number[] {
  const n = Math.max(2, Math.floor(points));
  const cyc = Math.max(1, cycles);
  const d = Math.max(0, Math.min(1, Number.isFinite(depth) ? depth : 0));
  const phaseOffset = wrapPhase01(shape.phase ?? 0);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    // 0..cyc über die Breite; pro Zyklus eine volle Periode.
    const t = (i / (n - 1)) * cyc + phaseOffset;
    out[i] = waveformValue(shape.waveform, t) * d;
  }
  return out;
}

/**
 * Wendet eine bipolare Modulation um einen Basiswert an und klemmt das
 * Ergebnis in [min, max].
 *
 * @param base       Unmodulierter Basiswert (z.B. Mixer-Fader-Volume).
 * @param lfoValue   Bipolare LFO-Auslenkung in [-1,+1] (aus evaluateLfo).
 * @param amount     Routing-Stärke -1..+1 (skaliert + invertierbar).
 * @param min,max    Erlaubter Wertebereich des Ziel-Params.
 * @param span       Modulationshub in Param-Einheiten bei amount=1, lfo=1.
 *                   (Default = (max-min)/2 → volle Auslenkung füllt den Range.)
 */
export function applyBipolarMod(
  base: number,
  lfoValue: number,
  amount: number,
  min: number,
  max: number,
  span?: number,
): number {
  const hub = span ?? (max - min) / 2;
  const a = Math.max(-1, Math.min(1, amount));
  const v = Math.max(-1, Math.min(1, lfoValue));
  const out = base + v * a * hub;
  return Math.max(min, Math.min(max, out));
}
