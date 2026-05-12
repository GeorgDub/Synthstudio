/**
 * PatternLaunchPad.tsx – Vollbild Performance Mode View (v1.20.0+)
 *
 * Drei Aktions-Modi (toggle oben):
 *   ▶ Play    (default) — Click triggert Pattern (queuePattern)
 *   ✎ Edit              — Click öffnet Inline-Editor (Rename, Color, Pattern, Remove)
 *   ⇆ Reorder           — Drag-and-Drop zwischen Slots (HTML5 native DnD)
 *
 * Pads + quantizeMode kommen aus dem persistierten Store. `active` (open/close)
 * + Mode-State (play/edit/reorder) lebt lokal in App.tsx bzw. dieser Komponente.
 *
 * Theming: nur semantische --ss-* Tokens. PAD_COLORS-Array bleibt als
 * domain-palette (User-Pad-Farben, keine UI-Chrome-Farben).
 */
import { useCallback, useEffect, useState } from "react";
import { Play, Pencil, ArrowLeftRight, X, Plus, Trash2 } from "lucide-react";
import {
  setPadAt,
  setPadColor,
  setPadLabel,
  movePad,
  clearPad,
  PAD_COUNT,
  type PerformancePad,
  type QuantizeMode,
} from "@/store/usePerformanceStore";

type Mode = "play" | "edit" | "reorder";

interface PatternRef {
  id: string;
  name: string;
}

interface PatternLaunchPadProps {
  /** Persistierte Slot-Liste (Länge PAD_COUNT, null = leer). */
  pads: Array<PerformancePad | null>;
  /** Alle verfügbaren Patterns aus der DrumMachine. */
  patterns: PatternRef[];
  activePatternId: string;
  queuedPatternId: string | null;
  quantizeMode: QuantizeMode;
  bpm: number;
  currentStep: number;
  onPadClick: (patternId: string) => void;
  onQuantizeModeChange: (mode: QuantizeMode) => void;
  onClose: () => void;
}

const PAD_COLORS = [
  "#22d3ee", "#a78bfa", "#34d399", "#f87171",
  "#fb923c", "#facc15", "#60a5fa", "#e879f9",
  "#4ade80", "#f472b6", "#2dd4bf", "#fbbf24",
  "#818cf8", "#f97316", "#86efac", "#c084fc",
];

const QUANTIZE_MODES: ReadonlyArray<{ mode: QuantizeMode; title: string }> = [
  { mode: "bar",  title: "Quantize auf Bar (4 Beats)" },
  { mode: "beat", title: "Quantize auf Beat" },
  { mode: "step", title: "Quantize auf Step (1/16)" },
];

export function PatternLaunchPad({
  pads,
  patterns,
  activePatternId,
  queuedPatternId,
  quantizeMode,
  bpm,
  currentStep,
  onPadClick,
  onQuantizeModeChange,
  onClose,
}: PatternLaunchPadProps) {
  const [mode, setMode] = useState<Mode>("play");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // ESC schließt Performance Mode (oder Editor falls offen)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editingIndex !== null) {
        setEditingIndex(null);
        e.stopPropagation();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, editingIndex]);

  // Beim Modus-Wechsel: Editor schließen, Drag-State leeren
  useEffect(() => {
    setEditingIndex(null);
    setDragSrc(null);
    setDragOver(null);
  }, [mode]);

  const handlePadActivate = useCallback((index: number) => {
    const pad = pads[index];
    if (mode === "play") {
      if (pad) onPadClick(pad.patternId);
      return;
    }
    if (mode === "edit") {
      // Edit auch auf leerem Slot → öffnet Add-Picker
      setEditingIndex(index);
      return;
    }
    // reorder: kein Click-Handler, nur Drag
  }, [mode, pads, onPadClick]);

  const handleDragStart = useCallback((index: number) => {
    if (mode !== "reorder") return;
    setDragSrc(index);
  }, [mode]);

  const handleDragOver = useCallback((index: number, e: React.DragEvent) => {
    if (mode !== "reorder" || dragSrc === null) return;
    e.preventDefault();
    setDragOver(index);
  }, [mode, dragSrc]);

  const handleDrop = useCallback((index: number) => {
    if (mode !== "reorder" || dragSrc === null) return;
    if (dragSrc !== index) movePad(dragSrc, index);
    setDragSrc(null);
    setDragOver(null);
  }, [mode, dragSrc]);

  const handleDragEnd = useCallback(() => {
    setDragSrc(null);
    setDragOver(null);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-bg-base flex flex-col"
      data-testid="performance-mode-overlay"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border-color">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-accent-secondary font-bold text-lg tracking-wider">
            PERFORMANCE MODE
          </span>
          <span className="text-text-muted font-mono text-sm">{bpm} BPM</span>

          {/* Mode-Toggle: Play / Edit / Reorder */}
          <div
            role="radiogroup"
            aria-label="Performance Mode Aktion"
            className="flex gap-1 ml-2"
          >
            <ModeButton
              active={mode === "play"}
              onClick={() => setMode("play")}
              icon={<Play size={14} />}
              label="Play"
              title="Play-Modus: Click triggert Pattern"
            />
            <ModeButton
              active={mode === "edit"}
              onClick={() => setMode("edit")}
              icon={<Pencil size={14} />}
              label="Edit"
              title="Edit-Modus: Pad bearbeiten (Name, Farbe, Pattern)"
            />
            <ModeButton
              active={mode === "reorder"}
              onClick={() => setMode("reorder")}
              icon={<ArrowLeftRight size={14} />}
              label="Reorder"
              title="Reorder-Modus: Pads per Drag&Drop tauschen"
            />
          </div>

          {/* Quantize Mode */}
          <div className="flex items-center gap-1 ml-2">
            <span className="text-text-dim text-xs uppercase">Quantize:</span>
            {QUANTIZE_MODES.map(({ mode: qm, title }) => {
              const isActive = quantizeMode === qm;
              return (
                <button
                  key={qm}
                  onClick={() => onQuantizeModeChange(qm)}
                  title={title}
                  aria-pressed={isActive}
                  aria-label={title}
                  className={`px-2 py-1 rounded text-xs font-mono uppercase transition-colors active:scale-95 ${
                    isActive
                      ? "bg-accent-primary text-bg-base"
                      : "bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary"
                  }`}
                >
                  {qm}
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Performance Mode schließen"
          className="text-text-dim hover:text-text-primary text-sm flex items-center gap-1 active:scale-95"
          title="Performance Mode schließen (ESC)"
        >
          <span>ESC</span>
          <X size={16} />
        </button>
      </div>

      {/* 4×4 Pad Grid */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-auto">
        <div className="grid grid-cols-4 gap-4 w-full max-w-2xl">
          {Array.from({ length: PAD_COUNT }, (_, i) => {
            const pad = pads[i] ?? null;
            const fallbackColor = PAD_COLORS[i % PAD_COLORS.length] ?? "#334155";
            return (
              <Pad
                key={i}
                index={i}
                pad={pad}
                fallbackColor={fallbackColor}
                patterns={patterns}
                mode={mode}
                isActive={!!pad && pad.patternId === activePatternId}
                isQueued={!!pad && pad.patternId === queuedPatternId}
                isDragOver={dragOver === i}
                isDragging={dragSrc === i}
                onActivate={() => handlePadActivate(i)}
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(i, e)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
              />
            );
          })}
        </div>
      </div>

      {/* Inline Editor (Edit-Mode) */}
      {mode === "edit" && editingIndex !== null && (
        <PadEditor
          index={editingIndex}
          pad={pads[editingIndex] ?? null}
          patterns={patterns}
          fallbackColor={PAD_COLORS[editingIndex % PAD_COLORS.length] ?? "#334155"}
          onClose={() => setEditingIndex(null)}
        />
      )}

      {/* Step-Indikator */}
      <div className="px-6 py-3 border-t border-border-color flex items-center gap-2">
        <span className="text-text-dim text-xs">STEP</span>
        <div className="flex gap-0.5">
          {Array.from({ length: 16 }, (_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentStep % 16 ? "bg-accent-secondary" : "bg-border-color"
              }`}
            />
          ))}
        </div>
        <span className="ml-auto text-text-dim text-xs">
          {mode === "play" && "▶ Play-Modus — Click triggert Pattern"}
          {mode === "edit" && "✎ Edit-Modus — Click bearbeitet Pad"}
          {mode === "reorder" && "⇆ Reorder-Modus — Drag&Drop zwischen Slots"}
        </span>
      </div>
    </div>
  );
}

// ─── Mode-Toggle Button ─────────────────────────────────────────────────────

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}

function ModeButton({ active, onClick, icon, label, title }: ModeButtonProps) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={active}
      aria-label={title}
      title={title}
      className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wide flex items-center gap-1 transition-colors active:scale-95 ${
        active
          ? "bg-accent-secondary text-bg-base"
          : "bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ─── Pad ────────────────────────────────────────────────────────────────────

interface PadProps {
  index: number;
  pad: PerformancePad | null;
  fallbackColor: string;
  patterns: PatternRef[];
  mode: Mode;
  isActive: boolean;
  isQueued: boolean;
  isDragOver: boolean;
  isDragging: boolean;
  onActivate: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function Pad({
  index,
  pad,
  fallbackColor,
  patterns,
  mode,
  isActive,
  isQueued,
  isDragOver,
  isDragging,
  onActivate,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: PadProps) {
  const color = pad?.color ?? fallbackColor;
  const patternFromList = pad ? patterns.find(p => p.id === pad.patternId) : null;
  const displayLabel = pad?.label ?? patternFromList?.name ?? (pad ? `P${index + 1}` : "");

  // In reorder mode every slot (incl. empty) is draggable + drop-target
  const draggable = mode === "reorder";

  const isPlayEnabled  = mode === "play" && !!pad;
  const isEditEnabled  = mode === "edit";
  const clickable      = isPlayEnabled || isEditEnabled;

  // Visual state
  const showFilled = !!pad;
  const labelText = pad
    ? displayLabel
    : (mode === "edit" ? "+ Hinzufügen" : "");

  const padStyle: React.CSSProperties = {};
  if (showFilled) {
    padStyle.backgroundColor = isActive ? color : `${color}33`;
    padStyle.borderColor = isQueued
      ? color
      : isActive
        ? color
        : "transparent";
    if (isActive) padStyle.boxShadow = `0 0 20px ${color}66`;
  }
  if (isDragOver) padStyle.outline = `2px dashed var(--ss-accent-primary)`;

  // Cursor + opacity
  let extraClass = "";
  if (mode === "reorder") {
    extraClass = "cursor-grab active:cursor-grabbing";
    if (isDragging) extraClass += " opacity-50";
  } else if (clickable) {
    extraClass = "cursor-pointer hover:brightness-125 active:scale-95";
  } else {
    extraClass = "cursor-default";
  }

  if (!showFilled && mode === "play") {
    extraClass += " opacity-30";
  } else if (!showFilled && mode === "edit") {
    extraClass += " opacity-70 hover:opacity-100 border-dashed border-text-dim";
  } else if (!showFilled && mode === "reorder") {
    extraClass += " opacity-30 border-dashed border-text-dim";
  }

  return (
    <button
      type="button"
      data-testid={`perf-pad-${index}`}
      data-pad-filled={showFilled ? "1" : "0"}
      data-pad-active={isActive ? "1" : "0"}
      data-pad-queued={isQueued ? "1" : "0"}
      onClick={clickable ? onActivate : undefined}
      disabled={mode === "play" && !pad}
      title={
        mode === "play"
          ? (pad ? `Pattern triggern: ${displayLabel}` : "Leer")
          : mode === "edit"
            ? (pad ? `Bearbeiten: ${displayLabel}` : "Pattern hinzufügen")
            : (pad ? `${displayLabel} (verschieben)` : "Leerer Slot")
      }
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDrop={draggable ? onDrop : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      style={padStyle}
      className={`
        aspect-square rounded-xl text-sm font-bold transition-all duration-100
        border-2 flex items-center justify-center
        ${showFilled ? "" : "bg-bg-panel"}
        ${isQueued ? "animate-pulse" : ""}
        ${extraClass}
      `}
    >
      <div className="text-center px-1">
        <div
          className="text-xs leading-tight truncate"
          style={{
            color: showFilled
              ? (isActive ? "var(--ss-bg-base)" : `${color}cc`)
              : undefined,
          }}
        >
          {labelText}
        </div>
        {mode === "edit" && !pad && (
          <Plus size={14} className="mx-auto mt-1 text-text-muted" />
        )}
      </div>
    </button>
  );
}

// ─── Pad-Editor (Inline-Modal) ──────────────────────────────────────────────

interface PadEditorProps {
  index: number;
  pad: PerformancePad | null;
  patterns: PatternRef[];
  fallbackColor: string;
  onClose: () => void;
}

function PadEditor({ index, pad, patterns, fallbackColor, onClose }: PadEditorProps) {
  const [labelDraft, setLabelDraft] = useState(pad?.label ?? "");
  const [colorDraft, setColorDraft] = useState(pad?.color ?? fallbackColor);
  const [patternDraft, setPatternDraft] = useState(pad?.patternId ?? "");

  useEffect(() => {
    setLabelDraft(pad?.label ?? "");
    setColorDraft(pad?.color ?? fallbackColor);
    setPatternDraft(pad?.patternId ?? "");
  }, [index, pad, fallbackColor]);

  const handleSave = () => {
    if (!patternDraft) return;
    setPadAt(index, {
      patternId: patternDraft,
      color: colorDraft,
      label: labelDraft.trim() || undefined,
    });
    onClose();
  };

  const handleApplyColor = (c: string) => {
    setColorDraft(c);
    if (pad) setPadColor(index, c);
  };

  const handleApplyLabel = (l: string) => {
    setLabelDraft(l);
    if (pad) setPadLabel(index, l);
  };

  const handleRemove = () => {
    clearPad(index);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg-base/70 backdrop-blur-sm"
      onClick={onClose}
      data-testid="perf-pad-editor"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[min(420px,90vw)] bg-bg-panel border border-border-color rounded-xl shadow-xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-text-primary font-bold text-sm uppercase tracking-wider">
            Pad {index + 1} {pad ? "bearbeiten" : "hinzufügen"}
          </h3>
          <button
            onClick={onClose}
            aria-label="Editor schließen"
            className="text-text-dim hover:text-text-primary active:scale-95"
            title="Schließen (ESC)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Pattern-Auswahl */}
        <label className="block mb-3">
          <span className="block text-xs uppercase text-text-dim mb-1">Pattern</span>
          <select
            value={patternDraft}
            onChange={(e) => setPatternDraft(e.target.value)}
            aria-label="Pattern auswählen"
            className="w-full bg-bg-elevated text-text-primary border border-border-color rounded px-2 py-1.5 text-sm"
          >
            <option value="">— wählen —</option>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        {/* Label */}
        <label className="block mb-3">
          <span className="block text-xs uppercase text-text-dim mb-1">Label</span>
          <input
            type="text"
            value={labelDraft}
            onChange={(e) => handleApplyLabel(e.target.value)}
            placeholder={patterns.find(p => p.id === patternDraft)?.name ?? `P${index + 1}`}
            aria-label="Pad-Label"
            className="w-full bg-bg-elevated text-text-primary border border-border-color rounded px-2 py-1.5 text-sm placeholder:text-text-dim"
          />
        </label>

        {/* Farben-Palette */}
        <div className="mb-3">
          <span className="block text-xs uppercase text-text-dim mb-1">Farbe</span>
          <div className="flex flex-wrap gap-2">
            {PAD_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => handleApplyColor(c)}
                aria-label={`Farbe ${c}`}
                title={c}
                className={`w-7 h-7 rounded-full border-2 transition-transform active:scale-95 ${
                  colorDraft.toLowerCase() === c.toLowerCase()
                    ? "border-text-primary scale-110"
                    : "border-border-color hover:scale-105"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={colorDraft}
              onChange={(e) => handleApplyColor(e.target.value)}
              aria-label="Custom Farbe wählen"
              title="Custom Farbe"
              className="w-7 h-7 rounded-full bg-transparent border border-border-color cursor-pointer"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-5">
          <button
            type="button"
            onClick={handleSave}
            disabled={!patternDraft}
            className="px-3 py-1.5 rounded text-xs font-bold bg-accent-primary text-bg-base hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pad ? "Aktualisieren" : "Hinzufügen"}
          </button>
          {pad && (
            <button
              type="button"
              onClick={handleRemove}
              className="px-3 py-1.5 rounded text-xs font-bold bg-accent-danger/20 text-accent-danger border border-accent-danger/40 hover:bg-accent-danger/30 active:scale-95 flex items-center gap-1"
            >
              <Trash2 size={12} />
              Entfernen
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-3 py-1.5 rounded text-xs bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary active:scale-95"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
