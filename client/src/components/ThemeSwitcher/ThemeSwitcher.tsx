import { useThemeStore, type ThemeId } from "../../store/useThemeStore";

// ─── Farbvorschau-Definitionen ────────────────────────────────────────────────

const THEME_PREVIEWS: Record<ThemeId, { primary: string; secondary: string; bg: string }> = {
  dark:   { primary: "#f59e0b", secondary: "#06b6d4", bg: "#1e1e2a" },
  neon:   { primary: "#00fff5", secondary: "#ff00ff", bg: "#0d1117" },
  analog: { primary: "#ff6b35", secondary: "#00f5d4", bg: "#2a2a3e" },
};

// ─── Komponente ───────────────────────────────────────────────────────────────

/**
 * ThemeSwitcher
 *
 * Kompaktes Button-Panel zur Theme-Auswahl.
 * Nutzt CSS Custom Properties (--ss-*) aus dem Token-System.
 * Kein Props nötig – liest und setzt Theme intern via useThemeStore.
 */
export function ThemeSwitcher() {
  const { currentTheme, themes, setTheme } = useThemeStore();

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
      }}
    >
      {themes.map((theme) => {
        const isActive = theme.id === currentTheme;
        const preview = THEME_PREVIEWS[theme.id];

        return (
          <button
            key={theme.id}
            type="button"
            onClick={() => setTheme(theme.id)}
            aria-pressed={isActive}
            aria-label={`${theme.name}: ${theme.description}`}
            title={theme.description}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 10px",
              background: isActive ? "var(--ss-bg-elevated)" : "transparent",
              border: isActive
                ? "1px solid var(--ss-accent-primary)"
                : "1px solid transparent",
              borderRadius: "5px",
              color: isActive ? "var(--ss-text-primary)" : "var(--ss-text-muted)",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "inherit",
              boxShadow: isActive ? "var(--ss-glow)" : "none",
              transition: "all 0.15s ease",
              whiteSpace: "nowrap",
            }}
          >
            {/* Emoji */}
            <span aria-hidden="true" style={{ fontSize: "14px" }}>
              {theme.emoji}
            </span>

            {/* Name */}
            <span>{theme.name}</span>

            {/* Farbvorschau-Kleckse */}
            <span
              aria-hidden="true"
              style={{ display: "flex", gap: "2px", marginLeft: "2px" }}
            >
              <ColorDot color={preview.primary} />
              <ColorDot color={preview.secondary} />
              <ColorDot color={preview.bg} bordered />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Hilfkomponente ───────────────────────────────────────────────────────────

interface ColorDotProps {
  color: string;
  bordered?: boolean;
}

function ColorDot({ color, bordered = false }: ColorDotProps) {
  return (
    <span
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: color,
        border: bordered ? "1px solid var(--ss-border)" : undefined,
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );
}
