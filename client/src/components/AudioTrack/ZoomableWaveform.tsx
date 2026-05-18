/**
 * Synthstudio – ZoomableWaveform.tsx (v3.67.0)
 *
 * Sample-precise, zoomable Canvas-Waveform für Audio-Track-Strips (MixerView)
 * + zukünftige Audio-Editor-Panels. Komplementär zu WaveformDisplay (das nur
 * 32×-Zoom + Peak-Bars hat) bietet diese Variante:
 *
 *   - Zoom 1× .. 100× (sample-line statt peaks ab samplesPerPixel < 1)
 *   - Drag-to-scroll (hold + move)
 *   - Mouse-Wheel-Zoom centered auf Hover-Position
 *   - Keyboard: +/- zoom, ←/→ scroll, Home/End jump, 0 reset
 *   - Sample-precise Cursor (Click → setCursorSample, Anzeige in MM:SS.mmm)
 *   - Optional Loop-Start/-End-Marker (draggable, snap-to-zero-crossing on drop)
 *   - Subtile Scroll-Bar unter der Waveform
 *   - Zoom-Level-Display (Topbar-Badge "Zoom: 5.2×")
 *
 * Performance-Strategie:
 *   - Peak-Cache wird EINMAL beim Mount via buildPeakCache(numPeaks=4096)
 *     gebaut. Bei niedrigem Zoom rendert das Loop O(viewportWidthPx) statt
 *     O(totalSamples) — komplett unabhängig von der Audio-Länge.
 *   - Bei hohem Zoom (samplesPerPixel < 1) wechseln wir auf direkten
 *     channelData-Scan im Viewport-Range (oft < 10k Samples).
 *
 * Styling: NUR semantische Tailwind-Tokens (bg-bg-base/panel, text-text-*).
 * Keine Hardcoded-Farben. Accent-Lines lesen --ss-accent-primary via
 * getComputedStyle() — Theme-aware.
 *
 * Architektur-Regeln (CLAUDE.md):
 *   - State über useReducer NICHT zustand-npm — folgt local-only Pattern.
 *   - useElectron-Hook nicht benötigt (rein clientside-Canvas).
 *   - alle Interaktions-Math liegt in waveformZoom.ts → testbar in Node.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type LoopPoints,
  type ZoomState,
  buildPeakCache,
  clampScrollOffset,
  clampZoom,
  computeViewport,
  formatSampleTime,
  formatZoomLevel,
  MAX_ZOOM,
  MIN_ZOOM,
  pixelToSample,
  sampleToPixel,
  SAMPLE_LINE_THRESHOLD,
  scrollBy,
  setLoopEnd as setLoopEndPure,
  setLoopStart as setLoopStartPure,
  snapLoopPointsToZeroCrossing,
  ZOOM_STEP,
  zoomAtPoint,
} from "@/utils/waveformZoom";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ZoomableWaveformProps {
  /** Mono-Channel-Data (typischerweise buffer.getChannelData(0)). */
  channelData: Float32Array | null;
  /** Sample-Rate (für Time-Display). Default 44100. */
  sampleRate?: number;
  /** Cursor-Position in Samples (controlled). Falls null → kein Cursor. */
  cursorSample?: number | null;
  /** Callback wenn User klickt — Sample-Index (gerundet). */
  onCursorChange?: (sample: number) => void;
  /** Optional Loop-Points — falls gesetzt rendert die Komponente die Marker. */
  loopPoints?: LoopPoints | null;
  /** Callback bei Loop-Drag-Ende. Bekommt bereits zero-crossing-gesnapped LoopPoints. */
  onLoopChange?: (loop: LoopPoints) => void;
  /** Höhe in CSS-Pixeln. Default 96. */
  height?: number;
  /** Optional zusätzliche Klassen für den outer container. */
  className?: string;
  /** data-testid (für Tests + e2e). Default 'zoomable-waveform'. */
  testId?: string;
}

// ─── State (useReducer) ──────────────────────────────────────────────────────

type Action =
  | { type: "SET_ZOOM"; state: ZoomState }
  | { type: "SET_SCROLL"; offset: number; total: number }
  | { type: "RESET" };

function zoomReducer(state: ZoomState, action: Action): ZoomState {
  switch (action.type) {
    case "SET_ZOOM":
      return action.state;
    case "SET_SCROLL":
      return {
        zoomLevel: state.zoomLevel,
        scrollOffset: clampScrollOffset(action.offset, action.total, state.zoomLevel),
      };
    case "RESET":
      return { zoomLevel: MIN_ZOOM, scrollOffset: 0 };
    default:
      return state;
  }
}

// ─── Komponente ──────────────────────────────────────────────────────────────

export function ZoomableWaveform({
  channelData,
  sampleRate = 44100,
  cursorSample = null,
  onCursorChange,
  loopPoints = null,
  onLoopChange,
  height = 96,
  className = "",
  testId = "zoomable-waveform",
}: ZoomableWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoomState, dispatch] = useReducer(zoomReducer, {
    zoomLevel: MIN_ZOOM,
    scrollOffset: 0,
  });
  const [viewportWidthPx, setViewportWidthPx] = useState(0);
  const [hoverSample, setHoverSample] = useState<number | null>(null);

  // Drag-State: weder useState noch refs reichen alleine — wir brauchen Sync
  // zwischen mouse-down (setzt) und mouse-move (liest in event-listener).
  const dragRef = useRef<
    | { kind: "scroll"; lastX: number }
    | { kind: "loopStart" }
    | { kind: "loopEnd" }
    | null
  >(null);

  const totalSamples = channelData?.length ?? 0;

  // ── Peak-Cache (einmalig pro channelData) ──────────────────────────────────
  const peakCache = useMemo(() => {
    if (!channelData) return new Float32Array(0);
    return buildPeakCache(channelData, 4096);
  }, [channelData]);

  // ── Theme-Farben (lese aus CSS Variables) ──────────────────────────────────
  const themeColors = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        bg: "#0a0a0a",
        accent: "#22d3ee",
        cursor: "#f97316",
        loop: "#22d3ee",
        text: "rgba(255,255,255,0.55)",
        border: "rgba(255,255,255,0.08)",
      };
    }
    const cs = getComputedStyle(document.documentElement);
    return {
      bg: cs.getPropertyValue("--ss-bg-base").trim() || "#0a0a0a",
      accent: cs.getPropertyValue("--ss-accent-primary").trim() || "#22d3ee",
      cursor: cs.getPropertyValue("--ss-accent-danger").trim() || "#f97316",
      loop: cs.getPropertyValue("--ss-accent-secondary").trim() || "#22d3ee",
      text: cs.getPropertyValue("--ss-text-dim").trim() || "rgba(255,255,255,0.55)",
      border: cs.getPropertyValue("--ss-border").trim() || "rgba(255,255,255,0.08)",
    };
  }, []);

  // ── Resize-Observer ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => {
      setViewportWidthPx(el.clientWidth);
    });
    obs.observe(el);
    setViewportWidthPx(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  // ── Render Canvas ──────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || viewportWidthPx === 0) return;

    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const targetW = Math.max(1, Math.floor(viewportWidthPx * dpr));
    const targetH = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== targetW) canvas.width = targetW;
    if (canvas.height !== targetH) canvas.height = targetH;

    const W = canvas.width;
    const H = canvas.height;
    const halfH = H / 2;

    // BG
    ctx.fillStyle = themeColors.bg;
    ctx.fillRect(0, 0, W, H);

    // Centerline
    ctx.strokeStyle = themeColors.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(W, halfH);
    ctx.stroke();

    if (!channelData || totalSamples === 0) return;

    const vp = computeViewport(totalSamples, zoomState, viewportWidthPx);
    const useSampleLine = vp.samplesPerPixel < SAMPLE_LINE_THRESHOLD;

    if (useSampleLine) {
      // Sample-line: jeden Sample im Range als verbundene Linie
      ctx.strokeStyle = themeColors.accent;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath();
      const first = vp.firstVisibleSample;
      const last = vp.lastVisibleSample;
      const range = last - first;
      if (range > 0) {
        for (let i = 0; i < range; i++) {
          const sampleIdx = first + i;
          const v = channelData[sampleIdx] || 0;
          const x = (i / range) * W;
          const y = halfH - v * halfH * 0.9;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      // Peak-bars: aus dem peakCache (cheap)
      ctx.fillStyle = themeColors.accent;
      const cacheLen = peakCache.length;
      if (cacheLen > 0) {
        const first = vp.firstVisibleSample;
        const last = vp.lastVisibleSample;
        const startIdx = Math.floor((first / totalSamples) * cacheLen);
        const endIdx = Math.min(
          cacheLen,
          Math.ceil((last / totalSamples) * cacheLen),
        );
        const visibleCache = endIdx - startIdx;
        if (visibleCache > 0) {
          const pxPerBin = W / visibleCache;
          const barW = Math.max(1, Math.floor(pxPerBin));
          for (let i = 0; i < visibleCache; i++) {
            const peak = peakCache[startIdx + i] || 0;
            const x = Math.floor(i * pxPerBin);
            const barH = peak * halfH * 0.9;
            ctx.fillRect(x, halfH - barH, barW, barH * 2);
          }
        }
      }
    }

    // Loop-Bereich Highlight
    if (loopPoints) {
      const xs = sampleToPixel(loopPoints.loopStart, zoomState, totalSamples, viewportWidthPx) * dpr;
      const xe = sampleToPixel(loopPoints.loopEnd, zoomState, totalSamples, viewportWidthPx) * dpr;
      if (xe > xs) {
        ctx.fillStyle = themeColors.loop + "22";
        ctx.fillRect(xs, 0, xe - xs, H);
        ctx.strokeStyle = themeColors.loop;
        ctx.lineWidth = Math.max(1, dpr);
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(xs, 0);
        ctx.lineTo(xs, H);
        ctx.moveTo(xe, 0);
        ctx.lineTo(xe, H);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Cursor
    if (cursorSample !== null && cursorSample !== undefined && cursorSample >= 0) {
      const x = sampleToPixel(cursorSample, zoomState, totalSamples, viewportWidthPx) * dpr;
      if (x >= 0 && x <= W) {
        ctx.strokeStyle = themeColors.cursor;
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }
  }, [
    channelData,
    cursorSample,
    height,
    loopPoints,
    peakCache,
    themeColors,
    totalSamples,
    viewportWidthPx,
    zoomState,
  ]);

  useEffect(() => {
    render();
  }, [render]);

  // ── Mouse-Events ───────────────────────────────────────────────────────────
  const getMouseX = useCallback((e: React.MouseEvent | MouseEvent): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return e.clientX - rect.left;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (totalSamples === 0) return;
      e.preventDefault();
      const x = getMouseX(e);
      const next = zoomAtPoint(zoomState, totalSamples, viewportWidthPx, x, e.deltaY, ZOOM_STEP);
      dispatch({ type: "SET_ZOOM", state: next });
    },
    [getMouseX, totalSamples, viewportWidthPx, zoomState],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (totalSamples === 0) return;
      const x = getMouseX(e);

      // Loop-Marker Hit-Test (10 Pixel tolerance)
      if (loopPoints && onLoopChange) {
        const lsX = sampleToPixel(loopPoints.loopStart, zoomState, totalSamples, viewportWidthPx);
        const leX = sampleToPixel(loopPoints.loopEnd, zoomState, totalSamples, viewportWidthPx);
        if (Math.abs(x - lsX) < 10) {
          dragRef.current = { kind: "loopStart" };
          return;
        }
        if (Math.abs(x - leX) < 10) {
          dragRef.current = { kind: "loopEnd" };
          return;
        }
      }

      if (e.altKey || e.button === 1) {
        // Alt+Left or Middle: scroll-drag
        dragRef.current = { kind: "scroll", lastX: e.clientX };
      } else if (e.button === 0) {
        // Left click w/o alt: cursor seek + start drag-scroll
        const sample = pixelToSample(x, zoomState, totalSamples, viewportWidthPx);
        onCursorChange?.(sample);
        dragRef.current = { kind: "scroll", lastX: e.clientX };
      }
    },
    [getMouseX, loopPoints, onCursorChange, onLoopChange, totalSamples, viewportWidthPx, zoomState],
  );

  // Global mouse-move/up (capture drag outside canvas)
  useEffect(() => {
    if (totalSamples === 0) return;
    const move = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const xInCanvas = e.clientX - rect.left;
      // Hover-Sample für Tooltip
      if (xInCanvas >= 0 && xInCanvas <= viewportWidthPx) {
        const s = pixelToSample(xInCanvas, zoomState, totalSamples, viewportWidthPx);
        setHoverSample(s);
      } else {
        setHoverSample(null);
      }

      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "scroll") {
        const dx = e.clientX - drag.lastX;
        const vp = computeViewport(totalSamples, zoomState, viewportWidthPx);
        const dSamples = -dx * vp.samplesPerPixel;
        if (Math.abs(dSamples) >= 1) {
          const next = scrollBy(zoomState, totalSamples, dSamples);
          dispatch({ type: "SET_ZOOM", state: next });
          drag.lastX = e.clientX;
        }
      } else if (drag.kind === "loopStart" && loopPoints && onLoopChange) {
        const s = pixelToSample(xInCanvas, zoomState, totalSamples, viewportWidthPx);
        const next = setLoopStartPure(loopPoints, s, totalSamples);
        onLoopChange(next);
      } else if (drag.kind === "loopEnd" && loopPoints && onLoopChange) {
        const s = pixelToSample(xInCanvas, zoomState, totalSamples, viewportWidthPx);
        const next = setLoopEndPure(loopPoints, s, totalSamples);
        onLoopChange(next);
      }
    };
    const up = () => {
      const drag = dragRef.current;
      // On drop: snap loop points to zero-crossing
      if (drag && (drag.kind === "loopStart" || drag.kind === "loopEnd")
          && loopPoints && onLoopChange && channelData) {
        const snapped = snapLoopPointsToZeroCrossing(loopPoints, channelData);
        onLoopChange(snapped);
      }
      dragRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [channelData, loopPoints, onLoopChange, totalSamples, viewportWidthPx, zoomState]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (totalSamples === 0) return;
      const vp = computeViewport(totalSamples, zoomState, viewportWidthPx);
      const scrollStep = Math.max(1, Math.floor(vp.visibleSamples * 0.1));

      switch (e.key) {
        case "+":
        case "=": {
          // Zoom in (center)
          const next = zoomAtPoint(
            zoomState,
            totalSamples,
            viewportWidthPx,
            viewportWidthPx / 2,
            -1,
            ZOOM_STEP,
          );
          dispatch({ type: "SET_ZOOM", state: next });
          e.preventDefault();
          break;
        }
        case "-":
        case "_": {
          const next = zoomAtPoint(
            zoomState,
            totalSamples,
            viewportWidthPx,
            viewportWidthPx / 2,
            1,
            ZOOM_STEP,
          );
          dispatch({ type: "SET_ZOOM", state: next });
          e.preventDefault();
          break;
        }
        case "ArrowLeft": {
          const next = scrollBy(zoomState, totalSamples, -scrollStep);
          dispatch({ type: "SET_ZOOM", state: next });
          e.preventDefault();
          break;
        }
        case "ArrowRight": {
          const next = scrollBy(zoomState, totalSamples, scrollStep);
          dispatch({ type: "SET_ZOOM", state: next });
          e.preventDefault();
          break;
        }
        case "Home": {
          dispatch({ type: "SET_SCROLL", offset: 0, total: totalSamples });
          e.preventDefault();
          break;
        }
        case "End": {
          dispatch({
            type: "SET_SCROLL",
            offset: Number.MAX_SAFE_INTEGER,
            total: totalSamples,
          });
          e.preventDefault();
          break;
        }
        case "0": {
          dispatch({ type: "RESET" });
          e.preventDefault();
          break;
        }
        default:
          break;
      }
    },
    [totalSamples, viewportWidthPx, zoomState],
  );

  // ── Scroll-Bar ────────────────────────────────────────────────────────────
  // Visual: dünner Bar unter der Waveform der den sichtbaren Anteil zeigt.
  const scrollBarStyle = useMemo(() => {
    if (totalSamples === 0) return { left: "0%", width: "100%" };
    const z = clampZoom(zoomState.zoomLevel);
    const visibleFrac = 1 / z;
    const startFrac = zoomState.scrollOffset / totalSamples;
    return {
      left: (startFrac * 100).toFixed(2) + "%",
      width: (visibleFrac * 100).toFixed(2) + "%",
    };
  }, [totalSamples, zoomState]);

  // Click on scrollbar = jump
  const handleScrollBarClick = useCallback(
    (e: React.MouseEvent) => {
      if (totalSamples === 0) return;
      const el = e.currentTarget as HTMLDivElement;
      const rect = el.getBoundingClientRect();
      const frac = clampScrollOffset(0, totalSamples, zoomState.zoomLevel);
      const xFrac = (e.clientX - rect.left) / rect.width;
      const newOffset = Math.floor(xFrac * totalSamples);
      dispatch({
        type: "SET_SCROLL",
        offset: clampScrollOffset(newOffset, totalSamples, zoomState.zoomLevel),
        total: totalSamples,
      });
      void frac; // (kept reference to avoid unused-var warning when typecheck strict)
    },
    [totalSamples, zoomState.zoomLevel],
  );

  const cursorTimeLabel =
    cursorSample !== null && cursorSample !== undefined
      ? formatSampleTime(cursorSample, sampleRate)
      : null;
  const hoverTimeLabel =
    hoverSample !== null ? formatSampleTime(hoverSample, sampleRate) : null;

  // ── Render JSX ─────────────────────────────────────────────────────────────
  return (
    <div
      data-testid={testId}
      className={"flex flex-col gap-1 select-none " + className}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={containerRef}
        className="relative w-full bg-bg-base rounded border border-border-color overflow-hidden"
        style={{ height }}
      >
        <canvas
          data-testid={testId + "-canvas"}
          ref={canvasRef}
          className="w-full h-full cursor-crosshair"
          style={{ display: "block" }}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
        />
        {/* Zoom Badge */}
        <div
          data-testid={testId + "-zoom-label"}
          className="absolute top-1 right-1 px-1.5 py-0.5 text-[9px] font-mono rounded bg-bg-panel/80 text-text-dim pointer-events-none"
        >
          {formatZoomLevel(zoomState.zoomLevel)}
        </div>
        {/* Cursor Time Label */}
        {cursorTimeLabel && (
          <div
            data-testid={testId + "-cursor-label"}
            className="absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-mono rounded bg-bg-panel/80 text-accent-danger pointer-events-none"
          >
            {cursorTimeLabel}
          </div>
        )}
        {/* Hover Time Label (only when not also showing cursor) */}
        {hoverTimeLabel && !cursorTimeLabel && (
          <div
            data-testid={testId + "-hover-label"}
            className="absolute bottom-1 left-1 px-1.5 py-0.5 text-[9px] font-mono rounded bg-bg-panel/80 text-text-dim pointer-events-none"
          >
            {hoverTimeLabel}
          </div>
        )}
      </div>

      {/* Scroll-Bar */}
      <div
        data-testid={testId + "-scrollbar"}
        className="relative w-full h-1.5 rounded bg-bg-panel/60 cursor-pointer"
        onClick={handleScrollBarClick}
        role="scrollbar"
        aria-label="Waveform scroll position"
      >
        <div
          data-testid={testId + "-scrollbar-thumb"}
          className="absolute top-0 bottom-0 rounded bg-accent-primary/60"
          style={scrollBarStyle}
        />
      </div>
    </div>
  );
}
