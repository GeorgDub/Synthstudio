/**
 * client/src/utils/drumPatternMutator.ts (v3.164)
 *
 * Pure-Helpers für Drum-Pattern-Mutationen:
 * shift / double-time / half-time / invert / reverse / mirror.
 *
 * Alle Funktionen sind seiteneffekt-frei, geben NEUE Arrays zurück,
 * lassen den Input unverändert. Werden für Pattern-Tools (UI-Buttons,
 * Script-Commands, MIDI-Bindings) genutzt — kein Store-Zugriff.
 */

// ─── shiftPattern ────────────────────────────────────────────────────────────

/**
 * Verschiebt ein Pattern um N Steps. Wraps modulo length.
 *
 * shift > 0 → nach rechts (letzte Elemente wandern an den Anfang).
 *   [T,F,F,F] shift=1 → [F,T,F,F]
 * shift < 0 → nach links (erste Elemente wandern ans Ende).
 *   [T,F,F,F] shift=-1 → [F,F,F,T]
 * shift = 0 → identische Kopie.
 *
 * Wraps: shift % length wird normalisiert. Bei leerem Input → [].
 */
export function shiftPattern(
  pattern: readonly boolean[],
  shift: number,
): boolean[] {
  const n = pattern.length;
  if (n === 0) return [];

  // Normalize: modulo, aber positiv (JS' % kann negativ bleiben).
  // Ziel: out[i] = pattern[(i - shift) mod n] für shift>0 (Rechts-Shift).
  const offset = ((shift % n) + n) % n;
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = (i - offset + n) % n;
    out[i] = pattern[src];
  }
  return out;
}

// ─── doubleTimePattern ───────────────────────────────────────────────────────

/**
 * Double-Time via "stretch-pair":
 * Erste Hälfte des Patterns wird Paar-weise gedoppelt und füllt die
 * gesamte Länge. Output hat dieselbe Länge wie Input.
 *
 *   [T,F,T,F] (4) → [T,T,F,F] (4)
 *     in[0]=T → out[0]=out[1]=T
 *     in[1]=F → out[2]=out[3]=F
 *
 * Bei odd length: letzter Step wird truncated/leer-aufgefüllt mit false.
 * Single [T] → [T] (length=1, kein Pairing möglich).
 * Empty → [].
 */
export function doubleTimePattern(pattern: readonly boolean[]): boolean[] {
  const n = pattern.length;
  if (n === 0) return [];
  if (n === 1) return [pattern[0]];

  const half = Math.floor(n / 2);
  const out: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < half; i++) {
    const v = pattern[i];
    out[i * 2] = v;
    if (i * 2 + 1 < n) out[i * 2 + 1] = v;
  }
  return out;
}

// ─── halfTimePattern ─────────────────────────────────────────────────────────

/**
 * Half-Time via Dezimation: jeder 2. Step (Index 0,2,4,…).
 *   [T,F,T,F,T,F] (6) → [T,T,T] (3)
 *
 * Output-Länge = floor(n/2). Empty → [].
 * Bei n=1: floor(1/2)=0 → []. Bei n=2: [pattern[0]].
 */
export function halfTimePattern(pattern: readonly boolean[]): boolean[] {
  const n = pattern.length;
  if (n < 2) return [];
  const half = Math.floor(n / 2);
  const out: boolean[] = new Array(half);
  for (let i = 0; i < half; i++) {
    out[i] = pattern[i * 2];
  }
  return out;
}

// ─── invertPattern ───────────────────────────────────────────────────────────

/**
 * Flippt jeden Step: true ↔ false. Länge bleibt gleich.
 *   [T,F,T] → [F,T,F]
 * Empty → [].
 */
export function invertPattern(pattern: readonly boolean[]): boolean[] {
  const out: boolean[] = new Array(pattern.length);
  for (let i = 0; i < pattern.length; i++) {
    out[i] = !pattern[i];
  }
  return out;
}

// ─── reversePattern ──────────────────────────────────────────────────────────

/**
 * Kehrt das Pattern um. [T,F,F,T] → [T,F,F,T] (Palindrom).
 *   [T,F,F] → [F,F,T]
 * Empty → []. Single → unverändert (neues Array).
 */
export function reversePattern(pattern: readonly boolean[]): boolean[] {
  const n = pattern.length;
  const out: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = pattern[n - 1 - i];
  }
  return out;
}

// ─── mirrorPattern ───────────────────────────────────────────────────────────

/**
 * Konkateniert pattern + reverse(pattern). Verdoppelt die Länge.
 *   [T,F] → [T,F,F,T]
 *   [T]   → [T,T]
 * Empty → [].
 */
export function mirrorPattern(pattern: readonly boolean[]): boolean[] {
  const n = pattern.length;
  if (n === 0) return [];
  const out: boolean[] = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i] = pattern[i];
    out[n + i] = pattern[n - 1 - i];
  }
  return out;
}
