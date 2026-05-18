/**
 * SampleSliceEditor (TASK-238 / v2.89.0)
 *
 * Modal-Komponente fuer Sample-Chop:
 *  - Waveform-Canvas (Peak-reduziert auf Canvas-Breite)
 *  - Vertikale Slice-Marker, draggable per Pointer
 *  - Click auf leere Stelle → addOnset; Shift/Right-Click auf Marker → removeOnset
 *  - "Auto-Slice"-Button → autoSlice() pure-fn
 *  - Snap-to-Zero-Toggle (auf Drop des Markers)
 *  - Pad-Grid 4×4 unten zeigt die ersten 16 Slices mit Index-Label
 *  - "Apply" → splitChannelDataAtSlices → AudioBuffers → Callback an Parent
 *
 * Verwendet ausschliesslich die Public-API aus client/src/utils/sampleSlicing.ts.
 * Komponente ist isomorph; greift NICHT auf window.electronAPI zu. AudioContext
 * wird vom Parent uebergeben (er hat den existierenden Engine-Context).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addOnset,
  autoSlice,
  moveOnset,
  onsetsToSlices,
  removeOnset,
  snapToZeroCrossing,
  splitChannelDataAtSlices,
  MAX_PERFORMANCE_PADS,
  type OnsetCandidate,
  type SliceSpec,
} from "@/utils/sampleSlicing";

export interface SampleSliceEditorProps {
  /** Name fuer Header-Anzeige (z.B. Dateiname ohne Pfad). */
  sampleName: string;
  /** Mono-Float32-Array des Samples (Kanal 0 reicht — Auto-Slice arbeitet Mono). */
  channelData: Float32Array;
  /** Sample-Rate des Buffers (Hz). */
  sampleRate: number;
  /** Bei "Apply": Slice-Buffers + ihre SliceSpecs werden hochgereicht. */
  onApply: (slices: Float32Array[], specs: SliceSpec[]) => void;
  /** Bei Close ohne Apply (Cancel-Button oder ESC). */
  onClose: () => void;
}

const WAVE_HEIGHT_PX = 200;
const PAD_GRID_COLS = 4;
const PAD_GRID_ROWS = 4;
const ZC_SEARCH_RADIUS = 256;

/**
 * Reduziert Float32Array auf `targetSize` Peak-Paare (min/max je Bucket).
 * O(N) durchlauf, perfekt fuer Canvas-Render in <1ms auch bei mehrere
 * Millionen Frames.
 */
function buildPeaks(channelData: Float32Array, targetSize: number): { mins: Float32Array; maxs: Float32Array } {
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

export function SampleSliceEditor({
  sampleName,
  channelData,
  sampleRate,
  onApply,
  onClose,
}: SampleSliceEditorProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState<number>(800);
  const [onsets, setOnsets] = useState<OnsetCandidate[]>([{ frame: 0, strength: 0 }]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [dragFrame, setDragFrame] = useState<number | null>(null);
  const totalFrames = channelData.length;

  // ── Slices abgeleitet aus onsets (Single-Source) ──────────────────────────
  const slices = useMemo<SliceSpec[]>(
    () => onsetsToSlices(onsets, totalFrames),
    [onsets, totalFrames],
  );

  // ── Resize: Canvas-Breite an Container anpassen ───────────────────────────
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.max(200, Math.floor(e.contentRect.width));
        setCanvasWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Peaks memo (re-bauen wenn channelData oder Breite wechselt) ──────────
  const peaks = useMemo(() => buildPeaks(channelData, canvasWidth), [channelData, canvasWidth]);

  // ── Canvas-Render via RAF ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvasWidth;
    const h = WAVE_HEIGHT_PX;
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
    const draw = () => {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // BG
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      // Center-Line
      ctx.strokeStyle = centerLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Waveform (peak-paare)
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

      // Slice-Marker
      if (totalFrames > 0) {
        for (const o of onsets) {
          const x = Math.floor((o.frame / totalFrames) * w);
          const isDragged = dragFrame !== null && o.frame === dragFrame;
          ctx.strokeStyle = isDragged ? markerDragColor : markerColor;
          ctx.lineWidth = isDragged ? 2 : 1.5;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, h);
          ctx.stroke();

          // Kleiner Index-Tag oben links neben Linie
          const idx = onsets.indexOf(o);
          if (idx >= 0) {
            ctx.fillStyle = markerColor;
            ctx.font = "10px monospace";
            ctx.fillText(String(idx + 1), x + 3, 12);
          }
        }
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [peaks, canvasWidth, onsets, dragFrame, totalFrames]);

  // ── ESC zum Schliessen ────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // ── Mausinteraktion ───────────────────────────────────────────────────────

  const xToFrame = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const r = canvas.getBoundingClientRect();
    const rel = Math.max(0, Math.min(r.width, clientX - r.left));
    const ratio = r.width > 0 ? rel / r.width : 0;
    return Math.floor(ratio * totalFrames);
  }, [totalFrames]);

  const findNearestOnset = useCallback((frame: number, toleranceFrames: number): OnsetCandidate | null => {
    let best: OnsetCandidate | null = null;
    let bestDist = Infinity;
    for (const o of onsets) {
      const d = Math.abs(o.frame - frame);
      if (d < bestDist) {
        bestDist = d;
        best = o;
      }
    }
    return best && bestDist <= toleranceFrames ? best : null;
  }, [onsets]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const frame = xToFrame(e.clientX);
    const tolerance = Math.max(1, Math.floor(totalFrames / canvasWidth) * 4); // ~4px Click-Toleranz
    const nearby = findNearestOnset(frame, tolerance);

    // Rechtsklick oder Shift+Click auf Marker → remove (Frame 0 darf nicht entfernt werden — bleibt anchor)
    if (nearby && (e.button === 2 || e.shiftKey)) {
      e.preventDefault();
      if (nearby.frame === 0) return;
      setOnsets(prev => removeOnset(prev, nearby.frame));
      return;
    }

    if (nearby) {
      // Drag-Start
      setDragFrame(nearby.frame);
      return;
    }

    // Sonst: addOnset (Linksklick auf leere Stelle)
    if (e.button === 0) {
      setOnsets(prev => addOnset(prev, frame, MAX_PERFORMANCE_PADS));
    }
  }, [canvasWidth, findNearestOnset, totalFrames, xToFrame]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragFrame === null) return;
    const newFrame = xToFrame(e.clientX);
    if (newFrame === dragFrame) return;
    setOnsets(prev => moveOnset(prev, dragFrame, newFrame));
    setDragFrame(newFrame);
  }, [dragFrame, xToFrame]);

  const handleMouseUp = useCallback(() => {
    if (dragFrame === null) return;
    if (snapEnabled && dragFrame !== 0) {
      const snapped = snapToZeroCrossing(channelData, dragFrame, ZC_SEARCH_RADIUS);
      if (snapped !== dragFrame) {
        setOnsets(prev => moveOnset(prev, dragFrame, snapped));
      }
    }
    setDragFrame(null);
  }, [dragFrame, snapEnabled, channelData]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  // ── Button-Handler ────────────────────────────────────────────────────────

  const handleAutoSlice = useCallback(() => {
    try {
      const specs = autoSlice(channelData, sampleRate, {
        maxSlices: MAX_PERFORMANCE_PADS,
        snapToZero: snapEnabled,
        fillToMax: false,
      });
      const newOnsets: OnsetCandidate[] = specs.map(s => ({ frame: s.startFrame, strength: 1 }));
      // Garantie: Frame 0 anchor
      if (newOnsets.length === 0 || newOnsets[0].frame > 0) {
        newOnsets.unshift({ frame: 0, strength: 0 });
      }
      setOnsets(newOnsets);
    } catch (err) {
      console.error("[SampleSliceEditor] autoSlice failed", err);
    }
  }, [channelData, sampleRate, snapEnabled]);

  const handleReset = useCallback(() => {
    setOnsets([{ frame: 0, strength: 0 }]);
  }, []);

  const handleApply = useCallback(() => {
    const buffers = splitChannelDataAtSlices(channelData, slices);
    onApply(buffers, slices);
  }, [channelData, slices, onApply]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      data-testid="sample-slice-editor-overlay"
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Sample-Slice-Editor"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-color flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-text-primary truncate" title={sampleName}>
              Sample-Slicer · {sampleName}
            </div>
            <div className="text-[10px] text-text-muted">
              {totalFrames} Frames · {sampleRate} Hz · {(totalFrames / sampleRate).toFixed(2)} s
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg leading-none px-2"
            aria-label="Schliessen"
            data-testid="slice-editor-close"
          >
            ×
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2 border-b border-border-color flex items-center gap-2 flex-wrap">
          <button
            onClick={handleAutoSlice}
            className="px-3 py-1 rounded text-xs bg-accent-primary text-bg-base font-bold hover:opacity-90 transition-opacity"
            data-testid="slice-editor-auto"
          >
            Auto-Slice
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
            data-testid="slice-editor-reset"
          >
            Reset
          </button>
          <label className="flex items-center gap-1.5 text-xs text-text-muted ml-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={e => setSnapEnabled(e.target.checked)}
              data-testid="slice-editor-snap"
            />
            Snap-to-Zero
          </label>
          <div className="ml-auto text-[10px] text-text-dim">
            {slices.length} Slice(s) · Linksklick = Marker hinzufuegen · Shift/Rechtsklick = entfernen
          </div>
        </div>

        {/* Waveform-Canvas */}
        <div ref={containerRef} className="px-4 py-3 border-b border-border-color">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={handleContextMenu}
            style={{ display: "block", width: "100%", cursor: dragFrame !== null ? "grabbing" : "crosshair" }}
            data-testid="slice-editor-canvas"
          />
        </div>

        {/* Pad-Grid 4x4 */}
        <div className="px-4 py-3 flex-1 overflow-y-auto">
          <div className="text-[10px] text-text-dim mb-2">
            Performance-Pads ({Math.min(slices.length, MAX_PERFORMANCE_PADS)}/{MAX_PERFORMANCE_PADS})
          </div>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${PAD_GRID_COLS}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: PAD_GRID_COLS * PAD_GRID_ROWS }, (_, i) => {
              const slice = slices[i];
              const hasSlice = !!slice;
              const lengthFrames = slice ? slice.endFrame - slice.startFrame : 0;
              const lengthMs = (lengthFrames / sampleRate) * 1000;
              return (
                <div
                  key={i}
                  className={[
                    "aspect-square rounded border flex flex-col items-center justify-center text-center px-1",
                    hasSlice
                      ? "bg-bg-elevated border-accent-primary text-text-primary"
                      : "bg-bg-base border-border-color text-text-dim",
                  ].join(" ")}
                  data-testid={`slice-editor-pad-${i}`}
                >
                  <div className="text-xs font-bold">{i + 1}</div>
                  {hasSlice ? (
                    <div className="text-[9px] text-text-muted leading-tight mt-0.5">
                      {lengthMs >= 1000
                        ? `${(lengthMs / 1000).toFixed(2)} s`
                        : `${Math.round(lengthMs)} ms`}
                    </div>
                  ) : (
                    <div className="text-[9px] text-text-dim mt-0.5">—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border-color flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
            data-testid="slice-editor-cancel"
          >
            Abbrechen
          </button>
          <button
            onClick={handleApply}
            disabled={slices.length === 0}
            className="px-3 py-1.5 rounded text-xs bg-accent-success text-bg-base font-bold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="slice-editor-apply"
          >
            Apply ({slices.length})
          </button>
        </div>
      </div>
    </div>
  );
}

export default SampleSliceEditor;
