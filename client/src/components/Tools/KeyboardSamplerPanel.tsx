/**
 * Synthstudio – KeyboardSamplerPanel
 *
 * Multi-Sample Keyboard Mapping UI.
 * Zeigt eine Piano-Tastatur mit farbigen Sample-Zonen.
 * Drag & Drop von Samples aus dem Browser auf Tasten.
 */
import React, { useState, useCallback } from "react";
import {
  useKeyboardSamplerStore,
  addSampleZone,
  removeSampleZone,
  updateSampleZone,
  setKeyboardSamplerEnabled,
  type SampleZone,
} from "@/store/useKeyboardSamplerStore";
import { AudioEngine } from "@/audio/AudioEngine";
import type { Sample } from "@/store/useProjectStore";

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const BLACK_KEYS = [1,3,6,8,10]; // Halbtöne im Oktavbereich
const ZONE_COLORS = ["#f59e0b","#06b6d4","#10b981","#f43f5e","#a855f7","#ff6b35","#0ea5e9","#84cc16"];

function noteToName(midi: number) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

interface MiniKeyboardProps {
  zones: SampleZone[];
  onDropSample: (note: number, sample: Sample) => void;
  startNote?: number;
  endNote?: number;
}

function MiniKeyboard({ zones, onDropSample, startNote = 36, endNote = 84 }: MiniKeyboardProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const handleNoteOn = useCallback((midi: number) => {
    setActive(midi);
    AudioEngine.triggerKeyboardSamplerNote(midi, 100);
  }, []);

  const handleNoteOff = useCallback(() => {
    setActive(null);
  }, []);

  const getZoneColor = (note: number) => {
    const zone = zones.find(z => note >= z.loNote && note <= z.hiNote);
    if (!zone) return null;
    const idx = zones.indexOf(zone) % ZONE_COLORS.length;
    return ZONE_COLORS[idx];
  };

  const keys = [];
  for (let midi = startNote; midi <= endNote; midi++) {
    const semitone = midi % 12;
    const isBlack  = BLACK_KEYS.includes(semitone);
    const color    = getZoneColor(midi);
    keys.push({ midi, isBlack, color });
  }

  const whiteKeys  = keys.filter(k => !k.isBlack);
  const whiteCount = whiteKeys.length;

  return (
    <div className="relative overflow-hidden rounded border border-border-color" style={{ height: 80 }}>
      {/* Weiße Tasten */}
      <div className="flex h-full">
        {whiteKeys.map(({ midi, color }) => (
          <div key={midi}
            style={{
              width: `${100 / whiteCount}%`,
              background: active === midi ? "var(--ss-accent-primary)" : color ?? (hovered === midi ? "var(--ss-bg-elevated)" : "white"),
              borderRight: "1px solid var(--ss-border)",
              borderBottom: color ? `3px solid ${color}` : "none",
              opacity: color ? 0.9 : 1,
              position: "relative",
              cursor: "pointer",
            }}
            onMouseEnter={() => setHovered(midi)}
            onMouseLeave={() => { setHovered(null); handleNoteOff(); }}
            onMouseDown={() => handleNoteOn(midi)}
            onMouseUp={handleNoteOff}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              const sUrl  = e.dataTransfer.getData("sampleUrl");
              const sName = e.dataTransfer.getData("sampleName");
              if (sUrl) onDropSample(midi, { id: "", name: sName, path: sUrl, category: "" });
            }}
            title={`${noteToName(midi)} (MIDI ${midi})`}
          >
            {midi % 12 === 0 && (
              <span style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", fontSize: 8, color: "#666" }}>
                {noteToName(midi)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Schwarze Tasten (overlay) */}
      <div className="absolute top-0 left-0 right-0 flex pointer-events-none" style={{ height: "55%" }}>
        {keys.map(({ midi, isBlack, color }) => {
          if (!isBlack) return <div key={midi} style={{ flex: "0 0 " + `${100/whiteCount}%` }} />;
          // Position berechnen: schwarze Tasten rechts von der vorherigen weißen Taste
          return null; // Vereinfachung: weiße Tasten reichen für MVP
        })}
      </div>
    </div>
  );
}

interface KeyboardSamplerPanelProps {
  samples: Sample[];
}

export function KeyboardSamplerPanel({ samples }: KeyboardSamplerPanelProps) {
  const state = useKeyboardSamplerStore();
  const [editZone, setEditZone] = useState<string | null>(null);
  const [newLo, setNewLo]  = useState(60);
  const [newHi, setNewHi]  = useState(72);
  const [newRoot, setNewRoot] = useState(60);
  const [selectedSample, setSelectedSample] = useState<string>("");

  const handleDrop = useCallback((note: number, sample: Sample) => {
    addSampleZone({
      sampleUrl: sample.path, sampleName: sample.name,
      loNote: Math.max(0, note - 6), hiNote: Math.min(127, note + 6),
      rootNote: note, loVelocity: 0, hiVelocity: 127, volume: 1, pan: 0,
    });
  }, []);

  const handleAdd = useCallback(() => {
    const sample = samples.find(s => s.path === selectedSample);
    if (!sample) return;
    addSampleZone({
      sampleUrl: sample.path, sampleName: sample.name,
      loNote: newLo, hiNote: newHi, rootNote: newRoot,
      loVelocity: 0, hiVelocity: 127, volume: 1, pan: 0,
    });
  }, [selectedSample, samples, newLo, newHi, newRoot]);

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Keyboard Sampler</span>
        <label className="flex items-center gap-1 text-[10px] text-text-dim cursor-pointer">
          <input type="checkbox" checked={state.enabled}
            onChange={e => setKeyboardSamplerEnabled(e.target.checked)} className="accent-accent-primary" />
          Aktiv
        </label>
        <span className="text-[10px] text-text-dim">{state.zones.length} Zonen</span>
      </div>

      {/* Tastatur */}
      <MiniKeyboard zones={state.zones} onDropSample={handleDrop} />
      <p className="text-[10px] text-text-dim">Sample aus dem Browser auf eine Taste ziehen um eine Zone zu erstellen.</p>

      {/* Neue Zone manuell */}
      <div className="border-t border-border-color pt-3 space-y-2">
        <div className="text-[10px] text-text-muted font-semibold">Zone manuell hinzufügen</div>
        <div className="flex gap-2 flex-wrap">
          <select value={selectedSample} onChange={e => setSelectedSample(e.target.value)}
            className="flex-1 text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary">
            <option value="">Sample wählen…</option>
            {samples.map(s => <option key={s.id} value={s.path}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex gap-2 flex-wrap text-[10px]">
          {[["Lo Note", newLo, setNewLo], ["Hi Note", newHi, setNewHi], ["Root", newRoot, setNewRoot]].map(([label, val, setter]) => (
            <div key={String(label)} className="flex items-center gap-1">
              <span className="text-text-dim">{String(label)}:</span>
              <input type="number" min={0} max={127} value={Number(val)}
                onChange={e => (setter as (v: number) => void)(Number(e.target.value))}
                className="w-12 bg-bg-elevated border border-border-color rounded px-1 py-0.5 text-text-primary" />
              <span className="text-text-dim font-mono">{noteToName(Number(val))}</span>
            </div>
          ))}
          <button onClick={handleAdd} disabled={!selectedSample}
            className="px-3 py-0.5 rounded bg-accent-primary text-white text-[10px] hover:opacity-80 disabled:opacity-40 font-bold">
            + Zone
          </button>
        </div>
      </div>

      {/* Zonen-Liste */}
      {state.zones.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {state.zones.map((zone, idx) => (
            <div key={zone.id} className="flex items-center gap-2 px-2 py-1 rounded bg-bg-elevated text-xs">
              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: ZONE_COLORS[idx % ZONE_COLORS.length] }} />
              <span className="flex-1 truncate text-text-primary">{zone.sampleName}</span>
              <span className="text-text-dim font-mono">{noteToName(zone.loNote)}–{noteToName(zone.hiNote)}</span>
              <span className="text-text-dim font-mono">Root:{noteToName(zone.rootNote)}</span>
              <button onClick={() => removeSampleZone(zone.id)} className="text-text-dim hover:text-accent-danger">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
