/**
 * Globale TypeScript-Deklarationen für die Electron-API
 *
 * Diese Datei erweitert das globale `Window`-Interface damit TypeScript
 * `window.electronAPI` in der gesamten Web-App kennt.
 *
 * Import in tsconfig.json unter "include" hinzufügen wenn nötig.
 */

interface ElectronFileResult {
  success: boolean;
  data?: ArrayBuffer;
  error?: string;
}

interface ElectronDirectoryEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface ElectronDirectoryResult {
  success: boolean;
  entries?: ElectronDirectoryEntry[];
  error?: string;
}

interface ElectronAPI {
  readonly isElectron: true;
  readonly platform: "win32" | "darwin" | "linux";

  getVersion(): Promise<string>;

  // Dateisystem
  readFile(filePath: string): Promise<ElectronFileResult>;
  listDirectory(dirPath: string): Promise<ElectronDirectoryResult>;

  // Menü-Events
  onMenuExportProject(callback: () => void): () => void;
  onMenuImportProject(callback: () => void): () => void;
  onMenuOpenSampleBrowser(callback: () => void): () => void;
  onMenuImportSamples(callback: (filePaths: string[]) => void): () => void;
  onMenuImportSampleFolder(callback: (folderPath: string) => void): () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
