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
import { MIDI_TEMPLATES, templateToMappings } from "@/utils/midiTemplates";

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
  const [activeTab, setActiveTab] = useState<"devices" | "templates" | "cc" | "notes" | "clock">("devices");
  const [noteLearnPartId, setNoteLearnPartId] = useState<string | null>(null);
  const [noteLearnChannel, setNoteLearnChannel] = useState(0);
  const [manualNote, setManualNote] = useState(36);
  const [manualChannel, setManualChannel] = useState(0);

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
              ? "bg-accent-primary hover:bg-accent-primary/70 text-white"
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
                    device.state === "connected" ? "bg-green-400" : "bg-bg-elevated"
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
        <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
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
                      ? "bg-accent-primary/40 border border-cyan-700/50 hover:bg-accent-primary/60"
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
                  className="text-text-dim hover:text-red-400 ml-2"
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
            className="w-full py-1.5 bg-accent-primary/70 hover:bg-accent-primary text-white text-xs rounded"
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
                    className="text-text-dim hover:text-red-400 ml-2"
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
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
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

  const tabs = [
    { id: "devices"   as const, label: "Geräte" },
    { id: "templates" as const, label: "Vorlagen" },
    { id: "cc"        as const, label: "CC-Mapping" },
    { id: "notes"     as const, label: "Note-Mapping" },
    { id: "clock"     as const, label: "Clock-Sync" },
  ];

  const renderTemplatesTab = () => (
    <div className="space-y-3">
      <div className="bg-bg-elevated rounded-lg p-3 text-xs text-text-muted">
        Wähle eine Vorlage für deinen Hardware-Controller. <strong className="text-text-primary">Achtung:</strong> Alle aktuellen Mappings werden überschrieben.
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
                  }
                }}
                className="px-3 py-1.5 rounded text-xs font-medium bg-accent-primary text-white hover:bg-accent-primary/80 flex-shrink-0"
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
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-xl leading-none"
          >
            ✕
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
            </button>
          ))}
        </div>

        {/* Tab-Inhalt */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {activeTab === "devices" && renderDevicesTab()}
          {activeTab === "templates" && renderTemplatesTab()}
          {activeTab === "cc" && renderCcTab()}
          {activeTab === "notes" && renderNotesTab()}
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
