/**
 * Synthstudio – Humanizer Komponente
 *
 * UI für den Smart Humanizer: Swing, Velocity-Jitter, Timing-Jitter und Groove-Presets.
 * Kompaktes Panel-Design für die Integration in die Transport-Leiste oder als Sidebar.
 */
import React, { useState } from "react";
import type { HumanizerState, HumanizerActions } from "@/store/useHumanizerStore";

interface HumanizerProps {
  humanizer: HumanizerState & HumanizerActions;
  className?: string;
}

// ─── Slider-Komponente ────────────────────────────────────────────────────────

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (v: number) => string;
  color?: string;
  disabled?: boolean;
}

function HumanizerSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  color = "cyan",
  disabled = false,
}: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={`flex flex-col gap-1 ${disabled ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
        <span className={`text-[10px] font-mono text-${color}-400`}>
          {formatValue ? formatValue(value) : value.toFixed(2)}
        </span>
      </div>
      <div className="relative h-1.5 bg-slate-800 rounded-full">
        <div
          className={`absolute left-0 top-0 h-full bg-${color}-500 rounded-full transition-all`}
          style={{ width: `${percentage}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export function Humanizer({ humanizer, className = "" }: HumanizerProps) {
  const [expanded, setExpanded] = useState(false);
  const { global: settings, presets } = humanizer;

  const swingPercent = Math.round(50 + settings.swing * 50);

  return (
    <div className={`bg-[#0d0d0d] border border-slate-800 rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <button
          onClick={humanizer.toggleEnabled}
          className={[
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
            settings.enabled
              ? "bg-cyan-600 border-cyan-400"
              : "bg-transparent border-slate-600 hover:border-slate-400",
          ].join(" ")}
          title="Humanizer ein/ausschalten"
        >
          {settings.enabled && <span className="text-[8px] text-white">✓</span>}
        </button>

        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Humanizer
        </span>

        {settings.preset && (
          <span className="text-[10px] text-cyan-600 ml-1">{settings.preset}</span>
        )}

        <div className="flex-1" />

        {/* Kompakt-Anzeige */}
        {!expanded && settings.enabled && (
          <div className="flex items-center gap-2 text-[10px] text-slate-600">
            <span>Swing {swingPercent}%</span>
            <span>Vel {Math.round(settings.velocityJitter * 100)}%</span>
          </div>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-slate-600 hover:text-slate-400 transition-colors text-xs"
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* Expanded Panel */}
      {expanded && (
        <div className="p-3 flex flex-col gap-4">
          {/* Groove-Presets */}
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-2">
              Groove-Presets
            </p>
            <div className="flex flex-wrap gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => humanizer.loadPreset(preset.name)}
                  title={preset.description}
                  className={[
                    "px-2 py-0.5 rounded text-[10px] transition-colors",
                    settings.preset === preset.name
                      ? "bg-cyan-700 text-white"
                      : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-slate-300",
                  ].join(" ")}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Slider */}
          <div className="flex flex-col gap-3">
            <HumanizerSlider
              label="Swing"
              value={settings.swing}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => humanizer.updateGlobal({ swing: v })}
              formatValue={(v) => `${Math.round(50 + v * 50)}%`}
              color="cyan"
              disabled={!settings.enabled}
            />
            <HumanizerSlider
              label="Velocity Jitter"
              value={settings.velocityJitter}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => humanizer.updateGlobal({ velocityJitter: v })}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              color="violet"
              disabled={!settings.enabled}
            />
            <HumanizerSlider
              label="Timing Jitter"
              value={settings.timingJitter}
              min={0}
              max={20}
              step={0.5}
              onChange={(v) => humanizer.updateGlobal({ timingJitter: v })}
              formatValue={(v) => `${v.toFixed(1)}ms`}
              color="emerald"
              disabled={!settings.enabled}
            />
          </div>

          {/* Swing-Modus */}
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                humanizer.updateGlobal({ swingOnEvenSteps: !settings.swingOnEvenSteps })
              }
              disabled={!settings.enabled}
              className={[
                "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                settings.swingOnEvenSteps
                  ? "bg-cyan-600 border-cyan-400"
                  : "bg-transparent border-slate-600",
                !settings.enabled ? "opacity-40 cursor-not-allowed" : "",
              ].join(" ")}
            >
              {settings.swingOnEvenSteps && (
                <span className="text-[8px] text-white">✓</span>
              )}
            </button>
            <span className="text-[10px] text-slate-500">
              Swing nur auf gerade Steps (klassisch)
            </span>
          </div>

          {/* Reset */}
          <button
            onClick={humanizer.reset}
            className="text-[10px] text-slate-700 hover:text-slate-500 transition-colors text-left"
          >
            Zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}
