/**
 * Synthstudio – SongModePanel (v3.109.0)
 *
 * UI for the Song-Mode / Pattern-Chain-Sequencer.
 *
 * Layout:
 *   Header → Song-Picker (Dropdown) + Add / Rename / Delete + LoopMode
 *   Steps  → List of (Pattern-Selector | Repeat | Label | × Remove)
 *   Footer → Add-Step / Reset / Activate
 *
 * Active-step indicator: current step is highlighted + "x/y" repeat counter.
 *
 * Drag-and-drop reordering is implemented via native HTML5 DnD (no extra
 * dependency) — keeps bundle slim and works in both Electron + Web.
 *
 * All colors via semantic --ss-* tokens (no hardcoded Tailwind colors).
 */
import { useMemo, useState } from "react";
import { Plus, Trash2, RotateCcw, Power } from "lucide-react";
import type { PatternData } from "@/audio/AudioEngine";
import {
  useSongModeStore,
  addSong,
  removeSong,
  renameSong,
  setSongLoopMode,
  addStep,
  removeStep,
  setStepRepeat,
  setStepLabel,
  setStepPattern,
  reorderStep,
  setActiveSong,
  resetTransport,
  type SongLoopMode,
} from "@/store/useSongModeStore";
import { clampRepeatCount } from "@/utils/songSequencer";
import { SongJumpEditor } from "@/components/SongMode/SongJumpEditor";
import { useSongJumpStore } from "@/store/useSongJumpStore";
import { usePatternCrossfadeStore } from "@/store/usePatternCrossfadeStore";

interface SongModePanelProps {
  patterns: PatternData[];
  activePatternId: string;
  className?: string;
}

const LOOP_MODES: Array<{ id: SongLoopMode; label: string; hint: string }> = [
  { id: "once", label: "Once", hint: "Stop nach letztem Step" },
  { id: "loop", label: "Loop", hint: "Endlos zurück zu Step 1" },
  { id: "pingpong", label: "Ping-Pong", hint: "Am Ende rückwärts spielen" },
];

export function SongModePanel({ patterns, activePatternId, className = "" }: SongModePanelProps) {
  const state = useSongModeStore();
  const songs = state.songs;
  const activeSongId = state.activeSongId;
  const currentStepIdx = state.currentStepIdx;
  const currentRepeat = state.currentRepeat;

  // The "selected song" for editing in the panel. Defaults to the first song.
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const effectiveSelectedId =
    (selectedSongId && songs.find(s => s.id === selectedSongId)?.id) ?? songs[0]?.id ?? null;

  const selectedSong = useMemo(
    () => songs.find(s => s.id === effectiveSelectedId) ?? null,
    [songs, effectiveSelectedId]
  );

  const isActiveSelected = !!selectedSong && selectedSong.id === activeSongId;

  // v3.123.0: Pattern-Crossfade-Konfig (für Header-Indicator).
  const crossfadeCfg = usePatternCrossfadeStore();

  // v3.117.0: track per-step jump counts so we can show a badge next to each step.
  const jumpsState = useSongJumpStore();
  const jumpCountByStep = useMemo(() => {
    const m = new Map<string, number>();
    if (!selectedSong) return m;
    const jumps = jumpsState.jumpsBySong[selectedSong.id] ?? [];
    for (const j of jumps) {
      m.set(j.fromStepId, (m.get(j.fromStepId) ?? 0) + 1);
    }
    return m;
  }, [jumpsState, selectedSong]);

  // Local DnD state — using native DnD events.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  function handleAddSong() {
    const id = addSong(`Song ${songs.length + 1}`);
    setSelectedSongId(id);
  }

  function handleRenameSong() {
    if (!selectedSong) return;
    const next = window.prompt("Song-Name:", selectedSong.name);
    if (next === null) return;
    renameSong(selectedSong.id, next);
  }

  function handleDeleteSong() {
    if (!selectedSong) return;
    const ok = window.confirm(`Song "${selectedSong.name}" wirklich löschen?`);
    if (!ok) return;
    removeSong(selectedSong.id);
    setSelectedSongId(null);
  }

  function handleAddStep() {
    if (!selectedSong) return;
    const fallback = patterns[0]?.id ?? "";
    const useId = activePatternId || fallback;
    if (!useId) return;
    addStep(selectedSong.id, useId, 1);
  }

  function handleToggleActive() {
    if (!selectedSong) return;
    if (isActiveSelected) {
      setActiveSong(null);
    } else {
      setActiveSong(selectedSong.id);
    }
  }

  function handleDrop(targetIdx: number) {
    if (!selectedSong || dragIdx === null) return;
    if (dragIdx !== targetIdx) {
      reorderStep(selectedSong.id, dragIdx, targetIdx);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }

  const patternNameById = useMemo(() => {
    const m = new Map<string, string>();
    patterns.forEach(p => m.set(p.id, p.name));
    return m;
  }, [patterns]);

  return (
    <div
      className={`flex flex-col h-full bg-bg-panel text-text-primary ${className}`}
      data-testid="song-mode-panel"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-color flex-shrink-0">
        <span className="text-sm font-semibold text-text-primary">🎼 Song-Mode</span>

        {/* v3.123.0: Crossfade-Indicator */}
        {crossfadeCfg.enabled && crossfadeCfg.lengthSteps > 0 && (
          <span
            data-testid="song-mode-crossfade-indicator"
            title={`Pattern-Crossfade: ${crossfadeCfg.lengthSteps} steps · ${crossfadeCfg.curve}`}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/40"
          >
            ⇋ Crossfade: {crossfadeCfg.lengthSteps} step{crossfadeCfg.lengthSteps === 1 ? "" : "s"}
          </span>
        )}

        <select
          value={effectiveSelectedId ?? ""}
          onChange={e => setSelectedSongId(e.target.value || null)}
          className="ml-2 px-2 py-1 rounded bg-bg-base border border-border-color text-xs text-text-primary"
          data-testid="song-mode-picker"
        >
          {songs.length === 0 && <option value="">– kein Song –</option>}
          {songs.map(s => (
            <option key={s.id} value={s.id}>
              {s.id === activeSongId ? "● " : ""}
              {s.name} ({s.steps.length})
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleAddSong}
          className="px-2 py-1 rounded border border-border-color text-xs text-text-muted hover:text-accent-primary hover:border-accent-primary transition-colors"
          data-testid="song-mode-add-song"
          title="Neuen Song anlegen"
        >
          <Plus size={12} className="inline" /> Song
        </button>

        {selectedSong && (
          <>
            <button
              type="button"
              onClick={handleRenameSong}
              className="px-2 py-1 rounded text-xs text-text-muted hover:text-accent-primary transition-colors"
              data-testid="song-mode-rename-song"
              title="Song umbenennen"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={handleDeleteSong}
              className="px-2 py-1 rounded text-xs text-text-muted hover:text-accent-danger transition-colors"
              data-testid="song-mode-delete-song"
              title="Song löschen"
            >
              <Trash2 size={12} className="inline" />
            </button>
          </>
        )}

        <div className="flex-1" />

        {/* Loop-Mode selector */}
        {selectedSong && (
          <div className="flex items-center gap-1" data-testid="song-mode-loop-modes">
            {LOOP_MODES.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSongLoopMode(selectedSong.id, m.id)}
                title={m.hint}
                className={[
                  "px-2 py-1 text-xs rounded border transition-colors",
                  selectedSong.loopMode === m.id
                    ? "border-accent-primary bg-accent-primary/20 text-accent-primary"
                    : "border-border-color text-text-muted hover:text-text-primary",
                ].join(" ")}
                data-testid={`song-mode-loopmode-${m.id}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* Activate-Toggle */}
        {selectedSong && (
          <button
            type="button"
            onClick={handleToggleActive}
            className={[
              "ml-2 px-3 py-1 text-xs rounded font-semibold transition-colors",
              isActiveSelected
                ? "bg-accent-success text-text-primary"
                : "bg-bg-elevated text-text-muted hover:text-accent-primary border border-border-color",
            ].join(" ")}
            data-testid="song-mode-activate-toggle"
          >
            <Power size={12} className="inline mr-1" />
            {isActiveSelected ? "Aktiv" : "Aktivieren"}
          </button>
        )}

        {isActiveSelected && (
          <button
            type="button"
            onClick={() => resetTransport()}
            className="ml-1 px-2 py-1 text-xs rounded border border-border-color text-text-muted hover:text-accent-primary transition-colors"
            data-testid="song-mode-reset-transport"
            title="Zurück zu Step 1"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>

      {/* ── Steps list ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {!selectedSong && (
          <div className="h-full flex items-center justify-center text-text-dim text-sm">
            Wähle oder erstelle einen Song um Schritte hinzuzufügen.
          </div>
        )}

        {selectedSong && selectedSong.steps.length === 0 && (
          <div className="h-full flex items-center justify-center text-text-dim text-sm">
            Noch keine Schritte. Klick „+ Step" um das aktuelle Pattern hinzuzufügen.
          </div>
        )}

        {selectedSong && selectedSong.steps.length > 0 && (
          <ol className="space-y-1" data-testid="song-mode-steps-list">
            {selectedSong.steps.map((step, idx) => {
              const isCurrent = isActiveSelected && idx === currentStepIdx;
              const stepCap = clampRepeatCount(step.repeatCount);
              return (
                <li
                  key={step.id}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragEnter={() => setDragOverIdx(idx)}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={() => {
                    setDragIdx(null);
                    setDragOverIdx(null);
                  }}
                  className={[
                    "flex items-center gap-2 px-2 py-1.5 rounded border transition-colors",
                    isCurrent
                      ? "border-accent-primary bg-accent-primary/10"
                      : dragOverIdx === idx
                        ? "border-accent-secondary bg-bg-elevated"
                        : "border-border-color bg-bg-base hover:bg-bg-elevated",
                  ].join(" ")}
                  data-testid={`song-mode-step-${idx}`}
                >
                  <span
                    className="cursor-grab text-text-dim text-xs select-none w-6 text-center"
                    title="Ziehen zum Sortieren"
                  >
                    {idx + 1}.
                  </span>

                  {jumpCountByStep.get(step.id) ? (
                    <span
                      className="px-1 py-0.5 rounded text-[10px] font-mono bg-accent-secondary/20 text-accent-secondary"
                      title={`${jumpCountByStep.get(step.id)} Jump(s) konfiguriert`}
                      data-testid={`song-mode-step-${idx}-jump-badge`}
                    >
                      ↪{jumpCountByStep.get(step.id)}
                    </span>
                  ) : null}

                  <select
                    value={step.patternId}
                    onChange={e => setStepPattern(selectedSong.id, step.id, e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1 rounded bg-bg-elevated border border-border-color text-xs text-text-primary"
                    data-testid={`song-mode-step-${idx}-pattern`}
                  >
                    {patterns.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    {!patternNameById.has(step.patternId) && (
                      <option value={step.patternId}>?? {step.patternId.slice(0, 6)}</option>
                    )}
                  </select>

                  <div className="flex items-center gap-1 text-xs text-text-muted">
                    <span>×</span>
                    <input
                      type="number"
                      min={1}
                      max={64}
                      value={stepCap}
                      onChange={e =>
                        setStepRepeat(selectedSong.id, step.id, Number(e.target.value))
                      }
                      className="w-12 px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-xs text-text-primary text-center"
                      data-testid={`song-mode-step-${idx}-repeat`}
                    />
                    {isCurrent && (
                      <span
                        className="ml-1 text-accent-primary font-mono"
                        data-testid={`song-mode-step-${idx}-counter`}
                      >
                        {currentRepeat + 1}/{stepCap}
                      </span>
                    )}
                  </div>

                  <input
                    type="text"
                    placeholder="Label"
                    value={step.label ?? ""}
                    onChange={e => setStepLabel(selectedSong.id, step.id, e.target.value)}
                    className="w-24 px-1 py-0.5 rounded bg-bg-elevated border border-border-color text-xs text-text-muted"
                    data-testid={`song-mode-step-${idx}-label`}
                  />

                  <button
                    type="button"
                    onClick={() => removeStep(selectedSong.id, step.id)}
                    className="p-1 rounded text-text-dim hover:text-accent-danger transition-colors"
                    title="Step löschen"
                    data-testid={`song-mode-step-${idx}-remove`}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {selectedSong && (
        <div className="px-3 py-2 border-t border-border-color flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleAddStep}
            disabled={patterns.length === 0}
            className="px-3 py-1 text-xs rounded border border-border-color text-text-muted hover:text-accent-primary hover:border-accent-primary disabled:opacity-50 disabled:hover:text-text-muted disabled:hover:border-border-color transition-colors"
            data-testid="song-mode-add-step"
            title={
              patterns.length === 0
                ? "Keine Patterns verfügbar"
                : "Aktuelles Pattern als Step hinzufügen"
            }
          >
            <Plus size={12} className="inline" /> Step
            {activePatternId ? ` (${patternNameById.get(activePatternId) ?? "?"})` : ""}
          </button>

          {isActiveSelected && (
            <span className="text-xs text-text-dim ml-2" data-testid="song-mode-status">
              Step {currentStepIdx + 1} / {selectedSong.steps.length} · Mode{" "}
              {selectedSong.loopMode}
            </span>
          )}

          <div className="flex-1" />
          <span className="text-xs text-text-dim">
            {selectedSong.steps.length} Step{selectedSong.steps.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {/* ── v3.117.0: Conditional Jumps Editor ─────────────────────────── */}
      {selectedSong && (
        <SongJumpEditor
          song={selectedSong}
          className="border-t border-border-color flex-shrink-0"
        />
      )}
    </div>
  );
}

export default SongModePanel;
