/**
 * Synthstudio – SampleBrowser
 *
 * Zeigt die importierten Samples an und ermöglicht den Import neuer Samples.
 *
 * ─── GOLDENES GESETZ ─────────────────────────────────────────────────────────
 * Alle Electron-Aufrufe gehen ausschließlich über den useElectron()-Hook.
 * Kein direktes window.electronAPI. Jede Electron-Logik hinter if (electron.isElectron).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useRef, useCallback } from "react";

import { useElectron } from "../../../../electron/useElectron";
import type { Sample } from "../../store/useProjectStore";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface SampleBrowserProps {
  samples: Sample[];
  onImportSamples: (paths: string[]) => void;
  onImportFolder?: (folderPath: string) => void;
  onRemoveSample?: (id: string) => void;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"];

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function SampleBrowser({
  samples,
  onImportSamples,
  onImportFolder,
  onRemoveSample,
}: SampleBrowserProps) {
  // ── Einziger Zugriffspunkt auf Electron-Features ──────────────────────────
  const electron = useElectron();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // ── Import: Einzelne Dateien ──────────────────────────────────────────────

  const handleImportFiles = useCallback(async () => {
    if (electron.isElectron) {
      // Nativer Electron-Dialog – kein Browser-Popup
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
      // Browser-Fallback: <input type="file"> öffnen
      fileInputRef.current?.click();
    }
  }, [electron, onImportSamples]);

  // ── Import: Ordner ────────────────────────────────────────────────────────

  const handleImportFolder = useCallback(async () => {
    if (electron.isElectron) {
      // Nativer Electron-Ordner-Dialog
      const result = await electron.openFileDialog({
        title: "Sample-Ordner importieren",
        filters: [],
        multiSelections: false,
      });
      if (!result.canceled && result.filePaths[0]) {
        onImportFolder?.(result.filePaths[0]);
      }
    } else {
      // Browser-Fallback: <input type="file" webkitdirectory> öffnen
      folderInputRef.current?.click();
    }
  }, [electron, onImportFolder]);

  // ── Browser-Fallback: Datei-Input onChange ────────────────────────────────

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const audioPaths = files
        .filter((f) => AUDIO_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)))
        .map((f) => f.name);
      if (audioPaths.length > 0) {
        onImportSamples(audioPaths);
      }
      // Input zurücksetzen damit dieselben Dateien erneut gewählt werden können
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
      if (audioPaths.length > 0) {
        onImportSamples(audioPaths);
      }
      e.target.value = "";
    },
    [onImportSamples]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#111] border border-slate-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0d0d0d] border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
          Sample-Browser
        </h2>
        <div className="flex gap-2">
          {/* Dateien importieren */}
          <button
            onClick={handleImportFiles}
            title={electron.isElectron ? "Nativer Datei-Dialog" : "Dateien auswählen"}
            className="px-3 py-1 text-xs rounded bg-cyan-900/40 text-cyan-400 border border-cyan-800 hover:bg-cyan-800/60 hover:text-cyan-300 transition-colors duration-100"
          >
            + Dateien
          </button>

          {/* Ordner importieren */}
          <button
            onClick={handleImportFolder}
            title={electron.isElectron ? "Nativer Ordner-Dialog" : "Ordner auswählen"}
            className="px-3 py-1 text-xs rounded bg-slate-800/60 text-slate-400 border border-slate-700 hover:bg-slate-700/60 hover:text-slate-300 transition-colors duration-100"
          >
            + Ordner
          </button>
        </div>
      </div>

      {/* Sample-Liste */}
      <div className="flex-1 overflow-y-auto">
        {samples.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-600">
            <div className="text-4xl">🎚️</div>
            <p className="text-sm">Keine Samples geladen</p>
            <p className="text-xs text-slate-700">
              {electron.isElectron
                ? "Dateien hierher ziehen oder ueber '+ Dateien' importieren"
                : "Ueber '+ Dateien' importieren oder per Drag & Drop"}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/50">
            {samples.map((sample) => (
              <li
                key={sample.id}
                className="flex items-center gap-3 px-4 py-2 hover:bg-slate-800/30 transition-colors duration-75 group"
              >
                {/* Icon */}
                <span className="text-cyan-600 text-sm flex-shrink-0">♪</span>

                {/* Name + Pfad */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 truncate">{sample.name}</p>
                  {sample.path !== sample.name && (
                    <p className="text-xs text-slate-600 truncate" title={sample.path}>
                      {sample.path}
                    </p>
                  )}
                </div>

                {/* Größe */}
                {sample.size && (
                  <span className="text-xs text-slate-600 flex-shrink-0">
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

      {/* Status-Leiste */}
      <div className="px-4 py-1 bg-[#0d0d0d] border-t border-slate-800">
        <p className="text-xs text-slate-600">
          {samples.length === 0
            ? "Keine Samples"
            : `${samples.length} Sample${samples.length !== 1 ? "s" : ""}`}
          {electron.isElectron && (
            <span className="ml-2 text-cyan-800">• Electron</span>
          )}
        </p>
      </div>

      {/*
       * Versteckte Browser-Fallback-Inputs.
       * Nur im Browser gerendert – in Electron werden native Dialoge genutzt.
       */}
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
        </>
      )}
    </div>
  );
}

export default SampleBrowser;
