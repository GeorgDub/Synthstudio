/**
 * korgMatch.ts — Ein-Klick-Profile, die ein Sample gerätetauglich machen.
 *
 * Die Electribe hat weder Mastering noch Limiter: was auf die SD-Karte kommt,
 * kommt genauso aus dem Ausgang. Wer ein leises Sample lauter dreht, clippt
 * digital; wer ein rumpelndes lädt, hört das Rumpeln im ganzen Pattern.
 *
 * Alle Bausteine dafür lagen im Projekt bereits vor — nur app-weit im
 * SampleBrowser, nicht im Gerätepfad, und einzeln zu bedienen. Diese Datei
 * bündelt sie zu drei Profilen und ist damit **reine Komposition**: kein
 * eigenes DSP, keine neue Mathematik.
 *
 * Reihenfolge der Kette ist bewusst gewählt und nicht beliebig:
 *   1. Cleanup (DC-Offset, Rumpeln)  — zuerst, sonst verstärkt jeder weitere
 *      Schritt den Gleichanteil mit.
 *   2. Kompressor                    — arbeitet auf dem Rohpegel; nach dem
 *      Normalisieren würde er anders greifen als sein Preset erwartet.
 *   3. Saturation                    — Charakter, nachdem die Dynamik sitzt.
 *   4. Normalisieren auf Ziel-Peak   — legt den Endpegel fest.
 *   5. Safety-Limiter (harte Grenze) — letzte Instanz gegen Überschreitungen,
 *      die Schritt 3 und 4 einzeln nicht sehen.
 *
 * Der Safety-Limiter ist der Grund, warum das ein Profil und keine Checkliste
 * ist: er muss **nach** allem anderen laufen, und genau das vergisst man, wenn
 * man die Schritte manuell zusammenklickt.
 */

import type { AudioBufferLike } from "../sampleEmbedding";
import { applyCompressor, type CompressorOptions } from "../sampleCompressor";
import { applySaturator, type SaturatorOptions } from "../sampleSaturator";
import { autoNormalizeSample } from "../sampleAutoNormalize";
import { cleanupSample, type CleanupOptions } from "../sampleCleanup";

/** Kennung eines Profils. */
export type KorgMatchId = "clean" | "loud" | "hardtekk";

export interface KorgMatchProfile {
  id: KorgMatchId;
  name: string;
  /** Ein Satz, der sagt, wofür das Profil gedacht ist. */
  description: string;
  /** `null` = kein Cleanup-Schritt. */
  cleanup: CleanupOptions | null;
  /** `null` = kein Kompressor. */
  compressor: CompressorOptions | null;
  /** `null` = keine Saturation. */
  saturator: SaturatorOptions | null;
  /** Ziel-Spitzenpegel in dBTP nach dem Normalisieren. */
  targetDbTp: number;
  /**
   * Harte Obergrenze als linearer Betrag (1.0 == 0 dBFS).
   *
   * Knapp unter 1.0, weil die Umrechnung nach 16-Bit-Ganzzahl beim Schreiben
   * der `.all` rundet — bei exakt 1.0 kippt das gerundete Maximum über und
   * erzeugt genau den Knack, den der Limiter verhindern soll.
   */
  ceiling: number;
}

/** −1 dBTP als linearer Wert, die Hausvorgabe für Endpegel. */
const CEILING_MINUS_1DB = 0.891;
/** −0.3 dBTP — für laute Profile, die den Kopfraum ausnutzen sollen. */
const CEILING_MINUS_03DB = 0.966;

export const KORG_MATCH_PROFILES: readonly KorgMatchProfile[] = [
  {
    id: "clean",
    name: "Clean",
    description:
      "Aufräumen ohne Klangeingriff: Gleichanteil und Rumpeln raus, Pegel auf " +
      "−1 dBTP. Für Samples, die schon klingen wie gewollt.",
    // Nur die beiden Eingriffe, die man nie bereut: DC-Offset ist immer ein
    // Fehler, und unter 25 Hz gibt die Electribe ohnehin nichts wieder.
    cleanup: { removeDcOffset: true, highPassHz: 25, noiseReduction: 0 },
    compressor: null,
    saturator: null,
    targetDbTp: -1.0,
    ceiling: CEILING_MINUS_1DB,
  },
  {
    id: "loud",
    name: "Loud",
    description:
      "Dichter und lauter, ohne den Charakter zu verbiegen: sanfte Kompression, " +
      "Pegel auf −0.3 dBTP. Für Drums und Loops, die im Pattern durchkommen müssen.",
    cleanup: { removeDcOffset: true, highPassHz: 30, noiseReduction: 0 },
    // Weiches Knie und moderates Verhältnis — hörbar dichter, aber nicht
    // gepumpt. Make-up bleibt bei 0, weil danach normalisiert wird; alles
    // andere wäre doppelt.
    compressor: {
      thresholdDb: -16,
      ratio: 3,
      attackMs: 8,
      releaseMs: 120,
      kneeDb: 6,
      makeupGainDb: 0,
    },
    saturator: null,
    targetDbTp: -0.3,
    ceiling: CEILING_MINUS_03DB,
  },
  {
    id: "hardtekk",
    name: "Hardtekk",
    description:
      "Kick-Charakter: kurze Attack, harte Kompression, Röhren-Saturation, " +
      "Pegel bis knapp unter Vollausschlag. Für Kicks und Leads im harten Genre.",
    cleanup: { removeDcOffset: true, highPassHz: 25, noiseReduction: 0 },
    // Schnelles Zupacken mit hohem Verhältnis und hartem Knie — genau das
    // Verhalten, das einer Kick den Druck gibt.
    compressor: {
      thresholdDb: -12,
      ratio: 8,
      attackMs: 1,
      releaseMs: 60,
      kneeDb: 0,
      makeupGainDb: 0,
    },
    // `tube` statt `tanh`: asymmetrische Kennlinie, erzeugt geradzahlige
    // Obertöne und damit den wahrgenommenen "Bauch".
    saturator: { type: "tube", drive: 2.2, outputGain: 0.85 },
    targetDbTp: -0.3,
    ceiling: CEILING_MINUS_03DB,
  },
];

export function korgMatchProfile(id: KorgMatchId): KorgMatchProfile {
  const p = KORG_MATCH_PROFILES.find(x => x.id === id);
  if (!p) throw new RangeError(`Unbekanntes Korg-Match-Profil: ${id}`);
  return p;
}

export interface KorgMatchResult {
  buffer: AudioBufferLike;
  /** Welche Schritte tatsächlich gelaufen sind — für eine ehrliche Rückmeldung. */
  steps: string[];
  /** Verstärkung des Normalisier-Schritts in dB. */
  gainAppliedDb: number;
  /** Spitzenwert vor der Kette (linear). */
  peakBefore: number;
  /** Spitzenwert nach der Kette (linear). */
  peakAfter: number;
  /** Zahl der Samples, die der Safety-Limiter zurückgeholt hat. */
  limitedSamples: number;
}

function peakOfBuffer(buffer: AudioBufferLike): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * Harte Begrenzung auf `ceiling`.
 *
 * Bewusst kein Look-ahead-Limiter: an dieser Stelle geht es nicht um Klang,
 * sondern darum, dass beim Schreiben der `.all` nichts überläuft. Ein
 * Überschreiten kommt nach dem Normalisieren nur noch in einzelnen Spitzen vor
 * — dort ist Clipping auf den Zielwert unhörbar, ein Pegel über 0 dBFS aber
 * garantiert nicht.
 */
function applyCeiling(
  buffer: AudioBufferLike,
  ceiling: number,
): { buffer: AudioBufferLike; limited: number } {
  const channels: Float32Array[] = [];
  let limited = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      if (v > ceiling) {
        out[i] = ceiling;
        limited++;
      } else if (v < -ceiling) {
        out[i] = -ceiling;
        limited++;
      } else {
        out[i] = v;
      }
    }
    channels.push(out);
  }
  return {
    buffer: {
      sampleRate: buffer.sampleRate,
      numberOfChannels: buffer.numberOfChannels,
      length: buffer.length,
      getChannelData: (i: number) => channels[i],
    },
    limited,
  };
}

/**
 * Brücke zum `.all`-Slot-Format: dort liegt PCM **interleaved** in einem
 * einzigen `Float32Array` (siehe `stereoToMonoE2s`), die Kette arbeitet aber
 * kanalweise. Beide Richtungen hier, damit der Aufrufer nicht selbst
 * umsortieren muss — genau dabei entstehen Kanalvertauschungen.
 */
export function interleavedToBuffer(
  pcm: Float32Array,
  channels: 1 | 2,
  sampleRate: number,
): AudioBufferLike {
  if (channels === 1) {
    return {
      sampleRate,
      numberOfChannels: 1,
      length: pcm.length,
      getChannelData: () => pcm,
    };
  }
  const frames = Math.floor(pcm.length / 2);
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    l[i] = pcm[i * 2];
    r[i] = pcm[i * 2 + 1];
  }
  return {
    sampleRate,
    numberOfChannels: 2,
    length: frames,
    getChannelData: (i: number) => (i === 0 ? l : r),
  };
}

/** Gegenstück zu {@link interleavedToBuffer}. */
export function bufferToInterleaved(buffer: AudioBufferLike): Float32Array {
  if (buffer.numberOfChannels <= 1) {
    return Float32Array.from(buffer.getChannelData(0));
  }
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  const frames = Math.min(l.length, r.length);
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    out[i * 2] = l[i];
    out[i * 2 + 1] = r[i];
  }
  return out;
}

/**
 * Fährt ein Sample durch das gewählte Profil.
 *
 * Pure Funktion: der Eingabepuffer wird nicht verändert, jeder Schritt gibt
 * einen neuen zurück. Leere oder stille Puffer laufen unverändert durch —
 * ein stilles Sample zu „normalisieren" würde nur Rauschen hochziehen (das
 * fängt bereits `autoNormalizeSample` über seine Silence-Erkennung ab, hier
 * wird es zusätzlich sichtbar gemacht).
 */
export function applyKorgMatch(
  buffer: AudioBufferLike,
  id: KorgMatchId,
): KorgMatchResult {
  const profile = korgMatchProfile(id);
  const steps: string[] = [];

  if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
    return {
      buffer,
      steps: ["übersprungen: leerer Puffer"],
      gainAppliedDb: 0,
      peakBefore: 0,
      peakAfter: 0,
      limitedSamples: 0,
    };
  }

  const peakBefore = peakOfBuffer(buffer);
  let current = buffer;

  if (profile.cleanup) {
    // cleanupSample arbeitet pro Kanal auf Float32Array, nicht auf Buffern.
    // Die Optionen werden VOLLSTAENDIG gesetzt und nicht mit CLEANUP_DEFAULTS
    // gemischt: dessen normalizePeak/fadeMs wuerden hier doppelt wirken, weil
    // Schritt 4 den Endpegel setzt.
    const channels: Float32Array[] = [];
    let dcMax = 0;
    for (let c = 0; c < current.numberOfChannels; c++) {
      const res = cleanupSample(current.getChannelData(c), current.sampleRate, {
        ...profile.cleanup,
      });
      channels.push(res.pcm);
      dcMax = Math.max(dcMax, Math.abs(res.report.dcOffset));
    }
    current = {
      sampleRate: current.sampleRate,
      numberOfChannels: current.numberOfChannels,
      length: channels[0]?.length ?? 0,
      getChannelData: (i: number) => channels[i],
    };
    steps.push(
      `Cleanup (DC ${(dcMax * 100).toFixed(2)} %, Hochpass ${profile.cleanup.highPassHz} Hz)`,
    );
  }

  if (profile.compressor) {
    current = applyCompressor(current, profile.compressor);
    steps.push(
      `Kompressor (${profile.compressor.ratio}:1 ab ${profile.compressor.thresholdDb} dB)`,
    );
  }

  if (profile.saturator) {
    current = applySaturator(current, profile.saturator);
    steps.push(`Saturation (${profile.saturator.type}, Drive ${profile.saturator.drive})`);
  }

  const norm = autoNormalizeSample(current, { targetDbTp: profile.targetDbTp });
  current = norm.buffer;
  steps.push(
    norm.originalAnalysis.isSilence
      ? "Normalisieren übersprungen (stilles Sample)"
      : `Normalisiert auf ${profile.targetDbTp} dBTP (${norm.gainAppliedDb >= 0 ? "+" : ""}${norm.gainAppliedDb.toFixed(1)} dB)`,
  );

  const limited = applyCeiling(current, profile.ceiling);
  current = limited.buffer;
  if (limited.limited > 0) {
    steps.push(`Safety-Limiter: ${limited.limited} Spitze(n) begrenzt`);
  }

  return {
    buffer: current,
    steps,
    gainAppliedDb: norm.gainAppliedDb,
    peakBefore,
    peakAfter: peakOfBuffer(current),
    limitedSamples: limited.limited,
  };
}
