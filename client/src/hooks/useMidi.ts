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
import { findFxParamRange, midiValueToFxParam, type FxParamKey } from "@/audio/AudioEngine";

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
  | { type: "chain"; label: string; steps: ChainStep[] };

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
}

/**
 * Ein Eintrag in der Auto-Learn-Queue (v1.72): entweder ein CC-Target oder
 * ein Note-Target (Pad → Part-Trigger). Erlaubt gemischte Sequenzen,
 * z.B. "8 CCs für Volumes, dann 8 Notes für Pads".
 */
export type AutoLearnEntry =
  | { kind: "cc"; target: MidiLearnTarget }
  | { kind: "note"; partId: string; partName: string };

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
  onPlayStop?: () => void;
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
  // v1.97: MIDI-Clock-Output
  const [clockOutEnabled, setClockOutEnabledState] = useState(false);
  const [clockOutBpm, setClockOutBpmState] = useState(120);
  const clockOutEnabledRef = useRef(false);
  const clockOutBpmRef = useRef(120);
  useEffect(() => { clockOutEnabledRef.current = clockOutEnabled; }, [clockOutEnabled]);
  useEffect(() => { clockOutBpmRef.current = clockOutBpm; }, [clockOutBpm]);

  /**
   * v1.97: MIDI-Clock-Output-Ticker. Wenn clockOutEnabled aktiv ist und ein
   * Output-Device gewählt ist, sendet jeden Tick `[0xF8]` an das Device.
   * Tick-Rate: 24 PPQ → 24 Pulses pro Beat. Bei 120 BPM = 48 Pulses/sec
   * = ~20.83ms pro Pulse. setInterval reicht für brauchbare Sync-Genauigkeit;
   * für sub-ms Präzision würde performance.now()-basiertes Looping nötig.
   */
  useEffect(() => {
    if (!clockOutEnabled) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startTicker = () => {
      const bpm = Math.max(20, Math.min(300, clockOutBpmRef.current));
      const ppqMs = 60_000 / (bpm * 24);
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        const out = activeOutputRef.current;
        if (!out || !clockOutEnabledRef.current) return;
        try { out.send([0xf8]); } catch { /* ignore */ }
      }, ppqMs);
    };
    startTicker();
    // Falls BPM sich ändert während Clock läuft, neu starten
    const bpmWatcher = setInterval(() => {
      if (!clockOutEnabledRef.current) return;
      const bpm = Math.max(20, Math.min(300, clockOutBpmRef.current));
      const expectedPpqMs = 60_000 / (bpm * 24);
      // Reset wenn BPM sich relevant geändert hat (>1% Diff)
      if (intervalId) {
        startTicker(); // restart with new BPM rate (Vereinfachung)
      }
    }, 250);
    return () => {
      if (intervalId) clearInterval(intervalId);
      clearInterval(bpmWatcher);
    };
  }, [clockOutEnabled]);
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
  const learnRef = useRef<{ isLearning: boolean; target: MidiLearnTarget | null }>({
    isLearning: false,
    target: null,
  });
  const autoLearnRef = useRef<AutoLearnEntry[]>([]);

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

    // MIDI-Clock
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
      // Chord Memory: wenn aktiv, für alle Akkord-Noten onNoteOn auslösen
      const chordState = getChordMemoryState();
      if (chordState.enabled) {
        const chordNotes = buildChordNotes(byte1, chordState);
        chordNotes.forEach(n => optionsRef.current.onNoteOn?.(n, byte2, channel));
        // Chord Memory MIDI Out
        chordNotes.forEach(n => {
          const out = activeOutputRef.current;
          if (out && midiOutEnabledRef.current) {
            const ch2 = Math.max(0, midiOutChannelRef.current - 1) & 0x0f;
            out.send([0x90 | ch2, n & 0x7f, byte2 & 0x7f]);
          }
        });
      } else {
        optionsRef.current.onNoteOn?.(byte1, byte2, channel);
        // MIDI Step Input Event (nur wenn Step Input Modus aktiv)
        window.dispatchEvent(new CustomEvent("stepinput:noteon", { detail: { note: byte1, velocity: byte2 } }));
      }
      // Note-Mapping → Part triggern
      const nm = noteMappingsRef.current.find(
        m => m.note === byte1 && (m.channel === 0 || m.channel === channel)
      );
      if (nm) {
        optionsRef.current.onPartTrigger?.(nm.partId, byte2);
      }
    }

    // Note-Off
    if (type === 0x80 || (type === 0x90 && byte2 === 0)) {
      optionsRef.current.onNoteOff?.(byte1, channel);
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
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      midiAccessRef.current = access;
      access.onstatechange = () => refreshDevices();
      setIsEnabled(true);
      setIsAvailable(true);
      refreshDevices();
    } catch (err) {
      console.error("[MIDI] Zugriff verweigert:", err);
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
  }, []);

  // ─── Verfügbarkeit prüfen ────────────────────────────────────────────────

  useEffect(() => {
    setIsAvailable(!!navigator.requestMIDIAccess);
  }, []);

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

  // v1.97: MIDI-Clock-Output Actions
  const setClockOutEnabled = useCallback((enabled: boolean) => {
    setClockOutEnabledState(enabled);
    // Wenn aktiviert UND Transport läuft, sende MIDI Start (0xFA). Wenn deaktiviert,
    // sende Stop (0xFC). Hilft externem Gerät die Sync zu starten/stoppen.
    const out = activeOutputRef.current;
    if (out) {
      try {
        out.send([enabled ? 0xfa : 0xfc]);
      } catch { /* ignore */ }
    }
  }, []);

  const setClockOutBpm = useCallback((bpm: number) => {
    const clamped = Math.max(20, Math.min(300, bpm));
    setClockOutBpmState(clamped);
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
    clockOutEnabled,
    clockOutBpm,
    sendPanic,
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
