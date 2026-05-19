/**
 * Synthstudio – autoMixSuggestions.ts  (v3.122.0)
 *
 * Pure-Helpers fuer "Smart Auto-Mix": LUFS-driven Gain-Staging-Suggestions.
 *
 * Idee:
 *   1. Pro Channel definiert der User ein Target-LUFS (z.B. Kick -10, Snare -12).
 *   2. Wahrend Playback misst die Engine integrated-LUFS pro Channel.
 *   3. Der Pure-Helper `computeSuggestion` vergleicht measured vs target und
 *      schlaegt eine Gain-Anpassung (in dB) vor:
 *          suggestedGainDb = targetLufs - measuredLufs
 *      Sicherheits-Clamp auf [-MAX_GAIN_ADJUST_DB, +MAX_GAIN_ADJUST_DB].
 *   4. UI zeigt Per-Channel-Diff, User reviewt + applied selektiv.
 *
 * Alle Funktionen sind pure (kein State, keine I/O), deterministisch und
 * side-effect-frei — leicht testbar in Node ohne AudioContext.
 *
 * Conventions:
 *   - Volume-Skala intern: lineare Mixer-Gain 0..1 (wie useDrumMachineStore /
 *     useSubMixStore). Die Suggestion-API arbeitet aber in **dB** (User-mental-
 *     model: "+2 dB / -3 dB"). Helpers `volumeLinearToDb` / `volumeDbToLinear`
 *     uebersetzen.
 *   - 0 dB Referenz: lineare-Volume = 1.0.
 *   - Silent / -Infinity measured → keine sinnvolle Suggestion → 0 dB Vorschlag.
 */

/**
 * Maximale absolute Gain-Anpassung in dB. Schuetzt vor extremen
 * Vorschlaegen wenn measured-LUFS = -infinity (Silence) oder weit unter
 * Target (z.B. -60 LUFS bei target -10 wuerde +50 dB vorschlagen — viel zu
 * gefaehrlich).
 *
 * +24 / -24 dB ist ein typischer Mixer-Fader-Range. Beyond muss der User
 * manuell entscheiden.
 */
export const MAX_GAIN_ADJUST_DB = 24;

/** Minimum measured LUFS damit eine Suggestion sinnvoll ist. */
export const MIN_MEASURED_LUFS = -70;

/**
 * v3.122.0: Ein einzelner Suggestion-Eintrag pro Channel.
 *
 *   channelId       — Part-/Channel-ID
 *   currentVolumeDb — aktuelle Mixer-Volume in dB (User-Convenience-Display)
 *   measuredLufs    — gemessener integrated-LUFS (channel-summed)
 *   targetLufs      — User-Target (z.B. -10 fuer Kick)
 *   suggestedGainDb — Delta in dB (positiv = lauter machen, negativ = leiser)
 *                     clamped auf [-MAX_GAIN_ADJUST_DB, +MAX_GAIN_ADJUST_DB]
 *
 * Bei measured = -Infinity / NaN / < MIN_MEASURED_LUFS: suggestedGainDb = 0
 * (Silence / sub-gate — keine Aussage moeglich).
 */
export interface MixSuggestion {
  channelId:       string;
  currentVolumeDb: number;
  measuredLufs:    number;
  targetLufs:      number;
  suggestedGainDb: number;
}

/**
 * Lineare Mixer-Volume → dB.
 *
 *   volumeLinearToDb(1.0)  =   0 dB
 *   volumeLinearToDb(0.5)  ≈  -6 dB
 *   volumeLinearToDb(0)    = -Infinity (Silence)
 *
 * Defensive: NaN / negativ → -Infinity.
 */
export function volumeLinearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

/**
 * dB → Lineare Mixer-Volume.
 *
 *   volumeDbToLinear(0)        = 1.0
 *   volumeDbToLinear(-6)       ≈ 0.501
 *   volumeDbToLinear(-Infinity)= 0
 *
 * Defensive: NaN → 1.0 (sicherer Fallback).
 */
export function volumeDbToLinear(db: number): number {
  if (db === -Infinity) return 0;
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

/**
 * Clamp einen Gain-Delta auf den Safety-Range [-MAX, +MAX].
 *
 * Erhaelt das Vorzeichen, kuerzt nur Magnitude. Bei NaN / non-finite → 0.
 */
export function clampGainSuggestion(
  gainDb:   number,
  maxAbsDb: number = MAX_GAIN_ADJUST_DB,
): number {
  if (!Number.isFinite(gainDb)) return 0;
  if (gainDb >  maxAbsDb) return  maxAbsDb;
  if (gainDb < -maxAbsDb) return -maxAbsDb;
  return gainDb;
}

/**
 * Hauptfunktion: berechnet die Gain-Anpassung fuer einen Channel.
 *
 * Formel:
 *   suggestedGainDb = targetLufs - measuredLufs   (linear in der dB-Domain,
 *                                                    weil LUFS auch in dB ist)
 *
 * Beispiele:
 *   target=-10, measured=-7   →   -3 dB (zu laut, runterdrehen)
 *   target=-10, measured=-14  →   +4 dB (zu leise, aufdrehen)
 *   target=-10, measured=-Inf →    0   (silence — keine Aussage)
 *
 * Pre-Conditions:
 *   - measured < MIN_MEASURED_LUFS  → suggestedGainDb = 0 (sub-absolute-gate)
 *   - measured nicht-finit          → suggestedGainDb = 0
 *   - target  nicht-finit           → suggestedGainDb = 0 (defensive)
 *
 * Side-Effect-frei.
 */
export function computeSuggestion(
  channelId:       string,
  currentVolumeDb: number,
  measuredLufs:    number,
  targetLufs:      number,
): MixSuggestion {
  // Defensive: invalid measured / target.
  const measuredValid =
    Number.isFinite(measuredLufs) && measuredLufs >= MIN_MEASURED_LUFS;
  const targetValid = Number.isFinite(targetLufs);

  let suggested = 0;
  if (measuredValid && targetValid) {
    suggested = clampGainSuggestion(targetLufs - measuredLufs);
  }

  return {
    channelId,
    currentVolumeDb,
    measuredLufs,
    targetLufs,
    suggestedGainDb: suggested,
  };
}

/**
 * Wendet einen Satz Suggestions auf die aktuellen Channel-Volumes an.
 *
 * Inputs:
 *   - `suggestions`: die berechneten MixSuggestion-Eintraege
 *   - `applyMap`:    Map<channelId, boolean> — nur Channels mit `true` werden
 *                    angewandt. Channels die nicht in `applyMap` sind, gelten
 *                    als nicht-zu-applizieren (default-off).
 *
 * Output: Liste von `{ channelId, newVolDb }`-Eintraegen — der Caller setzt
 * den Mixer-Volume dann selbst (entweder als dB-Eintrag oder via
 * `volumeDbToLinear(newVolDb)` als linearer Wert).
 *
 * Wenn ein Channel in `applyMap` true ist, der suggestedGainDb aber 0
 * (z.B. silent / sub-gate), bleibt newVolDb == currentVolumeDb. Wir geben
 * den Eintrag trotzdem zurueck damit das UI sehen kann "wurde durchlaufen".
 *
 * Side-Effect-frei.
 */
export function applySuggestions(
  suggestions: readonly MixSuggestion[],
  applyMap:    ReadonlyMap<string, boolean>,
): Array<{ channelId: string; newVolDb: number }> {
  const out: Array<{ channelId: string; newVolDb: number }> = [];
  for (const s of suggestions) {
    if (applyMap.get(s.channelId) !== true) continue;
    const newVolDb = s.currentVolumeDb + s.suggestedGainDb;
    out.push({ channelId: s.channelId, newVolDb });
  }
  return out;
}
