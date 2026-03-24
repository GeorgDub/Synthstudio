/**
 * Synthstudio – useProjectStore
 *
 * Zentraler React-State für Projekt-Metadaten und Undo/Redo-Zustand.
 * Wird von App.tsx und allen Komponenten genutzt, die Projekt-Informationen benötigen.
 * Isomorph: Funktioniert im Browser und in Electron.
 */
import { useState, useCallback } from "react";
import type { templateToProjectState } from "./projectTemplates";

export interface Sample {
  id: string;
  name: string;
  /** Im Browser: Blob-URL oder Dateiname. In Electron: absoluter Dateipfad. */
  path: string;
  category: string;
  size?: number;
}

export interface ProjectState {
  /** Name des aktuellen Projekts */
  projectName: string;
  /** Ob es ungespeicherte Änderungen gibt */
  isDirty: boolean;
  /** Ob Undo möglich ist */
  canUndo: boolean;
  /** Ob Redo möglich ist */
  canRedo: boolean;
  /** Geladene Samples */
  samples: Sample[];
  /** Ob der Transport (Playback) läuft */
  isPlaying: boolean;
  /** Ob die Aufnahme aktiv ist */
  isRecording: boolean;
  /** BPM (Beats per Minute) */
  bpm: number;
}

export interface ProjectActions {
  setProjectName: (name: string) => void;
  setDirty: (dirty: boolean) => void;
  setBpm: (bpm: number) => void;
  saveProject: () => void;
  loadProject: (filePath?: string) => void;
  newProject: () => void;
  newProjectFromTemplate: (state: ReturnType<typeof templateToProjectState>) => void;
  exportProject: () => void;
  undo: () => void;
  redo: () => void;
  togglePlayStop: () => void;
  toggleRecord: () => void;
  addSamples: (samples: Sample[]) => void;
  removeSample: (id: string) => void;
  importSamplesFromPaths: (paths: string[]) => void;
}

const DEFAULT_STATE: ProjectState = {
  projectName: "Neues Projekt",
  isDirty: false,
  canUndo: false,
  canRedo: false,
  samples: [],
  isPlaying: false,
  isRecording: false,
  bpm: 120,
};

/**
 * Hook der den gesamten Projekt-State und alle Aktionen bereitstellt.
 * Wird einmalig in App.tsx instanziiert und per Props oder Context weitergegeben.
 */
export function useProjectStore(): ProjectState & ProjectActions {
  const [state, setState] = useState<ProjectState>(DEFAULT_STATE);

  const setProjectName = useCallback((name: string) => {
    setState((prev) => ({ ...prev, projectName: name }));
  }, []);

  const setDirty = useCallback((dirty: boolean) => {
    setState((prev) => ({ ...prev, isDirty: dirty }));
  }, []);

  const setBpm = useCallback((bpm: number) => {
    setState((prev) => ({ ...prev, bpm: Math.max(20, Math.min(300, bpm)), isDirty: true }));
  }, []);

  const saveProject = useCallback(() => {
    // Im Browser: localStorage-Speicherung
    // In Electron: wird über native Dialoge im IPC-Bridge-Agent gehandhabt
    console.log("[ProjectStore] saveProject aufgerufen");
    setState((prev) => ({ ...prev, isDirty: false }));
  }, []);

  const loadProject = useCallback((filePath?: string) => {
    console.log("[ProjectStore] loadProject aufgerufen", filePath);
    // Implementierung durch IPC-Bridge-Agent
  }, []);

  const newProject = useCallback(() => {
    console.log("[ProjectStore] newProject aufgerufen");
    setState({ ...DEFAULT_STATE });
  }, []);

  /**
   * Neues Projekt aus einem Template erstellen.
   * Setzt BPM, Projekt-Name und Platzhalter-Samples aus dem Template.
   */
  const newProjectFromTemplate = useCallback(
    (templateState: ReturnType<typeof templateToProjectState>) => {
      console.log("[ProjectStore] newProjectFromTemplate aufgerufen", templateState.projectName);
      setState({
        ...DEFAULT_STATE,
        projectName: templateState.projectName,
        bpm: templateState.bpm,
        samples: templateState.samples,
        isDirty: false,
      });
    },
    []
  );

  const exportProject = useCallback(() => {
    console.log("[ProjectStore] exportProject aufgerufen");
    // Implementierung durch Audio-Engine-Agent
  }, []);

  const undo = useCallback(() => {
    console.log("[ProjectStore] undo aufgerufen");
    setState((prev) => ({ ...prev, isDirty: true }));
  }, []);

  const redo = useCallback(() => {
    console.log("[ProjectStore] redo aufgerufen");
    setState((prev) => ({ ...prev, isDirty: true }));
  }, []);

  const togglePlayStop = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isPlaying: !prev.isPlaying,
      isRecording: prev.isPlaying ? false : prev.isRecording,
    }));
  }, []);

  const toggleRecord = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isRecording: !prev.isRecording,
    }));
  }, []);

  const addSamples = useCallback((newSamples: Sample[]) => {
    setState((prev) => ({
      ...prev,
      isDirty: true,
      samples: [
        ...prev.samples,
        ...newSamples.filter(
          (ns) => !prev.samples.some((s) => s.path === ns.path)
        ),
      ],
    }));
  }, []);

  const removeSample = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      isDirty: true,
      samples: prev.samples.filter((s) => s.id !== id),
    }));
  }, []);

  const importSamplesFromPaths = useCallback((paths: string[]) => {
    const newSamples: Sample[] = paths.map((p) => {
      const name = p.split(/[\\/]/).pop() ?? p;
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        path: p,
        category: "imported",
      };
    });
    addSamples(newSamples);
  }, [addSamples]);

  return {
    ...state,
    setProjectName,
    setDirty,
    setBpm,
    saveProject,
    loadProject,
    newProject,
    newProjectFromTemplate,
    exportProject,
    undo,
    redo,
    togglePlayStop,
    toggleRecord,
    addSamples,
    removeSample,
    importSamplesFromPaths,
  };
}
