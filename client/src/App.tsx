/**
 * Synthstudio – App.tsx (Frontend-Agent)
 *
 * Haupt-React-Komponente. Integriert:
 * 1. ElectronTitleBar  – benutzerdefinierte Titelleiste (nur in Electron sichtbar)
 * 2. ElectronDropZone  – globales Drag & Drop Overlay (Browser + Electron)
 * 3. useElectronMenuBindings – native Menü-Events an React-State binden
 * 4. useWindowTitleSync – Fenstertitel mit isDirty/projectName synchronisieren
 *
 * ─── GOLDENES GESETZ ─────────────────────────────────────────────────────────
 * Jede Electron-spezifische Logik liegt hinter `if (electron.isElectron)`.
 * Kein direktes `window.electronAPI` – immer über den `useElectron()` Hook.
 * Die Web-App muss im Browser vollständig funktionsfähig bleiben.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";

// ── Electron-Komponenten (aus electron/components/) ──────────────────────────
// Relative Imports notwendig da electron/ außerhalb von client/src liegt
// ElectronTitleBar wurde post-v1.25.0 zugunsten der nativen Frame-Bar entfernt
// — Datei bleibt als Komponente bestehen für möglichen Re-Use in frameless Sub-Windows.
import { ElectronDropZone } from "../../electron/components/ElectronDropZone";

// ── Electron-Hooks ────────────────────────────────────────────────────────────
import { useElectron } from "../../electron/useElectron";
import { useElectronMenuBindings } from "../../electron/hooks/useElectronMenuBindings";

// ── Performance-Popup-Mode (ROADMAP feature) ─────────────────────────────────
import { PerformancePopupApp } from "@/components/PerformanceMode/PerformancePopupApp";
import { FxPopupApp } from "@/components/DrumMachine/FxPopupApp";
import { MixerPopupApp, type MixerPopupAction } from "@/components/Mixer/MixerPopupApp";
import { SampleBrowserPopupApp } from "@/components/SampleBrowser/SampleBrowserPopupApp";
import { PatternGeneratorPopupApp } from "@/components/PatternGenerator/PatternGeneratorPopupApp";
import { KeyboardSamplerPopupApp } from "@/components/Tools/KeyboardSamplerPopupApp";
import { ChordProgressionPopupApp } from "@/components/Tools/ChordProgressionPopupApp";
import { PatternLibraryPopupApp } from "@/components/PatternLibrary/PatternLibraryPopupApp";

// ── Eigene Stores & Hooks ─────────────────────────────────────────────────────
import { useProjectStore, type Sample } from "@/store/useProjectStore";
import { encodeWav } from "@/audio/wavEncoder";
import { useWindowTitleSync } from "@/store/useWindowTitleSync";

// ── Seiten-Komponenten ────────────────────────────────────────────────────────
import { SampleBrowser } from "@/components/SampleBrowser";
import { AudioInputRecorder } from "@/components/SampleBrowser/AudioInputRecorder";
import { ProjectManager } from "@/components/ProjectManager";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import KorgTemplatePicker from "@/components/KorgTemplatePicker";
import {
  applyKorgProjectTemplate,
  isKorgTemplateApplyDestructive,
} from "@/utils/korgProjectTemplates";
import { SongTimeline } from "@/components/SongTimeline";
import { Humanizer } from "@/components/Humanizer";
import { DrumMachine } from "@/components/DrumMachine";
import { SessionPanel } from "@/components/CollabSession";
import { PatternGeneratorPanel } from "@/components/PatternGenerator";
import { ArpeggiatorPanel } from "@/components/Arpeggiator";
import GeneratorView from "@/components/generator/GeneratorView.jsx"; // *** NEUER IMPORT ***
import { PatternLibrary } from "@/components/PatternLibrary/PatternLibrary";
import { savePatternToLibrary } from "@/store/usePatternLibraryStore";
import { ScriptRunner } from "@/components/Tools/ScriptRunner";
import { ChordProgressionPanel } from "@/components/Tools/ChordProgressionPanel";
import { KeyboardSamplerPanel } from "@/components/Tools/KeyboardSamplerPanel";
import { AudioWorkbench } from "@/components/AudioWorkbench/AudioWorkbench";
// v3.118.0: Project-Diff-Compare Tools-Subtab
import { ProjectDiffPanel } from "@/components/ProjectDiff/ProjectDiffPanel";
import { getKeyboardSamplerState } from "@/store/useKeyboardSamplerStore";
import { getEnvelopeFollowerConfigs } from "@/store/useEnvelopeFollowerStore";

// ── Stores für neue Features ──────────────────────────────────────────────────
import { useSongStore } from "@/store/useSongStore";
import { useHumanizerStore, computeHumanizerTimingOffset, computeHumanizerVelocityMultiplier } from "@/store/useHumanizerStore";
import { useMetronomeStore } from "@/store/useMetronomeStore";
import { useSubMixStore } from "@/store/useSubMixStore";
import { useDrumMachineStore } from "@/store/useDrumMachineStore";
import { useTransport } from "@/hooks/useTransport";
import { RecordSettingsPopover } from "@/components/Transport/RecordSettingsPopover";
import { useMidi } from "@/hooks/useMidi";
import { useMidiEventBridge } from "@/hooks/useMidiEventBridge";
import { useOscOutBridge } from "@/hooks/useOscOutBridge";
import { usePopupCloseBridges } from "@/hooks/usePopupCloseBridges";
import { MidiProvider } from "@/context/MidiContext";
import { toast } from "@/store/useToastStore";
import { ToastContainer } from "@/components/UI/ToastContainer";
import { ActivationModal } from "@/components/License/ActivationModal";
import { KorgBankModal, type KorgBankSample } from "@/components/KorgBank/KorgBankModal";
// v3.22.0: First-Run-Tutorial — Welcome-Wizard mit 6 Slides.
import { WelcomeWizard } from "@/components/Welcome/WelcomeWizard";
import {
  shouldAutoShowWelcome,
  WELCOME_EVENT_NAME,
  type WelcomeTryItDetail,
} from "@/store/useWelcomeStore";
import { KorgBankEditor } from "@/components/KorgBank/KorgBankEditor";
// v3.18.0: OmniTribe-Tab (VU + Spectrum + Chord + Performance-Pads).
// v3.19.0: Browser-Support-Banner + DeviceConnectionPanel im Tab.
import { OmniTribeVuMeter } from "@/components/OmniTribe/OmniTribeVuMeter";
import { OmniTribeSpectrumAnalyzer } from "@/components/OmniTribe/OmniTribeSpectrumAnalyzer";
import { ChordPanel } from "@/components/OmniTribe/ChordPanel";
import { PerformancePadGrid } from "@/components/OmniTribe/PerformancePadGrid";
import { StepSequencerPanel } from "@/components/OmniTribe/StepSequencerPanel";
import { AudioFxPanel } from "@/components/OmniTribe/AudioFxPanel";
import { OmniTribeBrowserSupport } from "@/components/OmniTribe/OmniTribeBrowserSupport";
// Sprint-119c: Clock-Sync + Position + Firmware-Info panels
import { ClockSyncPanel } from "@/components/OmniTribe/ClockSyncPanel";
import { PositionDisplay } from "@/components/OmniTribe/PositionDisplay";
import { FirmwareInfoViewer } from "@/components/OmniTribe/FirmwareInfoViewer";
import { DeviceConnectionPanel } from "@/components/Settings/DeviceConnectionPanel";
import { OtaUpdatePanel } from "@/components/Settings/OtaUpdatePanel";
import { SamplePackBrowser } from "@/components/SamplePackBrowser/SamplePackBrowser";
import {
  setOmniTribeVuLevels,
  setOmniTribeSpectrumBins,
  resetOmniTribeMeters,
} from "@/store/useOmniTribeMetersStore";
import { omniTribeBridge } from "@/audio/OmniTribeBridge";
import { initializeLicenseStore } from "@/store/useLicenseStore";
// TASK-232-FOLLOWUP / v2.98: Pro-Feature-Gate für MIDI-Note-Out (Bridge-Effect).
// v3.3.0: KORG-Bank-Import gated.
import {
  isFeatureUnlocked,
  requireProFeature,
  PRO_FEATURE_MIDI_NOTE_OUT,
  PRO_FEATURE_KORG_BANK_IMPORT,
} from "@/utils/proFeatures";
import { toast as showToast } from "@/store/useToastStore";
import { GUMROAD_PRODUCT_URL } from "@/utils/licenseConfig";
import { useLiveStepRecorder } from "@/hooks/useLiveStepRecorder";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { MidiSettings } from "@/components/MidiSettings";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { UpdateBadge } from "@/components/UpdateBadge";
import { PerformanceMonitor } from "@/components/PerformanceMonitor/PerformanceMonitor";
import { useCollabSession } from "@/hooks/useCollabSession";
import { useCollabSync } from "@/hooks/useCollabSync";
import { useSessionStore } from "@/store/useSessionStore";
import { CollabSplitView } from "@/components/CollabSplitView";
import { ThemeSettings, initTheme } from "@/components/Settings";
import { MixerView } from "@/components/Mixer";
import { ChannelInspector } from "@/components/Mixer/ChannelInspector";
import { WorkspaceShell } from "@/components/Workspace/WorkspaceShell";
import { WorkspaceProvider } from "@/components/Workspace/WorkspaceContext";
import { MixerPanel } from "@/components/Workspace/panels/MixerPanel";
import { InspectorPanel } from "@/components/Workspace/panels/InspectorPanel";
import { SequencerPanel } from "@/components/Workspace/panels/SequencerPanel";
import {
  SongPanel as WsSongPanel,
  HumanizerPanel as WsHumanizerPanel,
  ToolsPanel as WsToolsPanel,
  CollabPanel as WsCollabPanel,
} from "@/components/Workspace/panels/RenderFunctionPanels";
import { useWorkspaceMode } from "@/store/useWorkspaceMode";
import { useMixerStore } from "@/store/useMixerStore";
import { useGlobalKeyBindings, KB_ACTION_EVENT } from "@/hooks/useGlobalKeyBindings";
import { useScriptKeyBindings } from "@/hooks/useScriptKeyBindings";
import { configureSandboxBridge } from "@/sandbox/scriptSandboxInstance";
import { PatternLaunchPad } from "@/components/PerformanceMode/PatternLaunchPad";
import {
  usePerformanceStore,
  queuePattern as queuePerformancePattern,
  setQuantizeMode as setPerformanceQuantizeMode,
  getPads as getPerformancePads,
  // Phase 2 popup-window-sync: edit + reorder actions
  setPadAt as setPerformancePadAt,
  setPadColor as setPerformancePadColor,
  setPadLabel as setPerformancePadLabel,
  clearPad as clearPerformancePad,
  movePad as movePerformancePad,
  moveMultiplePads as moveMultiplePerformancePads,
  // BUG-013 fix: full reset
  resetPerformance,
  type PerformancePad,
} from "@/store/usePerformanceStore";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { ResizablePanelHandle } from "@/components/UI/ResizablePanelHandle";
import { useAutomationStore } from "@/store/useAutomationStore";
// v3.109.0 Song-Mode / Pattern-Chain-Sequencer
import {
  advance as songModeAdvance,
  getSongModeState,
  getActiveSong as getActiveSongMode,
  jumpToStep as songModeJumpToStep,
  getCurrentStepId as getSongModeCurrentStepId,
} from "@/store/useSongModeStore";
import { SongModePanel } from "@/components/SongMode/SongModePanel";
// v3.117.0: Conditional Song-Jumps + Performance-Triggers
import { getSongJumpState } from "@/store/useSongJumpStore";
import {
  findTriggeredJump,
  type MidiNoteEvent,
  type MidiCcEvent,
} from "@/utils/songJumpLogic";
import { MacroSnapshotPanel } from "@/components/MacroSnapshot/MacroSnapshotPanel";
import {
  setMorphAmount as setSnapshotMorphAmount,
  recallSnapshot as recallSnapshotInStore,
  getCurrentMorphedValues as getCurrentMorphedSnapshotValues,
} from "@/store/useMacroSnapshotStore";
import { LiveRecorderPanel } from "@/components/LiveRecorder";
import { AudioInputRecorderPanel } from "@/components/AudioInputRecorder";
import { useConfirm } from "@/components/common/ConfirmDialog";
import {
  mapElectribeLaneToAutomationTarget,
  scaleMotionPointsToStepCount,
  type ElectribeMotionLane,
} from "@/utils/electribeMotionMapping";
import {
  assignSlicesToPads,
  getSlicePadSlot,
  MAX_SLICE_PADS,
  // v2.93 (TASK-PROJ-FILE-V18): Snapshot + Rehydration für .synth-Persistenz.
  getAllSlicePadSlots,
  setSlicePadSlot,
  clearAllSlicePads,
} from "@/store/useSlicePadStore";
import { AutomationView } from "@/components/Automation/AutomationView";
import { SceneLaunchPad } from "@/components/Scene/SceneLaunchPad";
import { AudioEngine, DEFAULT_CHANNEL_FX } from "@/audio/AudioEngine";
import { syncE2sPattern } from "@/audio/E2sPatternSyncSender";
import { CollabChat } from "@/components/CollabSession/CollabChat";
import { addChatMessage } from "@/store/useCollabChatStore";
import { saveSnapshot } from "@/store/useVersionSnapshotStore";
import { useApiSettingsStore, getApiSettings } from "@/store/useApiSettingsStore";
import { VersionSnapshotPanel } from "@/components/ProjectManager/VersionSnapshotPanel";
import { SettingsPanel } from "@/components/Settings/SettingsPanel";
// v3.57.0: AutoSave UI-Wiring (Trigger + Topbar-Indicator + Versions-Modal).
import {
  useAutoSaveStore,
  markAutoSaveCompleted,
  isAutoSavePaused,
  // v3.60.0: Nach restoreProject lastSaveAt zurücksetzen (fresh project).
  resetAutoSaveLastSaveAt,
  // v3.61.0: Pro-projectId lastSaveAt-Tracking.
  setLastSaveAt,
  getLastSaveAtForProject,
} from "@/store/useAutoSaveStore";
import {
  writeAutoSaveVersion,
  listAutoSaveVersions,
} from "@/utils/autoSaveEngine";
import {
  computeAutoSaveIntervalMs,
  decideAutoSaveTick,
  projectNameToId,
  checkLegacySlugMigration,
  isMigrationChecked,
  markMigrationChecked,
  cacheLastProjectId,
} from "@/utils/autoSaveController";
import { AutoSaveStatusIndicator } from "@/components/AutoSave/AutoSaveStatusIndicator";
// v3.166: Track-Overview-Widget (Pure-Helper aus utils/trackOverview).
import { computeTrackOverview, formatTrackOverviewSummary } from "@/utils/trackOverview";
import { VersionHistoryModal } from "@/components/AutoSave/VersionHistoryModal";
// v3.65.0: Pre-Action AutoBackup.
import {
  autoBackupBeforeAction,
  registerAutoBackup,
} from "@/utils/autoBackupController";
// v3.59.0: Legacy-Slug-Migration UI (closes v3.58 caveat).
import { LegacyMigrationModal } from "@/components/AutoSave/LegacyMigrationModal";
import { SessionRecorder } from "@/components/CollabSession/SessionRecorder";
import { RelayPanel } from "@/components/CollabSession/RelayPanel";
import { PerformanceRecorderBadge } from "@/components/PerformanceRecorder/PerformanceRecorderBadge";
import { FloatingPanel } from "@/components/UI/FloatingPanel";
import {
  useInspectorFloatStore,
  closeInspectorFloat,
  toggleInspectorFloat,
} from "@/store/useInspectorFloatStore";
import { mapOscToAction, dispatchOscAction } from "@/utils/oscBindings";
import { useOscOutConfig } from "@/store/useOscOutStore";
import { recordEvent } from "@/store/useSessionRecordingStore";
import {
  recordEvent as recordPerfEvent,
  type PerfEventType,
} from "@/store/usePerformanceRecorder";
import { setMyRole, setParticipantRole } from "@/store/useSessionStore";
import { useLaunchpad, isGridDevice } from "@/hooks/useLaunchpad";
import { useBpmDetection, autoTagFromFilename } from "@/hooks/useBpmDetection";
import { getMacros, applyMacroBindings, setMacroValue, resetMacros, useMacroStore } from "@/store/useMacroStore";
import {
  getAllAudioTracks,
  loadAudioTracks,
  markBroken as markAudioTrackBroken,
  setRuntimeWaveform as setAudioTrackRuntimeWaveform,
  clear as clearAudioTracks,
  addAudioTrack,
} from "@/store/useAudioTrackStore";
// TASK-234 (v2.86): Record-Arm im Mixer
import {
  getArmedLiveInputChannelIds,
  getLiveInputChannel,
  // v2.93 (TASK-PROJ-FILE-V18): Snapshot + Rehydration für .synth-Persistenz.
  getAllLiveInputChannels,
  loadLiveInputChannels,
} from "@/store/useLiveInputStore";
// v3.63.0: Drum/Synth-Part Record-Arm (Mixer-Channel-Strip-UI).
import {
  getArmedDrumPartIds,
} from "@/store/useDrumPartRecordArmStore";
import {
  saveRecording as persistRecording,
} from "@/utils/recordingStorage";
import {
  getProjectScripts,
  loadProjectScripts,
  disableAllForeignProject,
  getScript,
  clearProjectScripts,
} from "@/store/useScriptStore";
// BUG-013 fix: vollständiges Project-Reset über alle Stores
import {
  resetMelodicParts,
  setNote as setMelodicNote,
  setVelocity as setMelodicVelocity,
  setBaseNote as setMelodicBaseNote,
} from "@/store/useMelodicPartStore";
import { routeMelodicPartsToPatterns } from "@/utils/imports";
import { collectSampleNames, matchSamplesByBasename } from "@/utils/imports/flpSampleLoader";
import { resetNoteRepeat, toggleNoteRepeat, isNoteRepeatEnabled } from "@/store/useNoteRepeatStore";
import { resetTranspose } from "@/store/useTransposeStore";
import { resetMorph, getMorphState, setActive as setMorphActive } from "@/store/useMorphStore";
import { getSceneState, setActiveScene as sceneStoreSetActiveScene } from "@/store/useSceneStore";
import {
  getMidiStepRecorderState,
  advanceStep as midiStepRecorderAdvanceStep,
} from "@/store/useMidiStepRecorderStore";
// v3.96.0: Tempo-Map Wire-Up — Resolver-Callback + Restore-Hook.
import { getTempoMapState, replaceEvents as setAllTempoEvents } from "@/store/useTempoMapStore";
import { getCurrentBpm } from "@/utils/tempoMap";
// v2.87 (TASK-235): Live-Looper Store-Bridge — Module-Funktionen, kein Hook.
import { getLoopSlot, setLoopState, setLoopLength } from "@/store/useLooperStore";
// v2.92 (TASK-240): MIDI-Note-Out Bridge — pro Part-Config in die AudioEngine syncen.
import {
  useMidiNoteOutStore,
  // v2.93 (TASK-PROJ-FILE-V18): Snapshot + Rehydration für .synth-Persistenz.
  getAllPartMidiOutConfigs,
  getMidiNoteOutEnabled,
  setMidiNoteOutEnabled,
  setPartMidiOutConfig,
  clearAllPartMidiOutConfigs,
} from "@/store/useMidiNoteOutStore";
// v3.98.0: MIDI-Click-Out — sendet Beat-Notes an externe Hardware fuer Sync.
import { useMidiClickStore } from "@/store/useMidiClickStore";
import { scriptSandbox } from "@/sandbox/scriptSandboxInstance";
import {
  startHoldLoop,
  stopHoldLoop,
  stopAllHoldLoops,
  SCRIPT_HOLD_INTERVAL_MS,
  PAD_HOLD_INTERVAL_MS,
} from "@/utils/macroHoldLoop";
import {
  serializeProject,
  downloadProjectFile,
  openProjectFilePicker,
  cacheProjectLocally,
  loadCachedProject,
  parseProject,
  // v2.93 (TASK-PROJ-FILE-V18): Float32-Codec für Slice-Pad-Buffer.
  float32ToFrames,
  framesToFloat32,
  type SerializedSlicePads,
} from "@/utils/projectSerializer";
// v3.137.0: Embed-Sample Save/Load-Pipeline-Wire (closes v3.131 Caveat).
// Auto-Embed transformierter Blob-URL-Samples ins .synth-File beim Save,
// Auto-Restore aus embeddedData beim Load.  Verhindert silent-data-loss
// nach Browser-Reload bei Sample-Transform-Workflows.
import {
  prepareProjectForSave,
  restoreEmbeddedSamples,
  countBlobUrlSamples,
  estimateProjectEmbedSizeKb,
} from "@/utils/sampleEmbeddingFlow";
import {
  audioBufferToWavBytes,
  base64WavToAudioBuffer,
  isBlobUrlPath,
  type AudioBufferLike,
} from "@/utils/sampleEmbedding";
import { loadPadBankSlots, savePadBankSlots } from "@/utils/padBankPersistence";
// v3.69.0: Quick-Action Macros — Hook-Mount + Context-Wiring + Schema-Persist.
import {
  getQuickActionMacros,
  setAllQuickActionMacros,
} from "@/store/useQuickActionStore";
// v3.94.0: MIDI-FX Chain Restore-Wiring (Pre-v1.34 = undefined → no-op).
import { setAllNodes as setAllMidiFxNodes } from "@/store/useMidiFxStore";
import { useQuickActionKeyBindings } from "@/hooks/useQuickActionKeyBindings";
import type { QuickActionContext } from "@/utils/quickActionExecutor";
import {
  registerQuickActionContext,
} from "@/utils/quickActionContextRegistry";

// ─── Visual Metronome ──────────────────────────────────────────────────────────

function VisualMetronome({ isPlaying, bpm }: { isPlaying: boolean; bpm: number }) {
  const [beat, setBeat] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!isPlaying) { setBeat(false); if (timerRef.current) clearInterval(timerRef.current as unknown as number); return; }
    const intervalMs = (60 / bpm) * 1000;
    const id = setInterval(() => {
      setBeat(true);
      setTimeout(() => setBeat(false), Math.min(80, intervalMs * 0.3));
    }, intervalMs);
    timerRef.current = id as unknown as ReturnType<typeof setTimeout>;
    return () => clearInterval(id);
  }, [isPlaying, bpm]);

  return (
    <div
      className="w-3 h-3 rounded-full flex-shrink-0 transition-all duration-75"
      style={{
        background: beat ? "var(--ss-accent-primary)" : "var(--ss-bg-elevated)",
        boxShadow: beat ? "0 0 8px var(--ss-accent-primary)" : "none",
      }}
      aria-hidden="true"
      title={`${bpm} BPM`}
    />
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

/**
 * Erkennt ob die App im Performance-Popup-Mode läuft.
 * URL-Param `?perfPopup=1` wird von electron/main.ts beim Öffnen des
 * separaten Performance-Fensters gesetzt (createPerformanceWindow).
 *
 * Pure check, no side effects — kann in render aufgerufen werden.
 */
function isPerformancePopupMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("perfPopup") === "1";
  } catch {
    return false;
  }
}

/**
 * Erkennt ob die App im FX-Popup-Mode läuft.
 * URL-Param `?fxPopup=<channelId>` wird von electron/main.ts beim Öffnen eines
 * pinnable FX-Fensters gesetzt (createFxWindow). Multi-Window-Workspace Phase 1.
 */
function getFxPopupChannelId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = new URLSearchParams(window.location.search).get("fxPopup");
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Erkennt ob die App im Mixer-Popup-Mode läuft.
 * URL-Param `?mixerPopup=1` wird von electron/main.ts createMixerWindow gesetzt.
 * Multi-Window-Workspace (post-v1.26.0).
 */
function isMixerPopupMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("mixerPopup") === "1";
  } catch {
    return false;
  }
}

/**
 * Erkennt ob die App im Sample-Browser-Popup-Mode läuft.
 * URL-Param `?sampleBrowserPopup=1` (post-v1.27.0).
 */
function isSampleBrowserPopupMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("sampleBrowserPopup") === "1";
  } catch {
    return false;
  }
}

/**
 * Erkennt ob die App im Pattern-Generator-Popup-Mode läuft.
 * URL-Param `?patternGenPopup=1` (post-v1.27.0).
 */
function isPatternGenPopupMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("patternGenPopup") === "1";
  } catch {
    return false;
  }
}

function hasPopupParam(name: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get(name) === "1";
  } catch {
    return false;
  }
}

/** Pin-Button im Tool-Tab Header (öffnet das Popup). */
function ToolPinButton({ onPin, testId }: { onPin: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onPin}
      data-testid={testId}
      title="In eigenes Fenster abkoppeln"
      className="mb-2 px-2 py-0.5 text-[10px] rounded border border-border-color text-text-dim hover:text-accent-primary hover:border-accent-primary transition-colors"
    >
      📌 Pin
    </button>
  );
}

/** Stub wenn ein Tool als Popup-Window offen ist — bietet Reattach-Button. */
function ToolPopupReattachStub({
  label,
  onReattach,
  testId,
}: {
  label: string;
  onReattach: () => void;
  testId: string;
}) {
  return (
    <div className="h-full flex items-center justify-center text-text-dim text-sm">
      <div className="text-center">
        <p className="mb-3">📌 {label} ist in einem eigenen Fenster geöffnet.</p>
        <button
          type="button"
          onClick={onReattach}
          data-testid={testId}
          className="px-3 py-1.5 rounded border border-border-color text-text-muted hover:text-accent-primary hover:border-accent-primary transition-colors text-xs"
        >
          Hierher zurückholen
        </button>
      </div>
    </div>
  );
}

export default function App() {
  // ── Performance-Popup-Mode: nur PerformancePopupApp rendern, früh raus ──
  // Wenn URL ?perfPopup=1 → das ist der Popup-Renderer, NICHT die volle App.
  // Vermeidet komplette App-Initialisierung (DrumMachine, Mixer, Stores etc.)
  // im Popup-Renderer. Die nachfolgenden Hooks werden NICHT ausgeführt weil
  // React den Tree hier abbricht.
  if (isPerformancePopupMode()) {
    return <PerformancePopupApp />;
  }
  // ── FX-Popup-Mode: nur FxPopupApp für den gegebenen Kanal rendern ──
  const fxChannelId = getFxPopupChannelId();
  if (fxChannelId) {
    return <FxPopupApp channelId={fxChannelId} />;
  }
  // ── Mixer-Popup-Mode: nur MixerPopupApp rendern ──
  if (isMixerPopupMode()) {
    return <MixerPopupApp />;
  }
  // ── Sample-Browser-Popup-Mode: nur SampleBrowserPopupApp rendern ──
  if (isSampleBrowserPopupMode()) {
    return <SampleBrowserPopupApp />;
  }
  // ── Pattern-Generator-Popup-Mode: nur PatternGeneratorPopupApp rendern ──
  if (isPatternGenPopupMode()) {
    return <PatternGeneratorPopupApp />;
  }
  // ── Tools-Popup-Modes (post-v1.28.0) ──────────────────────────────────────
  if (hasPopupParam("keyboardSamplerPopup")) return <KeyboardSamplerPopupApp />;
  if (hasPopupParam("chordProgressionPopup")) return <ChordProgressionPopupApp />;
  if (hasPopupParam("patternLibraryPopup")) return <PatternLibraryPopupApp />;

  // ── Electron-Hook (einziger Zugriffspunkt auf Electron-Features) ────────────
  const electron = useElectron();
  // v3.144+ — Promise-based Confirm-Dialog (replaces window.confirm())
  const confirm = useConfirm();
  // v2.26: OSC-Out-Config (BPM-Sync etc.) — Custom-Observer-Hook
  const oscOutConfig = useOscOutConfig();
  // v2.28: Reactive macro values für OSC-Out (separate vom getMacros()-Pull-Pfad)
  const { macros: macroSnapshot } = useMacroStore();
  // MIG-2B Feature-Flag: aktiviert den Dockview-Workspace für die migrierten Tabs.
  const workspaceMode = useWorkspaceMode();
  // ── Kollaborations-Session (für Sync) ─────────────────────────────────────────
  const collab = useCollabSession();
  const session = useSessionStore();
  const inSession = session.status === "hosting" || session.status === "joined";
  // ── Dialog-State ────────────────────────────────────────────────────────────────
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  // v3.49.0 — KORG Quick-Start Template-Picker
  const [showKorgTemplatePicker, setShowKorgTemplatePicker] = useState(false);

  // ── Browser-Warning Toast (Audio-Tracks beim Save im Web-Modus) ───────────
  const [showAudioTrackBrowserWarning, setShowAudioTrackBrowserWarning] = useState(false);

  // ── Performance Mode (Vollbild-Pattern-Launchpad) ─────────────────────────
  // `performanceActive` ist Runtime-Toggle (kein Persist). pads/quantizeMode
  // kommen aus dem persistierten Store via Hook.
  const [performanceActive, setPerformanceActive] = useState(false);
  const performance = usePerformanceStore();

  // ── Performance-Mode Popup-Window (ROADMAP feature) ───────────────────────
  // Runtime-State: ist der separate Performance-Popup aktuell offen?
  // Wird beim Open-Click gesetzt, beim Popup-Close-Event zurückgesetzt.
  const [performancePopupOpen, setPerformancePopupOpen] = useState(false);

  /** Öffnet das Performance-Popup-Fenster und schließt die Inline-Ansicht. */
  const handleOpenPerformanceWindow = useCallback(() => {
    if (!electron.isElectron) return;
    void electron.openPerformanceWindow?.();
    setPerformancePopupOpen(true);
    // Inline schließen — User sieht nur eine Performance-Mode-Instanz auf einmal
    setPerformanceActive(false);
  }, [electron]);

  // ── Mixer-Popup-Window (Multi-Window-Workspace, post-v1.26.0) ─────────────
  // Mixer behält seinen eigenen Effect weil er die BUG-023 Guard-Ref-Logik
  // braucht (late request-state Messages nach destroy() ignorieren).
  const [mixerPopupOpen, setMixerPopupOpen] = useState(false);
  const mixerJustClosedRef = useRef(false);
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onMixerPopupClosed?.(() => {
      electron.logRendererEvent?.("popup-closed-received", { key: "mixer" });
      mixerJustClosedRef.current = true;
      setMixerPopupOpen(false);
      setTimeout(() => { mixerJustClosedRef.current = false; }, 1500);
    });
    return cleanup;
  }, [electron]);

  // TASK-232 (v2.97): License-Store beim App-Start initialisieren (Electron-IPC oder localStorage).
  useEffect(() => {
    void initializeLicenseStore();
  }, []);

  // Sample-Browser / Pattern-Gen / Tools-Popups: Open-State-Variablen
  const [sampleBrowserPopupOpen, setSampleBrowserPopupOpen] = useState(false);
  const [patternGenPopupOpen, setPatternGenPopupOpen] = useState(false);
  const [keyboardSamplerPopupOpen, setKeyboardSamplerPopupOpen] = useState(false);
  const [chordProgressionPopupOpen, setChordProgressionPopupOpen] = useState(false);
  const [patternLibraryPopupOpen, setPatternLibraryPopupOpen] = useState(false);

  // v2.49: alle 6 simplen on*PopupClosed-Listener (Performance + die 4
  // Tools + Sample-Browser + Pattern-Gen) sind im usePopupCloseBridges-Hook
  // gebündelt. Ersetzt 6 verteilte useEffects mit identischer Pattern.
  usePopupCloseBridges({
    isElectron: electron.isElectron,
    log: electron.logRendererEvent,
    bridges: [
      { subscribe: electron.onPerfPopupClosed,            setter: setPerformancePopupOpen,      logKey: "perf" },
      { subscribe: electron.onSampleBrowserPopupClosed,   setter: setSampleBrowserPopupOpen,    logKey: "sampleBrowser" },
      { subscribe: electron.onPatternGenPopupClosed,      setter: setPatternGenPopupOpen,       logKey: "patternGen" },
      { subscribe: electron.onKeyboardSamplerPopupClosed, setter: setKeyboardSamplerPopupOpen,  logKey: "keyboardSampler" },
      { subscribe: electron.onChordProgressionPopupClosed,setter: setChordProgressionPopupOpen, logKey: "chordProgression" },
      { subscribe: electron.onPatternLibraryPopupClosed,  setter: setPatternLibraryPopupOpen,   logKey: "patternLibrary" },
    ],
  });


  // ── Humanizer ↔ AudioEngine Bridge ────────────────────────────────────────
  // Singleton-Slot, den AudioEngine._scheduleStep ausliest. Keine direkte
  // Abhängigkeit, damit der AudioEngine-Code Store-Agnostic bleibt.
  useEffect(() => {
    (globalThis as Record<string, unknown>)["__synthstudio_humanizer__"] = {
      timing: computeHumanizerTimingOffset,
      velocity: computeHumanizerVelocityMultiplier,
    };
    return () => {
      delete (globalThis as Record<string, unknown>)["__synthstudio_humanizer__"];
    };
  }, []);

  // ── Metronome Custom-Sounds ↔ AudioEngine ─────────────────────────────────
  const metronome = useMetronomeStore();
  useEffect(() => {
    void AudioEngine.setCustomClickSound("downbeat", metronome.customDownbeatUrl);
  }, [metronome.customDownbeatUrl]);
  useEffect(() => {
    void AudioEngine.setCustomClickSound("beat", metronome.customBeatUrl);
  }, [metronome.customBeatUrl]);

  // ── Sub-Mix-Buses ↔ AudioEngine (v3.79.1) ─────────────────────────────────
  // Bei jeder State-Änderung des Sub-Mix-Stores syncen wir das volle Bus-
  // Layout in die Engine. `syncSubMixState` ist idempotent — wenn nichts an
  // den Bus-Nodes geändert werden muss, wird nur der Gain-Param gerampt
  // (mit 20ms-Smoothing, klick-frei).
  const subMix = useSubMixStore();
  useEffect(() => {
    AudioEngine.syncSubMixState(subMix);
  }, [subMix]);

  // ── Tempo-Map ↔ AudioEngine Bridge (v3.96.0) ──────────────────────────────
  // Setzt den Resolver-Callback in der AudioEngine. Der Scheduler ruft ihn
  // vor jedem Step mit der aktuellen Bar-Position (loopCount) auf und nutzt
  // das Ergebnis als effective BPM. Bei leerer Tempo-Map liefert
  // getCurrentBpm() null → Engine faellt auf den static-BPM-Pfad zurueck.
  // Wird einmalig beim Mount gesetzt; der Callback liest live aus dem
  // Singleton-Store (kein React-Closure-Stale-State-Risiko).
  useEffect(() => {
    AudioEngine.setTempoMapResolver((atBar: number) =>
      getCurrentBpm(getTempoMapState().events, atBar)
    );
    return () => {
      AudioEngine.setTempoMapResolver(null);
    };
  }, []);

  // ── Zentraler Projekt-State ────────────────────────────────────────────────────
  const project = useProjectStore();
  const song = useSongStore();
  const humanizer = useHumanizerStore();
  const dm = useDrumMachineStore();
  const dmRef = useRef(dm);
  dmRef.current = dm;
  const mixer = useMixerStore();

  // FLP-SAMPLES (Stage 3): löst die Sample-Referenzen eines FLP-Imports gegen
  // einen vom User gewählten Ordner auf und legt die echten .wav auf die Parts.
  // Electron-only (OS-Ordner-Dialog + fs:read-file). Die Audio-Engine lädt die
  // absoluten Pfade lazy beim Abspielen (gleicher Pfad → bufferCache dedupt).
  const loadFlpSamplesFromFolder = useCallback(async (
    importedPatterns: Array<{ parts: Array<{ sampleName?: string }> }>,
    patternIds: string[],
  ) => {
    const names = collectSampleNames(importedPatterns);
    if (names.length === 0) return;
    const api = (window as unknown as {
      electronAPI?: {
        packChooseFolder?: () => Promise<{ canceled: boolean; filePaths: string[] }>;
        packRegisterRoot?: (p: string) => Promise<{ success: boolean; root?: string; error?: string }>;
        packScanFolder?: (p: string) => Promise<{ success: boolean; root?: string; files?: Array<{ absolutePath: string }>; truncated?: boolean; error?: string }>;
      };
    }).electronAPI;
    if (!api?.packChooseFolder || !api.packRegisterRoot || !api.packScanFolder) return;

    const ok = await confirm({
      title: `${names.length} Sample-Referenzen importiert — jetzt die echten Sample-Dateien laden?`,
      message: "Wähle im nächsten Dialog den Ordner mit den Samples (i.d.R. der Ordner der .flp-Datei).",
      confirmLabel: "Ordner wählen",
    });
    if (!ok) return;

    try {
      const pick = await api.packChooseFolder();
      if (pick.canceled || pick.filePaths.length === 0) return;
      const reg = await api.packRegisterRoot(pick.filePaths[0]);
      if (!reg.success || !reg.root) {
        toast(reg.error ?? "Ordner konnte nicht registriert werden", { kind: "error" });
        return;
      }
      const scan = await api.packScanFolder(reg.root);
      if (!scan.success || !scan.files) {
        toast(scan.error ?? "Ordner-Scan fehlgeschlagen", { kind: "error" });
        return;
      }
      const { matched, missing } = matchSamplesByBasename(names, scan.files);
      const matchedCount = Object.keys(matched).length;
      if (matchedCount === 0) {
        toast(`Keine der ${names.length} Samples in diesem Ordner gefunden`, { kind: "warning", duration: 6000 });
        return;
      }
      dm.applyImportedSamples(patternIds, matched);
      toast(
        `${matchedCount}/${names.length} Samples zugewiesen${missing.length > 0 ? ` — ${missing.length} nicht im Ordner gefunden` : ""}${scan.truncated ? " (Ordner-Scan abgeschnitten)" : ""}`,
        { kind: "success", duration: 7000 },
      );
    } catch (err) {
      toast(`Sample-Laden fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, { kind: "error", duration: 6000 });
    }
  }, [confirm, dm]);

  // v2.46: Inspector als pinnable Floating-Panel zusätzlich zur Dock-Slot-Position
  const inspectorFloat = useInspectorFloatStore();
  const automation = useAutomationStore();
  const { tagSampleFromFilename, detectBpmForSample } = useBpmDetection();

  // Refs damit Save-Handler immer aktuelle Werte lesen
  const songRef      = useRef(song);      songRef.current      = song;
  const humanizerRef = useRef(humanizer); humanizerRef.current = humanizer;
  const mixerRef     = useRef(mixer);     mixerRef.current     = mixer;
  const automationRef2 = useRef(automation); automationRef2.current = automation;
  const projectRef   = useRef(project);   projectRef.current   = project;

  // ── Cross-Store Solo (FOLLOWUP-102/B) ──────────────────────────────────────
  // Mixer-Level Solo wirkt cross-type: ein Drum-Part-Solo macht andere
  // Audio-Tracks stumm und umgekehrt. AudioEngine fragt via Getter den
  // aktuellen Drum-Solo-Status ab; eine useEffect-Bridge triggert ein
  // Re-Apply der Mute-Logik wann immer sich die Drum-Solo-Flags aendern
  // (NACH dem React-Commit, damit der Getter den neuen State sieht).
  useEffect(() => {
    AudioEngine.setDrumSoloFlagGetter(() => {
      const d = dmRef.current;
      if (!d) return false;
      const activePattern = d.getActivePattern();
      return activePattern?.parts.some(p => p.soloed) ?? false;
    });
    return () => AudioEngine.setDrumSoloFlagGetter(null);
  }, []);
  // Trigger Re-Apply wann immer sich Drum-Solo-Flags aendern.
  // Dependency: serialisierter Solo-Snapshot des aktiven Patterns.
  const drumSoloSnapshot = (() => {
    const active = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!active) return "";
    return active.parts.map(p => (p.soloed ? "1" : "0")).join("");
  })();
  useEffect(() => {
    AudioEngine.notifyDrumSoloChanged();
  }, [drumSoloSnapshot]);

  // ── Projekt-Serialisierung ────────────────────────────────────────────────
  const buildProjectSnapshot = useCallback(() => {
    const p  = projectRef.current;
    const d  = dmRef.current;
    const s  = songRef.current;
    const h  = humanizerRef.current;
    const m  = mixerRef.current;
    const a  = automationRef2.current;
    return serializeProject({
      // v3.58.0: projectId ist immutable + im Schema v1.24 persistent.
      projectId:       p.projectId,
      projectName:     p.projectName,
      bpm:             p.bpm,
      samples:         p.samples,
      patterns:        d.patterns,
      activePatternId: d.activePatternId,
      song: {
        slots:          s.slots,
        songModeActive: s.songModeActive,
        loopSong:       s.loopSong,
      },
      mixer: {
        masterVolume:    m.masterVolume,
        channels:        m.channels,
        returnTracks:    m.returnTracks,
        insertChains:    m.insertChains,
        eq16:            m.eq16,
        sidechains:      m.sidechains,
        transientShapers:m.transientShapers,
      },
      humanizer: { global: h.global },
      automation: {
        lanes:     a.lanes,
        stepCount: a.stepCount,
      },
      audioTracks: getAllAudioTracks(),
      scripts: getProjectScripts(),
      // v2.81: Pad-Bank-Setup als Pro-Project-Settings persistieren
      padBank: loadPadBankSlots(),
      // v2.93 (TASK-PROJ-FILE-V18): Schließt silent-data-loss zwischen
      // Rechnern. liveInputs + midiNoteOut + slicePads waren bis v2.92
      // ausschließlich localStorage-only.
      liveInputs: getAllLiveInputChannels(),
      midiNoteOut: {
        enabled: getMidiNoteOutEnabled(),
        configs: getAllPartMidiOutConfigs(),
      },
      slicePads: getAllSlicePadSlots().map((slot) =>
        slot.buffer
          ? {
              index: slot.index,
              sampleRate: slot.sampleRate,
              sampleName: slot.sampleName,
              sliceIndex: slot.sliceIndex,
              frames: float32ToFrames(slot.buffer),
            }
          : null,
      ) as SerializedSlicePads,
      // v3.69.0 (v1.25): Quick-Action Macros mit-persistieren.
      macros: getQuickActionMacros(),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.65.0: Pre-Action AutoBackup-Helper. Wird vor destructive Actions
  // gerufen — schreibt eine Versions-mit-Label "Before: <action>" in die
  // History, damit der User auch zwischen 5-Minuten-Ticks geschützt ist.
  // NIE blockierend: bei Fehler wird die Action trotzdem ausgeführt.
  const doAutoBackupBeforeAction = useCallback(async (actionLabel: string) => {
    const pid = projectRef.current.projectId
      || projectNameToId(projectRef.current.projectName);
    return autoBackupBeforeAction(actionLabel, pid, () => {
      try {
        const snapshot = buildProjectSnapshot();
        return JSON.stringify(snapshot);
      } catch (err) {
        console.warn("[AutoBackup] Snapshot-Build-Fehler:", err);
        return null;
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildProjectSnapshot]);

  // v3.65.0: Pre-Action-AutoBackup global registrieren — damit auch tief
  // verschachtelte Komponenten (DrumMachine, KorgBankEditor) ohne Prop-
  // Drilling rufen können.
  useEffect(() => {
    registerAutoBackup((label: string) => doAutoBackupBeforeAction(label));
    return () => {
      registerAutoBackup(null);
    };
  }, [doAutoBackupBeforeAction]);

  // ─── v3.69.0: Quick-Action Macros — Hook-Mount + Setter-Wiring ────────────
  // Schließt v3.68-Caveats. Wir bauen den QuickActionContext aus den
  // existierenden Store-Refs (dmRef/mixerRef/projectRef) damit die Setter
  // immer den aktuellen State sehen — keine Stale-Closures. setAllDrum-
  // PartsMuted iteriert über die Parts des aktuellen Patterns und ruft
  // dm.setPartMuted pro Part (es gibt keinen Bulk-Setter im Store).
  const quickActionContext = useMemo<QuickActionContext>(() => ({
    setBpm: (bpm: number) => {
      const clamped = Math.max(20, Math.min(300, bpm));
      AudioEngine.setBpm(clamped);
      projectRef.current?.setBpm(clamped);
    },
    setMasterVolume: (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      AudioEngine.setMasterVolume(clamped);
      mixerRef.current?.setMasterVolume(clamped);
    },
    setChannelVolume: (channelId: string, value: number) => {
      const clamped = Math.max(0, Math.min(1, value));
      dmRef.current?.setPartVolume(channelId, clamped);
    },
    setChannelPan: (channelId: string, value: number) => {
      const clamped = Math.max(-1, Math.min(1, value));
      dmRef.current?.setPartPan(channelId, clamped);
    },
    setChannelMute: (channelId: string, value: boolean) => {
      dmRef.current?.setPartMuted(channelId, value);
    },
    setAllDrumPartsMuted: (value: boolean) => {
      const d = dmRef.current;
      if (!d) return;
      const active = d.patterns.find((p) => p.id === d.activePatternId);
      if (!active) return;
      for (const part of active.parts) {
        d.setPartMuted(part.id, value);
      }
    },
    switchPattern: (patternId: string) => {
      dmRef.current?.setActivePattern(patternId);
    },
    triggerScene: (sceneIndex: number) => {
      const scenes = getSceneState().scenes;
      const scene = scenes[sceneIndex];
      if (!scene) return;
      sceneStoreSetActiveScene(scene.id);
      if (scene.patternId) {
        dmRef.current?.setActivePattern(scene.patternId);
      }
    },
    playPad: (padIndex: number) => {
      const pads = getPerformancePads();
      const pad = pads[padIndex];
      if (!pad || !pad.patternId) return;
      dmRef.current?.setActivePattern(pad.patternId);
      queuePerformancePattern(pad.patternId);
    },
    onUnhandled: (action) => {
      // Best-effort: log nur in dev. Prod-User sieht keinen Toast.
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[QuickAction] Unhandled action:", action.kind);
      }
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Globalen keydown-Listener für Macro-Triggers mounten.
  useQuickActionKeyBindings(quickActionContext);

  // Context in der Registry verfügbar machen — MacroEditor "Test"-Button
  // greift ohne Prop-Drilling darauf zu.
  useEffect(() => {
    registerQuickActionContext(quickActionContext);
    return () => { registerQuickActionContext(null); };
  }, [quickActionContext]);

  const doSaveProject = useCallback(async () => {
    let snapshot = buildProjectSnapshot();

    // v3.137.0 / v3.138.0: Embed Samples vor Write (Setting "embedBehavior").
    // Transformierte Samples (SampleTransformDialog) liegen als Blob-URL vor.
    // Blob-URLs überleben einen Browser-Reload NICHT — ohne Embed wäre das
    // Sample beim nächsten Project-Load tot.  Pipeline fetched die URL/Path,
    // decodet sie via AudioContext zu AudioBuffer und embedded sie als
    // Base64-WAV in `samples[].embeddedData`.  Defensive: jeder Pipeline-Fehler
    // (CORS, decodeAudioData throws, leerer Buffer, …) lässt den Save weiter-
    // laufen mit dem original-snapshot + zeigt eine Warning.
    //
    // v3.138: User-Setting `embedBehavior`:
    //  - "auto"   (default): aktuelles Verhalten — nur Blob-URLs.
    //  - "always": ALLE Samples einbetten (sicherer Round-Trip zwischen Rechnern).
    //  - "never":  Embed skippen (kompakte .synth-Files, Data-Loss-Risiko).
    const embedBehavior = getApiSettings().embedBehavior;
    const blobCount = countBlobUrlSamples(
      snapshot as unknown as Parameters<typeof countBlobUrlSamples>[0],
    );
    const embedAll = embedBehavior === "always";
    const totalSamples = Array.isArray(snapshot.samples) ? snapshot.samples.length : 0;
    const shouldEmbed =
      embedBehavior !== "never" && (embedAll ? totalSamples > 0 : blobCount > 0);

    if (shouldEmbed) {
      try {
        const ctx = AudioEngine.getAudioContext();
        if (!ctx) {
          // Defensive: AudioContext noch nicht initialisiert (z.B. Save
          // vor erstem Play).  Embed wird übersprungen — Warning zeigt
          // den User-Schaden (Blob-URLs gehen nach Reload verloren).
          const skipCount = embedAll ? totalSamples : blobCount;
          toast(
            `Audio-Engine nicht aktiv — ${skipCount} Sample(s) konnten nicht eingebettet werden.  Drücke einmal Play und speichere erneut.`,
            { kind: "warning", duration: 7000 },
          );
        } else {
          const loadAudioBuffer = async (
            path: string,
          ): Promise<AudioBufferLike | null> => {
            try {
              const resp = await fetch(path);
              if (!resp.ok) return null;
              const arr = await resp.arrayBuffer();
              // decodeAudioData transferiert den ArrayBuffer in einigen
              // Browsern — daher Kopie für defensive Reuse.
              const copy = arr.slice(0);
              const buf = await ctx.decodeAudioData(copy);
              return buf as unknown as AudioBufferLike;
            } catch (err) {
              console.warn("[Save] Embed loadAudioBuffer failed for", path, err);
              return null;
            }
          };
          // Cast: parseProject's Sample shape (path: string required) ist
          // strukturell kompatibel mit EmbedSampleLike (path: optional + index-
          // signature).  TS sieht den Konflikt aber nicht durch die Index-Sig.
          const prepared = await prepareProjectForSave(
            snapshot as unknown as Parameters<typeof prepareProjectForSave>[0],
            {
              embedTransformed: true,
              embedAll,
              loadAudioBuffer,
            },
          );
          snapshot = prepared as unknown as typeof snapshot;
          const totalKb = estimateProjectEmbedSizeKb(
            snapshot as unknown as Parameters<typeof estimateProjectEmbedSizeKb>[0],
          );
          if (totalKb > 0) {
            const mb = (totalKb / 1024).toFixed(1);
            const noun = embedAll
              ? `${totalSamples} Sample(s) (Modus „Immer“)`
              : `${blobCount} transformierte Sample(s)`;
            toast(`${noun} eingebettet (~${mb} MB)`, { kind: "info" });
          }
        }
      } catch (err) {
        console.warn("[Save] Embed-Pipeline failed:", err);
        toast(
          "Embed der Samples fehlgeschlagen — Save wird trotzdem ausgeführt (Blob-URLs gehen nach Reload verloren)",
          { kind: "warning", duration: 7000 },
        );
        // snapshot bleibt original — Save geht weiter, kein Crash.
      }
    } else if (embedBehavior === "never" && blobCount > 0) {
      // User hat "never" gewählt, hat aber Blob-URLs → einmaliger Hinweis.
      toast(
        `Embed-Modus „Nie“ aktiv — ${blobCount} transformierte Sample(s) werden NICHT eingebettet (gehen nach Reload verloren).`,
        { kind: "warning", duration: 5000 },
      );
    }

    cacheProjectLocally(snapshot);

    if (electron.isElectron) {
      const result = await electron.saveFileDialog({
        title: "Projekt speichern",
        defaultPath: `${snapshot.projectName}.synth`,
        filters: [{ name: "Synthstudio Projekt", extensions: ["synth", "json"] }],
      });
      if (!result.canceled && result.filePath) {
        await electron.writeFile(result.filePath, JSON.stringify(snapshot, null, 2));
        toast(`Gespeichert: ${snapshot.projectName}`, { kind: "success" });
      }
    } else {
      downloadProjectFile(snapshot);
      toast(`Download gestartet: ${snapshot.projectName}.synth`, { kind: "success" });
      // Browser-Modus: einmalige Warnung wenn Audio-Tracks im Projekt sind.
      // Audio-Tracks werden nur als Dateipfad-Referenz gespeichert – beim
      // erneuten Öffnen muss der User die Datei neu wählen.
      try {
        const hasAudioTracks = (snapshot.audioTracks?.length ?? 0) > 0;
        const dismissed = localStorage.getItem(
          "synthstudio:audiotrack-browser-warning-dismissed",
        ) === "true";
        if (hasAudioTracks && !dismissed) {
          setShowAudioTrackBrowserWarning(true);
        }
      } catch { /* localStorage nicht verfügbar – ignorieren */ }
    }
    project.setDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electron, buildProjectSnapshot]);

  const restoreProject = useCallback(async (data: ReturnType<typeof parseProject>) => {
    // Projekt-Metadaten
    // v3.58.0: projectId aus dem .synth-File übernehmen — parseProject
    // hat sie bereits validiert/ggf. neu generiert (Pre-v1.24-Migration).
    project.adoptProjectId(data.projectId);
    project.setProjectName(data.projectName);
    project.setBpm(data.bpm);
    // v3.60.0: lastSaveAt im AutoSaveStore auf null setzen — das geladene
    // Projekt hat eine eigene History (per UUID), die alten Save-Zeiten
    // des vorherigen Projekts sollen NICHT in der Topbar erscheinen.
    // Der nächste echte AutoSave-Tick aktualisiert lastSaveAt wieder.
    resetAutoSaveLastSaveAt();
    // v3.61.0: Post-Restore-Lookup — falls das geladene Projekt bereits eine
    // AutoSave-History hat, übernimm den Timestamp der NEUESTEN Version damit
    // der Topbar-Indikator NICHT "Noch nie" zeigt sondern den echten Wert.
    // Defensive: async + best-effort, niemals den Restore crashen lassen.
    const restoredPid = data.projectId;
    if (restoredPid) {
      // Erst pro-projectId Map fragen (vermeidet IDB-Call falls vorhanden).
      const cached = getLastSaveAtForProject(restoredPid);
      if (cached !== null) {
        setLastSaveAt(restoredPid, cached);
      } else {
        void listAutoSaveVersions(restoredPid)
          .then((versions) => {
            if (versions.length > 0) {
              const newest = versions[0]; // listAutoSaveVersions liefert DESC.
              if (newest && Number.isFinite(newest.timestamp)) {
                setLastSaveAt(restoredPid, newest.timestamp);
              }
            }
          })
          .catch(() => { /* best-effort */ });
      }
    }
    // Samples
    // v3.137.0: Embedded-Samples decoden VOR addSamples (closes v3.131-Caveat).
    // Pre-v1.36-Files haben kein embeddedData → no-op-Pfad (decode wird
    // pro Sample geskipt, samples-Array bleibt unverändert).  Defensive:
    // jeder Decode-Fehler crashed den Restore NICHT — corruptes Sample
    // bleibt mit altem Path durch + console.warn als Indikator.
    let samples = data.samples ?? [];
    try {
      const ctx = AudioEngine.getAudioContext();
      if (ctx) {
        const decodeToBlobUrl = async (b64: string): Promise<string> => {
          const buf = await base64WavToAudioBuffer(b64, ctx);
          // AudioBuffer → WAV bytes → Blob → Blob-URL.  audioBufferToWavBytes
          // ist DOM-frei (akzeptiert AudioBufferLike) — AudioBuffer ist
          // strukturell kompatibel.
          const bytes = audioBufferToWavBytes(buf as unknown as AudioBufferLike);
          const blob = new Blob([bytes as BlobPart], { type: "audio/wav" });
          return URL.createObjectURL(blob);
        };
        const restored = await restoreEmbeddedSamples(
          { samples } as unknown as Parameters<typeof restoreEmbeddedSamples>[0],
          {
            decodeToBlobUrl,
            onWarning: (id, reason) => {
              console.warn(
                `[Load] Embedded sample ${id} corrupt: ${reason}`,
              );
            },
          },
        );
        samples = (restored.samples ?? samples) as typeof samples;
        const restoredCount = samples.filter((s) => isBlobUrlPath(s.path)).length;
        if (restoredCount > 0) {
          // Bewusst nicht als Toast — Toast ist für User-Aktionen, hier
          // ist es ein automatischer Restore-Mechanismus.  console.log
          // hilft bei Debugging.
          console.log(`[Load] ${restoredCount} embedded sample(s) restored`);
        }
      }
    } catch (err) {
      console.warn("[Load] Restore-Embedded failed:", err);
    }
    project.addSamples(samples);
    // Patterns in die DM laden
    if (data.patterns?.length) {
      data.patterns.forEach(p => dm.addPatternData(p));
      dm.setActivePattern(data.activePatternId ?? data.patterns[0]?.id);
    }
    // Song
    if (data.song) {
      song.createArrangement(data.song.slots?.map(s => ({ bank: s.bank, repeats: s.repeats })) ?? []);
    }
    // Audio-Tracks (extern referenzierte Vocal/Song-Dateien)
    const audioTracks = data.audioTracks ?? [];
    loadAudioTracks(audioTracks);

    // Projekt-Scripts (seit v1.16): parseProject hat bereits enabled=false
    // erzwungen. Defensiv hier nochmals disableAllForeignProject() aufrufen,
    // damit auch andere Load-Pfade (z.B. cached project) safe sind.
    const projectScripts = data.scripts ?? [];
    loadProjectScripts(projectScripts);
    disableAllForeignProject();

    // v2.81: Pad-Bank-Setup (seit v1.17). Wenn der Project-File die Bank
    // mitliefert (auch leeres Array ist explicit), überschreiben wir den
    // User-localStorage. Pre-v1.17-Files haben padBank=undefined → wir
    // lassen den User-localStorage in Ruhe. Custom-Event triggert UI-Reload
    // wenn MidiSettings gerade offen ist (sonst wird beim nächsten Mount
    // automatisch der neue Stand aus localStorage gelesen).
    if (data.padBank !== undefined) {
      savePadBankSlots(data.padBank);
      window.dispatchEvent(new CustomEvent("padBank:loaded"));
    }

    // v2.93 (TASK-PROJ-FILE-V18): Live-Inputs / MIDI-Note-Out / Slice-Pads
    // wurden bis v2.92 nur in localStorage gehalten und gingen beim File-
    // Transport zwischen Rechnern verloren. Ab v1.18 sind sie im .synth-File
    // mitgespeichert. Undefined = "im File nicht enthalten" (Pre-v1.18-File)
    // → User-localStorage in Ruhe lassen.
    if (data.liveInputs !== undefined) {
      loadLiveInputChannels(data.liveInputs);
    }
    if (data.midiNoteOut !== undefined) {
      clearAllPartMidiOutConfigs();
      setMidiNoteOutEnabled(data.midiNoteOut.enabled);
      for (const [partId, cfg] of Object.entries(data.midiNoteOut.configs)) {
        setPartMidiOutConfig(partId, cfg);
      }
    }
    if (data.slicePads !== undefined) {
      clearAllSlicePads();
      for (const slot of data.slicePads) {
        if (!slot) continue;
        const buf = framesToFloat32(slot.frames);
        if (!buf || buf.length === 0) continue;
        setSlicePadSlot(slot.index, buf, {
          sampleRate: slot.sampleRate,
          sampleName: slot.sampleName,
          sliceIndex: slot.sliceIndex,
        });
      }
    }

    // v3.69.0 (v1.25): Quick-Action Macros aus dem .synth-File übernehmen.
    // Pre-v1.25-Files haben das Feld nicht → undefined; in diesem Fall den
    // User-localStorage NICHT überschreiben. Explicit [] respektieren.
    if (data.macros !== undefined) {
      setAllQuickActionMacros(data.macros);
    }

    // v3.94.0 (v1.34): MIDI-FX Chain aus dem .synth-File übernehmen.
    // Pre-v1.34-Files haben das Feld nicht (parseProject hat midiFxChain auf
    // undefined gemappt) → User-localStorage NICHT überschreiben.
    // Explicit [] = User hat die Chain bewusst geleert → respektieren.
    // setAllMidiFxNodes(undefined) ist defensiv ein no-op, doppelte
    // Sicherheit hier mit explizitem Check + Logging schadet nicht.
    try {
      if (data.midiFxChain !== undefined) {
        setAllMidiFxNodes(data.midiFxChain);
      }
    } catch (err) {
      // Defensive: invalid Chain darf den Restore NICHT crashen.
      console.warn("[restoreProject] midiFxChain restore failed:", err);
    }

    // v3.96.0 (v1.35): Tempo-Map aus dem .synth-File übernehmen.
    // Pre-v1.35-Files haben tempoMap=undefined → User-localStorage NICHT
    // ueberschreiben. Explicit [] respektieren (= User hat bewusst geleert).
    try {
      if (data.tempoMap !== undefined) {
        setAllTempoEvents(data.tempoMap);
      }
    } catch (err) {
      console.warn("[restoreProject] tempoMap restore failed:", err);
    }

    // ── Relocate-Probe: Prüfe ob Datei-Pfad noch existiert ────────────────
    // Electron: getAudioMetadata → bei Fehler markBroken(id, true)
    // Browser: nicht möglich Pfade zu prüfen → alle als broken markieren,
    // User muss [Relocate…] klicken um File-Picker zu öffnen.
    // Bei NICHT-broken Tracks: loadAudioTrack + registerAudioTrack damit Engine sie kennt.
    void (async () => {
      for (const t of audioTracks) {
        if (electron.isElectron) {
          try {
            const meta = await electron.getAudioMetadata(t.filePath);
            const ok = (meta as { success?: boolean }).success === true;
            if (!ok) {
              markAudioTrackBroken(t.id, true);
              continue;
            }
            // Datei existiert → in Engine laden
            const buf = await AudioEngine.loadAudioTrack(t.id, t.filePath);
            if (!buf) {
              markAudioTrackBroken(t.id, true);
              continue;
            }
            AudioEngine.registerAudioTrack(t);
            // Peaks via Electron-Analyse oder Client-Decode
            let peaks: Float32Array | undefined;
            try {
              const res = await electron.analyzeWaveform(t.filePath, 200);
              const r = res as { success?: boolean; peaks?: number[] };
              if (r.success && Array.isArray(r.peaks)) {
                peaks = Float32Array.from(r.peaks);
              }
            } catch { /* fallback to client decode */ }
            if (!peaks) {
              // Client-Side downsample
              const ch0 = buf.getChannelData(0);
              const numPeaks = 200;
              const peaksArr = new Float32Array(numPeaks);
              const blockSize = Math.max(1, Math.floor(ch0.length / numPeaks));
              for (let i = 0; i < numPeaks; i++) {
                const start = i * blockSize;
                const end = Math.min(ch0.length, start + blockSize);
                let peak = 0;
                for (let j = start; j < end; j++) {
                  const v = Math.abs(ch0[j]);
                  if (v > peak) peak = v;
                }
                peaksArr[i] = peak;
              }
              peaks = peaksArr;
            }
            setAudioTrackRuntimeWaveform(t.id, buf.duration, peaks);
            markAudioTrackBroken(t.id, false);
          } catch {
            markAudioTrackBroken(t.id, true);
          }
        } else {
          // Browser: kein Datei-Pfad-Zugriff → User muss neu wählen.
          markAudioTrackBroken(t.id, true);
        }
      }
    })();

    // ── v3.59.0: Legacy-Slug-Migration Post-Load-Check ──────────────────────
    // Wenn unter projectNameToId(name) (alter Schlüssel) Versionen liegen
    // aber unter project.projectId (UUID) noch keine, einmalig dem User
    // den Migration-Prompt zeigen. Run-Once per projectId in localStorage.
    void (async () => {
      try {
        const projectName = data.projectName ?? "";
        const newPid = data.projectId;
        if (!newPid) return;
        // v3.59: projectId für Reload-Persistenz cachen.
        cacheLastProjectId(newPid);
        if (isMigrationChecked(newPid)) return; // run-once
        const legacySlug = projectNameToId(projectName);
        if (legacySlug === newPid) return; // bereits identisch (unwahrscheinlich, defensive)
        const [legacyVersions, uuidVersions] = await Promise.all([
          listAutoSaveVersions(legacySlug),
          listAutoSaveVersions(newPid),
        ]);
        const check = checkLegacySlugMigration(
          legacyVersions.length,
          uuidVersions.length,
          projectName,
        );
        if (check.reason === "migrate" && check.shouldPrompt) {
          setLegacyMigration({
            isOpen: true,
            legacySlug: check.legacySlug,
            newProjectId: newPid,
            legacyCount: check.legacyCount,
          });
        } else {
          // Kein Prompt nötig → trotzdem als gecheckt markieren, damit wir
          // bei jedem Reload nicht erneut die Listen ziehen.
          markMigrationChecked(newPid);
        }
      } catch (err) {
        console.warn("[AutoSave-Migration] check failed:", err);
      }
    })();

    project.setDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, dm, song]);

  const doLoadProject = useCallback(async (filePath?: string) => {
    try {
      let data;
      if (electron.isElectron && filePath) {
        // Electron mit bekanntem Pfad
        const result = await electron.openFileDialog({
          title: "Projekt öffnen",
          filters: [{ name: "Synthstudio Projekt", extensions: ["synth", "json"] }],
          multiSelections: false,
        });
        if (result.canceled || !result.filePaths[0]) return;
        // Lesen via IPC (falls vorhanden) – Fallback: openProjectFilePicker
        data = await openProjectFilePicker();
      } else {
        data = await openProjectFilePicker();
      }
      if (data) {
        restoreProject(data);
        toast(`Projekt geladen: ${data.projectName}`, { kind: "success" });
      }
    } catch (err) {
      console.error("[Load Project]", err);
      toast("Projekt konnte nicht geladen werden", { kind: "error", duration: 5000 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electron, restoreProject]);

  // Beim Start: letztes Projekt aus Cache laden
  useEffect(() => {
    const cached = loadCachedProject();
    if (cached && project.projectName === "Neues Projekt" && project.samples.length === 0) {
      restoreProject(cached);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-Save (konfigurierbares Intervall, ein-/ausschaltbar) — Browser-Cache.
  const apiSettings2 = useApiSettingsStore();
  useEffect(() => {
    if (!apiSettings2.autoSaveEnabled) return;
    const ms = apiSettings2.autoSaveIntervalMin * 60 * 1000;
    const id = setInterval(() => {
      const snapshot = buildProjectSnapshot();
      cacheProjectLocally(snapshot);
    }, ms);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiSettings2.autoSaveEnabled, apiSettings2.autoSaveIntervalMin]);

  // v3.59.0: projectId localStorage Cache — verhindert ephemere UUID nach
  // Browser-Reload (Hook-Init würde sonst eine frische UUID generieren,
  // bevor loadCachedProject das alte Projekt restored). Schreibt bei jeder
  // ID-Änderung in `synthstudio:last-projectid`.
  useEffect(() => {
    if (project.projectId) cacheLastProjectId(project.projectId);
  }, [project.projectId]);

  // ── v3.57.0: AutoSave Versions-Engine (Trigger + Toast on Fail) ─────────────
  // Erzeugt rolling Versionen via autoSaveEngine.writeAutoSaveVersion +
  // markiert lastSaveAt im useAutoSaveStore. Defensive: jeder Fehler wird
  // gefangen — AutoSave-Fail crashed niemals den Renderer.
  const autoSaveSettings = useAutoSaveStore();
  useEffect(() => {
    if (!autoSaveSettings.enabled) return;
    const ms = computeAutoSaveIntervalMs(autoSaveSettings.intervalMin);
    const id = window.setInterval(() => {
      const decision = decideAutoSaveTick(autoSaveSettings, isAutoSavePaused());
      if (!decision.shouldRun) return;
      try {
        const snapshot = buildProjectSnapshot();
        const json = JSON.stringify(snapshot);
        // v3.58.0: stable UUID statt name-slug — Rename verliert History
        // nicht mehr. Legacy-Fallback nur wenn projectId fehlt (defensive,
        // sollte nach v1.24-Migration nie passieren).
        const pid = projectRef.current.projectId
          || projectNameToId(projectRef.current.projectName);
        void writeAutoSaveVersion(pid, json)
          .then((res) => {
            if (res.success) {
              // v3.61.0: pro-projectId + Legacy synchron aktualisieren.
              setLastSaveAt(pid, Date.now());
            } else if (res.error) {
              console.warn("[AutoSave] Schreibfehler:", res.error);
            }
          })
          .catch((err) => {
            console.warn("[AutoSave] Promise-Reject:", err);
          });
      } catch (err) {
        // Serialisierung kann theoretisch werfen — niemals crashen.
        console.warn("[AutoSave] Serialisierungsfehler:", err);
      }
    }, ms);
    return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveSettings.enabled, autoSaveSettings.intervalMin]);

  // ── Transport (Audio-Engine ↔ React-State) ────────────────────────────────────
  useTransport({
    isPlaying: project.isPlaying,
    bpm: project.bpm,
    dm,
    onPlayStateChange: (playing) => {
      if (!playing && project.isPlaying) project.togglePlayStop();
    },
    onFollowAction: (action, currentPatternId) => {
      const d = dmRef.current;
      const patterns = d.patterns;
      const currentIdx = patterns.findIndex(p => p.id === currentPatternId);
      let nextId: string | null = null;

      switch (action.type) {
        case "next":     nextId = patterns[(currentIdx + 1) % patterns.length]?.id ?? null; break;
        case "prev":     nextId = patterns[(currentIdx - 1 + patterns.length) % patterns.length]?.id ?? null; break;
        case "random":   nextId = patterns[Math.floor(Math.random() * patterns.length)]?.id ?? null; break;
        case "specific": nextId = action.targetId ?? null; break;
      }
      if (!nextId || nextId === currentPatternId) return;
      d.setActivePattern(nextId);

      // BPM-Sync: neues Pattern hat eigenes BPM oder Ratio
      const nextPattern = patterns.find(p => p.id === nextId);
      if (nextPattern) {
        const globalBpm = projectRef.current.bpm;
        let targetBpm = globalBpm;
        if (nextPattern.bpmRatio && nextPattern.bpmRatio !== 1) {
          targetBpm = Math.round(globalBpm * nextPattern.bpmRatio);
        } else if (nextPattern.bpm !== null && nextPattern.bpm !== undefined) {
          targetBpm = nextPattern.bpm;
        }
        if (Math.abs(targetBpm - globalBpm) > 0.5) {
          const transitionBars = nextPattern.bpmTransitionBars ?? 0;
          if (transitionBars > 0) {
            AudioEngine.smoothBpmTransition(targetBpm, transitionBars, nextPattern.stepCount);
          } else {
            AudioEngine.setBpm(targetBpm);
          }
          project.setBpm(targetBpm);
        }
      }
    },
    // MIDI Out wird nach midi-Hook Initialisierung via useEffect registriert
  });

  // ── v3.109.0: Song-Mode / Pattern-Chain-Sequencer Engine-Wiring ───────────
  // Treibt den Song-Sequencer aus dem AudioEngine.onPosition()-Callback. Wir
  // hören auf step===0 (Start eines neuen Bars / Pattern-Loops). Wenn ein Song
  // aktiv ist und der Sequencer das nächste Pattern liefert, schalten wir um.
  //
  // Wichtig: der erste step===0 nach Aktivieren wird übersprungen (firstTickRef),
  // damit nicht direkt der initiale Step "doppelt" zählt.
  const songModePrimedRef = useRef(false);
  // v3.117.0: track last MIDI events for conditional-jump evaluation.
  const lastMidiNoteRef = useRef<MidiNoteEvent | null>(null);
  const lastMidiCcRef = useRef<MidiCcEvent | null>(null);

  useEffect(() => {
    const unsubscribe = AudioEngine.onPosition(step => {
      if (step !== 0) return;
      const songState = getSongModeState();
      if (!songState.activeSongId) {
        songModePrimedRef.current = false;
        return;
      }
      // Ersten Tick nach Aktivierung überspringen — das ist die "initiale Wiedergabe"
      if (!songModePrimedRef.current) {
        songModePrimedRef.current = true;
        return;
      }
      const d = dmRef.current;
      if (!d) return;
      const activeSong = getActiveSongMode();
      if (!activeSong) return;

      // v3.117.0: vor dem normalen Advance evaluieren wir Conditional Jumps,
      // die vom aktuellen Step ausgehen. Wenn eine Bedingung erfüllt ist,
      // springen wir direkt zum Ziel-Step (anstatt linear weiterzulaufen).
      const currentStepId = getSongModeCurrentStepId();
      if (currentStepId) {
        const jumps = getSongJumpState().jumpsBySong[activeSong.id] ?? [];
        if (jumps.length > 0) {
          const ctx = {
            macros: getMacros().map(m => m.value ?? 0),
            lastMidiNote: lastMidiNoteRef.current,
            lastMidiCc: lastMidiCcRef.current,
          };
          const triggered = findTriggeredJump(jumps, currentStepId, ctx);
          if (triggered) {
            const r = songModeJumpToStep(triggered.toStepId);
            if (r.ok && r.patternId && r.patternId !== d.activePatternId) {
              d.setActivePattern(r.patternId);
            }
            return;
          }
        }
      }

      const result = songModeAdvance();
      if (result.isFinished || !result.patternId) {
        // Song zu Ende — Playback weiter laufen lassen, aber Song deaktivieren
        // (alternativ: stop). Wir lassen es laufen, der User entscheidet.
        songModePrimedRef.current = false;
        return;
      }
      if (result.patternId !== d.activePatternId) {
        d.setActivePattern(result.patternId);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.117.0: track raw MIDI messages for conditional jumps + immediate triggers.
  // Note-On (status 0x90 + velocity>0) and CC (status 0xB0) are stored in refs;
  // on incoming MIDI the song-jump store is re-evaluated immediately — so a
  // performer can pressing a key to instantly switch to e.g. a Break-section.
  useEffect(() => {
    const onRaw = (e: Event) => {
      const ce = e as CustomEvent<{ type: number; channel: number; byte1: number; byte2: number }>;
      const det = ce.detail;
      if (!det) return;
      const now = Date.now();
      let updated = false;
      // 0x90 = Note-On, but a Note-On with velocity 0 is treated as Note-Off
      if (det.type === 0x90 && det.byte2 > 0) {
        lastMidiNoteRef.current = {
          note: det.byte1,
          channel: det.channel,
          timestamp: now,
        };
        updated = true;
      } else if (det.type === 0xb0) {
        // 0xB0 = Control Change
        lastMidiCcRef.current = {
          cc: det.byte1,
          value: det.byte2,
          channel: det.channel,
          timestamp: now,
        };
        updated = true;
      }
      if (!updated) return;

      // Immediate evaluation — jumps that match note/cc fire without waiting
      // for the next bar boundary. This is what makes the feature "live".
      const songState = getSongModeState();
      if (!songState.activeSongId) return;
      const activeSong = getActiveSongMode();
      if (!activeSong) return;
      const d = dmRef.current;
      if (!d) return;
      const currentStepId = getSongModeCurrentStepId();
      if (!currentStepId) return;
      const jumps = getSongJumpState().jumpsBySong[activeSong.id] ?? [];
      if (jumps.length === 0) return;
      const ctx = {
        macros: getMacros().map(m => m.value ?? 0),
        lastMidiNote: lastMidiNoteRef.current,
        lastMidiCc: lastMidiCcRef.current,
      };
      // Only fire MIDI-driven jumps immediately — macro-driven jumps wait for
      // the bar boundary so they don't cause mid-loop pattern hiccups.
      const triggered = findTriggeredJump(jumps, currentStepId, ctx);
      if (!triggered) return;
      if (
        triggered.condition.kind !== "midi-note" &&
        triggered.condition.kind !== "midi-cc"
      ) {
        return;
      }
      const r = songModeJumpToStep(triggered.toStepId);
      if (r.ok && r.patternId && r.patternId !== d.activePatternId) {
        d.setActivePattern(r.patternId);
      }
    };
    window.addEventListener("midi:rawmessage", onRaw as EventListener);
    return () => window.removeEventListener("midi:rawmessage", onRaw as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Audio-Recording (TASK-234 / v2.86, v3.63.0 extended) ───────────────────
  // Bei transport:play → AudioEngine.startRecordingForChannels(armed[])
  // Bei transport:stop → AudioEngine.finalizeAllRecordings() → für jeden:
  //   1) WAV via persistRecording (Electron-IPC oder IndexedDB) speichern
  //   2) addAudioTrack({filePath, name, ...}) → erscheint im Mixer als
  //      regulärer Audio-Track (abspielbar nach Stop)
  //
  // v3.63.0: kombiniert armed Live-Inputs + armed Drum/Synth-Parts. Engine
  // erzwingt MAX_SIMULTANEOUS_RECORDINGS=8 — Overflow wird als Performance-
  // Toast an den User gemeldet ("X channels could not start recording").
  const prevRecArmPlayRef = useRef(project.isPlaying);
  useEffect(() => {
    const wasPlaying = prevRecArmPlayRef.current;
    prevRecArmPlayRef.current = project.isPlaying;
    if (wasPlaying === project.isPlaying) return;

    if (project.isPlaying) {
      // PLAY: alle armed Channels starten (Live-Inputs + Drum/Synth-Parts)
      const armedLiveInputs = getArmedLiveInputChannelIds();
      const armedDrumParts = getArmedDrumPartIds();
      const armedIds = [...armedLiveInputs, ...armedDrumParts];
      if (armedIds.length > 0) {
        const result = AudioEngine.startRecordingForChannels(armedIds);
        if (!result.ok && result.rejected.length > 0) {
          // v3.63.0: Performance-Toast — Engine konnte nicht alle Channels
          // gleichzeitig aufnehmen (z.B. mehr als MAX_SIMULTANEOUS_RECORDINGS=8
          // armed). Wir nennen die Anzahl + den Grund (Limit) und lassen den
          // User entscheiden ob er einige Channels disarmt.
          showToast(
            `${result.rejected.length} channel${result.rejected.length === 1 ? "" : "s"} could not start recording (over limit).`,
            { kind: "warning", duration: 5000 },
          );
        }
      }
      return;
    }

    // STOP: alle aktiven Aufnahmen finalisieren + persistieren
    const results = AudioEngine.finalizeAllRecordings();
    if (results.length === 0) return;

    void (async () => {
      for (const rec of results) {
        const ch = getLiveInputChannel(rec.channelId);
        const channelName = ch?.name ?? "Channel";
        try {
          const saved = await persistRecording(
            rec.channelId,
            channelName,
            rec.wavBuffer,
            electron.isElectron ? electron : null,
          );
          try {
            addAudioTrack({
              name: saved.fileName.replace(/\.wav$/i, ""),
              filePath: saved.filePath,
              fileName: saved.fileName,
              fileSize: saved.fileSize,
              volume: 0.8,
              pan: 0,
              muted: false,
              soloed: false,
              sends: { reverb: 0, delay: 0 },
              syncMode: "free",
            });
          } catch (e) {
            console.warn("[Recording] addAudioTrack fehlgeschlagen (Limit erreicht?)", e);
          }
        } catch (e) {
          console.error("[Recording] Persist fehlgeschlagen:", e);
        }
      }
    })();
  }, [project.isPlaying, electron]);

  // ── Arbeitsbereich-Tabs ────────────────────────────────────────────────────
  // Tab-State mit localStorage-Persistenz
  // Sidebar-Breite mit Persistenz
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem("ss-layout:sidebar-width") ?? "288", 10);
    return Math.max(160, Math.min(480, isNaN(saved) ? 288 : saved));
  });
  const sidebarDragRef = useRef(false);
  const sidebarStartXRef = useRef(0);
  const sidebarStartWRef = useRef(0);

  const handleSidebarDragStart = useCallback((e: React.MouseEvent) => {
    sidebarDragRef.current = true;
    sidebarStartXRef.current = e.clientX;
    sidebarStartWRef.current = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      const delta = ev.clientX - sidebarStartXRef.current;
      const next = Math.max(160, Math.min(480, sidebarStartWRef.current + delta));
      setSidebarWidth(next);
    };
    const onUp = () => {
      sidebarDragRef.current = false;
      localStorage.setItem("ss-layout:sidebar-width", String(sidebarWidth));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarWidth]);

  // Tab-State mit localStorage-Persistenz
  const [activeTab, setActiveTab] = useState<"sequencer" | "mixer" | "song" | "humanizer" | "tools" | "kollaboration">(() => {
    const saved = localStorage.getItem("ss-layout:active-tab");
    const valid = ["sequencer", "mixer", "song", "humanizer", "tools", "kollaboration"];
    return (saved && valid.includes(saved) ? saved : "sequencer") as "sequencer";
  });
  // Tab-Wechsel persistieren
  const handleSetActiveTab = useCallback((tab: typeof activeTab) => {
    setActiveTab(tab);
    localStorage.setItem("ss-layout:active-tab", tab);
  }, []);
  const [activeTool, setActiveTool] = useState<'prompt' | 'algorithmic' | 'chords' | 'sampler' | 'workbench' | 'library' | 'script' | 'omnitribe' | 'packs' | 'song' | 'liverec' | 'audioinput' | 'macroSnapshot' | 'diff'>('prompt');

  // ── Dialog-State ─────────────────────────────────────────────────────────
  const [showMidiSettings, setShowMidiSettings] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showThemeSettings, setShowThemeSettings] = useState(false);
  // Unified Settings Panel
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<"design" | "ki" | "keyboard" | "midi-devices" | "midi-cc" | "midi-notes" | "about" | "performance">("design");
  // v3.57.0: Versions-History-Modal-State.
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // v3.59.0: Legacy-Slug Migration Modal-State.
  const [legacyMigration, setLegacyMigration] = useState<{
    isOpen: boolean;
    legacySlug: string;
    newProjectId: string;
    legacyCount: number;
  }>({ isOpen: false, legacySlug: "", newProjectId: "", legacyCount: 0 });

  // v3.22.0: First-Run Welcome-Wizard. shouldAutoShowWelcome liest localStorage
  // synchron — daher lazy init, kein useEffect-Race.
  const [showWelcomeWizard, setShowWelcomeWizard] = useState<boolean>(() => {
    try {
      return shouldAutoShowWelcome();
    } catch {
      return false;
    }
  });

  // ── Theme beim Start laden ─────────────────────────────────────────────────
  React.useEffect(() => { initTheme(); }, []);

  // ── Globale Keyboard-Bindings (konfigurierbar) ────────────────────────────
  useGlobalKeyBindings(true);
  // ── Script-Tastenkürzel: triggern Sandbox-Runs aus useScriptStore ─────────
  useScriptKeyBindings(true);

  // ── Sandbox-Bridge konfigurieren ──────────────────────────────────────────
  // Wir verdrahten die Default-Deny-Bridge der Sandbox einmalig mit den
  // realen App-Settern. ScriptRunner UI + useScriptKeyBindings nutzen
  // beide den gleichen Singleton aus scriptSandboxInstance.ts.
  useEffect(() => {
    configureSandboxBridge({
      setBpm: (v: number) => {
        AudioEngine.setBpm(v);
        projectRef.current?.setBpm(v);
      },
      play: () => {
        // Idempotent: nur starten wenn nicht schon spielend.
        const p = projectRef.current;
        if (p && !p.isPlaying) p.togglePlayStop();
      },
      stop: () => {
        const p = projectRef.current;
        if (p && p.isPlaying) p.togglePlayStop();
      },
      setStep: (partId: string, idx: number, on: boolean) => {
        const d = dmRef.current;
        if (!d) return;
        const pattern = d.getActivePattern();
        const part = pattern?.parts.find((pt) => pt.id === partId);
        if (!part) return;
        const current = !!part.steps[idx]?.active;
        if (current !== on) d.toggleStep(partId, idx);
      },
      dispatchAction: (action: string) => {
        window.dispatchEvent(new CustomEvent(KB_ACTION_EVENT, { detail: action }));
      },
      getMacroValue: (idx: number) => getMacros()[idx]?.value ?? 0,
      setMacroValue: (idx: number, v: number) => setMacroValue(idx, v),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── v3.22.0: Welcome-Wizard "Try it now" Routing ──────────────────────────
  // Pro Wizard-Slide kann ein CustomEvent "synthstudio:welcome:try-it"
  // gefeuert werden. Wir routen ihn hier auf Tab-Switches / Settings-Open.
  useEffect(() => {
    const onTryIt = (e: Event) => {
      const detail = (e as CustomEvent<WelcomeTryItDetail>).detail;
      if (!detail || !detail.target) return;
      switch (detail.target) {
        case "midi-settings":
          setSettingsInitialSection("midi-devices");
          setShowSettings(true);
          break;
        case "korg-bank-editor":
          setKorgBankExportOpen(true);
          break;
        case "scene-launch":
          handleSetActiveTab("sequencer");
          break;
        case "looper":
          handleSetActiveTab("sequencer");
          break;
        case "sample-slicer":
          handleSetActiveTab("tools");
          break;
        case "templates":
          setSettingsInitialSection("midi-devices");
          setShowSettings(true);
          break;
        case "korg-templates":
          // v3.49.0 — KORG Quick-Start Picker öffnen
          setShowKorgTemplatePicker(true);
          break;
        case "settings":
        default:
          setSettingsInitialSection("design");
          setShowSettings(true);
          break;
      }
    };
    window.addEventListener(WELCOME_EVENT_NAME, onTryIt as EventListener);
    return () => window.removeEventListener(WELCOME_EVENT_NAME, onTryIt as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ss:navigate Event-Handler ─────────────────────────────────────────────
  // Wird vom KeyboardBindingsPanel ausgelöst, wenn der User auf einen
  // Skript-Eintrag klickt um ihn im ScriptRunner zu editieren.
  // Auch von MacroPanel (Button-Mode "Edit in Script Runner →" /
  // "Edit in Performance Mode →") genutzt.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string; tool?: string; scriptId?: string }>).detail;
      if (!detail) return;
      if (detail.tab === "tools") {
        handleSetActiveTab("tools");
        // Settings schließen damit Tools sichtbar wird.
        setShowSettings(false);
        // Tools-Sub-Section "script" aktivieren falls angefordert.
        if (detail.tool === "script") {
          setActiveTool("script");
        }
        // Skript-Auswahl: über zusätzlichen Event, den der ScriptRunner abonniert.
        if (detail.scriptId) {
          window.dispatchEvent(
            new CustomEvent("ss:script-select", { detail: { scriptId: detail.scriptId } }),
          );
        }
      } else if (detail.tab === "performance") {
        // Performance Mode öffnen (MacroPanel "Edit in Performance Mode →")
        setShowSettings(false);
        setPerformanceActive(true);
      }
    };
    window.addEventListener("ss:navigate", onNavigate);
    return () => window.removeEventListener("ss:navigate", onNavigate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── macro:button:trigger Event-Handler ────────────────────────────────────
  // MacroPanel.tsx dispatched dieses Event wenn ein Macro im Button-Mode
  // gedrückt wird. Detail enthält triggerKind ("script" | "pad") und
  // triggerMode ("edge" | "hold").
  //  - "script": Script aus useScriptStore in Sandbox laufen lassen (v1.17)
  //  - "pad":    Performance-Pad triggern (v1.20.x) — analog zum Pad-Click in
  //              PatternLaunchPad: dm.setActivePattern + queuePerformancePattern,
  //              sodass quantisierter Wechsel UND Sofort-Switch wie beim
  //              Performance-Pad-Click identisch funktionieren.
  //
  // Trigger-Modes (v1.22.0 TASK-118):
  //  - "edge": single-shot bei mouseDown (klassisch)
  //  - "hold": startet eine Loop via startHoldLoop() — re-fire alle
  //            SCRIPT_HOLD_INTERVAL_MS (200ms) bzw. PAD_HOLD_INTERVAL_MS (100ms),
  //            bis das `macro:button:release` Event eintrifft.
  //            No-Stacking: jeder neue trigger ersetzt vorherige Loop für
  //            denselben Macro-Index.
  //
  // Defensiv: alte Events ohne triggerKind/triggerMode → defaults ("script", "edge").
  useEffect(() => {
    /**
     * Pure single-shot Aktion: Script-Run mit Re-Entrancy-Schutz.
     * Wird sowohl im edge-mode als auch in jeder Hold-Loop-Iteration verwendet.
     */
    const runScriptOnce = (scriptId: string) => {
      const script = getScript(scriptId);
      if (!script || !script.enabled) return;
      if (scriptSandbox.isRunning()) return; // Re-Entrancy-Schutz
      void scriptSandbox.run(script.code, { maxRuntimeMs: script.maxRuntimeMs });
    };

    /**
     * Pure single-shot Aktion: Pad-Trigger (Active-Switch + Queue).
     */
    const runPadOnce = (padIndex: number) => {
      const pads = getPerformancePads();
      const pad = pads[padIndex];
      if (!pad || !pad.patternId) return;
      dmRef.current.setActivePattern(pad.patternId);
      queuePerformancePattern(pad.patternId);
    };

    const onTrigger = (e: Event) => {
      const detail = (e as CustomEvent<{
        macroIndex: number;
        triggerKind?: "script" | "pad";
        triggerMode?: "edge" | "hold";
        scriptId?: string;
        padIndex?: number;
      }>).detail;
      if (!detail) return;
      const triggerKind = detail.triggerKind === "pad" ? "pad" : "script";
      const triggerMode = detail.triggerMode === "hold" ? "hold" : "edge";
      const macroIndex = detail.macroIndex;

      if (triggerKind === "pad") {
        if (typeof detail.padIndex !== "number") return;
        const padIndex = detail.padIndex;
        if (triggerMode === "hold") {
          // Hold-Loop: re-fire alle PAD_HOLD_INTERVAL_MS bis :release
          startHoldLoop(macroIndex, () => runPadOnce(padIndex), PAD_HOLD_INTERVAL_MS);
        } else {
          runPadOnce(padIndex);
        }
        return;
      }

      // triggerKind === "script"
      if (typeof detail.scriptId !== "string") return;
      const scriptId = detail.scriptId;
      if (triggerMode === "hold") {
        // Hold-Loop: re-fire alle SCRIPT_HOLD_INTERVAL_MS bis :release
        startHoldLoop(macroIndex, () => runScriptOnce(scriptId), SCRIPT_HOLD_INTERVAL_MS);
      } else {
        runScriptOnce(scriptId);
      }
    };

    const onRelease = (e: Event) => {
      const detail = (e as CustomEvent<{ macroIndex: number }>).detail;
      if (!detail || typeof detail.macroIndex !== "number") return;
      stopHoldLoop(detail.macroIndex);
    };

    window.addEventListener("macro:button:trigger", onTrigger);
    window.addEventListener("macro:button:release", onRelease);
    return () => {
      window.removeEventListener("macro:button:trigger", onTrigger);
      window.removeEventListener("macro:button:release", onRelease);
      // Safety: alle Loops beim Unmount stoppen (sonst Memory-Leak bei HMR)
      stopAllHoldLoops();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── v2.15: Performance-Recorder Bridge ────────────────────────────────────
  // Loose-coupling: jede Komponente kann window.dispatchEvent("perf:event",
  // { detail: { type, data } }) feuern. Der Recorder zeichnet auf, wenn aktiv.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ type: PerfEventType; data?: Record<string, unknown> }>).detail;
      if (!detail || typeof detail.type !== "string") return;
      recordPerfEvent(detail.type, detail.data);
    };
    window.addEventListener("perf:event", handler);
    return () => window.removeEventListener("perf:event", handler);
  }, []);

  // v2.29: Perf-Event-Dispatchers. v2.22 hat den Recorder-Badge gebaut, aber
  // niemand dispatched jemals "perf:event" — Aufnahmen blieben immer leer.
  // Diese Effects fütteren den Recorder mit dem gleichen State der bereits
  // OSC-Out triggert. Recorder gated intern via isRecording; dispatch ist
  // immer aktiv (kein gate hier).
  const prevBpmRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevBpmRef.current !== null && prevBpmRef.current !== project.bpm) {
      window.dispatchEvent(new CustomEvent("perf:event", {
        detail: { type: "custom", data: { kind: "bpm", value: project.bpm } },
      }));
    }
    prevBpmRef.current = project.bpm;
  }, [project.bpm]);

  const prevIsPlayingRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevIsPlayingRef.current !== null && prevIsPlayingRef.current !== project.isPlaying) {
      window.dispatchEvent(new CustomEvent("perf:event", {
        detail: { type: project.isPlaying ? "play" : "stop", data: {} },
      }));
    }
    prevIsPlayingRef.current = project.isPlaying;
  }, [project.isPlaying]);

  const prevActivePatternRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevActivePatternRef.current !== null && prevActivePatternRef.current !== dm.activePatternId) {
      window.dispatchEvent(new CustomEvent("perf:event", {
        detail: { type: "pattern", data: { id: dm.activePatternId } },
      }));
    }
    prevActivePatternRef.current = dm.activePatternId;
  }, [dm.activePatternId]);

  const prevMutedPerfRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    const pattern = dm.getActivePattern();
    if (!pattern) return;
    const next = new Map<string, boolean>();
    for (const p of pattern.parts) {
      next.set(p.id, !!p.muted);
      const prev = prevMutedPerfRef.current.get(p.id);
      if (prev !== undefined && prev !== !!p.muted) {
        window.dispatchEvent(new CustomEvent("perf:event", {
          detail: { type: "mute", data: { partId: p.id, value: !!p.muted } },
        }));
      }
    }
    prevMutedPerfRef.current = next;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(dm.getActivePattern()?.parts.map(p => ({ id: p.id, muted: p.muted })) ?? [])]);

  const prevMacroPerfRef = useRef<number[]>([]);
  useEffect(() => {
    const values = macroSnapshot.map(m => m.value);
    for (let i = 0; i < values.length; i++) {
      const prev = prevMacroPerfRef.current[i];
      if (prev !== undefined && prev !== values[i]) {
        window.dispatchEvent(new CustomEvent("perf:event", {
          detail: { type: "macro", data: { index: i, value: values[i] } },
        }));
      }
    }
    prevMacroPerfRef.current = values;
  }, [macroSnapshot]);

  // v2.30: Perf-Replay-Consumers — verarbeitet die "perf:replay"-Events die
  // PerformanceRecorderBadge.handlePlay() für jeden aufgezeichneten Event
  // dispatched. Während Replay ist isRecording=false → Producer feuern zwar
  // weiter, aber der Recorder ignoriert sie (kein Endlos-Loop).
  // Ref-Pattern damit Listener stabil bleibt während Store-Hooks rerendern.
  const replayDmRef = useRef(dm);
  replayDmRef.current = dm;
  const replayProjectRef = useRef(project);
  replayProjectRef.current = project;
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = (e as CustomEvent<{ type: string; data?: Record<string, unknown>; t: number }>).detail;
      if (!ev || typeof ev.type !== "string") return;
      try {
        const data = ev.data ?? {};
        if (ev.type === "play") {
          if (!replayProjectRef.current.isPlaying) replayProjectRef.current.togglePlayStop();
          return;
        }
        if (ev.type === "stop") {
          if (replayProjectRef.current.isPlaying) replayProjectRef.current.togglePlayStop();
          return;
        }
        if (ev.type === "pattern" && typeof data.id === "string") {
          replayDmRef.current.setActivePattern(data.id);
          return;
        }
        if (ev.type === "mute" && typeof data.partId === "string" && typeof data.value === "boolean") {
          replayDmRef.current.setPartMuted(data.partId, data.value);
          return;
        }
        if (ev.type === "macro" && typeof data.index === "number" && typeof data.value === "number") {
          setMacroValue(data.index, data.value);
          return;
        }
        if (ev.type === "custom" && data.kind === "bpm" && typeof data.value === "number") {
          replayProjectRef.current.setBpm(data.value);
          return;
        }
      } catch {
        // Defensiv: replay ignoriert Errors (Pattern/Part wurden ggf. gelöscht
        // seit der Aufnahme — Skip statt Crash).
      }
    };
    window.addEventListener("perf:replay", handler);
    return () => window.removeEventListener("perf:replay", handler);
  }, []);

  // ── v2.23: OSC-UDP-Listener-Bridge ────────────────────────────────────────
  // Wenn der Electron-OSC-Server eine Message empfängt, mappen wir sie via
  // mapOscToAction auf das v2.17-Standard-Schema und feuern die zugehörige
  // window-CustomEvent — gleicher Pfad wie der WebSocket-Bridge und die
  // MIDI-Bindings.
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onOscIncoming?.((payload) => {
      const action = mapOscToAction({ address: payload.address, args: payload.args });
      if (action) dispatchOscAction(action);
    });
    return cleanup;
  }, [electron]);

  // ── Automation: Position-Callback registrieren ───────────────────────────
  // Feuert bei jedem Step (auch bei Stille) → ideal für Parameter-Automation
  const automationRef = useRef(automation);
  automationRef.current = automation;
  useEffect(() => {
    const unsubscribe = AudioEngine.onPosition((stepIndex) => {
      const auto = automationRef.current;
      // BPM-Automation
      const bpmVal = auto.getValueAt("bpm", stepIndex);
      if (bpmVal !== null) {
        const rounded = Math.round(bpmVal);
        AudioEngine.setBpm(rounded);
        project.setBpm(rounded);
      }
      // Master-Volume
      const masterVol = auto.getValueAt("master-vol", stepIndex);
      if (masterVol !== null) AudioEngine.setMasterVolume(masterVol);
    });
    return unsubscribe;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Envelope Follower Modulation ─────────────────────────────────────────
  // Liest per rAF die aktuellen Envelope-Level und wendet sie auf Ziel-Parameter an.
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const configs = getEnvelopeFollowerConfigs();
      for (const cfg of configs) {
        if (!cfg.enabled) continue;
        const level = AudioEngine.getChannelEnvelopeLevel(cfg.sourcePartId);
        const mod = level * cfg.amount;
        switch (cfg.target) {
          case "volume":    AudioEngine.setChannelVolume(cfg.targetPartId, Math.min(1, mod)); break;
          case "pan":       AudioEngine.setChannelPan(cfg.targetPartId, (mod * 2) - 1); break;
          case "filterFreq": AudioEngine.setChannelFilterFreq(cfg.targetPartId, 200 + mod * 15800); break;
          case "reverbMix": AudioEngine.setChannelSend(cfg.targetPartId, "reverb", mod); break;
          case "delayMix":  AudioEngine.setChannelSend(cfg.targetPartId, "delay", mod); break;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── kb:action Event-Handler ───────────────────────────────────────────────
  // Lauscht auf alle konfigurierbaren Keyboard-Actions und routet sie.
  useEffect(() => {
    const handler = (e: Event) => {
      const actionId = (e as CustomEvent<string>).detail;
      const dm = dmRef.current;
      if (!dm) return;
      const pattern = dm.getActivePattern();
      switch (actionId) {
        case "play-stop":       project.togglePlayStop(); break;
        case "record":          project.toggleRecord?.(); break;
        case "bpm-up":          project.setBpm(Math.min(300, project.bpm + 1)); break;
        case "bpm-down":        project.setBpm(Math.max(20, project.bpm - 1)); break;
        case "bpm-up-10":       project.setBpm(Math.min(300, project.bpm + 10)); break;
        case "bpm-down-10":     project.setBpm(Math.max(20, project.bpm - 10)); break;
        case "tap-tempo": {
          // post-v1.25.0 Menu-Wiring: einfacher Tap-Tempo via running window-Ref.
          // Letzten Tap-Zeitstempel in window-Slot speichern, Diff → BPM. 3 Taps
          // braucht's für Konvergenz — danach floating-average der letzten Intervalle.
          const w = window as unknown as { __ssTapTempo?: { lastTs: number; intervals: number[] } };
          if (!w.__ssTapTempo) w.__ssTapTempo = { lastTs: 0, intervals: [] };
          const now = Date.now();
          const prev = w.__ssTapTempo.lastTs;
          if (prev > 0) {
            const interval = now - prev;
            if (interval > 200 && interval < 2000) { // 30..300 BPM
              w.__ssTapTempo.intervals.push(interval);
              if (w.__ssTapTempo.intervals.length > 8) w.__ssTapTempo.intervals.shift();
              const avg = w.__ssTapTempo.intervals.reduce((a, b) => a + b, 0) / w.__ssTapTempo.intervals.length;
              const bpm = Math.round(60000 / avg);
              project.setBpm(Math.max(20, Math.min(300, bpm)));
            } else {
              // Zu lange Pause → Reset der Sequenz, mit diesem Tap neu starten
              w.__ssTapTempo.intervals = [];
            }
          }
          w.__ssTapTempo.lastTs = now;
          break;
        }
        case "tab-sequencer":   handleSetActiveTab("sequencer"); break;
        case "tab-mixer":       handleSetActiveTab("mixer"); break;
        case "tab-song":        handleSetActiveTab("song"); break;
        case "tab-humanizer":   handleSetActiveTab("humanizer"); break;
        case "tab-tools":       handleSetActiveTab("tools"); break;
        case "tab-collab":      handleSetActiveTab("kollaboration"); break;
        case "open-midi":       setSettingsInitialSection("midi-cc"); setShowSettings(p => !p); break;
        case "open-shortcuts":  setSettingsInitialSection("keyboard"); setShowSettings(p => !p); break;
        case "open-settings":   setSettingsInitialSection("design"); setShowSettings(p => !p); break;
        case "pattern-next": {
          const pats = dm.patterns;
          const idx = pats.findIndex(p => p.id === dm.activePatternId);
          if (idx < pats.length - 1) dm.setActivePattern(pats[idx + 1].id);
          break;
        }
        case "pattern-prev": {
          const pats = dm.patterns;
          const idx = pats.findIndex(p => p.id === dm.activePatternId);
          if (idx > 0) dm.setActivePattern(pats[idx - 1].id);
          break;
        }
        case "pattern-duplicate": {
          const before = dm.patterns.length;
          dm.duplicatePattern(dm.activePatternId);
          // Toast nach kurzem Frame, damit dm.patterns aktualisiert ist —
          // wir wissen den Namen aber jetzt schon (Source) und melden ihn direkt.
          const src = dm.patterns.find(p => p.id === dm.activePatternId);
          if (src) toast(`Pattern „${src.name}" dupliziert (${before} → ${before + 1})`, { kind: "success" });
          break;
        }
        case "pattern-copy-samples-from-prev": {
          // v2.4: nimmt Samples + FX + Volume/Pan vom vorherigen Pattern in
          // der Liste und kopiert sie in das aktuelle Pattern. Wenn nicht
          // verfügbar (erstes Pattern oder nur eins), no-op.
          // v2.5: User-Feedback via Toast.
          const pats = dm.patterns;
          const idx = pats.findIndex(p => p.id === dm.activePatternId);
          if (idx > 0) {
            dm.copySamplesFromPattern(pats[idx - 1].id, dm.activePatternId);
            toast(`Sampler übernommen aus „${pats[idx - 1].name}"`, { kind: "success" });
          } else {
            toast("Kein vorheriges Pattern in der Liste", { kind: "warning" });
          }
          break;
        }
        case "pattern-clear": {
          // v3.65.0: Pre-Action AutoBackup vor destructive Action.
          void doAutoBackupBeforeAction("Clear Pattern").finally(() => {
            dm.clearPattern();
          });
          break;
        }
        case "pattern-fill": {
          const partId = dm.activePartId ?? pattern?.parts[0]?.id;
          if (partId) dm.fillPattern(partId);
          break;
        }
        case "pattern-randomize": {
          const partId = dm.activePartId ?? pattern?.parts[0]?.id;
          if (partId) dm.randomizePattern(partId);
          break;
        }
        case "part-up": {
          const parts = pattern?.parts ?? [];
          const idx = parts.findIndex(p => p.id === dm.activePartId);
          if (idx > 0) dm.setActivePart(parts[idx - 1].id);
          break;
        }
        case "part-down": {
          const parts = pattern?.parts ?? [];
          const idx = parts.findIndex(p => p.id === dm.activePartId);
          if (idx < parts.length - 1) dm.setActivePart(parts[idx + 1].id);
          break;
        }
        case "undo": project.undo(); break;
        case "redo": project.redo(); break;
        case "save": doSaveProject(); break;
        // v2.9: bisher NO-OP — Hidden-Bug. Toggle wird jetzt im Store
        // gesetzt; UI/Audio-Engine reagieren auf den Listener.
        case "toggle-note-repeat": {
          toggleNoteRepeat();
          toast(`Note Repeat: ${isNoteRepeatEnabled() ? "AN" : "AUS"}`, {
            kind: "info", duration: 1500,
          });
          break;
        }
        // v2.10: Hidden-Bug-Fix — toggle-morph hatte keinen Handler
        case "toggle-morph": {
          const cur = getMorphState();
          setMorphActive(!cur.isActive);
          toast(`Pattern-Morph: ${!cur.isActive ? "AN" : "AUS"}`, {
            kind: "info", duration: 1500,
          });
          break;
        }
      }
    };
    window.addEventListener(KB_ACTION_EVENT, handler);
    return () => window.removeEventListener(KB_ACTION_EVENT, handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, handleSetActiveTab]);

  // ── MIDI-Hook ─────────────────────────────────────────────────────────────
  const midi = useMidi({
    onBpmChange: project.setBpm,
    // v3.37.0: SPP-driven Start — wenn useMidi den positionStep weiterreicht
    // (External-Sync 0xFA mit vorherigem SPP), seeken wir die AudioEngine
    // BEVOR togglePlayStop läuft. play() in useTransport konsumiert das
    // _pendingStartStep statt nur fromStep=0 zu nutzen.
    onPlayStop: (positionStep) => {
      if (typeof positionStep === "number") {
        AudioEngine.seekToStep(positionStep);
      }
      project.togglePlayStop();
    },
    onClockBpm: (bpm) => project.setBpm(Math.round(bpm)),
    onNoteOn: (note, velocity) => {
      const ks = getKeyboardSamplerState();
      if (ks.enabled && ks.zones.length > 0) {
        AudioEngine.triggerKeyboardSamplerNote(note, velocity);
      }
    },
    onPartTrigger: (partId, velocity) => {
      // Live Step Recording: MIDI-Note → Step im aktiven Pattern bei isRecording
      const pattern = dmRef.current.getActivePattern();
      if (!pattern || !projectRef.current.isRecording) return;
      const step = dmRef.current.currentStep;
      // Overdub: Step aktivieren + Velocity aus MIDI setzen (kein blindes Toggle)
      const existingStep = pattern.parts.find(p => p.id === partId)?.steps[step];
      if (!existingStep?.active) {
        dmRef.current.toggleStep(partId, step);
      }
      dmRef.current.setStepVelocity(partId, step, velocity);
    },
    parts: dm.getActivePattern()?.parts ?? [],
  });

  // ── TASK-231 (v2.84): nanoKONTROL2 LED-Feedback Sync ──────────────────────
  // Snapshot von Mute+Solo der ersten 8 Parts → LED-Feedback. Diff-Sync im
  // NanoKontrolFeedback-Wrapper sorgt dafür, dass nur geänderte LEDs gesendet
  // werden (verhindert MIDI-Spam bei jedem Render).
  const drumMuteSoloSnapshot = (() => {
    const active = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!active) return "";
    return active.parts
      .slice(0, 8)
      .map(p => `${p.muted ? "1" : "0"}${p.soloed ? "1" : "0"}`)
      .join("");
  })();
  useEffect(() => {
    const active = dm.patterns.find(p => p.id === dm.activePatternId);
    if (!active) return;
    const channels = active.parts.slice(0, 8).map(p => ({
      muted: p.muted,
      soloed: p.soloed,
    }));
    midi.syncFeedbackLeds?.(channels);
    // drumMuteSoloSnapshot ist eine stringifizierte Form derselben Daten —
    // wir nehmen ihn als Dependency damit die effect-Identität via primitiver
    // String-Equality bestimmt wird, statt via Array-Reference (immer neu).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drumMuteSoloSnapshot, midi.feedbackEnabled, midi.feedbackOutputDeviceId]);

  // ── v3.232 — E2S Pattern Sync (Out) ────────────────────────────────────
  // Sendet bei jedem Pattern-Wechsel CC32 (Bank-LSB) + Program Change an die
  // KORG Electribe 2/2S. Workaround fuer Stock-FW-Limitation (E2/E2S sendet
  // bei lokalem Pattern-Wechsel NICHTS auf MIDI-Out — nur diese Richtung
  // funktioniert). Settings-Toggle + Output + Channel in MidiSettings.tsx.
  // Index-Quelle: numerische Position in der Pattern-Bank.
  // Dedup-Guard sitzt im Sender (lastSentIndex).
  useEffect(() => {
    const idx = dm.patterns.findIndex(p => p.id === dm.activePatternId);
    if (idx < 0) return;
    void syncE2sPattern(idx);
  }, [dm.activePatternId, dm.patterns]);


  // ── Live Step Recording (MPC-Overdub-Style, post-v1.30.0; Welle 2 v1.31+) ─
  // Wenn isRecording + isPlaying aktiv sind, werden MIDI-Note-Hits direkt als
  // Steps in der aktiven Pattern aufgezeichnet. Welle 2: recordingMode
  // (overdub/replace) + punch-in/out range.
  useLiveStepRecorder({
    dm,
    isRecording: project.isRecording,
    isPlaying: project.isPlaying,
    recordingMode: project.recordingMode,
    punchInStep: project.punchInStep,
    punchOutStep: project.punchOutStep,
  });

  // ── v2.40: MIDI-Event-Bridge ausgelagert in hooks/useMidiEventBridge.ts ─
  // Hängt alle midi:* Window-Listener an (v1.76 partVolume/Pan/Solo/Fx,
  // v1.76 partMute, v2.34 BPM/PlayStop/Stop/MasterVolume/MuteSet, v1.92+v2.34
  // pattern). Refs werden übergeben damit Store-Re-Renders den Effekt
  // nicht neu mounten.
  useMidiEventBridge({ dmRef, projectRef });

  // v1.97: synchronisiert das BPM des Clock-Output mit dem Projekt-BPM.
  // Damit folgt der externe Synth automatisch BPM-Änderungen in Synthstudio.
  useEffect(() => {
    midi.setClockOutBpm(project.bpm);
  }, [project.bpm, midi.setClockOutBpm]);

  // v2.47: OSC-Out-Bridge ausgelagert in hooks/useOscOutBridge.ts.
  // Enthält BPM (v2.26), Transport (v2.27), Step rate-limited (v2.27),
  // Mute-Diff (v2.28), Macro-Diff (v2.28), Volume-Diff (v2.31),
  // Pattern-Switch (v2.31).
  useOscOutBridge({
    isElectron: electron.isElectron,
    oscOutConfig,
    sendOscMessage: electron.sendOscMessage,
    bpm: project.bpm,
    isPlaying: project.isPlaying,
    activeParts: dm.getActivePattern()?.parts.map(p => ({
      id: p.id,
      muted: !!p.muted,
      volume: p.volume ?? 1,
    })) ?? null,
    activePatternId: dm.activePatternId,
    macroValues: macroSnapshot.map(m => m.value),
  });

  // v1.92 + v2.34: midi:pattern wird jetzt im useMidiEventBridge-Hook
  // (siehe weiter oben) verarbeitet. Accepts number | {index} | {patternId}.

  // v2.10: midi:commitLiveEdit — Hidden-Bug-Fix. War dispatched aber kein
  // Listener. Bindet jetzt direkt an dm.commitLivePatternEdit.
  useEffect(() => {
    const handleCommit = () => {
      dmRef.current.commitLivePatternEdit();
      toast("Live-Edit committed", { kind: "success", duration: 1500 });
    };
    window.addEventListener("midi:commitLiveEdit", handleCommit);
    return () => window.removeEventListener("midi:commitLiveEdit", handleCommit);
  }, []);

  // v2.10: midi:scene — scenelaunch-Target dispatched eine sceneIndex,
  // kein Listener vorhanden. Wir aktivieren die Scene + setzen das
  // entsprechende Pattern aktiv via setActiveScene + setActivePattern.
  useEffect(() => {
    const handleScene = (e: Event) => {
      const sceneIndex = (e as CustomEvent<number>).detail;
      if (typeof sceneIndex !== "number") return;
      // Direkt aus dem Singleton-Store lesen (kein React-state-Lock-In)
      const scenes = getSceneState().scenes;
      const scene = scenes[sceneIndex];
      if (!scene) return;
      sceneStoreSetActiveScene(scene.id);
      if (scene.patternId) {
        dmRef.current.setActivePattern(scene.patternId);
      }
      toast(`Scene ${sceneIndex + 1}: ${scene.name}`, { kind: "info", duration: 1500 });
    };
    window.addEventListener("midi:scene", handleScene);
    return () => window.removeEventListener("midi:scene", handleScene);
  }, []);

  // v3.97.0: midi:stepRecorder — MIDI-Step-Recorder (Logic Pro-Style Step-Input).
  // useMidi dispatcht bei jedem Note-On den Event mit {note, velocity, channel}.
  // Wenn der Recorder aktiv UND ein Channel armed ist, schreiben wir den Step
  // im aktiven Pattern + advancen den Cursor um 1 (modulo stepCount).
  // Modi: "overwrite" = clear vor write; "overdub" = additiv (Velocity-Update
  // wenn bereits aktiv, sonst aktivieren).
  useEffect(() => {
    const handleStepRec = (e: Event) => {
      const detail = (e as CustomEvent<{ note: number; velocity: number; channel: number }>).detail;
      if (!detail || typeof detail.velocity !== "number") return;
      const rec = getMidiStepRecorderState();
      if (!rec.enabled || !rec.armedPartId) return;
      const pattern = dmRef.current.getActivePattern();
      if (!pattern) return;
      const part = pattern.parts.find((p) => p.id === rec.armedPartId);
      if (!part) return;
      const stepIndex = rec.currentStep;
      if (stepIndex < 0 || stepIndex >= pattern.stepCount) return;
      const isActive = part.steps[stepIndex]?.active === true;
      if (rec.mode === "overwrite") {
        // Erst clearen falls aktiv (toggle deaktiviert), dann aktivieren.
        if (isActive) {
          dmRef.current.toggleStep(rec.armedPartId, stepIndex);
        }
        dmRef.current.toggleStep(rec.armedPartId, stepIndex);
      } else {
        // Overdub: nur aktivieren wenn nicht aktiv
        if (!isActive) {
          dmRef.current.toggleStep(rec.armedPartId, stepIndex);
        }
      }
      const vel = Math.max(1, Math.min(127, detail.velocity ?? 100));
      dmRef.current.setStepVelocity(rec.armedPartId, stepIndex, vel);
      // Auto-Advance Cursor (modulo stepCount).
      midiStepRecorderAdvanceStep(pattern.stepCount);
    };
    window.addEventListener("midi:stepRecorder", handleStepRec);
    return () => window.removeEventListener("midi:stepRecorder", handleStepRec);
  }, []);

  // v2.87 (TASK-235): midi:loopTrigger / midi:loopErase — Live-Looper-Pads.
  // useMidi dispatcht beim CC>63 / Note-On den jeweiligen Event mit loopIndex
  // im detail. AudioEngine kennt den Source-Channel nicht direkt — wir nehmen
  // die im Store hinterlegte sourceChannelId (per LooperPanel-Picker setzbar)
  // bzw. fallback auf den Master-Tap (sourceChannelId="").
  useEffect(() => {
    const handleTrigger = (e: Event) => {
      const loopIndex = (e as CustomEvent<number>).detail;
      if (typeof loopIndex !== "number") return;
      const slot = getLoopSlot(loopIndex);
      AudioEngine.triggerLoop(loopIndex, slot?.sourceChannelId ?? "");
    };
    const handleErase = (e: Event) => {
      const loopIndex = (e as CustomEvent<number>).detail;
      if (typeof loopIndex !== "number") return;
      AudioEngine.eraseLoop(loopIndex);
    };
    window.addEventListener("midi:loopTrigger", handleTrigger);
    window.addEventListener("midi:loopErase", handleErase);
    return () => {
      window.removeEventListener("midi:loopTrigger", handleTrigger);
      window.removeEventListener("midi:loopErase", handleErase);
    };
  }, []);

  // v2.87 (TASK-235): Looper-Engine → Store Bridge. Beim ersten Render einmal
  // Callbacks setzen — der Store wird informiert sobald die Engine State /
  // Length aktualisiert. KEIN Stale-Closure-Issue weil setLoopState/-Length
  // Module-Functions sind (Singleton-Store-Pattern).
  useEffect(() => {
    AudioEngine.setLooperCallbacks(
      (index, state) => setLoopState(index, state),
      (index, lengthBeats, lengthSec, frameCount) =>
        setLoopLength(index, lengthBeats, lengthSec, frameCount),
    );
  }, []);

  // v2.92 (TASK-240): MIDI-Note-Out — synchronisiert die Per-Part-Configs aus
  // useMidiNoteOutStore mit der laufenden AudioEngine. Diff-Sync: bei jedem
  // State-Change vergleichen wir die Store-Configs mit dem aktuellen Engine-
  // State (via getMidiNoteOut().getAllConfiguredPartIds()) und schicken
  // setPartConfig / clearPartConfig entsprechend rein. Setzen außerdem den
  // globalen Enable-Flag durch.
  const midiNoteOutState = useMidiNoteOutStore();
  const midiNoteOutLockToastShownRef = useRef(false);
  useEffect(() => {
    // v2.98 Pro-Gate: wenn der User MIDI-Note-Out im Store aktiviert hat aber
    // weder Trial noch Pro-Lizenz hält, halten wir die Engine aus (silent skip
    // im Audio-Scheduling) und zeigen den Toast genau einmal. Toggle im
    // ChannelInspector bleibt aber bedienbar (Discovery), damit der User die
    // Konfiguration sehen + nach Aktivierung sofort nutzen kann.
    const requested = midiNoteOutState.enabled;
    const unlocked = isFeatureUnlocked(PRO_FEATURE_MIDI_NOTE_OUT);
    const effectiveEnabled = requested && unlocked;

    AudioEngine.setMidiNoteOutEnabled(effectiveEnabled);

    if (requested && !unlocked && !midiNoteOutLockToastShownRef.current) {
      midiNoteOutLockToastShownRef.current = true;
      showToast("MIDI-Note-Out ist ein Pro-Feature — Notes werden NICHT extern gesendet.", {
        kind: "warning",
        duration: 6000,
        action: {
          label: "Lizenz kaufen",
          onClick: () => {
            try { if (typeof window !== "undefined") window.open(GUMROAD_PRODUCT_URL, "_blank"); } catch { /* */ }
          },
        },
      });
    }
    if (!requested) {
      // Reset toast latch sobald User MIDI-Note-Out wieder ausschaltet.
      midiNoteOutLockToastShownRef.current = false;
    }

    const engineConfigured = new Set(AudioEngine.getMidiNoteOut().getAllConfiguredPartIds());
    const storeConfigured = new Set(Object.keys(midiNoteOutState.configs));
    // Entfernen: was in Engine ist aber nicht im Store
    for (const partId of engineConfigured) {
      if (!storeConfigured.has(partId)) {
        AudioEngine.clearMidiNoteOutPartConfig(partId);
      }
    }
    // Setzen / Aktualisieren: aktuelle Store-Configs (Configs darf der User
    // auch ohne Pro pflegen — sie sind ein No-Op solange engine.enabled=false).
    for (const [partId, cfg] of Object.entries(midiNoteOutState.configs)) {
      AudioEngine.setMidiNoteOutPartConfig(partId, cfg);
    }
  }, [midiNoteOutState]);

  // v3.98.0: MIDI-Click-Out — sync useMidiClickStore mit AudioEngine. Bei
  // jedem State-Change schreiben wir Enable + Config in die Engine. Der
  // Sender selbst wird im useMidi-Hook gebridged.
  const midiClickState = useMidiClickStore();
  useEffect(() => {
    AudioEngine.setMidiClickOutConfig({
      outputId: midiClickState.outputDeviceId,
      channel: midiClickState.channel,
      accentNote: midiClickState.accentNote,
      beatNote: midiClickState.beatNote,
      accentVelocity: midiClickState.velocityAccent,
      beatVelocity: midiClickState.velocityBeat,
    });
    AudioEngine.setMidiClickOutEnabled(
      midiClickState.enabled && !!midiClickState.outputDeviceId,
    );
    // v3.99.0: Note-Duration + Count-In an Engine durchreichen.
    AudioEngine.setMidiClickNoteDurationMs(midiClickState.noteDurationMs);
    AudioEngine.setCountInEnabled(midiClickState.countInEnabled);
    AudioEngine.setCountInBars(midiClickState.countInBars);
  }, [midiClickState]);

  // v3.99.0: Count-In Countdown-Overlay — listen to `countin:tick` Events
  // und zeige verbleibende Beats als floating Status-Pill an.
  const [countInState, setCountInState] = useState<{ remaining: number; total: number } | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ phase: "start" | "tick" | "end"; remaining: number; total: number }>).detail;
      if (!detail) return;
      if (detail.phase === "end") {
        setCountInState(null);
      } else {
        setCountInState({ remaining: detail.remaining, total: detail.total });
      }
    };
    window.addEventListener("countin:tick", handler);
    return () => window.removeEventListener("countin:tick", handler);
  }, []);

  // v2.90 (TASK-237-FOLLOWUP-1): electribe:motion-lanes — beim Electribe-Import
  // dispatcht electribeImport.ts diesen Event mit den Motion-Sequencer-Lanes.
  // Wir mappen partIndex → echte partId via dmRef.current.patterns[id], konvertieren
  // das Electribe-Target ("Volume:3") auf ein Synthstudio AutomationTarget
  // ("vol:<partId>") und fuettern jeden Punkt via setPoint. Lanes mit unsupported
  // Param-Names werden uebersprungen + geloggt.
  useEffect(() => {
    const handleMotionLanes = (e: Event) => {
      const detail = (e as CustomEvent<{ patternId: string; lanes: unknown }>).detail;
      if (!detail || !Array.isArray(detail.lanes)) return;
      const dmNow = dmRef.current;
      if (!dmNow) return;
      const pattern = dmNow.patterns.find(p => p.id === detail.patternId);
      if (!pattern) {
        console.warn("[electribe:motion-lanes] Pattern nicht gefunden:", detail.patternId);
        return;
      }
      const partIds = pattern.parts.map(p => p.id);
      const auto = automationRef.current;
      const targetStepCount: 16 | 32 | 64 = pattern.stepCount;

      let added = 0;
      let skipped = 0;
      for (const raw of detail.lanes) {
        if (!raw || typeof raw !== "object") { skipped++; continue; }
        const lane = raw as ElectribeMotionLane;
        const target = mapElectribeLaneToAutomationTarget(lane.target, partIds);
        if (!target) { skipped++; continue; }
        const laneId = auto.addLane(target, lane.label);
        const scaledPoints = scaleMotionPointsToStepCount(lane.points, targetStepCount);
        for (const key of Object.keys(scaledPoints)) {
          const step = Number(key);
          if (!Number.isFinite(step)) continue;
          auto.setPoint(laneId, step, scaledPoints[step]);
        }
        added++;
      }
      if (added > 0 || skipped > 0) {
        toast(
          `Motion-Lanes: ${added} importiert${skipped > 0 ? ` (${skipped} unsupported)` : ""}`,
          { kind: added > 0 ? "success" : "info", duration: 3500 },
        );
      }
    };
    window.addEventListener("electribe:motion-lanes", handleMotionLanes);
    return () => window.removeEventListener("electribe:motion-lanes", handleMotionLanes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v2.90 (TASK-238-FOLLOWUP-1): sample-slicer:apply — DrumMachine dispatcht
  // diesen Event nachdem der SampleSliceEditor "Apply" gedrueckt hat. Wir
  // legen die Slice-Buffer in useSlicePadStore ab (max 16 Pads). Mehr als 16
  // Slices werden abgeschnitten.
  //
  // Trigger-Pfad (Phase 2, separater Task): Performance-Pad-Klick im "Slice"-
  // Mode wuerde AudioEngine.playSliceBuffer mit slot.buffer + sampleRate
  // aufrufen. Heute: Auto-Preview-Toast + Buffer ist im Store ablegbar.
  useEffect(() => {
    const handleSlicerApply = (e: Event) => {
      const detail = (e as CustomEvent<{
        sampleName: string;
        sampleRate: number;
        slices: unknown;
      }>).detail;
      if (!detail || !Array.isArray(detail.slices)) return;
      // Validierung: nur Float32Array-Slices akzeptieren
      const slices: Float32Array[] = [];
      for (const item of detail.slices) {
        if (item instanceof Float32Array) slices.push(item);
      }
      if (slices.length === 0) {
        toast("Keine validen Slices erhalten", { kind: "warning", duration: 3500 });
        return;
      }
      const assigned = assignSlicesToPads(slices, {
        sampleName: detail.sampleName ?? "sample",
        sampleRate: detail.sampleRate ?? 44100,
        replace: true,
      });
      const truncated = slices.length > MAX_SLICE_PADS;
      toast(
        truncated
          ? `${assigned}/${slices.length} Slices auf Slice-Pads gelegt (max ${MAX_SLICE_PADS})`
          : `${assigned} Slice(s) auf Slice-Pads gelegt`,
        { kind: "success", duration: 3500 },
      );
    };
    window.addEventListener("sample-slicer:apply", handleSlicerApply);
    return () => window.removeEventListener("sample-slicer:apply", handleSlicerApply);
  }, []);

  // v2.91 (TASK-238-FOLLOWUP-1B): midi:slicePad — Pad-Bank-Slot mit
  // kind=slice (oder beliebiges Mapping mit target playSlicePad) triggert
  // den Slice-Buffer aus useSlicePadStore. AudioEngine.playSliceBuffer ist
  // defensive (kein-Op wenn buffer null). Out-of-range-sliceIndex → silent
  // ignored (getSlicePadSlot returnt null).
  useEffect(() => {
    const handleSlicePad = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      const sliceIndex = typeof detail === "number" ? detail : Number(detail);
      if (!Number.isFinite(sliceIndex)) return;
      const slot = getSlicePadSlot(sliceIndex);
      if (!slot || !slot.buffer) return;
      AudioEngine.playSliceBuffer(slot.buffer, slot.sampleRate);
    };
    window.addEventListener("midi:slicePad", handleSlicePad);
    return () => window.removeEventListener("midi:slicePad", handleSlicePad);
  }, []);

  // v2.78: midi:perfpad — Note-Mapping mit performancePadIndex triggert
  // ein Performance-Mode-Pad. Re-Uses die runPadOnce-Logik (Active-Switch +
  // queuePerformancePattern). Velocity wird aktuell nicht weiterverarbeitet,
  // bleibt aber im event-detail für künftige Velocity-sensitive Triggers.
  useEffect(() => {
    const handlePerfPad = (e: Event) => {
      const detail = (e as CustomEvent<{ padIndex: number; velocity: number }>).detail;
      if (!detail || typeof detail.padIndex !== "number") return;
      const pads = getPerformancePads();
      const pad = pads[detail.padIndex];
      if (!pad || !pad.patternId) return;
      dmRef.current.setActivePattern(pad.patternId);
      queuePerformancePattern(pad.patternId);
    };
    window.addEventListener("midi:perfpad", handlePerfPad);
    return () => window.removeEventListener("midi:perfpad", handlePerfPad);
  }, []);

  // v2.1: midi:partSend — Reverb/Delay-Send-Level via MIDI-CC steuern
  useEffect(() => {
    const handleSend = (e: Event) => {
      const detail = (e as CustomEvent<{ partId: string; bus: "reverb" | "delay"; value: number }>).detail;
      if (!detail || typeof detail.partId !== "string") return;
      const v = Math.max(0, Math.min(1, detail.value));
      mixer.setChannelSend(detail.partId, detail.bus, v);
    };
    window.addEventListener("midi:partSend", handleSend);
    return () => window.removeEventListener("midi:partSend", handleSend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v1.99: midi:toggleStep — pad triggert ein spezifisches Step-Toggle.
  // Ermöglicht Live-Finger-Drumming via Right-Click-Bound-Pads.
  useEffect(() => {
    const handleToggleStep = (e: Event) => {
      const detail = (e as CustomEvent<{ partId: string; stepIndex: number }>).detail;
      if (!detail || typeof detail.partId !== "string") return;
      dmRef.current.toggleStep(detail.partId, detail.stepIndex);
    };
    window.addEventListener("midi:toggleStep", handleToggleStep);
    return () => window.removeEventListener("midi:toggleStep", handleToggleStep);
  }, []);

  // v1.88: midi:macroValue — direkt einen Macro-Wert per CC steuern.
  useEffect(() => {
    const handleMacroValue = (e: Event) => {
      const detail = (e as CustomEvent<{ index: number; value: number }>).detail;
      if (!detail) return;
      const idx = Math.max(0, Math.min(7, Math.floor(detail.index)));
      const v = Math.max(0, Math.min(1, detail.value));
      setMacroValue(idx, v);
    };
    window.addEventListener("midi:macroValue", handleMacroValue);
    return () => window.removeEventListener("midi:macroValue", handleMacroValue);
  }, []);

  // v1.78: midi:runScript — User hat ein Script als MidiLearnTarget gebunden,
  // beim Trigger soll es laufen. Wir nutzen scriptSandbox.run mit Re-Entrancy-
  // Schutz (gleicher Pattern wie runScriptOnce oben im macro:button:trigger).
  useEffect(() => {
    const handleRunScript = (e: Event) => {
      const scriptId = (e as CustomEvent<string>).detail;
      if (typeof scriptId !== "string") return;
      const script = getScript(scriptId);
      if (!script || !script.enabled) return;
      if (scriptSandbox.isRunning()) return;
      void scriptSandbox.run(script.code, { maxRuntimeMs: script.maxRuntimeMs });
    };
    window.addEventListener("midi:runScript", handleRunScript);
    return () => window.removeEventListener("midi:runScript", handleRunScript);
  }, []);

  // ── v3.16.0 / v3.18.0: OmniTribe-Bridge CustomEvents ─────────────────────
  // Bridge dispatched paramChange / vuMeter / spectrum auf window.
  // v3.18.0: VU + Spectrum werden in useOmniTribeMetersStore gepiped, der
  // OmniTribe-Tab (VU-Meter, Spectrum-Analyzer) re-rendert daraus.
  useEffect(() => {
    const onParam = (e: Event) => {
      // ChordPanel + (zukunftig) andere Panels lauschen direkt auf das Event.
      // App.tsx loggt nur für Debug (10% Sample-Rate).
      if (Math.random() < 0.1) {
        const detail = (e as CustomEvent).detail;
        // eslint-disable-next-line no-console
        console.log("[OmniTribe] paramChange", detail);
      }
    };
    const onVu = (e: Event) => {
      const detail = (e as CustomEvent).detail as { levels?: number[] } | undefined;
      if (detail?.levels) setOmniTribeVuLevels(detail.levels);
    };
    const onSpectrum = (e: Event) => {
      const detail = (e as CustomEvent).detail as { bins?: number[] } | undefined;
      if (detail?.bins) setOmniTribeSpectrumBins(detail.bins);
    };
    window.addEventListener("omnitribe:paramChange", onParam);
    window.addEventListener("omnitribe:vuMeter", onVu);
    window.addEventListener("omnitribe:spectrum", onSpectrum);
    return () => {
      window.removeEventListener("omnitribe:paramChange", onParam);
      window.removeEventListener("omnitribe:vuMeter", onVu);
      window.removeEventListener("omnitribe:spectrum", onSpectrum);
    };
  }, []);

  // ── v3.18.0: OmniTribe-Connection-Polling (für UI-Disconnect-Banner) ─────
  const [omniTribeConnected, setOmniTribeConnected] = useState<boolean>(false);
  useEffect(() => {
    const tick = () => {
      const wasConnected = omniTribeConnected;
      const isConnected  = omniTribeBridge.isConnected;
      if (wasConnected && !isConnected) {
        // Disconnect → reset VU/Spectrum auf 0.
        resetOmniTribeMeters();
      }
      if (wasConnected !== isConnected) {
        setOmniTribeConnected(isConnected);
      }
    };
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [omniTribeConnected]);

  // ── Launchpad Grid Controller ─────────────────────────────────────────────
  const launchpadEnabled = midi.outputDevices.some(d => isGridDevice(d.name));
  const launchpadPattern = dm.getActivePattern();
  const launchpadActivePart = launchpadPattern?.parts.find(p => p.id === dm.activePartId) ?? launchpadPattern?.parts[0];
  useLaunchpad({
    midi,
    steps: (launchpadActivePart?.steps ?? []).map(s => ({ active: s.active, velocity: s.velocity ?? 100 })),
    currentStep: dm.currentStep,
    onStepToggle: (i) => { if (dm.activePartId) dm.toggleStep(dm.activePartId, i); },
    enabled: launchpadEnabled,
  });

  // ── MIDI Out Callback nach midi-Hook-Initialisierung setzen ──────────────
  useEffect(() => {
    AudioEngine.setMidiOutCallback(
      midi.midiOutEnabled
        ? (note, velocity) => midi.sendNoteOn(note, velocity)
        : null
    );
  }, [midi.midiOutEnabled, midi.sendNoteOn]);

  // ── Zentrale Tastatur-Shortcuts ───────────────────────────────────────────
  useKeyboardShortcuts({
    dm,
    isPlaying: project.isPlaying,
    bpm: project.bpm,
    onPlayStop: project.togglePlayStop,
    onRecord: project.toggleRecord,
    onBpmChange: project.setBpm,
    onToggleSampleBrowser: () => {}, // Sample-Browser ist immer sichtbar
    onToggleMidiSettings: () => setShowMidiSettings(prev => !prev),
    onToggleShortcutsHelp: () => setShowShortcutsHelp(prev => !prev),
  });

  // ── Fenstertitel synchronisieren ─────────────────────────────────────────
  // Browser: document.title | Electron: electron.setWindowTitle() via Hook
  useWindowTitleSync({
    projectName: project.projectName,
    isDirty: project.isDirty,
  });

  // ── Pattern-Generator Apply-Event ─────────────────────────────────────────
  useEffect(() => {
    const handleApply = (e: Event) => {
      const generated = (e as CustomEvent).detail as {
        bpm: number;
        parts: Array<{ name: string; steps: Array<{ active: boolean; velocity: number }> }>;
      };
      const pattern = dm.getActivePattern();
      if (!pattern) return;
      // Im Live-Edit darf der laufende Playback-Pattern sein Tempo behalten.
      if (dm.liveEditSourcePatternId) {
        dm.setPatternBpm(pattern.id, generated.bpm);
      } else {
        project.setBpm(generated.bpm);
      }
      // Steps der ersten N Parts (nach Index) in die DM-Parts übertragen
      generated.parts.forEach((genPart, i) => {
        const dmPart = pattern.parts[i];
        if (!dmPart) return;
        dm.setPartSteps(
          dmPart.id,
          genPart.steps.map(s => s.active),
          genPart.steps.map(s => s.velocity),
        );
      });
    };
    window.addEventListener("pattern-generator:apply", handleApply);
    return () => window.removeEventListener("pattern-generator:apply", handleApply);
  }, [dm, project]);

  // ── Kollaborations-Sync ──────────────────────────────────────────────────────
  // Collab-Broadcast wird gewrappt um Session-Events aufzuzeichnen
  const wrappedBroadcast = useCallback((event: Parameters<typeof collab.broadcast>[0]) => {
    collab.broadcast(event);
    recordEvent(event as Record<string, unknown>);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab.broadcast]);

  const {
    collabToggleStep,
    collabBpmChange,
    collabPlayStop,
    remoteToggleStep,
    remoteSetActivePattern,
    outputMode,
    setOutputMode,
  } = useCollabSync({
    broadcast: wrappedBroadcast,
    dm,
    setBpm: project.setBpm,
    isPlaying: project.isPlaying,
    bpm: project.bpm,
    togglePlayStop: project.togglePlayStop,
    samples: project.samples,
  });
  // dm-Objekt mit collab-fähigem toggleStep (kapselt Senden des Events)
  const collabDm = useMemo(
    () => ({ ...dm, toggleStep: collabToggleStep }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dm, collabToggleStep]
  );
  // ── Makro-Bindings: Parameter in Echtzeit setzen ─────────────────────────
  // Refs werden bei jedem Render aktualisiert (dmRef.current = dm, projectRef.current = project),
  // dadurch arbeitet der Handler immer mit den aktuellen Stores statt einem stale Snapshot
  // vom Mount-Zeitpunkt. Das war die Ursache, warum Macro-Knobs nichts gemacht haben,
  // sobald sich der Drum-Machine-State änderte (Pattern-Wechsel, Sample-Load etc.).
  useEffect(() => {
    const handler = (e: Event) => {
      const { index, value } = (e as CustomEvent<{ index: number; value: number }>).detail;
      const macro = getMacros()[index];
      if (!macro) return;
      const d = dmRef.current;
      const p = projectRef.current;
      applyMacroBindings(macro, value, {
        setMasterVolume: (v) => AudioEngine.setMasterVolume(v),
        setBpm: (v) => p.setBpm(v),
        setChannelVolume: (partId, v) => {
          d.setPartVolume(partId, v);
          AudioEngine.setChannelVolume(partId, v);
        },
        setChannelPan: (partId, v) => {
          d.setPartPan(partId, v);
          AudioEngine.setChannelPan(partId, v);
        },
        setChannelSend: (partId, bus, v) => {
          AudioEngine.setChannelSend(partId, bus, v);
        },
        // TASK-117: LFO-Rate/Depth Macro-Bindings sind jetzt verdrahtet.
        // SynthEngine cached die Werte pro Part-ID und überschreibt
        // synthParams.lfoRate/lfoDepth beim nächsten Step-Trigger.
        setLfoRate: (partId, hz) => AudioEngine.setPartLfoRate(partId, hz),
        setLfoDepth: (partId, depth) => AudioEngine.setPartLfoDepth(partId, depth),
        onUnhandled: (b) => {
          console.warn(`[Macro] target "${b.target}" ist noch nicht implementiert (Part: ${b.partName ?? b.partId})`);
        },
      });
    };
    window.addEventListener("macro:change", handler);
    return () => window.removeEventListener("macro:change", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── v3.115.0: Macro-Snapshot Morph + Recall via MIDI ───────────────────
  // morphAmount: CC → setSnapshotMorphAmount + apply morphed values
  // recallSnapshot: Note-On/CC>63 → recallSnapshotInStore + apply
  useEffect(() => {
    const applyMorphedToMacros = () => {
      const out = getCurrentMorphedSnapshotValues();
      if (!out) return;
      for (let i = 0; i < out.length; i++) {
        setMacroValue(i, out[i]);
      }
    };
    const onMorphAmount = (e: Event) => {
      const v = (e as CustomEvent<number>).detail;
      if (typeof v !== "number" || !Number.isFinite(v)) return;
      setSnapshotMorphAmount(v);
      applyMorphedToMacros();
    };
    const onRecall = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id !== "string" || !id) return;
      if (!recallSnapshotInStore(id)) return;
      applyMorphedToMacros();
    };
    window.addEventListener("midi:morphAmount", onMorphAmount);
    window.addEventListener("midi:recallSnapshot", onRecall);
    return () => {
      window.removeEventListener("midi:morphAmount", onMorphAmount);
      window.removeEventListener("midi:recallSnapshot", onRecall);
    };
  }, []);

  // ── Eingehende Collab-Nachrichten (Chat) ─────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const raw = (e as CustomEvent).detail;
      if (raw?.type === "chat" && raw.sender && raw.text) {
        addChatMessage({ senderName: raw.sender, text: raw.text, timestamp: Date.now(), isOwn: false });
      }
      // Rollen-Zuweisung empfangen
      if (raw?.type === "role:change" && raw.role) {
        const myId = session.myUserId;
        if (raw.targetUserId === myId) {
          setMyRole(raw.role as "editor" | "viewer");
        } else if (raw.targetUserId) {
          setParticipantRole(raw.targetUserId as string, raw.role as "editor" | "viewer");
        }
      }
    };
    window.addEventListener("collab:message", handler);
    return () => window.removeEventListener("collab:message", handler);
  }, []);

  // ── Version-Snapshots alle 5 Min. (ein-/ausschaltbar) ────────────────────
  useEffect(() => {
    if (!apiSettings2.snapshotsEnabled) return;
    const id = setInterval(() => {
      const pattern = dm.getActivePattern();
      if (pattern) saveSnapshot(dm.patterns, project.projectName);
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiSettings2.snapshotsEnabled]);

  // ── Schließen-Bestätigung bei ungespeicherten Änderungen ─────────────────
  // Browser: beforeunload-Event | Electron: wird durch Main-Prozess gehandhabt
  useEffect(() => {
    if (electron.isElectron) return; // Electron hat eigene Schließ-Logik im Main-Prozess

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (project.isDirty) {
        e.preventDefault();
        e.returnValue = ""; // Browser zeigt Standard-Dialog
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [electron.isElectron, project.isDirty]);

  // ── Electron-Menü-Events an React-State binden ───────────────────────────
  // Im Browser: No-Op (alle Callbacks werden registriert aber nie aufgerufen)
  // Goldenes Gesetz: useElectronMenuBindings prüft intern ob Electron aktiv ist

  const handleMenuImportSamples = useCallback(async () => {
    // Menü-Event: Samples importieren
    // In Electron: nativer Dialog über useElectron()-Hook
    // Im Browser: kein Menü-Event möglich – dieser Callback wird nie aufgerufen
    if (electron.isElectron) {
      const result = await electron.openFileDialog({
        title: "Samples importieren",
        filters: [
          {
            name: "Audio-Dateien",
            extensions: ["wav", "mp3", "ogg", "flac", "aiff", "aif", "m4a"],
          },
          { name: "Alle Dateien", extensions: ["*"] },
        ],
        multiSelections: true,
      });
      if (!result.canceled && result.filePaths.length > 0) {
        project.importSamplesFromPaths(result.filePaths);
      }
    }
  }, [electron, project]);

  const handleMenuImportFolder = useCallback(async () => {
    // Menü-Event: Ordner importieren – nativer Folder-Dialog + rekursiver Import mit Progress
    if (electron.isElectron) {
      const result = await electron.openFolderDialog({ title: "Sample-Ordner importieren" });
      if (!result.canceled && result.filePaths[0]) {
        const started = await electron.importFolder(result.filePaths[0]).catch(() => null);
        if (!started?.importId) {
          // Fallback: flaches Verzeichnis-Listing
          const dir = await electron.listDirectory(result.filePaths[0]);
          if (dir.success && dir.entries) {
            const paths = dir.entries.filter(e => !e.isDirectory && e.isAudio).map(e => e.path);
            if (paths.length > 0) project.importSamplesFromPaths(paths);
          }
        }
      }
    }
  }, [electron, project]);

  const handleMenuImportProject = useCallback(async () => {
    await doLoadProject();
  }, [doLoadProject]);

  const handleMenuOpen = useCallback(async () => {
    await doLoadProject();
  }, [doLoadProject]);

  const handleNewProject = useCallback(() => {
    setShowNewProjectDialog(true);
  }, []);

  // v3.49.0 — KORG Quick-Start Picker via Global-Event (Welcome-Wizard + Menüs)
  useEffect(() => {
    const handler = () => setShowKorgTemplatePicker(true);
    window.addEventListener("synthstudio:open-korg-templates", handler);
    return () => window.removeEventListener("synthstudio:open-korg-templates", handler);
  }, []);

  /**
   * BUG-013 Fix: vollständiger Reset aller Project-relevanten Stores. Wird
   * von "Neues Projekt" (NewProjectDialog) aufgerufen damit kein State aus
   * der vorherigen Session in das neue Projekt durchsickert.
   *
   * Reihenfolge: rein-runtime-State zuerst (Performance/Macros/Audio/Scripts),
   * dann persistierte Sub-Stores (Mixer/Automation/Melodic/Note-Repeat/
   * Transpose/Morph/Humanizer), zuletzt DrumMachine + Project (so dass die
   * Default-Patterns sauber landen).
   *
   * App.tsx-Sub-Stores die NICHT zurückgesetzt werden (Absicht):
   *  - useThemeStore (User-Vorliebe persistiert über Projekte)
   *  - useApiSettingsStore (API-Keys, AI-Modell)
   *  - useMetronomeStore (Custom-Sounds bleiben)
   *  - useKeyboardBindingsStore (User-Shortcuts)
   *  - useScriptStore App-Scripts (clearProjectScripts() entfernt nur projekt-scope'd)
   *  - useChordMemoryStore / useMidiStore (Geräte-Settings)
   */
  const doFullProjectReset = useCallback(() => {
    // Reine Runtime-Singletons
    resetPerformance();
    resetMacros();
    clearAudioTracks();
    clearProjectScripts();
    resetMelodicParts();
    resetNoteRepeat();
    resetTranspose();
    resetMorph();
    // React-Hook-State Sub-Stores
    mixer.resetMixer();
    automation.resetAutomation();
    humanizer.reset();
    song.resetSong();
    // DrumMachine zuletzt (erstellt das frische Default-Pattern)
    dm.resetAll();
  }, [mixer, automation, humanizer, song, dm]);

  /**
   * Dispatch eines kb:action-Events. Wird von den neuen Menü-Bindings genutzt
   * damit die Logik im zentralen kb:action-Handler (siehe unten) bleibt — kein
   * Code-Duplikat. (post-v1.25.0 FEAT-MENU-Wiring)
   */
  const dispatchKbAction = useCallback((action: string) => {
    window.dispatchEvent(new CustomEvent(KB_ACTION_EVENT, { detail: action }));
  }, []);

  useElectronMenuBindings({
    onNew: handleNewProject,
    onOpen: handleMenuOpen,
    onSave: doSaveProject,
    onExport: project.exportProject,
    onUndo: project.undo,
    onRedo: project.redo,
    onPlayStop: project.togglePlayStop,
    onRecord: project.toggleRecord,
    onImportSamples: handleMenuImportSamples,
    onImportFolder: handleMenuImportFolder,
    onImportProject: handleMenuImportProject,

    // post-v1.25.0 — Music-Production-Menü-Items routen via kb:action.
    // Pattern-Aktionen werden im zentralen Handler oben dispatched
    // (siehe useEffect mit KB_ACTION_EVENT-Listener).
    onPatternClear:     () => dispatchKbAction("pattern-clear"),
    onPatternRandomize: () => dispatchKbAction("pattern-randomize"),
    onPatternFill:      () => dispatchKbAction("pattern-fill"),
    onPatternDuplicate: () => dispatchKbAction("pattern-duplicate"),
    onPatternNext:      () => dispatchKbAction("pattern-next"),
    onPatternPrev:      () => dispatchKbAction("pattern-prev"),
    onBpmUp:            () => dispatchKbAction("bpm-up"),
    onBpmDown:          () => dispatchKbAction("bpm-down"),
    onTapTempo:         () => dispatchKbAction("tap-tempo"),
    onOpenPerformance:  () => setPerformanceActive(true),
    onOpenAudioWorkbench: () => { handleSetActiveTab("tools"); setActiveTool("workbench"); },
    onTabChange: (tabId) => {
      // Whitelist-Check damit kein invaliderer Tab-Wert die App breakt
      if (
        tabId === "sequencer" || tabId === "mixer" || tabId === "song" ||
        tabId === "humanizer" || tabId === "tools" || tabId === "kollaboration"
      ) {
        handleSetActiveTab(tabId);
      }
    },
  });

  // ── Sample auf aktiven Kanal legen ──────────────────────────────────────────
  const handleAssignToChannel = useCallback(
    (sampleUrl: string, sampleName: string) => {
      const pattern = dm.getActivePattern();
      if (!pattern) return;
      const partId = dm.activePartId ?? pattern.parts[0]?.id;
      if (!partId) return;
      dm.setPartSample(partId, sampleUrl, sampleName);
    },
    [dm]
  );

  // Aktiver Kanal-Name für Anzeige im SampleBrowser
  const activeChannelName = useMemo(() => {
    const pattern = dm.getActivePattern();
    if (!pattern) return undefined;
    const partId = dm.activePartId ?? pattern.parts[0]?.id;
    return pattern.parts.find(p => p.id === partId)?.name;
  }, [dm]);

  // v3.166: Track-Overview-Aggregat für Topbar-Status-Widget.
  // v3.167-fix: Source sind die Parts des aktiven Patterns, da MixerChannelState
  // keine muted/soloed/volume-Fields hat. PartData liefert diese korrekt → das
  // Widget zeigt jetzt echte (N muted) / solo-Counts statt 0.
  const trackOverviewInfo = useMemo(() => {
    const activePattern = dm.patterns.find((p) => p.id === dm.activePatternId);
    const channels = (activePattern?.parts ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      muted: p.muted,
      soloed: p.soloed,
      volume: p.volume,
    }));
    return computeTrackOverview({
      patterns: dm.patterns,
      channels,
      totalSamples: project.samples.length,
    });
  }, [dm.patterns, dm.activePatternId, project.samples]);

  // Kategorie eines Samples aktualisieren
  // v3.54.0: Nutzt jetzt updateSample (statt addSamples, das Duplikate per
  // Path filtert und somit Updates verschluckte).
  const handleUpdateSampleCategory = useCallback(
    (id: string, category: string) => {
      project.updateSample(id, { category });
    },
    [project]
  );

  // ── Drop-Handler für ElectronDropZone ─────────────────────────────────────

  const handleDropAudioFiles = useCallback(
    (paths: string[]) => {
      // Auto-Tag: Dateinamen analysieren + Samples hinzufügen
      const samples = paths.map(p => {
        const name = p.split(/[\\/]/).pop() ?? p;
        const autoTags = autoTagFromFilename(p);
        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name,
          path: p,
          category: autoTags[0] ?? "imported",
          tags: autoTags,
        };
      });
      project.addSamples(samples);
      // Asynchrone BPM-Erkennung für die ersten 5 Samples
      samples.slice(0, 5).forEach(s => {
        detectBpmForSample(s).catch(() => {/* ignore */});
      });
    },
    [project, detectBpmForSample]
  );

  const handleDropFolder = useCallback(
    (folderPath: string) => {
      // Ordner-Drop: Pfad an importSamplesFromPaths übergeben
      // Vollständige Ordner-Traversierung durch IPC-Bridge-Agent
      project.importSamplesFromPaths([folderPath]);
    },
    [project]
  );

  const handleDropProject = useCallback(
    (filePath: string) => {
      doLoadProject(filePath);
    },
    [doLoadProject]
  );

  // v2.13: Browser-Drop von Audio-Files → BPM-Detection per Web Audio API
  // Wir analysieren nur die ERSTE Datei (eines Drops) um den Toast nicht zu
  // spammen. Bei hoher Konfidenz bekommt der User einen "Übernehmen"-Button.
  const handleDropAudioFilesRaw = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || typeof AudioContext === "undefined") return;
      const file = files[0];
      let audioContext: AudioContext | null = null;
      try {
        const arrayBuffer = await file.arrayBuffer();
        audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const { detectBpm } = await import("@/utils/bpmAndOnsetDetection");
        const result = detectBpm(audioBuffer.getChannelData(0), audioBuffer.sampleRate, {
          maxSeconds: 30,
        });
        if (result.confidence >= 0.3) {
          toast(
            `BPM erkannt: ${result.bpm} (${Math.round(result.confidence * 100)}% Konfidenz) – „${file.name}"`,
            {
              kind: "info",
              duration: 8000,
              action: {
                label: `→ ${result.bpm} BPM`,
                onClick: () => {
                  project.setBpm(result.bpm);
                  toast(`Projekt-Tempo gesetzt: ${result.bpm} BPM`, { kind: "success" });
                },
              },
            },
          );
        }
      } catch (err) {
        // BPM-Detection ist best-effort – Stille statt Toast-Spam
        console.warn("[App] BPM-Detection fehlgeschlagen:", err);
      } finally {
        try { await audioContext?.close(); } catch { /* ignore */ }
      }
    },
    [project]
  );

  // ── KORG Sample-Bank-Import (v3.3.0) ──────────────────────────────────────

  const [korgBankFile, setKorgBankFile] = useState<File | null>(null);

  /** Handler used by both DropZone und CustomEvent-Listener. */
  const handleKorgBankFile = useCallback((file: File) => {
    // Pro-Feature gate at entry point. The Modal is shown anyway if not Pro?
    // Cleaner UX: gate at entry → no modal-flash for free-tier users.
    if (!requireProFeature(PRO_FEATURE_KORG_BANK_IMPORT)) return;
    setKorgBankFile(file);
  }, []);

  /** Wenn die Modal pro-Slot ein Sample hinzufügt: an Sample-Library weiterleiten. */
  const handleKorgBankAddSample = useCallback(
    (sample: KorgBankSample) => {
      project.addSamples([
        {
          id: sample.id,
          name: sample.name,
          path: sample.url, // Blob-URL — Web Audio kann das direkt laden
          category: sample.category,
        },
      ]);
    },
    [project],
  );

  // v3.4: KORG-Bank-EXPORT (Synthstudio → .all). Toolbar-Button feuert
  // "korg:bank:export-open"; wir öffnen den Editor-Modal.
  const [korgBankExportOpen, setKorgBankExportOpen] = useState<boolean>(false);
  // v3.7: extern gedroppte .all-Datei, die in den OFFENEN Editor geleitet wird
  // (statt in den Read-Only KorgBankModal). Editor consumed → Reset auf null.
  const [korgBankEditorFile, setKorgBankEditorFile] = useState<File | null>(null);

  // CustomEvent-Listener für Drag-Drop von App-Body und Picker-Aufrufe aus
  // DrumMachine. dispatchFileDrop("KICK.esx") wird zu "korg:bank:open" geroutet.
  // v3.7: Wenn der Editor offen ist und es eine .all ist, geht der Drop in den
  // Editor (Edit-Existing-Flow) statt in den Read-Only Modal.
  useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (!(file instanceof File)) return;
      const lower = file.name.toLowerCase();
      const isAll = lower.endsWith(".all");
      const isEsx = lower.endsWith(".esx");
      // v3.29.0 — Wenn der Editor offen ist, gehen .all (E2 mode) UND
      // .esx (ESX mode) in den Editor statt in den Read-Only Modal.
      if (korgBankExportOpen && (isAll || isEsx)) {
        setKorgBankEditorFile(file);
      } else {
        handleKorgBankFile(file);
      }
    };
    window.addEventListener("korg:bank:open", handler);
    return () => window.removeEventListener("korg:bank:open", handler);
  }, [handleKorgBankFile, korgBankExportOpen]);

  useEffect(() => {
    const handler = () => setKorgBankExportOpen(true);
    window.addEventListener("korg:bank:export-open", handler);
    return () => window.removeEventListener("korg:bank:export-open", handler);
  }, []);

  // v3.47.0: Plugin-Chain-Preset JSON-Import via Drag-Drop.
  // dragDropDispatch routet .synthpreset.json → "plugin-preset:import".
  // Wir lesen die Datei, parsen via importPresetFromJson und feedback'n via Toast.
  useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (!(file instanceof File)) return;
      void (async () => {
        try {
          const text = await file.text();
          const { importPresetFromJson } = await import(
            "@/store/usePluginChainPresetStore"
          );
          const { toast } = await import("@/store/useToastStore");
          const result = importPresetFromJson(text);
          if (result.success) {
            const count = result.importedIds.length;
            const skipped = result.duplicatesSkipped > 0
              ? ` (${result.duplicatesSkipped} Duplikat${result.duplicatesSkipped === 1 ? "" : "e"} übersprungen)`
              : "";
            toast(
              `Plugin-Preset: ${count} importiert${skipped}`,
              { kind: "success" },
            );
            for (const w of result.warnings.slice(0, 3)) {
              toast(w, { kind: "info" });
            }
          } else {
            const firstError = result.errors[0] ?? "Import fehlgeschlagen";
            toast(firstError, { kind: "error" });
          }
        } catch (err) {
          console.error("[App] plugin-preset:import Fehler:", err);
        }
      })();
    };
    window.addEventListener("plugin-preset:import", handler);
    return () => window.removeEventListener("plugin-preset:import", handler);
  }, []);

  // v3.64.0: MIDI-Mapping JSON-Sharing — analog v3.47 Plugin-Preset.
  // dragDropDispatch routet .synthmidi.json → "midi-mapping:import".
  // Default-Modus: merge (sichert vor versehentlichem clear). Replace ist
  // explizit über den File-Picker in MidiSettings erreichbar.
  useEffect(() => {
    const handler = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (!(file instanceof File)) return;
      void (async () => {
        try {
          const text = await file.text();
          const { parseMidiMappingShareJson, applyMappingShareImport } = await import(
            "@/utils/midiMappingShare"
          );
          const { toast } = await import("@/store/useToastStore");
          const r = parseMidiMappingShareJson(text);
          if (!r.success || !r.envelope) {
            toast(r.errors[0] ?? "MIDI-Mapping-Import fehlgeschlagen", { kind: "error" });
            return;
          }
          const applied = applyMappingShareImport(
            r.envelope,
            { ccMappings: midi.mappings, noteMappings: midi.noteMappings },
            "merge",
          );
          midi.loadTemplate(applied.ccMappings, applied.noteMappings);
          const v1Tag = r.migratedFromV1 ? " (v1-migriert)" : "";
          toast(
            `MIDI-Mapping „${r.envelope.meta.name}" importiert${v1Tag}: +${applied.addedCount} neu, ${applied.replacedCount} ersetzt`,
            { kind: "success" },
          );
          for (const w of r.warnings.slice(0, 3)) {
            toast(w, { kind: "info" });
          }
        } catch (err) {
          console.error("[App] midi-mapping:import Fehler:", err);
        }
      })();
    };
    window.addEventListener("midi-mapping:import", handler);
    return () => window.removeEventListener("midi-mapping:import", handler);
  }, [midi]);

  const handleDropZipFile = useCallback(
    async (file: File) => {
      try {
        const { extractSamplesFromZip } = await import("@/utils/zipSampleImport");
        const { samples, audioCount } = await extractSamplesFromZip(file);
        if (audioCount === 0) {
          alert("Keine Audio-Dateien im ZIP-Archiv gefunden.");
          return;
        }
        project.addSamples(samples);
      } catch (err) {
        console.error("[App] ZIP-Drop Fehler:", err);
        alert("ZIP-Archiv konnte nicht entpackt werden.");
      }
    },
    [project]
  );

  // ── Song-Tab-View (inline component zur Vermeidung von Prop-Drilling) ────────
  const SongTabView = useMemo(() => {
    // eslint-disable-next-line react/display-name
    return ({ song, automation, dm, project, isPlaying }: any) => {
      const [songSubTab, setSongSubTab] = useState<"timeline" | "automation" | "scenes">("timeline");
      const parts = dm.getActivePattern()?.parts ?? [];

      return (
        <div className="h-full flex flex-col overflow-hidden">
          {/* Sub-Tabs */}
          <div className="flex gap-0 border-b border-border-color bg-bg-panel flex-shrink-0">
            {(["timeline", "automation", "scenes"] as const).map(t => (
              <button
                key={t}
                onClick={() => setSongSubTab(t)}
                className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                  songSubTab === t
                    ? "border-accent-secondary text-accent-secondary bg-bg-elevated"
                    : "border-transparent text-text-dim hover:text-text-muted"
                }`}
              >
                {t === "timeline" ? "Arrangement" : t === "automation" ? "Automation" : "Scene Launch"}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {songSubTab === "timeline" && (
              <div className="h-full overflow-y-auto p-4">
                <SongTimeline song={song} isPlaying={isPlaying} className="min-h-full" />
              </div>
            )}
            {songSubTab === "automation" && (
              <AutomationView
                lanes={automation.lanes}
                stepCount={automation.stepCount}
                parts={parts}
                recording={automation.recording}
                onAddLane={(target, label) => automation.addLane(target, label)}
                onRemoveLane={automation.removeLane}
                onSetPoint={automation.setPoint}
                onClearPoint={automation.clearPoint}
                onClearLane={automation.clearLane}
                onToggleLane={automation.setLaneEnabled}
                onToggleRecording={() => automation.setRecording(!automation.recording)}
              />
            )}
            {songSubTab === "scenes" && (
              <div className="h-full overflow-y-auto p-4">
                <SceneLaunchPad
                  patterns={dm.patterns}
                  activePatternId={dm.activePatternId}
                  isPlaying={isPlaying}
                  onLaunchScene={(patternId) => dm.setActivePattern(patternId)}
                />
              </div>
            )}
          </div>
        </div>
      );
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Performance-Mode Popup State-Sync (ROADMAP feature) ──────────────────
  // Broadcastet den aktuellen Performance-relevanten State ins Popup-Fenster
  // wann immer sich etwas ändert. Nur aktiv wenn das Popup offen ist.
  useEffect(() => {
    if (!electron.isElectron || !performancePopupOpen) return;
    electron.sendPerfPopupState?.({
      pads: performance.pads,
      patterns: dm.patterns.map((p) => ({ id: p.id, name: p.name })),
      activePatternId: dm.activePatternId ?? "",
      queuedPatternId: performance.queuedPatternId,
      quantizeMode: performance.quantizeMode,
      bpm: project.bpm,
      currentStep: dm.currentStep,
    });
  }, [
    electron,
    performancePopupOpen,
    performance.pads,
    performance.queuedPatternId,
    performance.quantizeMode,
    dm.patterns,
    dm.activePatternId,
    dm.currentStep,
    project.bpm,
  ]);

  // Listener: Actions aus dem Popup empfangen und in die Stores dispatchen.
  // Verwendet Refs für die Dispatcher damit der Listener Closure nicht mit
  // jedem Pattern-Wechsel neu aufgesetzt wird (stale-closure bei dm).
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onPerfPopupAction?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const action = payload as Record<string, unknown>;

      switch (action.type) {
        case "pad-click":
          if (typeof action.patternId === "string" && action.patternId.length > 0) {
            dmRef.current.setActivePattern(action.patternId);
            queuePerformancePattern(action.patternId);
          }
          break;
        case "quantize-mode-change":
          if (action.mode === "bar" || action.mode === "beat" || action.mode === "step") {
            setPerformanceQuantizeMode(action.mode);
          }
          break;
        // Phase 2: Edit-Mode-Actions — direkt in usePerformanceStore dispatchen.
        // Nach jeder Mutation feuert die Store-Subscription unsere Broadcast-
        // useEffect oben → Popup bekommt den neuen State live zurück.
        case "set-pad-at":
          if (typeof action.index === "number") {
            setPerformancePadAt(action.index, action.pad as PerformancePad | null);
          }
          break;
        case "set-pad-color":
          if (typeof action.index === "number" && typeof action.color === "string") {
            setPerformancePadColor(action.index, action.color);
          }
          break;
        case "set-pad-label":
          if (typeof action.index === "number" && typeof action.label === "string") {
            setPerformancePadLabel(action.index, action.label);
          }
          break;
        case "clear-pad":
          if (typeof action.index === "number") {
            clearPerformancePad(action.index);
          }
          break;
        // Phase 2: Reorder-Mode-Actions
        case "move-pad":
          if (typeof action.fromIndex === "number" && typeof action.toIndex === "number") {
            movePerformancePad(action.fromIndex, action.toIndex);
          }
          break;
        case "move-multiple-pads":
          if (Array.isArray(action.fromIndices) && typeof action.toIndex === "number") {
            moveMultiplePerformancePads(
              (action.fromIndices as unknown[]).filter((n): n is number => typeof n === "number"),
              action.toIndex,
            );
          }
          break;
        case "request-state":
          // Popup hat gerade gemountet und bittet um initialen State.
          // Wir broadcasten unmittelbar — die Effect-deps oben würden erst
          // beim nächsten State-Wechsel feuern.
          electron.sendPerfPopupState?.({
            pads: performance.pads,
            patterns: dm.patterns.map((p) => ({ id: p.id, name: p.name })),
            activePatternId: dm.activePatternId ?? "",
            queuedPatternId: performance.queuedPatternId,
            quantizeMode: performance.quantizeMode,
            bpm: project.bpm,
            currentStep: dm.currentStep,
          });
          break;
      }
    });
    return cleanup;
  }, [
    electron,
    performance.pads,
    performance.queuedPatternId,
    performance.quantizeMode,
    dm.patterns,
    dm.activePatternId,
    dm.currentStep,
    project.bpm,
  ]);

  // ── FX-Popup-Windows State-Sync (Multi-Window-Workspace Phase 1) ─────────
  // Pro geöffnetem FX-Popup-Fenster broadcasten wir den aktuellen Part-FX-State.
  // Tracking welche channelIds offen sind passiert via onFxPopupClosed-Event +
  // initial via "request-state"-Action (s.u.).
  const [openFxChannelIds, setOpenFxChannelIds] = useState<Set<string>>(() => new Set());

  // Cleanup-Listener: wenn ein FX-Popup geschlossen wird (entweder vom User
  // oder beim Schließen der App), entfernen wir die channelId aus der Tracking-Map.
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onFxPopupClosed?.((channelId) => {
      if (!channelId || typeof channelId !== "string") return;
      setOpenFxChannelIds((prev) => {
        if (!prev.has(channelId)) return prev;
        const next = new Set(prev);
        next.delete(channelId);
        return next;
      });
    });
    return cleanup;
  }, [electron]);

  // State-Broadcast: für jeden offenen FX-Popup den aktuellen Part-FX-State pushen.
  // Findet die aktive Pattern → sucht den Part per channelId (= part.id) → schickt.
  useEffect(() => {
    if (!electron.isElectron || openFxChannelIds.size === 0) return;
    const activePattern = dm.patterns.find((p) => p.id === dm.activePatternId);
    if (!activePattern) return;
    openFxChannelIds.forEach((channelId) => {
      const part = activePattern.parts.find((p) => p.id === channelId);
      if (!part) return;
      electron.sendFxPopupState?.(channelId, {
        partId: part.id,
        partName: part.name,
        fx: part.fx,
      });
    });
  }, [electron, openFxChannelIds, dm.patterns, dm.activePatternId]);

  // Action-Listener: Popup → Main. Setzt FX-Params oder antwortet auf request-state.
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onFxPopupAction?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const { channelId, action } = payload as { channelId?: string; action?: Record<string, unknown> };
      if (!channelId || typeof channelId !== "string") return;
      if (!action || typeof action !== "object") return;

      switch (action.type) {
        case "request-state": {
          // Popup hat gerade gemountet — channelId tracken und sofort den State broadcasten.
          setOpenFxChannelIds((prev) => {
            if (prev.has(channelId)) return prev;
            const next = new Set(prev);
            next.add(channelId);
            return next;
          });
          const activePattern = dmRef.current.patterns.find(
            (p) => p.id === dmRef.current.activePatternId,
          );
          const part = activePattern?.parts.find((p) => p.id === channelId);
          if (part) {
            electron.sendFxPopupState?.(channelId, {
              partId: part.id,
              partName: part.name,
              fx: part.fx,
            });
          }
          break;
        }
        case "fx-change": {
          const partial = action.partial;
          if (partial && typeof partial === "object") {
            dmRef.current.setPartFx(channelId, partial as Partial<import("@/audio/AudioEngine").ChannelFx>);
          }
          break;
        }
      }
    });
    return cleanup;
  }, [electron]);

  // ── Mixer-Popup State-Broadcast (Multi-Window-Workspace, post-v1.26.0) ────
  // Tracking: setMixerPopupOpen wurde im Open-Click + onMixerPopupClosed-Event
  // verwaltet (siehe oben). Hier nur der Broadcast bei State-Änderungen.

  useEffect(() => {
    if (!electron.isElectron || !mixerPopupOpen) return;
    const activePattern = dm.patterns.find((p) => p.id === dm.activePatternId);
    if (!activePattern) return;
    electron.sendMixerPopupState?.({
      channels: activePattern.parts.map((part) => ({
        partId: part.id,
        name: part.name,
        volume: part.volume,
        pan: part.pan,
        muted: part.muted,
        soloed: part.soloed,
      })),
      masterVolume: mixer.masterVolume,
      bpm: project.bpm,
      selectedPartId: mixer.selectedChannelId,
    });
  }, [
    electron,
    mixerPopupOpen,
    dm.patterns,
    dm.activePatternId,
    mixer.masterVolume,
    mixer.selectedChannelId,
    project.bpm,
  ]);

  // Action-Listener: Mixer-Popup → Main.
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onMixerPopupAction?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const action = payload as Record<string, unknown>;
      const d = dmRef.current;
      switch (action.type) {
        case "request-state": {
          // Popup hat gemountet — markiere als offen + broadcast sofort
          electron.logRendererEvent?.("mixer-request-state-received", {});
          // BUG-023: ignoriere late messages nach destroy()
          if (mixerJustClosedRef.current) {
            electron.logRendererEvent?.("mixer-request-state-IGNORED-late", {});
            break;
          }
          setMixerPopupOpen(true);
          const activePattern = d.patterns.find((p) => p.id === d.activePatternId);
          if (!activePattern) break;
          electron.sendMixerPopupState?.({
            channels: activePattern.parts.map((part) => ({
              partId: part.id,
              name: part.name,
              volume: part.volume,
              pan: part.pan,
              muted: part.muted,
              soloed: part.soloed,
            })),
            masterVolume: mixer.masterVolume,
            bpm: project.bpm,
            selectedPartId: mixer.selectedChannelId,
          });
          break;
        }
        case "set-part-volume":
          if (typeof action.partId === "string" && typeof action.volume === "number") {
            d.setPartVolume(action.partId, action.volume);
          }
          break;
        case "set-part-pan":
          if (typeof action.partId === "string" && typeof action.pan === "number") {
            d.setPartPan(action.partId, action.pan);
          }
          break;
        case "set-part-mute":
          if (typeof action.partId === "string" && typeof action.muted === "boolean") {
            d.setPartMuted(action.partId, action.muted);
          }
          break;
        case "set-part-solo":
          if (typeof action.partId === "string" && typeof action.soloed === "boolean") {
            // FOLLOWUP-102-3: shiftKey toggelt zwischen exclusive (default) und additive Verhalten.
            const exclusive = !action.shiftKey;
            d.setPartSoloed(action.partId, action.soloed, exclusive);
          }
          break;
        case "select-part":
          if (typeof action.partId === "string") {
            mixer.setSelectedChannel(action.partId);
          }
          break;
        case "set-master-volume":
          if (typeof action.volume === "number") {
            mixer.setMasterVolume(action.volume);
            AudioEngine.setMasterVolume(action.volume);
          }
          break;
      }
    });
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electron, mixer.masterVolume, mixer.selectedChannelId, project.bpm]);

  // ── Pattern-Generator-Popup Action-Listener (post-v1.27.0) ────────────────
  // Popup dispatcht `pattern-generator:apply` als CustomEvent in seinem Window.
  // Wir empfangen das hier via IPC und re-dispatchen es im Main-Window, damit
  // der bestehende handleApply-Handler (oben in dieser Datei) ohne Änderung
  // läuft.
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onPatternGenPopupAction?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const action = payload as Record<string, unknown>;
      if (action.type === "popup-mounted") {
        setPatternGenPopupOpen(true);
        return;
      }
      if (action.type !== "apply-pattern") return;
      const pattern = action.pattern as { bpm?: number; parts?: unknown } | undefined;
      if (!pattern || typeof pattern.bpm !== "number" || !Array.isArray(pattern.parts)) return;
      window.dispatchEvent(new CustomEvent("pattern-generator:apply", { detail: pattern }));
    });
    return cleanup;
  }, [electron]);

  // ── Sample-Browser-Popup State-Broadcast (post-v1.27.0) ────────────────────
  useEffect(() => {
    if (!electron.isElectron || !sampleBrowserPopupOpen) return;
    electron.sendSampleBrowserPopupState?.({
      samples: project.samples.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        size: s.size,
      })),
      activeChannelName: activeChannelName ?? null,
    });
  }, [electron, sampleBrowserPopupOpen, project.samples, activeChannelName]);

  // Action-Listener: Sample-Browser-Popup → Main.
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onSampleBrowserPopupAction?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const action = payload as Record<string, unknown>;
      switch (action.type) {
        case "request-state": {
          setSampleBrowserPopupOpen(true);
          // Sofort broadcasten — der useEffect oben würde erst beim nächsten
          // Sample-/Channel-Change feuern.
          const p = projectRef.current;
          const d = dmRef.current;
          const pattern = d.getActivePattern();
          const partId = d.activePartId ?? pattern?.parts[0]?.id;
          const chName = pattern?.parts.find(part => part.id === partId)?.name ?? null;
          electron.sendSampleBrowserPopupState?.({
            samples: p.samples.map((s) => ({
              id: s.id,
              name: s.name,
              category: s.category,
              size: s.size,
            })),
            activeChannelName: chName,
          });
          break;
        }
        case "assign-sample-to-active-channel": {
          if (typeof action.sampleId !== "string") break;
          const p = projectRef.current;
          const sample = p.samples.find((s) => s.id === action.sampleId);
          if (!sample) break;
          // handleAssignToChannel-Logik inline (vermeidet ref-Dependency).
          const d = dmRef.current;
          const pattern = d.getActivePattern();
          if (!pattern) break;
          const partId = d.activePartId ?? pattern.parts[0]?.id;
          if (!partId) break;
          d.setPartSample(partId, sample.path, sample.name);
          break;
        }
      }
    });
    return cleanup;
  }, [electron]);

  // ── Tools-Popups State-Broadcast (post-v1.28.0) ───────────────────────────

  // KeyboardSampler: broadcast samples list
  useEffect(() => {
    if (!electron.isElectron || !keyboardSamplerPopupOpen) return;
    electron.sendKeyboardSamplerPopupState?.({ samples: project.samples });
  }, [electron, keyboardSamplerPopupOpen, project.samples]);

  // ChordProgression: broadcast bpm
  useEffect(() => {
    if (!electron.isElectron || !chordProgressionPopupOpen) return;
    electron.sendChordProgressionPopupState?.({ bpm: project.bpm });
  }, [electron, chordProgressionPopupOpen, project.bpm]);

  // PatternLibrary: broadcast currentPattern + globalBpm
  useEffect(() => {
    if (!electron.isElectron || !patternLibraryPopupOpen) return;
    electron.sendPatternLibraryPopupState?.({
      currentPattern: dm.getActivePattern(),
      globalBpm: project.bpm,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electron, patternLibraryPopupOpen, dm.patterns, dm.activePatternId, project.bpm]);

  // Action listeners
  useEffect(() => {
    if (!electron.isElectron) return;
    const c1 = electron.onKeyboardSamplerPopupAction?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const action = payload as Record<string, unknown>;
      if (action.type === "popup-mounted") {
        setKeyboardSamplerPopupOpen(true);
        electron.sendKeyboardSamplerPopupState?.({ samples: projectRef.current.samples });
      }
    });
    const c2 = electron.onChordProgressionPopupAction?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const action = payload as Record<string, unknown>;
      if (action.type === "popup-mounted") {
        setChordProgressionPopupOpen(true);
        electron.sendChordProgressionPopupState?.({ bpm: projectRef.current.bpm });
      }
    });
    const c3 = electron.onPatternLibraryPopupAction?.((payload) => {
      if (!payload || typeof payload !== "object") return;
      const action = payload as Record<string, unknown>;
      if (action.type === "popup-mounted") {
        setPatternLibraryPopupOpen(true);
        const d = dmRef.current;
        electron.sendPatternLibraryPopupState?.({
          currentPattern: d.getActivePattern(),
          globalBpm: projectRef.current.bpm,
        });
      } else if (action.type === "load-pattern") {
        const pattern = action.pattern as import("@/audio/AudioEngine").PatternData | undefined;
        if (pattern) dmRef.current.addPatternData(pattern);
      }
    });
    return () => { c1?.(); c2?.(); c3?.(); };
  }, [electron]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ElectronDropZone
      onAudioFiles={handleDropAudioFiles}
      onAudioFilesRaw={handleDropAudioFilesRaw}
      onFolder={handleDropFolder}
      onProject={handleDropProject}
      onZipFile={handleDropZipFile}
      onMidiFile={(file) =>
        window.dispatchEvent(new CustomEvent<File>("midi:fileImport", { detail: file }))
      }
      onElectribeFile={(file) =>
        // v3.1.0: .e2spat/.e2sallpat/.elst-Drop → DrumMachine-Listener
        window.dispatchEvent(new CustomEvent<File>("electribe:fileImport", { detail: file }))
      }
      onKorgBankFile={handleKorgBankFile}
    >
      <MidiProvider value={midi}>
      <div className="flex flex-col h-screen bg-bg-base text-text-primary overflow-hidden">

        {/* v3.99.0: Count-In Countdown-Overlay (DAW-Standard). Fixed-Position
            Pill in der Top-Center; visible nur waehrend Pre-Roll. */}
        {countInState !== null && (
          <div
            data-testid="count-in-overlay"
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full bg-accent-primary text-text-primary shadow-2xl text-sm font-medium pointer-events-none"
            role="status"
            aria-live="polite"
          >
            <span aria-hidden>⏱ </span>Count-In: {countInState.remaining}
          </div>
        )}

        {/*
          ElectronTitleBar wurde post-v1.25.0 entfernt — main window nutzt
          jetzt den nativen OS-Frame + Menübar (Datei/Bearbeiten/Ansicht/etc).
          Custom-Titlebar produzierte zwei TitleBars übereinander mit dem
          nativen Frame. ElectronTitleBar.tsx bleibt als Komponente erhalten
          für mögliche zukünftige frameless-Modi.
        */}

        <div className="flex flex-1 overflow-hidden">

          <aside className="flex-shrink-0 border-r border-border-color overflow-hidden flex flex-col relative"
            style={{ width: sidebarWidth }}>
            <AudioInputRecorder onSamplesAdded={project.addSamples} />
            {/* Sample Browser: ausgeblendet wenn er als Popup-Fenster läuft.
                Doppelte UI vermeiden — der Popup ist die "primäre" Ansicht solange
                er offen ist. User kann zurückholen via Button. */}
            {sampleBrowserPopupOpen ? (
              <div className="flex-1 flex items-center justify-center p-4 text-xs text-text-dim text-center border-t border-border-color">
                <div>
                  <p className="mb-2">📌 Sample Browser ist in einem eigenen Fenster geöffnet.</p>
                  <button
                    type="button"
                    onClick={() => electron.closeSampleBrowserWindow?.()}
                    data-testid="sample-browser-reattach"
                    className="px-3 py-1.5 rounded border border-border-color text-text-muted hover:text-accent-primary hover:border-accent-primary transition-colors"
                  >
                    Hierher zurückholen
                  </button>
                </div>
              </div>
            ) : (
              <SampleBrowser
                samples={project.samples}
                onImportSamples={project.importSamplesFromPaths}
                onImportFolder={handleDropFolder}
                onRemoveSample={project.removeSample}
                onSamplesImported={project.addSamples}
                onAssignToChannel={handleAssignToChannel}
                activeChannelName={activeChannelName}
                onUpdateSampleCategory={handleUpdateSampleCategory}
                onReorderSamples={project.reorderSamples}
                onAddTagToSample={project.addTagToSample}
                onRemoveTagFromSample={project.removeTagFromSample}
                onTransformSample={(id, newBlobUrl, newBuffer) => {
                  // v3.116.0: AudioEngine-Cache + Sample-Path-Update.
                  // Alte URL wird invalidiert, neue URL bekommt direkt
                  // den Buffer (kein Re-Decode). Project wird dirty markiert.
                  const sample = project.samples.find((s) => s.id === id);
                  if (sample) AudioEngine.invalidateBufferCache(sample.path);
                  AudioEngine.setBufferCache(newBlobUrl, newBuffer);
                  project.updateSample(id, { path: newBlobUrl });
                }}
                onAutoSliceSample={(slices, baseName) => {
                  // v3.141: Slice-Apply — für jeden Slice ein neues Sample anlegen.
                  // Slice-Buffer in Blob-URL encoden + AudioEngine-Cache befüllen + addSample.
                  const newSamples = slices.map((sliceBuf, i) => {
                    const channels = Math.min(2, sliceBuf.numberOfChannels) as 1 | 2;
                    const wav = encodeWav(
                      Array.from({ length: channels }, (_, c) => sliceBuf.getChannelData(c)),
                      { sampleRate: sliceBuf.sampleRate, channels, bitDepth: 16 },
                    );
                    const blob = new Blob([wav], { type: "audio/wav" });
                    const url = URL.createObjectURL(blob);
                    AudioEngine.setBufferCache(url, sliceBuf);
                    const idx = String(i + 1).padStart(2, "0");
                    return {
                      id: `slice-${Date.now()}-${i}`,
                      name: `${baseName} – Slice ${idx}`,
                      path: url,
                      category: "loops",
                      tags: ["auto-slice"],
                    } as Sample;
                  });
                  project.addSamples(newSamples);
                }}
              />
            )}
            {/* Resize Handle */}
            <div
              onMouseDown={handleSidebarDragStart}
              className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-accent-primary/30 transition-colors z-10"
              title="Sidebar-Breite anpassen"
            />
          </aside>

          <main className="flex-1 flex flex-col overflow-hidden" role="main">

            <div className="flex items-center gap-4 px-6 py-3 bg-bg-panel border-b border-border-color">
              {/* Visual Metronome – blinkt auf jedem Beat */}
              <VisualMetronome isPlaying={project.isPlaying} bpm={project.bpm} />

              <h1 className="text-sm font-bold text-accent-secondary tracking-widest uppercase">
                Synthstudio
              </h1>

              <div className="flex-1" />

              <span className="text-xs text-text-dim">
                {project.projectName}
                {project.isDirty && (
                  <span className="ml-1 text-accent-warning" title="Ungespeicherte Änderungen">
                    ●
                  </span>
                )}
              </span>

              {/* v3.166.0: Track-Overview-Status-Widget. Tooltip zeigt Detail-Stats. */}
              <div
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-dim hover:text-text-muted hover:bg-bg-elevated transition-colors cursor-help"
                title={`Pattern-Bank: ${trackOverviewInfo.patternCount} | Channels: ${trackOverviewInfo.channelCount} (${trackOverviewInfo.mutedChannelCount} muted, ${trackOverviewInfo.soloedChannelCount} solo) | ⌀ Density: ${Math.round(trackOverviewInfo.averageDensity * 100)}% | Active Steps: ${trackOverviewInfo.totalActiveSteps}/${trackOverviewInfo.totalPossibleSteps}`}
                data-testid="track-overview-widget"
              >
                <span data-testid="track-overview-summary">{formatTrackOverviewSummary(trackOverviewInfo)}</span>
              </div>

              {/* v3.57.0: AutoSave-Status — Klick öffnet Versions-History.
                  v3.61.0: projectId-Prop für per-project lastSaveAt-Lookup. */}
              <AutoSaveStatusIndicator
                onOpenHistory={() => setShowVersionHistory(true)}
                projectId={project.projectId || projectNameToId(project.projectName)}
              />

              <div className="flex items-center gap-2">
                <button
                  onClick={project.togglePlayStop}
                  title={project.isPlaying ? "Stop (Space)" : "Play (Space)"}
                  aria-label={project.isPlaying ? "Stop" : "Play"}
                  aria-pressed={project.isPlaying}
                  className={`w-8 h-8 rounded flex items-center justify-center text-sm transition-colors duration-100 ${project.isPlaying ? "bg-accent-primary text-white hover:bg-opacity-80" : "bg-bg-elevated text-text-muted hover:bg-border-color hover:text-text-primary"}`}
                >
                  <span aria-hidden="true">{project.isPlaying ? "■" : "▶"}</span>
                </button>

                <button
                  onClick={project.toggleRecord}
                  title={project.isRecording ? "Aufnahme stoppen (R)" : "Aufnahme starten (R)"}
                  aria-label={project.isRecording ? "Aufnahme stoppen" : "Aufnahme starten"}
                  aria-pressed={project.isRecording}
                  className={`w-8 h-8 rounded flex items-center justify-center text-sm transition-colors duration-100 ${project.isRecording ? "bg-accent-danger text-white hover:bg-opacity-80" : "bg-bg-elevated text-text-muted hover:bg-border-color hover:text-text-primary"}`}
                >
                  <span aria-hidden="true">●</span>
                </button>

                <RecordSettingsPopover
                  recordingMode={project.recordingMode}
                  onRecordingModeChange={project.setRecordingMode}
                  punchInStep={project.punchInStep}
                  punchOutStep={project.punchOutStep}
                  onPunchInChange={project.setPunchInStep}
                  onPunchOutChange={project.setPunchOutStep}
                  onClearPunchRange={project.clearPunchRange}
                  maxStep={(dm.getActivePattern()?.stepCount ?? 16) - 1}
                />
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={project.undo}
                  disabled={!project.canUndo}
                  title="Rückgängig (Ctrl+Z)"
                  className="w-7 h-7 rounded text-xs bg-bg-elevated text-text-dim hover:bg-border-color hover:text-text-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
                >
                  ↩
                </button>
                <button
                  onClick={project.redo}
                  disabled={!project.canRedo}
                  title="Wiederholen (Ctrl+Y)"
                  className="w-7 h-7 rounded text-xs bg-bg-elevated text-text-dim hover:bg-border-color hover:text-text-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
                >
                  ↪
                </button>
              </div>

              {/* Schnell-Buttons für häufige Settings */}
              <button
                onClick={() => { setSettingsInitialSection("midi-cc"); setShowSettings(true); }}
                title="MIDI-Einstellungen (Ctrl+M)"
                className={`w-8 h-8 rounded flex items-center justify-center text-xs transition-colors duration-100 ${midi.isEnabled ? "bg-accent-secondary/20 text-accent-secondary hover:bg-accent-secondary/30" : "bg-bg-elevated text-text-dim hover:bg-border-color hover:text-text-muted"}`}
              >
                🎹
              </button>

              <button
                onClick={() => { setSettingsInitialSection("keyboard"); setShowSettings(true); }}
                title="Tastatur-Shortcuts"
                className="w-8 h-8 rounded flex items-center justify-center text-xs bg-bg-elevated text-text-dim hover:bg-border-color hover:text-text-muted transition-colors duration-100"
              >
                ⌨
              </button>

              {/* Haupteinstellungen ⚙ */}
              <button
                onClick={() => { setSettingsInitialSection("design"); setShowSettings(true); }}
                title="Einstellungen (alle Settings)"
                className="w-8 h-8 rounded flex items-center justify-center text-xs bg-bg-elevated text-text-dim hover:bg-accent-primary/20 hover:text-accent-primary transition-colors duration-100"
              >
                ⚙
              </button>

              <PerformanceMonitor
                mode="compact"
                onOpenDetails={() => { setSettingsInitialSection("performance"); setShowSettings(true); }}
              />

              {electron.isElectron && <UpdateBadge />}

              {/* Collab Chat – nur wenn in einer Session */}
              {inSession && (
                <CollabChat
                  broadcast={collab.broadcast}
                  ownName="Ich"
                  inSession={inSession}
                />
              )}

              <ProjectManager
                projectName={project.projectName}
                isDirty={project.isDirty}
                onSave={doSaveProject}
                onLoad={handleMenuOpen}
                onNew={handleNewProject}
                onExport={project.exportProject}
                onImportPatterns={(patterns, sourceFormat, melodicParts) => {
                  // Batch-Insert (ein State-Update statt N) — wichtig bei FLP-Imports
                  // mit hunderten Patterns; setzt aktives Pattern auf das erste und
                  // BEWAHRT die Part-IDs, damit das Melodic-Routing unten passt.
                  const newPatternIds = dm.addPatternsData(patterns as Parameters<typeof dm.addPatternsData>[0]);
                  if (patterns.length > 0 && patterns[0].bpm) {
                    project.setBpm(patterns[0].bpm);
                  }
                  // Aktives Pattern auf das INHALTSREICHSTE setzen statt auf das
                  // evtl. dünne erste (z.B. FLP-Arrangement-Pattern) — sonst landet
                  // der User nach dem Import auf einem fast leeren Grid.
                  if (newPatternIds.length > 1) {
                    let bestIdx = 0, bestActive = -1;
                    patterns.forEach((p, i) => {
                      const active = p.parts.reduce((a, pt) => a + pt.steps.filter(s => s.active).length, 0);
                      if (active > bestActive) { bestActive = active; bestIdx = i; }
                    });
                    if (newPatternIds[bestIdx]) dm.setActivePattern(newPatternIds[bestIdx]);
                  }
                  // FLP-SAMPLES (Stage 3, Electron-only): Sample-Referenzen gegen
                  // einen vom User gewählten Ordner auflösen + auf die importierten
                  // Parts legen. Fire-and-forget (interaktiver Ordner-Dialog).
                  if (sourceFormat === "flp" && electron.isElectron) {
                    void loadFlpSamplesFromFolder(patterns, newPatternIds);
                  }
                  // FLP-MELODIC-ROUTE Phase 2 (v1.66): melodische Channels in den
                  // useMelodicPartStore einspeisen. v1.69: zusätzlich baseNote
                  // pro Part setzen, damit Piano Roll auf importierten Bereich zentriert.
                  const { mappings, baseNotes, warnings } = routeMelodicPartsToPatterns(
                    melodicParts,
                    patterns,
                  );
                  for (const b of baseNotes) {
                    setMelodicBaseNote(b.partId, b.baseNote);
                  }
                  for (const m of mappings) {
                    setMelodicNote(m.partId, m.stepIdx, m.pitch);
                    setMelodicVelocity(m.partId, m.stepIdx, m.velocity);
                  }
                  console.log(`[Import] ${patterns.length} Patterns aus ${sourceFormat.toUpperCase()} hinzugefügt`);
                  if (mappings.length > 0) {
                    console.log(`[Import] ${mappings.length} melodische Notes in MelodicParts geroutet (${baseNotes.length} baseNotes gesetzt)`);
                  }
                  if (warnings.length > 0) {
                    console.warn(`[Import] Melodic-Routing-Warnungen:\n• ${warnings.join("\n• ")}`);
                  }
                }}
              />
            </div>

            <div className="flex gap-0 border-b border-border-color bg-bg-panel items-center" role="tablist" aria-label="Hauptnavigation">
              {([
                { id: "sequencer",    label: "Sequencer" },
                { id: "mixer",        label: "Mixer" },
                { id: "song",         label: "Song-Modus" },
                { id: "humanizer",    label: "Humanizer" },
                { id: "tools",        label: "Tools" },
                { id: "kollaboration",label: "Kollaboration" },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  id={`tab-${tab.id}`}
                  onClick={() => handleSetActiveTab(tab.id)}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`panel-${tab.id}`}
                  className={`px-5 py-2 text-xs font-medium border-b-2 transition-colors duration-100 ${activeTab === tab.id ? "border-accent-primary text-accent-primary bg-bg-elevated" : "border-transparent text-text-dim hover:text-text-muted hover:bg-bg-elevated/50"}`}
                >
                  {tab.label}
                  {tab.id === "song" && song.songModeActive && (
                    <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-accent-primary inline-block" />
                  )}
                  {tab.id === "humanizer" && humanizer.global.enabled && (
                    <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-accent-success inline-block" />
                  )}
                </button>
              ))}
              {/* v2.46: Floating-Inspector-Toggle */}
              <button
                onClick={toggleInspectorFloat}
                aria-pressed={inspectorFloat.open}
                title={inspectorFloat.open ? "Floating Inspector schließen" : "Floating Inspector öffnen (zusätzlich zum Dock-Slot)"}
                data-testid="inspector-float-toggle"
                className={[
                  "ml-auto px-3 py-1.5 rounded text-xs font-bold border",
                  inspectorFloat.open
                    ? "bg-accent-secondary/30 border-accent-secondary text-accent-secondary"
                    : "bg-bg-panel border-border-color text-text-dim hover:text-accent-secondary hover:border-accent-secondary",
                ].join(" ")}
              >
                🎚️ Inspector
              </button>
              {/* Performance Mode (Vollbild-Launchpad, F12) */}
              <button
                onClick={() => setPerformanceActive(true)}
                title="Performance Mode (F12) – Vollbild-Pattern-Launchpad"
                className="ml-2 mr-3 px-3 py-1.5 rounded text-xs font-bold bg-accent-primary/20 border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/30"
              >
                ⚡ Performance Mode
              </button>
            </div>

            <div
              className="flex-1 overflow-hidden"
              role="tabpanel"
              id={`panel-${activeTab}`}
              aria-labelledby={`tab-${activeTab}`}
              tabIndex={0}
            >

              {activeTab === "sequencer" && (
                <DrumMachine
                  dm={dm}
                  samples={project.samples}
                  isPlaying={project.isPlaying}
                  bpm={project.bpm}
                  onPlayStop={collabPlayStop}
                  onBpmChange={collabBpmChange}
                  externalSyncEnabled={midi.clockInEnabled}
                  externalSyncStatus={midi.clockInStatus}
                  className="h-full"
                />
              )}

              {activeTab === "mixer" && (
                workspaceMode ? (
                  /* MIG-2C Workspace: 5 Panels (Sequencer/Mixer/Inspector +
                     Song/Humanizer via render-functions). Tools/Collab werden
                     in zukünftiger Welle migriert.
                     WorkspaceProvider liefert Stores + Render-Closures. */
                  <WorkspaceProvider
                    value={{
                      dm,
                      mixer,
                      project,
                      onPlayStop: collabPlayStop,
                      onBpmChange: collabBpmChange,
                      renderSongPanel: () => (
                        <div className="h-full flex flex-col overflow-hidden">
                          <SongTabView
                            song={song}
                            automation={automation}
                            dm={dm}
                            project={project}
                            isPlaying={project.isPlaying}
                          />
                        </div>
                      ),
                      renderHumanizerPanel: () => (
                        <div className="h-full overflow-y-auto p-4">
                          <Humanizer humanizer={humanizer} className="max-w-lg" />
                        </div>
                      ),
                    }}
                  >
                    <WorkspaceShell
                      panels={[
                        { id: "sequencer", title: "Sequencer", component: SequencerPanel },
                        { id: "mixer", title: "Mixer", component: MixerPanel },
                        { id: "inspector", title: "Inspector", component: InspectorPanel },
                        { id: "song", title: "Song", component: WsSongPanel },
                        { id: "humanizer", title: "Humanizer", component: WsHumanizerPanel },
                      ]}
                    />
                  </WorkspaceProvider>
                ) : (
                  <div className="h-full flex overflow-hidden">
                    <div className="flex-1 flex overflow-hidden">
                      {mixerPopupOpen ? (
                        <div className="flex-1 flex items-center justify-center text-text-dim text-sm">
                          <div className="text-center">
                            <p className="mb-3">📌 Mixer ist in einem eigenen Fenster geöffnet.</p>
                            <button
                              type="button"
                              onClick={() => electron.closeMixerWindow?.()}
                              data-testid="mixer-reattach"
                              className="px-3 py-1.5 rounded border border-border-color text-text-muted hover:text-accent-primary hover:border-accent-primary transition-colors text-xs"
                            >
                              Hierher zurückholen
                            </button>
                          </div>
                        </div>
                      ) : (
                        <MixerView
                          dm={dm}
                          mixer={mixer}
                          samples={project.samples}
                          bpm={project.bpm}
                          projectName={project.projectName}
                          className="flex-1"
                        />
                      )}
                    </div>

                    <ChannelInspector
                      part={dm.getActivePattern()?.parts.find(p => p.id === mixer.selectedChannelId) ?? dm.getActivePattern()?.parts[0]}
                      parts={dm.getActivePattern()?.parts ?? []}
                      mixer={mixer}
                      onApplyPatch={dm.applyPatchToPart}
                      pattern={dm.getActivePattern()}
                      bpm={project.bpm}
                      projectName={project.projectName}
                    />
                  </div>
                )
              )}

              {activeTab === "song" && (
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Song-Tab Sub-Tabs */}
                  <SongTabView
                    song={song}
                    automation={automation}
                    dm={dm}
                    project={project}
                    isPlaying={project.isPlaying}
                  />
                </div>
              )}

              {activeTab === "humanizer" && (
                <div className="h-full overflow-y-auto p-4">
                  <Humanizer
                    humanizer={humanizer}
                    className="max-w-lg"
                  />
                </div>
              )}

              {activeTab === "tools" && (
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="flex gap-0 border-b border-border-color bg-bg-panel flex-shrink-0">
                    {([
                      { id: "prompt",      label: "KI-Generator" },
                      { id: "algorithmic", label: "Algorithmisch" },
                      { id: "chords",      label: "🎼 Akkorde" },
                      { id: "sampler",     label: "🎹 Sampler" },
                      { id: "workbench",   label: "🎚 Workbench" },
                      { id: "library",     label: "📚 Library" },
                      { id: "packs",       label: "📦 Packs" },
                      { id: "song",        label: "🎼 Song" },
                      { id: "macroSnapshot", label: "🎚 Snapshots" },
                      { id: "liverec",     label: "🎙 Live-Rec" },
                      { id: "audioinput",  label: "🎤 Audio-In" },
                      { id: "script",      label: "⚡ Script" },
                      { id: "diff",        label: "📊 Diff" },
                      { id: "omnitribe",   label: "🎛 OmniTribe" },
                    ] as const).map(t => (
                      <button key={t.id} onClick={() => setActiveTool(t.id)}
                        className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activeTool === t.id ? "border-accent-primary text-accent-primary bg-bg-elevated" : "border-transparent text-text-dim hover:text-text-muted"}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 overflow-hidden">
                    {activeTool === 'prompt' && (
                      <div className="h-full overflow-y-auto p-4">
                        {patternGenPopupOpen ? (
                          <div className="h-full flex items-center justify-center text-text-dim text-sm">
                            <div className="text-center">
                              <p className="mb-3">📌 Pattern Generator ist in einem eigenen Fenster geöffnet.</p>
                              <button
                                type="button"
                                onClick={() => electron.closePatternGenWindow?.()}
                                data-testid="pattern-gen-reattach"
                                className="px-3 py-1.5 rounded border border-border-color text-text-muted hover:text-accent-primary hover:border-accent-primary transition-colors text-xs"
                              >
                                Hierher zurückholen
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 max-w-4xl">
                            <PatternGeneratorPanel />
                            <ArpeggiatorPanel />
                          </div>
                        )}
                      </div>
                    )}
                    {activeTool === 'algorithmic' && (
                      <div className="h-full overflow-y-auto p-4">
                        <GeneratorView />
                      </div>
                    )}
                    {activeTool === 'chords' && (
                      <div className="h-full overflow-y-auto p-4 max-w-2xl">
                        {chordProgressionPopupOpen ? (
                          <ToolPopupReattachStub
                            label="Chord Progressions"
                            onReattach={() => electron.closeChordProgressionWindow?.()}
                            testId="chord-progression-reattach"
                          />
                        ) : (
                          <>
                            {electron.isElectron && (
                              <ToolPinButton onPin={() => electron.openChordProgressionWindow?.()} testId="chord-progression-pin" />
                            )}
                            <ChordProgressionPanel bpm={project.bpm} />
                          </>
                        )}
                      </div>
                    )}
                    {activeTool === 'sampler' && (
                      <div className="h-full overflow-y-auto p-4 max-w-2xl">
                        {keyboardSamplerPopupOpen ? (
                          <ToolPopupReattachStub
                            label="Keyboard Sampler"
                            onReattach={() => electron.closeKeyboardSamplerWindow?.()}
                            testId="keyboard-sampler-reattach"
                          />
                        ) : (
                          <>
                            {electron.isElectron && (
                              <ToolPinButton onPin={() => electron.openKeyboardSamplerWindow?.()} testId="keyboard-sampler-pin" />
                            )}
                            <KeyboardSamplerPanel samples={project.samples} />
                          </>
                        )}
                      </div>
                    )}
                    {activeTool === 'workbench' && (
                      <div className="h-full overflow-y-auto">
                        <AudioWorkbench onSamplesAdded={(s) => project.addSamples(s)} />
                      </div>
                    )}
                    {activeTool === 'library' && (
                      patternLibraryPopupOpen ? (
                        <ToolPopupReattachStub
                          label="Pattern Library"
                          onReattach={() => electron.closePatternLibraryWindow?.()}
                          testId="pattern-library-reattach"
                        />
                      ) : (
                        <>
                          {electron.isElectron && (
                            <div className="px-4 pt-3">
                              <ToolPinButton onPin={() => electron.openPatternLibraryWindow?.()} testId="pattern-library-pin" />
                            </div>
                          )}
                          <PatternLibrary
                            currentPattern={dm.getActivePattern()}
                            globalBpm={project.bpm}
                            onLoadPattern={(pattern) => dm.addPatternData(pattern)}
                          />
                        </>
                      )
                    )}
                    {activeTool === 'script' && (
                      <div className="h-full overflow-y-auto p-4 max-w-5xl">
                        <ScriptRunner
                          bpm={project.bpm}
                          isPlaying={project.isPlaying}
                          onBpmChange={project.setBpm}
                          onPlayStop={project.togglePlayStop}
                          dm={dm}
                        />
                      </div>
                    )}
                    {activeTool === 'omnitribe' && (
                      <div className="h-full overflow-y-auto p-4 space-y-4 max-w-5xl">
                        {/* v3.19: Firefox/Safari-Hinweis prominent oben (render-noop wenn Web-MIDI vorhanden). */}
                        <OmniTribeBrowserSupport />

                        {/* v3.19: Connection-UI im Tab — User kann direkt aus dem Tab connecten,
                            statt erst in Settings → Hardware navigieren zu müssen. */}
                        <DeviceConnectionPanel />

                        {/* Sprint-101: OTA-Update-Check direkt im Tab */}
                        <OtaUpdatePanel />

                        <div className="bg-bg-panel border border-border-color rounded p-3">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-text-primary">
                              OmniTribe Live-View
                            </h3>
                            <span
                              className={[
                                "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded",
                                omniTribeConnected
                                  ? "bg-accent-success/15 text-accent-success"
                                  : "bg-bg-elevated text-text-dim",
                              ].join(" ")}
                              data-testid="omnitribe-connection-status"
                            >
                              {omniTribeConnected ? "Connected" : "Disconnected"}
                            </span>
                          </div>
                          <p className="text-xs text-text-dim mt-1">
                            Live-Streams (VU + Spectrum) + Chord-Panel + Performance-Pad-Grid.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <OmniTribeVuMeter connected={omniTribeConnected} />
                          <OmniTribeSpectrumAnalyzer connected={omniTribeConnected} />
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                          <ChordPanel connected={omniTribeConnected} />
                          <PerformancePadGrid connected={omniTribeConnected} />
                        </div>
                        {/* Sprint-103: Step-Sequencer */}
                        <StepSequencerPanel connected={omniTribeConnected} />
                        {/* Sprint-106: Audio-FX-Panel */}
                        <AudioFxPanel />

                        {/* Sprint-119c: OmniTribe Sync — Clock + Position + Firmware */}
                        <div className="bg-bg-panel border border-border-color rounded p-3">
                          <h3 className="text-sm font-semibold text-text-primary mb-3">
                            OmniTribe Sync
                          </h3>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <ClockSyncPanel connected={omniTribeConnected} />
                            <PositionDisplay connected={omniTribeConnected} />
                          </div>
                          <div className="mt-4">
                            <FirmwareInfoViewer connected={omniTribeConnected} />
                          </div>
                        </div>
                      </div>
                    )}
                    {activeTool === 'packs' && (
                      <SamplePackBrowser className="h-full" />
                    )}
                    {activeTool === 'song' && (
                      <SongModePanel
                        patterns={dm.patterns}
                        activePatternId={dm.activePatternId}
                        className="h-full"
                      />
                    )}
                    {activeTool === 'macroSnapshot' && (
                      <MacroSnapshotPanel className="h-full" />
                    )}
                    {activeTool === 'liverec' && (
                      <LiveRecorderPanel
                        channels={(dm.patterns.find(p => p.id === dm.activePatternId)?.parts ?? []).map(p => ({
                          id: p.id,
                          name: p.name,
                          color: p.color,
                        }))}
                        className="h-full"
                      />
                    )}
                    {activeTool === 'audioinput' && (
                      <AudioInputRecorderPanel className="h-full" />
                    )}
                    {activeTool === 'diff' && (
                      <ProjectDiffPanel />
                    )}
                  </div>
                </div>
              )}

              {activeTab === "kollaboration" && (
                <div className="h-full overflow-y-auto p-4 space-y-6 max-w-2xl">
                  <RelayPanel />
                  <SessionPanel />
                  <SessionRecorder
                    broadcast={event => collab.broadcast(event as Parameters<typeof collab.broadcast>[0])}
                    inSession={inSession}
                  />
                  <VersionSnapshotPanel
                    onRestore={(json) => {
                      try {
                        const patterns = JSON.parse(json);
                        if (Array.isArray(patterns)) patterns.forEach(p => dm.addPatternData(p));
                      } catch { /* ignore */ }
                    }}
                  />
                </div>
              )}

            </div>
          </main>
        </div>
      </div>
      
      {/* ── Unified Settings Panel ──────────────────────────────────────── */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        midi={midi}
        parts={dm.getActivePattern()?.parts ?? []}
        initialSection={settingsInitialSection}
        onOpenAdvancedMidi={() => { setShowSettings(false); setShowMidiSettings(true); }}
        onOpenVersionHistory={() => { setShowSettings(false); setShowVersionHistory(true); }}
      />

      {/* v3.57.0: AutoSave Versions-History-Modal. */}
      <VersionHistoryModal
        isOpen={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        projectId={project.projectId || projectNameToId(project.projectName)}
        onRestore={(json) => {
          try {
            const data = parseProject(JSON.parse(json));
            restoreProject(data);
            toast(`Version wiederhergestellt: ${data.projectName}`, { kind: "success" });
          } catch (err) {
            console.error("[VersionRestore]", err);
            toast("Wiederherstellung fehlgeschlagen", { kind: "error", duration: 5000 });
          }
        }}
      />

      {/* v3.59.0: Legacy-Slug Migration Modal (closes v3.58 caveat). */}
      <LegacyMigrationModal
        isOpen={legacyMigration.isOpen}
        legacySlug={legacyMigration.legacySlug}
        newProjectId={legacyMigration.newProjectId}
        legacyCount={legacyMigration.legacyCount}
        onClose={() =>
          setLegacyMigration((s) => ({ ...s, isOpen: false }))
        }
        onComplete={(action) => {
          // Egal welche Aktion gewählt wurde — die projectId ist gecheckt.
          if (legacyMigration.newProjectId) {
            markMigrationChecked(legacyMigration.newProjectId);
          }
          if (action === "later") {
            // "Später" markiert trotzdem als gecheckt, damit der Prompt
            // nicht bei jedem Reload erneut erscheint. User kann manuell
            // über Settings → "Alle Versionen löschen" aufräumen.
          }
        }}
      />

      {/* ── Legacy Dialoge (Keyboard-Shortcuts für rückwärtskompatiblen Zugriff) */}
      {showMidiSettings && (
        <MidiSettings
          midi={midi}
          parts={dm.getActivePattern()?.parts.map(p => ({ id: p.id, name: p.name })) ?? []}
          onClose={() => setShowMidiSettings(false)}
        />
      )}

      {showShortcutsHelp && (
        <ShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      )}

      {/* v2.22: Performance-Recorder-Badge — fixed bottom-right overlay,
          immer sichtbar damit User v2.15 Recording-Feature überhaupt finden. */}
      <PerformanceRecorderBadge />

      {/* v2.46: ChannelInspector als freischwebendes Panel. Nutzt den
          gleichen Component wie im Dock-Slot — keine Code-Duplikation. */}
      {inspectorFloat.open && (
        <FloatingPanel
          storageKey="ss-floating:inspector"
          title="🎚️ Channel Inspector"
          defaultPosition={{ x: 160, y: 120, w: 360, h: 540 }}
          minWidth={300}
          minHeight={320}
          onClose={closeInspectorFloat}
          testId="floating-inspector"
        >
          <ChannelInspector
            part={dm.getActivePattern()?.parts.find(p => p.id === mixer.selectedChannelId) ?? dm.getActivePattern()?.parts[0]}
            parts={dm.getActivePattern()?.parts ?? []}
            mixer={mixer}
            onApplyPatch={dm.applyPatchToPart}
            pattern={dm.getActivePattern()}
            bpm={project.bpm}
            projectName={project.projectName}
            className="w-full h-full"
          />
        </FloatingPanel>
      )}

      <ThemeSettings
        isOpen={showThemeSettings}
        onClose={() => setShowThemeSettings(false)}
      />

      {inSession && (
        <CollabSplitView
          localDm={collabDm}
          samples={project.samples}
          bpm={project.bpm}
          isPlaying={project.isPlaying}
          onPlayStop={collabPlayStop}
          onBpmChange={collabBpmChange}
          outputMode={outputMode}
          onOutputModeChange={setOutputMode}
          remoteToggleStep={remoteToggleStep}
          remoteSetActivePattern={remoteSetActivePattern}
          onLeave={() => collab.leaveSession()}
          onImportSamples={project.importSamplesFromPaths}
          onImportFolder={handleDropFolder}
          onRemoveSample={project.removeSample}
          onSamplesImported={project.addSamples}
          onAssignToChannel={handleAssignToChannel}
          activeChannelName={activeChannelName}
          onUpdateSampleCategory={handleUpdateSampleCategory}
          onReorderSamples={project.reorderSamples}
        />
      )}

      <NewProjectDialog
        isOpen={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
        onCreateProject={(templateState) => {
          // BUG-013 Fix: vollständiger Reset über ALLE Project-Stores statt
          // nur DrumMachine. Vorher blieben Performance-Pads, Macros, Audio-
          // Tracks, Mixer-Settings etc. aus der vorherigen Session bestehen.
          doFullProjectReset();
          // Project-Store mit Template-Daten überschreiben (BPM, Name, Samples)
          project.newProjectFromTemplate(templateState);
        }}
      />

      {/* v3.49.0 — KORG Quick-Start Templates (E2 Studio / ESX Live / nanoKONTROL2 Mix) */}
      {/* v3.50.0: Vollständig gewireter Apply-Handler.
          - Confirmation-Dialog wenn destructive (existing Pad-Bank / Scenes / extra Parts)
          - reseedParts: schreibt N Drum-Parts + M Synth-Parts in das aktive Pattern
          - enableClockOut / enableLedFeedback aktivieren useMidi mit Auto-Resolved outputId
          - midiAccess: midi.outputDevices → resolveMidiOutputIdByHint
          - onMissingDevice → Info-Toast */}
      <KorgTemplatePicker
        isOpen={showKorgTemplatePicker}
        onClose={() => setShowKorgTemplatePicker(false)}
        onSelect={async (id) => {
          // v3.50: destructive guard
          const activePattern = dm.getActivePattern();
          const existingPartCount = activePattern?.parts.length ?? 0;
          const isDestructive = isKorgTemplateApplyDestructive({
            existingPartCount,
            defaultPartCount: 9,
          });
          if (isDestructive) {
            const ok = await confirm({
              title: "Template überschreibt deine aktuellen Pads + Scenes + Parts. Fortfahren?",
              confirmLabel: "Fortfahren",
              destructive: true,
            });
            if (!ok) {
              setShowKorgTemplatePicker(false);
              return;
            }
            // v3.65.0: Pre-Action AutoBackup vor Template-Apply.
            // Non-blocking — wir warten NICHT, weil die Apply-Sequenz
            // synchron mehrere Store-Updates triggert. Best-effort.
            void doAutoBackupBeforeAction(`Apply Template: ${id}`);
          }

          const result = applyKorgProjectTemplate(id, {
            setBpm: (bpm) => project.setBpm(bpm),
            setStepCount: (steps) => dm.setStepCount(steps),
            reseedParts: (drumCount, synthCount) => {
              // v3.50.0: existing Parts auf 1 reduzieren (removePart schützt
              // gegen <=1 — daher iterieren wir bis pattern.parts.length === 1)
              // und dann das eine erste Part umbenennen, anschließend N-1+M
              // weitere Parts hinzufügen.
              const pat = dm.getActivePattern();
              if (!pat) return [];
              // Snapshot current part IDs and drop all but the first.
              const snapshotIds = pat.parts.map((p) => p.id);
              for (let i = snapshotIds.length - 1; i >= 1; i--) {
                dm.removePart(snapshotIds[i]);
              }
              // Rename first part to "Kick" (drum-1)
              const firstAfter = dm.getActivePattern()?.parts[0];
              if (firstAfter && drumCount >= 1) {
                dm.renamePart(firstAfter.id, "Kick");
              }
              // Add remaining drum parts
              const drumNames = [
                "Snare", "Hi-Hat cl.", "Hi-Hat op.", "Clap",
                "Tom Hi", "Tom Lo", "Perc", "FX", "Drum 10",
              ];
              for (let i = 1; i < drumCount; i++) {
                dm.addPart(drumNames[i - 1] ?? `Drum ${i + 1}`);
              }
              // Add synth parts
              for (let i = 0; i < synthCount; i++) {
                dm.addPart(`Synth ${i + 1}`);
              }
              // Re-read part-IDs from the active pattern
              const refreshed = dm.getActivePattern();
              return refreshed?.parts.map((p) => p.id) ?? [];
            },
            enableClockOut: (_hint, resolvedOutputId) => {
              midi.setClockOutEnabled(true);
              if (resolvedOutputId) {
                midi.setClockOutputDeviceId(resolvedOutputId);
              }
            },
            enableLedFeedback: (_hint, resolvedOutputId) => {
              midi.setFeedbackEnabled(true);
              if (resolvedOutputId) {
                midi.setFeedbackOutputDeviceId(resolvedOutputId);
              }
            },
            midiAccess: midi.outputDevices,
            onMissingDevice: (hint, section) => {
              showToast(
                `Output für '${hint}' nicht gefunden — wähle ${section} manuell.`,
                { kind: "info" },
              );
            },
            postApplyNotice: (msg) => showToast(msg, { kind: "success" }),
          });
          showToast(result.hints[0] ?? "Template applied", { kind: "info" });
          if (result.resolvedOutputId) {
            showToast(
              `MIDI-Device auto-gewählt (ID: ${result.resolvedOutputId.slice(0, 8)}…)`,
              { kind: "info" },
            );
          }
        }}
      />

      {/* ── Browser-Warning: Audio-Tracks beim Save (einmalig, dismissable) ── */}
      {showAudioTrackBrowserWarning && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="audiotrack-warning-title"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded border border-accent-secondary/50 bg-bg-panel shadow-xl"
        >
          <div className="p-3">
            <div
              id="audiotrack-warning-title"
              className="text-xs font-semibold text-accent-secondary uppercase tracking-wide mb-1"
            >
              Audio-Tracks
            </div>
            <div className="text-[11px] text-text-muted leading-snug mb-2">
              Audio-Tracks werden als Datei-Referenzen gespeichert. Beim erneuten
              Öffnen musst du die Datei neu wählen.
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAudioTrackBrowserWarning(false)}
                className="px-2 py-0.5 text-[10px] rounded bg-bg-elevated text-text-dim hover:text-text-primary border border-border-color"
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem(
                      "synthstudio:audiotrack-browser-warning-dismissed",
                      "true",
                    );
                  } catch { /* ignore */ }
                  setShowAudioTrackBrowserWarning(false);
                }}
                className="px-2 py-0.5 text-[10px] rounded bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/50 hover:bg-accent-secondary/30"
              >
                OK, nicht mehr zeigen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Performance Mode (Vollbild-Pattern-Launchpad) ───────────────── */}
      {performanceActive && (
        <PatternLaunchPad
          pads={performance.pads}
          patterns={dm.patterns.map((p) => ({ id: p.id, name: p.name }))}
          activePatternId={dm.activePatternId ?? ""}
          queuedPatternId={performance.queuedPatternId}
          quantizeMode={performance.quantizeMode}
          bpm={project.bpm}
          currentStep={dm.currentStep}
          onPadClick={(patternId) => {
            dm.setActivePattern(patternId);
            queuePerformancePattern(patternId);
          }}
          onQuantizeModeChange={setPerformanceQuantizeMode}
          onClose={() => setPerformanceActive(false)}
          onOpenInWindow={electron.isElectron ? handleOpenPerformanceWindow : undefined}
        />
      )}
      {/* v2.5: Toast-Notifications (oben rechts) */}
      <ToastContainer />
      {/* TASK-232 (v2.97): Lizenz-Aktivierungs-Modal (zeigt sich auto bei status=unknown) */}
      <ActivationModal />
      {/* v3.22.0: First-Run Welcome-Wizard (6 Slides). Auto-Show on first launch. */}
      <WelcomeWizard
        open={showWelcomeWizard}
        onClose={() => setShowWelcomeWizard(false)}
      />
      {/* v3.3.0: KORG Sample-Bank-Modal (ESX-1 .esx + E2S .all Read-Only). */}
      <KorgBankModal
        file={korgBankFile}
        onClose={() => setKorgBankFile(null)}
        onAddSample={handleKorgBankAddSample}
        onAddPattern={(p) => {
          // v3.5: SynthstudioPatternImport → PatternData. addPatternData füllt id auto.
          dm.addPatternData({
            id: "",
            name: p.name,
            stepCount: p.stepCount,
            stepResolution: "1/16",
            bpm: p.bpm,
            parts: p.drumParts.map((dp) => ({
              id: "",
              name: dp.sampleHint,
              sampleName: dp.sampleHint,
              muted: false,
              soloed: false,
              volume: dp.volume,
              pan: dp.pan,
              steps: dp.steps.map((active, i) => ({
                active,
                velocity: dp.velocities[i] ?? 100,
                pitch: dp.pitchSemitones,
              })),
              fx: { ...DEFAULT_CHANNEL_FX },
            })),
            followAction: { type: "none", barsBeforeSwitch: 1 },
          });
        }}
        onAddSong={(s) => {
          // v3.89.0: SynthstudioSongArrangement → useSongStore.createArrangement.
          // slots[] enthaelt {bank: 'A'..'D', repeats: 1..16}.
          song.createArrangement(s.slots.map((slot) => ({ bank: slot.bank, repeats: slot.repeats })));
        }}
      />
      {/* v3.4.0: KORG E2 Sample-Bank-Editor (Synthstudio → .all). */}
      {/* v3.7.0: externalOpenFile route drag-dropped .all hier hin wenn offen. */}
      <KorgBankEditor
        open={korgBankExportOpen}
        onClose={() => {
          setKorgBankExportOpen(false);
          setKorgBankEditorFile(null);
        }}
        externalOpenFile={korgBankEditorFile}
        onExternalOpenFileConsumed={() => setKorgBankEditorFile(null)}
        // v3.29.0 — ESX-Pattern-Patch braucht Zugriff auf das aktive
        // Synthstudio-Pattern + globale BPM-Quelle (Fallback wenn
        // pattern.bpm == null).
        getActiveSynthPattern={() => dmRef.current.getActivePattern() ?? null}
        globalBpm={project.bpm}
      />
      </MidiProvider>
    </ElectronDropZone>
  );
}
