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
import { Play, Square, Sliders } from "lucide-react";
import {
  AudioEngine,
  DEFAULT_CHANNEL_FX,
  type AudioTrackChannelData,
  type ChannelFx,
} from "@/audio/AudioEngine";
import {
  updateAudioTrack,
  setAudioTrackSoloed,
  setAudioTrackFx,
  getRuntimeState,
  useAudioTrackStore,
  type AudioTrackRuntimeState,
} from "@/store/useAudioTrackStore";
import {
  computePeaksFromBuffer,
  nextAudioTrackPlayState,
} from "@/components/Mixer/AudioTrackStrip";
import { FxPanelBody } from "@/components/DrumMachine/FxPanel";
import { useMidiLearn } from "@/hooks/useMidiLearn";
import { WaveformDisplay } from "@/components/WaveformDisplay/WaveformDisplay";
import { resolveChannelColor } from "@/utils/channelColors";
import {
  audioLaneLabelColorClass,
  isAudioLaneAudible,
  laneStateOnGlobalChange,
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
  // TASK-267: ENTKOPPELT vom globalen Transport — der per-Lane-Button kann jede
  // Lane unabhängig starten/stoppen, auch während Global läuft. `playing` ist die
  // alleinige Quelle für Button + Playhead; es wird via laneStateOnGlobalChange
  // wahrheitsgemäß auf das gesynct, was die Engine bei Global-Play/-Stop TUT.
  // Init aus dem Live-Getter, damit eine mid-playback gemountete Lane (Track
  // während laufendem Transport hinzugefügt / Tab-Wechsel) sofort korrekt startet
  // (onPlayStateChange feuert nur bei ÄNDERUNG, nicht beim Mount).
  const broken = runtime.broken === true;
  const [playing, setPlaying] = useState(() =>
    laneStateOnGlobalChange(AudioEngine.isPlaying, {
      muted: track.muted,
      broken,
    })
  );
  const [pos01, setPos01] = useState(0);
  // Right-Click-MIDI-Learn für Mute/Solo dieser Lane (Volume/Pan sitzen im
  // Mixer-Strip). FX-Params sind bereits über FxPanelBody (fxParam-Target)
  // lernbar. trackId ist "audiotrack:…" → useMidiEventBridge routet korrekt.
  const muteLearn = useMidiLearn({
    type: "audioTrackMute",
    trackId: track.id,
    trackName: track.name,
  });
  const soloLearn = useMidiLearn({
    type: "audioTrackSolo",
    trackId: track.id,
    trackName: track.name,
  });
  // TASK-268-FOLLOWUP: Insert-FX-Panel (collapsible) — gespiegelt vom Mixer-Strip.
  // NUR der Toggle ist component-local; die FX-WERTE leben in track.fx (Store),
  // damit Strip + Lane denselben State derselben Lane bidirektional teilen.
  const [fxOpen, setFxOpen] = useState(false);

  // Effektiver "spielt"-Zustand = lokales playing (nach TASK-267 keine OR mehr).
  const effectivePlaying = playing;

  // ── Globaler Play/Stop (self-subscribed) ─────────────────────────────────
  // TASK-267: Synct den lokalen `playing` auf das, was die Engine bei Global-Play
  // tatsächlich startet — playAllRegisteredAudioTracks() startet diese Lane NUR
  // wenn !muted && !broken; Global-Stop killt ALLE Voices. So bleibt der lokale
  // State wahrheitsgemäß, der per-Lane-Button bleibt entkoppelt (siehe handlePlayStop).
  // Deps: muted/broken werden gelesen → MÜSSEN in der Dep-Liste stehen (sonst
  // stale-closure: erst muten, dann Global-Play würde fälschlich playing setzen).
  useEffect(() => {
    const unsub = AudioEngine.onPlayStateChange(p => {
      setPlaying(laneStateOnGlobalChange(p, { muted: track.muted, broken }));
    });
    return unsub;
  }, [track.muted, broken]);

  // ── Playhead-Position (self-subscribed) ──────────────────────────────────
  // TASK-252-FOLLOWUP: Beim (spaeten) Mount waehrend laufendem Transport — z.B.
  // Tab-Wechsel auf den Sequencer waehrend Global-Play — liefert der Position-rAF
  // den ersten Wert erst beim naechsten Frame. Ohne Seed blitzte der Playhead bei
  // 0 auf, obwohl Audio laeuft. Wir fragen die Engine daher synchron ab und seeden
  // pos01 sofort, falls der Track bereits spielt. Der rAF uebernimmt danach.
  useEffect(() => {
    if (AudioEngine.isAudioTrackPlaying(track.id)) {
      setPos01(AudioEngine.getAudioTrackPosition(track.id));
    }
    const unsub = AudioEngine.onAudioTrackPosition(track.id, p => setPos01(p));
    return unsub;
  }, [track.id]);

  // onEnded → playing zurücksetzen (natürliches Track-Ende, kein Loop).
  useEffect(() => {
    const unsub = AudioEngine.onAudioTrackEnded(track.id, () => {
      setPlaying(p => nextAudioTrackPlayState(p, "ended"));
    });
    return unsub;
  }, [track.id]);

  // Wenn (effektiv) nicht aktiv → Playhead resetten. effectivePlaying statt
  // playing, damit der Playhead bei Global-Play NICHT auf 0 zurückgesetzt wird
  // (sonst würde der per onAudioTrackPosition gespeiste Playhead überschrieben).
  useEffect(() => {
    if (!effectivePlaying) setPos01(0);
  }, [effectivePlaying]);

  // ── Play / Stop (entkoppelter Lane-Transport, TASK-267) ───────────────────
  // Startet/stoppt NUR diese Lane — unabhängig vom globalen Transport. Manueller
  // Stop während Global läuft killt diese eine Voice; sie bleibt gestoppt bis zu
  // einem manuellen Start ODER dem nächsten Global stop→play-Zyklus (der ruft
  // playAllRegisteredAudioTracks erneut → onPlayStateChange-Sync oben).
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
    [track.id, track.soloed]
  );

  // ── Seek (Klick in die Wellenform) ───────────────────────────────────────
  const handleSeek = useCallback(
    (pos: number) => {
      const dur = runtime.durationSec ?? 0;
      if (dur <= 0) return;
      AudioEngine.seekAudioTrack(track.id, pos * dur);
    },
    [runtime.durationSec, track.id]
  );

  // ── Insert-FX (TASK-268-FOLLOWUP) ────────────────────────────────────────
  // Identische Dual-Call-Seam wie der Mixer-Strip (setAudioTrackFx → Store +
  // AudioEngine.setAudioTrackFx → audible). Die WERTE kommen aus track.fx (NICHT
  // local state) — dadurch teilen Strip-Panel und Lane-Panel denselben Store-
  // State derselben Lane bidirektional (gleiche Mechanik wie Mute/Solo). Bei
  // fehlender fx (Pre-TASK-268-Track) auf DEFAULT_CHANNEL_FX zurückfallen.
  const trackFx: ChannelFx = track.fx ?? DEFAULT_CHANNEL_FX;
  const handleFxChange = useCallback(
    (partial: Partial<ChannelFx>) => {
      setAudioTrackFx(track.id, partial);
      AudioEngine.setAudioTrackFx(track.id, partial);
    },
    [track.id]
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
        "flex flex-col border-b border-border-color/50 relative",
        "transition-colors duration-75",
        // Dim wenn gemutet ODER durch eine fremde Solo-Lane stummgeschaltet.
        track.muted || !audible ? "opacity-50" : "hover:bg-bg-panel/40",
      ].join(" ")}
      style={{
        // Linker Farb-Tint (2px), konsistent zu ChannelStrip.
        boxShadow: `inset 2px 0 0 0 ${waveColor}`,
      }}
    >
      {/* ── Obere Zeile: bestehende horizontale Row (Header/M/S/Play/FX/Waveform) ── */}
      <div className="flex items-center gap-1 px-2 py-1">
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
            {broken ? "⚠ Datei fehlt" : track.fileName || "—"}
          </div>
        </div>

        {/* ── M / S ────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button
            type="button"
            data-testid={`audio-clip-lane-mute-${track.id}`}
            onClick={e => {
              e.stopPropagation();
              handleMute();
            }}
            onContextMenu={muteLearn.onContextMenu}
            disabled={broken}
            aria-label="Mute"
            aria-pressed={track.muted}
            title="Mute — Rechtsklick: MIDI-Learn"
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
            onClick={e => {
              e.stopPropagation();
              handleSolo({ shiftKey: e.shiftKey });
            }}
            onContextMenu={soloLearn.onContextMenu}
            disabled={broken}
            aria-label="Solo"
            aria-pressed={track.soloed}
            title="Solo — Shift+Click = exclusive · Rechtsklick: MIDI-Learn"
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
          {muteLearn.menu}
          {soloLearn.menu}
        </div>

        {/* ── Play / Stop (eigener Lane-Transport) ─────────────────────────── */}
        <button
          type="button"
          data-testid={`audio-clip-lane-play-${track.id}`}
          onClick={e => {
            e.stopPropagation();
            handlePlayStop();
          }}
          disabled={broken}
          aria-label={effectivePlaying ? "Stop" : "Play"}
          aria-pressed={effectivePlaying}
          title={
            effectivePlaying
              ? "Stop (nur dieser Clip)"
              : "Play (nur dieser Clip)"
          }
          className={[
            "w-6 h-6 flex items-center justify-center rounded transition-colors flex-shrink-0",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            effectivePlaying
              ? "bg-accent-primary text-text-primary"
              : "bg-bg-elevated text-text-dim hover:text-accent-primary",
          ].join(" ")}
        >
          {effectivePlaying ? <Square size={11} /> : <Play size={11} />}
        </button>

        {/* ── Insert-FX Toggle (TASK-268-FOLLOWUP) ─────────────────────────── */}
        <button
          type="button"
          data-testid={`audio-clip-lane-fx-toggle-${track.id}`}
          onClick={e => {
            e.stopPropagation();
            setFxOpen(v => !v);
          }}
          aria-label="FX"
          aria-pressed={fxOpen}
          title="Insert-FX (Filter, EQ, Comp, Delay, Reverb)"
          className={[
            "w-6 h-6 flex items-center justify-center rounded transition-colors flex-shrink-0",
            fxOpen
              ? "bg-accent-secondary text-text-primary"
              : "bg-bg-elevated text-text-dim hover:text-accent-secondary",
          ].join(" ")}
        >
          <Sliders size={11} />
        </button>

        {/* ── Continuous Waveform (füllt die restliche Breite) ─────────────── */}
        <div className="flex-1 min-w-0">
          <WaveformDisplay
            peaks={peaks}
            duration={runtime.durationSec ?? 0}
            playbackPosition={pos01}
            isPlaying={effectivePlaying}
            onSeek={handleSeek}
            height={40}
            color={waveColor}
            backgroundColor="var(--ss-bg-elevated)"
            zoomEnabled={false}
          />
        </div>
      </div>

      {/* ── Insert-FX-Panel (TASK-268-FOLLOWUP) ──────────────────────────── */}
      {/* Volle Breite unter der Row. Dieselbe FxPanelBody + derselbe Right-Click-
          MIDI-Learn (partId/partName) wie der Mixer-Strip. Die FX-WERTE kommen aus
          track.fx (Store) — Strip und Lane teilen denselben State derselben Lane. */}
      {fxOpen && (
        <div
          data-testid={`audio-clip-lane-fx-panel-${track.id}`}
          onClick={e => e.stopPropagation()}
          className="w-full px-2 pb-2 pt-1"
        >
          <div className="px-1.5 py-2 rounded border border-border-subtle bg-bg-elevated/60">
            <FxPanelBody
              fx={trackFx}
              onFxChange={handleFxChange}
              partId={track.id}
              partName={track.name}
            />
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Liste aller Audio-Clip-Lanes. Abonniert den Audio-Track-Store HIER (nicht im
 * DrumMachine-Body) — so isoliert sich Track-Add/Remove/Mute-State von der
 * memoisierten DrumMachine (TASK-247-Constraint). Rendert nichts, wenn keine
 * Audio-Tracks vorhanden sind.
 */
export const AudioClipLaneList = memo(
  function AudioClipLaneList(): React.ReactElement | null {
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
  }
);
