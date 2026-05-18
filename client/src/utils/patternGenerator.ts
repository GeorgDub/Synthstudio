// Synthstudio – patternGenerator.ts
// Pure TypeScript, no React. Seeded PRNG for reproducible patterns.

export type Genre = "techno" | "house" | "hiphop" | "trap" | "dnb" | "reggaeton";

export interface GeneratorOptions {
  genre: Genre;
  complexity: number;  // 0.0 = minimal, 1.0 = maximal
  seed?: number;
  /**
   * v3.40: 64 unterstützt (vorher nur 16/32). Templates haben in der Regel
   * Base/Extra-Step-Listen mit Indizes < 16; bei stepCount=64 bleiben die
   * höheren Steps standardmäßig leer und können nachträglich vom User per
   * Page-Switcher gefüllt werden. AI-Pfade (callActiveLlm) generieren das
   * Pattern komplett bis zur angeforderten stepCount-Länge.
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
  for (const s of base) {
    if (s < n) {
      steps[s] = {
        active: true,
        velocity: Math.min(127, Math.max(10, baseVel + Math.round((rand() * 2 - 1) * variation))),
      };
    }
  }
  for (const s of extra) {
    if (s < n && !steps[s].active && rand() < complexity) {
      steps[s] = {
        active: true,
        velocity: Math.min(127, Math.max(10, (baseVel - 15) + Math.round((rand() * 2 - 1) * variation))),
      };
    }
  }
  return steps;
}

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

  return applyDescription(generated, description, rand);
}
