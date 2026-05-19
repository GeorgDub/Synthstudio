/**
 * StepSequencerPanel.tsx — Sprint-103 Live-Pattern-Sequencer-UI.
 *
 * 16 Step-Buttons, BPM-Slider, Root-Note-Input, Play/Stop.
 * Schickt CMD 0x04 (PATTERN) + CMD 0x0E (TRANSPORT) an den Sim. Der Sim
 * feuert Note-Ons im BPM-Raster, chord-Modul-Fan-Out macht aus jeder
 * Root einen Chord. Web-Audio spielt die Triads.
 *
 * Wenn nicht connected, sind alle Controls disabled.
 */

import { useEffect, useState, useCallback, type ReactElement } from "react";

import { omniTribeBridge } from "../../audio/OmniTribeBridge";

export interface StepSequencerPanelProps {
  /** Wenn false, sind alle Controls disabled. */
  connected: boolean;
}

const DEFAULT_BPM = 120;
const DEFAULT_ROOT = 60;

export function StepSequencerPanel({
  connected,
}: StepSequencerPanelProps): ReactElement {
  const [steps, setSteps] = useState<boolean[]>(() => Array(16).fill(false));
  const [playing, setPlaying] = useState<boolean>(false);
  const [bpm, setBpm] = useState<number>(DEFAULT_BPM);
  const [root, setRoot] = useState<number>(DEFAULT_ROOT);

  const stepMask = steps.reduce(
    (m, on, i) => (on ? m | (1 << i) : m),
    0,
  );

  // Sync Pattern-State zum Sim wann immer sich Maske aendert
  useEffect(() => {
    if (!connected) return;
    omniTribeBridge.setPatternStepMask(stepMask);
  }, [stepMask, connected]);

  // Sync BPM
  useEffect(() => {
    if (!connected) return;
    omniTribeBridge.remoteTempo(bpm);
  }, [bpm, connected]);

  // Sync Root-Note
  useEffect(() => {
    if (!connected) return;
    omniTribeBridge.setPatternRootNote(root);
  }, [root, connected]);

  const toggleStep = useCallback((idx: number) => {
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
  }, []);

  const handlePreset = useCallback((mask: number) => {
    setSteps(Array.from({ length: 16 }, (_, i) => (mask & (1 << i)) !== 0));
  }, []);

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4 space-y-3"
      data-testid="step-sequencer-panel"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Sim Step-Sequencer</h3>
        <span className="text-[10px] text-text-dim">
          {connected ? "Live → Sim" : "Disconnected"}
        </span>
      </div>

      {/* 16-Step Grid */}
      <div
        className="grid grid-cols-16 gap-1"
        style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
        role="group"
        aria-label="Pattern steps"
      >
        {steps.map((on, i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggleStep(i)}
            disabled={!connected}
            data-testid={`step-${i}`}
            aria-label={`Step ${i + 1}`}
            aria-pressed={on}
            className={[
              "h-8 rounded border transition-colors text-[10px] font-mono",
              on
                ? "bg-accent-primary border-accent-primary text-bg-base"
                : "bg-bg-elevated border-border-color text-text-dim hover:text-text-muted",
              !connected && "opacity-40 cursor-not-allowed",
              // Beat-Highlight (Step 0, 4, 8, 12)
              i % 4 === 0 && !on && "border-text-dim",
            ].join(" ")}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Presets */}
      <div className="flex gap-1 text-[10px]">
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

      <p className="text-[10px] text-text-dim leading-snug">
        Steps anklicken, dann Play. Sim feuert Note-On pro aktivem Step im
        BPM-Raster. Mit aktiviertem chord-Modul (ChordPanel oben) fan-out
        zu Chord-Voices → Web-Audio.
      </p>
    </div>
  );
}
