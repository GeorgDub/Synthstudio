/**
 * Synthstudio – MixerView.tsx
 *
 * Dedizierter Mixer mit Channel-Strips für alle DrumMachine-Kanäle.
 * Features:
 * - Vertikaler Fader (Volume 0–1, mit dB-Anzeige)
 * - Pan-Regler (-1..+1)
 * - Mute / Solo Buttons
 * - VU-Meter (animiert via requestAnimationFrame)
 * - Send-Level zu globalem Reverb + Delay-Bus
 * - Master-Fader rechts
 * - FX-Button pro Kanal → öffnet Inline-FX-Panel
 * - Return-Channels für Reverb + Delay mit konfigurierbaren Parametern
 * - Sidechain-Compression (Quell-Kanal wählbar)
 * - Compressor Gain-Reduction Meter
 */

import React, { useEffect, useRef, useCallback, useState } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { MixerState, MixerActions, ReturnBusState } from "@/store/useMixerStore";
import type { ChannelFx } from "@/audio/AudioEngine";
import { AudioEngine } from "@/audio/AudioEngine";

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function volToDb(vol: number): string {
  if (vol <= 0) return "-∞";
  const db = 20 * Math.log10(Math.max(0.001, vol));
  return (db >= 0 ? "+" : "") + db.toFixed(1) + " dB";
}

// ─── VU-Meter ────────────────────────────────────────────────────────────────

function VuMeter({ level }: { level: number }) {
  const NUM_SEGMENTS = 16;
  return (
    <div className="flex flex-col-reverse gap-px h-32 w-3">
      {Array.from({ length: NUM_SEGMENTS }, (_, i) => {
        const threshold = (i + 1) / NUM_SEGMENTS;
        const active = level >= threshold;
        const color =
          i >= 14 ? "#ef4444" :
          i >= 11 ? "#f59e0b" :
          "var(--theme-accent, #06b6d4)";
        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-opacity duration-75"
            style={{
              backgroundColor: active ? color : "#1e293b",
              opacity: active ? 1 : 0.3,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Gain Reduction Meter ─────────────────────────────────────────────────────

function GrMeter({ reduction }: { reduction: number }) {
  const absReduction = Math.min(24, Math.abs(reduction));
  const pct = (absReduction / 24) * 100;
  return (
    <div className="flex flex-col items-center gap-0.5 w-full">
      <span className="text-[7px] text-orange-400 uppercase">GR</span>
      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-orange-500 transition-all duration-75 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[7px] text-orange-400 font-mono">
        {absReduction > 0.5 ? `-${absReduction.toFixed(1)}` : "0"} dB
      </span>
    </div>
  );
}

// ─── Inline Knob ──────────────────────────────────────────────────────────────

function MiniKnob({ label, value, min, max, step, onChange, unit = "" }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[7px] text-slate-500 uppercase">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-12 accent-cyan-500 cursor-pointer"
      />
      <span className="text-[7px] text-slate-400 font-mono">
        {typeof value === "number" ? (value < 10 ? value.toFixed(2) : value.toFixed(1)) : value}{unit}
      </span>
    </div>
  );
}

// ─── Mixer FX Panel (Inline) ──────────────────────────────────────────────────

interface MixerFxPanelProps {
  partId: string;
  fx: ChannelFx;
  parts: Array<{ id: string; name: string }>;
  sidechainSource: string | null;
  onFxChange: (fx: Partial<ChannelFx>) => void;
  onSidechainChange: (sourceId: string | null) => void;
  onClose: () => void;
}

function MixerFxPanel({ partId, fx, parts, sidechainSource, onFxChange, onSidechainChange, onClose }: MixerFxPanelProps) {
  const [tab, setTab] = useState<"eq" | "filter" | "comp" | "delay" | "reverb" | "sc">("eq");

  return (
    <div className="bg-[#111] border border-slate-700 rounded-lg p-3 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide">Insert FX</span>
        <button onClick={onClose} className="text-slate-500 hover:text-white text-sm leading-none">✕</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 mb-2 flex-wrap">
        {(["eq", "filter", "comp", "delay", "reverb", "sc"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-1.5 py-0.5 rounded text-[8px] uppercase transition-colors",
              tab === t ? "bg-cyan-700 text-white" : "text-slate-500 hover:text-slate-300",
            ].join(" ")}
          >
            {t === "comp" ? "Comp" : t === "sc" ? "S/C" : t}
          </button>
        ))}
      </div>

      {/* EQ */}
      {tab === "eq" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={fx.eqEnabled}
              onChange={e => onFxChange({ eqEnabled: e.target.checked })}
              className="accent-cyan-500" />
            <span className="text-[9px] text-slate-300">3-Band EQ</span>
          </label>
          <div className="flex gap-2 justify-center">
            <MiniKnob label="Low" value={fx.eqLow} min={-15} max={15} step={0.5}
              onChange={v => onFxChange({ eqLow: v })} unit="dB" />
            <MiniKnob label="Mid" value={fx.eqMid} min={-15} max={15} step={0.5}
              onChange={v => onFxChange({ eqMid: v })} unit="dB" />
            <MiniKnob label="High" value={fx.eqHigh} min={-15} max={15} step={0.5}
              onChange={v => onFxChange({ eqHigh: v })} unit="dB" />
          </div>
        </div>
      )}

      {/* Filter + Distortion */}
      {tab === "filter" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={fx.filterEnabled}
                onChange={e => onFxChange({ filterEnabled: e.target.checked })}
                className="accent-cyan-500" />
              <span className="text-[9px] text-slate-300">Filter</span>
            </label>
            <select value={fx.filterType}
              onChange={e => onFxChange({ filterType: e.target.value as ChannelFx["filterType"] })}
              className="bg-slate-800 text-slate-300 text-[9px] rounded px-1 py-0.5 border border-slate-700">
              <option value="lowpass">LP</option>
              <option value="highpass">HP</option>
              <option value="bandpass">BP</option>
              <option value="notch">Notch</option>
            </select>
          </div>
          <div className="flex gap-2 justify-center">
            <MiniKnob label="Freq" value={fx.filterFreq} min={20} max={20000} step={10}
              onChange={v => onFxChange({ filterFreq: v })} unit="Hz" />
            <MiniKnob label="Q" value={fx.filterQ} min={0.1} max={20} step={0.1}
              onChange={v => onFxChange({ filterQ: v })} />
          </div>
          <div className="border-t border-slate-800 pt-2">
            <label className="flex items-center gap-1 cursor-pointer mb-1">
              <input type="checkbox" checked={fx.distortionEnabled}
                onChange={e => onFxChange({ distortionEnabled: e.target.checked })}
                className="accent-cyan-500" />
              <span className="text-[9px] text-slate-300">Distortion</span>
            </label>
            <MiniKnob label="Drive" value={fx.distortionAmount} min={0} max={400} step={1}
              onChange={v => onFxChange({ distortionAmount: v })} />
          </div>
        </div>
      )}

      {/* Compressor */}
      {tab === "comp" && (
        <div className="space-y-2">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={fx.compressorEnabled}
              onChange={e => onFxChange({ compressorEnabled: e.target.checked })}
              className="accent-cyan-500" />
            <span className="text-[9px] text-slate-300">Compressor</span>
          </label>
          <div className="flex gap-2 flex-wrap justify-center">
            <MiniKnob label="Thresh" value={fx.compressorThreshold} min={-60} max={0} step={0.5}
              onChange={v => onFxChange({ compressorThreshold: v })} unit="dB" />
            <MiniKnob label="Ratio" value={fx.compressorRatio} min={1} max={20} step={0.5}
              onChange={v => onFxChange({ compressorRatio: v })} />
            <MiniKnob label="Atk" value={fx.compressorAttack} min={0} max={1} step={0.001}
              onChange={v => onFxChange({ compressorAttack: v })} unit="s" />
            <MiniKnob label="Rel" value={fx.compressorRelease} min={0} max={1} step={0.01}
              onChange={v => onFxChange({ compressorRelease: v })} unit="s" />
          </div>
        </div>
      )}

      {/* Delay */}
      {tab === "delay" && (
        <div className="space-y-2">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={fx.delayEnabled}
              onChange={e => onFxChange({ delayEnabled: e.target.checked })}
              className="accent-cyan-500" />
            <span className="text-[9px] text-slate-300">Delay</span>
          </label>
          <div className="flex gap-2 justify-center">
            <MiniKnob label="Time" value={fx.delayTime} min={0.01} max={2} step={0.01}
              onChange={v => onFxChange({ delayTime: v })} unit="s" />
            <MiniKnob label="FB" value={fx.delayFeedback} min={0} max={0.95} step={0.01}
              onChange={v => onFxChange({ delayFeedback: v })} />
            <MiniKnob label="Mix" value={fx.delayMix} min={0} max={1} step={0.01}
              onChange={v => onFxChange({ delayMix: v })} />
          </div>
        </div>
      )}

      {/* Reverb */}
      {tab === "reverb" && (
        <div className="space-y-2">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={fx.reverbEnabled}
              onChange={e => onFxChange({ reverbEnabled: e.target.checked })}
              className="accent-cyan-500" />
            <span className="text-[9px] text-slate-300">Reverb</span>
          </label>
          <div className="flex gap-2 justify-center">
            <MiniKnob label="Decay" value={fx.reverbDecay} min={0.1} max={10} step={0.1}
              onChange={v => onFxChange({ reverbDecay: v })} unit="s" />
            <MiniKnob label="Mix" value={fx.reverbMix} min={0} max={1} step={0.01}
              onChange={v => onFxChange({ reverbMix: v })} />
          </div>
        </div>
      )}

      {/* Sidechain */}
      {tab === "sc" && (
        <div className="space-y-2">
          <span className="text-[9px] text-slate-300 block">Sidechain-Quelle</span>
          <select
            value={sidechainSource ?? ""}
            onChange={e => onSidechainChange(e.target.value || null)}
            className="w-full bg-slate-800 text-slate-300 text-[9px] rounded px-1 py-1 border border-slate-700"
          >
            <option value="">Keine</option>
            {parts.filter(p => p.id !== partId).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="text-[8px] text-slate-600">
            Wenn aktiv, wird dieser Kanal geduckt sobald der Quell-Kanal spielt.
            Compressor-Einstellungen (Threshold, Ratio, Attack, Release) bestimmen die Ducking-Stärke.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Return Bus Strip ─────────────────────────────────────────────────────────

interface ReturnStripProps {
  name: string;
  color: string;
  accentClass: string;
  params: { label: string; value: number; min: number; max: number; step: number; key: keyof ReturnBusState; unit?: string }[];
  onParamChange: (param: keyof ReturnBusState, value: number) => void;
}

function ReturnStrip({ name, color, accentClass, params, onParamChange }: ReturnStripProps) {
  return (
    <div
      className="flex flex-col items-center gap-1 px-2 py-2 border-r border-slate-800"
      style={{ minWidth: "52px" }}
    >
      <span className={`text-[9px] font-medium uppercase tracking-wide ${color}`}>{name}</span>
      <span className={`text-[7px] ${color} uppercase`}>Return</span>

      <div className="flex flex-col gap-1 w-full mt-1">
        {params.map(p => (
          <div key={p.key} className="flex flex-col items-center gap-0.5">
            <span className={`text-[7px] ${color} uppercase`}>{p.label}</span>
            <input
              type="range" min={p.min} max={p.max} step={p.step}
              value={p.value}
              onChange={e => onParamChange(p.key, parseFloat(e.target.value))}
              className={`w-full ${accentClass} cursor-pointer`}
            />
            <span className="text-[7px] text-slate-400 font-mono">
              {p.value < 1 ? p.value.toFixed(2) : p.value.toFixed(1)}{p.unit ?? ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mixer-Kanal ─────────────────────────────────────────────────────────────

interface MixerChannelProps {
  partId: string;
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  sendReverb: number;
  sendDelay: number;
  peakLevel: number;
  gainReduction: number;
  hasCompressor: boolean;
  hasSidechain: boolean;
  isMaster?: boolean;
  fxOpen?: boolean;
  onVolumeChange: (v: number) => void;
  onPanChange: (v: number) => void;
  onMuteToggle: () => void;
  onSoloToggle: () => void;
  onSendChange: (bus: "reverb" | "delay", v: number) => void;
  onFxToggle?: () => void;
}

function MixerChannel({
  name, volume, pan, muted, soloed,
  sendReverb, sendDelay, peakLevel,
  gainReduction, hasCompressor, hasSidechain,
  isMaster, fxOpen,
  onVolumeChange, onPanChange, onMuteToggle, onSoloToggle, onSendChange,
  onFxToggle,
}: MixerChannelProps) {
  const labelColor = muted ? "text-slate-600" : soloed ? "text-yellow-400" : "text-slate-300";

  return (
    <div
      className={[
        "flex flex-col items-center gap-1 px-2 py-2 select-none",
        "border-r border-slate-800 last:border-r-0",
        isMaster ? "bg-slate-900/60 border-l border-slate-700 pl-3" : "",
        muted ? "opacity-50" : "",
        fxOpen ? "bg-slate-900/80" : "",
      ].join(" ")}
      style={{ minWidth: isMaster ? "64px" : "52px" }}
    >
      {/* Kanalname */}
      <span
        className={`text-[9px] font-medium uppercase tracking-wide truncate w-full text-center ${labelColor}`}
        title={name}
      >
        {name}
      </span>

      {/* VU-Meter + Fader nebeneinander */}
      <div className="flex items-end gap-1 h-32">
        <VuMeter level={peakLevel} />

        {/* Vertikaler Fader */}
        <input
          type="range"
          min={0} max={1} step={0.01}
          value={volume}
          onChange={e => onVolumeChange(parseFloat(e.target.value))}
          className="h-32 w-3 accent-cyan-500 cursor-pointer"
          style={{ writingMode: "vertical-lr", direction: "rtl", appearance: "slider-vertical" as React.CSSProperties["appearance"] }}
          title={volToDb(volume)}
        />
      </div>

      {/* dB-Anzeige */}
      <span className="text-[8px] text-slate-500 font-mono">{volToDb(volume)}</span>

      {/* Pan-Regler */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[8px] text-slate-600 uppercase">Pan</span>
        <input
          type="range"
          min={-1} max={1} step={0.01}
          value={pan}
          onChange={e => onPanChange(parseFloat(e.target.value))}
          className="w-full accent-cyan-500 cursor-pointer"
          title={pan === 0 ? "C" : pan > 0 ? `R ${Math.round(pan * 100)}` : `L ${Math.round(-pan * 100)}`}
        />
        <span className="text-[8px] text-slate-500 font-mono">
          {pan === 0 ? "C" : pan > 0 ? `R${Math.round(pan * 100)}` : `L${Math.round(-pan * 100)}`}
        </span>
      </div>

      {/* Mute / Solo / FX */}
      {!isMaster && (
        <div className="flex gap-1 flex-wrap justify-center">
          <button
            onClick={onMuteToggle}
            title="Mute (M)"
            className={[
              "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
              muted
                ? "bg-orange-600 text-white"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-orange-400",
            ].join(" ")}
          >
            M
          </button>
          <button
            onClick={onSoloToggle}
            title="Solo (S)"
            className={[
              "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
              soloed
                ? "bg-yellow-500 text-slate-900"
                : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-yellow-400",
            ].join(" ")}
          >
            S
          </button>
          {onFxToggle && (
            <button
              onClick={onFxToggle}
              title="Insert FX"
              className={[
                "w-6 h-5 rounded text-[8px] font-bold transition-colors duration-100",
                fxOpen
                  ? "bg-purple-600 text-white ring-1 ring-purple-400"
                  : "bg-slate-800 text-slate-500 hover:bg-slate-700 hover:text-purple-400",
              ].join(" ")}
            >
              FX
            </button>
          )}
        </div>
      )}

      {/* GR-Meter (Compressor / Sidechain) */}
      {!isMaster && (hasCompressor || hasSidechain) && (
        <GrMeter reduction={gainReduction} />
      )}

      {/* Sidechain Indicator */}
      {!isMaster && hasSidechain && (
        <span className="text-[7px] text-amber-500 uppercase tracking-wide">S/C</span>
      )}

      {/* Send-Regler (nur für normale Kanäle) */}
      {!isMaster && (
        <div className="flex flex-col gap-1 w-full mt-1">
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[7px] text-purple-400 uppercase">Rev</span>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={sendReverb}
              onChange={e => onSendChange("reverb", parseFloat(e.target.value))}
              className="w-full accent-purple-500 cursor-pointer"
            />
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[7px] text-blue-400 uppercase">Dly</span>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={sendDelay}
              onChange={e => onSendChange("delay", parseFloat(e.target.value))}
              className="w-full accent-blue-500 cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MixerView ───────────────────────────────────────────────────────────────

interface MixerViewProps {
  dm: DrumMachineState & DrumMachineActions;
  mixer: MixerState & MixerActions;
  className?: string;
}

export function MixerView({ dm, mixer, className = "" }: MixerViewProps) {
  const pattern = dm.getActivePattern();
  const parts = pattern?.parts ?? [];

  // VU-Meter + GR-Meter Animation via requestAnimationFrame
  const analyserMap = useRef<Map<string, AnalyserNode>>(new Map());
  const rafRef = useRef<number>(0);

  const updateMeters = useCallback(() => {
    // VU-Meter
    analyserMap.current.forEach((analyser, partId) => {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
      mixer.setChannelPeakLevel(partId, Math.min(1, peak));
    });

    // GR-Meter (per-channel compressor reduction)
    parts.forEach(part => {
      if (part.fx.compressorEnabled) {
        const gr = AudioEngine.getCompressorReduction(part.id);
        mixer.setChannelGainReduction(part.id, gr);
      }
    });

    // Sidechain processing
    const scReductions = AudioEngine.processSidechain();
    scReductions.forEach((reduction, destPartId) => {
      mixer.setChannelGainReduction(destPartId, reduction);
    });

    rafRef.current = requestAnimationFrame(updateMeters);
  }, [mixer, parts]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateMeters);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateMeters]);

  // Kanäle im Mixer-Store sicherstellen
  useEffect(() => {
    parts.forEach(p => mixer.ensureChannel(p.id));
  }, [parts, mixer]);

  const handleVolumeChange = useCallback((partId: string, vol: number) => {
    dm.setPartVolume(partId, vol);
    AudioEngine.setChannelVolume(partId, vol);
  }, [dm]);

  const handlePanChange = useCallback((partId: string, pan: number) => {
    dm.setPartPan(partId, pan);
    AudioEngine.setChannelPan(partId, pan);
  }, [dm]);

  const handleSendChange = useCallback((partId: string, bus: "reverb" | "delay", level: number) => {
    mixer.setChannelSend(partId, bus, level);
    AudioEngine.setChannelSend(partId, bus, level);
  }, [mixer]);

  const handleMasterVolume = useCallback((vol: number) => {
    mixer.setMasterVolume(vol);
    AudioEngine.setMasterVolume(vol);
  }, [mixer]);

  const handleFxChange = useCallback((partId: string, fxUpdate: Partial<ChannelFx>) => {
    dm.setPartFx(partId, fxUpdate);
    const part = parts.find(p => p.id === partId);
    if (part) {
      const updatedFx = { ...part.fx, ...fxUpdate };
      AudioEngine.updateChannelFx(partId, updatedFx);
    }
  }, [dm, parts]);

  const handleReturnBusParam = useCallback((param: keyof ReturnBusState, value: number) => {
    mixer.setReturnBusParam(param, value);
    switch (param) {
      case "reverbDecay": AudioEngine.setGlobalReverbDecay(value); break;
      case "reverbWet": AudioEngine.setGlobalReverbWet(value); break;
      case "delayTime": AudioEngine.setGlobalDelayTime(value); break;
      case "delayFeedback": AudioEngine.setGlobalDelayFeedback(value); break;
      case "delayWet": AudioEngine.setGlobalDelayWet(value); break;
    }
  }, [mixer]);

  const handleSidechainChange = useCallback((partId: string, sourceId: string | null) => {
    mixer.setChannelSidechainSource(partId, sourceId);
    AudioEngine.setSidechainSource(partId, sourceId);
  }, [mixer]);

  const fxPanelPartId = mixer.fxPanelPartId;
  const fxPart = fxPanelPartId ? parts.find(p => p.id === fxPanelPartId) : null;

  return (
    <div className={`flex flex-col h-full bg-[#0a0a0a] overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center px-4 py-2 border-b border-slate-800 bg-[#0d0d0d]">
        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Mixer</span>
        <span className="ml-3 text-[10px] text-slate-700">
          {parts.length} Kanäle · Send/Return · Insert FX · Sidechain
        </span>
      </div>

      {/* Channel Strips + Return + Master */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full items-stretch">
          {parts.map(part => {
            const ch = mixer.channels[part.id];
            return (
              <MixerChannel
                key={part.id}
                partId={part.id}
                name={part.name}
                volume={part.volume}
                pan={part.pan}
                muted={part.muted}
                soloed={part.soloed}
                sendReverb={ch?.sends.reverb ?? 0}
                sendDelay={ch?.sends.delay ?? 0}
                peakLevel={ch?.peakLevel ?? 0}
                gainReduction={ch?.gainReduction ?? 0}
                hasCompressor={part.fx.compressorEnabled}
                hasSidechain={!!ch?.sidechainSource}
                fxOpen={fxPanelPartId === part.id}
                onVolumeChange={vol => handleVolumeChange(part.id, vol)}
                onPanChange={pan => handlePanChange(part.id, pan)}
                onMuteToggle={() => dm.setPartMuted(part.id, !part.muted)}
                onSoloToggle={() => dm.setPartSoloed(part.id, !part.soloed)}
                onSendChange={(bus, level) => handleSendChange(part.id, bus, level)}
                onFxToggle={() => mixer.setMixerFxPanelPartId(fxPanelPartId === part.id ? null : part.id)}
              />
            );
          })}

          {/* ── Separator ─── */}
          <div className="w-px bg-slate-700 flex-shrink-0" />

          {/* ── Return: Reverb ─── */}
          <ReturnStrip
            name="Reverb"
            color="text-purple-400"
            accentClass="accent-purple-500"
            params={[
              { label: "Decay", value: mixer.returnBus.reverbDecay, min: 0.1, max: 10, step: 0.1, key: "reverbDecay", unit: "s" },
              { label: "Wet", value: mixer.returnBus.reverbWet, min: 0, max: 1, step: 0.01, key: "reverbWet" },
            ]}
            onParamChange={handleReturnBusParam}
          />

          {/* ── Return: Delay ─── */}
          <ReturnStrip
            name="Delay"
            color="text-blue-400"
            accentClass="accent-blue-500"
            params={[
              { label: "Time", value: mixer.returnBus.delayTime, min: 0.01, max: 2, step: 0.01, key: "delayTime", unit: "s" },
              { label: "FB", value: mixer.returnBus.delayFeedback, min: 0, max: 0.95, step: 0.01, key: "delayFeedback" },
              { label: "Wet", value: mixer.returnBus.delayWet, min: 0, max: 1, step: 0.01, key: "delayWet" },
            ]}
            onParamChange={handleReturnBusParam}
          />

          {/* ── Separator ─── */}
          <div className="w-px bg-slate-700 flex-shrink-0" />

          {/* Master-Kanal */}
          <MixerChannel
            partId="__master__"
            name="Master"
            volume={mixer.masterVolume}
            pan={0}
            muted={false}
            soloed={false}
            sendReverb={0}
            sendDelay={0}
            peakLevel={0}
            gainReduction={0}
            hasCompressor={false}
            hasSidechain={false}
            isMaster
            onVolumeChange={handleMasterVolume}
            onPanChange={() => {}}
            onMuteToggle={() => {}}
            onSoloToggle={() => {}}
            onSendChange={() => {}}
          />
        </div>
      </div>

      {/* FX Panel (shown below channel strips when a channel is selected) */}
      {fxPart && (
        <div className="border-t border-slate-700 p-2 bg-[#0d0d0d]">
          <MixerFxPanel
            partId={fxPart.id}
            fx={fxPart.fx}
            parts={parts.map(p => ({ id: p.id, name: p.name }))}
            sidechainSource={mixer.channels[fxPart.id]?.sidechainSource ?? null}
            onFxChange={fx => handleFxChange(fxPart.id, fx)}
            onSidechainChange={sourceId => handleSidechainChange(fxPart.id, sourceId)}
            onClose={() => mixer.setMixerFxPanelPartId(null)}
          />
        </div>
      )}

      {/* Bus-Labels */}
      <div className="flex gap-4 px-4 py-1 border-t border-slate-800 bg-[#0d0d0d]">
        <span className="text-[9px] text-purple-400 uppercase tracking-wide">
          ● Reverb Return (Decay: {mixer.returnBus.reverbDecay.toFixed(1)}s)
        </span>
        <span className="text-[9px] text-blue-400 uppercase tracking-wide">
          ● Delay Return (Time: {mixer.returnBus.delayTime.toFixed(2)}s, FB: {(mixer.returnBus.delayFeedback * 100).toFixed(0)}%)
        </span>
        {fxPanelPartId && fxPart && (
          <span className="text-[9px] text-purple-300 uppercase tracking-wide ml-auto">
            ● FX: {fxPart.name}
          </span>
        )}
      </div>
    </div>
  );
}
