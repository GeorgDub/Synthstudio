/**
 * Synthstudio – MacroPanel
 *
 * 8 Makro-Knöpfe für Live-Performance: Ein Makro steuert N Parameter gleichzeitig.
 * Jeder Makro hat einen Slider (0–1) und eine Binding-Liste.
 *
 * Integration: Wird in der DrumMachine-Toolbar als "▸ Makros"-Panel angezeigt.
 * MIDI-Zuweisung über das normale MIDI CC-System möglich.
 */
import React, { useState } from "react";
import { X } from "lucide-react";
import {
  useMacroStore,
  setMacroValue,
  setMacroLabel,
  addMacroBinding,
  removeMacroBinding,
  type Macro,
  type MacroTargetType,
  MACRO_COLORS,
} from "@/store/useMacroStore";
import type { PartData } from "@/audio/AudioEngine";

// ─── Target-Labels ───────────────────────────────────────────────────────────

const TARGET_OPTIONS: Array<{ value: MacroTargetType; label: string; needsPart: boolean }> = [
  { value: "channel-vol",      label: "Kanal Volume",     needsPart: true },
  { value: "channel-pan",      label: "Kanal Pan",        needsPart: true },
  { value: "channel-send-rev", label: "Reverb Send",      needsPart: true },
  { value: "channel-send-dly", label: "Delay Send",       needsPart: true },
  { value: "master-vol",       label: "Master Volume",    needsPart: false },
  { value: "bpm",              label: "BPM",              needsPart: false },
  { value: "lfo-rate",         label: "LFO Rate",         needsPart: true },
  { value: "lfo-depth",        label: "LFO Depth",        needsPart: true },
];

// ─── Knob-Darstellung ────────────────────────────────────────────────────────

function MacroKnob({ macro, onEdit }: { macro: Macro; onEdit: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-[60px]">
      {/* Label */}
      <span className="text-[9px] text-text-dim truncate w-full text-center" title={macro.label}>
        {macro.label}
      </span>

      {/* Slider (vertikal via rotate) */}
      <div className="relative h-20 flex items-center justify-center">
        <input
          type="range"
          min={0} max={1} step={0.01}
          value={macro.value}
          onChange={e => setMacroValue(macro.index, Number(e.target.value))}
          className="h-16"
          style={{
            writingMode: "vertical-lr",
            direction: "rtl",
            accentColor: macro.color,
            cursor: "pointer",
          }}
        />
      </div>

      {/* Wert + Edit-Button */}
      <span className="text-[10px] font-mono" style={{ color: macro.color }}>
        {Math.round(macro.value * 100)}%
      </span>
      <button
        onClick={onEdit}
        className="text-[9px] text-text-dim hover:text-text-primary transition-colors px-1"
        title="Bindings bearbeiten"
      >
        ⚙
      </button>
    </div>
  );
}

// ─── Binding-Editor ──────────────────────────────────────────────────────────

function BindingEditor({ macro, parts, onClose }: { macro: Macro; parts: PartData[]; onClose: () => void }) {
  const [newTarget, setNewTarget] = useState<MacroTargetType>("channel-vol");
  const [newPartId, setNewPartId] = useState(parts[0]?.id ?? "");
  const [newMin, setNewMin] = useState(0);
  const [newMax, setNewMax] = useState(1);

  const opt = TARGET_OPTIONS.find(o => o.value === newTarget);

  const handleAdd = () => {
    const part = parts.find(p => p.id === newPartId);
    addMacroBinding(macro.index, {
      target: newTarget,
      partId: opt?.needsPart ? newPartId : undefined,
      partName: opt?.needsPart ? (part?.name ?? newPartId) : undefined,
      minValue: newMin,
      maxValue: newMax,
    });
  };

  return (
    <div className="absolute bottom-full mb-2 left-0 z-50 w-80 bg-bg-panel border border-border-color rounded-xl shadow-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold text-text-primary" style={{ color: macro.color }}>
          {macro.label}
        </span>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary p-1 rounded flex items-center justify-center transition-colors"
          aria-label="Close"
          title="Schließen"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Label bearbeiten */}
      <input
        className="w-full mb-3 px-2 py-1 text-xs rounded bg-bg-elevated border border-border-color text-text-primary"
        value={macro.label}
        onChange={e => setMacroLabel(macro.index, e.target.value)}
        placeholder="Makro-Name"
        maxLength={16}
      />

      {/* Bestehende Bindings */}
      {macro.bindings.length > 0 && (
        <div className="mb-3 space-y-1">
          <div className="text-[10px] text-text-dim uppercase tracking-wide mb-1">Bindings</div>
          {macro.bindings.map(b => (
            <div key={b.id} className="flex items-center gap-2 text-xs bg-bg-elevated rounded px-2 py-1">
              <span className="flex-1 text-text-muted">
                {TARGET_OPTIONS.find(o => o.value === b.target)?.label}
                {b.partName ? ` – ${b.partName}` : ""}
              </span>
              <span className="text-text-dim font-mono">{b.minValue}→{b.maxValue}</span>
              <button onClick={() => removeMacroBinding(macro.index, b.id)}
                className="text-text-dim hover:text-accent-danger">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Neue Binding hinzufügen */}
      <div className="border-t border-border-color pt-3 space-y-2">
        <div className="text-[10px] text-text-dim uppercase tracking-wide">Neue Binding</div>
        <select value={newTarget} onChange={e => setNewTarget(e.target.value as MacroTargetType)}
          className="w-full text-xs bg-bg-elevated rounded border border-border-color px-2 py-1 text-text-primary">
          {TARGET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {opt?.needsPart && (
          <select value={newPartId} onChange={e => setNewPartId(e.target.value)}
            className="w-full text-xs bg-bg-elevated rounded border border-border-color px-2 py-1 text-text-primary">
            {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-text-dim">Min</label>
            <input type="number" value={newMin} onChange={e => setNewMin(Number(e.target.value))} step={0.01}
              className="w-full text-xs bg-bg-elevated rounded border border-border-color px-2 py-0.5 text-text-primary" />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-text-dim">Max</label>
            <input type="number" value={newMax} onChange={e => setNewMax(Number(e.target.value))} step={0.01}
              className="w-full text-xs bg-bg-elevated rounded border border-border-color px-2 py-0.5 text-text-primary" />
          </div>
        </div>

        <button onClick={handleAdd}
          className="w-full py-1 text-xs rounded bg-accent-primary text-white hover:opacity-80 font-bold transition-opacity">
          + Binding hinzufügen
        </button>
      </div>
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

interface MacroPanelProps {
  parts: PartData[];
}

export function MacroPanel({ parts }: MacroPanelProps) {
  const { macros } = useMacroStore();
  const [editIndex, setEditIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-2 px-3 py-2 bg-bg-panel border-b border-border-color">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Makros</span>
        <span className="text-[10px] text-text-dim">{macros.filter(m => m.bindings.length > 0).length} aktiv</span>
      </div>

      <div className="flex gap-3 relative">
        {macros.map(macro => (
          <div key={macro.index} className="relative">
            <MacroKnob
              macro={macro}
              onEdit={() => setEditIndex(editIndex === macro.index ? null : macro.index)}
            />
            {editIndex === macro.index && (
              <BindingEditor
                macro={macro}
                parts={parts}
                onClose={() => setEditIndex(null)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
