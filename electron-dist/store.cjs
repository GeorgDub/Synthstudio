"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppStore = void 0;
exports.initStore = initStore;
exports.getStore = getStore;
exports.registerStoreHandlers = registerStoreHandlers;
/**
 * Synthstudio – Persistenter App-Store (Backend-Agent)
 *
 * Speichert App-Einstellungen ohne externe Abhängigkeiten (nur Node.js fs + JSON).
 * Gespeicherte Daten: recentProjects, windowBounds, theme, lastImportPath
 * Speicherort: app.getPath('userData')/synthstudio-store.json
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ─── Standardwerte ────────────────────────────────────────────────────────────
const MAX_RECENT = 10;
const DEFAULT = {
    recentProjects: [],
    windowBounds: { width: 1440, height: 900, isMaximized: false },
    theme: "dark",
    lastImportPath: "",
    version: 1,
};
// ─── Store-Klasse ─────────────────────────────────────────────────────────────
class AppStore {
    constructor(userDataPath) {
        this.storePath = path.join(userDataPath, "synthstudio-store.json");
        this.data = this.load();
    }
    load() {
        try {
            if (!fs.existsSync(this.storePath))
                return { ...DEFAULT };
            const raw = fs.readFileSync(this.storePath, "utf-8");
            const parsed = JSON.parse(raw);
            return {
                ...DEFAULT,
                ...parsed,
                windowBounds: { ...DEFAULT.windowBounds, ...(parsed.windowBounds ?? {}) },
            };
        }
        catch {
            return { ...DEFAULT };
        }
    }
    save() {
        try {
            const dir = path.dirname(this.storePath);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2), "utf-8");
        }
        catch (err) {
            console.error("[AppStore] Speichern fehlgeschlagen:", err);
        }
    }
    get(key) {
        return this.data[key];
    }
    set(key, value) {
        this.data[key] = value;
        this.save();
    }
    getRecentProjects() {
        return this.data.recentProjects;
    }
    addRecentProject(filePath) {
        const name = path.basename(filePath, path.extname(filePath));
        // Duplikate entfernen
        this.data.recentProjects = this.data.recentProjects.filter((p) => p.filePath !== filePath);
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
    removeRecentProject(filePath) {
        this.data.recentProjects = this.data.recentProjects.filter((p) => p.filePath !== filePath);
        this.save();
    }
    clearRecentProjects() {
        this.data.recentProjects = [];
        this.save();
    }
    saveWindowBounds(bounds) {
        this.data.windowBounds = bounds;
        this.save();
    }
    getStorePath() {
        return this.storePath;
    }
}
exports.AppStore = AppStore;
// ─── Singleton ────────────────────────────────────────────────────────────────
let storeInstance = null;
function initStore(userDataPath) {
    storeInstance = new AppStore(userDataPath);
    return storeInstance;
}
function getStore() {
    if (!storeInstance) {
        throw new Error("[AppStore] Nicht initialisiert. initStore() aufrufen.");
    }
    return storeInstance;
}
// ─── IPC-Handler ─────────────────────────────────────────────────────────────
function registerStoreHandlers(ipcMain, mainWindow) {
    const store = getStore();
    ipcMain.handle("store:get", (_e, key) => {
        try {
            return { success: true, data: store.get(key) };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
    ipcMain.handle("store:set", (_e, key, value) => {
        try {
            store.set(key, value);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
    ipcMain.handle("store:get-recent", () => {
        try {
            return { success: true, data: store.getRecentProjects() };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
    ipcMain.handle("store:add-recent", (_e, filePath) => {
        try {
            store.addRecentProject(filePath);
            mainWindow?.webContents.send("store:recent-changed", store.getRecentProjects());
            return { success: true };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
    ipcMain.handle("store:remove-recent", (_e, filePath) => {
        try {
            store.removeRecentProject(filePath);
            mainWindow?.webContents.send("store:recent-changed", store.getRecentProjects());
            return { success: true };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
    ipcMain.handle("store:clear-recent", () => {
        try {
            store.clearRecentProjects();
            mainWindow?.webContents.send("store:recent-changed", []);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: String(err) };
        }
    });
}
