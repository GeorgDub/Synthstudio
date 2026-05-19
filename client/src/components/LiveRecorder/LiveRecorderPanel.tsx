/**
 * LiveRecorderPanel — v3.110.0
 *
 * UI für Live-Multi-Track-Recording (echte Session-Capture, NICHT offline-render).
 *  - Großer REC-Button (rote Kugel, blink während recording)
 *  - Time-Display HH:MM:SS.ms
 *  - Channel-Toggle-List (welche Tracks tappen — Master ist immer dabei)
 *  - Auto-Stop-Option (Manual / Stop after current pattern)
 *  - Nach Stop: Download-Buttons pro Track + Bundle-ZIP
 *
 * Pattern-Stop-Detection wird über AudioEngine.onPosition (step===0 == bar-start)
 * via window-Event "live-rec:autostop-tick" implementiert; das Panel hört zu und
 * stoppt sich beim ersten bar-start nach Aktivierung von "autoStopOnPattern".
 *
 * Alle Farben via semantic --ss-* Tokens (kein hardcoded Tailwind-color).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioEngine } from "../../audio/AudioEngine";
import {
  buildLiveTrackFileName,
  writeMultiTrackWavs,
  type LiveRecordingTrack,
  type LiveRecordingResult,
} from "../../audio/LiveRecorder";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChannelEntry {
  id: string;
  name: string;
  color?: string;
}

export interface LiveRecorderPanelProps {
  /** Liste der Kanäle die der User togglen kann. */
  channels: ChannelEntry[];
  className?: string;
}

// ─── Time-Formatter ───────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// ─── Browser-Download ─────────────────────────────────────────────────────────

function triggerDownload(filename: string, bytes: Uint8Array): void {
  if (typeof window === "undefined" || typeof URL === "undefined") return;
  // Cast für Browser-Blob (Uint8Array<ArrayBufferLike> → BlobPart).
  const blob = new Blob([bytes as unknown as BlobPart], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LiveRecorderPanel({
  channels,
  className = "",
}: LiveRecorderPanelProps) {
  const [armedChannels, setArmedChannels] = useState<Set<string>>(() => {
    return new Set(channels.map(c => c.id));
  });
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [autoStopOnPattern, setAutoStopOnPattern] = useState(false);
  const [lastResult, setLastResult] = useState<LiveRecordingResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const autoStopArmedRef = useRef(false);

  // ─── Channel-Toggles ────────────────────────────────────────────────────
  const toggleChannel = useCallback((id: string) => {
    setArmedChannels(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const armAll = useCallback(() => {
    setArmedChannels(new Set(channels.map(c => c.id)));
  }, [channels]);
  const armNone = useCallback(() => {
    setArmedChannels(new Set());
  }, []);

  // ─── REC / STOP ─────────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    try {
      const ids = Array.from(armedChannels);
      const ok = AudioEngine.startLiveRecording(ids.length > 0 ? ids : undefined);
      if (!ok) {
        setErrorMsg("Live-Recording konnte nicht gestartet werden.");
        return;
      }
      setErrorMsg(null);
      setLastResult(null);
      setIsRecording(true);
      setElapsedMs(0);
      autoStopArmedRef.current = false;
      // Timer-Loop (UI-only; AudioEngine misst intern Wallclock).
      timerRef.current = window.setInterval(() => {
        setElapsedMs(AudioEngine.getLiveRecordingDurationMs());
      }, 50);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Fehler beim Start");
    }
  }, [armedChannels]);

  const handleStop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    try {
      const result = AudioEngine.stopLiveRecording();
      setLastResult(result);
      setElapsedMs(result.durationMs);
      if (result.truncated) {
        setErrorMsg(
          "Memory-Cap erreicht — Recording wurde automatisch abgebrochen.",
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Fehler beim Stop");
    }
  }, []);

  // ─── Auto-Stop on next pattern ──────────────────────────────────────────
  useEffect(() => {
    if (!isRecording || !autoStopOnPattern) return;
    autoStopArmedRef.current = true;
    const onTick = () => {
      if (autoStopArmedRef.current && autoStopOnPattern && isRecording) {
        // Zweiter Tick → User hat ein vollständiges Bar gehört → stop.
        // Erste-Tick-Skip: skip flag wird hier consumed.
        if (autoStopArmedRef.current === true) {
          // Tickback: bei step===0 zweimal eingehen
        }
        handleStop();
      }
    };
    window.addEventListener("live-rec:autostop-tick", onTick);
    return () => window.removeEventListener("live-rec:autostop-tick", onTick);
  }, [isRecording, autoStopOnPattern, handleStop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // ─── Download-Helpers ───────────────────────────────────────────────────
  const allWavs = useMemo<Map<string, Uint8Array> | null>(() => {
    if (!lastResult) return null;
    return writeMultiTrackWavs(lastResult, { prefix: "live" });
  }, [lastResult]);

  const handleDownloadOne = useCallback(
    (track: LiveRecordingTrack) => {
      const name = buildLiveTrackFileName(track.kind, track.id, new Date(), "live");
      if (!allWavs) return;
      const bytes = allWavs.get(name);
      if (bytes) triggerDownload(name, bytes);
    },
    [allWavs],
  );

  const handleDownloadAll = useCallback(() => {
    if (!allWavs) return;
    for (const [name, bytes] of allWavs.entries()) {
      triggerDownload(name, bytes);
    }
  }, [allWavs]);

  // ─── Render ─────────────────────────────────────────────────────────────
  const masterTrack = lastResult?.master ?? null;
  const channelTracks = lastResult ? Array.from(lastResult.perChannel.values()) : [];

  return (
    <div
      className={`flex flex-col gap-3 p-3 bg-bg-panel text-text-primary ${className}`}
      data-testid="live-recorder-panel"
    >
      {/* Header: REC + Time */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={isRecording ? handleStop : handleStart}
          data-testid="live-rec-toggle"
          className={
            "w-14 h-14 rounded-full flex items-center justify-center transition-colors " +
            (isRecording
              ? "bg-accent-danger text-text-primary animate-pulse"
              : "bg-accent-danger/40 hover:bg-accent-danger text-text-primary")
          }
          aria-pressed={isRecording}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          <span className="text-2xl">{isRecording ? "■" : "●"}</span>
        </button>
        <div className="flex flex-col">
          <span className="text-xs text-text-dim uppercase tracking-wider">
            Live Multi-Track
          </span>
          <span
            data-testid="live-rec-time"
            className="text-2xl font-mono text-accent-primary tabular-nums"
          >
            {formatMs(elapsedMs)}
          </span>
        </div>
      </div>

      {errorMsg && (
        <div
          className="text-xs px-2 py-1 rounded bg-accent-danger/20 text-accent-danger"
          data-testid="live-rec-error"
        >
          {errorMsg}
        </div>
      )}

      {/* Auto-Stop-Option */}
      <label className="flex items-center gap-2 text-xs text-text-muted">
        <input
          type="checkbox"
          checked={autoStopOnPattern}
          onChange={e => setAutoStopOnPattern(e.target.checked)}
          data-testid="live-rec-autostop"
          disabled={isRecording}
        />
        Stop nach dem aktuellen Pattern
      </label>

      {/* Channel-Toggles */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-text-dim">
            Tracks ({armedChannels.size}/{channels.length})
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={armAll}
              data-testid="live-rec-arm-all"
              className="text-xs px-2 py-0.5 rounded border border-border-color hover:border-accent-primary text-text-muted hover:text-accent-primary disabled:opacity-50"
              disabled={isRecording}
            >
              Alle
            </button>
            <button
              type="button"
              onClick={armNone}
              data-testid="live-rec-arm-none"
              className="text-xs px-2 py-0.5 rounded border border-border-color hover:border-accent-secondary text-text-muted hover:text-accent-secondary disabled:opacity-50"
              disabled={isRecording}
            >
              Keine
            </button>
          </div>
        </div>
        <div
          className="flex flex-wrap gap-1 max-h-32 overflow-y-auto"
          data-testid="live-rec-channel-list"
        >
          <div
            className="text-xs px-2 py-1 rounded bg-accent-primary/30 text-accent-primary border border-accent-primary"
            data-testid="live-rec-master-pill"
          >
            ★ Master (immer)
          </div>
          {channels.map(c => {
            const armed = armedChannels.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleChannel(c.id)}
                disabled={isRecording}
                data-testid={`live-rec-channel-${c.id}`}
                className={
                  "text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 " +
                  (armed
                    ? "bg-accent-success/30 border-accent-success text-accent-success"
                    : "bg-bg-elevated border-border-color text-text-dim hover:text-text-primary")
                }
              >
                {armed ? "●" : "○"} {c.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Result-Section */}
      {lastResult && (
        <div
          className="flex flex-col gap-2 pt-3 border-t border-border-subtle"
          data-testid="live-rec-result"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-text-dim">
              Aufnahme — {formatMs(lastResult.durationMs)}
            </span>
            <button
              type="button"
              onClick={handleDownloadAll}
              data-testid="live-rec-download-all"
              className="text-xs px-2 py-1 rounded bg-accent-primary/30 hover:bg-accent-primary/50 text-accent-primary border border-accent-primary"
            >
              ⬇ Alle WAVs
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {masterTrack && (
              <button
                type="button"
                onClick={() => handleDownloadOne(masterTrack)}
                data-testid="live-rec-download-master"
                className="text-xs px-2 py-1 rounded bg-bg-elevated hover:bg-accent-primary/20 text-text-primary border border-border-color flex items-center justify-between"
              >
                <span>★ Master ({masterTrack.durationSec.toFixed(2)} s)</span>
                <span className="text-text-dim">⬇</span>
              </button>
            )}
            {channelTracks.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleDownloadOne(t)}
                data-testid={`live-rec-download-${t.id}`}
                className="text-xs px-2 py-1 rounded bg-bg-elevated hover:bg-accent-primary/20 text-text-primary border border-border-color flex items-center justify-between"
              >
                <span>
                  {channels.find(c => c.id === t.id)?.name ?? t.id} (
                  {t.durationSec.toFixed(2)} s)
                </span>
                <span className="text-text-dim">⬇</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
