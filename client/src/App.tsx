/**
 * Synthstudio – App.tsx (Frontend-Agent)
 *
 * Haupt-React-Komponente. Integriert:
 * 1. ElectronTitleBar  – benutzerdefinierte Titelleiste (nur in Electron sichtbar)
 * 2. ElectronDropZone  – globales Drag & Drop Overlay (Browser + Electron)
 * 3. useElectronMenuBindings – native Menü-Events an React-State binden
 * 4. useWindowTitleSync – Fenstertitel mit isDirty/projectName synchronisieren
 *
 * ─── GOLDENES GESETZ ─────────────────────────────────────────────────────────
 * Jede Electron-spezifische Logik liegt hinter `if (electron.isElectron)`.
 * Kein direktes `window.electronAPI` – immer über den `useElectron()` Hook.
 * Die Web-App muss im Browser vollständig funktionsfähig bleiben.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect } from "react";

// ── Electron-Komponenten (aus electron/components/) ──────────────────────────
// Relative Imports notwendig da electron/ außerhalb von client/src liegt
import { ElectronTitleBar } from "../../electron/components/ElectronTitleBar";
import { ElectronDropZone } from "../../electron/components/ElectronDropZone";

// ── Electron-Hooks ────────────────────────────────────────────────────────────
import { useElectron } from "../../electron/useElectron";
import { useElectronMenuBindings } from "../../electron/hooks/useElectronMenuBindings";

// ── Eigene Stores & Hooks ─────────────────────────────────────────────────────
import { useProjectStore } from "@/store/useProjectStore";
import { useWindowTitleSync } from "@/store/useWindowTitleSync";

// ── Seiten-Komponenten ────────────────────────────────────────────────────────
import { SampleBrowser } from "@/components/SampleBrowser";
import { ProjectManager } from "@/components/ProjectManager";

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Electron-Hook (einziger Zugriffspunkt auf Electron-Features) ──────────
  const electron = useElectron();

  // ── Zentraler Projekt-State ───────────────────────────────────────────────
  const project = useProjectStore();

  // ── Fenstertitel synchronisieren ─────────────────────────────────────────
  // Browser: document.title | Electron: electron.setWindowTitle() via Hook
  useWindowTitleSync({
    projectName: project.projectName,
    isDirty: project.isDirty,
  });

  // ── Schließen-Bestätigung bei ungespeicherten Änderungen ─────────────────
  // Browser: beforeunload-Event | Electron: wird durch Main-Prozess gehandhabt
  useEffect(() => {
    if (electron.isElectron) return; // Electron hat eigene Schließ-Logik im Main-Prozess

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (project.isDirty) {
        e.preventDefault();
        e.returnValue = ""; // Browser zeigt Standard-Dialog
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [electron.isElectron, project.isDirty]);

  // ── Electron-Menü-Events an React-State binden ───────────────────────────
  // Im Browser: No-Op (alle Callbacks werden registriert aber nie aufgerufen)
  // Goldenes Gesetz: useElectronMenuBindings prüft intern ob Electron aktiv ist

  const handleMenuImportSamples = useCallback(async () => {
    // Menü-Event: Samples importieren
    // In Electron: nativer Dialog über useElectron()-Hook
    // Im Browser: kein Menü-Event möglich – dieser Callback wird nie aufgerufen
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
        project.importSamplesFromPaths(result.filePaths);
      }
    }
  }, [electron, project]);

  const handleMenuImportFolder = useCallback(async () => {
    // Menü-Event: Ordner importieren
    // In Electron: nativer Ordner-Dialog über useElectron()-Hook
    if (electron.isElectron) {
      const result = await electron.openFileDialog({
        title: "Sample-Ordner importieren",
        filters: [],
        multiSelections: false,
      });
      if (!result.canceled && result.filePaths[0]) {
        project.importSamplesFromPaths([result.filePaths[0]]);
      }
    }
  }, [electron, project]);

  const handleMenuOpen = useCallback(async () => {
    // Menü-Event: Projekt öffnen
    // In Electron: nativer Dialog über useElectron()-Hook
    if (electron.isElectron) {
      const result = await electron.openFileDialog({
        title: "Projekt öffnen",
        filters: [
          { name: "Synthstudio-Projekte", extensions: ["esx1", "json"] },
          { name: "Alle Dateien", extensions: ["*"] },
        ],
        multiSelections: false,
      });
      if (!result.canceled && result.filePaths[0]) {
        project.loadProject(result.filePaths[0]);
      }
    } else {
      // Browser-Fallback: loadProject ohne Pfad (z.B. aus localStorage)
      project.loadProject();
    }
  }, [electron, project]);

  useElectronMenuBindings({
    onNew: project.newProject,
    onOpen: handleMenuOpen,
    onSave: project.saveProject,
    onExport: project.exportProject,
    onUndo: project.undo,
    onRedo: project.redo,
    onPlayStop: project.togglePlayStop,
    onRecord: project.toggleRecord,
    onImportSamples: handleMenuImportSamples,
    onImportFolder: handleMenuImportFolder,
  });

  // ── Drop-Handler für ElectronDropZone ─────────────────────────────────────

  const handleDropAudioFiles = useCallback(
    (paths: string[]) => {
      project.importSamplesFromPaths(paths);
    },
    [project]
  );

  const handleDropFolder = useCallback(
    (folderPath: string) => {
      // Ordner-Drop: Pfad an importSamplesFromPaths übergeben
      // Vollständige Ordner-Traversierung durch IPC-Bridge-Agent
      project.importSamplesFromPaths([folderPath]);
    },
    [project]
  );

  const handleDropProject = useCallback(
    (filePath: string) => {
      project.loadProject(filePath);
    },
    [project]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    /*
     * ElectronDropZone umhüllt die gesamte App.
     * - In Electron: lauscht auf IPC-Events (onDragDropBulkImport etc.)
     *   Intern nutzt ElectronDropZone window.electronAPI direkt (Komponente
     *   aus electron/components/ – liegt im Verantwortungsbereich des IPC-Agents)
     * - Im Browser: HTML5 Drag & Drop Fallback
     * - Zeigt ein visuelles Overlay wenn Dateien gezogen werden
     */
    <ElectronDropZone
      onAudioFiles={handleDropAudioFiles}
      onFolder={handleDropFolder}
      onProject={handleDropProject}
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
              onImportFolder={handleDropFolder}
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

              {/* Projekt-Name mit isDirty-Indikator */}
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
                  className={[
                    "w-8 h-8 rounded flex items-center justify-center text-sm",
                    "transition-colors duration-100",
                    project.isPlaying
                      ? "bg-cyan-600 text-white hover:bg-cyan-500"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white",
                  ].join(" ")}
                >
                  {project.isPlaying ? "■" : "▶"}
                </button>

                <button
                  onClick={project.toggleRecord}
                  title={project.isRecording ? "Aufnahme stoppen (R)" : "Aufnahme starten (R)"}
                  className={[
                    "w-8 h-8 rounded flex items-center justify-center text-sm",
                    "transition-colors duration-100",
                    project.isRecording
                      ? "bg-red-600 text-white hover:bg-red-500"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white",
                  ].join(" ")}
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
                  className="w-7 h-7 rounded text-xs bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
                >
                  ↩
                </button>
                <button
                  onClick={project.redo}
                  disabled={!project.canRedo}
                  title="Wiederholen (Ctrl+Y)"
                  className="w-7 h-7 rounded text-xs bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
                >
                  ↪
                </button>
              </div>

              {/* Projekt-Manager (Speichern/Laden) */}
              <ProjectManager
                projectName={project.projectName}
                isDirty={project.isDirty}
                onSave={project.saveProject}
                onLoad={handleMenuOpen}
                onNew={project.newProject}
                onExport={project.exportProject}
              />
            </div>

            {/* Arbeitsbereich */}
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
                  <p>✓ useElectronMenuBindings gebunden (via useElectron-Hook)</p>
                  <p>✓ SampleBrowser mit nativen Dialogen via useElectron()</p>
                  <p>✓ ProjectManager mit nativen Dialogen via useElectron()</p>
                  <p>✓ Fenstertitel-Sync (isDirty ● Indikator)</p>
                  <p>✓ Browser-Fallbacks für alle Features</p>
                  {electron.isElectron && (
                    <p className="text-cyan-700 mt-2">⚡ Electron-Modus aktiv</p>
                  )}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </ElectronDropZone>
  );
}
