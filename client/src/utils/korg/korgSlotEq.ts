/**
 * korgSlotEq.ts — 3-Band-EQ direkt auf einem `.all`-Slot.
 *
 * `sampleEqualizer3Band.ts` lag als reiner Helfer mit Tests im Projekt, hatte
 * aber **keinen** UI-Consumer — der letzte offene Teil der Mastering-Kette im
 * Gerätepfad. Diese Datei schließt ihn: Slot-PCM (interleaved) rein,
 * Slot-PCM raus, plus benannte Voreinstellungen für die Fälle, die an der
 * Electribe wirklich vorkommen.
 *
 * Kein eigenes DSP. Die Biquads stehen im Helfer; hier stehen nur die
 * Einstellungen und die Formatbrücke.
 *
 * Warum Voreinstellungen und nicht nur Regler: der Nutzen am Gerät liegt fast
 * immer in denselben drei Griffen — Mumpf raus, Druck rein, Höhen auf. Regler
 * bleiben über `applyKorgEq` mit eigenen Bändern trotzdem möglich.
 */

import {
  applyEqualizer3Band,
  DEFAULT_HIGH_FREQ,
  DEFAULT_LOW_FREQ,
  DEFAULT_MID_FREQ,
  DEFAULT_Q,
  type Equalizer3BandOptions,
} from "../sampleEqualizer3Band";
import { bufferToInterleaved, interleavedToBuffer } from "./korgMatch";

export type KorgEqPresetId =
  | "mud-out"
  | "punch"
  | "air"
  | "phone"
  | "sub-cut";

export interface KorgEqPreset {
  id: KorgEqPresetId;
  name: string;
  description: string;
  bands: Equalizer3BandOptions;
}

/**
 * Die Frequenzen sind auf das Gerät hin gewählt, nicht auf ein Mischpult:
 * Samples landen mit 16 Bit und meist 44,1 kHz auf der Karte, und der
 * Klinkenausgang der Electribe hat unten wenig Reserve — deshalb liegen die
 * Eingriffe eher tief und breit als chirurgisch.
 */
export const KORG_EQ_PRESETS: readonly KorgEqPreset[] = [
  {
    id: "mud-out",
    name: "Mumpf raus",
    description:
      "Senkt den Bereich um 300 Hz, in dem sich mehrere Samples gegenseitig " +
      "zumatschen. Erster Griff, wenn ein Pattern dicht klingt, aber undeutlich.",
    bands: {
      low: { freq: DEFAULT_LOW_FREQ, gainDb: 0 },
      mid: { freq: 300, gainDb: -4.5, q: 0.9 },
      high: { freq: DEFAULT_HIGH_FREQ, gainDb: 0 },
    },
  },
  {
    id: "punch",
    name: "Druck",
    description:
      "Hebt den Bass-Bereich an und nimmt etwas Mitte weg — für Kicks, die im " +
      "Pattern untergehen.",
    bands: {
      low: { freq: 120, gainDb: 4 },
      mid: { freq: 700, gainDb: -2, q: 0.8 },
      high: { freq: DEFAULT_HIGH_FREQ, gainDb: 0 },
    },
  },
  {
    id: "air",
    name: "Höhen auf",
    description:
      "Öffnet die Höhen ab 6 kHz. Hilft Samples, die auf 22 kHz " +
      "heruntergerechnet wurden und dadurch dumpf wirken.",
    bands: {
      low: { freq: DEFAULT_LOW_FREQ, gainDb: 0 },
      mid: { freq: DEFAULT_MID_FREQ, gainDb: 0, q: DEFAULT_Q },
      high: { freq: 6000, gainDb: 4.5 },
    },
  },
  {
    id: "phone",
    name: "Telefon",
    description:
      "Bass und Höhen deutlich weg, Mitten betont — ein Effekt, kein " +
      "Aufräumen. Für Vocal-Schnipsel und Breaks.",
    bands: {
      low: { freq: 300, gainDb: -12 },
      mid: { freq: 1400, gainDb: 6, q: 1.2 },
      high: { freq: 4000, gainDb: -10 },
    },
  },
  {
    id: "sub-cut",
    name: "Sub weg",
    description:
      "Nimmt unter 80 Hz heraus. Spart Kopfraum, den die Electribe unten " +
      "ohnehin nicht wiedergibt — sinnvoll vor dem Lautmachen.",
    bands: {
      low: { freq: 80, gainDb: -12 },
      mid: { freq: DEFAULT_MID_FREQ, gainDb: 0, q: DEFAULT_Q },
      high: { freq: DEFAULT_HIGH_FREQ, gainDb: 0 },
    },
  },
];

export function korgEqPreset(id: KorgEqPresetId): KorgEqPreset {
  const p = KORG_EQ_PRESETS.find(x => x.id === id);
  if (!p) throw new RangeError(`Unbekanntes Korg-EQ-Preset: ${id}`);
  return p;
}

export interface KorgEqResult {
  /** Bearbeitetes PCM, interleaved wie die Eingabe. */
  pcm: Float32Array;
  /** Spitzenwert vor und nach dem Eingriff (linear). */
  peakBefore: number;
  peakAfter: number;
  /**
   * `true`, wenn der EQ den Pegel über die Vollaussteuerung gehoben hat.
   *
   * Das ist der Grund, warum diese Angabe existiert: eine Anhebung kann ein
   * Sample übersteuern, und die Electribe hat keinen Limiter. Der Aufrufer soll
   * danach „Korg Match" fahren können — hier wird bewusst NICHT automatisch
   * normalisiert, sonst wäre der EQ nicht mehr nachvollziehbar.
   */
  clipped: boolean;
}

function peakOf(pcm: Float32Array): number {
  let p = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > p) p = v;
  }
  return p;
}

/**
 * Wendet Bänder auf Slot-PCM an.
 *
 * Pure Funktion; die Eingabe bleibt unverändert. Leere Eingabe kommt unverändert
 * zurück.
 */
export function applyKorgEq(
  pcm: Float32Array,
  channels: 1 | 2,
  sampleRate: number,
  bands: Equalizer3BandOptions,
): KorgEqResult {
  const peakBefore = peakOf(pcm);
  if (pcm.length === 0) {
    return { pcm, peakBefore: 0, peakAfter: 0, clipped: false };
  }
  const out = bufferToInterleaved(
    applyEqualizer3Band(interleavedToBuffer(pcm, channels, sampleRate), bands),
  );
  const peakAfter = peakOf(out);
  return { pcm: out, peakBefore, peakAfter, clipped: peakAfter > 1 };
}

/** Kurzform mit einer Voreinstellung. */
export function applyKorgEqPreset(
  pcm: Float32Array,
  channels: 1 | 2,
  sampleRate: number,
  id: KorgEqPresetId,
): KorgEqResult {
  return applyKorgEq(pcm, channels, sampleRate, korgEqPreset(id).bands);
}

/** Ein Satz zum Ergebnis, inklusive Warnung bei Übersteuerung. */
export function describeKorgEq(id: KorgEqPresetId, res: KorgEqResult): string {
  const name = korgEqPreset(id).name;
  const db = (v: number) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : "-∞");
  const base = `${name}: Spitze ${db(res.peakBefore)} → ${db(res.peakAfter)} dBFS`;
  return res.clipped
    ? `${base} — über 0 dBFS! Mit „Korg Match" nachfahren, sonst übersteuert es am Gerät.`
    : base;
}
