/**
 * Synthstudio – SampleBrowser (v2)
 *
 * Zeigt die importierten Samples an und ermöglicht den Import neuer Samples.
 * Neu in v2:
 * - Tag-Filterung nach Kategorie (Kicks, Snares, Hats, etc.)
 * - Volltextsuche nach Sample-Namen
 * - ZIP-Import (Electron + Browser-Fallback)
 * - Fortschrittsanzeige beim Import
 *
 * ─── GOLDENES GESETZ ─────────────────────────────────────────────────────────
 * Alle Electron-Aufrufe gehen ausschließlich über den useElectron()-Hook.
 * Kein direktes window.electronAPI. Jede Electron-Logik hinter if (electron.isElectron).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useRef, useCallback, useState, useMemo, useEffect } from "react";

import { useElectron } from "../../../../electron/useElectron";
import type { Sample } from "../../store/useProjectStore";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface SampleBrowserProps {
  samples: Sample[];
  onImportSamples: (paths: string[]) => void;
  onImportFolder?: (folderPath: string) => void;
  onRemoveSample?: (id: string) => void;
  /** Callback wenn Samples via ZIP importiert wurden (mit vollständigen Sample-Daten) */
  onSamplesImported?: (samples: Sample[]) => void;
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"];

/** Alle verfügbaren Kategorien mit Labels und Farben */
const CATEGORIES: Array<{ id: string; label: string; color: string }> = [
  { id: "all",        label: "Alle",        color: "bg-slate-700 text-slate-200" },
  { id: "kicks",      label: "Kicks",       color: "bg-red-900/60 text-red-300" },
  { id: "snares",     label: "Snares",      color: "bg-orange-900/60 text-orange-300" },
  { id: "hihats",     label: "Hi-Hats",     color: "bg-yellow-900/60 text-yellow-300" },
  { id: "claps",      label: "Claps",       color: "bg-green-900/60 text-green-300" },
  { id: "toms",       label: "Toms",        color: "bg-teal-900/60 text-teal-300" },
  { id: "percussion", label: "Perc",        color: "bg-cyan-900/60 text-cyan-300" },
  { id: "fx",         label: "FX",          color: "bg-blue-900/60 text-blue-300" },
  { id: "loops",      label: "Loops",       color: "bg-indigo-900/60 text-indigo-300" },
  { id: "vocals",     label: "Vocals",      color: "bg-purple-900/60 text-purple-300" },
  { id: "other",      label: "Sonstige",    color: "bg-slate-800/60 text-slate-400" },
  { id: "imported",   label: "Importiert",  color: "bg-slate-800/60 text-slate-400" },
];

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getCategoryColor(categoryId: string): string {
  return CATEGORIES.find((c) => c.id === categoryId)?.color ?? "bg-slate-800/60 text-slate-400";
}

// ─── Import-Fortschritts-Overlay ─────────────────────────────────────────────

interface ImportProgressProps {
  current: number;
  total: number;
  percentage: number;
  phase: string;
  currentFile?: string;
  onCancel?: () => void;
}

function ImportProgress({ current, total, percentage, phase, currentFile, onCancel }: ImportProgressProps) {
  const phaseLabel = phase === "counting" ? "Zähle Dateien…"
    : phase === "reading" ? "Lese Archiv…"
    : phase === "extracting" ? "Extrahiere…"
    : "Importiere…";

  return (
    <div className="absolute inset-0 bg-[#0d0d0d]/95 flex flex-col items-center justify-center gap-3 z-10 rounded-lg">
      <p className="text-sm font-semibold text-cyan-400">{phaseLabel}</p>
      {total > 0 && (
        <>
          <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-500 rounded-full transition-all duration-200"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">
            {current} / {total} ({percentage}%)
          </p>
        </>
      )}
      {currentFile && (
        <p className="text-xs text-slate-600 truncate max-w-[180px]" title={currentFile}>
          {currentFile}
        </p>
      )}
      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-1 px-3 py-1 text-xs rounded bg-red-900/40 text-red-400 border border-red-800 hover:bg-red-800/60 transition-colors"
        >
          Abbrechen
        </button>
      )}
    </div>
  );
}

// ─── Hauptkomponente ──────────────────────────────────────────────────────────

export function SampleBrowser({
  samples,
  onImportSamples,
  onImportFolder,
  onRemoveSample,
  onSamplesImported,
}: SampleBrowserProps) {
  // ── Einziger Zugriffspunkt auf Electron-Features ──────────────────────────
  const electron = useElectron();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // ── Filter-State ──────────────────────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // ── Import-Fortschritt ────────────────────────────────────────────────────
  const [importProgress, setImportProgress] = useState<{
    active: boolean;
    importId: string;
    current: number;
    total: number;
    percentage: number;
    phase: string;
    currentFile?: string;
  } | null>(null);

  // ── Electron Import-Events abonnieren ─────────────────────────────────────
  useEffect(() => {
    const cleanupStarted = electron.onImportStarted((data) => {
      setImportProgress({
        active: true,
        importId: data.importId,
        current: 0,
        total: 0,
        percentage: 0,
        phase: "counting",
      });
    });

    const cleanupProgress = electron.onImportProgress((data) => {
      setImportProgress((prev) => prev ? {
        ...prev,
        current: data.current,
        total: data.total,
        percentage: data.percentage,
        phase: data.phase,
        currentFile: data.currentFile,
      } : null);
    });

    const cleanupComplete = electron.onImportComplete((data) => {
      setImportProgress(null);
      if (data.samples && data.samples.length > 0 && onSamplesImported) {
        onSamplesImported(data.samples);
      }
    });

    const cleanupCancelled = electron.onImportCancelled(() => {
      setImportProgress(null);
    });

    return () => {
      cleanupStarted();
      cleanupProgress();
      cleanupComplete();
      cleanupCancelled();
    };
  }, [electron, onSamplesImported]);

  // ── Gefilterte Samples ────────────────────────────────────────────────────
  const filteredSamples = useMemo(() => {
    return samples.filter((sample) => {
      const matchesCategory = activeCategory === "all" || sample.category === activeCategory;
      const matchesSearch = searchQuery === "" ||
        sample.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [samples, activeCategory, searchQuery]);

  // ── Kategorie-Zähler ──────────────────────────────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: samples.length };
    for (const sample of samples) {
      counts[sample.category] = (counts[sample.category] ?? 0) + 1;
    }
    return counts;
  }, [samples]);

  // ── Import: Einzelne Dateien ──────────────────────────────────────────────

  const handleImportFiles = useCallback(async () => {
    if (electron.isElectron) {
      const result = await electron.openFileDialog({
        title: "Samples importieren",
        filters: [
          {
            name: "Audio-Dateien",
            extensions: ["wav", "mp3", "ogg", "flac", "aiff", "aif", "m4a"],
          },
          { name: "Alle Dateien", extensions: ["*"] },
        ],
        multiSelections: true,
      });
      if (!result.canceled && result.filePaths.length > 0) {
        onImportSamples(result.filePaths);
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [electron, onImportSamples]);

  // ── Import: Ordner ────────────────────────────────────────────────────────

  const handleImportFolder = useCallback(async () => {
    if (electron.isElectron) {
      const result = await electron.openFolderDialog({
        title: "Sample-Ordner importieren",
      });
      if (!result.canceled && result.filePaths[0]) {
        onImportFolder?.(result.filePaths[0]);
      }
    } else {
      folderInputRef.current?.click();
    }
  }, [electron, onImportFolder]);

  // ── Import: ZIP-Archiv ────────────────────────────────────────────────────

  const handleImportZip = useCallback(async () => {
    if (electron.isElectron) {
      const result = await electron.openFileDialog({
        title: "ZIP-Archiv mit Samples importieren",
        filters: [{ name: "ZIP-Archive", extensions: ["zip"] }],
        multiSelections: false,
      });
      if (!result.canceled && result.filePaths[0]) {
        await electron.importZip(result.filePaths[0]);
      }
    } else {
      // Browser-Fallback: ZIP via jszip im Browser verarbeiten
      zipInputRef.current?.click();
    }
  }, [electron]);

  // ── Import: Abbrechen ─────────────────────────────────────────────────────

  const handleCancelImport = useCallback(() => {
    if (importProgress?.importId && electron.isElectron) {
      electron.cancelImport(importProgress.importId);
    }
    setImportProgress(null);
  }, [electron, importProgress]);

  // ── Browser-Fallback: Datei-Input onChange ────────────────────────────────

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const audioPaths = files
        .filter((f) => AUDIO_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)))
        .map((f) => f.name);
      if (audioPaths.length > 0) onImportSamples(audioPaths);
      e.target.value = "";
    },
    [onImportSamples]
  );

  const handleFolderInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const audioPaths = files
        .filter((f) => AUDIO_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)))
        .map((f) => (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name);
      if (audioPaths.length > 0) onImportSamples(audioPaths);
      e.target.value = "";
    },
    [onImportSamples]
  );

  const handleZipInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      // Browser: JSZip direkt im Browser verarbeiten
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(file);
        const audioEntries: Array<{ name: string; file: JSZip.JSZipObject }> = [];

        zip.forEach((relativePath, zipFile) => {
          if (zipFile.dir) return;
          const ext = relativePath.split(".").pop()?.toLowerCase() ?? "";
          if (["wav", "mp3", "ogg", "flac", "aiff", "aif", "m4a"].includes(ext)) {
            audioEntries.push({ name: relativePath, file: zipFile });
          }
        });

        if (audioEntries.length === 0) {
          alert("Keine Audio-Dateien im ZIP-Archiv gefunden.");
          return;
        }

        setImportProgress({
          active: true,
          importId: `browser_zip_${Date.now()}`,
          current: 0,
          total: audioEntries.length,
          percentage: 0,
          phase: "extracting",
        });

        const importedSamples: Sample[] = [];
        for (let i = 0; i < audioEntries.length; i++) {
          const entry = audioEntries[i];
          const blob = await entry.file.async("blob");
          const url = URL.createObjectURL(blob);
          const name = entry.name.split("/").pop()?.replace(/\.[^.]+$/, "") ?? entry.name;

          importedSamples.push({
            id: `zip_${Date.now()}_${i}`,
            name,
            path: url,
            category: "imported",
          });

          setImportProgress((prev) => prev ? {
            ...prev,
            current: i + 1,
            percentage: Math.round(((i + 1) / audioEntries.length) * 100),
            currentFile: name,
          } : null);
        }

        setImportProgress(null);
        if (onSamplesImported) {
          onSamplesImported(importedSamples);
        } else {
          onImportSamples(importedSamples.map((s) => s.path));
        }
      } catch (err) {
        setImportProgress(null);
        console.error("[SampleBrowser] ZIP-Import Fehler:", err);
      }
    },
    [onImportSamples, onSamplesImported]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full bg-[#111] border border-slate-800 rounded-lg overflow-hidden">

      {/* Import-Fortschritt-Overlay */}
      {importProgress?.active && (
        <ImportProgress
          current={importProgress.current}
          total={importProgress.total}
          percentage={importProgress.percentage}
          phase={importProgress.phase}
          currentFile={importProgress.currentFile}
          onCancel={handleCancelImport}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0d0d0d] border-b border-slate-800">
        <h2 className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
          Sample-Browser
        </h2>
        <div className="flex gap-1.5">
          <button
            onClick={handleImportFiles}
            title="Audio-Dateien importieren"
            className="px-2 py-1 text-xs rounded bg-cyan-900/40 text-cyan-400 border border-cyan-800 hover:bg-cyan-800/60 hover:text-cyan-300 transition-colors"
          >
            + Dateien
          </button>
          <button
            onClick={handleImportFolder}
            title="Ordner mit Samples importieren"
            className="px-2 py-1 text-xs rounded bg-slate-800/60 text-slate-400 border border-slate-700 hover:bg-slate-700/60 hover:text-slate-300 transition-colors"
          >
            + Ordner
          </button>
          <button
            onClick={handleImportZip}
            title="ZIP-Archiv mit Samples importieren"
            className="px-2 py-1 text-xs rounded bg-slate-800/60 text-slate-400 border border-slate-700 hover:bg-slate-700/60 hover:text-slate-300 transition-colors"
          >
            + ZIP
          </button>
        </div>
      </div>

      {/* ── Suche ───────────────────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-slate-800/50">
        <input
          type="text"
          placeholder="Samples suchen…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[#0d0d0d] border border-slate-800 rounded px-2 py-1 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-800 transition-colors"
        />
      </div>

      {/* ── Kategorie-Filter ─────────────────────────────────────────────────── */}
      {samples.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-slate-800/50">
          {CATEGORIES.filter((cat) => cat.id === "all" || (categoryCounts[cat.id] ?? 0) > 0).map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`
                px-2 py-0.5 text-xs rounded-full border transition-all duration-100
                ${activeCategory === cat.id
                  ? `${cat.color} border-current opacity-100`
                  : "bg-transparent text-slate-600 border-slate-800 hover:text-slate-400 hover:border-slate-700"
                }
              `}
            >
              {cat.label}
              {categoryCounts[cat.id] != null && (
                <span className="ml-1 opacity-60">
                  {cat.id === "all" ? samples.length : categoryCounts[cat.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Sample-Liste ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {samples.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <div className="text-4xl">🎚️</div>
            <p className="text-sm">Keine Samples geladen</p>
            <p className="text-xs text-slate-700 text-center px-4">
              {electron.isElectron
                ? "Dateien hierher ziehen oder über '+ Dateien', '+ Ordner' oder '+ ZIP' importieren"
                : "Über '+ Dateien', '+ ZIP' importieren oder per Drag & Drop"}
            </p>
          </div>
        ) : filteredSamples.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-600">
            <p className="text-sm">Keine Treffer</p>
            <button
              onClick={() => { setActiveCategory("all"); setSearchQuery(""); }}
              className="text-xs text-cyan-700 hover:text-cyan-500 transition-colors"
            >
              Filter zurücksetzen
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/50">
            {filteredSamples.map((sample) => (
              <li
                key={sample.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/30 transition-colors duration-75 group"
              >
                {/* Kategorie-Badge */}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${getCategoryColor(sample.category)}`}
                  title={sample.category}
                >
                  {sample.category.slice(0, 3).toUpperCase()}
                </span>

                {/* Name + Pfad */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-200 truncate">{sample.name}</p>
                  {sample.path !== sample.name && (
                    <p className="text-[10px] text-slate-600 truncate" title={sample.path}>
                      {sample.path}
                    </p>
                  )}
                </div>

                {/* Größe */}
                {sample.size && (
                  <span className="text-[10px] text-slate-600 flex-shrink-0">
                    {formatBytes(sample.size)}
                  </span>
                )}

                {/* Entfernen-Button */}
                {onRemoveSample && (
                  <button
                    onClick={() => onRemoveSample(sample.id)}
                    title="Sample entfernen"
                    className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all duration-100 text-xs px-1"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Status-Leiste ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-1 bg-[#0d0d0d] border-t border-slate-800">
        <p className="text-[10px] text-slate-600">
          {samples.length === 0
            ? "Keine Samples"
            : filteredSamples.length < samples.length
            ? `${filteredSamples.length} von ${samples.length} Samples`
            : `${samples.length} Sample${samples.length !== 1 ? "s" : ""}`}
          {electron.isElectron && (
            <span className="ml-2 text-cyan-900">• Electron</span>
          )}
        </p>
      </div>

      {/* ── Versteckte Browser-Fallback-Inputs ──────────────────────────────── */}
      {!electron.isElectron && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={AUDIO_EXTENSIONS.join(",")}
            multiple
            className="hidden"
            onChange={handleFileInputChange}
            aria-hidden="true"
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory ist kein Standard-HTML-Attribut
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={handleFolderInputChange}
            aria-hidden="true"
          />
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleZipInputChange}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
}

export default SampleBrowser;
