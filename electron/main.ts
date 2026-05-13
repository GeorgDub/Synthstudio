/**
 * Synthstudio – Electron Main Process (v3)
 *
 * Features:
 * - BrowserWindow mit nativen Menüs
 * - Keyboard-Shortcuts (Ctrl+S, Ctrl+O, Ctrl+Z, Ctrl+Y, F11, etc.)
 * - System-Tray-Integration
 * - Vollbild-Modus
 * - Native Dialoge (Open, Save, Confirm)
 * - Folder-Import mit Progress-Events und Cancel-Unterstützung
 * - Error-Handling für fehlende Berechtigungen
 * - AppStore-Integration (zuletzt geöffnete Projekte, WindowBounds, Theme)
 * - Dynamisches Menü "Zuletzt geöffnete Projekte"
 * - IPC-Handler für den Store
 * - Auto-Updater (electron-updater, aktiviert in Produktion)
 *
 * Die Web-App (client/, server/, shared/) bleibt vollständig unverändert.
 */

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  dialog,
  ipcMain,
  globalShortcut,
  nativeImage,
  Notification,
  screen,
  session,
} from "electron";
import * as path from "path";
import * as fs from "fs";

// ─── Electron-Module ─────────────────────────────────────────────────────────
import { buildCspForMode } from "./csp";
import { setupDragDrop } from "./dragdrop";
import { registerWaveformHandlers } from "./waveform";
import { WindowManager, registerWindowHandlers } from "./windows";
import { registerExportHandlers } from "./export";
import { setupAutoUpdater, checkForUpdatesManually } from "./updater";
import { initStore, registerStoreHandlers, type AppStore, type PopupWindowLayout } from "./store";
import {
  initCrashLog,
  installMainProcessCrashHandlers,
  installWebContentsCrashHandlers,
  logEvent,
  logCrash,
  shutdownCrashLog,
  startHeartbeat,
  stopHeartbeat,
  getCrashLogPath,
} from "./crashLog";
import { registerZipImportHandlers } from "./zip-import";
import {
  startCollabServer,
  stopCollabServer,
  isCollabServerRunning,
  getCollabServerPort,
  getLocalIp,
} from "./collab-server";
import {
  startDiscoveryAnnounce,
  stopDiscoveryAnnounce,
  startDiscoveryListen,
  stopDiscoveryListen,
  getDiscoveredSessions,
} from "./collab-discovery";

const windowManager = new WindowManager();

// ─── Konstanten ──────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV === "development";
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:3000";
const APP_NAME = "Synthstudio";
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".aiff", ".aif", ".m4a"]);

// ─── Globale Error-Handler ────────────────────────────────────────────────────
// Verhindern dass eine unhandled rejection die App-Initialisierung blockiert
// und das Fenster nie erscheint. Fehler werden in die Console + nach Boot
// in den Renderer geloggt.
process.on("unhandledRejection", (reason) => {
  console.error("[Main] Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Main] Uncaught Exception:", err);
});

// ─── Zustand ─────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let perfWindow: BrowserWindow | null = null;
/**
 * FX-Popup-Windows pro Kanal-ID (post-v1.25.0 Multi-Window-Workspace Phase 1).
 * Map<channelId, BrowserWindow> — User kann mehrere FX-Panels in eigenen
 * Fenstern parallel offen haben.
 */
const fxWindows = new Map<string, BrowserWindow>();
/**
 * Mixer-Popup-Window (post-v1.26.0 Multi-Window-Workspace).
 * Singleton — anders als fxWindows; es gibt nur einen Mixer pro Session.
 */
let mixerWindow: BrowserWindow | null = null;
/**
 * Sample-Browser-Popup-Window (post-v1.27.0 Multi-Window-Workspace).
 * Singleton — der Sample-Browser ist eine einzelne Bibliotheks-Ansicht.
 */
let sampleBrowserWindow: BrowserWindow | null = null;
/**
 * Pattern-Generator-Popup-Window (post-v1.27.0 Multi-Window-Workspace).
 * Singleton.
 */
let patternGenWindow: BrowserWindow | null = null;
/** Keyboard-Sampler-Popup (post-v1.28.0). Singleton. */
let keyboardSamplerWindow: BrowserWindow | null = null;
/** Chord-Progression-Popup (post-v1.28.0). Singleton. */
let chordProgressionWindow: BrowserWindow | null = null;
/** Pattern-Library-Popup (post-v1.28.0). Singleton. */
let patternLibraryWindow: BrowserWindow | null = null;

/**
 * Window-Layout-Persistenz (post-v1.28.0).
 *
 * Flag um in den `close`-Handlern der Popup-Fenster zu unterscheiden, ob der
 * User das Fenster explizit schließt (→ isOpen=false, keine Auto-Reopen) oder
 * ob die App gerade beendet wird (→ isOpen=true bleibt erhalten, Auto-Reopen
 * beim nächsten Start).
 */
let isAppQuitting = false;

/**
 * BUG-018 fix: explicit tracking of mainWindow destruction.
 *
 * User-Report: das Klicken auf ✕ in einem Popup-Window schloss die komplette
 * App. Vermutete Ursache: in einem Electron-Edge-Case (frameless child windows
 * mit parent: mainWindow) feuert `window-all-closed` obwohl mainWindow noch
 * lebt — und app.quit() killt dann alles. Mit diesem Flag refusen wir den
 * Quit wenn mainWindow nicht aktiv zerstört wurde.
 */
let mainWindowDestroyed = false;

/**
 * BUG-018 (v1.29.0 Regression-Fix): explicit user-initiated-quit gate.
 *
 * User-Report: auch nach v1.29.0 fix closet ✕ auf Popups die komplette App.
 * Vermutung: irgendein Quit-Pfad triggert `before-quit` ohne dass mainWindow
 * destroyed wurde. Wir installieren einen Whitelist-Mechanismus: ALL quit
 * attempts werden in `before-quit` geblockt, AUSSER explicit-user-initiated.
 *
 * User-initiated heißt: Tray "Beenden", Datei → Beenden mit mainWindow focus,
 * mainWindow's eigener native close (X / Alt+F4), Updater-Quit-For-Install.
 */
let userInitiatedQuit = false;

/** Hilfs-Funktion um explicit quit-Pfade zu markieren. */
function requestUserQuit(): void {
  userInitiatedQuit = true;
  app.quit();
}

/**
 * BUG-018 v4: Cascade-Detection — Timestamp wann zuletzt ein Popup-Fenster
 * geschlossen wurde. Wenn `mainWindow.on('close')` innerhalb ~300ms danach
 * feuert, ist das mit hoher Wahrscheinlichkeit ein OS-Cascade (Windows-Verhalten
 * bei parent-child-Fenstern), nicht ein User-Click auf das Hauptfenster.
 */
let lastPopupCloseTime = 0;
function markPopupClosed(): void { lastPopupCloseTime = Date.now(); }

/**
 * Liest das gespeicherte Layout für ein Singleton-Popup und liefert die Bounds-
 * Override für den BrowserWindow-Konstruktor zurück (oder undefined).
 */
type SingletonPopupKey =
  | "performance"
  | "mixer"
  | "sampleBrowser"
  | "patternGen"
  | "keyboardSampler"
  | "chordProgression"
  | "patternLibrary";

function getSavedLayoutFor(key: SingletonPopupKey): PopupWindowLayout | undefined {
  return appStore?.getPopupLayout(key);
}

/**
 * Speichert die aktuellen Bounds + AlwaysOnTop eines Popup-Fensters in den
 * persistenten Store. Wird im `close`-Handler vor der Destruktion aufgerufen.
 *
 * Wenn `isAppQuitting=true` (App-Beenden cascade-closed das Popup), bleibt
 * `isOpen=true` damit das Popup beim nächsten Start wieder geöffnet wird.
 * Bei explizitem User-Close ist `isOpen=false`.
 */
function persistPopupLayout(
  key: SingletonPopupKey,
  win: BrowserWindow,
): void {
  logEvent("popup:close", { key, isAppQuitting });
  if (!appStore || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    appStore.setPopupLayout(key, {
      isOpen: isAppQuitting,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      alwaysOnTop: win.isAlwaysOnTop(),
    });
  } catch (err) {
    logCrash(`persistPopupLayout:${key}`, err);
    console.error(`[WindowLayout] persistPopupLayout(${key}) failed:`, err);
  }
}

/** Variante für FX-Windows (per channelId). */
function persistFxLayout(channelId: string, win: BrowserWindow): void {
  if (!appStore || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    appStore.setFxLayout(channelId, {
      isOpen: isAppQuitting,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      alwaysOnTop: win.isAlwaysOnTop(),
    });
  } catch (err) {
    console.error(`[WindowLayout] persistFxLayout(${channelId}) failed:`, err);
  }
}

/**
 * BUG-021 workaround: explizit-destroy statt win.close().
 *
 * User-Diagnose v1.41 zeigte: nach unserem close-end Event stirbt der Main-Process
 * NATIV in Chromium's BrowserWindow.close()-Destruktionspfad. Vermutete Ursache:
 * race-condition zwischen close-event-handler-Callback und Chromium's internal
 * window destruction.
 *
 * Workaround: layout MANUELL synchron persistieren + dann win.destroy() statt
 * win.close(). `destroy()` überspringt das `close`-Event ganz (keine
 * preventDefault-Möglichkeit) und geht direkt zur safer destruction.
 *
 * Wir loggen weiterhin popup:close-Manual damit die Diagnose-Kette komplett
 * bleibt; closed-Event sollte trotzdem feuern.
 */
const VALID_SINGLETON_KEYS: ReadonlySet<string> = new Set([
  "performance", "mixer", "sampleBrowser", "patternGen",
  "keyboardSampler", "chordProgression", "patternLibrary",
]);

/** Mapper: generic-factory keyPrefix → SingletonPopupKey für AppStore. */
function mapKeyPrefixToSingleton(keyPrefix: string): SingletonPopupKey | null {
  const mapping: Record<string, SingletonPopupKey> = {
    "keyboard-sampler": "keyboardSampler",
    "chord-progression": "chordProgression",
    "pattern-library": "patternLibrary",
  };
  if (mapping[keyPrefix]) return mapping[keyPrefix];
  if (VALID_SINGLETON_KEYS.has(keyPrefix)) return keyPrefix as SingletonPopupKey;
  return null;
}

/**
 * Mappt einen Popup-Key auf den IPC-Channel-Namen den der Renderer abonniert.
 * Nötig weil win.destroy() KEIN "closed"-Event feuert — wir senden die
 * Benachrichtigung manuell BEVOR wir destroyen.
 *
 * BUG-023 Fix (post-v1.42): ohne diese manuelle Notification erfährt das
 * Main-Fenster nie dass das Popup zu ist und kann den Inline-View nicht
 * zurückbringen ("Anpinnen geht weg ohne wiederzukehren").
 */
function getClosedEventChannel(key: SingletonPopupKey | string, isFx: boolean): string | null {
  if (isFx) return "fx-window:closed";
  switch (String(key)) {
    case "performance":          return "perf-window:closed";
    case "mixer":                return "mixer-window:closed";
    case "sampleBrowser":        return "sample-browser-window:closed";
    case "patternGen":           return "pattern-gen-window:closed";
    case "keyboard-sampler":     return "keyboardSamplerPopup-window:closed";
    case "chord-progression":    return "chordProgressionPopup-window:closed";
    case "pattern-library":      return "patternLibraryPopup-window:closed";
    default: return null;
  }
}

function destroyPopupSafely(
  key: SingletonPopupKey | string,
  win: BrowserWindow | null,
  isFx: boolean = false,
): void {
  if (!win || win.isDestroyed()) return;
  logEvent("popup:destroy-manual", { key });
  try {
    // Manuelles persist (bypassing close-event)
    if (appStore) {
      const bounds = win.getBounds();
      const layout = {
        isOpen: isAppQuitting,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        alwaysOnTop: win.isAlwaysOnTop(),
      };
      if (isFx) {
        appStore.setFxLayout(String(key), layout);
      } else {
        const mapped = mapKeyPrefixToSingleton(String(key));
        if (mapped) appStore.setPopupLayout(mapped, layout);
      }
    }
    markPopupClosed();

    // BUG-023: closed-IPC manuell senden — win.destroy() feuert KEINE
    // "closed"-Events, also würde der Main-Renderer nie erfahren dass das
    // Popup zu ist → Inline-View kommt nie zurück nach "Anpinnen"/"Zurückholen".
    if (mainWindow && !mainWindow.isDestroyed()) {
      const channel = getClosedEventChannel(key, isFx);
      if (channel) {
        if (isFx) {
          mainWindow.webContents.send(channel, String(key));
        } else {
          mainWindow.webContents.send(channel);
        }
        logEvent("popup:closed-notify", { key, channel });
      }
    }
  } catch (err) {
    logCrash(`destroyPopupSafely:${key}`, err);
  }
  // win.destroy() statt win.close() — bypass des fragilen close-event-Pfads
  try {
    win.destroy();
  } catch (err) {
    logCrash(`destroyPopupSafely:destroy:${key}`, err);
  }
}

/**
 * Window-Layout-Persistenz: Auto-Reopen aller Popups die beim letzten App-Beenden
 * offen waren. Wird einmalig kurz nach `did-finish-load` des Hauptfensters
 * aufgerufen, damit die Main-Renderer-Action-Listener bereit sind.
 */
function reopenPersistedPopups(): void {
  if (!appStore) return;
  try {
    if (appStore.getPopupLayout("performance")?.isOpen) createPerformanceWindow();
    if (appStore.getPopupLayout("mixer")?.isOpen) createMixerWindow();
    if (appStore.getPopupLayout("sampleBrowser")?.isOpen) createSampleBrowserWindow();
    if (appStore.getPopupLayout("patternGen")?.isOpen) createPatternGenWindow();
    if (appStore.getPopupLayout("keyboardSampler")?.isOpen) createKeyboardSamplerWindow();
    if (appStore.getPopupLayout("chordProgression")?.isOpen) createChordProgressionWindow();
    if (appStore.getPopupLayout("patternLibrary")?.isOpen) createPatternLibraryWindow();

    // FX-Windows: per channelId
    const fxLayouts = appStore.getAllFxLayouts();
    for (const [channelId, layout] of Object.entries(fxLayouts)) {
      if (layout.isOpen) createFxWindow(channelId);
    }
  } catch (err) {
    console.error("[WindowLayout] reopenPersistedPopups failed:", err);
  }
}
let tray: Tray | null = null;
let appStore: AppStore | null = null;

/** Aktive Import-Abbruch-Flags: importId → aborted */
const importCancelFlags = new Map<string, boolean>();

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

/** Erstellt ein einfaches Tray-Icon (16×16 Pixel) */
function createTrayIcon(): Electron.NativeImage {
  const iconPath = path.join(__dirname, "..", "client", "public", "favicon.ico");
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  // Minimal-Icon als leeres Bild (wird durch OS-Default ersetzt)
  return nativeImage.createEmpty();
}

/** Zählt rekursiv Audio-Dateien in einem Verzeichnis */
async function countAudioFiles(dirPath: string): Promise<number> {
  let count = 0;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += await countAudioFiles(fullPath);
      } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        count++;
      }
    }
  } catch {
    // Verzeichnis nicht lesbar – überspringen
  }
  return count;
}

/** Erkennt Kategorie anhand von Datei-/Ordnername */
function detectCategory(filePath: string): string {
  const name = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath).toLowerCase();
  const combined = `${dir} ${name}`;

  const patterns: Record<string, string[]> = {
    kicks: ["kick", "bd", "bass drum", "bassdrum", "kik", "808"],
    snares: ["snare", "sn", "snr", "rimshot", "rim"],
    hihats: ["hihat", "hi-hat", "hh", "hat", "cymbal", "open hat", "closed hat"],
    claps: ["clap", "clp", "handclap", "snap"],
    toms: ["tom", "floor tom", "rack tom"],
    percussion: ["perc", "conga", "bongo", "shaker", "tambourine", "cowbell", "clave"],
    fx: ["fx", "effect", "noise", "sweep", "riser", "impact", "crash", "zap"],
    loops: ["loop", "break", "groove", "beat", "phrase"],
    vocals: ["vocal", "vox", "voice", "choir", "spoken"],
  };

  for (const [category, keywords] of Object.entries(patterns)) {
    if (keywords.some((kw) => combined.includes(kw))) {
      return category;
    }
  }
  return "other";
}

/** Generiert Auto-Tags aus dem Dateinamen (kick, snare, loop, …) */
function autoTag(filePath: string): string[] {
  const name = path.basename(filePath).toLowerCase();
  if (/kick|bd|bass.?drum|bassdrum/.test(name)) return ["kick"];
  if (/snare|sd|rimshot/.test(name)) return ["snare"];
  if (/clap/.test(name)) return ["clap"];
  if (/hihat|hh|hat/.test(name)) {
    if (/open|oh/.test(name)) return ["open-hat"];
    return ["closed-hat"];
  }
  if (/tom|floor|rack/.test(name)) return ["tom"];
  if (/crash|ride|cym/.test(name)) return ["cymbal"];
  if (/perc|conga|bongo|shaker|tamb/.test(name)) return ["percussion"];
  if (/bass|sub/.test(name)) return ["bass"];
  if (/lead|synth|pad|keys/.test(name)) return ["synth"];
  if (/fx|effect|noise|sweep/.test(name)) return ["fx"];
  if (/loop|break/.test(name)) return ["loop"];
  if (/vocal|vox|voice/.test(name)) return ["vocal"];
  return [];
}


function createWindow(): void {
  // Gespeicherte Fenstergröße/-position aus dem Store laden
  const savedBounds = appStore?.get("windowBounds");
  const windowWidth = savedBounds?.width ?? 1440;
  const windowHeight = savedBounds?.height ?? 900;
  let windowX = savedBounds?.x;
  let windowY = savedBounds?.y;

  // ── Bounds-Validation: Fenster darf nicht off-screen liegen ────────────────
  // Beim Wechsel des Monitor-Setups (z.B. externer Display abgesteckt) können
  // gespeicherte x/y-Koordinaten außerhalb aller aktuellen Displays liegen.
  // Wenn das passiert, ignorieren wir sie und lassen Electron das Fenster
  // zentriert auf dem Primärbildschirm öffnen.
  if (windowX !== undefined && windowY !== undefined) {
    const displays = screen.getAllDisplays();
    const isVisibleOnAnyDisplay = displays.some(d => {
      const { x, y, width, height } = d.workArea;
      return windowX! >= x - 50 && windowX! < x + width - 100 &&
             windowY! >= y - 10 && windowY! < y + height - 100;
    });
    if (!isVisibleOnAnyDisplay) {
      console.warn(`[Window] Saved bounds (${windowX},${windowY}) off-screen – using default position.`);
      windowX = undefined;
      windowY = undefined;
    }
  }

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    ...(windowX !== undefined && windowY !== undefined ? { x: windowX, y: windowY } : {}),
    minWidth: 1024,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: "#0a0a0a",
    // Native Frame + Menübar (post-v1.25.0 User-Request — analog zum
    // Performance-Mode-Popup-Fenster). Vorher: frame:false auf Win/Linux mit
    // Custom ElectronTitleBar. User-Feedback: nativer Frame ist konsistent
    // und zeigt das Datei/Bearbeiten/Ansicht/Audio/Fenster/Help-Menü.
    // BUG-009 (Fullscreen-Drag-Region) ist damit obsolet — keine Custom-
    // Drag-Region mehr, die im Fullscreen Klicks abfängt.
    frame: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Erst zeigen wenn der Renderer ready ist – verhindert weißes Flash + leere Fenster
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      webSecurity: !isDev,
    },
  });

  // DIAG-3: native renderer crash detection (render-process-gone /
  // unresponsive). Fängt Chromium-interne Crashes ein, die nicht über
  // process.on('uncaughtException') sichtbar werden.
  installWebContentsCrashHandlers(mainWindow.webContents, "main");

  // ── Anzeigen sobald der Renderer fertig ist ────────────────────────────────
  // ready-to-show kann selten nicht feuern (z.B. wenn loadFile failed).
  // Deshalb ein 5s-Fallback der das Fenster trotzdem zeigt um "unsichtbaren
  // Prozess im Task-Manager"-Symptom zu verhindern.
  let shown = false;
  const showOnce = () => {
    if (shown || !mainWindow) return;
    shown = true;
    mainWindow.show();
    if (savedBounds?.isMaximized) mainWindow.maximize();
    else mainWindow.focus();
  };
  mainWindow.once("ready-to-show", showOnce);
  setTimeout(() => {
    if (!shown && mainWindow) {
      console.warn("[Window] ready-to-show did not fire within 5s – forcing show().");
      showOnce();
    }
  }, 5000);

  // ── Renderer-Fehler-Diagnostik ─────────────────────────────────────────────
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Window] did-fail-load: ${errorCode} ${errorDescription} URL=${validatedURL}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[Window] render-process-gone: reason=${details.reason}, exitCode=${details.exitCode}`);
  });

  // ── Inhalt laden ────────────────────────────────────────────────────────────
  if (isDev) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    mainWindow.loadFile(indexPath).catch(err => {
      console.error(`[Window] loadFile failed for ${indexPath}:`, err);
    });
  }

  // ── Externe Links im Standard-Browser öffnen ────────────────────────────────
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // ── Fenster-Events ──────────────────────────────────────────────────────────
  mainWindow.on("close", (event) => {
    const sincePopupClose = Date.now() - lastPopupCloseTime;
    logEvent("mainWindow:close", { userInitiatedQuit, sincePopupClose });
    // BUG-018 v4: Cascade-Detection. Wenn unmittelbar vorher ein Popup-Fenster
    // geschlossen wurde, ist das hier KEIN User-Initiated-Close sondern ein
    // OS-Window-Manager-Cascade. Wir preventDefault — sonst stirbt die ganze App mit.
    if (!userInitiatedQuit) {
      if (sincePopupClose < 300) {
        event.preventDefault();
        logEvent("mainWindow:close:BLOCKED", { sincePopupClose });
        console.warn(
          `[mainWindow close] BLOCKED: detected popup-close cascade (Δ=${sincePopupClose}ms). ` +
          "Tray-Beenden / Datei-Beenden are the legitimate quit paths.",
        );
        return;
      }
      // Echter User-Close (Alt+F4 / native X / Shutdown) → legitimate
      userInitiatedQuit = true;
    }
    // Fenstergröße und -position vor dem Schließen speichern
    if (mainWindow && appStore) {
      const bounds = mainWindow.getBounds();
      appStore.saveWindowBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: mainWindow.isMaximized(),
      });
    }
  });

  mainWindow.on("closed", () => {
    logEvent("mainWindow:closed", { userInitiatedQuit, isAppQuitting });
    // BUG-018: track explicit mainWindow destruction so window-all-closed
    // can distinguish "user actually closed main" from "Electron edge case
    // where all popup windows were closed but mainWindow is somehow gone".
    mainWindowDestroyed = true;
    mainWindow = null;
    // Mixer-Popup mit-schließen wenn Haupt-Fenster geschlossen wird
    if (mixerWindow && !mixerWindow.isDestroyed()) {
      mixerWindow.close();
    }
    // Sample-Browser-Popup mit-schließen wenn Haupt-Fenster geschlossen wird
    if (sampleBrowserWindow && !sampleBrowserWindow.isDestroyed()) {
      sampleBrowserWindow.close();
    }
    // Pattern-Generator-Popup mit-schließen
    if (patternGenWindow && !patternGenWindow.isDestroyed()) {
      patternGenWindow.close();
    }
    if (keyboardSamplerWindow && !keyboardSamplerWindow.isDestroyed()) keyboardSamplerWindow.close();
    if (chordProgressionWindow && !chordProgressionWindow.isDestroyed()) chordProgressionWindow.close();
    if (patternLibraryWindow && !patternLibraryWindow.isDestroyed()) patternLibraryWindow.close();
    // Performance-Popup mit-schließen wenn Haupt-Fenster geschlossen wird
    if (perfWindow && !perfWindow.isDestroyed()) {
      perfWindow.close();
    }
  });

  mainWindow.on("enter-full-screen", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", true);
  });

  mainWindow.on("leave-full-screen", () => {
    mainWindow?.webContents.send("window:fullscreen-changed", false);
  });

  // Tray-Icon aktualisieren wenn Fenster minimiert/wiederhergestellt
  mainWindow.on("minimize", () => {
    updateTrayMenu();
  });

  mainWindow.on("restore", () => {
    updateTrayMenu();
  });
}

// ─── Performance-Mode Popup-Window (Feature ROADMAP: parallel zur Main-UI) ───

/**
 * Erstellt das Performance-Mode Popup-Fenster. Lädt denselben Renderer-Entry
 * wie das Haupt-Fenster, aber mit URL-Parameter `?perfPopup=1` — App.tsx
 * erkennt den Parameter und rendert nur das PerformancePopupApp statt der
 * vollen App.
 *
 * Cross-Window-State-Sync läuft über die IPC-Channels:
 *   - perf-sync:state  (main → popup): Voller State-Snapshot
 *   - perf-sync:action (popup → main): Action-Payload zum Dispatch
 *
 * Lebenszyklus:
 *   - Wird erst geöffnet wenn der User explizit "Open in separate window"
 *     klickt (IPC `window:open-performance`).
 *   - Schließt sich automatisch beim Schließen des Haupt-Fensters.
 *   - Idempotent: zweiter Open-Call fokussiert das existierende Popup
 *     statt ein neues zu erstellen.
 */
function createPerformanceWindow(): void {
  // Wenn Popup schon offen — nur fokussieren
  if (perfWindow && !perfWindow.isDestroyed()) {
    perfWindow.focus();
    return;
  }

  // Window-Layout-Persistenz: restore saved bounds + alwaysOnTop
  const saved = getSavedLayoutFor("performance");

  perfWindow = new BrowserWindow({
    width: saved?.bounds?.width ?? 800,
    height: saved?.bounds?.height ?? 600,
    x: saved?.bounds?.x,
    y: saved?.bounds?.y,
    minWidth: 480,
    minHeight: 400,
    title: `${APP_NAME} – Performance`,
    backgroundColor: "#0a0a0a",
    // Frameless (post-v1.25.0 User-Request): das Popup hat KEINEN OS-Frame,
    // stattdessen rendert PerformancePopupApp einen eigenen schmalen Header
    // mit Drag-Region + Pin-Toggle + Close-Button. Pattern für zukünftige
    // pinnable Sub-Windows (Effects, Mixer-Strips etc.).
    frame: false,
    titleBarStyle: "default",
    // BUG-019 (post-v1.33.0): parent:mainWindow ENTFERNT um Windows-WM_CLOSE-
    // Cascade vom Child auf den Parent zu eliminieren. Popups sind jetzt
    // truly independent windows. Schließen eines Popups kann mainWindow
    // niemals direkt beeinflussen. Kaskade-Close MAIN→POPUPS bleibt erhalten
    // (programmatisch in mainWindow.on('closed')).
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      webSecurity: !isDev,
    },
  });

  // BUG-017 fix: popup windows must NOT inherit the application menu.
  // Without this, the user could accidentally trigger "Datei → Beenden"
  // (role:quit) from a focused popup and quit the entire app.
  perfWindow.setMenu(null);
  installWebContentsCrashHandlers(perfWindow.webContents, "performance");

  // Window-Layout-Persistenz: restore alwaysOnTop wenn gespeichert
  if (saved?.alwaysOnTop) {
    perfWindow.setAlwaysOnTop(true);
  }

  // Window-Layout-Persistenz: markieren als offen (für Auto-Reopen)
  appStore?.setPopupLayout("performance", {
    isOpen: true,
    bounds: saved?.bounds,
    alwaysOnTop: saved?.alwaysOnTop ?? false,
  });

  // Save bounds + alwaysOnTop kurz vor dem Schließen
  perfWindow.on("close", () => {
    markPopupClosed();
    if (perfWindow) persistPopupLayout("performance", perfWindow);
    logEvent("popup:close-end", { key: "performance" });
  });

  perfWindow.once("ready-to-show", () => {
    perfWindow?.show();
  });

  // Inhalt laden — selbe URL/Datei wie Main, aber mit ?perfPopup=1
  if (isDev) {
    perfWindow.loadURL(`${devServerUrl}?perfPopup=1`);
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    // loadFile mit query-string via search-Option
    perfWindow.loadFile(indexPath, { search: "perfPopup=1" }).catch(err => {
      console.error("[PerfWindow] loadFile failed:", err);
    });
  }

  perfWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  perfWindow.on("closed", () => {
    logEvent("popup:closed", { key: "performance" });
    perfWindow = null;
    // Main-Fenster informieren dass das Popup zu ist (UI-State zurücksetzen)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("perf-window:closed");
    }
  });
}

/**
 * FX-Popup-Fenster für einen Kanal/Part. Pinnable FX-Window — Proof of Concept
 * für die Multi-Window-Workspace-Roadmap (Phase 1, post-v1.25.0).
 *
 * Architektur identisch zu createPerformanceWindow:
 *   - Frameless: Renderer (FxPopupApp) rendert eigenen schmalen Header mit
 *     Drag-Region + Pin + Close.
 *   - URL-Param `?fxPopup=<channelId>` signalisiert dem Renderer welcher
 *     Kanal-Inhalt zu rendern ist.
 *   - Ein BrowserWindow pro channelId — Map<channelId, BrowserWindow> verwaltet
 *     parallele FX-Fenster.
 *   - Schließt sich automatisch mit dem Haupt-Fenster (parent-Beziehung).
 *   - Idempotent: zweiter Open-Call fokussiert das existierende Popup.
 */
function createFxWindow(channelId: string): void {
  if (!channelId || channelId.length === 0) return;

  // Idempotenz — bestehendes Fenster fokussieren
  const existing = fxWindows.get(channelId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  // Window-Layout-Persistenz: restore saved bounds für diesen Kanal
  const saved = appStore?.getFxLayout(channelId);

  const win = new BrowserWindow({
    width: saved?.bounds?.width ?? 420,
    height: saved?.bounds?.height ?? 560,
    x: saved?.bounds?.x,
    y: saved?.bounds?.y,
    minWidth: 320,
    minHeight: 380,
    title: `${APP_NAME} – FX (${channelId})`,
    backgroundColor: "#0a0a0a",
    frame: false,
    titleBarStyle: "default",
    // BUG-019 (post-v1.33.0): parent:mainWindow ENTFERNT um Windows-WM_CLOSE-
    // Cascade vom Child auf den Parent zu eliminieren. Popups sind jetzt
    // truly independent windows. Schließen eines Popups kann mainWindow
    // niemals direkt beeinflussen. Kaskade-Close MAIN→POPUPS bleibt erhalten
    // (programmatisch in mainWindow.on('closed')).
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      webSecurity: !isDev,
    },
  });
  fxWindows.set(channelId, win);

  // BUG-017 fix: popup windows must NOT inherit the application menu —
  // otherwise menu accelerators from this window could quit the entire app.
  win.setMenu(null);
  installWebContentsCrashHandlers(win.webContents, `fx:${channelId}`);

  // Window-Layout-Persistenz
  if (saved?.alwaysOnTop) win.setAlwaysOnTop(true);
  appStore?.setFxLayout(channelId, {
    isOpen: true,
    bounds: saved?.bounds,
    alwaysOnTop: saved?.alwaysOnTop ?? false,
  });

  // Save bounds vor dem Schließen
  win.on("close", () => {
    markPopupClosed();
    persistFxLayout(channelId, win);
    logEvent("popup:close-end", { key: `fx:${channelId}` });
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  const query = `fxPopup=${encodeURIComponent(channelId)}`;
  if (isDev) {
    win.loadURL(`${devServerUrl}?${query}`);
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    win.loadFile(indexPath, { search: query }).catch(err => {
      console.error("[FxWindow] loadFile failed:", err);
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    logEvent("popup:closed", { key: "fx", channelId });
    fxWindows.delete(channelId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("fx-window:closed", channelId);
    }
  });
}

/**
 * Mixer-Popup-Fenster (Multi-Window-Workspace, post-v1.26.0).
 *
 * Identisches Pattern wie createPerformanceWindow:
 *   - Singleton (es gibt nur einen Mixer pro Session — anders als FX-Panels).
 *   - Frameless: Renderer (MixerPopupApp) rendert eigenen Header via
 *     DetachableWindowHeader.
 *   - URL-Param `?mixerPopup=1` signalisiert dem Renderer den Mode.
 *   - BUG-017: `setMenu(null)` — Popups dürfen keine Menu-Accelerators
 *     erben (würden sonst app.quit() triggern können).
 */
function createMixerWindow(): void {
  if (mixerWindow && !mixerWindow.isDestroyed()) {
    mixerWindow.focus();
    return;
  }

  const saved = getSavedLayoutFor("mixer");

  mixerWindow = new BrowserWindow({
    width: saved?.bounds?.width ?? 720,
    height: saved?.bounds?.height ?? 520,
    x: saved?.bounds?.x,
    y: saved?.bounds?.y,
    minWidth: 480,
    minHeight: 360,
    title: `${APP_NAME} – Mixer`,
    backgroundColor: "#0a0a0a",
    frame: false,
    titleBarStyle: "default",
    // BUG-019 (post-v1.33.0): parent:mainWindow ENTFERNT um Windows-WM_CLOSE-
    // Cascade vom Child auf den Parent zu eliminieren. Popups sind jetzt
    // truly independent windows. Schließen eines Popups kann mainWindow
    // niemals direkt beeinflussen. Kaskade-Close MAIN→POPUPS bleibt erhalten
    // (programmatisch in mainWindow.on('closed')).
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      webSecurity: !isDev,
    },
  });

  // BUG-017 fix: popup windows must NOT inherit the application menu.
  mixerWindow.setMenu(null);
  installWebContentsCrashHandlers(mixerWindow.webContents, "mixer");

  if (saved?.alwaysOnTop) mixerWindow.setAlwaysOnTop(true);
  appStore?.setPopupLayout("mixer", {
    isOpen: true,
    bounds: saved?.bounds,
    alwaysOnTop: saved?.alwaysOnTop ?? false,
  });
  mixerWindow.on("close", () => {
    markPopupClosed();
    if (mixerWindow) persistPopupLayout("mixer", mixerWindow);
    logEvent("popup:close-end", { key: "mixer" });
  });

  mixerWindow.once("ready-to-show", () => {
    mixerWindow?.show();
  });

  if (isDev) {
    mixerWindow.loadURL(`${devServerUrl}?mixerPopup=1`);
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    mixerWindow.loadFile(indexPath, { search: "mixerPopup=1" }).catch(err => {
      console.error("[MixerWindow] loadFile failed:", err);
    });
  }

  mixerWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mixerWindow.on("closed", () => {
    logEvent("popup:closed", { key: "mixer" });
    mixerWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mixer-window:closed");
    }
  });
}

/**
 * Sample-Browser-Popup-Fenster (Multi-Window-Workspace, post-v1.27.0).
 *
 * Singleton — eine Sample-Library-Ansicht pro Session. Identisches Pattern
 * wie createMixerWindow. URL-Param `?sampleBrowserPopup=1` → Renderer
 * rendert SampleBrowserPopupApp.
 *
 * BUG-017: `setMenu(null)` damit das Popup keinen Menu-Accelerator-Quit
 * triggern kann.
 */
function createSampleBrowserWindow(): void {
  if (sampleBrowserWindow && !sampleBrowserWindow.isDestroyed()) {
    sampleBrowserWindow.focus();
    return;
  }

  const saved = getSavedLayoutFor("sampleBrowser");

  sampleBrowserWindow = new BrowserWindow({
    width: saved?.bounds?.width ?? 480,
    height: saved?.bounds?.height ?? 640,
    x: saved?.bounds?.x,
    y: saved?.bounds?.y,
    minWidth: 340,
    minHeight: 400,
    title: `${APP_NAME} – Sample Browser`,
    backgroundColor: "#0a0a0a",
    frame: false,
    titleBarStyle: "default",
    // BUG-019 (post-v1.33.0): parent:mainWindow ENTFERNT um Windows-WM_CLOSE-
    // Cascade vom Child auf den Parent zu eliminieren. Popups sind jetzt
    // truly independent windows. Schließen eines Popups kann mainWindow
    // niemals direkt beeinflussen. Kaskade-Close MAIN→POPUPS bleibt erhalten
    // (programmatisch in mainWindow.on('closed')).
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      webSecurity: !isDev,
    },
  });

  sampleBrowserWindow.setMenu(null);
  installWebContentsCrashHandlers(sampleBrowserWindow.webContents, "sampleBrowser");

  if (saved?.alwaysOnTop) sampleBrowserWindow.setAlwaysOnTop(true);
  appStore?.setPopupLayout("sampleBrowser", {
    isOpen: true,
    bounds: saved?.bounds,
    alwaysOnTop: saved?.alwaysOnTop ?? false,
  });
  sampleBrowserWindow.on("close", () => {
    markPopupClosed();
    if (sampleBrowserWindow) persistPopupLayout("sampleBrowser", sampleBrowserWindow);
    logEvent("popup:close-end", { key: "sampleBrowser" });
  });

  sampleBrowserWindow.once("ready-to-show", () => {
    sampleBrowserWindow?.show();
  });

  if (isDev) {
    sampleBrowserWindow.loadURL(`${devServerUrl}?sampleBrowserPopup=1`);
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    sampleBrowserWindow.loadFile(indexPath, { search: "sampleBrowserPopup=1" }).catch(err => {
      console.error("[SampleBrowserWindow] loadFile failed:", err);
    });
  }

  sampleBrowserWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  sampleBrowserWindow.on("closed", () => {
    logEvent("popup:closed", { key: "sampleBrowser" });
    sampleBrowserWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("sample-browser-window:closed");
    }
  });
}

/**
 * Pattern-Generator-Popup (Multi-Window-Workspace, post-v1.27.0).
 *
 * Singleton. URL-Param `?patternGenPopup=1`. setMenu(null) per BUG-017.
 */
function createPatternGenWindow(): void {
  if (patternGenWindow && !patternGenWindow.isDestroyed()) {
    patternGenWindow.focus();
    return;
  }

  const saved = getSavedLayoutFor("patternGen");

  patternGenWindow = new BrowserWindow({
    width: saved?.bounds?.width ?? 560,
    height: saved?.bounds?.height ?? 720,
    x: saved?.bounds?.x,
    y: saved?.bounds?.y,
    minWidth: 380,
    minHeight: 480,
    title: `${APP_NAME} – Pattern Generator`,
    backgroundColor: "#0a0a0a",
    frame: false,
    titleBarStyle: "default",
    // BUG-019 (post-v1.33.0): parent:mainWindow ENTFERNT um Windows-WM_CLOSE-
    // Cascade vom Child auf den Parent zu eliminieren. Popups sind jetzt
    // truly independent windows. Schließen eines Popups kann mainWindow
    // niemals direkt beeinflussen. Kaskade-Close MAIN→POPUPS bleibt erhalten
    // (programmatisch in mainWindow.on('closed')).
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      webSecurity: !isDev,
    },
  });

  patternGenWindow.setMenu(null);
  installWebContentsCrashHandlers(patternGenWindow.webContents, "patternGen");

  if (saved?.alwaysOnTop) patternGenWindow.setAlwaysOnTop(true);
  appStore?.setPopupLayout("patternGen", {
    isOpen: true,
    bounds: saved?.bounds,
    alwaysOnTop: saved?.alwaysOnTop ?? false,
  });
  patternGenWindow.on("close", () => {
    markPopupClosed();
    if (patternGenWindow) persistPopupLayout("patternGen", patternGenWindow);
    logEvent("popup:close-end", { key: "patternGen" });
  });

  patternGenWindow.once("ready-to-show", () => {
    patternGenWindow?.show();
  });

  if (isDev) {
    patternGenWindow.loadURL(`${devServerUrl}?patternGenPopup=1`);
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    patternGenWindow.loadFile(indexPath, { search: "patternGenPopup=1" }).catch(err => {
      console.error("[PatternGenWindow] loadFile failed:", err);
    });
  }

  patternGenWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  patternGenWindow.on("closed", () => {
    logEvent("popup:closed", { key: "patternGen" });
    patternGenWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pattern-gen-window:closed");
    }
  });
}

/**
 * Generic factory für die simpleren Tools-Popups (post-v1.28.0).
 * Reduziert Code-Duplikation: pro neuem Tools-Popup nur die config-Map +
 * eine setter function. Setup für IPC-Handler etc. teilen sich.
 *
 * Wir factorisieren NICHT die 4 älteren Popups (perf, fx, mixer, sampleBrowser,
 * patternGen) — die bleiben als geprüfte Templates. Nur die NEUEN Tools-Popups
 * (keyboardSampler, chordProgression, patternLibrary) nutzen diesen Helper.
 */
interface SimpleSingletonConfig {
  key: SingletonPopupKey;
  urlParam: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  title: string;
}

function createSimpleSingletonWindow(
  config: SimpleSingletonConfig,
  setter: (win: BrowserWindow | null) => void,
  currentGetter: () => BrowserWindow | null,
): void {
  const existing = currentGetter();
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const saved = getSavedLayoutFor(config.key);

  const win = new BrowserWindow({
    width: saved?.bounds?.width ?? config.width,
    height: saved?.bounds?.height ?? config.height,
    x: saved?.bounds?.x,
    y: saved?.bounds?.y,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    title: `${APP_NAME} – ${config.title}`,
    backgroundColor: "#0a0a0a",
    frame: false,
    titleBarStyle: "default",
    // BUG-019 (post-v1.33.0): parent:mainWindow ENTFERNT um Windows-WM_CLOSE-
    // Cascade vom Child auf den Parent zu eliminieren. Popups sind jetzt
    // truly independent windows. Schließen eines Popups kann mainWindow
    // niemals direkt beeinflussen. Kaskade-Close MAIN→POPUPS bleibt erhalten
    // (programmatisch in mainWindow.on('closed')).
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      autoplayPolicy: "no-user-gesture-required",
      webSecurity: !isDev,
    },
  });

  setter(win);
  win.setMenu(null);
  installWebContentsCrashHandlers(win.webContents, config.key);

  if (saved?.alwaysOnTop) win.setAlwaysOnTop(true);
  appStore?.setPopupLayout(config.key, {
    isOpen: true,
    bounds: saved?.bounds,
    alwaysOnTop: saved?.alwaysOnTop ?? false,
  });
  win.on("close", () => {
    markPopupClosed();
    persistPopupLayout(config.key, win);
    logEvent("popup:close-end", { key: config.key });
  });

  win.once("ready-to-show", () => win.show());

  if (isDev) {
    win.loadURL(`${devServerUrl}?${config.urlParam}=1`);
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "public", "index.html");
    win.loadFile(indexPath, { search: `${config.urlParam}=1` }).catch(err => {
      console.error(`[${config.key}Window] loadFile failed:`, err);
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    logEvent("popup:closed", { key: config.key });
    setter(null);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`${config.urlParam}-window:closed`);
    }
  });
}

function createKeyboardSamplerWindow(): void {
  createSimpleSingletonWindow(
    {
      key: "keyboardSampler",
      urlParam: "keyboardSamplerPopup",
      width: 560,
      height: 640,
      minWidth: 380,
      minHeight: 420,
      title: "Keyboard Sampler",
    },
    (w) => { keyboardSamplerWindow = w; },
    () => keyboardSamplerWindow,
  );
}

function createChordProgressionWindow(): void {
  createSimpleSingletonWindow(
    {
      key: "chordProgression",
      urlParam: "chordProgressionPopup",
      width: 620,
      height: 580,
      minWidth: 420,
      minHeight: 400,
      title: "Chord Progressions",
    },
    (w) => { chordProgressionWindow = w; },
    () => chordProgressionWindow,
  );
}

function createPatternLibraryWindow(): void {
  createSimpleSingletonWindow(
    {
      key: "patternLibrary",
      urlParam: "patternLibraryPopup",
      width: 720,
      height: 640,
      minWidth: 480,
      minHeight: 420,
      title: "Pattern Library",
    },
    (w) => { patternLibraryWindow = w; },
    () => patternLibraryWindow,
  );
}

// ─── System-Tray ─────────────────────────────────────────────────────────────

function updateTrayMenu(): void {
  if (!tray) return;

  const isVisible = mainWindow?.isVisible() ?? false;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: APP_NAME,
      enabled: false,
    },
    { type: "separator" },
    {
      label: isVisible ? "Fenster ausblenden" : "Fenster anzeigen",
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
    },
    {
      label: "Vollbild",
      type: "checkbox",
      checked: mainWindow?.isFullScreen() ?? false,
      click: () => {
        if (mainWindow) {
          mainWindow.setFullScreen(!mainWindow.isFullScreen());
        }
      },
    },
    { type: "separator" },
    {
      label: "Beenden",
      click: () => {
        // BUG-018: legitimer User-Quit via Tray. Whitelist.
        requestUserQuit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray(): void {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);

  // Klick auf Tray-Icon: Fenster anzeigen/verstecken
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  updateTrayMenu();
}

// ─── Dynamisches Menü "Zuletzt geöffnete Projekte" ───────────────────────────

/**
 * Erstellt die Menüeinträge für "Zuletzt geöffnete Projekte".
 * Wird bei jedem buildMenu()-Aufruf neu generiert.
 */
function buildRecentProjectsSubmenu(): Electron.MenuItemConstructorOptions[] {
  if (!appStore) return [{ label: "Keine zuletzt geöffneten Projekte", enabled: false }];

  const recentProjects = appStore.getRecentProjects();

  if (recentProjects.length === 0) {
    return [{ label: "Keine zuletzt geöffneten Projekte", enabled: false }];
  }

  const items: Electron.MenuItemConstructorOptions[] = recentProjects.map((project) => ({
    label: project.name,
    sublabel: project.filePath,
    click: () => {
      // Prüfen ob Datei noch existiert (asynchron, kein Blockieren)
      fs.promises
        .access(project.filePath, fs.constants.R_OK)
        .then(() => {
          mainWindow?.webContents.send("menu:open-project", project.filePath);
          // Zugriffszeitpunkt aktualisieren
          appStore?.addRecentProject(project.filePath);
          // Menü neu aufbauen damit Reihenfolge aktualisiert wird
          buildMenu();
        })
        .catch(() => {
          // Datei nicht mehr vorhanden – aus Liste entfernen
          appStore?.removeRecentProject(project.filePath);
          buildMenu();
          dialog.showMessageBox(mainWindow!, {
            type: "warning",
            title: "Datei nicht gefunden",
            message: `Die Datei "${project.name}" wurde nicht gefunden.`,
            detail: project.filePath,
            buttons: ["OK"],
          });
        });
    },
  }));

  items.push(
    { type: "separator" },
    {
      label: "Zuletzt geöffnete Projekte löschen",
      click: () => {
        appStore?.clearRecentProjects();
        mainWindow?.webContents.send("store:recent-changed", []);
        buildMenu();
      },
    }
  );

  return items;
}

// ─── Anwendungsmenü ──────────────────────────────────────────────────────────

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS App-Menü
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),

    // ── Datei ────────────────────────────────────────────────────────────────
    {
      label: "Datei",
      submenu: [
        {
          label: "Neues Projekt",
          accelerator: "CmdOrCtrl+N",
          click: () => mainWindow?.webContents.send("menu:new-project"),
        },
        { type: "separator" },
        {
          label: "Projekt öffnen…",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              title: "Projekt öffnen",
              filters: [
                { name: "Synthstudio Projekt", extensions: ["synth", "json"] },
                { name: "Alle Dateien", extensions: ["*"] },
              ],
              properties: ["openFile"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              const filePath = result.filePaths[0];
              mainWindow?.webContents.send("menu:open-project", filePath);
              // Zu zuletzt geöffneten Projekten hinzufügen
              appStore?.addRecentProject(filePath);
              mainWindow?.webContents.send(
                "store:recent-changed",
                appStore?.getRecentProjects() ?? []
              );
              buildMenu();
            }
          },
        },
        // ── Zuletzt geöffnete Projekte ────────────────────────────────────
        {
          label: "Zuletzt geöffnete Projekte",
          submenu: buildRecentProjectsSubmenu(),
        },
        { type: "separator" },
        {
          label: "Projekt speichern",
          accelerator: "CmdOrCtrl+S",
          click: () => mainWindow?.webContents.send("menu:save-project"),
        },
        {
          label: "Projekt speichern unter…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: async () => {
            const result = await dialog.showSaveDialog(mainWindow!, {
              title: "Projekt speichern unter",
              defaultPath: "mein-projekt.synth",
              filters: [
                { name: "Synthstudio Projekt", extensions: ["synth"] },
                { name: "JSON", extensions: ["json"] },
              ],
            });
            if (!result.canceled && result.filePath) {
              mainWindow?.webContents.send("menu:save-project-as", result.filePath);
              // Gespeichertes Projekt zu zuletzt geöffneten hinzufügen
              appStore?.addRecentProject(result.filePath);
              mainWindow?.webContents.send(
                "store:recent-changed",
                appStore?.getRecentProjects() ?? []
              );
              buildMenu();
            }
          },
        },
        { type: "separator" },
        {
          label: "Projekt exportieren…",
          accelerator: "CmdOrCtrl+E",
          click: () => mainWindow?.webContents.send("menu:export-project"),
        },
        {
          label: "Projekt importieren…",
          accelerator: "CmdOrCtrl+I",
          click: () => mainWindow?.webContents.send("menu:import-project"),
        },
        { type: "separator" },
        // BUG-017 fix: "Beenden" / "Schließen" is context-aware. If a popup
        // window (perf-popup, fx-popup) is focused, just close that window —
        // never quit the entire app from a tool-window context. On Mac the
        // standard role:close already does the right thing per-window.
        isMac
          ? { role: "close" as const }
          : {
              label: "Beenden",
              click: () => {
                const focused = BrowserWindow.getFocusedWindow();
                // If the focused window is the main window (or no window is
                // focused, which shouldn't normally happen), quit the app.
                if (!focused || focused === mainWindow) {
                  // BUG-018: legitimer User-Quit via Datei-Menü. Whitelist.
                  requestUserQuit();
                  return;
                }
                // Otherwise (a popup like perf-popup or fx-popup is focused),
                // only close that popup. Leaves the main app + audio engine
                // alive — a safer default for tool windows.
                focused.close();
              },
            },
      ],
    },

    // ── Bearbeiten ───────────────────────────────────────────────────────────
    // Music-Production-fokussiert (kein Cut/Copy/Paste — das macht für eine
    // DAW keinen Sinn, in Text-Inputs funktioniert Ctrl+C/V eh nativ).
    // Stattdessen: Undo/Redo + Pattern-Aktionen.
    {
      label: "Bearbeiten",
      submenu: [
        {
          label: "Rückgängig",
          accelerator: "CmdOrCtrl+Z",
          click: () => mainWindow?.webContents.send("menu:undo"),
        },
        {
          label: "Wiederholen",
          accelerator: isMac ? "Cmd+Shift+Z" : "CmdOrCtrl+Y",
          click: () => mainWindow?.webContents.send("menu:redo"),
        },
        { type: "separator" },
        {
          label: "Pattern leeren",
          click: () => mainWindow?.webContents.send("menu:pattern-clear"),
        },
        {
          label: "Pattern zufällig füllen",
          click: () => mainWindow?.webContents.send("menu:pattern-randomize"),
        },
        {
          label: "Pattern füllen",
          click: () => mainWindow?.webContents.send("menu:pattern-fill"),
        },
        {
          label: "Pattern duplizieren",
          click: () => mainWindow?.webContents.send("menu:pattern-duplicate"),
        },
      ],
    },

    // ── Transport ────────────────────────────────────────────────────────────
    // NEU (post-v1.25.0): eigenes Top-Level-Menü statt verschachtelt unter Audio.
    {
      label: "Transport",
      submenu: [
        {
          label: "Play / Stop",
          accelerator: "Space",
          click: () => mainWindow?.webContents.send("menu:transport-toggle"),
        },
        {
          label: "Aufnahme",
          accelerator: "CmdOrCtrl+R",
          click: () => mainWindow?.webContents.send("menu:transport-record"),
        },
        { type: "separator" },
        {
          label: "BPM erhöhen",
          accelerator: "CmdOrCtrl+Up",
          click: () => mainWindow?.webContents.send("menu:bpm-up"),
        },
        {
          label: "BPM verringern",
          accelerator: "CmdOrCtrl+Down",
          click: () => mainWindow?.webContents.send("menu:bpm-down"),
        },
        {
          label: "Tap Tempo",
          accelerator: "CmdOrCtrl+T",
          click: () => mainWindow?.webContents.send("menu:tap-tempo"),
        },
        { type: "separator" },
        {
          label: "Nächstes Pattern",
          accelerator: "CmdOrCtrl+Right",
          click: () => mainWindow?.webContents.send("menu:pattern-next"),
        },
        {
          label: "Vorheriges Pattern",
          accelerator: "CmdOrCtrl+Left",
          click: () => mainWindow?.webContents.send("menu:pattern-prev"),
        },
      ],
    },

    // ── Ansicht ──────────────────────────────────────────────────────────────
    {
      label: "Ansicht",
      submenu: [
        // Tab-Navigation — Music-Production-spezifisch (post-v1.25.0)
        {
          label: "Sequencer",
          accelerator: "F1",
          click: () => mainWindow?.webContents.send("menu:tab", "sequencer"),
        },
        {
          label: "Mixer",
          accelerator: "F2",
          click: () => mainWindow?.webContents.send("menu:tab", "mixer"),
        },
        {
          label: "Song",
          accelerator: "F3",
          click: () => mainWindow?.webContents.send("menu:tab", "song"),
        },
        {
          label: "Humanizer",
          accelerator: "F4",
          click: () => mainWindow?.webContents.send("menu:tab", "humanizer"),
        },
        {
          label: "Tools",
          accelerator: "F5",
          click: () => mainWindow?.webContents.send("menu:tab", "tools"),
        },
        {
          label: "Kollaboration",
          accelerator: "F6",
          click: () => mainWindow?.webContents.send("menu:tab", "kollaboration"),
        },
        { type: "separator" as const },
        { role: "reload" as const },
        { role: "forceReload" as const },
        ...(isDev ? [{ role: "toggleDevTools" as const }] : []),
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        {
          label: "Vollbild",
          accelerator: "F11",
          type: "checkbox" as const,
          checked: false,
          click: (menuItem) => {
            const isFullScreen = mainWindow?.isFullScreen() ?? false;
            mainWindow?.setFullScreen(!isFullScreen);
            menuItem.checked = !isFullScreen;
          },
        },
      ],
    },

    // ── Sample ───────────────────────────────────────────────────────────────
    // Umbenannt von "Audio" (post-v1.25.0) — fokussiert auf Sample-Workflow.
    // Transport ist jetzt eigenes Top-Level-Menü, MIDI-Import bleibt hier
    // weil es einen Sample-/Pattern-Kontext-Effekt hat.
    {
      label: "Sample",
      submenu: [
        {
          label: "Sample-Bibliothek öffnen",
          accelerator: "CmdOrCtrl+B",
          click: () => mainWindow?.webContents.send("menu:open-sample-browser"),
        },
        { type: "separator" },
        {
          label: "Samples importieren…",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              title: "Samples importieren",
              filters: [
                {
                  name: "Audio-Dateien",
                  extensions: ["wav", "mp3", "aif", "aiff", "ogg", "flac", "m4a"],
                },
              ],
              properties: ["openFile", "multiSelections"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send("menu:import-samples", result.filePaths);
            }
          },
        },
        {
          label: "Sample-Ordner importieren…",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              title: "Sample-Ordner importieren",
              properties: ["openDirectory"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              // Import über IPC-Handler starten (mit Progress)
              const importId = `import_${Date.now()}`;
              mainWindow?.webContents.send("samples:import-started", { importId });
              startFolderImport(importId, result.filePaths[0]);
            }
          },
        },
        {
          label: "ZIP-Archiv importieren…",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              title: "ZIP-Archiv mit Samples importieren",
              filters: [
                { name: "ZIP-Archive", extensions: ["zip"] },
              ],
              properties: ["openFile"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              const importId = `zip_import_${Date.now()}`;
              mainWindow?.webContents.send("samples:import-started", { importId });
              const { importZipFile } = await import("./zip-import");
              importZipFile(result.filePaths[0], importId, mainWindow!);
            }
          },
        },
        { type: "separator" },
        {
          label: "MIDI-Datei importieren…",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              title: "MIDI-Datei importieren",
              filters: [{ name: "MIDI-Dateien", extensions: ["mid", "midi"] }],
              properties: ["openFile"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send("menu:import-midi", result.filePaths[0]);
            }
          },
        },
        { type: "separator" },
        {
          label: "Audio-Workbench öffnen",
          click: () => mainWindow?.webContents.send("menu:open-audio-workbench"),
        },
      ],
    },

    // ── Fenster ──────────────────────────────────────────────────────────────
    {
      label: "Fenster",
      submenu: [
        {
          label: "Performance Mode",
          accelerator: "F12",
          click: () => mainWindow?.webContents.send("menu:open-performance"),
        },
        {
          label: "Performance Mode in separatem Fenster",
          click: () => {
            // Direkt im Main aufrufen — kein Renderer-Trip nötig
            createPerformanceWindow();
          },
        },
        { type: "separator" as const },
        { role: "minimize" as const },
        {
          label: "Vollbild umschalten",
          accelerator: "F11",
          click: () => {
            if (mainWindow) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          },
        },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },

    // ── Hilfe ────────────────────────────────────────────────────────────────
    {
      role: "help" as const,
      submenu: [
        {
          label: "Synthstudio Dokumentation",
          click: () =>
            shell.openExternal(
              "https://github.com/GeorgDub/Synthstudio"
            ),
        },
        {
          label: "GitHub Repository",
          click: () =>
            shell.openExternal("https://github.com/GeorgDub/Synthstudio"),
        },
        { type: "separator" },
        {
          label: `Version ${app.getVersion()}`,
          enabled: false,
        },
        ...(isDev
          ? []
          : [
              {
                label: "Nach Updates suchen…",
                click: () => {
                  if (mainWindow) {
                    checkForUpdatesManually(mainWindow);
                  }
                },
              },
            ]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── Folder-Import mit Progress und Cancel ───────────────────────────────────

async function startFolderImport(importId: string, folderPath: string): Promise<void> {
  importCancelFlags.set(importId, false);

  try {
    const totalFiles = await countAudioFiles(folderPath);
    mainWindow?.webContents.send("samples:import-progress", {
      importId,
      current: 0,
      total: totalFiles,
      percentage: 0,
      phase: "counting",
    });

    if (totalFiles === 0) {
      mainWindow?.webContents.send("samples:import-complete", {
        importId,
        imported: 0,
        errors: 0,
        message: "Keine Audio-Dateien gefunden.",
      });
      importCancelFlags.delete(importId);
      return;
    }

    // Rekursiver Import
    let imported = 0;
    let errors = 0;
    const samples: Array<{
      id: string;
      name: string;
      path: string;
      category: string;
      size: number;
      tags: string[];
    }> = [];

    await scanAndImport(folderPath, folderPath, importId, {
      onFile: async (filePath) => {
        if (importCancelFlags.get(importId)) return false; // abgebrochen

        try {
          const stat = await fs.promises.stat(filePath);
          const relativePath = path.relative(folderPath, filePath);
          const category = detectCategory(filePath);

          samples.push({
            id: `sample_${Date.now()}_${imported}`,
            name: path.basename(filePath, path.extname(filePath)),
            path: filePath,
            category,
            size: stat.size,
            tags: autoTag(filePath),
          });

          imported++;

          // Progress alle 5 Dateien oder bei letzter Datei senden
          if (imported % 5 === 0 || imported === totalFiles) {
            mainWindow?.webContents.send("samples:import-progress", {
              importId,
              current: imported,
              total: totalFiles,
              percentage: Math.round((imported / totalFiles) * 100),
              phase: "importing",
              currentFile: path.basename(filePath),
              relativePath,
            });
          }
        } catch (err) {
          errors++;
          mainWindow?.webContents.send("samples:import-error", {
            importId,
            filePath,
            error: String(err),
          });
        }
        return true; // weitermachen
      },
    });

    if (importCancelFlags.get(importId)) {
      mainWindow?.webContents.send("samples:import-cancelled", {
        importId,
        imported,
        errors,
      });
    } else {
      mainWindow?.webContents.send("samples:import-complete", {
        importId,
        imported,
        errors,
        samples,
        message: `${imported} Samples importiert${errors > 0 ? `, ${errors} Fehler` : ""}.`,
      });

      // Desktop-Benachrichtigung (nur wenn App im Hintergrund)
      if (!mainWindow?.isFocused() && Notification.isSupported()) {
        new Notification({
          title: APP_NAME,
          body: `${imported} Samples erfolgreich importiert.`,
        }).show();
      }
    }
  } catch (err) {
    mainWindow?.webContents.send("samples:import-complete", {
      importId,
      imported: 0,
      errors: 1,
      message: `Import fehlgeschlagen: ${String(err)}`,
    });
  } finally {
    importCancelFlags.delete(importId);
  }
}

interface ScanCallbacks {
  onFile: (filePath: string) => Promise<boolean>;
}

async function scanAndImport(
  rootPath: string,
  currentPath: string,
  importId: string,
  callbacks: ScanCallbacks
): Promise<void> {
  if (importCancelFlags.get(importId)) return;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
  } catch (err) {
    mainWindow?.webContents.send("samples:import-error", {
      importId,
      filePath: currentPath,
      error: `Verzeichnis nicht lesbar: ${String(err)}`,
    });
    return;
  }

  for (const entry of entries) {
    if (importCancelFlags.get(importId)) return;

    const fullPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      // Versteckte Ordner überspringen
      if (entry.name.startsWith(".")) continue;
      await scanAndImport(rootPath, fullPath, importId, callbacks);
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const shouldContinue = await callbacks.onFile(fullPath);
      if (!shouldContinue) return;
    }
  }
}

// ─── IPC-Handler ─────────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  // ── Dateisystem ─────────────────────────────────────────────────────────────

  ipcMain.handle("fs:read-file", async (_event, filePath: string) => {
    try {
      // Sicherheitscheck: Nur Audio-Dateien erlauben
      const ext = path.extname(filePath).toLowerCase();
      if (!AUDIO_EXTENSIONS.has(ext) && ext !== ".json" && ext !== ".synth") {
        return { success: false, error: "Dateityp nicht erlaubt" };
      }
      const buffer = await fs.promises.readFile(filePath);
      const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("fs:list-directory", async (_event, dirPath: string) => {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      return {
        success: true,
        entries: entries
          .filter((e) => !e.name.startsWith(".")) // Versteckte Dateien ausblenden
          .map((e) => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            path: path.join(dirPath, e.name),
            isAudio: AUDIO_EXTENSIONS.has(path.extname(e.name).toLowerCase()),
          })),
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("fs:write-file", async (_event, filePath: string, data: string) => {
    try {
      // Nur .synth und .json erlauben
      const ext = path.extname(filePath).toLowerCase();
      if (ext !== ".synth" && ext !== ".json") {
        return { success: false, error: "Nur .synth und .json Dateien erlaubt" };
      }
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, data, "utf-8");
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── Folder-Import ────────────────────────────────────────────────────────────

  ipcMain.handle("samples:import-folder", async (_event, folderPath: string) => {
    if (!folderPath || typeof folderPath !== "string") {
      throw new Error("Ungültiger Ordnerpfad");
    }

    const resolvedPath = path.resolve(folderPath);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(resolvedPath);
    } catch {
      throw new Error("Ordnerpfad nicht gefunden");
    }

    if (!stat.isDirectory()) {
      throw new Error("Der angegebene Pfad ist kein Ordner");
    }

    const importId = `import_${Date.now()}`;
    // Import-Start signalisieren, dann asynchron starten
    mainWindow?.webContents.send("samples:import-started", { importId });
    void startFolderImport(importId, resolvedPath);
    return { importId };
  });

  ipcMain.handle("samples:cancel-import", async (_event, importId: string) => {
    if (importCancelFlags.has(importId)) {
      importCancelFlags.set(importId, true);
      return { success: true };
    }
    return { success: false, error: "Import-ID nicht gefunden" };
  });

  // ── Dialoge ──────────────────────────────────────────────────────────────────

  ipcMain.handle("dialog:open-file", async (_event, options: Electron.OpenDialogOptions) => {
    const result = await dialog.showOpenDialog(mainWindow!, options);
    return result;
  });

  ipcMain.handle("dialog:save-file", async (_event, options: Electron.SaveDialogOptions) => {
    const result = await dialog.showSaveDialog(mainWindow!, options);
    return result;
  });

  ipcMain.handle(
    "dialog:message",
    async (_event, options: Electron.MessageBoxOptions) => {
      const result = await dialog.showMessageBox(mainWindow!, options);
      return result;
    }
  );

  // ── Fenster-Steuerung ────────────────────────────────────────────────────────

  ipcMain.handle("window:set-fullscreen", (_event, fullscreen: boolean) => {
    mainWindow?.setFullScreen(fullscreen);
    return { success: true };
  });

  ipcMain.handle("window:is-fullscreen", () => {
    return mainWindow?.isFullScreen() ?? false;
  });

  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.handle("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  // ── Performance-Mode Popup-Window (ROADMAP feature) ──────────────────────────
  // Channels sind alle narrow-data-only: keine file paths, keine shell ops,
  // nur plain JSON-Objekte für State-Sync. Siehe SECURITY-Review im INDEX.js.

  ipcMain.handle("window:open-performance", () => {
    createPerformanceWindow();
    return { success: true };
  });

  ipcMain.handle("window:close-performance", () => {
    logEvent("ipc:close-popup", { key: "performance", alive: !!perfWindow && !perfWindow.isDestroyed() });
    destroyPopupSafely("performance", perfWindow);
    return { success: true };
  });

  ipcMain.handle("window:is-performance-open", () => {
    return perfWindow !== null && !perfWindow.isDestroyed();
  });

  // Always-on-top Toggle für das Performance-Popup (Phase 2). Wird vom Popup-
  // Renderer aufgerufen damit User es als Floating-Window über andere Apps
  // legen kann (typischer DAW-Multi-Monitor-Workflow).
  ipcMain.handle("window:perf-set-always-on-top", (_event, alwaysOnTop: boolean) => {
    if (perfWindow && !perfWindow.isDestroyed()) {
      perfWindow.setAlwaysOnTop(!!alwaysOnTop);
      return { success: true, alwaysOnTop: !!alwaysOnTop };
    }
    return { success: false, alwaysOnTop: false };
  });

  ipcMain.handle("window:perf-is-always-on-top", () => {
    if (perfWindow && !perfWindow.isDestroyed()) {
      return perfWindow.isAlwaysOnTop();
    }
    return false;
  });

  // State-Broadcast Main → Popup. Payload muss serialisierbar sein (kein File-
  // System, keine Native-Objekte). Main-Renderer ruft das auf wenn sich
  // performance-relevanter State ändert.
  ipcMain.on("perf-sync:state", (_event, statePayload: unknown) => {
    if (perfWindow && !perfWindow.isDestroyed()) {
      perfWindow.webContents.send("perf-sync:state", statePayload);
    }
  });

  // Action Popup → Main. Popup-Renderer ruft das wenn der User im Popup
  // einen Pad klickt / Quantize-Mode ändert. Main-Renderer empfängt es und
  // dispatcht in die Stores.
  ipcMain.on("perf-sync:action", (_event, actionPayload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("perf-sync:action", actionPayload);
    }
  });

  // ── FX-Window Popups (Multi-Window-Workspace Phase 1) ────────────────────────
  // Pro Kanal ein eigenes FX-Fenster. Pattern wie perf-Popup: schmale Channels,
  // narrow-data-only Payloads, IPC-Bridge zwischen Main-Renderer und FX-Popup.

  ipcMain.handle("window:open-fx", (_event, channelId: string) => {
    if (!channelId || typeof channelId !== "string") {
      return { success: false, error: "channelId fehlt" };
    }
    createFxWindow(channelId);
    return { success: true };
  });

  ipcMain.handle("window:close-fx", (_event, channelId: string) => {
    logEvent("ipc:close-popup", { key: `fx:${channelId}`, alive: fxWindows.has(channelId) });
    if (!channelId || typeof channelId !== "string") {
      return { success: false, error: "channelId fehlt" };
    }
    const win = fxWindows.get(channelId);
    destroyPopupSafely(channelId, win ?? null, true);
    return { success: true };
  });

  ipcMain.handle("window:is-fx-open", (_event, channelId: string) => {
    if (!channelId || typeof channelId !== "string") return false;
    const win = fxWindows.get(channelId);
    return !!(win && !win.isDestroyed());
  });

  // Always-on-top Toggle pro FX-Window.
  ipcMain.handle(
    "window:fx-set-always-on-top",
    (_event, payload: { channelId: string; alwaysOnTop: boolean }) => {
      const { channelId, alwaysOnTop } = payload ?? {};
      if (!channelId || typeof channelId !== "string") {
        return { success: false, alwaysOnTop: false };
      }
      const win = fxWindows.get(channelId);
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(!!alwaysOnTop);
        return { success: true, alwaysOnTop: !!alwaysOnTop };
      }
      return { success: false, alwaysOnTop: false };
    },
  );

  ipcMain.handle("window:fx-is-always-on-top", (_event, channelId: string) => {
    if (!channelId || typeof channelId !== "string") return false;
    const win = fxWindows.get(channelId);
    if (win && !win.isDestroyed()) return win.isAlwaysOnTop();
    return false;
  });

  // State-Broadcast Main → FX-Popup. Payload-Form:
  // { channelId: string, state: <serializable> }
  ipcMain.on(
    "fx-sync:state",
    (_event, payload: { channelId: string; state: unknown }) => {
      const { channelId, state } = payload ?? {};
      if (!channelId || typeof channelId !== "string") return;
      const win = fxWindows.get(channelId);
      if (win && !win.isDestroyed()) {
        win.webContents.send("fx-sync:state", { channelId, state });
      }
    },
  );

  // Action FX-Popup → Main. Payload-Form:
  // { channelId: string, action: <serializable> }
  ipcMain.on(
    "fx-sync:action",
    (_event, payload: { channelId: string; action: unknown }) => {
      const { channelId, action } = payload ?? {};
      if (!channelId || typeof channelId !== "string") return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("fx-sync:action", { channelId, action });
      }
    },
  );

  // ── Mixer-Window Popup (Multi-Window-Workspace, post-v1.26.0) ────────────────
  // Singleton-Pattern wie perf-popup. Channels narrow-data-only.

  ipcMain.handle("window:open-mixer", () => {
    createMixerWindow();
    return { success: true };
  });

  ipcMain.handle("window:close-mixer", () => {
    logEvent("ipc:close-popup", { key: "mixer", alive: !!mixerWindow && !mixerWindow.isDestroyed() });
    destroyPopupSafely("mixer", mixerWindow);
    return { success: true };
  });

  ipcMain.handle("window:is-mixer-open", () => {
    return mixerWindow !== null && !mixerWindow.isDestroyed();
  });

  ipcMain.handle("window:mixer-set-always-on-top", (_event, alwaysOnTop: boolean) => {
    if (mixerWindow && !mixerWindow.isDestroyed()) {
      mixerWindow.setAlwaysOnTop(!!alwaysOnTop);
      return { success: true, alwaysOnTop: !!alwaysOnTop };
    }
    return { success: false, alwaysOnTop: false };
  });

  ipcMain.handle("window:mixer-is-always-on-top", () => {
    if (mixerWindow && !mixerWindow.isDestroyed()) {
      return mixerWindow.isAlwaysOnTop();
    }
    return false;
  });

  // State-Broadcast Main → Mixer-Popup.
  ipcMain.on("mixer-sync:state", (_event, statePayload: unknown) => {
    if (mixerWindow && !mixerWindow.isDestroyed()) {
      mixerWindow.webContents.send("mixer-sync:state", statePayload);
    }
  });

  // Action-Forwarding Mixer-Popup → Main.
  ipcMain.on("mixer-sync:action", (_event, actionPayload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mixer-sync:action", actionPayload);
    }
  });

  // ── Sample-Browser-Popup (Multi-Window-Workspace, post-v1.27.0) ──────────────
  // Singleton-Popup wie Mixer. Channels narrow-data-only — Payload enthält die
  // Sample-Metadaten (id, name, category, size) und Sample-Paths sind bereits
  // im Renderer-State; das Popup ist nur ein zweiter View darauf.

  ipcMain.handle("window:open-sample-browser", () => {
    createSampleBrowserWindow();
    return { success: true };
  });

  ipcMain.handle("window:close-sample-browser", () => {
    logEvent("ipc:close-popup", { key: "sampleBrowser", alive: !!sampleBrowserWindow && !sampleBrowserWindow.isDestroyed() });
    destroyPopupSafely("sampleBrowser", sampleBrowserWindow);
    return { success: true };
  });

  ipcMain.handle("window:is-sample-browser-open", () => {
    return sampleBrowserWindow !== null && !sampleBrowserWindow.isDestroyed();
  });

  ipcMain.handle("window:sample-browser-set-always-on-top", (_event, alwaysOnTop: boolean) => {
    if (sampleBrowserWindow && !sampleBrowserWindow.isDestroyed()) {
      sampleBrowserWindow.setAlwaysOnTop(!!alwaysOnTop);
      return { success: true, alwaysOnTop: !!alwaysOnTop };
    }
    return { success: false, alwaysOnTop: false };
  });

  ipcMain.handle("window:sample-browser-is-always-on-top", () => {
    if (sampleBrowserWindow && !sampleBrowserWindow.isDestroyed()) {
      return sampleBrowserWindow.isAlwaysOnTop();
    }
    return false;
  });

  // State-Broadcast Main → Sample-Browser-Popup.
  ipcMain.on("sample-browser-sync:state", (_event, statePayload: unknown) => {
    if (sampleBrowserWindow && !sampleBrowserWindow.isDestroyed()) {
      sampleBrowserWindow.webContents.send("sample-browser-sync:state", statePayload);
    }
  });

  // Action-Forwarding Sample-Browser-Popup → Main.
  ipcMain.on("sample-browser-sync:action", (_event, actionPayload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("sample-browser-sync:action", actionPayload);
    }
  });

  // ── Pattern-Generator-Popup (Multi-Window-Workspace, post-v1.27.0) ───────────

  ipcMain.handle("window:open-pattern-gen", () => {
    createPatternGenWindow();
    return { success: true };
  });

  ipcMain.handle("window:close-pattern-gen", () => {
    logEvent("ipc:close-popup", { key: "patternGen", alive: !!patternGenWindow && !patternGenWindow.isDestroyed() });
    destroyPopupSafely("patternGen", patternGenWindow);
    return { success: true };
  });

  ipcMain.handle("window:is-pattern-gen-open", () => {
    return patternGenWindow !== null && !patternGenWindow.isDestroyed();
  });

  ipcMain.handle("window:pattern-gen-set-always-on-top", (_event, alwaysOnTop: boolean) => {
    if (patternGenWindow && !patternGenWindow.isDestroyed()) {
      patternGenWindow.setAlwaysOnTop(!!alwaysOnTop);
      return { success: true, alwaysOnTop: !!alwaysOnTop };
    }
    return { success: false, alwaysOnTop: false };
  });

  ipcMain.handle("window:pattern-gen-is-always-on-top", () => {
    if (patternGenWindow && !patternGenWindow.isDestroyed()) {
      return patternGenWindow.isAlwaysOnTop();
    }
    return false;
  });

  // Action-Forwarding Pattern-Gen-Popup → Main. Payload meist:
  // { type: "apply-pattern", pattern: <GeneratedPattern> }
  ipcMain.on("pattern-gen-sync:action", (_event, actionPayload: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("pattern-gen-sync:action", actionPayload);
    }
  });

  // ── Generische Simple-Tools-Popups (post-v1.28.0) ────────────────────────────
  // Pattern: pro Popup 5 channels (open/close/is-open/set-aot/is-aot)
  //   + state-broadcast main→popup + action-forwarding popup→main.
  // Keyboard Sampler, Chord Progression, Pattern Library nutzen das Pattern.

  function registerSimplePopupHandlers(
    keyPrefix: string,
    getWin: () => BrowserWindow | null,
    createWin: () => void,
  ): void {
    ipcMain.handle(`window:open-${keyPrefix}`, () => {
      createWin();
      return { success: true };
    });
    ipcMain.handle(`window:close-${keyPrefix}`, () => {
      const w = getWin();
      logEvent("ipc:close-popup", { key: keyPrefix, alive: !!w && !w.isDestroyed() });
      // BUG-021: destroy() statt close() — bypass nativen Chromium-Race
      destroyPopupSafely(keyPrefix, w);
      return { success: true };
    });
    ipcMain.handle(`window:is-${keyPrefix}-open`, () => {
      const w = getWin();
      return w !== null && !w.isDestroyed();
    });
    ipcMain.handle(`window:${keyPrefix}-set-always-on-top`, (_e, alwaysOnTop: boolean) => {
      const w = getWin();
      if (w && !w.isDestroyed()) {
        w.setAlwaysOnTop(!!alwaysOnTop);
        return { success: true, alwaysOnTop: !!alwaysOnTop };
      }
      return { success: false, alwaysOnTop: false };
    });
    ipcMain.handle(`window:${keyPrefix}-is-always-on-top`, () => {
      const w = getWin();
      if (w && !w.isDestroyed()) return w.isAlwaysOnTop();
      return false;
    });
    ipcMain.on(`${keyPrefix}-sync:state`, (_e, payload: unknown) => {
      const w = getWin();
      if (w && !w.isDestroyed()) w.webContents.send(`${keyPrefix}-sync:state`, payload);
    });
    ipcMain.on(`${keyPrefix}-sync:action`, (_e, payload: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`${keyPrefix}-sync:action`, payload);
      }
    });
  }

  registerSimplePopupHandlers("keyboard-sampler", () => keyboardSamplerWindow, createKeyboardSamplerWindow);
  registerSimplePopupHandlers("chord-progression", () => chordProgressionWindow, createChordProgressionWindow);
  registerSimplePopupHandlers("pattern-library", () => patternLibraryWindow, createPatternLibraryWindow);

  // ── App-Info ─────────────────────────────────────────────────────────────────

  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("app:get-crash-log-path", () => getCrashLogPath() ?? "");

  // ── Crash-Log Bridge (DIAG-2) ────────────────────────────────────────────────
  // Renderer schickt window.onerror / unhandledrejection / explizite Events
  // hierher. Wir loggen sie in crash.log mit main-side timestamp, so dass
  // alle Crashes über alle Renderer in EINEM Log landen.
  ipcMain.on("renderer:crash", (event, payload: { source: string; message: string; stack?: string }) => {
    const winId = event.sender.id;
    logCrash(`renderer[winId=${winId}]:${payload.source}`, {
      message: payload.message,
      stack: payload.stack ?? "<no stack>",
    });
  });
  ipcMain.on("renderer:event", (event, payload: { label: string; payload?: Record<string, unknown> }) => {
    const winId = event.sender.id;
    logEvent(`renderer[winId=${winId}]:${payload.label}`, payload.payload);
  });
  ipcMain.handle("app:get-platform", () => process.platform);
  ipcMain.handle("app:get-path", (_event, name: string) => {
    const allowed = ["home", "documents", "downloads", "music", "desktop"];
    if (!allowed.includes(name)) return null;
    return app.getPath(name as Parameters<typeof app.getPath>[0]);
  });

  // ── Benachrichtigungen ───────────────────────────────────────────────────────

  ipcMain.handle(
    "notification:show",
    (_event, title: string, body: string) => {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show();
      }
    }
  );

  // ── MIDI-Datei-Import ─────────────────────────────────────────────────────────

  ipcMain.handle("midi:import-file", async (_event, filePath: string) => {
    // Sicherheitscheck: Nur .mid und .midi erlaubt
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".mid" && ext !== ".midi") {
      return { success: false as const, error: "Nur .mid/.midi Dateien erlaubt" };
    }
    const resolvedPath = path.resolve(filePath);
    try {
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
    } catch {
      return { success: false as const, error: "Datei nicht lesbar" };
    }
    try {
      const buffer = await fs.promises.readFile(resolvedPath);
      const data = Uint8Array.from(buffer);
      return { success: true as const, data: Array.from(data), fileName: path.basename(resolvedPath) };
    } catch (err) {
      return { success: false as const, error: String(err) };
    }
  });

  ipcMain.handle("midi:open-dialog", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "MIDI-Datei importieren",
      filters: [{ name: "MIDI-Dateien", extensions: ["mid", "midi"] }],
      properties: ["openFile"],
    });
    return result;
  });

  // ── Kollaborations-Server ─────────────────────────────────────────────────────

  ipcMain.handle("collab:start", async () => {
    try {
      const port = await startCollabServer(0);
      return { success: true, port };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("collab:stop", async () => {
    try {
      await stopCollabServer();
      stopDiscoveryAnnounce();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle("collab:get-address", () => {
    return {
      ip: getLocalIp(),
      port: getCollabServerPort(),
      running: isCollabServerRunning(),
    };
  });

  ipcMain.handle("collab:announce-start", (_event, roomCode: string) => {
    const port = getCollabServerPort();
    if (port > 0) startDiscoveryAnnounce(roomCode, port);
    return { success: true };
  });

  ipcMain.handle("collab:announce-stop", () => {
    stopDiscoveryAnnounce();
    return { success: true };
  });

  ipcMain.handle("collab:discovery-start", () => {
    startDiscoveryListen();
    return { success: true };
  });

  ipcMain.handle("collab:discovery-stop", () => {
    stopDiscoveryListen();
    return { success: true };
  });

  ipcMain.handle("collab:get-discovered", () => {
    return getDiscoveredSessions();
  });

  // ── Auto-Updater (manueller Check aus dem Renderer) ──────────────────────────

  ipcMain.on("updater:check", () => {
    if (mainWindow) {
      checkForUpdatesManually(mainWindow);
    }
  });
}

// ─── Content Security Policy ─────────────────────────────────────────────────

/**
 * Installiert die CSP-Header auf der Default-Session. Wird einmal pro
 * App-Lifecycle aufgerufen (in app.whenReady).
 *
 * Die CSP-Definition steht in electron/csp.ts — Änderungen NICHT hier inline,
 * damit das Test-Modul (tests/electron/csp-header.test.ts) die Quelle prüfen
 * kann ohne Electron zu importieren.
 */
function installCspHeaders(): void {
  const cspHeader = buildCspForMode(isDev);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [cspHeader],
        "X-Content-Type-Options": ["nosniff"],
      },
    });
  });
  console.log(`[CSP] Headers installed (mode=${isDev ? "dev" : "prod"})`);
}

// ─── Globale Keyboard-Shortcuts ──────────────────────────────────────────────

function registerGlobalShortcuts(): void {
  // Globale Shortcuts (funktionieren auch wenn App nicht fokussiert)
  // Nur Media-Keys als globale Shortcuts registrieren
  globalShortcut.register("MediaPlayPause", () => {
    mainWindow?.webContents.send("shortcut:transport-toggle");
  });

  globalShortcut.register("MediaStop", () => {
    mainWindow?.webContents.send("shortcut:transport-stop");
  });
}

// ─── App-Lifecycle ───────────────────────────────────────────────────────────

// MIG-1A: Globale Crash-Handler ZUERST registrieren, damit auch Fehler im
// initStore / whenReady-Path geloggt werden.
installMainProcessCrashHandlers();

app.whenReady().then(() => {
  // AppStore initialisieren (muss vor buildMenu() erfolgen)
  appStore = initStore(app.getPath("userData"));

  // Crash-Log direkt nach AppStore init aufsetzen
  initCrashLog(app);
  logEvent("app:whenReady");
  startHeartbeat();

  // DIAG-4: child-process-gone fängt non-renderer child crashes (GPU, utility,
  // network). Renderer crashes haben separate webContents.on('render-process-gone').
  app.on("child-process-gone", (_event, details) => {
    logCrash("app:child-process-gone", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name,
    });
  });

  // Notfall-Flag: Synthstudio.exe --reset-window löscht gespeicherte Fenster-Bounds.
  // Hilft User die nach Display-Wechsel das Fenster nicht mehr sehen können.
  if (process.argv.includes("--reset-window")) {
    appStore.saveWindowBounds({ x: undefined as unknown as number, y: undefined as unknown as number, width: 1440, height: 900, isMaximized: false });
    console.log("[Window] --reset-window: window bounds cleared.");
  }

  // CSP-Header installieren bevor das erste Fenster geladen wird (v1.18 hardening).
  // Muss vor createWindow() laufen, damit auch der erste Renderer-Request
  // den Header bekommt.
  installCspHeaders();

  // Basis-IPC-Handler registrieren (kein mainWindow erforderlich)
  registerIpcHandlers();
  registerWaveformHandlers();
  registerExportHandlers();
  registerWindowHandlers(windowManager);

  // Menü aufbauen (nutzt appStore für zuletzt geöffnete Projekte)
  buildMenu();

  // Fenster erstellen – danach ist mainWindow gesetzt
  createWindow();

  // Store-IPC-Handler registrieren (nach createWindow, damit mainWindow gesetzt ist)
  registerStoreHandlers(ipcMain, mainWindow);

  createTray();
  registerGlobalShortcuts();

  // Drag & Drop für das Hauptfenster einrichten
  if (mainWindow) {
    setupDragDrop(mainWindow);
    registerZipImportHandlers(mainWindow);
    // Auto-Updater (nur in Produktion aktiv)
    setupAutoUpdater(mainWindow, () => { userInitiatedQuit = true; });

    // Window-Layout-Persistenz: nach dem ersten Render des Hauptfensters die
    // beim letzten Beenden offenen Popup-Fenster wieder öffnen.
    // Kleine Verzögerung (800ms) damit der Main-Renderer seine useEffects
    // gemountet hat (Action-Listener) bevor die Popups request-state schicken.
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => reopenPersistedPopups(), 800);
    });
  }

  // macOS: Fenster neu erstellen wenn Dock-Icon geklickt
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;

  // BUG-018: Refuse to quit if mainWindow wasn't explicitly destroyed.
  // Defense against Electron edge case where closing a popup somehow
  // makes window-all-closed fire even though mainWindow should be alive.
  if (!mainWindowDestroyed) {
    console.warn(
      "[window-all-closed] mainWindow not destroyed but event fired — refusing to quit. " +
      "If mainWindow is genuinely gone, use the tray icon or restart.",
    );
    // Versuche mainWindow wieder zu zeigen falls es nur hidden ist
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }
  app.quit();
});

app.on("before-quit", (event) => {
  logEvent("app:before-quit", { userInitiatedQuit, mainWindowAlive: mainWindow !== null && !mainWindow.isDestroyed() });

  // BUG-018 v1.29.0 follow-up: nukleare Quit-Sperre.
  if (!userInitiatedQuit && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    logEvent("app:before-quit:BLOCKED");
    console.warn(
      "[before-quit] BLOCKED: nicht user-initiated und mainWindow lebt. " +
      "Quit wird verweigert — vermutlich Popup-Close-Cascade.",
    );
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  isAppQuitting = true;
});

app.on("quit", () => {
  logEvent("app:quit");
  stopHeartbeat();
  shutdownCrashLog();
});

app.on("will-quit", () => {
  if (app.isReady()) {
    globalShortcut.unregisterAll();
  }
});

// Sicherheit: Neue Fenster und Navigation verhindern
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (isDev && parsedUrl.origin === new URL(devServerUrl).origin) return;
    if (!isDev && navigationUrl.startsWith("file://")) return;
    event.preventDefault();
  });

  contents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });
});

// Single-Instance-Lock (verhindert mehrere App-Instanzen)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Single-instance: legitimer Quit-Pfad (zweite Instanz wird verworfen).
  userInitiatedQuit = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
