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
  | { type: "openSettings" };

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

export interface MidiState {
  isAvailable: boolean;
  isEnabled: boolean;
  devices: MidiDevice[];
  activeDeviceId: string | null;
  /** Verfügbare MIDI-Ausgangsgeräte */
  outputDevices: MidiDevice[];
  activeOutputDeviceId: string | null;
  mappings: MidiMapping[];
  noteMappings: MidiNoteMapping[];
  isLearning: boolean;
  learnTarget: MidiLearnTarget | null;
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
  removeMapping: (cc: number, channel: number) => void;
  addNoteMapping: (note: number, channel: number, partId: string, label: string) => void;
  removeNoteMapping: (note: number, channel: number) => void;
  setClockSync: (enabled: boolean) => void;
  clearAllMappings: () => void;
  /** Lädt eine vordefinierte Hardware-Template-Konfiguration (ersetzt alle Mappings). */
  loadTemplate: (cc: MidiMapping[], notes: MidiNoteMapping[]) => void;
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
      case "mute":   if (on) opts.onMute?.(t.partId); break;
      case "solo":   if (on) window.dispatchEvent(new CustomEvent("midi:partSolo", { detail: t.partId })); break;
      case "partUp":   if (on) dispatchAction("part-up"); break;
      case "partDown": if (on) dispatchAction("part-down"); break;
      case "step": break; // Step-Toggle via Note-Mapping, nicht CC
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
    }
  }

  function labelForTarget(target: MidiLearnTarget): string {
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
      default:                return "Unbekannt";
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

    // Aktives Gerät neu verbinden falls noch vorhanden
    setActiveDeviceId(prev => {
      if (prev && list.find(d => d.id === prev)) {
        connectDevice(prev);
        return prev;
      }
      if (list.length > 0 && !prev) {
        const firstId = list[0].id;
        connectDevice(firstId);
        return firstId;
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
  }, [connectDevice]);

  // ─── MIDI Out Actions ────────────────────────────────────────────────────

  const setActiveOutputDevice = useCallback((id: string | null) => {
    setActiveOutputDeviceId(id);
    if (!id || !midiAccessRef.current) { activeOutputRef.current = null; return; }
    const output = midiAccessRef.current.outputs.get(id);
    activeOutputRef.current = output ?? null;
  }, []);

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
    clockSync,
    externalBpm,
    // Input Actions
    enable,
    disable,
    setActiveDevice,
    startLearn,
    cancelLearn,
    removeMapping,
    addNoteMapping,
    removeNoteMapping,
    setClockSync,
    clearAllMappings,
    loadTemplate,
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
