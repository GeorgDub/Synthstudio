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

// ── Eigene Stores & Hooks ─────────────────────────────────────────────────────
import { useProjectStore } from "@/store/useProjectStore";
import { useWindowTitleSync } from "@/store/useWindowTitleSync";

// ── Seiten-Komponenten ────────────────────────────────────────────────────────
import { SampleBrowser } from "@/components/SampleBrowser";
import { AudioInputRecorder } from "@/components/SampleBrowser/AudioInputRecorder";
import { ProjectManager } from "@/components/ProjectManager";
import { NewProjectDialog } from "@/components/NewProjectDialog";
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
import { getKeyboardSamplerState } from "@/store/useKeyboardSamplerStore";
import { getEnvelopeFollowerConfigs } from "@/store/useEnvelopeFollowerStore";

// ── Stores für neue Features ──────────────────────────────────────────────────
import { useSongStore } from "@/store/useSongStore";
import { useHumanizerStore, computeHumanizerTimingOffset, computeHumanizerVelocityMultiplier } from "@/store/useHumanizerStore";
import { useMetronomeStore } from "@/store/useMetronomeStore";
import { useDrumMachineStore } from "@/store/useDrumMachineStore";
import { useTransport } from "@/hooks/useTransport";
import { useMidi } from "@/hooks/useMidi";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { MidiSettings } from "@/components/MidiSettings";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { UpdateBadge } from "@/components/UpdateBadge";
import { useCollabSession } from "@/hooks/useCollabSession";
import { useCollabSync } from "@/hooks/useCollabSync";
import { useSessionStore } from "@/store/useSessionStore";
import { CollabSplitView } from "@/components/CollabSplitView";
import { ThemeSettings, initTheme } from "@/components/Settings";
import { MixerView } from "@/components/Mixer";
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
import { AutomationView } from "@/components/Automation/AutomationView";
import { SceneLaunchPad } from "@/components/Scene/SceneLaunchPad";
import { AudioEngine } from "@/audio/AudioEngine";
import { CollabChat } from "@/components/CollabSession/CollabChat";
import { addChatMessage } from "@/store/useCollabChatStore";
import { saveSnapshot } from "@/store/useVersionSnapshotStore";
import { useApiSettingsStore } from "@/store/useApiSettingsStore";
import { VersionSnapshotPanel } from "@/components/ProjectManager/VersionSnapshotPanel";
import { SettingsPanel } from "@/components/Settings/SettingsPanel";
import { SessionRecorder } from "@/components/CollabSession/SessionRecorder";
import { RelayPanel } from "@/components/CollabSession/RelayPanel";
import { recordEvent } from "@/store/useSessionRecordingStore";
import { setMyRole, setParticipantRole } from "@/store/useSessionStore";
import { useLaunchpad, isGridDevice } from "@/hooks/useLaunchpad";
import { useBpmDetection, autoTagFromFilename } from "@/hooks/useBpmDetection";
import { getMacros, applyMacroBindings, setMacroValue, resetMacros } from "@/store/useMacroStore";
import {
  getAllAudioTracks,
  loadAudioTracks,
  markBroken as markAudioTrackBroken,
  setRuntimeWaveform as setAudioTrackRuntimeWaveform,
  clear as clearAudioTracks,
} from "@/store/useAudioTrackStore";
import {
  getProjectScripts,
  loadProjectScripts,
  disableAllForeignProject,
  getScript,
  clearProjectScripts,
} from "@/store/useScriptStore";
// BUG-013 fix: vollständiges Project-Reset über alle Stores
import { resetMelodicParts } from "@/store/useMelodicPartStore";
import { resetNoteRepeat } from "@/store/useNoteRepeatStore";
import { resetTranspose } from "@/store/useTransposeStore";
import { resetMorph } from "@/store/useMorphStore";
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
} from "@/utils/projectSerializer";

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

  // ── Electron-Hook (einziger Zugriffspunkt auf Electron-Features) ────────────
  const electron = useElectron();
  // ── Kollaborations-Session (für Sync) ─────────────────────────────────────────
  const collab = useCollabSession();
  const session = useSessionStore();
  const inSession = session.status === "hosting" || session.status === "joined";
  // ── Dialog-State ────────────────────────────────────────────────────────────────
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);

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

  // Listener: Popup wurde vom User geschlossen → State zurücksetzen
  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onPerfPopupClosed?.(() => {
      setPerformancePopupOpen(false);
    });
    return cleanup;
  }, [electron]);

  // ── Mixer-Popup-Window (Multi-Window-Workspace, post-v1.26.0) ─────────────
  const [mixerPopupOpen, setMixerPopupOpen] = useState(false);

  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onMixerPopupClosed?.(() => {
      setMixerPopupOpen(false);
    });
    return cleanup;
  }, [electron]);

  // ── Sample-Browser-Popup (Multi-Window-Workspace, post-v1.27.0) ───────────
  const [sampleBrowserPopupOpen, setSampleBrowserPopupOpen] = useState(false);

  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onSampleBrowserPopupClosed?.(() => {
      setSampleBrowserPopupOpen(false);
    });
    return cleanup;
  }, [electron]);

  // ── Pattern-Generator-Popup (Multi-Window-Workspace, post-v1.27.0) ────────
  const [patternGenPopupOpen, setPatternGenPopupOpen] = useState(false);

  useEffect(() => {
    if (!electron.isElectron) return;
    const cleanup = electron.onPatternGenPopupClosed?.(() => {
      setPatternGenPopupOpen(false);
    });
    return cleanup;
  }, [electron]);

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

  // ── Zentraler Projekt-State ────────────────────────────────────────────────────
  const project = useProjectStore();
  const song = useSongStore();
  const humanizer = useHumanizerStore();
  const dm = useDrumMachineStore();
  const dmRef = useRef(dm);
  dmRef.current = dm;
  const mixer = useMixerStore();
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
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSaveProject = useCallback(async () => {
    const snapshot = buildProjectSnapshot();
    cacheProjectLocally(snapshot);

    if (electron.isElectron) {
      const result = await electron.saveFileDialog({
        title: "Projekt speichern",
        defaultPath: `${snapshot.projectName}.synth`,
        filters: [{ name: "Synthstudio Projekt", extensions: ["synth", "json"] }],
      });
      if (!result.canceled && result.filePath) {
        await electron.writeFile(result.filePath, JSON.stringify(snapshot, null, 2));
      }
    } else {
      downloadProjectFile(snapshot);
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

  const restoreProject = useCallback((data: ReturnType<typeof parseProject>) => {
    // Projekt-Metadaten
    project.setProjectName(data.projectName);
    project.setBpm(data.bpm);
    // Samples
    project.addSamples(data.samples ?? []);
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
      if (data) restoreProject(data);
    } catch (err) {
      console.error("[Load Project]", err);
      alert("Projekt konnte nicht geladen werden.");
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

  // Auto-Save (konfigurierbares Intervall, ein-/ausschaltbar)
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
  const [activeTool, setActiveTool] = useState<'prompt' | 'algorithmic' | 'chords' | 'sampler' | 'workbench' | 'library' | 'script'>('prompt');

  // ── Dialog-State ─────────────────────────────────────────────────────────
  const [showMidiSettings, setShowMidiSettings] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showThemeSettings, setShowThemeSettings] = useState(false);
  // Unified Settings Panel
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<"design" | "ki" | "keyboard" | "midi-devices" | "midi-cc" | "midi-notes" | "about">("design");

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
        case "pattern-duplicate": dm.duplicatePattern(dm.activePatternId); break;
        case "pattern-clear":     dm.clearPattern(); break;
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
      }
    };
    window.addEventListener(KB_ACTION_EVENT, handler);
    return () => window.removeEventListener(KB_ACTION_EVENT, handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, handleSetActiveTab]);

  // ── MIDI-Hook ─────────────────────────────────────────────────────────────
  const midi = useMidi({
    onBpmChange: project.setBpm,
    onPlayStop: project.togglePlayStop,
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
    onOpenAudioWorkbench: () => handleSetActiveTab("tools"),
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

  // Kategorie eines Samples aktualisieren
  const handleUpdateSampleCategory = useCallback(
    (id: string, category: string) => {
      project.addSamples(
        project.samples.map(s => s.id === id ? { ...s, category } : s)
      );
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <ElectronDropZone
      onAudioFiles={handleDropAudioFiles}
      onFolder={handleDropFolder}
      onProject={handleDropProject}
      onZipFile={handleDropZipFile}
    >
      <div className="flex flex-col h-screen bg-bg-base text-text-primary overflow-hidden">

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
                  <span className="ml-1 text-accent-secondary" title="Ungespeicherte Änderungen">
                    ●
                  </span>
                )}
              </span>

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
                onImportPatterns={(patterns, sourceFormat) => {
                  // Importierte Patterns als zusätzliche Patterns in DrumMachine hinzufügen
                  patterns.forEach(p => {
                    dm.addPatternData(p as Parameters<typeof dm.addPatternData>[0]);
                  });
                  if (patterns.length > 0 && patterns[0].bpm) {
                    project.setBpm(patterns[0].bpm);
                  }
                  console.log(`[Import] ${patterns.length} Patterns aus ${sourceFormat.toUpperCase()} hinzugefügt`);
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
              {/* Performance Mode (Vollbild-Launchpad, F12) */}
              <button
                onClick={() => setPerformanceActive(true)}
                title="Performance Mode (F12) – Vollbild-Pattern-Launchpad"
                className="ml-auto mr-3 px-3 py-1.5 rounded text-xs font-bold bg-accent-primary/20 border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/30"
              >
                ⚡ Performance Mode
              </button>
            </div>

            <div className="flex-1 overflow-hidden">

              {activeTab === "sequencer" && (
                <DrumMachine
                  dm={dm}
                  samples={project.samples}
                  isPlaying={project.isPlaying}
                  bpm={project.bpm}
                  onPlayStop={collabPlayStop}
                  onBpmChange={collabBpmChange}
                  className="h-full"
                />
              )}

              {activeTab === "mixer" && (
                mixerPopupOpen ? (
                  <div className="h-full flex items-center justify-center text-text-dim text-sm">
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
                    className="h-full"
                  />
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
                      { id: "script",      label: "⚡ Script" },
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
                        <ChordProgressionPanel bpm={project.bpm} />
                      </div>
                    )}
                    {activeTool === 'sampler' && (
                      <div className="h-full overflow-y-auto p-4 max-w-2xl">
                        <KeyboardSamplerPanel samples={project.samples} />
                      </div>
                    )}
                    {activeTool === 'workbench' && (
                      <div className="h-full overflow-y-auto">
                        <AudioWorkbench onSamplesAdded={(s) => project.addSamples(s)} />
                      </div>
                    )}
                    {activeTool === 'library' && (
                      <PatternLibrary
                        currentPattern={dm.getActivePattern()}
                        globalBpm={project.bpm}
                        onLoadPattern={(pattern) => dm.addPatternData(pattern)}
                      />
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
    </ElectronDropZone>
  );
}
