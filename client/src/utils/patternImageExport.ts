/**
 * client/src/utils/patternImageExport.ts (v3.66.0)
 *
 * Rendert ein Pattern als PNG- oder SVG-Bild für Documentation/Sharing/Social-Media.
 *
 * Pure rendering helpers — keine direkten DOM/React-Imports, kein toast, kein
 * AudioEngine-Call. Canvas wird vom Caller (oder einem Test-Mock) geliefert via
 * dem optionalen `createCanvas`-Hook, damit die Funktion im Browser-DOM, im
 * Test-Env (Mock) und potenziell in Electron-Main (node-canvas) funktioniert.
 *
 * Layout-Schema:
 *   ┌──── Title-Bar (titleBarHeight)
 *   │  "<pattern.name>"     bpm · stepCount steps
 *   ├──── Grid
 *   │  ┌──── Part-Label-Spalte (partLabelWidth)
 *   │  │  Snare   ▏ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢
 *   │  │  Kick    ▏ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢
 *   │  └────────────────────────────────────────────────
 *   └────
 *
 * Aktive Steps werden gefüllt; Velocity beeinflusst Alpha (0.4..1.0).
 */

import type { PartData, StepData } from "@/audio/AudioEngine";

// ─── Style-Templates ─────────────────────────────────────────────────────────

/**
 * Reduzierter Pattern-Typ — keine FX/Audio-Felder, nur was für das Rendering
 * gebraucht wird. So kann der Caller leichtgewichtige Stub-Daten in Tests
 * füttern, ohne komplette PatternData-Objekte zu konstruieren.
 */
export interface PatternForExport {
  id?: string;
  name: string;
  stepCount: 16 | 32 | 64 | 128;
  bpm?: number | null;
  parts: ReadonlyArray<Pick<PartData, "id" | "name" | "steps">>;
}

/** ID eines hardcodierten Style-Templates. */
export type PatternImageStyleId =
  | "default-dark"
  | "light-documentation"
  | "korg-tribute";

export interface PatternImageStyle {
  id: PatternImageStyleId;
  label: string;
  background: string;
  titleBarBackground: string;
  titleTextColor: string;
  subtitleColor: string;
  gridBackground: string;
  partLabelColor: string;
  partLabelBackground: string;
  gridLineColor: string;
  beatLineColor: string;
  stepEmptyFill: string;
  stepEmptyBorder: string;
  /** Active-Step-Fill. Velocity beeinflusst Alpha-Multiplier. */
  stepActiveFill: string;
  /** Optionaler Glow-Halo um aktive Steps (KORG-Tribute). */
  stepActiveGlow: string | null;
}

export const PATTERN_IMAGE_STYLES: Readonly<
  Record<PatternImageStyleId, PatternImageStyle>
> = {
  "default-dark": {
    id: "default-dark",
    label: "Default Dark",
    background: "#0f1115",
    titleBarBackground: "#161922",
    titleTextColor: "#e6e6e6",
    subtitleColor: "#9aa0a6",
    gridBackground: "#0f1115",
    partLabelColor: "#cfd2d6",
    partLabelBackground: "#161922",
    gridLineColor: "#23262e",
    beatLineColor: "#3a3e48",
    stepEmptyFill: "#1a1d24",
    stepEmptyBorder: "#2a2e36",
    stepActiveFill: "#22d3ee",
    stepActiveGlow: null,
  },
  "light-documentation": {
    id: "light-documentation",
    label: "Light Documentation",
    background: "#ffffff",
    titleBarBackground: "#f4f4f5",
    titleTextColor: "#0a0a0a",
    subtitleColor: "#525252",
    gridBackground: "#ffffff",
    partLabelColor: "#171717",
    partLabelBackground: "#fafafa",
    gridLineColor: "#e5e7eb",
    beatLineColor: "#a3a3a3",
    stepEmptyFill: "#fafafa",
    stepEmptyBorder: "#d4d4d8",
    stepActiveFill: "#111111",
    stepActiveGlow: null,
  },
  "korg-tribute": {
    id: "korg-tribute",
    label: "KORG Tribute",
    background: "#050805",
    titleBarBackground: "#0a120a",
    titleTextColor: "#7fff7f",
    subtitleColor: "#3f7f3f",
    gridBackground: "#050805",
    partLabelColor: "#7fff7f",
    partLabelBackground: "#0a120a",
    gridLineColor: "#0e1a0e",
    beatLineColor: "#1f3f1f",
    stepEmptyFill: "#0a120a",
    stepEmptyBorder: "#0f1f0f",
    stepActiveFill: "#7fff7f",
    stepActiveGlow: "rgba(127,255,127,0.55)",
  },
};

export function isPatternImageStyleId(
  value: unknown
): value is PatternImageStyleId {
  return (
    typeof value === "string" &&
    (value === "default-dark" ||
      value === "light-documentation" ||
      value === "korg-tribute")
  );
}

// ─── Size-Presets ────────────────────────────────────────────────────────────

export interface PatternImageSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const PATTERN_IMAGE_SIZES: ReadonlyArray<PatternImageSize> = [
  { id: "default", label: "Default (800 × 600)", width: 800, height: 600 },
  { id: "twitter", label: "Twitter (1200 × 675)", width: 1200, height: 675 },
  {
    id: "instagram",
    label: "Instagram (1080 × 1080)",
    width: 1080,
    height: 1080,
  },
];

// ─── Render-Optionen ─────────────────────────────────────────────────────────

export interface RenderOpts {
  width: number;
  height: number;
  /** Style-Template. Akzeptiert ID oder ein komplettes Style-Objekt. */
  theme?: PatternImageStyleId | PatternImageStyle;
  /** Velocity → Alpha (default true). */
  showVelocity?: boolean;
  /** Part-Label-Spalte einblenden (default true). */
  showPartNames?: boolean;
  /** Optional User-Override für die Title-Bar. Default: pattern.name. */
  titleText?: string;
  /**
   * Optional: gibt eine Canvas-Factory zurück, statt `document.createElement`
   * zu verwenden. Erforderlich für Node-Tests; im Browser leer lassen.
   */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
}

// ─── Pure-fn Helpers ─────────────────────────────────────────────────────────

const TITLE_BAR_RATIO = 0.1; // 10% der Höhe für Title-Bar
const PART_LABEL_RATIO = 0.18; // 18% der Breite für Part-Labels
const STEP_PADDING_RATIO = 0.1; // 10% Inset pro Step (= Gap zwischen Blöcken)
const FOOTER_RATIO = 0.05; // 5% Footer für Branding

export interface ComputedLayout {
  titleBarHeight: number;
  footerHeight: number;
  partLabelWidth: number;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  rowHeight: number;
  colWidth: number;
  stepInset: number;
}

export function computeLayout(opts: {
  width: number;
  height: number;
  partCount: number;
  stepCount: number;
  showPartNames: boolean;
}): ComputedLayout {
  const { width, height, partCount, stepCount, showPartNames } = opts;
  const titleBarHeight = Math.max(36, Math.round(height * TITLE_BAR_RATIO));
  const footerHeight = Math.max(18, Math.round(height * FOOTER_RATIO));
  const partLabelWidth = showPartNames
    ? Math.max(80, Math.round(width * PART_LABEL_RATIO))
    : 0;
  const gridX = partLabelWidth;
  const gridY = titleBarHeight;
  const gridWidth = Math.max(1, width - partLabelWidth);
  const gridHeight = Math.max(1, height - titleBarHeight - footerHeight);
  const rowHeight = partCount > 0 ? gridHeight / partCount : gridHeight;
  const colWidth = stepCount > 0 ? gridWidth / stepCount : gridWidth;
  const stepInset = Math.max(
    1,
    Math.min(rowHeight, colWidth) * STEP_PADDING_RATIO
  );
  return {
    titleBarHeight,
    footerHeight,
    partLabelWidth,
    gridX,
    gridY,
    gridWidth,
    gridHeight,
    rowHeight,
    colWidth,
    stepInset,
  };
}

/**
 * Velocity (0..127, default 100) → Alpha-Multiplier (0.4..1.0).
 */
export function velocityToAlpha(
  velocity: number | undefined,
  showVelocity: boolean
): number {
  if (!showVelocity) return 1;
  const v = typeof velocity === "number" && !isNaN(velocity) ? velocity : 100;
  const clamped = Math.max(0, Math.min(127, v));
  return 0.4 + (clamped / 127) * 0.6;
}

export function resolveStyle(theme: RenderOpts["theme"]): PatternImageStyle {
  if (theme && typeof theme === "object") return theme;
  if (typeof theme === "string" && isPatternImageStyleId(theme))
    return PATTERN_IMAGE_STYLES[theme];
  return PATTERN_IMAGE_STYLES["default-dark"];
}

/**
 * Liefert die Pixel-Position eines aktiven Step-Blocks (rect-Geometrie).
 * Exportiert für Tests die verifizieren wollen dass aktive Steps an der
 * korrekten Stelle gerendert werden.
 */
export interface StepRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function getStepRect(opts: {
  layout: ComputedLayout;
  partIndex: number;
  stepIndex: number;
}): StepRect {
  const { layout, partIndex, stepIndex } = opts;
  const cellX = layout.gridX + stepIndex * layout.colWidth;
  const cellY = layout.gridY + partIndex * layout.rowHeight;
  return {
    x: cellX + layout.stepInset,
    y: cellY + layout.stepInset,
    w: Math.max(1, layout.colWidth - layout.stepInset * 2),
    h: Math.max(1, layout.rowHeight - layout.stepInset * 2),
  };
}

function getActiveStep(
  steps: ReadonlyArray<StepData> | undefined,
  index: number
): StepData | null {
  if (!steps || index < 0 || index >= steps.length) return null;
  const s = steps[index];
  return s && s.active ? s : null;
}

function alphaToHex(alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  return Math.round(a * 255)
    .toString(16)
    .padStart(2, "0");
}

// ─── Canvas-Renderer ─────────────────────────────────────────────────────────

function defaultCreateCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === "undefined") {
    throw new Error(
      "renderPatternToCanvas: no document available — pass opts.createCanvas in node/test env"
    );
  }
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  return cv;
}

/**
 * Rendert ein Pattern auf ein neu erzeugtes Canvas und gibt es zurück.
 *
 * Verwendet im Browser document.createElement, im Test/Node-Env via
 * `opts.createCanvas`-Hook. Die ctx-Aufrufe sind eine Untermenge der
 * Canvas2D-API die ein simpler Mock leicht abdecken kann.
 */
export function renderPatternToCanvas(
  pattern: PatternForExport,
  opts: RenderOpts
): HTMLCanvasElement {
  const width = Math.max(64, Math.floor(opts.width));
  const height = Math.max(48, Math.floor(opts.height));
  const showPartNames = opts.showPartNames !== false;
  const showVelocity = opts.showVelocity !== false;
  const style = resolveStyle(opts.theme);
  const stepCount = pattern.stepCount;
  const parts = pattern.parts;
  const layout = computeLayout({
    width,
    height,
    partCount: parts.length || 1,
    stepCount,
    showPartNames,
  });

  const cv = (opts.createCanvas ?? defaultCreateCanvas)(width, height);
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("renderPatternToCanvas: 2d-context unavailable");

  // ── Background ──
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, width, height);

  // ── Title-Bar ──
  ctx.fillStyle = style.titleBarBackground;
  ctx.fillRect(0, 0, width, layout.titleBarHeight);
  const title = (opts.titleText ?? pattern.name ?? "Untitled").toString();
  const fontSize = Math.max(12, Math.round(layout.titleBarHeight * 0.45));
  ctx.fillStyle = style.titleTextColor;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(title, 12, layout.titleBarHeight / 2);
  const bpmText =
    typeof pattern.bpm === "number" ? `${Math.round(pattern.bpm)} BPM` : "—";
  const subtitle = `${bpmText} · ${stepCount} steps · ${parts.length} parts`;
  const subFont = Math.max(10, Math.round(fontSize * 0.55));
  ctx.fillStyle = style.subtitleColor;
  ctx.font = `${subFont}px sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(subtitle, width - 12, layout.titleBarHeight / 2);
  ctx.textAlign = "left";

  // ── Part-Label-Spalte ──
  if (showPartNames && layout.partLabelWidth > 0) {
    ctx.fillStyle = style.partLabelBackground;
    ctx.fillRect(0, layout.gridY, layout.partLabelWidth, layout.gridHeight);
    const labelFont = Math.max(
      10,
      Math.min(16, Math.round(layout.rowHeight * 0.4))
    );
    ctx.fillStyle = style.partLabelColor;
    ctx.font = `${labelFont}px sans-serif`;
    ctx.textBaseline = "middle";
    for (let i = 0; i < parts.length; i++) {
      const cy = layout.gridY + i * layout.rowHeight + layout.rowHeight / 2;
      const name = (parts[i].name ?? `Part ${i + 1}`).toString();
      ctx.fillText(truncate(name, layout.partLabelWidth - 16, ctx), 8, cy);
    }
  }

  // ── Grid-Hintergrund ──
  ctx.fillStyle = style.gridBackground;
  ctx.fillRect(layout.gridX, layout.gridY, layout.gridWidth, layout.gridHeight);

  // ── Empty-Step-Blocks + Steps ──
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    for (let s = 0; s < stepCount; s++) {
      const rect = getStepRect({ layout, partIndex: p, stepIndex: s });
      // Empty block
      ctx.fillStyle = style.stepEmptyFill;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = style.stepEmptyBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

      const active = getActiveStep(part.steps, s);
      if (active) {
        const alpha = velocityToAlpha(active.velocity, showVelocity);
        ctx.fillStyle = style.stepActiveFill + alphaToHex(alpha);
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        if (style.stepActiveGlow) {
          // KORG-LED-Glow simulieren — schmaler Ring nach außen
          ctx.strokeStyle = style.stepActiveGlow;
          ctx.lineWidth = 2;
          ctx.strokeRect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
        }
      }
    }
  }

  // ── Beat-Lines alle 4 Steps ──
  ctx.strokeStyle = style.beatLineColor;
  ctx.lineWidth = 1;
  for (let s = 0; s <= stepCount; s += 4) {
    const xs = layout.gridX + s * layout.colWidth;
    ctx.beginPath();
    ctx.moveTo(xs, layout.gridY);
    ctx.lineTo(xs, layout.gridY + layout.gridHeight);
    ctx.stroke();
  }

  // ── Footer ──
  ctx.fillStyle = style.subtitleColor;
  ctx.font = `${Math.max(9, Math.round(layout.footerHeight * 0.55))}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(
    "synthstudio",
    12,
    layout.gridY + layout.gridHeight + layout.footerHeight / 2
  );

  return cv;
}

function truncate(
  text: string,
  maxWidth: number,
  ctx: CanvasRenderingContext2D
): string {
  if (maxWidth <= 0) return "";
  // Manche Canvas-Mocks liefern keine measureText. Fallback: Zeichen-basiert.
  let measured: number | null = null;
  try {
    const m = ctx.measureText(text);
    if (m && typeof m.width === "number" && !isNaN(m.width)) measured = m.width;
  } catch {
    /* ignore */
  }
  if (measured !== null && measured <= maxWidth) return text;
  // Naive Approximation: 1 Zeichen ~ 7 Pixel bei 12px sans-serif
  const charBudget = Math.max(1, Math.floor(maxWidth / 7));
  if (text.length <= charBudget) return text;
  return text.slice(0, Math.max(1, charBudget - 1)) + "…";
}

// ─── Export-APIs ─────────────────────────────────────────────────────────────

/**
 * Konvertiert ein Pattern nach PNG (Blob). Verwendet canvas.toBlob im Browser;
 * fällt im Test-Env auf einen Buffer-basierten Pfad zurück wenn das Mock-Canvas
 * eine toBuffer-Methode hat (node-canvas-API).
 */
export async function exportPatternAsPng(
  pattern: PatternForExport,
  opts: RenderOpts
): Promise<Blob> {
  const cv = renderPatternToCanvas(pattern, opts);
  // Browser-Pfad
  if (typeof (cv as { toBlob?: unknown }).toBlob === "function") {
    return new Promise<Blob>((resolve, reject) => {
      (cv as HTMLCanvasElement).toBlob(blob => {
        if (blob) resolve(blob);
        else
          reject(new Error("exportPatternAsPng: canvas.toBlob returned null"));
      }, "image/png");
    });
  }
  // Node-canvas-Fallback (für node-canvas-API toBuffer)
  const maybeToBuffer = (
    cv as unknown as { toBuffer?: (mime: string) => Uint8Array | ArrayBuffer }
  ).toBuffer;
  if (typeof maybeToBuffer === "function") {
    const buf = maybeToBuffer.call(cv, "image/png");
    return new Blob([buf as BlobPart], { type: "image/png" });
  }
  // Last resort: Empty blob mit korrektem MIME (für reine Mocks).
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
    type: "image/png",
  });
}

/**
 * Exportiert ein Pattern als pure-SVG (Vector). String-output, kein Canvas
 * notwendig — eignet sich für Print/Web/SVG-Editoren und ist im Node-Test
 * vollständig deterministisch.
 */
export function exportPatternAsSvg(
  pattern: PatternForExport,
  opts: RenderOpts
): string {
  const width = Math.max(64, Math.floor(opts.width));
  const height = Math.max(48, Math.floor(opts.height));
  const showPartNames = opts.showPartNames !== false;
  const showVelocity = opts.showVelocity !== false;
  const style = resolveStyle(opts.theme);
  const stepCount = pattern.stepCount;
  const parts = pattern.parts;
  const layout = computeLayout({
    width,
    height,
    partCount: parts.length || 1,
    stepCount,
    showPartNames,
  });

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" data-synthstudio-pattern="${escapeAttr(pattern.id ?? "")}">`
  );
  // Background
  lines.push(rect(0, 0, width, height, style.background));
  // Title bar
  lines.push(
    rect(0, 0, width, layout.titleBarHeight, style.titleBarBackground)
  );
  const title = (opts.titleText ?? pattern.name ?? "Untitled").toString();
  const fontSize = Math.max(12, Math.round(layout.titleBarHeight * 0.45));
  lines.push(
    `<text x="12" y="${layout.titleBarHeight / 2}" fill="${style.titleTextColor}" ` +
      `font-family="sans-serif" font-size="${fontSize}" font-weight="bold" ` +
      `dominant-baseline="middle">${escapeXml(title)}</text>`
  );
  const bpmText =
    typeof pattern.bpm === "number" ? `${Math.round(pattern.bpm)} BPM` : "—";
  const subtitle = `${bpmText} · ${stepCount} steps · ${parts.length} parts`;
  const subFont = Math.max(10, Math.round(fontSize * 0.55));
  lines.push(
    `<text x="${width - 12}" y="${layout.titleBarHeight / 2}" fill="${style.subtitleColor}" ` +
      `font-family="sans-serif" font-size="${subFont}" text-anchor="end" ` +
      `dominant-baseline="middle">${escapeXml(subtitle)}</text>`
  );
  // Part labels
  if (showPartNames && layout.partLabelWidth > 0) {
    lines.push(
      rect(
        0,
        layout.gridY,
        layout.partLabelWidth,
        layout.gridHeight,
        style.partLabelBackground
      )
    );
    const labelFont = Math.max(
      10,
      Math.min(16, Math.round(layout.rowHeight * 0.4))
    );
    for (let i = 0; i < parts.length; i++) {
      const cy = layout.gridY + i * layout.rowHeight + layout.rowHeight / 2;
      const name = (parts[i].name ?? `Part ${i + 1}`).toString();
      lines.push(
        `<text x="8" y="${cy}" fill="${style.partLabelColor}" font-family="sans-serif" ` +
          `font-size="${labelFont}" dominant-baseline="middle">${escapeXml(name)}</text>`
      );
    }
  }
  // Grid background
  lines.push(
    rect(
      layout.gridX,
      layout.gridY,
      layout.gridWidth,
      layout.gridHeight,
      style.gridBackground
    )
  );

  // Steps
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    for (let s = 0; s < stepCount; s++) {
      const r = getStepRect({ layout, partIndex: p, stepIndex: s });
      lines.push(
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" ` +
          `fill="${style.stepEmptyFill}" stroke="${style.stepEmptyBorder}" stroke-width="1"/>`
      );
      const active = getActiveStep(part.steps, s);
      if (active) {
        const alpha = velocityToAlpha(active.velocity, showVelocity);
        lines.push(
          `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" ` +
            `fill="${style.stepActiveFill}" fill-opacity="${alpha.toFixed(3)}"` +
            (style.stepActiveGlow
              ? ` stroke="${style.stepActiveGlow}" stroke-width="2"`
              : "") +
            `/>`
        );
      }
    }
  }

  // Beat lines
  for (let s = 0; s <= stepCount; s += 4) {
    const xs = layout.gridX + s * layout.colWidth;
    lines.push(
      `<line x1="${xs}" y1="${layout.gridY}" x2="${xs}" y2="${layout.gridY + layout.gridHeight}" ` +
        `stroke="${style.beatLineColor}" stroke-width="1"/>`
    );
  }

  // Footer
  lines.push(
    `<text x="12" y="${layout.gridY + layout.gridHeight + layout.footerHeight / 2}" ` +
      `fill="${style.subtitleColor}" font-family="sans-serif" ` +
      `font-size="${Math.max(9, Math.round(layout.footerHeight * 0.55))}" ` +
      `dominant-baseline="middle">synthstudio</text>`
  );

  lines.push(`</svg>`);
  return lines.join("\n");
}

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string
): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeAttr(s: string): string {
  return escapeXml(s);
}

// ─── Filename-Helper ─────────────────────────────────────────────────────────

export function sanitizePatternExportFileName(
  patternName: string,
  extension: "png" | "svg"
): string {
  const base =
    (patternName ?? "pattern")
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "pattern";
  return `${base}.${extension}`;
}
