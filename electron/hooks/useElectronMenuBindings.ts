/**
 * Synthstudio – useElectronMenuBindings (Frontend-Agent)
 *
 * Custom Hook der alle nativen Electron-Menü-Events an React-Callbacks bindet.
 * Cleanup erfolgt automatisch beim Unmount der Komponente.
 *
 * Verwendung:
 * ```tsx
 * useElectronMenuBindings({
 *   onSave: () => saveProject(),
 *   onNew: () => newProject(),
 *   onOpen: () => openProjectDialog(),
 *   onExport: () => exportDialog(),
 *   onImportSamples: () => importSamplesDialog(),
 * });
 * ```
 */
import { useEffect } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface MenuBindings {
  /** Datei → Neu (Ctrl+N) */
  onNew?: () => void;
  /** Datei → Öffnen (Ctrl+O) */
  onOpen?: () => void;
  /** Datei → Speichern (Ctrl+S) */
  onSave?: () => void;
  /** Datei → Speichern unter (Ctrl+Shift+S) */
  onSaveAs?: () => void;
  /** Datei → Exportieren (Ctrl+E) */
  onExport?: () => void;
  /** Audio → Samples importieren (Ctrl+I) */
  onImportSamples?: () => void;
  /** Audio → Ordner importieren (Ctrl+Shift+I) */
  onImportFolder?: () => void;
  /** Audio → Sample-Bibliothek öffnen */
  onOpenSampleLibrary?: () => void;
  /** Bearbeiten → Rückgängig (Ctrl+Z) */
  onUndo?: () => void;
  /** Bearbeiten → Wiederholen (Ctrl+Y) */
  onRedo?: () => void;
  /** Transport → Play/Stop (Space) */
  onPlayStop?: () => void;
  /** Transport → Record (Ctrl+R) */
  onRecord?: () => void;
  /** Ansicht → Vollbild (F11) */
  onToggleFullscreen?: () => void;
  /** Projekt → Bounce (Ctrl+B) */
  onBounce?: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Bindet alle nativen Electron-Menü-Events an React-Callbacks.
 * Funktioniert nur in Electron; im Browser ist der Hook ein No-Op.
 *
 * @param bindings - Objekt mit optionalen Callback-Funktionen
 */
export function useElectronMenuBindings(bindings: MenuBindings): void {
  const isElectron = typeof window !== "undefined" && !!window.electronAPI;

  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;

    const api = window.electronAPI;
    const cleanups: Array<(() => void) | undefined> = [];

    // ── Datei-Menü ──────────────────────────────────────────────────────────
    if (bindings.onNew) {
      cleanups.push(api.onMenuNewProject?.(bindings.onNew));
    }
    if (bindings.onOpen) {
      cleanups.push(api.onMenuOpenProject?.(bindings.onOpen));
    }
    if (bindings.onSave) {
      cleanups.push(api.onMenuSaveProject?.(bindings.onSave));
    }
    if (bindings.onSaveAs) {
      cleanups.push(api.onMenuSaveProjectAs?.(bindings.onSaveAs));
    }
    if (bindings.onExport) {
      cleanups.push(api.onMenuExportProject?.(bindings.onExport));
    }

    // ── Audio-Menü ──────────────────────────────────────────────────────────
    if (bindings.onImportSamples) {
      cleanups.push(api.onMenuImportSamples?.(bindings.onImportSamples));
    }
    if (bindings.onImportFolder) {
      cleanups.push(api.onMenuImportSampleFolder?.(bindings.onImportFolder));
    }
    if (bindings.onOpenSampleLibrary) {
      cleanups.push(api.onMenuOpenSampleLibrary?.(bindings.onOpenSampleLibrary));
    }

    // ── Bearbeiten-Menü ─────────────────────────────────────────────────────
    if (bindings.onUndo) {
      cleanups.push(api.onMenuUndo?.(bindings.onUndo));
    }
    if (bindings.onRedo) {
      cleanups.push(api.onMenuRedo?.(bindings.onRedo));
    }

    // ── Transport ───────────────────────────────────────────────────────────
    if (bindings.onPlayStop) {
      cleanups.push(api.onShortcutPlayStop?.(bindings.onPlayStop));
    }
    if (bindings.onRecord) {
      cleanups.push(api.onMenuRecord?.(bindings.onRecord));
    }

    // ── Ansicht ─────────────────────────────────────────────────────────────
    if (bindings.onToggleFullscreen) {
      cleanups.push(api.onMenuToggleFullscreen?.(bindings.onToggleFullscreen));
    }

    // ── Projekt ─────────────────────────────────────────────────────────────
    if (bindings.onBounce) {
      cleanups.push(api.onMenuBounce?.(bindings.onBounce));
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────
    return () => {
      cleanups.forEach((cleanup) => cleanup?.());
    };
  }, [
    isElectron,
    bindings.onNew,
    bindings.onOpen,
    bindings.onSave,
    bindings.onSaveAs,
    bindings.onExport,
    bindings.onImportSamples,
    bindings.onImportFolder,
    bindings.onOpenSampleLibrary,
    bindings.onUndo,
    bindings.onRedo,
    bindings.onPlayStop,
    bindings.onRecord,
    bindings.onToggleFullscreen,
    bindings.onBounce,
  ]);
}

// ─── Convenience-Hook für häufige Bindings ────────────────────────────────────

/**
 * Vereinfachter Hook für die häufigsten Menü-Bindings.
 * Ideal für die Haupt-App-Komponente.
 */
export function useElectronAppMenu(options: {
  save: () => void;
  load: () => void;
  newProject: () => void;
  undo: () => void;
  redo: () => void;
  playStop: () => void;
}): void {
  useElectronMenuBindings({
    onSave: options.save,
    onOpen: options.load,
    onNew: options.newProject,
    onUndo: options.undo,
    onRedo: options.redo,
    onPlayStop: options.playStop,
  });
}
