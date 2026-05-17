/**
 * Synthstudio – looperUtils.ts (TASK-235 / v2.87)
 *
 * Pure-Logik-Helper für den Live-Looper (RC-505 / Ableton Live Looper). KEIN
 * Web-Audio-API-Import → trivial in Node.js / Vitest testbar.
 *
 * Was hier wohnt:
 *   - State-Machine-Constants + nextLoopState(): empty → arming → recording →
 *     playing ⇄ overdubbing; erase → empty
 *   - Quantisierungs-Helfer: nextBeatBoundary(), quantizeLoopLengthBars(),
 *     beatDurationSec()
 *   - Overdub-Merge: mixLoopBuffersLinear() (Linear-Sum mit Clip auf [-1,+1])
 *
 * Snap-Policy (siehe quantizeLoopLengthBars):
 *   Wir runden die aufgenommene Länge in Bars auf die NÄCHST-GRÖSSERE Power-of-2
 *   Stufe (1 / 2 / 4 / 8). Bei 2.7 Bars → 4 Bars. Bei 0.5 Bars → 1 Bar. Begründung:
 *   - Power-of-2-Längen sind musikalisch am brauchbarsten (jeder Loop ist als
 *     2-bar, 4-bar, 8-bar Phrase usable, ohne Polymetrik-Surprise).
 *   - Ceil verhindert dass User-Material abgeschnitten wird (Aufnahme zu Ende
 *     spielen ist wichtiger als ein paar Frames Stille am Ende).
 *   - MAX_LOOP_BARS=8 cappt damit nicht versehentlich riesige Loops entstehen
 *     wenn User vergisst zu stoppen.
 */

// ─── Konstanten ──────────────────────────────────────────────────────────────

/** Maximale Anzahl gleichzeitig aktiver Loops (RC-505-Inspired Cap). */
export const MAX_LOOPS = 4;

/** Mindestens 1 Bar Loop (verhindert versehentliche Sub-Beat-Loops). */
export const MIN_LOOP_BARS = 1;

/** Hard-Cap auf Loop-Länge in Bars (User-Schutz vs Memory-Bloat). */
export const MAX_LOOP_BARS = 8;

/** Erlaubte Snap-Stufen — Power-of-2-Bars zwischen MIN und MAX. */
export const LOOP_BAR_SNAP_STEPS: ReadonlyArray<number> = [1, 2, 4, 8];

/** Default-Taktart-Annahme. Synthstudio ist 4/4-zentriert. */
export const DEFAULT_BEATS_PER_BAR = 4;

/** Long-Press-Schwelle (ms) für Loop-Erase im UI. */
export const LOOP_ERASE_LONG_PRESS_MS = 500;

// ─── State-Machine ───────────────────────────────────────────────────────────

export type LoopState =
  | "empty"
  | "arming"
  | "recording"
  | "playing"
  | "overdubbing"
  | "stopped";

/**
 * State-Machine-Übergang bei Loop-Trigger (Pad-Click / Footswitch).
 *
 *   empty       → arming      (wartet auf Beat-Boundary, hat noch keine Source)
 *   arming      → recording   (Beat-Boundary erreicht, Aufnahme läuft)
 *   recording   → playing     (Beat-Boundary erreicht, Loop-Länge quantisiert)
 *   playing     → overdubbing (User will Overdub starten)
 *   overdubbing → playing     (Overdub-Pass beendet, merge in Buffer)
 *   stopped     → playing     (Re-start nach pause)
 *
 * Wirft kein Error — bei Missbrauch returnt einfach gleichen Zustand.
 */
export function nextLoopState(current: LoopState): LoopState {
  switch (current) {
    case "empty":       return "arming";
    case "arming":      return "recording";
    case "recording":   return "playing";
    case "playing":     return "overdubbing";
    case "overdubbing": return "playing";
    case "stopped":     return "playing";
  }
}

/** Long-Press / explizites Erase: jeder Zustand → empty. */
export function eraseLoopState(_current: LoopState): LoopState {
  void _current;
  return "empty";
}

/** Toggle Play/Stop unabhängig vom Record-Cycle. */
export function toggleLoopPlayStop(current: LoopState): LoopState {
  if (current === "playing" || current === "overdubbing") return "stopped";
  if (current === "stopped") return "playing";
  return current; // empty / arming / recording → unverändert
}

// ─── Quantisierung ───────────────────────────────────────────────────────────

/** Beat-Dauer in Sekunden bei gegebenem BPM. */
export function beatDurationSec(bpm: number): number {
  const safeBpm = Math.max(20, Math.min(300, bpm));
  return 60 / safeBpm;
}

/**
 * Nächste Beat-Boundary (in AudioContext-time-Koordinaten) nach `currentTime`,
 * basierend auf einer Referenz-Anker-Zeit (Transport-Start).
 *
 * @param currentTime   aktuelle AudioContext.currentTime
 * @param anchorTime    Zeitpunkt an dem Beat 0 los lief
 * @param bpm           aktuelles BPM
 * @returns AudioContext-Zeit (Sek) der nächsten Beat-Boundary > currentTime
 */
export function nextBeatBoundary(
  currentTime: number,
  anchorTime: number,
  bpm: number,
): number {
  const beat = beatDurationSec(bpm);
  if (beat <= 0) return currentTime;
  const delta = currentTime - anchorTime;
  const beatsSinceAnchor = Math.floor(delta / beat);
  const nextBoundary = anchorTime + (beatsSinceAnchor + 1) * beat;
  // Defensive: nie in die Vergangenheit
  return Math.max(nextBoundary, currentTime);
}

/**
 * Nächste Bar-Boundary (downbeat) — wie nextBeatBoundary, aber auf
 * `beatsPerBar`-Vielfache gesnapped.
 */
export function nextBarBoundary(
  currentTime: number,
  anchorTime: number,
  bpm: number,
  beatsPerBar: number = DEFAULT_BEATS_PER_BAR,
): number {
  const beat = beatDurationSec(bpm);
  if (beat <= 0) return currentTime;
  const barDur = beat * Math.max(1, beatsPerBar);
  const delta = currentTime - anchorTime;
  const barsSinceAnchor = Math.floor(delta / barDur);
  const nextBoundary = anchorTime + (barsSinceAnchor + 1) * barDur;
  return Math.max(nextBoundary, currentTime);
}

/**
 * Snap auf die nächst-passende Power-of-2-Bars-Stufe.
 *
 * Anwendung: User hält Record für 2.7 Bars → wir wollen einen 4-Bar-Loop weil
 * 2-Bar zu früh kappen würde und Power-of-2 musikalisch saniert ist.
 *
 * @param elapsedBars   gemessene Aufnahmedauer in Bars (kann gebrochen sein)
 * @returns gesnapte Bar-Anzahl ∈ LOOP_BAR_SNAP_STEPS
 */
export function quantizeLoopLengthBars(elapsedBars: number): number {
  if (!Number.isFinite(elapsedBars) || elapsedBars <= 0) return MIN_LOOP_BARS;
  if (elapsedBars >= MAX_LOOP_BARS) return MAX_LOOP_BARS;
  // Nächst-größere Power-of-2-Stufe (ceil).
  for (const step of LOOP_BAR_SNAP_STEPS) {
    if (elapsedBars <= step) return step;
  }
  return MAX_LOOP_BARS;
}

/** Berechnet die Loop-Länge in Sekunden bei gegebener Bar-Anzahl + BPM. */
export function loopLengthSec(
  bars: number,
  bpm: number,
  beatsPerBar: number = DEFAULT_BEATS_PER_BAR,
): number {
  return bars * beatsPerBar * beatDurationSec(bpm);
}

// ─── Overdub-Mischer ─────────────────────────────────────────────────────────

/**
 * Mischt zwei Float32-Buffer per Linear-Sum (Sample + Sample) und cliped auf
 * [-1, +1]. Die Ausgabe-Länge entspricht der Länge des ersten Buffers; ist
 * `overdub` kürzer, werden seine letzten Frames mit Null gepaddet (nicht
 * gestretcht). Ist `overdub` länger, wird er abgeschnitten.
 *
 * Das ist die Overdub-Implementierung, die in 99% der Fälle ausreicht:
 *  - klassischer RC-505-Style: A spielt, B wird zugemischt
 *  - Decay-Faktor nicht implementiert (jeder Pass wird permanent gemerged) —
 *    follow-up für "Tape-Style"-Decay
 *
 * Pure: KEINE Web-Audio-Calls, KEIN State.
 */
export function mixLoopBuffersLinear(
  baseBuffer: Float32Array,
  overdubBuffer: Float32Array,
): Float32Array {
  const out = new Float32Array(baseBuffer.length);
  const overLen = overdubBuffer.length;
  for (let i = 0; i < baseBuffer.length; i++) {
    const base = baseBuffer[i] ?? 0;
    const over = i < overLen ? overdubBuffer[i] : 0;
    const sum = base + over;
    out[i] = sum > 1 ? 1 : sum < -1 ? -1 : sum;
  }
  return out;
}

/**
 * Mischt zwei Stereo-Loop-Buffer (links + rechts separat). Convenience-Helper;
 * Wir behalten Mono-Default (siehe TASK-234), aber API ist stereo-ready für
 * follow-up.
 */
export function mixLoopBuffersStereoLinear(
  baseL: Float32Array,
  baseR: Float32Array,
  overL: Float32Array,
  overR: Float32Array,
): { left: Float32Array; right: Float32Array } {
  return {
    left:  mixLoopBuffersLinear(baseL, overL),
    right: mixLoopBuffersLinear(baseR, overR),
  };
}

// ─── Indizes & Counter ───────────────────────────────────────────────────────

/** True wenn `index` im erlaubten Loop-Index-Bereich [0, MAX_LOOPS-1] liegt. */
export function isValidLoopIndex(index: unknown): index is number {
  return (
    typeof index === "number" &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < MAX_LOOPS
  );
}

/**
 * Begrenzt die Anzahl simultan aktiver (=nicht-empty) Loops auf MAX_LOOPS.
 * Wird vom Store genutzt um spätere addLoop()-Calls abzulehnen.
 */
export function canAddLoop(currentLoopCount: number): boolean {
  return currentLoopCount < MAX_LOOPS;
}
