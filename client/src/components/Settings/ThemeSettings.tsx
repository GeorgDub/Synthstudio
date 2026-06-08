/**
 * Synthstudio – ThemeSettings.tsx (v1.12)
 *
 * Design-Theme-Auswahl für die Synthstudio-Oberfläche.
 * Setzt ein `data-theme`-Attribut auf dem <html>-Element und
 * persistiert die Auswahl in localStorage.
 *
 * NEU:
 * - Integration mit useThemeStore für benutzerdefinierte Themes.
 * - CustomThemeCreator zum Erstellen eigener Designs.
 */

import React, { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useThemeStore, applyCustomTheme, deleteCustomTheme, applyTheme as applyBaseThemeFromStore, addCustomTheme } from "@/store/useThemeStore";
import { CustomThemeCreator } from "./CustomThemeCreator";
import { useApiSettingsStore, setApiKey, setAiModel } from "@/store/useApiSettingsStore";
import { serializeTheme, parseTheme, defaultThemeFilename } from "@/utils/themeImportExport";

// ─── Theme-Definition ─────────────────────────────────────────────────────────

export type ThemeId = "dark" | "neon" | "analog" | "purple" | "warm" | "oled" | "daylight" | "paper" | "deuteranopia" | "protanopia";

interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  /** Vorschau-Farben [hintergrund, akzent1, akzent2] */
  preview: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  {
    id: "dark",
    name: "DarkStudio",
    description: "Standard – Bernstein + Cyan",
    preview: ["#121218", "#f59e0b", "#06b6d4"],
  },
  {
    id: "neon",
    name: "NeonCircuit",
    description: "Techno – Cyan + Magenta",
    preview: ["#0a0a0f", "#00fff5", "#ff00ff"],
  },
  {
    id: "analog",
    name: "AnalogHardware",
    description: "Warm – Orange + Cyan",
    preview: ["#1a1a2e", "#ff6b35", "#00f5d4"],
  },
  {
    id: "purple",
    name: "Nacht",
    description: "Studio-Feeling – Dunkles Lila",
    preview: ["#0a080f", "#a855f7", "#7c3aed"],
  },
  {
    id: "warm",
    name: "Sonnenuntergang",
    description: "Bernstein / Terracotta Akzent",
    preview: ["#0f0a08", "#f97316", "#fbbf24"],
  },
  {
    id: "oled",
    name: "OLED-Schwarz",
    description: "Reines Schwarz, maximaler Kontrast",
    preview: ["#000000", "#06b6d4", "#0284c7"],
  },
  {
    id: "daylight",
    name: "Daylight",
    description: "Klares, neutrales Hell-Theme",
    preview: ["#f8fafc", "#2563eb", "#db2777"],
  },
  {
    id: "paper",
    name: "Paper",
    description: "Warmes, cremefarbenes Hell-Theme",
    preview: ["#fdfdf8", "#d97706", "#059669"],
  },
  {
    id: "deuteranopia",
    name: "Deuteranopia",
    description: "Farbenblind-gerecht: Okabe-Ito Palette (dunkel)",
    preview: ["#0a0a12", "#0072b2", "#56b4e9"],
  },
  {
    id: "protanopia",
    name: "Protanopia",
    description: "Farbenblind-gerecht: Hoher Kontrast (hell)",
    preview: ["#f5f5f5", "#0072b2", "#009e73"],
  },
];

const STORAGE_KEY = "ss-theme";

// ─── Theme-Hilfsfunktionen ────────────────────────────────────────────────────

export function applyTheme(theme: ThemeId): void {
  if (theme === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  // MIG-3C: Browser-Mode cross-window DOM-Sync
  void import("@/utils/popoutThemeSync").then(m => m.broadcastThemeToPopouts());
  // MIG-3E: Electron-Mode — main re-syncht alle offenen popout-BrowserWindows
  try {
    (window as Window & { electronAPI?: { notifyThemeChanged?: () => void } })
      .electronAPI?.notifyThemeChanged?.();
  } catch { /* not in Electron */ }
}

export function loadSavedTheme(): ThemeId {
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
  if (saved && THEMES.some(t => t.id === saved)) return saved;
  return "dark";
}

export function initTheme(): void {
    const customThemeStore = JSON.parse(localStorage.getItem("synthstudio:custom-themes:v1") || "{}");
    if (customThemeStore.activeCustomTheme) {
        applyCustomTheme(customThemeStore.activeCustomTheme);
    } else {
        applyTheme(loadSavedTheme());
    }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ThemeSettings({ isOpen, onClose }: Props) {
  const { customThemes, activeCustomTheme } = useThemeStore();
  const [currentBaseTheme, setCurrentBaseTheme] = useState<ThemeId>(loadSavedTheme);
  const [showCreator, setShowCreator] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"design" | "api">("design");
  const apiSettings = useApiSettingsStore();
  const [apiKeyInput, setApiKeyInput] = useState(apiSettings.anthropicApiKey);

  const selectBaseTheme = useCallback((id: ThemeId) => {
    setCurrentBaseTheme(id);
    applyBaseThemeFromStore(id); // Use the store's apply function
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const selectCustomTheme = useCallback((id: string) => {
    setCurrentBaseTheme('dark'); // Reset base theme selection
    applyCustomTheme(id);
  }, []);

  // v3.140: Theme-Export — download als .synth-theme.json
  const exportTheme = useCallback((themeId: string) => {
    const theme = customThemes.find((t) => t.id === themeId);
    if (!theme) return;
    try {
      const json = serializeTheme(theme);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultThemeFilename(theme.name);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.warn("[Theme] Export failed:", err);
    }
  }, [customThemes]);

  // v3.140: Theme-Import — file picker → parseTheme → addCustomTheme
  const importTheme = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseTheme(text);
        if (!parsed) {
          window.alert("Theme-Datei ungültig oder beschädigt. Datei muss ein gültiger Synthstudio-Theme-Export sein.");
          return;
        }
        const newId = addCustomTheme(parsed);
        applyCustomTheme(newId);
      } catch (err) {
        console.warn("[Theme] Import failed:", err);
        window.alert("Theme konnte nicht importiert werden.");
      }
    };
    input.click();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg-panel border border-border-color rounded-lg shadow-2xl w-[520px] max-w-[95vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-text-primary tracking-wide">Einstellungen</h2>
            <div className="flex gap-1">
              {(["design", "api"] as const).map(t => (
                <button key={t} onClick={() => setActiveSettingsTab(t)}
                  className={`px-3 py-0.5 text-xs rounded transition-colors ${activeSettingsTab === t ? "bg-accent-primary/20 text-accent-primary" : "text-text-dim hover:text-text-primary"}`}>
                  {t === "design" ? "Design" : "KI & API"}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors flex items-center justify-center"
            aria-label="Close"
            title="Schließen (ESC)"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">

        {/* KI & API Tab */}
        {activeSettingsTab === "api" && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-bold text-text-primary mb-1">AI Beat Co-Pilot</h3>
              <p className="text-xs text-text-dim mb-3">
                Verbinde den Pattern Generator mit Claude AI für intelligente, stilgerechte Drum-Pattern. Dein API-Key wird nur lokal gespeichert.
              </p>
              <label className="text-xs text-text-muted block mb-1">Anthropic API Key</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-…"
                  className="flex-1 bg-bg-elevated text-text-primary text-xs px-3 py-2 rounded border border-border-color placeholder:text-text-dim focus:border-accent-primary outline-none"
                />
                <button
                  onClick={() => { setApiKey(apiKeyInput); }}
                  className="px-3 py-1.5 text-xs rounded bg-accent-primary text-white hover:opacity-80 transition-opacity"
                >Speichern</button>
              </div>
              {apiSettings.anthropicApiKey && (
                <p className="text-[10px] text-accent-success mt-1.5">✓ API Key gesetzt – KI-Generierung aktiv</p>
              )}
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1">Claude Modell</label>
              <select
                value={apiSettings.aiModel}
                onChange={e => setAiModel(e.target.value)}
                className="w-full bg-bg-elevated text-text-primary text-xs px-3 py-2 rounded border border-border-color"
              >
                <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (schnell, günstig)</option>
                <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (kreativ, ausgewogen)</option>
                <option value="claude-opus-4-8">Claude Opus 4.8 (maximal kreativ)</option>
              </select>
              <p className="text-[10px] text-text-dim mt-1">Haiku empfohlen für schnelle Pattern-Generierung.</p>
            </div>
            <div className="border-t border-border-color pt-3 text-[10px] text-text-dim">
              API Key kostenlos testen: <span className="text-accent-secondary">console.anthropic.com</span>.
              Ohne Key wird prozedurale Generierung verwendet.
            </div>
          </div>
        )}

        {/* Design Tab */}
        {activeSettingsTab === "design" && (<>
          <p className="text-xs text-text-dim mb-4">
            Wähle ein Design-Theme oder erstelle dein eigenes.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {THEMES.map((theme) => {
              const isSelected = currentBaseTheme === theme.id && !activeCustomTheme;
              return (
                <button key={theme.id} onClick={() => selectBaseTheme(theme.id)} className={`flex items-center gap-3 p-3 rounded border text-left transition-all duration-150 ${isSelected ? "border-accent-primary bg-accent-primary/10" : "border-border-color hover:border-border-color bg-bg-panel/30 hover:bg-bg-elevated/30"}`}>
                  <div className="flex gap-0.5 flex-shrink-0">
                    {theme.preview.map((color, i) => <div key={i} className="rounded-sm" style={{ background: color, width: i === 0 ? 20 : 10, height: 28 }} />)}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xs font-medium ${isSelected ? "text-accent-secondary" : "text-text-primary"}`}>{theme.name}</div>
                    <div className="text-[10px] text-text-dim mt-0.5 truncate">{theme.description}</div>
                  </div>
                  {isSelected && <div className="ml-auto flex-shrink-0"><div className="w-2 h-2 rounded-full bg-accent-primary" /></div>}
                </button>
              );
            })}
          </div>

          {customThemes.length > 0 && <div className="mt-6 border-t border-border-color pt-6">
            <h3 className="text-sm font-bold text-text-primary mb-4">Eigene Designs</h3>
            <div className="grid grid-cols-2 gap-3">
                {customThemes.map((theme) => {
                    const isSelected = activeCustomTheme === theme.id;
                    return (
                        <div key={theme.id} className={`flex items-center gap-3 p-3 rounded border text-left transition-all duration-150 ${isSelected ? "border-accent-success bg-accent-success/10" : "border-border-color hover:border-border-color bg-bg-panel/30 hover:bg-bg-elevated/30"}`}>
                            <button onClick={() => selectCustomTheme(theme.id)} className="flex-1 flex items-center gap-3">
                                <div className="flex gap-0.5 flex-shrink-0">
                                    <div className="rounded-sm" style={{ background: theme.colors['--ss-bg-base'], width: 20, height: 28 }} />
                                    <div className="rounded-sm" style={{ background: theme.colors['--ss-accent-primary'], width: 10, height: 28 }} />
                                </div>
                                <div className="min-w-0">
                                    <div className={`text-xs font-medium ${isSelected ? "text-accent-success" : "text-text-primary"}`}>{theme.name}</div>
                                </div>
                                {isSelected && <div className="ml-auto flex-shrink-0"><div className="w-2 h-2 rounded-full bg-accent-success" /></div>}
                            </button>
                            <button
                              onClick={() => exportTheme(theme.id)}
                              className="text-text-dim hover:text-accent-primary text-xs p-1"
                              title="Theme exportieren (.json)"
                              data-testid={`theme-export-${theme.id}`}
                            >↓</button>
                            <button onClick={() => deleteCustomTheme(theme.id)} className="text-text-dim hover:text-accent-danger text-xs p-1" title="Theme löschen">✕</button>
                        </div>
                    );
                })}
            </div>
          </div>}

          {showCreator ? (
            <CustomThemeCreator onClose={() => setShowCreator(false)} />
          ) : (
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setShowCreator(true)}
                className="flex-1 text-center text-xs text-text-dim hover:text-text-primary py-2 rounded border border-dashed border-border-color hover:border-border-color"
              >
                + Eigenes Design erstellen
              </button>
              <button
                onClick={importTheme}
                className="px-3 text-xs text-text-dim hover:text-accent-primary py-2 rounded border border-dashed border-border-color hover:border-accent-primary transition-colors"
                title="Theme aus .json-Datei importieren"
                data-testid="theme-import-btn"
              >
                ↑ Import
              </button>
            </div>
          )}
        </>)}
        </div>

        <div className="px-5 py-3 border-t border-border-color flex justify-end mt-auto">
          <button onClick={onClose} className="px-4 py-1.5 text-xs rounded bg-bg-elevated text-text-muted hover:text-text-primary transition-colors">
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
