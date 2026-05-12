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
  setMacroMode,
  setMacroScriptId,
  triggerMacroButton,
  type Macro,
  type MacroMode,
  type MacroTargetType,
  MACRO_COLORS,
} from "@/store/useMacroStore";
import { useScriptStore } from "@/store/useScriptStore";
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

// ─── Button-Darstellung ──────────────────────────────────────────────────────

function MacroButton({
  macro,
  scriptName,
  scriptMissing,
  onEdit,
}: {
  macro: Macro;
  scriptName: string | null;
  scriptMissing: boolean;
  onEdit: () => void;
}) {
  // Press-State für visuelles Feedback (Edge-Mode: triggert beim Drücken)
  const [pressed, setPressed] = useState(false);
  const handleDown = () => {
    setPressed(true);
    triggerMacroButton(macro.index);
  };
  const handleUp = () => setPressed(false);

  const label = scriptName ?? (scriptMissing ? "(Skript fehlt)" : "(kein Skript)");
  const disabled = !macro.scriptId;

  return (
    <div className="flex flex-col items-center gap-1 min-w-[60px]">
      {/* Label */}
      <span className="text-[9px] text-text-dim truncate w-full text-center" title={macro.label}>
        {macro.label}
      </span>

      {/* Trigger-Button */}
      <button
        onMouseDown={disabled ? undefined : handleDown}
        onMouseUp={handleUp}
        onMouseLeave={handleUp}
        onTouchStart={disabled ? undefined : handleDown}
        onTouchEnd={handleUp}
        disabled={disabled}
        aria-label={`Trigger ${macro.label}`}
        className="relative h-20 w-14 rounded-md flex items-center justify-center text-[10px] font-bold border transition-all select-none disabled:opacity-50 disabled:cursor-not-allowed border-border-color"
        style={{
          // User-definierte Farbe darf inline gestyled werden (kein Token-Mapping)
          backgroundColor: disabled ? "transparent" : macro.color,
          color: disabled ? "var(--ss-text-dim)" : "#fff",
          transform: pressed ? "scale(0.95)" : "scale(1)",
          boxShadow: pressed ? "inset 0 0 8px rgba(0,0,0,0.35)" : "none",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
        title={scriptMissing ? "Verknüpftes Skript wurde nicht gefunden" : label}
      >
        <span className="px-1 break-words text-center leading-tight" style={{ wordBreak: "break-word" }}>
          {label}
        </span>
      </button>

      {/* Status-Zeile */}
      <span
        className="text-[10px] font-mono"
        style={{ color: scriptMissing ? "var(--ss-accent-danger)" : macro.color }}
      >
        BTN
      </span>
      <button
        onClick={onEdit}
        className="text-[9px] text-text-dim hover:text-text-primary transition-colors px-1"
        title="Macro bearbeiten"
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
  const { scripts } = useScriptStore();

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

  const handleSwitchMode = (mode: MacroMode) => {
    setMacroMode(macro.index, mode);
  };

  const handleSelectScript = (scriptId: string) => {
    setMacroScriptId(macro.index, scriptId === "" ? null : scriptId);
  };

  // Navigation zur Tools-Tab/Script-Sub-Section per CustomEvent (App.tsx hört zu)
  const handleOpenScriptRunner = () => {
    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ss:navigate", {
          detail: { tab: "tools", tool: "script" },
        }),
      );
    }
    onClose();
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

      {/* Mode-Toggle: Knob / Button */}
      <div className="mb-3">
        <div className="text-[10px] text-text-dim uppercase tracking-wide mb-1">Mode</div>
        <div role="radiogroup" aria-label="Macro mode" className="flex gap-1 bg-bg-elevated rounded p-1 border border-border-color">
          <button
            type="button"
            role="radio"
            aria-checked={macro.mode === "knob"}
            onClick={() => handleSwitchMode("knob")}
            className={
              "flex-1 px-2 py-1 text-xs font-semibold rounded transition-colors " +
              (macro.mode === "knob"
                ? "bg-accent-primary text-white"
                : "text-text-muted hover:text-text-primary")
            }
          >
            Knob
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={macro.mode === "button"}
            onClick={() => handleSwitchMode("button")}
            className={
              "flex-1 px-2 py-1 text-xs font-semibold rounded transition-colors " +
              (macro.mode === "button"
                ? "bg-accent-primary text-white"
                : "text-text-muted hover:text-text-primary")
            }
          >
            Button
          </button>
        </div>
      </div>

      {macro.mode === "knob" ? (
        <>
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
        </>
      ) : (
        <>
          {/* Button-Mode: Script-Auswahl */}
          <div className="border-t border-border-color pt-3 space-y-2">
            <div className="text-[10px] text-text-dim uppercase tracking-wide">Skript</div>
            <select
              value={macro.scriptId ?? ""}
              onChange={e => handleSelectScript(e.target.value)}
              aria-label="Skript auswählen"
              className="w-full text-xs bg-bg-elevated rounded border border-border-color px-2 py-1 text-text-primary"
            >
              <option value="">— Kein Skript —</option>
              {scripts.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.enabled ? "" : " (deaktiviert)"}
                </option>
              ))}
            </select>

            {macro.scriptId && !scripts.find(s => s.id === macro.scriptId) && (
              <div className="text-[10px] text-accent-danger">
                Verknüpftes Skript existiert nicht mehr.
              </div>
            )}

            <button
              type="button"
              onClick={handleOpenScriptRunner}
              className="w-full py-1 text-xs rounded bg-bg-elevated border border-border-color text-text-primary hover:bg-bg-base transition-colors"
            >
              Edit in Script Runner →
            </button>

            <div className="text-[10px] text-text-dim leading-snug pt-1">
              Trigger-Modus: <span className="font-mono text-text-muted">edge</span> (einmaliger Run pro Press).
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

interface MacroPanelProps {
  parts: PartData[];
}

export function MacroPanel({ parts }: MacroPanelProps) {
  const { macros } = useMacroStore();
  const { scripts } = useScriptStore();
  const [editIndex, setEditIndex] = useState<number | null>(null);

  const activeCount = macros.filter(m =>
    (m.mode === "knob" && m.bindings.length > 0) ||
    (m.mode === "button" && !!m.scriptId)
  ).length;

  return (
    <div className="flex flex-col gap-2 px-3 py-2 bg-bg-panel border-b border-border-color">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Makros</span>
        <span className="text-[10px] text-text-dim">{activeCount} aktiv</span>
      </div>

      <div className="flex gap-3 relative">
        {macros.map(macro => {
          const isButton = macro.mode === "button";
          const linkedScript = isButton && macro.scriptId
            ? scripts.find(s => s.id === macro.scriptId)
            : undefined;
          const scriptMissing = isButton && !!macro.scriptId && !linkedScript;
          return (
            <div key={macro.index} className="relative">
              {isButton ? (
                <MacroButton
                  macro={macro}
                  scriptName={linkedScript?.name ?? null}
                  scriptMissing={scriptMissing}
                  onEdit={() => setEditIndex(editIndex === macro.index ? null : macro.index)}
                />
              ) : (
                <MacroKnob
                  macro={macro}
                  onEdit={() => setEditIndex(editIndex === macro.index ? null : macro.index)}
                />
              )}
              {editIndex === macro.index && (
                <BindingEditor
                  macro={macro}
                  parts={parts}
                  onClose={() => setEditIndex(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
