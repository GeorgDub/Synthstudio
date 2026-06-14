/**
 * client/src/utils/themeApply.ts (TASK-248)
 *
 * Neutrales Theme-Modul: reine DOM/Token + Persistenz-Logik für die
 * eingebauten Base-Themes. Kein React-Import, keine Store-Abhängigkeit.
 *
 * Hintergrund: Bis v3.272 importierte `store/useThemeStore.ts` die
 * Funktion `applyTheme` aus `components/Settings/ThemeSettings.tsx`,
 * welche wiederum aus `useThemeStore.ts` importierte → Runtime-Value-
 * Cycle. Die Base-Apply-/Persistenz-Logik lebt jetzt hier, sodass
 * sowohl der Store als auch die ThemeSettings-Komponente aus diesem
 * neutralen Modul importieren können — ohne Zyklus.
 *
 * `applyCustomTheme`, `initTheme` und die orchestrierende
 * `applyTheme(themeId)` (die zusätzlich Custom-Themes deaktiviert)
 * bleiben bewusst im Store bzw. in ThemeSettings, weil sie Store-State
 * (`_state`/persist/notify) bzw. Custom-Theme-Logik anfassen.
 */

// ─── Theme-Definition ─────────────────────────────────────────────────────────

export type ThemeId =
  | "dark"
  | "neon"
  | "analog"
  | "purple"
  | "warm"
  | "oled"
  | "daylight"
  | "paper"
  | "deuteranopia"
  | "protanopia";

export interface ThemeDef {
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

/**
 * Wendet ein eingebautes Base-Theme an (setzt/entfernt `data-theme` am
 * <html>-Element) und broadcastet an offene Popout-Fenster.
 */
export function applyTheme(theme: ThemeId): void {
  if (theme === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  // MIG-3C: Browser-Mode cross-window DOM-Sync
  void import("@/utils/popoutThemeSync").then((m) => m.broadcastThemeToPopouts());
  // MIG-3E: Electron-Mode — main re-syncht alle offenen popout-BrowserWindows
  try {
    (window as Window & { electronAPI?: { notifyThemeChanged?: () => void } })
      .electronAPI?.notifyThemeChanged?.();
  } catch {
    /* not in Electron */
  }
}

/** Liest das zuletzt gespeicherte Base-Theme aus localStorage (validiert gegen THEMES). */
export function loadSavedTheme(): ThemeId {
  const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
  if (saved && THEMES.some((t) => t.id === saved)) return saved;
  return "dark";
}
