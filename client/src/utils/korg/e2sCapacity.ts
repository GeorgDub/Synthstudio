/**
 * e2sCapacity.ts — „Passt diese Bank noch aufs Gerät?"
 *
 * Die Zahl dafür lag schon vor (`E2S_DEVICE_PCM_WARN_BYTES`, 24 MiB, empirisch
 * über 47 reale Bänke gestützt), aber der Builder gab seine Warnung nur an
 * `console.warn` weiter — wer eine zu große Bank exportierte, erfuhr es erst am
 * Gerät, wenn sie nicht lud. Diese Datei macht den Befund zu einem Wert, den die
 * Oberfläche **vor** dem Export anzeigen kann.
 *
 * Bewusst keine harte Grenze: die Entscheidung „warnen statt ablehnen" steht in
 * `constants.ts` bei `E2S_DEVICE_PCM_WARN_BYTES` und bleibt gültig. Eine
 * Absenkung würde Bänke zurückweisen, die sich bisher bauen ließen.
 *
 * Pure Funktionen, keine DOM-/Audio-Abhängigkeit — direkt unit-testbar.
 */

import { E2S_DEVICE_PCM_WARN_BYTES } from "./constants";

/** Ab diesem Anteil des Gerätelimits wird vorgewarnt (nicht erst beim Reißen). */
export const E2S_CAPACITY_TIGHT_RATIO = 0.9;

export type E2sCapacityLevel = "ok" | "tight" | "over";

export interface E2sCapacity {
  /** Belegte PCM-Bytes. */
  usedBytes: number;
  /** Gerätelimit, gegen das bewertet wird. */
  limitBytes: number;
  /** Anteil am Limit (1.0 == genau voll; kann > 1 sein). */
  ratio: number;
  /** Noch freie Bytes; 0 wenn das Limit überschritten ist. */
  freeBytes: number;
  level: E2sCapacityLevel;
}

/**
 * Bewertet die PCM-Gesamtgröße einer Bank gegen das Gerätelimit.
 *
 * `limitBytes` ist überschreibbar, damit Tests und ein etwaiges anderes Modell
 * (E2 ohne Sampler) nicht an der Konstante hängen.
 */
export function assessE2sCapacity(
  usedBytes: number,
  limitBytes: number = E2S_DEVICE_PCM_WARN_BYTES,
): E2sCapacity {
  const used = Number.isFinite(usedBytes) && usedBytes > 0 ? usedBytes : 0;
  // Ein Limit <= 0 wäre eine sinnlose Bewertung; dann gilt alles als "over",
  // sobald überhaupt Daten da sind — und eine leere Bank bleibt "ok".
  const limit = limitBytes > 0 ? limitBytes : 0;
  const ratio = limit > 0 ? used / limit : used > 0 ? Infinity : 0;

  let level: E2sCapacityLevel;
  if (ratio > 1) level = "over";
  else if (ratio >= E2S_CAPACITY_TIGHT_RATIO) level = "tight";
  else level = "ok";

  return {
    usedBytes: used,
    limitBytes: limit,
    ratio,
    freeBytes: Math.max(0, limit - used),
    level,
  };
}

/** MB mit einer Dezimalstelle — dieselbe Darstellung wie im Builder. */
function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Ein Satz, der sagt, was Sache ist — und bei Überschreitung auch, was zu tun
 * ist. Absichtlich kein reiner Zahlen-Dump: „26.0 / 24.0 MB" allein sagt einem
 * Nutzer nicht, dass das Gerät die Bank gar nicht erst lädt.
 */
export function describeE2sCapacity(cap: E2sCapacity): string {
  const used = mb(cap.usedBytes);
  const limit = mb(cap.limitBytes);
  switch (cap.level) {
    case "over":
      return (
        `${used} MB von ${limit} MB Gerätespeicher — zu groß. Die Electribe ` +
        `lädt diese Bank nicht. Samples entfernen, kürzen oder auf Mono ` +
        `bzw. eine niedrigere Rate bringen.`
      );
    case "tight":
      return `${used} MB von ${limit} MB Gerätespeicher — knapp (${Math.round(cap.ratio * 100)} %).`;
    default:
      return `${used} MB von ${limit} MB Gerätespeicher — ${mb(cap.freeBytes)} MB frei.`;
  }
}
