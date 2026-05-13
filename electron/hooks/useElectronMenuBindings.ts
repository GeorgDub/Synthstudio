/**
 * Synthstudio – useElectronMenuBindings (Frontend-Agent)
 *
 * Custom Hook der alle nativen Electron-Menü-Events an React-Callbacks bindet.
 * Cleanup erfolgt automatisch beim Unmount der Komponente.
 *
 * ─── GOLDENES GESETZ ─────────────────────────────────────────────────────────
 * Alle Electron-Aufrufe gehen über den useElectron()-Hook.
 * Kein direktes window.electronAPI. Im Browser ist dieser Hook ein No-Op.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Verwendung:
 * ```tsx
 * useElectronMenuBindings({
 *   onSave: () => saveProject(),
 *   onNew: () => newProject(),
 *   onOpen: () => openProjectDialog(),
 *   onExport: () => exportDialog(),
 *   onImportSamples: () => importSamplesDialog(),
 *   onImportFolder: () => importFolderDialog(),
 * });
 * ```
 */
import { useEffect } from "react";
import { useElectron } from "../useElectron";

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
  /** Datei → Projekt importieren (Ctrl+I aus Datei-Menü) */
  onImportProject?: () => void;
  /**
   * Audio → Samples importieren
   * Entspricht onMenuImportSamples in der Electron-API.
   */
  onImportSamples?: () => void;
  /**
   * Audio → Ordner importieren (Ctrl+Shift+I)
   * Entspricht `onMenuImportSampleFolder` in der Electron-API (types.d.ts).
   * BUG-001 behoben: kanonischer Name ist onMenuImportSampleFolder.
   */
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

  // ── post-v1.25.0 — Music-Production-fokussierte Menü-Items ─────────────────
  /** Bearbeiten → Pattern leeren */
  onPatternClear?: () => void;
  /** Bearbeiten → Pattern zufällig füllen */
  onPatternRandomize?: () => void;
  /** Bearbeiten → Pattern füllen */
  onPatternFill?: () => void;
  /** Bearbeiten → Pattern duplizieren */
  onPatternDuplicate?: () => void;
  /** Transport → Nächstes Pattern (Ctrl+Right) */
  onPatternNext?: () => void;
  /** Transport → Vorheriges Pattern (Ctrl+Left) */
  onPatternPrev?: () => void;
  /** Transport → BPM erhöhen (Ctrl+Up) */
  onBpmUp?: () => void;
  /** Transport → BPM verringern (Ctrl+Down) */
  onBpmDown?: () => void;
  /** Transport → Tap Tempo (Ctrl+T) */
  onTapTempo?: () => void;
  /** Fenster → Performance Mode (F12) — Inline-Mode-Toggle */
  onOpenPerformance?: () => void;
  /** Sample → Audio-Workbench öffnen */
  onOpenAudioWorkbench?: () => void;
  /** Ansicht → Tab wechseln (F1–F6) */
  onTabChange?: (tabId: string) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Bindet alle nativen Electron-Menü-Events an React-Callbacks.
 * Funktioniert nur in Electron; im Browser ist der Hook ein No-Op.
 * Alle Electron-Aufrufe gehen über den useElectron()-Hook.
 *
 * @param bindings - Objekt mit optionalen Callback-Funktionen
 */
export function useElectronMenuBindings(bindings: MenuBindings): void {
  // ── Einziger Zugriffspunkt auf Electron-Features ──────────────────────────
  const electron = useElectron();

  useEffect(() => {
    // Im Browser: No-Op – kein Menü vorhanden
    if (!electron.isElectron) return;

    const cleanups: Array<(() => void) | undefined> = [];

    // ── Datei-Menü ──────────────────────────────────────────────────────────
    if (bindings.onNew) {
      cleanups.push(electron.onMenuNewProject?.(bindings.onNew));
    }
    if (bindings.onOpen) {
      // onMenuOpenProject liefert optional einen filePath – wir ignorieren ihn hier
      // da App.tsx den Dialog selbst öffnet
      cleanups.push(electron.onMenuOpenProject?.(() => bindings.onOpen!()));
    }
    if (bindings.onSave) {
      cleanups.push(electron.onMenuSaveProject?.(bindings.onSave));
    }
    if (bindings.onSaveAs) {
      cleanups.push(electron.onMenuSaveProjectAs?.(() => bindings.onSaveAs!()));
    }
    if (bindings.onExport) {
      cleanups.push(electron.onMenuExportProject?.(bindings.onExport));
    }
    if (bindings.onImportProject) {
      cleanups.push(electron.onMenuImportProject?.(bindings.onImportProject));
    }

    // ── Audio-Menü ──────────────────────────────────────────────────────────
    if (bindings.onImportSamples) {
      cleanups.push(electron.onMenuImportSamples?.(() => bindings.onImportSamples!()));
    }
    if (bindings.onImportFolder) {
      // onMenuImportSampleFolder ist der kanonische Name laut types.d.ts (BUG-001 behoben).
      cleanups.push(electron.onMenuImportSampleFolder?.(() => bindings.onImportFolder!()));
    }
    if (bindings.onOpenSampleLibrary) {
      cleanups.push(electron.onMenuOpenSampleBrowser?.(bindings.onOpenSampleLibrary));
    }

    // ── Bearbeiten-Menü ─────────────────────────────────────────────────────
    if (bindings.onUndo) {
      cleanups.push(electron.onMenuUndo?.(bindings.onUndo));
    }
    if (bindings.onRedo) {
      cleanups.push(electron.onMenuRedo?.(bindings.onRedo));
    }

    // ── Transport ───────────────────────────────────────────────────────────
    // onMenuTransportToggle = Play/Stop (Space) – entspricht onShortcutPlayStop
    if (bindings.onPlayStop) {
      cleanups.push(electron.onMenuTransportToggle?.(bindings.onPlayStop));
    }
    // onMenuTransportRecord = Aufnahme starten/stoppen
    if (bindings.onRecord) {
      cleanups.push(electron.onMenuTransportRecord?.(bindings.onRecord));
    }

    // ── Ansicht & Bounce ─────────────────────────────────────────────────────
    if (bindings.onToggleFullscreen) {
      cleanups.push(electron.onMenuToggleFullscreen?.(bindings.onToggleFullscreen));
    }
    if (bindings.onBounce) {
      cleanups.push(electron.onMenuBounce?.(bindings.onBounce));
    }

    // ── post-v1.25.0 — Music-Production-Menü-Items ──────────────────────────
    if (bindings.onPatternClear) {
      cleanups.push(electron.onMenuPatternClear?.(bindings.onPatternClear));
    }
    if (bindings.onPatternRandomize) {
      cleanups.push(electron.onMenuPatternRandomize?.(bindings.onPatternRandomize));
    }
    if (bindings.onPatternFill) {
      cleanups.push(electron.onMenuPatternFill?.(bindings.onPatternFill));
    }
    if (bindings.onPatternDuplicate) {
      cleanups.push(electron.onMenuPatternDuplicate?.(bindings.onPatternDuplicate));
    }
    if (bindings.onPatternNext) {
      cleanups.push(electron.onMenuPatternNext?.(bindings.onPatternNext));
    }
    if (bindings.onPatternPrev) {
      cleanups.push(electron.onMenuPatternPrev?.(bindings.onPatternPrev));
    }
    if (bindings.onBpmUp) {
      cleanups.push(electron.onMenuBpmUp?.(bindings.onBpmUp));
    }
    if (bindings.onBpmDown) {
      cleanups.push(electron.onMenuBpmDown?.(bindings.onBpmDown));
    }
    if (bindings.onTapTempo) {
      cleanups.push(electron.onMenuTapTempo?.(bindings.onTapTempo));
    }
    if (bindings.onOpenPerformance) {
      cleanups.push(electron.onMenuOpenPerformance?.(bindings.onOpenPerformance));
    }
    if (bindings.onOpenAudioWorkbench) {
      cleanups.push(electron.onMenuOpenAudioWorkbench?.(bindings.onOpenAudioWorkbench));
    }
    if (bindings.onTabChange) {
      cleanups.push(electron.onMenuTab?.((tabId) => {
        if (typeof tabId === "string") bindings.onTabChange!(tabId);
      }));
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────
    return () => {
      cleanups.forEach((cleanup) => cleanup?.());
    };
  }, [
    electron,
    bindings.onNew,
    bindings.onOpen,
    bindings.onSave,
    bindings.onSaveAs,
    bindings.onExport,
    bindings.onImportProject,
    bindings.onImportSamples,
    bindings.onImportFolder,
    bindings.onOpenSampleLibrary,
    bindings.onUndo,
    bindings.onRedo,
    bindings.onPlayStop,
    bindings.onRecord,
    bindings.onToggleFullscreen,
    bindings.onBounce,
    bindings.onPatternClear,
    bindings.onPatternRandomize,
    bindings.onPatternFill,
    bindings.onPatternDuplicate,
    bindings.onPatternNext,
    bindings.onPatternPrev,
    bindings.onBpmUp,
    bindings.onBpmDown,
    bindings.onTapTempo,
    bindings.onOpenPerformance,
    bindings.onOpenAudioWorkbench,
    bindings.onTabChange,
  ]);
}

// ─── Convenience-Hook für häufige Bindings ────────────────────────────────────

/**
 * Vereinfachter Hook für die häufigsten Menü-Bindings.
 * Ideal für die Haupt-App-Komponente.
 * Alle Electron-Aufrufe gehen über useElectron().
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
