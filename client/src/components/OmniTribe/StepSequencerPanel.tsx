/**
 * StepSequencerPanel.tsx — Sprint-103..107 Live-Pattern-Sequencer-UI.
 *
 * Sprint-103: 16-Step + BPM + Play/Stop.
 * Sprint-104: Live-Cursor + per-Step Velocity + localStorage.
 * Sprint-105: per-Step Pitch-Offset.
 * Sprint-107: Pattern-Bank mit 8 Slots, Click switcht aktiven Slot.
 */

import { useEffect, useState, useCallback, useRef, type ReactElement } from "react";

import { omniTribeBridge } from "../../audio/OmniTribeBridge";
import {
  loadPatternBank, savePatternBank, getDefaultPattern,
  PATTERN_BANK_SIZE, type PatternBank, type PatternState,
  type SongStep,
} from "../../utils/patternCache";

export interface StepSequencerPanelProps {
  /** Wenn false, sind alle Controls disabled. */
  connected: boolean;
}

const VEL_MIN = 1;
const VEL_MAX = 127;
const VEL_STEP = 8;

export function StepSequencerPanel({
  connected,
}: StepSequencerPanelProps): ReactElement {
  // Sprint-107: Bank-State + activeSlot
  const [bank, setBank] = useState<PatternBank>(() => loadPatternBank());
  const active = bank.patterns[bank.activeSlot] ?? getDefaultPattern();
  const [playing, setPlaying] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(-1);

  const stepMask = active.steps.reduce(
    (m, on, i) => (on ? m | (1 << i) : m),
    0,
  );

  // ─── Persistence (gesamte Bank) ─────────────────────────
  useEffect(() => {
    savePatternBank(bank);
  }, [bank]);

  // ─── Sync zum Sim (alle Felder pushen wenn aktive Pattern oder Slot wechselt) ─
  // Tracked-Refs damit wir nur DIFFS pushen.
  const lastSent = useRef<PatternState>(getDefaultPattern());

  useEffect(() => {
    if (!connected) {
      lastSent.current = { ...active };
      return;
    }
    // step-mask
    if (
      !active.steps.every((s, i) => s === lastSent.current.steps[i])
    ) {
      omniTribeBridge.setPatternStepMask(stepMask);
    }
    // velocity (pro Step)
    for (let i = 0; i < 16; i++) {
      if (active.velocities[i] !== lastSent.current.velocities[i]) {
        omniTribeBridge.setPatternStepVelocity(i, active.velocities[i]);
      }
    }
    // pitch (pro Step)
    for (let i = 0; i < 16; i++) {
      if (active.pitchOffsets[i] !== lastSent.current.pitchOffsets[i]) {
        omniTribeBridge.setPatternStepPitchOffset(i, active.pitchOffsets[i]);
      }
    }
    // BPM + Root
    if (active.bpm !== lastSent.current.bpm) {
      omniTribeBridge.remoteTempo(active.bpm);
    }
    if (active.root !== lastSent.current.root) {
      omniTribeBridge.setPatternRootNote(active.root);
    }
    lastSent.current = {
      ...active,
      steps: [...active.steps],
      velocities: [...active.velocities],
      pitchOffsets: [...active.pitchOffsets],
    };
  }, [active, connected, stepMask]);

  // ─── Live-Step-Cursor via Sim-Notify ───────────────────
  // Sprint-108: zusaetzlich Song-Advancement bei step-wrap.
  const songStepIdxRef = useRef<number>(0);
  const songRepeatCountRef = useRef<number>(0);
  const prevStepRef = useRef<number>(-1);

  useEffect(() => {
    const onStep = (e: Event) => {
      const detail = (e as CustomEvent).detail as { stepIdx: number } | undefined;
      if (!detail) return;
      const newStep = detail.stepIdx;
      const prev = prevStepRef.current;
      // Wrap detected: vorher 15 → jetzt 0
      if (prev > 0 && newStep === 0 && bank.songMode &&
          bank.songSequence.length > 0 && playing) {
        songRepeatCountRef.current += 1;
        const songIdx = songStepIdxRef.current;
        const currentSongStep = bank.songSequence[songIdx];
        if (currentSongStep &&
            songRepeatCountRef.current >= currentSongStep.repeats) {
          // Advance zu naechstem SongStep (cyclic)
          songRepeatCountRef.current = 0;
          songStepIdxRef.current = (songIdx + 1) % bank.songSequence.length;
          const nextSongStep = bank.songSequence[songStepIdxRef.current];
          if (nextSongStep && nextSongStep.slot !== bank.activeSlot) {
            setBank((b) => ({ ...b, activeSlot: nextSongStep.slot }));
          }
        }
      }
      prevStepRef.current = newStep;
      setCurrentStep(newStep);
    };
    window.addEventListener("omnitribe:patternStep", onStep);
    return () => window.removeEventListener("omnitribe:patternStep", onStep);
  }, [bank.songMode, bank.songSequence, bank.activeSlot, playing]);

  useEffect(() => {
    if (!playing) {
      setCurrentStep(-1);
      // Bei Stop: Song-Counter resetten damit naechste Play von vorn beginnt
      songStepIdxRef.current = 0;
      songRepeatCountRef.current = 0;
      prevStepRef.current = -1;
    }
  }, [playing]);

  // Beim Start in Song-Mode: zum ersten Song-Slot springen
  useEffect(() => {
    if (playing && bank.songMode && bank.songSequence.length > 0) {
      const firstSlot = bank.songSequence[0].slot;
      if (firstSlot !== bank.activeSlot) {
        setBank((b) => ({ ...b, activeSlot: firstSlot }));
      }
    }
    // Intentionally only on play-transition + songMode flip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, bank.songMode]);

  // ─── Pattern-Update Helpers ─────────────────────────────
  const updateActive = useCallback(
    (mut: (p: PatternState) => PatternState) => {
      setBank((b) => {
        const updated = b.patterns.map((p, i) =>
          i === b.activeSlot ? mut(p) : p,
        );
        return { ...b, patterns: updated };
      });
    },
    [],
  );

  const toggleStep = useCallback((idx: number, ev?: React.MouseEvent) => {
    if (ev?.shiftKey) {
      updateActive((p) => ({
        ...p,
        velocities: p.velocities.map((v, i) =>
          i === idx ? Math.min(VEL_MAX, v + VEL_STEP) : v,
        ),
      }));
      return;
    }
    if (ev?.altKey) {
      updateActive((p) => ({
        ...p,
        velocities: p.velocities.map((v, i) =>
          i === idx ? Math.max(VEL_MIN, v - VEL_STEP) : v,
        ),
      }));
      return;
    }
    updateActive((p) => ({
      ...p,
      steps: p.steps.map((on, i) => (i === idx ? !on : on)),
    }));
  }, [updateActive]);

  const setPitchForStep = useCallback((idx: number, value: number) => {
    const clamped = Math.max(-24, Math.min(24, value || 0));
    updateActive((p) => ({
      ...p,
      pitchOffsets: p.pitchOffsets.map((v, i) => (i === idx ? clamped : v)),
    }));
  }, [updateActive]);

  const handlePlay = useCallback(() => {
    if (!connected) return;
    omniTribeBridge.remotePlay();
    setPlaying(true);
  }, [connected]);

  const handleStop = useCallback(() => {
    if (!connected) return;
    omniTribeBridge.remoteStop();
    setPlaying(false);
  }, [connected]);

  const handleClear = useCallback(() => {
    updateActive(() => getDefaultPattern());
  }, [updateActive]);

  const handlePreset = useCallback((mask: number) => {
    updateActive((p) => ({
      ...p,
      steps: Array.from({ length: 16 }, (_, i) => (mask & (1 << i)) !== 0),
    }));
  }, [updateActive]);

  // Sprint-107: Slot-Wechsel.
  // Beim Switch ist die aktuelle Edit-Phase bereits in bank.patterns[activeSlot]
  // gespeichert (auto via updateActive). Wir setzen einfach activeSlot um.
  // Bridge-Push erfolgt via useEffect [active] — pushed alle 16 Steps neu.
  const handleSelectSlot = useCallback((slot: number) => {
    setBank((b) => ({ ...b, activeSlot: slot }));
  }, []);

  // Sprint-108: Song-Mode + Sequence-Editor
  const toggleSongMode = useCallback(() => {
    setBank((b) => ({ ...b, songMode: !b.songMode }));
  }, []);

  const addSongStep = useCallback((slot: number) => {
    setBank((b) => ({
      ...b,
      songSequence: [...b.songSequence, { slot, repeats: 1 }],
    }));
  }, []);

  const updateSongStepRepeats = useCallback((idx: number, repeats: number) => {
    setBank((b) => ({
      ...b,
      songSequence: b.songSequence.map((s, i) =>
        i === idx
          ? { ...s, repeats: Math.max(1, Math.min(32, repeats)) }
          : s,
      ),
    }));
  }, []);

  const updateSongStepSlot = useCallback((idx: number, slot: number) => {
    setBank((b) => ({
      ...b,
      songSequence: b.songSequence.map((s, i) =>
        i === idx ? { ...s, slot } : s,
      ),
    }));
  }, []);

  const removeSongStep = useCallback((idx: number) => {
    setBank((b) => ({
      ...b,
      songSequence: b.songSequence.filter((_, i) => i !== idx),
    }));
  }, []);

  const clearSongSequence = useCallback(() => {
    setBank((b) => ({ ...b, songSequence: [] }));
  }, []);

  // ─── Render ─────────────────────────────────────────────
  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4 space-y-3"
      data-testid="step-sequencer-panel"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Sim Step-Sequencer</h3>
        <span className="text-[10px] text-text-dim">
          {connected ? "Live → Sim" : "Disconnected"}
          {playing && currentStep >= 0 && ` · step ${currentStep + 1}`}
        </span>
      </div>

      {/* Sprint-107: Pattern-Bank-Selector */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wide text-text-dim mr-1">
          Pattern
        </span>
        <div
          className="flex gap-1 flex-1"
          role="radiogroup"
          aria-label="Pattern bank slot"
        >
          {Array.from({ length: PATTERN_BANK_SIZE }, (_, i) => {
            const isActive = bank.activeSlot === i;
            const slotPattern = bank.patterns[i];
            // Slot-Indikator: Punkt wenn Steps vorhanden
            const hasContent = slotPattern.steps.some((s) => s);
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => handleSelectSlot(i)}
                data-testid={`bank-slot-${i}`}
                title={`Pattern ${i + 1}${hasContent ? " (has steps)" : " (empty)"}`}
                className={[
                  "flex-1 px-2 py-1 rounded text-[10px] font-mono border transition-colors",
                  isActive
                    ? "bg-accent-primary text-bg-base border-accent-primary"
                    : "bg-bg-elevated border-border-color text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                {String.fromCharCode(65 + i)}
                {hasContent && !isActive && (
                  <span className="ml-1 text-accent-primary">•</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sprint-108: Song-Mode-Editor */}
      <div
        className="border-t border-border-color pt-2 space-y-2"
        data-testid="song-editor"
      >
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            <input
              type="checkbox"
              checked={bank.songMode}
              onChange={toggleSongMode}
              data-testid="song-mode-toggle"
              className="accent-accent-primary"
            />
            <span>Song-Mode (Auto-Slot-Switch)</span>
          </label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => addSongStep(bank.activeSlot)}
              data-testid="song-add-step"
              className="text-[10px] px-2 py-0.5 rounded bg-bg-elevated border border-border-color text-text-muted hover:text-text-primary"
              title="Aktuellen Slot als Song-Step anhaengen"
            >
              + Step
            </button>
            <button
              type="button"
              onClick={clearSongSequence}
              data-testid="song-clear"
              disabled={bank.songSequence.length === 0}
              className="text-[10px] px-2 py-0.5 rounded bg-bg-elevated border border-border-color text-text-muted hover:text-accent-danger disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>

        {bank.songSequence.length > 0 ? (
          <div
            className="flex flex-wrap gap-1"
            data-testid="song-sequence"
            role="list"
            aria-label="Song sequence"
          >
            {bank.songSequence.map((step, i) => (
              <div
                key={i}
                role="listitem"
                data-testid={`song-step-${i}`}
                className="flex items-center gap-1 bg-bg-elevated border border-border-color rounded px-1 py-0.5"
              >
                <span className="text-[10px] text-text-dim font-mono">#{i + 1}</span>
                <select
                  value={step.slot}
                  onChange={(e) =>
                    updateSongStepSlot(i, Number(e.target.value))}
                  data-testid={`song-step-${i}-slot`}
                  className="bg-bg-base text-[10px] text-text-primary font-mono border-0 rounded"
                >
                  {Array.from({ length: PATTERN_BANK_SIZE }, (_, j) => (
                    <option key={j} value={j}>
                      {String.fromCharCode(65 + j)}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-text-dim">×</span>
                <input
                  type="number"
                  min={1}
                  max={32}
                  value={step.repeats}
                  onChange={(e) =>
                    updateSongStepRepeats(i, Number(e.target.value) || 1)}
                  data-testid={`song-step-${i}-repeats`}
                  className="w-10 bg-bg-base text-[10px] text-text-primary font-mono border-0 rounded text-center"
                />
                <button
                  type="button"
                  onClick={() => removeSongStep(i)}
                  data-testid={`song-step-${i}-remove`}
                  className="text-[10px] text-text-dim hover:text-accent-danger px-0.5"
                  aria-label={`Remove song step ${i + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-text-dim italic">
            Keine Song-Steps. "+ Step" haengt den aktuellen Slot mit
            ×1-Wiederholung an die Sequenz.
          </p>
        )}
      </div>

      {/* 16-Step Grid mit Velocity-Bars + Live-Cursor */}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        role="group"
        aria-label="Pattern steps"
      >
        {active.steps.map((on, i) => {
          const vel = active.velocities[i];
          const velPct = Math.round((vel / VEL_MAX) * 100);
          const isCurrent = currentStep === i && playing;
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => toggleStep(i, e)}
              disabled={!connected}
              data-testid={`step-${i}`}
              data-current={isCurrent ? "true" : "false"}
              aria-label={`Step ${i + 1}${on ? ` velocity ${vel}` : ""}`}
              aria-pressed={on}
              title={
                on
                  ? `vel ${vel} — shift-click +${VEL_STEP}, alt-click -${VEL_STEP}`
                  : `off — click to enable`
              }
              className={[
                "h-10 rounded border relative overflow-hidden transition-colors",
                "text-[10px] font-mono",
                on
                  ? "bg-accent-primary/20 border-accent-primary text-text-primary"
                  : "bg-bg-elevated border-border-color text-text-dim hover:text-text-muted",
                isCurrent && "ring-2 ring-accent-warning",
                !connected && "opacity-40 cursor-not-allowed",
                i % 4 === 0 && !on && "border-text-dim",
              ].filter(Boolean).join(" ")}
            >
              {on && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 right-0 bg-accent-primary/40 pointer-events-none"
                  style={{ height: `${velPct}%` }}
                  data-testid={`step-${i}-vel-bar`}
                />
              )}
              <span className="relative z-10">{i + 1}</span>
            </button>
          );
        })}
      </div>

      {/* Pitch-Row */}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        role="group"
        aria-label="Pitch offsets"
      >
        {active.pitchOffsets.map((p, i) => (
          <input
            key={`pitch-${i}`}
            type="number"
            min={-24}
            max={24}
            value={p}
            disabled={!connected}
            data-testid={`pitch-${i}`}
            onChange={(e) => setPitchForStep(i, Number(e.target.value))}
            title={`Step ${i + 1} pitch offset (-24..+24 Halbtoene)`}
            className={[
              "h-6 rounded border bg-bg-elevated border-border-color",
              "text-[9px] font-mono text-text-muted text-center",
              "px-0 disabled:opacity-40",
              p !== 0 && "text-accent-secondary border-accent-secondary",
              active.steps[i] && "border-accent-primary/40",
            ].filter(Boolean).join(" ")}
          />
        ))}
      </div>

      {/* Presets */}
      <div className="flex gap-1 text-[10px] items-center">
        <span className="text-text-dim">Preset:</span>
        <button
          type="button"
          onClick={() => handlePreset(0xFFFF)}
          disabled={!connected}
          className="text-text-muted hover:text-text-primary px-1"
          data-testid="preset-all"
        >
          all
        </button>
        <button
          type="button"
          onClick={() => handlePreset(0x1111)}
          disabled={!connected}
          className="text-text-muted hover:text-text-primary px-1"
          data-testid="preset-quarters"
        >
          quarters
        </button>
        <button
          type="button"
          onClick={() => handlePreset(0x5555)}
          disabled={!connected}
          className="text-text-muted hover:text-text-primary px-1"
          data-testid="preset-eighths"
        >
          eighths
        </button>
        <button
          type="button"
          onClick={() => handlePreset(0xAA22)}
          disabled={!connected}
          className="text-text-muted hover:text-text-primary px-1"
          data-testid="preset-syncopated"
        >
          syncopated
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={!connected}
          className="text-text-muted hover:text-accent-danger ml-auto px-1"
          data-testid="preset-clear"
        >
          clear
        </button>
      </div>

      <p className="text-[10px] text-text-dim leading-snug">
        Click toggles step · Shift+Click erhoeht Velocity · Alt+Click
        senkt sie. Bar-Hoehe = Velocity. Pitch-Inputs = Halbton-Offset.
        Pattern A-H = Bank-Slots (Sprint-107).
      </p>

      {/* Transport + BPM + Root */}
      <div className="flex items-center gap-3 pt-2 border-t border-border-color">
        {!playing ? (
          <button
            type="button"
            onClick={handlePlay}
            disabled={!connected}
            data-testid="seq-play-btn"
            className={[
              "text-xs px-4 py-1 rounded transition-opacity font-bold",
              connected
                ? "bg-accent-success text-bg-base hover:opacity-90"
                : "bg-bg-elevated text-text-dim opacity-50 cursor-not-allowed",
            ].join(" ")}
          >
            ▶ Play
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStop}
            data-testid="seq-stop-btn"
            className="text-xs px-4 py-1 rounded bg-accent-danger text-bg-base hover:opacity-90 font-bold"
          >
            ■ Stop
          </button>
        )}
        <label className="flex items-center gap-1 flex-1">
          <span className="text-[10px] text-text-dim">BPM</span>
          <input
            type="range"
            min={40}
            max={240}
            value={active.bpm}
            onChange={(e) =>
              updateActive((p) => ({ ...p, bpm: Number(e.target.value) }))}
            disabled={!connected}
            data-testid="seq-bpm-slider"
            className="flex-1"
          />
          <span
            className="text-[10px] text-text-muted font-mono w-8 text-right"
            data-testid="seq-bpm-display"
          >
            {active.bpm}
          </span>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-[10px] text-text-dim">Root</span>
          <input
            type="number"
            min={0}
            max={127}
            value={active.root}
            onChange={(e) =>
              updateActive((p) => ({
                ...p,
                root: Math.max(0, Math.min(127, Number(e.target.value) || 0)),
              }))}
            disabled={!connected}
            data-testid="seq-root-input"
            className="w-12 bg-bg-elevated border border-border-color rounded px-1 text-[10px] text-text-primary font-mono"
          />
        </label>
      </div>
    </div>
  );
}
