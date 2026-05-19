"use strict";
/**
 * Synthstudio – Electron Preload Script (v2)
 *
 * Stellt der Web-App (Renderer) eine sichere API bereit über window.electronAPI.
 * contextIsolation: true – kein direkter Node.js-Zugriff aus dem Renderer.
 *
 * Neue Kanäle in v2:
 * - Dateisystem: readFile, listDirectory, writeFile
 * - Folder-Import: importFolder, cancelImport + Progress/Cancel/Complete-Events
 * - Dialoge: openFile, saveFile, showMessage
 * - Fenster: setFullscreen, isFullscreen, minimize, maximize
 * - App: getVersion, getPlatform, getPath
 * - Benachrichtigungen: showNotification
 * - Menü-Events: alle Menü-Aktionen
 * - Shortcuts: Media-Keys
 * - Updater: check, Events
 */
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// ─── Hilfsfunktion: Event-Listener mit Cleanup ────────────────────────────────
function createEventListener(channel) {
    return (callback) => {
        const handler = (_event, data) => callback(data);
        electron_1.ipcRenderer.on(channel, handler);
        return () => electron_1.ipcRenderer.removeListener(channel, handler);
    };
}
function createVoidListener(channel) {
    return (callback) => {
        const handler = () => callback();
        electron_1.ipcRenderer.on(channel, handler);
        return () => electron_1.ipcRenderer.removeListener(channel, handler);
    };
}
// ─── API-Implementierung ─────────────────────────────────────────────────────
const electronAPI = {
    /** true wenn in Electron */
    isElectron: true,
    /** Plattform */
    platform: process.platform,
    // ── Crash-Log Bridge (DIAG-2) ────────────────────────────────────────────────
    /** Sendet einen Renderer-Crash an main's crash.log. Fire-and-forget. */
    logRendererCrash: (source, message, stack) => {
        electron_1.ipcRenderer.send("renderer:crash", { source, message, stack });
    },
    /** Loggt ein Event aus dem Renderer (für detailliertere Tracing). */
    logRendererEvent: (label, payload) => {
        electron_1.ipcRenderer.send("renderer:event", { label, payload });
    },
    /**
     * MIG-3E: Signalisiert Theme-Wechsel an main → main re-syncht alle offenen
     * dockview-popout BrowserWindows via webContents.executeJavaScript.
     */
    notifyThemeChanged: () => {
        electron_1.ipcRenderer.send("popout:theme-changed");
    },
    // ── App-Info ─────────────────────────────────────────────────────────────────
    getVersion: () => electron_1.ipcRenderer.invoke("app:get-version"),
    getPlatform: () => electron_1.ipcRenderer.invoke("app:get-platform"),
    /** Gibt einen bekannten App-Pfad zurück: home, documents, downloads, music, desktop */
    getPath: (name) => electron_1.ipcRenderer.invoke("app:get-path", name),
    // ── Dateisystem ──────────────────────────────────────────────────────────────
    readFile: (filePath) => electron_1.ipcRenderer.invoke("fs:read-file", filePath),
    listDirectory: (dirPath) => electron_1.ipcRenderer.invoke("fs:list-directory", dirPath),
    writeFile: (filePath, data) => electron_1.ipcRenderer.invoke("fs:write-file", filePath, data),
    // ── Sample-Pack-Read (v3.107.0) ─────────────────────────────────────────────
    /**
     * Registriert einen Pack-Root in der Main-Allow-List. Vor jedem
     * `packReadFile`-Call muss der dazugehörige Root einmal registriert sein
     * (idempotent). Main validiert: existiert, ist Verzeichnis, absolute path.
     */
    packRegisterRoot: (rootPath) => electron_1.ipcRenderer.invoke("pack:registerRoot", rootPath),
    /**
     * Liest eine User-importierte Sample-Datei. Main-Side validiert
     * gegen Path-Traversal: Endung-Whitelist, NUL-Byte-Defense, Root-
     * Containment (Pfad muss unter einem registrierten Root liegen),
     * 100 MB Size-Cap.
     */
    packReadFile: (filePath) => electron_1.ipcRenderer.invoke("pack:readFile", filePath),
    // ── Sample-Pack Folder-Dialog + Recursive-Scan (v3.108.0) ───────────────────
    /**
     * Öffnet den nativen Folder-Dialog. Returnt `{canceled, filePaths}` —
     * Cancel = filePaths leer. SECURITY: Pfad kommt aus dem OS-Dialog, nicht
     * vom Renderer.
     */
    packChooseFolder: () => electron_1.ipcRenderer.invoke("pack:chooseFolder"),
    /**
     * Rekursiver Scan eines bereits via `packRegisterRoot` eingetragenen
     * Pack-Roots. Main-Side enforced: max 5000 files, max 4 sub-folder depth,
     * Audio-Extension-Whitelist, kein Symlink-Follow, NUL-Byte-Defense,
     * Root-Containment-Check.
     */
    packScanFolder: (rootPath) => electron_1.ipcRenderer.invoke("pack:scanFolder", rootPath),
    // ── Audio-Recording-Save (TASK-234 / v2.86) ────────────────────────────────
    /**
     * Schreibt einen WAV-Buffer in userData/recordings/<filename>.
     * Main-Side validiert strikt (Filename, WAV-Header, Path-Traversal).
     */
    saveRecording: (filename, data) => electron_1.ipcRenderer.invoke("audio:save-recording", filename, data),
    // ── License Persistence (TASK-232 / v2.97) ─────────────────────────────────
    /**
     * Liest die persistente Lizenz-State aus userData/license.json.
     * Bei fehlender Datei: { success: true, data: null }.
     */
    readLicense: () => electron_1.ipcRenderer.invoke("license:read"),
    /**
     * Schreibt die Lizenz-State nach userData/license.json. Main-Side
     * validiert das Shape (Whitelist) bevor geschrieben wird.
     */
    writeLicense: (state) => electron_1.ipcRenderer.invoke("license:write", state),
    // ── Folder-Import ────────────────────────────────────────────────────────────
    /** Startet einen Folder-Import und gibt die importId zurück */
    importFolder: (folderPath) => electron_1.ipcRenderer.invoke("samples:import-folder", folderPath),
    /** Bricht einen laufenden Import ab */
    cancelImport: (importId) => electron_1.ipcRenderer.invoke("samples:cancel-import", importId),
    /** Startet einen ZIP-Import und gibt die importId zurück */
    importZip: (zipPath) => electron_1.ipcRenderer.invoke("samples:import-zip", zipPath),
    /** Räumt temporäre ZIP-Extraktions-Dateien auf */
    cleanupZip: (importId) => electron_1.ipcRenderer.invoke("samples:cleanup-zip", importId),
    // ── MIDI-Import ────────────────────────────────────────────────────────────
    /** Öffnet den nativen MIDI-Datei-Dialog und gibt den gewählten Pfad zurück */
    openMidiDialog: () => electron_1.ipcRenderer.invoke("midi:open-dialog"),
    /**
     * Liest eine MIDI-Datei und gibt die Bytes als Array zurück.
     * Verwendet Uint8Array-serialisierung (Array<number>), da ArrayBuffer nicht
     * direkt über den IPC-Kanal übertragen werden kann.
     */
    importMidiFile: (filePath) => electron_1.ipcRenderer.invoke("midi:import-file", filePath),
    // ── KORG Electribe Pattern-Import (TASK-237 / v2.88) ────────────────────────
    /** Öffnet den nativen Datei-Dialog für .e2pattern/.e2sallpat. */
    openElectribeDialog: () => electron_1.ipcRenderer.invoke("electribe:open-dialog"),
    /**
     * Liest eine .e2pattern/.e2sallpat-Datei und gibt die Bytes als number[]
     * zurück. Main-Side validiert Endung, Größe (max 5 MB) und Lesbarkeit.
     */
    importElectribeFile: (filePath) => electron_1.ipcRenderer.invoke("electribe:import-file", filePath),
    // ── KORG Sample-Bank-Import (v3.3.0) ─────────────────────────────────────────
    /** Öffnet den nativen Datei-Dialog für .esx/.ess/.all KORG Sample-Banks. */
    openKorgBankDialog: () => electron_1.ipcRenderer.invoke("korg:open-bank-dialog"),
    /**
     * Liest eine .esx oder .all Sample-Bank von Disk und liefert die Bytes als
     * number[]. Main-Side validiert Endung (.esx/.ess/.all), Größe (max 100 MB)
     * und Lesbarkeit. Renderer ruft anschließend parseEsxBank()/parseE2sBank().
     */
    importKorgBank: (filePath) => electron_1.ipcRenderer.invoke("korg:import-bank", filePath),
    /** Liefert das aktuelle Bank-File-Size-Cap (Bytes) für UI-Hinweise. */
    getKorgBankCap: () => electron_1.ipcRenderer.invoke("korg:get-bank-cap"),
    // ── KORG Sample-Bank EXPORT (v3.4.0) ────────────────────────────────────────
    /**
     * Speichert einen E2S `.all`-Buffer via nativen Save-Dialog. Main-Side
     * validiert Magic-Bytes + Größen-Cap (256 MB) + Endung. Pfad kommt aus
     * dem Dialog (nicht vom Renderer) — kein Path-Traversal-Vektor.
     *
     * Datenformat: ArrayBuffer wird über IPC als Uint8Array übertragen.
     */
    saveKorgBankAs: (suggestedFilename, data) => electron_1.ipcRenderer.invoke("korg:save-bank-as", suggestedFilename, data instanceof Uint8Array ? Array.from(data) : Array.from(new Uint8Array(data))),
    /** Liefert das Export-Buffer-Cap (Bytes) für UI-Hinweise. */
    getKorgBankSaveCap: () => electron_1.ipcRenderer.invoke("korg:get-bank-save-cap"),
    // ── E2 Pattern Export (v3.26.0) ────────────────────────────────────────────
    /**
     * Speichert ein gebautes 16640-Byte `.e2spat`-File via nativen Save-Dialog.
     * Main-Side validiert Magic + Größe (exakt 16640) + PTST-Marker + Endung.
     * Pfad kommt aus dem Dialog — kein Path-Traversal-Vektor.
     */
    saveE2Pattern: (suggestedFilename, data) => electron_1.ipcRenderer.invoke("electribe:save-pattern", suggestedFilename, data instanceof Uint8Array ? Array.from(data) : Array.from(new Uint8Array(data))),
    /** Liefert die exakte Hardware-Größe einer .e2spat-Datei (= 16640 Bytes). */
    getE2PatternSize: () => electron_1.ipcRenderer.invoke("electribe:get-pattern-size"),
    // ── ESX-1 Bank Pattern-Patch Export (v3.29.0) ──────────────────────────────
    /**
     * Speichert eine vom Renderer per `patchEsxBankPattern` modifizierte .esx-
     * Bank via nativen Save-Dialog. Main-Side validiert Magic (KORG@0x00 +
     * ESX\0@0x08) + Größe (Min 0x00250010..Max 64MB) + Endung (.esx). Pfad kommt
     * aus dem Dialog — kein Path-Traversal-Vektor.
     */
    saveEsxBankAs: (suggestedFilename, data) => electron_1.ipcRenderer.invoke("esx:save-bank-as", suggestedFilename, data instanceof Uint8Array ? Array.from(data) : Array.from(new Uint8Array(data))),
    /** Liefert das ESX-Bank-Save-Cap (Bytes) für UI-Hinweise. */
    getEsxBankSaveCap: () => electron_1.ipcRenderer.invoke("esx:get-bank-save-cap"),
    // ── Project AutoSave (v3.56.0) ─────────────────────────────────────────────
    /** Schreibt eine Projekt-Version unter userData/autosave/<projectId>/<versionId>.synth */
    autoSaveWrite: (projectId, versionId, json, label) => electron_1.ipcRenderer.invoke("autosave:write", projectId, versionId, json, label),
    /** Listet alle Versionen für ein Projekt (DESC nach Timestamp). */
    autoSaveList: (projectId) => electron_1.ipcRenderer.invoke("autosave:list", projectId),
    /** Lädt eine Version (JSON-Quelle zurück). */
    autoSaveRestore: (projectId, versionId) => electron_1.ipcRenderer.invoke("autosave:restore", projectId, versionId),
    /** Löscht eine Version (idempotent). */
    autoSaveDelete: (projectId, versionId) => electron_1.ipcRenderer.invoke("autosave:delete", projectId, versionId),
    // Import-Events
    onImportStarted: createEventListener("samples:import-started"),
    onImportProgress: createEventListener("samples:import-progress"),
    onImportComplete: createEventListener("samples:import-complete"),
    onImportCancelled: createEventListener("samples:import-cancelled"),
    onImportError: createEventListener("samples:import-error"),
    // ── Dialoge ──────────────────────────────────────────────────────────────────
    openFileDialog: (options) => electron_1.ipcRenderer.invoke("dialog:open-file", {
        title: options.title,
        filters: options.filters,
        properties: options.multiSelections
            ? ["openFile", "multiSelections"]
            : ["openFile"],
    }),
    saveFileDialog: (options) => electron_1.ipcRenderer.invoke("dialog:save-file", options),
    openFolderDialog: (options) => electron_1.ipcRenderer.invoke("dialog:open-file", {
        title: options?.title,
        properties: ["openDirectory"],
    }),
    showMessageDialog: (options) => electron_1.ipcRenderer.invoke("dialog:message", options),
    showConfirmDialog: (options) => electron_1.ipcRenderer.invoke("dialog:message", {
        type: "question",
        title: options.title,
        message: options.message,
        buttons: ["OK", "Abbrechen"],
        defaultId: 0,
    }),
    showErrorDialog: async (title, message) => {
        await electron_1.ipcRenderer.invoke("dialog:message", {
            type: "error",
            title,
            message,
            buttons: ["OK"],
            defaultId: 0,
        });
    },
    showInfoDialog: async (title, message) => {
        await electron_1.ipcRenderer.invoke("dialog:message", {
            type: "info",
            title,
            message,
            buttons: ["OK"],
            defaultId: 0,
        });
    },
    // ── Fenster-Steuerung ────────────────────────────────────────────────────────
    setFullscreen: (fullscreen) => electron_1.ipcRenderer.invoke("window:set-fullscreen", fullscreen),
    isFullscreen: () => electron_1.ipcRenderer.invoke("window:is-fullscreen"),
    minimizeWindow: () => electron_1.ipcRenderer.invoke("window:minimize"),
    maximizeWindow: () => electron_1.ipcRenderer.invoke("window:maximize"),
    setWindowTitle: (title) => {
        document.title = title;
    },
    // Fullscreen-Change-Event
    onFullscreenChanged: createEventListener("window:fullscreen-changed"),
    // ── Performance-Mode Popup-Window (ROADMAP feature) ──────────────────────────
    // Bidirektionaler State-Sync zwischen Haupt-Fenster und Performance-Popup.
    // Alle Payloads sind narrow-data-only (plain JSON, keine File-Paths).
    openPerformanceWindow: () => electron_1.ipcRenderer.invoke("window:open-performance"),
    closePerformanceWindow: () => electron_1.ipcRenderer.invoke("window:close-performance"),
    isPerformanceWindowOpen: () => electron_1.ipcRenderer.invoke("window:is-performance-open"),
    // State-Broadcast (Main-Renderer → Popup-Renderer via Main-Process-Routing).
    // Main-Renderer ruft das wenn sich pads/activePattern/quantize/bpm/currentStep
    // ändert. Popup-Renderer empfängt es als perf-sync:state Event.
    sendPerfPopupState: (state) => {
        electron_1.ipcRenderer.send("perf-sync:state", state);
    },
    // Action (Popup-Renderer → Main-Renderer via Main-Process-Routing).
    // Popup-Renderer ruft das wenn der User einen Pad klickt / Quantize-Mode
    // ändert. Main-Renderer empfängt es als perf-sync:action Event und dispatcht
    // in seine Stores.
    sendPerfPopupAction: (action) => {
        electron_1.ipcRenderer.send("perf-sync:action", action);
    },
    onPerfPopupState: createEventListener("perf-sync:state"),
    onPerfPopupAction: createEventListener("perf-sync:action"),
    onPerfPopupClosed: createVoidListener("perf-window:closed"),
    // Phase 2: Always-on-top für das Performance-Popup
    setPerfPopupAlwaysOnTop: (alwaysOnTop) => electron_1.ipcRenderer.invoke("window:perf-set-always-on-top", alwaysOnTop),
    isPerfPopupAlwaysOnTop: () => electron_1.ipcRenderer.invoke("window:perf-is-always-on-top"),
    // ── FX-Window Popup (Multi-Window-Workspace Phase 1, post-v1.25.0) ───────────
    // Pro Kanal ein eigenes pinnable FX-Window. Identisches Pattern wie das
    // Performance-Popup: schmale Channels, narrow-data-only Payloads.
    openFxWindow: (channelId) => electron_1.ipcRenderer.invoke("window:open-fx", channelId),
    closeFxWindow: (channelId) => electron_1.ipcRenderer.invoke("window:close-fx", channelId),
    isFxWindowOpen: (channelId) => electron_1.ipcRenderer.invoke("window:is-fx-open", channelId),
    setFxWindowAlwaysOnTop: (channelId, alwaysOnTop) => electron_1.ipcRenderer.invoke("window:fx-set-always-on-top", { channelId, alwaysOnTop }),
    isFxWindowAlwaysOnTop: (channelId) => electron_1.ipcRenderer.invoke("window:fx-is-always-on-top", channelId),
    // State-Broadcast: Main-Renderer → FX-Popup-Renderer (via Main-Process-Routing).
    // Wird im Main-Renderer bei Änderungen des Kanal-FX-State gefeuert.
    sendFxPopupState: (channelId, state) => {
        electron_1.ipcRenderer.send("fx-sync:state", { channelId, state });
    },
    // Action: FX-Popup-Renderer → Main-Renderer. Popup ruft das wenn der User
    // einen FX-Parameter ändert. Main-Renderer empfängt es und dispatcht in den
    // useDrumMachineStore.
    sendFxPopupAction: (channelId, action) => {
        electron_1.ipcRenderer.send("fx-sync:action", { channelId, action });
    },
    onFxPopupState: createEventListener("fx-sync:state"),
    onFxPopupAction: createEventListener("fx-sync:action"),
    onFxPopupClosed: createEventListener("fx-window:closed"),
    // ── Mixer-Window Popup (Multi-Window-Workspace, post-v1.26.0) ────────────────
    // Singleton-Popup wie Performance-Mode. Channels narrow-data-only.
    openMixerWindow: () => electron_1.ipcRenderer.invoke("window:open-mixer"),
    closeMixerWindow: () => electron_1.ipcRenderer.invoke("window:close-mixer"),
    isMixerWindowOpen: () => electron_1.ipcRenderer.invoke("window:is-mixer-open"),
    setMixerWindowAlwaysOnTop: (alwaysOnTop) => electron_1.ipcRenderer.invoke("window:mixer-set-always-on-top", alwaysOnTop),
    isMixerWindowAlwaysOnTop: () => electron_1.ipcRenderer.invoke("window:mixer-is-always-on-top"),
    sendMixerPopupState: (state) => {
        electron_1.ipcRenderer.send("mixer-sync:state", state);
    },
    sendMixerPopupAction: (action) => {
        electron_1.ipcRenderer.send("mixer-sync:action", action);
    },
    onMixerPopupState: createEventListener("mixer-sync:state"),
    onMixerPopupAction: createEventListener("mixer-sync:action"),
    onMixerPopupClosed: createVoidListener("mixer-window:closed"),
    // ── Sample-Browser-Window Popup (Multi-Window-Workspace, post-v1.27.0) ───────
    // Singleton-Popup. Browse-only View — Pin-Pattern mit click-to-assign.
    openSampleBrowserWindow: () => electron_1.ipcRenderer.invoke("window:open-sample-browser"),
    closeSampleBrowserWindow: () => electron_1.ipcRenderer.invoke("window:close-sample-browser"),
    isSampleBrowserWindowOpen: () => electron_1.ipcRenderer.invoke("window:is-sample-browser-open"),
    setSampleBrowserWindowAlwaysOnTop: (alwaysOnTop) => electron_1.ipcRenderer.invoke("window:sample-browser-set-always-on-top", alwaysOnTop),
    isSampleBrowserWindowAlwaysOnTop: () => electron_1.ipcRenderer.invoke("window:sample-browser-is-always-on-top"),
    sendSampleBrowserPopupState: (state) => {
        electron_1.ipcRenderer.send("sample-browser-sync:state", state);
    },
    sendSampleBrowserPopupAction: (action) => {
        electron_1.ipcRenderer.send("sample-browser-sync:action", action);
    },
    onSampleBrowserPopupState: createEventListener("sample-browser-sync:state"),
    onSampleBrowserPopupAction: createEventListener("sample-browser-sync:action"),
    onSampleBrowserPopupClosed: createVoidListener("sample-browser-window:closed"),
    // ── Pattern-Generator-Window Popup (Multi-Window-Workspace, post-v1.27.0) ────
    // Singleton-Popup. Apply-Pattern flow via Action-Channel.
    openPatternGenWindow: () => electron_1.ipcRenderer.invoke("window:open-pattern-gen"),
    closePatternGenWindow: () => electron_1.ipcRenderer.invoke("window:close-pattern-gen"),
    isPatternGenWindowOpen: () => electron_1.ipcRenderer.invoke("window:is-pattern-gen-open"),
    setPatternGenWindowAlwaysOnTop: (alwaysOnTop) => electron_1.ipcRenderer.invoke("window:pattern-gen-set-always-on-top", alwaysOnTop),
    isPatternGenWindowAlwaysOnTop: () => electron_1.ipcRenderer.invoke("window:pattern-gen-is-always-on-top"),
    sendPatternGenPopupAction: (action) => {
        electron_1.ipcRenderer.send("pattern-gen-sync:action", action);
    },
    onPatternGenPopupAction: createEventListener("pattern-gen-sync:action"),
    onPatternGenPopupClosed: createVoidListener("pattern-gen-window:closed"),
    // ── Tools-Popup-Windows (post-v1.28.0) ───────────────────────────────────────
    // Keyboard Sampler, Chord Progression, Pattern Library — drei singletons,
    // selbes Muster wie Mixer-Window.
    openKeyboardSamplerWindow: () => electron_1.ipcRenderer.invoke("window:open-keyboard-sampler"),
    closeKeyboardSamplerWindow: () => electron_1.ipcRenderer.invoke("window:close-keyboard-sampler"),
    isKeyboardSamplerWindowOpen: () => electron_1.ipcRenderer.invoke("window:is-keyboard-sampler-open"),
    setKeyboardSamplerWindowAlwaysOnTop: (alwaysOnTop) => electron_1.ipcRenderer.invoke("window:keyboard-sampler-set-always-on-top", alwaysOnTop),
    isKeyboardSamplerWindowAlwaysOnTop: () => electron_1.ipcRenderer.invoke("window:keyboard-sampler-is-always-on-top"),
    sendKeyboardSamplerPopupState: (state) => {
        electron_1.ipcRenderer.send("keyboard-sampler-sync:state", state);
    },
    sendKeyboardSamplerPopupAction: (action) => {
        electron_1.ipcRenderer.send("keyboard-sampler-sync:action", action);
    },
    onKeyboardSamplerPopupState: createEventListener("keyboard-sampler-sync:state"),
    onKeyboardSamplerPopupAction: createEventListener("keyboard-sampler-sync:action"),
    onKeyboardSamplerPopupClosed: createVoidListener("keyboardSamplerPopup-window:closed"),
    openChordProgressionWindow: () => electron_1.ipcRenderer.invoke("window:open-chord-progression"),
    closeChordProgressionWindow: () => electron_1.ipcRenderer.invoke("window:close-chord-progression"),
    isChordProgressionWindowOpen: () => electron_1.ipcRenderer.invoke("window:is-chord-progression-open"),
    setChordProgressionWindowAlwaysOnTop: (alwaysOnTop) => electron_1.ipcRenderer.invoke("window:chord-progression-set-always-on-top", alwaysOnTop),
    isChordProgressionWindowAlwaysOnTop: () => electron_1.ipcRenderer.invoke("window:chord-progression-is-always-on-top"),
    sendChordProgressionPopupState: (state) => {
        electron_1.ipcRenderer.send("chord-progression-sync:state", state);
    },
    sendChordProgressionPopupAction: (action) => {
        electron_1.ipcRenderer.send("chord-progression-sync:action", action);
    },
    onChordProgressionPopupState: createEventListener("chord-progression-sync:state"),
    onChordProgressionPopupAction: createEventListener("chord-progression-sync:action"),
    onChordProgressionPopupClosed: createVoidListener("chordProgressionPopup-window:closed"),
    openPatternLibraryWindow: () => electron_1.ipcRenderer.invoke("window:open-pattern-library"),
    closePatternLibraryWindow: () => electron_1.ipcRenderer.invoke("window:close-pattern-library"),
    isPatternLibraryWindowOpen: () => electron_1.ipcRenderer.invoke("window:is-pattern-library-open"),
    setPatternLibraryWindowAlwaysOnTop: (alwaysOnTop) => electron_1.ipcRenderer.invoke("window:pattern-library-set-always-on-top", alwaysOnTop),
    isPatternLibraryWindowAlwaysOnTop: () => electron_1.ipcRenderer.invoke("window:pattern-library-is-always-on-top"),
    sendPatternLibraryPopupState: (state) => {
        electron_1.ipcRenderer.send("pattern-library-sync:state", state);
    },
    sendPatternLibraryPopupAction: (action) => {
        electron_1.ipcRenderer.send("pattern-library-sync:action", action);
    },
    onPatternLibraryPopupState: createEventListener("pattern-library-sync:state"),
    onPatternLibraryPopupAction: createEventListener("pattern-library-sync:action"),
    onPatternLibraryPopupClosed: createVoidListener("patternLibraryPopup-window:closed"),
    // ── Benachrichtigungen ───────────────────────────────────────────────────────
    showNotification: (title, body) => electron_1.ipcRenderer.invoke("notification:show", title, body),
    openExternal: async (url) => {
        window.open(url, "_blank", "noopener,noreferrer");
        return { success: true };
    },
    showItemInFolder: (_filePath) => { },
    fileExists: async (_filePath) => ({ exists: false }),
    getFileStats: async (_filePath) => ({ success: false }),
    importSamples: async (_filePaths) => ({ success: false, importedCount: 0, errors: [] }),
    // ── Menü-Events (Main → Renderer) ────────────────────────────────────────────
    onMenuNewProject: createVoidListener("menu:new-project"),
    onMenuOpenProject: createEventListener("menu:open-project"),
    onMenuSaveProject: createVoidListener("menu:save-project"),
    onMenuSaveProjectAs: createEventListener("menu:save-project-as"),
    onMenuExportProject: createVoidListener("menu:export-project"),
    onMenuImportProject: createVoidListener("menu:import-project"),
    onMenuUndo: createVoidListener("menu:undo"),
    onMenuRedo: createVoidListener("menu:redo"),
    onMenuOpenSampleBrowser: createVoidListener("menu:open-sample-browser"),
    onMenuImportSamples: createEventListener("menu:import-samples"),
    onMenuImportSampleFolder: createEventListener("menu:import-sample-folder"),
    onMenuImportMidi: createEventListener("menu:import-midi"),
    onMenuTransportToggle: createVoidListener("menu:transport-toggle"),
    onMenuTransportRecord: createVoidListener("menu:transport-record"),
    onMenuRecord: createVoidListener("menu:record"),
    onMenuToggleFullscreen: createVoidListener("menu:toggle-fullscreen"),
    onMenuBounce: createVoidListener("menu:bounce"),
    onMenuOpenSampleLibrary: createVoidListener("menu:open-sample-library"),
    // post-v1.25.0 — neue Menü-Items für Music-Production-fokussierte Menübar
    onMenuPatternClear: createVoidListener("menu:pattern-clear"),
    onMenuPatternRandomize: createVoidListener("menu:pattern-randomize"),
    onMenuPatternFill: createVoidListener("menu:pattern-fill"),
    onMenuPatternDuplicate: createVoidListener("menu:pattern-duplicate"),
    onMenuPatternNext: createVoidListener("menu:pattern-next"),
    onMenuPatternPrev: createVoidListener("menu:pattern-prev"),
    onMenuBpmUp: createVoidListener("menu:bpm-up"),
    onMenuBpmDown: createVoidListener("menu:bpm-down"),
    onMenuTapTempo: createVoidListener("menu:tap-tempo"),
    onMenuOpenPerformance: createVoidListener("menu:open-performance"),
    onMenuOpenAudioWorkbench: createVoidListener("menu:open-audio-workbench"),
    onMenuTab: createEventListener("menu:tab"),
    // ── Keyboard-Shortcuts (globale Media-Keys) ──────────────────────────────────
    onShortcutTransportToggle: createVoidListener("shortcut:transport-toggle"),
    onShortcutTransportStop: createVoidListener("shortcut:transport-stop"),
    onShortcutPlayStop: createVoidListener("shortcut:play-stop"),
    onShortcutUndo: createVoidListener("shortcut:undo"),
    onShortcutRedo: createVoidListener("shortcut:redo"),
    onShortcutSave: createVoidListener("shortcut:save"),
    // ── Auto-Updater ──────────────────────────────────────────────────────────
    checkForUpdates: () => {
        electron_1.ipcRenderer.send("updater:check");
    },
    onUpdaterChecking: createVoidListener("updater:checking"),
    onUpdaterUpdateAvailable: createEventListener("updater:update-available"),
    onUpdaterUpToDate: createVoidListener("updater:up-to-date"),
    onUpdaterDownloadProgress: createEventListener("updater:download-progress"),
    onUpdaterUpdateDownloaded: createEventListener("updater:update-downloaded"),
    onUpdaterError: createEventListener("updater:error"),
    // ── App-Store ─────────────────────────────────────────────────────────────
    /** Einen Store-Wert lesen */
    storeGet: (key) => electron_1.ipcRenderer.invoke("store:get", key),
    /** Einen Store-Wert setzen */
    storeSet: (key, value) => electron_1.ipcRenderer.invoke("store:set", key, value),
    /** Zuletzt geöffnete Projekte abrufen */
    storeGetRecent: () => electron_1.ipcRenderer.invoke("store:get-recent"),
    /** Projekt zu zuletzt geöffneten hinzufügen */
    storeAddRecent: (filePath) => electron_1.ipcRenderer.invoke("store:add-recent", filePath),
    /** Projekt aus zuletzt geöffneten entfernen */
    storeRemoveRecent: (filePath) => electron_1.ipcRenderer.invoke("store:remove-recent", filePath),
    /** Alle zuletzt geöffneten Projekte löschen */
    storeClearRecent: () => electron_1.ipcRenderer.invoke("store:clear-recent"),
    /** Listener für Änderungen an zuletzt geöffneten Projekten */
    onRecentProjectsChanged: createEventListener("store:recent-changed"),
    // ── Waveform-Preview ──────────────────────────────────────────────────────
    /** Waveform-Peaks für eine lokale Audio-Datei abrufen */
    analyzeWaveform: (filePath, numPeaks) => electron_1.ipcRenderer.invoke("waveform:get-peaks", filePath, numPeaks ?? 200),
    /** Audio-Datei-Metadaten abrufen */
    getAudioMetadata: (filePath) => electron_1.ipcRenderer.invoke("waveform:get-metadata", filePath),
    // ── Drag & Drop ──────────────────────────────────────────────────────────
    /** Gedropte Dateipfade verarbeiten und kategorisieren */
    processDragDropFiles: (filePaths) => electron_1.ipcRenderer.invoke("dragdrop:process-files", filePaths),
    onDragDropOpenProject: createEventListener("dragdrop:open-project"),
    onDragDropLoadSample: createEventListener("dragdrop:load-sample"),
    onDragDropBulkImport: createEventListener("dragdrop:bulk-import"),
    // ── Multi-Window ──────────────────────────────────────────────────────────
    /** Neues Fenster öffnen (optional mit Projekt-Pfad) */
    openNewWindow: (projectPath) => electron_1.ipcRenderer.invoke("window:new", projectPath),
    /** Alle offenen Fenster auflisten */
    listWindows: () => electron_1.ipcRenderer.invoke("window:list"),
    /** Fenster fokussieren */
    focusWindow: (windowId) => electron_1.ipcRenderer.invoke("window:focus", windowId),
    /** Fenster-Zustand aktualisieren (Titel, isDirty, canUndo, canRedo) */
    updateWindowState: (updates) => electron_1.ipcRenderer.invoke("window:update-state", updates),
    /** Fenster schließen (auch wenn ungespeicherte Änderungen) */
    forceCloseWindow: () => electron_1.ipcRenderer.invoke("window:force-close"),
    /** Zuletzt geöffnete Projekte aus dem Fenster-Manager abrufen */
    getRecentProjectsFromWindows: () => electron_1.ipcRenderer.invoke("window:get-recent-projects"),
    onWindowConfirmClose: createVoidListener("window:confirm-close"),
    // ── Export ──────────────────────────────────────────────────────────────
    /** WAV-Export: PCM-Daten als WAV-Datei speichern */
    exportWav: (options) => electron_1.ipcRenderer.invoke("export:wav", options),
    /** MIDI-Export: Pattern als MIDI-Datei speichern */
    exportMidi: (options) => electron_1.ipcRenderer.invoke("export:midi", options),
    /** Projekt-Export: JSON-Daten als .synth-Datei speichern */
    exportProject: (options) => electron_1.ipcRenderer.invoke("export:project", options),
    /** Stereo WAV-Export: Separate L/R-Kanäle als Stereo-WAV-Datei speichern */
    exportWavStereo: (options) => electron_1.ipcRenderer.invoke("export:wav-stereo", options),
    /** Projekt-Import: .synth/.json-Datei lesen */
    importProject: (filePath) => electron_1.ipcRenderer.invoke("export:import-project", filePath),
    /** Bundle-Export: WAV-Stems + MIDI + Metadaten als ZIP */
    exportBundle: (options) => electron_1.ipcRenderer.invoke("export:bundle", options),
    // ── Kollaborations-Session ────────────────────────────────────────────────────
    /** Startet den lokalen Kollaborations-WebSocket-Server. */
    startCollabServer: () => electron_1.ipcRenderer.invoke("collab:start"),
    /** Stoppt den Kollaborations-Server. */
    stopCollabServer: () => electron_1.ipcRenderer.invoke("collab:stop"),
    /** Gibt lokale IP-Adresse und Server-Port zurück. */
    getCollabAddress: () => electron_1.ipcRenderer.invoke("collab:get-address"),
    /** Startet UDP-Broadcast damit andere die Session finden. */
    startCollabAnnounce: (roomCode) => electron_1.ipcRenderer.invoke("collab:announce-start", roomCode),
    /** Stoppt den UDP-Broadcast. */
    stopCollabAnnounce: () => electron_1.ipcRenderer.invoke("collab:announce-stop"),
    /** Startet den UDP-Listener für entdeckte Sessions. */
    startCollabDiscovery: () => electron_1.ipcRenderer.invoke("collab:discovery-start"),
    /** Stoppt den UDP-Listener. */
    stopCollabDiscovery: () => electron_1.ipcRenderer.invoke("collab:discovery-stop"),
    /** Gibt alle aktuell sichtbaren Sessions im Netzwerk zurück. */
    getDiscoveredSessions: () => electron_1.ipcRenderer.invoke("collab:get-discovered"),
    // ─── v2.23: Direkter OSC-UDP-Listener ─────────────────────────────────────
    startOscServer: (options) => electron_1.ipcRenderer.invoke("osc:start", options),
    stopOscServer: () => electron_1.ipcRenderer.invoke("osc:stop"),
    getOscServerStatus: () => electron_1.ipcRenderer.invoke("osc:status"),
    onOscIncoming: (cb) => {
        const handler = (_e, payload) => cb(payload);
        electron_1.ipcRenderer.on("osc:incoming", handler);
        return () => electron_1.ipcRenderer.removeListener("osc:incoming", handler);
    },
    // v2.26: OSC-Send-Out
    sendOscMessage: (options) => electron_1.ipcRenderer.invoke("osc:send", options),
};
electron_1.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
