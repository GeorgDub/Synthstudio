/**
 * Synthstudio – Electron API Mock (Testing-Agent)
 *
 * Vollständiger vi.fn()-Mock für window.electronAPI.
 * Für alle Unit-Tests und Komponenten-Tests die Electron-Features nutzen.
 *
 * Verwendung:
 * ```ts
 * import { setupElectronMock, resetElectronMock } from "./mocks/electronAPI";
 *
 * beforeEach(() => setupElectronMock());
 * afterEach(() => resetElectronMock());
 *
 * // Mit partiellen Overrides:
 * setupElectronMock({ openFileDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ["/test.wav"] }) });
 * ```
 */
import { vi } from "vitest";
import type { RecentProject } from "../../../electron/store";

// ─── Typen ────────────────────────────────────────────────────────────────────

type MockFn = ReturnType<typeof vi.fn>;
type CleanupFn = () => void;

/** Partieller Override für createElectronMock */
export type ElectronMockOverrides = Partial<Record<string, MockFn>>;

// ─── Standard-Rückgabewerte ───────────────────────────────────────────────────

const DEFAULT_FILE_DIALOG_RESULT = { canceled: false, filePaths: ["/test/sample.wav"] };
const DEFAULT_SAVE_DIALOG_RESULT = { canceled: false, filePath: "/test/export.wav" };
const DEFAULT_CONFIRM_RESULT = { response: 0 }; // 0 = Bestätigt
const DEFAULT_RECENT_PROJECTS: RecentProject[] = [
  { filePath: "/projects/test.esx1", name: "test", lastOpened: "2025-01-01T00:00:00Z" },
];

// ─── Listener-Mock-Factory ────────────────────────────────────────────────────

/** Erstellt einen Mock-Listener der eine Cleanup-Funktion zurückgibt */
function mockListener(): MockFn {
  return vi.fn().mockReturnValue(vi.fn() as CleanupFn);
}

// ─── Mock-Objekt erstellen ────────────────────────────────────────────────────

export function createElectronMock(overrides: ElectronMockOverrides = {}): typeof window.electronAPI {
  const mock = {
    // ── Datei-Dialoge ────────────────────────────────────────────────────────
    openFileDialog: vi.fn().mockResolvedValue(DEFAULT_FILE_DIALOG_RESULT),
    openFolderDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ["/test/samples"] }),
    saveFileDialog: vi.fn().mockResolvedValue(DEFAULT_SAVE_DIALOG_RESULT),
    showConfirmDialog: vi.fn().mockResolvedValue(DEFAULT_CONFIRM_RESULT),
    showErrorDialog: vi.fn().mockResolvedValue(undefined),
    showInfoDialog: vi.fn().mockResolvedValue(undefined),

    // ── Dateisystem ──────────────────────────────────────────────────────────
    readFile: vi.fn().mockResolvedValue({ success: true, data: Buffer.from([]).toString("base64") }),
    writeFile: vi.fn().mockResolvedValue({ success: true }),
    fileExists: vi.fn().mockResolvedValue({ exists: true }),
    getFileStats: vi.fn().mockResolvedValue({ success: true, stats: { size: 1024, mtime: Date.now() } }),

    // ── Sample-Import ────────────────────────────────────────────────────────
    importSamples: vi.fn().mockResolvedValue({ success: true, importedCount: 1, errors: [] }),
    importFolder: vi.fn().mockResolvedValue({ success: true, importedCount: 5, errors: [] }),
    cancelImport: vi.fn().mockResolvedValue({ success: true }),

    // ── Import-Events ────────────────────────────────────────────────────────
    onImportProgress: mockListener(),
    onImportComplete: mockListener(),
    onImportError: mockListener(),

    // ── Waveform ─────────────────────────────────────────────────────────────
    analyzeWaveform: vi.fn().mockResolvedValue({
      success: true,
      peaks: new Array(200).fill(0).map((_, i) => Math.abs(Math.sin(i * 0.1))),
      duration: 2.5,
      sampleRate: 44100,
      channels: 1,
    }),

    // ── Export ───────────────────────────────────────────────────────────────
    exportWav: vi.fn().mockResolvedValue({ success: true, filePath: "/test/export.wav" }),
    exportWavStereo: vi.fn().mockResolvedValue({ success: true, filePath: "/test/export-stereo.wav" }),
    exportMidi: vi.fn().mockResolvedValue({ success: true, filePath: "/test/export.mid" }),
    exportProject: vi.fn().mockResolvedValue({ success: true, filePath: "/test/project.esx1" }),
    importProject: vi.fn().mockResolvedValue({ success: true, data: {} }),

    // ── Store ────────────────────────────────────────────────────────────────
    storeGet: vi.fn().mockResolvedValue({ success: true, data: "dark" }),
    storeSet: vi.fn().mockResolvedValue({ success: true }),
    storeGetRecent: vi.fn().mockResolvedValue({ success: true, data: DEFAULT_RECENT_PROJECTS }),
    storeAddRecent: vi.fn().mockResolvedValue({ success: true }),
    storeRemoveRecent: vi.fn().mockResolvedValue({ success: true }),
    storeClearRecent: vi.fn().mockResolvedValue({ success: true }),
    onRecentProjectsChanged: mockListener(),

    // ── Fenster-Steuerung ────────────────────────────────────────────────────
    minimizeWindow: vi.fn(),
    maximizeWindow: vi.fn(),
    forceCloseWindow: vi.fn(),
    setFullscreen: vi.fn().mockResolvedValue({ success: true }),
    isFullscreen: vi.fn().mockResolvedValue({ isFullscreen: false }),
    setWindowTitle: vi.fn(),

    // ── Menü-Events ──────────────────────────────────────────────────────────
    onMenuNewProject: mockListener(),
    onMenuOpenProject: mockListener(),
    onMenuSaveProject: mockListener(),
    onMenuSaveProjectAs: mockListener(),
    onMenuExportProject: mockListener(),
    onMenuImportSamples: mockListener(),
    onMenuImportFolder: mockListener(),
    onMenuOpenSampleLibrary: mockListener(),
    onMenuUndo: mockListener(),
    onMenuRedo: mockListener(),
    onMenuRecord: mockListener(),
    onMenuToggleFullscreen: mockListener(),
    onMenuBounce: mockListener(),

    // ── Shortcuts ────────────────────────────────────────────────────────────
    onShortcutPlayStop: mockListener(),
    onShortcutUndo: mockListener(),
    onShortcutRedo: mockListener(),
    onShortcutSave: mockListener(),

    // ── Drag & Drop ──────────────────────────────────────────────────────────
    onDragDropBulkImport: mockListener(),
    onDragDropLoadSample: mockListener(),
    onDragDropOpenProject: mockListener(),

    // ── Benachrichtigungen ───────────────────────────────────────────────────
    showNotification: vi.fn(),

    // ── System ───────────────────────────────────────────────────────────────
    getAppVersion: vi.fn().mockResolvedValue("1.0.0"),
    getPlatform: vi.fn().mockReturnValue("linux"),
    openExternal: vi.fn().mockResolvedValue({ success: true }),
    showItemInFolder: vi.fn(),

    // Overrides anwenden
    ...overrides,
  } as unknown as typeof window.electronAPI;

  return mock;
}

// ─── Setup / Reset ────────────────────────────────────────────────────────────

let currentMock: typeof window.electronAPI | undefined;

/**
 * Richtet den Electron-Mock ein und setzt window.electronAPI.
 * @param overrides - Optionale partielle Overrides für einzelne Methoden
 */
export function setupElectronMock(overrides: ElectronMockOverrides = {}): typeof window.electronAPI {
  currentMock = createElectronMock(overrides);
  Object.defineProperty(window, "electronAPI", {
    value: currentMock,
    writable: true,
    configurable: true,
  });
  return currentMock;
}

/**
 * Setzt alle Mocks zurück und entfernt window.electronAPI.
 */
export function resetElectronMock(): void {
  vi.clearAllMocks();
  Object.defineProperty(window, "electronAPI", {
    value: undefined,
    writable: true,
    configurable: true,
  });
  currentMock = undefined;
}

/**
 * Gibt den aktuellen Mock zurück (für Assertions).
 */
export function getElectronMock(): typeof window.electronAPI | undefined {
  return currentMock;
}
