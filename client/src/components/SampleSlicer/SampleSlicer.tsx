/**
 * Synthstudio – SampleSlicer (Beat Slicer)
 *
 * Phase D: Vollständiger interaktiver Beat Slicer.
 * - Waveform-Anzeige via Canvas (decodiertes Audio-Buffer)
 * - Klick: Marker hinzufügen | Marker ziehen: Position verschieben | Rechtsklick: Marker löschen
 * - Auto-Slice: Transient Detection oder gleichmäßige Aufteilung (4/8/16/32 Parts)
 * - Vorschau: Einzelne Slices abspielen
 * - Export: Slices in DrumMachine-Kanäle übertragen (mit Offset-Metadaten)
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { SliceRegion } from "@/store/useSampleSlicerStore";
import { detectTransients } from "@/utils/transientDetection";

interface SampleSlicerProps {
  sampleUrl?: string;
  audioDuration: number;
  slices: SliceRegion[];
  onAddSlice: (slice: Omit<SliceRegion, "id">) => string;
  onRemoveSlice: (id: string) => void;
  onUpdateSlice: (id: string, update: Partial<Omit<SliceRegion, "id">>) => void;
  onAutoSlice: (offsets: number[], totalFrames: number, sampleRate: number) => void;
  onClose: () => void;
  /** Optional: Exportiert Slices als DrumMachine-Parts */
  onExportToDrumMachine?: (slices: SliceRegion[], sampleUrl: string, sampleRate: number, totalFrames: number) => void;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function getCssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Zeichnet BPM-Grid-Linien auf den Canvas. */
function drawBpmGrid(
  ctx: CanvasRenderingContext2D,
  totalFrames: number,
  sampleRate: number,
  bpm: number,
  w: number,
  h: number,
  dpr: number,
) {
  const framesPerBeat = (sampleRate * 60) / bpm;
  const framesPerBar  = framesPerBeat * 4;
  const gridColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--ss-accent-primary").trim() || "#f59e0b";

  ctx.setLineDash([2 * dpr, 4 * dpr]);
  ctx.lineWidth = dpr;

  // Bar-Linien (heller)
  let f = 0;
  while (f <= totalFrames) {
    const x = (f / totalFrames) * w;
    ctx.strokeStyle = `${gridColor}60`;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    f += framesPerBar;
  }

  // Beat-Linien (dunkler, nur Beats innerhalb einer Bar)
  f = framesPerBeat;
  while (f <= totalFrames) {
    const barFrac = (f / framesPerBar) % 1;
    if (barFrac > 0.01) { // nicht auf Bar-Grenzen (die sind schon gezeichnet)
      const x = (f / totalFrames) * w;
      ctx.strokeStyle = `${gridColor}25`;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    f += framesPerBeat;
  }

  ctx.setLineDash([]);
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  audioBuffer: AudioBuffer,
  slices: SliceRegion[],
  hoveredSlice: number | null,
  playingSlice: number | null,
  warpBpm?: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio;
  const w = canvas.width;
  const h = canvas.height;

  const bg        = getCssVar("--ss-bg-base",     "#0a0a0a");
  const waveColor = getCssVar("--ss-accent-primary", "#f59e0b");
  const sliceColor= getCssVar("--ss-accent-secondary","#06b6d4");
  const textColor = getCssVar("--ss-text-dim",    "#64748b");

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Waveform (Kanal 0)
  const data = audioBuffer.getChannelData(0);
  const totalFrames = audioBuffer.length;
  const step = Math.ceil(totalFrames / w);

  ctx.beginPath();
  ctx.strokeStyle = waveColor;
  ctx.lineWidth = dpr;
  ctx.globalAlpha = 0.8;

  for (let x = 0; x < w; x++) {
    let min = 1, max = -1;
    for (let s = x * step; s < Math.min((x + 1) * step, totalFrames); s++) {
      const v = data[s];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yMin = ((1 - max) / 2) * h;
    const yMax = ((1 - min) / 2) * h;
    if (x === 0) ctx.moveTo(x, yMin);
    ctx.lineTo(x, yMin);
    ctx.lineTo(x, yMax);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Slice-Regionen einfärben
  slices.forEach((slice, i) => {
    const x0 = (slice.startOffset / totalFrames) * w;
    const x1 = (slice.endOffset   / totalFrames) * w;
    const isHov = hoveredSlice === i;
    const isPlay = playingSlice === i;

    ctx.fillStyle = isPlay
      ? `${waveColor}30`
      : isHov
        ? `${sliceColor}25`
        : `${sliceColor}10`;
    ctx.fillRect(x0, 0, x1 - x0, h);

    // Start-Marker (senkrechte Linie)
    ctx.strokeStyle = isPlay ? waveColor : sliceColor;
    ctx.lineWidth = dpr * 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, h);
    ctx.stroke();

    // Slice-Nummer
    ctx.fillStyle = textColor;
    ctx.font = `${10 * dpr}px ui-monospace, monospace`;
    ctx.fillText(`${i + 1}`, x0 + 3 * dpr, 14 * dpr);
  });

  // Warp/BPM-Grid Overlay
  if (warpBpm && warpBpm > 0) {
    drawBpmGrid(ctx, totalFrames, audioBuffer.sampleRate, warpBpm, w, h, dpr);
  }

  // Letzter End-Marker
  if (slices.length > 0) {
    const lastEnd = slices[slices.length - 1].endOffset / totalFrames * w;
    ctx.strokeStyle = sliceColor;
    ctx.lineWidth = dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(lastEnd, 0);
    ctx.lineTo(lastEnd, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ─── Komponente ──────────────────────────────────────────────────────────────

export function SampleSlicer({
  sampleUrl, audioDuration, slices,
  onAddSlice, onRemoveSlice, onUpdateSlice, onAutoSlice, onClose, onExportToDrumMachine,
}: SampleSlicerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [playingSlice, setPlayingSlice] = useState<number | null>(null);
  const [hoveredSlice, setHoveredSlice] = useState<number | null>(null);
  const [dragSlice, setDragSlice] = useState<{ id: string; edge: "start" } | null>(null);
  const [equalDivisions, setEqualDivisions] = useState(16);
  const [sensitivity, setSensitivity] = useState(0.15);
  const previewNodeRef = useRef<AudioBufferSourceNode | null>(null);
  // Warp Markers
  const [warpBpm, setWarpBpm] = useState(0);       // 0 = Grid aus
  const [warpSnap, setWarpSnap] = useState(false);  // Snap-to-Beat beim Setzen

  // Audio laden und Waveform zeichnen
  useEffect(() => {
    if (!sampleUrl) return;
    setLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const ctx = new AudioContext();
        const resp = await fetch(sampleUrl);
        const buf = await resp.arrayBuffer();
        const decoded = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        audioBufferRef.current = decoded;
        setLoading(false);
      } catch {
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sampleUrl]);

  // Waveform neuzeichnen wenn sich Slices oder Buffer ändern
  useEffect(() => {
    const canvas = canvasRef.current;
    const buf = audioBufferRef.current;
    if (!canvas || !buf) return;

    // HiDPI
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;

    drawWaveform(canvas, buf, slices, hoveredSlice, playingSlice, warpBpm > 0 ? warpBpm : undefined);
  }, [slices, hoveredSlice, playingSlice, loading]);

  // Resize Observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const buf = audioBufferRef.current;
      if (!buf) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width  = rect.width  * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      drawWaveform(canvas, buf, slices, hoveredSlice, playingSlice, warpBpm > 0 ? warpBpm : undefined);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slices]);

  // Maus-Position → Frame-Offset
  const clientXToFrame = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    const buf = audioBufferRef.current;
    if (!canvas || !buf) return 0;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * buf.length);
  }, []);

  // Nächsten Slice-Startpunkt in der Nähe finden (für Drag-Detection)
  const findSliceNear = useCallback((clientX: number): string | null => {
    const canvas = canvasRef.current;
    const buf = audioBufferRef.current;
    if (!canvas || !buf) return null;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left);
    const threshold = 8; // px

    for (const slice of slices) {
      const slicePx = (slice.startOffset / buf.length) * rect.width;
      if (Math.abs(slicePx - px) < threshold) return slice.id;
    }
    return null;
  }, [slices]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const buf = audioBufferRef.current;
    if (!buf) return;

    // Rechtsklick: Marker löschen
    if (e.button === 2) {
      const nearId = findSliceNear(e.clientX);
      if (nearId) onRemoveSlice(nearId);
      return;
    }

    // Linksklick: Marker ziehen oder neuen setzen
    const nearId = findSliceNear(e.clientX);
    if (nearId) {
      setDragSlice({ id: nearId, edge: "start" });
      return;
    }

    // Neuen Marker setzen (mit optionalem Snap-to-Beat)
    let frame = clientXToFrame(e.clientX);
    if (warpSnap && warpBpm > 0 && buf) {
      const framesPerBeat = (buf.sampleRate * 60) / warpBpm;
      frame = Math.round(frame / framesPerBeat) * framesPerBeat;
    }
    const sorted = [...slices].sort((a, b) => a.startOffset - b.startOffset);
    const nextStart = sorted.find(s => s.startOffset > frame);
    const endOffset = nextStart?.startOffset ?? buf.length;
    // Vorherigen Slice verkürzen
    const prevSlice = [...sorted].reverse().find(s => s.startOffset < frame);
    if (prevSlice) onUpdateSlice(prevSlice.id, { endOffset: frame });
    onAddSlice({ startOffset: frame, endOffset, loopMode: "one-shot", reverse: false });
  }, [slices, clientXToFrame, findSliceNear, onAddSlice, onRemoveSlice, onUpdateSlice]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const buf = audioBufferRef.current;
    if (!buf) return;

    // Hover-Slice bestimmen
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width * buf.length;
      const idx = slices.findIndex((_, i) => {
        const s = slices[i];
        const end = slices[i + 1]?.startOffset ?? buf.length;
        return px >= s.startOffset && px < end;
      });
      setHoveredSlice(idx >= 0 ? idx : null);
    }

    // Drag
    if (dragSlice) {
      const frame = clientXToFrame(e.clientX);
      const slice = slices.find(s => s.id === dragSlice.id);
      if (!slice) return;

      const sorted = [...slices].sort((a, b) => a.startOffset - b.startOffset);
      const idx = sorted.findIndex(s => s.id === dragSlice.id);

      // Grenzen: nicht hinter vorherigen oder vor nächsten Marker
      const minFrame = idx > 0 ? sorted[idx - 1].startOffset + 1 : 0;
      const maxFrame = idx < sorted.length - 1 ? sorted[idx + 1].startOffset - 1 : buf.length;
      const clamped = Math.max(minFrame, Math.min(maxFrame, frame));

      onUpdateSlice(dragSlice.id, { startOffset: clamped });
      // Vorherigen Slice anpassen
      if (idx > 0) onUpdateSlice(sorted[idx - 1].id, { endOffset: clamped });
    }
  }, [dragSlice, slices, clientXToFrame, onUpdateSlice]);

  const handleCanvasMouseUp = useCallback(() => {
    setDragSlice(null);
  }, []);

  // Slice preview
  const previewSlice = useCallback((slice: SliceRegion, idx: number) => {
    const buf = audioBufferRef.current;
    if (!buf) return;
    previewNodeRef.current?.stop();
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startSec = slice.startOffset / buf.sampleRate;
    const durSec = Math.max(0.01, (slice.endOffset - slice.startOffset) / buf.sampleRate);
    src.start(0, startSec, durSec);
    setPlayingSlice(idx);
    src.onended = () => setPlayingSlice(null);
    previewNodeRef.current = src;
  }, []);

  // Auto-Slice: gleichmäßig
  const handleEqualSlice = useCallback(() => {
    const buf = audioBufferRef.current;
    if (!buf) return;
    const framePerSlice = Math.floor(buf.length / equalDivisions);
    const offsets = Array.from({ length: equalDivisions }, (_, i) => i * framePerSlice);
    onAutoSlice(offsets, buf.length, buf.sampleRate);
  }, [equalDivisions, onAutoSlice]);

  // Auto-Slice: Transient Detection
  const handleTransientSlice = useCallback(async () => {
    const buf = audioBufferRef.current;
    if (!buf) return;
    setLoading(true);
    try {
      const markers = detectTransients(buf, sensitivity, 50);
      const offsets = [0, ...markers.map(m => m.sampleOffset)];
      onAutoSlice(offsets, buf.length, buf.sampleRate);
    } finally {
      setLoading(false);
    }
  }, [sensitivity, onAutoSlice]);

  // Export zu DrumMachine
  const handleExport = useCallback(() => {
    const buf = audioBufferRef.current;
    if (!buf || !sampleUrl || !onExportToDrumMachine) return;
    onExportToDrumMachine(slices, sampleUrl, buf.sampleRate, buf.length);
  }, [slices, sampleUrl, onExportToDrumMachine]);

  return (
    <div className="flex flex-col h-full bg-bg-base text-text-primary">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-panel border-b border-border-color flex-shrink-0">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Beat Slicer</span>
        {sampleUrl && (
          <span className="text-[10px] text-text-dim truncate max-w-[200px]" title={sampleUrl}>
            {sampleUrl.split("/").pop()}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[10px] text-text-dim">{slices.length} Slices</span>
        {audioDuration > 0 && (
          <span className="text-[10px] text-text-dim">{audioDuration.toFixed(2)}s</span>
        )}
        <button onClick={onClose} className="text-text-dim hover:text-text-primary text-lg leading-none">✕</button>
      </div>

      {/* Waveform Canvas */}
      <div className="flex-shrink-0 px-3 pt-3">
        <div className="relative rounded border border-border-color overflow-hidden" style={{ height: 120 }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-text-dim bg-bg-base/80">
              Lade Waveform…
            </div>
          )}
          {!sampleUrl && !loading && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-text-dim">
              Kein Sample geladen
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="w-full h-full block cursor-crosshair"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onContextMenu={e => e.preventDefault()}
          />
        </div>
        <p className="text-[10px] text-text-dim mt-1">
          Klick: Marker setzen · Ziehen: Marker verschieben · Rechtsklick: Marker löschen
        </p>
      </div>

      {/* Auto-Slice Toolbar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-color flex-shrink-0 flex-wrap">
        {/* Gleiche Aufteilung */}
        <div className="flex items-center gap-1">
          <select
            value={equalDivisions}
            onChange={e => setEqualDivisions(Number(e.target.value))}
            className="text-[10px] rounded border border-border-color bg-bg-elevated text-text-primary px-1 py-0.5"
          >
            {[4, 8, 12, 16, 24, 32].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            onClick={handleEqualSlice}
            disabled={!sampleUrl}
            className="px-2 py-1 text-[10px] rounded bg-accent-secondary/20 text-accent-secondary hover:bg-accent-secondary/30 disabled:opacity-40 transition-colors"
          >
            ÷ Gleichmäßig
          </button>
        </div>

        {/* Transient Detection */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-dim">Sens:</span>
          <input
            type="range" min={0.05} max={0.5} step={0.01}
            value={sensitivity}
            onChange={e => setSensitivity(Number(e.target.value))}
            className="w-20 accent-accent-primary"
          />
          <span className="text-[10px] text-text-dim w-6">{Math.round(sensitivity * 100)}%</span>
          <button
            onClick={handleTransientSlice}
            disabled={!sampleUrl || loading}
            className="px-2 py-1 text-[10px] rounded bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-40 transition-colors"
          >
            ⚡ Transients
          </button>
        </div>

        <div className="flex-1" />

        {/* Alle löschen */}
        <button
          onClick={() => { /* onClearSlices */ }}
          className="px-2 py-1 text-[10px] rounded text-text-dim hover:text-accent-danger transition-colors"
        >
          Alle löschen
        </button>

        {/* Warp Markers */}
        <div className="flex items-center gap-1.5 border-l border-border-color pl-3">
          <span className="text-[10px] text-text-dim">Warp BPM:</span>
          <input type="number" min={60} max={200} value={warpBpm || ""}
            placeholder="z.B. 130"
            onChange={e => setWarpBpm(Number(e.target.value))}
            className="w-16 text-[10px] bg-bg-elevated border border-border-color rounded px-1.5 py-0.5 text-text-primary" />
          <button onClick={() => setWarpSnap(p => !p)}
            className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${warpSnap ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-color text-text-dim"}`}
            title="Marker an Beat-Grid einrasten">
            ⊞ Snap
          </button>
        </div>

        {/* Export */}
        {onExportToDrumMachine && (
          <button
            onClick={handleExport}
            disabled={slices.length === 0}
            className="px-3 py-1 text-[10px] rounded bg-accent-success text-white hover:opacity-80 disabled:opacity-40 transition-opacity font-bold"
          >
            → DrumMachine exportieren
          </button>
        )}
      </div>

      {/* Slice-Liste */}
      <div className="flex-1 overflow-y-auto p-3">
        {slices.length === 0 ? (
          <div className="text-xs text-text-dim text-center py-8">
            Noch keine Slices. Klicke auf die Waveform oder nutze Auto-Slice.
          </div>
        ) : (
          <div className="space-y-1">
            {slices.map((slice, i) => {
              const buf = audioBufferRef.current;
              const durFrames = slice.endOffset - slice.startOffset;
              const durSec = buf ? durFrames / buf.sampleRate : 0;
              const isPlaying = playingSlice === i;

              return (
                <div
                  key={slice.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border transition-colors ${
                    isPlaying
                      ? "border-accent-primary bg-accent-primary/10"
                      : hoveredSlice === i
                        ? "border-accent-secondary/40 bg-accent-secondary/5"
                        : "border-border-color hover:border-border-subtle bg-bg-elevated"
                  }`}
                >
                  {/* Index + Play */}
                  <button
                    onClick={() => previewSlice(slice, i)}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors"
                    style={{
                      background: isPlaying ? "var(--ss-accent-primary)" : "var(--ss-bg-panel)",
                      color: isPlaying ? "white" : "var(--ss-text-muted)",
                      border: `1px solid ${isPlaying ? "var(--ss-accent-primary)" : "var(--ss-border)"}`,
                    }}
                    title="Slice abspielen"
                  >
                    {isPlaying ? "■" : i + 1}
                  </button>

                  {/* Name */}
                  <input
                    value={slice.name ?? `Slice ${i + 1}`}
                    onChange={e => onUpdateSlice(slice.id, { name: e.target.value })}
                    className="w-24 bg-transparent text-xs text-text-primary border-none outline-none"
                  />

                  {/* Dauer */}
                  <span className="text-[10px] text-text-dim font-mono w-12 text-right">
                    {durSec.toFixed(3)}s
                  </span>

                  {/* Loop-Mode */}
                  <select
                    value={slice.loopMode}
                    onChange={e => onUpdateSlice(slice.id, { loopMode: e.target.value as SliceRegion["loopMode"] })}
                    className="text-[10px] rounded border border-border-color bg-bg-panel text-text-muted px-1 py-0.5"
                  >
                    <option value="one-shot">One Shot</option>
                    <option value="loop">Loop</option>
                    <option value="ping-pong">Ping Pong</option>
                  </select>

                  {/* Reverse */}
                  <label className="flex items-center gap-1 text-[10px] text-text-dim cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={slice.reverse}
                      onChange={e => onUpdateSlice(slice.id, { reverse: e.target.checked })}
                      className="accent-accent-primary"
                    />
                    Rev
                  </label>

                  {/* Löschen */}
                  <button
                    onClick={() => onRemoveSlice(slice.id)}
                    className="ml-auto text-text-dim hover:text-accent-danger text-lg leading-none transition-colors"
                    title="Slice löschen"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
