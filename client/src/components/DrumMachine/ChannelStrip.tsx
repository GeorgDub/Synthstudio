/**
 * Synthstudio – ChannelStrip
 *
 * Eine Zeile in der DrumMachine: Kanal-Name, Mute/Solo, Volume/Pan,
 * FX-Toggle, Piano-Roll-Toggle, Granular-Toggle, Step-Grid.
 * Aus DrumMachine.tsx ausgelagert.
 */
import React, { useState, useRef } from "react";
import type { PartData, ChannelFx, StepResolution } from "@/audio/AudioEngine";
import { FxPanel } from "./FxPanel";
import { velocityColor, stepGroupBorder, getSourceTypeBadge } from "./drumMachineHelpers";
import { useMidiContext } from "@/context/MidiContext";
import { findMappingForTarget } from "@/hooks/useMidi";

export interface ChannelStripProps {
  part: PartData;
  partIndex: number;
  stepCount: number;
  /**
   * v3.40: Optional sichtbarer Step-Range im Page-Modus (stepCount > 16).
   * Wenn gesetzt, werden nur Steps im Intervall [start, end) gerendert. Bei
   * null wird das gesamte Pattern in einer Zeile dargestellt (Default für
   * stepCount === 16).
   */
  visibleStepRange?: { start: number; end: number } | null;
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
  /**
   * Solo-Toggle. event.shiftKey wechselt zwischen Default (exclusive) und
   * additive Verhalten (FOLLOWUP-102-3).
   */
  onSolo: (e: { shiftKey: boolean }) => void;
  onVolumeChange: (v: number) => void;
  onPanChange: (v: number) => void;
  onSampleDrop: (url: string, name: string) => void;
  onFxChange: (fx: Partial<ChannelFx>) => void;
  onFxToggle: () => void;
  onResolutionChange: (res: StepResolution | undefined) => void;
  onClick: () => void;
  onPianoRollOpen: () => void;
  /** Öffnet den Step Inspector für diesen Step */
  onStepSelect: (stepIndex: number) => void;
  /** Aktuell im Inspector ausgewählter Step (für Highlighting) */
  selectedStepIndex: number | null;
  /** Öffnet den Granular Synth für diesen Kanal */
  onGranularOpen: () => void;
  /**
   * v2.54: Direct-Mode-Switch (sample/wavetable/fm/granular). Optional —
   * wenn nicht gesetzt, ist die Badge read-only. Bei Wechsel auf
   * wavetable/fm setzt der Store automatisch DEFAULT_SYNTH_PARAMS falls
   * noch keine existieren (applySourceTypeChange in useDrumMachineStore).
   */
  onSourceTypeChange?: (type: "sample" | "wavetable" | "fm" | "granular") => void;
}

export function ChannelStrip({
  part, stepCount, visibleStepRange, currentStep, isActive,
  velocityMode, patternResolution, fxPanelOpen,
  onToggleStep, onSetVelocity,
  onMute, onSolo, onVolumeChange, onPanChange,
  onSampleDrop, onFxChange, onFxToggle, onResolutionChange,
  onClick, onPianoRollOpen, onStepSelect, selectedStepIndex, onGranularOpen,
  onSourceTypeChange,
}: ChannelStripProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragVelocityStep, setDragVelocityStep] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // v1.99: MIDI-Learn auf einzelne Steps via Right-Click.
  // useMidiContext liefert direkt midi-State + Actions (kein Prop-Drilling).
  const midi = useMidiContext();
  const handleStepContextMenu = (e: React.MouseEvent, stepIndex: number) => {
    if (!midi || !midi.isEnabled) return;
    e.preventDefault();
    midi.startLearn({ type: "step", partId: part.id, stepIndex });
  };

  const hasActiveFx = part.fx.filterEnabled || part.fx.reverbEnabled ||
    part.fx.delayEnabled || part.fx.distortionEnabled ||
    part.fx.compressorEnabled || part.fx.eqEnabled;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const sampleUrl = e.dataTransfer.getData("sampleUrl");
    const sampleName = e.dataTransfer.getData("sampleName");
    if (sampleUrl) onSampleDrop(sampleUrl, sampleName || "Sample");
  };

  const handleStepMouseDown = (stepIndex: number, e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      onStepSelect(stepIndex); // Rechtsklick öffnet Step Inspector
      return;
    }
    if (velocityMode) {
      setDragVelocityStep(stepIndex);
      return;
    }
    // Linksklick: Toggle + Inspector öffnen
    onToggleStep(stepIndex);
    onStepSelect(stepIndex);
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
        "flex items-center gap-1 px-2 py-1 border-b border-border-color/50 relative",
        "transition-colors duration-75",
        isActive ? "bg-bg-panel/80" : "hover:bg-bg-panel/40",
        part.muted ? "opacity-50" : "",
      ].join(" ")}
      onClick={onClick}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 border-2 border-accent-primary rounded pointer-events-none z-10 bg-accent-primary/10" />
      )}

      {/* Kanal-Name + Sample-Anzeige + Source-Type-Badge (v2.51 + v2.54-Switch) */}
      <div className="w-[88px] flex-shrink-0">
        <div className="flex items-center gap-1 leading-tight">
          <span className="text-[10px] font-medium text-text-primary truncate flex-1 min-w-0">
            {part.name}
          </span>
          {(() => {
            const badge = getSourceTypeBadge(part.sourceType);
            return (
              <SourceTypeBadgeSwitch
                partId={part.id}
                currentType={part.sourceType ?? "sample"}
                label={badge.label}
                longLabel={badge.long}
                isSample={badge.isSample}
                onChange={(type) => onSourceTypeChange?.(type)}
              />
            );
          })()}
        </div>
        <div
          className={[
            "text-[9px] truncate leading-tight",
            part.sampleUrl ? "text-accent-secondary" : "text-text-dim",
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
          part.muted ? "bg-accent-secondary text-bg-base" : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
        ].join(" ")}
      >M</button>
      <button
        onClick={e => { e.stopPropagation(); onSolo({ shiftKey: e.shiftKey }); }}
        title="Solo (Shift+Click = additiv)"
        className={[
          "w-5 h-5 rounded text-[9px] font-bold flex-shrink-0 transition-colors",
          part.soloed ? "bg-accent-success text-bg-base" : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
        ].join(" ")}
      >S</button>

      {/* Volume */}
      <input
        type="range" min={0} max={1} step={0.01} value={part.volume}
        onChange={e => { e.stopPropagation(); onVolumeChange(parseFloat(e.target.value)); }}
        onClick={e => e.stopPropagation()}
        title={`Volume: ${Math.round(part.volume * 100)}%`}
        className="w-12 flex-shrink-0 accent-accent-primary cursor-pointer"
      />

      {/* Pan */}
      <input
        type="range" min={-1} max={1} step={0.01} value={part.pan}
        onChange={e => { e.stopPropagation(); onPanChange(parseFloat(e.target.value)); }}
        onClick={e => e.stopPropagation()}
        title={`Pan: ${part.pan > 0 ? "R" : part.pan < 0 ? "L" : "C"}${Math.abs(Math.round(part.pan * 100))}`}
        className="w-10 flex-shrink-0 accent-text-muted cursor-pointer"
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
        className="bg-bg-elevated text-text-muted text-[9px] rounded px-1 py-0.5 border border-border-color flex-shrink-0 w-14"
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
          hasActiveFx ? "bg-accent-primary text-white" : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
          fxPanelOpen ? "ring-1 ring-accent-primary" : "",
        ].join(" ")}
      >FX</button>

      {/* Piano Roll Button */}
      <button
        onClick={e => { e.stopPropagation(); onPianoRollOpen(); }}
        title="Piano Roll – melodische Noten programmieren"
        className="w-6 h-5 rounded text-[9px] flex-shrink-0 transition-colors font-medium bg-bg-elevated text-text-dim hover:bg-accent-primary hover:text-white"
      >PR</button>

      {/* Granular-Synth-Button */}
      <button
        onClick={e => { e.stopPropagation(); onGranularOpen(); }}
        title="Granular Synthesizer"
        className={[
          "w-6 h-5 rounded text-[9px] flex-shrink-0 transition-colors font-medium",
          part.sourceType === "granular"
            ? "bg-accent-secondary/30 text-accent-secondary ring-1 ring-accent-secondary"
            : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-accent-secondary",
        ].join(" ")}
      >GR</button>

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
        style={{ touchAction: "none" }}
      >
        {(() => {
          // v3.40: Wenn visibleStepRange gesetzt ist, nur Steps in [start, end)
          // rendern; sonst kompletter Pattern-Range. Visuelle Indices bleiben
          // 1-basiert global (i+1), nicht page-relativ — damit User immer den
          // "echten" Step-Index sieht.
          const start = visibleStepRange?.start ?? 0;
          const end = visibleStepRange?.end ?? stepCount;
          const renderedCount = end - start;
          return Array.from({ length: renderedCount }).map((_, idx) => {
            const i = start + idx;
            const step = part.steps[i];
            const isCurrentStep = i === currentStep;
            const isActiveStep = step?.active ?? false;
            const velocity = step?.velocity ?? 100;

            let touchTimer: ReturnType<typeof setTimeout> | null = null;

            // v1.99: zeige kleinen Dot wenn dieser Step MIDI-gebunden ist
            const stepMapping = midi
              ? findMappingForTarget(midi.mappings, { type: "step", partId: part.id, stepIndex: i })
              : undefined;

          return (
            <button
              key={i}
              onMouseDown={e => handleStepMouseDown(i, e)}
              onMouseMove={e => dragVelocityStep !== null && handleMouseMove(e, i)}
              onMouseEnter={e => dragVelocityStep !== null && handleMouseMove(e, i)}
              onContextMenu={e => handleStepContextMenu(e, i)}
              onTouchStart={e => {
                e.preventDefault();
                touchTimer = setTimeout(() => { onStepSelect(i); touchTimer = null; }, 500);
              }}
              onTouchEnd={e => {
                e.preventDefault();
                if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; onToggleStep(i); onStepSelect(i); }
              }}
              className={[
                "flex-1 h-7 rounded-sm transition-colors duration-75 relative select-none",
                stepGroupBorder(idx, renderedCount),
                velocityColor(velocity, isActiveStep),
                isCurrentStep ? "ring-2 ring-accent-secondary" : "",
                selectedStepIndex === i ? "ring-2 ring-accent-primary ring-offset-1" : "",
              ].join(" ")}
              style={{
                touchAction: "none",
                userSelect: "none",
                boxShadow: isCurrentStep ? "inset 0 0 0 2px var(--ss-accent-secondary)" : undefined,
              }}
              aria-label={`Step ${i + 1}: ${isActiveStep ? "aktiv" : "inaktiv"}, Velocity ${velocity}${step?.slide ? ", slide" : ""}`}
              aria-pressed={isActiveStep}
              role="button"
              title={`Step ${i + 1} | Vel: ${velocity} | Pitch: ${part.steps[i]?.pitch ?? 0} | P: ${part.steps[i]?.probability ?? 100}%${step?.slide ? " | ↝ Slide" : ""}${stepMapping ? ` · CC${stepMapping.cc}` : " · Rechtsklick: MIDI-Learn"}`}
            >
              {stepMapping && (
                <span className="absolute top-0 right-0 w-1 h-1 bg-accent-secondary rounded-full pointer-events-none" />
              )}
              {isCurrentStep && (
                <div className="absolute inset-0 rounded-sm pointer-events-none"
                  style={{ background: "var(--ss-accent-secondary)", opacity: 0.18 }} />
              )}
              {velocityMode && isActiveStep && (
                <div
                  className="absolute bottom-0 left-0 right-0 bg-accent-secondary/40 rounded-b-sm pointer-events-none"
                  style={{ height: `${(velocity / 127) * 100}%` }}
                />
              )}
              {/* Probability-Indikator: Punkt oben rechts wenn < 100% */}
              {(part.steps[i]?.probability ?? 100) < 100 && (
                <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent-secondary pointer-events-none" />
              )}
              {/* Condition-Indikator: Raute wenn nicht "always" */}
              {part.steps[i]?.condition && part.steps[i]?.condition?.type !== "always" && (
                <div className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-sm bg-accent-primary/80 pointer-events-none" />
              )}
              {/* v2.25: Slide-Indikator: ↝ Glyphe links unten wenn slide=true */}
              {step?.slide && (
                <span
                  className="absolute bottom-0 left-0.5 text-[8px] leading-none text-accent-primary font-bold pointer-events-none"
                  aria-hidden="true"
                >
                  ↝
                </span>
              )}
            </button>
          );
          });
        })()}
      </div>
    </div>
  );
}

// ─── v2.54: SourceTypeBadgeSwitch ─────────────────────────────────────────────

type SourceType = "sample" | "wavetable" | "fm" | "granular";

const SOURCE_TYPE_OPTIONS: Array<{ value: SourceType; label: string; long: string }> = [
  { value: "sample",    label: "SMP", long: "Sample-Player" },
  { value: "wavetable", label: "WT",  long: "Wavetable-Synth" },
  { value: "fm",        label: "FM",  long: "FM-Synth" },
  { value: "granular",  label: "GR",  long: "Granular-Synth" },
];

interface SourceTypeBadgeSwitchProps {
  partId: string;
  currentType: SourceType;
  label: string;
  longLabel: string;
  isSample: boolean;
  /** Wenn undefined: Badge ist read-only (kein Dropdown). */
  onChange?: (type: SourceType) => void;
}

/**
 * Mini-Badge mit Dropdown — Click öffnet ein natives Popover-Menu. Wenn
 * onChange nicht gegeben ist, fallen wir auf einen reinen span zurück
 * (back-compat zu v2.51 read-only).
 */
function SourceTypeBadgeSwitch({
  partId, currentType, label, longLabel, isSample, onChange,
}: SourceTypeBadgeSwitchProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.parentElement?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const baseClass = [
    "text-[8px] font-mono font-bold px-1 rounded flex-shrink-0",
    isSample
      ? "bg-bg-elevated text-text-dim"
      : "bg-accent-tertiary/30 text-accent-tertiary border border-accent-tertiary/50",
  ].join(" ");

  if (!onChange) {
    return (
      <span
        title={longLabel}
        data-testid={`channel-source-type-${partId}`}
        data-source-type={currentType}
        className={baseClass}
      >
        {label}
      </span>
    );
  }

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={buttonRef}
        type="button"
        title={`${longLabel} — Klick zum Wechseln`}
        data-testid={`channel-source-type-${partId}`}
        data-source-type={currentType}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className={`${baseClass} hover:ring-1 hover:ring-accent-tertiary cursor-pointer`}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          data-testid={`channel-source-type-menu-${partId}`}
          className="absolute top-full left-0 mt-0.5 z-30 bg-bg-panel border border-border-color rounded shadow-lg py-0.5 min-w-[110px]"
          onClick={e => e.stopPropagation()}
        >
          {SOURCE_TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              role="menuitem"
              data-testid={`channel-source-type-option-${partId}-${opt.value}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={[
                "w-full text-left px-2 py-1 text-[10px] font-mono flex items-center gap-1.5 hover:bg-bg-elevated",
                opt.value === currentType ? "text-accent-tertiary font-bold" : "text-text-muted",
              ].join(" ")}
            >
              <span className="w-7 inline-block font-bold">{opt.label}</span>
              <span className="text-[9px] text-text-dim">{opt.long}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
