/**
 * Synthstudio – Persistenter App-Store (Backend-Agent)
 *
 * Speichert App-Einstellungen ohne externe Abhängigkeiten (nur Node.js fs + JSON).
 * Gespeicherte Daten: recentProjects, windowBounds, theme, lastImportPath
 * Speicherort: app.getPath('userData')/synthstudio-store.json
 */
import * as fs from "fs";
import * as path from "path";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface RecentProject {
  filePath: string;
  name: string;
  lastOpened: string; // ISO 8601
}

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

/**
 * Popup-Fenster-Layout pro detachable Panel (post-v1.28.0).
 * Wird bei Schließen aktualisiert + beim App-Start zum Wiederherstellen genutzt.
 */
export interface PopupWindowLayout {
  /** War das Fenster offen als die App das letzte Mal beendet wurde? → auto-reopen. */
  isOpen: boolean;
  /** Letzte Position + Größe. */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Always-on-top Status. */
  alwaysOnTop: boolean;
}

/**
 * Speichert pro Popup-Typ ein Layout. FX-Windows sind per-channelId verschachtelt,
 * weil mehrere FX-Fenster parallel offen sein können.
 */
export interface PopupWindowLayouts {
  performance?: PopupWindowLayout;
  mixer?: PopupWindowLayout;
  sampleBrowser?: PopupWindowLayout;
  patternGen?: PopupWindowLayout;
  /** FX-Windows: Map<channelId, Layout>. */
  fx?: Record<string, PopupWindowLayout>;
}

export interface AppStoreData {
  recentProjects: RecentProject[];
  windowBounds: WindowBounds;
  popupWindowLayouts: PopupWindowLayouts;
  theme: "dark" | "light";
  lastImportPath: string;
  version: number;
}

// ─── Standardwerte ────────────────────────────────────────────────────────────

const MAX_RECENT = 10;
const DEFAULT: AppStoreData = {
  recentProjects: [],
  windowBounds: { width: 1440, height: 900, isMaximized: false },
  popupWindowLayouts: {},
  theme: "dark",
  lastImportPath: "",
  version: 1,
};

// ─── Store-Klasse ─────────────────────────────────────────────────────────────

export class AppStore {
  private storePath: string;
  private data: AppStoreData;

  constructor(userDataPath: string) {
    this.storePath = path.join(userDataPath, "synthstudio-store.json");
    this.data = this.load();
  }

  private load(): AppStoreData {
    try {
      if (!fs.existsSync(this.storePath)) return { ...DEFAULT };
      const raw = fs.readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppStoreData>;
      return {
        ...DEFAULT,
        ...parsed,
        windowBounds: { ...DEFAULT.windowBounds, ...(parsed.windowBounds ?? {}) },
        // popupWindowLayouts wurde post-v1.28.0 hinzugefügt — Migration-tolerant.
        popupWindowLayouts: parsed.popupWindowLayouts ?? {},
      };
    } catch {
      return { ...DEFAULT };
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("[AppStore] Speichern fehlgeschlagen:", err);
    }
  }

  get<K extends keyof AppStoreData>(key: K): AppStoreData[K] {
    return this.data[key];
  }

  set<K extends keyof AppStoreData>(key: K, value: AppStoreData[K]): void {
    this.data[key] = value;
    this.save();
  }

  getRecentProjects(): RecentProject[] {
    return this.data.recentProjects;
  }

  addRecentProject(filePath: string): void {
    const name = path.basename(filePath, path.extname(filePath));
    // Duplikate entfernen
    this.data.recentProjects = this.data.recentProjects.filter(
      (p) => p.filePath !== filePath
    );
    // An den Anfang setzen
    this.data.recentProjects.unshift({
      filePath,
      name,
      lastOpened: new Date().toISOString(),
    });
    // Auf max. 10 begrenzen
    if (this.data.recentProjects.length > MAX_RECENT) {
      this.data.recentProjects = this.data.recentProjects.slice(0, MAX_RECENT);
    }
    this.save();
  }

  removeRecentProject(filePath: string): void {
    this.data.recentProjects = this.data.recentProjects.filter(
      (p) => p.filePath !== filePath
    );
    this.save();
  }

  clearRecentProjects(): void {
    this.data.recentProjects = [];
    this.save();
  }

  saveWindowBounds(bounds: WindowBounds): void {
    this.data.windowBounds = bounds;
    this.save();
  }

  // ─── Popup-Window-Layouts (post-v1.28.0) ───────────────────────────────────

  /** Liefert das Layout eines named Popup (Singleton-Popups). */
  getPopupLayout(key: "performance" | "mixer" | "sampleBrowser" | "patternGen"): PopupWindowLayout | undefined {
    return this.data.popupWindowLayouts[key];
  }

  /** Setzt das Layout eines named Popup (Singleton-Popups). */
  setPopupLayout(
    key: "performance" | "mixer" | "sampleBrowser" | "patternGen",
    layout: PopupWindowLayout,
  ): void {
    this.data.popupWindowLayouts[key] = layout;
    this.save();
  }

  /** Liefert das Layout eines FX-Popup für eine channelId. */
  getFxLayout(channelId: string): PopupWindowLayout | undefined {
    return this.data.popupWindowLayouts.fx?.[channelId];
  }

  /** Setzt das Layout eines FX-Popup für eine channelId. */
  setFxLayout(channelId: string, layout: PopupWindowLayout): void {
    if (!this.data.popupWindowLayouts.fx) this.data.popupWindowLayouts.fx = {};
    this.data.popupWindowLayouts.fx[channelId] = layout;
    this.save();
  }

  /** Liefert alle FX-Layouts (für Auto-Reopen beim App-Start). */
  getAllFxLayouts(): Record<string, PopupWindowLayout> {
    return this.data.popupWindowLayouts.fx ?? {};
  }

  /** Entfernt das Layout eines FX-Popup (z.B. wenn der Channel gelöscht wurde). */
  deleteFxLayout(channelId: string): void {
    if (this.data.popupWindowLayouts.fx) {
      delete this.data.popupWindowLayouts.fx[channelId];
      this.save();
    }
  }

  getStorePath(): string {
    return this.storePath;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let storeInstance: AppStore | null = null;

export function initStore(userDataPath: string): AppStore {
  storeInstance = new AppStore(userDataPath);
  return storeInstance;
}

export function getStore(): AppStore {
  if (!storeInstance) {
    throw new Error("[AppStore] Nicht initialisiert. initStore() aufrufen.");
  }
  return storeInstance;
}

// ─── IPC-Handler ─────────────────────────────────────────────────────────────

export function registerStoreHandlers(
  ipcMain: Electron.IpcMain,
  mainWindow: Electron.BrowserWindow | null
): void {
  const store = getStore();

  ipcMain.handle("store:get", (_e, key: keyof AppStoreData) => {
    try {
      return { success: true, data: store.get(key) };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(
    "store:set",
    (_e, key: keyof AppStoreData, value: AppStoreData[keyof AppStoreData]) => {
      try {
        store.set(key, value as never);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  );

  ipcMain.handle("store:get-recent", () => {
    try {
      return { success: true, data: store.getRecentProjects() };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("store:add-recent", (_e, filePath: string) => {
    try {
      store.addRecentProject(filePath);
      mainWindow?.webContents.send("store:recent-changed", store.getRecentProjects());
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("store:remove-recent", (_e, filePath: string) => {
    try {
      store.removeRecentProject(filePath);
      mainWindow?.webContents.send("store:recent-changed", store.getRecentProjects());
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("store:clear-recent", () => {
    try {
      store.clearRecentProjects();
      mainWindow?.webContents.send("store:recent-changed", []);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
