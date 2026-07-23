/**
 * editImportedPattern.ts — pure Edit-Helper für die editierbare ESX-Import-
 * Vorschau (v3.285).
 *
 * Der Import-Dialog hält ein `ImportResult` als editierbaren Zustand: der User
 * kann VOR dem Laden/Exportieren einzelne Steps togglen, ganze Parts leeren/
 * füllen. Alle Helper sind PURE (kopieren, mutieren nie) und damit isoliert
 * testbar — die React-Komponente ruft sie nur auf und setzt das Ergebnis in
 * ihren State.
 */
import type { ImportResult, ImportedStep } from "./types";

/** Tiefe (aber schlanke) Kopie eines Steps mit optionalem active-Override. */
function cloneStep(step: ImportedStep, active?: boolean): ImportedStep {
  return {
    active: active ?? step.active,
    velocity: step.velocity,
    pitch: step.pitch,
  };
}

/**
 * Toggelt einen einzelnen Step (active-Flag) in
 * `result.patterns[patternIdx].parts[partIdx].steps[stepIdx]`.
 * Out-of-range Indizes → unverändertes (identisches) Result zurück.
 * Ansonsten frisches Result (nur der betroffene Pfad wird neu erzeugt).
 */
export function toggleImportedStep(
  result: ImportResult,
  patternIdx: number,
  partIdx: number,
  stepIdx: number
): ImportResult {
  const pattern = result.patterns[patternIdx];
  if (!pattern) return result;
  const part = pattern.parts[partIdx];
  if (!part) return result;
  const step = part.steps[stepIdx];
  if (!step) return result;

  const newSteps = part.steps.map((s, i) =>
    i === stepIdx ? cloneStep(s, !s.active) : s
  );
  return replacePartSteps(result, patternIdx, partIdx, newSteps);
}

/**
 * Setzt einen Step explizit auf active/inactive (idempotent). Nützlich für
 * Drag-Painting (überstreichen setzt alle auf denselben Wert).
 */
export function setImportedStepActive(
  result: ImportResult,
  patternIdx: number,
  partIdx: number,
  stepIdx: number,
  active: boolean
): ImportResult {
  const pattern = result.patterns[patternIdx];
  if (!pattern) return result;
  const part = pattern.parts[partIdx];
  if (!part) return result;
  const step = part.steps[stepIdx];
  if (!step || step.active === active) return result;

  const newSteps = part.steps.map((s, i) =>
    i === stepIdx ? cloneStep(s, active) : s
  );
  return replacePartSteps(result, patternIdx, partIdx, newSteps);
}

/** Leert alle Steps eines Parts (setzt active=false). */
export function clearImportedPart(
  result: ImportResult,
  patternIdx: number,
  partIdx: number
): ImportResult {
  const part = result.patterns[patternIdx]?.parts[partIdx];
  if (!part) return result;
  const newSteps = part.steps.map(s => cloneStep(s, false));
  return replacePartSteps(result, patternIdx, partIdx, newSteps);
}

/** Zählt die aktiven Steps über alle Parts eines Patterns (für UI-Badges). */
export function countActiveSteps(
  result: ImportResult,
  patternIdx: number
): number {
  const pattern = result.patterns[patternIdx];
  if (!pattern) return 0;
  let n = 0;
  for (const part of pattern.parts) {
    for (const s of part.steps) if (s.active) n++;
  }
  return n;
}

// ─── intern ──────────────────────────────────────────────────────────────────

/** Erzeugt ein frisches Result mit ersetzten Steps eines Parts (immutable). */
function replacePartSteps(
  result: ImportResult,
  patternIdx: number,
  partIdx: number,
  newSteps: ImportedStep[]
): ImportResult {
  const patterns = result.patterns.map((p, pi) => {
    if (pi !== patternIdx) return p;
    return {
      ...p,
      parts: p.parts.map((pt, pti) =>
        pti === partIdx ? { ...pt, steps: newSteps } : pt
      ),
    };
  });
  return { ...result, patterns };
}
