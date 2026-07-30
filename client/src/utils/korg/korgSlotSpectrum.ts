/**
 * korgSlotSpectrum.ts — Klangprofil eines `.all`-Slots in sieben Bändern.
 *
 * `sampleSpectrumPeak.ts` (Goertzel über sieben feste Frequenzen) lag mit
 * Tests im Projekt, hatte aber keinen UI-Consumer. Hier bekommt es einen —
 * und zwar an der Stelle, wo es am meisten nützt: neben den EQ-Knöpfen. Wer
 * sieht, dass die Energie bei 200 Hz sitzt, weiß, dass „Mumpf raus" der
 * richtige Griff ist, statt zu raten.
 *
 * Die Empfehlung ist ausdrücklich ein **Hinweis**, kein Urteil: sie schaut auf
 * grobe Verhältnisse zwischen den Bändern, nicht auf musikalischen Kontext.
 * Deshalb liefert sie auch immer eine Begründung mit — eine Empfehlung ohne
 * Grund wäre nicht überprüfbar.
 *
 * Rein & seiteneffektfrei.
 */

import {
  DEFAULT_FREQS_TO_TEST,
  findPeakFrequencies,
  type PeakFrequency,
} from "../sampleSpectrumPeak";
import { interleavedToBuffer } from "./korgMatch";
import type { KorgEqPresetId } from "./korgSlotEq";

export interface SlotSpectrumBand {
  frequencyHz: number;
  /** Rohe Amplitude aus der Goertzel-Auswertung. */
  amplitude: number;
  /** Anteil am stärksten Band, 0..1 — das ist der anzeigbare Wert. */
  relative: number;
  /** Kurzname für die Anzeige. */
  label: string;
}

export interface SlotSpectrumHint {
  preset: KorgEqPresetId;
  /** Warum — damit die Empfehlung nachvollziehbar bleibt. */
  reason: string;
}

export interface SlotSpectrum {
  bands: SlotSpectrumBand[];
  /** Band mit der meisten Energie; `null` bei Stille. */
  dominant: SlotSpectrumBand | null;
  /** Höchstens ein Hinweis; `null`, wenn nichts auffällt. */
  hint: SlotSpectrumHint | null;
}

/** Sprechende Kürzel für die sieben Standard-Bänder. */
const BAND_LABELS: Record<number, string> = {
  60: "Sub",
  100: "Bass",
  200: "Tief-Mitte",
  440: "Mitte",
  880: "Ob. Mitte",
  1760: "Präsenz",
  3520: "Höhen",
};

function labelFor(hz: number): string {
  return BAND_LABELS[hz] ?? `${hz} Hz`;
}

function amplitudeAt(peaks: PeakFrequency[], hz: number): number {
  return peaks.find(p => p.frequencyHz === hz)?.amplitude ?? 0;
}

/**
 * Leitet höchstens einen Hinweis aus den Verhältnissen ab.
 *
 * Die Schwellen sind bewusst großzügig: ein Hinweis, der bei jedem zweiten
 * Sample erscheint, wird ignoriert und ist damit wertlos. Reihenfolge = Rang;
 * es wird der erste passende Fall gemeldet, nicht alle.
 */
function deriveHint(bands: SlotSpectrumBand[]): SlotSpectrumHint | null {
  const rel = (hz: number) => bands.find(b => b.frequencyHz === hz)?.relative ?? 0;
  const sub = rel(60);
  const lowMid = rel(200);
  const air = rel(3520);
  const presence = rel(1760);

  // Viel Sub bei gleichzeitig wenig Oberton-Anteil: das ist Energie, die die
  // Electribe unten ohnehin kaum wiedergibt, aber Kopfraum kostet.
  if (sub > 0.85 && air < 0.15 && presence < 0.25) {
    return {
      preset: "sub-cut",
      reason: "sehr viel Energie unter 100 Hz, kaum Obertöne — kostet Kopfraum",
    };
  }
  // Tief-Mitte dominiert deutlich: der klassische Matsch-Bereich.
  if (lowMid > 0.8 && lowMid > sub && air < 0.3) {
    return {
      preset: "mud-out",
      reason: "Schwerpunkt bei 200 Hz — der Bereich, in dem Samples sich zumatschen",
    };
  }
  // Oben fehlt fast alles: typisch für heruntergerechnetes Material.
  if (air < 0.08 && presence < 0.2) {
    return {
      preset: "air",
      reason: "kaum Anteil über 1,7 kHz — klingt dumpf, typisch nach Ratenreduktion",
    };
  }
  return null;
}

/**
 * Wertet Slot-PCM aus. Erwartet das interleavte Format des Bank-Editors.
 *
 * Bei Stille (alle Bänder ~0) sind `dominant` und `hint` `null` — eine
 * Empfehlung auf Grundlage von Rauschen wäre schlimmer als keine.
 */
export function analyzeSlotSpectrum(
  pcm: Float32Array,
  channels: 1 | 2,
  sampleRate: number,
): SlotSpectrum {
  if (pcm.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { bands: [], dominant: null, hint: null };
  }

  const peaks = findPeakFrequencies(interleavedToBuffer(pcm, channels, sampleRate));
  if (peaks.length === 0) {
    return { bands: [], dominant: null, hint: null };
  }

  const max = peaks.reduce((m, p) => Math.max(m, p.amplitude), 0);
  const bands: SlotSpectrumBand[] = DEFAULT_FREQS_TO_TEST.map(hz => {
    const amplitude = amplitudeAt(peaks, hz);
    return {
      frequencyHz: hz,
      amplitude,
      relative: max > 0 ? amplitude / max : 0,
      label: labelFor(hz),
    };
  });

  // Schwelle gegen Rauschen: unterhalb dessen ist „das lauteste Band" beliebig.
  const SILENCE = 1e-6;
  if (max < SILENCE) {
    return { bands, dominant: null, hint: null };
  }

  const dominant = bands.reduce((a, b) => (b.amplitude > a.amplitude ? b : a));
  return { bands, dominant, hint: deriveHint(bands) };
}

/** Ein Satz zum Profil — nennt das stärkste Band und ggf. den Hinweis. */
export function describeSlotSpectrum(spec: SlotSpectrum): string {
  if (!spec.dominant) return "Klangprofil: zu leise für eine Auswertung";
  const base = `Schwerpunkt: ${spec.dominant.label} (${spec.dominant.frequencyHz} Hz)`;
  return spec.hint ? `${base} — ${spec.hint.reason}` : base;
}
