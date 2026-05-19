/**
 * Synthstudio – DrumMachine.tsx  (v2)
 *
 * Vollständige Drum Machine UI:
 * - 9 Kanäle mit eigenen Effekt-Reglern (Filter, EQ, Reverb, Delay, Distortion, Compressor)
 * - Step-Auflösung (1/8, 1/16, 1/32) pro Pattern und pro Kanal
 * - Pattern-BPM-Sync (eigenes BPM pro Pattern oder globales BPM)
 * - 16/32-Step-Grid mit Velocity-Farbkodierung
 * - Velocity-Editing per Drag
 * - Pitch-Popover per Rechtsklick
 * - Sample-Picker per Drag & Drop
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { PartData, ChannelFx, StepResolution } from "@/audio/AudioEngine";
import { AudioEngine } from "@/audio/AudioEngine";
import { PianoRollModal } from "@/components/PianoRoll/PianoRollModal";
import { NoteRepeatPanel } from "@/components/PerformanceMode/NoteRepeatPanel";
import { LooperPanel } from "@/components/PerformanceMode/LooperPanel";
import { TransposeControl } from "@/components/PianoRoll/TransposeControl";
import { PatternMorphPanel } from "@/components/PatternMorph";
import { MacroPanel } from "@/components/Macro/MacroPanel";
import { EnvelopeFollowerPanel } from "./EnvelopeFollowerPanel";
import { useMidiLearn } from "@/hooks/useMidiLearn";
import { toast } from "@/store/useToastStore";
// v3.65.0: Pre-Action AutoBackup via globaler Registry.
import { getRegisteredAutoBackup } from "@/utils/autoBackupController";
// v3.66.0: Pattern als PNG/SVG exportieren.
import { PatternImageExportModal } from "@/components/PatternImageExport/PatternImageExportModal";
import { PatternCompareModal } from "@/components/PatternCompare/PatternCompareModal";
import type { PatternForExport } from "@/utils/patternImageExport";
import { MixAssistantPanel } from "./MixAssistantPanel";
import type { MixAnalysisInput, MixRecommendation } from "@/utils/mixAnalysis";
import { parseMidiFile } from "../../../../src/utils/midiParser.js";
import { parseFlp, flpPositionToStep, groupNotesByBar, calculateBarCount } from "@/utils/flpImport";
import {
  parseElectribeBank,
  convertParsedPatternToSynthstudio,
  filterNonInitPatterns,
  type ParsedPattern,
  type SynthstudioPatternImport,
} from "@/utils/electribeImport";
import { requireProFeature, PRO_FEATURE_ELECTRIBE_IMPORT, PRO_FEATURE_KORG_BANK_IMPORT, PRO_FEATURE_KORG_BANK_WRITE, PRO_FEATURE_E2_PATTERN_EXPORT } from "@/utils/proFeatures";
import { buildE2PatternFile } from "@/utils/electribePatternBuilder";
import { convertSynthstudioPatternToE2 } from "@/utils/electribePatternConvert";
import { useElectron } from "../../../../electron/useElectron";
import { ProLockBadge } from "@/components/License/ProLockBadge";
import { GranularSynthPanel } from "./GranularSynthPanel";
import { DEFAULT_GRANULAR_PARAMS } from "@/audio/GranularEngine";
import { PolyrhythmVisualizer } from "./PolyrhythmVisualizer";
import { SampleSliceEditor } from "@/components/SampleEditor/SampleSliceEditor";
import type { SliceSpec } from "@/utils/sampleSlicing";
// Ausgelagerte Sub-Components
import { FxPanel } from "./FxPanel";
import { ResizableDrumPanel } from "./ResizableDrumPanel";
import { StepInspector } from "./StepInspector";
import { ChannelStrip } from "./ChannelStrip";
import { stepGroupBorder, getPageCount, getPageStepRange, getPageForStep, getPageRangeLabel } from "./drumMachineHelpers";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Props {
  dm: DrumMachineState & DrumMachineActions;
  samples: Array<{ id: string; name: string; path: string; category: string }>;
  isPlaying: boolean;
  bpm: number;
  onPlayStop: () => void;
  onBpmChange: (bpm: number) => void;
  className?: string;
  /**
   * v3.38.0 — External MIDI-Clock-IN active flag. When true AND
   * `externalSyncStatus` indicates an active sync, the BPM-Slider is
   * disabled with a tooltip indicating "BPM extern gesynced".
   */
  externalSyncEnabled?: boolean;
  /**
   * v3.38.0 — Current external sync status. Slider is locked when this is
   * "running" or "tempo-only" (we know the master tempo). For "off"/"lost"
   * the slider remains writable.
   */
  externalSyncStatus?: "off" | "tempo-only" | "running" | "lost";
}

/**
 * v3.38.0 — Pure helper: when is the BPM slider locked by an external MIDI
 * clock master? Exported so tests can assert behaviour without rendering.
 */
export function isBpmExternallyLocked(
  enabled: boolean | undefined,
  status: "off" | "tempo-only" | "running" | "lost" | undefined,
): boolean {
  if (!enabled) return false;
  return status === "running" || status === "tempo-only";
}


// ─── Pattern-Row mit Right-Click MIDI-Learn (v1.92) ───────────────────────────

interface PatternRowProps {
  pattern: { id: string; name: string; bpm: number | null };
  patternIndex: number;
  isActive: boolean;
  isPlaying: boolean;
  isLiveEditing: boolean;
  showDelete: boolean;
  /** v2.4: ob ein vorheriges Pattern existiert (für Sample-Übernahme-Button). */
  hasPrevPattern: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  /** v2.4: Sampler vom angegebenen Source-Pattern in dieses übernehmen. */
  onCopySamplesFrom: (sourcePatternId: string, sourceName: string) => void;
  /** v2.4: ID des vorherigen Patterns (für die Quick-Action). */
  prevPatternId: string | null;
  /** v2.5: Alle Patterns für den Picker-Submenu. */
  allPatterns: ReadonlyArray<{ id: string; name: string }>;
  /** v2.8: Drag-Drop Reorder callback (fromIndex, toIndex). */
  onReorder: (fromIndex: number, toIndex: number) => void;
  /** v3.66.0: Pattern als PNG/SVG exportieren. */
  onExportImage?: () => void;
  /** v3.91.0: Pattern als Slot A im Compare-Modal öffnen. */
  onCompare?: () => void;
}

function PatternRow({
  pattern, patternIndex, isActive, isPlaying, isLiveEditing, showDelete,
  hasPrevPattern, prevPatternId, allPatterns,
  onSelect, onDuplicate, onRemove, onCopySamplesFrom, onReorder, onExportImage, onCompare,
}: PatternRowProps) {
  const isDraft  = isLiveEditing && isActive;
  const isLocked = isLiveEditing && isPlaying;
  // v1.92: jede Pattern-Zeile ist via Rechtsklick MIDI-bindbar
  const learn = useMidiLearn({ type: "pattern", patternIndex });
  // v2.5: Submenu zum Auswählen welcher Pattern als Source dient
  const [pickerOpen, setPickerOpen] = useState(false);
  // v2.8: Drag-Drop-Reorder State (drop-indicator: above|below|null)
  const [dropIndicator, setDropIndicator] = useState<"above" | "below" | null>(null);

  return (
    <div
      className="flex items-center group relative"
      // v2.8: Drag-Drop-Reorder. Visual: blauer Strich oberhalb/unterhalb der Zeile
      // beim Drag-Over zeigt wo das Pattern eingefügt wird.
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-synthstudio-pattern-row")) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          setDropIndicator(e.clientY < midY ? "above" : "below");
        }
      }}
      onDragLeave={() => setDropIndicator(null)}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData("application/x-synthstudio-pattern-row");
        if (!raw) return;
        e.preventDefault();
        const fromIndex = parseInt(raw, 10);
        if (isNaN(fromIndex) || fromIndex === patternIndex) {
          setDropIndicator(null);
          return;
        }
        // Drop above N: insert at N (if from>N) or N-1 (if from<N)
        // Drop below N: insert at N+1 (if from>N) or N (if from<N)
        const targetIdx = dropIndicator === "below" ? patternIndex + 1 : patternIndex;
        const adjustedTarget = fromIndex < targetIdx ? targetIdx - 1 : targetIdx;
        onReorder(fromIndex, adjustedTarget);
        setDropIndicator(null);
      }}
    >
      {dropIndicator === "above" && (
        <div className="absolute left-0 right-0 -top-px h-0.5 bg-accent-secondary z-10 pointer-events-none" />
      )}
      {dropIndicator === "below" && (
        <div className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent-secondary z-10 pointer-events-none" />
      )}
      {/* v2.8: Drag-Handle für Pattern-Reorder */}
      {!isLocked && (
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/x-synthstudio-pattern-row", String(patternIndex));
          }}
          className="cursor-grab active:cursor-grabbing px-1 text-text-dim hover:text-text-primary text-[10px] opacity-0 group-hover:opacity-100"
          title="Drag&Drop zum Sortieren"
        >☰</span>
      )}
      <button
        onClick={() => { if (!isLocked) onSelect(); }}
        onContextMenu={learn.onContextMenu}
        disabled={isLocked}
        title={`${isLocked ? "Wird abgespielt – während Live-Edit nicht bearbeitbar" : pattern.name}${learn.isMapped ? ` · CC${learn.mappedCC}` : ""} · Rechtsklick: MIDI-Learn`}
        className={[
          "flex-1 text-left px-3 py-1.5 text-xs transition-colors",
          isDraft    ? "text-accent-primary bg-accent-primary/20 font-semibold"   :
          isActive   ? "text-accent-secondary bg-accent-secondary/20"              :
          isLocked   ? "text-text-dim cursor-not-allowed opacity-50"              :
                       "text-text-primary hover:bg-bg-panel",
        ].join(" ")}
      >
        {isPlaying && <span className="mr-1.5 text-accent-danger" title="Wird gerade abgespielt">▶</span>}
        {isDraft   && <span className="mr-1.5 text-accent-primary" title="Draft – wird bearbeitet">✏</span>}
        {pattern.name}
        {pattern.bpm !== null && (
          <span className="ml-1 text-[9px] text-text-dim">{pattern.bpm} BPM</span>
        )}
        {learn.isMapped && (
          <span className="ml-1.5 text-[9px] font-mono text-accent-secondary">CC{learn.mappedCC}</span>
        )}
        {isLocked && <span className="ml-1.5 text-[9px] text-text-dim">[gesperrt]</span>}
      </button>
      {/* v2.4 + v2.5: Sampler-Übernahme — Split-Button + Picker-Submenu */}
      {!isLocked && allPatterns.length > 1 && (
        <div className="relative inline-flex opacity-0 group-hover:opacity-100">
          {hasPrevPattern && prevPatternId && (() => {
            const prevPat = allPatterns.find(p => p.id === prevPatternId);
            return (
              <button
                onClick={() => onCopySamplesFrom(prevPatternId, prevPat?.name ?? "")}
                className="px-1.5 py-1.5 text-text-dim hover:text-accent-secondary text-xs"
                title={`Sampler+FX vom vorherigen Pattern „${prevPat?.name ?? "..."}" übernehmen (Steps bleiben). Tastenkombination: Ctrl+Shift+S`}
              >📥</button>
            );
          })()}
          <button
            onClick={() => setPickerOpen(o => !o)}
            className="px-1 py-1.5 text-text-dim hover:text-accent-secondary text-[10px]"
            title="Sampler aus einem beliebigen Pattern übernehmen"
            aria-label="Sampler-Quelle wählen"
          >▾</button>
          {pickerOpen && (
            <div
              className="absolute left-0 top-full mt-0.5 bg-bg-elevated border border-border-color rounded shadow-xl z-50 min-w-[180px] py-1"
              onMouseLeave={() => setPickerOpen(false)}
            >
              <div className="px-3 py-1 text-[10px] text-text-dim uppercase tracking-wider border-b border-border-color">
                Sampler übernehmen aus
              </div>
              {allPatterns
                .filter(p => p.id !== pattern.id)
                .map(src => (
                  <button
                    key={src.id}
                    onClick={() => { onCopySamplesFrom(src.id, src.name); setPickerOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-accent-secondary/20 truncate"
                    title={`Sampler+FX von „${src.name}" in „${pattern.name}" übernehmen`}
                  >
                    📥 {src.name}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
      {!isLocked && onExportImage && (
        <button
          onClick={onExportImage}
          className="px-1.5 py-1.5 text-text-dim hover:text-accent-primary text-xs opacity-0 group-hover:opacity-100"
          title="Als Bild exportieren (PNG / SVG)"
          data-testid={`pattern-row-export-image-${patternIndex}`}
        >🖼</button>
      )}
      {/* v3.91.0: Pattern-Compare — öffnet Diff-Modal mit dieser Pattern als Slot A. */}
      {!isLocked && onCompare && allPatterns.length > 1 && (
        <button
          onClick={onCompare}
          className="px-1.5 py-1.5 text-text-dim hover:text-accent-secondary text-xs opacity-0 group-hover:opacity-100"
          title="Mit anderem Pattern vergleichen (Diff)"
          data-testid={`pattern-row-compare-${patternIndex}`}
        >🔀</button>
      )}
      {!isLocked && (
        <button
          onClick={onDuplicate}
          className="px-1.5 py-1.5 text-text-dim hover:text-text-primary text-xs opacity-0 group-hover:opacity-100"
          title="Duplizieren"
        >⧉</button>
      )}
      {showDelete && !isLocked && !isDraft && (
        <button
          onClick={onRemove}
          className="px-1.5 py-1.5 text-text-dim hover:text-accent-danger text-xs opacity-0 group-hover:opacity-100"
          title="Löschen"
        >✕</button>
      )}
      {learn.menu}
    </div>
  );
}

// ─── Electribe-Bank-Picker-Modal (v3.11: Search + Init-Filter) ───────────────

interface ElectribePickerModalProps {
  picker: { fileName: string; patterns: ParsedPattern[] };
  onSelect: (p: ParsedPattern) => void;
  onClose: () => void;
}

function ElectribePickerModal({ picker, onSelect, onClose }: ElectribePickerModalProps) {
  const [search, setSearch] = useState("");
  // Default: bei grossen Banks (>50 Patterns, also .e2sallpat) Init-Slots ausblenden.
  const [hideInit, setHideInit] = useState(picker.patterns.length > 50);

  // Pre-compute slot-indizierte Liste (#1..#250) bevor wir filtern.
  const indexed = useMemo(
    () => picker.patterns.map((p, idx) => ({ slot: idx + 1, pattern: p })),
    [picker.patterns],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = indexed;
    if (hideInit) {
      const nonInit = new Set(filterNonInitPatterns(picker.patterns));
      arr = arr.filter(x => nonInit.has(x.pattern));
    }
    if (q) {
      arr = arr.filter(x =>
        x.pattern.name.toLowerCase().includes(q) ||
        String(x.slot).includes(q) ||
        x.pattern.bpm.toFixed(1).includes(q),
      );
    }
    return arr;
  }, [indexed, picker.patterns, search, hideInit]);

  const totalCount    = picker.patterns.length;
  const filteredCount = visible.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      data-testid="electribe-picker-overlay"
    >
      <div
        className="bg-bg-panel border border-border-color rounded-lg shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Electribe-Pattern auswählen"
      >
        <div className="px-4 py-3 border-b border-border-color">
          <div className="text-sm font-bold text-text-primary">Electribe Bank importieren</div>
          <div className="text-xs text-text-muted truncate">
            {picker.fileName} · {filteredCount}/{totalCount} Pattern(s)
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter: Name / Slot / BPM..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-bg-elevated border border-border-color rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-primary"
              data-testid="electribe-picker-search"
            />
            {totalCount > 50 && (
              <label className="inline-flex items-center gap-1 text-[10px] text-text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideInit}
                  onChange={(e) => setHideInit(e.target.checked)}
                  data-testid="electribe-picker-hide-init"
                />
                Init ausblenden
              </label>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {visible.length === 0 ? (
            <div className="text-center text-text-dim text-xs py-8">
              Keine Patterns entsprechen dem Filter.
            </div>
          ) : (
            visible.map(({ slot, pattern: p }) => (
              <button
                key={slot}
                data-testid={`electribe-picker-pattern-${slot - 1}`}
                onClick={() => onSelect(p)}
                className="w-full text-left px-3 py-2 rounded bg-bg-elevated hover:bg-bg-base text-text-primary text-xs flex items-center justify-between gap-2 transition-colors"
              >
                <span className="font-mono text-text-dim w-10">#{slot}</span>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-text-muted text-[10px]">{p.bpm.toFixed(1)} BPM · {p.stepLength}st</span>
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t border-border-color flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1 rounded text-xs bg-bg-elevated text-text-muted hover:text-text-primary transition-colors"
            data-testid="electribe-picker-cancel"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export function DrumMachine({ dm, samples, isPlaying, bpm, onPlayStop, onBpmChange, className = "", externalSyncEnabled, externalSyncStatus }: Props) {
  // v3.38.0 — BPM-Slider lock-state when external MIDI Clock-IN sync is active.
  const bpmLocked = isBpmExternallyLocked(externalSyncEnabled, externalSyncStatus);
  const pattern = dm.getActivePattern();
  // v3.26.0 — Electron-Bridge für E2 Pattern Export
  const electron = useElectron();
  const [showPatternMenu, setShowPatternMenu] = useState(false);
  const [metronomOn, setMetronomOn] = useState(false);
  const [metronomGain, setMetronomGain] = useState(0.5);
  const [metronomAccent, setMetronomAccent] = useState(1.0);
  const [metronomTone, setMetronomTone] = useState(0.5);
  const [metronomBeatsPerBar, setMetronomBeatsPerBar] = useState(4);
  const [metronomOscType, setMetronomOscType] = useState<OscillatorType>("sine");
  const [metronomSubdivision, setMetronomSubdivision] = useState<"beat" | "eighth" | "sixteenth">("beat");
  const [showMetronomPanel, setShowMetronomPanel] = useState(false);
  const metronomPanelRef = useRef<HTMLDivElement>(null);
  const [masterVolume, setMasterVolume] = useState(0.85);
  const [bpmInput, setBpmInput] = useState(String(bpm));
  // v1.86: Right-Click-MIDI-Learn auf BPM + Play/Stop
  const bpmLearn = useMidiLearn({ type: "bpm" });
  const playStopLearn = useMidiLearn({ type: "playStop" });
  const bpmInputRef = useRef<HTMLInputElement>(null);
  const [pianoRollPartId, setPianoRollPartId] = useState<string | null>(null);
  const [abSlotA, setAbSlotA] = useState<string | null>(null);
  const [abSlotB, setAbSlotB] = useState<string | null>(null);
  const [abActive, setAbActive] = useState<"A" | "B">("A");
  // Pattern Variations A/B/C/D
  const [varSlots, setVarSlots] = useState<Record<string, string | null>>({ A: null, B: null, C: null, D: null });
  const [activeVar, setActiveVar] = useState<string>("A");
  const [showNoteRepeat, setShowNoteRepeat] = useState(false);
  const [showLooper, setShowLooper] = useState(false);
  const [showMorph, setShowMorph] = useState(false);
  const [showMixAssistant, setShowMixAssistant] = useState(false);
  const [showEnvFollower, setShowEnvFollower] = useState(false);
  const [showMacros, setShowMacros] = useState(false);
  const [showPolyrhythm, setShowPolyrhythm] = useState(false);
  // v3.40 — 64-Step Page-Switcher: bei stepCount > 16 wird das Grid in 16er-Pages
  // aufgeteilt. State ist lokal (nicht im Store) damit jedes geöffnete Pattern
  // mit Page-0 startet; Auto-Follow während Playback synchronisiert die Page mit
  // currentStep.
  const [currentPatternPage, setCurrentPatternPage] = useState(0);
  const [autoPageFollow, setAutoPageFollow] = useState(true);
  const midiImportRef = useRef<HTMLInputElement>(null);
  const flpImportRef = useRef<HTMLInputElement>(null);
  const electribeImportRef = useRef<HTMLInputElement>(null);
  const korgBankImportRef = useRef<HTMLInputElement>(null);
  const sliceImportRef = useRef<HTMLInputElement>(null);
  const [selectedStep, setSelectedStep] = useState<{ partId: string; stepIndex: number } | null>(null);
  const [granularPartId, setGranularPartId] = useState<string | null>(null);
  // TASK-237: nach Bank-Parse haelt der Dialog die Pattern-Liste fuer User-Auswahl.
  const [electribePicker, setElectribePicker] = useState<{
    fileName: string;
    patterns: ParsedPattern[];
  } | null>(null);
  // TASK-238 (v2.89): Sample-Slice-Editor-State. channelData ist mono (Kanal 0).
  const [sliceEditor, setSliceEditor] = useState<{
    sampleName: string;
    channelData: Float32Array;
    sampleRate: number;
  } | null>(null);
  // v3.66.0: Pattern-Image-Export-Modal-State.
  const [patternImageExport, setPatternImageExport] = useState<PatternForExport | null>(null);
  // v3.91.0: Pattern-Compare-Modal-State. Wenn !== null wird das Modal mit
  // dieser Pattern-ID als Slot A geöffnet; Slot B wird vom Modal selbst gewählt.
  const [compareModalAId, setCompareModalAId] = useState<string | null>(null);

  // MIDI-Import: MIDI-Datei in aktives Pattern übertragen
  /**
   * v2.12: Pure-File-Variante für Drag-Drop und File-Picker.
   * handleMidiImport (file-input ChangeEvent) delegiert an diese Funktion.
   */
  const handleMidiFile = useCallback((file: File) => {
    if (!file || !pattern) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const buffer = ev.target?.result as ArrayBuffer;
        const parsed = parseMidiFile(buffer);
        if (!parsed?.tracks?.length) {
          toast(`Keine Tracks im MIDI-File: ${file.name}`, { kind: "warning" });
          return;
        }
        const tpqn: number = parsed.ticksPerQuarterNote ?? 480;
        const stepCount = pattern.stepCount;
        // GM Drum Map: MIDI-Note → Part-Index
        const noteToPartIdx: Record<number, number> = { 36:0, 35:0, 38:1, 40:1, 42:2, 44:2, 46:3, 49:4, 51:4, 41:5, 43:6, 45:6, 75:7, 56:7, 37:8 };

        // Alle NoteOn-Events aus allen Tracks in absolute Ticks umrechnen
        const noteOns: Array<{ note: number; velocity: number; absTick: number }> = [];
        for (const track of parsed.tracks) {
          let abs = 0;
          for (const ev of track) {
            abs += ev.deltaTime ?? 0;
            if (ev.type === "noteOn" && ev.note !== undefined && (ev.velocity ?? 0) > 0) {
              noteOns.push({ note: ev.note, velocity: ev.velocity ?? 100, absTick: abs });
            }
          }
        }
        if (!noteOns.length) {
          toast(`Keine Notes im MIDI-File: ${file.name}`, { kind: "warning" });
          return;
        }

        // Normalisierung: Quantize auf 1/16 Steps (tpqn/4 ticks per step)
        const ticksPerStep = tpqn / 4;
        const newSteps: boolean[][] = pattern.parts.map(() => Array(stepCount).fill(false));
        const newVels: number[][] = pattern.parts.map(() => Array(stepCount).fill(100));

        for (const { note, velocity, absTick } of noteOns) {
          const step = Math.round(absTick / ticksPerStep) % stepCount;
          const partIdx = noteToPartIdx[note] ?? (note % pattern.parts.length);
          if (partIdx < pattern.parts.length) {
            newSteps[partIdx][step] = true;
            newVels[partIdx][step] = velocity;
          }
        }
        pattern.parts.forEach((part, i) => dm.setPartSteps(part.id, newSteps[i], newVels[i]));
        toast(`MIDI importiert: ${file.name} (${noteOns.length} Notes)`, { kind: "success" });
      } catch (err) {
        console.error("[MIDI Import]", err);
        const msg = err instanceof Error ? err.message : String(err);
        toast(`MIDI-Import fehlgeschlagen: ${msg}`, { kind: "error", duration: 5000 });
      }
    };
    reader.readAsArrayBuffer(file);
  }, [pattern, dm]);

  const handleMidiImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleMidiFile(file);
    e.target.value = "";
  }, [handleMidiFile]);

  // v2.12: Drag-Drop für .mid-Files via globales Event (von ElectronDropZone dispatched).
  useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (file instanceof File) handleMidiFile(file);
    };
    window.addEventListener("midi:fileImport", handler);
    return () => window.removeEventListener("midi:fileImport", handler);
  }, [handleMidiFile]);

  /**
   * FLP-Import: extrahiert ALLE Notes aus dem ersten FL-Pattern und verteilt
   * sie auf mehrere Synthstudio-Patterns falls die Notes über mehrere Bars
   * gehen.
   *
   * Workflow:
   *   - Bar 0 → aktives Pattern überschreiben
   *   - Bar 1..N → neue Patterns via addPatternData()
   *   - Bei mehr als MAX Bars: clamping mit Console-Warn
   */
  const handleFlpImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pattern) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const buffer = ev.target?.result as ArrayBuffer;
        const parsed = parseFlp(buffer);
        if (!parsed.patterns.length) {
          console.warn("[FLP Import] Keine Patterns im FLP gefunden");
          return;
        }
        const firstPattern = parsed.patterns[0];
        if (!firstPattern.notes.length) {
          console.warn("[FLP Import] Erstes Pattern ist leer");
          return;
        }

        const ppq = parsed.header.ppq;
        const stepCount = pattern.stepCount;
        const partCount = pattern.parts.length;
        const fileName = file.name.replace(/\.flp$/i, "");

        // Pro Bar gruppieren (bar-relative positions). Max 16 Bars um nicht
        // versehentlich aus einem riesigen Projekt 100 Patterns zu erzeugen.
        const MAX_BARS = 16;
        const totalBars = Math.min(MAX_BARS, calculateBarCount(firstPattern.notes, ppq, stepCount));
        const byBar = groupNotesByBar(firstPattern.notes, ppq, stepCount);

        const buildPattern = (barNotes: import("@/utils/flpImport").FlpNote[]) => {
          const steps: boolean[][] = pattern.parts.map(() => Array(stepCount).fill(false));
          const vels: number[][] = pattern.parts.map(() => Array(stepCount).fill(100));
          for (const note of barNotes) {
            const step = flpPositionToStep(note.position, ppq) % stepCount;
            const partIdx = note.channel % partCount;
            steps[partIdx][step] = true;
            vels[partIdx][step] = note.velocity;
          }
          return { steps, vels };
        };

        // Bar 0 → aktives Pattern überschreiben
        const bar0 = byBar.get(0) ?? [];
        const bar0Built = buildPattern(bar0);
        pattern.parts.forEach((part, i) => dm.setPartSteps(part.id, bar0Built.steps[i], bar0Built.vels[i]));

        // Bar 1..N → neue Patterns
        const createdPatternIds: string[] = [];
        for (let bar = 1; bar < totalBars; bar++) {
          const barNotes = byBar.get(bar) ?? [];
          const { steps, vels } = buildPattern(barNotes);
          const newParts = pattern.parts.map((p, i) => ({
            ...p,
            steps: p.steps.map((s, idx) => ({
              ...s,
              active: steps[i][idx] ?? false,
              velocity: vels[i][idx] ?? 100,
            })),
          }));
          const newPatternData = {
            ...pattern,
            id: `flp-${Date.now()}-${bar}`,
            name: `${fileName} bar ${bar + 1}`,
            parts: newParts,
          };
          const id = dm.addPatternData(newPatternData);
          createdPatternIds.push(id);
        }

        const totalNotesInRange = Array.from(byBar.entries())
          .filter(([bar]) => bar < totalBars)
          .reduce((sum, [, ns]) => sum + ns.length, 0);
        const fullTotal = firstPattern.notes.length;
        console.log(`[FLP Import] ${fullTotal} notes → ${totalBars} bar(s), ${totalNotesInRange} importiert${fullTotal > totalNotesInRange ? ` (${fullTotal - totalNotesInRange} jenseits MAX_BARS=${MAX_BARS} getruncated)` : ""}`);
        if (createdPatternIds.length > 0) {
          alert(`FLP importiert: ${totalBars} Bars als ${totalBars} Patterns.\nAktuelles Pattern = Bar 1, neue Patterns hinzugefügt: ${createdPatternIds.length}.`);
        }
      } catch (err) {
        console.error("[FLP Import]", err);
        alert("FLP-Import fehlgeschlagen. Vermutlich ungültige oder neuere FLP-Version.\n\n" + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }, [pattern, dm]);

  // ── KORG Electribe Pattern-Import (TASK-237 / v2.88) ───────────────────────
  //
  // .e2pattern   → single pattern, sofort importieren
  // .e2sallpat   → bank, zeigt Picker-Dialog mit allen Patterns drin
  //
  // Konvertierung via convertParsedPatternToSynthstudio:
  //   - 16 Electribe-Parts → maximal pattern.parts.length Synthstudio-Drum-Parts
  //   - Steps + Velocities → setPartSteps
  //   - Volume/Pan → setPartVolume/setPartPan
  //   - BPM → setPatternBpm
  //   - Motion-Slots werden derzeit verworfen mit Console-Info — Mapping auf
  //     useAutomationStore braucht App-Level-Wiring (Drum-Part-IDs unbekannt
  //     auf Util-Ebene). Follow-up via App.tsx-Bridge.
  const importElectribePatternIntoActive = useCallback((parsed: ParsedPattern, fileName: string) => {
    if (!pattern) return;
    const conv: SynthstudioPatternImport = convertParsedPatternToSynthstudio(parsed);

    // Pattern-Name + BPM uebernehmen.
    dm.renamePattern(pattern.id, conv.name || pattern.name);
    dm.setPatternBpm(pattern.id, conv.bpm);

    // Per-Part Steps + Volume + Pan (so viele Parts wie im aktiven Pattern existieren).
    const partLimit = Math.min(conv.drumParts.length, pattern.parts.length);
    for (let i = 0; i < partLimit; i++) {
      const part = pattern.parts[i];
      const src  = conv.drumParts[i];
      // Steps duerfen kuerzer/laenger als das aktive Pattern sein — clampen.
      const targetSteps = pattern.stepCount;
      const steps = new Array<boolean>(targetSteps).fill(false);
      const vels  = new Array<number>(targetSteps).fill(100);
      const cap   = Math.min(targetSteps, src.steps.length);
      for (let s = 0; s < cap; s++) {
        steps[s] = src.steps[s];
        vels[s]  = src.velocities[s];
      }
      dm.setPartSteps(part.id, steps, vels);
      dm.setPartVolume(part.id, src.volume);
      dm.setPartPan(part.id, src.pan);
    }

    const motionInfo = conv.automationLanes.length > 0
      ? ` + ${conv.automationLanes.length} Motion-Lane(s)`
      : "";
    toast(
      `Electribe importiert: ${fileName} → ${conv.name} (${partLimit}/16 Parts${motionInfo})`,
      { kind: "success" }
    );

    // Motion-Sequencer-Daten als CustomEvent rausreichen — App.tsx bridge
    // entscheidet, ob er sie in useAutomationStore einspeist (braucht Store-Ref).
    if (conv.automationLanes.length > 0) {
      try {
        window.dispatchEvent(new CustomEvent("electribe:motion-lanes", {
          detail: { patternId: pattern.id, lanes: conv.automationLanes },
        }));
      } catch (err) {
        console.warn("[Electribe Import] CustomEvent dispatch failed", err);
      }
    }
  }, [pattern, dm]);

  // Pure-File-Variante (fuer Drag-Drop + File-Picker).
  const handleElectribeFile = useCallback((file: File) => {
    if (!pattern) return;
    // TASK-232 (v2.97): Electribe-Import ist ein Pro-Feature.
    if (!requireProFeature(PRO_FEATURE_ELECTRIBE_IMPORT)) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const buffer = ev.target?.result as ArrayBuffer;
        const bank = parseElectribeBank(buffer);
        if (!bank.patterns.length) {
          toast(`Keine Patterns in: ${file.name}`, { kind: "warning" });
          return;
        }
        if (bank.patterns.length === 1) {
          // Single-Pattern → direkt importieren.
          importElectribePatternIntoActive(bank.patterns[0], file.name);
        } else {
          // Bank → Picker-Dialog oeffnen.
          setElectribePicker({ fileName: file.name, patterns: bank.patterns });
        }
      } catch (err) {
        console.error("[Electribe Import]", err);
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Electribe-Import fehlgeschlagen: ${msg}`, { kind: "error", duration: 5000 });
      }
    };
    reader.readAsArrayBuffer(file);
  }, [pattern, importElectribePatternIntoActive]);

  const handleElectribeImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleElectribeFile(file);
    e.target.value = "";
  }, [handleElectribeFile]);

  // ── Sample-Slicing (TASK-238 / v2.89) ──────────────────────────────────────
  // File-Picker → decodeAudioData → channelData (Kanal 0) → Modal-Open.
  // Kein Electron-Direktzugriff — isomorph ueber Browser-File-API.
  //
  // v3.1.0: handleSliceFile extrahiert als reine File→Modal-Pipeline, damit
  // sowohl der Picker-Pfad (handleSliceImport) als auch der Drag-Drop-Pfad
  // (onReplaceSample in SampleSliceEditor) dieselbe Decode-Logik nutzen.
  const handleSliceFile = useCallback(async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      type AnyWin = typeof window & { webkitAudioContext?: typeof AudioContext };
      const AC = window.AudioContext || (window as AnyWin).webkitAudioContext;
      if (!AC) {
        toast("Web-Audio nicht verfuegbar in diesem Browser", { kind: "error" });
        return;
      }
      const ctx = new AC();
      try {
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        const channelData = new Float32Array(audioBuffer.getChannelData(0));
        setSliceEditor({
          sampleName: file.name,
          channelData,
          sampleRate: audioBuffer.sampleRate,
        });
      } finally {
        if (typeof ctx.close === "function") {
          try { await ctx.close(); } catch { /* ignore */ }
        }
      }
    } catch (err) {
      console.error("[SampleSlicer] decode failed", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Sample-Decode fehlgeschlagen: ${msg}`, { kind: "error", duration: 5000 });
    }
  }, []);

  const handleSliceImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await handleSliceFile(file);
  }, [handleSliceFile]);

  const handleSlicesApply = useCallback((slices: Float32Array[], _specs: SliceSpec[]) => {
    // MVP: kein direktes Pad-Slot-Wiring (Performance-Pads halten patternId, nicht
    // Sample-Buffer). Wir reichen die Slices als CustomEvent durch — App-Level kann
    // sie spaeter konsumieren (z.B. KeyboardSampler-Zonen oder ein neuer
    // Slice-Pad-Store). Heute: Toast + Console-Log + Modal schliessen.
    try {
      window.dispatchEvent(new CustomEvent("sample-slicer:apply", {
        detail: {
          sampleName: sliceEditor?.sampleName ?? "sample",
          sampleRate: sliceEditor?.sampleRate ?? 44100,
          slices,
        },
      }));
    } catch (err) {
      console.warn("[SampleSlicer] CustomEvent dispatch failed", err);
    }
    const padCount = Math.min(slices.length, 16);
    toast(
      `${padCount} Slice(s) erstellt — Direct-Assign in Pad-Slots noch nicht implementiert. Slice-Buffer via 'sample-slicer:apply'-Event verfuegbar.`,
      { kind: "info", duration: 4500 },
    );
    setSliceEditor(null);
  }, [sliceEditor]);

  // Drag-Drop fuer .e2pattern/.e2sallpat (Browser-Fallback).
  useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (file instanceof File) handleElectribeFile(file);
    };
    window.addEventListener("electribe:fileImport", handler);
    return () => window.removeEventListener("electribe:fileImport", handler);
  }, [handleElectribeFile]);

  // Keyboard-Shortcuts werden zentral durch useKeyboardShortcuts in App.tsx gehandhabt

  // BPM-Input synchronisieren
  useEffect(() => {
    setBpmInput(String(bpm));
  }, [bpm]);

  // v3.40: Page-Switcher-State zurücksetzen bei Pattern-Wechsel oder wenn
  // stepCount kleiner wird (z. B. 64 → 16 → currentPatternPage könnte 3 sein).
  useEffect(() => {
    if (!pattern) return;
    const pages = getPageCount(pattern.stepCount);
    if (currentPatternPage >= pages) {
      setCurrentPatternPage(0);
    }
    // pattern.id wechselt → starte stets auf Page 0 (User-Erwartung beim
    // Pattern-Sprung).
  }, [pattern?.id, pattern?.stepCount, currentPatternPage]);

  // v3.40: Auto-Page-Follow während Playback — Page wechselt automatisch mit
  // currentStep wenn isPlaying && autoPageFollow && stepCount > 16. User kann
  // Follow per Toggle deaktivieren um manuell zu editieren während Playback.
  useEffect(() => {
    if (!pattern) return;
    if (!isPlaying || !autoPageFollow) return;
    if (pattern.stepCount <= 16) return;
    const targetPage = getPageForStep(dm.currentStep, pattern.stepCount);
    if (targetPage !== currentPatternPage) {
      setCurrentPatternPage(targetPage);
    }
  }, [isPlaying, autoPageFollow, dm.currentStep, pattern?.stepCount, currentPatternPage, pattern]);

  // Metronom-Panel schließen bei Klick außerhalb
  useEffect(() => {
    if (!showMetronomPanel) return;
    const handler = (e: MouseEvent) => {
      if (!metronomPanelRef.current?.contains(e.target as Node)) {
        setShowMetronomPanel(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMetronomPanel]);

  // Metronom-Sync
  useEffect(() => {
    const downbeatFreq = 800 + metronomTone * 1200;
    const beatFreq = 500 + metronomTone * 700;
    AudioEngine.setMetronom(
      metronomOn, metronomGain, metronomAccent, downbeatFreq, beatFreq,
      metronomBeatsPerBar, metronomSubdivision, metronomOscType,
    );
  }, [metronomOn, metronomGain, metronomAccent, metronomTone, metronomBeatsPerBar, metronomOscType, metronomSubdivision]);

  // Master-Volume-Sync
  useEffect(() => {
    AudioEngine.setMasterVolume(masterVolume);
  }, [masterVolume]);

  // Effekte live aktualisieren
  useEffect(() => {
    if (!pattern) return;
    pattern.parts.forEach(part => {
      AudioEngine.updateChannelFx(part.id, part.fx);
    });
  }, [pattern]);

  if (!pattern) return null;

  const effectiveBpm = pattern.bpm ?? bpm;
  const isLiveEditing = !!dm.liveEditSourcePatternId;
  const playbackPattern = isLiveEditing
    ? dm.patterns.find(p => p.id === dm.liveEditSourcePatternId)
    : null;

  return (
    <div
      className={`flex flex-col bg-bg-base text-text-primary select-none overflow-hidden ${className}`}
      role="region"
      aria-label="Drum Machine Sequencer"
    >

      {/* ── Live Edit Banner ────────────────────────────────────────────── */}
      {isLiveEditing && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-accent-danger/10 border-b-2 border-accent-danger text-xs flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-accent-danger animate-pulse flex-shrink-0" />
          <span className="font-bold text-accent-danger">LIVE EDIT</span>
          <span className="text-text-muted">
            ▶ spielt: <strong className="text-text-primary">{playbackPattern?.name ?? "–"}</strong>
          </span>
          <span className="text-text-dim mx-1">·</span>
          <span className="text-text-muted">
            ✏ bearbeite: <strong className="text-text-primary">{pattern.name}</strong>
          </span>
          <div className="flex-1" />
          {/* Commit: sofort */}
          <button
            onClick={dm.commitLivePatternEdit}
            className="px-2 py-0.5 rounded bg-accent-success text-white text-[10px] font-bold hover:opacity-80 transition-opacity"
            title="Jetzt wechseln – sofortiger Pattern-Tausch"
          >
            ✓ Commit
          </button>
          {/* Commit: quantisiert (nächste Bar) */}
          <button
            onClick={dm.scheduleCommit}
            className={[
              "px-2 py-0.5 rounded text-[10px] font-bold transition-colors border",
              dm.commitPending
                ? "bg-accent-primary text-white border-accent-primary animate-pulse"
                : "border-accent-primary text-accent-primary hover:bg-accent-primary/20",
            ].join(" ")}
            title="Beim nächsten Bar-Anfang wechseln (quantisiert)"
          >
            {dm.commitPending ? "⏳ nächste Bar…" : "⏱ nächste Bar"}
          </button>
          {/* Abbrechen */}
          <button
            onClick={dm.cancelLivePatternEdit}
            className="px-2 py-0.5 rounded bg-bg-elevated text-text-muted text-[10px] hover:text-accent-danger transition-colors"
            title="Live-Edit abbrechen – Draft verwerfen"
          >
            ✕ Verwerfen
          </button>
        </div>
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-panel border-b border-border-color flex-wrap">

        {/* Pattern-Auswahl */}
        <div className="relative">
          <button
            onClick={() => setShowPatternMenu(prev => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-elevated hover:bg-bg-elevated rounded text-xs font-medium transition-colors"
          >
            <span>{pattern.name}</span>
            <span className="text-text-dim">▾</span>
          </button>
          {showPatternMenu && (
            <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-color rounded-lg shadow-xl z-50 min-w-[220px]">
              {isLiveEditing && (
                <div className="px-3 py-1.5 border-b border-border-color text-[10px] text-text-dim">
                  Live-Edit aktiv: nur der Draft ist bearbeitbar
                </div>
              )}
              {dm.patterns.map((p, idx) => (
                <PatternRow
                  key={p.id}
                  pattern={p}
                  patternIndex={idx}
                  isActive={p.id === dm.activePatternId}
                  isPlaying={p.id === dm.playbackPatternId}
                  isLiveEditing={isLiveEditing}
                  showDelete={dm.patterns.length > 1}
                  hasPrevPattern={idx > 0}
                  prevPatternId={idx > 0 ? dm.patterns[idx - 1].id : null}
                  allPatterns={dm.patterns.map(pp => ({ id: pp.id, name: pp.name }))}
                  onSelect={() => { dm.setActivePattern(p.id); setShowPatternMenu(false); }}
                  onDuplicate={() => dm.duplicatePattern(p.id)}
                  onRemove={() => {
                    // v3.65.0: Pre-Action AutoBackup vor Delete-Pattern.
                    void getRegisteredAutoBackup()(`Delete Pattern: ${p.name}`).finally(() => {
                      dm.removePattern(p.id);
                    });
                  }}
                  onCopySamplesFrom={(srcId, srcName) => {
                    dm.copySamplesFromPattern(srcId, p.id);
                    toast(`Sampler aus „${srcName}" in „${p.name}" übernommen`, { kind: "success" });
                  }}
                  onReorder={(from, to) => {
                    dm.reorderPatterns(from, to);
                    toast(`Pattern „${dm.patterns[from]?.name ?? "?"}" verschoben`, { kind: "info", duration: 2000 });
                  }}
                  onExportImage={() => {
                    // v3.66.0: Snapshot des Patterns für den Export-Modal.
                    setPatternImageExport({
                      id: p.id,
                      name: p.name,
                      stepCount: p.stepCount,
                      bpm: p.bpm,
                      parts: p.parts.map(pp => ({
                        id: pp.id,
                        name: pp.name,
                        steps: pp.steps,
                      })),
                    });
                    setShowPatternMenu(false);
                  }}
                  onCompare={() => {
                    // v3.91.0: Compare-Modal mit diesem Pattern als Slot A öffnen.
                    setCompareModalAId(p.id);
                    setShowPatternMenu(false);
                  }}
                />
              ))}
              {/* Follow Action für aktives Pattern */}
              <div className="border-t border-border-color px-2 py-2">
                <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide">Follow Action</div>
                <div className="flex gap-1 flex-wrap mb-1">
                  {(["none", "next", "prev", "random"] as const).map(type => {
                    const current = pattern.followAction?.type ?? "none";
                    return (
                      <button key={type}
                        onClick={() => dm.setPatternFollowAction(pattern.id,
                          type === "none" ? undefined : { type, barsBeforeSwitch: pattern.followAction?.barsBeforeSwitch ?? 1 }
                        )}
                        className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${current === type ? "bg-accent-secondary/30 text-accent-secondary" : "bg-bg-elevated text-text-dim hover:text-text-primary"}`}>
                        {type}
                      </button>
                    );
                  })}
                </div>
                {(pattern.followAction?.type ?? "none") !== "none" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-text-dim">nach</span>
                    <input type="number" min={1} max={16}
                      value={pattern.followAction?.barsBeforeSwitch ?? 1}
                      onChange={e => dm.setPatternFollowAction(pattern.id, {
                        ...pattern.followAction!,
                        barsBeforeSwitch: Math.max(1, Math.min(16, Number(e.target.value))),
                      })}
                      className="w-10 bg-bg-elevated text-text-primary text-[10px] px-1 py-0.5 rounded border border-border-color" />
                    <span className="text-[10px] text-text-dim">Bars</span>
                  </div>
                )}
              </div>
              {/* Pattern Stacking */}
              <div className="border-t border-border-color px-2 py-2">
                <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide flex items-center gap-2">
                  Stacking
                  {dm.stackedPatternIds.length > 0 && (
                    <button onClick={() => dm.clearStackedPatterns()}
                      className="text-[9px] text-accent-danger hover:opacity-80">Alle löschen</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {dm.patterns.filter(p => p.id !== pattern.id).map(p => {
                    const isStacked = dm.stackedPatternIds.includes(p.id);
                    return (
                      <button key={p.id} onClick={() => dm.toggleStackedPattern(p.id)}
                        className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${isStacked ? "border-accent-secondary text-accent-secondary bg-accent-secondary/10" : "border-border-color text-text-dim hover:text-text-primary"}`}
                        title={isStacked ? "Stack entfernen" : "Pattern zum Stack hinzufügen"}>
                        {isStacked ? "✓ " : ""}{p.name}
                      </button>
                    );
                  })}
                  {dm.patterns.length <= 1 && <span className="text-[9px] text-text-dim">Weitere Patterns erstellen</span>}
                </div>
              </div>

              {/* BPM-Sync */}
              <div className="border-t border-border-color px-2 py-2">
                <div className="text-[10px] text-text-dim mb-1.5 uppercase tracking-wide">BPM-Sync</div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[10px] text-text-dim">Ratio:</span>
                  {[["½", 0.5], ["¾", 0.75], ["1×", 1], ["1½", 1.5], ["2×", 2]].map(([label, ratio]) => (
                    <button key={String(ratio)}
                      onClick={() => dm.setPatternBpmRatio(pattern.id, ratio === 1 ? null : Number(ratio))}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        (pattern.bpmRatio ?? 1) === ratio
                          ? "bg-accent-primary/30 text-accent-primary" : "bg-bg-elevated text-text-dim hover:text-text-primary"
                      }`}>
                      {label}
                    </button>
                  ))}
                  <span className="text-[10px] text-accent-secondary ml-1 font-mono">
                    {pattern.bpmRatio ? `→ ${Math.round(effectiveBpm * pattern.bpmRatio)} BPM` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-text-dim">Transition:</span>
                  <input type="number" min={0} max={16}
                    value={pattern.bpmTransitionBars ?? 0}
                    onChange={e => dm.setPatternBpmTransitionBars(pattern.id, Number(e.target.value))}
                    className="w-10 bg-bg-elevated text-text-primary text-[10px] px-1 py-0.5 rounded border border-border-color" />
                  <span className="text-[10px] text-text-dim">Bars (0 = sofort)</span>
                </div>
              </div>

              {!isLiveEditing && (
                <div className="border-t border-border-color p-1">
                  <button
                    onClick={() => { dm.addPattern(); setShowPatternMenu(false); }}
                    className="w-full text-left px-2 py-1 text-xs text-text-dim hover:text-text-primary hover:bg-bg-panel rounded"
                  >
                    + Neues Pattern
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step-Auflösung (Pattern-Global) */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-dim">Auflösung:</span>
          {(["1/8", "1/16", "1/32"] as StepResolution[]).map(res => (
            <button
              key={res}
              onClick={() => dm.setPatternStepResolution(pattern.id, res)}
              className={[
                "px-2 py-0.5 rounded text-[10px] font-mono transition-colors",
                pattern.stepResolution === res
                  ? "bg-accent-primary/70 text-white"
                  : "bg-bg-elevated text-text-muted hover:bg-bg-elevated",
              ].join(" ")}
            >
              {res}
            </button>
          ))}
        </div>

        {/* Step-Count (v3.39: 64 für KORG-Parität — ESX-1 + E2 Sampler max) */}
        <div className="flex items-center gap-1" data-testid="dm-step-count-toggle">
          {([16, 32, 64] as const).map(n => (
            <button
              key={n}
              onClick={() => dm.setStepCount(n)}
              data-testid={`dm-step-count-${n}`}
              title={n === 64 ? "64 Steps (KORG ESX-1 / E2 Max)" : `${n} Steps`}
              className={[
                "px-2 py-0.5 rounded text-[10px] font-mono transition-colors",
                pattern.stepCount === n
                  ? "bg-bg-elevated text-white"
                  : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
              ].join(" ")}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Pattern-BPM-Sync */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-dim">BPM:</span>
          <button
            onClick={() => dm.setPatternBpm(pattern.id, pattern.bpm === null ? bpm : null)}
            title={pattern.bpm === null ? "Eigenes BPM setzen" : "Globales BPM verwenden"}
            className={[
              "px-2 py-0.5 rounded text-[9px] transition-colors",
              pattern.bpm !== null ? "bg-accent-secondary text-bg-base" : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
            ].join(" ")}
          >
            {pattern.bpm !== null ? "Eigenes" : "Global"}
          </button>
          {pattern.bpm !== null && (
            <input
              type="number" min={20} max={300}
              value={pattern.bpm}
              onChange={e => dm.setPatternBpm(pattern.id, parseInt(e.target.value) || bpm)}
              className="w-14 bg-bg-elevated text-text-primary text-xs rounded px-1.5 py-0.5 border border-border-color text-center"
            />
          )}
        </div>

        {/* Velocity / Pitch Mode */}
        <button
          onClick={() => dm.setVelocityMode(!dm.velocityMode)}
          className={[
            "px-2 py-1 rounded text-[10px] font-medium transition-colors",
            dm.velocityMode ? "bg-accent-secondary text-bg-base" : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
          ].join(" ")}
          title="Velocity-Modus"
        >VEL</button>

        {/* Velocity Ramp Presets — nur im VEL-Modus sichtbar */}
        {dm.velocityMode && dm.activePartId && (
          <>
            {([
              { label: "↑",  fn: (i: number, n: number) => Math.round(40 + (i / (n - 1)) * 87) },
              { label: "↓",  fn: (i: number, n: number) => Math.round(127 - (i / (n - 1)) * 87) },
              { label: "∩",  fn: (i: number, n: number) => Math.round(40 + Math.sin(Math.PI * i / (n - 1)) * 87) },
              { label: "∿",  fn: (i: number, n: number) => Math.round(64 + Math.sin(2 * Math.PI * i / n) * 63) },
              { label: "R",  fn: () => Math.round(40 + Math.random() * 87) },
            ] as const).map(({ label, fn }) => (
              <button key={label}
                onClick={() => {
                  const part = pattern.parts.find(p => p.id === dm.activePartId);
                  if (!part) return;
                  const n = pattern.stepCount;
                  part.steps.forEach((step, i) => {
                    if (step.active) dm.setStepVelocity(dm.activePartId!, i, fn(i, n));
                  });
                }}
                className="px-1.5 py-0.5 rounded text-[10px] bg-accent-secondary/20 text-accent-secondary hover:bg-accent-secondary/40 transition-colors font-mono"
                title={`Velocity-Ramp: ${label}`}
              >{label}</button>
            ))}
            <span className="text-[10px] text-text-dim">Kurve</span>
          </>
        )}

        <button
          onClick={() => dm.setPitchMode(!dm.pitchMode)}
          className={[
            "px-2 py-1 rounded text-[10px] font-medium transition-colors",
            dm.pitchMode ? "bg-accent-secondary text-bg-base" : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
          ].join(" ")}
          title="Pitch-Modus (Rechtsklick auf Step)"
        >PITCH</button>

        {/* Quantize */}
        {dm.activePartId && (
          <div className="flex items-center gap-0.5">
            <span className="text-[9px] text-text-dim">Q:</span>
            {(["1/8", "1/16", "1/32"] as const).map(grid => (
              <button key={grid}
                onClick={() => dm.quantizePartSteps(dm.activePartId!, grid, 1.0)}
                className="px-1.5 py-0.5 text-[9px] rounded bg-bg-elevated text-text-dim hover:bg-accent-primary/20 hover:text-accent-primary border border-border-color transition-colors font-mono"
                title={`Quantize auf ${grid} (100% Stärke)`}
              >{grid}</button>
            ))}
          </div>
        )}

        {/* Metronom */}
        <div ref={metronomPanelRef} className="relative">
          <div className="flex items-center gap-0.5 px-1.5 py-1 rounded bg-bg-panel border border-border-color">
            <button
              onClick={() => setMetronomOn(prev => !prev)}
              className={[
                "px-2 py-0.5 rounded text-[10px] transition-colors",
                metronomOn ? "bg-bg-elevated text-white" : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
              ].join(" ")}
              title={metronomOn ? "Metronom aus" : "Metronom ein"}
            >♩</button>
            <button
              onClick={() => setShowMetronomPanel(prev => !prev)}
              className={[
                "px-1.5 py-0.5 rounded text-[10px] transition-colors",
                showMetronomPanel ? "bg-bg-elevated text-white" : "text-text-dim hover:text-text-primary",
              ].join(" ")}
              title="Metronom-Einstellungen"
            >⚙</button>
          </div>

          {showMetronomPanel && (
            <div className="absolute top-full right-0 z-50 mt-1 p-3 bg-bg-elevated border border-border-color rounded-lg shadow-xl w-64">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-text-primary">Metronom</span>
                <button onClick={() => setShowMetronomPanel(false)} className="text-text-dim hover:text-white text-sm leading-none">✕</button>
              </div>

              {/* Schieberegler */}
              <div className="space-y-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-16 shrink-0">Lautstärke</span>
                  <input type="range" min={0} max={1} step={0.01} value={metronomGain}
                    onChange={e => setMetronomGain(parseFloat(e.target.value))}
                    className="flex-1 accent-accent-primary cursor-pointer" />
                  <span className="text-[10px] text-text-dim w-8 text-right">{Math.round(metronomGain * 100)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-16 shrink-0">Akzent</span>
                  <input type="range" min={0.2} max={2} step={0.01} value={metronomAccent}
                    onChange={e => setMetronomAccent(parseFloat(e.target.value))}
                    className="flex-1 accent-accent-primary cursor-pointer" />
                  <span className="text-[10px] text-text-dim w-8 text-right">{metronomAccent.toFixed(1)}×</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted w-16 shrink-0">Tonhöhe</span>
                  <input type="range" min={0} max={1} step={0.01} value={metronomTone}
                    onChange={e => setMetronomTone(parseFloat(e.target.value))}
                    className="flex-1 accent-accent-secondary cursor-pointer" />
                  <span className="text-[10px] text-text-dim w-8 text-right">{Math.round(metronomTone * 100)}%</span>
                </div>
              </div>

              <div className="border-t border-border-color my-2" />

              {/* Schläge / Takt */}
              <div className="mb-2">
                <span className="text-[10px] text-text-dim block mb-1">Schläge / Takt</span>
                <div className="flex gap-1">
                  {([2, 3, 4, 5, 6, 7] as const).map(n => (
                    <button key={n} onClick={() => setMetronomBeatsPerBar(n)}
                      className={[
                        "flex-1 py-0.5 rounded text-[10px] font-mono transition-colors",
                        metronomBeatsPerBar === n
                          ? "bg-accent-primary/70 text-white"
                          : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
                      ].join(" ")}>{n}</button>
                  ))}
                </div>
              </div>

              {/* Unterteilung */}
              <div className="mb-2">
                <span className="text-[10px] text-text-dim block mb-1">Unterteilung</span>
                <div className="flex gap-1">
                  {(["beat", "eighth", "sixteenth"] as const).map(sub => (
                    <button key={sub} onClick={() => setMetronomSubdivision(sub)}
                      className={[
                        "flex-1 py-0.5 rounded text-[10px] transition-colors",
                        metronomSubdivision === sub
                          ? "bg-accent-primary/70 text-white"
                          : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
                      ].join(" ")}>
                      {sub === "beat" ? "1/4" : sub === "eighth" ? "1/8" : "1/16"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Klangtyp */}
              <div>
                <span className="text-[10px] text-text-dim block mb-1">Klangtyp</span>
                <div className="flex gap-1">
                  {(["sine", "square", "triangle"] as const).map(type => (
                    <button key={type} onClick={() => setMetronomOscType(type)}
                      className={[
                        "flex-1 py-0.5 rounded text-[10px] transition-colors",
                        metronomOscType === type
                          ? "bg-accent-secondary text-bg-base"
                          : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
                      ].join(" ")}>
                      {type === "sine" ? "Sinus" : type === "square" ? "Rechteck" : "Dreieck"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Master */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-dim">Master</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={e => setMasterVolume(parseFloat(e.target.value))}
            title={`Master-Lautstärke: ${Math.round(masterVolume * 100)}%`}
            className="w-16 accent-accent-primary cursor-pointer"
          />
        </div>

        {/* Clear */}
        <button
          onClick={() => {
            // v3.65.0: Pre-Action AutoBackup vor Clear-Pattern.
            void getRegisteredAutoBackup()("Clear Pattern").finally(() => {
              dm.clearPattern();
            });
          }}
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-accent-danger/30 hover:text-accent-danger transition-colors"
          title="Pattern leeren"
        >CLR</button>

        {/* Undo/Redo */}
        <button onClick={dm.undo} disabled={!dm.canUndo}
          className="w-6 h-6 rounded text-xs bg-bg-elevated text-text-dim hover:bg-bg-elevated disabled:opacity-30 transition-colors"
          title="Rückgängig (Ctrl+Z)">↩</button>
        <button onClick={dm.redo} disabled={!dm.canRedo}
          className="w-6 h-6 rounded text-xs bg-bg-elevated text-text-dim hover:bg-bg-elevated disabled:opacity-30 transition-colors"
          title="Wiederholen (Ctrl+Y)">↪</button>

        {/* Play/Stop — v1.86: right-click für MIDI-Learn */}
        <button
          onClick={onPlayStop}
          onContextMenu={playStopLearn.onContextMenu}
          title={`${isPlaying ? "Stop" : "Play"} (Space) · Rechtsklick: MIDI-Learn${playStopLearn.isMapped ? ` · CC${playStopLearn.mappedCC}` : ""}`}
          className={[
            "relative w-8 h-8 rounded flex items-center justify-center text-sm font-bold transition-colors",
            isPlaying
              ? "bg-accent-danger hover:bg-accent-danger/80 text-bg-base"
              : "bg-accent-primary hover:bg-accent-primary text-bg-base",
          ].join(" ")}
        >
          {isPlaying ? "■" : "▶"}
          {playStopLearn.isMapped && (
            <span className="absolute -top-1 -right-1 text-[8px] font-mono bg-accent-secondary text-bg-base px-0.5 rounded leading-tight">CC{playStopLearn.mappedCC}</span>
          )}
        </button>
        {playStopLearn.menu}

        {/* BPM — v1.86: right-click für MIDI-Learn; v3.38: disabled-State im Sync-Mode */}
        <div
          className={`flex items-center gap-1 relative ${bpmLocked ? "opacity-50" : ""}`}
          onContextMenu={bpmLearn.onContextMenu}
          data-testid="dm-bpm-control"
          data-bpm-locked={bpmLocked ? "true" : "false"}
          title={bpmLocked ? "BPM extern gesynced — Slider gesperrt" : undefined}
        >
          {bpmLocked && (
            <span
              data-testid="dm-bpm-lock-icon"
              className="text-[10px] text-accent-secondary mr-0.5 select-none"
              aria-hidden="true"
              title="BPM extern gesynced — Slider gesperrt"
            >🔒</span>
          )}
          <button
            onClick={() => onBpmChange(Math.max(20, bpm - 1))}
            disabled={bpmLocked}
            title={bpmLocked ? "BPM extern gesynced — Slider gesperrt" : "BPM −1 (Taste: −)"}
            aria-label="BPM verringern"
            className="w-5 h-6 rounded text-xs bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary active:scale-95 transition-colors disabled:cursor-not-allowed disabled:hover:bg-bg-elevated disabled:hover:text-text-muted"
          >−</button>
          <input
            ref={bpmInputRef}
            type="number" min={20} max={300}
            value={bpmInput}
            onChange={e => setBpmInput(e.target.value)}
            onBlur={() => {
              if (bpmLocked) {
                setBpmInput(String(bpm));
                return;
              }
              const v = parseInt(bpmInput);
              if (!isNaN(v)) onBpmChange(Math.max(20, Math.min(300, v)));
              else setBpmInput(String(bpm));
            }}
            onKeyDown={e => {
              if (e.key === "Enter") bpmInputRef.current?.blur();
            }}
            disabled={bpmLocked}
            readOnly={bpmLocked}
            title={bpmLocked ? "BPM extern gesynced — Slider gesperrt" : "BPM (Doppelklick zum Bearbeiten, Tasten + und − für ±1)"}
            data-testid="dm-bpm-input"
            className="w-14 bg-bg-elevated text-text-primary text-xs rounded px-1.5 py-1 border border-border-color text-center disabled:cursor-not-allowed"
          />
          <button
            onClick={() => onBpmChange(Math.min(300, bpm + 1))}
            disabled={bpmLocked}
            title={bpmLocked ? "BPM extern gesynced — Slider gesperrt" : "BPM +1 (Taste: +)"}
            aria-label="BPM erhöhen"
            className="w-5 h-6 rounded text-xs bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary active:scale-95 transition-colors disabled:cursor-not-allowed disabled:hover:bg-bg-elevated disabled:hover:text-text-muted"
          >+</button>
          {bpmLearn.isMapped && (
            <span className="text-[8px] font-mono bg-accent-secondary text-bg-base px-1 rounded leading-tight">CC{bpmLearn.mappedCC}</span>
          )}
        </div>
        {bpmLearn.menu}

        {/* MIDI-Import */}
        <button
          onClick={() => midiImportRef.current?.click()}
          title="MIDI-Datei importieren"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary transition-colors"
        >
          ♪ MIDI
        </button>
        <input
          ref={midiImportRef}
          type="file"
          accept=".mid,.midi"
          className="hidden"
          onChange={handleMidiImport}
        />

        {/* FLP-Import (FL-Studio Pattern-Extraktion) */}
        <button
          onClick={() => flpImportRef.current?.click()}
          title="FL-Studio Projekt importieren (erstes Pattern)"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary transition-colors"
          data-testid="flp-import"
        >
          🎛 FLP
        </button>
        <input
          ref={flpImportRef}
          type="file"
          accept=".flp"
          className="hidden"
          onChange={handleFlpImport}
        />

        {/* KORG Electribe Pattern-Import (TASK-237) */}
        <button
          onClick={() => electribeImportRef.current?.click()}
          title="KORG Electribe Pattern importieren (.e2pattern, .e2spat oder .e2sallpat — Multi-Pattern-Bank mit 250 Slots)"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary transition-colors inline-flex items-center gap-1"
          data-testid="electribe-import"
        >
          🎚 Electribe
          <ProLockBadge feature={PRO_FEATURE_ELECTRIBE_IMPORT} />
        </button>
        <input
          ref={electribeImportRef}
          type="file"
          accept=".e2pattern,.e2sallpat,.e2spat"
          className="hidden"
          onChange={handleElectribeImport}
          data-testid="electribe-import-input"
        />

        {/* KORG Sample-Bank-Import (v3.3.0) — ESX-1 .esx + E2S .all (Read-Only). */}
        <button
          onClick={() => korgBankImportRef.current?.click()}
          title="KORG Sample-Bank importieren (.esx ESX-1 oder .all E2S)"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary transition-colors inline-flex items-center gap-1"
          data-testid="korg-bank-import"
        >
          📦 KORG Bank
          <ProLockBadge feature={PRO_FEATURE_KORG_BANK_IMPORT} />
        </button>
        <input
          ref={korgBankImportRef}
          type="file"
          accept=".esx,.ess,.all"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              if (!requireProFeature(PRO_FEATURE_KORG_BANK_IMPORT)) {
                e.target.value = "";
                return;
              }
              try {
                window.dispatchEvent(new CustomEvent<File>("korg:bank:open", { detail: file }));
              } catch {
                /* test-env without CustomEvent */
              }
            }
            e.target.value = "";
          }}
          data-testid="korg-bank-import-input"
        />

        {/* KORG E2 Sampler EXPORT (v3.4.0) — Synthstudio → .all */}
        <button
          onClick={() => {
            if (!requireProFeature(PRO_FEATURE_KORG_BANK_WRITE)) return;
            try {
              window.dispatchEvent(new CustomEvent("korg:bank:export-open"));
            } catch {
              /* test-env without CustomEvent */
            }
          }}
          title="Sample-Bank für KORG Electribe 2 Sampler exportieren (.all)"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary transition-colors inline-flex items-center gap-1"
          data-testid="korg-bank-export"
        >
          📤 KORG Export
          <ProLockBadge feature={PRO_FEATURE_KORG_BANK_WRITE} />
        </button>

        {/* KORG E2 Pattern EXPORT (v3.26.0) — Synthstudio-Pattern → .e2spat */}
        <button
          onClick={async () => {
            if (!requireProFeature(PRO_FEATURE_E2_PATTERN_EXPORT)) return;
            const currentPattern = dm.getActivePattern();
            if (!currentPattern) {
              toast("Kein Pattern aktiv", { kind: "warning" });
              return;
            }
            try {
              const e2Input = convertSynthstudioPatternToE2(currentPattern, { globalBpm: bpm });
              const buffer = buildE2PatternFile(e2Input);
              // Sanitize name for filename — only ASCII alnum + _ - .
              const safeName = (currentPattern.name || "pattern")
                .replace(/[^A-Za-z0-9._-]+/g, "_")
                .slice(0, 60) || "pattern";
              const filename = `${safeName}.e2spat`;

              if (electron.isElectron) {
                const result = await electron.saveE2Pattern(filename, buffer);
                if (result.success) {
                  toast(`E2 Pattern gespeichert: ${result.filePath}`, { kind: "success" });
                } else if (result.error && result.error !== "canceled") {
                  toast(`Speichern fehlgeschlagen: ${result.error}`, { kind: "error" });
                }
              } else {
                // Browser-Fallback: Blob-Download
                const blob = new Blob([buffer], { type: "application/octet-stream" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast(`E2 Pattern heruntergeladen: ${filename}`, { kind: "success" });
              }
            } catch (err) {
              console.error("[E2 Pattern Export] error:", err);
              toast(`Export-Fehler: ${(err as Error)?.message ?? "unbekannt"}`, { kind: "error" });
            }
          }}
          title="Aktuelles Pattern für KORG Electribe 2 Sampler exportieren (.e2spat)"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary transition-colors inline-flex items-center gap-1"
          data-testid="e2-pattern-export"
        >
          📤 E2 Pattern
          <ProLockBadge feature={PRO_FEATURE_E2_PATTERN_EXPORT} />
        </button>

        {/* Sample-Slicing (TASK-238 / v2.89) */}
        <button
          onClick={() => sliceImportRef.current?.click()}
          title="Sample slicen / choppen (WAV/MP3/OGG → 16 Performance-Pads)"
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary transition-colors"
          data-testid="slice-sample"
        >
          ✂ Slice Sample
        </button>
        <input
          ref={sliceImportRef}
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.flac,.aiff,.m4a"
          className="hidden"
          onChange={handleSliceImport}
          data-testid="slice-sample-input"
        />

        {/* Pattern Morph */}
        <button
          onClick={() => setShowMorph(prev => !prev)}
          title="Pattern Morph"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showMorph
              ? "bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/50"
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary",
          ].join(" ")}
        >
          ⟷ Morph
        </button>

        {/* Envelope Follower Toggle */}
        <button
          onClick={() => setShowEnvFollower(prev => !prev)}
          title="Envelope Follower"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showEnvFollower
              ? "bg-accent-success/20 text-accent-success border border-accent-success/50"
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary",
          ].join(" ")}
        >
          ∿ EF
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-border-color mx-1" />

        {/* Transpose */}
        <TransposeControl />

        {/* Note Repeat Toggle */}
        <button
          onClick={() => setShowNoteRepeat(prev => !prev)}
          title="Note Repeat (MPC-Style)"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showNoteRepeat
              ? "bg-accent-primary/70 text-white"
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
          ].join(" ")}
        >
          🔁 NR
        </button>

        {/* Live-Looper Toggle (TASK-235 / v2.87) */}
        <button
          data-testid="toggle-looper-panel"
          onClick={() => setShowLooper(prev => !prev)}
          title="Live-Looper (RC-505 Style, 4 Loops)"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showLooper
              ? "bg-accent-success/20 text-accent-success border border-accent-success/50"
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary",
          ].join(" ")}
        >
          ⟲ Loop
        </button>

        {/* Kanal hinzufügen */}
        <button
          onClick={() => dm.addPart()}
          className="px-2 py-1 rounded text-[10px] bg-bg-elevated text-text-dim hover:bg-bg-elevated transition-colors"
          title="Kanal hinzufügen"
        >+ Kanal</button>

        {/* Makro-Panel */}
        <button
          data-testid="toggle-macro-panel"
          onClick={() => setShowMacros(prev => !prev)}
          title="Makro-Steuerung (8 Makros)"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showMacros
              ? "bg-accent-primary/20 text-accent-primary border border-accent-primary/40"
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary",
          ].join(" ")}
        >
          M1–8
        </button>

        {/* Polyrhythm Visualizer */}
        <button
          onClick={() => setShowPolyrhythm(prev => !prev)}
          title="Polyrhythm Visualizer"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showPolyrhythm
              ? "bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/40"
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary",
          ].join(" ")}
        >
          ⬡ Poly
        </button>

        {/* v2.0.0: Mix-Assistent — analysiert das Pattern und gibt Mix-Tipps */}
        <button
          onClick={() => setShowMixAssistant(prev => !prev)}
          title="Mix-Assistent (regelbasiert + optional KI-Analyse)"
          className={[
            "px-2 py-1 rounded text-[10px] font-bold transition-colors",
            showMixAssistant
              ? "bg-accent-success/20 text-accent-success border border-accent-success/40"
              : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary",
          ].join(" ")}
        >
          🧠 Mix
        </button>

        {/* Pattern Variations A/B/C/D */}
        <div className="flex items-center gap-0 bg-bg-base rounded border border-border-color" title="Pattern Variations — Variationen speichern & wechseln">
          {(["A","B","C","D"] as const).map((v, i) => {
            const isActive = activeVar === v && varSlots[v] !== null;
            const hasSaved = varSlots[v] !== null;
            const corners = i === 0 ? "rounded-l" : i === 3 ? "rounded-r" : "";
            return (
              <button key={v}
                onClick={() => {
                  if (!hasSaved) {
                    // Aktuelles Pattern in Slot klonen
                    // Klon des aktuellen Patterns erstellen
                    const cloneId = dm.patterns.length > 0
                      ? (() => { const id = dm.addPatternData({ ...pattern, name: `${pattern.name} [${v}]` }); return id; })()
                      : null;
                    if (cloneId) setVarSlots(prev => ({ ...prev, [v]: cloneId }));
                  } else {
                    const targetId = varSlots[v];
                    if (targetId) { dm.setActivePattern(targetId); setActiveVar(v); }
                  }
                }}
                className={[
                  `px-2 py-0.5 text-[10px] font-bold transition-colors ${corners}`,
                  isActive ? "bg-accent-primary text-white" :
                  hasSaved ? "bg-accent-primary/20 text-accent-primary" :
                  "text-text-dim hover:text-text-primary",
                ].join(" ")}
                title={hasSaved ? `Variation ${v} (gespeichert) — klick zum Wechseln` : `Variation ${v} — klick zum Erstellen`}
              >{v}</button>
            );
          })}
        </div>

        {/* Live Pattern Edit */}
        {!isLiveEditing ? (
          <button
            onClick={dm.startLivePatternEdit}
            className="px-2 py-1 rounded text-[10px] font-bold bg-accent-danger/10 text-accent-danger border border-accent-danger/40 hover:bg-accent-danger/20 transition-colors"
            title="Live-Edit: Pattern live bearbeiten während Playback weiterläuft"
          >
            ● Live Edit
          </button>
        ) : null}
      </div>

      {/* ── Makro-Panel ──────────────────────────────────────────────────── */}
      {/* v1.94: Title gesetzt für prominente Close-Button-Discoverability */}
      {showMacros && (
        <ResizableDrumPanel storageKey="ss-panel-macros" defaultHeight={160} minHeight={100} maxHeight={280}
          title="Makros (8 × bindbar)"
          onClose={() => setShowMacros(false)}>
          <MacroPanel parts={pattern.parts} />
        </ResizableDrumPanel>
      )}

      {/* ── Note Repeat Panel ────────────────────────────────────────────── */}
      {/* BUG-008 Reaffirmation: KEIN title= damit der Inner-Panel-Header
          (inkl. Status-Info wie BPM) der einzige sichtbare Header ist.
          Close-Button rendert dank onClose unabhängig vom title. */}
      {showNoteRepeat && (
        <ResizableDrumPanel storageKey="ss-panel-notrepeat" defaultHeight={110} minHeight={80} maxHeight={240}
          onClose={() => setShowNoteRepeat(false)}>
          <NoteRepeatPanel
            bpm={effectiveBpm}
            compact={true}
          />
        </ResizableDrumPanel>
      )}

      {/* ── Live-Looper Panel (TASK-235 / v2.87) ─────────────────────────── */}
      {showLooper && (
        <ResizableDrumPanel storageKey="ss-panel-looper" defaultHeight={180} minHeight={140} maxHeight={320}
          onClose={() => setShowLooper(false)}>
          <LooperPanel onClose={() => setShowLooper(false)} />
        </ResizableDrumPanel>
      )}

      {/* ── Pattern Morph Panel ──────────────────────────────────────────── */}
      {showMorph && (
        <ResizableDrumPanel storageKey="ss-panel-morph" defaultHeight={160} minHeight={100} maxHeight={320}
          onClose={() => setShowMorph(false)}>
          <PatternMorphPanel
            patterns={dm.patterns}
            onApplyMorph={(morphed) => {
              const id = dm.addPatternData(morphed);
              dm.setActivePattern(id);
              setShowMorph(false);
            }}
          />
        </ResizableDrumPanel>
      )}

      {/* ── Envelope Follower Panel ──────────────────────────────────────── */}
      {showEnvFollower && (
        <ResizableDrumPanel storageKey="ss-panel-envfollower" defaultHeight={180} minHeight={120} maxHeight={400}
          onClose={() => setShowEnvFollower(false)}>
          <EnvelopeFollowerPanel parts={pattern.parts} />
        </ResizableDrumPanel>
      )}

      {/* ── v3.40: 64-Step Page-Switcher ─────────────────────────────────── */}
      {(() => {
        const pageCount = getPageCount(pattern.stepCount);
        if (pageCount <= 1) return null;
        const liveStepPage = getPageForStep(dm.currentStep, pattern.stepCount);
        return (
          <div
            className="flex items-center gap-2 px-2 py-1 bg-bg-panel border-b border-border-color/50"
            data-testid="dm-page-switcher"
          >
            <span className="text-[10px] text-text-dim">Seite:</span>
            <div className="flex items-center gap-1">
              {Array.from({ length: pageCount }, (_, p) => {
                const isActive = currentPatternPage === p;
                const isLivePage = isPlaying && liveStepPage === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setCurrentPatternPage(p)}
                    data-testid={`dm-page-${p}`}
                    title={`Steps ${getPageRangeLabel(p, pattern.stepCount)} (Page ${p + 1}/${pageCount})`}
                    className={[
                      "px-2 py-0.5 rounded text-[10px] font-mono transition-colors relative",
                      isActive
                        ? "bg-accent-primary text-white"
                        : "bg-bg-elevated text-text-dim hover:bg-bg-elevated hover:text-text-primary",
                    ].join(" ")}
                  >
                    {getPageRangeLabel(p, pattern.stepCount)}
                    {isLivePage && !isActive && (
                      <span
                        className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
                        style={{ background: "var(--ss-accent-secondary)" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setAutoPageFollow(prev => !prev)}
              data-testid="dm-page-autofollow"
              title="Automatisch zur Page mit dem aktuellen Step springen während Playback"
              className={[
                "px-2 py-0.5 rounded text-[9px] font-mono transition-colors",
                autoPageFollow
                  ? "bg-accent-secondary/30 text-accent-secondary"
                  : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
              ].join(" ")}
            >
              {autoPageFollow ? "Auto-Follow: AN" : "Auto-Follow: AUS"}
            </button>
            <span className="text-[9px] text-text-dim ml-auto">
              {pattern.stepCount} Steps / {pageCount} Pages
            </span>
          </div>
        );
      })()}

      {/* ── Step-Grid Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-1 bg-bg-panel border-b border-border-color/50">
        {/* Platzhalter für Kanal-Steuerung */}
        <div className="w-[88px] flex-shrink-0" />
        <div className="w-5 flex-shrink-0" />
        <div className="w-5 flex-shrink-0" />
        <div className="w-12 flex-shrink-0" />
        <div className="w-10 flex-shrink-0" />
        <div className="w-14 flex-shrink-0" />
        <div className="w-6 flex-shrink-0" />

        {/* Step-Nummern (v3.40: paginiert wenn stepCount > 16) */}
        <div className="flex gap-[2px] flex-1 min-w-0">
          {(() => {
            const { start, end } = getPageStepRange(pattern.stepCount, currentPatternPage);
            return Array.from({ length: end - start }).map((_, idx) => {
              const i = start + idx;
              return (
                <div
                  key={i}
                  className={[
                    "flex-1 text-center text-[8px] leading-none py-0.5 relative",
                    stepGroupBorder(idx, end - start),
                    i === dm.currentStep ? "font-bold" : "text-text-dim",
                    i % 4 === 0 ? "text-text-dim" : "",
                  ].join(" ")}
                  style={{ color: i === dm.currentStep ? "var(--ss-accent-secondary)" : undefined }}
                >
                  {i % 4 === 0 ? i + 1 : "·"}
                  {i === dm.currentStep && (
                    <div className="absolute bottom-0 left-0 right-0 rounded-full"
                      style={{ height: 2, background: "var(--ss-accent-secondary)" }} />
                  )}
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* ── Kanal-Zeilen ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {(() => {
          // v3.40: visibleStepRange wird im Channel-Strip-Renderer benutzt
          // damit bei stepCount > 16 nur die aktuelle Page Cells rendert.
          const visibleStepRange = pattern.stepCount > 16
            ? getPageStepRange(pattern.stepCount, currentPatternPage)
            : null;
          return pattern.parts.map((part, partIndex) => (
          <ChannelStrip
            key={part.id}
            part={part}
            partIndex={partIndex}
            stepCount={pattern.stepCount}
            visibleStepRange={visibleStepRange}
            currentStep={dm.currentStep}
            isActive={dm.activePartId === part.id}
            velocityMode={dm.velocityMode}
            pitchMode={dm.pitchMode}
            patternResolution={pattern.stepResolution}
            fxPanelOpen={dm.fxPanelPartId === part.id}
            samples={samples}
            onToggleStep={stepIndex => dm.toggleStep(part.id, stepIndex)}
            onSetVelocity={(stepIndex, v) => dm.setStepVelocity(part.id, stepIndex, v)}
            onSetPitch={(stepIndex, p) => dm.setStepPitch(part.id, stepIndex, p)}
            onMute={() => dm.setPartMuted(part.id, !part.muted)}
            onSolo={(e) => dm.setPartSoloed(part.id, !part.soloed, !e.shiftKey)}
            onVolumeChange={v => dm.setPartVolume(part.id, v)}
            onPanChange={v => dm.setPartPan(part.id, v)}
            onSampleDrop={(url, name) => dm.setPartSample(part.id, url, name)}
            onFxChange={fx => {
              dm.setPartFx(part.id, fx);
              const updatedPart = { ...part, fx: { ...part.fx, ...fx } };
              AudioEngine.updateChannelFx(part.id, updatedPart.fx);
            }}
            onFxToggle={() => dm.setFxPanelPartId(dm.fxPanelPartId === part.id ? null : part.id)}
            onResolutionChange={res => dm.setPartStepResolution(part.id, res)}
            onClick={() => dm.setActivePart(part.id)}
            onPianoRollOpen={() => setPianoRollPartId(part.id)}
            onStepSelect={stepIndex => setSelectedStep({ partId: part.id, stepIndex })}
            selectedStepIndex={selectedStep?.partId === part.id ? selectedStep.stepIndex : null}
            onGranularOpen={() => setGranularPartId(prev => prev === part.id ? null : part.id)}
            onSourceTypeChange={type => dm.setPartSourceType(part.id, type)}
            onColorChange={color => dm.setPartColor(part.id, color)}
          />
          ));
        })()}
      </div>

      {/* ── Step Inspector ───────────────────────────────────────────────── */}
      {selectedStep && (() => {
        const insPart = pattern.parts.find(p => p.id === selectedStep.partId);
        if (!insPart) return null;
        return (
          <StepInspector
            partName={insPart.name}
            stepIndex={selectedStep.stepIndex}
            step={insPart.steps[selectedStep.stepIndex]}
            onSetVelocity={v  => dm.setStepVelocity(insPart.id, selectedStep.stepIndex, v)}
            onSetPitch={p     => dm.setStepPitch(insPart.id, selectedStep.stepIndex, p)}
            onSetProbability={p => dm.setStepProbability(insPart.id, selectedStep.stepIndex, p)}
            onSetSlide={s     => dm.setStepSlide(insPart.id, selectedStep.stepIndex, s)}
            onSetCondition={c   => dm.setStepCondition(insPart.id, selectedStep.stepIndex, c)}
            onSetReverse={r     => dm.setStepReverse(insPart.id, selectedStep.stepIndex, r)}
            onSetParamLock={lock => dm.setStepParamLock(insPart.id, selectedStep.stepIndex, lock)}
            onSetLength={len      => dm.setStepLength(insPart.id, selectedStep.stepIndex, len)}
            onSetChainNext={chain => dm.setStepChainNext(insPart.id, selectedStep.stepIndex, chain)}
            onToggle={() => dm.toggleStep(insPart.id, selectedStep.stepIndex)}
            onClose={() => setSelectedStep(null)}
          />
        );
      })()}

      {/* ── Mix-Assistent (v2.0.0) ──────────────────────────────────────── */}
      {showMixAssistant && (() => {
        const mixInput: MixAnalysisInput = {
          bpm,
          parts: pattern.parts.map(p => ({
            id: p.id,
            name: p.name,
            volume: Math.round((p.volume ?? 0.8) * 127),
            pan: Math.round((p.pan ?? 0) * 100),
            activeSteps: p.steps.filter(s => s.active).length,
            totalSteps: p.steps.length,
            filterCutoff: p.fx.filterEnabled ? p.fx.filterFreq : undefined,
            trackType: p.name.toLowerCase(),
          })),
          masterVolume: 100,
        };
        const handleApply = (rec: MixRecommendation) => {
          if (!rec.partId || rec.suggestedValue === undefined) return;
          if (rec.targetProperty === "volume") {
            dm.setPartVolume(rec.partId, Math.max(0, Math.min(1, rec.suggestedValue / 127)));
          } else if (rec.targetProperty === "pan") {
            dm.setPartPan(rec.partId, Math.max(-1, Math.min(1, rec.suggestedValue / 100)));
          } else if (rec.targetProperty === "filterCutoff") {
            dm.setPartFx(rec.partId, { filterEnabled: true, filterFreq: rec.suggestedValue });
          }
        };
        return (
          <ResizableDrumPanel storageKey="ss-panel-mix-assistant" defaultHeight={360} minHeight={200} maxHeight={620}
            title="🧠 Mix-Assistent"
            onClose={() => setShowMixAssistant(false)}>
            <MixAssistantPanel
              input={mixInput}
              onApply={handleApply}
              onClose={() => setShowMixAssistant(false)}
            />
          </ResizableDrumPanel>
        );
      })()}

      {/* ── Granular Synth Panel ─────────────────────────────────────────── */}
      {granularPartId && (() => {
        const grPart = pattern.parts.find(p => p.id === granularPartId);
        if (!grPart) return null;
        // v3.17: Part-Index 0..15 fuer OmniTribe-NRPN herausfinden.
        const grPartIndex = pattern.parts.findIndex(p => p.id === granularPartId);
        return (
          // v1.94: title gesetzt damit der Header (mit Close-Button) prominent ist.
          // User-Feedback aus neue_todos.md: 'alle fenster sollen mit X zumachbar
          // sein, granular und polyrhythm' — der X war zwar da, aber bei title=undefined
          // ohne Beschriftung schwer auffindbar.
          <ResizableDrumPanel storageKey="ss-panel-granular" defaultHeight={320} minHeight={200} maxHeight={520}
            title={`Granular: ${grPart.name}`}
            onClose={() => setGranularPartId(null)}>
            <GranularSynthPanel
              partId={grPart.id}
              partIndex={grPartIndex >= 0 ? grPartIndex : 0}
              sampleUrl={grPart.sampleUrl}
              params={{ ...DEFAULT_GRANULAR_PARAMS, ...grPart.granularParams }}
              onChange={params => dm.setPartGranularParams(grPart.id, params)}
            />
          </ResizableDrumPanel>
        );
      })()}

      {/* ── Polyrhythm Visualizer ────────────────────────────────────────── */}
      {showPolyrhythm && (
        <ResizableDrumPanel storageKey="ss-panel-polyrhythm" defaultHeight={180} minHeight={100} maxHeight={380}
          title="Polyrhythm-Visualizer"
          onClose={() => setShowPolyrhythm(false)}>
          <PolyrhythmVisualizer pattern={pattern} currentStep={dm.currentStep} />
        </ResizableDrumPanel>
      )}

      {/* ── Status-Leiste ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-1 bg-bg-panel border-t border-border-color text-[9px] text-text-dim">
        <span>{pattern.parts.length} Kanäle</span>
        <span>·</span>
        <span>{pattern.stepCount} Steps</span>
        <span>·</span>
        <span>{pattern.stepResolution}</span>
        <span>·</span>
        <span>{effectiveBpm} BPM{pattern.bpm !== null ? " (eigenes)" : ""}</span>
        <span>·</span>
        <span>Step {dm.currentStep + 1}/{pattern.stepCount}</span>
        {dm.velocityMode && <><span>·</span><span className="text-accent-secondary">VELOCITY-MODUS</span></>}
        {dm.pitchMode && <><span>·</span><span className="text-accent-secondary">PITCH-MODUS</span></>}
        {/* Time-Stretch für aktiven Kanal */}
        {dm.activePartId && (() => {
          const activePart = pattern.parts.find(p => p.id === dm.activePartId);
          if (!activePart) return null;
          const stretch = activePart.stretchRatio ?? 1;
          return (
            <>
              <span>·</span>
              <span>Stretch:</span>
              <input type="range" min={0.25} max={4} step={0.05} value={stretch}
                onChange={e => dm.setPartStretchRatio(dm.activePartId!, Number(e.target.value))}
                className="w-16 accent-accent-primary cursor-pointer"
                title={`Time-Stretch: ${stretch.toFixed(2)}× (${stretch >= 1 ? `+${((stretch-1)*100).toFixed(0)}%` : `${((1-stretch)*100).toFixed(0)}% kürzer`})`}
              />
              <button onClick={() => dm.setPartStretchRatio(dm.activePartId!, 1)}
                className="hover:text-accent-danger transition-colors">
                {stretch !== 1 ? `${stretch.toFixed(2)}× ×` : "1×"}
              </button>
              {/* Micro-Timing */}
              <span>·</span>
              <span title="Micro-Timing (ms vor/hinter dem Beat)">μT:</span>
              <input type="range" min={-50} max={50} step={1}
                value={activePart.microTiming ?? 0}
                onChange={e => dm.setPartMicroTiming(dm.activePartId!, Number(e.target.value))}
                className="w-14 accent-accent-secondary cursor-pointer"
                title={`Micro-Timing: ${activePart.microTiming ?? 0}ms`}
              />
              {(activePart.microTiming ?? 0) !== 0 && (
                <button onClick={() => dm.setPartMicroTiming(dm.activePartId!, 0)}
                  className="hover:text-accent-danger transition-colors text-accent-secondary">
                  {(activePart.microTiming ?? 0) > 0 ? '+' : ''}{activePart.microTiming}ms ×
                </button>
              )}
            </>
          );
        })()}
      </div>

      {/* ── Piano Roll Modal ─────────────────────────────────────────────── */}
      {pianoRollPartId && (() => {
        const prPart = pattern.parts.find(p => p.id === pianoRollPartId);
        return (
          <PianoRollModal
            partId={pianoRollPartId}
            partName={prPart?.name ?? pianoRollPartId}
            isOpen={true}
            onClose={() => setPianoRollPartId(null)}
          />
        );
      })()}

      {/* ── Electribe-Bank-Pattern-Picker (TASK-237, v3.11 multi-pattern) ─── */}
      {electribePicker && (
        <ElectribePickerModal
          picker={electribePicker}
          onSelect={(p) => {
            importElectribePatternIntoActive(p, electribePicker.fileName);
            setElectribePicker(null);
          }}
          onClose={() => setElectribePicker(null)}
        />
      )}

      {/* ── Sample-Slice-Editor (TASK-238 / v2.89) ──────────────────────── */}
      {sliceEditor && (
        <SampleSliceEditor
          sampleName={sliceEditor.sampleName}
          channelData={sliceEditor.channelData}
          sampleRate={sliceEditor.sampleRate}
          onApply={handleSlicesApply}
          onClose={() => setSliceEditor(null)}
          onReplaceSample={handleSliceFile}
        />
      )}

      {/* ── Pattern als Bild exportieren (v3.66.0) ──────────────────────── */}
      <PatternImageExportModal
        isOpen={patternImageExport !== null}
        pattern={patternImageExport}
        onClose={() => setPatternImageExport(null)}
      />

      {/* ── Pattern Compare/Diff Modal (v3.91.0) ────────────────────────── */}
      <PatternCompareModal
        isOpen={compareModalAId !== null}
        patterns={dm.patterns}
        initialAId={compareModalAId}
        onClose={() => setCompareModalAId(null)}
      />
    </div>
  );
}
