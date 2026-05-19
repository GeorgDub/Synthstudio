/**
 * AudioFxPanel.tsx — Sprint-106 Synth-FX-Controls.
 *
 * Steuert die SimAudioEngine: Waveform-Selector + Filter (Cutoff, Q)
 * + Delay (Time, Feedback) + Master-Gain. Realtime — Slider-Bewegung
 * wirkt sofort auf das Audio-Signal.
 *
 * localStorage persistiert die Settings damit dein Sound-Setup
 * Reload-überlebt. Initial werden die Defaults der SimAudioEngine
 * verwendet.
 */

import { useEffect, useState, type ReactElement } from "react";

import {
  simAudioEngine, type Waveform, type AudioFxSettings,
} from "../../audio/SimAudioEngine";
import {
  loadAudioFxCache, saveAudioFxCache,
} from "../../utils/audioFxCache";

const WAVEFORMS: { id: Waveform; label: string; symbol: string }[] = [
  { id: "sine",     label: "Sine",     symbol: "∿" },
  { id: "sawtooth", label: "Saw",      symbol: "⩘" },
  { id: "square",   label: "Square",   symbol: "⊓" },
  { id: "triangle", label: "Triangle", symbol: "△" },
];

export interface AudioFxPanelProps {
  /** Optional — nur fuer Live-Status-Anzeige. Controls bleiben immer aktiv
   * damit der User Settings vor dem Audio-Enable konfigurieren kann. */
  audioEnabled?: boolean;
}

export function AudioFxPanel({ audioEnabled = false }: AudioFxPanelProps): ReactElement {
  const [settings, setSettings] = useState<AudioFxSettings>(() => loadAudioFxCache());

  // Settings immer auf die Engine pushen — wenn nicht enabled, NO-OP intern.
  useEffect(() => {
    simAudioEngine.applySettings(settings);
  }, [settings]);

  // localStorage Auto-Save
  useEffect(() => {
    saveAudioFxCache(settings);
  }, [settings]);

  function update<K extends keyof AudioFxSettings>(
    key: K, value: AudioFxSettings[K],
  ): void {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4 space-y-3"
      data-testid="audio-fx-panel"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Synth FX</h3>
        <span className="text-[10px] text-text-dim">
          {audioEnabled ? "Live → Engine" : "Audio off"}
        </span>
      </div>

      {/* Waveform-Selector */}
      <div>
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          Waveform
        </span>
        <div
          className="mt-1 grid grid-cols-4 gap-1"
          role="radiogroup"
          aria-label="Waveform"
        >
          {WAVEFORMS.map((w) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={settings.waveform === w.id}
              onClick={() => update("waveform", w.id)}
              data-testid={`fx-wave-${w.id}`}
              title={w.label}
              className={[
                "px-2 py-1 rounded text-xs border transition-colors",
                settings.waveform === w.id
                  ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                  : "bg-bg-elevated border-border-color text-text-muted hover:text-text-primary",
              ].filter(Boolean).join(" ")}
            >
              <span className="mr-1">{w.symbol}</span>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter */}
      <FxSlider
        label="Filter Cutoff"
        value={settings.filterCutoffHz}
        min={40}
        max={20000}
        step={10}
        suffix="Hz"
        format={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`}
        disabled={false}
        testId="fx-cutoff"
        onChange={(v) => update("filterCutoffHz", v)}
      />
      <FxSlider
        label="Filter Q"
        value={settings.filterQ}
        min={0.1}
        max={20}
        step={0.1}
        suffix=""
        format={(v) => v.toFixed(1)}
        disabled={false}
        testId="fx-q"
        onChange={(v) => update("filterQ", v)}
      />

      {/* Delay */}
      <FxSlider
        label="Delay Time"
        value={settings.delayTimeS}
        min={0}
        max={1.5}
        step={0.01}
        suffix="s"
        format={(v) => v.toFixed(2)}
        disabled={false}
        testId="fx-delay-time"
        onChange={(v) => update("delayTimeS", v)}
      />
      <FxSlider
        label="Delay Feedback"
        value={settings.delayFeedback}
        min={0}
        max={0.95}
        step={0.01}
        suffix=""
        format={(v) => `${Math.round(v * 100)}%`}
        disabled={false}
        testId="fx-delay-fb"
        onChange={(v) => update("delayFeedback", v)}
      />

      {/* Master */}
      <FxSlider
        label="Master Gain"
        value={settings.masterGain}
        min={0}
        max={1}
        step={0.01}
        suffix=""
        format={(v) => `${Math.round(v * 100)}%`}
        disabled={false}
        testId="fx-master"
        onChange={(v) => update("masterGain", v)}
      />

      <p className="text-[10px] text-text-dim leading-snug">
        Realtime — Bewegung wirkt sofort. Audio-Output muss in der
        Sim-Loopback-Sektion oben "On" sein.
      </p>
    </div>
  );
}

interface FxSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  format: (v: number) => string;
  disabled: boolean;
  testId: string;
  onChange: (v: number) => void;
}

function FxSlider({
  label, value, min, max, step, suffix, format, disabled, testId, onChange,
}: FxSliderProps): ReactElement {
  return (
    <label className="block">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          {label}
        </span>
        <span
          className="text-[10px] text-text-muted font-mono"
          data-testid={`${testId}-display`}
        >
          {format(value)}{suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid={testId}
        className="w-full"
      />
    </label>
  );
}
