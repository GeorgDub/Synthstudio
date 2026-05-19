/**
 * Synthstudio – themeImportExport.ts (v3.140.0)
 *
 * Pure-Helpers für Custom-Theme JSON-Round-Trip (Export/Import zwischen
 * Geräten + Backup vor Wipe). Validiert Schema beim Import — verhindert
 * dass corruptes oder fremdes JSON in den ThemeStore eingefügt wird.
 *
 * Public API:
 *  - serializeTheme(theme) → string (JSON mit Magic-Header + schema-version)
 *  - parseTheme(json) → CustomTheme | null (null bei invalid)
 *  - THEME_EXPORT_SCHEMA_VERSION = 1
 *  - THEME_EXPORT_MAGIC = "synthstudio.theme/v1"
 *
 * Pure & Node-testbar.
 *
 * Tests: tests/features/theme-import-export.test.ts
 */

import type { CustomTheme } from "@/store/useThemeStore";

// ─── Constants ───────────────────────────────────────────────────────────────

export const THEME_EXPORT_SCHEMA_VERSION = 1;
export const THEME_EXPORT_MAGIC = "synthstudio.theme/v1";

/** Pflicht-Color-Keys. accent-tertiary + accent-warning sind optional. */
const REQUIRED_COLOR_KEYS = [
  "--ss-bg-base",
  "--ss-bg-panel",
  "--ss-bg-elevated",
  "--ss-text-primary",
  "--ss-text-muted",
  "--ss-text-dim",
  "--ss-border",
  "--ss-border-subtle",
  "--ss-accent-primary",
  "--ss-accent-secondary",
  "--ss-accent-success",
  "--ss-accent-danger",
] as const;

const OPTIONAL_COLOR_KEYS = ["--ss-accent-tertiary", "--ss-accent-warning"] as const;

const VALID_HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const VALID_CSS_FUNC_RE = /^(rgb|rgba|hsl|hsla|oklch|color|var)\(.+\)$/i;

// ─── Exported envelope shape ─────────────────────────────────────────────────

export interface ThemeExportEnvelope {
  magic: typeof THEME_EXPORT_MAGIC;
  schemaVersion: number;
  exportedAt: string;
  theme: Omit<CustomTheme, "id">;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Serialisiert ein CustomTheme zu einer pretty-printed JSON-Datei (envelope
 * mit magic + schemaVersion + exportedAt + theme).  Die `id` wird NICHT
 * exportiert — der Import generiert eine neue, damit Importe nie existing
 * Themes überschreiben (User entscheidet via Name-Konflikt-UI).
 */
export function serializeTheme(theme: CustomTheme): string {
  const { id: _id, ...rest } = theme;
  void _id;
  const envelope: ThemeExportEnvelope = {
    magic: THEME_EXPORT_MAGIC,
    schemaVersion: THEME_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    theme: rest,
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Parst und validiert einen JSON-String als Theme-Export. Liefert
 * `Omit<CustomTheme, "id">` bei Erfolg (Caller fügt frische ID hinzu) oder
 * `null` bei jedem Validation-Fehler (corruptes JSON, falsches magic,
 * fehlende Required-Keys, ungültige Color-Strings).
 *
 * Defensive: throw NIE, schluckt alle Errors und liefert null.
 */
export function parseTheme(json: string): Omit<CustomTheme, "id"> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const env = parsed as Partial<ThemeExportEnvelope>;
  if (env.magic !== THEME_EXPORT_MAGIC) return null;
  if (typeof env.schemaVersion !== "number" || env.schemaVersion < 1) return null;
  if (!env.theme || typeof env.theme !== "object") return null;

  const t = env.theme as Partial<CustomTheme>;
  if (typeof t.name !== "string" || t.name.trim().length === 0) return null;
  if (!t.colors || typeof t.colors !== "object") return null;

  // Required color keys
  const colors = t.colors as Record<string, unknown>;
  for (const key of REQUIRED_COLOR_KEYS) {
    const v = colors[key];
    if (!isValidCssColor(v)) return null;
  }
  // Optional color keys: wenn vorhanden, valid sein.
  for (const key of OPTIONAL_COLOR_KEYS) {
    const v = colors[key];
    if (v !== undefined && !isValidCssColor(v)) return null;
  }

  // Build sanitized colors (nur known keys, in fester Reihenfolge).
  const sanitizedColors: Record<string, string> = {};
  for (const key of REQUIRED_COLOR_KEYS) {
    sanitizedColors[key] = colors[key] as string;
  }
  for (const key of OPTIONAL_COLOR_KEYS) {
    if (colors[key] !== undefined) sanitizedColors[key] = colors[key] as string;
  }

  const result: Omit<CustomTheme, "id"> = {
    name: t.name.trim(),
    colors: sanitizedColors as CustomTheme["colors"],
  };

  // Extras: nur known fields, mit Type-Guards.
  if (t.extras && typeof t.extras === "object") {
    const ex = t.extras as Record<string, unknown>;
    const cleanExtras: NonNullable<CustomTheme["extras"]> = {};
    if (typeof ex.fontSize === "number" && ex.fontSize >= 10 && ex.fontSize <= 18) {
      cleanExtras.fontSize = ex.fontSize;
    }
    if (typeof ex.borderRadius === "number" && ex.borderRadius >= 0 && ex.borderRadius <= 16) {
      cleanExtras.borderRadius = ex.borderRadius;
    }
    if (typeof ex.glassEffect === "number" && ex.glassEffect >= 0 && ex.glassEffect <= 1) {
      cleanExtras.glassEffect = ex.glassEffect;
    }
    if (typeof ex.glowIntensity === "number" && ex.glowIntensity >= 0 && ex.glowIntensity <= 1) {
      cleanExtras.glowIntensity = ex.glowIntensity;
    }
    if (typeof ex.backgroundImage === "string" && ex.backgroundImage.length > 0 && ex.backgroundImage.length < 8192) {
      // Sicherheits-Filter: nur https/data-URL, kein javascript:
      const trimmed = ex.backgroundImage.trim();
      if (/^(https?:|data:image\/)/i.test(trimmed)) {
        cleanExtras.backgroundImage = trimmed;
      }
    }
    if (typeof ex.customCss === "string" && ex.customCss.length < 16384) {
      // Sicherheits-Filter: keine <script>, keine javascript: URLs.
      const lower = ex.customCss.toLowerCase();
      if (!lower.includes("<script") && !lower.includes("javascript:") && !lower.includes("expression(")) {
        cleanExtras.customCss = ex.customCss;
      }
    }
    if (Object.keys(cleanExtras).length > 0) {
      result.extras = cleanExtras;
    }
  }

  return result;
}

/**
 * Default Filename-Vorschlag für Export-Download.  Sanitized, ohne Pfad-Trenner.
 */
export function defaultThemeFilename(themeName: string): string {
  const safe = themeName.trim().replace(/[^a-z0-9-_]+/gi, "-").slice(0, 64);
  const base = safe.length > 0 ? safe : "theme";
  return `${base}.synth-theme.json`;
}

// ─── Internal ────────────────────────────────────────────────────────────────

function isValidCssColor(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length === 0 || s.length > 256) return false;
  if (VALID_HEX_RE.test(s)) return true;
  if (VALID_CSS_FUNC_RE.test(s)) return true;
  // Named colors (red, blue, transparent) — wir whitelisten nicht, weil
  // viele tausend valid sind. Best-effort: reine [a-z]+-Strings 3..20 Zeichen.
  if (/^[a-z]{3,20}$/i.test(s)) return true;
  return false;
}
