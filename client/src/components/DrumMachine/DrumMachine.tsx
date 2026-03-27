/**
 * Synthstudio – DrumMachine.tsx  (v2)
 *
 * Vollständige Drum Machine UI:
 * - 9 Kanäle mit eigenen Effekt-Reglern (Filter, EQ, Reverb, Delay, Distortion, Compressor)
 * - Step-Auflösung (1/8, 1/16, 1/32) pro Pattern und pro Kanal
 * - Pattern-BPM-Sync (eigenes BPM pro Pattern oder globales BPM)
 * - 16/32-Step-Grid mit Velocity-Farbkodierung
 * - Velocity-Editing per Drag
 * - Pitch-Popover per Rechtsklick
 * - Sample-Picker per Drag & Drop
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { PartData, ChannelFx, StepResolution } from "@/audio/AudioEngine";
import { AudioEngine } from "@/audio/AudioEngine";
import { PianoRollModal } from "@/components/PianoRoll/PianoRollModal";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Props {
  dm: DrumMachineState & DrumMachineActions;
  samples: Array<{ id: string; name: string; path: string; category: string }>;
  isPlaying: boolean;
  bpm: number;
  onPlayStop: () => void;
  onBpmChange: (bpm: number) => void;
  className?: string;
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function velocityColor(velocity: number, active: boolean): string {
  if (!active) return "bg-slate-800 hover:bg-slate-700";
  const v = velocity / 127;
  if (v > 0.85) return "bg-cyan-400 hover:bg-cyan-300";
  if (v > 0.65) return "bg-cyan-500 hover:bg-cyan-400";
  if (v > 0.45) return "bg-cyan-600 hover:bg-cyan-500";
  if (v > 0.25) return "bg-cyan-700 hover:bg-cyan-600";
  return "bg-cyan-800 hover:bg-cyan-700";
}

function stepGroupBorder(index: number, total: number): string {
  if (total === 16) {
    return index % 4 === 0 ? "ml-1" : "";
  }
  return index % 8 === 0 ? "ml-1.5" : index % 4 === 0 ? "ml-0.5" : "";
}

// ─── FX-Panel ─────────────────────────────────────────────────────────────────

interface FxPanelProps {
  part: PartData;
  onFxChange: (fx: Partial<ChannelFx>) => void;
  onClose: () => void;
}

function Knob({ label, value, min, max, step = 0.01, onChange, unit = "" }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[52px]">
      <span className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-12 accent-cyan-500 cursor-pointer"
        style={{ writingMode: "horizontal-tb" }}
      />
      <span className="text-[9px] text-slate-400 font-mono">
        {value.toFixed(unit === "Hz" ? 0 : unit === "dB" ? 1 : 2)}{unit}
      </span>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={[
        "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
        value ? "bg-cyan-600 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function FxPanel({ part, onFxChange, onClose }: FxPanelProps) {
  const fx = part.fx;
  const [tab, setTab] = useState<"filter" | "eq" | "dynamics" | "delay" | "reverb">("filter");

  return (
    <div className="absolute z-50 left-0 top-full mt-1 bg-[#111] border border-slate-700 rounded-lg shadow-2xl p-3 w-[340px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-300">FX: {part.name}</span>
        <button onClick={onClose} className="text-slate-500 hover:text-white text-sm leading-none">✕</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b border-slate-800 pb-2">
        {(["filter", "eq", "dynamics", "delay", "reverb"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-2 py-0.5 rounded text-[10px] capitalize transition-colors",
              tab === t ? "bg-cyan-700 text-white" : "text-slate-500 hover:text-slate-300",
            ].join(" ")}
          >
            {t === "dynamics" ? "Comp" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Filter */}
      {tab === "filter" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Toggle label="Filter" value={fx.filterEnabled} onChange={v => onFxChange({ filterEnabled: v })} />
            <select
              value={fx.filterType}
              onChange={e => onFxChange({ filterType: e.target.value as ChannelFx["filterType"] })}
              className="bg-slate-800 text-slate-300 text-[10px] rounded px-1 py-0.5 border border-slate-700"
            >
              <option value="lowpass">Low Pass</option>
              <option value="highpass">High Pass</option>
              <option value="bandpass">Band Pass</option>
              <option value="notch">Notch</option>
            </select>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Knob label="Freq" value={fx.filterFreq} min={20} max={20000} step={10}
              onChange={v => onFxChange({ filterFreq: v })} unit="Hz" />
            <Knob label="Resonanz" value={fx.filterQ} min={0.1} max={20} step={0.1}
              onChange={v => onFxChange({ filterQ: v })} />
          </div>
          <div className="border-t border-slate-800 pt-2">
            <div className="flex items-center gap-2 mb-2">
              <Toggle label="Distortion" value={fx.distortionEnabled} onChange={v => onFxChange({ distortionEnabled: v })} />
            </div>
            <Knob label="Drive" value={fx.distortionAmount} min={0} max={400} step={1}
              onChange={v => onFxChange({ distortionAmount: v })} />
          </div>
        </div>
      )}

      {/* EQ */}
      {tab === "eq" && (
        <div className="space-y-3">
          <Toggle label="3-Band EQ" value={fx.eqEnabled} onChange={v => onFxChange({ eqEnabled: v })} />
          <div className="flex gap-3">
            <Knob label="Low" value={fx.eqLow} min={-15} max={15} step={0.5}
              onChange={v => onFxChange({ eqLow: v })} unit="dB" />
            <Knob label="Mid" value={fx.eqMid} min={-15} max={15} step={0.5}
              onChange={v => onFxChange({ eqMid: v })} unit="dB" />
            <Knob label="High" value={fx.eqHigh} min={-15} max={15} step={0.5}
              onChange={v => onFxChange({ eqHigh: v })} unit="dB" />
          </div>
        </div>
      )}

      {/* Compressor */}
      {tab === "dynamics" && (
        <div className="space-y-3">
          <Toggle label="Compressor" value={fx.compressorEnabled} onChange={v => onFxChange({ compressorEnabled: v })} />
          <div className="flex gap-3 flex-wrap">
            <Knob label="Threshold" value={fx.compressorThreshold} min={-60} max={0} step={0.5}
              onChange={v => onFxChange({ compressorThreshold: v })} unit="dB" />
            <Knob label="Ratio" value={fx.compressorRatio} min={1} max={20} step={0.5}
              onChange={v => onFxChange({ compressorRatio: v })} />
            <Knob label="Attack" value={fx.compressorAttack} min={0} max={1} step={0.001}
              onChange={v => onFxChange({ compressorAttack: v })} />
            <Knob label="Release" value={fx.compressorRelease} min={0} max={1} step={0.01}
              onChange={v => onFxChange({ compressorRelease: v })} />
          </div>
        </div>
      )}

      {/* Delay */}
      {tab === "delay" && (
        <div className="space-y-3">
          <Toggle label="Delay" value={fx.delayEnabled} onChange={v => onFxChange({ delayEnabled: v })} />
          <div className="flex gap-3 flex-wrap">
            <Knob label="Zeit" value={fx.delayTime} min={0.01} max={2} step={0.01}
              onChange={v => onFxChange({ delayTime: v })} />
            <Knob label="Feedback" value={fx.delayFeedback} min={0} max={0.95} step={0.01}
              onChange={v => onFxChange({ delayFeedback: v })} />
            <Knob label="Mix" value={fx.delayMix} min={0} max={1} step={0.01}
              onChange={v => onFxChange({ delayMix: v })} />
          </div>
        </div>
      )}

      {/* Reverb */}
      {tab === "reverb" && (
        <div className="space-y-3">
          <Toggle label="Reverb" value={fx.reverbEnabled} onChange={v => onFxChange({ reverbEnabled: v })} />
          <div className="flex gap-3">
            <Knob label="Decay" value={fx.reverbDecay} min={0.1} max={10} step={0.1}
              onChange={v => onFxChange({ reverbDecay: v })} />
            <Knob label="Mix" value={fx.reverbMix} min={0} max={1} step={0.01}
              onChange={v => onFxChange({ reverbMix: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Kanal-Strip ──────────────────────────────────────────────────────────────

interface ChannelStripProps {
  part: PartData;
  partIndex: number;
  stepCount: number;
  currentStep: number;
  isActive: boolean;
  velocityMode: boolean;
  pitchMode: boolean;
  patternResolution: StepResolution;
  fxPanelOpen: boolean;
  samples: Array<{ id: string; name: string; path: string; category: string }>;
  onToggleStep: (stepIndex: number) => void;
  onSetVelocity: (stepIndex: number, v: number) => void;
  onSetPitch: (stepIndex: number, p: number) => void;
  onMute: () => void;
  onSolo: () => void;
  onVolumeChange: (v: number) => void;
  onPanChange: (v: number) => void;
  onSampleDrop: (url: string, name: string) => void;
  onFxChange: (fx: Partial<ChannelFx>) => void;
  onFxToggle: () => void;
  onResolutionChange: (res: StepResolution | undefined) => void;
  onClick: () => void;
  onPianoRollOpen: () => void;
}

function ChannelStrip({
  part, partIndex, stepCount, currentStep, isActive,
  velocityMode, pitchMode, patternResolution, fxPanelOpen,
  samples, onToggleStep, onSetVelocity, onSetPitch,
  onMute, onSolo, onVolumeChange, onPanChange,
  onSampleDrop, onFxChange, onFxToggle, onResolutionChange, onClick, onPianoRollOpen,
}: ChannelStripProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [pitchPopover, setPitchPopover] = useState<number | null>(null);
  const [dragVelocityStep, setDragVelocityStep] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const effectiveResolution = part.stepResolution ?? patternResolution;
  const hasActiveFx = part.fx.filterEnabled || part.fx.reverbEnabled ||
    part.fx.delayEnabled || part.fx.distortionEnabled ||
    part.fx.compressorEnabled || part.fx.eqEnabled;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const sampleId = e.dataTransfer.getData("sampleId");
    const sampleUrl = e.dataTransfer.getData("sampleUrl");
    const sampleName = e.dataTransfer.getData("sampleName");
    if (sampleUrl) onSampleDrop(sampleUrl, sampleName || "Sample");
  };

  const handleStepMouseDown = (stepIndex: number, e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      setPitchPopover(stepIndex);
      return;
    }
    if (velocityMode) {
      setDragVelocityStep(stepIndex);
      return;
    }
    onToggleStep(stepIndex);
  };

  const handleMouseMove = (e: React.MouseEvent, stepIndex: number) => {
    if (dragVelocityStep === null) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const relY = 1 - (e.clientY - rect.top) / rect.height;
    onSetVelocity(stepIndex, Math.max(1, Math.min(127, Math.round(relY * 127))));
  };

  return (
    <div
      ref={stripRef}
      className={[
        "flex items-center gap-1 px-2 py-1 border-b border-slate-800/50 relative",
        "transition-colors duration-75",
        isActive ? "bg-slate-900/80" : "hover:bg-slate-900/40",
        part.muted ? "opacity-50" : "",
      ].join(" ")}
      onClick={onClick}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 border-2 border-cyan-500 rounded pointer-events-none z-10 bg-cyan-500/10" />
      )}

      {/* Kanal-Name + Sample-Anzeige */}
      <div className="w-[88px] flex-shrink-0">
        <div className="text-[10px] font-medium text-slate-300 truncate leading-tight">
          {part.name}
        </div>
        <div
          className={[
            "text-[9px] truncate leading-tight",
            part.sampleUrl ? "text-cyan-700" : "text-slate-700",
          ].join(" ")}
          title={part.sampleUrl ? (part.sampleName ?? part.sampleUrl) : "Kein Sample – Sample aus Browser ziehen oder doppelklicken"}
        >
          {part.sampleUrl
            ? "● " + ((part.sampleName ?? part.sampleUrl.split("/").pop() ?? "Sample").slice(0, 14))
            : "– kein Sample"}
        </div>
      </div>

      {/* Mute / Solo */}
      <button
        onClick={e => { e.stopPropagation(); onMute(); }}
        title="Mute"
        className={[
          "w-5 h-5 rounded text-[9px] font-bold flex-shrink-0 transition-colors",
          part.muted ? "bg-yellow-600 text-black" : "bg-slate-800 text-slate-500 hover:bg-slate-700",
        ].join(" ")}
      >M</button>
      <button
        onClick={e => { e.stopPropagation(); onSolo(); }}
        title="Solo"
        className={[
          "w-5 h-5 rounded text-[9px] font-bold flex-shrink-0 transition-colors",
          part.soloed ? "bg-green-600 text-black" : "bg-slate-800 text-slate-500 hover:bg-slate-700",
        ].join(" ")}
      >S</button>

      {/* Volume */}
      <input
        type="range" min={0} max={1} step={0.01} value={part.volume}
        onChange={e => { e.stopPropagation(); onVolumeChange(parseFloat(e.target.value)); }}
        onClick={e => e.stopPropagation()}
        title={`Volume: ${Math.round(part.volume * 100)}%`}
        className="w-12 flex-shrink-0 accent-cyan-600 cursor-pointer"
      />

      {/* Pan */}
      <input
        type="range" min={-1} max={1} step={0.01} value={part.pan}
        onChange={e => { e.stopPropagation(); onPanChange(parseFloat(e.target.value)); }}
        onClick={e => e.stopPropagation()}
        title={`Pan: ${part.pan > 0 ? "R" : part.pan < 0 ? "L" : "C"}${Math.abs(Math.round(part.pan * 100))}`}
        className="w-10 flex-shrink-0 accent-slate-400 cursor-pointer"
      />

      {/* Step-Auflösung pro Kanal */}
      <select
        value={part.stepResolution ?? ""}
        onChange={e => {
          e.stopPropagation();
          onResolutionChange(e.target.value === "" ? undefined : e.target.value as StepResolution);
        }}
        onClick={e => e.stopPropagation()}
        title="Step-Auflösung für diesen Kanal"
        className="bg-slate-800 text-slate-400 text-[9px] rounded px-1 py-0.5 border border-slate-700 flex-shrink-0 w-14"
      >
        <option value="">Auto</option>
        <option value="1/8">1/8</option>
        <option value="1/16">1/16</option>
        <option value="1/32">1/32</option>
      </select>

      {/* FX-Button */}
      <button
        onClick={e => { e.stopPropagation(); onFxToggle(); }}
        title="Effekte"
        className={[
          "w-6 h-5 rounded text-[9px] flex-shrink-0 transition-colors font-medium",
          hasActiveFx ? "bg-purple-700 text-white" : "bg-slate-800 text-slate-500 hover:bg-slate-700",
          fxPanelOpen ? "ring-1 ring-purple-400" : "",
        ].join(" ")}
      >FX</button>

      {/* Piano Roll Button */}
      <button
        onClick={e => { e.stopPropagation(); onPianoRollOpen(); }}
        title="Piano Roll – melodische Noten programmieren"
        className="w-6 h-5 rounded text-[9px] flex-shrink-0 transition-colors font-medium bg-slate-800 text-slate-500 hover:bg-indigo-700 hover:text-white"
      >PR</button>

      {/* FX-Panel */}
      {fxPanelOpen && (
        <FxPanel
          part={part}
          onFxChange={onFxChange}
          onClose={onFxToggle}
        />
      )}

      {/* Step-Grid */}
      <div
        className="flex gap-[2px] flex-1 min-w-0"
        onMouseLeave={() => setDragVelocityStep(null)}
        onMouseUp={() => setDragVelocityStep(null)}
        onContextMenu={e => e.preventDefault()}
      >
        {Array.from({ length: stepCount }).map((_, i) => {
          const step = part.steps[i];
          const isCurrentStep = i === currentStep;
          const isActive = step?.active ?? false;
          const velocity = step?.velocity ?? 100;

          return (
            <button
              key={i}
              onMouseDown={e => handleStepMouseDown(i, e)}
              onMouseMove={e => dragVelocityStep !== null && handleMouseMove(e, i)}
              onMouseEnter={e => dragVelocityStep !== null && handleMouseMove(e, i)}
              className={[
                "flex-1 h-7 rounded-sm transition-colors duration-75 relative",
                stepGroupBorder(i, stepCount),
                velocityColor(velocity, isActive),
                isCurrentStep ? "ring-1 ring-white/60" : "",
              ].join(" ")}
              title={`Step ${i + 1} | Velocity: ${velocity}`}
            >
              {isCurrentStep && (
                <div className="absolute inset-0 bg-white/10 rounded-sm pointer-events-none" />
              )}
              {velocityMode && isActive && (
                <div
                  className="absolute bottom-0 left-0 right-0 bg-cyan-300/40 rounded-b-sm pointer-events-none"
                  style={{ height: `${(velocity / 127) * 100}%` }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Pitch-Popover */}
      {pitchPopover !== null && (
        <div
          className="absolute z-50 bg-[#111] border border-slate-700 rounded-lg p-3 shadow-2xl"
          style={{ bottom: "calc(100% + 4px)", left: "200px" }}
          onClick={e => e.stopPropagation()}
        >
          <div className="text-[10px] text-slate-400 mb-2">Step {pitchPopover + 1} – Pitch</div>
          <input
            type="range" min={-24} max={24} step={1}
            value={part.steps[pitchPopover]?.pitch ?? 0}
            onChange={e => onSetPitch(pitchPopover, parseInt(e.target.value))}
            className="w-32 accent-cyan-500"
          />
          <div className="text-center text-[10px] text-slate-300 mt-1">
            {part.steps[pitchPopover]?.pitch ?? 0} Halbtöne
          </div>
          <button
            onClick={() => setPitchPopover(null)}
            className="mt-2 w-full text-[10px] bg-slate-700 hover:bg-slate-600 rounded py-0.5 text-slate-300"
          >
            Schließen
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export function DrumMachine({ dm, samples, isPlaying, bpm, onPlayStop, onBpmChange, className = "" }: Props) {
  const pattern = dm.getActivePattern();
  const [showPatternMenu, setShowPatternMenu] = useState(false);
  const [metronomOn, setMetronomOn] = useState(false);
  const [metronomGain, setMetronomGain] = useState(0.5);
  const [metronomAccent, setMetronomAccent] = useState(1.0);
  const [metronomTone, setMetronomTone] = useState(0.5);
  const [metronomBeatsPerBar, setMetronomBeatsPerBar] = useState(4);
  const [metronomOscType, setMetronomOscType] = useState<OscillatorType>("sine");
  const [metronomSubdivision, setMetronomSubdivision] = useState<"beat" | "eighth" | "sixteenth">("beat");
  const [showMetronomPanel, setShowMetronomPanel] = useState(false);
  const metronomPanelRef = useRef<HTMLDivElement>(null);
  const [masterVolume, setMasterVolume] = useState(0.85);
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const bpmInputRef = useRef<HTMLInputElement>(null);
  const [pianoRollPartId, setPianoRollPartId] = useState<string | null>(null);

  // Keyboard-Shortcuts werden zentral durch useKeyboardShortcuts in App.tsx gehandhabt

  // BPM-Input synchronisieren
  useEffect(() => {
    setBpmInput(String(bpm));
  }, [bpm]);

  // Metronom-Panel schließen bei Klick außerhalb
  useEffect(() => {
    if (!showMetronomPanel) return;
    const handler = (e: MouseEvent) => {
      if (!metronomPanelRef.current?.contains(e.target as Node)) {
        setShowMetronomPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMetronomPanel]);

  // Metronom-Sync
  useEffect(() => {
    const downbeatFreq = 800 + metronomTone * 1200;
    const beatFreq = 500 + metronomTone * 700;
    AudioEngine.setMetronom(
      metronomOn, metronomGain, metronomAccent, downbeatFreq, beatFreq,
      metronomBeatsPerBar, metronomSubdivision, metronomOscType,
    );
  }, [metronomOn, metronomGain, metronomAccent, metronomTone, metronomBeatsPerBar, metronomOscType, metronomSubdivision]);

  // Master-Volume-Sync
  useEffect(() => {
    AudioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  // Effekte live aktualisieren
  useEffect(() => {
    if (!pattern) return;
    pattern.parts.forEach(part => {
      AudioEngine.updateChannelFx(part.id, part.fx);
    });
  }, [pattern]);

  if (!pattern) return null;

  const effectiveBpm = pattern.bpm ?? bpm;

  return (
    <div className={`flex flex-col bg-[#0a0a0a] text-slate-100 select-none overflow-hidden ${className}`}>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0d0d0d] border-b border-slate-800 flex-wrap">

        {/* Pattern-Auswahl */}
        <div className="relative">
          <button
            onClick={() => setShowPatternMenu(prev => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-medium transition-colors"
          >
            <span>{pattern.name}</span>
            <span className="text-slate-500">▾</span>
          </button>
          {showPatternMenu && (
            <div className="absolute top-full left-0 mt-1 bg-[#111] border border-slate-700 rounded-lg shadow-xl z-50 min-w-[180px]">
              {dm.patterns.map(p => (
                <div key={p.id} className="flex items-center group">
                  <button
                    onClick={() => { dm.setActivePattern(p.id); setShowPatternMenu(false); }}
                    className={[
                      "flex-1 text-left px-3 py-1.5 text-xs transition-colors",
                      p.id === dm.activePatternId
                        ? "text-cyan-400 bg-cyan-900/30"
                        : "text-slate-300 hover:bg-slate-800",
                    ].join(" ")}
                  >
                    {p.name}
                    {p.bpm !== null && (
                      <span className="ml-1 text-[9px] text-slate-500">{p.bpm} BPM</span>
                    )}
                  </button>
                  <button
                    onClick={() => dm.duplicatePattern(p.id)}
                    className="px-1.5 py-1.5 text-slate-600 hover:text-slate-300 text-xs opacity-0 group-hover:opacity-100"
                    title="Duplizieren"
                  >⧉</button>
                  {dm.patterns.length > 1 && (
                    <button
                      onClick={() => dm.removePattern(p.id)}
                      className="px-1.5 py-1.5 text-slate-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100"
                      title="Löschen"
                    >✕</button>
                  )}
                </div>
              ))}
              <div className="border-t border-slate-800 p-1">
                <button
                  onClick={() => { dm.addPattern(); setShowPatternMenu(false); }}
                  className="w-full text-left px-2 py-1 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded"
                >
                  + Neues Pattern
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Step-Auflösung (Pattern-Global) */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500">Auflösung:</span>
          {(["1/8", "1/16", "1/32"] as StepResolution[]).map(res => (
            <button
              key={res}
              onClick={() => dm.setPatternStepResolution(pattern.id, res)}
              className={[
                "px-2 py-0.5 rounded text-[10px] font-mono transition-colors",
                pattern.stepResolution === res
                  ? "bg-cyan-700 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700",
              ].join(" ")}
            >
              {res}
            </button>
          ))}
        </div>

        {/* Step-Count */}
        <div className="flex items-center gap-1">
          {([16, 32] as const).map(n => (
            <button
              key={n}
              onClick={() => dm.setStepCount(n)}
              className={[
                "px-2 py-0.5 rounded text-[10px] font-mono transition-colors",
                pattern.stepCount === n
                  ? "bg-slate-600 text-white"
                  : "bg-slate-800 text-slate-500 hover:bg-slate-700",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Pattern-BPM-Sync */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500">BPM:</span>
          <button
            onClick={() => dm.setPatternBpm(pattern.id, pattern.bpm === null ? bpm : null)}
            title={pattern.bpm === null ? "Eigenes BPM setzen" : "Globales BPM verwenden"}
            className={[
              "px-2 py-0.5 rounded text-[9px] transition-colors",
              pattern.bpm !== null ? "bg-amber-700 text-white" : "bg-slate-800 text-slate-500 hover:bg-slate-700",
            ].join(" ")}
          >
            {pattern.bpm !== null ? "Eigenes" : "Global"}
          </button>
          {pattern.bpm !== null && (
            <input
              type="number" min={20} max={300}
              value={pattern.bpm}
              onChange={e => dm.setPatternBpm(pattern.id, parseInt(e.target.value) || bpm)}
              className="w-14 bg-slate-800 text-slate-200 text-xs rounded px-1.5 py-0.5 border border-slate-700 text-center"
            />
          )}
        </div>

        {/* Velocity / Pitch Mode */}
        <button
          onClick={() => dm.setVelocityMode(!dm.velocityMode)}
          className={[
            "px-2 py-1 rounded text-[10px] font-medium transition-colors",
            dm.velocityMode ? "bg-amber-700 text-white" : "bg-slate-800 text-slate-500 hover:bg-slate-700",
          ].join(" ")}
          title="Velocity-Modus"
        >VEL</button>

        <button
          onClick={() => dm.setPitchMode(!dm.pitchMode)}
          className={[
            "px-2 py-1 rounded text-[10px] font-medium transition-colors",
            dm.pitchMode ? "bg-purple-700 text-white" : "bg-slate-800 text-slate-500 hover:bg-slate-700",
          ].join(" ")}
          title="Pitch-Modus (Rechtsklick auf Step)"
        >PITCH</button>

        {/* Metronom */}
        <div ref={metronomPanelRef} className="relative">
          <div className="flex items-center gap-0.5 px-1.5 py-1 rounded bg-slate-900 border border-slate-800">
            <button
              onClick={() => setMetronomOn(prev => !prev)}
              className={[
                "px-2 py-0.5 rounded text-[10px] transition-colors",
                metronomOn ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-500 hover:bg-slate-700",
              ].join(" ")}
              title={metronomOn ? "Metronom aus" : "Metronom ein"}
            >♩</button>
            <button
              onClick={() => setShowMetronomPanel(prev => !prev)}
              className={[
                "px-1.5 py-0.5 rounded text-[10px] transition-colors",
                showMetronomPanel ? "bg-slate-600 text-white" : "text-slate-600 hover:text-slate-300",
              ].join(" ")}
              title="Metronom-Einstellungen"
            >⚙</button>
          </div>

          {showMetronomPanel && (
            <div className="absolute top-full right-0 z-50 mt-1 p-3 bg-[#111] border border-slate-700 rounded-lg shadow-xl w-64">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-300">Metronom</span>
                <button onClick={() => setShowMetronomPanel(false)} className="text-slate-500 hover:text-white text-sm leading-none">✕</button>
              </div>

              {/* Schieberegler */}
              <div className="space-y-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 w-16 shrink-0">Lautstärke</span>
                  <input type="range" min={0} max={1} step={0.01} value={metronomGain}
                    onChange={e => setMetronomGain(parseFloat(e.target.value))}
                    className="flex-1 accent-slate-300 cursor-pointer" />
                  <span className="text-[10px] text-slate-500 w-8 text-right">{Math.round(metronomGain * 100)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 w-16 shrink-0">Akzent</span>
                  <input type="range" min={0.2} max={2} step={0.01} value={metronomAccent}
                    onChange={e => setMetronomAccent(parseFloat(e.target.value))}
                    className="flex-1 accent-amber-500 cursor-pointer" />
                  <span className="text-[10px] text-slate-500 w-8 text-right">{metronomAccent.toFixed(1)}×</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 w-16 shrink-0">Tonhöhe</span>
                  <input type="range" min={0} max={1} step={0.01} value={metronomTone}
                    onChange={e => setMetronomTone(parseFloat(e.target.value))}
                    className="flex-1 accent-indigo-500 cursor-pointer" />
                  <span className="text-[10px] text-slate-500 w-8 text-right">{Math.round(metronomTone * 100)}%</span>
                </div>
              </div>

              <div className="border-t border-slate-800 my-2" />

              {/* Schläge / Takt */}
              <div className="mb-2">
                <span className="text-[10px] text-slate-500 block mb-1">Schläge / Takt</span>
                <div className="flex gap-1">
                  {([2, 3, 4, 5, 6, 7] as const).map(n => (
                    <button key={n} onClick={() => setMetronomBeatsPerBar(n)}
                      className={[
                        "flex-1 py-0.5 rounded text-[10px] font-mono transition-colors",
                        metronomBeatsPerBar === n
                          ? "bg-cyan-700 text-white"
                          : "bg-slate-800 text-slate-500 hover:bg-slate-700",
                      ].join(" ")}>{n}</button>
                  ))}
                </div>
              </div>

              {/* Unterteilung */}
              <div className="mb-2">
                <span className="text-[10px] text-slate-500 block mb-1">Unterteilung</span>
                <div className="flex gap-1">
                  {(["beat", "eighth", "sixteenth"] as const).map(sub => (
                    <button key={sub} onClick={() => setMetronomSubdivision(sub)}
                      className={[
                        "flex-1 py-0.5 rounded text-[10px] transition-colors",
                        metronomSubdivision === sub
                          ? "bg-cyan-700 text-white"
                          : "bg-slate-800 text-slate-500 hover:bg-slate-700",
                      ].join(" ")}>
                      {sub === "beat" ? "1/4" : sub === "eighth" ? "1/8" : "1/16"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Klangtyp */}
              <div>
                <span className="text-[10px] text-slate-500 block mb-1">Klangtyp</span>
                <div className="flex gap-1">
                  {(["sine", "square", "triangle"] as const).map(type => (
                    <button key={type} onClick={() => setMetronomOscType(type)}
                      className={[
                        "flex-1 py-0.5 rounded text-[10px] transition-colors",
                        metronomOscType === type
                          ? "bg-indigo-700 text-white"
                          : "bg-slate-800 text-slate-500 hover:bg-slate-700",
                      ].join(" ")}>
                      {type === "sine" ? "Sinus" : type === "square" ? "Rechteck" : "Dreieck"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Master */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-500">Master</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={e => setMasterVolume(parseFloat(e.target.value))}
            title={`Master-Lautstärke: ${Math.round(masterVolume * 100)}%`}
            className="w-16 accent-cyan-500 cursor-pointer"
          />
        </div>

        {/* Clear */}
        <button
          onClick={dm.clearPattern}
          className="px-2 py-1 rounded text-[10px] bg-slate-800 text-slate-500 hover:bg-red-900 hover:text-red-300 transition-colors"
          title="Pattern leeren"
        >CLR</button>

        {/* Undo/Redo */}
        <button onClick={dm.undo} disabled={!dm.canUndo}
          className="w-6 h-6 rounded text-xs bg-slate-800 text-slate-500 hover:bg-slate-700 disabled:opacity-30 transition-colors"
          title="Rückgängig (Ctrl+Z)">↩</button>
        <button onClick={dm.redo} disabled={!dm.canRedo}
          className="w-6 h-6 rounded text-xs bg-slate-800 text-slate-500 hover:bg-slate-700 disabled:opacity-30 transition-colors"
          title="Wiederholen (Ctrl+Y)">↪</button>

        {/* Play/Stop */}
        <button
          onClick={onPlayStop}
          title={isPlaying ? "Stop (Space)" : "Play (Space)"}
          className={[
            "w-8 h-8 rounded flex items-center justify-center text-sm font-bold transition-colors",
            isPlaying
              ? "bg-red-600 hover:bg-red-500 text-white"
              : "bg-cyan-600 hover:bg-cyan-500 text-white",
          ].join(" ")}
        >
          {isPlaying ? "■" : "▶"}
        </button>

        {/* BPM */}
        <div className="flex items-center gap-1">
          <button onClick={() => onBpmChange(Math.max(20, bpm - 1))}
            className="w-5 h-6 rounded text-xs bg-slate-800 text-slate-500 hover:bg-slate-700">−</button>
          <input
            ref={bpmInputRef}
            type="number" min={20} max={300}
            value={bpmInput}
            onChange={e => setBpmInput(e.target.value)}
            onBlur={() => {
              const v = parseInt(bpmInput);
              if (!isNaN(v)) onBpmChange(Math.max(20, Math.min(300, v)));
              else setBpmInput(String(bpm));
            }}
            onKeyDown={e => {
              if (e.key === "Enter") bpmInputRef.current?.blur();
            }}
            className="w-14 bg-slate-800 text-slate-200 text-xs rounded px-1.5 py-1 border border-slate-700 text-center"
          />
          <button onClick={() => onBpmChange(Math.min(300, bpm + 1))}
            className="w-5 h-6 rounded text-xs bg-slate-800 text-slate-500 hover:bg-slate-700">+</button>
        </div>

        {/* Kanal hinzufügen */}
        <button
          onClick={() => dm.addPart()}
          className="px-2 py-1 rounded text-[10px] bg-slate-800 text-slate-500 hover:bg-slate-700 transition-colors"
          title="Kanal hinzufügen"
        >+ Kanal</button>
      </div>

      {/* ── Step-Grid Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-1 bg-[#0d0d0d] border-b border-slate-800/50">
        {/* Platzhalter für Kanal-Steuerung */}
        <div className="w-[88px] flex-shrink-0" />
        <div className="w-5 flex-shrink-0" />
        <div className="w-5 flex-shrink-0" />
        <div className="w-12 flex-shrink-0" />
        <div className="w-10 flex-shrink-0" />
        <div className="w-14 flex-shrink-0" />
        <div className="w-6 flex-shrink-0" />

        {/* Step-Nummern */}
        <div className="flex gap-[2px] flex-1 min-w-0">
          {Array.from({ length: pattern.stepCount }).map((_, i) => (
            <div
              key={i}
              className={[
                "flex-1 text-center text-[8px] leading-none py-0.5",
                stepGroupBorder(i, pattern.stepCount),
                i === dm.currentStep ? "text-cyan-400 font-bold" : "text-slate-700",
                i % 4 === 0 ? "text-slate-500" : "",
              ].join(" ")}
            >
              {i % 4 === 0 ? i + 1 : "·"}
            </div>
          ))}
        </div>
      </div>

      {/* ── Kanal-Zeilen ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {pattern.parts.map((part, partIndex) => (
          <ChannelStrip
            key={part.id}
            part={part}
            partIndex={partIndex}
            stepCount={pattern.stepCount}
            currentStep={dm.currentStep}
            isActive={dm.activePartId === part.id}
            velocityMode={dm.velocityMode}
            pitchMode={dm.pitchMode}
            patternResolution={pattern.stepResolution}
            fxPanelOpen={dm.fxPanelPartId === part.id}
            samples={samples}
            onToggleStep={stepIndex => dm.toggleStep(part.id, stepIndex)}
            onSetVelocity={(stepIndex, v) => dm.setStepVelocity(part.id, stepIndex, v)}
            onSetPitch={(stepIndex, p) => dm.setStepPitch(part.id, stepIndex, p)}
            onMute={() => dm.setPartMuted(part.id, !part.muted)}
            onSolo={() => dm.setPartSoloed(part.id, !part.soloed)}
            onVolumeChange={v => dm.setPartVolume(part.id, v)}
            onPanChange={v => dm.setPartPan(part.id, v)}
            onSampleDrop={(url, name) => dm.setPartSample(part.id, url, name)}
            onFxChange={fx => {
              dm.setPartFx(part.id, fx);
              // Live-Update der Audio-Engine
              const updatedPart = { ...part, fx: { ...part.fx, ...fx } };
              AudioEngine.updateChannelFx(part.id, updatedPart.fx);
            }}
            onFxToggle={() => dm.setFxPanelPartId(dm.fxPanelPartId === part.id ? null : part.id)}
            onResolutionChange={res => dm.setPartStepResolution(part.id, res)}
            onClick={() => dm.setActivePart(part.id)}
            onPianoRollOpen={() => setPianoRollPartId(part.id)}
          />
        ))}
      </div>

      {/* ── Status-Leiste ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-1 bg-[#0d0d0d] border-t border-slate-800 text-[9px] text-slate-600">
        <span>{pattern.parts.length} Kanäle</span>
        <span>·</span>
        <span>{pattern.stepCount} Steps</span>
        <span>·</span>
        <span>{pattern.stepResolution}</span>
        <span>·</span>
        <span>{effectiveBpm} BPM{pattern.bpm !== null ? " (eigenes)" : ""}</span>
        <span>·</span>
        <span>Step {dm.currentStep + 1}/{pattern.stepCount}</span>
        {dm.velocityMode && <><span>·</span><span className="text-amber-400">VELOCITY-MODUS</span></>}
        {dm.pitchMode && <><span>·</span><span className="text-purple-400">PITCH-MODUS</span></>}
      </div>

      {/* ── Piano Roll Modal ─────────────────────────────────────────────── */}
      {pianoRollPartId && (() => {
        const prPart = pattern.parts.find(p => p.id === pianoRollPartId);
        return (
          <PianoRollModal
            partId={pianoRollPartId}
            partName={prPart?.name ?? pianoRollPartId}
            isOpen={true}
            onClose={() => setPianoRollPartId(null)}
          />
        );
      })()}
    </div>
  );
}
