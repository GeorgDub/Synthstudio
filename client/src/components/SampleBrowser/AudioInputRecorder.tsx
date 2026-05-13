/**
 * Synthstudio – AudioInputRecorder (post-v1.32.0 UX-Polish)
 *
 * Kompaktes Recording-Panel für den Sample-Browser.
 * Nimmt Mikrofon/Line-in auf und fügt das Ergebnis als neues Sample hinzu.
 *
 * Neue Features (post-v1.32.0):
 *  - Device-Picker (Dropdown) wenn mehrere Audio-Inputs verfügbar
 *  - Live-Duration-Timer (mm:ss) während Aufnahme
 *  - Pending-Sample Dialog nach Stop: User gibt Custom-Namen ein oder verwirft
 *    den Take, bevor er als Sample registriert wird
 */
import React, { useState, useEffect } from "react";
import { useAudioInput, formatRecordingDuration } from "@/hooks/useAudioInput";
import type { Sample } from "@/store/useProjectStore";

interface AudioInputRecorderProps {
  onSamplesAdded: (samples: Sample[]) => void;
}

function VuBar({ level }: { level: number }) {
  return (
    <div className="flex gap-px h-3 items-end" data-testid="audio-input-vu">
      {Array.from({ length: 12 }, (_, i) => {
        const threshold = (i + 1) / 12;
        const active = level >= threshold;
        const color = i >= 10 ? "#ef4444" : i >= 8 ? "#f59e0b" : "var(--ss-accent-success)";
        return (
          <div key={i} className="flex-1 rounded-sm transition-all"
            style={{ height: active ? "100%" : "20%", background: active ? color : "var(--ss-bg-elevated)", opacity: active ? 1 : 0.4 }} />
        );
      })}
    </div>
  );
}

export function AudioInputRecorder({ onSamplesAdded }: AudioInputRecorderProps) {
  const {
    start,
    stop,
    isRecording,
    isAvailable,
    level,
    error,
    recordingDurationMs,
    availableDevices,
    deviceId,
    setDeviceId,
    pendingSample,
    confirmPendingSample,
    discardPendingSample,
  } = useAudioInput({
    onSample: (url, name, durationSec) => {
      const sample: Sample = {
        id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        path: url,
        category: "Recording",
        tags: ["recording", "live"],
        size: 0,
      };
      onSamplesAdded([sample]);
      void durationSec;
    },
  });

  // Local edit state for the rename dialog
  const [pendingName, setPendingName] = useState("");
  useEffect(() => {
    if (pendingSample) setPendingName(pendingSample.defaultName);
  }, [pendingSample]);

  if (!isAvailable) return null;

  // ─── Rename-Dialog (Phase nach Stop, vor Save) ─────────────────────────────
  if (pendingSample) {
    return (
      <div
        className="px-3 py-2 border-b border-border-color bg-bg-panel space-y-2"
        data-testid="audio-input-pending"
      >
        <div className="text-[10px] uppercase tracking-wider text-text-dim flex items-center gap-2">
          <span>Aufnahme fertig</span>
          <span className="font-mono text-text-muted">
            {pendingSample.durationSec.toFixed(1)}s
          </span>
        </div>
        <input
          type="text"
          value={pendingName}
          onChange={(e) => setPendingName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmPendingSample(pendingName);
            if (e.key === "Escape") discardPendingSample();
          }}
          autoFocus
          placeholder="Sample-Name…"
          data-testid="audio-input-name"
          className="w-full bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded border border-border-color focus:border-accent-primary outline-none"
        />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => confirmPendingSample(pendingName)}
            data-testid="audio-input-save"
            className="flex-1 px-2 py-1 text-[10px] rounded bg-accent-success/30 text-accent-success border border-accent-success/60 hover:bg-accent-success/50 font-medium"
          >
            ✓ Speichern
          </button>
          <button
            type="button"
            onClick={discardPendingSample}
            data-testid="audio-input-discard"
            className="px-2 py-1 text-[10px] rounded bg-bg-elevated text-text-dim hover:text-accent-danger border border-border-color"
          >
            ✕ Verwerfen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 border-b border-border-color bg-bg-panel space-y-1.5">
      <div className="flex items-center gap-2">
        {/* Record Button */}
        <button
          onClick={isRecording ? stop : start}
          data-testid="audio-input-record-toggle"
          className={[
            "flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded font-bold transition-colors flex-shrink-0",
            isRecording
              ? "bg-accent-danger text-bg-base animate-pulse"
              : "bg-bg-elevated text-text-muted hover:text-accent-danger border border-border-color",
          ].join(" ")}
          title={isRecording ? "Aufnahme stoppen" : "Mikrofon aufnehmen"}
        >
          {isRecording ? "■ Stop" : "● Aufnahme"}
        </button>

        {/* VU Bar während Recording */}
        {isRecording && (
          <div className="flex-1 flex items-center gap-2">
            <VuBar level={level} />
            <span className="text-[10px] font-mono text-accent-danger flex-shrink-0" data-testid="audio-input-timer">
              {formatRecordingDuration(recordingDurationMs)}
            </span>
          </div>
        )}

        {!isRecording && (
          <span className="text-[10px] text-text-dim flex-1">
            {error ? <span className="text-accent-danger">{error}</span> : "Mikrofon → Sample"}
          </span>
        )}
      </div>

      {/* Device Picker — nur wenn mehrere Inputs verfügbar UND nicht recording */}
      {!isRecording && availableDevices.length > 1 && (
        <select
          value={deviceId ?? ""}
          onChange={(e) => setDeviceId(e.target.value || undefined)}
          data-testid="audio-input-device-picker"
          className="w-full bg-bg-elevated text-text-muted text-[10px] px-2 py-1 rounded border border-border-color focus:border-accent-primary outline-none"
          title="Audio-Eingang wählen"
        >
          <option value="">System-Standard</option>
          {availableDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
