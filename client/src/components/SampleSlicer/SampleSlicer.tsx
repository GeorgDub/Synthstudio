/**
 * SampleSlicer.tsx – Modal für Sample-Slicing
 * Phase 3: Sample Slicer & Loop Manager
 */
import React, { useCallback, useRef } from "react";
import type { SliceRegion } from "@/store/useSampleSlicerStore";
import type { TransientMarker } from "@/utils/transientDetection";
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
}

export function SampleSlicer({
  sampleUrl,
  audioDuration,
  slices,
  onAddSlice,
  onRemoveSlice,
  onUpdateSlice,
  onAutoSlice,
  onClose,
}: SampleSlicerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleAutoSlice = useCallback(async () => {
    if (!sampleUrl) return;
    try {
      const ctx = new AudioContext();
      const response = await fetch(sampleUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const markers: TransientMarker[] = detectTransients(audioBuffer, 0.15, 50);
      onAutoSlice(
        markers.map(m => m.sampleOffset),
        audioBuffer.length,
        audioBuffer.sampleRate
      );
      await ctx.close();
    } catch (err) {
      console.error("Auto-Slice fehlgeschlagen:", err);
    }
  }, [sampleUrl, onAutoSlice]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-3/4 max-w-3xl p-5 text-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-cyan-400">Sample Slicer</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Waveform-Canvas (Platzhalter) */}
        <div className="relative mb-4 bg-slate-800 rounded-lg h-32 overflow-hidden">
          <canvas ref={canvasRef} className="w-full h-full" />
          {!sampleUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-600 text-sm">
              Kein Sample geladen
            </div>
          )}
          {/* Slice-Marker */}
          {slices.map(slice => {
            const leftPct = audioDuration > 0
              ? (slice.startOffset / (audioDuration * 44100)) * 100
              : 0;
            return (
              <div
                key={slice.id}
                className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 cursor-ew-resize"
                style={{ left: `${leftPct}%` }}
                title={slice.name ?? "Slice"}
              />
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleAutoSlice}
            disabled={!sampleUrl}
            className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 rounded text-sm font-semibold"
          >
            Auto-Slice
          </button>
          <button
            onClick={() => onAddSlice({ startOffset: 0, endOffset: 0, loopMode: "one-shot", reverse: false })}
            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm"
          >
            + Slice
          </button>
        </div>

        {/* Slice-Liste */}
        <div className="max-h-48 overflow-y-auto space-y-1">
          {slices.length === 0 && (
            <div className="text-slate-600 text-sm py-4 text-center">
              Noch keine Slices. „Auto-Slice" oder manuell hinzufügen.
            </div>
          )}
          {slices.map((slice, i) => (
            <div
              key={slice.id}
              className="flex items-center gap-2 bg-slate-800 rounded px-3 py-1.5 text-sm"
            >
              <span className="text-slate-400 w-6 text-right">{i + 1}</span>
              <span className="flex-1 font-mono text-xs text-slate-300">
                {slice.name ?? `Slice ${i + 1}`}
              </span>
              <select
                value={slice.loopMode}
                onChange={e =>
                  onUpdateSlice(slice.id, { loopMode: e.target.value as SliceRegion["loopMode"] })
                }
                className="bg-slate-700 rounded px-1 py-0.5 text-xs"
              >
                <option value="one-shot">One-Shot</option>
                <option value="loop">Loop</option>
                <option value="ping-pong">Ping-Pong</option>
              </select>
              <label className="flex items-center gap-1 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={slice.reverse}
                  onChange={e => onUpdateSlice(slice.id, { reverse: e.target.checked })}
                  className="accent-cyan-500"
                />
                Rev
              </label>
              <button
                onClick={() => onRemoveSlice(slice.id)}
                className="text-slate-600 hover:text-red-400 text-lg leading-none px-1"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
