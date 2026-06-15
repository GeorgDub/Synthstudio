/**
 * Synthstudio – Mod-Source-Math (TASK-257-FOLLOWUP-3)
 *
 * Reine, deterministische Auswertung der NICHT-LFO-Modulationsquellen
 * (Macro + Envelope). KEINE Web-Audio-Abhängigkeit, KEIN Lesen von Wall-Clock
 * intern — `elapsedSec` bzw. der aktuelle Macro-Wert werden übergeben, damit die
 * Funktionen in Node/Vitest ohne AudioContext/rAF testbar sind.
 *
 * Diese Datei ist bewusst getrennt von `lfo.ts` (das absichtlich KEINE
 * Store-Typen importiert, siehe dortiger Header-Kommentar) — `EnvConfig` lebt
 * hier, damit useLfoModStore + Engine-Seam dieselbe Definition teilen, ohne
 * einen Zyklus lfo.ts ↔ useLfoModStore zu erzeugen.
 *
 * Beide Quellen liefern letztlich einen "Modulator-Wert", der an
 * `applyBipolarMod` (lfo.ts) weitergereicht wird — also additiv um den
 * Basiswert herum, geklemmt in den Ziel-Range. Anders als `mapMacroValue`
 * (useMacroStore) ist das KEIN absolutes min..max-Mapping.
 */

/**
 * Einfaches frei laufendes (zyklisches) Hüllkurven-Modell. Bewusst KEIN
 * note-on/note-off-Trigger — der Mod-Seam in App.tsx ist frei laufend nach
 * Wall-Clock und hat keine Note-Events. Stattdessen läuft die Hüllkurve als
 * geloopter ADSR-Zyklus: Attack → Decay → Sustain (hält bis `loopSec`) →
 * Release → wieder von vorn. So bleibt env symmetrisch zum LFO (zeitbasiert,
 * deterministisch, ohne externe Trigger).
 *
 * Alle Zeiten in Sekunden, >= 0. Sustain-Level 0..1.
 */
export interface EnvConfig {
  /** Anstiegszeit 0 → 1 (Sekunden). */
  attack: number;
  /** Abfallzeit 1 → sustain (Sekunden). */
  decay: number;
  /** Halte-Level 0..1. */
  sustain: number;
  /** Abfallzeit sustain → 0 (Sekunden). */
  release: number;
  /**
   * Gesamtdauer eines Zyklus in Sekunden. Die Hüllkurve durchläuft
   * Attack+Decay+Release; die verbleibende Zeit bis `loopSec` ist die
   * Sustain-Halte-Phase. Wird `loopSec` < (attack+decay+release) gewählt, gibt
   * es keine Sustain-Phase und der Release startet ggf. früher (geklemmt).
   */
  loopSec: number;
}

/** Klemmt x in [0,1]. */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Mappt einen unipolaren Macro-Wert (0..1) auf einen Modulator-Wert für
 * `applyBipolarMod`.
 *
 * Semantik (a, bewusst gewählt): Pass-Through. macro=0 → 0 (Basiswert
 * unverändert), macro=1 → +1 (volle Auslenkung in Amount-Richtung). Einseitig
 * — ein Macro ist intuitiv ein "von 0 hochdrehen"-Regler, kein bipolarer LFO.
 * `applyBipolarMod` klemmt ohnehin in [-1,1], damit ist [0,1] gültig.
 *
 * (Die Richtung/Invertierung steuert weiterhin `route.amount` ∈ [-1,+1].)
 */
export function macroToModValue(macroValue: number): number {
  return clamp01(macroValue);
}

/**
 * Wertet die zyklische Hüllkurve zu einem Zeitpunkt aus → Level in [0,1].
 *
 * Phasen innerhalb eines Zyklus (Periode = max(loopSec, attack+decay+release)):
 *   [0, A)            : Attack   linear 0 → 1
 *   [A, A+D)          : Decay    linear 1 → sustain
 *   [A+D, relStart)   : Sustain  konstant = sustain
 *   [relStart, period): Release  linear sustain → 0
 * wobei relStart = period - release.
 *
 * Negative/nicht-finite Zeiten werden defensiv behandelt; degenerierte
 * Phasen (Dauer 0) werden übersprungen, sodass nie durch 0 geteilt wird.
 */
export function evaluateEnv(env: EnvConfig, elapsedSec: number): number {
  const a = Math.max(0, Number.isFinite(env.attack) ? env.attack : 0);
  const d = Math.max(0, Number.isFinite(env.decay) ? env.decay : 0);
  const r = Math.max(0, Number.isFinite(env.release) ? env.release : 0);
  const s = clamp01(env.sustain);

  // Periode: mindestens so lang wie A+D+R, sonst loopSec.
  const minPeriod = a + d + r;
  const period = Math.max(minPeriod, Number.isFinite(env.loopSec) ? env.loopSec : 0);
  if (period <= 0) {
    // Alles 0 → keine Bewegung.
    return 0;
  }

  const elapsed = Number.isFinite(elapsedSec) ? elapsedSec : 0;
  // In [0, period) wickeln (auch für negative Eingaben korrekt).
  let t = elapsed % period;
  if (t < 0) t += period;

  const relStart = period - r;

  // Attack 0 → 1
  if (t < a) {
    return a > 0 ? t / a : 1;
  }
  // Decay 1 → sustain
  if (t < a + d) {
    if (d <= 0) return s;
    const k = (t - a) / d;
    return 1 + (s - 1) * k;
  }
  // Sustain konstant
  if (t < relStart) {
    return s;
  }
  // Release sustain → 0
  if (r <= 0) return 0;
  const k = (t - relStart) / r;
  return s * (1 - k);
}

/** Sinnvolle Default-Hüllkurve für eine neue env-Route (hörbar, mittellanger Loop). */
export function defaultEnvConfig(): EnvConfig {
  return { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3, loopSec: 2 };
}
