/**
 * Synthstudio – patternVariations.ts (v3.105.0)
 *
 * Pattern-Variation-Generator: pure, testbare Algorithmen die ein StepData[][]
 * Grid (parts × steps) nehmen und ein neues Grid produzieren — ohne Mutation
 * der Eingabe.
 *
 * Alle Generatoren akzeptieren einen optionalen Seed für reproduzierbare
 * Ergebnisse (mulberry32 PRNG). Bei ungesetztem Seed wird Math.random verwendet.
 *
 * Verwendet von:
 *  - usePatternVariationStore (Preview + Batch-Generate)
 *  - PatternVariationPanel (UI)
 */
import type { StepData } from "../audio/AudioEngine";

// ─── Public Types ─────────────────────────────────────────────────────────────

export type VariationKind =
  | "humanize"
  | "ghost-notes"
  | "fill-add"
  | "swing-vary"
  | "density-up"
  | "density-down"
  | "shuffle-velocity"
  | "rhythmic-displacement";

export interface VariationConfig {
  kind: VariationKind;
  /** 0..1 – Stärke des Effekts */
  intensity: number;
  /** Optional – feste Seed für reproduzierbare Ergebnisse */
  seed?: number;
}

export const ALL_VARIATION_KINDS: readonly VariationKind[] = [
  "humanize",
  "ghost-notes",
  "fill-add",
  "swing-vary",
  "density-up",
  "density-down",
  "shuffle-velocity",
  "rhythmic-displacement",
] as const;

export const VARIATION_KIND_LABELS: Record<VariationKind, string> = {
  "humanize":               "Humanize",
  "ghost-notes":            "Ghost Notes",
  "fill-add":               "Add Fill",
  "swing-vary":             "Swing Vary",
  "density-up":             "Density Up",
  "density-down":           "Density Down",
  "shuffle-velocity":       "Shuffle Velocity",
  "rhythmic-displacement":  "Rhythmic Displacement",
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

/** Liefert einen RNG: Seed → deterministisch (mulberry32), undefined → Math.random. */
export function makeRng(seed?: number): () => number {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return mulberry32(Math.floor(seed));
  }
  return Math.random;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampIntensity(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return clamp(v, 0, 1);
}

/** Tiefe-Kopie eines Step-Objekts. Bewahrt undefined-Felder als undefined. */
function cloneStep(step: StepData): StepData {
  return { ...step, paramLock: step.paramLock ? { ...step.paramLock } : step.paramLock };
}

/** Tiefe-Kopie eines Grids (parts × steps). */
function cloneGrid(grid: StepData[][]): StepData[][] {
  return grid.map((row) => row.map(cloneStep));
}

function defaultVelocity(step: StepData): number {
  return step.velocity ?? 100;
}

// ─── Variation: humanize ──────────────────────────────────────────────────────

/**
 * Humanize: subtile Velocity- und Microtiming-Variation auf aktive Steps.
 * - Velocity ±intensity·30 (clamped 1..127)
 * - Step.length (als Microtiming-Proxy) bleibt unverändert; stattdessen
 *   wird Velocity-Drift erzeugt. (Reines Step-Modell hat kein dediziertes
 *   Microtiming-Feld pro Step — Microtiming ist part-level.)
 *
 * Anzahl aktiver Steps bleibt erhalten — kein Step wird ein/ausgeschaltet.
 */
export function humanize(
  grid: StepData[][],
  intensity: number,
  seed?: number,
): StepData[][] {
  const i = clampIntensity(intensity);
  if (i === 0) return cloneGrid(grid);
  const rng = makeRng(seed);
  const velRange = i * 30;

  return grid.map((row) =>
    row.map((step) => {
      const next = cloneStep(step);
      if (!next.active) return next;
      const vel = defaultVelocity(next);
      const delta = (rng() * 2 - 1) * velRange;
      next.velocity = Math.round(clamp(vel + delta, 1, 127));
      return next;
    }),
  );
}

// ─── Variation: ghost-notes ───────────────────────────────────────────────────

/**
 * Ghost Notes: fügt low-velocity (10..30) Notes auf zuvor leeren Steps ein.
 * intensity = Wahrscheinlichkeit, dass ein leerer Step ein Ghost wird.
 *
 * Aktive Steps bleiben unangetastet.
 */
export function addGhostNotes(
  grid: StepData[][],
  intensity: number,
  seed?: number,
): StepData[][] {
  const i = clampIntensity(intensity);
  if (i === 0) return cloneGrid(grid);
  const rng = makeRng(seed);

  return grid.map((row) =>
    row.map((step) => {
      const next = cloneStep(step);
      if (next.active) return next;
      if (rng() < i) {
        next.active = true;
        next.velocity = Math.round(10 + rng() * 20); // 10..30
      }
      return next;
    }),
  );
}

// ─── Variation: fill-add ──────────────────────────────────────────────────────

/**
 * Drum-Fill: verdichtet die letzten 4 Steps. Klassisches Fill-Pattern.
 * Aktiviert alle inaktiven Steps in der letzten Bar-Hälfte (last 4)
 * mit moderater Velocity und re-velocity-iziert die bereits aktiven.
 *
 * intensity ist hier optional dekorativ — Standard-Fill ist fest definiert.
 */
export function addFill(grid: StepData[][]): StepData[][] {
  return grid.map((row) => {
    const len = row.length;
    if (len < 4) return row.map(cloneStep);
    const fillStart = len - 4;
    return row.map((step, idx) => {
      const next = cloneStep(step);
      if (idx < fillStart) return next;
      // last 4 steps: activate + bump velocity
      next.active = true;
      if (next.velocity === undefined || next.velocity < 80) {
        next.velocity = 100;
      }
      return next;
    });
  });
}

// ─── Variation: swing-vary ────────────────────────────────────────────────────

/**
 * Swing-Variation: bewusst leichte Velocity-Offsets für even-vs-odd Steps,
 * um Groove zu variieren. Even Steps werden leicht "härter", Odd Steps
 * "weicher" (oder umgekehrt — abhängig vom Seed).
 *
 * Da Microtiming hier kein Step-Feld ist, encoden wir Swing über Velocity-
 * Asymmetrie (analog zu MPC-style Swing-Display).
 */
export function varySwing(
  grid: StepData[][],
  intensity: number,
  seed?: number,
): StepData[][] {
  const i = clampIntensity(intensity);
  if (i === 0) return cloneGrid(grid);
  const rng = makeRng(seed);
  // Zufällige Direction (even härter / odd härter)
  const direction = rng() < 0.5 ? 1 : -1;
  const offset = i * 25; // max ±25 velocity

  return grid.map((row) =>
    row.map((step, idx) => {
      const next = cloneStep(step);
      if (!next.active) return next;
      const vel = defaultVelocity(next);
      const isEven = idx % 2 === 0;
      const delta = isEven ? direction * offset : -direction * offset;
      next.velocity = Math.round(clamp(vel + delta, 1, 127));
      return next;
    }),
  );
}

// ─── Variation: density-up ────────────────────────────────────────────────────

/**
 * Density-Up: probabilistisch leere Steps aktivieren.
 * intensity=1.0 → ALLE leeren Steps werden aktiviert.
 * intensity=0.5 → ~50% der leeren Steps.
 *
 * Neu aktivierte Steps bekommen mittlere Velocity (60..100).
 */
export function increaseDensity(
  grid: StepData[][],
  intensity: number,
  seed?: number,
): StepData[][] {
  const i = clampIntensity(intensity);
  if (i === 0) return cloneGrid(grid);
  const rng = makeRng(seed);

  return grid.map((row) =>
    row.map((step) => {
      const next = cloneStep(step);
      if (next.active) return next;
      // intensity=1.0 → immer aktivieren (rng() < 1.0 ist meistens true,
      // aber wir brauchen DETERMINISTIC bei i=1 → guarantee aktivieren)
      const activate = i >= 1 ? true : rng() < i;
      if (activate) {
        next.active = true;
        next.velocity = Math.round(60 + rng() * 40); // 60..100
      }
      return next;
    }),
  );
}

// ─── Variation: density-down ──────────────────────────────────────────────────

/**
 * Density-Down: probabilistisch volle Steps deaktivieren.
 * intensity=1.0 → ALLE aktiven Steps werden geleert.
 * intensity=0.5 → ~50% der aktiven Steps.
 */
export function decreaseDensity(
  grid: StepData[][],
  intensity: number,
  seed?: number,
): StepData[][] {
  const i = clampIntensity(intensity);
  if (i === 0) return cloneGrid(grid);
  const rng = makeRng(seed);

  return grid.map((row) =>
    row.map((step) => {
      const next = cloneStep(step);
      if (!next.active) return next;
      const deactivate = i >= 1 ? true : rng() < i;
      if (deactivate) {
        next.active = false;
      }
      return next;
    }),
  );
}

// ─── Variation: shuffle-velocity ──────────────────────────────────────────────

/**
 * Velocity-Shuffle: permutiert die Velocities pro Part (row) bei unveränderter
 * Aktivierungsstruktur. Multiset der Velocities bleibt erhalten.
 *
 * Nur aktive Steps werden in die Shuffle-Sammlung aufgenommen.
 */
export function shuffleVelocity(
  grid: StepData[][],
  seed?: number,
): StepData[][] {
  const rng = makeRng(seed);

  return grid.map((row) => {
    // Sammle aktive Step-Indizes + ihre Velocities
    const activeIdx: number[] = [];
    const velocities: number[] = [];
    for (let s = 0; s < row.length; s++) {
      if (row[s].active) {
        activeIdx.push(s);
        velocities.push(defaultVelocity(row[s]));
      }
    }
    if (activeIdx.length < 2) return row.map(cloneStep);

    // Fisher-Yates Shuffle der Velocities
    const shuffled = [...velocities];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Re-apply
    const next = row.map(cloneStep);
    for (let i = 0; i < activeIdx.length; i++) {
      next[activeIdx[i]].velocity = shuffled[i];
    }
    return next;
  });
}

// ─── Variation: rhythmic-displacement ─────────────────────────────────────────

/**
 * Rhythmic Displacement: aktive Steps werden probabilistisch um ±1 Step
 * verschoben. Beibehaltung der Step-Anzahl pro Row.
 *
 * Wenn der Ziel-Step schon aktiv ist, bleibt der Source ebenfalls aktiv
 * (no-merge — Step verharrt). intensity steuert die Verschiebungs-
 * Wahrscheinlichkeit. Direction (links/rechts) ist 50/50.
 */
export function rhythmicDisplacement(
  grid: StepData[][],
  intensity: number,
  seed?: number,
): StepData[][] {
  const i = clampIntensity(intensity);
  if (i === 0) return cloneGrid(grid);
  const rng = makeRng(seed);

  return grid.map((row) => {
    const len = row.length;
    const out = row.map((s) => ({ ...cloneStep(s), active: false }));
    // Wenn Output noch leer, dann waren auch keine aktiven da
    // -- aber wir brauchen die Velocity/Pitch-Felder. Reset active=false und
    //    setzen sie unten wieder.

    for (let s = 0; s < len; s++) {
      const src = row[s];
      if (!src.active) continue;
      const shouldShift = rng() < i;
      let targetIdx = s;
      if (shouldShift) {
        const dir = rng() < 0.5 ? -1 : 1;
        const candidate = s + dir;
        // Bound-Check: nicht über Pattern-Grenzen schieben
        if (candidate >= 0 && candidate < len) {
          targetIdx = candidate;
        }
      }
      // Übertrage active + velocity an targetIdx
      out[targetIdx].active = true;
      out[targetIdx].velocity = src.velocity ?? 100;
      // Behalte pitch, probability etc. vom Source
      if (src.pitch !== undefined) out[targetIdx].pitch = src.pitch;
      if (src.probability !== undefined) out[targetIdx].probability = src.probability;
    }

    return out;
  });
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Wendet eine VariationConfig auf ein Grid an.
 * Pure Funktion — keine Mutation, kein Side-Effect.
 */
export function applyVariation(
  grid: StepData[][],
  config: VariationConfig,
): StepData[][] {
  switch (config.kind) {
    case "humanize":
      return humanize(grid, config.intensity, config.seed);
    case "ghost-notes":
      return addGhostNotes(grid, config.intensity, config.seed);
    case "fill-add":
      return addFill(grid);
    case "swing-vary":
      return varySwing(grid, config.intensity, config.seed);
    case "density-up":
      return increaseDensity(grid, config.intensity, config.seed);
    case "density-down":
      return decreaseDensity(grid, config.intensity, config.seed);
    case "shuffle-velocity":
      return shuffleVelocity(grid, config.seed);
    case "rhythmic-displacement":
      return rhythmicDisplacement(grid, config.intensity, config.seed);
    default: {
      // Exhaustive-Check
      const _exhaustive: never = config.kind;
      void _exhaustive;
      return cloneGrid(grid);
    }
  }
}

// ─── Grid-Conversion-Helpers ──────────────────────────────────────────────────

/**
 * Extrahiert das Step-Grid aus einer Parts-Liste (z.B. PatternData.parts).
 * Pure — kopiert nicht, gibt Referenzen weiter (Aufrufer behandelt Immutability).
 */
export function gridFromParts(
  parts: { steps: StepData[] }[],
): StepData[][] {
  return parts.map((p) => p.steps);
}

/**
 * Schreibt ein Grid zurück in eine Parts-Liste (Indizes 1:1).
 * Gibt eine NEUE Parts-Liste zurück (immutability erhalten).
 */
export function partsWithGrid<P extends { steps: StepData[] }>(
  parts: P[],
  grid: StepData[][],
): P[] {
  return parts.map((p, idx) => ({
    ...p,
    steps: grid[idx] ?? p.steps,
  }));
}
