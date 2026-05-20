/**
 * patternComplexitySum.ts - v3.219
 * ------------------------------------------------------------------------
 * Pure-Helper: aggregiert mehrere v3.x-Complexity-Metriken (density,
 * entropy, syncopation, pulseCount, symmetryScore, repetitionScore)
 * zu EINER composite Bewertung. Anders als patternComplexity.ts
 * (v3.160), der ein PatternData entgegen nimmt und 4 fixe Subscores
 * selbst berechnet, arbeitet dieser Aggregator auf bereits-berechneten
 * Scores - jeder Sub-Score kann separat in der UI/im Generator erhoben
 * werden und dann hier kombiniert werden.
 *
 * --- Pinned Choices ---
 *
 *   #1 Default Weights:
 *      density=0.2, entropy=0.25, syncopation=0.2, pulseCount=0.1,
 *      symmetryScore=0.1 (INVERTED), repetitionScore=0.15 (INVERTED).
 *      Sum = 1.0 wenn alle 6 vorhanden.
 *
 *   #2 Inversion: symmetryScore und repetitionScore werden invertiert
 *      (1 - score) bevor sie gewichtet werden. Begruendung: hohe
 *      Symmetrie / hohe Repetition bedeutet GERINGE Komplexitaet.
 *
 *   #3 Partial-Input-Normalisierung: Bei fehlenden Feldern (undefined
 *      oder NaN) wird der Anteil herausgekuerzt - totalComplexity =
 *      sum(contribution) / sum(weight_present). Wenn KEIN Feld
 *      vorhanden, totalComplexity = 0.
 *
 *   #4 Score-Clamping: Eingaben werden auf [0, 1] geklemmt
 *      (>1 -> 1, <0 -> 0). NaN/Inf -> als undefined behandelt
 *      (= ausgeschlossen).
 *
 *   #5 dominantComponent: Komponente mit hoechstem (score * weight),
 *      basierend auf den NACH-Inversion-Werten. Ties -> erste in
 *      Iteration-Order der Default-Weights gewinnt (strict >).
 *      Empty Input -> "".
 *
 *   #6 buildComponentBreakdown: ALWAYS 6 Eintraege; fehlende Felder
 *      werden mit score=0 und Default-Weight eingefuegt.
 *      Reihenfolge: density, entropy, syncopation, pulseCount,
 *      symmetryScore, repetitionScore.
 *
 *   #7 pulseCount Normalisierung: WIRD ALS 0..1 ANGENOMMEN
 *      (Caller-Verantwortung). pulseCount=0.8 bedeutet "0.8 von max."
 *
 *   #8 components-Array enthaelt NUR vorhandene (non-NaN, defined)
 *      Komponenten. buildComponentBreakdown enthaelt ALWAYS alle 6.
 *
 * Reine Funktion: kein Mutate, kein Date.now, kein Math.random.
 * Owner: frontend (pattern-utility wie patternComplexity v3.160).
 */

// --- Public Types ----------------------------------------------------------

export interface ComplexityComponent {
  name: string;
  score: number;
  weight: number;
}

export interface ComplexitySumResult {
  totalComplexity: number;
  components: ComplexityComponent[];
  dominantComponent: string;
}

export interface ComplexitySumInput {
  density?: number;
  entropy?: number;
  syncopation?: number;
  pulseCount?: number;
  symmetryScore?: number;
  repetitionScore?: number;
}

// --- Constants -------------------------------------------------------------

const DEFAULT_WEIGHTS: Readonly<Record<keyof ComplexitySumInput, number>> =
  Object.freeze({
    density: 0.2,
    entropy: 0.25,
    syncopation: 0.2,
    pulseCount: 0.1,
    symmetryScore: 0.1,
    repetitionScore: 0.15,
  });

const COMPONENT_ORDER: readonly (keyof ComplexitySumInput)[] = Object.freeze([
  "density",
  "entropy",
  "syncopation",
  "pulseCount",
  "symmetryScore",
  "repetitionScore",
]);

const INVERTED: Readonly<Record<keyof ComplexitySumInput, boolean>> =
  Object.freeze({
    density: false,
    entropy: false,
    syncopation: false,
    pulseCount: false,
    symmetryScore: true,
    repetitionScore: true,
  });

// --- Internal Helpers ------------------------------------------------------

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function sanitize(v: number | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number") return undefined;
  if (!Number.isFinite(v)) return undefined;
  return clamp01(v);
}

function effectiveScore(name: keyof ComplexitySumInput, raw: number): number {
  return INVERTED[name] ? clamp01(1 - raw) : raw;
}

// --- Public API ------------------------------------------------------------

export function computeComplexitySum(
  input: ComplexitySumInput | null | undefined,
): ComplexitySumResult {
  if (!input || typeof input !== "object") {
    return { totalComplexity: 0, components: [], dominantComponent: "" };
  }

  const components: ComplexityComponent[] = [];
  let weightedSum = 0;
  let presentWeightSum = 0;
  let bestContribution = -Infinity;
  let dominantComponent = "";

  for (const name of COMPONENT_ORDER) {
    const raw = sanitize(input[name]);
    if (raw === undefined) continue;

    const score = effectiveScore(name, raw);
    const weight = DEFAULT_WEIGHTS[name];
    const contribution = score * weight;

    components.push({ name, score, weight });
    weightedSum += contribution;
    presentWeightSum += weight;

    if (contribution > bestContribution) {
      bestContribution = contribution;
      dominantComponent = name;
    }
  }

  const totalComplexity =
    presentWeightSum > 0 ? clamp01(weightedSum / presentWeightSum) : 0;

  return { totalComplexity, components, dominantComponent };
}

export function buildComponentBreakdown(
  input: ComplexitySumInput | null | undefined,
): ComplexityComponent[] {
  const safe: ComplexitySumInput =
    input && typeof input === "object" ? input : {};
  const out: ComplexityComponent[] = [];

  for (const name of COMPONENT_ORDER) {
    const raw = sanitize(safe[name]);
    const score = raw === undefined ? 0 : effectiveScore(name, raw);
    out.push({ name, score, weight: DEFAULT_WEIGHTS[name] });
  }
  return out;
}
