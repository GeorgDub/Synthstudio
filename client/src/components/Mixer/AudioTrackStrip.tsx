/**
 * Synthstudio – AudioTrackStrip.tsx
 *
 * Channel-Strip-Variante für externe Audio-Tracks (Vocals, Songs zum Remixen).
 * Ergänzt MixerView um eigene Affordances: editierbarer Name, Mini-Waveform mit
 * Playhead, Broken-Banner mit Relocate-Button, Sync-Mode (free/stretch +
 * originalBpm), Sends.
 *
 * Layout (top → bottom):
 *   1. Title-Row (editable name, [X] remove)
 *   2. Mini-Waveform (mit Seek)
 *   3. Optional Broken-Banner (Relocate / Remove)
 *   4. Fader + Pan + M/S
 *   5. Sync-Mode Dropdown + originalBpm-Eingabe
 *   6. Send-Knobs (Reverb / Delay)
 *
 * Styling: ausschließlich semantische `--ss-*` Tokens.
 * Keine direkte `window.electronAPI`-Nutzung – alle native Calls über
 * `useElectron()`-Hook.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AudioEngine } from "@/audio/AudioEngine";
import {
  updateAudioTrack,
  removeAudioTrack,
  markBroken,
  setRuntimeWaveform,
  getRuntimeState,
  countTimestretchTracks,
  MAX_TIMESTRETCH_TRACKS,
  type AudioTrackChannelData,
  type AudioTrackRuntimeState,
} from "@/store/useAudioTrackStore";
import { WaveformDisplay } from "@/components/WaveformDisplay/WaveformDisplay";
import { useElectron } from "../../../../electron/useElectron";

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function volToDb(vol: number): string {
  if (vol <= 0) return "-∞";
  const db = 20 * Math.log10(Math.max(0.001, vol));
  return (db >= 0 ? "+" : "") + db.toFixed(1) + " dB";
}

/** Liest die Peaks aus einem dekodierten AudioBuffer (Client-side Fallback). */
function downsamplePeaks(buffer: AudioBuffer, numPeaks: number): Float32Array {
  const peaks = new Float32Array(numPeaks);
  if (numPeaks <= 0 || buffer.length === 0) return peaks;
  const ch = buffer.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(ch.length / numPeaks));
  for (let i = 0; i < numPeaks; i++) {
    const start = i * blockSize;
    const end = Math.min(ch.length, start + blockSize);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(ch[j]);
      if (v > peak) peak = v;
    }
    peaks[i] = peak;
  }
  return peaks;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AudioTrackStripProps {
  track: AudioTrackChannelData;
  runtime: AudioTrackRuntimeState;
  isPlaying?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

// ─── Komponente ──────────────────────────────────────────────────────────────

export function AudioTrackStrip({
  track,
  runtime,
  isPlaying = false,
  selected,
  onSelect,
}: AudioTrackStripProps) {
  const electron = useElectron();
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(track.name);
  const [pos01, setPos01] = useState(0);

  // Playhead-Position via Engine-Callback
  useEffect(() => {
    const unsub = AudioEngine.onAudioTrackPosition(track.id, (p) => {
      setPos01(p);
    });
    return unsub;
  }, [track.id]);

  // Wenn nicht aktiv, Playhead resetten
  useEffect(() => {
    if (!isPlaying) setPos01(0);
  }, [isPlaying]);

  // Draft-Name resync wenn extern geändert
  useEffect(() => {
    if (!editingName) setDraftName(track.name);
  }, [track.name, editingName]);

  // ── Title / Remove ─────────────────────────────────────────────────────────
  const commitName = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== track.name) {
      updateAudioTrack(track.id, { name: trimmed });
    } else {
      setDraftName(track.name);
    }
    setEditingName(false);
  }, [draftName, track.id, track.name]);

  const handleRemove = useCallback(() => {
    if (!window.confirm(`Audio-Track "${track.name}" entfernen?`)) return;
    try { AudioEngine.disposeAudioTrack(track.id); } catch { /* ignore */ }
    removeAudioTrack(track.id);
  }, [track.id, track.name]);

  // ── Relocate (broken) ──────────────────────────────────────────────────────
  const handleRelocate = useCallback(async () => {
    if (electron.isElectron) {
      const result = await electron.openFileDialog({
        title: `Audio-Datei für "${track.name}" wählen`,
        filters: [
          {
            name: "Audio",
            extensions: ["wav", "mp3", "ogg", "flac", "aif", "aiff", "m4a"],
          },
        ],
        multiSelections: false,
      });
      if (result.canceled || !result.filePaths[0]) return;
      const newPath = result.filePaths[0];
      const fileName = newPath.split(/[\\/]/).pop() ?? newPath;
      updateAudioTrack(track.id, { filePath: newPath, fileName });

      // Buffer neu laden
      try {
        const buf = await AudioEngine.loadAudioTrack(track.id, newPath);
        if (!buf) {
          markBroken(track.id, true);
          return;
        }
        AudioEngine.registerAudioTrack({ ...track, filePath: newPath, fileName });
        // Peaks (Electron oder Client-Decode)
        let peaks: Float32Array | undefined;
        if (electron.isElectron) {
          try {
            const res = await electron.analyzeWaveform(newPath, 200);
            const r = res as { success?: boolean; peaks?: number[] };
            if (r.success && Array.isArray(r.peaks)) {
              peaks = Float32Array.from(r.peaks);
            }
          } catch { /* ignore */ }
        }
        if (!peaks) peaks = downsamplePeaks(buf, 200);
        setRuntimeWaveform(track.id, buf.duration, peaks);
        markBroken(track.id, false);
      } catch (err) {
        console.warn("[AudioTrackStrip] relocate error:", err);
        markBroken(track.id, true);
      }
    } else {
      // Browser: <input type="file"> Pfad
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        updateAudioTrack(track.id, {
          filePath: file.name, // Browser-Fallback: nur Dateiname
          fileName: file.name,
          fileSize: file.size,
        });
        try {
          const buf = await AudioEngine.loadAudioTrack(track.id, file);
          if (!buf) {
            markBroken(track.id, true);
            return;
          }
          AudioEngine.registerAudioTrack({
            ...track,
            filePath: file.name,
            fileName: file.name,
            fileSize: file.size,
          });
          const peaks = downsamplePeaks(buf, 200);
          setRuntimeWaveform(track.id, buf.duration, peaks);
          markBroken(track.id, false);
        } catch (err) {
          console.warn("[AudioTrackStrip] browser relocate error:", err);
          markBroken(track.id, true);
        }
      };
      input.click();
    }
  }, [electron, track]);

  // ── Fader / Pan / Mute / Solo ──────────────────────────────────────────────
  const handleVolume = useCallback(
    (v: number) => {
      updateAudioTrack(track.id, { volume: v });
      AudioEngine.setAudioTrackVolume(track.id, v);
    },
    [track.id],
  );

  const handlePan = useCallback(
    (p: number) => {
      updateAudioTrack(track.id, { pan: p });
      AudioEngine.setAudioTrackPan(track.id, p);
    },
    [track.id],
  );

  const handleMute = useCallback(() => {
    const next = !track.muted;
    updateAudioTrack(track.id, { muted: next });
    AudioEngine.setAudioTrackMute(track.id, next);
  }, [track.id, track.muted]);

  const handleSolo = useCallback(() => {
    const next = !track.soloed;
    updateAudioTrack(track.id, { soloed: next });
    AudioEngine.setAudioTrackSolo(track.id, next);
  }, [track.id, track.soloed]);

  // ── Sync-Mode ──────────────────────────────────────────────────────────────
  const handleSyncMode = useCallback(
    (mode: "free" | "stretch" | "timestretch") => {
      updateAudioTrack(track.id, { syncMode: mode });
      // Engine re-register damit playbackRate / stretch beim nächsten Start neu berechnet wird.
      const fresh = { ...track, syncMode: mode };
      AudioEngine.registerAudioTrack(fresh);
    },
    [track],
  );

  // ── Feature-Detection + Limit-Check für "timestretch" ──────────────────────
  // - Browser ohne AudioWorklet (z.B. sehr alte Browser) → Option deaktivieren.
  // - Wenn MAX_TIMESTRETCH_TRACKS erreicht UND dieser Track ist nicht selbst
  //   bereits timestretch → Option deaktivieren (CPU-Schutz).
  const audioWorkletSupported = (() => {
    try {
      const ctx = AudioEngine.getAudioContext();
      // Wenn kein ctx vorhanden → in Browser-Test ableiten von window.AudioWorklet.
      if (ctx && (ctx as unknown as { audioWorklet?: unknown }).audioWorklet) return true;
      if (typeof window !== "undefined" && "AudioWorklet" in window) return true;
      return false;
    } catch {
      return false;
    }
  })();
  const isAlreadyTimestretch = track.syncMode === "timestretch";
  const tsLimitReached = !isAlreadyTimestretch
    && countTimestretchTracks() >= MAX_TIMESTRETCH_TRACKS;
  const timestretchDisabled = !audioWorkletSupported || tsLimitReached;
  const timestretchTooltip = !audioWorkletSupported
    ? "Browser unterstützt AudioWorklet nicht"
    : tsLimitReached
      ? `Max ${MAX_TIMESTRETCH_TRACKS} Time-Stretch Tracks (CPU-Schutz)`
      : "Time-Stretch (Pitch erhalten)";

  // ── Quality-Badge bei extremen Ratios ──────────────────────────────────────
  // Trigger: timestretch aktiv + |bpm/orig - 1| > 0.5 (also >50% Abweichung).
  // OLA-Artefakte (Phasing, transientes Smearing) werden hörbar ab dieser Schwelle.
  const showQualityBadge = (() => {
    if (track.syncMode !== "timestretch") return false;
    const orig = track.originalBpm;
    if (!orig || orig <= 0) return false;
    const currentBpm = AudioEngine.bpm || 120;
    return Math.abs(currentBpm / orig - 1) > 0.5;
  })();

  const handleOriginalBpm = useCallback(
    (bpm: number) => {
      const valid = Number.isFinite(bpm) && bpm > 0 ? bpm : null;
      updateAudioTrack(track.id, { originalBpm: valid });
      AudioEngine.registerAudioTrack({ ...track, originalBpm: valid });
    },
    [track],
  );

  // ── Sends ──────────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    (bus: "reverb" | "delay", v: number) => {
      updateAudioTrack(track.id, {
        sends: { ...track.sends, [bus]: v },
      });
      AudioEngine.setChannelSend(track.id, bus, v);
    },
    [track.id, track.sends],
  );

  // ── Seek ───────────────────────────────────────────────────────────────────
  const handleSeek = useCallback(
    (pos: number) => {
      const dur = runtime.durationSec ?? 0;
      if (dur <= 0) return;
      AudioEngine.seekAudioTrack(track.id, pos * dur);
    },
    [runtime.durationSec, track.id],
  );

  // ── Peaks für Display ──────────────────────────────────────────────────────
  // WaveformDisplay erwartet number[] oder [number[], number[]]
  const peaksArr = useRef<number[]>([]);
  if (runtime.peaks && peaksArr.current.length !== runtime.peaks.length) {
    peaksArr.current = Array.from(runtime.peaks);
  }

  const broken = runtime.broken === true;
  const labelColor = broken
    ? "text-accent-danger"
    : track.muted
      ? "text-text-dim"
      : track.soloed
        ? "text-accent-primary"
        : "text-text-primary";

  return (
    <div
      data-testid="audio-track-strip"
      data-track-id={track.id}
      onClick={onSelect}
      className={[
        "flex flex-col gap-1 px-2 py-2 select-none",
        "border-r border-border-color last:border-r-0 cursor-pointer",
        "bg-bg-panel/40",
        selected ? "ring-1 ring-accent-secondary/60 ring-inset" : "",
        track.muted ? "opacity-60" : "",
      ].join(" ")}
      style={{ minWidth: "140px", maxWidth: "180px" }}
    >
      {/* ── Title-Row ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1">
        {editingName ? (
          <input
            type="text"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              else if (e.key === "Escape") {
                setDraftName(track.name);
                setEditingName(false);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 px-1 py-0.5 text-[10px] bg-bg-elevated text-text-primary border border-border-color rounded"
            aria-label="Track Name"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditingName(true);
            }}
            title={`${track.name} – Doppelklick zum Umbenennen`}
            className={`flex-1 min-w-0 truncate text-[10px] font-medium uppercase tracking-wide ${labelColor}`}
          >
            {track.name}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
          aria-label="Close"
          title="Track entfernen"
          className="w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-accent-danger hover:bg-bg-elevated transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {/* ── Mini-Waveform ──────────────────────────────────────────────────── */}
      <div onClick={(e) => e.stopPropagation()} className="w-full">
        <WaveformDisplay
          peaks={peaksArr.current}
          duration={runtime.durationSec ?? 0}
          playbackPosition={pos01}
          isPlaying={isPlaying}
          onSeek={handleSeek}
          height={48}
          zoomEnabled={false}
        />
      </div>

      {/* ── Broken-Banner ──────────────────────────────────────────────────── */}
      {broken && (
        <div
          role="alert"
          className="flex flex-col gap-1 px-1.5 py-1 rounded border border-accent-danger/50 bg-accent-danger/10"
        >
          <span className="text-[9px] text-accent-danger font-semibold uppercase tracking-wide">
            Datei nicht gefunden
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleRelocate();
              }}
              className="flex-1 px-1.5 py-0.5 text-[9px] rounded bg-bg-elevated text-text-primary border border-border-color hover:border-accent-primary hover:text-accent-primary transition-colors"
            >
              Relocate…
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
              className="px-1.5 py-0.5 text-[9px] rounded bg-bg-elevated text-text-dim border border-border-color hover:border-accent-danger hover:text-accent-danger transition-colors"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {/* ── Fader + Pan + M/S ─────────────────────────────────────────────── */}
      <div className="flex items-end gap-2 mt-1">
        {/* Fader */}
        <div className="flex flex-col items-center gap-0.5 flex-1">
          <input
            aria-label="Volume"
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={track.volume}
            onChange={(e) => handleVolume(parseFloat(e.target.value))}
            onClick={(e) => e.stopPropagation()}
            disabled={broken}
            className="h-24 w-3 accent-accent-primary cursor-pointer disabled:opacity-40"
            style={{
              writingMode: "vertical-lr",
              direction: "rtl",
              appearance: "slider-vertical" as React.CSSProperties["appearance"],
            }}
            title={volToDb(track.volume)}
          />
          <span className="text-[8px] text-text-dim font-mono">{volToDb(track.volume)}</span>
        </div>

        {/* M/S Buttons */}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleMute();
            }}
            disabled={broken}
            aria-label="Mute"
            aria-pressed={track.muted}
            title="Mute"
            className={[
              "w-6 h-5 rounded text-[9px] font-bold transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              track.muted
                ? "bg-accent-danger text-text-primary"
                : "bg-bg-elevated text-text-dim hover:text-accent-danger",
            ].join(" ")}
          >
            M
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleSolo();
            }}
            disabled={broken}
            aria-label="Solo"
            aria-pressed={track.soloed}
            title="Solo"
            className={[
              "w-6 h-5 rounded text-[9px] font-bold transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              track.soloed
                ? "bg-accent-primary text-text-primary"
                : "bg-bg-elevated text-text-dim hover:text-accent-primary",
            ].join(" ")}
          >
            S
          </button>
        </div>
      </div>

      {/* ── Pan ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-0.5 w-full">
        <span className="text-[8px] text-text-dim uppercase">Pan</span>
        <input
          aria-label="Pan"
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={track.pan}
          onChange={(e) => handlePan(parseFloat(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          disabled={broken}
          className="w-full accent-accent-primary cursor-pointer disabled:opacity-40"
          title={
            track.pan === 0
              ? "C"
              : track.pan > 0
                ? `R ${Math.round(track.pan * 100)}`
                : `L ${Math.round(-track.pan * 100)}`
          }
        />
        <span className="text-[8px] text-text-dim font-mono">
          {track.pan === 0
            ? "C"
            : track.pan > 0
              ? `R${Math.round(track.pan * 100)}`
              : `L${Math.round(-track.pan * 100)}`}
        </span>
      </div>

      {/* ── Sync-Mode ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-0.5 w-full mt-1">
        <label
          className="text-[8px] text-text-dim uppercase"
          title="Free = Originaltempo. Stretch = schneller/langsamer + höher/tiefer (DJ-Pitch). Time-Stretch = nur Tempo, Pitch bleibt (OLA-Algorithmus, optimal ±50%)."
        >
          Sync
        </label>
        <select
          aria-label="Sync Mode"
          value={track.syncMode ?? "free"}
          onChange={(e) => {
            e.stopPropagation();
            handleSyncMode(e.target.value as "free" | "stretch" | "timestretch");
          }}
          onClick={(e) => e.stopPropagation()}
          disabled={broken}
          title="Free = Originaltempo. Stretch = schneller/langsamer + höher/tiefer (DJ-Pitch). Time-Stretch = nur Tempo, Pitch bleibt (OLA-Algorithmus, optimal ±50%)."
          className="w-full px-1 py-0.5 text-[9px] bg-bg-elevated text-text-primary border border-border-color rounded disabled:opacity-40"
        >
          <option value="free">Free</option>
          <option value="stretch">Stretch (Pitch+Tempo)</option>
          <option
            value="timestretch"
            disabled={timestretchDisabled}
            title={timestretchTooltip}
          >
            Time-Stretch (Pitch erhalten)
          </option>
        </select>
        {showQualityBadge && (
          <span
            data-testid="timestretch-quality-warning"
            className="text-[10px] text-accent-secondary"
            title="Extreme Stretch-Ratio. OLA-Artefakte (Phasing, Smearing) hörbar."
          >
            ⚠ Extreme Ratio — Artefakte möglich
          </span>
        )}
        {(track.syncMode === "stretch" || track.syncMode === "timestretch") && (
          <input
            aria-label="Original BPM"
            type="number"
            min={20}
            max={300}
            step={1}
            value={track.originalBpm ?? ""}
            placeholder="Orig BPM"
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              handleOriginalBpm(v);
            }}
            onClick={(e) => e.stopPropagation()}
            disabled={broken}
            title="Original-BPM des Samples (für Tempo-Sync)"
            className="w-full mt-0.5 px-1 py-0.5 text-[9px] bg-bg-elevated text-text-primary border border-border-color rounded font-mono disabled:opacity-40"
          />
        )}
      </div>

      {/* ── Sends ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-0.5 w-full mt-1">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[8px] text-text-dim uppercase">Rev</span>
          <input
            aria-label="Reverb Send"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={track.sends?.reverb ?? 0}
            onChange={(e) => handleSend("reverb", parseFloat(e.target.value))}
            onClick={(e) => e.stopPropagation()}
            disabled={broken}
            className="w-full accent-accent-secondary cursor-pointer disabled:opacity-40"
          />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[8px] text-text-dim uppercase">Dly</span>
          <input
            aria-label="Delay Send"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={track.sends?.delay ?? 0}
            onChange={(e) => handleSend("delay", parseFloat(e.target.value))}
            onClick={(e) => e.stopPropagation()}
            disabled={broken}
            className="w-full accent-accent-secondary cursor-pointer disabled:opacity-40"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Helper: lädt Peaks für einen Audio-Buffer (200 Bins).
 * Wird vom Mixer beim Add-Track + Relocate genutzt.
 */
export function computePeaksFromBuffer(buffer: AudioBuffer, numPeaks = 200): Float32Array {
  return downsamplePeaks(buffer, numPeaks);
}

/** Re-export for components that may want to inspect runtime state. */
export type { AudioTrackRuntimeState };
export { getRuntimeState };
