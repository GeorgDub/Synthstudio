/**
 * Synthstudio – packScanner (v3.108.0)
 *
 * Pure-ish Helper für rekursiven Folder-Scan eines Sample-Packs.
 *
 * SECURITY:
 *  - Whitelist Audio-Extensions (= PACK_SAMPLE_ALLOWED_EXTENSIONS aus ipcValidators)
 *  - Hard-Cap auf maximale Datei-Anzahl (DoS-Schutz)
 *  - Hard-Cap auf maximale Verzeichnis-Tiefe (Symlink-Schleifen-Schutz)
 *  - Containment-Check: alle aufgesammelten Pfade liegen tatsächlich unter root
 *  - NUL-Byte-Defense an jedem Pfad
 *  - Symlinks werden NICHT verfolgt (lstat statt stat in der Iterator-Ebene)
 *
 * Test-Notiz: walk() ist Dependency-Injection-fähig — die fs-Dependencies
 * (readdir, lstat) werden über das `deps`-Argument hereingegeben, damit der
 * Test eine in-memory FS-Struktur mocken kann.
 */

import * as path from "path";

import { PACK_SAMPLE_ALLOWED_EXTENSIONS } from "./ipcValidators";

/** Pro Pack max. so viele Dateien (DoS-Schutz, schützt Renderer-IPC + UI). */
export const PACK_SCAN_MAX_FILES = 5000;

/** Pro Pack max. so tief verschachtelte Sub-Folders (Symlink-Schleifen-Schutz). */
export const PACK_SCAN_MAX_DEPTH = 4;

export interface PackScanFile {
  /** Relativer Pfad ab Root (POSIX-Separator `/`, plattform-unabhängig). */
  relPath: string;
  /** Absoluter Pfad (plattform-spezifisch — wird für pack:readFile zurückgegeben). */
  absolutePath: string;
  /** Datei-Größe in Bytes. */
  sizeBytes: number;
}

export interface PackScanResult {
  /** Resolved (canonical) Root-Pfad. */
  root: string;
  /** Aufgefundene Audio-Dateien (sortiert für deterministisches Output). */
  files: PackScanFile[];
  /** Anzahl der wegen MAX_FILES-Cap übersprungenen Audio-Dateien. */
  truncated: boolean;
  /** Anzahl der wegen MAX_DEPTH-Cap übersprungenen Subfolder. */
  depthSkipped: number;
}

export interface FsDirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface FsStat {
  size: number;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface PackScanDeps {
  readdir(dirPath: string): Promise<FsDirent[]>;
  /** lstat — folgt KEINE Symlinks. */
  lstat(targetPath: string): Promise<FsStat>;
}

/** Prüft, ob die Endung im Whitelist-Set ist. */
function _isAudio(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return PACK_SAMPLE_ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Walk-Funktion mit Dependency-Injection. Testbar via in-memory-FS-Mock.
 *
 * Containment-Guarantees:
 *  - root wird via `path.resolve` normalisiert (kein `..`-Leck)
 *  - jeder zurückgegebene `absolutePath` liegt unter `resolvedRoot`
 *  - rejected NUL-Byte enthaltende Dateinamen
 *  - rejected Symlinks (Pfad wird nicht weiterverfolgt)
 */
export async function walkPackRoot(
  rootPath: string,
  deps: PackScanDeps,
  opts: { maxFiles?: number; maxDepth?: number } = {},
): Promise<PackScanResult> {
  if (typeof rootPath !== "string" || rootPath.length === 0) {
    throw new Error("rootPath required");
  }
  if (rootPath.includes("\0")) {
    throw new Error("rootPath contains NUL byte");
  }
  if (!path.isAbsolute(rootPath)) {
    throw new Error("rootPath must be absolute");
  }
  const resolvedRoot = path.resolve(rootPath);
  const maxFiles = Math.max(1, Math.min(opts.maxFiles ?? PACK_SCAN_MAX_FILES, PACK_SCAN_MAX_FILES));
  const maxDepth = Math.max(1, Math.min(opts.maxDepth ?? PACK_SCAN_MAX_DEPTH, PACK_SCAN_MAX_DEPTH));

  const out: PackScanFile[] = [];
  let truncated = false;
  let depthSkipped = 0;

  // SECURITY: BFS-Walk damit Reihenfolge deterministisch ist (sort pro level).
  // Containment-Check pro Eintrag: resolved muss unter resolvedRoot liegen.
  const queue: Array<{ dir: string; depth: number }> = [{ dir: resolvedRoot, depth: 0 }];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const { dir, depth } = next;
    if (depth > maxDepth) {
      depthSkipped++;
      continue;
    }
    let entries: FsDirent[];
    try {
      entries = await deps.readdir(dir);
    } catch {
      // SECURITY: stille fehler — wir leaken nicht warum (permission/missing).
      continue;
    }
    // Deterministische Reihenfolge.
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const ent of entries) {
      if (typeof ent.name !== "string") continue;
      if (ent.name.includes("\0")) continue;
      // SECURITY: keine relativen-Tricks — Dateinamen mit Path-Separator droppen.
      if (ent.name.includes("/") || ent.name.includes("\\")) continue;
      // SECURITY: keine versteckten dot-folders (./..).
      if (ent.name === "." || ent.name === "..") continue;
      // SECURITY: Symlinks droppen — können aus dem Root rausführen.
      if (ent.isSymbolicLink()) continue;

      const childPath = path.join(dir, ent.name);
      // Containment-Boundary mit path.sep, damit /foo nicht /foobar matcht.
      const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
      if (childPath !== resolvedRoot && !childPath.startsWith(rootPrefix)) {
        // SECURITY: irgendwas hat uns aus dem Root geschoben — ignore.
        continue;
      }

      if (ent.isDirectory()) {
        if (depth + 1 > maxDepth) {
          depthSkipped++;
          continue;
        }
        queue.push({ dir: childPath, depth: depth + 1 });
        continue;
      }

      if (!ent.isFile()) continue;
      if (!_isAudio(ent.name)) continue;

      // MAX_FILES-Cap: ab 5000 sammeln wir nicht mehr — markieren truncated.
      if (out.length >= maxFiles) {
        truncated = true;
        continue;
      }

      let stat: FsStat;
      try {
        stat = await deps.lstat(childPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      // Relativer Pfad mit POSIX-Separator damit das UI plattform-portabel ist.
      const rel = path.relative(resolvedRoot, childPath).split(path.sep).join("/");
      out.push({
        relPath: rel,
        absolutePath: childPath,
        sizeBytes: typeof stat.size === "number" && isFinite(stat.size) ? stat.size : 0,
      });
    }
  }

  return {
    root: resolvedRoot,
    files: out,
    truncated,
    depthSkipped,
  };
}
