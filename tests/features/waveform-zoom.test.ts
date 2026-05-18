/**
 * tests/features/waveform-zoom.test.ts (v3.67.0)
 *
 * Pure-fn Tests für client/src/utils/waveformZoom.ts.
 * env:node, kein DOM, kein Canvas. Sample-precise Math + Bounds + Snap.
 */
import { describe, it, expect } from "vitest";
import {
  buildPeakCache,
  clampNumber,
  clampScrollOffset,
  clampZoom,
  computeMaxScrollOffset,
  computeViewport,
  DEFAULT_ZERO_CROSS_WINDOW,
  formatSampleTime,
  formatZoomLevel,
  getVisiblePeaks,
  isSampleVisible,
  MAX_ZOOM,
  MIN_ZOOM,
  pixelToSample,
  sampleToPixel,
  scrollBy,
  setLoopEnd,
  setLoopStart,
  snapLoopPointsToZeroCrossing,
  snapToZeroCrossing,
  ZOOM_STEP,
  zoomAtPoint,
  type LoopPoints,
  type ZoomState,
} from "../../client/src/utils/waveformZoom";

// ─── (1) Clamp + Bounds ──────────────────────────────────────────────────────

describe("(1) clampNumber + clampZoom + clampScrollOffset", () => {
  it("clampNumber: respects bounds + NaN → min", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(99, 0, 10)).toBe(10);
    expect(clampNumber(Number.NaN, 0, 10)).toBe(0);
    expect(clampNumber(Number.POSITIVE_INFINITY, 0, 10)).toBe(0);
    expect(clampNumber(Number.NEGATIVE_INFINITY, 0, 10)).toBe(0);
  });

  it("clampZoom: enforces MIN_ZOOM and MAX_ZOOM", () => {
    expect(clampZoom(1)).toBe(MIN_ZOOM);
    expect(clampZoom(0.5)).toBe(MIN_ZOOM);
    expect(clampZoom(50)).toBe(50);
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(clampZoom(999)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
  });

  it("computeMaxScrollOffset: respects total + zoom", () => {
    // 1000 samples, zoom 1 → visible=1000 → max scroll = 0
    expect(computeMaxScrollOffset(1000, 1)).toBe(0);
    // 1000 samples, zoom 2 → visible=500 → max scroll = 500
    expect(computeMaxScrollOffset(1000, 2)).toBe(500);
    // 1000 samples, zoom 10 → visible=100 → max scroll = 900
    expect(computeMaxScrollOffset(1000, 10)).toBe(900);
  });

  it("computeMaxScrollOffset: defensive for empty / negative total", () => {
    expect(computeMaxScrollOffset(0, 5)).toBe(0);
    expect(computeMaxScrollOffset(-100, 5)).toBe(0);
    expect(computeMaxScrollOffset(Number.NaN, 5)).toBe(0);
  });

  it("clampScrollOffset: clamps to [0, max]", () => {
    expect(clampScrollOffset(500, 1000, 2)).toBe(500);
    expect(clampScrollOffset(-10, 1000, 2)).toBe(0);
    expect(clampScrollOffset(99999, 1000, 2)).toBe(500); // capped
    expect(clampScrollOffset(Number.NaN, 1000, 2)).toBe(0);
  });
});

// ─── (2) Zoom-In erhöht zoomLevel + Bounds bleiben ────────────────────────────

describe("(2) Zoom-In/Out + Wheel Behavior", () => {
  it("Zoom-In erhöht zoomLevel", () => {
    const state: ZoomState = { zoomLevel: 1, scrollOffset: 0 };
    const next = zoomAtPoint(state, 1000, 100, 50, -1, ZOOM_STEP);
    expect(next.zoomLevel).toBeGreaterThan(1);
    expect(next.zoomLevel).toBeCloseTo(ZOOM_STEP, 6);
  });

  it("Zoom-Out verringert zoomLevel und clamped MIN_ZOOM", () => {
    const state: ZoomState = { zoomLevel: 1, scrollOffset: 0 };
    // bei zoom 1 = MIN, weiteres Out-Zoom bleibt 1
    const next = zoomAtPoint(state, 1000, 100, 50, +1, ZOOM_STEP);
    expect(next.zoomLevel).toBe(MIN_ZOOM);
  });

  it("Zoom-In wird auf MAX_ZOOM gecapped", () => {
    let state: ZoomState = { zoomLevel: 80, scrollOffset: 0 };
    for (let i = 0; i < 50; i++) {
      state = zoomAtPoint(state, 100000, 200, 100, -1, 2.0);
    }
    expect(state.zoomLevel).toBe(MAX_ZOOM);
  });

  it("Mouse-Wheel-Zoom centered auf Hover: Sample unter Cursor bleibt", () => {
    // Setup: 1000 samples, viewport 100px, zoom 1, mouseX = 30
    // Sample unter cursor (vor zoom) = 0 + (30/100)*1000 = 300
    const state: ZoomState = { zoomLevel: 1, scrollOffset: 0 };
    const next = zoomAtPoint(state, 1000, 100, 30, -1, 2.0); // zoom in 2x
    expect(next.zoomLevel).toBe(2);
    // Visible nach zoom = 1000/2 = 500. Sample unter x=30 muss immer noch 300 sein.
    // also: scrollOffset + (30/100)*500 == 300 → scrollOffset = 300 - 150 = 150
    expect(next.scrollOffset).toBe(150);
  });

  it("Mouse-Wheel-Zoom an x=0 hält Sample am linken Rand stabil", () => {
    const state: ZoomState = { zoomLevel: 1, scrollOffset: 0 };
    const next = zoomAtPoint(state, 1000, 100, 0, -1, 2.0);
    expect(next.zoomLevel).toBe(2);
    expect(next.scrollOffset).toBe(0); // linker Rand bleibt 0
  });

  it("zoomAtPoint defensive bei totalSamples=0", () => {
    const next = zoomAtPoint(
      { zoomLevel: 5, scrollOffset: 100 },
      0,
      100,
      50,
      -1,
      ZOOM_STEP,
    );
    expect(next).toEqual({ zoomLevel: MIN_ZOOM, scrollOffset: 0 });
  });
});

// ─── (3) Scroll-Offset bleibt in bounds ──────────────────────────────────────

describe("(3) scrollBy + Bounds-Enforcement", () => {
  it("scrollBy: positive delta", () => {
    const state: ZoomState = { zoomLevel: 2, scrollOffset: 0 };
    const next = scrollBy(state, 1000, 100);
    expect(next.scrollOffset).toBe(100);
  });

  it("scrollBy: negative delta clamps to 0", () => {
    const state: ZoomState = { zoomLevel: 2, scrollOffset: 50 };
    const next = scrollBy(state, 1000, -200);
    expect(next.scrollOffset).toBe(0);
  });

  it("scrollBy: über max scroll wird clamped", () => {
    const state: ZoomState = { zoomLevel: 2, scrollOffset: 400 };
    // max = 1000 - 1000/2 = 500. Delta 200 → 600 → clamped auf 500
    const next = scrollBy(state, 1000, 200);
    expect(next.scrollOffset).toBe(500);
  });

  it("Scroll-Offset bleibt in bounds nach mehreren Operationen", () => {
    let state: ZoomState = { zoomLevel: 4, scrollOffset: 0 };
    state = scrollBy(state, 1000, 99999);
    expect(state.scrollOffset).toBeLessThanOrEqual(
      computeMaxScrollOffset(1000, 4),
    );
    state = scrollBy(state, 1000, -99999);
    expect(state.scrollOffset).toBe(0);
  });
});

// ─── (4) Cursor-Position in samples ──────────────────────────────────────────

describe("(4) pixelToSample / sampleToPixel — Sample Precision", () => {
  it("pixelToSample bei zoom=1: x/width × totalSamples", () => {
    const state: ZoomState = { zoomLevel: 1, scrollOffset: 0 };
    expect(pixelToSample(0, state, 1000, 100)).toBe(0);
    expect(pixelToSample(50, state, 1000, 100)).toBe(500);
    // Right-edge clamps to totalSamples-1
    expect(pixelToSample(100, state, 1000, 100)).toBe(999);
  });

  it("pixelToSample bei zoom=2 + scroll=200", () => {
    const state: ZoomState = { zoomLevel: 2, scrollOffset: 200 };
    // visible = 500, x=50 → sample = 200 + 0.5*500 = 450
    expect(pixelToSample(50, state, 1000, 100)).toBe(450);
  });

  it("Cursor-Position in samples — round-trip durch pixel + back", () => {
    const state: ZoomState = { zoomLevel: 5, scrollOffset: 100 };
    const sample = 250;
    const px = sampleToPixel(sample, state, 1000, 100);
    const back = pixelToSample(px, state, 1000, 100);
    expect(Math.abs(back - sample)).toBeLessThanOrEqual(1); // sample-precise
  });

  it("pixelToSample defensive bei totalSamples=0", () => {
    expect(pixelToSample(50, { zoomLevel: 1, scrollOffset: 0 }, 0, 100)).toBe(0);
  });

  it("pixelToSample clamps negative / out-of-canvas X", () => {
    const state: ZoomState = { zoomLevel: 1, scrollOffset: 0 };
    expect(pixelToSample(-50, state, 1000, 100)).toBe(0);
    expect(pixelToSample(99999, state, 1000, 100)).toBe(999);
  });

  it("isSampleVisible: true within range", () => {
    const state: ZoomState = { zoomLevel: 2, scrollOffset: 200 };
    expect(isSampleVisible(300, state, 1000)).toBe(true);
    expect(isSampleVisible(100, state, 1000)).toBe(false);
    expect(isSampleVisible(800, state, 1000)).toBe(false);
    expect(isSampleVisible(-1, state, 1000)).toBe(false);
  });
});

// ─── (5) Loop-Points snap-to-zero-crossing ───────────────────────────────────

describe("(5) Loop-Points + Zero-Crossing-Snap", () => {
  it("snapToZeroCrossing: findet nächsten Vorzeichenwechsel", () => {
    // Signal: alternating positive/negative chunks
    // [+,+,+,+,-,-,-,-,+,+,+,+]
    //   0 1 2 3 4 5 6 7 8 9 10 11
    // Zero crossings (prev->cur sign change) at indices 4 (prev +1 → -1) und 8 (prev -1 → +1)
    const data = new Float32Array([1, 1, 1, 1, -1, -1, -1, -1, 1, 1, 1, 1]);
    expect(snapToZeroCrossing(data, 3)).toBe(4); // nearest crossing
    expect(snapToZeroCrossing(data, 5)).toBe(4);
    expect(snapToZeroCrossing(data, 7)).toBe(8);
  });

  it("snapToZeroCrossing: defensive bei null/empty input", () => {
    expect(snapToZeroCrossing(null, 100)).toBe(100);
    expect(snapToZeroCrossing(new Float32Array(0), 100)).toBe(100);
    expect(snapToZeroCrossing(undefined, 100)).toBe(100);
  });

  it("snapToZeroCrossing: kein crossing im Fenster → unchanged", () => {
    const data = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(snapToZeroCrossing(data, 5, 3)).toBe(5);
  });

  it("setLoopStart: clamped gegen loopEnd", () => {
    const current: LoopPoints = { loopStart: 100, loopEnd: 500 };
    expect(setLoopStart(current, 200, 1000).loopStart).toBe(200);
    expect(setLoopStart(current, 600, 1000).loopStart).toBe(499); // → loopEnd-1
    expect(setLoopStart(current, -10, 1000).loopStart).toBe(0);
  });

  it("setLoopEnd: clamped gegen loopStart + totalSamples", () => {
    const current: LoopPoints = { loopStart: 100, loopEnd: 500 };
    expect(setLoopEnd(current, 700, 1000).loopEnd).toBe(700);
    expect(setLoopEnd(current, 50, 1000).loopEnd).toBe(101); // → loopStart+1
    expect(setLoopEnd(current, 99999, 1000).loopEnd).toBe(1000);
  });

  it("Loop-Points snap-to-zero-crossing", () => {
    // signal mit crossings bei 4 und 8
    const data = new Float32Array([1, 1, 1, 1, -1, -1, -1, -1, 1, 1, 1, 1]);
    const loop: LoopPoints = { loopStart: 3, loopEnd: 9 };
    const snapped = snapLoopPointsToZeroCrossing(loop, data, 5);
    expect(snapped.loopStart).toBe(4);
    expect(snapped.loopEnd).toBe(8);
  });

  it("snapLoopPointsToZeroCrossing: no-op falls snapped invalid wäre", () => {
    // Wenn Snap dazu führt dass end <= start → originale Loop zurück
    const data = new Float32Array([1, 1, -1, -1, 1, 1, -1, -1]);
    const loop: LoopPoints = { loopStart: 3, loopEnd: 4 };
    const snapped = snapLoopPointsToZeroCrossing(loop, data, 10);
    // Snap würde beide auf 4 ziehen → invalid → original return
    // (defensive: kein crash)
    expect(snapped.loopEnd).toBeGreaterThan(snapped.loopStart);
  });

  it("DEFAULT_ZERO_CROSS_WINDOW ist sinnvoll (>= 8)", () => {
    expect(DEFAULT_ZERO_CROSS_WINDOW).toBeGreaterThanOrEqual(8);
  });
});

// ─── (6) Viewport / Peak-Cache ───────────────────────────────────────────────

describe("(6) computeViewport + buildPeakCache + getVisiblePeaks", () => {
  it("computeViewport bei zoom=1 zeigt alle Samples", () => {
    const vp = computeViewport(1000, { zoomLevel: 1, scrollOffset: 0 }, 100);
    expect(vp.firstVisibleSample).toBe(0);
    expect(vp.lastVisibleSample).toBe(1000);
    expect(vp.visibleSamples).toBe(1000);
    expect(vp.samplesPerPixel).toBe(10);
  });

  it("computeViewport bei zoom=10 zeigt 1/10 der Samples", () => {
    const vp = computeViewport(1000, { zoomLevel: 10, scrollOffset: 500 }, 100);
    expect(vp.visibleSamples).toBe(100);
    expect(vp.firstVisibleSample).toBe(500);
    expect(vp.samplesPerPixel).toBe(1);
  });

  it("computeViewport defensive bei totalSamples=0", () => {
    const vp = computeViewport(0, { zoomLevel: 5, scrollOffset: 100 }, 100);
    expect(vp.visibleSamples).toBe(0);
    expect(vp.samplesPerPixel).toBe(0);
  });

  it("buildPeakCache reduziert auf numPeaks", () => {
    const data = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) data[i] = Math.sin(i / 10) * 0.5;
    const cache = buildPeakCache(data, 100);
    expect(cache.length).toBe(100);
    // alle Werte ∈ [0, 0.5] (abs der sin)
    for (let i = 0; i < cache.length; i++) {
      expect(cache[i]).toBeGreaterThanOrEqual(0);
      expect(cache[i]).toBeLessThanOrEqual(0.5);
    }
  });

  it("buildPeakCache defensive: null/empty/zero numPeaks", () => {
    expect(buildPeakCache(null, 100).length).toBe(0);
    expect(buildPeakCache(new Float32Array(0), 100).length).toBe(0);
    expect(buildPeakCache(new Float32Array([1, 2, 3]), 0).length).toBe(0);
  });

  it("getVisiblePeaks: liefert nur den Viewport-Anteil", () => {
    const cache = new Float32Array(100);
    for (let i = 0; i < 100; i++) cache[i] = i / 100;
    const state: ZoomState = { zoomLevel: 4, scrollOffset: 250 };
    // Visible-frac = 1/4 = 25% von 100 = 25 bins, ab 25% offset = idx 25
    const visible = getVisiblePeaks(cache, 1000, state);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThanOrEqual(30);
  });
});

// ─── (7) Format-Helper ───────────────────────────────────────────────────────

describe("(7) formatSampleTime + formatZoomLevel", () => {
  it("formatSampleTime: konvertiert samples in MM:SS.mmm @ 44100Hz", () => {
    expect(formatSampleTime(0)).toBe("00:00.000");
    expect(formatSampleTime(44100)).toBe("00:01.000");
    expect(formatSampleTime(44100 * 60)).toBe("01:00.000");
    expect(formatSampleTime(44100 * 83 + Math.floor(44100 * 0.456))).toMatch(
      /^01:23\.45[5-7]$/,
    );
  });

  it("formatSampleTime: defensive bei NaN/negative", () => {
    expect(formatSampleTime(Number.NaN)).toBe("00:00.000");
    expect(formatSampleTime(-100)).toBe("00:00.000");
    expect(formatSampleTime(100, 0)).toBe("00:00.000");
  });

  it("formatZoomLevel: < 10 zeigt eine Decimal, >= 10 ganzzahlig", () => {
    expect(formatZoomLevel(1)).toBe("Zoom: 1.0×");
    expect(formatZoomLevel(5.2)).toBe("Zoom: 5.2×");
    expect(formatZoomLevel(15)).toBe("Zoom: 15×");
    expect(formatZoomLevel(MAX_ZOOM)).toBe("Zoom: 100×");
  });
});
