/**
 * Synthstudio – ZIP Sample Import
 *
 * Extrahiert Audio-Dateien aus einem ZIP-Archiv und gibt Sample-Objekte
 * mit Blob-URLs zurück. Wird von SampleBrowser (Button) und ElectronDropZone
 * (Drag & Drop) gemeinsam genutzt.
 */
import type { Sample } from "../store/useProjectStore";

export const ZIP_AUDIO_EXTENSIONS = [
  "wav",
  "mp3",
  "ogg",
  "flac",
  "aiff",
  "aif",
  "m4a",
];

export interface ZipImportProgress {
  current: number;
  total: number;
  percentage: number;
  currentFile?: string;
}

export interface ZipImportResult {
  samples: Sample[];
  audioCount: number;
  skipped: number;
}

/**
 * Liest ein ZIP-File ein und gibt alle enthaltenen Audio-Dateien als
 * Sample[] mit Blob-URLs zurück.
 *
 * @param file ZIP-Datei aus File-Input/Drop-Event oder ein ArrayBuffer/Blob
 * @param onProgress Optionaler Callback für Progress-Updates pro Datei
 */
export async function extractSamplesFromZip(
  file: File | Blob | ArrayBuffer | Uint8Array,
  onProgress?: (progress: ZipImportProgress) => void
): Promise<ZipImportResult> {
  const JSZip = (await import("jszip")).default;
  // jszip kann mit File/Blob in Node-Umgebungen Probleme haben → erst zu ArrayBuffer
  const data: ArrayBuffer | Uint8Array =
    file instanceof ArrayBuffer || file instanceof Uint8Array
      ? file
      : await file.arrayBuffer();
  const zip = await JSZip.loadAsync(data);
  type ZipObject = import("jszip").JSZipObject;
  const audioEntries: Array<{ name: string; file: ZipObject }> = [];

  zip.forEach((relativePath, zipFile) => {
    if (zipFile.dir) return;
    const ext = relativePath.split(".").pop()?.toLowerCase() ?? "";
    if (ZIP_AUDIO_EXTENSIONS.includes(ext)) {
      audioEntries.push({ name: relativePath, file: zipFile });
    }
  });

  const total = audioEntries.length;
  const samples: Sample[] = [];

  for (let i = 0; i < total; i++) {
    const entry = audioEntries[i];
    const blob = await entry.file.async("blob");
    const url = URL.createObjectURL(blob);
    const name = entry.name.split("/").pop()?.replace(/\.[^.]+$/, "") ?? entry.name;

    samples.push({
      id: `zip_${Date.now()}_${i}`,
      name,
      path: url,
      category: "imported",
    });

    onProgress?.({
      current: i + 1,
      total,
      percentage: Math.round(((i + 1) / total) * 100),
      currentFile: name,
    });
  }

  return { samples, audioCount: total, skipped: 0 };
}

/** Prüft, ob eine Datei eine ZIP-Datei ist (Endung oder MIME). */
export function isZipFile(file: File): boolean {
  if (file.name.toLowerCase().endsWith(".zip")) return true;
  return file.type === "application/zip" || file.type === "application/x-zip-compressed";
}
