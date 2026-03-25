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
import React, { useCallback, useEffect, useState, useMemo } from "react";

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
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { SongTimeline } from "@/components/SongTimeline";
import { Humanizer } from "@/components/Humanizer";
import { DrumMachine } from "@/components/DrumMachine";

// ── Stores für neue Features ──────────────────────────────────────────────────
import { useSongStore } from "@/store/useSongStore";
import { useHumanizerStore } from "@/store/useHumanizerStore";
import { useDrumMachineStore } from "@/store/useDrumMachineStore";
import { useTransport } from "@/hooks/useTransport";
import { useMidi } from "@/hooks/useMidi";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { MidiSettings } from "@/components/MidiSettings";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Electron-Hook (einziger Zugriffspunkt auf Electron-Features) ────────────
  const electron = useElectron();
  // ── Dialog-State ────────────────────────────────────────────────────────────────
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);

  // ── Zentraler Projekt-State ────────────────────────────────────────────────────
  const project = useProjectStore();
  const song = useSongStore();
  const humanizer = useHumanizerStore();
  const dm = useDrumMachineStore();

  // ── Transport (Audio-Engine ↔ React-State) ────────────────────────────────────
  useTransport({
    isPlaying: project.isPlaying,
    bpm: project.bpm,
    dm,
    onPlayStateChange: (playing) => {
      if (!playing && project.isPlaying) project.togglePlayStop();
    },
  });

  // ── Arbeitsbereich-Tabs ────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"sequencer" | "song" | "humanizer">("sequencer");

  // ── Dialog-State für MIDI und Shortcuts ──────────────────────────────────
  const [showMidiSettings, setShowMidiSettings] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // ── MIDI-Hook ─────────────────────────────────────────────────────────────
  const midi = useMidi({
    onBpmChange: project.setBpm,
    onPlayStop: project.togglePlayStop,
    onClockBpm: (bpm) => project.setBpm(Math.round(bpm)),
    onPartTrigger: (partId, velocity) => {
      // MIDI-Note → Step im aktiven Pattern triggern (Live-Recording)
      const pattern = dm.getActivePattern();
      if (!pattern) return;
      const part = pattern.parts.find(p => p.id === partId);
      if (part && project.isRecording) {
        dm.toggleStep(partId, dm.currentStep);
      }
    },
    parts: dm.getActivePattern()?.parts ?? [],
  });

  // ── Zentrale Tastatur-Shortcuts ───────────────────────────────────────────
  useKeyboardShortcuts({
    dm,
    isPlaying: project.isPlaying,
    bpm: project.bpm,
    onPlayStop: project.togglePlayStop,
    onRecord: project.toggleRecord,
    onBpmChange: project.setBpm,
    onToggleSampleBrowser: () => {}, // Sample-Browser ist immer sichtbar
    onToggleMidiSettings: () => setShowMidiSettings(prev => !prev),
    onToggleShortcutsHelp: () => setShowShortcutsHelp(prev => !prev),
  });

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
          { name: "Synthstudio-Projekte", extensions: ["synth", "json"] },
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

  const handleNewProject = useCallback(() => {
    setShowNewProjectDialog(true);
  }, []);

  useElectronMenuBindings({
    onNew: handleNewProject,
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

  // ── Sample auf aktiven Kanal legen ──────────────────────────────────────────
  const handleAssignToChannel = useCallback(
    (sampleUrl: string, sampleName: string) => {
      const pattern = dm.getActivePattern();
      if (!pattern) return;
      const partId = dm.activePartId ?? pattern.parts[0]?.id;
      if (!partId) return;
      dm.setPartSample(partId, sampleUrl, sampleName);
    },
    [dm]
  );

  // Aktiver Kanal-Name für Anzeige im SampleBrowser
  const activeChannelName = useMemo(() => {
    const pattern = dm.getActivePattern();
    if (!pattern) return undefined;
    const partId = dm.activePartId ?? pattern.parts[0]?.id;
    return pattern.parts.find(p => p.id === partId)?.name;
  }, [dm]);

  // Kategorie eines Samples aktualisieren
  const handleUpdateSampleCategory = useCallback(
    (id: string, category: string) => {
      project.addSamples(
        project.samples.map(s => s.id === id ? { ...s, category } : s)
      );
    },
    [project]
  );

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
              onSamplesImported={project.addSamples}
              onAssignToChannel={handleAssignToChannel}
              activeChannelName={activeChannelName}
              onUpdateSampleCategory={handleUpdateSampleCategory}
            />
          </aside>

          {/* ── Hauptbereich: Synthesizer / Sequencer ─────────────────────── */}
          <main className="flex-1 flex flex-col overflow-hidden">

            {/* Transport-Leiste */}
            <div className="flex items-center gap-4 px-6 py-3 bg-[#0d0d0d] border-b border-slate-800">
              <h1 className="text-sm font-bold text-cyan-400 tracking-widest uppercase">
                Synthstudio
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

              {/* MIDI-Status-Button */}
              <button
                onClick={() => setShowMidiSettings(true)}
                title="MIDI-Einstellungen (Ctrl+M)"
                className={[
                  "w-8 h-8 rounded flex items-center justify-center text-xs",
                  "transition-colors duration-100",
                  midi.isEnabled
                    ? "bg-cyan-900 text-cyan-400 hover:bg-cyan-800"
                    : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300",
                ].join(" ")}
              >
                🎹
              </button>

              {/* Shortcuts-Hilfe-Button */}
              <button
                onClick={() => setShowShortcutsHelp(true)}
                title="Tastatur-Shortcuts (?)"
                className="w-8 h-8 rounded flex items-center justify-center text-xs bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300 transition-colors duration-100"
              >
                ?
              </button>

              {/* Projekt-Manager (Speichern/Laden) */}
              <ProjectManager
                projectName={project.projectName}
                isDirty={project.isDirty}
                onSave={project.saveProject}
                onLoad={handleMenuOpen}
                onNew={handleNewProject}
                onExport={project.exportProject}
              />
            </div>

            {/* Arbeitsbereich-Tabs */}
            <div className="flex gap-0 border-b border-slate-800 bg-[#0d0d0d]">
              {([
                { id: "sequencer", label: "Sequencer" },
                { id: "song",      label: "Song-Modus" },
                { id: "humanizer", label: "Humanizer" },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "px-5 py-2 text-xs font-medium border-b-2 transition-colors duration-100",
                    activeTab === tab.id
                      ? "border-cyan-500 text-cyan-400 bg-[#111]"
                      : "border-transparent text-slate-600 hover:text-slate-400 hover:bg-[#111]/50",
                  ].join(" ")}
                >
                  {tab.label}
                  {tab.id === "song" && song.songModeActive && (
                    <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-cyan-500 inline-block" />
                  )}
                  {tab.id === "humanizer" && humanizer.global.enabled && (
                    <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  )}
                </button>
              ))}
            </div>

            {/* Arbeitsbereich-Inhalt */}
            <div className="flex-1 overflow-hidden">

              {/* Sequencer-Tab: Drum Machine */}
              {activeTab === "sequencer" && (
                <DrumMachine
                  dm={dm}
                  samples={project.samples}
                  isPlaying={project.isPlaying}
                  bpm={project.bpm}
                  onPlayStop={project.togglePlayStop}
                  onBpmChange={project.setBpm}
                  className="h-full"
                />
              )}

              {/* Song-Modus-Tab */}
              {activeTab === "song" && (
                <div className="h-full overflow-y-auto p-4">
                  <SongTimeline
                    song={song}
                    isPlaying={project.isPlaying}
                    className="h-full"
                  />
                </div>
              )}

              {/* Humanizer-Tab */}
              {activeTab === "humanizer" && (
                <div className="h-full overflow-y-auto p-4">
                  <Humanizer
                    humanizer={humanizer}
                    className="max-w-lg"
                  />
                </div>
              )}

            </div>
          </main>
        </div>
      </div>
      {/* MIDI-Einstellungen-Dialog */}
      {showMidiSettings && (
        <MidiSettings
          midi={midi}
          parts={dm.getActivePattern()?.parts.map(p => ({ id: p.id, name: p.name })) ?? []}
          onClose={() => setShowMidiSettings(false)}
        />
      )}

      {/* Tastatur-Shortcuts-Hilfe */}
      {showShortcutsHelp && (
        <ShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      )}

      {/* Neues-Projekt-Dialog mit Template-Auswahl */}
      <NewProjectDialog
        isOpen={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
        onCreateProject={project.newProjectFromTemplate}
      />
    </ElectronDropZone>
  );
}
