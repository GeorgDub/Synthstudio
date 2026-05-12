/**
 * Synthstudio – StepInspector
 *
 * Inspector-Panel am unteren Rand der DrumMachine.
 * Editiert Velocity, Pitch, Probability, Condition, Param-Locks für einen Step.
 * Aus DrumMachine.tsx ausgelagert.
 */
import React from "react";
import type { StepData, StepCondition, StepParamLock } from "@/audio/AudioEngine";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { ResizablePanelHandle } from "@/components/UI/ResizablePanelHandle";
import { pitchToLabel, conditionToLabel, CONDITION_OPTIONS, NOTE_LENGTH_PRESETS } from "./drumMachineHelpers";

export interface StepInspectorProps {
  partName: string;
  stepIndex: number;
  step: StepData | undefined;
  onSetVelocity: (v: number) => void;
  onSetPitch: (p: number) => void;
  onSetProbability: (p: number) => void;
  onSetCondition: (c: StepCondition) => void;
  onSetReverse: (r: boolean) => void;
  onSetParamLock: (lock: StepParamLock | undefined) => void;
  onSetLength: (length: number) => void;
  onSetChainNext: (chain: "up" | "down" | "none" | undefined) => void;
  onToggle: () => void;
  onClose: () => void;
}

export function StepInspector({
  partName, stepIndex, step,
  onSetVelocity, onSetPitch, onSetProbability, onSetCondition, onSetReverse,
  onSetParamLock, onSetLength, onSetChainNext, onToggle, onClose,
}: StepInspectorProps) {
  const velocity    = step?.velocity    ?? 100;
  const pitch       = step?.pitch       ?? 0;
  const probability = step?.probability ?? 100;
  const condition   = step?.condition   ?? { type: "always" as const };
  const active      = step?.active      ?? false;
  const noteLength  = step?.length      ?? 1;
  const reverse     = step?.reverse     ?? false;

  const PROB_PRESETS = [100, 75, 50, 25];
  const { height: inspectorHeight, handleMouseDown: inspectorDragStart } =
    useResizablePanel({ defaultHeight: 220, minHeight: 140, maxHeight: 500, storageKey: "ss-step-inspector-height", direction: "up" });

  return (
    <div className="flex-shrink-0 border-t-2 border-accent-primary bg-bg-panel flex flex-col overflow-hidden" style={{ height: inspectorHeight }}>
      {/* Drag Handle */}
      <ResizablePanelHandle onMouseDown={inspectorDragStart} direction="up" />
      {/* Scrollbarer Inhalt */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10px] font-bold text-accent-primary uppercase tracking-wider">Step Inspector</span>
        <span className="text-xs text-text-primary font-medium">{partName}</span>
        <span className="text-[10px] text-text-dim">Step {stepIndex + 1}</span>
        <div className="flex-1" />
        {/* Active toggle */}
        <button
          onClick={onToggle}
          className={`px-3 py-1 text-xs rounded font-bold transition-colors ${active ? "bg-accent-primary text-white" : "bg-bg-elevated text-text-dim border border-border-color hover:border-accent-primary"}`}
        >
          {active ? "● AN" : "○ AUS"}
        </button>
        <button onClick={onClose} className="text-text-dim hover:text-text-primary text-lg leading-none ml-2">✕</button>
      </div>

      {/* Note Length */}
      <div className="flex items-center gap-3 mb-3 pb-2 border-b border-border-color/50">
        <span className="text-[10px] text-text-dim uppercase tracking-wide flex-shrink-0">Note Länge</span>
        <div className="flex gap-1">
          {NOTE_LENGTH_PRESETS.map(p => (
            <button key={p.value} onClick={() => onSetLength(p.value)}
              className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                Math.abs(noteLength - p.value) < 0.01
                  ? "border-accent-secondary bg-accent-secondary/20 text-accent-secondary"
                  : "border-border-color text-text-dim hover:text-text-primary"
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] font-mono text-accent-secondary">{noteLength}× Step</span>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {/* Velocity */}
        <div>
          <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide">Velocity</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-5 bg-bg-elevated rounded-sm relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-sm transition-all"
                style={{ width: `${(velocity / 127) * 100}%`, background: velocity > 100 ? "var(--ss-accent-secondary)" : velocity > 64 ? "var(--ss-accent-primary)" : "var(--ss-accent-primary)", opacity: 0.7 + velocity / 127 * 0.3 }}
              />
            </div>
            <span className="text-xs font-mono text-text-primary w-7 text-right">{velocity}</span>
          </div>
          <input
            type="range" min={1} max={127} value={velocity}
            onChange={e => onSetVelocity(Number(e.target.value))}
            className="w-full mt-1 accent-accent-primary"
          />
          <div className="flex gap-1 mt-1">
            {[32, 64, 96, 127].map(v => (
              <button key={v} onClick={() => onSetVelocity(v)}
                className="flex-1 text-[9px] rounded bg-bg-elevated hover:bg-accent-primary/20 text-text-dim py-0.5 transition-colors">
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Pitch */}
        <div>
          <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide">Pitch</div>
          <div className="text-xs font-mono text-accent-secondary mb-1">{pitchToLabel(pitch)}</div>
          <input
            type="range" min={-24} max={24} step={1} value={pitch}
            onChange={e => onSetPitch(Number(e.target.value))}
            className="w-full accent-accent-secondary"
          />
          <div className="flex gap-1 mt-1">
            {[-12, -7, 0, 7, 12].map(p => (
              <button key={p} onClick={() => onSetPitch(p)}
                className={`flex-1 text-[9px] rounded py-0.5 transition-colors ${pitch === p ? "bg-accent-secondary/30 text-accent-secondary" : "bg-bg-elevated text-text-dim hover:bg-accent-secondary/20"}`}>
                {p >= 0 ? `+${p}` : p}
              </button>
            ))}
          </div>
        </div>

        {/* Wahrscheinlichkeit */}
        <div>
          <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide">Wahrscheinlichkeit</div>
          <div className="text-xs font-mono text-text-primary mb-1">{probability}%</div>
          <input
            type="range" min={0} max={100} step={5} value={probability}
            onChange={e => onSetProbability(Number(e.target.value))}
            className="w-full accent-accent-primary"
          />
          <div className="flex gap-1 mt-1">
            {PROB_PRESETS.map(p => (
              <button key={p} onClick={() => onSetProbability(p)}
                className={`flex-1 text-[9px] rounded py-0.5 transition-colors ${probability === p ? "bg-accent-primary/30 text-accent-primary" : "bg-bg-elevated text-text-dim hover:bg-accent-primary/20"}`}>
                {p}%
              </button>
            ))}
          </div>
        </div>

        {/* Condition + Reverse */}
        <div>
          <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide">Bedingung</div>
          <div className="text-xs font-mono text-text-primary mb-1">{conditionToLabel(condition)}</div>
          <div className="grid grid-cols-5 gap-0.5 mb-2">
            {CONDITION_OPTIONS.map(opt => {
              const isCurrent = conditionToLabel(condition) === opt.label;
              return (
                <button key={opt.label} onClick={() => onSetCondition(opt.value)}
                  className={`text-[9px] rounded py-0.5 px-0.5 transition-colors ${isCurrent ? "bg-accent-secondary/30 text-accent-secondary font-bold" : "bg-bg-elevated text-text-dim hover:bg-accent-secondary/20"}`}>
                  {opt.label}
                </button>
              );
            })}
          </div>
          {/* Parameter Lock */}
          <div className="mt-2 border-t border-border-color/50 pt-2">
            <div className="text-[9px] text-text-dim uppercase tracking-wide mb-1.5">
              Param Lock {step?.paramLock ? <span className="text-accent-primary ml-1">● aktiv</span> : ""}
            </div>
            {(["filterFreq","volume","pan","reverbSend","delaySend"] as const).map(key => {
              const labels: Record<string, string> = { filterFreq:"Filter Hz", volume:"Vol", pan:"Pan", reverbSend:"Rev", delaySend:"Dly" };
              const ranges: Record<string, [number,number]> = { filterFreq:[20,20000], volume:[0,1], pan:[-1,1], reverbSend:[0,1], delaySend:[0,1] };
              const [mn,mx] = ranges[key];
              const val = step?.paramLock?.[key as keyof typeof step.paramLock] as number | undefined;
              return (
                <div key={key} className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[9px] text-text-dim w-14">{labels[key]}</span>
                  <input type="range" min={mn} max={mx} step={(mx-mn)/100}
                    value={val ?? (mn + (mx-mn)/2)}
                    className={`flex-1 h-1 ${val !== undefined ? "accent-accent-primary" : "accent-border-color"}`}
                    onChange={e => onSetParamLock({ ...step?.paramLock, [key]: Number(e.target.value) })}
                  />
                  {val !== undefined ? (
                    <button onClick={() => {
                      const next = { ...step?.paramLock };
                      delete (next as Record<string,unknown>)[key];
                      onSetParamLock(Object.keys(next).length > 0 ? next as never : undefined);
                    }} className="text-[9px] text-text-dim hover:text-accent-danger">✕</button>
                  ) : (
                    <button onClick={() => onSetParamLock({ ...step?.paramLock, [key]: (mn+mx)/2 })}
                      className="text-[9px] text-text-dim hover:text-accent-primary">+</button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Reverse */}
          <button
            onClick={() => onSetReverse(!reverse)}
            className={`w-full py-1 text-[10px] rounded border font-bold transition-colors ${reverse ? "border-accent-danger bg-accent-danger/20 text-accent-danger" : "border-border-color text-text-dim hover:border-accent-danger hover:text-accent-danger"}`}
            title="Sample für diesen Step rückwärts abspielen"
          >
            {reverse ? "↩ REV AN" : "↩ REV AUS"}
          </button>

          {/* Probability Chain */}
          <div className="mt-1 border-t border-border-color/50 pt-1">
            <div className="text-[9px] text-text-dim mb-1 uppercase tracking-wide">Prob Chain (Nächster)</div>
            <div className="flex gap-0.5">
              {(["none", "up", "down"] as const).map(c => {
                const chain = step?.chainNext ?? "none";
                return (
                  <button key={c} onClick={() => onSetChainNext(c === "none" ? undefined : c)}
                    className={`flex-1 py-0.5 text-[9px] rounded border transition-colors ${
                      chain === c ? "border-accent-primary bg-accent-primary/20 text-accent-primary"
                      : "border-border-color text-text-dim hover:text-text-primary"
                    }`}>
                    {c === "none" ? "—" : c === "up" ? "+25%" : "−25%"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      </div>{/* Ende scroll-container */}
    </div>
  );
}
