/**
 * Synthstudio – Humanizer Komponente
 *
 * UI für den Smart Humanizer: Swing, Velocity-Jitter, Timing-Jitter und Groove-Presets.
 * Kompaktes Panel-Design für die Integration in die Transport-Leiste oder als Sidebar.
 */
import React, { useState } from "react";
import type { HumanizerState, HumanizerActions } from "@/store/useHumanizerStore";
import { GROOVE_TEMPLATES, templateSwingPercent } from "@/utils/grooveEngine";

interface HumanizerProps {
  humanizer: HumanizerState & HumanizerActions;
  className?: string;
}

// ─── Slider-Komponente ────────────────────────────────────────────────────────

/**
 * Slider-Akzent. Semantische Token statt hardcodierter Tailwind-Paletten,
 * damit der Slider mit jedem aktiven Theme korrekt einfärbt.
 */
type SliderAccent = "primary" | "secondary" | "success";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  formatValue?: (v: number) => string;
  accent?: SliderAccent;
  disabled?: boolean;
}

// Statische Klassen-Tabellen, damit Tailwind JIT die Klassen findet.
const ACCENT_TEXT: Record<SliderAccent, string> = {
  primary:   "text-accent-primary",
  secondary: "text-accent-secondary",
  success:   "text-accent-success",
};
const ACCENT_BG: Record<SliderAccent, string> = {
  primary:   "bg-accent-primary",
  secondary: "bg-accent-secondary",
  success:   "bg-accent-success",
};

function HumanizerSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  accent = "primary",
  disabled = false,
}: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className={`flex flex-col gap-1 ${disabled ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-dim uppercase tracking-wide">{label}</span>
        <span className={`text-[10px] font-mono ${ACCENT_TEXT[accent]}`}>
          {formatValue ? formatValue(value) : value.toFixed(2)}
        </span>
      </div>
      <div className="relative h-1.5 bg-bg-elevated rounded-full">
        <div
          className={`absolute left-0 top-0 h-full ${ACCENT_BG[accent]} rounded-full transition-all`}
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
    <div className={`bg-bg-panel border border-border-color rounded-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-color">
        <button
          onClick={humanizer.toggleEnabled}
          className={[
            "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
            settings.enabled
              ? "bg-accent-primary border-accent-secondary"
              : "bg-transparent border-border-color hover:border-text-muted",
          ].join(" ")}
          title="Humanizer ein/ausschalten"
        >
          {settings.enabled && <span className="text-[8px] text-bg-base">✓</span>}
        </button>

        <span className="text-xs font-bold text-text-muted uppercase tracking-widest">
          Humanizer
        </span>

        {settings.preset && (
          <span className="text-[10px] text-accent-primary ml-1">{settings.preset}</span>
        )}

        <div className="flex-1" />

        {/* Kompakt-Anzeige */}
        {!expanded && settings.enabled && (
          <div className="flex items-center gap-2 text-[10px] text-text-dim">
            <span>Swing {swingPercent}%</span>
            <span>Vel {Math.round(settings.velocityJitter * 100)}%</span>
          </div>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-text-dim hover:text-text-muted transition-colors text-xs"
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* Expanded Panel */}
      {expanded && (
        <div className="p-3 flex flex-col gap-4">
          {/* Groove-Presets (Humanizer-eigene) */}
          <div>
            <p className="text-[10px] text-text-dim uppercase tracking-wide mb-2">
              Groove-Presets
            </p>
            <div className="flex flex-wrap gap-1 mb-2">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => humanizer.loadPreset(preset.name)}
                  title={preset.description}
                  className={[
                    "px-2 py-0.5 rounded text-[10px] transition-colors",
                    // Nicht highlighten, wenn eine gleichnamige Groove-Vorlage aktiv ist
                    settings.preset === preset.name && !settings.grooveTemplateId
                      ? "bg-accent-primary/70 text-bg-base"
                      : "bg-bg-elevated text-text-dim hover:text-text-primary ",
                  ].join(" ")}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            {/* Groove Engine Templates */}
            <p className="text-[10px] text-text-dim uppercase tracking-wide mb-1 mt-2">
              Groove Engine (Swing-Vorlagen)
            </p>
            <div className="flex flex-wrap gap-1">
              {GROOVE_TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => humanizer.loadGrooveTemplate(tmpl.id)}
                  title={`${tmpl.description} (${tmpl.bpm} BPM Referenz, ${templateSwingPercent(tmpl)}% Swing)`}
                  className={[
                    "px-2 py-0.5 rounded text-[10px] transition-colors border",
                    settings.grooveTemplateId === tmpl.id
                      ? "border-accent-secondary bg-accent-secondary/20 text-accent-secondary"
                      : "border-border-color text-text-dim hover:text-text-primary",
                  ].join(" ")}
                >
                  {tmpl.name}
                </button>
              ))}
            </div>

            {/* Groove-Intensität — nur sichtbar wenn eine Vorlage aktiv ist */}
            {settings.grooveTemplateId && (
              <div className="mt-2">
                <HumanizerSlider
                  label="Groove-Intensität"
                  value={settings.grooveAmount ?? 1}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => humanizer.setGrooveAmount(v)}
                  formatValue={(v) => `${Math.round(v * 100)}%`}
                  accent="secondary"
                  disabled={!settings.enabled}
                />
              </div>
            )}
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
              accent="primary"
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
              accent="secondary"
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
              accent="success"
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
                  ? "bg-accent-primary border-accent-secondary"
                  : "bg-transparent border-border-color",
                !settings.enabled ? "opacity-40 cursor-not-allowed" : "",
              ].join(" ")}
            >
              {settings.swingOnEvenSteps && (
                <span className="text-[8px] text-bg-base">✓</span>
              )}
            </button>
            <span className="text-[10px] text-text-dim">
              Swing nur auf gerade Steps (klassisch)
            </span>
          </div>

          {/* Reset */}
          <button
            onClick={humanizer.reset}
            className="text-[10px] text-text-dim hover:text-text-dim transition-colors text-left"
          >
            Zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}
