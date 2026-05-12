/**
 * Synthstudio – SessionRecorder
 *
 * UI-Panel für die Session-Aufzeichnung und Wiedergabe.
 * Zeigt Record-Button, Event-Zähler, Dauer und Playback-Steuerung.
 */
import React, { useCallback } from "react";
import {
  useSessionRecordingStore,
  startRecording,
  stopRecording,
  startPlayback,
  stopPlayback,
  clearRecording,
} from "@/store/useSessionRecordingStore";

interface SessionRecorderProps {
  broadcast: (event: Record<string, unknown>) => void;
  inSession: boolean;
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

export function SessionRecorder({ broadcast, inSession }: SessionRecorderProps) {
  const rec = useSessionRecordingStore();

  const handleRecord = useCallback(() => {
    if (rec.isRecording) stopRecording();
    else startRecording();
  }, [rec.isRecording]);

  const handlePlayback = useCallback(() => {
    if (rec.isPlaying) stopPlayback();
    else startPlayback(broadcast);
  }, [rec.isPlaying, broadcast]);

  return (
    <div className="rounded-xl border border-border-color bg-bg-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Session Recording</span>
        {rec.isRecording && (
          <span className="flex items-center gap-1 text-[10px] text-accent-danger">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-danger animate-pulse" />
            Aufnahme läuft
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[11px]">
        <div>
          <div className="text-text-dim">Events</div>
          <div className="font-mono text-text-primary">{rec.events.length}</div>
        </div>
        <div>
          <div className="text-text-dim">Dauer</div>
          <div className="font-mono text-text-primary">
            {rec.isRecording && rec.startTime
              ? "live"
              : rec.duration > 0
                ? formatMs(rec.duration)
                : "–"}
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 flex-wrap">
        {/* Record */}
        <button
          onClick={handleRecord}
          disabled={!inSession}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors disabled:opacity-40",
            rec.isRecording
              ? "bg-accent-danger text-white"
              : "bg-bg-elevated text-text-muted hover:bg-accent-danger/20 hover:text-accent-danger border border-border-color",
          ].join(" ")}
          title={inSession ? undefined : "Nur in einer aktiven Session verfügbar"}
        >
          {rec.isRecording ? "■ Stop" : "● Aufnahme"}
        </button>

        {/* Playback */}
        <button
          onClick={handlePlayback}
          disabled={rec.events.length === 0 || rec.isRecording}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-colors disabled:opacity-40",
            rec.isPlaying
              ? "bg-accent-primary text-white animate-pulse"
              : "bg-bg-elevated text-text-muted hover:bg-accent-primary/20 hover:text-accent-primary border border-border-color",
          ].join(" ")}
        >
          {rec.isPlaying ? "■ Stop" : "▶ Wiedergabe"}
        </button>

        {/* Clear */}
        <button
          onClick={clearRecording}
          disabled={rec.events.length === 0 && !rec.isRecording}
          className="px-3 py-1.5 rounded text-xs text-text-dim hover:text-accent-danger transition-colors disabled:opacity-40 border border-border-color"
        >
          Löschen
        </button>
      </div>

      <p className="text-[10px] text-text-dim">
        {inSession
          ? "Alle Collab-Events werden aufgezeichnet und können wiederholt werden."
          : "Session-Recording ist nur während einer aktiven Kollaborations-Session verfügbar."}
      </p>
    </div>
  );
}
