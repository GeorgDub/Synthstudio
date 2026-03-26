/**
 * PatternLaunchPad.tsx – Vollbild Performance Mode View
 * Phase 4: Performance Mode / Live View
 */
import React, { useEffect } from "react";
import type { PerformancePad } from "@/store/usePerformanceStore";

interface PatternLaunchPadProps {
  pads: PerformancePad[];
  activePatternId: string;
  queuedPatternId: string | null;
  quantizeMode: "bar" | "beat" | "step";
  bpm: number;
  currentStep: number;
  onPadClick: (patternId: string) => void;
  onQuantizeModeChange: (mode: "bar" | "beat" | "step") => void;
  onClose: () => void;
}

const PAD_COLORS = [
  "#22d3ee", "#a78bfa", "#34d399", "#f87171",
  "#fb923c", "#facc15", "#60a5fa", "#e879f9",
  "#4ade80", "#f472b6", "#2dd4bf", "#fbbf24",
  "#818cf8", "#f97316", "#86efac", "#c084fc",
];

export function PatternLaunchPad({
  pads,
  activePatternId,
  queuedPatternId,
  quantizeMode,
  bpm,
  currentStep,
  onPadClick,
  onQuantizeModeChange,
  onClose,
}: PatternLaunchPadProps) {
  // ESC schließt Performance Mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800">
        <div className="flex items-center gap-4">
          <span className="text-cyan-400 font-bold text-lg tracking-wider">PERFORMANCE MODE</span>
          <span className="text-slate-400 font-mono text-sm">{bpm} BPM</span>
          <div className="flex gap-1">
            {["bar", "beat", "step"].map(mode => (
              <button
                key={mode}
                onClick={() => onQuantizeModeChange(mode as "bar" | "beat" | "step")}
                className={`px-2 py-1 rounded text-xs font-mono uppercase transition-colors ${
                  quantizeMode === mode
                    ? "bg-cyan-700 text-white"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white text-sm flex items-center gap-1"
          title="ESC"
        >
          ESC ×
        </button>
      </div>

      {/* 4×4 Pad Grid */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="grid grid-cols-4 gap-4 w-full max-w-2xl">
          {Array.from({ length: 16 }, (_, i) => {
            const pad = pads[i];
            const patternId = pad?.patternId ?? `__empty_${i}`;
            const isActive = patternId === activePatternId;
            const isQueued = patternId === queuedPatternId;
            const color = pad?.color ?? PAD_COLORS[i] ?? "#334155";

            return (
              <button
                key={i}
                disabled={!pad}
                onClick={() => pad && onPadClick(patternId)}
                title={pad?.label ?? (pad ? `Pattern ${i + 1}` : "Leer")}
                style={{
                  backgroundColor: pad ? (isActive ? color : `${color}33`) : undefined,
                  borderColor: isQueued ? color : (isActive ? color : "transparent"),
                  boxShadow: isActive ? `0 0 20px ${color}66` : undefined,
                }}
                className={`
                  aspect-square rounded-xl text-sm font-bold transition-all duration-100
                  border-2 flex items-center justify-center
                  ${pad
                    ? "cursor-pointer hover:brightness-125 active:scale-95"
                    : "bg-slate-900 cursor-default opacity-30"
                  }
                  ${isQueued ? "animate-pulse" : ""}
                `}
              >
                <div className="text-center">
                  <div
                    className="text-white text-xs leading-tight truncate px-1"
                    style={{ color: isActive ? "white" : `${color}cc` }}
                  >
                    {pad?.label ?? (pad ? `P${i + 1}` : "")}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step-Indikator */}
      <div className="px-6 py-3 border-t border-slate-800 flex items-center gap-2">
        <span className="text-slate-600 text-xs">STEP</span>
        <div className="flex gap-0.5">
          {Array.from({ length: 16 }, (_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentStep % 16 ? "bg-cyan-400" : "bg-slate-800"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
