/**
 * Synthstudio – App.tsx (Frontend-Agent)
 *
 * Haupt-React-Komponente. Integriert:
 * 1. ElectronTitleBar  – benutzerdefinierte Titelleiste (nur in Electron sichtbar)
 * 2. ElectronDropZone  – globales Drag & Drop Overlay (Browser + Electron)
 * 3. useElectronMenuBindings – native Menü-Events an React-State binden
 * 4. useWindowTitleSync – Fenstertitel mit isDirty/projectName synchronisieren
 *
 * Goldenes Gesetz: Alle Electron-spezifischen Pfade sind hinter isElectron-Checks.
 * Die Web-App funktioniert im Browser zu 100% ohne Electron.
 */
import React, { useCallback } from "react";

// ── Electron-Komponenten (aus electron/components/) ──────────────────────────
// Relative Imports notwendig da electron/ außerhalb von client/src liegt
import { ElectronTitleBar } from "../../electron/components/ElectronTitleBar";
import { ElectronDropZone } from "../../electron/components/ElectronDropZone";

// ── Electron-Hooks ────────────────────────────────────────────────────────────
import { useElectronMenuBindings } from "../../electron/hooks/useElectronMenuBindings";

// ── Eigene Stores & Hooks ─────────────────────────────────────────────────────
import { useProjectStore } from "@/store/useProjectStore";
import { useWindowTitleSync } from "@/store/useWindowTitleSync";

// ── Seiten-Komponenten ────────────────────────────────────────────────────────
import { SampleBrowser } from "@/components/SampleBrowser";

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // Zentraler Projekt-State
  const project = useProjectStore();

  // ── Fenstertitel synchronisieren (Browser: document.title, Electron: nativ) ──
  useWindowTitleSync({
    projectName: project.projectName,
    isDirty: project.isDirty,
  });

  // ── Electron-Menü-Events an React-State binden ────────────────────────────
  // Im Browser: No-Op (alle Callbacks werden registriert aber nie aufgerufen)
  useElectronMenuBindings({
    onNew: project.newProject,
    onOpen: useCallback(() => project.loadProject(), [project]),  // eslint-disable-line react-hooks/exhaustive-deps
    onSave: project.saveProject,
    onExport: project.exportProject,
    onUndo: project.undo,
    onRedo: project.redo,
    onPlayStop: project.togglePlayStop,
    onRecord: project.toggleRecord,
    onImportSamples: useCallback(async () => {
      // Menü-Event: Samples importieren – öffnet nativen Dialog in Electron
      if (typeof window !== "undefined" && window.electronAPI?.isElectron) {
        const result = await window.electronAPI.openFileDialog({
          title: "Samples importieren",
          filters: [
            {
              name: "Audio-Dateien",
              extensions: ["wav", "mp3", "ogg", "flac", "aiff", "aif", "m4a"],
            },
          ],
          multiSelections: true,
        });
        if (!result.canceled && result.filePaths.length > 0) {
          project.importSamplesFromPaths(result.filePaths);
        }
      }
    }, [project]),  // eslint-disable-line react-hooks/exhaustive-deps
    onImportFolder: useCallback(async () => {
      // Menü-Event: Ordner importieren – öffnet nativen Ordner-Dialog in Electron
      if (typeof window !== "undefined" && window.electronAPI?.isElectron) {
        const result = await window.electronAPI.openFolderDialog({
          title: "Sample-Ordner importieren",
        });
        if (!result.canceled && result.filePaths[0]) {
          // Ordner-Import: Implementierung durch IPC-Bridge-Agent (importFolder)
          project.importSamplesFromPaths([result.filePaths[0]]);
        }
      }
    }, [project]),  // eslint-disable-line react-hooks/exhaustive-deps
  });

  // ── Drop-Handler für ElectronDropZone ─────────────────────────────────────

  const handleAudioFiles = useCallback(
    (paths: string[]) => {
      project.importSamplesFromPaths(paths);
    },
    [project.importSamplesFromPaths]
  );

  const handleFolder = useCallback(
    (folderPath: string) => {
      // Ordner-Drop: Pfad als Platzhalter hinzufügen
      // Vollständige Implementierung durch IPC-Bridge-Agent
      project.importSamplesFromPaths([folderPath]);
    },
    [project.importSamplesFromPaths]
  );

  const handleProject = useCallback(
    (filePath: string) => {
      project.loadProject(filePath);
    },
    [project.loadProject]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    /*
     * ElectronDropZone umhüllt die gesamte App.
     * - In Electron: lauscht auf IPC-Events (onDragDropBulkImport etc.)
     * - Im Browser: HTML5 Drag & Drop Fallback
     * - Zeigt ein visuelles Overlay wenn Dateien gezogen werden
     */
    <ElectronDropZone
      onAudioFiles={handleAudioFiles}
      onFolder={handleFolder}
      onProject={handleProject}
    >
      <div className="flex flex-col h-screen bg-[#0a0a0a] text-slate-100 overflow-hidden">

        {/*
         * ElectronTitleBar – benutzerdefinierte Titelleiste.
         * Gibt null zurück wenn nicht in Electron → kein Browser-Impact.
         * Zeigt: App-Name, Projektname, isDirty-Indikator, Fenster-Buttons.
         */}
        <ElectronTitleBar
          projectName={project.projectName}
          isDirty={project.isDirty}
        />

        {/* ── Haupt-Layout ────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Linke Sidebar: Sample-Browser ─────────────────────────────── */}
          <aside className="w-72 flex-shrink-0 border-r border-slate-800 overflow-hidden">
            <SampleBrowser
              samples={project.samples}
              onImportSamples={project.importSamplesFromPaths}
              onImportFolder={handleFolder}
              onRemoveSample={project.removeSample}
            />
          </aside>

          {/* ── Hauptbereich: Synthesizer / Sequencer ─────────────────────── */}
          <main className="flex-1 flex flex-col overflow-hidden">

            {/* Transport-Leiste */}
            <div className="flex items-center gap-4 px-6 py-3 bg-[#0d0d0d] border-b border-slate-800">
              <h1 className="text-sm font-bold text-cyan-400 tracking-widest uppercase">
                KORG ESX-1 Studio
              </h1>

              <div className="flex-1" />

              {/* Projekt-Name */}
              <span className="text-xs text-slate-500">
                {project.projectName}
                {project.isDirty && (
                  <span className="ml-1 text-cyan-500" title="Ungespeicherte Änderungen">
                    ●
                  </span>
                )}
              </span>

              {/* Transport-Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={project.togglePlayStop}
                  title={project.isPlaying ? "Stop (Space)" : "Play (Space)"}
                  className={`
                    w-8 h-8 rounded flex items-center justify-center text-sm
                    transition-colors duration-100
                    ${
                      project.isPlaying
                        ? "bg-cyan-600 text-white hover:bg-cyan-500"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                    }
                  `}
                >
                  {project.isPlaying ? "■" : "▶"}
                </button>

                <button
                  onClick={project.toggleRecord}
                  title={project.isRecording ? "Aufnahme stoppen (R)" : "Aufnahme starten (R)"}
                  className={`
                    w-8 h-8 rounded flex items-center justify-center text-sm
                    transition-colors duration-100
                    ${
                      project.isRecording
                        ? "bg-red-600 text-white hover:bg-red-500"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                    }
                  `}
                >
                  ●
                </button>
              </div>

              {/* Undo/Redo */}
              <div className="flex items-center gap-1">
                <button
                  onClick={project.undo}
                  disabled={!project.canUndo}
                  title="Rückgängig (Ctrl+Z)"
                  className="
                    w-7 h-7 rounded text-xs
                    bg-slate-800 text-slate-500
                    hover:bg-slate-700 hover:text-slate-300
                    disabled:opacity-30 disabled:cursor-not-allowed
                    transition-colors duration-100
                  "
                >
                  ↩
                </button>
                <button
                  onClick={project.redo}
                  disabled={!project.canRedo}
                  title="Wiederholen (Ctrl+Y)"
                  className="
                    w-7 h-7 rounded text-xs
                    bg-slate-800 text-slate-500
                    hover:bg-slate-700 hover:text-slate-300
                    disabled:opacity-30 disabled:cursor-not-allowed
                    transition-colors duration-100
                  "
                >
                  ↪
                </button>
              </div>

              {/* Speichern */}
              <button
                onClick={project.saveProject}
                title="Speichern (Ctrl+S)"
                className="
                  px-3 py-1 text-xs rounded
                  bg-slate-800 text-slate-400 border border-slate-700
                  hover:bg-slate-700 hover:text-slate-200
                  transition-colors duration-100
                "
              >
                Speichern
              </button>
            </div>

            {/* Arbeitsbereich-Platzhalter */}
            <div className="flex-1 flex items-center justify-center text-slate-700">
              <div className="text-center">
                <div className="text-6xl mb-4">🎹</div>
                <p className="text-lg font-semibold">Synthesizer-Arbeitsbereich</p>
                <p className="text-sm mt-2 text-slate-600">
                  Weitere Komponenten werden durch die anderen Agenten implementiert
                </p>
                <div className="mt-6 flex flex-col gap-1 text-xs text-slate-700">
                  <p>✓ ElectronTitleBar integriert</p>
                  <p>✓ ElectronDropZone integriert</p>
                  <p>✓ useElectronMenuBindings gebunden</p>
                  <p>✓ SampleBrowser mit nativen Dialogen</p>
                  <p>✓ Browser-Fallbacks für alle Features</p>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </ElectronDropZone>
  );
}
