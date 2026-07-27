/**
 * e2sSampleExport.ts — exportiert die Samples einer E2S-`.all`-Bank als WAV.
 *
 * Oe2sSLE-Funktion „Export sample to WAV" für die Electribe 2 Sampler. Setzt auf
 * den bereits dekodierten `E2sSlot.pcmData` (Float32, interleaved bei Stereo) +
 * `encodeWav` auf — kein erneutes Format-Parsen, kein geratenes Offset. Liefert:
 *   - `e2sSampleWavFileName` — deterministisches, kollisionsfreies Naming
 *     (`<NNN>_<name>[_st].wav`, sampleNumber zero-padded, Duplikate mit _2/_3).
 *   - `buildE2sSampleWavFiles` — reine Liste `{ fileName, bytes, sampleNumber }`.
 *   - `bundleE2sSamplesToZip` — WAVs + `manifest.json` als ZIP (JSZip injizierbar).
 *
 * Naming + File-Liste sind rein (kein DOM/JSZip) → in Node testbar.
 */

import { encodeWav } from "@/audio/wavEncoder";
import type { E2sBank, E2sSlot } from "./e2sBankReader";
import { buildSmplChunk, buildCueChunk, appendWavChunks } from "./e2sWavChunks";

/** Optionale WAV-Metadaten-Chunks (Oe2sSLE-Export-Optionen). */
export interface E2sWavExportOpts {
  /** `smpl`-Chunk (Loop-Punkt) einbetten, wenn ein echter Loop existiert. */
  smpl?: boolean;
  /** `cue `-Chunk (Slice-Marker) einbetten, wenn Slices existieren. */
  cue?: boolean;
}

/** Sanitisiert einen E2S-Sample-Namen zu einem dateisystem-sicheren Stamm. */
function sanitizeSampleName(name: string): string {
  const cleaned = (name ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "");
  return cleaned.slice(0, 24);
}

/**
 * Kodiert ein E2S-Sample (interleaved Float32-PCM) zu WAV-Bytes. Mono → 1 Kanal;
 * Stereo → deinterleaved 2 Kanäle. `encodeWav` erwartet Kanal-Buffer-Arrays.
 */
export function encodeE2sSlotToWav(
  slot: E2sSlot,
  opts: E2sWavExportOpts = {}
): Uint8Array {
  const sr = slot.sampleRate > 0 ? slot.sampleRate : 44100;
  let base: Uint8Array;
  if (slot.channels === 2) {
    const n = Math.floor(slot.pcmData.length / 2);
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      l[i] = slot.pcmData[i * 2];
      r[i] = slot.pcmData[i * 2 + 1];
    }
    base = new Uint8Array(encodeWav([l, r], { sampleRate: sr, channels: 2 }));
  } else {
    base = new Uint8Array(
      encodeWav([slot.pcmData], { sampleRate: sr, channels: 1 })
    );
  }

  // Optionale Oe2sSLE-Metadaten-Chunks (opt-in). smpl nur bei echtem Loop
  // (loopEnd > loopStart), cue nur wenn Slices vorhanden.
  const chunks: Uint8Array[] = [];
  if (opts.smpl === true && slot.loopEnd > slot.loopStart) {
    chunks.push(buildSmplChunk(sr, slot.loopStart, slot.loopEnd));
  }
  if (opts.cue === true && slot.slices && slot.slices.length > 0) {
    chunks.push(buildCueChunk(slot.slices.map(s => ({ position: s.start }))));
  }
  return chunks.length > 0 ? appendWavChunks(base, chunks) : base;
}

/**
 * Deterministischer WAV-Dateiname für einen Slot: `<NNN>_<name>[_st].wav`,
 * `NNN` = sampleNumber (Geräte-Nummer 501+), Stereo mit `_st`. Duplikate via
 * `seen`-Set bekommen `_2`, `_3`, …
 */
export function e2sSampleWavFileName(
  slot: E2sSlot,
  seen?: Set<string>
): string {
  const num = Math.max(0, Math.floor(slot.sampleNumber));
  const idx = String(num).padStart(3, "0");
  const stem = sanitizeSampleName(slot.name) || "slot";
  const suffix = slot.channels === 2 ? "_st" : "";
  const base = `${idx}_${stem}${suffix}`;
  if (!seen) return `${base}.wav`;
  let candidate = base;
  let n = 2;
  while (seen.has(`${candidate}.wav`)) {
    candidate = `${base}_${n}`;
    n++;
  }
  const fileName = `${candidate}.wav`;
  seen.add(fileName);
  return fileName;
}

/** Ein exportierbares Sample: Dateiname + WAV-Bytes + Geräte-Sample-Nummer. */
export interface E2sSampleWavFile {
  fileName: string;
  bytes: Uint8Array;
  sampleNumber: number;
}

/**
 * WAV-Datei-Liste über alle belegten (nicht-leeren) Slots der Bank, in
 * Slot-Reihenfolge. Leere/kaputte Slots werden übersprungen; Dateinamen sind
 * innerhalb der Liste garantiert eindeutig.
 */
export function buildE2sSampleWavFiles(
  bank: E2sBank,
  opts: E2sWavExportOpts = {}
): E2sSampleWavFile[] {
  const files: E2sSampleWavFile[] = [];
  const seen = new Set<string>();
  for (const slot of bank.slots) {
    if (!slot || !slot.pcmData || slot.pcmData.length === 0) continue;
    let bytes: Uint8Array;
    try {
      bytes = encodeE2sSlotToWav(slot, opts);
    } catch {
      continue; // einzelnes Sample überspringen, Rest weiter exportieren
    }
    files.push({
      fileName: e2sSampleWavFileName(slot, seen),
      bytes,
      sampleNumber: slot.sampleNumber,
    });
  }
  return files;
}

/** Manifest-Eintrag pro exportiertem Sample. */
export interface E2sSampleManifestEntry {
  sampleNumber: number;
  fileName: string;
  name: string;
  category: string;
  channels: 1 | 2;
  sampleRate: number;
  frames: number;
}

/** Serialisierbares Export-Manifest (in der ZIP als `manifest.json`). */
export interface E2sSampleExportManifest {
  source: string;
  sampleCount: number;
  samples: E2sSampleManifestEntry[];
}

/** Baut das Manifest zu einer Bank + ihrer WAV-Datei-Liste. Rein. */
export function buildE2sSampleExportManifest(
  bank: E2sBank,
  files: E2sSampleWavFile[]
): E2sSampleExportManifest {
  const byNumber = new Map<number, E2sSlot>();
  for (const slot of bank.slots) {
    if (slot) byNumber.set(slot.sampleNumber, slot);
  }
  return {
    source: bank.source,
    sampleCount: files.length,
    samples: files.map(f => {
      const s = byNumber.get(f.sampleNumber);
      return {
        sampleNumber: f.sampleNumber,
        fileName: f.fileName,
        name: s?.name ?? "",
        category: s?.categoryName ?? "",
        channels: (s?.channels ?? 1) as 1 | 2,
        sampleRate: s?.sampleRate ?? 44100,
        frames: s?.frames ?? 0,
      };
    }),
  };
}

/** Minimal-JSZip-Signatur für Test-Injection (analog channelBounce). */
export type JSZipCtorLike = new () => {
  file(name: string, data: ArrayBuffer | Uint8Array | string): void;
  generateAsync(opts: {
    type: "blob" | "arraybuffer" | "uint8array";
  }): Promise<Blob | ArrayBuffer | Uint8Array>;
};

/** Ergebnis von `bundleE2sSamplesToZip`. */
export interface E2sSampleZipResult {
  zip: ArrayBuffer;
  fileName: string;
  sampleCount: number;
  byteSize: number;
  manifest: E2sSampleExportManifest;
}

/**
 * Packt alle belegten Slots als WAVs + `manifest.json` in ein ZIP. JSZip wird
 * dynamisch importiert (oder für Tests injiziert).
 */
export async function bundleE2sSamplesToZip(
  bank: E2sBank,
  JSZipImpl?: JSZipCtorLike,
  opts: E2sWavExportOpts = {}
): Promise<E2sSampleZipResult> {
  const files = buildE2sSampleWavFiles(bank, opts);
  const manifest = buildE2sSampleExportManifest(bank, files);

  let Ctor: JSZipCtorLike;
  if (JSZipImpl) {
    Ctor = JSZipImpl;
  } else {
    const mod = await import("jszip");
    Ctor = (mod.default ??
      (mod as unknown as {
        default: JSZipCtorLike;
      })) as unknown as JSZipCtorLike;
  }
  const zip = new Ctor();
  for (const f of files) {
    const copy = new Uint8Array(f.bytes.byteLength);
    copy.set(f.bytes);
    zip.file(f.fileName, copy);
  }
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const out = (await zip.generateAsync({
    type: "arraybuffer",
  })) as ArrayBuffer;

  const stem = bank.source.replace(/\.[^.]+$/, "") || "e2s";
  return {
    zip: out,
    fileName: `${sanitizeSampleName(stem) || "e2s"}_samples.zip`,
    sampleCount: files.length,
    byteSize: out.byteLength,
    manifest,
  };
}
