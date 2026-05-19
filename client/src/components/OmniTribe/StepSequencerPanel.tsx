/**
 * StepSequencerPanel.tsx — Sprint-103/104 Live-Pattern-Sequencer-UI.
 *
 * 16 Step-Buttons, BPM-Slider, Root-Note-Input, Play/Stop.
 * Sprint-104: Live-Step-Cursor (server pusht current-step-notify),
 * per-step Velocity (shift+click oder drag), localStorage-Persistence.
 *
 * Schickt CMD 0x04 (PATTERN) + CMD 0x0E (TRANSPORT) an den Sim. Der Sim
 * feuert Note-Ons im BPM-Raster, chord-Modul-Fan-Out macht aus jeder
 * Root einen Chord. Web-Audio spielt die Triads.
 */

import { useEffect, useState, useCallback, useRef, type ReactElement } from "react";

import { omniTribeBridge } from "../../audio/OmniTribeBridge";
import {
  loadPatternCache, savePatternCache, type PatternState,
} from "../../utils/patternCache";

export interface StepSequencerPanelProps {
  /** Wenn false, sind alle Controls disabled. */
  connected: boolean;
}

const VEL_MIN = 1;       // 0 = effektiv Note-Off → vermeiden
const VEL_MAX = 127;
const VEL_STEP = 8;      // Shift-Click increment

export function StepSequencerPanel({
  connected,
}: StepSequencerPanelProps): ReactElement {
  const initial = useRef<PatternState>(loadPatternCache());
  const [steps, setSteps] = useState<boolean[]>(initial.current.steps);
  const [velocities, setVelocities] = useState<number[]>(initial.current.velocities);
  // Sprint-105: per-Step pitch-offset in Halbtoenen
  const [pitchOffsets, setPitchOffsets] = useState<number[]>(initial.current.pitchOffsets);
  const [bpm, setBpm] = useState<number>(initial.current.bpm);
  const [root, setRoot] = useState<number>(initial.current.root);
  const [playing, setPlaying] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<number>(-1);

  const stepMask = steps.reduce(
    (m, on, i) => (on ? m | (1 << i) : m),
    0,
  );

  // ─── Persistence ────────────────────────────────────────
  useEffect(() => {
    savePatternCache({ steps, velocities, pitchOffsets, bpm, root });
  }, [steps, velocities, pitchOffsets, bpm, root]);

  // ─── Sync Pattern-State zum Sim ─────────────────────────
  useEffect(() => {
    if (!connected) return;
    omniTribeBridge.setPatternStepMask(stepMask);
  }, [stepMask, connected]);

  useEffect(() => {
    if (!connected) return;
    omniTribeBridge.remoteTempo(bpm);
  }, [bpm, connected]);

  useEffect(() => {
    if (!connected) return;
    omniTribeBridge.setPatternRootNote(root);
  }, [root, connected]);

  // Velocity-Sync: pro Step einzeln senden wenn Wert sich aendert
  // (Vergleich mit Ref damit nicht alle 16 bei jedem Render gepushed werden)
  const lastSentVels = useRef<number[]>([...velocities]);
  useEffect(() => {
    if (!connected) return;
    for (let i = 0; i < 16; i++) {
      if (velocities[i] !== lastSentVels.current[i]) {
        omniTribeBridge.setPatternStepVelocity(i, velocities[i]);
        lastSentVels.current[i] = velocities[i];
      }
    }
  }, [velocities, connected]);

  // Pitch-Sync (Sprint-105): analog Velocity
  const lastSentPitch = useRef<number[]>([...pitchOffsets]);
  useEffect(() => {
    if (!connected) return;
    for (let i = 0; i < 16; i++) {
      if (pitchOffsets[i] !== lastSentPitch.current[i]) {
        omniTribeBridge.setPatternStepPitchOffset(i, pitchOffsets[i]);
        lastSentPitch.current[i] = pitchOffsets[i];
      }
    }
  }, [pitchOffsets, connected]);

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

  // Cursor zuruecksetzen wenn Stop
  useEffect(() => {
    if (!playing) setCurrentStep(-1);
  }, [playing]);

  // ─── Handlers ───────────────────────────────────────────
  const toggleStep = useCallback((idx: number, ev?: React.MouseEvent) => {
    // Shift-Click → Velocity erhoehen, Alt-Click → senken (statt Toggle)
    if (ev?.shiftKey) {
      setVelocities((v) => {
        const next = [...v];
        next[idx] = Math.min(VEL_MAX, next[idx] + VEL_STEP);
        return next;
      });
      return;
    }
    if (ev?.altKey) {
      setVelocities((v) => {
        const next = [...v];
        next[idx] = Math.max(VEL_MIN, next[idx] - VEL_STEP);
        return next;
      });
      return;
    }
    setSteps((prev) => prev.map((on, i) => (i === idx ? !on : on)));
  }, []);

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
    setSteps(Array(16).fill(false));
    setVelocities(Array(16).fill(100));
    setPitchOffsets(Array(16).fill(0));
  }, []);

  // Sprint-105: Pitch-Offset pro Step setzen (clamped auf -24..+24 fuer UI-Sanity)
  const setPitchForStep = useCallback((idx: number, value: number) => {
    const clamped = Math.max(-24, Math.min(24, value || 0));
    setPitchOffsets((p) => p.map((v, i) => (i === idx ? clamped : v)));
  }, []);

  const handlePreset = useCallback((mask: number) => {
    setSteps(Array.from({ length: 16 }, (_, i) => (mask & (1 << i)) !== 0));
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

      {/* 16-Step Grid mit Velocity-Bars + Live-Cursor */}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        role="group"
        aria-label="Pattern steps"
      >
        {steps.map((on, i) => {
          const vel = velocities[i];
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
              {/* Velocity-Bar als Hintergrund-Hoehe */}
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

      {/* Sprint-105: Pitch-Row — pro Step Halbton-Offset */}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        role="group"
        aria-label="Pitch offsets"
      >
        {pitchOffsets.map((p, i) => (
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
              steps[i] && "border-accent-primary/40",
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
        senkt sie. Bar-Hoehe = Velocity. Pitch-Inputs unten = Halbton-
        Offset (Sprint-105 Melodie-Modus).
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
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            disabled={!connected}
            data-testid="seq-bpm-slider"
            className="flex-1"
          />
          <span
            className="text-[10px] text-text-muted font-mono w-8 text-right"
            data-testid="seq-bpm-display"
          >
            {bpm}
          </span>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-[10px] text-text-dim">Root</span>
          <input
            type="number"
            min={0}
            max={127}
            value={root}
            onChange={(e) =>
              setRoot(Math.max(0, Math.min(127, Number(e.target.value) || 0)))}
            disabled={!connected}
            data-testid="seq-root-input"
            className="w-12 bg-bg-elevated border border-border-color rounded px-1 text-[10px] text-text-primary font-mono"
          />
        </label>
      </div>
    </div>
  );
}
