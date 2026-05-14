/**
 * Synthstudio – MacroPanel
 *
 * 8 Makro-Knöpfe für Live-Performance: Ein Makro steuert N Parameter gleichzeitig.
 * Jeder Makro hat einen Slider (0–1) und eine Binding-Liste.
 *
 * Integration: Wird in der DrumMachine-Toolbar als "▸ Makros"-Panel angezeigt.
 * MIDI-Zuweisung über das normale MIDI CC-System möglich.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { useMidiLearn } from "@/hooks/useMidiLearn";
import {
  useMacroStore,
  setMacroValue,
  setMacroLabel,
  addMacroBinding,
  removeMacroBinding,
  setMacroMode,
  setMacroScriptId,
  setMacroTriggerKind,
  setMacroTriggerMode,
  setMacroPadIndex,
  triggerMacroButton,
  triggerMacroButtonRelease,
  type Macro,
  type MacroMode,
  type MacroTargetType,
  type MacroTriggerKind,
  type MacroTriggerMode,
} from "@/store/useMacroStore";
import { useScriptStore } from "@/store/useScriptStore";
import { usePerformanceStore, PAD_COUNT, type PerformancePad } from "@/store/usePerformanceStore";
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
  // v1.88: rechtsklick auf den Slider → MIDI-Learn für diesen Macro-Index
  const learn = useMidiLearn({ type: "macro", index: macro.index, label: macro.label });

  // v1.93: Inline-Rename via Doppelklick auf Label
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(macro.label);

  return (
    <div className="flex flex-col items-center gap-1 min-w-[60px] relative">
      {/* Label — v1.93: Doppelklick → Inline-Edit */}
      {renaming ? (
        <input
          autoFocus
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => {
            const trimmed = draftName.trim();
            if (trimmed.length > 0 && trimmed !== macro.label) {
              setMacroLabel(macro.index, trimmed);
            } else {
              setDraftName(macro.label);
            }
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") { setDraftName(macro.label); setRenaming(false); }
          }}
          className="w-full text-[9px] text-text-primary bg-bg-elevated border border-accent-secondary rounded px-1 text-center"
        />
      ) : (
        <span
          onDoubleClick={() => { setDraftName(macro.label); setRenaming(true); }}
          className="text-[9px] text-text-dim truncate w-full text-center cursor-text hover:text-text-primary"
          title={`${macro.label} — Doppelklick zum Umbenennen`}
        >
          {macro.label}
          {learn.isMapped && (
            <span className="ml-1 text-accent-secondary font-mono">·CC{learn.mappedCC}</span>
          )}
        </span>
      )}

      {/* Slider (vertikal via rotate) */}
      <div className="relative h-20 flex items-center justify-center">
        <input
          type="range"
          min={0} max={1} step={0.01}
          value={macro.value}
          onChange={e => setMacroValue(macro.index, Number(e.target.value))}
          onContextMenu={learn.onContextMenu}
          className="h-16"
          style={{
            writingMode: "vertical-lr",
            direction: "rtl",
            accentColor: macro.color,
            cursor: "pointer",
          }}
          title={`Macro ${macro.index + 1} · Rechtsklick: MIDI-Learn${learn.isMapped ? ` · CC${learn.mappedCC}` : ""}`}
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
      {learn.menu}
    </div>
  );
}

// ─── Button-Darstellung ──────────────────────────────────────────────────────

function MacroButton({
  macro,
  triggerKind,
  triggerMode,
  scriptName,
  scriptMissing,
  padLabel,
  padColor,
  padMissing,
  onEdit,
}: {
  macro: Macro;
  triggerKind: MacroTriggerKind;
  triggerMode: MacroTriggerMode;
  scriptName: string | null;
  scriptMissing: boolean;
  padLabel: string | null;
  padColor: string | null;
  padMissing: boolean;
  onEdit: () => void;
}) {
  // Press-State für visuelles Feedback. In Hold-Mode triggert mouseDown den
  // Start einer Loop in App.tsx, mouseUp/mouseLeave/touchEnd stoppt sie via
  // triggerMacroButtonRelease (auch in Edge-Mode rufen wir das Release auf —
  // App.tsx kennt selbst den State und macht es no-op falls keine Loop läuft).
  const [pressed, setPressed] = useState(false);
  const isHoldMode = triggerMode === "hold";
  const handleDown = () => {
    setPressed(true);
    triggerMacroButton(macro.index);
  };
  const handleUp = () => {
    setPressed(false);
    if (isHoldMode) {
      triggerMacroButtonRelease(macro.index);
    }
  };

  // Label + Disabled + Farb-Logik abhängig vom triggerKind
  let label: string;
  let disabled: boolean;
  let effectiveColor: string;
  let statusBadge: string;
  let titleText: string;
  if (triggerKind === "pad") {
    disabled = macro.padIndex === undefined || macro.padIndex === null;
    if (disabled) {
      label = "(kein Pad)";
      effectiveColor = macro.color;
      titleText = "Kein Performance-Pad zugewiesen";
    } else if (padMissing) {
      label = `(Pad leer)`;
      effectiveColor = macro.color;
      titleText = `Pad ${(macro.padIndex ?? 0) + 1} ist leer — bitte in Performance Mode konfigurieren`;
    } else {
      label = padLabel ?? `Pad ${(macro.padIndex ?? 0) + 1}`;
      // Pad-Mode: Pad-Color hat Vorrang über Macro-Color, mit Macro-Color als Fallback
      effectiveColor = padColor ?? macro.color;
      titleText = label;
    }
    statusBadge = "PAD";
  } else {
    disabled = !macro.scriptId;
    label = scriptName ?? (scriptMissing ? "(Skript fehlt)" : "(kein Skript)");
    effectiveColor = macro.color;
    titleText = scriptMissing ? "Verknüpftes Skript wurde nicht gefunden" : label;
    statusBadge = "BTN";
  }

  const showError = (triggerKind === "script" && scriptMissing) || (triggerKind === "pad" && !disabled && padMissing);

  return (
    <div className="flex flex-col items-center gap-1 min-w-[60px]">
      {/* Label */}
      <span className="text-[9px] text-text-dim truncate w-full text-center" title={macro.label}>
        {macro.label}
      </span>

      {/* Trigger-Button */}
      <button
        data-testid={`macro-button-${macro.index}`}
        data-macro-trigger-mode={triggerMode}
        data-macro-trigger-kind={triggerKind}
        onMouseDown={disabled ? undefined : handleDown}
        onMouseUp={handleUp}
        onMouseLeave={handleUp}
        onTouchStart={disabled ? undefined : handleDown}
        onTouchEnd={handleUp}
        disabled={disabled}
        aria-label={`Trigger ${macro.label}${isHoldMode ? " (Hold-Mode)" : ""}`}
        className="relative h-20 w-14 rounded-md flex items-center justify-center text-[10px] font-bold border transition-all select-none disabled:opacity-50 disabled:cursor-not-allowed border-border-color"
        style={{
          // User-definierte Farbe (Pad oder Macro) darf inline gestyled werden (domain palette, kein Token-Mapping)
          backgroundColor: disabled ? "transparent" : effectiveColor,
          color: disabled ? "var(--ss-text-dim)" : "#fff",
          transform: pressed ? "scale(0.95)" : "scale(1)",
          boxShadow: pressed ? "inset 0 0 8px rgba(0,0,0,0.35)" : "none",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
        title={isHoldMode ? `${titleText} — Hold-Mode (Loop solange gedrückt)` : titleText}
      >
        {/* Hold-Mode-Indikator: Schleifen-Icon oben-rechts */}
        {isHoldMode && !disabled && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 text-[10px] leading-none pointer-events-none"
            style={{ textShadow: "0 0 2px rgba(0,0,0,0.6)" }}
            title="Hold-Mode aktiv"
          >
            🔁
          </span>
        )}
        <span className="px-1 break-words text-center leading-tight" style={{ wordBreak: "break-word" }}>
          {label}
        </span>
      </button>

      {/* Status-Zeile */}
      <span
        className="text-[10px] font-mono"
        style={{ color: showError ? "var(--ss-accent-danger)" : effectiveColor }}
      >
        {statusBadge}
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
  const { pads } = usePerformanceStore();

  const opt = TARGET_OPTIONS.find(o => o.value === newTarget);

  // Defensiver Default: bei fehlendem triggerKind → "script" (Backwards-Compat)
  const effectiveTriggerKind: MacroTriggerKind = macro.triggerKind === "pad" ? "pad" : "script";
  // Defensiver Default: bei fehlendem triggerMode → "edge" (v1.22.0)
  const effectiveTriggerMode: MacroTriggerMode = macro.triggerMode === "hold" ? "hold" : "edge";

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

  const handleSwitchTriggerKind = (kind: MacroTriggerKind) => {
    setMacroTriggerKind(macro.index, kind);
  };

  const handleSwitchTriggerMode = (mode: MacroTriggerMode) => {
    setMacroTriggerMode(macro.index, mode);
  };

  const handleSelectPad = (raw: string) => {
    if (raw === "") {
      setMacroPadIndex(macro.index, null);
      return;
    }
    const idx = Number(raw);
    if (Number.isInteger(idx) && idx >= 0 && idx < PAD_COUNT) {
      setMacroPadIndex(macro.index, idx);
    }
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

  // Navigation zum Performance-Mode (App.tsx hört zu — siehe `ss:navigate` Listener).
  const handleOpenPerformanceMode = () => {
    if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("ss:navigate", {
          detail: { tab: "performance" },
        }),
      );
    }
    onClose();
  };

  // Pad-Picker-Optionen: alle 16 Slots
  const padOptions: Array<{ index: number; label: string; filled: boolean }> = pads.map((p: PerformancePad | null, i: number) => {
    if (p) {
      return {
        index: i,
        label: `Pad ${i + 1}${p.label ? ` – ${p.label}` : ""}`,
        filled: true,
      };
    }
    return { index: i, label: `Pad ${i + 1} (leer)`, filled: false };
  });

  const selectedPad = macro.padIndex !== undefined ? pads[macro.padIndex] : null;
  const padIsMissing = macro.padIndex !== undefined && !selectedPad;

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
          {/* Button-Mode: Trigger-Kind-Toggle (Script | Pad) */}
          <div className="border-t border-border-color pt-3 space-y-2">
            <div className="text-[10px] text-text-dim uppercase tracking-wide">Trigger</div>
            <div role="radiogroup" aria-label="Macro trigger kind" className="flex gap-1 bg-bg-elevated rounded p-1 border border-border-color">
              <button
                type="button"
                role="radio"
                aria-checked={effectiveTriggerKind === "script"}
                onClick={() => handleSwitchTriggerKind("script")}
                className={
                  "flex-1 px-2 py-1 text-xs font-semibold rounded transition-colors " +
                  (effectiveTriggerKind === "script"
                    ? "bg-accent-primary text-white"
                    : "text-text-muted hover:text-text-primary")
                }
              >
                Script
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={effectiveTriggerKind === "pad"}
                onClick={() => handleSwitchTriggerKind("pad")}
                className={
                  "flex-1 px-2 py-1 text-xs font-semibold rounded transition-colors " +
                  (effectiveTriggerKind === "pad"
                    ? "bg-accent-primary text-white"
                    : "text-text-muted hover:text-text-primary")
                }
              >
                Pad
              </button>
            </div>
          </div>

          {/* Button-Mode: Trigger-Verhalten (Edge | Hold) — v1.22.0 TASK-118 */}
          <div className="border-t border-border-color pt-3 space-y-2">
            <div className="text-[10px] text-text-dim uppercase tracking-wide">Trigger-Verhalten</div>
            <div role="radiogroup" aria-label="Macro trigger mode" className="flex gap-1 bg-bg-elevated rounded p-1 border border-border-color">
              <button
                type="button"
                role="radio"
                aria-checked={effectiveTriggerMode === "edge"}
                onClick={() => handleSwitchTriggerMode("edge")}
                title="Edge: Einmaliger Trigger pro Press (klassisch)"
                className={
                  "flex-1 px-2 py-1 text-xs font-semibold rounded transition-colors " +
                  (effectiveTriggerMode === "edge"
                    ? "bg-accent-primary text-white"
                    : "text-text-muted hover:text-text-primary")
                }
              >
                Edge
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={effectiveTriggerMode === "hold"}
                onClick={() => handleSwitchTriggerMode("hold")}
                title={effectiveTriggerKind === "script"
                  ? "Hold: Skript läuft in Schleife solange Button gedrückt (alle 200 ms)"
                  : "Hold: Pad wird alle 100 ms re-triggert solange Button gedrückt"}
                className={
                  "flex-1 px-2 py-1 text-xs font-semibold rounded transition-colors " +
                  (effectiveTriggerMode === "hold"
                    ? "bg-accent-primary text-white"
                    : "text-text-muted hover:text-text-primary")
                }
              >
                Hold 🔁
              </button>
            </div>
            <div className="text-[10px] text-text-dim leading-snug">
              {effectiveTriggerMode === "hold"
                ? (effectiveTriggerKind === "script"
                  ? "Skript läuft in Schleife (~200 ms Intervall) solange Button gedrückt."
                  : "Pad wird alle ~100 ms re-triggert solange Button gedrückt.")
                : "Single-shot bei mouseDown."}
            </div>
          </div>

          {effectiveTriggerKind === "script" ? (
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
            </div>
          ) : (
            <div className="border-t border-border-color pt-3 space-y-2">
              <div className="text-[10px] text-text-dim uppercase tracking-wide">Performance Pad</div>
              <select
                value={macro.padIndex !== undefined ? String(macro.padIndex) : ""}
                onChange={e => handleSelectPad(e.target.value)}
                aria-label="Performance-Pad auswählen"
                className="w-full text-xs bg-bg-elevated rounded border border-border-color px-2 py-1 text-text-primary"
              >
                <option value="">— Kein Pad —</option>
                {padOptions.map(o => (
                  <option key={o.index} value={o.index}>
                    {o.label}
                  </option>
                ))}
              </select>

              {padIsMissing && (
                <div className="text-[10px] text-accent-danger">
                  Pad {macro.padIndex !== undefined ? macro.padIndex + 1 : "?"} ist leer — bitte in Performance Mode konfigurieren.
                </div>
              )}

              <button
                type="button"
                onClick={handleOpenPerformanceMode}
                className="w-full py-1 text-xs rounded bg-bg-elevated border border-border-color text-text-primary hover:bg-bg-base transition-colors"
              >
                Edit in Performance Mode →
              </button>

              <div className="text-[10px] text-text-dim leading-snug pt-1">
                Triggert das Pattern aus dem ausgewählten Performance-Pad (quantisiert via Performance-Mode-Settings).
              </div>
            </div>
          )}
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
  const { pads } = usePerformanceStore();
  const [editIndex, setEditIndex] = useState<number | null>(null);

  const activeCount = macros.filter(m => {
    if (m.mode === "knob") return m.bindings.length > 0;
    if (m.mode === "button") {
      const kind: MacroTriggerKind = m.triggerKind === "pad" ? "pad" : "script";
      if (kind === "pad") return m.padIndex !== undefined && m.padIndex !== null;
      return !!m.scriptId;
    }
    return false;
  }).length;

  return (
    <div className="flex flex-col gap-2 px-3 py-2 bg-bg-panel border-b border-border-color">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Makros</span>
        <span className="text-[10px] text-text-dim">{activeCount} aktiv</span>
      </div>

      <div className="flex gap-3 relative">
        {macros.map(macro => {
          const isButton = macro.mode === "button";
          const triggerKind: MacroTriggerKind = macro.triggerKind === "pad" ? "pad" : "script";
          const triggerMode: MacroTriggerMode = macro.triggerMode === "hold" ? "hold" : "edge";
          const linkedScript = isButton && triggerKind === "script" && macro.scriptId
            ? scripts.find(s => s.id === macro.scriptId)
            : undefined;
          const scriptMissing = isButton && triggerKind === "script" && !!macro.scriptId && !linkedScript;
          const linkedPad = isButton && triggerKind === "pad" && macro.padIndex !== undefined
            ? pads[macro.padIndex] ?? null
            : null;
          const padMissing = isButton && triggerKind === "pad" && macro.padIndex !== undefined && !linkedPad;
          return (
            <div key={macro.index} className="relative">
              {isButton ? (
                <MacroButton
                  macro={macro}
                  triggerKind={triggerKind}
                  triggerMode={triggerMode}
                  scriptName={linkedScript?.name ?? null}
                  scriptMissing={scriptMissing}
                  padLabel={linkedPad?.label ?? null}
                  padColor={linkedPad?.color ?? null}
                  padMissing={padMissing}
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
