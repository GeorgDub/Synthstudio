/**
 * Synthstudio – FxPanel
 *
 * Per-Kanal Effekt-Panel mit Tabs für Filter, EQ, Compressor, Delay, Reverb.
 * Aus DrumMachine.tsx ausgelagert.
 *
 * Aufgespalten in:
 *  - `FxPanelBody` — die reinen Tabs + Knobs (ohne Wrapper-Positionierung,
 *    ohne Header). Wird auch vom FxPopupApp (Multi-Window-Workspace Phase 1)
 *    direkt genutzt.
 *  - `FxPanel` — bisherige absolute-positionierte Dropdown-Variante mit
 *    Header inklusive Close-Button.
 */
import React, { useState } from "react";
import { X } from "lucide-react";
import type { PartData, ChannelFx, FxParamKey } from "@/audio/AudioEngine";
import { useElectron } from "../../../../electron/useElectron";
import { useMidiLearn } from "@/hooks/useMidiLearn";

export interface FxPanelProps {
  part: PartData;
  onFxChange: (fx: Partial<ChannelFx>) => void;
  onClose: () => void;
}

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  /** v1.90: Optional — wenn beide gesetzt sind, bekommt der Knob einen
   *  Right-Click-MIDI-Learn-Handler für das passende fxParam-Target. */
  fxParam?: FxParamKey;
  partId?: string;
  partName?: string;
}

function Knob({ label, value, min, max, step = 0.01, onChange, unit = "", fxParam, partId, partName }: KnobProps) {
  // v1.90: useMidiLearn ist immer aufgerufen (no-op wenn fxParam/partId fehlen,
  // damit der Hook-Order konsistent bleibt). Wir bauen das Target conditional.
  const target = fxParam && partId
    ? { type: "fxParam" as const, partId, param: fxParam, partName }
    : null;
  const learn = useMidiLearn(target ?? { type: "openSettings" }); // dummy wenn null
  const learnable = !!target;

  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[52px] relative">
      <span className="text-[9px] text-text-dim uppercase tracking-wide">
        {label}
        {learnable && learn.isMapped && (
          <span className="ml-1 text-accent-secondary font-mono">·CC{learn.mappedCC}</span>
        )}
      </span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        onContextMenu={learnable ? learn.onContextMenu : undefined}
        className="w-12 accent-accent-primary cursor-pointer"
        style={{ writingMode: "horizontal-tb" }}
        title={learnable ? `${label} · Rechtsklick: MIDI-Learn${learn.isMapped ? ` · CC${learn.mappedCC}` : ""}` : label}
      />
      <span className="text-[9px] text-text-muted font-mono">
        {value.toFixed(unit === "Hz" ? 0 : unit === "dB" ? 1 : 2)}{unit}
      </span>
      {learnable && learn.menu}
    </div>
  );
}

interface ToggleProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ label, value, onChange }: ToggleProps) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={[
        "px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
        value ? "bg-accent-primary text-white" : "bg-bg-elevated text-text-muted hover:bg-bg-elevated",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export interface FxPanelBodyProps {
  fx: ChannelFx;
  onFxChange: (fx: Partial<ChannelFx>) => void;
  /** v1.90: Optional — wenn gesetzt, sind alle FX-Knöpfe per Rechtsklick
   *  MIDI-bindbar (Right-Click-MIDI-Learn für fxParam-Targets). */
  partId?: string;
  partName?: string;
}

/**
 * Reine FX-Tabs + Knobs ohne Wrapper-Positionierung und ohne Header.
 * Wird sowohl im Dropdown-FxPanel als auch im pinnable FxPopupApp eingesetzt.
 */
export function FxPanelBody({ fx, onFxChange, partId, partName }: FxPanelBodyProps) {
  const [tab, setTab] = useState<"filter" | "eq" | "dynamics" | "delay" | "reverb">("filter");
  return (
    <>
      {/* Tabs */}
      <div className="flex gap-1 mb-3 border-b border-border-color pb-2">
        {(["filter", "eq", "dynamics", "delay", "reverb"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-2 py-0.5 rounded text-[10px] capitalize transition-colors",
              tab === t ? "bg-accent-primary/70 text-white" : "text-text-dim hover:text-text-primary",
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
              className="bg-bg-elevated text-text-primary text-[10px] rounded px-1 py-0.5 border border-border-color"
            >
              <option value="lowpass">Low Pass</option>
              <option value="highpass">High Pass</option>
              <option value="bandpass">Band Pass</option>
              <option value="notch">Notch</option>
            </select>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Knob label="Freq" value={fx.filterFreq} min={20} max={20000} step={10}
              onChange={v => onFxChange({ filterFreq: v })} unit="Hz"
              fxParam="filterFreq" partId={partId} partName={partName} />
            <Knob label="Resonanz" value={fx.filterQ} min={0.1} max={20} step={0.1}
              onChange={v => onFxChange({ filterQ: v })}
              fxParam="filterQ" partId={partId} partName={partName} />
          </div>
          <div className="border-t border-border-color pt-2">
            <div className="flex items-center gap-2 mb-2">
              <Toggle label="Distortion" value={fx.distortionEnabled} onChange={v => onFxChange({ distortionEnabled: v })} />
            </div>
            <Knob label="Drive" value={fx.distortionAmount} min={0} max={400} step={1}
              onChange={v => onFxChange({ distortionAmount: v })}
              fxParam="distortionAmount" partId={partId} partName={partName} />
          </div>
        </div>
      )}

      {/* EQ */}
      {tab === "eq" && (
        <div className="space-y-3">
          <Toggle label="3-Band EQ" value={fx.eqEnabled} onChange={v => onFxChange({ eqEnabled: v })} />
          <div className="flex gap-3">
            <Knob label="Low" value={fx.eqLow} min={-15} max={15} step={0.5}
              onChange={v => onFxChange({ eqLow: v })} unit="dB"
              fxParam="eqLow" partId={partId} partName={partName} />
            <Knob label="Mid" value={fx.eqMid} min={-15} max={15} step={0.5}
              onChange={v => onFxChange({ eqMid: v })} unit="dB"
              fxParam="eqMid" partId={partId} partName={partName} />
            <Knob label="High" value={fx.eqHigh} min={-15} max={15} step={0.5}
              onChange={v => onFxChange({ eqHigh: v })} unit="dB"
              fxParam="eqHigh" partId={partId} partName={partName} />
          </div>
        </div>
      )}

      {/* Compressor */}
      {tab === "dynamics" && (
        <div className="space-y-3">
          <Toggle label="Compressor" value={fx.compressorEnabled} onChange={v => onFxChange({ compressorEnabled: v })} />
          <div className="flex gap-3 flex-wrap">
            <Knob label="Threshold" value={fx.compressorThreshold} min={-60} max={0} step={0.5}
              onChange={v => onFxChange({ compressorThreshold: v })} unit="dB"
              fxParam="compressorThreshold" partId={partId} partName={partName} />
            <Knob label="Ratio" value={fx.compressorRatio} min={1} max={20} step={0.5}
              onChange={v => onFxChange({ compressorRatio: v })}
              fxParam="compressorRatio" partId={partId} partName={partName} />
            <Knob label="Attack" value={fx.compressorAttack} min={0} max={1} step={0.001}
              onChange={v => onFxChange({ compressorAttack: v })}
              fxParam="compressorAttack" partId={partId} partName={partName} />
            <Knob label="Release" value={fx.compressorRelease} min={0} max={1} step={0.01}
              onChange={v => onFxChange({ compressorRelease: v })}
              fxParam="compressorRelease" partId={partId} partName={partName} />
          </div>
        </div>
      )}

      {/* Delay */}
      {tab === "delay" && (
        <div className="space-y-3">
          <Toggle label="Delay" value={fx.delayEnabled} onChange={v => onFxChange({ delayEnabled: v })} />
          <div className="flex gap-3 flex-wrap">
            <Knob label="Zeit" value={fx.delayTime} min={0.01} max={2} step={0.01}
              onChange={v => onFxChange({ delayTime: v })}
              fxParam="delayTime" partId={partId} partName={partName} />
            <Knob label="Feedback" value={fx.delayFeedback} min={0} max={0.95} step={0.01}
              onChange={v => onFxChange({ delayFeedback: v })}
              fxParam="delayFeedback" partId={partId} partName={partName} />
            <Knob label="Mix" value={fx.delayMix} min={0} max={1} step={0.01}
              onChange={v => onFxChange({ delayMix: v })}
              fxParam="delayMix" partId={partId} partName={partName} />
          </div>
        </div>
      )}

      {/* Reverb */}
      {tab === "reverb" && (
        <div className="space-y-3">
          <Toggle label="Reverb" value={fx.reverbEnabled} onChange={v => onFxChange({ reverbEnabled: v })} />
          <div className="flex gap-3">
            <Knob label="Decay" value={fx.reverbDecay} min={0.1} max={10} step={0.1}
              onChange={v => onFxChange({ reverbDecay: v })}
              fxParam="reverbDecay" partId={partId} partName={partName} />
            <Knob label="Mix" value={fx.reverbMix} min={0} max={1} step={0.01}
              onChange={v => onFxChange({ reverbMix: v })}
              fxParam="reverbMix" partId={partId} partName={partName} />
          </div>
        </div>
      )}
    </>
  );
}

export function FxPanel({ part, onFxChange, onClose }: FxPanelProps) {
  const electron = useElectron();
  // Pin-Button nur in Electron sichtbar — Multi-Window-Workspace Phase 1.
  // Pop-Out: schließt das Dropdown-Panel und öffnet ein eigenes BrowserWindow
  // mit dem FX-Inhalt für diesen Kanal.
  const handlePin = () => {
    if (!electron.isElectron) return;
    void electron.openFxWindow?.(part.id);
    onClose();
  };

  return (
    <div className="absolute z-50 left-0 top-full mt-1 bg-bg-elevated border border-border-color rounded-lg shadow-2xl p-3 w-[340px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text-primary">FX: {part.name}</span>
        <div className="flex items-center gap-1">
          {electron.isElectron && (
            <button
              onClick={handlePin}
              className="text-text-muted hover:text-accent-primary leading-none p-1 rounded flex items-center justify-center transition-colors text-[12px]"
              aria-label="In eigenes Fenster abkoppeln"
              title="In eigenes Fenster abkoppeln"
              data-testid={`fx-panel-pin-${part.id}`}
            >
              📌
            </button>
          )}
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary leading-none p-1 rounded flex items-center justify-center transition-colors"
            aria-label="Close"
            title="Schließen"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <FxPanelBody fx={part.fx} onFxChange={onFxChange} partId={part.id} partName={part.name} />
    </div>
  );
}
