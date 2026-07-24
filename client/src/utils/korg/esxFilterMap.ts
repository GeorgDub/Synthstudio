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
 * Baut aus einem ESX-Filter das ImportedFilter für einen Part.
 *
 * `enabled` nur, wenn der Filter hörbar etwas tut: LPF muss dann nicht offen
 * (cutoff 127) und ohne Resonanz sein; jeder Nicht-LPF-Typ oder Resonanz > 0
 * oder ein nicht voll geöffneter Cutoff aktiviert ihn. So bleibt ein neutraler
 * ESX-Part (LPF offen, Res 0) auch in Synthstudio transparent.
 */
export function esxFilterToImportedFilter(
  f: EsxPartFilter | undefined | null
): ImportedFilter | undefined {
  if (!f) return undefined;
  const type = esxFilterTypeToChannel(f.filterType);
  const freq = esxCutoffToHz(f.cutoff);
  const q = esxResonanceToQ(f.resonance);
  const isNeutralLowpass =
    type === "lowpass" && f.cutoff >= 127 && f.resonance <= 0;
  return { enabled: !isNeutralLowpass, type, freq, q };
}
