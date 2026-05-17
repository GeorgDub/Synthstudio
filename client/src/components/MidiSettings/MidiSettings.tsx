/**
 * Synthstudio – MidiSettings.tsx
 *
 * MIDI-Einstellungen UI:
 * - MIDI aktivieren/deaktivieren
 * - Eingabegerät auswählen
 * - MIDI-Learn für CC-Parameter
 * - CC-Mapping-Tabelle (anzeigen, löschen)
 * - Note-Mapping (MIDI-Note → Part)
 * - MIDI-Clock-Sync
 */

import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import type { MidiState, MidiActions, MidiLearnTarget, MidiNoteMapping, AutoLearnEntry } from "@/hooks/useMidi";
import { GM_DRUM_DEFAULTS } from "@/hooks/useMidi";
import { MIDI_TEMPLATES, templateToMappings } from "@/utils/midiTemplates";
import { buildMidiLayoutJson, sanitizeLayoutFileName, defaultLayoutNameForDevice } from "@/utils/midiLayoutExport";
import { toast } from "@/store/useToastStore";
import { FX_PARAM_RANGES } from "@/audio/AudioEngine";
import { useScriptStore } from "@/store/useScriptStore";
import {
  loadPadBankSlots,
  savePadBankSlots,
  defaultPadBankSlots,
  type PadBankSlot,
  type PadBankSlotKind,
} from "@/utils/padBankPersistence";
import {
  useUserMidiTemplates,
  saveUserMidiTemplate,
  deleteUserMidiTemplate,
  renameUserMidiTemplate,
} from "@/store/useUserMidiTemplatesStore";

interface MidiSettingsProps {
  midi: MidiState & MidiActions;
  parts: Array<{ id: string; name: string }>;
  onClose: () => void;
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function targetLabel(target: MidiLearnTarget): string {
  switch (target.type) {
    case "bpm": return "BPM";
    case "bpmUp": return "BPM +";
    case "bpmDown": return "BPM −";
    case "masterVolume": return "Master-Lautstärke";
    case "volume": return `Lautstärke${target.partName ? ` (${target.partName})` : ""}`;
    case "mute": return `Mute${target.partName ? ` (${target.partName})` : ""}`;
    case "solo": return `Solo${target.partName ? ` (${target.partName})` : ""}`;
    case "pan": return `Pan${target.partName ? ` (${target.partName})` : ""}`;
    case "partUp": return "Part Up";
    case "partDown": return "Part Down";
    case "playStop": return "Play/Stop";
    case "record": return "Record";
    case "tapTempo": return "Tap Tempo";
    case "pattern": return `Pattern ${target.patternIndex + 1}`;
    case "patternNext": return "Pattern Next";
    case "patternPrev": return "Pattern Prev";
    case "patternClear": return "Pattern Clear";
    case "patternFill": return "Pattern Fill";
    case "patternRandomize": return "Pattern Randomize";
    case "patternDuplicate": return "Pattern Duplicate";
    case "tab": return `Tab: ${target.tabId}`;
    case "toggleNoteRepeat": return "Note Repeat Toggle";
    case "toggleMorph": return "Morph Toggle";
    case "commitLiveEdit": return "Commit Live Edit";
    case "scenelaunch": return `Scene ${target.sceneIndex + 1}`;
    case "openSettings": return "Settings";
    case "step": return `Step ${target.stepIndex + 1}`;
    default: return "Unbekannt";
  }
}

function noteToName(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(note / 12) - 1;
  return `${names[note % 12]}${octave}`;
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export function MidiSettings({ midi, parts, onClose }: MidiSettingsProps) {
  // v1.78: für Script-Run-Targets brauchen wir die Liste aller Scripts
  const { scripts } = useScriptStore();
  // v1.96: User-Templates (gespeicherte Mappings)
  const userTemplates = useUserMidiTemplates();
  const [userTplName, setUserTplName] = useState("");

  // v1.79: Live-MIDI-Activity-Indicator — User sieht ob seine Hardware
  // tatsächlich Events sendet. Hört auf "midi:rawmessage" das in
  // useMidi.handleMidiMessage für JEDE Note/CC/Aftertouch-Message gedispatcht
  // wird (auch Clock-Pulses sind drin via separater Logik im Handler).
  const [lastActivity, setLastActivity] = useState<{
    type: number;
    channel: number;
    byte1: number;
    byte2: number;
    at: number;
  } | null>(null);
  const [activityPulse, setActivityPulse] = useState(false);
  // v1.81: Monitor-Tab — bewahrt einen ringbuffer der letzten 200 MIDI-Events
  // damit der User das genaue Verhalten seiner Hardware debuggen kann.
  const [monitorLog, setMonitorLog] = useState<Array<{
    type: number; channel: number; byte1: number; byte2: number; at: number;
  }>>([]);
  const [monitorPaused, setMonitorPaused] = useState(false);
  const monitorPausedRef = React.useRef(false);
  React.useEffect(() => { monitorPausedRef.current = monitorPaused; }, [monitorPaused]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ type: number; channel: number; byte1: number; byte2: number }>).detail;
      if (!detail) return;
      setLastActivity({ ...detail, at: Date.now() });
      setActivityPulse(true);
      setTimeout(() => setActivityPulse(false), 150);
      if (!monitorPausedRef.current) {
        setMonitorLog((prev) => {
          const next = [...prev, { ...detail, at: Date.now() }];
          // Ringbuffer-Cap: max 200 Events damit die UI nicht erstickt
          return next.length > 200 ? next.slice(-200) : next;
        });
      }
    };
    window.addEventListener("midi:rawmessage", handler);
    return () => window.removeEventListener("midi:rawmessage", handler);
  }, []);

  /** Pretty-print für die letzte empfangene MIDI-Message. */
  function formatActivity(a: NonNullable<typeof lastActivity>): string {
    const ageMs = Date.now() - a.at;
    const ageStr = ageMs < 1000 ? `${ageMs}ms` : `${Math.floor(ageMs / 1000)}s`;
    let typeName: string;
    if (a.type === 0x90) typeName = `Note On ${a.byte1} vel=${a.byte2}`;
    else if (a.type === 0x80) typeName = `Note Off ${a.byte1}`;
    else if (a.type === 0xb0) typeName = `CC ${a.byte1} = ${a.byte2}`;
    else if (a.type === 0xa0) typeName = `Poly AT ${a.byte1} = ${a.byte2}`;
    else if (a.type === 0xd0) typeName = `Ch AT ${a.byte1}`;
    else if (a.type === 0xe0) typeName = `Pitch Bend ${(a.byte1 | (a.byte2 << 7))}`;
    else typeName = `Type 0x${a.type.toString(16)}`;
    return `${typeName} (Ch${a.channel}, vor ${ageStr})`;
  }

  /** v1.79: pure-helper aus midiLayoutExport mit Device-Name aus midi-State. */
  function defaultExportNameFromDevice(): string {
    const dev = midi.devices.find((d) => d.id === midi.activeDeviceId);
    return defaultLayoutNameForDevice(dev?.name);
  }
  const [activeTab, setActiveTab] = useState<"devices" | "templates" | "cc" | "notes" | "monitor" | "clock">("devices");
  const [noteLearnPartId, setNoteLearnPartId] = useState<string | null>(null);
  const [noteLearnChannel, setNoteLearnChannel] = useState(0);
  const [manualNote, setManualNote] = useState(36);
  const [manualChannel, setManualChannel] = useState(0);
  // v1.76: aufklappbare FX-Param-Section pro Part
  const [fxParamPartId, setFxParamPartId] = useState<string | null>(null);
  // v2.3: Bulk-Bind State
  const [bulkBindOpen, setBulkBindOpen] = useState(false);
  const [bulkBindStartCC, setBulkBindStartCC] = useState(20);
  const [bulkBindChannel, setBulkBindChannel] = useState(0);
  const [bulkBindPreset, setBulkBindPreset] = useState<string>("volumes");
  // v1.80: Custom Chain Builder
  const [chainBuilderOpen, setChainBuilderOpen] = useState(false);
  const [chainBuilderName, setChainBuilderName] = useState("Mein Chain");
  const [chainBuilderSteps, setChainBuilderSteps] = useState<Array<{
    targetKey: string;
    delayMs: number;
  }>>([]);

  // v2.79: Pad-Bank Builder — pro Pad einen beliebigen Target (perf-pad,
  // macro, script, atomic action) zuweisen, dann Auto-Learn fährt sie in
  // Reihe ab. Default: 16 perf-pad-Slots (Pad N → Performance-Pad N).
  // v2.80: localStorage-Persistenz via loadPadBankSlots/savePadBankSlots
  //        (Schema + Helpers in utils/padBankPersistence.ts).
  const [padBankBuilderOpen, setPadBankBuilderOpen] = useState(false);
  const [padBankSlots, setPadBankSlots] = useState<PadBankSlot[]>(() => loadPadBankSlots());
  useEffect(() => {
    savePadBankSlots(padBankSlots);
  }, [padBankSlots]);
  // v2.81: Reload aus localStorage wenn ein Project geladen wurde
  // (restoreProject in App.tsx dispatcht 'padBank:loaded' nach dem Save).
  useEffect(() => {
    const handler = () => setPadBankSlots(loadPadBankSlots());
    window.addEventListener("padBank:loaded", handler);
    return () => window.removeEventListener("padBank:loaded", handler);
  }, []);
  // v1.73: Export der aktuellen Mappings als JSON-Template.
  // v1.79: Default-Filename basiert auf dem aktiven MIDI-Device-Namen.
  const [exportName, setExportName] = useState<string>(() => "Mein MIDI-Setup");
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  // exportName beim Device-Wechsel automatisch aktualisieren (nur wenn der
  // User ihn nicht manuell überschrieben hat — wir merken uns das mit
  // einem flag).
  const [exportNameTouched, setExportNameTouched] = useState(false);
  useEffect(() => {
    if (!exportNameTouched) {
      setExportName(defaultExportNameFromDevice());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midi.activeDeviceId, midi.devices]);

  const handleExportLayout = () => {
    const json = buildMidiLayoutJson({
      name: exportName.trim() || "Mein MIDI-Setup",
      ccMappings: midi.mappings,
      noteMappings: midi.noteMappings,
    });
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeLayoutFileName(exportName)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // URL nach 1s revoken — der Browser hat den Download dann sicher gestartet
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const summary = `${midi.mappings.length} CC + ${midi.noteMappings.length} Notes`;
      setExportFeedback(`Gespeichert: ${a.download}`);
      setTimeout(() => setExportFeedback(null), 3000);
      toast(`Layout exportiert: ${a.download} (${summary})`, { kind: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportFeedback(`Fehler: ${msg}`);
      toast(`Export-Fehler: ${msg}`, { kind: "error", duration: 5000 });
    }
  };

  // ─── Tab: Geräte ──────────────────────────────────────────────────────────

  const renderDevicesTab = () => (
    <div className="space-y-4">
      {/* MIDI aktivieren */}
      <div className="flex items-center justify-between p-3 bg-bg-elevated rounded-lg">
        <div>
          <div className="text-sm font-medium text-text-primary">Web MIDI API</div>
          <div className="text-xs text-text-muted mt-0.5">
            {midi.isAvailable
              ? "Verfügbar in diesem Browser"
              : "Nicht verfügbar – Chrome/Edge empfohlen"}
          </div>
        </div>
        <button
          onClick={midi.isEnabled ? midi.disable : midi.enable}
          disabled={!midi.isAvailable}
          className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
            midi.isEnabled
              ? "bg-accent-primary hover:bg-accent-primary/70 text-bg-base"
              : "bg-bg-elevated hover:bg-bg-elevated/80 text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
        >
          {midi.isEnabled ? "Deaktivieren" : "Aktivieren"}
        </button>
      </div>

      {/* Gerät auswählen */}
      {midi.isEnabled && (
        <div>
          <label className="block text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
            MIDI-Eingabegerät
          </label>
          {midi.devices.length === 0 ? (
            <div className="p-3 bg-bg-elevated rounded text-sm text-text-muted text-center">
              Kein MIDI-Gerät gefunden. Gerät anschließen und Seite neu laden.
            </div>
          ) : (
            <div className="space-y-1">
              {midi.devices.map(device => (
                <button
                  key={device.id}
                  onClick={() => midi.setActiveDevice(
                    midi.activeDeviceId === device.id ? null : device.id
                  )}
                  className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${
                    midi.activeDeviceId === device.id
                      ? "bg-accent-primary/20 border border-accent-primary"
                      : "bg-bg-elevated hover:bg-bg-elevated border border-transparent"
                  }`}
                >
                  <div>
                    <div className="text-sm text-text-primary">{device.name}</div>
                    {device.manufacturer && (
                      <div className="text-xs text-text-dim">{device.manufacturer}</div>
                    )}
                  </div>
                  <div className={`w-2 h-2 rounded-full ${
                    device.state === "connected" ? "bg-accent-success" : "bg-bg-elevated"
                  }`} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status */}
      {midi.isEnabled && midi.activeDeviceId && (
        <div className="p-2 bg-accent-success/20 border border-accent-success/50 rounded text-xs text-accent-success text-center">
          MIDI aktiv – Gerät verbunden
        </div>
      )}
    </div>
  );

  // ─── Tab: CC-Mapping ──────────────────────────────────────────────────────

  const learnTargets: Array<{ label: string; target: MidiLearnTarget }> = [
    { label: "Play/Stop", target: { type: "playStop" } },
    { label: "BPM", target: { type: "bpm" } },
    ...parts.map(p => ({ label: `Lautstärke: ${p.name}`, target: { type: "volume" as const, partId: p.id } })),
    ...parts.map(p => ({ label: `Mute: ${p.name}`, target: { type: "mute" as const, partId: p.id } })),
  ];

  /**
   * v1.80: Atomare Actions die im Custom-Chain-Builder verfügbar sind.
   * Pro key gibt es ein vorgefertigtes MidiLearnTarget — der Builder serialisiert
   * sie in ChainStep-Form. Wir whitelist nur die häufigsten Actions damit das
   * Dropdown übersichtlich bleibt.
   */
  const CHAIN_BUILDER_ACTIONS: Array<{ key: string; label: string; target: Exclude<MidiLearnTarget, { type: "chain" }> }> = [
    { key: "playStop",         label: "Play / Stop",          target: { type: "playStop" } },
    { key: "record",           label: "Record toggle",        target: { type: "record" } },
    { key: "tapTempo",         label: "Tap Tempo",            target: { type: "tapTempo" } },
    { key: "bpmUp",            label: "BPM +1",               target: { type: "bpmUp" } },
    { key: "bpmDown",          label: "BPM −1",               target: { type: "bpmDown" } },
    { key: "patternNext",      label: "Pattern →",            target: { type: "patternNext" } },
    { key: "patternPrev",      label: "Pattern ←",            target: { type: "patternPrev" } },
    { key: "patternClear",     label: "Pattern leeren",       target: { type: "patternClear" } },
    { key: "patternFill",      label: "Pattern füllen",       target: { type: "patternFill" } },
    { key: "patternRandomize", label: "Pattern zufällig",     target: { type: "patternRandomize" } },
    { key: "patternDuplicate", label: "Pattern duplizieren",  target: { type: "patternDuplicate" } },
    { key: "partUp",           label: "Part ↑",               target: { type: "partUp" } },
    { key: "partDown",         label: "Part ↓",               target: { type: "partDown" } },
    { key: "toggleNoteRepeat", label: "Note Repeat Toggle",   target: { type: "toggleNoteRepeat" } },
    { key: "toggleMorph",      label: "Morph Toggle",         target: { type: "toggleMorph" } },
    { key: "commitLiveEdit",   label: "Live Edit Commit",     target: { type: "commitLiveEdit" } },
    { key: "openSettings",     label: "Einstellungen öffnen", target: { type: "openSettings" } },
  ];

  /**
   * Findet einen Action-Eintrag per Key. v1.80.
   */
  const findChainAction = (key: string) =>
    CHAIN_BUILDER_ACTIONS.find((a) => a.key === key);

  /**
   * Speichert den aktuellen Custom-Chain als MidiLearnTarget und startet
   * Learn-Mode. Reset des Forms passiert nicht — User kann nach Capture
   * den Chain weiter editieren / erneut binden.
   */
  const handleChainBuilderLearn = () => {
    if (chainBuilderSteps.length === 0 || !midi.isEnabled) return;
    const steps = chainBuilderSteps
      .map((s) => {
        const action = findChainAction(s.targetKey);
        if (!action) return null;
        return { target: action.target, delayMs: Math.max(0, Math.min(60000, s.delayMs)) };
      })
      .filter((s): s is { target: Exclude<MidiLearnTarget, { type: "chain" }>; delayMs: number } => s !== null);
    if (steps.length === 0) return;
    midi.startLearn({
      type: "chain",
      label: chainBuilderName.trim() || "Custom Chain",
      steps,
    });
  };

  // v1.77: Function-Chain-Presets — fertige Multi-Step-Actions die der User
  // auf eine Taste/Pad binden kann. Diese Liste ist absichtlich kurz und
  // hardcoded — komplette Custom-Chain-Builder kommt in einem späteren Release.
  const chainPresets: Array<{ label: string; description: string; target: MidiLearnTarget }> = [
    {
      label: "Drop-Combo",
      description: "Play/Stop → 200ms → Clear → 100ms → Play",
      target: {
        type: "chain",
        label: "Drop-Combo",
        steps: [
          { target: { type: "playStop" }, delayMs: 200 },
          { target: { type: "patternClear" }, delayMs: 100 },
          { target: { type: "playStop" } },
        ],
      },
    },
    {
      label: "Duplicate + Randomize",
      description: "Aktuelles Pattern duplizieren → 50ms → Randomize",
      target: {
        type: "chain",
        label: "Dup+Random",
        steps: [
          { target: { type: "patternDuplicate" }, delayMs: 50 },
          { target: { type: "patternRandomize" } },
        ],
      },
    },
    {
      label: "Tap × 4 + Play",
      description: "4× Tap-Tempo mit 500ms → BPM-Lock → Play",
      target: {
        type: "chain",
        label: "Tap+Play",
        steps: [
          { target: { type: "tapTempo" }, delayMs: 500 },
          { target: { type: "tapTempo" }, delayMs: 500 },
          { target: { type: "tapTempo" }, delayMs: 500 },
          { target: { type: "tapTempo" }, delayMs: 250 },
          { target: { type: "playStop" } },
        ],
      },
    },
    {
      label: "Fill + Next-Pattern",
      description: "Fill aktuelles Pattern → 100ms → nächstes Pattern",
      target: {
        type: "chain",
        label: "Fill+Next",
        steps: [
          { target: { type: "patternFill" }, delayMs: 100 },
          { target: { type: "patternNext" } },
        ],
      },
    },
  ];

  // Auto-Learn-Presets (v1.71 CC, v1.72 + Note): vordefinierte Sequenzen
  // für gängige Hardware-Setups. User klickt einen Preset-Button, dreht/
  // drückt dann jeden Controller/Pad seines Geräts einmal — Synthstudio
  // mappt automatisch (CC für Slider/Knöpfe, Note für Pads).
  const ccEntries = (targets: MidiLearnTarget[]): AutoLearnEntry[] =>
    targets.map(t => ({ kind: "cc" as const, target: t }));
  const noteEntries = (ps: Array<{ id: string; name: string }>): AutoLearnEntry[] =>
    ps.map(p => ({ kind: "note" as const, partId: p.id, partName: p.name }));

  /**
   * v2.78: Generiert 16 AutoLearn-Note-Einträge, jeder mit
   * performancePadIndex 0..15. User drückt nacheinander seine 16
   * Hardware-Pads — Synthstudio bindet jede Note an das entsprechende
   * Performance-Mode-Pad. partId/partName sind nur fürs UI-Display.
   */
  const perfPadNoteEntries = (count = 16): AutoLearnEntry[] =>
    Array.from({ length: count }, (_, i) => ({
      kind: "note" as const,
      partId: `perf-pad-${i}`,
      partName: `Perf-Pad ${i + 1}`,
      performancePadIndex: i,
    }));

  /**
   * v2.79: Pad-Bank-Slot → konkretes UI-Label für die Auto-Learn-Progress-
   * Karte und den Builder selbst.
   */
  function padBankSlotLabel(slot: { kind: "perf-pad" | "macro" | "script" | "action"; param: string }): string {
    if (slot.kind === "perf-pad")  return `Perf-Pad ${Number(slot.param) + 1}`;
    if (slot.kind === "macro")     return `Macro ${Number(slot.param) + 1}`;
    if (slot.kind === "script") {
      const s = scripts.find((x) => x.id === slot.param);
      return s ? `Script: ${s.name}` : "Script: (unbekannt)";
    }
    // action
    const a = findChainAction(slot.param);
    return a ? `Action: ${a.label}` : "Action: (unbekannt)";
  }

  /**
   * v2.79: konvertiert einen Slot in eine AutoLearnEntry-Note mit target.
   * Bei perf-pad: legacy-Path über performancePadIndex (kein target nötig).
   * Bei anderen Kinds: target wird gesetzt, applyMapping greift im Note-Handler.
   */
  function padBankSlotToEntry(slot: { kind: "perf-pad" | "macro" | "script" | "action"; param: string }, index: number): AutoLearnEntry | null {
    const partId = `pad-bank-${index}`;
    const partName = padBankSlotLabel(slot);
    if (slot.kind === "perf-pad") {
      const padIndex = Number(slot.param);
      if (!Number.isFinite(padIndex) || padIndex < 0) return null;
      return { kind: "note", partId, partName, performancePadIndex: padIndex };
    }
    if (slot.kind === "macro") {
      const idx = Number(slot.param);
      if (!Number.isFinite(idx) || idx < 0 || idx > 7) return null;
      return { kind: "note", partId, partName, target: { type: "macro", index: idx } };
    }
    if (slot.kind === "script") {
      if (!slot.param) return null;
      const s = scripts.find((x) => x.id === slot.param);
      return { kind: "note", partId, partName, target: { type: "runScript", scriptId: slot.param, scriptName: s?.name } };
    }
    // action
    const action = findChainAction(slot.param);
    if (!action) return null;
    return { kind: "note", partId, partName, target: action.target };
  }

  function buildPadBankEntries(): AutoLearnEntry[] {
    return padBankSlots
      .map((s, i) => padBankSlotToEntry(s, i))
      .filter((e): e is AutoLearnEntry => e !== null);
  }

  function addPadBankSlot() {
    setPadBankSlots((prev) => [
      ...prev,
      { kind: "perf-pad", param: String(Math.min(15, prev.length)) },
    ]);
  }
  function removePadBankSlot(index: number) {
    setPadBankSlots((prev) => prev.filter((_, i) => i !== index));
  }
  function updatePadBankSlot(index: number, changes: Partial<{ kind: "perf-pad" | "macro" | "script" | "action"; param: string }>) {
    setPadBankSlots((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const next = { ...s, ...changes };
        // Kind-Wechsel: param auf sinnvollen Default zurücksetzen
        if (changes.kind && changes.kind !== s.kind) {
          if (changes.kind === "perf-pad")  next.param = String(Math.min(15, i));
          else if (changes.kind === "macro") next.param = String(Math.min(7, i));
          else if (changes.kind === "script") next.param = scripts[0]?.id ?? "";
          else if (changes.kind === "action") next.param = CHAIN_BUILDER_ACTIONS[0].key;
        }
        return next;
      })
    );
  }
  function resetPadBankSlots() {
    setPadBankSlots(defaultPadBankSlots());
  }

  const autoLearnPresets: Array<{ label: string; description: string; build: () => AutoLearnEntry[] }> = [
    {
      label: "Mixer (Volumes + Mutes)",
      description: `${parts.length} CC-Lautstärken + ${parts.length} CC-Mutes`,
      build: () => ccEntries([
        ...parts.map(p => ({ type: "volume" as const, partId: p.id, partName: p.name })),
        ...parts.map(p => ({ type: "mute" as const, partId: p.id, partName: p.name })),
      ]),
    },
    {
      label: "Pads → Parts",
      description: `${parts.length} Note-On-Pads zum Trigger der Parts (v1.72)`,
      build: () => noteEntries(parts),
    },
    {
      label: "Komplett (Pads + Mixer)",
      description: `${parts.length} Pads zuerst, dann ${parts.length} Volumes + ${parts.length} Mutes`,
      build: () => [
        ...noteEntries(parts),
        ...ccEntries([
          ...parts.map(p => ({ type: "volume" as const, partId: p.id, partName: p.name })),
          ...parts.map(p => ({ type: "mute" as const, partId: p.id, partName: p.name })),
        ]),
      ],
    },
    {
      label: "Transport",
      description: "Play/Stop, Record, Tap-Tempo, BPM Up/Down (CC)",
      build: () => ccEntries([
        { type: "playStop" },
        { type: "record" },
        { type: "tapTempo" },
        { type: "bpmUp" },
        { type: "bpmDown" },
      ]),
    },
    {
      label: "Pattern-Navigation",
      description: "Next, Prev, Clear, Fill, Randomize (CC)",
      build: () => ccEntries([
        { type: "patternNext" },
        { type: "patternPrev" },
        { type: "patternClear" },
        { type: "patternFill" },
        { type: "patternRandomize" },
      ]),
    },
    {
      label: "Korg Electribe 2 → Performance-Pads (16)",
      description: "16 Pads des Electribe 2 (oder anderer 16-Pad-Controller) auf das 4×4 Performance-Mode-Grid mappen (v2.78)",
      build: () => perfPadNoteEntries(16),
    },
  ];

  /** Renderet ein Auto-Learn-Entry als kurzes Label für die Progress-Karte. */
  function autoLearnEntryLabel(entry: AutoLearnEntry): string {
    if (entry.kind === "cc") return `CC: ${targetLabel(entry.target)}`;
    if (entry.performancePadIndex !== undefined) {
      return `Perf-Pad ${entry.performancePadIndex + 1}`;
    }
    return `Pad: ${entry.partName}`;
  }

  /**
   * v2.3: Bulk-Bind-Presets — generieren eine Liste von MidiLearnTargets
   * die dann mit konsekutiven CCs ab `startCC` bound werden.
   */
  const bulkBindPresets: Record<string, { label: string; build: () => MidiLearnTarget[] }> = {
    volumes:     { label: "Channel Volumes", build: () => parts.map(p => ({ type: "volume" as const, partId: p.id, partName: p.name })) },
    mutes:       { label: "Channel Mutes",   build: () => parts.map(p => ({ type: "mute"   as const, partId: p.id, partName: p.name })) },
    pans:        { label: "Channel Pans",    build: () => parts.map(p => ({ type: "pan"    as const, partId: p.id, partName: p.name })) },
    macros:      { label: "8 Macros",        build: () => Array.from({ length: 8 }, (_, i) => ({ type: "macro" as const, index: i })) },
    sendsReverb: { label: "Channel Reverb-Sends", build: () => parts.map(p => ({ type: "send" as const, partId: p.id, partName: p.name, bus: "reverb" as const })) },
    sendsDelay:  { label: "Channel Delay-Sends",  build: () => parts.map(p => ({ type: "send" as const, partId: p.id, partName: p.name, bus: "delay"  as const })) },
  };

  function handleBulkBind() {
    const preset = bulkBindPresets[bulkBindPreset];
    if (!preset) return;
    const targets = preset.build();
    const mappings = targets.map((t, i) => ({
      cc: Math.min(127, bulkBindStartCC + i),
      channel: bulkBindChannel,
      target: t,
      label: targetLabel(t),
    }));
    midi.addMappings(mappings);
    toast(`${mappings.length} Mappings gesetzt: ${preset.label} ab CC ${bulkBindStartCC}`, { kind: "success" });
  }

  const renderCcTab = () => (
    <div className="space-y-4">
      {/* Auto-Learn (v1.71) ─────────────────────────────────────────── */}
      <div>
        <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
          Auto-Learn
        </div>
        {midi.autoLearnQueue.length > 0 ? (
          <div className="p-3 bg-accent-secondary/20 border border-accent-secondary/50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-accent-secondary font-medium">
                Bewege/drücke jetzt den Controller für:
              </div>
              <div className="text-xs text-text-muted">
                {midi.autoLearnTotal - midi.autoLearnQueue.length + 1} / {midi.autoLearnTotal}
              </div>
            </div>
            <div className="text-sm text-text-primary font-mono mb-3">
              → {autoLearnEntryLabel(midi.autoLearnQueue[0])}
            </div>
            <div className="flex gap-2">
              <button
                onClick={midi.skipAutoLearnTarget}
                className="px-3 py-1 bg-bg-elevated hover:bg-bg-elevated text-text-primary text-xs rounded"
              >
                Skip
              </button>
              <button
                onClick={midi.cancelAutoLearn}
                className="px-3 py-1 bg-accent-danger/30 hover:bg-accent-danger/50 text-accent-danger text-xs rounded"
              >
                Abbrechen
              </button>
            </div>
            {/* Vorschau der verbleibenden Targets */}
            {midi.autoLearnQueue.length > 1 && (
              <div className="mt-3 pt-2 border-t border-accent-secondary/30 text-[10px] text-text-dim">
                Nächste: {midi.autoLearnQueue.slice(1, 4).map(autoLearnEntryLabel).join(" → ")}
                {midi.autoLearnQueue.length > 4 && " …"}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="text-xs text-text-dim mb-2">
              Wähle ein Preset und bewege/drücke dann nacheinander die Slider, Knöpfe
              und Pads deines Geräts — Synthstudio verknüpft jedes Event mit dem
              nächsten Target. CC-Einträge erwarten einen Slider/Knopf, Pad-Einträge
              eine Note (z.B. ein Drum-Pad).
            </div>
            {/* v1.83: Channel-Filter — nur Events auf diesem Channel akzeptieren */}
            <div className="flex items-center gap-2 mb-2 text-xs">
              <label className="text-text-muted">Nur Channel:</label>
              <select
                value={midi.autoLearnFilterChannel}
                onChange={(e) => midi.setAutoLearnFilterChannel(Number(e.target.value))}
                className="px-2 py-1 bg-bg-elevated border border-border-color rounded text-text-primary"
              >
                <option value={0}>Alle Channels</option>
                {Array.from({ length: 16 }, (_, i) => i + 1).map((ch) => (
                  <option key={ch} value={ch}>Ch {ch}</option>
                ))}
              </select>
              {midi.autoLearnFilterChannel > 0 && (
                <span className="text-[10px] text-text-dim">
                  → Auto-Learn ignoriert Events von anderen Channels
                </span>
              )}
            </div>
            {autoLearnPresets.map(({ label, description, build }) => (
              <button
                key={label}
                onClick={() => midi.isEnabled && midi.startAutoLearn(build())}
                disabled={!midi.isEnabled}
                className="w-full flex items-center justify-between p-2 rounded text-left text-xs bg-bg-elevated hover:bg-accent-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <div>
                  <div className="text-text-primary font-medium">{label}</div>
                  <div className="text-text-dim text-[10px] mt-0.5">{description}</div>
                </div>
                <span className="text-accent-secondary text-[10px]">▶ Start</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* MIDI-Learn */}
      <div>
        <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
          MIDI-Learn
        </div>
        {midi.isLearning ? (
          <div className="p-3 bg-accent-secondary/20 border border-accent-secondary/50 rounded-lg">
            <div className="text-sm text-accent-secondary font-medium mb-1">
              Warte auf CC-Nachricht...
            </div>
            <div className="text-xs text-accent-secondary mb-3">
              Bewege einen Regler oder Knopf an deinem MIDI-Controller.
              Ziel: <strong>{midi.learnTarget ? targetLabel(midi.learnTarget) : "–"}</strong>
            </div>
            <button
              onClick={midi.cancelLearn}
              className="px-3 py-1 bg-bg-elevated hover:bg-bg-elevated text-text-primary text-xs rounded"
            >
              Abbrechen
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
            {learnTargets.map(({ label, target }) => {
              const existing = midi.mappings.find(m => {
                if (target.type === "bpm") return m.target.type === "bpm";
                if (target.type === "playStop") return m.target.type === "playStop";
                if (target.type === "volume") return m.target.type === "volume" && (m.target as any).partId === (target as any).partId;
                if (target.type === "mute") return m.target.type === "mute" && (m.target as any).partId === (target as any).partId;
                return false;
              });
              return (
                <button
                  key={label}
                  onClick={() => midi.isEnabled && midi.startLearn(target)}
                  disabled={!midi.isEnabled}
                  className={`flex items-center justify-between p-2 rounded text-left text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    existing
                      ? "bg-accent-primary/40 border border-accent-primary/50 hover:bg-accent-primary/60"
                      : "bg-bg-elevated hover:bg-bg-elevated"
                  }`}
                >
                  <span className="text-text-primary">{label}</span>
                  {existing && (
                    <span className="text-accent-secondary font-mono text-xs ml-1">
                      CC{existing.cc}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* FX-Parameter binden (v1.76) ─────────────────────────────────────── */}
      {!midi.isLearning && (
        <div>
          <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
            FX-Parameter binden (v1.76)
          </div>
          <div className="text-xs text-text-dim mb-2">
            Wähle einen Part, dann einen FX-Parameter — anschließend bewege
            den Controller. Jeder Filter/EQ/Reverb/Delay/Distortion-Wert ist
            an einen Slider/Knopf bindbar (MIDI 0-127 wird auf den jeweiligen
            Param-Range gemappt).
          </div>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-text-muted">Part:</label>
            <select
              value={fxParamPartId ?? ""}
              onChange={(e) => setFxParamPartId(e.target.value || null)}
              className="flex-1 px-2 py-1 bg-bg-elevated border border-border-color rounded text-xs text-text-primary focus:outline-none focus:border-accent-secondary"
            >
              <option value="">— Part wählen —</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {fxParamPartId && (
            <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto">
              {FX_PARAM_RANGES.map((r) => {
                const targetPart = parts.find(p => p.id === fxParamPartId);
                const target = {
                  type: "fxParam" as const,
                  partId: fxParamPartId,
                  partName: targetPart?.name,
                  param: r.param as Extract<typeof r.param, import("@/audio/AudioEngine").FxParamKey>,
                };
                const existing = midi.mappings.find(m =>
                  m.target.type === "fxParam" &&
                  m.target.partId === fxParamPartId &&
                  m.target.param === r.param,
                );
                return (
                  <button
                    key={r.param}
                    onClick={() => midi.isEnabled && midi.startLearn(target as MidiLearnTarget)}
                    disabled={!midi.isEnabled}
                    className={`flex items-center justify-between p-2 rounded text-left text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      existing
                        ? "bg-accent-primary/40 border border-accent-primary/50 hover:bg-accent-primary/60"
                        : "bg-bg-elevated hover:bg-bg-elevated"
                    }`}
                  >
                    <span className="text-text-primary">{r.label}</span>
                    {existing && (
                      <span className="text-accent-secondary font-mono text-xs ml-1">
                        CC{existing.cc}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Function-Chain-Presets (v1.77) ─────────────────────────────────── */}
      {!midi.isLearning && (
        <div>
          <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
            Function-Chains (v1.77)
          </div>
          <div className="text-xs text-text-dim mb-2">
            Mehrere Actions auf einer Taste/einem Pad — klick einen Preset
            an und bewege dann den Controller. Die ganze Sequenz wird bei
            jedem Trigger ausgeführt.
          </div>
          <div className="space-y-1.5">
            {chainPresets.map((preset) => {
              const presetLabel = preset.target.type === "chain" ? preset.target.label : "";
              const existing = midi.mappings.find(m =>
                m.target.type === "chain" && m.target.label === presetLabel,
              );
              return (
                <button
                  key={preset.label}
                  onClick={() => midi.isEnabled && midi.startLearn(preset.target)}
                  disabled={!midi.isEnabled}
                  className={`w-full flex items-center justify-between p-2 rounded text-left text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    existing
                      ? "bg-accent-primary/40 border border-accent-primary/50 hover:bg-accent-primary/60"
                      : "bg-bg-elevated hover:bg-bg-elevated"
                  }`}
                >
                  <div>
                    <div className="text-text-primary font-medium">{preset.label}</div>
                    <div className="text-[10px] text-text-dim mt-0.5">{preset.description}</div>
                  </div>
                  {existing && (
                    <span className="text-accent-secondary font-mono text-xs ml-1">
                      CC{existing.cc}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bulk-Bind Wizard (v2.3) ──────────────────────────────────────── */}
      {!midi.isLearning && (
        <div>
          <button
            onClick={() => setBulkBindOpen(!bulkBindOpen)}
            className="text-xs text-text-muted uppercase tracking-wider hover:text-text-primary mb-2 flex items-center gap-1"
          >
            <span>{bulkBindOpen ? "▼" : "▶"}</span>
            Bulk-Bind (v2.3) — N Mappings auf einmal anlegen
          </button>
          {bulkBindOpen && (
            <div className="space-y-2 p-3 bg-bg-elevated/50 rounded border border-border-color">
              <div className="text-xs text-text-dim">
                Wähle einen Target-Preset und eine Start-CC. Synthstudio
                bindet die Targets an konsekutive CCs (start, start+1, …)
                ohne dass du den Controller bewegen musst.
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-muted">Preset:</label>
                <select
                  value={bulkBindPreset}
                  onChange={(e) => setBulkBindPreset(e.target.value)}
                  className="flex-1 px-2 py-1 bg-bg-elevated border border-border-color rounded text-xs text-text-primary"
                >
                  {Object.entries(bulkBindPresets).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-muted">Start-CC:</label>
                <input
                  type="number" min={0} max={127}
                  value={bulkBindStartCC}
                  onChange={(e) => setBulkBindStartCC(Math.max(0, Math.min(127, parseInt(e.target.value) || 0)))}
                  className="w-16 px-2 py-1 bg-bg-elevated border border-border-color rounded text-xs text-text-primary"
                />
                <label className="text-xs text-text-muted ml-2">Channel:</label>
                <select
                  value={bulkBindChannel}
                  onChange={(e) => setBulkBindChannel(Number(e.target.value))}
                  className="px-2 py-1 bg-bg-elevated border border-border-color rounded text-xs text-text-primary"
                >
                  <option value={0}>Alle</option>
                  {Array.from({ length: 16 }, (_, i) => i + 1).map(ch => (
                    <option key={ch} value={ch}>Ch {ch}</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkBind}
                  className="ml-auto px-3 py-1 bg-accent-primary text-bg-base hover:bg-accent-primary/80 text-xs rounded font-medium"
                >
                  ⚡ Bind
                </button>
              </div>
              <div className="text-[10px] text-text-dim">
                Wird {bulkBindPresets[bulkBindPreset]?.build().length ?? 0} Mapping(s) anlegen:
                CC {bulkBindStartCC} bis CC {Math.min(127, bulkBindStartCC + (bulkBindPresets[bulkBindPreset]?.build().length ?? 1) - 1)}
                {bulkBindChannel > 0 ? ` auf Ch ${bulkBindChannel}` : " (alle Channels)"}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Custom Chain Builder (v1.80) ──────────────────────────────────── */}
      {!midi.isLearning && (
        <div>
          <button
            onClick={() => setChainBuilderOpen(!chainBuilderOpen)}
            className="text-xs text-text-muted uppercase tracking-wider hover:text-text-primary mb-2 flex items-center gap-1"
          >
            <span>{chainBuilderOpen ? "▼" : "▶"}</span>
            Custom-Chain bauen (v1.80)
          </button>
          {chainBuilderOpen && (
            <div className="space-y-2 p-3 bg-bg-elevated/50 rounded border border-border-color">
              <div className="text-xs text-text-dim">
                Klicke "+ Schritt" um eine Action hinzuzufügen. Setze die
                Verzögerung zum vorherigen Schritt in ms. Beim "Lernen"
                bewege deinen Controller — die ganze Sequenz wird auf das CC
                gebunden.
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs text-text-muted">Name:</label>
                <input
                  type="text"
                  value={chainBuilderName}
                  onChange={(e) => setChainBuilderName(e.target.value)}
                  className="flex-1 px-2 py-1 bg-bg-elevated border border-border-color rounded text-xs text-text-primary"
                />
              </div>

              {chainBuilderSteps.length === 0 ? (
                <div className="text-[10px] text-text-dim italic py-2 text-center">
                  Noch keine Schritte — klick "+ Schritt" um anzufangen.
                </div>
              ) : (
                <div className="space-y-1">
                  {chainBuilderSteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-1 p-1.5 bg-bg-panel rounded">
                      <span className="text-[10px] text-text-dim font-mono w-6">#{idx + 1}</span>
                      <select
                        value={step.targetKey}
                        onChange={(e) => {
                          const next = [...chainBuilderSteps];
                          next[idx] = { ...next[idx], targetKey: e.target.value };
                          setChainBuilderSteps(next);
                        }}
                        className="flex-1 px-1 py-0.5 bg-bg-elevated border border-border-color rounded text-xs text-text-primary"
                      >
                        {CHAIN_BUILDER_ACTIONS.map((a) => (
                          <option key={a.key} value={a.key}>{a.label}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        max={60000}
                        step={50}
                        value={step.delayMs}
                        onChange={(e) => {
                          const next = [...chainBuilderSteps];
                          next[idx] = { ...next[idx], delayMs: Math.max(0, parseInt(e.target.value) || 0) };
                          setChainBuilderSteps(next);
                        }}
                        className="w-16 px-1 py-0.5 bg-bg-elevated border border-border-color rounded text-xs text-text-primary"
                        title="Delay (ms) vor diesem Schritt"
                      />
                      <span className="text-[10px] text-text-dim">ms</span>
                      {idx > 0 && (
                        <button
                          onClick={() => {
                            const next = [...chainBuilderSteps];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            setChainBuilderSteps(next);
                          }}
                          title="Hoch"
                          className="text-xs text-text-dim hover:text-text-primary px-1"
                        >▲</button>
                      )}
                      {idx < chainBuilderSteps.length - 1 && (
                        <button
                          onClick={() => {
                            const next = [...chainBuilderSteps];
                            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                            setChainBuilderSteps(next);
                          }}
                          title="Runter"
                          className="text-xs text-text-dim hover:text-text-primary px-1"
                        >▼</button>
                      )}
                      <button
                        onClick={() => {
                          setChainBuilderSteps(chainBuilderSteps.filter((_, i) => i !== idx));
                        }}
                        title="Entfernen"
                        className="text-xs text-accent-danger hover:opacity-70 px-1"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => {
                    setChainBuilderSteps([
                      ...chainBuilderSteps,
                      { targetKey: "playStop", delayMs: 100 },
                    ]);
                  }}
                  className="px-3 py-1 text-xs bg-bg-elevated hover:bg-accent-primary/20 text-text-primary rounded transition-colors"
                >
                  + Schritt
                </button>
                <button
                  onClick={handleChainBuilderLearn}
                  disabled={!midi.isEnabled || chainBuilderSteps.length === 0}
                  className="px-3 py-1 text-xs bg-accent-secondary/30 hover:bg-accent-secondary/50 text-accent-secondary rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  💾 Speichern & Lernen
                </button>
                {chainBuilderSteps.length > 0 && (
                  <button
                    onClick={() => setChainBuilderSteps([])}
                    className="px-3 py-1 text-xs text-accent-danger hover:opacity-70 ml-auto"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pad-Bank Builder (v2.79) ─────────────────────────────────────────
          Per-Pad-Target-Picker. Jeder Slot kann auf Performance-Pad, Macro,
          Script oder beliebige Atomic-Action gemappt werden. "Start Auto-
          Learn" fährt die Sequenz ab → User drückt die Hardware-Pads in
          Reihe. Default: 16 Slots als Performance-Pad 1..16. */}
      {!midi.isLearning && (
        <div>
          <button
            onClick={() => setPadBankBuilderOpen(!padBankBuilderOpen)}
            className="text-xs text-text-muted uppercase tracking-wider hover:text-text-primary mb-2 flex items-center gap-1"
          >
            <span>{padBankBuilderOpen ? "▼" : "▶"}</span>
            Custom Pad-Bank (v2.79) — Pads auf Chains / Scripts / Macros / Perf-Pads mappen
          </button>
          {padBankBuilderOpen && (
            <div className="space-y-2 p-3 bg-bg-elevated/50 rounded border border-border-color">
              <div className="text-xs text-text-dim">
                Pro Hardware-Pad einen Target-Typ wählen (Perf-Pad/Macro/Script/
                Action), dann "Start Auto-Learn" klicken und die Pads in
                Reihenfolge drücken. Default sind 16 Perf-Pad-Slots — ändere/
                lösche/füge Slots nach Bedarf hinzu.
              </div>

              <div className="space-y-1 max-h-72 overflow-y-auto">
                {padBankSlots.map((slot, idx) => (
                  <div key={idx} className="flex items-center gap-1 p-1.5 bg-bg-panel rounded">
                    <span className="text-[10px] text-text-dim font-mono w-6">#{idx + 1}</span>
                    <select
                      value={slot.kind}
                      onChange={(e) => updatePadBankSlot(idx, { kind: e.target.value as "perf-pad" | "macro" | "script" | "action" })}
                      className="px-1.5 py-1 bg-bg-elevated border border-border-color rounded text-[11px] text-text-primary"
                    >
                      <option value="perf-pad">Perf-Pad</option>
                      <option value="macro">Macro</option>
                      <option value="script">Script</option>
                      <option value="action">Action</option>
                    </select>
                    {slot.kind === "perf-pad" && (
                      <select
                        value={slot.param}
                        onChange={(e) => updatePadBankSlot(idx, { param: e.target.value })}
                        className="flex-1 px-1.5 py-1 bg-bg-elevated border border-border-color rounded text-[11px] text-text-primary"
                      >
                        {Array.from({ length: 16 }, (_, i) => (
                          <option key={i} value={String(i)}>Perf-Pad {i + 1}</option>
                        ))}
                      </select>
                    )}
                    {slot.kind === "macro" && (
                      <select
                        value={slot.param}
                        onChange={(e) => updatePadBankSlot(idx, { param: e.target.value })}
                        className="flex-1 px-1.5 py-1 bg-bg-elevated border border-border-color rounded text-[11px] text-text-primary"
                      >
                        {Array.from({ length: 8 }, (_, i) => (
                          <option key={i} value={String(i)}>Macro {i + 1}</option>
                        ))}
                      </select>
                    )}
                    {slot.kind === "script" && (
                      scripts.length === 0 ? (
                        <span className="flex-1 text-[10px] text-accent-danger italic">
                          Keine Scripts vorhanden — erst eines im Script-Runner anlegen.
                        </span>
                      ) : (
                        <select
                          value={slot.param}
                          onChange={(e) => updatePadBankSlot(idx, { param: e.target.value })}
                          className="flex-1 px-1.5 py-1 bg-bg-elevated border border-border-color rounded text-[11px] text-text-primary"
                        >
                          {scripts.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      )
                    )}
                    {slot.kind === "action" && (
                      <select
                        value={slot.param}
                        onChange={(e) => updatePadBankSlot(idx, { param: e.target.value })}
                        className="flex-1 px-1.5 py-1 bg-bg-elevated border border-border-color rounded text-[11px] text-text-primary"
                      >
                        {CHAIN_BUILDER_ACTIONS.map((a) => (
                          <option key={a.key} value={a.key}>{a.label}</option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => removePadBankSlot(idx)}
                      className="px-2 py-0.5 text-[10px] text-accent-danger hover:opacity-70"
                      title="Slot entfernen"
                    >×</button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={addPadBankSlot}
                  className="px-3 py-1 text-xs bg-bg-elevated hover:bg-accent-primary/20 text-text-primary rounded transition-colors"
                >
                  + Slot
                </button>
                <button
                  onClick={() => {
                    const entries = buildPadBankEntries();
                    if (entries.length > 0 && midi.isEnabled) midi.startAutoLearn(entries);
                  }}
                  disabled={!midi.isEnabled || padBankSlots.length === 0}
                  className="px-3 py-1 text-xs bg-accent-secondary/30 hover:bg-accent-secondary/50 text-accent-secondary rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ▶ Start Auto-Learn ({padBankSlots.length})
                </button>
                <button
                  onClick={resetPadBankSlots}
                  className="px-3 py-1 text-xs text-text-muted hover:text-text-primary ml-auto"
                  title="Auf 16 Perf-Pad-Slots zurücksetzen"
                >
                  Reset (16 Perf-Pads)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* User-Scripts binden (v1.78) ────────────────────────────────────── */}
      {!midi.isLearning && scripts.length > 0 && (
        <div>
          <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
            User-Scripts auf MIDI binden (v1.78)
          </div>
          <div className="text-xs text-text-dim mb-2">
            Klick ein Script an und bewege dann deinen Controller — bei jedem
            Trigger wird das Script in der Sandbox ausgeführt. Funktioniert
            mit jedem Built-In oder selbst-geschriebenen Script.
          </div>
          <div className="space-y-1.5">
            {scripts.map((s) => {
              const existing = midi.mappings.find(m =>
                m.target.type === "runScript" && m.target.scriptId === s.id,
              );
              return (
                <button
                  key={s.id}
                  onClick={() => midi.isEnabled && midi.startLearn({
                    type: "runScript",
                    scriptId: s.id,
                    scriptName: s.name,
                  })}
                  disabled={!midi.isEnabled}
                  className={`w-full flex items-center justify-between p-2 rounded text-left text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    existing
                      ? "bg-accent-primary/40 border border-accent-primary/50 hover:bg-accent-primary/60"
                      : "bg-bg-elevated hover:bg-bg-elevated"
                  }`}
                >
                  <div>
                    <div className="text-text-primary font-medium">{s.name}</div>
                    <div className="text-[10px] text-text-dim mt-0.5">
                      {s.enabled ? "✓ aktiviert" : "✗ deaktiviert"} · {s.code.length} Bytes
                    </div>
                  </div>
                  {existing && (
                    <span className="text-accent-secondary font-mono text-xs ml-1">
                      CC{existing.cc}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Aktive Mappings */}
      {midi.mappings.length > 0 && (
        <div>
          <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
            Aktive CC-Mappings ({midi.mappings.length})
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {midi.mappings.map((m, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 bg-bg-elevated rounded text-xs"
              >
                <div>
                  <span className="font-mono text-accent-secondary">CC{m.cc}</span>
                  {m.channel > 0 && (
                    <span className="text-text-dim ml-1">Ch{m.channel}</span>
                  )}
                  <span className="text-text-primary ml-2">{m.label}</span>
                </div>
                <button
                  onClick={() => midi.removeMapping(m.cc, m.channel)}
                  className="text-text-dim hover:text-accent-danger ml-2"
                  title="Mapping entfernen"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              const count = midi.mappings.length + midi.noteMappings.length;
              if (count > 0 && confirm(`Wirklich ${count} Mapping(s) löschen?`)) {
                midi.clearAllMappings();
                toast(`${count} Mapping(s) gelöscht`, { kind: "warning" });
              }
            }}
            className="mt-2 text-xs text-accent-danger hover:text-accent-danger/80"
          >
            Alle Mappings löschen
          </button>
        </div>
      )}

      {/* Export als JSON-Template (v1.73) ───────────────────────────────── */}
      {(midi.mappings.length > 0 || midi.noteMappings.length > 0) && (
        <div>
          <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
            Template speichern
          </div>
          <div className="text-xs text-text-dim mb-2">
            Exportiert die aktuellen CC- und Note-Mappings als JSON-Datei
            (synthstudioLayout v1). Wieder importierbar über die Einstellungen
            → „MIDI-Layout importieren". Kann zum Teilen weitergegeben werden.
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={exportName}
              onChange={(e) => { setExportName(e.target.value); setExportNameTouched(true); }}
              placeholder="Layout-Name"
              className="flex-1 px-2 py-1.5 bg-bg-elevated border border-border-color rounded text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-secondary"
            />
            <button
              onClick={handleExportLayout}
              className="px-3 py-1.5 bg-accent-secondary/30 hover:bg-accent-secondary/50 text-accent-secondary text-xs rounded font-medium transition-colors"
            >
              💾 Als JSON speichern
            </button>
          </div>
          {exportFeedback && (
            <div className="mt-2 text-xs text-accent-success">{exportFeedback}</div>
          )}
          <div className="mt-2 text-[10px] text-text-dim">
            {midi.mappings.length} CC-Mapping(s) + {midi.noteMappings.length} Note-Mapping(s)
            werden exportiert.
          </div>
        </div>
      )}
    </div>
  );

  // ─── Tab: Note-Mapping ────────────────────────────────────────────────────

  const renderNotesTab = () => (
    <div className="space-y-4">
      {/* GM Drum Defaults */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-text-muted uppercase tracking-wider">
            Note → Part Zuweisungen
          </div>
          <button
            onClick={() => {
              // GM-Defaults laden
              parts.forEach((part, i) => {
                const gm = GM_DRUM_DEFAULTS[i];
                if (gm) {
                  midi.addNoteMapping(gm.note, 0, part.id, `${part.name} (GM ${gm.note})`);
                }
              });
            }}
            className="text-xs text-accent-secondary hover:text-accent-secondary"
          >
            GM-Defaults laden
          </button>
        </div>

        {/* Manuelle Zuweisung */}
        <div className="p-3 bg-bg-elevated rounded-lg space-y-2 mb-3">
          <div className="text-xs text-text-muted font-medium">Manuelle Zuweisung</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-text-dim block mb-1">MIDI-Note</label>
              <input
                type="number"
                min={0}
                max={127}
                value={manualNote}
                onChange={e => setManualNote(Number(e.target.value))}
                className="w-full bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded border border-border-color"
              />
              <div className="text-xs text-text-dim mt-0.5">{noteToName(manualNote)}</div>
            </div>
            <div>
              <label className="text-xs text-text-dim block mb-1">Kanal (0=alle)</label>
              <input
                type="number"
                min={0}
                max={16}
                value={manualChannel}
                onChange={e => setManualChannel(Number(e.target.value))}
                className="w-full bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded border border-border-color"
              />
            </div>
            <div>
              <label className="text-xs text-text-dim block mb-1">Part</label>
              <select
                value={noteLearnPartId ?? (parts[0]?.id ?? "")}
                onChange={e => setNoteLearnPartId(e.target.value)}
                className="w-full bg-bg-elevated text-text-primary text-xs px-2 py-1 rounded border border-border-color"
              >
                {parts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={() => {
              const partId = noteLearnPartId ?? parts[0]?.id;
              if (!partId) return;
              const partName = parts.find(p => p.id === partId)?.name ?? partId;
              midi.addNoteMapping(manualNote, manualChannel, partId, `${partName} (${noteToName(manualNote)})`);
            }}
            className="w-full py-1.5 bg-accent-primary/70 hover:bg-accent-primary text-bg-base text-xs rounded"
          >
            Zuweisung hinzufügen
          </button>
        </div>

        {/* Aktive Note-Mappings */}
        {midi.noteMappings.length > 0 ? (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {midi.noteMappings.map((m, i) => {
              const partName = parts.find(p => p.id === m.partId)?.name ?? m.partId;
              return (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 bg-bg-elevated rounded text-xs"
                >
                  <div>
                    <span className="font-mono text-accent-secondary">{noteToName(m.note)}</span>
                    <span className="text-text-dim ml-1 font-mono">(#{m.note})</span>
                    {m.channel > 0 && (
                      <span className="text-text-dim ml-1">Ch{m.channel}</span>
                    )}
                    <span className="text-text-primary ml-2">→ {partName}</span>
                  </div>
                  <button
                    onClick={() => midi.removeNoteMapping(m.note, m.channel)}
                    className="text-text-dim hover:text-accent-danger ml-2"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-text-dim text-center py-3">
            Keine Note-Mappings. GM-Defaults laden oder manuell hinzufügen.
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: MIDI-Clock ──────────────────────────────────────────────────────

  // ─── Tab: Monitor (v1.81) ──────────────────────────────────────────────
  /** Pretty-print für eine Monitor-Zeile. v1.95: zeigt zusätzlich das
   *  gebundene Target falls vorhanden (CC → "→ Volume: Kick" o.ä.). */
  const formatMonitorEntry = (m: { type: number; channel: number; byte1: number; byte2: number; at: number }) => {
    const time = new Date(m.at).toISOString().slice(11, 23); // HH:MM:SS.mmm
    let what: string;
    let bindingHint = "";
    if (m.type === 0x90) {
      what = `Note On  ${m.byte1.toString().padStart(3)} vel=${m.byte2}`;
      const nm = midi.noteMappings.find(n => n.note === m.byte1 && (n.channel === 0 || n.channel === m.channel));
      if (nm) bindingHint = `  → Pad ${nm.label}`;
    } else if (m.type === 0x80) {
      what = `Note Off ${m.byte1.toString().padStart(3)}`;
    } else if (m.type === 0xb0) {
      what = `CC       ${m.byte1.toString().padStart(3)} = ${m.byte2}`;
      const cm = midi.mappings.find(c => c.cc === m.byte1 && (c.channel === 0 || c.channel === m.channel));
      if (cm) bindingHint = `  → ${cm.label}`;
    } else if (m.type === 0xa0) {
      what = `Poly AT  ${m.byte1.toString().padStart(3)} = ${m.byte2}`;
    } else if (m.type === 0xd0) {
      what = `Ch AT    val=${m.byte1}`;
    } else if (m.type === 0xe0) {
      what = `PB       ${(m.byte1 | (m.byte2 << 7)).toString().padStart(5)}`;
    } else {
      what = `0x${m.type.toString(16)}    b1=${m.byte1} b2=${m.byte2}`;
    }
    return `${time}  Ch${m.channel.toString().padStart(2)}  ${what}${bindingHint}`;
  };

  const renderMonitorTab = () => (
    <div className="space-y-3">
      <div className="text-xs text-text-dim">
        Live-Log aller eingehender MIDI-Messages. Hilft beim Debuggen:
        Welche CCs sendet dein Controller? Auf welchen Channels? Sind
        Knobs/Slider 7-bit oder 14-bit?
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMonitorPaused(!monitorPaused)}
          className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
            monitorPaused
              ? "bg-accent-secondary/30 text-accent-secondary hover:bg-accent-secondary/50"
              : "bg-bg-elevated text-text-primary hover:bg-bg-elevated"
          }`}
          data-testid="midi-monitor-pause"
        >
          {monitorPaused ? "▶ Fortsetzen" : "⏸ Pause"}
        </button>
        <button
          onClick={() => setMonitorLog([])}
          className="px-3 py-1 text-xs bg-bg-elevated hover:bg-accent-danger/20 text-text-primary rounded transition-colors"
          data-testid="midi-monitor-clear"
        >
          🗑 Leeren
        </button>
        <div className="text-[10px] text-text-dim ml-auto">
          {monitorLog.length}/200 Events
        </div>
      </div>
      <div
        className="bg-bg-elevated rounded p-2 h-72 overflow-y-auto font-mono text-[11px] leading-tight"
        data-testid="midi-monitor-log"
      >
        {monitorLog.length === 0 ? (
          <div className="text-text-dim italic text-center py-8">
            {midi.isEnabled
              ? "Warte auf MIDI-Events … bewege einen Slider oder drücke einen Pad."
              : "MIDI ist nicht aktiviert. Geh zum Tab 'Geräte' und aktiviere Web MIDI."}
          </div>
        ) : (
          monitorLog.slice().reverse().map((m, idx) => {
            const fresh = Date.now() - m.at < 500;
            return (
              <div
                key={idx}
                className={`whitespace-pre transition-colors ${
                  fresh ? "text-accent-secondary" : "text-text-muted"
                }`}
              >
                {formatMonitorEntry(m)}
              </div>
            );
          })
        )}
      </div>
      <div className="text-[10px] text-text-dim">
        Format: <code>HH:MM:SS.mmm  Ch{"<n>"}  &lt;Type&gt;  &lt;Data&gt;</code> · Neueste oben ·
        Max. 200 Events (Ringbuffer)
      </div>
    </div>
  );

  const renderClockTab = () => (
    <div className="space-y-4">
      <div className="p-3 bg-bg-elevated rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium text-text-primary">MIDI-Clock Sync</div>
            <div className="text-xs text-text-muted mt-0.5">
              BPM von externem Gerät oder DAW übernehmen
            </div>
          </div>
          <button
            onClick={() => midi.setClockSync(!midi.clockSync)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              midi.clockSync ? "bg-accent-primary" : "bg-bg-elevated"
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-text-primary rounded-full shadow transition-transform ${
              midi.clockSync ? "translate-x-5" : "translate-x-0.5"
            }`} />
          </button>
        </div>

        {midi.clockSync && (
          <div className="mt-3 p-2 bg-bg-elevated rounded text-center">
            {midi.externalBpm !== null ? (
              <div>
                <div className="text-2xl font-mono text-accent-secondary font-bold">
                  {midi.externalBpm.toFixed(1)}
                </div>
                <div className="text-xs text-text-muted">BPM (extern)</div>
              </div>
            ) : (
              <div className="text-xs text-text-muted">
                Warte auf MIDI-Clock Signal...
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-3 bg-bg-elevated/50 rounded text-xs text-text-muted space-y-1">
        <div className="font-medium text-text-primary mb-1">Hinweise:</div>
        <div>• MIDI-Clock sendet 24 Pulse pro Viertelnote (PPQN)</div>
        <div>• Kompatibel mit DAWs: Ableton, FL Studio, Logic, Cubase</div>
        <div>• Hardware: Roland, Korg, Akai, Arturia MIDI-Controller</div>
        <div>• MIDI-Start (0xFA) und Stop (0xFC) werden als Play/Stop interpretiert</div>
      </div>
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  // v2.2: Tab-Labels enthalten Mapping-Counts für quick-Discoverability
  const tabs = [
    { id: "devices"   as const, label: "Geräte", badge: midi.devices.length > 0 ? String(midi.devices.length) : "" },
    { id: "templates" as const, label: "Vorlagen", badge: userTemplates.length > 0 ? String(userTemplates.length) : "" },
    { id: "cc"        as const, label: "CC-Mapping", badge: midi.mappings.length > 0 ? String(midi.mappings.length) : "" },
    { id: "notes"     as const, label: "Note-Mapping", badge: midi.noteMappings.length > 0 ? String(midi.noteMappings.length) : "" },
    { id: "monitor"   as const, label: "Monitor", badge: monitorLog.length > 0 ? String(monitorLog.length) : "" },
    { id: "clock"     as const, label: "Clock-Sync", badge: midi.clockSync ? "in" : midi.clockOutEnabled ? "out" : "" },
  ];

  const renderTemplatesTab = () => (
    <div className="space-y-3">
      <div className="bg-bg-elevated rounded-lg p-3 text-xs text-text-muted">
        Wähle eine Vorlage für deinen Hardware-Controller. <strong className="text-text-primary">Achtung:</strong> Alle aktuellen Mappings werden überschrieben.
      </div>

      {/* v1.96: Aktuelle Mappings als User-Template speichern */}
      {(midi.mappings.length > 0 || midi.noteMappings.length > 0) && (
        <div className="border border-accent-secondary/30 rounded-lg p-3 bg-accent-secondary/10">
          <div className="text-xs font-medium text-accent-secondary mb-2 uppercase tracking-wider">
            Aktuelles Setup speichern
          </div>
          <div className="text-xs text-text-dim mb-2">
            {midi.mappings.length} CC + {midi.noteMappings.length} Note Mappings als wiederverwendbares Template ablegen.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={userTplName}
              onChange={(e) => setUserTplName(e.target.value)}
              placeholder={defaultExportNameFromDevice()}
              className="flex-1 px-2 py-1.5 bg-bg-elevated border border-border-color rounded text-xs text-text-primary focus:outline-none focus:border-accent-secondary"
            />
            <button
              onClick={() => {
                const name = userTplName.trim() || defaultExportNameFromDevice();
                const dev = midi.devices.find(d => d.id === midi.activeDeviceId);
                saveUserMidiTemplate({
                  name,
                  deviceName: dev?.name,
                  ccMappings: midi.mappings,
                  noteMappings: midi.noteMappings,
                });
                setUserTplName("");
                toast(`Template gespeichert: „${name}"`, { kind: "success" });
              }}
              className="px-3 py-1.5 bg-accent-secondary text-bg-base hover:bg-accent-secondary/80 text-xs rounded font-medium"
            >
              💾 Speichern
            </button>
          </div>
        </div>
      )}

      {/* v1.96: Gespeicherte User-Templates */}
      {userTemplates.length > 0 && (
        <div>
          <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
            Meine Templates ({userTemplates.length})
          </div>
          <div className="space-y-1.5">
            {userTemplates.map((t) => (
              <div key={t.id} className="border border-accent-primary/40 rounded p-2 bg-accent-primary/5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-text-primary truncate">{t.name}</span>
                      <span className="text-[10px] text-text-dim flex-shrink-0">
                        {new Date(t.updatedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    </div>
                    {t.deviceName && (
                      <div className="text-[10px] text-text-dim mt-0.5">📡 {t.deviceName}</div>
                    )}
                    <div className="flex gap-3 text-[10px] text-text-dim mt-1">
                      <span>{t.ccMappings.length} CC</span>
                      <span>·</span>
                      <span>{t.noteMappings.length} Notes</span>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        if (confirm(`Template "${t.name}" laden?\n\nDas ersetzt alle aktuellen Mappings.`)) {
                          midi.loadTemplate(t.ccMappings, t.noteMappings);
                          toast(`Template „${t.name}" geladen (${t.ccMappings.length} CC + ${t.noteMappings.length} Notes)`, { kind: "success" });
                        }
                      }}
                      className="px-2 py-1 text-xs rounded bg-accent-primary text-bg-base hover:bg-accent-primary/80"
                    >
                      Laden
                    </button>
                    <button
                      onClick={() => {
                        const newName = window.prompt("Neuer Name:", t.name);
                        if (newName && newName.trim().length > 0) renameUserMidiTemplate(t.id, newName);
                      }}
                      className="px-1.5 py-1 text-[10px] text-text-dim hover:text-text-primary"
                      title="Umbenennen"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Template "${t.name}" löschen?`)) {
                          deleteUserMidiTemplate(t.id);
                          toast(`Template „${t.name}" gelöscht`, { kind: "warning" });
                        }
                      }}
                      className="px-1.5 py-1 text-[10px] text-text-dim hover:text-accent-danger"
                      title="Löschen"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Eingebaute Hardware-Templates */}
      <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
        Eingebaute Hardware-Templates
      </div>
      <div className="space-y-2">
        {MIDI_TEMPLATES.map(t => (
          <div key={t.id} className="border border-border-color rounded-lg p-3 bg-bg-elevated/50">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">{t.name}</span>
                  <span className="text-[10px] text-text-dim">{t.manufacturer}</span>
                </div>
                <p className="text-xs text-text-muted mt-1 leading-snug">{t.description}</p>
                <div className="flex gap-3 mt-2 text-[10px] text-text-dim">
                  <span>{t.ccMappings.length} CC-Mappings</span>
                  <span>·</span>
                  <span>{t.noteMappings.length} Note-Mappings</span>
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Vorlage "${t.name}" laden?\n\nDas ersetzt alle aktuellen Mappings.`)) {
                    const partResolver = (id: string) => {
                      const partIndex = parseInt(id.replace("part-", ""), 10);
                      return parts[partIndex]?.name ?? parts[partIndex]?.id;
                    };
                    const { cc, notes } = templateToMappings(t, partResolver);
                    // Mappings auf reale Part-IDs übersetzen
                    const resolvedNotes = notes.map(n => {
                      const partIndex = parseInt(n.partId.replace("part-", ""), 10);
                      const realPart = parts[partIndex];
                      return { ...n, partId: realPart?.id ?? n.partId, label: realPart?.name ?? n.label };
                    });
                    midi.loadTemplate(cc, resolvedNotes);
                    toast(`Hardware-Template „${t.name}" geladen (${cc.length} CC + ${resolvedNotes.length} Notes)`, { kind: "success" });
                  }
                }}
                className="px-3 py-1.5 rounded text-xs font-medium bg-accent-primary text-bg-base hover:bg-accent-primary/80 flex-shrink-0"
              >
                Laden
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-bg-panel border border-border-color rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-color">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎹</span>
            <h2 className="text-base font-semibold text-text-primary">MIDI-Einstellungen</h2>
            {midi.isEnabled && (
              <span className="w-2 h-2 rounded-full bg-accent-success animate-pulse" />
            )}
            {/* v1.79: Live-Activity-Indicator — flasht grün bei eingehender MIDI-Message */}
            {midi.isEnabled && lastActivity && (
              <span
                title={`Letzte MIDI-Message: ${formatActivity(lastActivity)}`}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all duration-150 ${
                  activityPulse
                    ? "bg-accent-secondary text-bg-base"
                    : "bg-bg-elevated text-text-dim"
                }`}
                data-testid="midi-activity-indicator"
              >
                ● {formatActivity(lastActivity).split(" (")[0]}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary leading-none p-1 rounded flex items-center justify-center transition-colors"
            aria-label="Close"
            title="Schließen"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-color">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-accent-secondary border-b-2 border-accent-secondary"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {tab.label}
              {tab.badge && (
                <span className={`ml-1 px-1 rounded text-[9px] font-mono ${
                  activeTab === tab.id
                    ? "bg-accent-secondary text-bg-base"
                    : "bg-bg-elevated text-text-dim"
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab-Inhalt */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {activeTab === "devices" && renderDevicesTab()}
          {activeTab === "templates" && renderTemplatesTab()}
          {activeTab === "cc" && renderCcTab()}
          {activeTab === "notes" && renderNotesTab()}
          {activeTab === "monitor" && renderMonitorTab()}
          {activeTab === "clock" && renderClockTab()}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 py-3 border-t border-border-color">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-bg-elevated hover:bg-bg-elevated text-text-primary text-sm rounded"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
