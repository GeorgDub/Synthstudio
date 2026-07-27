/**
 * esxSampleExport.ts — exportiert die Samples einer ESX-1-Bank als WAV-Dateien.
 *
 * Feature-Parität zur open-electribe-editor-Software: „Sample als WAV
 * exportieren". Baut auf `encodeEsxSampleToWav` auf und liefert:
 *   - `esxSampleWavFileName` — deterministisches, kollisionsfreies Naming
 *     (`NNN_NAME[_st].wav`, Slot-Index zero-padded, Duplikate mit `_2`/`_3`).
 *   - `buildEsxSampleWavFiles` — reine Liste `{ fileName, bytes, sampleId }`
 *     über alle nicht-leeren Bank-Samples (mono + stereo).
 *   - `bundleEsxSamplesToZip` — packt die WAVs + `manifest.json` in ein ZIP.
 *     JSZip wird dynamisch importiert (oder für Tests injiziert).
 *
 * Naming + File-Liste sind rein (kein DOM/JSZip) → in Node testbar. Nur das
 * eigentliche ZIP-Packen ist async; der Download-Seiteneffekt bleibt im Caller.
 */

import { encodeEsxSampleToWav } from "./esxSampleWav";
import type { EsxBank, EsxSample } from "./esxParser";

/** Sanitisiert einen ESX-Sample-Namen zu einem dateisystem-sicheren Stamm. */
function sanitizeSampleName(name: string): string {
  const cleaned = (name ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "");
  return cleaned.slice(0, 24);
}

/**
 * Liefert einen deterministischen WAV-Dateinamen für ein Sample:
 *   `<NNN>_<sanitized-name>[_st].wav`
 * `NNN` ist der 3-stellig zero-paddete Slot-Index, `_st` markiert Stereo.
 * Leere Namen fallen auf `slot` zurück. Wird ein bereits vergebener Name
 * erzeugt, hängt die Funktion `_2`, `_3` … an (Registrierung via `seen`).
 */
export function esxSampleWavFileName(
  sample: EsxSample,
  seen?: Set<string>
): string {
  const idx = String(Math.max(0, Math.floor(sample.index))).padStart(3, "0");
  const stem = sanitizeSampleName(sample.name) || "slot";
  const suffix = sample.channels === 2 ? "_st" : "";
  let base = `${idx}_${stem}${suffix}`;
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

/** Ein exportierbares Sample: Dateiname + WAV-Bytes + Slot-Referenz. */
export interface EsxSampleWavFile {
  fileName: string;
  bytes: Uint8Array;
  sampleId: number;
}

/**
 * Baut die WAV-Datei-Liste über alle nicht-leeren Bank-Samples (mono zuerst,
 * dann stereo — stabile Reihenfolge). Leere/kaputte Samples werden übersprungen.
 * Dateinamen sind innerhalb der Liste garantiert eindeutig.
 */
export function buildEsxSampleWavFiles(bank: EsxBank): EsxSampleWavFile[] {
  const files: EsxSampleWavFile[] = [];
  const seen = new Set<string>();
  for (const s of [...bank.monoSamples, ...bank.stereoSamples]) {
    if (!s.pcmData || s.pcmData.length === 0) continue;
    let bytes: Uint8Array;
    try {
      bytes = encodeEsxSampleToWav(s);
    } catch {
      continue; // einzelnes Sample überspringen, Rest weiter exportieren
    }
    files.push({
      fileName: esxSampleWavFileName(s, seen),
      bytes,
      sampleId: s.index,
    });
  }
  return files;
}

/** Manifest-Eintrag pro exportiertem Sample. */
export interface EsxSampleManifestEntry {
  sampleId: number;
  fileName: string;
  channels: 1 | 2;
  sampleRate: number;
  frames: number;
}

/** Serialisierbares Export-Manifest (in der ZIP als `manifest.json`). */
export interface EsxSampleExportManifest {
  source: string;
  sampleCount: number;
  samples: EsxSampleManifestEntry[];
}

/**
 * Baut das Manifest zu einer Bank + ihrer WAV-Datei-Liste. Rein.
 */
export function buildEsxSampleExportManifest(
  bank: EsxBank,
  files: EsxSampleWavFile[]
): EsxSampleExportManifest {
  const byId = new Map<number, EsxSample>();
  for (const s of [...bank.monoSamples, ...bank.stereoSamples])
    byId.set(s.index, s);
  return {
    source: bank.source,
    sampleCount: files.length,
    samples: files.map(f => {
      const s = byId.get(f.sampleId);
      return {
        sampleId: f.sampleId,
        fileName: f.fileName,
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

/** Ergebnis von `bundleEsxSamplesToZip`. */
export interface EsxSampleZipResult {
  zip: ArrayBuffer;
  fileName: string;
  sampleCount: number;
  byteSize: number;
  manifest: EsxSampleExportManifest;
}

/**
 * Packt alle exportierbaren Samples einer Bank als WAVs + `manifest.json` in
 * ein ZIP. JSZip wird dynamisch importiert (oder für Tests injiziert).
 *
 * @param bank      Geparste ESX-Bank.
 * @param JSZipImpl Optional injizierte JSZip-Klasse (Test).
 */
export async function bundleEsxSamplesToZip(
  bank: EsxBank,
  JSZipImpl?: JSZipCtorLike
): Promise<EsxSampleZipResult> {
  const files = buildEsxSampleWavFiles(bank);
  const manifest = buildEsxSampleExportManifest(bank, files);

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
    // Frische Kopie → sauberer BlobPart/Uint8Array (kein SharedArrayBuffer-Union).
    const copy = new Uint8Array(f.bytes.byteLength);
    copy.set(f.bytes);
    zip.file(f.fileName, copy);
  }
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const out = (await zip.generateAsync({
    type: "arraybuffer",
  })) as ArrayBuffer;

  const stem = bank.source.replace(/\.[^.]+$/, "") || "esx";
  return {
    zip: out,
    fileName: `${sanitizeSampleName(stem) || "esx"}_samples.zip`,
    sampleCount: files.length,
    byteSize: out.byteLength,
    manifest,
  };
}
