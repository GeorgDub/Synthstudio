"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useElectronMenuBindings = useElectronMenuBindings;
exports.useElectronAppMenu = useElectronAppMenu;
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
const react_1 = require("react");
const useElectron_1 = require("../useElectron");
// ─── Hook ─────────────────────────────────────────────────────────────────────
/**
 * Bindet alle nativen Electron-Menü-Events an React-Callbacks.
 * Funktioniert nur in Electron; im Browser ist der Hook ein No-Op.
 * Alle Electron-Aufrufe gehen über den useElectron()-Hook.
 *
 * @param bindings - Objekt mit optionalen Callback-Funktionen
 */
function useElectronMenuBindings(bindings) {
    // ── Einziger Zugriffspunkt auf Electron-Features ──────────────────────────
    const electron = (0, useElectron_1.useElectron)();
    (0, react_1.useEffect)(() => {
        // Im Browser: No-Op – kein Menü vorhanden
        if (!electron.isElectron)
            return;
        const cleanups = [];
        // ── Datei-Menü ──────────────────────────────────────────────────────────
        if (bindings.onNew) {
            cleanups.push(electron.onMenuNewProject?.(bindings.onNew));
        }
        if (bindings.onOpen) {
            // onMenuOpenProject liefert optional einen filePath – wir ignorieren ihn hier
            // da App.tsx den Dialog selbst öffnet
            cleanups.push(electron.onMenuOpenProject?.(() => bindings.onOpen()));
        }
        if (bindings.onSave) {
            cleanups.push(electron.onMenuSaveProject?.(bindings.onSave));
        }
        if (bindings.onSaveAs) {
            cleanups.push(electron.onMenuSaveProjectAs?.(() => bindings.onSaveAs()));
        }
        if (bindings.onExport) {
            cleanups.push(electron.onMenuExportProject?.(bindings.onExport));
        }
        if (bindings.onImportProject) {
            cleanups.push(electron.onMenuImportProject?.(bindings.onImportProject));
        }
        // ── Audio-Menü ──────────────────────────────────────────────────────────
        if (bindings.onImportSamples) {
            cleanups.push(electron.onMenuImportSamples?.(() => bindings.onImportSamples()));
        }
        if (bindings.onImportFolder) {
            // onMenuImportSampleFolder ist der kanonische Name laut types.d.ts (BUG-001 behoben).
            cleanups.push(electron.onMenuImportSampleFolder?.(() => bindings.onImportFolder()));
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
    ]);
}
// ─── Convenience-Hook für häufige Bindings ────────────────────────────────────
/**
 * Vereinfachter Hook für die häufigsten Menü-Bindings.
 * Ideal für die Haupt-App-Komponente.
 * Alle Electron-Aufrufe gehen über useElectron().
 */
function useElectronAppMenu(options) {
    useElectronMenuBindings({
        onSave: options.save,
        onOpen: options.load,
        onNew: options.newProject,
        onUndo: options.undo,
        onRedo: options.redo,
        onPlayStop: options.playStop,
    });
}
