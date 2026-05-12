/**
 * SynthPanel.tsx – Synthesizer-Parameter-Panel (Wavetable / FM)
 * Phase 5: Wavetable / FM Synthesizer Engine
 */
import React, { useState } from "react";
import { X } from "lucide-react";
import type { SynthParams, LfoWaveform, LfoBpmRate } from "@/audio/SynthEngine";
import { DEFAULT_SYNTH_PARAMS, LFO_WAVEFORM_LABELS } from "@/audio/SynthEngine";
import { WavetableEditor } from "./WavetableEditor";

const LFO_BPM_RATES: LfoBpmRate[] = ["free", "1/1", "1/2", "1/4", "1/8", "1/16", "1/32", "1/64"];

interface SynthPanelProps {
  partId: string;
  params: SynthParams;
  onChange: (params: SynthParams) => void;
  onClose?: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-text-muted text-xs w-16 shrink-0">{label}</span>
      {children}
    </div>
  );
}

function KnobSlider({
  value, min, max, step = 0.01, onChange, unit = "",
}: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <div className="flex items-center gap-1.5 flex-1">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-accent-primary"
      />
      <span className="font-mono text-accent-secondary text-xs w-12 text-right">
        {value.toFixed(step < 1 ? 2 : 0)}{unit}
      </span>
    </div>
  );
}

export function SynthPanel({ partId, params, onChange, onClose }: SynthPanelProps) {
  const set = (update: Partial<SynthParams>) => onChange({ ...params, ...update });
  const [showWavetableEditor, setShowWavetableEditor] = useState(false);

  return (
    <div className="bg-bg-panel border border-border-color rounded-lg p-3 text-text-primary min-w-[260px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-accent-secondary uppercase tracking-wider">
          Synthesizer
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary p-1 rounded flex items-center justify-center transition-colors"
            aria-label="Close"
            title="Schließen"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Mode */}
      <Row label="Mode">
        <div className="flex gap-1 flex-1">
          {(["wavetable", "fm"] as const).map(mode => (
            <button
              key={mode}
              onClick={() => set({ mode })}
              className={`flex-1 py-0.5 rounded text-xs font-mono uppercase transition-colors ${
                params.mode === mode
                  ? "bg-accent-primary/70 text-white"
                  : "bg-bg-elevated hover:bg-bg-elevated text-text-muted"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </Row>

      {/* Wavetable: Osc-Typ + Detune */}
      {params.mode === "wavetable" && (
        <>
          <Row label="Osc">
            <select
              value={params.oscType}
              onChange={e => set({ oscType: e.target.value as SynthParams["oscType"] })}
              className="flex-1 bg-bg-elevated rounded px-1.5 py-0.5 text-xs"
            >
              {(["sine", "sawtooth", "square", "triangle"] as const).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value="custom">Custom ✏</option>
            </select>
          </Row>
          {params.oscType === "custom" && (
            <Row label="">
              <button onClick={() => setShowWavetableEditor(true)}
                className="text-xs text-accent-secondary hover:underline">
                ✏ Wellenform bearbeiten
              </button>
            </Row>
          )}
          <Row label="Detune">
            <KnobSlider value={params.detune} min={-100} max={100} step={1} unit="¢" onChange={v => set({ detune: v })} />
          </Row>
        </>
      )}

      {/* FM: Ratio + Depth */}
      {params.mode === "fm" && (
        <>
          <Row label="FM Ratio">
            <KnobSlider value={params.fmRatio} min={0.1} max={10} step={0.1} onChange={v => set({ fmRatio: v })} />
          </Row>
          <Row label="FM Depth">
            <KnobSlider value={params.fmDepth} min={0} max={1000} step={10} unit="Hz" onChange={v => set({ fmDepth: v })} />
          </Row>
        </>
      )}

      {/* ADSR */}
      <div className="text-text-dim text-[10px] uppercase tracking-wider mt-2 mb-1">ADSR</div>
      <Row label="Attack">
        <KnobSlider value={params.attack} min={0.001} max={2} step={0.001} unit="s" onChange={v => set({ attack: v })} />
      </Row>
      <Row label="Decay">
        <KnobSlider value={params.decay} min={0.001} max={2} step={0.001} unit="s" onChange={v => set({ decay: v })} />
      </Row>
      <Row label="Sustain">
        <KnobSlider value={params.sustain} min={0} max={1} step={0.01} onChange={v => set({ sustain: v })} />
      </Row>
      <Row label="Release">
        <KnobSlider value={params.release} min={0.001} max={5} step={0.001} unit="s" onChange={v => set({ release: v })} />
      </Row>

      {/* Glide */}
      <div className="text-text-dim text-[10px] uppercase tracking-wider mt-2 mb-1">Glide</div>
      <Row label="Portamento">
        <KnobSlider value={params.glide ?? 0} min={0} max={2} step={0.01} unit="s"
          onChange={v => set({ glide: v })} />
      </Row>

      {/* LFO */}
      <div className="text-text-dim text-[10px] uppercase tracking-wider mt-2 mb-1">LFO</div>
      <Row label="LFO">
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={params.lfoEnabled}
            onChange={e => set({ lfoEnabled: e.target.checked })}
            className="accent-accent-primary" />
          <span className="text-xs text-text-muted">aktiv</span>
        </label>
      </Row>
      {params.lfoEnabled && (
        <>
          <Row label="Waveform">
            <div className="flex gap-0.5 flex-1 flex-wrap">
              {(Object.keys(LFO_WAVEFORM_LABELS) as LfoWaveform[]).map(w => (
                <button key={w} onClick={() => set({ lfoWaveform: w })}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    (params.lfoWaveform ?? "sine") === w
                      ? "bg-accent-secondary/60 text-white"
                      : "bg-bg-elevated text-text-dim hover:text-text-muted"
                  }`}>
                  {LFO_WAVEFORM_LABELS[w]}
                </button>
              ))}
            </div>
          </Row>
          <Row label="BPM-Sync">
            <select value={params.lfoBpmSync ?? "free"}
              onChange={e => set({ lfoBpmSync: e.target.value as LfoBpmRate })}
              className="flex-1 bg-bg-elevated rounded px-1.5 py-0.5 text-xs">
              {LFO_BPM_RATES.map(r => <option key={r} value={r}>{r === "free" ? "Free (Hz)" : r}</option>)}
            </select>
          </Row>
          {(params.lfoBpmSync ?? "free") === "free" ? (
            <Row label="Rate">
              <KnobSlider value={params.lfoRate} min={0.1} max={20} step={0.1} unit="Hz" onChange={v => set({ lfoRate: v })} />
            </Row>
          ) : (
            <Row label="Rate">
              <span className="text-xs text-accent-secondary font-mono">{params.lfoBpmSync} (BPM-sync)</span>
            </Row>
          )}
          <Row label="Depth">
            <KnobSlider value={params.lfoDepth} min={0} max={100} step={1} unit="¢" onChange={v => set({ lfoDepth: v })} />
          </Row>
          <Row label="Target">
            <select value={params.lfoTarget}
              onChange={e => set({ lfoTarget: e.target.value as SynthParams["lfoTarget"] })}
              className="flex-1 bg-bg-elevated rounded px-1.5 py-0.5 text-xs">
              <option value="pitch">Pitch</option>
              <option value="volume">Volume</option>
              <option value="filter">Filter</option>
            </select>
          </Row>
        </>
      )}

      {/* Reset */}
      <button
        onClick={() => onChange({ ...DEFAULT_SYNTH_PARAMS })}
        className="mt-2 w-full text-text-dim hover:text-text-primary text-xs py-0.5 rounded hover:bg-bg-elevated transition-colors"
      >
        Reset
      </button>

      {/* Wavetable Editor Modal */}
      {showWavetableEditor && (
        <WavetableEditor
          onSave={(_waveData) => {
            // waveData als Float32Array gespeichert → PeriodicWave in AudioEngine anwenden
            // Für jetzt: Custom-Typ bleibt, AudioEngine nutzt Sinus als Fallback
            set({ oscType: "custom" });
          }}
          onClose={() => setShowWavetableEditor(false)}
        />
      )}
    </div>
  );
}
