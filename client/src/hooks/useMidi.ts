/**
 * Synthstudio – useMidi.ts
 *
 * Web MIDI API Integration:
 * - MIDI-Gerät-Erkennung und -Auswahl
 * - Note-On/Off → Pad-Trigger (Drum-Pads)
 * - CC-Nachrichten → Parameter-Mapping (BPM, Volume, Mute, etc.)
 * - MIDI-Learn-Modus (CC einem Parameter zuweisen)
 * - MIDI-Clock-Sync (externe BPM-Synchronisation)
 * - Velocity-sensitives Triggern
 *
 * Funktioniert im Browser (Web MIDI API) und in Electron (Chromium).
 * Fallback: Warnung wenn Web MIDI nicht verfügbar.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { getChordMemoryState, buildChordNotes } from "@/store/useChordMemoryStore";
import { AudioEngine, findFxParamRange, midiValueToFxParam, type FxParamKey } from "@/audio/AudioEngine";
import { toast } from "@/store/useToastStore";
import {
  loadClockOutputId,
  saveClockOutputId,
  loadClockOutEnabled,
  saveClockOutEnabled,
  loadFeedbackOutputId,
  saveFeedbackOutputId,
  loadFeedbackEnabled,
  saveFeedbackEnabled,
  loadFeedbackSceneMode,
  saveFeedbackSceneMode,
  loadClockInEnabled,
  saveClockInEnabled,
  sendMessage as midiSendMessage,
  NANO_KONTROL2,
  type MidiAccessLike,
} from "@/utils/midiOutput";
import { NanoKontrolFeedback, type NanoKontrolChannelState } from "@/audio/NanoKontrolFeedback";
import { MidiClockIn, type MidiClockInStatus } from "@/audio/MidiClockIn";
import { cycleScene } from "@/store/useSceneStore";
import {
  detectTemplatesFromDeviceList,
  dispatchTemplateSuggestion,
  loadNeverList,
} from "@/utils/midiDeviceDetection";
import { getMidiFxChain } from "@/store/useMidiFxStore";
import { applyMidiFx, MidiFxNoteTracker, type NoteOn } from "@/utils/midiFxEngine";

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
}

export type MidiLearnTarget =
  // ── Transport ──────────────────────────────────────────────────────────────
  | { type: "bpm" }
  | { type: "playStop" }
  | { type: "record" }
  | { type: "tapTempo" }
  | { type: "bpmUp" }
  | { type: "bpmDown" }
  | { type: "masterVolume" }
  // ── Parts ──────────────────────────────────────────────────────────────────
  | { type: "volume";  partId: string; partName?: string }
  | { type: "mute";    partId: string; partName?: string }
  | { type: "solo";    partId: string; partName?: string }
  | { type: "pan";     partId: string; partName?: string }
  /** v1.76: jeder numerische FX-Parameter eines Channels (filterFreq,
   *  reverbDecay, delayMix, eqLow, …). Siehe FX_PARAM_RANGES für die Liste. */
  | { type: "fxParam"; partId: string; partName?: string; param: FxParamKey }
  /** v2.1: Send-Bus-Level pro Channel (Reverb / Delay). */
  | { type: "send"; partId: string; partName?: string; bus: "reverb" | "delay" }
  | { type: "step";    partId: string; stepIndex: number }
  | { type: "partUp" }
  | { type: "partDown" }
  // ── Pattern ─────────────────────────────────────────────────────────────────
  | { type: "pattern";          patternIndex: number }
  | { type: "patternNext" }
  | { type: "patternPrev" }
  | { type: "patternClear" }
  | { type: "patternFill" }
  | { type: "patternRandomize" }
  | { type: "patternDuplicate" }
  // ── Navigation ───────────────────────────────────────────────────────────────
  | { type: "tab"; tabId: string }
  // ── Performance ──────────────────────────────────────────────────────────────
  | { type: "toggleNoteRepeat" }
  | { type: "toggleMorph" }
  | { type: "commitLiveEdit" }
  | { type: "scenelaunch"; sceneIndex: number }
  // ── Einstellungen ─────────────────────────────────────────────────────────────
  | { type: "openSettings" }
  // ── Macro (v1.88) — direkt einen Makro-Wert per CC steuern ───────────────
  | { type: "macro"; index: number; label?: string }
  // ── Run-Script (v1.78) ─────────────────────────────────────────────────────
  /**
   * Triggert ein User-Script aus dem useScriptStore. Bei CC>63 oder Note-On
   * wird ein CustomEvent "midi:runScript" mit der scriptId gefeuert; App.tsx
   * konsumiert es und ruft `scriptSandbox.run(code)` auf.
   */
  | { type: "runScript"; scriptId: string; scriptName?: string }
  // ── Function-Chain (v1.77) ────────────────────────────────────────────────────
  /**
   * Eine Folge von Sub-Targets, die bei einem einzigen MIDI-Event
   * (CC > 63 oder Note-On) der Reihe nach ausgeführt werden — optional mit
   * `delayMs` zwischen den Schritten. Damit lassen sich z.B. komplette Macros
   * wie "BPM 140 + Pattern-Clear + Play" oder Performance-Combos auf einer
   * einzigen Taste/einem Pad ablegen. Sub-Targets dürfen keine weiteren chains
   * sein (1-Level-Nesting only) damit endlose Rekursion ausgeschlossen ist.
   */
  | { type: "chain"; label: string; steps: ChainStep[] }
  // ── Live-Looper (v2.87 / TASK-235) ────────────────────────────────────────
  /**
   * Triggert den State-Machine-Step eines Loops (Pad-Click / Footswitch):
   *   empty→arming→recording→playing⇄overdubbing
   * Auf CC>63 oder Note-On wird ein "midi:loopTrigger" CustomEvent gefeuert
   * mit { loopIndex } im detail. App.tsx ruft AudioEngine.triggerLoop().
   */
  | { type: "loopTrigger"; loopIndex: number }
  /**
   * Erase: setzt einen Loop unconditional zurück auf empty.
   * Long-Press im UI mappt darauf, oder ein eigener MIDI-Trigger.
   */
  | { type: "loopErase"; loopIndex: number }
  // ── Sample-Slice-Pad (v2.91 / TASK-238-FOLLOWUP-1B) ───────────────────────
  /**
   * Spielt einen in `useSlicePadStore` abgelegten Slice-Buffer ab. CC>63 oder
   * Note-On feuern ein "midi:slicePad" CustomEvent mit `{ sliceIndex }`. App.tsx
   * konsumiert es und ruft `AudioEngine.playSliceBuffer(slot.buffer, slot.sampleRate)`.
   * sliceIndex ist 0..15 (entspricht MAX_SLICE_PADS).
   */
  | { type: "playSlicePad"; sliceIndex: number }
  // ── Sub-Mix-Bus (v3.81.0) ─────────────────────────────────────────────────
  /**
   * v3.81: MIDI-Learn auf Sub-Mix-Bus-Controls (analog zu Channel-Volume/Pan/
   * Mute/Solo, aber für Bus-Aggregates aus useSubMixStore). Die Targets feuern
   * CustomEvents die in App.tsx auf die Store-Setter setBusVolume/Pan/Mute/Solo
   * gemappt werden. Closes v3.80-Caveat "kein MIDI-Learn auf Bus-Strip".
   */
  | { type: "subMixBusVolume"; busId: string; busName?: string }
  | { type: "subMixBusPan";    busId: string; busName?: string }
  | { type: "subMixBusMute";   busId: string; busName?: string }
  | { type: "subMixBusSolo";   busId: string; busName?: string }
  // ── Sub-Mix-Bus FX (v3.87.0) ─────────────────────────────────────────────
  /**
   * v3.87: MIDI-Learn auf Sub-Mix-Bus FX-Params (EQ-3 Bands + Compressor
   * Threshold/Ratio + Reverb/Delay-Send). Closes v3.86-Caveat
   * "Bus FX-Chain ohne MIDI-Learn". Events: midi:subMixBusEqLowGain etc.
   */
  | { type: "subMixBusEqLowGain";    busId: string; busName?: string }
  | { type: "subMixBusEqMidGain";    busId: string; busName?: string }
  | { type: "subMixBusEqHighGain";   busId: string; busName?: string }
  | { type: "subMixBusCompThreshold"; busId: string; busName?: string }
  | { type: "subMixBusCompRatio";    busId: string; busName?: string }
  | { type: "subMixBusReverbSend";   busId: string; busName?: string }
  | { type: "subMixBusDelaySend";    busId: string; busName?: string };

/** Ein Schritt in einer Function-Chain (v1.77). */
export interface ChainStep {
  /** Das Sub-Target, das beim Step-Index ausgeführt wird. */
  target: Exclude<MidiLearnTarget, { type: "chain" }>;
  /**
   * Optional: feste Value (0-127) die als CC-Value dem applyMapping übergeben
   * wird. Default: 127 (=max, on). Sinnvoll z.B. für `volume`-Subtargets die
   * einen bestimmten Pegel setzen sollen — nicht den eingehenden MIDI-Value.
   */
  value?: number;
  /** Optional: Verzögerung in ms NACH diesem Schritt (vor dem nächsten). */
  delayMs?: number;
}

export interface MidiMapping {
  cc: number;
  channel: number; // 0 = alle Kanäle
  target: MidiLearnTarget;
  label: string;
}

export interface MidiNoteMapping {
  note: number;
  channel: number;
  partId: string;
  label: string;
  /**
   * v2.78: Optional — wenn gesetzt (0..PERF_PAD_COUNT-1), triggert die Note
   * das Performance-Mode-Pad mit diesem Index statt einer Part-Spur.
   */
  performancePadIndex?: number;
  /**
   * v2.79: Optional — wenn gesetzt, wird die Note durch den vollen
   * applyMapping-Pfad geleitet (analog zu CC-Mappings). Damit lassen sich
   * Chains, Scripts, Macros, scenelaunch, patternNext etc. auf einzelne
   * Hardware-Pads legen. Precedence: target > performancePadIndex > partId
   * (Backwards-Compat). partId/label bleiben fürs UI-Display gefüllt.
   */
  target?: MidiLearnTarget;
}

/**
 * Ein Eintrag in der Auto-Learn-Queue (v1.72): entweder ein CC-Target oder
 * ein Note-Target (Pad → Part-Trigger). Erlaubt gemischte Sequenzen,
 * z.B. "8 CCs für Volumes, dann 8 Notes für Pads".
 */
export type AutoLearnEntry =
  | { kind: "cc"; target: MidiLearnTarget }
  | {
      kind: "note";
      partId: string;
      partName: string;
      /** v2.78: captured Note → Performance-Pad-Trigger statt Part-Trigger. */
      performancePadIndex?: number;
      /**
       * v2.79: captured Note → beliebiges MidiLearnTarget (Chain/Script/Macro/
       * scenelaunch/etc.) via applyMapping. Precedence im resultierenden
       * MidiNoteMapping: target > performancePadIndex > partId.
       */
      target?: MidiLearnTarget;
    };

export interface MidiState {
  isAvailable: boolean;
  isEnabled: boolean;
  devices: MidiDevice[];
  activeDeviceId: string | null;
  /** Verfügbare MIDI-Ausgangsgeräte */
  outputDevices: MidiDevice[];
  activeOutputDeviceId: string | null;
  /** v1.97: MIDI-Clock-Output aktiv? (sendet 24 PPQ an active output) */
  clockOutEnabled: boolean;
  /** v1.97: BPM für den Clock-Output (sollte = transport-BPM sein, vom Caller gesetzt) */
  clockOutBpm: number;
  /**
   * v2.83 (TASK-230): explizite Device-ID für Clock-Out. Kann von
   * `activeOutputDeviceId` abweichen, damit der User Clock und Note-Out an
   * unterschiedliche Geräte routen kann (z.B. Clock an Electribe 2, Notes
   * an Volca Sample). null = nutze `activeOutputDeviceId` als Fallback.
   */
  clockOutputDeviceId: string | null;
  /**
   * v2.84 (TASK-231): LED-Feedback-Output (z.B. nanoKONTROL2). Schickt
   * Mute/Solo-Status der ersten 8 Mixer-Channels per CC an die Hardware.
   * Kann unabhängig vom Clock-Out gewählt werden — User kann Clock an
   * Electribe + LED-Feedback an nanoKONTROL2 routen. null = kein LED-Out.
   */
  feedbackOutputDeviceId: string | null;
  /** v2.84: LED-Feedback aktiv (Mute/Solo-LEDs auf Hardware spiegeln). */
  feedbackEnabled: boolean;
  /**
   * v2.84: Marker-PREV/NEXT (CC 61/62) cyclen Scenes via useSceneStore.
   * Wenn off → Marker-CCs werden ignoriert (oder vom User-CC-Mapping
   * gehandelt). Default false.
   */
  feedbackSceneMode: boolean;
  mappings: MidiMapping[];
  noteMappings: MidiNoteMapping[];
  isLearning: boolean;
  learnTarget: MidiLearnTarget | null;
  /**
   * Auto-Learn-Queue (v1.71 CC, v1.72 + Note): nicht-leer = sequenzielles
   * Lernen läuft. `[0]` = aktuell zu lernender Eintrag, der Rest folgt nach
   * Capture/Skip. `autoLearnTotal` = ursprüngliche Länge für Progress-Anzeige.
   * Jeder Eintrag ist entweder ein CC-Target oder ein Note-Target — der
   * Handler matched die eingehende MIDI-Message gegen den `kind`.
   */
  autoLearnQueue: AutoLearnEntry[];
  autoLearnTotal: number;
  /**
   * v1.83: optionaler Channel-Filter für Auto-Learn. 0 = alle Channels
   * akzeptieren, 1-16 = nur Messages auf diesem Channel.
   */
  autoLearnFilterChannel: number;
  clockSync: boolean;
  externalBpm: number | null;
  /**
   * v3.35.0: MIDI-Clock-IN External-Sync. Wenn true, übernimmt Synthstudio
   * BPM + Play/Stop vom externen Master (Electribe, OmniTribe, DAW). Der
   * Tempo-Slider wird read-only, BPM-Anzeige zeigt das gemittelte externe
   * Tempo. Komplement zu clockOutEnabled (v2.83).
   */
  clockInEnabled: boolean;
  /**
   * v3.35.0: Sync-Status für UI-LED. `off` = Receiver disabled, `tempo-only`
   * = Ticks fließen aber kein Transport-Start, `running` = Master spielt,
   * `lost` = > 500ms keine Ticks (Master disconnected / paused without stop).
   */
  clockInStatus: MidiClockInStatus;
  /**
   * v3.36.0: Letzte empfangene SPP-Position vom externen Master (in
   * MIDI-Beats = 1/16-Note-Steps). null = noch kein SPP empfangen. UI
   * zeigt das als "Beat: N (step N)" in den MidiSettings.
   */
  clockInSpp: number | null;
  /** MIDI Out aktiv */
  midiOutEnabled: boolean;
  /** MIDI-Ausgangskanal (1–16, 0 = Ch10 Drums) */
  midiOutChannel: number;
}

export interface MidiActions {
  enable: () => Promise<void>;
  disable: () => void;
  setActiveDevice: (id: string | null) => void;
  setActiveOutputDevice: (id: string | null) => void;
  setMidiOutEnabled: (enabled: boolean) => void;
  setMidiOutChannel: (channel: number) => void;
  /** Sendet eine MIDI-Note an das aktive Ausgangsgerät */
  sendNoteOn: (note: number, velocity: number, channel?: number) => void;
  sendNoteOff: (note: number, channel?: number) => void;
  sendCC: (cc: number, value: number, channel?: number) => void;
  startLearn: (target: MidiLearnTarget) => void;
  cancelLearn: () => void;
  /**
   * Auto-Learn (v1.71 CC, v1.72 + Note): startet sequenzielles Lernen über
   * eine Liste gemischter Einträge (CC + Note). Bei jedem passenden
   * MIDI-Event wird das Mapping geschrieben und der nächste Eintrag aktiv.
   */
  startAutoLearn: (entries: AutoLearnEntry[]) => void;
  /** Skipt den aktuell zu lernenden Target und geht zum nächsten. */
  skipAutoLearnTarget: () => void;
  /** Bricht Auto-Learn ab — bisher gebundene Mappings bleiben erhalten. */
  cancelAutoLearn: () => void;
  /** v1.83: Setter für den Auto-Learn Channel-Filter (0 = alle, 1-16). */
  setAutoLearnFilterChannel: (ch: number) => void;
  removeMapping: (cc: number, channel: number) => void;
  addNoteMapping: (note: number, channel: number, partId: string, label: string) => void;
  removeNoteMapping: (note: number, channel: number) => void;
  setClockSync: (enabled: boolean) => void;
  clearAllMappings: () => void;
  /** Lädt eine vordefinierte Hardware-Template-Konfiguration (ersetzt alle Mappings). */
  loadTemplate: (cc: MidiMapping[], notes: MidiNoteMapping[]) => void;
  /**
   * v2.3: Bulk-Add — fügt mehrere CC-Mappings auf einmal hinzu, ohne die
   * bestehenden zu ersetzen. Duplikate (gleicher cc+channel) werden vom
   * neuen Mapping überschrieben.
   */
  addMappings: (mappings: MidiMapping[]) => void;
  /** v1.97: Aktiviert/deaktiviert MIDI-Clock-Output. */
  setClockOutEnabled: (enabled: boolean) => void;
  /** v1.97: Setzt die BPM die als Clock gesendet wird (vom Caller bei BPM-Änderung). */
  setClockOutBpm: (bpm: number) => void;
  /**
   * v2.83 (TASK-230): Setzt das dedizierte Clock-Out-Device. null = nutze
   * `activeOutputDeviceId` (Backwards-Compat zu v2.82).
   */
  setClockOutputDeviceId: (id: string | null) => void;
  /**
   * v2.84 (TASK-231): Setzt das LED-Feedback-Output-Device. null = LED-
   * Feedback aus (egal was feedbackEnabled sagt — der Sender hat kein Ziel).
   */
  setFeedbackOutputDeviceId: (id: string | null) => void;
  /** v2.84: Aktiviert/deaktiviert LED-Feedback an die Hardware. */
  setFeedbackEnabled: (enabled: boolean) => void;
  /** v2.84: Toggle für Marker-PREV/NEXT → Scene-Cycle. */
  setFeedbackSceneMode: (enabled: boolean) => void;
  /**
   * v3.35.0: Aktiviert/deaktiviert External-Sync (MIDI-Clock-IN als Slave).
   * Wenn an: Synthstudio übernimmt BPM + Play/Stop vom externen Master. UI-
   * Slider wird read-only. AudioEngine.setExternalSyncActive() wird parallel
   * gesetzt damit setBpm() blockiert wird.
   */
  setClockInEnabled: (enabled: boolean) => void;
  /**
   * v2.84: Synchronisiert den LED-State mit dem aktuellen Mixer-Snapshot.
   * Wird typischerweise im useEffect aufgerufen wenn sich Mute/Solo ändert.
   * Diff-Sync: nur geänderte LEDs werden gesendet.
   */
  syncFeedbackLeds: (channels: NanoKontrolChannelState[]) => void;
  /**
   * v1.98: MIDI Panic — sendet `[0x80|ch, note, 0]` (Note Off) für alle 128
   * Notes auf allen 16 Channels ans aktive Output-Device. Plus `[0xB0|ch, 123, 0]`
   * (All Notes Off) und `[0xB0|ch, 120, 0]` (All Sound Off) als Sicherheits-CC.
   * Löst hängende Notes bei externen Synths.
   */
  sendPanic: () => void;
}

// ─── Pure Helpers (Modul-Scope, testbar ohne React) ──────────────────────────

/** Human-readable Label für ein MidiLearnTarget. Wird in der Settings-UI + im
 *  Auto-Learn-Progress angezeigt. Pure Funktion — keine Side-Effects. */
export function labelForTarget(target: MidiLearnTarget): string {
  switch (target.type) {
    case "bpm":             return "BPM (absolut)";
    case "masterVolume":    return "Master Volume";
    case "playStop":        return "Play / Stop";
    case "record":          return "Record";
    case "tapTempo":        return "Tap Tempo";
    case "bpmUp":           return "BPM +1";
    case "bpmDown":         return "BPM -1";
    case "volume":          return `Volume: ${target.partName ?? target.partId.slice(0, 8)}`;
    case "pan":             return `Pan: ${target.partName ?? target.partId.slice(0, 8)}`;
    case "mute":            return `Mute: ${target.partName ?? target.partId.slice(0, 8)}`;
    case "solo":            return `Solo: ${target.partName ?? target.partId.slice(0, 8)}`;
    case "fxParam":         return `${findFxParamRange(target.param)?.label ?? target.param}: ${target.partName ?? target.partId.slice(0, 8)}`;
    case "send":            return `${target.bus === "reverb" ? "Reverb Send" : "Delay Send"}: ${target.partName ?? target.partId.slice(0, 8)}`;
    case "partUp":          return "Part ↑";
    case "partDown":        return "Part ↓";
    case "step":            return `Step ${target.stepIndex + 1}`;
    case "pattern":         return `Pattern ${target.patternIndex + 1}`;
    case "patternNext":     return "Pattern →";
    case "patternPrev":     return "Pattern ←";
    case "patternClear":    return "Pattern leeren";
    case "patternFill":     return "Pattern füllen";
    case "patternRandomize":return "Pattern zufällig";
    case "patternDuplicate":return "Pattern duplizieren";
    case "tab":             return `Tab: ${target.tabId}`;
    case "toggleNoteRepeat":return "Note Repeat";
    case "toggleMorph":     return "Pattern Morph";
    case "commitLiveEdit":  return "Live Edit Commit";
    case "scenelaunch":     return `Scene ${target.sceneIndex + 1}`;
    case "openSettings":    return "Einstellungen öffnen";
    case "macro":           return `Macro ${target.index + 1}${target.label ? `: ${target.label}` : ""}`;
    case "runScript":       return `Script: ${target.scriptName ?? target.scriptId.slice(0, 8)}`;
    case "chain":           return `Chain: ${target.label} (${target.steps.length} Schritte)`;
    case "loopTrigger":     return `Loop ${target.loopIndex + 1} Trigger`;
    case "loopErase":       return `Loop ${target.loopIndex + 1} Erase`;
    case "playSlicePad":    return `Slice-Pad ${target.sliceIndex + 1}`;
    case "subMixBusVolume": return `Bus Volume: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusPan":    return `Bus Pan: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusMute":   return `Bus Mute: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusSolo":   return `Bus Solo: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusEqLowGain":     return `Bus EQ Low: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusEqMidGain":     return `Bus EQ Mid: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusEqHighGain":    return `Bus EQ High: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusCompThreshold": return `Bus Comp Threshold: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusCompRatio":     return `Bus Comp Ratio: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusReverbSend":    return `Bus Reverb Send: ${target.busName ?? target.busId.slice(0, 8)}`;
    case "subMixBusDelaySend":     return `Bus Delay Send: ${target.busName ?? target.busId.slice(0, 8)}`;
    default:                return "Unbekannt";
  }
}

/**
 * Vergleicht zwei MidiLearnTargets auf logische Gleichheit. Wird für die
 * Right-Click-MIDI-Learn-Feature (v1.86) verwendet um zu erkennen ob ein
 * bestimmtes UI-Element schon mit einem CC verbunden ist.
 *
 * Pure Funktion: keine Side-Effects, public exportiert für Tests.
 */
export function targetsMatch(a: MidiLearnTarget, b: MidiLearnTarget): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "volume":
    case "mute":
    case "solo":
    case "pan":
      return a.partId === (b as { partId: string }).partId;
    case "fxParam":
      return a.partId === (b as { partId: string; param: string }).partId &&
             a.param === (b as { partId: string; param: string }).param;
    case "send":
      return a.partId === (b as { partId: string; bus: string }).partId &&
             a.bus === (b as { partId: string; bus: string }).bus;
    case "pattern":
      return a.patternIndex === (b as { patternIndex: number }).patternIndex;
    case "step":
      return a.partId === (b as { partId: string; stepIndex: number }).partId &&
             a.stepIndex === (b as { partId: string; stepIndex: number }).stepIndex;
    case "tab":
      return a.tabId === (b as { tabId: string }).tabId;
    case "scenelaunch":
      return a.sceneIndex === (b as { sceneIndex: number }).sceneIndex;
    case "runScript":
      return a.scriptId === (b as { scriptId: string }).scriptId;
    case "macro":
      return a.index === (b as { index: number }).index;
    case "chain":
      return a.label === (b as { label: string }).label;
    case "loopTrigger":
    case "loopErase":
      return a.loopIndex === (b as { loopIndex: number }).loopIndex;
    case "playSlicePad":
      return a.sliceIndex === (b as { sliceIndex: number }).sliceIndex;
    case "subMixBusVolume":
    case "subMixBusPan":
    case "subMixBusMute":
    case "subMixBusSolo":
    case "subMixBusEqLowGain":
    case "subMixBusEqMidGain":
    case "subMixBusEqHighGain":
    case "subMixBusCompThreshold":
    case "subMixBusCompRatio":
    case "subMixBusReverbSend":
    case "subMixBusDelaySend":
      return a.busId === (b as { busId: string }).busId;
    default:
      // Single-target types ohne Param: bpm, playStop, record, tapTempo,
      // bpmUp, bpmDown, masterVolume, partUp, partDown, patternNext,
      // patternPrev, patternClear, patternFill, patternRandomize,
      // patternDuplicate, toggleNoteRepeat, toggleMorph, commitLiveEdit,
      // openSettings → wenn type gleich, sind sie gleich.
      return true;
  }
}

/**
 * Sucht in der Mapping-Liste das CC-Mapping das auf das gegebene Target
 * verweist (oder undefined). Pure Funktion. v1.86.
 */
export function findMappingForTarget(
  mappings: MidiMapping[],
  target: MidiLearnTarget,
): MidiMapping | undefined {
  return mappings.find((m) => targetsMatch(m.target, target));
}

/**
 * Plant eine Chain-Ausführung als geordnete Folge von (Step, Verzögerung)
 * Paaren. Liefert für Testbarkeit eine Beschreibung der geplanten Triggers.
 * Side-effect-frei, Caller dispatcht die einzelnen Targets selbst.
 *
 * v1.77: 1-Level Nesting — Sub-Targets dürfen keine `chain` sein.
 * Falls trotzdem eine chain als Step übergeben wird (über TypeScript
 * umgangen via Cast), wird sie übersprungen, und `dropped` zählt mit.
 */
export interface ChainPlan {
  /** Geplant: ausgeführte Steps mit kumulativem Delay (in ms vom Chain-Start). */
  triggers: Array<{ step: number; target: MidiLearnTarget; value: number; atMs: number }>;
  /** Anzahl der wegen Nesting/Ungültigkeit übersprungenen Steps. */
  dropped: number;
}

export function planChainExecution(
  steps: ChainStep[],
): ChainPlan {
  const triggers: ChainPlan["triggers"] = [];
  let dropped = 0;
  let cumDelay = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || !step.target) { dropped++; continue; }
    // Defensive: chain-of-chain blocken (TS verhindert es, aber JS-Caller könnte casten)
    // @ts-expect-error - prüfen ob jemand via Cast ein chain als Step durchgereicht hat
    if (step.target.type === "chain") { dropped++; continue; }
    triggers.push({
      step: i,
      target: step.target,
      value: typeof step.value === "number"
        ? Math.max(0, Math.min(127, step.value))
        : 127,
      atMs: cumDelay,
    });
    cumDelay += Math.max(0, Math.min(60_000, step.delayMs ?? 0));
  }
  return { triggers, dropped };
}

/**
 * Berechnet den nächsten Auto-Learn-Queue-Zustand für eine eingehende
 * MIDI-Message. Pure Funktion: keine React-State-Mutation, keine Side-Effects.
 *
 *   - CC-Entry akzeptiert CC-Messages (status 0xb0) mit Value>0
 *   - Note-Entry akzeptiert Note-On (status 0x90) mit Velocity>0
 *
 * Bei Nicht-Match (z.B. CC-Message bei Note-Entry) bleibt die Queue unverändert.
 * Bei Match wird die Queue um den ersten Eintrag gekürzt UND das passende
 * Mapping zurückgegeben — Caller schreibt es ins mappings/noteMappings-Array.
 *
 * Vor v1.72 war diese Logik direkt in handleMidiMessage; jetzt extrahiert um
 * testbar zu sein (siehe tests/features/midi-auto-learn.test.ts).
 */
export function nextAutoLearnEntry(
  queue: AutoLearnEntry[],
  msg: { type: number; byte1: number; byte2: number; channel: number },
  /**
   * v1.83: Optionaler Channel-Filter. Wenn gesetzt (1-16), werden nur
   * Messages auf diesem Channel als Capture akzeptiert — alle anderen
   * lassen die Queue unverändert. 0 = "alle Channels" (default).
   * Nützlich wenn der User mehrere Controller gleichzeitig angeschlossen
   * hat und der Auto-Learn deshalb 'falsche' Events von einem anderen
   * Gerät einfängt.
   */
  filterChannel: number = 0,
): {
  newQueue: AutoLearnEntry[];
  ccMapping?: MidiMapping;
  noteMapping?: MidiNoteMapping;
} {
  if (queue.length === 0) return { newQueue: queue };
  if (filterChannel > 0 && filterChannel !== msg.channel) {
    return { newQueue: queue };
  }
  const entry = queue[0];
  if (entry.kind === "cc" && msg.type === 0xb0 && msg.byte2 > 0) {
    return {
      newQueue: queue.slice(1),
      ccMapping: {
        cc: msg.byte1,
        channel: msg.channel,
        target: entry.target,
        label: labelForTarget(entry.target),
      },
    };
  }
  if (entry.kind === "note" && msg.type === 0x90 && msg.byte2 > 0) {
    return {
      newQueue: queue.slice(1),
      noteMapping: {
        note: msg.byte1,
        channel: msg.channel,
        partId: entry.partId,
        label: entry.partName,
        // v2.78: optionalen Performance-Pad-Index mit-übernehmen
        ...(entry.performancePadIndex !== undefined
          ? { performancePadIndex: entry.performancePadIndex }
          : {}),
        // v2.79: optionalen generischen Target mit-übernehmen
        ...(entry.target !== undefined ? { target: entry.target } : {}),
      },
    };
  }
  return { newQueue: queue };
}

// ─── Standard-Note-Mappings (GM Drum Map) ────────────────────────────────────

const GM_DRUM_DEFAULTS: Array<{ note: number; name: string }> = [
  { note: 36, name: "Kick" },
  { note: 38, name: "Snare" },
  { note: 42, name: "Hi-Hat cl." },
  { note: 46, name: "Hi-Hat op." },
  { note: 39, name: "Clap" },
  { note: 45, name: "Tom Hi" },
  { note: 41, name: "Tom Lo" },
  { note: 49, name: "FX" },
];

// ─── Persistenz (localStorage) ───────────────────────────────────────────────

const STORAGE_KEY = "synthstudio:midi-mappings";
// v1.84: separater Storage-Key für active-Device-Persistenz — Mappings sind
// device-agnostisch, aber wir wollen nach Reload das zuletzt gewählte Gerät
// auto-reconnect ohne dass der User es erneut anklicken muss.
const ACTIVE_DEVICE_STORAGE_KEY = "synthstudio:midi-active-device";

function loadMappings(): { cc: MidiMapping[]; notes: MidiNoteMapping[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return { cc: [], notes: [] };
}

function saveMappings(cc: MidiMapping[], notes: MidiNoteMapping[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cc, notes }));
  } catch {
    // ignore
  }
}

/**
 * Speichert die zuletzt aktive Geräte-Konfiguration für Auto-Reconnect (v1.84).
 * Wir persistieren `name + manufacturer` (nicht die id, die wechselt zwischen
 * Sessions); beim Reload suchen wir das Gerät anhand des Names — robuster.
 */
interface ActiveDevicePersist {
  input?: { name: string; manufacturer: string };
  output?: { name: string; manufacturer: string };
}

function loadActiveDevice(): ActiveDevicePersist {
  try {
    const raw = localStorage.getItem(ACTIVE_DEVICE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveActiveDevice(d: ActiveDevicePersist) {
  try {
    localStorage.setItem(ACTIVE_DEVICE_STORAGE_KEY, JSON.stringify(d));
  } catch { /* ignore */ }
}

// ─── MIDI-Clock-Analyse ───────────────────────────────────────────────────────

class MidiClockAnalyzer {
  private timestamps: number[] = [];
  private readonly WINDOW = 24; // 24 Pulse = 1 Viertelnote

  tick(now: number): number | null {
    this.timestamps.push(now);
    if (this.timestamps.length > this.WINDOW * 4) {
      this.timestamps = this.timestamps.slice(-this.WINDOW * 4);
    }
    if (this.timestamps.length < this.WINDOW + 1) return null;

    const recent = this.timestamps.slice(-(this.WINDOW + 1));
    const intervals: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      intervals.push(recent[i] - recent[i - 1]);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const bpm = 60000 / (avgInterval * 24);
    return Math.round(bpm * 10) / 10;
  }

  reset() {
    this.timestamps = [];
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseMidiOptions {
  onNoteOn?: (note: number, velocity: number, channel: number) => void;
  onNoteOff?: (note: number, channel: number) => void;
  onCc?: (cc: number, value: number, channel: number) => void;
  onClockBpm?: (bpm: number) => void;
  // DrumMachine-Callbacks
  onPartTrigger?: (partId: string, velocity: number) => void;
  onBpmChange?: (bpm: number) => void;
  /**
   * Transport-Toggle-Callback. v3.37.0: optionaler `positionStep` Parameter
   * für SPP-driven External-Sync — wenn der Master via 0xFA + vorherigem
   * Song-Position-Pointer einen Mid-Track-Start triggert, reicht useMidi
   * den Ziel-Step direkt durch (Race-Fix gegen play(0)-Overwrite).
   * Bei manuellen UI-Triggers (Spacebar, Klick) bleibt der Parameter
   * undefined — Caller behandelt das wie bisher (Start ab 0 / Stop).
   */
  onPlayStop?: (positionStep?: number) => void;
  onMute?: (partId: string) => void;
  // Parts für Note-Mapping
  parts?: Array<{ id: string; name: string }>;
}

export function useMidi(options: UseMidiOptions = {}): MidiState & MidiActions {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [outputDevices, setOutputDevices] = useState<MidiDevice[]>([]);
  const [activeOutputDeviceId, setActiveOutputDeviceId] = useState<string | null>(null);
  const [midiOutEnabled, setMidiOutEnabledState] = useState(false);
  const [midiOutChannel, setMidiOutChannelState] = useState(10); // Ch10 = Drums GM
  const [isLearning, setIsLearning] = useState(false);
  const [learnTarget, setLearnTarget] = useState<MidiLearnTarget | null>(null);
  const [clockSync, setClockSyncState] = useState(false);
  const [externalBpm, setExternalBpm] = useState<number | null>(null);
  // v1.97 / v2.83 (TASK-230): MIDI-Clock-Output.
  // v2.83-Refactor: Tick-Generierung läuft jetzt drift-frei in der AudioEngine
  // (AudioContext.currentTime-basiert) — useMidi wirkt nur noch als Sender-
  // Provider + UI-State. Der alte setInterval-Pfad wurde entfernt.
  const [clockOutEnabled, setClockOutEnabledState] = useState(() => loadClockOutEnabled());
  const [clockOutBpm, setClockOutBpmState] = useState(120);
  const [clockOutputDeviceId, setClockOutputDeviceIdState] = useState<string | null>(() => loadClockOutputId());
  const clockOutEnabledRef = useRef(false);
  const clockOutBpmRef = useRef(120);
  const clockOutputDeviceIdRef = useRef<string | null>(null);
  useEffect(() => { clockOutEnabledRef.current = clockOutEnabled; }, [clockOutEnabled]);
  useEffect(() => { clockOutBpmRef.current = clockOutBpm; }, [clockOutBpm]);
  useEffect(() => { clockOutputDeviceIdRef.current = clockOutputDeviceId; }, [clockOutputDeviceId]);

  // v3.35.0: External-Sync (MIDI-Clock-IN als Slave).
  const [clockInEnabled, setClockInEnabledState] = useState<boolean>(() => loadClockInEnabled());
  const [clockInStatus, setClockInStatus] = useState<MidiClockInStatus>("off");
  // v3.36.0: SPP-Display-Position für UI-Anzeige.
  const [clockInSpp, setClockInSpp] = useState<number | null>(null);
  const clockInRef = useRef<MidiClockIn>(new MidiClockIn());
  const clockInEnabledRef = useRef(false);
  useEffect(() => { clockInEnabledRef.current = clockInEnabled; }, [clockInEnabled]);

  // v2.84 (TASK-231): LED-Feedback-State + Scene-Mode.
  const [feedbackOutputDeviceId, setFeedbackOutputDeviceIdState] = useState<string | null>(() => loadFeedbackOutputId());
  const [feedbackEnabled, setFeedbackEnabledState] = useState<boolean>(() => loadFeedbackEnabled());
  const [feedbackSceneMode, setFeedbackSceneModeState] = useState<boolean>(() => loadFeedbackSceneMode());
  const feedbackOutputDeviceIdRef = useRef<string | null>(null);
  const feedbackEnabledRef = useRef(false);
  const feedbackSceneModeRef = useRef(false);
  const nanoFeedbackRef = useRef<NanoKontrolFeedback>(new NanoKontrolFeedback());
  useEffect(() => { feedbackOutputDeviceIdRef.current = feedbackOutputDeviceId; }, [feedbackOutputDeviceId]);
  useEffect(() => { feedbackEnabledRef.current = feedbackEnabled; }, [feedbackEnabled]);
  useEffect(() => { feedbackSceneModeRef.current = feedbackSceneMode; }, [feedbackSceneMode]);
  // Auto-Learn-Queue (v1.71)
  const [autoLearnQueue, setAutoLearnQueue] = useState<AutoLearnEntry[]>([]);
  const [autoLearnTotal, setAutoLearnTotal] = useState(0);
  const [autoLearnFilterChannel, setAutoLearnFilterChannelState] = useState(0);
  const autoLearnFilterChannelRef = useRef(0);
  useEffect(() => { autoLearnFilterChannelRef.current = autoLearnFilterChannel; }, [autoLearnFilterChannel]);

  const savedMappings = loadMappings();
  const [mappings, setMappings] = useState<MidiMapping[]>(savedMappings.cc);
  const [noteMappings, setNoteMappings] = useState<MidiNoteMapping[]>(savedMappings.notes);

  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const activeInputRef = useRef<MIDIInput | null>(null);
  const activeOutputRef = useRef<MIDIOutput | null>(null);
  const clockAnalyzer = useRef(new MidiClockAnalyzer());
  // v3.93.0: MIDI-FX Note-Off-Tracking. Mapped Original-Note → [expanded
  // outputs] (Chord-Expander/Octave-Shift). Bei Note-Off werden alle
  // gespeicherten Outputs released. Note-Repeat-Voices werden NICHT
  // getracked (siehe MidiFxNoteTracker.trackNoteOn-JSDoc).
  const midiFxTrackerRef = useRef<MidiFxNoteTracker>(new MidiFxNoteTracker());
  const learnRef = useRef<{ isLearning: boolean; target: MidiLearnTarget | null }>({
    isLearning: false,
    target: null,
  });
  const autoLearnRef = useRef<AutoLearnEntry[]>([]);
  // v2.7: device-change-Tracking für Toast-Notifications.
  // initializedRef = false bis nach dem ersten refreshDevices, dann true.
  // Vorherige Listen werden per Map<id, name+manufacturer> verglichen, damit
  // wir bei Connect/Disconnect Toasts emittieren — aber NICHT beim ersten
  // Laden (sonst flooded der User mit "X verbunden" für alle bereits
  // existierenden Geräte).
  const prevDevicesRef = useRef<Map<string, string>>(new Map());
  const prevOutputDevicesRef = useRef<Map<string, string>>(new Map());
  const devicesInitializedRef = useRef(false);

  // Refs für aktuelle Mappings (kein Re-Render-Overhead in MIDI-Handler)
  const mappingsRef = useRef(mappings);
  const noteMappingsRef = useRef(noteMappings);
  const clockSyncRef = useRef(clockSync);
  const midiOutEnabledRef = useRef(midiOutEnabled);
  const midiOutChannelRef = useRef(midiOutChannel);

  useEffect(() => { mappingsRef.current = mappings; }, [mappings]);
  useEffect(() => { midiOutEnabledRef.current = midiOutEnabled; }, [midiOutEnabled]);
  useEffect(() => { midiOutChannelRef.current = midiOutChannel; }, [midiOutChannel]);
  useEffect(() => { noteMappingsRef.current = noteMappings; }, [noteMappings]);
  useEffect(() => { clockSyncRef.current = clockSync; }, [clockSync]);

  // ─── MIDI-Nachricht verarbeiten ──────────────────────────────────────────

  const handleMidiMessage = useCallback((event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 1) return;

    const status = data[0];
    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1; // 1-16

    // v3.35.0: MIDI-Clock-IN External-Sync (Receiver-Klasse). Wenn aktiv,
    // schicken wir ALLE Real-Time-Messages an die Instance — sie kümmert sich
    // um BPM-EWMA + dispatched Events. Wir leiten den Tempo-Event hier in den
    // optionalen Callback weiter, falls Caller das nutzen möchten.
    if (clockInEnabledRef.current) {
      clockInRef.current.handleMidiMessage(data);
      // ausgewählte Status-Bytes wollen wir hier KOMPLETT konsumieren damit
      // sie nicht doppelt verarbeitet werden (z.B. alter clockSync-Pfad).
      if (status === 0xf8 || status === 0xfa || status === 0xfb || status === 0xfc) {
        return;
      }
    }

    // MIDI-Clock (alter Pfad, läuft parallel solange clockSync separat enabled).
    if (status === 0xf8) {
      if (clockSyncRef.current) {
        const bpm = clockAnalyzer.current.tick(event.timeStamp);
        if (bpm !== null && bpm > 20 && bpm < 300) {
          setExternalBpm(bpm);
          optionsRef.current.onClockBpm?.(bpm);
          optionsRef.current.onBpmChange?.(Math.round(bpm));
        }
      }
      return;
    }

    // MIDI-Start/Stop
    if (status === 0xfa || status === 0xfc) {
      optionsRef.current.onPlayStop?.();
      return;
    }

    if (data.length < 3) return;
    const byte1 = data[1];
    const byte2 = data[2];

    // Raw MIDI message für MPE-Verarbeitung weiterleiten
    window.dispatchEvent(new CustomEvent("midi:rawmessage", { detail: { type, channel, byte1, byte2 } }));

    // ── TASK-231 (v2.84): nanoKONTROL2 Marker → Scene-Cycle ──────────────
    // Vor jeglicher Mapping-Verarbeitung: wenn Scene-Mode aktiv und das
    // eingehende CC ist Marker-PREV/NEXT (CC 61/62, value>0), dann zur
    // vorigen/nächsten Scene wechseln. Nach erfolgreicher Behandlung
    // konsumieren wir das Event (return) — sonst würde ein eventuell
    // gelerntes Mapping auf derselben CC doppelt feuern.
    if (
      feedbackSceneModeRef.current &&
      type === 0xb0 &&
      byte2 > 0 &&
      (byte1 === NANO_KONTROL2.MARKER_PREV || byte1 === NANO_KONTROL2.MARKER_NEXT)
    ) {
      const dir: 1 | -1 = byte1 === NANO_KONTROL2.MARKER_NEXT ? 1 : -1;
      cycleScene(dir);
      return;
    }

    // MIDI-Learn-Modus: CC lernen
    if (learnRef.current.isLearning && learnRef.current.target) {
      if (type === 0xb0 && byte2 > 0) {
        const target = learnRef.current.target;
        const label = labelForTarget(target);
        const newMapping: MidiMapping = {
          cc: byte1,
          channel,
          target,
          label,
        };
        setMappings(prev => {
          const filtered = prev.filter(m => !(m.cc === byte1 && m.channel === channel));
          const next = [...filtered, newMapping];
          saveMappings(next, noteMappingsRef.current);
          return next;
        });
        learnRef.current = { isLearning: false, target: null };
        setIsLearning(false);
        setLearnTarget(null);
        return;
      }
    }

    // Auto-Learn (v1.71 CC, v1.72 + Note): pure helper berechnet die
    // Queue-Transition + ggf. das Mapping. Hier schreiben wir nur in den
    // State und persistieren.
    if (autoLearnRef.current.length > 0) {
      const result = nextAutoLearnEntry(
        autoLearnRef.current,
        { type, byte1, byte2, channel },
        autoLearnFilterChannelRef.current,
      );
      if (result.ccMapping) {
        const m = result.ccMapping;
        setMappings(prev => {
          const filtered = prev.filter(x => !(x.cc === m.cc && x.channel === m.channel));
          const next = [...filtered, m];
          saveMappings(next, noteMappingsRef.current);
          return next;
        });
      }
      if (result.noteMapping) {
        const m = result.noteMapping;
        setNoteMappings(prev => {
          const filtered = prev.filter(x => !(x.note === m.note && x.channel === m.channel));
          const next = [...filtered, m];
          saveMappings(mappingsRef.current, next);
          return next;
        });
      }
      if (result.ccMapping || result.noteMapping) {
        autoLearnRef.current = result.newQueue;
        setAutoLearnQueue(result.newQueue);
        if (result.newQueue.length === 0) setAutoLearnTotal(0);
        return;
      }
    }

    // Note-On
    if (type === 0x90 && byte2 > 0) {
      // v3.92.0: MIDI-FX Routing — Transform-Layer vor der Engine.
      // Chord-Expander/Note-Repeat können 1 Event in mehrere expanden;
      // Scale-Snap/Velocity-Curve/Octave-Shift transformieren in-place.
      // v3.93.0: Note-Off-Tracking — Original-Note → [Expanded Outputs] wird
      // im MidiFxNoteTracker gespeichert damit das spätere Note-Off alle
      // expandierten Voices released (siehe Note-Off-Block unten).
      const fxChain = getMidiFxChain();
      let fxEvents: NoteOn[];
      if (fxChain.length > 0) {
        fxEvents = applyMidiFx({ note: byte1, velocity: byte2, channel }, fxChain);
        // Tracker speichert nur t=0-Events ≠ Original (Chord-Expander/Octave-
        // Shift). Note-Repeat-Tail wird ignoriert (eigener Release).
        midiFxTrackerRef.current.trackNoteOn(byte1, channel, fxEvents);
      } else {
        fxEvents = [{ note: byte1, velocity: byte2, channel }];
      }

      // Chord Memory: wenn aktiv, für alle Akkord-Noten onNoteOn auslösen
      const chordState = getChordMemoryState();
      if (chordState.enabled) {
        // Chord Memory wirkt auf das ERSTE FX-Event (typischer Use-Case: Spieler
        // drückt eine Taste → ChordMem expanded sie). Folge-FX-Events
        // (Note-Repeat / Chord-Expander) behalten ihre Note.
        const first = fxEvents[0];
        const rest = fxEvents.slice(1);
        const chordNotes = buildChordNotes(first.note, chordState);
        const scheduleNote = (n: number, v: number, ch: number, offsetMs: number): void => {
          const dispatch = (): void => {
            optionsRef.current.onNoteOn?.(n, v, ch);
            const out = activeOutputRef.current;
            if (out && midiOutEnabledRef.current) {
              const ch2 = Math.max(0, midiOutChannelRef.current - 1) & 0x0f;
              out.send([0x90 | ch2, n & 0x7f, v & 0x7f]);
            }
          };
          if (offsetMs > 0) {
            setTimeout(dispatch, offsetMs);
          } else {
            dispatch();
          }
        };
        chordNotes.forEach(n => scheduleNote(n, first.velocity, first.channel, first.timeOffsetMs ?? 0));
        rest.forEach(ev => scheduleNote(ev.note, ev.velocity, ev.channel, ev.timeOffsetMs ?? 0));
      } else {
        // Direkte Dispatch-Schleife — jedes FX-Event landet bei onNoteOn.
        // timeOffsetMs (von Note-Repeat) wird via setTimeout angewendet.
        fxEvents.forEach((ev) => {
          const offset = ev.timeOffsetMs ?? 0;
          const dispatch = (): void => {
            optionsRef.current.onNoteOn?.(ev.note, ev.velocity, ev.channel);
          };
          if (offset > 0) {
            setTimeout(dispatch, offset);
          } else {
            dispatch();
          }
        });
        // MIDI Step Input Event nutzt das Original-Event (Pre-FX), damit
        // Step-Input-Aufnahme unverändert bleibt.
        window.dispatchEvent(new CustomEvent("stepinput:noteon", { detail: { note: byte1, velocity: byte2 } }));
        // v3.97.0: MIDI-Step-Recorder — eigener Event-Pfad für den
        // Auto-Advance-Recorder (siehe useMidiStepRecorderStore). App.tsx
        // listet diesen Event und schreibt direkt in den armed Channel.
        window.dispatchEvent(new CustomEvent("midi:stepRecorder", { detail: { note: byte1, velocity: byte2, channel } }));
      }
      // Note-Mapping → applyMapping(target) | Perf-Pad | Part-Trigger
      // Precedence (v2.79): target > performancePadIndex > partId
      const nm = noteMappingsRef.current.find(
        m => m.note === byte1 && (m.channel === 0 || m.channel === channel)
      );
      if (nm) {
        if (nm.target !== undefined) {
          // v2.79: voller applyMapping-Pfad — Chain/Script/Macro/etc.
          // Note-On wird wie ein CC-Wert > 63 behandelt (on=true), velocity
          // wird als value durchgereicht damit z.B. macro-Targets sie als
          // Modulations-Amount verwenden können.
          applyMapping(
            { cc: -1, channel: nm.channel, target: nm.target, label: nm.label },
            byte2,
          );
        } else if (nm.performancePadIndex !== undefined) {
          // v2.78: Perf-Pad-Trigger via CustomEvent (analog zu midi:scene)
          window.dispatchEvent(new CustomEvent("midi:perfpad", {
            detail: { padIndex: nm.performancePadIndex, velocity: byte2 },
          }));
        } else {
          optionsRef.current.onPartTrigger?.(nm.partId, byte2);
        }
      }
    }

    // Note-Off
    if (type === 0x80 || (type === 0x90 && byte2 === 0)) {
      // v3.93.0: Wenn der Tracker eine Expansion für diese Original-Note
      // gespeichert hat, alle expandierten Outputs released. Sonst Original-
      // Note-Off direkt durchreichen (kein FX-Match → kein Routing).
      const expanded = midiFxTrackerRef.current.consumeNoteOff(byte1, channel);
      if (expanded.length > 0) {
        for (const off of expanded) {
          optionsRef.current.onNoteOff?.(off.note, off.channel);
          // MIDI-Out-Echo für expandierte Off-Events (nur wenn aktiv).
          const out = activeOutputRef.current;
          if (out && midiOutEnabledRef.current) {
            const ch2 = Math.max(0, midiOutChannelRef.current - 1) & 0x0f;
            try {
              out.send([0x80 | ch2, off.note & 0x7f, 0]);
            } catch {
              /* swallow */
            }
          }
        }
      } else {
        optionsRef.current.onNoteOff?.(byte1, channel);
      }
    }

    // CC-Nachrichten
    if (type === 0xb0) {
      optionsRef.current.onCc?.(byte1, byte2, channel);
      // CC-Mapping verarbeiten
      const mapping = mappingsRef.current.find(
        m => m.cc === byte1 && (m.channel === 0 || m.channel === channel)
      );
      if (mapping) {
        applyMapping(mapping, byte2);
      }
    }
  }, []);

  // Hilfsfunktion: dispatcht ein kb:action CustomEvent (wiederverwendet Keyboard-System)
  function dispatchAction(actionId: string) {
    window.dispatchEvent(new CustomEvent("kb:action", { detail: actionId }));
  }

  function applyMapping(mapping: MidiMapping, value: number) {
    const opts = optionsRef.current;
    const t = mapping.target;
    const on = value > 63; // Schwellwert für Button-artige Targets

    switch (t.type) {
      // ── Transport ──────────────────────────────────────────────────────────
      case "bpm": {
        const bpm = Math.round(60 + (value / 127) * 140);
        opts.onBpmChange?.(bpm);
        break;
      }
      case "masterVolume": {
        window.dispatchEvent(new CustomEvent("midi:masterVolume", { detail: value / 127 }));
        break;
      }
      case "playStop":        if (on) opts.onPlayStop?.(); break;
      case "record":          if (on) dispatchAction("record"); break;
      case "tapTempo":        if (on) dispatchAction("tap-tempo"); break;
      case "bpmUp":           if (on) dispatchAction("bpm-up"); break;
      case "bpmDown":         if (on) dispatchAction("bpm-down"); break;
      // ── Parts ──────────────────────────────────────────────────────────────
      case "volume": {
        window.dispatchEvent(new CustomEvent("midi:partVolume", { detail: { partId: t.partId, value: value / 127 } }));
        break;
      }
      case "pan": {
        window.dispatchEvent(new CustomEvent("midi:partPan", { detail: { partId: t.partId, value: (value / 127) * 2 - 1 } }));
        break;
      }
      case "mute":   if (on) {
        // v1.76: zusätzlich CustomEvent damit App.tsx ohne `onMute`-Prop hört
        window.dispatchEvent(new CustomEvent("midi:partMute", { detail: t.partId }));
        opts.onMute?.(t.partId);
      } break;
      case "solo":   if (on) window.dispatchEvent(new CustomEvent("midi:partSolo", { detail: t.partId })); break;
      case "fxParam": {
        // v1.76: jeder numerische FX-Parameter (Filter/EQ/Reverb/Delay/…)
        // MIDI 0-127 → param-spezifischer Range über midiValueToFxParam.
        const range = findFxParamRange(t.param);
        if (range) {
          const scaled = midiValueToFxParam(value, range);
          window.dispatchEvent(new CustomEvent("midi:fxParam", {
            detail: { partId: t.partId, param: t.param, value: scaled },
          }));
        }
        break;
      }
      case "send": {
        // v2.1: Send-Bus-Level (Reverb/Delay) pro Channel
        window.dispatchEvent(new CustomEvent("midi:partSend", {
          detail: { partId: t.partId, bus: t.bus, value: value / 127 },
        }));
        break;
      }
      case "partUp":   if (on) dispatchAction("part-up"); break;
      case "partDown": if (on) dispatchAction("part-down"); break;
      case "step": if (on) {
        // v1.99: pad-press → toggle a specific step in the active pattern.
        // Super-mächtig für Live-Finger-Drumming auf physischen Pads.
        window.dispatchEvent(new CustomEvent("midi:toggleStep", {
          detail: { partId: t.partId, stepIndex: t.stepIndex },
        }));
      } break;
      // ── Pattern ─────────────────────────────────────────────────────────────
      case "pattern":          if (on) window.dispatchEvent(new CustomEvent("midi:pattern", { detail: t.patternIndex })); break;
      case "patternNext":      if (on) dispatchAction("pattern-next"); break;
      case "patternPrev":      if (on) dispatchAction("pattern-prev"); break;
      case "patternClear":     if (on) dispatchAction("pattern-clear"); break;
      case "patternFill":      if (on) dispatchAction("pattern-fill"); break;
      case "patternRandomize": if (on) dispatchAction("pattern-randomize"); break;
      case "patternDuplicate": if (on) dispatchAction("pattern-duplicate"); break;
      // ── Navigation ─────────────────────────────────────────────────────────
      case "tab":         if (on) dispatchAction(`tab-${t.tabId}`); break;
      // ── Performance ────────────────────────────────────────────────────────
      case "toggleNoteRepeat": if (on) dispatchAction("toggle-note-repeat"); break;
      case "toggleMorph":      if (on) dispatchAction("toggle-morph"); break;
      case "commitLiveEdit":   if (on) window.dispatchEvent(new CustomEvent("midi:commitLiveEdit")); break;
      case "scenelaunch":      if (on) window.dispatchEvent(new CustomEvent("midi:scene", { detail: t.sceneIndex })); break;
      case "openSettings":     if (on) window.dispatchEvent(new CustomEvent("kb:action", { detail: "open-settings" })); break;
      case "macro": {
        // v1.88: direktes Steuern eines Makro-Wertes 0..1 via CC
        window.dispatchEvent(new CustomEvent("midi:macroValue", {
          detail: { index: t.index, value: value / 127 },
        }));
        break;
      }
      case "runScript": if (on) {
        // v1.78: User-Script auf MIDI-Trigger ausführen. App.tsx hört und
        // ruft scriptSandbox.run() auf. ScriptId wird im detail mitgegeben.
        window.dispatchEvent(new CustomEvent("midi:runScript", { detail: t.scriptId }));
      } break;
      case "chain": {
        // v1.77: Function-Chains — auf 'on' (CC>63 oder Note) eine Folge von
        // Sub-Targets der Reihe nach feuern, optional mit delayMs zwischen
        // den Schritten. Wir bauen aus planChainExecution eine Trigger-Liste
        // und scheduken sie via setTimeout. Side-effects via applyMapping
        // rekursiv (Sub-Target → applyMapping → korrekte Action).
        if (!on) break;
        const plan = planChainExecution(t.steps);
        for (const tr of plan.triggers) {
          const fire = () => applyMapping({ cc: 0, channel: 0, target: tr.target, label: "" }, tr.value);
          if (tr.atMs <= 0) fire();
          else setTimeout(fire, tr.atMs);
        }
        break;
      }
      case "loopTrigger": if (on) {
        // v2.87 (TASK-235): Live-Looper Trigger via Pad/Footswitch.
        window.dispatchEvent(new CustomEvent("midi:loopTrigger", { detail: t.loopIndex }));
      } break;
      case "loopErase": if (on) {
        // v2.87 (TASK-235): Loop-Erase via dedizierter MIDI-Action.
        window.dispatchEvent(new CustomEvent("midi:loopErase", { detail: t.loopIndex }));
      } break;
      case "playSlicePad": if (on) {
        // v2.91 (TASK-238-FOLLOWUP-1B): Slice-Pad-Trigger. App.tsx liest
        // useSlicePadStore und ruft AudioEngine.playSliceBuffer.
        window.dispatchEvent(new CustomEvent("midi:slicePad", { detail: t.sliceIndex }));
      } break;
      // ── Sub-Mix-Bus (v3.81.0) ────────────────────────────────────────────
      case "subMixBusVolume": {
        // 0..127 → 0..2 (Bus-Volume-Range, vgl. useSubMixStore clampNum).
        window.dispatchEvent(new CustomEvent("midi:subMixBusVolume", {
          detail: { busId: t.busId, value: (value / 127) * 2 },
        }));
        break;
      }
      case "subMixBusPan": {
        window.dispatchEvent(new CustomEvent("midi:subMixBusPan", {
          detail: { busId: t.busId, value: (value / 127) * 2 - 1 },
        }));
        break;
      }
      case "subMixBusMute": if (on) {
        window.dispatchEvent(new CustomEvent("midi:subMixBusMute", { detail: t.busId }));
      } break;
      case "subMixBusSolo": if (on) {
        window.dispatchEvent(new CustomEvent("midi:subMixBusSolo", { detail: t.busId }));
      } break;
      // ── Sub-Mix-Bus FX (v3.87.0) ─────────────────────────────────────────
      case "subMixBusEqLowGain": {
        // 0..127 → -24..+24 dB (linear)
        window.dispatchEvent(new CustomEvent("midi:subMixBusEqLowGain", {
          detail: { busId: t.busId, value: (value / 127) * 48 - 24 },
        }));
        break;
      }
      case "subMixBusEqMidGain": {
        window.dispatchEvent(new CustomEvent("midi:subMixBusEqMidGain", {
          detail: { busId: t.busId, value: (value / 127) * 48 - 24 },
        }));
        break;
      }
      case "subMixBusEqHighGain": {
        window.dispatchEvent(new CustomEvent("midi:subMixBusEqHighGain", {
          detail: { busId: t.busId, value: (value / 127) * 48 - 24 },
        }));
        break;
      }
      case "subMixBusCompThreshold": {
        // 0..127 → -60..0 dB
        window.dispatchEvent(new CustomEvent("midi:subMixBusCompThreshold", {
          detail: { busId: t.busId, value: (value / 127) * 60 - 60 },
        }));
        break;
      }
      case "subMixBusCompRatio": {
        // 0..127 → 1..20
        window.dispatchEvent(new CustomEvent("midi:subMixBusCompRatio", {
          detail: { busId: t.busId, value: 1 + (value / 127) * 19 },
        }));
        break;
      }
      case "subMixBusReverbSend": {
        // 0..127 → 0..1
        window.dispatchEvent(new CustomEvent("midi:subMixBusReverbSend", {
          detail: { busId: t.busId, value: value / 127 },
        }));
        break;
      }
      case "subMixBusDelaySend": {
        window.dispatchEvent(new CustomEvent("midi:subMixBusDelaySend", {
          detail: { busId: t.busId, value: value / 127 },
        }));
        break;
      }
    }
  }


  // ─── Gerät verbinden ──────────────────────────────────────────────────────

  const connectDevice = useCallback((deviceId: string | null) => {
    // Altes Input-Listener entfernen
    if (activeInputRef.current) {
      activeInputRef.current.onmidimessage = null;
      activeInputRef.current = null;
    }

    if (!deviceId || !midiAccessRef.current) return;

    const input = midiAccessRef.current.inputs.get(deviceId);
    if (input) {
      input.onmidimessage = handleMidiMessage;
      activeInputRef.current = input;
    }
  }, [handleMidiMessage]);

  // ─── Geräte-Liste aktualisieren ──────────────────────────────────────────

  const refreshDevices = useCallback(() => {
    if (!midiAccessRef.current) return;
    const list: MidiDevice[] = [];
    midiAccessRef.current.inputs.forEach(input => {
      list.push({
        id: input.id,
        name: input.name ?? "Unbekanntes Gerät",
        manufacturer: input.manufacturer ?? "",
        state: input.state as "connected" | "disconnected",
      });
    });
    setDevices(list);

    // Output-Geräte
    const outList: MidiDevice[] = [];
    midiAccessRef.current.outputs.forEach(output => {
      outList.push({
        id: output.id,
        name: output.name ?? "Unbekannter Ausgang",
        manufacturer: output.manufacturer ?? "",
        state: output.state as "connected" | "disconnected",
      });
    });
    setOutputDevices(outList);

    // v2.7: Diff-Toast für Connect/Disconnect — überspringt den ersten Refresh
    // damit der User beim Aktivieren nicht mit "X verbunden" pro existierendem
    // Gerät überflutet wird.
    if (devicesInitializedRef.current) {
      const currentInIds = new Set(list.map(d => d.id));
      const currentOutIds = new Set(outList.map(d => d.id));
      // v3.24.0: Sammle neu verbundene Devices für Auto-Detection-Suggestion.
      const newlyConnected: string[] = [];
      // Inputs: new (added) vs removed
      list.forEach(d => {
        if (!prevDevicesRef.current.has(d.id)) {
          toast(`MIDI verbunden: ${d.name}${d.manufacturer ? ` (${d.manufacturer})` : ""}`, { kind: "success" });
          newlyConnected.push(d.name);
        }
      });
      // v3.24.0: Fire-and-forget Auto-Detection — UI-Layer (MidiSettings)
      // hört auf 'midi:template-suggested' und zeigt die Suggestion-Banner.
      // Never-List + Disabled-Toggle werden im dispatchTemplateSuggestion
      // geprüft → kein Spam wenn User "Nie wieder" gewählt hat.
      if (newlyConnected.length > 0) {
        const neverList = loadNeverList();
        detectTemplatesFromDeviceList(newlyConnected, neverList).forEach(match => {
          dispatchTemplateSuggestion(match);
        });
      }
      prevDevicesRef.current.forEach((name, id) => {
        if (!currentInIds.has(id)) {
          toast(`MIDI getrennt: ${name}`, { kind: "warning" });
        }
      });
      // Outputs gleich
      outList.forEach(d => {
        if (!prevOutputDevicesRef.current.has(d.id)) {
          toast(`MIDI-Out verbunden: ${d.name}`, { kind: "info" });
        }
      });
      prevOutputDevicesRef.current.forEach((name, id) => {
        if (!currentOutIds.has(id)) {
          toast(`MIDI-Out getrennt: ${name}`, { kind: "warning" });
        }
      });
    } else {
      devicesInitializedRef.current = true;
      // v3.24.0: Auch beim allerersten Refresh wollen wir Hardware
      // erkennen die schon beim Aktivieren angeschlossen war. Kein Toast,
      // aber Suggestion-Event feuert (Never-List + Toggle gating sorgt
      // dafür dass User nicht genervt wird).
      if (list.length > 0) {
        const neverList = loadNeverList();
        detectTemplatesFromDeviceList(list.map(d => d.name), neverList).forEach(match => {
          dispatchTemplateSuggestion(match);
        });
      }
    }
    // Update refs für nächstes Diff
    prevDevicesRef.current = new Map(list.map(d => [d.id, d.name]));
    prevOutputDevicesRef.current = new Map(outList.map(d => [d.id, d.name]));

    // v1.84: Auto-Reconnect zum zuletzt benutzten Gerät — anhand des Namens
    // (id wechselt zwischen Sessions). Wenn keiner gespeichert, fallback aufs
    // erste verfügbare Gerät.
    const persisted = loadActiveDevice();
    setActiveDeviceId(prev => {
      if (prev && list.find(d => d.id === prev)) {
        connectDevice(prev);
        return prev;
      }
      if (persisted.input && list.length > 0) {
        const match = list.find(d =>
          d.name === persisted.input!.name &&
          d.manufacturer === persisted.input!.manufacturer
        );
        if (match) {
          connectDevice(match.id);
          return match.id;
        }
      }
      if (list.length > 0 && !prev) {
        const firstId = list[0].id;
        connectDevice(firstId);
        return firstId;
      }
      return prev;
    });
    // Auch Output-Device auto-reconnect
    setActiveOutputDeviceId(prev => {
      if (prev && outList.find(d => d.id === prev)) {
        const output = midiAccessRef.current?.outputs.get(prev);
        activeOutputRef.current = output ?? null;
        return prev;
      }
      if (persisted.output && outList.length > 0) {
        const match = outList.find(d =>
          d.name === persisted.output!.name &&
          d.manufacturer === persisted.output!.manufacturer
        );
        if (match) {
          const output = midiAccessRef.current?.outputs.get(match.id);
          activeOutputRef.current = output ?? null;
          return match.id;
        }
      }
      return prev;
    });
  }, [connectDevice]);

  // ─── MIDI aktivieren ─────────────────────────────────────────────────────

  const enable = useCallback(async () => {
    if (!navigator.requestMIDIAccess) {
      console.warn("[MIDI] Web MIDI API nicht verfügbar");
      toast("Web MIDI API nicht verfügbar — Chrome/Edge empfohlen", { kind: "error", duration: 5000 });
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      midiAccessRef.current = access;
      access.onstatechange = () => refreshDevices();
      setIsEnabled(true);
      setIsAvailable(true);
      // v2.7: ersten Refresh OHNE Toast-Spam (devicesInitializedRef sorgt dafür)
      refreshDevices();
      toast("MIDI aktiviert", { kind: "success" });
    } catch (err) {
      console.error("[MIDI] Zugriff verweigert:", err);
      const msg = err instanceof Error ? err.message : String(err);
      toast(`MIDI-Zugriff verweigert: ${msg}`, { kind: "error", duration: 5000 });
    }
  }, [refreshDevices]);

  // ─── MIDI deaktivieren ───────────────────────────────────────────────────

  const disable = useCallback(() => {
    if (activeInputRef.current) {
      activeInputRef.current.onmidimessage = null;
      activeInputRef.current = null;
    }
    midiAccessRef.current = null;
    setIsEnabled(false);
    setDevices([]);
    setActiveDeviceId(null);
    clockAnalyzer.current.reset();
    // v2.7: Tracking-Refs reseten — beim nächsten enable() wieder bei Null starten
    devicesInitializedRef.current = false;
    prevDevicesRef.current.clear();
    prevOutputDevicesRef.current.clear();
    toast("MIDI deaktiviert", { kind: "info" });
  }, []);

  // ─── Verfügbarkeit prüfen ────────────────────────────────────────────────

  useEffect(() => {
    setIsAvailable(!!navigator.requestMIDIAccess);
  }, []);

  // ─── MIDI-Clock-Out → AudioEngine wiring (TASK-230 / v2.83) ─────────────
  // Wir injizieren in AudioEngine einen Sender-Callback, der bei jedem Tick
  // bzw. Start/Stop/Continue die Bytes ans gewählte Output-Device (oder
  // Fallback: activeOutputDeviceId) sendet. Wenn das Device nicht existiert
  // (oder access null), no-op. Damit gibt es nur EINEN Code-Pfad — Web MIDI,
  // sowohl im Browser als auch in Electron-Chromium.
  useEffect(() => {
    const sender = (bytes: number[]) => {
      const targetId =
        clockOutputDeviceIdRef.current ?? activeOutputDeviceId ?? null;
      if (!targetId) return;
      midiSendMessage(
        midiAccessRef.current as MidiAccessLike | null,
        targetId,
        bytes,
      );
    };
    AudioEngine.setMidiClockOutSender(sender);
    AudioEngine.setMidiClockOutEnabled(clockOutEnabled);
    return () => {
      // Cleanup: Sender entkoppeln. Behält 'enabled'-State, aber ohne Sender
      // gehen Messages ins Nichts — kein Crash bei Hot-Reload.
      AudioEngine.setMidiClockOutSender(null);
    };
    // Reagiert auf: enabled-Wechsel, Output-Device-Wechsel, Clock-Routing-Wechsel.
  }, [clockOutEnabled, clockOutputDeviceId, activeOutputDeviceId]);

  // ─── MIDI-Note-Out → AudioEngine wiring (TASK-240 / v2.92) ──────────────
  // Sender löst die outputId pro Send auf — damit kann ein einziger Sender
  // alle Per-Part-Configs bedienen (verschiedene Parts können auf verschiedene
  // Geräte geroutet werden — z.B. Kick auf Electribe, Snare auf Volca).
  // Configs werden vom App.tsx-Listener aus useMidiNoteOutStore in die Engine
  // gepusht — wir kümmern uns hier nur ums Senden.
  useEffect(() => {
    const sender = (outputId: string, bytes: number[]) => {
      midiSendMessage(
        midiAccessRef.current as MidiAccessLike | null,
        outputId,
        bytes,
      );
    };
    AudioEngine.setMidiNoteOutSender(sender);
    return () => {
      AudioEngine.setMidiNoteOutSender(null);
    };
  }, []);

  // ─── MIDI-Click-Out → AudioEngine wiring (v3.98.0) ──────────────────────
  // Analog zu MidiNoteOut: Sender bekommt outputId + Bytes, leitet via
  // midiSendMessage an die Web-MIDI-API weiter. Config (enabled, outputId,
  // channel, notes, velocities) wird vom App.tsx-Listener aus
  // useMidiClickStore in die Engine gepusht.
  useEffect(() => {
    const sender = (outputId: string, bytes: number[]) => {
      midiSendMessage(
        midiAccessRef.current as MidiAccessLike | null,
        outputId,
        bytes,
      );
    };
    AudioEngine.setMidiClickOutSender(sender);
    return () => {
      AudioEngine.setMidiClickOutSender(null);
    };
  }, []);

  // ─── TASK-231 (v2.84): LED-Feedback Sender-Wiring ────────────────────────
  // Bei Device/Enable-Wechsel den Sender im NanoKontrolFeedback aktualisieren.
  // Wenn enabled=true und Output verfügbar → sender = midiSendMessage-Lambda.
  // Wenn enabled=false → sender = null (allLedsOff wird intern getriggert).
  useEffect(() => {
    const fb = nanoFeedbackRef.current;
    if (feedbackEnabled && feedbackOutputDeviceId) {
      fb.setSender((bytes) => {
        midiSendMessage(
          midiAccessRef.current as MidiAccessLike | null,
          feedbackOutputDeviceIdRef.current,
          bytes,
        );
      });
      fb.setEnabled(true);
    } else {
      // Vor dem Disable: alle LEDs explizit ausschalten (sofern Sender steht).
      fb.setEnabled(false);
      fb.setSender(null);
    }
  }, [feedbackEnabled, feedbackOutputDeviceId]);

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (activeInputRef.current) {
        activeInputRef.current.onmidimessage = null;
      }
    };
  }, []);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const setActiveDevice = useCallback((id: string | null) => {
    setActiveDeviceId(id);
    connectDevice(id);
    // v1.84: Persistenz für Auto-Reconnect nach Reload
    const persisted = loadActiveDevice();
    if (id === null) {
      saveActiveDevice({ ...persisted, input: undefined });
    } else {
      const dev = devices.find(d => d.id === id);
      if (dev) {
        saveActiveDevice({ ...persisted, input: { name: dev.name, manufacturer: dev.manufacturer } });
      }
    }
  }, [connectDevice, devices]);

  // ─── MIDI Out Actions ────────────────────────────────────────────────────

  const setActiveOutputDevice = useCallback((id: string | null) => {
    setActiveOutputDeviceId(id);
    if (!id || !midiAccessRef.current) { activeOutputRef.current = null; return; }
    const output = midiAccessRef.current.outputs.get(id);
    activeOutputRef.current = output ?? null;
    // v1.84: Persistenz auch für Output-Device
    const persisted = loadActiveDevice();
    if (id === null) {
      saveActiveDevice({ ...persisted, output: undefined });
    } else {
      const dev = outputDevices.find(d => d.id === id);
      if (dev) {
        saveActiveDevice({ ...persisted, output: { name: dev.name, manufacturer: dev.manufacturer } });
      }
    }
  }, [outputDevices]);

  const setMidiOutEnabled = useCallback((enabled: boolean) => {
    setMidiOutEnabledState(enabled);
  }, []);

  const setMidiOutChannel = useCallback((ch: number) => {
    setMidiOutChannelState(Math.max(1, Math.min(16, ch)));
  }, []);

  const sendNoteOn = useCallback((note: number, velocity: number, channel?: number) => {
    const out = activeOutputRef.current;
    if (!out || !midiOutEnabled) return;
    const ch = Math.max(0, ((channel ?? midiOutChannel) - 1)) & 0x0f;
    out.send([0x90 | ch, note & 0x7f, velocity & 0x7f]);
  }, [midiOutEnabled, midiOutChannel]);

  const sendNoteOff = useCallback((note: number, channel?: number) => {
    const out = activeOutputRef.current;
    if (!out || !midiOutEnabled) return;
    const ch = Math.max(0, ((channel ?? midiOutChannel) - 1)) & 0x0f;
    out.send([0x80 | ch, note & 0x7f, 0]);
  }, [midiOutEnabled, midiOutChannel]);

  const sendCC = useCallback((cc: number, value: number, channel?: number) => {
    const out = activeOutputRef.current;
    if (!out || !midiOutEnabled) return;
    const ch = Math.max(0, ((channel ?? midiOutChannel) - 1)) & 0x0f;
    out.send([0xb0 | ch, cc & 0x7f, value & 0x7f]);
  }, [midiOutEnabled, midiOutChannel]);

  const startLearn = useCallback((target: MidiLearnTarget) => {
    learnRef.current = { isLearning: true, target };
    setIsLearning(true);
    setLearnTarget(target);
  }, []);

  const cancelLearn = useCallback(() => {
    learnRef.current = { isLearning: false, target: null };
    setIsLearning(false);
    setLearnTarget(null);
  }, []);

  // ─── Auto-Learn (v1.71 CC, v1.72 + Note) ────────────────────────────────
  const startAutoLearn = useCallback((entries: AutoLearnEntry[]) => {
    if (!entries || entries.length === 0) return;
    autoLearnRef.current = [...entries];
    setAutoLearnQueue([...entries]);
    setAutoLearnTotal(entries.length);
    // Single-Learn-Modus ausräumen damit beide nicht kollidieren
    learnRef.current = { isLearning: false, target: null };
    setIsLearning(false);
    setLearnTarget(null);
  }, []);

  const skipAutoLearnTarget = useCallback(() => {
    if (autoLearnRef.current.length === 0) return;
    const rest = autoLearnRef.current.slice(1);
    autoLearnRef.current = rest;
    setAutoLearnQueue(rest);
    if (rest.length === 0) setAutoLearnTotal(0);
  }, []);

  const cancelAutoLearn = useCallback(() => {
    autoLearnRef.current = [];
    setAutoLearnQueue([]);
    setAutoLearnTotal(0);
  }, []);

  const setAutoLearnFilterChannel = useCallback((ch: number) => {
    const clamped = Math.max(0, Math.min(16, Math.floor(ch)));
    setAutoLearnFilterChannelState(clamped);
  }, []);

  const removeMapping = useCallback((cc: number, channel: number) => {
    setMappings(prev => {
      const next = prev.filter(m => !(m.cc === cc && m.channel === channel));
      saveMappings(next, noteMappingsRef.current);
      return next;
    });
  }, []);

  const addNoteMapping = useCallback((note: number, channel: number, partId: string, label: string) => {
    setNoteMappings(prev => {
      const filtered = prev.filter(m => !(m.note === note && m.channel === channel));
      const next = [...filtered, { note, channel, partId, label }];
      saveMappings(mappingsRef.current, next);
      return next;
    });
  }, []);

  const removeNoteMapping = useCallback((note: number, channel: number) => {
    setNoteMappings(prev => {
      const next = prev.filter(m => !(m.note === note && m.channel === channel));
      saveMappings(mappingsRef.current, next);
      return next;
    });
  }, []);

  const setClockSync = useCallback((enabled: boolean) => {
    setClockSyncState(enabled);
    if (!enabled) {
      clockAnalyzer.current.reset();
      setExternalBpm(null);
    }
  }, []);

  const clearAllMappings = useCallback(() => {
    setMappings([]);
    setNoteMappings([]);
    saveMappings([], []);
  }, []);

  // v1.97 / v2.83 (TASK-230): MIDI-Clock-Output Actions.
  // Start/Stop/Continue-Bytes werden jetzt von AudioEngine.start/stop selbst
  // gesendet — wir setzen hier nur den Enable-Flag + persistieren.
  const setClockOutEnabled = useCallback((enabled: boolean) => {
    setClockOutEnabledState(enabled);
    saveClockOutEnabled(enabled);
    AudioEngine.setMidiClockOutEnabled(enabled);
  }, []);

  const setClockOutBpm = useCallback((bpm: number) => {
    const clamped = Math.max(20, Math.min(300, bpm));
    setClockOutBpmState(clamped);
  }, []);

  /**
   * v2.83 (TASK-230): explizite Clock-Out-Device-Wahl. null = fallback auf
   * activeOutputDeviceId (Backwards-Compat zu v2.82).
   */
  const setClockOutputDeviceId = useCallback((id: string | null) => {
    setClockOutputDeviceIdState(id);
    saveClockOutputId(id);
  }, []);

  // ── TASK-231 (v2.84): LED-Feedback-Actions ─────────────────────────────
  const setFeedbackOutputDeviceId = useCallback((id: string | null) => {
    setFeedbackOutputDeviceIdState(id);
    saveFeedbackOutputId(id);
  }, []);

  const setFeedbackEnabled = useCallback((enabled: boolean) => {
    setFeedbackEnabledState(enabled);
    saveFeedbackEnabled(enabled);
  }, []);

  const setFeedbackSceneMode = useCallback((enabled: boolean) => {
    setFeedbackSceneModeState(enabled);
    saveFeedbackSceneMode(enabled);
  }, []);

  // ── v3.35.0: External-Sync (MIDI-Clock-IN) ───────────────────────────────
  const setClockInEnabled = useCallback((enabled: boolean) => {
    setClockInEnabledState(enabled);
    saveClockInEnabled(enabled);
    if (enabled) {
      clockInRef.current.enable();
    } else {
      clockInRef.current.disable();
      setExternalBpm(null);
      setClockInSpp(null);
    }
    // AudioEngine-Side: setBpm() blockieren wenn aktiv. Damit ignoriert die
    // Engine UI-Slider-Inputs solange Master die Führung hat.
    AudioEngine.setExternalSyncActive(enabled);
  }, []);

  // Bei Enable: globalen Listener für tempo/start/stop/spp installieren. Wir
  // konsumieren die CustomEvents die MidiClockIn auf window dispatched —
  // damit kommt App.tsx ohne extra Subscription aus, falls es nur die
  // klassischen onBpmChange/onPlayStop-Callbacks nutzt.
  //
  // v3.36.0: SPP-driven Pattern-Seek. Bei `midiclockin:spp` (nur wenn
  // Transport NICHT running — die Klasse filtert das selbst) rufen wir
  // AudioEngine.seekToStep(positionStep). Beim nachfolgenden 0xFA Start
  // schiebt der Event-Detail ebenfalls den positionStep mit — wir seeken
  // unmittelbar bevor wir den Play-Callback feuern, damit App.tsx bei
  // play() ab der korrekten Position startet.
  useEffect(() => {
    if (!clockInEnabled) return;
    const onTempo = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { bpm: number } | undefined;
      if (!detail || typeof detail.bpm !== "number") return;
      setExternalBpm(detail.bpm);
      // Direkter Pfad in AudioEngine (umgeht setBpm-Block).
      AudioEngine.applyExternalBpm(detail.bpm);
      optionsRef.current.onClockBpm?.(detail.bpm);
      optionsRef.current.onBpmChange?.(Math.round(detail.bpm));
    };
    const onStart = (ev: Event) => {
      // v3.36.0/v3.37.0: positionStep aus dem Detail extrahieren — wenn vorher
      // SPP empfangen wurde, ist das != 0, sonst 0 (von-Anfang-Start).
      // v3.37.0 RACE-FIX: Statt erst seekToStep + dann onPlayStop (was zu
      // play(0) führte und damit den Seek überschrieb), reichen wir den
      // positionStep direkt an onPlayStop weiter. App.tsx ist verantwortlich
      // play(positionStep) zu rufen — single-source-of-truth, kein Race.
      const detail = (ev as CustomEvent).detail as { positionStep?: number } | undefined;
      const pos = typeof detail?.positionStep === "number" ? detail.positionStep : 0;
      optionsRef.current.onPlayStop?.(pos);
    };
    // v3.36.0: Continue (0xFB) preserved aktuelle Position — KEIN seek.
    // Kein positionStep an onPlayStop → App.tsx triggert "vom alten Step
    // weiter" über die normale Toggle-Logik.
    const onContinue = () => { optionsRef.current.onPlayStop?.(); };
    const onStop = () => { optionsRef.current.onPlayStop?.(); };
    const onSpp = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { midiBeat: number; positionStep: number }
        | undefined;
      if (!detail || typeof detail.positionStep !== "number") return;
      setClockInSpp(detail.midiBeat);
      // SPP nur konsumiert wenn external-sync aktiv (sind wir hier per
      // Vorbedingung) UND Transport nicht running (MidiClockIn-Klasse filtert
      // das bereits selbst — dispatched dann gar nicht erst). Wir seeken den
      // Sequencer SOFORT damit beim nächsten Start die Position stimmt.
      AudioEngine.seekToStep(detail.positionStep);
    };
    window.addEventListener("midiclockin:tempo", onTempo as EventListener);
    window.addEventListener("midiclockin:start", onStart as EventListener);
    window.addEventListener("midiclockin:stop",  onStop);
    window.addEventListener("midiclockin:continue", onContinue);
    window.addEventListener("midiclockin:spp", onSpp as EventListener);
    return () => {
      window.removeEventListener("midiclockin:tempo", onTempo as EventListener);
      window.removeEventListener("midiclockin:start", onStart as EventListener);
      window.removeEventListener("midiclockin:stop",  onStop);
      window.removeEventListener("midiclockin:continue", onContinue);
      window.removeEventListener("midiclockin:spp", onSpp as EventListener);
    };
  }, [clockInEnabled]);

  // Status-Poll alle 200ms — lightweight, reicht für eine LED.
  useEffect(() => {
    if (!clockInEnabled) {
      setClockInStatus("off");
      return;
    }
    const timer = setInterval(() => {
      setClockInStatus(clockInRef.current.getStatus());
    }, 200);
    return () => clearInterval(timer);
  }, [clockInEnabled]);

  /**
   * v2.84: Sync der LED-States mit dem aktuellen Mute/Solo-Snapshot.
   * App.tsx ruft dies in einem useEffect auf, das den aktiven Pattern-State
   * der ersten 8 Parts beobachtet. Diff-Sync intern.
   * Erster Call nach Enable → forceFullSync damit alle 16 LEDs initial gesetzt
   * sind (Cache ist beim Enable noch leer = alle undefined → automatisch
   * Full-Sync).
   */
  const syncFeedbackLeds = useCallback((channels: NanoKontrolChannelState[]) => {
    nanoFeedbackRef.current.syncMixer(channels);
  }, []);

  /**
   * v1.98: MIDI Panic — sendet Note Off + All Notes Off + All Sound Off
   * an alle 16 Channels des aktiven Output-Devices. Cleared hängende Notes
   * bei externen Synths (klassisches DAW-Feature).
   */
  const sendPanic = useCallback(() => {
    const out = activeOutputRef.current;
    if (!out) return;
    for (let ch = 0; ch < 16; ch++) {
      try {
        // All Notes Off (CC 123)
        out.send([0xb0 | ch, 123, 0]);
        // All Sound Off (CC 120) — auch Sustain-Pedal-Hold
        out.send([0xb0 | ch, 120, 0]);
        // Sustain Pedal (CC 64) auf 0 für gute Messer
        out.send([0xb0 | ch, 64, 0]);
        // Note Off für alle 128 Notes (defense in depth)
        for (let note = 0; note < 128; note++) {
          out.send([0x80 | ch, note, 0]);
        }
      } catch { /* ignore single-channel-failures */ }
    }
  }, []);

  // v2.3: Bulk-Add — bestehende Mappings + neue, Duplikate werden ersetzt
  const addMappings = useCallback((newMappings: MidiMapping[]) => {
    setMappings(prev => {
      const next = [...prev];
      for (const m of newMappings) {
        const idx = next.findIndex(x => x.cc === m.cc && x.channel === m.channel);
        if (idx >= 0) next[idx] = m;
        else next.push(m);
      }
      saveMappings(next, noteMappingsRef.current);
      return next;
    });
  }, []);

  const loadTemplate = useCallback((cc: MidiMapping[], notes: MidiNoteMapping[]) => {
    setMappings(cc);
    setNoteMappings(notes);
    saveMappings(cc, notes);
  }, []);

  return {
    // State
    isAvailable,
    isEnabled,
    devices,
    activeDeviceId,
    outputDevices,
    activeOutputDeviceId,
    midiOutEnabled,
    midiOutChannel,
    mappings,
    noteMappings,
    isLearning,
    learnTarget,
    autoLearnQueue,
    autoLearnTotal,
    autoLearnFilterChannel,
    clockSync,
    externalBpm,
    // Input Actions
    enable,
    disable,
    setActiveDevice,
    startLearn,
    cancelLearn,
    startAutoLearn,
    skipAutoLearnTarget,
    cancelAutoLearn,
    setAutoLearnFilterChannel,
    removeMapping,
    addNoteMapping,
    removeNoteMapping,
    setClockSync,
    clearAllMappings,
    loadTemplate,
    addMappings,
    setClockOutEnabled,
    setClockOutBpm,
    setClockOutputDeviceId,
    clockOutEnabled,
    clockOutBpm,
    clockOutputDeviceId,
    // v2.84 (TASK-231): LED-Feedback
    feedbackOutputDeviceId,
    feedbackEnabled,
    feedbackSceneMode,
    setFeedbackOutputDeviceId,
    setFeedbackEnabled,
    setFeedbackSceneMode,
    syncFeedbackLeds,
    sendPanic,
    // v3.35.0: External-Sync (MIDI-Clock-IN)
    clockInEnabled,
    clockInStatus,
    // v3.36.0: SPP-Position (für UI-Display "Beat: N / step N")
    clockInSpp,
    setClockInEnabled,
    // Output Actions
    setActiveOutputDevice,
    setMidiOutEnabled,
    setMidiOutChannel,
    sendNoteOn,
    sendNoteOff,
    sendCC,
  };
}

// ─── GM Drum Defaults exportieren ────────────────────────────────────────────
export { GM_DRUM_DEFAULTS };
