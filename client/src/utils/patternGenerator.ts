// Synthstudio – patternGenerator.ts
// Pure TypeScript, no React. Seeded PRNG for reproducible patterns.

export type Genre = "techno" | "house" | "hiphop" | "trap" | "dnb" | "reggaeton";

export interface GeneratorOptions {
  genre: Genre;
  complexity: number;  // 0.0 = minimal, 1.0 = maximal
  seed?: number;
  /**
   * v3.51.0: 64 unterstützt + voll abgedeckt. Templates basieren jetzt auf
   * Density-Specs (beats/16 als Basis-Auflösung). Generator rendert die
   * Density-Spec auf die gewünschte stepCount-Länge:
   *   16-step → klassisches Verhalten (unverändert, backward-compat)
   *   32-step → doppelte Auflösung, Specs werden auf [0, stepCount) gestreckt
   *   64-step → vierfache Auflösung, plus Last-Bar-Variation (Fill + Ghost-Notes)
   */
  stepCount?: 16 | 32 | 64;
  description?: string;
}

export interface GeneratedPattern {
  genre: Genre;
  bpm: number;
  description?: string;
  parts: Array<{
    name: string;
    steps: Array<{ active: boolean; velocity: number }>;
  }>;
}

export const GENRE_LABELS: Record<Genre, string> = {
  techno:    "Techno",
  house:     "House",
  hiphop:    "Hip-Hop",
  trap:      "Trap",
  dnb:       "DnB",
  reggaeton: "Reggaeton",
};

export const GENRE_BPM: Record<Genre, number> = {
  techno:    135,
  house:     124,
  hiphop:    90,
  trap:      140,
  dnb:       174,
  reggaeton: 100,
};

// ─── Seeded PRNG (mulberry32) ─────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Genre Specs ──────────────────────────────────────────────────────────────
//
// Indizes referenzieren das 16-step "base bar". Beim Rendern auf 32/64-step
// werden alle Indizes über alle Bars hinweg expandiert (bar-by-bar repeat),
// und ab 64-step zusätzlich Last-Bar-Variation appliziert.

interface GenreSpec {
  kick:   number[];
  snare:  number[];
  hatCl:  number[];
  hatOp:  number[];
  perc:   number[];
  xKick:  number[];  // extra steps added by complexity
  xSnare: number[];
  xHatCl: number[];
  xPerc:  number[];
}

const SPECS: Record<Genre, GenreSpec> = {
  techno: {
    kick:   [0, 4, 8, 12],
    snare:  [4, 12],
    hatCl:  [0, 2, 4, 6, 8, 10, 12, 14],
    hatOp:  [6, 14],
    perc:   [3, 11],
    xKick:  [2, 10], xSnare: [8], xHatCl: [1, 3, 5, 7, 9, 11, 13, 15], xPerc: [1, 5, 9, 13],
  },
  house: {
    kick:   [0, 4, 8, 12],
    snare:  [4, 12],
    hatCl:  [2, 6, 10, 14],
    hatOp:  [6, 14],
    perc:   [2, 10],
    xKick:  [6, 14], xSnare: [8], xHatCl: [0, 4, 8, 12], xPerc: [0, 4, 8, 12],
  },
  hiphop: {
    kick:   [0, 8],
    snare:  [4, 12],
    hatCl:  [0, 2, 4, 6, 8, 10, 12, 14],
    hatOp:  [6, 14],
    perc:   [3, 7, 11, 15],
    xKick:  [6, 10], xSnare: [], xHatCl: [1, 3, 5, 7, 9, 11, 13, 15], xPerc: [1, 5, 9, 13],
  },
  trap: {
    kick:   [0, 10],
    snare:  [4],
    hatCl:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    hatOp:  [2, 10],
    perc:   [1, 5, 9, 13],
    xKick:  [6, 12], xSnare: [12], xHatCl: [], xPerc: [3, 7, 11, 15],
  },
  dnb: {
    kick:   [0, 3, 8, 10],
    snare:  [4, 12],
    hatCl:  [0, 2, 4, 6, 8, 10, 12, 14],
    hatOp:  [6],
    perc:   [1, 3, 5, 7, 9, 11, 13, 15],
    xKick:  [12], xSnare: [6], xHatCl: [1, 3, 5, 7, 9, 11, 13, 15], xPerc: [2, 6, 10, 14],
  },
  reggaeton: {
    kick:   [0, 8, 12],
    snare:  [4, 14],
    hatCl:  [0, 2, 4, 6, 8, 10, 12, 14],
    hatOp:  [6, 14],
    perc:   [0, 4, 8, 12],
    xKick:  [6], xSnare: [10], xHatCl: [1, 3, 5, 7, 9, 11, 13, 15], xPerc: [2, 6, 10, 14],
  },
};

// ─── Density-Spec Expansion ───────────────────────────────────────────────────
//
// v3.51.0: bar-by-bar repeat. Eine 16er-Indexliste wird zu jeder weiteren Bar
// dupliziert (Offset = barIdx * 16). Bei stepCount=32 → 2 Bars, 64 → 4 Bars.

const BAR_LEN = 16;

function expandBars(baseIndices: number[], stepCount: number): number[] {
  if (stepCount <= BAR_LEN) return baseIndices.filter(i => i < stepCount);
  const bars = Math.floor(stepCount / BAR_LEN);
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * BAR_LEN;
    for (const idx of baseIndices) {
      if (idx < BAR_LEN) out.push(offset + idx);
    }
  }
  return out;
}

// ─── Step Builder ─────────────────────────────────────────────────────────────

function buildSteps(
  base: number[],
  extra: number[],
  n: number,
  rand: () => number,
  complexity: number,
  baseVel: number
): Array<{ active: boolean; velocity: number }> {
  const variation = Math.floor(complexity * 30);
  const steps: Array<{ active: boolean; velocity: number }> = Array.from(
    { length: n },
    () => ({ active: false, velocity: 0 })
  );

  // v3.51.0: Density-Spec wird über alle Bars expandiert. Für stepCount=16
  // bleibt das Verhalten identisch zu v3.50 (single bar, keine Bar-Variation).
  const expandedBase = expandBars(base, n);
  const expandedExtra = expandBars(extra, n);

  for (const s of expandedBase) {
    if (s < n) {
      steps[s] = {
        active: true,
        velocity: Math.min(127, Math.max(10, baseVel + Math.round((rand() * 2 - 1) * variation))),
      };
    }
  }
  for (const s of expandedExtra) {
    if (s < n && !steps[s].active && rand() < complexity) {
      steps[s] = {
        active: true,
        velocity: Math.min(127, Math.max(10, (baseVel - 15) + Math.round((rand() * 2 - 1) * variation))),
      };
    }
  }
  return steps;
}

// ─── Last-Bar Variation (v3.51.0) ─────────────────────────────────────────────
//
// Bei stepCount >= 32 wird die letzte Bar leicht variiert, damit das Pattern
// nicht 100% repetitiv klingt:
//   - Per-Bar leichte velocity-Reduktion auf Beat 1 in earlier bars (subtil)
//   - Last-Bar Fill: Snare-Roll auf 16th-Steps am Ende
//   - 64-step zusätzlich: Ghost-HiHat-Notes auf Offbeats in Bar 3-4
//
// Pure helper — operiert auf bereits gefüllten Step-Arrays per Part-Name.

interface VariationContext {
  rand: () => number;
  complexity: number;
}

function applyLastBarVariation(
  pattern: GeneratedPattern,
  stepCount: number,
  ctx: VariationContext,
): void {
  if (stepCount < 32) return; // 16-step bleibt unverändert
  const bars = Math.floor(stepCount / BAR_LEN);
  if (bars < 2) return;

  const lastBarStart = (bars - 1) * BAR_LEN;
  const snare = pattern.parts.find(p => p.name.toLowerCase().includes("snare"));
  const hatCl = pattern.parts.find(p => p.name.toLowerCase().includes("hi-hat cl"));

  // Last-Bar Fill: Snare-Hits auf Steps lastBarStart+12..15 (4. Beat des letzten Bars).
  if (snare) {
    for (let i = 12; i < 16; i++) {
      const idx = lastBarStart + i;
      if (idx < snare.steps.length) {
        // Velocity-Ramp 70..100 für klassisches "Fill"-Gefühl
        const vel = 70 + Math.round((i - 12) * 10) + Math.round((ctx.rand() * 2 - 1) * 8);
        snare.steps[idx] = {
          active: true,
          velocity: Math.min(127, Math.max(40, vel)),
        };
      }
    }
  }

  // Per-Bar Roll: leichte Velocity-Variation pro Bar (außer Bar 0).
  // Beat-1 (Step 0 jeder Bar) bekommt -5..+5 Velocity, damit Wiederholungen
  // organisch wirken statt 100% gleich klingen.
  for (let bar = 1; bar < bars; bar++) {
    const beat1Idx = bar * BAR_LEN;
    for (const part of pattern.parts) {
      const step = part.steps[beat1Idx];
      if (step?.active) {
        const delta = Math.round((ctx.rand() * 2 - 1) * 5);
        step.velocity = Math.min(127, Math.max(20, step.velocity + delta));
      }
    }
  }

  // 64-step zusätzlich: Ghost-Hi-Hat-Notes auf 16th-Offbeats in den letzten 2 Bars.
  if (stepCount >= 64 && hatCl) {
    const start = (bars - 2) * BAR_LEN;
    // Offbeat-16th-Positionen: Steps mit (i % 2 === 1) im jeweiligen Bar.
    for (let bar = bars - 2; bar < bars; bar++) {
      for (let i = 1; i < BAR_LEN; i += 2) {
        const idx = bar * BAR_LEN + i;
        if (idx < hatCl.steps.length && !hatCl.steps[idx].active && ctx.rand() < 0.4 + ctx.complexity * 0.3) {
          hatCl.steps[idx] = {
            active: true,
            velocity: 30 + Math.round(ctx.rand() * 25), // Ghost: 30..55
          };
        }
      }
    }
    // Mark `start` als bewusst genutzt für Linter (avoid no-unused-var futureguard)
    void start;
  }
}

// ─── Description Layer ────────────────────────────────────────────────────────

function normalizeDescription(description?: string): string {
  return (description ?? "").trim().toLowerCase();
}

function stableDescriptionSeed(description: string): number {
  let hash = 2166136261;
  for (let i = 0; i < description.length; i++) {
    hash ^= description.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function activateSteps(
  steps: Array<{ active: boolean; velocity: number }>,
  indexes: number[],
  velocity: number,
): void {
  for (const index of indexes) {
    const stepIndex = index % steps.length;
    steps[stepIndex] = { active: true, velocity };
  }
}

function thinSteps(
  steps: Array<{ active: boolean; velocity: number }>,
  keepEvery: number,
): void {
  steps.forEach((step, index) => {
    if (step.active && index % keepEvery !== 0) {
      steps[index] = { active: false, velocity: 0 };
    }
  });
}

function applyDescription(
  pattern: GeneratedPattern,
  description: string,
  rand: () => number,
): GeneratedPattern {
  if (!description) return pattern;

  const next: GeneratedPattern = {
    ...pattern,
    description,
    parts: pattern.parts.map((part) => ({
      ...part,
      steps: part.steps.map((step) => ({ ...step })),
    })),
  };

  const byName = (name: string) =>
    next.parts.find((part) => part.name.toLowerCase().includes(name));

  const kick = byName("kick");
  const snare = byName("snare");
  const hatClosed = byName("hi-hat cl");
  const hatOpen = byName("hi-hat op");
  const perc = byName("perc");

  if (description.includes("minimal") || description.includes("simple") || description.includes("einfach")) {
    next.parts.forEach((part) => thinSteps(part.steps, part.name.includes("Kick") ? 4 : 8));
  }

  if (description.includes("dicht") || description.includes("busy") || description.includes("dense") || description.includes("viel")) {
    if (hatClosed) activateSteps(hatClosed.steps, Array.from({ length: hatClosed.steps.length }, (_, i) => i), 72);
    if (perc) activateSteps(perc.steps, [1, 3, 5, 7, 9, 11, 13, 15], 78);
  }

  if (description.includes("offbeat") || description.includes("groove")) {
    if (hatOpen) activateSteps(hatOpen.steps, [2, 6, 10, 14], 86);
    if (perc) activateSteps(perc.steps, [3, 7, 11, 15], 76);
  }

  if (description.includes("break") || description.includes("gebrochen")) {
    if (kick) activateSteps(kick.steps, [0, 3, 8, 10], 108);
    if (snare) activateSteps(snare.steps, [4, 12], 96);
  }

  if (description.includes("halftime") || description.includes("half time")) {
    if (snare) {
      snare.steps.forEach((_step, index) => {
        snare.steps[index] = { active: index === 8, velocity: index === 8 ? 104 : 0 };
      });
    }
  }

  if (description.includes("clap")) {
    if (snare) activateSteps(snare.steps, [4, 12], 112);
  }

  if (description.includes("kick") || description.includes("druck")) {
    if (kick) activateSteps(kick.steps, [0, 4, 8, 12], 118);
  }

  if (description.includes("roll") || description.includes("wirbel")) {
    if (snare) activateSteps(snare.steps, [12, 13, 14, 15], 70 + Math.round(rand() * 30));
  }

  if (description.includes("ghost")) {
    if (snare) activateSteps(snare.steps, [2, 6, 10, 14], 44);
  }

  if (description.includes("808")) {
    if (kick) activateSteps(kick.steps, [0, 7, 10, 12], 124);
    next.bpm = Math.max(70, Math.min(150, next.bpm));
  }

  return next;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generatePattern(options: GeneratorOptions): GeneratedPattern {
  const description = normalizeDescription(options.description);
  const descriptionSeed = stableDescriptionSeed(description);
  const { genre, complexity, seed = Date.now(), stepCount = 16 } = options;
  const rand = mulberry32((seed ^ descriptionSeed) >>> 0);
  const sp = SPECS[genre];
  const c = Math.max(0, Math.min(1, complexity));

  const hatClBase = c < 0.3 ? sp.hatCl.filter((_, i) => i % 2 === 0) : sp.hatCl;
  const hatOpBase = c >= 0.5 ? sp.hatOp : [];
  const hatOpExtra = c < 0.5 ? sp.hatOp : [];
  const percBase   = c >= 0.4 ? sp.perc : [];

  const generated: GeneratedPattern = {
    genre,
    bpm: GENRE_BPM[genre],
    description: description || undefined,
    parts: [
      { name: "Kick",       steps: buildSteps(sp.kick,   sp.xKick,   stepCount, rand, c, 100) },
      { name: "Snare",      steps: buildSteps(sp.snare,  sp.xSnare,  stepCount, rand, c,  90) },
      { name: "Hi-Hat cl.", steps: buildSteps(hatClBase, sp.xHatCl,  stepCount, rand, c,  80) },
      { name: "Hi-Hat op.", steps: buildSteps(hatOpBase, hatOpExtra, stepCount, rand, c,  75) },
      { name: "Perc",       steps: buildSteps(percBase,  sp.xPerc,   stepCount, rand, c,  85) },
    ],
  };

  // v3.51.0: bei mehrbarigen Patterns Last-Bar-Fill + Ghost-Notes anwenden.
  applyLastBarVariation(generated, stepCount, { rand, complexity: c });

  return applyDescription(generated, description, rand);
}
