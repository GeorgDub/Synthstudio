/**
 * e2FilterMap.ts — mappt die verifizierten E2/E2S Per-Part-Filterwerte auf
 * Synthstudios ChannelFx-Filter (v3.296), analog zum ESX-Pendant esxFilterMap.
 *
 * Filtertyp-Tabelle (raw 0..16) FÜNFFACH verifiziert: Korg electribe Parameter
 * Guide ("Filter Type List"), Korg MIDI Implementation Rev 1.00 (TABLE 6,
 * Offset 12 = 0x0C, Range 0..16), keijiro/e2edit (StringTable.asset, 17
 * Einträge), rafamj/elecmidi (tables.h filterTypeTable) und die E2S-Firmware-
 * Strings (omnitribe strings_e2s.txt). Aufbau: 0=OFF, 1..6=LPF-Varianten
 * (electribe/MS20/MG/P5/OB/Acid), 7..11=HPF-Varianten (kein MG-HPF),
 * 12..16=BPF-Varianten.
 *
 * Hinweis Sampler: die Stock-E2S-UI bietet nur electribe LPF/HPF/BPF an, die
 * Byte-Kodierung ist aber identisch zum Synth (hacktribe schaltet die Modell-
 * Filter frei) — für den Import ist nur die LPF/HPF/BPF-Klasse relevant.
 *
 * Mapping-Regeln wie beim ESX-Safe-Fix (v3.294): nur anwenden, was nie stumm
 * schaltet — LPF nur wenn nicht voll offen, HPF nur wenn nicht voll offen,
 * BPF/OFF → kein Auto-Filter (Center-Mapping unverifiziert, Stumm-Gefahr).
 */

import {
  esxCutoffToHz,
  esxResonanceToQ,
  type ImportedFilter,
} from "./esxFilterMap";

/** Verifizierte Anzeigenamen, Index == raw Filter-Type-Byte (0..16). */
export const E2_FILTER_TYPE_NAMES: readonly string[] = [
  "Off",
  "electribe LPF",
  "MS20 LPF",
  "MG LPF",
  "P5 LPF",
  "OB LPF",
  "Acid LPF",
  "electribe HPF",
  "MS20 HPF",
  "P5 HPF",
  "OB HPF",
  "Acid HPF",
  "electribe BPF",
  "MS20 BPF",
  "P5 BPF",
  "OB BPF",
  "Acid BPF",
] as const;

export type E2FilterClass = "off" | "lowpass" | "highpass" | "bandpass";

/** Klassifiziert das rohe Filter-Type-Byte (0..16) in die WebAudio-Klasse. */
export function e2FilterClass(rawType: number): E2FilterClass {
  if (rawType >= 1 && rawType <= 6) return "lowpass";
  if (rawType >= 7 && rawType <= 11) return "highpass";
  if (rawType >= 12 && rawType <= 16) return "bandpass";
  return "off"; // 0 sowie out-of-range defensiv als OFF
}

const LPF_FULLY_OPEN = 127;
const HPF_FULLY_OPEN = 0;

/**
 * Baut aus den dekodierten E2-Part-Filterwerten das ImportedFilter — oder
 * undefined, wenn kein Filter sicher anwendbar ist (OFF, offen, oder BPF).
 * Cutoff/Resonance nutzen dieselbe 0..127→Hz/Q-Transformation wie der ESX-
 * Import (esxCutoffToHz exponentiell, esxResonanceToQ linear).
 */
export function e2FilterToImportedFilter(
  rawType: number,
  cutoff: number,
  resonance: number
): ImportedFilter | undefined {
  const cls = e2FilterClass(rawType);
  if (cls === "off" || cls === "bandpass") return undefined;
  if (cls === "lowpass" && cutoff >= LPF_FULLY_OPEN) return undefined;
  if (cls === "highpass" && cutoff <= HPF_FULLY_OPEN) return undefined;
  return {
    enabled: true,
    type: cls,
    freq: esxCutoffToHz(cutoff),
    q: esxResonanceToQ(resonance),
  };
}
