/**
 * Synthstudio – WaveformSliceCanvas (v3.8.0)
 *
 * Leichtgewichtige inline Waveform + Slice-Marker-Komponente für den
 * KorgBankEditor. Wiederverwendete Render-Logik aus SampleSliceEditor:
 *   - Peak-Reduktion auf Canvas-Breite (min/max pro Bucket)
 *   - Center-Line, Waveform, Slice-Marker mit Index-Tag
 *   - Pointer-Interaktion: addOnset / moveOnset / removeOnset (rechtsklick + shift)
 *   - ResizeObserver für responsive Canvas-Breite
 *   - CSS-Variablen via `getComputedStyle` (theme-aware)
 *
 * Im Gegensatz zum Modal-basierten `SampleSliceEditor`:
 *   - Kompakter (Default-Höhe 120px)
 *   - Kein Pad-Grid / Footer — pure Waveform + Marker
 *   - State-Lifting: Caller liefert `onsets` + `onChange`-Callback;
 *     Komponente ist controlled.
 *   - Max-Slice-Cap konfigurierbar (Default 64 für ESLI)
 *
 * Defensive: alle Cross-Browser-quirks via guards (ResizeObserver, devicePixelRatio).
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addOnset,
  moveOnset,
  removeOnset,
  snapToZeroCrossing,
  type OnsetCandidate,
} from "@/utils/sampleSlicing";

export interface WaveformSliceCanvasProps {
  /** Mono-Float32-Array — Kanal 0 reicht für Visualisierung. */
  channelData: Float32Array;
  /** Sample-Rate (Hz) — wird für Zero-Crossing-Snap-Radius verwendet. */
  sampleRate: number;
  /** Sortierte Onset-Liste. Kontrolliert von außen. */
  onsets: OnsetCandidate[];
  /** Callback bei Änderung (add / remove / move). */
  onChange: (next: OnsetCandidate[]) => void;
  /** Max-Slice-Limit (default 64 für ESLI). */
  maxSlices?: number;
  /** Canvas-Höhe in CSS-Pixeln (default 120). */
  height?: number;
  /** Snap-to-Zero beim Drop des Markers (default true). */
  snapToZero?: boolean;
  /** Optionaler data-testid. */
  testId?: string;
  /** Optionale Klasse für äußeres Container-Div. */
  className?: string;
}

const DEFAULT_HEIGHT = 120;
const ZC_SEARCH_RADIUS = 256;

/**
 * Reduziert Float32Array auf `targetSize` Peak-Paare (min/max je Bucket).
 * O(N) — wiederverwendete Logik aus SampleSliceEditor.
 */
function buildPeaks(
  channelData: Float32Array,
  targetSize: number,
): { mins: Float32Array; maxs: Float32Array } {
  const size = Math.max(1, targetSize | 0);
  const mins = new Float32Array(size);
  const maxs = new Float32Array(size);
  if (channelData.length === 0) return { mins, maxs };
  const step = channelData.length / size;
  for (let i = 0; i < size; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(channelData.length, Math.floor((i + 1) * step));
    let mn = Infinity;
    let mx = -Infinity;
    for (let j = start; j < end; j++) {
      const v = channelData[j];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (!isFinite(mn)) mn = 0;
    if (!isFinite(mx)) mx = 0;
    mins[i] = mn;
    maxs[i] = mx;
  }
  return { mins, maxs };
}

function getCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function WaveformSliceCanvas({
  channelData,
  sampleRate,
  onsets,
  onChange,
  maxSlices = 64,
  height = DEFAULT_HEIGHT,
  snapToZero = true,
  testId,
  className,
}: WaveformSliceCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState<number>(600);
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const totalFrames = channelData.length;

  // ── Resize: Canvas-Breite an Container anpassen ─────────────────────────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(200, Math.floor(e.contentRect.width));
        setCanvasWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Peaks memo ───────────────────────────────────────────────────────────────
  const peaks = useMemo(
    () => buildPeaks(channelData, canvasWidth),
    [channelData, canvasWidth],
  );

  // ── Canvas-Render via RAF ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1);
    const w = canvasWidth;
    const h = height;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bgColor = getCssVar("--ss-bg-elevated", "#1f2937");
    const waveColor = getCssVar("--ss-text-muted", "#9ca3af");
    const centerLine = getCssVar("--ss-border", "#374151");
    const markerColor = getCssVar("--ss-accent-primary", "#f59e0b");
    const markerDragColor = getCssVar("--ss-accent-secondary", "#06b6d4");

    let raf = 0;
    const draw = (): void => {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = centerLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      ctx.strokeStyle = waveColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const half = h / 2;
      for (let x = 0; x < w; x++) {
        const mn = peaks.mins[x] ?? 0;
        const mx = peaks.maxs[x] ?? 0;
        const y1 = half - mx * half * 0.95;
        const y2 = half - mn * half * 0.95;
        ctx.moveTo(x + 0.5, y1);
        ctx.lineTo(x + 0.5, y2);
      }
      ctx.stroke();

      if (totalFrames > 0) {
        for (let idx = 0; idx < onsets.length; idx++) {
          const o = onsets[idx];
          const x = Math.floor((o.frame / totalFrames) * w);
          const isDragged = dragFrame !== null && o.frame === dragFrame;
          ctx.strokeStyle = isDragged ? markerDragColor : markerColor;
          ctx.lineWidth = isDragged ? 2 : 1.5;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, h);
          ctx.stroke();

          ctx.fillStyle = markerColor;
          ctx.font = "10px monospace";
          ctx.fillText(String(idx + 1), x + 3, 11);
        }
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [peaks, canvasWidth, onsets, dragFrame, totalFrames, height]);

  // ── Pointer-Mapping ─────────────────────────────────────────────────────────
  const xToFrame = useCallback(
    (clientX: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const r = canvas.getBoundingClientRect();
      const rel = Math.max(0, Math.min(r.width, clientX - r.left));
      const ratio = r.width > 0 ? rel / r.width : 0;
      return Math.floor(ratio * totalFrames);
    },
    [totalFrames],
  );

  const findNearestOnset = useCallback(
    (frame: number, tolerance: number): OnsetCandidate | null => {
      let best: OnsetCandidate | null = null;
      let bestDist = Infinity;
      for (const o of onsets) {
        const d = Math.abs(o.frame - frame);
        if (d < bestDist) {
          bestDist = d;
          best = o;
        }
      }
      return best && bestDist <= tolerance ? best : null;
    },
    [onsets],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const frame = xToFrame(e.clientX);
      const tolerance = Math.max(1, Math.floor(totalFrames / canvasWidth) * 4);
      const nearby = findNearestOnset(frame, tolerance);

      // Rechtsklick / Shift+Click auf Marker → remove
      if (nearby && (e.button === 2 || e.shiftKey)) {
        e.preventDefault();
        onChange(removeOnset(onsets, nearby.frame));
        return;
      }

      if (nearby) {
        setDragFrame(nearby.frame);
        return;
      }

      // Linksklick auf leere Stelle → addOnset
      if (e.button === 0) {
        onChange(addOnset(onsets, frame, maxSlices));
      }
    },
    [canvasWidth, findNearestOnset, totalFrames, xToFrame, onsets, onChange, maxSlices],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragFrame === null) return;
      const newFrame = xToFrame(e.clientX);
      if (newFrame === dragFrame) return;
      onChange(moveOnset(onsets, dragFrame, newFrame));
      setDragFrame(newFrame);
    },
    [dragFrame, xToFrame, onChange, onsets],
  );

  const handleMouseUp = useCallback(() => {
    if (dragFrame === null) return;
    if (snapToZero && dragFrame !== 0) {
      const snapped = snapToZeroCrossing(channelData, dragFrame, ZC_SEARCH_RADIUS);
      if (snapped !== dragFrame) {
        onChange(moveOnset(onsets, dragFrame, snapped));
      }
    }
    setDragFrame(null);
  }, [dragFrame, snapToZero, channelData, onsets, onChange]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Prevent native context menu — Right-Click ist Remove-Geste.
      e.preventDefault();
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid={testId}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={handleContextMenu}
        style={{
          display: "block",
          width: "100%",
          cursor: dragFrame !== null ? "grabbing" : "crosshair",
        }}
        data-testid={testId ? `${testId}-canvas` : undefined}
      />
    </div>
  );
}

export default WaveformSliceCanvas;
