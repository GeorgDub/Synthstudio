/**
 * Synthstudio – CollabSplitView.tsx (v1.11)
 *
 * Splitscreen-Ansicht für aktive Kollaborations-Sessions.
 * Wird als Vollbild-Overlay gerendert wenn eine Session aktiv ist.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │  [Ich] [Partner] [Beide]  │ Raum: XXXX  │ Session beenden │
 *   ├───────────────────┬───────────────────────────────────┤
 *   │   Mein Sequencer  │   Partner-Sequencer               │
 *   │   (interaktiv)    │   (live-aktualisiert + klickbar)   │
 *   └───────────────────┴───────────────────────────────────┘
 *
 * Ausgabe-Modus-Buttons steuern welche Audioquelle lokal abgespielt wird:
 *   "Ich"     – Nur meine Patterns spielen Audio lokal
 *   "Partner" – Nur Partner-Transport-Events steuern lokales Audio
 *   "Beide"   – Beide transports sind aktiv (Standard)
 */

import React, { useMemo, useState } from "react";
import { DrumMachine } from "@/components/DrumMachine";
import { useRemotePeerStore, setRemotePartMuted, setRemotePartVolume } from "@/store/useRemotePeerStore";
import { useSessionStore } from "@/store/useSessionStore";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { OutputMode } from "@/hooks/useCollabSync";
import type { Sample } from "@/store/useProjectStore";
import type { ChannelFx, StepCondition, StepResolution } from "@/audio/AudioEngine";

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Props {
  /** Lokales DrumMachine-dm-Objekt (collabDm aus App.tsx) */
  localDm: DrumMachineState & DrumMachineActions;
  /** Lokale Sample-Bibliothek */
  samples: Sample[];
  /** Lokales BPM */
  bpm: number;
  /** Lokaler Wiedergabe-Status */
  isPlaying: boolean;
  /** Lokaler Play/Stop-Handler (collabPlayStop) */
  onPlayStop: () => void;
  /** Lokaler BPM-Änderungs-Handler */
  onBpmChange: (bpm: number) => void;
  /** Aktueller Output-Modus */
  outputMode: OutputMode;
  /** Output-Modus-Änderungs-Handler */
  onOutputModeChange: (mode: OutputMode) => void;
  /** Partner-Step umschalten + broadcast */
  remoteToggleStep: (partId: string, stepIndex: number) => void;
  /** Partner-Pattern wechseln + broadcast */
  remoteSetActivePattern: (patternId: string) => void;
  /** Session-Ende-Handler */
  onLeave: () => void;
}

// ─── Hilfsfunktion: Remote-DrumMachine-Adapter ───────────────────────────────

/**
 * Erstellt ein DrumMachineState & DrumMachineActions kompatibles Objekt
 * aus dem Remote-Peer-Store. Aktionen werden per broadcast an den Partner gesendet.
 */
function useRemoteDmAdapter(
  remote: ReturnType<typeof useRemotePeerStore>,
  remoteToggleStep: (partId: string, stepIndex: number) => void,
  remoteSetActivePattern: (patternId: string) => void,
): DrumMachineState & DrumMachineActions {
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [velocityMode, setVelocityMode] = useState(false);
  const [pitchMode, setPitchMode] = useState(false);
  const [fxPanelPartId, setFxPanelPartId] = useState<string | null>(null);

  return useMemo(() => {
    const noop = () => {};

    return {
      // ── State ──────────────────────────────────────────────────
      patterns: remote.patterns,
      activePatternId: remote.activePatternId ?? (remote.patterns[0]?.id ?? ""),
      activePartId,
      currentStep: 0, // Kein Playhead für Remote-Ansicht
      velocityMode,
      pitchMode,
      fxPanelPartId,

      // ── Berechneter Getter ──────────────────────────────────────
      getActivePattern: () =>
        remote.patterns.find(p => p.id === (remote.activePatternId ?? remote.patterns[0]?.id)),

      // ── Interaktive Actions (mit broadcast) ────────────────────
      toggleStep: remoteToggleStep,
      setActivePattern: remoteSetActivePattern,
      setActivePart: (id: string | null) => setActivePartId(id),
      setVelocityMode: (v: boolean) => setVelocityMode(v),
      setPitchMode: (v: boolean) => setPitchMode(v),
      setFxPanelPartId: (id: string | null) => setFxPanelPartId(id),

      setPartMuted: (partId: string, muted: boolean) => {
        setRemotePartMuted(partId, muted);
        // broadcast passiert über useCollabSync – hier nur lokaler Update für UI-Feedback
      },

      setPartVolume: (partId: string, volume: number) => {
        setRemotePartVolume(partId, volume);
      },

      // ── Undo/Redo (deaktiviert für Remote-Ansicht) ──────────────
      undo: noop,
      redo: noop,
      canUndo: false,
      canRedo: false,

      // ── Strukturelle Änderungen (No-Ops für Remote-Ansicht) ────
      addPattern: noop,
      removePattern: noop,
      renamePattern: noop,
      duplicatePattern: noop,
      setPatternBpm: noop,
      setPatternStepResolution: noop,
      addPart: noop,
      removePart: noop,
      renamePart: noop,
      setPartSample: noop,
      setPartSoloed: noop,
      setPartPan: noop,
      setPartStepResolution: noop,
      movePart: noop,
      setPartFx: (_partId: string, _fx: Partial<ChannelFx>) => { /* no-op */ },
      setPartSteps: noop,
      setStepVelocity: noop,
      setStepPitch: noop,
      setStepProbability: noop,
      setStepCondition: (_partId: string, _stepIndex: number, _condition: StepCondition) => { /* no-op */ },
      setPartEuclidean: noop,
      clearPattern: noop,
      fillPattern: noop,
      randomizePattern: noop,
      shiftPattern: noop,
      setStepCount: noop,
      setCurrentStep: noop,
    } as DrumMachineState & DrumMachineActions;
    // Memoize auf remote-State + lokale Adapter-State
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, activePartId, velocityMode, pitchMode, fxPanelPartId, remoteToggleStep, remoteSetActivePattern]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CollabSplitView({
  localDm,
  samples,
  bpm,
  isPlaying,
  onPlayStop,
  onBpmChange,
  outputMode,
  onOutputModeChange,
  remoteToggleStep,
  remoteSetActivePattern,
  onLeave,
}: Props) {
  const remote = useRemotePeerStore();
  const session = useSessionStore();

  const remoteDm = useRemoteDmAdapter(remote, remoteToggleStep, remoteSetActivePattern);

  const outputModeLabels: Record<OutputMode, string> = {
    me: "Ich",
    partner: "Partner",
    both: "Beide",
  };

  return (
    <div className="fixed inset-0 z-40 bg-[#0a0a0a] flex flex-col select-none">

      {/* ── Top-Bar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[#0d0d0d] border-b border-slate-800 flex-shrink-0">

        {/* Titel */}
        <span className="text-xs font-bold text-cyan-400 tracking-widest uppercase">
          Kollaboration
        </span>

        {/* Session-Code */}
        {session.sessionCode && (
          <span className="text-xs text-slate-600 font-mono">
            · Raum <span className="text-slate-400 font-bold">{session.sessionCode}</span>
          </span>
        )}

        {/* Teilnehmer-Badges */}
        <div className="flex items-center gap-1 ml-1">
          {session.participants.map(p => (
            <div
              key={p.userId}
              title={p.userName}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border"
              style={{ borderColor: p.color, color: p.color }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: p.color }}
              />
              {p.userName}
            </div>
          ))}
        </div>

        <div className="flex-1" />

        {/* ── Ausgabe-Modus-Selector ─────────────────────────── */}
        <div className="flex items-center gap-0.5 rounded border border-slate-700 p-0.5">
          <span className="text-[10px] text-slate-600 px-2">Ausgabe:</span>
          {(["me", "partner", "both"] as OutputMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onOutputModeChange(mode)}
              title={
                mode === "me"
                  ? "Nur dein Audio läuft lokal"
                  : mode === "partner"
                    ? "Nur Partner-Audio läuft lokal"
                    : "Beide Audios laufen gleichzeitig"
              }
              className={[
                "px-3 py-1 text-[10px] rounded transition-colors duration-100",
                outputMode === mode
                  ? "bg-cyan-700 text-white"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800",
              ].join(" ")}
            >
              {outputModeLabels[mode]}
            </button>
          ))}
        </div>

        {/* Session beenden */}
        <button
          onClick={onLeave}
          className="px-3 py-1 text-xs rounded bg-slate-800 text-slate-400 hover:bg-red-900/40 hover:text-red-400 transition-colors duration-100"
        >
          ✕ Beenden
        </button>
      </div>

      {/* ── Split-Bereich ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Linke Hälfte: Mein Sequencer ─────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-slate-800/60 min-w-0">
          <div className="px-4 py-1 bg-[#111] border-b border-slate-800 flex-shrink-0 flex items-center gap-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">
              Mein Sequencer
            </span>
            {outputMode === "me" && (
              <span className="text-[9px] text-cyan-600 border border-cyan-800 rounded px-1 py-px">
                AKTIV
              </span>
            )}
            {outputMode === "both" && (
              <span className="text-[9px] text-green-600 border border-green-800 rounded px-1 py-px">
                AKTIV
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            <DrumMachine
              dm={localDm}
              samples={samples}
              isPlaying={isPlaying}
              bpm={bpm}
              onPlayStop={onPlayStop}
              onBpmChange={onBpmChange}
              className="h-full"
            />
          </div>
        </div>

        {/* ── Rechte Hälfte: Partner-Sequencer ─────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div
            className="px-4 py-1 bg-[#111] border-b border-slate-800 flex-shrink-0 flex items-center gap-2"
            style={{
              borderBottomColor: remote.color ? `${remote.color}40` : undefined,
            }}
          >
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">
              Partner
            </span>
            {remote.userName ? (
              <>
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: remote.color ?? "#7c3aed" }}
                />
                <span className="text-[10px]" style={{ color: remote.color ?? "#7c3aed" }}>
                  {remote.userName}
                </span>
              </>
            ) : (
              <span className="text-[10px] text-slate-600 italic">Verbindet…</span>
            )}
            {outputMode === "partner" && (
              <span className="text-[9px] text-purple-500 border border-purple-800 rounded px-1 py-px ml-auto">
                AKTIV
              </span>
            )}
            {outputMode === "both" && (
              <span className="text-[9px] text-green-600 border border-green-800 rounded px-1 py-px ml-auto">
                AKTIV
              </span>
            )}
          </div>

          <div className="flex-1 overflow-hidden min-h-0">
            {remote.patterns.length === 0 ? (
              /* Wartezustand – kein Snapshot empfangen */
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
                <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-cyan-600 animate-spin" />
                <p className="text-sm text-slate-500">
                  Warte auf Snapshot des Partners…
                </p>
                <p className="text-xs text-slate-700">
                  Der Partner-Sequencer erscheint sobald eine Verbindung besteht.
                </p>
              </div>
            ) : (
              <DrumMachine
                dm={remoteDm}
                samples={remote.samples}
                isPlaying={remote.isPlaying}
                bpm={remote.bpm}
                onPlayStop={() => { /* Remote-Transport via collabPlayStop im Header */ }}
                onBpmChange={() => { /* Remote-BPM read-only */ }}
                className="h-full"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
