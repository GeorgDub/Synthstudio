/**
 * tests/features/pattern-image-export.test.ts (v3.66.0)
 *
 * Tests für `client/src/utils/patternImageExport.ts`. env:node, kein DOM, kein
 * node-canvas-Binary nötig — wir liefern einen leichtgewichtigen Canvas-Mock
 * via `opts.createCanvas`. Der SVG-Export ist string-basiert und damit
 * komplett deterministisch.
 */
import { describe, it, expect, vi } from "vitest";
import {
  renderPatternToCanvas,
  exportPatternAsPng,
  exportPatternAsSvg,
  computeLayout,
  velocityToAlpha,
  getStepRect,
  resolveStyle,
  sanitizePatternExportFileName,
  PATTERN_IMAGE_STYLES,
  PATTERN_IMAGE_SIZES,
  isPatternImageStyleId,
  type PatternForExport,
} from "../../client/src/utils/patternImageExport";

// ─── Mock-Canvas ──────────────────────────────────────────────────────────────

interface CanvasCall {
  op: string;
  args: unknown[];
}

interface MockCanvas extends HTMLCanvasElement {
  __calls: CanvasCall[];
  __fillStyles: string[];
  __ctxState: { fillStyle: string; strokeStyle: string; lineWidth: number; font: string; textAlign: string; textBaseline: string };
}

function createMockCanvas(width: number, height: number): HTMLCanvasElement {
  const calls: CanvasCall[] = [];
  const fillStyles: string[] = [];
  const state = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
  };

  const ctx = {
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v: string) { state.fillStyle = v; fillStyles.push(v); },
    get strokeStyle() { return state.strokeStyle; },
    set strokeStyle(v: string) { state.strokeStyle = v; },
    get lineWidth() { return state.lineWidth; },
    set lineWidth(v: number) { state.lineWidth = v; },
    get font() { return state.font; },
    set font(v: string) { state.font = v; },
    get textAlign() { return state.textAlign; },
    set textAlign(v: string) { state.textAlign = v; },
    get textBaseline() { return state.textBaseline; },
    set textBaseline(v: string) { state.textBaseline = v; },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "fillRect", args: [x, y, w, h, state.fillStyle] });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "strokeRect", args: [x, y, w, h, state.strokeStyle] });
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ op: "fillText", args: [text, x, y, state.fillStyle] });
    },
    beginPath() { calls.push({ op: "beginPath", args: [] }); },
    moveTo(x: number, y: number) { calls.push({ op: "moveTo", args: [x, y] }); },
    lineTo(x: number, y: number) { calls.push({ op: "lineTo", args: [x, y] }); },
    stroke() { calls.push({ op: "stroke", args: [] }); },
    measureText(text: string) { return { width: text.length * 7 }; },
  };

  const cv = {
    width,
    height,
    style: {} as Record<string, string>,
    getContext(kind: string) {
      if (kind !== "2d") return null;
      return ctx;
    },
    toBuffer(_mime: string) {
      // node-canvas-API-Imitation: liefere ein PNG-Magic-Bytes-Mini-Sample.
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    },
    __calls: calls,
    __fillStyles: fillStyles,
    __ctxState: state,
  };

  return cv as unknown as HTMLCanvasElement;
}

// ─── Pattern-Fixtures ─────────────────────────────────────────────────────────

function makeSteps(activeIndices: number[], stepCount: number, velocity = 100) {
  return Array.from({ length: stepCount }, (_, i) => ({
    active: activeIndices.includes(i),
    velocity: activeIndices.includes(i) ? velocity : 0,
  }));
}

function makePattern(overrides?: Partial<PatternForExport>): PatternForExport {
  return {
    id: "pat-1",
    name: "Test Pattern",
    stepCount: 16,
    bpm: 120,
    parts: [
      { id: "p1", name: "Kick",  steps: makeSteps([0, 4, 8, 12], 16, 127) },
      { id: "p2", name: "Snare", steps: makeSteps([4, 12], 16, 100) },
      { id: "p3", name: "Hat",   steps: makeSteps([0, 2, 4, 6, 8, 10, 12, 14], 16, 80) },
    ],
    ...overrides,
  };
}

// ─── computeLayout ────────────────────────────────────────────────────────────

describe("computeLayout (v3.66.0)", () => {
  it("liefert positive Dimensionen für Standard-Größe", () => {
    const layout = computeLayout({ width: 800, height: 600, partCount: 4, stepCount: 16, showPartNames: true });
    expect(layout.titleBarHeight).toBeGreaterThanOrEqual(36);
    expect(layout.footerHeight).toBeGreaterThanOrEqual(18);
    expect(layout.partLabelWidth).toBeGreaterThanOrEqual(80);
    expect(layout.gridWidth).toBeGreaterThan(0);
    expect(layout.gridHeight).toBeGreaterThan(0);
    expect(layout.rowHeight).toBeGreaterThan(0);
    expect(layout.colWidth).toBeGreaterThan(0);
  });

  it("partLabelWidth=0 wenn showPartNames=false", () => {
    const layout = computeLayout({ width: 800, height: 600, partCount: 4, stepCount: 16, showPartNames: false });
    expect(layout.partLabelWidth).toBe(0);
    expect(layout.gridX).toBe(0);
  });

  it("32-step und 64-step skaliert colWidth korrekt nach unten", () => {
    const l16 = computeLayout({ width: 800, height: 600, partCount: 4, stepCount: 16, showPartNames: true });
    const l32 = computeLayout({ width: 800, height: 600, partCount: 4, stepCount: 32, showPartNames: true });
    const l64 = computeLayout({ width: 800, height: 600, partCount: 4, stepCount: 64, showPartNames: true });
    expect(l32.colWidth).toBeLessThan(l16.colWidth);
    expect(l64.colWidth).toBeLessThan(l32.colWidth);
  });
});

// ─── velocityToAlpha ──────────────────────────────────────────────────────────

describe("velocityToAlpha (v3.66.0)", () => {
  it("zurück 1 wenn showVelocity=false", () => {
    expect(velocityToAlpha(0, false)).toBe(1);
    expect(velocityToAlpha(127, false)).toBe(1);
    expect(velocityToAlpha(undefined, false)).toBe(1);
  });

  it("default velocity = 100 → Wert zwischen 0.4 und 1.0", () => {
    const a = velocityToAlpha(undefined, true);
    expect(a).toBeGreaterThanOrEqual(0.4);
    expect(a).toBeLessThanOrEqual(1.0);
  });

  it("velocity=127 → max 1.0, velocity=0 → min 0.4", () => {
    expect(velocityToAlpha(127, true)).toBeCloseTo(1.0, 5);
    expect(velocityToAlpha(0, true)).toBeCloseTo(0.4, 5);
  });

  it("clamped: über 127 = 127, unter 0 = 0", () => {
    expect(velocityToAlpha(200, true)).toBeCloseTo(1.0, 5);
    expect(velocityToAlpha(-50, true)).toBeCloseTo(0.4, 5);
  });
});

// ─── resolveStyle ─────────────────────────────────────────────────────────────

describe("resolveStyle + Style-Variants (v3.66.0)", () => {
  it("3 Templates existieren (default-dark, light-documentation, korg-tribute)", () => {
    expect(PATTERN_IMAGE_STYLES["default-dark"]).toBeDefined();
    expect(PATTERN_IMAGE_STYLES["light-documentation"]).toBeDefined();
    expect(PATTERN_IMAGE_STYLES["korg-tribute"]).toBeDefined();
  });

  it("Style-Variants haben unterschiedliche stepActiveFill-Colors", () => {
    const dark = PATTERN_IMAGE_STYLES["default-dark"];
    const light = PATTERN_IMAGE_STYLES["light-documentation"];
    const korg = PATTERN_IMAGE_STYLES["korg-tribute"];
    expect(dark.stepActiveFill).not.toBe(light.stepActiveFill);
    expect(light.stepActiveFill).not.toBe(korg.stepActiveFill);
    expect(dark.stepActiveFill).not.toBe(korg.stepActiveFill);
    // KORG-Tribute hat Glow, andere nicht.
    expect(korg.stepActiveGlow).not.toBeNull();
    expect(dark.stepActiveGlow).toBeNull();
    expect(light.stepActiveGlow).toBeNull();
  });

  it("resolveStyle: ID + Object + Fallback", () => {
    expect(resolveStyle("default-dark").id).toBe("default-dark");
    expect(resolveStyle("korg-tribute").id).toBe("korg-tribute");
    // Unbekannte ID → default-dark Fallback
    expect(resolveStyle("nope" as never).id).toBe("default-dark");
    expect(resolveStyle(undefined).id).toBe("default-dark");
    // Object pass-through
    const obj = { ...PATTERN_IMAGE_STYLES["light-documentation"], id: "light-documentation" as const };
    expect(resolveStyle(obj)).toBe(obj);
  });

  it("isPatternImageStyleId Whitelist", () => {
    expect(isPatternImageStyleId("default-dark")).toBe(true);
    expect(isPatternImageStyleId("korg-tribute")).toBe(true);
    expect(isPatternImageStyleId("custom")).toBe(false);
    expect(isPatternImageStyleId(42)).toBe(false);
    expect(isPatternImageStyleId(null)).toBe(false);
  });
});

// ─── renderPatternToCanvas ────────────────────────────────────────────────────

describe("renderPatternToCanvas (v3.66.0)", () => {
  it("16-Step Pattern liefert valid canvas mit korrekten Dimensionen", () => {
    const cv = renderPatternToCanvas(makePattern(), {
      width: 800, height: 600, theme: "default-dark",
      createCanvas: createMockCanvas,
    });
    expect(cv).toBeDefined();
    expect(cv.width).toBe(800);
    expect(cv.height).toBe(600);
  });

  it("clampt zu kleine width/height nach oben", () => {
    const cv = renderPatternToCanvas(makePattern(), {
      width: 10, height: 10, theme: "default-dark",
      createCanvas: createMockCanvas,
    });
    expect(cv.width).toBeGreaterThanOrEqual(64);
    expect(cv.height).toBeGreaterThanOrEqual(48);
  });

  it("active Steps werden an korrekten Positionen gerendert (fillRect-Aufrufe)", () => {
    const pattern = makePattern({
      parts: [{ id: "p1", name: "Kick", steps: makeSteps([0, 4], 16, 127) }],
    });
    const cv = renderPatternToCanvas(pattern, {
      width: 800, height: 600, theme: "default-dark",
      createCanvas: createMockCanvas,
    }) as unknown as MockCanvas;

    const layout = computeLayout({ width: 800, height: 600, partCount: 1, stepCount: 16, showPartNames: true });
    const rect0 = getStepRect({ layout, partIndex: 0, stepIndex: 0 });
    const rect4 = getStepRect({ layout, partIndex: 0, stepIndex: 4 });

    // Active-Fill-Calls suchen: fillStyle mit stepActiveFill-Präfix + Alpha-Hex
    const activeFill = PATTERN_IMAGE_STYLES["default-dark"].stepActiveFill;
    const activeRectCalls = cv.__calls.filter(
      (c) =>
        c.op === "fillRect" &&
        typeof c.args[4] === "string" &&
        (c.args[4] as string).startsWith(activeFill),
    );
    expect(activeRectCalls.length).toBe(2);
    // Geometrie muss zu den erwarteten Step-Rects passen
    const xs = activeRectCalls.map((c) => c.args[0] as number).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(rect0.x, 1);
    expect(xs[1]).toBeCloseTo(rect4.x, 1);
  });

  it("renderPatternToCanvas verwendet titleText-Override", () => {
    const cv = renderPatternToCanvas(makePattern({ name: "Original" }), {
      width: 800, height: 600, theme: "default-dark", titleText: "Custom Headline",
      createCanvas: createMockCanvas,
    }) as unknown as MockCanvas;
    const textCalls = cv.__calls.filter((c) => c.op === "fillText");
    const hasOverride = textCalls.some((c) => c.args[0] === "Custom Headline");
    const hasOriginal = textCalls.some((c) => c.args[0] === "Original");
    expect(hasOverride).toBe(true);
    expect(hasOriginal).toBe(false);
  });
});

// ─── exportPatternAsPng ───────────────────────────────────────────────────────

describe("exportPatternAsPng (v3.66.0)", () => {
  it("liefert Blob mit MIME image/png", async () => {
    const blob = await exportPatternAsPng(makePattern(), {
      width: 800, height: 600, theme: "default-dark",
      createCanvas: createMockCanvas,
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("verwendet canvas.toBlob im Browser-Pfad wenn vorhanden", async () => {
    // Mock-Canvas mit echtem toBlob (das den Test-Pfad triggert)
    const toBlobMock = vi.fn((cb: (b: Blob) => void) => {
      cb(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    });
    const factory = (w: number, h: number) => {
      const cv = createMockCanvas(w, h) as unknown as { toBlob?: typeof toBlobMock };
      cv.toBlob = toBlobMock;
      return cv as unknown as HTMLCanvasElement;
    };
    const blob = await exportPatternAsPng(makePattern(), {
      width: 400, height: 300, theme: "default-dark",
      createCanvas: factory,
    });
    expect(toBlobMock).toHaveBeenCalledTimes(1);
    expect(blob.type).toBe("image/png");
  });
});

// ─── exportPatternAsSvg ───────────────────────────────────────────────────────

describe("exportPatternAsSvg (v3.66.0)", () => {
  it("liefert SVG-String mit <svg>-Root + xmlns", () => {
    const svg = exportPatternAsSvg(makePattern(), {
      width: 800, height: 600, theme: "default-dark",
    });
    expect(typeof svg).toBe("string");
    expect(svg).toContain("<svg");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="800"');
    expect(svg).toContain('height="600"');
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it("rendert aktive Step-Rects (4 Kicks → 4 active-fill rects mit stepActiveFill)", () => {
    const pattern = makePattern({
      parts: [{ id: "p1", name: "Kick", steps: makeSteps([0, 4, 8, 12], 16, 127) }],
    });
    const svg = exportPatternAsSvg(pattern, {
      width: 800, height: 600, theme: "default-dark",
    });
    const activeColor = PATTERN_IMAGE_STYLES["default-dark"].stepActiveFill;
    const matches = svg.match(new RegExp(`fill="${activeColor}"`, "g"));
    // Active-Rects: 4 Steps. (Title-Bar etc. nutzen andere Fill-Colors.)
    expect(matches?.length).toBe(4);
  });

  it("Style-Variants liefern unterschiedlichen SVG-Output", () => {
    const dark = exportPatternAsSvg(makePattern(), { width: 800, height: 600, theme: "default-dark" });
    const light = exportPatternAsSvg(makePattern(), { width: 800, height: 600, theme: "light-documentation" });
    const korg = exportPatternAsSvg(makePattern(), { width: 800, height: 600, theme: "korg-tribute" });
    expect(dark).not.toBe(light);
    expect(light).not.toBe(korg);
    expect(dark).toContain(PATTERN_IMAGE_STYLES["default-dark"].stepActiveFill);
    expect(light).toContain(PATTERN_IMAGE_STYLES["light-documentation"].stepActiveFill);
    expect(korg).toContain(PATTERN_IMAGE_STYLES["korg-tribute"].stepActiveFill);
    // KORG hat Glow als stroke
    expect(korg).toContain(PATTERN_IMAGE_STYLES["korg-tribute"].stepActiveGlow as string);
  });

  it("escaped XML-Sonderzeichen im Title", () => {
    const svg = exportPatternAsSvg(makePattern({ name: 'A<b>"&\'' }), {
      width: 800, height: 600, theme: "default-dark",
    });
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&gt;");
    expect(svg).toContain("&quot;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&apos;");
  });

  it("verwendet titleText-Override statt pattern.name", () => {
    const svg = exportPatternAsSvg(makePattern({ name: "Original" }), {
      width: 800, height: 600, theme: "default-dark", titleText: "Custom",
    });
    expect(svg).toContain(">Custom<");
    expect(svg).not.toMatch(/>Original</);
  });
});

// ─── Filename + Sizes ─────────────────────────────────────────────────────────

describe("sanitizePatternExportFileName + PATTERN_IMAGE_SIZES (v3.66.0)", () => {
  it("sanitized non-alphanumeric chars", () => {
    expect(sanitizePatternExportFileName("My Cool Pattern!", "png")).toBe("my-cool-pattern.png");
    expect(sanitizePatternExportFileName("Hä??", "svg")).toBe("h.svg");
    expect(sanitizePatternExportFileName("", "png")).toBe("pattern.png");
  });

  it("cappt bei 60 chars + extension", () => {
    const long = "x".repeat(200);
    const out = sanitizePatternExportFileName(long, "svg");
    expect(out.length).toBeLessThanOrEqual(60 + 4);
    expect(out.endsWith(".svg")).toBe(true);
  });

  it("3 Default-Sizes: default 800x600, twitter 1200x675, instagram 1080x1080", () => {
    const def = PATTERN_IMAGE_SIZES.find((s) => s.id === "default");
    const tw  = PATTERN_IMAGE_SIZES.find((s) => s.id === "twitter");
    const ig  = PATTERN_IMAGE_SIZES.find((s) => s.id === "instagram");
    expect(def?.width).toBe(800);
    expect(def?.height).toBe(600);
    expect(tw?.width).toBe(1200);
    expect(tw?.height).toBe(675);
    expect(ig?.width).toBe(1080);
    expect(ig?.height).toBe(1080);
  });
});

// ─── 32 + 64 step ─────────────────────────────────────────────────────────────

describe("renderPatternToCanvas — 32/64 Steps (v3.66.0)", () => {
  it("32-step Pattern rendert active steps an korrekten Positionen", () => {
    const pattern: PatternForExport = {
      name: "32s",
      stepCount: 32,
      bpm: 130,
      parts: [{ id: "p", name: "P", steps: makeSteps([0, 16, 31], 32, 100) }],
    };
    const cv = renderPatternToCanvas(pattern, {
      width: 1200, height: 600, theme: "default-dark",
      createCanvas: createMockCanvas,
    }) as unknown as MockCanvas;
    const activeFill = PATTERN_IMAGE_STYLES["default-dark"].stepActiveFill;
    const activeCalls = cv.__calls.filter(
      (c) => c.op === "fillRect" && typeof c.args[4] === "string" && (c.args[4] as string).startsWith(activeFill),
    );
    expect(activeCalls.length).toBe(3);
  });

  it("64-step Pattern rendert ohne crash", () => {
    const pattern: PatternForExport = {
      name: "64s",
      stepCount: 64,
      bpm: 140,
      parts: [{ id: "p", name: "P", steps: makeSteps([0, 32, 63], 64, 100) }],
    };
    const cv = renderPatternToCanvas(pattern, {
      width: 1200, height: 600, theme: "korg-tribute",
      createCanvas: createMockCanvas,
    });
    expect(cv).toBeDefined();
    expect(cv.width).toBe(1200);
  });
});
