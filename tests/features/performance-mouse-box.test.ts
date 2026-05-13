/**
 * tests/features/performance-mouse-box.test.ts
 *
 * Unit-Tests für die Box-Selection-Helper aus PatternLaunchPad.tsx (TASK-120):
 *   • normalizeBox()      — Normalisiert Box mit potenziell negativem dx/dy.
 *   • boxIntersects()     — Pure axis-aligned bounding-box intersection.
 *   • collectPadsInBox()  — Liefert Indizes aller Pad-Rects, die mit der Box
 *                           überlappen; leere Slots (null) werden ignoriert.
 *
 * Wir importieren die Helper direkt aus PatternLaunchPad.tsx — sie sind
 * dort als Export-Top-Level-Functions verfügbar (auch wenn die Komponente
 * selbst nicht ausgeführt werden kann ohne DOM, sind die pure helpers
 * im Node-Environment importierbar).
 */
import { describe, it, expect } from "vitest";

import {
  normalizeBox,
  boxIntersects,
  collectPadsInBox,
  collectNonEmptyPadIndices,
  computeAutoScrollDelta,
  type AxisRect,
} from "../../client/src/components/PerformanceMode/PatternLaunchPad";
import type { PerformancePad } from "../../client/src/store/usePerformanceStore";

// ─── normalizeBox ────────────────────────────────────────────────────────────

describe("normalizeBox (TASK-120)", () => {
  it("Drag nach unten-rechts: Box behält start als oben-links", () => {
    const box = normalizeBox(10, 20, 100, 200);
    expect(box).toEqual({ x: 10, y: 20, w: 90, h: 180 });
  });

  it("Drag nach oben-links: Box wird normalisiert (start wird zu unten-rechts)", () => {
    const box = normalizeBox(100, 200, 10, 20);
    expect(box).toEqual({ x: 10, y: 20, w: 90, h: 180 });
  });

  it("Drag nach oben-rechts (negative dy): normalisiert", () => {
    const box = normalizeBox(10, 200, 100, 20);
    expect(box).toEqual({ x: 10, y: 20, w: 90, h: 180 });
  });

  it("Drag nach unten-links (negative dx): normalisiert", () => {
    const box = normalizeBox(100, 20, 10, 200);
    expect(box).toEqual({ x: 10, y: 20, w: 90, h: 180 });
  });

  it("Null-Bewegung (mousedown ohne drag): w=0 / h=0", () => {
    const box = normalizeBox(50, 50, 50, 50);
    expect(box).toEqual({ x: 50, y: 50, w: 0, h: 0 });
  });

  it("Negative Koordinaten (zB Scroll-Out-of-Viewport) bleiben erhalten", () => {
    const box = normalizeBox(-100, -50, 100, 50);
    expect(box).toEqual({ x: -100, y: -50, w: 200, h: 100 });
  });
});

// ─── boxIntersects ──────────────────────────────────────────────────────────

describe("boxIntersects (TASK-120)", () => {
  // Referenz-Pad-Rect bei (0,0) mit Größe 50×50
  const padRect: AxisRect = { x: 0, y: 0, w: 50, h: 50 };

  it("Box komplett innerhalb Pad → true", () => {
    expect(boxIntersects({ x: 10, y: 10, w: 20, h: 20 }, padRect)).toBe(true);
  });

  it("Box komplett umschließt Pad → true", () => {
    expect(boxIntersects({ x: -10, y: -10, w: 100, h: 100 }, padRect)).toBe(true);
  });

  it("Box überlappt nur Ecke (links-oben) → true", () => {
    expect(boxIntersects({ x: -10, y: -10, w: 20, h: 20 }, padRect)).toBe(true);
  });

  it("Box rechts daneben, kein Overlap → false", () => {
    expect(boxIntersects({ x: 200, y: 200, w: 50, h: 50 }, padRect)).toBe(false);
  });

  it("Box exakt links angrenzend (rechte Kante = Pad linke Kante) → false (halb-offen)", () => {
    expect(boxIntersects({ x: -50, y: 0, w: 50, h: 50 }, padRect)).toBe(false);
  });

  it("Box mit w=0 → false (degeneriertes Rechteck)", () => {
    expect(boxIntersects({ x: 0, y: 0, w: 0, h: 50 }, padRect)).toBe(false);
  });

  it("Box mit h=0 → false", () => {
    expect(boxIntersects({ x: 0, y: 0, w: 50, h: 0 }, padRect)).toBe(false);
  });

  it("Box exakt im Pad-Mittelpunkt (1×1px) → true", () => {
    expect(boxIntersects({ x: 25, y: 25, w: 1, h: 1 }, padRect)).toBe(true);
  });

  it("Symmetrisch: a∩b = b∩a", () => {
    const a: AxisRect = { x: 0, y: 0, w: 100, h: 100 };
    const b: AxisRect = { x: 50, y: 50, w: 200, h: 200 };
    expect(boxIntersects(a, b)).toBe(boxIntersects(b, a));
    expect(boxIntersects(a, b)).toBe(true);
  });
});

// ─── collectPadsInBox ───────────────────────────────────────────────────────

describe("collectPadsInBox (TASK-120)", () => {
  // 4×4 Grid wie im Performance Pad — Pads bei (col*100, row*100), Größe 80×80
  function makeGridRects(filledMask: number[] = []): Array<AxisRect | null> {
    const out: Array<AxisRect | null> = [];
    for (let i = 0; i < 16; i++) {
      if (filledMask.length && !filledMask.includes(i)) {
        out.push(null); // leerer Slot
        continue;
      }
      const col = i % 4;
      const row = Math.floor(i / 4);
      out.push({ x: col * 100, y: row * 100, w: 80, h: 80 });
    }
    return out;
  }

  it("Box deckt obere zwei Pads (0,1) ab → [0, 1]", () => {
    const rects = makeGridRects();
    const box: AxisRect = { x: 0, y: 0, w: 200, h: 80 };
    expect(collectPadsInBox(box, rects)).toEqual([0, 1]);
  });

  it("Box deckt gesamte erste Reihe ab → [0,1,2,3]", () => {
    const rects = makeGridRects();
    const box: AxisRect = { x: 0, y: 0, w: 400, h: 80 };
    expect(collectPadsInBox(box, rects)).toEqual([0, 1, 2, 3]);
  });

  it("Box deckt 2x2-Block (Pads 0,1,4,5) ab", () => {
    const rects = makeGridRects();
    const box: AxisRect = { x: 0, y: 0, w: 200, h: 200 };
    expect(collectPadsInBox(box, rects)).toEqual([0, 1, 4, 5]);
  });

  it("Box außerhalb des Grids → []", () => {
    const rects = makeGridRects();
    const box: AxisRect = { x: 1000, y: 1000, w: 200, h: 200 };
    expect(collectPadsInBox(box, rects)).toEqual([]);
  });

  it("Leere Slots (null) werden ignoriert auch wenn Box drüber liegt", () => {
    // Pads 0,1,2,3 in Reihe — aber Pad 1 ist leer.
    const rects = makeGridRects([0, 2, 3]); // Pads 1, 4..15 sind null
    const box: AxisRect = { x: 0, y: 0, w: 400, h: 80 };
    // Erwartung: Pad 1 wird ausgelassen, weil null
    expect(collectPadsInBox(box, rects)).toEqual([0, 2, 3]);
  });

  it("Degenerierte Box (w=0) → []", () => {
    const rects = makeGridRects();
    const box: AxisRect = { x: 0, y: 0, w: 0, h: 80 };
    expect(collectPadsInBox(box, rects)).toEqual([]);
  });

  it("Box berührt nur einen Pixel des ersten Pads (1×1 in der Mitte)", () => {
    const rects = makeGridRects();
    const box: AxisRect = { x: 40, y: 40, w: 1, h: 1 };
    expect(collectPadsInBox(box, rects)).toEqual([0]);
  });

  it("Leeres padRects-Array → []", () => {
    const box: AxisRect = { x: 0, y: 0, w: 100, h: 100 };
    expect(collectPadsInBox(box, [])).toEqual([]);
  });

  it("Reverse-Drag (start=unten-rechts, current=oben-links) liefert dieselben Hits nach normalizeBox", () => {
    const rects = makeGridRects();
    // Normalize first
    const box = normalizeBox(200, 80, 0, 0);
    expect(collectPadsInBox(box, rects)).toEqual([0, 1]);
  });
});

// ─── collectNonEmptyPadIndices (TASK-127a) ───────────────────────────────────

function makePad(patternId: string): PerformancePad {
  return { patternId, label: null, color: null };
}

describe("collectNonEmptyPadIndices (TASK-127a)", () => {
  it("Komplett leeres Array (alle null) → []", () => {
    expect(collectNonEmptyPadIndices([null, null, null, null])).toEqual([]);
  });

  it("Komplett gefüllt → alle Indizes in Reihenfolge", () => {
    const pads = [makePad("p1"), makePad("p2"), makePad("p3")];
    expect(collectNonEmptyPadIndices(pads)).toEqual([0, 1, 2]);
  });

  it("Gemischt: nur non-empty Indizes", () => {
    const pads = [null, makePad("p2"), null, makePad("p4"), null];
    expect(collectNonEmptyPadIndices(pads)).toEqual([1, 3]);
  });

  it("Leeres Eingabe-Array → []", () => {
    expect(collectNonEmptyPadIndices([])).toEqual([]);
  });

  it("Reihenfolge ist stabil (kleinster Index zuerst)", () => {
    const pads = [makePad("p1"), null, makePad("p3"), null, makePad("p5")];
    expect(collectNonEmptyPadIndices(pads)).toEqual([0, 2, 4]);
  });
});

// ─── computeAutoScrollDelta (TASK-127b) ──────────────────────────────────────

describe("computeAutoScrollDelta (TASK-127b)", () => {
  it("Mitte des Viewports → {0, 0} (kein Scroll)", () => {
    expect(computeAutoScrollDelta(960, 540, 1920, 1080)).toEqual({ dx: 0, dy: 0 });
  });

  it("Maus AM linken Rand (x=0) → maximale Scroll nach links (dx negativ)", () => {
    const { dx, dy } = computeAutoScrollDelta(0, 500, 1920, 1080);
    expect(dx).toBe(-12); // maxSpeed default
    expect(dy).toBe(0);
  });

  it("Maus AM oberen Rand (y=0) → maximale Scroll nach oben (dy negativ)", () => {
    const { dx, dy } = computeAutoScrollDelta(960, 0, 1920, 1080);
    expect(dx).toBe(0);
    expect(dy).toBe(-12);
  });

  it("Maus AM rechten Rand (x=viewportW) → maximale Scroll nach rechts (dx positiv)", () => {
    const { dx, dy } = computeAutoScrollDelta(1920, 500, 1920, 1080);
    expect(dx).toBe(12);
    expect(dy).toBe(0);
  });

  it("Maus AM unteren Rand (y=viewportH) → maximale Scroll nach unten (dy positiv)", () => {
    const { dx, dy } = computeAutoScrollDelta(960, 1080, 1920, 1080);
    expect(dx).toBe(0);
    expect(dy).toBe(12);
  });

  it("Maus mittendrin (Abstand = threshold) → kein Scroll mehr", () => {
    // threshold = 40 default. Maus bei x=40 → genau an der Threshold-Grenze
    const { dx } = computeAutoScrollDelta(40, 500, 1920, 1080);
    expect(dx).toBe(0);
  });

  it("Maus halb in der Edge-Zone → ca. 50% Scroll-Geschwindigkeit", () => {
    // Maus bei x=20 (halbiert von threshold=40) → dx ≈ -6 (50% von max=12)
    const { dx } = computeAutoScrollDelta(20, 500, 1920, 1080);
    expect(dx).toBe(-6);
  });

  it("Ecke oben-links: dx UND dy beide negativ", () => {
    const { dx, dy } = computeAutoScrollDelta(10, 5, 1920, 1080);
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
  });

  it("Ecke unten-rechts: dx UND dy beide positiv", () => {
    const { dx, dy } = computeAutoScrollDelta(1915, 1075, 1920, 1080);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
  });

  it("Custom threshold/maxSpeed werden respektiert", () => {
    // threshold=100, maxSpeed=20
    const { dx } = computeAutoScrollDelta(0, 500, 1920, 1080, 100, 20);
    expect(dx).toBe(-20);
  });
});
