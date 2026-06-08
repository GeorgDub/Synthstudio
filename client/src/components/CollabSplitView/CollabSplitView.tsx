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
import { SampleBrowser } from "@/components/SampleBrowser";
import { useRemotePeerStore, setRemotePartMuted, setRemotePartVolume } from "@/store/useRemotePeerStore";
import { useSessionStore } from "@/store/useSessionStore";
import type { DrumMachineState, DrumMachineActions } from "@/store/useDrumMachineStore";
import type { OutputMode } from "@/hooks/useCollabSync";
import type { Sample } from "@/store/useProjectStore";
import type { ChannelFx, StepCondition } from "@/audio/AudioEngine";

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
  // ── SampleBrowser-Props (weitergeleitet aus App.tsx) ─────────
  onImportSamples: (paths: string[]) => void;
  onImportFolder?: (folderPath: string) => void;
  onRemoveSample?: (id: string) => void;
  onSamplesImported?: (samples: Sample[]) => void;
  onAssignToChannel?: (sampleUrl: string, sampleName: string) => void;
  onUpdateSampleCategory?: (id: string, category: string) => void;
  onReorderSamples?: (draggedId: string, targetId: string) => void;
  activeChannelName?: string;
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
      playbackPatternId: null,
      liveEditSourcePatternId: null,
      commitPending: false,
      activePartId,
      currentStep: 0, // Kein Playhead für Remote-Ansicht
      velocityMode,
      pitchMode,
      fxPanelPartId,

      // ── Berechneter Getter ──────────────────────────────────────
      getActivePattern: () =>
        remote.patterns.find(p => p.id === (remote.activePatternId ?? remote.patterns[0]?.id)),
      getPlaybackPattern: () =>
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
      copySamplesFromPattern: noop,
      reorderPatterns: noop,
      startLivePatternEdit: noop,
      commitLivePatternEdit: noop,
      cancelLivePatternEdit: noop,
      scheduleCommit: noop,
      setPatternFollowAction: noop,
      setStepReverse: noop,
      setStepParamLock: noop,
      setStepLength: noop,
      setStepChainNext: noop,
      quantizePartSteps: noop,
      setPartStretchRatio: noop,
      setPartMicroTiming: noop,
      setPatternBpmRatio: noop,
      setPatternBpmTransitionBars: noop,
      toggleStackedPattern: noop,
      clearStackedPatterns: noop,
      stackedPatternIds: [],
      setPartSourceType: noop,
      setPartGranularParams: noop,
      applyPatchToPart: noop,
      setPatternBpm: noop,
      setPatternStepResolution: noop,
      addPart: noop,
      removePart: noop,
      renamePart: noop,
      setPartSample: noop,
      setPartSoloed: noop,
      setPartPan: noop,
      setPartColor: noop,
      setPartStepResolution: noop,
      setPartStepLength: noop,
      addPatternData: () => "",
      addPatternsData: () => [],
      applyImportedSamples: noop,
      movePart: noop,
      setPartFx: (_partId: string, _fx: Partial<ChannelFx>) => { /* no-op */ },
      setPartSteps: noop,
      setStepVelocity: noop,
      setStepPitch: noop,
      setStepProbability: noop,
      setStepSlide: noop,
      setStepCondition: (_partId: string, _stepIndex: number, _condition: StepCondition) => { /* no-op */ },
      setPartEuclidean: noop,
      clearPattern: noop,
      resetAll: noop,
      fillPattern: noop,
      randomizePattern: noop,
      shiftPattern: noop,
      setStepCount: noop,
      applyStepCountToAllPatterns: noop,
      setCurrentStep: noop,
    } as DrumMachineState & DrumMachineActions;
    // Memoize auf remote-State + lokale Adapter-State
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, activePartId, velocityMode, pitchMode, fxPanelPartId, remoteToggleStep, remoteSetActivePattern]);
}

// ─── Partner-Sample-Browser (kompakte Sidebar) ────────────────────────────────

const CATEGORIES = ["Alle", "Kicks", "Snares", "Hi-Hats", "Claps", "Toms", "Perc", "FX", "Loops", "Vocals", "Sonstige"];

function PartnerSampleBrowser({
  samples,
  partnerColor,
  onAddToLibrary,
}: {
  samples: Array<{ id: string; name: string; path: string; category: string }>;
  partnerColor: string | null;
  onAddToLibrary?: (sample: { id: string; name: string; path: string; category: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Alle");

  const filtered = useMemo(() => {
    return samples.filter(s => {
      const matchCat = category === "Alle" || s.category === category;
      const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [samples, category, search]);

  const accent = partnerColor ?? "#7c3aed";

  const handleDragStart = (e: React.DragEvent, sample: { name: string; path: string }) => {
    e.dataTransfer.setData("sampleUrl", sample.path);
    e.dataTransfer.setData("sampleName", sample.name);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside className="w-52 flex-shrink-0 border-l border-border-color flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="px-3 py-1.5 bg-bg-elevated border-b border-border-color flex-shrink-0 flex items-center gap-1.5"
        style={{ borderBottomColor: `${accent}40` }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: accent }}
        />
        <span className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>
          Partner-Samples
        </span>
      </div>

      {/* Suchfeld */}
      <div className="px-2 pt-2 pb-1 flex-shrink-0">
        <input
          type="text"
          placeholder="Suchen…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-bg-panel border border-border-color rounded text-[10px] text-text-primary placeholder-text-dim px-2 py-1 outline-none focus:border-accent-primary"
        />
      </div>

      {/* Kategorie-Filter */}
      <div className="px-2 pb-1 flex flex-wrap gap-1 flex-shrink-0">
        {CATEGORIES.filter(c => c === "Alle" || samples.some(s => s.category === c)).map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={[
              "text-[9px] px-1.5 py-0.5 rounded transition-colors",
              category === cat
                ? "text-black"
                : "bg-bg-elevated text-text-dim hover:bg-bg-elevated",
            ].join(" ")}
            style={category === cat ? { background: accent, color: "#000" } : {}}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Sample-Liste */}
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {filtered.length === 0 ? (
          <div className="text-[10px] text-text-dim text-center mt-4 px-3">
            {samples.length === 0
              ? "Partner hat noch keine Samples"
              : "Keine Treffer"}
          </div>
        ) : (
          filtered.map(sample => (
            <div
              key={sample.id}
              draggable
              onDragStart={e => handleDragStart(e, sample)}
              className="flex items-center gap-1.5 px-2 py-1 rounded cursor-grab hover:bg-bg-elevated/60 transition-colors group"
              title={`Auf eigenen Kanal ziehen: ${sample.name}`}
            >
              <span
                className="text-[9px] flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
                style={{ color: accent }}
              >
                ⠿
              </span>
              <span className="text-[10px] text-text-muted group-hover:text-text-primary truncate transition-colors flex-1">
                {sample.name}
              </span>
              {onAddToLibrary && (
                <button
                  onClick={e => { e.stopPropagation(); onAddToLibrary(sample); }}
                  className="text-[9px] text-text-dim hover:text-accent-success opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 px-1"
                  title="Zu meiner Library hinzufügen"
                >
                  +→
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {samples.length > 0 && (
        <div className="px-2 py-1 border-t border-border-color flex-shrink-0">
          <p className="text-[9px] text-text-dim text-center">
            {filtered.length}/{samples.length} · ziehen zum Zuweisen
          </p>
        </div>
      )}
    </aside>
  );
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
  onImportSamples,
  onImportFolder,
  onRemoveSample,
  onSamplesImported,
  onAssignToChannel,
  onUpdateSampleCategory,
  onReorderSamples,
  activeChannelName,
}: Props) {
  const remote = useRemotePeerStore();
  const session = useSessionStore();
  const [showSampleBrowser, setShowSampleBrowser] = useState(true);

  const remoteDm = useRemoteDmAdapter(remote, remoteToggleStep, remoteSetActivePattern);

  const outputModeLabels: Record<OutputMode, string> = {
    me: "Ich",
    partner: "Partner",
    both: "Beide",
  };

  return (
    <div className="fixed inset-0 z-40 bg-bg-base flex flex-col select-none">

      {/* ── Top-Bar ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 bg-bg-panel border-b border-border-color flex-shrink-0">

        {/* Titel */}
        <span className="text-xs font-bold text-accent-secondary tracking-widest uppercase">
          Kollaboration
        </span>

        {/* Session-Code */}
        {session.sessionCode && (
          <span className="text-xs text-text-dim font-mono">
            · Raum <span className="text-text-muted font-bold">{session.sessionCode}</span>
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
        <div className="flex items-center gap-0.5 rounded border border-border-color p-0.5">
          <span className="text-[10px] text-text-dim px-2">Ausgabe:</span>
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
                  ? "bg-accent-primary/70 text-bg-base"
                  : "text-text-dim hover:text-text-primary hover:bg-bg-elevated",
              ].join(" ")}
            >
              {outputModeLabels[mode]}
            </button>
          ))}
        </div>

        {/* Session beenden */}
        <button
          onClick={onLeave}
          className="px-3 py-1 text-xs rounded bg-bg-elevated text-text-muted hover:bg-accent-danger/20 hover:text-accent-danger transition-colors duration-100"
        >
          ✕ Beenden
        </button>
      </div>

      {/* ── Haupt-Layout: Sidebar + Split ─────────────────────── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Sample-Browser-Sidebar ────────────────────────── */}
        {showSampleBrowser && (
          <aside className="w-64 flex-shrink-0 border-r border-border-color overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-1 bg-bg-elevated border-b border-border-color flex-shrink-0">
              <span className="text-[10px] text-text-dim uppercase tracking-widest">Samples</span>
              <button
                onClick={() => setShowSampleBrowser(false)}
                className="text-text-dim hover:text-text-muted text-xs leading-none"
                title="Samples ausblenden"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              <SampleBrowser
                samples={samples}
                onImportSamples={onImportSamples}
                onImportFolder={onImportFolder}
                onRemoveSample={onRemoveSample}
                onSamplesImported={onSamplesImported}
                onAssignToChannel={onAssignToChannel}
                activeChannelName={activeChannelName}
                onUpdateSampleCategory={onUpdateSampleCategory}
                onReorderSamples={onReorderSamples}
              />
            </div>
          </aside>
        )}

        {/* Samples-Button wenn Sidebar ausgeblendet */}
        {!showSampleBrowser && (
          <button
            onClick={() => setShowSampleBrowser(true)}
            title="Sample-Browser einblenden"
            className="flex-shrink-0 w-7 bg-bg-panel border-r border-border-color flex items-center justify-center text-text-dim hover:text-text-primary hover:bg-bg-elevated transition-colors"
            style={{ writingMode: "vertical-rl" }}
          >
            <span className="text-[10px] tracking-widest rotate-180">▶ Samples</span>
          </button>
        )}

        {/* ── Split-Bereich ─────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Linke Hälfte: Mein Sequencer ─────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-border-color/60 min-w-0">
          <div className="px-4 py-1 bg-bg-elevated border-b border-border-color flex-shrink-0 flex items-center gap-2">
            <span className="text-[10px] text-text-dim uppercase tracking-widest">
              Mein Sequencer
            </span>
            {outputMode === "me" && (
              <span className="text-[9px] text-accent-primary border border-accent-primary rounded px-1 py-px">
                AKTIV
              </span>
            )}
            {outputMode === "both" && (
              <span className="text-[9px] text-accent-success border border-accent-success rounded px-1 py-px">
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

        {/* ── Rechte Hälfte: Partner-Sequencer + Partner-Samples ─── */}
        <div className="flex-1 flex overflow-hidden min-w-0">
          {/* Partner-Sequencer */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div
            className="px-4 py-1 bg-bg-elevated border-b border-border-color flex-shrink-0 flex items-center gap-2"
            style={{
              borderBottomColor: remote.color ? `${remote.color}40` : undefined,
            }}
          >
            <span className="text-[10px] text-text-dim uppercase tracking-widest">
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
              <span className="text-[10px] text-text-dim italic">Verbindet…</span>
            )}
            {outputMode === "partner" && (
              <span className="text-[9px] text-accent-secondary border border-accent-secondary rounded px-1 py-px ml-auto">
                AKTIV
              </span>
            )}
            {outputMode === "both" && (
              <span className="text-[9px] text-accent-success border border-accent-success rounded px-1 py-px ml-auto">
                AKTIV
              </span>
            )}
          </div>

          <div className="flex-1 overflow-hidden min-h-0">
            {remote.patterns.length === 0 ? (
              /* Wartezustand – kein Snapshot empfangen */
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
                <div className="w-8 h-8 rounded-full border-2 border-border-color border-t-accent-primary animate-spin" />
                <p className="text-sm text-text-dim">
                  Warte auf Snapshot des Partners…
                </p>
                <p className="text-xs text-text-dim">
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
          </div>{/* Ende Partner-Sequencer */}

          {/* ── Partner-Sample-Browser ──────────────────────── */}
          <PartnerSampleBrowser
            samples={remote.samples}
            partnerColor={remote.color}
            onAddToLibrary={onSamplesImported ? (s) => onSamplesImported([{
              id: `partner-${s.id}`, name: s.name, path: s.path,
              category: s.category, tags: ["partner-transfer"],
            }]) : undefined}
          />
        </div>
      </div>{/* Ende Split-Bereich */}
      </div>{/* Ende Haupt-Layout */}
    </div>
  );
}
