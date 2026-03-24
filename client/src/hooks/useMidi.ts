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

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  state: "connected" | "disconnected";
}

export type MidiLearnTarget =
  | { type: "bpm" }
  | { type: "volume"; partId: string }
  | { type: "mute"; partId: string }
  | { type: "step"; partId: string; stepIndex: number }
  | { type: "playStop" }
  | { type: "pattern"; patternIndex: number };

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
  mappings: MidiMapping[];
  noteMappings: MidiNoteMapping[];
  isLearning: boolean;
  learnTarget: MidiLearnTarget | null;
  clockSync: boolean;
  externalBpm: number | null;
}

export interface MidiActions {
  enable: () => Promise<void>;
  disable: () => void;
  setActiveDevice: (id: string | null) => void;
  startLearn: (target: MidiLearnTarget) => void;
  cancelLearn: () => void;
  removeMapping: (cc: number, channel: number) => void;
  addNoteMapping: (note: number, channel: number, partId: string, label: string) => void;
  removeNoteMapping: (note: number, channel: number) => void;
  setClockSync: (enabled: boolean) => void;
  clearAllMappings: () => void;
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
  const [isLearning, setIsLearning] = useState(false);
  const [learnTarget, setLearnTarget] = useState<MidiLearnTarget | null>(null);
  const [clockSync, setClockSyncState] = useState(false);
  const [externalBpm, setExternalBpm] = useState<number | null>(null);

  const savedMappings = loadMappings();
  const [mappings, setMappings] = useState<MidiMapping[]>(savedMappings.cc);
  const [noteMappings, setNoteMappings] = useState<MidiNoteMapping[]>(savedMappings.notes);

  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const activeInputRef = useRef<MIDIInput | null>(null);
  const clockAnalyzer = useRef(new MidiClockAnalyzer());
  const learnRef = useRef<{ isLearning: boolean; target: MidiLearnTarget | null }>({
    isLearning: false,
    target: null,
  });

  // Refs für aktuelle Mappings (kein Re-Render-Overhead in MIDI-Handler)
  const mappingsRef = useRef(mappings);
  const noteMappingsRef = useRef(noteMappings);
  const clockSyncRef = useRef(clockSync);

  useEffect(() => { mappingsRef.current = mappings; }, [mappings]);
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
      optionsRef.current.onNoteOn?.(byte1, byte2, channel);
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

  function applyMapping(mapping: MidiMapping, value: number) {
    const opts = optionsRef.current;
    const t = mapping.target;
    switch (t.type) {
      case "bpm": {
        // CC 0-127 → BPM 60-200
        const bpm = Math.round(60 + (value / 127) * 140);
        opts.onBpmChange?.(bpm);
        break;
      }
      case "volume": {
        // CC 0-127 → Volume 0-1
        // Wird über onCc weitergeleitet – DrumMachine-Store direkt
        break;
      }
      case "mute": {
        if (value > 63) opts.onMute?.(t.partId);
        break;
      }
      case "playStop": {
        if (value > 63) opts.onPlayStop?.();
        break;
      }
      case "step": {
        // Step-Toggle via CC
        break;
      }
    }
  }

  function labelForTarget(target: MidiLearnTarget): string {
    switch (target.type) {
      case "bpm": return "BPM";
      case "volume": return `Volume (${target.partId.slice(0, 6)})`;
      case "mute": return `Mute (${target.partId.slice(0, 6)})`;
      case "playStop": return "Play/Stop";
      case "pattern": return `Pattern ${target.patternIndex + 1}`;
      case "step": return `Step ${target.stepIndex + 1}`;
      default: return "Unbekannt";
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

    // Aktives Gerät neu verbinden falls noch vorhanden
    setActiveDeviceId(prev => {
      if (prev && list.find(d => d.id === prev)) {
        connectDevice(prev);
        return prev;
      }
      // Erstes verfügbares Gerät automatisch wählen
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

  return {
    // State
    isAvailable,
    isEnabled,
    devices,
    activeDeviceId,
    mappings,
    noteMappings,
    isLearning,
    learnTarget,
    clockSync,
    externalBpm,
    // Actions
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
  };
}

// ─── GM Drum Defaults exportieren ────────────────────────────────────────────
export { GM_DRUM_DEFAULTS };
