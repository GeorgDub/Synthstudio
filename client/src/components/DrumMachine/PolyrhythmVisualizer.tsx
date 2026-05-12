/**
 * Synthstudio – PolyrhythmVisualizer
 *
 * Visualisiert alle Parts mit ihren polyrhythmischen Step-Längen gleichzeitig.
 * Jede Zeile zeigt einen Part als horizontale Step-Reihe; Parts mit eigenem
 * stepLength werden proportional kürzer dargestellt.
 *
 * Verwendung: Im Song-Tab oder als optionales Panel unterhalb der DrumMachine.
 */
import React from "react";
import type { PatternData } from "@/audio/AudioEngine";

interface PolyrhythmVisualizerProps {
  pattern: PatternData | undefined;
  currentStep: number;
}

const PART_COLORS = [
  "#f59e0b","#06b6d4","#10b981","#f43f5e",
  "#a855f7","#ff6b35","#0ea5e9","#84cc16","#ec4899",
];

export function PolyrhythmVisualizer({ pattern, currentStep }: PolyrhythmVisualizerProps) {
  if (!pattern) return null;

  const maxSteps = pattern.stepCount;

  return (
    <div className="p-3 bg-bg-base rounded border border-border-color">
      <div className="text-[10px] text-text-dim uppercase tracking-widest mb-2">
        Polyrhythm — {pattern.name}
      </div>

      <div className="space-y-1">
        {pattern.parts.map((part, pi) => {
          const partLength = part.stepLength ?? maxSteps;
          const color = PART_COLORS[pi % PART_COLORS.length];
          const widthPct = (partLength / maxSteps) * 100;
          const effCurrentStep = currentStep % partLength;

          return (
            <div key={part.id} className="flex items-center gap-2">
              {/* Part-Name */}
              <div className="w-20 text-[9px] text-text-dim truncate flex-shrink-0" title={part.name}>
                {part.name}
                {part.stepLength && (
                  <span className="ml-1 font-mono" style={{ color }}>×{part.stepLength}</span>
                )}
              </div>

              {/* Step-Grid */}
              <div className="flex-1 flex gap-px" style={{ opacity: part.muted ? 0.3 : 1 }}>
                <div style={{ width: `${widthPct}%` }} className="flex gap-px">
                  {Array.from({ length: partLength }, (_, i) => {
                    const step = part.steps[i];
                    const isActive  = step?.active ?? false;
                    const isCurrent = i === effCurrentStep && pattern.stepCount > 0;

                    return (
                      <div key={i}
                        className="flex-1 rounded-sm transition-all duration-75"
                        style={{
                          height: 12,
                          background: isCurrent
                            ? "white"
                            : isActive
                              ? color
                              : "var(--ss-bg-elevated)",
                          opacity: isActive || isCurrent ? 1 : 0.3,
                          boxShadow: isCurrent ? `0 0 4px ${color}` : "none",
                        }}
                      />
                    );
                  })}
                </div>
                {/* Grauer Bereich wo Part kürzer als Pattern */}
                {partLength < maxSteps && (
                  <div style={{ width: `${100 - widthPct}%` }}
                    className="border-l border-dashed border-border-color/30 flex gap-px">
                    {Array.from({ length: maxSteps - partLength }, (_, i) => (
                      <div key={i} className="flex-1 rounded-sm"
                        style={{ height: 12, background: "var(--ss-bg-elevated)", opacity: 0.1 }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Part-Länge Indikator */}
              <div className="w-8 text-[9px] font-mono text-text-dim text-right flex-shrink-0">
                {partLength}
              </div>
            </div>
          );
        })}
      </div>

      {/* Polyrhythm-Info */}
      {pattern.parts.some(p => p.stepLength && p.stepLength !== maxSteps) && (
        <div className="mt-2 pt-2 border-t border-border-color text-[9px] text-text-dim">
          Polyrhythmus aktiv: Parts mit verschiedenen Längen ergeben sich wiederholende Muster.
        </div>
      )}
    </div>
  );
}
