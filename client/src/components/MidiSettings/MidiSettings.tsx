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

import React, { useState } from "react";
import type { MidiState, MidiActions, MidiLearnTarget, MidiNoteMapping } from "@/hooks/useMidi";
import { GM_DRUM_DEFAULTS } from "@/hooks/useMidi";

interface MidiSettingsProps {
  midi: MidiState & MidiActions;
  parts: Array<{ id: string; name: string }>;
  onClose: () => void;
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function targetLabel(target: MidiLearnTarget): string {
  switch (target.type) {
    case "bpm": return "BPM";
    case "volume": return `Lautstärke`;
    case "mute": return `Mute`;
    case "playStop": return "Play/Stop";
    case "pattern": return `Pattern ${target.patternIndex + 1}`;
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
  const [activeTab, setActiveTab] = useState<"devices" | "cc" | "notes" | "clock">("devices");
  const [noteLearnPartId, setNoteLearnPartId] = useState<string | null>(null);
  const [noteLearnChannel, setNoteLearnChannel] = useState(0);
  const [manualNote, setManualNote] = useState(36);
  const [manualChannel, setManualChannel] = useState(0);

  // ─── Tab: Geräte ──────────────────────────────────────────────────────────

  const renderDevicesTab = () => (
    <div className="space-y-4">
      {/* MIDI aktivieren */}
      <div className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
        <div>
          <div className="text-sm font-medium text-gray-200">Web MIDI API</div>
          <div className="text-xs text-gray-400 mt-0.5">
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
              ? "bg-cyan-600 hover:bg-cyan-700 text-white"
              : "bg-gray-600 hover:bg-gray-500 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
          }`}
        >
          {midi.isEnabled ? "Deaktivieren" : "Aktivieren"}
        </button>
      </div>

      {/* Gerät auswählen */}
      {midi.isEnabled && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
            MIDI-Eingabegerät
          </label>
          {midi.devices.length === 0 ? (
            <div className="p-3 bg-gray-800 rounded text-sm text-gray-400 text-center">
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
                      ? "bg-cyan-900 border border-cyan-600"
                      : "bg-gray-800 hover:bg-gray-700 border border-transparent"
                  }`}
                >
                  <div>
                    <div className="text-sm text-gray-200">{device.name}</div>
                    {device.manufacturer && (
                      <div className="text-xs text-gray-500">{device.manufacturer}</div>
                    )}
                  </div>
                  <div className={`w-2 h-2 rounded-full ${
                    device.state === "connected" ? "bg-green-400" : "bg-gray-600"
                  }`} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status */}
      {midi.isEnabled && midi.activeDeviceId && (
        <div className="p-2 bg-green-900/30 border border-green-700/50 rounded text-xs text-green-400 text-center">
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

  const renderCcTab = () => (
    <div className="space-y-4">
      {/* MIDI-Learn */}
      <div>
        <div className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
          MIDI-Learn
        </div>
        {midi.isLearning ? (
          <div className="p-3 bg-yellow-900/40 border border-yellow-600/50 rounded-lg">
            <div className="text-sm text-yellow-300 font-medium mb-1">
              Warte auf CC-Nachricht...
            </div>
            <div className="text-xs text-yellow-400 mb-3">
              Bewege einen Regler oder Knopf an deinem MIDI-Controller.
              Ziel: <strong>{midi.learnTarget ? targetLabel(midi.learnTarget) : "–"}</strong>
            </div>
            <button
              onClick={midi.cancelLearn}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs rounded"
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
                      ? "bg-cyan-900/40 border border-cyan-700/50 hover:bg-cyan-900/60"
                      : "bg-gray-800 hover:bg-gray-700"
                  }`}
                >
                  <span className="text-gray-300">{label}</span>
                  {existing && (
                    <span className="text-cyan-400 font-mono text-xs ml-1">
                      CC{existing.cc}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Aktive Mappings */}
      {midi.mappings.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wider">
            Aktive CC-Mappings ({midi.mappings.length})
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {midi.mappings.map((m, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 bg-gray-800 rounded text-xs"
              >
                <div>
                  <span className="font-mono text-cyan-400">CC{m.cc}</span>
                  {m.channel > 0 && (
                    <span className="text-gray-500 ml-1">Ch{m.channel}</span>
                  )}
                  <span className="text-gray-300 ml-2">{m.label}</span>
                </div>
                <button
                  onClick={() => midi.removeMapping(m.cc, m.channel)}
                  className="text-gray-500 hover:text-red-400 ml-2"
                  title="Mapping entfernen"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={midi.clearAllMappings}
            className="mt-2 text-xs text-red-400 hover:text-red-300"
          >
            Alle Mappings löschen
          </button>
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
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wider">
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
            className="text-xs text-cyan-400 hover:text-cyan-300"
          >
            GM-Defaults laden
          </button>
        </div>

        {/* Manuelle Zuweisung */}
        <div className="p-3 bg-gray-800 rounded-lg space-y-2 mb-3">
          <div className="text-xs text-gray-400 font-medium">Manuelle Zuweisung</div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">MIDI-Note</label>
              <input
                type="number"
                min={0}
                max={127}
                value={manualNote}
                onChange={e => setManualNote(Number(e.target.value))}
                className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600"
              />
              <div className="text-xs text-gray-500 mt-0.5">{noteToName(manualNote)}</div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Kanal (0=alle)</label>
              <input
                type="number"
                min={0}
                max={16}
                value={manualChannel}
                onChange={e => setManualChannel(Number(e.target.value))}
                className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Part</label>
              <select
                value={noteLearnPartId ?? (parts[0]?.id ?? "")}
                onChange={e => setNoteLearnPartId(e.target.value)}
                className="w-full bg-gray-700 text-gray-200 text-xs px-2 py-1 rounded border border-gray-600"
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
            className="w-full py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white text-xs rounded"
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
                  className="flex items-center justify-between p-2 bg-gray-800 rounded text-xs"
                >
                  <div>
                    <span className="font-mono text-cyan-400">{noteToName(m.note)}</span>
                    <span className="text-gray-500 ml-1 font-mono">(#{m.note})</span>
                    {m.channel > 0 && (
                      <span className="text-gray-500 ml-1">Ch{m.channel}</span>
                    )}
                    <span className="text-gray-300 ml-2">→ {partName}</span>
                  </div>
                  <button
                    onClick={() => midi.removeNoteMapping(m.note, m.channel)}
                    className="text-gray-500 hover:text-red-400 ml-2"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-gray-500 text-center py-3">
            Keine Note-Mappings. GM-Defaults laden oder manuell hinzufügen.
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: MIDI-Clock ──────────────────────────────────────────────────────

  const renderClockTab = () => (
    <div className="space-y-4">
      <div className="p-3 bg-gray-800 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-sm font-medium text-gray-200">MIDI-Clock Sync</div>
            <div className="text-xs text-gray-400 mt-0.5">
              BPM von externem Gerät oder DAW übernehmen
            </div>
          </div>
          <button
            onClick={() => midi.setClockSync(!midi.clockSync)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              midi.clockSync ? "bg-cyan-600" : "bg-gray-600"
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              midi.clockSync ? "translate-x-5" : "translate-x-0.5"
            }`} />
          </button>
        </div>

        {midi.clockSync && (
          <div className="mt-3 p-2 bg-gray-700 rounded text-center">
            {midi.externalBpm !== null ? (
              <div>
                <div className="text-2xl font-mono text-cyan-400 font-bold">
                  {midi.externalBpm.toFixed(1)}
                </div>
                <div className="text-xs text-gray-400">BPM (extern)</div>
              </div>
            ) : (
              <div className="text-xs text-gray-400">
                Warte auf MIDI-Clock Signal...
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-3 bg-gray-800/50 rounded text-xs text-gray-400 space-y-1">
        <div className="font-medium text-gray-300 mb-1">Hinweise:</div>
        <div>• MIDI-Clock sendet 24 Pulse pro Viertelnote (PPQN)</div>
        <div>• Kompatibel mit DAWs: Ableton, FL Studio, Logic, Cubase</div>
        <div>• Hardware: Roland, Korg, Akai, Arturia MIDI-Controller</div>
        <div>• MIDI-Start (0xFA) und Stop (0xFC) werden als Play/Stop interpretiert</div>
      </div>
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  const tabs = [
    { id: "devices" as const, label: "Geräte" },
    { id: "cc" as const, label: "CC-Mapping" },
    { id: "notes" as const, label: "Note-Mapping" },
    { id: "clock" as const, label: "Clock-Sync" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎹</span>
            <h2 className="text-base font-semibold text-gray-100">MIDI-Einstellungen</h2>
            {midi.isEnabled && (
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-cyan-400 border-b-2 border-cyan-400"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab-Inhalt */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {activeTab === "devices" && renderDevicesTab()}
          {activeTab === "cc" && renderCcTab()}
          {activeTab === "notes" && renderNotesTab()}
          {activeTab === "clock" && renderClockTab()}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
