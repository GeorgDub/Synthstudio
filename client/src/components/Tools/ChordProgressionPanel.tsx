/**
 * Synthstudio – ChordProgressionPanel
 *
 * Generiert Akkordfolgen und überträgt sie in den Piano Roll / Arpeggiator.
 */
import React, { useState, useMemo } from "react";
import {
  generateProgression,
  NOTE_NAMES_SHARP,
  MODAL_INTERVALS,
  type Mode,
  type ProgressionStyle,
  type ChordProgression,
} from "@/utils/chordProgressions";

const MODES: Mode[] = ["major","dorian","phrygian","lydian","mixolydian","minor","locrian"];
const MODE_LABELS: Record<Mode, string> = {
  major: "Dur (Ionian)", dorian: "Dorisch", phrygian: "Phrygisch",
  lydian: "Lydisch", mixolydian: "Mixolydisch", minor: "Moll (Aeolisch)", locrian: "Lokrisch",
};
const STYLES: ProgressionStyle[] = ["I-IV-V-I","I-V-vi-IV","ii-V-I","I-vi-IV-V","vi-IV-I-V","I-IV-vi-V","random"];

interface Props {
  bpm: number;
  onApply?: (prog: ChordProgression) => void;
}

function ChordCard({ chord, isActive, onClick }: { chord: ReturnType<typeof generateProgression>["chords"][0]; isActive: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex-1 p-2 rounded border text-center transition-all ${isActive ? "border-accent-primary bg-accent-primary/15" : "border-border-color bg-bg-elevated hover:border-accent-primary/50"}`}>
      <div className={`text-sm font-bold ${isActive ? "text-accent-primary" : "text-text-primary"}`}>
        {chord.rootName}
      </div>
      <div className="text-[10px] text-text-dim">{chord.stepRoman}</div>
      <div className="flex gap-0.5 justify-center mt-1">
        {chord.notes.map((n, i) => (
          <div key={i} className="text-[9px] font-mono text-text-dim">{n.name}</div>
        ))}
      </div>
    </button>
  );
}

export function ChordProgressionPanel({ bpm, onApply }: Props) {
  const [key,    setKey]    = useState(0);
  const [mode,   setMode]   = useState<Mode>("major");
  const [style,  setStyle]  = useState<ProgressionStyle>("I-V-vi-IV");
  const [octave, setOctave] = useState(4);
  const [ext,    setExt]    = useState(false);
  const [activeChord, setActiveChord] = useState<number | null>(null);

  const prog = useMemo(() =>
    generateProgression({ key, mode, style, octave, bpm, addExtensions: ext }),
  [key, mode, style, octave, bpm, ext]);

  const handlePreviewChord = (idx: number) => {
    setActiveChord(idx);
    const chord = prog.chords[idx];
    // Piano-Vorschau via WebAudio
    const ctx = new AudioContext();
    chord.notes.forEach(n => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440 * Math.pow(2, (n.midi - 69) / 12);
      osc.type = "triangle";
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.8);
    });
    setTimeout(() => setActiveChord(null), 800);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-text-dim uppercase tracking-widest">Chord Progression</span>
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-[10px] text-text-dim cursor-pointer">
          <input type="checkbox" checked={ext} onChange={e => setExt(e.target.checked)} className="accent-accent-primary" />
          Erweiterungen (7th)
        </label>
      </div>

      {/* Tonart + Modus */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-text-dim block mb-1">Grundton</label>
          <div className="flex flex-wrap gap-1">
            {NOTE_NAMES_SHARP.map((n, i) => (
              <button key={i} onClick={() => setKey(i)}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${key === i ? "border-accent-primary bg-accent-primary/20 text-accent-primary" : "border-border-color text-text-dim hover:text-text-primary"}`}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] text-text-dim block mb-1">Modus</label>
          <select value={mode} onChange={e => setMode(e.target.value as Mode)}
            className="w-full text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary">
            {MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
          </select>
        </div>
      </div>

      {/* Progression-Style + Oktave */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] text-text-dim block mb-1">Progression</label>
          <select value={style} onChange={e => setStyle(e.target.value as ProgressionStyle)}
            className="w-full text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary">
            {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-text-dim block mb-1">Oktave</label>
          <select value={octave} onChange={e => setOctave(Number(e.target.value))}
            className="text-xs bg-bg-elevated border border-border-color rounded px-2 py-1 text-text-primary">
            {[2,3,4,5,6].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      {/* Akkord-Vorschau */}
      <div>
        <div className="text-[10px] text-text-dim mb-1">
          {prog.keyName} · {prog.style} · Klick = Vorschau
        </div>
        <div className="flex gap-2">
          {prog.chords.map((chord, i) => (
            <ChordCard key={i} chord={chord} isActive={activeChord === i}
              onClick={() => handlePreviewChord(i)} />
          ))}
        </div>
      </div>

      {/* Skalen-Visualisierung */}
      <div className="flex gap-1 items-end">
        {NOTE_NAMES_SHARP.map((n, i) => {
          const semitones = MODAL_INTERVALS[mode];
          const inScale = semitones.includes((i - key + 12) % 12);
          return (
            <div key={i} className={`flex-1 text-center text-[9px] py-1 rounded-sm transition-colors ${inScale ? "bg-accent-primary/30 text-accent-primary" : "bg-bg-elevated text-text-dim"}`}>
              {n}
            </div>
          );
        })}
      </div>

      {/* Apply Button */}
      {onApply && (
        <button onClick={() => onApply(prog)}
          className="w-full py-2 text-xs rounded bg-accent-primary text-white hover:opacity-80 font-bold transition-opacity">
          → In Piano Roll / Arpeggiator übertragen
        </button>
      )}
    </div>
  );
}
