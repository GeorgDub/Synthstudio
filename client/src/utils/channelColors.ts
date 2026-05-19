/**
 * Synthstudio – channelColors.ts (v3.73.0)
 *
 * Pure-Modul für das Channel-Strip Color-Coding (Mixer + DrumMachine).
 * Realer DAW-Standard (Ableton/Logic/Pro Tools): User-defined Colors zur
 * visuellen Gruppierung von Channels — Drums rot, Bass blau, Lead gelb etc.
 *
 * Public API:
 * - DEFAULT_CHANNEL_COLOR_PALETTE — 8 OLED-freundliche Hex-Farben
 * - getDefaultChannelColorForIndex(idx) — zyklisch nach 8
 * - isValidChannelColor(value) — Hex-Validator
 * - normalizeChannelColor(value) — Lowercase + Validation, sonst undefined
 * - resolveChannelColor(explicit, index) — explicit > palette[index]
 *
 * Format: Hex-RGB-Strings ("#RRGGBB" oder "#RGB"). Custom-Hex erlaubt damit
 * User auch außerhalb der Palette wählen kann.
 */

/**
 * 8 Default-Farben (HSL-basiert, OLED-freundlich). Reihenfolge:
 * Drum-Red, Bass-Blue, Lead-Yellow, FX-Purple, Pad-Green, Vox-Pink,
 * Perc-Orange, Synth-Cyan.
 *
 * Werte sind moderat-gesättigt (S ~70%) und mittel-hell (L ~55%) damit sie
 * auf dunklem UND hellem Theme lesbar bleiben.
 */
export const DEFAULT_CHANNEL_COLOR_PALETTE: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly hex: string;
}> = [
  { id: "drum-red",     name: "Drum Red",     hex: "#ef4444" }, // hsl(0,  79%, 60%)
  { id: "bass-blue",    name: "Bass Blue",    hex: "#3b82f6" }, // hsl(217,91%, 60%)
  { id: "lead-yellow",  name: "Lead Yellow",  hex: "#eab308" }, // hsl(46, 84%, 47%)
  { id: "fx-purple",    name: "FX Purple",    hex: "#a855f7" }, // hsl(271,91%, 65%)
  { id: "pad-green",    name: "Pad Green",    hex: "#22c55e" }, // hsl(142,71%, 45%)
  { id: "vox-pink",     name: "Vox Pink",     hex: "#ec4899" }, // hsl(330,81%, 60%)
  { id: "perc-orange",  name: "Perc Orange",  hex: "#f97316" }, // hsl(25, 95%, 53%)
  { id: "synth-cyan",   name: "Synth Cyan",   hex: "#06b6d4" }, // hsl(189,94%, 43%)
];

/** Wie viele Default-Farben? */
export const CHANNEL_COLOR_PALETTE_SIZE = DEFAULT_CHANNEL_COLOR_PALETTE.length;

/** Hex-Match: #RGB oder #RRGGBB (case-insensitive). */
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * True wenn `value` ein valider Hex-Color-String ist (#RGB oder #RRGGBB).
 * Non-Strings und leere Strings → false. Whitespace wird NICHT getrimmt
 * (Caller-Verantwortung).
 */
export function isValidChannelColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  return HEX_RE.test(value);
}

/**
 * Normalisiert eine Farbe auf den kanonischen Lowercase-Hex.
 * Invalide Werte → undefined (signalisiert "keine Color gesetzt, fällt auf
 * Palette-Default").
 */
export function normalizeChannelColor(value: unknown): string | undefined {
  if (!isValidChannelColor(value)) return undefined;
  return value.toLowerCase();
}

/**
 * Liefert die Default-Farbe für einen 0-basierten Index. Zyklisch nach 8
 * (idx 8 → palette[0], idx 9 → palette[1], …). Negative Indizes oder
 * non-finite werden auf 0 geclampt.
 */
export function getDefaultChannelColorForIndex(index: number): string {
  if (!Number.isFinite(index) || index < 0) {
    return DEFAULT_CHANNEL_COLOR_PALETTE[0].hex;
  }
  const i = Math.floor(index) % CHANNEL_COLOR_PALETTE_SIZE;
  return DEFAULT_CHANNEL_COLOR_PALETTE[i].hex;
}

/**
 * Auflöse-Logik: explizit gesetzte Farbe > zyklischer Palette-Default.
 * Liefert IMMER einen validen Hex-String — Caller können sich darauf
 * verlassen dass das Resultat in CSS einsetzbar ist.
 */
export function resolveChannelColor(explicit: string | undefined | null, index: number): string {
  const norm = normalizeChannelColor(explicit);
  if (norm !== undefined) return norm;
  return getDefaultChannelColorForIndex(index);
}

/**
 * True wenn die Farbe mit dem Palette-Default für diesen Index übereinstimmt
 * (Lowercase-Vergleich). Hilft der UI, "auto"-Status anzuzeigen.
 */
export function isPaletteDefaultForIndex(color: string | undefined | null, index: number): boolean {
  if (color === undefined || color === null) return true;
  const norm = normalizeChannelColor(color);
  if (norm === undefined) return true;
  return norm === getDefaultChannelColorForIndex(index).toLowerCase();
}
