/**
 * Synthstudio – ThemeSettings.tsx (v1.11)
 *
 * Design-Theme-Auswahl für die Synthstudio-Oberfläche.
 * Setzt ein `data-theme`-Attribut auf dem <html>-Element und
 * persistiert die Auswahl in localStorage.
 *
 * Verfügbare Themes:
 *   dark   – DarkStudio (Standard, Bernstein + Cyan)
 *   neon   – NeonCircuit (Cyan + Magenta, technoide Atmosphäre)
 *   analog – AnalogHardware (Orange + Cyan, warm-analoger Charakter)
 *   purple – Nacht (Dunkles Lila, Studio-Feeling bei Nacht)
 *   warm   – Sonnenuntergang (Bernstein / Terracotta)
 *   oled   – OLED-Schwarz (Maximaler Kontrast, reines Schwarz)
 */

import React, { useCallback, useEffect, useState } from "react";

// ─── Theme-Definition ─────────────────────────────────────────────────────────

export type ThemeId = "dark" | "neon" | "analog" | "purple" | "warm" | "oled";

interface ThemeDef {
  id: ThemeId;
  name: string;
  description: string;
  /** Vorschau-Farben [hintergrund, akzent1, akzent2] */
  preview: [string, string, string];
}

const THEMES: ThemeDef[] = [
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
];

const STORAGE_KEY = "ss-theme";

// ─── Theme-Hilfsfunktionen ────────────────────────────────────────────────────

export function applyTheme(theme: ThemeId): void {
  if (theme === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function loadSavedTheme(): ThemeId {
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
  if (saved && THEMES.some(t => t.id === saved)) return saved;
  return "dark";
}

export function initTheme(): void {
  applyTheme(loadSavedTheme());
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function ThemeSettings({ isOpen, onClose }: Props) {
  const [current, setCurrent] = useState<ThemeId>(loadSavedTheme);

  // Theme anwenden + speichern
  const selectTheme = useCallback((id: ThemeId) => {
    setCurrent(id);
    applyTheme(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  // Keyboard-Handler: Escape schließt Modal
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
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal */}
      <div className="bg-[#0d0d0d] border border-slate-700 rounded-lg shadow-2xl w-[480px] max-w-[95vw]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-bold text-slate-200 tracking-wide">
            Design-Einstellungen
          </h2>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors text-xs"
          >
            ✕
          </button>
        </div>

        {/* Theme-Auswahl */}
        <div className="p-5">
          <p className="text-xs text-slate-500 mb-4">
            Wähle ein Design-Theme für die gesamte Oberfläche.
            Die Auswahl wird automatisch gespeichert.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {THEMES.map((theme) => {
              const isSelected = current === theme.id;
              return (
                <button
                  key={theme.id}
                  onClick={() => selectTheme(theme.id)}
                  className={[
                    "flex items-center gap-3 p-3 rounded border text-left transition-all duration-150",
                    isSelected
                      ? "border-cyan-600 bg-cyan-950/30"
                      : "border-slate-700 hover:border-slate-600 bg-slate-900/30 hover:bg-slate-800/30",
                  ].join(" ")}
                >
                  {/* Vorschau-Palette */}
                  <div className="flex gap-0.5 flex-shrink-0">
                    {theme.preview.map((color, i) => (
                      <div
                        key={i}
                        className="rounded-sm"
                        style={{
                          background: color,
                          width: i === 0 ? 20 : 10,
                          height: 28,
                        }}
                      />
                    ))}
                  </div>

                  {/* Text */}
                  <div className="min-w-0">
                    <div className={[
                      "text-xs font-medium",
                      isSelected ? "text-cyan-400" : "text-slate-300",
                    ].join(" ")}>
                      {theme.name}
                    </div>
                    <div className="text-[10px] text-slate-600 mt-0.5 truncate">
                      {theme.description}
                    </div>
                  </div>

                  {/* Aktiv-Indikator */}
                  {isSelected && (
                    <div className="ml-auto flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-cyan-500" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Info */}
          <p className="text-[10px] text-slate-700 mt-4">
            Die Akzentfarben der Sequencer-Schritte, Buttons und Tabs
            passen sich dem gewählten Theme an.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs rounded bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-300 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
