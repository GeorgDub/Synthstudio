/**
 * Synthstudio – AudioClipLane.tsx (TASK-246)
 *
 * Continuous-Clip-Lane für einen Audio-Track im Sequencer (Option B —
 * durchgehende Wellenform-Lane statt Step-Grid).
 *
 * Layout (horizontal, analog zu ChannelStrip):
 *   [ w-[88px] Header: Name + M/S ] [ Play/Stop ] [ Continuous Waveform … ]
 *
 * - KEIN Step-Grid (das continuous AudioTrackChannelData-Modell hat keins).
 * - Mute/Solo gebunden an useAudioTrackStore (gleiche Solo-Gruppe wie der
 *   Mixer-AudioTrackStrip — unabhängig von Drum-Part-Solo).
 * - Per-Lane Play/Stop via Engine playAudioTrack/stopAudioTrack (TASK-245-API).
 * - Per-Lane Playhead-Progress via Engine onAudioTrackPosition (self-subscribed,
 *   damit nur diese memoisierte Lane bei Position-Updates re-rendert — TASK-247-
 *   Decoupling-Muster).
 *
 * Styling: ausschließlich semantische `--ss-*`-Tokens. Die Wellenform-Farbe
 * kommt aus resolveChannelColor (data-driven Hex), keine hardcodierte Tailwind-
 * Palette.
 *
 * Kein direkter `window.electronAPI`-Zugriff — die Engine-API ist isomorph.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Play, Square } from "lucide-react";
import { AudioEngine, type AudioTrackChannelData } from "@/audio/AudioEngine";
import {
  updateAudioTrack,
  setAudioTrackSoloed,
  getRuntimeState,
  useAudioTrackStore,
  type AudioTrackRuntimeState,
} from "@/store/useAudioTrackStore";
import {
  computePeaksFromBuffer,
  nextAudioTrackPlayState,
} from "@/components/Mixer/AudioTrackStrip";
import { WaveformDisplay } from "@/components/WaveformDisplay/WaveformDisplay";
import { resolveChannelColor } from "@/utils/channelColors";
import {
  audioLaneLabelColorClass,
  isAudioLaneAudible,
  resolveAudioLanes,
} from "./audioLaneHelpers";

export interface AudioClipLaneProps {
  track: AudioTrackChannelData;
  /**
   * Runtime-State (peaks/duration/broken) als Prop — bewusst NICHT intern via
   * getRuntimeState gelesen. Grund: Runtime-State lebt in einer separaten Map,
   * deren Updates (setRuntimeWaveform/markBroken) `notify()` feuern aber das
   * `track`-Objekt NICHT mutieren. Würde die memoisierte Lane den Runtime-State
   * intern lesen, würde der Memo-Comparator (unveränderte track-Ref) frische
   * Peaks/Duration/broken blockieren. Als Prop liefert getRuntimeState bei jedem
   * notify ein frisches Objekt → Memo erkennt die Änderung und re-rendert genau
   * dann. (Selbe Contract wie AudioTrackStrip.)
   */
  runtime: AudioTrackRuntimeState;
  /** Index für den Palette-Default der Wellenform-Farbe. */
  laneIndex: number;
  /**
   * Ob die Lane angesichts der Audio-Track-Solo-Gruppe hörbar ist (für Dim-
   * Darstellung). Audio ist korrekt egal was hier steht (Engine mutet); dies
   * ist rein visuell. Default true.
   */
  audible?: boolean;
}

/**
 * Eine Audio-Track-Lane. `memo` + self-subscription auf onAudioTrackPosition:
 * Position-Updates (rAF) re-rendern NUR diese Lane, nicht den DrumMachine-Parent
 * (respektiert das React.memo-Pattern von DrumMachine / TASK-247).
 */
export const AudioClipLane = memo(function AudioClipLane({
  track,
  runtime,
  laneIndex,
  audible = true,
}: AudioClipLaneProps) {
  // Per-Lane Play/Stop — component-local (ephemer, kein Store), wie AudioTrackStrip.
  const [playing, setPlaying] = useState(false);
  const [pos01, setPos01] = useState(0);
  const broken = runtime.broken === true;

  // ── Playhead-Position (self-subscribed) ──────────────────────────────────
  useEffect(() => {
    const unsub = AudioEngine.onAudioTrackPosition(track.id, (p) => setPos01(p));
    return unsub;
  }, [track.id]);

  // onEnded → playing zurücksetzen (natürliches Track-Ende, kein Loop).
  useEffect(() => {
    const unsub = AudioEngine.onAudioTrackEnded(track.id, () => {
      setPlaying((p) => nextAudioTrackPlayState(p, "ended"));
    });
    return unsub;
  }, [track.id]);

  // Wenn nicht aktiv → Playhead resetten.
  useEffect(() => {
    if (!playing) setPos01(0);
  }, [playing]);

  // ── Play / Stop ──────────────────────────────────────────────────────────
  const handlePlayStop = useCallback(() => {
    if (broken) return;
    const next = nextAudioTrackPlayState(playing, "toggle", { broken });
    if (next) {
      AudioEngine.playAudioTrack(track.id);
    } else {
      AudioEngine.stopAudioTrack(track.id);
    }
    setPlaying(next);
  }, [track.id, broken, playing]);

  // ── Mute / Solo (gleiche Solo-Gruppe wie AudioTrackStrip) ─────────────────
  const handleMute = useCallback(() => {
    const next = !track.muted;
    updateAudioTrack(track.id, { muted: next });
    AudioEngine.setAudioTrackMute(track.id, next);
  }, [track.id, track.muted]);

  const handleSolo = useCallback(
    (opts: { shiftKey: boolean }) => {
      const next = !track.soloed;
      setAudioTrackSoloed(track.id, next, opts.shiftKey);
      AudioEngine.setAudioTrackSolo(track.id, next);
    },
    [track.id, track.soloed],
  );

  // ── Seek (Klick in die Wellenform) ───────────────────────────────────────
  const handleSeek = useCallback(
    (pos: number) => {
      const dur = runtime.durationSec ?? 0;
      if (dur <= 0) return;
      AudioEngine.seekAudioTrack(track.id, pos * dur);
    },
    [runtime.durationSec, track.id],
  );

  // ── Peaks für die Wellenform ─────────────────────────────────────────────
  // Bevorzugt die im Store gecachten Runtime-Peaks; falls keine vorhanden,
  // einmalig aus dem Engine-Buffer berechnen (computePeaksFromBuffer aus
  // TASK-245). Stabile Referenz via useMemo gegen Re-Render-Flackern.
  const peaks = useMemo<number[]>(() => {
    if (runtime.peaks && runtime.peaks.length > 0) {
      return Array.from(runtime.peaks);
    }
    const buf = AudioEngine.getAudioTrackBuffer(track.id);
    if (buf) {
      return Array.from(computePeaksFromBuffer(buf, 200));
    }
    return [];
    // runtime.peaks-Referenz + track.id reichen als Deps; Buffer ist stabil
    // solange der Track geladen ist.
  }, [runtime.peaks, track.id]);

  const labelColor = audioLaneLabelColorClass({
    broken,
    muted: track.muted,
    soloed: track.soloed,
  });

  const waveColor = resolveChannelColor(track.color, laneIndex);

  return (
    <div
      data-testid={`audio-clip-lane-${track.id}`}
      data-track-id={track.id}
      className={[
        "flex items-center gap-1 px-2 py-1 border-b border-border-color/50 relative",
        "transition-colors duration-75",
        // Dim wenn gemutet ODER durch eine fremde Solo-Lane stummgeschaltet.
        track.muted || !audible ? "opacity-50" : "hover:bg-bg-panel/40",
      ].join(" ")}
      style={{
        // Linker Farb-Tint (2px), konsistent zu ChannelStrip.
        boxShadow: `inset 2px 0 0 0 ${waveColor}`,
      }}
    >
      {/* ── Header-Spalte (gleiche Breite wie ChannelStrip: w-[88px]) ────── */}
      <div className="w-[88px] flex-shrink-0">
        <div className="flex items-center gap-1 leading-tight">
          <span
            className={[
              "text-[10px] font-medium truncate flex-1 min-w-0",
              labelColor,
            ].join(" ")}
            title={track.name}
          >
            {track.name}
          </span>
          <span
            className="text-[8px] px-1 rounded bg-bg-elevated text-accent-secondary flex-shrink-0"
            title="Audio-Clip (continuous, kein Step-Grid)"
          >
            CLIP
          </span>
        </div>
        <div
          className="text-[9px] truncate leading-tight text-text-dim"
          title={track.fileName}
        >
          {broken ? "⚠ Datei fehlt" : (track.fileName || "—")}
        </div>
      </div>

      {/* ── M / S ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-0.5 flex-shrink-0">
        <button
          type="button"
          data-testid={`audio-clip-lane-mute-${track.id}`}
          onClick={(e) => {
            e.stopPropagation();
            handleMute();
          }}
          disabled={broken}
          aria-label="Mute"
          aria-pressed={track.muted}
          title="Mute"
          className={[
            "w-5 h-4 rounded text-[8px] font-bold transition-colors",
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
          data-testid={`audio-clip-lane-solo-${track.id}`}
          onClick={(e) => {
            e.stopPropagation();
            handleSolo({ shiftKey: e.shiftKey });
          }}
          disabled={broken}
          aria-label="Solo"
          aria-pressed={track.soloed}
          title="Solo — Shift+Click = exclusive (un-solo't andere Audio-Tracks)"
          className={[
            "w-5 h-4 rounded text-[8px] font-bold transition-colors",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            track.soloed
              ? "bg-accent-primary text-text-primary"
              : "bg-bg-elevated text-text-dim hover:text-accent-primary",
          ].join(" ")}
        >
          S
        </button>
      </div>

      {/* ── Play / Stop (eigener Lane-Transport) ─────────────────────────── */}
      <button
        type="button"
        data-testid={`audio-clip-lane-play-${track.id}`}
        onClick={(e) => {
          e.stopPropagation();
          handlePlayStop();
        }}
        disabled={broken}
        aria-label={playing ? "Stop" : "Play"}
        aria-pressed={playing}
        title={playing ? "Stop" : "Play (nur dieser Clip)"}
        className={[
          "w-6 h-6 flex items-center justify-center rounded transition-colors flex-shrink-0",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          playing
            ? "bg-accent-primary text-text-primary"
            : "bg-bg-elevated text-text-dim hover:text-accent-primary",
        ].join(" ")}
      >
        {playing ? <Square size={11} /> : <Play size={11} />}
      </button>

      {/* ── Continuous Waveform (füllt die restliche Breite) ─────────────── */}
      <div className="flex-1 min-w-0">
        <WaveformDisplay
          peaks={peaks}
          duration={runtime.durationSec ?? 0}
          playbackPosition={pos01}
          isPlaying={playing}
          onSeek={handleSeek}
          height={40}
          color={waveColor}
          backgroundColor="var(--ss-bg-elevated)"
          zoomEnabled={false}
        />
      </div>
    </div>
  );
});

/**
 * Liste aller Audio-Clip-Lanes. Abonniert den Audio-Track-Store HIER (nicht im
 * DrumMachine-Body) — so isoliert sich Track-Add/Remove/Mute-State von der
 * memoisierten DrumMachine (TASK-247-Constraint). Rendert nichts, wenn keine
 * Audio-Tracks vorhanden sind.
 */
export const AudioClipLaneList = memo(function AudioClipLaneList(): React.ReactElement | null {
  const { tracks } = useAudioTrackStore();
  const lanes = resolveAudioLanes(tracks);
  if (lanes.length === 0) return null;
  return (
    <div data-testid="audio-clip-lane-list">
      {lanes.map((tr, i) => (
        <AudioClipLane
          key={tr.id}
          track={tr}
          // Runtime-State als frisches Objekt pro notify (getRuntimeState) —
          // sonst würde der Memo-Comparator der Lane Peaks/Duration/broken-
          // Updates blockieren (track-Ref bleibt unverändert).
          runtime={getRuntimeState(tr.id)}
          laneIndex={i}
          // Solo-Dim: hörbar = nicht-gemutet UND (kein Solo aktiv ODER selbst soloed).
          audible={isAudioLaneAudible(tr, lanes)}
        />
      ))}
    </div>
  );
});
