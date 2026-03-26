import type { PartData } from "../audio/AudioEngine";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DensityCell {
  stepIndex: number;
  partId: string;
  /** Weighted activation: active * (velocity/127) * (probability/100) ∈ [0,1] */
  weight: number;
}

export interface DensityMap {
  /** Number of parts */
  partCount: number;
  /** Number of steps (longest part) */
  stepCount: number;
  /**
   * cells[stepIndex][partIndex] = weight in [0,1].
   * Shorter parts are padded with 0.
   */
  cells: number[][];
  /** Average density per step across all parts (0–1) */
  stepDensity: number[];
  /** Average density per part across all steps (0–1) */
  partDensity: number[];
  /** Overall density (0–1) */
  totalDensity: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stepWeight(step: PartData["steps"][number]): number {
  if (!step.active) return 0;
  const vel = step.velocity !== undefined ? step.velocity / 127 : 1;
  const prob = step.probability !== undefined ? step.probability / 100 : 1;
  return Math.min(1, Math.max(0, vel * prob));
}

// ─── computeDensityMap ───────────────────────────────────────────────────────

/**
 * Compute a density map from pattern data.
 * Only non-muted parts are included.
 */
export function computeDensityMap(parts: PartData[]): DensityMap {
  const activeParts = parts.filter((p) => !p.muted);
  const partCount = activeParts.length;

  if (partCount === 0) {
    return {
      partCount: 0,
      stepCount: 0,
      cells: [],
      stepDensity: [],
      partDensity: [],
      totalDensity: 0,
    };
  }

  const stepCount = Math.max(...activeParts.map((p) => p.steps.length));

  // Build cells[step][part]
  const cells: number[][] = Array.from({ length: stepCount }, (_, si) =>
    activeParts.map((part) => {
      const step = part.steps[si];
      return step ? stepWeight(step) : 0;
    }),
  );

  // stepDensity: average weight across parts per step
  const stepDensity = cells.map((row) => {
    if (row.length === 0) return 0;
    const sum = row.reduce((a, b) => a + b, 0);
    return sum / row.length;
  });

  // partDensity: average weight across steps per part
  const partDensity = activeParts.map((_, pi) => {
    if (stepCount === 0) return 0;
    const sum = cells.reduce((acc, row) => acc + row[pi], 0);
    return sum / stepCount;
  });

  // totalDensity: average of all weights
  const totalWeight = cells.reduce(
    (acc, row) => acc + row.reduce((a, b) => a + b, 0),
    0,
  );
  const totalDensity =
    partCount * stepCount > 0 ? totalWeight / (partCount * stepCount) : 0;

  return { partCount, stepCount, cells, stepDensity, partDensity, totalDensity };
}

// ─── detectFlashingPairs ─────────────────────────────────────────────────────

/**
 * Detect pairs of parts that are co-active on the same steps above `threshold`.
 * Co-activation is the fraction of steps where both parts have active steps.
 */
export function detectFlashingPairs(
  parts: PartData[],
  threshold = 0.5,
): Array<{ partA: string; partB: string; coActivation: number }> {
  const activeParts = parts.filter((p) => !p.muted);
  if (activeParts.length < 2) return [];

  const stepCount = Math.max(...activeParts.map((p) => p.steps.length));
  if (stepCount === 0) return [];

  // Boolean activation per part per step
  const active: boolean[][] = activeParts.map((part) =>
    Array.from({ length: stepCount }, (_, si) =>
      si < part.steps.length ? part.steps[si].active : false,
    ),
  );

  const result: Array<{ partA: string; partB: string; coActivation: number }> =
    [];

  for (let a = 0; a < activeParts.length; a++) {
    for (let b = a + 1; b < activeParts.length; b++) {
      let coActive = 0;
      for (let s = 0; s < stepCount; s++) {
        if (active[a][s] && active[b][s]) coActive++;
      }
      const coActivation = coActive / stepCount;
      if (coActivation > threshold) {
        result.push({
          partA: activeParts[a].id,
          partB: activeParts[b].id,
          coActivation,
        });
      }
    }
  }

  return result;
}
