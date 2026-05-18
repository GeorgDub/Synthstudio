/**
 * Synthstudio – useProjectStore
 *
 * Zentraler React-State für Projekt-Metadaten und Undo/Redo-Zustand.
 * Wird von App.tsx und allen Komponenten genutzt, die Projekt-Informationen benötigen.
 * Isomorph: Funktioniert im Browser und in Electron.
 */
import { useState, useCallback } from "react";
import type { templateToProjectState } from "./projectTemplates";
// v3.54.0: Sample-Library Tag-Helper für Auto-Tagging und Tag-Mutations.
import {
  addTagToSample as addTagToSamplePure,
  removeTagFromSample as removeTagFromSamplePure,
  setSampleTags as setSampleTagsPure,
  applyAutoTagsFromFilename,
} from "@/utils/sampleLibrary";
// v3.58.0: Stable UUID v4 — projectId ist immutable nach init.
import { generateProjectId, isValidProjectId } from "@/utils/projectId";

export interface Sample {
  id: string;
  name: string;
  /** Im Browser: Blob-URL oder Dateiname. In Electron: absoluter Dateipfad. */
  path: string;
  category: string;
  size?: number;
  /** Auto-Tags aus Dateiname (kick, snare, loop, …) */
  tags?: string[];
}

export interface ProjectState {
  /**
   * Stabile UUID v4 — einmal bei `newProject` generiert, immutable für
   * die Lebenszeit des Projekts. Wird von AutoSave als rename-resistenter
   * Versions-Schlüssel verwendet. Seit v3.58.0 (Schema v1.24).
   */
  projectId: string;
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
  /**
   * Live-Step-Recording-Mode (post-v1.31.0 Welle 2).
   * - "overdub": MIDI-Hits fügen Steps hinzu, bestehende bleiben (Default).
   * - "replace": beim Playback-Vorrücken werden Steps geclearet, bevor neue
   *   eingehen können — re-record-Workflow.
   */
  recordingMode: "overdub" | "replace";
  /**
   * Punch-In Step (0-basiert, inkl.). null = keine Punch-In-Grenze.
   * Wenn gesetzt, wird nur ab diesem Step aufgezeichnet.
   */
  punchInStep: number | null;
  /**
   * Punch-Out Step (0-basiert, inkl.). null = keine Punch-Out-Grenze.
   * Wenn gesetzt, wird nur bis zu diesem Step aufgezeichnet.
   */
  punchOutStep: number | null;
}

export interface ProjectActions {
  setProjectName: (name: string) => void;
  /**
   * v3.58.0: Übernimmt eine projectId aus einem geladenen .synth-File.
   * Wird NICHT für Rename oder normale State-Mutations benutzt — nur
   * beim Load. Bei invalider ID wird defensiv eine neue UUID generiert.
   */
  adoptProjectId: (id: string) => void;
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
  setRecordingMode: (mode: "overdub" | "replace") => void;
  setPunchInStep: (step: number | null) => void;
  setPunchOutStep: (step: number | null) => void;
  clearPunchRange: () => void;
  addSamples: (samples: Sample[]) => void;
  removeSample: (id: string) => void;
  importSamplesFromPaths: (paths: string[]) => void;
  /** Reihenfolge der Samples ändern: draggedId wird vor targetId eingesetzt. */
  reorderSamples: (draggedId: string, targetId: string) => void;
  /** v3.54.0: Tag zu einem Sample hinzufügen (idempotent). */
  addTagToSample: (id: string, tag: string) => void;
  /** v3.54.0: Tag aus einem Sample entfernen. */
  removeTagFromSample: (id: string, tag: string) => void;
  /** v3.54.0: Tags eines Samples komplett ersetzen. */
  setSampleTags: (id: string, tags: string[]) => void;
  /** v3.54.0: Beliebige Sample-Felder partiell updaten (z.B. Kategorie). */
  updateSample: (id: string, patch: Partial<Sample>) => void;
}

/**
 * v3.58.0: Liefert einen frischen Default-State mit NEU generierter
 * projectId. Wird bei Hook-Init und bei `newProject` aufgerufen.
 *
 * Wichtig: projectId darf NICHT eine Modul-Konstante sein, weil sonst
 * alle Projekt-Resets dieselbe UUID hätten → AutoSave-History würde
 * zwischen Sessions kollidieren.
 */
function makeDefaultState(): ProjectState {
  return {
    projectId: generateProjectId(),
    projectName: "Neues Projekt",
    isDirty: false,
    canUndo: false,
    canRedo: false,
    samples: [],
    isPlaying: false,
    isRecording: false,
    bpm: 120,
    recordingMode: "overdub",
    punchInStep: null,
    punchOutStep: null,
  };
}

/**
 * Hook der den gesamten Projekt-State und alle Aktionen bereitstellt.
 * Wird einmalig in App.tsx instanziiert und per Props oder Context weitergegeben.
 */
export function useProjectStore(): ProjectState & ProjectActions {
  // v3.58.0: Lazy-Init damit jeder Hook-Instance eine eigene UUID bekommt.
  const [state, setState] = useState<ProjectState>(() => makeDefaultState());

  const setProjectName = useCallback((name: string) => {
    // v3.58.0: WICHTIG — projectId bleibt unverändert. Rename ändert nur
    // den anzeigenden Namen, NICHT den AutoSave-History-Schlüssel.
    setState((prev) => ({ ...prev, projectName: name }));
  }, []);

  const adoptProjectId = useCallback((id: string) => {
    // v3.58.0: Wird beim Load eines .synth-Files aufgerufen, um die
    // projectId aus dem File zu übernehmen. Defensive: bei invalider ID
    // generieren wir lieber eine neue UUID, statt zu crashen.
    const adopted = isValidProjectId(id) ? id : generateProjectId();
    setState((prev) => ({ ...prev, projectId: adopted }));
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
    // v3.58.0: makeDefaultState() statt DEFAULT_STATE — jedes neue Projekt
    // bekommt eine frische UUID, sonst würde die History sich zwischen
    // Projekten überschneiden.
    setState(makeDefaultState());
  }, []);

  /**
   * Neues Projekt aus einem Template erstellen.
   * Setzt BPM, Projekt-Name und Platzhalter-Samples aus dem Template.
   */
  const newProjectFromTemplate = useCallback(
    (templateState: ReturnType<typeof templateToProjectState>) => {
      console.log("[ProjectStore] newProjectFromTemplate aufgerufen", templateState.projectName);
      // v3.58.0: Frischer Default = neue UUID, dann Template-Felder draufpatchen.
      setState({
        ...makeDefaultState(),
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

  const setRecordingMode = useCallback((mode: "overdub" | "replace") => {
    setState((prev) => ({ ...prev, recordingMode: mode }));
  }, []);

  const setPunchInStep = useCallback((step: number | null) => {
    setState((prev) => ({
      ...prev,
      punchInStep: step === null || step < 0 ? null : Math.floor(step),
    }));
  }, []);

  const setPunchOutStep = useCallback((step: number | null) => {
    setState((prev) => ({
      ...prev,
      punchOutStep: step === null || step < 0 ? null : Math.floor(step),
    }));
  }, []);

  const clearPunchRange = useCallback(() => {
    setState((prev) => ({ ...prev, punchInStep: null, punchOutStep: null }));
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
      // v3.54.0: Auto-Tagging beim Import — Filename-basiert (schnell + synchron).
      const base: Sample = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name,
        path: p,
        category: "imported",
      };
      return applyAutoTagsFromFilename(base);
    });
    addSamples(newSamples);
  }, [addSamples]);

  // v3.54.0: Tag-Mutations für ein einzelnes Sample.  Liefert immer einen
  // NEUEN State (auch wenn das Sample unverändert ist), damit useState die
  // Subscription korrekt feuert — aber das Sample-Objekt bleibt referenz-
  // identisch falls der Tag-Mutator unverändert returned.

  const addTagToSampleAction = useCallback((id: string, tag: string) => {
    setState((prev) => ({
      ...prev,
      isDirty: true,
      samples: prev.samples.map((s) =>
        s.id === id ? addTagToSamplePure(s, tag) : s
      ),
    }));
  }, []);

  const removeTagFromSampleAction = useCallback((id: string, tag: string) => {
    setState((prev) => ({
      ...prev,
      isDirty: true,
      samples: prev.samples.map((s) =>
        s.id === id ? removeTagFromSamplePure(s, tag) : s
      ),
    }));
  }, []);

  const setSampleTagsAction = useCallback((id: string, tags: string[]) => {
    setState((prev) => ({
      ...prev,
      isDirty: true,
      samples: prev.samples.map((s) =>
        s.id === id ? setSampleTagsPure(s, tags) : s
      ),
    }));
  }, []);

  const updateSampleAction = useCallback((id: string, patch: Partial<Sample>) => {
    setState((prev) => ({
      ...prev,
      isDirty: true,
      samples: prev.samples.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    }));
  }, []);

  const reorderSamples = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setState((prev) => {
      const arr = [...prev.samples];
      const fromIdx = arr.findIndex((s) => s.id === draggedId);
      if (fromIdx === -1) return prev;
      const [moved] = arr.splice(fromIdx, 1);
      const toIdx = arr.findIndex((s) => s.id === targetId);
      if (toIdx === -1) return prev;
      arr.splice(toIdx, 0, moved);
      return { ...prev, samples: arr, isDirty: true };
    });
  }, []);

  return {
    ...state,
    setProjectName,
    adoptProjectId,
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
    setRecordingMode,
    setPunchInStep,
    setPunchOutStep,
    clearPunchRange,
    addSamples,
    removeSample,
    importSamplesFromPaths,
    reorderSamples,
    addTagToSample: addTagToSampleAction,
    removeTagFromSample: removeTagFromSampleAction,
    setSampleTags: setSampleTagsAction,
    updateSample: updateSampleAction,
  };
}
