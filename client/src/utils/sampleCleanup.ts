/**
 * sampleCleanup.ts — v3.300.0
 *
 * Aufbereitung eines Roh-Samples VOR dem Slicen: Gleichspannung raus, Rumpeln
 * und Zischen weg, Rauschteppich absenken, Pegel geradeziehen, Stille an den
 * Rändern abschneiden, Kanten mit Mikro-Fades entschärfen.
 *
 * Das Modul erfindet keine DSP neu — die Bausteine liegen längst im Repo
 * (`sampleHighPass`, `sampleLowPass`, `sampleNoiseReduction`, `sampleNoiseGate`).
 * Was fehlte, war die *Verkettung* in einer festen, sinnvollen Reihenfolge und
 * auf dem Datentyp, mit dem der Slicer arbeitet: einer flachen `Float32Array`
 * plus Sample-Rate.
 *
 * ## Warum diese Reihenfolge
 *
 * Sie ist nicht beliebig — jeder Schritt räumt dem nächsten den Weg frei:
 *
 * 1. **DC-Offset** zuerst. Ein Gleichanteil verschiebt die Nulllinie; danach
 *    misst jede Pegel-Erkennung (Gate, Trim, Normalisierung) falsch, und der
 *    Zero-Crossing-Snap des Slicers findet keine sauberen Nulldurchgänge.
 * 2. **Hochpass** vor allem anderen Pegelkram: Rumpeln unter ~30 Hz ist oft
 *    lauter als das Nutzsignal und würde die Normalisierung dominieren.
 * 3. **Tiefpass** gegen Zischen/Aliasing.
 * 4. **Noise-Reduction** (spektrale Absenkung) — braucht ein möglichst
 *    sauberes Rausch-Profil am Anfang, deshalb VOR dem Trimmen der Stille:
 *    genau die vordere Stille IST das Profil.
 * 5. **Noise-Gate** danach; es schneidet Reste unterhalb der Schwelle weg.
 * 6. **Normalisieren** erst jetzt, wenn nur noch Nutzsignal übrig ist.
 * 7. **Trim** der Ränder — nach dem Normalisieren, sonst hinge die Schwelle
 *    am ursprünglichen Pegel.
 * 8. **Fades** ganz zuletzt, auf die endgültigen Ränder.
 *
 * Alle Schritte sind einzeln abschaltbar; `cleanupSample` mit leeren Optionen
 * ist eine reine Kopie.
 */

import type { AudioBufferLike } from "./sampleEmbedding";
import { applyHighPass } from "./sampleHighPass";
import { applyLowPass } from "./sampleLowPass";
import { reduceNoise } from "./sampleNoiseReduction";
import { applyNoiseGate } from "./sampleNoiseGate";

// ─── Optionen ────────────────────────────────────────────────────────────────

export interface CleanupOptions {
  /** Gleichanteil entfernen (Mittelwert abziehen). */
  removeDcOffset?: boolean;
  /** Hochpass-Grenzfrequenz in Hz. 0/undefined = aus. */
  highPassHz?: number;
  /** Tiefpass-Grenzfrequenz in Hz. 0/undefined = aus. */
  lowPassHz?: number;
  /** Rauschminderung 0..1 (0 = aus). */
  noiseReduction?: number;
  /** Noise-Gate-Schwelle in dBFS. undefined = aus. */
  gateThresholdDb?: number;
  /** Auf diesen Spitzenpegel normalisieren (0..1). undefined = aus. */
  normalizePeak?: number;
  /** Stille an den Rändern abschneiden, Schwelle in dBFS. undefined = aus. */
  trimSilenceDb?: number;
  /** Ein-/Ausblende-Länge in Millisekunden. 0/undefined = aus. */
  fadeMs?: number;
}

export interface CleanupReport {
  /** Frames vor der Bearbeitung. */
  framesBefore: number;
  /** Frames danach (kleiner, wenn getrimmt wurde). */
  framesAfter: number;
  /** Abgeschnittene Frames am Anfang. */
  trimmedStart: number;
  /** Abgeschnittene Frames am Ende. */
  trimmedEnd: number;
  /** Entfernter Gleichanteil (0, wenn der Schritt aus war). */
  dcOffset: number;
  /** Spitzenpegel vor der Bearbeitung. */
  peakBefore: number;
  /** Spitzenpegel danach. */
  peakAfter: number;
  /** Angewandte Schritte, in Reihenfolge — für die UI-Rückmeldung. */
  applied: string[];
}

export interface CleanupResult {
  pcm: Float32Array;
  report: CleanupReport;
}

/**
 * Voreinstellung: nur das, was praktisch immer richtig ist. Kein Gate, keine
 * Rauschminderung — beide können Material beschädigen und gehören dem Nutzer
 * in die Hand, nicht in einen Default.
 */
export const CLEANUP_DEFAULTS: Readonly<CleanupOptions> = Object.freeze({
  removeDcOffset: true,
  highPassHz: 30,
  normalizePeak: 0.95,
  fadeMs: 2,
});

/** Fertige Ausgangspunkte für die UI. */
export const CLEANUP_PRESETS: readonly { id: string; name: string; options: CleanupOptions }[] = [
  { id: "none", name: "Aus", options: {} },
  { id: "default", name: "Standard", options: { ...CLEANUP_DEFAULTS } },
  {
    id: "field",
    name: "Field-Recording",
    // Aufnahmen aus der Hand: viel Rumpeln, hörbarer Rauschteppich, Stille davor.
    options: {
      removeDcOffset: true,
      highPassHz: 80,
      noiseReduction: 0.5,
      gateThresholdDb: -45,
      normalizePeak: 0.95,
      trimSilenceDb: -50,
      fadeMs: 3,
    },
  },
  {
    id: "drums",
    name: "Drum-Loop",
    // Transienten unangetastet lassen: kein Gate (frisst Ausklänge), kurzer Fade.
    options: {
      removeDcOffset: true,
      highPassHz: 25,
      normalizePeak: 0.98,
      trimSilenceDb: -60,
      fadeMs: 1,
    },
  },
  {
    id: "vinyl",
    name: "Vinyl / Tape",
    options: {
      removeDcOffset: true,
      highPassHz: 40,
      lowPassHz: 16000,
      noiseReduction: 0.35,
      normalizePeak: 0.95,
      fadeMs: 4,
    },
  },
];

// ─── Einzelschritte (rein, auf Float32Array) ─────────────────────────────────

/** Mittelwert eines Signals — der Gleichanteil. */
export function computeDcOffset(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i];
  const mean = sum / pcm.length;
  return Number.isFinite(mean) ? mean : 0;
}

/** Zieht den Gleichanteil ab. Gibt eine neue Array zurück. */
export function removeDcOffset(pcm: Float32Array): { pcm: Float32Array; offset: number } {
  const offset = computeDcOffset(pcm);
  if (offset === 0) return { pcm: pcm.slice(), offset: 0 };
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] - offset;
  return { pcm: out, offset };
}

/** Höchster Absolutwert. */
export function peakOf(pcm: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

/**
 * Skaliert auf den Ziel-Spitzenpegel. Ein stilles Signal bleibt still —
 * es hochzuziehen würde nur den Rauschteppich verstärken.
 */
export function normalizePeak(pcm: Float32Array, target = 0.95): Float32Array {
  const peak = peakOf(pcm);
  if (peak <= 0) return pcm.slice();
  const gain = target / peak;
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] * gain;
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  return out;
}

/**
 * Findet die Grenzen des Nutzsignals: erster und letzter Frame über der
 * Schwelle. Gibt `null` zurück, wenn ALLES unter der Schwelle liegt — dann
 * darf der Aufrufer nicht trimmen, sonst bliebe ein leeres Sample übrig.
 */
export function findContentBounds(
  pcm: Float32Array,
  thresholdDb: number,
): { start: number; end: number } | null {
  const threshold = Math.pow(10, thresholdDb / 20);
  let start = -1;
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) > threshold) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = pcm.length;
  for (let i = pcm.length - 1; i >= start; i--) {
    if (Math.abs(pcm[i]) > threshold) {
      end = i + 1;
      break;
    }
  }
  return { start, end };
}

/** Blendet linear ein und aus. Bei zu kurzem Signal wird die Länge gekappt. */
export function applyEdgeFades(
  pcm: Float32Array,
  sampleRate: number,
  fadeMs: number,
): Float32Array {
  const out = pcm.slice();
  if (fadeMs <= 0 || out.length === 0) return out;
  // Nie mehr als die halbe Länge pro Seite — sonst überlappen sich die Fades
  // und das Sample wird in der Mitte leiser als an den Rändern.
  const maxFade = Math.floor(out.length / 2);
  const n = Math.min(maxFade, Math.round((fadeMs * sampleRate) / 1000));
  if (n <= 0) return out;
  for (let i = 0; i < n; i++) {
    const g = i / n;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

// ─── Brücke zu den AudioBufferLike-Bausteinen ────────────────────────────────

function toBufferLike(pcm: Float32Array, sampleRate: number): AudioBufferLike {
  return {
    sampleRate,
    numberOfChannels: 1,
    length: pcm.length,
    getChannelData: () => pcm,
  };
}

/**
 * Holt Kanal 0 als EIGENE Array heraus. Die Kopie ist Absicht, nicht Zufall:
 * die Bausteine geben teils ihren internen Puffer zurueck, und ein spaeterer
 * In-Place-Schritt wuerde dann in fremde Daten schreiben.
 */
function fromBufferLike(buf: AudioBufferLike): Float32Array {
  if (buf.length === 0 || buf.numberOfChannels === 0) return new Float32Array(0);
  const src = buf.getChannelData(0);
  const out = new Float32Array(src.length);
  out.set(src);
  return out;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Führt die aktivierten Schritte in fester Reihenfolge aus (siehe Modulkopf)
 * und meldet, was tatsächlich passiert ist.
 *
 * Rein: die Eingabe wird nie verändert.
 */
export function cleanupSample(
  pcm: Float32Array,
  sampleRate: number,
  options: CleanupOptions = {},
): CleanupResult {
  const applied: string[] = [];
  const framesBefore = pcm.length;
  const peakBefore = peakOf(pcm);

  if (framesBefore === 0) {
    return {
      pcm: new Float32Array(0),
      report: {
        framesBefore: 0,
        framesAfter: 0,
        trimmedStart: 0,
        trimmedEnd: 0,
        dcOffset: 0,
        peakBefore: 0,
        peakAfter: 0,
        applied,
      },
    };
  }

  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  // Explizit annotiert: die Schritte liefern Float32Array ueber unterschiedliche
  // Backing-Buffer-Typen; ohne Annotation friert TS `cur` auf den ersten fest.
  let cur: Float32Array = pcm.slice();
  let dcOffset = 0;

  if (options.removeDcOffset) {
    const res = removeDcOffset(cur);
    cur = res.pcm;
    dcOffset = res.offset;
    applied.push("DC-Offset");
  }

  if (options.highPassHz && options.highPassHz > 0) {
    cur = fromBufferLike(
      applyHighPass(toBufferLike(cur, sr), { cutoffHz: options.highPassHz }),
    );
    applied.push(`Hochpass ${Math.round(options.highPassHz)} Hz`);
  }

  if (options.lowPassHz && options.lowPassHz > 0) {
    cur = fromBufferLike(
      applyLowPass(toBufferLike(cur, sr), { cutoffHz: options.lowPassHz }),
    );
    applied.push(`Tiefpass ${Math.round(options.lowPassHz)} Hz`);
  }

  if (options.noiseReduction && options.noiseReduction > 0) {
    cur = fromBufferLike(
      reduceNoise(toBufferLike(cur, sr), { reduction: options.noiseReduction }),
    );
    applied.push(`Rauschminderung ${Math.round(options.noiseReduction * 100)} %`);
  }

  if (typeof options.gateThresholdDb === "number") {
    cur = fromBufferLike(
      applyNoiseGate(toBufferLike(cur, sr), { thresholdDb: options.gateThresholdDb }),
    );
    applied.push(`Gate ${options.gateThresholdDb} dB`);
  }

  if (typeof options.normalizePeak === "number" && options.normalizePeak > 0) {
    cur = normalizePeak(cur, options.normalizePeak);
    applied.push(`Normalisiert auf ${options.normalizePeak}`);
  }

  let trimmedStart = 0;
  let trimmedEnd = 0;
  if (typeof options.trimSilenceDb === "number") {
    const bounds = findContentBounds(cur, options.trimSilenceDb);
    // Kein Nutzsignal über der Schwelle → NICHT trimmen. Ein leeres Sample
    // zurueckzugeben waere schlimmer als ein zu langes.
    if (bounds && (bounds.start > 0 || bounds.end < cur.length)) {
      trimmedStart = bounds.start;
      trimmedEnd = cur.length - bounds.end;
      cur = cur.slice(bounds.start, bounds.end);
      applied.push(`Stille getrimmt (${trimmedStart}+${trimmedEnd} Frames)`);
    }
  }

  if (options.fadeMs && options.fadeMs > 0) {
    cur = applyEdgeFades(cur, sr, options.fadeMs);
    applied.push(`Fades ${options.fadeMs} ms`);
  }

  return {
    pcm: cur,
    report: {
      framesBefore,
      framesAfter: cur.length,
      trimmedStart,
      trimmedEnd,
      dcOffset,
      peakBefore,
      peakAfter: peakOf(cur),
      applied,
    },
  };
}

/** Kurzfassung des Reports für einen Toast. */
export function describeCleanup(report: CleanupReport): string {
  if (report.applied.length === 0) return "Keine Bearbeitung";
  const parts = [report.applied.join(", ")];
  if (report.framesAfter !== report.framesBefore) {
    const pct = Math.round((1 - report.framesAfter / report.framesBefore) * 100);
    parts.push(`${pct} % kürzer`);
  }
  return parts.join(" · ");
}
