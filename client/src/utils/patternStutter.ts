/**
 * Synthstudio – patternStutter.ts (v3.184.0)
 *
 * Pure-Helper für Pattern-Stutter / Beat-Repeat-Effekt auf boolean-Step-Arrays.
 *
 * Idee:
 *   Wiederhole den ersten N-Step-Block (ab startIndex) über den Rest des
 *   Patterns. Klassischer DJ-Live-Effekt ("Beat-Repeat") als Pattern-
 *   Programming-Tool.
 *
 * Public API:
 *   - applyStutter(pattern, options) → boolean[]
 *   - applyHalfStutter(pattern, stutterCount?) → boolean[]
 *   - STUTTER_PRESETS — UI-Hilfsliste
 *
 * Pure & Node-testbar.
 *
 * Tests: tests/features/pattern-stutter.test.ts
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StutterOptions {
  /** Anzahl Steps die wiederholt werden (von Index 0). Default = pattern.length / 4. */
  stutterCount?: number;
  /** Start-Position des Stutters (Index ab dem wiederholt wird). Default 0. */
  startIndex?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Standard-Stutter-Counts für 16-step patterns. Für UI-Buttons / Dropdowns.
 */
export const STUTTER_PRESETS: readonly { count: number; label: string }[] = [
  { count: 1, label: "1-Step (Roll)" },
  { count: 2, label: "2-Step" },
  { count: 4, label: "4-Step" },
  { count: 8, label: "8-Step (Half)" },
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Stuttert ein Pattern. Liefert immer ein neues Array (immutable).
 *
 * Verhalten:
 *  - Sammle "Stutter-Block" = pattern.slice(startIndex, startIndex + stutterCount)
 *  - Ersetze alle Steps ab startIndex mit Wiederholungen dieses Blocks
 *  - Steps vor startIndex bleiben unverändert
 *
 * Defensive Defaults:
 *  - stutterCount NaN/<1 → floor(length / 4), mindestens 1
 *  - stutterCount > length → length (no-op, identische Kopie)
 *  - startIndex NaN/<0 → 0
 *  - startIndex >= length → identische Kopie
 *  - empty input → []
 */
export function applyStutter(
  pattern: readonly boolean[],
  options: StutterOptions = {},
): boolean[] {
  if (!pattern || pattern.length === 0) return [];

  const length = pattern.length;

  // ── Normalize startIndex ──────────────────────────────────────────────────
  let startIndex = options.startIndex;
  if (!Number.isFinite(startIndex as number) || (startIndex as number) < 0) {
    startIndex = 0;
  }
  startIndex = Math.floor(startIndex as number);

  // startIndex jenseits des Patterns → identische Kopie
  if (startIndex >= length) {
    return pattern.slice();
  }

  // ── Normalize stutterCount ────────────────────────────────────────────────
  let stutterCount = options.stutterCount;
  if (!Number.isFinite(stutterCount as number) || (stutterCount as number) < 1) {
    // Default: length / 4, mindestens 1 (gegen i % 0 = NaN)
    stutterCount = Math.max(1, Math.floor(length / 4));
  } else {
    stutterCount = Math.floor(stutterCount as number);
  }

  // stutterCount größer als das Pattern → identische Kopie (kein Stutter-Effekt)
  if (stutterCount > length) {
    return pattern.slice();
  }

  // ── Build output ──────────────────────────────────────────────────────────
  const output: boolean[] = new Array(length);

  // Pre-stutter region: unverändert übernehmen
  for (let i = 0; i < startIndex; i++) {
    output[i] = pattern[i];
  }

  // Stutter region: wiederhole Block von [startIndex, startIndex+stutterCount)
  // Sicherheits-Kappung: falls startIndex+stutterCount > length, ist der Block
  // automatisch durch das Modulo nur partiell — pattern[startIndex+k] mit
  // k < stutterCount kann undefined sein. Daher cappen wir den effektiven
  // Block auf das Verfügbare.
  const effectiveBlockSize = Math.min(stutterCount, length - startIndex);

  for (let i = startIndex; i < length; i++) {
    const offset = (i - startIndex) % effectiveBlockSize;
    output[i] = pattern[startIndex + offset];
  }

  return output;
}

/**
 * Convenience: stuttert nur die zweite Hälfte (klassischer Live-Effekt).
 * Setzt automatisch startIndex = floor(length / 2).
 *
 * Default stutterCount: max(2, floor(length / 8)).
 */
export function applyHalfStutter(
  pattern: readonly boolean[],
  stutterCount?: number,
): boolean[] {
  if (!pattern || pattern.length === 0) return [];
  const startIndex = Math.floor(pattern.length / 2);
  const count =
    Number.isFinite(stutterCount as number) && (stutterCount as number) >= 1
      ? Math.floor(stutterCount as number)
      : Math.max(2, Math.floor(pattern.length / 8));
  return applyStutter(pattern, { startIndex, stutterCount: count });
}
