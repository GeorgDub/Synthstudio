/**
 * ClockSyncPanel.tsx — Sprint-119c Clock-Sync-Control UI.
 *
 * Surfaciert Sprint-113 + Sprint-114 Features:
 *   - Clock-In-Mode: INTERNAL / EXTERNAL / AUTO
 *   - Clock-Status: Locked/Unlocked LED, gemessener BPM
 *   - Clock-Out: ON/OFF Toggle
 *   - Effective-Mode: OFF / MASTER / PASSTHROUGH label
 *
 * Bridge-Calls:
 *   - bridge.setClockSyncMode(mode)     CMD 0x0E SUB 0x04
 *   - bridge.queryClockStatus()         CMD 0x0E SUB 0x05
 *   - bridge.setClockOutEnable(enable)  CMD 0x0E SUB 0x07
 *   - bridge.queryClockOutStatus()      CMD 0x0E SUB 0x08
 *
 * Events:
 *   - omnitribe:clockStatus   { mode, locked, bpm, bpmX100 }
 *   - omnitribe:clockOutStatus { enable, effectiveMode }
 */

import { useEffect, useState, useCallback, type ReactElement } from "react";
import { omniTribeBridge } from "../../audio/OmniTribeBridge";

export type ClockInMode = 0 | 1 | 2;

const CLOCK_IN_MODES: { value: ClockInMode; label: string }[] = [
  { value: 0, label: "INTERNAL" },
  { value: 1, label: "EXTERNAL" },
  { value: 2, label: "AUTO" },
];

const EFFECTIVE_MODE_LABELS: Record<number, string> = {
  0: "OFF",
  1: "MASTER",
  2: "PASSTHROUGH",
};

export interface ClockSyncPanelProps {
  connected: boolean;
}

export function ClockSyncPanel({ connected }: ClockSyncPanelProps): ReactElement {
  const [clockInMode, setClockInMode] = useState<ClockInMode>(0);
  const [locked, setLocked] = useState<boolean>(false);
  const [bpm, setBpm] = useState<number>(0);
  const [clockOutEnabled, setClockOutEnabled] = useState<boolean>(false);
  const [effectiveMode, setEffectiveMode] = useState<number>(0);

  // Listen for clock status from device
  useEffect(() => {
    const onClockStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        mode: number;
        locked: boolean;
        bpm: number;
        bpmX100: number;
      };
      setClockInMode((detail.mode & 0x7F) as ClockInMode);
      setLocked(detail.locked);
      setBpm(detail.bpm);
    };

    const onClockOutStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        enable: boolean;
        effectiveMode: number;
      };
      setClockOutEnabled(detail.enable);
      setEffectiveMode(detail.effectiveMode);
    };

    window.addEventListener("omnitribe:clockStatus", onClockStatus);
    window.addEventListener("omnitribe:clockOutStatus", onClockOutStatus);

    // Initial query on mount if connected
    if (connected) {
      omniTribeBridge.queryClockStatus();
      omniTribeBridge.queryClockOutStatus();
    }

    return () => {
      window.removeEventListener("omnitribe:clockStatus", onClockStatus);
      window.removeEventListener("omnitribe:clockOutStatus", onClockOutStatus);
    };
  }, [connected]);

  const handleModeChange = useCallback(
    (mode: ClockInMode) => {
      if (!connected) return;
      setClockInMode(mode);
      omniTribeBridge.setClockSyncMode(mode);
    },
    [connected],
  );

  const handleClockOutToggle = useCallback(() => {
    if (!connected) return;
    const next = !clockOutEnabled;
    setClockOutEnabled(next);
    omniTribeBridge.setClockOutEnable(next);
  }, [connected, clockOutEnabled]);

  const handleRefresh = useCallback(() => {
    if (!connected) return;
    omniTribeBridge.queryClockStatus();
    omniTribeBridge.queryClockOutStatus();
  }, [connected]);

  return (
    <div
      className="bg-bg-panel border border-border-color rounded p-4 space-y-3"
      data-testid="clock-sync-panel"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Clock Sync</h3>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={!connected}
          data-testid="clock-sync-refresh"
          className="text-[10px] px-2 py-0.5 rounded bg-bg-elevated border border-border-color text-text-muted hover:text-text-primary disabled:opacity-40"
          aria-label="Refresh clock status"
        >
          Refresh
        </button>
      </div>

      {/* Clock-In Mode */}
      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-text-dim">
          Clock-In Mode
        </span>
        <div
          className="flex gap-1"
          role="radiogroup"
          aria-label="Clock-In Mode"
        >
          {CLOCK_IN_MODES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={clockInMode === value}
              disabled={!connected}
              onClick={() => handleModeChange(value)}
              data-testid={`clock-mode-${value}`}
              className={[
                "flex-1 px-2 py-1 rounded text-[10px] font-mono border transition-colors",
                clockInMode === value
                  ? "bg-accent-primary text-bg-base border-accent-primary"
                  : "bg-bg-elevated border-border-color text-text-muted hover:text-text-primary",
                !connected && "opacity-40 cursor-not-allowed",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Clock Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            data-testid="clock-locked-indicator"
            aria-label={locked ? "Clock locked" : "Clock unlocked"}
            className={[
              "w-3 h-3 rounded-full border-2 transition-colors",
              locked
                ? "bg-accent-success border-accent-success shadow-[0_0_4px] shadow-accent-success/60"
                : "bg-bg-elevated border-border-color",
            ].join(" ")}
          />
          <span className="text-[10px] text-text-muted">
            {locked ? "Locked" : "Unlocked"}
          </span>
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[10px] text-text-dim">BPM</span>
          <span
            className="text-[11px] font-mono text-text-primary w-12 text-right"
            data-testid="clock-bpm-display"
          >
            {bpm > 0 ? bpm.toFixed(1) : "--"}
          </span>
        </div>
      </div>

      {/* Clock-Out Toggle */}
      <div className="flex items-center justify-between border-t border-border-color pt-2">
        <div className="space-y-0.5">
          <span className="text-[10px] uppercase tracking-wide text-text-dim block">
            Clock Out
          </span>
          <span className="text-[10px] text-text-dim">
            Effective: {EFFECTIVE_MODE_LABELS[effectiveMode] ?? "?"}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={clockOutEnabled}
          aria-label="Clock Out Enable"
          disabled={!connected}
          onClick={handleClockOutToggle}
          data-testid="clock-out-toggle"
          className={[
            "px-3 py-1 rounded text-[10px] font-bold border transition-colors",
            clockOutEnabled
              ? "bg-accent-success/20 border-accent-success text-accent-success"
              : "bg-bg-elevated border-border-color text-text-muted",
            !connected && "opacity-40 cursor-not-allowed",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {clockOutEnabled ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
}
