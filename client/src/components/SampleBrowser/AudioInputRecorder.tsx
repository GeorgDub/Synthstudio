/**
 * Synthstudio – AudioInputRecorder
 *
 * Kompaktes Recording-Panel für den Sample-Browser.
 * Nimmt Mikrofon/Line-in auf und fügt das Ergebnis als neues Sample hinzu.
 */
import React from "react";
import { useAudioInput } from "@/hooks/useAudioInput";
import type { Sample } from "@/store/useProjectStore";

interface AudioInputRecorderProps {
  onSamplesAdded: (samples: Sample[]) => void;
}

function VuBar({ level }: { level: number }) {
  return (
    <div className="flex gap-px h-3 items-end">
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
  const { start, stop, isRecording, isAvailable, level, error } = useAudioInput({
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
    },
  });

  if (!isAvailable) return null;

  return (
    <div className="px-3 py-2 border-b border-border-color bg-bg-panel">
      <div className="flex items-center gap-2">
        {/* Record Button */}
        <button
          onClick={isRecording ? stop : start}
          className={[
            "flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded font-bold transition-colors flex-shrink-0",
            isRecording
              ? "bg-accent-danger text-white animate-pulse"
              : "bg-bg-elevated text-text-muted hover:text-accent-danger border border-border-color",
          ].join(" ")}
          title={isRecording ? "Aufnahme stoppen" : "Mikrofon aufnehmen"}
        >
          {isRecording ? "■ Stop" : "● Aufnahme"}
        </button>

        {/* VU Bar */}
        {isRecording && (
          <div className="flex-1">
            <VuBar level={level} />
          </div>
        )}

        {!isRecording && (
          <span className="text-[10px] text-text-dim flex-1">
            {error ? <span className="text-accent-danger">{error}</span> : "Mikrofon → Sample"}
          </span>
        )}
      </div>
    </div>
  );
}
