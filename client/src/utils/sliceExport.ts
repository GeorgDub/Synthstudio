/**
 * sliceExport.ts — v3.300.0
 *
 * Slices als WAV-Dateien herausgeben — einzeln oder als ZIP.
 *
 * Bis v3.299 endeten Slices ausschliesslich auf Drum-Kanaelen und
 * Performance-Pads: es gab keinen Weg, sie als Dateien aus der App zu
 * bekommen. Genau das fehlte fuer den Weg auf die SD-Karte.
 *
 * Das Modul ist rein — es encodiert und benennt, es laedt nichts herunter.
 * Der Download bleibt beim Aufrufer (DOM-Seiteneffekt), die JSZip-Klasse wird
 * wie in `channelBounce.ts` injizierbar gehalten, damit Tests ohne echtes
 * Archiv laufen.
 */

import { encodeWavMono } from "@/audio/wavEncoder";
import type { JSZipCtor } from "./channelBounce";

// ─── Dateinamen ──────────────────────────────────────────────────────────────

/**
 * Macht aus einem Sample-Namen einen dateisystemtauglichen Stamm.
 *
 * Bewusst streng: die Zieldateisysteme sind hier nicht nur NTFS/ext4, sondern
 * auch die FAT-formatierte SD-Karte einer Electribe. Alles ausserhalb
 * `[A-Za-z0-9_-]` wird zu `_`, Mehrfach-Unterstriche fallen zusammen.
 */
export function sanitizeSliceStem(name: string, maxLen = 32): string {
  const base = (name ?? "")
    .replace(/\.[^.]*$/, "") // Endung weg, falls der Name eine mitbringt
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const trimmed = base.slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : "slice";
}

/**
 * Dateiname eines Slices: `<stamm>_<nr>.wav`, Nummer ab 1 und links mit
 * Nullen aufgefuellt, damit die alphabetische Sortierung im Dateimanager der
 * Reihenfolge im Sample entspricht (sonst steht `_10` vor `_2`).
 */
export function sliceFileName(stem: string, index: number, total: number): string {
  const width = Math.max(2, String(Math.max(1, total)).length);
  return `${sanitizeSliceStem(stem)}_${String(index + 1).padStart(width, "0")}.wav`;
}

// ─── Encoding ────────────────────────────────────────────────────────────────

export interface EncodedSlice {
  /** Dateiname inklusive `.wav`. */
  name: string;
  /** Vollstaendige WAV-Datei. */
  bytes: ArrayBuffer;
  /** Laenge in Frames — fuer die UI-Rueckmeldung. */
  frames: number;
}

export interface EncodeSlicesOptions {
  /** Bit-Tiefe der Ausgabe (Default 16). Mehr kann der WAV-Encoder nicht. */
  bitDepth?: 16 | 24;
  /** Leere Slices auslassen (Default true). */
  skipEmpty?: boolean;
}

/**
 * Encodiert alle Slices zu WAV.
 *
 * Leere Slices werden standardmaessig uebersprungen: eine 0-Frame-WAV ist auf
 * manchen Geraeten kein gueltiges Sample, und sie waere ohnehin nutzlos. Die
 * Nummerierung richtet sich dabei nach der Position im ORIGINAL, damit
 * `slice_03` auch dann der dritte Abschnitt ist, wenn der zweite leer war.
 */
export function encodeSlices(
  slices: Float32Array[],
  sampleRate: number,
  stem: string,
  options: EncodeSlicesOptions = {},
): EncodedSlice[] {
  const { bitDepth = 16, skipEmpty = true } = options;
  const sr = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  const out: EncodedSlice[] = [];
  for (let i = 0; i < slices.length; i++) {
    const pcm = slices[i];
    if (skipEmpty && (!pcm || pcm.length === 0)) continue;
    out.push({
      name: sliceFileName(stem, i, slices.length),
      bytes: encodeWavMono(pcm ?? new Float32Array(0), sr, bitDepth),
      frames: pcm?.length ?? 0,
    });
  }
  return out;
}

// ─── ZIP ─────────────────────────────────────────────────────────────────────

export interface SliceZipResult {
  zip: ArrayBuffer;
  filename: string;
  sliceCount: number;
  byteSize: number;
}

/**
 * Packt encodierte Slices in ein ZIP.
 *
 * Warum ueberhaupt ein Archiv: ein Loop zerfaellt schnell in 16 bis 64
 * Schnipsel, und 64 einzelne Browser-Downloads sind keine Bedienung — die
 * meisten Browser blocken die Serie nach den ersten paar Dateien.
 *
 * @param JSZipImpl Optional injiziert (Tests); sonst dynamischer Import.
 */
export async function bundleSlicesToZip(
  encoded: EncodedSlice[],
  stem: string,
  JSZipImpl?: JSZipCtor,
): Promise<SliceZipResult> {
  const Ctor: JSZipCtor =
    JSZipImpl ?? ((await import("jszip")).default as unknown as JSZipCtor);
  const zip = new Ctor();
  for (const slice of encoded) zip.file(slice.name, slice.bytes);
  const blob = await zip.generateAsync({ type: "arraybuffer" });
  const buffer =
    blob instanceof ArrayBuffer
      ? blob
      : ((blob as unknown as Uint8Array).buffer as ArrayBuffer);
  return {
    zip: buffer,
    filename: `${sanitizeSliceStem(stem)}_slices.zip`,
    sliceCount: encoded.length,
    byteSize: buffer.byteLength,
  };
}

/**
 * Ab wann sich ein Archiv lohnt. Unterhalb dieser Zahl ist der Einzeldownload
 * angenehmer — man will die zwei Dateien direkt im Ordner haben, nicht erst
 * entpacken.
 */
export const ZIP_THRESHOLD = 4;

/** Entscheidet zwischen Einzeldateien und Archiv. */
export function shouldBundle(sliceCount: number): boolean {
  return sliceCount >= ZIP_THRESHOLD;
}
