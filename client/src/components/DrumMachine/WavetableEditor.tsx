/**
 * Synthstudio – WavetableEditor
 *
 * Canvas-basierter Editor zum Zeichnen eigener Oszillator-Wellenformen.
 * Die gezeichnete Kurve wird als PeriodicWave (FFT-Koeffizienten) exportiert
 * und kann im SynthPanel als "custom" Wellenform genutzt werden.
 *
 * Interaktion:
 *  - Klick/Drag: Amplitude setzen
 *  - Reset: Sinus-Wellenform
 *  - Presets: Sine, Square, Sawtooth, Triangle
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export interface WavetableEditorProps {
  /** Wird aufgerufen wenn die Wellenform gespeichert wird */
  onSave: (waveData: Float32Array) => void;
  onClose: () => void;
  /** Initiale Wellenform (falls vorhanden) */
  initialData?: Float32Array;
}

const WAVE_SIZE = 256;

function buildPreset(type: "sine" | "square" | "sawtooth" | "triangle"): Float32Array {
  const data = new Float32Array(WAVE_SIZE);
  for (let i = 0; i < WAVE_SIZE; i++) {
    const t = (i / WAVE_SIZE) * 2 * Math.PI;
    switch (type) {
      case "sine":     data[i] = Math.sin(t); break;
      case "square":   data[i] = t < Math.PI ? 1 : -1; break;
      case "sawtooth": data[i] = (i / WAVE_SIZE) * 2 - 1; break;
      case "triangle": data[i] = t < Math.PI ? t / (Math.PI / 2) - 1 : 3 - t / (Math.PI / 2); break;
    }
  }
  return data;
}

export function WavetableEditor({ onSave, onClose, initialData }: WavetableEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveData, setWaveData] = useState<Float32Array>(() =>
    initialData ?? buildPreset("sine")
  );
  const isDragging = useRef(false);

  // Canvas neu zeichnen
  const redraw = useCallback((data: Float32Array) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    const midY = h / 2;

    const bg      = getComputedStyle(document.documentElement).getPropertyValue("--ss-bg-base").trim() || "#0a0a0a";
    const accent  = getComputedStyle(document.documentElement).getPropertyValue("--ss-accent-primary").trim() || "#f59e0b";
    const gridCol = getComputedStyle(document.documentElement).getPropertyValue("--ss-border").trim() || "#2a2a3a";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = gridCol;
    ctx.lineWidth = devicePixelRatio;
    ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 4, 0); ctx.lineTo(w / 4, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 3 / 4, 0); ctx.lineTo(w * 3 / 4, h); ctx.stroke();
    ctx.setLineDash([]);

    // Wellenform
    ctx.strokeStyle = accent;
    ctx.lineWidth = devicePixelRatio * 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let i = 0; i < WAVE_SIZE; i++) {
      const x = (i / WAVE_SIZE) * w;
      const y = midY - data[i] * midY * 0.9;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, []);

  useEffect(() => { redraw(waveData); }, [waveData, redraw]);

  const getSample = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const xRatio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const yRatio = Math.max(-1, Math.min(1, 1 - (clientY - rect.top) / rect.height * 2));
    const idx = Math.floor(xRatio * WAVE_SIZE);
    return { idx, value: yRatio };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    const s = getSample(e.clientX, e.clientY);
    if (!s) return;
    const next = new Float32Array(waveData);
    next[s.idx] = s.value;
    setWaveData(next);
    redraw(next);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const s = getSample(e.clientX, e.clientY);
    if (!s) return;
    const next = new Float32Array(waveData);
    next[s.idx] = s.value;
    setWaveData(next);
    redraw(next);
  };

  const handleMouseUp = () => { isDragging.current = false; };

  const applyPreset = (type: "sine" | "square" | "sawtooth" | "triangle") => {
    const data = buildPreset(type);
    setWaveData(data);
    redraw(data);
  };

  const handleSave = () => {
    onSave(waveData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg-panel border border-border-color rounded-xl shadow-2xl w-[520px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center px-5 py-4 border-b border-border-color">
          <h2 className="text-sm font-bold text-text-primary">Wavetable Editor</h2>
          <p className="ml-3 text-xs text-text-dim flex-1">Klick/Drag zum Zeichnen</p>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded flex items-center justify-center transition-colors"
            aria-label="Close"
            title="Schließen"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Canvas */}
        <div className="p-4">
          <canvas
            ref={canvasRef}
            className="w-full rounded border border-border-color cursor-crosshair block"
            style={{ height: 180 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        </div>

        {/* Presets + Actions */}
        <div className="flex items-center gap-2 px-4 pb-4 flex-wrap">
          <span className="text-[10px] text-text-dim">Presets:</span>
          {(["sine", "square", "sawtooth", "triangle"] as const).map(t => (
            <button key={t} onClick={() => applyPreset(t)}
              className="px-2 py-0.5 text-[10px] rounded bg-bg-elevated text-text-muted hover:text-text-primary border border-border-color capitalize transition-colors">
              {t}
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={handleSave}
            className="px-4 py-1.5 text-xs rounded bg-accent-primary text-white hover:opacity-80 font-bold transition-opacity">
            ✓ Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
