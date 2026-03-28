/**
 * Synthstudio – useThemeStore
 *
 * Globales Theme-System: DarkStudio (Standard), NeonCircuit, AnalogHardware.
 * Persistenz: localStorage (Browser) + optionale Electron-IPC-Bridge.
 * Pattern: Modul-Singleton + React useState/useCallback (analog zu den anderen Stores).
 *
 * Isomorph: Alle DOM/window-Zugriffe sind gegen Unavailability abgesichert.
 */
import { useState, useCallback, useEffect } from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export type ThemeId = "dark" | "neon" | "analog";

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  emoji: string;
}

export interface ThemeState {
  currentTheme: ThemeId;
  themes: Theme[];
}

export interface ThemeActions {
  setTheme: (id: ThemeId) => void;
}

// ─── Statische Theme-Definitionen ────────────────────────────────────────────

export const THEMES: Theme[] = [
  {
    id: "dark",
    name: "Dark Studio",
    description: "Klassisches dunkles Studio-Interface",
    emoji: "🎛️",
  },
  {
    id: "neon",
    name: "Neon Circuit",
    description: "Futuristisches Neon-Cyberpunk-Interface",
    emoji: "⚡",
  },
  {
    id: "analog",
    name: "Analog Hardware",
    description: "Vintage Analog-Hardware-Look",
    emoji: "🎚️",
  },
];

const STORAGE_KEY = "ss-theme";

// ─── Modul-Singleton (cross-component shared state) ──────────────────────────

/** Aktuell aktiver Theme-ID – globale Wahrheitsquelle zwischen Hook-Instanzen */
let _currentTheme: ThemeId = "dark";

/** React setState-Callbacks aller aktiven Hook-Instanzen */
const _listeners = new Set<(id: ThemeId) => void>();

// ─── Interne Hilfsfunktionen ─────────────────────────────────────────────────

function _isValidThemeId(value: unknown): value is ThemeId {
  return value === "dark" || value === "neon" || value === "analog";
}

function _readFromStorage(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (_isValidThemeId(stored)) return stored;
  } catch {
    // localStorage nicht verfügbar (Node.js / SSR)
  }
  return "dark";
}

function _applyToDOM(id: ThemeId): void {
  try {
    // Immer explizit setzen; CSS :root + [data-theme="dark"] decken beide Fälle ab
    document.documentElement.dataset.theme = id;
  } catch {
    // document nicht verfügbar (Node.js / SSR)
  }
}

function _persistToStorage(id: ThemeId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage nicht verfügbar
  }
  try {
    // Electron IPC – optionales Chaining, kein Fehler wenn nicht vorhanden
    (
      window as unknown as {
        electronAPI?: { setStoreValue?: (key: string, value: string) => void };
      }
    ).electronAPI?.setStoreValue?.("theme", id);
  } catch {
    // window nicht verfügbar
  }
}

// ─── Exportierte Logik-Funktionen (testbar ohne React) ───────────────────────

/**
 * Liest gespeichertes Theme und wendet es auf den DOM an.
 * Wird beim Hook-Mount aufgerufen; auch direkt testbar.
 */
export function initFromStorage(): ThemeId {
  const id = _readFromStorage();
  _currentTheme = id;
  _applyToDOM(id);
  return id;
}

/**
 * Wendet ein Theme an: DOM + localStorage + Electron-Store + Listener.
 * Entspricht der setTheme()-Aktion, aber ohne React-State-Overhead.
 */
export function applyTheme(id: ThemeId): void {
  _currentTheme = id;
  _applyToDOM(id);
  _persistToStorage(id);
  _listeners.forEach((listener) => listener(id));
}

/** Gibt den aktuell aktiven Theme-ID zurück (ohne React). */
export function getCurrentTheme(): ThemeId {
  return _currentTheme;
}

/**
 * Setzt den Modul-Zustand zurück.
 * Nur für Unit-Tests – nicht in Produktion aufrufen!
 */
export function __resetForTests(): void {
  _currentTheme = "dark";
  _listeners.clear();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export function useThemeStore(): ThemeState & ThemeActions {
  // Lazy-Init: Beim ersten Aufruf bereits den Singleton-Wert nutzen
  const [currentTheme, setCurrentThemeState] = useState<ThemeId>(
    () => _currentTheme
  );

  useEffect(() => {
    // Beim ersten Mount aus Storage initialisieren und DOM setzen
    const stored = initFromStorage();
    setCurrentThemeState(stored);

    // In globale Listener-Liste eintragen → Updates von anderen Instanzen empfangen
    _listeners.add(setCurrentThemeState);
    return () => {
      _listeners.delete(setCurrentThemeState);
    };
  }, []);

  const setTheme = useCallback((id: ThemeId): void => {
    applyTheme(id);
  }, []);

  return {
    currentTheme,
    themes: THEMES,
    setTheme,
  };
}
