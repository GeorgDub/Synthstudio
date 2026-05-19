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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ZoomIn } from "lucide-react";
import { AudioEngine } from "@/audio/AudioEngine";
import {
  updateAudioTrack,
  removeAudioTrack,
  markBroken,
  setRuntimeWaveform,
  getRuntimeState,
  countTimestretchTracks,
  setAudioTrackSoloed,
  setTrackStretchRatio,
  setTrackPitchLocked,
  setTrackBpmHint,
  setTrackLoopEnabled,
  setTrackLoopPoints,
  setTrackLoopCrossfadeMs,
  clampLoopCrossfadeMs,
  LOOP_CROSSFADE_MAX_MS,
  getAudioTrack,
  autoWarpToBpm,
  clampStretchRatio,
  snapStretchRatio,
  computeEffectiveStretchRate,
  STRETCH_SNAP_THRESHOLD,
  MAX_TIMESTRETCH_TRACKS,
  type AudioTrackChannelData,
  type AudioTrackRuntimeState,
} from "@/store/useAudioTrackStore";
import { WaveformDisplay } from "@/components/WaveformDisplay/WaveformDisplay";
import { ZoomableWaveform } from "@/components/AudioTrack/ZoomableWaveform";
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

  // v3.67.0: Zoom-Edit-Mode — toggle between mini-WaveformDisplay and ZoomableWaveform.
  const [zoomEditOpen, setZoomEditOpen] = useState(false);
  const [editorCursorSample, setEditorCursorSample] = useState<number | null>(null);

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

  /**
   * Solo-Toggle. Default: additive (toggle nur diesen Track). Shift+Click:
   * exclusive (un-solo't alle anderen Audio-Tracks — FOLLOWUP-102-3 inverse-default).
   */
  const handleSolo = useCallback((opts: { shiftKey: boolean }) => {
    const next = !track.soloed;
    setAudioTrackSoloed(track.id, next, opts.shiftKey);
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

  // ── Time-Stretch (v3.52.0 + v3.53.0 UI-Polish) ────────────────────────────
  const stretchRatio = track.stretchRatio ?? 1.0;
  const pitchLocked = track.pitchLocked === true;
  const bpmHint = track.bpmHint;
  const effectiveBpm = (() => {
    // Anzeige der effektiven Tempo wenn der User einen bpmHint hat.
    if (!bpmHint || bpmHint <= 0) return null;
    return bpmHint * stretchRatio;
  })();

  // v3.53.0: Kombinierte effektive Rate inklusive BPM-Sync (projectBpm/originalBpm)
  // × stretchRatio. Zeigt dem User die tatsächlich abgespielte Rate, auch wenn
  // sie durch das 0.25..4.0-Clamp begrenzt wird.
  const projectBpm = AudioEngine.bpm || 120;
  const effectiveStretch = computeEffectiveStretchRate(
    projectBpm,
    track.originalBpm,
    track.syncMode,
    stretchRatio,
  );
  // Snap-to-1.0 für Reset-Button: bei |ratio - 1| < threshold zählt als "neutral".
  const isNeutralRatio = Math.abs(stretchRatio - 1.0) < STRETCH_SNAP_THRESHOLD / 5;

  const handleStretchRatio = useCallback(
    (v: number) => {
      // v3.53.0: Snap-zu-1.0 anwenden BEVOR clampStretchRatio gerufen wird —
      // so wird ein Slider-Wert wie 0.97 oder 1.03 zu exakt 1.0 (Reset-Button-Fix).
      const snapped = snapStretchRatio(v);
      setTrackStretchRatio(track.id, snapped);
      AudioEngine.registerAudioTrack({ ...track, stretchRatio: snapped });
    },
    [track],
  );

  // v3.53.0: Reset-Button setzt explizit auf 1.0 (kein Slider-Detour).
  const handleResetStretch = useCallback(() => {
    setTrackStretchRatio(track.id, 1.0);
    AudioEngine.registerAudioTrack({ ...track, stretchRatio: 1.0 });
  }, [track]);

  const handlePitchLockToggle = useCallback(() => {
    const next = !pitchLocked;
    setTrackPitchLocked(track.id, next);
    AudioEngine.registerAudioTrack({ ...track, pitchLocked: next });
  }, [track, pitchLocked]);

  const handleBpmHint = useCallback(
    (v: number) => {
      const valid = Number.isFinite(v) && v > 0 ? v : null;
      setTrackBpmHint(track.id, valid);
      AudioEngine.registerAudioTrack({ ...track, bpmHint: valid ?? undefined });
    },
    [track],
  );

  const handleWarpToBpm = useCallback(() => {
    const projectBpm = AudioEngine.bpm || 120;
    const newRatio = autoWarpToBpm(track.id, projectBpm);
    if (newRatio !== null) {
      AudioEngine.registerAudioTrack({ ...track, stretchRatio: newRatio });
    }
  }, [track]);

  // Tap-BPM-Hint: setzt den `bpmHint` auf den aktuellen Projekt-BPM. User-Workflow:
  // Track loopen + Project-BPM auf Originaltempo schieben → diesen Button drücken
  // → bpmHint ist gesetzt → "Warp to BPM" funktioniert.
  const handleTapBpmHint = useCallback(() => {
    const projectBpm = AudioEngine.bpm || 120;
    setTrackBpmHint(track.id, projectBpm);
    AudioEngine.registerAudioTrack({ ...track, bpmHint: projectBpm });
  }, [track]);

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

      {/* ── Mini-Waveform + Zoom-Toggle ──────────────────────────────────── */}
      <div onClick={(e) => e.stopPropagation()} className="w-full relative">
        <WaveformDisplay
          peaks={peaksArr.current}
          duration={runtime.durationSec ?? 0}
          playbackPosition={pos01}
          isPlaying={isPlaying}
          onSeek={handleSeek}
          height={48}
          zoomEnabled={false}
        />
        {/* v3.67.0: Zoom-In Button (öffnet ZoomableWaveform Edit-Panel) */}
        <button
          type="button"
          data-testid={`audio-track-zoom-toggle-${track.id}`}
          aria-label="Open zoomable waveform editor"
          title="Sample-precise Zoom-Editor öffnen"
          onClick={(e) => {
            e.stopPropagation();
            setZoomEditOpen((v) => !v);
          }}
          className="absolute bottom-0.5 right-0.5 p-0.5 rounded bg-bg-panel/80 text-text-dim hover:text-accent-primary transition-colors"
        >
          <ZoomIn size={10} />
        </button>
      </div>

      {/* ── Zoom-Edit-Panel (v3.67.0) ─────────────────────────────────────── */}
      {zoomEditOpen && (
        <div
          data-testid={`audio-track-zoom-panel-${track.id}`}
          onClick={(e) => e.stopPropagation()}
          className="w-full"
        >
          <AudioTrackZoomEditor
            trackId={track.id}
            cursorSample={editorCursorSample}
            onCursorChange={setEditorCursorSample}
            loopEnabled={track.loopEnabled === true}
            loopStartSample={track.loopStartSample ?? null}
            loopEndSample={track.loopEndSample ?? null}
            loopCrossfadeMs={track.loopCrossfadeMs ?? 0}
          />
        </div>
      )}

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
              handleSolo({ shiftKey: e.shiftKey });
            }}
            disabled={broken}
            aria-label="Solo"
            aria-pressed={track.soloed}
            title="Solo — Shift+Click = exclusive (un-solo't andere Tracks)"
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
        {/* Limit-Banner (TASK-121): zeigt globalen Kontext warum die Option disabled ist.
            Nur wenn current Track NICHT bereits timestretch ist, das Limit erreicht ist
            UND AudioWorklet supported (sonst macht der "AudioWorklet nicht supported"-
            Pfad das eh klar). */}
        {!isAlreadyTimestretch && tsLimitReached && audioWorkletSupported && (
          <div
            role="status"
            data-testid="timestretch-limit-banner"
            className="mt-1 text-[9px] text-accent-secondary leading-tight"
          >
            ⚠ Max {MAX_TIMESTRETCH_TRACKS} Time-Stretch-Tracks (CPU). Frei für diesen Track: Free/Stretch.
          </div>
        )}
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

      {/* ── Time-Stretch (v3.52.0) ────────────────────────────────────────── */}
      <div
        data-testid="audio-track-stretch-section"
        className="flex flex-col gap-0.5 w-full mt-1 px-1 py-1 rounded border border-border-subtle bg-bg-elevated/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-[8px] text-text-dim uppercase tracking-wide">Stretch</span>
          <span
            data-testid="audio-track-stretch-ratio-label"
            className="text-[8px] text-text-muted font-mono"
            title="Aktueller Stretch-Faktor (1.0 = Original)"
          >
            {stretchRatio.toFixed(3)}x
          </span>
        </div>
        {/* Slider — logarithmisch zentriert auf 1.0 ist nicht trivial; wir
            nutzen einen linearen Wertbereich 0.25..4.0 aber den Slider exp-
            mappen damit die Mitte bei 1.0 liegt.
            v3.53.0: Snap-zu-1.0 bei |ratio - 1| < threshold (snapStretchRatio). */}
        <div className="relative w-full">
          <input
            data-testid="audio-track-stretch-slider"
            aria-label="Stretch Ratio"
            type="range"
            min={-1}
            max={1}
            step={0.001}
            // Log-Mapping: slider in [-1,1] → ratio in [0.25, 4.0], 0 = 1.0
            // ratio = 4^slider (denn 4^(-1)=0.25, 4^0=1, 4^1=4)
            value={Math.log(stretchRatio) / Math.log(4)}
            onChange={(e) => {
              const sliderVal = parseFloat(e.target.value);
              const ratio = Math.pow(4, sliderVal);
              handleStretchRatio(ratio);
            }}
            disabled={broken}
            className="relative w-full accent-accent-primary cursor-pointer disabled:opacity-40"
            title={`Stretch ${stretchRatio.toFixed(3)}x`}
          />
          {/* v3.53.0: Visueller Tick-Marker bei 1.0 (Slider-Mitte). */}
          <div
            data-testid="audio-track-stretch-tick"
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-px bg-border-color opacity-60"
          />
        </div>
        <div className="flex gap-1 items-center mt-0.5">
          <button
            type="button"
            data-testid="audio-track-pitch-lock"
            aria-pressed={pitchLocked}
            aria-label="Pitch Lock"
            onClick={handlePitchLockToggle}
            disabled={broken}
            title={
              pitchLocked
                ? "Pitch Lock AN — Tempo ändern, Pitch bleibt (Worklet)"
                : "Pitch Lock AUS — Resample (Pitch+Tempo gekoppelt)"
            }
            className={[
              "flex-1 px-1 py-0.5 text-[9px] rounded border transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              pitchLocked
                ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                : "bg-bg-base border-border-color text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            🔒 Pitch
          </button>
          <button
            type="button"
            data-testid="audio-track-reset-stretch"
            aria-label="Reset Stretch"
            onClick={handleResetStretch}
            // v3.53.0: nutzt den Snap-Threshold — Reset bleibt deaktiviert
            // sobald der Slider als "1.0-neutral" zählt (vermeidet 0.999-Bug).
            disabled={broken || isNeutralRatio}
            title="Auf 1.0 zurücksetzen"
            className="px-1 py-0.5 text-[9px] rounded border border-border-color bg-bg-base text-text-dim hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            1×
          </button>
        </div>
        <div className="flex gap-1 items-center mt-0.5">
          <input
            data-testid="audio-track-bpm-hint"
            aria-label="BPM Hint"
            type="number"
            min={20}
            max={300}
            step={1}
            value={bpmHint ?? ""}
            placeholder="Src BPM"
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              handleBpmHint(v);
            }}
            disabled={broken}
            title="Original-BPM des Samples (für Auto-Warp)"
            className="flex-1 min-w-0 px-1 py-0.5 text-[9px] bg-bg-base text-text-primary border border-border-color rounded font-mono disabled:opacity-40"
          />
          <button
            type="button"
            data-testid="audio-track-tap-bpm-hint"
            aria-label="Tap BPM Hint"
            onClick={handleTapBpmHint}
            disabled={broken}
            title="Aktuellen Projekt-BPM als Original-BPM merken"
            className="px-1 py-0.5 text-[9px] rounded border border-border-color bg-bg-base text-text-dim hover:text-accent-primary hover:border-accent-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Tap
          </button>
        </div>
        <button
          type="button"
          data-testid="audio-track-warp-to-bpm"
          aria-label="Warp to project BPM"
          onClick={handleWarpToBpm}
          disabled={broken || (!bpmHint && !track.originalBpm)}
          title="Stretch-Ratio auf projectBpm / sourceBpm setzen"
          className="mt-0.5 px-1 py-0.5 text-[9px] rounded bg-accent-secondary/20 border border-accent-secondary text-accent-secondary hover:bg-accent-secondary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Warp to BPM
        </button>
        {effectiveBpm !== null && (
          <span
            data-testid="audio-track-effective-bpm"
            className="text-[8px] text-text-muted font-mono mt-0.5 text-center"
            title="Effektives Tempo bei aktueller Stretch-Ratio"
          >
            {bpmHint!.toFixed(0)} → {effectiveBpm.toFixed(1)} BPM ({stretchRatio.toFixed(3)}x)
          </span>
        )}
        {/* v3.53.0: Kombinierte Effective-Rate (BPM-Sync × manualStretch).
            Wird nur angezeigt wenn der Sync-Mode 'stretch' oder 'timestretch'
            ist UND ein originalBpm gesetzt ist (sonst ist effectiveStretch.rate
            identisch mit manualRatio = stretchRatio, also redundant). */}
        {(track.syncMode === "stretch" || track.syncMode === "timestretch") &&
          track.originalBpm && track.originalBpm > 0 && (
            <span
              data-testid="audio-track-effective-rate"
              className={[
                "text-[8px] font-mono mt-0.5 text-center",
                effectiveStretch.clamped ? "text-accent-danger" : "text-text-muted",
              ].join(" ")}
              title={
                effectiveStretch.clamped
                  ? "Effektive Rate wurde geclamped (0.25..4.0)"
                  : "Effektive Rate = BPM-Sync × Manual Stretch"
              }
            >
              {effectiveStretch.clamped && (
                <span aria-label="Warning" data-testid="audio-track-effective-rate-warn">
                  ⚠{" "}
                </span>
              )}
              Effective: {effectiveStretch.rate.toFixed(3)}x ({projectBpm.toFixed(0)}{" "}
              / {track.originalBpm} × {effectiveStretch.manualRatio.toFixed(3)})
            </span>
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

// ─── Sub-Component: AudioTrackZoomEditor (v3.67.0 + v3.70.0 loop-engine) ────

interface AudioTrackZoomEditorProps {
  trackId: string;
  cursorSample: number | null;
  onCursorChange: (s: number | null) => void;
  /** v3.70.0: Loop-State aus dem Track-Datensatz (controlled). */
  loopEnabled: boolean;
  loopStartSample: number | null;
  loopEndSample: number | null;
  /** v3.72.0: Loop-Boundary-Crossfade in ms (0..200). */
  loopCrossfadeMs: number;
}

/**
 * Sample-precise Zoom-Editor — wired ZoomableWaveform an einen Track-Buffer.
 * Liest channelData[0] aus AudioEngine.getAudioTrackBuffer(id). Wenn der
 * Buffer nicht (mehr) verfügbar ist, zeigt das Panel einen Empty-State.
 *
 * v3.70.0: Loop-Engine-Wiring — Initial-Loop-Points kommen aus dem Track,
 * Drag-End → setTrackLoopPoints. Enable-Loop-Toggle direkt im Editor-Header.
 */
function AudioTrackZoomEditor({
  trackId,
  cursorSample,
  onCursorChange,
  loopEnabled,
  loopStartSample,
  loopEndSample,
  loopCrossfadeMs,
}: AudioTrackZoomEditorProps) {
  // memo: cache channelData reference so wir den Buffer nicht jeden Render neu greifen
  const buffer = AudioEngine.getAudioTrackBuffer(trackId);
  const channelData = useMemo(() => {
    if (!buffer) return null;
    try {
      return buffer.getChannelData(0);
    } catch {
      return null;
    }
  }, [buffer]);
  const sampleRate = buffer?.sampleRate ?? 44100;
  const totalSamples = channelData?.length ?? 0;

  // v3.70.0: Build LoopPoints für die Waveform. Wenn der Track noch keine
  // Punkte gesetzt hat aber der User "Enable Loop" aktiviert, defaulten wir
  // auf 25%..75% der Buffer-Länge damit die Marker sichtbar sind.
  const loopPoints = useMemo(() => {
    if (!loopEnabled || totalSamples === 0) return null;
    const start =
      loopStartSample !== null && loopStartSample >= 0
        ? loopStartSample
        : Math.floor(totalSamples * 0.25);
    const end =
      loopEndSample !== null && loopEndSample > start
        ? loopEndSample
        : Math.floor(totalSamples * 0.75);
    return { loopStart: start, loopEnd: end };
  }, [loopEnabled, loopStartSample, loopEndSample, totalSamples]);

  const handleLoopChange = useCallback(
    (loop: { loopStart: number; loopEnd: number }) => {
      setTrackLoopPoints(trackId, loop.loopStart, loop.loopEnd);
      // Engine-Sync — registerAudioTrack akzeptiert ein neues Snapshot pro
      // Update, damit der nächste playAudioTrack die frischen Loop-Werte
      // sieht. Wir lesen den Track frisch um die Loop-Sanitize-Logik des
      // Stores (Swap bei end ≤ start) zu respektieren.
      const track = getAudioTrack(trackId);
      if (track) {
        AudioEngine.registerAudioTrack({
          ...track,
          loopStartSample: loop.loopStart,
          loopEndSample: loop.loopEnd,
        });
        // v3.71.0: Live-Loop-Edit. Wenn der Track gerade spielt, restartet
        // setAudioTrackLoopPoints die Source mit der neuen Range
        // (Worklet-Pfad: postMessage; BufferSource-Pfad: Stop+Restart mit
        // position-preservation falls innerhalb der neuen Range).
        AudioEngine.setAudioTrackLoopPoints(trackId);
      }
    },
    [trackId],
  );

  const handleEnableLoopToggle = useCallback(() => {
    const nextEnabled = !loopEnabled;
    setTrackLoopEnabled(trackId, nextEnabled);
    // Wenn wir Loop erst aktivieren UND noch keine Punkte gesetzt sind,
    // gleich die Default-Range persistieren damit der Engine-Start korrekt
    // läuft (sonst hätte source.loop=true aber loopStart=loopEnd=0).
    let nextStart = loopStartSample;
    let nextEnd = loopEndSample;
    if (nextEnabled && loopStartSample === null && loopEndSample === null && totalSamples > 0) {
      nextStart = Math.floor(totalSamples * 0.25);
      nextEnd = Math.floor(totalSamples * 0.75);
      setTrackLoopPoints(trackId, nextStart, nextEnd);
    }
    // Engine-Sync
    const track = getAudioTrack(trackId);
    if (track) {
      AudioEngine.registerAudioTrack({
        ...track,
        loopEnabled: nextEnabled,
        loopStartSample: nextStart,
        loopEndSample: nextEnd,
      });
      // v3.71.0: Live-Edit — falls Track gerade spielt, übernimmt die
      // Engine die neue loopEnabled/-Range sofort.
      AudioEngine.setAudioTrackLoopPoints(trackId);
    }
  }, [loopEnabled, loopStartSample, loopEndSample, totalSamples, trackId]);

  // v3.72.0: Crossfade-Slider Handler — clamped 0..200ms, Engine-Sync via
  // setAudioTrackLoopPoints damit Live-Edit (Worklet postMessage + Buffer-
  // Source xfade-Schedule) sofort greift wenn der Track gerade spielt.
  const handleCrossfadeChange = useCallback(
    (ms: number) => {
      const safe = clampLoopCrossfadeMs(ms);
      setTrackLoopCrossfadeMs(trackId, safe);
      const track = getAudioTrack(trackId);
      if (track) {
        AudioEngine.registerAudioTrack({
          ...track,
          loopCrossfadeMs: safe,
        });
        AudioEngine.setAudioTrackLoopPoints(trackId);
      }
    },
    [trackId],
  );

  if (!channelData) {
    return (
      <div
        data-testid={`audio-track-zoom-empty-${trackId}`}
        className="w-full px-2 py-3 text-[9px] text-text-dim text-center bg-bg-panel/40 rounded border border-border-color"
      >
        — Buffer nicht geladen —
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-0.5">
        <button
          type="button"
          data-testid={`audio-track-loop-toggle-${trackId}`}
          onClick={handleEnableLoopToggle}
          aria-pressed={loopEnabled}
          className={
            "px-2 py-0.5 text-[10px] rounded border transition-colors " +
            (loopEnabled
              ? "bg-accent-secondary/20 text-accent-secondary border-accent-secondary/50"
              : "bg-bg-panel/60 text-text-dim border-border-color hover:text-text-primary")
          }
        >
          Loop {loopEnabled ? "On" : "Off"}
        </button>
        {loopEnabled && loopPoints && (
          <span
            data-testid={`audio-track-loop-range-${trackId}`}
            className="text-[9px] font-mono text-text-dim"
          >
            {loopPoints.loopStart}–{loopPoints.loopEnd} samples
          </span>
        )}
      </div>
      {/* v3.72.0: Loop-Crossfade Slider — sichtbar wenn Loop aktiv. */}
      {loopEnabled && (
        <div
          data-testid={`audio-track-loop-crossfade-row-${trackId}`}
          className="flex items-center gap-2 px-0.5"
        >
          <label
            htmlFor={`audio-track-loop-crossfade-${trackId}`}
            className="text-[10px] text-text-dim whitespace-nowrap"
            title={`Smooth loop boundary with ${Math.round(loopCrossfadeMs)} ms crossfade`}
          >
            Crossfade:
          </label>
          <input
            type="range"
            id={`audio-track-loop-crossfade-${trackId}`}
            data-testid={`audio-track-loop-crossfade-${trackId}`}
            min={0}
            max={LOOP_CROSSFADE_MAX_MS}
            step={1}
            value={Math.round(loopCrossfadeMs)}
            onChange={(e) => handleCrossfadeChange(Number(e.target.value))}
            className="flex-1 h-1 accent-accent-secondary"
            title={`Smooth loop boundary with ${Math.round(loopCrossfadeMs)} ms crossfade`}
          />
          <span
            data-testid={`audio-track-loop-crossfade-value-${trackId}`}
            className="text-[10px] font-mono text-text-primary w-10 text-right"
          >
            {Math.round(loopCrossfadeMs)} ms
          </span>
        </div>
      )}
      <ZoomableWaveform
        channelData={channelData}
        sampleRate={sampleRate}
        cursorSample={cursorSample}
        onCursorChange={onCursorChange}
        loopPoints={loopPoints}
        onLoopChange={handleLoopChange}
        height={80}
        testId={`audio-track-zoom-${trackId}`}
      />
    </div>
  );
}

/** Re-export for components that may want to inspect runtime state. */
export type { AudioTrackRuntimeState };
export { getRuntimeState };
