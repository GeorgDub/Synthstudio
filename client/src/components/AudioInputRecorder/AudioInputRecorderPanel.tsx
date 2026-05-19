/**
 * AudioInputRecorderPanel — v3.113.0
 *
 * UI für External-Audio-Input-Recording (Mic / Synth-Line / KORG-Sampler-Out).
 *
 *  - Device-Picker-Dropdown (refreshable)
 *  - "Connect"-Button → permission-prompt von navigator.mediaDevices.getUserMedia
 *  - Level-Meter (RMS dB, peak-hold via requestAnimationFrame)
 *  - "Record" / "Stop" Buttons (rote LED + Pulse-Animation während Recording)
 *  - Monitor-Toggle + Gain-Slider (0..1)
 *  - Input-Gain-Slider (0..2)
 *  - Routing-Picker (master / live-recorder / both)
 *  - Nach Stop: Preview (Download-WAV + Filename-Auto-Timestamp)
 *  - Error-State wenn Permission verweigert
 *  - Red-Dot-Indikator wenn Mic aktiv (Security-Visibility)
 *
 * Alle Farben via semantic --ss-* Tokens (kein hardcoded Tailwind-color).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioEngine } from "../../audio/AudioEngine";
import {
  type AudioInputDeviceInfo,
  type AudioInputRecordingResult,
  AUDIO_INPUT_SILENCE_DB,
} from "../../audio/AudioInputRecorder";
import {
  useAudioInputStore,
  type AudioInputRoute,
} from "../../store/useAudioInputStore";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + "_" +
    pad(d.getHours()) + "-" +
    pad(d.getMinutes()) + "-" +
    pad(d.getSeconds())
  );
}

function triggerDownload(filename: string, bytes: Uint8Array): void {
  if (typeof window === "undefined" || typeof URL === "undefined") return;
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

/** Map dB-Pegel auf [0..1] für Level-Meter (von -60 .. 0 dB als Active-Range). */
function dbToMeterPercent(db: number): number {
  if (db <= AUDIO_INPUT_SILENCE_DB) return 0;
  const min = -60;
  const max = 0;
  const clamped = Math.max(min, Math.min(max, db));
  return (clamped - min) / (max - min);
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface AudioInputRecorderPanelProps {
  className?: string;
}

export function AudioInputRecorderPanel({ className = "" }: AudioInputRecorderPanelProps) {
  const store = useAudioInputStore();

  const [devices, setDevices] = useState<AudioInputDeviceInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levelDb, setLevelDb] = useState(AUDIO_INPUT_SILENCE_DB);
  const [peakDb, setPeakDb] = useState(AUDIO_INPUT_SILENCE_DB);
  const [lastResult, setLastResult] = useState<AudioInputRecordingResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakDecayRef = useRef<number>(0);

  // ─── Device-Enumeration ──────────────────────────────────────────────────
  const refreshDevices = useCallback(async () => {
    try {
      const recorder = AudioEngine.__getAudioInputRecorderForTests();
      const list = await recorder.enumerateDevices();
      setDevices(list);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    // Devicechange-Event (browser fires when USB-Mic plugged/unplugged).
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
      const handler = () => { void refreshDevices(); };
      navigator.mediaDevices.addEventListener("devicechange", handler);
      return () => {
        try { navigator.mediaDevices.removeEventListener("devicechange", handler); } catch { /* ignore */ }
      };
    }
    return undefined;
  }, [refreshDevices]);

  // ─── Connect / Disconnect ────────────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    setErrorMsg(null);
    setPermissionDenied(false);
    const deviceId = store.selectedDeviceId;
    if (!deviceId) {
      setErrorMsg("Bitte zuerst ein Audio-Input-Device auswählen.");
      return;
    }
    try {
      await AudioEngine.connectAudioInput(deviceId);
      AudioEngine.setAudioInputGain(store.inputGain);
      AudioEngine.setAudioInputMonitor(store.monitorEnabled ? store.monitorGain : 0);
      AudioEngine.setAudioInputRoute(store.route);
      setConnected(true);
      // Nach erstem Connect haben Labels nun echte Werte → re-fetch.
      void refreshDevices();
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setPermissionDenied(true);
        setErrorMsg("Mikrofon-Zugriff verweigert. Bitte in den Browser-Einstellungen erlauben.");
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Connect fehlgeschlagen");
      }
      setConnected(false);
    }
  }, [store.selectedDeviceId, store.inputGain, store.monitorEnabled, store.monitorGain, store.route, refreshDevices]);

  const handleDisconnect = useCallback(() => {
    if (isRecording) {
      try { AudioEngine.stopAudioInputRecording(); } catch { /* ignore */ }
      setIsRecording(false);
    }
    AudioEngine.disconnectAudioInput();
    setConnected(false);
    setLevelDb(AUDIO_INPUT_SILENCE_DB);
    setPeakDb(AUDIO_INPUT_SILENCE_DB);
  }, [isRecording]);

  // ─── Settings-Sync (Store → Engine) ──────────────────────────────────────
  useEffect(() => {
    if (!connected) return;
    AudioEngine.setAudioInputGain(store.inputGain);
  }, [connected, store.inputGain]);

  useEffect(() => {
    if (!connected) return;
    AudioEngine.setAudioInputMonitor(store.monitorEnabled ? store.monitorGain : 0);
  }, [connected, store.monitorEnabled, store.monitorGain]);

  useEffect(() => {
    if (!connected) return;
    AudioEngine.setAudioInputRoute(store.route);
  }, [connected, store.route]);

  // ─── Level-Meter (rAF) ───────────────────────────────────────────────────
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      try {
        const db = AudioEngine.getAudioInputLevel();
        setLevelDb(db);
        // Peak-Hold mit langsamem Decay.
        const now = Date.now();
        if (db > peakDecayRef.current || now > peakDecayRef.current + 500) {
          peakDecayRef.current = now;
          setPeakDb(prev => Math.max(prev - 0.5, db));
        }
      } catch { /* ignore */ }
      rafRef.current = typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame(tick)
        : null;
    };
    rafRef.current = typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(tick)
      : null;
    return () => {
      cancelled = true;
      if (rafRef.current !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
    };
  }, [connected]);

  // ─── Recording-Lifecycle ─────────────────────────────────────────────────
  const handleStartRecord = useCallback(() => {
    if (!connected) {
      setErrorMsg("Bitte zuerst Connect aufrufen.");
      return;
    }
    setErrorMsg(null);
    setLastResult(null);
    const ok = AudioEngine.startAudioInputRecording();
    if (!ok) {
      setErrorMsg("Recording konnte nicht gestartet werden.");
      return;
    }
    setIsRecording(true);
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => {
      setElapsedMs(AudioEngine.getAudioInputRecordingDurationMs());
    }, 50);
  }, [connected]);

  const handleStopRecord = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    try {
      const result = AudioEngine.stopAudioInputRecording();
      setLastResult(result);
      setElapsedMs(result.durationMs);
      if (result.truncated) {
        setErrorMsg("Memory-Cap erreicht — Recording automatisch abgebrochen.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Stop fehlgeschlagen");
    }
  }, []);

  // ─── Transport-Sync ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!store.recordSyncWithTransport || !connected) return;
    const onPlay = () => {
      if (!isRecording) handleStartRecord();
    };
    const onStop = () => {
      if (isRecording) handleStopRecord();
    };
    window.addEventListener("transport:play", onPlay);
    window.addEventListener("transport:stop", onStop);
    return () => {
      window.removeEventListener("transport:play", onPlay);
      window.removeEventListener("transport:stop", onStop);
    };
  }, [store.recordSyncWithTransport, connected, isRecording, handleStartRecord, handleStopRecord]);

  // ─── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (rafRef.current !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // ─── Download / Add-to-Library ───────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!lastResult || lastResult.wavBytes.length === 0) return;
    const name = `input_${formatTimestamp(new Date())}.wav`;
    triggerDownload(name, lastResult.wavBytes);
  }, [lastResult]);

  const handleAddToLibrary = useCallback(() => {
    // Hook für späteren Sample-Library-Wiring (v3.114+).
    if (!lastResult || lastResult.wavBytes.length === 0) return;
    try {
      window.dispatchEvent(new CustomEvent("audio-input:add-to-library", {
        detail: {
          wavBytes: lastResult.wavBytes,
          sampleRate: lastResult.sampleRate,
          durationMs: lastResult.durationMs,
          channels: lastResult.channels,
        },
      }));
      setErrorMsg(null);
    } catch { /* ignore */ }
  }, [lastResult]);

  // ─── Render ─────────────────────────────────────────────────────────────
  const meterFill = dbToMeterPercent(levelDb);
  const peakFill = dbToMeterPercent(peakDb);

  return (
    <div
      className={`flex flex-col gap-3 p-3 bg-bg-panel text-text-primary ${className}`}
      data-testid="audio-input-recorder-panel"
    >
      {/* Header: Title + Live-Indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-text-dim">
            External Audio Input
          </span>
          {connected && (
            <span
              data-testid="audio-input-active-dot"
              className="inline-block w-2 h-2 rounded-full bg-accent-danger animate-pulse"
              title="Mikrofon aktiv"
              aria-label="Mikrofon aktiv"
            />
          )}
        </div>
        <button
          type="button"
          onClick={refreshDevices}
          data-testid="audio-input-refresh-devices"
          className="text-xs px-2 py-0.5 rounded border border-border-color hover:border-accent-primary text-text-muted hover:text-accent-primary"
        >
          ⟲ Refresh
        </button>
      </div>

      {/* Device-Picker */}
      <div className="flex items-center gap-2">
        <select
          value={store.selectedDeviceId ?? ""}
          onChange={e => store.setDevice(e.target.value || null)}
          disabled={connected}
          data-testid="audio-input-device-select"
          className="flex-1 text-xs px-2 py-1 rounded bg-bg-elevated text-text-primary border border-border-color disabled:opacity-50"
        >
          <option value="">— Device auswählen —</option>
          {devices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        {!connected ? (
          <button
            type="button"
            onClick={handleConnect}
            disabled={!store.selectedDeviceId}
            data-testid="audio-input-connect"
            className="text-xs px-3 py-1 rounded bg-accent-primary/30 hover:bg-accent-primary/50 text-accent-primary border border-accent-primary disabled:opacity-50"
          >
            Connect
          </button>
        ) : (
          <button
            type="button"
            onClick={handleDisconnect}
            data-testid="audio-input-disconnect"
            className="text-xs px-3 py-1 rounded bg-accent-danger/30 hover:bg-accent-danger/50 text-accent-danger border border-accent-danger"
          >
            Disconnect
          </button>
        )}
      </div>

      {/* Error-Banner */}
      {errorMsg && (
        <div
          className="text-xs px-2 py-1 rounded bg-accent-danger/20 text-accent-danger"
          data-testid="audio-input-error"
        >
          {errorMsg}
          {permissionDenied && (
            <div className="mt-1 text-text-muted">
              Tipp: Im Browser auf das Schloss-Symbol in der Adressleiste klicken
              und Mikrofon-Zugriff für diese Seite erlauben.
            </div>
          )}
        </div>
      )}

      {/* Level-Meter */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-text-dim">Level</span>
          <span
            data-testid="audio-input-level-db"
            className="text-xs font-mono text-text-muted tabular-nums"
          >
            {levelDb <= AUDIO_INPUT_SILENCE_DB ? "-∞" : levelDb.toFixed(1)} dB
          </span>
        </div>
        <div
          className="relative h-3 bg-bg-elevated rounded overflow-hidden border border-border-subtle"
          data-testid="audio-input-level-meter"
        >
          <div
            className="absolute left-0 top-0 bottom-0 bg-accent-success transition-all duration-75"
            style={{ width: `${meterFill * 100}%` }}
          />
          {peakFill > 0 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-accent-primary"
              style={{ left: `${peakFill * 100}%` }}
            />
          )}
        </div>
      </div>

      {/* REC / STOP */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={isRecording ? handleStopRecord : handleStartRecord}
          disabled={!connected}
          data-testid="audio-input-rec-toggle"
          className={
            "w-14 h-14 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 " +
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
            Input Recording
          </span>
          <span
            data-testid="audio-input-time"
            className="text-2xl font-mono text-accent-primary tabular-nums"
          >
            {formatMs(elapsedMs)}
          </span>
        </div>
      </div>

      {/* Settings: Monitor + Gain + Route + Sync */}
      <div className="flex flex-col gap-2 pt-2 border-t border-border-subtle">
        {/* Monitor */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={store.monitorEnabled}
              onChange={e => store.setMonitorEnabled(e.target.checked)}
              data-testid="audio-input-monitor-toggle"
            />
            Monitor (Hör-Through)
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={store.monitorGain}
            onChange={e => store.setMonitorGain(parseFloat(e.target.value))}
            disabled={!store.monitorEnabled}
            data-testid="audio-input-monitor-gain"
            className="flex-1 disabled:opacity-50"
          />
          <span className="text-xs font-mono text-text-dim tabular-nums w-10 text-right">
            {Math.round(store.monitorGain * 100)}%
          </span>
        </div>

        {/* Input-Gain */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted w-24">Input-Gain</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={store.inputGain}
            onChange={e => store.setInputGain(parseFloat(e.target.value))}
            data-testid="audio-input-input-gain"
            className="flex-1"
          />
          <span className="text-xs font-mono text-text-dim tabular-nums w-10 text-right">
            {store.inputGain.toFixed(2)}x
          </span>
        </div>

        {/* Route */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted w-24">Routing</span>
          <select
            value={store.route}
            onChange={e => store.setRoute(e.target.value as AudioInputRoute)}
            data-testid="audio-input-route-select"
            className="flex-1 text-xs px-2 py-1 rounded bg-bg-elevated text-text-primary border border-border-color"
          >
            <option value="master">Master (Monitor only)</option>
            <option value="live-recorder">LiveRecorder (zusätzlicher Track)</option>
            <option value="both">Both (Monitor + LiveRecorder)</option>
          </select>
        </div>

        {/* Transport-Sync */}
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={store.recordSyncWithTransport}
            onChange={e => store.setRecordSyncWithTransport(e.target.checked)}
            data-testid="audio-input-sync-toggle"
          />
          Auto-Start mit Transport-Play
        </label>
      </div>

      {/* Result-Section */}
      {lastResult && lastResult.wavBytes.length > 0 && (
        <div
          className="flex flex-col gap-2 pt-3 border-t border-border-subtle"
          data-testid="audio-input-result"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-text-dim">
              Aufnahme — {formatMs(lastResult.durationMs)}
              {lastResult.truncated && (
                <span className="ml-2 text-accent-danger">(truncated)</span>
              )}
            </span>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={handleDownload}
              data-testid="audio-input-download"
              className="flex-1 text-xs px-2 py-1 rounded bg-accent-primary/30 hover:bg-accent-primary/50 text-accent-primary border border-accent-primary"
            >
              ⬇ Download WAV
            </button>
            <button
              type="button"
              onClick={handleAddToLibrary}
              data-testid="audio-input-add-to-library"
              className="flex-1 text-xs px-2 py-1 rounded bg-bg-elevated hover:bg-accent-secondary/20 text-text-primary border border-border-color"
            >
              + Sample-Library
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
