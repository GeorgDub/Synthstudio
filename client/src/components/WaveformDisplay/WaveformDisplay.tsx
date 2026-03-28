/**
 * Synthstudio – WaveformDisplay.tsx
 *
 * Canvas-basierte Wellenform-Visualisierung für den Sample-Browser.
 *
 * Features:
 * - Echtzeit-Rendering via Canvas API (kein SVG → performant bei langen Samples)
 * - Stereo-Waveform (L/R getrennt oder gemischt)
 * - Playhead-Animation (requestAnimationFrame)
 * - Zoom (Scroll-Wheel) und Pan (Drag)
 * - Loop-Marker (In/Out-Points) per Drag setzbar
 * - Hover-Tooltip mit Zeitposition
 * - Farbkodierung nach Kategorie
 * - Skeleton-Loading-State
 * - Browser + Electron kompatibel
 */
import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from "react";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface WaveformDisplayProps {
  /** Normalisierte Peak-Daten (0–1), entweder flat (mono) oder [L[], R[]] */
  peaks: number[] | [number[], number[]];
  /** Gesamtdauer in Sekunden */
  duration: number;
  /** Aktuelle Wiedergabeposition (0–1) – für Playhead */
  playbackPosition?: number;
  /** Ob gerade abgespielt wird */
  isPlaying?: boolean;
  /** Callback wenn User auf Waveform klickt (Position 0–1) */
  onSeek?: (position: number) => void;
  /** Loop-In-Point (0–1) */
  loopStart?: number;
  /** Loop-Out-Point (0–1) */
  loopEnd?: number;
  /** Callback wenn Loop-Marker geändert wird */
  onLoopChange?: (start: number, end: number) => void;
  /** Farbschema */
  color?: string;
  /** Hintergrundfarbe */
  backgroundColor?: string;
  /** Höhe der Komponente */
  height?: number;
  /** Ob Zoom/Pan aktiviert ist */
  zoomEnabled?: boolean;
  /** Ob Loading-Skeleton angezeigt wird */
  isLoading?: boolean;
  /** CSS-Klassen */
  className?: string;
}

// ─── Konstanten ───────────────────────────────────────────────────────────────

const DEFAULT_COLOR = "#22d3ee";       // cyan-400
const DEFAULT_BG    = "#0a0a0a";
const PLAYHEAD_COLOR = "#f97316";      // orange-500
const LOOP_COLOR     = "rgba(34,211,238,0.15)";
const LOOP_MARKER_COLOR = "#22d3ee";
const GRID_COLOR     = "rgba(255,255,255,0.04)";
const TIME_LABEL_COLOR = "rgba(255,255,255,0.3)";

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function normalizePeaks(peaks: number[] | [number[], number[]]): [number[], number[]] {
  if (Array.isArray(peaks[0])) {
    // Stereo: [L[], R[]]
    return peaks as [number[], number[]];
  }
  // Mono: duplizieren
  const mono = peaks as number[];
  return [mono, mono];
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function WaveformDisplay({
  peaks,
  duration,
  playbackPosition = 0,
  isPlaying = false,
  onSeek,
  loopStart,
  loopEnd,
  onLoopChange,
  color = DEFAULT_COLOR,
  backgroundColor = DEFAULT_BG,
  height = 96,
  zoomEnabled = true,
  isLoading = false,
  className = "",
}: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const playheadRef = useRef(playbackPosition);
  const isPlayingRef = useRef(isPlaying);

  // Zoom/Pan State
  const [zoomLevel, setZoomLevel] = useState(1);   // 1 = kein Zoom, max 32
  const [panOffset, setPanOffset] = useState(0);   // 0–1 (normalisiert)
  const zoomRef = useRef(1);
  const panRef = useRef(0);

  // Drag State
  const dragRef = useRef<{
    type: "pan" | "loopStart" | "loopEnd" | "seek";
    startX: number;
    startPan: number;
  } | null>(null);

  // Hover State
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);

  // Loop Marker State (lokal, wird über onLoopChange nach oben propagiert)
  const [localLoopStart, setLocalLoopStart] = useState(loopStart ?? 0);
  const [localLoopEnd, setLocalLoopEnd] = useState(loopEnd ?? 1);

  // Peaks normalisieren
  const [peaksL, peaksR] = useMemo(() => normalizePeaks(peaks), [peaks]);

  // Refs synchronisieren
  useEffect(() => { playheadRef.current = playbackPosition; }, [playbackPosition]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { zoomRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { panRef.current = panOffset; }, [panOffset]);
  useEffect(() => { if (loopStart !== undefined) setLocalLoopStart(loopStart); }, [loopStart]);
  useEffect(() => { if (loopEnd !== undefined) setLocalLoopEnd(loopEnd); }, [loopEnd]);

  // ── Canvas-Rendering ────────────────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const halfH = H / 2;
    const zoom = zoomRef.current;
    const pan = panRef.current;

    // Hintergrund
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, W, H);

    if (isLoading) {
      // Skeleton-Animation
      const gradient = ctx.createLinearGradient(0, 0, W, 0);
      gradient.addColorStop(0, "rgba(255,255,255,0.03)");
      gradient.addColorStop(0.5, "rgba(255,255,255,0.08)");
      gradient.addColorStop(1, "rgba(255,255,255,0.03)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, H * 0.3, W, H * 0.4);
      return;
    }

    if (peaksL.length === 0) {
      // Leerer Zustand
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, halfH);
      ctx.lineTo(W, halfH);
      ctx.stroke();
      return;
    }

    // Sichtbarer Bereich (normalisiert 0–1)
    const visibleWidth = 1 / zoom;
    const visStart = pan;
    const visEnd = Math.min(1, pan + visibleWidth);

    // Zeitgitter
    const gridLines = Math.min(20, Math.floor(duration));
    if (gridLines > 0) {
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      for (let i = 1; i < gridLines; i++) {
        const normPos = i / gridLines;
        if (normPos < visStart || normPos > visEnd) continue;
        const x = ((normPos - visStart) / visibleWidth) * W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }

    // Mittellinie
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, halfH);
    ctx.lineTo(W, halfH);
    ctx.stroke();

    // Peaks zeichnen
    const numPeaks = peaksL.length;
    const startIdx = Math.floor(visStart * numPeaks);
    const endIdx = Math.ceil(visEnd * numPeaks);
    const visiblePeaks = endIdx - startIdx;
    const pixelsPerPeak = W / visiblePeaks;

    // Stereo-Waveform: obere Hälfte = L, untere Hälfte = R
    const isStereo = peaksL !== peaksR;
    const channelHeight = isStereo ? halfH * 0.9 : halfH * 0.9;

    // Waveform-Farbe mit Gradient
    const waveGradient = ctx.createLinearGradient(0, 0, 0, H);
    waveGradient.addColorStop(0, color + "cc");
    waveGradient.addColorStop(0.5, color);
    waveGradient.addColorStop(1, color + "cc");

    ctx.fillStyle = waveGradient;

    // Linker Kanal (oben)
    for (let i = startIdx; i < endIdx; i++) {
      const peak = Math.min(1, Math.abs(peaksL[i] ?? 0));
      const x = ((i - startIdx) / visiblePeaks) * W;
      const barH = peak * channelHeight;
      const y = isStereo ? halfH - barH : halfH - barH;
      ctx.fillRect(
        Math.floor(x),
        Math.floor(y),
        Math.max(1, Math.ceil(pixelsPerPeak) - 1),
        Math.ceil(barH * 2)
      );
    }

    // Rechter Kanal (unten, gespiegelt) – nur bei echtem Stereo
    if (isStereo) {
      ctx.fillStyle = color + "88";
      for (let i = startIdx; i < endIdx; i++) {
        const peak = Math.min(1, Math.abs(peaksR[i] ?? 0));
        const x = ((i - startIdx) / visiblePeaks) * W;
        const barH = peak * channelHeight * 0.6;
        ctx.fillRect(
          Math.floor(x),
          Math.floor(halfH),
          Math.max(1, Math.ceil(pixelsPerPeak) - 1),
          Math.ceil(barH)
        );
      }
    }

    // Loop-Bereich
    if (onLoopChange !== undefined) {
      const lsX = ((localLoopStart - visStart) / visibleWidth) * W;
      const leX = ((localLoopEnd - visStart) / visibleWidth) * W;
      if (leX > lsX) {
        ctx.fillStyle = LOOP_COLOR;
        ctx.fillRect(lsX, 0, leX - lsX, H);
      }
      // Loop-Marker-Linien
      ctx.strokeStyle = LOOP_MARKER_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      if (localLoopStart >= visStart && localLoopStart <= visEnd) {
        ctx.beginPath();
        ctx.moveTo(lsX, 0);
        ctx.lineTo(lsX, H);
        ctx.stroke();
      }
      if (localLoopEnd >= visStart && localLoopEnd <= visEnd) {
        ctx.beginPath();
        ctx.moveTo(leX, 0);
        ctx.lineTo(leX, H);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // Playhead
    const playheadNorm = playheadRef.current;
    if (playheadNorm >= visStart && playheadNorm <= visEnd) {
      const phX = ((playheadNorm - visStart) / visibleWidth) * W;
      ctx.strokeStyle = PLAYHEAD_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, H);
      ctx.stroke();

      // Playhead-Dreieck oben
      ctx.fillStyle = PLAYHEAD_COLOR;
      ctx.beginPath();
      ctx.moveTo(phX - 5, 0);
      ctx.lineTo(phX + 5, 0);
      ctx.lineTo(phX, 8);
      ctx.closePath();
      ctx.fill();
    }

    // Zeitlabels
    ctx.fillStyle = TIME_LABEL_COLOR;
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    const labelCount = Math.min(8, Math.floor(W / 60));
    for (let i = 0; i <= labelCount; i++) {
      const normPos = visStart + (i / labelCount) * visibleWidth;
      const time = normPos * duration;
      const x = (i / labelCount) * W;
      ctx.fillText(formatTime(time), x + 2, H - 3);
    }
  }, [
    backgroundColor,
    color,
    duration,
    isLoading,
    localLoopEnd,
    localLoopStart,
    onLoopChange,
    peaksL,
    peaksR,
  ]);

  // Render-Loop
  useEffect(() => {
    let lastPos = -1;

    const loop = () => {
      const pos = playheadRef.current;
      if (pos !== lastPos || isPlayingRef.current) {
        render();
        lastPos = pos;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [render]);

  // Canvas-Größe anpassen bei Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      render();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [render]);

  // ── Maus-Events ─────────────────────────────────────────────────────────────

  const getPositionFromX = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const visibleWidth = 1 / zoomRef.current;
    return Math.max(0, Math.min(1, panRef.current + x * visibleWidth));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getPositionFromX(e.clientX);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;

    // Prüfen ob Loop-Marker angeklickt
    if (onLoopChange !== undefined) {
      const visibleWidth = 1 / zoomRef.current;
      const lsX = (localLoopStart - panRef.current) / visibleWidth;
      const leX = (localLoopEnd - panRef.current) / visibleWidth;

      if (Math.abs(x - lsX) < 0.02) {
        dragRef.current = { type: "loopStart", startX: e.clientX, startPan: panRef.current };
        return;
      }
      if (Math.abs(x - leX) < 0.02) {
        dragRef.current = { type: "loopEnd", startX: e.clientX, startPan: panRef.current };
        return;
      }
    }

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Mittlere Maustaste oder Alt+Links: Pan
      dragRef.current = { type: "pan", startX: e.clientX, startPan: panRef.current };
    } else if (e.button === 0) {
      // Links: Seek
      dragRef.current = { type: "seek", startX: e.clientX, startPan: panRef.current };
      onSeek?.(pos);
    }
  }, [getPositionFromX, localLoopEnd, localLoopStart, onLoopChange, onSeek]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getPositionFromX(e.clientX);
    setHoverTime(pos * duration);
    setHoverX(e.clientX);

    if (!dragRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (e.clientX - dragRef.current.startX) / rect.width;

    if (dragRef.current.type === "pan") {
      const visibleWidth = 1 / zoomRef.current;
      const newPan = Math.max(0, Math.min(1 - visibleWidth,
        dragRef.current.startPan - dx * visibleWidth
      ));
      setPanOffset(newPan);
      panRef.current = newPan;
    } else if (dragRef.current.type === "seek") {
      onSeek?.(pos);
    } else if (dragRef.current.type === "loopStart") {
      const newStart = Math.max(0, Math.min(localLoopEnd - 0.01, pos));
      setLocalLoopStart(newStart);
      onLoopChange?.(newStart, localLoopEnd);
    } else if (dragRef.current.type === "loopEnd") {
      const newEnd = Math.max(localLoopStart + 0.01, Math.min(1, pos));
      setLocalLoopEnd(newEnd);
      onLoopChange?.(localLoopStart, newEnd);
    }
  }, [duration, getPositionFromX, localLoopEnd, localLoopStart, onLoopChange, onSeek]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = null;
    setHoverTime(null);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!zoomEnabled) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / rect.width;

    const delta = e.deltaY > 0 ? 0.8 : 1.25;
    const newZoom = Math.max(1, Math.min(32, zoomRef.current * delta));

    // Zoom um Mausposition herum
    const visibleWidth = 1 / zoomRef.current;
    const mousePos = panRef.current + mouseX * visibleWidth;
    const newVisibleWidth = 1 / newZoom;
    const newPan = Math.max(0, Math.min(1 - newVisibleWidth, mousePos - mouseX * newVisibleWidth));

    setZoomLevel(newZoom);
    setPanOffset(newPan);
    zoomRef.current = newZoom;
    panRef.current = newPan;
  }, [zoomEnabled]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className={`relative select-none ${className}`}
      style={{ height }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        style={{ display: "block" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />

      {/* Hover-Tooltip */}
      {hoverTime !== null && (
        <div
          className="absolute top-1 pointer-events-none z-10 bg-black/80 text-cyan-300 text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ left: Math.min(hoverX - (canvasRef.current?.getBoundingClientRect().left ?? 0) + 4, (canvasRef.current?.offsetWidth ?? 200) - 60) }}
        >
          {formatTime(hoverTime)}
        </div>
      )}

      {/* Zoom-Indikator */}
      {zoomLevel > 1 && (
        <div className="absolute bottom-5 right-1 pointer-events-none text-[9px] text-slate-500 font-mono">
          {zoomLevel.toFixed(1)}×
        </div>
      )}

      {/* Zoom zurücksetzen */}
      {zoomLevel > 1 && (
        <button
          className="absolute top-1 right-1 text-[9px] text-slate-600 hover:text-slate-400 bg-black/60 px-1 rounded"
          onClick={() => { setZoomLevel(1); setPanOffset(0); zoomRef.current = 1; panRef.current = 0; }}
          title="Zoom zurücksetzen"
        >
          1:1
        </button>
      )}
    </div>
  );
}
