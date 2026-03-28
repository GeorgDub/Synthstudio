/**
 * SynthPanel.tsx – Synthesizer-Parameter-Panel (Wavetable / FM)
 * Phase 5: Wavetable / FM Synthesizer Engine
 */
import React from "react";
import type { SynthParams } from "@/audio/SynthEngine";
import { DEFAULT_SYNTH_PARAMS } from "@/audio/SynthEngine";

interface SynthPanelProps {
  partId: string;
  params: SynthParams;
  onChange: (params: SynthParams) => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-slate-400 text-xs w-16 shrink-0">{label}</span>
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
        className="flex-1 accent-cyan-500"
      />
      <span className="font-mono text-cyan-400 text-xs w-12 text-right">
        {value.toFixed(step < 1 ? 2 : 0)}{unit}
      </span>
    </div>
  );
}

export function SynthPanel({ partId, params, onChange }: SynthPanelProps) {
  const set = (update: Partial<SynthParams>) => onChange({ ...params, ...update });

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-white min-w-[260px]">
      <div className="text-xs font-semibold text-cyan-400 mb-2 uppercase tracking-wider">
        Synthesizer
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
                  ? "bg-cyan-700 text-white"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-400"
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
              className="flex-1 bg-slate-800 rounded px-1.5 py-0.5 text-xs"
            >
              {(["sine", "sawtooth", "square", "triangle"] as const).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Row>
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
      <div className="text-slate-500 text-[10px] uppercase tracking-wider mt-2 mb-1">ADSR</div>
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

      {/* LFO */}
      <div className="text-slate-500 text-[10px] uppercase tracking-wider mt-2 mb-1">LFO</div>
      <Row label="LFO">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={params.lfoEnabled}
            onChange={e => set({ lfoEnabled: e.target.checked })}
            className="accent-cyan-500"
          />
          <span className="text-xs text-slate-400">aktiv</span>
        </label>
      </Row>
      {params.lfoEnabled && (
        <>
          <Row label="Rate">
            <KnobSlider value={params.lfoRate} min={0.1} max={20} step={0.1} unit="Hz" onChange={v => set({ lfoRate: v })} />
          </Row>
          <Row label="Depth">
            <KnobSlider value={params.lfoDepth} min={0} max={100} step={1} unit="¢" onChange={v => set({ lfoDepth: v })} />
          </Row>
          <Row label="Target">
            <select
              value={params.lfoTarget}
              onChange={e => set({ lfoTarget: e.target.value as SynthParams["lfoTarget"] })}
              className="flex-1 bg-slate-800 rounded px-1.5 py-0.5 text-xs"
            >
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
        className="mt-2 w-full text-slate-500 hover:text-slate-300 text-xs py-0.5 rounded hover:bg-slate-800 transition-colors"
      >
        Reset
      </button>
    </div>
  );
}
