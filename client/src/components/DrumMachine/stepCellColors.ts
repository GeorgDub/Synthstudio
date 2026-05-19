/**
 * Synthstudio – stepCellColors.ts (v3.125.0)
 *
 * Pure helpers für Color-Coded Step-Grid in DrumMachine.tsx.
 * Konsumiert v3.73-Channel-Color (PartData.color → ChannelStrip → step-cells).
 *
 * Public API:
 *  - getStepCellColor(channelColor, isActive, isHover) → CSS-Color-String
 *  - getStepCellBgStyle(channelColor, isActive, isHover) → React.CSSProperties
 *  - parseHexColor(hex) → {r,g,b} | undefined
 *  - withAlpha(hex, alpha) → "rgba(r,g,b,a)" (alpha-clamped, invalid hex → fallback)
 *
 * Verhalten:
 *  - Active-Cell:  channelColor mit voller Opacity
 *  - Inactive-Cell: channelColor mit 5% Opacity (subtle hint)
 *  - Hover-Active: brighter variant (lighten ~12%)
 *  - Fallback:    wenn channelColor undefined/invalid → CSS-Var --ss-accent-primary
 *
 * Diese Helpers sind DOM-frei und Node-testbar.
 */

/**
 * Fallback-Color für Cells ohne explizite Channel-Color.
 * Verwendet die CSS-Variable damit das Token-Theming greift.
 */
export const STEP_CELL_FALLBACK_COLOR = "var(--ss-accent-primary)";

/** Opacity-Konstanten für die drei States. */
export const STEP_CELL_OPACITY_ACTIVE = 1;
export const STEP_CELL_OPACITY_INACTIVE = 0.05;
export const STEP_CELL_OPACITY_HOVER_ACTIVE = 1;
export const STEP_CELL_OPACITY_HOVER_INACTIVE = 0.12;

/** Lightening-Faktor für Hover-Brightness (0..1). */
export const STEP_CELL_HOVER_LIGHTEN = 0.12;

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Parse "#RGB" or "#RRGGBB" → {r,g,b} (0..255). Invalid → undefined.
 * NICHT case-sensitive, trimt KEIN Whitespace.
 */
export function parseHexColor(
  hex: unknown,
): { r: number; g: number; b: number } | undefined {
  if (typeof hex !== "string") return undefined;
  if (!HEX_RE.test(hex)) return undefined;
  const v = hex.slice(1);
  if (v.length === 3) {
    const r = parseInt(v[0] + v[0], 16);
    const g = parseInt(v[1] + v[1], 16);
    const b = parseInt(v[2] + v[2], 16);
    return { r, g, b };
  }
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return { r, g, b };
}

/**
 * Liefert eine `rgba(r,g,b,a)`-Form für die gegebene Hex-Color.
 * Bei invalider Color wird `STEP_CELL_FALLBACK_COLOR` zurückgegeben
 * (CSS-Variable — Browser interpretiert sie).
 * Alpha wird auf [0,1] geclampt.
 */
export function withAlpha(hex: string | undefined | null, alpha: number): string {
  const safeAlpha = clamp01(alpha);
  const parsed = parseHexColor(hex);
  if (!parsed) {
    // Fallback: nutzt CSS-Variable. Alpha kann nicht direkt eingebaut werden
    // — wir geben die var() ohne Alpha zurück. Caller kann opacity-Klasse
    // (z.B. "/5") setzen falls nötig.
    return STEP_CELL_FALLBACK_COLOR;
  }
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${safeAlpha})`;
}

/**
 * Lightening: lerpt jeden Channel Richtung 255 (white) um `amount` (0..1).
 * amount=0 → unverändert. amount=1 → komplett weiß.
 * Invalid hex → undefined.
 */
export function lightenHex(hex: string | undefined | null, amount: number): string | undefined {
  const a = clamp01(amount);
  const parsed = parseHexColor(hex);
  if (!parsed) return undefined;
  const r = Math.round(parsed.r + (255 - parsed.r) * a);
  const g = Math.round(parsed.g + (255 - parsed.g) * a);
  const b = Math.round(parsed.b + (255 - parsed.b) * a);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Liefert die finale Background-Color (CSS-String) für eine Step-Cell.
 *
 * Logik:
 *  - Aktive Cell + Hover  → lightened(channelColor)
 *  - Aktive Cell          → channelColor (full opacity)
 *  - Inaktive Cell + Hover → channelColor mit Hover-Opacity (12%)
 *  - Inaktive Cell        → channelColor mit Inactive-Opacity (5%)
 *  - channelColor fehlt   → STEP_CELL_FALLBACK_COLOR (CSS-Var)
 */
export function getStepCellColor(
  channelColor: string | undefined | null,
  isActive: boolean,
  isHover: boolean,
): string {
  const parsed = parseHexColor(channelColor);
  if (!parsed) {
    // Fallback: --ss-accent-primary, ohne Opacity-Modulation
    // (CSS-Variable kann nicht direkt mit rgba() kombiniert werden).
    return STEP_CELL_FALLBACK_COLOR;
  }

  if (isActive) {
    if (isHover) {
      const lightened = lightenHex(channelColor, STEP_CELL_HOVER_LIGHTEN);
      // lightened ist definiert weil parsed bereits valide ist
      return lightened ?? `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`;
    }
    return `rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`;
  }

  // Inaktiv
  const opacity = isHover ? STEP_CELL_OPACITY_HOVER_INACTIVE : STEP_CELL_OPACITY_INACTIVE;
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${opacity})`;
}

/**
 * Convenience: gibt ein React-CSS-Style-Object mit backgroundColor zurück.
 * Verwendet `getStepCellColor` intern.
 */
export function getStepCellBgStyle(
  channelColor: string | undefined | null,
  isActive: boolean,
  isHover: boolean,
): { backgroundColor: string } {
  return { backgroundColor: getStepCellColor(channelColor, isActive, isHover) };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
