/**
 * Synthstudio – DrumMachine.tsx
 *
 * Vollständige Drum Machine UI:
 * - Step-Grid mit 16/32 Steps
 * - Part-Zeilen mit Sample-Zuweisung, Mute/Solo, Volume, Pan
 * - Velocity-Editing (Rechtsklick oder Velocity-Modus)
 * - Pattern-Auswahl und -Verwaltung
 * - Keyboard-Shortcuts
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { Sample } from "@/store/useProjectStore";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DrumMachineProps {
  dm: DrumMachineState & DrumMachineActions;
  samples: Sample[];
  isPlaying: boolean;
  bpm: number;
  onPlayStop: () => void;
  onBpmChange: (bpm: number) => void;
  className?: string;
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function velocityToColor(velocity: number, active: boolean): string {
  if (!active) return "";
  const v = velocity / 127;
  if (v > 0.85) return "bg-cyan-400";
  if (v > 0.65) return "bg-cyan-500";
  if (v > 0.45) return "bg-cyan-600";
  if (v > 0.25) return "bg-cyan-700";
  return "bg-cyan-800";
}

function groupLabel(stepIndex: number): string {
  const beat = Math.floor(stepIndex / 4) + 1;
  const sub = stepIndex % 4;
  return sub === 0 ? String(beat) : "";
}

// ─── Step-Button ──────────────────────────────────────────────────────────────

interface StepButtonProps {
  active: boolean;
  velocity: number;
  pitch: number;
  isCurrent: boolean;
  isVelocityMode: boolean;
  isPitchMode: boolean;
  stepIndex: number;
  groupStart: boolean;
  onToggle: () => void;
  onVelocityChange: (v: number) => void;
  onPitchChange: (p: number) => void;
}

const StepButton = React.memo(function StepButton({
  active,
  velocity,
  pitch,
  isCurrent,
  isVelocityMode,
  isPitchMode,
  stepIndex,
  groupStart,
  onToggle,
  onVelocityChange,
  onPitchChange,
}: StepButtonProps) {
  const [showPopover, setShowPopover] = useState(false);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartVal = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isVelocityMode && active) {
      e.preventDefault();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartVal.current = velocity;
    } else if (isPitchMode && active) {
      e.preventDefault();
      isDragging.current = true;
      dragStartY.current = e.clientY;
      dragStartVal.current = pitch;
    }
  }, [isVelocityMode, isPitchMode, active, velocity, pitch]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const delta = Math.round((dragStartY.current - e.clientY) / 2);
    if (isVelocityMode) {
      onVelocityChange(Math.max(1, Math.min(127, dragStartVal.current + delta)));
    } else if (isPitchMode) {
      onPitchChange(Math.max(-24, Math.min(24, dragStartVal.current + delta)));
    }
  }, [isVelocityMode, isPitchMode, onVelocityChange, onPitchChange]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    if (isVelocityMode || isPitchMode) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isVelocityMode, isPitchMode, handleMouseMove, handleMouseUp]);

  const colorClass = active ? velocityToColor(velocity, active) : "";

  return (
    <div className="relative">
      <button
        onMouseDown={handleMouseDown}
        onClick={(!isVelocityMode && !isPitchMode) ? onToggle : undefined}
        onContextMenu={(e) => { e.preventDefault(); setShowPopover(v => !v); }}
        title={active ? `Velocity: ${velocity}  Pitch: ${pitch > 0 ? "+" : ""}${pitch}` : `Step ${stepIndex + 1}`}
        className={[
          "w-full h-8 rounded-sm transition-all duration-75 border",
          groupStart ? "ml-0.5" : "",
          active
            ? `${colorClass} border-cyan-300/30 shadow-sm shadow-cyan-500/20`
            : "bg-slate-800 border-slate-700 hover:bg-slate-700 hover:border-slate-600",
          isCurrent
            ? "ring-1 ring-white/60 ring-offset-0"
            : "",
          (isVelocityMode || isPitchMode) && active
            ? "cursor-ns-resize"
            : "cursor-pointer",
        ].join(" ")}
      >
        {/* Velocity-Balken im Step */}
        {active && isVelocityMode && (
          <div
            className="absolute bottom-0 left-0 right-0 bg-white/20 rounded-b-sm"
            style={{ height: `${(velocity / 127) * 100}%` }}
          />
        )}
        {/* Pitch-Indikator */}
        {active && isPitchMode && pitch !== 0 && (
          <span className="text-[8px] text-white/70 leading-none">
            {pitch > 0 ? `+${pitch}` : pitch}
          </span>
        )}
      </button>

      {/* Popover für Velocity/Pitch-Eingabe */}
      {showPopover && active && (
        <div className="absolute z-50 bottom-10 left-1/2 -translate-x-1/2 bg-slate-900 border border-slate-600 rounded p-2 shadow-xl min-w-[120px]">
          <div className="text-[10px] text-slate-400 mb-1">Step {stepIndex + 1}</div>
          <label className="flex items-center gap-1 text-[10px] text-slate-300">
            Vel
            <input
              type="range" min={1} max={127} value={velocity}
              onChange={e => onVelocityChange(Number(e.target.value))}
              className="w-16 accent-cyan-500"
            />
            <span className="w-6 text-right">{velocity}</span>
          </label>
          <label className="flex items-center gap-1 text-[10px] text-slate-300 mt-1">
            Pitch
            <input
              type="range" min={-24} max={24} value={pitch}
              onChange={e => onPitchChange(Number(e.target.value))}
              className="w-16 accent-purple-500"
            />
            <span className="w-6 text-right">{pitch > 0 ? `+${pitch}` : pitch}</span>
          </label>
          <button
            onClick={() => setShowPopover(false)}
            className="mt-1 w-full text-[10px] text-slate-500 hover:text-slate-300"
          >
            ✕ Schließen
          </button>
        </div>
      )}
    </div>
  );
});

// ─── Part-Zeile ───────────────────────────────────────────────────────────────

interface PartRowProps {
  part: DrumMachineState["patterns"][0]["parts"][0];
  currentStep: number;
  isVelocityMode: boolean;
  isPitchMode: boolean;
  samples: Sample[];
  isActive: boolean;
  onSelect: () => void;
  onToggleStep: (stepIndex: number) => void;
  onVelocity: (stepIndex: number, v: number) => void;
  onPitch: (stepIndex: number, p: number) => void;
  onMute: () => void;
  onSolo: () => void;
  onVolumeChange: (v: number) => void;
  onPanChange: (p: number) => void;
  onSampleDrop: (sampleUrl: string, sampleName: string) => void;
  onClear: () => void;
  onRandomize: () => void;
  onShiftLeft: () => void;
  onShiftRight: () => void;
}

const PartRow = React.memo(function PartRow({
  part,
  currentStep,
  isVelocityMode,
  isPitchMode,
  samples,
  isActive,
  onSelect,
  onToggleStep,
  onVelocity,
  onPitch,
  onMute,
  onSolo,
  onVolumeChange,
  onPanChange,
  onSampleDrop,
  onClear,
  onRandomize,
  onShiftLeft,
  onShiftRight,
}: PartRowProps) {
  const [showSamplePicker, setShowSamplePicker] = useState(false);
  const [showControls, setShowControls] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const sampleId = e.dataTransfer.getData("application/synthstudio-sample");
    if (sampleId) {
      const sample = samples.find(s => s.id === sampleId);
      if (sample) {
        onSampleDrop(sample.path, sample.name);
      }
    }
  }, [samples, onSampleDrop]);

  return (
    <div
      className={[
        "flex items-center gap-1 px-2 py-0.5 group",
        isActive ? "bg-slate-800/50" : "hover:bg-slate-900/30",
        part.muted ? "opacity-40" : "",
      ].join(" ")}
      onClick={onSelect}
    >
      {/* Part-Label / Sample-Zuweisung */}
      <div
        className="w-28 flex-shrink-0 relative"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <button
          onClick={(e) => { e.stopPropagation(); setShowSamplePicker(v => !v); }}
          title={part.sampleUrl ? `Sample: ${part.name}` : "Sample zuweisen (Drag & Drop oder klicken)"}
          className={[
            "w-full text-left px-1.5 py-0.5 rounded text-[11px] truncate",
            "border transition-colors",
            part.sampleUrl
              ? "border-cyan-800/50 text-cyan-300 bg-cyan-950/30 hover:bg-cyan-900/30"
              : "border-slate-700 text-slate-500 bg-slate-800/50 hover:bg-slate-700/50",
          ].join(" ")}
        >
          {part.name}
        </button>

        {/* Sample-Picker Dropdown */}
        {showSamplePicker && (
          <div className="absolute z-50 top-7 left-0 bg-slate-900 border border-slate-600 rounded shadow-xl w-48 max-h-48 overflow-y-auto">
            <div className="px-2 py-1 text-[10px] text-slate-500 border-b border-slate-700">
              Sample wählen
            </div>
            {samples.length === 0 ? (
              <div className="px-2 py-2 text-[10px] text-slate-600">Keine Samples geladen</div>
            ) : (
              samples.map(s => (
                <button
                  key={s.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSampleDrop(s.path, s.name);
                    setShowSamplePicker(false);
                  }}
                  className="w-full text-left px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700 truncate"
                >
                  {s.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Mute / Solo */}
      <button
        onClick={(e) => { e.stopPropagation(); onMute(); }}
        title="Mute"
        className={[
          "w-5 h-5 rounded text-[9px] font-bold flex-shrink-0 transition-colors",
          part.muted
            ? "bg-yellow-600 text-yellow-100"
            : "bg-slate-700 text-slate-500 hover:bg-slate-600 hover:text-slate-300",
        ].join(" ")}
      >
        M
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onSolo(); }}
        title="Solo"
        className={[
          "w-5 h-5 rounded text-[9px] font-bold flex-shrink-0 transition-colors",
          part.soloed
            ? "bg-green-600 text-green-100"
            : "bg-slate-700 text-slate-500 hover:bg-slate-600 hover:text-slate-300",
        ].join(" ")}
      >
        S
      </button>

      {/* Step-Grid */}
      <div className="flex-1 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${part.steps.length}, 1fr)` }}>
        {part.steps.map((step, i) => (
          <StepButton
            key={i}
            active={step.active}
            velocity={step.velocity ?? 100}
            pitch={step.pitch ?? 0}
            isCurrent={currentStep === i}
            isVelocityMode={isVelocityMode}
            isPitchMode={isPitchMode}
            stepIndex={i}
            groupStart={i > 0 && i % 4 === 0}
            onToggle={() => onToggleStep(i)}
            onVelocityChange={v => onVelocity(i, v)}
            onPitchChange={p => onPitch(i, p)}
          />
        ))}
      </div>

      {/* Volume-Slider (kompakt) */}
      <div className="w-12 flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <input
          type="range" min={0} max={1} step={0.01} value={part.volume}
          onChange={e => { e.stopPropagation(); onVolumeChange(Number(e.target.value)); }}
          onClick={e => e.stopPropagation()}
          title={`Volume: ${Math.round(part.volume * 100)}%`}
          className="w-full accent-cyan-500 h-1"
        />
      </div>

      {/* Kontext-Menü */}
      <div className="relative flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); setShowControls(v => !v); }}
          className="w-5 h-5 rounded text-[10px] text-slate-600 hover:text-slate-300 hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Mehr Optionen"
        >
          ⋮
        </button>
        {showControls && (
          <div className="absolute z-50 right-0 top-6 bg-slate-900 border border-slate-600 rounded shadow-xl w-36">
            <button onClick={(e) => { e.stopPropagation(); onClear(); setShowControls(false); }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700">
              ✕ Leeren
            </button>
            <button onClick={(e) => { e.stopPropagation(); onRandomize(); setShowControls(false); }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700">
              ⚄ Zufällig
            </button>
            <div className="border-t border-slate-700 my-0.5" />
            <button onClick={(e) => { e.stopPropagation(); onShiftLeft(); setShowControls(false); }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700">
              ← Verschieben
            </button>
            <button onClick={(e) => { e.stopPropagation(); onShiftRight(); setShowControls(false); }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-slate-300 hover:bg-slate-700">
              → Verschieben
            </button>
            <div className="border-t border-slate-700 my-0.5" />
            <label className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-slate-300">
              Pan
              <input
                type="range" min={-1} max={1} step={0.01} value={part.pan}
                onChange={e => { e.stopPropagation(); onPanChange(Number(e.target.value)); }}
                onClick={e => e.stopPropagation()}
                className="w-16 accent-purple-500"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
});

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export function DrumMachine({
  dm,
  samples,
  isPlaying,
  bpm,
  onPlayStop,
  onBpmChange,
  className = "",
}: DrumMachineProps) {
  const pattern = dm.getActivePattern();
  const [showPatternMenu, setShowPatternMenu] = useState(false);
  const [metronomOn, setMetronomOn] = useState(false);
  const bpmInputRef = useRef<HTMLInputElement>(null);

  // Keyboard-Shortcuts werden zentral durch useKeyboardShortcuts in App.tsx gehandhabt

  if (!pattern) return null;

  return (
    <div className={`flex flex-col bg-[#0a0a0a] text-slate-100 select-none ${className}`}>

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0d0d0d] border-b border-slate-800 flex-wrap">

        {/* Pattern-Auswahl */}
        <div className="relative">
          <button
            onClick={() => setShowPatternMenu(v => !v)}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs text-slate-300 border border-slate-700"
          >
            <span className="max-w-[100px] truncate">{pattern.name}</span>
            <span className="text-slate-500">▾</span>
          </button>
          {showPatternMenu && (
            <div className="absolute z-50 top-8 left-0 bg-slate-900 border border-slate-600 rounded shadow-xl w-44">
              {dm.patterns.map(p => (
                <button
                  key={p.id}
                  onClick={() => { dm.setActivePattern(p.id); setShowPatternMenu(false); }}
                  className={[
                    "w-full text-left px-3 py-1.5 text-xs truncate",
                    p.id === dm.activePatternId
                      ? "text-cyan-400 bg-slate-800"
                      : "text-slate-300 hover:bg-slate-700",
                  ].join(" ")}
                >
                  {p.name}
                </button>
              ))}
              <div className="border-t border-slate-700 my-0.5" />
              <button
                onClick={() => { dm.addPattern(); setShowPatternMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700"
              >
                + Neues Pattern
              </button>
              {dm.patterns.length > 1 && (
                <button
                  onClick={() => { dm.duplicatePattern(dm.activePatternId); setShowPatternMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700"
                >
                  ⎘ Duplizieren
                </button>
              )}
            </div>
          )}
        </div>

        {/* Step-Count */}
        <div className="flex rounded overflow-hidden border border-slate-700">
          {([16, 32] as const).map(n => (
            <button
              key={n}
              onClick={() => dm.setStepCount(n)}
              className={[
                "px-2 py-1 text-xs transition-colors",
                pattern.stepCount === n
                  ? "bg-cyan-700 text-white"
                  : "bg-slate-800 text-slate-500 hover:bg-slate-700",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
        </div>

        {/* Editing-Modi */}
        <button
          onClick={() => dm.setVelocityMode(!dm.velocityMode)}
          title="Velocity-Modus (Drag zum Anpassen)"
          className={[
            "px-2 py-1 rounded text-xs border transition-colors",
            dm.velocityMode
              ? "bg-cyan-800 border-cyan-600 text-cyan-200"
              : "bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700",
          ].join(" ")}
        >
          VEL
        </button>
        <button
          onClick={() => dm.setPitchMode(!dm.pitchMode)}
          title="Pitch-Modus"
          className={[
            "px-2 py-1 rounded text-xs border transition-colors",
            dm.pitchMode
              ? "bg-purple-800 border-purple-600 text-purple-200"
              : "bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700",
          ].join(" ")}
        >
          PITCH
        </button>

        <div className="flex-1" />

        {/* Metronom */}
        <button
          onClick={() => setMetronomOn(v => !v)}
          title="Metronom"
          className={[
            "px-2 py-1 rounded text-xs border transition-colors",
            metronomOn
              ? "bg-amber-800 border-amber-600 text-amber-200"
              : "bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700",
          ].join(" ")}
        >
          ♩
        </button>

        {/* BPM */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onBpmChange(Math.max(20, bpm - 1))}
            className="w-5 h-6 bg-slate-800 hover:bg-slate-700 rounded text-xs text-slate-400"
          >−</button>
          <input
            ref={bpmInputRef}
            type="number"
            min={20} max={300} value={bpm}
            onChange={e => onBpmChange(Number(e.target.value))}
            className="w-12 text-center bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 py-0.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={() => onBpmChange(Math.min(300, bpm + 1))}
            className="w-5 h-6 bg-slate-800 hover:bg-slate-700 rounded text-xs text-slate-400"
          >+</button>
          <span className="text-[10px] text-slate-600">BPM</span>
        </div>

        {/* Play/Stop */}
        <button
          onClick={onPlayStop}
          title={isPlaying ? "Stop (Space)" : "Play (Space)"}
          className={[
            "w-8 h-7 rounded flex items-center justify-center text-sm transition-colors",
            isPlaying
              ? "bg-cyan-600 text-white hover:bg-cyan-500"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600",
          ].join(" ")}
        >
          {isPlaying ? "■" : "▶"}
        </button>

        {/* Undo/Redo */}
        <button
          onClick={dm.undo}
          disabled={!dm.canUndo}
          title="Rückgängig (Ctrl+Z)"
          className="w-6 h-6 rounded text-xs bg-slate-800 text-slate-500 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
        >↩</button>
        <button
          onClick={dm.redo}
          disabled={!dm.canRedo}
          title="Wiederholen (Ctrl+Y)"
          className="w-6 h-6 rounded text-xs bg-slate-800 text-slate-500 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
        >↪</button>

        {/* Pattern leeren */}
        <button
          onClick={dm.clearPattern}
          title="Pattern leeren"
          className="px-2 py-1 rounded text-xs bg-slate-800 border border-slate-700 text-slate-500 hover:bg-red-900/50 hover:text-red-300 hover:border-red-800 transition-colors"
        >
          ✕ Leeren
        </button>
      </div>

      {/* ── Step-Nummern-Header ──────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-0.5 bg-[#0c0c0c] border-b border-slate-800/50">
        <div className="w-28 flex-shrink-0" />
        <div className="w-5 flex-shrink-0" />
        <div className="w-5 flex-shrink-0" />
        <div
          className="flex-1 grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${pattern.stepCount}, 1fr)` }}
        >
          {Array.from({ length: pattern.stepCount }, (_, i) => (
            <div
              key={i}
              className={[
                "text-center text-[8px] leading-none py-0.5",
                i % 4 === 0 ? "text-slate-400 font-medium" : "text-slate-700",
                i > 0 && i % 4 === 0 ? "border-l border-slate-700/50" : "",
              ].join(" ")}
            >
              {groupLabel(i)}
            </div>
          ))}
        </div>
        <div className="w-12 flex-shrink-0" />
        <div className="w-5 flex-shrink-0" />
      </div>

      {/* ── Part-Zeilen ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {pattern.parts.map((part, idx) => (
          <PartRow
            key={part.id}
            part={part}
            currentStep={dm.currentStep}
            isVelocityMode={dm.velocityMode}
            isPitchMode={dm.pitchMode}
            samples={samples}
            isActive={dm.activePartId === part.id}
            onSelect={() => dm.setActivePart(part.id)}
            onToggleStep={stepIndex => dm.toggleStep(part.id, stepIndex)}
            onVelocity={(stepIndex, v) => dm.setStepVelocity(part.id, stepIndex, v)}
            onPitch={(stepIndex, p) => dm.setStepPitch(part.id, stepIndex, p)}
            onMute={() => dm.setPartMuted(part.id, !part.muted)}
            onSolo={() => dm.setPartSoloed(part.id, !part.soloed)}
            onVolumeChange={v => dm.setPartVolume(part.id, v)}
            onPanChange={p => dm.setPartPan(part.id, p)}
            onSampleDrop={(url, name) => dm.setPartSample(part.id, url, name)}
            onClear={() => dm.fillPattern(part.id, 0)}
            onRandomize={() => dm.randomizePattern(part.id)}
            onShiftLeft={() => dm.shiftPattern(part.id, "left")}
            onShiftRight={() => dm.shiftPattern(part.id, "right")}
          />
        ))}

        {/* Part hinzufügen */}
        <button
          onClick={() => dm.addPart()}
          className="w-full py-1.5 text-xs text-slate-700 hover:text-slate-400 hover:bg-slate-900/50 transition-colors border-t border-slate-800/50 mt-0.5"
        >
          + Part hinzufügen
        </button>
      </div>

      {/* ── Status-Leiste ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-1 bg-[#0d0d0d] border-t border-slate-800 text-[10px] text-slate-600">
        <span>{pattern.parts.length} Parts</span>
        <span>{pattern.stepCount} Steps</span>
        <span>{bpm} BPM</span>
        {isPlaying && (
          <span className="text-cyan-700">
            ● Step {dm.currentStep + 1}/{pattern.stepCount}
          </span>
        )}
        {dm.velocityMode && <span className="text-cyan-600">VEL-Modus aktiv</span>}
        {dm.pitchMode && <span className="text-purple-600">PITCH-Modus aktiv</span>}
        <span className="flex-1" />
        <span className="text-slate-700">Leertaste = Play/Stop  •  Rechtsklick = Step-Details</span>
      </div>
    </div>
  );
}
