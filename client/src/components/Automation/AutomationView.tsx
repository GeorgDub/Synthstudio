/**
 * Synthstudio – AutomationView
 *
 * Step-basierter Automation-Editor für BPM, Master-Volume und Kanal-Parameter.
 * Jede Lane zeigt 16/32 Steps als klick-/ziehbare Balken.
 */
import React, { useCallback, useRef, useState } from "react";
import type { AutomationLane, AutomationTarget } from "@/store/useAutomationStore";
import type { PartData } from "@/audio/AudioEngine";

// ─── Preset-Targets ───────────────────────────────────────────────────────────

function buildTargetOptions(parts: PartData[]): Array<{ value: AutomationTarget; label: string; group: string }> {
  const opts: Array<{ value: AutomationTarget; label: string; group: string }> = [
    { value: "bpm",        label: "BPM",          group: "Global" },
    { value: "master-vol", label: "Master Volume", group: "Global" },
  ];
  for (const p of parts) {
    opts.push({ value: `vol:${p.id}`,      label: `${p.name} – Volume`,  group: "Kanäle" });
    opts.push({ value: `pan:${p.id}`,      label: `${p.name} – Pan`,     group: "Kanäle" });
    opts.push({ value: `send-rev:${p.id}`, label: `${p.name} – Reverb`,  group: "Sends" });
    opts.push({ value: `send-dly:${p.id}`, label: `${p.name} – Delay`,   group: "Sends" });
  }
  return opts;
}

// ─── Lane-Editor ──────────────────────────────────────────────────────────────

interface LaneEditorProps {
  lane: AutomationLane;
  stepCount: number;
  currentStep?: number;
  onSetPoint: (step: number, value: number) => void;
  onClearPoint: (step: number) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onRemove: () => void;
  onClear: () => void;
}

function LaneEditor({ lane, stepCount, currentStep, onSetPoint, onClearPoint, onToggleEnabled, onRemove, onClear }: LaneEditorProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const valueToHeight = (v: number) =>
    Math.round(((v - lane.min) / (lane.max - lane.min)) * 100);

  const posToValue = (clientX: number, clientY: number): { step: number; value: number } | null => {
    const el = barRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const step = Math.floor(((clientX - rect.left) / rect.width) * stepCount);
    const rawValue = 1 - (clientY - rect.top) / rect.height;
    const value = lane.min + Math.max(0, Math.min(1, rawValue)) * (lane.max - lane.min);
    if (step < 0 || step >= stepCount) return null;
    return { step, value };
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    dragging.current = true;
    const pos = posToValue(e.clientX, e.clientY);
    if (!pos) return;
    if (e.button === 2) { onClearPoint(pos.step); return; }
    onSetPoint(pos.step, pos.value);

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const p = posToValue(ev.clientX, ev.clientY);
      if (p) onSetPoint(p.step, p.value);
    };
    const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane, stepCount, onSetPoint, onClearPoint]);

  const formatValue = (v: number) => {
    if (lane.target === "bpm") return `${Math.round(v)}`;
    if (lane.target.startsWith("pan")) return v.toFixed(2);
    return `${Math.round(v * 100)}%`;
  };

  return (
    <div className="mb-3 rounded border border-border-color bg-bg-panel overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1 bg-bg-elevated border-b border-border-color">
        <button
          onClick={() => onToggleEnabled(!lane.enabled)}
          className={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
            lane.enabled ? "bg-accent-primary border-accent-primary" : "border-border-color bg-transparent"
          }`}
          title={lane.enabled ? "Deaktivieren" : "Aktivieren"}
        />
        <span className="text-xs font-medium text-text-primary flex-1 truncate">{lane.label}</span>
        <span className="text-[10px] text-text-dim font-mono">
          {lane.min} – {lane.max}
        </span>
        <button onClick={onClear} title="Lane leeren" className="text-[10px] text-text-dim hover:text-accent-danger px-1">✕✕</button>
        <button onClick={onRemove} title="Lane löschen" className="text-[10px] text-text-dim hover:text-accent-danger px-1">🗑</button>
      </div>

      {/* Step Bars */}
      <div
        ref={barRef}
        onMouseDown={handleMouseDown}
        onContextMenu={e => e.preventDefault()}
        className="flex gap-px p-1 h-16 cursor-crosshair select-none"
        style={{ background: "var(--ss-bg-base)" }}
      >
        {Array.from({ length: stepCount }, (_, i) => {
          const val = lane.points[i];
          const pct = val !== undefined ? valueToHeight(val) : null;
          const isCurrentStep = i === currentStep;

          // Interpolierten Wert zeigen wenn kein direkter Punkt
          let interpPct: number | null = null;
          if (pct === null) {
            const keys = Object.keys(lane.points).map(Number).sort((a, b) => a - b);
            if (keys.length >= 2) {
              const prev = keys.filter(k => k < i).pop();
              const next = keys.find(k => k > i);
              if (prev !== undefined && next !== undefined) {
                const t = (i - prev) / (next - prev);
                interpPct = valueToHeight(lane.points[prev] + t * (lane.points[next] - lane.points[prev]));
              }
            }
          }

          return (
            <div key={i} className="flex-1 flex flex-col-reverse relative" style={{ minWidth: 4 }}>
              {/* Interpolierter Verlauf (gestrichelt) */}
              {interpPct !== null && (
                <div
                  className="absolute bottom-0 left-0 right-0 border-t border-dashed"
                  style={{
                    height: `${interpPct}%`,
                    borderColor: "var(--ss-accent-primary)",
                    opacity: 0.3,
                  }}
                />
              )}
              {/* Direkter Punkt (voll) */}
              {pct !== null && (
                <div
                  className="w-full rounded-t-sm transition-none"
                  style={{
                    height: `${Math.max(2, pct)}%`,
                    background: isCurrentStep
                      ? "var(--ss-accent-secondary)"
                      : lane.enabled
                        ? "var(--ss-accent-primary)"
                        : "var(--ss-text-dim)",
                    opacity: lane.enabled ? 0.9 : 0.4,
                  }}
                  title={`Step ${i + 1}: ${formatValue(val!)}`}
                />
              )}
              {/* Playhead */}
              {isCurrentStep && (
                <div className="absolute inset-0 border-l-2 border-accent-secondary pointer-events-none" style={{ opacity: 0.7 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export interface AutomationViewProps {
  lanes: AutomationLane[];
  stepCount: 16 | 32;
  currentStep?: number;
  parts: PartData[];
  recording: boolean;
  onAddLane: (target: AutomationTarget, label: string) => void;
  onRemoveLane: (id: string) => void;
  onSetPoint: (laneId: string, step: number, value: number) => void;
  onClearPoint: (laneId: string, step: number) => void;
  onClearLane: (id: string) => void;
  onToggleLane: (id: string, enabled: boolean) => void;
  onToggleRecording: () => void;
  currentStepPerLane?: number;
}

export function AutomationView({
  lanes, stepCount, currentStep, parts, recording,
  onAddLane, onRemoveLane, onSetPoint, onClearPoint, onClearLane, onToggleLane, onToggleRecording,
}: AutomationViewProps) {
  const [selectedTarget, setSelectedTarget] = useState<AutomationTarget>("bpm");
  const targetOptions = buildTargetOptions(parts);

  const handleAdd = () => {
    const opt = targetOptions.find(o => o.value === selectedTarget);
    onAddLane(selectedTarget, opt?.label ?? selectedTarget);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-color bg-bg-panel flex-shrink-0">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Automation</span>

        {/* Record-Button */}
        <button
          onClick={onToggleRecording}
          className={`px-2 py-1 text-[10px] rounded font-bold transition-colors ${
            recording
              ? "bg-accent-danger text-white animate-pulse"
              : "bg-bg-elevated text-text-dim hover:text-accent-danger"
          }`}
          title="Live-Aufnahme: Parameteränderungen werden aufgezeichnet"
        >
          ● REC
        </button>

        <div className="flex-1" />

        {/* Lane hinzufügen */}
        <select
          value={selectedTarget}
          onChange={e => setSelectedTarget(e.target.value as AutomationTarget)}
          className="text-[10px] rounded border border-border-color bg-bg-elevated text-text-primary px-2 py-1"
        >
          {["Global", "Kanäle", "Sends"].map(group => {
            const opts = targetOptions.filter(o => o.group === group);
            if (!opts.length) return null;
            return (
              <optgroup key={group} label={group}>
                {opts.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <button
          onClick={handleAdd}
          className="px-3 py-1 text-[10px] rounded bg-accent-primary text-white hover:opacity-80 transition-opacity"
        >
          + Lane
        </button>
      </div>

      {/* Lanes */}
      <div className="flex-1 overflow-y-auto p-3">
        {lanes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-dim text-sm gap-2">
            <span className="text-2xl opacity-40">🎛</span>
            <span>Keine Automation-Lanes</span>
            <span className="text-xs text-text-dim">Wähle einen Parameter und klicke "+ Lane"</span>
          </div>
        ) : (
          lanes.map(lane => (
            <LaneEditor
              key={lane.id}
              lane={lane}
              stepCount={stepCount}
              currentStep={currentStep}
              onSetPoint={(step, value) => onSetPoint(lane.id, step, value)}
              onClearPoint={step => onClearPoint(lane.id, step)}
              onToggleEnabled={enabled => onToggleLane(lane.id, enabled)}
              onRemove={() => onRemoveLane(lane.id)}
              onClear={() => onClearLane(lane.id)}
            />
          ))
        )}
      </div>

      {lanes.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border-color bg-bg-panel text-[10px] text-text-dim flex-shrink-0">
          Linksklick: Wert setzen · Rechtsklick: Punkt löschen · Ziehen: Verlauf zeichnen
        </div>
      )}
    </div>
  );
}
