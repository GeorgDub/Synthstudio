/**
 * esxFilterMap.ts — mappt die (verifizierten) ESX-1 Per-Part Filter-Werte auf
 * Synthstudios ChannelFx-Filter, damit „Filter & Effekte" beim Import direkt auf
 * die Parts angewandt werden (v3.293).
 *
 * Rein (kein DOM) → in Node testbar.
 *
 * Wertebereich: die ESX-Filterfelder sind rohe 0..127-Gerätewerte (Byte-Breite
 * gegen open-electribe-editor v1.2.0 verifiziert; die 0..127-Semantik stammt aus
 * Korgs MIDI-Impl). Das Mapping auf Hz/Q ist eine musikalische Transformation
 * (kein bit-exakter Format-Anspruch):
 *   - cutoff 0..127 → 20..20000 Hz, exponentiell (127 = voll offen).
 *   - resonance 0..127 → Q 0.1..12, linear.
 *   - filterType 0=LPF,1=HPF,2=BPF,3=BPF+ → lowpass/highpass/bandpass/bandpass.
 */

import type { EsxPartFilter } from "./esxParser";

export type ChannelFilterType = "lowpass" | "highpass" | "bandpass" | "notch";

export interface ImportedFilter {
  enabled: boolean;
  type: ChannelFilterType;
  freq: number; // Hz, 20..20000
  q: number; // 0.1..12
}

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const Q_MIN = 0.1;
const Q_MAX = 12;

/** ESX FilterType-Enum → Synthstudio-Filtertyp. */
export function esxFilterTypeToChannel(t: number): ChannelFilterType {
  switch (t & 0x03) {
    case 1:
      return "highpass";
    case 2:
      return "bandpass";
    case 3:
      return "bandpass"; // BPF+ = Bandpass-Variante
    case 0:
    default:
      return "lowpass";
  }
}

/** cutoff 0..127 → 20..20000 Hz (exponentiell). */
export function esxCutoffToHz(cutoff: number): number {
  const c = Math.max(0, Math.min(127, cutoff)) / 127;
  const hz = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, c);
  return Math.round(Math.max(FREQ_MIN, Math.min(FREQ_MAX, hz)));
}

/** resonance 0..127 → Q 0.1..12 (linear). */
export function esxResonanceToQ(res: number): number {
  const r = Math.max(0, Math.min(127, res)) / 127;
  return Math.round((Q_MIN + r * (Q_MAX - Q_MIN)) * 100) / 100;
}

/**
 * Baut aus einem ESX-Filter das ImportedFilter für einen Part — ODER undefined,
 * wenn der Filter nicht SICHER anwendbar ist (dann bleibt der Part-Filter aus).
 *
 * WARUM konservativ (v3.294, nach Bug-Report „überall Bandpass 20000"):
 * Reale ESX-Patterns tragen sehr häufig Tiefpass voll offen (cutoff 127) ODER
 * Bandpass/BPF+ — und ein Web-Audio-Bandpass mit ESX-Cutoff als Center würde bei
 * hohem Cutoff das Signal quasi stumm schalten (nur ~20 kHz durchlassen). Das ist
 * musikalisch destruktiv und war die Ursache des Bugs. Deshalb wird NUR das
 * angewandt, was eindeutig und gefahrlos abbildbar ist:
 *   - Tiefpass (LPF): nur wenn NICHT voll offen (cutoff < 127) → verdunkelt, nie stumm.
 *   - Hochpass (HPF): nur wenn NICHT voll offen (cutoff > 0) → dünnt aus, nie stumm.
 *   - Bandpass/BPF+ (2/3): NICHT auto-angewandt (Center-Mapping unverifiziert,
 *     Stumm-Gefahr) → undefined; der Part spielt normal, kein Fehl-Filter.
 * So bleibt der Import hilfreich (echte LPF/HPF-Sweeps kommen mit), macht aber
 * nie einen Part kaputt.
 */
const LPF_FULLY_OPEN = 127;
const HPF_FULLY_OPEN = 0;

export function esxFilterToImportedFilter(
  f: EsxPartFilter | undefined | null
): ImportedFilter | undefined {
  if (!f) return undefined;
  const type = esxFilterTypeToChannel(f.filterType);
  const freq = esxCutoffToHz(f.cutoff);
  const q = esxResonanceToQ(f.resonance);

  if (type === "lowpass") {
    if (f.cutoff >= LPF_FULLY_OPEN) return undefined; // offen → aus
    return { enabled: true, type, freq, q };
  }
  if (type === "highpass") {
    if (f.cutoff <= HPF_FULLY_OPEN) return undefined; // offen → aus
    return { enabled: true, type, freq, q };
  }
  // bandpass / BPF+ → nicht auto-anwenden (Stumm-Gefahr, unverifiziertes Center).
  return undefined;
}
