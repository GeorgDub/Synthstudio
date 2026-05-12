import { useState, useCallback } from "react";
import { applyTheme, loadSavedTheme, type ThemeId } from "../Settings/ThemeSettings";

const THEME_PREVIEWS: Record<ThemeId, { primary: string; secondary: string; bg: string }> = {
  dark:         { primary: "#f59e0b", secondary: "#06b6d4", bg: "#1e1e2a" },
  neon:         { primary: "#00fff5", secondary: "#ff00ff", bg: "#0d1117" },
  analog:       { primary: "#ff6b35", secondary: "#00f5d4", bg: "#2a2a3e" },
  purple:       { primary: "#a855f7", secondary: "#7c3aed", bg: "#110e18" },
  warm:         { primary: "#f97316", secondary: "#fbbf24", bg: "#1a110a" },
  oled:         { primary: "#06b6d4", secondary: "#0891b2", bg: "#080808" },
  daylight:     { primary: "#2563eb", secondary: "#db2777", bg: "#ffffff" },
  paper:        { primary: "#d97706", secondary: "#059669", bg: "#fdfdf8" },
  deuteranopia: { primary: "#0072b2", secondary: "#56b4e9", bg: "#0a0a12" },
  protanopia:   { primary: "#0072b2", secondary: "#009e73", bg: "#f5f5f5" },
};

const THEME_NAMES: Record<ThemeId, string> = {
  dark: "DarkStudio", neon: "NeonCircuit", analog: "AnalogHardware",
  purple: "Nacht", warm: "Sonnenuntergang", oled: "OLED",
  daylight: "Daylight", paper: "Paper",
  deuteranopia: "Deuteranopia", protanopia: "Protanopia",
};

export function ThemeSwitcher() {
  const [current, setCurrent] = useState<ThemeId>(loadSavedTheme);

  const handleSelect = useCallback((id: ThemeId) => {
    applyTheme(id);
    localStorage.setItem("ss-theme", id);
    setCurrent(id);
  }, []);

  return (
    <div
      role="group"
      aria-label="Theme auswählen"
      style={{
        display: "flex",
        gap: "6px",
        padding: "6px",
        background: "var(--ss-bg-panel)",
        borderRadius: "8px",
        border: "1px solid var(--ss-border)",
        flexWrap: "wrap",
      }}
    >
      {(Object.keys(THEME_NAMES) as ThemeId[]).map((id) => {
        const isActive = id === current;
        const preview = THEME_PREVIEWS[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => handleSelect(id)}
            aria-pressed={isActive}
            title={THEME_NAMES[id]}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              background: isActive ? "var(--ss-bg-elevated)" : "transparent",
              border: isActive ? "1px solid var(--ss-accent-primary)" : "1px solid transparent",
              borderRadius: "5px",
              color: isActive ? "var(--ss-text-primary)" : "var(--ss-text-muted)",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "inherit",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ display: "flex", gap: "2px" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: preview.primary, display: "inline-block" }} />
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: preview.secondary, display: "inline-block" }} />
            </span>
            <span>{THEME_NAMES[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
