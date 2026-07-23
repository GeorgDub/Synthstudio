/**
 * patternStepReduce.ts — reine Step-Reduktion für den Import/Konvertier-Flow.
 *
 * Quell-Patterns können mehr Steps haben als die Electribe 2 (Sampler) je Pattern
 * fasst (E2 = 64 Steps). Beim Laden in den Sequenzer ODER beim Konvertieren zu
 * `.e2spat`/`.e2sallpat` müssen zu lange Step-Reihen auf 64 reduziert werden.
 * Der User wählt die Strategie (oder editiert selbst), bevor geladen/konvertiert
 * wird — diese Datei liefert nur die deterministische, seiteneffektfreie Logik.
 *
 * Zwei Strategien (UI zeigt beide, Default = decimate):
 *   - "decimate" („Halbieren / jeden N-ten"): behält jeden N-ten Step
 *     (N = floor(source/target)); für 128→64 also jeden 2. — der komplette Loop
 *     bleibt erhalten, nur in halber Auflösung.
 *   - "truncate" („Erste 64"): behält Steps 0..target-1 in voller Auflösung,
 *     verwirft den Rest.
 *
 * Generisch über den Step-Elementtyp (bool oder Step-Objekt) — die Auswahl ist
 * reine Index-Logik und funktioniert für beide.
 */

/** Maximale Step-Anzahl eines Electribe-2-(Sampler-)Patterns. */
export const E2_MAX_STEPS = 64;

export type StepReductionStrategy = "decimate" | "truncate";

export const STEP_REDUCTION_STRATEGIES: StepReductionStrategy[] = [
  "decimate",
  "truncate",
];

/** true, wenn `sourceLen` das Ziel überschreitet und reduziert werden muss. */
export function stepReductionNeeded(
  sourceLen: number,
  targetLen: number = E2_MAX_STEPS
): boolean {
  return sourceLen > targetLen;
}

/**
 * Dezimierungs-Faktor für "decimate": jeder N-te Step wird behalten.
 * N = floor(source/target), mindestens 1. Für 128→64 ⇒ 2 (jeder 2. Step).
 */
export function decimationFactor(
  sourceLen: number,
  targetLen: number = E2_MAX_STEPS
): number {
  if (targetLen <= 0) return 1;
  return Math.max(1, Math.floor(sourceLen / targetLen));
}

/**
 * Reduziert eine Step-Reihe auf `targetLen`. Rein + deterministisch, generisch
 * über den Elementtyp. Ist die Reihe bereits ≤ targetLen, wird sie unverändert
 * (als Kopie) zurückgegeben.
 */
export function reduceSteps<T>(
  steps: readonly T[],
  targetLen: number = E2_MAX_STEPS,
  strategy: StepReductionStrategy = "decimate"
): T[] {
  if (targetLen <= 0) return [];
  if (steps.length <= targetLen) return steps.slice();

  if (strategy === "truncate") {
    return steps.slice(0, targetLen);
  }

  // decimate: jeden N-ten Step nehmen.
  const factor = decimationFactor(steps.length, targetLen);
  const out: T[] = new Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const src = i * factor;
    // Clamp gegen Überlauf (falls source kein exaktes Vielfaches ist).
    out[i] = steps[src < steps.length ? src : steps.length - 1];
  }
  return out;
}

/** Menschenlesbares Label für die UI. */
export function stepReductionLabel(strategy: StepReductionStrategy): string {
  return strategy === "decimate"
    ? "Halbieren (jeden 2. Step)"
    : "Erste 64 (abschneiden)";
}
