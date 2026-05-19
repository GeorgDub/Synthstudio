/**
 * patternSerializer.ts — v3.169.0
 * ------------------------------------------------------------------------
 * Pure-Helper: serialisiert ein PatternData zu einem kompakten Magic-Header-
 * JSON-String und parst es zurück.
 *
 * Verwendung: Clipboard-Copy-Paste, Share-via-URL-Hash, Pattern-Library-
 * Import/Export. KEIN React/DOM/Side-Effect — voll in Node testbar.
 *
 * Konventionen:
 *   - Magic-Header + schemaVersion erlauben spätere Format-Migrationen.
 *   - Pattern-ID wird beim Export GESTRIPPT. Import erzeugt keine ID (Caller
 *     setzt sie — z.B. via DrumMachine.addPatternData()).
 *   - parts[i].steps werden zu einem bitmask-String "1010..." komprimiert
 *     (ein char pro Step, "1" = active). Spart Speicher gegenüber JSON-Array
 *     mit `{active:true/false}`-Objekten.
 *   - velocities werden nur exportiert wenn mind. eine velocity vom Default
 *     (100) abweicht. Dann liegt ein paralleles number[] vor.
 *   - parsePattern: 100% defensive — jeder Fehler (JSON, magic, schemaVersion,
 *     missing fields, length mismatch, range violation) → null. KEIN throw.
 */

import type { PatternData } from "../audio/AudioEngine";

export const PATTERN_EXPORT_MAGIC = "synthstudio.pattern/v1";
export const PATTERN_EXPORT_SCHEMA_VERSION = 1;

const DEFAULT_VELOCITY = 100;
const MAX_STEP_COUNT = 1024;
const MIN_BPM = 1;
const MAX_BPM = 400;
const MIN_VELOCITY = 0;
const MAX_VELOCITY = 127;

export interface PatternExportEnvelope {
  magic: typeof PATTERN_EXPORT_MAGIC;
  schemaVersion: number;
  exportedAt: string;
  pattern: {
    name: string;
    stepCount: number;
    bpm: number | null;
    parts: Array<{
      id: string;
      name: string;
      /** Bitmask string, ein char pro Step: "1" = active, "0" = inactive. */
      stepBits: string;
      /** Optional: pro-Step velocity (0..127). Nur gesetzt wenn != Default. */
      velocities?: number[];
      muted: boolean;
      soloed: boolean;
      volume: number;
      pan: number;
    }>;
  };
}

export interface ParsedPattern {
  name: string;
  stepCount: number;
  bpm: number | null;
  parts: Array<{
    name: string;
    muted: boolean;
    soloed: boolean;
    volume: number;
    pan: number;
    steps: Array<{ active: boolean; velocity?: number }>;
  }>;
}

// ─── serializePattern ──────────────────────────────────────────────────────

export function serializePattern(pattern: PatternData): string {
  const parts = pattern.parts.map((p) => {
    const stepBits = p.steps.map((s) => (s.active ? "1" : "0")).join("");

    // Velocities nur exportieren wenn mind. eine vom Default abweicht.
    const effectiveVels = p.steps.map((s) =>
      typeof s.velocity === "number" && Number.isFinite(s.velocity)
        ? s.velocity
        : DEFAULT_VELOCITY,
    );
    const hasNonDefaultVel = effectiveVels.some((v) => v !== DEFAULT_VELOCITY);

    const partOut: PatternExportEnvelope["pattern"]["parts"][number] = {
      id: p.id,
      name: p.name,
      stepBits,
      muted: !!p.muted,
      soloed: !!p.soloed,
      volume: typeof p.volume === "number" ? p.volume : 1,
      pan: typeof p.pan === "number" ? p.pan : 0,
    };
    if (hasNonDefaultVel) {
      partOut.velocities = effectiveVels;
    }
    return partOut;
  });

  const envelope: PatternExportEnvelope = {
    magic: PATTERN_EXPORT_MAGIC,
    schemaVersion: PATTERN_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    pattern: {
      name: pattern.name,
      stepCount: pattern.stepCount,
      bpm: pattern.bpm === null || pattern.bpm === undefined ? null : pattern.bpm,
      parts,
    },
  };

  return JSON.stringify(envelope, null, 2);
}

// ─── parsePattern ──────────────────────────────────────────────────────────

const STEP_BITS_RE = /^[01]+$/;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function parsePattern(json: string): ParsedPattern | null {
  try {
    if (typeof json !== "string" || json.length === 0) return null;

    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;

    if (parsed.magic !== PATTERN_EXPORT_MAGIC) return null;
    if (parsed.schemaVersion !== PATTERN_EXPORT_SCHEMA_VERSION) return null;

    const p = parsed.pattern;
    if (!p || typeof p !== "object") return null;

    if (typeof p.name !== "string" || p.name.length === 0) return null;

    if (!isFiniteNumber(p.stepCount)) return null;
    if (p.stepCount <= 0 || p.stepCount >= MAX_STEP_COUNT) return null;
    const stepCount = Math.floor(p.stepCount);

    // bpm: null erlaubt, sonst finite 1..400
    let bpm: number | null;
    if (p.bpm === null || p.bpm === undefined) {
      bpm = null;
    } else if (isFiniteNumber(p.bpm) && p.bpm >= MIN_BPM && p.bpm <= MAX_BPM) {
      bpm = p.bpm;
    } else {
      return null;
    }

    if (!Array.isArray(p.parts)) return null;

    const outParts: ParsedPattern["parts"] = [];
    for (const part of p.parts) {
      if (!part || typeof part !== "object") return null;
      if (typeof part.name !== "string") return null;
      if (typeof part.stepBits !== "string") return null;
      if (!STEP_BITS_RE.test(part.stepBits)) return null;
      if (part.stepBits.length !== stepCount) return null;

      // velocities optional
      let velocities: number[] | undefined;
      if (part.velocities !== undefined) {
        if (!Array.isArray(part.velocities)) return null;
        if (part.velocities.length !== stepCount) return null;
        for (const v of part.velocities) {
          if (!isFiniteNumber(v)) return null;
          if (v < MIN_VELOCITY || v > MAX_VELOCITY) return null;
        }
        velocities = part.velocities as number[];
      }

      const steps: ParsedPattern["parts"][number]["steps"] = [];
      for (let i = 0; i < stepCount; i++) {
        const active = part.stepBits.charAt(i) === "1";
        const step: { active: boolean; velocity?: number } = { active };
        if (velocities) {
          step.velocity = velocities[i];
        }
        steps.push(step);
      }

      outParts.push({
        name: part.name,
        muted: typeof part.muted === "boolean" ? part.muted : false,
        soloed: typeof part.soloed === "boolean" ? part.soloed : false,
        volume: isFiniteNumber(part.volume) ? part.volume : 1,
        pan: isFiniteNumber(part.pan) ? part.pan : 0,
        steps,
      });
    }

    return {
      name: p.name,
      stepCount,
      bpm,
      parts: outParts,
    };
  } catch {
    return null;
  }
}

// ─── defaultPatternFilename ────────────────────────────────────────────────

export function defaultPatternFilename(patternName: string): string {
  const raw = typeof patternName === "string" ? patternName : "";
  const safe = raw.replace(/[^a-z0-9\-_]+/gi, "-").slice(0, 64);
  const finalName = safe.length > 0 ? safe : "pattern";
  return `${finalName}.synth-pattern.json`;
}
