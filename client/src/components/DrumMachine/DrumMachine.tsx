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

import React, { useState, useRef, useCallback, useEffect } from "react";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { PartData, ChannelFx, StepResolution } from "@/audio/AudioEngine";
import { AudioEngine } from "@/audio/AudioEngine";
import { PianoRollModal } from "@/components/PianoRoll/PianoRollModal";
import { NoteRepeatPanel } from "@/components/PerformanceMode/NoteRepeatPanel";
import { TransposeControl } from "@/components/PianoRoll/TransposeControl";
import { PatternMorphPanel } from "@/components/PatternMorph";
import { MacroPanel } from "@/components/Macro/MacroPanel";
import { EnvelopeFollowerPanel } from "./EnvelopeFollowerPanel";
import { useMidiLearn } from "@/hooks/useMidiLearn";
import { toast } from "@/store/useToastStore";
import { MixAssistantPanel } from "./MixAssistantPanel";
import type { MixAnalysisInput, MixRecommendation } from "@/utils/mixAnalysis";
import { parseMidiFile } from "../../../../src/utils/midiParser.js";
import { parseFlp, flpPositionToStep, groupNotesByBar, calculateBarCount } from "@/utils/flpImport";
import { GranularSynthPanel } from "./GranularSynthPanel";
import { DEFAULT_GRANULAR_PARAMS } from "@/audio/GranularEngine";
import { PolyrhythmVisualizer } from "./PolyrhythmVisualizer";
// Ausgelagerte Sub-Components
import { FxPanel } from "./FxPanel";
import { ResizableDrumPanel } from "./ResizableDrumPanel";
import { StepInspector } from "./StepInspector";
import { ChannelStrip } from "./ChannelStrip";
import { stepGroupBorder } from "./drumMachineHelpers";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Props {
  dm: DrumMachineState & DrumMachineActions;
  samples: Array<{ id: string; name: string; path: string; category: string }>;
  isPlaying: boolean;
  bpm: number;
  onPlayStop: () => void;
  onBpmChange: (bpm: number) => void;
  className?: string;
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
}

function PatternRow({
  pattern, patternIndex, isActive, isPlaying, isLiveEditing, showDelete,
  hasPrevPattern, prevPatternId, allPatterns,
  onSelect, onDuplicate, onRemove, onCopySamplesFrom,
}: PatternRowProps) {
  const isDraft  = isLiveEditing && isActive;
  const isLocked = isLiveEditing && isPlaying;
  // v1.92: jede Pattern-Zeile ist via Rechtsklick MIDI-bindbar
  const learn = useMidiLearn({ type: "pattern", patternIndex });
  // v2.5: Submenu zum Auswählen welcher Pattern als Source dient
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex items-center group relative">
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

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export function DrumMachine({ dm, samples, isPlaying, bpm, onPlayStop, onBpmChange, className = "" }: Props) {
  const pattern = dm.getActivePattern();
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
  const [showMorph, setShowMorph] = useState(false);
  const [showMixAssistant, setShowMixAssistant] = useState(false);
  const [showEnvFollower, setShowEnvFollower] = useState(false);
  const [showMacros, setShowMacros] = useState(false);
  const [showPolyrhythm, setShowPolyrhythm] = useState(false);
  const midiImportRef = useRef<HTMLInputElement>(null);
  const flpImportRef = useRef<HTMLInputElement>(null);
  const [selectedStep, setSelectedStep] = useState<{ partId: string; stepIndex: number } | null>(null);
  const [granularPartId, setGranularPartId] = useState<string | null>(null);

  // MIDI-Import: MIDI-Datei in aktives Pattern übertragen
  const handleMidiImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pattern) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const buffer = ev.target?.result as ArrayBuffer;
        const parsed = parseMidiFile(buffer);
        if (!parsed?.tracks?.length) return;
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
        if (!noteOns.length) return;

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
      } catch (err) {
        console.error("[MIDI Import]", err);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }, [pattern, dm]);

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

  // Keyboard-Shortcuts werden zentral durch useKeyboardShortcuts in App.tsx gehandhabt

  // BPM-Input synchronisieren
  useEffect(() => {
    setBpmInput(String(bpm));
  }, [bpm]);

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
                  onRemove={() => dm.removePattern(p.id)}
                  onCopySamplesFrom={(srcId, srcName) => {
                    dm.copySamplesFromPattern(srcId, p.id);
                    toast(`Sampler aus „${srcName}" in „${p.name}" übernommen`, { kind: "success" });
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

        {/* Step-Count */}
        <div className="flex items-center gap-1">
          {([16, 32] as const).map(n => (
            <button
              key={n}
              onClick={() => dm.setStepCount(n)}
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
          onClick={dm.clearPattern}
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

        {/* BPM — v1.86: right-click für MIDI-Learn */}
        <div
          className="flex items-center gap-1 relative"
          onContextMenu={bpmLearn.onContextMenu}
        >
          <button
            onClick={() => onBpmChange(Math.max(20, bpm - 1))}
            title="BPM −1 (Taste: −)"
            aria-label="BPM verringern"
            className="w-5 h-6 rounded text-xs bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary active:scale-95 transition-colors"
          >−</button>
          <input
            ref={bpmInputRef}
            type="number" min={20} max={300}
            value={bpmInput}
            onChange={e => setBpmInput(e.target.value)}
            onBlur={() => {
              const v = parseInt(bpmInput);
              if (!isNaN(v)) onBpmChange(Math.max(20, Math.min(300, v)));
              else setBpmInput(String(bpm));
            }}
            onKeyDown={e => {
              if (e.key === "Enter") bpmInputRef.current?.blur();
            }}
            title="BPM (Doppelklick zum Bearbeiten, Tasten + und − für ±1)"
            className="w-14 bg-bg-elevated text-text-primary text-xs rounded px-1.5 py-1 border border-border-color text-center"
          />
          <button
            onClick={() => onBpmChange(Math.min(300, bpm + 1))}
            title="BPM +1 (Taste: +)"
            aria-label="BPM erhöhen"
            className="w-5 h-6 rounded text-xs bg-bg-elevated text-text-muted hover:bg-bg-base hover:text-text-primary active:scale-95 transition-colors"
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
      {showNoteRepeat && (
        <ResizableDrumPanel storageKey="ss-panel-notrepeat" defaultHeight={110} minHeight={80} maxHeight={240}
          title="Note Repeat"
          onClose={() => setShowNoteRepeat(false)}>
          <NoteRepeatPanel
            bpm={effectiveBpm}
            compact={true}
          />
        </ResizableDrumPanel>
      )}

      {/* ── Pattern Morph Panel ──────────────────────────────────────────── */}
      {showMorph && (
        <ResizableDrumPanel storageKey="ss-panel-morph" defaultHeight={160} minHeight={100} maxHeight={320}
          title="Pattern-Morph"
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
          title="Envelope Follower"
          onClose={() => setShowEnvFollower(false)}>
          <EnvelopeFollowerPanel parts={pattern.parts} />
        </ResizableDrumPanel>
      )}

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

        {/* Step-Nummern */}
        <div className="flex gap-[2px] flex-1 min-w-0">
          {Array.from({ length: pattern.stepCount }).map((_, i) => (
            <div
              key={i}
              className={[
                "flex-1 text-center text-[8px] leading-none py-0.5 relative",
                stepGroupBorder(i, pattern.stepCount),
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
          ))}
        </div>
      </div>

      {/* ── Kanal-Zeilen ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {pattern.parts.map((part, partIndex) => (
          <ChannelStrip
            key={part.id}
            part={part}
            partIndex={partIndex}
            stepCount={pattern.stepCount}
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
          />
        ))}
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
    </div>
  );
}
