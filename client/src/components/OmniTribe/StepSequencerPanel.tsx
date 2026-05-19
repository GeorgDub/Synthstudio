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
  useEffect(() => {
    const onStep = (e: Event) => {
      const detail = (e as CustomEvent).detail as { stepIdx: number } | undefined;
      if (!detail) return;
      setCurrentStep(detail.stepIdx);
    };
    window.addEventListener("omnitribe:patternStep", onStep);
    return () => window.removeEventListener("omnitribe:patternStep", onStep);
  }, []);

  useEffect(() => {
    if (!playing) setCurrentStep(-1);
  }, [playing]);

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
