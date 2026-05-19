/**
 * Synthstudio – Sample-Pack-Browser Import-Logik (v3.106.0)
 *
 * Pure-Helpers für Folder-Scan + Sample-Erzeugung.
 * Side-effect-frei → unit-testbar in env:node.
 */

import {
  classifyByFilename,
  extractTags,
  extractBpm,
  isAudioFilename,
  type SampleCategory,
} from "@/utils/sampleClassifier";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface ScanInput {
  /** Relativer Pfad inkl. Subfolder (z.B. "Trap_Kicks/808_Kick_01.wav") */
  relPath: string;
  /** Größe in Bytes (optional, für UI-Display) */
  sizeBytes?: number;
}

export interface ScannedSample {
  id: string;
  filename: string;
  relPath: string;
  parentFolder: string;
  category: SampleCategory;
  tags: string[];
  bpm: number | null;
  sizeBytes: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _counter = 0;
function _makeId(): string {
  _counter += 1;
  return `pksamp-${Date.now().toString(36)}-${_counter.toString(36)}`;
}

function _parentFolderOf(relPath: string): string {
  const parts = relPath.split(/[/\\]/).filter((p) => p.length > 0);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function _basenameOf(relPath: string): string {
  const parts = relPath.split(/[/\\]/);
  return parts[parts.length - 1] ?? relPath;
}

// ─── Pure API ────────────────────────────────────────────────────────────────

/**
 * Scannt eine Liste von relativen Pfaden und erzeugt ScannedSample-Records.
 *
 * Filterregeln:
 *  - nur audio extensions (siehe AUDIO_EXTENSIONS in sampleClassifier)
 *  - duplicate relPaths werden dedupliziert (erstes Vorkommen gewinnt)
 *  - leere oder ungültige Inputs werden silent ignoriert
 *
 * Klassifikation pro Sample:
 *  - category via classifyByFilename
 *  - tags via extractTags (parent-folder + filename)
 *  - bpm via extractBpm
 */
export function scanFolderForSamples(inputs: ScanInput[]): ScannedSample[] {
  if (!Array.isArray(inputs)) return [];
  const seen = new Set<string>();
  const out: ScannedSample[] = [];

  for (const inp of inputs) {
    if (!inp || typeof inp.relPath !== "string") continue;
    const relPath = inp.relPath.trim();
    if (relPath.length === 0) continue;
    if (!isAudioFilename(relPath)) continue;
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const filename = _basenameOf(relPath);
    const parentFolder = _parentFolderOf(relPath);
    const category = classifyByFilename(filename);
    const tags = extractTags(filename, parentFolder);
    const bpm = extractBpm(filename);
    const sizeBytes =
      typeof inp.sizeBytes === "number" && isFinite(inp.sizeBytes) && inp.sizeBytes >= 0
        ? inp.sizeBytes
        : null;

    out.push({
      id: _makeId(),
      filename,
      relPath,
      parentFolder,
      category,
      tags,
      bpm,
      sizeBytes,
    });
  }

  return out;
}

/**
 * Browser-Fallback: erzeugt ScanInput[] aus einer FileList (vom <input
 * type="file" webkitdirectory> Element).
 */
export function fileListToScanInputs(files: FileList | File[]): ScanInput[] {
  const out: ScanInput[] = [];
  const arr: File[] = Array.isArray(files) ? files : Array.from(files);
  for (const f of arr) {
    // webkitRelativePath enthält den Subfolder-Pfad
    const relPath = (f as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
    out.push({ relPath, sizeBytes: f.size });
  }
  return out;
}
